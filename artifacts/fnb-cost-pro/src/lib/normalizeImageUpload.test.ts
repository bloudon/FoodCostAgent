import { describe, expect, it } from "vitest";
import { isHeicFile } from "./normalizeImageUpload";

describe("isHeicFile", () => {
  it.each([
    { name: "IMG_1234.HEIC", type: "image/heic" },
    { name: "receipt.heif", type: "" },
    { name: "live.heic", type: "image/heic-sequence" },
  ])("recognizes iPhone image input %#", (file) => {
    expect(isHeicFile(file)).toBe(true);
  });

  it("does not convert existing browser-compatible images", () => {
    expect(isHeicFile({ name: "receipt.jpg", type: "image/jpeg" })).toBe(false);
    expect(isHeicFile({ name: "menu.png", type: "image/png" })).toBe(false);
  });
});