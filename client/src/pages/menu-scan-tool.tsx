import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, AlertCircle,
  Link2, Plus, Loader2, UtensilsCrossed, LayoutGrid, DollarSign, Sparkles,
  ChevronRight, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MenuScanStep } from "@/components/menu-scan-step";
import type { ApprovedMenuItem, MenuIntelligence } from "@/components/menu-scan-step";
import { TierGate } from "@/components/tier-gate";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Screen = "scan" | "summary" | "matching";

const SESSION_KEY = "menu_scan_session";

interface SavedSession extends ImportedSummary {
  lastScreen: "summary" | "matching";
}

function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed.sessionId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function persistSession(data: ImportedSummary, lastScreen: "summary" | "matching") {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...data, lastScreen }));
  } catch {}
}

function clearPersistedSession() {
  localStorage.removeItem(SESSION_KEY);
}

interface ImportedSummary {
  items: ApprovedMenuItem[];
  sessionId: string;
  intelligence: MenuIntelligence;
  hasBar?: boolean;
  deptBreakdown: { dept: string; count: number }[];
  withPrices: number;
}

interface IngredientMatch {
  name: string;
  status: "matched" | "unmatched";
  inventoryItemId?: string;
  inventoryItemName?: string;
  componentId?: string;
  suggestedInventoryItemId?: string;
  suggestedInventoryItemName?: string;
  orderGuideLineId?: string;
  orderGuideLineName?: string;
  orderGuideLinkedInventoryItemId?: string | null;
  matchConfidence?: string;
  aiExtracted?: boolean;
}

interface OGLOption {
  id: string;
  productName: string;
  matchedInventoryItemId?: string | null;
}

interface MenuItemMatch {
  menuItemId: string;
  menuItemName: string;
  recipeId?: string | null;
  ingredients: IngredientMatch[];
}

// Resolution key is either the componentId (for existing recipe components)
// or a synthetic key "ai:<menuItemId>:<ingredientName>" (for AI-extracted ingredients)
type Resolution =
  | { type: "link"; key: string; componentId: string; inventoryItemId: string; inventoryItemName: string }
  | { type: "create"; key: string; componentId: string; ingredientName: string; newItemName: string }
  | { type: "ai-link"; key: string; menuItemId: string; ingredientName: string; inventoryItemId: string; inventoryItemName: string }
  | { type: "ai-create"; key: string; menuItemId: string; ingredientName: string; newItemName: string };

interface InventoryItemOption {
  id: string;
  name: string;
}

// ---- helpers ---------------------------------------------------------------

function resolutionKey(ing: IngredientMatch, menuItemId: string): string {
  if (ing.componentId) return ing.componentId;
  return `ai:${menuItemId}:${ing.name}`;
}

// ---- SummaryScreen ---------------------------------------------------------

function SummaryScreen({
  summary,
  onContinue,
  onSkip,
}: {
  summary: ImportedSummary;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const totalItems = summary.items.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold" data-testid="text-summary-title">Import Complete</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Here's a summary of what was added to your menu.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10 shrink-0">
                <UtensilsCrossed className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Items imported</p>
                <p className="text-2xl font-bold leading-tight" data-testid="stat-items-imported">{totalItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10 shrink-0">
                <LayoutGrid className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sections</p>
                <p className="text-2xl font-bold leading-tight" data-testid="stat-sections">{summary.deptBreakdown.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10 shrink-0">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">With prices</p>
                <p className="text-2xl font-bold leading-tight" data-testid="stat-with-prices">{summary.withPrices}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.deptBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">By Section</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {summary.deptBreakdown.map((d) => (
              <div key={d.dept} className="flex items-center justify-between py-1" data-testid={`dept-row-${d.dept}`}>
                <span className="text-sm">{d.dept}</span>
                <div className="flex items-center gap-3">
                  <div className="w-24 sm:w-40 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-1.5 bg-primary rounded-full"
                      style={{ width: `${Math.round((d.count / totalItems) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{d.count}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button onClick={onContinue} data-testid="button-continue-to-matching">
          Continue to Ingredient Matching
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        <Button variant="ghost" onClick={onSkip} data-testid="button-skip-to-menu">
          Go to Menu Items
        </Button>
      </div>
    </div>
  );
}

// ---- IngredientRow ---------------------------------------------------------

function IngredientRow({
  ing,
  menuItemId,
  resolution,
  inventoryOptions,
  oglOptions,
  loadingOptions,
  onLink,
  onCreate,
  onClearResolution,
}: {
  ing: IngredientMatch;
  menuItemId: string;
  resolution?: Resolution;
  inventoryOptions: InventoryItemOption[];
  oglOptions: OGLOption[];
  loadingOptions: boolean;
  onLink: (inventoryItemId: string, inventoryItemName: string) => void;
  onCreate: (newItemName: string) => void;
  onClearResolution: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newItemName, setNewItemName] = useState(ing.suggestedInventoryItemName || ing.orderGuideLineName || ing.name);

  const isResolved = !!resolution;
  // Already matched (came back matched from backend, no user action needed)
  const isMatched = ing.status === "matched" && !ing.aiExtracted;

  let displayLabel = "";
  if (isMatched) {
    displayLabel = ing.inventoryItemName || "";
  } else if (resolution?.type === "link" || resolution?.type === "ai-link") {
    displayLabel = resolution.inventoryItemName;
  } else if (resolution?.type === "create" || resolution?.type === "ai-create") {
    displayLabel = `New: ${resolution.newItemName}`;
  } else if (ing.suggestedInventoryItemName) {
    displayLabel = `Suggested: ${ing.suggestedInventoryItemName}`;
  }

  return (
    <div
      className="flex items-center gap-2 py-2 border-b last:border-0"
      data-testid={`ingredient-row-${ing.name}`}
    >
      {isMatched || isResolved ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{ing.name}</p>
        {displayLabel && (
          <p className="text-xs text-muted-foreground truncate">{displayLabel}</p>
        )}
        {ing.aiExtracted && !isResolved && !isMatched && (
          <p className="text-[10px] text-muted-foreground italic">AI suggested</p>
        )}
      </div>
      {!isMatched && !isResolved && (
        <div className="flex items-center gap-1 shrink-0">
          <Popover open={linkOpen} onOpenChange={setLinkOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid={`button-link-${ing.name}`}>
                <Link2 className="h-3 w-3 mr-1" />
                Link
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search inventory or order guide..." />
                <CommandList>
                  {loadingOptions ? (
                    <div className="p-2 space-y-1">
                      <Skeleton className="h-7 w-full" />
                      <Skeleton className="h-7 w-full" />
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No items found.</CommandEmpty>
                      <CommandGroup heading="Inventory Items">
                        {ing.suggestedInventoryItemId && (
                          <CommandItem
                            key={`suggested-${ing.suggestedInventoryItemId}`}
                            value={`suggested ${ing.suggestedInventoryItemName}`}
                            onSelect={() => {
                              onLink(ing.suggestedInventoryItemId!, ing.suggestedInventoryItemName!);
                              setLinkOpen(false);
                            }}
                            data-testid={`option-suggested-${ing.suggestedInventoryItemName}`}
                          >
                            <Sparkles className="h-3 w-3 mr-1 text-primary" />
                            {ing.suggestedInventoryItemName} <span className="text-xs text-muted-foreground ml-1">(suggested)</span>
                          </CommandItem>
                        )}
                        {inventoryOptions
                          .filter(o => o.id !== ing.suggestedInventoryItemId)
                          .map((opt) => (
                            <CommandItem
                              key={opt.id}
                              value={opt.name}
                              onSelect={() => {
                                onLink(opt.id, opt.name);
                                setLinkOpen(false);
                              }}
                              data-testid={`option-link-${opt.name}`}
                            >
                              {opt.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                      {oglOptions.length > 0 && (
                        <CommandGroup heading="Order Guide Items">
                          {ing.orderGuideLineId && (
                            <CommandItem
                              key={`ogl-suggested-${ing.orderGuideLineId}`}
                              value={`ogl suggested ${ing.orderGuideLineName}`}
                              onSelect={() => {
                                if (ing.orderGuideLinkedInventoryItemId) {
                                  onLink(ing.orderGuideLinkedInventoryItemId, ing.orderGuideLineName!);
                                } else {
                                  setLinkOpen(false);
                                  setNewItemName(ing.orderGuideLineName || ing.name);
                                  setCreateOpen(true);
                                }
                                setLinkOpen(false);
                              }}
                              data-testid={`option-ogl-suggested-${ing.orderGuideLineName}`}
                            >
                              <Sparkles className="h-3 w-3 mr-1 text-primary" />
                              {ing.orderGuideLineName}
                              <span className="text-xs text-muted-foreground ml-1">
                                {ing.orderGuideLinkedInventoryItemId ? "(linked)" : "(no inventory link)"}
                              </span>
                            </CommandItem>
                          )}
                          {oglOptions
                            .filter(o => o.id !== ing.orderGuideLineId)
                            .map((ogl) => (
                              <CommandItem
                                key={`ogl-${ogl.id}`}
                                value={`ogl ${ogl.productName}`}
                                onSelect={() => {
                                  if (ogl.matchedInventoryItemId) {
                                    onLink(ogl.matchedInventoryItemId, ogl.productName);
                                  } else {
                                    setLinkOpen(false);
                                    setNewItemName(ogl.productName);
                                    setCreateOpen(true);
                                  }
                                  setLinkOpen(false);
                                }}
                                data-testid={`option-ogl-${ogl.productName}`}
                              >
                                {ogl.productName}
                                {!ogl.matchedInventoryItemId && (
                                  <span className="text-xs text-muted-foreground ml-1">(will create)</span>
                                )}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      )}
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Popover open={createOpen} onOpenChange={setCreateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid={`button-create-${ing.name}`}>
                <Plus className="h-3 w-3 mr-1" />
                Create
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="end">
              <p className="text-xs font-medium mb-2">Create inventory item</p>
              <Input
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                placeholder="Item name"
                className="mb-2"
                data-testid={`input-new-item-name-${ing.name}`}
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  onCreate(newItemName.trim() || ing.name);
                  setCreateOpen(false);
                }}
                disabled={!newItemName.trim()}
                data-testid={`button-confirm-create-${ing.name}`}
              >
                Create Item
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      )}
      {isResolved && (
        <button
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={onClearResolution}
          data-testid={`button-clear-resolution-${ing.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {isMatched && (
        <Badge variant="secondary" className="text-xs">Linked</Badge>
      )}
    </div>
  );
}

// ---- MatchingScreen --------------------------------------------------------

function MatchingScreen({
  summary,
  onFinish,
}: {
  summary: ImportedSummary;
  onFinish: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [saving, setSaving] = useState(false);

  const menuItemIds = summary.items.map(i => i.id);
  const queryString = menuItemIds.map(id => `menuItemIds[]=${encodeURIComponent(id)}`).join("&");

  const { data: matchData, isLoading } = useQuery<MenuItemMatch[]>({
    queryKey: ["/api/menu-scan/match-ingredients", menuItemIds],
    queryFn: async () => {
      const res = await fetch(`/api/menu-scan/match-ingredients?${queryString}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load matching data");
      const json = await res.json() as { data: MenuItemMatch[] };
      return json.data;
    },
    enabled: menuItemIds.length > 0,
    staleTime: 60_000,
  });

  const { data: inventoryData, isLoading: loadingInventory } = useQuery<InventoryItemOption[]>({
    queryKey: ["/api/inventory-items"],
    queryFn: async () => {
      const res = await fetch("/api/inventory-items", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json() as { data?: InventoryItemOption[] } | InventoryItemOption[];
      return Array.isArray(json) ? json : (json.data || []);
    },
    staleTime: 30_000,
  });

  const { data: oglData } = useQuery<OGLOption[]>({
    queryKey: ["/api/order-guide-lines"],
    queryFn: async () => {
      const res = await fetch("/api/order-guide-lines", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json() as { data?: OGLOption[] };
      return json.data || [];
    },
    staleTime: 60_000,
  });

  const inventoryOptions: InventoryItemOption[] = (inventoryData || []).map((item: any) => ({
    id: item.id,
    name: item.name,
  }));

  const oglOptions: OGLOption[] = oglData || [];

  // Count ingredients that need resolution: unmatched ones + AI-extracted matched ones
  // (AI-matched are pre-populated as resolutions but user can still override them)
  const allUnmatched: { menuItemId: string; ing: IngredientMatch }[] = [];
  if (matchData) {
    for (const mi of matchData) {
      for (const ing of mi.ingredients) {
        if (ing.status === "unmatched" || (ing.aiExtracted && ing.status === "matched")) {
          allUnmatched.push({ menuItemId: mi.menuItemId, ing });
        }
      }
    }
  }
  const unmatchedTotal = allUnmatched.length;
  const resolvedCount = resolutions.size;
  const progressPct = unmatchedTotal > 0 ? Math.round((resolvedCount / unmatchedTotal) * 100) : 100;

  // Pre-populate resolutions for AI-extracted ingredients that backend already matched.
  // This ensures they appear resolved in the UI and are persisted on Finish.
  useEffect(() => {
    if (!matchData) return;
    setResolutions(prev => {
      const next = new Map(prev);
      for (const mi of matchData) {
        for (const ing of mi.ingredients) {
          if (ing.aiExtracted && ing.status === "matched" && ing.suggestedInventoryItemId && ing.suggestedInventoryItemName) {
            const key = resolutionKey(ing, mi.menuItemId);
            if (!next.has(key)) {
              next.set(key, {
                type: "ai-link",
                key,
                menuItemId: mi.menuItemId,
                ingredientName: ing.name,
                inventoryItemId: ing.suggestedInventoryItemId,
                inventoryItemName: ing.suggestedInventoryItemName,
              });
            }
          }
        }
      }
      return next;
    });
  }, [matchData]);

  const setResolution = (key: string, resolution: Resolution) => {
    setResolutions(prev => { const next = new Map(prev); next.set(key, resolution); return next; });
  };
  const clearResolution = (key: string) => {
    setResolutions(prev => { const next = new Map(prev); next.delete(key); return next; });
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      // Resolve default unit (lb) — required for new recipe components
      const unitsRes = await fetch("/api/units", { credentials: "include" });
      const unitsJson = await unitsRes.json() as Array<{ id: string; abbreviation: string }> | { data?: Array<{ id: string; abbreviation: string }> };
      const unitsList = Array.isArray(unitsJson) ? unitsJson : (unitsJson.data || []);
      const defaultUnit = unitsList.find(u => u.abbreviation === "lb") || unitsList[0];
      const defaultUnitId = defaultUnit?.id ?? null;

      // Group AI-extracted resolutions by menuItemId so we can create one recipe per item
      const recipeIdByMenuItemId = new Map<string, string>();

      // First pass: create recipes for menu items that need them (AI-extracted resolutions)
      const aiResolutions = Array.from(resolutions.values()).filter(
        r => r.type === "ai-link" || r.type === "ai-create"
      ) as (Extract<Resolution, { type: "ai-link" }> | Extract<Resolution, { type: "ai-create" }>)[];

      const menuItemsNeedingRecipe = Array.from(new Set(aiResolutions.map(r => r.menuItemId)));
      for (const menuItemId of menuItemsNeedingRecipe) {
        const menuItem = summary.items.find(i => i.id === menuItemId);
        if (!menuItem) continue;

        // Create a recipe for this menu item
        const recipeRes = await apiRequest("POST", "/api/recipes", {
          name: menuItem.name,
          yieldQty: 1,
          canBeIngredient: 0,
        });
        if (!recipeRes.ok) {
          const err = await recipeRes.json() as { error?: string };
          throw new Error(err.error || "Failed to create recipe");
        }
        const newRecipe = await recipeRes.json() as { id: string };
        if (!newRecipe.id) throw new Error("Recipe creation returned no ID");

        recipeIdByMenuItemId.set(menuItemId, newRecipe.id);

        // Link recipe to menu item
        await apiRequest("PATCH", `/api/menu-items/${menuItemId}`, { recipeId: newRecipe.id });
      }

      // Second pass: apply all resolutions
      for (const [, resolution] of Array.from(resolutions.entries())) {
        if (resolution.type === "link") {
          // Existing recipe component — patch componentId to link to inventory item
          await apiRequest("PATCH", `/api/recipe-components/${resolution.componentId}`, {
            componentId: resolution.inventoryItemId,
            missingItemName: null,
          });
        } else if (resolution.type === "create") {
          // Existing recipe component — create inventory item then patch
          const createRes = await apiRequest("POST", "/api/inventory-items", {
            name: resolution.newItemName,
          });
          if (createRes.ok) {
            const newItem = await createRes.json() as { id?: string } | { data?: { id: string } };
            const newId = (newItem as any).id || (newItem as any).data?.id;
            if (newId) {
              await apiRequest("PATCH", `/api/recipe-components/${resolution.componentId}`, {
                componentId: newId,
                missingItemName: null,
              });
            }
          }
        } else if (resolution.type === "ai-link") {
          // AI-extracted ingredient — create recipe component linked to inventory item
          const recipeId = recipeIdByMenuItemId.get(resolution.menuItemId);
          if (!recipeId) continue;
          await apiRequest("POST", "/api/recipe-components", {
            recipeId,
            componentId: resolution.inventoryItemId,
            componentType: "inventory_item",
            qty: 1,
            unitId: defaultUnitId,
          });
        } else if (resolution.type === "ai-create") {
          // AI-extracted ingredient — create inventory item then create recipe component
          const recipeId = recipeIdByMenuItemId.get(resolution.menuItemId);
          if (!recipeId) continue;

          const createRes = await apiRequest("POST", "/api/inventory-items", {
            name: resolution.newItemName,
          });
          if (createRes.ok) {
            const newItem = await createRes.json() as { id?: string } | { data?: { id: string } };
            const newId = (newItem as any).id || (newItem as any).data?.id;
            if (newId) {
              await apiRequest("POST", "/api/recipe-components", {
                recipeId,
                componentId: newId,
                componentType: "inventory_item",
                qty: 1,
                unitId: defaultUnitId,
              });
            }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Done!", description: "Ingredient links saved." });
      navigate("/menu-insights");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Ingredient Matching</h2>
          <p className="text-sm text-muted-foreground mt-1">Analyzing your menu items…</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Sparkles className="h-5 w-5 animate-pulse" />
          <span className="text-sm">Matching ingredients to your inventory…</span>
        </div>
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="pt-4">
              <Skeleton className="h-4 w-40 mb-3" />
              <Skeleton className="h-8 w-full mb-2" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const hasAnyIngredients = matchData && matchData.some(mi => mi.ingredients.length > 0);

  if (!hasAnyIngredients) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Ingredient Matching</h2>
          <p className="text-sm text-muted-foreground mt-1">
            No ingredient data found for these menu items yet.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
            <p className="font-medium">All set!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Link ingredients to inventory later from the Recipe Builder.
            </p>
          </CardContent>
        </Card>
        <Button onClick={() => navigate("/menu-insights")} data-testid="button-go-to-menu">
          View Menu Insights
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold" data-testid="text-matching-title">Ingredient Matching</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Link ingredients to inventory so recipes can be costed automatically.
        </p>
      </div>

      {unmatchedTotal > 0 && (
        <div className="space-y-1" data-testid="matching-progress">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{resolvedCount} of {unmatchedTotal} resolved</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-2 bg-primary rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {(matchData || []).map((mi) => {
          if (mi.ingredients.length === 0) return null;
          // AI-extracted "matched" go with unmatched so they get real handlers + are counted in progress
          const unmatchedIngs = mi.ingredients.filter(
            ing => ing.status === "unmatched" || (ing.aiExtracted && ing.status === "matched")
          );
          // Only non-AI-extracted matched ingredients are truly auto-linked (no action needed)
          const matchedIngs = mi.ingredients.filter(
            ing => ing.status === "matched" && !ing.aiExtracted
          );

          return (
            <Card key={mi.menuItemId} data-testid={`card-menu-item-${mi.menuItemId}`}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold">
                  {mi.menuItemName.charAt(0).toUpperCase() + mi.menuItemName.slice(1)}
                </CardTitle>
                {unmatchedIngs.length === 0 && (
                  <CardDescription className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    All ingredients linked
                  </CardDescription>
                )}
                {!mi.recipeId && mi.ingredients.some(i => i.aiExtracted) && (
                  <CardDescription className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    AI-suggested ingredients — no recipe yet
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {unmatchedIngs.map((ing) => {
                  const key = resolutionKey(ing, mi.menuItemId);
                  return (
                    <IngredientRow
                      key={key}
                      ing={ing}
                      menuItemId={mi.menuItemId}
                      resolution={resolutions.get(key)}
                      inventoryOptions={inventoryOptions}
                      oglOptions={oglOptions}
                      loadingOptions={loadingInventory}
                      onLink={(inventoryItemId, inventoryItemName) => {
                        if (ing.componentId) {
                          setResolution(key, { type: "link", key, componentId: ing.componentId, inventoryItemId, inventoryItemName });
                        } else {
                          setResolution(key, { type: "ai-link", key, menuItemId: mi.menuItemId, ingredientName: ing.name, inventoryItemId, inventoryItemName });
                        }
                      }}
                      onCreate={(newItemName) => {
                        if (ing.componentId) {
                          setResolution(key, { type: "create", key, componentId: ing.componentId, ingredientName: ing.name, newItemName });
                        } else {
                          setResolution(key, { type: "ai-create", key, menuItemId: mi.menuItemId, ingredientName: ing.name, newItemName });
                        }
                      }}
                      onClearResolution={() => clearResolution(key)}
                    />
                  );
                })}
                {matchedIngs.map((ing) => (
                  <IngredientRow
                    key={ing.inventoryItemId || ing.name}
                    ing={ing}
                    menuItemId={mi.menuItemId}
                    resolution={undefined}
                    inventoryOptions={inventoryOptions}
                    oglOptions={oglOptions}
                    loadingOptions={loadingInventory}
                    onLink={() => {}}
                    onCreate={() => {}}
                    onClearResolution={() => {}}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button onClick={handleFinish} disabled={saving} data-testid="button-finish-matching">
          {saving ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
          ) : (
            <>Finish <ArrowRight className="h-4 w-4 ml-2" /></>
          )}
        </Button>
        <Button variant="ghost" onClick={() => navigate("/menu-items")} data-testid="button-skip-matching">
          Skip for now
        </Button>
      </div>
    </div>
  );
}

// ---- Main page -------------------------------------------------------------

export default function MenuScanTool() {
  const [, navigate] = useLocation();
  const [screen, setScreen] = useState<Screen>("scan");
  const [summary, setSummary] = useState<ImportedSummary | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);

  useEffect(() => {
    const session = loadSavedSession();
    if (session) setSavedSession(session);
  }, []);

  const handleScanComplete = (
    items: ApprovedMenuItem[],
    sessionId: string,
    intelligence: MenuIntelligence,
    hasBar?: boolean,
  ) => {
    const deptMap = new Map<string, number>();
    let withPrices = 0;

    for (const item of items) {
      const dept = (item.department || "").trim() || "Other";
      deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
      if (item.price != null && item.price > 0) withPrices++;
    }

    const deptBreakdown = Array.from(deptMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([dept, count]) => ({ dept, count }));

    const newSummary: ImportedSummary = { items, sessionId, intelligence, hasBar, deptBreakdown, withPrices };
    setSummary(newSummary);
    persistSession(newSummary, "summary");
    setSavedSession(null);
    setScreen("summary");
  };

  const handleResume = () => {
    if (!savedSession) return;
    const { lastScreen, ...summaryData } = savedSession;
    setSummary(summaryData);
    setSavedSession(null);
    setScreen(lastScreen);
  };

  const handleStartFresh = () => {
    clearPersistedSession();
    setSavedSession(null);
  };

  const handleFinish = () => {
    clearPersistedSession();
    navigate("/menu-insights");
  };

  const STEP_LABELS: Record<Screen, string> = {
    scan: "Scan",
    summary: "Summary",
    matching: "Match",
  };
  const STEPS: Screen[] = ["scan", "summary", "matching"];
  const currentIdx = STEPS.indexOf(screen);

  return (
    <TierGate feature="recipe_costing">
      <div className="h-full overflow-auto pb-4">
        <div className="p-4 space-y-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (screen === "scan") navigate("/menu-items");
                else if (screen === "summary") setScreen("scan");
                else if (screen === "matching") setScreen("summary");
              }}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Import Menu from Image</h1>
              <p className="text-sm text-muted-foreground">
                AI extracts your menu items automatically
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2" data-testid="scan-tool-stepper">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium border transition-colors ${
                  i < currentIdx
                    ? "bg-primary border-primary text-primary-foreground"
                    : i === currentIdx
                    ? "bg-primary/10 border-primary text-primary"
                    : "border-muted-foreground/30 text-muted-foreground"
                }`}>
                  {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className={`text-sm hidden sm:block ${i === currentIdx ? "font-medium" : "text-muted-foreground"}`}>
                  {STEP_LABELS[step]}
                </span>
                {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            ))}
          </div>

          {screen === "scan" && savedSession && (
            <Card data-testid="card-resume-session">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Resume previous scan
                </CardTitle>
                <CardDescription>
                  You have an unfinished scan with {savedSession.items.length} item{savedSession.items.length !== 1 ? "s" : ""}.
                  Pick up where you left off or start over.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 flex flex-col sm:flex-row gap-2">
                <Button onClick={handleResume} data-testid="button-resume-session">
                  Resume — go to {savedSession.lastScreen === "matching" ? "Ingredient Matching" : "Summary"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="ghost" onClick={handleStartFresh} data-testid="button-start-fresh">
                  Start fresh
                </Button>
              </CardContent>
            </Card>
          )}

          {screen === "scan" && (
            <MenuScanStep onComplete={handleScanComplete} />
          )}

          {screen === "summary" && summary && (
            <SummaryScreen
              summary={summary}
              onContinue={() => {
                persistSession(summary, "matching");
                setScreen("matching");
              }}
              onSkip={() => {
                clearPersistedSession();
                navigate("/menu-insights");
              }}
            />
          )}

          {screen === "matching" && summary && (
            <MatchingScreen
              summary={summary}
              onFinish={handleFinish}
            />
          )}
        </div>
      </div>
    </TierGate>
  );
}
