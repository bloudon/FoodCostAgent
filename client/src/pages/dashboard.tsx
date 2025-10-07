import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: products, isLoading: productsLoading } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: recipes, isLoading: recipesLoading } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  const totalProducts = products?.filter(p => p.active === 1).length || 0;
  const avgRecipeCost = recipes?.length
    ? recipes.reduce((sum, r) => sum + (r.computedCost || 0), 0) / recipes.length
    : 0;

  const stats = [
    {
      title: "Total Products",
      value: productsLoading ? "..." : totalProducts.toString(),
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
              {products && products.length > 0 
                ? `${products.length} products in catalog` 
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
    </div>
  );
}
