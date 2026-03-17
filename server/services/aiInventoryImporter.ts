import OpenAI from 'openai';
import type { CsvColumnMapping } from '../integrations/csv/CsvOrderGuide';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ColumnMappingProposal {
  mapping: CsvColumnMapping;
  confidence: Record<keyof CsvColumnMapping, number>; // 0-1 confidence per field
  headers: string[];
}

/**
 * AI-powered CSV column mapper
 * Sends CSV headers + sample rows to OpenAI and gets back a column mapping proposal.
 * Falls back to pattern-matching if OpenAI is unavailable.
 */
export async function analyzeColumns(csvText: string): Promise<ColumnMappingProposal> {
  // Extract headers and up to 5 sample rows
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  const headerLine = lines[0];
  const sampleLines = lines.slice(1, 6);

  // Parse headers (handle quoted CSV)
  const headers = parseSimpleCsvRow(headerLine);

  // Try AI column mapping if OpenAI is configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const sampleData = sampleLines.map(line => parseSimpleCsvRow(line));
      const prompt = buildColumnMappingPrompt(headers, sampleData);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a CSV data analyst specializing in food service inventory systems.
Your task is to map CSV column headers to inventory fields.
Respond ONLY with a valid JSON object.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw);
        return buildProposalFromAiResponse(parsed, headers);
      }
    } catch (err) {
      console.error('[aiInventoryImporter] OpenAI column mapping failed, using fallback:', err);
    }
  }

  // Fallback: pattern-based detection
  return patternBasedMapping(headers);
}

/**
 * AI-powered batch name normalization.
 * Takes raw vendor product names and returns a map of raw → canonical names.
 * Falls back gracefully if OpenAI is unavailable.
 */
export async function normalizeProductNames(
  rawNames: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (!rawNames.length) return result;

  // Skip AI if no key configured
  if (!process.env.OPENAI_API_KEY) {
    return result;
  }

  // Process in batches of 40 to stay within token limits
  const BATCH_SIZE = 40;
  for (let i = 0; i < rawNames.length; i += BATCH_SIZE) {
    const batch = rawNames.slice(i, i + BATCH_SIZE);
    const batchResult = await normalizeBatch(batch);
    batchResult.forEach((canonical, raw) => result.set(raw, canonical));
  }

  return result;
}

async function normalizeBatch(names: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  try {
    const prompt = `You are normalizing food product names for a restaurant inventory system.
Convert each vendor product name to a clean, human-readable name.
- Remove vendor codes, abbreviations, and internal SKU fragments
- Expand abbreviations (LB→Pound, OZ→Ounce, CS→Case, CT→Count, etc.)  
- Keep brand names if present
- Keep size/count info if relevant
- Use title case
- Keep it concise (under 50 chars)

Return a JSON object where each key is the original name and value is the canonical name.
IMPORTANT: Include ALL ${names.length} names. Do not skip any.

Names to normalize:
${names.map((n, i) => `${i + 1}. "${n}"`).join('\n')}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [original, canonical] of Object.entries(parsed)) {
        if (typeof canonical === 'string' && canonical.trim()) {
          result.set(original, canonical.trim());
        }
      }
    }
  } catch (err) {
    console.error('[aiInventoryImporter] Batch normalization failed:', err);
  }

  return result;
}

function buildColumnMappingPrompt(headers: string[], sampleData: string[][]): string {
  const sampleTable = [headers, ...sampleData]
    .map(row => row.join(' | '))
    .join('\n');

  return `Map these CSV columns to inventory fields.

CSV Headers and sample data:
${sampleTable}

Map each column header to ONE of these field types (or "skip" if not relevant):
- productName: The product/item name or description
- vendorSku: The vendor's item code, SKU, or item number
- casePrice: The price per case
- casePkgCount: Number of units/packages per case (pack size)
- innerPack: Size of each inner package (e.g., weight per can)
- unit: Unit of measure (lb, oz, each, etc.)
- category: Product category
- brand: Brand or manufacturer name
- upc: UPC or barcode
- skip: Column is not relevant

Return a JSON object with this structure:
{
  "mapping": {
    "productName": "<exact header name or empty string>",
    "vendorSku": "<exact header name or empty string>",
    "casePrice": "<exact header name or empty string>",
    "casePkgCount": "<exact header name or empty string>",
    "innerPack": "<exact header name or empty string>",
    "unit": "<exact header name or empty string>",
    "category": "<exact header name or empty string>",
    "brand": "<exact header name or empty string>",
    "upc": "<exact header name or empty string>"
  },
  "confidence": {
    "productName": 0.95,
    "vendorSku": 0.9,
    "casePrice": 0.85,
    "casePkgCount": 0.7,
    "innerPack": 0.6,
    "unit": 0.8,
    "category": 0.5,
    "brand": 0.4,
    "upc": 0.3
  }
}

Use empty string "" for fields with no matching column. Use exact header names from the CSV.`;
}

function buildProposalFromAiResponse(
  aiResponse: any,
  headers: string[]
): ColumnMappingProposal {
  const { mapping: aiMapping = {}, confidence: aiConfidence = {} } = aiResponse;

  // Map AI field names to CsvColumnMapping field names
  const fieldAliases: Record<string, keyof CsvColumnMapping> = {
    productName: 'productName',
    vendorSku: 'vendorSku',
    casePrice: 'price',
    casePkgCount: 'caseSize',
    innerPack: 'innerPack',
    unit: 'unit',
    category: 'category',
    brand: 'brand',
    upc: 'upc',
  };

  const mapping: CsvColumnMapping = {
    vendorSku: '',
    productName: '',
  };

  const confidence: Record<string, number> = {};

  for (const [aiField, csvField] of Object.entries(fieldAliases)) {
    const headerValue = aiMapping[aiField] || '';
    // Validate the header actually exists
    if (headerValue && headers.includes(headerValue)) {
      (mapping as any)[csvField] = headerValue;
      confidence[csvField] = aiConfidence[aiField] ?? 0.5;
    } else {
      confidence[csvField] = 0;
    }
  }

  return { mapping, confidence: confidence as any, headers };
}

/**
 * Pattern-based column mapping fallback (no AI)
 */
function patternBasedMapping(headers: string[]): ColumnMappingProposal {
  const patterns: Record<keyof CsvColumnMapping, string[]> = {
    vendorSku: ['item', 'item number', 'item code', 'item #', 'sku', 'supc', 'product code', 'code', 'number', 'part number', 'part #', 'part#'],
    productName: ['description', 'product description', 'item description', 'name', 'product name', 'product', 'item name'],
    description: ['extended description', 'long description', 'full description', 'details', 'notes'],
    caseSize: ['pack', 'pack size', 'case pack', 'case size', 'qty', 'quantity', 'count', 'case qty'],
    innerPack: ['inner pack', 'inner pack size', 'inner', 'each size', 'unit size'],
    unit: ['size', 'unit', 'uom', 'unit of measure', 'measure', 'um'],
    price: ['price', 'unit price', 'case price', 'cost', 'each price', 'list price', 'amount'],
    brand: ['brand', 'brand name', 'manufacturer', 'mfr', 'mfg', 'maker'],
    category: ['category', 'category code', 'category id', 'cat', 'class', 'department', 'dept'],
    upc: ['upc', 'upc code', 'gtin', 'barcode', 'ean', 'gtln'],
    variableWeight: ['variable weight', 'catch weight', 'vw', 'cw'],
  };

  const headerLower = headers.map(h => h.toLowerCase().trim());
  const mapping: CsvColumnMapping = { vendorSku: '', productName: '' };
  const confidence: Record<string, number> = {};

  for (const [field, fieldPatterns] of Object.entries(patterns)) {
    for (const pattern of fieldPatterns) {
      const idx = headerLower.findIndex(h => h === pattern);
      if (idx !== -1) {
        (mapping as any)[field] = headers[idx];
        confidence[field] = 0.7;
        break;
      }
    }
    if (!(mapping as any)[field]) {
      // Partial match
      for (const pattern of fieldPatterns) {
        const idx = headerLower.findIndex(h => h.includes(pattern) || pattern.includes(h));
        if (idx !== -1) {
          (mapping as any)[field] = headers[idx];
          confidence[field] = 0.5;
          break;
        }
      }
    }
    if (!confidence[field]) confidence[field] = 0;
  }

  return { mapping, confidence: confidence as any, headers };
}

/**
 * Simple CSV row parser that handles quoted values
 */
function parseSimpleCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
