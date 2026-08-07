/**
 * Regression test for the Task #986 completion-review finding that native
 * manual +/- count edits raced: each device PATCHed a client-computed
 * absolute `{ count }`, so simultaneous increments lost updates.
 *
 * The fix: steppers accumulate RELATIVE deltas in CountDeltaQueue (a pure
 * module shared with the mobile app) and flush them as `{ addQty }` so the
 * server performs the atomic increment. These tests simulate two devices
 * incrementing the same line simultaneously against a shared server counter
 * and assert convergence — the exact scenario that previously lost updates.
 */

import { describe, it, expect } from "vitest";
import { CountDeltaQueue } from "../../../fnb-cost-pro-mobile/lib/countDeltaQueue";

/** Immediate-flush timers so tests don't need fake clocks. */
const instantTimers = {
  setTimeoutFn: (fn: () => void) => {
    const h = { cancelled: false };
    queueMicrotask(() => {
      if (!h.cancelled) fn();
    });
    return h;
  },
  clearTimeoutFn: (h: unknown) => {
    (h as { cancelled: boolean }).cancelled = true;
  },
};

function makeServer(initial: Record<string, number> = {}) {
  const qty: Record<string, number> = { ...initial };
  return {
    qty,
    /** Atomic server-side increment, like storage.atomicIncrementCountLineQty. */
    async applyAddQty(itemId: string, delta: number): Promise<number> {
      await new Promise((r) => setTimeout(r, Math.random() * 5)); // network jitter
      qty[itemId] = (qty[itemId] ?? 0) + delta;
      return qty[itemId];
    },
  };
}

describe("CountDeltaQueue — simultaneous manual native increments", () => {
  it("two devices incrementing the same line concurrently lose no updates", async () => {
    const server = makeServer({ line1: 10 });

    const deviceA = new CountDeltaQueue((id, d) => server.applyAddQty(id, d), instantTimers);
    const deviceB = new CountDeltaQueue((id, d) => server.applyAddQty(id, d), instantTimers);

    // Both devices tap "+" 5 times at the same moment.
    for (let i = 0; i < 5; i++) {
      deviceA.add("line1", 1);
      deviceB.add("line1", 1);
    }
    await Promise.all([deviceA.flushAll(), deviceB.flushAll()]);

    // Absolute writes would have produced 15 (one device's sum overwritten).
    expect(server.qty.line1).toBe(20);
  });

  it("reconciles the display from the server-returned quantity", async () => {
    const server = makeServer({ line1: 3 });
    const reconciled: Array<{ id: string; qty: number }> = [];

    const queue = new CountDeltaQueue((id, d) => server.applyAddQty(id, d), {
      ...instantTimers,
      onServerQty: (id, qty) => reconciled.push({ id, qty }),
    });

    // Another device's increment lands first — our client's local view (3) is stale.
    await server.applyAddQty("line1", 4); // server now 7

    queue.add("line1", 1);
    await queue.flushAll();

    expect(server.qty.line1).toBe(8);
    expect(reconciled).toEqual([{ id: "line1", qty: 8 }]); // display converges to server truth
  });

  it("coalesces rapid taps into a single delta and handles mixed +/-", async () => {
    const server = makeServer({ line1: 0 });
    let calls = 0;
    const queue = new CountDeltaQueue(
      (id, d) => {
        calls++;
        return server.applyAddQty(id, d);
      },
      { ...instantTimers },
    );

    queue.add("line1", 1);
    queue.add("line1", 1);
    queue.add("line1", -1);
    queue.add("line1", 1);
    await queue.flushAll();

    expect(server.qty.line1).toBe(2);
    expect(calls).toBe(1); // debounced into one atomic addQty
  });

  it("surfaces flush failures via onError instead of silently dropping", async () => {
    const errors: Array<{ id: string; delta: number }> = [];
    const queue = new CountDeltaQueue(async () => null, {
      ...instantTimers,
      onError: (id, delta) => errors.push({ id, delta }),
    });
    queue.add("line1", 2);
    await queue.flushAll();
    expect(errors).toEqual([{ id: "line1", delta: 2 }]);
  });
});

describe("native stepper source invariant", () => {
  it("item screen steppers use addToCount, not absolute saveCount", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.resolve(__dirname, "../../../fnb-cost-pro-mobile/app/session/item.tsx"),
      "utf8",
    );
    const inc = src.slice(src.indexOf("handleIncrement"), src.indexOf("handleInputBlur"));
    expect(inc).toContain("addToCount");
    expect(inc).not.toMatch(/saveCount\(/);
  });
});
