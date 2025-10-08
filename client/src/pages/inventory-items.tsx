import { useQuery } from "@tanstack/react-query";
import { Package, Search, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type InventoryItemDisplay = {
  id: string;
  name: string;
  category: string | null;
  pluSku: string;
  lastCost: number;
  unitId: string;
  caseSize: number;
  imageUrl: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  storageLocationId: string;
  onHandQty: number;
  location: {
    id: string;
    name: string;
  };
  unit: {
    id: string;
    name: string;
    abbreviation: string;
  };
};

type StorageLocation = {
  id: string;
  name: string;
  sortOrder: number;
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

  const { data: inventoryItems, isLoading } = useQuery<InventoryItemDisplay[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const filteredItems = inventoryItems?.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.pluSku.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = selectedLocation === "all" || item.storageLocationId === selectedLocation;
    return matchesSearch && matchesLocation;
  }) || [];

  const totalValue = filteredItems.reduce((sum, item) => {
    const costPerPound = item.lastCost / (item.caseSize || 1);
    return sum + (item.onHandQty * costPerPound);
  }, 0);

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Inventory Items</h1>
            <p className="text-muted-foreground mt-1">
              Current on-hand quantities across all storage locations
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Total Value:</span>
              <span className="text-2xl font-bold">${totalValue.toFixed(2)}</span>
            </div>
            <Button asChild data-testid="button-add-item">
              <Link href="/inventory-items/new">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-inventory"
            />
          </div>
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-[250px]" data-testid="select-location-filter">
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
              {search || selectedLocation !== "all"
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
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Par</TableHead>
                  <TableHead className="text-right">Reorder</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const quantity = item.onHandQty;
                  const costPerPound = item.lastCost / (item.caseSize || 1);
                  const totalValue = quantity * costPerPound;
                  const inventoryStatus = getInventoryStatus(quantity, item.parLevel, item.reorderLevel);

                  return (
                    <TableRow 
                      key={item.id} 
                      data-testid={`row-inventory-${item.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => window.location.href = `/inventory-items/${item.id}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={item.imageUrl || undefined} />
                            <AvatarFallback>
                              <Package className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-sm text-muted-foreground">{item.pluSku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.category && (
                          <Badge 
                            variant="secondary" 
                            className={categoryColors[item.category] || ""}
                          >
                            {item.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{item.location.name}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={inventoryStatus.color}>{quantity.toFixed(2)}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {item.parLevel ? item.parLevel.toFixed(1) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {item.reorderLevel ? item.reorderLevel.toFixed(1) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={inventoryStatus.variant} data-testid={`badge-status-${item.id}`}>
                          {inventoryStatus.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${item.lastCost.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ${totalValue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {filteredLevels.length} items</span>
          {selectedLocation !== "all" && (
            <span>
              Filtered by location
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
