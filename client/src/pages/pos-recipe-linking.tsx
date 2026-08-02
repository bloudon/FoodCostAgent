/**
 * POS Recipe Linking
 *
 * Bulk-link POS-imported menu items (those with a PLU/SKU but no recipe) to
 * ingredient recipes, so the theoretical food cost report can calculate cost %
 * per outlet (Bay Window, Grill, Banquet, etc.).
 *
 * Flow:
 *   1. Fetch all unlinked menu items + fuzzy recipe suggestions from the server.
 *   2. Fetch all recipes for the inline search combobox.
 *   3. Manager reviews suggestions, adjusts selections, then saves in bulk.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  ChevronLeft,
  Link2,
  Loader2,
  CheckCircle2,
  Sparkles,
  Search,
  X,
  ChevronDown,
  AlertCircle,
  BookOpen,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RecipeSuggestion {
  recipeId: string;
  recipeName: string;
  score: number;
  computedCost: number;
}

interface UnlinkedMenuItem {
  id: string;
  name: string;
  pluSku: string | null;
  menuDepartmentId: string | null;
  departmentName: string | null;
  suggestions: RecipeSuggestion[];
}

interface UnlinkedItemsResponse {
  items: UnlinkedMenuItem[];
  total: number;
  recipeCount: number;
}

interface RecipeOption {
  id: string;
  name: string;
  computedCost: number;
}

// ─── Recipe Picker Combobox ─────────────────────────────────────────────────

function RecipePicker({
  value,
  onChange,
  recipes,
  suggestions,
}: {
  value: string | null;
  onChange: (recipeId: string | null) => void;
  recipes: RecipeOption[];
  suggestions: RecipeSuggestion[];
}) {
  const [open, setOpen] = useState(false);

  const selected = value ? recipes.find((r) => r.id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-8 text-sm"
        >
          <span className="truncate">
            {selected ? selected.name : (
              <span className="text-muted-foreground">Select a recipe…</span>
            )}
          </span>
          <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search recipes…" className="h-9" />
          <CommandList>
            <CommandEmpty>No recipes found.</CommandEmpty>

            {/* Clear selection */}
            {value && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-muted-foreground"
                >
                  <X className="h-3 w-3 mr-2" />
                  Clear link
                </CommandItem>
              </CommandGroup>
            )}

            {/* Fuzzy suggestions */}
            {suggestions.length > 0 && (
              <CommandGroup heading="Suggested matches">
                {suggestions.map((s) => (
                  <CommandItem
                    key={s.recipeId}
                    value={s.recipeName}
                    onSelect={() => { onChange(s.recipeId); setOpen(false); }}
                    className="gap-2"
                  >
                    <Sparkles className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate">{s.recipeName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {Math.round(s.score * 100)}%
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* All recipes */}
            <CommandGroup heading="All recipes">
              {recipes.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => { onChange(r.id); setOpen(false); }}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  {r.computedCost > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      ${r.computedCost.toFixed(2)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

function PosRecipeLinkingContent() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // name filter
  const [nameFilter, setNameFilter] = useState("");
  // department filter
  const [deptFilter, setDeptFilter] = useState<string>("all");

  // Map of menuItemId → selected recipeId (null = clear, undefined = untouched)
  const [selections, setSelections] = useState<Record<string, string | null>>({});

  // ── Fetch unlinked items ──────────────────────────────────────────────────
  const {
    data: unlinkedData,
    isLoading: loadingItems,
    isError: itemsError,
    refetch: refetchItems,
  } = useQuery<UnlinkedItemsResponse>({
    queryKey: ["/api/imports/sales-by-item/unlinked-items"],
    queryFn: async () => {
      const res = await fetch("/api/imports/sales-by-item/unlinked-items", {
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to load unlinked items");
      }
      return res.json();
    },
  });

  // ── Fetch all recipes (for the picker) ───────────────────────────────────
  const { data: recipesData, isLoading: loadingRecipes } = useQuery<
    Array<{ id: string; name: string; computedCost: number }>
  >({
    queryKey: ["/api/recipes"],
    queryFn: async () => {
      const res = await fetch("/api/recipes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load recipes");
      const json = await res.json();
      // API returns { data: [...] } or just [...]
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    select: (data) =>
      data
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          computedCost: r.computedCost ?? 0,
        }))
        .sort((a: RecipeOption, b: RecipeOption) => a.name.localeCompare(b.name)),
  });

  // ── Bulk link mutation ────────────────────────────────────────────────────
  const linkMutation = useMutation({
    mutationFn: async (
      links: Array<{ menuItemId: string; recipeId: string | null }>,
    ) => {
      const res = await fetch("/api/imports/sales-by-item/bulk-link-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ links }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      return data as { success: boolean; linked: number; skipped: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Recipes linked",
        description: `${data.linked} item${data.linked !== 1 ? "s" : ""} linked successfully.`,
      });
      setSelections({});
      queryClient.invalidateQueries({ queryKey: ["/api/imports/sales-by-item/unlinked-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Pre-apply top suggestion for items that haven't been touched ──────────
  const applyAllSuggestions = () => {
    const newSel: Record<string, string | null> = { ...selections };
    (unlinkedData?.items ?? []).forEach((item) => {
      if (!(item.id in newSel) && item.suggestions.length > 0) {
        newSel[item.id] = item.suggestions[0].recipeId;
      }
    });
    setSelections(newSel);
    toast({
      title: "Suggestions applied",
      description: "Review each row, then click Save Links to commit.",
    });
  };

  // ── Filtered & computed items ─────────────────────────────────────────────
  const allDepts = useMemo(() => {
    const depts = new Map<string, string>();
    (unlinkedData?.items ?? []).forEach((item) => {
      if (item.menuDepartmentId && item.departmentName) {
        depts.set(item.menuDepartmentId, item.departmentName);
      }
    });
    return Array.from(depts.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [unlinkedData]);

  const filteredItems = useMemo(() => {
    let items = unlinkedData?.items ?? [];
    if (nameFilter.trim()) {
      const lc = nameFilter.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(lc) ||
          (i.pluSku ?? "").toLowerCase().includes(lc),
      );
    }
    if (deptFilter !== "all") {
      items = items.filter((i) => i.menuDepartmentId === deptFilter);
    }
    return items;
  }, [unlinkedData, nameFilter, deptFilter]);

  const pendingLinks = useMemo(
    () =>
      Object.entries(selections)
        .filter(([, v]) => v !== undefined)
        .map(([menuItemId, recipeId]) => ({ menuItemId, recipeId })),
    [selections],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (pendingLinks.length === 0) return;
    linkMutation.mutate(pendingLinks);
  };

  const handleSetSelection = (itemId: string, recipeId: string | null) => {
    setSelections((prev) => ({ ...prev, [itemId]: recipeId }));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const recipes = recipesData ?? [];
  const isLoading = loadingItems || loadingRecipes;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/sales-by-item-import")}
          data-testid="button-back"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
            Link Recipes to POS Menu Items
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect each imported menu item to an ingredient recipe so food cost % can be calculated per outlet
          </p>
        </div>
        {!isLoading && unlinkedData && (
          <Badge variant="secondary" className="text-base px-3 py-1">
            {unlinkedData.total} unlinked
          </Badge>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <Card className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm text-muted-foreground">Loading menu items and recipes…</p>
        </Card>
      )}

      {/* Error */}
      {itemsError && !isLoading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load unlinked items.{" "}
            <button className="underline" onClick={() => refetchItems()}>
              Retry
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* All linked! */}
      {!isLoading && !itemsError && unlinkedData && unlinkedData.total === 0 && (
        <Card className="p-12 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
          <p className="font-semibold text-lg mb-1">All menu items are linked!</p>
          <p className="text-sm text-muted-foreground mb-4">
            Every POS-imported menu item has a recipe assigned.
          </p>
          <Button variant="outline" onClick={() => setLocation("/tfc/variance")}>
            View Food Cost Report
          </Button>
        </Card>
      )}

      {/* No recipes */}
      {!isLoading && !itemsError && unlinkedData && unlinkedData.total > 0 && unlinkedData.recipeCount === 0 && (
        <Alert className="mb-4">
          <BookOpen className="h-4 w-4" />
          <AlertDescription>
            No recipes found. Build recipes in the{" "}
            <button
              className="underline font-medium"
              onClick={() => setLocation("/recipes")}
            >
              Recipe Builder
            </button>{" "}
            first, then come back to link them.
          </AlertDescription>
        </Alert>
      )}

      {/* Main content */}
      {!isLoading && !itemsError && unlinkedData && unlinkedData.total > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by name or PLU…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="pl-8"
                data-testid="input-name-filter"
              />
            </div>

            {allDepts.length > 1 && (
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                data-testid="select-dept-filter"
              >
                <option value="all">All departments</option>
                {allDepts.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}

            <Button
              variant="outline"
              onClick={applyAllSuggestions}
              disabled={recipes.length === 0}
              data-testid="button-apply-suggestions"
            >
              <Sparkles className="h-4 w-4 mr-2 text-amber-500" />
              Apply All Suggestions
            </Button>

            <Button
              onClick={handleSave}
              disabled={pendingLinks.length === 0 || linkMutation.isPending}
              data-testid="button-save-links"
            >
              {linkMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
              ) : (
                <><Link2 className="h-4 w-4 mr-2" />Save {pendingLinks.length > 0 ? `${pendingLinks.length} ` : ""}Links</>
              )}
            </Button>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Unlinked Menu Items
                {filteredItems.length !== unlinkedData.total && (
                  <span className="text-muted-foreground font-normal ml-2 text-sm">
                    (showing {filteredItems.length} of {unlinkedData.total})
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Select a recipe for each item. Items with a ✦ badge have auto-suggestions based on name similarity.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Menu Item</TableHead>
                    <TableHead className="w-24">PLU/SKU</TableHead>
                    <TableHead className="w-36">Department</TableHead>
                    <TableHead className="w-64">Linked Recipe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No items match your filter
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => {
                      const selected = selections[item.id];
                      // selected undefined = untouched; null = cleared; string = picked
                      const effectiveRecipeId = selected !== undefined ? selected : null;
                      const hasSuggestion = item.suggestions.length > 0;
                      const isTouched = item.id in selections;

                      return (
                        <TableRow
                          key={item.id}
                          data-testid={`row-item-${item.id}`}
                          className={isTouched && effectiveRecipeId ? "bg-emerald-50/40" : undefined}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{item.name}</span>
                              {hasSuggestion && !isTouched && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] h-4 px-1 border-amber-300 text-amber-600 gap-1"
                                >
                                  <Sparkles className="h-2.5 w-2.5" />
                                  suggested
                                </Badge>
                              )}
                              {isTouched && effectiveRecipeId && (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-mono text-muted-foreground">
                              {item.pluSku ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {item.departmentName ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <RecipePicker
                              value={effectiveRecipeId}
                              onChange={(id) => handleSetSelection(item.id, id)}
                              recipes={recipes}
                              suggestions={item.suggestions}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Footer save row */}
          {pendingLinks.length > 0 && (
            <div className="flex items-center justify-between mt-4 p-3 rounded-lg border bg-muted/40">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{pendingLinks.length}</span>{" "}
                recipe link{pendingLinks.length !== 1 ? "s" : ""} pending
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelections({})}
                  disabled={linkMutation.isPending}
                >
                  Discard changes
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={linkMutation.isPending}
                  data-testid="button-save-links-footer"
                >
                  {linkMutation.isPending ? (
                    <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Saving…</>
                  ) : (
                    <><Link2 className="h-3 w-3 mr-2" />Save Links</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* After all linked nudge */}
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Once all items are linked, the{" "}
            <button
              className="underline"
              onClick={() => setLocation("/tfc/variance")}
            >
              Theoretical Food Cost report
            </button>{" "}
            will show cost % broken out per outlet.
          </p>
        </>
      )}
    </div>
  );
}

export default function PosRecipeLinking() {
  return (
    <TierGate>
      <PosRecipeLinkingContent />
    </TierGate>
  );
}
