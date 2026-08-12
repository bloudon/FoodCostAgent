const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export function isHeicFile(file: Pick<File, "name" | "type">) {
  const extension = file.name.toLowerCase().split(".").pop();
  return HEIC_MIME_TYPES.has(file.type.toLowerCase()) || extension === "heic" || extension === "heif";
}

export async function normalizeImageUpload(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9,
    });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    if (!jpeg) throw new Error("No converted image returned");

    const baseName = file.name.replace(/\.(heic|heif)$/i, "") || "image";
    return new File([jpeg], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    throw new Error(
      `We couldn't convert "${file.name}". Please choose another photo or export it as JPEG.`,
    );
  }
}