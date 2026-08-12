import convertHeic from "heic-convert";

export type VisionImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export class UnsupportedImageError extends Error {
  constructor(message = "Unsupported image type. Please upload JPG, PNG, WebP, HEIC, or HEIF.") {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

const DAMAGED_IMAGE_MESSAGE =
  "We couldn't read this image — the file looks incomplete or damaged. Please try uploading it again.";

const UNREADABLE_HEIC_MESSAGE =
  "We couldn't read this HEIC/HEIF photo. Please choose another photo or export it as JPEG.";

function hasBytes(buffer: Buffer, offset: number, expected: readonly number[]) {
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

function hasHeicBrand(buffer: Buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;

  const heicBrands = new Set([
    "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
    "mif1", "msf1",
  ]);
  for (let offset = 8; offset + 4 <= buffer.length; offset += 4) {
    if (heicBrands.has(buffer.toString("ascii", offset, offset + 4))) return true;
  }
  return false;
}

export function detectVisionImageMimeType(buffer: Buffer): VisionImageMimeType | "image/heic" | null {
  if (hasBytes(buffer, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    hasBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(buffer, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  return hasHeicBrand(buffer) ? "image/heic" : null;
}

/**
 * Fully decodes the image to prove it is readable, not just correctly labeled.
 *
 * Magic bytes only describe the first few bytes of the header, so a truncated
 * or corrupted upload passes signature checks and then fails much later inside
 * the AI vision call or the crop pipeline. Decoding here turns that into an
 * immediate, actionable rejection at the normalization boundary.
 *
 * The decode is downscaled so memory stays bounded, but `resize` still forces
 * every scanline through the decoder, which is what catches truncation.
 *
 * @returns the decoded format name (e.g. "jpeg"), or null when unreadable.
 */
async function decodeImageFormat(buffer: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer, { failOn: "truncated" }).metadata();
    await sharp(buffer, { failOn: "truncated" })
      .resize({ width: 64, height: 64, fit: "inside" })
      .raw()
      .toBuffer();
    return metadata.format ?? null;
  } catch {
    return null;
  }
}

async function assertDecodable(buffer: Buffer, message: string): Promise<void> {
  if ((await decodeImageFormat(buffer)) === null) {
    throw new UnsupportedImageError(message);
  }
}

/**
 * Returns an image in a MIME type accepted by every vision scanner.
 * Detection is byte-based so a mislabeled iPhone photo cannot bypass format
 * checks, and every accepted image is decoded so a damaged file is rejected
 * here rather than failing downstream.
 */
export async function normalizeImageForVision(
  buffer: Buffer,
): Promise<{ buffer: Buffer; mimeType: VisionImageMimeType }> {
  const detectedMimeType = detectVisionImageMimeType(buffer);
  if (!detectedMimeType) throw new UnsupportedImageError();

  if (detectedMimeType !== "image/heic") {
    await assertDecodable(buffer, DAMAGED_IMAGE_MESSAGE);
    return { buffer, mimeType: detectedMimeType };
  }

  let normalizedBuffer: Buffer;
  try {
    const converted = await convertHeic({
      buffer,
      format: "JPEG",
      quality: 0.9,
    });
    normalizedBuffer = Buffer.from(converted);
    if (detectVisionImageMimeType(normalizedBuffer) !== "image/jpeg") {
      throw new Error("HEIC conversion did not produce a JPEG");
    }
  } catch (error) {
    if (error instanceof UnsupportedImageError) throw error;
    throw new UnsupportedImageError(UNREADABLE_HEIC_MESSAGE);
  }

  await assertDecodable(normalizedBuffer, UNREADABLE_HEIC_MESSAGE);
  return { buffer: normalizedBuffer, mimeType: "image/jpeg" };
}

/**
 * Preserve non-image uploads (for example PDFs) but normalize genuine HEIC/HEIF
 * bytes before they are saved so browser previews remain compatible, and reject
 * anything that claims to be an image but cannot actually be decoded.
 */
export async function normalizeImageForStorage(
  buffer: Buffer,
  declaredMimeType: string,
  originalName?: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const detectedMimeType = detectVisionImageMimeType(buffer);
  if (detectedMimeType === "image/heic") {
    return normalizeImageForVision(buffer);
  }

  const looksLikeHeic =
    declaredMimeType.toLowerCase().startsWith("image/hei") ||
    /\.(heic|heif)$/i.test(originalName ?? "");
  if (looksLikeHeic) {
    throw new UnsupportedImageError(UNREADABLE_HEIC_MESSAGE);
  }

  if (detectedMimeType) {
    await assertDecodable(buffer, DAMAGED_IMAGE_MESSAGE);
    return { buffer, mimeType: detectedMimeType };
  }

  // Unrecognized signature. Anything claiming to be an image still has to
  // decode (this keeps working formats such as GIF), while PDFs and other
  // non-image uploads pass through untouched.
  if (declaredMimeType.toLowerCase().startsWith("image/")) {
    const decodedFormat = await decodeImageFormat(buffer);
    if (!decodedFormat) {
      throw new UnsupportedImageError(DAMAGED_IMAGE_MESSAGE);
    }
    return { buffer, mimeType: `image/${decodedFormat === "jpg" ? "jpeg" : decodedFormat}` };
  }

  return { buffer, mimeType: declaredMimeType };
}
