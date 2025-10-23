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
import { Upload, Package, Search, Filter } from "lucide-react";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";

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

export default function MenuItemsPage() {
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedStoreForImport, setSelectedStoreForImport] = useState<string>("");
  const { toast } = useToast();

  const { data: stores } = useAccessibleStores();

  const { data: menuItems, isLoading } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
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

  const filteredItems = menuItems?.filter((item) => {
    const matchesSearch = item.name?.toLowerCase().includes(search.toLowerCase()) ||
      item.pluSku?.toLowerCase().includes(search.toLowerCase());
    const matchesActive = 
      activeFilter === "all" ? true :
      activeFilter === "active" ? item.active === 1 :
      item.active === 0;
    return matchesSearch && matchesActive;
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
        <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-upload-csv">
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
            <div className="flex items-center gap-2">
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
                {search || activeFilter !== "active"
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
                    <TableHead>Type</TableHead>
                    <TableHead>Recipe</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
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
                        <Badge variant={item.isRecipeItem ? "default" : "secondary"}>
                          {item.isRecipeItem ? "Recipe" : "Non-Recipe"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.recipeId ? (
                          <Badge variant="outline">Linked</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.active ? "default" : "secondary"}>
                          {item.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
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
