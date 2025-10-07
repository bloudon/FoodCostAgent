import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, QrCode, Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

interface CountLine {
  productId: string;
  productName: string;
  qty: number;
  unitId: string;
  unitName: string;
  derivedMicroUnits: number;
}

function CountHistoryRow({ count, location, countDate, products }: any) {
  const { data: countLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", count.id],
  });

  const totalValue = countLines?.reduce((sum, line) => {
    const product = products?.find((p: any) => p.id === line.productId);
    return sum + (line.derivedMicroUnits * (product?.lastCost || 0));
  }, 0) || 0;

  return (
    <TableRow data-testid={`row-count-${count.id}`}>
      <TableCell className="font-mono">
        {countDate.toLocaleDateString()} {countDate.toLocaleTimeString()}
      </TableCell>
      <TableCell>{location?.name || 'Unknown'}</TableCell>
      <TableCell>{count.userId}</TableCell>
      <TableCell className="text-right font-mono font-semibold" data-testid={`text-count-value-${count.id}`}>
        ${totalValue.toFixed(2)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {count.note || '-'}
      </TableCell>
      <TableCell className="text-right">
        <Button 
          variant="ghost" 
          size="sm"
          data-testid={`button-view-count-${count.id}`}
        >
          View Details
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function InventoryCount() {
  const { toast } = useToast();
  const [selectedLocation, setSelectedLocation] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [activeTab, setActiveTab] = useState("new-count");

  const { data: storageLocations, isLoading: locationsLoading } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: products, isLoading: productsLoading } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const { data: inventoryLevels } = useQuery<any[]>({
    queryKey: ["/api/inventory", selectedLocation],
    enabled: !!selectedLocation,
  });

  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-counts"],
  });

  const saveCountMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/inventory-counts", data);
    },
    onSuccess: () => {
      toast({
        title: "Count Saved",
        description: "Inventory count has been saved successfully",
      });
      setCountLines([]);
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save count",
        variant: "destructive",
      });
    },
  });

  if (!selectedLocation && storageLocations && storageLocations.length > 0) {
    setSelectedLocation(storageLocations[0].id);
  }

  const filteredProducts = products?.filter(p => 
    p.active === 1 && (
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery))
    )
  );

  const addCountLine = (product: any) => {
    if (countLines.some(line => line.productId === product.id)) {
      toast({
        title: "Already Added",
        description: "This product is already in the count",
        variant: "destructive",
      });
      return;
    }

    const baseUnit = units?.find(u => u.id === product.baseUnitId);
    setCountLines([...countLines, {
      productId: product.id,
      productName: product.name,
      qty: 0,
      unitId: product.baseUnitId,
      unitName: baseUnit?.name || "unit",
      derivedMicroUnits: 0,
    }]);
    setSearchQuery("");
  };

  const updateCountLine = (productId: string, field: string, value: any) => {
    setCountLines(countLines.map(line => {
      if (line.productId === productId) {
        const updated = { ...line, [field]: value };
        
        if (field === "qty" || field === "unitId") {
          const unit = units?.find(u => u.id === updated.unitId);
          updated.derivedMicroUnits = unit ? updated.qty * unit.toBaseRatio : updated.qty;
          if (field === "unitId") {
            updated.unitName = unit?.name || "unit";
          }
        }
        
        return updated;
      }
      return line;
    }));
  };

  const removeCountLine = (productId: string) => {
    setCountLines(countLines.filter(line => line.productId !== productId));
  };

  const handleSaveCount = () => {
    if (!selectedLocation) {
      toast({
        title: "Error",
        description: "Please select a storage location",
        variant: "destructive",
      });
      return;
    }

    if (countLines.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one count line",
        variant: "destructive",
      });
      return;
    }

    saveCountMutation.mutate({
      storageLocationId: selectedLocation,
      userId: "system",
      lines: countLines.map(line => ({
        productId: line.productId,
        qty: line.qty,
        unitId: line.unitId,
        derivedMicroUnits: line.derivedMicroUnits,
      })),
    });
  };

  const totalValue = countLines.reduce((sum, line) => {
    const product = products?.find(p => p.id === line.productId);
    return sum + (line.derivedMicroUnits * (product?.lastCost || 0));
  }, 0);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-inventory-title">
          Inventory Count
        </h1>
        <p className="text-muted-foreground mt-2">
          Count inventory by storage location or view previous count sessions
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="new-count" data-testid="tab-new-count">New Count</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-count-history">Count History</TabsTrigger>
        </TabsList>

        <TabsContent value="new-count" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr_280px]">
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Storage Locations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {locationsLoading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <Tabs
                  value={selectedLocation}
                  onValueChange={setSelectedLocation}
                  orientation="vertical"
                  className="w-full"
                >
                  <TabsList className="flex flex-col h-auto w-full bg-transparent gap-1 p-2">
                    {storageLocations?.map((location) => (
                      <TabsTrigger
                        key={location.id}
                        value={location.id}
                        className="w-full justify-start data-[state=active]:bg-accent"
                        data-testid={`button-location-${location.name.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {location.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products by name or barcode..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-search-product"
                  />
                </div>
                <Button variant="outline" data-testid="button-qr-scan">
                  <QrCode className="h-4 w-4 mr-2" />
                  Scan QR
                </Button>
              </div>
              
              {searchQuery && filteredProducts && filteredProducts.length > 0 && (
                <div className="mt-4 border rounded-md max-h-60 overflow-y-auto">
                  {filteredProducts.slice(0, 10).map((product) => (
                    <div
                      key={product.id}
                      className="p-3 hover-elevate cursor-pointer border-b last:border-b-0"
                      onClick={() => addCountLine(product)}
                      data-testid={`button-add-product-${product.id}`}
                    >
                      <div className="font-medium">{product.name}</div>
                      <div className="text-sm text-muted-foreground">{product.category}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Count Lines</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-[120px]">Quantity</TableHead>
                    <TableHead className="w-[140px]">Unit</TableHead>
                    <TableHead className="w-[140px]">Micro Units</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {countLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No items counted yet. Search or scan to add products.
                      </TableCell>
                    </TableRow>
                  ) : (
                    countLines.map((line) => (
                      <TableRow key={line.productId} data-testid={`row-count-line-${line.productId}`}>
                        <TableCell className="font-medium">{line.productName}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={line.qty}
                            onChange={(e) => updateCountLine(line.productId, "qty", parseFloat(e.target.value) || 0)}
                            className="w-full"
                            data-testid={`input-qty-${line.productId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={line.unitId}
                            onValueChange={(value) => updateCountLine(line.productId, "unitId", value)}
                          >
                            <SelectTrigger data-testid={`select-unit-${line.productId}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {units?.map((unit) => (
                                <SelectItem key={unit.id} value={unit.id} data-testid={`option-unit-${unit.id}`}>
                                  {unit.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-micro-units-${line.productId}`}>
                          {line.derivedMicroUnits.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCountLine(line.productId)}
                            data-testid={`button-remove-${line.productId}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Count Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Location</div>
                <div className="text-base font-medium" data-testid="text-location-name">
                  {storageLocations?.find(l => l.id === selectedLocation)?.name || "-"}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Items</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-items">
                  {countLines.length}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Value</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-value">
                  ${totalValue.toFixed(2)}
                </div>
              </div>
              <div className="pt-4 border-t">
                <Button 
                  className="w-full" 
                  onClick={handleSaveCount}
                  disabled={saveCountMutation.isPending || countLines.length === 0}
                  data-testid="button-save-count"
                >
                  {saveCountMutation.isPending ? "Saving..." : "Save Count"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {inventoryLevels && inventoryLevels.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg">Current Levels</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm max-h-60 overflow-y-auto">
                  {inventoryLevels.map((level) => (
                    <div key={level.id} className="flex justify-between">
                      <span className="text-muted-foreground truncate flex-1">
                        {level.productName}
                      </span>
                      <span className="font-mono ml-2">
                        {level.onHandMicroUnits.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Previous Count Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {countsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : inventoryCounts && inventoryCounts.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryCounts.map((count) => {
                      const location = storageLocations?.find(l => l.id === count.storageLocationId);
                      const countDate = new Date(count.countedAt);
                      return (
                        <CountHistoryRow 
                          key={count.id} 
                          count={count} 
                          location={location} 
                          countDate={countDate}
                          products={products}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No inventory counts found. Start by creating your first count.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
