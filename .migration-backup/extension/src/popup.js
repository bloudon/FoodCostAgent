/**
 * FnB Cost Pro — Popup Script
 * Communicates with the service worker via chrome.runtime.sendMessage.
 * Does NOT read or write chrome.storage directly for credentials.
 */

const viewUnpaired   = document.getElementById("view-unpaired");
const viewPaired     = document.getElementById("view-paired");
const codeInput      = document.getElementById("code-input");
const btnPair        = document.getElementById("btn-pair");
const pairMsg        = document.getElementById("pair-msg");
const pairedBadge    = document.getElementById("paired-badge");
const jobDetail      = document.getElementById("job-detail");
const btnDisconnect  = document.getElementById("btn-disconnect");
const disconnectMsg  = document.getElementById("disconnect-msg");

function toSW(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error)          return reject(new Error(response.error));
      resolve(response);
    });
  });
}

function showMsg(el, text, isError = true) {
  el.textContent   = text;
  el.className     = isError ? "msg-error" : "msg-success";
  el.style.display = text ? "block" : "none";
}

function showView(paired) {
  viewUnpaired.style.display = paired ? "none"  : "block";
  viewPaired.style.display   = paired ? "block" : "none";
}

function renderJobDetail(job) {
  if (!job) { jobDetail.style.display = "none"; return; }
  jobDetail.style.display = "block";
  const status = job.status ?? "PENDING";
  const supplier = job.externalSupplierName ?? job.externalSupplierId ?? "";
  jobDetail.innerHTML = `
    <strong>Active Job</strong><br>
    Status: ${status}<br>
    ${supplier ? `Supplier: ${supplier}` : ""}
    ${job.captureWarning ? `<br><span style="color:#fbbf24">⚠ ${job.captureWarning}</span>` : ""}
  `;
}

// ── Pair ──────────────────────────────────────────────────────────────────────

btnPair.addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 6) { showMsg(pairMsg, "Code too short"); return; }

  btnPair.disabled  = true;
  btnPair.textContent = "Connecting…";
  showMsg(pairMsg, "");

  try {
    await toSW({ type: "CLAIM_CODE", code });
    // Fetch active job after pairing
    let job = null;
    try {
      const jr = await toSW({ type: "FETCH_ACTIVE_JOB" });
      job = jr.job;
    } catch (_) {}
    showView(true);
    renderJobDetail(job);
  } catch (err) {
    showMsg(pairMsg, err.message ?? "Failed to connect");
    btnPair.disabled    = false;
    btnPair.textContent = "Connect to FnB";
  }
});

codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnPair.click();
});

// ── Disconnect ────────────────────────────────────────────────────────────────

btnDisconnect.addEventListener("click", async () => {
  btnDisconnect.disabled = true;
  try {
    await toSW({ type: "DISCONNECT" });
    showMsg(disconnectMsg, "Disconnected.", false);
    setTimeout(() => showView(false), 1200);
  } catch (err) {
    showMsg(disconnectMsg, err.message ?? "Failed to disconnect");
    btnDisconnect.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const status = await toSW({ type: "GET_STATUS" });
    if (status.paired) {
      let job = status.activeJob;
      if (!job) {
        try {
          const jr = await toSW({ type: "FETCH_ACTIVE_JOB" });
          job = jr.job;
        } catch (_) {}
      }
      showView(true);
      renderJobDetail(job);
    } else {
      showView(false);
    }
  } catch (err) {
    showView(false);
  }
})();
