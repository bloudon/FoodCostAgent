import { useState } from "react";
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
  Tag,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MenuWithStats {
  id: string;
  companyId: string;
  name: string;
  menuType: string | null;
  status: "draft" | "ready" | "live" | "retired";
  description: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  pricedItems: number;
}

const MENU_TYPES = [
  { value: "dinner",   label: "Dinner" },
  { value: "lunch",    label: "Lunch" },
  { value: "brunch",   label: "Brunch" },
  { value: "breakfast",label: "Breakfast" },
  { value: "catering", label: "Catering" },
  { value: "event",    label: "Event" },
  { value: "other",    label: "Other" },
];

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "live")     return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Live</Badge>;
  if (status === "ready")    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">Ready</Badge>;
  if (status === "retired")  return <Badge variant="secondary">Retired</Badge>;
  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0">Draft</Badge>;
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
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/menus/${menu.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      toast({ title: `"${menu.name}" deleted` });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to delete", variant: "destructive" }),
  });

  const missingPrice = menu.totalItems - menu.pricedItems;

  return (
    <>
      <Card className="flex flex-col hover:shadow-md transition-shadow">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold leading-tight truncate" data-testid={`menu-name-${menu.id}`}>
                {menu.name}
              </p>
              {menu.menuType && (
                <p className="text-xs text-muted-foreground capitalize mt-0.5">{menu.menuType}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StatusBadge status={menu.status} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-actions-${menu.id}`}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/menus/${menu.id}`}>
                      <ChevronRight className="h-4 w-4 mr-2" />
                      Open builder
                    </Link>
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
          {menu.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{menu.description}</p>
          )}
        </CardHeader>

        <CardContent className="px-4 pb-3 flex-1">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Utensils className="h-3.5 w-3.5 shrink-0" />
              <span>{menu.totalItems} item{menu.totalItems !== 1 ? "s" : ""}</span>
            </div>
            {missingPrice > 0 ? (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Tag className="h-3.5 w-3.5 shrink-0" />
                <span>{missingPrice} no price</span>
              </div>
            ) : menu.totalItems > 0 ? (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Tag className="h-3.5 w-3.5 shrink-0" />
                <span>All priced</span>
              </div>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="px-4 pb-3 pt-0 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            <span>Updated {formatDistanceToNow(new Date(menu.updatedAt), { addSuffix: true })}</span>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/menus/${menu.id}`}>
              Open
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </CardFooter>
      </Card>

      <DuplicateDialog menu={menu} open={dupeOpen} onOpenChange={setDupeOpen} />
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-full bg-muted mb-4">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No menus yet</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Create your first menu to start organising items into sections with menu-specific prices.
      </p>
      <Button onClick={onNew} data-testid="button-first-new-menu">
        <Plus className="h-4 w-4 mr-2" />
        Create First Menu
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MenusPage() {
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const { data: menus = [], isLoading } = useQuery<MenuWithStats[]>({
    queryKey: ["/api/menus"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/menus");
      return res.json();
    },
  });

  const liveMenus    = menus.filter((m) => m.status === "live");
  const readyMenus   = menus.filter((m) => m.status === "ready");
  const draftMenus   = menus.filter((m) => m.status === "draft");
  const retiredMenus = menus.filter((m) => m.status === "retired");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Menus</h1>
            <p className="text-sm text-muted-foreground">
              Create and manage your menu portfolio — each with its own sections, items, and pricing.
            </p>
          </div>
          <Button onClick={() => setNewMenuOpen(true)} data-testid="button-new-menu">
            <Plus className="h-4 w-4 mr-2" />
            New Menu
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="h-40 animate-pulse bg-muted/30" />
            ))}
          </div>
        )}

        {!isLoading && menus.length === 0 && (
          <EmptyState onNew={() => setNewMenuOpen(true)} />
        )}

        {!isLoading && menus.length > 0 && (
          <div className="space-y-6">
            {liveMenus.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Live ({liveMenus.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {liveMenus.map((m) => <MenuCard key={m.id} menu={m} />)}
                </div>
              </section>
            )}
            {readyMenus.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Ready to Publish ({readyMenus.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {readyMenus.map((m) => <MenuCard key={m.id} menu={m} />)}
                </div>
              </section>
            )}
            {draftMenus.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Draft ({draftMenus.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {draftMenus.map((m) => <MenuCard key={m.id} menu={m} />)}
                </div>
              </section>
            )}
            {retiredMenus.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Retired ({retiredMenus.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {retiredMenus.map((m) => <MenuCard key={m.id} menu={m} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <NewMenuDialog open={newMenuOpen} onOpenChange={setNewMenuOpen} />
    </div>
  );
}
