import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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
import { SortableTableHead, useTableSort, sortData } from "@/components/sortable-table-head";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateString } from "@/lib/utils";
import { useStoreContext } from "@/hooks/use-store-context";

type PurchaseOrderDisplay = {
  id: string;
  vendorId: string;
  vendorName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
  lineCount: number;
  totalAmount: number;
  receivedAmount: number;
};

type Vendor = {
  id: string;
  name: string;
};

type ImportedInvoiceSummary = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  vendorId: string | null;
  vendorName: string;
  storeId: string;
  lineCount: number;
  totalAmount: number;
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
  const { selectedStoreId } = useStoreContext();

  const { data: purchaseOrders, isLoading: isLoadingOrders } = useQuery<PurchaseOrderDisplay[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: importedInvoices, isLoading: isLoadingImported } = useQuery<ImportedInvoiceSummary[]>({
    queryKey: ["/api/imported-invoices"],
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

  const filteredImportedInvoices = importedInvoices?.filter((inv) => {
    const matchesSearch = inv.vendorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.id?.toLowerCase().includes(searchQuery.toLowerCase());
    const selectedVendorName = vendors?.find((vendor) => vendor.id === selectedVendor)?.name.toLowerCase();
    const matchesVendor = selectedVendor === "all"
      || inv.vendorId === selectedVendor
      || (!inv.vendorId && !!selectedVendorName && inv.vendorName.toLowerCase() === selectedVendorName);
    const matchesStore = !selectedStoreId || inv.storeId === selectedStoreId;
    // Historical status only shows when 'all' or a custom historical status is selected
    const matchesStatus = selectedStatus === "all" || selectedStatus === "historical";
    return matchesSearch && matchesVendor && matchesStore && matchesStatus;
  }) || [];

  const { sortField, sortDirection, handleSort } = useTableSort("createdAt", "desc");

  const sortedOrders = useMemo(() =>
    sortData(filteredOrders, sortField, sortDirection, (order, field) => {
      switch (field) {
        case "vendor": return order.vendorName;
        case "createdAt": return order.createdAt;
        case "expectedDate": return order.expectedDate ?? "";
        case "lineCount": return order.lineCount;
        case "totalAmount": return order.totalAmount;
        case "status": return order.status;
        default: return null;
      }
    }),
    [filteredOrders, sortField, sortDirection]
  );

  // Separate pending/ordered from received
  const pendingOrders = sortedOrders.filter(o => o.status === "pending" || o.status === "ordered");
  const receivedOrders = sortedOrders.filter(o => o.status === "received");

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-background border-b px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-receiving-title">
              Receiving
            </h1>
            <p className="text-muted-foreground mt-2">
              Receive live purchase orders and review read-only imported invoice history
            </p>
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500" />
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
              <SelectItem value="historical">Historical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoadingOrders || isLoadingImported ? (
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
                  <Table wrapperClassName="rounded-md border max-h-[400px]">
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>PO #</TableHead>
                          <SortableTableHead field="vendor" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Vendor</SortableTableHead>
                          <SortableTableHead field="createdAt" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Ordered</SortableTableHead>
                          <SortableTableHead field="expectedDate" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Expected</SortableTableHead>
                          <SortableTableHead field="lineCount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right">Items</SortableTableHead>
                          <SortableTableHead field="totalAmount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right">Amount</SortableTableHead>
                          <SortableTableHead field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Status</SortableTableHead>
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
                              {formatDateString(order.expectedDate)}
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
                </CardContent>
              </Card>
            )}

            {/* Received Orders */}
            {receivedOrders.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4">Received Orders</h2>
                  <Table wrapperClassName="rounded-md border max-h-[400px]">
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>PO #</TableHead>
                          <SortableTableHead field="vendor" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Vendor</SortableTableHead>
                          <SortableTableHead field="createdAt" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Ordered</SortableTableHead>
                          <SortableTableHead field="expectedDate" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Expected</SortableTableHead>
                          <SortableTableHead field="lineCount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right">Items</SortableTableHead>
                          <SortableTableHead field="totalAmount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right">Amount</SortableTableHead>
                          <SortableTableHead field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>Status</SortableTableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receivedOrders.map((order) => (
                          <TableRow key={order.id} data-testid={`row-received-order-${order.id}`}>
                            <TableCell className="font-mono">{order.id.slice(0, 8)}</TableCell>
                            <TableCell className="font-medium">{order.vendorName}</TableCell>
                            <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                            <TableCell>
                              {formatDateString(order.expectedDate)}
                            </TableCell>
                            <TableCell className="text-right">{order.lineCount}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${order.receivedAmount.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[order.status]}>
                                {order.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                size="sm" 
                                variant="outline"
                                asChild
                                data-testid={`button-view-receipt-${order.id}`}
                              >
                                <Link href={`/receiving/${order.id}`}>
                                  View
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                </CardContent>
              </Card>
            )}

            {/* Historical Imported Invoices */}
            {filteredImportedInvoices.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      Historical Imported Invoices
                      <Badge variant="secondary" className="bg-slate-500/10 text-slate-700 dark:bg-slate-500/10 dark:text-slate-400 font-normal">
                        Read-only
                      </Badge>
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      These are approved invoice records imported historically and do not prove stock was physically received in this system.
                    </p>
                  </div>
                  <Table wrapperClassName="rounded-md border max-h-[400px]">
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredImportedInvoices.map((inv) => (
                        <TableRow key={inv.id} data-testid={`row-historical-invoice-${inv.id}`}>
                          <TableCell className="font-mono">{inv.invoiceNumber || inv.id.slice(0, 8)}</TableCell>
                          <TableCell className="font-medium">{inv.vendorName}</TableCell>
                          <TableCell>{inv.invoiceDate ? formatDateString(inv.invoiceDate) : "—"}</TableCell>
                          <TableCell className="text-right">{inv.lineCount}</TableCell>
                          <TableCell className="text-right font-mono">
                            ${inv.totalAmount.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-400">
                              Historical
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                              data-testid={`button-view-historical-invoice-${inv.id}`}
                            >
                              <Link href={`/imported-invoices/${inv.id}?from=receiving`}>
                                View details
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Empty State */}
            {pendingOrders.length === 0 && receivedOrders.length === 0 && filteredImportedInvoices.length === 0 && (
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
