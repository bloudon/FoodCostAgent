import { describe, expect, it } from "vitest";
import { mergeUpdatedCountLineIntoCache } from "./count-line-cache";

describe("mergeUpdatedCountLineIntoCache", () => {
  const cachedLine = {
    id: "line-1",
    qty: 2,
    inventoryItem: { name: "Apples" },
    entries: [{ id: "old-entry", qty: 2 }],
  };

  it("replaces direct-set entry history with the canonical PATCH response", () => {
    const result = mergeUpdatedCountLineIntoCache([cachedLine], {
      id: "line-1",
      qty: 7,
      entries: [{ id: "replacement-entry", qty: 7 }],
    });

    expect(result?.[0]).toEqual({
      ...cachedLine,
      qty: 7,
      entries: [{ id: "replacement-entry", qty: 7 }],
    });
  });

  it("keeps every accumulated entry returned after repeated additions", () => {
    const result = mergeUpdatedCountLineIntoCache([cachedLine], {
      id: "line-1",
      qty: 5,
      entries: [
        { id: "old-entry", qty: 2 },
        { id: "addition-1", qty: 1 },
        { id: "addition-2", qty: 2 },
      ],
    });

    expect(result?.[0].entries).toHaveLength(3);
    expect(result?.[0].qty).toBe(5);
    expect(result?.[0].inventoryItem.name).toBe("Apples");
  });
});