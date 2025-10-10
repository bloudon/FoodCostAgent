import { useState } from "react";
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

export default function CountSession() {
  const params = useParams();
  const countId = params.id;
  const [showEmpty, setShowEmpty] = useState(true); // Default to showing all items
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
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

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
    enabled: !!countId,
  });

  const { data: previousLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-counts", countId, "previous-lines"],
    enabled: !!countId,
  });

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
      return apiRequest("PATCH", `/api/inventory-items/${editingItem.id}`, data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      toast({
        title: "Success",
        description: "Item updated successfully",
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

  // Filter lines based on toggle and location (for category accordion)
  let linesForCategoryTotals = countLines || [];
  if (!showEmpty) {
    linesForCategoryTotals = linesForCategoryTotals.filter(line => line.qty > 0);
  }
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

  // Filter lines based on toggle and category (for location accordion)
  let linesForLocationTotals = countLines || [];
  if (!showEmpty) {
    linesForLocationTotals = linesForLocationTotals.filter(line => line.qty > 0);
  }
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
  
  if (!showEmpty) {
    filteredLines = filteredLines.filter(line => line.qty > 0);
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

  // Sort alphabetically by item name (ascending)
  filteredLines = [...filteredLines].sort((a, b) => {
    const nameA = a.inventoryItem?.name?.toLowerCase() || '';
    const nameB = b.inventoryItem?.name?.toLowerCase() || '';
    return nameA.localeCompare(nameB);
  });

  // Create a lookup map for previous values by inventory item ID
  const previousValuesByItemId = (previousLines || []).reduce((acc: any, line) => {
    const previousValue = line.qty * (line.unitCost || 0);
    acc[line.inventoryItemId] = previousValue;
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
        <Link href="/inventory-sessions">
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sessions
          </Button>
        </Link>
        
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-session-title">
            Count Session Details
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
              {(selectedCategory !== "all" || selectedLocation !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSelectedLocation("all");
                  }}
                  data-testid="button-clear-filters"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear Filters
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id="show-empty"
                  checked={showEmpty}
                  onCheckedChange={setShowEmpty}
                  data-testid="toggle-show-empty"
                />
                <Label htmlFor="show-empty" className="cursor-pointer">
                  Show empty counts
                </Label>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inventory Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Quantity (click to edit)</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLines && filteredLines.length > 0 ? (
                filteredLines.map((line) => {
                  const item = line.inventoryItem;
                  const value = line.qty * (line.unitCost || 0);
                  return (
                    <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                      <TableCell className="font-medium">
                        <button
                          onClick={() => handleOpenItemEdit(item)}
                          className="hover:underline text-left cursor-pointer"
                          data-testid={`button-edit-item-${line.id}`}
                        >
                          {item?.name || 'Unknown'}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item?.category || '-'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {editingLineId === line.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <Input
                              type="number"
                              step="0.01"
                              value={editingQty}
                              onChange={(e) => setEditingQty(e.target.value)}
                              onBlur={(e) => {
                                // Only save if blur is NOT to Save/Cancel buttons (unless Tab was pressed)
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
                                  // Mark that Tab was pressed, blur will handle the save
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
                      <TableCell>{line.unitName || '-'}</TableCell>
                      <TableCell className="text-right font-mono">${(line.unitCost || 0).toFixed(4)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">${value.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {showEmpty ? "No items in this count" : "No items with quantities found"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
