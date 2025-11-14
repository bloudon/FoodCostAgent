import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, Tag, GripVertical, Scale } from "lucide-react";
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
import { insertCategorySchema } from "@shared/schema";
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

type CategoryForm = z.infer<typeof insertCategorySchema>;

interface SortableCategoryProps {
  category: any;
  onEdit: (category: any) => void;
  onDelete: (category: any) => void;
}

function SortableCategory({ category, onEdit, onDelete }: SortableCategoryProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="mb-3" data-testid={`card-category-${category.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <button
              className="cursor-grab active:cursor-grabbing touch-none p-1 hover-elevate rounded"
              {...attributes}
              {...listeners}
              data-testid={`drag-handle-${category.id}`}
            >
              <GripVertical className="h-5 w-5 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-2 flex-1">
              <Tag className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg" data-testid={`text-category-name-${category.id}`}>
                {category.name}
              </CardTitle>
              {!!category.isTareWeightCategory && (
                <Scale className="h-4 w-4 text-muted-foreground" data-testid={`icon-tare-weight-${category.id}`} />
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onEdit(category)}
                data-testid={`button-edit-category-${category.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(category)}
                data-testid={`button-delete-category-${category.id}`}
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

export default function Categories() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<any | null>(null);
  const { toast } = useToast();

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: categories, isLoading } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const form = useForm<CategoryForm>({
    resolver: zodResolver(insertCategorySchema.omit({ sortOrder: true })),
    defaultValues: {
      name: "",
      showAsIngredient: 1,
      isTareWeightCategory: 0,
      companyId: selectedCompanyId || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CategoryForm) => {
      const sortOrder = categories?.length || 0;
      return apiRequest("POST", "/api/categories", { ...data, sortOrder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Category created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create category",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<CategoryForm> }) => {
      return apiRequest("PATCH", `/api/categories/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
      form.reset();
      toast({
        title: "Success",
        description: "Category updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update category",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setDeletingCategory(null);
      toast({
        title: "Success",
        description: "Category deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete category",
        variant: "destructive",
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (categoryOrders: { id: string; sortOrder: number }[]) => {
      return apiRequest("POST", "/api/categories/reorder", { categoryOrders });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
    onError: (error: any) => {
      // Refetch to restore correct order on error
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({
        title: "Error",
        description: error.message || "Failed to reorder categories",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (category: any) => {
    setEditingCategory(category);
    form.reset({
      name: category.name,
      showAsIngredient: category.showAsIngredient ?? 1,
      isTareWeightCategory: category.isTareWeightCategory ?? 0,
      companyId: category.companyId || selectedCompanyId || "",
    });
  };

  const handleAdd = () => {
    setIsAddDialogOpen(true);
    form.reset({
      name: "",
      showAsIngredient: 1,
      isTareWeightCategory: 0,
      companyId: selectedCompanyId || "",
    });
  };

  const onSubmit = (data: CategoryForm) => {
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, updates: data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !categories) {
      return;
    }

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);

    const newOrder = arrayMove(categories, oldIndex, newIndex);
    const categoryOrders = newOrder.map((category, index) => ({
      id: category.id,
      sortOrder: index,
    }));

    // Optimistically update the UI
    queryClient.setQueryData(["/api/categories"], newOrder);

    // Send the reorder request to the backend
    reorderMutation.mutate(categoryOrders);
  };

  const filteredCategories = categories?.filter((cat) =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-categories-title">
            Categories
          </h1>
          <p className="text-muted-foreground mt-2">
            Drag and drop to reorder categories
          </p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-category">
          <Plus className="h-4 w-4 mr-2" />
          New Category
        </Button>
      </div>

      <div className="mb-6 flex items-center gap-6 text-sm text-muted-foreground" data-testid="legend-categories">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4" />
          <span data-testid="text-tare-weight-legend">Tare weight category (case counting enabled)</span>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search categories..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-categories"
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
        ) : filteredCategories && filteredCategories.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredCategories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredCategories.map((category) => (
                <SortableCategory
                  key={category.id}
                  category={category}
                  onEdit={handleEdit}
                  onDelete={setDeletingCategory}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Tag className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {searchQuery ? "No categories found matching your search" : "No categories yet"}
              </p>
              {!searchQuery && (
                <Button onClick={handleAdd} className="mt-4" data-testid="button-create-first-category">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Category
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isAddDialogOpen || !!editingCategory} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setEditingCategory(null);
          form.reset();
        }
      }}>
        <DialogContent data-testid="dialog-category-form">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingCategory ? "Edit Category" : "Create Category"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory ? "Update the category details below." : "Add a new category to organize your inventory."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Dairy, Protein, Paper" {...field} data-testid="input-category-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="showAsIngredient"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="checkbox-show-as-ingredient"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Show as Ingredient</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Items in this category can be used as ingredients in recipes
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isTareWeightCategory"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="checkbox-tare-weight-category"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Tare Weight Category</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Enable case counting for items in this category
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
                    setEditingCategory(null);
                    form.reset();
                  }}
                  data-testid="button-cancel-category"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-category"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <AlertDialogContent data-testid="dialog-delete-category">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingCategory?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-category">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCategory && deleteMutation.mutate(deletingCategory.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-category"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
