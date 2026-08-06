import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useStoreContext } from "@/hooks/use-store-context";
import {
  ClipboardList,
  ScanLine,
  Trash2,
  Thermometer,
  Plus,
  Play,
  ChevronRight,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Secondary tab definition
// ---------------------------------------------------------------------------

const TABS = [
  { label: "Overview", href: "/count" },
  { label: "Items", href: "/inventory-items" },
  { label: "Counts", href: "/inventory-sessions" },
  { label: "Shelf Scan", href: "/shelf-scans" },
  { label: "Waste", href: "/waste" },
  { label: "On Hand", href: "/prep-chart/on-hand" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryCount {
  id: string;
  name: string;
  countDate: string;
  applied: number;
  storeId: string | null;
  storeName?: string;
  lineCount?: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SecondaryTabs({ activeHref }: { activeHref: string }) {
  return (
    <div
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="count-secondary-tabs"
    >
      <div className="flex overflow-x-auto px-4 md:px-6">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              activeHref === tab.href
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-count-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  iconClass,
  iconBg,
  title,
  description,
  prominent = false,
  horizontal = false,
  testId,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  iconBg: string;
  title: string;
  description: string;
  prominent?: boolean;
  horizontal?: boolean;
  testId: string;
}) {
  return (
    <Link href={href} data-testid={testId}>
      <Card className="h-full hover-elevate cursor-pointer">
        <CardContent
          className={cn(
            "flex p-5",
            horizontal
              ? "flex-row items-center gap-4"
              : "flex-col justify-between min-h-[7.5rem]"
          )}
        >
          <div
            className={cn(
              "rounded-lg flex items-center justify-center shrink-0",
              iconBg,
              prominent ? "h-11 w-11" : "h-9 w-9",
              !horizontal && "mb-3"
            )}
          >
            <Icon className={cn(prominent ? "h-5 w-5" : "h-4 w-4", iconClass)} />
          </div>
          <div className={cn("flex-1", horizontal && "min-w-0")}>
            <p className={cn("font-semibold", prominent ? "text-base" : "text-sm")}>
              {title}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
              {description}
            </p>
          </div>
          {horizontal && (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CountLanding() {
  const [location] = useLocation();
  const { selectedStoreId } = useStoreContext();

  const { data: counts = [], isLoading } = useQuery<InventoryCount[]>({
    queryKey: ["/api/inventory-counts"],
  });

  // Separate active (in-progress) from applied
  const activeCounts = counts.filter((c) => c.applied === 0);
  const recentCounts = counts
    .slice()
    .sort(
      (a, b) =>
        new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
    )
    .slice(0, 6);

  const topActive = activeCounts[0] ?? null;

  return (
    <div className="flex flex-col h-full">
      <SecondaryTabs activeHref={location} />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Count</h1>
          <p className="text-sm text-muted-foreground">
            Track inventory, log waste, and view current stock levels.
          </p>
        </div>

        {/* Resume banner — only when an active count exists */}
        {topActive && (
          <Card
            className="border-primary/20 bg-primary/5"
            data-testid="count-resume-banner"
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Play className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{topActive.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Count in progress
                    {activeCounts.length > 1 &&
                      ` · ${activeCounts.length} open sessions`}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" data-testid="button-resume-count">
                <Link href={`/count/${topActive.id}`}>Resume</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Primary action grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Start Count — spans 2 cols on sm, 1 on lg */}
          <div className="sm:col-span-2 lg:col-span-1">
            <ActionCard
              href="/inventory-sessions"
              icon={Plus}
              iconBg="bg-accent-button/10"
              iconClass="text-accent-button"
              title="Start Count"
              description="Begin a new inventory count session"
              prominent
              testId="action-start-count"
            />
          </div>

          {/* Scan Shelf */}
          <ActionCard
            href="/shelf-scans"
            icon={ScanLine}
            iconBg="bg-blue-500/10"
            iconClass="text-blue-600 dark:text-blue-400"
            title="Scan Shelf"
            description="AI-powered shelf recognition"
            testId="action-scan-shelf"
          />

          {/* Log Waste */}
          <ActionCard
            href="/waste"
            icon={Trash2}
            iconBg="bg-red-500/10"
            iconClass="text-red-600 dark:text-red-400"
            title="Log Waste"
            description="Record discarded items"
            testId="action-log-waste"
          />

          {/* On Hand — spans full width */}
          <div className="sm:col-span-2 lg:col-span-3">
            <ActionCard
              href="/prep-chart/on-hand"
              icon={Thermometer}
              iconBg="bg-green-500/10"
              iconClass="text-green-600 dark:text-green-400"
              title="View On Hand"
              description="Check current estimated quantities for all items"
              horizontal
              testId="action-view-on-hand"
            />
          </div>
        </div>

        {/* Recent counts */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Counts</h2>
            <Link
              href="/inventory-sessions"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-view-all-counts"
            >
              View all
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-md bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : recentCounts.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 text-center gap-2"
              data-testid="count-empty-state"
            >
              <Package className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No counts yet. Start your first inventory count above.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentCounts.map((count) => (
                <Link
                  key={count.id}
                  href={`/count/${count.id}`}
                  data-testid={`count-row-${count.id}`}
                >
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-md hover-elevate">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {count.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {count.countDate
                            ? format(new Date(count.countDate), "MMM d, yyyy")
                            : "—"}
                          {count.storeName && ` · ${count.storeName}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {count.lineCount !== undefined && count.lineCount > 0 && (
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {count.lineCount} items
                        </span>
                      )}
                      <Badge
                        variant={count.applied === 0 ? "outline" : "secondary"}
                        className="text-xs"
                        data-testid={`badge-count-status-${count.id}`}
                      >
                        {count.applied === 0 ? "In Progress" : "Applied"}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
