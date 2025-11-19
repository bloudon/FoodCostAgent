import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, DollarSign, ClipboardList, ArrowRight, PackageCheck, Truck, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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

  // Fetch variance summaries for the selected store
  const { data: varianceSummaries = [], isLoading: varianceSummariesLoading } = useQuery<any[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: !!selectedStoreId,
  });

  // Get the most recent variance summary (first in list)
  const recentVariance = varianceSummaries.length > 0 ? varianceSummaries[0] : null;
  
  // Get last 3 purchase orders for quicklink display
  const storePurchaseOrdersRecent = [...storePurchaseOrdersAll]
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
  const totalOrders = storePurchaseOrdersAll.length;

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
      link: "/variance",
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
      title: "Recent Orders",
      value: totalOrders.toString(),
      icon: PackageCheck,
      description: "Last 3 purchase orders",
      link: "/orders",
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
                <CardTitle>Recent Inventory</CardTitle>
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
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : mostRecentCount ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium font-mono text-sm" data-testid="text-recent-count-date">
                      {new Date(mostRecentCount.countDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Items</p>
                    <p className="font-medium font-mono text-sm" data-testid="text-recent-count-items">
                      {recentCountLines?.length || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="font-medium font-mono text-sm" data-testid="text-recent-count-value">
                      ${recentCountValue.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="pt-2">
                  <Link href={`/count/${mostRecentCount.id}`}>
                    <Button variant="outline" size="sm" className="w-full" data-testid="button-view-count-details">
                      View Details
                    </Button>
                  </Link>
                </div>
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
            {storePurchaseOrdersRecent.length > 0 ? (
              <div className="space-y-2">
                {storePurchaseOrdersRecent.map((order) => (
                  <Link 
                    key={order.id} 
                    href={order.status === "pending" ? `/purchase-orders/${order.id}` : `/receiving/${order.id}`}
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
                          {order.vendorName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          #{order.id.slice(0, 8)}
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
                        {(() => {
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
                ))}
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
