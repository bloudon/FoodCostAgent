import { useQuery } from "@tanstack/react-query";
import { Package, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
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

type InventoryLevel = {
  id: string;
  productId: string;
  storageLocationId: string;
  onHandMicroUnits: number;
  product: {
    id: string;
    name: string;
    category: string | null;
    pluSku: string;
    lastCost: number;
    baseUnitId: string;
    microUnitsPerPurchaseUnit: number;
    imageUrl: string | null;
  };
  location: {
    id: string;
    name: string;
  };
  baseUnit: {
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

export default function InventoryItems() {
  const [search, setSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");

  const { data: inventoryLevels, isLoading } = useQuery<InventoryLevel[]>({
    queryKey: ["/api/inventory"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const filteredLevels = inventoryLevels?.filter((level) => {
    const matchesSearch = level.product.name.toLowerCase().includes(search.toLowerCase()) ||
      level.product.pluSku.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = selectedLocation === "all" || level.storageLocationId === selectedLocation;
    return matchesSearch && matchesLocation;
  }) || [];

  const totalValue = filteredLevels.reduce((sum, level) => {
    const quantity = level.onHandMicroUnits / level.product.microUnitsPerPurchaseUnit;
    return sum + (quantity * level.product.lastCost);
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
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Total Value:</span>
            <span className="text-2xl font-bold">${totalValue.toFixed(2)}</span>
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
        ) : filteredLevels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No inventory items found</h3>
            <p className="text-muted-foreground text-sm">
              {search || selectedLocation !== "all"
                ? "Try adjusting your filters"
                : "Inventory levels will appear here as stock is received"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLevels.map((level) => {
                  const quantity = level.onHandMicroUnits / level.product.microUnitsPerPurchaseUnit;
                  const totalValue = quantity * level.product.lastCost;

                  return (
                    <TableRow key={level.id} data-testid={`row-inventory-${level.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={level.product.imageUrl || undefined} />
                            <AvatarFallback>
                              <Package className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{level.product.name}</div>
                            <div className="text-sm text-muted-foreground">{level.product.pluSku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {level.product.category && (
                          <Badge 
                            variant="secondary" 
                            className={categoryColors[level.product.category] || ""}
                          >
                            {level.product.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{level.location.name}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {quantity.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm text-muted-foreground">
                          {level.baseUnit.abbreviation}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${level.product.lastCost.toFixed(4)}
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
