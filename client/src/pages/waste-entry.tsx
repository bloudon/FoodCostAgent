import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Package, UtensilsCrossed, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { formatUnitName } from "@/lib/utils";

type WasteType = 'inventory' | 'menu_item' | null;

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

type InventoryItem = {
  id: string;
  name: string;
  categoryId: string | null;
  unitId: string;
  pricePerUnit: number;
};

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  recipeId: string | null;
};

export default function WasteEntry() {
  const { toast } = useToast();
  const [wasteType, setWasteType] = useState<WasteType>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [notes, setNotes] = useState("");

  const { data: stores = [] } = useAccessibleStores();
  
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: inventoryItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    enabled: wasteType === 'inventory',
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
    enabled: wasteType === 'menu_item',
  });

  // Set default store
  if (stores.length > 0 && !selectedStoreId) {
    setSelectedStoreId(stores[0].id);
  }

  const selectedStore = stores.find(s => s.id === selectedStoreId);

  // Filter items by category
  const filteredInventoryItems = inventoryItems.filter(item => 
    selectedCategoryId ? item.categoryId === selectedCategoryId : false
  );

  const filteredMenuItems = menuItems.filter(item => 
    selectedCategoryId ? item.category === selectedCategoryId : false
  );

  const selectedItem = wasteType === 'inventory' 
    ? inventoryItems.find(i => i.id === selectedItemId)
    : menuItems.find(m => m.id === selectedItemId);

  const createWasteMutation = useMutation({
    mutationFn: async () => {
      const data = {
        wasteType: wasteType!,
        storeId: selectedStoreId,
        inventoryItemId: wasteType === 'inventory' ? selectedItemId : null,
        menuItemId: wasteType === 'menu_item' ? selectedItemId : null,
        qty: parseFloat(quantity),
        unitId: wasteType === 'inventory' && selectedItem ? (selectedItem as InventoryItem).unitId : null,
        reasonCode,
        notes: notes.trim() || null,
      };
      
      const response = await apiRequest("POST", "/api/waste", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste"] });
      toast({
        title: "Waste logged",
        description: "The waste entry has been recorded.",
      });
      
      // Reset form
      setSelectedItemId(null);
      setQuantity("");
      setReasonCode("");
      setNotes("");
      setSelectedCategoryId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to log waste",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedItemId || !quantity || !reasonCode) {
      toast({
        title: "Missing information",
        description: "Please select an item, enter quantity, and select a reason.",
        variant: "destructive",
      });
      return;
    }
    createWasteMutation.mutate();
  };

  const resetToStart = () => {
    setWasteType(null);
    setSelectedCategoryId(null);
    setSelectedItemId(null);
    setQuantity("");
    setReasonCode("");
    setNotes("");
  };

  const wasteReasons = [
    { value: "SPOILED", label: "Spoiled / Expired" },
    { value: "DAMAGED", label: "Damaged" },
    { value: "OVERPRODUCTION", label: "Over Production" },
    { value: "DROPPED", label: "Dropped" },
    { value: "CUSTOMER_COMPLAINT", label: "Customer Complaint" },
    { value: "QUALITY", label: "Quality Issue" },
    { value: "OTHER", label: "Other" },
  ];

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={resetToStart}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Waste Entry</h1>
          {selectedStore && (
            <p className="text-muted-foreground">{selectedStore.name}</p>
          )}
        </div>
      </div>

      {/* Store Selection */}
      {stores.length > 1 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <Label>Select Store</Label>
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger data-testid="select-store" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Select Waste Type */}
      {!wasteType && (
        <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
          <Card 
            className="hover-elevate cursor-pointer"
            onClick={() => setWasteType('inventory')}
            data-testid="card-inventory-waste"
          >
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-10 w-10 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Inventory Waste</h3>
                  <p className="text-muted-foreground">
                    Log waste for raw ingredients and inventory items
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="hover-elevate cursor-pointer"
            onClick={() => setWasteType('menu_item')}
            data-testid="card-menu-item-waste"
          >
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <UtensilsCrossed className="h-10 w-10 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Menu Item Waste</h3>
                  <p className="text-muted-foreground">
                    Log waste for prepared menu items
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Select Category */}
      {wasteType && !selectedCategoryId && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Select Category</h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {categories
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(category => (
                <Button
                  key={category.id}
                  variant="outline"
                  size="lg"
                  className="h-24 text-lg"
                  onClick={() => setSelectedCategoryId(category.id)}
                  data-testid={`button-category-${category.id}`}
                >
                  {category.name}
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              ))}
          </div>
        </div>
      )}

      {/* Step 3: Select Item */}
      {wasteType && selectedCategoryId && !selectedItemId && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedCategoryId(null)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Categories
            </Button>
          </div>
          <h2 className="text-xl font-semibold mb-4">Select Item</h2>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {wasteType === 'inventory' && filteredInventoryItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                size="lg"
                className="h-20 justify-start text-left"
                onClick={() => setSelectedItemId(item.id)}
                data-testid={`button-item-${item.id}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-muted-foreground">
                    ${item.pricePerUnit.toFixed(2)} / {formatUnitName(item.unitId)}
                  </div>
                </div>
              </Button>
            ))}
            {wasteType === 'menu_item' && filteredMenuItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                size="lg"
                className="h-20 justify-start text-left"
                onClick={() => setSelectedItemId(item.id)}
                data-testid={`button-item-${item.id}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                </div>
              </Button>
            ))}
            {wasteType === 'inventory' && filteredInventoryItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No inventory items in this category
              </p>
            )}
            {wasteType === 'menu_item' && filteredMenuItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No menu items in this category
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Enter Waste Details */}
      {selectedItemId && (
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedItemId(null)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Items
            </Button>
          </div>
          
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">{selectedItem?.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {wasteType === 'inventory' ? 'Inventory Item' : 'Menu Item'}
                </p>
              </div>

              <div>
                <Label htmlFor="quantity">
                  Quantity Wasted *
                  {wasteType === 'inventory' && selectedItem && (
                    <span className="text-muted-foreground ml-2">
                      ({formatUnitName((selectedItem as InventoryItem).unitId)})
                    </span>
                  )}
                  {wasteType === 'menu_item' && (
                    <span className="text-muted-foreground ml-2">(count)</span>
                  )}
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="mt-2"
                  data-testid="input-quantity"
                />
              </div>

              <div>
                <Label htmlFor="reason">Reason *</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger id="reason" className="mt-2" data-testid="select-reason">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {wasteReasons.map(reason => (
                      <SelectItem key={reason.value} value={reason.value}>
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="mt-2"
                  data-testid="input-notes"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={createWasteMutation.isPending}
                  className="flex-1"
                  size="lg"
                  data-testid="button-submit-waste"
                >
                  {createWasteMutation.isPending ? "Saving..." : "Log Waste"}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetToStart}
                  size="lg"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
