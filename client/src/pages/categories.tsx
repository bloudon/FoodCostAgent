import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, Tag, GripVertical, Scale, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
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
import { SetupProgressBanner } from "@/components/setup-progress-banner";
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
  onDeactivate: (category: any) => void;
  hideDragHandle?: boolean;
}

function SortableCategory({ category, onEdit, onDeactivate, hideDragHandle }: SortableCategoryProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: hideDragHandle });

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
            {!hideDragHandle && (
              <button
                className="cursor-grab active:cursor-grabbing touch-none p-1 hover-elevate rounded"
                {...attributes}
                {...listeners}
                data-testid={`drag-handle-${category.id}`}
              >
                <GripVertical className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <Tag className="h-5 w-5 text-primary shrink-0" />
              <CardTitle className="text-lg" data-testid={`text-category-name-${category.id}`}>
                {category.name}
              </CardTitle>
              {!!category.isTareWeightCategory && !hideDragHandle && (
                <Scale className="h-4 w-4 text-muted-foreground shrink-0" data-testid={`icon-tare-weight-${category.id}`} />
              )}
              {category.itemCount > 0 && (
                <Badge variant="secondary" data-testid={`badge-item-count-${category.id}`}>
                  {category.itemCount} {category.itemCount === 1 ? "item" : "items"}
                </Badge>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
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
                onClick={() => onDeactivate(category)}
                data-testid={`button-deactivate-category-${category.id}`}
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

interface MilestonesResponse {
  milestones: { id: string; label: string; completed: boolean; path: string }[];
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
}

export default function Categories() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);
  const [deactivatingCategory, setDeactivatingCategory] = useState<any | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const { toast } = useToast();

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: milestonesData } = useQuery<MilestonesResponse>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
    staleTime: 0,
  });

  const categoriesMilestone = milestonesData?.milestones.find(m => m.id === "categories");
  const showReviewButton = milestonesData && !milestonesData.dismissed && categoriesMilestone && !categoriesMilestone.completed;

  const { data: allCategories, isLoading } = useQuery<any[]>({
    queryKey: ["/api/categories", { includeInactive: true }],
    queryFn: () => fetch("/api/categories?includeInactive=true", { credentials: "include" }).then(r => r.json()),
  });

  // Fetch item counts for all categories
  const activeCategories = allCategories?.filter(c => c.isActive === 1) ?? [];
  const inactiveCategories = allCategories?.filter(c => c.isActive === 0) ?? [];

  const { data: itemCountsData } = useQuery<Record<string, number>>({
    queryKey: ["/api/categories/item-counts"],
    queryFn: async () => {
      if (!allCategories?.length) return {};
      const counts: Record<string, number> = {};
      await Promise.all(
        allCategories.map(async (cat) => {
          const res = await fetch(`/api/categories/${cat.id}/item-count`, { credentials: "include" });
          const data = await res.json();
          counts[cat.id] = data.count ?? 0;
        })
      );
      return counts;
    },
    enabled: !!allCategories?.length,
  });

  const categoriesWithCounts = activeCategories.map(c => ({
    ...c,
    itemCount: itemCountsData?.[c.id] ?? 0,
  }));

  const inactiveCategoriesWithCounts = inactiveCategories.map(c => ({
    ...c,
    itemCount: itemCountsData?.[c.id] ?? 0,
  }));

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
      const sortOrder = activeCategories.length;
      return apiRequest("POST", "/api/categories", { ...data, sortOrder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Category created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create category", variant: "destructive" });
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
      toast({ title: "Success", description: "Category updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update category", variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/categories/item-counts"] });
      setDeactivatingCategory(null);
      toast({ title: "Category deactivated", description: "The category is now inactive. You can restore it at any time." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to deactivate category", variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/categories/${id}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Category restored", description: "The category is active again." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to restore category", variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (categoryOrders: { id: string; sortOrder: number }[]) => {
      return apiRequest("POST", "/api/categories/reorder", { categoryOrders });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Error", description: "Failed to reorder categories", variant: "destructive" });
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
    if (!over || active.id === over.id || !categoriesWithCounts) return;

    const oldIndex = categoriesWithCounts.findIndex((c) => c.id === active.id);
    const newIndex = categoriesWithCounts.findIndex((c) => c.id === over.id);
    const newOrder = arrayMove(categoriesWithCounts, oldIndex, newIndex);
    const categoryOrders = newOrder.map((category, index) => ({ id: category.id, sortOrder: index }));

    // Optimistically update UI (active only)
    queryClient.setQueryData(
      ["/api/categories", { includeInactive: true }],
      (old: any[]) => {
        if (!old) return old;
        const inactives = old.filter(c => c.isActive === 0);
        return [...newOrder, ...inactives];
      }
    );

    reorderMutation.mutate(categoryOrders);
  };

  const filteredActive = categoriesWithCounts.filter((cat) =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredInactive = inactiveCategoriesWithCounts.filter((cat) =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const deactivatingItemCount = deactivatingCategory ? (itemCountsData?.[deactivatingCategory.id] ?? 0) : 0;

  return (
    <div className="p-8 pb-16">
      <div className="mb-8 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-categories-title">
            Categories
          </h1>
          {!showReviewButton && (
            <p className="text-muted-foreground mt-2">
              Drag and drop to reorder categories
            </p>
          )}
          {showReviewButton && (
            <p className="text-muted-foreground mt-2">
              Review your default categories. Add or remove any, then continue.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Button onClick={handleAdd} data-testid="button-add-category">
            <Plus className="h-4 w-4 mr-2" />
            New Category
          </Button>
        </div>
      </div>

      {!showReviewButton && (
        <div className="mb-6 flex items-center gap-6 text-sm text-muted-foreground" data-testid="legend-categories">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            <span data-testid="text-tare-weight-legend">Tare weight category (case counting enabled)</span>
          </div>
        </div>
      )}

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
        ) : filteredActive.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredActive.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredActive.map((category) => (
                <SortableCategory
                  key={category.id}
                  category={category}
                  onEdit={handleEdit}
                  onDeactivate={setDeactivatingCategory}
                  hideDragHandle={!!showReviewButton}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Tag className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {searchQuery ? "No active categories match your search" : "No active categories"}
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

        {/* Inactive categories section */}
        {(filteredInactive.length > 0) && (
          <div className="mt-6">
            <button
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3 hover-elevate rounded px-1 py-1"
              onClick={() => setShowInactive(v => !v)}
              data-testid="button-toggle-inactive-categories"
            >
              {showInactive ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Inactive categories ({filteredInactive.length})
            </button>

            {showInactive && (
              <div className="space-y-3">
                {filteredInactive.map((category) => (
                  <Card
                    key={category.id}
                    className="mb-3 opacity-60"
                    data-testid={`card-inactive-category-${category.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <Tag className="h-5 w-5 text-muted-foreground shrink-0" />
                          <CardTitle className="text-lg text-muted-foreground" data-testid={`text-inactive-category-name-${category.id}`}>
                            {category.name}
                          </CardTitle>
                          <Badge variant="outline" className="text-xs">
                            Inactive
                          </Badge>
                          {category.itemCount > 0 && (
                            <Badge variant="secondary" data-testid={`badge-inactive-item-count-${category.id}`}>
                              {category.itemCount} {category.itemCount === 1 ? "item" : "items"}
                            </Badge>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => restoreMutation.mutate(category.id)}
                          disabled={restoreMutation.isPending}
                          title="Restore category"
                          data-testid={`button-restore-category-${category.id}`}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
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
              {editingCategory && (
                <>
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
                </>
              )}
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

      {/* Deactivate confirmation dialog */}
      <AlertDialog open={!!deactivatingCategory} onOpenChange={(open) => !open && setDeactivatingCategory(null)}>
        <AlertDialogContent data-testid="dialog-deactivate-category">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Category</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Are you sure you want to deactivate <strong>"{deactivatingCategory?.name}"</strong>?
                </p>
                {deactivatingItemCount > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    {deactivatingItemCount} inventory {deactivatingItemCount === 1 ? "item is" : "items are"} assigned to this
                    category. They will remain in the system but the category will no longer appear in dropdowns.
                  </p>
                )}
                <p className="text-muted-foreground text-sm">
                  You can restore this category at any time from the inactive categories section.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-deactivate-category">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivatingCategory && deactivateMutation.mutate(deactivatingCategory.id)}
              disabled={deactivateMutation.isPending}
              data-testid="button-confirm-deactivate-category"
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SetupProgressBanner currentMilestoneId="categories" hasEntries={(activeCategories.length ?? 0) > 0} />
    </div>
  );
}
