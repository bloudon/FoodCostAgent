import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ChefHat, ChevronRight, MoreHorizontal, Trash2, EyeOff, Eye, AlertTriangle, Wrench, Archive, X, LinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRecipeName } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Recipe = {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnitId: string;
  computedCost: number;
  canBeIngredient: number;
  parentRecipeId: string | null;
  sizeName: string | null;
  isActive: number;
};

type CanDeleteResponse = {
  canDelete: boolean;
  hasSales: boolean;
  isSubRecipe: boolean;
  isActive: boolean;
};

type RecipeGroup = {
  parent: Recipe;
  children: Recipe[];
};

type OrphanedRecipe = {
  id: string;
  name: string;
  sizeName: string | null;
  parentRecipeId: string | null;
  isActive: number;
  isPlaceholder: number;
  computedCost: number;
  hasMenuItemLink: boolean;
  usedAsSubRecipeIn: string[];
  childCount: number;
  isParentTemplate: boolean;
  isOrphaned: boolean;
  canSafelyDelete: boolean;
  status: string;
};

type OrphanedRecipesResponse = {
  orphaned: OrphanedRecipe[];
  parentTemplates: OrphanedRecipe[];
  total: number;
};

export default function Recipes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [canDeleteInfo, setCanDeleteInfo] = useState<CanDeleteResponse | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: recipes, isLoading } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      await apiRequest("DELETE", `/api/recipes/${recipeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Recipe deleted", description: "The recipe has been permanently deleted." });
      setDeleteDialogOpen(false);
      setSelectedRecipe(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete failed", 
        description: error.message || "Could not delete the recipe",
        variant: "destructive"
      });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      await apiRequest("POST", `/api/recipes/${recipeId}/deactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Recipe deactivated", description: "The recipe has been deactivated and hidden from views." });
      setDeactivateDialogOpen(false);
      setSelectedRecipe(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Deactivation failed", 
        description: error.message || "Could not deactivate the recipe",
        variant: "destructive"
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      await apiRequest("POST", `/api/recipes/${recipeId}/reactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Recipe reactivated", description: "The recipe is now active again." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Reactivation failed", 
        description: error.message || "Could not reactivate the recipe",
        variant: "destructive"
      });
    },
  });

  // Orphaned recipes query - only fetches when dialog is open
  const { data: orphanedData, isLoading: isLoadingOrphaned, refetch: refetchOrphaned } = useQuery<OrphanedRecipesResponse>({
    queryKey: ["/api/recipes/orphaned"],
    enabled: cleanupDialogOpen,
  });

  const archiveMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      await apiRequest("POST", `/api/recipes/${recipeId}/archive`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/orphaned"] });
      toast({ title: "Recipe archived", description: "The recipe has been archived (deactivated)." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Archive failed", 
        description: error.message || "Could not archive the recipe",
        variant: "destructive"
      });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      await apiRequest("DELETE", `/api/recipes/${recipeId}/permanent`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/orphaned"] });
      toast({ title: "Recipe deleted", description: "The recipe has been permanently deleted." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete failed", 
        description: error.message || "Could not delete the recipe",
        variant: "destructive"
      });
    },
  });

  const checkCanDelete = async (recipe: Recipe) => {
    try {
      const response = await fetch(`/api/recipes/${recipe.id}/can-delete`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to check recipe status');
      const info: CanDeleteResponse = await response.json();
      setCanDeleteInfo(info);
      setSelectedRecipe(recipe);
      
      if (info.canDelete) {
        setDeleteDialogOpen(true);
      } else {
        setDeactivateDialogOpen(true);
      }
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "Could not check recipe status",
        variant: "destructive"
      });
    }
  };

  // Group recipes by parent-child relationship
  const groupedRecipes = useMemo(() => {
    if (!recipes) return [];

    // Filter recipes by search and active status
    const filtered = recipes.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesActive = showInactive || r.isActive === 1;
      return matchesSearch && matchesActive;
    });

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
  }, [recipes, searchQuery, showInactive]);

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
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={() => setCleanupDialogOpen(true)}
            data-testid="button-cleanup-recipes"
          >
            <Wrench className="h-4 w-4 mr-2" />
            Cleanup
          </Button>
          <Button asChild data-testid="button-create-recipe">
            <Link href="/recipes/new">
              <Plus className="h-4 w-4 mr-2" />
              New Recipe
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-recipe"
          />
        </div>
        <Button
          variant={showInactive ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowInactive(!showInactive)}
          data-testid="button-toggle-inactive"
        >
          {showInactive ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
          {showInactive ? "Showing All" : "Show Inactive"}
        </Button>
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
                                <span className={`font-medium ${group.parent.isActive === 0 ? 'text-muted-foreground' : ''}`} data-testid={`text-recipe-name-${group.parent.id}`}>
                                  {formatRecipeName(group.parent.name)}
                                </span>
                                {group.parent.isActive === 0 && (
                                  <Badge variant="outline" className="text-xs text-muted-foreground">
                                    Inactive
                                  </Badge>
                                )}
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
                          <div className="flex items-center gap-1">
                            <Link href={`/recipes/${group.parent.id}`}>
                              <Button variant="ghost" size="sm" data-testid={`button-view-recipe-${group.parent.id}`}>
                                View
                              </Button>
                            </Link>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-actions-recipe-${group.parent.id}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/recipes/${group.parent.id}`}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    View Recipe
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {group.parent.isActive === 0 ? (
                                  <DropdownMenuItem 
                                    onClick={() => reactivateMutation.mutate(group.parent.id)}
                                    data-testid={`button-reactivate-recipe-${group.parent.id}`}
                                  >
                                    <Eye className="h-4 w-4 mr-2" />
                                    Reactivate
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem 
                                    onClick={() => checkCanDelete(group.parent)}
                                    className="text-destructive focus:text-destructive"
                                    data-testid={`button-delete-recipe-${group.parent.id}`}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete / Deactivate
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
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
                                    <span className={`font-medium ${child.isActive === 0 ? 'text-muted-foreground' : ''}`} data-testid={`text-recipe-name-${child.id}`}>
                                      {formatRecipeName(child.name)}
                                    </span>
                                    {child.isActive === 0 && (
                                      <Badge variant="outline" className="text-xs text-muted-foreground">
                                        Inactive
                                      </Badge>
                                    )}
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
                                <div className="flex items-center gap-1">
                                  <Link href={`/recipes/${child.id}`}>
                                    <Button variant="ghost" size="sm" data-testid={`button-view-recipe-${child.id}`}>
                                      View
                                    </Button>
                                  </Link>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-actions-recipe-${child.id}`}>
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem asChild>
                                        <Link href={`/recipes/${child.id}`}>
                                          <Eye className="h-4 w-4 mr-2" />
                                          View Recipe
                                        </Link>
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      {child.isActive === 0 ? (
                                        <DropdownMenuItem 
                                          onClick={() => reactivateMutation.mutate(child.id)}
                                          data-testid={`button-reactivate-recipe-${child.id}`}
                                        >
                                          <Eye className="h-4 w-4 mr-2" />
                                          Reactivate
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem 
                                          onClick={() => checkCanDelete(child)}
                                          className="text-destructive focus:text-destructive"
                                          data-testid={`button-delete-recipe-${child.id}`}
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete / Deactivate
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{selectedRecipe?.name}"? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedRecipe && deleteMutation.mutate(selectedRecipe.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate Dialog (when recipe cannot be deleted) */}
      <AlertDialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Cannot Delete Recipe
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The recipe "{selectedRecipe?.name}" cannot be permanently deleted because:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {canDeleteInfo?.hasSales && (
                    <li>It has recorded sales history</li>
                  )}
                  {canDeleteInfo?.isSubRecipe && (
                    <li>It is used as an ingredient in other recipes</li>
                  )}
                </ul>
                <p>
                  You can <strong>deactivate</strong> this recipe instead, which will hide it from 
                  normal views while preserving historical data.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-deactivate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedRecipe && deactivateMutation.mutate(selectedRecipe.id)}
              className="bg-amber-600 text-white hover:bg-amber-700"
              data-testid="button-confirm-deactivate"
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate Recipe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recipe Cleanup Dialog */}
      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Recipe Cleanup
            </DialogTitle>
            <DialogDescription>
              Review and clean up orphaned or duplicate recipes that are not linked to any menu items.
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            {isLoadingOrphaned ? (
              <div className="space-y-3 py-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : orphanedData ? (
              <div className="space-y-6 py-4">
                {/* Orphaned Recipes Section */}
                {orphanedData.orphaned.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Orphaned Recipes ({orphanedData.orphaned.length})
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      These recipes are not linked to any menu item and are not used as sub-recipes.
                    </p>
                    <div className="space-y-2">
                      {orphanedData.orphaned.map((recipe) => (
                        <Card key={recipe.id} className="p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">
                                  {formatRecipeName(recipe.name)}
                                </span>
                                {recipe.sizeName && (
                                  <Badge variant="outline" className="text-xs">
                                    {recipe.sizeName}
                                  </Badge>
                                )}
                                {recipe.isPlaceholder === 1 && (
                                  <Badge variant="secondary" className="text-xs">
                                    Placeholder
                                  </Badge>
                                )}
                                {recipe.isActive === 0 && (
                                  <Badge variant="outline" className="text-xs text-muted-foreground">
                                    Inactive
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                Cost: ${recipe.computedCost?.toFixed(2) || "0.00"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {recipe.isActive === 1 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => archiveMutation.mutate(recipe.id)}
                                  disabled={archiveMutation.isPending}
                                  data-testid={`button-archive-recipe-${recipe.id}`}
                                >
                                  <Archive className="h-4 w-4 mr-1" />
                                  Archive
                                </Button>
                              )}
                              {recipe.canSafelyDelete && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => permanentDeleteMutation.mutate(recipe.id)}
                                  disabled={permanentDeleteMutation.isPending}
                                  data-testid={`button-delete-orphaned-${recipe.id}`}
                                >
                                  <Trash2 className="h-4 w-4 mr-1" />
                                  Delete
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parent Templates Section */}
                {orphanedData.parentTemplates.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                      <LinkIcon className="h-4 w-4 text-blue-500" />
                      Parent Template Recipes ({orphanedData.parentTemplates.length})
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      These are parent/base recipes used as templates for size variants. They have child recipes but no direct menu item link (this is normal).
                    </p>
                    <div className="space-y-2">
                      {orphanedData.parentTemplates.map((recipe) => (
                        <Card key={recipe.id} className="p-4 bg-muted/30">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">
                                  {formatRecipeName(recipe.name)}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {recipe.childCount} variant{recipe.childCount > 1 ? "s" : ""}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                Cost: ${recipe.computedCost?.toFixed(2) || "0.00"} (base recipe)
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge variant="outline" className="text-xs text-green-600">
                                Protected
                              </Badge>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* No orphans message */}
                {orphanedData.orphaned.length === 0 && orphanedData.parentTemplates.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <ChefHat className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">All recipes are properly linked!</p>
                    <p className="text-sm mt-1">No orphaned recipes found.</p>
                  </div>
                )}
              </div>
            ) : null}
          </ScrollArea>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setCleanupDialogOpen(false)}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => refetchOrphaned()}>
              Refresh
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
