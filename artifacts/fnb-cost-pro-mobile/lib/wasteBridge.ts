/**
 * Versioned bridge contract between the native app and the wrapped Waste page.
 *
 * Handshake (mandatory):
 *   1. Web page loads and posts FNB_WASTE_BRIDGE_READY (web → native).
 *   2. Native sends FNB_WASTE_DRAFT (native → web) with the voice draft.
 *   3. Web acks with FNB_WASTE_DRAFT_RECEIVED — only then is handoff successful.
 *   4. Later the web posts FNB_WASTE_CREATED / FNB_WASTE_CANCELLED / FNB_WASTE_ERROR.
 *
 * Every message carries `version` and `requestId`; responses echo the requestId
 * of the draft they refer to. The native side clears a draft only after
 * FNB_WASTE_CREATED or explicit user cancellation.
 *
 * Full contract with JSON examples: docs/waste-voice-bridge.md
 */

export const WASTE_BRIDGE_VERSION = 1;

export type WasteReasonCode =
  | "SPOILED"
  | "DAMAGED"
  | "OVERPRODUCTION"
  | "DROPPED"
  | "CUSTOMER_COMPLAINT"
  | "QUALITY"
  | "OTHER";

export interface VoiceWasteEntry {
  spokenItem: string;
  wasteType: "inventory" | "menu_item" | null;
  qty: number | null;
  spokenUnit: string | null;
  reasonCode: WasteReasonCode | null;
  notes: string | null;
}

export interface WasteDraft {
  /** Server-issued requestId from /voice/waste/interpret — used for dedupe. */
  requestId: string;
  storeId: string;
  transcript: string;
  entries: VoiceWasteEntry[];
}

// ---- Message types --------------------------------------------------------

export type WebToNativeMessage =
  | { type: "FNB_WASTE_BRIDGE_READY"; version: number; requestId: string | null }
  | { type: "FNB_WASTE_DRAFT_RECEIVED"; version: number; requestId: string }
  | {
      type: "FNB_WASTE_CREATED";
      version: number;
      requestId: string;
      payload: { createdWasteLogIds: string[]; createdCount: number };
    }
  | { type: "FNB_WASTE_CANCELLED"; version: number; requestId: string }
  | {
      type: "FNB_WASTE_ERROR";
      version: number;
      requestId: string;
      payload: { code: string; message: string };
    };

export interface WasteDraftMessage {
  type: "FNB_WASTE_DRAFT";
  version: number;
  requestId: string;
  payload: {
    storeId: string;
    transcript: string;
    entries: VoiceWasteEntry[];
  };
}

export function buildDraftMessage(draft: WasteDraft): WasteDraftMessage {
  return {
    type: "FNB_WASTE_DRAFT",
    version: WASTE_BRIDGE_VERSION,
    requestId: draft.requestId,
    payload: {
      storeId: draft.storeId,
      transcript: draft.transcript,
      entries: draft.entries,
    },
  };
}

/**
 * Strictly validate an incoming bridge message. Malformed messages (wrong
 * shape, missing payload fields) return null and are ignored — a hostile or
 * buggy page must not be able to crash the native flow.
 */
export function parseWebMessage(raw: string): WebToNativeMessage | null {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    msg = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof msg.type !== "string" || typeof msg.version !== "number") return null;
  const version = msg.version;
  const requestId = msg.requestId;
  const payload = msg.payload as Record<string, unknown> | undefined;

  switch (msg.type) {
    case "FNB_WASTE_BRIDGE_READY":
      return {
        type: "FNB_WASTE_BRIDGE_READY",
        version,
        requestId: typeof requestId === "string" ? requestId : null,
      };
    case "FNB_WASTE_DRAFT_RECEIVED":
    case "FNB_WASTE_CANCELLED": {
      if (typeof requestId !== "string") return null;
      return { type: msg.type, version, requestId };
    }
    case "FNB_WASTE_CREATED": {
      if (typeof requestId !== "string") return null;
      const ids = Array.isArray(payload?.createdWasteLogIds)
        ? (payload!.createdWasteLogIds as unknown[]).filter(
            (id): id is string => typeof id === "string"
          )
        : [];
      const count =
        typeof payload?.createdCount === "number" && Number.isFinite(payload.createdCount)
          ? payload.createdCount
          : ids.length;
      return {
        type: "FNB_WASTE_CREATED",
        version,
        requestId,
        payload: { createdWasteLogIds: ids, createdCount: count },
      };
    }
    case "FNB_WASTE_ERROR": {
      if (typeof requestId !== "string") return null;
      return {
        type: "FNB_WASTE_ERROR",
        version,
        requestId,
        payload: {
          code: typeof payload?.code === "string" ? payload.code : "UNKNOWN",
          message:
            typeof payload?.message === "string"
              ? payload.message
              : "The Waste page reported an error.",
        },
      };
    }
    default:
      return null;
  }
}

// ---- In-memory draft store (module singleton) ------------------------------
// Drafts never travel through query strings; they are held here and delivered
// over the bridge. The draft survives navigation and is cleared only on
// FNB_WASTE_CREATED or explicit cancel.
//
// Delivery ("acked") state is intentionally NOT tracked here: it is scoped to
// a single live page session inside the WebView screen. A retained draft must
// be re-sent after any page reload/retry — the web side dedupes by requestId.

let currentDraft: WasteDraft | null = null;

export function setWasteDraft(draft: WasteDraft): void {
  currentDraft = draft;
}

export function getWasteDraft(): WasteDraft | null {
  return currentDraft;
}

export function clearWasteDraft(): void {
  currentDraft = null;
}
