import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  UtensilsCrossed,
  LayoutGrid,
  DollarSign,
  Leaf,
  ArrowRight,
  ChefHat,
} from "lucide-react";

type IngredientEntry = {
  name: string;
  classification: "direct_item" | "batch_prep";
  recipeCount: number;
};

type DepartmentEntry = {
  name: string;
  count: number;
};

type MenuInsightsData = {
  totalMenuItems: number;
  departmentBreakdown: DepartmentEntry[];
  avgSellingPrice: number | null;
  uniqueIngredientCount: number;
  ingredients: IngredientEntry[];
};

function StatCard({
  icon: Icon,
  label,
  value,
  subLabel,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-primary/10 shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground mb-0.5">{label}</p>
            <p className="text-2xl font-bold leading-tight" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
              {value}
            </p>
            {subLabel && (
              <p className="text-xs text-muted-foreground mt-0.5">{subLabel}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IngredientRow({ ingredient }: { ingredient: IngredientEntry }) {
  return (
    <div
      className="flex items-center justify-between py-2.5 border-b last:border-0"
      data-testid={`ingredient-row-${ingredient.name}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{ingredient.name}</span>
        {ingredient.classification === "batch_prep" && (
          <Badge
            variant="secondary"
            className="text-xs shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            data-testid={`badge-batch-prep-${ingredient.name}`}
          >
            Batch prep
          </Badge>
        )}
      </div>
      <span
        className="text-xs text-muted-foreground shrink-0 ml-3"
        data-testid={`ingredient-count-${ingredient.name}`}
      >
        {ingredient.recipeCount} {ingredient.recipeCount === 1 ? "item" : "items"}
      </span>
    </div>
  );
}

export default function MenuInsights() {
  const [, navigate] = useLocation();

  const { data, isLoading, isError } = useQuery<MenuInsightsData>({
    queryKey: ["/api/menu-insights"],
    staleTime: 30_000,
  });

  const markVisitedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/menu-insights/visited");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    },
  });

  useEffect(() => {
    if (data && !markVisitedMutation.isPending && !markVisitedMutation.isSuccess) {
      markVisitedMutation.mutate();
    }
  }, [data]);

  useEffect(() => {
    if (!isLoading && data && data.totalMenuItems === 0 && data.ingredients.length === 0) {
      navigate("/");
    }
  }, [isLoading, data, navigate]);

  const handleContinue = () => {
    navigate("/");
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="pt-6">
          <Skeleton className="h-4 w-48 mb-4" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full mb-2" />
          ))}
        </CardContent></Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <ChefHat className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Could not load menu insights. Please try again.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const deptCount = data.departmentBreakdown.length;
  const avgPriceDisplay =
    data.avgSellingPrice != null
      ? `$${data.avgSellingPrice.toFixed(2)}`
      : "—";

  const batchPrepIngredients = data.ingredients.filter(
    (i) => i.classification === "batch_prep",
  );
  const directIngredients = data.ingredients.filter(
    (i) => i.classification === "direct_item",
  );

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto pb-12">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" data-testid="text-menu-insights-title">
          Menu Insights
        </h1>
        <p className="text-muted-foreground mt-1">
          Here's what we extracted from your menu scan. No action required — just explore.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={UtensilsCrossed}
          label="Menu Items"
          value={data.totalMenuItems}
          subLabel="active dishes scanned"
        />
        <StatCard
          icon={LayoutGrid}
          label="Departments"
          value={deptCount || "—"}
          subLabel={deptCount ? `${deptCount} section${deptCount !== 1 ? "s" : ""}` : "none detected"}
        />
        <StatCard
          icon={DollarSign}
          label="Avg. Price"
          value={avgPriceDisplay}
          subLabel="excl. sides & modifiers"
        />
        <StatCard
          icon={Leaf}
          label="Ingredients"
          value={data.uniqueIngredientCount}
          subLabel="unique across all items"
        />
      </div>

      {data.departmentBreakdown.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Department Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {data.departmentBreakdown.map((dept) => (
                <div
                  key={dept.name}
                  className="flex items-center justify-between py-1"
                  data-testid={`dept-row-${dept.name}`}
                >
                  <span className="text-sm font-medium">{dept.name}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 sm:w-48 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 bg-primary rounded-full"
                        style={{
                          width: `${Math.round(
                            (dept.count / data.totalMenuItems) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-8 text-right">
                      {dept.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.ingredients.length > 0 && (
        <Card className="mb-8">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Ingredient Universe</CardTitle>
              {batchPrepIngredients.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {batchPrepIngredients.length} batch prep candidate{batchPrepIngredients.length !== 1 ? "s" : ""} · {directIngredients.length} direct item{directIngredients.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {batchPrepIngredients.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Batch Prep Candidates
                </p>
                {batchPrepIngredients
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((ingredient) => (
                    <IngredientRow key={ingredient.name} ingredient={ingredient} />
                  ))}
              </div>
            )}
            {directIngredients.length > 0 && (
              <div>
                {batchPrepIngredients.length > 0 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">
                    Direct Items
                  </p>
                )}
                {directIngredients
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((ingredient) => (
                    <IngredientRow key={ingredient.name} ingredient={ingredient} />
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.ingredients.length === 0 && data.totalMenuItems > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-6 text-center py-10">
            <Leaf className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No ingredient descriptions were detected in this menu scan.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleContinue}
          className="bg-[#f2690d] border-[#f2690d] text-white"
          data-testid="button-continue-to-dashboard"
        >
          Continue to Dashboard
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
