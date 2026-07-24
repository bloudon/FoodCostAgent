import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  ArrowRight,
  Clock,
  Package,
  AlertTriangle,
  Calendar,
  PackageCheck,
  FileText,
  Receipt,
  X,
  PartyPopper,
  Copy,
  Check,
} from "lucide-react";
import { SetupMilestoneTracker } from "@/components/setup-milestone-tracker";
import { useStoreContext } from "@/hooks/use-store-context";
import { useAuth } from "@/lib/auth-context";
import { parseCountDate } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";

export default function Dashboard() {
  const { selectedStoreId, selectedStore, stores, isLoading: storesLoading } = useStoreContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const search = useSearch();
  const isWelcome = search.includes("welcome=true");

  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => sessionStorage.getItem("fnb_welcomed") === "true"
  );
  const [reorderCopied, setReorderCopied] = useState(false);

  const dismissWelcome = () => {
    sessionStorage.setItem("fnb_welcomed", "true");
    setWelcomeDismissed(true);
    window.history.replaceState({}, "", "/");
  };

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: [`/api/inventory-counts?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  const { data: varianceSummaries = [] } = useQuery<any[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  const { data: topVarianceItem = null } = useQuery<{
    inventoryItemId: string;
    inventoryItemName: string;
    varianceCost: number;
    variancePercent: number;
    currentCountId: string;
    previousCountId: string;
  } | null>({
    queryKey: [`/api/tfc/variance/top-item?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  const { data: allPurchaseOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: allTransferOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/transfer-orders"],
  });

  const { data: allReceipts = [] } = useQuery<any[]>({
    queryKey: ["/api/receipts"],
  });

  const { data: orderDeadlines = [] } = useQuery<any[]>({
    queryKey: [`/api/purchase-orders/deadlines?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  const { data: recipesWithMissing = [] } = useQuery<Array<{ id: string; name: string; missingComponentNames: string[] }>>({
    queryKey: ["/api/recipes/missing-ingredients"],
  });

  const { data: reorderData } = useQuery<{
    items: Array<{
      id: string;
      name: string;
      parLevel: number;
      reorderLevel: number | null;
      onHand: number;
      qtyToOrder: number;
      unitAbbreviation: string;
      vendorName: string | null;
    }>;
    hasParLevels: boolean;
  }>({
    queryKey: ["/api/dashboard/reorder-list", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId || selectedStoreId === "all") return { items: [], hasParLevels: false };
      const res = await fetch(`/api/dashboard/reorder-list?storeId=${selectedStoreId}`);
      if (!res.ok) return { items: [], hasParLevels: false };
      return res.json();
    },
    enabled: !!selectedStoreId && selectedStoreId !== "all",
  });

  const { data: stalePriceData } = useQuery<{ staleCount: number; thresholdDays: number }>({
    queryKey: ["/api/dashboard/stale-vendor-prices"],
  });

  // ── Derived values ─────────────────────────────────────────────────────────

  const storePurchaseOrders = useMemo(
    () => [...allPurchaseOrders].filter((po) => po.storeId === selectedStoreId),
    [allPurchaseOrders, selectedStoreId]
  );

  const recentVariance = varianceSummaries.length > 0 ? varianceSummaries[0] : null;

  const mostRecentCount = useMemo(() => {
    if (!inventoryCounts || inventoryCounts.length === 0) return undefined;
    return [...inventoryCounts].sort(
      (a, b) => new Date(b.countedAt).getTime() - new Date(a.countedAt).getTime()
    )[0];
  }, [inventoryCounts]);

  const { data: recentCountLines, isLoading: countLinesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", mostRecentCount?.id],
    enabled: !!mostRecentCount,
  });

  const recentCountValue = useMemo(
    () =>
      recentCountLines?.reduce((sum, line) => {
        if (line.qty && line.unitCost !== undefined) return sum + line.qty * line.unitCost;
        return sum;
      }, 0) ?? 0,
    [recentCountLines]
  );

  // Open Orders: active POs (exclude received/cancelled/completed)
  const CLOSED_STATUSES = new Set(["received", "cancelled", "completed"]);
  const openOrders = useMemo(
    () => storePurchaseOrders.filter((po) => !CLOSED_STATUSES.has(po.status)),
    [storePurchaseOrders]
  );
  const openOrdersValue = useMemo(
    () => openOrders.reduce((sum, po) => sum + (po.totalAmount || 0), 0),
    [openOrders]
  );

  // Days since last count
  const daysSinceLastCount = useMemo(() => {
    if (!mostRecentCount) return null;
    const countDate = parseCountDate(mostRecentCount.countDate);
    return differenceInDays(new Date(), countDate);
  }, [mostRecentCount]);

  // ── Needs Attention rows ──────────────────────────────────────────────────

  const needsAttentionRows = useMemo(() => {
    const rows: Array<{
      key: string;
      icon: React.ReactNode;
      label: string;
      href: string;
    }> = [];

    // 0. Overdue order deadlines (past due, status still pending)
    const overdueDeadlines = orderDeadlines.filter((d: any) => d.isPastDue);
    overdueDeadlines.slice(0, 3).forEach((d: any) => {
      const poId = d.purchaseOrderId ?? d.id;
      rows.push({
        key: `overdue-${poId}`,
        icon: <Clock className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0" />,
        label: `Overdue: ${d.vendorName || "Order"} — deadline ${format(new Date(d.orderDeadline), "MMM d")}`,
        href: `/purchase-orders/${poId}`,
      });
    });

    // 1. Order deadlines due within 48 h
    const urgentDeadlines = orderDeadlines.filter((d: any) => {
      if (!d.orderDeadline) return false;
      const hoursUntil = (new Date(d.orderDeadline).getTime() - Date.now()) / 36e5;
      return hoursUntil >= 0 && hoursUntil <= 48;
    });
    if (urgentDeadlines.length > 0) {
      urgentDeadlines.slice(0, 2).forEach((d: any) => {
        const poId = d.purchaseOrderId ?? d.id;
        rows.push({
          key: `deadline-${poId}`,
          icon: <Clock className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0" />,
          label: `${d.vendorName || "Order"} due ${format(new Date(d.orderDeadline), "MMM d")}`,
          href: `/purchase-orders/${poId}`,
        });
      });
    }

    // 2. Below-par items (single summary row)
    const belowParCount = reorderData?.items?.length ?? 0;
    if (belowParCount > 0) {
      rows.push({
        key: "below-par",
        icon: <Package className="h-4 w-4 text-orange-500 dark:text-orange-400 shrink-0" />,
        label: `${belowParCount} item${belowParCount !== 1 ? "s" : ""} below par level`,
        href: "/inventory-items/par-levels",
      });
    }

    // 3. Missing recipe ingredients (single summary row)
    if (recipesWithMissing.length > 0) {
      rows.push({
        key: "missing-ingredients",
        icon: <AlertTriangle className="h-4 w-4 text-yellow-500 dark:text-yellow-400 shrink-0" />,
        label: `${recipesWithMissing.length} recipe${recipesWithMissing.length !== 1 ? "s" : ""} missing ingredients`,
        href: "/recipes",
      });
    }

    // 4. Stale vendor prices (> 90 days without a price update)
    const staleVendorCount = stalePriceData?.staleCount ?? 0;
    if (staleVendorCount > 0) {
      rows.push({
        key: "stale-vendor-prices",
        icon: <AlertTriangle className="h-4 w-4 text-yellow-500 dark:text-yellow-400 shrink-0" />,
        label: `${staleVendorCount} vendor price${staleVendorCount !== 1 ? "s" : ""} may be outdated`,
        href: "/vendors",
      });
    }

    // 5. Overdue count (> 14 days since last applied count)
    if (daysSinceLastCount !== null && daysSinceLastCount > 14) {
      rows.push({
        key: "overdue-count",
        icon: <Calendar className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />,
        label: `Last count was ${daysSinceLastCount} days ago`,
        href: "/inventory-sessions",
      });
    } else if (daysSinceLastCount === null) {
      rows.push({
        key: "no-count",
        icon: <Calendar className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />,
        label: "No inventory counts yet",
        href: "/inventory-sessions",
      });
    }

    return rows.slice(0, 5);
  }, [orderDeadlines, reorderData, recipesWithMissing, daysSinceLastCount, stalePriceData]);

  // ── Recent Activity events ─────────────────────────────────────────────────

  const recentActivityEvents = useMemo(() => {
    const storePOIds = new Set(storePurchaseOrders.map((po) => po.id));

    const countEvents = (inventoryCounts ?? []).map((c: any) => ({
      key: `count-${c.id}`,
      icon: <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
      label: "Count applied",
      detail: parseCountDate(c.countDate).toLocaleDateString(),
      timestamp: new Date(c.countedAt).getTime(),
      href: `/count/${c.id}`,
    }));

    const receiptEvents = allReceipts
      .filter((r: any) => r.status === "completed" && storePOIds.has(r.purchaseOrderId))
      .map((r: any) => ({
        key: `receipt-${r.id}`,
        icon: <Receipt className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
        label: "Invoice received",
        detail: r.vendorName || "",
        timestamp: new Date(r.createdAt || r.receivedAt).getTime(),
        href: `/receiving/${r.purchaseOrderId}`,
      }));

    const orderEvents = storePurchaseOrders.map((po: any) => ({
      key: `order-${po.id}`,
      icon: <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
      label: "Order created",
      detail: po.vendorName || "",
      timestamp: new Date(po.createdAt).getTime(),
      href: `/purchase-orders/${po.id}`,
    }));

    return [...countEvents, ...receiptEvents, ...orderEvents]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [inventoryCounts, allReceipts, storePurchaseOrders]);

  // ── Upcoming orders (from deadlines, sorted by deadline asc) ──────────────

  const upcomingOrders = useMemo(
    () =>
      [...orderDeadlines]
        .filter((d: any) => d.orderDeadline && new Date(d.orderDeadline) >= new Date())
        .sort((a: any, b: any) => new Date(a.orderDeadline).getTime() - new Date(b.orderDeadline).getTime())
        .slice(0, 3),
    [orderDeadlines]
  );

  // ── Copy reorder list ─────────────────────────────────────────────────────

  const copyReorderList = () => {
    const items = reorderData?.items ?? [];
    const lines = items.map(
      (i) => `${i.vendorName ?? "No Vendor"} — ${i.name} — ${i.qtyToOrder.toFixed(1)} ${i.unitAbbreviation}`
    );
    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => {
        setReorderCopied(true);
        setTimeout(() => setReorderCopied(false), 2000);
      })
      .catch(() => {
        toast({ title: "Copy failed", description: "Could not access clipboard.", variant: "destructive" });
      });
  };

  // ── Loading / empty states ─────────────────────────────────────────────────

  if (storesLoading) {
    return (
      <div className="p-4 sm:p-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (stores.length === 0 || !selectedStoreId) {
    return (
      <div className="p-4 sm:p-6">
        <SetupMilestoneTracker />
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>No Accessible Stores</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Create your first store using the setup guide above to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = format(new Date(), "EEEE, MMMM d");
  const inventoryValueLoading = countsLoading || (!!mostRecentCount && countLinesLoading);

  return (
    <div className="p-4 sm:p-6">

      {/* Welcome banner */}
      {isWelcome && !welcomeDismissed && (
        <Card className="mb-6 border-accent/30 bg-gradient-to-r from-accent/5 to-transparent" data-testid="welcome-banner">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <PartyPopper className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f2690d" }} />
                <div className="min-w-0">
                  <p className="font-semibold text-base mb-1">
                    Welcome to FNB Cost Pro{user?.firstName ? `, ${user.firstName}` : ""}!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    You've set up {stores.length} location{stores.length !== 1 ? "s" : ""} — great start.
                    Follow the Getting Started guide below to finish configuring your account.
                  </p>
                  <Button size="sm" className="mt-3" onClick={dismissWelcome} data-testid="button-welcome-got-it">
                    Got it, let's go
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={dismissWelcome}
                aria-label="Dismiss welcome"
                data-testid="button-welcome-dismiss"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <SetupMilestoneTracker />

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="heading-home">Home</h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-store-date">
            {selectedStore?.name} &middot; {today}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/inventory-sessions">
            <Button
              style={{ backgroundColor: "#f2690d", borderColor: "#f2690d", color: "#fff" }}
              data-testid="button-start-count"
            >
              <ClipboardList className="h-4 w-4 mr-1.5" />
              Start Count
            </Button>
          </Link>
          <Link href="/orders">
            <Button variant="outline" data-testid="button-new-order">
              <ShoppingCart className="h-4 w-4 mr-1.5" />
              New Order
            </Button>
          </Link>
          <Link href="/receiving">
            <Button variant="outline" data-testid="button-receive-order">
              <PackageCheck className="h-4 w-4 mr-1.5" />
              Receive Order
            </Button>
          </Link>
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Inventory Value */}
        <Link href="/inventory-sessions">
          <Card className="cursor-pointer hover-elevate" data-testid="card-kpi-inventory-value">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Inventory Value
                </span>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              {inventoryValueLoading ? (
                <Skeleton className="h-7 w-24 mb-1" />
              ) : mostRecentCount ? (
                <>
                  <p className="text-2xl font-bold font-mono" data-testid="text-kpi-inventory-value">
                    ${recentCountValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    as of {parseCountDate(mostRecentCount.countDate).toLocaleDateString()}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-muted-foreground" data-testid="text-kpi-inventory-value">—</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No counts yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Last Variance */}
        <Link href={recentVariance ? `/tfc/variance?countId=${recentVariance.currentCountId}` : "/tfc/variance"}>
          <Card className="cursor-pointer hover-elevate" data-testid="card-kpi-last-variance">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Last Variance
                </span>
                <TrendingUp className={`h-4 w-4 ${
                  recentVariance?.totalVarianceCost > 0
                    ? "text-red-500 dark:text-red-400"
                    : recentVariance?.totalVarianceCost < 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground"
                }`} />
              </div>
              {recentVariance ? (
                <>
                  <p
                    className={`text-2xl font-bold font-mono ${
                      recentVariance.totalVarianceCost > 0
                        ? "text-red-600 dark:text-red-400"
                        : recentVariance.totalVarianceCost < 0
                          ? "text-green-600 dark:text-green-400"
                          : ""
                    }`}
                    data-testid="text-kpi-last-variance"
                  >
                    {recentVariance.totalVarianceCost >= 0 ? "+" : ""}${Math.abs(recentVariance.totalVarianceCost).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {recentVariance.variancePercent != null
                      ? `${recentVariance.variancePercent >= 0 ? "+" : ""}${recentVariance.variancePercent.toFixed(1)}% · `
                      : ""}
                    {new Date(recentVariance.inventoryDate).toLocaleDateString()}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-muted-foreground" data-testid="text-kpi-last-variance">—</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No variance data</p>
                </>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Open Orders */}
        <Link href="/orders">
          <Card className="cursor-pointer hover-elevate" data-testid="card-kpi-open-orders">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Open Orders
                </span>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold font-mono" data-testid="text-kpi-open-orders">
                {openOrders.length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {openOrders.length > 0 && openOrdersValue > 0
                  ? `$${openOrdersValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending`
                  : "Active purchase orders"}
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Last Count */}
        <Link href="/inventory-sessions">
          <Card className="cursor-pointer hover-elevate" data-testid="card-kpi-last-count">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Last Count
                </span>
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
              </div>
              {countsLoading ? (
                <Skeleton className="h-7 w-24 mb-1" />
              ) : mostRecentCount ? (
                <>
                  <p className="text-lg font-bold" data-testid="text-kpi-last-count">
                    {parseCountDate(mostRecentCount.countDate).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {daysSinceLastCount === 0
                      ? "Today"
                      : daysSinceLastCount === 1
                        ? "Yesterday"
                        : `${daysSinceLastCount} days ago`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-muted-foreground" data-testid="text-kpi-last-count">—</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No counts yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Main two-column area ─────────────────────────────────────────── */}
      {/* Desktop: left=exception cards (NA, CW), right=flow cards (RA, UO)  */}
      {/* Mobile: NA → CW → UO → RA (controlled via order-*)                 */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">

        {/* Needs Attention — left col / row 1 — mobile order 1 */}
        <div className="order-1 lg:col-start-1 lg:row-start-1">
          {needsAttentionRows.length > 0 ? (
            <Card data-testid="card-needs-attention">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <CardTitle className="text-base">Needs Attention</CardTitle>
                  <Badge variant="secondary" data-testid="badge-needs-attention-count">
                    {needsAttentionRows.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="space-y-1" data-testid="list-needs-attention">
                  {needsAttentionRows.map((row) => (
                    <Link key={row.key} href={row.href}>
                      <div
                        className="flex items-center gap-3 px-3 py-2.5 rounded-md hover-elevate cursor-pointer border border-transparent hover:border-border"
                        data-testid={`row-attention-${row.key}`}
                      >
                        {row.icon}
                        <span className="text-sm flex-1 min-w-0 truncate">{row.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t">
                  <Link href="/orders">
                    <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" data-testid="button-needs-attention-view-all">
                      View All
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Cost Watch — left col / row 2 — mobile order 2 */}
        <Card data-testid="card-cost-watch" className="order-2 lg:col-start-1 lg:row-start-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cost Watch</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-1">
              {/* Top variance item */}
              {topVarianceItem && (
                <Link
                  href={`/tfc/variance?previousCountId=${topVarianceItem.previousCountId}&currentCountId=${topVarianceItem.currentCountId}&highlight=${topVarianceItem.inventoryItemId}`}
                  data-testid="link-top-variance-item"
                >
                  <div
                    className="flex items-center gap-3 px-2 py-2.5 rounded-md hover-elevate cursor-pointer"
                    data-testid="row-top-variance-item"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">Biggest variance driver</p>
                      <p className="text-sm font-medium truncate" data-testid="text-top-item-name">
                        {topVarianceItem.inventoryItemName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400" data-testid="text-top-item-cost">
                        +${topVarianceItem.varianceCost.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        +{topVarianceItem.variancePercent.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </Link>
              )}

              {/* Below-par summary */}
              {(reorderData?.items?.length ?? 0) > 0 && (
                <div
                  className="flex items-center gap-3 px-2 py-2.5 rounded-md border"
                  data-testid="row-below-par-summary"
                >
                  <Package className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {reorderData!.items.length} item{reorderData!.items.length !== 1 ? "s" : ""} to order
                    </p>
                    <p className="text-xs text-muted-foreground">Below par level</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyReorderList}
                      data-testid="button-copy-reorder-list"
                      title="Copy reorder list"
                    >
                      {reorderCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                    <Link href="/inventory-items/par-levels">
                      <Button variant="ghost" size="icon" data-testid="button-view-par-levels">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}

              {!topVarianceItem && (reorderData?.items?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No cost alerts at this time
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Orders — right col / row 2 — mobile order 3 */}
        <Card data-testid="card-upcoming-orders" className="order-3 lg:col-start-2 lg:row-start-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base">Upcoming Orders</CardTitle>
              <Link href="/orders">
                <Button variant="ghost" size="icon" data-testid="button-view-all-orders">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            {upcomingOrders.length > 0 ? (
              <div className="space-y-0.5" data-testid="list-upcoming-orders">
                {upcomingOrders.map((d: any) => (
                  <Link key={d.purchaseOrderId ?? d.id} href={`/purchase-orders/${d.purchaseOrderId ?? d.id}`}>
                    <div
                      className="flex items-center gap-3 px-2 py-2 rounded-md hover-elevate cursor-pointer"
                      data-testid={`row-upcoming-${d.purchaseOrderId ?? d.id}`}
                    >
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.vendorName || "Order"}</p>
                        <p className="text-xs text-muted-foreground">
                          Order by {format(new Date(d.orderDeadline), "MMM d")}
                          {d.deliveryDate ? ` · Delivery ${format(new Date(d.deliveryDate), "MMM d")}` : ""}
                        </p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No upcoming deadlines</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity — right col / row 1 — mobile order 4 */}
        <Card data-testid="card-recent-activity" className="order-4 lg:col-start-2 lg:row-start-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {recentActivityEvents.length > 0 ? (
              <div className="space-y-0.5" data-testid="list-recent-activity">
                {recentActivityEvents.map((event) => (
                  <Link key={event.key} href={event.href}>
                    <div
                      className="flex items-center gap-3 px-2 py-2 rounded-md hover-elevate cursor-pointer"
                      data-testid={`row-activity-${event.key}`}
                    >
                      {event.icon}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{event.label}</p>
                        {event.detail && (
                          <p className="text-xs text-muted-foreground truncate">{event.detail}</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {formatRelativeTime(event.timestamp)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
