import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUnitName } from "@/lib/utils";
import {
  ArrowLeft,
  Save,
  Search,
  GripVertical,
  Trash2,
  ChefHat,
  Package,
  Plus,
} from "lucide-react";
import type { Recipe, RecipeComponent, Category } from "@shared/schema";

type InventoryItem = {
  id: string;
  name: string;
  unitId: string;
  unitName: string;
  pricePerUnit: number;
  categoryId: string | null;
  categoryName: string | null;
};

type Unit = {
  id: string;
  name: string;
  toBaseRatio: number;
};

type DraggableItem = {
  id: string;
  name: string;
  type: "inventory_item" | "recipe";
  unitId?: string;
  unitName?: string;
  pricePerUnit?: number;
};

type ComponentWithDetails = RecipeComponent & {
  name: string;
  unitName: string;
  cost: number;
};

// Sortable ingredient row component
function SortableIngredientRow({
  component,
  onEdit,
  onDelete,
}: {
  component: ComponentWithDetails;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: component.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} data-testid={`row-ingredient-${component.id}`}>
      <TableCell className="w-8">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {component.componentType === "recipe" ? (
            <ChefHat className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Package className="h-4 w-4 text-muted-foreground" />
          )}
          <span data-testid={`text-ingredient-name-${component.id}`}>{component.name}</span>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono" data-testid={`text-ingredient-qty-${component.id}`}>
        {component.qty.toFixed(2)}
      </TableCell>
      <TableCell data-testid={`text-ingredient-unit-${component.id}`}>
        {formatUnitName(component.unitName)}
      </TableCell>
      <TableCell className="text-right font-mono" data-testid={`text-ingredient-cost-${component.id}`}>
        ${component.cost.toFixed(2)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            data-testid={`button-edit-ingredient-${component.id}`}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            data-testid={`button-delete-ingredient-${component.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// Draggable inventory/recipe item from left panel
function DraggableSourceItem({ 
  item, 
  onAdd,
  onEdit
}: { 
  item: DraggableItem;
  onAdd: (item: DraggableItem) => void;
  onEdit?: (item: DraggableItem) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `source-${item.id}`,
  });

  return (
    <Card
      ref={setNodeRef}
      className={`hover-elevate ${isDragging ? "opacity-50" : ""}`}
      data-testid={`draggable-item-${item.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-1">
          <div 
            {...attributes}
            {...listeners}
            className="flex-1 min-w-0 flex items-center gap-2 cursor-grab active:cursor-grabbing"
          >
            {item.type === "recipe" ? (
              <ChefHat className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{item.name}</div>
              {item.type === "inventory_item" && (
                <div className="text-xs text-muted-foreground">
                  ${item.pricePerUnit?.toFixed(2)} / {formatUnitName(item.unitName || "")}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {item.type === "inventory_item" && onEdit && (
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(item);
                }}
                data-testid={`button-edit-inventory-${item.id}`}
                className="h-8 w-8"
                title="Edit inventory item"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onAdd(item);
              }}
              data-testid={`button-add-item-${item.id}`}
              className="h-8 w-8"
              title="Add to recipe"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecipeBuilder() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = id === "new";

  // Get pre-populated name from URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const initialName = urlParams.get("name") || "";

  // Recipe metadata state
  const [recipeName, setRecipeName] = useState(initialName);
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnitId, setYieldUnitId] = useState("");
  const [canBeIngredient, setCanBeIngredient] = useState(false);

  // Component management state
  const [components, setComponents] = useState<ComponentWithDetails[]>([]);
  const [draggedItem, setDraggedItem] = useState<DraggableItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [pendingItem, setPendingItem] = useState<DraggableItem | null>(null);
  const [dialogQty, setDialogQty] = useState("");
  const [dialogUnitId, setDialogUnitId] = useState("");

  // Edit component dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentWithDetails | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnitId, setEditUnitId] = useState("");

  // Edit inventory item dialog state
  const [editingInventoryItem, setEditingInventoryItem] = useState<any | null>(null);
  const [itemEditForm, setItemEditForm] = useState({
    name: "",
    categoryId: "",
    pricePerUnit: "",
    caseSize: "",
  });

  // Queries
  const { data: recipe, isLoading: recipeLoading } = useQuery<Recipe>({
    queryKey: ["/api/recipes", id],
    enabled: !isNew && !!id,
  });

  const { data: recipeComponents } = useQuery<RecipeComponent[]>({
    queryKey: ["/api/recipe-components", id],
    enabled: !isNew && !!id,
  });

  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: menuItems } = useQuery<any[]>({
    queryKey: ["/api/menu-items"],
  });

  // Calculate component cost
  const calculateComponentCost = (comp: ComponentWithDetails): number => {
    const unit = units?.find((u) => u.id === comp.unitId);
    const qtyInBaseUnits = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "inventory_item") {
      const item = inventoryItems?.find((i) => i.id === comp.componentId);
      if (item) {
        // Convert item's pricePerUnit to price per base unit
        const itemUnit = units?.find((u) => u.id === item.unitId);
        const itemPricePerBaseUnit = itemUnit 
          ? item.pricePerUnit / itemUnit.toBaseRatio 
          : item.pricePerUnit;
        // Adjust for yield percentage to get effective cost (e.g., $3/lb at 70% yield = $4.29/lb effective)
        const yieldFactor = item.yieldPercent / 100;
        const effectiveCost = yieldFactor > 0 ? itemPricePerBaseUnit / yieldFactor : itemPricePerBaseUnit;
        return qtyInBaseUnits * effectiveCost;
      }
    } else if (comp.componentType === "recipe") {
      const subRecipe = recipes?.find((r) => r.id === comp.componentId);
      if (subRecipe) {
        const subRecipeUnit = units?.find((u) => u.id === subRecipe.yieldUnitId);
        const subRecipeYieldQty = subRecipeUnit
          ? subRecipe.yieldQty * subRecipeUnit.toBaseRatio
          : subRecipe.yieldQty;
        const costPerUnit = subRecipeYieldQty > 0 ? subRecipe.computedCost / subRecipeYieldQty : 0;
        return qtyInBaseUnits * costPerUnit;
      }
    }
    return 0;
  };

  // Calculate total recipe cost
  const totalCost = components.reduce((sum, comp) => sum + comp.cost, 0);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Setup droppable zone for recipe canvas
  const { setNodeRef: setCanvasRef } = useDroppable({
    id: "recipe-canvas",
  });

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const sourceId = active.id.toString();

    if (sourceId.startsWith("source-")) {
      const itemId = sourceId.replace("source-", "");
      const inventoryItem = inventoryItems?.find((i) => i.id === itemId);
      const recipeItem = recipes?.find((r) => r.id === itemId);

      if (inventoryItem) {
        setDraggedItem({
          id: inventoryItem.id,
          name: inventoryItem.name,
          type: "inventory_item",
          unitId: inventoryItem.unitId,
          unitName: inventoryItem.unitName,
          pricePerUnit: inventoryItem.pricePerUnit,
        });
      } else if (recipeItem) {
        setDraggedItem({
          id: recipeItem.id,
          name: recipeItem.name,
          type: "recipe",
        });
      }
    }
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setDraggedItem(null);
      return;
    }

    const activeId = active.id.toString();
    const overId = over.id.toString();

    // Handle dropping from source list to canvas
    // Accept drops on the canvas OR on any existing ingredient (user doesn't need to aim for empty space)
    if (activeId.startsWith("source-") && (overId === "recipe-canvas" || !overId.startsWith("source-"))) {
      const itemId = activeId.replace("source-", "");
      const inventoryItem = inventoryItems?.find((i) => i.id === itemId);
      const recipeItem = recipes?.find((r) => r.id === itemId);

      if (inventoryItem) {
        setPendingItem({
          id: inventoryItem.id,
          name: inventoryItem.name,
          type: "inventory_item",
          unitId: inventoryItem.unitId,
          unitName: inventoryItem.unitName,
          pricePerUnit: inventoryItem.pricePerUnit,
        });
        setDialogUnitId(inventoryItem.unitId);
        setShowAddDialog(true);
      } else if (recipeItem) {
        setPendingItem({
          id: recipeItem.id,
          name: recipeItem.name,
          type: "recipe",
        });
        setDialogUnitId(recipeItem.yieldUnitId);
        setShowAddDialog(true);
      }
    }
    // Handle reordering within canvas (only if both source and target are existing components)
    else if (!activeId.startsWith("source-") && !overId.startsWith("source-") && overId !== "recipe-canvas") {
      const oldIndex = components.findIndex((c) => c.id === activeId);
      const newIndex = components.findIndex((c) => c.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        setComponents(arrayMove(components, oldIndex, newIndex));
      }
    }

    setDraggedItem(null);
  };

  // Click to add item (keyboard/accessibility alternative to drag-and-drop)
  const handleClickToAdd = (item: DraggableItem) => {
    if (item.type === "inventory_item" && item.unitId) {
      setPendingItem({
        id: item.id,
        name: item.name,
        type: "inventory_item",
        unitId: item.unitId,
        unitName: item.unitName || "",
        pricePerUnit: item.pricePerUnit || 0,
      });
      setDialogUnitId(item.unitId);
      setShowAddDialog(true);
    } else if (item.type === "recipe") {
      const recipe = recipes?.find((r) => r.id === item.id);
      if (recipe) {
        setPendingItem({
          id: item.id,
          name: item.name,
          type: "recipe",
        });
        setDialogUnitId(recipe.yieldUnitId);
        setShowAddDialog(true);
      }
    }
  };

  // Add ingredient from dialog
  const handleAddIngredient = () => {
    if (!pendingItem || !dialogQty || !dialogUnitId) {
      toast({
        title: "Missing information",
        description: "Please enter quantity and unit",
        variant: "destructive",
      });
      return;
    }

    const newComponent: ComponentWithDetails = {
      id: `temp-${Date.now()}`,
      recipeId: id || "",
      componentType: pendingItem.type,
      componentId: pendingItem.id,
      qty: parseFloat(dialogQty),
      unitId: dialogUnitId,
      sortOrder: components.length,
      name: pendingItem.name,
      unitName: units?.find((u) => u.id === dialogUnitId)?.name || "",
      cost: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    newComponent.cost = calculateComponentCost(newComponent);
    setComponents([...components, newComponent]);
    setShowAddDialog(false);
    setPendingItem(null);
    setDialogQty("");
    setDialogUnitId("");
  };

  // Edit ingredient
  const handleEditIngredient = (component: ComponentWithDetails) => {
    setEditingComponent(component);
    setEditQty(component.qty.toString());
    setEditUnitId(component.unitId);
    setEditDialogOpen(true);
  };

  // Save edited ingredient
  const handleSaveEdit = () => {
    if (!editingComponent || !editQty || !editUnitId) return;

    const updatedComponents = components.map((comp) => {
      if (comp.id === editingComponent.id) {
        const updated = {
          ...comp,
          qty: parseFloat(editQty),
          unitId: editUnitId,
          unitName: units?.find((u) => u.id === editUnitId)?.name || "",
        };
        updated.cost = calculateComponentCost(updated);
        return updated;
      }
      return comp;
    });

    setComponents(updatedComponents);
    setEditDialogOpen(false);
    setEditingComponent(null);
  };

  // Delete ingredient
  const handleDeleteIngredient = (componentId: string) => {
    setComponents(components.filter((c) => c.id !== componentId));
  };

  // Edit inventory item handlers
  const handleOpenItemEdit = (item: DraggableItem) => {
    // Fetch full inventory item details
    const fullItem = inventoryItems?.find(i => i.id === item.id);
    if (fullItem) {
      setEditingInventoryItem(fullItem);
      setItemEditForm({
        name: fullItem.name || "",
        categoryId: fullItem.categoryId || "",
        pricePerUnit: fullItem.pricePerUnit?.toString() || "",
        caseSize: "1", // We don't have caseSize in the type, but keep for compatibility
      });
    }
  };

  const handleCloseItemEdit = () => {
    setEditingInventoryItem(null);
    setItemEditForm({
      name: "",
      categoryId: "",
      pricePerUnit: "",
      caseSize: "",
    });
  };

  const updateInventoryItemMutation = useMutation({
    mutationFn: async (data: { id: string; updates: any }) => {
      await apiRequest("PATCH", `/api/inventory-items/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({ title: "Inventory item updated successfully" });
      handleCloseItemEdit();
    },
    onError: () => {
      toast({ title: "Failed to update inventory item", variant: "destructive" });
    },
  });

  const handleSaveItemEdit = async () => {
    if (!editingInventoryItem) return;

    const updates: any = {};
    
    if (itemEditForm.name && itemEditForm.name !== editingInventoryItem.name) {
      updates.name = itemEditForm.name;
    }
    
    if (itemEditForm.categoryId && itemEditForm.categoryId !== editingInventoryItem.categoryId) {
      updates.categoryId = itemEditForm.categoryId;
    }
    
    if (itemEditForm.pricePerUnit) {
      const price = parseFloat(itemEditForm.pricePerUnit);
      if (!isNaN(price) && price !== editingInventoryItem.pricePerUnit) {
        updates.pricePerUnit = price;
      }
    }

    if (Object.keys(updates).length > 0) {
      updateInventoryItemMutation.mutate({
        id: editingInventoryItem.id,
        updates,
      });
    } else {
      handleCloseItemEdit();
    }
  };

  // Save recipe mutation
  const saveRecipeMutation = useMutation({
    mutationFn: async () => {
      const recipeData = {
        name: recipeName,
        yieldQty: parseFloat(yieldQty),
        yieldUnitId,
        computedCost: totalCost,
        canBeIngredient: canBeIngredient ? 1 : 0,
        isPlaceholder: 0, // Convert placeholder to complete recipe when saved
      };

      let recipeId = id;

      if (isNew) {
        const result = await apiRequest("POST", "/api/recipes", recipeData) as any;
        recipeId = result.id;
      } else {
        await apiRequest("PATCH", `/api/recipes/${id}`, recipeData);
      }

      // Delete all existing components first to avoid duplicates
      if (!isNew && recipeComponents) {
        await Promise.all(
          recipeComponents.map((comp) => 
            apiRequest("DELETE", `/api/recipe-components/${comp.id}`, undefined)
          )
        );
      }

      // Create all components fresh
      const componentPromises = components.map((comp, index) => {
        const compData = {
          recipeId,
          componentType: comp.componentType,
          componentId: comp.componentId,
          qty: comp.qty,
          unitId: comp.unitId,
          sortOrder: index,
        };

        return apiRequest("POST", "/api/recipe-components", compData);
      });

      await Promise.all(componentPromises);
      return recipeId;
    },
    onSuccess: (recipeId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      toast({ title: "Recipe saved successfully" });
      setLocation(`/recipes/${recipeId}`);
    },
    onError: () => {
      toast({ title: "Failed to save recipe", variant: "destructive" });
    },
  });

  // Filter source items
  const filteredInventoryItems = inventoryItems?.filter((item) => {
    // Search filter
    if (!item.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    
    // Category filter
    if (selectedCategoryId !== "all" && item.categoryId !== selectedCategoryId) {
      return false;
    }
    
    // showAsIngredient filter - exclude items from categories marked as hidden
    if (item.categoryId) {
      const category = categories?.find((c) => c.id === item.categoryId);
      if (category && category.showAsIngredient === 0) {
        return false;
      }
    }
    
    return true;
  });

  const filteredBaseRecipes = recipes?.filter(
    (recipe) =>
      recipe.id !== id && 
      recipe.canBeIngredient === 1 &&
      recipe.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const inventoryItemsSource: DraggableItem[] = filteredInventoryItems?.map((item) => ({
    id: item.id,
    name: item.name,
    type: "inventory_item" as const,
    unitId: item.unitId,
    unitName: item.unitName,
    pricePerUnit: item.pricePerUnit,
  })) || [];

  const baseRecipesSource: DraggableItem[] = filteredBaseRecipes?.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    type: "recipe" as const,
  })) || [];

  // Set default unit to "each" for new recipes
  useEffect(() => {
    if (isNew && units && !yieldUnitId) {
      const eachUnit = units.find((u) => u.name.toLowerCase() === "each");
      if (eachUnit) {
        setYieldUnitId(eachUnit.id);
      }
    }
  }, [isNew, units, yieldUnitId]);

  // Load recipe data when editing
  useEffect(() => {
    if (!isNew && recipe && recipeComponents && components.length === 0 && inventoryItems && recipes && units) {
      setRecipeName(recipe.name);
      setYieldQty(recipe.yieldQty.toString());
      setYieldUnitId(recipe.yieldUnitId);
      setCanBeIngredient(recipe.canBeIngredient === 1);

      const componentsWithDetails: ComponentWithDetails[] = recipeComponents.map((comp) => {
        let name = "";
        if (comp.componentType === "inventory_item") {
          name = inventoryItems?.find((i) => i.id === comp.componentId)?.name || "Unknown";
        } else {
          name = recipes?.find((r) => r.id === comp.componentId)?.name || "Unknown";
        }

        const unitName = units?.find((u) => u.id === comp.unitId)?.name || "";
        const compWithDetails = {
          ...comp,
          name,
          unitName,
          cost: 0,
        };
        compWithDetails.cost = calculateComponentCost(compWithDetails);
        return compWithDetails;
      });

      setComponents(componentsWithDetails);
    }
  }, [isNew, recipe, recipeComponents, inventoryItems, recipes, units]); // eslint-disable-line react-hooks/exhaustive-deps

  if (recipeLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading recipe...</div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="p-6 pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (window.history.length > 1) {
                      window.history.back();
                    } else {
                      setLocation("/recipes");
                    }
                  }}
                  data-testid="button-back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-bold">
                      {isNew ? "New Recipe" : "Edit Recipe"}
                    </h1>
                    {!isNew && id && menuItems && (() => {
                      const menuItem = menuItems.find((mi: any) => mi.recipeId === id);
                      if (menuItem) {
                        return (
                          <Link href="/menu-items" data-testid="link-menu-item">
                            <Badge variant="outline" className="hover-elevate cursor-pointer">
                              Used in: {menuItem.name}
                            </Badge>
                          </Link>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <p className="text-muted-foreground mt-1">
                    Drag ingredients from the left to build your recipe
                  </p>
                </div>
              </div>
              <Button
                onClick={() => saveRecipeMutation.mutate()}
                disabled={
                  saveRecipeMutation.isPending ||
                  !recipeName ||
                  !yieldQty ||
                  !yieldUnitId ||
                  components.length === 0
                }
                data-testid="button-save-recipe"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveRecipeMutation.isPending ? "Saving..." : "Save Recipe"}
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full grid grid-cols-12 gap-6 p-6">
            {/* Left panel - Source items */}
            <div className="col-span-4 flex flex-col gap-4 overflow-hidden">
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">Available Ingredients</h2>
                
                {/* Category filter */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Category Filter</label>
                  <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                    <SelectTrigger data-testid="select-category-filter">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories?.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search items and recipes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-ingredients"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto space-y-4">
                {/* Base Recipes Section */}
                {baseRecipesSource.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <ChefHat className="h-4 w-4" />
                      Base Recipes
                    </h3>
                    <div className="space-y-2">
                      {baseRecipesSource.map((item) => (
                        <DraggableSourceItem 
                          key={item.id} 
                          item={item} 
                          onAdd={handleClickToAdd}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Inventory Items Section */}
                {inventoryItemsSource.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      Inventory Items
                    </h3>
                    <div className="space-y-2">
                      {inventoryItemsSource.map((item) => (
                        <DraggableSourceItem 
                          key={item.id} 
                          item={item} 
                          onAdd={handleClickToAdd}
                          onEdit={handleOpenItemEdit}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {baseRecipesSource.length === 0 && inventoryItemsSource.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    No ingredients found
                  </div>
                )}
              </div>
            </div>

            {/* Right panel - Recipe canvas */}
            <div className="col-span-8 flex flex-col gap-4 overflow-hidden">
              {/* Recipe metadata */}
              <Card>
                <CardContent className="pt-6 space-y-4">
                  {/* Recipe name and cost on same line */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-2">
                      <label className="text-sm font-medium">Recipe Name</label>
                      <Input
                        value={recipeName}
                        onChange={(e) => setRecipeName(e.target.value)}
                        placeholder="e.g., Margherita Pizza"
                        data-testid="input-recipe-name"
                      />
                    </div>
                    <div className="w-48 space-y-2">
                      <label className="text-sm font-medium">Cost:</label>
                      <div
                        className="text-2xl font-bold text-primary text-right"
                        data-testid="text-total-cost"
                      >
                        ${totalCost.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Yield and canBeIngredient in closed accordion */}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="yield-details" className="border-0">
                      <AccordionTrigger className="text-sm font-medium py-2">
                        Recipe Yield & Options
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Yield Quantity</label>
                            <Input
                              type="number"
                              step="0.01"
                              value={yieldQty}
                              onChange={(e) => setYieldQty(e.target.value)}
                              placeholder="1"
                              data-testid="input-yield-qty"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Yield Unit</label>
                            <Select value={yieldUnitId} onValueChange={setYieldUnitId}>
                              <SelectTrigger data-testid="select-yield-unit">
                                <SelectValue placeholder="Select unit" />
                              </SelectTrigger>
                              <SelectContent>
                                {units?.map((unit) => (
                                  <SelectItem key={unit.id} value={unit.id}>
                                    {formatUnitName(unit.name)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="can-be-ingredient"
                            checked={canBeIngredient}
                            onCheckedChange={(checked) => setCanBeIngredient(checked === true)}
                            data-testid="checkbox-can-be-ingredient"
                          />
                          <label
                            htmlFor="can-be-ingredient"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            Can be used as ingredient in other recipes
                          </label>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>

              {/* Ingredients list */}
              <Card
                ref={setCanvasRef}
                id="recipe-canvas"
                className="flex-1 overflow-hidden flex flex-col min-h-0"
              >
                <CardHeader className="pb-3">
                  <h3 className="text-sm font-medium">Ingredients</h3>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto">
                  {components.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg">
                      <ChefHat className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-1">No ingredients yet</h3>
                      <p className="text-muted-foreground">
                        Drag items from the left panel to add ingredients
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Ingredient</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <SortableContext
                          items={components.map((c) => c.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {components.map((component) => (
                            <SortableIngredientRow
                              key={component.id}
                              component={component}
                              onEdit={() => handleEditIngredient(component)}
                              onDelete={() => handleDeleteIngredient(component.id)}
                            />
                          ))}
                        </SortableContext>
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Add ingredient dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent data-testid="dialog-add-ingredient">
          <DialogHeader>
            <DialogTitle>Add Ingredient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Ingredient</label>
              <p className="text-sm text-muted-foreground mt-1">{pendingItem?.name}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity</label>
              <Input
                type="number"
                step="0.01"
                value={dialogQty}
                onChange={(e) => setDialogQty(e.target.value)}
                placeholder="Enter quantity"
                data-testid="input-dialog-qty"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Unit</label>
              <Select value={dialogUnitId} onValueChange={setDialogUnitId}>
                <SelectTrigger data-testid="select-dialog-unit">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {units?.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {formatUnitName(unit.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddIngredient} data-testid="button-confirm-add">
              Add Ingredient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit ingredient dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent data-testid="dialog-edit-ingredient">
          <DialogHeader>
            <DialogTitle>Edit Ingredient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Ingredient</label>
              <p className="text-sm text-muted-foreground mt-1">{editingComponent?.name}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity</label>
              <Input
                type="number"
                step="0.01"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                data-testid="input-edit-qty"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Unit</label>
              <Select value={editUnitId} onValueChange={setEditUnitId}>
                <SelectTrigger data-testid="select-edit-unit">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {units?.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {formatUnitName(unit.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} data-testid="button-confirm-edit">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit inventory item dialog */}
      <Dialog open={!!editingInventoryItem} onOpenChange={(open) => !open && handleCloseItemEdit()}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-inventory-item">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="item-name">Item Name *</Label>
              <Input
                id="item-name"
                value={itemEditForm.name}
                onChange={(e) => setItemEditForm({ ...itemEditForm, name: e.target.value })}
                placeholder="Enter item name"
                data-testid="input-edit-item-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Select 
                value={itemEditForm.categoryId || undefined} 
                onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })}
              >
                <SelectTrigger id="item-category" data-testid="select-edit-item-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-price">Price per Unit *</Label>
              <Input
                id="item-price"
                type="number"
                step="0.01"
                value={itemEditForm.pricePerUnit}
                onChange={(e) => setItemEditForm({ ...itemEditForm, pricePerUnit: e.target.value })}
                placeholder="0.00"
                data-testid="input-edit-item-price"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseItemEdit}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveItemEdit}
              disabled={updateInventoryItemMutation.isPending}
              data-testid="button-save-inventory-item"
            >
              {updateInventoryItemMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drag overlay */}
      <DragOverlay>
        {draggedItem ? (
          <Card className="w-64 opacity-90">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                {draggedItem.type === "recipe" ? (
                  <ChefHat className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Package className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="font-medium text-sm">{draggedItem.name}</div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
