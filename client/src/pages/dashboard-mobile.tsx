import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardList,
  Plus,
  ScanLine,
  ChevronRight,
  Store,
  Camera,
  TrendingUp,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RecentSession {
  id: string;
  name: string;
  storeId: string | null;
  storeName: string | null;
  countDate: string;
  lineCount: number;
}

interface MobileDashboardData {
  role: string;
  userName: string | null;
  businessName: string | null;
  locationName: string | null;
  stores: { id: string; name: string }[];
  activeSessions: {
    id: string;
    name: string;
    storeId: string | null;
    storeName: string | null;
    startedAt: string | null;
    countedItems: number;
    totalItems: number;
  }[];
  recentSessions: RecentSession[];
  recentScans: {
    id: string;
    createdAt: string;
    frameCount: number;
    itemCount: number;
    sessionId: string | null;
    sessionName: string | null;
  }[];
  overdueOrders: {
    id: string;
    vendorName: string;
    orderDeadline: string;
  }[];
}

function roleLabel(role: string): string {
  switch (role) {
    case "company_admin":
    case "owner": return "Admin";
    case "store_manager": return "Manager";
    case "global_admin": return "Global Admin";
    default: return "Team";
  }
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayDefaultName(): string {
  return format(new Date(), "MMM d, yyyy");
}

function ActiveSessionCard({
  session,
  onOpen,
}: {
  session: MobileDashboardData["activeSessions"][0];
  onOpen: (id: string) => void;
}) {
  const startedAt = session.startedAt ? new Date(session.startedAt) : null;
  const { countedItems, totalItems } = session;
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  return (
    <button
      className="w-full text-left hover-elevate active-elevate-2"
      onClick={() => onOpen(session.id)}
      data-testid={`button-active-session-${session.id}`}
    >
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#f2690d]/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-[#f2690d]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{session.name}</p>
            {session.storeName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Store className="w-3 h-3" />
                {session.storeName}
              </p>
            )}
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs text-muted-foreground"
                  data-testid={`text-session-progress-${session.id}`}
                >
                  {countedItems} of {totalItems} items counted
                </span>
                {totalItems > 0 && (
                  <span className="text-xs font-medium text-[#f2690d] flex-shrink-0">{progressPct}%</span>
                )}
              </div>
              <div
                className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
                data-testid={`progress-bar-${session.id}`}
              >
                <div
                  className="h-full rounded-full bg-[#f2690d] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {startedAt && (
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(startedAt, { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs font-medium text-[#f2690d]">Continue</span>
            <ChevronRight className="w-4 h-4 text-[#f2690d]" />
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function RecentSessionRow({ session }: { session: RecentSession }) {
  const countDate = new Date(session.countDate);
  return (
    <div
      className="flex items-center gap-3 py-3 border-b last:border-0"
      data-testid={`row-recent-session-${session.id}`}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{session.name}</p>
        <p className="text-xs text-muted-foreground">
          {session.lineCount} item{session.lineCount !== 1 ? "s" : ""}
          {session.storeName ? ` \u00b7 ${session.storeName}` : ""}
        </p>
      </div>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {format(countDate, "MMM d")}
      </span>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  testId: string;
}) {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => setLocation(href)}
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border bg-card hover-elevate active-elevate-2 w-full"
    >
      <Icon className="w-5 h-5 text-primary" />
      <span className="text-xs font-medium text-center leading-tight">
        {label}
      </span>
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-24 bg-primary" />
      <div className="px-4 space-y-4 pt-4">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}

interface NewCountModalProps {
  open: boolean;
  onClose: () => void;
  stores: { id: string; name: string }[];
  onCreated: (sessionId: string) => void;
}

function NewCountModal({ open, onClose, stores, onCreated }: NewCountModalProps) {
  const { toast } = useToast();
  const [storeId, setStoreId] = useState<string>(stores.length === 1 ? stores[0].id : "");
  const [sessionName, setSessionName] = useState(todayDefaultName());

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const res = await apiRequest("POST", "/api/mobile/sessions", {
        storeId,
        name: sessionName.trim() || todayDefaultName(),
        countDate: today,
      });
      return res.json();
    },
    onSuccess: (data) => {
      onClose();
      onCreated(data.id);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "error" in err
          ? String((err as { error: unknown }).error)
          : "Please try again.";
      toast({
        title: "Could not start count",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleStart = () => {
    if (!storeId) {
      toast({ title: "Choose a location", description: "Select which store to count.", variant: "destructive" });
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="dialog-new-count">
        <DialogHeader>
          <DialogTitle>Start a New Count</DialogTitle>
        </DialogHeader>

        {stores.length === 0 ? (
          <>
            <div className="py-4 text-center space-y-3" data-testid="dialog-no-stores">
              <Store className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">No locations assigned</p>
              <p className="text-xs text-muted-foreground">
                You haven&apos;t been assigned to any store yet. Ask your manager to set up your access.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-count">
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-2">
              {stores.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="store-select">Location</Label>
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger id="store-select" data-testid="select-store">
                      <SelectValue placeholder="Choose a store..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id} data-testid={`option-store-${s.id}`}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {stores.length === 1 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted">
                  <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">{stores[0].name}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="session-name">
                  Count name <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="session-name"
                  data-testid="input-session-name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={todayDefaultName()}
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={createMutation.isPending}
                data-testid="button-cancel-count"
              >
                Cancel
              </Button>
              <Button
                className="bg-[#f2690d] text-white"
                onClick={handleStart}
                disabled={createMutation.isPending || !storeId}
                data-testid="button-confirm-start-count"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Start Count
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardMobile() {
  const [, setLocation] = useLocation();
  const [showNewCountModal, setShowNewCountModal] = useState(false);

  const { data, isLoading, error } = useQuery<MobileDashboardData>({
    queryKey: ["/api/mobile/dashboard"],
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Unable to load dashboard. Please try again.</p>
        </div>
      </div>
    );
  }

  const isAdmin = data.role === "company_admin" || data.role === "global_admin";
  const isManager = data.role === "store_manager";
  const isFloorStaff = !isAdmin && !isManager;
  const firstName = data.userName?.split(" ")[0] ?? "there";
  const hasAnySessions = data.activeSessions.length > 0 || data.recentSessions.length > 0;

  const handleOpenSession = (sessionId: string) => {
    setLocation(`/count/${sessionId}/mobile`);
  };

  const handleStartNewCount = () => {
    if (isFloorStaff) {
      setShowNewCountModal(true);
    } else {
      setLocation("/inventory-sessions?embedded=true");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="bg-primary px-4 pt-6 pb-8">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-primary-foreground/70 text-sm">
              {greeting()}, {firstName}
            </p>
            <h1 className="text-primary-foreground text-xl font-bold mt-0.5">
              {data.businessName ?? "FnB Cost Pro"}
            </h1>
            {data.locationName && (
              <p className="text-primary-foreground/70 text-xs flex items-center gap-1 mt-1">
                <Store className="w-3 h-3" />
                {data.locationName}
              </p>
            )}
          </div>
          <Badge
            className="mt-1 flex-shrink-0 bg-primary-foreground/20 text-primary-foreground border-transparent text-xs"
            data-testid="badge-user-role"
          >
            {roleLabel(data.role)}
          </Badge>
        </div>
      </div>

      <div className="px-4 -mt-4 space-y-5">
        {/* Start New Count — always at the top, always prominent */}
        <Button
          className="w-full bg-[#f2690d] text-white font-semibold text-base py-6 shadow-md"
          onClick={handleStartNewCount}
          data-testid="button-start-count"
        >
          <Plus className="w-5 h-5 mr-2" />
          Start New Count
        </Button>

        {/* Overdue Order Alerts — admins and managers only */}
        {(isAdmin || isManager) && data.overdueOrders && data.overdueOrders.length > 0 && (
          <section data-testid="section-overdue-orders">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Overdue Orders
              <Badge
                className="ml-1 text-xs bg-red-500 text-white border-transparent"
                data-testid="badge-overdue-count"
              >
                {data.overdueOrders.length}
              </Badge>
            </h2>
            <Card className="border-red-200 dark:border-red-900">
              <CardContent className="px-4 py-0 divide-y divide-red-100 dark:divide-red-900/50">
                {data.overdueOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center gap-3 py-3"
                    data-testid={`row-overdue-order-${order.id}`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-red-700 dark:text-red-400">
                        {order.vendorName}
                      </p>
                      <p className="text-xs text-red-500 dark:text-red-500">
                        Deadline passed {format(new Date(order.orderDeadline), "MMM d")}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Active Sessions */}
        {data.activeSessions.length > 0 && (
          <section data-testid="section-active-sessions">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
              <Clock className="w-4 h-4 text-[#f2690d]" />
              In Progress
              <Badge className="ml-1 text-xs" data-testid="badge-active-count">
                {data.activeSessions.length}
              </Badge>
            </h2>
            <div className="space-y-2">
              {data.activeSessions.map(session => (
                <ActiveSessionCard
                  key={session.id}
                  session={session}
                  onOpen={handleOpenSession}
                />
              ))}
            </div>
          </section>
        )}

        {/* Recent Completed Sessions */}
        {data.recentSessions.length > 0 && (
          <section data-testid="section-recent-sessions">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
              Recent Counts
            </h2>
            <Card>
              <CardContent className="px-4 py-0 divide-y">
                {data.recentSessions.map(session => (
                  <RecentSessionRow key={session.id} session={session} />
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Empty state — only shown when there are truly no sessions at all */}
        {!hasAnySessions && (
          <Card data-testid="card-empty-state">
            <CardContent className="p-6 text-center space-y-3">
              <ClipboardList className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">No active counts</p>
              <p className="text-xs text-muted-foreground">
                Tap Start New Count to begin your first inventory count.
              </p>
              <Button
                className="w-full bg-[#f2690d] text-white font-semibold"
                onClick={handleStartNewCount}
                data-testid="button-empty-start-count"
              >
                <Plus className="w-4 h-4 mr-2" />
                Start New Count
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions — role-aware, below the sessions */}
        <section data-testid="section-quick-actions">
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            Quick Access
          </h2>

          {isAdmin ? (
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={ClipboardList} label="All Sessions" href="/inventory-sessions?embedded=true" testId="action-sessions" />
              <QuickAction icon={Package} label="Inventory" href="/inventory-items?embedded=true" testId="action-inventory" />
              <QuickAction icon={BookOpen} label="Recipes" href="/recipes?embedded=true" testId="action-recipes" />
              <QuickAction icon={ScanLine} label="Shelf Scans" href="/shelf-scans?embedded=true" testId="action-scans" />
              <QuickAction icon={TrendingUp} label="Variance" href="/tfc/variance?embedded=true" testId="action-variance" />
              <QuickAction icon={Store} label="All Stores" href="/stores?embedded=true" testId="action-stores" />
            </div>
          ) : isManager ? (
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={ClipboardList} label="All Sessions" href="/inventory-sessions?embedded=true" testId="action-sessions" />
              <QuickAction icon={ScanLine} label="Shelf Scans" href="/shelf-scans?embedded=true" testId="action-scans" />
              <QuickAction icon={TrendingUp} label="Variance" href="/tfc/variance?embedded=true" testId="action-variance" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <QuickAction icon={ClipboardList} label="Count Sessions" href="/inventory-sessions?embedded=true" testId="action-sessions" />
              <QuickAction icon={ScanLine} label="Shelf Scans" href="/shelf-scans?embedded=true" testId="action-scans" />
            </div>
          )}
        </section>

        {/* Admin: store overview — only when multiple stores have active sessions */}
        {isAdmin && data.stores.length > 1 && data.activeSessions.length > 0 && (
          <section data-testid="section-store-overview">
            <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Store className="w-4 h-4 text-muted-foreground" />
              Locations
            </h2>
            <div className="space-y-1.5">
              {data.stores.map(store => {
                const storeSessions = data.activeSessions.filter(s => s.storeId === store.id);
                if (storeSessions.length === 0) return null;
                return (
                  <div
                    key={store.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border"
                    data-testid={`row-store-${store.id}`}
                  >
                    <span className="text-sm font-medium">{store.name}</span>
                    <Badge className="text-xs" data-testid={`badge-store-sessions-${store.id}`}>
                      {storeSessions.length} active
                    </Badge>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recent Scans */}
        {data.recentScans.length > 0 && (
          <section data-testid="section-recent-scans">
            <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-muted-foreground" />
              Recent Shelf Scans
            </h2>
            <Card>
              <CardContent className="px-4 py-0 divide-y">
                {data.recentScans.slice(0, 5).map(scan => (
                  <div
                    key={scan.id}
                    className="flex items-center gap-3 py-3 border-b last:border-0"
                    data-testid={`row-scan-${scan.id}`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <Camera className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {scan.sessionName ?? "Shelf scan"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {scan.itemCount} item{scan.itemCount !== 1 ? "s" : ""} &middot;{" "}
                        {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      {/* New Count Modal — floor staff only */}
      {isFloorStaff && showNewCountModal && (
        <NewCountModal
          open={showNewCountModal}
          onClose={() => setShowNewCountModal(false)}
          stores={data.stores}
          onCreated={(sessionId) => setLocation(`/count/${sessionId}/mobile`)}
        />
      )}
    </div>
  );
}
