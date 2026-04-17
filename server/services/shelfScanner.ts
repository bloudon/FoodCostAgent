import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ShelfItem {
  name: string;
  quantity: number;
  unit: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ShelfScanResult {
  items: ShelfItem[];
  notes: string;
}

/**
 * Sends a single shelf/storage image to GPT-4o Vision and extracts visible inventory items.
 * Designed to be called in parallel for multi-frame sweep mode.
 *
 * @param imageBuffer  Raw image bytes
 * @param mimeType     MIME type (image/jpeg, image/png, image/webp)
 * @param contextHint  Optional free-text hint injected into the user message to scope recognition
 *                     (e.g. "Focus on items in the Dry Storage location." or "You are counting
 *                     Olive Oil — report its quantity as accurately as possible.")
 */
export async function scanShelfImage(
  imageBuffer: Buffer,
  mimeType: string,
  contextHint?: string,
): Promise<ShelfScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const base64 = imageBuffer.toString('base64');
  const userText = contextHint
    ? `Please identify all inventory items visible on this shelf. ${contextHint}`
    : 'Please identify all inventory items visible on this shelf.';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an inventory counting assistant for food service businesses.
Your job is to look at a photo of a shelf, walk-in cooler, dry storage, or prep area and identify every distinct product you can see.

For each item, estimate:
- name: the product or ingredient name (be specific, e.g. "Roma Tomatoes" not just "Tomatoes")
- quantity: how many units, cases, cans, bags, or containers are visible (use your best count)
- unit: the appropriate unit (e.g. "cases", "cans", "bags", "bottles", "lbs", "each", "containers")
- confidence: "high" if clearly visible and countable, "medium" if partially visible, "low" if a guess

Return ONLY a JSON object in this exact structure:
{
  "items": [
    { "name": "Olive Oil", "quantity": 3, "unit": "bottles", "confidence": "high" },
    { "name": "Crushed Tomatoes", "quantity": 12, "unit": "cans", "confidence": "high" }
  ],
  "notes": "Any relevant observations about the shelf (e.g. some items obscured by other products)"
}

Rules:
- Only include items you can actually see in this image
- Do not guess items that are not visible
- If a shelf is empty or no items are recognizable, return an empty items array
- Product labels take priority — if you can read the label, use that exact name
- For sealed protein packages (meat, poultry, seafood) that show a NET WT, NET WEIGHT, or NW field on a retail or butcher/thermal weight label, use the printed net weight as qty and set unit to "lbs". Do NOT count package units (e.g. do not return qty 1 unit "pack"). Example: a label showing "NET WT 2.68 LB" should produce qty 2.68 unit "lbs".
- Respond ONLY with the JSON object, no markdown, no explanation`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: userText,
          },
        ],
      },
    ],
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    const items: ShelfItem[] = (parsed.items || []).map((item: any) => ({
      name: String(item.name || '').trim(),
      quantity: Number(item.quantity) || 0,
      unit: String(item.unit || 'each').trim(),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium',
    })).filter((item: ShelfItem) => item.name.length > 0);

    return {
      items,
      notes: String(parsed.notes || '').trim(),
    };
  } catch {
    return { items: [], notes: 'Failed to parse AI response.' };
  }
}

// ─── Catch-Weight Label Scanner ───────────────────────────────────────────────

export interface CatchWeightLabelResult {
  /** Net weight extracted from the label, in the label's stated unit */
  netWeight: number | null;
  /** Unit as printed on the label (e.g. "lbs", "kg") */
  weightUnit: string | null;
  /** Number of pieces/packages if printed on the label */
  packageCount: number | null;
  /** Per-package weight if calculable or directly printed */
  weightPerPackage: number | null;
  /** Item or product name as read from the label */
  productName: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Raw text the model extracted from the label */
  rawText: string;
}

/**
 * Reads a single USDA/packer case or catch-weight label image and extracts
 * the net weight, package count, and any printed per-package weight.
 *
 * @param imageBuffer   Raw image bytes
 * @param mimeType      MIME type (image/jpeg, image/png, image/webp)
 * @param expectedName  Optional inventory item name to help resolve ambiguous labels
 */
export async function scanCatchWeightLabel(
  imageBuffer: Buffer,
  mimeType: string,
  expectedName?: string,
): Promise<CatchWeightLabelResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const base64 = imageBuffer.toString('base64');
  const hint = expectedName
    ? `We are counting "${expectedName}". Extract the weight information from the label in this image.`
    : 'Extract the weight information from the label in this image.';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a catch-weight label reader for food-service inventory management.
Your job is to look at a photo of a USDA/packer case sticker, hang-tag, or printed label on a meat, seafood, or protein package and extract weight information precisely.

Extract the following fields:
- netWeight: the net weight number printed on the label (e.g., 12.47 for "12.47 lbs")
- weightUnit: the unit printed ("lbs", "kg", "oz", etc.)
- packageCount: number of pieces or individual packages inside the case (e.g., 6 for "6 pieces")
- weightPerPackage: per-piece/per-package weight if printed (e.g., 2.08 for "2.08 lbs/pc")
- productName: product or item name as printed on the label
- confidence: "high" if all fields are clearly legible, "medium" if some are inferred, "low" if mostly guessing
- rawText: all text you can read from the label, as a comma-separated list

Rules:
- Only report numbers you can actually read; set a field to null if it is not visible or not printed
- Prioritise the largest/clearest weight number visible — that is typically the net weight
- If only total net weight is shown (no per-piece), set packageCount and weightPerPackage to null
- Respond ONLY with a JSON object, no markdown, no explanation:
{
  "netWeight": 12.47,
  "weightUnit": "lbs",
  "packageCount": 6,
  "weightPerPackage": 2.08,
  "productName": "Chicken Breast Trimmed",
  "confidence": "high",
  "rawText": "CHICKEN BREAST TRIMMED, NET WT 12.47 LBS, 6 PC, 2.08 LBS/PC"
}`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
          { type: 'text', text: hint },
        ],
      },
    ],
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      netWeight: parsed.netWeight != null ? Number(parsed.netWeight) : null,
      weightUnit: parsed.weightUnit ? String(parsed.weightUnit) : null,
      packageCount: parsed.packageCount != null ? Number(parsed.packageCount) : null,
      weightPerPackage: parsed.weightPerPackage != null ? Number(parsed.weightPerPackage) : null,
      productName: parsed.productName ? String(parsed.productName).trim() : null,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium',
      rawText: String(parsed.rawText || '').trim(),
    };
  } catch {
    return {
      netWeight: null,
      weightUnit: null,
      packageCount: null,
      weightPerPackage: null,
      productName: null,
      confidence: 'low',
      rawText: '',
    };
  }
}

// ─── Shelf Sweep Merge ─────────────────────────────────────────────────────────

/**
 * Merges results from multiple shelf scan frames.
 * Items with the same name (case-insensitive, normalised) have their quantities summed.
 * The highest confidence level across frames wins for each item.
 */
export function mergeShelfScanResults(results: ShelfScanResult[]): {
  items: ShelfItem[];
  frameCount: number;
  notes: string[];
} {
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

  const normalize = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const merged = new Map<string, ShelfItem & { key: string }>();

  for (const result of results) {
    for (const item of result.items) {
      const key = normalize(item.name);
      if (!key) continue;

      const existing = merged.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        if ((confidenceRank[item.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) {
          existing.confidence = item.confidence;
        }
      } else {
        merged.set(key, { ...item, key });
      }
    }
  }

  return {
    items: Array.from(merged.values()).map(({ key: _key, ...item }) => item),
    frameCount: results.length,
    notes: results.map(r => r.notes).filter(Boolean),
  };
}
