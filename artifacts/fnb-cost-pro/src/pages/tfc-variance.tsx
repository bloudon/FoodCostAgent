import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp, TrendingDown, Activity, DollarSign, ShoppingCart, Info, AlertTriangle, ChevronDown, ChevronRight, Store, X, Layers } from "lucide-react";
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
import { SortableTableHead, useTableSort } from "@/components/sortable-table-head";
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
  refundPct?: number;
  hasHighRefunds?: boolean;
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

type LocationGroup = {
  locationId: string;
  locationName: string;
  countedValue: number;
  previousValue: number;
  varianceCost: number;
};

type RefundSummary = {
  totalRefundNetSales: number;
  totalGrossSales: number;
  refundPct: number;
  isSignificant: boolean;
  topRefundedItems: Array<{
    menuItemId: string;
    menuItemName: string;
    refundNetSales: number;
  }>;
};

type OutletFoodCostItem = {
  outletId: string;
  outletName: string;
  totalNetSales: number;
  totalTheoreticalCost: number;
  foodCostPct: number | null;
  linkedItemCount: number;
  unlinkedItemCount: number;
  isComplete: boolean;
  /** Inventory item IDs used in recipes for menu items sold in this unit. */
  inventoryItemIds: string[];
};

type OutletFoodCostResponse = {
  hasData: boolean;
  outlets: OutletFoodCostItem[];
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
  locationGroups: LocationGroup[];
  purchaseOrders: PurchaseOrder[];
  salesSummary: {
    totalItemsSold: number;
    totalNetSales: number;
  };
  refundSummary?: RefundSummary;
};

import { TierGate } from "@/components/tier-gate";
import { CostingMethodBadge } from "@/components/costing-method-badge";
import { MapPin } from "lucide-react";

function TfcVarianceContent() {
  const { getEffectiveCompanyId } = useAuth();
  const { selectedStoreId, stores } = useStoreContext();
  const companyId = getEffectiveCompanyId();

  const [selectedSummary, setSelectedSummary] = useState<VarianceSummary | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string>("");
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string | null>(null);
  const [refundWarningExpanded, setRefundWarningExpanded] = useState(false);

  const { sortField: vSortField, sortDirection: vSortDir, handleSort: vHandleSort } = useTableSort("varianceCost", "desc");
  const [selectedVendorName, setSelectedVendorName] = useState<string>("");
  const [selectedExpectedDate, setSelectedExpectedDate] = useState<string>("");
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);

  // Read URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlCountId = urlParams.get('countId');
  const urlCurrentCountId = urlParams.get('currentCountId');
  const urlHighlightItemId = urlParams.get('highlight');

  // Fetch variance summaries for the selected store
  const { data: summaries = [], isLoading: isLoadingSummaries } = useQuery<VarianceSummary[]>({
    queryKey: [`/api/tfc/variance/summaries?storeId=${selectedStoreId}`],
    enabled: !!companyId && !!selectedStoreId,
  });

  // Clear selected summary when store changes or when summaries load
  useEffect(() => {
    setSelectedSummary(null);
  }, [selectedStoreId]);

  // Auto-select summary based on URL parameter or default to most recent
  useEffect(() => {
    if (summaries.length > 0 && !selectedSummary) {
      // Support both ?countId= (legacy) and ?currentCountId= (deep-link from top item card)
      const targetCountId = urlCurrentCountId || urlCountId;
      if (targetCountId) {
        const matchingSummary = summaries.find(s => s.currentCountId === targetCountId);
        if (matchingSummary) {
          setSelectedSummary(matchingSummary);
          return;
        }
      }
      // Default to most recent (first in list)
      setSelectedSummary(summaries[0]);
    }
  }, [summaries, selectedSummary, urlCountId, urlCurrentCountId]);

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

  // Fetch outlet-level food cost breakdown
  const { data: outletFoodCost } = useQuery<OutletFoodCostResponse>({
    queryKey: [
      `/api/tfc/outlet-food-cost?previousCountId=${previousCountId}&currentCountId=${currentCountId}&storeId=${selectedStoreId}`,
    ],
    enabled: !!previousCountId && !!currentCountId && !!selectedStoreId && !!companyId,
    retry: false,
  });

  // Scroll highlighted item into view once variance data loads
  useEffect(() => {
    if (!urlHighlightItemId || !varianceData) return;
    const el = document.querySelector(
      `[data-testid="row-variance-item-${urlHighlightItemId}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHighlightItemId, varianceData]);

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

  // When a different period is selected, clear any active outlet filter
  useEffect(() => {
    setSelectedOutletId(null);
  }, [currentCountId, previousCountId]);

  // Items filtered by selected operating unit (if any)
  const activeOutlet = useMemo(() => {
    if (!selectedOutletId || !outletFoodCost) return null;
    return outletFoodCost.outlets.find(o => o.outletId === selectedOutletId) ?? null;
  }, [selectedOutletId, outletFoodCost]);

  const sortedVarianceItems = useMemo(() => {
    const allItems = varianceData?.items ?? [];
    // If an operating unit is selected, filter to ingredients used in that unit's recipes
    const items = activeOutlet
      ? allItems.filter(i => activeOutlet.inventoryItemIds.includes(i.inventoryItemId))
      : allItems;
    return [...items].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (vSortField) {
        // @ts-ignore
        case "item": av = a.inventoryItemName.toLowerCase(); bv = b.inventoryItemName.toLowerCase(); break;
        // @ts-ignore
        case "previousQty": av = a.previousQty; bv = b.previousQty; break;
        // @ts-ignore
        case "receivedQty": av = a.receivedQty; bv = b.receivedQty; break;
        // @ts-ignore
        case "currentQty": av = a.currentQty; bv = b.currentQty; break;
        // @ts-ignore
        case "actualUsage": av = a.actualUsage; bv = b.actualUsage; break;
        // @ts-ignore
        case "theoreticalUsage": av = a.theoreticalUsage; bv = b.theoreticalUsage; break;
        // @ts-ignore
        case "varianceUnits": av = a.varianceUnits; bv = b.varianceUnits; break;
        case "varianceCost": av = Math.abs(a.varianceCost); bv = Math.abs(b.varianceCost); break;
        // @ts-ignore
        case "variancePercent": av = Math.abs(a.variancePercent); bv = Math.abs(b.variancePercent); break;
        // @ts-ignore
        case "pricePerUnit": av = a.pricePerUnit; bv = b.pricePerUnit; break;
        default: return 0;
      }
      // @ts-ignore
      const cmp = typeof av === "number" ? av - bv : av.localeCompare(bv);
      return vSortDir === "asc" ? cmp : -cmp;
    });
  }, [varianceData, vSortField, vSortDir, activeOutlet]);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-variance-title">
              Food Cost Variance
            </h1>
            <CostingMethodBadge />
          </div>
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
                  <CardTitle className="text-lg flex items-center justify-between flex-wrap gap-2">
                    <span data-testid={`text-inventory-date-${summary.currentCountId}`}>
                      {formatDate(summary.inventoryDate)}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {summary.hasHighRefunds && (
                        <Badge
                          variant="outline"
                          className="border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 gap-1"
                          data-testid={`badge-high-refunds-${summary.currentCountId}`}
                          title={`Refund volume is ${formatNumber(summary.refundPct ?? 0, 1)}% of gross sales — may inflate food-cost %`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          High Refunds
                        </Badge>
                      )}
                      <Badge variant={summary.totalVarianceCost > 0 ? "destructive" : "default"} data-testid={`badge-variance-${summary.currentCountId}`}>
                        {summary.totalVariancePercent > 0 ? "+" : ""}
                        {formatNumber(summary.totalVariancePercent, 1)}%
                      </Badge>
                    </div>
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
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 mb-4">
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

          {/* Refund note — elevated to warning when refund volume is significant */}
          {varianceData.refundSummary?.isSignificant ? (
            <div
              className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 mb-6 text-sm"
              data-testid="note-refund-cost-behaviour"
            >
              <button
                className="flex items-start gap-2 w-full text-left"
                onClick={() => setRefundWarningExpanded(prev => !prev)}
                aria-expanded={refundWarningExpanded}
                data-testid="button-refund-warning-toggle"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="flex-1 text-amber-800 dark:text-amber-200">
                  <strong>Refund volume may be inflating food-cost %.</strong>{" "}
                  Refunds in this period total{" "}
                  <strong>{formatCurrency(varianceData.refundSummary.totalRefundNetSales)}</strong>
                  {" "}({formatNumber(varianceData.refundSummary.refundPct, 1)}% of gross sales).
                  Refunds reduce net-sales revenue but do not reverse ingredient cost, which raises food-cost&nbsp;%.
                </span>
                <span className="ml-auto pl-2 text-amber-600 dark:text-amber-400 shrink-0">
                  {refundWarningExpanded
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                </span>
              </button>
              {refundWarningExpanded && varianceData.refundSummary.topRefundedItems.length > 0 && (
                <div className="mt-3 ml-6 space-y-1" data-testid="list-top-refunded-items">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-2">
                    Top refunded items this period
                  </p>
                  {varianceData.refundSummary.topRefundedItems.map((item) => (
                    <div key={item.menuItemId} className="flex items-center justify-between text-sm text-amber-800 dark:text-amber-200">
                      <span data-testid={`text-refund-item-name-${item.menuItemId}`}>{item.menuItemName}</span>
                      <span className="font-mono font-medium ml-4" data-testid={`text-refund-item-amount-${item.menuItemId}`}>
                        {formatCurrency(item.refundNetSales)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 mb-6 text-sm text-muted-foreground"
              data-testid="note-refund-cost-behaviour"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <strong className="text-foreground">Refunded modifiers:</strong>{" "}
                When a modifier is sold and then refunded on the same day, the refund reduces net
                sales (the revenue denominator) but the ingredient cost of the original sale is
                retained — the kitchen already consumed the food. On days with high refund
                activity this may cause food-cost&nbsp;% to appear slightly elevated compared to a
                period without refunds.
              </span>
            </div>
          )}

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

          {/* Per-Location Cost Totals */}
          {varianceData.locationGroups && varianceData.locationGroups.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  Inventory Value by Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Previous Count Value</TableHead>
                        <TableHead className="text-right">Current Count Value</TableHead>
                        <TableHead className="text-right">$ Variance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {varianceData.locationGroups.map((loc) => (
                        <TableRow key={loc.locationId} data-testid={`row-location-${loc.locationId}`}>
                          <TableCell className="font-medium" data-testid={`text-location-name-${loc.locationId}`}>
                            {loc.locationName}
                          </TableCell>
                          <TableCell className="text-right font-mono" data-testid={`text-location-previous-${loc.locationId}`}>
                            {formatCurrency(loc.previousValue)}
                          </TableCell>
                          <TableCell className="text-right font-mono" data-testid={`text-location-counted-${loc.locationId}`}>
                            {formatCurrency(loc.countedValue)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono font-medium ${
                              loc.varianceCost > 0
                                ? "text-destructive"
                                : loc.varianceCost < 0
                                ? "text-green-600 dark:text-green-400"
                                : ""
                            }`}
                            data-testid={`text-location-variance-${loc.locationId}`}
                          >
                            {loc.varianceCost > 0 ? "+" : ""}
                            {formatCurrency(loc.varianceCost)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 bg-muted/20 font-bold" data-testid="row-location-grand-total">
                        <TableCell className="font-semibold">Grand Total</TableCell>
                        <TableCell className="text-right font-mono font-bold" data-testid="text-location-total-previous">
                          {formatCurrency(varianceData.locationGroups.reduce((s, l) => s + l.previousValue, 0))}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold" data-testid="text-location-total-counted">
                          {formatCurrency(varianceData.locationGroups.reduce((s, l) => s + l.countedValue, 0))}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold ${
                            varianceData.locationGroups.reduce((s, l) => s + l.varianceCost, 0) > 0
                              ? "text-destructive"
                              : varianceData.locationGroups.reduce((s, l) => s + l.varianceCost, 0) < 0
                              ? "text-green-600 dark:text-green-400"
                              : ""
                          }`}
                          data-testid="text-location-total-variance"
                        >
                          {(() => {
                            const total = varianceData.locationGroups.reduce((s, l) => s + l.varianceCost, 0);
                            return `${total > 0 ? "+" : ""}${formatCurrency(total)}`;
                          })()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Food Cost by Operating Unit */}
          {outletFoodCost && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Layers className="h-5 w-5 text-muted-foreground" />
                  Food Cost % by Operating Unit
                </CardTitle>
              </CardHeader>
              <CardContent>
                {outletFoodCost.outlets.length === 0 ? (
                  /* No operating units defined for this company yet */
                  <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="note-outlet-no-outlets">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Operating unit breakdown is available after importing sales from a <strong>Sales by Item</strong> report.
                      Units are created automatically from the outlet column in that import.
                    </span>
                  </div>
                ) : !outletFoodCost.hasData ? (
                  /* Operating units exist but none of the sales in this period are tagged */
                  <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="note-outlet-no-data">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      No operating-unit-tagged sales were found for this period. Re-import the Sales by Item
                      report for each day in this period to populate the breakdown.
                    </span>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      Click a row to filter the ingredient table below to that operating unit's recipes.
                    </p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Operating Unit</TableHead>
                            <TableHead className="text-right">Net Sales</TableHead>
                            <TableHead className="text-right">Theoretical Cost</TableHead>
                            <TableHead className="text-right">Food Cost %</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {outletFoodCost.outlets.map((outlet) => {
                            const isSelected = selectedOutletId === outlet.outletId;
                            return (
                              <TableRow
                                key={outlet.outletId}
                                data-testid={`row-outlet-${outlet.outletId}`}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                                    : "hover:bg-muted/50"
                                }`}
                                onClick={() =>
                                  setSelectedOutletId(isSelected ? null : outlet.outletId)
                                }
                              >
                                <TableCell className="font-medium" data-testid={`text-outlet-name-${outlet.outletId}`}>
                                  <span className="flex items-center gap-2">
                                    {isSelected && (
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                        <X className="h-2.5 w-2.5" />
                                      </span>
                                    )}
                                    {outlet.outletName}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono" data-testid={`text-outlet-sales-${outlet.outletId}`}>
                                  {outlet.totalNetSales > 0 ? formatCurrency(outlet.totalNetSales) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono" data-testid={`text-outlet-cost-${outlet.outletId}`}>
                                  {outlet.totalTheoreticalCost > 0 ? formatCurrency(outlet.totalTheoreticalCost) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono font-semibold" data-testid={`text-outlet-pct-${outlet.outletId}`}>
                                  {outlet.foodCostPct !== null
                                    ? `${formatNumber(outlet.foodCostPct, 1)}%`
                                    : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell>
                                  {outlet.totalNetSales === 0 && outlet.linkedItemCount === 0 ? (
                                    <Badge variant="secondary" data-testid={`badge-outlet-no-sales-${outlet.outletId}`}>
                                      No sales data
                                    </Badge>
                                  ) : outlet.isComplete ? (
                                    <Badge variant="default" className="bg-green-600 dark:bg-green-700" data-testid={`badge-outlet-complete-${outlet.outletId}`}>
                                      Complete
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 gap-1"
                                      title={`${outlet.unlinkedItemCount} menu item${outlet.unlinkedItemCount !== 1 ? "s" : ""} in this unit have no linked recipe`}
                                      data-testid={`badge-outlet-incomplete-${outlet.outletId}`}
                                    >
                                      <AlertTriangle className="h-3 w-3" />
                                      Costing incomplete
                                    </Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {outletFoodCost.outlets.some(o => o.unlinkedItemCount > 0) && (
                        <p className="text-xs text-muted-foreground mt-3" data-testid="note-outlet-incomplete">
                          <AlertTriangle className="h-3 w-3 inline mr-1 text-amber-500" />
                          Some units show <em>costing incomplete</em> because not all menu items have a linked recipe.
                          Link recipes via the <strong>Menu Items</strong> page to see the full cost %.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-lg">Variance by Ingredient</CardTitle>
                {activeOutlet && (
                  <div
                    className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                    data-testid="badge-active-outlet-filter"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Filtered: {activeOutlet.outletName}
                    <button
                      onClick={() => setSelectedOutletId(null)}
                      className="ml-1 rounded-full hover:bg-primary/20 p-0.5"
                      aria-label="Clear filter"
                      data-testid="button-clear-outlet-filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {activeOutlet && (
                <p className="text-xs text-muted-foreground mt-1">
                  Showing {sortedVarianceItems.length} ingredient{sortedVarianceItems.length !== 1 ? "s" : ""} used in recipes for <strong>{activeOutlet.outletName}</strong> menu items.{" "}
                  <button
                    onClick={() => setSelectedOutletId(null)}
                    className="underline hover:no-underline"
                    data-testid="link-show-all-ingredients"
                  >
                    Show all
                  </button>
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead field="item" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort}>Item</SortableTableHead>
                      <SortableTableHead field="previousQty" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Previous</SortableTableHead>
                      <SortableTableHead field="receivedQty" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Received</SortableTableHead>
                      <SortableTableHead field="currentQty" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Current</SortableTableHead>
                      <SortableTableHead field="actualUsage" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Actual</SortableTableHead>
                      <SortableTableHead field="theoreticalUsage" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Theoretical</SortableTableHead>
                      <SortableTableHead field="varianceUnits" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Variance</SortableTableHead>
                      <SortableTableHead field="variancePercent" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Variance %</SortableTableHead>
                      <SortableTableHead field="pricePerUnit" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">WAC</SortableTableHead>
                      <SortableTableHead field="varianceCost" sortField={vSortField} sortDirection={vSortDir} onSort={vHandleSort} className="text-right">Cost Impact</SortableTableHead>
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
                        {sortedVarianceItems.map((item) => (
                            <TableRow
                              key={item.inventoryItemId}
                              data-testid={`row-variance-item-${item.inventoryItemId}`}
                              className={
                                urlHighlightItemId === item.inventoryItemId
                                  ? "bg-amber-50 dark:bg-amber-900/20 ring-1 ring-inset ring-amber-400/60"
                                  : ""
                              }
                            >
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
                        {(() => {
                          const filteredTotal = sortedVarianceItems.reduce((s, i) => s + i.varianceCost, 0);
                          return (
                            <TableRow className="border-t-2 bg-muted/20 font-bold">
                              <TableCell colSpan={9} className="text-right font-semibold">
                                {activeOutlet ? (
                                  <span>
                                    {activeOutlet.outletName} subtotal{" "}
                                    <span className="text-xs font-normal text-muted-foreground">
                                      (all ingredients: {formatCurrency(varianceData.summary.totalVarianceCost)})
                                    </span>
                                  </span>
                                ) : "Total"}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono font-bold ${
                                  filteredTotal > 0
                                    ? "text-destructive"
                                    : filteredTotal < 0
                                    ? "text-green-600"
                                    : ""
                                }`}
                                data-testid="text-variance-total"
                              >
                                {filteredTotal > 0 ? "+" : ""}
                                {formatCurrency(filteredTotal)}
                              </TableCell>
                            </TableRow>
                          );
                        })()}
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

export default function TfcVariance() {
  return (
    <TierGate feature="tfc_variance">
      <TfcVarianceContent />
    </TierGate>
  );
}
