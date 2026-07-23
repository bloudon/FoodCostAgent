/**
 * FnB Cost Pro — Cut+Dry Content Script  (parser v0.1.0)
 *
 * Runs on https://*.cutanddry.com/* at document_idle.
 *
 * Responsibilities:
 *   - Detect authenticated session and current supplier context
 *   - Show FnB overlay UI when a sync job is active
 *   - Capture catalog rows across pagination and lazy-loaded sections
 *   - Send captured data to the service worker (NEVER calls FnB API directly)
 *
 * Security:
 *   - NEVER reads the bearer token from storage
 *   - All FnB API calls go through chrome.runtime.sendMessage() to the SW
 *   - NEVER modifies Cut+Dry DOM for carts, orders, or quantities
 */

const PARSER_VERSION    = "0.1.0";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

// ─── State ────────────────────────────────────────────────────────────────────

let activeJob      = null;
let overlayMounted = false;
let capturing      = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSW(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error)          return reject(new Error(response.error));
      resolve(response);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detect that the user appears authenticated (session elements present). */
function isAuthenticated() {
  return !!(
    document.querySelector('[data-testid="user-menu"]') ||
    document.querySelector(".user-avatar") ||
    document.querySelector("[class*='userMenu']") ||
    document.querySelector("[class*='accountMenu']") ||
    document.querySelector("nav [class*='profile']")
  );
}

/** Extract the supplier name/id visible in the current page context. */
function detectVisibleSupplier() {
  const el =
    document.querySelector("[data-supplier-id]") ||
    document.querySelector("[data-testid='supplier-name']") ||
    document.querySelector("[class*='supplierName']") ||
    document.querySelector("[class*='vendorName']");
  return {
    id:   el?.dataset?.supplierId ?? null,
    name: el?.textContent?.trim() ?? document.title ?? null,
  };
}

/** Read the portal's stated total row count if the UI exposes it. */
function readExpectedRowCount() {
  const el = document.querySelector(
    "[data-testid='item-count'], [class*='totalCount'], [class*='itemCount']"
  );
  if (!el) return null;
  const n = parseInt(el.textContent.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

// ─── Row capture ──────────────────────────────────────────────────────────────

/** Parse a single product row element into a CapturedItem. */
function parseRow(row) {
  const getText = (sel) => row.querySelector(sel)?.textContent?.trim() ?? null;
  const getAttr = (sel, attr) => row.querySelector(sel)?.getAttribute(attr) ?? null;

  const sku =
    getAttr("[data-sku]",        "data-sku")  ||
    getAttr("[data-product-id]", "data-product-id") ||
    getText("[class*='sku'], [class*='itemNumber'], [data-testid='sku']");

  if (!sku) return null;

  const description =
    getText("[class*='productName'], [class*='itemName'], [data-testid='product-name']") ??
    getText("[class*='description']") ?? "";

  const packSize =
    getText("[class*='packSize'], [class*='pack-size'], [data-testid='pack-size']") ??
    getText("[class*='uom'], [class*='unit']");

  const rawCasePrice =
    getText("[data-testid='case-price'], [class*='casePrice'], [class*='case-price']") ??
    getText("[class*='price']:first-of-type");

  const rawUnitPrice =
    getText("[data-testid='unit-price'], [class*='unitPrice'], [class*='unit-price']");

  const sourceItemId =
    getAttr("[data-item-id]", "data-item-id") ??
    getAttr("[data-product-id]", "data-product-id");

  // Detect multiple UOM offers on the same row
  const uomOptions = row.querySelectorAll("[class*='uomOption'], [class*='orderingUnit']");

  return {
    supplierSku:    sku,
    rawDescription: description,
    rawPackSize:    packSize,
    rawCasePrice:   rawCasePrice,
    rawUnitPrice:   rawUnitPrice,
    currency:       "USD",
    priceEffective: null, // only set when portal explicitly shows a date
    sourceItemId,
    _uomOptionCount: uomOptions.length, // internal — used for ambiguity check
  };
}

/** Capture all rows visible in the current DOM. */
function captureVisibleRows() {
  const rowSelectors = [
    "[data-testid='catalog-row']",
    "[class*='catalogRow']",
    "[class*='catalog-row']",
    "[class*='productRow']",
    "[class*='product-row']",
    "tr[data-product-id]",
  ];

  let rows = [];
  for (const sel of rowSelectors) {
    rows = Array.from(document.querySelectorAll(sel));
    if (rows.length > 0) break;
  }
  return rows.map(parseRow).filter(Boolean);
}

/** Scroll the catalog container until no new rows appear (lazy-load support). */
async function scrollToLoadAll(container) {
  let previousCount = 0;
  let stableRounds  = 0;

  while (stableRounds < 3) {
    container.scrollTop = container.scrollHeight;
    await sleep(600);

    const current = captureVisibleRows().length;
    if (current === previousCount) {
      stableRounds++;
    } else {
      stableRounds  = 0;
      previousCount = current;
    }
  }
}

/**
 * Full capture: handles pagination + lazy-loading + multiple pages.
 * Returns { items, paginatedPages, expectedRowCount, visibleRowCount, capturedRowCount }.
 */
async function captureAll() {
  const allItems      = [];
  const seenSkus      = new Set();
  let paginatedPages  = 0;
  const expectedRowCount = readExpectedRowCount();

  // Detect portal-side active filter warning
  const filterActive = !!document.querySelector(
    "[class*='activeFilter'], [class*='filter-active'], [data-testid='filter-badge']"
  );
  if (filterActive) {
    console.warn("[FnB] Portal filter detected — capture may be a subset of the full catalog.");
  }

  // Scroll container to load lazy rows on the first page
  const scrollContainer =
    document.querySelector("[class*='catalogScroll'], [class*='catalog-scroll'], [class*='productList']") ||
    document.scrollingElement;
  if (scrollContainer) await scrollToLoadAll(scrollContainer);

  // Capture initial page
  paginatedPages = 1;
  for (const item of captureVisibleRows()) {
    if (!seenSkus.has(item.supplierSku)) {
      seenSkus.add(item.supplierSku);
      allItems.push(item);
    }
  }

  // Paginate
  while (true) {
    const nextBtn = document.querySelector(
      "[data-testid='next-page']:not([disabled]), [class*='nextPage']:not([disabled]), [aria-label='Next page']:not([disabled])"
    );
    if (!nextBtn) break;

    nextBtn.click();
    await sleep(1200); // wait for page transition
    if (scrollContainer) await scrollToLoadAll(scrollContainer);
    paginatedPages++;

    let newOnPage = 0;
    for (const item of captureVisibleRows()) {
      if (!seenSkus.has(item.supplierSku)) {
        seenSkus.add(item.supplierSku);
        allItems.push(item);
        newOnPage++;
      }
    }
    if (newOnPage === 0) break; // safety: stop if page had no new rows
  }

  // Strip internal fields before sending
  const items = allItems.map(({ _uomOptionCount, ...rest }) => rest);

  return {
    items,
    paginatedPages,
    expectedRowCount,
    visibleRowCount:  seenSkus.size,
    capturedRowCount: items.filter(
      (i) => i.rawCasePrice !== null || i.rawUnitPrice !== null
    ).length,
  };
}

// ─── FnB Overlay UI ──────────────────────────────────────────────────────────

function injectOverlay() {
  if (overlayMounted) return;
  overlayMounted = true;

  const div = document.createElement("div");
  div.id    = "fnb-sync-overlay";
  div.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
    background: #1e293b; color: #f8fafc; border-radius: 10px;
    padding: 16px 20px; font-family: system-ui, sans-serif; font-size: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); min-width: 280px; max-width: 360px;
  `;
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-weight:700;font-size:15px">FnB Cost Pro</span>
      <span id="fnb-status-badge" style="font-size:11px;padding:2px 8px;border-radius:999px;background:#0ea5e9;color:#fff">Ready</span>
    </div>
    <div id="fnb-supplier-line" style="font-size:12px;color:#94a3b8;margin-bottom:10px"></div>
    <button id="fnb-capture-btn" style="
      width:100%;padding:9px 0;border:none;border-radius:6px;cursor:pointer;
      background:#f2690d;color:#fff;font-weight:600;font-size:14px
    ">Start Capture</button>
    <div id="fnb-progress" style="margin-top:10px;font-size:12px;color:#94a3b8;display:none"></div>
    <div id="fnb-warning" style="margin-top:8px;font-size:12px;color:#fbbf24;display:none"></div>
  `;
  document.body.appendChild(div);

  document.getElementById("fnb-capture-btn").addEventListener("click", startCapture);
}

function setOverlayStatus(text, color = "#0ea5e9") {
  const badge = document.getElementById("fnb-status-badge");
  if (badge) { badge.textContent = text; badge.style.background = color; }
}

function setOverlayProgress(text) {
  const el = document.getElementById("fnb-progress");
  if (el) { el.style.display = text ? "block" : "none"; el.textContent = text; }
}

function setOverlayWarning(text) {
  const el = document.getElementById("fnb-warning");
  if (el) { el.style.display = text ? "block" : "none"; el.textContent = text; }
}

// ─── Capture flow ─────────────────────────────────────────────────────────────

async function startCapture() {
  if (capturing)    return;
  if (!activeJob)   { alert("No active FnB sync job found. Create one in FnB first."); return; }
  if (!isAuthenticated()) {
    await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "auth_required" });
    setOverlayStatus("Sign-in required", "#ef4444");
    alert("Please sign in to Cut+Dry first, then try again.");
    return;
  }

  // Verify visible supplier matches job
  const visible = detectVisibleSupplier();
  if (
    activeJob.externalSupplierId &&
    visible.id &&
    activeJob.externalSupplierId !== visible.id
  ) {
    const msg = `Wrong supplier: expected ${activeJob.externalSupplierId}, got ${visible.id}. Navigate to the correct supplier page.`;
    await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "capture_failed", detail: msg });
    setOverlayStatus("Wrong supplier", "#ef4444");
    alert(msg);
    return;
  }

  capturing = true;
  const btn = document.getElementById("fnb-capture-btn");
  if (btn) btn.disabled = true;

  setOverlayStatus("Capturing…", "#8b5cf6");
  await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "capture_started" });
  setOverlayProgress("Scanning pages…");

  try {
    const { items, paginatedPages, expectedRowCount, visibleRowCount, capturedRowCount } =
      await captureAll();

    if (items.length === 0) {
      throw new Error("No products found on this page. Navigate to an order guide or catalog view.");
    }

    const partialCapture = capturedRowCount < visibleRowCount;
    if (partialCapture) {
      setOverlayWarning(
        `Partial capture: ${capturedRowCount} of ${visibleRowCount} rows parsed. Some items may be missing prices.`
      );
    }

    setOverlayProgress(`Sending ${items.length} items to FnB…`);

    const batchId = crypto.randomUUID();
    const payload = {
      batchId,
      extensionVersion: EXTENSION_VERSION,
      parserVersion:    PARSER_VERSION,
      capturedAt:       new Date().toISOString(),
      sourceUrl:        window.location.href,
      capturedExternalSupplierId:   visible.id    ?? activeJob.externalSupplierId,
      capturedExternalSupplierName: visible.name  ?? activeJob.externalSupplierName,
      capturedExternalLocationId:   activeJob.externalLocationId  ?? null,
      capturedExternalOrderGuideId: activeJob.externalOrderGuideId ?? null,
      captureCompleteness: {
        paginatedPages,
        expectedRowCount,
        visibleRowCount,
        capturedRowCount,
      },
      items,
    };

    const result = await toSW({
      type:      "SUBMIT_BATCH",
      syncJobId: activeJob.id,
      batchId,
      payload,
    });

    setOverlayStatus("Complete", "#22c55e");
    setOverlayProgress(
      `Done: ${result.data.itemsUpdated} updated, ${result.data.itemsReview} for review, ${result.data.itemsRejected} rejected.`
    );
    if (partialCapture) setOverlayWarning("Partial capture — check review queue for missing items.");

    // Disable capture button — job is complete
    if (btn) { btn.textContent = "Sync complete"; btn.disabled = true; }

  } catch (err) {
    console.error("[FnB] Capture error:", err);
    await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "capture_failed", detail: err.message });
    setOverlayStatus("Failed", "#ef4444");
    setOverlayProgress(`Error: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = "Retry"; }
  } finally {
    capturing = false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Only show the overlay on catalog/order-guide pages
  const isCatalogPage =
    /\/(catalog|order-guide|products|items)/i.test(window.location.pathname);
  if (!isCatalogPage) return;

  const status = await toSW({ type: "GET_STATUS" });
  if (!status.paired) return; // extension not paired — stay invisible

  // Fetch the active sync job
  const jobResp = await toSW({ type: "FETCH_ACTIVE_JOB" });
  if (!jobResp.job) return; // no active job — nothing to show

  activeJob = jobResp.job;

  if (!isAuthenticated()) {
    await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "auth_required" });
    // Don't show overlay — user needs to log in first
    return;
  }

  injectOverlay();

  // Show supplier context
  const visible = detectVisibleSupplier();
  const supplierLine = document.getElementById("fnb-supplier-line");
  if (supplierLine && visible.name)
    supplierLine.textContent = `Supplier: ${visible.name}`;

  // Report portal opened
  await toSW({ type: "SEND_EVENT", jobId: activeJob.id, event: "portal_opened" });
}

init().catch((err) => console.error("[FnB] Init error:", err));
