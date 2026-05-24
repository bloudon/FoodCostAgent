/**
 * Unit tests for the menuRecipeSeeder tokenizeDescription utility.
 *
 * These are pure-function tests — no database or HTTP calls are made.
 */
import { describe, it, expect } from "vitest";
import { tokenizeDescription } from "./menuRecipeSeeder";

describe("tokenizeDescription", () => {
  it("returns an empty array for an empty string", () => {
    expect(tokenizeDescription("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(tokenizeDescription("   ")).toEqual([]);
  });

  it("splits a simple comma-separated description", () => {
    const result = tokenizeDescription("garlic oil, pesto, fresh mozzarella");
    expect(result).toEqual(["garlic oil", "pesto", "mozzarella"]);
  });

  it("strips the leading 'fresh' preparation prefix", () => {
    const result = tokenizeDescription("fresh mozzarella, grilled chicken");
    expect(result).toContain("mozzarella");
    expect(result).toContain("chicken");
  });

  it("strips the leading 'grilled' preparation prefix", () => {
    const result = tokenizeDescription("grilled salmon, lemon butter");
    expect(result).toContain("salmon");
    expect(result).toContain("lemon butter");
  });

  it("strips the leading 'served with' preparation phrase", () => {
    const result = tokenizeDescription("served with roasted potatoes, green beans");
    expect(result).toContain("roasted potatoes");
    expect(result).toContain("green beans");
  });

  it("strips the leading 'topped with' preparation phrase", () => {
    const result = tokenizeDescription("topped with hollandaise, chives");
    expect(result).toContain("hollandaise");
    expect(result).toContain("chives");
  });

  it("removes price callouts from tokens", () => {
    const result = tokenizeDescription("bacon +$2, avocado $3, lettuce");
    expect(result).toContain("bacon");
    expect(result).toContain("avocado");
    expect(result).toContain("lettuce");
    // No token should contain a dollar sign
    expect(result.every(t => !t.includes("$"))).toBe(true);
  });

  it("filters out tokens that are too short (< 3 chars)", () => {
    const result = tokenizeDescription("ab, garlic, xy");
    expect(result).not.toContain("ab");
    expect(result).not.toContain("xy");
    expect(result).toContain("garlic");
  });

  it("filters out pure measurement tokens", () => {
    const result = tokenizeDescription("4 oz, chicken breast, 2 tbsp");
    expect(result).toContain("chicken breast");
    expect(result).not.toContain("4 oz");
    expect(result).not.toContain("2 tbsp");
  });

  it("handles a realistic menu description", () => {
    // "crispy flatbread" → "flatbread" (prep prefix stripped)
    // "fresh mozzarella" → "mozzarella" (prep prefix stripped)
    // "grilled chicken"  → "chicken"   (prep prefix stripped)
    const desc = "crispy flatbread, garlic oil, pesto, fresh mozzarella, grilled chicken, balsamic glaze";
    const result = tokenizeDescription(desc);
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result).toContain("flatbread");
    expect(result).toContain("garlic oil");
    expect(result).toContain("pesto");
    expect(result).toContain("mozzarella");
    expect(result).toContain("chicken");
    expect(result).toContain("balsamic glaze");
  });

  it("handles trailing and leading whitespace around tokens", () => {
    const result = tokenizeDescription("  onion rings ,  chipotle mayo ,  pickles  ");
    expect(result).toContain("onion rings");
    expect(result).toContain("chipotle mayo");
    expect(result).toContain("pickles");
  });

  it("applies prep-prefix stripping twice for compound phrases", () => {
    const result = tokenizeDescription("with fresh basil, garlic");
    expect(result).toContain("basil");
    expect(result).toContain("garlic");
  });

  it("splits on periods in addition to commas", () => {
    const result = tokenizeDescription("Bbq sauce. served with coleslaw and french fries.");
    expect(result).toContain("Bbq sauce");
    expect(result).toContain("coleslaw");
    expect(result).toContain("french fries");
    expect(result.every(t => !t.includes("served with"))).toBe(true);
  });

  it("extracts main item and accompaniments from period-separated clause", () => {
    const result = tokenizeDescription("Bleu cheese crumbles. topped with chimichurri glaze.");
    expect(result).toContain("Bleu cheese crumbles");
    expect(result).toContain("chimichurri glaze");
    expect(result.every(t => !t.includes("topped with"))).toBe(true);
  });

  it("splits on mid-token 'with' to separate main item from accompaniments", () => {
    const result = tokenizeDescription("Breaded chicken breast with marinara and alfredo sauce");
    expect(result).toContain("Breaded chicken breast");
    expect(result).toContain("marinara");
    expect(result).toContain("alfredo sauce");
  });

  it("splits 'and'-joined list after 'served with'", () => {
    const result = tokenizeDescription("burger patty. served with lettuce and tomato and pickles.");
    expect(result).toContain("burger patty");
    expect(result).toContain("lettuce");
    expect(result).toContain("tomato");
    expect(result).toContain("pickles");
  });
});
