import { db } from "./db";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "@neondatabase/serverless";
import type * as schema from "@shared/schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";

type Transaction = PgTransaction<
  NeonQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Transaction wrapper for critical multi-step operations
 * Ensures atomic database operations under concurrent access
 * 
 * Example usage:
 * ```typescript
 * const result = await withTransaction(async (tx) => {
 *   const count = await tx.insert(inventoryCounts).values(data).returning();
 *   await tx.insert(inventoryCountLines).values(lines);
 *   return count[0];
 * });
 * ```
 */
export async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return await callback(tx);
  });
}
