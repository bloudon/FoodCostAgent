import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Box, CircleDollarSign, Search } from "lucide-react";
import { SetupProgressBanner } from "@/components/setup-progress-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Vendor } from "@shared/schema";
import { formatUnitName } from "@/lib/utils";
import { SortableTableHead, sortData, useTableSort } from "@/components/sortable-table-head";

interface VendorDepositLedger {
  vendorId: string;
  balance: number;
  outstandingKegs: number;
  events: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    ratePerKeg: number;
    signedAmount: number;
    signedKegCount: number;
  }>;
}

interface VendorItemWithDetails {
  id: string;
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  purchaseUnitId: string;
  caseSize: number | null;
  innerPackSize: number | null;
  lastPrice: number;
  lastCasePrice: number | null;
  displayCasePrice: number;
  inventoryUnitName: string | null;
  active: number;
  inventoryItem?: {
    id: string;
    name: string;
    categoryId: string | null;
    storageLocationId: string;
    pricePerUnit: number;
    caseSize: number | null;
    innerPackSize: number | null;
  };
  unit?: {
    id: string;
    name: string;
  };
}

type VendorItemSortField =
  | "name"
  | "sku"
  | "price"
  | "packSize"
  | "status"
  | "unit"
  | "casePrice";

export default function VendorDetail() {
  const [, params] = useRoute("/vendors/:id");
  const [, navigate] = useLocation();
  const vendorId = params?.id;
  const [searchQuery, setSearchQuery] = useState("");
  const { sortField, sortDirection, handleSort } = useTableSort<VendorItemSortField>("name");

  const { data: vendor, isLoading: vendorLoading } = useQuery<Vendor>({
    queryKey: [`/api/vendors/${vendorId}`],
    enabled: !!vendorId,
  });

  const { data: vendorItems, isLoading: itemsLoading } = useQuery<VendorItemWithDetails[]>({
    queryKey: [`/api/vendor-items?vendor_id=${vendorId}`],
    enabled: !!vendorId,
  });

  // Keg-deposit ledger: derived from immutable import-reconciliation events.
  // Vendors without deposit activity return an empty ledger — card is hidden.
  const { data: depositLedger } = useQuery<VendorDepositLedger>({
    queryKey: [`/api/vendor-invoice-import/deposit-ledger/${vendorId}`],
    enabled: !!vendorId,
  });
  const [showDepositHistory, setShowDepositHistory] = useState(false);

  const isLoading = vendorLoading || itemsLoading;

  const filteredItems = useMemo(() => {
    if (!vendorItems) return [];
    if (!searchQuery.trim()) return vendorItems;
    
    const query = searchQuery.toLowerCase().trim();
    return vendorItems.filter(item => {
      const itemName = item.inventoryItem?.name?.toLowerCase() || "";
      const sku = item.vendorSku?.toLowerCase() || "";
      return itemName.includes(query) || sku.includes(query);
    });
  }, [vendorItems, searchQuery]);

  // Sorting composes on top of the search result, so the visible rows are
  // always "filtered, then ordered". Numeric fields return numbers so the
  // shared comparator sorts them numerically rather than lexically.
  const sortedItems = useMemo(
    () =>
      sortData(filteredItems, sortField, sortDirection, (item, field) => {
        switch (field as VendorItemSortField) {
          case "name":
            return item.inventoryItem?.name || "Unknown Item";
          case "sku":
            return item.vendorSku || "";
          case "price":
            return item.inventoryItem?.pricePerUnit ?? item.lastPrice ?? 0;
          case "packSize": {
            // Rows render as "outer × inner"; order by the total units the
            // pack contains so 2 × 12 sorts above 1 × 6.
            const outer = item.caseSize ?? item.inventoryItem?.caseSize;
            const inner = item.innerPackSize ?? item.inventoryItem?.innerPackSize;
            if (outer == null) return null;
            return inner != null ? outer * inner : outer;
          }
          case "status":
            return item.active ? "Active" : "Inactive";
          case "unit":
            return item.unit ? formatUnitName(item.unit.name) : "";
          case "casePrice":
            return item.displayCasePrice;
          default:
            return "";
        }
      }),
    [filteredItems, sortField, sortDirection],
  );

  if (!vendorId) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Vendor not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 pb-16">
      <div className="mb-6">
        <Link href="/vendors">
          <Button variant="ghost" size="sm" data-testid="button-back-to-vendors">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Vendors
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Item Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Pack Size</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Case Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : vendor ? (
        <>
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight mb-2" data-testid="text-vendor-name">
              {vendor.name}
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {vendor.accountNumber && (
                <span data-testid="text-vendor-account">
                  Account: <span className="font-mono">{vendor.accountNumber}</span>
                </span>
              )}
            </div>
          </div>

          {depositLedger && depositLedger.events.length > 0 && (
            <Card className="mb-8" data-testid="card-keg-deposit-balance">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <CircleDollarSign className="h-8 w-8 text-orange-500" />
                    <div>
                      <p className="text-sm text-muted-foreground">Keg deposit balance</p>
                      <p className="text-2xl font-semibold" data-testid="text-deposit-balance">
                        ${depositLedger.balance.toFixed(2)}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid="text-deposit-kegs">
                        ~{depositLedger.outstandingKegs} outstanding {Math.abs(depositLedger.outstandingKegs) === 1 ? "keg" : "kegs"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDepositHistory((v) => !v)}
                    data-testid="button-toggle-deposit-history"
                  >
                    {showDepositHistory ? "Hide history" : `History (${depositLedger.events.length})`}
                  </Button>
                </div>
                {showDepositHistory && (
                  <div className="rounded-md border mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead className="text-right">Kegs</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {depositLedger.events.map((e) => (
                          <TableRow key={e.id} data-testid={`row-deposit-event-${e.invoiceNumber}`}>
                            <TableCell>{e.invoiceDate}</TableCell>
                            <TableCell className="font-mono">{e.invoiceNumber}</TableCell>
                            <TableCell className="text-right">
                              {e.signedKegCount > 0 ? `+${e.signedKegCount}` : e.signedKegCount}
                            </TableCell>
                            <TableCell className="text-right">${e.ratePerKeg.toFixed(2)}</TableCell>
                            <TableCell className={`text-right ${e.signedAmount < 0 ? "text-green-600" : ""}`}>
                              {e.signedAmount < 0 ? `−$${Math.abs(e.signedAmount).toFixed(2)}` : `$${e.signedAmount.toFixed(2)}`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div>
            <h2 className="text-xl font-semibold mb-4" data-testid="text-inventory-items-title">
              Inventory Items ({vendorItems?.length || 0})
            </h2>
            {vendorItems && vendorItems.length > 0 && (
              <div className="mb-6">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500" />
                  <Input
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 border-orange-500/40 focus-visible:ring-orange-500/50"
                    data-testid="input-search-items"
                  />
                </div>
              </div>
            )}
            {vendorItems && vendorItems.length > 0 ? (
              <>
                {searchQuery && (
                  <p className="text-sm text-muted-foreground mb-2">
                    Showing {filteredItems.length} of {vendorItems.length} items
                  </p>
                )}
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead field="name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="w-[30%]">Item Name</SortableTableHead>
                        <SortableTableHead field="sku" sortField={sortField} sortDirection={sortDirection} onSort={handleSort}>SKU</SortableTableHead>
                        <SortableTableHead field="price" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right [&>div]:justify-end">Price</SortableTableHead>
                        <SortableTableHead field="packSize" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right [&>div]:justify-end">Pack Size</SortableTableHead>
                        <SortableTableHead field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-center [&>div]:justify-center">Status</SortableTableHead>
                        <SortableTableHead field="unit" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right [&>div]:justify-end">Unit</SortableTableHead>
                        <SortableTableHead field="casePrice" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right [&>div]:justify-end">Case Price</SortableTableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedItems.length > 0 ? (
                        sortedItems.map((item) => (
                          <TableRow 
                            key={item.id} 
                            className="hover-elevate cursor-pointer"
                            data-testid={`row-item-${item.id}`}
                            onClick={() => navigate(`/inventory-items/${item.inventoryItemId}`)}
                          >
                            <TableCell className="font-medium" data-testid={`text-item-name-${item.id}`}>
                              {item.inventoryItem?.name || "Unknown Item"}
                            </TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground" data-testid={`text-item-sku-${item.id}`}>
                              {item.vendorSku || "-"}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-item-price-${item.id}`}>
                              <span className="font-medium">
                                ${(item.inventoryItem?.pricePerUnit ?? item.lastPrice ?? 0).toFixed(4)}
                              </span>
                              {item.inventoryUnitName && (
                                <span className="text-muted-foreground text-sm ml-1">
                                  / {formatUnitName(item.inventoryUnitName)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-item-pack-${item.id}`}>
                              {(() => {
                                const outerCount = item.caseSize ?? item.inventoryItem?.caseSize;
                                const innerCount = item.innerPackSize ?? item.inventoryItem?.innerPackSize;
                                const unitLabel = item.unit ? formatUnitName(item.unit.name) : null;
                                if (outerCount != null && innerCount != null) {
                                  return (
                                    <>
                                      <span className="font-medium">{outerCount} × {innerCount}</span>
                                      {unitLabel && (
                                        <span className="text-muted-foreground text-sm ml-1">{unitLabel}</span>
                                      )}
                                    </>
                                  );
                                } else if (outerCount != null) {
                                  return (
                                    <>
                                      <span>{outerCount}</span>
                                      {unitLabel && (
                                        <span className="text-muted-foreground text-sm ml-1">{unitLabel}</span>
                                      )}
                                    </>
                                  );
                                }
                                return <span className="text-muted-foreground">-</span>;
                              })()}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={item.active ? "outline" : "secondary"} className="text-xs">
                                {item.active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-item-unit-${item.id}`}>
                              {item.unit ? formatUnitName(item.unit.name) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium" data-testid={`text-item-case-price-${item.id}`}>
                              {`$${item.displayCasePrice.toFixed(2)}`}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            No items match "{searchQuery}"
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Box className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No inventory items found for this vendor.</p>
                  <p className="text-sm mt-2">Add items to this vendor from the inventory items page.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <div className="text-center text-muted-foreground">
          <p>Vendor not found</p>
        </div>
      )}
      <SetupProgressBanner currentMilestoneId="vendors" hasEntries={true} />
    </div>
  );
}
