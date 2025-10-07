import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Package } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Products() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const filteredProducts = products?.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.pluSku && p.pluSku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getUnitName = (unitId: string) => {
    return units?.find(u => u.id === unitId)?.name || "Unknown";
  };

  const getLocationNames = (locationIds: string[] | null) => {
    if (!locationIds || locationIds.length === 0) return "-";
    return locationIds
      .map(id => storageLocations?.find(l => l.id === id)?.name || "Unknown")
      .join(", ");
  };

  const getCategoryColor = (category: string | null) => {
    switch (category) {
      case "Protein": return "bg-red-500/10 text-red-700 dark:text-red-400";
      case "Produce": return "bg-green-500/10 text-green-700 dark:text-green-400";
      case "Dairy": return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
      case "Dry/Pantry": return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
      default: return "";
    }
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
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Storage Location(s)</TableHead>
                <TableHead>Yield</TableHead>
                <TableHead className="text-right">Last Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-10 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))
              ) : filteredProducts && filteredProducts.length > 0 ? (
                filteredProducts.map((product) => (
                  <TableRow key={product.id} className="hover-elevate" data-testid={`row-product-${product.id}`}>
                    <TableCell>
                      <Avatar className="h-10 w-10" data-testid={`img-product-${product.id}`}>
                        <AvatarImage src={product.imageUrl} alt={product.name} />
                        <AvatarFallback>
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-product-name-${product.id}`}>{product.name}</TableCell>
                    <TableCell data-testid={`text-product-category-${product.id}`}>
                      {product.category ? (
                        <Badge variant="outline" className={getCategoryColor(product.category)}>
                          {product.category}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm" data-testid={`text-product-locations-${product.id}`}>
                      {getLocationNames(product.storageLocationIds)}
                    </TableCell>
                    <TableCell className="font-mono text-sm" data-testid={`text-product-yield-${product.id}`}>
                      {product.yieldAmount ? `${product.yieldAmount} ${getUnitName(product.yieldUnitId)}` : "-"}
                    </TableCell>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
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
