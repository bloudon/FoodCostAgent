import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Save, Package } from "lucide-react";
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
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = id === "new";

  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [orderLines, setOrderLines] = useState<{ 
    vendorItemId: string; 
    inventoryItemId?: string; 
    unitId?: string; 
    unitName?: string; 
    qty: number; 
    price: number;
    caseQuantity?: number;
    caseSize?: number;
  }[]>([]);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const { data: purchaseOrder, isLoading: loadingOrder } = useQuery<PurchaseOrderDetail>({
    queryKey: [`/api/purchase-orders/${id}`],
    enabled: !isNew,
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  // Check if selected vendor is Misc Grocery (by ID for consistency)
  const MISC_GROCERY_VENDOR_ID = "d3c1ebe2-3ca9-4858-ac08-e7f00e0edb1a";
  const isMiscGrocery = selectedVendor === MISC_GROCERY_VENDOR_ID;

  const { data: vendorItems } = useQuery<VendorItem[]>({
    queryKey: [`/api/vendor-items?vendor_id=${selectedVendor}`],
    enabled: !!selectedVendor,
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

  const handleAddLine = (itemId: string) => {
    if (isMiscGrocery) {
      // For misc grocery, itemId is actually an inventory item ID
      const invItem = inventoryItems?.find(item => item.id === itemId);
      if (!invItem) return;

      setOrderLines(prev => [...prev, {
        vendorItemId: "", // Will be created on save
        inventoryItemId: itemId, // Store inventory item ID
        unitId: invItem.unitId, // Store the unit ID
        unitName: invItem.unitName, // Store the unit name
        qty: 0,
        price: invItem.pricePerUnit || 0,
        caseQuantity: undefined,
        caseSize: undefined,
      }]);
    } else {
      // For regular vendors, use case-based ordering
      const vendorItem = vendorItems?.find(item => item.id === itemId);
      if (!vendorItem) return;

      const caseSize = vendorItem.inventoryItem?.caseSize || 1;
      const unitPrice = vendorItem.inventoryItem?.pricePerUnit || vendorItem.lastPrice || 0;

      setOrderLines(prev => [...prev, {
        vendorItemId: itemId,
        unitId: vendorItem.purchaseUnitId, // Store the unit ID
        unitName: vendorItem.purchaseUnitName, // Store the unit name
        qty: 0, // Will be calculated from caseQuantity * caseSize
        price: unitPrice, // Unit price
        caseQuantity: 0,
        caseSize: caseSize,
      }]);
    }
  };

  const handleUpdateLine = (index: number, field: 'qty' | 'price' | 'caseQuantity', value: number) => {
    setOrderLines(prev => {
      const updated = [...prev];
      if (field === 'caseQuantity' && updated[index].caseSize) {
        // Update caseQuantity and calculate orderedQty
        updated[index] = { 
          ...updated[index], 
          caseQuantity: value,
          qty: value * updated[index].caseSize! 
        };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number, field: 'qty' | 'price' | 'caseQuantity') => {
    if (e.key === 'Tab' && !e.shiftKey) {
      // For case-based ordering, navigate: caseQuantity -> next caseQuantity
      // For Misc Grocery, navigate: qty -> price -> next qty
      const line = orderLines[currentIndex];
      const isCaseBased = !isMiscGrocery && line.caseSize !== undefined;
      
      let nextField: string;
      let nextIndex: number;
      
      if (isCaseBased) {
        // Case-based: just move to next row's caseQuantity
        nextField = 'caseQuantity';
        nextIndex = currentIndex + 1;
      } else {
        // Misc Grocery: toggle between qty and price
        nextField = field === 'qty' ? 'price' : 'qty';
        nextIndex = field === 'price' ? currentIndex + 1 : currentIndex;
      }
      
      const nextRef = inputRefs.current[`${nextIndex}-${nextField}`];
      
      if (nextRef) {
        e.preventDefault();
        nextRef.focus();
        nextRef.select();
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

    const poData = {
      vendorId: selectedVendor,
      expectedDate: expectedDate || null,
      status: "pending",
      notes: notes || null,
      lines: orderLines.map(line => {
        if (isMiscGrocery) {
          // For new misc grocery items (have inventoryItemId)
          if (line.inventoryItemId) {
            return {
              inventoryItemId: line.inventoryItemId,
              orderedQty: line.qty,
              unitId: line.unitId || "",
              priceEach: line.price,
            };
          } else {
            // For existing misc grocery items (have vendorItemId already)
            return {
              vendorItemId: line.vendorItemId,
              orderedQty: line.qty,
              unitId: line.unitId || "",
              priceEach: line.price,
            };
          }
        } else {
          // For regular vendors (case-based ordering)
          return {
            vendorItemId: line.vendorItemId,
            orderedQty: line.qty, // Already calculated from caseQuantity * caseSize
            caseQuantity: line.caseQuantity || 0,
            unitId: line.unitId || "",
            priceEach: line.price, // Unit price
          };
        }
      }),
    };

    savePOMutation.mutate(poData);
  };

  useEffect(() => {
    if (purchaseOrder && !isNew) {
      setSelectedVendor(purchaseOrder.vendorId);
      setExpectedDate(purchaseOrder.expectedDate || "");
      setNotes((purchaseOrder as any).notes || "");
      
      // For misc grocery orders, we need to track the inventoryItemId too
      const isMiscGroceryOrder = purchaseOrder.vendorId === MISC_GROCERY_VENDOR_ID;
      
      // Only populate order lines when vendorItems are available (for case-based orders)
      // or for misc grocery orders
      if (isMiscGroceryOrder || vendorItems) {
        setOrderLines(purchaseOrder.lines.map(line => {
          const vendorItem = vendorItems?.find(vi => vi.id === line.vendorItemId);
          const caseSize = vendorItem?.inventoryItem?.caseSize;
          const caseQuantity = (line as any).caseQuantity;
          
          return {
            vendorItemId: line.vendorItemId,
            inventoryItemId: isMiscGroceryOrder ? vendorItem?.inventoryItemId : undefined,
            unitId: line.unitId,
            unitName: (line as any).unitName, // Use unit name from API response
            qty: line.orderedQty,
            price: line.priceEach,
            caseQuantity: caseQuantity,
            caseSize: caseSize,
          };
        }));
      }
    }
  }, [purchaseOrder, isNew, vendorItems]);

  const totalAmount = orderLines.reduce((sum, line) => sum + (line.qty * line.price), 0);

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
              disabled={savePOMutation.isPending || !selectedVendor || orderLines.length === 0}
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

        {selectedVendor && isNew && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Add Item</label>
            <Select onValueChange={handleAddLine}>
              <SelectTrigger data-testid="select-add-item">
                <SelectValue placeholder="Select item to add" />
              </SelectTrigger>
              <SelectContent>
                {isMiscGrocery ? (
                  inventoryItems?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} - ${item.pricePerUnit?.toFixed(2) || '0.00'}
                    </SelectItem>
                  ))
                ) : (
                  vendorItems?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.inventoryItemName} - ${item.lastPrice?.toFixed(2) || '0.00'}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {orderLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No items added</h3>
            <p className="text-muted-foreground text-sm">
              {selectedVendor ? "Add items to your purchase order" : "Select a vendor to begin"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Item</TableHead>
                  <TableHead>Vendor SKU</TableHead>
                  {!isMiscGrocery && (
                    <>
                      <TableHead className="text-right">Case Size</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Case Price</TableHead>
                      <TableHead className="w-[150px]">Case Qty</TableHead>
                    </>
                  )}
                  {isMiscGrocery && (
                    <>
                      <TableHead>Unit</TableHead>
                      <TableHead className="w-[150px]">Quantity</TableHead>
                      <TableHead className="w-[150px]">Price Each</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderLines.map((line, index) => {
                  const isCaseBased = !isMiscGrocery && line.caseSize !== undefined;
                  const casePrice = isCaseBased ? (line.price * (line.caseSize || 1)) : 0;
                  const lineTotal = isCaseBased 
                    ? (casePrice * (line.caseQuantity || 0))
                    : (line.qty * line.price);
                  
                  let itemName = 'Unknown Item';
                  let vendorSku = '-';
                  let unitName = line.unitName || '-';

                  if (isMiscGrocery) {
                    const invItemId = line.inventoryItemId || line.vendorItemId;
                    let invItem = inventoryItems?.find(item => item.id === invItemId);
                    
                    if (!invItem && line.vendorItemId) {
                      const vendorItem = vendorItems?.find(item => item.id === line.vendorItemId);
                      invItem = inventoryItems?.find(item => item.id === vendorItem?.inventoryItemId);
                    }
                    
                    itemName = invItem?.name || 'Unknown Item';
                    vendorSku = 'N/A';
                  } else {
                    const vendorItem = vendorItems?.find(item => item.id === line.vendorItemId);
                    itemName = vendorItem?.inventoryItemName || 'Unknown Item';
                    vendorSku = vendorItem?.vendorSku || '-';
                  }

                  return (
                    <TableRow key={`${line.vendorItemId}-${index}`} data-testid={`row-line-${index}`}>
                      <TableCell>
                        <div className="font-medium">{itemName}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {vendorSku}
                      </TableCell>
                      {isCaseBased && (
                        <>
                          <TableCell className="text-right font-mono">
                            {line.caseSize || 1}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${line.price.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${casePrice.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Input
                              ref={el => inputRefs.current[`${index}-caseQuantity`] = el}
                              type="number"
                              step="0.01"
                              value={line.caseQuantity || 0}
                              onChange={(e) => handleUpdateLine(index, 'caseQuantity', parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => handleKeyDown(e, index, 'caseQuantity')}
                              className="font-mono"
                              data-testid={`input-case-qty-${index}`}
                            />
                          </TableCell>
                        </>
                      )}
                      {isMiscGrocery && (
                        <>
                          <TableCell className="text-sm text-muted-foreground">
                            {unitName}
                          </TableCell>
                          <TableCell>
                            <Input
                              ref={el => inputRefs.current[`${index}-qty`] = el}
                              type="number"
                              step="0.01"
                              value={line.qty}
                              onChange={(e) => handleUpdateLine(index, 'qty', parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => handleKeyDown(e, index, 'qty')}
                              className="font-mono"
                              data-testid={`input-qty-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              ref={el => inputRefs.current[`${index}-price`] = el}
                              type="number"
                              step="0.01"
                              value={line.price}
                              onChange={(e) => handleUpdateLine(index, 'price', parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => handleKeyDown(e, index, 'price')}
                              className="font-mono"
                              data-testid={`input-price-${index}`}
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
                <TableRow>
                  <TableCell colSpan={isMiscGrocery ? 4 : 6} className="text-right font-semibold">
                    Total:
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-lg" data-testid="text-total">
                    ${totalAmount.toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
