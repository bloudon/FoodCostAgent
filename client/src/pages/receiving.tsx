import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackageCheck, Search } from "lucide-react";
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

type PurchaseOrderDisplay = {
  id: string;
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
};

const statusColors: Record<string, string> = {
  "pending": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "ordered": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "received": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function Receiving() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrderDisplay[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  // Filter to show pending/ordered and received orders
  const filteredOrders = purchaseOrders?.filter((order) => {
    const matchesSearch = order.vendorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVendor = selectedVendor === "all" || order.vendorId === selectedVendor;
    const matchesStatus = selectedStatus === "all" || order.status === selectedStatus;
    return matchesSearch && matchesVendor && matchesStatus;
  }) || [];

  // Separate pending/ordered from received
  const pendingOrders = filteredOrders.filter(o => o.status === "pending" || o.status === "ordered");
  const receivedOrders = filteredOrders.filter(o => o.status === "received");

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-receiving-title">
              Receiving
            </h1>
            <p className="text-muted-foreground mt-2">
              Receive purchase orders and update inventory levels
            </p>
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-pending-order"
            />
          </div>
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
        ) : (
          <div className="space-y-6">
            {/* Pending/Ordered Orders */}
            {pendingOrders.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4">Pending Orders</h2>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PO #</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Ordered</TableHead>
                          <TableHead>Expected</TableHead>
                          <TableHead className="text-right">Items</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingOrders.map((order) => (
                          <TableRow key={order.id} data-testid={`row-pending-order-${order.id}`}>
                            <TableCell className="font-mono">{order.id.slice(0, 8)}</TableCell>
                            <TableCell className="font-medium">{order.vendorName}</TableCell>
                            <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                            <TableCell>
                              {order.expectedDate 
                                ? new Date(order.expectedDate).toLocaleDateString()
                                : '-'
                              }
                            </TableCell>
                            <TableCell className="text-right">{order.lineCount}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${order.totalAmount.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[order.status]}>
                                {order.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                size="sm" 
                                asChild
                                data-testid={`button-receive-order-${order.id}`}
                              >
                                <Link href={`/receiving/${order.id}`}>
                                  <PackageCheck className="h-4 w-4 mr-2" />
                                  Receive
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Received Orders */}
            {receivedOrders.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4">Received Orders</h2>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PO #</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Ordered</TableHead>
                          <TableHead>Expected</TableHead>
                          <TableHead className="text-right">Items</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receivedOrders.map((order) => (
                          <TableRow key={order.id} data-testid={`row-received-order-${order.id}`}>
                            <TableCell className="font-mono">{order.id.slice(0, 8)}</TableCell>
                            <TableCell className="font-medium">{order.vendorName}</TableCell>
                            <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                            <TableCell>
                              {order.expectedDate 
                                ? new Date(order.expectedDate).toLocaleDateString()
                                : '-'
                              }
                            </TableCell>
                            <TableCell className="text-right">{order.lineCount}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${order.totalAmount.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[order.status]}>
                                {order.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Empty State */}
            {pendingOrders.length === 0 && receivedOrders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <PackageCheck className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No orders found</h3>
                <p className="text-muted-foreground text-sm">
                  {searchQuery || selectedVendor !== "all" || selectedStatus !== "all"
                    ? "Try adjusting your filters"
                    : "No purchase orders available for receiving"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
