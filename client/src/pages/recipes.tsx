import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Recipes() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: recipes, isLoading } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: recipeComponents } = useQuery<any[]>({
    queryKey: ["/api/recipe-components"],
    enabled: false,
  });

  const filteredRecipes = recipes?.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-recipes-title">
            Recipes
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage recipe BOMs with nested components and cost tracking
          </p>
        </div>
        <Button asChild data-testid="button-create-recipe">
          <Link href="/recipes/new">
            <Plus className="h-4 w-4 mr-2" />
            New Recipe
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-recipe"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filteredRecipes && filteredRecipes.length > 0 ? (
          <>
            {filteredRecipes.map((recipe) => (
              <Link key={recipe.id} href={`/recipes/${recipe.id}`}>
                <Card className="hover-elevate cursor-pointer transition-all" data-testid={`card-recipe-${recipe.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg" data-testid={`text-recipe-name-${recipe.id}`}>{recipe.name}</CardTitle>
                      {recipe.name.includes("Dough") || recipe.name.includes("Sauce") ? (
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-recipe-base-${recipe.id}`}>
                          Base Recipe
                        </Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Yield:</span>
                        <span className="font-mono" data-testid={`text-recipe-yield-${recipe.id}`}>{recipe.yieldQty} unit</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cost:</span>
                        <span className="font-mono font-semibold text-primary" data-testid={`text-recipe-cost-${recipe.id}`}>
                          ${recipe.computedCost?.toFixed(2) || "0.00"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Waste:</span>
                        <span className="font-mono" data-testid={`text-recipe-waste-${recipe.id}`}>{recipe.wastePercent}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            <Card className="border-dashed border-2 hover-elevate cursor-pointer transition-all" data-testid="button-add-new-recipe">
              <CardContent className="flex items-center justify-center h-full min-h-[180px]">
                <div className="text-center">
                  <Plus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Add New Recipe</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="col-span-full">
            <CardContent className="pt-6 text-center text-muted-foreground">
              {searchQuery ? "No recipes match your search" : "No recipes found. Create your first recipe to get started."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
