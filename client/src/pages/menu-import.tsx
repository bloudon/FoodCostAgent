import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  Loader2,
  Plus,
  Sparkles,
  Store,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useStoreContext } from '@/hooks/use-store-context';
import { TierGate } from '@/components/tier-gate';
import { ObjectUploader } from '@/components/ObjectUploader';

interface ExtractedItem {
  name: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
}

const EMPTY_ITEM: ExtractedItem = { name: '', department: '', category: '', size: '', price: null };

export default function MenuImport() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { selectedStoreId } = useStoreContext();

  // Parse sessionId from URL query params for refresh-safe rehydration
  // useSearch() returns the raw query string (e.g. "sessionId=abc") in wouter v3
  const searchParams = new URLSearchParams(search);
  const urlSessionId = searchParams.get('sessionId') || '';

  const [step, setStep] = useState<1 | 2 | 3 | 'done'>(urlSessionId ? 2 : 1);
  const [sessionId, setSessionId] = useState<string>(urlSessionId);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());

  // Refs used by unmount cleanup to capture latest state without stale closures
  const sessionIdRef = useRef(sessionId);
  const stepRef = useRef(step);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { stepRef.current = step; }, [step]);

  // Rehydrate items from server if returning with a sessionId in URL
  const { data: sessionData } = useQuery({
    queryKey: ['/api/menu-import', urlSessionId],
    enabled: !!urlSessionId,
    queryFn: async () => {
      const res = await fetch(`/api/menu-import/${urlSessionId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Session not found');
      return res.json() as Promise<{ sessionId: string; status: string; items: ExtractedItem[] }>;
    },
  });

  useEffect(() => {
    if (!sessionData) return;
    if (sessionData.status === 'approved') {
      setStep('done');
      return;
    }
    if (items.length === 0 && sessionData.items.length > 0) {
      setItems(sessionData.items);
      setSelectedRowIndices(new Set(sessionData.items.map((_: ExtractedItem, i: number) => i)));
      setStep(2);
    }
  }, [sessionData]);

  // Update URL when sessionId changes (for refresh-safety)
  useEffect(() => {
    if (sessionId) {
      const params = new URLSearchParams();
      params.set('sessionId', sessionId);
      navigate(`/menu-import?${params.toString()}`, { replace: true });
    }
  }, [sessionId]);

  // Clean up any pending session when the user navigates away from the wizard
  // (covers browser back, link clicks, programmatic navigation, tab close)
  useEffect(() => {
    return () => {
      // Use a ref snapshot so the callback captures the latest sessionId + step at unmount
      const sid = sessionIdRef.current;
      const st = stepRef.current;
      if (sid && st !== 'done') {
        // fire-and-forget via sendBeacon for reliability during page unload
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob(['{}'], { type: 'application/json' });
          navigator.sendBeacon(`/api/menu-import/${sid}`, blob);
        } else {
          fetch(`/api/menu-import/${sid}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
        }
      }
    };
  }, []);

  const stepNum = step === 'done' ? 4 : step;
  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Review' },
    { num: 3, label: 'Confirm' },
  ];

  // Scan mutation: called once ObjectUploader returns the objectPath
  const scanMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const scanRes = await apiRequest('POST', '/api/menu-import/scan', {
        imageObjectPath: objectPath,
        storeId: selectedStoreId || undefined,
      });
      if (!scanRes.ok) {
        const err = await scanRes.json() as { error?: string };
        throw new Error(err.error || 'Scan failed');
      }
      return scanRes.json() as Promise<{ sessionId: string; items: ExtractedItem[]; count: number }>;
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setItems(data.items);
      setSelectedRowIndices(new Set(data.items.map((_: ExtractedItem, i: number) => i)));
      setStep(2);
      toast({
        title: 'Scan Complete',
        description: `Found ${data.count} menu item${data.count !== 1 ? 's' : ''} in your menu`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Scan Failed', description: err.message, variant: 'destructive' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const approvedItems = items.filter((_: ExtractedItem, i: number) => selectedRowIndices.has(i));
      const selectedCount = approvedItems.length;
      const res = await apiRequest('POST', `/api/menu-import/${sessionId}/approve`, {
        items: approvedItems,
        storeId: selectedStoreId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Import failed');
      }
      const result = await res.json() as { menuItemsCreated: number; skipped: number };
      return { ...result, selectedCount };
    },
    onSuccess: (data) => {
      // Report selected rows count (user's mental model) rather than total DB rows created
      // (which may exceed selected count due to synthetic parent rows for multi-size groups)
      const n = data.selectedCount;
      toast({
        title: 'Import Complete',
        description: `${n} menu item${n !== 1 ? 's' : ''} imported`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items/hierarchy'] });
      setStep('done');
    },
    onError: (err: Error) => {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    },
  });

  // Row editing helpers
  const updateItem = (index: number, field: keyof ExtractedItem, value: string | number | null) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const deleteItem = (index: number) => {
    setItems(prev => prev.filter((_: ExtractedItem, i: number) => i !== index));
    setSelectedRowIndices(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const addRow = () => {
    setItems(prev => [...prev, { ...EMPTY_ITEM }]);
    setSelectedRowIndices(prev => new Set([...prev, items.length]));
  };

  const toggleRow = (index: number) => {
    setSelectedRowIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const selectAll = () => setSelectedRowIndices(new Set(items.map((_: ExtractedItem, i: number) => i)));
  const deselectAll = () => setSelectedRowIndices(new Set());

  const resetWizard = async () => {
    // Cancel the current session on the server to avoid leaving pending sessions
    if (sessionId) {
      try {
        await apiRequest('DELETE', `/api/menu-import/${sessionId}`);
      } catch {
        // Non-fatal
      }
    }
    setStep(1);
    setItems([]);
    setSessionId('');
    setSelectedRowIndices(new Set());
    navigate('/menu-import', { replace: true });
  };

  const selectedCount = selectedRowIndices.size;

  return (
    <TierGate feature="recipe_costing">
      <div className="h-full overflow-auto pb-4">
        <div className="p-4 space-y-4 max-w-4xl mx-auto">

          {/* Header */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/menu-items')} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Import Menu from Image</h1>
              <p className="text-sm text-muted-foreground">
                Upload a photo of your menu — AI will extract all items automatically
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

          {/* ── Step 1: Upload ── */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Upload Menu Image
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Take a clear photo of your menu or upload an existing image.
                  Works best with well-lit, straight-on shots. JPG, PNG, or WebP accepted.
                  The AI scan will start automatically once your image is uploaded.
                </p>

                {scanMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin" />
                    <p className="font-medium">Scanning your menu with AI…</p>
                    <p className="text-xs">This may take 10–20 seconds depending on menu size</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <ObjectUploader
                      onUploadComplete={(objectPath) => scanMutation.mutate(objectPath)}
                      buttonText="Select Menu Image"
                      dataTestId="button-upload-menu"
                      visibility="private"
                    />
                    <p className="text-xs text-muted-foreground">
                      Supports JPG, PNG, WebP up to 10 MB
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: Review ── */}
          {step === 2 && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Wand2 className="h-5 w-5" />
                      Review Extracted Items
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">
                        {selectedCount} of {items.length} selected
                      </Badge>
                      <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                        <CheckCheck className="h-3 w-3 mr-1" />
                        All
                      </Button>
                      <Button variant="outline" size="sm" onClick={deselectAll} data-testid="button-deselect-all">
                        None
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Review what AI found. Edit any field inline, uncheck rows to skip, or add missing items.
                    Items with the same name and multiple sizes will be imported as size variants.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No items were extracted. Try uploading a clearer image.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>Item Name</TableHead>
                            <TableHead className="hidden sm:table-cell">Department</TableHead>
                            <TableHead className="hidden md:table-cell">Size</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item, i) => (
                            <TableRow
                              key={i}
                              className={selectedRowIndices.has(i) ? '' : 'opacity-40'}
                              data-testid={`row-item-${i}`}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedRowIndices.has(i)}
                                  onCheckedChange={() => toggleRow(i)}
                                  data-testid={`checkbox-item-${i}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.name}
                                  onChange={(e) => updateItem(i, 'name', e.target.value)}
                                  className="h-8 min-w-[120px]"
                                  placeholder="Item name"
                                  data-testid={`input-name-${i}`}
                                />
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <Input
                                  value={item.department}
                                  onChange={(e) => updateItem(i, 'department', e.target.value)}
                                  className="h-8 min-w-[100px]"
                                  placeholder="e.g. Pizza"
                                  data-testid={`input-dept-${i}`}
                                />
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <Input
                                  value={item.size}
                                  onChange={(e) => updateItem(i, 'size', e.target.value)}
                                  className="h-8 min-w-[80px]"
                                  placeholder="e.g. Large"
                                  data-testid={`input-size-${i}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={item.price ?? ''}
                                  onChange={(e) => updateItem(i, 'price', e.target.value ? parseFloat(e.target.value) : null)}
                                  className="h-8 w-24"
                                  placeholder="$0.00"
                                  data-testid={`input-price-${i}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteItem(i)}
                                  data-testid={`button-delete-${i}`}
                                >
                                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-row">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Row
                  </Button>
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" onClick={resetWizard} data-testid="button-back-step1">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={selectedCount === 0}
                  data-testid="button-next-step3"
                >
                  Continue with {selectedCount} item{selectedCount !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="h-5 w-5" />
                    Confirm Import
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Summary */}
                  <div className="text-center rounded-md bg-muted/50 p-6">
                    <div className="text-4xl font-bold">{selectedCount}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      item{selectedCount !== 1 ? 's' : ''} ready to import
                    </div>
                    <div className="text-sm text-muted-foreground mt-3">
                      Items will be added to your current store.
                      You can assign them to other stores after import.
                    </div>
                  </div>

                  {/* Item preview (first 5) */}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Items to import:</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {items
                        .filter((_: ExtractedItem, i: number) => selectedRowIndices.has(i))
                        .slice(0, 10)
                        .map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                            <span>
                              {item.name}
                              {item.size && <span className="text-muted-foreground ml-1">({item.size})</span>}
                            </span>
                            {item.price != null && (
                              <span className="text-muted-foreground">${item.price.toFixed(2)}</span>
                            )}
                          </div>
                        ))}
                      {selectedCount > 10 && (
                        <p className="text-xs text-muted-foreground pt-1">
                          …and {selectedCount - 10} more
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)} data-testid="button-back-step2">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || selectedCount === 0}
                  data-testid="button-confirm-import"
                >
                  {approveMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" />Import {selectedCount} item{selectedCount !== 1 ? 's' : ''}</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <Card>
              <CardContent className="py-10 text-center space-y-4">
                <div className="flex items-center justify-center h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/20 mx-auto">
                  <Check className="h-7 w-7 text-green-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Import Complete</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your menu items have been added successfully.
                  </p>
                </div>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={resetWizard} data-testid="button-import-another">
                    Import Another Menu
                  </Button>
                  <Button onClick={() => navigate('/menu-items')} data-testid="button-view-menu-items">
                    View Menu Items
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
