import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItem, CompanyStore, TransferOrder, TransferOrderLine } from "@shared/schema";

export default function TransferOrderDetail() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  
  const isNewOrder = id === "new";

  // Fetch stores
  const { data: stores } = useQuery<CompanyStore[]>({
    queryKey: ["/api/stores/accessible"],
  });

  // Fetch inventory items
  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
  });

  // Fetch existing transfer order if editing
  const { data: transferOrder } = useQuery<TransferOrder>({
    queryKey: ["/api/transfer-orders", id],
    enabled: !isNewOrder,
  });

  // Fetch transfer order lines if editing
  const { data: lines } = useQuery<TransferOrderLine[]>({
    queryKey: [`/api/transfer-order-lines?transferOrderId=${id}`],
    enabled: !isNewOrder,
  });

  // Load existing data
  useEffect(() => {
    if (transferOrder) {
      setFromStoreId(transferOrder.fromStoreId);
      setToStoreId(transferOrder.toStoreId);
      const date = transferOrder.expectedDate ? new Date(transferOrder.expectedDate) : null;
      setExpectedDate(date ? date.toISOString().split("T")[0] : "");
      setNotes(transferOrder.notes || "");
    }
  }, [transferOrder]);

  useEffect(() => {
    if (lines && lines.length > 0) {
      const newQuantities: Record<string, number> = {};
      lines.forEach(line => {
        if (line.inventoryItemId) {
          newQuantities[line.inventoryItemId] = line.requestedQty;
        }
      });
      setQuantities(newQuantities);
    }
  }, [lines]);

  // Mutations
  const createOrderMutation = useMutation({
    mutationFn: async (data: { fromStoreId: string; toStoreId: string; expectedDate?: string; notes?: string; companyId: string }) => {
      const response = await apiRequest("POST", "/api/transfer-orders", data);
      return await response.json();
    },
    onSuccess: (newOrder: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      if (newOrder?.id) {
        navigate(`/transfer-orders/${newOrder.id}`);
        toast({ title: "Transfer order created" });
      } else {
        toast({ title: "Transfer order created", description: "Redirecting to list" });
        navigate("/transfer-orders");
      }
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: async (data: { notes?: string; expectedDate?: string }) => {
      return await apiRequest("PATCH", `/api/transfer-orders/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      toast({ title: "Transfer order updated" });
    },
  });

  const saveLineMutation = useMutation({
    mutationFn: async (data: { transferOrderId: string; inventoryItemId: string; requestedQty: number; unitId: string }) => {
      return await apiRequest("POST", "/api/transfer-order-lines", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/transfer-order-lines?transferOrderId=${id}`] });
    },
  });

  const executeTransferMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/transfer-orders/${id}/execute`, {
        method: "POST",
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details ? error.details.join(", ") : error.error || "Failed to execute transfer");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({ title: "Transfer executed", description: "Items have been shipped from source store" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to execute transfer", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const receiveTransferMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/transfer-orders/${id}/receive`, {
        method: "POST",
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details ? error.details.join(", ") : error.error || "Failed to receive transfer");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({ title: "Transfer completed", description: "Items have been received at destination store" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to receive transfer", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleCreateOrder = async () => {
    if (!fromStoreId || !toStoreId) {
      toast({ title: "Please select both stores", variant: "destructive" });
      return;
    }
    
    if (fromStoreId === toStoreId) {
      toast({ title: "Source and destination stores must be different", variant: "destructive" });
      return;
    }

    // Get companyId from first store (all accessible stores belong to same company)
    const companyId = stores?.[0]?.companyId;
    if (!companyId) {
      toast({ title: "Unable to determine company", variant: "destructive" });
      return;
    }

    createOrderMutation.mutate({
      fromStoreId,
      toStoreId,
      companyId,
      expectedDate: expectedDate || undefined,
      notes: notes || undefined,
    });
  };

  const handleUpdateOrder = async () => {
    updateOrderMutation.mutate({
      notes: notes || undefined,
      expectedDate: expectedDate || undefined,
    });
  };

  const handleQuantityChange = (itemId: string, qty: number) => {
    setQuantities(prev => ({ ...prev, [itemId]: qty }));
    
    // Auto-save line if order exists
    if (!isNewOrder && qty > 0) {
      const item = inventoryItems?.find(i => i.id === itemId);
      if (item) {
        saveLineMutation.mutate({
          transferOrderId: id!,
          inventoryItemId: itemId,
          requestedQty: qty,
          unitId: item.unitId,
        });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentId: string, items: any[]) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentIndex = items.findIndex(item => item.id === currentId);
      if (currentIndex < items.length - 1) {
        const nextId = items[currentIndex + 1].id;
        inputRefs.current[nextId]?.focus();
      }
    }
  };

  const handleExecuteTransfer = async () => {
    const hasItems = Object.values(quantities).some(qty => qty > 0);
    if (!hasItems) {
      toast({ title: "Please add at least one item", variant: "destructive" });
      return;
    }
    
    executeTransferMutation.mutate();
  };

  const handleReceiveTransfer = async () => {
    receiveTransferMutation.mutate();
  };

  // Filter items by source store
  const displayItems = inventoryItems || [];

  const totalValue = displayItems.reduce((sum, item) => {
    const qty = quantities[item.id] || 0;
    return sum + (qty * (item.pricePerUnit || 0));
  }, 0);

  const canEdit = !transferOrder || transferOrder.status === "pending";
  const canExecute = !isNewOrder && transferOrder?.status === "pending";
  const canReceive = !isNewOrder && transferOrder?.status === "in_transit";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/transfer-orders")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              {isNewOrder ? "New Transfer Order" : `Transfer Order ${id}`}
            </h1>
            {transferOrder && (
              <Badge variant={transferOrder.status === "completed" ? "default" : "secondary"} data-testid={`badge-status-${transferOrder.status}`}>
                {transferOrder.status}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && !isNewOrder && (
            <Button
              onClick={handleUpdateOrder}
              disabled={updateOrderMutation.isPending}
              data-testid="button-save"
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          )}
          {canExecute && (
            <Button
              onClick={handleExecuteTransfer}
              disabled={executeTransferMutation.isPending}
              variant="default"
              data-testid="button-execute"
            >
              <Package className="h-4 w-4 mr-2" />
              Execute Transfer
            </Button>
          )}
          {canReceive && (
            <Button
              onClick={handleReceiveTransfer}
              disabled={receiveTransferMutation.isPending}
              variant="default"
              data-testid="button-receive"
            >
              <Package className="h-4 w-4 mr-2" />
              Receive Transfer
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from-store">From Store</Label>
              <Select
                value={fromStoreId}
                onValueChange={setFromStoreId}
                disabled={!isNewOrder}
              >
                <SelectTrigger id="from-store" data-testid="select-from-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.map(store => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-store">To Store</Label>
              <Select
                value={toStoreId}
                onValueChange={setToStoreId}
                disabled={!isNewOrder}
              >
                <SelectTrigger id="to-store" data-testid="select-to-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.map(store => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expected-date">Expected Date</Label>
              <Input
                id="expected-date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                disabled={!canEdit}
                data-testid="input-expected-date"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
              placeholder="Optional notes"
              data-testid="input-notes"
            />
          </div>

          {isNewOrder && (
            <Button
              onClick={handleCreateOrder}
              disabled={createOrderMutation.isPending}
              data-testid="button-create-order"
            >
              Create Transfer Order
            </Button>
          )}
        </CardContent>
      </Card>

      {!isNewOrder && (
        <Card>
          <CardHeader>
            <CardTitle>Items to Transfer</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Price/Unit</TableHead>
                  <TableHead className="w-[150px]">Quantity</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map(item => {
                  const qty = quantities[item.id] || 0;
                  const lineTotal = qty * (item.pricePerUnit || 0);
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(item as any).unitName || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${(item.pricePerUnit || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Input
                          ref={el => inputRefs.current[item.id] = el}
                          type="number"
                          step="0.01"
                          min="0"
                          value={qty || ""}
                          onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                          onKeyDown={(e) => handleKeyDown(e, item.id, displayItems)}
                          className="text-center"
                          placeholder="0"
                          disabled={!canEdit}
                          data-testid={`input-qty-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${lineTotal.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            
            <div className="mt-4 flex justify-end">
              <div className="text-lg font-semibold" data-testid="text-total-value">
                Total Value: ${totalValue.toFixed(2)}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
