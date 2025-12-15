import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, TrendingUp, Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRecipeName } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function RecipeDetail() {
  const [, params] = useRoute("/recipes/:id");
  const recipeId = params?.id;

  const { data: recipe, isLoading: recipeLoading } = useQuery<any>({
    queryKey: ["/api/recipes", recipeId],
    enabled: !!recipeId,
  });

  const { data: components, isLoading: componentsLoading } = useQuery<any[]>({
    queryKey: ["/api/recipe-components", recipeId],
    enabled: !!recipeId,
  });

  const { data: versions, isLoading: versionsLoading } = useQuery<any[]>({
    queryKey: ["/api/recipe-versions", recipeId],
    enabled: !!recipeId,
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: recipes } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  const costHistoryData = versions
    ?.map((v) => ({
      date: new Date(v.createdAt).toLocaleDateString(),
      cost: v.computedCost || 0,
    }))
    .reverse() || [];

  if (recipeLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Recipe not found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link href="/recipes">
          <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-recipes">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Recipes
          </Button>
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-recipe-name">
              {formatRecipeName(recipe.name)}
            </h1>
            <p className="text-muted-foreground mt-2">
              Recipe details and cost history
            </p>
          </div>
          <div className="flex items-center gap-2">
            {recipe.name.includes("Dough") || recipe.name.includes("Sauce") ? (
              <Badge variant="secondary" data-testid="badge-base-recipe">
                Base Recipe
              </Badge>
            ) : null}
            <Link href={`/recipes/${recipeId}/edit`}>
              <Button data-testid="button-edit-recipe">
                <Edit className="h-4 w-4 mr-2" />
                Edit Recipe
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3 mb-8">
        <Card data-testid="card-current-cost">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Cost
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-current-cost">
              ${recipe.computedCost?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Per {recipe.yieldQty} unit yield
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-yield">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Yield
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-yield">
              {recipe.yieldQty}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Units produced
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <Card data-testid="card-ingredients">
          <CardHeader>
            <CardTitle>Recipe Ingredients</CardTitle>
          </CardHeader>
          <CardContent>
            {componentsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : components && components.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map((component) => {
                    const unit = units?.find((u) => u.id === component.unitId);
                    const item = component.componentType === "inventory_item"
                      ? inventoryItems?.find((i) => i.id === component.componentId)
                      : null;
                    const subRecipe = component.componentType === "recipe"
                      ? recipes?.find((r) => r.id === component.componentId)
                      : null;
                    const name = item?.name || subRecipe?.name || "Unknown";
                    const cost = component.componentCost || 0;

                    return (
                      <TableRow key={component.id} data-testid={`row-component-${component.id}`}>
                        <TableCell className="font-medium" data-testid={`text-component-name-${component.id}`}>
                          {name}
                          {subRecipe && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              Sub-Recipe
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono" data-testid={`text-component-qty-${component.id}`}>
                          {component.qty}
                        </TableCell>
                        <TableCell data-testid={`text-component-unit-${component.id}`}>
                          {unit?.name || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-component-cost-${component.id}`}>
                          ${cost.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No ingredients added yet</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-cost-history">
          <CardHeader>
            <CardTitle>Cost History (Past Year)</CardTitle>
          </CardHeader>
          <CardContent>
            {versionsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : costHistoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={costHistoryData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="cost" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No historical cost data available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
