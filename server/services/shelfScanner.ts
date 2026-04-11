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
 */
export async function scanShelfImage(imageBuffer: Buffer, mimeType: string): Promise<ShelfScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const base64 = imageBuffer.toString('base64');

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
            text: 'Please identify all inventory items visible on this shelf.',
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
