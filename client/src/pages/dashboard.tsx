import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, DollarSign, ClipboardList, ArrowRight, Store, PackageCheck, Truck, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Company, User, CompanyStore } from "@shared/schema";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";

export default function Dashboard() {
  // Get current user to determine which company to display
  const { data: currentUser, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  // For global admins, use selectedCompanyId from localStorage
  // For regular users, use their own companyId
  const selectedCompanyId = currentUser?.role === "global_admin" 
    ? localStorage.getItem("selectedCompanyId")
    : currentUser?.companyId;
  
  const { data: company, isLoading: companyLoading } = useQuery<Company>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}`] : [],
    enabled: !!selectedCompanyId,
  });

  // Get accessible stores for the current user
  const { data: stores = [], isLoading: storesLoading } = useAccessibleStores();

  // Store selection state
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  // Initialize selectedStoreId when stores are loaded
  useEffect(() => {
    if (stores.length > 0 && !selectedStoreId) {
      setSelectedStoreId(stores[0].id);
    }
  }, [stores, selectedStoreId]);

  const selectedStore = stores.find(s => s.id === selectedStoreId);

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
  
  // Get last 3 purchase orders for quicklink display
  const storePurchaseOrdersRecent = [...storePurchaseOrdersAll]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  
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
    // Each line has quantityCounted and the item's pricePerUnit
    const item = inventoryItems?.find(i => i.id === line.inventoryItemId);
    if (item && line.quantityCounted && item.pricePerUnit !== undefined) {
      return sum + (line.quantityCounted * item.pricePerUnit);
    }
    return sum;
  }, 0) || 0;

  // Stats filtered by selected store
  const totalItems = inventoryItems?.filter(i => i.active === 1).length || 0;
  const totalCounts = inventoryCounts?.length || 0;
  const totalOrders = storePurchaseOrdersAll.length;
  
  // Calculate total inventory value for this store
  const totalInventoryValue = inventoryItems?.reduce((sum, item) => {
    if (item.active === 1) {
      return sum + (item.pricePerUnit || 0);
    }
    return sum;
  }, 0) || 0;

  const stats = [
    {
      title: "Active Items",
      value: itemsLoading ? "..." : totalItems.toString(),
      icon: Package,
      description: "Inventory items at this store",
    },
    {
      title: "Inventory Value",
      value: itemsLoading ? "..." : `$${totalInventoryValue.toFixed(2)}`,
      icon: DollarSign,
      description: "Total value of inventory items",
    },
    {
      title: "Inventory Counts",
      value: countsLoading ? "..." : totalCounts.toString(),
      icon: ClipboardList,
      description: "Count sessions for this store",
    },
    {
      title: "Recent Orders",
      value: totalOrders.toString(),
      icon: PackageCheck,
      description: "Last 3 purchase orders",
    },
  ];

  if (userLoading || storesLoading || companyLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  // Simplified dashboard for store users
  if (currentUser?.role === 'store_user') {
    return (
      <div className="p-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-dashboard-title">
                {company?.name || "Welcome"}
              </h1>
              {selectedStore && (
                <p className="text-xl text-muted-foreground">
                  {selectedStore.name}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <p className="text-lg">
                Welcome, {currentUser.firstName || currentUser.email}!
              </p>
              <p className="text-muted-foreground">
                Use the navigation menu to access Inventory Sessions and Orders.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Full dashboard for admins and managers
  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-dashboard-title">
              {company?.name || "Dashboard"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {selectedStore ? `${selectedStore.name} - ` : ""}Overview of your restaurant inventory and operations
            </p>
          </div>
          
          {/* Store Selector */}
          <div className="flex items-center gap-3">
            <Store className="h-5 w-5 text-muted-foreground" />
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger className="w-[200px]" data-testid="select-store">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id} data-testid={`option-store-${store.id}`}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.title} data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono" data-testid={`text-stat-value-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}>
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
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
                      {new Date(mostRecentCount.countedAt).toLocaleDateString()}
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
                    href={order.status === "ordered" ? `/receiving/${order.id}` : `/purchase-orders/${order.id}`}
                  >
                    <div 
                      className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0 cursor-pointer hover-elevate rounded p-2"
                      data-testid={`row-order-${order.id}`}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-sm" data-testid={`text-order-date-${order.id}`}>
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          #{order.id.slice(0, 8)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground capitalize" data-testid={`text-order-status-${order.id}`}>
                            {order.status}
                          </p>
                          <p className="font-medium text-sm font-mono" data-testid={`text-order-total-${order.id}`}>
                            ${(order.totalAmount || 0).toFixed(2)}
                          </p>
                        </div>
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
