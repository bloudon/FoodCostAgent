import { useQuery, useMutation } from "@tanstack/react-query";
import { SetupProgressBanner } from "@/components/setup-progress-banner";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, MapPin, GripVertical, Package, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStorageLocationSchema } from "@shared/schema";
import type { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type StorageLocationForm = z.infer<typeof insertStorageLocationSchema>;

interface SortableLocationProps {
  location: any;
  onEdit: (location: any) => void;
  onDelete: (location: any) => void;
  hideDragHandle?: boolean;
}

function SortableLocation({ location, onEdit, onDelete, hideDragHandle }: SortableLocationProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: location.id, disabled: hideDragHandle });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="mb-3" data-testid={`card-location-${location.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            {!hideDragHandle && (
              <button
                className="cursor-grab active:cursor-grabbing touch-none p-1 hover-elevate rounded"
                {...attributes}
                {...listeners}
                data-testid={`drag-handle-${location.id}`}
              >
                <GripVertical className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
            <div className="flex items-center gap-2 flex-1">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg" data-testid={`text-location-name-${location.id}`}>
                {location.name}
              </CardTitle>
              {!!location.allowCaseCounting && (
                <Package className="h-4 w-4 text-muted-foreground" data-testid={`icon-case-counting-${location.id}`} />
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onEdit(location)}
                data-testid={`button-edit-location-${location.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(location)}
                data-testid={`button-delete-location-${location.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

export default function StorageLocations() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any | null>(null);
  const [deletingLocation, setDeletingLocation] = useState<any | null>(null);
  const { toast } = useToast();

  // Column sort state. "manual" means use the DnD-persisted sortOrder from the API.
  const [locSortField, setLocSortField] = useState<"manual" | "name" | "caseCounting">("manual");
  const [locSortDirection, setLocSortDirection] = useState<"asc" | "desc">("asc");

  const handleLocSort = (field: string) => {
    const f = field as "name" | "caseCounting";
    if (locSortField === f) {
      setLocSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setLocSortField(f);
      setLocSortDirection("asc");
    }
  };

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: locations, isLoading } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const form = useForm<StorageLocationForm>({
    resolver: zodResolver(insertStorageLocationSchema.omit({ sortOrder: true })),
    defaultValues: {
      name: "",
      allowCaseCounting: 0,
      companyId: selectedCompanyId || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: StorageLocationForm) => {
      const sortOrder = locations?.length || 0;
      return apiRequest("POST", "/api/storage-locations", { ...data, sortOrder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Storage location created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create storage location",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<StorageLocationForm> }) => {
      return apiRequest("PATCH", `/api/storage-locations/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      setEditingLocation(null);
      form.reset();
      toast({
        title: "Success",
        description: "Storage location updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update storage location",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/storage-locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      setDeletingLocation(null);
      toast({
        title: "Success",
        description: "Storage location deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete storage location",
        variant: "destructive",
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (locationOrders: { id: string; sortOrder: number }[]) => {
      return apiRequest("POST", "/api/storage-locations/reorder", { locationOrders });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
    },
    onError: (error: any) => {
      // Refetch to restore correct order on error
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      toast({
        title: "Error",
        description: error.message || "Failed to reorder locations",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (location: any) => {
    setEditingLocation(location);
    form.reset({
      name: location.name,
      allowCaseCounting: location.allowCaseCounting ?? 0,
      companyId: location.companyId || selectedCompanyId || "",
    });
  };

  const handleAdd = () => {
    setIsAddDialogOpen(true);
    form.reset({
      name: "",
      allowCaseCounting: 0,
      companyId: selectedCompanyId || "",
    });
  };

  const onSubmit = (data: StorageLocationForm) => {
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, updates: data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !locations) {
      return;
    }

    const oldIndex = locations.findIndex((l) => l.id === active.id);
    const newIndex = locations.findIndex((l) => l.id === over.id);

    const newOrder = arrayMove(locations, oldIndex, newIndex);
    const locationOrders = newOrder.map((location, index) => ({
      id: location.id,
      sortOrder: index,
    }));

    // Optimistically update the UI
    queryClient.setQueryData(["/api/storage-locations"], newOrder);

    // Send the reorder request to the backend
    reorderMutation.mutate(locationOrders);
  };

  const filteredLocations = locations?.filter((l) =>
    l.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isManualLocSort = locSortField === "manual";
  const sortedLocations = !filteredLocations || isManualLocSort
    ? filteredLocations
    : [...filteredLocations].sort((a, b) => {
        const av = locSortField === "name" ? a.name.toLowerCase() : (a.allowCaseCounting ?? 0);
        const bv = locSortField === "name" ? b.name.toLowerCase() : (b.allowCaseCounting ?? 0);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === "number" ? (av as number) - (bv as number) : (av as string).localeCompare(bv as string);
        return locSortDirection === "asc" ? cmp : -cmp;
      });

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-4 sm:mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" data-testid="text-storage-locations-title">
            Storage Locations {locations && locations.length > 0 ? `(${locations.length})` : ""}
          </h1>
          <p className="text-muted-foreground mt-2">
            Drag and drop to reorder storage locations
          </p>
        </div>
        <Button onClick={handleAdd} data-testid="button-create-location">
          <Plus className="h-4 w-4 mr-2" />
          New Location
        </Button>
      </div>

      <div className="mb-6 flex items-center gap-6 text-sm text-muted-foreground" data-testid="legend-storage-locations">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          <span data-testid="text-case-counting-legend">Case counting enabled</span>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500" />
          <Input
            placeholder="Search locations..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-location"
          />
        </div>
      </div>

      <div className="max-w-3xl">
        {/* Sort header row */}
        {!isLoading && sortedLocations && sortedLocations.length > 0 && (
          <div className="flex items-center px-3 py-2 mb-1 text-sm font-medium text-muted-foreground bg-muted/40 rounded-md border select-none">
            <button
              onClick={() => handleLocSort("name")}
              className="flex items-center gap-1 flex-1 hover:text-foreground transition-colors text-left"
              data-testid="sort-header-name"
            >
              Name
              {locSortField === "name" ? (
                locSortDirection === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
              ) : (
                <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
              )}
            </button>
            <button
              onClick={() => handleLocSort("caseCounting")}
              className="flex items-center justify-end gap-1 w-36 hover:text-foreground transition-colors"
              data-testid="sort-header-caseCounting"
            >
              Case Counting
              {locSortField === "caseCounting" ? (
                locSortDirection === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
              ) : (
                <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
              )}
            </button>
            {/* space for action buttons */}
            <div className="w-20" />
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : sortedLocations && sortedLocations.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedLocations.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedLocations.map((location) => (
                <SortableLocation
                  key={location.id}
                  location={location}
                  onEdit={handleEdit}
                  onDelete={setDeletingLocation}
                  hideDragHandle={!isManualLocSort}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {searchQuery ? "No storage locations found matching your search" : "No storage locations yet"}
              </p>
              {!searchQuery && (
                <Button onClick={handleAdd} className="mt-4" data-testid="button-create-first-location">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Location
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isAddDialogOpen || !!editingLocation} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setEditingLocation(null);
          form.reset();
        }
      }}>
        <DialogContent data-testid="dialog-location-form">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingLocation ? "Edit Storage Location" : "Create Storage Location"}
            </DialogTitle>
            <DialogDescription>
              {editingLocation ? "Update the storage location name below." : "Add a new storage location to your inventory system."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Walk-In Cooler" {...field} data-testid="input-location-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allowCaseCounting"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="checkbox-allow-case-counting"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Allow Case Counting</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Enable case count fields for items in this location
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setEditingLocation(null);
                    form.reset();
                  }}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-location"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingLocation} onOpenChange={(open) => !open && setDeletingLocation(null)}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Storage Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingLocation?.name}"? This action cannot be undone and may affect inventory counts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingLocation && deleteMutation.mutate(deletingLocation.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SetupProgressBanner currentMilestoneId="storage_locations" hasEntries={(locations?.length ?? 0) > 0} />
    </div>
  );
}
