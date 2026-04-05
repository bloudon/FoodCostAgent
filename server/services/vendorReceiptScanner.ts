import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * priceType = 'case' means the returned price is per case/pack (what the approve() flow expects as line.price).
 * priceType = 'unit' means price was extracted per individual unit (must NOT be used directly as line.price).
 * priceType = null means the price could not be determined.
 */
export type ExtractedPriceType = 'case' | 'unit' | null;

export interface ExtractedVendorItem {
  name: string;
  sku: string;
  /** Price per individual unit — for display only; do NOT store as line.price */
  unitPrice: number | null;
  /** Price per case/pack — this is what should be stored as line.price in the order guide */
  casePrice: number | null;
  /** Explicit indicator: 'case' if price is per case, 'unit' if per unit, null if unknown */
  priceType: ExtractedPriceType;
  packSizeDescription: string;
  unit: string;
  categoryHint: string;
}

export interface VendorReceiptScanResult {
  items: ExtractedVendorItem[];
  vendorName: string | null;
  rawResponse: string;
}

/**
 * Sends a vendor invoice / order history image to GPT-4o Vision and extracts
 * structured line-item data suitable for the order guide import pipeline.
 *
 * The caller is responsible for fetching the image buffer using the appropriate
 * storage service (with proper company-level authorization).
 */
export async function scanVendorReceipt(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<VendorReceiptScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  const base64 = imageBuffer.toString('base64');

  const systemPrompt = `You are a vendor invoice / order guide data extraction expert for restaurant inventory systems.
Your task is to extract all product line items from a vendor invoice, order guide, shopping history, or price list image.

Return a JSON object with this exact structure:
{
  "vendorName": "Restaurant Depot" (or null if not visible),
  "items": [
    {
      "name": "Clean human-readable product name (expand abbreviations, title case)",
      "sku": "Item number / SKU / BIN / product code (empty string if not visible)",
      "casePrice": 14.99 (REQUIRED PRIORITY: the price per full case or pack as shown on the invoice — null if not visible),
      "unitPrice": 1.25 (price per individual unit — null if not visible; derive only if case price AND pack count are both clearly visible),
      "priceType": "case" if the extracted price is per case, "unit" if price is per individual unit, null if unknown,
      "packSizeDescription": "4/20oz" or "6/5 LB" or "CS" or "EA" (pack configuration string — empty string if not visible),
      "unit": "CS" or "EA" or "LB" or "OZ" (the unit of measure shown — empty string if not visible),
      "categoryHint": "Grocery" or "Produce" or "Dairy" etc. (infer from section header or product type — empty string if unknown)
    }
  ]
}

Rules:
- Extract ALL product line items visible in the document
- name: clean up abbreviations (e.g. "BCN SLCD 15/18" → "Sliced Bacon 15/18 Count", "CHIX BRS BNLS SKNLS" → "Boneless Skinless Chicken Breasts"), use title case
- sku: the item/product number, BIN, or code shown — often the first column. Empty string if none visible.
- CRITICAL — casePrice: The primary price column on most vendor invoices is the CASE price (price per case/pack). Prioritize "Price", "Avg Price", "Current Price", "Total" columns for casePrice. Set priceType="case".
- unitPrice: only populate when the invoice explicitly shows a per-unit price column (rare). Do not derive from case price.
- priceType: always set — "case" for case/pack prices, "unit" for per-unit prices, null if you cannot determine.
- packSizeDescription: the pack/size column value as-is (e.g. "4/20oz", "6/5 LB", "1/10 LB")
- unit: the UOM column value (C = case, U = unit, EA = each, LB = pound, etc.)
- categoryHint: use the department/section header visible above the items (e.g. "Major Dept 10. Grocery" → "Grocery")
- Skip any header rows, totals rows, or non-product lines
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

  const rawResponse = response.choices[0]?.message?.content || '{"vendorName":null,"items":[]}';

  let parsed: { vendorName?: string | null; items?: any[] };
  try {
    parsed = JSON.parse(rawResponse) as { vendorName?: string | null; items?: any[] };
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  const items: ExtractedVendorItem[] = (parsed.items || []).map((item: any) => {
    const rawPriceType = String(item.priceType || '').toLowerCase();
    const priceType: ExtractedPriceType =
      rawPriceType === 'case' ? 'case' :
      rawPriceType === 'unit' ? 'unit' :
      null;

    return {
      name: String(item.name || '').trim(),
      sku: String(item.sku || '').trim(),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      casePrice: item.casePrice != null ? Number(item.casePrice) : null,
      priceType,
      packSizeDescription: String(item.packSizeDescription || '').trim(),
      unit: String(item.unit || '').trim(),
      categoryHint: String(item.categoryHint || '').trim(),
    };
  }).filter((item: ExtractedVendorItem) => item.name.length > 0);

  return {
    items,
    vendorName: parsed.vendorName ? String(parsed.vendorName).trim() : null,
    rawResponse,
  };
}
