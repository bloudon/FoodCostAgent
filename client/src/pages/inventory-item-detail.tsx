import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useStoreContext } from "@/hooks/use-store-context";
import { ArrowLeft, Package, DollarSign, Ruler, MapPin, Users, Plus, Pencil, Trash2, Settings, Star, Scale, Check, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { filterUnitsBySystem, formatUnitName } from "@/lib/utils";
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
  avgCostPerUnit: number;
  caseSize: number;
  storageLocationId: string;
  yieldPercent: number;
  imageUrl: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  isPowerItem: number | boolean;
  isVariableWeight: number | boolean;
};

type Unit = {
  id: string;
  name: string;
  abbreviation: string;
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
  brandName: string | null;
  purchaseUnitId: string;
  caseSize: number;
  innerPackSize: number | null;
  lastPrice: number;
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { selectedStoreId } = useStoreContext();
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [deleteVendorItemId, setDeleteVendorItemId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<string | undefined>(undefined);
  const [showAddVendorRow, setShowAddVendorRow] = useState(false);
  const [editingVendorItemId, setEditingVendorItemId] = useState<string | null>(null);
  
  // Vendor item inline edit state (keyed by vendor item id, or "new" for add row)
  const [vendorRowEdits, setVendorRowEdits] = useState<Record<string, {
    vendorId: string;
    vendorSku: string;
    purchaseUnitId: string;
    caseSize: string;
    innerPackSize: string;
    lastPrice: string;
    active: number;
  }>>({});

  const { data: item, isLoading: itemLoading } = useQuery<InventoryItem>({
    queryKey: ["/api/inventory-items", id, "detail", selectedStoreId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStoreId && selectedStoreId !== "all") {
        params.append("store_id", selectedStoreId);
      }
      const url = `/api/inventory-items/${id}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: !!id,
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

  const { data: storeData } = useQuery<{
    associations: { id: string; storeId: string; inventoryItemId: string }[];
    allStores: { id: string; name: string }[];
  }>({
    queryKey: ["/api/inventory-items", id, "stores"],
    enabled: !!id,
  });

  useEffect(() => {
    if (itemLocations) {
      setSelectedLocations(itemLocations.map(loc => loc.storageLocationId));
    }
  }, [itemLocations]);

  useEffect(() => {
    if (storeData?.associations) {
      setSelectedStores(storeData.associations.map(assoc => assoc.storeId));
    }
  }, [storeData]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<InventoryItem> & { locationIds?: string[]; storeId?: string }) => {
      return apiRequest("PATCH", `/api/inventory-items/${id}`, updates);
    },
    onSuccess: () => {
      // Invalidate all inventory-items queries (list, detail, locations, estimated-on-hand)
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          (query.queryKey[0] === "/api/inventory-items" ||
           query.queryKey[0] === "/api/inventory-items/estimated-on-hand"),
        refetchType: "active"
      });
      // Invalidate all recipe queries (list, detail, components) because recipe costs depend on ingredient prices
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          (query.queryKey[0] === "/api/recipes" || query.queryKey[0] === "/api/recipe-components"),
        refetchType: "active"
      });
      // Invalidate vendor items because they include inventory item prices
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          query.queryKey.some(key => typeof key === 'string' && (key.includes('vendor-items') || key.includes('vendor-prices'))),
        refetchType: "active"
      });
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
          // Validate yieldPercent range
          if (field === "yieldPercent" && (numValue < 1 || numValue > 100)) {
            toast({
              title: "Validation Error",
              description: "Yield percentage must be between 1 and 100.",
              variant: "destructive",
            });
            setEditedFields(prev => {
              const newFields = { ...prev };
              delete newFields[field];
              return newFields;
            });
            return;
          }
          // Include storeId for par/reorder levels when in store context
          const updates: any = { [field]: numValue };
          if ((field === "parLevel" || field === "reorderLevel") && selectedStoreId && selectedStoreId !== "all") {
            updates.storeId = selectedStoreId;
          }
          updateMutation.mutate(updates);
        } else if (value === "" && (field === "parLevel" || field === "reorderLevel")) {
          // Include storeId for par/reorder levels when in store context
          const updates: any = { [field]: null };
          if (selectedStoreId && selectedStoreId !== "all") {
            updates.storeId = selectedStoreId;
          }
          updateMutation.mutate(updates);
        } else if (value === "" && field === "yieldPercent") {
          // Default to 95 if empty
          updateMutation.mutate({ [field]: 95 });
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
    
    // Update the mutation with new locations only (no storageLocationId field in new schema)
    updateMutation.mutate({
      locationIds: newLocations,
    });
  };

  const updateStoresMutation = useMutation({
    mutationFn: async (storeIds: string[]) => {
      return apiRequest("POST", `/api/inventory-items/${id}/stores`, { storeIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Stores updated",
        description: "Store locations have been successfully updated.",
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

  const handleStoreToggle = (storeId: string) => {
    const newStores = selectedStores.includes(storeId)
      ? selectedStores.filter(id => id !== storeId)
      : [...selectedStores, storeId];
    
    // Check if this would result in zero stores
    if (newStores.length === 0) {
      toast({
        title: "At least one store required",
        description: "An inventory item must be available in at least one store.",
        variant: "destructive",
      });
      return;
    }
    
    // Update state and trigger mutation
    setSelectedStores(newStores);
    updateStoresMutation.mutate(newStores);
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
      setShowAddVendorRow(false);
      setVendorRowEdits(prev => {
        const newEdits = { ...prev };
        delete newEdits.new;
        return newEdits;
      });
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id, "vendor-items"] });
      toast({
        title: "Vendor updated",
        description: "The vendor information has been successfully updated.",
      });
      setEditingVendorItemId(null);
      setVendorRowEdits(prev => {
        const newEdits = { ...prev };
        delete newEdits[variables.id];
        return newEdits;
      });
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

  // Initialize edit state for a vendor item row
  const startEditingVendorRow = (vendorItem: VendorItem) => {
    setEditingVendorItemId(vendorItem.id);
    setVendorRowEdits(prev => ({
      ...prev,
      [vendorItem.id]: {
        vendorId: vendorItem.vendorId,
        vendorSku: vendorItem.vendorSku || "",
        purchaseUnitId: vendorItem.purchaseUnitId,
        caseSize: vendorItem.caseSize.toString(),
        innerPackSize: vendorItem.innerPackSize?.toString() || "",
        lastPrice: vendorItem.lastPrice.toString(),
        active: vendorItem.active,
      }
    }));
  };

  // Initialize new vendor row
  const startAddingVendorRow = () => {
    setShowAddVendorRow(true);
    setVendorRowEdits(prev => ({
      ...prev,
      new: {
        vendorId: "",
        vendorSku: "",
        purchaseUnitId: item?.unitId || "",
        caseSize: "1",
        innerPackSize: "",
        lastPrice: "0",
        active: 1,
      }
    }));
  };

  const cancelEditingVendorRow = (rowId: string) => {
    if (rowId === "new") {
      setShowAddVendorRow(false);
    } else {
      setEditingVendorItemId(null);
    }
    setVendorRowEdits(prev => {
      const newEdits = { ...prev };
      delete newEdits[rowId];
      return newEdits;
    });
  };

  const updateVendorRowField = (rowId: string, field: string, value: any) => {
    setVendorRowEdits(prev => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        [field]: value,
      }
    }));
  };

  const saveVendorRow = (rowId: string) => {
    const rowData = vendorRowEdits[rowId];
    if (!rowData) return;

    const data = {
      inventoryItemId: id,
      vendorId: rowData.vendorId,
      vendorSku: rowData.vendorSku.trim() || null,
      purchaseUnitId: rowData.purchaseUnitId,
      caseSize: parseFloat(rowData.caseSize) || 1,
      innerPackSize: rowData.innerPackSize.trim() !== "" ? parseFloat(rowData.innerPackSize) : null,
      lastPrice: parseFloat(rowData.lastPrice) || 0,
      active: rowData.active,
    };

    if (rowId === "new") {
      createVendorItemMutation.mutate(data);
    } else {
      updateVendorItemMutation.mutate({ id: rowId, data });
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

  return (
    <div className="h-full flex flex-col">
      {/* Fixed Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="flex items-center gap-4 px-6 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigate("/inventory-items");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{item.name}</h1>
              {(item.isPowerItem === 1 || item.isPowerItem === true) && (
                <Star className="h-5 w-5 fill-yellow-500 text-yellow-500" data-testid="icon-power-item" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              PLU/SKU: {item.pluSku}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(settingsOpen ? undefined : "settings")}
            data-testid="button-settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Badge variant={item.active ? "outline" : "secondary"}>
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          {/* Power Item Toggle - Above the fold */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <Star className={`h-5 w-5 ${(item.isPowerItem === 1 || item.isPowerItem === true) ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'}`} />
              <div className="space-y-0.5">
                <Label htmlFor="isPowerItem-header" className="cursor-pointer font-medium">
                  Power Item
                </Label>
                <p className="text-xs text-muted-foreground">
                  High-cost item tracked more frequently in power inventory counts
                </p>
              </div>
            </div>
            <Checkbox
              id="isPowerItem-header"
              checked={item.isPowerItem === 1 || item.isPowerItem === true}
              onCheckedChange={(checked) => {
                updateMutation.mutate({ isPowerItem: checked ? 1 : 0 });
              }}
              disabled={updateMutation.isPending}
              data-testid="checkbox-power-item"
            />
          </div>

          {/* Variable Weight Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <Scale className={`h-5 w-5 ${(item.isVariableWeight === 1 || item.isVariableWeight === true) ? 'text-blue-500' : 'text-muted-foreground'}`} />
              <div className="space-y-0.5">
                <Label htmlFor="isVariableWeight-header" className="cursor-pointer font-medium">
                  Variable Weight (Catch Weight)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Actual weight differs from ordered quantity (meats, cheeses)
                </p>
              </div>
            </div>
            <Checkbox
              id="isVariableWeight-header"
              checked={item.isVariableWeight === 1 || item.isVariableWeight === true}
              onCheckedChange={(checked) => {
                updateMutation.mutate({ isVariableWeight: checked ? 1 : 0 });
              }}
              disabled={updateMutation.isPending}
              data-testid="checkbox-variable-weight"
            />
          </div>
          {/* Basic Information Accordion */}
          <Accordion type="single" collapsible value={settingsOpen} onValueChange={setSettingsOpen}>
            <AccordionItem value="settings" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span className="font-semibold">Basic Settings</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 space-y-4">
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
                  updateMutation.mutate({ categoryId: value || null });
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
              <Label>Item Image</Label>
              <div className="flex items-start gap-4">
                {item.imageUrl && (
                  <div className="flex-shrink-0">
                    <img 
                      src={`${item.imageUrl}?thumbnail=true`} 
                      alt={item.name}
                      className="w-20 h-20 object-cover rounded-md border"
                      data-testid="img-inventory-item"
                    />
                  </div>
                )}
                <ObjectUploader
                  maxFileSize={10485760}
                  onUploadComplete={async (objectPath: string) => {
                    try {
                      await apiRequest("PUT", `/api/inventory-items/${id}/image`, {
                        imageUrl: objectPath,
                      });
                      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", id] });
                      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
                      toast({
                        title: "Image uploaded",
                        description: "The item image has been successfully uploaded.",
                      });
                    } catch (error: any) {
                      toast({
                        title: "Upload failed",
                        description: error.message,
                        variant: "destructive",
                      });
                    }
                  }}
                  buttonText={item.imageUrl ? "Change Image" : "Upload Image"}
                  buttonVariant="outline"
                  dataTestId="button-upload-image"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a product image (max 10MB). Thumbnails will be automatically generated.
              </p>
            </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Last Cost (per {unit?.abbreviation || 'unit'})</Label>
                  <div className="text-2xl font-semibold" data-testid="text-last-cost">
                    ${item.pricePerUnit?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Avg Cost / WAC (per {unit?.abbreviation || 'unit'})</Label>
                  <div className="text-2xl font-semibold" data-testid="text-avg-cost">
                    ${item.avgCostPerUnit?.toFixed(2) || '0.00'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pricing is automatically derived from receiving history. Case sizes are managed per vendor.
              </p>
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
                <Label htmlFor="unitId">Unit of Measure *</Label>
                <Select
                  value={getFieldValue("unitId", item.unitId)}
                  onValueChange={(value) => {
                    updateMutation.mutate({ unitId: value });
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger id="unitId" data-testid="select-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredUnits?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {formatUnitName(unit.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="yieldPercent">Yield Percentage *</Label>
                <div className="flex gap-2">
                  <Input
                    id="yieldPercent"
                    type="number"
                    step="0.1"
                    min="1"
                    max="100"
                    value={getFieldValue("yieldPercent", item.yieldPercent ?? 95)}
                    placeholder="95"
                    onChange={(e) => handleFieldChange("yieldPercent", e.target.value)}
                    onBlur={() => handleFieldBlur("yieldPercent")}
                    disabled={updateMutation.isPending}
                    required
                    data-testid="input-yield-percent"
                  />
                  <div className="flex items-center px-3 text-muted-foreground">%</div>
                </div>
                <p className="text-xs text-muted-foreground">Usable percentage after trimming/waste. Default is 95%.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Store Locations
              </CardTitle>
              <CardDescription>Physical stores where this item is available</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Available Stores</Label>
                <p className="text-sm text-muted-foreground">
                  Select all store locations where this item should be available. Items are identified by PLU/SKU: {item?.pluSku || "Not set"}
                </p>
                <div className="space-y-2 border rounded-md p-3">
                  {storeData?.allStores?.map((store) => {
                    return (
                      <div key={store.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`store-${store.id}`}
                          checked={selectedStores.includes(store.id)}
                          onCheckedChange={() => handleStoreToggle(store.id)}
                          disabled={updateStoresMutation.isPending}
                          data-testid={`checkbox-store-${store.id}`}
                        />
                        <Label 
                          htmlFor={`store-${store.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {store.name}
                        </Label>
                      </div>
                    );
                  })}
                </div>
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
                  {locations?.map((loc) => {
                    const isPrimary = itemLocations?.find(il => il.storageLocationId === loc.id)?.isPrimary === 1;
                    return (
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
                          {isPrimary && (
                            <Badge variant="outline" className="ml-2">Primary</Badge>
                          )}
                        </Label>
                      </div>
                    );
                  })}
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
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Vendors
                </CardTitle>
                <CardDescription>Suppliers for this item</CardDescription>
              </div>
              <Button
                onClick={startAddingVendorRow}
                size="sm"
                disabled={showAddVendorRow || editingVendorItemId !== null}
                data-testid="button-add-vendor"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Vendor
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Case</TableHead>
                      <TableHead>Inner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendorItems && vendorItems.length > 0 ? (
                      vendorItems.map((vi) => {
                        const isEditing = editingVendorItemId === vi.id;
                        const rowData = vendorRowEdits[vi.id];

                        if (isEditing && rowData) {
                          return (
                            <TableRow key={vi.id} data-testid={`vendor-item-row-${vi.id}`}>
                              <TableCell>
                                <Select
                                  value={rowData.vendorId}
                                  onValueChange={(value) => updateVendorRowField(vi.id, "vendorId", value)}
                                >
                                  <SelectTrigger className="w-[140px]" data-testid={`select-vendor-${vi.id}`}>
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
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={rowData.vendorSku}
                                  onChange={(e) => updateVendorRowField(vi.id, "vendorSku", e.target.value)}
                                  placeholder="SKU"
                                  className="w-[100px]"
                                  data-testid={`input-sku-${vi.id}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowData.purchaseUnitId}
                                  onValueChange={(value) => updateVendorRowField(vi.id, "purchaseUnitId", value)}
                                >
                                  <SelectTrigger className="w-[100px]" data-testid={`select-unit-${vi.id}`}>
                                    <SelectValue placeholder="Unit" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {filteredUnits?.map((unit) => (
                                      <SelectItem key={unit.id} value={unit.id}>
                                        {formatUnitName(unit.name)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={rowData.lastPrice}
                                  onChange={(e) => updateVendorRowField(vi.id, "lastPrice", e.target.value)}
                                  className="w-[80px]"
                                  data-testid={`input-price-${vi.id}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={rowData.caseSize}
                                  onChange={(e) => updateVendorRowField(vi.id, "caseSize", e.target.value)}
                                  className="w-[70px]"
                                  data-testid={`input-case-${vi.id}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="1"
                                  value={rowData.innerPackSize}
                                  onChange={(e) => updateVendorRowField(vi.id, "innerPackSize", e.target.value)}
                                  placeholder="-"
                                  className="w-[60px]"
                                  data-testid={`input-inner-${vi.id}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowData.active.toString()}
                                  onValueChange={(value) => updateVendorRowField(vi.id, "active", parseInt(value))}
                                >
                                  <SelectTrigger className="w-[90px]" data-testid={`select-status-${vi.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">Active</SelectItem>
                                    <SelectItem value="0">Inactive</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => saveVendorRow(vi.id)}
                                    disabled={!rowData.vendorId || !rowData.purchaseUnitId || updateVendorItemMutation.isPending}
                                    data-testid={`button-save-vendor-${vi.id}`}
                                  >
                                    <Check className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => cancelEditingVendorRow(vi.id)}
                                    data-testid={`button-cancel-vendor-${vi.id}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        }

                        return (
                          <TableRow key={vi.id} data-testid={`vendor-item-row-${vi.id}`}>
                            <TableCell className="font-medium">{vi.vendor?.name || "Unknown"}</TableCell>
                            <TableCell className="text-muted-foreground">{vi.vendorSku || "-"}</TableCell>
                            <TableCell>{formatUnitName(vi.unit?.name)}</TableCell>
                            <TableCell>${vi.lastPrice.toFixed(2)}</TableCell>
                            <TableCell>{vi.caseSize}</TableCell>
                            <TableCell className="text-muted-foreground">{vi.innerPackSize || "-"}</TableCell>
                            <TableCell>
                              <Badge variant={vi.active ? "outline" : "secondary"} data-testid={`badge-vendor-status-${vi.id}`}>
                                {vi.active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => startEditingVendorRow(vi)}
                                  disabled={editingVendorItemId !== null || showAddVendorRow}
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
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : !showAddVendorRow && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No vendors configured for this item
                        </TableCell>
                      </TableRow>
                    )}

                    {showAddVendorRow && vendorRowEdits.new && (
                      <TableRow data-testid="vendor-item-row-new">
                        <TableCell>
                          <Select
                            value={vendorRowEdits.new.vendorId}
                            onValueChange={(value) => updateVendorRowField("new", "vendorId", value)}
                          >
                            <SelectTrigger className="w-[140px]" data-testid="select-vendor-new">
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
                        </TableCell>
                        <TableCell>
                          <Input
                            value={vendorRowEdits.new.vendorSku}
                            onChange={(e) => updateVendorRowField("new", "vendorSku", e.target.value)}
                            placeholder="SKU"
                            className="w-[100px]"
                            data-testid="input-sku-new"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={vendorRowEdits.new.purchaseUnitId}
                            onValueChange={(value) => updateVendorRowField("new", "purchaseUnitId", value)}
                          >
                            <SelectTrigger className="w-[100px]" data-testid="select-unit-new">
                              <SelectValue placeholder="Unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredUnits?.map((unit) => (
                                <SelectItem key={unit.id} value={unit.id}>
                                  {formatUnitName(unit.name)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={vendorRowEdits.new.lastPrice}
                            onChange={(e) => updateVendorRowField("new", "lastPrice", e.target.value)}
                            className="w-[80px]"
                            data-testid="input-price-new"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={vendorRowEdits.new.caseSize}
                            onChange={(e) => updateVendorRowField("new", "caseSize", e.target.value)}
                            className="w-[70px]"
                            data-testid="input-case-new"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="1"
                            value={vendorRowEdits.new.innerPackSize}
                            onChange={(e) => updateVendorRowField("new", "innerPackSize", e.target.value)}
                            placeholder="-"
                            className="w-[60px]"
                            data-testid="input-inner-new"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={vendorRowEdits.new.active.toString()}
                            onValueChange={(value) => updateVendorRowField("new", "active", parseInt(value))}
                          >
                            <SelectTrigger className="w-[90px]" data-testid="select-status-new">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Active</SelectItem>
                              <SelectItem value="0">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => saveVendorRow("new")}
                              disabled={!vendorRowEdits.new.vendorId || !vendorRowEdits.new.purchaseUnitId || createVendorItemMutation.isPending}
                              data-testid="button-save-vendor-new"
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelEditingVendorRow("new")}
                              data-testid="button-cancel-vendor-new"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

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
