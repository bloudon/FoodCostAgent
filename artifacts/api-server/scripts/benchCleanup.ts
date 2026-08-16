import 'dotenv/config';
import { eq, inArray, like } from 'drizzle-orm';
async function main() {
  const { assertBenchDatabaseAllowed } = await import('./benchGuard');
  assertBenchDatabaseAllowed('benchCleanup');
  const runId = process.argv[2];
  if (!runId || !/^bench-[a-z0-9]+$/.test(runId)) {
    throw new Error('usage: tsx scripts/benchCleanup.ts <bench-RUNID> — an explicit run id is required; refusing to sweep all bench-%% tenants');
  }
  const { db } = await import('../src/db');
  const s: any = await import('@workspace/db');
  const cos = await db.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.id, `${runId}-co`));
  for (const { id } of cos) {
    console.log('cleaning', id);
    const items = await db.select({ id: s.inventoryItems.id }).from(s.inventoryItems).where(eq(s.inventoryItems.companyId, id));
    const ids = items.map((r: any) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const c = ids.slice(i, i + 500);
      await db.delete(s.inventoryCountLines).where(inArray(s.inventoryCountLines.inventoryItemId, c));
      await db.delete(s.inventoryItemLocations).where(inArray(s.inventoryItemLocations.inventoryItemId, c));
      await db.delete(s.inventoryItemLocationAssignments).where(inArray(s.inventoryItemLocationAssignments.inventoryItemId, c));
      await db.delete(s.storeInventoryItems).where(inArray(s.storeInventoryItems.inventoryItemId, c));
      await db.delete(s.inventoryItemExternalMappings).where(inArray(s.inventoryItemExternalMappings.inventoryItemId, c));
      await db.delete(s.inventoryImportRows).where(inArray(s.inventoryImportRows.resolvedInventoryItemId, c));
    }
    await db.delete(s.inventoryItemRemediationAudit).where(eq(s.inventoryItemRemediationAudit.companyId, id));
    await db.delete(s.inventoryCounts).where(eq(s.inventoryCounts.companyId, id));
    await db.delete(s.inventoryImportBatches).where(eq(s.inventoryImportBatches.companyId, id));
    for (let i = 0; i < ids.length; i += 500) await db.delete(s.inventoryItems).where(inArray(s.inventoryItems.id, ids.slice(i, i + 500)));
    await db.delete(s.storageLocations).where(eq(s.storageLocations.companyId, id));
    await db.delete(s.inventoryLocations).where(eq(s.inventoryLocations.companyId, id));
    await db.delete(s.importSourcePropertyBindings).where(eq(s.importSourcePropertyBindings.companyId, id));
    await db.delete(s.users).where(like(s.users.id, id.replace('-co', '-admin')));
    await db.delete(s.companyStores).where(eq(s.companyStores.companyId, id));
    await db.delete(s.companies).where(eq(s.companies.id, id));
  }
  console.log('done, cleaned', cos.length);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
