import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Save, ArrowLeft, BarChart2, CheckCircle2 } from "lucide-react";
import { SetupProgressBanner } from "@/components/setup-progress-banner";

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  categoryId: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  unit: { id: string; name: string; abbreviation: string } | null;
  active: number;
}

interface Category {
  id: string;
  name: string;
}

interface DirtyRow {
  parLevel: number | null;
  reorderLevel: number | null;
}

export default function ParLevels() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dirty, setDirty] = useState<Record<string, DirtyRow>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    queryFn: async () => {
      const res = await fetch("/api/inventory-items");
      if (!res.ok) throw new Error("Failed to fetch inventory items");
      return res.json();
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: milestonesData } = useQuery<any>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
    staleTime: 0,
  });

  const showBanner = milestonesData && !milestonesData.dismissed;

  const activeItems = useMemo(
    () => items.filter((i) => i.active === 1),
    [items]
  );

  const filteredItems = useMemo(() => {
    return activeItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" ||
        (categoryFilter === "unset" ? !item.categoryId : item.categoryId === categoryFilter);
      return matchesSearch && matchesCategory;
    });
  }, [activeItems, search, categoryFilter]);

  const itemsWithPar = useMemo(
    () => activeItems.filter((i) => {
      const d = dirty[i.id];
      if (d) return d.parLevel !== null && d.parLevel !== undefined;
      return i.parLevel !== null && i.parLevel !== undefined;
    }).length,
    [activeItems, dirty]
  );

  const progressPercent = activeItems.length > 0 ? (itemsWithPar / activeItems.length) * 100 : 0;

  const getVal = (item: InventoryItem, field: "parLevel" | "reorderLevel"): string => {
    if (dirty[item.id] !== undefined) {
      const v = dirty[item.id][field];
      return v === null || v === undefined ? "" : String(v);
    }
    const v = item[field];
    return v === null || v === undefined ? "" : String(v);
  };

  const handleChange = useCallback(
    (itemId: string, field: "parLevel" | "reorderLevel", value: string) => {
      const num = value === "" ? null : parseFloat(value);
      setDirty((prev) => ({
        ...prev,
        [itemId]: {
          parLevel: field === "parLevel" ? num : (prev[itemId]?.parLevel ?? null),
          reorderLevel: field === "reorderLevel" ? num : (prev[itemId]?.reorderLevel ?? null),
        },
      }));
    },
    []
  );

  const saveRow = useCallback(
    async (item: InventoryItem) => {
      const row = dirty[item.id];
      if (!row) return;
      setSaving((prev) => ({ ...prev, [item.id]: true }));
      try {
        const payload: Record<string, number | null> = {};
        if (row.parLevel !== undefined) payload.parLevel = row.parLevel;
        if (row.reorderLevel !== undefined) payload.reorderLevel = row.reorderLevel;

        const res = await apiRequest("PATCH", `/api/inventory-items/${item.id}`, payload);
        if (!res.ok) throw new Error("Save failed");

        setDirty((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
      } catch {
        toast({ title: "Error", description: "Failed to save par level", variant: "destructive" });
      } finally {
        setSaving((prev) => ({ ...prev, [item.id]: false }));
      }
    },
    [dirty, toast]
  );

  const hasDirty = Object.keys(dirty).length > 0;

  const saveAll = useCallback(async () => {
    const dirtyIds = Object.keys(dirty);
    if (dirtyIds.length === 0) return;

    await Promise.all(
      dirtyIds.map(async (id) => {
        const item = items.find((i) => i.id === id);
        if (item) await saveRow(item);
      })
    );
    toast({ title: "Saved", description: "All par levels updated." });
  }, [dirty, items, saveRow, toast]);

  return (
    <div className={`p-4 sm:p-8 ${showBanner ? "pb-20" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Link href="/inventory-items">
          <Button variant="ghost" size="icon" data-testid="button-back-inventory">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Par Levels</h1>
          <p className="text-sm text-muted-foreground">
            Set target inventory levels for each item — used to generate your order list.
          </p>
        </div>
        {hasDirty && (
          <Button
            onClick={saveAll}
            data-testid="button-save-all-par"
            className="shrink-0"
          >
            <Save className="h-4 w-4 mr-1.5" />
            Save All ({Object.keys(dirty).length})
          </Button>
        )}
      </div>

      {/* Progress card */}
      <Card className="mb-6" data-testid="card-par-progress">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {itemsWithPar} of {activeItems.length} items have par levels set
              </span>
              {progressPercent > 50 && (
                <Badge variant="secondary" className="bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400" data-testid="badge-par-complete">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Milestone Complete
                </Badge>
              )}
            </div>
            <span className="text-sm text-muted-foreground font-mono">
              {Math.round(progressPercent)}%
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" data-testid="progress-par-levels" />
          {progressPercent < 50 && progressPercent > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Set par levels on more than 50% of items to complete this milestone.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-par-search"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-par-category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="hidden md:table-cell">Unit</TableHead>
              <TableHead>Par Level</TableHead>
              <TableHead>Reorder Level</TableHead>
              <TableHead className="w-[80px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <div className="h-4 bg-muted rounded animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {search || categoryFilter !== "all"
                    ? "No items match your filters."
                    : "No inventory items found. Add items first."}
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => {
                const isDirty = dirty[item.id] !== undefined;
                const isSaving = saving[item.id];
                const parVal = getVal(item, "parLevel");
                const reorderVal = getVal(item, "reorderLevel");
                const hasParSet = parVal !== "";

                return (
                  <TableRow
                    key={item.id}
                    className={isDirty ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}
                    data-testid={`row-par-${item.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isDirty && (
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 shrink-0" aria-label="Unsaved" />
                        )}
                        <span className="font-medium text-sm truncate max-w-[160px] sm:max-w-[220px]">
                          {item.name.charAt(0).toUpperCase() + item.name.slice(1)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {item.category ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {item.unit?.abbreviation ?? item.unit?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={parVal}
                        placeholder="—"
                        onChange={(e) => handleChange(item.id, "parLevel", e.target.value)}
                        onBlur={() => saveRow(item)}
                        disabled={isSaving}
                        className="w-20 h-8 text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        data-testid={`input-par-level-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={reorderVal}
                        placeholder="—"
                        onChange={(e) => handleChange(item.id, "reorderLevel", e.target.value)}
                        onBlur={() => saveRow(item)}
                        disabled={isSaving}
                        className="w-20 h-8 text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        data-testid={`input-reorder-level-${item.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      {hasParSet ? (
                        <Badge
                          variant="secondary"
                          className="bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400 text-xs"
                          data-testid={`badge-par-set-${item.id}`}
                        >
                          Set
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground text-xs"
                          data-testid={`badge-par-unset-${item.id}`}
                        >
                          Not set
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {showBanner && (
        <SetupProgressBanner
          currentMilestoneId="par_levels"
          hasEntries={progressPercent > 50}
        />
      )}
    </div>
  );
}
