import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Package, DollarSign, Clock, Box } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Vendor } from "@shared/schema";

interface VendorItemWithDetails {
  id: string;
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  purchaseUnitId: string;
  caseSize: number | null;
  innerPackSize: number | null;
  lastPrice: number;
  leadTimeDays: number | null;
  active: number;
  inventoryItem?: {
    id: string;
    name: string;
    categoryId: string | null;
    storageLocationId: string;
  };
  unit?: {
    id: string;
    name: string;
  };
}

export default function VendorDetail() {
  const [, params] = useRoute("/vendors/:id");
  const vendorId = params?.id;

  const { data: vendor, isLoading: vendorLoading } = useQuery<Vendor>({
    queryKey: [`/api/vendors/${vendorId}`],
    enabled: !!vendorId,
  });

  const { data: vendorItems, isLoading: itemsLoading } = useQuery<VendorItemWithDetails[]>({
    queryKey: [`/api/vendor-items?vendor_id=${vendorId}`],
    enabled: !!vendorId,
  });

  const isLoading = vendorLoading || itemsLoading;

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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
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
            <h2 className="text-xl font-semibold mb-4">Inventory Items</h2>
            {vendorItems && vendorItems.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {vendorItems.map((item) => (
                  <Link 
                    key={item.id} 
                    href={`/inventory-items/${item.inventoryItemId}`}
                    data-testid={`link-item-${item.id}`}
                  >
                    <Card className="hover-elevate transition-all h-full">
                      <CardHeader className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base line-clamp-2" data-testid={`text-item-name-${item.id}`}>
                            {item.inventoryItem?.name || "Unknown Item"}
                          </CardTitle>
                          <Badge variant={item.active ? "outline" : "secondary"} className="shrink-0">
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {item.vendorSku && (
                          <CardDescription className="font-mono text-xs" data-testid={`text-item-sku-${item.id}`}>
                            SKU: {item.vendorSku}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Price:</span>
                            <span className="font-medium" data-testid={`text-item-price-${item.id}`}>
                              ${item.lastPrice.toFixed(2)}
                            </span>
                            {item.unit && (
                              <span className="text-muted-foreground">/ {item.unit.name}</span>
                            )}
                          </div>
                          {item.caseSize && (
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">Case Size:</span>
                              <span className="font-medium" data-testid={`text-item-case-${item.id}`}>
                                {item.caseSize}
                              </span>
                            </div>
                          )}
                          {item.leadTimeDays && (
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">Lead Time:</span>
                              <span className="font-medium" data-testid={`text-item-lead-${item.id}`}>
                                {item.leadTimeDays} {item.leadTimeDays === 1 ? "day" : "days"}
                              </span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
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
