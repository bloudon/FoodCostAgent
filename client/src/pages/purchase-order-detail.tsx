import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Save, Package, Search, PackageCheck, TrendingDown, CalendarIcon, Download, CheckCircle2, AlertTriangle, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parse } from "date-fns";
import { cn, formatDateString } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUnitName } from "@/lib/utils";

type PurchaseOrderDetail = {
  id: string;
  vendorId: string;
  vendorName: string;
  status: string;
  createdAt: string;
  expectedDate: string | null;
  lines: POLineDisplay[];
};

type POLineDisplay = {
  id: string;
  vendorItemId: string;
  inventoryItemId?: string;
  itemName: string;
  vendorSku: string | null;
  orderedQty: number;
  unitId: string;
  unitName: string;
  priceEach: number;
  lineTotal: number;
};

type VendorItem = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  vendorSku: string | null;
  lastPrice: number;
  purchaseUnitId: string;
  purchaseUnitName: string;
  categoryId: string | null;
  categoryName: string | null;
  caseSize: number | null;
  innerPackSize: number | null;
  inventoryItem?: {
    caseSize: number;
    pricePerUnit: number;
  };
};

type Vendor = {
  id: string;
  name: string;
  accountNumber: string | null;
  phone: string | null;
  website: string | null;
};

type InventoryItem = {
  id: string;
  name: string;
  unitId: string;
  unitName: string;
  pricePerUnit: number;
  categoryId: string | null;
  categoryName: string | null;
};

type Category = {
  id: string;
  name: string;
};

type Receipt = {
  id: string;
  companyId: string;
  storeId: string;
  purchaseOrderId: string;
  status: string;
  receivedAt: string;
};

type VendorPriceComparison = {
  inventoryItemId: string;
  inventoryItemName: string;
  vendorPrices: {
    vendorId: string;
    vendorName: string;
    vendorSku: string | null;
    casePrice: number;
    unitPrice: number;
    caseSize: number;
    unitName: string;
    lastUpdated: string;
  }[];
};

type BulkVendorPrice = {
  vendorId: string;
  vendorName: string;
  vendorSku: string | null;
  casePrice: number;
  unitPrice: number;
  caseSize: number;
  unitName: string;
  priceSource: string | null;
  pricedAt: string | null;
  daysSincePriced: number | null;
  stale: boolean;
  confirmed: boolean;
  incompatibleUnit: boolean;
};

type BulkComparisonEntry = {
  vendorPrices: BulkVendorPrice[];
  cheaperAvailable: boolean;
  savingsPerCase: number;
  bestVendorName: string | null;
};

type BulkComparisonResult = {
  data: Record<string, BulkComparisonEntry>;
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = id === "new";

  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  
  // Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [isLoadingExportInfo, setIsLoadingExportInfo] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<{
    connectorId: string;
    displayName: string;
    validation: { canExport: boolean; errors: string[]; warnings: string[] };
  } | null>(null);

  // Track case quantities for each vendor item
  const [caseQuantities, setCaseQuantities] = useState<Record<string, number>>({});
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const { data: purchaseOrder, isLoading: loadingOrder } = useQuery<PurchaseOrderDetail>({
    queryKey: [`/api/purchase-orders/${id}`],
    enabled: !isNew,
  });

  // Check if order is received (locked state)
  const isReceived = purchaseOrder?.status === "received";

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: stores, isLoading: storesLoading } = useAccessibleStores();
  
  // Hide transfers column for single-store companies (transfers require minimum 2 stores)
  // Show column while loading to prevent layout shift for multi-store users
  const hasMultipleStores = storesLoading ? true : (stores?.length ?? 0) >= 2;

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // Fetch receipts for this purchase order
  const { data: receipts } = useQuery<Receipt[]>({
    queryKey: [`/api/purchase-orders/${id}/receipts`],
    enabled: !isNew && !!id,
  });

  // Fetch all receipts for the selected store (for usage equation links)
  const { data: storeReceipts } = useQuery<Receipt[]>({
    queryKey: [`/api/receipts?storeId=${selectedStore}`],
    enabled: !!selectedStore,
  });

  // Check if selected vendor is Misc Grocery (by name, not hardcoded ID)
  const selectedVendorData = vendors?.find(v => v.id === selectedVendor);
  const isMiscGrocery = selectedVendorData?.name?.toLowerCase().includes('misc grocery') || false;

  const { data: vendorItems } = useQuery<VendorItem[]>({
    queryKey: [`/api/vendor-items?vendor_id=${selectedVendor}&store_id=${selectedStore}`],
    enabled: !!selectedVendor && !!selectedStore && !isMiscGrocery,
  });

  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: [`/api/inventory-items?store_id=${selectedStore}`],
    enabled: !!selectedVendor && !!selectedStore && isMiscGrocery,
  });

  // Fetch item usage data for the selected store
  type UsageData = {
    inventoryItemId: string;
    inventoryItemName: string;
    category: string | null;
    previousQty: number;
    receivedQty: number;
    transferredQty: number;
    currentQty: number;
    usage: number;
    unitId: string;
    unitName: string;
    isNegativeUsage: boolean;
    previousCountId: string;
    currentCountId: string;
    receiptIds: string[];
    transferOrderIds: string[];
  };

  const { data: usageData } = useQuery<UsageData[]>({
    queryKey: [`/api/stores/${selectedStore}/usage`],
    enabled: !!selectedStore,
  });

  // Create a map for quick usage lookup by inventory item ID
  const usageMap = new Map(
    (usageData || []).map(item => [item.inventoryItemId, item])
  );

  // Fetch vendor price comparison for selected item
  const { data: vendorPriceComparison } = useQuery<VendorPriceComparison>({
    queryKey: [`/api/inventory-items/${compareItemId}/vendor-prices`],
    enabled: !!compareItemId,
  });

  // Bulk price comparison — fires once we know which items are on this PO and which vendor it's for
  const bulkComparisonIds = !isMiscGrocery && selectedVendor && (vendorItems?.length ?? 0) > 0
    ? vendorItems!.map(vi => vi.inventoryItemId).join(",")
    : "";
  const { data: bulkComparison } = useQuery<BulkComparisonResult>({
    queryKey: [`/api/vendor-prices/bulk`, bulkComparisonIds, selectedVendor],
    queryFn: () =>
      fetch(`/api/vendor-prices/bulk?inventoryItemIds=${encodeURIComponent(bulkComparisonIds)}&vendorId=${encodeURIComponent(selectedVendor)}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: bulkComparisonIds.length > 0 && !!selectedVendor,
    staleTime: 60_000,
  });

  // Lookup helper: given an inventoryItemId, return its bulk comparison entry
  const getComparison = (inventoryItemId: string): BulkComparisonEntry | undefined =>
    bulkComparison?.data?.[inventoryItemId];

  // Fetch export history for this PO
  type ExportLog = {
    id: string;
    connectorId: string;
    exportedAt: string;
    fileFormat: string;
    lineCount: number | null;
    warnings: string[] | null;
    manuallyConfirmedAt: string | null;
    manuallyConfirmedBy: string | null;
  };
  const { data: exportLogs } = useQuery({
    queryKey: [`/api/purchase-orders/${id}/export-logs`],
    enabled: !isNew,
    select: (data: any) => (data?.data || []) as ExportLog[],
  });

  const confirmExportMutation = useMutation({
    mutationFn: async (logId: string) =>
      apiRequest("PATCH", `/api/purchase-orders/${id}/export-logs/${logId}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${id}/export-logs`] });
      toast({ title: "Marked as submitted", description: "Order recorded as uploaded to supplier portal" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to confirm submission", variant: "destructive" });
    },
  });

  const handleOpenExportModal = async () => {
    setShowExportModal(true);
    setExportInfo(null);
    setIsLoadingExportInfo(true);
    try {
      const response = await fetch(`/api/purchase-orders/${id}/export?validateOnly=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await response.json();
      setExportInfo(data.data || null);
    } catch {
      setExportInfo(null);
    } finally {
      setIsLoadingExportInfo(false);
    }
  };

  const handleDownloadExport = async () => {
    if (!exportInfo) return;
    setIsExporting(true);
    try {
      const response = await fetch(`/api/purchase-orders/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ connectorId: exportInfo.connectorId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Export failed");
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || "purchase-order.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${id}/export-logs`] });
      setShowExportModal(false);
      toast({ title: "File downloaded", description: "Upload the file to your supplier portal to place the order." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const savePOMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isNew) {
        return await apiRequest("POST", "/api/purchase-orders", data);
      } else {
        return await apiRequest("PATCH", `/api/purchase-orders/${id}`, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/unified"] });
      if (!isNew) {
        queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/vendor-items?vendor_id=${selectedVendor}&store_id=${selectedStore}`] });
      }
      setHasUnsavedChanges(false);
      toast({
        title: "Success",
        description: `Purchase order ${isNew ? "created" : "updated"} successfully`,
      });
      if (isNew) {
        setLocation("/orders");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save purchase order",
        variant: "destructive",
      });
    },
  });

  const handleCaseQuantityChange = (itemId: string, value: number) => {
    setCaseQuantities(prev => ({
      ...prev,
      [itemId]: value
    }));
    setHasUnsavedChanges(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentItemId: string, items: any[]) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const currentIndex = items.findIndex(item => item.id === currentItemId);
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < items.length) {
        const nextItemId = items[nextIndex].id;
        const nextRef = inputRefs.current[nextItemId];
        
        if (nextRef) {
          e.preventDefault();
          nextRef.focus();
          nextRef.select();
        }
      }
    }
  };

  const handleSave = () => {
    if (!selectedVendor) {
      toast({
        title: "Error",
        description: "Please select a vendor",
        variant: "destructive",
      });
      return;
    }

    if (!selectedStore) {
      toast({
        title: "Error",
        description: "Please select a store",
        variant: "destructive",
      });
      return;
    }

    if (!expectedDate) {
      toast({
        title: "Error",
        description: "Please select an expected date",
        variant: "destructive",
      });
      return;
    }

    const lines = Object.entries(caseQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, caseQty]) => {
        if (isMiscGrocery) {
          const invItem = inventoryItems?.find(item => item.id === itemId);
          return {
            inventoryItemId: itemId,
            orderedQty: caseQty,
            unitId: invItem?.unitId || "",
            priceEach: invItem?.pricePerUnit || 0,
          };
        } else {
          const vendorItem = vendorItems?.find(item => item.id === itemId);
          // Use vendor item's caseSize (Units/Case) — this is total units per case after Task #52
          const caseSize = vendorItem?.caseSize ?? vendorItem?.inventoryItem?.caseSize ?? 1;
          const unitPrice = vendorItem?.lastPrice ?? vendorItem?.inventoryItem?.pricePerUnit ?? 0;
          
          return {
            vendorItemId: itemId,
            orderedQty: caseQty * caseSize,
            caseQuantity: caseQty,
            unitId: vendorItem?.purchaseUnitId || "",
            priceEach: unitPrice,
          };
        }
      });

    if (lines.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one item with quantity",
        variant: "destructive",
      });
      return;
    }

    const poData = {
      vendorId: selectedVendor,
      storeId: selectedStore,
      expectedDate: expectedDate || null,
      status: "pending",
      notes: notes || null,
      lines,
    };

    savePOMutation.mutate(poData);
  };

  // Auto-select single store for new purchase orders in single-store companies
  useEffect(() => {
    if (isNew && stores?.length === 1 && !selectedStore) {
      setSelectedStore(stores[0].id);
    }
  }, [isNew, stores, selectedStore]);

  useEffect(() => {
    if (purchaseOrder && !isNew) {
      setSelectedVendor(purchaseOrder.vendorId);
      setSelectedStore((purchaseOrder as any).storeId || "");
      
      // Use date string directly (already in YYYY-MM-DD format from backend)
      setExpectedDate(purchaseOrder.expectedDate?.slice(0, 10) || "");
      
      setNotes((purchaseOrder as any).notes || "");
    }
  }, [purchaseOrder, isNew]);

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Separate effect to populate quantities after vendorItems/inventoryItems are loaded
  useEffect(() => {
    if (purchaseOrder && !isNew && (vendorItems || inventoryItems)) {
      const quantities: Record<string, number> = {};
      const purchaseVendor = vendors?.find(v => v.id === purchaseOrder.vendorId);
      const isMiscGroceryOrder = purchaseVendor?.name?.toLowerCase().includes('misc grocery') || false;
      
      purchaseOrder.lines.forEach((line) => {
        let itemId: string;
        
        if (isMiscGroceryOrder) {
          // For Misc Grocery: use inventoryItemId from the line (or vendorItemId as fallback)
          itemId = (line as any).inventoryItemId || line.vendorItemId;
        } else {
          // For regular vendors: use vendorItemId
          itemId = line.vendorItemId;
        }
        
        const caseQty = (line as any).caseQuantity;
        if (caseQty !== undefined && caseQty !== null) {
          quantities[itemId] = caseQty;
        } else {
          // For misc grocery or unit-based orders (use orderedQty)
          quantities[itemId] = line.orderedQty;
        }
      });
      
      setCaseQuantities(quantities);
      // Reset unsaved changes flag when loading existing PO data
      setHasUnsavedChanges(false);
    }
  }, [purchaseOrder, isNew, vendorItems, inventoryItems, vendors]);

  // Filter items based on search and category
  const filteredVendorItems = vendorItems?.filter(item => {
    const matchesSearch = item.inventoryItemName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendorSku?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const filteredInventoryItems = inventoryItems?.filter(item => {
    const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const displayItems = isMiscGrocery ? filteredInventoryItems : filteredVendorItems;

  // Calculate total
  const totalAmount = Object.entries(caseQuantities).reduce((sum, [itemId, caseQty]) => {
    if (caseQty <= 0) return sum;
    
    if (isMiscGrocery) {
      const invItem = inventoryItems?.find(item => item.id === itemId);
      return sum + (caseQty * (invItem?.pricePerUnit || 0));
    } else {
      const vendorItem = vendorItems?.find(item => item.id === itemId);
      // Use vendor item's caseSize (Units/Case) — total units per case after Task #52
      const caseSize = vendorItem?.caseSize ?? vendorItem?.inventoryItem?.caseSize ?? 1;
      const unitPrice = vendorItem?.lastPrice ?? vendorItem?.inventoryItem?.pricePerUnit ?? 0;
      const casePrice = unitPrice * caseSize;
      return sum + (caseQty * casePrice);
    }
  }, 0);

  const itemsWithQuantity = Object.values(caseQuantities).filter(qty => qty > 0).length;

  if (loadingOrder && !isNew) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading purchase order...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="p-6 pb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/orders")}
                data-testid="button-back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">
                  {isNew ? "New Purchase Order" : `Purchase Order #${id?.slice(0, 8)}`}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {isNew ? "Create a new purchase order" : "Edit purchase order details"}
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {purchaseOrder && purchaseOrder.status !== "received" && !isNew && (
                <Button
                  asChild
                  variant="outline"
                  data-testid="button-receive-po"
                >
                  <Link href={`/receiving/${purchaseOrder.id}`}>
                    <PackageCheck className="h-4 w-4 mr-2" />
                    Receive Order
                  </Link>
                </Button>
              )}
              {!isNew && !isMiscGrocery && (
                <Button
                  variant="outline"
                  onClick={handleOpenExportModal}
                  data-testid="button-export-po"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Order
                </Button>
              )}
              {!isReceived && (
                <Button
                  onClick={handleSave}
                  disabled={savePOMutation.isPending || !selectedVendor || !selectedStore || itemsWithQuantity === 0}
                  data-testid="button-save-po"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savePOMutation.isPending ? "Saving..." : "Save Order"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 pt-2 space-y-6">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(stores?.length ?? 0) > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Store Location</label>
              <Select 
                value={selectedStore} 
                onValueChange={(value) => {
                  setSelectedStore(value);
                  setHasUnsavedChanges(true);
                  // Clear vendor and quantities when store changes
                  if (value !== selectedStore) {
                    setSelectedVendor("");
                    setCaseQuantities({});
                  }
                }}
                disabled={!isNew}
              >
                <SelectTrigger data-testid="select-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Vendor</label>
            <Select 
              value={selectedVendor} 
              onValueChange={(value) => {
                setSelectedVendor(value);
                setHasUnsavedChanges(true);
                // Clear quantities when vendor changes
                setCaseQuantities({});
              }}
              disabled={!isNew || !selectedStore}
            >
              <SelectTrigger data-testid="select-vendor">
                <SelectValue placeholder={!selectedStore ? "Select store first" : "Select vendor"} />
              </SelectTrigger>
              <SelectContent>
                {vendors?.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Expected Date <span className="text-destructive">*</span>
            </label>
            {isReceived ? (
              <div className="py-2 text-sm" data-testid="text-expected-date">
                {formatDateString(expectedDate)}
              </div>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expectedDate && "text-muted-foreground"
                    )}
                    data-testid="button-expected-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expectedDate ? format(parse(expectedDate, 'yyyy-MM-dd', new Date()), "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expectedDate ? parse(expectedDate, 'yyyy-MM-dd', new Date()) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        setExpectedDate(`${year}-${month}-${day}`);
                        setHasUnsavedChanges(true);
                      }
                    }}
                    initialFocus
                    data-testid="calendar-expected-date"
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Badge variant="secondary" className="text-sm">
              {purchaseOrder?.status || "Pending"}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Notes</label>
          {isReceived ? (
            <div className="py-2 text-sm text-muted-foreground" data-testid="text-notes">
              {notes || 'No notes'}
            </div>
          ) : (
            <Input
              placeholder="Add notes or comments about this order..."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setHasUnsavedChanges(true);
              }}
              data-testid="input-notes"
            />
          )}
        </div>

        {selectedVendor && (
          <>
            {/* Vendor Contact Information */}
            {(() => {
              const vendor = vendors?.find(v => v.id === selectedVendor);
              if (vendor && (vendor.phone || vendor.website)) {
                return (
                  <div className="bg-muted/50 rounded-lg p-4 border">
                    <div className="flex flex-wrap gap-4 text-sm">
                      {vendor.phone && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Ordering Phone:</span>
                          <a 
                            href={`tel:${vendor.phone}`}
                            className="text-foreground hover:underline font-medium"
                            data-testid="link-vendor-phone"
                          >
                            {vendor.phone}
                          </a>
                        </div>
                      )}
                      {vendor.website && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Website:</span>
                          <a 
                            href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground hover:underline font-medium"
                            data-testid="link-vendor-website"
                          >
                            {vendor.website}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            
            <div className="flex gap-4 flex-wrap items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-items"
                />
              </div>
              <div className="w-[200px]">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger data-testid="select-category-filter">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories?.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {itemsWithQuantity} items • Total: ${totalAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No items found</h3>
                <p className="text-muted-foreground text-sm">
                  Try adjusting your search or filters
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[300px]">Item/SKU</TableHead>
                      {!isMiscGrocery && (
                        <>
                          <TableHead className="text-right">Case Size</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Case Price</TableHead>
                          <TableHead className="text-right">Prev Count</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          {hasMultipleStores && <TableHead className="text-right">Transfers</TableHead>}
                          <TableHead className="text-right">Usage</TableHead>
                          <TableHead className="w-[120px]">Cases</TableHead>
                        </>
                      )}
                      {isMiscGrocery && (
                        <>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Price Each</TableHead>
                          <TableHead className="text-right">Prev Count</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          {hasMultipleStores && <TableHead className="text-right">Transfers</TableHead>}
                          <TableHead className="text-right">Usage</TableHead>
                          <TableHead className="text-right w-[120px]">Qty</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      // Group items by category if no category filter is active
                      if (selectedCategory === "all") {
                        // Group items by category
                        const groupedItems = displayItems.reduce((acc: Record<string, any[]>, item: any) => {
                          const categoryName = isMiscGrocery 
                            ? (item.categoryName || 'Uncategorized')
                            : (item.categoryName || 'Uncategorized');
                          if (!acc[categoryName]) {
                            acc[categoryName] = [];
                          }
                          acc[categoryName].push(item);
                          return acc;
                        }, {});

                        // Sort categories alphabetically
                        const sortedCategories = Object.keys(groupedItems).sort((a, b) => a.localeCompare(b));

                        return sortedCategories.map(categoryName => (
                          <>
                            <TableRow key={`category-${categoryName}`} className="bg-muted/50">
                              <TableCell colSpan={isMiscGrocery ? (hasMultipleStores ? 10 : 9) : (hasMultipleStores ? 11 : 10)} className="font-semibold py-2">
                                {categoryName}
                              </TableCell>
                            </TableRow>
                            {groupedItems[categoryName].map((item: any) => {
                      const itemId = item.id;
                      const caseQty = caseQuantities[itemId] || 0;
                      
                      let itemName: string;
                      let inventoryItemId: string;
                      let categoryName: string;
                      let vendorSku: string = '-';
                      let caseSize: number = 1;
                      let unitPrice: number;
                      let casePrice: number = 0;
                      let unitName: string = '-';
                      let lineTotal: number;
                      
                      if (isMiscGrocery) {
                        itemName = item.name;
                        inventoryItemId = item.id;
                        categoryName = item.categoryName || '-';
                        unitName = formatUnitName(item.unitName);
                        unitPrice = item.pricePerUnit;
                        lineTotal = caseQty * unitPrice;
                      } else {
                        itemName = item.inventoryItemName;
                        inventoryItemId = item.inventoryItemId;
                        categoryName = item.categoryName || '-';
                        vendorSku = item.vendorSku || '-';
                        // Use vendor item's caseSize first, fall back to inventory item's caseSize
                        caseSize = item.caseSize ?? item.inventoryItem?.caseSize ?? 1;
                        unitPrice = item.lastPrice ?? item.inventoryItem?.pricePerUnit ?? 0;
                        casePrice = unitPrice * caseSize;
                        lineTotal = caseQty * casePrice;
                      }

                      const usage = usageMap.get(inventoryItemId);

                      return (
                        <TableRow key={itemId} data-testid={`row-item-${itemId}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (hasUnsavedChanges) {
                                    if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
                                      setLocation(`/inventory-items/${inventoryItemId}`);
                                    }
                                  } else {
                                    setLocation(`/inventory-items/${inventoryItemId}`);
                                  }
                                }}
                                className="font-medium hover:text-primary hover:underline flex-1 text-left"
                                tabIndex={-1}
                                data-testid={`link-item-${inventoryItemId}`}
                              >
                                {itemName}
                                {!isMiscGrocery && vendorSku !== '-' && (
                                  <span className="text-muted-foreground font-normal ml-1">{vendorSku}</span>
                                )}
                              </button>
                              {!isMiscGrocery && !isReceived && (() => {
                                const cmp = getComparison(inventoryItemId);
                                const hasCheaper = cmp?.cheaperAvailable === true;
                                return (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCompareItemId(inventoryItemId);
                                    }}
                                    data-testid={`button-compare-${inventoryItemId}`}
                                    title={hasCheaper
                                      ? `Cheaper at ${cmp!.bestVendorName} — save $${cmp!.savingsPerCase.toFixed(2)}/case`
                                      : "Compare vendor prices"}
                                  >
                                    {hasCheaper
                                      ? <Sparkles className="h-4 w-4 text-amber-500" />
                                      : <TrendingDown className="h-4 w-4" />}
                                  </Button>
                                );
                              })()}
                            </div>
                          </TableCell>
                          {!isMiscGrocery && (
                            <>
                              <TableCell className="text-right font-mono">
                                {caseSize || 1}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${unitPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                ${casePrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {usage ? (
                                  <Link 
                                    href={`/count/${usage.previousCountId}`}
                                    className="hover:text-primary hover:underline"
                                    tabIndex={-1}
                                    data-testid={`link-prev-count-${itemId}`}
                                  >
                                    {usage.previousQty.toFixed(2)}
                                  </Link>
                                ) : '-'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {(() => {
                                  if (!usage || usage.receiptIds.length === 0) {
                                    return usage ? usage.receivedQty.toFixed(2) : '-';
                                  }
                                  
                                  if (usage.receiptIds.length === 1) {
                                    const receipt = storeReceipts?.find(r => r.id === usage.receiptIds[0]);
                                    if (receipt?.purchaseOrderId) {
                                      return (
                                        <Link 
                                          href={`/receiving/${receipt.purchaseOrderId}?receiptId=${usage.receiptIds[0]}`}
                                          className="hover:text-primary hover:underline"
                                          tabIndex={-1}
                                          data-testid={`link-received-${itemId}`}
                                        >
                                          {usage.receivedQty.toFixed(2)}
                                        </Link>
                                      );
                                    }
                                    return usage.receivedQty.toFixed(2);
                                  }
                                  
                                  // Multiple receipts - show hover card with links
                                  return (
                                    <HoverCard>
                                      <HoverCardTrigger asChild>
                                        <span 
                                          className="cursor-help underline decoration-dotted"
                                          data-testid={`text-received-multiple-${itemId}`}
                                        >
                                          {usage.receivedQty.toFixed(2)}
                                        </span>
                                      </HoverCardTrigger>
                                      <HoverCardContent className="w-auto p-3">
                                        <div className="text-sm font-semibold mb-2">{usage.receiptIds.length} Receipts:</div>
                                        <div className="space-y-1">
                                          {usage.receiptIds.map((receiptId, idx) => {
                                            const receipt = storeReceipts?.find(r => r.id === receiptId);
                                            if (!receipt?.purchaseOrderId) return null;
                                            return (
                                              <div key={receiptId}>
                                                <Link
                                                  href={`/receiving/${receipt.purchaseOrderId}?receiptId=${receiptId}`}
                                                  className="text-primary hover:underline text-sm block"
                                                  tabIndex={-1}
                                                  data-testid={`link-receipt-${idx}-${itemId}`}
                                                >
                                                  Receipt {idx + 1}
                                                </Link>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {usage ? (
                                  <Link 
                                    href={`/count/${usage.currentCountId}`}
                                    className="hover:text-primary hover:underline"
                                    tabIndex={-1}
                                    data-testid={`link-current-count-${itemId}`}
                                  >
                                    {usage.currentQty.toFixed(2)}
                                  </Link>
                                ) : '-'}
                              </TableCell>
                              {hasMultipleStores && (
                                <TableCell className="text-right font-mono text-sm" data-testid={`text-transfers-${itemId}`}>
                                  {usage ? usage.transferredQty.toFixed(2) : '-'}
                                </TableCell>
                              )}
                              <TableCell className="text-right">
                                {(() => {
                                  if (!usage) {
                                    return <span className="text-sm text-muted-foreground" data-testid={`text-usage-na-${itemId}`}>N/A</span>;
                                  }
                                  return (
                                    <div 
                                      className={`font-mono text-sm ${usage.isNegativeUsage ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                                      data-testid={`text-usage-${itemId}`}
                                      data-negative={usage.isNegativeUsage ? 'true' : 'false'}
                                    >
                                      {usage.usage.toFixed(2)}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                              <TableCell>
                                {isReceived ? (
                                  <div className="text-center font-mono" data-testid={`text-case-qty-${itemId}`}>
                                    {caseQty || 0}
                                  </div>
                                ) : (
                                  <Input
                                    ref={el => inputRefs.current[itemId] = el}
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={caseQty || ""}
                                    onChange={(e) => handleCaseQuantityChange(itemId, parseInt(e.target.value) || 0)}
                                    onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                    className="text-center"
                                    placeholder="0"
                                    data-testid={`input-case-qty-${itemId}`}
                                  />
                                )}
                              </TableCell>
                            </>
                          )}
                          {isMiscGrocery && (
                            <>
                              <TableCell className="text-sm text-muted-foreground">
                                {unitName}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${unitPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {usage ? (
                                  <Link 
                                    href={`/count/${usage.previousCountId}`}
                                    className="hover:text-primary hover:underline"
                                    tabIndex={-1}
                                    data-testid={`link-prev-count-${itemId}`}
                                  >
                                    {usage.previousQty.toFixed(2)}
                                  </Link>
                                ) : '-'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {(() => {
                                  if (!usage || usage.receiptIds.length === 0) {
                                    return usage ? usage.receivedQty.toFixed(2) : '-';
                                  }
                                  
                                  if (usage.receiptIds.length === 1) {
                                    const receipt = storeReceipts?.find(r => r.id === usage.receiptIds[0]);
                                    if (receipt?.purchaseOrderId) {
                                      return (
                                        <Link 
                                          href={`/receiving/${receipt.purchaseOrderId}?receiptId=${usage.receiptIds[0]}`}
                                          className="hover:text-primary hover:underline"
                                          tabIndex={-1}
                                          data-testid={`link-received-${itemId}`}
                                        >
                                          {usage.receivedQty.toFixed(2)}
                                        </Link>
                                      );
                                    }
                                    return usage.receivedQty.toFixed(2);
                                  }
                                  
                                  // Multiple receipts - show hover card with links
                                  return (
                                    <HoverCard>
                                      <HoverCardTrigger asChild>
                                        <span 
                                          className="cursor-help underline decoration-dotted"
                                          data-testid={`text-received-multiple-${itemId}`}
                                        >
                                          {usage.receivedQty.toFixed(2)}
                                        </span>
                                      </HoverCardTrigger>
                                      <HoverCardContent className="w-auto p-3">
                                        <div className="text-sm font-semibold mb-2">{usage.receiptIds.length} Receipts:</div>
                                        <div className="space-y-1">
                                          {usage.receiptIds.map((receiptId, idx) => {
                                            const receipt = storeReceipts?.find(r => r.id === receiptId);
                                            if (!receipt?.purchaseOrderId) return null;
                                            return (
                                              <div key={receiptId}>
                                                <Link
                                                  href={`/receiving/${receipt.purchaseOrderId}?receiptId=${receiptId}`}
                                                  className="text-primary hover:underline text-sm block"
                                                  tabIndex={-1}
                                                  data-testid={`link-receipt-${idx}-${itemId}`}
                                                >
                                                  Receipt {idx + 1}
                                                </Link>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {usage ? (
                                  <Link 
                                    href={`/count/${usage.currentCountId}`}
                                    className="hover:text-primary hover:underline"
                                    tabIndex={-1}
                                    data-testid={`link-current-count-${itemId}`}
                                  >
                                    {usage.currentQty.toFixed(2)}
                                  </Link>
                                ) : '-'}
                              </TableCell>
                              {hasMultipleStores && (
                                <TableCell className="text-right font-mono text-sm" data-testid={`text-transfers-${itemId}`}>
                                  {usage ? usage.transferredQty.toFixed(2) : '-'}
                                </TableCell>
                              )}
                              <TableCell className="text-right">
                                {(() => {
                                  if (!usage) {
                                    return <span className="text-sm text-muted-foreground" data-testid={`text-usage-na-${itemId}`}>N/A</span>;
                                  }
                                  return (
                                    <div 
                                      className={`font-mono text-sm ${usage.isNegativeUsage ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                                      data-testid={`text-usage-${itemId}`}
                                      data-negative={usage.isNegativeUsage ? 'true' : 'false'}
                                    >
                                      {usage.usage.toFixed(2)}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                              <TableCell>
                                {isReceived ? (
                                  <div className="text-center font-mono" data-testid={`text-qty-${itemId}`}>
                                    {caseQty ? caseQty.toFixed(2) : '0.00'}
                                  </div>
                                ) : (
                                  <Input
                                    ref={el => inputRefs.current[itemId] = el}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={caseQty || ""}
                                    onChange={(e) => handleCaseQuantityChange(itemId, parseFloat(e.target.value) || 0)}
                                    onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                    className="text-center"
                                    placeholder="0"
                                    data-testid={`input-qty-${itemId}`}
                                  />
                                )}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="text-right font-mono font-semibold">
                            ${lineTotal.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                            })}
                          </>
                        ));
                      } else {
                        // When a category filter is active, show items without grouping
                        return displayItems.map((item: any) => {
                          const itemId = item.id;
                          const caseQty = caseQuantities[itemId] || 0;
                          
                          let itemName: string;
                          let inventoryItemId: string;
                          let categoryName: string;
                          let vendorSku: string = '-';
                          let caseSize: number = 1;
                          let unitPrice: number;
                          let casePrice: number = 0;
                          let unitName: string = '-';
                          let lineTotal: number;
                          
                          if (isMiscGrocery) {
                            itemName = item.name;
                            inventoryItemId = item.id;
                            categoryName = item.categoryName || '-';
                            unitName = formatUnitName(item.unitName);
                            unitPrice = item.pricePerUnit;
                            lineTotal = caseQty * unitPrice;
                          } else {
                            itemName = item.inventoryItemName;
                            inventoryItemId = item.inventoryItemId;
                            categoryName = item.categoryName || '-';
                            vendorSku = item.vendorSku || '-';
                            caseSize = item.inventoryItem?.caseSize || 1;
                            unitPrice = item.lastPrice ?? item.inventoryItem?.pricePerUnit ?? 0;
                            casePrice = unitPrice * caseSize;
                            lineTotal = caseQty * casePrice;
                          }

                          const usage = usageMap.get(inventoryItemId);

                          return (
                            <TableRow key={itemId} data-testid={`row-item-${itemId}`}>
                              <TableCell>
                                <button
                                  onClick={() => {
                                    if (hasUnsavedChanges) {
                                      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
                                        setLocation(`/inventory-items/${inventoryItemId}`);
                                      }
                                    } else {
                                      setLocation(`/inventory-items/${inventoryItemId}`);
                                    }
                                  }}
                                  className="font-medium hover:text-primary hover:underline text-left"
                                  tabIndex={-1}
                                  data-testid={`link-item-${inventoryItemId}`}
                                >
                                  {itemName}
                                  {!isMiscGrocery && vendorSku !== '-' && (
                                    <span className="text-muted-foreground font-normal ml-1">{vendorSku}</span>
                                  )}
                                </button>
                                {!isMiscGrocery && !isReceived && (() => {
                                  const cmp = getComparison(inventoryItemId);
                                  const hasCheaper = cmp?.cheaperAvailable === true;
                                  return (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCompareItemId(inventoryItemId);
                                      }}
                                      data-testid={`button-compare-${inventoryItemId}`}
                                      title={hasCheaper
                                        ? `Cheaper at ${cmp!.bestVendorName} — save $${cmp!.savingsPerCase.toFixed(2)}/case`
                                        : "Compare vendor prices"}
                                    >
                                      {hasCheaper
                                        ? <Sparkles className="h-4 w-4 text-amber-500" />
                                        : <TrendingDown className="h-4 w-4" />}
                                    </Button>
                                  );
                                })()}
                              </TableCell>
                              {!isMiscGrocery && (
                                <>
                                  <TableCell className="text-right font-mono">
                                    {caseSize || 1}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    ${unitPrice.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-semibold">
                                    ${casePrice.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.previousQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.receivedQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.currentQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm" data-testid={`text-transfers-${itemId}`}>
                                    {usage ? usage.transferredQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {(() => {
                                      if (!usage) {
                                        return <span className="text-sm text-muted-foreground" data-testid={`text-usage-na-${itemId}`}>N/A</span>;
                                      }
                                      return (
                                        <div 
                                          className={`font-mono text-sm ${usage.isNegativeUsage ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                                          data-testid={`text-usage-${itemId}`}
                                          data-negative={usage.isNegativeUsage ? 'true' : 'false'}
                                        >
                                          {usage.usage.toFixed(2)}
                                        </div>
                                      );
                                    })()}
                                  </TableCell>
                                  <TableCell>
                                    {isReceived ? (
                                      <div className="text-center font-mono" data-testid={`text-case-qty-${itemId}`}>
                                        {caseQty || 0}
                                      </div>
                                    ) : (
                                      <Input
                                        ref={el => inputRefs.current[itemId] = el}
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={caseQty || ""}
                                        onChange={(e) => handleCaseQuantityChange(itemId, parseInt(e.target.value) || 0)}
                                        onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                        className="text-center"
                                        placeholder="0"
                                        data-testid={`input-case-qty-${itemId}`}
                                      />
                                    )}
                                  </TableCell>
                                </>
                              )}
                              {isMiscGrocery && (
                                <>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {unitName}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    ${unitPrice.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.previousQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.receivedQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {usage ? usage.currentQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm" data-testid={`text-transfers-${itemId}`}>
                                    {usage ? usage.transferredQty.toFixed(2) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {(() => {
                                      if (!usage) {
                                        return <span className="text-sm text-muted-foreground" data-testid={`text-usage-na-${itemId}`}>N/A</span>;
                                      }
                                      return (
                                        <div 
                                          className={`font-mono text-sm ${usage.isNegativeUsage ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                                          data-testid={`text-usage-${itemId}`}
                                          data-negative={usage.isNegativeUsage ? 'true' : 'false'}
                                        >
                                          {usage.usage.toFixed(2)}
                                        </div>
                                      );
                                    })()}
                                  </TableCell>
                                  <TableCell>
                                    {isReceived ? (
                                      <div className="text-center font-mono" data-testid={`text-qty-${itemId}`}>
                                        {caseQty ? caseQty.toFixed(2) : '0.00'}
                                      </div>
                                    ) : (
                                      <Input
                                        ref={el => inputRefs.current[itemId] = el}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={caseQty || ""}
                                        onChange={(e) => handleCaseQuantityChange(itemId, parseFloat(e.target.value) || 0)}
                                        onKeyDown={(e) => handleKeyDown(e, itemId, displayItems)}
                                        className="text-center"
                                        placeholder="0"
                                        data-testid={`input-qty-${itemId}`}
                                      />
                                    )}
                                  </TableCell>
                                </>
                              )}
                              <TableCell className="text-right font-mono font-semibold">
                                ${lineTotal.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        });
                      }
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        {!selectedVendor && (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No vendor selected</h3>
            <p className="text-muted-foreground text-sm">
              Select a vendor to view available items
            </p>
          </div>
        )}

        {/* Export History Section */}
        {!isNew && exportLogs && exportLogs.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-4">Download History</h2>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Connector</TableHead>
                    <TableHead>Downloaded</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead>Portal Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exportLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-export-log-${log.id}`}>
                      <TableCell className="font-medium capitalize">{log.connectorId}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(log.exportedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {log.lineCount ?? '—'}
                      </TableCell>
                      <TableCell>
                        {log.warnings && log.warnings.length > 0 ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            {log.warnings.length} warning{log.warnings.length !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.manuallyConfirmedAt ? (
                          <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            Submitted
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            Not confirmed
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!log.manuallyConfirmedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => confirmExportMutation.mutate(log.id)}
                            disabled={confirmExportMutation.isPending}
                            data-testid={`button-confirm-export-${log.id}`}
                          >
                            Mark as Submitted
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Received Orders Section - Only show completed receipts */}
        {receipts && receipts.filter(r => r.status === "completed").length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-4">Received Orders</h2>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Received At</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.filter(r => r.status === "completed").map((receipt) => (
                    <TableRow key={receipt.id} data-testid={`row-receipt-${receipt.id}`}>
                      <TableCell className="font-mono">
                        {receipt.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">
                          {receipt.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(receipt.receivedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          asChild
                          data-testid={`button-view-receipt-${receipt.id}`}
                        >
                          <Link href={`/receiving/${receipt.purchaseOrderId}?receiptId=${receipt.id}`}>
                            View Receipt
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* PO Export Modal */}
      <Dialog open={showExportModal} onOpenChange={(open) => { if (!isExporting) setShowExportModal(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Download Order File</DialogTitle>
            <DialogDescription>
              {isLoadingExportInfo
                ? "Checking order…"
                : exportInfo
                ? `Generate a ${exportInfo.displayName}-formatted CSV to upload to your supplier portal.`
                : "Could not load export information."}
            </DialogDescription>
          </DialogHeader>

          {isLoadingExportInfo && (
            <div className="py-6 text-center text-muted-foreground text-sm">Validating order lines…</div>
          )}

          {!isLoadingExportInfo && exportInfo && (
            <div className="space-y-4">
              {/* Errors — blocking */}
              {exportInfo.validation.errors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    Cannot export — fix these issues first:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pl-1">
                    {exportInfo.validation.errors.map((e, i) => (
                      <li key={i} className="text-sm text-destructive">{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings — non-blocking */}
              {exportInfo.validation.warnings.length > 0 && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    Review before uploading:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pl-1">
                    {exportInfo.validation.warnings.map((w, i) => (
                      <li key={i} className="text-sm text-amber-700 dark:text-amber-400">{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {exportInfo.validation.canExport && exportInfo.validation.errors.length === 0 && exportInfo.validation.warnings.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Order is ready to export — no issues found.
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                After downloading, upload the file to your {exportInfo.displayName} portal to place the order.
                Come back here and click <strong>Mark as Submitted</strong> in the download history once you've uploaded it.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowExportModal(false)} disabled={isExporting} data-testid="button-export-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleDownloadExport}
              disabled={isLoadingExportInfo || !exportInfo?.validation.canExport || isExporting}
              data-testid="button-export-download"
            >
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "Downloading…" : "Download File"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vendor Price Comparison Dialog */}
      <Dialog open={!!compareItemId} onOpenChange={(open) => !open && setCompareItemId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vendor Price Comparison</DialogTitle>
            <DialogDescription>
              {vendorPriceComparison?.inventoryItemName}
            </DialogDescription>
          </DialogHeader>
          
          {(() => {
            // Prefer bulk comparison data (richer: includes staleness + confirmed).
            // Fall back to single-item endpoint data if bulk entry is unavailable.
            const bulkEntry = compareItemId ? bulkComparison?.data?.[compareItemId] : undefined;
            const prices =
              (bulkEntry?.vendorPrices && bulkEntry.vendorPrices.length > 0
                ? bulkEntry.vendorPrices
                : vendorPriceComparison?.vendorPrices ?? []) as BulkVendorPrice[];

            if (prices.length === 0) {
              return (
                <div className="py-8 text-center text-muted-foreground">
                  No vendor pricing available for this item
                </div>
              );
            }

            const currentVendorRow = prices.find(vp => vp.vendorId === selectedVendor);
            const bestRow = prices[0];
            const isBestAlready = bestRow.vendorId === selectedVendor;
            const savings = currentVendorRow && !isBestAlready
              ? currentVendorRow.casePrice - bestRow.casePrice
              : 0;

            return (
              <>
                {isBestAlready ? (
                  <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    You're already ordering from the best-priced vendor for this item.
                  </div>
                ) : savings > 0 ? (
                  <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span>
                      <strong>{bestRow.vendorName}</strong> is <strong>${savings.toFixed(2)}/case cheaper</strong> than your current vendor for this item.
                    </span>
                  </div>
                ) : null}
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Case Size</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Case Price</TableHead>
                        <TableHead className="text-right">Price Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prices.map((vp, index) => {
                        const isLowestPrice = index === 0;
                        const isCurrentVendor = vp.vendorId === selectedVendor;
                        const bulkVp = vp as BulkVendorPrice;
                        const isStale = bulkVp.stale ?? (bulkVp.daysSincePriced != null && bulkVp.daysSincePriced > 90);
                        const isConfirmed = bulkVp.confirmed ?? false;
                        return (
                          <TableRow
                            key={vp.vendorId}
                            className={isLowestPrice ? "bg-green-50 dark:bg-green-950/20" : ""}
                            data-testid={`row-vendor-price-${vp.vendorId}`}
                          >
                            <TableCell className="font-medium">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className={isCurrentVendor ? "underline decoration-dotted" : ""} title={isCurrentVendor ? "Current PO vendor" : undefined}>
                                  {vp.vendorName}
                                </span>
                                {isLowestPrice && (
                                  <Badge variant="default" className="ml-1" data-testid={`badge-best-price-${vp.vendorId}`}>Best Price</Badge>
                                )}
                                {isCurrentVendor && !isLowestPrice && (
                                  <Badge variant="outline" className="ml-1">Current</Badge>
                                )}
                                {isConfirmed && (
                                  <Badge variant="outline" className="ml-1 border-green-500 text-green-700 dark:text-green-400" data-testid={`badge-confirmed-${vp.vendorId}`}>
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Confirmed
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {vp.vendorSku || '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {vp.caseSize}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${vp.unitPrice.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              ${vp.casePrice.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              {bulkVp.pricedAt ? (
                                <div className={`flex items-center justify-end gap-1 text-xs ${isStale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                                  {isStale && <AlertTriangle className="h-3 w-3 shrink-0" data-testid={`icon-stale-${vp.vendorId}`} />}
                                  <span title={isStale ? `Price is ${bulkVp.daysSincePriced} days old — may be stale` : undefined}>
                                    {new Date(bulkVp.pricedAt).toLocaleDateString()}
                                    {isStale && bulkVp.daysSincePriced != null && (
                                      <span className="ml-1">({bulkVp.daysSincePriced}d ago)</span>
                                    )}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1 text-xs text-amber-600 dark:text-amber-400" title="No pricing date recorded">
                                  <AlertTriangle className="h-3 w-3 shrink-0" data-testid={`icon-stale-${vp.vendorId}`} />
                                  <span>Unknown</span>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
