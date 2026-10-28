/**
 * Verifier Server — Finnish Positive Credit Register Proof
 *
 * Two validation modes:
 *   • DEV  : accepts `{ proof: { dev: true } }` — no TLSN checks, official
 *            Vero-shaped no-risk fixture, but writes a REAL on-chain
 *            attestation. Gated by DEV_MODE=true.
 *   • PROD : accepts a real TLSN proof JSON produced by the TLSNotary Chrome
 *            extension against our local notary. Validates structure, server
 *            name, notary pubkey (matched against the live notary /info
 *            endpoint), and revealed Vero credit-register extract JSON.
 *
 * NOTE: Full cryptographic verification of the MPC-TLS commitments needs the
 * `tlsn-verifier` WASM. This PoC does structural + content + pubkey checks;
 * the TODO is clearly marked.
 *
 * Important data-source note:
 * The Finnish Positive Credit Register does not contain payment-default
 * records. It can show delayed loan amounts (>60 days late), accelerated loans,
 * voluntary credit bans, loan summaries, and income data. This verifier attests
 * a narrower, truthful claim: no severe Positive Credit Register risk flags
 * are visible in the revealed extract.
 */

import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const SOLANA_RPC = process.env.SOLANA_RPC || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "8r3EJCaFuJHxxbUK2uWdPhWetjk6trzPhZ4tEaRAwL4L"
);
const DEV_MODE = String(process.env.DEV_MODE || "false").toLowerCase() === "true";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const CAPTURE_MODE =
  String(process.env.CAPTURE_MODE || "true").toLowerCase() === "true";

// TLSNotary notary server (local Docker by default).
const NOTARY_URL = process.env.NOTARY_URL || "http://127.0.0.1:7047";
// Optional override — if set, we don't hit /info at all.
const NOTARY_PUBKEY_OVERRIDE = process.env.NOTARY_PUBKEY || "";

const VERO_API_HOST =
  process.env.VERO_API_HOST || "api.positiivinenluottotietorekisteri.fi";
const VERO_E_SERVICE_HOST =
  process.env.VERO_E_SERVICE_HOST || "asiointi.positiivinenluottotietorekisteri.fi";
const VERO_API_PATH = process.env.VERO_API_PATH || "/GetCreditRegisterExtract";
const EXPECTED_SERVER_NAMES = new Set([VERO_API_HOST, VERO_E_SERVICE_HOST]);
const PROOF_MAX_AGE_SECONDS = Number(process.env.PROOF_MAX_AGE_SECONDS || 3600);
const EXTRACT_MAX_AGE_SECONDS = Number(process.env.EXTRACT_MAX_AGE_SECONDS || 24 * 3600);

const CLAIM_DESCRIPTION =
  "no delayed amounts, no accelerated loans, no active voluntary credit ban, no deceased-person extract";

const captureSessions = new Map();
let activeCaptureSessionId = null;

const verifierKeypair = Keypair.fromSecretKey(
  new Uint8Array(
    JSON.parse(
      fs.readFileSync(
        process.env.VERIFIER_KEYPAIR_PATH || "./verifier-keypair.json",
        "utf8"
      )
    )
  )
);

const connection = new Connection(SOLANA_RPC, "confirmed");

const IX_DISCRIMINATORS = {
  attest_credit: Buffer.from([0xf4, 0x20, 0x29, 0xc1, 0x74, 0x20, 0x3a, 0x74]),
};

// ─── Notary pubkey cache ──────────────────────────────────────────────────────
// Refreshed lazily on first use; overridden by NOTARY_PUBKEY env var.

let cachedNotaryPubkey = null; // { raw: string, fingerprint: string }

async function getNotaryPubkey() {
  if (NOTARY_PUBKEY_OVERRIDE) {
    return {
      raw: NOTARY_PUBKEY_OVERRIDE,
      fingerprint: sha256Hex(NOTARY_PUBKEY_OVERRIDE),
      source: "env",
    };
  }
  if (cachedNotaryPubkey) return cachedNotaryPubkey;

  const res = await fetch(`${NOTARY_URL}/info`, {
    signal: AbortSignal.timeout(3000),
  }).catch((e) => {
    throw new Error(
      e.name === "TimeoutError" || e.name === "AbortError"
        ? `timeout after 3s — is the Docker notary running on ${NOTARY_URL}?`
        : e.message
    );
  });
  if (!res.ok) {
    throw new Error(`Notary /info failed: ${res.status}`);
  }
  const info = await res.json();
  // v0.1.0-alpha.12 returns { publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----", version, ... }
  const raw = info.publicKey || info.public_key;
  if (!raw) throw new Error("Notary /info missing publicKey");
  cachedNotaryPubkey = {
    raw,
    fingerprint: sha256Hex(raw.replace(/\s+/g, "")),
    source: "notary",
    version: info.version,
  };
  return cachedNotaryPubkey;
}

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(
  cors({
    origin(origin, cb) {
      return cb(null, isAllowedOrigin(origin));
    },
  })
);
app.use(express.json({ limit: "10mb" }));

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === FRONTEND_URL) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  if (origin === `https://${VERO_E_SERVICE_HOST}`) return true;
  if (origin === "https://www.vero.fi") return true;

  try {
    const url = new URL(origin);
    const isLocalHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    return isLocalHost && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    verifier: verifierKeypair.publicKey.toBase58(),
    programId: PROGRAM_ID.toBase58(),
    rpc: SOLANA_RPC,
    notaryUrl: NOTARY_URL,
    devMode: DEV_MODE,
    captureMode: CAPTURE_MODE,
    source: "Vero Positive Credit Register",
    claim: CLAIM_DESCRIPTION,
    expectedServers: Array.from(EXPECTED_SERVER_NAMES),
    expectedApiPath: VERO_API_PATH,
  })
);

/** GET /notary-info  — proxies the local notary so the frontend can show it. */
app.get("/notary-info", async (_req, res) => {
  try {
    const pk = await getNotaryPubkey();
    res.json({ notaryUrl: NOTARY_URL, ...pk });
  } catch (err) {
    res.status(502).json({
      error: `Notary unreachable at ${NOTARY_URL}: ${err.message}`,
    });
  }
});

app.post("/proof-session", async (req, res) => {
  if (!CAPTURE_MODE) {
    return res.status(403).json({ success: false, error: "Browser capture mode is disabled" });
  }

  try {
    const wallet = new PublicKey(req.body?.walletAddress);
    const session = {
      id: crypto.randomUUID(),
      walletAddress: wallet.toBase58(),
      status: "waiting_for_vero",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      txSignature: null,
      pdaAddress: null,
      claim: null,
      error: null,
    };
    captureSessions.set(session.id, session);
    activeCaptureSessionId = session.id;
    res.json({ success: true, session });
  } catch (err) {
    res.status(400).json({ success: false, error: "Invalid walletAddress" });
  }
});

app.get("/proof-session/active", (_req, res) => {
  const session = activeCaptureSessionId
    ? captureSessions.get(activeCaptureSessionId)
    : null;
  if (!session) return res.status(404).json({ success: false, error: "No active proof session" });
  res.json({ success: true, session });
});

app.get("/proof-session/:id", (req, res) => {
  const session = captureSessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Unknown proof session" });
  res.json({ success: true, session });
});

app.post("/capture-vero-loans", async (req, res) => {
  if (!CAPTURE_MODE) {
    return res.status(403).json({ success: false, error: "Browser capture mode is disabled" });
  }

  const { sessionId, url, body, pageUrl, capturedAt } = req.body || {};
  const session = captureSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: "Unknown proof session" });
  }

  try {
    const validation = validateBrowserCaptureProof({
      url,
      body,
      pageUrl,
      capturedAt,
    });
    if (!validation.valid) {
      session.status = "error";
      session.error = validation.reason;
      session.updatedAt = new Date().toISOString();
      return res.status(400).json({ success: false, error: validation.reason, session });
    }

    session.status = "writing_on_chain";
    session.updatedAt = new Date().toISOString();

    const txSig = await writeAttestation({
      walletAddress: session.walletAddress,
      paymentDefaults: validation.paymentDefaults,
      proofHash: validation.proofHash,
      notaryPubkey: validation.notaryPubkey,
      attestedAt: validation.sessionTimestamp,
    });

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_attestation"), new PublicKey(session.walletAddress).toBuffer()],
      PROGRAM_ID
    );

    session.status = "done";
    session.txSignature = txSig;
    session.pdaAddress = pda.toBase58();
    session.claim = validation.claim;
    session.updatedAt = new Date().toISOString();

    res.json({ success: true, session });
  } catch (err) {
    session.status = "error";
    session.error = err.message || String(err);
    session.updatedAt = new Date().toISOString();
    res.status(500).json({ success: false, error: session.error, session });
  }
});

/**
 * POST /verify-proof
 * Body: { proof: object, walletAddress: string, mode?: "DEV"|"PROD" }
 */
app.post("/verify-proof", async (req, res) => {
  const { proof, walletAddress, mode: rawMode } = req.body || {};
  if (!proof || !walletAddress) {
    return res.status(400).json({ success: false, error: "Missing proof or walletAddress" });
  }
  const mode = (rawMode || (proof.dev ? "DEV" : "PROD")).toUpperCase();

  try {
    let validation;

    if (mode === "DEV") {
      if (!DEV_MODE) {
        return res.status(403).json({
          success: false,
          error: "DEV mode disabled on server (set DEV_MODE=true in .env)",
        });
      }
      console.log("⚠️  DEV_MODE: accepting mock proof without TLSN verification");
      validation = {
        valid: true,
        riskFlags: 0,
        paymentDefaults: 0,
        serverName: VERO_API_HOST,
        sessionTimestamp: Math.floor(Date.now() / 1000),
        proofHash: Array.from(crypto.randomBytes(32)),
        notaryPubkey: Array(32).fill(0),
        claim: buildDevClaim(),
      };
    } else {
      validation = await validateTlsnProof(proof);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.reason });
      }
      console.log(`✅ PROD proof valid for wallet ${walletAddress}`);
      console.log(`   server:           ${validation.serverName}`);
      console.log(`   risk_flags:       ${validation.riskFlags}`);
      console.log(
        `   session time:     ${new Date(validation.sessionTimestamp * 1000).toISOString()}`
      );
      console.log(`   notary fp:        ${bytesToHex(validation.notaryPubkey).slice(0, 16)}…`);
    }

    const txSig = await writeAttestation({
      walletAddress,
      paymentDefaults: validation.paymentDefaults,
      proofHash: validation.proofHash,
      notaryPubkey: validation.notaryPubkey,
      attestedAt: validation.sessionTimestamp,
    });

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_attestation"), new PublicKey(walletAddress).toBuffer()],
      PROGRAM_ID
    );

    return res.json({
      success: true,
      mode,
      txSignature: txSig,
      pdaAddress: pda.toBase58(),
      claim: validation.claim,
    });
  } catch (err) {
    console.error("Error processing proof:", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get("/attestation/:walletAddress", async (req, res) => {
  try {
    const wallet = new PublicKey(req.params.walletAddress);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_attestation"), wallet.toBuffer()],
      PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) {
      return res.json({ exists: false, pdaAddress: pda.toBase58() });
    }
    return res.json({
      exists: true,
      pdaAddress: pda.toBase58(),
      ...decodeAttestation(accountInfo.data),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

// ─── Proof Validation (PROD) ──────────────────────────────────────────────────

/**
 * Validate a real TLSNotary proof from the Chrome extension.
 *
 * Checks performed:
 *   1. Proof JSON has the expected shape (session_header + openings).
 *   2. server_name is a Vero Positive Credit Register API/e-service host.
 *   3. Notary pubkey embedded in the proof matches the one served by our
 *      local notary's /info endpoint (or NOTARY_PUBKEY env override).
 *   4. Revealed bytes contain a Vero credit-register extract JSON body.
 *   5. Session timestamp is within the last hour.
 *   6. Extract risk flags are zero:
 *      - no delayedAmounts entries,
 *      - no isForeclosed=true loans,
 *      - no voluntaryBanOnCredits.isInEffect=true,
 *      - no deceasedPerson response.
 *
 * TODO: hook in `tlsn-verifier` (WASM) to verify the MPC-TLS commitments.
 */
async function validateTlsnProof(proof) {
  try {
    const header =
      proof.session_header ||
      proof.sessionHeader ||
      proof.presentation?.session_header;
    if (!header) return { valid: false, reason: "Missing session_header" };

    // 1. Server name
    const serverName = header.server_name || header.serverName || "";
    if (!EXPECTED_SERVER_NAMES.has(serverName)) {
      return {
        valid: false,
        reason: `Wrong server: expected one of ${Array.from(EXPECTED_SERVER_NAMES).join(", ")}, got "${serverName}"`,
      };
    }

    // 2. Notary pubkey match
    const proofNotaryPubkey =
      header.notary_pubkey ||
      header.notaryPubkey ||
      header.notary_public_key ||
      "";
    if (!proofNotaryPubkey) {
      return { valid: false, reason: "Proof missing notary public key" };
    }
    const expected = await getNotaryPubkey();
    const proofFingerprint = sha256Hex(
      String(proofNotaryPubkey).replace(/\s+/g, "")
    );
    if (proofFingerprint !== expected.fingerprint) {
      return {
        valid: false,
        reason: `Notary pubkey mismatch. Expected fp ${expected.fingerprint.slice(0, 16)}…, got ${proofFingerprint.slice(0, 16)}… (check NOTARY_URL / NOTARY_PUBKEY)`,
      };
    }

    // 3. Notary signature must be present (PoC: we trust the pubkey match;
    // full Ed25519/secp256k1 verify requires the tlsn-verifier crate).
    const notarySig = header.notary_signature || header.notarySignature;
    if (!notarySig) {
      return { valid: false, reason: "Proof missing notary signature" };
    }

    // 4. Revealed text must contain enough Vero extract data to prove the claim.
    const revealedText = extractRevealedText(proof);
    const claim = parseVeroRiskClaim(revealedText);
    if (!claim.valid) return claim;
    if (claim.riskFlags !== 0) {
      return {
        valid: false,
        reason:
          `Vero extract has ${claim.riskFlags} risk flag(s): ` +
          `${claim.delayedAmountCount} delayed amount(s), ` +
          `${claim.acceleratedLoanCount} accelerated loan(s), ` +
          `${claim.voluntaryBanActive ? "active voluntary credit ban, " : ""}` +
          `${claim.deceasedPerson ? "deceased-person extract" : ""}`.replace(/, $/, ""),
      };
    }

    // 5. Session freshness
    const sessionTime = normalizeUnixTimestamp(header.time || header.timestamp || 0);
    const now = Math.floor(Date.now() / 1000);
    if (!sessionTime || Math.abs(now - sessionTime) > PROOF_MAX_AGE_SECONDS) {
      return {
        valid: false,
        reason: `TLS session timestamp missing or older than ${PROOF_MAX_AGE_SECONDS} seconds`,
      };
    }

    if (
      claim.creationTimeUtc &&
      Math.abs(now - Math.floor(Date.parse(claim.creationTimeUtc) / 1000)) >
        EXTRACT_MAX_AGE_SECONDS
    ) {
      return {
        valid: false,
        reason: `Vero extract creationTimeUtc is older than ${EXTRACT_MAX_AGE_SECONDS} seconds`,
      };
    }

    const proofHash = Array.from(
      crypto.createHash("sha256").update(Buffer.from(JSON.stringify(proof))).digest()
    );

    return {
      valid: true,
      riskFlags: 0,
      // Backwards-compatible field name for the current Solana PDA layout.
      paymentDefaults: 0,
      serverName,
      sessionTimestamp: sessionTime,
      proofHash,
      // Pack the notary pubkey fingerprint (sha256) into 32 bytes for on-chain storage.
      notaryPubkey: Array.from(Buffer.from(expected.fingerprint, "hex")),
      claim,
    };
  } catch (err) {
    return { valid: false, reason: `Proof parse error: ${err.message}` };
  }
}

function extractRevealedText(proof) {
  const parts = [];
  const substrings =
    proof.substrings ||
    proof.presentation?.substrings ||
    proof.transcript ||
    {};
  const openings =
    substrings.openings ||
    substrings.transcript_openings ||
    substrings.reveals ||
    [];
  for (const o of openings) {
    if (o.kind === "Reveal" || o.kind === "reveal" || o.action === "REVEAL" || !o.kind) {
      const hex = o.data || o.bytes || "";
      if (hex) {
        try {
          parts.push(Buffer.from(hex, "hex").toString("utf8"));
        } catch {
          /* ignore binary-only opens */
        }
      } else if (o.text) {
        parts.push(String(o.text));
      }
    }
  }
  return parts.join("\n");
}

function parseVeroRiskClaim(text) {
  const payload = parseJsonObjectContaining(text, "\"creditRegisterExtract\"");
  if (payload) return analyseVeroExtract(payload);

  // Strong no-loans fallback: enough for a compact selective disclosure where
  // the proof reveals the summary and an empty loans array, but not identity or income.
  const loanContractsCount = matchInt(text, /"loanContractsCount"\s*:\s*(\d+)/);
  const lendersCount = matchInt(text, /"lendersCount"\s*:\s*(\d+)/);
  const guaranteedLoanContractsCount = matchInt(
    text,
    /"guaranteedLoanContractsCount"\s*:\s*(\d+)/
  );
  const loansEmpty = /"loans"\s*:\s*\[\s*\]/.test(text);
  const success = /"statusMessage"\s*:\s*"Success"/i.test(text) || !/"statusMessage"/.test(text);
  const voluntaryBanActive =
    /"voluntaryBanOnCredits"\s*:\s*\{[^}]*"isInEffect"\s*:\s*true/i.test(text);
  const deceasedPerson = /"deceasedPerson"\s*:\s*\{/i.test(text);
  const riskFlags = (voluntaryBanActive ? 1 : 0) + (deceasedPerson ? 1 : 0);

  if (success && loanContractsCount === 0 && loansEmpty) {
    return {
      valid: true,
      source: "vero-positive-credit-register",
      claim: CLAIM_DESCRIPTION,
      riskFlags,
      delayedAmountCount: 0,
      acceleratedLoanCount: 0,
      voluntaryBanActive,
      deceasedPerson,
      lendersCount: lendersCount ?? 0,
      loanContractsCount: 0,
      guaranteedLoanContractsCount: guaranteedLoanContractsCount ?? 0,
      proofShape: "selective-no-loans",
    };
  }

  return {
    valid: false,
    reason:
      "Revealed data does not contain a parseable Vero creditRegisterExtract. " +
      "Reveal either the full creditRegisterExtract JSON, or at minimum " +
      "creditInformationSummary.loanContractsCount=0 and loans=[] for the no-loans proof.",
  };
}

function analyseVeroExtract(payload) {
  const extract = payload.creditRegisterExtract || payload;
  if (!extract || typeof extract !== "object") {
    return { valid: false, reason: "Vero response missing creditRegisterExtract" };
  }

  const statusMessage = payload.statusMessage;
  if (statusMessage && !/^success$/i.test(String(statusMessage))) {
    return { valid: false, reason: `Vero statusMessage is "${statusMessage}", not Success` };
  }

  const loans = extract.loans;
  if (!Array.isArray(loans)) {
    return {
      valid: false,
      reason:
        "Vero extract proof must reveal the loans array. Without it, absence of delayed amounts or acceleration cannot be proven.",
    };
  }

  const summary = extract.creditInformationSummary || {};
  const loanContractsCount =
    Number.isInteger(summary.loanContractsCount) ? summary.loanContractsCount : loans.length;

  if (loanContractsCount !== loans.length) {
    return {
      valid: false,
      reason:
        `Vero summary loanContractsCount (${loanContractsCount}) does not match revealed loans length (${loans.length}). ` +
        "Reveal the complete loans array.",
    };
  }

  const delayedAmountCount = loans.reduce(
    (sum, loan) => sum + (Array.isArray(loan.delayedAmounts) ? loan.delayedAmounts.length : 0),
    0
  );
  const acceleratedLoanCount = loans.filter((loan) => loan.isForeclosed === true).length;
  const voluntaryBanActive = extract.voluntaryBanOnCredits?.isInEffect === true;
  const deceasedPerson = Boolean(extract.deceasedPerson);
  const riskFlags =
    delayedAmountCount +
    acceleratedLoanCount +
    (voluntaryBanActive ? 1 : 0) +
    (deceasedPerson ? 1 : 0);

  return {
    valid: true,
    source: "vero-positive-credit-register",
    claim: CLAIM_DESCRIPTION,
    riskFlags,
    delayedAmountCount,
    acceleratedLoanCount,
    voluntaryBanActive,
    deceasedPerson,
    extractReference: extract.extractReference || null,
    creationTimeUtc: extract.creationTimeUtc || null,
    lendersCount: summary.lendersCount ?? null,
    loanContractsCount,
    guaranteedLoanContractsCount: summary.guaranteedLoanContractsCount ?? null,
    proofShape: "full-extract",
  };
}

function validateBrowserCaptureProof({ url, body, pageUrl, capturedAt }) {
  const parsedUrl = parseUrl(url);
  if (
    !parsedUrl ||
    parsedUrl.hostname !== VERO_E_SERVICE_HOST ||
    !parsedUrl.pathname.includes("/loans")
  ) {
    return {
      valid: false,
      reason: `Expected captured Vero /loans response from ${VERO_E_SERVICE_HOST}`,
    };
  }

  const page = parseUrl(pageUrl || "");
  if (page && page.hostname !== VERO_E_SERVICE_HOST) {
    return { valid: false, reason: "Capture page host does not match Vero e-service" };
  }

  const payload = parseBody(body);
  if (!payload) return { valid: false, reason: "Captured /loans body is not valid JSON" };

  const claim = analyseVeroLoansPage(payload);
  if (!claim.valid) return claim;
  if (claim.riskFlags !== 0) {
    return {
      valid: false,
      reason:
        `Vero /loans response has ${claim.riskFlags} risk flag(s): ` +
        `${claim.delayedAmountCount} delayed repayment(s), ` +
        `${claim.foreclosedLoanCount} foreclosed loan(s), ` +
        `${claim.debtAmountTotal} EUR total debt`,
    };
  }

  const capturedSeconds = normalizeUnixTimestamp(capturedAt || Date.now());
  const canonical = JSON.stringify({ url: parsedUrl.toString(), body: payload, capturedAt });

  return {
    valid: true,
    riskFlags: 0,
    paymentDefaults: 0,
    serverName: VERO_E_SERVICE_HOST,
    sessionTimestamp: capturedSeconds || Math.floor(Date.now() / 1000),
    proofHash: Array.from(crypto.createHash("sha256").update(canonical).digest()),
    notaryPubkey: Array.from(crypto.createHash("sha256").update("browser-capture-vero-loans").digest()),
    claim,
  };
}

function analyseVeroLoansPage(payload) {
  const summary = payload.summary || {};
  if (!payload.summary || typeof payload.summary !== "object") {
    return { valid: false, reason: "Captured Vero /loans response is missing summary" };
  }
  const loanDelaySummary = payload.loanDelaySummary || {};
  const lumpSumLoans = asArray(payload.lumpSumLoans);
  const runningAccountLoans = asArray(payload.runningAccountLoans);
  const leasingLoans = asArray(payload.leasingLoans);
  const guaranteeReceivables = asArray(payload.guaranteeReceivables);
  const delayedRepayments = [
    ...asArray(summary.delayedRepaymentTotal),
    ...asArray(loanDelaySummary.delayedRepayments),
  ];
  const foreclosedLoans = [
    ...asArray(summary.foreclosedLoanTotal),
    ...asArray(loanDelaySummary.foreclosedLoans),
  ];

  const debtAmountTotal =
    sumAmounts(summary.debtTotal) +
    sumAmounts(summary.lumpSumLoanDebtTotal) +
    sumAmounts(summary.runningAccountLoanDebtTotal) +
    sumAmounts(summary.leasingLoanMonthlyDebtTotal);

  const loanCount =
    lumpSumLoans.length +
    runningAccountLoans.length +
    leasingLoans.length +
    guaranteeReceivables.length;
  const delayedAmountCount = delayedRepayments.length;
  const foreclosedLoanCount = foreclosedLoans.length;
  const debtArrangement =
    summary.isPersonInDebtArrangementOrBusinessRestructuringProgram === true;
  const riskFlags =
    loanCount +
    delayedAmountCount +
    foreclosedLoanCount +
    (debtAmountTotal > 0 ? 1 : 0) +
    (debtArrangement ? 1 : 0);

  return {
    valid: true,
    source: "vero-positive-credit-register-browser-capture",
    claim: "debt free in Vero /loans view",
    riskFlags,
    debtAmountTotal,
    loanCount,
    delayedAmountCount,
    foreclosedLoanCount,
    debtArrangement,
    proofShape: "vero-loans-page",
  };
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseBody(body) {
  if (body && typeof body === "object") return body;
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sumAmounts(value) {
  return asArray(value).reduce((sum, item) => sum + Number(item?.amount || 0), 0);
}

function parseJsonObjectContaining(text, needle) {
  const needleIndex = text.indexOf(needle);
  if (needleIndex === -1) return null;

  const starts = [];
  for (let i = 0; i <= needleIndex; i += 1) {
    if (text[i] === "{") starts.push(i);
  }

  for (let s = starts.length - 1; s >= 0; s -= 1) {
    const start = starts[s];
    for (let end = text.lastIndexOf("}"); end > needleIndex; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* try the next candidate */
      }
    }
  }

  return null;
}

function matchInt(text, regex) {
  const match = text.match(regex);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeUnixTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function buildDevClaim() {
  return {
    valid: true,
    source: "vero-positive-credit-register",
    claim: CLAIM_DESCRIPTION,
    riskFlags: 0,
    delayedAmountCount: 0,
    acceleratedLoanCount: 0,
    voluntaryBanActive: false,
    deceasedPerson: false,
    lendersCount: 0,
    loanContractsCount: 0,
    guaranteedLoanContractsCount: 0,
    proofShape: "official-schema-fixture",
  };
}

function bytesToHex(arr) {
  return Buffer.from(arr).toString("hex");
}

// ─── Solana Transaction ───────────────────────────────────────────────────────

async function writeAttestation({
  walletAddress,
  paymentDefaults,
  proofHash,
  notaryPubkey,
  attestedAt,
}) {
  await ensureLocalnetReady();

  const walletPubkey = new PublicKey(walletAddress);
  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credit_attestation"), walletPubkey.toBuffer()],
    PROGRAM_ID
  );

  const data = buildAttestCreditData({
    paymentDefaults,
    proofHash,
    notaryPubkey,
    attestedAt,
  });

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: verifierKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: walletPubkey, isSigner: false, isWritable: false },
      { pubkey: attestationPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = verifierKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(verifierKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`📝 Attestation written on-chain: ${sig}`);
  console.log(`   PDA: ${attestationPda.toBase58()}`);
  return sig;
}

async function ensureLocalnetReady() {
  const isLocalRpc = /127\.0\.0\.1|localhost/.test(SOLANA_RPC);
  const programAccount = await connection.getAccountInfo(PROGRAM_ID);
  if (!programAccount) {
    throw new Error(
      `Solana program ${PROGRAM_ID.toBase58()} is not deployed on ${SOLANA_RPC}. ` +
        "Run the README deploy step before proving."
    );
  }

  if (!isLocalRpc) return;

  const balance = await connection.getBalance(verifierKeypair.publicKey);
  if (balance >= LAMPORTS_PER_SOL) return;

  console.log("Verifier has no localnet SOL; requesting airdrop...");
  const sig = await connection.requestAirdrop(
    verifierKeypair.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
}

function buildAttestCreditData({ paymentDefaults, proofHash, notaryPubkey, attestedAt }) {
  const buf = Buffer.alloc(8 + 4 + 32 + 32 + 8);
  let off = 0;
  IX_DISCRIMINATORS.attest_credit.copy(buf, off); off += 8;
  buf.writeUInt32LE(paymentDefaults, off); off += 4;
  Buffer.from(proofHash).copy(buf, off); off += 32;
  Buffer.from(notaryPubkey).copy(buf, off); off += 32;
  buf.writeBigInt64LE(BigInt(attestedAt), off);
  return buf;
}

function decodeAttestation(data) {
  let off = 8;
  const wallet = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const paymentDefaults = data.readUInt32LE(off); off += 4;
  const proofHash = data.subarray(off, off + 32).toString("hex"); off += 32;
  const notaryPubkey = data.subarray(off, off + 32).toString("hex"); off += 32;
  const verifier = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const attestedAt = Number(data.readBigInt64LE(off)); off += 8;
  const expiresAt = Number(data.readBigInt64LE(off)); off += 8;
  const revoked = data.readUInt8(off) === 1; off += 1;
  return {
    wallet: wallet.toBase58(),
    riskFlags: paymentDefaults,
    // Kept for older frontend builds and existing account layout.
    paymentDefaults,
    proofHash,
    notaryPubkey,
    verifier: verifier.toBase58(),
    attestedAt,
    expiresAt,
    revoked,
    valid:
      !revoked &&
      paymentDefaults === 0 &&
      Math.floor(Date.now() / 1000) < expiresAt,
  };
}

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Verifier server running on http://localhost:${PORT}`);
  console.log(`   Verifier pubkey: ${verifierKeypair.publicKey.toBase58()}`);
  console.log(`   Solana RPC:      ${SOLANA_RPC}`);
  console.log(`   Program ID:      ${PROGRAM_ID.toBase58()}`);
  console.log(`   Notary URL:      ${NOTARY_URL}`);
  console.log(`   DEV_MODE:        ${DEV_MODE}`);
  if (DEV_MODE) {
    console.log(`   (mock proofs of shape {dev:true} accepted in DEV mode)`);
  }
});
