import { useState, Fragment, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
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
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MapPin,
  Package,
  Truck,
  Database,
  Info,
  ChevronDown,
  ChevronLeft,
  Link2,
  ShieldAlert,
  PlusCircle,
  HelpCircle,
  AlertCircle,
  Undo2
} from "lucide-react";
import {
  rowConfidenceKey,
  uniqueCategories as computeUniqueCategories,
  applyFilters,
  toggleSetValue,
} from "@/lib/orderlyImportFilterUtils";
import { formatDate } from "@/lib/orderlyImportUtils";

// Import types from orderly-import.tsx (we exported them earlier)
import type { 
  RowPreview, 
  ApprovalResult, 
  DuplicateDateWarning, 
  ResolutionPreview, 
  CandidateDetail,
  MatchResult,
  PackEvidence,
} from "@/pages/orderly-import";

type RecodeDecision = {
  action: "link_existing";
  inventoryItemId: string;
} | {
  action: "create_variant";
  comparableInventoryItemId: string;
};
type DecisionValue = string | null | RecodeDecision;

function isRecodeDecision(value: DecisionValue | undefined): value is RecodeDecision {
  return typeof value === "object" && value !== null && "action" in value;
}

// Helper components for UI

function MatchStatusBadge({ confidence, strategy, possibleRecode }: { confidence: string, strategy: string, possibleRecode?: boolean }) {
  if (possibleRecode) return <Badge className="bg-amber-50 text-amber-700 border-amber-200 shadow-none font-medium">Re-code?</Badge>;
  if (confidence === "high") return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 shadow-none font-medium">Matched</Badge>;
  if (confidence === "medium") return <Badge className="bg-blue-50 text-blue-700 border-blue-200 shadow-none font-medium">Likely</Badge>;
  if (confidence === "low") return <Badge className="bg-orange-50 text-orange-700 border-orange-200 shadow-none font-medium">Fuzzy</Badge>;
  if (confidence === "ambiguous") return <Badge className="bg-red-50 text-red-700 border-red-200 shadow-none font-medium">Ambiguous</Badge>;
  if (strategy === "none") return <Badge className="bg-slate-100 text-slate-700 border-slate-200 shadow-none font-medium">New</Badge>;
  return <Badge variant="outline" className="shadow-none font-medium">{confidence}</Badge>;
}

function StrategyLabel({ strategy, possibleRecode = false }: { strategy: string; possibleRecode?: boolean }) {
  if (possibleRecode) return <span className="text-muted-foreground">Same name, new code</span>;
  const map: Record<string, string> = {
    external_mapping: "Prior mapping",
    item_code: "Item code",
    name_pack: "Name match",
    fuzzy: "Fuzzy",
    none: "—",
  };
  return <span className="text-muted-foreground">{map[strategy] ?? strategy}</span>;
}

type PackGeometry = Pick<PackEvidence, "caseQuantity" | "innerPackQuantity" | "baseUnitQuantity" | "baseUnit">;

function formatPackGeometry(pack: PackGeometry | null | undefined): string {
  if (!pack) return "Not confirmed";
  const caseQuantity = pack.caseQuantity && pack.caseQuantity > 0 ? pack.caseQuantity : null;
  const innerPackQuantity = pack.innerPackQuantity && pack.innerPackQuantity > 0 ? pack.innerPackQuantity : null;
  const baseUnitQuantity = pack.baseUnitQuantity && pack.baseUnitQuantity > 0 ? pack.baseUnitQuantity : null;
  const baseUnit = pack.baseUnit?.trim() || null;

  if (baseUnitQuantity != null && baseUnit) {
    const parts = caseQuantity != null ? [String(caseQuantity)] : [];
    if (innerPackQuantity != null && innerPackQuantity !== 1) parts.push(String(innerPackQuantity));
    parts.push(`${baseUnitQuantity} ${baseUnit}`);
    return parts.join(" × ");
  }
  if (caseQuantity != null) return `${caseQuantity} count (unit detail unavailable)`;
  return "Not confirmed";
}

function packDecisionCopy(status: MatchResult["packCompatibility"]): string {
  if (status === "compatible") return "Same physical pack — you may link this new code to the existing item.";
  if (status === "incompatible") return "Different physical pack — linking is blocked. Create a separate variant instead.";
  return "Pack evidence is incomplete — do not assume these are the same product; create a separate variant unless you can verify it.";
}

function PackComparison({
  source,
  candidate,
  status,
  reason,
  compact = false,
}: {
  source: PackGeometry;
  candidate: PackEvidence | null | undefined;
  status: MatchResult["packCompatibility"];
  reason?: string | null;
  compact?: boolean;
}) {
  const tone = status === "compatible"
    ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
    : status === "incompatible"
      ? "border-red-200 bg-red-50/70 text-red-900"
      : "border-slate-200 bg-slate-50 text-slate-800";
  const label = status === "compatible" ? "Same pack" : status === "incompatible" ? "Different pack" : "Pack unknown";

  if (compact) {
    return (
      <div className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <Badge
          variant="outline"
          className={`mr-1 h-4 px-1 text-[9px] leading-none ${
            status === "compatible"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : status === "incompatible"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-slate-300 bg-slate-50 text-slate-700"
          }`}
        >
          {label}
        </Badge>
        <span className="font-medium text-foreground">Pack check:</span>{" "}
        {formatPackGeometry(source)} <span aria-hidden="true">→</span> {formatPackGeometry(candidate)}
      </div>
    );
  }

  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold">Pack comparison</span>
        <Badge variant="outline" className="bg-background/70 border-current text-[10px]">{label}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide opacity-70">Incoming Orderly row</div>
          <div className="font-semibold text-sm">{formatPackGeometry(source)}</div>
        </div>
        <span className="hidden sm:block text-muted-foreground" aria-hidden="true">→</span>
        <div>
          <div className="text-[10px] uppercase tracking-wide opacity-70">Existing catalog evidence</div>
          <div className="font-semibold text-sm">{formatPackGeometry(candidate)}</div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed">{packDecisionCopy(status)}</p>
      {reason && <p className="mt-1 text-[11px] leading-relaxed opacity-80">Why: {reason}</p>}
    </div>
  );
}

// ─── Candidate picker (for ambiguous / likely / possibleRecode rows) ───

function CandidatePicker({
  row,
  decision,
  hasOverride,
  onDecision,
}: {
  row: RowPreview;
  decision: DecisionValue | undefined;
  hasOverride: boolean;
  onDecision: (rowIndex: number, value: DecisionValue | undefined) => void;
}) {
  const match = row.itemMatch;
  const { confidence, candidates = [], matchedItem, possibleRecode, possibleRecodeItem, packCompatibility, packCompatibilityReason, candidatePackEvidence } = match;

  function ItemChip({ item, selected, onClick, disabled = false, badge }: { item: CandidateDetail; selected: boolean; onClick: () => void; disabled?: boolean; badge?: React.ReactNode }) {
    return (
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={`flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors w-full ${
          selected
            ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
            : disabled 
              ? "border-border bg-muted/30 text-muted-foreground opacity-75 cursor-not-allowed"
              : "border-border bg-card hover:bg-accent/50 text-foreground"
        }`}
      >
        <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
          {selected && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className={`font-semibold truncate ${selected ? "text-primary" : ""}`}>{item.name}</div>
            {badge && <div>{badge}</div>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.caseSize != null && <span>Pack: <span className="font-medium text-foreground">{item.caseSize}</span></span>}
            {item.pluSku && <span>SKU: <span className="font-medium text-foreground">{item.pluSku}</span></span>}
          </div>
          {item.knownLocations && item.knownLocations.length > 0 && (
            <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {item.knownLocations.slice(0, 3).join(" · ")}
              {item.knownLocations.length > 3 && ` +${item.knownLocations.length - 3}`}
            </div>
          )}
        </div>
      </button>
    );
  }

  // Handle Possible Recode
  if (possibleRecode && possibleRecodeItem) {
    const recodeDecision = isRecodeDecision(decision) ? decision : undefined;
    const isLink = recodeDecision?.action === "link_existing";
    const isCreateNew = recodeDecision?.action === "create_variant";
    const targetId = match.possibleRecodeMatchedId ?? possibleRecodeItem.id;
    
    const isCompatible = packCompatibility === 'compatible';
    const isIncompatible = packCompatibility === 'incompatible';
    const isUnknown = packCompatibility === 'unknown';

    return (
      <div className="px-4 py-4 space-y-4 bg-muted/20 border-t border-border">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-foreground">Possible Item Re-code Detected</h4>
            <p className="text-xs text-muted-foreground mt-1">
              This row has a new item code, but its name matches an existing catalog item. 
              Review pack size compatibility below to decide if they are the same product.
            </p>
          </div>
        </div>

        <PackComparison
          source={row}
          candidate={candidatePackEvidence}
          status={packCompatibility}
          reason={packCompatibilityReason}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ItemChip
            item={possibleRecodeItem}
            selected={isLink === true}
            disabled={isIncompatible}
            onClick={() => onDecision(
              row.rowIndex,
              isLink ? undefined : { action: "link_existing", inventoryItemId: targetId },
            )}
            badge={
              isCompatible ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Compatible</Badge> :
              isIncompatible ? <Badge className="bg-red-100 text-red-800 border-red-200">Incompatible</Badge> :
              isUnknown ? <Badge className="bg-slate-200 text-slate-800 border-slate-300">Unknown</Badge> : null
            }
          />
          <button
            onClick={() => onDecision(
              row.rowIndex,
              isCreateNew ? undefined : { action: "create_variant", comparableInventoryItemId: targetId },
            )}
            className={`flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors ${
              isCreateNew
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-accent/50 text-foreground"
            }`}
          >
            <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isCreateNew ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
               {isCreateNew && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
            </div>
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <PlusCircle className="h-4 w-4 text-muted-foreground" />
                Create as separate variant
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Establish a new item record. Do this if the pack size or product fundamentally changed.
              </p>
            </div>
          </button>
        </div>

      </div>
    );
  }

  // Handle Ambiguous
  if (confidence === "ambiguous") {
    const resolvedId = hasOverride && !isRecodeDecision(decision) ? decision : undefined;
    return (
      <div className="px-4 py-4 space-y-3 bg-muted/20 border-t border-border">
        <p className="text-sm font-medium text-foreground">
          {candidates.length} items matched — pick one to link, or create a new item:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {candidates.map(c => (
            <ItemChip
              key={c.id}
              item={c}
              selected={resolvedId === c.id}
              onClick={() => onDecision(row.rowIndex, resolvedId === c.id ? undefined : c.id)}
            />
          ))}
          <button
            onClick={() => onDecision(row.rowIndex, resolvedId === null ? undefined : null)}
            className={`flex items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
              resolvedId === null
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-accent/50 text-foreground"
            }`}
          >
            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${resolvedId === null ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
               {resolvedId === null && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
            </div>
            <span className="font-medium">Create new item record</span>
          </button>
        </div>
        {!hasOverride && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
             <Info className="h-3.5 w-3.5" /> No selection will result in a new item upon approval.
          </p>
        )}
      </div>
    );
  }

  // Handle Medium/Low confidence
  if (confidence === "medium" || confidence === "low") {
    const item = matchedItem;
    if (!item) return null;
    const isCreateNew = hasOverride && !isRecodeDecision(decision) && decision === null;
    return (
      <div className="px-4 py-4 space-y-3 bg-muted/20 border-t border-border">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Auto-matched by {confidence === "medium" ? "name similarity" : "fuzzy match"}. Confirm or override:
          </p>
        </div>
        <div className="flex flex-col md:flex-row items-start gap-3">
          <div className="flex-1 w-full">
            <ItemChip
              item={item}
              selected={!isCreateNew}
              onClick={() => onDecision(row.rowIndex, undefined)}
            />
          </div>
          <button
            onClick={() => onDecision(row.rowIndex, isCreateNew ? undefined : null)}
            className={`shrink-0 w-full md:w-auto rounded-md border px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              isCreateNew
                ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-accent/50 text-foreground"
            }`}
          >
            {isCreateNew ? <><Undo2 className="h-4 w-4" /> Revert to matched</> : <><PlusCircle className="h-4 w-4" /> Create new instead</>}
          </button>
        </div>
        {row.caseQuantity != null && item.caseSize != null && Math.abs(row.caseQuantity - item.caseSize) > 0.01 && (
          <div className="text-xs text-amber-700 bg-amber-50/50 border border-amber-200 rounded px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Pack size differs: import has <strong>{row.caseQuantity}</strong>, catalog item has <strong>{item.caseSize}</strong></span>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Step: Resolution preview ─────────────────────────────────────────────────

export function ResolutionPreviewStep({
  batchId,
  onApproved,
  onBack,
}: {
  batchId: string;
  onApproved: (result: ApprovalResult) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [approving, setApproving] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedConfidences, setSelectedConfidences] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [rowDecisions, setRowDecisions] = useState<Map<number, DecisionValue>>(() => new Map());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [duplicateDialogWarning, setDuplicateDialogWarning] = useState<DuplicateDateWarning | null>(null);
  const [legacyApprovalStores, setLegacyApprovalStores] = useState<{ id: string; name: string }[] | null>(null);
  const [legacyApprovalStoreId, setLegacyApprovalStoreId] = useState<string>("");
  const [noticesCollapsed, setNoticesCollapsed] = useState(false);

  const PAGE_SIZE = 100;

  function toggleCategory(cat: string) {
    setSelectedCategories(prev => toggleSetValue(prev, cat));
    setCurrentPage(0);
  }

  function toggleConfidence(conf: string) {
    setSelectedConfidences(prev => toggleSetValue(prev, conf));
    setCurrentPage(0);
  }

  const { data: preview, isLoading, isError } = useQuery<ResolutionPreview>({
    queryKey: [`/api/inventory-import/orderly/batches/${batchId}/resolution-preview`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-import/orderly/batches/${batchId}/resolution-preview`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to load preview");
      }
      return res.json();
    },
  });

  function toggleExpand(rowIndex: number) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function setDecision(rowIndex: number, value: DecisionValue | undefined) {
    setRowDecisions(prev => {
      const next = new Map(prev);
      if (value === undefined) next.delete(rowIndex);
      else next.set(rowIndex, value);
      return next;
    });
  }

  async function submitApproval(force = false) {
    setApproving(true);
    try {
      const decisions = Array.from(rowDecisions.entries()).map(([rowIndex, decision]) => (
        isRecodeDecision(decision)
          ? { rowIndex, ...decision }
          : { rowIndex, inventoryItemId: decision }
      ));
      const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          rowDecisions: decisions,
          ...(force ? { force: true } : {}),
          ...(legacyApprovalStoreId ? { storeId: legacyApprovalStoreId } : {}),
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        if (res.status === 409 && body.duplicateDateWarning) {
          setDuplicateDialogWarning(body.duplicateDateWarning);
          return;
        }
        if (res.status === 400 && body.requiresStoreSelection && body.stores) {
          setLegacyApprovalStores(body.stores);
          toast({
            title: "Select a store to continue",
            description: "This import was created before store selection was required. Choose a store below to approve.",
          });
          return;
        }
        throw new Error(body.error ?? "Approval failed");
      }

      const result: ApprovalResult = body;
      qc.invalidateQueries({ queryKey: ["/api/inventory-import/orderly/batches"] });
      qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
      onApproved(result);
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 min-h-[50vh] text-center">
        <RefreshCw className="h-8 w-8 mb-4 text-primary animate-spin" />
        <h3 className="text-lg font-medium text-foreground">Analyzing Import Data</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Matching entities, checking pack sizes, and analyzing historical locations to provide the most accurate resolution.
        </p>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <Alert variant="destructive" className="mt-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load resolution preview. Please try again or contact support if the issue persists.</AlertDescription>
      </Alert>
    );
  }

  const s = preview.summary;
  const matchPct = s.totalRows > 0 ? Math.round(((s.itemsMatchedHigh + s.itemsMatchedMedium) / s.totalRows) * 100) : 0;
  const resolvedRecodeCodes = new Set(
    preview.rows
      .filter(row => {
        const decision = rowDecisions.get(row.rowIndex);
        return row.itemMatch.possibleRecode && row.sourceItemCode && isRecodeDecision(decision);
      })
      .map(row => row.sourceItemCode!.trim()),
  );
  const pendingRecodeCodes = Array.from(new Set(
    preview.rows
      .filter(row => row.itemMatch.possibleRecode && row.sourceItemCode)
      .map(row => row.sourceItemCode!.trim()),
  )).filter(code => !resolvedRecodeCodes.has(code));
  const hasPendingRecodeDecisions = pendingRecodeCodes.length > 0;
  const approvalDisabled = approving || hasPendingRecodeDecisions || (legacyApprovalStores !== null && !legacyApprovalStoreId);

  return (
    <div className="space-y-6 pb-24 animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      {/* Duplicate-date confirmation dialog */}
      <AlertDialog
        open={duplicateDialogWarning !== null}
        onOpenChange={(open) => { if (!open) setDuplicateDialogWarning(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Duplicate Import Warning
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  An import for <strong className="text-foreground">{formatDate(duplicateDialogWarning?.inventoryDate ?? null)}</strong> was
                  already approved{duplicateDialogWarning?.approvedAt ? <> on <strong className="text-foreground">{formatDate(duplicateDialogWarning.approvedAt)}</strong></> : ""}.
                </p>
                <p>
                  Approving again will create <strong className="text-foreground">duplicate items</strong>. Are you sure you want to continue?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDuplicateDialogWarning(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { setDuplicateDialogWarning(null); submitApproval(true); }}>
              Approve Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack} className="h-8 shadow-sm">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Resolution Preview</h2>
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>{s.totalRows.toLocaleString()} total rows</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>Inventory Date: <span className="text-foreground">{formatDate(preview.inventoryDate)}</span></span>
            </div>
          </div>
        </div>
        <Button onClick={() => submitApproval(false)} disabled={approvalDisabled} size="lg" className="shadow-sm">
          {approving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          {approving ? "Approving Batch..." : "Approve Import"}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm border-border/60">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold text-foreground">Matched Items</span>
            </div>
            <div className="text-3xl font-bold text-foreground">{s.itemsMatchedUnique.toLocaleString()}</div>
            <div className="text-xs font-medium text-muted-foreground mt-1">
              {s.rowsMatchedSafe.toLocaleString()} of {s.totalRows.toLocaleString()} rows safe ({matchPct}%)
            </div>
            <Progress value={matchPct} className="mt-3 h-1.5 [&>div]:bg-emerald-500" />
          </CardContent>
        </Card>
        
        <Card className="shadow-sm border-border/60">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-sky-50 text-sky-600">
                <Package className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold text-foreground">New Items</span>
            </div>
            <div className="text-3xl font-bold text-foreground">{s.itemsWillCreate.toLocaleString()}</div>
            <div className="text-xs font-medium text-muted-foreground mt-1">
              Will be created
              {s.itemsHeldForReview > 0 && <span className="text-amber-600 ml-1">({s.itemsHeldForReview.toLocaleString()} held for review)</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/60">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-purple-50 text-purple-600">
                <Truck className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold text-foreground">Vendors</span>
            </div>
            <div className="text-3xl font-bold text-foreground">{s.vendorsMatched + s.vendorsNew}</div>
            <div className="text-xs font-medium text-muted-foreground mt-1 flex gap-2">
              <span>{s.vendorsNew} <span className="text-foreground">New</span></span>
              <span>{s.vendorsMatched} <span className="text-foreground">Existing</span></span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/60">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-blue-50 text-blue-600">
                <MapPin className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold text-foreground">Locations</span>
            </div>
            <div className="text-3xl font-bold text-foreground">{s.locationsMatched + s.locationsNew}</div>
            <div className="text-xs font-medium text-muted-foreground mt-1 flex gap-2">
              <span>{s.locationsNew} <span className="text-foreground">New</span></span>
              <span>{s.locationsMatched} <span className="text-foreground">Existing</span></span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notices */}
      {(() => {
        const noticeCount =
          (s.itemsResolvedByLocationHistory > 0 ? 1 : 0) +
          (s.itemsAmbiguous > 0 ? 1 : 0) +
          (s.rowsRequiringReview > 0 ? 1 : 0) +
          (preview.newLocations.length > 0 ? 1 : 0) +
          (preview.newVendors.length > 0 ? 1 : 0) +
          (s.itemsRecode > 0 ? 1 : 0);
        if (noticeCount === 0) return null;
        const warningCount = (s.itemsAmbiguous > 0 ? 1 : 0) + (s.rowsRequiringReview > 0 ? 1 : 0) + (s.itemsRecode > 0 ? 1 : 0);
        
        return (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all">
            <button
              type="button"
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
              onClick={() => setNoticesCollapsed(prev => !prev)}
              aria-expanded={!noticesCollapsed}
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-full ${warningCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                  {warningCount > 0 ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                </div>
                <span className="font-semibold text-sm">
                  {noticeCount} Insight{noticeCount > 1 ? "s" : ""} & Notice{noticeCount > 1 ? "s" : ""}
                </span>
                {noticesCollapsed && (
                  <span className="hidden md:inline-block text-sm text-muted-foreground ml-2">
                    {[
                      s.itemsRecode > 0 ? `${s.itemsRecode} possible re-code${s.itemsRecode > 1 ? "s" : ""}` : null,
                      s.itemsAmbiguous > 0 ? `${s.itemsAmbiguous} ambiguous` : null,
                      s.rowsRequiringReview > 0 ? `${s.rowsRequiringReview} fuzzy` : null,
                      preview.newLocations.length > 0 ? `${preview.newLocations.length} new location${preview.newLocations.length > 1 ? "s" : ""}` : null,
                      preview.newVendors.length > 0 ? `${preview.newVendors.length} new vendor${preview.newVendors.length > 1 ? "s" : ""}` : null,
                      s.itemsResolvedByLocationHistory > 0 ? `${s.itemsResolvedByLocationHistory} auto-resolved` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${noticesCollapsed ? "" : "rotate-180"}`} />
            </button>
            
            <div className={`grid gap-3 px-5 transition-all duration-300 origin-top ${noticesCollapsed ? "grid-rows-[0fr] opacity-0 py-0" : "grid-rows-[1fr] opacity-100 pb-5 pt-2"}`}>
              <div className="overflow-hidden space-y-3">
                {/* Location-history auto-resolution callout */}
                {s.itemsResolvedByLocationHistory > 0 && (
                  <Alert className="border-sky-200 bg-sky-50 shadow-none">
                    <Database className="h-4 w-4 text-sky-600" />
                    <AlertTitle className="text-sky-800 font-semibold">Auto-resolved by History</AlertTitle>
                    <AlertDescription className="text-sky-700">
                      <strong>{s.itemsResolvedByLocationHistory} {s.itemsResolvedByLocationHistory === 1 ? "row" : "rows"}</strong> were resolved automatically because the system recognized which item was previously counted at this location.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Possible re-code warning */}
                {s.itemsRecode > 0 && (
                  <Alert className="border-amber-200 bg-amber-50 shadow-none">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-800 font-semibold">Possible Re-codes Detected</AlertTitle>
                    <AlertDescription className="text-amber-700">
                      <strong>{s.itemsRecode} {s.itemsRecode === 1 ? "row has" : "rows have"}</strong> a new item code but the name perfectly matches an existing catalog item. 
                      Use the <Badge variant="outline" className="bg-white px-1 py-0 shadow-sm text-[10px] mx-1">Re-code?</Badge> filter below to review and verify pack sizes to avoid creating duplicates.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Ambiguous */}
                  {s.itemsAmbiguous > 0 && (
                    <div className="rounded-md border p-3.5 bg-muted/20">
                      <div className="flex items-center gap-2 font-semibold text-sm mb-1.5 text-foreground">
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                        {s.itemsAmbiguous} Ambiguous Rows
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Matched multiple existing items and cannot be auto-linked. 
                        New items will be created unless manually linked.
                      </p>
                    </div>
                  )}

                  {/* Fuzzy */}
                  {s.rowsRequiringReview > 0 && (
                    <div className="rounded-md border p-3.5 bg-muted/20">
                      <div className="flex items-center gap-2 font-semibold text-sm mb-1.5 text-foreground">
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        {s.rowsRequiringReview} Fuzzy Matches
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Matched by fuzzy name similarity. 
                        New items will be created to avoid incorrect permanent links unless confirmed.
                      </p>
                    </div>
                  )}

                  {/* New locations */}
                  {preview.newLocations.length > 0 && (
                    <div className="rounded-md border p-3.5 bg-muted/20">
                      <div className="flex items-center gap-2 font-semibold text-sm mb-2 text-foreground">
                        <MapPin className="h-4 w-4 text-blue-500" />
                        {preview.newLocations.length} New Locations
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.newLocations.map(l => (
                          <Badge key={l} variant="secondary" className="text-[10px] font-medium bg-background border shadow-sm">{l}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* New vendors */}
                  {preview.newVendors.length > 0 && (
                    <div className="rounded-md border p-3.5 bg-muted/20">
                      <div className="flex items-center gap-2 font-semibold text-sm mb-2 text-foreground">
                        <Truck className="h-4 w-4 text-purple-500" />
                        {preview.newVendors.length} New Vendors
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.newVendors.map(v => (
                          <Badge key={v} variant="secondary" className="text-[10px] font-medium bg-background border shadow-sm">{v}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Row table */}
      <div className="space-y-4">
        {(() => {
          const uniqueCategories = computeUniqueCategories(preview.rows);

          const confidenceLevels: { key: string; label: string }[] = [
            { key: "recode",    label: "Re-code?"  },
            { key: "high",      label: "Matched"   },
            { key: "medium",    label: "Likely"    },
            { key: "low",       label: "Fuzzy"     },
            { key: "ambiguous", label: "Ambiguous" },
            { key: "new",       label: "New"       },
          ].filter(({ key }) => preview.rows.some(r => rowConfidenceKey(r) === key));

          const filteredRows = applyFilters(preview.rows, selectedCategories, selectedConfidences);

          const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);
          const safePage = Math.min(currentPage, Math.max(0, totalPages - 1));
          const displayRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
          const isFiltered = selectedCategories.size > 0 || selectedConfidences.size > 0;
          const firstRow = filteredRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
          const lastRow = Math.min((safePage + 1) * PAGE_SIZE, filteredRows.length);

          return (
            <div className="bg-card border rounded-lg shadow-sm">
              <div className="p-4 border-b space-y-4 bg-muted/10">
                <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
                  <div className="space-y-3">
                    {/* Category filter */}
                    {uniqueCategories.length > 0 && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground w-20 shrink-0">Category</span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => { setSelectedCategories(new Set()); setCurrentPage(0); }}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
                              selectedCategories.size === 0
                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                            }`}
                          >
                            All Categories
                          </button>
                          {uniqueCategories.map(cat => (
                            <button
                              key={cat}
                              onClick={() => toggleCategory(cat)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
                                selectedCategories.has(cat)
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Confidence filter */}
                    {confidenceLevels.length > 0 && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground w-20 shrink-0">Status</span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => { setSelectedConfidences(new Set()); setCurrentPage(0); }}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
                              selectedConfidences.size === 0
                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                            }`}
                          >
                            All Statuses
                          </button>
                          {confidenceLevels.map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => toggleConfidence(key)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
                                selectedConfidences.has(key)
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground text-right shrink-0">
                    {filteredRows.length === 0
                      ? "No matching rows"
                      : isFiltered
                        ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${filteredRows.length.toLocaleString()} matching`
                        : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${s.totalRows.toLocaleString()}`
                    }
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-10 text-center px-1 border-r"></TableHead>
                      <TableHead className="w-12 border-r text-center font-semibold text-xs">#</TableHead>
                      <TableHead className="font-semibold text-xs min-w-[200px]">Description</TableHead>
                      <TableHead className="font-semibold text-xs min-w-[130px]">Pack size</TableHead>
                      <TableHead className="font-semibold text-xs">Location</TableHead>
                      <TableHead className="font-semibold text-xs">Vendor</TableHead>
                      <TableHead className="font-semibold text-xs">Category</TableHead>
                      <TableHead className="font-semibold text-xs min-w-[150px]">Resolution</TableHead>
                      <TableHead className="font-semibold text-xs">Match Logic</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <Info className="h-8 w-8 mb-2 opacity-20" />
                            <p className="text-sm font-medium">No rows match the selected filters.</p>
                            <Button variant="ghost" size="sm" onClick={() => { setSelectedCategories(new Set()); setSelectedConfidences(new Set()); }}>
                              Clear filters
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayRows.map((row) => {
                        const needsReview = row.itemMatch.requiresReview || row.itemMatch.possibleRecode;
                        const isExpanded = expandedRows.has(row.rowIndex);
                        const decision = rowDecisions.get(row.rowIndex);
                        const hasOverride = rowDecisions.has(row.rowIndex);
                        
                        return (
                          <Fragment key={row.rowIndex}>
                            <TableRow
                              className={`transition-colors ${needsReview ? "cursor-pointer hover:bg-accent/50 group" : ""} ${isExpanded ? "bg-accent/30" : ""}`}
                              onClick={needsReview ? () => toggleExpand(row.rowIndex) : undefined}
                            >
                              <TableCell className="w-10 px-0 text-center border-r">
                                {needsReview && (
                                  <div className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md transition-colors ${isExpanded ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:bg-muted-foreground/20'}`}>
                                    <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-xs font-medium text-muted-foreground border-r bg-muted/5">
                                {row.rowIndex}
                              </TableCell>
                              <TableCell className="text-sm font-medium">
                                {row.cleanedDescription || <span className="text-muted-foreground/50 italic font-normal">blank</span>}
                                {row.sourceItemCode && (
                                  <div className="text-[10px] text-muted-foreground font-normal mt-0.5 font-mono">
                                    {row.sourceItemCode}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="font-medium text-foreground">
                                  {row.packSizeRaw || <span className="text-muted-foreground italic font-normal">Not provided</span>}
                                </div>
                                <div className={`mt-1 text-[10px] ${
                                  row.packParseStatus === "ok"
                                    ? "text-emerald-700"
                                    : row.packParseStatus === "partial"
                                      ? "text-amber-700"
                                      : "text-muted-foreground"
                                }`}>
                                  {row.packParseStatus === "ok"
                                    ? "Parsed"
                                    : row.packParseStatus === "partial"
                                      ? "Partial parse — verify"
                                      : "Needs review"}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.storageLocation || "—"}
                                {row.locationMatch.isNew && (
                                  <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0 h-4 bg-blue-50 text-blue-700 border-blue-200 shadow-none uppercase tracking-wider">New</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.supplierRaw || "—"}
                                {row.vendorMatch.isNew && row.supplierRaw && (
                                  <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0 h-4 bg-purple-50 text-purple-700 border-purple-200 shadow-none uppercase tracking-wider">New</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.sourceCategory || "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col items-start gap-1.5">
                                  <MatchStatusBadge confidence={row.itemMatch.confidence} strategy={row.itemMatch.strategy} possibleRecode={row.itemMatch.possibleRecode} />
                                  
                                  {hasOverride && (
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-background text-foreground shadow-sm">
                                         {isRecodeDecision(decision)
                                           ? decision.action === "create_variant" ? "→ Separate Variant" : "→ Link Existing"
                                           : decision === null ? "→ Create New" : "→ Link Existing"}
                                      </Badge>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setDecision(row.rowIndex, undefined); }}
                                        className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2 transition-colors"
                                      >
                                        Undo
                                      </button>
                                    </div>
                                  )}
                                  
                                  {!hasOverride && row.itemMatch.possibleRecode && row.itemMatch.possibleRecodeItem && (
                                     <span className="text-[10px] font-medium text-amber-600 flex items-center gap-1">
                                       <AlertCircle className="h-3 w-3" />
                                       Action Required
                                     </span>
                                  )}
                                  {row.itemMatch.possibleRecode && (
                                    <PackComparison
                                      source={row}
                                      candidate={row.itemMatch.candidatePackEvidence}
                                      status={row.itemMatch.packCompatibility}
                                      compact
                                    />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <StrategyLabel strategy={row.itemMatch.strategy} possibleRecode={row.itemMatch.possibleRecode} />
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/5 hover:bg-muted/5 border-b">
                                <TableCell colSpan={9} className="p-0">
                                  <CandidatePicker
                                    row={row}
                                    decision={decision}
                                    hasOverride={hasOverride}
                                    onDecision={setDecision}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="p-3 flex items-center justify-between border-t bg-muted/10">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="h-8 text-xs font-medium"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                  </Button>
                  <span className="text-xs font-medium text-muted-foreground">
                    Page {safePage + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="h-8 text-xs font-medium"
                  >
                    Next <ChevronLeft className="h-3.5 w-3.5 ml-1 rotate-180" />
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Legacy store picker */}
      {legacyApprovalStores && (
        <Alert className="border-amber-200 bg-amber-50 shadow-sm mt-6">
          <Info className="h-5 w-5 text-amber-600" />
          <AlertTitle className="text-amber-800 font-semibold">Store Selection Required</AlertTitle>
          <AlertDescription className="text-amber-800 mt-2">
            <p className="mb-3 text-sm">This import was created before store selection was required. Choose a store to link the approved items to:</p>
            <Select value={legacyApprovalStoreId} onValueChange={setLegacyApprovalStoreId}>
              <SelectTrigger className="max-w-xs bg-background border-amber-300">
                <SelectValue placeholder="Select a store…" />
              </SelectTrigger>
              <SelectContent>
                {legacyApprovalStores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AlertDescription>
        </Alert>
      )}

      {/* Footer sticky action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20 md:left-[var(--sidebar-width)] md:data-[state=collapsed]:left-[var(--sidebar-width-icon)] transition-[left]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground hidden md:block">
            {hasPendingRecodeDecisions
              ? `${pendingRecodeCodes.length} re-code ${pendingRecodeCodes.length === 1 ? "decision" : "decisions"} still required.`
              : `You are approving ${s.totalRows.toLocaleString()} rows for ingestion.`}
          </div>
          <Button
            size="lg"
            onClick={() => submitApproval(false)}
            disabled={approvalDisabled}
            className="w-full md:w-auto shadow-md"
          >
            {approving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {approving ? "Approving Batch..." : `Approve ${s.totalRows.toLocaleString()} Rows`}
          </Button>
        </div>
      </div>
    </div>
  );
}
