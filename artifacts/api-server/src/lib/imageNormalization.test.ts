import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  detectVisionImageMimeType,
  normalizeImageForStorage,
  normalizeImageForVision,
  UnsupportedImageError,
} from "./imageNormalization";

const HEIC_FIXTURE = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAWhtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAGMAAEAAAAAAAAANQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAA6GlwcnAAAADJaXBjbwAAAHVodmNDAQQIAAAAAAAAAAAAHvAA/P38/AAADwMgAAEAF0ABDAH//wQIAAADAJm4AAADAAAeugJAIQABACpCAQEECAAAAwCZuAAAAwAAHqAggQRSluqumubgIaDAgAAAAwCAAAADAIQiAAEABkQBwXPAiQAAABRpc3BlAAAAAAAAAEAAAABAAAAAKGNsYXAAAAAYAAAAAQAAABAAAAAB////2AAAAAL////QAAAAAgAAABBwaXhpAAAAAAMMDAwAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAAD1tZGF0AAAAMSgBrxOA9SRSx9ube8ibxyKCC3J57c3jaStGhlc6Fs3/DrZcmdvCtQNWw6QpBCgAGBA=",
  "base64",
);

/** Real, fully decodable images so "valid" cases aren't just correct headers. */
let validJpeg: Buffer;
let validPng: Buffer;
let validWebp: Buffer;
let validGif: Buffer;

function halved(buffer: Buffer) {
  return buffer.subarray(0, Math.floor(buffer.length / 2));
}

beforeAll(async () => {
  const source = () =>
    sharp({
      create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 80, b: 40 } },
    });

  [validJpeg, validPng, validWebp, validGif] = await Promise.all([
    source().jpeg().toBuffer(),
    source().png().toBuffer(),
    source().webp().toBuffer(),
    source().gif().toBuffer(),
  ]);
});

describe("image normalization", () => {
  it("detects and converts a real HEIC image to JPEG", async () => {
    expect(detectVisionImageMimeType(HEIC_FIXTURE)).toBe("image/heic");

    const normalized = await normalizeImageForVision(HEIC_FIXTURE);

    expect(normalized.mimeType).toBe("image/jpeg");
    expect(normalized.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("preserves already-supported formats without conversion", async () => {
    await expect(normalizeImageForVision(validJpeg)).resolves.toEqual({
      buffer: validJpeg,
      mimeType: "image/jpeg",
    });
    await expect(normalizeImageForVision(validPng)).resolves.toEqual({
      buffer: validPng,
      mimeType: "image/png",
    });
    await expect(normalizeImageForVision(validWebp)).resolves.toEqual({
      buffer: validWebp,
      mimeType: "image/webp",
    });
  });

  it("rejects malformed HEIC uploads instead of saving them under a HEIC label", async () => {
    await expect(
      normalizeImageForStorage(Buffer.from("not an image"), "image/heic", "receipt.heic"),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("rejects unrecognized scanner images with an actionable error", async () => {
    await expect(normalizeImageForVision(Buffer.from("not an image"))).rejects.toThrow(
      "Please upload JPG, PNG, WebP, HEIC, or HEIF",
    );
  });

  describe("damaged images that still carry a valid signature", () => {
    // A truncated upload keeps its magic bytes, so signature checks alone would
    // pass it through and it would fail later inside the AI vision call.
    it.each([
      ["JPEG", () => halved(validJpeg)],
      ["PNG", () => halved(validPng)],
      ["WebP", () => halved(validWebp)],
    ])("rejects a truncated %s before it reaches a scanner", async (_label, make) => {
      const truncated = make();
      expect(detectVisionImageMimeType(truncated)).not.toBeNull();

      await expect(normalizeImageForVision(truncated)).rejects.toBeInstanceOf(
        UnsupportedImageError,
      );
      await expect(normalizeImageForVision(truncated)).rejects.toThrow("incomplete or damaged");
    });

    it.each([
      ["JPEG", "image/jpeg", "photo.jpg", () => halved(validJpeg)],
      ["PNG", "image/png", "photo.png", () => halved(validPng)],
      ["WebP", "image/webp", "photo.webp", () => halved(validWebp)],
    ])(
      "refuses to store a truncated %s",
      async (_label, declaredMimeType, filename, make) => {
        await expect(
          normalizeImageForStorage(make(), declaredMimeType, filename),
        ).rejects.toBeInstanceOf(UnsupportedImageError);
      },
    );

    it("rejects a header-only stub that is not a real image", async () => {
      const stub = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      expect(detectVisionImageMimeType(stub)).toBe("image/jpeg");

      await expect(normalizeImageForVision(stub)).rejects.toBeInstanceOf(UnsupportedImageError);
    });
  });

  describe("storage normalization of other upload types", () => {
    it("stores a decodable image whose signature is not scanner-supported", async () => {
      const stored = await normalizeImageForStorage(validGif, "image/gif", "loop.gif");
      expect(stored.mimeType).toBe("image/gif");
      expect(stored.buffer).toEqual(validGif);
    });

    it("rejects a file that claims to be an image but cannot be decoded", async () => {
      await expect(
        normalizeImageForStorage(Buffer.from("not an image"), "image/png", "fake.png"),
      ).rejects.toBeInstanceOf(UnsupportedImageError);
    });

    it("passes non-image uploads such as PDFs through untouched", async () => {
      const pdf = Buffer.from("%PDF-1.7\n<< /Type /Catalog >>\n%%EOF");
      await expect(
        normalizeImageForStorage(pdf, "application/pdf", "invoice.pdf"),
      ).resolves.toEqual({ buffer: pdf, mimeType: "application/pdf" });
    });

    it("keeps valid images unchanged", async () => {
      await expect(
        normalizeImageForStorage(validJpeg, "image/jpeg", "photo.jpg"),
      ).resolves.toEqual({ buffer: validJpeg, mimeType: "image/jpeg" });
    });
  });
});
