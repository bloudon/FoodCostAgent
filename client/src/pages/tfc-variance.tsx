import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useStoreContext } from "@/hooks/use-store-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type InventoryCount = {
  id: string;
  countDate: string;
  applied: number;
  completedAt: string | null;
};

type VarianceItem = {
  inventoryItemId: string;
  inventoryItemName: string;
  category: string | null;
  previousQty: number;
  receivedQty: number;
  currentQty: number;
  actualUsage: number;
  theoreticalUsage: number;
  varianceUnits: number;
  varianceCost: number;
  variancePercent: number;
  unitName: string;
  pricePerUnit: number;
};

type PurchaseOrder = {
  id: string;
  orderNumber: string;
  vendorId: string;
  orderDate: string;
  receivedAt: string;
};

type VarianceResponse = {
  previousCountId: string;
  currentCountId: string;
  daySpan: number;
  previousCountDate: string;
  currentCountDate: string;
  summary: {
    totalVarianceCost: number;
    positiveVarianceCost: number;
    negativeVarianceCost: number;
    totalTheoreticalCost: number;
    totalActualCost: number;
  };
  categories: Array<{
    categoryId: string;
    categoryName: string;
    items: VarianceItem[];
  }>;
  items: VarianceItem[];
  purchaseOrders: PurchaseOrder[];
};

export default function TfcVariance() {
  const { getEffectiveCompanyId } = useAuth();
  const { selectedStoreId, stores } = useStoreContext();
  const companyId = getEffectiveCompanyId();

  const [currentCountId, setCurrentCountId] = useState<string>("");

  // Fetch applied inventory counts for the selected store
  const { data: inventoryCounts = [] } = useQuery<InventoryCount[]>({
    queryKey: [`/api/inventory-counts?companyId=${companyId}&storeId=${selectedStoreId}`],
    enabled: !!companyId && !!selectedStoreId,
  });

  // Filter applied counts and sort by date ascending (oldest first)
  const appliedCounts = inventoryCounts
    .filter((count) => count.applied === 1)
    .sort((a, b) => new Date(a.countDate).getTime() - new Date(b.countDate).getTime());

  // Automatically determine the previous count (the one immediately before the selected current count)
  const currentCountIndex = appliedCounts.findIndex((c) => c.id === currentCountId);
  const previousCount = currentCountIndex > 0 ? appliedCounts[currentCountIndex - 1] : null;
  const previousCountId = previousCount?.id || "";

  // Fetch variance data when both counts are selected
  const { data: varianceData, isLoading: isLoadingVariance, error: varianceError } = useQuery<VarianceResponse>({
    queryKey: [
      `/api/tfc/variance?previousCountId=${previousCountId}&currentCountId=${currentCountId}&storeId=${selectedStoreId}`,
    ],
    enabled: !!previousCountId && !!currentCountId && !!selectedStoreId && !!companyId,
    retry: false,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatNumber = (value: number, decimals = 2) => {
    return value.toFixed(decimals);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-variance-title">
            Food Cost Variance
          </h1>
          <p className="text-muted-foreground mt-2">
            Compare theoretical vs. actual ingredient usage between inventory counts
          </p>
        </div>
        <Button variant="outline" data-testid="button-export-report" disabled>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      <div className="mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Store</label>
                <Select value={selectedStoreId} disabled={stores.length <= 1}>
                  <SelectTrigger data-testid="select-store">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Ending Inventory Count</label>
                <Select
                  value={currentCountId}
                  onValueChange={setCurrentCountId}
                  data-testid="select-ending-count"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select count date..." />
                  </SelectTrigger>
                  <SelectContent>
                    {appliedCounts
                      .filter((_, index) => index > 0)
                      .map((count) => (
                        <SelectItem key={count.id} value={count.id}>
                          {formatDate(count.countDate)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {currentCountId && previousCount && (
              <div className="mt-4 p-3 bg-muted/50 rounded-md space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Comparing: <span className="font-medium text-foreground">{formatDate(previousCount.countDate)}</span>
                    {" → "}
                    <span className="font-medium text-foreground">
                      {formatDate(appliedCounts.find((c) => c.id === currentCountId)?.countDate || "")}
                    </span>
                    {varianceData && (
                      <span className="ml-2">
                        ({varianceData.daySpan} {varianceData.daySpan === 1 ? "Day" : "Days"})
                      </span>
                    )}
                  </p>
                </div>
                
                {varianceData && varianceData.purchaseOrders && varianceData.purchaseOrders.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-sm font-medium text-foreground mb-2">
                      Purchase Orders Received ({varianceData.purchaseOrders.length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {varianceData.purchaseOrders.map((po) => (
                        <a
                          key={po.id}
                          href={`/purchase-orders/${po.id}`}
                          className="text-sm text-primary hover:underline"
                          data-testid={`link-po-${po.id}`}
                        >
                          #{po.orderNumber}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!varianceData && !isLoadingVariance && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Select Ending Inventory Count</p>
              <p className="text-sm mt-1">
                Choose an ending count to compare with the previous count
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoadingVariance && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <p>Loading variance data...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {varianceData && (
        <>
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Total Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold font-mono ${
                    varianceData.summary.totalVarianceCost > 0
                      ? "text-destructive"
                      : varianceData.summary.totalVarianceCost < 0
                      ? "text-green-600"
                      : ""
                  }`}
                  data-testid="text-total-variance"
                >
                  {formatCurrency(varianceData.summary.totalVarianceCost)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Actual vs. theoretical cost
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  Negative Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="text-2xl font-bold font-mono text-destructive"
                  data-testid="text-negative-variance"
                >
                  {formatCurrency(varianceData.summary.negativeVarianceCost)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Higher usage than expected
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Positive Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="text-2xl font-bold font-mono text-green-600"
                  data-testid="text-positive-variance"
                >
                  {formatCurrency(varianceData.summary.positiveVarianceCost)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Lower usage than expected
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Variance by Ingredient</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Previous</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Theoretical</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Variance %</TableHead>
                      <TableHead className="text-right">Cost Impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varianceData.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground">
                          No variance data available for the selected period
                        </TableCell>
                      </TableRow>
                    ) : (
                      varianceData.items
                        .sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost))
                        .map((item) => (
                          <TableRow key={item.inventoryItemId} data-testid={`row-variance-item-${item.inventoryItemId}`}>
                            <TableCell className="font-medium">
                              {item.inventoryItemName}
                              <span className="text-xs text-muted-foreground ml-2">
                                ({item.unitName})
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatNumber(item.previousQty)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatNumber(item.receivedQty)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatNumber(item.currentQty)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-medium">
                              {formatNumber(item.actualUsage)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatNumber(item.theoreticalUsage)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant={
                                  item.varianceUnits > 0.5
                                    ? "destructive"
                                    : item.varianceUnits < -0.5
                                    ? "default"
                                    : "secondary"
                                }
                                className="font-mono"
                              >
                                {item.varianceUnits > 0 ? "+" : ""}
                                {formatNumber(item.varianceUnits)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {item.varianceUnits > 0 ? "+" : ""}
                              {formatNumber(item.variancePercent, 1)}%
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-medium ${
                                item.varianceCost > 0
                                  ? "text-destructive"
                                  : item.varianceCost < 0
                                  ? "text-green-600"
                                  : ""
                              }`}
                            >
                              {item.varianceCost > 0 ? "+" : ""}
                              {formatCurrency(item.varianceCost)}
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
