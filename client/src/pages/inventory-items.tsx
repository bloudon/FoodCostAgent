import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Search, Plus, MoreVertical, Store, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useStoreContext } from "@/hooks/use-store-context";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatUnitName, formatDateString } from "@/lib/utils";

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
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(9999);
  const [breakdownItemId, setBreakdownItemId] = useState<string | null>(null);
  const [breakdownItemName, setBreakdownItemName] = useState<string>("");
  const { toast } = useToast();
  
  // Use global store context instead of local state
  const { selectedStoreId: selectedStore } = useStoreContext();

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  // Fetch estimated on-hand data for the selected store
  const { data: estimatedOnHandData } = useQuery<Array<{
    inventoryItemId: string;
    lastCountQty: number;
    lastCountDate: string | null;
    receivedQty: number;
    wasteQty: number;
    theoreticalUsageQty: number;
    transferredOutQty: number;
    estimatedOnHand: number;
  }>>({
    queryKey: ["/api/inventory-items/estimated-on-hand", selectedStore],
    queryFn: async () => {
      if (!selectedStore || selectedStore === "all") {
        return [];
      }
      const response = await fetch(`/api/inventory-items/estimated-on-hand?storeId=${selectedStore}`);
      if (!response.ok) throw new Error("Failed to fetch estimated on-hand data");
      return response.json();
    },
    enabled: !!selectedStore && selectedStore !== "all",
  });

  // Create a map for quick lookup of estimated on-hand quantities
  const estimatedOnHandMap = new Map(
    estimatedOnHandData?.map(item => [item.inventoryItemId, item.estimatedOnHand]) || []
  );

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
          <Button asChild data-testid="button-add-item">
            <Link href="/inventory-items/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Link>
          </Button>
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
                  <TableHead className="text-right">Est. On-Hand</TableHead>
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
                      <TableCell 
                        className={`text-right font-mono ${estimatedOnHandMap.has(item.id) && selectedStore !== "all" ? "cursor-pointer hover:underline" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (estimatedOnHandMap.has(item.id) && selectedStore !== "all") {
                            setBreakdownItemId(item.id);
                            setBreakdownItemName(item.name);
                          }
                        }}
                        data-testid={`cell-estimated-on-hand-${item.id}`}
                        title={selectedStore === "all" ? "Select a specific store to view breakdown" : "Click to view breakdown"}
                      >
                        {estimatedOnHandMap.has(item.id) ? (
                          <span className="text-blue-600 dark:text-blue-400">
                            {estimatedOnHandMap.get(item.id)?.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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

      {/* Estimated On-Hand Breakdown Modal */}
      <EstimatedOnHandBreakdownModal
        itemId={breakdownItemId}
        itemName={breakdownItemName}
        storeId={selectedStore !== "all" ? selectedStore : ""}
        open={!!breakdownItemId}
        onClose={() => setBreakdownItemId(null)}
      />
    </div>
  );
}

// Breakdown Modal Component
function EstimatedOnHandBreakdownModal({
  itemId,
  itemName,
  storeId,
  open,
  onClose,
}: {
  itemId: string | null;
  itemName: string;
  storeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: breakdown, isLoading, error } = useQuery({
    queryKey: ["/api/inventory-items", itemId, "breakdown", storeId],
    queryFn: async () => {
      if (!itemId || !storeId) return null;
      const response = await fetch(`/api/inventory-items/${itemId}/estimated-on-hand-breakdown?storeId=${storeId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch breakdown" }));
        throw new Error(errorData.error || "Failed to fetch breakdown");
      }
      return response.json();
    },
    enabled: open && !!itemId && !!storeId,
  });

  if (!open || !itemId) return null;

  // Show error if store is not selected
  if (!storeId) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent data-testid="dialog-breakdown">
          <DialogHeader>
            <DialogTitle>Estimated On-Hand Breakdown</DialogTitle>
            <DialogDescription>{itemName}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Please select a specific store to view the estimated on-hand breakdown.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto" data-testid="dialog-breakdown">
        <DialogHeader>
          <DialogTitle>Estimated On-Hand Breakdown</DialogTitle>
          <DialogDescription>{itemName}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading breakdown...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-red-600 dark:text-red-400 mb-2">Error loading breakdown</div>
            <div className="text-sm text-muted-foreground">
              {(error as Error).message || "An unexpected error occurred"}
            </div>
          </div>
        ) : !breakdown || !breakdown.summary ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">No data available</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-1">Last Count</div>
                <div className="text-2xl font-semibold">
                  {breakdown.summary.lastCountQty.toFixed(2)} {breakdown.unitName}
                </div>
                {breakdown.lastCount && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatDateString(breakdown.lastCount.date)}
                  </div>
                )}
              </div>
              
              <div className="bg-card border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-1">Net Change</div>
                <div className="text-2xl font-semibold flex items-center gap-2">
                  {(breakdown.summary.receivedQty - breakdown.summary.wasteQty - breakdown.summary.theoreticalUsageQty - breakdown.summary.transferredOutQty).toFixed(2)}
                  {(breakdown.summary.receivedQty - breakdown.summary.wasteQty - breakdown.summary.theoreticalUsageQty - breakdown.summary.transferredOutQty) > 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (breakdown.summary.receivedQty - breakdown.summary.wasteQty - breakdown.summary.theoreticalUsageQty - breakdown.summary.transferredOutQty) < 0 ? (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Since last count
                </div>
              </div>
              
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">Estimated On-Hand</div>
                <div className="text-2xl font-semibold text-blue-600 dark:text-blue-400">
                  {breakdown.summary.estimatedOnHand.toFixed(2)} {breakdown.unitName}
                </div>
                <div className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1">
                  Current estimate
                </div>
              </div>
            </div>

            {/* Breakdown Sections */}
            <div className="space-y-4">
              {/* Receipts */}
              {breakdown.receipts && breakdown.receipts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-green-500 rounded-full" />
                    <h3 className="font-semibold text-green-700 dark:text-green-400">
                      Receipts (+{breakdown.summary.receivedQty.toFixed(2)} {breakdown.unitName})
                    </h3>
                  </div>
                  <div className="ml-3 border-l-2 border-green-200 dark:border-green-800 pl-4 space-y-2">
                    {breakdown.receipts.map((receipt, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">{receipt.vendorName}</span>
                          <span className="text-xs text-muted-foreground">{formatDateString(receipt.date)}</span>
                        </div>
                        <span className="font-mono text-green-700 dark:text-green-400">
                          +{receipt.qty.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Theoretical Usage */}
              {breakdown.theoreticalUsage && breakdown.theoreticalUsage.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-orange-500 rounded-full" />
                    <h3 className="font-semibold text-orange-700 dark:text-orange-400">
                      Theoretical Usage (-{breakdown.summary.theoreticalUsageQty.toFixed(2)} {breakdown.unitName})
                    </h3>
                  </div>
                  <div className="ml-3 border-l-2 border-orange-200 dark:border-orange-800 pl-4 space-y-2">
                    {breakdown.theoreticalUsage.map((usage, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">Sales</span>
                          <span className="text-xs text-muted-foreground">{formatDateString(usage.date)}</span>
                        </div>
                        <span className="font-mono text-orange-700 dark:text-orange-400">
                          -{usage.qty.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Waste */}
              {breakdown.waste && breakdown.waste.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-red-500 rounded-full" />
                    <h3 className="font-semibold text-red-700 dark:text-red-400">
                      Waste (-{breakdown.summary.wasteQty.toFixed(2)} {breakdown.unitName})
                    </h3>
                  </div>
                  <div className="ml-3 border-l-2 border-red-200 dark:border-red-800 pl-4 space-y-2">
                    {breakdown.waste.map((waste, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">{waste.reason}</span>
                          <span className="text-xs text-muted-foreground">{formatDateString(waste.date)}</span>
                        </div>
                        <span className="font-mono text-red-700 dark:text-red-400">
                          -{waste.qty.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transfers */}
              {breakdown.transfers && breakdown.transfers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-purple-500 rounded-full" />
                    <h3 className="font-semibold text-purple-700 dark:text-purple-400">
                      Transfers Out (-{breakdown.summary.transferredOutQty.toFixed(2)} {breakdown.unitName})
                    </h3>
                  </div>
                  <div className="ml-3 border-l-2 border-purple-200 dark:border-purple-800 pl-4 space-y-2">
                    {breakdown.transfers.map((transfer, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">To {transfer.toStoreName}</span>
                          <span className="text-xs text-muted-foreground">{formatDateString(transfer.date)}</span>
                        </div>
                        <span className="font-mono text-purple-700 dark:text-purple-400">
                          -{transfer.qty.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!breakdown.receipts || breakdown.receipts.length === 0) && 
               (!breakdown.theoreticalUsage || breakdown.theoreticalUsage.length === 0) && 
               (!breakdown.waste || breakdown.waste.length === 0) && 
               (!breakdown.transfers || breakdown.transfers.length === 0) && (
                <div className="text-center text-muted-foreground py-8">
                  No activity since last count
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
