import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
import { SortableTableHead, useTableSort, sortData } from "@/components/sortable-table-head";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, Zap, Upload, Store, MapPin, ScanLine, TriangleAlert, Link2, RefreshCw, Building2 } from "lucide-react";
import { VendorLogo } from "@/components/vendor-logo";
import { Link, useLocation } from "wouter";

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
import { formatPhoneNumber } from "@/lib/phone";
import { SetupProgressBanner } from "@/components/setup-progress-banner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const vendorFormSchema = insertVendorSchema.omit({ companyId: true }).superRefine((data, ctx) => {
  if (data.phone) {
    const digits = data.phone.replace(/\D/g, "");
    if (digits.length > 0 && digits.length !== 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Phone number must be 10 digits", path: ["phone"] });
    }
  }
});
type VendorFormData = z.infer<typeof vendorFormSchema>;

type VendorStoreAssignment = StoreVendor & { store?: CompanyStore };

interface MilestonesResponse {
  milestones: { id: string; label: string; completed: boolean; path: string }[];
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
}

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
  const [storeAccountNumbers, setStoreAccountNumbers] = useState<Record<string, string>>({});


  const [connectorId, setConnectorId] = useState<string>("");
  // Tracks how the connector was last set: "none" = untouched, "auto" = registry detect, "manual" = user explicitly chose
  const connectorSelectionSourceRef = useRef<"auto" | "manual" | "none">("none");
  const [connectorSelectionSource, setConnectorSelectionSource] = useState<"auto" | "manual" | "none">("none");

  // Registry picker state (for the "Start from a known distributor" combobox in the Add Vendor dialog)
  type RegResult = { id: string; normalizedName: string; website: string | null; connectorId: string | null; connectorDisplayName: string | null; category: string | null };
  const [regQuery, setRegQuery] = useState("");
  const [regResults, setRegResults] = useState<RegResult[]>([]);
  const [regPickerOpen, setRegPickerOpen] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const regTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();
  const { selectedStoreId, stores } = useStoreContext();
  const [, setLocation] = useLocation();

  const { data: milestonesData } = useQuery<MilestonesResponse>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
    staleTime: 0,
  });

  const MILESTONE_ID = "vendors";
  const currentMilestone = milestonesData?.milestones.find(m => m.id === MILESTONE_ID);
  const showOnboardingButtons = milestonesData && !milestonesData.dismissed && currentMilestone && !currentMilestone.completed;

  const { data: vendors, isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorItems, isLoading: vendorItemsLoading } = useQuery<VendorItem[]>({
    queryKey: ["/api/vendor-items"],
  });

  interface ConnectorDefinition {
    connectorId: string;
    displayName: string;
  }
  const { data: connectorDefsData } = useQuery<{ data: ConnectorDefinition[] }>({
    queryKey: ["/api/connector-definitions"],
    staleTime: Infinity,
  });
  const connectorDefs = connectorDefsData?.data ?? [];

  const { data: supplierConnectionsData } = useQuery<{ data: Array<{ id: string; vendorId: string; connectorId: string }> }>({
    queryKey: ["/api/supplier-connections"],
  });

  // Fetch store assignments for each vendor
  const { data: warningCounts } = useQuery<Record<string, { warningCount: number; orderGuideId: string }>>({
    queryKey: ["/api/order-guides/warning-counts"],
    staleTime: 60_000,
  });

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
      receiveByUnit: 0,
      paymentTerms: "",
      creditLimit: undefined,
      certifications: [],
    },
  });

  const upsertConnector = async (vendorId: string, cid: string, _vendorName: string, _vendorWebsite?: string) => {
    try {
      // PUT handles both cases: non-empty cid = upsert, empty cid = unlink (delete row).
      // Server-side PUT also triggers the registry suggest for non-empty connectorIds.
      await apiRequest("PUT", `/api/supplier-connections/${vendorId}`, { connectorId: cid, isActive: 1 });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-connections"] });
    } catch {
      // non-fatal — vendor was created/updated successfully
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: VendorFormData) => {
      const res = await apiRequest("POST", "/api/vendors", data);
      return await res.json() as Vendor;
    },
    onSuccess: async (createdVendor: Vendor) => {
      const formVals = form.getValues();
      await upsertConnector(createdVendor.id, connectorId, formVals.name, formVals.website);
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({
        title: "Success",
        description: "Vendor created successfully",
      });
      setIsDialogOpen(false);
      form.reset();
      setConnectorId("");
      if (stores.length > 0) {
        setVendorToAssign(createdVendor);
        setSelectedStoreIds(selectedStoreId ? [selectedStoreId] : []);
        setStoreAccountNumbers({});
        setIsStoreAssignDialogOpen(true);
      }
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
    onSuccess: async () => {
      if (editingVendor) {
        const formVals = form.getValues();
        await upsertConnector(editingVendor.id, connectorId, formVals.name, formVals.website);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({
        title: "Success",
        description: "Vendor updated successfully",
      });
      setIsDialogOpen(false);
      setEditingVendor(null);
      setConnectorId("");
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
    mutationFn: async ({ vendorId, storeIds, accountNumbers }: { vendorId: string; storeIds: string[]; accountNumbers: Record<string, string> }) => {
      return await apiRequest("POST", `/api/vendors/${vendorId}/stores/bulk`, { storeIds, accountNumbers });
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
      setStoreAccountNumbers({});
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
        description: 'Please select both a vendor and a file',
        variant: 'destructive',
      });
      return;
    }

    // PDF catalogs → navigate to order-guide-scan which handles PDFs natively
    if (selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      const params = new URLSearchParams();
      params.set('vendorId', selectedVendorForImport);
      if (selectedStoreId) params.set('storeId', selectedStoreId);
      setLocation(`/order-guide-scan?${params.toString()}`);
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

  const { sortField, sortDirection, handleSort } = useTableSort("name");

  const sortedVendors = useMemo(() => {
    const list = filteredVendors ?? [];
    const productCountMap = new Map(
      list.map(v => [v.id, vendorItems?.filter(vi => vi.vendorId === v.id).length ?? 0])
    );
    return sortData(list, sortField, sortDirection, (v, field) => {
      switch (field) {
        case "name": return v.name;
        case "productCount": return productCountMap.get(v.id) ?? 0;
        case "accountNumber": return v.accountNumber ?? "";
        default: return null;
      }
    });
  }, [filteredVendors, sortField, sortDirection, vendorItems]);

  // Debounced registry search: for the "Start from a known distributor" picker in the Add Vendor dialog
  const fetchRegResults = useCallback(async (q: string) => {
    if (!q.trim()) { setRegResults([]); setRegPickerOpen(false); return; }
    if (regTimerRef.current) clearTimeout(regTimerRef.current);
    regTimerRef.current = setTimeout(async () => {
      setRegLoading(true);
      try {
        const res = await fetch(`/api/vendor-registry/search?q=${encodeURIComponent(q)}&limit=8`, { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          setRegResults(json.data ?? []);
          setRegPickerOpen(true);
        }
      } catch { setRegResults([]); }
      setRegLoading(false);
    }, 280);
  }, []);

  // Debounced registry detect: when the vendor name or website changes in the dialog,
  // query the registry API to auto-suggest a connector.
  const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectConnectorFromRegistry = useCallback((name: string, website: string) => {
    // If the user explicitly chose a connector (or chose "None"), respect that choice — don't override it
    if (connectorSelectionSourceRef.current === "manual") return;
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    if (!name.trim() && !website.trim()) return;
    detectTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (name.trim()) params.set("name", name.trim());
        if (website.trim()) params.set("website", website.trim());
        const res = await fetch(`/api/vendor-registry/detect?${params}`, { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        // Re-check: user may have manually selected while the request was in flight
        if (connectorSelectionSourceRef.current === "manual") return;
        if (json?.data?.connectorId) {
          setConnectorId(json.data.connectorId);
          connectorSelectionSourceRef.current = "auto";
          setConnectorSelectionSource("auto");
        }
      } catch { /* non-fatal */ }
    }, 400);
  }, []);

  const handleCreateClick = () => {
    setEditingVendor(null);
    setConnectorId("");
    connectorSelectionSourceRef.current = "none";
    setConnectorSelectionSource("none");
    setRegQuery("");
    setRegResults([]);
    setRegPickerOpen(false);
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
      receiveByUnit: 0,
      paymentTerms: "",
      creditLimit: undefined,
      certifications: [],
    });
    setIsDialogOpen(true);
  };

  const handleEditClick = (vendor: Vendor) => {
    setEditingVendor(vendor);
    const existing = supplierConnectionsData?.data?.find(c => c.vendorId === vendor.id);
    const existingConnectorId = existing?.connectorId ?? "";
    setConnectorId(existingConnectorId);
    // Reset selection source so this session starts fresh
    connectorSelectionSourceRef.current = "none";
    setConnectorSelectionSource("none");
    // If no existing connection, auto-detect from registry
    if (!existingConnectorId) {
      detectConnectorFromRegistry(vendor.name, vendor.website ?? "");
    }
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
      receiveByUnit: vendor.receiveByUnit ?? 0,
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
    const accountNums: Record<string, string> = {};
    currentAssignments.forEach(a => {
      if (a.accountNumber) accountNums[a.storeId] = a.accountNumber;
    });
    setStoreAccountNumbers(accountNums);
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
        storeIds: selectedStoreIds,
        accountNumbers: storeAccountNumbers
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

  const handleOpenScanPage = (prefillVendorId?: string) => {
    const params = new URLSearchParams();
    if (prefillVendorId) params.set('vendorId', prefillVendorId);
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    const qs = params.toString();
    setLocation(`/order-guide-scan${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="p-4 pb-16 sm:p-8">
      <div className="mb-4 sm:mb-8 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" data-testid="text-vendors-title">
            Vendors
          </h1>
          {!showOnboardingButtons && (
            <p className="text-muted-foreground mt-2">
              Manage vendor catalogs with product pricing and case specifications
            </p>
          )}
          {showOnboardingButtons && (
            <p className="text-muted-foreground mt-2">
              Add your vendors, or skip this step for now.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              onClick={() => handleOpenScanPage()}
              data-testid="button-scan-invoice"
            >
              <ScanLine className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Scan Invoice / PDF</span>
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setIsImportDialogOpen(true)} 
              data-testid="button-import-order-guide"
            >
              <Upload className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Import Order Guide</span>
            </Button>
            <Button onClick={handleCreateClick} data-testid="button-create-vendor">
              <Plus className="h-4 w-4 mr-2" />
              New Vendor
            </Button>
          </div>
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

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead field="name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="min-w-[180px]">Vendor Name</SortableTableHead>
              <SortableTableHead field="productCount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="text-right hidden sm:table-cell">Products</SortableTableHead>
              <SortableTableHead field="accountNumber" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="hidden md:table-cell">Account #</SortableTableHead>
              <TableHead className="hidden md:table-cell">Stores</TableHead>
              <TableHead className="hidden lg:table-cell">Order Guide</TableHead>
              <TableHead className="hidden lg:table-cell">Delivery Days</TableHead>
              <TableHead className="hidden xl:table-cell">Order By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell className="hidden xl:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                </TableRow>
              ))
            ) : sortedVendors.length > 0 ? (
              sortedVendors.map((vendor) => {
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
                          <Badge 
                            variant="destructive" 
                            className="text-xs cursor-pointer" 
                            onClick={() => handleStoreAssignClick(vendor)}
                            data-testid={`badge-not-assigned-${vendor.id}`}
                          >
                            Assign Your Store
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono hidden sm:table-cell" data-testid={`text-vendor-products-${vendor.id}`}>
                      {getProductCount(vendor.id)}
                    </TableCell>
                    <TableCell className="font-mono hidden md:table-cell" data-testid={`text-vendor-account-${vendor.id}`}>
                      {vendor.accountNumber || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge 
                        variant="outline" 
                        className="font-mono cursor-pointer hover:bg-muted"
                        onClick={() => handleStoreAssignClick(vendor)}
                        data-testid={`text-vendor-stores-${vendor.id}`}
                      >
                        {getVendorStoreCount(vendor.id)} / {stores.length}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex items-center gap-2 flex-wrap">
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
                        {warningCounts?.[vendor.id] && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="gap-1 cursor-pointer border-amber-500 text-amber-600 dark:text-amber-400"
                                onClick={() => setLocation(`/order-guides/${warningCounts[vendor.id].orderGuideId}/review`)}
                                data-testid={`badge-pack-size-warnings-${vendor.id}`}
                              >
                                <TriangleAlert className="h-3 w-3" />
                                {warningCounts[vendor.id].warningCount} {warningCounts[vendor.id].warningCount === 1 ? "warning" : "warnings"}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Pack-size warnings detected — click to review</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell" data-testid={`text-delivery-days-${vendor.id}`}>
                      {vendor.deliveryDays && vendor.deliveryDays.length > 0 
                        ? vendor.deliveryDays.map(abbreviateDay).join(", ")
                        : "-"
                      }
                    </TableCell>
                    <TableCell className="hidden xl:table-cell" data-testid={`text-order-days-${vendor.id}`}>
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
                              onClick={() => handleOpenScanPage(vendor.id)}
                              data-testid={`button-scan-vendor-${vendor.id}`}
                            >
                              <ScanLine className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Scan Invoice / Import PDF</TooltipContent>
                        </Tooltip>
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

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) {
          if (detectTimerRef.current) {
            clearTimeout(detectTimerRef.current);
            detectTimerRef.current = null;
          }
          if (regTimerRef.current) {
            clearTimeout(regTimerRef.current);
            regTimerRef.current = null;
          }
          connectorSelectionSourceRef.current = "none";
          setConnectorSelectionSource("none");
          setRegQuery("");
          setRegResults([]);
          setRegPickerOpen(false);
        }
      }}>
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              {/* ── Registry Picker (create only) ────────────────── */}
              {!editingVendor && (
                <div className="pb-2 border-b space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Start from a known distributor
                    <span className="text-muted-foreground font-normal text-xs">(Optional)</span>
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search Sysco, US Foods, BEK, GFS, PFG…"
                      value={regQuery}
                      onChange={(e) => {
                        setRegQuery(e.target.value);
                        fetchRegResults(e.target.value);
                      }}
                      onFocus={() => { if (regResults.length > 0) setRegPickerOpen(true); }}
                      onBlur={() => setTimeout(() => setRegPickerOpen(false), 160)}
                      className="pl-9"
                      data-testid="input-registry-search"
                      autoComplete="off"
                    />
                    {regPickerOpen && (regLoading || regResults.length > 0) && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                        {regLoading && regResults.length === 0 && (
                          <div className="text-sm text-muted-foreground px-3 py-2">Searching…</div>
                        )}
                        {regResults.map((r) => {
                          const titleName = r.normalizedName.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-3"
                              data-testid={`option-registry-${r.id}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                form.setValue("name", titleName, { shouldValidate: true });
                                if (r.website) form.setValue("website", r.website, { shouldValidate: true });
                                if (r.connectorId) {
                                  if (detectTimerRef.current) { clearTimeout(detectTimerRef.current); detectTimerRef.current = null; }
                                  setConnectorId(r.connectorId);
                                  connectorSelectionSourceRef.current = "auto";
                                  setConnectorSelectionSource("auto");
                                }
                                setRegQuery(titleName);
                                setRegPickerOpen(false);
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <VendorLogo website={r.website} name={r.normalizedName} size={24} />
                                <span className="font-medium truncate">{titleName}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                                {r.connectorDisplayName && <span>{r.connectorDisplayName}</span>}
                                {r.connectorId && (
                                  <span className="font-mono bg-muted text-muted-foreground px-1 rounded text-[10px]">{r.connectorId}</span>
                                )}
                                {r.category && <span className="opacity-70">· {r.category}</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    {regQuery.trim() && !regLoading && regResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No match found — fill in the details below manually.</p>
                    ) : !regQuery ? (
                      <p className="text-xs text-muted-foreground">
                        Selecting a known distributor pre-fills the name, website, and connector type.
                      </p>
                    ) : <span />}
                    {regQuery.trim() && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                        data-testid="button-skip-registry"
                        onClick={() => {
                          setRegQuery("");
                          setRegResults([]);
                          setRegPickerOpen(false);
                        }}
                      >
                        Skip / enter manually
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Vendor Info ─────────────────────────────────── */}
              <div className="space-y-4">
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
                          onChange={(e) => {
                            field.onChange(e);
                            detectConnectorFromRegistry(e.target.value, form.getValues("website") ?? "");
                          }}
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
                      <FormLabel>Account Number <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
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
              </div>

              {/* ── Contact ─────────────────────────────────────── */}
              <div className="pt-4 border-t space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact</h4>
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ordering Phone <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="(555) 123-4567"
                          {...field}
                          value={field.value || ""}
                          onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))}
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
                      <FormLabel>Website <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://vendor.com"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-vendor-website"
                          onChange={(e) => {
                            field.onChange(e);
                            detectConnectorFromRegistry(form.getValues("name") ?? "", e.target.value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ── Delivery Schedule ───────────────────────────── */}
              <div className="pt-4 border-t space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Delivery Schedule</h4>
                <FormField
                  control={form.control}
                  name="deliveryDays"
                  render={() => (
                    <FormItem>
                      <FormLabel>Delivery Days <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                          <FormField
                            key={day}
                            control={form.control}
                            name="deliveryDays"
                            render={({ field }) => (
                              <FormItem key={day} className="flex flex-row items-center space-x-2 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(day as any)}
                                    onCheckedChange={(checked) => {
                                      const cur = field.value || [];
                                      field.onChange(checked ? [...cur, day] : cur.filter(v => v !== day));
                                    }}
                                    data-testid={`checkbox-delivery-${day.toLowerCase()}`}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal cursor-pointer">{day}</FormLabel>
                              </FormItem>
                            )}
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
                      <FormLabel>Lead Days Ahead <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="30"
                          placeholder="e.g., 2"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? undefined : parseInt(v, 10));
                          }}
                          data-testid="input-lead-days-ahead"
                        />
                      </FormControl>
                      <FormDescription>Days in advance to place orders before delivery</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ── Ordering ────────────────────────────────────── */}
              <div className="pt-4 border-t space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Ordering</h4>
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
                        Electronic vendors use EDI, API, or PunchOut. Manual vendors require manual order entry.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Connector integration — always visible */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Distributor Connector <span className="text-muted-foreground font-normal">(Optional)</span>
                    {connectorSelectionSource === "auto" && (
                      <span className="text-xs font-normal text-blue-600 dark:text-blue-400" data-testid="label-auto-detected">
                        Auto-detected
                      </span>
                    )}
                  </label>
                  <div className="flex gap-2 items-center">
                    <Select
                      value={connectorId || "__none__"}
                      onValueChange={(v) => {
                        // Cancel any pending auto-detect before it fires
                        if (detectTimerRef.current) {
                          clearTimeout(detectTimerRef.current);
                          detectTimerRef.current = null;
                        }
                        connectorSelectionSourceRef.current = "manual";
                        setConnectorSelectionSource("manual");
                        setConnectorId(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger data-testid="select-connector-id" className="flex-1">
                        <SelectValue placeholder="Select a known distributor…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" data-testid="option-connector-none">None / not configured</SelectItem>
                        {connectorDefs.filter(d => d.connectorId !== "generic").map(d => (
                          <SelectItem key={d.connectorId} value={d.connectorId} data-testid={`option-connector-${d.connectorId}`}>
                            {d.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Detect again from name and website"
                      data-testid="button-detect-again"
                      onClick={() => {
                        connectorSelectionSourceRef.current = "none";
                        setConnectorSelectionSource("none");
                        detectConnectorFromRegistry(
                          form.getValues("name") ?? "",
                          form.getValues("website") ?? ""
                        );
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Links this vendor to a known distributor so PO exports and order guide imports use the right format automatically.
                    {connectorSelectionSource === "manual" && (
                      <span className="ml-1 text-muted-foreground/70">Manually selected — auto-detect paused.</span>
                    )}
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="receiveByUnit"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value === 1}
                          onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                          data-testid="checkbox-receive-by-unit"
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="font-normal cursor-pointer">Receive by Unit</FormLabel>
                        <FormDescription>
                          Receiving screen defaults to unit-level quantities instead of cases.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              {/* ── Compliance & Accounting ─────────────────────── */}
              <div className="pt-4 border-t space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Compliance &amp; Accounting</h4>
                <FormField
                  control={form.control}
                  name="taxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax ID / EIN <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="12-3456789"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-vendor-tax-id"
                        />
                      </FormControl>
                      <FormDescription>Required for 1099 reporting</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="requires1099"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value === 1}
                          onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                          data-testid="checkbox-requires-1099"
                        />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="font-normal cursor-pointer">Requires 1099 reporting</FormLabel>
                        <FormDescription>Check if this vendor requires annual 1099 forms</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="paymentTerms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Terms <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., Net 30, COD"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-vendor-payment-terms"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="creditLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Credit Limit <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g., 10000.00"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              field.onChange(v === "" ? undefined : parseFloat(v));
                            }}
                            data-testid="input-vendor-credit-limit"
                          />
                        </FormControl>
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
              Upload a CSV, Excel, or PDF catalog from any vendor. Products are automatically matched to your inventory.
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
              {vendors !== undefined && vendors.filter(v => v.active === 1).length === 0 && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  No vendors yet.{" "}
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2 hover:opacity-75"
                    data-testid="link-add-vendor-from-import"
                    onClick={() => {
                      setIsImportDialogOpen(false);
                      setIsDialogOpen(true);
                    }}
                  >
                    Add a vendor first
                  </button>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Order Guide File</label>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls,.pdf"
                onChange={handleFileChange}
                data-testid="input-file-import"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name}
                  {(selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf')) && (
                    <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">(PDF — opens import page)</span>
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                CSV or Excel from Sysco, US Foods, GFS — or a PDF price catalog from any vendor
              </p>
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
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {stores.map((store) => (
                <div 
                  key={store.id} 
                  className="p-3 rounded-md border"
                  data-testid={`store-option-${store.id}`}
                >
                  <div className="flex items-center space-x-3">
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
                  {selectedStoreIds.includes(store.id) && (
                    <div className="mt-2 ml-7">
                      <Input
                        placeholder="Account number (optional)"
                        value={storeAccountNumbers[store.id] || ""}
                        onChange={(e) => setStoreAccountNumbers(prev => ({
                          ...prev,
                          [store.id]: e.target.value
                        }))}
                        className="text-sm"
                        data-testid={`input-account-${store.id}`}
                      />
                    </div>
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
      <SetupProgressBanner currentMilestoneId="vendors" hasEntries={(vendors?.length ?? 0) > 0} />
    </div>
  );
}
