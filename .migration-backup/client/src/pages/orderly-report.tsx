/**
 * Orderly Onboarding Reconciliation Report
 *
 * Four sections with sticky nav:
 *   1. Import summary (per batch)
 *   2. Snapshot reconciliation (imported vs Orderly source total)
 *   3. Period-over-period snapshot comparison (NOT usage — snapshot variance only)
 *   4. Data quality flags
 *
 * Export: CSV (full item-level data) + browser Print → PDF (summary)
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, Download, Printer, CheckCircle2, AlertTriangle,
  BarChart2, ClipboardList, Package, TrendingUp, TrendingDown,
  Minus, ArrowUpDown, MapPin, RefreshCw,
} from "lucide-react";

// ─── Types (mirrored from server/services/orderly/orderlyReport.ts) ───────────

interface BatchImportSummary {
  batchId: string;
  filename: string;
  inventoryDate: string | null;
  approvedAt: string | null;
  sourceRowCount: number;
  importedRowCount: number;
  excludedRowCount: number;
  snapshotTotal: number | null;
  importedTotal: number;
  reconciliationDelta: number | null;
  reconciliationDeltaPct: number | null;
  packParseOk: number;
  packParsePartial: number;
  packParseUnparseable: number;
  itemCodeValid: number;
  itemCodePlaceholder: number;
  itemCodeBlank: number;
  itemCodeNonUnique: number;
  vendorValid: number;
  vendorInvalid: number;
  uniqueLocations: number;
}

interface PeriodItem {
  inventoryItemId: string;
  description: string;
  earlierBatchFilename: string;
  laterBatchFilename: string;
  earlierDate: string | null;
  laterDate: string | null;
  earlierTotalCost: number | null;
  laterTotalCost: number | null;
  earlierTotalUnits: number | null;
  laterTotalUnits: number | null;
  earlierUnitCost: number | null;
  laterUnitCost: number | null;
  earlierLocation: string | null;
  laterLocation: string | null;
  costDelta: number | null;
  costDeltaPct: number | null;
  changeFlags: string[];
}

interface DataQualityFlag {
  category: string;
  label: string;
  count: number;
  affectedBatches: string[];
  note: string;
}

interface ReconciliationReport {
  generatedAt: string;
  companyId: string;
  batches: BatchImportSummary[];
  periodComparison: {
    earlierBatch: { batchId: string; filename: string; inventoryDate: string | null };
    laterBatch: { batchId: string; filename: string; inventoryDate: string | null };
    addedCount: number;
    removedCount: number;
    priceChangedCount: number;
    countChangedCount: number;
    locationChangedCount: number;
    noChangeCount: number;
    snapshotValueChangeTotal: number | null;
    items: PeriodItem[];
  } | null;
  dataQualityFlags: DataQualityFlag[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined, decimals = 2) {
  if (v == null) return "—";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
function fmtDatetime(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

function ChangeChip({ flags }: { flags: string[] }) {
  if (flags.includes("added")) return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Added</Badge>;
  if (flags.includes("removed")) return <Badge className="bg-red-100 text-red-800 border-red-200">Removed</Badge>;
  const chips = [];
  if (flags.includes("price_changed")) chips.push(<Badge key="p" className="bg-orange-100 text-orange-800 border-orange-200">Price ↕</Badge>);
  if (flags.includes("count_changed")) chips.push(<Badge key="c" className="bg-yellow-100 text-yellow-800 border-yellow-200">Count ↕</Badge>);
  if (flags.includes("location_changed")) chips.push(<Badge key="l" className="bg-purple-100 text-purple-800 border-purple-200">Location ↕</Badge>);
  if (chips.length) return <div className="flex gap-1 flex-wrap">{chips}</div>;
  return <Badge variant="outline" className="text-muted-foreground">No change</Badge>;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(delta) < 0.005) return <span className="text-muted-foreground">—</span>;
  const positive = delta > 0;
  return (
    <span className={positive ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
      {positive ? "+" : ""}{fmt$(delta)}
    </span>
  );
}

// ─── Section nav ──────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "summary",     label: "Import Summary",       icon: ClipboardList },
  { id: "snapshot",    label: "Snapshot Reconciliation", icon: BarChart2 },
  { id: "period",      label: "Snapshot Comparison",  icon: ArrowUpDown },
  { id: "quality",     label: "Data Quality",         icon: AlertTriangle },
] as const;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderlyReport() {
  const [, navigate] = useLocation();

  const { data: report, isLoading, isError, error } = useQuery<ReconciliationReport>({
    queryKey: ["/api/inventory-import/orderly/report"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/inventory-import/orderly/report");
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed to load report"); }
      return res.json();
    },
  });

  function downloadCsv() {
    window.location.href = "/api/inventory-import/orderly/report/export/csv";
  }

  function printReport() {
    window.print();
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="h-6 w-6 animate-spin text-primary mr-3" />
        <span className="text-muted-foreground">Building reconciliation report…</span>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="container mx-auto py-8 max-w-5xl px-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{(error as any)?.message ?? "Failed to load report."}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/orderly-import")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to imports
        </Button>
      </div>
    );
  }

  if (report.batches.length === 0) {
    return (
      <div className="container mx-auto py-8 max-w-5xl px-4">
        <Button variant="ghost" size="sm" className="-ml-1 mb-4" onClick={() => navigate("/orderly-import")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to imports
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-medium">No approved imports yet</p>
            <p className="text-sm text-muted-foreground mt-1">Approve at least one Orderly batch to generate the reconciliation report.</p>
            <Button className="mt-4" onClick={() => navigate("/orderly-import")}>Go to imports</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl px-4 print:max-w-full print:py-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 print:mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="-ml-1 print:hidden" onClick={() => navigate("/orderly-import")}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Orderly Onboarding Reconciliation Report</h1>
            <p className="text-sm text-muted-foreground">
              Generated {fmtDatetime(report.generatedAt)} · {report.batches.length} approved {report.batches.length === 1 ? "batch" : "batches"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={printReport}>
            <Printer className="h-4 w-4 mr-2" />
            Print / PDF
          </Button>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-2 flex-wrap mb-6 print:hidden">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <Button key={id} variant="outline" size="sm" onClick={() => scrollTo(id)}>
            <Icon className="h-3.5 w-3.5 mr-1.5" />{label}
          </Button>
        ))}
      </div>

      <div className="space-y-10">
        {/* ── Section 1: Import Summary ───────────────────────────────── */}
        <section id="summary">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Import Summary
          </h2>
          <div className="space-y-6">
            {report.batches.map((b) => (
              <Card key={b.batchId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {b.filename}
                    <span className="text-muted-foreground font-normal text-sm ml-2">
                      Inventory date: {fmtDate(b.inventoryDate)}
                    </span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Approved {fmtDatetime(b.approvedAt)}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {[
                      { label: "Source rows", value: b.sourceRowCount.toLocaleString() },
                      { label: "Imported rows", value: b.importedRowCount.toLocaleString(), note: "resolved items" },
                      { label: "Excluded rows", value: b.excludedRowCount.toLocaleString(), warn: b.excludedRowCount > 0 },
                      { label: "Unique locations", value: b.uniqueLocations.toLocaleString() },
                      { label: "Valid vendors", value: b.vendorValid.toLocaleString(), sub: `${b.vendorInvalid} invalid` },
                    ].map(({ label, value, note, warn, sub }) => (
                      <div key={label} className={`rounded-lg border p-3 ${warn && b.excludedRowCount > 0 ? "border-orange-200 bg-orange-50" : ""}`}>
                        <div className="text-xl font-bold">{value}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                        {note && <div className="text-xs text-muted-foreground">{note}</div>}
                        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Pack parse OK", value: b.packParseOk },
                      { label: "Pack parse partial", value: b.packParsePartial, warn: b.packParsePartial > 0 },
                      { label: "Pack parse failed", value: b.packParseUnparseable, warn: b.packParseUnparseable > 0 },
                      { label: "Valid item codes", value: b.itemCodeValid },
                      { label: "Placeholder codes", value: b.itemCodePlaceholder, warn: b.itemCodePlaceholder > 0 },
                      { label: "Blank codes", value: b.itemCodeBlank, warn: b.itemCodeBlank > 0 },
                    ].map(({ label, value, warn }) => (
                      <div key={label} className={`rounded-lg border p-2 ${warn && value > 0 ? "border-orange-200 bg-orange-50/50" : "bg-muted/20"}`}>
                        <div className="text-lg font-semibold">{value.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Section 2: Snapshot Reconciliation ─────────────────────── */}
        <section id="snapshot">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            Snapshot Reconciliation
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Compares the importable subset total against the Orderly export's own snapshot total.
            A small delta is normal when some rows were excluded. A large delta warrants review.
          </p>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="text-right">Orderly Total</TableHead>
                  <TableHead className="text-right">Imported Total</TableHead>
                  <TableHead className="text-right">Delta $</TableHead>
                  <TableHead className="text-right">Delta %</TableHead>
                  <TableHead className="text-right">Excluded Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.batches.map((b) => {
                  const highDelta = b.reconciliationDeltaPct != null && Math.abs(b.reconciliationDeltaPct) > 0.5;
                  return (
                    <TableRow key={b.batchId} className={highDelta ? "bg-orange-50" : ""}>
                      <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                      <TableCell className="text-right">{fmt$(b.snapshotTotal)}</TableCell>
                      <TableCell className="text-right">{fmt$(b.importedTotal)}</TableCell>
                      <TableCell className="text-right">
                        {b.reconciliationDelta != null && Math.abs(b.reconciliationDelta) > 0.005 ? (
                          <span className={Math.abs(b.reconciliationDelta) > 100 ? "text-orange-700 font-medium" : ""}>
                            {fmt$(b.reconciliationDelta)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.reconciliationDeltaPct != null ? (
                          <span className={highDelta ? "text-orange-700 font-medium" : ""}>
                            {fmtPct(b.reconciliationDeltaPct)}
                            {highDelta && " ⚠"}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">{b.excludedRowCount.toLocaleString()}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {report.batches.some((b) => b.reconciliationDeltaPct != null && Math.abs(b.reconciliationDeltaPct) > 0.5) && (
            <Alert className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                One or more batches exceed the 0.5% reconciliation tolerance.
                Review the excluded rows to confirm that the delta is explained by legitimately excluded items.
              </AlertDescription>
            </Alert>
          )}
        </section>

        {/* ── Section 3: Period-over-period Comparison ────────────────── */}
        <section id="period">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5 text-primary" />
            Period-over-Period Snapshot Comparison
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Compares item values across the two most recent snapshots.
            These are <strong>snapshot differences</strong>, not actual usage.
            Actual usage requires purchase, waste and transfer data.
          </p>
          {!report.periodComparison ? (
            <Alert>
              <AlertDescription>At least two approved batches are required for period-over-period comparison.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <span className="font-medium">{fmtDate(report.periodComparison.earlierBatch.inventoryDate)}</span>
                <span>→</span>
                <span className="font-medium">{fmtDate(report.periodComparison.laterBatch.inventoryDate)}</span>
              </div>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Items added", value: report.periodComparison.addedCount, icon: TrendingUp, color: "text-blue-700" },
                  { label: "Items removed", value: report.periodComparison.removedCount, icon: TrendingDown, color: "text-red-700" },
                  { label: "Price changes", value: report.periodComparison.priceChangedCount, icon: ArrowUpDown, color: "text-orange-700" },
                  { label: "Count changes", value: report.periodComparison.countChangedCount, icon: Package, color: "text-yellow-700" },
                  { label: "Location changes", value: report.periodComparison.locationChangedCount, icon: MapPin, color: "text-purple-700" },
                  { label: "No change", value: report.periodComparison.noChangeCount, icon: Minus, color: "text-muted-foreground" },
                  ...(report.periodComparison.snapshotValueChangeTotal != null ? [{
                    label: "Total snapshot value change",
                    value: fmt$(report.periodComparison.snapshotValueChangeTotal),
                    icon: BarChart2,
                    color: report.periodComparison.snapshotValueChangeTotal >= 0 ? "text-green-700" : "text-red-700",
                    rawValue: true,
                  }] : []),
                ].map(({ label, value, icon: Icon, color, rawValue }) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className={`text-xl font-bold ${color}`}>{rawValue ? value : (value as number).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Icon className="h-3 w-3" />{label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Item table */}
              <div className="rounded-md border overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="min-w-[200px]">Item</TableHead>
                      <TableHead className="text-right">{fmtDate(report.periodComparison.earlierBatch.inventoryDate)} Value</TableHead>
                      <TableHead className="text-right">{fmtDate(report.periodComparison.laterBatch.inventoryDate)} Value</TableHead>
                      <TableHead className="text-right">Value Δ</TableHead>
                      <TableHead className="text-right">Units (E→L)</TableHead>
                      <TableHead>Location (E→L)</TableHead>
                      <TableHead>Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.periodComparison.items.map((item) => (
                      <TableRow key={item.inventoryItemId}>
                        <TableCell className="font-medium text-sm max-w-[220px] truncate" title={item.description}>
                          {item.description}
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt$(item.earlierTotalCost)}</TableCell>
                        <TableCell className="text-right text-sm">{fmt$(item.laterTotalCost)}</TableCell>
                        <TableCell className="text-right"><DeltaBadge delta={item.costDelta} /></TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {item.earlierTotalUnits != null || item.laterTotalUnits != null
                            ? `${item.earlierTotalUnits ?? "—"} → ${item.laterTotalUnits ?? "—"}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                          {item.earlierLocation !== item.laterLocation
                            ? <span className="text-purple-700">{item.earlierLocation ?? "—"} → {item.laterLocation ?? "—"}</span>
                            : (item.laterLocation ?? item.earlierLocation ?? "—")}
                        </TableCell>
                        <TableCell><ChangeChip flags={item.changeFlags} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>

        {/* ── Section 4: Data Quality Flags ──────────────────────────── */}
        <section id="quality">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Data Quality Flags
          </h2>
          {report.dataQualityFlags.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>No data quality issues detected.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {report.dataQualityFlags.map((flag, i) => (
                <div key={i} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <div className="font-medium text-sm">{flag.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Affects: {flag.affectedBatches.join(", ")}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-base font-bold px-3 py-1">
                      {flag.count.toLocaleString()}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{flag.note}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t text-xs text-muted-foreground">
        Orderly Onboarding Reconciliation Report · Generated {fmtDatetime(report.generatedAt)} ·
        FnB Cost Pro · Period-over-period figures show snapshot variance, not actual usage.
      </div>
    </div>
  );
}
