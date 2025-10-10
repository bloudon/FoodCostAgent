import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useState, useRef } from "react";
import { ArrowLeft, Save, PackageCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  caseQuantity: number | null;
  unitId: string;
  unitName: string;
  priceEach: number;
  lineTotal: number;
};

type Category = {
  id: string;
  name: string;
};

type StorageLocation = {
  id: string;
  name: string;
};

export default function ReceivingDetail() {
  const { poId } = useParams<{ poId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStorageLocation, setSelectedStorageLocation] = useState<string>("");
  
  // Track received quantities for each PO line (in units, not cases)
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [savedLines, setSavedLines] = useState<Set<string>>(new Set());
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const { data: purchaseOrder, isLoading: loadingOrder } = useQuery<PurchaseOrderDetail>({
    queryKey: [`/api/purchase-orders/${poId}`],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: storageLocations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const receiptMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/receipts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({
        title: "Success",
        description: "Items received successfully",
      });
      setLocation("/receiving");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to receive items",
        variant: "destructive",
      });
    },
  });

  // Initialize received quantities with expected unit counts (cases × case size)
  const initializeReceivedQuantities = (lines: POLineDisplay[]) => {
    const initialized: Record<string, number> = {};
    lines.forEach(line => {
      // For case-based orders, calculate expected units (caseQuantity × orderedQty/case)
      // For unit-based orders (Misc Grocery), use orderedQty directly
      if (line.caseQuantity !== null && line.caseQuantity > 0) {
        initialized[line.id] = line.orderedQty;
      } else {
        initialized[line.id] = line.orderedQty;
      }
    });
    setReceivedQuantities(initialized);
  };

  // Initialize on load
  if (purchaseOrder?.lines && Object.keys(receivedQuantities).length === 0) {
    initializeReceivedQuantities(purchaseOrder.lines);
  }

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
    setSavedLines(prev => new Set(prev).add(lineId));
    toast({
      description: "Quantity confirmed",
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

  const handleReceiveAll = () => {
    if (!selectedStorageLocation) {
      toast({
        title: "Error",
        description: "Please select a storage location",
        variant: "destructive",
      });
      return;
    }

    const lines = purchaseOrder?.lines
      .filter(line => (receivedQuantities[line.id] || 0) > 0)
      .map(line => ({
        vendorItemId: line.vendorItemId,
        receivedQty: receivedQuantities[line.id] || 0,
        unitId: line.unitId,
        priceEach: line.priceEach,
      })) || [];

    if (lines.length === 0) {
      toast({
        title: "Error",
        description: "No items to receive",
        variant: "destructive",
      });
      return;
    }

    receiptMutation.mutate({
      purchaseOrderId: poId,
      lines,
      storageLocationId: selectedStorageLocation,
    });
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
        <Link href="/receiving">
          <Button variant="ghost">Back to Receiving</Button>
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

  const totalExpected = filteredLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const totalItems = filteredLines.length;

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/receiving">
            <Button variant="ghost" data-testid="button-back-to-receiving">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Receiving
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
              <p className="text-sm text-muted-foreground mt-1">
                Expected: {new Date(purchaseOrder.expectedDate).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex gap-2">
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
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>Storage Location</CardTitle>
              <Select 
                value={selectedStorageLocation} 
                onValueChange={setSelectedStorageLocation}
              >
                <SelectTrigger className="w-[250px]" data-testid="select-storage-location">
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  {storageLocations?.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter actual units received (weights may vary)
                </p>
              </div>
              <div className="flex gap-2">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Total Items</div>
                  <div className="text-2xl font-bold">{totalItems}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Expected Value</div>
                  <div className="text-2xl font-bold">${totalExpected.toFixed(2)}</div>
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
                    <TableHead className="text-right">Expected</TableHead>
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
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No items found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLines.map((line) => {
                      const receivedQty = receivedQuantities[line.id] || 0;
                      const isSaved = savedLines.has(line.id);
                      const lineTotal = receivedQty * line.priceEach;
                      
                      return (
                        <TableRow key={line.id} data-testid={`row-receive-item-${line.id}`}>
                          <TableCell className="font-medium">{line.itemName}</TableCell>
                          <TableCell className="text-muted-foreground">{line.vendorSku || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {line.orderedQty.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
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
                          </TableCell>
                          <TableCell>{line.unitName}</TableCell>
                          <TableCell className="text-right font-mono">${line.priceEach.toFixed(4)}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${lineTotal.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => handleSaveLine(line.id)}
                              disabled={isSaved}
                              variant={isSaved ? "outline" : "default"}
                              data-testid={`button-save-line-${line.id}`}
                            >
                              {isSaved ? "Saved" : "Save"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end mt-6 gap-2">
              <Button
                variant="outline"
                onClick={() => setLocation("/receiving")}
                data-testid="button-cancel-receiving"
              >
                Cancel
              </Button>
              <Button
                onClick={handleReceiveAll}
                disabled={!selectedStorageLocation || receiptMutation.isPending}
                data-testid="button-receive-all"
              >
                <PackageCheck className="h-4 w-4 mr-2" />
                {receiptMutation.isPending ? "Receiving..." : "Complete Receiving"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
