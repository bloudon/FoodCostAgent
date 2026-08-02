import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Package, UtensilsCrossed, ChevronRight, Calendar, Mic, CheckCircle2, HelpCircle, AlertTriangle, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WasteVoiceModal, WasteInterpretEntry } from "@/components/waste-voice-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { formatUnitName } from "@/lib/utils";
import { SortableTableHead, useTableSort } from "@/components/sortable-table-head";

type WasteType = 'inventory' | 'menu_item' | null;

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

type InventoryItem = {
  id: string;
  name: string;
  categoryId: string | null;
  unitId: string;
  pricePerUnit: number;
};

type MenuItem = {
  id: string;
  name: string;
  department: string | null;
  recipeId: string | null;
};

type WasteLog = {
  id: string;
  wasteType: string;
  inventoryItemName: string | null;
  menuItemName: string | null;
  qty: number;
  unitName: string | null;
  reasonCode: string;
  notes: string | null;
  wastedAt: string;
  totalValue: number;
  storeName: string;
};

type Unit = {
  id: string;
  name: string;
  abbreviation: string;
  system: string;
};

type DraftStatus = "pending" | "loaded" | "submitted" | "skipped";

type VoiceDraft = WasteInterpretEntry & {
  /** Client-side UUID for stable list keys and tracking */
  draftId: string;
  status: DraftStatus;
};

export default function WasteEntry() {
  const { toast } = useToast();
  const [wasteType, setWasteType] = useState<WasteType>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [notes, setNotes] = useState("");

  // ── Voice entry state ─────────────────────────────────────────────────────
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceDrafts, setVoiceDrafts] = useState<VoiceDraft[]>([]);
  const loadedDraftIdRef = useRef<string | null>(null);
  /**
   * When a voice draft resolves to a non-canonical unit (e.g. "cases" when
   * the item is tracked in lbs), we cannot safely prefill the quantity because
   * the wizard always submits in the item's canonical unit. We store a warning
   * here so step 4 can surface it and prompt the user to re-enter qty manually.
   */
  const [voiceUnitWarning, setVoiceUnitWarning] = useState<{
    spokenQty: number;
    spokenUnit: string;
    canonicalUnitName: string;
  } | null>(null);
  
  // Date filter state - default to last 7 days
  const defaultEndDate = useMemo(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }, []);
  
  const defaultStartDate = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return sevenDaysAgo.toISOString().split('T')[0];
  }, []);
  
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const { sortField: wSortField, sortDirection: wSortDir, handleSort: wHandleSort } = useTableSort("wastedAt", "desc");

  const { data: stores = [] } = useAccessibleStores();
  
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: inventoryItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-items"],
    enabled: wasteType === 'inventory',
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
    enabled: wasteType === 'menu_item',
  });

  const { data: wasteLogs = [] } = useQuery<WasteLog[]>({
    queryKey: ["/api/waste", selectedStoreId, startDate, endDate],
    queryFn: selectedStoreId 
      ? () => fetch(`/api/waste?storeId=${selectedStoreId}&startDate=${startDate}&endDate=${endDate}`).then(res => res.json())
      : undefined,
    enabled: !!selectedStoreId && !!startDate && !!endDate,
  });

  const sortedWasteLogs = useMemo(() => {
    return [...wasteLogs].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (wSortField) {
        case "wastedAt":
          av = new Date(a.wastedAt).getTime();
          bv = new Date(b.wastedAt).getTime();
          break;
        case "item":
          av = (a.inventoryItemName || a.menuItemName || "").toLowerCase();
          bv = (b.inventoryItemName || b.menuItemName || "").toLowerCase();
          break;
        case "qty":
          av = a.qty;
          bv = b.qty;
          break;
        case "reasonCode":
          av = a.reasonCode;
          bv = b.reasonCode;
          break;
        case "totalValue":
          av = a.totalValue;
          bv = b.totalValue;
          break;
        default:
          return 0;
      }
      const cmp = typeof av === "number" ? av - bv : av.localeCompare(bv);
      return wSortDir === "asc" ? cmp : -cmp;
    });
  }, [wasteLogs, wSortField, wSortDir]);

  const inventoryLogs = useMemo(() => sortedWasteLogs.filter(log => log.wasteType === 'inventory'), [sortedWasteLogs]);
  const menuItemLogs = useMemo(() => sortedWasteLogs.filter(log => log.wasteType === 'menu_item'), [sortedWasteLogs]);

  // Set default store
  if (stores.length > 0 && !selectedStoreId) {
    setSelectedStoreId(stores[0].id);
  }

  const selectedStore = stores.find(s => s.id === selectedStoreId);

  // Get unique departments from menu items (include "Unassigned" for items without department)
  const menuDepartments = Array.from(
    new Set(
      menuItems.map(item => 
        (item.department && item.department.trim() !== '') 
          ? item.department 
          : '(No Department)'
      )
    )
  ).sort();

  // Get only categories that have items
  const categoriesWithItems = categories.filter(category => 
    inventoryItems.some(item => item.categoryId === category.id)
  );

  // Filter items by category/department
  const filteredInventoryItems = inventoryItems.filter(item => 
    selectedCategoryId ? item.categoryId === selectedCategoryId : false
  );

  const filteredMenuItems = menuItems.filter(item => {
    if (!selectedCategoryId) return false;
    
    // Handle "(No Department)" selection
    if (selectedCategoryId === '(No Department)') {
      return !item.department || item.department.trim() === '';
    }
    
    return item.department === selectedCategoryId;
  });

  const selectedItem = wasteType === 'inventory' 
    ? inventoryItems.find(i => i.id === selectedItemId)
    : menuItems.find(m => m.id === selectedItemId);

  const createWasteMutation = useMutation({
    mutationFn: async () => {
      const data = {
        wasteType: wasteType!,
        storeId: selectedStoreId,
        inventoryItemId: wasteType === 'inventory' ? selectedItemId : null,
        menuItemId: wasteType === 'menu_item' ? selectedItemId : null,
        qty: parseFloat(quantity),
        unitId: wasteType === 'inventory' && selectedItem ? (selectedItem as InventoryItem).unitId : null,
        reasonCode,
        notes: notes.trim() || null,
      };
      
      const response = await apiRequest("POST", "/api/waste", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items/estimated-on-hand"] });

      // Mark the currently loaded voice draft as submitted and find the next one
      const currentDraftId = loadedDraftIdRef.current;
      let nextDraft: VoiceDraft | null = null;
      if (currentDraftId) {
        loadedDraftIdRef.current = null;
        const updatedDrafts = voiceDrafts.map(d =>
          d.draftId === currentDraftId ? { ...d, status: "submitted" as DraftStatus } : d,
        );
        setVoiceDrafts(updatedDrafts);

        // Find the first pending draft that can be prefilled (skip unresolved)
        nextDraft =
          updatedDrafts.find(
            d => d.status === "pending" && d.resolutionStatus !== "unresolved",
          ) ?? null;
      }

      // Reset form fields
      setSelectedItemId(null);
      setQuantity("");
      setReasonCode("");
      setNotes("");
      setSelectedCategoryId(null);

      if (nextDraft) {
        const itemLabel = nextDraft.itemName ?? nextDraft.spokenItem;
        toast({
          title: `Loading next: ${itemLabel}…`,
          description: "Auto-advanced to the next voice entry.",
        });
        // Defer prefill so the state updates above settle first
        const draft = nextDraft;
        setTimeout(() => prefillFromDraft(draft), 0);
      } else {
        toast({
          title: "Waste logged",
          description: "The waste entry has been recorded.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to log waste",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedItemId || !quantity || !reasonCode) {
      toast({
        title: "Missing information",
        description: "Please select an item, enter quantity, and select a reason.",
        variant: "destructive",
      });
      return;
    }
    createWasteMutation.mutate();
  };

  const resetToStart = () => {
    setWasteType(null);
    setSelectedCategoryId(null);
    setSelectedItemId(null);
    setQuantity("");
    setReasonCode("");
    setNotes("");
    loadedDraftIdRef.current = null;
    setVoiceUnitWarning(null);
  };

  // ── Voice entry helpers ───────────────────────────────────────────────────

  /** Receive all entries from the modal and immediately prefill with `loadIdx`. */
  const handleVoiceEntries = useCallback(
    (entries: WasteInterpretEntry[], _transcript: string, loadIdx: number) => {
      const drafts: VoiceDraft[] = entries.map((e, i) => ({
        ...e,
        draftId: `voice-${Date.now()}-${i}`,
        status: i === loadIdx ? ("loaded" as DraftStatus) : ("pending" as DraftStatus),
      }));
      setVoiceDrafts(drafts);
      prefillFromDraft(drafts[loadIdx]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Prefill the wizard with a single voice draft entry. */
  const prefillFromDraft = useCallback((draft: VoiceDraft) => {
    // Mark any previously loaded draft back to pending, mark this one loaded
    loadedDraftIdRef.current = draft.draftId;
    setVoiceDrafts(prev =>
      prev.map(d => {
        if (d.draftId === draft.draftId) return { ...d, status: "loaded" };
        if (d.status === "loaded") return { ...d, status: "pending" };
        return d;
      }),
    );

    // Set wizard base fields.
    // wasteType comes from the server which now promotes null to the resolved
    // item's concrete type for all non-unresolved entries.  For truly unresolved
    // entries the type may still be null — in that case we leave wasteType null
    // so the wizard shows the type selector (step 1) and the user picks manually.
    const type: WasteType = draft.wasteType; // never default null → "inventory"
    setWasteType(type);
    setReasonCode(draft.reasonCode ?? "");
    setNotes(draft.notes ?? "");

    // Unit-safe quantity prefill — the wizard always submits in the item's
    // canonical unit. Only prefill qty when the resolved unit IS the canonical
    // unit (or when no unit was spoken, which also resolves to canonical).
    // For non-canonical alternate units or needs_unit, clear qty and warn.
    const unitMismatch =
      type === "inventory" &&
      draft.canonicalUnitId !== null &&
      draft.unitId !== null &&
      draft.unitId !== draft.canonicalUnitId;

    const unitUnknown =
      type === "inventory" &&
      draft.canonicalUnitId !== null &&
      draft.resolutionStatus === "needs_unit";

    if (unitMismatch || unitUnknown) {
      setQuantity("");
      if (draft.qty != null && (draft.spokenUnit || unitUnknown)) {
        setVoiceUnitWarning({
          spokenQty: draft.qty,
          spokenUnit: draft.spokenUnit ?? draft.unitName ?? "?",
          canonicalUnitName: draft.canonicalUnitName ?? "canonical unit",
        });
      }
    } else {
      setQuantity(draft.qty != null ? String(draft.qty) : "");
      setVoiceUnitWarning(null);
    }

    if (draft.resolutionStatus === "resolved" && draft.itemId) {
      // Jump straight to step 4: item is resolved, set category + item
      setSelectedCategoryId(
        type === "menu_item" ? (draft.department ?? null) : (draft.categoryId ?? null),
      );
      setSelectedItemId(draft.itemId);
    } else if (
      (draft.resolutionStatus === "ambiguous" || draft.resolutionStatus === "needs_unit") &&
      draft.categoryId
    ) {
      // Step 3: candidate category known, let user pick the item
      setSelectedCategoryId(
        type === "menu_item" ? (draft.department ?? null) : (draft.categoryId ?? null),
      );
      setSelectedItemId(null);
    } else {
      // Step 2 or 3: we set the type but clear item selection
      setSelectedCategoryId(null);
      setSelectedItemId(null);
    }
  }, []);

  const skipDraft = useCallback((draftId: string) => {
    if (loadedDraftIdRef.current === draftId) {
      loadedDraftIdRef.current = null;
    }
    setVoiceDrafts(prev =>
      prev.map(d => (d.draftId === draftId ? { ...d, status: "skipped" } : d)),
    );
  }, []);

  const wasteReasons = [
    { value: "SPOILED", label: "Spoiled / Expired" },
    { value: "DAMAGED", label: "Damaged" },
    { value: "OVERPRODUCTION", label: "Over Production" },
    { value: "DROPPED", label: "Dropped" },
    { value: "CUSTOMER_COMPLAINT", label: "Customer Complaint" },
    { value: "QUALITY", label: "Quality Issue" },
    { value: "OTHER", label: "Other" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Pinned title + filter zone */}
      <div className="flex-shrink-0 bg-background border-b px-4 pt-4 pb-4 md:px-8 md:pt-8">
      {/* Header with Store Selector */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={resetToStart}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">Waste</h1>
            <p className="text-muted-foreground">Log and track waste items</p>
          </div>
        </div>
        
        {/* Filters - Top Right */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <Label htmlFor="start-date" className="text-xs mb-1">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[160px] min-h-10 text-base"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex flex-col">
              <Label htmlFor="end-date" className="text-xs mb-1">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[160px] min-h-10 text-base"
                data-testid="input-end-date"
              />
            </div>
          </div>
          
          {/* Voice Entry */}
          <div className="flex flex-col justify-end">
            <span className="text-xs mb-1 invisible select-none">Voice</span>
            <Button
              variant="outline"
              className="gap-2 h-10"
              onClick={() => setVoiceModalOpen(true)}
              disabled={!selectedStoreId}
              title={!selectedStoreId ? "Select a store first" : "Log waste by voice"}
              data-testid="button-voice-entry"
            >
              <Mic className="h-4 w-4" />
              Voice Entry
            </Button>
          </div>

          {/* Store Selector */}
          <div className="min-w-[200px]">
            <Label htmlFor="store-select" className="text-xs mb-1 block">Store</Label>
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger id="store-select" data-testid="select-store">
                <SelectValue placeholder="Select Store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                    {store.city && <span className="text-muted-foreground ml-2">({store.city})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      </div>{/* end flex-shrink-0 */}

      {/* ── Voice Draft Queue ─────────────────────────────────────────────── */}
      {voiceDrafts.some(d => d.status !== "submitted" && d.status !== "skipped") && (
        <div className="flex-shrink-0 bg-muted/30 border-b px-4 py-3 md:px-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Voice Entries</span>
              <Badge variant="secondary" className="text-xs">
                {voiceDrafts.filter(d => d.status === "pending" || d.status === "loaded").length} remaining
              </Badge>
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setVoiceDrafts([]);
                loadedDraftIdRef.current = null;
              }}
            >
              Dismiss all
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {voiceDrafts
              .filter(d => d.status !== "submitted" && d.status !== "skipped")
              .map(draft => {
                const isLoaded = draft.status === "loaded";
                const statusIcon = {
                  resolved: <CheckCircle2 className="h-3 w-3 text-green-600" />,
                  ambiguous: <HelpCircle className="h-3 w-3 text-yellow-600" />,
                  needs_unit: <AlertTriangle className="h-3 w-3 text-orange-600" />,
                  unresolved: <AlertCircle className="h-3 w-3 text-red-600" />,
                }[draft.resolutionStatus];
                return (
                  <div
                    key={draft.draftId}
                    className={`flex-shrink-0 rounded-lg border px-3 py-2 text-xs flex items-center gap-2 max-w-[200px] ${
                      isLoaded
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-background border-border"
                    }`}
                  >
                    {statusIcon}
                    <span className="truncate font-medium">
                      {draft.itemName ?? draft.spokenItem}
                    </span>
                    {draft.qty != null && (
                      <span className="text-muted-foreground shrink-0">
                        {draft.qty} {draft.unitName ?? draft.spokenUnit ?? ""}
                      </span>
                    )}
                    {isLoaded ? (
                      <span className="text-xs text-primary font-semibold shrink-0">In form</span>
                    ) : draft.resolutionStatus !== "unresolved" ? (
                      <button
                        type="button"
                        className="text-xs underline shrink-0 hover:no-underline"
                        onClick={() => prefillFromDraft(draft)}
                      >
                        Load
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => skipDraft(draft.draftId)}
                      title="Skip"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pt-4 pb-8 md:px-8 md:pt-8">
      {/* Step 1: Select Waste Type */}
      {!wasteType && (
        <div className="grid gap-4 md:grid-cols-2 max-w-4xl mx-auto">
          <Card 
            className="hover-elevate cursor-pointer"
            onClick={() => setWasteType('inventory')}
            data-testid="card-inventory-waste"
          >
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-12 w-12 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Inventory Waste</h3>
                  <p className="text-muted-foreground">
                    Log waste for raw ingredients and inventory items
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="hover-elevate cursor-pointer"
            onClick={() => setWasteType('menu_item')}
            data-testid="card-menu-item-waste"
          >
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <UtensilsCrossed className="h-12 w-12 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Menu Item Waste</h3>
                  <p className="text-muted-foreground">
                    Log waste for prepared menu items
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Select Category (Inventory) or Department (Menu Items) */}
      {wasteType && !selectedCategoryId && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {wasteType === 'inventory' ? 'Select Category' : 'Select Department'}
          </h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {wasteType === 'inventory' && categoriesWithItems
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(category => (
                <Button
                  key={category.id}
                  variant="outline"
                  size="lg"
                  className="h-24 text-lg"
                  onClick={() => setSelectedCategoryId(category.id)}
                  data-testid={`button-category-${category.id}`}
                >
                  {category.name}
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              ))}
            {wasteType === 'menu_item' && menuDepartments.map(department => (
                <Button
                  key={department}
                  variant="outline"
                  size="lg"
                  className="h-24 text-lg"
                  onClick={() => setSelectedCategoryId(department)}
                  data-testid={`button-department-${department}`}
                >
                  {department}
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              ))}
            {wasteType === 'inventory' && categoriesWithItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No inventory categories with items found
              </p>
            )}
            {wasteType === 'menu_item' && menuDepartments.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No menu item departments found
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Select Item */}
      {wasteType && selectedCategoryId && !selectedItemId && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedCategoryId(null)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {wasteType === 'inventory' ? 'Back to Categories' : 'Back to Departments'}
            </Button>
          </div>
          <h2 className="text-xl font-semibold mb-4">Select Item</h2>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {wasteType === 'inventory' && filteredInventoryItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                size="lg"
                className="h-20 justify-start text-left"
                onClick={() => setSelectedItemId(item.id)}
                data-testid={`button-item-${item.id}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-muted-foreground">
                    ${item.pricePerUnit.toFixed(2)} / {formatUnitName(item.unitId)}
                  </div>
                </div>
              </Button>
            ))}
            {wasteType === 'menu_item' && filteredMenuItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                size="lg"
                className="h-20 justify-start text-left"
                onClick={() => setSelectedItemId(item.id)}
                data-testid={`button-item-${item.id}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                </div>
              </Button>
            ))}
            {wasteType === 'inventory' && filteredInventoryItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No inventory items in this category
              </p>
            )}
            {wasteType === 'menu_item' && filteredMenuItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No menu items in this category
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Enter Waste Details */}
      {selectedItemId && (
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setSelectedItemId(null)}
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back to Items
            </Button>
          </div>
          
          <Card>
            <CardContent className="pt-8 space-y-8">
              {/* Item Name */}
              <div className="text-center pb-4 border-b">
                <h3 className="text-2xl md:text-3xl font-semibold mb-2">{selectedItem?.name}</h3>
                <p className="text-lg text-muted-foreground">
                  {wasteType === 'inventory' ? 'Inventory Item' : 'Menu Item'}
                </p>
              </div>

              {/* Quantity with Number Pad */}
              <div>
                <Label htmlFor="quantity" className="text-xl mb-3 block">
                  Quantity Wasted *
                  {wasteType === 'inventory' && selectedItem && (() => {
                    const unit = units.find(u => u.id === (selectedItem as InventoryItem).unitId);
                    const unitDisplay = unit ? formatUnitName(unit.name) : 'units';
                    return (
                      <span className="text-muted-foreground ml-2">
                        ({unitDisplay})
                      </span>
                    );
                  })()}
                  {wasteType === 'menu_item' && (
                    <span className="text-muted-foreground ml-2">(count)</span>
                  )}
                </Label>

                {/* Voice unit mismatch warning — shown when voice resolved a
                    non-canonical unit so we cleared qty and need user re-entry */}
                {voiceUnitWarning && (
                  <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 mb-4 text-sm text-orange-800">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Voice said <strong>{voiceUnitWarning.spokenQty} {voiceUnitWarning.spokenUnit}</strong>.
                      This item is tracked in <strong>{voiceUnitWarning.canonicalUnitName}</strong> — please re-enter the quantity in {voiceUnitWarning.canonicalUnitName}s.
                    </span>
                  </div>
                )}
                
                {/* Large Quantity Display */}
                <div className="bg-muted rounded-lg p-6 mb-6">
                  <div className="text-center text-5xl md:text-6xl font-bold tabular-nums min-h-[80px] flex items-center justify-center">
                    {quantity || "0"}
                  </div>
                </div>

                {/* On-Screen Number Pad */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <Button
                      key={num}
                      variant="outline"
                      size="lg"
                      className="h-20 text-3xl font-semibold"
                      onClick={() => setQuantity(prev => prev + num.toString())}
                      data-testid={`button-num-${num}`}
                    >
                      {num}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-3xl font-semibold"
                    onClick={() => setQuantity(prev => prev.includes('.') ? prev : prev + '.')}
                    data-testid="button-decimal"
                  >
                    .
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-3xl font-semibold"
                    onClick={() => setQuantity(prev => prev + '0')}
                    data-testid="button-num-0"
                  >
                    0
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-20 text-2xl"
                    onClick={() => setQuantity(prev => prev.slice(0, -1))}
                    data-testid="button-backspace"
                  >
                    ⌫
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full h-14 text-lg"
                  onClick={() => setQuantity('')}
                  data-testid="button-clear"
                >
                  Clear
                </Button>
              </div>

              {/* Reason */}
              <div>
                <Label htmlFor="reason" className="text-xl mb-3 block">Reason *</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger id="reason" className="h-16 text-lg" data-testid="select-reason">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {wasteReasons.map(reason => (
                      <SelectItem key={reason.value} value={reason.value} className="text-lg py-3">
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div>
                <Label htmlFor="notes" className="text-xl mb-3 block">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="min-h-[120px] text-lg"
                  data-testid="input-notes"
                />
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4 pt-4">
                <Button
                  variant="outline"
                  onClick={resetToStart}
                  size="lg"
                  className="h-16 text-lg"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createWasteMutation.isPending}
                  size="lg"
                  className="h-16 text-lg"
                  data-testid="button-submit-waste"
                >
                  {createWasteMutation.isPending ? "Saving..." : "Log Waste"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Waste Log History */}
      {!selectedItemId && (
        <div className="mt-8 max-w-7xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Waste Log</CardTitle>
            </CardHeader>
            <CardContent>
              {wasteLogs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No waste entries yet</p>
              ) : (() => {
                const inventorySubtotal = inventoryLogs.reduce((sum, log) => sum + log.totalValue, 0);
                const menuItemSubtotal = menuItemLogs.reduce((sum, log) => sum + log.totalValue, 0);
                const grandTotal = inventorySubtotal + menuItemSubtotal;

                return (
                  <div className="space-y-6">
                    {/* Inventory Items Section */}
                    {inventoryLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Package className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">Inventory Items</h3>
                        </div>
                        <Table wrapperClassName="rounded-md border max-h-[calc(100vh-340px)]">
                          <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                              <SortableTableHead field="wastedAt" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="hidden sm:table-cell">Date</SortableTableHead>
                              <SortableTableHead field="item" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort}>Item</SortableTableHead>
                              <SortableTableHead field="qty" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="text-right">Qty</SortableTableHead>
                              <SortableTableHead field="reasonCode" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="hidden sm:table-cell">Reason</SortableTableHead>
                              <SortableTableHead field="totalValue" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="text-right">Value</SortableTableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inventoryLogs.map(log => (
                              <TableRow key={log.id} data-testid={`waste-log-${log.id}`}>
                                <TableCell className="whitespace-nowrap hidden sm:table-cell">
                                  {new Date(log.wastedAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{log.inventoryItemName}</div>
                                    <div className="text-xs text-muted-foreground sm:hidden">
                                      {new Date(log.wastedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      {' · '}{log.reasonCode.replace(/_/g, ' ')}
                                    </div>
                                    {log.notes && (
                                      <div className="text-sm text-muted-foreground italic">
                                        {log.notes}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums whitespace-nowrap">
                                  {log.qty} {log.unitName}
                                </TableCell>
                                <TableCell className="text-muted-foreground hidden sm:table-cell">
                                  {log.reasonCode.replace(/_/g, ' ')}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                                  ${log.totalValue.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-semibold bg-muted/50">
                              <TableCell colSpan={2} className="text-right sm:hidden truncate max-w-0">
                                Inventory Subtotal
                              </TableCell>
                              <TableCell colSpan={4} className="text-right hidden sm:table-cell">
                                Inventory Subtotal
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                ${inventorySubtotal.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Menu Items Section */}
                    {menuItemLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <UtensilsCrossed className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">Menu Items</h3>
                        </div>
                        <Table wrapperClassName="rounded-md border max-h-[calc(100vh-340px)]">
                          <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                              <SortableTableHead field="wastedAt" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="hidden sm:table-cell">Date</SortableTableHead>
                              <SortableTableHead field="item" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort}>Item</SortableTableHead>
                              <SortableTableHead field="qty" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="text-right">Qty</SortableTableHead>
                              <SortableTableHead field="reasonCode" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="hidden sm:table-cell">Reason</SortableTableHead>
                              <SortableTableHead field="totalValue" sortField={wSortField} sortDirection={wSortDir} onSort={wHandleSort} className="text-right">Value</SortableTableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {menuItemLogs.map(log => (
                              <TableRow key={log.id} data-testid={`waste-log-${log.id}`}>
                                <TableCell className="whitespace-nowrap hidden sm:table-cell">
                                  {new Date(log.wastedAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{log.menuItemName}</div>
                                    <div className="text-xs text-muted-foreground sm:hidden">
                                      {new Date(log.wastedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      {' · '}{log.reasonCode.replace(/_/g, ' ')}
                                    </div>
                                    {log.notes && (
                                      <div className="text-sm text-muted-foreground italic">
                                        {log.notes}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums whitespace-nowrap">
                                  {log.qty}
                                </TableCell>
                                <TableCell className="text-muted-foreground hidden sm:table-cell">
                                  {log.reasonCode.replace(/_/g, ' ')}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                                  ${log.totalValue.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-semibold bg-muted/50">
                              <TableCell colSpan={2} className="text-right sm:hidden truncate max-w-0">
                                Menu Items Subtotal
                              </TableCell>
                              <TableCell colSpan={4} className="text-right hidden sm:table-cell">
                                Menu Items Subtotal
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                ${menuItemSubtotal.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Grand Total */}
                    <div className="flex justify-end pt-4 border-t">
                      <div className="text-right">
                        <div className="text-lg font-bold">
                          Total Waste Value: <span className="tabular-nums">${grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}
      </div>{/* end flex-1 overflow-auto */}

      {/* ── Voice Entry Modal ──────────────────────────────────────────────── */}
      <WasteVoiceModal
        open={voiceModalOpen}
        onOpenChange={setVoiceModalOpen}
        storeId={selectedStoreId}
        onLoadEntry={handleVoiceEntries}
      />
    </div>
  );
}
