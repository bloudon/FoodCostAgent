import { useState, useEffect, useMemo, useRef, Fragment, useCallback } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation as useWouterLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CheckCircle2,
  Scale,
  Plus,
  ChevronRight,
  Trash2,
  Package,
  MapPin,
  Lock,
  ScanBarcode,
  X,
  Camera,
  Home,
  Search,
  ListFilter,
  ArrowDownAZ,
  ArrowUpZA,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCountEditorViewport } from "@/hooks/use-count-editor-viewport";
import { CountQuantityField, adjustQuantityText } from "@/components/count-session/CountQuantityField";
import { LocationReviewDialog } from "@/components/count-session/LocationReviewDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { mergeUpdatedCountLineIntoCache } from "@/lib/count-line-cache";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { formatDateString } from "@/lib/utils";
import { buildPreviousCountLineMap, countLineIdentity, getPreviousCountUnitDisplay } from "@/lib/previous-count-lines";
import { abbreviateCountUnit, formatPhysicalQuantity, getCountUnitDisplay, isWholeCaseConfiguration, pluralizeCountUnit } from "@/lib/count-unit-display";

type CountMode = "catch" | "case" | "simple";
type ItemSortDirection = "asc" | "desc";

export function formatMobileCountQuantity(
  line: any,
  mode: CountMode,
): { summary: string; unitLabel: string } {
  const display = getCountUnitDisplay(line, mode);
  return { summary: display.summary, unitLabel: display.unitLabel };
}

function getLineLocationId(line: any): string {
  return line.storageLocationId || line.inventoryItem?.storageLocationId || "unknown";
}

function getLineCategoryName(line: any): string {
  return line.inventoryItem?.category || "Uncategorized";
}

export function sortMobileCountLines(
  lines: any[] = [],
  direction: ItemSortDirection = "asc",
): any[] {
  const categoryOrder = new Map<string, number>();
  lines.forEach((line) => {
    const category = getLineCategoryName(line);
    if (!categoryOrder.has(category)) categoryOrder.set(category, categoryOrder.size);
  });

  const multiplier = direction === "asc" ? 1 : -1;
  return [...lines].sort((a, b) => {
    const categoryDifference =
      (categoryOrder.get(getLineCategoryName(a)) ?? 0) -
      (categoryOrder.get(getLineCategoryName(b)) ?? 0);
    if (categoryDifference !== 0) return categoryDifference;
    return multiplier * String(a.inventoryItem?.name ?? "").localeCompare(
      String(b.inventoryItem?.name ?? ""),
      undefined,
      { sensitivity: "base", numeric: true },
    );
  });
}

export function getRenderedMobileCountLines(
  lines: any[] = [],
  limit = 120,
): any[] {
  return lines.slice(0, Math.max(0, limit));
}

export function mobileCountLinesQueryKey(countId: string) {
  return ["/api/inventory-count-lines", countId, "mobile-compact"] as const;
}

export function isMobileBarcodeFallbackCandidate(
  item: { barcode?: string | null; pluSku?: string | null } | null | undefined,
  barcode: string,
): boolean {
  if (!item) return false;
  if (item.pluSku && barcode.endsWith(item.pluSku.trim())) return true;
  return !item.barcode;
}

export function mobileCategoryAnchor(categoryName: string): string {
  return `mobile-category-${encodeURIComponent(categoryName).replace(/%/g, "-")}`;
}

function getCountMode(category: any, _location: any, item: any): CountMode {
  if (item?.countMode === "catch" || category?.isCatchWeightCategory === 1) {
    return "catch";
  }
  if (item?.countMode === "package" || item?.countMode === "unconfigured") {
    return "case";
  }
  return "simple";
}

export function buildSessionLocations(
  countLines: any[] = [],
  legacyLocations: any[] = [],
): any[] {
  const configuredById = new Map(
    legacyLocations.map((location) => [location.id, location]),
  );
  const sessionById = new Map<string, any>();

  for (const line of countLines) {
    const locationId = getLineLocationId(line);
    const configured = configuredById.get(locationId);
    sessionById.set(locationId, configured || {
      id: locationId,
      name:
        line.storageLocationName ||
        line.inventoryItem?.storageLocationName ||
        "Unknown Location",
      sortOrder: 999,
      allowCaseCounting: 0,
    });
  }

  return Array.from(sessionById.values()).sort(
    (a, b) =>
      (a.sortOrder ?? 999) - (b.sortOrder ?? 999) ||
      String(a.name).localeCompare(String(b.name)),
  );
}

function hasRecordedCount(line: any): boolean {
  return (
    Number(line?.qty || 0) > 0 ||
    (line?.entries?.length ?? 0) > 0 ||
    line?.caseQty != null ||
    line?.containerQty != null ||
    line?.looseUnits != null
  );
}

function getInitials(fullName: string): string {
  return fullName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function compactRelativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ── Entry list (inline, no toggle) ───────────────────────────────────────────
function MobileEntryList({
  entries,
  isCatchWeight,
  isPackage,
  unitAbbr,
  countId,
  onDeleted,
  mutationsDisabled = false,
}: {
  entries: any[];
  isCatchWeight: boolean;
  isPackage?: boolean;
  unitAbbr: string;
  countId: string;
  onDeleted?: () => void;
  mutationsDisabled?: boolean;
}) {
  const scheduleDelete = useUndoableDelete();

  if (!entries || entries.length === 0) return null;

  let runningTotal = 0;
  const withTotals = entries.map((e: any) => {
    runningTotal += e.qty;
    return { ...e, runningTotal };
  });

  return (
    <div className="border rounded-md divide-y bg-muted/30">
      {withTotals.map((entry: any) => {
         const qtyDisplay = isCatchWeight
          ? entry.qty.toFixed(2)
          : String(entry.qty);
        return (
          <div
            key={entry.id}
            className="flex items-center gap-2 px-3 py-2"
            data-testid={`mobile-entry-row-${entry.id}`}
          >
            <span className="font-mono font-semibold text-sm tabular-nums flex-shrink-0">
               {isPackage ? "Stored entry: " : "+"}{qtyDisplay} {unitAbbr}
            </span>
            {isCatchWeight && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums flex-shrink-0">
                = {entry.runningTotal.toFixed(2)}
              </span>
            )}
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
              {entry.userName ? `by ${getInitials(entry.userName)}` : ""}
              {" · "}
              {compactRelativeTime(new Date(entry.enteredAt))}
            </span>
            <button
              type="button"
              disabled={mutationsDisabled}
              onClick={() => {
                if (mutationsDisabled) return;
                const cacheKey = mobileCountLinesQueryKey(countId);
                const previousData = queryClient.getQueryData(cacheKey);
                onDeleted?.();
                scheduleDelete({
                  label: "Count entry removed",
                  onOptimisticRemove: () =>
                    queryClient.setQueryData(cacheKey, (old: any) => {
                      if (!old) return old;
                      return old.map((line: any) => {
                        if (!(line.entries || []).some((e: any) => e.id === entry.id)) return line;
                        const remaining = line.entries.filter((e: any) => e.id !== entry.id);
                        return {
                          ...line,
                          qty: remaining.reduce((sum: number, e: any) => sum + Number(e.qty), 0),
                          entries: remaining,
                          ...(remaining.length === 0 ? { caseQty: null, containerQty: null, looseUnits: null } : {}),
                        };
                      });
                    }),
                  onCommit: async () => {
                    try {
                      await apiRequest("DELETE", `/api/inventory-count-entries/${entry.id}`);
                      await queryClient.invalidateQueries({ queryKey: cacheKey });
                    } catch (error) {
                      queryClient.setQueryData(cacheKey, previousData);
                      void queryClient.invalidateQueries({ queryKey: cacheKey });
                      throw error;
                    }
                  },
                  onRestore: () =>
                    queryClient.setQueryData(cacheKey, previousData),
                });
              }}
              className="text-muted-foreground/40 hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
              title="Remove this entry"
              data-testid={`button-mobile-delete-entry-${entry.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="font-mono font-bold text-sm tabular-nums">
          {isPackage ? "Stored canonical total: " : ""}{runningTotal.toFixed(2)} {unitAbbr}
        </span>
      </div>
    </div>
  );
}

// ── Barcode Scanner Component ─────────────────────────────────────────────────
function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const detectedRef = useRef(false);

  const stopScanner = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch (stopErr) {
        console.warn("[BarcodeScanner] controls.stop() failed:", stopErr);
      }
      controlsRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    detectedRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setCameraError(null);
      setIsStarting(false);
      return;
    }

    let cancelled = false;
    setIsStarting(true);
    setCameraError(null);
    detectedRef.current = false;

    async function startScanner() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;

        const reader = new BrowserMultiFormatReader();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setIsStarting(false);

        const controls = await reader.decodeFromStream(
          stream,
          videoRef.current ?? undefined,
          (result) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              onDetected(result.getText());
            }
          }
        );
        controlsRef.current = controls;
      } catch (err: unknown) {
        if (cancelled) return;
        setIsStarting(false);
        const errName = err instanceof Error ? err.name : "";
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          setCameraError("Camera access denied. Please allow camera access and try again.");
        } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
          setCameraError("No camera found on this device.");
        } else {
          console.error("[BarcodeScanner] Camera start failed:", err);
          setCameraError("Could not start camera. Please try again.");
        }
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [open, onDetected, stopScanner]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="p-0 gap-0 max-w-md w-full overflow-hidden rounded-xl">
        <DialogHeader className="px-4 pt-4 pb-3 flex flex-row items-center gap-2">
          <ScanBarcode className="h-5 w-5 text-primary shrink-0" />
          <DialogTitle className="flex-1 text-base">Scan Barcode</DialogTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleClose}
            className="shrink-0"
            data-testid="button-scanner-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Camera className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{cameraError}</p>
              <Button variant="outline" size="sm" onClick={handleClose}>
                Dismiss
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                data-testid="video-barcode-scanner"
              />
              {isStarting && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-white text-sm">Starting camera…</div>
                </div>
              )}
              {/* Scan reticle */}
              {!isStarting && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-32 border-2 border-white/70 rounded-md relative">
                    <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-primary rounded-tl-sm" />
                    <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-primary rounded-tr-sm" />
                    <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-primary rounded-bl-sm" />
                    <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-primary rounded-br-sm" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            Point the camera at a product barcode to jump to that item
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CountSessionMobile() {
  const params = useParams();
  const countId = params.id!;
  const countLinesQueryKey = mobileCountLinesQueryKey(countId);
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();

  // Location switcher
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [isLocationReviewOpen, setIsLocationReviewOpen] = useState(false);
  const [itemSortDirection, setItemSortDirection] =
    useState<ItemSortDirection>("asc");
  const [itemSearch, setItemSearch] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  const [selectedItemFilterId, setSelectedItemFilterId] = useState<string | null>(null);
  const [showPreviouslyCountedOnly, setShowPreviouslyCountedOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(120);
  // Sheet state
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  // Inputs inside the sheet
  const [sheetQty, setSheetQty] = useState("");
  const [sheetCaseQty, setSheetCaseQty] = useState("");
  const [sheetContainerQty, setSheetContainerQty] = useState("");
  const [activeInput, setActiveInput] = useState<"qty" | "case" | "container">("qty");
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);
  // Apply confirmation
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  // Clear all entries confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Barcode scanner
  const [showScanner, setShowScanner] = useState(false);
  const [noMatchBarcode, setNoMatchBarcode] = useState<string | null>(null);
  const [noMatchSuggestions, setNoMatchSuggestions] = useState<string[]>([]);
  const [catchWeightScanPending, setCatchWeightScanPending] = useState(false);

  const primaryInputRef = useRef<HTMLInputElement>(null);
  const itemListRef = useRef<HTMLDivElement>(null);
  const entryViewportStyle = useCountEditorViewport(!!activeLineId);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: countLinesQueryKey,
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/inventory-count-lines/${countId}?compact=mobile`,
      );
      return response.json();
    },
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
  const previousCountId = previousData?.previousCountId ?? null;
  const previousCountDate = previousData?.previousCountDate ?? null;
  const previousLineMap = useMemo(
    () => buildPreviousCountLineMap(previousData?.lines || []),
    [previousData?.lines],
  );

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: categoriesData } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });
  const categoryById = useMemo(
    () => new Map((categoriesData || []).map((category: any) => [category.id, category])),
    [categoriesData],
  );
  const lineById = useMemo(
    () => new Map((countLines || []).map((line: any) => [line.id, line])),
    [countLines],
  );

  // ── Derived data ───────────────────────────────────────────────────────────

  // Build ordered list of locations that have items in this session
  const sessionLocations = useMemo(
    () => buildSessionLocations(countLines, storageLocations),
    [countLines, storageLocations],
  );
  const locationById = useMemo(
    () => new Map((sessionLocations || []).map((location: any) => [location.id, location])),
    [sessionLocations],
  );

  // Initialize selected location to first on load
  useEffect(() => {
    if (!selectedLocId && sessionLocations.length > 0) {
      setSelectedLocId(sessionLocations[0].id);
    }
  }, [sessionLocations.length]);

  // Items for the selected location
  const locationLines = useMemo(
    () =>
      sortMobileCountLines(
        (countLines || []).filter((line) => getLineLocationId(line) === selectedLocId),
        itemSortDirection,
      ),
    [countLines, selectedLocId, itemSortDirection],
  );

  const visibleLocationLines = useMemo(
    () =>
      locationLines.filter(
        (line) =>
          (!selectedCategoryFilter ||
            getLineCategoryName(line) === selectedCategoryFilter) &&
          (!selectedItemFilterId || line.id === selectedItemFilterId) &&
          (!showPreviouslyCountedOnly ||
            Number(previousLineMap.get(countLineIdentity(line))?.qty) > 0),
      ),
    [
      locationLines,
      previousLineMap,
      selectedCategoryFilter,
      selectedItemFilterId,
      showPreviouslyCountedOnly,
    ],
  );
  useEffect(() => {
    setVisibleLimit(120);
  }, [
    selectedLocId,
    selectedCategoryFilter,
    selectedItemFilterId,
    showPreviouslyCountedOnly,
    itemSearch,
    itemSortDirection,
  ]);

  const searchResults = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    if (!query) return { locations: [], categories: [], items: [] };

    const sessionLines = countLines || [];
    const locations = sessionLocations
      .filter((location) => location.name.toLowerCase().includes(query))
      .map((location) => ({
        ...location,
        itemCount: sessionLines.filter(
          (line) => getLineLocationId(line) === location.id,
        ).length,
      }));

    const categories = Array.from(
      new Set(locationLines.map(getLineCategoryName)),
    )
      .filter((category) => category.toLowerCase().includes(query))
      .map((category) => ({
        name: category,
        itemCount: locationLines.filter(
          (line) => getLineCategoryName(line) === category,
        ).length,
      }));

    const locationsById = new Map(
      sessionLocations.map((location) => [location.id, location.name]),
    );
    const items = sessionLines.filter((line) => {
      const item = line.inventoryItem;
      const locationName = locationsById.get(getLineLocationId(line));
      return [
        item?.name,
        getLineCategoryName(line),
        locationName,
        item?.sourcePackSizeRaw,
        item?.containerLabel,
        line.unitAbbreviation,
        item?.unitName,
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    });

    return { locations, categories, items: items.slice(0, 20) };
  }, [countLines, itemSearch, locationLines, sessionLocations]);

  const hasSearchResults =
    searchResults.locations.length > 0 ||
    searchResults.categories.length > 0 ||
    searchResults.items.length > 0;

  const locationCategories = useMemo(
    () => Array.from(new Set(visibleLocationLines.map(getLineCategoryName))),
    [visibleLocationLines],
  );
  const categoryAggregates = useMemo(() => visibleLocationLines.reduce(
    (aggregates: Record<string, { counted: number; total: number; value: number }>, line) => {
      const category = getLineCategoryName(line);
      const aggregate = aggregates[category] || { counted: 0, total: 0, value: 0 };
      aggregate.total += 1;
      aggregate.value += (Number(line.qty) || 0) * (Number(line.unitCost) || 0);
      if (hasRecordedCount(line)) aggregate.counted += 1;
      aggregates[category] = aggregate;
      return aggregates;
    },
    {},
  ), [visibleLocationLines]);
  const renderedLocationLines = useMemo(
    () => getRenderedMobileCountLines(visibleLocationLines, visibleLimit),
    [visibleLocationLines, visibleLimit],
  );

  // Progress per location
  const progressByLoc = useMemo(() => (countLines || []).reduce<
    Record<string, { counted: number; total: number }>
  >((acc, l) => {
    const locId = getLineLocationId(l);
    if (!acc[locId]) acc[locId] = { counted: 0, total: 0 };
    acc[locId].total += 1;
    if (hasRecordedCount(l)) acc[locId].counted += 1;
    return acc;
  }, {}), [countLines]);

  // Cost totals derived from cached count lines
  const costByLoc = useMemo(() => (countLines || []).reduce<Record<string, number>>(
    (acc, l) => {
      if ((l.qty || 0) > 0) {
        const locId = getLineLocationId(l);
        acc[locId] = (acc[locId] ?? 0) + l.qty * (l.unitCost || 0);
      }
      return acc;
    },
    {}
  ), [countLines]);
  const sessionCostTotal = useMemo(() => Object.values(costByLoc).reduce(
    (sum, v) => sum + v,
    0
  ), [costByLoc]);
  const locationCostTotal = selectedLocId ? (costByLoc[selectedLocId] ?? 0) : 0;

  function selectLocation(locationId: string) {
    setSelectedLocId(locationId);
    setSelectedCategoryFilter(null);
    setSelectedItemFilterId(null);
    requestAnimationFrame(() => {
      itemListRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function jumpToCategory(categoryName: string) {
    const list = itemListRef.current;
    const anchor = mobileCategoryAnchor(categoryName);
    const target = document.getElementById(anchor);
    const heading = document.getElementById(`${anchor}-heading`);
    if (!list || !target || !heading) return;
    const listTop = list.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    list.scrollTo({
      top: Math.max(0, list.scrollTop + targetTop - listTop),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    heading.focus({ preventScroll: true });
  }

  // Overall session completion
  const countTotals = useMemo(() => (countLines || []).reduce(
    (totals, line) => {
      totals.total += 1;
      if (hasRecordedCount(line)) totals.counted += 1;
      return totals;
    },
    { total: 0, counted: 0 },
  ), [countLines]);
  const totalItems = countTotals.total;
  const countedItems = countTotals.counted;
  const allCounted = totalItems > 0 && countedItems === totalItems;

  // Active line + item + mode
  const activeLine = (activeLineId ? lineById.get(activeLineId) : null) ?? null;
  const activeItem = activeLine?.inventoryItem ?? null;
  const activeCategory = categoryById.get(activeItem?.categoryId);
  const activeStorageLoc = locationById.get(activeLine?.storageLocationId);
  const activeMode: CountMode = activeLine
    ? getCountMode(activeCategory, activeStorageLoc, activeItem)
    : "simple";
  const hasOperationalPackageGeometry =
    Number(activeItem?.containerSize) > 0 &&
    Number(activeItem?.casePkgCount) > 0;
  const hasHistoricalLooseQuantity = Number(activeLine?.looseUnits) > 0;
  const packageCountingUnavailable =
    activeMode === "case" &&
    (!hasOperationalPackageGeometry || hasHistoricalLooseQuantity);
  const activeUnitAbbr =
    activeLine?.unitAbbreviation || activeItem?.unitName || "unit";
  const activeContainerLabel = activeItem?.containerLabel?.trim() || "container";
  const activeContainerLabelPlural = pluralizeCountUnit(activeContainerLabel, 2);
  const activeWholeCase = isWholeCaseConfiguration(activeItem, activeLine?.unitAbbreviation);

  // Next uncounted item in current location (after activeLineId)
  const nextLine = (() => {
    if (!activeLineId) return null;
    const idx = locationLines.findIndex((l) => l.id === activeLineId);
    // First try uncounted items after current
    const remaining = locationLines.slice(idx + 1);
    const nextUncounted = remaining.find((l) => !hasRecordedCount(l));
    if (nextUncounted) return nextUncounted;
    // Then try uncounted before current
    const before = locationLines.slice(0, idx);
    return before.find((l) => !hasRecordedCount(l)) ?? null;
  })();

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      qty?: number;
      addQty?: number;
      caseQty?: number | null;
      containerQty?: number | null;
      looseUnits?: number | null;
      accumulate?: boolean;
    }) => {
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
      const line = updatedLine?.line || updatedLine;
      if (line?.id) {
        queryClient.setQueryData<any[]>(
          countLinesQueryKey,
          (lines) => mergeUpdatedCountLineIntoCache(lines, line),
        );
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error saving count",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/inventory-counts/${countId}/apply`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory-count-lines", countId],
      });
      toast({ title: "Count applied successfully" });
      navigate("/inventory-sessions?embedded=true");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to apply count",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const clearLineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      const response = await apiRequest("POST", `/api/inventory-count-lines/${lineId}/clear`);
      return response.json();
    },
    onSuccess: (line: any) => {
      queryClient.setQueryData<any[]>(
        countLinesQueryKey,
        (lines) => mergeUpdatedCountLineIntoCache(lines, line),
      );
      setSheetQty("");
      setSheetCaseQty("");
      setSheetContainerQty("");
      setShowClearConfirm(false);
      toast({ title: "Entries removed", description: "To record zero stock, enter 0 and Save & next." });
    },
    onError: () => {
      toast({ title: "Failed to clear entries", variant: "destructive" });
      setShowClearConfirm(false);
    },
  });

  // ── Sheet helpers ──────────────────────────────────────────────────────────
  function openSheet(lineId: string) {
    const line = lineById.get(lineId);
    if (!line) return;
    const item = line.inventoryItem;
    const cat = categoryById.get(item?.categoryId);
    const loc = locationById.get(getLineLocationId(line));
    const mode = getCountMode(cat, loc, item);
    const containerSize = Number(item?.containerSize);
    const casePkgCount = Number(item?.casePkgCount);
    const cannotCountPackage =
      mode === "case" &&
      (
        !Number.isFinite(containerSize) ||
        containerSize <= 0 ||
        !Number.isFinite(casePkgCount) ||
        casePkgCount <= 0 ||
        Number(line.looseUnits) > 0
      );
    if (cannotCountPackage) {
      toast({
        title: "Package setup needs review",
        description:
          "This item cannot be counted by package until its package size and counting unit are complete.",
        variant: "destructive",
      });
      return;
    }

    setActiveLineId(lineId);
    setActiveInput(mode === "case" ? "case" : "qty");
    // Pre-fill inputs with existing values if single entry
    if (mode === "case") {
      const savedPartsReady = getCountUnitDisplay(line, mode).status === "ready";
      setSheetCaseQty(
        savedPartsReady && line.caseQty != null ? String(line.caseQty) : ""
      );
      setSheetContainerQty(
        savedPartsReady && line.containerQty != null ? String(line.containerQty) : ""
      );
      setSheetQty("");
    } else {
      // For catch-weight: always start blank (each entry is a new weighing)
      // For simple: start blank so user enters fresh value
      setSheetQty(
        mode === "simple" && line.qty > 0 && (line.entries?.length ?? 0) <= 1
          ? String(line.qty)
          : ""
      );
      setSheetCaseQty("");
      setSheetContainerQty("");
    }
  }

  function closeSheet() {
    setActiveLineId(null);
    setSheetQty("");
    setSheetCaseQty("");
    setSheetContainerQty("");
  }

  const containerInputRef = useRef<HTMLInputElement>(null);
  const fieldsDisabled = updateMutation.isPending || clearLineMutation.isPending || packageCountingUnavailable;
  const activeValue = activeMode === "case"
    ? (activeInput === "container" ? sheetContainerQty : sheetCaseQty)
    : sheetQty;
  function setActiveValue(value: string) {
    if (activeMode === "case") {
      if (activeInput === "container") setSheetContainerQty(value);
      else setSheetCaseQty(value);
    } else setSheetQty(value);
  }
  function blurActiveField() {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  // Listen for catch-weight scan results from the native Expo layer
  useEffect(() => {
    function handleCatchWeightResult(e: Event) {
      const { lineId, newCount, cancelled } = (e as CustomEvent).detail ?? {};
      setCatchWeightScanPending(false);
      if (cancelled || newCount == null || newCount <= 0) return;
      if (!lineId) return;
      updateMutation.mutate(
        { id: lineId, addQty: Number(newCount), accumulate: true },
        {
          onSuccess: () => {
            setSheetQty("");
            setTimeout(() => primaryInputRef.current?.focus(), 50);
          },
        }
      );
    }
    window.addEventListener("nativeCatchWeightResult", handleCatchWeightResult);
    return () => window.removeEventListener("nativeCatchWeightResult", handleCatchWeightResult);
  }, [updateMutation]);

  function hasSheetInput(): boolean {
    const valid = (value: string) =>
      value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
    if (activeMode === "case") {
      return (
        (sheetCaseQty.trim() !== "" || sheetContainerQty.trim() !== "") &&
        (sheetCaseQty.trim() === "" || valid(sheetCaseQty)) &&
        (sheetContainerQty.trim() === "" || valid(sheetContainerQty))
      );
    }
    return valid(sheetQty);
  }

  function saveAndAdvance() {
    if (!activeLineId || updateMutation.isPending || clearLineMutation.isPending) return;
    const hasInput = hasSheetInput();

    const doAdvance = () => {
      if (nextLine) {
        openSheet(nextLine.id);
      } else {
        closeSheet();
        // Check if this location is now complete
        const locProgress = progressByLoc[selectedLocId ?? ""];
        const totalInLoc = locationLines.length;
        const countedInLoc = locationLines.filter(hasRecordedCount).length;
        if (countedInLoc + 1 >= totalInLoc) {
          // Find next location with uncounted items
          const nextLoc = sessionLocations.find((loc) => {
            if (loc.id === selectedLocId) return false;
            const p = progressByLoc[loc.id];
            return p && p.counted < p.total;
          });
          if (nextLoc) {
            toast({
              title: `${sessionLocations.find((l) => l.id === selectedLocId)?.name ?? "Location"} complete`,
              description: `Moving to ${nextLoc.name}`,
            });
            selectLocation(nextLoc.id);
          } else {
            toast({ title: "All items counted!" });
          }
        }
      }
    };

    if (!hasInput) return;

    if (activeMode === "case") {
      const cases = parseFloat(sheetCaseQty) || 0;
      const containers = parseFloat(sheetContainerQty) || 0;
      const item = activeLine?.inventoryItem;
      const qty =
        cases * (item?.casePkgCount || 0) * (item?.containerSize || 0) +
        containers * (item?.containerSize || 0);
      updateMutation.mutate(
        {
          id: activeLineId,
          qty,
          caseQty: cases,
          containerQty: activeWholeCase ? 0 : containers,
          looseUnits: 0,
          accumulate: false,
        },
        { onSuccess: doAdvance }
      );
    } else if (activeMode === "catch") {
      const addQty = parseFloat(sheetQty) || 0;
      if (addQty > 0) {
        updateMutation.mutate(
          { id: activeLineId, addQty, accumulate: true },
          { onSuccess: doAdvance }
        );
      } else if (Number(sheetQty) === 0) {
        // A deliberate zero replaces old weighings; blank input never does.
        updateMutation.mutate(
          { id: activeLineId, qty: 0, accumulate: false },
          { onSuccess: doAdvance },
        );
      }
    } else {
      const qty = parseFloat(sheetQty) || 0;
      updateMutation.mutate(
        { id: activeLineId, qty, accumulate: false },
        { onSuccess: doAdvance }
      );
    }
  }

  function skipAndAdvance() {
    if (nextLine) {
      openSheet(nextLine.id);
    } else {
      closeSheet();
    }
  }

  function addEntry() {
    if (!activeLineId || !hasSheetInput()) return;

    if (activeMode === "case") {
      const cases = parseFloat(sheetCaseQty) || 0;
      const containers = parseFloat(sheetContainerQty) || 0;
      const item = activeLine?.inventoryItem;
      updateMutation.mutate(
        {
          id: activeLineId,
          caseQty: cases,
          containerQty: activeWholeCase ? 0 : containers,
          looseUnits: 0,
          accumulate: false,
        },
        {
          onSuccess: () => {
            setSheetCaseQty("");
            setSheetContainerQty("");
            setTimeout(() => {
              primaryInputRef.current?.focus();
            }, 50);
          },
        }
      );
    } else {
      const addQty = parseFloat(sheetQty) || 0;
      if (addQty > 0) {
        updateMutation.mutate(
          { id: activeLineId, addQty, accumulate: true },
          {
            onSuccess: () => {
              setSheetQty("");
              setTimeout(() => {
                primaryInputRef.current?.focus();
              }, 50);
            },
          }
        );
      }
    }
  }

  // ── Native catch-weight scan trigger (Expo WebView bridge) ─────────────────
  function triggerNativeCatchWeightScan() {
    if (!activeLineId) return;
    const rn = (window as any).ReactNativeWebView;
    if (!rn) return;
    setCatchWeightScanPending(true);
    rn.postMessage(
      JSON.stringify({
        type: "SCAN_CATCH_WEIGHT",
        lineId: activeLineId,
        itemId: activeLine?.inventoryItem?.id,
        itemName: activeLine?.inventoryItem?.name,
        sessionId: countId,
      })
    );
  }

  // ── Barcode scan handler ───────────────────────────────────────────────────
  const handleBarcodeDetected = useCallback(
    (rawBarcode: string) => {
      setShowScanner(false);

      // Normalize: trim whitespace; also normalise leading-zero variants (UPC-A vs EAN-13)
      const barcode = rawBarcode.trim();
      const bareBarcode = barcode.replace(/^0+/, "");

      if (!countLines || countLines.length === 0) {
        setNoMatchSuggestions([]);
        setNoMatchBarcode(barcode);
        return;
      }

      // Search all count lines for a matching barcode on their inventory item.
      // Try exact match first, then leading-zero-stripped fallback.
      const matchedLine =
        countLines.find(
          (l) => l.inventoryItem?.barcode && l.inventoryItem.barcode.trim() === barcode
        ) ??
        countLines.find(
          (l) =>
            l.inventoryItem?.barcode &&
            l.inventoryItem.barcode.trim().replace(/^0+/, "") === bareBarcode
        );

      if (matchedLine) {
        // Switch to the item's location if needed
        const itemLocId = getLineLocationId(matchedLine);
        if (itemLocId !== selectedLocId) {
          selectLocation(itemLocId);
        }
        // Open the item's entry sheet (slight delay to allow location switch to render)
        setTimeout(() => openSheet(matchedLine.id), 80);
        toast({
          title: `Found: ${matchedLine.inventoryItem?.name ?? "Item"}`,
          description: "Entry sheet opened",
        });
      } else {
        // Build candidate suggestions: items whose name or PLU/SKU contains parts of the
        // barcode digits, or items that have no barcode yet (could be the right item).
        const candidates = (countLines ?? [])
          .filter((line) =>
            isMobileBarcodeFallbackCandidate(line.inventoryItem, barcode),
          )
          .slice(0, 3)
          .map((l) => l.inventoryItem?.name as string)
          .filter(Boolean);

        setNoMatchSuggestions(candidates);
        setNoMatchBarcode(barcode);
      }
    },
    [countLines, selectedLocId, openSheet, toast]
  );

  const isHistoricalImport = count?.isHistoricalImport === 1;
  const isReadOnly =
    count && (isHistoricalImport || count.canEdit === false || count.applied === 1);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (countLoading || linesLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* ── Header ── */}
      <div
        className="flex items-center gap-1 px-2 pb-2 bg-background shrink-0"
        style={{ paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))' }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => navigate("/inventory-sessions?embedded=true")}
          data-testid="button-mobile-back"
          aria-label="Back to count sessions"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        <div className="flex-1 min-w-0 px-2 flex flex-col justify-center">
          <div className="text-[17px] font-semibold truncate" data-testid="text-mobile-session-title">
            Count session
          </div>
          <div className="text-[13px] text-muted-foreground truncate">
            Started {formatDateString(count?.countedAt || new Date().toISOString())} · Session ${sessionCostTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {!isReadOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => setShowScanner(true)}
            data-testid="button-mobile-scan-barcode"
            aria-label="Scan barcode"
          >
            <ScanBarcode className="h-5 w-5" />
          </Button>
        )}

        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="More count actions">
          <div className="text-xl leading-none -mt-2">⋯</div>
        </Button>
      </div>

      {/* ── Progress line ── */}
      <div className="px-4 pb-3 bg-background border-b shrink-0">
         <div className="flex justify-between items-center text-[13px] font-medium mb-1.5">
            <span>{countedItems} of {totalItems} counted</span>
            <span>{totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0}%</span>
         </div>
         <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
            <div
               className="h-full bg-primary rounded-full"
               style={{ width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%` }}
            />
         </div>
      </div>

      {/* ── Location chips ── */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 border-b bg-background scrollbar-none h-[68px] items-center">
        {sessionLocations.map((loc) => {
          const prog = progressByLoc[loc.id] ?? { counted: 0, total: 0 };
          const active = selectedLocId === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => selectLocation(loc.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 h-11 rounded-full border text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface border-border text-foreground hover:bg-muted"
              }`}
              data-testid={`button-mobile-location-${loc.id}`}
            >
              {loc.name}
              <span className={`text-[13px] tabular-nums ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                {prog.counted}/{prog.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters row ── */}
      {locationLines.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-background shrink-0">
          <Button
            variant="outline"
            className="h-9 shrink-0 gap-2 px-3 bg-surface border-border hover:bg-muted"
            onClick={() => setShowFiltersSheet(true)}
            data-testid="button-mobile-filter-open"
          >
            <ListFilter className="h-4 w-4" />
            <span className="text-[14px] font-semibold">Filters</span>
          </Button>

          <div
            className="flex-1 flex gap-2 overflow-x-auto scrollbar-none items-center"
            aria-label="Active filters"
          >
            {selectedCategoryFilter && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCategoryFilter(null);
                  setSelectedItemFilterId(null);
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 text-blue-900 border border-blue-200 px-3 h-9 text-[13px] font-semibold"
                data-testid="filter-chip-category"
              >
                {selectedCategoryFilter}
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}

            {selectedItemFilterId && (
              <button
                type="button"
                onClick={() => setSelectedItemFilterId(null)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 text-blue-900 border border-blue-200 px-3 h-9 text-[13px] font-semibold"
                data-testid="filter-chip-item"
              >
                {lineById.get(selectedItemFilterId)?.inventoryItem?.name ?? "Item"}
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}
{showPreviouslyCountedOnly && (
              <button
                type="button"
                onClick={() => setShowPreviouslyCountedOnly(false)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 text-blue-900 border border-blue-200 px-3 h-9 text-[13px] font-semibold"
                data-testid="filter-chip-previous-nonzero"
              >
                Had stock
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}
            {!selectedCategoryFilter && !showPreviouslyCountedOnly && (
               <div className="flex-1" />
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 bg-surface border-border hover:bg-muted"
            onClick={() =>
              setItemSortDirection((current) => current === "asc" ? "desc" : "asc")
            }
            aria-label={`Sort ${itemSortDirection === "asc" ? "descending" : "ascending"}`}
            data-testid="button-mobile-sort-items"
          >
            <span className="text-[12px] font-bold leading-none">A–Z</span>
          </Button>
        </div>
      )}

      {/* ── Location Warning ── */}
      {(previousData?.reconciliation?.locationUnmatchedLines ?? 0) > 0 && (
        <button
          className="flex w-full items-center justify-between border-b border-amber-200 bg-[#FFF4DB] px-4 py-2.5 text-[13px] text-[#7A4A00] font-medium active:bg-[#FDEBB6] transition-colors"
          data-testid="alert-mobile-previous-location-unmatched"
          onClick={() => setIsLocationReviewOpen(true)}
        >
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {previousData!.reconciliation!.locationUnmatchedLines} items need a location review
            </span>
          </div>
          <span className="flex items-center gap-0.5 opacity-80">
            Review <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}

      {/* ── Item list ── */}
      <div
        ref={itemListRef}
        className="flex-1 overflow-y-auto scroll-pt-0 bg-surface"
        data-testid="mobile-item-list"
      >
        {locationLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Package className="h-8 w-8" />
            <p className="text-sm">No items in this location</p>
          </div>
        ) : visibleLocationLines.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2"
            data-testid="mobile-search-empty"
          >
            <Search className="h-8 w-8" />
            <p className="text-sm">No session items match these filters</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
             {renderedLocationLines.map((line, index) => {
              const item = line.inventoryItem;
              const categoryName = getLineCategoryName(line);
              const startsCategory =
                index === 0 ||
                getLineCategoryName(visibleLocationLines[index - 1]) !== categoryName;
              const cat = categoryById.get(item?.categoryId);
              const loc = locationById.get(getLineLocationId(line));
              const mode = getCountMode(cat, loc, item);
              const unitAbbr = line.unitAbbreviation || item?.unitName || "unit";

              const previousLine = previousLineMap.get(countLineIdentity(line));
              const currentTotalValue = Number(line.qty || 0);
              const isCounted = hasRecordedCount(line);

              const configuredContainerLabel = item?.containerLabel?.trim() || "container";
              const containerAbbr = abbreviateCountUnit(configuredContainerLabel);

              const display = getCountUnitDisplay(line, mode);
              const packLine = display.isPackage ? display.caseDetail || "Counting setup required" : unitAbbr;
              const rightLine1 = isCounted ? display.summary : "—";

              const prevVal = Number(previousLine?.qty || 0);
              const diff = currentTotalValue - prevVal;
              const prevUnit = previousLine?.unitAbbreviation || previousLine?.inventoryItem?.unitName || "unit";
              const unitMismatch = previousLine && prevUnit !== unitAbbr;

              const previousDisplay = getPreviousCountUnitDisplay(previousLine, line, mode);
              const packageComparable = mode !== "case" ||
                (display.containers != null && previousDisplay?.containers != null && !unitMismatch);
              let rightLine2 = previousDisplay ? `last ${previousDisplay.summary}` : "No prior count";
              let diffColor = "text-muted-foreground";
              if (isCounted && previousLine && !unitMismatch && packageComparable) {
                  const displayDiff = mode === "case" ? display.containers! - previousDisplay!.containers! : diff;
                  if (displayDiff > 0) { rightLine2 = `+${formatPhysicalQuantity(displayDiff)} ${mode === "case" ? pluralizeCountUnit(configuredContainerLabel, displayDiff) : unitAbbr} vs last`; diffColor = "text-[#2F7D4F]"; }
                  else if (displayDiff < 0) { rightLine2 = `${formatPhysicalQuantity(displayDiff)} ${mode === "case" ? pluralizeCountUnit(configuredContainerLabel, displayDiff) : unitAbbr} vs last`; diffColor = "text-[#A23B12]"; }
                  else { rightLine2 = "Same as last"; diffColor = "text-muted-foreground"; }
              }

              return (
                <Fragment key={line.id}>
                {startsCategory && (
                  <>
                    <div id={mobileCategoryAnchor(categoryName)} className="h-0" aria-hidden="true" />
                    <div
                      id={`${mobileCategoryAnchor(categoryName)}-heading`}
                      tabIndex={-1}
                      className="sticky top-0 z-10 flex items-center justify-between border-b bg-[#F6F4EF] px-4 py-2 focus:outline-none"
                      data-testid={`mobile-category-section-${categoryName}`}
                    >
                      <span className="text-[13px] font-bold tracking-wider text-muted-foreground uppercase">
                        {categoryName}
                      </span>
                      <span className="text-[13px] font-mono font-medium text-muted-foreground">
                        {categoryAggregates[categoryName]?.counted ?? 0} / {categoryAggregates[categoryName]?.total ?? 0} · ${(categoryAggregates[categoryName]?.value ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </>
                )}

                <button
                  onClick={() => !isReadOnly && openSheet(line.id)}
                  className={`w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left ${
                    isReadOnly ? "cursor-default" : "cursor-pointer active:bg-muted/50"
                  } ${isCounted ? "bg-emerald-50/20" : "bg-surface"}`}
                  data-testid={`button-mobile-item-${line.id}`}
                >
                  <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${isCounted ? 'bg-[#2F7D4F]' : 'border-[1.5px] border-dashed border-muted-foreground/40'}`}>
                    {isCounted && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                     <div
                        className="text-[16px] font-semibold text-foreground truncate"
                        data-testid={`text-mobile-item-name-${line.id}`}
                     >
                        {item?.name ?? "Unknown"}
                     </div>
                     <div className="text-[13px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {packLine}
                        {unitMismatch && (
                           <span className="bg-[#FFF4DB] text-[#7A4A00] text-[10px] font-bold px-1.5 py-0.5 rounded uppercase leading-none">UNIT?</span>
                        )}
                     </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end justify-center">
                     <div className={`text-[20px] font-mono font-semibold ${isCounted ? 'text-foreground' : 'text-muted-foreground opacity-50'}`}>
                        {rightLine1}
                     </div>
                     <div
                        className={`text-[13px] font-mono ${diffColor}`}
                        data-testid={`text-mobile-previous-count-${line.id}`}
                     >
                        {rightLine2}
                     </div>
                  </div>
                </button>
                </Fragment>
              );
            })}
          </div>
        )}
         {visibleLocationLines.length > renderedLocationLines.length && (
           <div className="p-3 border-t">
             <Button
               variant="outline"
               className="w-full"
               onClick={() => setVisibleLimit((limit) => limit + 120)}
               data-testid="button-mobile-load-more"
             >
               Load more ({visibleLocationLines.length - renderedLocationLines.length} remaining)
             </Button>
           </div>
         )}
      </div>

      <div className="relative shrink-0 border-t bg-background">

        {itemSearch.trim() && (
          <div
            id="mobile-session-search-results"
            className="absolute bottom-full left-0 right-0 z-30 max-h-[55vh] overflow-y-auto border-t bg-background shadow-2xl"
            data-testid="mobile-session-search-results"
          >
            {!hasSearchResults ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No locations, categories, or items in this session match “{itemSearch.trim()}”
              </div>
            ) : (
              <div className="divide-y">
                {searchResults.locations.length > 0 && (
                  <div className="p-2">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Locations
                    </div>
                    {searchResults.locations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        onClick={() => {
                          selectLocation(location.id);
                          setItemSearch("");
                        }}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                        data-testid={`search-result-location-${location.id}`}
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-sm font-medium">{location.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {location.itemCount} {location.itemCount === 1 ? "item" : "items"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.categories.length > 0 && (
                  <div className="p-2">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Categories in this location
                    </div>
                    {searchResults.categories.map((category) => (
                      <button
                        key={category.name}
                        type="button"
                        onClick={() => {
                          setSelectedCategoryFilter(category.name);
                          setSelectedItemFilterId(null);
                          setItemSearch("");
                          requestAnimationFrame(() =>
                            itemListRef.current?.scrollTo({ top: 0, behavior: "auto" }),
                          );
                        }}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                        data-testid={`search-result-category-${category.name}`}
                      >
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-sm font-medium">{category.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {category.itemCount} {category.itemCount === 1 ? "item" : "items"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.items.length > 0 && (
                  <div className="p-2">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Items in this session
                    </div>
                    {searchResults.items.map((line) => {
                      const itemLocation = sessionLocations.find(
                        (location) => location.id === getLineLocationId(line),
                      );
                      return (
                        <button
                          key={line.id}
                          type="button"
                          onClick={() => {
                            selectLocation(getLineLocationId(line));
                            setSelectedCategoryFilter(getLineCategoryName(line));
                            setSelectedItemFilterId(line.id);
                            setItemSearch("");
                            if (!isReadOnly) {
                              setTimeout(() => openSheet(line.id), 80);
                            }
                          }}
                          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                          data-testid={`search-result-item-${line.id}`}
                        >
                          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {line.inventoryItem?.name ?? "Unknown"}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {itemLocation?.name ?? "Unknown location"} · {getLineCategoryName(line)}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}


         <div className="flex items-center gap-2 px-4 h-16" data-testid="mobile-session-toolbar">
           <Button
             variant="ghost"
             size="icon"
             onClick={() => navigate("/dashboard/mobile")}
             className="shrink-0"
             data-testid="button-mobile-home"
             title="Home"
           >
             <Home className="h-5 w-5" />
           </Button>
           <div className="relative min-w-0 flex-1">
             <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
             <Input
               value={itemSearch}
               onChange={(event) => setItemSearch(event.target.value)}
               placeholder="Search or scan…"
               className="h-12 pl-10 bg-surface border-border text-base rounded-lg shadow-sm"
               type="search"
               data-testid="input-mobile-item-search"
             />
             {itemSearch.length > 0 && (
               <button
                 onClick={() => setItemSearch("")}
                 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                 data-testid="button-clear-mobile-item-search"
               >
                 <X className="h-5 w-5" />
               </button>
             )}
           </div>
         </div>
      </div>

      <Sheet open={showFiltersSheet} onOpenChange={setShowFiltersSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-6 pb-4">
             <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Had stock (Last &gt; 0)</div>
                <Button
                   variant={showPreviouslyCountedOnly ? "default" : "outline"}
                   onClick={() => setShowPreviouslyCountedOnly(!showPreviouslyCountedOnly)}
                   data-testid="button-mobile-filter-previous-nonzero"
                >
                   {showPreviouslyCountedOnly ? "On" : "Off"}
                </Button>
             </div>
             <div className="space-y-3">
                <div className="text-sm font-medium">Category</div>
                <div className="flex flex-wrap gap-2">
                   {locationCategories.map(cat => (
                      <Button
                         key={cat}
                         variant={selectedCategoryFilter === cat ? "default" : "outline"}
                         size="sm"
                         onClick={() => setSelectedCategoryFilter(selectedCategoryFilter === cat ? null : cat)}
                         data-testid={`button-mobile-category-${cat}`}
                      >
                         {cat}
                      </Button>
                   ))}
                </div>
             </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Entry Sheet ── */}
      <Sheet
        open={!!activeLineId}
        onOpenChange={(open) => {
          if (!open && !updateMutation.isPending && !clearLineMutation.isPending) closeSheet();
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[96vh] max-h-[96dvh] flex flex-col gap-0 overflow-hidden rounded-t-[24px] px-0 py-0 bg-[#F6F4EF]"
          style={entryViewportStyle}
          data-testid="mobile-count-entry-sheet"
        >
          {activeLine && activeItem && (() => {
             const cat = categoryById.get(activeItem?.categoryId);
             const loc = locationById.get(getLineLocationId(activeLine));
             const mode = getCountMode(cat, loc, activeItem);

             const unitAbbr = activeLine.unitAbbreviation || activeItem.unitName || "unit";
              const configuredContainerLabel = activeItem?.containerLabel?.trim() || "container";
             const containerAbbr = abbreviateCountUnit(configuredContainerLabel);

             const hasPackageGeometry = Number(activeItem?.containerSize) > 0 && Number(activeItem?.casePkgCount) > 0;
              const isTwoLevel = mode === "case" && hasPackageGeometry && !(Number(activeLine.looseUnits) > 0);
              const activeDisplay = getCountUnitDisplay(activeLine, mode);

             const previousLine = previousLineMap.get(countLineIdentity(activeLine));
             const prevVal = Number(previousLine?.qty || 0);
             const previousUnitAbbr =
               previousLine?.unitAbbreviation ||
               previousLine?.inventoryItem?.unitName ||
               unitAbbr;
             const unitsComparable = !previousLine || previousUnitAbbr === unitAbbr;
              const previousDisplay = getPreviousCountUnitDisplay(previousLine, activeLine, mode);
              const previousPackageReady = !isTwoLevel || previousDisplay?.containers != null;

             let typedQty = isTwoLevel
               ? (Number(sheetCaseQty)||0) * activeItem.casePkgCount + (Number(sheetContainerQty)||0)
               : (Number(sheetQty)||0);
             const currentCanonicalQty = isTwoLevel
               ? typedQty * Number(activeItem.containerSize)
               : typedQty;

             const diffCanonical = unitsComparable ? currentCanonicalQty - prevVal : 0;
              const diff = isTwoLevel && previousDisplay?.containers != null
                ? typedQty - previousDisplay.containers
               : diffCanonical;
             const displayUnitAbbr = activeWholeCase
               ? pluralizeCountUnit("whole case", 2)
               : isTwoLevel ? containerAbbr : unitAbbr;
             let diffColor = "text-muted-foreground";
              let diffText = !previousLine ? "No prior count" :
                !unitsComparable || !previousPackageReady ? "Prior count needs review; change unavailable" : "Same as last";
              if (previousLine && unitsComparable && previousPackageReady && diff > 0) { diffText = `+${diff.toFixed(2)} ${displayUnitAbbr} vs last count`; diffColor = "text-[#2F7D4F]"; }
              else if (previousLine && unitsComparable && previousPackageReady && diff < 0) { diffText = `${diff.toFixed(2)} ${displayUnitAbbr} vs last count`; diffColor = "text-[#A23B12]"; }

             return (
               <>
                 <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
                    <Button variant="ghost" size="icon" className="w-11 h-11" disabled={updateMutation.isPending || clearLineMutation.isPending} onClick={closeSheet} aria-label="Close count entry">
                     <X className="w-6 h-6" />
                   </Button>
                   <div className="text-[14px] font-semibold text-muted-foreground">
                      {getLineCategoryName(activeLine)} · {visibleLocationLines.findIndex(l => l.id === activeLine.id) + 1} of {visibleLocationLines.filter(l => getLineCategoryName(l) === getLineCategoryName(activeLine)).length}
                   </div>
                   <div className="flex">
                       <Button variant="ghost" size="icon" className="w-11 h-11" disabled={updateMutation.isPending || clearLineMutation.isPending} aria-label="Previous item" onClick={() => {
                        const idx = locationLines.findIndex(l => l.id === activeLine.id);
                        if (idx > 0) openSheet(locationLines[idx-1].id);
                      }}>
                         <ChevronRight className="w-6 h-6 rotate-180" />
                      </Button>
                       <Button variant="ghost" size="icon" className="w-11 h-11" disabled={updateMutation.isPending || clearLineMutation.isPending} aria-label="Next item" onClick={() => {
                        const idx = locationLines.findIndex(l => l.id === activeLine.id);
                        if (idx < locationLines.length - 1) openSheet(locationLines[idx+1].id);
                      }}>
                         <ChevronRight className="w-6 h-6" />
                      </Button>
                   </div>
                 </div>

                 <div
                   className="px-5 min-h-0 flex-1 overflow-y-auto overscroll-contain"
                   data-testid="mobile-count-entry-details"
                 >
                    <h2 className="text-[19px] font-bold text-foreground leading-tight mb-1.5">
                       {activeItem.name}
                    </h2>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                       <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface border rounded-md text-[13px] font-medium text-foreground">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                          {loc?.name}
                       </span>
                       {activeWholeCase ? (
                          <span className="inline-flex items-center px-2.5 py-1 bg-surface border rounded-md text-[13px] font-medium text-foreground">
                             Contents unspecified
                          </span>
                       ) : isTwoLevel && (
                          <span className="inline-flex items-center px-2.5 py-1 bg-surface border rounded-md text-[13px] font-medium text-foreground">
                             {activeItem.casePkgCount} {containerAbbr} / case
                          </span>
                       )}
                       <span className="inline-flex items-center px-2.5 py-1 bg-surface border rounded-md text-[13px] font-medium text-foreground font-mono">
                            {activeDisplay.price}
                       </span>
                    </div>

                    <div className="flex gap-2 mb-2">
                       {isTwoLevel && activeWholeCase ? (
                          <CountQuantityField id="count-field-case" testId="input-mobile-count-case" label="Whole cases"
                            value={sheetCaseQty} onChange={setSheetCaseQty} active={activeInput === 'case'}
                            onFocus={() => setActiveInput('case')} enterKeyHint="done" onEnter={() => blurActiveField()}
                            disabled={fieldsDisabled} inputRef={primaryInputRef} />
                       ) : isTwoLevel ? (
                          <>
                             <CountQuantityField id="count-field-case" testId="input-mobile-count-case" label="Cases" hint={`x ${activeItem.casePkgCount}`}
                               value={sheetCaseQty} onChange={setSheetCaseQty} active={activeInput === 'case'}
                               onFocus={() => setActiveInput('case')} enterKeyHint="next"
                               onEnter={() => { setActiveInput('container'); containerInputRef.current?.focus(); }}
                               disabled={fieldsDisabled} inputRef={primaryInputRef} />
                             <CountQuantityField id="count-field-container" testId="input-mobile-count-container" label={pluralizeCountUnit(configuredContainerLabel, 2)}
                               value={sheetContainerQty} onChange={setSheetContainerQty} active={activeInput === 'container'}
                               onFocus={() => setActiveInput('container')} enterKeyHint="done" onEnter={() => blurActiveField()}
                               disabled={fieldsDisabled} inputRef={containerInputRef} />
                          </>
                       ) : (
                          <CountQuantityField id="count-field-qty" testId="input-mobile-count-qty" label={unitAbbr}
                            value={sheetQty} onChange={setSheetQty} active={activeInput === 'qty'}
                            onFocus={() => setActiveInput('qty')} enterKeyHint="done" onEnter={() => blurActiveField()}
                            disabled={fieldsDisabled} inputRef={primaryInputRef} />
                       )}
                    </div>
                    <div className="flex gap-2 mb-3">
                       <Button type="button" variant="outline" size="sm" className="h-9 flex-1 bg-surface" disabled={fieldsDisabled} onClick={() => setActiveValue("")}>Clear</Button>
                       <Button type="button" variant="outline" size="sm" className="h-9 flex-1 bg-surface" aria-label="Add one half"
                         disabled={fieldsDisabled} onClick={() => setActiveValue(adjustQuantityText(activeValue, 0.5))}>+½</Button>
                       {isTwoLevel && !activeWholeCase && (
                         <Button type="button" variant="outline" size="sm" className="h-9 flex-1 bg-surface"
                           disabled={fieldsDisabled}
                           onClick={() => { const n = activeInput === 'case' ? 'container' : 'case'; setActiveInput(n); (n === 'case' ? primaryInputRef : containerInputRef).current?.focus(); }}>Field →</Button>
                       )}
                       <Button type="button" variant="outline" size="sm" className="h-9 flex-1 bg-surface" disabled={updateMutation.isPending || clearLineMutation.isPending} onClick={skipAndAdvance}>Skip</Button>
                    </div>
                    <div className="flex items-center justify-between border-[1.5px] border-dashed border-border rounded-[12px] px-3 py-2 mb-2">
                       <div>
                          <div className="text-[12px] font-semibold uppercase text-muted-foreground mb-1">
                             Last count · {previousCountDate ? new Date(previousCountDate).toLocaleDateString(undefined, {month:'numeric', day:'numeric'}) : 'N/A'}
                          </div>
                          <div className="text-[17px] font-mono font-bold">
                              {previousDisplay?.summary ?? "No prior count"}
                          </div>
                       </div>
                       <Button
                          variant="outline"
                          className="bg-surface h-10 px-4 font-semibold text-[14px]"
                          onClick={() => {
                              if (isTwoLevel && previousLine && previousPackageReady) {
                                setSheetCaseQty(String(previousLine.caseQty || 0));
                                setSheetContainerQty(String(previousLine.containerQty || 0));
                             } else {
                                setSheetQty(String(prevVal));
                             }
                          }}
                             disabled={updateMutation.isPending || clearLineMutation.isPending || !previousLine || !unitsComparable || !previousPackageReady}
                       >
                          Same as last
                       </Button>
                    </div>
                     <p className="text-xs text-muted-foreground mb-3">
                       {hasSheetInput()
                         ? "Save & next records this count. Clear only erases the current input."
                         : "No quantity entered. Enter 0 to record no stock, or Skip to leave this item uncounted."}
                     </p>
                     {(activeLine.entries?.length ?? 0) > 0 && (
                       <div className="mb-3 space-y-2">
                         <div className="flex items-center justify-between">
                           <span className="text-xs font-semibold">Saved entries</span>
                           <Button type="button" variant="outline" size="sm"
                             disabled={updateMutation.isPending || clearLineMutation.isPending}
                             onClick={() => setShowClearConfirm(true)}
                             data-testid="button-mobile-clear-all-entries">
                             Clear all entries
                           </Button>
                         </div>
                         <MobileEntryList
                           entries={activeLine.entries}
                           isCatchWeight={mode === "catch"}
                            isPackage={mode === "case"}
                           unitAbbr={unitAbbr}
                           countId={countId}
                            mutationsDisabled={updateMutation.isPending || clearLineMutation.isPending}
                         />
                       </div>
                     )}

                    <div className="bg-[#E2DED6]/50 rounded-[12px] px-4 py-3 mb-2 flex justify-between items-center">
                       <div className="text-[15px] font-mono font-semibold">
                            {!hasSheetInput() ? "No count entered" : isTwoLevel
                              ? `= ${formatPhysicalQuantity(typedQty)} ${pluralizeCountUnit(configuredContainerLabel, typedQty)}`
                             : `= ${currentCanonicalQty.toFixed(2)} ${unitAbbr}`}
                       </div>
                       <div className="text-[15px] font-mono font-semibold text-[#2F7D4F]">
                            {hasSheetInput() ? `$${(currentCanonicalQty * Number(activeLine.unitCost || 0)).toFixed(2)}` : "—"}
                       </div>
                    </div>
                     <div className={`text-[13px] font-mono mb-4 px-2 ${diffColor}`}>
                        {hasSheetInput() ? diffText : "Enter a quantity to compare with last count"}
                    </div>
                 </div>

                 <Button
                    className="w-full shrink-0 rounded-none min-h-14 h-auto bg-[#C2410C] hover:bg-[#A23B12] text-white text-[17px] font-bold pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 flex items-center justify-center"
                    onClick={saveAndAdvance}
                     disabled={!hasSheetInput() || updateMutation.isPending || clearLineMutation.isPending || packageCountingUnavailable}
                 >
                    {updateMutation.isPending ? "Saving…" : "Save & next →"}
                 </Button>
               </>
             );
          })()}
        </SheetContent>
      </Sheet>      {/* ── Clear all entries confirmation dialog ── */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved entries and leaves this item uncounted. To record zero stock afterward, enter 0 and Save & next. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-mobile-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeLineId) clearLineMutation.mutate(activeLineId);
              }}
              disabled={updateMutation.isPending || clearLineMutation.isPending}
              data-testid="button-mobile-confirm-clear"
            >
              {clearLineMutation.isPending ? "Clearing…" : "Clear all entries"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Apply confirmation dialog ── */}
      <AlertDialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this count?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update on-hand inventory for all counted items. The session will be locked after applying.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowApplyDialog(false);
                applyMutation.mutate();
              }}
              data-testid="button-mobile-confirm-apply"
            >
              Apply Count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Barcode Scanner ── */}
      <BarcodeScanner
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={handleBarcodeDetected}
      />

      {/* ── No-match dialog ── */}
      <AlertDialog
        open={!!noMatchBarcode}
        onOpenChange={(open) => { if (!open) { setNoMatchBarcode(null); setNoMatchSuggestions([]); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Barcode not found</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  No item in this count session has barcode{" "}
                  <span className="font-mono font-semibold" data-testid="text-no-match-barcode">
                    {noMatchBarcode}
                  </span>.
                </p>
                {noMatchSuggestions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Did you mean one of these?</p>
                    <ul className="text-sm space-y-0.5 pl-3 list-disc">
                      {noMatchSuggestions.map((name) => (
                        <li key={name} className="font-medium" data-testid={`text-suggestion-${name}`}>
                          {name}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground pt-1">
                      Open that item in <strong>Inventory Items</strong> and enter this barcode to enable scanning.
                    </p>
                  </div>
                )}
                {noMatchSuggestions.length === 0 && (
                  <p>
                    To enable scan-to-item, open the item in{" "}
                    <strong>Inventory Items</strong> and enter this barcode in the barcode field.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => { setNoMatchBarcode(null); setNoMatchSuggestions([]); }}
              data-testid="button-no-match-dismiss"
            >
              Dismiss
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setNoMatchBarcode(null);
                setNoMatchSuggestions([]);
                setShowScanner(true);
              }}
              data-testid="button-no-match-scan-again"
            >
              Scan Again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocationReviewDialog
        countId={countId}
        isOpen={isLocationReviewOpen}
        onOpenChange={setIsLocationReviewOpen}
        onSelectLine={(lineId, itemId, locationName) => {
          setSelectedItemFilterId(lineId);
          if (locationName) {
            const loc = sessionLocations.find((l: any) => l.name === locationName);
            if (loc) {
              setSelectedLocId(loc.id);
            }
          }
          setActiveLineId(lineId);
          requestAnimationFrame(() => {
            if (!isReadOnly) openSheet(lineId);
          });
        }}
      />
    </div>
  );
}
