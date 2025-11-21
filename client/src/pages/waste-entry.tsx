import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Package, UtensilsCrossed, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  department: string | null;
  recipeId: string | null;
};

type WasteLog = {
  id: string;
  wasteType: string;
  inventoryItemName: string | null;
  menuItemName: string | null;
  qty: number;
  unitName: string | null;
  reasonCode: string;
  notes: string | null;
  wastedAt: string;
  totalValue: number;
  storeName: string;
};

type Unit = {
  id: string;
  name: string;
  abbreviation: string;
  system: string;
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
  
  // Date filter state - default to last 7 days
  const defaultEndDate = useMemo(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }, []);
  
  const defaultStartDate = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return sevenDaysAgo.toISOString().split('T')[0];
  }, []);
  
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const { data: stores = [] } = useAccessibleStores();
  
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: inventoryItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    enabled: wasteType === 'inventory',
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
    enabled: wasteType === 'menu_item',
  });

  const { data: wasteLogs = [] } = useQuery<WasteLog[]>({
    queryKey: ["/api/waste", selectedStoreId, startDate, endDate],
    queryFn: selectedStoreId 
      ? () => fetch(`/api/waste?storeId=${selectedStoreId}&startDate=${startDate}&endDate=${endDate}`).then(res => res.json())
      : undefined,
    enabled: !!selectedStoreId && !!startDate && !!endDate,
  });

  // Set default store
  if (stores.length > 0 && !selectedStoreId) {
    setSelectedStoreId(stores[0].id);
  }

  const selectedStore = stores.find(s => s.id === selectedStoreId);

  // Get unique departments from menu items (include "Unassigned" for items without department)
  const menuDepartments = Array.from(
    new Set(
      menuItems.map(item => 
        (item.department && item.department.trim() !== '') 
          ? item.department 
          : '(No Department)'
      )
    )
  ).sort();

  // Get only categories that have items
  const categoriesWithItems = categories.filter(category => 
    inventoryItems.some(item => item.categoryId === category.id)
  );

  // Filter items by category/department
  const filteredInventoryItems = inventoryItems.filter(item => 
    selectedCategoryId ? item.categoryId === selectedCategoryId : false
  );

  const filteredMenuItems = menuItems.filter(item => {
    if (!selectedCategoryId) return false;
    
    // Handle "(No Department)" selection
    if (selectedCategoryId === '(No Department)') {
      return !item.department || item.department.trim() === '';
    }
    
    return item.department === selectedCategoryId;
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items/estimated-on-hand"] });
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
      {/* Header with Store Selector */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-4">
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
            <p className="text-muted-foreground">Log and track waste items</p>
          </div>
        </div>
        
        {/* Filters - Top Right */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <Label htmlFor="start-date" className="text-xs mb-1">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[160px] min-h-10 text-base"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex flex-col">
              <Label htmlFor="end-date" className="text-xs mb-1">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[160px] min-h-10 text-base"
                data-testid="input-end-date"
              />
            </div>
          </div>
          
          {/* Store Selector */}
          <div className="min-w-[200px]">
            <Label htmlFor="store-select" className="text-xs mb-1 block">Store</Label>
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger id="store-select" data-testid="select-store">
                <SelectValue placeholder="Select Store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                    {store.city && <span className="text-muted-foreground ml-2">({store.city})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Step 1: Select Waste Type */}
      {!wasteType && (
        <div className="grid gap-4 md:grid-cols-2 max-w-4xl mx-auto">
          <Card 
            className="hover-elevate cursor-pointer"
            onClick={() => setWasteType('inventory')}
            data-testid="card-inventory-waste"
          >
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-12 w-12 text-primary" />
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
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <UtensilsCrossed className="h-12 w-12 text-primary" />
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

      {/* Step 2: Select Category (Inventory) or Department (Menu Items) */}
      {wasteType && !selectedCategoryId && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {wasteType === 'inventory' ? 'Select Category' : 'Select Department'}
          </h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {wasteType === 'inventory' && categoriesWithItems
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
            {wasteType === 'menu_item' && menuDepartments.map(department => (
                <Button
                  key={department}
                  variant="outline"
                  size="lg"
                  className="h-24 text-lg"
                  onClick={() => setSelectedCategoryId(department)}
                  data-testid={`button-department-${department}`}
                >
                  {department}
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              ))}
            {wasteType === 'inventory' && categoriesWithItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No inventory categories with items found
              </p>
            )}
            {wasteType === 'menu_item' && menuDepartments.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No menu item departments found
              </p>
            )}
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
              {wasteType === 'inventory' ? 'Back to Categories' : 'Back to Departments'}
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
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setSelectedItemId(null)}
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back to Items
            </Button>
          </div>
          
          <Card>
            <CardContent className="pt-8 space-y-8">
              {/* Item Name */}
              <div className="text-center pb-4 border-b">
                <h3 className="text-2xl md:text-3xl font-semibold mb-2">{selectedItem?.name}</h3>
                <p className="text-lg text-muted-foreground">
                  {wasteType === 'inventory' ? 'Inventory Item' : 'Menu Item'}
                </p>
              </div>

              {/* Quantity with Number Pad */}
              <div>
                <Label htmlFor="quantity" className="text-xl mb-3 block">
                  Quantity Wasted *
                  {wasteType === 'inventory' && selectedItem && (() => {
                    const unit = units.find(u => u.id === (selectedItem as InventoryItem).unitId);
                    const unitDisplay = unit ? formatUnitName(unit.name) : 'units';
                    return (
                      <span className="text-muted-foreground ml-2">
                        ({unitDisplay})
                      </span>
                    );
                  })()}
                  {wasteType === 'menu_item' && (
                    <span className="text-muted-foreground ml-2">(count)</span>
                  )}
                </Label>
                
                {/* Large Quantity Display */}
                <div className="bg-muted rounded-lg p-6 mb-6">
                  <div className="text-center text-5xl md:text-6xl font-bold tabular-nums min-h-[80px] flex items-center justify-center">
                    {quantity || "0"}
                  </div>
                </div>

                {/* On-Screen Number Pad */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <Button
                      key={num}
                      variant="outline"
                      size="lg"
                      className="h-20 text-3xl font-semibold"
                      onClick={() => setQuantity(prev => prev + num.toString())}
                      data-testid={`button-num-${num}`}
                    >
                      {num}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-3xl font-semibold"
                    onClick={() => setQuantity(prev => prev.includes('.') ? prev : prev + '.')}
                    data-testid="button-decimal"
                  >
                    .
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-3xl font-semibold"
                    onClick={() => setQuantity(prev => prev + '0')}
                    data-testid="button-num-0"
                  >
                    0
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-2xl"
                    onClick={() => setQuantity(prev => prev.slice(0, -1))}
                    data-testid="button-backspace"
                  >
                    ⌫
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full h-14 text-lg"
                  onClick={() => setQuantity('')}
                  data-testid="button-clear"
                >
                  Clear
                </Button>
              </div>

              {/* Reason */}
              <div>
                <Label htmlFor="reason" className="text-xl mb-3 block">Reason *</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger id="reason" className="h-16 text-lg" data-testid="select-reason">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {wasteReasons.map(reason => (
                      <SelectItem key={reason.value} value={reason.value} className="text-lg py-3">
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div>
                <Label htmlFor="notes" className="text-xl mb-3 block">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="min-h-[120px] text-lg"
                  data-testid="input-notes"
                />
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4 pt-4">
                <Button
                  variant="outline"
                  onClick={resetToStart}
                  size="lg"
                  className="h-16 text-lg"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createWasteMutation.isPending}
                  size="lg"
                  className="h-16 text-lg"
                  data-testid="button-submit-waste"
                >
                  {createWasteMutation.isPending ? "Saving..." : "Log Waste"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Waste Log History */}
      {!selectedItemId && (
        <div className="mt-8 max-w-7xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Waste Log</CardTitle>
            </CardHeader>
            <CardContent>
              {wasteLogs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No waste entries yet</p>
              ) : (() => {
                const sortedLogs = wasteLogs.sort((a, b) => 
                  new Date(b.wastedAt).getTime() - new Date(a.wastedAt).getTime()
                );
                
                const inventoryLogs = sortedLogs.filter(log => log.wasteType === 'inventory');
                const menuItemLogs = sortedLogs.filter(log => log.wasteType === 'menu_item');
                
                const inventorySubtotal = inventoryLogs.reduce((sum, log) => sum + log.totalValue, 0);
                const menuItemSubtotal = menuItemLogs.reduce((sum, log) => sum + log.totalValue, 0);
                const grandTotal = inventorySubtotal + menuItemSubtotal;

                return (
                  <div className="space-y-6">
                    {/* Inventory Items Section */}
                    {inventoryLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Package className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">Inventory Items</h3>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Item</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead>Reason</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inventoryLogs.map(log => (
                              <TableRow key={log.id} data-testid={`waste-log-${log.id}`}>
                                <TableCell className="whitespace-nowrap">
                                  {new Date(log.wastedAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{log.inventoryItemName}</div>
                                    {log.notes && (
                                      <div className="text-sm text-muted-foreground italic">
                                        {log.notes}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {log.qty} {log.unitName}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {log.reasonCode.replace(/_/g, ' ')}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  ${log.totalValue.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-semibold bg-muted/50">
                              <TableCell colSpan={4} className="text-right">
                                Inventory Subtotal
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                ${inventorySubtotal.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Menu Items Section */}
                    {menuItemLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <UtensilsCrossed className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">Menu Items</h3>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Item</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead>Reason</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {menuItemLogs.map(log => (
                              <TableRow key={log.id} data-testid={`waste-log-${log.id}`}>
                                <TableCell className="whitespace-nowrap">
                                  {new Date(log.wastedAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{log.menuItemName}</div>
                                    {log.notes && (
                                      <div className="text-sm text-muted-foreground italic">
                                        {log.notes}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {log.qty}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {log.reasonCode.replace(/_/g, ' ')}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  ${log.totalValue.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-semibold bg-muted/50">
                              <TableCell colSpan={4} className="text-right">
                                Menu Items Subtotal
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                ${menuItemSubtotal.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Grand Total */}
                    <div className="flex justify-end pt-4 border-t">
                      <div className="text-right">
                        <div className="text-lg font-bold">
                          Total Waste Value: <span className="tabular-nums">${grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
