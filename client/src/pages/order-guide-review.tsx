import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, AlertCircle, PlusCircle, ArrowLeft, Check, CheckCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';

interface OrderGuideLine {
  id: string;
  vendorSku: string;
  productName: string;
  packSize: string | null;
  uom: string | null;
  caseSize: number | null;
  price: number | null;
  matchStatus: string;
  matchedInventoryItemId: string | null;
  matchConfidence: number | null;
}

interface ReviewData {
  guide: {
    id: string;
    fileName: string | null;
    rowCount: number;
    status: string;
  };
  lines: {
    matched: OrderGuideLine[];
    ambiguous: OrderGuideLine[];
    new: OrderGuideLine[];
  };
  summary: {
    total: number;
    matched: number;
    ambiguous: number;
    new: number;
  };
}

export default function OrderGuideReview() {
  const [, params] = useRoute('/order-guides/:id/review');
  const { toast } = useToast();
  const orderGuideId = params?.id;

  // Track selected line IDs
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

  const { data: reviewData, isLoading } = useQuery<ReviewData>({
    queryKey: ['/api/order-guides', orderGuideId, 'review'],
    queryFn: async () => {
      const res = await fetch(`/api/order-guides/${orderGuideId}/review`);
      if (!res.ok) throw new Error('Failed to load order guide');
      return res.json();
    },
    enabled: !!orderGuideId,
  });

  // Select all items by default when data loads
  useMemo(() => {
    if (reviewData && selectedLineIds.size === 0) {
      const allLineIds = new Set<string>();
      reviewData.lines.matched.forEach(line => allLineIds.add(line.id));
      reviewData.lines.ambiguous.forEach(line => allLineIds.add(line.id));
      reviewData.lines.new.forEach(line => allLineIds.add(line.id));
      setSelectedLineIds(allLineIds);
    }
  }, [reviewData]);

  const approveMutation = useMutation({
    mutationFn: async ({ importAll }: { importAll: boolean }) => {
      const payload = importAll
        ? { importAll: true }
        : { selectedLineIds: Array.from(selectedLineIds) };
      
      return apiRequest('POST', `/api/order-guides/${orderGuideId}/approve`, payload);
    },
    onSuccess: (data: any) => {
      const inventoryMsg = data.inventoryItemsCreated > 0 
        ? `, ${data.inventoryItemsCreated} inventory items` 
        : '';
      toast({
        title: 'Order Guide Approved',
        description: `Created ${data.vendorItemsCreated} vendor items${inventoryMsg}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/vendors'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vendor-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory-items'] });
      window.history.back();
    },
    onError: (error: Error) => {
      toast({
        title: 'Approval Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleLineSelection = (lineId: string) => {
    setSelectedLineIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lineId)) {
        newSet.delete(lineId);
      } else {
        newSet.add(lineId);
      }
      return newSet;
    });
  };

  const selectAllInCategory = (lines: OrderGuideLine[]) => {
    setSelectedLineIds(prev => {
      const newSet = new Set(prev);
      lines.forEach(line => newSet.add(line.id));
      return newSet;
    });
  };

  const deselectAllInCategory = (lines: OrderGuideLine[]) => {
    setSelectedLineIds(prev => {
      const newSet = new Set(prev);
      lines.forEach(line => newSet.delete(line.id));
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-muted rounded"></div>
            <div className="h-24 bg-muted rounded"></div>
            <div className="h-24 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!reviewData) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Order guide not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const matchPercentage = Math.round((reviewData.summary.matched / reviewData.summary.total) * 100);
  const selectedCount = selectedLineIds.size;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.history.back()}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Review Order Guide</h1>
            <p className="text-sm text-muted-foreground">
              {reviewData.guide.fileName || 'Imported order guide'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => approveMutation.mutate({ importAll: true })}
            disabled={approveMutation.isPending}
            data-testid="button-import-all"
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            {approveMutation.isPending ? 'Importing...' : `Import All (${reviewData.summary.total})`}
          </Button>
          <Button
            onClick={() => approveMutation.mutate({ importAll: false })}
            disabled={approveMutation.isPending || selectedCount === 0}
            data-testid="button-import-selected"
          >
            <Check className="h-4 w-4 mr-2" />
            {approveMutation.isPending ? 'Importing...' : `Import Selected (${selectedCount})`}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reviewData.summary.total}</div>
            <p className="text-xs text-muted-foreground">Products in order guide</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Auto-Matched</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{reviewData.summary.matched}</div>
            <p className="text-xs text-muted-foreground">{matchPercentage}% match rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{reviewData.summary.ambiguous}</div>
            <p className="text-xs text-muted-foreground">Possible matches</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Items</CardTitle>
            <PlusCircle className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{reviewData.summary.new}</div>
            <p className="text-xs text-muted-foreground">Not in inventory</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs with grouped items */}
      <Tabs defaultValue="matched" className="space-y-4">
        <TabsList>
          <TabsTrigger value="matched" data-testid="tab-matched">
            Auto-Matched ({reviewData.summary.matched})
          </TabsTrigger>
          <TabsTrigger value="ambiguous" data-testid="tab-ambiguous">
            Needs Review ({reviewData.summary.ambiguous})
          </TabsTrigger>
          <TabsTrigger value="new" data-testid="tab-new">
            New Items ({reviewData.summary.new})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="matched" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Auto-Matched Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  These items were automatically matched with high confidence and will be linked to existing inventory items
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllInCategory(reviewData.lines.matched)}
                  data-testid="button-select-all-matched"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deselectAllInCategory(reviewData.lines.matched)}
                  data-testid="button-deselect-all-matched"
                >
                  Deselect All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable
                lines={reviewData.lines.matched}
                selectedLineIds={selectedLineIds}
                onToggleSelection={toggleLineSelection}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ambiguous" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Items Needing Review</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  These items have possible matches but need manual verification
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllInCategory(reviewData.lines.ambiguous)}
                  data-testid="button-select-all-ambiguous"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deselectAllInCategory(reviewData.lines.ambiguous)}
                  data-testid="button-deselect-all-ambiguous"
                >
                  Deselect All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable
                lines={reviewData.lines.ambiguous}
                selectedLineIds={selectedLineIds}
                onToggleSelection={toggleLineSelection}
                showConfidence
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>New Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  These items don't match any existing inventory. They will be created as new inventory items with smart defaults.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectAllInCategory(reviewData.lines.new)}
                  data-testid="button-select-all-new"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deselectAllInCategory(reviewData.lines.new)}
                  data-testid="button-deselect-all-new"
                >
                  Deselect All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable
                lines={reviewData.lines.new}
                selectedLineIds={selectedLineIds}
                onToggleSelection={toggleLineSelection}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrderGuideTable({
  lines,
  selectedLineIds,
  onToggleSelection,
  showConfidence = false,
}: {
  lines: OrderGuideLine[];
  selectedLineIds: Set<string>;
  onToggleSelection: (lineId: string) => void;
  showConfidence?: boolean;
}) {
  if (lines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No items in this category
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Vendor SKU</TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead>Pack Size</TableHead>
            <TableHead>Case Size</TableHead>
            <TableHead>Price</TableHead>
            {showConfidence && <TableHead>Match Confidence</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id} data-testid={`row-product-${line.id}`}>
              <TableCell>
                <Checkbox
                  checked={selectedLineIds.has(line.id)}
                  onCheckedChange={() => onToggleSelection(line.id)}
                  data-testid={`checkbox-${line.id}`}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">{line.vendorSku}</TableCell>
              <TableCell>{line.productName}</TableCell>
              <TableCell className="text-muted-foreground">{line.uom || '-'}</TableCell>
              <TableCell>
                {line.caseSize ?? '-'}
              </TableCell>
              <TableCell>
                {line.price ? `$${line.price.toFixed(2)}` : '-'}
              </TableCell>
              {showConfidence && (
                <TableCell>
                  <Badge variant={getConfidenceBadgeVariant(line.matchConfidence)}>
                    {line.matchConfidence ? `${line.matchConfidence}%` : 'N/A'}
                  </Badge>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function getConfidenceBadgeVariant(confidence: number | null): 'default' | 'secondary' | 'outline' {
  if (!confidence) return 'outline';
  if (confidence >= 70) return 'default';
  if (confidence >= 50) return 'secondary';
  return 'outline';
}
