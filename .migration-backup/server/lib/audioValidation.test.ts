/**
 * Unit tests for audioValidation helpers.
 *
 * Coverage:
 *   - validateAudioBuffer: zero-byte buffer → 400 with descriptive message
 *   - validateAudioBuffer: non-empty buffer → null (valid)
 */

import { describe, it, expect } from "vitest";
import { validateAudioBuffer } from "./audioValidation";

describe("validateAudioBuffer", () => {
  it("returns a 400 error for a zero-byte buffer", () => {
    const result = validateAudioBuffer(Buffer.alloc(0));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    // Error message must be user-readable (not 'Internal server error' or similar)
    expect(result!.error).toMatch(/empty|silent|speak/i);
  });

  it("returns null (valid) for a non-empty buffer", () => {
    const result = validateAudioBuffer(Buffer.from("fake-audio-data"));

    expect(result).toBeNull();
  });

  it("returns null for a single-byte buffer (not empty)", () => {
    const result = validateAudioBuffer(Buffer.alloc(1, 0));

    expect(result).toBeNull();
  });

  it("returns a 400 status (not 500) so the client receives a useful message", () => {
    const result = validateAudioBuffer(Buffer.alloc(0));

    expect(result!.status).toBe(400);
    // Confirm it is definitely not a server-error code
    expect(result!.status).not.toBeGreaterThanOrEqual(500);
  });
});
