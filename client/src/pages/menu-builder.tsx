/**
 * Menu Builder — /menus/:id
 *
 * Two-column layout:
 *   Left  — ordered sections sidebar (create / rename / delete / reorder)
 *   Right — entries for the selected section (add / remove / edit inline / reorder)
 *
 * The financial summary panel (collapsible) is shown above the entry list and
 * displays clearly-labeled item-level averages — NOT "projected menu food cost".
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  GripVertical,
  BookOpen,
  Archive,
  Copy,
  Star,
  StarOff,
  Search,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Tag,
  TrendingUp,
  Hash,
  ExternalLink,
  Clock,
  MapPin,
  BarChart3,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── API types ─────────────────────────────────────────────────────────────────

interface MenuSection {
  id: string;
  menuId: string;
  companyId: string;
  name: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface MenuEntry {
  id: string;
  menuId: string;
  menuSectionId: string | null;
  menuItemId: string;
  companyId: string;
  displayOrder: number;
  price: number | null;
  displayNameOverride: string | null;
  descriptionOverride: string | null;
  featured: number;
  active: number;
  forecastQty: number | null;
  forecastPct: number | null;
  createdAt: string;
  updatedAt: string;
}

interface MenuDetail {
  id: string;
  companyId: string;
  name: string;
  menuType: string | null;
  status: "draft" | "ready" | "scheduled" | "live" | "retired";
  description: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  recurrenceDays: string[] | null;
  recurrenceTimeStart: string | null;
  recurrenceTimeEnd: string | null;
  createdAt: string;
  updatedAt: string;
  sections: MenuSection[];
  entries: MenuEntry[];
}

interface CompanyStore {
  id: string;
  name: string;
  code: string | null;
  companyId: string;
}

interface MenuLocationAssignment {
  id: string;
  menuId: string;
  storeId: string;
  companyId: string;
  createdAt: string;
}

interface ReadinessIssue {
  type: "blocker" | "warning";
  code: string;
  entryId: string;
  menuItemId: string;
  itemName: string;
  message: string;
  navigationHref: string;
}

interface ReadinessReport {
  menuId: string;
  totalEntries: number;
  blockerCount: number;
  warningCount: number;
  canTransitionToReady: boolean;
  issues: ReadinessIssue[];
}

interface CanonicalMenuItem {
  id: string;
  name: string;
  pluSku: string;
  price: number | null;
  active: number;
  menuDepartmentId: string | null;
  parentMenuItemId: string | null;
  recipe?: {
    id: string;
    name: string;
    computedCost: number | null;
    isPlaceholder: number;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "live")       return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Live</Badge>;
  if (status === "ready")      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">Ready</Badge>;
  if (status === "scheduled")  return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 border-0">Scheduled</Badge>;
  if (status === "retired")    return <Badge variant="secondary">Retired</Badge>;
  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0">Draft</Badge>;
}

// ── Scheduling constants ───────────────────────────────────────────────────────

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBR: Record<string, string> = {
  Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th",
  Friday: "Fr", Saturday: "Sa", Sunday: "Su",
};

// ── Readiness panel ───────────────────────────────────────────────────────────

function ReadinessPanel({ report, onMarkReady, isTransitioning }: {
  report: ReadinessReport | undefined | null;
  onMarkReady: () => void;
  isTransitioning: boolean;
}) {
  const [open, setOpen] = useState(true);

  if (!report) return null;

  const blockers = report.issues.filter((i) => i.type === "blocker");
  const warnings = report.issues.filter((i) => i.type === "warning");
  const isClean  = report.blockerCount === 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors
          ${isClean
            ? "bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50 text-green-800 dark:text-green-300"
            : "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 text-red-800 dark:text-red-300"
          }`}>
          <div className="flex items-center gap-2">
            {isClean
              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              : <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            }
            <span>Readiness Check</span>
            {report.blockerCount > 0 && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0 text-xs font-normal ml-1">
                {report.blockerCount} blocker{report.blockerCount !== 1 ? "s" : ""}
              </Badge>
            )}
            {report.warningCount > 0 && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-xs font-normal">
                {report.warningCount} warning{report.warningCount !== 1 ? "s" : ""}
              </Badge>
            )}
            {isClean && report.warningCount === 0 && (
              <span className="text-xs font-normal ml-1 opacity-70">All checks passed</span>
            )}
          </div>
          {open ? <ChevronUp className="h-3.5 w-3.5 opacity-60" /> : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 rounded-md border overflow-hidden">
          {blockers.length === 0 && warnings.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              No issues — this menu is ready to be marked as Ready.
            </p>
          )}

          {blockers.length > 0 && (
            <div className="divide-y">
              {blockers.map((issue) => (
                <div key={`${issue.entryId}-${issue.code}`} className="flex items-start gap-2.5 px-3 py-2.5 bg-red-50/50 dark:bg-red-950/20">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{issue.itemName}</p>
                    <p className="text-xs text-muted-foreground">{issue.message}</p>
                  </div>
                  <a
                    href={issue.navigationHref}
                    className="shrink-0 text-xs text-primary flex items-center gap-0.5 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Fix <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="divide-y border-t">
              {warnings.map((issue) => (
                <div key={`${issue.entryId}-${issue.code}`} className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50/50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{issue.itemName}</p>
                    <p className="text-xs text-muted-foreground">{issue.message}</p>
                  </div>
                  <a
                    href={issue.navigationHref}
                    className="shrink-0 text-xs text-primary flex items-center gap-0.5 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Review <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function fmtPct(n: number) { return `${n.toFixed(1)}%`; }
function fmtPrice(n: number) { return `$${n.toFixed(2)}`; }

// ── Financial summary ─────────────────────────────────────────────────────────

function FinancialSummary({ entries, items }: { entries: MenuEntry[]; items: CanonicalMenuItem[] }) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    const total     = entries.length;
    const withPrice = entries.filter((e) => e.price != null && e.price > 0).length;
    const noPrice   = total - withPrice;

    const itemMap = new Map(items.map((i) => [i.id, i]));

    const withRecipe = entries.filter((e) => {
      const item = itemMap.get(e.menuItemId);
      return item?.recipe && !item.recipe.isPlaceholder && item.recipe.computedCost != null && item.recipe.computedCost > 0;
    }).length;
    const noRecipe = total - withRecipe;

    // Food-cost percentages for items where we have both entry price > 0 and recipe cost > 0
    const fcPcts: number[] = [];
    for (const entry of entries) {
      if (!entry.price || entry.price <= 0) continue;
      const item = itemMap.get(entry.menuItemId);
      if (!item?.recipe || item.recipe.isPlaceholder) continue;
      const cost = item.recipe.computedCost;
      if (cost == null || cost <= 0) continue;
      fcPcts.push((cost / entry.price) * 100);
    }

    const avgFc   = fcPcts.length > 0 ? fcPcts.reduce((a, b) => a + b, 0) / fcPcts.length : null;
    const sorted  = [...fcPcts].sort((a, b) => a - b);
    const midIdx  = Math.floor(sorted.length / 2);
    const medianFc = sorted.length > 0
      ? sorted.length % 2 === 0 ? (sorted[midIdx - 1] + sorted[midIdx]) / 2 : sorted[midIdx]
      : null;
    const highFcCount = fcPcts.filter((p) => p > 33).length; // above 33% threshold

    return { total, withPrice, noPrice, withRecipe, noRecipe, avgFc, medianFc, highFcCount, costedCount: fcPcts.length };
  }, [entries, items]);

  if (stats.total === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 hover:bg-muted text-sm font-medium transition-colors">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Financial Summary</span>
            {stats.avgFc != null && (
              <Badge variant="outline" className="text-xs font-normal ml-1">
                avg {fmtPct(stats.avgFc)} food cost
              </Badge>
            )}
          </div>
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3 rounded-md bg-muted/30 border">
          <StatCell icon={Hash} label="Total items" value={stats.total} />
          <StatCell icon={Tag} label="With selling price" value={`${stats.withPrice} / ${stats.total}`}
            warn={stats.noPrice > 0} warnText={`${stats.noPrice} missing`} />
          <StatCell icon={BookOpen} label="With linked recipe" value={`${stats.withRecipe} / ${stats.total}`}
            warn={stats.noRecipe > 0} warnText={`${stats.noRecipe} missing`} />
          {stats.costedCount > 0 && <>
            <StatCell icon={TrendingUp} label="Avg item food cost %" value={stats.avgFc != null ? fmtPct(stats.avgFc) : "—"} />
            <StatCell icon={TrendingUp} label="Median item food cost %" value={stats.medianFc != null ? fmtPct(stats.medianFc) : "—"} />
            <StatCell icon={AlertCircle} label="Items above 33% food cost" value={stats.highFcCount}
              warn={stats.highFcCount > 0} />
          </>}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 px-1">
          ℹ️ These are item-level averages based on entry prices and recipe costs. They are not a projected menu food cost.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatCell({ icon: Icon, label, value, warn, warnText }: { icon: React.ElementType; label: string; value: string | number; warn?: boolean; warnText?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className={`text-sm font-medium ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {value}
        {warn && warnText && <span className="text-xs font-normal ml-1 opacity-70">({warnText})</span>}
      </p>
    </div>
  );
}

// ── Schedule Panel ────────────────────────────────────────────────────────────

function SchedulePanel({ menu, onSaved }: {
  menu: MenuDetail;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [effectiveStart, setEffectiveStart] = useState(menu.effectiveStart?.slice(0, 10) ?? "");
  const [effectiveEnd, setEffectiveEnd] = useState(menu.effectiveEnd?.slice(0, 10) ?? "");
  const [recurrenceDays, setRecurrenceDays] = useState<string[]>(menu.recurrenceDays ?? []);
  const [timeStart, setTimeStart] = useState(menu.recurrenceTimeStart ?? "");
  const [timeEnd, setTimeEnd] = useState(menu.recurrenceTimeEnd ?? "");

  useEffect(() => {
    setEffectiveStart(menu.effectiveStart?.slice(0, 10) ?? "");
    setEffectiveEnd(menu.effectiveEnd?.slice(0, 10) ?? "");
    setRecurrenceDays(menu.recurrenceDays ?? []);
    setTimeStart(menu.recurrenceTimeStart ?? "");
    setTimeEnd(menu.recurrenceTimeEnd ?? "");
  }, [menu.effectiveStart, menu.effectiveEnd, menu.recurrenceDays, menu.recurrenceTimeStart, menu.recurrenceTimeEnd]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/menus/${menu.id}`, {
        effectiveStart: effectiveStart || null,
        effectiveEnd: effectiveEnd || null,
        recurrenceDays: recurrenceDays.length > 0 ? recurrenceDays : null,
        recurrenceTimeStart: timeStart || null,
        recurrenceTimeEnd: timeEnd || null,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${menu.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      onSaved();
      toast({ title: "Schedule saved" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to save schedule", variant: "destructive" }),
  });

  const toggleDay = (day: string) => {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const isDirty = (
    (effectiveStart || null) !== (menu.effectiveStart?.slice(0, 10) ?? null) ||
    (effectiveEnd || null) !== (menu.effectiveEnd?.slice(0, 10) ?? null) ||
    JSON.stringify([...recurrenceDays].sort()) !== JSON.stringify([...(menu.recurrenceDays ?? [])].sort()) ||
    (timeStart || null) !== (menu.recurrenceTimeStart ?? null) ||
    (timeEnd || null) !== (menu.recurrenceTimeEnd ?? null)
  );

  const hasSchedule = !!(menu.effectiveStart || (menu.recurrenceDays && menu.recurrenceDays.length > 0));
  const isReadOnly = menu.status === "live" || menu.status === "retired";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Schedule</CardTitle>
                {hasSchedule && <Badge variant="outline" className="text-xs">Set</Badge>}
              </div>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  Effective start
                  {menu.status === "ready" && <span className="text-muted-foreground ml-1">(required to schedule)</span>}
                </Label>
                <Input type="date" value={effectiveStart} onChange={(e) => setEffectiveStart(e.target.value)} disabled={isReadOnly} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Effective end <span className="text-muted-foreground">(optional)</span></Label>
                <Input type="date" value={effectiveEnd} onChange={(e) => setEffectiveEnd(e.target.value)} disabled={isReadOnly} className="text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Recurrence <span className="text-muted-foreground">(days this menu is served)</span></Label>
              <div className="flex flex-wrap gap-1">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => toggleDay(day)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                      ${recurrenceDays.includes(day)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/60"}
                      disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {DAY_ABBR[day]}
                  </button>
                ))}
              </div>
            </div>

            {recurrenceDays.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Service start time</Label>
                  <Input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} disabled={isReadOnly} className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Service end time</Label>
                  <Input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} disabled={isReadOnly} className="text-sm" />
                </div>
              </div>
            )}

            {!isReadOnly && (
              <div className="flex justify-end pt-1">
                <Button size="sm" disabled={!isDirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  {saveMutation.isPending ? "Saving…" : "Save Schedule"}
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Location Panel ────────────────────────────────────────────────────────────

function LocationPanel({ menuId }: { menuId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: assignments = [] } = useQuery<MenuLocationAssignment[]>({
    queryKey: [`/api/menus/${menuId}/locations`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/menus/${menuId}/locations`);
      return res.json();
    },
    enabled: !!menuId,
  });

  const { data: stores = [] } = useQuery<CompanyStore[]>({
    queryKey: ["/api/stores/accessible"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stores/accessible");
      return res.json();
    },
  });

  const assignedStoreIds = new Set(assignments.map((a) => a.storeId));
  const unassignedStores = stores.filter((s) => !assignedStoreIds.has(s.id));
  const assignedStores = stores.filter((s) => assignedStoreIds.has(s.id));

  const addMutation = useMutation({
    mutationFn: async (storeId: string) => {
      const res = await apiRequest("POST", `/api/menus/${menuId}/locations`, { storeId });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? "Failed to add"); }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${menuId}/locations`] }),
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (storeId: string) => {
      await apiRequest("DELETE", `/api/menus/${menuId}/locations/${storeId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${menuId}/locations`] }),
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Locations</CardTitle>
                {assignments.length > 0
                  ? <Badge variant="outline" className="text-xs">{assignments.length}</Badge>
                  : <span className="text-xs text-muted-foreground">All</span>}
              </div>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-2">
            {assignments.length === 0 && (
              <p className="text-xs text-muted-foreground py-1">No locations assigned — applies to all locations.</p>
            )}
            {assignedStores.map((store) => (
              <div key={store.id} className="flex items-center justify-between py-1 px-2 rounded-md bg-muted/50">
                <span className="text-sm">{store.name}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeMutation.mutate(store.id)} disabled={removeMutation.isPending}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {unassignedStores.length > 0 && (
              <Select onValueChange={(storeId) => addMutation.mutate(storeId)} disabled={addMutation.isPending}>
                <SelectTrigger className="text-sm h-8">
                  <SelectValue placeholder="Add a location…" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Forecast Panel ────────────────────────────────────────────────────────────

function ForecastPanel({ entries, allItems, menuId, onEntryUpdate }: {
  entries: MenuEntry[];
  allItems: CanonicalMenuItem[];
  menuId: string;
  onEntryUpdate: (entryId: string, updates: Partial<MenuEntry>) => void;
}) {
  const [open, setOpen] = useState(false);

  const { data: forecastReport } = useQuery<any>({
    queryKey: [`/api/menus/${menuId}/forecast`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/menus/${menuId}/forecast`);
      return res.json();
    },
    enabled: !!menuId && open,
    staleTime: 60_000,
  });

  const itemMap = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  const suggestionsMap = useMemo(() => {
    const m = new Map<string, number>();
    if (forecastReport?.entries) {
      for (const e of forecastReport.entries as any[]) {
        if (e.suggestedQty != null) m.set(e.entryId, e.suggestedQty as number);
      }
    }
    return m;
  }, [forecastReport]);

  const totals = useMemo(() => {
    let totalQty = 0, totalRevenue = 0, totalCost = 0;
    let hasAllRevenue = true, hasAllCost = true, entriesWithQty = 0;

    for (const e of entries) {
      const qty = e.forecastQty ?? 0;
      if (qty > 0) {
        totalQty += qty;
        entriesWithQty++;
        const item = itemMap.get(e.menuItemId);
        const price = e.price ?? item?.price ?? null;
        const cost = item?.recipe?.computedCost ?? null;
        if (price != null) totalRevenue += price * qty; else hasAllRevenue = false;
        if (cost != null) totalCost += cost * qty; else hasAllCost = false;
      }
    }

    const projRevenue   = hasAllRevenue && entriesWithQty > 0 ? totalRevenue : null;
    const projCost      = hasAllCost && entriesWithQty > 0 ? totalCost : null;
    const projFcPct     = projRevenue != null && projRevenue > 0 && projCost != null ? (projCost / projRevenue) * 100 : null;
    const projGM        = projRevenue != null && projCost != null ? projRevenue - projCost : null;

    return { totalQty, entriesWithQty, projRevenue, projCost, projFcPct, projGM };
  }, [entries, itemMap]);

  const anyForecast = entries.some((e) => (e.forecastQty ?? 0) > 0);

  const fmtMoney = (v: number | null) => v != null ? `$${v.toFixed(2)}` : "—";
  const fmtPct   = (v: number | null) => v != null ? `${v.toFixed(1)}%` : "—";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Forecast</CardTitle>
                {anyForecast && (
                  <Badge variant="outline" className="text-xs">{totals.entriesWithQty} item{totals.entriesWithQty !== 1 ? "s" : ""}</Badge>
                )}
              </div>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            <p className="text-xs text-muted-foreground">
              Enter expected covers per item to project revenue, food cost %, and gross margin.
            </p>

            {anyForecast && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg bg-muted/40">
                <div><p className="text-xs text-muted-foreground">Projected Revenue</p><p className="text-sm font-medium">{fmtMoney(totals.projRevenue)}</p></div>
                <div><p className="text-xs text-muted-foreground">Food Cost $</p><p className="text-sm font-medium">{fmtMoney(totals.projCost)}</p></div>
                <div><p className="text-xs text-muted-foreground">Food Cost %</p><p className="text-sm font-medium">{fmtPct(totals.projFcPct)}</p></div>
                <div><p className="text-xs text-muted-foreground">Gross Margin</p><p className="text-sm font-medium">{fmtMoney(totals.projGM)}</p></div>
              </div>
            )}

            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items on this menu yet.</p>
            ) : (
              <div className="space-y-0.5">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1 text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  <span>Item</span><span className="w-20 text-right">Price</span><span className="w-24 text-right">Forecast Qty</span>
                </div>
                {entries.map((entry) => {
                  const item = itemMap.get(entry.menuItemId);
                  const price = entry.price ?? item?.price ?? null;
                  const suggestedQty = suggestionsMap.get(entry.id);
                  return (
                    <div key={entry.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-2 py-0.5 rounded hover:bg-muted/30">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{item?.name ?? entry.menuItemId}</p>
                        {suggestedQty != null && (
                          <button
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            onClick={() => onEntryUpdate(entry.id, { forecastQty: suggestedQty })}
                          >
                            POS avg: {suggestedQty}/day — apply
                          </button>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground w-20 text-right">
                        {price != null ? `$${price.toFixed(2)}` : "—"}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={entry.forecastQty ?? ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          onEntryUpdate(entry.id, { forecastQty: v });
                        }}
                        className="h-7 w-24 text-sm text-right"
                        placeholder="0"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Sortable section row ──────────────────────────────────────────────────────

function SortableSectionRow({
  section,
  entryCount,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  section: MenuSection;
  entryCount: number;
  active: boolean;
  onSelect: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(section.name);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const commit = () => {
    const t = editVal.trim();
    if (t && t !== section.name) onRename(section.id, t);
    else setEditVal(section.name);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer group transition-colors
        ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
      onClick={onSelect}
      data-testid={`section-row-${section.id}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        onClick={(e) => e.stopPropagation()}
        data-testid={`drag-section-${section.id}`}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {editing ? (
        <Input
          autoFocus
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setEditVal(section.name); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-6 text-xs flex-1 min-w-0"
        />
      ) : (
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{section.name}</span>
      )}

      <span className="text-xs text-muted-foreground shrink-0">{entryCount}</span>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={commit}><Check className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditVal(section.name); setEditing(false); }}><X className="h-3 w-3" /></Button>
          </>
        ) : (
          <>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => onDelete(section.id)}><Trash2 className="h-3 w-3" /></Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sortable entry row ────────────────────────────────────────────────────────

function SortableEntryRow({
  entry,
  item,
  onRemove,
  onUpdate,
  sections,
}: {
  entry: MenuEntry;
  item: CanonicalMenuItem | undefined;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<MenuEntry>) => void;
  sections: MenuSection[];
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceVal, setPriceVal]   = useState(entry.price != null ? String(entry.price) : "");
  const [editingName, setEditingName]   = useState(false);
  const [nameVal, setNameVal]     = useState(entry.displayNameOverride ?? "");
  const [editingDesc, setEditingDesc]   = useState(false);
  const [descVal, setDescVal]     = useState(entry.descriptionOverride ?? "");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const commitPrice = () => {
    const parsed = parseFloat(priceVal);
    onUpdate(entry.id, { price: isNaN(parsed) ? null : parsed });
    setEditingPrice(false);
  };

  const commitName = () => {
    onUpdate(entry.id, { displayNameOverride: nameVal.trim() || null });
    setEditingName(false);
  };

  const commitDesc = () => {
    onUpdate(entry.id, { descriptionOverride: descVal.trim() || null });
    setEditingDesc(false);
  };

  const displayName = entry.displayNameOverride || item?.name || "Unknown item";
  const fcPct = entry.price && entry.price > 0 && item?.recipe?.computedCost && item.recipe.computedCost > 0
    ? (item.recipe.computedCost / entry.price) * 100
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 px-3 py-2.5 border-b last:border-0 group hover:bg-muted/30 transition-colors"
      data-testid={`entry-row-${entry.id}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground pt-0.5 shrink-0"
        data-testid={`drag-entry-${entry.id}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Name + overrides */}
      <div className="flex-1 min-w-0 space-y-0.5">
        {editingName ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameVal(entry.displayNameOverride ?? ""); setEditingName(false); }}}
              className="h-7 text-sm"
              placeholder={item?.name}
            />
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={commitName}><Check className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setNameVal(entry.displayNameOverride ?? ""); setEditingName(false); }}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium">{displayName}</span>
            {entry.displayNameOverride && (
              <Badge variant="outline" className="text-xs font-normal">name override</Badge>
            )}
            {entry.featured === 1 && (
              <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">Featured</Badge>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={() => setEditingName(true)}
              title="Edit display name override"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}

        {item?.name && entry.displayNameOverride && (
          <p className="text-xs text-muted-foreground">Original: {item.name}</p>
        )}

        {/* Description override */}
        {editingDesc ? (
          <div className="flex items-start gap-1 mt-1">
            <Textarea
              autoFocus
              value={descVal}
              onChange={(e) => setDescVal(e.target.value)}
              rows={2}
              className="text-xs"
              placeholder="Menu description override…"
            />
            <div className="flex flex-col gap-0.5 pt-0.5">
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={commitDesc}><Check className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setDescVal(entry.descriptionOverride ?? ""); setEditingDesc(false); }}><X className="h-3 w-3" /></Button>
            </div>
          </div>
        ) : (
          entry.descriptionOverride ? (
            <p className="text-xs text-muted-foreground italic cursor-pointer hover:text-foreground" onClick={() => setEditingDesc(true)}>
              {entry.descriptionOverride}
            </p>
          ) : (
            <button
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditingDesc(true)}
            >
              + Add description override
            </button>
          )
        )}
      </div>

      {/* Price + food cost */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {editingPrice ? (
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              autoFocus
              type="number"
              step="0.01"
              min="0"
              value={priceVal}
              onChange={(e) => setPriceVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitPrice(); if (e.key === "Escape") { setPriceVal(entry.price != null ? String(entry.price) : ""); setEditingPrice(false); }}}
              onBlur={commitPrice}
              className="h-7 w-24 text-sm text-right"
              data-testid={`price-input-${entry.id}`}
            />
          </div>
        ) : (
          <button
            className="text-sm font-medium hover:underline focus:underline"
            onClick={() => setEditingPrice(true)}
            data-testid={`price-display-${entry.id}`}
            title="Click to edit entry price"
          >
            {entry.price != null ? fmtPrice(entry.price) : <span className="text-muted-foreground text-xs">Set price</span>}
          </button>
        )}
        {fcPct != null && (
          <Badge
            variant="outline"
            className={`text-xs ${fcPct > 33 ? "border-amber-400 text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            {fmtPct(fcPct)} food cost
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 pt-0.5 opacity-0 group-hover:opacity-100 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => onUpdate(entry.id, { featured: entry.featured === 1 ? 0 : 1 })}
              data-testid={`toggle-featured-${entry.id}`}
            >
              {entry.featured === 1 ? <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" /> : <StarOff className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{entry.featured === 1 ? "Unmark as featured" : "Mark as featured"}</TooltipContent>
        </Tooltip>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive"
          onClick={() => onRemove(entry.id)}
          data-testid={`remove-entry-${entry.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Add item dialog ───────────────────────────────────────────────────────────

function AddItemDialog({
  open,
  onOpenChange,
  menuId,
  existingMenuItemIds,
  selectedSectionId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  menuId: string;
  existingMenuItemIds: Set<string>;
  selectedSectionId: string | null;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPlu, setNewItemPlu] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  const { data: allItems = [] } = useQuery<CanonicalMenuItem[]>({
    queryKey: ["/api/menu-items"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/menu-items");
      return res.json();
    },
    enabled: open,
  });

  // Filtered: active, top-level (no parent), not already on this menu
  const available = useMemo(() => {
    const lower = search.toLowerCase();
    return allItems.filter(
      (i) => i.active === 1 && !i.parentMenuItemId && !existingMenuItemIds.has(i.id) &&
        (!lower || i.name.toLowerCase().includes(lower) || i.pluSku.toLowerCase().includes(lower)),
    );
  }, [allItems, existingMenuItemIds, search]);

  const addMutation = useMutation({
    mutationFn: async (menuItemId: string) => {
      const res = await apiRequest("POST", `/api/menus/${menuId}/entries`, {
        menuItemId,
        menuSectionId: selectedSectionId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${menuId}`] });
      onAdded();
    },
    onError: (err: any) => toast({ title: err.message || "Failed to add item", variant: "destructive" }),
  });

  const createAndAddMutation = useMutation({
    mutationFn: async () => {
      // 1. Create canonical item
      const createRes = await apiRequest("POST", "/api/menu-items", {
        name: newItemName.trim(),
        pluSku: newItemPlu.trim() || `NEW-${Date.now()}`,
        price: newItemPrice ? parseFloat(newItemPrice) : null,
        isRecipeItem: 1,
        active: 1,
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error((body as any).error || "Failed to create item");
      }
      const item: CanonicalMenuItem = await createRes.json();

      // 2. Add to menu as entry
      const addRes = await apiRequest("POST", `/api/menus/${menuId}/entries`, {
        menuItemId: item.id,
        menuSectionId: selectedSectionId,
        price: newItemPrice ? parseFloat(newItemPrice) : null,
      });
      return addRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${menuId}`] });
      toast({ title: `"${newItemName.trim()}" created and added to the menu` });
      setCreateMode(false);
      setNewItemName(""); setNewItemPlu(""); setNewItemPrice("");
      onAdded();
    },
    onError: (err: any) => toast({ title: err.message || "Failed to create item", variant: "destructive" }),
  });

  const close = () => {
    onOpenChange(false);
    setTimeout(() => { setSearch(""); setCreateMode(false); setNewItemName(""); setNewItemPlu(""); setNewItemPrice(""); }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{createMode ? "Create New Item" : "Add Item to Menu"}</DialogTitle>
          <DialogDescription>
            {createMode
              ? "A new canonical item will be created in your Item Library and placed on this menu."
              : "Search for an item from your Item Library and add it to this menu with a menu-specific price."}
          </DialogDescription>
        </DialogHeader>

        {!createMode ? (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-add-item-search"
              />
            </div>

            <div className="flex-1 overflow-y-auto -mx-6 px-6 min-h-0 max-h-72 space-y-0.5">
              {available.length === 0 && search && (
                <p className="text-sm text-muted-foreground py-4 text-center">No matching items</p>
              )}
              {available.length === 0 && !search && (
                <p className="text-sm text-muted-foreground py-4 text-center">All active items are already on this menu</p>
              )}
              {available.map((item) => (
                <button
                  key={item.id}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-left transition-colors"
                  onClick={() => { addMutation.mutate(item.id); close(); }}
                  disabled={addMutation.isPending}
                  data-testid={`add-item-${item.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.pluSku}</p>
                  </div>
                  {item.price != null && (
                    <span className="text-sm text-muted-foreground shrink-0">{fmtPrice(item.price)}</span>
                  )}
                </button>
              ))}
            </div>

            <Separator />
            <div className="flex justify-between items-center pt-1">
              <p className="text-xs text-muted-foreground">Don't see it?</p>
              <Button variant="outline" size="sm" onClick={() => setCreateMode(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create new item
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3 flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              <Label>Item name <span className="text-destructive">*</span></Label>
              <Input
                autoFocus
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g. Caesar Salad"
                data-testid="input-new-item-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>PLU / SKU <span className="text-muted-foreground text-xs">(auto-generated if blank)</span></Label>
                <Input
                  value={newItemPlu}
                  onChange={(e) => setNewItemPlu(e.target.value)}
                  placeholder="e.g. 1001"
                  data-testid="input-new-item-plu"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Selling price <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-6"
                    data-testid="input-new-item-price"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This item will be saved to your Item Library (Menu Items) and can be linked to a recipe later.
            </p>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => createMode ? setCreateMode(false) : close()}>
            {createMode ? "Back" : "Cancel"}
          </Button>
          {createMode && (
            <Button
              disabled={!newItemName.trim() || createAndAddMutation.isPending}
              onClick={() => createAndAddMutation.mutate()}
              data-testid="button-create-and-add-item"
            >
              {createAndAddMutation.isPending ? "Creating…" : "Create & Add to Menu"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MenuBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Selected section: null = show all items
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Data ──

  const {
    data: menu,
    isLoading,
    refetch: refetchMenu,
  } = useQuery<MenuDetail>({
    queryKey: [`/api/menus/${id}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/menus/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: allCanonicalItems = [] } = useQuery<CanonicalMenuItem[]>({
    queryKey: ["/api/menu-items"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/menu-items");
      return res.json();
    },
  });

  const { data: readinessReport, refetch: refetchReadiness } = useQuery<ReadinessReport>({
    queryKey: [`/api/menus/${id}/readiness`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/menus/${id}/readiness`);
      return res.json();
    },
    enabled: !!id && (menu?.status === "draft" || menu?.status === "ready" || menu?.status === "scheduled"),
    staleTime: 0,
  });

  // Local section order for optimistic DnD.
  // Always re-sync from the server after any refetch so renames, creates, and
  // deletes are never masked by stale shadow state.
  const [localSections, setLocalSections] = useState<MenuSection[] | null>(null);
  useEffect(() => {
    setLocalSections(null); // let authoritative server data take over after refetch
  }, [menu?.sections]);
  const sections = localSections ?? menu?.sections ?? [];
  const entries  = menu?.entries ?? [];

  const itemMap = useMemo(() =>
    new Map(allCanonicalItems.map((i) => [i.id, i])),
    [allCanonicalItems],
  );

  const existingMenuItemIds = useMemo(() => new Set(entries.map((e) => e.menuItemId)), [entries]);

  const filteredEntries = useMemo(() => {
    if (selectedSectionId === null) return entries;
    if (selectedSectionId === "unsectioned") return entries.filter((e) => !e.menuSectionId);
    return entries.filter((e) => e.menuSectionId === selectedSectionId);
  }, [entries, selectedSectionId]);

  // ── Mutations ──

  const transitionMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("POST", `/api/menus/${id}/status`, { status });
      if (res.status === 422) {
        const body = await res.json();
        throw Object.assign(new Error(body.error ?? "Blockers must be resolved first"), { report: body.report, status: 422 });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Status change failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      refetchReadiness();
    },
    onError: (err: any) => {
      if (err.status === 422) {
        // Refresh the readiness panel so the user sees current blockers
        refetchReadiness();
        toast({
          title: `${err.message}`,
          description: err.report?.blockerCount
            ? `${err.report.blockerCount} blocker${err.report.blockerCount !== 1 ? "s" : ""} found — see the Readiness Check panel below.`
            : undefined,
          variant: "destructive",
        });
      } else {
        toast({ title: err.message || "Status change failed", variant: "destructive" });
      }
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/menus/${id}/duplicate`, { name: `${menu?.name} (copy)` });
      return res.json();
    },
    onSuccess: (copy: MenuDetail) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${copy.name}" created as a draft copy` });
      setLocation(`/menus/${copy.id}`);
    },
    onError: (err: any) => toast({ title: err.message || "Duplicate failed", variant: "destructive" }),
  });

  const createSectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/menus/${id}/sections`, {
        name,
        displayOrder: sections.length,
      });
      return res.json();
    },
    onSuccess: (newSec: MenuSection) => {
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] });
      setSelectedSectionId(newSec.id);
    },
    onError: (err: any) => toast({ title: err.message || "Failed to create section", variant: "destructive" }),
  });

  const renameSectionMutation = useMutation({
    mutationFn: async ({ sectionId, name }: { sectionId: string; name: string }) => {
      const res = await apiRequest("PUT", `/api/menus/${id}/sections/${sectionId}`, { name });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] }),
    onError: (err: any) => toast({ title: err.message || "Failed to rename", variant: "destructive" }),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (sectionId: string) => {
      await apiRequest("DELETE", `/api/menus/${id}/sections/${sectionId}`);
    },
    onSuccess: (_d, sectionId) => {
      queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] });
      if (selectedSectionId === sectionId) setSelectedSectionId(null);
    },
    onError: (err: any) => toast({ title: err.message || "Failed to delete section", variant: "destructive" }),
  });

  const reorderSectionsMutation = useMutation({
    mutationFn: async (orders: { id: string; displayOrder: number }[]) => {
      await apiRequest("POST", `/api/menus/${id}/sections/reorder`, { orders });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] }),
  });

  const removeEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      await apiRequest("DELETE", `/api/menus/${id}/entries/${entryId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] }),
    onError: (err: any) => toast({ title: err.message || "Failed to remove item", variant: "destructive" }),
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ entryId, updates }: { entryId: string; updates: Partial<MenuEntry> }) => {
      const res = await apiRequest("PUT", `/api/menus/${id}/entries/${entryId}`, updates);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] }),
    onError: (err: any) => toast({ title: err.message || "Failed to update entry", variant: "destructive" }),
  });

  const reorderEntriesMutation = useMutation({
    mutationFn: async (orders: { id: string; displayOrder: number }[]) => {
      await apiRequest("POST", `/api/menus/${id}/entries/reorder`, { orders });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/menus/${id}`] }),
  });

  // ── New section inline state ──

  const [newSectionName, setNewSectionName] = useState("");
  const [addingSectionMode, setAddingSectionMode] = useState(false);

  const commitNewSection = () => {
    const name = newSectionName.trim();
    if (name) {
      createSectionMutation.mutate(name);
      setNewSectionName("");
      setAddingSectionMode(false);
    }
  };

  // ── DnD handlers ──

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = sections.findIndex((s) => s.id === active.id);
    const newIdx = sections.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove(sections, oldIdx, newIdx).map((s, i) => ({ ...s, displayOrder: i }));
    setLocalSections(reordered);
    reorderSectionsMutation.mutate(reordered.map((s) => ({ id: s.id, displayOrder: s.displayOrder })));
  };

  const handleEntryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentEntries = filteredEntries;
    const oldIdx = currentEntries.findIndex((e) => e.id === active.id);
    const newIdx = currentEntries.findIndex((e) => e.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove(currentEntries, oldIdx, newIdx).map((e, i) => ({ id: e.id, displayOrder: i }));
    reorderEntriesMutation.mutate(reordered);
  };

  // ── Loading / not found ──

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">Loading menu…</div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Menu not found</p>
        <Button variant="outline" size="sm" asChild><Link href="/menus">Back to Menus</Link></Button>
      </div>
    );
  }

  const entryCountBySectionId = new Map<string, number>();
  for (const entry of entries) {
    if (entry.menuSectionId) {
      entryCountBySectionId.set(entry.menuSectionId, (entryCountBySectionId.get(entry.menuSectionId) ?? 0) + 1);
    }
  }
  const unsectionedCount = entries.filter((e) => !e.menuSectionId).length;

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b flex-wrap">
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link href="/menus">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Menus
          </Link>
        </Button>

        <Separator orientation="vertical" className="h-5 hidden sm:block" />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{menu.name}</h1>
          <StatusBadge status={menu.status} />
          {menu.menuType && (
            <Badge variant="outline" className="text-xs capitalize hidden sm:flex">{menu.menuType}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {menu.status === "draft" && (
            <Button
              size="sm"
              onClick={() => transitionMutation.mutate("ready")}
              disabled={transitionMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Mark as Ready
            </Button>
          )}
          {menu.status === "ready" && (
            <>
              {menu.effectiveStart && (
                <Button
                  size="sm"
                  onClick={() => transitionMutation.mutate("scheduled")}
                  disabled={transitionMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                  Schedule
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => transitionMutation.mutate("live")}
                disabled={transitionMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                Publish
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => transitionMutation.mutate("draft")}
                disabled={transitionMutation.isPending}
              >
                Revert to Draft
              </Button>
            </>
          )}
          {menu.status === "scheduled" && (
            <>
              <Button
                size="sm"
                onClick={() => transitionMutation.mutate("live")}
                disabled={transitionMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                Publish Now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => transitionMutation.mutate("ready")}
                disabled={transitionMutation.isPending}
              >
                Unschedule
              </Button>
            </>
          )}
          {menu.status === "live" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transitionMutation.mutate("retired")}
              disabled={transitionMutation.isPending}
              className="text-orange-600"
            >
              <Archive className="h-3.5 w-3.5 mr-1.5" />
              Retire
            </Button>
          )}
          {menu.status === "retired" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transitionMutation.mutate("draft")}
              disabled={transitionMutation.isPending}
            >
              Reopen as Draft
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Duplicate
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Sections sidebar */}
        <aside className="w-52 shrink-0 border-r flex flex-col overflow-hidden">
          <div className="px-2 py-2 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Sections</p>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {/* All items */}
            <button
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors
                ${selectedSectionId === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
              onClick={() => setSelectedSectionId(null)}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">All items</span>
              <span className="text-xs">{entries.length}</span>
            </button>

            {unsectionedCount > 0 && sections.length > 0 && (
              <button
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors
                  ${selectedSectionId === "unsectioned" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
                onClick={() => setSelectedSectionId("unsectioned" as any)}
              >
                <span className="flex-1 text-left text-xs italic">Unsectioned</span>
                <span className="text-xs">{unsectionedCount}</span>
              </button>
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSectionDragEnd}
            >
              <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {sections.map((section) => (
                  <SortableSectionRow
                    key={section.id}
                    section={section}
                    entryCount={entryCountBySectionId.get(section.id) ?? 0}
                    active={selectedSectionId === section.id}
                    onSelect={() => setSelectedSectionId(section.id)}
                    onRename={(sid, name) => renameSectionMutation.mutate({ sectionId: sid, name })}
                    onDelete={(sid) => {
                      if (window.confirm(`Delete section "${section.name}"? Items will become unsectioned.`)) {
                        deleteSectionMutation.mutate(sid);
                      }
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Add section */}
          <div className="border-t p-2">
            {addingSectionMode ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewSection();
                    if (e.key === "Escape") { setNewSectionName(""); setAddingSectionMode(false); }
                  }}
                  placeholder="Section name…"
                  className="h-7 text-xs flex-1"
                  data-testid="input-new-section-name"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitNewSection}><Check className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setNewSectionName(""); setAddingSectionMode(false); }}><X className="h-3.5 w-3.5" /></Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs h-7"
                onClick={() => setAddingSectionMode(true)}
                data-testid="button-add-section"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add section
              </Button>
            )}
          </div>
        </aside>

        {/* Right: Entry list */}
        <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
          <div className="p-4 space-y-3">
            {/* Readiness check — shown for draft, ready, and scheduled menus */}
            {(menu.status === "draft" || menu.status === "ready" || menu.status === "scheduled") && (
              <ReadinessPanel
                report={readinessReport}
                onMarkReady={() => transitionMutation.mutate("ready")}
                isTransitioning={transitionMutation.isPending}
              />
            )}

            {/* Schedule panel — shown for draft, ready, and scheduled */}
            {(menu.status === "draft" || menu.status === "ready" || menu.status === "scheduled") && (
              <SchedulePanel menu={menu} onSaved={refetchMenu} />
            )}

            {/* Location assignments */}
            <LocationPanel menuId={id!} />

            {/* Financial summary */}
            <FinancialSummary entries={entries} items={allCanonicalItems} />

            {/* Forecast panel */}
            <ForecastPanel
              entries={entries}
              allItems={allCanonicalItems}
              menuId={id!}
              onEntryUpdate={(entryId, updates) => updateEntryMutation.mutate({ entryId, updates })}
            />

            {/* Entry list header */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedSectionId === null
                  ? `All items (${entries.length})`
                  : selectedSectionId === "unsectioned"
                  ? `Unsectioned items (${unsectionedCount})`
                  : `${sections.find((s) => s.id === selectedSectionId)?.name ?? ""} (${filteredEntries.length})`}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddItemOpen(true)}
                data-testid="button-add-item"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add item
              </Button>
            </div>

            {/* Entries */}
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg">
                <div className="p-3 rounded-full bg-muted mb-3">
                  <Utensils className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">No items yet</p>
                <p className="text-xs text-muted-foreground mb-4 max-w-xs">
                  Add items from your library or create new ones inline.
                </p>
                <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add item
                </Button>
              </div>
            ) : (
              <Card className="p-0 overflow-hidden">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleEntryDragEnd}
                >
                  <SortableContext
                    items={filteredEntries.map((e) => e.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredEntries.map((entry) => (
                      <SortableEntryRow
                        key={entry.id}
                        entry={entry}
                        item={itemMap.get(entry.menuItemId)}
                        sections={sections}
                        onRemove={(entryId) => removeEntryMutation.mutate(entryId)}
                        onUpdate={(entryId, updates) => updateEntryMutation.mutate({ entryId, updates })}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </Card>
            )}
          </div>
        </main>
      </div>

      {/* Add item dialog */}
      <AddItemDialog
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        menuId={id!}
        existingMenuItemIds={existingMenuItemIds}
        selectedSectionId={selectedSectionId === "unsectioned" ? null : selectedSectionId}
        onAdded={() => setAddItemOpen(false)}
      />
    </div>
  );
}

// Missing Utensils import shim — re-export from lucide
function Utensils({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  );
}
