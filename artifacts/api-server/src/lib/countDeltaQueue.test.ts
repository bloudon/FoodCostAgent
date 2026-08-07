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
import { CountDeltaQueue, DirectSetQueue } from "../../../fnb-cost-pro-mobile/lib/countDeltaQueue";

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

describe("DirectSetQueue — explicit typed direct-set with server reconciliation", () => {
  function makeSetServer(initial: Record<string, number> = {}) {
    const qty: Record<string, number> = { ...initial };
    return {
      qty,
      async applySet(itemId: string, count: number): Promise<number> {
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        qty[itemId] = count;
        return qty[itemId];
      },
      async applyAddQty(itemId: string, delta: number): Promise<number> {
        qty[itemId] = (qty[itemId] ?? 0) + delta;
        return qty[itemId];
      },
    };
  }

  it("reconciles the local display from the server-returned quantity", async () => {
    const server = makeSetServer({ line1: 5 });
    const reconciled: Array<{ id: string; qty: number }> = [];
    const queue = new DirectSetQueue((id, c) => server.applySet(id, c), {
      ...instantTimers,
      onServerQty: (id, qty) => reconciled.push({ id, qty }),
    });
    queue.set("line1", 12);
    await queue.flushAll();
    expect(server.qty.line1).toBe(12);
    expect(reconciled).toEqual([{ id: "line1", qty: 12 }]);
  });

  it("concurrent-device adds interleaved with a direct-set converge on server truth", async () => {
    // Device A types an absolute value while Device B keeps incrementing.
    const server = makeSetServer({ line1: 10 });
    const reconciled: number[] = [];
    const deviceA = new DirectSetQueue((id, c) => server.applySet(id, c), {
      ...instantTimers,
      onServerQty: (_id, qty) => reconciled.push(qty),
    });
    const deviceB = new CountDeltaQueue((id, d) => server.applyAddQty(id, d), instantTimers);

    deviceA.set("line1", 4); // explicit "shelf holds 4"
    await deviceA.flushAll();
    deviceB.add("line1", 3); // atomic adds land ON TOP of the direct-set
    await deviceB.flushAll();

    expect(server.qty.line1).toBe(7);
    expect(reconciled).toEqual([4]); // device A's display matched server truth at save time
  });

  it("debounces rapid typing into the final absolute value only", async () => {
    const server = makeSetServer({ line1: 0 });
    let calls = 0;
    const queue = new DirectSetQueue(
      (id, c) => {
        calls++;
        return server.applySet(id, c);
      },
      { ...instantTimers },
    );
    queue.set("line1", 1);
    queue.set("line1", 12);
    queue.set("line1", 123);
    await queue.flushAll();
    expect(server.qty.line1).toBe(123);
    expect(calls).toBe(1);
  });

  it("surfaces save failures via onError", async () => {
    const errors: Array<{ id: string; count: number }> = [];
    const queue = new DirectSetQueue(async () => null, {
      ...instantTimers,
      onError: (id, count) => errors.push({ id, count }),
    });
    queue.set("line1", 9);
    await queue.flushAll();
    expect(errors).toEqual([{ id: "line1", count: 9 }]);
  });
});

describe("native count flow source invariants", () => {
  async function read(rel: string): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    return readFileSync(path.resolve(__dirname, "../../../fnb-cost-pro-mobile", rel), "utf8");
  }

  it("item screen steppers use addToCount, not absolute saveCount", async () => {
    const src = await read("app/session/item.tsx");
    const inc = src.slice(src.indexOf("handleIncrement"), src.indexOf("handleInputBlur"));
    expect(inc).toContain("addToCount");
    expect(inc).not.toMatch(/saveCount\(/);
  });

  it("count-list screen reconciles localCounts from the server quantity", async () => {
    const src = await read("app/session/count/[id].tsx");
    const hookCall = src.slice(src.indexOf("useUpdateItemCount(", src.indexOf("export default")));
    // The hook must be given an onServerQty callback that writes back into localCounts.
    expect(hookCall.slice(0, 400)).toContain("setLocalCounts");
  });

  it("catch-weight scan additions use the atomic addQty dialect", async () => {
    const src = await read("components/CatchWeightScanModal.tsx");
    expect(src).toContain("addQty");
  });

  it("the manual-count hook sends absolute counts only through DirectSetQueue", async () => {
    const src = await read("hooks/useUpdateItemCount.ts");
    expect(src).toContain("DirectSetQueue");
    expect(src).toContain("CountDeltaQueue");
    // No hand-rolled debounced absolute PATCH remains.
    expect(src).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?patch\(/);
  });
});
