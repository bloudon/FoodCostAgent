import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Box, Search } from "lucide-react";
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

interface VendorItemWithDetails {
  id: string;
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  purchaseUnitId: string;
  caseSize: number | null;
  innerPackSize: number | null;
  lastPrice: number;
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

export default function VendorDetail() {
  const [, params] = useRoute("/vendors/:id");
  const [, navigate] = useLocation();
  const vendorId = params?.id;
  const [searchQuery, setSearchQuery] = useState("");

  const { data: vendor, isLoading: vendorLoading } = useQuery<Vendor>({
    queryKey: [`/api/vendors/${vendorId}`],
    enabled: !!vendorId,
  });

  const { data: vendorItems, isLoading: itemsLoading } = useQuery<VendorItemWithDetails[]>({
    queryKey: [`/api/vendor-items?vendor_id=${vendorId}`],
    enabled: !!vendorId,
  });

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

  if (!vendorId) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Vendor not found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
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
                  <TableHead className="text-right">Case Size</TableHead>
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
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
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
              <span data-testid="text-vendor-item-count">
                {vendorItems?.length || 0} {vendorItems?.length === 1 ? "item" : "items"}
              </span>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold">Inventory Items</h2>
              {vendorItems && vendorItems.length > 0 && (
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-items"
                  />
                </div>
              )}
            </div>
            {vendorItems && vendorItems.length > 0 ? (
              <>
                {searchQuery && (
                  <p className="text-sm text-muted-foreground mb-2">
                    Showing {filteredItems.length} of {vendorItems.length} items
                  </p>
                )}
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[30%]">Item Name</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Pack Size</TableHead>
                        <TableHead className="text-right">Case Size</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Case Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.length > 0 ? (
                        filteredItems.map((item) => (
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
                                ${(item.inventoryItem?.pricePerUnit ?? item.lastPrice ?? 0).toFixed(2)}
                              </span>
                              {item.unit && (
                                <span className="text-muted-foreground text-sm ml-1">
                                  / {formatUnitName(item.unit.name)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-item-pack-${item.id}`}>
                              {(item.innerPackSize ?? item.inventoryItem?.innerPackSize) != null ? (
                                <>
                                  {item.innerPackSize ?? item.inventoryItem?.innerPackSize}
                                  {item.unit && (
                                    <span className="text-muted-foreground text-sm ml-1">
                                      {formatUnitName(item.unit.name)}
                                    </span>
                                  )}
                                </>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-item-case-${item.id}`}>
                              {item.caseSize ?? item.inventoryItem?.caseSize ?? "-"}
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
                              {(() => {
                                const unitPrice = item.inventoryItem?.pricePerUnit ?? item.lastPrice ?? 0;
                                const caseSize = item.caseSize ?? item.inventoryItem?.caseSize ?? 1;
                                const innerPack = item.innerPackSize ?? item.inventoryItem?.innerPackSize ?? 1;
                                const casePrice = unitPrice * caseSize * innerPack;
                                return `$${casePrice.toFixed(2)}`;
                              })()}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
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
    </div>
  );
}
