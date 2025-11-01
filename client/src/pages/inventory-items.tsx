import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Search, Plus, MoreVertical, Store } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatUnitName } from "@/lib/utils";

type InventoryItemDisplay = {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  pluSku: string;
  pricePerUnit: number;
  avgCostPerUnit: number;
  unitId: string;
  caseSize: number;
  imageUrl: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  storageLocationId: string;
  onHandQty: number;
  active: number;
  locations: Array<{
    id: string;
    name: string;
    isPrimary: boolean;
  }>;
  unit: {
    id: string;
    name: string;
    abbreviation: string;
  } | null;
};

type StorageLocation = {
  id: string;
  name: string;
  sortOrder: number;
};

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

type CompanyStore = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: string;
};

const categoryColors: Record<string, string> = {
  "Protein": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "Produce": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Dairy": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Dry/Pantry": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

function getInventoryStatus(quantity: number, parLevel: number | null, reorderLevel: number | null) {
  if (reorderLevel && quantity <= reorderLevel) {
    return { status: "Critical", variant: "destructive" as const, color: "text-red-600 dark:text-red-400" };
  }
  if (parLevel && quantity < parLevel) {
    return { status: "Low", variant: "secondary" as const, color: "text-yellow-600 dark:text-yellow-400" };
  }
  return { status: "OK", variant: "outline" as const, color: "text-green-600 dark:text-green-400" };
}

export default function InventoryItems() {
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(9999);
  const { toast } = useToast();

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: stores } = useAccessibleStores();

  // Auto-select first store if none selected
  useEffect(() => {
    if (stores && stores.length > 0 && !selectedStore) {
      const activeStores = stores.filter(s => s.status === 'active');
      if (activeStores.length > 0) {
        setSelectedStore(activeStores[0].id);
      }
    }
  }, [stores, selectedStore]);

  const { data: inventoryItems, isLoading } = useQuery<InventoryItemDisplay[]>({
    queryKey: ["/api/inventory-items", selectedStore],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStore) {
        params.append("store_id", selectedStore);
      }
      const url = `/api/inventory-items${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch inventory items");
      return response.json();
    },
    enabled: !!selectedStore,
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active, storeId }: { id: string; active: number; storeId?: string }) => {
      const payload: { active: number; storeId?: string } = { active };
      if (storeId) {
        payload.storeId = storeId;
      }
      return await apiRequest("PATCH", `/api/inventory-items/${id}`, payload);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      const scope = variables.storeId ? "at this store" : "globally";
      toast({
        title: "Success",
        description: `Item status updated ${scope}`,
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

  const filteredItems = inventoryItems?.filter((item) => {
    const matchesSearch = item.name?.toLowerCase().includes(search.toLowerCase()) ||
      item.pluSku?.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = selectedLocation === "all" || 
      item.locations.some(loc => loc.id === selectedLocation);
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    const matchesActive = 
      activeFilter === "all" ? true :
      activeFilter === "active" ? item.active === 1 :
      item.active === 0;
    return matchesSearch && matchesLocation && matchesCategory && matchesActive;
  }) || [];

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  
  // Clamp currentPage to valid range when filtered items change
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    } else if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [filteredItems.length, itemsPerPage, currentPage, totalPages]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = itemsPerPage === 9999 ? filteredItems : filteredItems.slice(startIndex, endIndex);

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-bold">
              Inventory Items ({filteredItems.length})
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Store className="h-5 w-5 text-muted-foreground" />
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="w-[200px]" data-testid="select-store-filter">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores?.filter(s => s.status === 'active').map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild data-testid="button-add-item">
              <Link href="/inventory-items/new">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Link>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-inventory"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
              <SelectValue placeholder="Filter by category" />
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
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-[200px]" data-testid="select-location-filter">
              <SelectValue placeholder="Filter by location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations?.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={(val) => {
            setActiveFilter(val as "active" | "inactive" | "all");
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-[200px]" data-testid="select-active-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="inactive">Inactive Only</SelectItem>
              <SelectItem value="all">All Items</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading inventory...</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No inventory items found</h3>
            <p className="text-muted-foreground text-sm">
              {search || selectedLocation !== "all" || selectedCategory !== "all"
                ? "Try adjusting your filters"
                : "Inventory items will appear here as stock is received"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Par</TableHead>
                  <TableHead className="text-right">Reorder</TableHead>
                  <TableHead className="text-right">Last Cost</TableHead>
                  <TableHead className="text-right">Avg Cost (WAC)</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item) => {
                  const quantity = item.onHandQty || 0;
                  const inventoryStatus = getInventoryStatus(quantity, item.parLevel, item.reorderLevel);

                  return (
                    <TableRow 
                      key={item.id} 
                      data-testid={`row-inventory-${item.id}`}
                      className={item.active === 0 ? "opacity-60" : ""}
                    >
                      <TableCell 
                        className="cursor-pointer hover-elevate"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={item.imageUrl || undefined} />
                            <AvatarFallback>
                              <Package className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {item.name}
                              {item.active === 0 && (
                                <Badge variant="outline" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">{item.pluSku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        <Badge variant={inventoryStatus.variant} data-testid={`badge-status-${item.id}`}>
                          {inventoryStatus.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        {item.category && (
                          <Badge 
                            variant="secondary" 
                            className={categoryColors[item.category] || ""}
                          >
                            {item.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        {item.locations.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {item.locations.map((location) => (
                              <div key={location.id} className="flex items-center gap-1">
                                <span className="text-sm">{location.name}</span>
                                {location.isPrimary && (
                                  <Badge variant="outline" className="text-xs h-4 px-1">
                                    (p)
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        <span className="text-sm text-muted-foreground">{formatUnitName(item.unit?.name)}</span>
                      </TableCell>
                      <TableCell 
                        className="text-right font-mono text-sm text-muted-foreground cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        {item.parLevel ? item.parLevel.toFixed(1) : "-"}
                      </TableCell>
                      <TableCell 
                        className="text-right font-mono text-sm text-muted-foreground cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        {item.reorderLevel ? item.reorderLevel.toFixed(1) : "-"}
                      </TableCell>
                      <TableCell 
                        className="text-right font-mono cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                        data-testid={`cell-last-cost-${item.id}`}
                      >
                        ${item.pricePerUnit ? item.pricePerUnit.toFixed(2) : '0.00'}
                      </TableCell>
                      <TableCell 
                        className="text-right font-mono cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                        data-testid={`cell-avg-cost-${item.id}`}
                      >
                        ${item.avgCostPerUnit ? item.avgCostPerUnit.toFixed(2) : '0.00'}
                      </TableCell>
                      <TableCell 
                        className="text-right font-mono cursor-pointer"
                        onClick={() => window.location.href = `/inventory-items/${item.id}`}
                      >
                        <span className={inventoryStatus.color}>{quantity.toFixed(2)}</span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              data-testid={`button-menu-${item.id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => toggleActiveMutation.mutate({ 
                                id: item.id, 
                                active: item.active === 1 ? 0 : 1,
                                storeId: selectedStore !== "all" ? selectedStore : undefined
                              })}
                              data-testid={`menu-toggle-active-${item.id}`}
                            >
                              {item.active === 1 ? "Mark as Inactive" : "Mark as Active"}
                              {selectedStore !== "all" && <span className="text-xs ml-2 text-muted-foreground">(this store)</span>}
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

        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {filteredItems.length === 0 
                ? "Showing 0 items"
                : itemsPerPage === 9999 
                  ? `Showing ${filteredItems.length} items`
                  : `Showing ${startIndex + 1}-${Math.min(endIndex, filteredItems.length)} of ${filteredItems.length} items`
              }
            </span>
            <Select value={itemsPerPage.toString()} onValueChange={(val) => {
              setItemsPerPage(Number(val));
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[140px]" data-testid="select-items-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
                <SelectItem value="9999">Show all</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {itemsPerPage !== 9999 && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
