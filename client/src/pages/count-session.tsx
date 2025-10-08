import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Package, DollarSign, Layers, Pencil, Trash2, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const countLineSchema = z.object({
  inventoryItemId: z.string().min(1, "Item is required"),
  unitId: z.string().min(1, "Unit is required"),
  qty: z.coerce.number().min(0, "Quantity must be at least 0"),
});

type CountLineForm = z.infer<typeof countLineSchema>;

export default function CountSession() {
  const params = useParams();
  const countId = params.id;
  const [showEmpty, setShowEmpty] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<any>(null);
  const { toast } = useToast();

  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
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

  const location = storageLocations?.find(l => l.id === count?.storageLocationId);

  const editForm = useForm<CountLineForm>({
    resolver: zodResolver(countLineSchema),
  });

  const addForm = useForm<CountLineForm>({
    resolver: zodResolver(countLineSchema),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<CountLineForm> }) => {
      return apiRequest(`/api/inventory-count-lines/${data.id}`, "PATCH", data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"], exact: false });
      toast({
        title: "Success",
        description: "Count line updated successfully",
      });
      setEditDialogOpen(false);
      editForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update count line",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CountLineForm & { inventoryCountId: string }) => {
      return apiRequest("/api/inventory-count-lines", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"], exact: false });
      toast({
        title: "Success",
        description: "Item added to count successfully",
      });
      setAddDialogOpen(false);
      addForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add item to count",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/inventory-count-lines/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"], exact: false });
      toast({
        title: "Success",
        description: "Count line deleted successfully",
      });
      setDeleteDialogOpen(false);
      setSelectedLine(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete count line",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (line: any) => {
    setSelectedLine(line);
    editForm.reset({
      inventoryItemId: line.inventoryItemId,
      unitId: line.unitId,
      qty: line.qty,
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (line: any) => {
    setSelectedLine(line);
    setDeleteDialogOpen(true);
  };

  const handleAdd = () => {
    addForm.reset({
      inventoryItemId: "",
      unitId: "",
      qty: 0,
    });
    setAddDialogOpen(true);
  };

  const onEditSubmit = (data: CountLineForm) => {
    if (selectedLine) {
      updateMutation.mutate({
        id: selectedLine.id,
        updates: data,
      });
    }
  };

  const onAddSubmit = (data: CountLineForm) => {
    if (countId) {
      createMutation.mutate({
        ...data,
        inventoryCountId: countId,
      });
    }
  };
  
  // Calculate category totals
  const categoryTotals = countLines?.reduce((acc: any, line) => {
    const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
    const category = item?.category || "Uncategorized";
    const value = line.qty * (item?.lastCost || 0);
    
    if (!acc[category]) {
      acc[category] = { count: 0, value: 0, items: 0 };
    }
    acc[category].count += line.qty;
    acc[category].value += value;
    acc[category].items += 1;
    return acc;
  }, {}) || {};

  // Calculate location totals
  const locationTotals = countLines?.reduce((acc: any, line) => {
    const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
    const locationId = item?.storageLocationId;
    const locationName = storageLocations?.find(l => l.id === locationId)?.name || "Unknown Location";
    const value = line.qty * (item?.lastCost || 0);
    
    if (!acc[locationId]) {
      acc[locationId] = { name: locationName, count: 0, value: 0, items: 0 };
    }
    acc[locationId].count += line.qty;
    acc[locationId].value += value;
    acc[locationId].items += 1;
    return acc;
  }, {}) || {};

  const totalValue = countLines?.reduce((sum, line) => {
    const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
    return sum + (line.qty * (item?.lastCost || 0));
  }, 0) || 0;

  const totalItems = countLines?.length || 0;

  // Get unique categories from inventory items
  const categories = Array.from(new Set(
    inventoryItems?.map((p: any) => p.category).filter(Boolean) || []
  )).sort();

  // Filter lines based on toggle, category, and location
  let filteredLines = countLines || [];
  
  if (!showEmpty) {
    filteredLines = filteredLines.filter(line => line.qty > 0);
  }
  
  if (selectedCategory !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
      return item?.category === selectedCategory;
    });
  }
  
  if (selectedLocation !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
      return item?.storageLocationId === selectedLocation;
    });
  }

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
        
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-session-title">
              Count Session Details
            </h1>
            <p className="text-muted-foreground mt-2">
              {location?.name} - {countDate?.toLocaleDateString()} {countDate?.toLocaleTimeString()}
            </p>
          </div>
          <Button onClick={handleAdd} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Mini Dashboard */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-total-value">
              ${totalValue.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Inventory valuation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-total-items">
              {totalItems}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Products counted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categories</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-dashboard-categories">
              {Object.keys(categoryTotals).length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Product categories
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Totals */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filter by Category</CardTitle>
          <p className="text-sm text-muted-foreground">Click a category to filter items below</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(categoryTotals).map(([category, data]: [string, any]) => (
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
        </CardContent>
      </Card>

      {/* Location Totals */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filter by Location</CardTitle>
          <p className="text-sm text-muted-foreground">Click a location to filter items below</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(locationTotals).map(([locationId, data]: [string, any]) => (
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
        </CardContent>
      </Card>

      {/* Count Lines Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>Counted Items</CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="category-filter">Category:</Label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-[180px]" id="category-filter" data-testid="select-category-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLines && filteredLines.length > 0 ? (
                filteredLines.map((line) => {
                  const item = inventoryItems?.find(p => p.id === line.inventoryItemId);
                  const value = line.qty * (item?.lastCost || 0);
                  return (
                    <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                      <TableCell className="font-medium">
                        <Link href={`/item-count/${line.id}`}>
                          <span className="hover:underline cursor-pointer">{item?.name || 'Unknown'}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item?.category || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{line.qty}</TableCell>
                      <TableCell>{line.unitName || '-'}</TableCell>
                      <TableCell className="text-right font-mono">${(item?.lastCost || 0).toFixed(4)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">${value.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/item-count/${line.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid={`button-edit-${line.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(line)}
                            data-testid={`button-delete-${line.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {showEmpty ? "No items in this count" : "No items with quantities found"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent data-testid="dialog-edit-line">
          <DialogHeader>
            <DialogTitle>Edit Count Line</DialogTitle>
            <DialogDescription>
              Update the quantity or unit for this inventory item.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="inventoryItemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-item">
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {inventoryItems?.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-unit">
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {units?.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        {...field}
                        data-testid="input-edit-qty"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent data-testid="dialog-add-line">
          <DialogHeader>
            <DialogTitle>Add Item to Count</DialogTitle>
            <DialogDescription>
              Add a new inventory item to this count session.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <FormField
                control={addForm.control}
                name="inventoryItemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-add-item">
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {inventoryItems?.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-add-unit">
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {units?.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        {...field}
                        data-testid="input-add-qty"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-add"
                >
                  {createMutation.isPending ? "Adding..." : "Add Item"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this count line and update the inventory level accordingly.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedLine && deleteMutation.mutate(selectedLine.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
