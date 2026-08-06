/**
 * FnB Cost Pro Extension — Service Worker (Manifest V3)
 *
 * ONLY this context makes authenticated calls to the FnB API.
 * Content scripts and the popup communicate via chrome.runtime.sendMessage().
 * The bearer token is stored in chrome.storage.local and NEVER forwarded
 * to content scripts.
 *
 * Storage keys:
 *   fnb_installation_id  — persistent random UUID generated on first startup
 *   fnb_token            — { token, tokenId, expiresAt } — extension bearer
 *   fnb_active_job       — { jobId, connectorId, externalSupplierId, ... }
 *   fnb_pending_batches  — array of { syncJobId, batchId, payload } awaiting upload
 */

// ─── FnB API base (swapped by build for production) ──────────────────────────
const FNB_API = "https://app.fnbcostpro.com/api/extension";
// For local dev: const FNB_API = "http://localhost:5000/api/extension";

// ─── Installation ID ──────────────────────────────────────────────────────────

async function getInstallationId() {
  const stored = await chrome.storage.local.get("fnb_installation_id");
  if (stored.fnb_installation_id) return stored.fnb_installation_id;

  // Generate a persistent random UUID on first run
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ fnb_installation_id: id });
  return id;
}

// ─── Token management ─────────────────────────────────────────────────────────

async function getToken() {
  const stored = await chrome.storage.local.get("fnb_token");
  const t = stored.fnb_token;
  if (!t) return null;
  if (new Date() >= new Date(t.expiresAt)) {
    await chrome.storage.local.remove("fnb_token");
    return null;
  }
  return t;
}

async function saveToken(data) {
  await chrome.storage.local.set({ fnb_token: data });
}

async function clearToken() {
  await chrome.storage.local.remove(["fnb_token", "fnb_active_job"]);
}

// ─── FnB API helpers ──────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const t = await getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
  if (t) headers["Authorization"] = `Bearer ${t.token}`;

  const res = await fetch(`${FNB_API}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

// ─── Pairing ──────────────────────────────────────────────────────────────────

async function claimPairingCode(code) {
  const installationId = await getInstallationId();
  const body = await apiFetch("/pair-code/claim", {
    method: "POST",
    body: JSON.stringify({ code, installationId }),
  });
  await saveToken(body.data);
  return body.data;
}

// ─── Sync job discovery ───────────────────────────────────────────────────────

async function fetchActiveJob() {
  try {
    const body = await apiFetch("/sync-jobs/active");
    const job = body.data;
    await chrome.storage.local.set({ fnb_active_job: job });
    return job;
  } catch (err) {
    if (err.status === 404) {
      await chrome.storage.local.remove("fnb_active_job");
      return null;
    }
    throw err;
  }
}

// ─── Event reporting ──────────────────────────────────────────────────────────

async function sendJobEvent(jobId, event, detail) {
  await apiFetch(`/sync-jobs/${jobId}/events`, {
    method: "POST",
    body: JSON.stringify({ event, ...(detail ? { detail } : {}) }),
  });
}

// ─── Batch persistence + upload ───────────────────────────────────────────────

async function persistBatch(syncJobId, batchId, payload) {
  const stored = await chrome.storage.local.get("fnb_pending_batches");
  const batches = stored.fnb_pending_batches ?? [];
  // Avoid duplicates
  const exists = batches.find((b) => b.syncJobId === syncJobId && b.batchId === batchId);
  if (!exists) {
    batches.push({ syncJobId, batchId, payload, savedAt: new Date().toISOString() });
    await chrome.storage.local.set({ fnb_pending_batches: batches });
  }
}

async function uploadBatch(syncJobId, batchId, payload) {
  const body = await apiFetch(`/sync-jobs/${syncJobId}/ingest`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // Remove from pending queue on success
  const stored = await chrome.storage.local.get("fnb_pending_batches");
  const batches = (stored.fnb_pending_batches ?? []).filter(
    (b) => !(b.syncJobId === syncJobId && b.batchId === batchId)
  );
  await chrome.storage.local.set({ fnb_pending_batches: batches });
  return body.data;
}

/** Re-attempt any batches that survived a worker restart. */
async function flushPendingBatches() {
  const t = await getToken();
  if (!t) return;

  const stored = await chrome.storage.local.get("fnb_pending_batches");
  const batches = stored.fnb_pending_batches ?? [];
  for (const b of batches) {
    try {
      await uploadBatch(b.syncJobId, b.batchId, b.payload);
      console.log(`[FnB SW] Flushed pending batch ${b.batchId} for job ${b.syncJobId}`);
    } catch (err) {
      console.warn(`[FnB SW] Retry failed for batch ${b.batchId}:`, err.message);
    }
  }
}

// ─── Message handler (content script / popup → service worker) ───────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    // ── Popup: claim a pairing code ──────────────────────────────────────────
    case "CLAIM_CODE": {
      const result = await claimPairingCode(msg.code);
      return { ok: true, data: result };
    }

    // ── Popup / content: get current token status ────────────────────────────
    case "GET_STATUS": {
      const t   = await getToken();
      const stored = await chrome.storage.local.get("fnb_active_job");
      return {
        ok:           true,
        paired:       !!t,
        tokenId:      t?.tokenId ?? null,
        activeJob:    stored.fnb_active_job ?? null,
        installationId: await getInstallationId(),
      };
    }

    // ── Content script: fetch active sync job (token stays in SW) ───────────
    case "FETCH_ACTIVE_JOB": {
      const job = await fetchActiveJob();
      return { ok: true, job };
    }

    // ── Content script: report a lifecycle event ─────────────────────────────
    case "SEND_EVENT": {
      await sendJobEvent(msg.jobId, msg.event, msg.detail);
      return { ok: true };
    }

    // ── Content script: submit captured batch ────────────────────────────────
    case "SUBMIT_BATCH": {
      const { syncJobId, batchId, payload } = msg;
      // Persist locally BEFORE attempting upload (survive SW restarts)
      await persistBatch(syncJobId, batchId, payload);
      const result = await uploadBatch(syncJobId, batchId, payload);
      return { ok: true, data: result };
    }

    // ── Popup: disconnect / revoke token ─────────────────────────────────────
    case "DISCONNECT": {
      const t = await getToken();
      if (t?.tokenId) {
        await apiFetch(`/tokens/${t.tokenId}/revoke`, { method: "POST" }).catch(() => {});
      }
      await clearToken();
      return { ok: true };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// ─── On startup: flush any pending batches from previous session ──────────────

chrome.runtime.onStartup.addListener(flushPendingBatches);
chrome.runtime.onInstalled.addListener(async () => {
  await getInstallationId(); // ensure ID is generated on install
  await flushPendingBatches();
});
