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
import { SetupProgressBanner } from "@/components/setup-progress-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  manufacturer: string | null;
  categoryId: string | null;
  pluSku: string;
  unitId: string;
  barcode: string | null;
  active: number;
  pricePerUnit: number;
  avgCostPerUnit: number;
  caseSize: number;
  containerSize: number | null;
  containerLabel: string | null;
  containerUnitId: string | null;
  casePkgCount: number | null;
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
  lastCasePrice: number;
  active: number;
  lastOrderDate: string | null;
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
  const [showAddVendorRow, setShowAddVendorRow] = useState(false);
  const [editingVendorItemId, setEditingVendorItemId] = useState<string | null>(null);
  const [showInactiveVendors, setShowInactiveVendors] = useState(false);
  const [purchaseUom, setPurchaseUom] = useState("Case");
  const [showMiddleRow, setShowMiddleRow] = useState(false);
  const [containerDisplaySize, setContainerDisplaySize] = useState<string>("");
  const [selectedContainerUnitId, setSelectedContainerUnitId] = useState<string>("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  
  // Vendor item inline edit state (keyed by vendor item id, or "new" for add row)
  const [vendorRowEdits, setVendorRowEdits] = useState<Record<string, {
    vendorId: string;
    vendorSku: string;
    purchaseUnitId: string;
    caseSize: string;
    innerPackSize: string;
    lastCasePrice: string;
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

  const { data: compatibleUnits } = useQuery<Unit[]>({
    queryKey: ["/api/units/compatible", item?.unitId],
    queryFn: async () => {
      const response = await fetch(`/api/units/compatible?unitId=${item!.unitId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch compatible units");
      return response.json();
    },
    enabled: !!item?.unitId,
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
    if (!item) return;
    setShowMiddleRow(!!(item.casePkgCount && item.casePkgCount > 0));
    // Initialize container display size and unit
    const cUnitId = item.containerUnitId || item.unitId;
    setSelectedContainerUnitId(cUnitId);
    if (item.containerSize && item.containerSize > 0 && units) {
      const baseUnit = units.find(u => u.id === item.unitId);
      const cUnit = units.find(u => u.id === cUnitId);
      if (baseUnit && cUnit && cUnit.toBaseRatio > 0) {
        const displayVal = item.containerSize * (baseUnit.toBaseRatio / cUnit.toBaseRatio);
        setContainerDisplaySize(parseFloat(displayVal.toFixed(6)).toString());
      } else {
        setContainerDisplaySize(item.containerSize > 0 ? String(item.containerSize) : "");
      }
    } else {
      setContainerDisplaySize("");
    }
  }, [item?.id, units]);

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

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/categories", { name });
      return res.json();
    },
    onSuccess: (newCategory: { id: string; name: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      updateMutation.mutate({ categoryId: newCategory.id });
      setShowAddCategory(false);
      setNewCategoryName("");
      toast({ title: "Category created", description: `"${newCategory.name}" has been added.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create category", description: error.message, variant: "destructive" });
    },
  });

  const handleFieldChange = (field: string, value: any) => {
    setEditedFields(prev => ({ ...prev, [field]: value }));
  };

  const handleFieldBlur = (field: string) => {
    if (field in editedFields) {
      const value = editedFields[field];
      // Validate numeric fields
      if (field === "containerLabel") {
        updateMutation.mutate({ containerLabel: value.trim() || null });
      } else if (["containerSize", "casePkgCount"].includes(field)) {
        const numValue = parseFloat(value);
        if (value !== "" && !isNaN(numValue) && numValue > 0) {
          updateMutation.mutate({ [field]: numValue });
        } else if (value === "") {
          updateMutation.mutate({ [field]: null });
        }
      } else if (["pricePerUnit", "caseSize", "parLevel", "reorderLevel", "yieldPercent"].includes(field)) {
        const numValue = parseFloat(value);
        if (value !== "" && !isNaN(numValue)) {
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
          const updates: any = { [field]: numValue };
          if ((field === "parLevel" || field === "reorderLevel") && selectedStoreId && selectedStoreId !== "all") {
            updates.storeId = selectedStoreId;
          }
          updateMutation.mutate(updates);
        } else if (value === "" && (field === "parLevel" || field === "reorderLevel")) {
          const updates: any = { [field]: null };
          if (selectedStoreId && selectedStoreId !== "all") {
            updates.storeId = selectedStoreId;
          }
          updateMutation.mutate(updates);
        } else if (value === "" && field === "yieldPercent") {
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

  const PACK_OPTIONS = ["Case", "Bag", "Box", "Pail", "Drum", "Jug", "Each", "Other"];

  const handleCaseSizeBlur = () => {
    if (!("caseSize" in editedFields)) return;
    const newCaseSize = parseFloat(editedFields["caseSize"]);
    setEditedFields(prev => { const n = { ...prev }; delete n.caseSize; return n; });
    if (!isNaN(newCaseSize) && newCaseSize > 0) {
      const updates: Partial<InventoryItem> = { caseSize: newCaseSize };
      // Recalculate casePkgCount keeping containerSize the same
      if (showMiddleRow && item?.containerSize && item.containerSize > 0) {
        updates.casePkgCount = newCaseSize / item.containerSize;
      }
      updateMutation.mutate(updates);
    }
  };

  // Convert displayed container size value to item's unit using toBaseRatio
  const containerDisplayToItemUnit = (displayVal: number, cUnitId: string): number | null => {
    if (!units || !item) return null;
    const baseUnit = units.find(u => u.id === item.unitId);
    const cUnit = units.find(u => u.id === cUnitId);
    if (!baseUnit || !cUnit || baseUnit.toBaseRatio <= 0) return null;
    return displayVal * (cUnit.toBaseRatio / baseUnit.toBaseRatio);
  };

  const handleContainerSizeBlur = () => {
    const val = parseFloat(containerDisplaySize);
    if (isNaN(val) || val <= 0 || !item) return;
    const containerSizeInItemUnit = containerDisplayToItemUnit(val, selectedContainerUnitId);
    if (containerSizeInItemUnit === null || containerSizeInItemUnit <= 0) return;
    const newCasePkgCount = item.caseSize / containerSizeInItemUnit;
    updateMutation.mutate({
      containerSize: containerSizeInItemUnit,
      containerUnitId: selectedContainerUnitId,
      casePkgCount: newCasePkgCount,
    } as any);
  };

  const handleContainerUnitChange = (newUnitId: string) => {
    setSelectedContainerUnitId(newUnitId);
    const val = parseFloat(containerDisplaySize);
    if (!isNaN(val) && val > 0 && item) {
      const containerSizeInItemUnit = containerDisplayToItemUnit(val, newUnitId);
      if (containerSizeInItemUnit && containerSizeInItemUnit > 0) {
        const newCasePkgCount = item.caseSize / containerSizeInItemUnit;
        updateMutation.mutate({
          containerSize: containerSizeInItemUnit,
          containerUnitId: newUnitId,
          casePkgCount: newCasePkgCount,
        } as any);
      }
    }
  };

  const handleRemoveMiddleRow = () => {
    setShowMiddleRow(false);
    setContainerDisplaySize("");
    setSelectedContainerUnitId(item?.unitId || "");
    updateMutation.mutate({ containerSize: null, casePkgCount: null, containerLabel: null, containerUnitId: null } as any);
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
        lastCasePrice: vendorItem.lastCasePrice.toString(),
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
        lastCasePrice: "0",
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
      lastCasePrice: parseFloat(rowData.lastCasePrice) || 0,
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
    <div className="h-full flex flex-col pb-16">
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
              {item.manufacturer && <span>{item.manufacturer} | </span>}PLU/SKU: {item.pluSku}
            </p>
          </div>
          <Badge variant={item.active ? "outline" : "secondary"}>
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          {/* Vendors Card - At top for visibility */}
          {(() => {
            const activeVendorItems = vendorItems?.filter(vi => vi.active === 1) || [];
            const inactiveVendorItems = vendorItems?.filter(vi => vi.active === 0) || [];
            const displayedVendorItems = showInactiveVendors ? vendorItems : activeVendorItems;
            const hasInactiveVendors = inactiveVendorItems.length > 0;
            
            return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Vendors
                </CardTitle>
                <CardDescription>Suppliers for this item</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {hasInactiveVendors && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowInactiveVendors(!showInactiveVendors)}
                    data-testid="button-toggle-inactive-vendors"
                  >
                    {showInactiveVendors ? "Hide Inactive" : `Show Inactive (${inactiveVendorItems.length})`}
                  </Button>
                )}
                <Button
                  onClick={startAddingVendorRow}
                  size="sm"
                  disabled={showAddVendorRow || editingVendorItemId !== null}
                  data-testid="button-add-vendor"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vendor
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Case Price</TableHead>
                      <TableHead>Case</TableHead>
                      <TableHead>Inner</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Last Order</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedVendorItems && displayedVendorItems.length > 0 ? (
                      displayedVendorItems.map((vi) => {
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
                                  value={rowData.lastCasePrice}
                                  onChange={(e) => updateVendorRowField(vi.id, "lastCasePrice", e.target.value)}
                                  className="w-[90px]"
                                  data-testid={`input-case-price-${vi.id}`}
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
                              <TableCell className="text-muted-foreground">
                                ${(() => {
                                  const casePrice = parseFloat(rowData.lastCasePrice || "0");
                                  const caseSize = parseFloat(rowData.caseSize || "1");
                                  const innerPack = parseFloat(rowData.innerPackSize || "1") || 1;
                                  const totalUnits = caseSize * innerPack;
                                  return totalUnits > 0 ? (casePrice / totalUnits).toFixed(4) : "0.0000";
                                })()}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {vi.lastOrderDate ? new Date(vi.lastOrderDate).toLocaleDateString() : "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Select
                                    value={rowData.active.toString()}
                                    onValueChange={(value) => updateVendorRowField(vi.id, "active", parseInt(value))}
                                  >
                                    <SelectTrigger className="w-[80px]" data-testid={`select-status-${vi.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">Active</SelectItem>
                                      <SelectItem value="0">Inactive</SelectItem>
                                    </SelectContent>
                                  </Select>
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
                            <TableCell>${vi.lastCasePrice.toFixed(2)}</TableCell>
                            <TableCell>{vi.caseSize}</TableCell>
                            <TableCell className="text-muted-foreground">{vi.innerPackSize || "-"}</TableCell>
                            <TableCell className="text-muted-foreground">${vi.lastPrice.toFixed(4)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {vi.lastOrderDate ? new Date(vi.lastOrderDate).toLocaleDateString() : "-"}
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
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          {inactiveVendorItems.length > 0 
                            ? "No active vendors. Use toggle above to show inactive vendors."
                            : "No vendors configured for this item"}
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
                            value={vendorRowEdits.new.lastCasePrice}
                            onChange={(e) => updateVendorRowField("new", "lastCasePrice", e.target.value)}
                            className="w-[90px]"
                            data-testid="input-case-price-new"
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
                        <TableCell className="text-muted-foreground">
                          ${(() => {
                            const casePrice = parseFloat(vendorRowEdits.new.lastCasePrice || "0");
                            const caseSize = parseFloat(vendorRowEdits.new.caseSize || "1");
                            const innerPack = parseFloat(vendorRowEdits.new.innerPackSize || "1") || 1;
                            const totalUnits = caseSize * innerPack;
                            return totalUnits > 0 ? (casePrice / totalUnits).toFixed(4) : "0.0000";
                          })()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">-</TableCell>
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
            );
          })()}

          <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Basic Settings
              </CardTitle>
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
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input
                id="manufacturer"
                value={getFieldValue("manufacturer", item.manufacturer || "")}
                onChange={(e) => handleFieldChange("manufacturer", e.target.value)}
                onBlur={() => handleFieldBlur("manufacturer")}
                disabled={updateMutation.isPending}
                placeholder="e.g., Grande Cheese"
                data-testid="input-manufacturer"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="categoryId">Category</Label>
                {!showAddCategory && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0 px-1 text-xs text-muted-foreground"
                    onClick={() => setShowAddCategory(true)}
                    data-testid="button-add-category-inline"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add new
                  </Button>
                )}
              </div>

              {showAddCategory ? (
                <div className="flex items-center gap-2" data-testid="inline-add-category">
                  <Input
                    autoFocus
                    placeholder="New category name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCategoryName.trim()) {
                        createCategoryMutation.mutate(newCategoryName.trim());
                      } else if (e.key === "Escape") {
                        setShowAddCategory(false);
                        setNewCategoryName("");
                      }
                    }}
                    disabled={createCategoryMutation.isPending}
                    data-testid="input-new-category-name"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                    onClick={() => createCategoryMutation.mutate(newCategoryName.trim())}
                    data-testid="button-create-category-confirm"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => { setShowAddCategory(false); setNewCategoryName(""); }}
                    data-testid="button-create-category-cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
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
              )}
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
            </CardContent>
          </Card>

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

              {/* Purchasing */}
              {(() => {
                const liveCaseSize = getFieldValue("caseSize", item.caseSize);
                const parsedCaseSizeDetail = parseFloat(String(liveCaseSize)) || 0;
                const liveContainerLabel = getFieldValue("containerLabel", item.containerLabel || "");
                // Derived count per case (for display in breakdown table)
                // Compute Qty/Case locally if the user has filled in the size input
                // This shows an immediate value without waiting for a server round-trip
                const localCasePkgCount = (() => {
                  const val = parseFloat(containerDisplaySize);
                  if (!isNaN(val) && val > 0 && item && selectedContainerUnitId && units) {
                    const baseUnit = units.find(u => u.id === item.unitId);
                    const cUnit = units.find(u => u.id === selectedContainerUnitId);
                    if (baseUnit && cUnit && baseUnit.toBaseRatio > 0) {
                      const containerSizeInItemUnit = val * (cUnit.toBaseRatio / baseUnit.toBaseRatio);
                      if (containerSizeInItemUnit > 0 && item.caseSize) {
                        return item.caseSize / containerSizeInItemUnit;
                      }
                    }
                  }
                  return null;
                })();
                const derivedCasePkgCount = (localCasePkgCount ?? item.casePkgCount)
                  ? parseFloat((localCasePkgCount ?? item.casePkgCount!).toFixed(4)).toString()
                  : null;

                return (
                  <>
                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-semibold">Purchasing</p>
                        <p className="text-xs text-muted-foreground">Define how this item is purchased.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Purchase Unit of Measure</Label>
                          <Select value={purchaseUom} onValueChange={setPurchaseUom}>
                            <SelectTrigger data-testid="select-purchase-uom">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PACK_OPTIONS.map(o => (
                                <SelectItem key={o} value={o}>{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Purchase Unit Size</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={liveCaseSize}
                              onChange={(e) => handleFieldChange("caseSize", e.target.value)}
                              onBlur={handleCaseSizeBlur}
                              disabled={updateMutation.isPending}
                              className="flex-1"
                              data-testid="input-case-size"
                            />
                            <span className="flex h-9 min-w-[2.5rem] items-center justify-center rounded-md border px-2 text-sm text-muted-foreground">
                              {unit?.abbreviation || "unit"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-semibold">Breakdown (optional)</p>
                        <p className="text-xs text-muted-foreground">Define pack sizes that convert into the inventory unit.</p>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="pb-2 text-left font-medium">Pack</th>
                            <th className="pb-2 text-left font-medium">Container Size</th>
                            <th className="pb-2 text-left font-medium">Qty / Case</th>
                            <th className="w-8 pb-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="py-1.5 pr-3 text-muted-foreground">{purchaseUom}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">
                              {parsedCaseSizeDetail} {unit?.abbreviation || ""}
                            </td>
                            <td className="py-1.5 text-muted-foreground">1</td>
                            <td></td>
                          </tr>
                          {showMiddleRow && (
                            <tr>
                              <td className="py-1.5 pr-3">
                                <Select
                                  value={liveContainerLabel || ""}
                                  onValueChange={(v) => updateMutation.mutate({ containerLabel: v })}
                                  disabled={updateMutation.isPending}
                                >
                                  <SelectTrigger className="h-8" data-testid="select-inner-pack-label">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PACK_OPTIONS.map(o => (
                                      <SelectItem key={o} value={o}>{o}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="py-1.5 pr-3">
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    step="any"
                                    value={containerDisplaySize}
                                    onChange={(e) => setContainerDisplaySize(e.target.value)}
                                    onBlur={handleContainerSizeBlur}
                                    disabled={updateMutation.isPending}
                                    className="h-8 w-20"
                                    placeholder="e.g., 6"
                                    data-testid="input-container-size"
                                  />
                                  <Select
                                    value={selectedContainerUnitId}
                                    onValueChange={handleContainerUnitChange}
                                    disabled={updateMutation.isPending}
                                  >
                                    <SelectTrigger className="h-8 w-20" data-testid="select-container-unit">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(compatibleUnits ?? (unit ? [unit] : [])).map(u => (
                                        <SelectItem key={u.id} value={u.id}>{u.abbreviation}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </td>
                              <td className="py-1.5 text-muted-foreground">
                                {derivedCasePkgCount ?? "—"}
                              </td>
                              <td className="py-1.5 pl-2">
                                <button
                                  type="button"
                                  onClick={handleRemoveMiddleRow}
                                  disabled={updateMutation.isPending}
                                  className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                                  data-testid="button-remove-inner-pack"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="py-1.5 pr-3 text-muted-foreground">Each</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">1 {unit?.abbreviation || ""}</td>
                            <td className="py-1.5 text-muted-foreground">1</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                      {!showMiddleRow && (
                        <button
                          type="button"
                          onClick={() => setShowMiddleRow(true)}
                          disabled={updateMutation.isPending}
                          className="flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50"
                          data-testid="button-add-pack-size"
                        >
                          <Plus className="h-3 w-3" />
                          Add Pack Size
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Item Flags */}
              <div className="pt-4 border-t space-y-3">
                <Label className="text-sm font-medium">Item Flags</Label>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Star className={`h-4 w-4 ${(item.isPowerItem === 1 || item.isPowerItem === true) ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'}`} />
                    <div className="space-y-0.5">
                      <Label htmlFor="isPowerItem" className="cursor-pointer text-sm font-normal">
                        Power Item
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        High-cost item for power counts
                      </p>
                    </div>
                  </div>
                  <Checkbox
                    id="isPowerItem"
                    checked={item.isPowerItem === 1 || item.isPowerItem === true}
                    onCheckedChange={(checked) => {
                      updateMutation.mutate({ isPowerItem: checked ? 1 : 0 });
                    }}
                    disabled={updateMutation.isPending}
                    data-testid="checkbox-power-item"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Scale className={`h-4 w-4 ${(item.isVariableWeight === 1 || item.isVariableWeight === true) ? 'text-blue-500' : 'text-muted-foreground'}`} />
                    <div className="space-y-0.5">
                      <Label htmlFor="isVariableWeight" className="cursor-pointer text-sm font-normal">
                        Variable Weight
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Catch weight items (meats, cheese)
                      </p>
                    </div>
                  </div>
                  <Checkbox
                    id="isVariableWeight"
                    checked={item.isVariableWeight === 1 || item.isVariableWeight === true}
                    onCheckedChange={(checked) => {
                      updateMutation.mutate({ isVariableWeight: checked ? 1 : 0 });
                    }}
                    disabled={updateMutation.isPending}
                    data-testid="checkbox-variable-weight"
                  />
                </div>
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
      <SetupProgressBanner currentMilestoneId="inventory" hasEntries={true} />
    </div>
  );
}
