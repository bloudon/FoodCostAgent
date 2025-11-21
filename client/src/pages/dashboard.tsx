import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, DollarSign, ClipboardList, ArrowRight, PackageCheck, Truck, TrendingUp, UtensilsCrossed, AlertCircle, Calendar, Clock, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStoreContext } from "@/hooks/use-store-context";

const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", className: string }> = {
  "pending": { 
    variant: "secondary",
    className: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20"
  },
  "ordered": { 
    variant: "secondary",
    className: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20"
  },
  "in_transit": { 
    variant: "secondary",
    className: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20"
  },
  "received": { 
    variant: "secondary",
    className: "bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20"
  },
  "completed": { 
    variant: "secondary",
    className: "bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20"
  },
};

export default function Dashboard() {
  const { selectedStoreId, selectedStore, stores, isLoading: storesLoading } = useStoreContext();

  // Fetch data filtered by selected store using proper query parameters
  // Note: queryKey is joined with "/" so we use query string in the first element
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery<any[]>({
    queryKey: [`/api/inventory-items?store_id=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  // Use server-side filtering for inventory counts by storeId
  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: [`/api/inventory-counts?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  // Purchase Orders - fetch all and filter client-side
  const { data: allPurchaseOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders"],
  });

  // Filter purchase orders by selected store client-side (copy array to avoid mutation)
  const storePurchaseOrdersAll = [...allPurchaseOrders].filter(po => po.storeId === selectedStoreId);

  // Transfer Orders - fetch all
  const { data: allTransferOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/transfer-orders"],
  });

  // Filter transfer orders by selected store (either from or to this store)
  const storeTransferOrders = [...allTransferOrders].filter(
    to => to.fromStoreId === selectedStoreId || to.toStoreId === selectedStoreId
  );

  // Fetch variance summaries for the selected store
  const { data: varianceSummaries = [], isLoading: varianceSummariesLoading } = useQuery<any[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  // Get the most recent variance summary (first in list)
  const recentVariance = varianceSummaries.length > 0 ? varianceSummaries[0] : null;
  
  // Combine purchase orders and transfer orders, then get last 3 for quicklink display
  const recentOrders = [
    ...storePurchaseOrdersAll.map(po => ({ ...po, type: 'purchase' as const })),
    ...storeTransferOrders.map(to => ({ ...to, type: 'transfer' as const }))
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  // Fetch all receipts to calculate actual received values
  const { data: allReceipts = [] } = useQuery<any[]>({
    queryKey: ["/api/receipts"],
  });

  // Create a map of purchase order ID to receipt lines for quick lookup
  const receiptsByPO = new Map<string, any[]>();
  allReceipts.forEach((receipt: any) => {
    if (receipt.status === "completed") {
      const existing = receiptsByPO.get(receipt.purchaseOrderId) || [];
      receiptsByPO.set(receipt.purchaseOrderId, [...existing, receipt]);
    }
  });

  // Fetch menu items filtered by selected store
  const { data: allMenuItems = [], isLoading: menuItemsLoading } = useQuery<any[]>({
    queryKey: [`/api/menu-items?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  // Fetch pending order deadlines
  const { data: orderDeadlines = [], isLoading: deadlinesLoading } = useQuery<any[]>({
    queryKey: [`/api/purchase-orders/deadlines?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  // Fetch estimated on-hand inventory for critical items detection
  const { data: estimatedOnHand = [], isLoading: estimatedLoading } = useQuery<Array<{
    inventoryItemId: string;
    lastCountQty: number;
    lastCountDate: string | null;
    receivedQty: number;
    wasteQty: number;
    theoreticalUsageQty: number;
    transferredOutQty: number;
    estimatedOnHand: number;
  }>>({
    queryKey: ["/api/inventory-items/estimated-on-hand", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId || selectedStoreId === "all") {
        return [];
      }
      const response = await fetch(`/api/inventory-items/estimated-on-hand?storeId=${selectedStoreId}`);
      if (!response.ok) throw new Error("Failed to fetch estimated on-hand data");
      return response.json();
    },
    enabled: !!selectedStoreId && selectedStoreId !== "all",
  });

  // Identify critical inventory items (estimated on-hand below reorder level)
  const criticalItems = useMemo(() => {
    if (!estimatedOnHand || !inventoryItems) return [];
    
    const criticalList: Array<{
      id: string;
      name: string;
      estimatedOnHand: number;
      reorderLevel: number;
      unitAbbreviation: string;
      deficit: number;
    }> = [];

    estimatedOnHand.forEach(est => {
      const item = inventoryItems.find((inv: any) => inv.id === est.inventoryItemId);
      if (item && item.reorderLevel && est.estimatedOnHand < item.reorderLevel) {
        criticalList.push({
          id: item.id,
          name: item.name,
          estimatedOnHand: est.estimatedOnHand,
          reorderLevel: item.reorderLevel,
          unitAbbreviation: item.unit?.abbreviation || item.unit?.name || '',
          deficit: item.reorderLevel - est.estimatedOnHand,
        });
      }
    });

    // Sort by deficit (most critical first)
    return criticalList.sort((a, b) => b.deficit - a.deficit);
  }, [estimatedOnHand, inventoryItems]);
  
  // Get most recent count for this store (already filtered server-side, copy to avoid cache mutation)
  const mostRecentCount = inventoryCounts && inventoryCounts.length > 0
    ? [...inventoryCounts].sort((a, b) => 
        new Date(b.countedAt).getTime() - new Date(a.countedAt).getTime()
      )[0]
    : undefined;

  const { data: recentCountLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", mostRecentCount?.id],
    enabled: !!mostRecentCount,
  });

  // Calculate total $ value of recent inventory count
  const recentCountValue = recentCountLines?.reduce((sum, line) => {
    // Each line has qty and unitCost (snapshot at time of count)
    if (line.qty && line.unitCost !== undefined) {
      return sum + (line.qty * line.unitCost);
    }
    return sum;
  }, 0) || 0;

  // Fetch all count lines for all counts at this store to calculate average inventory value
  const { data: allCountLinesForStore } = useQuery<any[]>({
    queryKey: [`/api/inventory-count-lines?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId && !!inventoryCounts && inventoryCounts.length > 0,
  });

  // Calculate average inventory value across all counts
  const averageInventoryValue = useMemo(() => {
    if (!inventoryCounts || inventoryCounts.length === 0 || !allCountLinesForStore) {
      return 0;
    }

    // Group lines by count ID
    const countValues = new Map<string, number>();
    
    allCountLinesForStore.forEach(line => {
      const currentValue = countValues.get(line.inventoryCountId) || 0;
      if (line.qty && line.unitCost !== undefined) {
        countValues.set(line.inventoryCountId, currentValue + (line.qty * line.unitCost));
      }
    });

    // Calculate average
    const values = Array.from(countValues.values());
    if (values.length === 0) return 0;
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }, [inventoryCounts, allCountLinesForStore]);

  // Helper function to get actual received value for a purchase order from completed receipts
  const getActualReceivedValue = (purchaseOrderId: string): number | null => {
    const completedReceipts = receiptsByPO.get(purchaseOrderId);
    
    if (!completedReceipts || completedReceipts.length === 0) {
      return null; // No completed receipts, show expected value
    }
    
    // Sum up the totalAmount from all completed receipts for this PO
    const total = completedReceipts.reduce((sum: number, receipt: any) => {
      return sum + (receipt.totalAmount || 0);
    }, 0);
    
    return total;
  };

  // Stats filtered by selected store
  const totalItems = inventoryItems?.filter(i => i.active === 1).length || 0;
  const totalCounts = inventoryCounts?.length || 0;
  const totalMenuItems = allMenuItems?.filter(m => m.active === 1).length || 0;

  const stats = [
    {
      title: "Active Items",
      value: itemsLoading ? "..." : totalItems.toString(),
      icon: Package,
      description: "Inventory items at this store",
      link: "/inventory",
    },
    {
      title: "Recent Variance",
      value: varianceSummariesLoading 
        ? "..." 
        : recentVariance 
          ? `$${Math.abs(recentVariance.totalVarianceCost).toFixed(2)}`
          : "No data",
      icon: TrendingUp,
      description: recentVariance 
        ? `${new Date(recentVariance.inventoryDate).toLocaleDateString()}`
        : "Complete inventory counts to view",
      link: recentVariance 
        ? `/tfc/variance?countId=${recentVariance.currentCountId}` 
        : "/tfc/variance",
      variant: recentVariance?.totalVarianceCost 
        ? recentVariance.totalVarianceCost > 0 
          ? "negative" 
          : "positive"
        : undefined,
    },
    {
      title: "Inventory Counts",
      value: countsLoading ? "..." : totalCounts.toString(),
      icon: ClipboardList,
      description: "Count sessions for this store",
      link: "/inventory-sessions",
    },
    {
      title: "Menu Items",
      value: menuItemsLoading ? "..." : totalMenuItems.toString(),
      icon: UtensilsCrossed,
      description: "Active menu items at this store",
      link: "/menu-items",
    },
  ];

  // Loading state while store context initializes
  if (storesLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-12 w-64 mb-8" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  // Empty state for users with no accessible stores
  if (stores.length === 0) {
    return (
      <div className="p-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>No Accessible Stores</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You don't have access to any stores yet. Please contact your administrator to request store access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ensure we have a valid selectedStoreId before rendering dashboard
  if (!selectedStoreId) {
    return null;
  }

  // Full dashboard for admins and managers
  return (
    <div className="p-8">
      {/* Alerts Section: Pending Orders & Critical Inventory (Split 50/50 on desktop) */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Pending Order Deadlines */}
        {!deadlinesLoading && orderDeadlines.length > 0 ? (
            <Card className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 dark:from-blue-950/20 dark:to-slate-950/20 border-blue-200 dark:border-blue-800" data-testid="card-order-deadlines">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <CardTitle className="text-base">Pending Order Deadlines</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[130px] pr-4">
                  <div className="space-y-3">
                    {orderDeadlines.slice(0, 10).map((deadline: any) => {
                const isPastDue = deadline.isPastDue;
                const isUrgent = deadline.isUrgent;
                
                return (
                  <Link key={deadline.purchaseOrderId} href={`/orders/${deadline.purchaseOrderId}`}>
                    <div 
                      className={`flex items-center justify-between gap-4 p-3 rounded-lg border hover-elevate cursor-pointer ${
                        isPastDue 
                          ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800" 
                          : isUrgent 
                            ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800"
                            : "bg-background border-border"
                      }`}
                      data-testid={`deadline-${deadline.purchaseOrderId}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{deadline.vendorName}</span>
                          {deadline.internalOrderId && (
                            <span className="text-xs text-muted-foreground">#{deadline.internalOrderId}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Deadline: {new Date(deadline.orderDeadline).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>Delivery: {new Date(deadline.nextDeliveryDate).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={isPastDue ? "destructive" : isUrgent ? "secondary" : "outline"}
                          className={
                            isPastDue 
                              ? "bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                              : isUrgent 
                                ? "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20"
                                : ""
                          }
                        >
                          {isPastDue 
                            ? "Past Due" 
                            : deadline.daysUntilDeadline === 0 
                              ? "Due Today" 
                              : deadline.daysUntilDeadline === 1 
                                ? "Due Tomorrow"
                                : `${deadline.daysUntilDeadline} days`
                          }
                        </Badge>
                      </div>
                    </div>
                  </Link>
                );
              })}
                  </div>
                </ScrollArea>
                {orderDeadlines.length > 10 && (
                  <div className="mt-3 pt-3 border-t">
                    <Link href="/orders">
                      <Button variant="ghost" size="sm" className="w-full" data-testid="button-view-all-deadlines">
                        View all {orderDeadlines.length} pending orders
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
        ) : (
          <Card className="bg-gradient-to-r from-slate-50/50 to-slate-50/50 dark:from-slate-950/20 dark:to-slate-950/20" data-testid="card-no-deadlines">
            <CardHeader>
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Pending Order Deadlines</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[130px] flex items-center justify-center">
                <p className="text-sm text-muted-foreground text-center">
                  No pending orders with upcoming deadlines
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Critical Inventory Items */}
        {!estimatedLoading && criticalItems.length > 0 ? (
            <Card className="bg-gradient-to-r from-red-50/50 to-slate-50/50 dark:from-red-950/20 dark:to-slate-950/20 border-red-200 dark:border-red-800" data-testid="card-critical-inventory">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <CardTitle className="text-base">Critical Inventory Levels</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[130px] pr-4">
                  <div className="space-y-3">
                    {criticalItems.slice(0, 20).map((item) => {
                      const percentOfReorder = (item.estimatedOnHand / item.reorderLevel) * 100;
                      const isCritical = percentOfReorder < 50;
                      
                      return (
                        <Link key={item.id} href={`/inventory/${item.id}`}>
                          <div 
                            className={`flex items-center justify-between gap-4 p-3 rounded-lg border hover-elevate cursor-pointer ${
                              isCritical 
                                ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800" 
                                : "bg-slate-50 dark:bg-slate-950/30 border-slate-300 dark:border-slate-800"
                            }`}
                            data-testid={`critical-item-${item.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm truncate">{item.name}</span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Package className="h-3 w-3" />
                                  <span>On Hand: {item.estimatedOnHand.toFixed(1)} {item.unitAbbreviation}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span>Reorder: {item.reorderLevel.toFixed(1)} {item.unitAbbreviation}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant={isCritical ? "destructive" : "secondary"}
                                className={
                                  isCritical 
                                    ? "bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                                    : "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20"
                                }
                              >
                                {isCritical ? "Critical" : "Low"} ({percentOfReorder.toFixed(0)}%)
                              </Badge>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </ScrollArea>
                {criticalItems.length > 20 && (
                  <div className="mt-3 pt-3 border-t">
                    <Link href="/inventory">
                      <Button variant="ghost" size="sm" className="w-full" data-testid="button-view-all-critical">
                        View all {criticalItems.length} critical items
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
        ) : (
          <Card className="bg-gradient-to-r from-slate-50/50 to-slate-50/50 dark:from-slate-950/20 dark:to-slate-950/20" data-testid="card-no-critical">
            <CardHeader>
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Critical Inventory Levels</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[130px] flex items-center justify-center">
                <p className="text-sm text-muted-foreground text-center">
                  All inventory levels are healthy
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => {
          const cardContent = (
            <Card 
              data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}
              className={stat.link ? "cursor-pointer hover-elevate" : ""}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${
                  stat.variant === "positive" 
                    ? "text-green-600 dark:text-green-400" 
                    : stat.variant === "negative"
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                }`} />
              </CardHeader>
              <CardContent>
                <div 
                  className={`text-2xl font-bold font-mono ${
                    stat.variant === "positive" 
                      ? "text-green-600 dark:text-green-400" 
                      : stat.variant === "negative"
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                  data-testid={`text-stat-value-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {stat.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          );

          return stat.link ? (
            <Link key={stat.title} href={stat.link}>
              {cardContent}
            </Link>
          ) : (
            <div key={stat.title}>
              {cardContent}
            </div>
          );
        })}
      </div>

      {/* Quicklinks Section */}
      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {/* Recent Inventory */}
        <Card data-testid="card-recent-inventory">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <ClipboardList className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Inventory Value</CardTitle>
              </div>
              <Link href="/inventory-sessions">
                <Button variant="ghost" size="sm" data-testid="button-view-counts">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {countsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : mostRecentCount ? (
              <div className="space-y-4">
                {/* Single clickable line for recent count */}
                <Link href={`/count/${mostRecentCount.id}`}>
                  <div className="cursor-pointer hover-elevate rounded-md p-3 border" data-testid="link-recent-count">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground mb-1">
                          {new Date(mostRecentCount.countDate).toLocaleDateString()} • {recentCountLines?.length || 0} items
                        </p>
                        <p className="text-2xl font-semibold font-mono" data-testid="text-recent-count-value">
                          ${recentCountValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>

                {/* Average inventory value comparison */}
                {inventoryCounts && inventoryCounts.length > 1 && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Average Value</p>
                        <p className="text-sm text-muted-foreground">
                          Across {inventoryCounts.length} counts
                        </p>
                      </div>
                      <p className="text-lg font-semibold font-mono" data-testid="text-average-inventory-value">
                        ${averageInventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    {averageInventoryValue > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">vs Average:</p>
                          <Badge 
                            variant="secondary"
                            className={
                              recentCountValue > averageInventoryValue
                                ? "bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/10 dark:text-green-400"
                                : recentCountValue < averageInventoryValue
                                  ? "bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
                                  : ""
                            }
                            data-testid="badge-inventory-comparison"
                          >
                            {recentCountValue > averageInventoryValue ? "+" : ""}
                            ${(recentCountValue - averageInventoryValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">No counts for this store yet</p>
                <Link href="/inventory-sessions">
                  <Button size="sm" data-testid="button-first-count">
                    Start Count
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card data-testid="card-recent-orders">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <PackageCheck className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Recent Orders</CardTitle>
              </div>
              <Link href="/orders">
                <Button variant="ghost" size="sm" data-testid="button-view-orders">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentOrders.length > 0 ? (
              <div className="space-y-2">
                {recentOrders.map((order: any) => {
                  const isTransfer = order.type === 'transfer';
                  const orderLink = isTransfer 
                    ? `/transfer-orders/${order.id}`
                    : order.status === "pending" 
                      ? `/purchase-orders/${order.id}` 
                      : `/receiving/${order.id}`;
                  
                  return (
                    <Link 
                      key={order.id} 
                      href={orderLink}
                    >
                      <div 
                        className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0 cursor-pointer hover-elevate rounded p-2"
                        data-testid={`row-order-${order.id}`}
                      >
                        <div className="flex-1">
                          <p className="font-medium text-sm" data-testid={`text-order-date-${order.id}`}>
                            {new Date(order.createdAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-order-vendor-${order.id}`}>
                            {isTransfer 
                              ? `${order.fromStoreName} → ${order.toStoreName}` 
                              : order.vendorName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isTransfer ? 'Transfer' : 'Purchase'} #{order.id.slice(0, 8)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge 
                            variant={statusConfig[order.status]?.variant || "secondary"}
                            className={statusConfig[order.status]?.className || ""}
                            data-testid={`badge-order-status-${order.id}`}
                          >
                            {order.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </Badge>
                          {!isTransfer && (() => {
                            const actualValue = getActualReceivedValue(order.id);
                            const displayValue = actualValue !== null ? actualValue : (order.totalAmount || 0);
                            return (
                              <p className="font-medium text-sm font-mono" data-testid={`text-order-total-${order.id}`}>
                                ${displayValue.toFixed(2)}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">No orders for this store yet</p>
                <Link href="/orders">
                  <Button size="sm" data-testid="button-first-order">
                    View Orders
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Inventory</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Link href="/inventory-sessions">
              <Button className="w-full" data-testid="button-new-count-session">
                New Count Session
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Purchase Orders</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Link href="/orders">
              <Button className="w-full" data-testid="button-view-pos">
                View Orders
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Variance Report</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Link href="/variance">
              <Button className="w-full" data-testid="button-view-variance">
                View Report
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
