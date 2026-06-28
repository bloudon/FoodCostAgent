import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
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
import {
  computeMatchCounts,
  getPageBreakLabel,
  buildReviewUrl,
  mergeAppendedLines,
} from '@/lib/orderGuideScanUtils';

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
  priceSource?: 'unit' | 'case' | null;
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
  // ogId persists in URL for refresh-safety (mirrors sessionId pattern in menu-import)
  const urlOrderGuideId = params.get('ogId') || '';

  const [step, setStep] = useState<1 | 2>(urlOrderGuideId ? 2 : 1);
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

  const [orderGuideId, setOrderGuideId] = useState<string | null>(urlOrderGuideId || null);
  const [lines, setLines] = useState<ScannedLine[]>([]);
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [showAddPageUploader, setShowAddPageUploader] = useState(false);

  // Multi-page upload state: paths queued for sequential append after first scan
  const [queuedPaths, setQueuedPaths] = useState<string[]>([]);
  const [multiTotal, setMultiTotal] = useState(0);
  const [scanningPage, setScanningPage] = useState<number | null>(null);

  // Keep a ref so async callbacks can access current queued paths without stale closure
  const queuedPathsRef = useRef<string[]>([]);
  useEffect(() => { queuedPathsRef.current = queuedPaths; }, [queuedPaths]);

  const storeIdsRef = useRef<string[]>(storeIds);
  useEffect(() => { storeIdsRef.current = storeIds; }, [storeIds]);

  const lastLinesRef = useRef<ScannedLine[]>(lines);
  useEffect(() => { lastLinesRef.current = lines; }, [lines]);

  const pageBreaksRef = useRef<number[]>(pageBreaks);
  useEffect(() => { pageBreaksRef.current = pageBreaks; }, [pageBreaks]);

  // Update URL when orderGuideId changes (for refresh-safety)
  useEffect(() => {
    if (orderGuideId) {
      const newParams = new URLSearchParams(search);
      newParams.set('ogId', orderGuideId);
      navigate(`/order-guide-scan?${newParams.toString()}`, { replace: true });
    }
  }, [orderGuideId]);

  // Rehydrate lines from server if returning with ogId in URL (refresh-safe)
  const { data: rehydrateData } = useQuery({
    queryKey: ['/api/order-guides', urlOrderGuideId, 'review'],
    enabled: !!urlOrderGuideId && lines.length === 0,
    queryFn: async () => {
      const res = await fetch(`/api/order-guides/${urlOrderGuideId}/review`, { credentials: 'include' });
      if (!res.ok) throw new Error('Session not found');
      return res.json() as Promise<{
        guide: { rowCount: number; fileName: string | null };
        lines: { matched: ScannedLine[]; ambiguous: ScannedLine[]; new: ScannedLine[] };
      }>;
    },
  });

  useEffect(() => {
    if (!rehydrateData) return;
    if (lines.length > 0) return; // already populated
    const allLines: ScannedLine[] = [
      ...rehydrateData.lines.matched,
      ...rehydrateData.lines.ambiguous,
      ...rehydrateData.lines.new,
    ];
    setLines(allLines);
    // Infer page count from filename if available
    if (rehydrateData.guide.fileName) {
      const m = rehydrateData.guide.fileName.match(/\((\d+)\s+pages?\)/i);
      if (m) setPageCount(parseInt(m[1], 10));
      else setPageCount(1);
    } else {
      setPageCount(1);
    }
    setStep(2);
  }, [rehydrateData]);

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors'],
  });

  const toggleStore = (id: string) => {
    setStoreIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // Low-level append helper — bypasses appendMutation so it can be called with
  // an explicit orderGuideId before React state has settled.
  const appendPageDirect = useCallback(async (
    ogId: string,
    objectPath: string,
    currentLines: ScannedLine[],
    currentBreaks: number[],
    currentPageCount: number,
  ): Promise<{ lines: ScannedLine[]; breaks: number[]; pageCount: number }> => {
    const res = await apiRequest('POST', `/api/order-guides/${ogId}/append-scan`, {
      objectPath,
      storeIds: storeIdsRef.current.length > 0 ? storeIdsRef.current : undefined,
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Scan failed');
    }
    const data = await res.json() as AppendResult;
    const { lines: merged, pageBreaks: newBreaks } = mergeAppendedLines(currentLines, currentBreaks, data.newLines);
    return { lines: merged, breaks: newBreaks, pageCount: data.pageNumber };
  }, []);

  const [isPdfProcessing, setIsPdfProcessing] = useState(false);

  // Step 1 → PDF catalog import (text extraction, no AI Vision)
  const processPdfMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const res = await apiRequest('POST', '/api/order-guides/process-pdf', {
        objectPath,
        vendorId: vendorId !== '__none__' ? vendorId : undefined,
        storeIds: storeIds.length > 0 ? storeIds : undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'PDF import failed');
      }
      return res.json() as Promise<FirstScanResult & { pageCount?: number }>;
    },
    onSuccess: async (data) => {
      setIsPdfProcessing(false);
      const ogId = data.orderGuideId;
      setOrderGuideId(ogId);
      setPageCount(data.pageCount ?? 1);

      let currentLines: ScannedLine[] = [];
      try {
        const reviewRes = await fetch(`/api/order-guides/${ogId}/review`, { credentials: 'include' });
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          currentLines = [
            ...reviewData.lines.matched,
            ...reviewData.lines.ambiguous,
            ...reviewData.lines.new,
          ];
          setLines(currentLines);
          lastLinesRef.current = currentLines;
        }
      } catch { /* non-fatal */ }

      toast({
        title: 'PDF imported',
        description: `Extracted ${data.totalItems} item${data.totalItems !== 1 ? 's' : ''} from ${data.pageCount ?? 1} page${(data.pageCount ?? 1) !== 1 ? 's' : ''} — ${data.highConfidenceMatches} auto-matched`,
      });
      setStep(2);
    },
    onError: (err: Error) => {
      setIsPdfProcessing(false);
      toast({ title: 'PDF import failed', description: err.message, variant: 'destructive' });
    },
  });

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
      const ogId = data.orderGuideId;
      setOrderGuideId(ogId);
      setPageCount(1);

      // Fetch all lines from the review endpoint so we can display them
      let currentLines: ScannedLine[] = [];
      try {
        const reviewRes = await fetch(`/api/order-guides/${ogId}/review`, { credentials: 'include' });
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          currentLines = [
            ...reviewData.lines.matched,
            ...reviewData.lines.ambiguous,
            ...reviewData.lines.new,
          ];
          setLines(currentLines);
          lastLinesRef.current = currentLines;
        }
      } catch {
        // Non-fatal — user can still proceed to review
      }

      // If vendor was auto-detected, update local state
      if (data.detectedVendorId && vendorId === '__none__') {
        setVendorId(data.detectedVendorId);
      }

      // Process queued pages sequentially (multi-image upload)
      const queued = queuedPathsRef.current;
      if (queued.length > 0) {
        let accLines = currentLines;
        let accBreaks: number[] = [];
        let accPageCount = 1;
        for (let i = 0; i < queued.length; i++) {
          setScanningPage(i + 2);
          try {
            const result = await appendPageDirect(ogId, queued[i], accLines, accBreaks, accPageCount);
            accLines = result.lines;
            accBreaks = result.breaks;
            accPageCount = result.pageCount;
            setLines([...accLines]);
            setPageBreaks([...accBreaks]);
            setPageCount(accPageCount);
            lastLinesRef.current = accLines;
            pageBreaksRef.current = accBreaks;
          } catch (err: any) {
            toast({
              title: `Page ${i + 2} scan failed`,
              description: err.message,
              variant: 'destructive',
            });
          }
        }
        setQueuedPaths([]);
        setScanningPage(null);
        toast({
          title: `${queued.length + 1} pages scanned`,
          description: `Extracted ${accLines.length} item${accLines.length !== 1 ? 's' : ''} total`,
        });
      } else {
        toast({
          title: 'Page 1 scanned',
          description: `Extracted ${data.totalItems} item${data.totalItems !== 1 ? 's' : ''} — ${data.highConfidenceMatches} auto-matched`,
        });
      }

      setStep(2);
    },
    onError: (err: Error) => {
      setQueuedPaths([]);
      setScanningPage(null);
      setMultiTotal(0);
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  // Append additional pages (manual "Add Another Page" button)
  const appendMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      if (!orderGuideId) throw new Error('No active scan session');
      const endpoint = isPdf(objectPath)
        ? `/api/order-guides/${orderGuideId}/append-pdf`
        : `/api/order-guides/${orderGuideId}/append-scan`;
      const res = await apiRequest('POST', endpoint, {
        objectPath,
        // Pass wizard storeIds so matching context is consistent across all pages
        storeIds: storeIds.length > 0 ? storeIds : undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Scan failed');
      }
      return res.json() as Promise<AppendResult>;
    },
    onSuccess: (data) => {
      const { lines: merged, pageBreaks: newBreaks } = mergeAppendedLines(
        lastLinesRef.current,
        pageBreaks,
        data.newLines
      );
      setLines(merged);
      setPageBreaks(newBreaks);
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

  const isPdf = (path: string, file?: File): boolean => {
    if (file?.type === 'application/pdf') return true;
    return path.toLowerCase().includes('.pdf');
  };

  // Handler for multi-image upload on Step 1
  const handleMultiUpload = useCallback((paths: string[], files?: File[]) => {
    if (storeIds.length === 0) {
      toast({ title: 'Select a store', description: 'Please select at least one store before scanning.', variant: 'destructive' });
      return;
    }
    if (paths.length === 0) return;

    // If the first file is a PDF, route through the text-extraction pipeline
    if (isPdf(paths[0], files?.[0])) {
      setIsPdfProcessing(true);
      processPdfMutation.mutate(paths[0]);
      return;
    }

    const [first, ...rest] = paths;
    setMultiTotal(paths.length);
    setScanningPage(1);
    if (rest.length > 0) {
      setQueuedPaths(rest);
      queuedPathsRef.current = rest;
    }
    firstScanMutation.mutate(first);
  }, [storeIds, firstScanMutation, processPdfMutation, toast]);

  const { matched: matchedCount, ambiguous: ambiguousCount, newItems: newCount } = computeMatchCounts(lines);

  const steps = [
    { num: 1, label: 'Configure' },
    { num: 2, label: 'Review' },
  ];
  const stepNum = step;

  // Scanning in progress (either first scan or multi-page queue)
  const isScanning = firstScanMutation.isPending || scanningPage !== null;
  const scanProgressLabel = isPdfProcessing
    ? 'Extracting products from PDF…'
    : isScanning
    ? (multiTotal > 1
        ? `Scanning page ${scanningPage ?? 1} of ${multiTotal} — this may take 10–20 seconds each`
        : 'Scanning page 1 with AI…')
    : null;

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="p-4 space-y-4 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/vendors')} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Import Order Guide</h1>
            <p className="text-sm text-muted-foreground">
              Upload a PDF catalog or photo of an invoice — AI extracts product names, SKUs, and prices
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
                  Upload Invoice or Catalog
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upload a PDF catalog or a photo of your invoice. Multi-page PDFs are imported in one go — no need to export pages separately.
                </p>

                {(isScanning || isPdfProcessing) ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin" />
                    <p className="font-medium">{scanProgressLabel}</p>
                    {!isPdfProcessing && multiTotal > 1 && (
                      <div className="w-full max-w-xs bg-muted rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full transition-all"
                          style={{ width: `${((scanningPage ?? 1) / multiTotal) * 100}%` }}
                        />
                      </div>
                    )}
                    {!isPdfProcessing && <p className="text-xs">This may take 10–20 seconds per page</p>}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <ObjectUploader
                      multiple
                      accept="image/*,application/pdf"
                      onUploadComplete={(path, file) => {
                        if (storeIds.length === 0) {
                          toast({ title: 'Select a store', description: 'Please select at least one store before scanning.', variant: 'destructive' });
                          return;
                        }
                        handleMultiUpload([path], file ? [file] : undefined);
                      }}
                      onMultipleUploadsComplete={(paths, files) => handleMultiUpload(paths, files)}
                      buttonText="Select Invoice or PDF Catalog"
                      dataTestId="button-upload-invoice"
                      visibility="private"
                      icon={<ScanLine className="h-4 w-4" />}
                    />
                    <p className="text-xs text-muted-foreground">PDF catalogs or JPG/PNG/WebP images up to 20 MB — multi-page PDFs supported</p>
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
                            {getPageBreakLabel(pageBreaks, index) && (
                              <TableRow className="pointer-events-none select-none" data-testid={`page-break-${index}`}>
                                <TableCell
                                  colSpan={5}
                                  className="py-1.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40"
                                >
                                  {getPageBreakLabel(pageBreaks, index)}
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
                                {line.price != null ? (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span>${line.price.toFixed(2)}</span>
                                    {line.priceSource === 'case' && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 no-default-active-elevate"
                                        title="The AI extracted a case price from this invoice. Verify the per-unit cost before committing."
                                      >
                                        case price
                                      </Badge>
                                    )}
                                    {line.priceSource === 'unit' && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] px-1.5 py-0 border-blue-400 text-blue-600 dark:text-blue-400 no-default-active-elevate"
                                        title="The AI extracted a per-unit price from this invoice. Case price was not available."
                                      >
                                        unit price
                                      </Badge>
                                    )}
                                  </div>
                                ) : '—'}
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
                  Upload the next page as an image or PDF. Items will be appended below with a page-break divider.
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
                      accept="image/*,application/pdf"
                      buttonText="Select Image or PDF"
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
                  // Clear ogId from URL so a refresh doesn't reload the old session
                  const resetParams = new URLSearchParams();
                  if (prefilledVendorId) resetParams.set('vendorId', prefilledVendorId);
                  const qs = resetParams.toString();
                  navigate(`/order-guide-scan${qs ? `?${qs}` : ''}`, { replace: true });
                }}
                data-testid="button-back-step1"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Start Over
              </Button>
              <Button
                onClick={() => navigate(buildReviewUrl(orderGuideId!))}
                disabled={!orderGuideId || appendMutation.isPending}
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
