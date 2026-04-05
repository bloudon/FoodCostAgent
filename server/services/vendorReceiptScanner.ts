import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ExtractedVendorItem {
  name: string;
  sku: string;
  unitPrice: number | null;
  casePrice: number | null;
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
      "unitPrice": 1.25 (price per individual unit — null if not visible or not applicable),
      "casePrice": 14.99 (price per case — null if not visible),
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
- unitPrice: the per-unit price (divide case price by pack count if only case price is shown and pack is parseable)
- casePrice: the total price for a case/pack — look for "Price" or "Avg" or "Current Price" columns
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

  let parsed: { vendorName?: string | null; items?: ExtractedVendorItem[] };
  try {
    parsed = JSON.parse(rawResponse) as { vendorName?: string | null; items?: ExtractedVendorItem[] };
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  const items: ExtractedVendorItem[] = (parsed.items || []).map((item) => ({
    name: String(item.name || '').trim(),
    sku: String(item.sku || '').trim(),
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
    casePrice: item.casePrice != null ? Number(item.casePrice) : null,
    packSizeDescription: String(item.packSizeDescription || '').trim(),
    unit: String(item.unit || '').trim(),
    categoryHint: String(item.categoryHint || '').trim(),
  })).filter((item) => item.name.length > 0);

  return {
    items,
    vendorName: parsed.vendorName ? String(parsed.vendorName).trim() : null,
    rawResponse,
  };
}
