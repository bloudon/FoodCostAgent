import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ShoppingCart,
  PackageCheck,
  ScanLine,
  ArrowLeftRight,
  Plus,
  ChevronRight,
  Package,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface PurchaseOrder {
  id: string;
  vendorName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
  lineCount: number;
  totalAmount: number;
  storeId: string | null;
}

interface Vendor {
  id: string;
  name: string;
  active: number;
}

// ---------------------------------------------------------------------------
// Secondary tabs
// ---------------------------------------------------------------------------

function SecondaryTabs({
  activeHref,
  showReceiving,
  showTransfers,
}: {
  activeHref: string;
  showReceiving: boolean;
  showTransfers: boolean;
}) {
  const tabs = [
    { label: "Overview", href: "/order" },
    { label: "Orders", href: "/orders" },
    { label: "Vendors", href: "/vendors" },
    ...(showReceiving ? [{ label: "Receiving", href: "/orders" }] : []),
    { label: "Update Vendor Prices", href: "/order-guide-scan" },
    ...(showTransfers ? [{ label: "Transfers", href: "/transfer-orders" }] : []),
  ];

  // De-duplicate hrefs that appear more than once (Receiving + Purchase Orders share the same path)
  const seen = new Set<string>();
  const dedupedTabs = tabs.filter((t) => {
    if (seen.has(t.href + t.label)) return false;
    seen.add(t.href + t.label);
    return true;
  });

  return (
    <div
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="order-secondary-tabs"
    >
      <div className="flex overflow-x-auto px-4 md:px-6">
        {dedupedTabs.map((tab) => {
          const isActive =
            tab.href === "/order"
              ? activeHref === "/order"
              : activeHref.startsWith(tab.href);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={cn(
                "flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-testid={`tab-order-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
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
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  ordered: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  received: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  exported: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Pending",
    ordered: "Ordered",
    received: "Received",
    exported: "Exported",
  };
  return labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OrderLanding() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { stores, selectedStoreId } = useStoreContext();
  const { hasFeature } = useTier();

  const role = user?.role ?? "store_user";
  const isManager =
    role === "store_manager" || role === "company_admin" || role === "global_admin";
  const hasMultipleStores = stores.length > 1;
  const showReceiving = isManager;
  const showTransfers = hasMultipleStores && hasFeature("transfer_orders");

  const isAllStores = !selectedStoreId || selectedStoreId === "all";
  const ordersUrl = isAllStores
    ? "/api/purchase-orders"
    : `/api/purchase-orders?storeId=${selectedStoreId}`;

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: [ordersUrl],
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const activeVendorCount = vendors.filter((v) => v.active === 1).length;

  // Most-recent pending PO for the banner
  const pendingOrders = orders
    .filter((o) => o.status === "pending" || o.status === "ordered")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const topPending = pendingOrders[0] ?? null;

  const recentOrders = orders
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      <SecondaryTabs
        activeHref={location}
        showReceiving={showReceiving}
        showTransfers={showTransfers}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Order</h1>
          <p className="text-sm text-muted-foreground">
            Build orders, receive deliveries, and manage vendor prices.
            {activeVendorCount > 0 && (
              <> &nbsp;·&nbsp; <Link href="/vendors" className="hover:underline">{activeVendorCount} active vendor{activeVendorCount !== 1 ? "s" : ""}</Link></>
            )}
          </p>
        </div>

        {/* Pending order banner — links directly to the pending PO */}
        {topPending && (
          <Card
            className="border-primary/20 bg-primary/5"
            data-testid="order-pending-banner"
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{topPending.vendorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {topPending.status === "ordered" ? "Order placed" : "Draft order"}
                    &nbsp;·&nbsp;
                    {topPending.lineCount} item{topPending.lineCount !== 1 ? "s" : ""}
                    {pendingOrders.length > 1 &&
                      ` · ${pendingOrders.length} open orders`}
                    {isAllStores && topPending.storeId && (() => {
                      const name = stores.find((s) => s.id === topPending.storeId)?.name;
                      return name ? <>&nbsp;·&nbsp;{name}</> : null;
                    })()}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" data-testid="button-view-pending-order">
                <Link href={`/purchase-orders/${topPending.id}`}>View Order</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Primary action grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Build Order — prominent */}
          <div className="sm:col-span-2 lg:col-span-1">
            <ActionCard
              href="/orders"
              icon={Plus}
              iconBg="bg-accent-button/10"
              iconClass="text-accent-button"
              title="Build Order"
              description="Create a new order from your vendor catalog"
              prominent
              testId="action-build-order"
            />
          </div>

          {/* Receive Delivery */}
          <ActionCard
            href="/orders"
            icon={PackageCheck}
            iconBg="bg-green-500/10"
            iconClass="text-green-600 dark:text-green-400"
            title="Receive Delivery"
            description="Check in arriving goods against a purchase order"
            testId="action-receive-delivery"
          />

          {/* Update Vendor Prices */}
          <ActionCard
            href="/order-guide-scan"
            icon={ScanLine}
            iconBg="bg-blue-500/10"
            iconClass="text-blue-600 dark:text-blue-400"
            title="Update Vendor Prices"
            description="Scan or upload an order guide to refresh pricing"
            testId="action-update-prices"
          />

          {/* Vendors — full width */}
          <div className="sm:col-span-2 lg:col-span-3">
            <ActionCard
              href="/vendors"
              icon={ShoppingCart}
              iconBg="bg-violet-500/10"
              iconClass="text-violet-600 dark:text-violet-400"
              title="Manage Vendors"
              description="View vendors, assign stores, and manage order guides"
              horizontal
              testId="action-manage-vendors"
            />
          </div>

          {/* Transfer Orders — only shown when multi-store + feature enabled */}
          {showTransfers && (
            <div className="sm:col-span-2 lg:col-span-3">
              <ActionCard
                href="/transfer-orders"
                icon={ArrowLeftRight}
                iconBg="bg-orange-500/10"
                iconClass="text-orange-600 dark:text-orange-400"
                title="Transfer Orders"
                description="Move inventory between store locations"
                horizontal
                testId="action-transfer-orders"
              />
            </div>
          )}
        </div>

        {/* Recent purchase orders */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              {isAllStores ? "Recent Orders" : "Recent Orders — This Store"}
            </h2>
            <Link
              href="/orders"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-view-all-orders"
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
          ) : recentOrders.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 text-center gap-2"
              data-testid="order-empty-state"
            >
              <Package className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No orders yet. Build your first order above.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentOrders.map((order) => {
                const storeName = isAllStores && order.storeId
                  ? stores.find((s) => s.id === order.storeId)?.name
                  : undefined;
                return (
                  <Link
                    key={order.id}
                    href={`/purchase-orders/${order.id}`}
                    data-testid={`order-row-${order.id}`}
                  >
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-md hover-elevate">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-medium truncate">{order.vendorName}</p>
                            {storeName && (
                              <Badge
                                variant="secondary"
                                className="text-xs shrink-0 font-normal"
                                data-testid={`badge-order-store-${order.id}`}
                              >
                                {storeName}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {order.createdAt
                              ? format(new Date(order.createdAt), "MMM d, yyyy")
                              : "—"}
                            {" · "}
                            {order.lineCount} item{order.lineCount !== 1 ? "s" : ""}
                            {" · "}${order.totalAmount.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn("text-xs shrink-0 ml-2", STATUS_COLORS[order.status] ?? "")}
                        data-testid={`badge-order-status-${order.id}`}
                      >
                        {statusLabel(order.status)}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
