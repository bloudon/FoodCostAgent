import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

type MenuItemContribution = {
  menuItemId: string;
  menuItemName: string;
  qtySold: number;
  theoreticalQty: number;
  cost: number;
};

type TheoreticalDetailResponse = {
  summary: {
    inventoryItemId: string;
    inventoryItemName: string;
    totalQty: number;
    totalCost: number;
    unitName: string;
    unitAbbreviation: string;
  };
  menuItems: MenuItemContribution[];
};

interface TheoreticalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventoryItemId: string | null;
  inventoryItemName: string;
  previousCountId: string;
  currentCountId: string;
  storeId: string;
}

export function TheoreticalDetailDialog({
  open,
  onOpenChange,
  inventoryItemId,
  inventoryItemName,
  previousCountId,
  currentCountId,
  storeId,
}: TheoreticalDetailDialogProps) {
  const { data, isLoading, error } = useQuery<TheoreticalDetailResponse>({
    queryKey: [
      "/api/tfc/variance/theoretical-detail",
      previousCountId,
      currentCountId,
      storeId,
      inventoryItemId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        previousCountId,
        currentCountId,
        storeId,
        inventoryItemId: inventoryItemId || "",
      });
      const response = await fetch(`/api/tfc/variance/theoretical-detail?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch theoretical usage detail");
      }
      return response.json();
    },
    enabled: open && !!inventoryItemId,
  });

  const formatNumber = (value: number, decimals = 2) => {
    return value.toFixed(decimals);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-theoretical-detail">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            Theoretical Usage Detail: {data?.summary.inventoryItemName || inventoryItemName}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8" data-testid="loading-theoretical-detail">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-destructive py-4" data-testid="error-theoretical-detail">
            Error loading theoretical usage detail. Please try again.
          </div>
        )}

        {data && !isLoading && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Quantity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-qty">
                    {formatNumber(data.summary.totalQty)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {data.summary.unitAbbreviation || data.summary.unitName}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Cost
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-cost">
                    {formatCurrency(data.summary.totalCost)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Menu Items
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-menu-item-count">
                    {data.menuItems.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Menu Item Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {data.menuItems.length === 0 ? (
                  <div className="text-muted-foreground text-center py-4" data-testid="text-no-menu-items">
                    No menu items found for this ingredient.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-menu-item">Menu Item</TableHead>
                        <TableHead className="text-right" data-testid="header-qty-sold">Qty Sold</TableHead>
                        <TableHead className="text-right" data-testid="header-usage-per-sale">Usage Per Sale</TableHead>
                        <TableHead className="text-right" data-testid="header-total-qty">Total Qty</TableHead>
                        <TableHead className="text-right" data-testid="header-cost">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.menuItems.map((item, index) => {
                        const usagePerSale = item.qtySold > 0 ? item.theoreticalQty / item.qtySold : 0;
                        return (
                          <TableRow key={item.menuItemId} data-testid={`row-menu-item-${index}`}>
                            <TableCell className="font-medium" data-testid={`text-menu-item-name-${index}`}>
                              {item.menuItemName}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-qty-sold-${index}`}>
                              {item.qtySold}
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-usage-per-sale-${index}`}>
                              {formatNumber(usagePerSale)}{" "}
                              <span className="text-sm text-muted-foreground">
                                {data.summary.unitAbbreviation || data.summary.unitName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-total-qty-${index}`}>
                              {formatNumber(item.theoreticalQty)}{" "}
                              <span className="text-sm text-muted-foreground">
                                {data.summary.unitAbbreviation || data.summary.unitName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right" data-testid={`text-cost-${index}`}>
                              {formatCurrency(item.cost)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
