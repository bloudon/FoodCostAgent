import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Search, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PurchaseOrderDisplay = {
  id: string;
  storeId: string;
  vendorId: string;
  vendorName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
  lineCount: number;
  totalAmount: number;
};

type Vendor = {
  id: string;
  name: string;
  accountNumber: string | null;
};

type Store = {
  id: string;
  name: string;
};

const statusColors: Record<string, string> = {
  "pending": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "ordered": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "received": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function Orders() {
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrderDisplay[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores/accessible"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/purchase-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Success",
        description: "Purchase order deleted successfully",
      });
      setOrderToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete purchase order",
        variant: "destructive",
      });
    },
  });

  const filteredOrders = purchaseOrders?.filter((order) => {
    const matchesSearch = order.vendorName?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase());
    const matchesVendor = selectedVendor === "all" || order.vendorId === selectedVendor;
    const matchesStatus = selectedStatus === "all" || order.status === selectedStatus;
    const matchesStore = selectedStore === "all" || order.storeId === selectedStore;
    return matchesSearch && matchesVendor && matchesStatus && matchesStore;
  }) || [];

  // Get store name by ID
  const getStoreName = (storeId: string) => {
    return stores?.find(s => s.id === storeId)?.name || "Unknown";
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-orders-title">Orders</h1>
            <p className="text-muted-foreground mt-1">
              Create, manage, and receive purchase orders from vendors
            </p>
          </div>
          <Button asChild data-testid="button-create-order">
            <Link href="/purchase-orders/new">
              <Plus className="h-4 w-4 mr-2" />
              New Order
            </Link>
          </Button>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-orders"
            />
          </div>
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-[200px]" data-testid="select-store-filter">
              <SelectValue placeholder="Filter by store" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores?.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedVendor} onValueChange={setSelectedVendor}>
            <SelectTrigger className="w-[200px]" data-testid="select-vendor-filter">
              <SelectValue placeholder="Filter by vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors?.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="received">Received</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading orders...</div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No orders found</h3>
            <p className="text-muted-foreground text-sm">
              {search || selectedVendor !== "all" || selectedStatus !== "all" || selectedStore !== "all"
                ? "Try adjusting your filters"
                : "Create your first purchase order to get started"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">PO Number</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => {
                  const createdDate = new Date(order.createdAt);
                  const expectedDate = order.expectedDate ? new Date(order.expectedDate) : null;

                  return (
                    <TableRow 
                      key={order.id} 
                      data-testid={`row-order-${order.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => {
                        // Pending → PO detail (editable), Ordered → receiving, Received → PO detail (read-only)
                        const targetUrl = order.status === "ordered"
                          ? `/receiving/${order.id}`
                          : `/purchase-orders/${order.id}`;
                        setLocation(targetUrl);
                      }}
                    >
                      <TableCell className="font-mono text-sm">
                        #{order.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{getStoreName(order.storeId)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{order.vendorName}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {createdDate.toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {expectedDate ? expectedDate.toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {order.lineCount}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ${order.totalAmount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="secondary"
                          className={statusColors[order.status] || ""}
                          data-testid={`badge-status-${order.id}`}
                        >
                          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {order.status === "pending" ? (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              data-testid={`button-edit-order-${order.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(`/purchase-orders/${order.id}`);
                              }}
                            >
                              Edit Order
                            </Button>
                          ) : order.status === "ordered" ? (
                            <Button 
                              variant="default" 
                              size="sm"
                              data-testid={`button-receive-order-${order.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(`/receiving/${order.id}`);
                              }}
                            >
                              Receive
                            </Button>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              data-testid={`button-view-order-${order.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(`/purchase-orders/${order.id}`);
                              }}
                            >
                              View Details
                            </Button>
                          )}
                          {order.status !== "received" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOrderToDelete(order.id);
                              }}
                              data-testid={`button-delete-order-${order.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this purchase order? This action cannot be undone and will also delete all associated order lines.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => orderToDelete && deleteMutation.mutate(orderToDelete)}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover-elevate"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
