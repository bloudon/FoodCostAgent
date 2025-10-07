import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Vendors() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: vendors, isLoading } = useQuery<any[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorProducts } = useQuery<any[]>({
    queryKey: ["/api/vendor-products"],
  });

  const getProductCount = (vendorId: string) => {
    return vendorProducts?.filter(vp => vp.vendorId === vendorId).length || 0;
  };

  const filteredVendors = vendors?.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-vendors-title">
            Vendors
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage vendor catalogs with product pricing and case specifications
          </p>
        </div>
        <Button data-testid="button-create-vendor">
          <Plus className="h-4 w-4 mr-2" />
          New Vendor
        </Button>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vendors..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-vendor"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filteredVendors && filteredVendors.length > 0 ? (
          <>
            {filteredVendors.map((vendor) => (
              <Card key={vendor.id} className="hover-elevate cursor-pointer transition-all" data-testid={`card-vendor-${vendor.id}`}>
                <CardHeader>
                  <CardTitle className="text-lg" data-testid={`text-vendor-name-${vendor.id}`}>{vendor.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Products:</span>
                      <span className="font-mono" data-testid={`text-vendor-products-${vendor.id}`}>{getProductCount(vendor.id)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Account #:</span>
                      <span className="font-mono" data-testid={`text-vendor-account-${vendor.id}`}>{vendor.accountNumber || "-"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card className="border-dashed border-2 hover-elevate cursor-pointer transition-all" data-testid="button-add-new-vendor">
              <CardContent className="flex items-center justify-center h-full min-h-[140px]">
                <div className="text-center">
                  <Plus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Add New Vendor</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="col-span-full">
            <CardContent className="pt-6 text-center text-muted-foreground">
              {searchQuery ? "No vendors match your search" : "No vendors found. Create your first vendor to get started."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
