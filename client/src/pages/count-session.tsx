import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Package, DollarSign, Layers, X, Lock, LockOpen } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUnitName } from "@/lib/utils";
import type { Company, CompanyStore } from "@shared/schema";

type CountMode = 'tare' | 'case' | 'simple';

function getCountMode(category: any, location: any): CountMode {
  if (category?.isTareWeightCategory === 1) {
    return 'tare';
  }
  if (location?.allowCaseCounting === 1) {
    return 'case';
  }
  return 'simple';
}

interface CountQuantityEditorProps {
  line: any;
  item: any;
  mode: CountMode;
  isEditing: boolean;
  editingQty: string;
  editingCaseQty: string;
  editingLooseUnits: string;
  onFocus: () => void;
  onQtyChange: (value: string) => void;
  onCaseQtyChange: (value: string) => void;
  onLooseUnitsChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  readOnly?: boolean;
}

function CountQuantityEditor({
  line,
  item,
  mode,
  isEditing,
  editingQty,
  editingCaseQty,
  editingLooseUnits,
  onFocus,
  onQtyChange,
  onCaseQtyChange,
  onLooseUnitsChange,
  onBlur,
  onKeyDown,
  readOnly = false
}: CountQuantityEditorProps) {
  if (mode === 'case') {
    const caseQty = isEditing ? editingCaseQty : (line.caseQty != null ? line.caseQty.toString() : '');
    const looseUnits = isEditing ? editingLooseUnits : (line.looseUnits != null ? line.looseUnits.toString() : '');
    
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Cases</label>
          <Input
            type="number"
            step="1"
            min="0"
            value={caseQty}
            onFocus={onFocus}
            onChange={(e) => onCaseQtyChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="w-24 h-9"
            disabled={readOnly}
            data-testid={`input-case-qty-${line.id}`}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Loose Units</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={looseUnits}
            onFocus={onFocus}
            onChange={(e) => onLooseUnitsChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="w-24 h-9"
            disabled={readOnly}
            data-testid={`input-loose-units-${line.id}`}
          />
        </div>
        <div className="text-sm text-muted-foreground mt-5">
          = {((parseFloat(caseQty.toString()) || 0) * (item?.caseSize || 0) + (parseFloat(looseUnits.toString()) || 0)).toFixed(2)} {item?.unitName}
        </div>
      </div>
    );
  }
  
  // Both 'tare' and 'simple' modes show a single quantity field
  // Tare weight categories use regular qty field for accurate scale measurements
  return (
    <Input
      type="number"
      step="0.01"
      value={isEditing ? editingQty : line.qty}
      onFocus={onFocus}
      onChange={(e) => onQtyChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="w-32 h-9"
      disabled={readOnly}
      data-testid={`input-qty-${line.id}`}
    />
  );
}

export default function CountSession() {
  const params = useParams();
  const countId = params.id;
  
  // Get URL search parameters for filtering and navigation
  const urlParams = new URLSearchParams(window.location.search);
  const filterItemId = urlParams.get('item');
  const sourceCountId = urlParams.get('from');
  
  const [groupBy, setGroupBy] = useState<"location" | "category">("location"); // Toggle between location and category grouping
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedItemId, setSelectedItemId] = useState<string>(filterItemId || "all");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  
  // Update filter when URL parameters change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemFilter = params.get('item');
    if (itemFilter) {
      setSelectedItemId(itemFilter);
    } else {
      setSelectedItemId("all");
    }
  }, [window.location.search]);
  const [editingQty, setEditingQty] = useState<string>("");
  const [editingCaseQty, setEditingCaseQty] = useState<string>("");
  const [editingLooseUnits, setEditingLooseUnits] = useState<string>("");
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [wasTabPressed, setWasTabPressed] = useState(false);
  const [itemEditForm, setItemEditForm] = useState({
    name: "",
    categoryId: "",
    pricePerUnit: "",
    caseSize: "",
    parLevel: "",
    reorderLevel: "",
  });
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  // Fetch company and store information for this count
  const { data: company } = useQuery<Company>({
    queryKey: count?.companyId ? [`/api/companies/${count.companyId}`] : [],
    enabled: !!count?.companyId,
  });

  const { data: store } = useQuery<CompanyStore>({
    queryKey: count?.storeId ? [`/api/stores/${count.storeId}`] : [],
    enabled: !!count?.storeId,
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
    enabled: !!countId,
  });

  const { data: previousData } = useQuery<{previousCountId: string | null, lines: any[]}>({
    queryKey: ["/api/inventory-counts", countId, "previous-lines"],
    enabled: !!countId,
  });
  
  const previousCountId = previousData?.previousCountId || null;
  const previousLines = previousData?.lines || [];

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const { data: categoriesData } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; qty: number; caseQty?: number | null; looseUnits?: number | null }) => {
      return apiRequest("PATCH", `/api/inventory-count-lines/${data.id}`, { 
        qty: data.qty,
        caseQty: data.caseQty,
        looseUnits: data.looseUnits
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      // Don't show toast for every field change - it's too noisy
      // Don't clear editing state here - let the next field's onFocus handle it
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update count",
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = (line: any, mode: CountMode) => {
    setEditingLineId(line.id);
    
    if (mode === 'case') {
      // Initialize case counting fields - use existing values or start with blank
      if (line.caseQty != null || line.looseUnits != null) {
        // Use existing case count data
        setEditingCaseQty(line.caseQty != null ? line.caseQty.toString() : '');
        setEditingLooseUnits(line.looseUnits != null ? line.looseUnits.toString() : '');
      } else {
        // Start with empty fields for first-time entry
        setEditingCaseQty('');
        setEditingLooseUnits('');
      }
      setEditingQty("");
    } else {
      // Simple or tare mode - just use qty
      setEditingQty(line.qty.toString());
      setEditingCaseQty("");
      setEditingLooseUnits("");
    }
  };

  const handleSaveEdit = (lineId: string, mode: CountMode, item: any) => {
    // Prevent edits in read-only mode
    if (count && count.canEdit === false) {
      return;
    }
    
    let qty: number;
    let caseQty: number | null = null;
    let looseUnits: number | null = null;
    
    if (mode === 'case') {
      // Calculate qty from case counts
      // Only save values if they're actually entered (not empty strings)
      const casesValue = editingCaseQty.trim();
      const looseValue = editingLooseUnits.trim();
      const caseSize = item?.caseSize || 0;
      
      const cases = casesValue !== '' ? parseFloat(casesValue) : 0;
      const loose = looseValue !== '' ? parseFloat(looseValue) : 0;
      
      qty = (cases * caseSize) + loose;
      
      // Only store case counts if at least one field has a value
      if (casesValue !== '' || looseValue !== '') {
        caseQty = casesValue !== '' ? cases : 0;
        looseUnits = looseValue !== '' ? loose : 0;
      }
    } else {
      // Simple or tare mode - use qty directly
      qty = parseFloat(editingQty) || 0;
    }
    
    if (!isNaN(qty) && qty >= 0) {
      updateMutation.mutate({ id: lineId, qty, caseQty, looseUnits });
    }
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditingQty("");
    setEditingCaseQty("");
    setEditingLooseUnits("");
  };

  const handleOpenItemEdit = (item: any) => {
    setEditingItem(item);
    setItemEditForm({
      name: item.name || "",
      categoryId: item.categoryId || "",
      pricePerUnit: item.pricePerUnit?.toString() || "",
      caseSize: item.caseSize?.toString() || "",
      parLevel: item.parLevel?.toString() || "",
      reorderLevel: item.reorderLevel?.toString() || "",
    });
  };

  const handleCloseItemEdit = () => {
    setEditingItem(null);
    setItemEditForm({
      name: "",
      categoryId: "",
      pricePerUnit: "",
      caseSize: "",
      parLevel: "",
      reorderLevel: "",
    });
  };

  const updateItemMutation = useMutation({
    mutationFn: async (data: any) => {
      // Update the inventory item
      await apiRequest("PATCH", `/api/inventory-items/${editingItem.id}`, data);
      
      // If price was updated and we're in a count session, update the count line's unitCost snapshot
      if (data.pricePerUnit !== undefined && countId) {
        const lineToUpdate = countLines?.find(line => line.inventoryItemId === editingItem.id);
        if (lineToUpdate) {
          await apiRequest("PATCH", `/api/inventory-count-lines/${lineToUpdate.id}`, {
            unitCost: data.pricePerUnit,
          });
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      toast({
        title: "Success",
        description: "Item and count values updated successfully",
      });
      handleCloseItemEdit();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update item",
        variant: "destructive",
      });
    },
  });

  const handleSaveItem = () => {
    const updates: any = {
      name: itemEditForm.name,
      categoryId: (itemEditForm.categoryId && itemEditForm.categoryId !== "none") ? itemEditForm.categoryId : null,
      pricePerUnit: parseFloat(itemEditForm.pricePerUnit),
      caseSize: parseFloat(itemEditForm.caseSize),
      parLevel: itemEditForm.parLevel ? parseFloat(itemEditForm.parLevel) : null,
      reorderLevel: itemEditForm.reorderLevel ? parseFloat(itemEditForm.reorderLevel) : null,
    };

    if (!updates.name || isNaN(updates.pricePerUnit) || isNaN(updates.caseSize)) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateItemMutation.mutate(updates);
  };

  const applyCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/inventory-counts/${countId}/apply`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Inventory Count Applied",
        description: "On-hand quantities have been updated to match the counted values",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to apply count",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const unlockCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inventory-counts/${countId}/unlock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Unlocked",
        description: "You can now edit this inventory count session",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to unlock session",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const lockCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inventory-counts/${countId}/lock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Locked",
        description: "This inventory count session is now locked",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to lock session",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Get unique categories from inventory items
  const categories = Array.from(new Set(
    inventoryItems?.map((p: any) => p.category).filter(Boolean) || []
  )).sort();

  // Filter lines based on location (for category accordion)
  let linesForCategoryTotals = countLines || [];
  if (selectedLocation !== "all") {
    linesForCategoryTotals = linesForCategoryTotals.filter(line => {
      const item = line.inventoryItem;
      const locationId = item?.storageLocationId || "unknown";
      return locationId === selectedLocation;
    });
  }

  // Calculate category totals from filtered lines (by location/empty, not by category)
  const categoryTotals = linesForCategoryTotals.reduce((acc: any, line) => {
    const item = line.inventoryItem;
    const category = item?.category || "Uncategorized";
    const value = line.qty * (line.unitCost || 0);
    
    if (!acc[category]) {
      acc[category] = { count: 0, value: 0, items: 0 };
    }
    acc[category].count += line.qty;
    acc[category].value += value;
    acc[category].items += 1;
    return acc;
  }, {}) || {};

  // Filter lines based on category (for location accordion)
  let linesForLocationTotals = countLines || [];
  if (selectedCategory !== "all") {
    linesForLocationTotals = linesForLocationTotals.filter(line => {
      const item = line.inventoryItem;
      const category = item?.category || "Uncategorized";
      return category === selectedCategory;
    });
  }

  // Calculate location totals from filtered lines (by category/empty, not by location)
  const locationTotals = linesForLocationTotals.reduce((acc: any, line) => {
    const item = line.inventoryItem;
    const locationId = item?.storageLocationId || "unknown";
    const locationName = storageLocations?.find(l => l.id === locationId)?.name || "Unknown Location";
    const value = line.qty * (line.unitCost || 0);
    
    if (!acc[locationId]) {
      acc[locationId] = { name: locationName, count: 0, value: 0, items: 0 };
    }
    acc[locationId].count += line.qty;
    acc[locationId].value += value;
    acc[locationId].items += 1;
    return acc;
  }, {}) || {};

  // Filter lines for display (all filters applied)
  let filteredLines = countLines || [];
  
  if (selectedCategory !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const category = item?.category || "Uncategorized";
      return category === selectedCategory;
    });
  }
  
  if (selectedLocation !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const locationId = item?.storageLocationId || "unknown";
      return locationId === selectedLocation;
    });
  }
  
  if (selectedItemId !== "all") {
    filteredLines = filteredLines.filter(line => line.inventoryItemId === selectedItemId);
  }

  // Note: Items maintain their natural order (as created in database)
  // This prevents items from jumping around when counts are recorded

  // Create a lookup map for previous quantities by inventory item ID
  // Aggregate all previous lines for the same item across all locations
  // This shows the TOTAL previous quantity count for each item
  const previousQuantitiesByItemId = (previousLines || []).reduce((acc: any, line) => {
    if (!acc[line.inventoryItemId]) {
      acc[line.inventoryItemId] = 0;
    }
    acc[line.inventoryItemId] += line.qty;
    return acc;
  }, {});

  // Calculate totals from FILTERED lines so stats match what's displayed
  const totalValue = filteredLines.reduce((sum, line) => {
    return sum + (line.qty * (line.unitCost || 0));
  }, 0);

  const totalItems = filteredLines.length;
  
  // Calculate unique categories in filtered results
  const displayedCategories = new Set(
    filteredLines.map(line => line.inventoryItem?.category || "Uncategorized")
  ).size;

  const countDate = count ? new Date(count.countedAt) : null;

  if (countLoading || linesLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const isReadOnly = count && (count.canEdit === false || count.applied === 1);
  
  return (
    <div className="p-8">
      <div className="mb-8">
        <Link href={sourceCountId ? `/count/${sourceCountId}` : "/inventory-sessions"}>
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {sourceCountId ? "Back to Previous Session" : "Back to Sessions"}
          </Button>
        </Link>
        
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-session-title">
              Count Session Details {company && store && `(${company.name} - ${store.name})`}
            </h1>
            <p className="text-muted-foreground mt-2">
              {countDate?.toLocaleDateString()} {countDate?.toLocaleTimeString()}
            </p>
            {!isReadOnly ? (
              <p className="text-sm text-muted-foreground mt-1">
                Click on a quantity to edit. Use filters below to view items by category or location.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                This is a historical count session. Use filters below to view items by category or location.
              </p>
            )}
          </div>
          
          {count && !count.applied && !isReadOnly && (
            <Button
              onClick={() => applyCountMutation.mutate()}
              disabled={applyCountMutation.isPending}
              variant="default"
              data-testid="button-apply-count"
            >
              <Package className="h-4 w-4 mr-2" />
              Apply Count to Inventory
            </Button>
          )}
        </div>
      </div>

      {/* Read-Only Banner */}
      {isReadOnly && (
        <Alert className="mb-8 border-amber-500/50 bg-amber-500/10" data-testid="alert-read-only">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Historical Session (Read-Only)</strong> - This inventory count is from a previous date and cannot be edited. Only administrators can modify historical data.
              </AlertDescription>
            </div>
            {(user?.role === "global_admin" || user?.role === "company_admin") && count?.applied === 1 && (
              <Button
                onClick={() => unlockCountMutation.mutate()}
                disabled={unlockCountMutation.isPending}
                variant="outline"
                size="sm"
                data-testid="button-unlock-session"
              >
                <LockOpen className="h-4 w-4 mr-2" />
                {unlockCountMutation.isPending ? "Unlocking..." : "Unlock Session"}
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Lock Session Button for admins on unlocked sessions */}
      {!isReadOnly && count?.applied === 0 && (user?.role === "global_admin" || user?.role === "company_admin") && (
        <div className="mb-8 flex justify-end">
          <Button
            onClick={() => lockCountMutation.mutate()}
            disabled={lockCountMutation.isPending}
            variant="outline"
            size="sm"
            data-testid="button-lock-session"
          >
            <Lock className="h-4 w-4 mr-2" />
            {lockCountMutation.isPending ? "Locking..." : "Lock Session"}
          </Button>
        </div>
      )}

      {/* Mini Dashboard - Sticky Stats Bar */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b mb-8 -mx-8 px-8 py-3">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Total Value</div>
              <div className="text-lg font-bold font-mono" data-testid="text-dashboard-total-value">
                ${totalValue.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Total Items</div>
              <div className="text-lg font-bold font-mono" data-testid="text-dashboard-total-items">
                {totalItems}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Categories</div>
              <div className="text-lg font-bold font-mono" data-testid="text-dashboard-categories">
                {displayedCategories}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Totals */}
      <Card className="mb-8">
        <Accordion type="single" collapsible>
          <AccordionItem value="categories" className="border-0">
            <AccordionTrigger className="px-6 pt-6 pb-2 hover:no-underline" tabIndex={-1}>
              <div className="flex flex-col items-start gap-1">
                <CardTitle>Categories</CardTitle>
                <p className="text-sm text-muted-foreground font-normal">Click a category to filter items below</p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(categoryTotals).filter(([_, data]: [string, any]) => data.items > 0).map(([category, data]: [string, any]) => (
                  <div 
                    key={category} 
                    className={`border rounded-lg p-4 hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                      selectedCategory === category ? 'bg-accent border-accent-border' : ''
                    }`}
                    onClick={() => setSelectedCategory(selectedCategory === category ? "all" : category)}
                    tabIndex={-1}
                    data-testid={`card-category-${category.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div className="font-semibold mb-2">{category}</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Items:</span>
                        <span className="font-mono">{data.items}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Value:</span>
                        <span className="font-mono font-semibold">${data.value.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Location Totals */}
      <Card className="mb-8">
        <Accordion type="single" collapsible>
          <AccordionItem value="locations" className="border-0">
            <AccordionTrigger className="px-6 pt-6 pb-2 hover:no-underline" tabIndex={-1}>
              <div className="flex flex-col items-start gap-1">
                <CardTitle>Locations</CardTitle>
                <p className="text-sm text-muted-foreground font-normal">Click a location to filter items below</p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(locationTotals)
                  .filter(([_, data]: [string, any]) => data.items > 0)
                  .sort((a, b) => {
                    const locA = storageLocations?.find(l => l.id === a[0]);
                    const locB = storageLocations?.find(l => l.id === b[0]);
                    return (locA?.sortOrder ?? 999) - (locB?.sortOrder ?? 999);
                  })
                  .map(([locationId, data]: [string, any]) => (
                  <div 
                    key={locationId} 
                    className={`border rounded-lg p-4 hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                      selectedLocation === locationId ? 'bg-accent border-accent-border' : ''
                    }`}
                    onClick={() => setSelectedLocation(selectedLocation === locationId ? "all" : locationId)}
                    tabIndex={-1}
                    data-testid={`card-location-${data.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div className="font-semibold mb-2">{data.name}</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Items:</span>
                        <span className="font-mono">{data.items}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Value:</span>
                        <span className="font-mono font-semibold">${data.value.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Count Lines Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>Items</CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
              {(selectedCategory !== "all" || selectedLocation !== "all" || selectedItemId !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSelectedLocation("all");
                    setSelectedItemId("all");
                  }}
                  data-testid="button-clear-filters"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear Filters
                </Button>
              )}
              {selectedItemId !== "all" && (
                <div className="text-sm text-muted-foreground">
                  Showing: <span className="font-medium">{filteredLines[0]?.inventoryItem?.name || 'Unknown Item'}</span>
                </div>
              )}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Group by:</Label>
                  <Button
                    variant={groupBy === "location" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGroupBy("location")}
                    data-testid="button-group-location"
                  >
                    <Layers className="h-4 w-4 mr-1" />
                    Location
                  </Button>
                  <Button
                    variant={groupBy === "category" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGroupBy("category")}
                    data-testid="button-group-category"
                  >
                    <Package className="h-4 w-4 mr-1" />
                    Category
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredLines && filteredLines.length > 0 ? (
              (() => {
                // Group by location or category based on groupBy state
                const grouped: Record<string, any[]> = {};
                const groupOrder: string[] = []; // Track the order groups appear
                
                filteredLines.forEach(line => {
                  let groupKey: string;
                  if (groupBy === "location") {
                    const item = line.inventoryItem;
                    groupKey = item?.storageLocationId || "unknown";
                  } else {
                    const item = line.inventoryItem;
                    groupKey = item?.category || "Uncategorized";
                  }
                  
                  if (!grouped[groupKey]) {
                    grouped[groupKey] = [];
                    groupOrder.push(groupKey);
                  }
                  grouped[groupKey].push(line);
                });

                // Sort groupOrder by storage location sortOrder when grouping by location
                if (groupBy === "location") {
                  groupOrder.sort((a, b) => {
                    const locA = storageLocations?.find(l => l.id === a);
                    const locB = storageLocations?.find(l => l.id === b);
                    return (locA?.sortOrder ?? 999) - (locB?.sortOrder ?? 999);
                  });
                }

                return (
                  <Accordion 
                    type="multiple" 
                    defaultValue={groupOrder} 
                    className="w-full"
                    key={groupOrder.join(',') + groupBy} // Force remount when filtered items or groupBy changes
                  >
                    {groupOrder.map((groupKey) => {
                      const lines = grouped[groupKey];
                      
                      // Get group name
                      let groupName: string;
                      if (groupBy === "location") {
                        groupName = storageLocations?.find(l => l.id === groupKey)?.name || "Unknown Location";
                      } else {
                        groupName = groupKey;
                      }
                      
                      // Calculate aggregate totals for this group
                      const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
                      const totalValue = lines.reduce((sum, l) => sum + (l.qty * (l.unitCost || 0)), 0);
                      
                      return (
                        <AccordionItem key={groupKey} value={groupKey} className="border rounded-md mb-2">
                          <AccordionTrigger className="px-4 py-2 hover:no-underline bg-muted/30 hover:bg-muted/50 data-[state=open]:bg-muted/40" tabIndex={-1} data-testid={`accordion-group-${groupKey}`}>
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-4 flex-1">
                                <span className="font-medium text-left">
                                  {groupName}
                                </span>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <span>{lines.length} items</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-6 text-sm">
                                <div className="text-right">
                                  <div className="font-mono font-semibold">${totalValue.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">Total Value</div>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {groupBy === "category" ? (
                              // Category view: Group by item, show locations underneath
                              <div className="space-y-4 p-4">
                                {(() => {
                                  // Group lines by inventory item
                                  const itemGroups: Record<string, any[]> = {};
                                  lines.forEach(line => {
                                    const itemId = line.inventoryItemId;
                                    if (!itemGroups[itemId]) {
                                      itemGroups[itemId] = [];
                                    }
                                    itemGroups[itemId].push(line);
                                  });
                                  
                                  return Object.entries(itemGroups).map(([itemId, itemLines]) => {
                                    const firstLine = itemLines[0];
                                    const item = firstLine.inventoryItem;
                                    
                                    // Calculate current total for this item across ALL locations (not just current group)
                                    const allItemLines = countLines?.filter(l => l.inventoryItemId === itemId) || [];
                                    const currentTotal = allItemLines.reduce((sum, l) => sum + l.qty, 0);
                                    const itemTotalValue = allItemLines.reduce((sum, l) => sum + (l.qty * (l.unitCost || 0)), 0);
                                    
                                    // Get previous total from previous session (aggregated across all locations)
                                    const previousTotal = previousLines
                                      .filter(pl => pl.inventoryItemId === itemId)
                                      .reduce((sum, pl) => sum + (pl.qty || 0), 0);
                                    
                                    const unitName = item?.unitName || 'unit';
                                    
                                    return (
                                      <div key={itemId} className="border rounded-lg p-3 space-y-3" data-testid={`item-group-${itemId}`}>
                                        {/* Item Header */}
                                        <div className="flex items-center justify-between gap-4 pb-2 border-b">
                                          <div className="flex-1">
                                            {isReadOnly ? (
                                              <div className="font-medium" data-testid={`text-item-name-${itemId}`}>
                                                {item?.name || 'Unknown'}
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() => handleOpenItemEdit(item)}
                                                className="text-left hover:underline font-medium"
                                                tabIndex={-1}
                                                data-testid={`button-edit-item-${itemId}`}
                                              >
                                                {item?.name || 'Unknown'}
                                              </button>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-6 text-sm">
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-qty-${itemId}`}>
                                              {currentTotal.toFixed(2)}
                                            </div>
                                            <div className="text-muted-foreground">
                                              {formatUnitName(unitName)}
                                            </div>
                                            <div className="font-mono" data-testid={`text-item-unit-price-${itemId}`}>
                                              ${(firstLine.unitCost || 0).toFixed(2)}
                                            </div>
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-value-${itemId}`}>
                                              ${itemTotalValue.toFixed(2)}
                                            </div>
                                            {previousTotal > 0 && previousCountId && (
                                              <Link href={`/count/${previousCountId}?from=${countId}&item=${itemId}`}>
                                                <div className="text-muted-foreground hover:underline cursor-pointer" data-testid={`link-previous-${itemId}`}>
                                                  Prev: <span className="font-mono">{previousTotal.toFixed(2)}</span> {formatUnitName(unitName)}
                                                </div>
                                              </Link>
                                            )}
                                          </div>
                                        </div>
                                        
                                        {/* Location Inputs */}
                                        <div className="grid grid-cols-1 gap-2">
                                          {itemLines.map((line, idx) => {
                                            const category = categoriesData?.find(c => c.id === item?.categoryId);
                                            const location = storageLocations?.find(l => l.id === line.storageLocationId);
                                            const mode = getCountMode(category, location);
                                            
                                            return (
                                            <div key={line.id} className="flex items-center gap-3" data-testid={`location-input-${line.id}`}>
                                              <label className="w-40 text-sm text-muted-foreground">
                                                {line.storageLocationName || 'Unknown'}:
                                              </label>
                                              {isReadOnly ? (
                                                <div className="w-32 h-9 flex items-center font-mono font-semibold" data-testid={`text-qty-${line.id}`}>
                                                  {line.qty}
                                                </div>
                                              ) : (
                                                <CountQuantityEditor
                                                  line={line}
                                                  item={item}
                                                  mode={mode}
                                                  isEditing={editingLineId === line.id}
                                                  editingQty={editingQty}
                                                  editingCaseQty={editingCaseQty}
                                                  editingLooseUnits={editingLooseUnits}
                                                  onFocus={() => handleStartEdit(line, mode)}
                                                  onQtyChange={setEditingQty}
                                                  onCaseQtyChange={setEditingCaseQty}
                                                  onLooseUnitsChange={setEditingLooseUnits}
                                                  onBlur={() => {
                                                    if (editingLineId === line.id) {
                                                      handleSaveEdit(line.id, mode, item);
                                                    }
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                      e.preventDefault();
                                                      handleSaveEdit(line.id, mode, item);
                                                      // Focus next input if available
                                                      if (idx < itemLines.length - 1) {
                                                        const nextLine = itemLines[idx + 1];
                                                        setTimeout(() => {
                                                          const nextInput = document.querySelector(`[data-testid="input-qty-${nextLine.id}"]`) as HTMLInputElement;
                                                          if (nextInput) {
                                                            nextInput.focus();
                                                            nextInput.select();
                                                          }
                                                        }, 0);
                                                      }
                                                    } else if (e.key === 'Escape') {
                                                      handleCancelEdit();
                                                    }
                                                  }}
                                                />
                                              )}
                                              <div className="text-sm text-muted-foreground font-mono ml-2">
                                                = ${(line.qty * (line.unitCost || 0)).toFixed(2)}
                                              </div>
                                            </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            ) : (
                              // Location view: Compact layout similar to category view
                              <div className="space-y-3 p-4">
                                {lines.map((line, idx) => {
                                  const item = line.inventoryItem;
                                  const unitName = item?.unitName || 'unit';
                                  const category = categoriesData?.find(c => c.id === item?.categoryId);
                                  const location = storageLocations?.find(l => l.id === line.storageLocationId);
                                  const mode = getCountMode(category, location);
                                  
                                  // Get previous quantity for this specific item at this location
                                  const previousLine = previousLines.find(
                                    pl => pl.inventoryItemId === line.inventoryItemId && 
                                          pl.storageLocationId === line.storageLocationId
                                  );
                                  const previousQty = previousLine?.qty || 0;
                                  
                                  return (
                                    <div key={line.id} className="border rounded-lg p-3 space-y-2" data-testid={`item-input-${line.id}`}>
                                      {/* Item Info Header */}
                                      <div className="flex items-center justify-between gap-4 pb-2 border-b">
                                        <div className="flex items-center gap-4 flex-1">
                                          {isReadOnly ? (
                                            <div className="font-medium" data-testid={`text-item-name-${line.inventoryItemId}`}>
                                              {item?.name || 'Unknown'}
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => handleOpenItemEdit(item)}
                                              className="text-left hover:underline font-medium"
                                              tabIndex={-1}
                                              data-testid={`button-edit-item-${line.inventoryItemId}`}
                                            >
                                              {item?.name || 'Unknown'}
                                            </button>
                                          )}
                                          <span className="text-sm text-muted-foreground">
                                            {item?.category || 'Uncategorized'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-6 text-sm">
                                          <div className="text-muted-foreground">
                                            {formatUnitName(unitName)}
                                          </div>
                                          {mode === 'case' && item?.caseSize && (
                                            <div className="text-muted-foreground">
                                              Case: {item.caseSize} {formatUnitName(unitName)}
                                            </div>
                                          )}
                                          <div className="font-mono">
                                            ${(line.unitCost || 0).toFixed(2)}
                                          </div>
                                          {previousQty > 0 && previousCountId && (
                                            <Link href={`/count/${previousCountId}?from=${countId}&item=${line.inventoryItemId}`}>
                                              <div className="text-muted-foreground hover:underline cursor-pointer" data-testid={`link-previous-${line.id}`}>
                                                Prev: <span className="font-mono">{previousQty.toFixed(2)}</span> {formatUnitName(unitName)}
                                              </div>
                                            </Link>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Quantity Input */}
                                      <div className="flex items-center gap-3">
                                        <label className="w-20 text-sm text-muted-foreground">
                                          Qty:
                                        </label>
                                        {isReadOnly ? (
                                          <div className="w-32 h-9 flex items-center font-mono font-semibold" data-testid={`text-qty-${line.id}`}>
                                            {line.qty}
                                          </div>
                                        ) : (
                                          <CountQuantityEditor
                                            line={line}
                                            item={item}
                                            mode={mode}
                                            isEditing={editingLineId === line.id}
                                            editingQty={editingQty}
                                            editingCaseQty={editingCaseQty}
                                            editingLooseUnits={editingLooseUnits}
                                            onFocus={() => handleStartEdit(line, mode)}
                                            onQtyChange={setEditingQty}
                                            onCaseQtyChange={setEditingCaseQty}
                                            onLooseUnitsChange={setEditingLooseUnits}
                                            onBlur={() => {
                                              if (editingLineId === line.id) {
                                                handleSaveEdit(line.id, mode, item);
                                              }
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSaveEdit(line.id, mode, item);
                                                // Focus next input if available
                                                if (idx < lines.length - 1) {
                                                  const nextLine = lines[idx + 1];
                                                  setTimeout(() => {
                                                    const nextInput = document.querySelector(`[data-testid="input-qty-${nextLine.id}"]`) as HTMLInputElement;
                                                    if (nextInput) {
                                                      nextInput.focus();
                                                      nextInput.select();
                                                    }
                                                  }, 0);
                                                }
                                              } else if (e.key === 'Escape') {
                                                handleCancelEdit();
                                              }
                                            }}
                                          />
                                        )}
                                        <div className="text-sm text-muted-foreground font-mono ml-2">
                                          = ${(line.qty * (line.unitCost || 0)).toFixed(2)}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                );
              })()
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No items to display
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && handleCloseItemEdit()}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-item">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              Update the details for this inventory item. Required fields are marked with an asterisk (*).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="item-name">Name *</Label>
              <Input
                id="item-name"
                value={itemEditForm.name}
                onChange={(e) => setItemEditForm({ ...itemEditForm, name: e.target.value })}
                data-testid="input-item-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={itemEditForm.categoryId || undefined}
                onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })}
              >
                <SelectTrigger id="item-category" data-testid="select-item-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categoriesData?.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-price">Price Per Unit *</Label>
                <Input
                  id="item-price"
                  type="number"
                  step="0.01"
                  value={itemEditForm.pricePerUnit}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, pricePerUnit: e.target.value })}
                  data-testid="input-item-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-case-size">Case Size *</Label>
                <Input
                  id="item-case-size"
                  type="number"
                  step="0.01"
                  value={itemEditForm.caseSize}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, caseSize: e.target.value })}
                  data-testid="input-item-case-size"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-par-level">Par Level</Label>
                <Input
                  id="item-par-level"
                  type="number"
                  step="0.01"
                  value={itemEditForm.parLevel}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, parLevel: e.target.value })}
                  data-testid="input-item-par-level"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-reorder-level">Reorder Level</Label>
                <Input
                  id="item-reorder-level"
                  type="number"
                  step="0.01"
                  value={itemEditForm.reorderLevel}
                  onChange={(e) => setItemEditForm({ ...itemEditForm, reorderLevel: e.target.value })}
                  data-testid="input-item-reorder-level"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseItemEdit}
              data-testid="button-cancel-item"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveItem}
              disabled={updateItemMutation.isPending}
              data-testid="button-save-item"
            >
              {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
