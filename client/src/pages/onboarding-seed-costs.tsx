import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
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
  PlusCircle,
  Trash2,
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
  name: string;
  unit: string;
  unitPrice: string;
  casePrice: number | null;
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

type Phase = "upload" | "scanning" | "review" | "applying" | "done";

export default function OnboardingSeedCosts() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>("upload");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const [isScanningMore, setIsScanningMore] = useState(false);

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
      const newRows: ReviewRow[] = data.items.map((item) => {
        const resolvedPrice = item.unitPrice ?? (item.casePrice ?? null);
        const defaultAction: ItemAction =
          item.matchConfidence !== "none" ? "update" : "create";
        return {
          item,
          action: defaultAction,
          name: item.name,
          unit: item.unit || "lb",
          unitPrice: resolvedPrice != null ? String(resolvedPrice.toFixed(4)) : "",
          casePrice: item.casePrice ?? null,
          inventoryItemId: item.matchedItemId,
        };
      });
      setRows((prev) => {
        // De-duplicate by name (case-insensitive) — keep existing row if already present
        const existingNames = new Set(prev.map(r => r.name.toLowerCase()));
        const fresh = newRows.filter(r => !existingNames.has(r.name.toLowerCase()));
        return [...prev, ...fresh];
      });
      setScanCount((c) => c + 1);
      setPhase("review");
      setIsScanningMore(false);
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
      if (scanCount === 0) setPhase("upload");
      else setIsScanningMore(false);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (payload: {
      items: { name: string; unitPrice: number; unit: string; categoryHint?: string; action: ItemAction; inventoryItemId?: string }[];
    }) => {
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan/apply", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Apply failed" }));
        throw new Error(err.error || "Apply failed");
      }
      return res.json() as Promise<{ updated: number; created: number; recipesRecalculated: number }>;
    },
    onSuccess: (data) => {
      // Invalidate all affected query keys so same-session views reflect updated costs
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      setPhase("done");
      toast({
        title: "Costs saved",
        description: `Updated ${data.updated} item${data.updated !== 1 ? "s" : ""}, created ${data.created} new.${data.recipesRecalculated > 0 ? ` ${data.recipesRecalculated} recipe${data.recipesRecalculated !== 1 ? "s" : ""} recalculated.` : ""}`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
      setPhase("review");
    },
  });

  const handleUploadComplete = useCallback((objectPath: string) => {
    if (scanCount === 0) setPhase("scanning");
    else setIsScanningMore(true);
    scanMutation.mutate(objectPath);
  }, [scanCount, scanMutation]);

  function handleActionChange(idx: number, action: ItemAction) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        action,
        inventoryItemId: action === "update" ? next[idx].item.matchedItemId : null,
      };
      return next;
    });
  }

  function handleFieldChange(idx: number, field: "name" | "unit" | "unitPrice", value: string) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function handleRemoveRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleApply() {
    const payload = rows
      .filter((r) => r.action !== "skip")
      .map((r) => ({
        name: r.name.trim() || r.item.name,
        unitPrice: parseFloat(r.unitPrice),
        casePrice: r.casePrice ?? undefined,
        unit: r.unit.trim() || "lb",
        categoryHint: r.item.categoryHint || undefined,
        action: r.action,
        inventoryItemId: r.action === "update" && r.inventoryItemId ? r.inventoryItemId : undefined,
      }))
      .filter((r) => !isNaN(r.unitPrice) && r.unitPrice > 0);

    if (payload.length === 0) {
      toast({ title: "Nothing to apply", description: "Set a valid price on at least one item.", variant: "destructive" });
      return;
    }

    setPhase("applying");
    applyMutation.mutate({ items: payload });
  }

  function handleSkip() {
    navigate("/recipes");
  }

  // Auth guard — consistent with onboarding-menu-scan pattern
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <p>Please sign in to continue setting up your account.</p>
          </div>
          <Button onClick={() => navigate("/login")} data-testid="button-go-to-login">
            Sign In
          </Button>
        </div>
      </div>
    );
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

      <div className="flex-1 flex flex-col items-center px-4 py-10 max-w-5xl mx-auto w-full">
        {/* Step header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
            <DollarSign className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-2xl font-bold mb-2" data-testid="heading-seed-costs">
            Seed Ingredient Costs
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Upload 1–3 vendor invoices or price lists so we can fill in ingredient costs. This lets food cost % appear on your menu items right away.
          </p>
        </div>

        {/* Phase: initial upload */}
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

        {/* Phase: scanning first image */}
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
                  {rows.length} item{rows.length !== 1 ? "s" : ""} extracted
                  {scanCount > 1 && <span className="text-muted-foreground text-sm ml-1">from {scanCount} invoices</span>}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Review extracted costs. Edit names, units, or prices before saving.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {scanCount < 3 && (
                  <div className="relative">
                    {isScanningMore ? (
                      <Button variant="outline" size="sm" disabled data-testid="button-adding-more">
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        Scanning...
                      </Button>
                    ) : (
                      <ObjectUploader
                        onUploadComplete={handleUploadComplete}
                        buttonText="Add another invoice"
                        dataTestId="button-add-invoice"
                        maxFileSize={15 * 1024 * 1024}
                        visibility="private"
                        buttonVariant="outline"
                        icon={<PlusCircle className="h-3.5 w-3.5" />}
                      />
                    )}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPhase("upload"); setRows([]); setScanCount(0); }}
                  data-testid="button-rescan"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Start over
                </Button>
              </div>
            </div>

            <div className="rounded-md border overflow-auto mb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Item Name</TableHead>
                    <TableHead className="min-w-[80px]">Unit</TableHead>
                    <TableHead className="min-w-[110px]">Unit Cost</TableHead>
                    <TableHead className="min-w-[140px]">Match</TableHead>
                    <TableHead className="min-w-[130px]">Action</TableHead>
                    <TableHead className="w-10"></TableHead>
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
                        <div className="flex items-center gap-1">
                          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Input
                            value={row.name}
                            onChange={(e) => handleFieldChange(idx, "name", e.target.value)}
                            className="h-8 text-sm"
                            disabled={row.action === "skip"}
                            data-testid={`input-name-${idx}`}
                          />
                        </div>
                        {row.item.categoryHint && (
                          <span className="text-xs text-muted-foreground ml-6 mt-0.5 block">{row.item.categoryHint}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.unit}
                          onChange={(e) => handleFieldChange(idx, "unit", e.target.value)}
                          className="h-8 text-sm w-20"
                          placeholder="lb"
                          disabled={row.action === "skip"}
                          data-testid={`input-unit-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={row.unitPrice}
                            onChange={(e) => handleFieldChange(idx, "unitPrice", e.target.value)}
                            className="w-24 h-8 text-sm"
                            step="0.0001"
                            min="0"
                            disabled={row.action === "skip"}
                            data-testid={`input-price-${idx}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {confidenceBadge(row.item.matchConfidence)}
                          {row.item.matchedItemName && row.action === "update" && (
                            <span className="text-xs text-muted-foreground leading-tight">
                              → {row.item.matchedItemName}
                            </span>
                          )}
                          {row.action === "create" && (
                            <span className="text-xs text-muted-foreground">Will create new</span>
                          )}
                        </div>
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
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRemoveRow(idx)}
                          data-testid={`button-remove-row-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
                  {activeRows.length} item{activeRows.length !== 1 ? "s" : ""} will be saved.
                  {rows.length - activeRows.length > 0 && ` ${rows.length - activeRows.length} skipped.`}
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
