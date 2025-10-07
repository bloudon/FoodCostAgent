import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Products() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const filteredProducts = products?.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.pluSku && p.pluSku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getUnitName = (unitId: string) => {
    return units?.find(u => u.id === unitId)?.name || "Unknown";
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-products-title">
            Products
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage product catalog with units and vendor information
          </p>
        </div>
        <Button data-testid="button-create-product">
          <Plus className="h-4 w-4 mr-2" />
          New Product
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-product"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>PLU/SKU</TableHead>
                <TableHead>Base Unit</TableHead>
                <TableHead className="text-right">Last Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))
              ) : filteredProducts && filteredProducts.length > 0 ? (
                filteredProducts.map((product) => (
                  <TableRow key={product.id} className="hover-elevate" data-testid={`row-product-${product.id}`}>
                    <TableCell className="font-medium" data-testid={`text-product-name-${product.id}`}>{product.name}</TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-product-category-${product.id}`}>{product.category || "-"}</TableCell>
                    <TableCell className="font-mono text-sm" data-testid={`text-product-sku-${product.id}`}>{product.pluSku || "-"}</TableCell>
                    <TableCell data-testid={`text-product-unit-${product.id}`}>{getUnitName(product.baseUnitId)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-product-cost-${product.id}`}>
                      ${product.lastCost.toFixed(4)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.active === 1 ? "default" : "secondary"} data-testid={`badge-product-status-${product.id}`}>
                        {product.active === 1 ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {searchQuery ? "No products match your search" : "No products found. Create your first product to get started."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
