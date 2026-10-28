import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import "@solana/wallet-adapter-react-ui/styles.css";

const VERIFIER_URL =
  import.meta.env.VITE_VERIFIER_URL || "http://localhost:3001";
const PROGRAM_ID =
  import.meta.env.VITE_PROGRAM_ID ||
  "8r3EJCaFuJHxxbUK2uWdPhWetjk6trzPhZ4tEaRAwL4L";
const NETWORK = (import.meta.env.VITE_NETWORK || "localnet") as
  | "localnet"
  | "devnet"
  | "mainnet-beta";
const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  (NETWORK === "localnet"
    ? "http://127.0.0.1:8899"
    : clusterApiUrl(NETWORK as WalletAdapterNetwork));

const VERO_SIGN_IN_URL =
  "https://www.vero.fi/en/positivecreditregister/sign-in/";

type Mode = "DEV" | "PROD";
type Step = "idle" | "opening" | "proving" | "submitting" | "done" | "error";

interface AttestationResult {
  txSignature: string;
  pdaAddress: string;
  mode: Mode;
  claim?: any;
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function AppInner() {
  const { publicKey, connected } = useWallet();

  const [mode, setMode] = useState<Mode>("DEV");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationResult | null>(null);
  const [existing, setExisting] = useState<any>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  const [notaryInfo, setNotaryInfo] = useState<any>(null);
  const [notaryError, setNotaryError] = useState<string | null>(null);

  const [pastedProof, setPastedProof] = useState("");
  const [captureSession, setCaptureSession] = useState<any>(null);

  const refreshExisting = useCallback(async () => {
    if (!publicKey) return;
    setCheckingExisting(true);
    try {
      const r = await fetch(
        `${VERIFIER_URL}/attestation/${publicKey.toBase58()}`
      );
      setExisting(await r.json());
    } catch {
      setExisting(null);
    } finally {
      setCheckingExisting(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refreshExisting();
  }, [refreshExisting]);

  useEffect(() => {
    setNotaryError(null);
    setNotaryInfo(null);
  }, [mode]);

  const pollProofSession = useCallback(async (sessionId: string) => {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const r = await fetch(`${VERIFIER_URL}/proof-session/${sessionId}`);
      const data = await r.json();
      if (!r.ok || !data.success) {
        throw new Error(data.error || "Proof session polling failed");
      }
      setCaptureSession(data.session);
      if (data.session.status === "done") return data.session;
      if (data.session.status === "error") {
        throw new Error(data.session.error || "Vero proof capture failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Timed out waiting for the Vero proof tab.");
  }, []);

  const handleProve = useCallback(async () => {
    if (!publicKey) return;
    setError(null);
    setAttestation(null);

    try {
      let proof: any;

      if (mode === "DEV") {
        setStep("proving");
        await new Promise((r) => setTimeout(r, 400));
        proof = { dev: true };
      } else {
        setStep("opening");
        const sessionResponse = await fetch(`${VERIFIER_URL}/proof-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
        });
        const sessionResult = await sessionResponse.json();
        if (!sessionResult.success) {
          throw new Error(sessionResult.error || "Could not start proof session");
        }
        setCaptureSession(sessionResult.session);
        window.open(VERO_SIGN_IN_URL, "_blank", "noopener");
        setStep("proving");
        const doneSession = await pollProofSession(sessionResult.session.id);
        setAttestation({
          txSignature: doneSession.txSignature,
          pdaAddress: doneSession.pdaAddress,
          mode,
          claim: doneSession.claim,
        });
        setStep("done");
        refreshExisting();
        return;
      }

      setStep("submitting");

      const response = await fetch(`${VERIFIER_URL}/verify-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof,
          walletAddress: publicKey.toBase58(),
          mode,
        }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error || "Verification failed");

      const [pdaAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("credit_attestation"), publicKey.toBuffer()],
        new PublicKey(PROGRAM_ID)
      );

      setAttestation({
        txSignature: result.txSignature,
        pdaAddress: result.pdaAddress || pdaAddress.toBase58(),
        mode,
        claim: result.claim,
      });
      setStep("done");
      refreshExisting();
    } catch (err: any) {
      setError(err.message || String(err));
      setStep("error");
    }
  }, [publicKey, mode, pastedProof, refreshExisting, pollProofSession]);

  return (
    <div style={styles.root}>
      <div style={styles.gridBg} />

      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.flagRow}>
            <span style={styles.flag}>🇫🇮</span>
            <span style={styles.flagLabel}>Finnish Credit → DeFi Bridge</span>
          </div>
          <h1 style={styles.h1}>Prove Clear Credit Register Status</h1>
          <p style={styles.subtitle}>
            Capture your official Positive Credit Register loan summary in a
            local browser extension, then write a Solana attestation that no
            debt or severe risk flags were found.
          </p>
          <div style={styles.netPill}>
            cluster: <b>{NETWORK}</b> · rpc: {RPC_URL}
          </div>
        </header>

        <FlowDiagram />

        <div style={styles.card}>
          <div style={styles.walletRow}>
            <span style={styles.sectionLabel}>// 01 · Connect Wallet</span>
            <WalletMultiButton />
          </div>

          {connected && publicKey && (
            <>
              <div style={styles.divider} />

              {checkingExisting && (
                <StatusBadge
                  color="#64748b"
                  icon="⏳"
                  text="Checking existing attestation..."
                />
              )}

              {!checkingExisting && existing?.exists && (
                <StatusBadge
                  color={existing.valid ? "#34d399" : "#f59e0b"}
                  icon={existing.valid ? "✅" : "⚠️"}
                  text={
                    existing.valid
                      ? `Valid attestation on-chain · risk_flags=${existing.riskFlags ?? existing.paymentDefaults}`
                      : `On-chain attestation exists but is expired/revoked`
                  }
                  sub={existing.pdaAddress}
                />
              )}

              <div style={{ marginTop: 24 }}>
                <span style={styles.sectionLabel}>
                  // 02 · Generate Credit Proof
                </span>

                <ModeSelector mode={mode} onChange={setMode} />

                <div style={styles.infoBox}>
                  <InfoRow k="Data source" v="Vero Positive Credit Register" />
                  <InfoRow k="Auth method" v="Suomi.fi strong identification" />
                  <InfoRow
                    k="Proven claim"
                    v={
                      <span style={{ color: "#38bdf8", fontSize: 12 }}>
                        no delayed amounts, no accelerated loans, no active credit ban, no deceased extract
                      </span>
                    }
                  />
                  <InfoRow k="Concealed" v="personal ID, income, and loan details where possible" />
                  <InfoRow
                    k="Protocol"
                    v={mode === "DEV" ? "official Vero-shaped fixture" : "browser capture → local verifier"}
                  />
                </div>

                {mode === "PROD" && (
                  <ProdPanel
                    notaryInfo={notaryInfo}
                    notaryError={notaryError}
                    pastedProof={pastedProof}
                    onProofChange={setPastedProof}
                    captureSession={captureSession}
                  />
                )}

                {(step === "idle" || step === "error") && (
                  <button style={styles.proveBtn} onClick={handleProve}>
                    {mode === "DEV"
                      ? "🔐 Prove Credit to Solana (DEV)"
                      : "🔐 Start Vero Proof Session"}
                  </button>
                )}

                {step === "opening" && (
                  <ProgressCard
                    step={1}
                    total={3}
                    title={mode === "DEV" ? "Preparing local proof..." : "Opening Vero proof tab..."}
                    desc={
                      mode === "DEV"
                        ? "The verifier will use the Vero-shaped fixture and write the local Solana attestation."
                        : "A managed Vero tab is opening. Log in with Suomi.fi, go to Loan information, then click Create proof in the overlay."
                    }
                  />
                )}

                {step === "proving" && (
                  <ProgressCard
                    step={2}
                    total={3}
                    title={mode === "DEV" ? "Loading Vero-shaped fixture..." : "Waiting for Vero proof..."}
                    desc={
                      mode === "DEV"
                        ? "DEV mode: we skip the TLSN session and use a Vero-shaped no-risk fixture so you can demo the on-chain write."
                        : `Waiting for browser proof capture${captureSession?.status ? ` (${captureSession.status})` : ""}. Return here after the Vero tab says the attestation was published.`
                    }
                  />
                )}

                {step === "submitting" && (
                  <ProgressCard
                    step={3}
                    total={3}
                    title="Writing on-chain attestation..."
                    desc="The verifier is calling the Solana program to store your CreditAttestation PDA."
                  />
                )}

                {step === "error" && error && (
                  <div style={styles.errorBox}>
                    <span style={{ fontSize: 18 }}>❌</span>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Error</div>
                      <div style={{ fontSize: 13, color: "#fca5a5" }}>{error}</div>
                    </div>
                  </div>
                )}

                {step === "done" && attestation && (
                  <SuccessCard
                    attestation={attestation}
                    wallet={publicKey.toBase58()}
                    network={NETWORK}
                  />
                )}
              </div>
            </>
          )}

          {!connected && (
            <div style={styles.connectPrompt}>
              Connect your Phantom wallet to get started →
            </div>
          )}
        </div>

        <PrereqCard mode={mode} />
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ModeSelector({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div style={styles.modeRow}>
      {(["DEV", "PROD"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            ...styles.modeBtn,
            ...(mode === m ? styles.modeBtnActive : {}),
          }}
        >
          <div style={{ fontWeight: 700 }}>{m}</div>
          <div style={styles.modeSub}>
            {m === "DEV"
              ? "Vero fixture, real on-chain"
              : "Vero browser proof, real on-chain"}
          </div>
        </button>
      ))}
    </div>
  );
}

function ProdPanel({
  notaryInfo,
  notaryError,
  pastedProof,
  onProofChange,
  captureSession,
}: {
  notaryInfo: any;
  notaryError: string | null;
  pastedProof: string;
  onProofChange: (s: string) => void;
  captureSession: any;
}) {
  return (
    <div style={styles.prodPanel}>
      <div style={styles.prodHead}>// PROD mode — Vero browser proof</div>

      {captureSession && (
        <div style={styles.notaryBox}>
          <InfoRow k="Session" v={captureSession.id} />
          <InfoRow k="Status" v={captureSession.status} />
          {captureSession.error && <InfoRow k="Error" v={captureSession.error} />}
        </div>
      )}

      <ol style={styles.prodSteps}>
        <li>Load the local extension from <code>vero-proof-extension/</code>.</li>
        <li>Click the button below. The app starts a wallet-bound proof session.</li>
        <li>
          In the Vero tab, sign in, open <b>Loan information</b>, and wait until
          the overlay sees the <code>/loans</code> REST response.
        </li>
        <li>
          Click <b>Create debt-free proof</b>. The extension posts the captured
          response to the verifier, which writes the Solana PDA.
        </li>
        <li>Close the Vero tab and return here when the overlay says published.</li>
      </ol>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoKey}>{k}</span>
      <span style={styles.infoVal}>{v}</span>
    </div>
  );
}

function FlowDiagram() {
  const steps = [
    { icon: "🏦", label: "Strong ID", sub: "Suomi.fi" },
    { icon: "📋", label: "Vero Extract", sub: "Positive Register" },
    { icon: "🔐", label: "Browser Proof", sub: "local extension" },
    { icon: "🔍", label: "Verify", sub: "Verifier Server" },
    { icon: "⛓️", label: "On-Chain", sub: "Solana" },
    { icon: "₿", label: "Borrow BTC", sub: "DeFi Protocol" },
  ];
  return (
    <div style={styles.flow}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={styles.flowStep}>
            <span style={{ fontSize: 22 }}>{s.icon}</span>
            <div style={styles.flowLabel}>{s.label}</div>
            <div style={styles.flowSub}>{s.sub}</div>
          </div>
          {i < steps.length - 1 && <div style={styles.flowArrow}>→</div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function StatusBadge({ color, icon, text, sub }: any) {
  return (
    <div style={{ ...styles.statusBadge, borderColor: color }}>
      <span>{icon}</span>
      <div>
        <div style={{ color, fontWeight: 600, fontSize: 14 }}>{text}</div>
        {sub && (
          <div style={{ color: "#64748b", fontSize: 11, fontFamily: "monospace" }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressCard({ step, total, title, desc }: any) {
  return (
    <div style={styles.progressCard}>
      <div style={styles.progressHeader}>
        <span style={{ color: "#38bdf8" }}>
          Step {step}/{total}
        </span>
        <span style={styles.spinner}>⟳</span>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#94a3b8" }}>{desc}</div>
      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}

function SuccessCard({ attestation, wallet, network }: any) {
  const clusterQuery =
    network === "localnet"
      ? "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"
      : `?cluster=${network}`;
  const explorerTx = `https://explorer.solana.com/tx/${attestation.txSignature}${clusterQuery}`;
  const explorerPda = `https://explorer.solana.com/address/${attestation.pdaAddress}${clusterQuery}`;

  return (
    <div style={styles.successCard}>
      <div style={styles.successHeader}>
        <span style={{ fontSize: 32 }}>✅</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#34d399" }}>
            Credit Status Attested On-Chain · {attestation.mode} mode
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            risk_flags:{" "}
            <span style={{ color: "#34d399", fontWeight: 700 }}>0</span>
          </div>
        </div>
      </div>

      <div style={styles.attestDetails}>
        <AttestRow k="Wallet" v={`${wallet.slice(0, 8)}…${wallet.slice(-8)}`} />
        <AttestRow
          k="PDA"
          v={
            <a href={explorerPda} target="_blank" rel="noreferrer" style={styles.attestLink}>
              {attestation.pdaAddress.slice(0, 8)}…{attestation.pdaAddress.slice(-8)} ↗
            </a>
          }
        />
        <AttestRow
          k="Tx"
          v={
            <a href={explorerTx} target="_blank" rel="noreferrer" style={styles.attestLink}>
              {attestation.txSignature.slice(0, 8)}…{attestation.txSignature.slice(-8)} ↗
            </a>
          }
        />
        <AttestRow k="Valid for" v="30 days" />
        {attestation.claim?.loanContractsCount !== undefined && (
          <AttestRow k="Loans" v={String(attestation.claim.loanContractsCount)} />
        )}
        {attestation.claim?.loanCount !== undefined && (
          <AttestRow k="Loans" v={String(attestation.claim.loanCount)} />
        )}
        {attestation.claim?.debtAmountTotal !== undefined && (
          <AttestRow k="Debt" v={`${attestation.claim.debtAmountTotal.toFixed(2)} EUR`} />
        )}
      </div>

      <div style={styles.nextStep}>
        Your wallet now has a local Solana PDA proving the verifier accepted a
        Vero Positive Credit Register claim with zero risk flags.
      </div>
    </div>
  );
}

function AttestRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={styles.attestRow}>
      <span style={styles.attestKey}>{k}</span>
      <span style={styles.attestVal}>{v}</span>
    </div>
  );
}

function PrereqCard({ mode }: { mode: Mode }) {
  const common: [string, string][] = [
    ["Phantom Wallet", "Connected, and (if localnet) set to Custom RPC http://127.0.0.1:8899"],
    ["Local Validator", "solana-test-validator running with the program deployed"],
    ["Verifier Server", "node server running on :3001"],
    ["SOL Balance", "Verifier keypair airdropped — 2 SOL is plenty on localnet"],
  ];
  const prod: [string, string][] = [
    ["Capture Extension", "Load unpacked from vero-proof-extension/"],
    ["Strong ID", "Finnish online banking / mobile certificate for Suomi.fi"],
    ["Vero access", "Personal e-service loan information page"],
  ];
  const rows = mode === "PROD" ? [...common, ...prod] : common;

  return (
    <div style={styles.prereqCard}>
      <div style={styles.prereqTitle}>// Prerequisites ({mode})</div>
      <div style={styles.prereqList}>
        {rows.map(([k, v]) => (
          <div key={k} style={styles.prereqRow}>
            <span style={styles.prereqKey}>{k}</span>
            <span style={styles.prereqVal}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#071018",
    color: "#e7eef3",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    position: "relative",
  },
  gridBg: {
    position: "fixed",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(94,234,212,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,.035) 1px, transparent 1px), linear-gradient(180deg, rgba(20,184,166,.08), rgba(15,23,42,0) 34%)",
    backgroundSize: "40px 40px",
    pointerEvents: "none",
  },
  container: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "40px 20px 80px",
    position: "relative",
    zIndex: 1,
  },
  header: { marginBottom: 36 },
  flagRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  flag: { fontSize: 28 },
  flagLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: "#5eead4",
  },
  h1: {
    fontSize: "clamp(26px, 5vw, 42px)",
    fontWeight: 760,
    lineHeight: 1.1,
    letterSpacing: 0,
    background: "linear-gradient(135deg, #e7fff8, #5eead4 48%, #60a5fa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    marginBottom: 12,
  },
  subtitle: { color: "#91a7b8", fontSize: 15, maxWidth: 600, lineHeight: 1.55 },
  netPill: {
    marginTop: 14,
    display: "inline-block",
    fontFamily: "monospace",
    fontSize: 11,
    color: "#9fb6c8",
    padding: "6px 12px",
    background: "rgba(8, 18, 29, .82)",
    border: "1px solid #223a54",
    borderRadius: 999,
  },

  flow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 32,
    overflowX: "auto",
    padding: "4px 0",
  },
  flowStep: {
    minWidth: 90,
    background: "linear-gradient(180deg, #0f1b2b, #0a1320)",
    border: "1px solid #203650",
    borderRadius: 10,
    padding: "12px 10px",
    textAlign: "center",
    flexShrink: 0,
    boxShadow: "0 10px 26px rgba(0,0,0,.18)",
  },
  flowLabel: { fontSize: 11, fontWeight: 760, color: "#5eead4", marginTop: 6 },
  flowSub: { fontSize: 10, color: "#5f7285", marginTop: 2 },
  flowArrow: { color: "#284663", fontSize: 16, flexShrink: 0 },

  card: {
    background: "rgba(12, 22, 35, .94)",
    border: "1px solid #213852",
    borderRadius: 16,
    padding: 32,
    marginBottom: 20,
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 22px 70px rgba(0, 0, 0, .32)",
  },
  walletRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  sectionLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#5eead4",
    letterSpacing: 1,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 14,
  },
  divider: { borderTop: "1px solid #20344c", margin: "24px 0" },

  modeRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 16,
  },
  modeBtn: {
    background: "#09131f",
    border: "1px solid #213852",
    borderRadius: 10,
    padding: "12px 14px",
    color: "#9fb1c3",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "border-color .15s ease, background .15s ease, transform .15s ease",
  },
  modeBtnActive: {
    borderColor: "#5eead4",
    color: "#f4fffb",
    background: "linear-gradient(180deg, rgba(20,184,166,.16), rgba(14,165,233,.08))",
  },
  modeSub: { fontSize: 11, color: "#71869a", marginTop: 3, fontFamily: "monospace" },

  infoBox: {
    background: "#08131d",
    border: "1px solid #1f344d",
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
    marginTop: 8,
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 0",
    borderBottom: "1px solid #122238",
    fontSize: 13,
  },
  infoKey: { color: "#748aa0", fontFamily: "monospace", whiteSpace: "nowrap" },
  infoVal: { color: "#b7c8d8", textAlign: "right" },

  prodPanel: {
    background: "#08131d",
    border: "1px dashed #33506d",
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    fontSize: 13,
    color: "#a9b9c8",
  },
  prodHead: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#a7f3d0",
    letterSpacing: 1,
    marginBottom: 10,
  },
  prodSteps: { margin: "10px 0", paddingLeft: 22, lineHeight: 1.7 },
  notaryBox: {
    background: "#0d1a29",
    border: "1px solid #223b55",
    borderRadius: 8,
    padding: 10,
    margin: "6px 0 10px",
  },
  proofTextarea: {
    width: "100%",
    padding: 10,
    fontFamily: "monospace",
    fontSize: 11,
    background: "#0a0e1a",
    color: "#cbd5e1",
    border: "1px solid #1e2d45",
    borderRadius: 8,
    resize: "vertical",
  },

  proveBtn: {
    width: "100%",
    padding: "14px 24px",
    background: "linear-gradient(135deg, #0f766e, #0ea5e9 58%, #4f46e5)",
    border: "none",
    borderRadius: 10,
    color: "#fff",
    fontSize: 15,
    fontWeight: 760,
    cursor: "pointer",
    letterSpacing: 0,
    boxShadow: "0 14px 34px rgba(14,165,233,.22)",
  },

  statusBadge: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    border: "1px solid",
    borderRadius: 8,
    fontSize: 14,
  },

  progressCard: {
    background: "#08131d",
    border: "1px solid #24527a",
    borderRadius: 10,
    padding: 18,
    marginTop: 14,
  },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: "monospace",
    fontSize: 11,
    marginBottom: 8,
    color: "#7f93a7",
  },
  spinner: {
    animation: "spin 1s linear infinite",
    display: "inline-block",
    color: "#5eead4",
  },
  progressBar: {
    height: 4,
    background: "#1d344c",
    borderRadius: 2,
    marginTop: 14,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #5eead4, #38bdf8)",
    borderRadius: 2,
    transition: "width 0.5s ease",
  },

  errorBox: {
    display: "flex",
    gap: 12,
    padding: 16,
    background: "rgba(239,68,68,0.06)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 10,
    color: "#fca5a5",
    fontSize: 14,
    alignItems: "flex-start",
    marginTop: 14,
  },

  successCard: {
    background: "linear-gradient(180deg, rgba(16,185,129,.14), rgba(8,19,29,.96))",
    border: "1px solid rgba(52,211,153,0.42)",
    borderRadius: 12,
    padding: 20,
    marginTop: 14,
    boxShadow: "0 18px 52px rgba(16,185,129,.14)",
  },
  successHeader: { display: "flex", gap: 14, alignItems: "center", marginBottom: 16 },
  attestDetails: {
    background: "#07111b",
    border: "1px solid #17324a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  attestRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "5px 0",
    fontSize: 12,
    borderBottom: "1px solid #142235",
  },
  attestKey: { color: "#748aa0", fontFamily: "monospace" },
  attestVal: { color: "#b6c7d8", fontFamily: "monospace" },
  attestLink: {
    color: "#67e8f9",
    textDecoration: "none",
    fontFamily: "monospace",
  },
  nextStep: {
    fontSize: 13,
    color: "#8ea4b7",
    background: "#0c1726",
    padding: 12,
    borderRadius: 8,
    lineHeight: 1.5,
  },

  connectPrompt: {
    textAlign: "center",
    color: "#61778a",
    fontSize: 14,
    padding: "20px 0",
  },

  prereqCard: {
    background: "rgba(8, 19, 29, .92)",
    border: "1px solid #213852",
    borderRadius: 12,
    padding: 20,
  },
  prereqTitle: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#c4b5fd",
    letterSpacing: 2,
    marginBottom: 12,
  },
  prereqList: { display: "flex", flexDirection: "column", gap: 8 },
  prereqRow: { display: "flex", gap: 16, alignItems: "flex-start" },
  prereqKey: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#5eead4",
    minWidth: 130,
    flexShrink: 0,
  },
  prereqVal: { fontSize: 13, color: "#7d91a4" },
};
