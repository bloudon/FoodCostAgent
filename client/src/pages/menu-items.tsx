import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Upload, Package, Search, Filter, Plus, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown, Layers, Link as LinkIcon, PlusCircle, ExternalLink } from "lucide-react";
import { useStoreContext } from "@/hooks/use-store-context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertMenuItemSchema } from "@shared/schema";
import { z } from "zod";
import { formatRecipeName } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MenuItem {
  id: string;
  companyId: string;
  name: string;
  department: string | null;
  category: string | null;
  size: string | null;
  pluSku: string;
  recipeId: string | null;
  parentMenuItemId: string | null;
  isRecipeItem: number;
  active: number;
  price: number | null;
  sortOrder: number;
  storeIds: string[];
  recipe?: {
    id: string;
    name: string;
    computedCost: number;
    isPlaceholder: number;
  } | null;
}

interface MenuItemHierarchy {
  parent: MenuItem;
  variants: MenuItem[];
}

interface Recipe {
  id: string;
  name: string;
  isPlaceholder: number;
  computedCost: number;
}

interface MenuItemSize {
  id: string;
  companyId: string;
  name: string;
  sortOrder: number;
  isDefault: number;
  active: number;
}

interface ParsedMenuItem {
  name: string;
  department: string;
  category: string;
  size: string;
  pluSku: string;
  isRecipeItem: boolean;
}

interface ParseResult {
  items: ParsedMenuItem[];
  posLocationId: string;
  stats: {
    totalRows: number;
    uniqueItems: number;
    recipeItems: number;
    nonRecipeItems: number;
  };
}

// Form schema for manual menu item creation
const addMenuItemFormSchema = insertMenuItemSchema
  .omit({ companyId: true })
  .extend({
    name: z.string().min(1, "Item name is required"),
    pluSku: z.string().min(1, "PLU/SKU is required"),
    department: z.string().optional(),
    category: z.string().optional(),
    size: z.string().optional(),
    menuItemSizeId: z.string().nullable().optional(),
    isRecipeItem: z.number(),
    active: z.number(),
  });

type AddMenuItemForm = z.infer<typeof addMenuItemFormSchema>;

// Form schema for adding a size variant
const addVariantFormSchema = z.object({
  size: z.string().min(1, "Size is required"),
  menuItemSizeId: z.string().nullable().optional(),
  pluSku: z.string().min(1, "PLU/SKU is required"),
  price: z.number().nullable().optional(),
  createRecipeFromParent: z.boolean().default(false),
  scaleRecipe: z.number().min(0.1).max(10).default(1),
});

type AddVariantForm = z.infer<typeof addVariantFormSchema>;

export default function MenuItemsPage() {
  const [search, setSearch] = useState("");
  const { selectedStoreId } = useStoreContext();
  const selectedStore = selectedStoreId || "all";
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"recipe" | "non-recipe" | "all">("all");
  const [viewMode, setViewMode] = useState<"hierarchy" | "flat">("hierarchy");
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedStoreForImport, setSelectedStoreForImport] = useState<string>("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedStoresForAdd, setSelectedStoresForAdd] = useState<string[]>([]);
  const [selectedStoresForEdit, setSelectedStoresForEdit] = useState<string[]>([]);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [addVariantDialogOpen, setAddVariantDialogOpen] = useState(false);
  const [selectedParentForVariant, setSelectedParentForVariant] = useState<MenuItem | null>(null);
  const { toast } = useToast();

  const form = useForm<AddMenuItemForm>({
    resolver: zodResolver(addMenuItemFormSchema),
    defaultValues: {
      name: "",
      department: "",
      category: "",
      size: "",
      menuItemSizeId: null,
      pluSku: "",
      isRecipeItem: 1,
      active: 1,
      recipeId: null,
      servingSizeQty: 1,
      servingUnitId: null,
      price: null,
    },
  });

  const editForm = useForm<AddMenuItemForm>({
    resolver: zodResolver(addMenuItemFormSchema),
    defaultValues: {
      name: "",
      department: "",
      category: "",
      size: "",
      menuItemSizeId: null,
      pluSku: "",
      isRecipeItem: 0,
      active: 1,
      recipeId: null,
      servingSizeQty: 1,
      servingUnitId: null,
      price: null,
    },
  });

  const variantForm = useForm<AddVariantForm>({
    resolver: zodResolver(addVariantFormSchema),
    defaultValues: {
      size: "",
      pluSku: "",
      price: null,
      createRecipeFromParent: true,
      scaleRecipe: 1,
    },
  });

  const { data: stores } = useAccessibleStores();

  // Fetch hierarchical menu items
  const { data: hierarchy, isLoading: isLoadingHierarchy } = useQuery<MenuItemHierarchy[]>({
    queryKey: ["/api/menu-items/hierarchy"],
    enabled: viewMode === "hierarchy",
  });

  // Fetch flat menu items (for flat view and recipes lookup)
  const { data: menuItems, isLoading: isLoadingFlat } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
  });

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: menuItemSizes } = useQuery<MenuItemSize[]>({
    queryKey: ["/api/menu-item-sizes"],
  });

  // Find the "One Size" default size
  const oneSizeDefault = menuItemSizes?.find(s => s.isDefault === 1 && s.name === "One Size");

  const isLoading = viewMode === "hierarchy" ? isLoadingHierarchy : isLoadingFlat;

  // Save form data before navigating to recipe builder
  const saveFormDraft = () => {
    const formData = form.getValues();
    const draft = {
      formData,
      selectedStores: selectedStoresForAdd,
    };
    sessionStorage.setItem('menu-item-draft', JSON.stringify(draft));
  };

  // Restore form data from sessionStorage when dialog opens
  useEffect(() => {
    if (addDialogOpen) {
      const savedData = sessionStorage.getItem('menu-item-draft');
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          form.reset(parsed.formData);
          setSelectedStoresForAdd(parsed.selectedStores || []);
          
          toast({
            title: "Draft Restored",
            description: "Your unsaved menu item was restored",
          });
        } catch (error) {
          console.error('Failed to restore draft:', error);
        }
      }
    }
  }, [addDialogOpen]);

  const parseCSVMutation = useMutation({
    mutationFn: async (csvContent: string) => {
      const response = await apiRequest("POST", "/api/menu-items/import-csv", { csvContent });
      const data = await response.json();
      return data as ParseResult;
    },
    onSuccess: (data: ParseResult) => {
      setParseResult(data);
      const uniqueCount = data?.stats?.uniqueItems || 0;
      toast({
        title: "CSV Parsed Successfully",
        description: `Found ${uniqueCount} unique menu items`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Parse Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async ({ items, storeId }: { items: ParsedMenuItem[]; storeId: string }) => {
      const response = await apiRequest("POST", "/api/menu-items/bulk-create", { items, storeId });
      return await response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Import Complete",
        description: `Created ${data.created} menu items`,
      });
      setCsvDialogOpen(false);
      setCsvContent("");
      setParseResult(null);
      setSelectedStoreForImport("");
    },
    onError: (error: Error) => {
      toast({
        title: "Import Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: AddMenuItemForm) => {
      const response = await apiRequest("POST", "/api/menu-items", data);
      const menuItem = await response.json();
      
      // Create store assignments
      await Promise.all(
        selectedStoresForAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${menuItem.id}/${storeId}`, {})
        )
      );
      
      return menuItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Menu Item Created",
        description: "Successfully created menu item",
      });
      sessionStorage.removeItem('menu-item-draft');
      setAddDialogOpen(false);
      setSelectedStoresForAdd([]);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to create a variant group (parent + first size variant)
  const createVariantGroupMutation = useMutation({
    mutationFn: async ({ data, sizeId, sizeName }: { data: AddMenuItemForm; sizeId: string; sizeName: string }) => {
      // Step 1: Create parent menu item (group header) - no size, no price, no PLU
      const parentResponse = await apiRequest("POST", "/api/menu-items", {
        name: data.name,
        department: data.department,
        category: data.category,
        isRecipeItem: data.isRecipeItem,
        active: data.active,
        // Parent has no size, price, PLU, or recipe
        size: null,
        menuItemSizeId: null,
        pluSku: `${data.pluSku}-GROUP`,
        price: null,
        recipeId: null,
      });
      const parentItem = await parentResponse.json();
      
      // Create store assignments for parent
      await Promise.all(
        selectedStoresForAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${parentItem.id}/${storeId}`, {})
        )
      );
      
      // Step 2: Create child variant with the selected size
      const variantResponse = await apiRequest("POST", `/api/menu-items/${parentItem.id}/variants`, {
        size: sizeName,
        menuItemSizeId: sizeId,
        pluSku: data.pluSku,
        price: data.price,
        createRecipeFromParent: false,
        scaleRecipe: 1,
      });
      const variant = await variantResponse.json();
      
      // Step 3: Create store assignments for child variant (same as parent)
      await Promise.all(
        selectedStoresForAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${variant.id}/${storeId}`, {})
        )
      );
      
      // Update variant with recipe if specified
      if (data.recipeId) {
        await apiRequest("POST", `/api/menu-items/${variant.id}/link-recipe`, {
          recipeId: data.recipeId,
        });
      }
      
      return { parent: parentItem, variant };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Menu Item Group Created",
        description: "Successfully created menu item with size variant",
      });
      sessionStorage.removeItem('menu-item-draft');
      setAddDialogOpen(false);
      setSelectedStoresForAdd([]);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: number }) => {
      const response = await apiRequest("PATCH", `/api/menu-items/${id}`, { active });
      return await response.json();
    },
    onSuccess: (data: MenuItem) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Status Updated",
        description: `Menu item ${data.active ? "activated" : "deactivated"}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data, storeIds }: { id: string; data: Partial<AddMenuItemForm>; storeIds: string[] }) => {
      const response = await apiRequest("PATCH", `/api/menu-items/${id}`, data);
      const menuItem = await response.json();
      
      // Update store assignments - first get current assignments
      const currentStoreIds = editingItem?.storeIds || [];
      
      // Remove store assignments that are no longer selected
      const toRemove = currentStoreIds.filter(storeId => !storeIds.includes(storeId));
      await Promise.all(
        toRemove.map(storeId =>
          apiRequest("DELETE", `/api/store-menu-items/${id}/${storeId}`, {})
        )
      );
      
      // Add new store assignments
      const toAdd = storeIds.filter(storeId => !currentStoreIds.includes(storeId));
      await Promise.all(
        toAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${id}/${storeId}`, {})
        )
      );
      
      return menuItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Menu Item Updated",
        description: "Successfully updated menu item",
      });
      sessionStorage.removeItem('menu-item-edit-draft');
      setEditDialogOpen(false);
      setEditingItem(null);
      setSelectedStoresForEdit([]);
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createVariantMutation = useMutation({
    mutationFn: async ({ parentId, data }: { parentId: string; data: AddVariantForm }) => {
      const response = await apiRequest("POST", `/api/menu-items/${parentId}/variants`, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      toast({
        title: "Size Variant Created",
        description: "Successfully created size variant",
      });
      setAddVariantDialogOpen(false);
      setSelectedParentForVariant(null);
      variantForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddMenuItem = (data: AddMenuItemForm) => {
    if (selectedStoresForAdd.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one store",
        variant: "destructive",
      });
      return;
    }
    
    // Check if a non-"One Size" size is selected - need to create variant group
    const selectedSize = menuItemSizes?.find(s => s.id === data.menuItemSizeId);
    const isOneSize = !data.menuItemSizeId || (selectedSize && selectedSize.name === "One Size");
    
    if (!isOneSize && data.menuItemSizeId) {
      // Create variant group: parent item + first variant
      createVariantGroupMutation.mutate({
        data,
        sizeId: data.menuItemSizeId,
        sizeName: selectedSize?.name || "Unknown",
      });
    } else {
      // Standard standalone item creation
      createItemMutation.mutate(data);
    }
  };

  const handleToggleActive = (item: MenuItem) => {
    toggleActiveMutation.mutate({
      id: item.id,
      active: item.active === 1 ? 0 : 1,
    });
  };

  const handleEditMenuItem = (item: MenuItem) => {
    setEditingItem(item);
    editForm.reset({
      name: item.name,
      department: item.department || "",
      category: item.category || "",
      size: item.size || "",
      pluSku: item.pluSku,
      isRecipeItem: item.isRecipeItem,
      active: item.active,
      recipeId: item.recipeId,
      price: item.price,
    });
    setSelectedStoresForEdit(item.storeIds || []);
    setEditDialogOpen(true);
  };

  const handleUpdateMenuItem = (data: AddMenuItemForm) => {
    if (!editingItem) return;
    
    if (selectedStoresForEdit.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one store",
        variant: "destructive",
      });
      return;
    }
    
    const payload: Partial<AddMenuItemForm> = {
      name: data.name,
      pluSku: data.pluSku,
      isRecipeItem: data.isRecipeItem,
      active: data.active,
      recipeId: data.recipeId || null,
      department: data.department || undefined,
      category: data.category || undefined,
      size: data.size || undefined,
      price: data.price ?? undefined,
    };
    updateItemMutation.mutate({ id: editingItem.id, data: payload, storeIds: selectedStoresForEdit });
  };

  const handleAddVariant = (parentItem: MenuItem) => {
    setSelectedParentForVariant(parentItem);
    variantForm.reset({
      size: "",
      menuItemSizeId: null,
      pluSku: `${parentItem.pluSku}-`,
      price: null,
      createRecipeFromParent: parentItem.recipeId ? true : false,
      scaleRecipe: 1,
    });
    setAddVariantDialogOpen(true);
  };

  const handleCreateVariant = (data: AddVariantForm) => {
    if (!selectedParentForVariant) return;
    
    // Find the menuItemSizeId from the size name
    const selectedSize = menuItemSizes?.find(s => s.name === data.size);
    
    createVariantMutation.mutate({
      parentId: selectedParentForVariant.id,
      data: {
        ...data,
        menuItemSizeId: selectedSize?.id || null,
      },
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkImport = () => {
    if (!parseResult || !selectedStoreForImport) return;
    bulkCreateMutation.mutate({
      items: parseResult.items,
      storeId: selectedStoreForImport,
    });
  };

  // Get unique departments and categories for filters
  const uniqueDepartments = Array.from(new Set(
    menuItems?.map(item => item.department).filter((dept): dept is string => Boolean(dept)) || []
  )).sort();
  const uniqueCategories = Array.from(new Set(
    menuItems?.map(item => item.category).filter((cat): cat is string => Boolean(cat)) || []
  )).sort();

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-2 h-4 w-4" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    );
  };

  // Filter hierarchy data
  const filteredHierarchy = hierarchy?.filter((group) => {
    const matchesSearch = 
      group.parent.name?.toLowerCase().includes(search.toLowerCase()) ||
      group.parent.pluSku?.toLowerCase().includes(search.toLowerCase()) ||
      group.variants.some(v => 
        v.name?.toLowerCase().includes(search.toLowerCase()) ||
        v.pluSku?.toLowerCase().includes(search.toLowerCase())
      );
    const matchesActive = 
      activeFilter === "all" ? true :
      activeFilter === "active" ? group.parent.active === 1 :
      group.parent.active === 0;
    const matchesDepartment = departmentFilter === "all" || group.parent.department === departmentFilter;
    const matchesCategory = categoryFilter === "all" || group.parent.category === categoryFilter;
    const matchesType = 
      typeFilter === "all" ? true :
      typeFilter === "recipe" ? group.parent.isRecipeItem === 1 :
      group.parent.isRecipeItem === 0;
    const matchesStore = selectedStore === "all" || 
      (group.parent.storeIds && group.parent.storeIds.includes(selectedStore));
    
    return matchesSearch && matchesActive && matchesDepartment && matchesCategory && matchesType && matchesStore;
  }) || [];

  // Filter flat items for flat view
  const filteredItems = menuItems?.filter((item) => {
    const matchesSearch = item.name?.toLowerCase().includes(search.toLowerCase()) ||
      item.pluSku?.toLowerCase().includes(search.toLowerCase());
    const matchesActive = 
      activeFilter === "all" ? true :
      activeFilter === "active" ? item.active === 1 :
      item.active === 0;
    const matchesDepartment = departmentFilter === "all" || item.department === departmentFilter;
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    const matchesType = 
      typeFilter === "all" ? true :
      typeFilter === "recipe" ? item.isRecipeItem === 1 :
      item.isRecipeItem === 0;
    const matchesStore = selectedStore === "all" || (item.storeIds && item.storeIds.includes(selectedStore));
    return matchesSearch && matchesActive && matchesDepartment && matchesCategory && matchesType && matchesStore;
  }) || [];

  // Apply sorting for flat view
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (!sortField) return 0;

    const recipe_a = a.recipeId ? recipes?.find((r) => r.id === a.recipeId) : null;
    const recipe_b = b.recipeId ? recipes?.find((r) => r.id === b.recipeId) : null;

    let aValue: any;
    let bValue: any;

    switch (sortField) {
      case "name":
        aValue = a.name?.toLowerCase() || "";
        bValue = b.name?.toLowerCase() || "";
        break;
      case "department":
        aValue = a.department?.toLowerCase() || "";
        bValue = b.department?.toLowerCase() || "";
        break;
      case "category":
        aValue = a.category?.toLowerCase() || "";
        bValue = b.category?.toLowerCase() || "";
        break;
      case "size":
        aValue = a.size?.toLowerCase() || "";
        bValue = b.size?.toLowerCase() || "";
        break;
      case "pluSku":
        aValue = a.pluSku?.toLowerCase() || "";
        bValue = b.pluSku?.toLowerCase() || "";
        break;
      case "recipeCost":
        aValue = recipe_a?.computedCost ?? -1;
        bValue = recipe_b?.computedCost ?? -1;
        break;
      case "price":
        aValue = a.price ?? -1;
        bValue = b.price ?? -1;
        break;
      case "foodCostPercent":
        const costA = recipe_a?.computedCost ?? 0;
        const priceA = a.price ?? 0;
        aValue = priceA > 0 ? (costA / priceA) * 100 : -1;
        
        const costB = recipe_b?.computedCost ?? 0;
        const priceB = b.price ?? 0;
        bValue = priceB > 0 ? (costB / priceB) * 100 : -1;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
    if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const renderRecipeCost = (item: MenuItem) => {
    const recipe = item.recipe || (item.recipeId ? recipes?.find(r => r.id === item.recipeId) : null);
    if (recipe) {
      return (
        <Link 
          href={`/recipes/${item.recipeId}`}
          className="hover:underline text-primary font-mono text-sm"
        >
          ${recipe.computedCost.toFixed(2)}
        </Link>
      );
    }
    return <span className="text-muted-foreground">-</span>;
  };

  const renderFoodCostPercent = (item: MenuItem) => {
    const recipe = item.recipe || (item.recipeId ? recipes?.find(r => r.id === item.recipeId) : null);
    if (recipe && item.price && item.price > 0) {
      const percent = (recipe.computedCost / item.price) * 100;
      const color = percent > 35 ? "text-destructive" : percent > 28 ? "text-amber-600" : "text-green-600";
      return <span className={`font-mono text-sm ${color}`}>{percent.toFixed(1)}%</span>;
    }
    return <span className="text-muted-foreground">-</span>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Menu Items</h1>
          <p className="text-muted-foreground mt-1">
            Manage your menu items, sizes, and recipe links
          </p>
        </div>
        <div className="flex gap-2">
          {/* View Toggle */}
          <div className="flex gap-1 border rounded-lg p-1">
            <Button 
              variant={viewMode === "hierarchy" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("hierarchy")}
              data-testid="button-view-hierarchy"
            >
              <Layers className="h-4 w-4 mr-1" />
              Hierarchy
            </Button>
            <Button 
              variant={viewMode === "flat" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("flat")}
              data-testid="button-view-flat"
            >
              <Package className="h-4 w-4 mr-1" />
              Flat
            </Button>
          </div>

          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="default" data-testid="button-add-menu-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Menu Item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Menu Item</DialogTitle>
                <DialogDescription>
                  Create a new menu item. You can add size variants later.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleAddMenuItem)} className="space-y-4 py-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item Name *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g., Cheese Pizza"
                            data-testid="input-new-item-name"
                          />
                        </FormControl>
                        <FormDescription>
                          Use the base name without size (e.g., "Cheese Pizza" not "Cheese Pizza - Large")
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Pizza"
                              data-testid="input-new-item-department"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Specialty Pizzas"
                              data-testid="input-new-item-category"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="pluSku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PLU/SKU *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., CHZPZ"
                              data-testid="input-new-item-plu"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                              data-testid="input-new-item-price"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="menuItemSizeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Size</FormLabel>
                        <Select
                          value={field.value || (oneSizeDefault?.id || "one-size")}
                          onValueChange={(value) => field.onChange(value === "one-size" ? null : value)}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-new-item-size">
                              <SelectValue placeholder="Select a size..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {menuItemSizes?.filter(s => s.active === 1).map((size) => (
                              <SelectItem key={size.id} value={size.id}>
                                {size.name}
                              </SelectItem>
                            )) || <SelectItem value="one-size">One Size</SelectItem>}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Choose "One Size" for standalone items. Other sizes create variant groups.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="recipeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipe (Optional)</FormLabel>
                        <Select
                          value={field.value || "none"}
                          onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-new-item-recipe">
                              <SelectValue placeholder="Select a recipe..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {recipes?.map((recipe) => (
                              <SelectItem key={recipe.id} value={recipe.id}>
                                {formatRecipeName(recipe.name)} {recipe.isPlaceholder === 1 && "(Placeholder)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          <Link 
                            href={`/recipes/new?name=${encodeURIComponent(form.watch("name") || "")}`}
                            className="text-primary hover:underline text-sm"
                            onClick={saveFormDraft}
                            data-testid="link-create-recipe-add"
                          >
                            Create new recipe with this name
                          </Link>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-3">
                    <FormLabel>Store Locations *</FormLabel>
                    <div className="space-y-2">
                      {stores?.map((store) => (
                        <div key={store.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`add-store-${store.id}`}
                            checked={selectedStoresForAdd.includes(store.id)}
                            onCheckedChange={() => {
                              setSelectedStoresForAdd(prev =>
                                prev.includes(store.id)
                                  ? prev.filter(id => id !== store.id)
                                  : [...prev, store.id]
                              );
                            }}
                            data-testid={`checkbox-add-store-${store.id}`}
                          />
                          <label htmlFor={`add-store-${store.id}`} className="text-sm font-normal cursor-pointer flex-1">
                            {store.name}
                            {store.city && <span className="text-muted-foreground ml-2">({store.city})</span>}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <FormField
                    control={form.control}
                    name="isRecipeItem"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value === 1}
                            onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                            data-testid="checkbox-new-item-is-recipe"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">This is a recipe item (has food cost)</FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAddDialogOpen(false);
                        setSelectedStoresForAdd([]);
                        form.reset();
                      }}
                      data-testid="button-cancel-add-item"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createItemMutation.isPending || createVariantGroupMutation.isPending}
                      data-testid="button-confirm-add-item"
                    >
                      {(createItemMutation.isPending || createVariantGroupMutation.isPending) ? "Creating..." : "Add Item"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* Add Variant Dialog */}
          <Dialog open={addVariantDialogOpen} onOpenChange={setAddVariantDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Size Variant</DialogTitle>
                <DialogDescription>
                  Create a new size for "{selectedParentForVariant?.name}"
                </DialogDescription>
              </DialogHeader>
              <Form {...variantForm}>
                <form onSubmit={variantForm.handleSubmit(handleCreateVariant)} className="space-y-4 py-4">
                  <FormField
                    control={variantForm.control}
                    name="size"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Size *</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-variant-size">
                              <SelectValue placeholder="Select a size..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {menuItemSizes?.filter(s => s.active === 1 && s.name !== "One Size").map((size) => (
                              <SelectItem key={size.id} value={size.name}>
                                {size.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={variantForm.control}
                      name="pluSku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PLU/SKU *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., CHZPZ-SM"
                              data-testid="input-variant-plu"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={variantForm.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                              data-testid="input-variant-price"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {selectedParentForVariant?.recipeId && (
                    <>
                      <FormField
                        control={variantForm.control}
                        name="createRecipeFromParent"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid="checkbox-clone-recipe"
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">Clone recipe from parent</FormLabel>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {variantForm.watch("createRecipeFromParent") && (
                        <FormField
                          control={variantForm.control}
                          name="scaleRecipe"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Scale Recipe Ingredients</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  max="10"
                                  placeholder="1.0"
                                  value={field.value}
                                  onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
                                  data-testid="input-scale-recipe"
                                />
                              </FormControl>
                              <FormDescription>
                                Enter 0.5 for half size, 1.5 for 50% larger, 2.0 for double, etc.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  )}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAddVariantDialogOpen(false);
                        setSelectedParentForVariant(null);
                        variantForm.reset();
                      }}
                      data-testid="button-cancel-variant"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createVariantMutation.isPending}
                      data-testid="button-confirm-variant"
                    >
                      {createVariantMutation.isPending ? "Creating..." : "Add Size"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* Edit Menu Item Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Menu Item</DialogTitle>
                <DialogDescription>
                  Update menu item details
                </DialogDescription>
              </DialogHeader>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(handleUpdateMenuItem)} className="space-y-4 py-4">
                  <FormField
                    control={editForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item Name *</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-edit-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="pluSku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PLU/SKU *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-edit-plu" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                              data-testid="input-edit-price"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {editingItem?.parentMenuItemId && (
                    <FormField
                      control={editForm.control}
                      name="menuItemSizeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Size</FormLabel>
                          <Select
                            value={field.value || "one-size"}
                            onValueChange={(value) => field.onChange(value === "one-size" ? null : value)}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-size">
                                <SelectValue placeholder="Select a size..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {menuItemSizes?.filter(s => s.active === 1 && s.name !== "One Size").map((size) => (
                                <SelectItem key={size.id} value={size.id}>
                                  {size.name}
                                </SelectItem>
                              )) || <SelectItem value="one-size">One Size</SelectItem>}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Size for this variant
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={editForm.control}
                    name="recipeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipe</FormLabel>
                        <Select
                          value={field.value || "none"}
                          onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-recipe">
                              <SelectValue placeholder="Select a recipe..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {recipes?.map((recipe) => (
                              <SelectItem key={recipe.id} value={recipe.id}>
                                {formatRecipeName(recipe.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-3">
                    <FormLabel>Store Locations *</FormLabel>
                    <div className="space-y-2">
                      {stores?.map((store) => (
                        <div key={store.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`edit-store-${store.id}`}
                            checked={selectedStoresForEdit.includes(store.id)}
                            onCheckedChange={() => {
                              setSelectedStoresForEdit(prev =>
                                prev.includes(store.id)
                                  ? prev.filter(id => id !== store.id)
                                  : [...prev, store.id]
                              );
                            }}
                            data-testid={`checkbox-edit-store-${store.id}`}
                          />
                          <label htmlFor={`edit-store-${store.id}`} className="text-sm font-normal cursor-pointer flex-1">
                            {store.name}
                          </label>
                        </div>
                      ))}
                    </div>
                    {selectedStoresForEdit.length === 0 && (
                      <p className="text-sm text-destructive">At least one store must be selected</p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditDialogOpen(false);
                        setEditingItem(null);
                        editForm.reset();
                      }}
                      data-testid="button-cancel-edit"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateItemMutation.isPending}
                      data-testid="button-confirm-edit"
                    >
                      {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* CSV Import Dialog */}
          <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-csv">
                <Upload className="h-4 w-4 mr-2" />
                Import from POS
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Import Menu Items from POS</DialogTitle>
                <DialogDescription>
                  Upload your POS menu export CSV to bulk import menu items
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">CSV Content</label>
                  <textarea
                    className="w-full h-32 p-2 border rounded-md text-sm font-mono mt-1"
                    placeholder="Paste your CSV content here..."
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    data-testid="textarea-csv-content"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => parseCSVMutation.mutate(csvContent)}
                    disabled={!csvContent || parseCSVMutation.isPending}
                    data-testid="button-parse-csv"
                  >
                    {parseCSVMutation.isPending ? "Parsing..." : "Parse CSV"}
                  </Button>
                </div>

                {parseResult && (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Parse Results</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-4 text-center">
                          <div>
                            <div className="text-2xl font-bold">{parseResult.stats.totalRows}</div>
                            <div className="text-xs text-muted-foreground">Total Rows</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold">{parseResult.stats.uniqueItems}</div>
                            <div className="text-xs text-muted-foreground">Unique Items</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold">{parseResult.stats.recipeItems}</div>
                            <div className="text-xs text-muted-foreground">Recipe Items</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold">{parseResult.stats.nonRecipeItems}</div>
                            <div className="text-xs text-muted-foreground">Non-Recipe</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Assign to Store</label>
                      <Select 
                        value={selectedStoreForImport} 
                        onValueChange={setSelectedStoreForImport}
                      >
                        <SelectTrigger data-testid="select-store-for-import">
                          <SelectValue placeholder="Select a store..." />
                        </SelectTrigger>
                        <SelectContent>
                          {stores?.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border rounded-lg max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item Name</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead>PLU/SKU</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parseResult.items.slice(0, 10).map((item, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-medium">{item.name}</TableCell>
                              <TableCell>{item.department}</TableCell>
                              <TableCell>{item.category}</TableCell>
                              <TableCell>{item.size || "-"}</TableCell>
                              <TableCell className="font-mono text-sm">{item.pluSku}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {parseResult.items.length > 10 && (
                        <div className="p-2 text-center text-sm text-muted-foreground">
                          + {parseResult.items.length - 10} more items
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {parseResult && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setParseResult(null);
                      setCsvContent("");
                      setSelectedStoreForImport("");
                    }}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleBulkImport}
                    disabled={!selectedStoreForImport || bulkCreateMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    {bulkCreateMutation.isPending ? "Importing..." : `Import ${parseResult.items.length} Items`}
                  </Button>
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or PLU/SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-department-filter">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {uniqueDepartments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {uniqueCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={(val) => setTypeFilter(val as any)}>
                <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="recipe">Recipe Items</SelectItem>
                  <SelectItem value="non-recipe">Non-Recipe Items</SelectItem>
                </SelectContent>
              </Select>

              <Select value={activeFilter} onValueChange={(val) => setActiveFilter(val as any)}>
                <SelectTrigger className="w-[140px]" data-testid="select-active-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading menu items...</div>
            </div>
          ) : viewMode === "hierarchy" ? (
            // Hierarchical View
            filteredHierarchy.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No menu items found</h3>
                <p className="text-muted-foreground text-sm">
                  {search || activeFilter !== "active" || departmentFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Add menu items to get started"}
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[40%]">Menu Item</TableHead>
                      <TableHead>PLU/SKU</TableHead>
                      <TableHead className="text-right">Recipe Cost</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Food Cost %</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHierarchy.map((group, groupIndex) => (
                      <Collapsible key={group.parent.id} asChild open={expandedItems.has(group.parent.id)}>
                        <>
                          {/* Parent Row */}
                          <TableRow 
                            className={`${groupIndex % 2 === 1 ? "bg-muted/30" : ""} ${group.parent.active === 0 ? "opacity-60" : ""}`}
                            data-testid={`row-menu-item-${group.parent.id}`}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {group.variants.length > 0 && (
                                  <CollapsibleTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-6 w-6"
                                      onClick={() => toggleExpanded(group.parent.id)}
                                      data-testid={`button-expand-${group.parent.id}`}
                                    >
                                      {expandedItems.has(group.parent.id) ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </CollapsibleTrigger>
                                )}
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span 
                                      className="font-medium cursor-pointer hover:underline"
                                      onClick={() => handleEditMenuItem(group.parent)}
                                      data-testid={`text-menu-item-name-${group.parent.id}`}
                                    >
                                      {group.parent.name}
                                    </span>
                                    {group.parent.active === 0 && (
                                      <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                                    )}
                                    {group.variants.length > 0 && (
                                      <Badge variant="secondary" className="text-xs">
                                        {group.variants.length} size{group.variants.length > 1 ? 's' : ''}
                                      </Badge>
                                    )}
                                    {group.parent.recipeId && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Link href={`/recipes/${group.parent.recipeId}`}>
                                            <LinkIcon className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                          </Link>
                                        </TooltipTrigger>
                                        <TooltipContent>View Recipe</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                  {group.parent.department && (
                                    <span className="text-xs text-muted-foreground">
                                      {group.parent.department}
                                      {group.parent.category && ` › ${group.parent.category}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{group.parent.pluSku}</TableCell>
                            <TableCell className="text-right">{renderRecipeCost(group.parent)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {group.parent.price != null ? `$${group.parent.price.toFixed(2)}` : <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-right">{renderFoodCostPercent(group.parent)}</TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-actions-${group.parent.id}`}>
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditMenuItem(group.parent)} data-testid={`button-edit-${group.parent.id}`}>
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleAddVariant(group.parent)} data-testid={`button-add-size-${group.parent.id}`}>
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    Add Size Variant
                                  </DropdownMenuItem>
                                  {group.parent.recipeId && (
                                    <DropdownMenuItem asChild>
                                      <Link href={`/recipes/${group.parent.recipeId}`} className="flex items-center">
                                        <ExternalLink className="h-4 w-4 mr-2" />
                                        View Recipe
                                      </Link>
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleToggleActive(group.parent)} data-testid={`button-toggle-${group.parent.id}`}>
                                    {group.parent.active ? "Deactivate" : "Activate"}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>

                          {/* Variant Rows */}
                          <CollapsibleContent asChild>
                            <>
                              {group.variants.map((variant) => (
                                <TableRow 
                                  key={variant.id}
                                  className={`bg-muted/20 ${variant.active === 0 ? "opacity-60" : ""}`}
                                  data-testid={`row-menu-item-${variant.id}`}
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-2 pl-10">
                                      <span className="text-muted-foreground">└</span>
                                      <div className="flex items-center gap-2">
                                        <span 
                                          className="cursor-pointer hover:underline"
                                          onClick={() => handleEditMenuItem(variant)}
                                        >
                                          {variant.name}
                                        </span>
                                        {variant.size && (
                                          <Badge variant="outline" className="text-xs">{variant.size}</Badge>
                                        )}
                                        {variant.active === 0 && (
                                          <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                                        )}
                                        {variant.recipeId && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Link href={`/recipes/${variant.recipeId}`}>
                                                <LinkIcon className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                              </Link>
                                            </TooltipTrigger>
                                            <TooltipContent>View Recipe</TooltipContent>
                                          </Tooltip>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-mono text-sm">{variant.pluSku}</TableCell>
                                  <TableCell className="text-right">{renderRecipeCost(variant)}</TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {variant.price != null ? `$${variant.price.toFixed(2)}` : <span className="text-muted-foreground">-</span>}
                                  </TableCell>
                                  <TableCell className="text-right">{renderFoodCostPercent(variant)}</TableCell>
                                  <TableCell>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" data-testid={`button-actions-${variant.id}`}>
                                          <MoreVertical className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleEditMenuItem(variant)}>
                                          Edit
                                        </DropdownMenuItem>
                                        {variant.recipeId && (
                                          <DropdownMenuItem asChild>
                                            <Link href={`/recipes/${variant.recipeId}`} className="flex items-center">
                                              <ExternalLink className="h-4 w-4 mr-2" />
                                              View Recipe
                                            </Link>
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleToggleActive(variant)}>
                                          {variant.active ? "Deactivate" : "Activate"}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
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
              </div>
            )
          ) : (
            // Flat View (original table)
            sortedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No menu items found</h3>
                <p className="text-muted-foreground text-sm">
                  {search || activeFilter !== "active" || departmentFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Upload a POS CSV to import menu items"}
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleSort("name")}
                        data-testid="header-name"
                      >
                        <div className="flex items-center">
                          Item Name
                          {getSortIcon("name")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleSort("department")}
                        data-testid="header-department"
                      >
                        <div className="flex items-center">
                          Department
                          {getSortIcon("department")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleSort("category")}
                        data-testid="header-category"
                      >
                        <div className="flex items-center">
                          Category
                          {getSortIcon("category")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleSort("size")}
                        data-testid="header-size"
                      >
                        <div className="flex items-center">
                          Size
                          {getSortIcon("size")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleSort("pluSku")}
                        data-testid="header-pluSku"
                      >
                        <div className="flex items-center">
                          PLU/SKU
                          {getSortIcon("pluSku")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover-elevate"
                        onClick={() => handleSort("recipeCost")}
                        data-testid="header-recipeCost"
                      >
                        <div className="flex items-center justify-end">
                          Recipe Cost
                          {getSortIcon("recipeCost")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover-elevate"
                        onClick={() => handleSort("price")}
                        data-testid="header-price"
                      >
                        <div className="flex items-center justify-end">
                          Price
                          {getSortIcon("price")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover-elevate"
                        onClick={() => handleSort("foodCostPercent")}
                        data-testid="header-foodCostPercent"
                      >
                        <div className="flex items-center justify-end">
                          Food Cost %
                          {getSortIcon("foodCostPercent")}
                        </div>
                      </TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedItems.map((item, index) => {
                      const recipe = item.recipeId ? recipes?.find((r) => r.id === item.recipeId) : null;
                      const rowClass = index % 2 === 1 ? "bg-muted/30" : "";
                      
                      return (
                        <TableRow 
                          key={item.id} 
                          data-testid={`row-menu-item-${item.id}`}
                          className={`${rowClass} ${item.active === 0 ? "opacity-60" : ""}`}
                        >
                          <TableCell 
                            className="font-medium cursor-pointer hover-elevate" 
                            onClick={() => handleEditMenuItem(item)}
                            data-testid={`cell-item-name-${item.id}`}
                          >
                            {item.name}
                          </TableCell>
                          <TableCell>{item.department || "-"}</TableCell>
                          <TableCell>{item.category || "-"}</TableCell>
                          <TableCell>{item.size || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">{item.pluSku}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {recipe ? (
                              <Link 
                                href={`/recipes/${item.recipeId}`}
                                className="hover:underline text-primary"
                                data-testid={`link-recipe-cost-${item.recipeId}`}
                              >
                                ${recipe.computedCost.toFixed(2)}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {item.price != null ? (
                              `$${item.price.toFixed(2)}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`cell-food-cost-percent-${item.id}`}>
                            {recipe && item.price && item.price > 0 ? (
                              `${((recipe.computedCost / item.price) * 100).toFixed(1)}%`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  data-testid={`button-menu-item-actions-${item.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleEditMenuItem(item)}
                                  data-testid={`button-edit-${item.id}`}
                                >
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleToggleActive(item)}
                                  disabled={toggleActiveMutation.isPending}
                                  data-testid={`button-toggle-active-${item.id}`}
                                >
                                  {item.active ? "Deactivate" : "Activate"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          )}

          {viewMode === "hierarchy" && filteredHierarchy.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredHierarchy.length} menu item{filteredHierarchy.length !== 1 ? "s" : ""} with {filteredHierarchy.reduce((acc, g) => acc + g.variants.length, 0)} size variants
            </div>
          )}
          {viewMode === "flat" && sortedItems.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {sortedItems.length} menu item{sortedItems.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
