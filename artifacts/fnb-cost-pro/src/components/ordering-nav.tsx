import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useStoreContext } from "@/hooks/use-store-context";
import { useTier } from "@/hooks/use-tier";
import { cn } from "@/lib/utils";

const ORDERING_ROUTE_PREFIXES = [
  "/order",
  "/orders",
  "/purchase-orders",
  "/imported-invoices",
  "/vendors",
  "/receiving",
  "/transfer-orders",
  "/order-guide-scan",
  "/order-guides",
] as const;

function pathnameFromLocation(location: string): string {
  return location.split(/[?#]/, 1)[0] || "/";
}

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Returns whether a route belongs to the Ordering section.
 *
 * Keep this list aligned with the section ownership used by the primary rail
 * so the secondary rail cannot disappear when a user opens a detail screen.
 */
export function isOrderingRoute(location: string): boolean {
  const pathname = pathnameFromLocation(location);
  return ORDERING_ROUTE_PREFIXES.some((prefix) => matchesRoutePrefix(pathname, prefix));
}

function isManagerRole(role: string | undefined): boolean {
  return role === "store_manager" || role === "company_admin" || role === "global_admin";
}

function isActiveTab(pathname: string, href: string): boolean {
  if (href === "/order") return pathname === "/order";
  if (href === "/orders") {
    return (
      matchesRoutePrefix(pathname, "/orders") ||
      matchesRoutePrefix(pathname, "/purchase-orders") ||
      matchesRoutePrefix(pathname, "/imported-invoices")
    );
  }
  if (href === "/order-guide-scan") {
    return (
      matchesRoutePrefix(pathname, "/order-guide-scan") ||
      matchesRoutePrefix(pathname, "/order-guides")
    );
  }
  return matchesRoutePrefix(pathname, href);
}

export function OrderingSectionNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { stores } = useStoreContext();
  const { hasFeature } = useTier();

  const pathname = pathnameFromLocation(location);
  const tabs = [
    { label: "Overview", href: "/order" },
    { label: "Orders", href: "/orders" },
    { label: "Vendors", href: "/vendors" },
    ...(isManagerRole(user?.role) ? [{ label: "Receiving", href: "/receiving" }] : []),
    { label: "Update Vendor Prices", href: "/order-guide-scan" },
    ...(stores.length > 1 && hasFeature("transfer_orders")
      ? [{ label: "Transfers", href: "/transfer-orders" }]
      : []),
  ];

  return (
    <nav
      aria-label="Ordering"
      className="shrink-0 border-b bg-muted/20"
      data-testid="order-secondary-tabs"
      data-ordering-nav="true"
    >
      <div className="flex min-w-0 flex-wrap items-center px-3 md:px-6">
        {tabs.map((tab) => {
          const active = isActiveTab(pathname, tab.href);
          const testId = `tab-order-${tab.label.toLowerCase().replace(/\s+/g, "-")}`;

          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "min-w-0 shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors md:px-4",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-testid={testId}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}