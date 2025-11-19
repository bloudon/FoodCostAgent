import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Search, Plus, Trash2, Store } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { formatDateString } from "@/lib/utils";

type UnifiedOrder = {
  id: string;
  type: "purchase" | "transfer";
  status: string;
  createdAt: string;
  expectedDate: string | null;
  completedAt: string | null;
  vendorName: string;
  fromStore?: string;
  toStore?: string;
  storeId?: string; // For purchase orders
  fromStoreId?: string; // For transfer orders
  toStoreId?: string; // For transfer orders
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

const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", className: string }> = {
  "pending": { 
    variant: "secondary",
    className: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20"
  },
  "ordered": { 
    variant: "secondary",
    className: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20"
  },
  "in_transit": { 
    variant: "secondary",
    className: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20"
  },
  "received": { 
    variant: "secondary",
    className: "bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20"
  },
  "completed": { 
    variant: "secondary",
    className: "bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20"
  },
};

export default function Orders() {
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: orders, isLoading } = useQuery<UnifiedOrder[]>({
    queryKey: ["/api/orders/unified"],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: stores = [], isLoading: storesLoading } = useAccessibleStores();

  // Auto-select first active store when stores load
  useEffect(() => {
    if (stores && stores.length > 0 && !selectedStore) {
      const activeStores = stores.filter(s => s.status === 'active');
      if (activeStores.length > 0) {
        setSelectedStore(activeStores[0].id);
      }
    }
  }, [stores, selectedStore]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/purchase-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Success",
        description: "Order deleted successfully",
      });
      setOrderToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete order",
        variant: "destructive",
      });
    },
  });

  const filteredOrders = orders?.filter((order) => {
    const createdDate = new Date(order.createdAt).toLocaleDateString();
    const expectedDate = formatDateString(order.expectedDate);
    
    const matchesSearch = order.vendorName?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase()) ||
      createdDate.toLowerCase().includes(search.toLowerCase()) ||
      expectedDate.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === "all" || order.type === selectedType;
    
    // For vendor filter, use name-based matching since unified API returns vendorName (not vendorId)
    const matchesVendor = selectedVendor === "all" || 
      order.vendorName.trim().toLowerCase().includes(selectedVendor);
    
    const matchesStatus = selectedStatus === "all" || order.status === selectedStatus;
    
    // For store filter, compare by store ID
    const matchesStore = !selectedStore || 
      (order.type === "purchase" && order.storeId === selectedStore) ||
      (order.type === "transfer" && (order.fromStoreId === selectedStore || order.toStoreId === selectedStore));
      
    return matchesSearch && matchesType && matchesVendor && matchesStatus && matchesStore;
  }) || [];

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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <Store className="h-5 w-5 text-muted-foreground" />
              <Select value={selectedStore} onValueChange={setSelectedStore}>
                <SelectTrigger className="w-[200px]" data-testid="select-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.filter(s => s.status === 'active').map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button asChild data-testid="button-create-order">
              <Link href="/purchase-orders/new">
                <Plus className="h-4 w-4 mr-2" />
                New Order
              </Link>
            </Button>
          </div>
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
          <Select value={selectedVendor} onValueChange={setSelectedVendor}>
            <SelectTrigger className="w-[200px]" data-testid="select-vendor-filter">
              <SelectValue placeholder="Filter by vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors?.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.name.toLowerCase()}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="w-[200px]" data-testid="select-type-filter">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="purchase">Purchase Orders</SelectItem>
              <SelectItem value="transfer">Transfer Orders</SelectItem>
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
              <SelectItem value="in_transit">In Transit</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
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
              {search || selectedVendor !== "all" || selectedStatus !== "all"
                ? "Try adjusting your filters"
                : "Create your first purchase order to get started"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Number</TableHead>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead>Details</TableHead>
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

                  // Determine navigation URL based on order type and status
                  let targetUrl = '';
                  if (order.type === 'purchase') {
                    targetUrl = order.status === "pending"
                      ? `/purchase-orders/${order.id}`
                      : `/receiving/${order.id}`;
                  } else {
                    // Transfer orders
                    targetUrl = `/transfer-orders/${order.id}`;
                  }

                  return (
                    <TableRow 
                      key={order.id} 
                      data-testid={`row-order-${order.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setLocation(targetUrl)}
                    >
                      <TableCell className="font-mono text-sm">
                        #{order.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {order.type}
                        </Badge>
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
                        {(order.status === "completed" || order.status === "received") && order.completedAt ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help inline-block">
                                  <Badge 
                                    variant={statusConfig[order.status]?.variant || "secondary"}
                                    className={statusConfig[order.status]?.className || ""}
                                    data-testid={`badge-status-${order.id}`}
                                  >
                                    {order.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Completed at: {new Date(order.completedAt).toLocaleString()}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge 
                            variant={statusConfig[order.status]?.variant || "secondary"}
                            className={statusConfig[order.status]?.className || ""}
                            data-testid={`badge-status-${order.id}`}
                          >
                            {order.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {order.type === "purchase" ? (
                            <>
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
                                  Edit
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
                                  data-testid={`button-view-receipt-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocation(`/receiving/${order.id}`);
                                  }}
                                >
                                  View
                                </Button>
                              )}
                            </>
                          ) : (
                            <>
                              {order.status === "pending" ? (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  data-testid={`button-edit-transfer-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocation(`/transfer-orders/${order.id}`);
                                  }}
                                >
                                  Edit
                                </Button>
                              ) : (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  data-testid={`button-view-transfer-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocation(`/transfer-orders/${order.id}`);
                                  }}
                                >
                                  View
                                </Button>
                              )}
                            </>
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
