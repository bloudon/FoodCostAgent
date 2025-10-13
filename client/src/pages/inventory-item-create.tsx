import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { filterUnitsBySystem, formatUnitName } from "@/lib/utils";
import { useState, useEffect } from "react";
import type { SystemPreferences } from "@shared/schema";

type Unit = {
  id: string;
  name: string;
  kind: string;
  toBaseRatio: number;
  system: string;
};

type StorageLocation = {
  id: string;
  name: string;
  sortOrder: number;
};

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

export default function InventoryItemCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [pluSku, setPluSku] = useState("");
  const [unitId, setUnitId] = useState("");
  const [caseSize, setCaseSize] = useState("20");
  const [barcode, setBarcode] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("0");
  const [yieldPercent, setYieldPercent] = useState("");
  const [parLevel, setParLevel] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [primaryLocationId, setPrimaryLocationId] = useState("");

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: systemPrefs } = useQuery<SystemPreferences>({
    queryKey: ["/api/system-preferences"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // Set default unit to Pound when units are loaded
  useEffect(() => {
    if (units && !unitId) {
      const poundUnit = units.find(u => u.name.toLowerCase() === "pound");
      if (poundUnit) {
        setUnitId(poundUnit.id);
      }
    }
  }, [units, unitId]);

  // Set first selected location as primary
  useEffect(() => {
    if (selectedLocations.length > 0 && !primaryLocationId) {
      setPrimaryLocationId(selectedLocations[0]);
    } else if (selectedLocations.length > 0 && !selectedLocations.includes(primaryLocationId)) {
      setPrimaryLocationId(selectedLocations[0]);
    }
  }, [selectedLocations, primaryLocationId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const data = {
        name: name.trim(),
        categoryId: categoryId || null,
        pluSku: pluSku.trim() || null,
        unitId,
        caseSize: parseFloat(caseSize) || 20,
        barcode: barcode.trim() || null,
        pricePerUnit: parseFloat(pricePerUnit) || 0,
        storageLocationId: primaryLocationId,
        yieldPercent: yieldPercent.trim() !== "" ? parseFloat(yieldPercent.trim()) : null,
        parLevel: parLevel.trim() !== "" ? parseFloat(parLevel.trim()) : null,
        reorderLevel: reorderLevel.trim() !== "" ? parseFloat(reorderLevel.trim()) : null,
        locationIds: selectedLocations,
      };
      const response = await apiRequest("POST", "/api/inventory-items", data);
      return response.json();
    },
    onSuccess: (newItem: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Item created",
        description: "The inventory item has been successfully created.",
      });
      navigate(`/inventory-items/${newItem.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Creation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLocationToggle = (locationId: string) => {
    const newLocations = selectedLocations.includes(locationId)
      ? selectedLocations.filter(id => id !== locationId)
      : [...selectedLocations, locationId];

    if (newLocations.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one storage location is required.",
        variant: "destructive",
      });
      return;
    }

    setSelectedLocations(newLocations);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Validation Error",
        description: "Item name is required.",
        variant: "destructive",
      });
      return;
    }

    if (!unitId) {
      toast({
        title: "Validation Error",
        description: "Unit of measure is required.",
        variant: "destructive",
      });
      return;
    }

    if (selectedLocations.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one storage location is required.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate();
  };

  const filteredUnits = filterUnitsBySystem(units || [], systemPrefs?.unitSystem || "imperial");

  return (
    <div className="p-8">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => navigate("/inventory-items")}
          className="mb-4"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory Items
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-create-title">
          Create Inventory Item
        </h1>
        <p className="text-muted-foreground mt-2">
          Add a new item to your inventory
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Essential item details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Item Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Mozzarella Cheese"
                  required
                  data-testid="input-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="categoryId">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger data-testid="select-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map((category) => (
                      <SelectItem key={category.id} value={category.id} data-testid={`option-category-${category.id}`}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pluSku">PLU/SKU</Label>
                <Input
                  id="pluSku"
                  value={pluSku}
                  onChange={(e) => setPluSku(e.target.value)}
                  placeholder="e.g., MOZZ-001"
                  data-testid="input-plu-sku"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Barcode"
                  data-testid="input-barcode"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unit & Quantity</CardTitle>
              <CardDescription>Measurement and inventory details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="unit">Unit of Measure *</Label>
                <Select value={unitId} onValueChange={setUnitId} required>
                  <SelectTrigger data-testid="select-unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredUnits?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id} data-testid={`option-unit-${unit.id}`}>
                        {formatUnitName(unit.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="caseSize">Case Size</Label>
                <Input
                  id="caseSize"
                  type="number"
                  step="0.01"
                  value={caseSize}
                  onChange={(e) => setCaseSize(e.target.value)}
                  data-testid="input-case-size"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pricePerUnit">Price per Unit ($)</Label>
                <Input
                  id="pricePerUnit"
                  type="number"
                  step="0.01"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  data-testid="input-price-per-unit"
                />
                <p className="text-sm text-muted-foreground">
                  Case cost will be calculated as: ${(parseFloat(pricePerUnit) * parseFloat(caseSize)).toFixed(2)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="yieldPercent">Yield Percentage</Label>
                <Input
                  id="yieldPercent"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={yieldPercent}
                  onChange={(e) => setYieldPercent(e.target.value)}
                  placeholder="e.g., 85"
                  data-testid="input-yield-percent"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storage Locations *</CardTitle>
              <CardDescription>Select all applicable storage locations (at least one required)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {locations?.map((location) => (
                <div key={location.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`location-${location.id}`}
                    checked={selectedLocations.includes(location.id)}
                    onCheckedChange={() => handleLocationToggle(location.id)}
                    data-testid={`checkbox-location-${location.id}`}
                  />
                  <Label
                    htmlFor={`location-${location.id}`}
                    className="text-sm font-normal cursor-pointer flex-1"
                  >
                    {location.name}
                  </Label>
                  {primaryLocationId === location.id && (
                    <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded" data-testid={`badge-primary-${location.id}`}>
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Levels</CardTitle>
              <CardDescription>Par and reorder levels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="parLevel">Par Level</Label>
                <Input
                  id="parLevel"
                  type="number"
                  step="0.01"
                  value={parLevel}
                  onChange={(e) => setParLevel(e.target.value)}
                  placeholder="Target inventory level"
                  data-testid="input-par-level"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reorderLevel">Reorder Level</Label>
                <Input
                  id="reorderLevel"
                  type="number"
                  step="0.01"
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  placeholder="Level to trigger reorder"
                  data-testid="input-reorder-level"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            type="submit"
            disabled={createMutation.isPending}
            data-testid="button-create-item"
          >
            {createMutation.isPending ? "Creating..." : "Create Item"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/inventory-items")}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
