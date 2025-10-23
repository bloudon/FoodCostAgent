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
import { Upload, Package, Search, Filter, Plus, MoreVertical } from "lucide-react";
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
  const { toast } = useToast();

  const form = useForm<AddMenuItemForm>({
    resolver: zodResolver(addMenuItemFormSchema),
    defaultValues: {
      name: "",
      department: "",
      category: "",
      size: "",
      pluSku: "",
      isRecipeItem: 1,
      active: 1,
      recipeId: null,
      servingSizeQty: 1,
      servingUnitId: null,
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
      console.log('CSV Parse Response:', data);
      return data as ParseResult;
    },
    onSuccess: (data: ParseResult) => {
      console.log('Parse result data:', data);
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
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      toast({
        title: "Menu Item Created",
        description: "Successfully created menu item",
      });
      setAddDialogOpen(false);
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

  // Get unique departments and categories for filters
  const uniqueDepartments = Array.from(new Set(
    menuItems?.map(item => item.department).filter((dept): dept is string => Boolean(dept)) || []
  )).sort();
  const uniqueCategories = Array.from(new Set(
    menuItems?.map(item => item.category).filter((cat): cat is string => Boolean(cat)) || []
  )).sort();

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
          ) : filteredItems.length === 0 ? (
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
                    <TableHead>Item Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>PLU/SKU</TableHead>
                    <TableHead>Recipe</TableHead>
                    <TableHead className="text-right">Recipe Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const recipe = item.recipeId ? recipes?.find((r) => r.id === item.recipeId) : null;
                    
                    return (
                      <TableRow 
                        key={item.id} 
                        data-testid={`row-menu-item-${item.id}`}
                        className={item.active === 0 ? "opacity-60" : ""}
                      >
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.department || "-"}</TableCell>
                        <TableCell>{item.category || "-"}</TableCell>
                        <TableCell>{item.size || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{item.pluSku}</TableCell>
                        <TableCell>
                          {item.recipeId ? (
                            <Link href={`/recipes/${item.recipeId}`} data-testid={`link-recipe-${item.recipeId}`}>
                              {recipe?.isPlaceholder ? (
                                <Badge variant="secondary" className="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 hover-elevate cursor-pointer">
                                  Placeholder
                                </Badge>
                              ) : (
                                <Badge variant="default" className="hover-elevate cursor-pointer">
                                  Complete
                                </Badge>
                              )}
                            </Link>
                          ) : item.isRecipeItem ? (
                            <Badge variant="destructive">Needs Recipe</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {recipe && !recipe.isPlaceholder ? (
                            `$${recipe.computedCost.toFixed(2)}`
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

          {filteredItems.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredItems.length} menu item{filteredItems.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
