import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Upload,
  TrendingUp,
  ChevronRight,
  Activity,
  AlertTriangle,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useTier } from "@/hooks/use-tier";
import { useAuth } from "@/lib/auth-context";
import { useStoreContext } from "@/hooks/use-store-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VarianceSummary {
  currentCountId: string;
  inventoryDate: string;
  totalVarianceCost: number;
  totalVariancePercent: number;
  daySpan: number;
}

interface TopVarianceItem {
  inventoryItemId: string;
  inventoryItemName: string;
  varianceCost: number;
  variancePercent: number;
  currentCountId: string;
  previousCountId: string;
}

interface RecentCountSummary {
  countId: string;
  countDate: string;
  totalItems: number;
  totalValue: number;
  previousValue: number | null;
  valueDelta: number | null;
}

// ---------------------------------------------------------------------------
// Secondary tabs (feature-gated)
// ---------------------------------------------------------------------------

function SecondaryTabs({
  activeHref,
  showTfc,
  showPosImport,
}: {
  activeHref: string;
  showTfc: boolean;
  showPosImport: boolean;
}) {
  const tabs = [
    { label: "Overview", href: "/analyze" },
    ...(showTfc ? [{ label: "Theoretical Food Cost", href: "/tfc/variance" }] : []),
    ...(showPosImport ? [{ label: "Import Sales", href: "/tfc/sales-import" }] : []),
    { label: "Inventory Variance", href: "/variance" },
  ];

  return (
    <div
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="analyze-secondary-tabs"
    >
      <div className="flex overflow-x-auto px-4 md:px-6">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/analyze"
              ? activeHref === "/analyze"
              : activeHref.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-testid={`tab-analyze-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action card
// ---------------------------------------------------------------------------

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
// Variance color helper
// ---------------------------------------------------------------------------

function varianceBadgeClass(pct: number): string {
  if (pct > 5) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (pct > 2) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
}

// ---------------------------------------------------------------------------
// Recent count summary widget (non-TFC stores)
// ---------------------------------------------------------------------------

function RecentCountWidget({ summary, isLoading }: { summary: RecentCountSummary | null | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div>
        <h2 className="text-sm font-semibold mb-3">Last Inventory Count</h2>
        <div className="h-24 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div>
        <h2 className="text-sm font-semibold mb-3">Last Inventory Count</h2>
        <div
          className="flex flex-col items-center justify-center py-8 text-center gap-2"
          data-testid="recent-count-empty-state"
        >
          <Package className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No completed counts yet. Apply your first inventory count to see a summary here.
          </p>
        </div>
      </div>
    );
  }

  const deltaPositive = summary.valueDelta !== null && summary.valueDelta > 0;
  const deltaZero = summary.valueDelta === null || summary.valueDelta === 0;

  return (
    <div data-testid="recent-count-summary-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Last Inventory Count</h2>
        <Link
          href="/variance"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-view-variance-report"
        >
          View report
        </Link>
      </div>

      <Link href="/inventory-sessions" data-testid="link-recent-count-detail">
        <Card className="hover-elevate cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-green-500/10 shrink-0">
                  <Package className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium" data-testid="text-recent-count-date">
                    {format(new Date(summary.countDate), "MMM d, yyyy")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summary.totalItems} {summary.totalItems === 1 ? "item" : "items"} counted
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-0.5">On-hand value</p>
                  <p
                    className="text-sm font-semibold"
                    data-testid="text-recent-count-value"
                  >
                    ${summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {!deltaZero && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-0.5">vs. prior count</p>
                    <div className="flex items-center gap-1 justify-end">
                      {deltaPositive ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-red-500 dark:text-red-400 shrink-0" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                      )}
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          deltaPositive
                            ? "text-red-600 dark:text-red-400"
                            : "text-green-600 dark:text-green-400"
                        )}
                        data-testid="text-recent-count-delta"
                      >
                        {deltaPositive ? "+" : ""}
                        ${Math.abs(summary.valueDelta!).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )}

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyzeLanding() {
  const [location] = useLocation();
  const { hasFeature } = useTier();
  const { user } = useAuth();
  const { selectedStoreId } = useStoreContext();

  const showTfc = hasFeature("tfc_variance");
  const showPosImport = hasFeature("pos_import");

  // Only fetch summaries when the feature is available and a store is selected
  const { data: summaries = [], isLoading } = useQuery<VarianceSummary[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: showTfc && !!selectedStoreId,
  });

  const { data: topItem = null } = useQuery<TopVarianceItem | null>({
    queryKey: [`/api/tfc/variance/top-item?storeId=${selectedStoreId}`],
    enabled: showTfc && !!selectedStoreId,
  });

  // For non-TFC stores: fetch lightweight inventory count summary
  const { data: recentCountSummary, isLoading: recentCountLoading } = useQuery<RecentCountSummary | null>({
    queryKey: [`/api/inventory-counts/recent-summary?storeId=${selectedStoreId}`],
    enabled: !showTfc && !!selectedStoreId,
  });

  const recentSummaries = summaries
    .slice()
    .sort((a, b) => new Date(b.inventoryDate).getTime() - new Date(a.inventoryDate).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      <SecondaryTabs
        activeHref={location}
        showTfc={showTfc}
        showPosImport={showPosImport}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analyze</h1>
          <p className="text-sm text-muted-foreground">
            Track food cost, review variance, and gain insights.
          </p>
        </div>

        {/* Primary action grid — only show cards for accessible features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Theoretical Food Cost — requires tfc_variance */}
          {showTfc && (
            <div className={!showPosImport ? "sm:col-span-2 lg:col-span-1" : ""}>
              <ActionCard
                href="/tfc/variance"
                icon={BarChart3}
                iconBg="bg-accent-button/10"
                iconClass="text-accent-button"
                title="Theoretical Food Cost"
                description="Compare theoretical vs. actual cost by inventory period"
                prominent
                testId="action-food-cost"
              />
            </div>
          )}

          {/* Import Sales — requires pos_import */}
          {showPosImport && (
            <ActionCard
              href="/tfc/sales-import"
              icon={Upload}
              iconBg="bg-blue-500/10"
              iconClass="text-blue-600 dark:text-blue-400"
              title="Import Sales"
              description="Upload POS data to calculate theoretical food cost"
              testId="action-import-sales"
            />
          )}

          {/* Inventory Variance — always available */}
          <div
            className={cn(
              showTfc || showPosImport
                ? "sm:col-span-2 lg:col-span-3"
                : "sm:col-span-2 lg:col-span-1"
            )}
          >
            <ActionCard
              href="/variance"
              icon={TrendingUp}
              iconBg="bg-green-500/10"
              iconClass="text-green-600 dark:text-green-400"
              title="Inventory Variance"
              description="Item-level usage variance between expected and actual"
              horizontal={showTfc || showPosImport}
              prominent={!showTfc && !showPosImport}
              testId="action-variance-report"
            />
          </div>
        </div>

        {/* Recent count summary — shown for non-TFC stores when a store is selected */}
        {!showTfc && selectedStoreId && (
          <RecentCountWidget
            summary={recentCountSummary}
            isLoading={recentCountLoading}
          />
        )}

        {/* Recent TFC periods — only when feature enabled */}
        {showTfc && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Recent Periods</h2>
              <Link
                href="/tfc/variance"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-view-all-periods"
              >
                View all
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            ) : recentSummaries.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-10 text-center gap-2"
                data-testid="analyze-empty-state"
              >
                <Activity className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No variance data yet.{showPosImport ? " Import sales to get started." : ""}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentSummaries.map((s) => (
                  <Link
                    key={s.currentCountId}
                    href={`/tfc/variance?countId=${s.currentCountId}`}
                    data-testid={`analyze-row-${s.currentCountId}`}
                  >
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-md hover-elevate">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {format(new Date(s.inventoryDate), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.daySpan} {s.daySpan === 1 ? "day" : "days"}&nbsp;·&nbsp;
                            {s.totalVarianceCost > 0 ? "+" : ""}
                            ${Math.abs(s.totalVarianceCost).toFixed(0)} variance
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn("text-xs shrink-0 ml-2", varianceBadgeClass(s.totalVariancePercent))}
                        data-testid={`badge-variance-${s.currentCountId}`}
                      >
                        {s.totalVariancePercent > 0 ? "+" : ""}
                        {s.totalVariancePercent.toFixed(1)}%
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Top variance item — biggest single driver from most recent period */}
        {showTfc && topItem && (
          <div data-testid="top-variance-item-section">
            <h2 className="text-sm font-semibold mb-3">Biggest Variance Driver</h2>
            <Link
              href={`/tfc/variance?previousCountId=${topItem.previousCountId}&currentCountId=${topItem.currentCountId}&highlight=${topItem.inventoryItemId}`}
              data-testid="link-top-variance-item"
            >
              <Card className="hover-elevate cursor-pointer">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-red-500/10 shrink-0">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid="text-top-item-name">
                      {topItem.inventoryItemName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Most recent period &middot; over-used vs. theoretical
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p
                        className="text-sm font-semibold text-red-600 dark:text-red-400"
                        data-testid="text-top-item-cost"
                      >
                        +${topItem.varianceCost.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        +{topItem.variancePercent.toFixed(1)}%
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
