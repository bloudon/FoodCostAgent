import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Package, DollarSign, Layers, X, Lock, LockOpen, Search, ArrowUp, Star } from "lucide-react";
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 flex-1">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-none">
          <div className="flex flex-col flex-1 sm:flex-none">
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
              className="w-full sm:w-24 h-10 sm:h-9 text-base"
              disabled={readOnly}
              data-testid={`input-case-qty-${line.id}`}
            />
          </div>
          <div className="flex flex-col flex-1 sm:flex-none">
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
              className="w-full sm:w-24 h-10 sm:h-9 text-base"
              disabled={readOnly}
              data-testid={`input-loose-units-${line.id}`}
            />
          </div>
        </div>
        <div className="flex-1 text-right w-full sm:w-auto">
          <div className="text-base font-semibold font-mono text-muted-foreground">
            = {((parseFloat(caseQty.toString()) || 0) * (item?.caseSize || 0) + (parseFloat(looseUnits.toString()) || 0)).toFixed(2)} {item?.unitName}
          </div>
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
      className="w-full sm:w-32 h-10 sm:h-9 text-base"
      disabled={readOnly}
      data-testid={`input-qty-${line.id}`}
    />
  );
}

// Helper function to generate URL-safe anchor IDs
function generateAnchorId(prefix: string, value: string): string {
  // For UUIDs and already URL-safe strings (like location IDs), use as-is
  const isUrlSafe = /^[a-z0-9-]+$/i.test(value);
  if (isUrlSafe) {
    return `${prefix}-${value}`;
  }
  
  // For categories with special characters, create a unique hash to prevent collisions
  const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // Simple hash to distinguish similar category names
  const hash = value.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `${prefix}-${sanitized}-${Math.abs(hash)}`;
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
  const [search, setSearch] = useState("");
  const [openAccordionSections, setOpenAccordionSections] = useState<string[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  
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
  
  // Initialize and reset accordion sections when data loads or groupBy changes
  useEffect(() => {
    if (countLines && countLines.length > 0) {
      // Group lines to get all groupKeys for the current groupBy mode
      const grouped: Record<string, any[]> = {};
      countLines.forEach(line => {
        let groupKey: string;
        if (groupBy === "location") {
          groupKey = line.inventoryItem?.storageLocationId || "unknown";
        } else {
          groupKey = line.inventoryItem?.category || "Uncategorized";
        }
        if (!grouped[groupKey]) {
          grouped[groupKey] = [];
        }
        grouped[groupKey].push(line);
      });
      
      // Reset accordion sections to open all current groups
      // This ensures stale keys from previous groupBy mode are removed
      setOpenAccordionSections(Object.keys(grouped));
    }
  }, [countLines, groupBy]);

  // Handle scroll event to show/hide back to top button
  useEffect(() => {
    const handleScroll = (event?: Event) => {
      // The scrolling happens on the main element, not the window
      // Get the main element's scroll position
      const mainElement = document.querySelector('main');
      const scrollTop = mainElement ? mainElement.scrollTop : (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop);
      setShowBackToTop(scrollTop > 300);
    };

    // Find the main element and listen to its scroll event
    const mainElement = document.querySelector('main');
    
    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll);
    }
    
    // Also listen to window scroll as fallback
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      if (mainElement) {
        mainElement.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

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

  // Helper function to get the current quantity (either from editing state or stored value)
  const getCurrentQty = (line: any, mode: CountMode, item: any) => {
    if (editingLineId === line.id) {
      if (mode === 'case') {
        const cases = parseFloat(editingCaseQty) || 0;
        const loose = parseFloat(editingLooseUnits) || 0;
        const caseSize = item?.caseSize || 0;
        return (cases * caseSize) + loose;
      } else {
        return parseFloat(editingQty) || 0;
      }
    }
    return line.qty;
  };

  const handleStartEdit = (line: any, mode: CountMode) => {
    // Don't re-initialize if we're already editing this line (moving between fields)
    if (editingLineId === line.id) {
      return;
    }
    
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items/estimated-on-hand"] });
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

  // Helper function to scroll to a section and open it
  const scrollToSection = (groupKey: string, prefix: string) => {
    const anchorId = generateAnchorId(prefix, groupKey);
    
    // Open the target accordion section if not already open
    const needsToOpen = !openAccordionSections.includes(groupKey);
    if (needsToOpen) {
      setOpenAccordionSections(prev => [...prev, groupKey]);
    }
    
    // Wait for accordion expansion before scrolling
    const waitForExpansionAndScroll = () => {
      const element = document.getElementById(anchorId);
      if (!element) return;
      
      const checkAndScroll = () => {
        // Check for reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        
        element.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
        
        // Focus the element for accessibility
        requestAnimationFrame(() => {
          const trigger = element.querySelector('[role="button"]');
          if (trigger instanceof HTMLElement) {
            trigger.focus({ preventScroll: true });
          }
        });
      };
      
      // If accordion was already open or doesn't need animation, scroll immediately
      if (!needsToOpen) {
        requestAnimationFrame(checkAndScroll);
        return;
      }
      
      // Wait for accordion transition to complete (typical transition is 200-300ms)
      setTimeout(checkAndScroll, 300);
    };
    
    requestAnimationFrame(waitForExpansionAndScroll);
  };

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
  
  // Text search filter
  if (search) {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const matchesName = item?.name?.toLowerCase().includes(search.toLowerCase());
      const matchesPluSku = item?.pluSku?.toLowerCase().includes(search.toLowerCase());
      return matchesName || matchesPluSku;
    });
  }
  
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
    <div className="p-4 sm:p-8">
      <div className="mb-4 sm:mb-8">
        <Link href={sourceCountId ? `/count/${sourceCountId}` : "/inventory-sessions"}>
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{sourceCountId ? "Back to Previous Session" : "Back to Sessions"}</span>
            <span className="sm:hidden">Back</span>
          </Button>
        </Link>
        
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" data-testid="text-session-title">
                Count Session <span className="hidden sm:inline">Details</span> {company && store && <span className="text-lg sm:text-2xl">({company.name} - {store.name})</span>}
              </h1>
              {count?.isPowerSession === 1 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm font-medium" data-testid="badge-power-session">
                  <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                  Power Count
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base text-muted-foreground mt-2">
              {countDate?.toLocaleDateString()} {countDate?.toLocaleTimeString()}
              {count?.isPowerSession === 1 && " • Only power items included"}
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
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b mb-4 sm:mb-8 -mx-4 sm:-mx-8 px-4 sm:px-8 py-2 sm:py-3">
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hidden sm:block" />
            <div>
              <div className="text-xs sm:text-sm text-muted-foreground">Value</div>
              <div className="text-sm sm:text-lg font-bold font-mono" data-testid="text-dashboard-total-value">
                ${totalValue.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hidden sm:block" />
            <div>
              <div className="text-xs sm:text-sm text-muted-foreground">Items</div>
              <div className="text-sm sm:text-lg font-bold font-mono" data-testid="text-dashboard-total-items">
                {totalItems}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground hidden sm:block" />
            <div>
              <div className="text-xs sm:text-sm text-muted-foreground">Categories</div>
              <div className="text-sm sm:text-lg font-bold font-mono" data-testid="text-dashboard-categories">
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
                    onClick={() => {
                      if (selectedCategory === category) {
                        setSelectedCategory("all");
                      } else {
                        setSelectedCategory(category);
                        setGroupBy("category");
                        scrollToSection(category, "category");
                      }
                    }}
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
                    onClick={() => {
                      if (selectedLocation === locationId) {
                        setSelectedLocation("all");
                      } else {
                        setSelectedLocation(locationId);
                        setGroupBy("location");
                        scrollToSection(locationId, "location");
                      }
                    }}
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
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[200px]"
                  data-testid="input-search-count-lines"
                />
              </div>
              {(selectedCategory !== "all" || selectedLocation !== "all" || selectedItemId !== "all" || search) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSelectedLocation("all");
                    setSelectedItemId("all");
                    setSearch("");
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
                    value={openAccordionSections}
                    onValueChange={setOpenAccordionSections}
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
                      
                      // Generate anchor ID for this section
                      const anchorId = generateAnchorId(groupBy, groupKey);
                      
                      return (
                        <AccordionItem key={groupKey} value={groupKey} id={anchorId} className="border rounded-md mb-2">
                          <AccordionTrigger className="px-4 py-2 hover:no-underline bg-muted/30 hover:bg-muted/50 data-[state=open]:bg-muted/40" tabIndex={-1} data-testid={`accordion-group-${groupKey}`}>
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-4 flex-1">
                                <span className="font-medium text-left">
                                  {groupName}
                                </span>
                                <span className="text-sm text-muted-foreground hidden sm:inline">
                                  {lines.length} items
                                </span>
                              </div>
                              <div className="text-right">
                                <div className="font-mono font-semibold">${totalValue.toFixed(2)}</div>
                                <div className="text-xs text-muted-foreground hidden sm:block">Total Value</div>
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
                                    const unitAbbr = firstLine.unitAbbreviation || 'unit';
                                    
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
                                          <div className="flex items-center gap-3 sm:gap-6 text-sm">
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-qty-${itemId}`}>
                                              {currentTotal.toFixed(2)}
                                            </div>
                                            <div className="text-muted-foreground">
                                              {unitAbbr}
                                            </div>
                                            <div className="font-mono hidden sm:block" data-testid={`text-item-unit-price-${itemId}`}>
                                              ${(firstLine.unitCost || 0).toFixed(2)}
                                            </div>
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-value-${itemId}`}>
                                              ${itemTotalValue.toFixed(2)}
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* Location Inputs */}
                                        <div className="grid grid-cols-1 gap-2">
                                          {itemLines.map((line, idx) => {
                                            const category = categoriesData?.find(c => c.id === item?.categoryId);
                                            const location = storageLocations?.find(l => l.id === line.storageLocationId);
                                            const mode = getCountMode(category, location);
                                            
                                            return (
                                            <div key={line.id} className={`grid grid-cols-1 sm:grid-cols-[160px_1fr_100px] gap-2 items-center px-2 py-1.5 rounded ${idx % 2 === 0 ? '' : 'bg-muted/20'}`} data-testid={`location-input-${line.id}`}>
                                              <label className="text-sm text-muted-foreground">
                                                {line.storageLocationName || 'Unknown'}:
                                              </label>
                                              {isReadOnly ? (
                                                <>
                                                  <div className="h-9 sm:h-10 flex items-center font-mono font-semibold" data-testid={`text-qty-${line.id}`}>
                                                    {line.qty}
                                                  </div>
                                                  <div className="text-right font-mono font-semibold text-muted-foreground">
                                                    ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                                  </div>
                                                </>
                                              ) : (
                                                <>
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
                                                  <div className="text-right font-mono font-semibold text-muted-foreground">
                                                    ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                            );
                                          })}
                                        </div>
                                        
                                        {/* Item Footer */}
                                        {previousTotal > 0 && previousCountId && (
                                          <div className="pt-2 border-t">
                                            <Link href={`/count/${previousCountId}?from=${countId}&item=${itemId}`}>
                                              <div className="text-sm text-muted-foreground hover:underline cursor-pointer" data-testid={`link-previous-${itemId}`}>
                                                Previous count: <span className="font-mono">{previousTotal.toFixed(2)}</span> {formatUnitName(unitName)}
                                              </div>
                                            </Link>
                                          </div>
                                        )}
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
                                  const unitAbbr = line.unitAbbreviation || 'unit';
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
                                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 pb-2 border-b">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 flex-1">
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
                                          <div className="flex items-center gap-2 sm:gap-4 text-sm text-muted-foreground flex-wrap">
                                            <span>{item?.category || 'Uncategorized'}</span>
                                            {mode === 'case' && item?.caseSize && (
                                              <span>Case: {item.caseSize} {unitAbbr}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3 sm:gap-6 text-sm flex-wrap">
                                          <div className="font-mono whitespace-nowrap">
                                            ${(line.unitCost || 0).toFixed(2)} / {unitAbbr}
                                          </div>
                                          {previousQty > 0 && previousCountId && (
                                            <Link href={`/count/${previousCountId}?from=${countId}&item=${line.inventoryItemId}`}>
                                              <div className="text-muted-foreground hover:underline cursor-pointer whitespace-nowrap hidden sm:block" data-testid={`link-previous-${line.id}`}>
                                                Prev: <span className="font-mono">{previousQty.toFixed(2)}</span> {formatUnitName(unitName)}
                                              </div>
                                            </Link>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Quantity Input */}
                                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                        <label className="text-sm text-muted-foreground sm:w-20">
                                          Qty:
                                        </label>
                                        <div className="flex items-center gap-3 flex-1">
                                          {isReadOnly ? (
                                            <>
                                              <div className="w-32 h-9 flex items-center font-mono font-semibold" data-testid={`text-qty-${line.id}`}>
                                                {line.qty}
                                              </div>
                                              <div className="flex-1 text-right text-base font-semibold font-mono text-muted-foreground">
                                                = ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                              </div>
                                            </>
                                          ) : (
                                            <>
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
                                              <div className="flex-1 text-right text-base font-semibold font-mono text-muted-foreground">
                                                = ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                              </div>
                                            </>
                                          )}
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

      {/* Back to Top Button */}
      {showBackToTop && (
        <Button
          onClick={() => {
            // Scroll both window and the main element to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            // Also scroll the main element (which has overflow-auto)
            const mainElement = document.querySelector('main');
            if (mainElement) {
              mainElement.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          size="icon"
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
          data-testid="button-back-to-top"
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
