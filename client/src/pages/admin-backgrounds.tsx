import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/ObjectUploader";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Eye, EyeOff, Trash2, Plus, ArrowUp, ArrowDown, Link, Upload, Loader2, ImageIcon
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface BgImage {
  id: string;
  objectPath: string | null;
  externalUrl: string | null;
  label: string | null;
  sortOrder: number;
  isActive: number;
  createdAt: string;
}

export default function AdminBackgrounds() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const { data, isLoading } = useQuery<{ images: BgImage[] }>({
    queryKey: ["/api/admin/background-images"],
  });

  const images = data?.images ?? [];

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: number }) =>
      apiRequest("PATCH", `/api/admin/background-images/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] }),
    onError: () => toast({ title: "Failed to update image", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/background-images/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] });
      queryClient.invalidateQueries({ queryKey: ["/api/background-images"] });
      toast({ title: "Image removed" });
    },
    onError: () => toast({ title: "Failed to delete image", variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ id, sortOrder }: { id: string; sortOrder: number }) =>
      apiRequest("PATCH", `/api/admin/background-images/${id}`, { sortOrder }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] }),
    onError: () => toast({ title: "Failed to reorder", variant: "destructive" }),
  });

  const addByUrlMutation = useMutation({
    mutationFn: async (data: { externalUrl: string; label?: string }) =>
      apiRequest("POST", "/api/admin/background-images", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] });
      queryClient.invalidateQueries({ queryKey: ["/api/background-images"] });
      setAddDialogOpen(false);
      setNewUrl("");
      setNewLabel("");
      toast({ title: "Image added" });
    },
    onError: () => toast({ title: "Failed to add image", variant: "destructive" }),
  });

  const addByUploadMutation = useMutation({
    mutationFn: async (data: { objectPath: string; label?: string }) =>
      apiRequest("POST", "/api/admin/background-images", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] });
      queryClient.invalidateQueries({ queryKey: ["/api/background-images"] });
      setAddDialogOpen(false);
      setNewLabel("");
      toast({ title: "Image uploaded and added" });
    },
    onError: () => toast({ title: "Failed to add image", variant: "destructive" }),
  });

  const labelMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) =>
      apiRequest("PATCH", `/api/admin/background-images/${id}`, { label }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/background-images"] }),
  });

  if (!user || user.role !== "global_admin") {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Global admin access required.</p>
      </div>
    );
  }

  function moveImage(index: number, direction: -1 | 1) {
    const img = images[index];
    const neighbor = images[index + direction];
    if (!img || !neighbor) return;
    reorderMutation.mutate({ id: img.id, sortOrder: neighbor.sortOrder });
    reorderMutation.mutate({ id: neighbor.id, sortOrder: img.sortOrder });
  }

  function getImageUrl(img: BgImage) {
    if (img.objectPath) return `/objects/${img.objectPath}`;
    return img.externalUrl ?? "";
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Background Images</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage the carousel images shown on login, signup, and plan selection screens.
          </p>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-background">
              <Plus className="mr-2 h-4 w-4" />
              Add Image
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Background Image</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label>Label (optional)</Label>
                <Input
                  placeholder="e.g. Restaurant food, Commercial kitchen"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  data-testid="input-bg-label"
                />
              </div>

              <div className="space-y-2">
                <Label>Add by URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://images.unsplash.com/..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    data-testid="input-bg-url"
                  />
                  <Button
                    onClick={() => {
                      if (!newUrl.trim()) return;
                      addByUrlMutation.mutate({ externalUrl: newUrl.trim(), label: newLabel || undefined });
                    }}
                    disabled={!newUrl.trim() || addByUrlMutation.isPending}
                    data-testid="button-add-by-url"
                  >
                    {addByUrlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="relative flex items-center gap-3">
                <div className="flex-1 border-t" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 border-t" />
              </div>

              <div className="space-y-1">
                <Label>Upload from Computer</Label>
                <ObjectUploader
                  buttonText="Upload Image"
                  buttonVariant="outline"
                  dataTestId="button-upload-background"
                  onUploadComplete={(objectPath) => {
                    addByUploadMutation.mutate({ objectPath, label: newLabel || undefined });
                  }}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : images.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">No background images yet.</p>
            <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-first-background">
              <Plus className="mr-2 h-4 w-4" />
              Add First Image
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, index) => (
            <Card key={img.id} data-testid={`card-background-${img.id}`} className={img.isActive ? "" : "opacity-60"}>
              <div className="relative aspect-video overflow-hidden rounded-t-md bg-muted">
                <img
                  src={getImageUrl(img)}
                  alt={img.label ?? "Background"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Badge variant={img.isActive ? "default" : "secondary"} className="text-xs">
                    {img.isActive ? "Active" : "Hidden"}
                  </Badge>
                </div>
                {img.objectPath && (
                  <div className="absolute bottom-2 left-2">
                    <Badge variant="secondary" className="text-xs">
                      <Upload className="h-3 w-3 mr-1" />
                      Uploaded
                    </Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-3 space-y-2">
                <Input
                  defaultValue={img.label ?? ""}
                  placeholder="Label..."
                  className="text-sm"
                  onBlur={(e) => {
                    if (e.target.value !== (img.label ?? "")) {
                      labelMutation.mutate({ id: img.id, label: e.target.value });
                    }
                  }}
                  data-testid={`input-label-${img.id}`}
                />
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => moveImage(index, -1)}
                      data-testid={`button-move-up-${img.id}`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === images.length - 1}
                      onClick={() => moveImage(index, 1)}
                      data-testid={`button-move-down-${img.id}`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleMutation.mutate({ id: img.id, isActive: img.isActive ? 0 : 1 })}
                      disabled={toggleMutation.isPending}
                      data-testid={`button-toggle-${img.id}`}
                    >
                      {img.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Remove this background image?")) {
                          deleteMutation.mutate(img.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${img.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">About Image Order</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Images are shown in the carousel in the order listed above. Use the up/down arrows to rearrange. 
            Hidden images are excluded from the carousel but kept for easy re-enabling. 
            Individual companies can override the carousel with a single brand background image set from their company profile.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
