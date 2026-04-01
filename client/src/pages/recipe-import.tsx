import { useState, useEffect } from 'react';
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
  ArrowLeft,
  Camera,
  Check,
  ChefHat,
  Loader2,
  Sparkles,
} from 'lucide-react';
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

const CONFIDENCE_BADGE: Record<MatchConfidence, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  high:   { label: 'High',      variant: 'default' },
  medium: { label: 'Medium',    variant: 'secondary' },
  low:    { label: 'Low',       variant: 'outline' },
  none:   { label: 'Unmatched', variant: 'destructive' },
};

export default function RecipeImport() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(search);
  const urlSessionId = searchParams.get('sessionId') || '';

  const [step, setStep] = useState<1 | 2 | 'done'>(urlSessionId ? 2 : 1);
  const [sessionId, setSessionId] = useState<string>(urlSessionId);

  // Step 2 state
  const [recipeName, setRecipeName] = useState('');
  const [yieldQty, setYieldQty] = useState<number>(1);
  const [yieldUnit, setYieldUnit] = useState('');
  const [canBeIngredient, setCanBeIngredient] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);

  // Result state
  const [createdRecipeId, setCreatedRecipeId] = useState<string | null>(null);

  // Fetch all inventory items for the dropdown
  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory-items'],
    select: (data: any[]) => data.map(i => ({ id: i.id, name: i.name })),
  });

  // Rehydrate from server if URL has sessionId
  const { data: sessionData } = useQuery({
    queryKey: ['/api/recipe-import', urlSessionId],
    enabled: !!urlSessionId,
    queryFn: async () => {
      const res = await fetch(`/api/recipe-import/${urlSessionId}`, { credentials: 'include' });
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
    if (ingredients.length === 0 && sessionData.ingredients?.length > 0) {
      setRecipeName(sessionData.recipeName || '');
      setYieldQty(sessionData.yieldQty || 1);
      setYieldUnit(sessionData.yieldUnit || '');
      setIngredients(sessionData.ingredients);
      setStep(2);
    }
  }, [sessionData]);

  // Update URL when sessionId changes
  useEffect(() => {
    if (sessionId) {
      const params = new URLSearchParams();
      params.set('sessionId', sessionId);
      navigate(`/recipe-import?${params.toString()}`, { replace: true });
    }
  }, [sessionId]);

  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Review' },
  ];
  const stepNum = step === 'done' ? 3 : step;

  // Scan mutation
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

  // Approve mutation
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
    setIngredients(prev => prev.map((ing, i) => i === index ? { ...ing, ...changes } : ing));
  }

  function toggleAll(checked: boolean) {
    setIngredients(prev => prev.map(ing => ({ ...ing, include: checked })));
  }

  const allChecked = ingredients.length > 0 && ingredients.every(i => i.include);
  const someChecked = ingredients.some(i => i.include);
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

        {/* Step indicator */}
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

        {/* Step 1: Upload */}
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

        {/* Step 2: Review */}
        {step === 2 && (
          <div className="space-y-4 max-w-4xl">
            {/* Recipe metadata */}
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
                      onChange={e => setRecipeName(e.target.value)}
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
                      onChange={e => setYieldQty(Number(e.target.value))}
                      placeholder="1"
                      className="mt-1"
                      data-testid="input-yield-qty"
                    />
                  </div>
                  <div>
                    <Label htmlFor="yield-unit">Yield Unit</Label>
                    <Input
                      id="yield-unit"
                      value={yieldUnit}
                      onChange={e => setYieldUnit(e.target.value)}
                      placeholder="portion"
                      className="mt-1"
                      data-testid="input-yield-unit"
                    />
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

            {/* Ingredients table */}
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
                        <TableHead className="w-24">Unit</TableHead>
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
                              <Input
                                value={ing.unit}
                                onChange={e => updateIngredient(index, { unit: e.target.value })}
                                className="h-8 text-sm"
                                data-testid={`input-ingredient-unit-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={ing.inventoryItemId || 'none'}
                                onValueChange={v => {
                                  if (v === 'none') {
                                    updateIngredient(index, { inventoryItemId: null, inventoryItemName: null, matchConfidence: 'none' });
                                  } else {
                                    const item = inventoryItems?.find(i => i.id === v);
                                    updateIngredient(index, {
                                      inventoryItemId: v,
                                      inventoryItemName: item?.name || null,
                                      matchConfidence: 'high',
                                    });
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm" data-testid={`select-inventory-item-${index}`}>
                                  <SelectValue placeholder="Not matched" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Not matched</SelectItem>
                                  {inventoryItems?.map(item => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
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

        {/* Done */}
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
