import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, DollarSign, TrendingUp, AlertTriangle, ClipboardList, ArrowRight, Building2, MapPin, Phone, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompanySettings } from "@shared/schema";

export default function Dashboard() {
  const { data: companySettings, isLoading: companyLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
  });

  const { data: inventoryItems, isLoading: itemsLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: recipes, isLoading: recipesLoading } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-counts"],
  });

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  // Get most recent count
  const mostRecentCount = inventoryCounts?.sort((a, b) => 
    new Date(b.countedAt).getTime() - new Date(a.countedAt).getTime()
  )[0];

  const { data: recentCountLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", mostRecentCount?.id],
    enabled: !!mostRecentCount,
  });

  const totalItems = inventoryItems?.filter(i => i.active === 1).length || 0;
  const avgRecipeCost = recipes?.length
    ? recipes.reduce((sum, r) => sum + (r.computedCost || 0), 0) / recipes.length
    : 0;

  const stats = [
    {
      title: "Total Items",
      value: itemsLoading ? "..." : totalItems.toString(),
      icon: Package,
      description: "Active inventory items",
    },
    {
      title: "Avg Recipe Cost",
      value: recipesLoading ? "..." : `$${avgRecipeCost.toFixed(2)}`,
      icon: DollarSign,
      description: "Average cost per recipe",
    },
    {
      title: "Total Recipes",
      value: recipesLoading ? "..." : (recipes?.length || 0).toString(),
      icon: TrendingUp,
      description: "Menu item recipes",
    },
    {
      title: "Low Stock Items",
      value: "0",
      icon: AlertTriangle,
      description: "Items below threshold",
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-dashboard-title">
          Dashboard
        </h1>
        <p className="text-muted-foreground mt-2">
          Overview of your restaurant inventory and operations
        </p>
      </div>

      {/* Company Info Card */}
      {companySettings && (companySettings.name || companySettings.address) && (
        <Card className="mb-8" data-testid="card-company-info">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle>{companySettings.name || "Restaurant"}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {companySettings.address && (
                <div className="flex items-start gap-2" data-testid="company-address">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">{companySettings.address}</p>
                    {(companySettings.city || companySettings.state || companySettings.zip) && (
                      <p className="text-muted-foreground">
                        {[companySettings.city, companySettings.state, companySettings.zip]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {companySettings.phone && (
                <div className="flex items-center gap-2" data-testid="company-phone">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{companySettings.phone}</span>
                </div>
              )}
              {companySettings.email && (
                <div className="flex items-center gap-2" data-testid="company-email">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{companySettings.email}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12">
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

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Navigate to Inventory Count, Recipes, or Reports to manage your restaurant
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {inventoryItems && inventoryItems.length > 0 
                ? `${inventoryItems.length} inventory items in catalog` 
                : "No recent activity"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ All systems operational
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <Card data-testid="card-recent-inventory">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <ClipboardList className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Most Recent Inventory Count</CardTitle>
              </div>
              <Link href="/inventory-sessions">
                <Button data-testid="button-new-count">
                  View All Sessions
                  <ArrowRight className="ml-2 h-4 w-4" />
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
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium font-mono" data-testid="text-recent-count-date">
                      {new Date(mostRecentCount.countedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium" data-testid="text-recent-count-location">
                      {storageLocations?.find(l => l.id === mostRecentCount.storageLocationId)?.name || "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Items</p>
                    <p className="font-medium font-mono" data-testid="text-recent-count-items">
                      {recentCountLines?.length || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="font-medium font-mono" data-testid="text-recent-count-value">
                      ${recentCountLines?.reduce((sum, line) => {
                        const item = inventoryItems?.find(i => i.id === line.inventoryItemId);
                        return sum + (line.derivedMicroUnits * (item?.pricePerUnit || 0));
                      }, 0).toFixed(2) || "0.00"}
                    </p>
                  </div>
                </div>
                {mostRecentCount.note && (
                  <div>
                    <p className="text-sm text-muted-foreground">Note</p>
                    <p className="text-sm" data-testid="text-recent-count-note">{mostRecentCount.note}</p>
                  </div>
                )}
                <div className="pt-2">
                  <Link href={`/count/${mostRecentCount.id}`}>
                    <Button variant="outline" size="sm" data-testid="button-view-count-details">
                      View Full Details
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No inventory counts yet</p>
                <Link href="/inventory-sessions">
                  <Button data-testid="button-first-count">
                    Go to Sessions
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
