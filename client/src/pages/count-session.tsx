import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Package, DollarSign, Layers } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function CountSession() {
  const params = useParams();
  const countId = params.id;
  const [showEmpty, setShowEmpty] = useState(true);

  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
    enabled: !!countId,
  });

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const location = storageLocations?.find(l => l.id === count?.storageLocationId);
  
  // Calculate category totals
  const categoryTotals = countLines?.reduce((acc: any, line) => {
    const product = products?.find(p => p.id === line.productId);
    const category = product?.category || "Uncategorized";
    const value = line.derivedMicroUnits * (product?.lastCost || 0);
    
    if (!acc[category]) {
      acc[category] = { count: 0, value: 0, items: 0 };
    }
    acc[category].count += line.derivedMicroUnits;
    acc[category].value += value;
    acc[category].items += 1;
    return acc;
  }, {}) || {};

  const totalValue = countLines?.reduce((sum, line) => {
    const product = products?.find(p => p.id === line.productId);
    return sum + (line.derivedMicroUnits * (product?.lastCost || 0));
  }, 0) || 0;

  const totalItems = countLines?.length || 0;

  // Filter lines based on toggle
  const filteredLines = showEmpty 
    ? countLines 
    : countLines?.filter(line => line.qty > 0);

  const countDate = count ? new Date(count.countedAt) : null;

  if (countLoading || linesLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link href="/inventory">
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inventory
          </Button>
        </Link>
        
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-session-title">
          Count Session Details
        </h1>
        <p className="text-muted-foreground mt-2">
          {location?.name} - {countDate?.toLocaleDateString()} {countDate?.toLocaleTimeString()}
        </p>
      </div>

      {/* Mini Dashboard */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-total-value">
              ${totalValue.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Inventory valuation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-total-items">
              {totalItems}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Products counted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categories</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-categories">
              {Object.keys(categoryTotals).length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Product categories
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Totals */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(categoryTotals).map(([category, data]: [string, any]) => (
              <div 
                key={category} 
                className="border rounded-lg p-4 hover-elevate"
                data-testid={`card-category-${category.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <div className="font-semibold mb-2">{category}</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items:</span>
                    <span className="font-mono">{data.items}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value:</span>
                    <span className="font-mono font-semibold">${data.value.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Count Lines Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Counted Items</CardTitle>
            <div className="flex items-center space-x-2">
              <Switch
                id="show-empty"
                checked={showEmpty}
                onCheckedChange={setShowEmpty}
                data-testid="toggle-show-empty"
              />
              <Label htmlFor="show-empty" className="cursor-pointer">
                Show empty counts
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Micro Units</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLines && filteredLines.length > 0 ? (
                filteredLines.map((line) => {
                  const product = products?.find(p => p.id === line.productId);
                  const value = line.derivedMicroUnits * (product?.lastCost || 0);
                  return (
                    <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                      <TableCell className="font-medium">{product?.name || 'Unknown'}</TableCell>
                      <TableCell className="text-muted-foreground">{product?.category || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{line.qty}</TableCell>
                      <TableCell>{line.unitName || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{line.derivedMicroUnits.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${(product?.lastCost || 0).toFixed(4)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">${value.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {showEmpty ? "No items in this count" : "No items with quantities found"}
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
