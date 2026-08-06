/**
 * POS Item-Mapping — Reconciliation Experience
 *
 * Replaces the raw list with a guided reconciliation view:
 *  - Progress bar showing (mapped + ignored) / total
 *  - Filter tabs: Unresolved | All | Mapped | Ignored
 *  - Per-row actions: link to menu item (batch-saved), Ignore / Unignore (instant), Create new (dialog)
 *  - Create-and-link dialog: pre-fills name from Square, creates FnB menu item + links in one step
 */
import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Search, CheckCircle2, AlertCircle, EyeOff, Eye,
  PlusCircle, TriangleAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogVariation {
  externalItemId: string;
  externalVariationId: string;
  externalItemName: string;
  externalVariationName: string;
  menuItemId: string | null;
  isMapped: boolean;
  isIgnored: boolean;
  isModifier: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  pluSku: string;
  recipeId: string | null;
}

type FilterTab = "unresolved" | "all" | "mapped" | "ignored";

// ── Component ─────────────────────────────────────────────────────────────────

export default function PosItemMapping() {
  const [, params] = useRoute("/pos/item-mapping/:connectionId");
  const connectionId = params?.connectionId ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getEffectiveCompanyId } = useAuth();
  const companyId = getEffectiveCompanyId();

  // ── Local state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("unresolved");

  // Pending mapping changes (select-dropdown) — batch saved on "Save"
  const [pendingMappings, setPendingMappings] = useState<Record<string, string | null>>({});

  // Create-and-link dialog
  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    variation: CatalogVariation | null;
    name: string;
  }>({ open: false, variation: null, name: "" });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: catalog = [], isLoading: catalogLoading } = useQuery<CatalogVariation[]>({
    queryKey: [`/api/pos/connections/${connectionId}/catalog`],
    enabled: !!connectionId,
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
    enabled: !!companyId,
  });

  // ── Derived values ─────────────────────────────────────────────────────────

  /** Effective menuItemId: pending change wins over server value */
  const effectiveMenuItemId = (v: CatalogVariation): string | null =>
    pendingMappings[v.externalVariationId] !== undefined
      ? pendingMappings[v.externalVariationId]
      : v.menuItemId;

  const totalCount = catalog.length;
  const mappedCount = catalog.filter(
    (v) => !v.isIgnored && !!effectiveMenuItemId(v),
  ).length;
  const ignoredCount = catalog.filter((v) => v.isIgnored).length;
  const resolvedCount = mappedCount + ignoredCount;
  const unresolvedCount = totalCount - resolvedCount;
  const progressPct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  const hasPendingChanges = Object.keys(pendingMappings).length > 0;

  const filtered = useMemo(() => {
    let list = catalog;
    if (activeTab === "unresolved") {
      list = catalog.filter((v) => !v.isIgnored && !effectiveMenuItemId(v));
    } else if (activeTab === "mapped") {
      list = catalog.filter((v) => !v.isIgnored && !!effectiveMenuItemId(v));
    } else if (activeTab === "ignored") {
      list = catalog.filter((v) => v.isIgnored);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) =>
          v.externalItemName.toLowerCase().includes(q) ||
          v.externalVariationName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [catalog, activeTab, search, pendingMappings]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Batch save pending select-dropdown changes */
  const saveBatchMutation = useMutation({
    mutationFn: async () => {
      const payload = catalog
        .filter((v) => pendingMappings[v.externalVariationId] !== undefined)
        .map((v) => ({
          externalItemId: v.externalItemId,
          externalVariationId: v.externalVariationId,
          externalItemName: v.externalItemName,
          externalVariationName: v.externalVariationName,
          menuItemId: pendingMappings[v.externalVariationId],
          ignored: v.isIgnored,
        }));
      await apiRequest("POST", `/api/pos/connections/${connectionId}/item-mappings`, {
        mappings: payload,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/pos/connections/${connectionId}/catalog`] });
      qc.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
      setPendingMappings({});
      toast({ title: "Mappings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error saving mappings", description: err.message, variant: "destructive" });
    },
  });

  /** Instantly ignore or unignore a single variation via PATCH (upsert semantics) */
  const ignoreMutation = useMutation({
    mutationFn: async ({
      variation,
      ignored,
    }: {
      variation: CatalogVariation;
      ignored: boolean;
    }) => {
      await apiRequest(
        "PATCH",
        `/api/pos/connections/${connectionId}/item-mappings/${encodeURIComponent(variation.externalVariationId)}`,
        {
          ignored,
          // Supplied so the server can create the row on first-time ignore
          externalItemId: variation.externalItemId,
          externalItemName: variation.externalItemName,
          externalVariationName: variation.externalVariationName,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/pos/connections/${connectionId}/catalog`] });
      qc.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  /** Create a new FnB menu item and link it in one step */
  const createAndLinkMutation = useMutation({
    mutationFn: async ({
      variation,
      menuItemName,
    }: {
      variation: CatalogVariation;
      menuItemName: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/pos/connections/${connectionId}/item-mappings/create-and-link`,
        {
          externalVariationId: variation.externalVariationId,
          externalItemId: variation.externalItemId,
          externalItemName: variation.externalItemName,
          externalVariationName: variation.externalVariationName,
          menuItemName,
        },
      );
      return res;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: [`/api/pos/connections/${connectionId}/catalog`] });
      qc.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
      qc.invalidateQueries({ queryKey: ["/api/menu-items"] });
      // Remove any pending mapping entry for this variation (now saved server-side)
      setPendingMappings((prev) => {
        const next = { ...prev };
        delete next[data?.mapping?.externalVariationId];
        return next;
      });
      toast({
        title: "Menu item created and linked",
        description: `"${data?.menuItem?.name}" is now linked to this Square variation.`,
      });
      setCreateDialog({ open: false, variation: null, name: "" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectChange = (externalVariationId: string, value: string) => {
    setPendingMappings((prev) => ({
      ...prev,
      [externalVariationId]: value === "__none__" ? null : value,
    }));
  };

  const handleIgnore = (v: CatalogVariation) => {
    ignoreMutation.mutate({ variation: v, ignored: true });
    // Optimistically clear pending mapping for this row
    setPendingMappings((prev) => {
      const next = { ...prev };
      delete next[v.externalVariationId];
      return next;
    });
  };

  const handleUnignore = (v: CatalogVariation) => {
    ignoreMutation.mutate({ variation: v, ignored: false });
  };

  const openCreateDialog = (v: CatalogVariation) => {
    setCreateDialog({
      open: true,
      variation: v,
      name: v.externalVariationName === "Regular" || v.externalVariationName === ""
        ? v.externalItemName
        : `${v.externalItemName} — ${v.externalVariationName}`,
    });
  };

  // ── Tab labels ─────────────────────────────────────────────────────────────

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "unresolved", label: "Unresolved", count: unresolvedCount },
    { key: "all", label: "All", count: totalCount },
    { key: "mapped", label: "Mapped", count: mappedCount },
    { key: "ignored", label: "Ignored", count: ignoredCount },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Reconcile Menu Items</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Match each Square variation to the FnB menu item it represents.
          Mapped items flow into your food-cost reports. Ignore modifiers and
          non-food items that don&apos;t need tracking.
        </p>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mb-5 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {resolvedCount} of {totalCount} resolved
              {unresolvedCount > 0 && (
                <span className="text-muted-foreground font-normal ml-1.5">
                  ({unresolvedCount} remaining)
                </span>
              )}
            </span>
            <span className="text-muted-foreground text-xs">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-2" />
          <div className="flex gap-3 text-xs text-muted-foreground">
            {mappedCount > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                {mappedCount} mapped
              </span>
            )}
            {ignoredCount > 0 && (
              <span className="flex items-center gap-1">
                <EyeOff className="h-3 w-3" />
                {ignoredCount} ignored
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filter tabs + search */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              ].join(" ")}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-1.5 text-xs opacity-70">{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-orange-500" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm w-52 border-orange-500/40 focus-visible:ring-orange-500/50"
          />
        </div>
      </div>

      {/* Item list */}
      {catalogLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading catalog…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          {activeTab === "unresolved" && unresolvedCount === 0
            ? "🎉 All items are resolved — nothing left to do here."
            : "No items match your filter."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const currentMenuItemId = effectiveMenuItemId(v);
            const selectedMenuItem = currentMenuItemId
              ? menuItems.find((mi) => mi.id === currentMenuItemId)
              : undefined;
            const noRecipeWarning =
              !!currentMenuItemId && selectedMenuItem && !selectedMenuItem.recipeId;
            const isIgnoring =
              ignoreMutation.isPending &&
              (ignoreMutation.variables as any)?.variation?.externalVariationId === v.externalVariationId;

            return (
              <Card
                key={v.externalVariationId}
                className={[
                  v.isIgnored
                    ? "opacity-50 border-dashed"
                    : noRecipeWarning
                    ? "border-amber-300 dark:border-amber-700"
                    : currentMenuItemId
                    ? "border-green-200 dark:border-green-900"
                    : "",
                ].join(" ")}
              >
                <CardContent className="py-2.5 px-3">
                  <div className="flex items-center gap-2">

                    {/* Status icon */}
                    <div className="shrink-0">
                      {v.isIgnored ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground/40" />
                      ) : noRecipeWarning ? (
                        <TriangleAlert className="h-4 w-4 text-amber-500" />
                      ) : currentMenuItemId ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </div>

                    {/* Square item name + variation */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm truncate">{v.externalItemName}</p>
                        {v.isModifier && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Modifier
                          </Badge>
                        )}
                        {v.isIgnored && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">
                            Ignored
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{v.externalVariationName}</p>
                      {noRecipeWarning && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          No recipe — food cost will show $0
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    {v.isIgnored ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 h-7 text-xs"
                        onClick={() => handleUnignore(v)}
                        disabled={isIgnoring}
                      >
                        {isIgnoring ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><Eye className="h-3 w-3 mr-1" />Unignore</>
                        )}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Menu item selector */}
                        <Select
                          value={currentMenuItemId ?? "__none__"}
                          onValueChange={(val) =>
                            handleSelectChange(v.externalVariationId, val)
                          }
                        >
                          <SelectTrigger className="h-7 text-xs w-48">
                            <SelectValue placeholder="Link to menu item…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not linked —</SelectItem>
                            {menuItems.map((mi) => (
                              <SelectItem key={mi.id} value={mi.id}>
                                {mi.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Create new shortcut */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1.5 text-muted-foreground hover:text-foreground shrink-0"
                          title="Create new menu item and link"
                          onClick={() => openCreateDialog(v)}
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                        </Button>

                        {/* Ignore */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1.5 text-muted-foreground hover:text-foreground shrink-0"
                          title="Ignore this item (modifier, discount, etc.)"
                          onClick={() => handleIgnore(v)}
                          disabled={isIgnoring}
                        >
                          {isIgnoring ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex justify-between items-center pt-6">
        <Button
          variant="outline"
          onClick={() => navigate(`/pos/location-mapping/${connectionId}`)}
        >
          Back
        </Button>
        <div className="flex gap-2">
          {hasPendingChanges && (
            <Button
              onClick={() => saveBatchMutation.mutate()}
              disabled={saveBatchMutation.isPending}
            >
              {saveBatchMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save Mappings
            </Button>
          )}
          <Button
            variant={hasPendingChanges ? "outline" : "default"}
            onClick={() => navigate("/settings?tab=connections")}
          >
            Done
          </Button>
        </div>
      </div>

      {/* Create-and-link dialog */}
      <Dialog
        open={createDialog.open}
        onOpenChange={(open) =>
          setCreateDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create menu item</DialogTitle>
            <DialogDescription>
              A new FnB menu item will be created and immediately linked to this
              Square variation. You can add a recipe to it later.
            </DialogDescription>
          </DialogHeader>

          {createDialog.variation && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted p-3 text-sm space-y-0.5">
                <p className="font-medium">{createDialog.variation.externalItemName}</p>
                <p className="text-muted-foreground text-xs">
                  {createDialog.variation.externalVariationName}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Menu item name</Label>
                <Input
                  value={createDialog.name}
                  onChange={(e) =>
                    setCreateDialog((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Margherita Pizza — Large"
                  autoFocus
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      createDialog.name.trim() &&
                      !createAndLinkMutation.isPending
                    ) {
                      createAndLinkMutation.mutate({
                        variation: createDialog.variation!,
                        menuItemName: createDialog.name.trim(),
                      });
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  This name appears in your food-cost reports. You can rename it later.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setCreateDialog({ open: false, variation: null, name: "" })
              }
            >
              Cancel
            </Button>
            <Button
              disabled={
                !createDialog.name.trim() || createAndLinkMutation.isPending
              }
              onClick={() => {
                if (!createDialog.variation) return;
                createAndLinkMutation.mutate({
                  variation: createDialog.variation,
                  menuItemName: createDialog.name.trim(),
                });
              }}
            >
              {createAndLinkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create & Link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
