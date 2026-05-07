import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  }[];
  recentScans: {
    id: string;
    createdAt: string;
    frameCount: number;
    itemCount: number;
    sessionId: string | null;
    sessionName: string | null;
  }[];
}

function roleLabel(role: string): string {
  switch (role) {
    case "company_admin": return "Admin";
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

function SessionCard({
  session,
  onOpen,
}: {
  session: MobileDashboardData["activeSessions"][0];
  onOpen: (id: string) => void;
}) {
  const startedAt = session.startedAt ? new Date(session.startedAt) : null;
  return (
    <button
      className="w-full text-left hover-elevate active-elevate-2"
      onClick={() => onOpen(session.id)}
      data-testid={`button-session-${session.id}`}
    >
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{session.name}</p>
            {session.storeName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Store className="w-3 h-3" />
                {session.storeName}
              </p>
            )}
            {startedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Started {formatDistanceToNow(startedAt, { addSuffix: true })}
              </p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}

function ScanRow({ scan }: { scan: MobileDashboardData["recentScans"][0] }) {
  const createdAt = new Date(scan.createdAt);
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0" data-testid={`row-scan-${scan.id}`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
        <Camera className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {scan.sessionName ?? "Shelf scan"}
        </p>
        <p className="text-xs text-muted-foreground">
          {scan.itemCount} item{scan.itemCount !== 1 ? "s" : ""} &middot;{" "}
          {formatDistanceToNow(createdAt, { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  accent,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  accent?: boolean;
  testId: string;
}) {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => setLocation(href)}
      data-testid={testId}
      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border hover-elevate active-elevate-2 w-full ${
        accent ? "bg-[#f2690d] text-white border-transparent" : "bg-card"
      }`}
    >
      <Icon className={`w-6 h-6 ${accent ? "text-white" : "text-primary"}`} />
      <span className={`text-xs font-medium text-center leading-tight ${accent ? "text-white" : ""}`}>
        {label}
      </span>
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export default function DashboardMobile() {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<MobileDashboardData>({
    queryKey: ["/api/mobile/dashboard"],
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
  const firstName = data.userName?.split(" ")[0] ?? "there";

  const handleOpenSession = (sessionId: string) => {
    setLocation(`/count/${sessionId}/mobile`);
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="bg-primary px-4 pt-6 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-primary-foreground/70 text-sm">
              {greeting()}, {firstName}
            </p>
            <h1 className="text-primary-foreground text-xl font-semibold mt-0.5">
              {data.businessName ?? "FnB Cost Pro"}
            </h1>
            {data.locationName && (
              <p className="text-primary-foreground/70 text-sm flex items-center gap-1 mt-1">
                <Store className="w-3 h-3" />
                {data.locationName}
              </p>
            )}
          </div>
          <Badge
            className="mt-1 bg-primary-foreground/20 text-primary-foreground border-transparent text-xs"
            data-testid="badge-user-role"
          >
            {roleLabel(data.role)}
          </Badge>
        </div>
      </div>

      <div className="px-4 -mt-3 space-y-4">
        {/* Active Sessions */}
        <section data-testid="section-active-sessions">
          <div className="flex items-center justify-between mb-2 mt-5">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" />
              Active Sessions
              {data.activeSessions.length > 0 && (
                <Badge className="ml-1 text-xs" data-testid="badge-active-count">
                  {data.activeSessions.length}
                </Badge>
              )}
            </h2>
          </div>

          {data.activeSessions.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No active count sessions</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {data.activeSessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onOpen={handleOpenSession}
                />
              ))}
            </div>
          )}
        </section>

        {/* Quick Actions — role-aware */}
        <section data-testid="section-quick-actions">
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-primary" />
            Quick Actions
          </h2>

          {/* All roles: Start Count is always prominent */}
          <Button
            className="w-full mb-3 bg-[#f2690d] hover:bg-[#f2690d] text-white font-semibold py-5 text-base"
            onClick={() => setLocation("/new-count?embedded=true")}
            data-testid="button-start-count"
          >
            <Plus className="w-5 h-5 mr-2" />
            Start New Count
          </Button>

          {/* Role-specific grid */}
          {isAdmin ? (
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={ClipboardList} label="Count Sessions" href="/inventory-sessions?embedded=true" testId="action-sessions" />
              <QuickAction icon={Package} label="Inventory" href="/inventory-items?embedded=true" testId="action-inventory" />
              <QuickAction icon={BookOpen} label="Recipes" href="/recipes?embedded=true" testId="action-recipes" />
              <QuickAction icon={ScanLine} label="Shelf Scans" href="/shelf-scans?embedded=true" testId="action-scans" />
              <QuickAction icon={TrendingUp} label="Variance" href="/tfc/variance?embedded=true" testId="action-variance" />
              <QuickAction icon={Store} label="All Stores" href="/stores?embedded=true" testId="action-stores" />
            </div>
          ) : isManager ? (
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={ClipboardList} label="Count Sessions" href="/inventory-sessions?embedded=true" testId="action-sessions" />
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

        {/* Admin: store overview */}
        {isAdmin && data.stores.length > 1 && (
          <section data-testid="section-store-overview">
            <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Store className="w-4 h-4 text-primary" />
              Locations ({data.stores.length})
            </h2>
            <div className="space-y-1.5">
              {data.stores.map(store => {
                const storeSessions = data.activeSessions.filter(s => s.storeId === store.id);
                return (
                  <div
                    key={store.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border"
                    data-testid={`row-store-${store.id}`}
                  >
                    <span className="text-sm font-medium">{store.name}</span>
                    {storeSessions.length > 0 ? (
                      <Badge className="text-xs" data-testid={`badge-store-sessions-${store.id}`}>
                        {storeSessions.length} active
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No active counts</span>
                    )}
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
              <Camera className="w-4 h-4 text-primary" />
              Recent Scans
            </h2>
            <Card>
              <CardContent className="px-4 py-0 divide-y">
                {data.recentScans.slice(0, 5).map(scan => (
                  <ScanRow key={scan.id} scan={scan} />
                ))}
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
