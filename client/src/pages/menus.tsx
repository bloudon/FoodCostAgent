import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { track, usePageEvent } from "@/lib/analytics";
import {
  Plus,
  MoreVertical,
  Utensils,
  Copy,
  Archive,
  Trash2,
  ChevronRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPin,
  X,
  Search,
  ExternalLink,
  AlertTriangle,
  ChevronDown,
  ShoppingBag,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type EffectiveStatus = "live" | "scheduled" | "draft" | "ready" | "expired" | "archived";

interface MenuWithStats {
  id: string;
  companyId: string;
  name: string;
  menuType: string | null;
  status: "draft" | "ready" | "scheduled" | "live" | "retired";
  effectiveStatus: EffectiveStatus;
  description: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  recurrenceDays: number[] | null;
  recurrenceTimeStart: string | null;
  recurrenceTimeEnd: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  // Stats
  itemCount: number;
  totalItems: number;     // backward-compat alias for itemCount
  pricedItems: number;
  recipedItems: number;
  sectionCount: number;
  totalSectionCount: number;
  locationCount: number;
  locationNames: string[];
}

const MENU_TYPES = [
  { value: "dinner",    label: "Dinner" },
  { value: "lunch",     label: "Lunch" },
  { value: "brunch",    label: "Brunch" },
  { value: "breakfast", label: "Breakfast" },
  { value: "catering",  label: "Catering" },
  { value: "event",     label: "Event" },
  { value: "other",     label: "Other" },
];

const STATUS_FILTER_OPTIONS: { value: EffectiveStatus; label: string }[] = [
  { value: "live",      label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "ready",     label: "Ready" },
  { value: "draft",     label: "Draft" },
  { value: "expired",   label: "Expired" },
  { value: "archived",  label: "Archived" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function needsAttention(m: MenuWithStats): boolean {
  // NOTE: locationCount === 0 means "applies to all locations" — this is valid, not a warning.
  if (m.itemCount === 0) return true;
  if (m.sectionCount === 0) return true; // no non-empty sections
  if (m.effectiveStatus === "live") {
    if (m.pricedItems < m.itemCount) return true;
    if (m.recipedItems < m.itemCount) return true;
  }
  if (m.effectiveStatus === "scheduled") {
    if (m.itemCount === 0 || m.sectionCount === 0) return true;
  }
  return false;
}

function formatSchedule(m: MenuWithStats): string {
  if (m.recurrenceTimeStart && m.recurrenceTimeEnd) {
    const days = m.recurrenceDays?.length ? `${m.recurrenceDays.length}d/wk · ` : "";
    return `${days}${m.recurrenceTimeStart}–${m.recurrenceTimeEnd}`;
  }
  if (m.effectiveStart) {
    const start = format(new Date(m.effectiveStart), "MMM d");
    const end = m.effectiveEnd ? format(new Date(m.effectiveEnd), "MMM d") : null;
    return end ? `${start} – ${end}` : `From ${start}`;
  }
  return "Always available";
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EffectiveStatus }) {
  switch (status) {
    case "live":      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Live</Badge>;
    case "scheduled": return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 border-0">Scheduled</Badge>;
    case "ready":     return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">Ready</Badge>;
    case "expired":   return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0">Expired</Badge>;
    case "archived":  return <Badge variant="secondary">Archived</Badge>;
    default:          return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0">Draft</Badge>;
  }
}

// ── Summary bar ───────────────────────────────────────────────────────────────

interface SummaryBarProps {
  menus: MenuWithStats[];
  statusFilter: EffectiveStatus | "all";
  attentionFilter: boolean;
  onLiveClick: () => void;
  onScheduledClick: () => void;
  onAttentionClick: () => void;
}

function SummaryBar({
  menus,
  statusFilter,
  attentionFilter,
  onLiveClick,
  onScheduledClick,
  onAttentionClick,
}: SummaryBarProps) {
  const live      = menus.filter((m) => m.effectiveStatus === "live").length;
  const scheduled = menus.filter((m) => m.effectiveStatus === "scheduled").length;
  const attention = menus.filter(needsAttention).length;
  const liveItems = menus
    .filter((m) => m.effectiveStatus === "live")
    .reduce((sum, m) => sum + m.itemCount, 0);

  const liveActive      = statusFilter === "live";
  const scheduledActive = statusFilter === "scheduled";
  const attentionActive = attentionFilter;

  function tileClass(active: boolean, interactive: boolean) {
    const base = "rounded-lg border px-4 py-3 text-left transition-colors";
    if (!interactive) return `${base} bg-card cursor-default`;
    if (active)
      return `${base} bg-primary text-primary-foreground border-primary cursor-pointer ring-2 ring-primary/40`;
    return `${base} bg-card hover:bg-accent hover:border-accent-foreground/20 cursor-pointer`;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Live menus — clickable */}
      <button
        type="button"
        className={tileClass(liveActive, true)}
        onClick={onLiveClick}
        data-testid="summary-tile-live"
        aria-pressed={liveActive}
      >
        <p className={`text-2xl font-semibold tabular-nums ${liveActive ? "" : live > 0 ? "text-green-600 dark:text-green-400" : ""}`}>
          {live}
        </p>
        <p className={`text-xs mt-0.5 ${liveActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          Live menus
        </p>
      </button>

      {/* Scheduled — clickable */}
      <button
        type="button"
        className={tileClass(scheduledActive, true)}
        onClick={onScheduledClick}
        data-testid="summary-tile-scheduled"
        aria-pressed={scheduledActive}
      >
        <p className="text-2xl font-semibold tabular-nums">{scheduled}</p>
        <p className={`text-xs mt-0.5 ${scheduledActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          Scheduled
        </p>
      </button>

      {/* Needs attention — clickable */}
      <button
        type="button"
        className={tileClass(attentionActive, true)}
        onClick={onAttentionClick}
        data-testid="summary-tile-attention"
        aria-pressed={attentionActive}
      >
        <p className={`text-2xl font-semibold tabular-nums ${attentionActive ? "" : attention > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
          {attention}
        </p>
        <p className={`text-xs mt-0.5 ${attentionActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          Needs attention
        </p>
      </button>

      {/* Live menu items — non-interactive aggregate */}
      <div
        className={tileClass(false, false)}
        data-testid="summary-tile-live-items"
      >
        <p className="text-2xl font-semibold tabular-nums">{liveItems}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Live menu items</p>
      </div>
    </div>
  );
}

// ── New Menu dialog ───────────────────────────────────────────────────────────

interface NewMenuDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}
function NewMenuDialog({ open, onOpenChange }: NewMenuDialogProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [menuType, setMenuType] = useState<string>("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/menus", {
        name: name.trim(),
        menuType: menuType || null,
        description: description.trim() || null,
      });
      return res.json();
    },
    onSuccess: (menu: MenuWithStats) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${menu.name}" created` });
      onOpenChange(false);
      setName(""); setMenuType(""); setDescription("");
      setLocation(`/menus/${menu.id}`);
    },
    onError: (err: any) => toast({ title: err.message || "Failed to create menu", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Menu</DialogTitle>
          <DialogDescription>
            Create a named container for your menu items. The menu starts as a Draft so you can build it before publishing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="menu-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="menu-name"
              placeholder="e.g. Dinner Menu, Holiday 2026…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) createMutation.mutate(); }}
              data-testid="input-menu-name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="menu-type">Type <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={menuType} onValueChange={setMenuType}>
              <SelectTrigger id="menu-type" data-testid="select-menu-type">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {MENU_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="menu-description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              id="menu-description"
              placeholder="Internal notes about this menu…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="button-create-menu-confirm"
          >
            {createMutation.isPending ? "Creating…" : "Create Menu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Duplicate dialog ──────────────────────────────────────────────────────────

function DuplicateDialog({ menu, open, onOpenChange }: { menu: MenuWithStats; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [name, setName] = useState(`${menu.name} (copy)`);

  const dupeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/menus/${menu.id}/duplicate`, { name });
      return res.json();
    },
    onSuccess: (newMenu: MenuWithStats) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${newMenu.name}" created as a draft copy` });
      onOpenChange(false);
      setLocation(`/menus/${newMenu.id}`);
    },
    onError: (err: any) => toast({ title: err.message || "Failed to duplicate", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Duplicate Menu</DialogTitle>
          <DialogDescription>
            Creates a new Draft copy with all sections, items, and menu-specific prices copied. Underlying recipes and canonical items are shared, not duplicated.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-1.5">
          <Label>New menu name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) dupeMutation.mutate(); }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || dupeMutation.isPending} onClick={() => dupeMutation.mutate()}>
            {dupeMutation.isPending ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Menu card ─────────────────────────────────────────────────────────────────

function MenuCard({ menu }: { menu: MenuWithStats }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [dupeOpen, setDupeOpen] = useState(false);

  const transitionMutation = useMutation<MenuWithStats, Error, string>({
    mutationFn: async (status: string) => {
      const res = await apiRequest("POST", `/api/menus/${menu.id}/status`, { status });
      return res.json();
    },
    onSuccess: (updated: MenuWithStats) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${updated.name}" is now ${updated.status}` });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/menus/${menu.id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${menu.name}" deleted` });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to delete", variant: "destructive" }),
  });

  const isLive      = menu.effectiveStatus === "live";
  const isArchived  = menu.effectiveStatus === "archived" || menu.effectiveStatus === "expired";
  const isEmpty     = menu.itemCount === 0;
  const unpricedCt  = menu.itemCount - menu.pricedItems;
  const unrecipedCt = menu.itemCount - menu.recipedItems;
  const emptySections = menu.totalSectionCount - menu.sectionCount;
  const scheduleStr = formatSchedule(menu);

  // Warnings — only for operationally relevant issues
  // NOTE: locationCount === 0 means "All locations" — not a warning.
  const warnings: string[] = [];
  if (!isEmpty && emptySections > 0) warnings.push(`${emptySections} empty section${emptySections !== 1 ? "s" : ""}`);
  if (isLive && unpricedCt > 0) warnings.push(`${unpricedCt} unpriced`);
  if (isLive && unrecipedCt > 0) warnings.push(`${unrecipedCt} missing recipe${unrecipedCt !== 1 ? "s" : ""}`);

  // Card accent for live menus
  const cardClass = isLive
    ? "flex flex-col hover:shadow-md transition-shadow ring-2 ring-green-500/25 shadow-sm"
    : isArchived
    ? "flex flex-col hover:shadow-md transition-shadow opacity-70"
    : "flex flex-col hover:shadow-md transition-shadow";

  function openMenu() {
    track("menu_card_opened", { menu_id: menu.id, effective_status: menu.effectiveStatus });
    setLocation(`/menus/${menu.id}`);
  }

  return (
    <>
      <Card className={cardClass}>
        {/* ── Header ── */}
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className="text-base font-semibold leading-tight truncate cursor-pointer hover:underline"
                data-testid={`menu-name-${menu.id}`}
                onClick={openMenu}
              >
                {menu.name}
              </p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {menu.menuType && (
                  <span className="text-xs text-muted-foreground capitalize">{menu.menuType}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StatusBadge status={menu.effectiveStatus} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-actions-${menu.id}`}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openMenu}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Menu
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDupeOpen(true)}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {menu.status === "draft" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("ready")}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark as Ready
                    </DropdownMenuItem>
                  )}
                  {menu.status === "ready" && menu.effectiveStart && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("scheduled")}>
                      <Clock className="h-4 w-4 mr-2" />
                      Schedule
                    </DropdownMenuItem>
                  )}
                  {menu.status === "ready" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("live")}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Publish (Ready → Live)
                    </DropdownMenuItem>
                  )}
                  {menu.status === "ready" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("draft")}>
                      <AlertCircle className="h-4 w-4 mr-2" />
                      Revert to Draft
                    </DropdownMenuItem>
                  )}
                  {menu.status === "scheduled" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("live")}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Publish Now
                    </DropdownMenuItem>
                  )}
                  {menu.status === "scheduled" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("ready")}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Revert to Ready
                    </DropdownMenuItem>
                  )}
                  {menu.status === "scheduled" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("draft")}>
                      <AlertCircle className="h-4 w-4 mr-2" />
                      Revert to Draft
                    </DropdownMenuItem>
                  )}
                  {menu.status === "live" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("retired")} className="text-orange-600">
                      <Archive className="h-4 w-4 mr-2" />
                      Retire
                    </DropdownMenuItem>
                  )}
                  {menu.status === "retired" && (
                    <DropdownMenuItem onClick={() => transitionMutation.mutate("draft")}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Reopen as Draft
                    </DropdownMenuItem>
                  )}
                  {menu.status !== "live" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (window.confirm(`Delete "${menu.name}"? This cannot be undone.`)) {
                            deleteMutation.mutate();
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-4 pb-3 flex-1 space-y-2.5">
          {/* ── Operational context: locations + schedule ── */}
          <div className="space-y-1">
            {/* Locations — zero assignments means "applies to all locations" (product rule) */}
            <div className="flex items-start gap-1.5 flex-wrap">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              {menu.locationCount === 0 ? (
                <span className="text-xs text-muted-foreground">All locations</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {menu.locationNames.slice(0, 3).map((loc) => (
                    <span
                      key={loc}
                      title={loc}
                      className="text-xs bg-muted rounded px-1.5 py-0.5 max-w-[120px] truncate"
                    >
                      {loc}
                    </span>
                  ))}
                  {menu.locationNames.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{menu.locationNames.length - 3} more</span>
                  )}
                </div>
              )}
            </div>

            {/* Schedule + last update */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{scheduleStr}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>Updated {formatDistanceToNow(new Date(menu.updatedAt), { addSuffix: true })}</span>
            </div>
          </div>

          {/* ── Readiness row ── */}
          {isEmpty ? (
            <p className="text-xs text-muted-foreground italic">Empty menu — add sections and items</p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <span>{menu.sectionCount} section{menu.sectionCount !== 1 ? "s" : ""}</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{menu.itemCount} item{menu.itemCount !== 1 ? "s" : ""}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className={menu.pricedItems < menu.itemCount ? "text-foreground" : ""}>{menu.pricedItems} priced</span>
              <span className="text-muted-foreground/40">·</span>
              <span className={menu.recipedItems < menu.itemCount ? "text-foreground" : ""}>{menu.recipedItems} recipe-linked</span>
            </div>
          )}

          {/* ── Warning row — only if issues exist ── */}
          {warnings.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{warnings.join(" · ")}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="px-4 pb-4 pt-0">
          <Button className="w-full" size="sm" onClick={openMenu}>
            Open Menu
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardFooter>
      </Card>

      <DuplicateDialog menu={menu} open={dupeOpen} onOpenChange={setDupeOpen} />
    </>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyStateNoMenus({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-full bg-muted mb-4">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No menus yet</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Create your first menu to organise items into sections with location assignments and pricing.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={onNew} data-testid="button-first-new-menu">
          <Plus className="h-4 w-4 mr-2" />
          Create Menu
        </Button>
        <Button variant="outline" asChild>
          <Link href="/menu-items">
            <ShoppingBag className="h-4 w-4 mr-2" />
            Browse Item Catalog
          </Link>
        </Button>
      </div>
    </div>
  );
}

function EmptyStateFiltered({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-3 rounded-full bg-muted mb-3">
        <Search className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold mb-1">No menus match these filters</h2>
      <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or filter selection.</p>
      <Button variant="outline" onClick={onClear}>
        <X className="h-4 w-4 mr-2" />
        Clear filters
      </Button>
    </div>
  );
}

// ── Menu group section (mobile / filtered view) ───────────────────────────────

function MenuGroup({
  label,
  menus,
  collapsible = false,
  defaultCollapsed = false,
}: {
  label: string;
  menus: MenuWithStats[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (menus.length === 0) return null;

  return (
    <section>
      <button
        className="flex items-center gap-1.5 mb-3 group"
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        type="button"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label} ({menus.length})
        </h2>
        {collapsible && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        )}
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {menus.map((m) => <MenuCard key={m.id} menu={m} />)}
        </div>
      )}
    </section>
  );
}

// ── Desktop 3-column layout ───────────────────────────────────────────────────

interface ColumnGroup {
  sublabel?: string;
  menus: MenuWithStats[];
}

function MenuColumn({ label, groups }: { label: string; groups: ColumnGroup[] }) {
  const total = groups.reduce((sum, g) => sum + g.menus.length, 0);
  const showSublabels = groups.filter((g) => g.sublabel && g.menus.length > 0).length > 1;

  return (
    <div className="min-w-0 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{total > 0 ? ` (${total})` : ""}
      </h2>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
          None
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={i} className="space-y-3">
              {showSublabels && g.sublabel && g.menus.length > 0 && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {g.sublabel}
                </p>
              )}
              {g.menus.map((m) => <MenuCard key={m.id} menu={m} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MenusPage() {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<EffectiveStatus | "all">("all");
  const [attentionFilter, setAttentionFilter] = useState(false);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Fire analytics on mount
  usePageEvent("menus_dashboard_opened");

  const { data: allMenus = [], isLoading } = useQuery<MenuWithStats[]>({
    queryKey: ["/api/menus"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/menus");
      return res.json();
    },
  });

  // Derive filter options from the full list (not filtered)
  const allLocations = useMemo(() => {
    const set = new Set<string>();
    allMenus.forEach((m) => m.locationNames.forEach((l) => set.add(l)));
    return Array.from(set).sort();
  }, [allMenus]);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    allMenus.forEach((m) => { if (m.menuType) set.add(m.menuType); });
    return Array.from(set).sort();
  }, [allMenus]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = allMenus;
    if (nameFilter.trim()) {
      const q = nameFilter.trim().toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      list = list.filter((m) => m.effectiveStatus === statusFilter);
    }
    if (attentionFilter) {
      list = list.filter(needsAttention);
    }
    if (locationFilter !== "all") {
      // locationCount === 0 means "applies to all locations" — always include global menus
      list = list.filter((m) => m.locationCount === 0 || m.locationNames.includes(locationFilter));
    }
    if (typeFilter !== "all") {
      list = list.filter((m) => m.menuType === typeFilter);
    }
    return list;
  }, [allMenus, nameFilter, statusFilter, attentionFilter, locationFilter, typeFilter]);

  const hasActiveFilters = nameFilter.trim() || statusFilter !== "all" || attentionFilter || locationFilter !== "all" || typeFilter !== "all";

  function clearFilters() {
    setNameFilter("");
    setStatusFilter("all");
    setAttentionFilter(false);
    setLocationFilter("all");
    setTypeFilter("all");
  }

  // Summary bar tile click handlers — toggle on/off
  function handleLiveTileClick() {
    setAttentionFilter(false);
    setStatusFilter((prev) => (prev === "live" ? "all" : "live"));
    track("menu_filter_used", { filter_type: "summary_tile", value: "live" });
  }

  function handleScheduledTileClick() {
    setAttentionFilter(false);
    setStatusFilter((prev) => (prev === "scheduled" ? "all" : "scheduled"));
    track("menu_filter_used", { filter_type: "summary_tile", value: "scheduled" });
  }

  function handleAttentionTileClick() {
    setStatusFilter("all");
    setAttentionFilter((prev) => !prev);
    track("menu_filter_used", { filter_type: "summary_tile", value: "attention" });
  }

  // Group filtered menus by effective status
  const liveMenus      = filtered.filter((m) => m.effectiveStatus === "live");
  const scheduledMenus = filtered.filter((m) => m.effectiveStatus === "scheduled").sort(
    (a, b) => (a.effectiveStart ?? "").localeCompare(b.effectiveStart ?? "")
  );
  const readyMenus     = filtered.filter((m) => m.effectiveStatus === "ready");
  const draftMenus     = filtered.filter((m) => m.effectiveStatus === "draft");
  const archivedMenus  = filtered.filter((m) => m.effectiveStatus === "archived" || m.effectiveStatus === "expired");

  const hasContent = filtered.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Menus</h1>
            <p className="text-sm text-muted-foreground">
              Organize, review, and manage menus across every location.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" asChild onClick={() => track("browse_item_catalog_clicked")}>
              <Link href="/menu-items">
                <ShoppingBag className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Browse Item Catalog</span>
                <span className="sm:hidden">Catalog</span>
              </Link>
            </Button>
            <Button
              onClick={() => {
                track("create_menu_clicked");
                setNewMenuOpen(true);
              }}
              data-testid="button-new-menu"
            >
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Create Menu</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </div>

        {/* ── Loading skeletons ── */}
        {isLoading && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1,2,3,4].map((i) => <div key={i} className="h-20 rounded-lg bg-muted/40 animate-pulse" />)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map((i) => <Card key={i} className="h-52 animate-pulse bg-muted/30" />)}
            </div>
          </div>
        )}

        {!isLoading && allMenus.length === 0 && (
          <EmptyStateNoMenus onNew={() => setNewMenuOpen(true)} />
        )}

        {!isLoading && allMenus.length > 0 && (
          <>
            {/* ── Summary bar (always from full list, not filtered) ── */}
            <SummaryBar
              menus={allMenus}
              statusFilter={statusFilter}
              attentionFilter={attentionFilter}
              onLiveClick={handleLiveTileClick}
              onScheduledClick={handleScheduledTileClick}
              onAttentionClick={handleAttentionTileClick}
            />

            {/* ── Filter bar ── */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search menus…"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  className="pl-8 h-8 w-44 text-sm"
                  data-testid="menu-search-input"
                />
              </div>

              {/* Status filter */}
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as EffectiveStatus | "all");
                  track("menu_filter_used", { filter_type: "status", value: v });
                }}
              >
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Location filter */}
              {allLocations.length > 0 && (
                <Select
                  value={locationFilter}
                  onValueChange={(v) => {
                    setLocationFilter(v);
                    track("menu_filter_used", { filter_type: "location", value: v });
                  }}
                >
                  <SelectTrigger className="h-8 w-36 text-sm">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {allLocations.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Type filter */}
              {allTypes.length > 0 && (
                <Select
                  value={typeFilter}
                  onValueChange={(v) => {
                    setTypeFilter(v);
                    track("menu_filter_used", { filter_type: "type", value: v });
                  }}
                >
                  <SelectTrigger className="h-8 w-32 text-sm">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {allTypes.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            {/* ── Filter-empty state ── */}
            {!hasContent && hasActiveFilters && <EmptyStateFiltered onClear={clearFilters} />}

            {/* ── Grouped cards ── */}
            {hasContent && (
              <div className="space-y-7">

                {/* Desktop: 3-column layout (Active | Scheduled | Drafts) */}
                <div className="hidden lg:grid grid-cols-3 gap-6 items-start">
                  <MenuColumn
                    label="Active now"
                    groups={[{ menus: liveMenus }]}
                  />
                  <MenuColumn
                    label="Scheduled"
                    groups={[{ menus: scheduledMenus }]}
                  />
                  <MenuColumn
                    label="Drafts"
                    groups={[
                      { sublabel: "Ready to publish", menus: readyMenus },
                      { sublabel: "Draft",            menus: draftMenus },
                    ]}
                  />
                </div>

                {/* Mobile: stacked groups */}
                <div className="lg:hidden space-y-7">
                  <MenuGroup label="Active now"       menus={liveMenus} />
                  <MenuGroup label="Scheduled"        menus={scheduledMenus} />
                  <MenuGroup label="Ready to publish" menus={readyMenus} />
                  <MenuGroup label="Draft"            menus={draftMenus} />
                </div>

                {/* Archived & expired — full width on all breakpoints */}
                <MenuGroup
                  label="Archived & expired"
                  menus={archivedMenus}
                  collapsible
                  defaultCollapsed={archivedMenus.length > 0 && (liveMenus.length + scheduledMenus.length + readyMenus.length + draftMenus.length) > 0}
                />
              </div>
            )}
          </>
        )}
      </div>

      <NewMenuDialog open={newMenuOpen} onOpenChange={setNewMenuOpen} />
    </div>
  );
}
