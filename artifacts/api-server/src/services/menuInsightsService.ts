export const BATCH_PREP_KEYWORDS = [
  "dough",
  "sauce",
  "mix",
  "stock",
  "broth",
  "marinade",
  "base",
  "blend",
  "glaze",
  "rub",
  "spread",
  "vinaigrette",
  "aioli",
  "puree",
  "reduction",
];

export const SIDE_DEPT_KEYWORDS = ["side", "add", "modifier", "extra"];

export function classifyToken(token: string): "batch_prep" | "direct_item" {
  const lower = token.toLowerCase();
  return BATCH_PREP_KEYWORDS.some((kw) => lower.includes(kw))
    ? "batch_prep"
    : "direct_item";
}

export function isExcludedFromAvgPrice(
  price: number | null | undefined,
  departmentName: string | null | undefined,
): boolean {
  if (price == null || price === 0 || price < 1.0) return true;
  if (!departmentName) return false;
  const lower = departmentName.toLowerCase();
  return SIDE_DEPT_KEYWORDS.some((kw) => lower.includes(kw));
}
