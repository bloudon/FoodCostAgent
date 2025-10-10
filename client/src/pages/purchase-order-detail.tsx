import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Save, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PurchaseOrderDetail = {
  id: string;
  vendorId: string;
  vendorName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
  lines: POLineDisplay[];
};

type POLineDisplay = {
  id: string;
  vendorItemId: string;
  inventoryItemId?: string;
  itemName: string;
  vendorSku: string | null;
  orderedQty: number;
  unitId: string;
  unitName: string;
  priceEach: number;
  lineTotal: number;
};

type VendorItem = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  vendorSku: string | null;
  lastPrice: number;
  purchaseUnitId: string;
  purchaseUnitName: string;
  categoryId: string | null;
  categoryName: string | null;
  inventoryItem?: {
    caseSize: number;
    pricePerUnit: number;
  };
};

type Vendor = {
  id: string;
  name: string;
  accountNumber: string | null;
};

type InventoryItem = {
  id: string;
  name: string;
  unitId: string;
  unitName: string;
  pricePerUnit: number;
  categoryId: string | null;
  categoryName: string | null;
};

type Category = {
  id: string;
  name: string;
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = id === "new";

  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  
  // Track case quantities for each vendor item
  const [caseQuantities, setCaseQuantities] = useState<Record<string, number>>({});
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const { data: purchaseOrder, isLoading: loadingOrder } = useQuery<PurchaseOrderDetail>({
    queryKey: [`/api/purchase-orders/${id}`],
    enabled: !isNew,
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // Check if selected vendor is Misc Grocery
  const MISC_GROCERY_VENDOR_ID = "d3c1ebe2-3ca9-4858-ac08-e7f00e0edb1a";
  const isMiscGrocery = selectedVendor === MISC_GROCERY_VENDOR_ID;

  const { data: vendorItems } = useQuery<VendorItem[]>({
    queryKey: [`/api/vendor-items?vendor_id=${selectedVendor}`],
    enabled: !!selectedVendor && !isMiscGrocery,
  });

  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    enabled: !!selectedVendor && isMiscGrocery,
  });

  const savePOMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isNew) {
        return await apiRequest("POST", "/api/purchase-orders", data);
      } else {
        return await apiRequest("PATCH", `/api/purchase-orders/${id}`, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (!isNew) {
        queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/vendor-items?vendor_id=${selectedVendor}`] });
      }
      toast({
        title: "Success",
        description: `Purchase order ${isNew ? "created" : "updated"} successfully`,
      });
      if (isNew) {
        setLocation("/purchase-orders");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save purchase order",
        variant: "destructive",
      });
    },
  });

  const handleCaseQuantityChange = (itemId: string, value: number) => {
    setCaseQuantities(prev => ({
      ...prev,
      [itemId]: value
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentItemId: string, items: any[]) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const currentIndex = items.findIndex(item => item.id === currentItemId);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < items.length) {
        const nextItemId = items[nextIndex].id;
        const nextRef = inputRefs.current[nextItemId];
        
        if (nextRef) {
          e.preventDefault();
          nextRef.focus();
          nextRef.select();
        }
      }
    }
  };

  const handleSave = () => {
    if (!selectedVendor) {
      toast({
        title: "Error",
        description: "Please select a vendor",
        variant: "destructive",
      });
      return;
    }

    const lines = Object.entries(caseQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, caseQty]) => {
        if (isMiscGrocery) {
          const invItem = inventoryItems?.find(item => item.id === itemId);
          return {
            inventoryItemId: itemId,
            orderedQty: caseQty,
            unitId: invItem?.unitId || "",
            priceEach: invItem?.pricePerUnit || 0,
          };
        } else {
          const vendorItem = vendorItems?.find(item => item.id === itemId);
          const caseSize = vendorItem?.inventoryItem?.caseSize || 1;
          const unitPrice = vendorItem?.inventoryItem?.pricePerUnit || vendorItem?.lastPrice || 0;
          
          return {
            vendorItemId: itemId,
            orderedQty: caseQty * caseSize,
            caseQuantity: caseQty,
            unitId: vendorItem?.purchaseUnitId || "",
            priceEach: unitPrice,
          };
        }
      });

    if (lines.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one item with quantity",
        variant: "destructive",
      });
      return;
    }

    const poData = {
      vendorId: selectedVendor,
      expectedDate: expectedDate || null,
      status: "pending",
      notes: notes || null,
      lines,
    };

    savePOMutation.mutate(poData);
  };

  useEffect(() => {
    if (purchaseOrder && !isNew) {
      setSelectedVendor(purchaseOrder.vendorId);
      setExpectedDate(purchaseOrder.expectedDate || "");
      setNotes((purchaseOrder as any).notes || "");
    }
  }, [purchaseOrder, isNew]);

  // Separate effect to populate quantities after vendorItems/inventoryItems are loaded
  useEffect(() => {
    if (purchaseOrder && !isNew && (vendorItems || inventoryItems)) {
      const quantities: Record<string, number> = {};
      const isMiscGroceryOrder = purchaseOrder.vendorId === MISC_GROCERY_VENDOR_ID;
      
      purchaseOrder.lines.forEach((line) => {
        let itemId: string;
        
        if (isMiscGroceryOrder) {
          // For Misc Grocery: use inventoryItemId from the line (or vendorItemId as fallback)
          itemId = (line as any).inventoryItemId || line.vendorItemId;
        } else {
          // For regular vendors: use vendorItemId
          itemId = line.vendorItemId;
        }
        
        const caseQty = (line as any).caseQuantity;
        if (caseQty !== undefined && caseQty !== null) {
          quantities[itemId] = caseQty;
        } else {
          // For misc grocery or unit-based orders (use orderedQty)
          quantities[itemId] = line.orderedQty;
        }
      });
      
      setCaseQuantities(quantities);
    }
  }, [purchaseOrder, isNew, vendorItems, inventoryItems, MISC_GROCERY_VENDOR_ID]);

  // Filter items based on search and category
  const filteredVendorItems = vendorItems?.filter(item => {
    const matchesSearch = item.inventoryItemName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendorSku?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const filteredInventoryItems = inventoryItems?.filter(item => {
    const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const displayItems = isMiscGrocery ? filteredInventoryItems : filteredVendorItems;

  // Calculate total
  const totalAmount = Object.entries(caseQuantities).reduce((sum, [itemId, caseQty]) => {
    if (caseQty <= 0) return sum;
    
    if (isMiscGrocery) {
      const invItem = inventoryItems?.find(item => item.id === itemId);
      return sum + (caseQty * (invItem?.pricePerUnit || 0));
    } else {
      const vendorItem = vendorItems?.find(item => item.id === itemId);
      const caseSize = vendorItem?.inventoryItem?.caseSize || 1;
      const unitPrice = vendorItem?.inventoryItem?.pricePerUnit || vendorItem?.lastPrice || 0;
      const casePrice = unitPrice * caseSize;
      return sum + (caseQty * casePrice);
    }
  }, 0);

  const itemsWithQuantity = Object.values(caseQuantities).filter(qty => qty > 0).length;

  if (loadingOrder && !isNew) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading purchase order...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/purchase-orders")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">
                {isNew ? "New Purchase Order" : `Purchase Order #${id?.slice(0, 8)}`}
              </h1>
              <p className="text-muted-foreground mt-1">
                {isNew ? "Create a new purchase order" : "Edit purchase order details"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={savePOMutation.isPending || !selectedVendor || itemsWithQuantity === 0}
              data-testid="button-save-po"
            >
              <Save className="h-4 w-4 mr-2" />
              {savePOMutation.isPending ? "Saving..." : "Save Order"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Vendor</label>
            <Select 
              value={selectedVendor} 
              onValueChange={setSelectedVendor}
              disabled={!isNew}
            >
              <SelectTrigger data-testid="select-vendor">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors?.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Expected Date</label>
            <Input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              data-testid="input-expected-date"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Badge variant="secondary" className="text-sm">
              {purchaseOrder?.status || "Pending"}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Notes</label>
          <Input
            placeholder="Add notes or comments about this order..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            data-testid="input-notes"
          />
        </div>

        {selectedVendor && (
          <>
            <div className="flex gap-4 flex-wrap items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-items"
                />
              </div>
              <div className="w-[200px]">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger data-testid="select-category-filter">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories?.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {itemsWithQuantity} items • Total: ${totalAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No items found</h3>
                <p className="text-muted-foreground text-sm">
                  Try adjusting your search or filters
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[300px]">Item</TableHead>
                      <TableHead>Category</TableHead>
                      {!isMiscGrocery && (
                        <>
                          <TableHead>Vendor SKU</TableHead>
                          <TableHead className="text-right">Case Size</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Case Price</TableHead>
                          <TableHead className="w-[150px]">Case Qty</TableHead>
                        </>
                      )}
                      {isMiscGrocery && (
                        <>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Price Each</TableHead>
                          <TableHead className="w-[150px]">Quantity</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayItems.map((item: any) => {
                      const itemId = item.id;
                      const caseQty = caseQuantities[itemId] || 0;
                      
                      let itemName: string;
                      let inventoryItemId: string;
                      let categoryName: string;
                      let vendorSku: string = '-';
                      let caseSize: number = 1;
                      let unitPrice: number;
                      let casePrice: number = 0;
                      let unitName: string = '-';
                      let lineTotal: number;
                      
                      if (isMiscGrocery) {
                        itemName = item.name;
                        inventoryItemId = item.id;
                        categoryName = item.categoryName || '-';
                        unitName = item.unitName || '-';
                        unitPrice = item.pricePerUnit;
                        lineTotal = caseQty * unitPrice;
                      } else {
                        itemName = item.inventoryItemName;
                        inventoryItemId = item.inventoryItemId;
                        categoryName = item.categoryName || '-';
                        vendorSku = item.vendorSku || '-';
                        caseSize = item.inventoryItem?.caseSize || 1;
                        unitPrice = item.inventoryItem?.pricePerUnit || item.lastPrice || 0;
                        casePrice = unitPrice * caseSize;
                        lineTotal = caseQty * casePrice;
                      }

                      return (
                        <TableRow key={itemId} data-testid={`row-item-${itemId}`}>
                          <TableCell>
                            <Link 
                              href={`/inventory-items/${inventoryItemId}`}
                              className="font-medium hover:text-primary hover:underline"
                              data-testid={`link-item-${inventoryItemId}`}
                            >
                              {itemName}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {categoryName}
                          </TableCell>
                          {!isMiscGrocery && (
                            <>
                              <TableCell className="text-sm text-muted-foreground">
                                {vendorSku}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {caseSize || 1}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${unitPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                ${casePrice.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <Input
                                  ref={el => inputRefs.current[itemId] = el}
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={caseQty || ""}
                                  onChange={(e) => handleCaseQuantityChange(itemId, parseFloat(e.target.value) || 0)}
                                  onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                  className="text-center"
                                  placeholder="0"
                                  data-testid={`input-case-qty-${itemId}`}
                                />
                              </TableCell>
                            </>
                          )}
                          {isMiscGrocery && (
                            <>
                              <TableCell className="text-sm text-muted-foreground">
                                {unitName}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${unitPrice.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <Input
                                  ref={el => inputRefs.current[itemId] = el}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={caseQty || ""}
                                  onChange={(e) => handleCaseQuantityChange(itemId, parseFloat(e.target.value) || 0)}
                                  onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                  className="text-center"
                                  placeholder="0"
                                  data-testid={`input-qty-${itemId}`}
                                />
                              </TableCell>
                            </>
                          )}
                          <TableCell className="text-right font-mono font-semibold">
                            ${lineTotal.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        {!selectedVendor && (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No vendor selected</h3>
            <p className="text-muted-foreground text-sm">
              Select a vendor to view available items
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
