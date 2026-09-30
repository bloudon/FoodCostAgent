# Bay Hill whole-case counting — development review

## Decision and scope

Bay Hill confirmed that **one whole case is one inventory EA** for the reviewed `1/1 Case` items. This is an operational counting rule; the identity and number of contents inside each case remain unknown. The September 23 CSV is a frozen **118-item candidate list**, not authority for other opaque `Case` packs.

The bounded development CLI is `artifacts/api-server/src/services/inventory/bayHillWholeCaseCli.ts`. Its read-only output includes **every proposed item ID, name, old geometry, and new geometry**, as well as a fingerprint. To reproduce the review from the API-server package, run `pnpm exec tsx src/services/inventory/bayHillWholeCaseCli.ts` without `--apply`. The general Orderly parser remains deliberately unable to infer physical contents from `1/1 Case`.

## Development dry run and apply

| Check | Result |
| --- | --- |
| Target | Workspace development PostgreSQL proxy `helium/heliumdb` (Neon driver), cross-checked with the development database query interface: same database, Bay Hill company ID, and 195 `1/1 Case` source mappings at property `24472` |
| Candidate list | 118 distinct snapshot IDs; 118 present in the bound Bay Hill company |
| Before apply | 110 eligible and proposed; all 110 had no operational numeric geometry and the `package` label |
| Held | 8; see below |
| Pre-apply fingerprint | `243e3a9cae0a469dcb2fc8c1e622ec10b30835212b75271811c373bea090c2ca` |
| Applied | 110 item-level counting setups in the development database only, with exact company/host/database/count/fingerprint arguments, a serializable transaction and conditional row updates |
| After apply | 110 eligible, **0 pending updates**, 8 held; independent read-only QA query confirmed exactly 110 `EA`, case-size-1 items with size-1/one-package/`whole case`/canonical-unit operational geometry and all 8 held still unconfigured |
| Post-apply fingerprint | `0e02c585469a91f1571fda7f61fc4dd7c58b689b0245f000360ea012c35c9eca` |

The update touched only `inventory_items.container_size`, `case_pkg_count`, `container_label`, `container_unit_id`, and `updated_at`. It did **not** rewrite saved counts or their valuation, canonical units/case sizes, supplier packs, invoice evidence, recipes, or prices. There was no production migration. Exact historical before/after values were not independently snapshotted; preservation is supported by the SQL update scope and read-only post-apply inspection rather than a full value-by-value before/after comparison.

## Exclusions requiring historical review

The following eight still have saved package-part/loose-unit entries that cannot safely be renamed as whole-case counts. Their counting setup was not changed:

| Item ID | Item |
| --- | --- |
| `6d75b0d6-e90f-44c8-9bd5-de9457e6c378` | Anniversary Chocolate |
| `1ae6fc37-653d-4096-af72-0379a68c58ad` | BIALE ZINFANDEL BLACK CHICKEN |
| `ebc6688b-fe9b-4f2e-b12f-7ef33b6c5a3e` | CAPPUCCINO CREAMER Busy bean |
| `bd2ab004-71f3-4933-8a79-984ca010bf1f` | CURVED GREEN PETALS DUO, WHITE CHOCOLATE, 160 PCS |
| `a332725a-a831-4621-a1bb-fddc8dea7b96` | DUCKHORN MERLOT NAPA VLY 22 75 |
| `272d3b97-e75c-4ce0-be69-bf1dc15f6cba` | Deco Blooming heart |
| `f25a4152-1878-4339-9cb3-762ce7cc29ec` | LA MASSA IGT TUSCAN RED 2021 (94V, 94RP) |
| `3c42efb3-2124-48dc-8d4a-b27cba98aeeb` | Praline Croquatine |

## Verification

- API focused tests: 44 passed in the builder run; independent QA ran a broader focused set (98 passed, 1 skipped). Web display tests: 8 passed. Native display tests: 5 passed. Independent QA also ran 24 web count-page component tests (1 skipped). API, web and mobile typechecks passed.
- New web/native entries use one fractional **Whole cases** field, show **Contents unspecified**, and price the complete stock unit as a whole case. The API rejects an invented inner-container count for this configuration. Existing counted lines still reconcile against saved canonical quantity and are marked historical for review when their parts do not reconcile.
- Independent architecture/data-integrity reviewer: **PASS WITH FOLLOW-UP** after guard revisions. Independent FnB QA: **PASS WITH FOLLOW-UP**; UI/device entry itself was not manually exercised while authenticated, but component/display tests and code paths were checked.
- The running web/API/Expo workflows started. The unauthenticated web preview rendered its sign-in page; 401 responses for private data were expected. Expo emitted a nonblocking React Native DevTools shared-library warning, while Metro reached its QR/ready output.

Production rollout and the eight held items require separate review and authorization.