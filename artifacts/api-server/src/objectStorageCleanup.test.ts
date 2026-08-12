/**
 * Tests for the parsePositiveHours() configuration helper in
 * objectStorageCleanup.ts.  Covers defaults, valid values, invalid strings,
 * zero/negative, below-minimum, above-maximum, and Infinity-overflow cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parsePositiveHours } from "./objectStorageCleanup";

describe("parsePositiveHours", () => {
  const ENV_KEY = "TEST_CLEANUP_HOURS";

  beforeEach(() => {
    delete process.env[ENV_KEY];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[ENV_KEY];
  });

  it("returns the default when the variable is absent", () => {
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the default when the variable is an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the default when the variable is whitespace only", () => {
    process.env[ENV_KEY] = "   ";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the parsed value for a valid integer string", () => {
    process.env[ENV_KEY] = "12";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(12);
  });

  it("returns the parsed value for a valid fractional string", () => {
    process.env[ENV_KEY] = "0.5";
    expect(parsePositiveHours(ENV_KEY, 6, 0.5, 596)).toBe(0.5);
  });

  it("warns and returns default for a non-numeric string", () => {
    process.env[ENV_KEY] = "invalid";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for zero", () => {
    process.env[ENV_KEY] = "0";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for a negative value", () => {
    process.env[ENV_KEY] = "-5";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for Infinity string", () => {
    process.env[ENV_KEY] = "Infinity";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for a value that overflows to Infinity in ms", () => {
    // 1e308 * 3_600_000 = Infinity — should be rejected
    process.env[ENV_KEY] = "1e308";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and clamps to minimum when below minValue", () => {
    process.env[ENV_KEY] = "0.1";
    expect(parsePositiveHours(ENV_KEY, 6, 0.5, 596)).toBe(0.5);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and clamps to maximum when above maxValue", () => {
    process.env[ENV_KEY] = "10000";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(8760);
    expect(console.warn).toHaveBeenCalled();
  });

  it("accepts a value exactly equal to minValue", () => {
    process.env[ENV_KEY] = "1";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a value exactly equal to maxValue", () => {
    process.env[ENV_KEY] = "8760";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(8760);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and returns default for NaN", () => {
    process.env[ENV_KEY] = "NaN";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });
});
