import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp, TrendingDown, Activity, DollarSign, ShoppingCart } from "lucide-react";
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
import { TheoreticalDetailDialog } from "@/components/theoretical-detail-dialog";
import { ReceiptModal } from "@/components/receipt-modal";

type InventoryCount = {
  id: string;
  countDate: string;
  applied: number;
  completedAt: string | null;
};

type VarianceSummary = {
  currentCountId: string;
  previousCountId: string;
  inventoryDate: string;
  inventoryValue: number;
  totalSales: number;
  totalVarianceCost: number;
  totalVariancePercent: number;
  daySpan: number;
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
  vendorName: string;
  expectedDate: string;
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
  salesSummary: {
    totalItemsSold: number;
    totalNetSales: number;
  };
};

export default function TfcVariance() {
  const { getEffectiveCompanyId } = useAuth();
  const { selectedStoreId, stores } = useStoreContext();
  const companyId = getEffectiveCompanyId();

  const [selectedSummary, setSelectedSummary] = useState<VarianceSummary | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string>("");
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string | null>(null);
  const [selectedVendorName, setSelectedVendorName] = useState<string>("");
  const [selectedExpectedDate, setSelectedExpectedDate] = useState<string>("");

  // Fetch variance summaries for the selected store
  const { data: summaries = [], isLoading: isLoadingSummaries } = useQuery<VarianceSummary[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: !!companyId && !!selectedStoreId,
  });

  // Clear selected summary when store changes or when summaries load
  useEffect(() => {
    setSelectedSummary(null);
  }, [selectedStoreId]);

  // Auto-select the most recent summary (first in list) when summaries load
  useEffect(() => {
    if (summaries.length > 0 && !selectedSummary) {
      setSelectedSummary(summaries[0]);
    }
  }, [summaries, selectedSummary]);

  // Get currentCountId and previousCountId from selected summary
  const currentCountId = selectedSummary?.currentCountId || "";
  const previousCountId = selectedSummary?.previousCountId || "";

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

  const formatPurchaseOrderDate = (dateStr: string) => {
    // Format as M/D/YY
    const date = new Date(dateStr);
    const month = date.getMonth() + 1; // 0-indexed
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2); // Last 2 digits
    return `${month}/${day}/${year}`;
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
        <h2 className="text-lg font-semibold mb-4">Select Inventory Period</h2>
        
        {isLoadingSummaries ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="space-y-2">
                  <div className="h-4 bg-muted rounded w-32" />
                  <div className="h-3 bg-muted rounded w-24" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">
                No variance data available. You need at least two applied inventory counts to generate variance reports.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {summaries.map((summary) => (
              <Card
                key={summary.currentCountId}
                className={`cursor-pointer transition-colors hover-elevate ${
                  selectedSummary?.currentCountId === summary.currentCountId
                    ? "border-primary bg-accent"
                    : ""
                }`}
                onClick={() => setSelectedSummary(summary)}
                data-testid={`card-summary-${summary.currentCountId}`}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span data-testid={`text-inventory-date-${summary.currentCountId}`}>
                      {formatDate(summary.inventoryDate)}
                    </span>
                    <Badge variant={summary.totalVarianceCost > 0 ? "destructive" : "default"} data-testid={`badge-variance-${summary.currentCountId}`}>
                      {summary.totalVariancePercent > 0 ? "+" : ""}
                      {formatNumber(summary.totalVariancePercent, 1)}%
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {summary.daySpan} {summary.daySpan === 1 ? "day" : "days"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Inventory Value:</span>
                    <span className="font-medium" data-testid={`text-inventory-value-${summary.currentCountId}`}>
                      {formatCurrency(summary.inventoryValue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Sales:</span>
                    <span className="font-medium" data-testid={`text-total-sales-${summary.currentCountId}`}>
                      {formatCurrency(summary.totalSales)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Variance:</span>
                    <span
                      className={`font-semibold ${
                        summary.totalVarianceCost > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                      }`}
                      data-testid={`text-variance-cost-${summary.currentCountId}`}
                    >
                      {summary.totalVarianceCost > 0 ? "+" : ""}
                      {formatCurrency(summary.totalVarianceCost)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {!varianceData && !isLoadingVariance && summaries.length > 0 && !selectedSummary && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Select an Inventory Period</p>
              <p className="text-sm mt-1">
                Click on a period above to view detailed variance analysis
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
          {/* Period Comparison Info */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Comparing:{" "}
                    <Link 
                      href={`/count/${varianceData.previousCountId}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                      data-testid="link-previous-count"
                    >
                      {formatDate(varianceData.previousCountDate)}
                    </Link>
                    {" → "}
                    <Link 
                      href={`/count/${varianceData.currentCountId}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                      data-testid="link-current-count"
                    >
                      {formatDate(varianceData.currentCountDate)}
                    </Link>
                    <span className="ml-2">
                      ({varianceData.daySpan} {varianceData.daySpan === 1 ? "Day" : "Days"})
                    </span>
                  </p>
                </div>
                
                {varianceData.purchaseOrders && varianceData.purchaseOrders.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-sm font-medium text-foreground mb-2">
                      Purchase Orders Delivered ({varianceData.purchaseOrders.length}):
                    </p>
                    <p className="text-sm text-primary" data-testid="text-purchase-orders">
                      {varianceData.purchaseOrders.map((po, index) => (
                        <span key={po.id}>
                          <button
                            onClick={() => {
                              setSelectedPurchaseOrderId(po.id);
                              setSelectedVendorName(po.vendorName);
                              setSelectedExpectedDate(po.expectedDate);
                              setReceiptModalOpen(true);
                            }}
                            className="hover:underline cursor-pointer text-primary"
                            data-testid={`button-po-${po.id}`}
                          >
                            {formatPurchaseOrderDate(po.expectedDate)} - {po.vendorName}
                          </button>
                          {index < varianceData.purchaseOrders.length - 1 && " | "}
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Sales Summary Section */}
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Total Items Sold
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-items-sold">
                  {varianceData.salesSummary.totalItemsSold.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  During {varianceData.daySpan} {varianceData.daySpan === 1 ? "day" : "days"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Total Net Sales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-net-sales">
                  {formatCurrency(varianceData.salesSummary.totalNetSales)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  From POS sales data
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Variance Summary Section */}
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
                      <TableHead className="text-right">WAC</TableHead>
                      <TableHead className="text-right">Cost Impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varianceData.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground">
                          No variance data available for the selected period
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {varianceData.items
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
                                <Button
                                  variant="ghost"
                                  className="h-auto p-0 font-mono text-sm hover:underline"
                                  onClick={() => {
                                    setSelectedItemId(item.inventoryItemId);
                                    setSelectedItemName(item.inventoryItemName);
                                    setDetailDialogOpen(true);
                                  }}
                                  data-testid={`button-theoretical-detail-${item.inventoryItemId}`}
                                >
                                  {formatNumber(item.theoreticalUsage)}
                                </Button>
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
                              <TableCell className="text-right font-mono text-sm">
                                {formatCurrency(item.pricePerUnit)}
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
                          ))}
                        <TableRow className="border-t-2 bg-muted/20 font-bold">
                          <TableCell colSpan={9} className="text-right font-semibold">
                            Total
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono font-bold ${
                              varianceData.summary.totalVarianceCost > 0
                                ? "text-destructive"
                                : varianceData.summary.totalVarianceCost < 0
                                ? "text-green-600"
                                : ""
                            }`}
                            data-testid="text-variance-total"
                          >
                            {varianceData.summary.totalVarianceCost > 0 ? "+" : ""}
                            {formatCurrency(varianceData.summary.totalVarianceCost)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <TheoreticalDetailDialog
            open={detailDialogOpen}
            onOpenChange={setDetailDialogOpen}
            inventoryItemId={selectedItemId}
            inventoryItemName={selectedItemName}
            previousCountId={previousCountId}
            currentCountId={currentCountId}
            storeId={selectedStoreId || ""}
          />
          
          <ReceiptModal
            open={receiptModalOpen}
            onOpenChange={setReceiptModalOpen}
            purchaseOrderId={selectedPurchaseOrderId}
            vendorName={selectedVendorName}
            expectedDate={selectedExpectedDate}
          />
        </>
      )}
    </div>
  );
}
