import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Save, PackageCheck, Search, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUnitName } from "@/lib/utils";

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
  caseQuantity: number | null;
  unitId: string;
  unitName: string;
  pricePerUnit: number;
  caseSize: number;
  lineTotal: number;
};

type Category = {
  id: string;
  name: string;
};

type DraftReceipt = {
  id: string;
  purchaseOrderId: string;
  status: string;
  storageLocationId: string | null;
};

type ReceiptLine = {
  id: string;
  receiptId: string;
  vendorItemId: string;
  receivedQty: number;
  unitId: string;
  priceEach: number;
};

type InventoryItem = {
  id: string;
  name: string;
  categoryId: string | null;
  pluSku: string;
  unitId: string;
  barcode: string | null;
  active: number;
  pricePerUnit: number;
  caseSize: number;
  storageLocationId: string;
  yieldPercent: number | null;
  parLevel: number | null;
  reorderLevel: number | null;
};

export default function ReceivingDetail() {
  const { poId } = useParams<{ poId: string }>();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Get receiptId from query parameter if present
  const searchParams = new URLSearchParams(location.split('?')[1]);
  const receiptIdParam = searchParams.get('receiptId');
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [draftReceiptId, setDraftReceiptId] = useState<string | null>(null);
  
  // Track received quantities for each PO line (in units, not cases)
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [savedLines, setSavedLines] = useState<Set<string>>(new Set());
  const [editingLines, setEditingLines] = useState<Set<string>>(new Set());
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // Item editing dialog state
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [itemEditForm, setItemEditForm] = useState({
    name: "",
    categoryId: "",
    pricePerUnit: "",
    caseSize: "",
    parLevel: "",
    reorderLevel: "",
  });

  const { data: purchaseOrder, isLoading: loadingOrder} = useQuery<PurchaseOrderDetail>({
    queryKey: [`/api/purchase-orders/${poId}`],
  });

  // Build consistent query key for receipt data (used for both fetch and invalidation)
  const receiptQueryKey = receiptIdParam 
    ? [`/api/receipts/draft/${poId}?receiptId=${receiptIdParam}`] 
    : [`/api/receipts/draft/${poId}`];

  const { data: draftReceiptData } = useQuery<{ receipt: DraftReceipt; lines: ReceiptLine[] }>({
    queryKey: receiptQueryKey,
    enabled: !!poId,
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // Load draft receipt data when available
  useEffect(() => {
    if (draftReceiptData?.receipt && purchaseOrder?.lines) {
      setDraftReceiptId(draftReceiptData.receipt.id);

      // Build complete received quantities object
      const allQtys: Record<string, number> = {};
      const savedSet = new Set<string>();
      
      // First, load saved receipt lines
      draftReceiptData.lines.forEach(line => {
        // Match by vendorItemId to find the corresponding PO line
        const poLine = purchaseOrder.lines.find(pl => pl.vendorItemId === line.vendorItemId);
        if (poLine) {
          allQtys[poLine.id] = line.receivedQty;
          savedSet.add(poLine.id);
        }
      });

      // Then, initialize unsaved lines with expected quantities
      purchaseOrder.lines.forEach(line => {
        if (!savedSet.has(line.id)) {
          // For case-based orders, use orderedQty (already in units)
          // For unit-based orders (Misc Grocery), use orderedQty directly
          allQtys[line.id] = line.orderedQty;
        }
      });

      setReceivedQuantities(allQtys);
      setSavedLines(savedSet);
    }
  }, [draftReceiptData, purchaseOrder]);

  const saveLineMutation = useMutation({
    mutationFn: async (data: { receiptId: string; vendorItemId: string; receivedQty: number; unitId: string; pricePerUnit: number }) => {
      return await apiRequest("POST", "/api/receipt-lines", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptQueryKey });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save line",
        variant: "destructive",
      });
    },
  });

  const completeReceivingMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      return await apiRequest("PATCH", `/api/receipts/${receiptId}/complete`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({
        title: "Success",
        description: "Items received successfully",
      });
      setLocation("/orders");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to complete receiving",
        variant: "destructive",
      });
    },
  });

  const reopenReceiptMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      return await apiRequest("PATCH", `/api/receipts/${receiptId}/reopen`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptQueryKey });
      toast({
        title: "Success",
        description: "Receipt reopened for editing",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reopen receipt",
        variant: "destructive",
      });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async (data: { id: string; updates: any }) => {
      return await apiRequest("PATCH", `/api/inventory-items/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Success",
        description: "Item updated successfully",
      });
      setEditingItem(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update item",
        variant: "destructive",
      });
    },
  });

  const handleReceivedQuantityChange = (lineId: string, value: number) => {
    setReceivedQuantities(prev => ({
      ...prev,
      [lineId]: value
    }));
    // Remove from saved set when quantity is modified
    setSavedLines(prev => {
      const newSet = new Set(prev);
      newSet.delete(lineId);
      return newSet;
    });
  };

  const handleSaveLine = (lineId: string) => {
    const line = purchaseOrder?.lines.find(l => l.id === lineId);
    if (!line || !draftReceiptId) return;

    saveLineMutation.mutate({
      receiptId: draftReceiptId,
      vendorItemId: line.vendorItemId,
      receivedQty: receivedQuantities[lineId] || 0,
      unitId: line.unitId,
      pricePerUnit: line.pricePerUnit,
    }, {
      onSuccess: () => {
        setSavedLines(prev => new Set(prev).add(lineId));
        setEditingLines(prev => {
          const newSet = new Set(prev);
          newSet.delete(lineId);
          return newSet;
        });
        toast({
          description: "Quantity confirmed",
        });
      }
    });
  };

  const handleToggleEdit = (lineId: string) => {
    setEditingLines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lineId)) {
        newSet.delete(lineId);
      } else {
        newSet.add(lineId);
        // Focus the input after state updates
        setTimeout(() => {
          const input = inputRefs.current[lineId];
          if (input) {
            input.focus();
            input.select();
          }
        }, 0);
      }
      return newSet;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentLineId: string, filteredLines: POLineDisplay[]) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveLine(currentLineId);
      
      // Move to next input
      const currentIndex = filteredLines.findIndex(line => line.id === currentLineId);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < filteredLines.length) {
        const nextLineId = filteredLines[nextIndex].id;
        const nextRef = inputRefs.current[nextLineId];
        
        if (nextRef) {
          nextRef.focus();
          nextRef.select();
        }
      }
    } else if (e.key === 'Tab' && !e.shiftKey) {
      const currentIndex = filteredLines.findIndex(line => line.id === currentLineId);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < filteredLines.length) {
        const nextLineId = filteredLines[nextIndex].id;
        const nextRef = inputRefs.current[nextLineId];
        
        if (nextRef) {
          e.preventDefault();
          nextRef.focus();
          nextRef.select();
        }
      }
    }
  };

  const handleCompleteReceiving = () => {
    if (!draftReceiptId) {
      toast({
        title: "Error",
        description: "No receipt to complete",
        variant: "destructive",
      });
      return;
    }

    completeReceivingMutation.mutate(draftReceiptId);
  };

  const handleOpenItemEdit = (inventoryItemId: string) => {
    fetch(`/api/inventory-items/${inventoryItemId}`)
      .then(response => response.json())
      .then((item: InventoryItem) => {
        setEditingItem(item);
        setItemEditForm({
          name: item.name,
          categoryId: item.categoryId || "",
          pricePerUnit: item.pricePerUnit.toString(),
          caseSize: item.caseSize.toString(),
          parLevel: item.parLevel?.toString() || "",
          reorderLevel: item.reorderLevel?.toString() || "",
        });
      })
      .catch((error) => {
        toast({
          title: "Error",
          description: "Failed to load item details",
          variant: "destructive",
        });
      });
  };

  const handleCloseItemEdit = () => {
    setEditingItem(null);
    setItemEditForm({
      name: "",
      categoryId: "",
      pricePerUnit: "",
      caseSize: "",
      parLevel: "",
      reorderLevel: "",
    });
  };

  const handleSaveItem = () => {
    if (!editingItem) return;

    const updates: any = {
      name: itemEditForm.name,
      categoryId: itemEditForm.categoryId === "" ? null : itemEditForm.categoryId,
      pricePerUnit: parseFloat(itemEditForm.pricePerUnit),
      caseSize: parseFloat(itemEditForm.caseSize),
    };

    if (itemEditForm.parLevel !== "") {
      updates.parLevel = parseFloat(itemEditForm.parLevel);
    }
    if (itemEditForm.reorderLevel !== "") {
      updates.reorderLevel = parseFloat(itemEditForm.reorderLevel);
    }

    updateItemMutation.mutate({ id: editingItem.id, updates });
  };

  if (loadingOrder) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading purchase order...</div>
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h2 className="text-2xl font-semibold mb-2">Purchase Order Not Found</h2>
        <Link href="/orders">
          <Button variant="ghost">Back to Orders</Button>
        </Link>
      </div>
    );
  }

  const filteredLines = purchaseOrder.lines.filter(line => {
    const matchesSearch = line.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      line.vendorSku?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Get category from the line if available
    const lineCategory = categories?.find(c => 
      purchaseOrder.lines.find(l => l.id === line.id)
    );
    const matchesCategory = selectedCategory === "all" || 
      lineCategory?.id === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const totalExpected = filteredLines.reduce((sum, line) => sum + (line.orderedQty * line.pricePerUnit), 0);
  const totalItems = filteredLines.length;
  const totalCases = filteredLines.reduce((sum, line) => {
    return sum + (line.caseQuantity && line.caseQuantity > 0 ? line.caseQuantity : 0);
  }, 0);
  const totalActual = filteredLines.reduce((sum, line) => {
    const receivedQty = receivedQuantities[line.id] || 0;
    return sum + (receivedQty * line.pricePerUnit);
  }, 0);

  // Check if all lines are saved
  const allLinesSaved = purchaseOrder?.lines.length === savedLines.size;

  // Determine if this is a completed receipt (read-only mode)
  const isCompleted = draftReceiptData?.receipt?.status === "completed";
  const isReadOnly = isCompleted;

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/orders">
            <Button variant="ghost" data-testid="button-back-to-orders">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Orders
            </Button>
          </Link>
          <Link href={`/purchase-orders/${poId}`}>
            <Button variant="outline" data-testid="button-view-purchase-order">
              View Purchase Order
            </Button>
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-receiving-title">
              Receive Order
            </h1>
            <p className="text-muted-foreground mt-1">
              {purchaseOrder.vendorName} • PO #{purchaseOrder.id.slice(0, 8)}
            </p>
            {purchaseOrder.expectedDate && (
              <p className="text-xl font-semibold mt-2" data-testid="text-expected-date">
                Expected: {new Date(purchaseOrder.expectedDate).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex gap-2 items-start">
            <Badge 
              className={
                purchaseOrder.status === "ordered" 
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
              }
              data-testid="badge-po-status"
            >
              {purchaseOrder.status}
            </Badge>
            {isCompleted && (
              <Badge 
                className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                data-testid="badge-receipt-status"
              >
                received
              </Badge>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter actual units received (weights may vary)
                </p>
              </div>
              <div className="flex gap-4">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Total Cases</div>
                  <div className="text-2xl font-bold" data-testid="text-total-cases">{totalCases}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Total Items</div>
                  <div className="text-2xl font-bold">{totalItems}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Expected Value</div>
                  <div className="text-2xl font-bold">${totalExpected.toFixed(2)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Actual Value</div>
                  <div className="text-2xl font-bold" data-testid="text-actual-value">${totalActual.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-4 flex-wrap">
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
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Cases Ordered</TableHead>
                    <TableHead className="text-right">Case Size</TableHead>
                    <TableHead className="text-right">Case Price</TableHead>
                    <TableHead className="text-right">Unit Total</TableHead>
                    <TableHead className="text-right">Units Received</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground">
                        No items found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLines.map((line) => {
                      const receivedQty = receivedQuantities[line.id] || 0;
                      const isSaved = savedLines.has(line.id);
                      const isEditing = editingLines.has(line.id);
                      const lineTotal = receivedQty * line.pricePerUnit;
                      const isShort = receivedQty < line.orderedQty;
                      const casePrice = line.caseQuantity && line.caseQuantity > 0 ? line.pricePerUnit * line.caseSize : null;
                      
                      return (
                        <TableRow 
                          key={line.id} 
                          data-testid={`row-receive-item-${line.id}`}
                          className={isShort && isSaved ? "bg-red-50 dark:bg-red-950/20" : ""}
                        >
                          <TableCell className="font-medium">
                            {line.inventoryItemId && !isReadOnly ? (
                              <button
                                onClick={() => handleOpenItemEdit(line.inventoryItemId!)}
                                className="hover:underline text-left"
                                data-testid={`button-item-name-${line.id}`}
                              >
                                {line.itemName}
                              </button>
                            ) : (
                              line.itemName
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{line.vendorSku || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground" data-testid={`text-cases-ordered-${line.id}`}>
                            {line.caseQuantity && line.caseQuantity > 0 ? line.caseQuantity.toFixed(0) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground" data-testid={`text-case-size-${line.id}`}>
                            {line.caseQuantity && line.caseQuantity > 0 ? line.caseSize.toFixed(0) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground" data-testid={`text-case-price-${line.id}`}>
                            {casePrice !== null ? `$${casePrice.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground" data-testid={`text-unit-total-${line.id}`}>
                            {line.orderedQty.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {isReadOnly ? (
                              <span className="font-mono" data-testid={`text-received-qty-${line.id}`}>
                                {receivedQty.toFixed(2)}
                              </span>
                            ) : isSaved && !isEditing ? (
                              <button
                                onClick={() => handleToggleEdit(line.id)}
                                className="font-mono text-primary hover:underline"
                                data-testid={`link-edit-qty-${line.id}`}
                              >
                                {receivedQty.toFixed(2)}
                              </button>
                            ) : (
                              <Input
                                ref={(el) => inputRefs.current[line.id] = el}
                                type="number"
                                step="0.01"
                                value={receivedQty}
                                onChange={(e) => handleReceivedQuantityChange(line.id, parseFloat(e.target.value) || 0)}
                                onKeyDown={(e) => handleKeyDown(e, line.id, filteredLines)}
                                className="w-24 text-right font-mono"
                                data-testid={`input-received-qty-${line.id}`}
                              />
                            )}
                          </TableCell>
                          <TableCell>{formatUnitName(line.unitName)}</TableCell>
                          <TableCell className="text-right font-mono">${line.pricePerUnit.toFixed(4)}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${lineTotal.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {!isReadOnly && (
                              <Button
                                size="sm"
                                onClick={() => handleSaveLine(line.id)}
                                disabled={isSaved || saveLineMutation.isPending}
                                variant={isSaved ? "outline" : "default"}
                                data-testid={`button-save-line-${line.id}`}
                              >
                                {isSaved ? "Saved" : "Save"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end mt-6 gap-2">
              {isReadOnly ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/orders")}
                    data-testid="button-back-to-receiving-footer"
                  >
                    Back to Orders
                  </Button>
                  <Button
                    onClick={() => reopenReceiptMutation.mutate(draftReceiptId!)}
                    disabled={!draftReceiptId || reopenReceiptMutation.isPending}
                    data-testid="button-reopen-receipt"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {reopenReceiptMutation.isPending ? "Reopening..." : "Reopen Receipt"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/orders")}
                    data-testid="button-cancel-receiving"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCompleteReceiving}
                    disabled={completeReceivingMutation.isPending || !draftReceiptId || !allLinesSaved}
                    data-testid="button-complete-receiving"
                  >
                    <PackageCheck className="h-4 w-4 mr-2" />
                    {completeReceivingMutation.isPending ? "Receiving..." : "Complete Receiving"}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && handleCloseItemEdit()}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-item">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              Update pricing and details for this item. Changes will apply system-wide.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="item-name">Name *</Label>
              <Input
                id="item-name"
                value={itemEditForm.name}
                onChange={(e) => setItemEditForm({ ...itemEditForm, name: e.target.value })}
                data-testid="input-item-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={itemEditForm.categoryId || "none"}
                onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value === "none" ? "" : value })}
              >
                <SelectTrigger id="item-category" data-testid="select-item-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-price">Price Per Unit *</Label>
                <Input
                  id="item-price"
                  type="number"
                  step="0.01"
                  value={itemEditForm.pricePerUnit}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, pricePerUnit: e.target.value })}
                  data-testid="input-item-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-case-size">Case Size *</Label>
                <Input
                  id="item-case-size"
                  type="number"
                  step="0.01"
                  value={itemEditForm.caseSize}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, caseSize: e.target.value })}
                  data-testid="input-item-case-size"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-par-level">Par Level</Label>
                <Input
                  id="item-par-level"
                  type="number"
                  step="0.01"
                  value={itemEditForm.parLevel}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, parLevel: e.target.value })}
                  data-testid="input-item-par-level"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-reorder-level">Reorder Level</Label>
                <Input
                  id="item-reorder-level"
                  type="number"
                  step="0.01"
                  value={itemEditForm.reorderLevel}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, reorderLevel: e.target.value })}
                  data-testid="input-item-reorder-level"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseItemEdit}
              data-testid="button-cancel-item"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveItem}
              disabled={updateItemMutation.isPending}
              data-testid="button-save-item"
            >
              {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
