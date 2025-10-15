import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Package, DollarSign, Layers, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company, CompanyStore } from "@shared/schema";

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
    mutationFn: async (data: { id: string; qty: number }) => {
      return apiRequest("PATCH", `/api/inventory-count-lines/${data.id}`, { qty: data.qty });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      toast({
        title: "Success",
        description: "Count updated successfully",
      });
      setEditingLineId(null);
      setEditingQty("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update count",
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = (line: any) => {
    setEditingLineId(line.id);
    setEditingQty(line.qty.toString());
  };

  const handleSaveEdit = (lineId: string) => {
    const qty = parseFloat(editingQty);
    if (!isNaN(qty) && qty >= 0) {
      updateMutation.mutate({ id: lineId, qty });
    }
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditingQty("");
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

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link href={sourceCountId ? `/count/${sourceCountId}` : "/inventory-sessions"}>
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {sourceCountId ? "Back to Previous Session" : "Back to Sessions"}
          </Button>
        </Link>
        
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-session-title">
            Count Session Details {company && store && `(${company.name} - ${store.name})`}
          </h1>
          <p className="text-muted-foreground mt-2">
            {countDate?.toLocaleDateString()} {countDate?.toLocaleTimeString()}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Click on a quantity to edit. Use filters below to view items by category or location.
          </p>
        </div>
      </div>

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
            <AccordionTrigger className="px-6 pt-6 pb-2 hover:no-underline">
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
            <AccordionTrigger className="px-6 pt-6 pb-2 hover:no-underline">
              <div className="flex flex-col items-start gap-1">
                <CardTitle>Locations</CardTitle>
                <p className="text-sm text-muted-foreground font-normal">Click a location to filter items below</p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(locationTotals).filter(([_, data]: [string, any]) => data.items > 0).map(([locationId, data]: [string, any]) => (
                  <div 
                    key={locationId} 
                    className={`border rounded-lg p-4 hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                      selectedLocation === locationId ? 'bg-accent border-accent-border' : ''
                    }`}
                    onClick={() => setSelectedLocation(selectedLocation === locationId ? "all" : locationId)}
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
                    groupOrder.push(groupKey); // Preserve first appearance order
                  }
                  grouped[groupKey].push(line);
                });

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
                          <AccordionTrigger className="px-4 py-2 hover:no-underline bg-muted/30 hover:bg-muted/50 data-[state=open]:bg-muted/40" data-testid={`accordion-group-${groupKey}`}>
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
                                  <div className="font-mono font-semibold">{totalQty.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">Total Qty</div>
                                </div>
                                <div className="text-right">
                                  <div className="font-mono font-semibold">${totalValue.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">Total Value</div>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[40%]">Item</TableHead>
                                  <TableHead className="w-[30%]">{groupBy === "location" ? "Category" : "Location"}</TableHead>
                                  <TableHead className="text-right">Quantity (click to edit)</TableHead>
                                  <TableHead className="text-right">Unit Cost</TableHead>
                                  <TableHead className="text-right">Total Value</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {lines.map((line) => {
                                  const value = line.qty * (line.unitCost || 0);
                                  const item = line.inventoryItem;
                                  
                                  return (
                                    <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                                      <TableCell className="font-medium">
                                        <span
                                          onClick={() => handleOpenItemEdit(item)}
                                          className="hover:underline cursor-pointer"
                                          data-testid={`button-edit-item-${line.inventoryItemId}`}
                                        >
                                          {item?.name || 'Unknown'}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-muted-foreground">
                                        {groupBy === "location" ? (item?.category || 'Uncategorized') : (line.storageLocationName || 'Unknown Location')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {editingLineId === line.id ? (
                                          <div className="flex items-center gap-2 justify-end">
                                            <Input
                                              type="number"
                                              step="0.01"
                                              value={editingQty}
                                              onChange={(e) => setEditingQty(e.target.value)}
                                              onBlur={(e) => {
                                                const relatedTarget = e.relatedTarget as HTMLElement;
                                                const isBlurToActionButton = relatedTarget && 
                                                  (relatedTarget.getAttribute('data-testid')?.includes('button-save-') ||
                                                   relatedTarget.getAttribute('data-testid')?.includes('button-cancel-'));
                                                
                                                if (wasTabPressed || !isBlurToActionButton) {
                                                  handleSaveEdit(line.id);
                                                }
                                                setWasTabPressed(false);
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  handleSaveEdit(line.id);
                                                } else if (e.key === 'Escape') {
                                                  handleCancelEdit();
                                                } else if (e.key === 'Tab') {
                                                  setWasTabPressed(true);
                                                }
                                              }}
                                              className="w-24 h-8"
                                              autoFocus
                                              data-testid={`input-qty-${line.id}`}
                                            />
                                            <Button
                                              size="sm"
                                              onClick={() => handleSaveEdit(line.id)}
                                              disabled={updateMutation.isPending}
                                              data-testid={`button-save-${line.id}`}
                                            >
                                              Save
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={handleCancelEdit}
                                              data-testid={`button-cancel-${line.id}`}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        ) : (
                                          <div
                                            className="cursor-pointer hover:underline"
                                            onClick={() => handleStartEdit(line)}
                                            data-testid={`text-qty-${line.id}`}
                                          >
                                            {line.qty}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">${(line.unitCost || 0).toFixed(4)}</TableCell>
                                      <TableCell className="text-right font-mono font-semibold">${value.toFixed(2)}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
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
