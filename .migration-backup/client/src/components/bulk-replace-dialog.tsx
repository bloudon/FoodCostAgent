import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ChefHat,
  Package,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import type { Recipe, InventoryItem as BaseInventoryItem } from "@shared/schema";

type InventoryItem = BaseInventoryItem & { unitName?: string };

type PreviewResult = {
  affectedRecipes: { id: string; name: string; componentCount: number }[];
  totalAffected: number;
  componentInstances: number;
  unitCompatibility: {
    fromKind: string;
    toKind: string;
    fromUnitName?: string;
    toUnitName?: string;
    sameKind: boolean;
    crossKindVolumeWeight: boolean;
    needsConversionFactor: boolean;
  };
};

type ExecuteResult = {
  updatedCount: number;
  componentInstances: number;
  recipeIds: string[];
  costDelta: number;
  toName: string;
};

type Step = "pick-to" | "conversion" | "preview" | "success";
type ToType = "inventory_item" | "recipe";

interface BulkReplaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromType: "inventory_item" | "recipe";
  fromId: string;
  fromName: string;
  onSuccess?: () => void;
}

export function BulkReplaceDialog({
  open,
  onOpenChange,
  fromType,
  fromId,
  fromName,
  onSuccess,
}: BulkReplaceDialogProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Step state
  const [step, setStep] = useState<Step>("pick-to");

  // Replacement selection
  const [pickerTab, setPickerTab] = useState<ToType>("inventory_item");
  const [search, setSearch] = useState("");
  const [toType, setToType] = useState<ToType>("inventory_item");
  const [toId, setToId] = useState("");
  const [toName, setToName] = useState("");
  const [toUnitName, setToUnitName] = useState("");

  // Conversion factor
  const [conversionFactor, setConversionFactor] = useState("1");

  // Preview / execute results
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [successData, setSuccessData] = useState<ExecuteResult | null>(null);

  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    enabled: open,
  });

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    enabled: open,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/recipes/replace-component/preview", {
        fromType,
        fromId,
        toType,
        toId,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Preview failed");
      }
      return res.json() as Promise<PreviewResult>;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      // If units differ, go to conversion step first
      if (data.unitCompatibility.needsConversionFactor) {
        setStep("conversion");
      } else {
        setStep("preview");
      }
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const factor = parseFloat(conversionFactor);
      const res = await apiRequest("POST", "/api/recipes/replace-component/execute", {
        fromType,
        fromId,
        toType,
        toId,
        conversionFactor: isNaN(factor) ? 1 : factor,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Replacement failed");
      }
      return res.json() as Promise<ExecuteResult>;
    },
    onSuccess: (data) => {
      setSuccessData(data);
      setStep("success");
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components"] });
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Replacement failed", description: err.message, variant: "destructive" });
    },
  });

  function reset() {
    setStep("pick-to");
    setPickerTab("inventory_item");
    setSearch("");
    setToType("inventory_item");
    setToId("");
    setToName("");
    setToUnitName("");
    setConversionFactor("1");
    setPreviewData(null);
    setSuccessData(null);
  }

  function handleClose() {
    onOpenChange(false);
    // Delay reset so dialog fade-out isn't jarring
    setTimeout(reset, 300);
  }

  // Filter items/recipes for picker, excluding the source item
  const filteredItems = (inventoryItems ?? []).filter((item) => {
    if (fromType === "inventory_item" && item.id === fromId) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.pluSku?.toLowerCase().includes(q) ||
      item.manufacturer?.toLowerCase().includes(q)
    );
  });

  const filteredRecipes = (recipes ?? []).filter((r) => {
    if (fromType === "recipe" && r.id === fromId) return false;
    // Only recipes that can be used as ingredients
    if (!r.canBeIngredient) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q);
  });

  const canProceedFromPicker = !!toId;
  const convFactor = parseFloat(conversionFactor);
  const convFactorValid = !isNaN(convFactor) && convFactor > 0;

  const title =
    step === "success"
      ? "Replacement complete"
      : `Replace "${fromName}" across all recipes`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: Pick the replacement ── */}
        {step === "pick-to" && (
          <div className="flex flex-col gap-4 min-h-0 flex-1">
            <p className="text-sm text-muted-foreground">
              Choose what should replace <strong>{fromName}</strong> wherever it appears as an ingredient.
            </p>

            <Tabs value={pickerTab} onValueChange={(v) => { setPickerTab(v as ToType); setToId(""); setToName(""); setSearch(""); }}>
              <TabsList className="w-full">
                <TabsTrigger value="inventory_item" className="flex-1 gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Inventory Item
                </TabsTrigger>
                <TabsTrigger value="recipe" className="flex-1 gap-1.5">
                  <ChefHat className="h-3.5 w-3.5" />
                  Recipe
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={pickerTab === "inventory_item" ? "Search by name or SKU…" : "Search recipes…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="flex-1 overflow-y-auto border rounded-md divide-y min-h-0 max-h-56">
              {pickerTab === "inventory_item" && (
                filteredItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">No items match.</p>
                ) : (
                  filteredItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setToType("inventory_item");
                        setToId(item.id);
                        setToName(item.name);
                        setToUnitName((item as any).unitName ?? "");
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors ${toId === item.id && toType === "inventory_item" ? "bg-accent" : ""}`}
                    >
                      <span className="font-medium">{item.name}</span>
                      {item.pluSku && (
                        <span className="text-muted-foreground ml-2 text-xs">SKU: {item.pluSku}</span>
                      )}
                    </button>
                  ))
                )
              )}
              {pickerTab === "recipe" && (
                filteredRecipes.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">
                    {(recipes ?? []).filter(r => r.canBeIngredient).length === 0
                      ? 'No recipes are marked "Can be used as ingredient" yet.'
                      : "No recipes match."}
                  </p>
                ) : (
                  filteredRecipes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setToType("recipe");
                        setToId(r.id);
                        setToName(r.name);
                        setToUnitName("");
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors ${toId === r.id && toType === "recipe" ? "bg-accent" : ""}`}
                    >
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        yields {r.yieldQty}
                      </span>
                    </button>
                  ))
                )
              )}
            </div>

            {toId && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                <span>
                  <strong>{fromName}</strong>
                  <ArrowRight className="inline h-3.5 w-3.5 mx-1 text-muted-foreground" />
                  <strong>{toName}</strong>
                </span>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                disabled={!canProceedFromPicker || previewMutation.isPending}
                onClick={() => {
                  // kick off preview — it decides which next step based on unit compatibility
                  previewMutation.mutate();
                }}
              >
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP 2: Conversion factor (only when units differ) ── */}
        {step === "conversion" && previewData && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <span className="text-amber-800 dark:text-amber-300">
                <strong>{fromName}</strong> is measured in{" "}
                <strong>{previewData.unitCompatibility.fromKind}</strong> and{" "}
                <strong>{toName}</strong> is in{" "}
                <strong>{previewData.unitCompatibility.toKind}</strong>. Enter
                how to scale the quantity.
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Conversion factor
              </label>
              <p className="text-xs text-muted-foreground">
                Each existing quantity will be multiplied by this factor.
                Example: if 1 oz of sauce becomes 0.0078 batch (gallon recipe),
                enter <strong>0.0078</strong>.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground whitespace-nowrap">old qty ×</span>
                <Input
                  type="number"
                  step="any"
                  min="0.00001"
                  placeholder="e.g. 0.0078"
                  value={conversionFactor}
                  onChange={(e) => setConversionFactor(e.target.value)}
                  className="w-36"
                  autoFocus
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">= new qty</span>
              </div>
              {!convFactorValid && conversionFactor !== "" && (
                <p className="text-xs text-destructive">Must be a positive number.</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("pick-to")}>Back</Button>
              <Button
                disabled={!convFactorValid}
                onClick={() => setStep("preview")}
              >
                Preview impact
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP 3: Preview ── */}
        {step === "preview" && previewData && (
          <div className="flex flex-col gap-4 min-h-0 flex-1">
            {previewData.totalAffected === 0 ? (
              <div className="rounded-md border border-muted p-4 text-sm text-muted-foreground text-center">
                <p className="font-medium mb-1">No recipes reference this ingredient.</p>
                <p>Nothing will change if you proceed.</p>
              </div>
            ) : (
              <>
                <div className="text-sm">
                  Replacing <strong>{fromName}</strong>
                  <ArrowRight className="inline h-3.5 w-3.5 mx-1 text-muted-foreground" />
                  <strong>{toName}</strong> will update{" "}
                  <strong>{previewData.totalAffected}</strong>{" "}
                  {previewData.totalAffected === 1 ? "recipe" : "recipes"}{" "}
                  ({previewData.componentInstances} ingredient{" "}
                  {previewData.componentInstances === 1 ? "row" : "rows"}).
                  {!previewData.unitCompatibility.sameKind && conversionFactor !== "1" && (
                    <span className="text-muted-foreground">
                      {" "}Quantities will be multiplied by <strong>{conversionFactor}</strong>.
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto border rounded-md divide-y min-h-0 max-h-48">
                  {previewData.affectedRecipes.map((r) => (
                    <div key={r.id} className="px-3 py-1.5 text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{r.name}</span>
                      {r.componentCount > 1 && (
                        <Badge variant="secondary" className="shrink-0 text-xs font-normal">
                          {r.componentCount}×
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  Costs will be recalculated immediately. A version snapshot will be
                  saved for each affected recipe for audit purposes.
                </p>
              </>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep(previewData.unitCompatibility.needsConversionFactor ? "conversion" : "pick-to")}
              >
                Back
              </Button>
              {previewData.totalAffected === 0 ? (
                <Button variant="outline" onClick={handleClose}>Close</Button>
              ) : (
                <Button
                  disabled={executeMutation.isPending}
                  onClick={() => executeMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {executeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Replace in {previewData.totalAffected}{" "}
                  {previewData.totalAffected === 1 ? "recipe" : "recipes"}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── STEP 4: Success ── */}
        {step === "success" && successData && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <div className="text-sm text-green-900 dark:text-green-300">
                <p className="font-semibold mb-0.5">Replacement complete</p>
                <p>
                  Updated <strong>{successData.updatedCount}</strong>{" "}
                  {successData.updatedCount === 1 ? "recipe" : "recipes"} (
                  {successData.componentInstances} ingredient{" "}
                  {successData.componentInstances === 1 ? "row" : "rows"}). Costs
                  recalculated.
                </p>
                {successData.costDelta !== 0 && (
                  <p className="mt-0.5">
                    Total recipe cost change:{" "}
                    <strong
                      className={
                        successData.costDelta < 0 ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {successData.costDelta > 0 ? "+" : ""}
                      ${successData.costDelta.toFixed(2)}
                    </strong>
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleClose();
                  setLocation("/recipes");
                }}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View recipes
              </Button>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
