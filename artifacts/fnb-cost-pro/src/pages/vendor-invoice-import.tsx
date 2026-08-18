/**
 * Vendor Invoice Import — bulk-import vendor invoice line items from an
 * Orderly per-vendor XLSX export (Line Items + Invoice Totals sheets).
 *
 *  Step 1: Upload .xlsx (or pick an existing batch)
 *  Step 2: Resolution preview — vendor match, per-line identity resolution,
 *          per-invoice reconciliation, honest resolved/held counts
 *  Step 3: Approve — persist invoices + dated price history; held-lines view
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, Clock,
  DollarSign, FileSpreadsheet, ListChecks, RefreshCw, Truck, Upload,
} from "lucide-react";
import { Link } from "wouter";

interface BatchRow {
  id: string;
  originalFilename: string;
  vendorNameDetected: string | null;
  invoiceCount: number;
  lineCount: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  totalAmount: number;
  status: string;
  uploadedAt: string;
}

interface PreviewLine {
  lineId: string;
  rowIndex: number;
  invoiceNumber: string;
  invoiceDate: string;
  itemCode: string | null;
  description: string | null;
  packSizeRaw: string | null;
  qty: number | null;
  extendedAmount: number | null;
  status: "resolved" | "held";
  holdReason: string | null;
  matchStrategy: string | null;
  inventoryItemName: string | null;
  packCrossCheck: string | null;
  derivedCasePrice: number | null;
}

interface Preview {
  batchId: string;
  status: string;
  vendorNameDetected: string | null;
  vendorId: string | null;
  vendorName: string | null;
  invoiceCount: number;
  lineCount: number;
  resolvedLines: number;
  heldLines: number;
  resolvedDollars: number;
  heldDollars: number;
  holdReasonCounts: Record<string, number>;
  alreadyImportedInvoices: string[];
  reconciliation: {
    invoiceNumber: string;
    invoiceDate: string | null;
    statedTotal: number | null;
    lineSum: number;
    gap: number | null;
    reconciles: boolean;
  }[];
  lines: PreviewLine[];
}

const HOLD_REASON_LABELS: Record<string, string> = {
  vendor_unmatched: "Vendor not matched",
  no_item_code: "Missing item code",
  no_vendor_item: "No vendor item for code",
  ambiguous_vendor_item: "Code maps to multiple items",
  mapping_vendor_item_disagree: "Mapping vs vendor item conflict",
  pack_conflict: "Pack size conflict",
  already_imported: "Invoice already imported",
};

function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function VendorInvoiceImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [showHeldOnly, setShowHeldOnly] = useState(false);

  const batchesQuery = useQuery<BatchRow[]>({
    queryKey: ["/api/vendor-invoice-import/batches"],
    queryFn: async () => (await apiRequest("GET", "/api/vendor-invoice-import/batches")).json(),
  });

  const previewQuery = useQuery<Preview>({
    queryKey: ["/api/vendor-invoice-import/preview", selectedBatchId],
    enabled: !!selectedBatchId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/vendor-invoice-import/batches/${selectedBatchId}/resolution-preview`)).json(),
  });

  const approveMutation = useMutation({
    mutationFn: async (batchId: string) =>
      (await apiRequest("POST", `/api/vendor-invoice-import/batches/${batchId}/approve`)).json(),
    onSuccess: (result: any) => {
      toast({
        title: result.alreadyApproved ? "Batch was already approved" : "Batch approved",
        description: `${result.invoicesPersisted} invoices persisted, ${result.priceObservations} price observations recorded, ${result.linesHeld} lines held.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-invoice-import/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-invoice-import/preview", selectedBatchId] });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err?.message ?? String(err), variant: "destructive" });
    },
  });

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/vendor-invoice-import/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (data.duplicateWarning) {
        toast({
          title: "File already staged",
          description: "This exact file was uploaded before. Showing the existing batch.",
        });
      } else {
        toast({
          title: "File staged",
          description: `${data.parse.invoiceCount} invoices, ${data.parse.lineCount} lines, ${usd(data.parse.totalAmount)} total.`,
        });
      }
      setSelectedBatchId(data.batchId);
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-invoice-import/batches"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const preview = previewQuery.data;
  const visibleLines = useMemo(() => {
    if (!preview) return [];
    return showHeldOnly ? preview.lines.filter((l) => l.status === "held") : preview.lines;
  }, [preview, showHeldOnly]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-testid="page-vendor-invoice-import">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Vendor Invoice Import
          </h1>
          <p className="text-muted-foreground text-sm">
            Bulk-import vendor invoice line items from an Orderly export and backfill dated price history.
          </p>
        </div>
        <Link href="/orderly-import">
          <Button variant="outline" size="sm" data-testid="link-orderly-import">
            <ChevronLeft className="h-4 w-4 mr-1" /> Inventory import
          </Button>
        </Link>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5" /> Upload workbook
          </CardTitle>
          <CardDescription>
            Excel export with a <b>Line Items</b> sheet and an <b>Invoice Totals</b> sheet. Re-uploading the same
            file is safe — it never stages twice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            data-testid="input-vendor-invoice-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="button-upload-vendor-invoices"
          >
            {uploading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            {uploading ? "Uploading…" : "Choose .xlsx file"}
          </Button>
        </CardContent>
      </Card>

      {/* Batch list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5" /> Import batches
          </CardTitle>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : !batchesQuery.data?.length ? (
            <p className="text-muted-foreground text-sm" data-testid="text-no-batches">No batches yet. Upload a workbook to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead>Date range</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchesQuery.data.map((b) => (
                  <TableRow key={b.id} data-testid={`row-batch-${b.id}`}>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs">{b.originalFilename}</TableCell>
                    <TableCell>{b.vendorNameDetected ?? "—"}</TableCell>
                    <TableCell className="text-right">{b.invoiceCount}</TableCell>
                    <TableCell className="text-right">{b.lineCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {b.dateRangeStart ?? "?"} → {b.dateRangeEnd ?? "?"}
                    </TableCell>
                    <TableCell className="text-right">{usd(b.totalAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "approved" ? "default" : "secondary"}>{b.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={selectedBatchId === b.id ? "default" : "outline"}
                        onClick={() => setSelectedBatchId(b.id)}
                        data-testid={`button-view-batch-${b.id}`}
                      >
                        Review <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Resolution preview */}
      {selectedBatchId && (
        <Card data-testid="card-resolution-preview">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-5 w-5" /> Resolution preview
            </CardTitle>
            {preview && (
              <CardDescription>
                Vendor:{" "}
                {preview.vendorId ? (
                  <span className="font-medium text-foreground" data-testid="text-vendor-match">{preview.vendorName}</span>
                ) : (
                  <span className="text-destructive" data-testid="text-vendor-unmatched">
                    not matched ({preview.vendorNameDetected ?? "unknown"}) — approval blocked
                  </span>
                )}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {previewQuery.isLoading && <p className="text-muted-foreground text-sm">Resolving…</p>}
            {previewQuery.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{(previewQuery.error as any)?.message ?? "Preview failed."}</AlertDescription>
              </Alert>
            )}
            {preview && (
              <>
                {/* Summary tiles */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Invoices</div>
                    <div className="text-xl font-semibold" data-testid="text-invoice-count">{preview.invoiceCount}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Lines resolved</div>
                    <div className="text-xl font-semibold text-green-700 dark:text-green-400" data-testid="text-resolved-lines">
                      {preview.resolvedLines}/{preview.lineCount}
                    </div>
                    <div className="text-xs text-muted-foreground">{usd(preview.resolvedDollars)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Lines held</div>
                    <div className="text-xl font-semibold text-amber-700 dark:text-amber-400" data-testid="text-held-lines">
                      {preview.heldLines}
                    </div>
                    <div className="text-xs text-muted-foreground">{usd(preview.heldDollars)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Reconciliation</div>
                    <div className="text-xl font-semibold" data-testid="text-reconciliation">
                      {preview.reconciliation.filter((r) => r.reconciles).length}/{preview.reconciliation.length}
                    </div>
                    <div className="text-xs text-muted-foreground">invoices match stated totals</div>
                  </div>
                </div>

                {Object.keys(preview.holdReasonCounts).length > 0 && (
                  <Alert data-testid="alert-hold-reasons">
                    <Clock className="h-4 w-4" />
                    <AlertDescription>
                      Held lines keep their invoice rows but write <b>no price history</b> until linked:{" "}
                      {Object.entries(preview.holdReasonCounts)
                        .map(([reason, count]) => `${HOLD_REASON_LABELS[reason] ?? reason} (${count})`)
                        .join(", ")}
                      .
                    </AlertDescription>
                  </Alert>
                )}

                {preview.alreadyImportedInvoices.length > 0 && (
                  <Alert variant="destructive" data-testid="alert-already-imported">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {preview.alreadyImportedInvoices.length} invoice number(s) already exist and will be skipped:{" "}
                      {preview.alreadyImportedInvoices.join(", ")}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Reconciliation gaps */}
                {preview.reconciliation.some((r) => !r.reconciles) && (
                  <Alert variant="destructive" data-testid="alert-reconciliation-gaps">
                    <DollarSign className="h-4 w-4" />
                    <AlertDescription>
                      {preview.reconciliation.filter((r) => !r.reconciles).map((r) => (
                        <span key={r.invoiceNumber} className="block">
                          Invoice {r.invoiceNumber}: stated {usd(r.statedTotal)}, lines sum {usd(r.lineSum)}
                          {r.gap != null ? ` (gap ${usd(r.gap)})` : " (no stated total)"}
                        </span>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Line table */}
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Lines ({visibleLines.length})</div>
                  <Button size="sm" variant="outline" onClick={() => setShowHeldOnly((v) => !v)} data-testid="button-toggle-held">
                    {showHeldOnly ? "Show all lines" : "Show held only"}
                  </Button>
                </div>
                <div className="max-h-[420px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Pack</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Extended</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLines.map((l) => (
                        <TableRow key={l.lineId} data-testid={`row-line-${l.rowIndex}`}>
                          <TableCell className="font-mono text-xs">{l.invoiceNumber}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{l.invoiceDate}</TableCell>
                          <TableCell className="font-mono text-xs">{l.itemCode ?? "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs" title={l.description ?? undefined}>
                            {l.description ?? "—"}
                            {l.inventoryItemName && (
                              <span className="block text-muted-foreground truncate">→ {l.inventoryItemName}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{l.packSizeRaw ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs">{l.qty ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs">{usd(l.extendedAmount)}</TableCell>
                          <TableCell className="text-xs">
                            {l.matchStrategy === "external_mapping" ? "Mapping" : l.matchStrategy === "vendor_item_code" ? "Vendor code" : "—"}
                          </TableCell>
                          <TableCell>
                            {l.status === "resolved" ? (
                              <Badge className="bg-green-600 hover:bg-green-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Resolved
                              </Badge>
                            ) : (
                              <Badge variant="secondary" title={l.holdReason ?? undefined}>
                                <Clock className="h-3 w-3 mr-1" /> {HOLD_REASON_LABELS[l.holdReason ?? ""] ?? "Held"}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Approve */}
                {preview.status === "pending_review" ? (
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => approveMutation.mutate(preview.batchId)}
                      disabled={approveMutation.isPending || !preview.vendorId}
                      data-testid="button-approve-batch"
                    >
                      {approveMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Approve &amp; import
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Persists invoices and records dated price history for resolved lines. Held lines wait for linking.
                    </span>
                  </div>
                ) : (
                  <Alert data-testid="alert-batch-approved">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>This batch is {preview.status}. Held lines remain visible above for follow-up linking.</AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
