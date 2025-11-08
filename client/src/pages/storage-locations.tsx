import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Pencil, Trash2, MapPin, GripVertical } from "lucide-react";
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
}

function SortableLocation({ location, onEdit, onDelete }: SortableLocationProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: location.id });

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
            <button
              className="cursor-grab active:cursor-grabbing touch-none p-1 hover-elevate rounded"
              {...attributes}
              {...listeners}
              data-testid={`drag-handle-${location.id}`}
            >
              <GripVertical className="h-5 w-5 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-2 flex-1">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg" data-testid={`text-location-name-${location.id}`}>
                {location.name}
              </CardTitle>
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
    });
  };

  const handleAdd = () => {
    setIsAddDialogOpen(true);
    form.reset({
      name: "",
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

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-storage-locations-title">
            Storage Locations
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

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
        ) : filteredLocations && filteredLocations.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredLocations.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredLocations.map((location) => (
                <SortableLocation
                  key={location.id}
                  location={location}
                  onEdit={handleEdit}
                  onDelete={setDeletingLocation}
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
    </div>
  );
}
