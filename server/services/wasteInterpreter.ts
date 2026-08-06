import OpenAI from 'openai';
import { z } from 'zod';
import { recordAiTokenUsage, type AiMeter } from '../aiUsage';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const TRANSCRIPTION_MODEL =
  (process.env.WASTE_TRANSCRIPTION_MODEL as string | undefined) ?? 'gpt-4o-mini-transcribe';
export const INTERPRETATION_MODEL = 'gpt-4o';

// Resolution thresholds — tune with real utterance tests
const RESOLVE_SCORE_MIN = 0.75;
const RESOLVE_MARGIN_MIN = 0.15;
const AMBIGUOUS_SCORE_MIN = 0.40;

// ─── Transcription ────────────────────────────────────────────────────────────

/**
 * Transcribe an audio buffer using the configured OpenAI transcription model.
 * Returns the transcript string and the model name used.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  fileExtension: string,
): Promise<{ transcript: string; model: string }> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const file = new File([audioBuffer], `recording.${fileExtension}`, { type: mimeType });

  // The OpenAI SDK audio transcriptions endpoint accepts a File/Blob
  const response = await (openai.audio.transcriptions.create as Function)({
    model: TRANSCRIPTION_MODEL,
    file,
    prompt:
      'Restaurant inventory and waste report. Expect food names, menu items, vendor products, quantities, pounds, ounces, cases, eaches, gallons, spoilage, overproduction and damage.',
    response_format: 'text',
  });

  const transcript =
    typeof response === 'string'
      ? response
      : (response as { text?: string }).text ?? '';

  return { transcript: transcript.trim(), model: TRANSCRIPTION_MODEL };
}

// ─── Extraction ───────────────────────────────────────────────────────────────

export const WASTE_REASONS = [
  'SPOILED',
  'DAMAGED',
  'OVERPRODUCTION',
  'DROPPED',
  'CUSTOMER_COMPLAINT',
  'QUALITY',
  'OTHER',
] as const;
export type WasteReason = typeof WASTE_REASONS[number];

const spokenEntrySchema = z.object({
  sourceText: z.string(),
  wasteType: z.enum(['inventory', 'menu_item']).nullable(),
  spokenItem: z.string().min(1),
  qty: z.number().positive().nullable(),
  spokenUnit: z.string().nullable(),
  reasonCode: z.enum(WASTE_REASONS).nullable(),
  notes: z.string().nullable(),
});

const extractionResponseSchema = z.object({
  entries: z.array(spokenEntrySchema),
});

export type SpokenEntry = z.infer<typeof spokenEntrySchema>;

/**
 * Call GPT to extract structured waste entries from a plain-text transcript.
 * Uses json_object response format + Zod validation so missing values are null,
 * never invented.
 */
export async function extractSpokenWasteEntries(
  rawTranscript: string,
  meter?: AiMeter,
): Promise<{ entries: SpokenEntry[]; model: string }> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const transcript = rawTranscript.slice(0, 5000);

  const response = await openai.chat.completions.create({
    model: INTERPRETATION_MODEL,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a restaurant waste-log assistant. Parse spoken waste reports into structured entries.

Rules:
- Extract every distinct waste event as a separate entry.
- "wasteType": "inventory" for raw ingredients (chicken breast, tomatoes, cream); "menu_item" for prepared dishes (salmon entrée, burger); null if unclear.
- "spokenItem": the item name exactly as spoken.
- "qty": numeric quantity; null if not stated.
- "spokenUnit": unit as spoken (pounds, lbs, cases, eaches, portions); null if not stated.
- "reasonCode": one of SPOILED, DAMAGED, OVERPRODUCTION, DROPPED, CUSTOMER_COMPLAINT, QUALITY, OTHER; null if not clear.
- "notes": extra context from the speech; null if none.
- "sourceText": the exact phrase in the transcript this entry came from.
- Return at most 10 entries.
- Use null for any field you cannot determine — never guess.

Return ONLY valid JSON: { "entries": [ ... ] }`,
      },
      { role: 'user', content: transcript },
    ],
  });

  void recordAiTokenUsage(meter, 'waste_interpret', INTERPRETATION_MODEL, response.usage);

  const raw = response.choices[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], model: INTERPRETATION_MODEL };
  }

  const validated = extractionResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { entries: [], model: INTERPRETATION_MODEL };
  }

  return {
    entries: validated.data.entries.slice(0, 10),
    model: INTERPRETATION_MODEL,
  };
}

// ─── Resolution ───────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function scoreCandidate(needle: string, candidate: string): number {
  const n = needle.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();
  if (!n || !c) return 0;
  if (n === c) return 1.0;
  if (c.startsWith(n) || n.startsWith(c)) return 0.85;
  if (c.includes(n) || n.includes(c)) return 0.75;
  const sim =
    1 - levenshtein(n, c) / Math.max(n.length, c.length, 1);
  return Math.max(0, sim) * 0.7; // cap fuzzy-only at 0.7
}

/** Expand a spoken unit word to its normalized variants for matching. */
function spokenUnitVariants(spoken: string): string[] {
  const s = spoken.toLowerCase().trim();
  const aliases: [string[], string[]][] = [
    [['lb', 'lbs', 'pound', 'pounds'], ['lb', 'pound']],
    [['oz', 'ozs', 'ounce', 'ounces'], ['oz', 'ounce']],
    [['gal', 'gallon', 'gallons'], ['gal', 'gallon']],
    [['qt', 'quart', 'quarts'], ['qt', 'quart']],
    [['pt', 'pint', 'pints'], ['pt', 'pint']],
    [['l', 'liter', 'liters', 'litre', 'litres'], ['l', 'liter']],
    [['ml', 'milliliter', 'milliliters', 'millilitre'], ['ml', 'milliliter']],
    [['g', 'gram', 'grams'], ['g', 'gram']],
    [['kg', 'kilogram', 'kilograms'], ['kg', 'kilogram']],
    [['ea', 'each', 'eaches', 'pc', 'piece', 'pieces', 'item', 'items', 'portion', 'portions', 'serving', 'servings'], ['ea', 'each']],
    [['cs', 'case', 'cases'], ['cs', 'case']],
    [['cup', 'cups'], ['cup']],
    [['tbsp', 'tablespoon', 'tablespoons'], ['tbsp', 'tablespoon']],
    [['tsp', 'teaspoon', 'teaspoons'], ['tsp', 'teaspoon']],
    [['fl oz', 'fluid ounce', 'fluid ounces', 'floz'], ['fl oz', 'fluid ounce']],
  ];
  for (const [inputs, outputs] of aliases) {
    if (inputs.includes(s)) return outputs;
  }
  return [s];
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'needs_unit';

export interface ResolvedEntry {
  sourceText: string;
  wasteType: 'inventory' | 'menu_item' | null;
  spokenItem: string;
  qty: number | null;
  spokenUnit: string | null;
  reasonCode: string | null;
  notes: string | null;
  resolutionStatus: ResolutionStatus;
  itemId: string | null;
  itemName: string | null;
  categoryId: string | null;
  department: string | null;
  /**
   * The unit the voice interpreter resolved the spoken unit to.
   * May be the canonical unit OR a configured alternate unit for this item.
   * Null when resolutionStatus is "needs_unit" (spoken unit incompatible).
   */
  unitId: string | null;
  unitName: string | null;
  /**
   * The item's canonical unit (the one the waste form always submits in).
   * Populated for inventory items only. Use to detect when unitId ≠ canonicalUnitId
   * so the client can clear the qty field and ask the user to re-enter.
   */
  canonicalUnitId: string | null;
  canonicalUnitName: string | null;
  matchScore: number;
  matchMargin: number;
  candidates: {
    itemId: string;
    itemName: string;
    wasteType: 'inventory' | 'menu_item';
    score: number;
  }[];
  warnings: string[];
}

export interface ResolveInput {
  inventoryItems: {
    id: string;
    name: string;
    categoryId: string | null;
    unitId: string;
    active: number;
  }[];
  menuItems: {
    id: string;
    name: string;
    department: string | null;
    active: number;
  }[];
  units: { id: string; name: string; abbreviation: string }[];
  itemUnits: { inventoryItemId: string; unitId: string }[];
  entries: SpokenEntry[];
}

/**
 * Resolve spoken waste entries against the company's active item catalog.
 * Returns one ResolvedEntry per input SpokenEntry.
 */
export function resolveSpokenWasteEntries(input: ResolveInput): ResolvedEntry[] {
  const { inventoryItems, menuItems, units, itemUnits, entries } = input;

  const activeInventory = inventoryItems.filter(i => i.active !== 0);
  const activeMenu = menuItems.filter(m => (m as any).active !== 0 && (m as any).active !== false);

  // Build itemId → Set<unitId> (canonical + configured extras)
  const itemUnitMap = new Map<string, Set<string>>();
  for (const inv of activeInventory) {
    itemUnitMap.set(inv.id, new Set([inv.unitId]));
  }
  for (const iu of itemUnits) {
    if (!itemUnitMap.has(iu.inventoryItemId)) {
      itemUnitMap.set(iu.inventoryItemId, new Set());
    }
    itemUnitMap.get(iu.inventoryItemId)!.add(iu.unitId);
  }

  return entries.map(entry => {
    const warnings: string[] = [];

    type PoolItem = {
      id: string;
      name: string;
      wasteType: 'inventory' | 'menu_item';
      categoryId?: string | null;
      unitId?: string;
      department?: string | null;
    };

    let pool: PoolItem[];
    if (entry.wasteType === 'inventory') {
      pool = activeInventory.map(i => ({
        id: i.id,
        name: i.name,
        wasteType: 'inventory' as const,
        categoryId: i.categoryId,
        unitId: i.unitId,
      }));
    } else if (entry.wasteType === 'menu_item') {
      pool = activeMenu.map(m => ({
        id: m.id,
        name: m.name,
        wasteType: 'menu_item' as const,
        department: m.department,
      }));
    } else {
      // Search both pools when wasteType is unknown
      pool = [
        ...activeInventory.map(i => ({
          id: i.id,
          name: i.name,
          wasteType: 'inventory' as const,
          categoryId: i.categoryId,
          unitId: i.unitId,
        })),
        ...activeMenu.map(m => ({
          id: m.id,
          name: m.name,
          wasteType: 'menu_item' as const,
          department: m.department,
        })),
      ];
    }

    const scored = pool
      .map(p => ({ ...p, score: scoreCandidate(entry.spokenItem, p.name) }))
      .sort((a, b) => b.score - a.score);

    const topScore = scored[0]?.score ?? 0;
    const secondScore = scored[1]?.score ?? 0;
    const margin = topScore - secondScore;
    const top = scored[0] ?? null;

    const topCandidates = scored.slice(0, 5).map(s => ({
      itemId: s.id,
      itemName: s.name,
      wasteType: s.wasteType,
      score: Math.round(s.score * 1000) / 1000,
    }));

    let resolutionStatus: ResolutionStatus;
    if (topScore >= RESOLVE_SCORE_MIN && margin >= RESOLVE_MARGIN_MIN) {
      resolutionStatus = 'resolved';
    } else if (topScore >= AMBIGUOUS_SCORE_MIN) {
      resolutionStatus = 'ambiguous';
    } else {
      resolutionStatus = 'unresolved';
    }

    let itemId: string | null = null;
    let itemName: string | null = null;
    let categoryId: string | null = null;
    let department: string | null = null;
    let unitId: string | null = null;
    let unitName: string | null = null;
    let canonicalUnitId: string | null = null;
    let canonicalUnitName: string | null = null;

    if (resolutionStatus !== 'unresolved' && top) {
      itemId = top.id;
      itemName = top.name;
      categoryId = top.categoryId ?? null;
      department = top.department ?? null;

      // Unit resolution — only for inventory items
      if (top.wasteType === 'inventory' && top.unitId) {
        const itemCanonicalUnitId = top.unitId;
        const itemCanonicalUnit = units.find(u => u.id === itemCanonicalUnitId);
        const compatibleUnitIds = itemUnitMap.get(top.id) ?? new Set([itemCanonicalUnitId]);

        // Always expose the canonical unit so the client can detect mismatches
        canonicalUnitId = itemCanonicalUnitId;
        canonicalUnitName = itemCanonicalUnit?.name ?? null;

        if (entry.spokenUnit) {
          const variants = spokenUnitVariants(entry.spokenUnit);
          const matched = units
            .filter(u => compatibleUnitIds.has(u.id))
            .find(u =>
              variants.some(
                v =>
                  u.name.toLowerCase() === v ||
                  u.abbreviation.toLowerCase() === v ||
                  u.name.toLowerCase().startsWith(v) ||
                  v.startsWith(u.abbreviation.toLowerCase()),
              ),
            );

          if (matched) {
            unitId = matched.id;
            unitName = matched.name;
          } else {
            resolutionStatus = 'needs_unit';
            warnings.push(
              itemCanonicalUnit
                ? `Item is configured in ${itemCanonicalUnit.name}. No matching "${entry.spokenUnit}" conversion found.`
                : `No matching "${entry.spokenUnit}" unit found for this item.`,
            );
          }
        } else {
          // No unit spoken — default to canonical
          unitId = itemCanonicalUnitId;
          unitName = itemCanonicalUnit?.name ?? null;
        }
      }
    }

    // When an item was successfully resolved, use the matched item's concrete type
    // (inventory | menu_item) regardless of what the extractor guessed.  This
    // prevents null wasteType on the client when the model left the field null but
    // the catalog match unambiguously identified the item type.
    const effectiveWasteType: 'inventory' | 'menu_item' | null =
      resolutionStatus !== 'unresolved' && top != null
        ? top.wasteType
        : entry.wasteType;

    return {
      sourceText: entry.sourceText,
      wasteType: effectiveWasteType,
      spokenItem: entry.spokenItem,
      qty: entry.qty,
      spokenUnit: entry.spokenUnit,
      reasonCode: entry.reasonCode,
      notes: entry.notes,
      resolutionStatus,
      itemId,
      itemName,
      categoryId,
      department,
      unitId,
      unitName,
      canonicalUnitId,
      canonicalUnitName,
      matchScore: Math.round(topScore * 1000) / 1000,
      matchMargin: Math.round(margin * 1000) / 1000,
      candidates: topCandidates,
      warnings,
    };
  });
}
