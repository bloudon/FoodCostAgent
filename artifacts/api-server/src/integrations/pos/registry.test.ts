/**
 * Tests for the universal POS connector registry — Task #612
 */
import { describe, it, expect } from "vitest";
import {
  getConnector,
  getProviderMetadata,
  getProviderDefinition,
  providerSupportsElectronic,
  isKnownProvider,
} from "./registry";

describe("POS Connector Registry", () => {
  // ── getConnector ──────────────────────────────────────────────────────────

  describe("getConnector", () => {
    it("returns available with connector for Square", () => {
      const result = getConnector("square");
      expect(result.kind).toBe("available");
      if (result.kind === "available") {
        expect(result.connector).toBeDefined();
        expect(result.connector.providerId).toBe("square");
      }
    });

    it("returns connector_unavailable for manual-only providers", () => {
      for (const key of ["toast", "hungerrush", "clover", "spoton", "other"]) {
        const result = getConnector(key);
        expect(result.kind).toBe("connector_unavailable");
      }
    });

    it("returns unknown_provider for unrecognised keys", () => {
      expect(getConnector("micros").kind).toBe("unknown_provider");
      expect(getConnector("").kind).toBe("unknown_provider");
      expect(getConnector("SQUARE").kind).toBe("unknown_provider"); // case-sensitive
    });

    it("never throws for any input", () => {
      expect(() => getConnector("")).not.toThrow();
      expect(() => getConnector("anything")).not.toThrow();
    });
  });

  // ── getProviderMetadata ───────────────────────────────────────────────────

  describe("getProviderMetadata", () => {
    it("includes Square as available", () => {
      const meta = getProviderMetadata();
      const square = meta.find((p) => p.providerKey === "square");
      expect(square).toBeDefined();
      expect(square!.availability).toBe("available");
      expect(square!.capabilities.salesRetrieval).toBe(true);
      expect(square!.capabilities.oauth).toBe(true);
    });

    it("includes known manual-only providers", () => {
      const meta = getProviderMetadata();
      const keys = meta.map((p) => p.providerKey);
      expect(keys).toContain("thrive");
      expect(keys).toContain("toast");
      expect(keys).toContain("hungerrush");
      expect(keys).toContain("clover");
      expect(keys).toContain("spoton");
      expect(keys).toContain("other");
    });

    it("never exposes connector adapter in public metadata", () => {
      const meta = getProviderMetadata();
      for (const provider of meta) {
        expect((provider as any).connector).toBeUndefined();
      }
    });

    it("manual-only providers have oauth: false", () => {
      const meta = getProviderMetadata();
      const manualOnly = meta.filter((p) => p.availability === "manual_only");
      for (const p of manualOnly) {
        expect(p.capabilities.oauth).toBe(false);
        expect(p.capabilities.salesRetrieval).toBe(false);
      }
    });
  });

  // ── getProviderDefinition ─────────────────────────────────────────────────

  describe("getProviderDefinition", () => {
    it("returns definition for Square including connector", () => {
      const def = getProviderDefinition("square");
      expect(def).toBeDefined();
      expect(def!.connector).toBeDefined();
      expect(def!.availability).toBe("available");
    });

    it("returns undefined for unknown keys", () => {
      expect(getProviderDefinition("micros")).toBeUndefined();
    });
  });

  // ── providerSupportsElectronic ────────────────────────────────────────────

  describe("providerSupportsElectronic", () => {
    it("returns true for Square", () => {
      expect(providerSupportsElectronic("square")).toBe(true);
    });

    it("returns false for manual-only providers", () => {
      expect(providerSupportsElectronic("toast")).toBe(false);
      expect(providerSupportsElectronic("hungerrush")).toBe(false);
      expect(providerSupportsElectronic("clover")).toBe(false);
      expect(providerSupportsElectronic("other")).toBe(false);
    });

    it("returns false for unknown providers", () => {
      expect(providerSupportsElectronic("micros")).toBe(false);
      expect(providerSupportsElectronic("")).toBe(false);
    });
  });

  // ── isKnownProvider ───────────────────────────────────────────────────────

  describe("isKnownProvider", () => {
    it("returns true for all registered providers", () => {
      for (const key of ["square", "thrive", "toast", "hungerrush", "clover", "spoton", "other"]) {
        expect(isKnownProvider(key)).toBe(true);
      }
    });

    it("returns false for unregistered keys", () => {
      expect(isKnownProvider("micros")).toBe(false);
      expect(isKnownProvider("")).toBe(false);
    });
  });
});
