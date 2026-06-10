# AI Scanning & Import Processes

A portable reference for the document scanning, AI extraction, and fuzzy-matching pipeline used in FNB Cost Pro. Copy this into any application that needs similar functionality.

---

## Overview

Three document types are supported, each with a dedicated AI extraction path:

| Document Type | Input | AI Model | Endpoint |
|---|---|---|---|
| Vendor Invoice / Order Guide | Image (JPG, PNG, WebP) | GPT-4o Vision | `POST /api/order-guides/scan-image` |
| Vendor Catalog | Text-based PDF | pdf-parse (local) | `POST /api/order-guides/process-pdf` |
| Menu | Image | GPT-4o Vision | `POST /api/menu-import/scan` |
| Recipe Card | Image | GPT-4o Vision | `POST /api/recipe-import/scan` |

All flows follow the same three-stage pattern:  
**Extract → Match → Review**

---

## Stage 1 — Extract

### Image-Based (Invoices, Menus, Recipe Cards)

1. User uploads image(s) via the file picker (JPG, PNG, WebP, up to 10 MB; multiple files for multi-page invoices).
2. Image is stored in object storage. The `objectPath` is sent to the server.
3. Server retrieves the image buffer and sends it to GPT-4o Vision with a domain-specific prompt.
4. AI returns a structured JSON payload.

#### Invoice / Order Guide Prompt (key instructions)

```
You are a vendor invoice / order guide data extraction expert.
Extract all product line items from this document.

Rules:
- Clean up abbreviations (e.g. "BCN SLCD 15/18" → "Sliced Bacon 15/18 Count")
- Prioritize the CASE price column; set priceType: "case"
- Only populate unitPrice if it is explicitly shown separately
- Include pack size descriptions where visible (e.g. "6/10 lb", "4/1 gal")
```

#### Invoice JSON Response Shape

```json
{
  "vendorName": "string",
  "items": [
    {
      "name": "string",
      "sku": "string",
      "casePrice": 0.00,
      "unitPrice": 0.00,
      "priceType": "case | unit",
      "packSizeDescription": "string",
      "unit": "string",
      "categoryHint": "string"
    }
  ]
}
```

#### Menu Prompt (key instructions)

```
Extract all food and beverage items with their prices.
Handle size variants (e.g. "Sm $10 | Lg $15") as separate entries
linked by a variantGroupKey.
Also extract business metadata: phone, address, multi-location signals.
```

#### Recipe Card Prompt (key instructions)

```
Extract: recipeName, yieldQty, yieldUnit, ingredients (qty + unit + name),
and step-by-step instructions.
Convert fractions to decimals (1/2 → 0.5).
Strip preparation notes from ingredient names
("Mozzarella Cheese, shredded" → "Mozzarella Cheese").
```

---

### PDF-Based (Vendor Catalogs)

Text-based PDFs are parsed locally — no AI Vision call, no per-page cost, instant results for any page count.

#### Parser State Machine

The parser expects product blocks in this order:

```
Product Name           ← one or more lines accumulated
SKU: VENDOR-SKU        ← triggers SKU capture
[status line]          ← silently skipped (In Stock, Out of Stock, etc.)
$XX.XX                 ← triggers product commit
Qty:                   ← garbage-filtered
```

#### Garbage Filter Patterns

Lines matching any of the following are discarded before parsing:

```
/^qty:?$/i
/^add to cart$/i
/^\d+ to \d+ of \d+ results$/i
/^prev(\s+\d+)+/i  or  /^(\d+\s+)+next$/i
/^[\d\s]+$/          ← pure pagination numbers
/^(in stock|out of stock|call for availability)$/i
/^all products$/i
/^(home|search|sort by|filter|category:|showing \d|price:)/i
```

#### PDF Parsed Output Shape

```typescript
interface PdfProduct {
  productName: string;
  vendorSku: string;
  price: number | null;
}

interface PdfParseResult {
  products: PdfProduct[];
  pageCount: number;
}
```

#### Loading pdf-parse in an ESM Project

`pdf-parse` is a CommonJS module. In a project with `"type": "module"` use `createRequire` to avoid ESM interop errors:

```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer, opts?: object) => Promise<{ text: string; numpages: number }>;
```

> Do **not** use `(await import('pdf-parse')).default` — this returns `undefined` on some Node.js versions.

---

## Stage 2 — Vendor Auto-Detection

After extraction the system tries to identify which vendor supplied the document by comparing the AI-extracted `vendorName` string against known vendors.

**Algorithm: token-based Jaccard similarity**

```typescript
function vendorSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const tokensA = new Set(normalize(a).split(/\s+/));
  const tokensB = new Set(normalize(b).split(/\s+/));
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

**Threshold:** score ≥ 0.4 → vendor auto-selected; below that → user picks manually.

---

## Stage 3 — Item Matching (Fuzzy)

Each extracted item is compared against existing inventory items in the database.

### Normalization

```typescript
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
```

### Scoring

Composite score from two signals:

| Signal | Weight | Description |
|---|---|---|
| Jaccard (word sets) | Primary | Intersection ÷ Union of word tokens |
| Substring bonus | Secondary | +0.15 if one name contains the other |

### Confidence Tiers

| Score | Tier | Action |
|---|---|---|
| ≥ 0.6 | High — **Auto-match** | Linked automatically |
| 0.35 – 0.59 | Medium — **Ambiguous** | User confirms the match |
| < 0.35 | None — **New item** | User creates or skips |

---

## Review Flow

After extraction and matching, a `pending_review` record is created with all line items classified into three buckets:

- **Matched** — high-confidence link to an existing inventory item; price updated on approval
- **Needs Review** — ambiguous; user selects the correct item from a short list
- **Unmatched** — new; user can create a new inventory item or skip

The user steps through each bucket in a wizard UI and submits. On final approval:
- Matched items: `lastCasePrice` and `lastPrice` (unit) are updated on the inventory item
- New items: new inventory item records are created (if the user chooses)
- The order guide record moves from `pending_review` → `active`

---

## Unit Price Derivation

Case price is the primary field. Unit price is derived:

```
unitPrice = casePrice ÷ (caseSize × innerPackSize)
```

- `lastCasePrice` stores the raw case price
- `lastPrice` stores the derived unit price (4 decimal precision)

---

## File Upload Constraints

| Parameter | Value |
|---|---|
| Accepted image types | `image/jpeg`, `image/png`, `image/webp` |
| Accepted document types | `application/pdf` |
| Max file size | 20 MB |
| Multi-file support | Yes (images only; all pages sent sequentially) |

### Multer Configuration (Express)

```typescript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});
```

### PDF Magic Byte Validation (Server-Side)

Always validate before parsing to reject non-PDF content with a PDF extension:

```typescript
function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 &&
    buf[0] === 0x25 && buf[1] === 0x50 &&
    buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}
```

---

## Key Source Files (FNB Cost Pro reference)

| File | Purpose |
|---|---|
| `server/services/vendorReceiptScanner.ts` | GPT-4o Vision invoice extraction + prompt |
| `server/integrations/pdf/PdfOrderGuide.ts` | PDF text extraction + state-machine parser |
| `server/services/itemMatcher.ts` | Fuzzy item matching algorithm |
| `server/lib/invoiceScanHandler.ts` | Onboarding invoice scan handler |
| `server/services/menuScanner.ts` | Menu image extraction prompt |
| `server/services/recipeScanner.ts` | Recipe card extraction prompt |
| `client/src/pages/order-guide-scan.tsx` | Upload + scan UI (Configure step) |
| `client/src/pages/OrderGuideReview.tsx` | Match review UI (Review step) |
| `client/src/components/ObjectUploader.tsx` | Reusable file upload component |
