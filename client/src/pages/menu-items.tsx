import { useState } from "react";
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
import { Upload, Package, Search, Filter, Plus, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertMenuItemSchema } from "@shared/schema";
import { z } from "zod";

interface MenuItem {
  id: string;
  companyId: string;
  name: string;
  department: string | null;
  category: string | null;
  size: string | null;
  pluSku: string;
  recipeId: string | null;
  isRecipeItem: number;
  active: number;
  price: number | null;
}

interface Recipe {
  id: string;
  name: string;
  isPlaceholder: number;
  computedCost: number;
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
  .omit({ companyId: true }) // companyId will be added by backend
  .extend({
    name: z.string().min(1, "Item name is required"),
    pluSku: z.string().min(1, "PLU/SKU is required"),
    department: z.string().optional(),
    category: z.string().optional(),
    size: z.string().optional(),
    isRecipeItem: z.number(),
    active: z.number(),
  });

type AddMenuItemForm = z.infer<typeof addMenuItemFormSchema>;

export default function MenuItemsPage() {
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"recipe" | "non-recipe" | "all">("all");
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
  const { toast} = useToast();

  const form = useForm<AddMenuItemForm>({
    resolver: zodResolver(addMenuItemFormSchema),
    defaultValues: {
      name: "",
      department: "",
      category: "",
      size: "",
      pluSku: "",
      isRecipeItem: 0,
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
      pluSku: "",
      isRecipeItem: 0,
      active: 1,
      recipeId: null,
      servingSizeQty: 1,
      servingUnitId: null,
      price: null,
    },
  });

  const { data: stores } = useAccessibleStores();

  const { data: menuItems, isLoading } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
  });

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
  });

  const parseCSVMutation = useMutation({
    mutationFn: async (csvContent: string) => {
      const response = await apiRequest("POST", "/api/menu-items/import-csv", { csvContent });
      const data = await response.json();
      return data as ParseResult;
    },
    onSuccess: (data: ParseResult) => {
      setParseResult(data);
      const uniqueCount = data?.stats?.uniqueItems || (data as any)?.uniqueItems || 0;
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
      const storeAssignments = await Promise.all(
        selectedStoresForAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${menuItem.id}/${storeId}`, {})
        )
      );
      
      return menuItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      toast({
        title: "Menu Item Created",
        description: "Successfully created menu item",
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<AddMenuItemForm> }) => {
      const response = await apiRequest("PATCH", `/api/menu-items/${id}`, data);
      const menuItem = await response.json();
      
      // Fetch current store assignments
      const currentAssignmentsResponse = await apiRequest("GET", `/api/store-menu-items/${id}`);
      const currentAssignments = await currentAssignmentsResponse.json();
      const currentStoreIds = currentAssignments.map((a: any) => a.storeId);
      
      // Determine which stores to add and remove
      const storesToAdd = selectedStoresForEdit.filter(sid => !currentStoreIds.includes(sid));
      const storesToRemove = currentStoreIds.filter((sid: string) => !selectedStoresForEdit.includes(sid));
      
      // Create new assignments
      await Promise.all(
        storesToAdd.map(storeId =>
          apiRequest("POST", `/api/store-menu-items/${id}/${storeId}`, {})
        )
      );
      
      // Remove old assignments
      await Promise.all(
        storesToRemove.map((storeId: string) =>
          apiRequest("DELETE", `/api/store-menu-items/${id}/${storeId}`)
        )
      );
      
      return menuItem;
    },
    onSuccess: (data: MenuItem) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({
        title: "Menu Item Updated",
        description: "Successfully updated menu item",
      });
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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCsvContent(content);
      parseCSVMutation.mutate(content);
    };
    reader.readAsText(file);
  };

  const handleBulkImport = () => {
    if (!parseResult || !selectedStoreForImport) {
      toast({
        title: "Missing Information",
        description: "Please select a store for import",
        variant: "destructive",
      });
      return;
    }

    bulkCreateMutation.mutate({
      items: parseResult.items,
      storeId: selectedStoreForImport,
    });
  };

  const handleAddMenuItem = (data: AddMenuItemForm) => {
    // Validate at least one store is selected
    if (selectedStoresForAdd.length === 0) {
      toast({
        title: "Store Required",
        description: "Please select at least one store location",
        variant: "destructive",
      });
      return;
    }
    
    // Transform empty strings to undefined for optional fields
    const payload = {
      ...data,
      department: data.department || undefined,
      category: data.category || undefined,
      size: data.size || undefined,
    };
    createItemMutation.mutate(payload);
  };

  const handleToggleActive = (item: MenuItem) => {
    toggleActiveMutation.mutate({
      id: item.id,
      active: item.active ? 0 : 1,
    });
  };

  const handleEditMenuItem = async (item: MenuItem) => {
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
      servingSizeQty: 1,
      servingUnitId: null,
      price: item.price,
    });
    
    // Fetch existing store assignments
    try {
      const response = await apiRequest("GET", `/api/store-menu-items/${item.id}`);
      const assignments = await response.json();
      setSelectedStoresForEdit(assignments.map((a: any) => a.storeId));
    } catch (error) {
      console.error("Failed to fetch store assignments:", error);
      setSelectedStoresForEdit([]);
    }
    
    setEditDialogOpen(true);
  };

  const handleUpdateMenuItem = (data: AddMenuItemForm) => {
    if (!editingItem) return;
    
    // Validate at least one store is selected
    if (selectedStoresForEdit.length === 0) {
      toast({
        title: "Store Required",
        description: "Please select at least one store location",
        variant: "destructive",
      });
      return;
    }
    
    // Transform empty strings to undefined for optional fields
    const payload = {
      ...data,
      department: data.department || undefined,
      category: data.category || undefined,
      size: data.size || undefined,
      price: data.price ?? undefined,
    };
    updateItemMutation.mutate({ id: editingItem.id, data: payload });
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
    return matchesSearch && matchesActive && matchesDepartment && matchesCategory && matchesType;
  }) || [];

  // Apply sorting
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Menu Items</h1>
          <p className="text-muted-foreground mt-1">
            Manage your POS menu items and link them to recipes
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="default" data-testid="button-add-menu-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Menu Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Menu Item</DialogTitle>
                <DialogDescription>
                  Create a new menu item manually
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
                            placeholder="e.g., Pepperoni Pizza"
                            data-testid="input-new-item-name"
                          />
                        </FormControl>
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
                      name="size"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Size</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Large"
                              data-testid="input-new-item-size"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="pluSku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PLU/SKU *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., PPP001"
                              data-testid="input-new-item-plu"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
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
                                {recipe.name} {recipe.isPlaceholder === 1 && "(Placeholder)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          <Link 
                            href={`/recipes/new?name=${encodeURIComponent(form.watch("name") || "")}`}
                            className="text-primary hover:underline text-sm"
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
                        <FormLabel className="!mt-0">This is a recipe item</FormLabel>
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
                      disabled={createItemMutation.isPending}
                      data-testid="button-confirm-add-item"
                    >
                      {createItemMutation.isPending ? "Creating..." : "Add Item"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* Edit Menu Item Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Menu Item</DialogTitle>
                <DialogDescription>
                  Update menu item details and price
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
                          <Input
                            {...field}
                            placeholder="e.g., Pepperoni Pizza"
                            data-testid="input-edit-item-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Pizza"
                              data-testid="input-edit-item-department"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Specialty Pizzas"
                              data-testid="input-edit-item-category"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="size"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Size</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., Large"
                              data-testid="input-edit-item-size"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="pluSku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PLU/SKU *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., PPP001"
                              data-testid="input-edit-item-plu"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={editForm.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            placeholder="e.g., 12.99"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                            data-testid="input-edit-item-price"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="recipeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipe (Optional)</FormLabel>
                        <Select
                          value={field.value || "none"}
                          onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-item-recipe">
                              <SelectValue placeholder="Select a recipe..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {recipes?.map((recipe) => (
                              <SelectItem key={recipe.id} value={recipe.id}>
                                {recipe.name} {recipe.isPlaceholder === 1 && "(Placeholder)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          <Link 
                            href={`/recipes/new?name=${encodeURIComponent(editForm.watch("name") || "")}`}
                            className="text-primary hover:underline text-sm"
                            data-testid="link-create-recipe-edit"
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
                            {store.city && <span className="text-muted-foreground ml-2">({store.city})</span>}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <FormField
                    control={editForm.control}
                    name="isRecipeItem"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value === 1}
                            onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                            data-testid="checkbox-edit-item-is-recipe"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">This is a recipe item</FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditDialogOpen(false);
                        setEditingItem(null);
                        setSelectedStoresForEdit([]);
                        editForm.reset();
                      }}
                      data-testid="button-cancel-edit-item"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateItemMutation.isPending}
                      data-testid="button-confirm-edit-item"
                    >
                      {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-upload-csv">
                <Upload className="h-4 w-4 mr-2" />
                Upload POS CSV
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Import Menu Items from POS CSV</DialogTitle>
              <DialogDescription>
                Upload a CSV file from your POS system (Toast, HungerRush, Thrive, or Clover)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {!parseResult ? (
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="max-w-xs mx-auto"
                    data-testid="input-csv-file"
                  />
                  <p className="text-sm text-muted-foreground mt-4">
                    Select a CSV file containing POS sales data
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Parse Results</CardTitle>
                      <CardDescription>
                        Found {parseResult?.stats?.uniqueItems ?? (parseResult as any)?.uniqueItems ?? 0} unique items
                        {parseResult?.stats?.recipeItems !== undefined && parseResult?.stats?.nonRecipeItems !== undefined && 
                          ` (${parseResult.stats.recipeItems} recipe items, ${parseResult.stats.nonRecipeItems} non-recipe items)`}
                      </CardDescription>
                    </CardHeader>
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

                  <div className="border rounded-lg max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item Name</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead>PLU/SKU</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parseResult.items.map((item, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{item.department}</TableCell>
                            <TableCell>{item.category}</TableCell>
                            <TableCell>{item.size || "-"}</TableCell>
                            <TableCell className="font-mono text-sm">{item.pluSku}</TableCell>
                            <TableCell>
                              <Badge variant={item.isRecipeItem ? "default" : "secondary"}>
                                {item.isRecipeItem ? "Recipe" : "Non-Recipe"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
          ) : sortedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No menu items found</h3>
              <p className="text-muted-foreground text-sm">
                {search || activeFilter !== "active" || departmentFilter !== "all" || categoryFilter !== "all" || typeFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Upload a POS CSV to import menu items"}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {sortedItems.map((item) => {
                    const recipe = item.recipeId ? recipes?.find((r) => r.id === item.recipeId) : null;
                    
                    return (
                      <TableRow 
                        key={item.id} 
                        data-testid={`row-menu-item-${item.id}`}
                        className={item.active === 0 ? "opacity-60" : ""}
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
          )}

          {sortedItems.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {sortedItems.length} menu item{sortedItems.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
