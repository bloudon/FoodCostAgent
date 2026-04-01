import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  ArrowLeft,
  Camera,
  Check,
  ChefHat,
  ChevronsUpDown,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { TierGate } from '@/components/tier-gate';
import { ObjectUploader } from '@/components/ObjectUploader';
import { Link } from 'wouter';
import { formatRecipeName } from '@/lib/utils';

type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

interface IngredientRow {
  name: string;
  qty: number;
  unit: string;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  matchConfidence: MatchConfidence;
  include: boolean;
}

interface ScanResult {
  sessionId: string;
  recipeName: string;
  yieldQty: number;
  yieldUnit: string;
  ingredients: IngredientRow[];
}

interface InventoryItem {
  id: string;
  name: string;
}

interface UnitOption {
  id: string;
  name: string;
  abbreviation: string | null;
}

const CONFIDENCE_BADGE: Record<MatchConfidence, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  high:   { label: 'High',      variant: 'default' },
  medium: { label: 'Medium',    variant: 'secondary' },
  low:    { label: 'Low',       variant: 'outline' },
  none:   { label: 'Unmatched', variant: 'destructive' },
};

function UnitSelect({
  value,
  onChange,
  units,
  placeholder,
  className,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  units: UnitOption[];
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const displayLabel = (u: UnitOption) =>
    u.abbreviation ? `${u.abbreviation} (${u.name})` : u.name;

  const selected = units.find(
    u => u.name.toLowerCase() === value.toLowerCase() ||
         (u.abbreviation && u.abbreviation.toLowerCase() === value.toLowerCase())
  );

  return (
    <Select
      value={selected?.id ?? '__custom'}
      onValueChange={id => {
        if (id === '__custom') return;
        const u = units.find(u => u.id === id);
        onChange(u ? u.name : id);
      }}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder={placeholder ?? 'Unit'}>
          {selected ? displayLabel(selected) : value || placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {units.map(u => (
          <SelectItem key={u.id} value={u.id}>
            {displayLabel(u)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InventoryCombobox({
  value,
  items,
  onChange,
  testId,
}: {
  value: string | null;
  items: InventoryItem[];
  onChange: (id: string | null, name: string | null) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full justify-between text-sm font-normal truncate"
          data-testid={testId}
        >
          <span className="truncate">
            {selected ? selected.name : 'Not matched'}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search inventory..." className="h-9" />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none"
                onSelect={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
              >
                <span className="text-muted-foreground">Not matched</span>
              </CommandItem>
              {items.map(item => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onChange(item.id, item.name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === item.id ? 'opacity-100' : 'opacity-0')}
                  />
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function RecipeImport() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(search);
  const urlSessionId = searchParams.get('sessionId') || '';

  const [step, setStep] = useState<1 | 2 | 'done'>(urlSessionId ? 2 : 1);
  const [sessionId, setSessionId] = useState<string>(urlSessionId);

  const [recipeName, setRecipeName] = useState('');
  const [yieldQty, setYieldQty] = useState<number>(1);
  const [yieldUnit, setYieldUnit] = useState('');
  const [canBeIngredient, setCanBeIngredient] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);

  const [createdRecipeId, setCreatedRecipeId] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: inventoryItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory-items'],
    select: (data: any[]) => data.map(i => ({ id: i.id, name: i.name })),
  });

  const { data: units = [] } = useQuery<UnitOption[]>({
    queryKey: ['/api/units'],
    select: (data: any[]) => data.map(u => ({ id: u.id, name: u.name, abbreviation: u.abbreviation ?? null })),
  });

  const { data: sessionData } = useQuery({
    queryKey: ['/api/recipe-import', urlSessionId],
    enabled: !!urlSessionId,
    queryFn: async () => {
      const res = await fetch(`/api/recipe-import/${urlSessionId}`, { credentials: 'include' });
      if (res.status === 409) {
        const body = await res.json() as { status?: string };
        return { status: body.status || 'approved' } as { status: string; recipeName?: string; yieldQty?: number; yieldUnit?: string; ingredients?: IngredientRow[] };
      }
      if (!res.ok) throw new Error('Session not found');
      return res.json() as Promise<ScanResult & { status: string }>;
    },
  });

  useEffect(() => {
    if (!sessionData) return;
    if (sessionData.status === 'approved') {
      setStep('done');
      return;
    }
    if (ingredients.length === 0 && sessionData.ingredients && sessionData.ingredients.length > 0) {
      setRecipeName(sessionData.recipeName || '');
      setYieldQty(sessionData.yieldQty || 1);
      setYieldUnit(sessionData.yieldUnit || '');
      setIngredients(sessionData.ingredients);
      setStep(2);
    }
  }, [sessionData]);

  useEffect(() => {
    if (sessionId) {
      const params = new URLSearchParams();
      params.set('sessionId', sessionId);
      navigate(`/recipe-import?${params.toString()}`, { replace: true });
    }
  }, [sessionId]);

  const patchMutation = useMutation({
    mutationFn: async (payload: { recipeName: string; yieldQty: number; yieldUnit: string; ingredients: IngredientRow[] }) => {
      if (!sessionId) return;
      await apiRequest('PATCH', `/api/recipe-import/${sessionId}`, payload);
    },
  });

  function scheduleAutosave(payload: { recipeName: string; yieldQty: number; yieldUnit: string; ingredients: IngredientRow[] }) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      patchMutation.mutate(payload);
    }, 1200);
  }

  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Review' },
  ];
  const stepNum = step === 'done' ? 3 : step;

  const scanMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const res = await apiRequest('POST', '/api/recipe-import/scan', { imageObjectPath: objectPath });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Scan failed');
      }
      return res.json() as Promise<ScanResult>;
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setRecipeName(data.recipeName);
      setYieldQty(data.yieldQty);
      setYieldUnit(data.yieldUnit);
      setIngredients(data.ingredients);
      setStep(2);
      toast({
        title: 'Scan Complete',
        description: `Found ${data.ingredients.length} ingredient${data.ingredients.length !== 1 ? 's' : ''}`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Scan Failed', description: err.message, variant: 'destructive' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/recipe-import/${sessionId}/approve`, {
        recipeName,
        yieldQty,
        yieldUnit,
        canBeIngredient: canBeIngredient ? 1 : 0,
        ingredients: ingredients.map(ing => ({
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          inventoryItemId: ing.inventoryItemId,
          include: ing.include,
        })),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Import failed');
      }
      return res.json() as Promise<{ recipeId: string; recipeName: string; componentsCreated: number }>;
    },
    onSuccess: (data) => {
      setCreatedRecipeId(data.recipeId);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['/api/recipes'] });
      toast({
        title: 'Recipe Created',
        description: `${formatRecipeName(data.recipeName)} imported with ${data.componentsCreated} ingredient${data.componentsCreated !== 1 ? 's' : ''}`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    },
  });

  function updateIngredient(index: number, changes: Partial<IngredientRow>) {
    setIngredients(prev => {
      const next = prev.map((ing, i) => i === index ? { ...ing, ...changes } : ing);
      scheduleAutosave({ recipeName, yieldQty, yieldUnit, ingredients: next });
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setIngredients(prev => {
      const next = prev.map(ing => ({ ...ing, include: checked }));
      scheduleAutosave({ recipeName, yieldQty, yieldUnit, ingredients: next });
      return next;
    });
  }

  function handleRecipeNameChange(val: string) {
    setRecipeName(val);
    scheduleAutosave({ recipeName: val, yieldQty, yieldUnit, ingredients });
  }

  function handleYieldQtyChange(val: number) {
    setYieldQty(val);
    scheduleAutosave({ recipeName, yieldQty: val, yieldUnit, ingredients });
  }

  function handleYieldUnitChange(val: string) {
    setYieldUnit(val);
    scheduleAutosave({ recipeName, yieldQty, yieldUnit: val, ingredients });
  }

  const allChecked = ingredients.length > 0 && ingredients.every(i => i.include);
  const includedCount = ingredients.filter(i => i.include && i.inventoryItemId).length;

  return (
    <TierGate feature="recipe_costing">
      <div className="p-8">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/recipes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scan Recipe</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Upload a recipe photo and let AI extract the ingredients
            </p>
          </div>
        </div>

        {step !== 'done' && (
          <div className="flex items-center gap-2 mb-6">
            {steps.map((s, idx) => (
              <div key={s.num} className="flex items-center gap-2">
                <div className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium transition-colors ${
                  stepNum >= s.num
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {stepNum > s.num ? <Check className="h-3.5 w-3.5" /> : s.num}
                </div>
                <span className={`text-sm ${stepNum >= s.num ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
                {idx < steps.length - 1 && (
                  <div className="w-8 h-px bg-border" />
                )}
              </div>
            ))}
          </div>
        )}

        {step === 1 && (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Upload Recipe Photo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Take a photo or upload a scan of your recipe card. GPT-4o will extract
                the recipe name, yield, and ingredient list automatically.
              </p>
              {scanMutation.isPending ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Sparkles className="h-8 w-8 text-primary animate-pulse" />
                  <p className="text-sm text-muted-foreground">Reading your recipe...</p>
                </div>
              ) : (
                <ObjectUploader
                  buttonText="Upload Recipe Photo"
                  visibility="private"
                  onUploadComplete={(objectPath: string) => {
                    scanMutation.mutate(objectPath);
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-4xl">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recipe Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-1">
                    <Label htmlFor="recipe-name">Recipe Name</Label>
                    <Input
                      id="recipe-name"
                      value={recipeName}
                      onChange={e => handleRecipeNameChange(e.target.value)}
                      placeholder="Recipe name"
                      className="mt-1"
                      data-testid="input-recipe-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="yield-qty">Yield Qty</Label>
                    <Input
                      id="yield-qty"
                      type="number"
                      value={yieldQty}
                      onChange={e => handleYieldQtyChange(Number(e.target.value))}
                      placeholder="1"
                      className="mt-1"
                      data-testid="input-yield-qty"
                    />
                  </div>
                  <div>
                    <Label>Yield Unit</Label>
                    <div className="mt-1">
                      <UnitSelect
                        value={yieldUnit}
                        onChange={handleYieldUnitChange}
                        units={units}
                        placeholder="Select unit"
                        testId="select-yield-unit"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Checkbox
                    id="can-be-ingredient"
                    checked={canBeIngredient}
                    onCheckedChange={v => setCanBeIngredient(!!v)}
                    data-testid="checkbox-can-be-ingredient"
                  />
                  <Label htmlFor="can-be-ingredient" className="cursor-pointer font-normal">
                    Can be used as an ingredient in other recipes
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">
                    Ingredients
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({ingredients.length} extracted)
                    </span>
                  </CardTitle>
                  <div className="text-sm text-muted-foreground">
                    {includedCount} will be linked to inventory
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {ingredients.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    No ingredients were extracted. You can add them manually after creating the recipe.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={(v) => toggleAll(!!v)}
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                        <TableHead>Ingredient (from photo)</TableHead>
                        <TableHead className="w-20">Qty</TableHead>
                        <TableHead className="w-28">Unit</TableHead>
                        <TableHead>Match in Inventory</TableHead>
                        <TableHead className="w-24">Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ingredients.map((ing, index) => {
                        const conf = CONFIDENCE_BADGE[ing.matchConfidence];
                        return (
                          <TableRow
                            key={index}
                            className={ing.include ? '' : 'opacity-50'}
                            data-testid={`row-ingredient-${index}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={ing.include}
                                onCheckedChange={v => updateIngredient(index, { include: !!v })}
                                data-testid={`checkbox-ingredient-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={ing.name}
                                onChange={e => updateIngredient(index, { name: e.target.value })}
                                className="h-8 text-sm"
                                data-testid={`input-ingredient-name-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={ing.qty}
                                onChange={e => updateIngredient(index, { qty: Number(e.target.value) })}
                                className="h-8 text-sm"
                                data-testid={`input-ingredient-qty-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <UnitSelect
                                value={ing.unit}
                                onChange={v => updateIngredient(index, { unit: v })}
                                units={units}
                                className="h-8 text-sm"
                                testId={`select-ingredient-unit-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <InventoryCombobox
                                value={ing.inventoryItemId}
                                items={inventoryItems}
                                onChange={(id, name) => updateIngredient(index, {
                                  inventoryItemId: id,
                                  inventoryItemName: name,
                                  matchConfidence: id ? 'high' : 'none',
                                })}
                                testId={`combobox-inventory-item-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={conf.variant} className="text-xs">
                                {conf.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || !recipeName.trim()}
                data-testid="button-create-recipe"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ChefHat className="h-4 w-4 mr-2" />
                )}
                Create Recipe
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="flex justify-center">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold">Recipe Created</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatRecipeName(recipeName)} has been added to your recipe library.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {createdRecipeId && (
                  <Button asChild data-testid="button-view-recipe">
                    <Link href={`/recipes/${createdRecipeId}`}>
                      View Recipe
                    </Link>
                  </Button>
                )}
                <Button variant="outline" asChild data-testid="button-scan-another">
                  <Link href="/recipe-import">
                    Scan Another Recipe
                  </Link>
                </Button>
                <Button variant="ghost" asChild data-testid="button-back-to-recipes">
                  <Link href="/recipes">
                    Back to Recipes
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TierGate>
  );
}
