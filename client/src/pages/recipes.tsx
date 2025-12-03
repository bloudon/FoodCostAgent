import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ChefHat, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRecipeName } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type Recipe = {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnitId: string;
  computedCost: number;
  canBeIngredient: number;
  parentRecipeId: string | null;
  sizeName: string | null;
};

type RecipeGroup = {
  parent: Recipe;
  children: Recipe[];
};

export default function Recipes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const { data: recipes, isLoading } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
  });

  // Group recipes by parent-child relationship
  const groupedRecipes = useMemo(() => {
    if (!recipes) return [];

    // Filter recipes by search
    const filtered = recipes.filter(r => 
      r.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Separate parent recipes (no parentRecipeId) and child recipes
    const parentRecipes = filtered.filter(r => !r.parentRecipeId);
    const childRecipes = filtered.filter(r => r.parentRecipeId);

    // Create a map of parent ID to children
    const childrenByParent = new Map<string, Recipe[]>();
    childRecipes.forEach(child => {
      const parentId = child.parentRecipeId!;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(child);
    });

    // Build grouped structure
    const groups: RecipeGroup[] = [];
    
    // Add parent recipes with their children
    parentRecipes.forEach(parent => {
      groups.push({
        parent,
        children: childrenByParent.get(parent.id) || [],
      });
      // Remove from map so we don't add orphaned children again
      childrenByParent.delete(parent.id);
    });

    // Handle orphaned children (parent not in filtered list)
    // Find their parent and add them
    childRecipes.forEach(child => {
      if (childrenByParent.has(child.parentRecipeId!)) {
        // Parent wasn't in filtered results, but child matches search
        // Find the parent in the full list
        const parent = recipes.find(r => r.id === child.parentRecipeId);
        if (parent) {
          // Check if we already have this parent
          const existingGroup = groups.find(g => g.parent.id === parent.id);
          if (existingGroup) {
            if (!existingGroup.children.some(c => c.id === child.id)) {
              existingGroup.children.push(child);
            }
          } else {
            groups.push({
              parent,
              children: childrenByParent.get(parent.id) || [],
            });
            childrenByParent.delete(parent.id);
          }
        }
      }
    });

    return groups;
  }, [recipes, searchQuery]);

  const toggleGroup = (parentId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };

  // Count total recipes including children
  const totalRecipes = groupedRecipes.reduce((sum, group) => sum + 1 + group.children.length, 0);

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
      ) : groupedRecipes.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipe Name</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedRecipes.map((group) => (
                  <Collapsible key={group.parent.id} asChild open={expandedGroups.has(group.parent.id)}>
                    <>
                      {/* Parent recipe row */}
                      <TableRow 
                        className="cursor-pointer hover-elevate" 
                        data-testid={`row-recipe-${group.parent.id}`}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {group.children.length > 0 && (
                              <CollapsibleTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    toggleGroup(group.parent.id);
                                  }}
                                  data-testid={`button-expand-${group.parent.id}`}
                                >
                                  <ChevronRight 
                                    className={`h-4 w-4 transition-transform ${
                                      expandedGroups.has(group.parent.id) ? 'rotate-90' : ''
                                    }`} 
                                  />
                                </Button>
                              </CollapsibleTrigger>
                            )}
                            <Link href={`/recipes/${group.parent.id}`} className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium" data-testid={`text-recipe-name-${group.parent.id}`}>
                                  {formatRecipeName(group.parent.name)}
                                </span>
                                {group.parent.canBeIngredient === 1 && (
                                  <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-recipe-base-${group.parent.id}`}>
                                    <ChefHat className="h-3 w-3" />
                                    Base Recipe
                                  </Badge>
                                )}
                                {group.children.length > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    {group.children.length} size{group.children.length > 1 ? 's' : ''}
                                  </Badge>
                                )}
                              </div>
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/recipes/${group.parent.id}`} className="block w-full">
                            <span className="font-mono text-sm" data-testid={`text-recipe-yield-${group.parent.id}`}>
                              {group.parent.yieldQty} unit
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/recipes/${group.parent.id}`} className="block w-full">
                            <span className="font-mono font-semibold text-primary" data-testid={`text-recipe-cost-${group.parent.id}`}>
                              ${group.parent.computedCost?.toFixed(2) || "0.00"}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/recipes/${group.parent.id}`}>
                            <Button variant="ghost" size="sm" data-testid={`button-view-recipe-${group.parent.id}`}>
                              View
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>

                      {/* Child recipe rows (size variants) */}
                      <CollapsibleContent asChild>
                        <>
                          {group.children.map((child) => (
                            <TableRow 
                              key={child.id}
                              className="cursor-pointer hover-elevate bg-muted/30" 
                              data-testid={`row-recipe-${child.id}`}
                            >
                              <TableCell>
                                <Link href={`/recipes/${child.id}`} className="flex-1">
                                  <div className="flex items-center gap-2 pl-8">
                                    <span className="text-muted-foreground">└</span>
                                    <span className="font-medium" data-testid={`text-recipe-name-${child.id}`}>
                                      {formatRecipeName(child.name)}
                                    </span>
                                    {child.sizeName && (
                                      <Badge variant="outline" className="text-xs">
                                        {child.sizeName}
                                      </Badge>
                                    )}
                                  </div>
                                </Link>
                              </TableCell>
                              <TableCell className="text-right">
                                <Link href={`/recipes/${child.id}`} className="block w-full">
                                  <span className="font-mono text-sm" data-testid={`text-recipe-yield-${child.id}`}>
                                    {child.yieldQty} unit
                                  </span>
                                </Link>
                              </TableCell>
                              <TableCell className="text-right">
                                <Link href={`/recipes/${child.id}`} className="block w-full">
                                  <span className="font-mono font-semibold text-primary" data-testid={`text-recipe-cost-${child.id}`}>
                                    ${child.computedCost?.toFixed(2) || "0.00"}
                                  </span>
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Link href={`/recipes/${child.id}`}>
                                  <Button variant="ghost" size="sm" data-testid={`button-view-recipe-${child.id}`}>
                                    View
                                  </Button>
                                </Link>
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
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
