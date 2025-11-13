import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeftRight, Search, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
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
import { formatDateString } from "@/lib/utils";

type TransferOrderDisplay = {
  id: string;
  fromStoreId: string;
  toStoreId: string;
  fromStoreName: string;
  toStoreName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
};

type Store = {
  id: string;
  name: string;
};

const statusColors: Record<string, string> = {
  "pending": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "in_transit": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "completed": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function TransferOrders() {
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: transferOrders, isLoading } = useQuery<TransferOrderDisplay[]>({
    queryKey: ["/api/transfer-orders"],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores/accessible"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/transfer-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      toast({
        title: "Success",
        description: "Transfer order deleted successfully",
      });
      setOrderToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete transfer order",
        variant: "destructive",
      });
    },
  });

  const filteredOrders = transferOrders?.filter((order) => {
    const matchesSearch = order.fromStoreName?.toLowerCase().includes(search.toLowerCase()) ||
      order.toStoreName?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase());
    const matchesStore = selectedStore === "all" || 
      order.fromStoreId === selectedStore || 
      order.toStoreId === selectedStore;
    const matchesStatus = selectedStatus === "all" || order.status === selectedStatus;
    return matchesSearch && matchesStore && matchesStatus;
  }) || [];

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Transfer Orders</h1>
            <p className="text-muted-foreground mt-1">
              Move inventory between stores
            </p>
          </div>
          <Button asChild data-testid="button-create-transfer">
            <Link href="/transfer-orders/new">
              <Plus className="h-4 w-4 mr-2" />
              New Transfer
            </Link>
          </Button>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search transfers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-transfer"
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
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_transit">In Transit</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading transfer orders...</div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ArrowLeftRight className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No transfer orders found</h3>
            <p className="text-muted-foreground text-sm">
              {search || selectedStore !== "all" || selectedStatus !== "all"
                ? "Try adjusting your filters"
                : "Create your first transfer order to get started"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer ID</TableHead>
                  <TableHead>From Store</TableHead>
                  <TableHead>To Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expected Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id} data-testid={`row-transfer-${order.id}`}>
                    <TableCell>
                      <Link href={`/transfer-orders/${order.id}`}>
                        <Button variant="ghost" className="p-0 h-auto font-normal hover:underline" data-testid={`link-transfer-${order.id}`}>
                          #{order.id.slice(0, 8)}
                        </Button>
                      </Link>
                    </TableCell>
                    <TableCell>{order.fromStoreName}</TableCell>
                    <TableCell>{order.toStoreName}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[order.status]} data-testid={`badge-status-${order.id}`}>
                        {order.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {formatDateString(order.expectedDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setOrderToDelete(order.id)}
                        disabled={order.status === "completed"}
                        data-testid={`button-delete-${order.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={!!orderToDelete} onOpenChange={() => setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transfer Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the transfer order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => orderToDelete && deleteMutation.mutate(orderToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
