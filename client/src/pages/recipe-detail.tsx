import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, TrendingUp, Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { filterUnitsBySystem, formatUnitName } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SystemPreferences } from "@shared/schema";

export default function RecipeDetail() {
  const [, params] = useRoute("/recipes/:id");
  const recipeId = params?.id;
  const { toast } = useToast();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<any>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnitId, setEditUnitId] = useState("");

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

  const { data: systemPrefs } = useQuery<SystemPreferences>({
    queryKey: ["/api/system-preferences"],
  });

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: recipes } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  const updateComponentMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest(`/api/recipe-components/${selectedComponent.id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components", recipeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Component updated successfully" });
      setEditDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to update component", variant: "destructive" });
    },
  });

  const deleteComponentMutation = useMutation({
    mutationFn: async (componentId: string) => {
      return apiRequest(`/api/recipe-components/${componentId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components", recipeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Component deleted successfully" });
      setDeleteDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to delete component", variant: "destructive" });
    },
  });

  const handleEditClick = (component: any) => {
    setSelectedComponent(component);
    setEditQty(component.qty.toString());
    setEditUnitId(component.unitId);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (component: any) => {
    setSelectedComponent(component);
    setDeleteDialogOpen(true);
  };

  const handleUpdateComponent = () => {
    if (!editQty || !editUnitId) return;
    updateComponentMutation.mutate({
      qty: parseFloat(editQty),
      unitId: editUnitId,
    });
  };

  const handleDeleteComponent = () => {
    if (!selectedComponent) return;
    deleteComponentMutation.mutate(selectedComponent.id);
  };

  // Prepare historical cost data for chart
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
              {recipe.name}
            </h1>
            <p className="text-muted-foreground mt-2">
              Recipe details and cost history
            </p>
          </div>
          {recipe.name.includes("Dough") || recipe.name.includes("Sauce") ? (
            <Badge variant="secondary" data-testid="badge-base-recipe">
              Base Recipe
            </Badge>
          ) : null}
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
                    <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(component)}
                              data-testid={`button-edit-component-${component.id}`}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(component)}
                              data-testid={`button-delete-component-${component.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
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

      {/* Edit Component Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent data-testid="dialog-edit-component">
          <DialogHeader>
            <DialogTitle>Edit Component</DialogTitle>
            <DialogDescription>
              Update the quantity and unit for this ingredient
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-qty">Quantity</Label>
              <Input
                id="edit-qty"
                type="number"
                step="0.01"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                data-testid="input-edit-qty"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-unit">Unit</Label>
              <Select value={editUnitId} onValueChange={setEditUnitId}>
                <SelectTrigger id="edit-unit" data-testid="select-edit-unit">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {filterUnitsBySystem(units, systemPrefs?.unitSystem).map((unit) => (
                    <SelectItem key={unit.id} value={unit.id} data-testid={`option-unit-${unit.id}`}>
                      {formatUnitName(unit.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateComponent}
              disabled={updateComponentMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateComponentMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Component Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-component">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Component</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this ingredient from the recipe? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteComponent}
              disabled={deleteComponentMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteComponentMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
