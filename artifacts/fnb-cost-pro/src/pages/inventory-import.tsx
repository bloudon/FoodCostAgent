import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Wand2,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Check,
  CheckCheck,
  Store,
  ChevronDown,
  FileText,
  Sparkles,
  Info,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useStoreContext } from '@/hooks/use-store-context';
import { TierGate } from '@/components/tier-gate';

interface ColumnMapping {
  productName: string;
  vendorSku: string;
  price: string;
  caseSize: string;
  innerPack: string;
  unit: string;
  category: string;
  brand: string;
  upc: string;
  description: string;
}

interface MappingProposal {
  mapping: ColumnMapping;
  confidence: Record<keyof ColumnMapping, number>;
  headers: string[];
}

interface ImportLine {
  id: string;
  vendorSku: string;
  productName: string;
  canonicalName: string | null;
  packSize: string | null;
  uom: string | null;
  caseSize: number | null;
  price: number | null;
  matchStatus: string;
  matchedInventoryItemId: string | null;
  matchedInventoryItemName: string | null;
  matchConfidence: number | null;
  brandName: string | null;
  category: string | null;
}

interface PreviewResult {
  orderGuideId: string;
  summary: {
    total: number;
    matched: number;
    ambiguous: number;
    new: number;
  };
  review: {
    guide: { id: string; fileName: string | null; rowCount: number; status: string };
    lines: {
      matched: ImportLine[];
      ambiguous: ImportLine[];
      new: ImportLine[];
    };
    summary: { total: number; matched: number; ambiguous: number; new: number };
  };
}

type Vendor = { id: string; name: string };
type CompanyStore = { id: string; name: string };
type InventoryItem = { id: string; name: string };

const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  productName: 'Product Name',
  vendorSku: 'Item Code / SKU',
  price: 'Case Price',
  caseSize: 'Pack Size / Case Qty',
  innerPack: 'Inner Pack / Each Size',
  unit: 'Unit of Measure',
  category: 'Category',
  brand: 'Brand',
  upc: 'UPC / Barcode',
  description: 'Description',
};

const REQUIRED_FIELDS: (keyof ColumnMapping)[] = ['productName'];

export default function InventoryImport() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { stores, selectedStoreId } = useStoreContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 'done'>(1);
  const [importAllMode, setImportAllMode] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('none');
  const [mapping, setMapping] = useState<ColumnMapping>({
    productName: '',
    vendorSku: '',
    price: '',
    caseSize: '',
    innerPack: '',
    unit: '',
    category: '',
    brand: '',
    upc: '',
    description: '',
  });
  const [headers, setHeaders] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [targetStoreIds, setTargetStoreIds] = useState<Set<string>>(new Set());
  const [isStoreSelectionOpen, setIsStoreSelectionOpen] = useState(false);
  /** Per-line overrides: lineId → inventoryItemId or 'new' */
  const [lineOverrides, setLineOverrides] = useState<Record<string, string>>({});
  /** Per-line vendor overrides: lineId → vendorId */
  const [vendorOverrides, setVendorOverrides] = useState<Record<string, string>>({});

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors'],
  });

  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory-items'],
  });

  useEffect(() => {
    if (stores.length > 0 && targetStoreIds.size === 0) {
      setTargetStoreIds(new Set(stores.map((s) => s.id)));
    }
  }, [stores]);

  const analyzeMutation = useMutation({
    mutationFn: async (csv: string) => {
      const res = await apiRequest('POST', '/api/inventory-import/analyze', { csvContent: csv });
      return res.json() as Promise<MappingProposal>;
    },
    onSuccess: (data) => {
      setMapping({ ...data.mapping } as ColumnMapping);
      setHeaders(data.headers || []);
      setConfidence((data.confidence as Record<string, number>) || {});
      setStep(2);
    },
    onError: (err: Error) => {
      toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/inventory-import/preview', {
        csvContent,
        columnMapping: mapping,
        vendorId: selectedVendorId === 'none' ? null : selectedVendorId,
        fileName,
        useAiNormalization: true,
      });
      return res.json() as Promise<PreviewResult>;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      // Pre-select all lines
      const allIds = new Set<string>();
      data.review.lines.matched.forEach((l) => allIds.add(l.id));
      data.review.lines.ambiguous.forEach((l) => allIds.add(l.id));
      data.review.lines.new.forEach((l) => allIds.add(l.id));
      setSelectedLineIds(allIds);
      setStep(3);
    },
    onError: (err: Error) => {
      toast({ title: 'Preview Failed', description: err.message, variant: 'destructive' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ importAll }: { importAll: boolean }) => {
      if (!previewResult) throw new Error('No preview data');
      const payload = {
        ...(importAll ? { importAll: true } : { selectedLineIds: Array.from(selectedLineIds) }),
        targetStoreIds: Array.from(targetStoreIds),
        ...(Object.keys(lineOverrides).length > 0 ? { lineOverrides } : {}),
        ...(Object.keys(vendorOverrides).length > 0 ? { vendorOverrides } : {}),
      };
      const res = await apiRequest('POST', `/api/inventory-import/${previewResult.orderGuideId}/approve`, payload);
      return res.json();
    },
    onSuccess: (data: { inventoryItemsCreated?: number; vendorItemsCreated?: number }) => {
      const storeMsg = targetStoreIds.size > 1 ? ` across ${targetStoreIds.size} stores` : '';
      toast({
        title: 'Import Complete',
        description: `${(data.inventoryItemsCreated || 0) + (data.vendorItemsCreated || 0)} items imported${storeMsg}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vendor-items'] });
      setStep('done');
    },
    onError: (err: Error) => {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvContent(text);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = () => {
    if (!csvContent) {
      toast({ title: 'No file selected', description: 'Please upload a CSV file first.', variant: 'destructive' });
      return;
    }
    analyzeMutation.mutate(csvContent);
  };

  const toggleLineSelection = (id: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInGroup = (lines: ImportLine[]) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      lines.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const deselectAllInGroup = (lines: ImportLine[]) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      lines.forEach((l) => next.delete(l.id));
      return next;
    });
  };

  const toggleTargetStore = (storeId: string) => {
    setTargetStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        if (next.size > 1) next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  const canProceedStep1 = !!csvContent;
  const canProceedStep2 = !!mapping.productName;

  // Step indicator (4 real steps + 'done' state)
  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Map Columns' },
    { num: 3, label: 'Review' },
    { num: 4, label: 'Confirm' },
  ];
  const stepNum = step === 'done' ? 5 : step;

  return (
    <TierGate feature="recipe_costing">
      <div className="h-full overflow-auto pb-4">
        <div className="p-4 space-y-4 max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/inventory-items')} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Import Inventory from CSV</h1>
              <p className="text-sm text-muted-foreground">Upload any CSV or spreadsheet export — AI will map the columns and match existing items</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium border ${
                    stepNum > s.num
                      ? 'bg-green-600 text-white border-green-600'
                      : stepNum === s.num
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-muted-foreground/40 text-muted-foreground'
                  }`}
                >
                  {stepNum > s.num ? <Check className="h-3 w-3" /> : s.num}
                </div>
                <span className={`text-sm hidden sm:block ${stepNum === s.num ? 'font-medium' : 'text-muted-foreground'}`}>{s.label}</span>
                {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            ))}
          </div>

          {/* Step 1: Upload */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Upload CSV File
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upload any CSV file from your vendor, internal spreadsheet, or accounting system. 
                  AI will automatically detect which columns contain product names, prices, and pack sizes.
                </p>

                {/* File upload area */}
                <div
                  className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="file-drop-zone"
                >
                  <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  {csvContent ? (
                    <div>
                      <p className="font-medium text-green-600 dark:text-green-400">{fileName}</p>
                      <p className="text-sm text-muted-foreground mt-1">File loaded — click to change</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">Click to upload a CSV file</p>
                      <p className="text-sm text-muted-foreground mt-1">Supports any .csv format</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-file-upload"
                />

                {/* Optional vendor selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Vendor (optional)</label>
                  <Select value={selectedVendorId} onValueChange={setSelectedVendorId} data-testid="select-vendor">
                    <SelectTrigger data-testid="select-vendor-trigger">
                      <SelectValue placeholder="Unknown / Other" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unknown / Other</SelectItem>
                      {vendors?.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    If selected, imported items will be linked to this vendor for future ordering.
                  </p>
                </div>

                <Button
                  onClick={handleAnalyze}
                  disabled={!canProceedStep1 || analyzeMutation.isPending}
                  className="w-full"
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? (
                    <>
                      <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing columns...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Analyze Columns
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Column Mapping */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5" />
                  Confirm Column Mapping
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  AI has analyzed your CSV and proposed column assignments. Review and adjust if needed.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>Detected <strong>{headers.length}</strong> columns in <strong>{fileName}</strong>. Select "None" to skip a field.</span>
                </div>

                <div className="space-y-3">
                  {(Object.keys(FIELD_LABELS) as (keyof ColumnMapping)[]).map((field) => {
                    const isRequired = REQUIRED_FIELDS.includes(field);
                    const conf = confidence[field] ?? 0;
                    const mapped = mapping[field];
                    return (
                      <div key={field} className="grid grid-cols-[180px_1fr_auto] gap-3 items-center">
                        <label className="text-sm font-medium">
                          {FIELD_LABELS[field]}
                          {isRequired && <span className="text-destructive ml-1">*</span>}
                        </label>
                        <Select
                          value={mapping[field] || 'none'}
                          onValueChange={(val) => setMapping((prev) => ({ ...prev, [field]: val === 'none' ? '' : val }))}
                          data-testid={`select-mapping-${field}`}
                        >
                          <SelectTrigger data-testid={`select-trigger-${field}`}>
                            <SelectValue placeholder="None — skip" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None — skip</SelectItem>
                            {headers.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {mapped ? (
                          <Badge
                            variant="secondary"
                            className={conf >= 0.8 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : conf >= 0.5 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-muted'}
                          >
                            {Math.round(conf * 100)}%
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">skip</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep(1)} data-testid="button-back-step1">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    onClick={() => previewMutation.mutate()}
                    disabled={!canProceedStep2 || previewMutation.isPending}
                    className="flex-1"
                    data-testid="button-preview"
                  >
                    {previewMutation.isPending ? (
                      <>
                        <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                        Matching items...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Match & Preview
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Review */}
          {step === 3 && previewResult && (
            <div className="space-y-4">
              {/* Actions bar */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <Button variant="ghost" size="icon" onClick={() => setStep(2)} data-testid="button-back-step2">
                  <ArrowLeft className="h-4 w-4" />
                </Button>

                <div className="flex flex-col gap-2 items-end">
                  {/* Store selection */}
                  {stores.length > 1 && (
                    <Collapsible open={isStoreSelectionOpen} onOpenChange={setIsStoreSelectionOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2" data-testid="button-store-select">
                          <Store className="h-4 w-4" />
                          Import to {targetStoreIds.size} of {stores.length} stores
                          <ChevronDown className={`h-4 w-4 transition-transform ${isStoreSelectionOpen ? 'rotate-180' : ''}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <Card>
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">Target Stores</span>
                              <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setTargetStoreIds(new Set(stores.map((s) => s.id)))}>All</Button>
                                <Button variant="ghost" size="sm" onClick={() => selectedStoreId && setTargetStoreIds(new Set([selectedStoreId]))}>Current Only</Button>
                              </div>
                            </div>
                            {stores.map((store) => (
                              <div key={store.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`store-${store.id}`}
                                  checked={targetStoreIds.has(store.id)}
                                  onCheckedChange={() => toggleTargetStore(store.id)}
                                  disabled={targetStoreIds.size === 1 && targetStoreIds.has(store.id)}
                                />
                                <label htmlFor={`store-${store.id}`} className="text-sm cursor-pointer">
                                  {store.name}
                                  {store.id === selectedStoreId && <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>}
                                </label>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => { setImportAllMode(true); setStep(4); }}
                      disabled={targetStoreIds.size === 0}
                      data-testid="button-review-all"
                    >
                      <CheckCheck className="h-4 w-4 mr-2" />
                      Import All ({previewResult.review.summary.total})
                    </Button>
                    <Button
                      onClick={() => { setImportAllMode(false); setStep(4); }}
                      disabled={selectedLineIds.size === 0 || targetStoreIds.size === 0}
                      data-testid="button-review-selected"
                    >
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Continue with {selectedLineIds.size} Selected
                    </Button>
                  </div>
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-1">
                    <CardTitle className="text-sm font-medium">Total</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{previewResult.review.summary.total}</div>
                    <p className="text-xs text-muted-foreground">Items in file</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-1">
                    <CardTitle className="text-sm font-medium">Auto-Matched</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">{previewResult.review.summary.matched}</div>
                    <p className="text-xs text-muted-foreground">In existing inventory</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-1">
                    <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-yellow-600">{previewResult.review.summary.ambiguous}</div>
                    <p className="text-xs text-muted-foreground">Possible matches</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-1">
                    <CardTitle className="text-sm font-medium">New Items</CardTitle>
                    <PlusCircle className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">{previewResult.review.summary.new}</div>
                    <p className="text-xs text-muted-foreground">Will be created</p>
                  </CardContent>
                </Card>
              </div>

              {/* Grouped tabs */}
              <Tabs defaultValue="matched">
                <TabsList>
                  <TabsTrigger value="matched" data-testid="tab-matched">
                    Auto-Matched ({previewResult.review.summary.matched})
                  </TabsTrigger>
                  <TabsTrigger value="ambiguous" data-testid="tab-ambiguous">
                    Needs Review ({previewResult.review.summary.ambiguous})
                  </TabsTrigger>
                  <TabsTrigger value="new" data-testid="tab-new">
                    New Items ({previewResult.review.summary.new})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="matched">
                  <ImportLineTable
                    lines={previewResult.review.lines.matched}
                    selectedLineIds={selectedLineIds}
                    onToggle={toggleLineSelection}
                    onSelectAll={() => selectAllInGroup(previewResult.review.lines.matched)}
                    onDeselectAll={() => deselectAllInGroup(previewResult.review.lines.matched)}
                    description="High confidence match to existing inventory. Vendor pricing will be updated."
                    showMatchedItem
                    showCanonical
                  />
                </TabsContent>

                <TabsContent value="ambiguous">
                  <ImportLineTable
                    lines={previewResult.review.lines.ambiguous}
                    selectedLineIds={selectedLineIds}
                    onToggle={toggleLineSelection}
                    onSelectAll={() => selectAllInGroup(previewResult.review.lines.ambiguous)}
                    onDeselectAll={() => deselectAllInGroup(previewResult.review.lines.ambiguous)}
                    description="Possible match found but confidence is below threshold. Confirm which existing item to link, or create a new one."
                    showMatchedItem
                    showCanonical
                    showConfidence
                    showResolution
                    lineOverrides={lineOverrides}
                    onLineOverride={(lineId, value) => setLineOverrides(prev => ({ ...prev, [lineId]: value }))}
                    allInventoryItems={inventoryItems ?? []}
                    showVendorOverride
                    vendorOverrides={vendorOverrides}
                    onVendorOverride={(lineId, value) => {
                      if (value) {
                        setVendorOverrides(prev => ({ ...prev, [lineId]: value }));
                      } else {
                        setVendorOverrides(prev => { const n = { ...prev }; delete n[lineId]; return n; });
                      }
                    }}
                    allVendors={vendors ?? []}
                  />
                </TabsContent>

                <TabsContent value="new">
                  <ImportLineTable
                    lines={previewResult.review.lines.new}
                    selectedLineIds={selectedLineIds}
                    onToggle={toggleLineSelection}
                    onSelectAll={() => selectAllInGroup(previewResult.review.lines.new)}
                    onDeselectAll={() => deselectAllInGroup(previewResult.review.lines.new)}
                    description="No existing match found. These will be created as new inventory items."
                    showCanonical
                    showVendorOverride
                    vendorOverrides={vendorOverrides}
                    onVendorOverride={(lineId, value) => {
                      if (value) {
                        setVendorOverrides(prev => ({ ...prev, [lineId]: value }));
                      } else {
                        setVendorOverrides(prev => { const n = { ...prev }; delete n[lineId]; return n; });
                      }
                    }}
                    allVendors={vendors ?? []}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Step 4: Confirm Import */}
          {step === 4 && previewResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCheck className="h-5 w-5" />
                  Confirm Import
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Review the import summary below and click Confirm to proceed.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Summary */}
                <div className="rounded-md border p-4 space-y-3 bg-muted/30">
                  <p className="text-sm font-medium">Import Summary</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                    <span className="text-muted-foreground">File</span>
                    <span className="font-medium truncate">{fileName}</span>
                    <span className="text-muted-foreground">Mode</span>
                    <span className="font-medium">{importAllMode ? 'All items' : `${selectedLineIds.size} selected items`}</span>
                    <span className="text-muted-foreground">Auto-matched</span>
                    <span className="font-medium text-green-600">{previewResult.review.summary.matched}</span>
                    <span className="text-muted-foreground">Needs review</span>
                    <span className="font-medium text-yellow-600">{previewResult.review.summary.ambiguous}</span>
                    <span className="text-muted-foreground">New items</span>
                    <span className="font-medium text-blue-600">{previewResult.review.summary.new}</span>
                  </div>
                </div>

                {/* Target stores */}
                <div className="rounded-md border p-4 space-y-2 bg-muted/30">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Target Stores ({targetStoreIds.size})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {stores.filter(s => targetStoreIds.has(s.id)).map(s => (
                      <Badge key={s.id} variant="secondary" data-testid={`badge-store-${s.id}`}>{s.name}</Badge>
                    ))}
                  </div>
                </div>

                {/* Vendor overrides summary */}
                {Object.keys(vendorOverrides).length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    {Object.keys(vendorOverrides).length} vendor override(s) applied.
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep(3)} data-testid="button-back-step3">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => approveMutation.mutate({ importAll: importAllMode })}
                    disabled={approveMutation.isPending || targetStoreIds.size === 0}
                    data-testid="button-confirm-import"
                  >
                    {approveMutation.isPending ? (
                      <>
                        <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Confirm Import
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Done state: Success screen */}
          {step === 'done' && (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <CheckCircle2 className="h-14 w-14 mx-auto text-green-600" />
                <h2 className="text-xl font-bold">Import Complete</h2>
                <p className="text-muted-foreground">Your inventory items have been created and assigned to the selected stores.</p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => navigate('/inventory-items')} data-testid="button-view-inventory">
                    View Inventory
                  </Button>
                  <Button
                    onClick={() => {
                      setStep(1);
                      setCsvContent('');
                      setFileName('');
                      setPreviewResult(null);
                      setSelectedLineIds(new Set());
                    }}
                    data-testid="button-import-another"
                  >
                    Import Another File
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </TierGate>
  );
}

function ImportLineTable({
  lines,
  selectedLineIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  description,
  showCanonical = false,
  showMatchedItem = false,
  showConfidence = false,
  showResolution = false,
  lineOverrides,
  onLineOverride,
  allInventoryItems = [],
  showVendorOverride = false,
  vendorOverrides,
  onVendorOverride,
  allVendors = [],
}: {
  lines: ImportLine[];
  selectedLineIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  description: string;
  showCanonical?: boolean;
  showMatchedItem?: boolean;
  showConfidence?: boolean;
  showResolution?: boolean;
  lineOverrides?: Record<string, string>;
  onLineOverride?: (lineId: string, value: string) => void;
  allInventoryItems?: InventoryItem[];
  showVendorOverride?: boolean;
  vendorOverrides?: Record<string, string>;
  onVendorOverride?: (lineId: string, value: string) => void;
  allVendors?: Vendor[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onSelectAll} data-testid="button-select-all">
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={onDeselectAll} data-testid="button-deselect-all">
            Deselect All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No items in this group</p>
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Product Name</TableHead>
                  {showCanonical && <TableHead>Canonical Name</TableHead>}
                  {showMatchedItem && <TableHead>Matched Item</TableHead>}
                  {showResolution && <TableHead>Action</TableHead>}
                  {showVendorOverride && <TableHead>Vendor</TableHead>}
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Pack</TableHead>
                  {showConfidence && <TableHead className="text-right">Match %</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const override = lineOverrides?.[line.id];
                  // effectiveAction is either an inventoryItemId (to link) or 'new' (create fresh)
                  // Default to the matched item ID if one exists, otherwise 'new'
                  const effectiveAction = override ?? (line.matchedInventoryItemId ?? 'new');
                  return (
                    <TableRow
                      key={line.id}
                      data-testid={`row-import-line-${line.id}`}
                      className={!selectedLineIds.has(line.id) ? 'opacity-50' : ''}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedLineIds.has(line.id)}
                          onCheckedChange={() => onToggle(line.id)}
                          data-testid={`checkbox-line-${line.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{line.productName}</div>
                        {line.brandName && (
                          <div className="text-xs text-muted-foreground">{line.brandName}</div>
                        )}
                      </TableCell>
                      {showCanonical && (
                        <TableCell>
                          {line.canonicalName && line.canonicalName !== line.productName ? (
                            <div className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-sm text-primary">{line.canonicalName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      {showMatchedItem && (
                        <TableCell>
                          {line.matchedInventoryItemName ? (
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                              <span className="text-sm">{line.matchedInventoryItemName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      {showResolution && onLineOverride && (
                        <TableCell className="min-w-[200px]">
                          {/* Resolution select: value is always an inventoryItemId or 'new' */}
                          <Select
                            value={effectiveAction}
                            onValueChange={(val) => onLineOverride(line.id, val)}
                            data-testid={`select-resolution-${line.id}`}
                          >
                            <SelectTrigger className="h-8 text-xs" data-testid={`select-trigger-resolution-${line.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Suggested match (value = actual inventoryItemId) */}
                              {line.matchedInventoryItemId && (
                                <SelectItem value={line.matchedInventoryItemId}>
                                  Use: {line.matchedInventoryItemName || line.matchedInventoryItemId.slice(0, 8)}
                                </SelectItem>
                              )}
                              {/* Create new */}
                              <SelectItem value="new">Create as new item</SelectItem>
                              {/* Pick a different existing item */}
                              {allInventoryItems.filter(it => it.id !== line.matchedInventoryItemId).map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                  Link to: {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      {showVendorOverride && onVendorOverride && (
                        <TableCell className="min-w-[160px]">
                          <Select
                            value={vendorOverrides?.[line.id] ?? 'default'}
                            onValueChange={(val) => onVendorOverride(line.id, val === 'default' ? '' : val)}
                            data-testid={`select-vendor-${line.id}`}
                          >
                            <SelectTrigger className="h-8 text-xs" data-testid={`select-trigger-vendor-${line.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default vendor</SelectItem>
                              {allVendors.map(v => (
                                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="text-xs text-muted-foreground font-mono">{line.vendorSku?.startsWith('GENERIC-') ? '—' : (line.vendorSku || '—')}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {line.price != null ? `$${line.price.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {[line.caseSize, line.uom].filter(Boolean).join(' ')}
                          {line.packSize ? ` · ${line.packSize}` : ''}
                        </span>
                      </TableCell>
                      {showConfidence && (
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={
                            (line.matchConfidence ?? 0) >= 70 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-muted'
                          }>
                            {line.matchConfidence ?? 0}%
                          </Badge>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
