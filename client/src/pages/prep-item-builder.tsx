import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useForm, useFieldArray } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { Link } from "wouter";

interface Station { id: string; name: string }
interface Unit { id: string; name: string; abbreviation: string }
interface InventoryItem { id: string; name: string }
interface PrepItemOption { id: string; name: string }
interface MenuItem { id: string; name: string }

interface ApiIngredient {
  id: string;
  sourceType: "inventory_item" | "prep_item";
  sourceId: string;
  quantity: number;
  unitId: string | null;
  sortOrder: number;
}

interface ApiUsage {
  id: string;
  menuItemId: string;
  quantityPerSale: number;
  unitId: string | null;
}

interface ApiPrepItem {
  id: string;
  name: string;
  outputUnit: string;
  outputQtyPerBatch: number;
  shelfLifeHours: number;
  prepLeadMinutes: number;
  stationId: string | null;
  yieldPercent: number;
  active: number;
  ingredients: ApiIngredient[];
  usages: ApiUsage[];
}

interface Ingredient {
  id?: string;
  sourceType: "inventory_item" | "prep_item";
  sourceId: string;
  quantity: number | string;
  unitId: string;
}

interface Usage {
  id?: string;
  menuItemId: string;
  quantityPerSale: number | string;
  unitId: string;
}

interface FormValues {
  name: string;
  outputUnit: string;
  outputQtyPerBatch: number | string;
  shelfLifeHours: number | string;
  prepLeadMinutes: number | string;
  stationId: string;
  yieldPercent: number | string;
  active: number;
  ingredients: Ingredient[];
  usages: Usage[];
}

function PrepItemBuilderContent() {
  const [, navigate] = useLocation();
  const [matchNew] = useRoute("/prep-chart/items/new");
  const [matchEdit, params] = useRoute("/prep-chart/items/:id");
  const isNew = !!matchNew;
  const prepItemId = matchEdit ? params?.id : undefined;
  const { toast } = useToast();

  const { data: stations = [] } = useQuery<Station[]>({ queryKey: ["/api/stations"] });
  const { data: units = [] } = useQuery<Unit[]>({ queryKey: ["/api/units"] });
  const { data: inventoryItems = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory-items"] });
  const { data: prepItemsAll = [] } = useQuery<PrepItemOption[]>({ queryKey: ["/api/prep-items"] });
  const { data: menuItemsData = [] } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });

  const { data: existingItem, isLoading } = useQuery<ApiPrepItem>({
    queryKey: ["/api/prep-items", prepItemId],
    enabled: !!prepItemId,
  });

  const form = useForm<FormValues>({
    defaultValues: {
      name: "",
      outputUnit: "each",
      outputQtyPerBatch: 1,
      shelfLifeHours: 24,
      prepLeadMinutes: 30,
      stationId: "",
      yieldPercent: 100,
      active: 1,
      ingredients: [],
      usages: [],
    },
  });

  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const { fields: usageFields, append: appendUsage, remove: removeUsage } = useFieldArray({
    control: form.control,
    name: "usages",
  });

  useEffect(() => {
    if (existingItem) {
      form.reset({
        name: existingItem.name ?? "",
        outputUnit: existingItem.outputUnit ?? "each",
        outputQtyPerBatch: existingItem.outputQtyPerBatch ?? 1,
        shelfLifeHours: existingItem.shelfLifeHours ?? 24,
        prepLeadMinutes: existingItem.prepLeadMinutes ?? 30,
        stationId: existingItem.stationId ?? "",
        yieldPercent: existingItem.yieldPercent ?? 100,
        active: existingItem.active ?? 1,
        ingredients: (existingItem.ingredients ?? []).map((ing: ApiIngredient) => ({
          id: ing.id,
          sourceType: ing.sourceType,
          sourceId: ing.sourceId,
          quantity: ing.quantity,
          unitId: ing.unitId ?? "",
        })),
        usages: (existingItem.usages ?? []).map((u: ApiUsage) => ({
          id: u.id,
          menuItemId: u.menuItemId,
          quantityPerSale: u.quantityPerSale,
          unitId: u.unitId ?? "",
        })),
      });
    }
  }, [existingItem]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        outputQtyPerBatch: Number(values.outputQtyPerBatch),
        shelfLifeHours: Number(values.shelfLifeHours),
        prepLeadMinutes: Number(values.prepLeadMinutes),
        yieldPercent: Number(values.yieldPercent),
        stationId: values.stationId || null,
        ingredients: values.ingredients.map((ing, i) => ({
          ...ing,
          quantity: Number(ing.quantity),
          unitId: ing.unitId || null,
          sortOrder: i,
        })),
        usages: values.usages.map((u) => ({
          ...u,
          quantityPerSale: Number(u.quantityPerSale),
          unitId: u.unitId || null,
        })),
      };
      if (isNew) {
        const res = await apiRequest("POST", "/api/prep-items", payload);
        return res.json();
      } else {
        const res = await apiRequest("PATCH", `/api/prep-items/${prepItemId}`, payload);
        return res.json();
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prep-items"] });
      toast({ title: isNew ? "Prep item created" : "Prep item saved" });
      if (isNew) navigate(`/prep-chart/items/${data.id}`);
    },
    onError: () => toast({ title: "Failed to save prep item", variant: "destructive" }),
  });

  const onSubmit = form.handleSubmit((values) => saveMutation.mutate(values));

  const otherPrepItems = prepItemsAll.filter(p => p.id !== prepItemId);

  if (!isNew && isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading…</div>;
  }

  const watchStationId = form.watch("stationId");

  return (
    <div className="p-6 space-y-6 max-w-3xl pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/prep-chart/items">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-prep-item-builder">
            {isNew ? "New Prep Item" : (existingItem?.name || "Edit Prep Item")}
          </h1>
          <p className="text-sm text-muted-foreground">Define batch output, shelf life, and ingredients</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Core Fields */}
        <Card>
          <CardHeader><CardTitle className="text-base">Basic Info</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="name">Prep Item Name</Label>
              <Input id="name" {...form.register("name", { required: true })} placeholder="e.g. Beef Patties, Special Sauce" data-testid="input-prep-item-name" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="outputQtyPerBatch">Batch Output Qty</Label>
              <Input id="outputQtyPerBatch" type="number" step="any" {...form.register("outputQtyPerBatch")} data-testid="input-output-qty" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="outputUnit">Output Unit</Label>
              <Input id="outputUnit" {...form.register("outputUnit")} placeholder="each, oz, lb, cup…" data-testid="input-output-unit" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="shelfLifeHours">Shelf Life (hours)</Label>
              <Input id="shelfLifeHours" type="number" step="any" {...form.register("shelfLifeHours")} data-testid="input-shelf-life" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="prepLeadMinutes">Lead Time (minutes)</Label>
              <Input id="prepLeadMinutes" type="number" {...form.register("prepLeadMinutes")} data-testid="input-prep-lead" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="yieldPercent">Yield %</Label>
              <Input id="yieldPercent" type="number" step="any" min="0" max="100" {...form.register("yieldPercent")} data-testid="input-yield" />
            </div>

            <div className="space-y-1">
              <Label>Station</Label>
              <Select value={watchStationId} onValueChange={(v) => form.setValue("stationId", v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-station">
                  <SelectValue placeholder="No station" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No station</SelectItem>
                  {stations.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Ingredients */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Ingredients</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => appendIngredient({ sourceType: "inventory_item", sourceId: "", quantity: 1, unitId: "" })} data-testid="button-add-ingredient">
              <Plus className="h-4 w-4 mr-1" /> Add Ingredient
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {ingredientFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ingredients yet. Add one above.</p>
            ) : (
              ingredientFields.map((field, index) => {
                const sourceType = form.watch(`ingredients.${index}.sourceType`);
                return (
                  <div key={field.id} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-ingredient-${index}`}>
                    <div className="col-span-3">
                      <Select value={form.watch(`ingredients.${index}.sourceType`)} onValueChange={(v) => { form.setValue(`ingredients.${index}.sourceType`, v as "inventory_item" | "prep_item"); form.setValue(`ingredients.${index}.sourceId`, ""); }}>
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inventory_item">Inventory</SelectItem>
                          <SelectItem value="prep_item">Prep Item</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4">
                      <Select value={form.watch(`ingredients.${index}.sourceId`)} onValueChange={(v) => form.setValue(`ingredients.${index}.sourceId`, v)}>
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceType === "inventory_item"
                            ? inventoryItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)
                            : otherPrepItems.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                          }
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Input type="number" step="any" {...form.register(`ingredients.${index}.quantity`)} placeholder="Qty" className="text-xs" />
                    </div>
                    <div className="col-span-2">
                      <Select value={form.watch(`ingredients.${index}.unitId`)} onValueChange={(v) => form.setValue(`ingredients.${index}.unitId`, v === "__none__" ? "" : v)}>
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {units.map(u => <SelectItem key={u.id} value={u.id}>{u.abbreviation || u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" size="icon" variant="ghost" onClick={() => removeIngredient(index)} data-testid={`button-remove-ingredient-${index}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Menu Item Usages */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base">Menu Item Usage</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">How much of this prep item each menu item sale consumes — drives the forecast</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => appendUsage({ menuItemId: "", quantityPerSale: 1, unitId: "" })} data-testid="button-add-usage">
              <Plus className="h-4 w-4 mr-1" /> Link Menu Item
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {usageFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No menu items linked. Link one to include this prep item in chart forecasts.</p>
            ) : (
              usageFields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-usage-${index}`}>
                  <div className="col-span-5">
                    <Select value={form.watch(`usages.${index}.menuItemId`)} onValueChange={(v) => form.setValue(`usages.${index}.menuItemId`, v)}>
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Select menu item…" />
                      </SelectTrigger>
                      <SelectContent>
                        {menuItemsData.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Input type="number" step="any" {...form.register(`usages.${index}.quantityPerSale`)} placeholder="Qty/sale" className="text-xs" />
                  </div>
                  <div className="col-span-3">
                    <Select value={form.watch(`usages.${index}.unitId`)} onValueChange={(v) => form.setValue(`usages.${index}.unitId`, v === "__none__" ? "" : v)}>
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {units.map(u => <SelectItem key={u.id} value={u.id}>{u.abbreviation || u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeUsage(index)} data-testid={`button-remove-usage-${index}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Sticky save bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-3xl mx-auto px-6 py-3 flex justify-end gap-3">
            <Button type="button" variant="outline" asChild>
              <Link href="/prep-chart/items">Cancel</Link>
            </Button>
            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-prep-item">
              <Save className="h-4 w-4 mr-2" />
              {saveMutation.isPending ? "Saving…" : "Save Prep Item"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function PrepItemBuilder() {
  return (
    <TierGate feature="prep_chart">
      <PrepItemBuilderContent />
    </TierGate>
  );
}
