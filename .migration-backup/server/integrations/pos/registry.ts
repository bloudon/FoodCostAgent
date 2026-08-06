/**
 * Universal POS Connector Registry
 *
 * Single source of truth for:
 *   - which POS providers the app recognises
 *   - their availability (electronic adapter present vs. manual-only)
 *   - their capabilities
 *   - the adapter instance (server-side only; never exposed to the client)
 *
 * Frontend consumers call GET /api/pos/providers, which returns
 * getProviderMetadata() — the public shape without adapter references.
 */
import type { PosConnector } from "./types";
import { squarePosConnector } from "./square";

// ── Capability flags ───────────────────────────────────────────────────────────

export interface PosCapabilities {
  /** Provider supports OAuth-based electronic connection */
  oauth: boolean;
  /** Provider supports catalog/menu-item retrieval */
  catalogRetrieval: boolean;
  /** Provider supports sales data retrieval */
  salesRetrieval: boolean;
  /** Provider supports POS-location → store mapping */
  locationMapping: boolean;
  /** Provider supports catalog-variation → menu-item mapping */
  itemMapping: boolean;
  /** Provider supports historical-data backfill */
  backfill: boolean;
}

// ── Provider definition ────────────────────────────────────────────────────────

export interface PosProviderDefinition {
  providerKey: string;
  displayName: string;
  /**
   * availability:
   *   "available"     — electronic connector is implemented and active
   *   "manual_only"   — recognised provider but no electronic adapter yet
   *   "coming_later"  — on the roadmap, not yet available at all
   */
  availability: "available" | "manual_only" | "coming_later";
  capabilities: PosCapabilities;
  /**
   * Server-side only. Present when availability === "available".
   * Never included in the public metadata returned to the frontend.
   */
  connector?: PosConnector;
}

/** Safe public shape — adapter reference stripped out. */
export type PosProviderPublicMetadata = Omit<PosProviderDefinition, "connector">;

// ── getConnector() return type ─────────────────────────────────────────────────

export type GetConnectorResult =
  | { kind: "available"; connector: PosConnector }
  /** Provider is recognised but has no electronic adapter (manual-only / coming-later). */
  | { kind: "connector_unavailable" }
  /** Provider key is not registered at all. */
  | { kind: "unknown_provider" };

// ── Registry ──────────────────────────────────────────────────────────────────

const NO_CAPABILITIES: PosCapabilities = {
  oauth: false,
  catalogRetrieval: false,
  salesRetrieval: false,
  locationMapping: false,
  itemMapping: false,
  backfill: false,
};

const FULL_CAPABILITIES: PosCapabilities = {
  oauth: true,
  catalogRetrieval: true,
  salesRetrieval: true,
  locationMapping: true,
  itemMapping: true,
  backfill: true,
};

const posProviderRegistry = new Map<string, PosProviderDefinition>([
  // ── Electronically supported ──────────────────────────────────────────────
  [
    "square",
    {
      providerKey: "square",
      displayName: "Square",
      availability: "available",
      capabilities: FULL_CAPABILITIES,
      connector: squarePosConnector,
    },
  ],

  // ── Recognised providers — manual upload only ─────────────────────────────
  [
    "thrive",
    {
      providerKey: "thrive",
      displayName: "Thrive (The Chef's Companion)",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
  [
    "toast",
    {
      providerKey: "toast",
      displayName: "Toast",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
  [
    "hungerrush",
    {
      providerKey: "hungerrush",
      displayName: "HungerRush",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
  [
    "clover",
    {
      providerKey: "clover",
      displayName: "Clover",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
  [
    "spoton",
    {
      providerKey: "spoton",
      displayName: "SpotOn",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
  [
    "other",
    {
      providerKey: "other",
      displayName: "Other",
      availability: "manual_only",
      capabilities: NO_CAPABILITIES,
    },
  ],
]);

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Resolve a registered connector adapter.
 *
 * Returns a typed discriminated union so callers can handle all three cases:
 *   - { kind: "available", connector }     — adapter is ready to use
 *   - { kind: "connector_unavailable" }    — provider known but manual-only
 *   - { kind: "unknown_provider" }         — providerKey not in the registry
 *
 * Never throws.
 */
export function getConnector(providerKey: string): GetConnectorResult {
  const def = posProviderRegistry.get(providerKey);
  if (!def) return { kind: "unknown_provider" };
  if (def.availability !== "available" || !def.connector) {
    return { kind: "connector_unavailable" };
  }
  return { kind: "available", connector: def.connector };
}

/**
 * Full definition including the adapter reference.
 * Server-side only — never send this to the client.
 */
export function getProviderDefinition(
  providerKey: string,
): PosProviderDefinition | undefined {
  return posProviderRegistry.get(providerKey);
}

/**
 * Public metadata list — connector references stripped.
 * Safe to return directly from GET /api/pos/providers.
 */
export function getProviderMetadata(): PosProviderPublicMetadata[] {
  return Array.from(posProviderRegistry.values()).map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ connector: _connector, ...rest }) => rest,
  );
}

/**
 * True if the providerKey is in the registry AND has availability === "available"
 * AND the provider's capabilities include salesRetrieval.
 * Used by company PATCH validation.
 */
export function providerSupportsElectronic(providerKey: string): boolean {
  const def = posProviderRegistry.get(providerKey);
  return (
    !!def &&
    def.availability === "available" &&
    !!def.connector &&
    def.capabilities.salesRetrieval
  );
}

/**
 * True if the providerKey is in the registry (regardless of availability).
 * Used to distinguish "unknown key" from "known manual-only provider".
 */
export function isKnownProvider(providerKey: string): boolean {
  return posProviderRegistry.has(providerKey);
}
