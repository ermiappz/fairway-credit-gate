(() => {
  const SOURCE = "fairway-vero-proof-capture";
  const VERIFIER_URL = "http://localhost:3001";

  let latestCapture = null;
  let activeSession = null;
  let statusText = "Waiting for app session";
  let overlay;
  let button;
  let status;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE) return;
    latestCapture = event.data.payload;
    statusText = "Vero /loans response captured";
    render();
  });

  async function loadActiveSession() {
    try {
      const response = await fetch(`${VERIFIER_URL}/proof-session/active`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "No session");
      activeSession = data.session;
      statusText =
        activeSession.status === "done"
          ? "Attestation already published"
          : "Proof session connected";
    } catch {
      statusText = "Open the dApp and click Start Vero Proof Session";
    }
    render();
  }

  async function publishProof() {
    if (!activeSession) {
      statusText = "No active dApp session";
      render();
      return;
    }
    if (!latestCapture) {
      statusText = "Open Loan information and wait for /loans";
      render();
      return;
    }

    button.disabled = true;
    statusText = "Publishing Solana attestation...";
    render();

    try {
      const response = await fetch(`${VERIFIER_URL}/capture-vero-loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession.id,
          ...latestCapture,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Publish failed");
      activeSession = data.session;
      statusText = "Published. Close this tab and return to the dApp.";
    } catch (error) {
      statusText = error.message || String(error);
      button.disabled = false;
    }
    render();
  }

  function render() {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:2147483647",
        "width:330px",
        "font-family:Inter,Arial,sans-serif",
        "background:#07111f",
        "color:#e5f4ff",
        "border:1px solid #38bdf8",
        "border-radius:10px",
        "box-shadow:0 16px 40px rgba(0,0,0,.35)",
        "padding:14px",
      ].join(";");

      const title = document.createElement("div");
      title.textContent = "Fairway Vero Proof";
      title.style.cssText = "font-weight:800;font-size:15px;margin-bottom:6px;color:#38bdf8";

      status = document.createElement("div");
      status.style.cssText = "font-size:13px;line-height:1.35;color:#bfd7ea;margin-bottom:12px";

      button = document.createElement("button");
      button.textContent = "Create debt-free proof";
      button.style.cssText = [
        "width:100%",
        "border:0",
        "border-radius:8px",
        "background:linear-gradient(135deg,#0369a1,#7c3aed)",
        "color:#fff",
        "font-weight:800",
        "padding:11px 12px",
        "cursor:pointer",
      ].join(";");
      button.addEventListener("click", publishProof);

      const hint = document.createElement("div");
      hint.textContent = "Go to Loan information, wait for capture, then publish.";
      hint.style.cssText = "font-size:11px;line-height:1.35;color:#7891a8;margin-top:9px";

      overlay.append(title, status, button, hint);
      document.documentElement.appendChild(overlay);
    }

    status.textContent = statusText;
    button.disabled = !activeSession || !latestCapture || activeSession.status === "done";
    button.style.opacity = button.disabled ? ".55" : "1";
    button.style.cursor = button.disabled ? "not-allowed" : "pointer";
  }

  render();
  loadActiveSession();
  window.setInterval(loadActiveSession, 5000);
})();
