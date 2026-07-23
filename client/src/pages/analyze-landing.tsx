import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Upload,
  TrendingUp,
  Lightbulb,
  ChevronRight,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VarianceSummary {
  currentCountId: string;
  countName: string;
  countDate: string;
  periodCost: number;
  theoreticalCost: number;
  variancePercent: number | null;
}

// ---------------------------------------------------------------------------
// Secondary tabs
// ---------------------------------------------------------------------------

const TABS = [
  { label: "Overview", href: "/analyze" },
  { label: "Food Cost", href: "/tfc/variance" },
  { label: "Import Sales", href: "/tfc/sales-import" },
  { label: "Menu Insights", href: "/menu-insights" },
  { label: "Variance Report", href: "/variance" },
];

function SecondaryTabs({ activeHref }: { activeHref: string }) {
  return (
    <div
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="analyze-secondary-tabs"
    >
      <div className="flex overflow-x-auto px-4 md:px-6">
        {TABS.map((tab) => {
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

function varianceBadgeClass(pct: number | null): string {
  if (pct == null) return "";
  if (pct > 5) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (pct > 2) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyzeLanding() {
  const [location] = useLocation();

  const { data: summaries = [], isLoading } = useQuery<VarianceSummary[]>({
    queryKey: ["/api/tfc/variance/summaries"],
  });

  const recentSummaries = summaries
    .slice()
    .sort((a, b) => new Date(b.countDate).getTime() - new Date(a.countDate).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      <SecondaryTabs activeHref={location} />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analyze</h1>
          <p className="text-sm text-muted-foreground">
            Track food cost, review variance, and gain menu insights.
          </p>
        </div>

        {/* Primary action grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Food Cost — prominent */}
          <div className="sm:col-span-2 lg:col-span-1">
            <ActionCard
              href="/tfc/variance"
              icon={BarChart3}
              iconBg="bg-accent-button/10"
              iconClass="text-accent-button"
              title="Food Cost Report"
              description="Theoretical vs. actual cost by period"
              prominent
              testId="action-food-cost"
            />
          </div>

          {/* Import Sales */}
          <ActionCard
            href="/tfc/sales-import"
            icon={Upload}
            iconBg="bg-blue-500/10"
            iconClass="text-blue-600 dark:text-blue-400"
            title="Import Sales"
            description="Upload POS sales data to calculate TFC"
            testId="action-import-sales"
          />

          {/* Menu Insights */}
          <ActionCard
            href="/menu-insights"
            icon={Lightbulb}
            iconBg="bg-yellow-500/10"
            iconClass="text-yellow-600 dark:text-yellow-400"
            title="Menu Insights"
            description="Identify high-margin and low-margin dishes"
            testId="action-menu-insights"
          />

          {/* Variance Report — full width */}
          <div className="sm:col-span-2 lg:col-span-3">
            <ActionCard
              href="/variance"
              icon={TrendingUp}
              iconBg="bg-green-500/10"
              iconClass="text-green-600 dark:text-green-400"
              title="Variance Report"
              description="Detailed item-level variance between expected and actual usage"
              horizontal
              testId="action-variance-report"
            />
          </div>
        </div>

        {/* Recent variance summaries */}
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
                No variance data yet. Import sales to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentSummaries.map((s) => (
                <Link
                  key={s.currentCountId}
                  href="/tfc/variance"
                  data-testid={`analyze-row-${s.currentCountId}`}
                >
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-md hover-elevate">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.countName}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.countDate
                            ? format(new Date(s.countDate), "MMM d, yyyy")
                            : "—"}
                          {" · "}Actual: ${s.periodCost.toFixed(0)}
                        </p>
                      </div>
                    </div>
                    {s.variancePercent != null && (
                      <Badge
                        variant="secondary"
                        className={cn("text-xs shrink-0 ml-2", varianceBadgeClass(s.variancePercent))}
                        data-testid={`badge-variance-${s.currentCountId}`}
                      >
                        {s.variancePercent > 0 ? "+" : ""}
                        {s.variancePercent.toFixed(1)}%
                      </Badge>
                    )}
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
