import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Sends a recipe image to GPT-4o Vision and extracts step-by-step preparation instructions.
 */
export async function extractRecipeInstructions(imageBuffer: Buffer, mimeType: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const base64 = imageBuffer.toString('base64');

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
            text: `You are a culinary assistant. Look at this recipe image and extract the preparation instructions (method/directions/steps).

Return a JSON object with a single key "instructions" containing the step-by-step instructions as a plain text string.
Number each step (e.g. "1. Preheat oven to 375°F.\n2. Mix dry ingredients...").
If no instructions are visible in the image, return an empty string.
Respond ONLY with the JSON object, no markdown.

Example: {"instructions": "1. Preheat oven to 375°F.\n2. Mix flour and sugar.\n3. Bake for 25 minutes."}`,
          },
        ],
      },
    ],
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.instructions || '').trim();
  } catch {
    return '';
  }
}

export interface ExtractedIngredient {
  name: string;
  qty: number;
  unit: string;
}

export interface RecipeScanResult {
  recipeName: string;
  yieldQty: number;
  yieldUnit: string;
  ingredients: ExtractedIngredient[];
}

/**
 * Sends a recipe image buffer to GPT-4o Vision and extracts structured recipe data.
 * Returns recipe name, yield, and ingredient list.
 */
export async function scanRecipeImage(imageBuffer: Buffer, mimeType: string): Promise<RecipeScanResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in environment variables.');
  }

  const base64 = imageBuffer.toString('base64');

  const systemPrompt = `You are a recipe data extraction expert for restaurant inventory systems.
Your task is to extract structured recipe information from an image of a recipe card, handwritten recipe, or printed recipe.

Return a JSON object with this exact structure:
{
  "recipeName": "Clean recipe name (title case)",
  "yieldQty": 1,
  "yieldUnit": "portion",
  "ingredients": [
    {
      "name": "Ingredient name (clean, human-readable)",
      "qty": 2.5,
      "unit": "oz"
    }
  ]
}

Rules:
- recipeName: extract the dish name, use title case
- yieldQty: numeric yield quantity (e.g. 1, 12, 24) — use 1 if unclear
- yieldUnit: unit for the yield (e.g. "portion", "serving", "dozen", "loaf", "quart") — use "portion" if unclear
- ingredients: extract ALL ingredients listed
- qty: numeric quantity as a decimal (e.g. 0.5 for 1/2, 0.25 for 1/4, 2.5 for 2 1/2)
- unit: measurement unit (e.g. "oz", "cup", "lb", "tsp", "tbsp", "each", "bunch", "clove")
- name: clean ingredient name without preparation notes (e.g. "Mozzarella Cheese" not "Mozzarella Cheese, shredded")
- If qty or unit is missing/unclear for an ingredient, use qty: 1 and unit: "each"
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
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  });

  const rawResponse = response.choices[0]?.message?.content || '{}';

  let parsed: Partial<RecipeScanResult & { ingredients?: any[] }>;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  const recipeName = String(parsed.recipeName || 'Untitled Recipe').trim();
  const yieldQty = Number(parsed.yieldQty) || 1;
  const yieldUnit = String(parsed.yieldUnit || 'portion').trim();

  const ingredients: ExtractedIngredient[] = (parsed.ingredients || [])
    .map((ing: any) => ({
      name: String(ing.name || '').trim(),
      qty: Number(ing.qty) || 1,
      unit: String(ing.unit || 'each').trim(),
    }))
    .filter((ing: ExtractedIngredient) => ing.name.length > 0);

  return { recipeName, yieldQty, yieldUnit, ingredients };
}
