// Generate stable, URL-safe targets for count-session category and location sections.
export function generateCountSectionAnchor(prefix: string, value: string): string {
  if (/^[a-z0-9-]+$/i.test(value)) {
    return `${prefix}-${value}`;
  }

  const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const hash = value.split("").reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
  return `${prefix}-${sanitized}-${Math.abs(hash)}`;
}