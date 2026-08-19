import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronLeft, Info, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateString } from "@/lib/utils";

type ImportedInvoiceLine = {
  id: string;
  sourceLineId: string;
  description: string | null;
  itemCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  pack: unknown;
  sourceGlCode: string | null;
  sourceCategory: string | null;
  resolutionStatus: string;
  resolvedInventoryItemName: string | null;
};

type ImportedInvoiceDetail = {
  id: string;
  kind: 'historical_imported_invoice';
  sourceLabel: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  vendorId: string | null;
  vendorName: string;
  storeId: string;
  storeName: string;
  lineCount: number;
  totalAmount: number;
  originalFilename: string;
  approvedAt: string | null;
  sourceSystem: string;
  sourceInvoiceId: string;
  subtotal: number | null;
  taxAmount: number | null;
  chargeAmount: number | null;
  creditAmount: number | null;
  lines: ImportedInvoiceLine[];
};

function formatCurrency(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatPack(pack: unknown): string {
  if (typeof pack === "string") return pack.trim() || "—";
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return "—";

  const values = Object.entries(pack as Record<string, unknown>)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => key === "raw" ? String(value) : `${key}: ${String(value)}`);

  return values.join(", ") || "—";
}

export default function ImportedInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const backTarget = new URLSearchParams(window.location.search).get("from") === "receiving"
    ? "/receiving"
    : "/orders";

  const { data: invoice, isLoading, isError } = useQuery<ImportedInvoiceDetail>({
    queryKey: [`/api/imported-invoices/${invoiceId}`],
    enabled: !!invoiceId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading invoice details...</div>
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-1">Invoice not found</h3>
        <p className="text-muted-foreground text-sm">
          The requested imported invoice could not be loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="page-imported-invoice-detail">
      <div className="flex-shrink-0 bg-background border-b px-6 pt-6 pb-4">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="outline" size="sm" asChild data-testid="button-back">
            <Link href={backTarget}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <Badge variant="secondary" className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" data-testid="badge-historical-label">
            Historical Imported Invoice
          </Badge>
        </div>
        
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-invoice-title">
              {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : `Imported Invoice ${invoice.id.slice(0, 8)}`}
            </h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Info className="h-4 w-4" />
              This is a read-only historical record. It is not a purchase order or a confirmed physical receipt.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Vendor & Store</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-semibold text-lg" data-testid="text-vendor-name">{invoice.vendorName}</div>
              <div className="text-sm text-muted-foreground" data-testid="text-store-name">{invoice.storeName}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Invoice Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-semibold text-lg" data-testid="text-invoice-date">
                {formatDateString(invoice.invoiceDate) || invoice.invoiceDate}
              </div>
              <div className="text-sm text-muted-foreground" data-testid="text-approved-date">
                Approved: {invoice.approvedAt ? new Date(invoice.approvedAt).toLocaleDateString() : "—"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Source & File</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-semibold text-lg capitalize" data-testid="text-source-system">{invoice.sourceSystem || "—"}</div>
              <div className="text-sm text-muted-foreground truncate" title={invoice.originalFilename} data-testid="text-original-filename">
                {invoice.originalFilename || "—"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Financials</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-semibold text-lg" data-testid="text-total-amount">{formatCurrency(invoice.totalAmount)}</div>
              <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
                <span>Subtotal:</span>
                <span className="text-right" data-testid="text-subtotal">{formatCurrency(invoice.subtotal)}</span>
                <span>Tax:</span>
                <span className="text-right" data-testid="text-tax">{formatCurrency(invoice.taxAmount)}</span>
                <span>Charges:</span>
                <span className="text-right" data-testid="text-charges">{formatCurrency(invoice.chargeAmount)}</span>
                <span>Credits:</span>
                <span className="text-right" data-testid="text-credits">{formatCurrency(invoice.creditAmount)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Line Items ({invoice.lineCount})</CardTitle>
            <CardDescription>Read-only historical imported lines</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table wrapperClassName="border-t max-h-[600px]">
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Resolved Item</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Source GL</TableHead>
                  <TableHead>Source Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line, idx) => (
                  <TableRow key={line.id} data-testid={`row-line-${idx}`}>
                    <TableCell className="font-mono text-sm" data-testid={`text-item-code-${idx}`}>
                      {line.itemCode || "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={line.description || undefined} data-testid={`text-description-${idx}`}>
                      {line.description || "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={line.resolvedInventoryItemName || undefined} data-testid={`text-resolved-item-${idx}`}>
                      {line.resolvedInventoryItemName || "—"}
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-pack-${idx}`}>
                      {formatPack(line.pack)}
                    </TableCell>
                    <TableCell className="font-mono text-xs" data-testid={`text-source-gl-${idx}`}>
                      {line.sourceGlCode || "—"}
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-source-category-${idx}`}>
                      {line.sourceCategory || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-quantity-${idx}`}>
                      {line.quantity != null ? line.quantity : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-unit-price-${idx}`}>
                      {formatCurrency(line.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium" data-testid={`text-line-total-${idx}`}>
                      {formatCurrency(line.lineTotal)}
                    </TableCell>
                    <TableCell data-testid={`text-resolution-status-${idx}`}>
                      <Badge variant="outline" className="capitalize">
                        {line.resolutionStatus || "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
