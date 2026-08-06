import { db } from "../db";
import { units } from "@workspace/db";

async function run() {
  const rows = await db.select({ id: units.id, name: units.name, kind: units.kind }).from(units).limit(50);
  // @ts-ignore
  console.log(rows.map(r => `${r.name} (${r.kind})`).join("\n"));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
