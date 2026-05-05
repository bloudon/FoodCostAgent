import { useState, useRef, useEffect, Fragment } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  AlertCircle,
  FilePlus2,
  Loader2,
  ScanLine,
  Store,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useStoreContext } from '@/hooks/use-store-context';
import { ObjectUploader } from '@/components/ObjectUploader';

interface Vendor {
  id: string;
  name: string;
  active: number;
}

interface ScannedLine {
  id: string;
  vendorSku: string;
  productName: string;
  packSize: string | null;
  uom: string | null;
  price: number | null;
  matchStatus: 'matched' | 'ambiguous' | 'new';
  matchConfidence: number | null;
}

interface FirstScanResult {
  orderGuideId: string;
  totalItems: number;
  highConfidenceMatches: number;
  mediumConfidenceMatches: number;
  noMatches: number;
  detectedVendorName: string | null;
  detectedVendorId: string | null;
}

interface AppendResult {
  newLines: ScannedLine[];
  newItems: number;
  totalItems: number;
  pageNumber: number;
}

export default function OrderGuideScan() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { selectedStoreId, stores } = useStoreContext();

  const params = new URLSearchParams(search);
  const prefilledVendorId = params.get('vendorId') || '';
  const prefilledStoreId = params.get('storeId') || '';

  const [step, setStep] = useState<1 | 2>(1);
  const [vendorId, setVendorId] = useState<string>(prefilledVendorId || '__none__');
  const [storeIds, setStoreIds] = useState<string[]>(() => {
    if (prefilledStoreId) return [prefilledStoreId];
    if (selectedStoreId) return [selectedStoreId];
    return stores.map(s => s.id);
  });

  // Update storeIds when stores load (for initial render before context resolves)
  useEffect(() => {
    if (storeIds.length === 0 && stores.length > 0) {
      setStoreIds(stores.map(s => s.id));
    }
  }, [stores]);

  const [orderGuideId, setOrderGuideId] = useState<string | null>(null);
  const [lines, setLines] = useState<ScannedLine[]>([]);
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [showAddPageUploader, setShowAddPageUploader] = useState(false);

  const lastLinesRef = useRef<ScannedLine[]>(lines);
  useEffect(() => { lastLinesRef.current = lines; }, [lines]);

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors'],
  });

  const toggleStore = (id: string) => {
    setStoreIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // Step 1 → first scan
  const firstScanMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const res = await apiRequest('POST', '/api/order-guides/scan-image', {
        objectPath,
        vendorId: vendorId !== '__none__' ? vendorId : undefined,
        storeIds: storeIds.length > 0 ? storeIds : undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Scan failed');
      }
      return res.json() as Promise<FirstScanResult>;
    },
    onSuccess: async (data) => {
      setOrderGuideId(data.orderGuideId);
      setPageCount(1);

      // Fetch all lines from the review endpoint so we can display them
      try {
        const reviewRes = await fetch(`/api/order-guides/${data.orderGuideId}/review`, { credentials: 'include' });
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          const allLines: ScannedLine[] = [
            ...reviewData.lines.matched,
            ...reviewData.lines.ambiguous,
            ...reviewData.lines.new,
          ];
          setLines(allLines);
        }
      } catch {
        // Non-fatal — user can still proceed to review
      }

      // If vendor was auto-detected, update local state
      if (data.detectedVendorId && vendorId === '__none__') {
        setVendorId(data.detectedVendorId);
      }

      setStep(2);
      toast({
        title: 'Page 1 scanned',
        description: `Extracted ${data.totalItems} item${data.totalItems !== 1 ? 's' : ''} — ${data.highConfidenceMatches} auto-matched`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  // Append additional pages
  const appendMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      if (!orderGuideId) throw new Error('No active scan session');
      const res = await apiRequest('POST', `/api/order-guides/${orderGuideId}/append-scan`, {
        objectPath,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Scan failed');
      }
      return res.json() as Promise<AppendResult>;
    },
    onSuccess: (data) => {
      const insertionIndex = lastLinesRef.current.length;
      setLines(prev => [...prev, ...data.newLines]);
      if (data.newLines.length > 0) {
        setPageBreaks(prev => [...prev, insertionIndex]);
      }
      setPageCount(data.pageNumber);
      setShowAddPageUploader(false);
      toast({
        title: `Page ${data.pageNumber} scanned`,
        description: `Added ${data.newItems} item${data.newItems !== 1 ? 's' : ''} — ${data.totalItems} total`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  const matchedCount = lines.filter(l => l.matchStatus === 'matched').length;
  const ambiguousCount = lines.filter(l => l.matchStatus === 'ambiguous').length;
  const newCount = lines.filter(l => l.matchStatus === 'new').length;

  const steps = [
    { num: 1, label: 'Configure' },
    { num: 2, label: 'Review' },
  ];
  const stepNum = step;

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="p-4 space-y-4 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/vendors')} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Scan Invoice / Receipt</h1>
            <p className="text-sm text-muted-foreground">
              AI reads your vendor invoice and extracts product names, SKUs, and prices
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium border ${
                stepNum > s.num
                  ? 'bg-green-600 text-white border-green-600'
                  : stepNum === s.num
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-muted-foreground/40 text-muted-foreground'
              }`}>
                {stepNum > s.num ? <Check className="h-3 w-3" /> : s.num}
              </div>
              <span className={`text-sm hidden sm:block ${stepNum === s.num ? 'font-medium' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Configure + first image ── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Vendor selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vendor (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger data-testid="select-vendor">
                    <SelectValue placeholder="Select vendor (recommended)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No vendor / Unknown</SelectItem>
                    {vendors?.filter(v => v.active === 1).map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecting a vendor helps link extracted items to your order guide. AI will also try to detect the vendor from the invoice automatically.
                </p>
              </CardContent>
            </Card>

            {/* Store selection (only shown when multiple stores) */}
            {stores.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Apply to Stores
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {stores.map(store => (
                      <div key={store.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`store-${store.id}`}
                          checked={storeIds.includes(store.id)}
                          onCheckedChange={() => toggleStore(store.id)}
                          data-testid={`checkbox-store-${store.id}`}
                        />
                        <label htmlFor={`store-${store.id}`} className="text-sm cursor-pointer">
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
            )}

            {/* Upload first page */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ScanLine className="h-4 w-4" />
                  Upload First Page
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Take a clear photo of your invoice or receipt. Works best with well-lit, straight-on shots.
                  Scanning begins automatically after upload.
                </p>

                {firstScanMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin" />
                    <p className="font-medium">Scanning page 1 with AI…</p>
                    <p className="text-xs">This may take 10–20 seconds</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <ObjectUploader
                      onUploadComplete={(path) => {
                        if (storeIds.length === 0) {
                          toast({ title: 'Select a store', description: 'Please select at least one store before scanning.', variant: 'destructive' });
                          return;
                        }
                        firstScanMutation.mutate(path);
                      }}
                      buttonText="Select Invoice Image"
                      dataTestId="button-upload-invoice"
                      visibility="private"
                      icon={<ScanLine className="h-4 w-4" />}
                    />
                    <p className="text-xs text-muted-foreground">Supports JPG, PNG, WebP up to 10 MB</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Step 2: Results + additional pages ── */}
        {step === 2 && orderGuideId && (
          <div className="space-y-4">
            {/* Summary badges */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5 text-sm">
                <Badge variant="secondary">{pageCount} page{pageCount !== 1 ? 's' : ''}</Badge>
                <span className="text-muted-foreground">{lines.length} items extracted</span>
              </div>
              {matchedCount > 0 && (
                <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {matchedCount} matched
                </div>
              )}
              {ambiguousCount > 0 && (
                <div className="flex items-center gap-1 text-sm text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {ambiguousCount} needs review
                </div>
              )}
              {newCount > 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5" />
                  {newCount} unmatched
                </div>
              )}
            </div>

            {/* Lines table */}
            <Card>
              <CardContent className="p-0">
                {lines.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <p>No items were extracted. Try uploading a clearer image.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product Name</TableHead>
                          <TableHead className="hidden sm:table-cell">SKU</TableHead>
                          <TableHead className="hidden md:table-cell">Pack Size</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line, index) => (
                          <Fragment key={line.id}>
                            {pageBreaks.includes(index) && (
                              <TableRow className="pointer-events-none select-none" data-testid={`page-break-${index}`}>
                                <TableCell
                                  colSpan={5}
                                  className="py-1.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40"
                                >
                                  — Page {pageBreaks.indexOf(index) + 2} —
                                </TableCell>
                              </TableRow>
                            )}
                            <TableRow data-testid={`row-line-${index}`}>
                              <TableCell className="font-medium">{line.productName}</TableCell>
                              <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                                {line.vendorSku || '—'}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                                {line.packSize || '—'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {line.price != null ? `$${line.price.toFixed(2)}` : '—'}
                              </TableCell>
                              <TableCell>
                                {line.matchStatus === 'matched' ? (
                                  <Badge variant="secondary" className="text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 border-0">
                                    Matched
                                  </Badge>
                                ) : line.matchStatus === 'ambiguous' ? (
                                  <Badge variant="secondary" className="text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 border-0">
                                    Review
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-muted-foreground">
                                    New
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add another page */}
            {!showAddPageUploader ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddPageUploader(true)}
                disabled={appendMutation.isPending}
                data-testid="button-add-page"
              >
                <FilePlus2 className="h-4 w-4 mr-2" />
                Add Another Page
              </Button>
            ) : (
              <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium">Scan another page</p>
                <p className="text-xs text-muted-foreground">
                  Upload the next page of your invoice. Items will be appended below with a page-break divider.
                </p>
                {appendMutation.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning page {pageCount + 1} — this may take 10–20 seconds…
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <ObjectUploader
                      onUploadComplete={(path) => appendMutation.mutate(path)}
                      buttonText="Select Page Image"
                      dataTestId="button-upload-next-page"
                      visibility="private"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddPageUploader(false)}
                      data-testid="button-cancel-add-page"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setOrderGuideId(null);
                  setLines([]);
                  setPageBreaks([]);
                  setPageCount(0);
                  setShowAddPageUploader(false);
                }}
                data-testid="button-back-step1"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Start Over
              </Button>
              <Button
                onClick={() => navigate(`/order-guides/${orderGuideId}/review`)}
                disabled={lines.length === 0 || appendMutation.isPending}
                data-testid="button-review-commit"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Review & Commit ({lines.length} item{lines.length !== 1 ? 's' : ''})
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
