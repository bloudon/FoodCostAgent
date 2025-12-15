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
import { formatUnitName, formatRecipeName } from "@/lib/utils";
import {
  ArrowLeft,
  Save,
  Search,
  GripVertical,
  Trash2,
  ChefHat,
  Package,
  Plus,
  Copy,
  Link as LinkIcon,
} from "lucide-react";
import type { Recipe, RecipeComponent, Category, InventoryItem as BaseInventoryItem, Unit as BaseUnit } from "@shared/schema";

// Extended types for API responses with joined fields
type InventoryItem = BaseInventoryItem & {
  unitName?: string;
  categoryName?: string | null;
};

type Unit = BaseUnit;

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
  yieldOverride?: number | null;
  itemYieldPercent?: number | null;
};

// Inline ingredient row component with stacked form fields
function InlineIngredientRow({
  component,
  units,
  compatibleUnits,
  inventoryItems,
  recipes,
  onUpdate,
  onDelete,
}: {
  component: ComponentWithDetails;
  units: Unit[] | undefined;
  compatibleUnits: Unit[] | undefined;
  inventoryItems: InventoryItem[] | undefined;
  recipes: Recipe[] | undefined;
  onUpdate: (updated: ComponentWithDetails) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: component.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Use local string state for inputs to allow proper decimal entry
  const [localQty, setLocalQty] = useState(component.qty.toString());
  const [localYieldOverride, setLocalYieldOverride] = useState(
    component.yieldOverride != null ? component.yieldOverride.toString() : ""
  );
  // Track if inputs are focused to avoid overwriting while user is typing
  const [qtyFocused, setQtyFocused] = useState(false);
  const [yieldFocused, setYieldFocused] = useState(false);

  // Sync local state when component changes from outside (e.g., reorder, reload, save)
  // Only sync when the input is not focused to avoid overwriting user input
  useEffect(() => {
    if (!qtyFocused) {
      setLocalQty(component.qty.toString());
    }
  }, [component.qty, qtyFocused]);

  useEffect(() => {
    if (!yieldFocused) {
      setLocalYieldOverride(
        component.yieldOverride != null ? component.yieldOverride.toString() : ""
      );
    }
  }, [component.yieldOverride, yieldFocused]);

  // Get the default yield for inventory items
  const getDefaultYield = () => {
    if (component.componentType === "inventory_item") {
      const item = inventoryItems?.find(i => i.id === component.componentId);
      return item?.yieldPercent ?? 100;
    }
    return 100;
  };

  // Handle quantity change - update local state immediately, parse on blur
  const handleQtyChange = (value: string) => {
    setLocalQty(value);
  };

  // Track quantity focus
  const handleQtyFocus = () => setQtyFocused(true);

  // Commit quantity change on blur
  const handleQtyBlur = () => {
    setQtyFocused(false);
    const qty = parseFloat(localQty);
    if (!isNaN(qty) && qty > 0) {
      const updated = { ...component, qty };
      onUpdate(updated);
    } else {
      // Reset to component value if invalid
      setLocalQty(component.qty.toString());
    }
  };

  // Handle unit change
  const handleUnitChange = (unitId: string) => {
    const unitName = units?.find(u => u.id === unitId)?.name || "";
    const updated = { ...component, unitId, unitName };
    onUpdate(updated);
  };

  // Handle yield override change - update local state immediately
  const handleYieldOverrideChange = (value: string) => {
    setLocalYieldOverride(value);
  };

  // Track yield focus
  const handleYieldFocus = () => setYieldFocused(true);

  // Commit yield override change on blur
  const handleYieldOverrideBlur = () => {
    setYieldFocused(false);
    if (localYieldOverride === "") {
      const updated = { ...component, yieldOverride: null };
      onUpdate(updated);
    } else {
      const yieldOverride = parseFloat(localYieldOverride);
      if (!isNaN(yieldOverride) && yieldOverride >= 0 && yieldOverride <= 100) {
        const updated = { ...component, yieldOverride };
        onUpdate(updated);
      } else {
        // Reset to component value if invalid
        setLocalYieldOverride(
          component.yieldOverride != null ? component.yieldOverride.toString() : ""
        );
      }
    }
  };

  // Get compatible units - for the component's base item
  const getCompatibleUnitList = () => {
    if (compatibleUnits?.length) return compatibleUnits;
    return units || [];
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className="border rounded-lg p-4 bg-card"
      data-testid={`row-ingredient-${component.id}`}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <div 
          {...attributes} 
          {...listeners} 
          className="cursor-grab active:cursor-grabbing pt-1 flex-shrink-0"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Ingredient name and type indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            {component.componentType === "recipe" ? (
              <ChefHat className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="font-medium" data-testid={`text-ingredient-name-${component.id}`}>
              {component.name}
            </span>
            {component.componentType === "inventory_item" && component.yieldOverride != null && (
              <Badge variant="secondary" className="text-xs" data-testid={`badge-yield-override-${component.id}`}>
                {component.yieldOverride}% yield
              </Badge>
            )}
          </div>

          {/* Inline form fields - stacked layout */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Quantity field */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Quantity</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={localQty}
                onChange={(e) => handleQtyChange(e.target.value)}
                onFocus={handleQtyFocus}
                onBlur={handleQtyBlur}
                className="h-9"
                data-testid={`input-qty-${component.id}`}
              />
            </div>

            {/* Unit selector */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Unit</label>
              <Select value={component.unitId} onValueChange={handleUnitChange}>
                <SelectTrigger className="h-9" data-testid={`select-unit-${component.id}`}>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {getCompatibleUnitList().map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {formatUnitName(unit.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Yield override - only for inventory items */}
            {component.componentType === "inventory_item" ? (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Yield % <span className="opacity-60">(default: {getDefaultYield()}%)</span>
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder={`${getDefaultYield()}`}
                  value={localYieldOverride}
                  onChange={(e) => handleYieldOverrideChange(e.target.value)}
                  onFocus={handleYieldFocus}
                  onBlur={handleYieldOverrideBlur}
                  className="h-9"
                  data-testid={`input-yield-${component.id}`}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Cost</label>
                <div className="h-9 flex items-center font-mono text-sm" data-testid={`text-ingredient-cost-${component.id}`}>
                  ${component.cost.toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* Cost display for inventory items */}
          {component.componentType === "inventory_item" && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Calculated cost:</span>
              <span className="font-mono font-medium" data-testid={`text-ingredient-cost-${component.id}`}>
                ${component.cost.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="flex-shrink-0"
          data-testid={`button-delete-ingredient-${component.id}`}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
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
    data: { item }, // Pass item data so handleDragEnd can access it
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
  // isNew is true when id is undefined (from /recipes/new route) or equals "new"
  const isNew = !id || id === "new";

  // Get pre-populated name and menuItemId from URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const initialName = urlParams.get("name") || "";
  const menuItemIdToLink = urlParams.get("menuItemId") || null;

  // Recipe metadata state
  const [recipeName, setRecipeName] = useState(initialName);
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnitId, setYieldUnitId] = useState("");
  const [canBeIngredient, setCanBeIngredient] = useState(false);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);

  // Component management state
  const [components, setComponents] = useState<ComponentWithDetails[]>([]);
  const [draggedItem, setDraggedItem] = useState<DraggableItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [pendingItem, setPendingItem] = useState<DraggableItem | null>(null);
  const [dialogQty, setDialogQty] = useState("");
  const [dialogUnitId, setDialogUnitId] = useState("");
  const [baseUnitIdForAdd, setBaseUnitIdForAdd] = useState<string | null>(null);

  // Edit component dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentWithDetails | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnitId, setEditUnitId] = useState("");
  const [editYieldOverride, setEditYieldOverride] = useState("");
  const [baseUnitIdForEdit, setBaseUnitIdForEdit] = useState<string | null>(null);

  // Edit inventory item dialog state
  const [editingInventoryItem, setEditingInventoryItem] = useState<any | null>(null);
  const [itemEditForm, setItemEditForm] = useState({
    name: "",
    categoryId: "",
    pricePerUnit: "",
    caseSize: "",
  });

  // Clone as Size Variant dialog state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneSizeName, setCloneSizeName] = useState("");
  const [cloneScaleFactor, setCloneScaleFactor] = useState("1.0");
  const [cloneCreateMenuItem, setCloneCreateMenuItem] = useState(false);

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

  const { data: stores } = useQuery<any[]>({
    queryKey: ["/api/stores/accessible"],
  });

  const { data: recipeStores } = useQuery<any[]>({
    queryKey: ["/api/store-recipes", id],
    enabled: !isNew && !!id,
  });

  // Fetch compatible units for add dialog
  const { data: compatibleUnitsForAdd } = useQuery<Unit[]>({
    queryKey: ["/api/units/compatible", baseUnitIdForAdd],
    queryFn: async () => {
      if (!baseUnitIdForAdd) return [];
      const response = await fetch(`/api/units/compatible?unitId=${baseUnitIdForAdd}`);
      if (!response.ok) throw new Error('Failed to fetch compatible units');
      return response.json();
    },
    enabled: !!baseUnitIdForAdd && showAddDialog,
  });

  // Fetch compatible units for edit dialog
  const { data: compatibleUnitsForEdit } = useQuery<Unit[]>({
    queryKey: ["/api/units/compatible", baseUnitIdForEdit],
    queryFn: async () => {
      if (!baseUnitIdForEdit) return [];
      const response = await fetch(`/api/units/compatible?unitId=${baseUnitIdForEdit}`);
      if (!response.ok) throw new Error('Failed to fetch compatible units');
      return response.json();
    },
    enabled: !!baseUnitIdForEdit && editDialogOpen,
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
        // Use component's yieldOverride if set, otherwise item's default yieldPercent
        const yieldPercent = comp.yieldOverride != null ? comp.yieldOverride : item.yieldPercent;
        const yieldFactor = yieldPercent / 100;
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

  // Directly add ingredient (for drag-drop and click-to-add)
  const addIngredientDirectly = (item: DraggableItem) => {
    // Check if already added
    const existingIndex = components.findIndex(c => c.componentId === item.id);
    if (existingIndex !== -1) {
      toast({
        title: "Already added",
        description: `${item.name} is already in this recipe. Update the quantity instead.`,
      });
      return;
    }

    // Get default unit for the item
    let unitId = item.unitId;
    let unitName = item.unitName || "";
    
    if (item.type === "recipe") {
      const recipeItem = recipes?.find(r => r.id === item.id);
      if (recipeItem) {
        unitId = recipeItem.yieldUnitId;
        unitName = units?.find(u => u.id === recipeItem.yieldUnitId)?.name || "";
      }
    }

    if (!unitId) {
      toast({
        title: "Missing unit",
        description: "Could not determine unit for this item",
        variant: "destructive",
      });
      return;
    }

    const newComponent: ComponentWithDetails = {
      id: `temp-${Date.now()}`,
      recipeId: id || "",
      componentType: item.type,
      componentId: item.id,
      qty: 1, // Default quantity of 1
      unitId: unitId,
      sortOrder: components.length,
      name: item.name,
      unitName: unitName || units?.find(u => u.id === unitId)?.name || "",
      cost: 0,
      yieldOverride: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    newComponent.cost = calculateComponentCost(newComponent);
    setComponents([...components, newComponent]);
    
    toast({
      title: "Ingredient added",
      description: `${item.name} added to recipe. Adjust quantity below.`,
    });
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
      // Try to get item from drag data first, fall back to lookup
      const dragData = active.data?.current as { item?: DraggableItem } | undefined;
      let itemToAdd: DraggableItem | null = dragData?.item || null;
      
      if (!itemToAdd) {
        // Fall back to lookup by ID
        const itemId = activeId.replace("source-", "");
        const inventoryItem = inventoryItems?.find((i) => i.id === itemId);
        const recipeItem = recipes?.find((r) => r.id === itemId);

        if (inventoryItem) {
          itemToAdd = {
            id: inventoryItem.id,
            name: inventoryItem.name,
            type: "inventory_item",
            unitId: inventoryItem.unitId,
            unitName: inventoryItem.unitName,
            pricePerUnit: inventoryItem.pricePerUnit,
          };
        } else if (recipeItem) {
          itemToAdd = {
            id: recipeItem.id,
            name: recipeItem.name,
            type: "recipe",
          };
        }
      }
      
      if (itemToAdd) {
        addIngredientDirectly(itemToAdd);
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
    addIngredientDirectly(item);
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
      yieldOverride: null,
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
    
    // Set yield override and base unit ID based on component type
    if (component.componentType === "inventory_item") {
      const item = inventoryItems?.find(i => i.id === component.componentId);
      if (item) {
        setBaseUnitIdForEdit(item.unitId);
        // Set yield override to component's value or empty string
        setEditYieldOverride(component.yieldOverride != null ? component.yieldOverride.toString() : "");
      }
    } else if (component.componentType === "recipe") {
      const recipe = recipes?.find(r => r.id === component.componentId);
      if (recipe) {
        setBaseUnitIdForEdit(recipe.yieldUnitId);
      }
      setEditYieldOverride(""); // Sub-recipes don't have yield override
    }
    
    setEditDialogOpen(true);
  };

  // Save edited ingredient
  const handleSaveEdit = () => {
    if (!editingComponent || !editQty || !editUnitId) return;

    const updatedComponents = components.map((comp) => {
      if (comp.id === editingComponent.id) {
        // Only apply yield override for inventory items, not sub-recipes
        const yieldOverrideValue = editingComponent.componentType === "inventory_item" && editYieldOverride 
          ? parseFloat(editYieldOverride) 
          : null;
        
        const updated = {
          ...comp,
          qty: parseFloat(editQty),
          unitId: editUnitId,
          unitName: units?.find((u) => u.id === editUnitId)?.name || "",
          yieldOverride: yieldOverrideValue,
        };
        updated.cost = calculateComponentCost(updated);
        return updated;
      }
      return comp;
    });

    setComponents(updatedComponents);
    setEditDialogOpen(false);
    setEditingComponent(null);
    setEditYieldOverride("");
  };

  // Delete ingredient
  const handleDeleteIngredient = (componentId: string) => {
    setComponents(components.filter((c) => c.id !== componentId));
  };

  // Handle inline component update
  const handleInlineComponentUpdate = (updated: ComponentWithDetails) => {
    const updatedComponents = components.map((comp) => {
      if (comp.id === updated.id) {
        // Recalculate cost with updated values
        const withCost = { ...updated };
        withCost.cost = calculateComponentCost(withCost);
        return withCost;
      }
      return comp;
    });
    setComponents(updatedComponents);
  };

  // Get compatible units for a specific component (for inline editing)
  const getCompatibleUnitsForComponent = (component: ComponentWithDetails): Unit[] => {
    let baseUnitId: string | undefined;
    
    if (component.componentType === "inventory_item") {
      const item = inventoryItems?.find(i => i.id === component.componentId);
      baseUnitId = item?.unitId;
    } else if (component.componentType === "recipe") {
      const recipe = recipes?.find(r => r.id === component.componentId);
      baseUnitId = recipe?.yieldUnitId;
    }

    if (!baseUnitId || !units) return units || [];

    // Get the base unit to determine its kind (mass, volume, count)
    const baseUnit = units.find(u => u.id === baseUnitId);
    if (!baseUnit) return units;

    // Filter to units of the same kind
    return units.filter(u => u.kind === baseUnit.kind);
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
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components", id] });
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
        const response = await apiRequest("POST", "/api/recipes", recipeData);
        const createdRecipe = await response.json();
        recipeId = createdRecipe.id;
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
        const compData: Record<string, any> = {
          recipeId,
          componentType: comp.componentType,
          componentId: comp.componentId,
          qty: comp.qty,
          unitId: comp.unitId,
          sortOrder: index,
        };
        
        // Only include yieldOverride for inventory items when it has a value
        if (comp.componentType === "inventory_item" && comp.yieldOverride != null) {
          compData.yieldOverride = comp.yieldOverride;
        }

        return apiRequest("POST", "/api/recipe-components", compData);
      });

      await Promise.all(componentPromises);

      // Handle store assignments
      if (!isNew && recipeStores) {
        const currentStoreIds = recipeStores.map((rs: any) => rs.storeId);
        const storesToAdd = selectedStores.filter(sid => !currentStoreIds.includes(sid));
        const storesToRemove = currentStoreIds.filter((sid: string) => !selectedStores.includes(sid));
        
        // Create new assignments
        await Promise.all(
          storesToAdd.map(storeId =>
            apiRequest("POST", `/api/store-recipes/${recipeId}/${storeId}`, {})
          )
        );
        
        // Remove old assignments
        await Promise.all(
          storesToRemove.map(storeId =>
            apiRequest("DELETE", `/api/store-recipes/${recipeId}/${storeId}`, undefined)
          )
        );
      } else if (isNew) {
        // For new recipes, create all assignments
        await Promise.all(
          selectedStores.map(storeId =>
            apiRequest("POST", `/api/store-recipes/${recipeId}/${storeId}`, {})
          )
        );
      }

      // If we have a menuItemId to link, auto-link the recipe to the menu item
      if (isNew && menuItemIdToLink) {
        await apiRequest("POST", `/api/menu-items/${menuItemIdToLink}/link-recipe`, {
          recipeId,
        });
      }

      return recipeId;
    },
    onSuccess: (recipeId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-components"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store-recipes"] });
      
      if (menuItemIdToLink) {
        toast({ title: "Recipe saved and linked to menu item" });
        // Clean up the edit draft since we're linking successfully
        sessionStorage.removeItem('menu-item-edit-draft');
        setLocation(`/menu-items`);
      } else {
        toast({ title: "Recipe saved successfully" });
        setLocation(`/recipes/${recipeId}`);
      }
    },
    onError: () => {
      toast({ title: "Failed to save recipe", variant: "destructive" });
    },
  });

  // Clone recipe as size variant mutation
  const cloneRecipeMutation = useMutation({
    mutationFn: async () => {
      const scaleFactor = parseFloat(cloneScaleFactor);
      if (isNaN(scaleFactor) || scaleFactor <= 0) {
        throw new Error("Invalid scale factor");
      }

      const response = await apiRequest("POST", `/api/recipes/${id}/clone`, {
        sizeName: cloneSizeName.trim(),
        scaleFactor,
        createMenuItem: cloneCreateMenuItem,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      toast({ 
        title: "Size variant created",
        description: `Created "${data.recipe.name}" with scaled ingredients`,
      });
      setCloneDialogOpen(false);
      setCloneSizeName("");
      setCloneScaleFactor("1.0");
      setCloneCreateMenuItem(false);
      // Navigate to the new recipe
      setLocation(`/recipes/${data.recipe.id}`);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to create size variant", 
        description: error.message || "An error occurred",
        variant: "destructive" 
      });
    },
  });

  // Filter source items
  const filteredInventoryItems = inventoryItems?.filter((item) => {
    // Search filter - match by name OR pluSku
    const searchLower = searchTerm.toLowerCase();
    const nameMatch = item.name.toLowerCase().includes(searchLower);
    const skuMatch = item.pluSku?.toLowerCase().includes(searchLower);
    if (!nameMatch && !skuMatch) {
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
    name: formatRecipeName(recipe.name),
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

  // Update component costs when inventory items or recipes change (e.g., after editing an item)
  useEffect(() => {
    if (components.length > 0 && inventoryItems && recipes) {
      const updatedComponents = components.map((comp) => {
        const updated = { ...comp };
        updated.cost = calculateComponentCost(updated);
        return updated;
      });
      
      // Only update if costs actually changed
      const costsChanged = updatedComponents.some((updated, idx) => 
        updated.cost !== components[idx].cost
      );
      
      if (costsChanged) {
        setComponents(updatedComponents);
      }
    }
  }, [inventoryItems, recipes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load selected stores when editing
  useEffect(() => {
    if (!isNew && recipeStores) {
      const storeIds = recipeStores.map((rs: any) => rs.storeId);
      // Only update if different to avoid infinite loop
      const currentIds = selectedStores.slice().sort().join(',');
      const newIds = storeIds.slice().sort().join(',');
      if (currentIds !== newIds) {
        setSelectedStores(storeIds);
      }
    }
  }, [isNew, recipeStores]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    {isNew && menuItemIdToLink && menuItems && (() => {
                      const menuItem = menuItems.find((mi: any) => mi.id === menuItemIdToLink);
                      if (menuItem) {
                        return (
                          <Badge variant="default" className="bg-green-600">
                            <LinkIcon className="h-3 w-3 mr-1" />
                            Will link to: {menuItem.name}
                          </Badge>
                        );
                      }
                      return null;
                    })()}
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
                    {menuItemIdToLink 
                      ? "Build your recipe, then save to automatically link it to your menu item"
                      : "Drag ingredients from the left to build your recipe"
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Clone as Size Variant button - only show for existing recipes */}
                {!isNew && id && (
                  <Button
                    variant="outline"
                    onClick={() => setCloneDialogOpen(true)}
                    disabled={cloneRecipeMutation.isPending}
                    data-testid="button-clone-recipe"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Clone as Size
                  </Button>
                )}
                <Button
                  onClick={() => {
                    // Validate at least one store is selected
                    if (selectedStores.length === 0) {
                      toast({
                        title: "Store Required",
                        description: "Please select at least one store location",
                        variant: "destructive",
                      });
                      return;
                    }
                    saveRecipeMutation.mutate();
                  }}
                  disabled={
                    saveRecipeMutation.isPending ||
                    !recipeName ||
                    !yieldQty ||
                    !yieldUnitId ||
                    components.length === 0 ||
                    selectedStores.length === 0
                  }
                  data-testid="button-save-recipe"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveRecipeMutation.isPending ? "Saving..." : "Save Recipe"}
                </Button>
              </div>
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

                        {/* Store Assignments */}
                        <div className="space-y-3 pt-4 border-t">
                          <label className="text-sm font-medium">
                            Store Locations *
                          </label>
                          <div className="space-y-2">
                            {stores?.map((store) => (
                              <div key={store.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`store-${store.id}`}
                                  checked={selectedStores.includes(store.id)}
                                  onCheckedChange={() => {
                                    setSelectedStores(prev =>
                                      prev.includes(store.id)
                                        ? prev.filter(id => id !== store.id)
                                        : [...prev, store.id]
                                    );
                                  }}
                                  data-testid={`checkbox-store-${store.id}`}
                                />
                                <label
                                  htmlFor={`store-${store.id}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  {store.name}
                                </label>
                              </div>
                            ))}
                          </div>
                          {selectedStores.length === 0 && (
                            <p className="text-sm text-destructive">
                              At least one store location is required
                            </p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>

              {/* Ingredients list with inline editing */}
              <Card
                ref={setCanvasRef}
                id="recipe-canvas"
                className="flex-1 overflow-hidden flex flex-col min-h-0"
              >
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <h3 className="text-sm font-medium">Ingredients ({components.length})</h3>
                  {components.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      Drag to reorder
                    </span>
                  )}
                </CardHeader>
                <CardContent className="flex-1 overflow-auto">
                  {components.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
                      <ChefHat className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-1">No ingredients yet</h3>
                      <p className="text-muted-foreground mb-2">
                        Drag items from the left panel or click the + button to add
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Drop items here to get started
                      </p>
                    </div>
                  ) : (
                    <SortableContext
                      items={components.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-3">
                        {components.map((component) => (
                          <InlineIngredientRow
                            key={component.id}
                            component={component}
                            units={units}
                            compatibleUnits={getCompatibleUnitsForComponent(component)}
                            inventoryItems={inventoryItems}
                            recipes={recipes}
                            onUpdate={handleInlineComponentUpdate}
                            onDelete={() => handleDeleteIngredient(component.id)}
                          />
                        ))}
                      </div>
                    </SortableContext>
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
                  {(compatibleUnitsForAdd?.length ? compatibleUnitsForAdd : units)?.map((unit) => (
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
                  {(compatibleUnitsForEdit?.length ? compatibleUnitsForEdit : units)?.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {formatUnitName(unit.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Yield override - only for inventory items */}
            {editingComponent?.componentType === "inventory_item" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Yield Override (%)</label>
                <div className="text-xs text-muted-foreground mb-1">
                  {(() => {
                    const item = inventoryItems?.find(i => i.id === editingComponent?.componentId);
                    return item?.yieldPercent != null 
                      ? `Default yield: ${item.yieldPercent}%` 
                      : "No default yield set";
                  })()}
                </div>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="Leave empty to use default"
                  value={editYieldOverride}
                  onChange={(e) => setEditYieldOverride(e.target.value)}
                  data-testid="input-edit-yield-override"
                />
                <p className="text-xs text-muted-foreground">
                  Override the yield percentage for this ingredient in this recipe only.
                </p>
              </div>
            )}
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

      {/* Clone as Size Variant dialog */}
      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent data-testid="dialog-clone-recipe">
          <DialogHeader>
            <DialogTitle>Clone as Size Variant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a new size variant of this recipe. All ingredients will be copied and scaled by the factor you specify.
            </p>
            <div className="space-y-2">
              <Label htmlFor="clone-size-name">Size Name *</Label>
              <Input
                id="clone-size-name"
                value={cloneSizeName}
                onChange={(e) => setCloneSizeName(e.target.value)}
                placeholder="e.g., Small, Large, Family"
                data-testid="input-clone-size-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clone-scale-factor">Scale Factor *</Label>
              <Input
                id="clone-scale-factor"
                type="number"
                step="0.1"
                min="0.1"
                value={cloneScaleFactor}
                onChange={(e) => setCloneScaleFactor(e.target.value)}
                placeholder="e.g., 0.75 for smaller, 1.5 for larger"
                data-testid="input-clone-scale-factor"
              />
              <p className="text-xs text-muted-foreground">
                Use 0.75 for 75% smaller, 1.5 for 50% larger, etc.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="clone-create-menu-item"
                checked={cloneCreateMenuItem}
                onCheckedChange={(checked) => setCloneCreateMenuItem(checked === true)}
                data-testid="checkbox-clone-menu-item"
              />
              <Label htmlFor="clone-create-menu-item" className="text-sm font-normal">
                Also create a menu item for this size
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => cloneRecipeMutation.mutate()}
              disabled={cloneRecipeMutation.isPending || !cloneSizeName.trim() || !cloneScaleFactor}
              data-testid="button-confirm-clone"
            >
              {cloneRecipeMutation.isPending ? "Creating..." : "Create Size Variant"}
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
