import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, ExternalLink, Zap } from "lucide-react";
import { Link } from "wouter";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertVendorSchema, type InsertVendor, type Vendor, type VendorItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Vendors() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const { toast } = useToast();

  const { data: vendors, isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorItems, isLoading: vendorItemsLoading } = useQuery<VendorItem[]>({
    queryKey: ["/api/vendor-items"],
  });

  const form = useForm<InsertVendor>({
    resolver: zodResolver(insertVendorSchema),
    defaultValues: {
      name: "",
      accountNumber: "",
      orderGuideType: "manual",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertVendor) => {
      return await apiRequest("POST", "/api/vendors", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({
        title: "Success",
        description: "Vendor created successfully",
      });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertVendor> }) => {
      return await apiRequest("PATCH", `/api/vendors/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({
        title: "Success",
        description: "Vendor updated successfully",
      });
      setIsDialogOpen(false);
      setEditingVendor(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/vendors/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({
        title: "Success",
        description: "Vendor deleted successfully",
      });
      setDeleteDialogOpen(false);
      setVendorToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getProductCount = (vendorId: string) => {
    if (vendorItemsLoading) return "...";
    return vendorItems?.filter(vi => vi.vendorId === vendorId).length || 0;
  };

  const filteredVendors = vendors?.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateClick = () => {
    setEditingVendor(null);
    form.reset({ name: "", accountNumber: "", orderGuideType: "manual" });
    setIsDialogOpen(true);
  };

  const handleEditClick = (vendor: Vendor) => {
    setEditingVendor(vendor);
    form.reset({
      name: vendor.name,
      accountNumber: vendor.accountNumber || "",
      orderGuideType: vendor.orderGuideType || "manual",
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (vendor: Vendor) => {
    setVendorToDelete(vendor);
    setDeleteDialogOpen(true);
  };

  const onSubmit = (data: InsertVendor) => {
    if (editingVendor) {
      updateMutation.mutate({ id: editingVendor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-vendors-title">
            Vendors
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage vendor catalogs with product pricing and case specifications
          </p>
        </div>
        <Button onClick={handleCreateClick} data-testid="button-create-vendor">
          <Plus className="h-4 w-4 mr-2" />
          New Vendor
        </Button>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vendors..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-vendor"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filteredVendors && filteredVendors.length > 0 ? (
          <>
            {filteredVendors.map((vendor) => (
              <Card key={vendor.id} className="hover-elevate transition-all" data-testid={`card-vendor-${vendor.id}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-lg" data-testid={`text-vendor-name-${vendor.id}`}>{vendor.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => handleEditClick(vendor)}
                      data-testid={`button-edit-vendor-${vendor.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => handleDeleteClick(vendor)}
                      data-testid={`button-delete-vendor-${vendor.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <Link href={`/vendors/${vendor.id}`} data-testid={`link-vendor-detail-${vendor.id}`}>
                      <div className="flex justify-between items-center hover-elevate rounded-md p-2 -m-2 transition-all group">
                        <span className="text-muted-foreground">Products:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono" data-testid={`text-vendor-products-${vendor.id}`}>{getProductCount(vendor.id)}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </Link>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Account #:</span>
                      <span className="font-mono" data-testid={`text-vendor-account-${vendor.id}`}>{vendor.accountNumber || "-"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Order Guide:</span>
                      {vendor.orderGuideType === "electronic" ? (
                        <Badge variant="outline" className="gap-1" data-testid={`badge-order-guide-${vendor.id}`}>
                          <Zap className="h-3 w-3" />
                          Electronic
                        </Badge>
                      ) : (
                        <Badge variant="secondary" data-testid={`badge-order-guide-${vendor.id}`}>
                          Manual
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card 
              className="border-dashed border-2 hover-elevate cursor-pointer transition-all" 
              onClick={handleCreateClick}
              data-testid="button-add-new-vendor"
            >
              <CardContent className="flex items-center justify-center h-full min-h-[140px]">
                <div className="text-center">
                  <Plus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Add New Vendor</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="col-span-full">
            <CardContent className="pt-6 text-center text-muted-foreground">
              {searchQuery ? "No vendors match your search" : "No vendors found. Create your first vendor to get started."}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent data-testid="dialog-vendor-form">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingVendor ? "Edit Vendor" : "Create Vendor"}
            </DialogTitle>
            <DialogDescription>
              {editingVendor ? "Update vendor information" : "Add a new vendor to your system"}
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
                      <Input 
                        placeholder="Vendor name" 
                        {...field} 
                        data-testid="input-vendor-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Account number" 
                        {...field}
                        value={field.value || ""}
                        data-testid="input-vendor-account"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="orderGuideType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Guide Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-order-guide-type">
                          <SelectValue placeholder="Select order guide type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="manual" data-testid="option-manual">Manual</SelectItem>
                        <SelectItem value="electronic" data-testid="option-electronic">Electronic</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Electronic vendors use EDI, API, or PunchOut integrations. Manual vendors require manual order entry.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsDialogOpen(false)}
                  data-testid="button-cancel-vendor"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-vendor"
                >
                  {editingVendor ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-vendor">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{vendorToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => vendorToDelete && deleteMutation.mutate(vendorToDelete.id)}
              disabled={deleteMutation.isPending}
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
