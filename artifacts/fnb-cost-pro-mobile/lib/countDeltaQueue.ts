/**
 * Pure delta-accumulation queue for native manual count increments.
 *
 * Concurrency policy (approved for Task #986 remediation):
 *  - "+" / "−" stepper interactions are RELATIVE edits. They are accumulated
 *    locally per item, debounced, and flushed as a single `{ addQty: delta }`
 *    PATCH so the SERVER performs the atomic increment. Two devices
 *    incrementing the same line can never overwrite each other — both deltas
 *    land, and each client reconciles its display from the server-returned
 *    quantity.
 *  - Explicit typed input remains an absolute `{ count }` direct-set — that
 *    is intentional "the shelf holds N" semantics (last write wins).
 *
 * This module is deliberately free of React/React-Native imports so the
 * behavior is unit-testable from the API server's vitest suite.
 */

export type FlushDeltaFn = (
  itemId: string,
  delta: number,
) => Promise<number | null>; // resolves to the server's authoritative qty, or null on failure

export interface CountDeltaQueueOptions {
  debounceMs?: number;
  /** Called with the server-authoritative qty after a successful flush. */
  onServerQty?: (itemId: string, qty: number) => void;
  /** Called when a flush fails; the delta is NOT silently retried. */
  onError?: (itemId: string, delta: number) => void;
  /** Injectable timers for tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class CountDeltaQueue {
  private pending: Record<string, number> = {};
  private timers: Record<string, unknown> = {};
  private inFlight: Record<string, Promise<void> | undefined> = {};
  private readonly debounceMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  constructor(
    private readonly flushFn: FlushDeltaFn,
    private readonly options: CountDeltaQueueOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 500;
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => clearTimeout(h as any));
  }

  /** Accumulate a relative delta for an item and (re)schedule its flush. */
  add(itemId: string, delta: number): void {
    if (!itemId || !Number.isFinite(delta) || delta === 0) return;
    this.pending[itemId] = (this.pending[itemId] ?? 0) + delta;
    if (this.timers[itemId] != null) this.clearTimeoutFn(this.timers[itemId]);
    this.timers[itemId] = this.setTimeoutFn(() => {
      void this.flushItem(itemId);
    }, this.debounceMs);
  }

  /** Sum of deltas not yet flushed for an item (0 when none). */
  pendingDelta(itemId: string): number {
    return this.pending[itemId] ?? 0;
  }

  private async flushItem(itemId: string): Promise<void> {
    if (this.timers[itemId] != null) {
      this.clearTimeoutFn(this.timers[itemId]);
      delete this.timers[itemId];
    }
    const delta = this.pending[itemId];
    delete this.pending[itemId];
    if (delta == null || delta === 0) return;

    // Serialise flushes per item so addQty requests cannot arrive out of order.
    const prev = this.inFlight[itemId] ?? Promise.resolve();
    const run = prev.then(async () => {
      try {
        const serverQty = await this.flushFn(itemId, delta);
        if (serverQty == null) {
          this.options.onError?.(itemId, delta);
        } else {
          this.options.onServerQty?.(itemId, serverQty);
        }
      } catch {
        this.options.onError?.(itemId, delta);
      }
    });
    this.inFlight[itemId] = run;
    await run;
    if (this.inFlight[itemId] === run) delete this.inFlight[itemId];
  }

  /** Flush every pending delta immediately (e.g. on navigation/background). */
  async flushAll(): Promise<void> {
    const ids = Object.keys(this.pending);
    await Promise.all(ids.map((id) => this.flushItem(id)));
    // Also wait for any still-running flushes.
    await Promise.all(Object.values(this.inFlight));
  }
}
