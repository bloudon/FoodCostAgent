import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ExtractedMenuItem {
  name: string;
  description: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
  variantGroupKey: string; // shared key for items that are size variants of the same dish (empty if none detected)
}

export interface MenuIntelligence {
  phones: string[];
  addresses: string[];
  locationCount: number;
  multiLocationSignal: boolean;
}

export interface MenuScanResult {
  items: ExtractedMenuItem[];
  intelligence: MenuIntelligence;
  rawResponse: string;
}

/**
 * Sends a menu image buffer to GPT-4o Vision and extracts structured menu item data
 * plus business intelligence (phone numbers, addresses, multi-location signals).
 * The caller is responsible for fetching the image buffer using the appropriate
 * storage service (with proper company-level authorization).
 */
export async function scanMenuImage(imageBuffer: Buffer, mimeType: string): Promise<MenuScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  const base64 = imageBuffer.toString('base64');

  const systemPrompt = `You are a menu data extraction expert for restaurant inventory systems.
Your task is to extract all food and beverage items from a menu image, AND extract business intelligence.

Return a JSON object with this exact structure:
{
  "items": [
    {
      "name": "Item name (clean, human-readable)",
      "description": "Full description text printed below the item name — ingredient/preparation list exactly as it appears. Empty string if no description exists.",
      "department": "Main category group (e.g. Pizza, Appetizers, Beverages, Desserts, Sides)",
      "category": "Subcategory if visible (e.g. Specialty Pizza, Classic Pizza) — empty string if none",
      "size": "Size variant if visible (e.g. Small, Medium, Large, 10\\", 12\\") — empty string if single size",
      "price": 12.99,
      "variantGroupKey": "slug-style-key shared by items that are the same dish in different sizes (e.g. all three wing sizes share \\"chicken-wings\\"). Empty string if no group detected."
    }
  ],
  "intelligence": {
    "phones": ["(555) 123-4567"],
    "addresses": ["123 Main St, Anytown, CA 90210"],
    "locationCount": 1,
    "multiLocationSignal": false
  }
}

Rules for items:
- Extract ALL items visible in the menu
- description: copy the ingredient/preparation text printed under the item name verbatim (e.g. "crispy flatbread, garlic oil, pesto, fresh mozzarella, grilled chicken, balsamic glaze"). Use empty string if no description is printed.
- price: use null if no price is shown for that item
- For items with multiple sizes shown as a table row (e.g. "Margherita | Sm $10 | Lg $15"), create SEPARATE entries for each size variant
- department: infer from menu section headers (e.g. "PIZZAS", "DRINKS", "APPETIZERS")
- category: use sub-section headers if visible, otherwise empty string
- name: clean up abbreviations, use title case
- Do NOT include modifiers, add-ons, or combo options as separate items
- variantGroupKey: assign a shared lowercase-hyphenated key to items that are clearly the same dish in different sizes (e.g. "6 Chicken Wings", "12 Chicken Wings", "24 Chicken Wings" all get "chicken-wings"). Only use this for genuine size variants of the same dish — NOT for different preparations (bone-in vs boneless), NOT for flavour variants (mild/hot/BBQ). Leave as empty string for items with no size siblings on this menu.

Rules for intelligence:
- phones: extract ALL phone numbers found anywhere on the menu (header, footer, contact section). Empty array if none found.
- addresses: extract ALL street addresses found on the menu. Include full address as a single string per location. Empty array if none found.
- locationCount: your best estimate of how many locations this business operates. Use 1 unless: multiple distinct addresses are listed, OR there is explicit language like "visit our 3 locations", "find us at all our locations", "all locations", franchise/chain indicators, etc.
- multiLocationSignal: true if any signals suggest this is a multi-location or chain business (multiple addresses, explicit location count language, franchise branding, "coming soon to [city]", etc.)

Respond ONLY with the JSON object, no markdown or explanation`;

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

  const rawResponse = response.choices[0]?.message?.content || '{"items":[],"intelligence":{"phones":[],"addresses":[],"locationCount":1,"multiLocationSignal":false}}';

  let parsed: { items?: ExtractedMenuItem[]; intelligence?: Partial<MenuIntelligence> };
  try {
    parsed = JSON.parse(rawResponse) as { items?: ExtractedMenuItem[]; intelligence?: Partial<MenuIntelligence> };
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  const items: ExtractedMenuItem[] = (parsed.items || []).map((item) => ({
    name: String(item.name || '').trim(),
    description: String((item as any).description || '').trim(),
    department: String(item.department || '').trim(),
    category: String(item.category || '').trim(),
    size: String(item.size || '').trim(),
    price: item.price != null ? Number(item.price) : null,
    variantGroupKey: String((item as any).variantGroupKey || '').trim(),
  })).filter((item) => item.name.length > 0);

  const rawIntel = parsed.intelligence || {};
  const intelligence: MenuIntelligence = {
    phones: Array.isArray(rawIntel.phones) ? rawIntel.phones.map(String).filter(Boolean) : [],
    addresses: Array.isArray(rawIntel.addresses) ? rawIntel.addresses.map(String).filter(Boolean) : [],
    locationCount: typeof rawIntel.locationCount === 'number' && rawIntel.locationCount >= 1
      ? Math.round(rawIntel.locationCount)
      : 1,
    multiLocationSignal: !!rawIntel.multiLocationSignal,
  };

  // If multiple addresses were found but locationCount wasn't updated, infer it
  if (intelligence.addresses.length > 1 && intelligence.locationCount === 1) {
    intelligence.locationCount = intelligence.addresses.length;
    intelligence.multiLocationSignal = true;
  }

  return { items, intelligence, rawResponse };
}
