/**
 * Orderly Import — four-step wizard
 *
 *  Step 1: Upload .xlsx  (or pick an existing pending batch)
 *  Step 2: Confirm inventory date
 *  Step 3: Resolution preview — shows per-row match results
 *  Step 4: Approve — commit items / vendors / locations, show result summary
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  BarChart2,
  MapPin,
  Package,
  Truck,
  Clock,
  ChevronLeft,
  Calendar,
  Database,
  ListChecks,
  DollarSign,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportBatch {
  id: string;
  status: string;
  inventoryDate: string | null;
  uploadedAt: string;
  originalFilename: string;
  sourceRowCount: number;
  approvedAt: string | null;
}

interface MatchResult {
  strategy: string;
  confidence: string;
  matchedId: string | null;
  candidateIds: string[];
  requiresReview: boolean;
  score?: number;
}

interface RowPreview {
  rowIndex: number;
  storageLocation: string | null;
  sourceItemCode: string | null;
  itemCodeStatus: string | null;
  cleanedDescription: string | null;
  supplierRaw: string | null;
  caseQuantity: number | null;
  packagePrice: number | null;
  totalCost: number | null;
  itemMatch: MatchResult;
  vendorMatch: { vendorId: string | null; isNew: boolean; confidence: string; requiresReview: boolean };
  locationMatch: { locationId: string | null; isNew: boolean; normalizedName: string };
}

interface ResolutionPreview {
  batchId: string;
  inventoryDate: string | null;
  totalRows: number;
  summary: {
    totalRows: number;
    itemsMatchedHigh: number;
    itemsMatchedMedium: number;
    itemsAmbiguous: number;
    itemsNew: number;
    itemsFuzzy: number;
    vendorsMatched: number;
    vendorsNew: number;
    locationsMatched: number;
    locationsNew: number;
    rowsRequiringReview: number;
  };
  rows: RowPreview[];
  newLocations: string[];
  newVendors: string[];
}

interface ApprovalResult {
  batchId: string;
  approvedAt: string;
  itemsCreated: number;
  itemsLinked: number;
  vendorsCreated: number;
  vendorsLinked: number;
  locationsCreated: number;
  locationsLinked: number;
  vendorItemsCreated: number;
  rowsSkipped: number;
  rowsProcessed: number;
}

type WizardStep = "list" | "upload" | "date" | "preview" | "approved" | "convert-preview" | "converted";

interface ConversionPreview {
  batchId: string;
  inventoryDate: string | null;
  originalFilename: string;
  snapshotTotal: number | null;
  importableTotal: number;
  reconciliationDelta: number;
  reconciliationDeltaPct: number;
  exceedsVarianceTolerance: boolean;
  includedRowCount: number;
  excludedRowCount: number;
  locationNames: string[];
  existingCountSessionId: string | null;
  existingSessionWarning: string | null;
  crossReferenceWarnings: string[];
  excludedRows: Array<{ rowIndex: number; description: string | null; reason: string }>;
}

interface ConversionResult {
  countSessionId: string;
  linesCreated: number;
  linesSkipped: number;
  totalValue: number;
  storageLocationsCreated: number;
  warnings: string[];
}

interface Store {
  id: string;
  name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confidenceBadge(confidence: string, strategy: string) {
  if (confidence === "high") return <Badge className="bg-green-100 text-green-800 border-green-200">Matched</Badge>;
  if (confidence === "medium") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Likely</Badge>;
  if (confidence === "low") return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Fuzzy</Badge>;
  if (confidence === "ambiguous") return <Badge className="bg-red-100 text-red-800 border-red-200">Ambiguous</Badge>;
  if (strategy === "none") return <Badge className="bg-blue-100 text-blue-800 border-blue-200">New</Badge>;
  return <Badge variant="outline">{confidence}</Badge>;
}

function strategyLabel(strategy: string): string {
  const map: Record<string, string> = {
    external_mapping: "Prior mapping",
    item_code: "Item code",
    name_pack: "Name match",
    fuzzy: "Fuzzy",
    none: "—",
  };
  return map[strategy] ?? strategy;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

// ─── Step: Batch list ─────────────────────────────────────────────────────────

function BatchList({
  onNew,
  onSelect,
  onConvert,
}: {
  onNew: () => void;
  onSelect: (batch: ImportBatch) => void;
  onConvert: (batch: ImportBatch) => void;
}) {
  const { data: batches = [], isLoading } = useQuery<ImportBatch[]>({
    queryKey: ["/api/inventory-import/orderly/batches"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/inventory-import/orderly/batches");
      return res.json();
    },
  });

  const statusColor: Record<string, string> = {
    pending_review: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Orderly Inventory Imports</h2>
          <p className="text-sm text-muted-foreground">Upload an Orderly .xlsx export to stage and approve items, vendors, and locations.</p>
        </div>
        <Button onClick={onNew}>
          <Upload className="h-4 w-4 mr-2" />
          Upload new file
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No imports yet. Upload an Orderly .xlsx to get started.</p>
            <Button className="mt-4" onClick={onNew}>
              <Upload className="h-4 w-4 mr-2" />
              Upload file
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Inventory Date</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onSelect(b)}>
                  <TableCell className="font-mono text-xs">{b.originalFilename}</TableCell>
                  <TableCell>{formatDate(b.inventoryDate)}</TableCell>
                  <TableCell>{b.sourceRowCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatDate(b.uploadedAt)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[b.status] ?? "bg-muted text-muted-foreground"}`}>
                      {b.status.replace("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    {b.status !== "approved" ? (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onSelect(b); }}>
                        Review <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onConvert(b); }}>
                        <Database className="h-3 w-3 mr-1" />
                        Create count session
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Step: Upload ─────────────────────────────────────────────────────────────

function UploadStep({ onUploaded, onBack }: { onUploaded: (batchId: string) => void; onBack: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/inventory-import/orderly/preview", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      if (data.duplicateWarning) {
        toast({
          title: "Duplicate file detected",
          description: `This file was already imported (batch from ${formatDate(data.existingBatch.uploadedAt)}). Opening existing batch.`,
        });
        onUploaded(data.existingBatch.batchId);
        return;
      }

      onUploaded(data.batchId);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-1">
        <ChevronLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <h2 className="text-lg font-semibold">Upload Orderly Export</h2>
      <p className="text-sm text-muted-foreground">Upload the .xlsx file exported from Orderly. The file is parsed server-side and staged for review before any items are created.</p>

      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"} ${uploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        {uploading ? (
          <>
            <RefreshCw className="h-8 w-8 mx-auto mb-3 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Parsing and staging…</p>
          </>
        ) : (
          <>
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium">Drop your .xlsx file here</p>
            <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}

// ─── Step: Confirm date ───────────────────────────────────────────────────────

function ConfirmDateStep({
  batchId,
  detectedDate,
  onConfirmed,
  onBack,
}: {
  batchId: string;
  detectedDate: string | null;
  onConfirmed: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [dateValue, setDateValue] = useState(detectedDate ?? "");
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!dateValue) return;
    setSaving(true);
    try {
      const res = await apiRequest("PATCH", `/api/inventory-import/orderly/batches/${batchId}/confirm-date`, {
        inventoryDate: dateValue,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to confirm date");
      }
      onConfirmed();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
        <ChevronLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <div>
        <h2 className="text-lg font-semibold">Confirm Inventory Date</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We detected the date from the filename or worksheet. Please verify it matches the count date on the Orderly report.
        </p>
      </div>

      <Alert>
        <Clock className="h-4 w-4" />
        <AlertDescription>
          Detected: <strong>{detectedDate ?? "unknown"}</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="inv-date">Inventory Date</Label>
        <Input
          id="inv-date"
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <Button onClick={handleConfirm} disabled={!dateValue || saving}>
        {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
        Confirm Date & Preview Matches
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
}

// ─── Step: Resolution preview ─────────────────────────────────────────────────

function ResolutionPreviewStep({
  batchId,
  onApproved,
  onBack,
}: {
  batchId: string;
  onApproved: (result: ApprovalResult) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [approving, setApproving] = useState(false);

  const { data: preview, isLoading, isError } = useQuery<ResolutionPreview>({
    queryKey: [`/api/inventory-import/orderly/batches/${batchId}/resolution-preview`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-import/orderly/batches/${batchId}/resolution-preview`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to load preview");
      }
      return res.json();
    },
  });

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await apiRequest("POST", `/api/inventory-import/orderly/batches/${batchId}/approve`, {
        rowDecisions: [],
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Approval failed");
      }
      const result: ApprovalResult = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/inventory-import/orderly/batches"] });
      qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
      onApproved(result);
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="py-16 text-center">
        <RefreshCw className="h-6 w-6 mx-auto mb-3 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Running entity matching…</p>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load resolution preview. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const s = preview.summary;
  const matchPct = s.totalRows > 0
    ? Math.round(((s.itemsMatchedHigh + s.itemsMatchedMedium) / s.totalRows) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Resolution Preview</h2>
          <p className="text-sm text-muted-foreground">{s.totalRows.toLocaleString()} rows · Inventory date: {formatDate(preview.inventoryDate)}</p>
        </div>
        <div className="ml-auto">
          <Button onClick={handleApprove} disabled={approving}>
            {approving
              ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              : <CheckCircle2 className="h-4 w-4 mr-2" />
            }
            {approving ? "Approving…" : "Approve Import"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Items</span>
            </div>
            <div className="text-2xl font-bold">{(s.itemsMatchedHigh + s.itemsMatchedMedium).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">matched ({matchPct}%)</div>
            <Progress value={matchPct} className="mt-2 h-1" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">New items</span>
            </div>
            <div className="text-2xl font-bold">{s.itemsNew.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">will be created</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Vendors</span>
            </div>
            <div className="text-2xl font-bold">{s.vendorsMatched + s.vendorsNew}</div>
            <div className="text-xs text-muted-foreground">{s.vendorsNew} new · {s.vendorsMatched} existing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Locations</span>
            </div>
            <div className="text-2xl font-bold">{s.locationsMatched + s.locationsNew}</div>
            <div className="text-xs text-muted-foreground">{s.locationsNew} new · {s.locationsMatched} existing</div>
          </CardContent>
        </Card>
      </div>

      {/* Ambiguous / review warnings */}
      {s.itemsAmbiguous > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{s.itemsAmbiguous} rows</strong> matched multiple existing items and cannot be auto-linked.
            New items will be created for those rows — you can merge duplicates in the item catalog afterward.
          </AlertDescription>
        </Alert>
      )}
      {s.rowsRequiringReview > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{s.rowsRequiringReview} rows</strong> were matched by fuzzy name similarity only.
            New items will be created for those rows to avoid incorrect permanent links.
            You can merge them with existing items afterward.
          </AlertDescription>
        </Alert>
      )}

      {/* New locations */}
      {preview.newLocations.length > 0 && (
        <div className="rounded-md border p-4 bg-blue-50/50 dark:bg-blue-950/20">
          <p className="text-sm font-medium mb-2 flex items-center gap-1">
            <MapPin className="h-4 w-4 text-blue-600" />
            {preview.newLocations.length} new location{preview.newLocations.length > 1 ? "s" : ""} will be created
          </p>
          <div className="flex flex-wrap gap-1">
            {preview.newLocations.map(l => (
              <Badge key={l} variant="outline" className="text-xs">{l}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* New vendors */}
      {preview.newVendors.length > 0 && (
        <div className="rounded-md border p-4 bg-purple-50/50 dark:bg-purple-950/20">
          <p className="text-sm font-medium mb-2 flex items-center gap-1">
            <Truck className="h-4 w-4 text-purple-600" />
            {preview.newVendors.length} new vendor{preview.newVendors.length > 1 ? "s" : ""} will be created
          </p>
          <div className="flex flex-wrap gap-1">
            {preview.newVendors.map(v => (
              <Badge key={v} variant="outline" className="text-xs">{v}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Row table — first 100 */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          Showing first 100 of {s.totalRows.toLocaleString()} rows
        </p>
        <div className="rounded-md border overflow-auto max-h-96">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Item match</TableHead>
                <TableHead>Strategy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.slice(0, 100).map((row) => (
                <TableRow key={row.rowIndex}>
                  <TableCell className="text-muted-foreground text-xs">{row.rowIndex}</TableCell>
                  <TableCell className="text-xs max-w-[220px] truncate">
                    {row.cleanedDescription || <span className="text-muted-foreground/50 italic">blank</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.storageLocation || "—"}
                    {row.locationMatch.isNew && (
                      <Badge className="ml-1 text-[10px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200">new</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.supplierRaw || "—"}
                    {row.vendorMatch.isNew && row.supplierRaw && (
                      <Badge className="ml-1 text-[10px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200">new</Badge>
                    )}
                  </TableCell>
                  <TableCell>{confidenceBadge(row.itemMatch.confidence, row.itemMatch.strategy)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{strategyLabel(row.itemMatch.strategy)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button size="lg" onClick={handleApprove} disabled={approving}>
          {approving
            ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            : <CheckCircle2 className="h-4 w-4 mr-2" />
          }
          {approving ? "Approving…" : `Approve ${s.totalRows.toLocaleString()} rows`}
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Convert-to-count-session preview ───────────────────────────────────

function ConvertPreviewStep({
  batchId,
  onConverted,
  onBack,
}: {
  batchId: string;
  onConverted: (result: ConversionResult) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string>("");
  const [acknowledgeVariance, setAcknowledgeVariance] = useState(false);
  const [converting, setConverting] = useState(false);

  const { data: stores = [] } = useQuery<Store[]>({
    queryKey: ["/api/stores/accessible"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stores/accessible");
      return res.json();
    },
  });

  // Auto-select first store
  useEffect(() => {
    if (stores.length > 0 && !storeId) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const { data: preview, isLoading, isError, error } = useQuery<ConversionPreview>({
    queryKey: [`/api/inventory-import/orderly/batches/${batchId}/conversion-preview`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-import/orderly/batches/${batchId}/conversion-preview`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed to load preview"); }
      return res.json();
    },
  });

  async function handleConvert() {
    if (!storeId) return;
    setConverting(true);
    try {
      const res = await apiRequest("POST", `/api/inventory-import/orderly/batches/${batchId}/convert-to-count-session`, {
        storeId,
        acknowledgeVariance,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Conversion failed");
      }
      const result: ConversionResult = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      onConverted(result);
    } catch (err: any) {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="py-16 text-center">
        <RefreshCw className="h-6 w-6 mx-auto mb-3 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Checking reconciliation…</p>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{(error as any)?.message ?? "Failed to load conversion preview."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // Already converted
  if (preview.existingCountSessionId) {
    return (
      <div className="space-y-4 max-w-lg mx-auto text-center">
        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
        <h2 className="text-lg font-semibold">Already Converted</h2>
        <p className="text-sm text-muted-foreground">
          This batch has already been converted to a historical count session.
        </p>
        <Button onClick={onBack} className="w-full">Back to import list</Button>
      </div>
    );
  }

  const canConvert = !!storeId && (!preview.exceedsVarianceTolerance || acknowledgeVariance);

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Create Count Session</h2>
          <p className="text-sm text-muted-foreground">
            {preview.originalFilename} · Inventory date: {formatDate(preview.inventoryDate)}
          </p>
        </div>
      </div>

      {/* Reconciliation summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: <ListChecks className="h-4 w-4 text-muted-foreground" />, label: "Items to import", value: preview.includedRowCount.toLocaleString() },
          { icon: <AlertTriangle className="h-4 w-4 text-muted-foreground" />, label: "Items excluded", value: preview.excludedRowCount.toLocaleString() },
          { icon: <DollarSign className="h-4 w-4 text-muted-foreground" />, label: "Importable total", value: `$${preview.importableTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { icon: <DollarSign className="h-4 w-4 text-muted-foreground" />, label: "Orderly total", value: preview.snapshotTotal != null ? `$${preview.snapshotTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—" },
        ].map(({ icon, label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
              <div className="text-xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Variance warning */}
      {preview.exceedsVarianceTolerance && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Reconciliation variance is {preview.reconciliationDeltaPct.toFixed(2)}%</strong>
            {" "}(delta: ${Math.abs(preview.reconciliationDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).
            This exceeds the 0.5% tolerance. Check for excluded items before proceeding.
            <div className="flex items-center gap-2 mt-3">
              <Checkbox
                id="ack-variance"
                checked={acknowledgeVariance}
                onCheckedChange={(v) => setAcknowledgeVariance(!!v)}
              />
              <label htmlFor="ack-variance" className="text-sm cursor-pointer">
                I understand the variance and want to proceed
              </label>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Duplicate session warning */}
      {preview.existingSessionWarning && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{preview.existingSessionWarning}</AlertDescription>
        </Alert>
      )}

      {/* Cross-reference warnings */}
      {preview.crossReferenceWarnings.map((w, i) => (
        <Alert key={i}>
          <Calendar className="h-4 w-4" />
          <AlertDescription>{w}</AlertDescription>
        </Alert>
      ))}

      {/* Locations */}
      {preview.locationNames.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Locations in this snapshot</p>
          <div className="flex flex-wrap gap-1">
            {preview.locationNames.map(l => (
              <Badge key={l} variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />{l}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Excluded rows (collapsed summary) */}
      {preview.excludedRowCount > 0 && (
        <Alert>
          <AlertDescription>
            <strong>{preview.excludedRowCount} rows</strong> will be excluded — their inventory items were not resolved during approval.
            These rows will not appear as count lines in the session.
          </AlertDescription>
        </Alert>
      )}

      {/* Store selector */}
      <div className="space-y-2">
        <Label htmlFor="store-select">Count session store</Label>
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger id="store-select" className="max-w-xs">
            <SelectValue placeholder="Select a store…" />
          </SelectTrigger>
          <SelectContent>
            {stores.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The count session will be attached to this store's count history.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button size="lg" onClick={handleConvert} disabled={!canConvert || converting}>
          {converting
            ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            : <Database className="h-4 w-4 mr-2" />
          }
          {converting ? "Creating…" : `Create count session (${preview.includedRowCount} lines)`}
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Converted summary ──────────────────────────────────────────────────

function ConvertedSummary({
  result,
  batchName,
  onDone,
}: {
  result: ConversionResult;
  batchName: string;
  onDone: () => void;
}) {
  return (
    <div className="space-y-6 max-w-lg mx-auto text-center">
      <div>
        <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
        <h2 className="text-xl font-semibold">Count Session Created</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Historical count session from <strong>{batchName}</strong> is now in your count history.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-left">
        {[
          { label: "Count lines created", value: result.linesCreated },
          { label: "Lines skipped", value: result.linesSkipped },
          { label: "Storage locations created", value: result.storageLocationsCreated },
          { label: "Total snapshot value", value: `$${result.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {result.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside text-xs space-y-1">
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        The session is labeled as an Orderly import and appears in Inventory Counts as a historical record.
        Counts reflect on-hand quantities at the inventory date — not actual usage between periods.
      </p>

      <Button onClick={onDone} className="w-full">
        <BarChart2 className="h-4 w-4 mr-2" />
        Back to import history
      </Button>
    </div>
  );
}

// ─── Step: Approved summary ───────────────────────────────────────────────────

function ApprovedSummary({ result, onDone, onConvertNow }: { result: ApprovalResult; onDone: () => void; onConvertNow: () => void }) {
  return (
    <div className="space-y-6 max-w-lg mx-auto text-center">
      <div>
        <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
        <h2 className="text-xl font-semibold">Import Approved</h2>
        <p className="text-sm text-muted-foreground mt-1">
          All rows have been committed to your inventory catalog.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-left">
        {[
          { label: "Rows processed", value: result.rowsProcessed },
          { label: "Rows skipped", value: result.rowsSkipped },
          { label: "Items created", value: result.itemsCreated },
          { label: "Items linked", value: result.itemsLinked },
          { label: "Vendors created", value: result.vendorsCreated },
          { label: "Vendors linked", value: result.vendorsLinked },
          { label: "Locations created", value: result.locationsCreated },
          { label: "Locations linked", value: result.locationsLinked },
          { label: "Vendor-item links", value: result.vendorItemsCreated },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{value.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={onConvertNow} className="w-full" size="lg">
          <Database className="h-4 w-4 mr-2" />
          Create count session from this snapshot
        </Button>
        <Button onClick={onDone} variant="outline" className="w-full">
          <BarChart2 className="h-4 w-4 mr-2" />
          Back to import history
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderlyImport() {
  const [step, setStep] = useState<WizardStep>("list");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatchName, setActiveBatchName] = useState<string>("");
  const [detectedDate, setDetectedDate] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);

  function selectBatch(batch: ImportBatch) {
    setActiveBatchId(batch.id);
    setActiveBatchName(batch.originalFilename);
    setDetectedDate(batch.inventoryDate);
    if (batch.status === "approved") {
      setStep("convert-preview");
    } else {
      setStep("date");
    }
  }

  function handleConvert(batch: ImportBatch) {
    setActiveBatchId(batch.id);
    setActiveBatchName(batch.originalFilename);
    setStep("convert-preview");
  }

  function handleUploaded(batchId: string) {
    setActiveBatchId(batchId);
    setActiveBatchName("");
    setDetectedDate(null);
    setStep("date");
  }

  function handleDateConfirmed() {
    setStep("preview");
  }

  function handleApproved(result: ApprovalResult) {
    setApprovalResult(result);
    setStep("approved");
  }

  function handleConverted(result: ConversionResult) {
    setConversionResult(result);
    setStep("converted");
  }

  function resetToList() {
    setStep("list");
    setActiveBatchId(null);
    setActiveBatchName("");
    setApprovalResult(null);
    setConversionResult(null);
  }

  return (
    <div className="container mx-auto py-8 max-w-5xl px-4">
      {/* Breadcrumb stepper — only for the upload→approve flow */}
      {(step === "upload" || step === "date" || step === "preview") && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          {["Upload", "Date", "Preview", "Approve"].map((label, i) => {
            const stepOrder: WizardStep[] = ["upload", "date", "preview", "approved"];
            const active = stepOrder[i] === step;
            const done = stepOrder.indexOf(step) > i;
            return (
              <span key={label} className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${active ? "bg-primary text-primary-foreground" : done ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={active ? "text-foreground font-medium" : ""}>{label}</span>
                {i < 3 && <span>›</span>}
              </span>
            );
          })}
        </div>
      )}

      {step === "list" && (
        <BatchList
          onNew={() => setStep("upload")}
          onSelect={selectBatch}
          onConvert={handleConvert}
        />
      )}

      {step === "upload" && (
        <UploadStep
          onUploaded={handleUploaded}
          onBack={() => setStep("list")}
        />
      )}

      {step === "date" && activeBatchId && (
        <ConfirmDateStep
          batchId={activeBatchId}
          detectedDate={detectedDate}
          onConfirmed={handleDateConfirmed}
          onBack={() => setStep("list")}
        />
      )}

      {step === "preview" && activeBatchId && (
        <ResolutionPreviewStep
          batchId={activeBatchId}
          onApproved={handleApproved}
          onBack={() => setStep("date")}
        />
      )}

      {step === "approved" && approvalResult && activeBatchId && (
        <ApprovedSummary
          result={approvalResult}
          onDone={resetToList}
          onConvertNow={() => setStep("convert-preview")}
        />
      )}

      {step === "convert-preview" && activeBatchId && (
        <ConvertPreviewStep
          batchId={activeBatchId}
          onConverted={handleConverted}
          onBack={() => setStep("list")}
        />
      )}

      {step === "converted" && conversionResult && (
        <ConvertedSummary
          result={conversionResult}
          batchName={activeBatchName}
          onDone={resetToList}
        />
      )}
    </div>
  );
}
