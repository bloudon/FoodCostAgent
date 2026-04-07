import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Store,
  ChevronDown,
  Building2,
  Plus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useStoreContext } from '@/hooks/use-store-context';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Vendor {
  id: string;
  name: string;
}

interface OrderGuideLine {
  id: string;
  vendorSku: string;
  productName: string;
  packSize: string | null;
  uom: string | null;
  caseSize: number | null;
  innerPack: number | null;
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
    vendorId: string | null;
    source: string | null;
    detectedVendorName: string | null;
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
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const orderGuideId = params?.id;
  const { stores, selectedStoreId } = useStoreContext();

  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [targetStoreIds, setTargetStoreIds] = useState<Set<string>>(new Set());
  const [isStoreSelectionOpen, setIsStoreSelectionOpen] = useState(false);

  const [currentVendorId, setCurrentVendorId] = useState<string | null>(null);
  const [vendorInitialized, setVendorInitialized] = useState(false);

  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');

  useEffect(() => {
    if (stores.length > 0 && targetStoreIds.size === 0) {
      setTargetStoreIds(new Set(stores.map(s => s.id)));
    }
  }, [stores]);

  const { data: reviewData, isLoading } = useQuery<ReviewData>({
    queryKey: ['/api/order-guides', orderGuideId, 'review'],
    queryFn: async () => {
      const res = await fetch(`/api/order-guides/${orderGuideId}/review`);
      if (!res.ok) throw new Error('Failed to load order guide');
      return res.json();
    },
    enabled: !!orderGuideId,
  });

  useEffect(() => {
    if (reviewData && !vendorInitialized) {
      setCurrentVendorId(reviewData.guide.vendorId ?? null);
      setVendorInitialized(true);
    }
  }, [reviewData, vendorInitialized]);

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors'],
    queryFn: async () => {
      const res = await fetch('/api/vendors');
      if (!res.ok) throw new Error('Failed to load vendors');
      return res.json();
    },
  });

  useMemo(() => {
    if (reviewData && selectedLineIds.size === 0) {
      const allLineIds = new Set<string>();
      reviewData.lines.matched.forEach(line => allLineIds.add(line.id));
      reviewData.lines.ambiguous.forEach(line => allLineIds.add(line.id));
      reviewData.lines.new.forEach(line => allLineIds.add(line.id));
      setSelectedLineIds(allLineIds);
    }
  }, [reviewData]);

  const vendorMutation = useMutation({
    mutationFn: async ({ vendorId, previousVendorId }: { vendorId: string | null; previousVendorId: string | null }) => {
      return apiRequest('PATCH', `/api/order-guides/${orderGuideId}/vendor`, { vendorId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/order-guides', orderGuideId, 'review'] });
    },
    onError: (error: Error, variables) => {
      setCurrentVendorId(variables.previousVendorId);
      toast({
        title: 'Vendor update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const addVendorMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', '/api/vendors', { name });
      return res.json() as Promise<Vendor>;
    },
    onSuccess: async (newVendor: Vendor) => {
      await queryClient.invalidateQueries({ queryKey: ['/api/vendors'] });
      setCurrentVendorId(newVendor.id);
      vendorMutation.mutate({ vendorId: newVendor.id, previousVendorId: null });
      setIsAddVendorOpen(false);
      setNewVendorName('');
      toast({ title: 'Vendor created', description: `"${newVendor.name}" added and linked to this import.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create vendor', description: error.message, variant: 'destructive' });
    },
  });

  const handleOpenAddVendor = () => {
    setNewVendorName(reviewData?.guide.detectedVendorName ?? '');
    setIsAddVendorOpen(true);
  };

  const handleVendorChange = (value: string) => {
    const newVendorId = value === '__none__' ? null : value;
    const previousVendorId = currentVendorId;
    setCurrentVendorId(newVendorId);
    vendorMutation.mutate({ vendorId: newVendorId, previousVendorId });
  };

  const approveMutation = useMutation({
    mutationFn: async ({ importAll }: { importAll: boolean }) => {
      const payload = {
        ...(importAll ? { importAll: true } : { selectedLineIds: Array.from(selectedLineIds) }),
        targetStoreIds: Array.from(targetStoreIds),
      };
      return apiRequest('POST', `/api/order-guides/${orderGuideId}/approve`, payload);
    },
    onSuccess: (data: any) => {
      const inventoryMsg = data.inventoryItemsCreated > 0
        ? `, ${data.inventoryItemsCreated} inventory item${data.inventoryItemsCreated !== 1 ? 's' : ''}`
        : '';
      const storeMsg = data.storeAssignmentsCreated > 0
        ? ` across ${targetStoreIds.size} store${targetStoreIds.size > 1 ? 's' : ''}`
        : '';
      toast({
        title: 'Import complete',
        description: `Created ${data.vendorItemsCreated} vendor item${data.vendorItemsCreated !== 1 ? 's' : ''}${inventoryMsg}${storeMsg}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/vendors'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vendor-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/store-inventory-items'] });
      if (currentVendorId) {
        navigate(`/vendors/${currentVendorId}`);
      } else {
        navigate('/vendors');
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleTargetStore = (storeId: string) => {
    setTargetStoreIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(storeId)) {
        if (newSet.size > 1) newSet.delete(storeId);
      } else {
        newSet.add(storeId);
      }
      return newSet;
    });
  };

  const selectAllTargetStores = () => setTargetStoreIds(new Set(stores.map(s => s.id)));

  const selectCurrentStoreOnly = () => {
    if (selectedStoreId) setTargetStoreIds(new Set([selectedStoreId]));
  };

  const toggleLineSelection = (lineId: string) => {
    setSelectedLineIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lineId)) newSet.delete(lineId);
      else newSet.add(lineId);
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

  const matchPercentage = reviewData.summary.total > 0
    ? Math.round((reviewData.summary.matched / reviewData.summary.total) * 100)
    : 0;
  const selectedCount = selectedLineIds.size;
  const newSelectedCount = reviewData.lines.new.filter(l => selectedLineIds.has(l.id)).length;
  const isImageScan = reviewData.guide.source === 'image_scan';
  const noVendorWarning = isImageScan && !currentVendorId;
  const selectedVendorName = vendors?.find(v => v.id === currentVendorId)?.name;

  const confirmSummary = [
    `${selectedCount} item${selectedCount !== 1 ? 's' : ''} selected`,
    newSelectedCount > 0 ? `${newSelectedCount} new` : null,
    `${targetStoreIds.size} store${targetStoreIds.size !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="p-6 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
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
            <h1 className="text-2xl font-bold">Review Import</h1>
            <p className="text-sm text-muted-foreground">
              {reviewData.guide.fileName || 'Imported order guide'}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 items-end">
          {stores.length > 1 && (
            <Collapsible open={isStoreSelectionOpen} onOpenChange={setIsStoreSelectionOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-select-stores">
                  <Store className="h-4 w-4" />
                  Import to {targetStoreIds.size} of {stores.length} stores
                  <ChevronDown className={`h-4 w-4 transition-transform ${isStoreSelectionOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Target Stores</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={selectAllTargetStores} data-testid="button-select-all-stores">All</Button>
                        <Button variant="ghost" size="sm" onClick={selectCurrentStoreOnly} data-testid="button-select-current-store">Current Only</Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {stores.map(store => (
                        <div key={store.id} className="flex items-center gap-2" data-testid={`store-checkbox-${store.id}`}>
                          <Checkbox
                            id={`target-store-${store.id}`}
                            checked={targetStoreIds.has(store.id)}
                            onCheckedChange={() => toggleTargetStore(store.id)}
                            disabled={targetStoreIds.size === 1 && targetStoreIds.has(store.id)}
                          />
                          <label htmlFor={`target-store-${store.id}`} className="text-sm cursor-pointer flex-1">
                            {store.name}
                            {store.id === selectedStoreId && (
                              <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Secondary import buttons (keep as escape hatch) */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => approveMutation.mutate({ importAll: true })}
              disabled={approveMutation.isPending || targetStoreIds.size === 0}
              data-testid="button-import-all"
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              {approveMutation.isPending ? 'Importing…' : `Import All (${reviewData.summary.total})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => approveMutation.mutate({ importAll: false })}
              disabled={approveMutation.isPending || selectedCount === 0 || targetStoreIds.size === 0}
              data-testid="button-import-selected"
            >
              <Check className="h-4 w-4 mr-2" />
              {approveMutation.isPending ? 'Importing…' : `Import Selected (${selectedCount})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Vendor Assignment Card */}
      <Card className={noVendorWarning ? 'border-yellow-500/60' : ''}>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium shrink-0">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span>Vendor</span>
            </div>
            <Select
              value={currentVendorId ?? '__none__'}
              onValueChange={handleVendorChange}
              disabled={vendorMutation.isPending || addVendorMutation.isPending}
            >
              <SelectTrigger className="w-56" data-testid="select-vendor">
                <SelectValue placeholder="Select existing vendor…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No vendor assigned</SelectItem>
                {(vendors ?? []).map(vendor => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenAddVendor}
              disabled={addVendorMutation.isPending}
              data-testid="button-add-new-vendor"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add New Vendor
            </Button>
            {currentVendorId && selectedVendorName && (
              <Badge variant="secondary" data-testid="badge-vendor-name">
                {selectedVendorName}
              </Badge>
            )}
            {isImageScan && currentVendorId && !noVendorWarning && (
              <span className="text-xs text-muted-foreground">Auto-detected from invoice</span>
            )}
          </div>

          {noVendorWarning && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3">
              <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
                Vendor not recognized from your invoice — select an existing vendor or add a new one to link pricing data.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reviewData.summary.total}</div>
            <p className="text-xs text-muted-foreground">Products in import</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Auto-Matched</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{reviewData.summary.matched}</div>
            <p className="text-xs text-muted-foreground">{matchPercentage}% match rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{reviewData.summary.ambiguous}</div>
            <p className="text-xs text-muted-foreground">Possible matches</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Items</CardTitle>
            <PlusCircle className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{reviewData.summary.new}</div>
            <p className="text-xs text-muted-foreground">Not in inventory</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
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
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Auto-Matched Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Matched with high confidence and linked to existing inventory items
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => selectAllInCategory(reviewData.lines.matched)} data-testid="button-select-all-matched">Select All</Button>
                <Button variant="outline" size="sm" onClick={() => deselectAllInCategory(reviewData.lines.matched)} data-testid="button-deselect-all-matched">Deselect All</Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable lines={reviewData.lines.matched} selectedLineIds={selectedLineIds} onToggleSelection={toggleLineSelection} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ambiguous" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Items Needing Review</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Possible matches that need manual verification
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => selectAllInCategory(reviewData.lines.ambiguous)} data-testid="button-select-all-ambiguous">Select All</Button>
                <Button variant="outline" size="sm" onClick={() => deselectAllInCategory(reviewData.lines.ambiguous)} data-testid="button-deselect-all-ambiguous">Deselect All</Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable lines={reviewData.lines.ambiguous} selectedLineIds={selectedLineIds} onToggleSelection={toggleLineSelection} showConfidence />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>New Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Not in inventory — will be created as new inventory items with smart defaults.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => selectAllInCategory(reviewData.lines.new)} data-testid="button-select-all-new">Select All</Button>
                <Button variant="outline" size="sm" onClick={() => deselectAllInCategory(reviewData.lines.new)} data-testid="button-deselect-all-new">Deselect All</Button>
              </div>
            </CardHeader>
            <CardContent>
              <OrderGuideTable lines={reviewData.lines.new} selectedLineIds={selectedLineIds} onToggleSelection={toggleLineSelection} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky Confirm Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground" data-testid="text-confirm-summary">
            {confirmSummary}
            {selectedVendorName && (
              <span className="ml-2 font-medium text-foreground">→ {selectedVendorName}</span>
            )}
          </p>
          <Button
            onClick={() => approveMutation.mutate({ importAll: false })}
            disabled={approveMutation.isPending || selectedCount === 0 || targetStoreIds.size === 0}
            data-testid="button-confirm-import"
          >
            <Check className="h-4 w-4 mr-2" />
            {approveMutation.isPending ? 'Importing…' : `Confirm & Import (${selectedCount})`}
          </Button>
        </div>
      </div>

      {/* Add New Vendor Dialog */}
      <Dialog open={isAddVendorOpen} onOpenChange={setIsAddVendorOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-vendor">
          <DialogHeader>
            <DialogTitle>Add New Vendor</DialogTitle>
            <DialogDescription>
              {reviewData.guide.detectedVendorName
                ? `AI detected "${reviewData.guide.detectedVendorName}" from your invoice. Confirm or adjust the name below.`
                : 'Enter a name for the new vendor to link to this import.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-vendor-name">Vendor Name</Label>
            <Input
              id="new-vendor-name"
              value={newVendorName}
              onChange={e => setNewVendorName(e.target.value)}
              placeholder="e.g. Sysco, US Foods…"
              onKeyDown={e => {
                if (e.key === 'Enter' && newVendorName.trim()) {
                  addVendorMutation.mutate(newVendorName.trim());
                }
              }}
              data-testid="input-new-vendor-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddVendorOpen(false)} data-testid="button-cancel-add-vendor">
              Cancel
            </Button>
            <Button
              onClick={() => addVendorMutation.mutate(newVendorName.trim())}
              disabled={!newVendorName.trim() || addVendorMutation.isPending}
              data-testid="button-confirm-add-vendor"
            >
              {addVendorMutation.isPending ? 'Creating…' : 'Add Vendor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    return <div className="text-center py-8 text-muted-foreground">No items in this category</div>;
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
              <TableCell className="text-muted-foreground">
                {line.innerPack ? `${line.innerPack} ${line.uom || ''}`.trim() : (line.uom || '-')}
              </TableCell>
              <TableCell>{line.caseSize ?? '-'}</TableCell>
              <TableCell>{line.price ? `$${line.price.toFixed(2)}` : '-'}</TableCell>
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
