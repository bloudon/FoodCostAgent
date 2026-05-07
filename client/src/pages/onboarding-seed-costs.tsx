import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  SkipForward,
  RotateCcw,
  DollarSign,
  Package,
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface ScannedItem {
  name: string;
  sku: string | null;
  unitPrice: number | null;
  casePrice: number | null;
  priceType: "case" | "unit" | null;
  packSizeDescription: string | null;
  unit: string | null;
  categoryHint: string | null;
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchConfidence: "high" | "medium" | "none";
}

type ItemAction = "update" | "create" | "skip";

interface ReviewRow {
  item: ScannedItem;
  action: ItemAction;
  unitPrice: string;
  inventoryItemId: string | null;
}

function confidenceBadge(confidence: "high" | "medium" | "none") {
  if (confidence === "high") {
    return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Match</Badge>;
  }
  if (confidence === "medium") {
    return <Badge className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">Possible</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">New</Badge>;
}

export default function OnboardingSeedCosts() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"upload" | "scanning" | "review" | "applying" | "done">("upload");
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const uploadRef = useRef<string | null>(null);

  const scanMutation = useMutation({
    mutationFn: async (imageObjectPath: string) => {
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan", { imageObjectPath });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Scan failed" }));
        throw new Error(err.error || "Scan failed");
      }
      return res.json() as Promise<{ items: ScannedItem[]; vendorName: string | null }>;
    },
    onSuccess: (data) => {
      setVendorName(data.vendorName);
      const initialRows: ReviewRow[] = data.items.map((item) => {
        const resolvedPrice = item.unitPrice ?? (item.casePrice ?? null);
        const defaultAction: ItemAction =
          item.matchConfidence !== "none" ? "update" : "create";
        return {
          item,
          action: defaultAction,
          unitPrice: resolvedPrice != null ? String(resolvedPrice.toFixed(4)) : "",
          inventoryItemId: item.matchedItemId,
        };
      });
      setRows(initialRows);
      setPhase("review");
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
      setPhase("upload");
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (payload: { items: { name: string; unitPrice: number; action: ItemAction; inventoryItemId?: string }[] }) => {
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan/apply", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Apply failed" }));
        throw new Error(err.error || "Apply failed");
      }
      return res.json() as Promise<{ updated: number; created: number; recipesRecalculated: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
      setPhase("done");
      toast({
        title: "Costs saved",
        description: `Updated ${data.updated} item${data.updated !== 1 ? "s" : ""}, created ${data.created} new. ${data.recipesRecalculated > 0 ? `${data.recipesRecalculated} recipe${data.recipesRecalculated !== 1 ? "s" : ""} recalculated.` : ""}`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
      setPhase("review");
    },
  });

  function handleUploadComplete(objectPath: string) {
    uploadRef.current = objectPath;
    setUploadedPath(objectPath);
    setPhase("scanning");
    scanMutation.mutate(objectPath);
  }

  function handleActionChange(idx: number, action: ItemAction) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], action };
      if (action === "update") {
        next[idx].inventoryItemId = next[idx].item.matchedItemId;
      }
      return next;
    });
  }

  function handlePriceChange(idx: number, value: string) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], unitPrice: value };
      return next;
    });
  }

  function handleApply() {
    const payload = rows
      .filter((r) => r.action !== "skip")
      .map((r) => ({
        name: r.item.name,
        unitPrice: parseFloat(r.unitPrice),
        action: r.action,
        inventoryItemId: r.action === "update" && r.inventoryItemId ? r.inventoryItemId : undefined,
      }))
      .filter((r) => !isNaN(r.unitPrice) && r.unitPrice > 0);

    if (payload.length === 0) {
      toast({ title: "Nothing to apply", description: "Mark at least one item to update or create.", variant: "destructive" });
      return;
    }

    setPhase("applying");
    applyMutation.mutate({ items: payload });
  }

  async function handleSkip() {
    await apiRequest("POST", "/api/onboarding/milestones/review-step", { stepId: "costs" }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    navigate("/recipes");
  }

  const activeRows = rows.filter((r) => r.action !== "skip");
  const hasValidRows = activeRows.some((r) => {
    const p = parseFloat(r.unitPrice);
    return !isNaN(p) && p > 0;
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background">
        <div className="flex items-center gap-3">
          <img src="/website-logo.png" alt="FNB Cost Pro" className="h-8 w-auto" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSkip}
          data-testid="button-skip-costs"
        >
          Skip for now
          <SkipForward className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-10 max-w-4xl mx-auto w-full">
        {/* Step header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
            <DollarSign className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-2xl font-bold mb-2" data-testid="heading-seed-costs">
            Seed Ingredient Costs
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Upload a vendor invoice or price list so we can fill in ingredient costs. This lets food cost % appear on your menu items right away.
          </p>
        </div>

        {/* Phase: upload */}
        {phase === "upload" && (
          <div
            className="w-full max-w-lg border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-4 text-center"
            data-testid="upload-zone"
          >
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium mb-1">Upload your vendor invoice</p>
              <p className="text-sm text-muted-foreground">
                JPG, PNG, or WebP — a photo of a printed invoice works great.
              </p>
            </div>
            <ObjectUploader
              onUploadComplete={handleUploadComplete}
              buttonText="Choose Invoice Photo"
              dataTestId="button-upload-invoice"
              maxFileSize={15 * 1024 * 1024}
              visibility="private"
            />
          </div>
        )}

        {/* Phase: scanning */}
        {phase === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-16" data-testid="scanning-state">
            <Loader2 className="h-10 w-10 animate-spin text-accent" />
            <p className="font-medium">Reading invoice with AI...</p>
            <p className="text-sm text-muted-foreground">This usually takes 10–20 seconds.</p>
          </div>
        )}

        {/* Phase: applying */}
        {phase === "applying" && (
          <div className="flex flex-col items-center gap-4 py-16" data-testid="applying-state">
            <Loader2 className="h-10 w-10 animate-spin text-accent" />
            <p className="font-medium">Saving costs and recalculating recipes...</p>
          </div>
        )}

        {/* Phase: done */}
        {phase === "done" && (
          <div className="flex flex-col items-center gap-6 py-16 text-center" data-testid="done-state">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div>
              <h2 className="text-xl font-bold mb-2">Costs saved!</h2>
              <p className="text-muted-foreground">
                Your recipes now have updated food costs. Let's build out your recipe library next.
              </p>
            </div>
            <Button
              onClick={() => navigate("/recipes")}
              data-testid="button-go-recipes"
            >
              Continue to Recipes
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Phase: review */}
        {phase === "review" && (
          <div className="w-full" data-testid="review-panel">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <div>
                <p className="font-medium">
                  {vendorName ? (
                    <>Found {rows.length} item{rows.length !== 1 ? "s" : ""} from <span className="font-bold">{vendorName}</span></>
                  ) : (
                    <>Found {rows.length} item{rows.length !== 1 ? "s" : ""}</>
                  )}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Review the extracted costs. Adjust prices or skip items before saving.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPhase("upload"); setRows([]); setUploadedPath(null); }}
                data-testid="button-rescan"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Try another photo
              </Button>
            </div>

            <div className="rounded-md border overflow-auto mb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Item Name</TableHead>
                    <TableHead className="min-w-[140px]">Match</TableHead>
                    <TableHead className="min-w-[110px]">Unit Cost</TableHead>
                    <TableHead className="min-w-[110px]">Pack Info</TableHead>
                    <TableHead className="min-w-[130px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow
                      key={idx}
                      className={row.action === "skip" ? "opacity-40" : ""}
                      data-testid={`review-row-${idx}`}
                    >
                      <TableCell>
                        <div className="flex items-start gap-1.5">
                          <Package className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium leading-tight">{row.item.name}</span>
                        </div>
                        {row.item.categoryHint && (
                          <span className="text-xs text-muted-foreground ml-5">{row.item.categoryHint}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {confidenceBadge(row.item.matchConfidence)}
                          {row.item.matchedItemName && row.action === "update" && (
                            <span className="text-xs text-muted-foreground leading-tight">
                              {row.item.matchedItemName}
                            </span>
                          )}
                          {row.action === "create" && (
                            <span className="text-xs text-muted-foreground">Will create new</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={row.unitPrice}
                            onChange={(e) => handlePriceChange(idx, e.target.value)}
                            className="w-24 h-8 text-sm"
                            step="0.0001"
                            min="0"
                            disabled={row.action === "skip"}
                            data-testid={`input-price-${idx}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {row.item.packSizeDescription || row.item.unit || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {row.item.matchedItemId && (
                            <Button
                              variant={row.action === "update" ? "default" : "outline"}
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => handleActionChange(idx, "update")}
                              data-testid={`button-action-update-${idx}`}
                            >
                              Update
                            </Button>
                          )}
                          <Button
                            variant={row.action === "create" ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => handleActionChange(idx, "create")}
                            data-testid={`button-action-create-${idx}`}
                          >
                            New
                          </Button>
                          <Button
                            variant={row.action === "skip" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => handleActionChange(idx, "skip")}
                            data-testid={`button-action-skip-${idx}`}
                          >
                            Skip
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Summary row */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {activeRows.length} item{activeRows.length !== 1 ? "s" : ""} will be saved.{" "}
                  {rows.length - activeRows.length > 0 && `${rows.length - activeRows.length} skipped.`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  data-testid="button-skip-review"
                >
                  Skip
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={!hasValidRows}
                  data-testid="button-apply-costs"
                >
                  Save Costs
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
