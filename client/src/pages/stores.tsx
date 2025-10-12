import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Store, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { CompanyStore } from "@shared/schema";
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

export default function Stores() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState<CompanyStore | null>(null);
  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: stores = [], isLoading } = useQuery<CompanyStore[]>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}/stores`] : [],
    enabled: !!selectedCompanyId,
  });

  const createStoreMutation = useMutation({
    mutationFn: async (data: Partial<CompanyStore>) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return await apiRequest("POST", `/api/companies/${selectedCompanyId}/stores`, data);
    },
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: [`/api/companies/${selectedCompanyId}/stores`] });
      }
      setIsCreateDialogOpen(false);
      toast({
        title: "Success",
        description: "Store created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create store",
        variant: "destructive",
      });
    },
  });

  const updateStoreMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CompanyStore> }) => {
      return await apiRequest("PATCH", `/api/stores/${id}`, data);
    },
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: [`/api/companies/${selectedCompanyId}/stores`] });
      }
      setIsEditDialogOpen(false);
      setSelectedStore(null);
      toast({
        title: "Success",
        description: "Store updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update store",
        variant: "destructive",
      });
    },
  });

  const deleteStoreMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/stores/${id}`);
    },
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: [`/api/companies/${selectedCompanyId}/stores`] });
      }
      setIsDeleteDialogOpen(false);
      setSelectedStore(null);
      toast({
        title: "Success",
        description: "Store deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete store",
        variant: "destructive",
      });
    },
  });

  const handleCreateStore = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const data: any = {
      name: formData.get("name") as string,
      code: formData.get("code") as string,
      phone: formData.get("phone") as string || null,
      addressLine1: formData.get("address1") as string || null,
      addressLine2: formData.get("address2") as string || null,
      city: formData.get("city") as string || null,
      state: formData.get("state") as string || null,
      postalCode: formData.get("zip") as string || null,
      status: formData.get("status") as string,
    };

    const tccLocationId = formData.get("tccLocationId") as string;
    if (tccLocationId) {
      data.tccLocationId = tccLocationId;
    }
    
    createStoreMutation.mutate(data);
  };

  const handleEditStore = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedStore) return;
    
    const formData = new FormData(e.currentTarget);
    
    const data: any = {
      name: formData.get("name") as string,
      code: formData.get("code") as string,
      phone: formData.get("phone") as string || null,
      addressLine1: formData.get("address1") as string || null,
      addressLine2: formData.get("address2") as string || null,
      city: formData.get("city") as string || null,
      state: formData.get("state") as string || null,
      postalCode: formData.get("zip") as string || null,
      status: formData.get("status") as string,
    };

    const tccLocationId = formData.get("tccLocationId") as string;
    if (tccLocationId) {
      data.tccLocationId = tccLocationId;
    }
    
    updateStoreMutation.mutate({ id: selectedStore.id, data });
  };

  const handleDelete = () => {
    if (selectedStore) {
      deleteStoreMutation.mutate(selectedStore.id);
    }
  };

  const StoreForm = ({ store, onSubmit, isPending }: { 
    store?: CompanyStore | null; 
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isPending: boolean;
  }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Store Name *</Label>
          <Input
            id="name"
            name="name"
            defaultValue={store?.name || ""}
            required
            data-testid="input-store-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Store Code *</Label>
          <Input
            id="code"
            name="code"
            defaultValue={store?.code || ""}
            required
            data-testid="input-store-code"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={store?.phone || ""}
          data-testid="input-store-phone"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address1">Address Line 1</Label>
        <Input
          id="address1"
          name="address1"
          defaultValue={store?.addressLine1 || ""}
          data-testid="input-store-address1"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address2">Address Line 2</Label>
        <Input
          id="address2"
          name="address2"
          defaultValue={store?.addressLine2 || ""}
          data-testid="input-store-address2"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            name="city"
            defaultValue={store?.city || ""}
            data-testid="input-store-city"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            name="state"
            defaultValue={store?.state || ""}
            data-testid="input-store-state"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zip">ZIP Code</Label>
          <Input
            id="zip"
            name="zip"
            defaultValue={store?.postalCode || ""}
            data-testid="input-store-zip"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tccLocationId">TCC Location ID</Label>
        <Input
          id="tccLocationId"
          name="tccLocationId"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          defaultValue={store?.tccLocationId || ""}
          data-testid="input-store-tcc-location"
        />
        <p className="text-xs text-muted-foreground">
          UUID format for Thrive Control Center location identification
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={store?.status || "active"}>
          <SelectTrigger id="status" data-testid="select-store-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending} data-testid="button-save-store">
          {isPending ? "Saving..." : store ? "Update Store" : "Create Store"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-stores-title">
            Store Locations
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your company's store locations and TCC integration
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-store">
              <Plus className="h-4 w-4 mr-2" />
              Add Store
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Store</DialogTitle>
              <DialogDescription>
                Add a new store location to your company
              </DialogDescription>
            </DialogHeader>
            <StoreForm onSubmit={handleCreateStore} isPending={createStoreMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">Loading stores...</div>
        </div>
      ) : stores.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No stores found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Create your first store location to get started
            </p>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-first-store">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Store
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Store</DialogTitle>
                  <DialogDescription>
                    Add a new store location to your company
                  </DialogDescription>
                </DialogHeader>
                <StoreForm onSubmit={handleCreateStore} isPending={createStoreMutation.isPending} />
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Stores</CardTitle>
            <CardDescription>
              {stores.length} store location{stores.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>TCC Location ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store.id} data-testid={`row-store-${store.id}`}>
                    <TableCell className="font-medium" data-testid={`text-store-name-${store.id}`}>
                      {store.name}
                    </TableCell>
                    <TableCell data-testid={`text-store-code-${store.id}`}>
                      {store.code}
                    </TableCell>
                    <TableCell>{store.phone || "—"}</TableCell>
                    <TableCell>
                      {store.addressLine1 ? (
                        <div className="text-sm">
                          <div>{store.addressLine1}</div>
                          {store.city && store.state && (
                            <div className="text-muted-foreground">
                              {store.city}, {store.state} {store.postalCode}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {store.tccLocationId || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={store.status === "active" ? "default" : "secondary"}
                        data-testid={`badge-store-status-${store.id}`}
                      >
                        {store.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedStore(store);
                            setIsEditDialogOpen(true);
                          }}
                          data-testid={`button-edit-${store.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedStore(store);
                            setIsDeleteDialogOpen(true);
                          }}
                          data-testid={`button-delete-${store.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Store</DialogTitle>
            <DialogDescription>
              Update store information and settings
            </DialogDescription>
          </DialogHeader>
          <StoreForm 
            store={selectedStore} 
            onSubmit={handleEditStore} 
            isPending={updateStoreMutation.isPending} 
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Store</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedStore?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
