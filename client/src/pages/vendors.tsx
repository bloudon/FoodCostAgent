import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, Zap, Upload, Store, MapPin } from "lucide-react";
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
import { insertVendorSchema, type InsertVendor, type Vendor, type VendorItem, type CompanyStore, type StoreVendor } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { useStoreContext } from "@/hooks/use-store-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Form schema that omits companyId (added by backend from authenticated user)
const vendorFormSchema = insertVendorSchema.omit({ companyId: true });
type VendorFormData = z.infer<typeof vendorFormSchema>;

type VendorStoreAssignment = StoreVendor & { store?: CompanyStore };

export default function Vendors() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedVendorForImport, setSelectedVendorForImport] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isStoreAssignDialogOpen, setIsStoreAssignDialogOpen] = useState(false);
  const [vendorToAssign, setVendorToAssign] = useState<Vendor | null>(null);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const { toast } = useToast();
  const { selectedStoreId, stores } = useStoreContext();

  const { data: vendors, isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorItems, isLoading: vendorItemsLoading } = useQuery<VendorItem[]>({
    queryKey: ["/api/vendor-items"],
  });

  // Fetch store assignments for each vendor
  const { data: vendorStoreAssignments } = useQuery<Record<string, VendorStoreAssignment[]>>({
    queryKey: ["/api/vendor-store-assignments", vendors?.map(v => v.id).join(",")],
    queryFn: async () => {
      if (!vendors || vendors.length === 0) return {};
      const assignments: Record<string, VendorStoreAssignment[]> = {};
      for (const vendor of vendors) {
        try {
          const response = await fetch(`/api/vendors/${vendor.id}/stores`, { credentials: 'include' });
          if (response.ok) {
            assignments[vendor.id] = await response.json();
          } else {
            assignments[vendor.id] = [];
          }
        } catch {
          assignments[vendor.id] = [];
        }
      }
      return assignments;
    },
    enabled: !!vendors && vendors.length > 0,
  });

  const form = useForm<VendorFormData>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: {
      name: "",
      accountNumber: "",
      orderGuideType: "manual",
      phone: "",
      website: "",
      deliveryDays: [],
      leadDaysAhead: undefined,
      active: 1,
      taxId: "",
      requires1099: 0,
      paymentTerms: "",
      creditLimit: undefined,
      certifications: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: VendorFormData) => {
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<VendorFormData> }) => {
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

  const storeAssignMutation = useMutation({
    mutationFn: async ({ vendorId, storeIds }: { vendorId: string; storeIds: string[] }) => {
      return await apiRequest("POST", `/api/vendors/${vendorId}/stores/bulk`, { storeIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-store-assignments"] });
      toast({
        title: "Success",
        description: "Store assignments updated successfully",
      });
      setIsStoreAssignDialogOpen(false);
      setVendorToAssign(null);
      setSelectedStoreIds([]);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const uploadOrderGuideMutation = useMutation({
    mutationFn: async ({ fileContent, vendorId, fileName, isExcel }: { fileContent: string; vendorId: string; fileName: string; isExcel: boolean }) => {
      // Determine vendor key based on vendor name
      const vendor = vendors?.find(v => v.id === vendorId);
      let vendorKey = 'sysco'; // default
      
      if (vendor) {
        const vendorName = vendor.name.toLowerCase();
        if (vendorName.includes('sysco')) vendorKey = 'sysco';
        else if (vendorName.includes('gfs') || vendorName.includes('gordon')) vendorKey = 'gfs';
        else if (vendorName.includes('us foods') || vendorName.includes('usfoods')) vendorKey = 'usfoods';
      }

      const response = await apiRequest('POST', '/api/order-guides/upload', {
        fileContent,
        vendorKey,
        vendorId,
        fileName,
        isExcel,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Order Guide Uploaded',
        description: `${data.totalItems} items processed with ${data.highConfidenceMatches} auto-matched`,
      });
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      setSelectedVendorForImport('');
      
      // Navigate to review page
      window.location.href = `/order-guides/${data.orderGuideId}/review`;
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleImportSubmit = async () => {
    if (!selectedFile || !selectedVendorForImport) {
      toast({
        title: 'Missing Information',
        description: 'Please select both a vendor and a file (CSV or Excel)',
        variant: 'destructive',
      });
      return;
    }

    // Always read as ArrayBuffer first to check magic bytes for Excel detection
    // This handles cases where files have wrong extensions (e.g., .csv file that's actually Excel)
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Check for Excel magic bytes:
      // XLSX (ZIP): starts with PK (0x50 0x4B)
      // XLS (OLE): starts with 0xD0 0xCF 0x11 0xE0
      const isExcelContent = 
        (uint8Array[0] === 0x50 && uint8Array[1] === 0x4B) || // XLSX/ZIP
        (uint8Array[0] === 0xD0 && uint8Array[1] === 0xCF);   // XLS/OLE
      
      if (isExcelContent) {
        // Convert to base64 for Excel files
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64Content = btoa(binary);
        uploadOrderGuideMutation.mutate({
          fileContent: base64Content,
          vendorId: selectedVendorForImport,
          fileName: selectedFile.name,
          isExcel: true,
        });
      } else {
        // For CSV files, decode as text
        const decoder = new TextDecoder('utf-8');
        const textContent = decoder.decode(arrayBuffer);
        uploadOrderGuideMutation.mutate({
          fileContent: textContent,
          vendorId: selectedVendorForImport,
          fileName: selectedFile.name,
          isExcel: false,
        });
      }
    };
    
    reader.readAsArrayBuffer(selectedFile);
  };

  const getProductCount = (vendorId: string) => {
    if (vendorItemsLoading) return "...";
    return vendorItems?.filter(vi => vi.vendorId === vendorId).length || 0;
  };

  const abbreviateDay = (day: string): string => {
    const abbrev: Record<string, string> = {
      Monday: "Mon",
      Tuesday: "Tue", 
      Wednesday: "Wed",
      Thursday: "Thu",
      Friday: "Fri",
      Saturday: "Sat",
      Sunday: "Sun",
    };
    return abbrev[day] || day;
  };

  const calculateOrderDays = (deliveryDays: string[], leadDaysAhead: number): string[] => {
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    // Map each delivery day to its corresponding order day, maintaining original order
    return deliveryDays.map(deliveryDay => {
      const deliveryIndex = daysOfWeek.indexOf(deliveryDay);
      if (deliveryIndex === -1) return deliveryDay;
      
      // Calculate the order day by going back leadDaysAhead days
      const orderIndex = (deliveryIndex - leadDaysAhead + 7) % 7;
      return daysOfWeek[orderIndex];
    });
  };

  const filteredVendors = vendors?.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateClick = () => {
    setEditingVendor(null);
    form.reset({ 
      name: "", 
      accountNumber: "", 
      orderGuideType: "manual", 
      phone: "", 
      website: "",
      deliveryDays: [],
      leadDaysAhead: undefined,
      active: 1,
      taxId: "",
      requires1099: 0,
      paymentTerms: "",
      creditLimit: undefined,
      certifications: [],
    });
    setIsDialogOpen(true);
  };

  const handleEditClick = (vendor: Vendor) => {
    setEditingVendor(vendor);
    form.reset({
      name: vendor.name,
      accountNumber: vendor.accountNumber || "",
      orderGuideType: vendor.orderGuideType || "manual",
      phone: vendor.phone || "",
      website: vendor.website || "",
      deliveryDays: vendor.deliveryDays || [],
      leadDaysAhead: vendor.leadDaysAhead ?? undefined,
      active: vendor.active ?? 1,
      taxId: vendor.taxId || "",
      requires1099: vendor.requires1099 ?? 0,
      paymentTerms: vendor.paymentTerms || "",
      creditLimit: vendor.creditLimit ?? undefined,
      certifications: vendor.certifications || [],
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (vendor: Vendor) => {
    setVendorToDelete(vendor);
    setDeleteDialogOpen(true);
  };

  const handleStoreAssignClick = (vendor: Vendor) => {
    setVendorToAssign(vendor);
    const currentAssignments = vendorStoreAssignments?.[vendor.id] || [];
    setSelectedStoreIds(currentAssignments.map(a => a.storeId));
    setIsStoreAssignDialogOpen(true);
  };

  const handleStoreToggle = (storeId: string) => {
    setSelectedStoreIds(prev => 
      prev.includes(storeId) 
        ? prev.filter(id => id !== storeId)
        : [...prev, storeId]
    );
  };

  const handleSaveStoreAssignments = () => {
    if (vendorToAssign) {
      storeAssignMutation.mutate({ 
        vendorId: vendorToAssign.id, 
        storeIds: selectedStoreIds 
      });
    }
  };

  const getVendorStoreCount = (vendorId: string) => {
    return vendorStoreAssignments?.[vendorId]?.length || 0;
  };

  const isVendorAssignedToCurrentStore = (vendorId: string) => {
    const assignments = vendorStoreAssignments?.[vendorId] || [];
    return assignments.some(a => a.storeId === selectedStoreId);
  };

  const onSubmit = (data: VendorFormData) => {
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
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => setIsImportDialogOpen(true)} 
            data-testid="button-import-order-guide"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Order Guide
          </Button>
          <Button onClick={handleCreateClick} data-testid="button-create-vendor">
            <Plus className="h-4 w-4 mr-2" />
            New Vendor
          </Button>
        </div>
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor Name</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead>Account #</TableHead>
              <TableHead>Stores</TableHead>
              <TableHead>Order Guide</TableHead>
              <TableHead>Delivery Days</TableHead>
              <TableHead>Order By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                </TableRow>
              ))
            ) : filteredVendors && filteredVendors.length > 0 ? (
              filteredVendors.map((vendor) => {
                const isMiscGrocery = vendor.name?.toLowerCase().includes('misc grocery') || false;
                
                return (
                  <TableRow key={vendor.id} data-testid={`row-vendor-${vendor.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link 
                          href={`/vendors/${vendor.id}`} 
                          className="font-medium hover:underline"
                          data-testid={`link-vendor-detail-${vendor.id}`}
                        >
                          <span data-testid={`text-vendor-name-${vendor.id}`}>{vendor.name}</span>
                        </Link>
                        {isVendorAssignedToCurrentStore(vendor.id) ? (
                          <Badge variant="default" className="text-xs" data-testid={`badge-assigned-${vendor.id}`}>
                            <MapPin className="h-3 w-3 mr-1" />
                            Assigned
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-not-assigned-${vendor.id}`}>
                            Not Assigned
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-vendor-products-${vendor.id}`}>
                      {getProductCount(vendor.id)}
                    </TableCell>
                    <TableCell className="font-mono" data-testid={`text-vendor-account-${vendor.id}`}>
                      {vendor.accountNumber || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className="font-mono cursor-pointer hover:bg-muted"
                        onClick={() => handleStoreAssignClick(vendor)}
                        data-testid={`text-vendor-stores-${vendor.id}`}
                      >
                        {getVendorStoreCount(vendor.id)} / {stores.length}
                      </Badge>
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell data-testid={`text-delivery-days-${vendor.id}`}>
                      {vendor.deliveryDays && vendor.deliveryDays.length > 0 
                        ? vendor.deliveryDays.map(abbreviateDay).join(", ")
                        : "-"
                      }
                    </TableCell>
                    <TableCell data-testid={`text-order-days-${vendor.id}`}>
                      {vendor.deliveryDays && vendor.deliveryDays.length > 0 && vendor.leadDaysAhead && vendor.leadDaysAhead > 0
                        ? calculateOrderDays(vendor.deliveryDays, vendor.leadDaysAhead).map(abbreviateDay).join(", ")
                        : "-"
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => handleStoreAssignClick(vendor)}
                              data-testid={`button-store-assign-${vendor.id}`}
                            >
                              <Store className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Manage Store Assignments</TooltipContent>
                        </Tooltip>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleEditClick(vendor)}
                          data-testid={`button-edit-vendor-${vendor.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!isMiscGrocery && (
                          <Button 
                            size="icon" 
                            variant="ghost"
                            onClick={() => handleDeleteClick(vendor)}
                            data-testid={`button-delete-vendor-${vendor.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {searchQuery ? "No vendors match your search" : "No vendors found. Create your first vendor to get started."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-vendor-form">
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
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ordering Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="(555) 123-4567" 
                        {...field}
                        value={field.value || ""}
                        data-testid="input-vendor-phone"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://vendor.com" 
                        {...field}
                        value={field.value || ""}
                        data-testid="input-vendor-website"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deliveryDays"
                render={() => (
                  <FormItem>
                    <FormLabel>Delivery Days (Optional)</FormLabel>
                    <FormDescription>
                      Select the days of the week when this vendor delivers
                    </FormDescription>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                        <FormField
                          key={day}
                          control={form.control}
                          name="deliveryDays"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={day}
                                className="flex flex-row items-center space-x-2 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(day as any)}
                                    onCheckedChange={(checked) => {
                                      const currentValue = field.value || [];
                                      return checked
                                        ? field.onChange([...currentValue, day])
                                        : field.onChange(
                                            currentValue.filter((value) => value !== day)
                                          );
                                    }}
                                    data-testid={`checkbox-delivery-${day.toLowerCase()}`}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal cursor-pointer">
                                  {day}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="leadDaysAhead"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead Days Ahead (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        type="number"
                        min="0"
                        max="30"
                        placeholder="e.g., 2" 
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          field.onChange(value === "" ? undefined : parseInt(value, 10));
                        }}
                        data-testid="input-lead-days-ahead"
                      />
                    </FormControl>
                    <FormDescription>
                      Number of days in advance to place orders before delivery
                    </FormDescription>
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
              
              <div className="pt-4 border-t">
                <h4 className="text-sm font-semibold mb-4">Compliance & Accounting</h4>
                
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="taxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tax ID / EIN (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="12-3456789" 
                            {...field}
                            value={field.value || ""}
                            data-testid="input-vendor-tax-id"
                          />
                        </FormControl>
                        <FormDescription>
                          Required for 1099 reporting
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="requires1099"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value === 1}
                            onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                            data-testid="checkbox-requires-1099"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="font-normal cursor-pointer">
                            Requires 1099 reporting
                          </FormLabel>
                          <FormDescription>
                            Check if this vendor requires annual 1099 forms
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="paymentTerms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Terms (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., Net 30, COD, Net 15" 
                            {...field}
                            value={field.value || ""}
                            data-testid="input-vendor-payment-terms"
                          />
                        </FormControl>
                        <FormDescription>
                          Payment terms agreed with vendor
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="creditLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Credit Limit (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g., 10000.00" 
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseFloat(value));
                            }}
                            data-testid="input-vendor-credit-limit"
                          />
                        </FormControl>
                        <FormDescription>
                          Maximum credit limit approved for this vendor
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              
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

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent data-testid="dialog-import-order-guide">
          <DialogHeader>
            <DialogTitle>Import Order Guide</DialogTitle>
            <DialogDescription>
              Upload an order guide (CSV or Excel) from Sysco, US Foods, or GFS. The system will automatically match products to your inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Vendor</label>
              <Select value={selectedVendorForImport} onValueChange={setSelectedVendorForImport}>
                <SelectTrigger data-testid="select-vendor-import">
                  <SelectValue placeholder="Choose a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors?.filter(v => v.active === 1).map(vendor => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Order Guide File</label>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                data-testid="input-file-import"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            <div className="rounded-lg bg-muted p-4 space-y-2">
              <p className="text-sm font-medium">How it works:</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Products are automatically matched to your inventory items</li>
                <li>Review and approve the matched items</li>
                <li>Vendor items are created with current pricing</li>
              </ol>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsImportDialogOpen(false)}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleImportSubmit}
              disabled={!selectedFile || !selectedVendorForImport || uploadOrderGuideMutation.isPending}
              data-testid="button-submit-import"
            >
              {uploadOrderGuideMutation.isPending ? 'Uploading...' : 'Upload & Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStoreAssignDialogOpen} onOpenChange={setIsStoreAssignDialogOpen}>
        <DialogContent data-testid="dialog-store-assign">
          <DialogHeader>
            <DialogTitle>Assign Vendor to Stores</DialogTitle>
            <DialogDescription>
              Select which stores this vendor should be available for. Only assigned vendors will appear in store-specific vendor lists.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm font-medium mb-4">
              {vendorToAssign?.name} - Select Stores:
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {stores.map((store) => (
                <div 
                  key={store.id} 
                  className="flex items-center space-x-3 p-2 rounded-md hover-elevate"
                  data-testid={`store-option-${store.id}`}
                >
                  <Checkbox 
                    id={`store-${store.id}`}
                    checked={selectedStoreIds.includes(store.id)}
                    onCheckedChange={() => handleStoreToggle(store.id)}
                  />
                  <label 
                    htmlFor={`store-${store.id}`}
                    className="flex-1 text-sm font-medium cursor-pointer"
                  >
                    {store.name}
                  </label>
                  {store.id === selectedStoreId && (
                    <Badge variant="secondary" className="text-xs">Current</Badge>
                  )}
                </div>
              ))}
            </div>
            {stores.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No stores available.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsStoreAssignDialogOpen(false)}
              data-testid="button-cancel-store-assign"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveStoreAssignments}
              disabled={storeAssignMutation.isPending}
              data-testid="button-save-store-assign"
            >
              {storeAssignMutation.isPending ? 'Saving...' : 'Save Assignments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
