import { useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ImageIcon,
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

interface ExtractedItem {
  name: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
}

type CompanyStore = { id: string; name: string };

const EMPTY_ITEM: ExtractedItem = { name: '', department: '', category: '', size: '', price: null };

export default function MenuImport() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { stores, selectedStoreId } = useStoreContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 'done'>(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [targetStoreIds, setTargetStoreIds] = useState<Set<string>>(
    new Set(selectedStoreId ? [selectedStoreId] : [])
  );
  const [isStoreOpen, setIsStoreOpen] = useState(false);

  const stepNum = step === 'done' ? 4 : step;
  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Review' },
    { num: 3, label: 'Confirm' },
  ];

  // Upload image to object storage then scan it
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const uploadAndScanMutation = useMutation({
    mutationFn: async () => {
      if (!imageFile) throw new Error('No image selected');

      // 1. Upload image
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', imageFile);
      formData.append('visibility', 'private');

      const uploadRes = await fetch('/api/objects/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('Image upload failed');
      const uploadData = await uploadRes.json() as { objectPath?: string };
      const objectPath = uploadData.objectPath;
      if (!objectPath) throw new Error('Upload did not return an object path');

      // 2. Scan with AI
      const scanRes = await apiRequest('POST', '/api/menu-scan/scan', {
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
      setIsUploading(false);
      setSessionId(data.sessionId);
      setItems(data.items);
      // Pre-select all rows
      setSelectedRowIndices(new Set(data.items.map((_, i) => i)));
      // Default all stores selected
      if (stores.length > 0 && targetStoreIds.size === 0) {
        setTargetStoreIds(new Set(stores.map(s => s.id)));
      }
      setStep(2);
      toast({
        title: 'Scan Complete',
        description: `Found ${data.count} menu item${data.count !== 1 ? 's' : ''} in your menu`,
      });
    },
    onError: (err: Error) => {
      setIsUploading(false);
      toast({ title: 'Scan Failed', description: err.message, variant: 'destructive' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const approvedItems = items.filter((_, i) => selectedRowIndices.has(i));
      const res = await apiRequest('POST', `/api/menu-scan/${sessionId}/approve`, {
        items: approvedItems,
        targetStoreIds: Array.from(targetStoreIds),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Import failed');
      }
      return res.json() as Promise<{ menuItemsCreated: number; skipped: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: 'Import Complete',
        description: `${data.menuItemsCreated} menu item${data.menuItemsCreated !== 1 ? 's' : ''} added`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items/hierarchy'] });
      setStep('done');
    },
    onError: (err: Error) => {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    },
  });

  // Row editing
  const updateItem = (index: number, field: keyof ExtractedItem, value: string | number | null) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const deleteItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
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

  const selectAll = () => setSelectedRowIndices(new Set(items.map((_, i) => i)));
  const deselectAll = () => setSelectedRowIndices(new Set());

  const toggleStore = (id: string) => {
    setTargetStoreIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
      return next;
    });
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
                </p>

                {/* Image drop zone */}
                <div
                  className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="image-drop-zone"
                >
                  {imagePreviewUrl ? (
                    <div className="space-y-3">
                      <img
                        src={imagePreviewUrl}
                        alt="Menu preview"
                        className="max-h-72 mx-auto rounded-md object-contain"
                      />
                      <p className="text-sm text-muted-foreground">
                        {imageFile?.name} — click to change
                      </p>
                    </div>
                  ) : (
                    <div>
                      <ImageIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="font-medium">Click to upload a menu image</p>
                      <p className="text-sm text-muted-foreground mt-1">JPG, PNG, or WebP</p>
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-image-upload"
                />

                <Button
                  onClick={() => uploadAndScanMutation.mutate()}
                  disabled={!imageFile || uploadAndScanMutation.isPending}
                  className="w-full"
                  data-testid="button-scan"
                >
                  {uploadAndScanMutation.isPending || isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isUploading ? 'Uploading image...' : 'Scanning menu...'}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Scan Menu with AI
                    </>
                  )}
                </Button>

                {uploadAndScanMutation.isPending && (
                  <p className="text-xs text-center text-muted-foreground">
                    This may take 10–20 seconds depending on menu size
                  </p>
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
                <Button variant="outline" onClick={() => setStep(1)} data-testid="button-back-step1">
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
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="rounded-md bg-muted/50 p-4">
                      <div className="text-3xl font-bold">{selectedCount}</div>
                      <div className="text-sm text-muted-foreground mt-1">Items to import</div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-4">
                      <div className="text-3xl font-bold">{targetStoreIds.size}</div>
                      <div className="text-sm text-muted-foreground mt-1">Target store{targetStoreIds.size !== 1 ? 's' : ''}</div>
                    </div>
                  </div>

                  {/* Store selector */}
                  {stores.length > 1 && (
                    <Collapsible open={isStoreOpen} onOpenChange={setIsStoreOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between" data-testid="button-store-selector">
                          <span className="flex items-center gap-2">
                            <Store className="h-4 w-4" />
                            Assign to stores
                            <Badge variant="secondary">{targetStoreIds.size} selected</Badge>
                          </span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isStoreOpen ? 'rotate-180' : ''}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2 border rounded-md p-3">
                        {stores.map((s) => (
                          <label key={s.id} className="flex items-center gap-2 cursor-pointer" data-testid={`store-option-${s.id}`}>
                            <Checkbox
                              checked={targetStoreIds.has(s.id)}
                              onCheckedChange={() => toggleStore(s.id)}
                            />
                            <span className="text-sm">{s.name}</span>
                          </label>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Item preview list */}
                  <div>
                    <p className="text-sm font-medium mb-2">Items being imported:</p>
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {items
                        .filter((_, i) => selectedRowIndices.has(i))
                        .map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                            <span className="font-medium">
                              {item.name}
                              {item.size && <span className="text-muted-foreground ml-1">({item.size})</span>}
                            </span>
                            <div className="flex items-center gap-2">
                              {item.department && <Badge variant="outline" className="text-xs">{item.department}</Badge>}
                              {item.price != null && (
                                <span className="text-muted-foreground">${item.price.toFixed(2)}</span>
                              )}
                            </div>
                          </div>
                        ))}
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
                  disabled={approveMutation.isPending || selectedCount === 0 || targetStoreIds.size === 0}
                  data-testid="button-confirm-import"
                >
                  {approveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Import {selectedCount} Item{selectedCount !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <Card>
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto">
                  <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-xl font-bold">Import Complete!</h2>
                <p className="text-muted-foreground">
                  Your menu items have been added. You can now link recipes to them on the Menu Items page.
                </p>
                <div className="flex gap-2 justify-center pt-2">
                  <Button variant="outline" onClick={() => {
                    setStep(1);
                    setImageFile(null);
                    setImagePreviewUrl('');
                    setItems([]);
                    setSessionId('');
                    setSelectedRowIndices(new Set());
                  }} data-testid="button-scan-another">
                    <Camera className="h-4 w-4 mr-2" />
                    Scan Another Menu
                  </Button>
                  <Button onClick={() => navigate('/menu-items')} data-testid="button-go-to-menu">
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
