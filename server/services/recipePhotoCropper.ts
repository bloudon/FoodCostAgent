/**
 * recipePhotoCropper.ts
 *
 * Uses GPT-4o vision to locate the food/dish photograph within a scanned
 * recipe card image, then crops it out with sharp and saves the result as a
 * new object in storage.
 *
 * Falls back gracefully: if the vision API can't find a distinct food photo
 * (low confidence, no photo found, API error) the caller gets null and should
 * keep the full scan as the recipe image.
 */

import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { objectStorageClient } from '../objectStorage';
import { setObjectAclPolicy } from '../objectAcl';
import { recordAiTokenUsage, type AiMeter } from '../aiUsage';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function splitObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const parts = normalized.split('/');
  return { bucketName: parts[1], objectName: parts.slice(2).join('/') };
}

async function readObjectBuffer(objectPath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  // objectPath looks like /objects/uploads/<uuid>
  // PRIVATE_OBJECT_DIR looks like /<bucket>/<prefix>
  const privateObjectDir = (process.env.PRIVATE_OBJECT_DIR || '').replace(/\/$/, '');
  const entityId = objectPath.replace(/^\/objects\//, ''); // "uploads/<uuid>"
  const fullPath = `${privateObjectDir}/${entityId}`;

  const { bucketName, objectName } = splitObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);

  const stream = file.createReadStream();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const buffer = Buffer.concat(chunks);
  const ext = objectPath.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  };
  return { buffer, mimeType: mimeMap[ext] || 'image/jpeg' };
}

async function writeObjectBuffer(buffer: Buffer, contentType: string, ownerId: string): Promise<string> {
  const privateObjectDir = (process.env.PRIVATE_OBJECT_DIR || '').replace(/\/$/, '');
  const objectId = randomUUID();
  const entityId = `uploads/${objectId}`;
  const fullPath = `${privateObjectDir}/${entityId}`;

  const { bucketName, objectName } = splitObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);

  await file.save(buffer, { contentType, resumable: false });
  await setObjectAclPolicy(file, { owner: ownerId, visibility: 'private' });

  return `/objects/${entityId}`;
}

export interface CropResult {
  croppedPath: string | null;
  photoCropped: boolean;
}

/**
 * Detect and crop the food dish photo from a scanned recipe card image.
 *
 * @param rawImagePath  Object storage path of the original scan (/objects/...)
 * @param ownerId       User ID to set as ACL owner on the new cropped object
 * @returns             croppedPath = new object path, or null on fallback
 */
export async function cropFoodPhotoFromScan(
  rawImagePath: string,
  ownerId: string,
  meter?: AiMeter,
): Promise<CropResult> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[RecipePhotoCropper] OPENAI_API_KEY not set — skipping crop');
    return { croppedPath: null, photoCropped: false };
  }

  try {
    const { buffer, mimeType } = await readObjectBuffer(rawImagePath);
    const base64 = buffer.toString('base64');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
            },
            {
              type: 'text',
              text: `This image is a scanned recipe card or cookbook page. Locate the food/dish photograph — the actual photo showing the finished dish, not any text, title, or ingredient list.

Return a JSON object with:
- "found": true if a food photo is clearly visible
- "confidence": 0.0–1.0
- "x": left edge as fraction of image width (0.0–1.0)
- "y": top edge as fraction of image height (0.0–1.0)
- "width": photo width as fraction of image width (0.0–1.0)
- "height": photo height as fraction of image height (0.0–1.0)

If no food photo is found set found=false and all coordinates to 0.
Respond ONLY with the JSON object, no markdown.
Example: {"found":true,"confidence":0.92,"x":0.55,"y":0.05,"width":0.42,"height":0.45}`,
            },
          ],
        },
      ],
      max_tokens: 256,
      response_format: { type: 'json_object' },
    });

    void recordAiTokenUsage(meter, 'recipe_scan', 'gpt-4o', response.usage);

    const raw = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as {
      found: boolean;
      confidence: number;
      x: number; y: number; width: number; height: number;
    };

    if (!parsed.found || (parsed.confidence ?? 0) < 0.6) {
      console.log(`[RecipePhotoCropper] No confident food photo found (found=${parsed.found}, confidence=${parsed.confidence})`);
      return { croppedPath: null, photoCropped: false };
    }

    const { x, y, width: w, height: h } = parsed;

    // Sanity-check fractions
    if (w <= 0.02 || h <= 0.02 || x < 0 || y < 0 || x + w > 1.05 || y + h > 1.05) {
      console.log('[RecipePhotoCropper] Bounding box out of valid range — skipping crop');
      return { croppedPath: null, photoCropped: false };
    }

    const sharp = (await import('sharp')).default;
    const meta = await sharp(buffer).metadata();
    const imgW = meta.width ?? 1;
    const imgH = meta.height ?? 1;

    const left   = Math.max(0, Math.round(x * imgW));
    const top    = Math.max(0, Math.round(y * imgH));
    const cropW  = Math.min(imgW - left, Math.round(w * imgW));
    const cropH  = Math.min(imgH - top,  Math.round(h * imgH));

    if (cropW < 20 || cropH < 20) {
      console.log('[RecipePhotoCropper] Crop region too small — skipping');
      return { croppedPath: null, photoCropped: false };
    }

    const croppedBuffer = await sharp(buffer)
      .extract({ left, top, width: cropW, height: cropH })
      .jpeg({ quality: 90 })
      .toBuffer();

    const croppedPath = await writeObjectBuffer(croppedBuffer, 'image/jpeg', ownerId);
    console.log(`[RecipePhotoCropper] Cropped food photo saved → ${croppedPath}`);
    return { croppedPath, photoCropped: true };

  } catch (err) {
    console.error('[RecipePhotoCropper] Error (non-fatal):', err);
    return { croppedPath: null, photoCropped: false };
  }
}
