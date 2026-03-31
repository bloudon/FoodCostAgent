import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ExtractedMenuItem {
  name: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
}

export interface MenuScanResult {
  items: ExtractedMenuItem[];
  rawResponse: string;
}

/**
 * Sends a menu image buffer to GPT-4o Vision and extracts structured menu item data.
 * The caller is responsible for fetching the image buffer using the appropriate
 * storage service (with proper company-level authorization).
 */
export async function scanMenuImage(imageBuffer: Buffer, mimeType: string): Promise<MenuScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  const base64 = imageBuffer.toString('base64');

  const systemPrompt = `You are a menu data extraction expert for restaurant inventory systems.
Your task is to extract all food and beverage items from a menu image.

Return a JSON object with this exact structure:
{
  "items": [
    {
      "name": "Item name (clean, human-readable)",
      "department": "Main category group (e.g. Pizza, Appetizers, Beverages, Desserts, Sides)",
      "category": "Subcategory if visible (e.g. Specialty Pizza, Classic Pizza) — empty string if none",
      "size": "Size variant if visible (e.g. Small, Medium, Large, 10\\", 12\\") — empty string if single size",
      "price": 12.99
    }
  ]
}

Rules:
- Extract ALL items visible in the menu
- price: use null if no price is shown for that item
- For items with multiple sizes shown as a table row (e.g. "Margherita | Sm $10 | Lg $15"), create SEPARATE entries for each size variant
- department: infer from menu section headers (e.g. "PIZZAS", "DRINKS", "APPETIZERS")
- category: use sub-section headers if visible, otherwise empty string
- name: clean up abbreviations, use title case
- Do NOT include modifiers, add-ons, or combo options as separate items
- Respond ONLY with the JSON object, no markdown or explanation`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
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
            text: systemPrompt,
          },
        ],
      },
    ],
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const rawResponse = response.choices[0]?.message?.content || '{"items":[]}';

  let parsed: { items?: ExtractedMenuItem[] };
  try {
    parsed = JSON.parse(rawResponse) as { items?: ExtractedMenuItem[] };
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  const items: ExtractedMenuItem[] = (parsed.items || []).map((item) => ({
    name: String(item.name || '').trim(),
    department: String(item.department || '').trim(),
    category: String(item.category || '').trim(),
    size: String(item.size || '').trim(),
    price: item.price != null ? Number(item.price) : null,
  })).filter((item) => item.name.length > 0);

  return { items, rawResponse };
}
