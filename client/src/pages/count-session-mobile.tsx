import { useState, useEffect, useRef, Fragment, useCallback } from "react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUndo } from "@/contexts/undo-context";
import { formatUnitName } from "@/lib/utils";

type CountMode = "catch" | "case" | "simple";

function getCountMode(category: any, location: any): CountMode {
  if (category?.isCatchWeightCategory === 1) return "catch";
  if (location?.allowCaseCounting === 1) return "case";
  return "simple";
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
  unitAbbr,
  countId,
  onDeleted,
}: {
  entries: any[];
  isCatchWeight: boolean;
  unitAbbr: string;
  countId: string;
  onDeleted?: () => void;
}) {
  const { register: registerUndo } = useUndo();

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
              +{qtyDisplay} {unitAbbr}
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
              onClick={() => {
                const cacheKey = ["/api/inventory-count-lines", countId];
                const previousData = queryClient.getQueryData(cacheKey);
                queryClient.setQueryData(cacheKey, (old: any) => {
                  if (!old) return old;
                  return old.map((line: any) => ({
                    ...line,
                    entries: (line.entries || []).filter((e: any) => e.id !== entry.id),
                  }));
                });
                onDeleted?.();
                registerUndo(
                  "Count entry removed",
                  async () => {
                    await apiRequest("DELETE", `/api/inventory-count-entries/${entry.id}`);
                    queryClient.invalidateQueries({ queryKey: cacheKey });
                  },
                  () => queryClient.setQueryData(cacheKey, previousData)
                );
              }}
              className="text-muted-foreground/40 hover:text-destructive transition-colors flex-shrink-0"
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
          {runningTotal.toFixed(2)} {unitAbbr}
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
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();

  // Location switcher
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  // Sheet state
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  // Inputs inside the sheet
  const [sheetQty, setSheetQty] = useState("");
  const [sheetCaseQty, setSheetCaseQty] = useState("");
  const [sheetLooseUnits, setSheetLooseUnits] = useState("");
  // Apply confirmation
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  // Clear all entries confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Barcode scanner
  const [showScanner, setShowScanner] = useState(false);
  const [noMatchBarcode, setNoMatchBarcode] = useState<string | null>(null);
  const [noMatchSuggestions, setNoMatchSuggestions] = useState<string[]>([]);

  const primaryInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: count, isLoading: countLoading } = useQuery<any>({
    queryKey: ["/api/inventory-counts", countId],
  });

  const { data: countLines, isLoading: linesLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", countId],
    enabled: !!countId,
  });

  const { data: storageLocations } = useQuery<any[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: categoriesData } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  // Build ordered list of locations that have items in this session
  const sessionLocations = (() => {
    if (!countLines || !storageLocations) return [];
    const locIds = new Set(
      countLines.map((l) => l.inventoryItem?.storageLocationId || "unknown")
    );
    const locs = storageLocations
      .filter((l) => locIds.has(l.id))
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    // Add an "Unknown" slot if needed
    if (locIds.has("unknown")) {
      locs.push({ id: "unknown", name: "Unknown Location", sortOrder: 9999 });
    }
    return locs;
  })();

  // Initialize selected location to first on load
  useEffect(() => {
    if (!selectedLocId && sessionLocations.length > 0) {
      setSelectedLocId(sessionLocations[0].id);
    }
  }, [sessionLocations.length]);

  // Items for the selected location
  const locationLines = (countLines || []).filter(
    (l) => (l.inventoryItem?.storageLocationId || "unknown") === selectedLocId
  );

  // Progress per location
  const progressByLoc = (countLines || []).reduce<
    Record<string, { counted: number; total: number }>
  >((acc, l) => {
    const locId = l.inventoryItem?.storageLocationId || "unknown";
    if (!acc[locId]) acc[locId] = { counted: 0, total: 0 };
    acc[locId].total += 1;
    if ((l.qty || 0) > 0) acc[locId].counted += 1;
    return acc;
  }, {});

  // Cost totals derived from cached count lines
  const costByLoc = (countLines || []).reduce<Record<string, number>>(
    (acc, l) => {
      if ((l.qty || 0) > 0) {
        const locId = l.inventoryItem?.storageLocationId || "unknown";
        acc[locId] = (acc[locId] ?? 0) + l.qty * (l.unitCost || 0);
      }
      return acc;
    },
    {}
  );
  const sessionCostTotal = Object.values(costByLoc).reduce(
    (sum, v) => sum + v,
    0
  );
  const locationCostTotal = selectedLocId ? (costByLoc[selectedLocId] ?? 0) : 0;

  // Overall session completion
  const totalItems = countLines?.length ?? 0;
  const countedItems = (countLines || []).filter((l) => (l.qty || 0) > 0).length;
  const allCounted = totalItems > 0 && countedItems === totalItems;

  // Active line + item + mode
  const activeLine = countLines?.find((l) => l.id === activeLineId) ?? null;
  const activeItem = activeLine?.inventoryItem ?? null;
  const activeCategory = categoriesData?.find(
    (c) => c.id === activeItem?.categoryId
  );
  const activeStorageLoc = storageLocations?.find(
    (l) => l.id === activeLine?.storageLocationId
  );
  const activeMode: CountMode = activeLine
    ? getCountMode(activeCategory, activeStorageLoc)
    : "simple";
  const activeUnitAbbr =
    activeLine?.unitAbbreviation || activeItem?.unitName || "unit";

  // Next uncounted item in current location (after activeLineId)
  const nextLine = (() => {
    if (!activeLineId) return null;
    const idx = locationLines.findIndex((l) => l.id === activeLineId);
    // First try uncounted items after current
    const remaining = locationLines.slice(idx + 1);
    const nextUncounted = remaining.find((l) => (l.qty || 0) === 0);
    if (nextUncounted) return nextUncounted;
    // Then try uncounted before current
    const before = locationLines.slice(0, idx);
    return before.find((l) => (l.qty || 0) === 0) ?? null;
  })();

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      qty?: number;
      addQty?: number;
      caseQty?: number | null;
      looseUnits?: number | null;
      accumulate?: boolean;
    }) => {
      return apiRequest("PATCH", `/api/inventory-count-lines/${data.id}`, {
        qty: data.qty,
        addQty: data.addQty,
        caseQty: data.caseQty,
        looseUnits: data.looseUnits,
        containerQty: null,
        accumulate: data.accumulate ?? false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory-count-lines", countId],
      });
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
      return apiRequest("POST", `/api/inventory-count-lines/${lineId}/clear`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      setShowClearConfirm(false);
      toast({ title: "Entries cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear entries", variant: "destructive" });
      setShowClearConfirm(false);
    },
  });

  // ── Sheet helpers ──────────────────────────────────────────────────────────
  function openSheet(lineId: string) {
    const line = countLines?.find((l) => l.id === lineId);
    if (!line) return;
    const item = line.inventoryItem;
    const cat = categoriesData?.find((c) => c.id === item?.categoryId);
    const loc = storageLocations?.find((l) => l.id === line.storageLocationId);
    const mode = getCountMode(cat, loc);

    setActiveLineId(lineId);

    // Pre-fill inputs with existing values if single entry
    if (mode === "case") {
      setSheetCaseQty(
        line.caseQty != null ? String(line.caseQty) : ""
      );
      setSheetLooseUnits(
        line.looseUnits != null ? String(line.looseUnits) : ""
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
      setSheetLooseUnits("");
    }
  }

  function closeSheet() {
    setActiveLineId(null);
    setSheetQty("");
    setSheetCaseQty("");
    setSheetLooseUnits("");
  }

  // Auto-focus the primary input when sheet opens
  useEffect(() => {
    if (activeLineId) {
      const timer = setTimeout(() => {
        primaryInputRef.current?.focus();
        primaryInputRef.current?.select();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [activeLineId]);

  function hasSheetInput(): boolean {
    if (activeMode === "case") {
      return (
        sheetCaseQty.trim() !== "" || sheetLooseUnits.trim() !== ""
      );
    }
    return sheetQty.trim() !== "";
  }

  function saveAndAdvance() {
    if (!activeLineId) return;
    const hasInput = hasSheetInput();

    const doAdvance = () => {
      if (nextLine) {
        openSheet(nextLine.id);
      } else {
        closeSheet();
        // Check if this location is now complete
        const locProgress = progressByLoc[selectedLocId ?? ""];
        const totalInLoc = locationLines.length;
        const countedInLoc = locationLines.filter(
          (l) => (l.qty || 0) > 0
        ).length;
        if (countedInLoc + 1 >= totalInLoc) {
          // Find next location with uncounted items
          const nextLoc = sessionLocations.find((loc) => {
            if (loc.id === selectedLocId) return false;
            const p = progressByLoc[loc.id];
            return p && p.counted < p.total;
          });
          if (nextLoc) {
            toast({
              title: `${storageLocations?.find((l) => l.id === selectedLocId)?.name ?? "Location"} complete`,
              description: `Moving to ${nextLoc.name}`,
            });
            setSelectedLocId(nextLoc.id);
          } else {
            toast({ title: "All items counted!" });
          }
        }
      }
    };

    if (!hasInput) {
      doAdvance();
      return;
    }

    if (activeMode === "case") {
      const cases = parseFloat(sheetCaseQty) || 0;
      const loose = parseFloat(sheetLooseUnits) || 0;
      const item = activeLine?.inventoryItem;
      const qty = cases * (item?.caseSize || 0) + loose;
      updateMutation.mutate(
        {
          id: activeLineId,
          qty,
          caseQty: cases,
          looseUnits: loose,
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
      } else {
        doAdvance();
      }
    } else {
      const qty = parseFloat(sheetQty) || 0;
      updateMutation.mutate(
        { id: activeLineId, qty, accumulate: false },
        { onSuccess: doAdvance }
      );
    }
  }

  function addEntry() {
    if (!activeLineId || !hasSheetInput()) return;

    if (activeMode === "case") {
      const cases = parseFloat(sheetCaseQty) || 0;
      const loose = parseFloat(sheetLooseUnits) || 0;
      const item = activeLine?.inventoryItem;
      const addQty = cases * (item?.caseSize || 0) + loose;
      updateMutation.mutate(
        { id: activeLineId, addQty, accumulate: true },
        {
          onSuccess: () => {
            setSheetCaseQty("");
            setSheetLooseUnits("");
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
        const itemLocId = matchedLine.inventoryItem?.storageLocationId || "unknown";
        if (itemLocId !== selectedLocId) {
          setSelectedLocId(itemLocId);
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
          .filter((l) => {
            const item = l.inventoryItem;
            if (!item) return false;
            // Fuzzy: pluSku contains barcode digits or barcode ends with pluSku
            if (item.pluSku && barcode.endsWith(item.pluSku.trim())) return true;
            // Surface items with no barcode set (staff may want to assign this one)
            if (!item.barcode) return true;
            return false;
          })
          .slice(0, 3)
          .map((l) => l.inventoryItem?.name as string)
          .filter(Boolean);

        setNoMatchSuggestions(candidates);
        setNoMatchBarcode(barcode);
      }
    },
    [countLines, selectedLocId, openSheet, toast]
  );

  const isReadOnly =
    count && (count.canEdit === false || count.applied === 1);

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
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Compact header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/inventory-sessions?embedded=true")}
          data-testid="button-mobile-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" data-testid="text-mobile-session-title">
            {count?.storeName ?? "Count Session"}
          </div>
          <div className="text-xs text-muted-foreground">
            {countedItems} / {totalItems} items counted
          </div>
        </div>
        {!isReadOnly && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowScanner(true)}
            className="shrink-0"
            data-testid="button-mobile-scan-barcode"
            title="Scan barcode"
          >
            <ScanBarcode className="h-5 w-5" />
          </Button>
        )}
        {isReadOnly ? (
          <Badge variant="outline" className="shrink-0 gap-1">
            <Lock className="h-3 w-3" />
            Locked
          </Badge>
        ) : allCounted ? (
          <Button
            size="sm"
            onClick={() => setShowApplyDialog(true)}
            disabled={applyMutation.isPending}
            className="shrink-0"
            data-testid="button-mobile-apply"
          >
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Apply
          </Button>
        ) : null}
      </div>

      {/* ── Location switcher ── */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 border-b scrollbar-none">
        {sessionLocations.map((loc) => {
          const prog = progressByLoc[loc.id] ?? { counted: 0, total: 0 };
          const done = prog.total > 0 && prog.counted === prog.total;
          const active = selectedLocId === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => setSelectedLocId(loc.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : done
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-mobile-location-${loc.id}`}
            >
              {done && !active && <CheckCircle2 className="h-3.5 w-3.5" />}
              <span className="font-medium">{loc.name}</span>
              <span className={`text-xs tabular-nums ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                {prog.counted}/{prog.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Cost summary bar ── */}
      {countedItems > 0 && (
        <div
          className="flex items-center justify-between px-4 py-1.5 bg-muted/40 border-b shrink-0"
          data-testid="cost-summary-bar"
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground" data-testid="text-location-cost">
              {sessionLocations.find((l) => l.id === selectedLocId)?.name ?? "Location"}:
            </span>
            <span className="font-mono font-semibold text-foreground tabular-nums" data-testid="value-location-cost">
              ${locationCostTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Session total:</span>
            <span className="font-mono font-semibold text-foreground tabular-nums" data-testid="value-session-cost">
              ${sessionCostTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* ── Item list ── */}
      <div className="flex-1 overflow-y-auto">
        {locationLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Package className="h-8 w-8" />
            <p className="text-sm">No items in this location</p>
          </div>
        ) : (
          <div className="divide-y">
            {locationLines.map((line) => {
              const item = line.inventoryItem;
              const cat = categoriesData?.find((c) => c.id === item?.categoryId);
              const loc = storageLocations?.find(
                (l) => l.id === line.storageLocationId
              );
              const mode = getCountMode(cat, loc);
              const unitAbbr =
                line.unitAbbreviation || item?.unitName || "unit";
              const isCounted = (line.qty || 0) > 0;
              const entryCount = line.entries?.length ?? 0;

              return (
                <button
                  key={line.id}
                  onClick={() => !isReadOnly && openSheet(line.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover-elevate ${
                    isReadOnly ? "cursor-default" : "cursor-pointer"
                  }`}
                  data-testid={`button-mobile-item-${line.id}`}
                >
                  {/* Counted indicator */}
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isCounted ? "bg-emerald-500" : "bg-border"
                    }`}
                  />
                  {/* Item info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium text-sm ${
                          isCounted ? "text-foreground" : "text-muted-foreground"
                        }`}
                        data-testid={`text-mobile-item-name-${line.id}`}
                      >
                        {item?.name ?? "Unknown"}
                      </span>
                      {mode === "catch" && (
                        <Scale className="h-3 w-3 text-amber-500 shrink-0" />
                      )}
                      {mode === "case" && (
                        <Package className="h-3 w-3 text-blue-500 shrink-0" />
                      )}
                    </div>
                    {isCounted && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {line.qty.toFixed(2)} {formatUnitName(unitAbbr)}
                        </span>
                        {entryCount > 1 && (
                          <span className="ml-1.5 text-muted-foreground/70">
                            · {entryCount} entries
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Unit + cost */}
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">{unitAbbr}</div>
                    {isCounted && (
                      <div className="text-xs font-mono font-medium">
                        ${(line.qty * (line.unitCost || 0)).toFixed(2)}
                      </div>
                    )}
                  </div>
                  {!isReadOnly && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Entry Sheet (bottom drawer) ── */}
      <Sheet
        open={!!activeLineId}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <SheetContent
          side="bottom"
          className="h-auto max-h-[88vh] flex flex-col rounded-t-xl px-0 pb-0"
        >
          {activeLine && activeItem && (
            <>
              <SheetHeader className="px-4 pb-2 shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-base font-semibold">
                    {activeItem.name}
                  </SheetTitle>
                  {activeMode === "catch" && (
                    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                      <Scale className="h-3 w-3" />
                      Catch Weight
                    </Badge>
                  )}
                  {activeMode === "case" && (
                    <Badge variant="outline" className="gap-1 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700">
                      <Package className="h-3 w-3" />
                      By Case
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{storageLocations?.find((l) => l.id === activeLine.storageLocationId)?.name ?? "Unknown"}</span>
                  <span>·</span>
                  <span>{activeUnitAbbr}</span>
                  {activeLine.unitCost > 0 && (
                    <>
                      <span>·</span>
                      <span>${(activeLine.unitCost || 0).toFixed(4)}/{activeUnitAbbr}</span>
                    </>
                  )}
                </div>
              </SheetHeader>

              <div className="overflow-y-auto flex-1 px-4 space-y-4 pb-2">
                {/* Entry history with delete */}
                {(activeLine.entries?.length ?? 0) > 0 && (
                  <MobileEntryList
                    entries={activeLine.entries}
                    isCatchWeight={activeMode === "catch"}
                    unitAbbr={activeUnitAbbr}
                    countId={countId}
                  />
                )}

                {/* Input section */}
                {!isReadOnly && (
                  <div className="space-y-3">
                    {activeMode === "case" ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Cases {activeItem?.caseSize ? `(× ${activeItem.caseSize} ${activeUnitAbbr})` : ""}
                          </label>
                          <Input
                            ref={primaryInputRef}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={sheetCaseQty}
                            onChange={(e) => setSheetCaseQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveAndAdvance();
                            }}
                            className="h-14 text-xl text-center font-mono"
                            data-testid="input-mobile-case-qty"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Loose {activeUnitAbbr}
                          </label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder="0"
                            value={sheetLooseUnits}
                            onChange={(e) => setSheetLooseUnits(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveAndAdvance();
                            }}
                            className="h-14 text-xl text-center font-mono"
                            data-testid="input-mobile-loose-units"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          {activeMode === "catch"
                            ? `Package weight (${activeUnitAbbr})`
                            : `Quantity (${activeUnitAbbr})`}
                        </label>
                        <Input
                          ref={primaryInputRef}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step={activeMode === "catch" ? "0.01" : "1"}
                          placeholder="0"
                          value={sheetQty}
                          onChange={(e) => setSheetQty(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (activeMode === "catch") {
                                addEntry();
                              } else {
                                saveAndAdvance();
                              }
                            }
                          }}
                          className="h-16 text-3xl text-center font-mono"
                          data-testid="input-mobile-qty"
                        />
                      </div>
                    )}

                    {/* Add Entry button — for catch weight this is the primary action */}
                    {(activeMode === "catch" || (activeLine.entries?.length ?? 0) > 0) && (
                      <Button
                        variant={activeMode === "catch" ? "default" : "outline"}
                        className="w-full"
                        onClick={addEntry}
                        disabled={updateMutation.isPending || !hasSheetInput()}
                        data-testid="button-mobile-add-entry"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {activeMode === "catch" ? "Add Package" : "Add Entry"}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer with primary action */}
              <div className="px-4 pt-2 pb-6 shrink-0 border-t bg-background space-y-2">
                {!isReadOnly && (activeLine?.entries?.length ?? 0) >= 2 && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={clearLineMutation.isPending}
                    data-testid="button-mobile-clear-all-entries"
                  >
                    Clear all entries
                  </Button>
                )}
                {!isReadOnly && (
                  <Button
                    className="w-full h-12 text-base font-semibold"
                    onClick={saveAndAdvance}
                    disabled={updateMutation.isPending}
                    data-testid="button-mobile-save-next"
                  >
                    {updateMutation.isPending
                      ? "Saving…"
                      : nextLine
                      ? activeMode === "catch" && !hasSheetInput()
                        ? "Next Item →"
                        : "Save & Next →"
                      : activeMode === "catch" && !hasSheetInput()
                      ? "Done"
                      : "Save & Done"}
                  </Button>
                )}
                {isReadOnly && (
                  <Button
                    variant="outline"
                    className="w-full h-12"
                    onClick={closeSheet}
                    data-testid="button-mobile-close-readonly"
                  >
                    Close
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Clear all entries confirmation dialog ── */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all entries and reset the count for this item to zero. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-mobile-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeLineId) clearLineMutation.mutate(activeLineId);
              }}
              disabled={clearLineMutation.isPending}
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
    </div>
  );
}
