import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation as useWouterLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Camera, Package, DollarSign, Layers, X, Lock, LockOpen, Search, ArrowUp, Star, CheckCircle2, ArrowUpDown, ArrowUpAZ, ArrowDownAZ, Plus, Check, ChevronDown, Scale, Trash2, ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useEmbedded } from "@/hooks/use-embedded";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { mergeUpdatedCountLineIntoCache } from "@/lib/count-line-cache";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { LocationReviewDialog } from "@/components/count-session/LocationReviewDialog";
import AugustOrderlyReference from "@/components/count-session/AugustOrderlyReference";
import AugustCountReadiness from "@/components/count-session/AugustCountReadiness";
import { formatDateString } from "@/lib/utils";
import { generateCountSectionAnchor } from "@/lib/count-session-layout";
import { buildPreviousCountLineMap, countLineIdentity, formatPreviousCountQuantity, getPreviousCountUnitDisplay } from "@/lib/previous-count-lines";
import { formatPhysicalQuantity, getCountUnitDisplay, isWholeCaseConfiguration, pluralizeCountUnit } from "@/lib/count-unit-display";
import type { Company, CompanyStore } from "@shared/schema";

type CountMode = 'catch' | 'case' | 'simple';

function getCountMode(category: any, _location: any, item?: any): CountMode {
  if (item?.countMode === "catch" || category?.isCatchWeightCategory === 1) {
    return 'catch';
  }
  if (item?.countMode === "package" || item?.countMode === "unconfigured") {
    return 'case';
  }
  return 'simple';
}

// A display-unit choice must not change the item's canonical inventory unit.
// Only dimensional units with an established shared base may be converted.
function displayToCanonicalFactor(displayUnit: any, canonicalUnit: any): number | null {
  if (!displayUnit || !canonicalUnit) return null;
  if (displayUnit.id === canonicalUnit.id) return 1;
  if (!["weight", "volume"].includes(canonicalUnit.kind) || displayUnit.kind !== canonicalUnit.kind) return null;
  const from = displayUnit.abbreviation?.toLowerCase();
  const to = canonicalUnit.abbreviation?.toLowerCase();
  if (from === "lb" && to === "oz") return 16;
  if (from === "oz" && to === "lb") return 1 / 16;
  const displayRatio = Number(displayUnit.toBaseRatio);
  const canonicalRatio = Number(canonicalUnit.toBaseRatio);
  return displayRatio > 0 && canonicalRatio > 0 ? displayRatio / canonicalRatio : null;
}

const countInputClass =
  "border-orange-500/50 focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500/40";

function focusPrimaryCountInput(lineId: string) {
  const nextInput = document.querySelector(
    `[data-testid="input-qty-${lineId}"], [data-testid="input-case-qty-${lineId}"]`,
  ) as HTMLInputElement | null;
  nextInput?.focus();
  nextInput?.select();
}

interface CountQuantityEditorProps {
  line: any;
  item: any;
  mode: CountMode;
  isEditing: boolean;
  editingQty: string;
  editingCaseQty: string;
  editingContainerQty: string;
  onFocus: () => void;
  onQtyChange: (value: string) => void;
  onCaseQtyChange: (value: string) => void;
  onContainerQtyChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  readOnly?: boolean;
}

export function CountQuantityEditor({
  line,
  item,
  mode,
  isEditing,
  editingQty,
  editingCaseQty,
  editingContainerQty,
  onFocus,
  onQtyChange,
  onCaseQtyChange,
  onContainerQtyChange,
  onBlur,
  onKeyDown,
  readOnly = false
}: CountQuantityEditorProps) {
  if (mode === 'case') {
    const hasOperationalPackageGeometry =
      Number(item?.containerSize) > 0 &&
      Number(item?.casePkgCount) > 0;
    const wholeCase = isWholeCaseConfiguration(item, line.unitAbbreviation);
    const savedPartsReady = getCountUnitDisplay({ ...line, inventoryItem: item }, mode).status === "ready";
    const caseQty = isEditing ? editingCaseQty : (savedPartsReady && line.caseQty != null ? line.caseQty.toString() : '');
    const containerQty = isEditing ? editingContainerQty : (savedPartsReady && line.containerQty != null ? line.containerQty.toString() : '');
    const hasHistoricalLooseQuantity = Number(line.looseUnits) > 0;

    if (!hasOperationalPackageGeometry) {
      return (
        <Alert variant="destructive" data-testid={`count-configuration-required-${line.id}`}>
          <AlertDescription>
            Counting setup required. Configure this item's physical container and case conversion before counting it here.
          </AlertDescription>
        </Alert>
      );
    }

    if (hasHistoricalLooseQuantity) {
      return (
        <Alert data-testid={`historical-loose-count-${line.id}`}>
          <AlertDescription>
            Historical count preserved: {line.looseUnits} {item?.unitAbbreviation || item?.unitName || "canonical units"}.
            Clear this entry before recounting with physical packages.
          </AlertDescription>
        </Alert>
      );
    }

    const containerLabel = item.containerLabel?.trim() || "container";
    const totalContainers =
      ((parseFloat(caseQty.toString()) || 0) * item.casePkgCount) +
      (parseFloat(containerQty.toString()) || 0);
    const containerLabelPlural = pluralizeCountUnit(containerLabel, totalContainers);
    
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 flex-1">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-none flex-wrap">
          <div className="flex flex-col flex-1 sm:flex-none">
            <label className="text-xs text-muted-foreground mb-1">{wholeCase ? "Whole cases" : "Cases"}</label>
            <Input
              type="number"
              step={wholeCase ? "0.01" : "1"}
              min="0"
              value={caseQty}
              onFocus={onFocus}
              onChange={(e) => onCaseQtyChange(e.target.value)}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              className={`w-full sm:w-24 h-10 sm:h-9 text-base ${countInputClass}`}
              disabled={readOnly}
              data-testid={`input-case-qty-${line.id}`}
            />
          </div>
          {!wholeCase && <div className="flex flex-col flex-1 sm:flex-none">
            <label className="text-xs text-muted-foreground mb-1 capitalize">{pluralizeCountUnit(containerLabel, 2)}</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={containerQty}
              onFocus={onFocus}
              onChange={(e) => onContainerQtyChange(e.target.value)}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              className={`w-full sm:w-24 h-10 sm:h-9 text-base ${countInputClass}`}
              disabled={readOnly}
              data-testid={`input-container-qty-${line.id}`}
            />
          </div>}
        </div>
        <div className="flex-1 text-right w-full sm:w-auto">
          <div className="text-base font-semibold font-mono text-muted-foreground">
            = {totalContainers.toFixed(2)} {containerLabelPlural}
          </div>
        </div>
      </div>
    );
  }
  
  // Both 'catch' and 'simple' modes show a single quantity field
  // Catch weight categories use a direct qty field for accurate scale measurements
  return (
    <Input
      type="number"
      step="0.01"
      value={isEditing ? editingQty : line.qty}
      onFocus={onFocus}
      onChange={(e) => onQtyChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`w-full sm:w-32 h-10 sm:h-9 text-base ${countInputClass}`}
      disabled={readOnly}
      data-testid={`input-qty-${line.id}`}
    />
  );
}

function compactRelativeTime(date: Date): string {
  const t = date.getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = Math.max(0, Date.now() - t);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '<1m';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay <= 30) return `${diffDay}d`;
  return '>30d';
}

function getInitials(fullName: string): string {
  return fullName.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 3);
}

function EntryHistory({ entries, lineId, isCatchWeight, unitAbbr, countId, readOnly, packageLine }: { entries: any[]; lineId?: string; isCatchWeight?: boolean; unitAbbr?: string; countId?: string; readOnly?: boolean; packageLine?: any }) {
  const [open, setOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { toast } = useToast();
  const scheduleDelete = useUndoableDelete();

  const clearMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/inventory-count-lines/${lineId}/clear`);
    },
    onSuccess: () => {
      if (countId) {
        queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      }
      setShowClearConfirm(false);
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to clear entries", variant: "destructive" });
      setShowClearConfirm(false);
    },
  });

  // Early return after all hooks
  if (!entries || entries.length <= 1) return null;

  const unit = unitAbbr || 'unit';

  let runningTotal = 0;
  const entriesWithTotals = entries.map((entry: any) => {
    runningTotal += entry.qty;
    return { ...entry, runningTotal };
  });

  // Fixed grid columns so each row aligns vertically across rows.
  // Catch weight: qty | running total | "by XX" | time | delete
  // Otherwise:    qty | "by XX" | time | delete
  const gridCols = isCatchWeight
    ? 'grid-cols-[5rem_5.5rem_3rem_1fr_auto]'
    : 'grid-cols-[4rem_3rem_1fr_auto]';

  return (
    <>
      <div className="mt-1.5" data-testid="entry-history-toggle">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-toggle-entry-history"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            {isCatchWeight ? `${entries.length} packages` : `${entries.length} entries`}
          </button>
          {!readOnly && lineId && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={clearMutation.isPending}
              className="text-xs text-muted-foreground/60 hover:text-destructive transition-colors disabled:opacity-40"
              title="Clear all entries"
              data-testid="button-clear-all-entries"
            >
              Clear all
            </button>
          )}
        </div>
        {open && (
          <div className={`mt-1 border-t pt-1.5 grid gap-x-2 gap-y-0.5 text-xs items-center ${gridCols}`}>
            {entriesWithTotals.map((entry: any) => {
              const qtyDisplay = isCatchWeight ? entry.qty.toFixed(2) : `${entry.qty}`;
              const qtyStr = entry.qty > 0 ? `+${qtyDisplay}` : qtyDisplay;
              return (
                <Fragment key={entry.id}>
                  <span
                    className="font-mono font-semibold text-foreground tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
                    data-testid={`entry-row-${entry.id}`}
                  >
                    {packageLine ? `Stored entry: ${qtyStr} ${unit}` : isCatchWeight ? `${qtyStr} ${unit}` : qtyStr}
                  </span>
                  {isCatchWeight && (
                    <span
                      className="font-mono text-muted-foreground/80 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
                      data-testid={`entry-running-total-${entry.id}`}
                    >
                      = {entry.runningTotal.toFixed(2)} {unit}
                    </span>
                  )}
                  <span className="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                    {entry.userName ? `by ${getInitials(entry.userName)}` : ''}
                  </span>
                  <span className="text-muted-foreground/60 whitespace-nowrap tabular-nums">
                    {compactRelativeTime(new Date(entry.enteredAt))}
                  </span>
                  {!readOnly && (
                    <button
                      onClick={() => {
                        const cacheKey = ["/api/inventory-count-lines", countId];
                        const previousData = queryClient.getQueryData(cacheKey);
                        scheduleDelete({
                          label: "Count entry removed",
                          onOptimisticRemove: () =>
                            queryClient.setQueryData(cacheKey, (old: any) => {
                              if (!old) return old;
                              return old.map((line: any) => {
                                if (line.id !== lineId) return line;
                                return {
                                  ...line,
                                  entries: line.entries.filter(
                                    (e: any) => e.id !== entry.id
                                  ),
                                };
                              });
                            }),
                          onCommit: async () => {
                            await apiRequest(
                              "DELETE",
                              `/api/inventory-count-entries/${entry.id}`
                            );
                            queryClient.invalidateQueries({ queryKey: cacheKey });
                          },
                          onRestore: () =>
                            queryClient.setQueryData(cacheKey, previousData),
                        });
                      }}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors pl-1"
                      title="Remove this entry"
                      data-testid={`button-delete-entry-${entry.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {entries.length} entries and reset the count for this item to zero. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-entries">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              data-testid="button-confirm-clear-entries"
            >
              {clearMutation.isPending ? "Clearing…" : "Clear all entries"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function CountSession() {
  const params = useParams();
  const countId = params.id;
  const [, navigate] = useWouterLocation();
  
  // Get URL search parameters for filtering and navigation
  const urlParams = new URLSearchParams(window.location.search);
  const filterItemId = urlParams.get('item');
  const filterLocationId = urlParams.get('location');
  const sourceCountId = urlParams.get('from');
  
  const [groupBy, setGroupBy] = useState<"location" | "category" | "all-entries">("location"); // Toggle between location, category grouping, and flat all-entries view
  const [allEntriesSortCol, setAllEntriesSortCol] = useState<"item" | "location">("item");
  const [allEntriesSortDir, setAllEntriesSortDir] = useState<"asc" | "desc">("asc");
  const [groupedItemSortDir, setGroupedItemSortDir] = useState<"asc" | "desc">("asc");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>(filterLocationId || "all");
  const [selectedItemId, setSelectedItemId] = useState<string>(filterItemId || "all");
  const [search, setSearch] = useState("");
  const [showPreviouslyCountedOnly, setShowPreviouslyCountedOnly] = useState(false);
  const [openAccordionSections, setOpenAccordionSections] = useState<string[]>([]);
  const [searchAccordionOverride, setSearchAccordionOverride] = useState<{ key: string; values: string[] } | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isLocationReviewOpen, setIsLocationReviewOpen] = useState(false);
  const [showAugustReference, setShowAugustReference] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<string | null>(null);
  const handledAnchorRef = useRef<string | null>(null);
  
  // Update filters when URL parameters change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemFilter = params.get('item');
    if (itemFilter) {
      setSelectedItemId(itemFilter);
    } else {
      setSelectedItemId("all");
    }
    const locationFilter = params.get('location');
    if (locationFilter) {
      setSelectedLocation(locationFilter);
    }
  }, [window.location.search]);
  
  const [editingQty, setEditingQty] = useState<string>("");
  const [editingCaseQty, setEditingCaseQty] = useState<string>("");
  const [editingContainerQty, setEditingContainerQty] = useState<string>("");
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [addingToLineId, setAddingToLineId] = useState<string | null>(null);
  const [addMoreQty, setAddMoreQty] = useState<string>("");
  const [hasCamera, setHasCamera] = useState(false);
  const [scanningLineId, setScanningLineId] = useState<string | null>(null);
  const scanFileInputRef = useRef<HTMLInputElement>(null);
  const [wasTabPressed, setWasTabPressed] = useState(false);
  const [itemEditForm, setItemEditForm] = useState({
    name: "",
    categoryId: "",
    pricePerUnit: "",
    caseSize: "",
    parLevel: "",
    reorderLevel: "",
    containerLabel: "",
    pricePerContainer: "",
    containersPerCase: "",
    parContainers: "",
    reorderContainers: "",
    packageSize: "",
    packageUnitId: "",
    caseSizeUnitId: "",
  });
  const [settingUpPackage, setSettingUpPackage] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const isEmbedded = useEmbedded();

  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  // Fetch company and store information for this count
  const { data: company } = useQuery<Company>({
    queryKey: count?.companyId ? [`/api/companies/${count.companyId}`] : [],
    enabled: !!count?.companyId,
  });

  const { data: store } = useQuery<CompanyStore>({
    queryKey: count?.storeId ? [`/api/stores/${count.storeId}`] : [],
    enabled: !!count?.storeId,
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
    enabled: !!countId,
  });

  const { data: previousData } = useQuery<{
    previousCountId: string | null;
    previousCountDate: string | null;
    lines: any[];
    reconciliation?: {
      locationUnmatchedLines: number;
      ambiguousLocationLines: number;
    };
  }>({
    queryKey: ["/api/inventory-counts", countId, "previous-lines"],
    enabled: !!countId,
  });
  
  const previousCountId = previousData?.previousCountId || null;
  const previousCountDate = previousData?.previousCountDate ?? null;
  const previousLines = previousData?.lines || [];
  const previousLineMap = useMemo(
    () => buildPreviousCountLineMap(previousLines),
    [previousLines],
  );
  const previousQuantitiesByItemId = useMemo(() => previousLines.reduce((totals: Record<string, number>, line: any) => {
    totals[line.inventoryItemId] = (totals[line.inventoryItemId] || 0) + (Number(line.qty) || 0);
    return totals;
  }, {}), [previousLines]);

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const countStorageLocations = useMemo(() => {
    const byId = new Map<string, any>(
      (storageLocations || []).map((location) => [location.id, location])
    );
    for (const line of countLines || []) {
      if (!byId.has(line.storageLocationId)) {
        byId.set(line.storageLocationId, {
          id: line.storageLocationId,
          name: line.storageLocationName || "Unknown Location",
          sortOrder: 999,
          allowCaseCounting: line.storageLocationAllowCaseCounting ?? 0,
        });
      }
    }
    return Array.from(byId.values());
  }, [storageLocations, countLines]);
  const storageLocationById = useMemo(
    () => new Map((countStorageLocations || []).map((location: any) => [location.id, location])),
    [countStorageLocations],
  );
  const allItemTotals = useMemo(() => (countLines || []).reduce((totals: Record<string, { qty: number; value: number }>, line: any) => {
    const current = totals[line.inventoryItemId] || { qty: 0, value: 0 };
    current.qty += Number(line.qty) || 0;
    current.value += (Number(line.qty) || 0) * (Number(line.unitCost) || 0);
    totals[line.inventoryItemId] = current;
    return totals;
  }, {}), [countLines]);

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });
  const canonicalEditUnit = units?.find((unit: any) => unit.id === editingItem?.unitId);
  const editUnitLabel = canonicalEditUnit?.abbreviation || editingItem?.unitAbbreviation || editingItem?.unitName || "unit";
  const eligiblePackageUnits = (units || []).filter((unit: any) =>
    unit.id === editingItem?.unitId ||
    (["weight", "volume"].includes(canonicalEditUnit?.kind) && unit.kind === canonicalEditUnit.kind &&
      Number(canonicalEditUnit.toBaseRatio) > 0 && Number(unit.toBaseRatio) > 0)
  );
  const selectedPackageUnit = eligiblePackageUnits.find((unit: any) => unit.id === itemEditForm.packageUnitId);
  const packageFactor = displayToCanonicalFactor(selectedPackageUnit, canonicalEditUnit);
  const packageSizeCanonical = Number(itemEditForm.packageSize) * (packageFactor ?? NaN);
  const packageCaseCanonical = packageSizeCanonical * Number(itemEditForm.containersPerCase);
  const selectedCaseSizeUnit = eligiblePackageUnits.find((unit: any) => unit.id === itemEditForm.caseSizeUnitId);
  const caseSizeDisplayFactor = displayToCanonicalFactor(selectedCaseSizeUnit, canonicalEditUnit);

  const { data: categoriesData } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });
  const categoryById = useMemo(
    () => new Map((categoriesData || []).map((category: any) => [category.id, category])),
    [categoriesData],
  );
  
  // Initialize and reset accordion sections when data loads or groupBy changes
  useEffect(() => {
    if (countLines && countLines.length > 0) {
      // Group lines to get all groupKeys for the current groupBy mode
      const grouped: Record<string, any[]> = {};
      countLines.forEach(line => {
        let groupKey: string;
        if (groupBy === "location") {
          groupKey = line.storageLocationId || "unknown";
        } else {
          groupKey = line.inventoryItem?.category || "Uncategorized";
        }
        if (!grouped[groupKey]) {
          grouped[groupKey] = [];
        }
        grouped[groupKey].push(line);
      });

      // Embedded/mobile views keep large sessions collapsed so rendering does
      // not mount every line editor. Desktop retains the old behavior for
      // small sessions, while large sessions also start collapsed.
      const groupKeys = Object.keys(grouped);
      setOpenAccordionSections(
        isEmbedded || countLines.length > 500 ? [] : groupKeys,
      );
    }
  }, [countLines, groupBy, isEmbedded]);

  // Handle scroll event to show/hide back to top button
  useEffect(() => {
    const handleScroll = (event?: Event) => {
      const scrollEl = contentScrollRef.current;
      const scrollTop = scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop);
      setShowBackToTop(scrollTop > 300);
    };

    const scrollEl = contentScrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll);
    }
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    // Optimistically enable when mediaDevices exists — enumerateDevices can
    // under-report videoinput on mobile Safari before permission is granted.
    setHasCamera(true);
    if (!navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(devices => {
      // Only hide the button when we can definitively confirm no camera is present
      // (non-empty device list with zero videoinput entries).
      if (devices.length > 0 && !devices.some(d => d.kind === 'videoinput')) {
        setHasCamera(false);
      }
    }).catch(() => {});
  }, []);

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; qty?: number; addQty?: number; caseQty?: number | null; containerQty?: number | null; looseUnits?: number | null; accumulate?: boolean }) => {
      const response = await apiRequest("PATCH", `/api/inventory-count-lines/${data.id}`, {
        qty: data.qty,
        addQty: data.addQty,
        caseQty: data.caseQty,
        containerQty: data.containerQty,
        looseUnits: data.looseUnits,
        accumulate: data.accumulate ?? false,
      });
      return response.json();
    },
    onSuccess: (updatedLine: any) => {
      // PATCH returns the canonical line. Update the active cache in place so
      // edits do not refetch and replace the entire (potentially huge) list.
      const line = updatedLine?.line || updatedLine;
      if (line?.id) {
        queryClient.setQueryData<any[]>(
          ["/api/inventory-count-lines", countId],
          (lines) => mergeUpdatedCountLineIntoCache(lines, line),
        );
      }
      // Don't show toast for every field change - it's too noisy
      // Don't clear editing state here - let the next field's onFocus handle it
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update count",
        variant: "destructive",
      });
    },
  });

  const getCurrentQty = (line: any, mode: CountMode, item: any) => {
    if (editingLineId === line.id) {
      if (mode === 'case') {
        const cases = parseFloat(editingCaseQty) || 0;
        const containers = parseFloat(editingContainerQty) || 0;
        if (item?.containerSize && item?.casePkgCount) {
          return (cases * item.casePkgCount * item.containerSize) + (containers * item.containerSize);
        }
        return line.qty;
      } else {
        return parseFloat(editingQty) || 0;
      }
    }
    return line.qty;
  };

  const handleStartEdit = (line: any, mode: CountMode) => {
    if (editingLineId === line.id) {
      return;
    }
    
    setEditingLineId(line.id);
    
    if (mode === 'case') {
      if (getCountUnitDisplay(line, mode).status === "ready") {
        setEditingCaseQty(line.caseQty != null ? line.caseQty.toString() : '');
        setEditingContainerQty(line.containerQty != null ? line.containerQty.toString() : '');
      } else {
        setEditingCaseQty('');
        setEditingContainerQty('');
      }
      setEditingQty("");
    } else {
      setEditingQty(line.qty.toString());
      setEditingCaseQty("");
      setEditingContainerQty("");
    }
  };

  const handleSaveEdit = (lineId: string, mode: CountMode, item: any) => {
    if (count && count.canEdit === false) {
      return;
    }
    
    let qty: number;
    let caseQty: number | null = null;
    let containerQty: number | null = null;
    
    if (mode === 'case') {
      const casesValue = editingCaseQty.trim();
      const containersValue = editingContainerQty.trim();
      const cases = casesValue !== '' ? parseFloat(casesValue) : 0;
      const containers = containersValue !== '' ? parseFloat(containersValue) : 0;
      
      if (item?.containerSize && item?.casePkgCount) {
        qty = (cases * item.casePkgCount * item.containerSize) + (containers * item.containerSize);
      } else {
        return;
      }
      
      if (casesValue !== '' || containersValue !== '') {
        caseQty = casesValue !== '' ? cases : 0;
        containerQty = containersValue !== '' ? containers : 0;
      }
    } else {
      qty = parseFloat(editingQty) || 0;
    }
    
    if (!isNaN(qty) && qty >= 0) {
      updateMutation.mutate({ id: lineId, qty, caseQty, containerQty, looseUnits: mode === 'case' ? 0 : null });
    }
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditingQty("");
    setEditingCaseQty("");
    setEditingContainerQty("");
  };

  const handleOpenItemEdit = (item: any) => {
    const containerSize = Number(item.containerSize);
    const hasPackageGeometry =
      item.countMode === "package" &&
      Number.isFinite(containerSize) &&
      containerSize > 0;
    setEditingItem(item);
    setSettingUpPackage(hasPackageGeometry);
    const itemUnit = units?.find((unit: any) => unit.id === item.unitId);
    const savedPackageUnit = units?.find((unit: any) => unit.id === (item.containerUnitId || item.unitId));
    const savedFactor = displayToCanonicalFactor(savedPackageUnit, itemUnit);
    setItemEditForm({
      name: item.name || "",
      categoryId: item.categoryId || "",
      pricePerUnit: item.pricePerUnit != null ? item.pricePerUnit.toString() : "",
      caseSize: item.caseSize?.toString() || "",
      parLevel: item.parLevel?.toString() || "",
      reorderLevel: item.reorderLevel?.toString() || "",
      containerLabel: item.containerLabel?.trim() || "package",
      pricePerContainer: hasPackageGeometry
        ? (Number(item.pricePerUnit || 0) * containerSize).toString()
        : "",
      containersPerCase: hasPackageGeometry
        ? Number(item.casePkgCount || 0).toString()
        : "",
      parContainers: hasPackageGeometry && item.parLevel != null
        ? (Number(item.parLevel) / containerSize).toString()
        : "",
      reorderContainers: hasPackageGeometry && item.reorderLevel != null
        ? (Number(item.reorderLevel) / containerSize).toString()
        : "",
      packageSize: hasPackageGeometry && savedFactor
        ? (containerSize / savedFactor).toString()
        : "",
      packageUnitId: hasPackageGeometry ? (item.containerUnitId || item.unitId) : item.unitId,
      caseSizeUnitId: item.unitId,
    });
  };

  const handleCaseSizeDisplayUnitChange = (nextUnitId: string) => {
    const previousUnit = eligiblePackageUnits.find((unit: any) => unit.id === itemEditForm.caseSizeUnitId);
    const nextUnit = eligiblePackageUnits.find((unit: any) => unit.id === nextUnitId);
    const previousFactor = displayToCanonicalFactor(previousUnit, canonicalEditUnit);
    const nextFactor = displayToCanonicalFactor(nextUnit, canonicalEditUnit);
    if (!previousFactor || !nextFactor) return;
    const displayedSize = itemEditForm.caseSize.trim();
    const converted = displayedSize === "" ? "" :
      Number((Number(displayedSize) * previousFactor / nextFactor).toPrecision(12)).toString();
    setItemEditForm({ ...itemEditForm, caseSize: converted, caseSizeUnitId: nextUnitId });
  };

  const handlePackageSizeDisplayUnitChange = (nextUnitId: string) => {
    const nextUnit = eligiblePackageUnits.find((unit: any) => unit.id === nextUnitId);
    const nextFactor = displayToCanonicalFactor(nextUnit, canonicalEditUnit);
    if (!packageFactor || !nextFactor) return;
    const displayedSize = itemEditForm.packageSize.trim();
    const converted = displayedSize === "" ? "" :
      Number((Number(displayedSize) * packageFactor / nextFactor).toPrecision(12)).toString();
    setItemEditForm({ ...itemEditForm, packageSize: converted, packageUnitId: nextUnitId });
  };

  const handleCloseItemEdit = () => {
    setEditingItem(null);
    setSettingUpPackage(false);
    setItemEditForm({
      name: "",
      categoryId: "",
      pricePerUnit: "",
      caseSize: "",
      parLevel: "",
      reorderLevel: "",
      containerLabel: "",
      pricePerContainer: "",
      containersPerCase: "",
      parContainers: "",
      reorderContainers: "",
      packageSize: "",
      packageUnitId: "",
      caseSizeUnitId: "",
    });
  };

  const updateItemMutation = useMutation({
    mutationFn: async (data: any) => {
      // Update the inventory item
      await apiRequest("PATCH", `/api/inventory-items/${editingItem.id}`, data);
      
      // If price was updated and we're in a count session, update the count line's unitCost snapshot
      if (data.pricePerUnit !== undefined && countId) {
        const lineToUpdate = countLines?.find(line => line.inventoryItemId === editingItem.id);
        if (lineToUpdate) {
          await apiRequest("PATCH", `/api/inventory-count-lines/${lineToUpdate.id}`, {
            unitCost: data.pricePerUnit,
          });
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts/readiness"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId, "august-reference"] });
      toast({
        title: "Success",
        description: "Item and count values updated successfully",
      });
      handleCloseItemEdit();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update item",
        variant: "destructive",
      });
    },
  });

  const handleSaveItem = () => {
    const isPackageItem = settingUpPackage;
    const containerSize = packageSizeCanonical;
    const updates: any = {
      name: itemEditForm.name,
      categoryId: (itemEditForm.categoryId && itemEditForm.categoryId !== "none") ? itemEditForm.categoryId : null,
    };

    if (isPackageItem) {
      const containersPerCase = parseFloat(itemEditForm.containersPerCase);
      if (!selectedPackageUnit || !Number.isFinite(containerSize) || containerSize <= 0 ||
          !Number.isInteger(containersPerCase) || containersPerCase <= 0 ||
          !itemEditForm.containerLabel.trim() || !editingItem?.unitId) {
        toast({ title: "Verify the physical pack", description: "Enter a positive package size and whole packages per case, with a unit and package name.", variant: "destructive" });
        return;
      }
      updates.containerLabel = itemEditForm.containerLabel.trim();
      updates.containerSize = containerSize;
      updates.containerUnitId = selectedPackageUnit.id;
      updates.casePkgCount = containersPerCase;
      updates.caseSize = containersPerCase * containerSize;
      // Changing pack geometry must not silently change canonical unit prices
      // or existing par/reorder levels.
      if (editingItem?.countMode === "package") {
        const oldContainerSize = Number(editingItem.containerSize);
        const oldPricePerContainer = (Number(editingItem.pricePerUnit || 0) * oldContainerSize).toString();
        if (itemEditForm.pricePerContainer !== oldPricePerContainer) {
          updates.pricePerUnit = parseFloat(itemEditForm.pricePerContainer) / containerSize;
        }
        const oldPar = editingItem.parLevel == null ? "" : (Number(editingItem.parLevel) / oldContainerSize).toString();
        const oldReorder = editingItem.reorderLevel == null ? "" : (Number(editingItem.reorderLevel) / oldContainerSize).toString();
        if (itemEditForm.parContainers !== oldPar) updates.parLevel = itemEditForm.parContainers ? parseFloat(itemEditForm.parContainers) * containerSize : null;
        if (itemEditForm.reorderContainers !== oldReorder) updates.reorderLevel = itemEditForm.reorderContainers ? parseFloat(itemEditForm.reorderContainers) * containerSize : null;
      }
    } else {
      const nextPrice = Number(itemEditForm.pricePerUnit);
      const nextCaseSize = Number(itemEditForm.caseSize) * (caseSizeDisplayFactor ?? NaN);
      if (itemEditForm.pricePerUnit.trim() === "" || itemEditForm.caseSize.trim() === "" ||
          !Number.isFinite(nextPrice) || !Number.isFinite(nextCaseSize) || nextCaseSize <= 0) {
        toast({ title: "Validation Error", description: "Enter a valid case size and unit price.", variant: "destructive" });
        return;
      }
      if (nextPrice !== Number(editingItem.pricePerUnit)) updates.pricePerUnit = nextPrice;
      updates.caseSize = nextCaseSize;
      updates.parLevel = itemEditForm.parLevel ? parseFloat(itemEditForm.parLevel) : null;
      updates.reorderLevel = itemEditForm.reorderLevel ? parseFloat(itemEditForm.reorderLevel) : null;
    }

    if (
      !updates.name ||
      (updates.pricePerUnit !== undefined && !Number.isFinite(updates.pricePerUnit)) ||
      !Number.isFinite(updates.caseSize) ||
      (isPackageItem && (!Number.isFinite(updates.casePkgCount) || updates.casePkgCount <= 0)) ||
      (updates.parLevel != null && !Number.isFinite(updates.parLevel)) ||
      (updates.reorderLevel != null && !Number.isFinite(updates.reorderLevel))
    ) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required operational counting fields",
        variant: "destructive",
      });
      return;
    }

    updateItemMutation.mutate(updates);
  };

  const handleScanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const lineId = addingToLineId;
    if (!file || !lineId) return;
    setScanningLineId(lineId);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("lineId", lineId);
      const res = await fetch("/api/mobile/catch-weight-scan", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json();
      const weight = data.weightPerPackage ?? data.netWeight;
      if (weight != null) {
        setAddMoreQty(String(weight));
        toast({ title: "Label scanned", description: `Detected weight: ${weight} ${data.weightUnit ?? ""}`.trim() });
      } else {
        toast({ title: "Could not read weight", description: "No weight found on the label.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanningLineId(null);
      if (scanFileInputRef.current) scanFileInputRef.current.value = "";
    }
  };

  const applyCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/inventory-counts/${countId}/apply`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items/estimated-on-hand"] });
      toast({
        title: "Inventory Count Applied",
        description: "On-hand quantities have been updated to match the counted values",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to apply count",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Coordinate grouping/filtering with navigation; scrolling happens after the target renders.
  const navigateToSection = (groupKey: string, prefix: "category" | "location") => {
    const anchorId = generateCountSectionAnchor(prefix, groupKey);
    pendingAnchorRef.current = anchorId;
    handledAnchorRef.current = null;
    setGroupBy(prefix);
    setOpenAccordionSections(prev => prev.includes(groupKey) ? prev : [...prev, groupKey]);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${anchorId}`);
  };

  const clearSectionAnchor = () => {
    pendingAnchorRef.current = null;
    handledAnchorRef.current = null;
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  };

  useEffect(() => {
    if (!countLines?.length) return;
    const hashAnchor = window.location.hash.slice(1);
    const requestedAnchor = pendingAnchorRef.current
      || (hashAnchor && handledAnchorRef.current !== hashAnchor ? hashAnchor : null);
    if (!requestedAnchor) return;

    let category: string | undefined;
    let location: string | undefined;
    let targetGroup: "category" | "location" | null = null;
    let groupKey: string | undefined;

    if (requestedAnchor.startsWith("line-")) {
      const lineId = requestedAnchor.replace("line-", "");
      const line = countLines.find(l => l.id === lineId);
      if (line) {
        if (groupBy === "category") {
          targetGroup = "category";
          groupKey = line.inventoryItem?.category || "Uncategorized";
        } else if (groupBy === "location") {
          targetGroup = "location";
          groupKey = line.storageLocationId;
        } else {
          // all-entries view, no group to open
        }
      }
    } else {
      category = Array.from(new Set(countLines.map(line => line.inventoryItem?.category || "Uncategorized")))
        .find(value => generateCountSectionAnchor("category", value) === requestedAnchor);
      location = countStorageLocations
        .find(value => generateCountSectionAnchor("location", value.id) === requestedAnchor)?.id;

      groupKey = category || location;
      targetGroup = category ? "category" : location ? "location" : null;
    }

    if (groupKey && targetGroup) {
      if (groupBy !== targetGroup) setGroupBy(targetGroup);
      if (targetGroup === "category" && selectedCategory !== groupKey) setSelectedCategory(groupKey);
      if (targetGroup === "location" && selectedLocation !== groupKey) setSelectedLocation(groupKey);
      setOpenAccordionSections(prev => prev.includes(groupKey!) ? prev : [...prev, groupKey!]);
    }

    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(requestedAnchor);
      if (!element) return;
      element.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      const trigger = element.querySelector<HTMLElement>('[role="button"]');
      trigger?.focus({ preventScroll: true });
      pendingAnchorRef.current = null;
      handledAnchorRef.current = requestedAnchor;
    });
    return () => cancelAnimationFrame(frame);
  }, [countLines, countStorageLocations, groupBy, selectedCategory, selectedLocation]);

  const unlockCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inventory-counts/${countId}/unlock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Unlocked",
        description: "You can now edit this inventory count session",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to unlock session",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const lockCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inventory-counts/${countId}/lock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Count Completed",
        description: "Inventory count has been completed and locked",
      });
      // Navigate back to sessions index, pre-filtered to this count's store
      const storeId = count?.storeId;
      navigate(storeId ? `/inventory-sessions?store=${storeId}` : "/inventory-sessions");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to complete count",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Get unique categories from inventory items
  const categories = Array.from(new Set(
    inventoryItems?.map((p: any) => p.category).filter(Boolean) || []
  )).sort();

  // Filter lines based on location (for category accordion)
  let linesForCategoryTotals = countLines || [];
  if (selectedLocation !== "all") {
    linesForCategoryTotals = linesForCategoryTotals.filter(line => {
      const item = line.inventoryItem;
      const locationId = line.storageLocationId || "unknown";
      return locationId === selectedLocation;
    });
  }
  if (showPreviouslyCountedOnly) {
    linesForCategoryTotals = linesForCategoryTotals.filter(
      line => Number(previousLineMap.get(countLineIdentity(line))?.qty) > 0,
    );
  }

  // Calculate category totals from filtered lines (by location/empty, not by category)
  const categoryTotals = linesForCategoryTotals.reduce((acc: any, line) => {
    const item = line.inventoryItem;
    const category = item?.category || "Uncategorized";
    const value = line.qty * (line.unitCost || 0);
    
    if (!acc[category]) {
      acc[category] = { count: 0, value: 0, items: 0 };
    }
    acc[category].count += line.qty;
    acc[category].value += value;
    acc[category].items += 1;
    return acc;
  }, {}) || {};

  // Filter lines based on category (for location accordion)
  let linesForLocationTotals = countLines || [];
  if (selectedCategory !== "all") {
    linesForLocationTotals = linesForLocationTotals.filter(line => {
      const item = line.inventoryItem;
      const category = item?.category || "Uncategorized";
      return category === selectedCategory;
    });
  }
  if (showPreviouslyCountedOnly) {
    linesForLocationTotals = linesForLocationTotals.filter(
      line => Number(previousLineMap.get(countLineIdentity(line))?.qty) > 0,
    );
  }

  // Calculate location totals from filtered lines (by category/empty, not by location)
  const locationTotals = linesForLocationTotals.reduce((acc: any, line) => {
    const item = line.inventoryItem;
    const locationId = line.storageLocationId || "unknown";
    const locationName = storageLocationById.get(locationId)?.name || "Unknown Location";
    const value = line.qty * (line.unitCost || 0);
    
    if (!acc[locationId]) {
      acc[locationId] = { name: locationName, count: 0, value: 0, items: 0 };
    }
    acc[locationId].count += line.qty;
    acc[locationId].value += value;
    acc[locationId].items += 1;
    return acc;
  }, {}) || {};

  // Filter lines for display (all filters applied)
  let filteredLines = countLines || [];
  
  // Text search filter
  if (search) {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const matchesName = item?.name?.toLowerCase().includes(search.toLowerCase());
      const matchesPluSku = item?.pluSku?.toLowerCase().includes(search.toLowerCase());
      return matchesName || matchesPluSku;
    });
  }
  
  if (selectedCategory !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const category = item?.category || "Uncategorized";
      return category === selectedCategory;
    });
  }
  
  if (selectedLocation !== "all") {
    filteredLines = filteredLines.filter(line => {
      const item = line.inventoryItem;
      const locationId = line.storageLocationId || "unknown";
      return locationId === selectedLocation;
    });
  }
  
  if (selectedItemId !== "all") {
    filteredLines = filteredLines.filter(line => line.inventoryItemId === selectedItemId);
  }

  if (showPreviouslyCountedOnly) {
    filteredLines = filteredLines.filter(
      line => Number(previousLineMap.get(countLineIdentity(line))?.qty) > 0,
    );
  }

  // Note: Items maintain their natural order (as created in database)
  // This prevents items from jumping around when counts are recorded

  // Create a lookup map for previous quantities by inventory item ID
  // Aggregate all previous lines for the same item across all locations
  // This shows the TOTAL previous quantity count for each item
  // Calculate totals from FILTERED lines so stats match what's displayed
  const totalValue = filteredLines.reduce((sum, line) => {
    return sum + (line.qty * (line.unitCost || 0));
  }, 0);

  const totalItems = filteredLines.length;
  
  // Calculate unique categories in filtered results
  const displayedCategories = new Set(
    filteredLines.map(line => line.inventoryItem?.category || "Uncategorized")
  ).size;


  if (countLoading || linesLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const isHistoricalImport = count?.isHistoricalImport === 1;
  const isReadOnly = count && (isHistoricalImport || count.canEdit === false || count.applied === 1);
  
  return (
    <div className="h-full flex flex-col overflow-x-hidden">
      {/* Pinned title zone */}
      <div className="flex-shrink-0 px-4 pt-4 pb-0 sm:px-8 sm:pt-8">
      <div className="mb-4 sm:mb-8">
        <Link href={sourceCountId ? `/count/${sourceCountId}` : "/inventory-sessions"}>
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">{sourceCountId ? "Back to Previous Session" : "Back to Sessions"}</span>
            <span className="sm:hidden">Back</span>
          </Button>
        </Link>
        
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-3xl font-semibold tracking-tight" data-testid="text-session-title">
                Count Session
              </h1>
              {company && store && (
                <span className="text-sm sm:text-xl text-muted-foreground font-normal">
                  {store.name}
                </span>
              )}
              {count?.isPowerSession === 1 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-xs font-medium" data-testid="badge-power-session">
                  <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                  Power Count
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Inventory date: {count?.countDate ? formatDateString(count.countDate) : "Unknown"}
              {count?.isPowerSession === 1 && " • Power items only"}
            </p>
            <p className="hidden sm:block text-sm text-muted-foreground mt-0.5">
              {!isReadOnly
                ? "Click a quantity to edit. Use filters to view items by category or location."
                : isHistoricalImport
                  ? "Historical imported snapshot (read-only). Use filters to view items by category or location."
                  : "Completed count (read-only). Use filters to view items by category or location."}
            </p>
          </div>
        </div>
      </div>
      </div>{/* end flex-shrink-0 */}
      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-4 pb-4 sm:px-8 sm:pb-8" ref={contentScrollRef}>

      {count?.countDate?.slice(0, 10) === "2026-08-31" &&
        count.isHistoricalImport !== 1 &&
        count.sourceSystem !== "ORDERLY" &&
        count.isPowerSession !== 1 && (
          <div className="mb-4 space-y-3" data-testid="august-reference-section">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Enter the physical readings taken August 31 by storage location. The dated Orderly
              workbook is reference evidence only; it will not fill or change this count.
              <span className="mt-1 block text-amber-800 dark:text-amber-300">
                Earlier saved values in this draft are preserved but have not been confirmed as August 31
                physical readings. Verify the actual reading and save it again before relying on a
                comparison. The general count progress may include those earlier entries.
              </span>
              <Button type="button" variant="outline" size="sm" className="ml-3"
                onClick={() => setShowAugustReference(value => !value)}
                data-testid="button-toggle-august-reference">
                {showAugustReference ? "Hide Orderly comparison" : "Compare with August Orderly"}
              </Button>
            </div>
            {countId && count.storeId && <AugustCountReadiness countId={countId} storeId={count.storeId} countLines={countLines} />}
            {showAugustReference && countId && <AugustOrderlyReference countId={countId} />}
          </div>
        )}

      {/* Read-Only Banner */}
      {isReadOnly && (
        <Alert className="mb-8 border-amber-500/50 bg-amber-500/10" data-testid="alert-read-only">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>{isHistoricalImport ? "Historical Import (Read-Only)" : "Completed Session (Read-Only)"}</strong>
                {" - "}
                {isHistoricalImport
                  ? "This imported snapshot is retained as evidence and cannot be edited or applied."
                  : "This completed inventory count is locked from editing."}
              </AlertDescription>
            </div>
            {!isHistoricalImport && (user?.role === "global_admin" || user?.role === "company_admin") && count?.applied === 1 && (
              <Button
                onClick={() => unlockCountMutation.mutate()}
                disabled={unlockCountMutation.isPending}
                variant="outline"
                size="sm"
                data-testid="button-unlock-session"
              >
                <LockOpen className="h-4 w-4 mr-2" />
                {unlockCountMutation.isPending ? "Unlocking..." : "Unlock Session"}
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Mini Dashboard - Sticky Stats Bar */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b mb-4 sm:mb-8 sm:-mx-8 px-4 sm:px-8 py-2 sm:py-3">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Stats — grouped so they shrink together before buttons get squeezed */}
          <div className="flex items-center gap-3 sm:gap-5 flex-1 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <div>
                <div className="text-xs text-muted-foreground leading-none mb-0.5">Value</div>
                <div className="text-sm font-bold font-mono leading-none" data-testid="text-dashboard-total-value">
                  ${totalValue.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Package className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <div>
                <div className="text-xs text-muted-foreground leading-none mb-0.5">Items</div>
                <div className="text-sm font-bold font-mono leading-none" data-testid="text-dashboard-total-items">
                  {totalItems}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Layers className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <div>
                <div className="text-xs text-muted-foreground leading-none mb-0.5">Cat.</div>
                <div className="text-sm font-bold font-mono leading-none" data-testid="text-dashboard-categories">
                  {displayedCategories}
                </div>
              </div>
            </div>
          </div>

          {!isReadOnly && count && count.applied === 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                onClick={() => applyCountMutation.mutate()}
                disabled={applyCountMutation.isPending}
                variant="outline"
                size="sm"
                data-testid="button-apply-count"
              >
                <Package className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {applyCountMutation.isPending ? "Applying..." : "Apply Count"}
                </span>
              </Button>
              <Button
                onClick={() => lockCountMutation.mutate()}
                disabled={lockCountMutation.isPending}
                variant="default"
                size="sm"
                data-testid="button-complete-count"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                {lockCountMutation.isPending ? "..." : "Done"}
              </Button>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => {
                setSearchAccordionOverride(null);
                setSearch(e.target.value);
              }}
              className="pl-9 w-full h-10 border-orange-500/40 focus-visible:ring-orange-500/50 bg-background"
              data-testid="input-search-count-lines"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(selectedCategory !== "all" || selectedLocation !== "all" || selectedItemId !== "all" || search || showPreviouslyCountedOnly) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearSectionAnchor();
                  setSelectedCategory("all");
                  setSelectedLocation("all");
                  setSelectedItemId("all");
                  setSearchAccordionOverride(null);
                  setSearch("");
                  setShowPreviouslyCountedOnly(false);
                }}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
            )}
            <Button
              variant={showPreviouslyCountedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPreviouslyCountedOnly(current => !current)}
              disabled={!previousCountId}
              title={previousCountId ? "Show only items above zero in the last count" : "No prior count baseline"}
              data-testid="button-filter-previous-nonzero"
            >
              <ListFilter className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Last count &gt; 0</span>
            </Button>
            {previousCountDate && (
              <span
                className="hidden md:inline whitespace-nowrap text-xs text-muted-foreground"
                data-testid="text-previous-count-date"
              >
                From {formatDateString(previousCountDate)}
              </span>
            )}
            <Button
              variant={groupBy === "location" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                clearSectionAnchor();
                setGroupBy("location");
              }}
              data-testid="button-group-location"
            >
              <Layers className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Location</span>
            </Button>
            <Button
              variant={groupBy === "category" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                clearSectionAnchor();
                setGroupBy("category");
              }}
              data-testid="button-group-category"
            >
              <Package className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Category</span>
            </Button>
            <Button
              variant={groupBy === "all-entries" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                clearSectionAnchor();
                setGroupBy("all-entries");
              }}
              data-testid="button-group-all-entries"
            >
              <ArrowUpDown className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">All Entries</span>
            </Button>
            {groupBy !== "all-entries" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGroupedItemSortDir(dir => dir === "asc" ? "desc" : "asc")}
                aria-label={`Sort items ${groupedItemSortDir === "asc" ? "descending" : "ascending"}`}
                data-testid="button-sort-grouped-items"
              >
                {groupedItemSortDir === "asc" ? <ArrowUpAZ className="h-4 w-4 sm:mr-1" /> : <ArrowDownAZ className="h-4 w-4 sm:mr-1" />}
                <span className="hidden sm:inline">Item {groupedItemSortDir === "asc" ? "A–Z" : "Z–A"}</span>
              </Button>
            )}
          </div>
        </div>
        {selectedItemId !== "all" && (
          <div className="mt-1 text-xs text-muted-foreground truncate">
            <span className="font-medium">{filteredLines[0]?.inventoryItem?.name || "Unknown Item"}</span>
          </div>
        )}
      </div>

      {(previousData?.reconciliation?.locationUnmatchedLines ?? 0) > 0 && (
        <Alert className="mb-4 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" data-testid="alert-previous-location-unmatched">
          <AlertDescription className="text-amber-900 dark:text-amber-200">
            {previousData!.reconciliation!.locationUnmatchedLines} current item-location{" "}
            {previousData!.reconciliation!.locationUnmatchedLines === 1 ? "line has" : "lines have"} prior item history but no safe location match.
            {(previousData!.reconciliation!.ambiguousLocationLines ?? 0) > 0 &&
              ` ${previousData!.reconciliation!.ambiguousLocationLines} are ambiguous and were not guessed.`}
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-500/30 hover:bg-amber-500/10 text-amber-900 dark:text-amber-200 bg-white/50 dark:bg-black/20"
            onClick={() => setIsLocationReviewOpen(true)}
          >
            Review Locations
          </Button>
        </Alert>
      )}

      {/* Category Totals */}
      <Card className="mb-4 sm:mb-8">
        <Accordion type="single" collapsible>
          <AccordionItem value="categories" className="border-0">
            <AccordionTrigger className="px-4 pt-3 pb-2 hover:no-underline" tabIndex={-1}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm sm:text-base">Categories</span>
                <span className="text-xs text-muted-foreground font-normal hidden sm:inline">— tap to filter</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(categoryTotals).filter(([_, data]: [string, any]) => data.items > 0).map(([category, data]: [string, any]) => (
                  <div 
                    key={category} 
                    className={`border rounded-md p-2.5 hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                      selectedCategory === category ? 'bg-accent border-accent-border' : ''
                    }`}
                    onClick={() => {
                      if (selectedCategory === category) {
                        setSelectedCategory("all");
                        clearSectionAnchor();
                      } else {
                        setSelectedCategory(category);
                        setGroupBy("category");
                        navigateToSection(category, "category");
                      }
                    }}
                    tabIndex={-1}
                    data-testid={`card-category-${category.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div className="font-medium text-sm truncate">{category}</div>
                    <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                      <span>{data.items} items</span>
                      <span className="font-mono font-semibold text-foreground">${data.value.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Location Totals */}
      <Card className="mb-4 sm:mb-8">
        <Accordion type="single" collapsible>
          <AccordionItem value="locations" className="border-0">
            <AccordionTrigger className="px-4 pt-3 pb-2 hover:no-underline" tabIndex={-1}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm sm:text-base">Locations</span>
                <span className="text-xs text-muted-foreground font-normal hidden sm:inline">— tap to filter</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(locationTotals)
                  .filter(([_, data]: [string, any]) => data.items > 0)
                  .sort((a, b) => {
                    const locA = storageLocationById.get(a[0]);
                    const locB = storageLocationById.get(b[0]);
                    return (locA?.sortOrder ?? 999) - (locB?.sortOrder ?? 999);
                  })
                  .map(([locationId, data]: [string, any]) => (
                  <div 
                    key={locationId} 
                    className={`border rounded-md p-2.5 hover-elevate active-elevate-2 cursor-pointer transition-colors ${
                      selectedLocation === locationId ? 'bg-accent border-accent-border' : ''
                    }`}
                    onClick={() => {
                      if (selectedLocation === locationId) {
                        setSelectedLocation("all");
                        clearSectionAnchor();
                      } else {
                        setSelectedLocation(locationId);
                        setGroupBy("location");
                        navigateToSection(locationId, "location");
                      }
                    }}
                    tabIndex={-1}
                    data-testid={`card-location-${data.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div className="font-medium text-sm truncate">{data.name}</div>
                    <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                      <span>{data.items} items</span>
                      <span className="font-mono font-semibold text-foreground">${data.value.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Count Lines Table */}
      <Card id="count-entries" className="scroll-mt-28">
        <CardContent className="pt-4">
          <div className="space-y-2">
            {groupBy === "all-entries" ? (
              filteredLines && filteredLines.length > 0 ? (
                (() => {
                  const handleSortClick = (col: "item" | "location") => {
                    if (allEntriesSortCol === col) {
                      setAllEntriesSortDir(d => d === "asc" ? "desc" : "asc");
                    } else {
                      setAllEntriesSortCol(col);
                      setAllEntriesSortDir("asc");
                    }
                  };

                  const SortIcon = ({ col }: { col: "item" | "location" }) => {
                    if (allEntriesSortCol !== col) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground/50" />;
                    return allEntriesSortDir === "asc"
                      ? <ArrowUpAZ className="h-3.5 w-3.5 ml-1" />
                      : <ArrowDownAZ className="h-3.5 w-3.5 ml-1" />;
                  };

                  const sorted = [...filteredLines].sort((a, b) => {
                    let valA: string;
                    let valB: string;
                    if (allEntriesSortCol === "item") {
                      valA = (a.inventoryItem?.name || "").toLowerCase();
                      valB = (b.inventoryItem?.name || "").toLowerCase();
                    } else {
                       valA = (a.storageLocationName || storageLocationById.get(a.storageLocationId)?.name || "").toLowerCase();
                       valB = (b.storageLocationName || storageLocationById.get(b.storageLocationId)?.name || "").toLowerCase();
                    }
                    const cmp = valA.localeCompare(valB);
                    return allEntriesSortDir === "asc" ? cmp : -cmp;
                  });

                  return (
                    <Table data-testid="table-all-entries" wrapperClassName="rounded-md border max-h-[calc(100vh-380px)]">
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow>
                            <TableHead>
                              <button
                                className="flex items-center font-semibold hover:text-foreground transition-colors"
                                onClick={() => handleSortClick("item")}
                                data-testid="button-sort-item"
                              >
                                Item
                                <SortIcon col="item" />
                              </button>
                            </TableHead>
                            <TableHead>
                              <button
                                className="flex items-center font-semibold hover:text-foreground transition-colors"
                                onClick={() => handleSortClick("location")}
                                data-testid="button-sort-location"
                              >
                                Location
                                <SortIcon col="location" />
                              </button>
                            </TableHead>
                            <TableHead className="hidden sm:table-cell text-right">Cases</TableHead>
                            <TableHead className="hidden sm:table-cell text-right">Containers</TableHead>
                            <TableHead className="hidden sm:table-cell text-right">Historical loose</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Last Count</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sorted.map((line) => {
                            const item = line.inventoryItem;
                             const locationName = line.storageLocationName || storageLocationById.get(line.storageLocationId)?.name || "Unknown";
                            const lineValue = line.qty * (line.unitCost || 0);
                             const mode = getCountMode(categoryById.get(item?.categoryId), storageLocationById.get(line.storageLocationId), item);
                             const display = getCountUnitDisplay(line, mode);
                             const previousLine = previousLineMap.get(countLineIdentity(line));
                             const previousDisplay = formatPreviousCountQuantity(previousLine, line);
                            return (
                              <TableRow key={line.id} id={`line-${line.id}`} data-testid={`row-entry-${line.id}`}>
                                <TableCell className="font-medium" data-testid={`text-entry-item-${line.id}`}>
                                  {item?.name || "Unknown"}
                                </TableCell>
                                <TableCell className="text-muted-foreground" data-testid={`text-entry-location-${line.id}`}>
                                  {locationName}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-right font-mono" data-testid={`text-entry-cases-${line.id}`}>
                                  {line.caseQty != null ? line.caseQty : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-right font-mono" data-testid={`text-entry-containers-${line.id}`}>
                                  {line.containerQty != null ? line.containerQty : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-right font-mono" data-testid={`text-entry-loose-${line.id}`}>
                                   {Number(line.looseUnits) > 0 ? `${line.looseUnits} ${line.unitAbbreviation || item?.unitName || "unit"} (historical)` : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono font-semibold" data-testid={`text-entry-qty-${line.id}`}>
                                   {display.summary}
                                </TableCell>
                                 <TableCell className="text-right text-xs text-muted-foreground" data-testid={`text-entry-previous-${line.id}`}>
                                   {previousDisplay ?? "No prior count"}
                                 </TableCell>
                                <TableCell className="text-right font-mono font-semibold" data-testid={`text-entry-value-${line.id}`}>
                                  ${lineValue.toFixed(2)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                    </Table>
                  );
                })()
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No items to display
                </div>
              )
            ) : filteredLines && filteredLines.length > 0 ? (
              (() => {
                // Group by location or category based on groupBy state
                const grouped: Record<string, any[]> = {};
                const groupOrder: string[] = []; // Track the order groups appear
                
                filteredLines.forEach(line => {
                  let groupKey: string;
                  if (groupBy === "location") {
                    groupKey = line.storageLocationId || "unknown";
                  } else {
                    const item = line.inventoryItem;
                    groupKey = item?.category || "Uncategorized";
                  }
                  
                  if (!grouped[groupKey]) {
                    grouped[groupKey] = [];
                    groupOrder.push(groupKey);
                  }
                  grouped[groupKey].push(line);
                });

                // Sort groupOrder by storage location sortOrder when grouping by location
                if (groupBy === "location") {
                  groupOrder.sort((a, b) => {
                     const locA = storageLocationById.get(a);
                     const locB = storageLocationById.get(b);
                    return (locA?.sortOrder ?? 999) - (locB?.sortOrder ?? 999);
                  });
                }

                // Search expands only the visible matching groups. Keep manual
                // accordion state separate so clearing search does not mount
                // every line in a large session.
                const isSearching = search.trim().length > 0;
                const searchAccordionKey = JSON.stringify([search.trim().toLowerCase(), groupBy, groupOrder]);
                const expandedSections = isSearching
                  ? searchAccordionOverride?.key === searchAccordionKey
                    ? searchAccordionOverride.values
                    : groupOrder
                  : openAccordionSections;

                return (
                  <Accordion 
                    type="multiple" 
                    value={expandedSections}
                    onValueChange={(values) => {
                      if (isSearching) setSearchAccordionOverride({ key: searchAccordionKey, values });
                      else setOpenAccordionSections(values);
                    }}
                    className="w-full"
                    key={groupOrder.join(',') + groupBy} // Force remount when filtered items or groupBy changes
                  >
                    {groupOrder.map((groupKey) => {
                      const lines = grouped[groupKey];
                      
                      // Get group name
                      let groupName: string;
                      if (groupBy === "location") {
                        groupName = storageLocationById.get(groupKey)?.name || "Unknown Location";
                      } else {
                        groupName = groupKey;
                      }
                      
                      // Calculate aggregate totals for this group
                      const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
                      const totalValue = lines.reduce((sum, l) => sum + (l.qty * (l.unitCost || 0)), 0);
                      
                      // Generate anchor ID for this section
                      const anchorId = generateCountSectionAnchor(groupBy, groupKey);
                      
                      return (
                        <AccordionItem key={groupKey} value={groupKey} id={anchorId} className="scroll-mt-28 border rounded-md mb-2">
                          <AccordionTrigger className="px-4 py-2 hover:no-underline bg-muted/30 hover:bg-muted/50 data-[state=open]:bg-muted/40" tabIndex={-1} data-testid={`accordion-group-${groupKey}`}>
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-4 flex-1">
                                <span className="font-medium text-left">
                                  {groupName}
                                </span>
                                <span className="text-sm text-muted-foreground hidden sm:inline">
                                  {lines.length} items
                                </span>
                              </div>
                              <div className="text-right">
                                <div className="font-mono font-semibold">${totalValue.toFixed(2)}</div>
                                <div className="text-xs text-muted-foreground hidden sm:block">Total Value</div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {groupBy === "category" ? (
                              // Category view: Group by item, show locations underneath
                              <div className="space-y-2 p-2">
                                {(() => {
                                  // Group lines by inventory item
                                  const itemGroups: Record<string, any[]> = {};
                                  lines.forEach(line => {
                                    const itemId = line.inventoryItemId;
                                    if (!itemGroups[itemId]) {
                                      itemGroups[itemId] = [];
                                    }
                                    itemGroups[itemId].push(line);
                                  });
                                  
                                  return Object.entries(itemGroups)
                                    .sort(([, a], [, b]) => {
                                      const comparison = (a[0].inventoryItem?.name || "").localeCompare(b[0].inventoryItem?.name || "", undefined, { sensitivity: "base" });
                                      return groupedItemSortDir === "asc" ? comparison : -comparison;
                                    })
                                    .map(([itemId, itemLines]) => {
                                    const firstLine = itemLines[0];
                                    const item = firstLine.inventoryItem;
                                    
                                    // Calculate current total for this item across ALL locations (not just current group)
                                    const itemTotals = allItemTotals[itemId] || { qty: 0, value: 0 };
                                    const currentTotal = itemTotals.qty;
                                    const itemTotalValue = itemTotals.value;
                                    
                                    // Get previous total from previous session (aggregated across all locations)
                                    const previousTotal = previousQuantitiesByItemId[itemId] || 0;
                                    const itemMode = getCountMode(categoryById.get(item?.categoryId), null, item);
                                    const itemDisplays = itemLines.map(line => getCountUnitDisplay(line, itemMode));
                                    const packageTotalReady = itemMode === 'case' && itemDisplays.every(display => display.containers != null);
                                    const displayedTotal = packageTotalReady
                                      ? (() => {
                                          const total = itemDisplays.reduce((sum, display) => sum + (display.containers || 0), 0);
                                          return `${formatPhysicalQuantity(total)} ${pluralizeCountUnit(itemDisplays[0].containerLabel || 'container', total)}`;
                                        })()
                                      : itemMode === 'case'
                                        ? 'Review count lines'
                                        : `${currentTotal.toFixed(2)} ${firstLine.unitAbbreviation || item?.unitName || 'unit'}`;
                                    const previousItemLines = previousLines.filter((line: any) => line.inventoryItemId === itemId);
                                    const previousDisplays = previousItemLines.map((line: any) => getPreviousCountUnitDisplay(line, firstLine, itemMode)!);
                                    const previousGroupDisplay = itemMode === 'case'
                                      ? previousDisplays.every(display => display.containers != null)
                                        ? (() => {
                                            const total = previousDisplays.reduce((sum, display) => sum + (display.containers || 0), 0);
                                            return `${formatPhysicalQuantity(total)} ${pluralizeCountUnit(itemDisplays[0].containerLabel || 'container', total)}`;
                                          })()
                                        : 'Historical count (review individual locations)'
                                      : `${previousTotal.toFixed(2)} ${firstLine.unitAbbreviation || item?.unitName || 'unit'}`;
                                    const unitAbbr = firstLine.unitAbbreviation || 'unit';
                                    const catData = categoryById.get(item?.categoryId);
                                    const isCatchWeight = (catData as any)?.isCatchWeightCategory === 1;
                                    
                                    return (
                                      <div key={itemId} className="border rounded-lg p-3 sm:grid sm:grid-cols-[minmax(180px,0.7fr)_minmax(320px,1.3fr)] sm:gap-4" data-testid={`item-group-${itemId}`}>
                                        {/* Item Header */}
                                        <div className="flex items-start justify-between gap-3 pb-2 sm:pb-0 sm:pr-4 border-b sm:border-b-0 sm:border-r">
                                          <div className="flex-1">
                                            {isReadOnly ? (
                                              <div className="font-medium" data-testid={`text-item-name-${itemId}`}>
                                                {item?.name || 'Unknown'}
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() => handleOpenItemEdit(item)}
                                                className="text-left hover:underline font-medium"
                                                tabIndex={-1}
                                                data-testid={`button-edit-item-${itemId}`}
                                              >
                                                {item?.name || 'Unknown'}
                                              </button>
                                            )}
                                            {isCatchWeight && (
                                              <Badge variant="outline" className="mt-0.5 text-xs py-0 px-1.5 gap-0.5 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                                                <Scale className="h-2.5 w-2.5" />
                                                Catch Weight
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="text-right text-sm shrink-0">
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-qty-${itemId}`}>
                                               {displayedTotal}
                                            </div>
                                            <div className="font-mono text-xs" data-testid={`text-item-unit-price-${itemId}`}>
                                               {itemDisplays[0].price}
                                            </div>
                                            <div className="font-mono font-semibold" data-testid={`text-item-total-value-${itemId}`}>
                                              ${itemTotalValue.toFixed(2)}
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* Location Inputs */}
                                        <div className="grid grid-cols-1 gap-2 pt-2 sm:pt-0">
                                          {itemLines.map((line, idx) => {
                                            const category = categoryById.get(item?.categoryId);
                                            const location = storageLocationById.get(line.storageLocationId);
                                            const mode = getCountMode(category, location, item);
                                             const display = getCountUnitDisplay(line, mode);
                                             const previousLine = previousLineMap.get(countLineIdentity(line));
                                             const previousDisplay = formatPreviousCountQuantity(previousLine, line);
                                            
                                            return (
                                            <div key={line.id} id={`line-${line.id}`} className={`grid grid-cols-1 sm:grid-cols-[160px_1fr_100px] gap-2 items-center px-2 py-1.5 rounded ${idx % 2 === 0 ? '' : 'bg-muted/20'}`} data-testid={`location-input-${line.id}`}>
                                              <label className="text-sm text-muted-foreground">
                                                 <span className="block">{line.storageLocationName || 'Unknown'}:</span>
                                                 <span
                                                   className="block text-[11px]"
                                                   data-testid={`text-category-previous-${line.id}`}
                                                 >
                                                   Last count: {previousDisplay ?? "No prior count"}
                                                 </span>
                                              </label>
                                              {isReadOnly ? (
                                                <>
                                                  <div className="h-9 sm:h-10 flex items-center font-mono font-semibold" data-testid={`text-qty-${line.id}`}>
                                                     {display.summary}
                                                  </div>
                                                  <div className="text-right font-mono font-semibold text-muted-foreground">
                                                    ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                                  </div>
                                                </>
                                              ) : (
                                                <>
                                                  <CountQuantityEditor
                                                    line={line}
                                                    item={item}
                                                    mode={mode}
                                                    isEditing={editingLineId === line.id}
                                                    editingQty={editingQty}
                                                    editingCaseQty={editingCaseQty}
                                                    editingContainerQty={editingContainerQty}
                                                    onFocus={() => handleStartEdit(line, mode)}
                                                    onQtyChange={setEditingQty}
                                                    onCaseQtyChange={setEditingCaseQty}
                                                    onContainerQtyChange={setEditingContainerQty}
                                                    onBlur={() => {
                                                      if (editingLineId === line.id) {
                                                        handleSaveEdit(line.id, mode, item);
                                                      }
                                                    }}
                                                    onKeyDown={(e) => {
                                                      const isLastInputForLine =
                                                        mode !== 'case' ||
                                                         (e.currentTarget as HTMLElement).dataset.testid === `input-container-qty-${line.id}`;
                                                      const shouldAdvanceWithTab =
                                                        e.key === 'Tab' &&
                                                        !e.shiftKey &&
                                                        isLastInputForLine &&
                                                        idx < itemLines.length - 1;
                                                      if (e.key === 'Enter' || shouldAdvanceWithTab) {
                                                        e.preventDefault();
                                                        setEditingLineId(null); // clear BEFORE save so onBlur guard skips duplicate
                                                        handleSaveEdit(line.id, mode, item);
                                                        // Focus next input if available
                                                        if (idx < itemLines.length - 1) {
                                                          const nextLine = itemLines[idx + 1];
                                                          setTimeout(() => focusPrimaryCountInput(nextLine.id), 0);
                                                        }
                                                      } else if (e.key === 'Escape') {
                                                        handleCancelEdit();
                                                      }
                                                    }}
                                                  />
                                                  <div className="text-right font-mono font-semibold text-muted-foreground">
                                                    ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                                  </div>
                                                </>
                                              )}
                                              <div className="sm:col-span-3">
                                                <EntryHistory entries={line.entries || []} lineId={line.id} isCatchWeight={mode === 'catch'} unitAbbr={unitAbbr} countId={countId} readOnly={!!isReadOnly} packageLine={mode === 'case' ? line : undefined} />
                                              </div>
                                            </div>
                                            );
                                          })}
                                        </div>
                                        
                                        {/* Item Footer */}
                                         {previousTotal > 0 && previousCountId && (
                                           <div className="pt-2 mt-2 border-t sm:col-span-2">
                                            <Link href={`/count/${previousCountId}?from=${countId}&item=${itemId}`}>
                                              <div className="text-sm text-muted-foreground hover:underline cursor-pointer" data-testid={`link-previous-${itemId}`}>
                                                 Previous count: <span className="font-mono">{previousGroupDisplay}</span>
                                              </div>
                                            </Link>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            ) : (
                              // Location view: Compact layout similar to category view
                              <div className="space-y-2 p-2">
                                {[...lines].sort((a, b) => {
                                  const comparison = (a.inventoryItem?.name || "").localeCompare(b.inventoryItem?.name || "", undefined, { sensitivity: "base" });
                                  return groupedItemSortDir === "asc" ? comparison : -comparison;
                                }).map((line, idx, sortedLines) => {
                                  const item = line.inventoryItem;
                                  const unitName = item?.unitName || 'unit';
                                  const unitAbbr = line.unitAbbreviation || 'unit';
                                  const category = categoryById.get(item?.categoryId);
                                  const location = storageLocationById.get(line.storageLocationId);
                                  const mode = getCountMode(category, location, item);
                                  const display = getCountUnitDisplay(line, mode);
                                  
                                  // Get previous quantity for this specific item at this location
                                  const previousLine = previousLineMap.get(countLineIdentity(line));
                                  const previousDisplay = formatPreviousCountQuantity(previousLine, line);
                                  
                                  return (
                                      <div key={line.id} id={`line-${line.id}`} className="border rounded-md p-2.5 space-y-1.5" data-testid={`item-input-${line.id}`}>
                                       <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_auto] gap-2 sm:gap-5 items-center" data-testid={`compact-count-row-${line.id}`}>
                                       {/* Item title and supporting metadata */}
                                       <div className="flex items-start justify-between gap-2 min-w-0">
                                        <div className="flex-1 min-w-0">
                                          {isReadOnly ? (
                                            <div className="font-medium text-sm leading-snug" data-testid={`text-item-name-${line.inventoryItemId}`}>
                                              {item?.name || 'Unknown'}
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => handleOpenItemEdit(item)}
                                              className="text-left hover:underline font-medium text-sm leading-snug w-full"
                                              tabIndex={-1}
                                              data-testid={`button-edit-item-${line.inventoryItemId}`}
                                            >
                                              {item?.name || 'Unknown'}
                                            </button>
                                          )}
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                            <span>{item?.category || 'Uncategorized'}</span>
                                            {mode === 'catch' && (
                                              <Badge variant="outline" className="text-xs py-0 px-1.5 gap-0.5 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                                                <Scale className="h-2.5 w-2.5" />
                                                Catch Weight
                                              </Badge>
                                            )}
                                             {mode === 'case' && display.caseDetail && (
                                               <span>· {display.caseDetail}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-xs font-mono text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                                           {display.price}
                                        </div>
                                       </div>
                                       {/* Quantity editor and immediate value stay aligned with the title on desktop. */}
                                       <div className="flex items-center justify-end gap-2 min-w-0">
                                        {isReadOnly ? (
                                          <>
                                            <div className="flex-1 h-9 flex items-center font-mono font-semibold text-sm" data-testid={`text-qty-${line.id}`}>
                                               {display.summary}
                                            </div>
                                            <div className="text-sm font-semibold font-mono">
                                              = ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                            </div>
                                          </>
                                        ) : (
                                          <>
                                               <div className="sm:flex-none">
                                              {mode !== 'case' && addingToLineId === line.id ? (
                                                <div className="flex flex-col gap-1">
                                                  {mode === 'catch' && (
                                                    <div className="flex items-center justify-between gap-2">
                                                      <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                                        <Scale className="h-3 w-3" />
                                                        Enter package weight ({unitAbbr})
                                                        {(line.entries?.length ?? 0) > 0 && (
                                                          <span className="ml-1 text-muted-foreground" data-testid={`text-package-count-${line.id}`}>
                                                            &mdash; {line.entries.length} package{line.entries.length !== 1 ? 's' : ''} entered
                                                          </span>
                                                        )}
                                                      </span>
                                                      {hasCamera && (
                                                        <Button
                                                          size="sm"
                                                          variant="outline"
                                                          className="h-7 gap-1 text-xs shrink-0"
                                                          disabled={scanningLineId === line.id}
                                                          onClick={() => {
                                                            scanFileInputRef.current?.click();
                                                          }}
                                                          data-testid={`button-scan-label-${line.id}`}
                                                        >
                                                          <Camera className="h-3 w-3" />
                                                          {scanningLineId === line.id ? "Scanning…" : "Scan Label"}
                                                        </Button>
                                                      )}
                                                    </div>
                                                  )}
                                                  <div className="flex items-center gap-1.5">
                                                  <span className="text-xs text-muted-foreground font-mono">{display.summary} +</span>
                                                  <Input
                                                    type="number"
                                                    value={addMoreQty}
                                                    onChange={e => setAddMoreQty(e.target.value)}
                                                    className={`h-9 text-base w-24 ${countInputClass}`}
                                                    placeholder={mode === 'catch' ? `0.00 ${unitAbbr}` : "0"}
                                                    autoFocus
                                                    onKeyDown={e => {
                                                      if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        if (updateMutation.isPending) return;
                                                        const addAmt = parseFloat(addMoreQty) || 0;
                                                        updateMutation.mutate({ id: line.id, addQty: addAmt, accumulate: true });
                                                        setAddingToLineId(null);
                                                        setAddMoreQty("");
                                                      } else if (e.key === 'Escape') {
                                                        setAddingToLineId(null);
                                                        setAddMoreQty("");
                                                      }
                                                    }}
                                                    data-testid={`input-add-more-${line.id}`}
                                                  />
                                                  <Button
                                                    size="icon"
                                                    variant="default"
                                                    className="h-9 w-9 shrink-0"
                                                    disabled={updateMutation.isPending}
                                                    onClick={() => {
                                                      if (updateMutation.isPending) return;
                                                      const addAmt = parseFloat(addMoreQty) || 0;
                                                      updateMutation.mutate({ id: line.id, addQty: addAmt, accumulate: true });
                                                      setAddingToLineId(null);
                                                      setAddMoreQty("");
                                                    }}
                                                    data-testid={`button-confirm-add-more-${line.id}`}
                                                  >
                                                    <Check className="h-4 w-4" />
                                                  </Button>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-9 w-9 shrink-0"
                                                    onClick={() => { setAddingToLineId(null); setAddMoreQty(""); }}
                                                    data-testid={`button-cancel-add-more-${line.id}`}
                                                  >
                                                    <X className="h-4 w-4" />
                                                  </Button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <CountQuantityEditor
                                                line={line}
                                                item={item}
                                                mode={mode}
                                                isEditing={editingLineId === line.id}
                                                editingQty={editingQty}
                                                editingCaseQty={editingCaseQty}
                                                editingContainerQty={editingContainerQty}
                                                onFocus={() => handleStartEdit(line, mode)}
                                                onQtyChange={setEditingQty}
                                                onCaseQtyChange={setEditingCaseQty}
                                                onContainerQtyChange={setEditingContainerQty}
                                                onBlur={() => {
                                                  if (editingLineId === line.id) {
                                                    handleSaveEdit(line.id, mode, item);
                                                  }
                                                }}
                                                onKeyDown={(e) => {
                                                   const isLastInputForLine =
                                                     mode !== 'case' ||
                                                      (e.currentTarget as HTMLElement).dataset.testid === `input-container-qty-${line.id}`;
                                                   const shouldAdvanceWithTab =
                                                     e.key === 'Tab' &&
                                                     !e.shiftKey &&
                                                     isLastInputForLine &&
                                                     idx < sortedLines.length - 1;
                                                   if (e.key === 'Enter' || shouldAdvanceWithTab) {
                                                    e.preventDefault();
                                                    setEditingLineId(null); // clear BEFORE save so onBlur guard skips duplicate
                                                    handleSaveEdit(line.id, mode, item);
                                                     if (idx < sortedLines.length - 1) {
                                                       const nextLine = sortedLines[idx + 1];
                                                       setTimeout(() => focusPrimaryCountInput(nextLine.id), 0);
                                                    }
                                                  } else if (e.key === 'Escape') {
                                                    handleCancelEdit();
                                                  }
                                                }}
                                              />
                                               )}
                                                </div>
                                            <div className="text-sm font-semibold font-mono shrink-0">
                                              = ${(getCurrentQty(line, mode, item) * (line.unitCost || 0)).toFixed(2)}
                                            </div>
                                            {mode !== 'case' && addingToLineId !== line.id && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-9 w-9 shrink-0 text-muted-foreground"
                                                onClick={() => { setAddingToLineId(line.id); setAddMoreQty(""); }}
                                                title="Add to this count"
                                                 tabIndex={-1}
                                                data-testid={`button-add-more-${line.id}`}
                                              >
                                                <Plus className="h-4 w-4" />
                                              </Button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                       </div>
                                      {previousCountId && previousLine ? (
                                        <Link href={`/count/${previousCountId}?from=${countId}&item=${line.inventoryItemId}`}>
                                          <div className="text-xs text-muted-foreground hover:underline cursor-pointer" data-testid={`link-previous-${line.id}`}>
                                            Last count: <span className="font-mono">{previousDisplay}</span>
                                          </div>
                                        </Link>
                                      ) : (
                                        <div className="text-xs text-muted-foreground" data-testid={`text-location-previous-${line.id}`}>
                                          Last count: No prior count
                                        </div>
                                      )}
                                       <EntryHistory entries={line.entries || []} isCatchWeight={mode === 'catch'} unitAbbr={unitAbbr} countId={countId} readOnly={!!isReadOnly} packageLine={mode === 'case' ? line : undefined} />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                );
              })()
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No items to display
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <input
        ref={scanFileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden
        onChange={handleScanFileChange}
        data-testid="input-scan-label-file"
      />

      {countId && <LocationReviewDialog
        countId={countId}
        isOpen={isLocationReviewOpen}
        onOpenChange={setIsLocationReviewOpen}
        onSelectLine={(lineId, itemId, locationName) => {
          setSelectedItemId(itemId);
          setGroupBy("all-entries");

          if (locationName) {
            const loc = countStorageLocations.find(l => l.name === locationName);
            if (loc) {
              setSelectedLocation(loc.id);
            }
          }

          // Ensure URL reflects it
          const params = new URLSearchParams(window.location.search);
          params.set('item', itemId);
          if (locationName) {
             const loc = countStorageLocations.find(l => l.name === locationName);
             if (loc) params.set('location', loc.id);
          }

          // Also set the anchor to jump to the item line if possible
          // Generate a hash based on how anchors are made, or just pass lineId
          pendingAnchorRef.current = `line-${lineId}`;

          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}#line-${lineId}`);
        }}
      />}

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && handleCloseItemEdit()}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-item">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              Update the details for this inventory item. Required fields are marked with an asterisk (*).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="item-edit-unit-context">
              <strong>Stored inventory unit: {editUnitLabel}</strong>
              <p className="text-muted-foreground">
                Quantities and unit prices are stored per {editUnitLabel}. Physical package sizes can use a compatible
                unit below; saving the pack converts it to {editUnitLabel} without changing the stored unit or past counts.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-name">Name *</Label>
              <Input
                id="item-name"
                value={itemEditForm.name}
                onChange={(e) => setItemEditForm({ ...itemEditForm, name: e.target.value })}
                data-testid="input-item-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={itemEditForm.categoryId || undefined}
                onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })}
              >
                <SelectTrigger id="item-category" data-testid="select-item-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categoriesData?.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {settingUpPackage ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="item-package-size">Size of one physical package *</Label>
                    <Input
                      id="item-package-size"
                      type="number"
                      min="0.01"
                      step="any"
                      value={itemEditForm.packageSize}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, packageSize: e.target.value })}
                      data-testid="input-item-package-size"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-package-unit">Package size unit *</Label>
                    <Select value={itemEditForm.packageUnitId || undefined}
                      onValueChange={handlePackageSizeDisplayUnitChange}>
                      <SelectTrigger id="item-package-unit" data-testid="select-item-package-unit">
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligiblePackageUnits.map((unit: any) =>
                          <SelectItem key={unit.id} value={unit.id}>{unit.abbreviation || unit.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-container-label">Counting Unit *</Label>
                  <Input
                    id="item-container-label"
                    value={itemEditForm.containerLabel}
                    onChange={(e) => setItemEditForm({ ...itemEditForm, containerLabel: e.target.value })}
                    placeholder="bottle"
                    data-testid="input-item-container-label"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the physical item staff count, such as bottle, can, keg, or bag.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {editingItem?.countMode === "package" && <div className="space-y-2">
                    <Label htmlFor="item-price-container">
                      Price per {itemEditForm.containerLabel || "Package"}
                    </Label>
                    <Input
                      id="item-price-container"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemEditForm.pricePerContainer}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, pricePerContainer: e.target.value })}
                      data-testid="input-item-price-container"
                    />
                  </div>}
                  <div className="space-y-2">
                    <Label htmlFor="item-containers-case">
                      {(itemEditForm.containerLabel || "Container")}s per Case *
                    </Label>
                    <Input
                      id="item-containers-case"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={itemEditForm.containersPerCase}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, containersPerCase: e.target.value })}
                      data-testid="input-item-containers-per-case"
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground" data-testid="item-case-conversion">
                  {Number.isFinite(packageCaseCanonical) && packageCaseCanonical > 0
                    ? `One case = ${itemEditForm.containersPerCase} × ${itemEditForm.packageSize} ${selectedPackageUnit?.abbreviation || ""} = ${Number(packageCaseCanonical.toFixed(6))} ${editUnitLabel}.`
                    : `Enter the measured package size and the number of packages in one case. The old ${editingItem?.caseSize ?? "—"} ${editUnitLabel} case size is not proof of a physical pack.`}
                  {" "}Saving this setup does not enter the physical count or change its per-{editUnitLabel} price.
                  Changing the case size can change the displayed calculated cost per case; review pricing separately.
                </p>
                {editingItem?.countMode === "package" && <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="item-par-containers">
                      Par Level ({(itemEditForm.containerLabel || "Container")}s)
                    </Label>
                    <Input
                      id="item-par-containers"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemEditForm.parContainers}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, parContainers: e.target.value })}
                      data-testid="input-item-par-containers"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-reorder-containers">
                      Reorder Level ({(itemEditForm.containerLabel || "Container")}s)
                    </Label>
                    <Input
                      id="item-reorder-containers"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemEditForm.reorderContainers}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, reorderContainers: e.target.value })}
                      data-testid="input-item-reorder-containers"
                    />
                  </div>
                </div>
                </>}
              </>
            ) : (
              <>
                {editingItem?.countMode === "unconfigured" && canonicalEditUnit?.kind === "weight" && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>This item has no verified physical count package. Its existing case size is a catalog value, not a confirmed count setup.</p>
                    <Button type="button" variant="outline" className="mt-2"
                      onClick={() => setSettingUpPackage(true)}
                      data-testid="button-configure-count-package">
                      Set up physical case and package
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="item-price">Price per {editUnitLabel} *</Label>
                    <Input
                      id="item-price"
                      type="number"
                      step="0.01"
                      value={itemEditForm.pricePerUnit}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, pricePerUnit: e.target.value })}
                      data-testid="input-item-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-case-size">
                      Catalog case size ({selectedCaseSizeUnit?.abbreviation || editUnitLabel}) *
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="item-case-size"
                        type="number"
                        min="0.01"
                        step="any"
                        value={itemEditForm.caseSize}
                        onChange={(e) => setItemEditForm({ ...itemEditForm, caseSize: e.target.value })}
                        data-testid="input-item-case-size"
                      />
                      {eligiblePackageUnits.length > 1 && (
                        <Select value={itemEditForm.caseSizeUnitId || undefined}
                          onValueChange={handleCaseSizeDisplayUnitChange}>
                          <SelectTrigger aria-label="Case size display unit" className="w-28 shrink-0"
                            data-testid="select-item-case-size-unit">
                            <SelectValue placeholder="Unit" />
                          </SelectTrigger>
                          <SelectContent>
                            {eligiblePackageUnits.map((unit: any) =>
                              <SelectItem key={unit.id} value={unit.id}>{unit.abbreviation || unit.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground" data-testid="case-size-unit-explanation">
                      Switching units converts the displayed number; it does not change the stored {editUnitLabel} unit
                      or verify that this is one physical case. Use physical case setup above for counting.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="item-par-level">Par Level ({editUnitLabel})</Label>
                    <Input
                      id="item-par-level"
                      type="number"
                      step="0.01"
                      value={itemEditForm.parLevel}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, parLevel: e.target.value })}
                      data-testid="input-item-par-level"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-reorder-level">Reorder Level ({editUnitLabel})</Label>
                    <Input
                      id="item-reorder-level"
                      type="number"
                      step="0.01"
                      value={itemEditForm.reorderLevel}
                      onChange={(e) => setItemEditForm({ ...itemEditForm, reorderLevel: e.target.value })}
                      data-testid="input-item-reorder-level"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseItemEdit}
              data-testid="button-cancel-item"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveItem}
              disabled={updateItemMutation.isPending}
              data-testid="button-save-item"
            >
              {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Back to Top Button */}
      {showBackToTop && (
        <Button
          onClick={() => {
            if (contentScrollRef.current) {
              contentScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          size="icon"
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
          data-testid="button-back-to-top"
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}
      </div>{/* end flex-1 overflow-auto */}
    </div>
  );
}
