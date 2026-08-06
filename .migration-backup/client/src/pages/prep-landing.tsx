import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ChefHat,
  ClipboardList,
  Factory,
  LayoutGrid,
  Plus,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TierGate } from "@/components/tier-gate";
import { useTier } from "@/hooks/use-tier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrepItem {
  id: string;
  name: string;
  targetQty: number | null;
  unitName?: string | null;
}

// ---------------------------------------------------------------------------
// Secondary tabs
// ---------------------------------------------------------------------------

const TABS = [
  { label: "Overview", href: "/prep" },
  { label: "Prep Today", href: "/prep-chart" },
  { label: "Prep Items", href: "/prep-chart/items" },
  { label: "Production Log", href: "/prep-chart/production" },
  { label: "Stations", href: "/prep-chart/stations" },
];

function SecondaryTabs({ activeHref }: { activeHref: string }) {
  return (
    <div
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="prep-secondary-tabs"
    >
      <div className="flex overflow-x-auto px-4 md:px-6">
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/prep"
              ? activeHref === "/prep"
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
              data-testid={`tab-prep-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
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
// Main page (inner — rendered only when feature is available)
// ---------------------------------------------------------------------------

function PrepLandingContent() {
  const [location] = useLocation();

  const { data: prepItems = [], isLoading } = useQuery<PrepItem[]>({
    queryKey: ["/api/prep-items"],
  });

  // Switch dominant action based on whether prep items have been configured
  const hasItems = !isLoading && prepItems.length > 0;

  const recentItems = prepItems.slice(0, 6);

  return (
    <div className="flex flex-col h-full">
      <SecondaryTabs activeHref={location} />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prep</h1>
          <p className="text-sm text-muted-foreground">
            Run prep lists, log production, and manage stations.
          </p>
        </div>

        {/* Primary action grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Dominant action: "Set Up Prep Items" (zero-state) vs "Prep Today" (configured) */}
          <div className="sm:col-span-2 lg:col-span-1">
            {hasItems ? (
              <ActionCard
                href="/prep-chart"
                icon={ChefHat}
                iconBg="bg-accent-button/10"
                iconClass="text-accent-button"
                title="Prep Today"
                description="View today's prep list and target quantities"
                prominent
                testId="action-prep-today"
              />
            ) : (
              <ActionCard
                href="/prep-chart/items"
                icon={Settings2}
                iconBg="bg-accent-button/10"
                iconClass="text-accent-button"
                title="Set Up Prep Items"
                description="Add the recipes and batches your team prepares regularly."
                prominent
                testId="action-setup-prep-items"
              />
            )}
          </div>

          {/* Prep Items */}
          <ActionCard
            href="/prep-chart/items"
            icon={ClipboardList}
            iconBg="bg-blue-500/10"
            iconClass="text-blue-600 dark:text-blue-400"
            title="Prep Items"
            description="Manage your prep item catalog and targets"
            testId="action-prep-items"
          />

          {/* Log Production */}
          <ActionCard
            href="/prep-chart/production"
            icon={Factory}
            iconBg="bg-green-500/10"
            iconClass="text-green-600 dark:text-green-400"
            title="Log Production"
            description="Record completed batch quantities"
            testId="action-log-production"
          />

          {/* Stations — full width */}
          <div className="sm:col-span-2 lg:col-span-3">
            <ActionCard
              href="/prep-chart/stations"
              icon={LayoutGrid}
              iconBg="bg-violet-500/10"
              iconClass="text-violet-600 dark:text-violet-400"
              title="Stations"
              description="Organize prep items by kitchen station"
              horizontal
              testId="action-stations"
            />
          </div>
        </div>

        {/* Prep items list — only when items exist */}
        {(isLoading || hasItems) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Prep Items</h2>
              <Link
                href="/prep-chart/items"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-view-all-prep-items"
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
            ) : (
              <div className="space-y-1">
                {recentItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/prep-chart/items/${item.id}`}
                    data-testid={`prep-item-row-${item.id}`}
                  >
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-md hover-elevate">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ChefHat className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="text-sm font-medium truncate">{item.name}</p>
                      </div>
                      {item.targetQty != null && (
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          Target: {item.targetQty}
                          {item.unitName ? ` ${item.unitName}` : ""}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Zero-state helper text — only when items not yet configured */}
        {!isLoading && !hasItems && (
          <div
            className="flex flex-col items-center justify-center py-8 text-center gap-2"
            data-testid="prep-empty-state"
          >
            <Plus className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              No prep items configured yet.
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Add the recipes and batches your team prepares regularly to unlock the prep chart.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported page — gated by prep_chart feature tier
// ---------------------------------------------------------------------------

export default function PrepLanding() {
  const { hasFeature } = useTier();

  if (!hasFeature("prep_chart")) {
    return (
      <div className="flex flex-col h-full">
        <TierGate feature="prep_chart">
          <PrepLandingContent />
        </TierGate>
      </div>
    );
  }

  return <PrepLandingContent />;
}
