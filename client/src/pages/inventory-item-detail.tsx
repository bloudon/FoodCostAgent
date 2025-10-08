import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Package, DollarSign, Ruler, MapPin, Users, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { filterUnitsBySystem } from "@/lib/utils";
import { useState, useEffect } from "react";
import type { SystemPreferences } from "@shared/schema";

type InventoryItem = {
  id: string;
  name: string;
  categoryId: string | null;
  pluSku: string;
  unitId: string;
  barcode: string | null;
  active: number;
  pricePerUnit: number;
  caseSize: number;
  storageLocationId: string;
  yieldPercent: number | null;
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

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

type Vendor = {
  id: string;
  name: string;
  accountNumber: string | null;
};

type VendorItem = {
  id: string;
  vendorId: string;
  inventoryItemId: string;
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
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [vendorItemDialogOpen, setVendorItemDialogOpen] = useState(false);
  const [editingVendorItem, setEditingVendorItem] = useState<VendorItem | null>(null);
  const [deleteVendorItemId, setDeleteVendorItemId] = useState<string | null>(null);
  
  // Vendor item form state
  const [vendorItemForm, setVendorItemForm] = useState({
    vendorId: "",
    vendorSku: "",
    purchaseUnitId: "",
    caseSize: "1",
    innerPackSize: "",
    lastPrice: "0",
    leadTimeDays: "",
    active: 1,
  });

  const { data: item, isLoading: itemLoading } = useQuery<InventoryItem>({
    queryKey: ["/api/inventory-items", id],
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

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: itemLocations } = useQuery<{ id: string; inventoryItemId: string; storageLocationId: string; isPrimary: number }[]>({
    queryKey: ["/api/inventory-items", id, "locations"],
    enabled: !!id,
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorItems } = useQuery<VendorItem[]>({
    queryKey: ["/api/inventory-items", id, "vendor-items"],
    enabled: !!id,
  });

  useEffect(() => {
    if (itemLocations) {
      setSelectedLocations(itemLocations.map(loc => loc.storageLocationId));
    }
  }, [itemLocations]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<InventoryItem> & { locationIds?: string[] }) => {
      return apiRequest("PATCH", `/api/inventory-items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Item updated",
        description: "The inventory item has been successfully updated.",
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
      if (["pricePerUnit", "caseSize", "parLevel", "reorderLevel", "yieldPercent"].includes(field)) {
        const numValue = parseFloat(value);
        if (value !== "" && !isNaN(numValue)) {
          updateMutation.mutate({ [field]: numValue });
        } else if (value === "" && (field === "parLevel" || field === "reorderLevel" || field === "yieldPercent")) {
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

  const handleLocationToggle = (locationId: string) => {
    const newLocations = selectedLocations.includes(locationId)
      ? selectedLocations.filter(id => id !== locationId)
      : [...selectedLocations, locationId];
    
    // Check if this would result in zero locations BEFORE updating state
    if (newLocations.length === 0) {
      toast({
        title: "At least one location required",
        description: "An inventory item must have at least one storage location.",
        variant: "destructive",
      });
      return;
    }
    
    // Update state only if validation passes
    setSelectedLocations(newLocations);
    
    // Update the mutation with new locations
    const primaryLocationId = newLocations.includes(item!.storageLocationId)
      ? item!.storageLocationId
      : newLocations[0];
    
    updateMutation.mutate({
      locationIds: newLocations,
      storageLocationId: primaryLocationId,
    });
  };

  const createVendorItemMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/vendor-items", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "vendor-items"] });
      toast({
        title: "Vendor added",
        description: "The vendor has been successfully added to this item.",
      });
      setVendorItemDialogOpen(false);
      resetVendorItemForm();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add vendor",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVendorItemMutation = useMutation({
    mutationFn: async ({ id: vendorItemId, data }: { id: string; data: any }) => {
      const response = await apiRequest("PATCH", `/api/vendor-items/${vendorItemId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "vendor-items"] });
      toast({
        title: "Vendor updated",
        description: "The vendor information has been successfully updated.",
      });
      setVendorItemDialogOpen(false);
      setEditingVendorItem(null);
      resetVendorItemForm();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update vendor",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVendorItemMutation = useMutation({
    mutationFn: async (vendorItemId: string) => {
      await apiRequest("DELETE", `/api/vendor-items/${vendorItemId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "vendor-items"] });
      toast({
        title: "Vendor removed",
        description: "The vendor has been successfully removed from this item.",
      });
      setDeleteVendorItemId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove vendor",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetVendorItemForm = () => {
    setVendorItemForm({
      vendorId: "",
      vendorSku: "",
      purchaseUnitId: "",
      caseSize: "1",
      innerPackSize: "",
      lastPrice: "0",
      leadTimeDays: "",
      active: 1,
    });
  };

  const handleOpenAddVendorDialog = () => {
    resetVendorItemForm();
    setEditingVendorItem(null);
    setVendorItemDialogOpen(true);
  };

  const handleOpenEditVendorDialog = (vendorItem: VendorItem) => {
    setEditingVendorItem(vendorItem);
    setVendorItemForm({
      vendorId: vendorItem.vendorId,
      vendorSku: vendorItem.vendorSku || "",
      purchaseUnitId: vendorItem.purchaseUnitId,
      caseSize: vendorItem.caseSize.toString(),
      innerPackSize: vendorItem.innerPackSize?.toString() || "",
      lastPrice: vendorItem.lastPrice.toString(),
      leadTimeDays: vendorItem.leadTimeDays?.toString() || "",
      active: vendorItem.active,
    });
    setVendorItemDialogOpen(true);
  };

  const handleSaveVendorItem = () => {
    const data = {
      inventoryItemId: id,
      vendorId: vendorItemForm.vendorId,
      vendorSku: vendorItemForm.vendorSku.trim() || null,
      purchaseUnitId: vendorItemForm.purchaseUnitId,
      caseSize: parseFloat(vendorItemForm.caseSize) || 1,
      innerPackSize: vendorItemForm.innerPackSize.trim() !== "" ? parseFloat(vendorItemForm.innerPackSize) : null,
      lastPrice: parseFloat(vendorItemForm.lastPrice) || 0,
      leadTimeDays: vendorItemForm.leadTimeDays.trim() !== "" ? parseInt(vendorItemForm.leadTimeDays) : null,
      active: vendorItemForm.active,
    };

    if (editingVendorItem) {
      updateVendorItemMutation.mutate({ id: editingVendorItem.id, data });
    } else {
      createVendorItemMutation.mutate(data);
    }
  };

  if (itemLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Item not found</div>
      </div>
    );
  }

  const unit = units?.find((u) => u.id === item.unitId);
  const location = locations?.find((l) => l.id === item.storageLocationId);
  
  const filteredUnits = filterUnitsBySystem(units, systemPrefs?.unitSystem);
  const caseCost = item.pricePerUnit * item.caseSize;

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
            <h1 className="text-3xl font-bold">Inventory Item Details</h1>
            <p className="text-muted-foreground mt-1">
              PLU/SKU: {item.pluSku}
            </p>
          </div>
          <Badge variant={item.active ? "outline" : "secondary"} className="ml-auto">
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Item name, category, and image</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Item Name</Label>
              <Input
                id="name"
                value={getFieldValue("name", item.name)}
                onChange={(e) => handleFieldChange("name", e.target.value)}
                onBlur={() => handleFieldBlur("name")}
                disabled={updateMutation.isPending}
                data-testid="input-item-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoryId">Category</Label>
              <Select 
                value={getFieldValue("categoryId", item.categoryId || "")} 
                onValueChange={(value) => {
                  handleFieldChange("categoryId", value);
                  handleFieldBlur("categoryId");
                }}
                disabled={updateMutation.isPending}
              >
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
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={getFieldValue("imageUrl", item.imageUrl || "")}
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
                <Label htmlFor="pricePerUnit">Price Per Unit</Label>
                <div className="flex gap-2">
                  <Input
                    id="pricePerUnit"
                    type="number"
                    step="0.01"
                    value={getFieldValue("pricePerUnit", item.pricePerUnit)}
                    onChange={(e) => handleFieldChange("pricePerUnit", e.target.value)}
                    onBlur={() => handleFieldBlur("pricePerUnit")}
                    disabled={updateMutation.isPending}
                    data-testid="input-price-per-unit"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="caseSize">Case Size (lbs)</Label>
                <Input
                  id="caseSize"
                  type="number"
                  step="0.1"
                  value={getFieldValue("caseSize", item.caseSize)}
                  onChange={(e) => handleFieldChange("caseSize", e.target.value)}
                  onBlur={() => handleFieldBlur("caseSize")}
                  disabled={updateMutation.isPending}
                  data-testid="input-case-size"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Price per unit: ${item.pricePerUnit.toFixed(2)}</p>
                <p>Case cost: ${caseCost.toFixed(2)} (${item.pricePerUnit.toFixed(2)} × {item.caseSize})</p>
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
                  value={getFieldValue("unitId", item.unitId)}
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
                <Label htmlFor="yieldPercent">Yield Percentage</Label>
                <div className="flex gap-2">
                  <Input
                    id="yieldPercent"
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={getFieldValue("yieldPercent", item.yieldPercent ?? "")}
                    placeholder="e.g., 75"
                    onChange={(e) => handleFieldChange("yieldPercent", e.target.value)}
                    onBlur={() => handleFieldBlur("yieldPercent")}
                    disabled={updateMutation.isPending}
                    data-testid="input-yield-percent"
                  />
                  <div className="flex items-center px-3 text-muted-foreground">%</div>
                </div>
                <p className="text-xs text-muted-foreground">Usable yield after trimming/waste</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Storage & Inventory
              </CardTitle>
              <CardDescription>Location and inventory levels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Storage Locations</Label>
                <p className="text-sm text-muted-foreground">Select all locations where this item is stored</p>
                <div className="space-y-2 border rounded-md p-3">
                  {locations?.map((loc) => (
                    <div key={loc.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`location-${loc.id}`}
                        checked={selectedLocations.includes(loc.id)}
                        onCheckedChange={() => handleLocationToggle(loc.id)}
                        disabled={updateMutation.isPending}
                        data-testid={`checkbox-location-${loc.id}`}
                      />
                      <Label 
                        htmlFor={`location-${loc.id}`}
                        className="text-sm font-normal cursor-pointer flex-1"
                      >
                        {loc.name}
                        {loc.id === item.storageLocationId && (
                          <Badge variant="outline" className="ml-2">Primary</Badge>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="parLevel">Par Level</Label>
                <Input
                  id="parLevel"
                  type="number"
                  step="0.01"
                  value={getFieldValue("parLevel", item.parLevel ?? "")}
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
                  value={getFieldValue("reorderLevel", item.reorderLevel ?? "")}
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Vendors
                </CardTitle>
                <CardDescription>Suppliers for this item</CardDescription>
              </div>
              <Button
                onClick={handleOpenAddVendorDialog}
                size="sm"
                data-testid="button-add-vendor"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Vendor
              </Button>
            </CardHeader>
            <CardContent>
              {vendorItems && vendorItems.length > 0 ? (
                <div className="space-y-3">
                  {vendorItems.map((vi) => (
                    <div key={vi.id} className="border rounded-lg p-4 space-y-2" data-testid={`vendor-item-${vi.id}`}>
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{vi.vendor?.name || "Unknown Vendor"}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant={vi.active ? "outline" : "secondary"} data-testid={`badge-vendor-status-${vi.id}`}>
                            {vi.active ? "Active" : "Inactive"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEditVendorDialog(vi)}
                            data-testid={`button-edit-vendor-${vi.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteVendorItemId(vi.id)}
                            data-testid={`button-delete-vendor-${vi.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {vi.vendorSku && (
                        <p className="text-sm text-muted-foreground">SKU: {vi.vendorSku}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Price: </span>
                          <span className="font-medium">${vi.lastPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Unit: </span>
                          <span className="font-medium">{vi.unit?.name || "Unknown"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Case Size: </span>
                          <span className="font-medium">{vi.caseSize}</span>
                        </div>
                        {vi.leadTimeDays && (
                          <div>
                            <span className="text-muted-foreground">Lead Time: </span>
                            <span className="font-medium">{vi.leadTimeDays} days</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground mb-4">No vendors configured for this item</p>
                  <Button
                    variant="outline"
                    onClick={handleOpenAddVendorDialog}
                    data-testid="button-add-first-vendor"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Vendor
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Vendor Item Dialog */}
      <Dialog open={vendorItemDialogOpen} onOpenChange={setVendorItemDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingVendorItem ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
            <DialogDescription>
              {editingVendorItem ? "Update vendor information for this item" : "Add a new vendor for this item"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorId">Vendor *</Label>
                <Select
                  value={vendorItemForm.vendorId}
                  onValueChange={(value) => setVendorItemForm({ ...vendorItemForm, vendorId: value })}
                >
                  <SelectTrigger id="vendorId" data-testid="select-vendor">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors?.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorSku">Vendor SKU</Label>
                <Input
                  id="vendorSku"
                  value={vendorItemForm.vendorSku}
                  onChange={(e) => setVendorItemForm({ ...vendorItemForm, vendorSku: e.target.value })}
                  placeholder="Vendor's SKU"
                  data-testid="input-vendor-sku"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="purchaseUnitId">Purchase Unit *</Label>
                <Select
                  value={vendorItemForm.purchaseUnitId}
                  onValueChange={(value) => setVendorItemForm({ ...vendorItemForm, purchaseUnitId: value })}
                >
                  <SelectTrigger id="purchaseUnitId" data-testid="select-purchase-unit">
                    <SelectValue placeholder="Select unit" />
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
                <Label htmlFor="lastPrice">Price per Case ($) *</Label>
                <Input
                  id="lastPrice"
                  type="number"
                  step="0.01"
                  value={vendorItemForm.lastPrice}
                  onChange={(e) => setVendorItemForm({ ...vendorItemForm, lastPrice: e.target.value })}
                  data-testid="input-last-price"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="caseSize">Case Size *</Label>
                <Input
                  id="caseSize"
                  type="number"
                  step="0.01"
                  value={vendorItemForm.caseSize}
                  onChange={(e) => setVendorItemForm({ ...vendorItemForm, caseSize: e.target.value })}
                  data-testid="input-case-size"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="innerPackSize">Inner Pack Size</Label>
                <Input
                  id="innerPackSize"
                  type="number"
                  step="0.01"
                  value={vendorItemForm.innerPackSize}
                  onChange={(e) => setVendorItemForm({ ...vendorItemForm, innerPackSize: e.target.value })}
                  placeholder="Optional"
                  data-testid="input-inner-pack-size"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="leadTimeDays">Lead Time (days)</Label>
                <Input
                  id="leadTimeDays"
                  type="number"
                  value={vendorItemForm.leadTimeDays}
                  onChange={(e) => setVendorItemForm({ ...vendorItemForm, leadTimeDays: e.target.value })}
                  placeholder="Optional"
                  data-testid="input-lead-time-days"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="active">Status</Label>
                <Select
                  value={vendorItemForm.active.toString()}
                  onValueChange={(value) => setVendorItemForm({ ...vendorItemForm, active: parseInt(value) })}
                >
                  <SelectTrigger id="active" data-testid="select-active">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setVendorItemDialogOpen(false);
                setEditingVendorItem(null);
                resetVendorItemForm();
              }}
              data-testid="button-cancel-vendor"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveVendorItem}
              disabled={!vendorItemForm.vendorId || !vendorItemForm.purchaseUnitId || createVendorItemMutation.isPending || updateVendorItemMutation.isPending}
              data-testid="button-save-vendor"
            >
              {createVendorItemMutation.isPending || updateVendorItemMutation.isPending ? "Saving..." : editingVendorItem ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteVendorItemId} onOpenChange={() => setDeleteVendorItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this vendor from this item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteVendorItemId) {
                  deleteVendorItemMutation.mutate(deleteVendorItemId);
                }
              }}
              disabled={deleteVendorItemMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteVendorItemMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
