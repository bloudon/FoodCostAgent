import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Receipt = {
  id: string;
  companyId: string;
  storeId: string;
  purchaseOrderId: string;
  status: string;
  receivedAt: string;
};

type ReceiptLine = {
  id: string;
  receiptId: string;
  vendorItemId: string;
  receivedQty: number;
  unitId: string;
  priceEach: number;
  itemName?: string;
  unitName?: string;
  vendorSku?: string;
};

type ReceiptWithLines = Receipt & {
  lines: ReceiptLine[];
  vendorName?: string;
  expectedDate?: string;
};

interface ReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: string | null;
  vendorName: string;
  expectedDate: string;
}

export function ReceiptModal({
  open,
  onOpenChange,
  purchaseOrderId,
  vendorName,
  expectedDate,
}: ReceiptModalProps) {
  const { data: receipts, isLoading } = useQuery<ReceiptWithLines[]>({
    queryKey: [`/api/purchase-orders/${purchaseOrderId}/receipts`],
    enabled: !!purchaseOrderId && open,
  });

  const completedReceipts = receipts?.filter((r) => r.status === "completed") || [];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatNumber = (value: number, decimals = 2) => {
    return value.toFixed(decimals);
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Receipt Details - {vendorName}
          </DialogTitle>
          <DialogDescription>
            Expected Delivery: {new Date(expectedDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}

          {!isLoading && completedReceipts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No Receipts Found</p>
              <p className="text-sm mt-1">
                This purchase order has not been received yet.
              </p>
            </div>
          )}

          {!isLoading && completedReceipts.map((receipt) => {
            const receiptTotal = receipt.lines.reduce(
              (sum, line) => sum + line.receivedQty * line.priceEach,
              0
            );

            return (
              <div key={receipt.id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="default">
                      {receipt.status === "completed" ? "Received" : receipt.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatDateTime(receipt.receivedAt)}
                    </span>
                  </div>
                  <div className="text-sm font-medium">
                    Total: {formatCurrency(receiptTotal)}
                  </div>
                </div>

                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Received Qty</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Price Each</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receipt.lines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No items in this receipt
                          </TableCell>
                        </TableRow>
                      ) : (
                        receipt.lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell className="font-medium">
                              {line.itemName || "Unknown Item"}
                              {line.vendorSku && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({line.vendorSku})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(line.receivedQty)}
                            </TableCell>
                            <TableCell className="text-right">
                              {line.unitName || "unit"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(line.priceEach)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(line.receivedQty * line.priceEach)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-4 border-t">
            <Link href={`/purchase-orders/${purchaseOrderId}`}>
              <Button
                variant="outline"
                className="gap-2"
                data-testid="button-view-full-order"
                onClick={() => onOpenChange(false)}
              >
                View Full Order
                <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
