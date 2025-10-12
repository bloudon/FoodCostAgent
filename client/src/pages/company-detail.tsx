import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Company, CompanyStore, InsertCompany, InsertCompanyStore, insertCompanySchema, insertCompanyStoreSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, Building2, Store, Plus, Edit, Save, X, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [editingStore, setEditingStore] = useState<CompanyStore | null>(null);
  const [isNewStoreDialogOpen, setIsNewStoreDialogOpen] = useState(false);
  const [isEditStoreDialogOpen, setIsEditStoreDialogOpen] = useState(false);

  const { data: company, isLoading: loadingCompany } = useQuery<Company>({
    queryKey: [`/api/companies/${id}`],
  });

  const { data: stores = [], isLoading: loadingStores } = useQuery<CompanyStore[]>({
    queryKey: [`/api/companies/${id}/stores`],
  });

  const companyForm = useForm<InsertCompany>({
    resolver: zodResolver(insertCompanySchema),
    defaultValues: {
      name: "",
      status: "active",
      country: "US",
      timezone: "America/New_York",
    },
  });

  // Update form when company data loads
  useEffect(() => {
    if (company && !isEditingCompany) {
      companyForm.reset(company);
    }
  }, [company, isEditingCompany]);

  const storeForm = useForm<InsertCompanyStore>({
    resolver: zodResolver(insertCompanyStoreSchema),
    defaultValues: {
      companyId: id || "",
      code: "",
      name: "",
      status: "active",
    },
  });

  // Reset form when editing a store
  useEffect(() => {
    if (editingStore && isEditStoreDialogOpen) {
      storeForm.reset({
        companyId: editingStore.companyId,
        name: editingStore.name,
        code: editingStore.code,
        phone: editingStore.phone ?? undefined,
        addressLine1: editingStore.addressLine1 ?? undefined,
        addressLine2: editingStore.addressLine2 ?? undefined,
        city: editingStore.city ?? undefined,
        state: editingStore.state ?? undefined,
        postalCode: editingStore.postalCode ?? undefined,
        tccLocationId: editingStore.tccLocationId ?? undefined,
        status: editingStore.status,
      });
    }
  }, [editingStore, isEditStoreDialogOpen]);

  const updateCompanyMutation = useMutation({
    mutationFn: async (data: Partial<InsertCompany>) => {
      const response = await fetch(`/api/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setIsEditingCompany(false);
      toast({ title: "Company updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update company", description: error.message, variant: "destructive" });
    },
  });

  const updateStoreMutation = useMutation({
    mutationFn: async ({ storeId, data }: { storeId: string; data: Partial<InsertCompanyStore> }) => {
      const response = await fetch(`/api/companies/${id}/stores/${storeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/stores`] });
      setEditingStore(null);
      setIsEditStoreDialogOpen(false);
      toast({ title: "Store updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update store", description: error.message, variant: "destructive" });
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: async (data: InsertCompanyStore) => {
      const response = await fetch(`/api/companies/${id}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/stores`] });
      setIsNewStoreDialogOpen(false);
      storeForm.reset();
      toast({ title: "Store created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create store", description: error.message, variant: "destructive" });
    },
  });

  const handleCompanySubmit = (data: InsertCompany) => {
    updateCompanyMutation.mutate(data);
  };

  const handleStoreSubmit = (data: InsertCompanyStore) => {
    // Normalize optional fields: convert empty strings to null for database
    const normalizedData = {
      ...data,
      phone: data.phone?.trim() || null,
      addressLine1: data.addressLine1?.trim() || null,
      addressLine2: data.addressLine2?.trim() || null,
      city: data.city?.trim() || null,
      state: data.state?.trim() || null,
      postalCode: data.postalCode?.trim() || null,
      tccLocationId: data.tccLocationId?.trim() || null,
    };
    
    if (editingStore) {
      updateStoreMutation.mutate({ storeId: editingStore.id, data: normalizedData });
    } else {
      createStoreMutation.mutate(normalizedData);
    }
  };

  const handleDeactivateCompany = () => {
    if (confirm("Are you sure you want to deactivate this company?")) {
      updateCompanyMutation.mutate({ status: "inactive" });
    }
  };

  const handleActivateCompany = () => {
    updateCompanyMutation.mutate({ status: "active" });
  };

  const handleDeactivateStore = (store: CompanyStore) => {
    if (confirm(`Are you sure you want to deactivate ${store.name}?`)) {
      updateStoreMutation.mutate({ storeId: store.id, data: { status: "inactive" } });
    }
  };

  const handleActivateStore = (store: CompanyStore) => {
    updateStoreMutation.mutate({ storeId: store.id, data: { status: "active" } });
  };

  if (loadingCompany || loadingStores) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Company not found</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/companies")}
            data-testid="button-back-to-companies"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-muted-foreground" />
              <h1 className="text-2xl font-semibold" data-testid="text-company-name">{company.name}</h1>
              <Badge variant={company.status === "active" ? "default" : "secondary"} data-testid="badge-company-status">
                {company.status}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditingCompany ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingCompany(true)}
                  data-testid="button-edit-company"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Company
                </Button>
                {company.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeactivateCompany}
                    data-testid="button-deactivate-company"
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleActivateCompany}
                    data-testid="button-activate-company"
                  >
                    Activate
                  </Button>
                )}
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsEditingCompany(false);
                  companyForm.reset(company);
                }}
                data-testid="button-cancel-edit-company"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Company Details</CardTitle>
            <CardDescription>Basic information about the company</CardDescription>
          </CardHeader>
          <CardContent>
            {!isEditingCompany ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Legal Name</div>
                  <div className="font-medium" data-testid="text-legal-name">{company.legalName || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Contact Email</div>
                  <div className="font-medium" data-testid="text-contact-email">{company.contactEmail || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Phone</div>
                  <div className="font-medium" data-testid="text-phone">{company.phone || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Country</div>
                  <div className="font-medium" data-testid="text-country">{company.country}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Timezone</div>
                  <div className="font-medium" data-testid="text-timezone">{company.timezone}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">TCC Account ID</div>
                  <div className="font-medium" data-testid="text-tcc-account-id">{company.tccAccountId || "-"}</div>
                </div>
              </div>
            ) : (
              <Form {...companyForm}>
                <form onSubmit={companyForm.handleSubmit(handleCompanySubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={companyForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-company-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={companyForm.control}
                      name="legalName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Legal Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} data-testid="input-legal-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={companyForm.control}
                      name="contactEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact Email</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" value={field.value || ""} data-testid="input-contact-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={companyForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} data-testid="input-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={companyForm.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Timezone</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-timezone">
                                <SelectValue placeholder="Select timezone" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="America/New_York">Eastern Time</SelectItem>
                              <SelectItem value="America/Chicago">Central Time</SelectItem>
                              <SelectItem value="America/Denver">Mountain Time</SelectItem>
                              <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={companyForm.control}
                      name="tccAccountId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>TCC Account ID</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} data-testid="input-tcc-account-id" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={updateCompanyMutation.isPending} data-testid="button-save-company">
                      <Save className="h-4 w-4 mr-2" />
                      {updateCompanyMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Store Locations</CardTitle>
                <CardDescription>Manage physical store locations for this company</CardDescription>
              </div>
              <Dialog open={isNewStoreDialogOpen} onOpenChange={setIsNewStoreDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-new-store">
                    <Plus className="h-4 w-4 mr-2" />
                    New Store
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Store</DialogTitle>
                    <DialogDescription>Add a new store location to this company</DialogDescription>
                  </DialogHeader>
                  <Form {...storeForm}>
                    <form onSubmit={storeForm.handleSubmit(handleStoreSubmit)} className="space-y-4">
                      <FormField
                        control={storeForm.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Store Code</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="S001" data-testid="input-store-code" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={storeForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Store Name</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Downtown Store" data-testid="input-store-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={storeForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} data-testid="input-store-phone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={storeForm.control}
                        name="addressLine1"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Address Line 1</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} data-testid="input-address-line1" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={storeForm.control}
                        name="addressLine2"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Address Line 2</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} placeholder="Apt, Suite, etc." data-testid="input-address-line2" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-3 gap-4">
                        <FormField
                          control={storeForm.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>City</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} data-testid="input-city" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={storeForm.control}
                          name="state"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>State</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} placeholder="TX" data-testid="input-state" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={storeForm.control}
                          name="postalCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>ZIP Code</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} data-testid="input-postal-code" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={storeForm.control}
                        name="tccLocationId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>TCC Location ID (Thrive POS)</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} placeholder="6a459cda-a9b3-40da-b6a7-5c858b30a3a7" data-testid="input-tcc-location-id" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsNewStoreDialogOpen(false)}
                          data-testid="button-cancel-store"
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={createStoreMutation.isPending} data-testid="button-save-store">
                          {createStoreMutation.isPending ? "Creating..." : "Create Store"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {stores.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-stores">
                No stores found. Create your first store to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {stores.map((store) => (
                  <div
                    key={store.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover-elevate"
                    data-testid={`store-item-${store.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Store className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium" data-testid={`text-store-name-${store.id}`}>{store.name}</div>
                        <div className="text-sm text-muted-foreground" data-testid={`text-store-code-${store.id}`}>
                          {store.code}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={store.status === "active" ? "default" : "secondary"}
                        data-testid={`badge-store-status-${store.id}`}
                      >
                        {store.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingStore(store);
                          setIsEditStoreDialogOpen(true);
                        }}
                        data-testid={`button-edit-store-${store.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {store.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeactivateStore(store)}
                          data-testid={`button-deactivate-store-${store.id}`}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleActivateStore(store)}
                          data-testid={`button-activate-store-${store.id}`}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Store Dialog */}
      <Dialog open={isEditStoreDialogOpen} onOpenChange={(open) => {
        setIsEditStoreDialogOpen(open);
        if (!open) {
          setEditingStore(null);
          storeForm.reset({
            companyId: id || "",
            code: "",
            name: "",
            status: "active",
          });
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Store</DialogTitle>
            <DialogDescription>Update store information and settings</DialogDescription>
          </DialogHeader>
          {editingStore && (
            <Form {...storeForm} key={editingStore.id}>
              <form onSubmit={storeForm.handleSubmit(handleStoreSubmit)} className="space-y-4">
                <FormField
                  control={storeForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-store-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store Code</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-store-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-edit-store-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="addressLine1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address Line 1</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-edit-address-line1" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="addressLine2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address Line 2</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Apt, Suite, etc." data-testid="input-edit-address-line2" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={storeForm.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-edit-city" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={storeForm.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} placeholder="TX" data-testid="input-edit-state" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={storeForm.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-edit-postal-code" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={storeForm.control}
                  name="tccLocationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>TCC Location ID (Thrive POS)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="6a459cda-a9b3-40da-b6a7-5c858b30a3a7" data-testid="input-edit-tcc-location-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={storeForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditStoreDialogOpen(false);
                      setEditingStore(null);
                      storeForm.reset({
                        companyId: id || "",
                        code: "",
                        name: "",
                        status: "active",
                      });
                    }}
                    data-testid="button-cancel-edit-store"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateStoreMutation.isPending} data-testid="button-save-edit-store">
                    {updateStoreMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
