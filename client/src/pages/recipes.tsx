import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ChefHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="space-y-2 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : filteredRecipes && filteredRecipes.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipe Name</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Waste %</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipes.map((recipe) => (
                  <TableRow 
                    key={recipe.id} 
                    className="cursor-pointer hover-elevate" 
                    data-testid={`row-recipe-${recipe.id}`}
                  >
                    <TableCell>
                      <Link href={`/recipes/${recipe.id}`} className="block w-full">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid={`text-recipe-name-${recipe.id}`}>
                            {recipe.name}
                          </span>
                          {recipe.canBeIngredient === 1 && (
                            <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-recipe-base-${recipe.id}`}>
                              <ChefHat className="h-3 w-3" />
                              Base Recipe
                            </Badge>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/recipes/${recipe.id}`} className="block w-full">
                        <span className="font-mono text-sm" data-testid={`text-recipe-yield-${recipe.id}`}>
                          {recipe.yieldQty} unit
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/recipes/${recipe.id}`} className="block w-full">
                        <span className="font-mono font-semibold text-primary" data-testid={`text-recipe-cost-${recipe.id}`}>
                          ${recipe.computedCost?.toFixed(2) || "0.00"}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/recipes/${recipe.id}`} className="block w-full">
                        <span className="font-mono text-sm" data-testid={`text-recipe-waste-${recipe.id}`}>
                          {recipe.wastePercent}%
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recipes/${recipe.id}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-view-recipe-${recipe.id}`}>
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {searchQuery ? "No recipes match your search" : "No recipes found. Create your first recipe to get started."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
