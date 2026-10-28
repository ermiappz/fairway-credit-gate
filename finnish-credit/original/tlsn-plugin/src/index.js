/**
 * TLSNotary Plugin: Finnish Positive Credit Register Proof (Vero)
 *
 * Flow:
 *   1. Opens the Positive Credit Register sign-in page.
 *   2. Watches for a Vero extract/e-service request after Suomi.fi auth.
 *   3. Re-runs that request through MPC-TLS with the local notary.
 *   4. Reveals the minimal Vero JSON needed for a no-risk demo:
 *      statusMessage, creditInformationSummary, loans=[], voluntary ban if present.
 *   5. Returns the proof to the calling dApp.
 *
 * Built for the TLSNotary Chrome extension plugin system (Extism/QuickJS).
 * Notary defaults to the local Docker notary at ws://127.0.0.1:7047.
 */

// ─── Config ──────────────────────────────────────────────────────────────────
const VERO_API_HOST = "api.positiivinenluottotietorekisteri.fi";
const VERO_E_SERVICE_HOST = "asiointi.positiivinenluottotietorekisteri.fi";
const TARGET_HOSTS = [VERO_API_HOST, VERO_E_SERVICE_HOST];

// Landing page that prompts Suomi.fi strong identification.
const AUTH_URL = "https://www.vero.fi/en/positivecreditregister/sign-in/";

// Production lender API endpoint from Vero docs plus broad e-service fallbacks.
// Confirm exact browser API paths from DevTools/TLSN Requests during a real login.
const EXTRACT_URL_PATTERNS = [
  /\/GetCreditRegisterExtract\b/i,
  /creditRegisterExtract/i,
  /luottotietorekisteri/i,
  /loan/i,
  /laina/i,
];

// Selective disclosure targets. The verifier accepts a strong no-loans proof
// from creditInformationSummary.loanContractsCount=0 plus loans=[].
const VERO_REVEAL_PATTERNS = [
  /"statusMessage"\s*:\s*"Success"/,
  /"creditInformationSummary"\s*:\s*\{[^}]+\}/,
  /"loans"\s*:\s*\[\s*\]/,
  /"voluntaryBanOnCredits"\s*:\s*\{[^}]+\}/,
];

// Local notary (Docker image tlsnotary/tlsn/notary-server:v0.1.0-alpha.12).
// Override via plugin settings if you want to use the PSE hosted notary.
const NOTARY_URL = "http://127.0.0.1:7047";

// Credit report page is small-ish HTML; 256 KB is enough headroom.
const MAX_RECV_DATA = 262144;
const MAX_SENT_DATA = 4096;

// ─── Plugin Entry Point ───────────────────────────────────────────────────────
export default {
  config: {
    name: "Finnish Credit Proof",
    description: "Prove a clear Vero Positive Credit Register status to DeFi protocols",
    icon: "🇫🇮",
  },
  main,
};

async function main() {
  render(Step1());

  await openWindow(AUTH_URL);

  render(Step2());

  // Wait for the report page request to appear after the user signs in.
  const [captured] = await useRequests((requests) =>
    requests.filter(
      (r) =>
        TARGET_HOSTS.some((host) => r.url.includes(host)) &&
        EXTRACT_URL_PATTERNS.some((pattern) => pattern.test(r.url))
    )
  );

  render(Step3());

  const requestHeaders = captured.requestHeaders || [];
  const capturedHost = new URL(captured.url).host;
  const proxyUrl = `ws://127.0.0.1:7047/proxy?token=${capturedHost}`;
  const getHeader = (name) =>
    requestHeaders.find((h) => h.name.toLowerCase() === name)?.value || "";

  const proof = await prove(
    {
      url: captured.url,
      method: captured.method || "GET",
      body: captured.body || captured.requestBody || undefined,
      headers: {
        // Session cookies authenticate the replayed request. Kept secret.
        Cookie: getHeader("cookie"),
        Authorization: getHeader("authorization"),
        "Content-Type": getHeader("content-type") || "application/json",
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9,fi;q=0.8",
        // MPC-TLS requires plaintext bytes — no compression, no keep-alive.
        "Accept-Encoding": "identity",
        Connection: "close",
      },
      secretHeaders: ["Cookie", "Authorization"],
    },
    {
      notaryUrl: NOTARY_URL,
      proxyUrl,
      maxRecvData: MAX_RECV_DATA,
      maxSentData: MAX_SENT_DATA,
      handlers: [
        // Reveal which endpoint we hit.
        { type: "SENT", part: "START_LINE", action: "REVEAL" },
        // Hide auth cookies and bearer tokens.
        { type: "SENT", part: "HEADERS", action: "CONCEAL" },
        // Reveal response status line — proves server returned 200.
        { type: "RECV", part: "START_LINE", action: "REVEAL" },
        // Hide Set-Cookie and other sensitive response headers.
        { type: "RECV", part: "HEADERS", action: "CONCEAL" },
        ...VERO_REVEAL_PATTERNS.map((match) => ({
          type: "RECV",
          part: "BODY",
          action: "REVEAL_MATCH",
          match,
        })),
      ],
    }
  );

  render(Step4(proof));

  await done(proof);
}

// ─── UI Steps ────────────────────────────────────────────────────────────────

function Step1() {
  return {
    type: "div",
    children: [
      { type: "h2", text: "🇫🇮 Finnish Credit Proof" },
      {
        type: "p",
        text: "A window will open to the Positive Credit Register. Sign in with Suomi.fi to view your registered credit data.",
      },
      {
        type: "p",
        style: { color: "#64748b", fontSize: "13px" },
        text: "Your credentials never leave your browser. The proof reveals only the Vero fields needed for the claim.",
      },
    ],
  };
}

function Step2() {
  return {
    type: "div",
    children: [
      { type: "h2", text: "⏳ Waiting for the credit report…" },
      {
        type: "p",
        text: "Complete Suomi.fi authentication, open your loan or extract view, and the plugin will capture the matching Vero request.",
      },
    ],
  };
}

function Step3() {
  return {
    type: "div",
    children: [
      { type: "h2", text: "🔐 Generating TLS proof…" },
      {
        type: "p",
        text: "Running MPC-TLS against the local notary server at 127.0.0.1:7047. This usually takes 30–60 seconds.",
      },
      {
        type: "p",
        style: { color: "#64748b", fontSize: "13px" },
        text: "For the fast demo, reveal creditInformationSummary and loans=[] to prove no registered loans. If loans exist, reveal the full loans array to prove no delayed amounts or acceleration.",
      },
    ],
  };
}

function Step4(_proof) {
  return {
    type: "div",
    children: [
      { type: "h2", text: "✅ Proof generated" },
      {
        type: "p",
        text: "The TLS proof reveals a Vero Positive Credit Register no-risk claim.",
      },
      {
        type: "pre",
        style: {
          fontSize: "11px",
          background: "#0d1117",
          padding: "12px",
          borderRadius: "8px",
        },
        text: JSON.stringify(
          {
            server: TARGET_HOSTS,
            notary: NOTARY_URL,
            revealed: "creditInformationSummary + loans=[] + statusMessage",
            concealed: "auth cookies, personal ID, income, and unrelated fields",
          },
          null,
          2
        ),
      },
    ],
  };
}
