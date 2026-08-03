/**
 * Sales-by-Item Import
 *
 * Two-step flow:
 *   1. Upload xlsx → POST /api/imports/sales-by-item/preview → show parsed summary
 *   2. Confirm     → POST /api/imports/sales-by-item/approve → show seeded counts
 */

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2,
  MapPin, ShoppingBag, Calendar, BarChart2, ChevronLeft, Store, Link2,
  TriangleAlert, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreviewResult {
  reportStart: string;
  reportEnd: string;
  salesAreas: string[];
  outletCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  totalItems: number;
  totalQty: number;
  totalNet: number;
  uniqueOutlets: number;
  uniqueCategories: number;
  unrecognizedPrefixCategories: string[];
}

interface ApproveResult {
  success: boolean;
  reportStart: string;
  reportEnd: string;
  outletsCreated: number;
  outletsLinked: number;
  departmentsCreated: number;
  departmentsLinked: number;
  itemsCreated: number;
  itemsLinked: number;
  storeItemsCreated: number;
  salesRowsInserted: number;
}

type Step = "upload" | "preview" | "approving" | "done";

// ─── Component ────────────────────────────────────────────────────────────────

function SalesByItemImportContent() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [unrecognizedWarningDismissed, setUnrecognizedWarningDismissed] = useState(false);

  const { data: seededOutlets = [] } = useQuery<
    Array<{ id: string; name: string }>
  >({ queryKey: ["/api/inventory-locations/outlets"] });

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFileSelect = (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError("Please select an Excel file (.xlsx or .xls)");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("File size must be less than 50 MB");
      return;
    }
    setSelectedFile(file);
    setError(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  };

  // ── Preview (parse only, no DB writes) ─────────────────────────────────────
  const handlePreview = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);

      const res = await fetch("/api/imports/sales-by-item/preview", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data as PreviewResult);
      setStep("preview");
    } catch (err: any) {
      setError(err.message ?? "Failed to read file");
      toast({ title: "Parse error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ── Approve (DB writes) ─────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!selectedFile) return;
    setStep("approving");
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);

      const res = await fetch("/api/imports/sales-by-item/approve", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Approval failed");
      setResult(data as ApproveResult);
      setStep("done");
    } catch (err: any) {
      setStep("preview");
      setError(err.message ?? "Approval failed");
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  };

  const reset = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setUnrecognizedWarningDismissed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/orderly-import")}
          data-testid="button-back"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
            POS Sales Report Import
          </h1>
          <p className="text-sm text-muted-foreground">
            Seeds outlet locations and menu items from a Jonas Encore Sales-by-Item export
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Step: upload ──────────────────────────────────────────────────────── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Upload Sales by Item Report
            </CardTitle>
            <CardDescription>
              Upload the Sales by Item Excel export from your Jonas Encore POS system.
              This report seeds outlet locations (Bay Window, Grill, Banquet, etc.) and all
              menu items, so you don't need to enter them manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              data-testid="input-file"
              onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
            />

            {/* Drop zone */}
            <div
              data-testid="dropzone-xlsx"
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-muted-foreground/50"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-sm mb-1">
                Drag and drop your Sales by Item .xlsx here
              </p>
              <p className="text-xs text-muted-foreground">or click to browse</p>
            </div>

            {/* Selected file */}
            {selectedFile && (
              <Alert className="bg-muted border-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      onClick={handlePreview}
                      disabled={uploading}
                      data-testid="button-parse"
                    >
                      {uploading ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Parsing…</>
                      ) : (
                        <><Upload className="h-4 w-4 mr-2" />Parse Report</>
                      )}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Format hint */}
            <div className="rounded-lg bg-muted p-4 text-sm space-y-1">
              <p className="font-medium">What this import does</p>
              <ul className="space-y-1 text-muted-foreground text-xs">
                <li>• Creates <strong>sales outlets</strong> (Bay Window, Grill, Banquet, Halfway House, etc.) from the Sales Areas header</li>
                <li>• Creates <strong>menu item categories</strong> (FF-BW Favorites, BW Lunch, etc.) as menu departments</li>
                <li>• Creates <strong>menu items</strong> with their Quick Access Codes as PLU/SKU for later recipe linking</li>
                <li>• Records the <strong>sales totals</strong> per item for theoretical food cost calculations</li>
              </ul>
            </div>

            {/* Already-seeded outlets */}
            {seededOutlets.length > 0 && (
              <div className="rounded-lg border p-4 space-y-2" data-testid="seeded-outlets-section">
                <p className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Seeded Sales Outlets ({seededOutlets.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  These outlets were created from a previous import and are ready for TFC calculations.
                  Re-uploading will safely skip them.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {seededOutlets.map((o) => (
                    <span
                      key={o.id}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                      data-testid={`badge-outlet-${o.id}`}
                    >
                      {o.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step: preview ─────────────────────────────────────────────────────── */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Report Period</p>
              </div>
              <p className="font-semibold text-sm">
                {preview.reportStart} → {preview.reportEnd}
              </p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Outlets</p>
              </div>
              <p className="font-semibold text-2xl">{preview.uniqueOutlets}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Menu Items</p>
              </div>
              <p className="font-semibold text-2xl">{preview.totalItems}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Total Net Sales</p>
              </div>
              <p className="font-semibold text-sm">
                ${preview.totalNet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </Card>
          </div>

          {/* Unrecognized prefix warning */}
          {preview.unrecognizedPrefixCategories.length > 0 && !unrecognizedWarningDismissed && (
            <Alert
              className="border-amber-300 bg-amber-50 text-amber-900"
              data-testid="alert-unrecognized-prefixes"
            >
              <TriangleAlert className="h-4 w-4 text-amber-600" />
              <AlertDescription className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold mb-1">
                    {preview.unrecognizedPrefixCategories.length === 1
                      ? "1 category prefix was not recognised"
                      : `${preview.unrecognizedPrefixCategories.length} category prefixes were not recognised`}
                    — rows placed in "Unassigned" outlet
                  </p>
                  <p className="text-sm mb-2">
                    The following categories could not be matched to a known outlet. Their sales
                    rows have been placed in an <strong>"Unassigned"</strong> bucket. You can
                    still import, but ask your administrator to add these prefixes to{" "}
                    <code className="bg-amber-100 px-1 rounded text-xs">inferOutlet()</code>{" "}
                    so future uploads route them correctly.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.unrecognizedPrefixCategories.map(cat => (
                      <Badge
                        key={cat}
                        variant="outline"
                        className="border-amber-400 text-amber-800 bg-amber-50 text-xs"
                        data-testid={`badge-unrecognized-${cat}`}
                      >
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setUnrecognizedWarningDismissed(true)}
                  className="shrink-0 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  aria-label="Dismiss warning"
                  data-testid="button-dismiss-unrecognized-warning"
                >
                  <X className="h-4 w-4" />
                </button>
              </AlertDescription>
            </Alert>
          )}

          {/* Outlets breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Store className="h-4 w-4" />
                Outlets to Seed ({preview.uniqueOutlets})
              </CardTitle>
              <CardDescription>
                These will be created as outlet-type inventory locations (find-or-create — safe to re-upload).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outlet Name</TableHead>
                    <TableHead className="text-right">Menu Items</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(preview.outletCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([outlet, count]) => (
                      <TableRow key={outlet} data-testid={`row-outlet-${outlet}`}>
                        <TableCell className="font-medium">{outlet}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{count}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Header sales areas (from report) */}
          {preview.salesAreas.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Sales Areas listed in report header
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {preview.salesAreas.map(a => (
                    <Badge key={a} variant="outline">{a}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleApprove}
              data-testid="button-approve"
              className="flex-1"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Import {preview.uniqueOutlets} Outlets &amp; {preview.totalItems} Menu Items
            </Button>
            <Button variant="outline" onClick={reset} data-testid="button-cancel">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: approving ───────────────────────────────────────────────────── */}
      {step === "approving" && (
        <Card className="p-12 text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="font-medium">Seeding outlets and menu items…</p>
          <p className="text-sm text-muted-foreground mt-1">This usually takes a few seconds.</p>
        </Card>
      )}

      {/* ── Step: done ────────────────────────────────────────────────────────── */}
      {step === "done" && result && (
        <div className="space-y-4">
          <Alert className="bg-emerald-50 border-emerald-200" data-testid="alert-success">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800">
              Import complete for period {result.reportStart} → {result.reportEnd}
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Outlets Created</p>
              <p className="text-2xl font-bold text-emerald-600" data-testid="stat-outlets-created">
                {result.outletsCreated}
              </p>
              <p className="text-xs text-muted-foreground">{result.outletsLinked} already existed</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Menu Departments</p>
              <p className="text-2xl font-bold text-emerald-600" data-testid="stat-depts-created">
                {result.departmentsCreated}
              </p>
              <p className="text-xs text-muted-foreground">{result.departmentsLinked} already existed</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Menu Items Created</p>
              <p className="text-2xl font-bold text-emerald-600" data-testid="stat-items-created">
                {result.itemsCreated}
              </p>
              <p className="text-xs text-muted-foreground">{result.itemsLinked} already existed</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Store Links Created</p>
              <p className="text-2xl font-bold" data-testid="stat-store-items">
                {result.storeItemsCreated}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Sales Rows Written</p>
              <p className="text-2xl font-bold" data-testid="stat-sales-rows">
                {result.salesRowsInserted}
              </p>
            </Card>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={() => setLocation("/pos-recipe-linking")}
              data-testid="button-link-recipes"
            >
              <Link2 className="h-4 w-4 mr-2" />
              Link Recipes to Menu Items
            </Button>
            <Button onClick={reset} variant="outline" data-testid="button-import-another">
              Import Another File
            </Button>
            <Button onClick={() => setLocation("/orderly-import")} variant="outline" data-testid="button-go-orderly">
              Back to Orderly Import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SalesByItemImport() {
  return (
    <TierGate>
      <SalesByItemImportContent />
    </TierGate>
  );
}
