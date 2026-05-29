export interface PdfProduct {
  productName: string;
  vendorSku: string;
  price: number | null;
}

export interface PdfParseResult {
  products: PdfProduct[];
  pageCount: number;
}

/**
 * Extracts vendor product catalog data from a PDF buffer using text extraction.
 *
 * Handles catalog-style PDFs where each product block follows the pattern:
 *   Product Name [possibly multi-line]
 *   SKU: VENDOR-SKU
 *   [Status line — In Stock / Out of Stock / Call for Availability]
 *   $XX.XX
 *   Qty:
 *
 * All pages are extracted in a single pass — no page-by-page looping needed.
 */
export async function parsePdfOrderGuide(pdfBuffer: Buffer): Promise<PdfParseResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(pdfBuffer);
  const products = extractProductsFromText(data.text);
  return { products, pageCount: data.numpages };
}

const GARBAGE_PATTERNS: RegExp[] = [
  /^qty:?$/i,
  /^add to cart$/i,
  /^\d+ to \d+ of \d+ results$/i,
  /^prev(\s+\d+)+/i,
  /^(\d+\s+)+next$/i,
  /^prev\s*$/i,
  /^next\s*$/i,
  /^[\d\s]+$/,
  /^all products$/i,
  /^(in stock|out of stock|call for availability|check availability)$/i,
  /^home\s*[/>]/i,
  /^search$/i,
  /^sort\s+by/i,
  /^view:/i,
  /^filter/i,
  /^category:/i,
  /^showing\s+\d+/i,
  /^price:/i,
];

function isGarbage(line: string): boolean {
  return GARBAGE_PATTERNS.some(p => p.test(line));
}

function extractProductsFromText(text: string): PdfProduct[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const products: PdfProduct[] = [];
  const skuRegex = /^sku:\s*(.+)$/i;
  const priceRegex = /^\$(\d[\d,]*(?:\.\d+)?)$/;

  let nameLines: string[] = [];
  let currentSku: string | null = null;

  for (const line of lines) {
    if (isGarbage(line)) continue;

    const skuMatch = line.match(skuRegex);
    if (skuMatch) {
      currentSku = skuMatch[1].trim();
      continue;
    }

    if (currentSku !== null) {
      const priceMatch = line.match(priceRegex);
      if (priceMatch) {
        const productName = nameLines.join(' ').trim();
        if (productName) {
          products.push({
            productName,
            vendorSku: currentSku,
            price: parseFloat(priceMatch[1].replace(/,/g, '')),
          });
        }
        nameLines = [];
        currentSku = null;
      }
      // Lines between SKU and price (status, availability) are silently skipped
      continue;
    }

    // Not a SKU line and not between SKU and price → accumulate as product name
    nameLines.push(line);
  }

  return products;
}
