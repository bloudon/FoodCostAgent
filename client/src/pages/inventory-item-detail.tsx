import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Package, DollarSign, Ruler, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { filterUnitsBySystem } from "@/lib/utils";
import { useState, useEffect } from "react";
import type { SystemPreferences } from "@shared/schema";

type Product = {
  id: string;
  name: string;
  category: string | null;
  pluSku: string;
  unitId: string;
  barcode: string | null;
  active: number;
  lastCost: number;
  caseSize: number;
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
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);

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
      if (["lastCost", "caseSize", "parLevel", "reorderLevel", "yieldAmount"].includes(field)) {
        const numValue = parseFloat(value);
        if (value !== "" && !isNaN(numValue)) {
          updateMutation.mutate({ [field]: numValue });
        } else if (value === "" && (field === "parLevel" || field === "reorderLevel" || field === "yieldAmount")) {
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

  const handleLocationToggle = (locationId: string) => {
    const newLocations = selectedLocationIds.includes(locationId)
      ? selectedLocationIds.filter(id => id !== locationId)
      : [...selectedLocationIds, locationId];
    setSelectedLocationIds(newLocations);
    updateMutation.mutate({ storageLocationIds: newLocations.length > 0 ? newLocations : null });
  };

  useEffect(() => {
    if (product?.storageLocationIds) {
      setSelectedLocationIds(product.storageLocationIds);
    }
  }, [product]);

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

  const unit = units?.find((u) => u.id === product.unitId);
  const yieldUnit = units?.find((u) => u.id === product.yieldUnitId);
  
  const filteredUnits = filterUnitsBySystem(units, systemPrefs?.unitSystem);
  const costPerPound = product.caseSize ? (product.lastCost / product.caseSize) : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/inventory-items")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Product Details</h1>
            <p className="text-muted-foreground mt-1">
              PLU/SKU: {product.pluSku}
            </p>
          </div>
          <Badge variant={product.active ? "outline" : "secondary"} className="ml-auto">
            {product.active ? "Active" : "Inactive"}
          </Badge>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Product name, category, and image</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Product Name</Label>
              <Input
                id="name"
                value={getFieldValue("name", product.name)}
                onChange={(e) => handleFieldChange("name", e.target.value)}
                onBlur={() => handleFieldBlur("name")}
                disabled={updateMutation.isPending}
                data-testid="input-product-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={getFieldValue("category", product.category || "")}
                onChange={(e) => handleFieldChange("category", e.target.value)}
                onBlur={() => handleFieldBlur("category")}
                placeholder="e.g., Dairy, Produce, Protein"
                disabled={updateMutation.isPending}
                data-testid="input-category"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={getFieldValue("imageUrl", product.imageUrl || "")}
                onChange={(e) => handleFieldChange("imageUrl", e.target.value)}
                onBlur={() => handleFieldBlur("imageUrl")}
                placeholder="https://example.com/image.jpg"
                disabled={updateMutation.isPending}
                data-testid="input-image-url"
              />
            </div>
          </CardContent>
        </Card>

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
                <Label htmlFor="lastCost">Cost Per Case</Label>
                <div className="flex gap-2">
                  <Input
                    id="lastCost"
                    type="number"
                    step="0.01"
                    value={getFieldValue("lastCost", product.lastCost)}
                    onChange={(e) => handleFieldChange("lastCost", e.target.value)}
                    onBlur={() => handleFieldBlur("lastCost")}
                    disabled={updateMutation.isPending}
                    data-testid="input-last-cost"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="caseSize">Case Size (lbs)</Label>
                <Input
                  id="caseSize"
                  type="number"
                  step="0.1"
                  value={getFieldValue("caseSize", product.caseSize)}
                  onChange={(e) => handleFieldChange("caseSize", e.target.value)}
                  onBlur={() => handleFieldBlur("caseSize")}
                  disabled={updateMutation.isPending}
                  data-testid="input-case-size"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Cost per case: ${product.lastCost.toFixed(2)}</p>
                <p>Cost per pound: ${costPerPound.toFixed(4)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Units & Measurements
              </CardTitle>
              <CardDescription>Unit configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="unitId">Unit of Measure</Label>
                <Select
                  value={getFieldValue("unitId", product.unitId)}
                  onValueChange={(value) => {
                    handleFieldChange("unitId", value);
                    handleFieldBlur("unitId");
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger id="unitId" data-testid="select-unit">
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
                <Label htmlFor="yieldAmount">Yield Amount</Label>
                <Input
                  id="yieldAmount"
                  type="number"
                  step="0.01"
                  value={getFieldValue("yieldAmount", product.yieldAmount ?? "")}
                  placeholder="Enter yield amount"
                  onChange={(e) => handleFieldChange("yieldAmount", e.target.value)}
                  onBlur={() => handleFieldBlur("yieldAmount")}
                  disabled={updateMutation.isPending}
                  data-testid="input-yield-amount"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yieldUnitId">Yield Unit</Label>
                <Select
                  value={getFieldValue("yieldUnitId", product.yieldUnitId || "")}
                  onValueChange={(value) => {
                    handleFieldChange("yieldUnitId", value);
                    handleFieldBlur("yieldUnitId");
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger id="yieldUnitId" data-testid="select-yield-unit">
                    <SelectValue placeholder="Select yield unit" />
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
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {locations && locations.length > 0 ? (
                  locations.map((location) => (
                    <div key={location.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`location-${location.id}`}
                        checked={selectedLocationIds.includes(location.id)}
                        onCheckedChange={() => handleLocationToggle(location.id)}
                        data-testid={`checkbox-location-${location.id}`}
                      />
                      <Label
                        htmlFor={`location-${location.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {location.name}
                      </Label>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No storage locations configured
                  </p>
                )}
              </div>
              <div className="border-t pt-4 mt-4 space-y-2">
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
