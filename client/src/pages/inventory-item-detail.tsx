import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Package, DollarSign, Ruler, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { filterUnitsBySystem } from "@/lib/utils";
import { useState } from "react";
import type { SystemPreferences } from "@shared/schema";

type Product = {
  id: string;
  name: string;
  category: string | null;
  pluSku: string;
  baseUnitId: string;
  microUnitId: string;
  microUnitsPerPurchaseUnit: number;
  barcode: string | null;
  active: number;
  lastCost: number;
  storageLocationIds: string[] | null;
  yieldAmount: number | null;
  yieldUnitId: string | null;
  imageUrl: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
};

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

type VendorProduct = {
  id: string;
  vendorId: string;
  productId: string;
  vendorSku: string | null;
  purchaseUnitId: string;
  caseSize: number;
  innerPackSize: number | null;
  lastPrice: number;
  leadTimeDays: number | null;
  active: number;
  vendor: {
    id: string;
    name: string;
    accountNumber: string | null;
  } | null;
  unit: {
    id: string;
    name: string;
  } | null;
};

export default function InventoryItemDetail() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});

  const { data: product, isLoading: productLoading } = useQuery<Product>({
    queryKey: ["/api/products", id],
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: systemPrefs } = useQuery<SystemPreferences>({
    queryKey: ["/api/system-preferences"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: vendorProducts } = useQuery<VendorProduct[]>({
    queryKey: ["/api/products", id, "vendor-products"],
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Product>) => {
      return apiRequest("PATCH", `/api/products/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Product updated",
        description: "The product has been successfully updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFieldChange = (field: string, value: any) => {
    setEditedFields(prev => ({ ...prev, [field]: value }));
  };

  const handleFieldBlur = (field: string) => {
    if (field in editedFields) {
      const value = editedFields[field];
      // Validate numeric fields
      if (["lastCost", "microUnitsPerPurchaseUnit", "parLevel", "reorderLevel"].includes(field)) {
        const numValue = parseFloat(value);
        if (value !== "" && !isNaN(numValue)) {
          updateMutation.mutate({ [field]: numValue });
        } else if (value === "" && (field === "parLevel" || field === "reorderLevel")) {
          updateMutation.mutate({ [field]: null });
        }
      } else {
        updateMutation.mutate({ [field]: value });
      }
      setEditedFields(prev => {
        const newFields = { ...prev };
        delete newFields[field];
        return newFields;
      });
    }
  };

  const getFieldValue = (field: string, defaultValue: any) => {
    return field in editedFields ? editedFields[field] : defaultValue;
  };

  if (productLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Product not found</div>
      </div>
    );
  }

  const baseUnit = units?.find((u) => u.id === product.baseUnitId);
  const microUnit = units?.find((u) => u.id === product.microUnitId);
  const yieldUnit = units?.find((u) => u.id === product.yieldUnitId);
  
  const filteredUnits = filterUnitsBySystem(units, systemPrefs?.unitSystem);

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/inventory-items")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{product.name}</h1>
            <p className="text-muted-foreground mt-1">
              {product.category || "Uncategorized"} • PLU/SKU: {product.pluSku}
            </p>
          </div>
          <Badge variant={product.active ? "outline" : "secondary"} className="ml-auto">
            {product.active ? "Active" : "Inactive"}
          </Badge>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Pricing
              </CardTitle>
              <CardDescription>Cost and pricing information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="lastCost">Cost Per Micro-Unit</Label>
                <div className="flex gap-2">
                  <Input
                    id="lastCost"
                    type="number"
                    step="0.0001"
                    value={getFieldValue("lastCost", product.lastCost)}
                    onChange={(e) => handleFieldChange("lastCost", e.target.value)}
                    onBlur={() => handleFieldBlur("lastCost")}
                    disabled={updateMutation.isPending}
                    data-testid="input-last-cost"
                  />
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Current cost: ${product.lastCost.toFixed(4)} per {microUnit?.name || "micro-unit"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Units & Measurements
              </CardTitle>
              <CardDescription>Unit configuration and conversions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="baseUnitId">Base Unit</Label>
                <Select
                  value={getFieldValue("baseUnitId", product.baseUnitId)}
                  onValueChange={(value) => {
                    handleFieldChange("baseUnitId", value);
                    handleFieldBlur("baseUnitId");
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger id="baseUnitId" data-testid="select-base-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredUnits?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="microUnitId">Micro-Unit</Label>
                <Select
                  value={getFieldValue("microUnitId", product.microUnitId)}
                  onValueChange={(value) => {
                    handleFieldChange("microUnitId", value);
                    handleFieldBlur("microUnitId");
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger id="microUnitId" data-testid="select-micro-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredUnits?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="microUnitsPerPurchaseUnit">Micro-Units Per Purchase Unit</Label>
                <Input
                  id="microUnitsPerPurchaseUnit"
                  type="number"
                  step="0.01"
                  value={getFieldValue("microUnitsPerPurchaseUnit", product.microUnitsPerPurchaseUnit)}
                  onChange={(e) => handleFieldChange("microUnitsPerPurchaseUnit", e.target.value)}
                  onBlur={() => handleFieldBlur("microUnitsPerPurchaseUnit")}
                  disabled={updateMutation.isPending}
                  data-testid="input-micro-units-per-purchase"
                />
              </div>
              {product.yieldAmount && (
                <div className="space-y-2">
                  <Label>Yield</Label>
                  <div className="text-sm font-medium">
                    {product.yieldAmount} {yieldUnit?.name || "units"}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Storage Locations
              </CardTitle>
              <CardDescription>Where this product is stored</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {product.storageLocationIds && product.storageLocationIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {product.storageLocationIds.map((locId) => {
                    const location = locations?.find((l) => l.id === locId);
                    return (
                      <Badge key={locId} variant="outline" data-testid={`badge-location-${locId}`}>
                        {location?.name || "Unknown"}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No storage locations assigned</p>
              )}
              <div className="mt-4 space-y-2">
                <Label htmlFor="parLevel">Par Level</Label>
                <Input
                  id="parLevel"
                  type="number"
                  step="0.01"
                  value={getFieldValue("parLevel", product.parLevel ?? "")}
                  placeholder="Not set"
                  onChange={(e) => handleFieldChange("parLevel", e.target.value)}
                  onBlur={() => handleFieldBlur("parLevel")}
                  disabled={updateMutation.isPending}
                  data-testid="input-par-level"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reorderLevel">Reorder Level</Label>
                <Input
                  id="reorderLevel"
                  type="number"
                  step="0.01"
                  value={getFieldValue("reorderLevel", product.reorderLevel ?? "")}
                  placeholder="Not set"
                  onChange={(e) => handleFieldChange("reorderLevel", e.target.value)}
                  onBlur={() => handleFieldBlur("reorderLevel")}
                  disabled={updateMutation.isPending}
                  data-testid="input-reorder-level"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Vendors
              </CardTitle>
              <CardDescription>Suppliers for this product</CardDescription>
            </CardHeader>
            <CardContent>
              {vendorProducts && vendorProducts.length > 0 ? (
                <div className="space-y-4">
                  {vendorProducts.map((vp) => (
                    <div key={vp.id} className="border rounded-lg p-4 space-y-2" data-testid={`vendor-product-${vp.id}`}>
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{vp.vendor?.name || "Unknown Vendor"}</h4>
                        <Badge variant={vp.active ? "outline" : "secondary"}>
                          {vp.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      {vp.vendorSku && (
                        <p className="text-sm text-muted-foreground">SKU: {vp.vendorSku}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Price: </span>
                          <span className="font-medium">${vp.lastPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Unit: </span>
                          <span className="font-medium">{vp.unit?.name || "Unknown"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Case Size: </span>
                          <span className="font-medium">{vp.caseSize}</span>
                        </div>
                        {vp.leadTimeDays && (
                          <div>
                            <span className="text-muted-foreground">Lead Time: </span>
                            <span className="font-medium">{vp.leadTimeDays} days</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No vendors configured for this product</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
