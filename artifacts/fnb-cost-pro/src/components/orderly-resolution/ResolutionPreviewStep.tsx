import { useState, Fragment, useMemo, useEffect, useRef } from "react";
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
  Undo2,
  Download,
  Upload,
} from "lucide-react";
import {
  rowConfidenceKey,
  uniqueCategories as computeUniqueCategories,
  applyFilters,
  toggleSetValue,
  buildBulkCompatiblePackDecisions,
  buildBulkNewPackSizeDecisions,
  getBulkCompatiblePackReview,
  getBulkNewPackSizeReview,
  getPendingRecodeCodes,
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
  action: "link_vendor_pack";
  inventoryItemId: string;
} | {
  action: "create_variant";
  comparableInventoryItemId: string;
};
type DecisionValue = string | null | RecodeDecision;
type StoredDecisionPayload = RecodeDecision | { inventoryItemId: string | null };

type ApprovalJob = {
  jobId: string;
  batchId: string;
  status: "running" | "timed_out" | "failed" | "completed";
  phase: string;
  progressPercent: number;
  attemptCount: number;
  startedAt: string;
  updatedAt: string;
  timeoutAt: string;
  completedAt: string | null;
  timeoutBudgetMs: number;
  result: ApprovalResult | null;
  error: { code: string | null; message: string } | null;
};
type SavedReviewDecision = {
  rowIndex: number;
  decision: StoredDecisionPayload;
  revision: number;
  decidedBy: string | null;
  updatedAt: string | null;
};

type ReviewDecisionResponse = {
  decisions: SavedReviewDecision[];
};

type ReviewDecisionChange = {
  rowIndex: number;
  expectedRevision: number | null;
  decision?: StoredDecisionPayload;
};

type DecisionManifestImportResult = {
  status: "accepted" | "rejected" | "stale";
  accepted: Array<{ rowIndex: number }>;
  rejected: Array<{ rowIndex: number; reason: string }>;
  stale: Array<{ rowIndex: number; reason: string }>;
  decisions: SavedReviewDecision[];
};

function isRecodeDecision(value: DecisionValue | undefined): value is RecodeDecision {
  return typeof value === "object" && value !== null && "action" in value;
}

function toStoredDecisionPayload(value: DecisionValue): StoredDecisionPayload {
  return isRecodeDecision(value) ? value : { inventoryItemId: value };
}

function fromStoredDecisionPayload(value: StoredDecisionPayload): DecisionValue {
  return "action" in value ? value : value.inventoryItemId;
}

// Helper components for UI

function recodeEvidenceLabel(evidenceClass: MatchResult["recodeEvidenceClass"]): string {
  const labels: Record<NonNullable<MatchResult["recodeEvidenceClass"]>, string> = {
    compatible_alternate: "Alternate code",
    new_pack_size: "New pack size",
    source_data_conflict: "Source conflict",
    pack_evidence_missing: "Pack check",
    unreliable_code: "Name + pack identity",
  };
  return evidenceClass ? labels[evidenceClass] : "Re-code?";
}

function MatchStatusBadge({ confidence, strategy, possibleRecode, evidenceClass }: {
  confidence: string;
  strategy: string;
  possibleRecode?: boolean;
  evidenceClass?: MatchResult["recodeEvidenceClass"];
}) {
  if (possibleRecode || evidenceClass === "source_data_conflict" || evidenceClass === "unreliable_code") {
    const tone = evidenceClass === "new_pack_size"
      ? "bg-violet-50 text-violet-800 border-violet-200"
      : evidenceClass === "source_data_conflict"
        ? "bg-red-50 text-red-800 border-red-200"
        : evidenceClass === "unreliable_code"
          ? "bg-slate-100 text-slate-800 border-slate-300"
          : "bg-amber-50 text-amber-700 border-amber-200";
    return <Badge className={`${tone} shadow-none font-medium`}>{recodeEvidenceLabel(evidenceClass)}</Badge>;
  }
  if (confidence === "high") return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 shadow-none font-medium">Matched</Badge>;
  if (confidence === "medium") return <Badge className="bg-blue-50 text-blue-700 border-blue-200 shadow-none font-medium">Likely</Badge>;
  if (confidence === "low") return <Badge className="bg-orange-50 text-orange-700 border-orange-200 shadow-none font-medium">Fuzzy</Badge>;
  if (confidence === "ambiguous") return <Badge className="bg-red-50 text-red-700 border-red-200 shadow-none font-medium">Ambiguous</Badge>;
  if (strategy === "none") return <Badge className="bg-slate-100 text-slate-700 border-slate-200 shadow-none font-medium">New</Badge>;
  return <Badge variant="outline" className="shadow-none font-medium">{confidence}</Badge>;
}

function StrategyLabel({ strategy, possibleRecode = false, evidenceClass }: {
  strategy: string;
  possibleRecode?: boolean;
  evidenceClass?: MatchResult["recodeEvidenceClass"];
}) {
  if (possibleRecode || evidenceClass === "source_data_conflict" || evidenceClass === "unreliable_code") {
    if (evidenceClass === "new_pack_size") return <span className="text-muted-foreground">Same name, different pack</span>;
    if (evidenceClass === "source_data_conflict") return <span className="text-muted-foreground">Conflicting source evidence</span>;
    if (evidenceClass === "unreliable_code") return <span className="text-muted-foreground">Description in code field</span>;
    return <span className="text-muted-foreground">Same name, new code</span>;
  }
  const map: Record<string, string> = {
    external_mapping: "Prior mapping",
    alternate_identity: "Prior product identity",
    same_workbook_identity: "Workbook sibling",
    item_code: "Item code",
    name_pack: "Name match",
    fuzzy: "Fuzzy",
    none: "—",
  };
  return <span className="text-muted-foreground">{map[strategy] ?? strategy}</span>;
}

type PackGeometry = Pick<
  PackEvidence,
  "caseQuantity" | "innerPackQuantity" | "baseUnitQuantity" | "baseUnit" | "normalizedUnit" | "totalBaseUnits"
>;

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

function formatNormalizedPack(pack: PackGeometry | null | undefined): string {
  if (!pack || pack.totalBaseUnits == null || !pack.normalizedUnit) return "Not confirmed";
  return `${Number.isInteger(pack.totalBaseUnits) ? pack.totalBaseUnits : pack.totalBaseUnits.toFixed(2)} ${pack.normalizedUnit}`;
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
  const label = status === "compatible" ? "Same pack" : status === "incompatible" ? "Different pack" : "Pack unconfirmed";
  const sourceEvidence = source;
  const candidateEvidence = candidate;

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
        <span className="font-semibold text-foreground">
          Normalized total: {formatNormalizedPack(sourceEvidence)} → {formatNormalizedPack(candidateEvidence)}
        </span>
        <span className="ml-1">
          · Incoming shape: {formatPackGeometry(sourceEvidence)} · Catalog shape: {formatPackGeometry(candidateEvidence)}
        </span>
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
          <div className="font-semibold text-sm">{formatPackGeometry(sourceEvidence)}</div>
          <div className="text-xs font-medium">Normalized total: {formatNormalizedPack(sourceEvidence)}</div>
        </div>
        <span className="hidden sm:block text-muted-foreground" aria-hidden="true">→</span>
        <div>
          <div className="text-[10px] uppercase tracking-wide opacity-70">Existing catalog evidence</div>
          <div className="font-semibold text-sm">{formatPackGeometry(candidateEvidence)}</div>
          <div className="text-xs font-medium">Normalized total: {formatNormalizedPack(candidateEvidence)}</div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed">{packDecisionCopy(status)}</p>
      {reason && <p className="mt-1 text-[11px] leading-relaxed opacity-80">Why: {reason}</p>}
    </div>
  );
}

function SourcePackEvidence({ source }: { source: PackGeometry | null | undefined }) {
  return (
    <div className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
      <Badge
        variant="outline"
        className="mr-1 h-4 px-1 text-[9px] leading-none border-slate-300 bg-slate-50 text-slate-700"
      >
        Pack evidence
      </Badge>
      <span className="font-semibold text-foreground">
        Normalized total: {formatNormalizedPack(source)}
      </span>
      <span className="ml-1">· Incoming shape: {formatPackGeometry(source)}</span>
    </div>
  );
}

function HeldRowDetails({ row }: { row: RowPreview }) {
  const matchNeedsConfirmation = row.itemMatch.requiresReview;
  return (
    <div
      className="border-b border-amber-200 bg-amber-50/70 px-4 py-4 text-amber-950"
      data-testid={`held-row-details-${row.rowIndex}`}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Held for review — conflicting item evidence</h4>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
            A blank Orderly Item Code is normally fine: FnB Cost Pro assigns a permanent internal item number to a genuinely new product group.
            {matchNeedsConfirmation
              ? " This row has competing catalog evidence, so it needs a choice before it can be linked or added."
              : " This row is missing enough product identity evidence to create a safe internal item number."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-900/80">
            Choosing an existing item saves this description-and-pack identity for future
            imports at this property only. It never links another property.
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="rounded border border-amber-200 bg-background/70 p-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-amber-800/70">Item Code evidence</dt>
          <dd className="mt-0.5 font-mono font-semibold">{row.sourceItemCode?.trim() || "Blank / not provided"}</dd>
        </div>
        <div className="rounded border border-amber-200 bg-background/70 p-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-amber-800/70">Source description</dt>
          <dd className="mt-0.5 font-semibold">{row.cleanedDescription?.trim() || "Blank / not provided"}</dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Candidate picker (for ambiguous / likely / possibleRecode rows) ───

function CandidatePicker({
  row,
  decision,
  hasOverride,
  onDecision,
  codeGroupRowCount = 1,
}: {
  row: RowPreview;
  decision: DecisionValue | undefined;
  hasOverride: boolean;
  onDecision: (rowIndex: number, value: DecisionValue | undefined) => void;
  codeGroupRowCount?: number;
}) {
  const match = row.itemMatch;
  const {
    confidence,
    candidates = [],
    matchedItem,
    possibleRecode,
    possibleRecodeItem,
    packCompatibility,
    packCompatibilityReason,
    candidatePackEvidence,
    recodeEvidenceClass,
    sourceDataConflict,
  } = match;

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
            {item.internalItemNumber != null && <span>FnB #: <span className="font-medium text-foreground">{item.internalItemNumber}</span></span>}
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

  if (recodeEvidenceClass === "source_data_conflict") {
    return (
      <div className="border-t border-red-200 bg-red-50/70 px-4 py-4 text-red-950">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <div>
            <h4 className="text-sm font-semibold">Source data conflict — approval is blocked</h4>
            <p className="mt-1 text-xs leading-relaxed text-red-900/80">
              The same vendor and Orderly Item Code appear with different physical pack evidence.
              Correct or verify the source data before deciding whether this is an existing item or a new pack size.
            </p>
            {sourceDataConflict?.reason && (
              <p className="mt-2 text-xs font-medium text-red-900">Why: {sourceDataConflict.reason}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (recodeEvidenceClass === "unreliable_code") {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 text-slate-950">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" />
          <div>
            <h4 className="text-sm font-semibold">Description in Item Code — using name and pack identity</h4>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              This value is descriptive text rather than a vendor-stable code. FnB Cost Pro will create or resolve
              the item using its normalized product name and retained source pack evidence, so its quantity and value are counted.
            </p>
            <p className="mt-2 text-xs font-medium text-slate-800">
              No permanent Orderly code mapping will be created from the descriptive text.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Handle Possible Recode
  if (possibleRecode && possibleRecodeItem) {
    const recodeDecision = isRecodeDecision(decision) ? decision : undefined;
    const isLink = recodeDecision?.action === "link_existing";
    const isVendorPackLink = recodeDecision?.action === "link_vendor_pack";
    const isCreateNew = recodeDecision?.action === "create_variant";
    const isHeld = row.heldForReview;
    const isLeftUnlinked = isHeld && decision === null;
    const targetId = match.possibleRecodeMatchedId ?? possibleRecodeItem.id;
    
    const isCompatible = packCompatibility === 'compatible';
    const isIncompatible = packCompatibility === 'incompatible';
    const isUnknown = packCompatibility === 'unknown';
    const linkIsAllowed = isCompatible;

    return (
      <>
        {isHeld && <HeldRowDetails row={row} />}
        <div className="px-4 py-4 space-y-4 bg-muted/20 border-t border-border">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {recodeEvidenceClass === "new_pack_size"
                ? "New Pack Size Detected"
                : isUnknown
                  ? "Pack Evidence Incomplete"
                  : "Alternate Item Code Detected"}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {recodeEvidenceClass === "new_pack_size"
                ? "The product name matches, but the normalized physical pack differs. It must be kept as a separate variant."
                : isUnknown
                  ? "The incoming physical pack is incomplete, so compatibility cannot be confirmed. Linking stays blocked; create a separate variant to preserve this row without claiming the packs match."
                  : "This row has a new item code, but its name and physical pack match an existing catalog item."}
            </p>
          </div>
        </div>

        <PackComparison
          source={row.itemMatch.sourcePackEvidence ?? row}
          candidate={candidatePackEvidence}
          status={packCompatibility}
          reason={packCompatibilityReason}
        />
        {codeGroupRowCount > 1 && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
            This choice applies to all {codeGroupRowCount} source rows for Item Code <span className="font-mono">{row.sourceItemCode}</span>.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ItemChip
            item={possibleRecodeItem}
            selected={isLink === true}
            disabled={!linkIsAllowed}
            onClick={() => onDecision(
              row.rowIndex,
              isHeld ? targetId : isLink ? undefined : { action: "link_existing", inventoryItemId: targetId },
            )}
            badge={
              isCompatible ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Compatible</Badge> :
              isIncompatible ? <Badge className="bg-red-100 text-red-800 border-red-200">Incompatible</Badge> :
              isUnknown ? <Badge className="bg-slate-200 text-slate-800 border-slate-300">Unknown</Badge> : null
            }
          />
          {match.crossVendorPackEligible && !isHeld && (
            <button
              onClick={() => onDecision(
                row.rowIndex,
                isVendorPackLink ? undefined : { action: "link_vendor_pack", inventoryItemId: targetId },
              )}
              className={`flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors ${
                isVendorPackLink
                  ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                  : "border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50 text-foreground"
              }`}
            >
              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isVendorPackLink ? "border-primary bg-primary" : "border-emerald-500"}`}>
                {isVendorPackLink && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </div>
              <div>
                <div className="font-semibold flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-emerald-700" />
                  Keep one item, add this vendor pack
                  <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">Recommended</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Link this vendor's verified pack and price to the existing item for cross-vendor comparison.
                </p>
              </div>
            </button>
          )}
          {isHeld ? (
            <button
              onClick={() => onDecision(row.rowIndex, null)}
              className={`flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors ${
                isLeftUnlinked
                  ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                  : "border-border bg-card hover:bg-accent/50 text-foreground"
              }`}
            >
              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isLeftUnlinked ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                {isLeftUnlinked && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </div>
              <div>
                <div className="font-semibold">Leave unlinked</div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Keep this blank-code row held for review. No new item will be created.
                </p>
              </div>
            </button>
          ) : (
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
                  {isUnknown
                    ? "Create a separate item while keeping its source pack geometry unconfirmed."
                    : "Establish a new item record. Do this if the pack size or product fundamentally changed."}
                </p>
              </div>
            </button>
          )}
        </div>
        </div>
      </>
    );
  }

  // Handle Ambiguous
  if (confidence === "ambiguous") {
    const isHeld = row.heldForReview;
    const explicitLink = typeof decision === "string" ? decision : undefined;
    const resolvedId = isHeld
      ? explicitLink
      : hasOverride && !isRecodeDecision(decision)
        ? decision
        : undefined;
    const isLeftUnlinked = isHeld && decision === null;
    return (
      <>
        {row.heldForReview && <HeldRowDetails row={row} />}
        <div className="px-4 py-4 space-y-3 bg-muted/20 border-t border-border">
          <p className="text-sm font-medium text-foreground">
            {isHeld
              ? `${candidates.length} items matched — pick one to link, or leave this row unlinked:`
              : `${candidates.length} items matched — pick one to link, or create a new item:`}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {candidates.map(c => (
              <ItemChip
                key={c.id}
                item={c}
                selected={resolvedId === c.id}
                onClick={() => onDecision(
                  row.rowIndex,
                  isHeld
                    ? c.id
                    : resolvedId === c.id ? undefined : c.id,
                )}
              />
            ))}
            {isHeld ? (
              <button
                onClick={() => onDecision(row.rowIndex, null)}
                className={`flex items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
                  isLeftUnlinked
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                    : "border-border bg-card hover:bg-accent/50 text-foreground"
                }`}
              >
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isLeftUnlinked ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                   {isLeftUnlinked && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </div>
                <span className="font-medium">Leave unlinked</span>
              </button>
            ) : (
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
            )}
          </div>
          {!hasOverride && !isHeld && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
               <Info className="h-3.5 w-3.5" /> No selection will result in a new item upon approval.
            </p>
          )}
        </div>
      </>
    );
  }

  // Handle Medium/Low confidence
  if (confidence === "medium" || confidence === "low") {
    const item = matchedItem;
    if (!item) return null;
    const isHeld = row.heldForReview;
    const isExplicitLink = typeof decision === "string";
    const isCreateNew = hasOverride && !isRecodeDecision(decision) && decision === null;
    const isLeftUnlinked = isHeld && decision === null;
    return (
      <>
        {row.heldForReview && <HeldRowDetails row={row} />}
        <div className="px-4 py-4 space-y-3 bg-muted/20 border-t border-border">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {isHeld
                ? `Suggested by ${confidence === "medium" ? "name similarity" : "fuzzy match"}. Choose the existing item to link, or leave this row unlinked:`
                : `Auto-matched by ${confidence === "medium" ? "name similarity" : "fuzzy match"}. Confirm or override:`}
            </p>
          </div>
          <div className="flex flex-col md:flex-row items-start gap-3">
            <div className="flex-1 w-full">
              <ItemChip
                item={item}
                selected={isHeld ? isExplicitLink : !isCreateNew}
                onClick={() => onDecision(
                  row.rowIndex,
                  isHeld
                    ? item.id
                    : undefined,
                )}
              />
            </div>
            {isHeld ? (
              <button
                onClick={() => onDecision(row.rowIndex, null)}
                className={`shrink-0 w-full md:w-auto rounded-md border px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  isLeftUnlinked
                    ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/20"
                    : "border-border bg-card hover:bg-accent/50 text-foreground"
                }`}
              >
                Leave unlinked
              </button>
            ) : (
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
            )}
          </div>
          {row.caseQuantity != null && item.caseSize != null && Math.abs(row.caseQuantity - item.caseSize) > 0.01 && (
            <div className="text-xs text-amber-700 bg-amber-50/50 border border-amber-200 rounded px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Pack size differs: import has <strong>{row.caseQuantity}</strong>, catalog item has <strong>{item.caseSize}</strong></span>
            </div>
          )}
        </div>
      </>
    );
  }

  return row.heldForReview ? <HeldRowDetails row={row} /> : null;
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
  const [approvalJob, setApprovalJob] = useState<ApprovalJob | null>(null);
  const [approvalStatusError, setApprovalStatusError] = useState<string | null>(null);
  const [approvalPollKey, setApprovalPollKey] = useState(0);
  const completedApprovalRef = useRef<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedConfidences, setSelectedConfidences] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [rowDecisions, setRowDecisions] = useState<Map<number, DecisionValue>>(() => new Map());
  const [decisionRevisions, setDecisionRevisions] = useState<Map<number, number>>(() => new Map());
  const [savingRowIndexes, setSavingRowIndexes] = useState<Set<number>>(() => new Set());
  const [decisionSaveErrors, setDecisionSaveErrors] = useState<Map<number, string>>(() => new Map());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [duplicateDialogWarning, setDuplicateDialogWarning] = useState<DuplicateDateWarning | null>(null);
  const [legacyApprovalStores, setLegacyApprovalStores] = useState<{ id: string; name: string }[] | null>(null);
  const [legacyApprovalStoreId, setLegacyApprovalStoreId] = useState<string>("");
  const [noticesCollapsed, setNoticesCollapsed] = useState(false);
  const [bulkCompatibleConfirmationOpen, setBulkCompatibleConfirmationOpen] = useState(false);
  const [bulkVariantConfirmationOpen, setBulkVariantConfirmationOpen] = useState(false);
  const [isManifestExporting, setIsManifestExporting] = useState(false);
  const [isManifestImporting, setIsManifestImporting] = useState(false);
  const [manifestImportResult, setManifestImportResult] = useState<DecisionManifestImportResult | null>(null);
  const savingRowsRef = useRef<Set<number>>(new Set());
  const manifestFileInputRef = useRef<HTMLInputElement>(null);

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

  const {
    data: savedReviewDecisions,
    isLoading: areReviewDecisionsLoading,
    refetch: refetchReviewDecisions,
  } = useQuery<ReviewDecisionResponse>({
    queryKey: [`/api/inventory-import/orderly/batches/${batchId}/review-decisions`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-import/orderly/batches/${batchId}/review-decisions`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to load saved review decisions");
      }
      return res.json();
    },
  });

  useEffect(() => {
    if (!savedReviewDecisions) return;
    setRowDecisions(new Map(savedReviewDecisions.decisions.map(decision => [
      decision.rowIndex,
      fromStoredDecisionPayload(decision.decision),
    ])));
    setDecisionRevisions(new Map(savedReviewDecisions.decisions.map(decision => [decision.rowIndex, decision.revision])));
  }, [batchId, savedReviewDecisions]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (savingRowsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  function completeApproval(job: ApprovalJob) {
    if (!job.result || completedApprovalRef.current === job.jobId) return;
    completedApprovalRef.current = job.jobId;
    qc.invalidateQueries({ queryKey: ["/api/inventory-import/orderly/batches"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
    qc.invalidateQueries({ queryKey: ["/api/vendors"] });
    onApproved(job.result);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/approval-job`, {
          credentials: "include",
        });
        if (res.status === 404) return;
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not check approval status");
        if (cancelled) return;
        const job = body as ApprovalJob;
        setApprovalStatusError(null);
        setApprovalJob(job);
        if (job.status === "completed") {
          completeApproval(job);
          return;
        }
        if (job.status === "running") {
          timer = setTimeout(poll, 2000);
        }
      } catch (err: any) {
        if (!cancelled) {
          setApprovalStatusError(err.message ?? "Could not check approval status");
          timer = setTimeout(poll, 2000);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [batchId, approvalPollKey]);

  useEffect(() => {
    // Wouter navigation goes through history.pushState. Guard routes outside
    // this wizard while a server save is in flight so the same protection as
    // the Back button applies to sidebar and top-bar navigation too.
    const originalPushState = window.history.pushState.bind(window.history);
    const reviewRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    window.history.pushState = (
      state: unknown,
      unused: string,
      url?: string | URL | null,
    ) => {
      const target = url ? new URL(String(url), window.location.href) : null;
      const remainsInOrderlyImport = target?.pathname === window.location.pathname;
      if (
        savingRowsRef.current.size > 0 &&
        !remainsInOrderlyImport &&
        !window.confirm("A review decision is still saving. Leave this page anyway?")
      ) {
        return;
      }
      originalPushState(state, unused, url);
    };

    const guardBrowserHistoryNavigation = () => {
      if (savingRowsRef.current.size === 0) return;
      const remainsInOrderlyImport = window.location.pathname === new URL(reviewRoute, window.location.origin).pathname;
      if (
        !remainsInOrderlyImport &&
        !window.confirm("A review decision is still saving. Leave this page anyway?")
      ) {
        // popstate arrives after the browser changes its URL. Restore the
        // protected review route and notify Wouter before it can unmount the
        // pending save screen.
        window.history.replaceState(null, "", reviewRoute);
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      }
    };
    window.addEventListener("popstate", guardBrowserHistoryNavigation);

    return () => {
      window.history.pushState = originalPushState;
      window.removeEventListener("popstate", guardBrowserHistoryNavigation);
    };
  }, []);

  function toggleExpand(rowIndex: number) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  async function persistDecisionChanges(
    changes: ReviewDecisionChange[],
    options: { preserveExistingActions?: boolean } = {},
  ): Promise<boolean> {
    if (changes.some(change => savingRowsRef.current.has(change.rowIndex))) return false;
    for (const change of changes) savingRowsRef.current.add(change.rowIndex);
    setDecisionSaveErrors(prev => {
      const next = new Map(prev);
      for (const change of changes) next.delete(change.rowIndex);
      return next;
    });
    setSavingRowIndexes(new Set(savingRowsRef.current));
    try {
      const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/review-decisions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          changes,
          ...(options.preserveExistingActions ? { preserveExistingActions: true } : {}),
        }),
      });
      const body: ReviewDecisionResponse & { clearedRowIndexes?: number[]; error?: string } = await res.json();
      if (!res.ok) {
        if (res.status === 409) await refetchReviewDecisions();
        throw new Error(body.error ?? "Failed to save review decision");
      }

      const cleared = new Set(body.clearedRowIndexes ?? []);
      setRowDecisions(prev => {
        const next = new Map(prev);
        for (const rowIndex of cleared) next.delete(rowIndex);
        for (const saved of body.decisions) {
          next.set(saved.rowIndex, fromStoredDecisionPayload(saved.decision));
        }
        return next;
      });
      setDecisionRevisions(prev => {
        const next = new Map(prev);
        for (const rowIndex of cleared) next.delete(rowIndex);
        for (const saved of body.decisions) next.set(saved.rowIndex, saved.revision);
        return next;
      });
      setDecisionSaveErrors(prev => {
        const next = new Map(prev);
        for (const change of changes) next.delete(change.rowIndex);
        return next;
      });
      return true;
    } catch (err: any) {
      const message = err.message ?? "Review the row and try again.";
      setDecisionSaveErrors(prev => {
        const next = new Map(prev);
        for (const change of changes) next.set(change.rowIndex, message);
        return next;
      });
      toast({
        title: "Decision was not saved",
        description: message,
        variant: "destructive",
      });
      return false;
    } finally {
      for (const change of changes) savingRowsRef.current.delete(change.rowIndex);
      setSavingRowIndexes(new Set(savingRowsRef.current));
    }
  }

  function setDecision(rowIndex: number, value: DecisionValue | undefined) {
    if (!preview) return;
    const sourceRow = preview.rows.find(row => row.rowIndex === rowIndex);
    const groupRows = sourceRow?.itemMatch.possibleRecode && sourceRow.sourceCodeReliability === "stable" && sourceRow.sourceItemCode
      ? preview.rows.filter(row =>
          row.sourceCodeReliability === "stable" &&
          row.sourceItemCode?.trim() === sourceRow.sourceItemCode!.trim()
        )
      : sourceRow
        ? [sourceRow]
        : [];
    const targetRows = groupRows.length > 0 ? groupRows : [{ rowIndex } as RowPreview];
    void persistDecisionChanges(targetRows.map(row => ({
      rowIndex: row.rowIndex,
      expectedRevision: decisionRevisions.get(row.rowIndex) ?? null,
      ...(value === undefined ? {} : { decision: toStoredDecisionPayload(value) }),
    })));
  }

  async function queueBulkCompatiblePackLinks() {
    const bulkDecisions = buildBulkCompatiblePackDecisions(bulkCompatiblePackReview.candidates);
    const changes = bulkDecisions.flatMap(decision => {
      const existing = rowDecisions.get(decision.rowIndex);
      if (
        isRecodeDecision(existing) &&
        existing.action === "link_existing" &&
        existing.inventoryItemId === decision.inventoryItemId
      ) {
        return [];
      }
      return [{
        rowIndex: decision.rowIndex,
        expectedRevision: decisionRevisions.get(decision.rowIndex) ?? null,
        decision: {
          action: decision.action,
          inventoryItemId: decision.inventoryItemId,
        },
      }];
    });
    if (changes.length > 0 && !(await persistDecisionChanges(changes, { preserveExistingActions: true }))) return;
    setBulkCompatibleConfirmationOpen(false);
    const sourceRows = bulkCompatiblePackReview.candidates.reduce((sum, candidate) => sum + candidate.sourceRowCount, 0);
    toast({
      title: `${bulkCompatiblePackReview.candidates.length} compatible ${bulkCompatiblePackReview.candidates.length === 1 ? "code" : "codes"} linked`,
      description: `${sourceRows} source ${sourceRows === 1 ? "row now uses" : "rows now use"} the verified existing inventory items. Identical saved links were left unchanged.`,
    });
  }

  async function queueBulkNewPackSizeVariants() {
    const bulkDecisions = buildBulkNewPackSizeDecisions(bulkNewPackSizeReview.candidates);
    const saved = await persistDecisionChanges(bulkDecisions.map(decision => ({
      rowIndex: decision.rowIndex,
      expectedRevision: decisionRevisions.get(decision.rowIndex) ?? null,
      decision: {
        action: decision.action,
        comparableInventoryItemId: decision.comparableInventoryItemId,
      },
    })));
    if (!saved) return;
    setBulkVariantConfirmationOpen(false);
    toast({
      title: `${bulkNewPackSizeReview.candidates.length} pack-size ${bulkNewPackSizeReview.candidates.length === 1 ? "variant" : "variants"} saved`,
      description: "You can leave and resume this review; any saved row can still be changed before approval.",
    });
  }

  async function exportDecisionManifest() {
    setIsManifestExporting(true);
    try {
      const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/review-decisions/manifest`, {
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not export review decisions");

      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orderly-review-decisions-${batchId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Review manifest downloaded",
        description: "It is bound to this pending import and will be rechecked before it can be applied.",
      });
    } catch (err: any) {
      toast({
        title: "Could not export review decisions",
        description: err.message ?? "Try again from the pending review.",
        variant: "destructive",
      });
    } finally {
      setIsManifestExporting(false);
    }
  }

  async function importDecisionManifest(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsManifestImporting(true);
    setManifestImportResult(null);
    try {
      let manifest: unknown;
      try {
        manifest = JSON.parse(await file.text());
      } catch {
        throw new Error("Choose a valid Orderly review manifest JSON file.");
      }
      const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/review-decisions/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ manifest }),
      });
      const body: DecisionManifestImportResult & { error?: string } = await res.json();
      if (!res.ok && !body.status) throw new Error(body.error ?? "Could not import review decisions");

      setManifestImportResult(body);
      if (body.status === "accepted") {
        await refetchReviewDecisions();
        toast({
          title: `${body.accepted.length} review ${body.accepted.length === 1 ? "decision" : "decisions"} applied`,
          description: "Every imported decision was rechecked against the current batch before saving.",
        });
      } else if (body.status === "stale") {
        toast({
          title: "Manifest is stale",
          description: "No decisions were changed. Export a fresh manifest after reviewing the current evidence.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Manifest was not applied",
          description: "No decisions were changed because one or more entries no longer pass review.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Could not import review decisions",
        description: err.message ?? "No decisions were changed.",
        variant: "destructive",
      });
    } finally {
      setIsManifestImporting(false);
    }
  }

  async function submitApproval(force = false) {
    if (savingRowsRef.current.size > 0 || isManifestImporting) {
      toast({
        title: "Waiting for review decisions to save",
        description: "Approve is available once all in-progress decision updates finish.",
      });
      return;
    }
    setApproving(true);
    try {
      const res = await fetch(`/api/inventory-import/orderly/batches/${batchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
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

      const job = body as ApprovalJob;
      setApprovalJob(job);
      if (job.status === "completed") completeApproval(job);
      else setApprovalPollKey(key => key + 1);
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  }

  function handleBack() {
    if (
      savingRowsRef.current.size > 0 &&
      !window.confirm("A review decision is still saving. Leave this page anyway?")
    ) {
      return;
    }
    onBack();
  }

  if (isLoading || areReviewDecisionsLoading) {
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
  // A browser can briefly hold a preview response from the prior API bundle
  // while the web client has already hot-reloaded. Keep the review screen
  // usable during that harmless rollout window; a fresh query gets the full
  // read-only evidence report.
  const blankCodeClassification = preview.identitySummary?.blankCodeClassification ?? {
    confirmed: { rows: 0, valueTotal: 0 },
    reviewable: { rows: 0, valueTotal: 0 },
    conflicted: { rows: 0, valueTotal: 0 },
    held: { rows: 0, valueTotal: 0 },
  };
  // The summary covers every held row, including coded re-codes and conflicts.
  // The identity classification is blank-code-only supporting detail.
  const heldForReviewRows = s.itemsHeldForReview;
  const recodeSummary = preview.recodeSummary ?? {
    compatibleAlternates: 0,
    newPackSizes: 0,
    sourceDataConflicts: 0,
    unreliableCodes: 0,
    packEvidenceMissing: 0,
  };
  const unknownPackRows = preview.rows.filter(row => row.packParseStatus === "unparseable").length;
  const bulkCompatiblePackReview = getBulkCompatiblePackReview(preview.rows);
  const bulkNewPackSizeReview = getBulkNewPackSizeReview(preview.rows);
  const queuedCompatibleLinkCount = bulkCompatiblePackReview.candidates.filter(candidate =>
    candidate.rowIndexes.every(rowIndex => {
      const decision = rowDecisions.get(rowIndex);
      return isRecodeDecision(decision) &&
        decision.action === "link_existing" &&
        decision.inventoryItemId === candidate.targetInventoryItemId;
    }),
  ).length;
  const queuedBulkVariantCount = bulkNewPackSizeReview.candidates.filter(candidate =>
    candidate.rowIndexes.every(rowIndex => {
      const decision = rowDecisions.get(rowIndex);
      return isRecodeDecision(decision) &&
        decision.action === "create_variant" &&
        decision.comparableInventoryItemId === candidate.comparableInventoryItemId;
    }),
  ).length;
  const actionableRecodeRows = preview.rows.filter(row =>
    row.itemMatch.possibleRecode &&
    row.sourceCodeReliability === "stable" &&
    row.itemMatch.recodeEvidenceClass !== "source_data_conflict",
  );
  const actionableRecodeRowsByCode = new Map<string, RowPreview[]>();
  for (const row of actionableRecodeRows) {
    const code = row.sourceItemCode?.trim();
    if (!code) continue;
    const rows = actionableRecodeRowsByCode.get(code) ?? [];
    rows.push(row);
    actionableRecodeRowsByCode.set(code, rows);
  }
  const pendingRecodeCodes = getPendingRecodeCodes(
    preview.rows,
    row => row.rowIndex != null && isRecodeDecision(rowDecisions.get(row.rowIndex)),
  );
  const resolvedHeldRows = preview.rows.filter(row => row.heldForReview && rowDecisions.has(row.rowIndex)).length;
  const remainingHeldRows = Math.max(0, heldForReviewRows - resolvedHeldRows);
  const recodeCodeCount = recodeSummary.compatibleAlternates + recodeSummary.newPackSizes + recodeSummary.packEvidenceMissing;
  const hasPendingRecodeDecisions = pendingRecodeCodes.length > 0;
  const hasSourceEvidenceBlockers = recodeSummary.sourceDataConflicts > 0;
  const approvalIsRunning = approvalJob?.status === "running";
  const approvalDisabled = approving || approvalIsRunning || savingRowIndexes.size > 0 || isManifestImporting || hasPendingRecodeDecisions || hasSourceEvidenceBlockers || (legacyApprovalStores !== null && !legacyApprovalStoreId);
  const approvalButtonLabel = approvalIsRunning
    ? "Approval running..."
    : approvalJob?.status === "timed_out" || approvalJob?.status === "failed"
      ? "Retry approval safely"
      : "Approve Import";

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

      <AlertDialog
        open={bulkCompatibleConfirmationOpen}
        onOpenChange={setBulkCompatibleConfirmationOpen}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-emerald-700" />
              Confirm {bulkCompatiblePackReview.candidates.length} compatible {bulkCompatiblePackReview.candidates.length === 1 ? "code link" : "code links"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Every included Item Code was classified by the server as the same physical pack as one existing inventory item.
                  Confirming saves one group-wide decision for every source row shown below; it does not approve the import.
                </p>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
                  {bulkCompatiblePackReview.candidates.map(candidate => (
                    <div key={candidate.sourceItemCode} className="rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-foreground">{candidate.targetItemName}</div>
                          <div className="mt-0.5 text-xs">
                            {candidate.sampleDescription} <span className="font-mono">({candidate.sourceItemCode})</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-900">
                          {candidate.sourceRowCount} source {candidate.sourceRowCount === 1 ? "row" : "rows"}
                        </Badge>
                      </div>
                      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded border bg-muted/20 p-2">
                          <dt className="font-semibold text-muted-foreground">Incoming normalized total</dt>
                          <dd className="mt-0.5 font-medium text-foreground">{candidate.sourceNormalizedTotal}</dd>
                        </div>
                        <div className="rounded border bg-muted/20 p-2">
                          <dt className="font-semibold text-muted-foreground">Catalog normalized total</dt>
                          <dd className="mt-0.5 font-medium text-foreground">{candidate.catalogNormalizedTotal}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
                {bulkCompatiblePackReview.excludedGroups.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950" data-testid="bulk-compatible-pack-exclusions">
                    <p className="font-semibold">
                      {bulkCompatiblePackReview.excludedGroups.length} Item Code {bulkCompatiblePackReview.excludedGroups.length === 1 ? "group is" : "groups are"} excluded
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">
                      {bulkCompatiblePackReview.excludedGroups.slice(0, 8).map(group => (
                        <li key={group.sourceItemCode}>
                          <span className="font-mono">{group.sourceItemCode}</span>: {group.reasonLabel} ({group.rowIndexes.length} {group.rowIndexes.length === 1 ? "row" : "rows"})
                        </li>
                      ))}
                      {bulkCompatiblePackReview.excludedGroups.length > 8 && (
                        <li>And {bulkCompatiblePackReview.excludedGroups.length - 8} more excluded groups.</li>
                      )}
                    </ul>
                    <p className="mt-2 text-xs">
                      Unknown, conflicting, missing, incompatible, or divergent pack evidence stays in individual review and is never bulk-linked.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction
              onClick={queueBulkCompatiblePackLinks}
              data-testid="confirm-bulk-compatible-pack-links"
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              Link {bulkCompatiblePackReview.candidates.length} compatible {bulkCompatiblePackReview.candidates.length === 1 ? "code" : "codes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkVariantConfirmationOpen}
        onOpenChange={setBulkVariantConfirmationOpen}
      >
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-violet-700" />
              Confirm {bulkNewPackSizeReview.candidates.length} separate {bulkNewPackSizeReview.candidates.length === 1 ? "variant" : "variants"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Each listed source Item Code has a verified incompatible pack and will create a separate inventory item.
                  Names come from the source item description and pack descriptors come from the source Pack Size — no manual
                  re-entry is needed.
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
                  {bulkNewPackSizeReview.groups.map(group => (
                    <div key={`${group.vendorName}-${group.packDescriptor}`} className="rounded-md border bg-background p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-foreground">
                        <span className="font-semibold">{group.vendorName}</span>
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-900">
                          {group.packDescriptor}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs">
                        {group.variantCount} {group.variantCount === 1 ? "variant" : "variants"} from {group.sourceRowCount} source {group.sourceRowCount === 1 ? "row" : "rows"}
                      </p>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
                        {group.samples.map(sample => (
                          <li key={sample.sourceItemCode}>
                            {sample.sampleDescription} <span className="font-mono">({sample.sourceItemCode})</span>
                          </li>
                        ))}
                      </ul>
                      {group.samples.some(sample => {
                        const candidate = bulkNewPackSizeReview.candidates.find(item => item.sourceItemCode === sample.sourceItemCode);
                        return Boolean(candidate?.duplicateSupplierWarning);
                      }) && (
                        <p className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          Creating this variant may duplicate an item already supplied by another vendor.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs">
                  This only queues verified <strong>New pack size</strong> rows. Source conflicts, missing pack evidence,
                  and other review blockers remain unresolved and can still block approval.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction
              onClick={queueBulkNewPackSizeVariants}
              data-testid="confirm-bulk-new-pack-size-variants"
              className="bg-violet-700 text-white hover:bg-violet-800"
            >
              Create {bulkNewPackSizeReview.candidates.length} {bulkNewPackSizeReview.candidates.length === 1 ? "variant" : "variants"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={handleBack} className="h-8 shadow-sm">
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            ref={manifestFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importDecisionManifest}
            data-testid="orderly-decision-manifest-input"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={exportDecisionManifest}
            disabled={isManifestExporting || isManifestImporting}
          >
            {isManifestExporting ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            Export decisions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => manifestFileInputRef.current?.click()}
            disabled={isManifestExporting || isManifestImporting}
          >
            {isManifestImporting ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            Import decisions
          </Button>
          <Button onClick={() => submitApproval(false)} disabled={approvalDisabled} size="lg" className="shadow-sm">
            {approving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {approving ? "Starting approval..." : approvalButtonLabel}
          </Button>
        </div>
      </div>

      {approvalJob && (
        <Alert
          data-testid="orderly-approval-status"
          variant={approvalJob.status === "failed" || approvalJob.status === "timed_out" ? "destructive" : "default"}
          className={approvalJob.status === "running" ? "border-blue-200 bg-blue-50 text-blue-950" : undefined}
        >
          {approvalJob.status === "running"
            ? <RefreshCw className="h-4 w-4 animate-spin" />
            : approvalJob.status === "completed"
              ? <CheckCircle2 className="h-4 w-4" />
              : <AlertTriangle className="h-4 w-4" />}
          <AlertTitle>
            {approvalJob.status === "running"
              ? "Approval is running"
              : approvalJob.status === "timed_out"
                ? "Approval is taking longer than expected"
                : approvalJob.status === "failed"
                  ? "Approval failed"
                  : "Approval completed"}
          </AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            {approvalJob.status === "running" && (
              <>
                <p>
                  Catalog changes are being applied in one protected transaction. The processing budget is{" "}
                  {Math.round(approvalJob.timeoutBudgetMs / 60000)} minutes.
                </p>
                <Progress value={approvalJob.progressPercent} className="h-2" />
                <p className="text-xs">Phase: {approvalJob.phase.replaceAll("_", " ")} · attempt {approvalJob.attemptCount}</p>
                {approvalStatusError && (
                  <p className="text-xs text-amber-800">
                    Status check delayed: {approvalStatusError}. Retrying automatically.
                  </p>
                )}
              </>
            )}
            {approvalJob.status === "timed_out" && (
              <p>
                The three-minute budget was exceeded. The original attempt may still finish; retrying checks and
                reuses this batch’s approval job, so it cannot apply the catalog changes twice.
              </p>
            )}
            {approvalJob.status === "failed" && (
              <p>{approvalJob.error?.message ?? "No catalog changes were committed. You can retry safely."}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {manifestImportResult && (
        <div data-testid="orderly-decision-manifest-result">
          <Alert
            variant={manifestImportResult.status === "accepted" ? "default" : "destructive"}
            className={manifestImportResult.status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : undefined}
          >
            {manifestImportResult.status === "accepted"
              ? <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              : <ShieldAlert className="h-4 w-4" />}
            <AlertTitle>
              {manifestImportResult.status === "accepted"
                ? "Manifest applied"
                : manifestImportResult.status === "stale"
                  ? "Manifest not applied — evidence changed"
                  : "Manifest not applied — decisions rejected"}
            </AlertTitle>
            <AlertDescription className="mt-1 space-y-1">
              {manifestImportResult.accepted.length > 0 && (
                <p>{manifestImportResult.accepted.length} accepted {manifestImportResult.accepted.length === 1 ? "decision" : "decisions"} saved.</p>
              )}
              {manifestImportResult.rejected.map(entry => (
                <p key={`rejected-${entry.rowIndex}`}>Row {entry.rowIndex} rejected: {entry.reason}</p>
              ))}
              {manifestImportResult.stale.map(entry => (
                <p key={`stale-${entry.rowIndex}`}>Row {entry.rowIndex} is stale: {entry.reason}</p>
              ))}
            </AlertDescription>
          </Alert>
        </div>
      )}

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
            <div className="text-xs font-medium text-muted-foreground mt-1">Will be created</div>
            {remainingHeldRows > 0 ? (
              <button
                type="button"
                className="mt-3 flex w-full items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-left text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                onClick={() => {
                  setSelectedCategories(new Set());
                  setSelectedConfidences(new Set(["held"]));
                  setCurrentPage(0);
                }}
              >
                <span className="flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Held for review</span>
                <span>{remainingHeldRows.toLocaleString()} remaining</span>
              </button>
            ) : resolvedHeldRows > 0 ? (
              <div className="mt-3 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                {resolvedHeldRows.toLocaleString()} held {resolvedHeldRows === 1 ? "row decision" : "row decisions"} recorded
              </div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">No rows are held for review</div>
            )}
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

      {unknownPackRows > 0 && (
        <Alert className="border-amber-300 bg-amber-50/80 text-amber-950" data-testid="unknown-pack-import-advisory">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle>Unknown pack geometry will still be imported</AlertTitle>
          <AlertDescription className="mt-1 text-amber-900/80">
            {unknownPackRows.toLocaleString()} {unknownPackRows === 1 ? "row has" : "rows have"} unsupported or incomplete pack geometry.
            FnB Cost Pro will create or resolve the inventory identity and retain its quantity and value using an opaque package count.
            No normalized pack total, unit conversion, or pack-compatibility claim will be created.
          </AlertDescription>
        </Alert>
      )}

      {(recodeCodeCount > 0 || hasSourceEvidenceBlockers) && (
        <Card className="border-violet-200 bg-violet-50/30 shadow-sm" data-testid="orderly-pack-size-walkthrough">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-950">
                  <Package className="h-4 w-4 text-violet-700" />
                  Item code and pack-size review
                </div>
                <p className="mt-1 text-xs leading-relaxed text-violet-900/75">
                  A matching name is not enough. Review the physical pack before deciding whether a new code represents the same item.
                </p>
              </div>
              {(bulkCompatiblePackReview.candidates.length > 0 || recodeSummary.newPackSizes > 0) && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {bulkCompatiblePackReview.candidates.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-emerald-700 text-white hover:bg-emerald-800"
                      onClick={() => setBulkCompatibleConfirmationOpen(true)}
                      data-testid="bulk-compatible-pack-links"
                    >
                      <Link2 className="mr-1.5 h-4 w-4" />
                      Link {bulkCompatiblePackReview.candidates.length} compatible {bulkCompatiblePackReview.candidates.length === 1 ? "code" : "codes"}
                    </Button>
                  )}
                  {bulkNewPackSizeReview.candidates.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-violet-700 text-white hover:bg-violet-800"
                      onClick={() => setBulkVariantConfirmationOpen(true)}
                      data-testid="bulk-new-pack-size-variants"
                    >
                      Create {bulkNewPackSizeReview.candidates.length} new {bulkNewPackSizeReview.candidates.length === 1 ? "variant" : "variants"} in bulk
                    </Button>
                  )}
                  {recodeSummary.newPackSizes > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-violet-300 bg-background text-violet-900 hover:bg-violet-100"
                      onClick={() => {
                        setSelectedCategories(new Set());
                        setSelectedConfidences(new Set(["new-pack-size"]));
                        setCurrentPage(0);
                      }}
                    >
                      Review {recodeSummary.newPackSizes} new {recodeSummary.newPackSizes === 1 ? "pack size" : "pack sizes"}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-2.5">
                <div className="font-semibold text-emerald-900">1. Same physical pack</div>
                <div className="mt-1 text-emerald-800/80">{recodeSummary.compatibleAlternates} alternate {recodeSummary.compatibleAlternates === 1 ? "code can" : "codes can"} link to the existing item.</div>
              </div>
              <div className="rounded-md border border-violet-200 bg-violet-100/60 p-2.5">
                <div className="font-semibold text-violet-950">2. New pack size</div>
                <div className="mt-1 text-violet-900/80">{recodeSummary.newPackSizes} {recodeSummary.newPackSizes === 1 ? "decision requires" : "decisions require"} a separate item variant.</div>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50/70 p-2.5">
                <div className="font-semibold text-red-900">3. Conflicting source packs</div>
                <div className="mt-1 text-red-800/80">{recodeSummary.sourceDataConflicts} {recodeSummary.sourceDataConflicts === 1 ? "conflict blocks" : "conflicts block"} approval until the source is verified.</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <div className="font-semibold text-slate-900">4. Name + pack identity</div>
                <div className="mt-1 text-slate-700">{recodeSummary.unreliableCodes} descriptive-code {recodeSummary.unreliableCodes === 1 ? "row will be" : "rows will be"} counted using product name and pack, without creating code mappings.</div>
              </div>
            </div>
            {queuedBulkVariantCount > 0 && (
              <p className="mt-3 text-xs font-medium text-violet-950" data-testid="bulk-new-pack-size-queued">
                {queuedBulkVariantCount} pack-size {queuedBulkVariantCount === 1 ? "variant is" : "variants are"} saved. Open any row below to adjust an exception before approval.
              </p>
            )}
            {queuedCompatibleLinkCount > 0 && (
              <p className="mt-3 text-xs font-medium text-emerald-900" data-testid="bulk-compatible-pack-queued">
                {queuedCompatibleLinkCount} compatible {queuedCompatibleLinkCount === 1 ? "code decision is" : "code decisions are"} saved across the complete source-row groups.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {preview.identitySummary && (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
          <Card className="shadow-sm border-border/60 bg-slate-50/50">
            <CardContent className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">Product identity evidence</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Grouped by normalized description and pack evidence before matching storage-location rows.
                </p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span><strong>{preview.identitySummary.uniqueIdentityGroups.toLocaleString()}</strong> groups</span>
                <span className="text-emerald-700"><strong>{preview.identitySummary.identityGroupsResolvedToExisting.toLocaleString()}</strong> existing</span>
                <span><strong>{preview.identitySummary.identityGroupsNewCandidates.toLocaleString()}</strong> new candidates</span>
                <span className="text-amber-700"><strong>{preview.identitySummary.blankCodeGroupsAutoResolved.toLocaleString()}</strong> blank-code groups reconciled</span>
                {preview.identitySummary.identityGroupsRequiringReview > 0 && (
                  <span className="text-red-700"><strong>{preview.identitySummary.identityGroupsRequiringReview.toLocaleString()}</strong> need review</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-border/60">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-foreground">Blank Item Code classification</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Read-only evidence for this workbook. Dollar totals use the source snapshot values.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {([
                  ["Confirmed", blankCodeClassification.confirmed, "text-emerald-700"],
                  ["Reviewable", blankCodeClassification.reviewable, "text-sky-700"],
                  ["Conflicted", blankCodeClassification.conflicted, "text-red-700"],
                  ["Still held", blankCodeClassification.held, "text-amber-700"],
                ] as const).map(([label, classification, tone]) => (
                  <div key={label} className="rounded-md border bg-background/70 p-2">
                    <div className={`font-semibold ${tone}`}>{label}</div>
                    <div className="mt-1 font-medium text-foreground">
                      {classification.rows.toLocaleString()} rows
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      ${classification.valueTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                      These are grouped into <strong>{recodeCodeCount} product decisions</strong>, not {s.itemsRecode} separate decisions. Use the <Badge variant="outline" className="bg-white px-1 py-0 shadow-sm text-[10px] mx-1">Re-code?</Badge> filter below to review and verify pack sizes to avoid creating duplicates.
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

      {/* Plain-language review progress */}
      <Alert className={
        remainingHeldRows > 0 || hasPendingRecodeDecisions || hasSourceEvidenceBlockers
          ? "border-amber-200 bg-amber-50 shadow-sm"
          : "border-emerald-200 bg-emerald-50 shadow-sm"
      }>
        {remainingHeldRows > 0 || hasPendingRecodeDecisions || hasSourceEvidenceBlockers
          ? <AlertTriangle className="h-5 w-5 text-amber-600" />
          : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
        <AlertTitle className={
          remainingHeldRows > 0 || hasPendingRecodeDecisions || hasSourceEvidenceBlockers
            ? "text-amber-900 font-semibold"
            : "text-emerald-900 font-semibold"
        }>
          {remainingHeldRows > 0 || hasPendingRecodeDecisions || hasSourceEvidenceBlockers
            ? "A few decisions remain"
            : "Review complete"}
        </AlertTitle>
        <AlertDescription className={
          remainingHeldRows > 0 || hasPendingRecodeDecisions || hasSourceEvidenceBlockers
            ? "text-amber-800"
            : "text-emerald-800"
        }>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              {remainingHeldRows > 0 && (
                <p>
                  <strong>{remainingHeldRows} held {remainingHeldRows === 1 ? "row" : "rows"}</strong> still needs a choice.
                </p>
              )}
              {hasPendingRecodeDecisions && (
                <p>
                  <strong>{pendingRecodeCodes.length} item-code {pendingRecodeCodes.length === 1 ? "decision" : "decisions"}</strong> still needs a choice.
                </p>
              )}
              {recodeSummary.sourceDataConflicts > 0 && (
                <p>
                  <strong>{recodeSummary.sourceDataConflicts} source {recodeSummary.sourceDataConflicts === 1 ? "conflict blocks" : "conflicts block"} approval.</strong> Verify the vendor pack evidence before importing.
                </p>
              )}
              {recodeSummary.unreliableCodes > 0 && (
                <p>
                  <strong>{recodeSummary.unreliableCodes} descriptive-code {recodeSummary.unreliableCodes === 1 ? "row will use" : "rows will use"} name and pack identity.</strong> These rows will be counted and will not create permanent code mappings.
                </p>
              )}
              {!remainingHeldRows && !hasPendingRecodeDecisions && !hasSourceEvidenceBlockers && (
                <p>Every item needing a decision has one. You can approve the import.</p>
              )}
              {resolvedHeldRows > 0 && (
                <p className="mt-1 text-xs opacity-80">
                  {resolvedHeldRows} held {resolvedHeldRows === 1 ? "row" : "rows"} already has a recorded choice.
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {remainingHeldRows > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-background"
                  onClick={() => {
                    setSelectedCategories(new Set());
                    setSelectedConfidences(new Set(["held"]));
                    setCurrentPage(0);
                  }}
                >
                  Show held row
                </Button>
              )}
              {!remainingHeldRows && hasPendingRecodeDecisions && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-background"
                  onClick={() => {
                    setSelectedCategories(new Set());
                    setSelectedConfidences(new Set(["recode"]));
                    setCurrentPage(0);
                  }}
                >
                  Show item-code reviews
                </Button>
              )}
              {hasSourceEvidenceBlockers && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-background"
                  onClick={() => {
                    setSelectedCategories(new Set());
                    setSelectedConfidences(new Set([
                      ...(recodeSummary.sourceDataConflicts > 0 ? ["source-conflict"] : []),
                    ]));
                    setCurrentPage(0);
                  }}
                >
                  Show blocked rows
                </Button>
              )}
              {recodeSummary.unreliableCodes > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-slate-300 bg-background"
                  onClick={() => {
                    setSelectedCategories(new Set());
                    setSelectedConfidences(new Set(["unreliable-code"]));
                    setCurrentPage(0);
                  }}
                >
                  Show name + pack rows
                </Button>
              )}
            </div>
          </div>
        </AlertDescription>
      </Alert>

      {/* Row table */}
      <div className="space-y-4">
        {(() => {
          const uniqueCategories = computeUniqueCategories(preview.rows);

          const confidenceLevels: { key: string; label: string }[] = [
            { key: "held",             label: "Held for review" },
            { key: "alternate-code",   label: "Alternate code" },
            { key: "new-pack-size",    label: "New pack size" },
            { key: "source-conflict",  label: "Source conflict" },
            { key: "unreliable-code",  label: "Name + pack identity" },
            { key: "pack-check",       label: "Pack check" },
            { key: "recode",           label: "Other re-code"  },
            { key: "high",             label: "Matched"   },
            { key: "medium",           label: "Likely"    },
            { key: "low",              label: "Fuzzy"     },
            { key: "ambiguous",        label: "Ambiguous" },
            { key: "new",              label: "New"       },
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
                  <div
                    data-testid="resolution-row-status"
                    className="text-xs font-medium text-muted-foreground text-right shrink-0"
                  >
                    {filteredRows.length === 0
                      ? "No matching rows"
                      : isFiltered
                        ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${filteredRows.length.toLocaleString()} matching rows (${s.totalRows.toLocaleString()} total)`
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
                        const needsReview = row.heldForReview || row.itemMatch.requiresReview || row.itemMatch.possibleRecode;
                        const isExpanded = expandedRows.has(row.rowIndex);
                        const decision = rowDecisions.get(row.rowIndex);
                        const hasOverride = rowDecisions.has(row.rowIndex);
                        const isSavingDecision = savingRowIndexes.has(row.rowIndex);
                        const decisionSaveError = decisionSaveErrors.get(row.rowIndex);
                        
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
                                {row.heldForReview && (
                                  <div className="mt-1 text-[10px] font-medium text-amber-700">
                                    Item Code: blank
                                  </div>
                                )}
                                {row.identityGroupRows && row.identityGroupRows.length > 1 && (
                                  <div className="mt-1 text-[10px] text-muted-foreground">
                                    Identity group: {row.identityGroupRows.length} location rows
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
                                    ? "Source format parsed"
                                    : row.packParseStatus === "partial"
                                      ? "Partial source parse — imports as unknown"
                                      : "Unknown geometry — will import"}
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
                                  {isSavingDecision && (
                                    <Badge
                                      variant="outline"
                                      className="border-blue-200 bg-blue-50 text-blue-800 shadow-none font-medium"
                                      data-testid={`orderly-decision-saving-${row.rowIndex}`}
                                    >
                                      <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                      Saving decision
                                    </Badge>
                                  )}
                                  {decisionSaveError && (
                                    <span
                                      className="text-[10px] font-medium text-destructive"
                                      data-testid={`orderly-decision-save-error-${row.rowIndex}`}
                                    >
                                      Save failed — choose a decision again to retry.
                                    </span>
                                  )}
                                  {row.heldForReview && hasOverride ? (
                                    <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 shadow-none font-medium">
                                      <CheckCircle2 className="mr-1 h-3 w-3" />Saved decision
                                    </Badge>
                                  ) : row.heldForReview ? (
                                    <Badge className="bg-amber-50 text-amber-800 border-amber-200 shadow-none font-medium">Needs decision</Badge>
                                  ) : (
                                    <MatchStatusBadge
                                      confidence={row.itemMatch.confidence}
                                      strategy={row.itemMatch.strategy}
                                      possibleRecode={row.itemMatch.possibleRecode}
                                      evidenceClass={row.itemMatch.recodeEvidenceClass}
                                    />
                                  )}
                                  {row.heldForReview && (
                                    <span className={`text-[10px] font-medium ${hasOverride ? "text-emerald-700" : "text-amber-700"}`}>
                                      {hasOverride ? "Originally held · choice will apply on approval" : "Blank Item Code"}
                                    </span>
                                  )}
                                  
                                  {hasOverride && (
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-background text-foreground shadow-sm">
                                         {isRecodeDecision(decision)
                                           ? decision.action === "create_variant"
                                             ? "→ Separate Variant"
                                             : decision.action === "link_vendor_pack"
                                               ? "→ Add Vendor Pack"
                                               : "→ Link Existing"
                                            : decision === null
                                              ? row.heldForReview ? "→ Leave Unlinked" : "→ Create FnB item"
                                              : "→ Link Existing"}
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
                                   {row.itemMatch.possibleRecode ? (
                                    <PackComparison
                                       source={row.itemMatch.sourcePackEvidence ?? row}
                                      candidate={row.itemMatch.candidatePackEvidence}
                                      status={row.itemMatch.packCompatibility}
                                      compact
                                    />
                                   ) : needsReview ? (
                                     <SourcePackEvidence source={row.itemMatch.sourcePackEvidence ?? row} />
                                   ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                    <StrategyLabel
                                      strategy={row.itemMatch.strategy}
                                      possibleRecode={row.itemMatch.possibleRecode}
                                      evidenceClass={row.itemMatch.recodeEvidenceClass}
                                    />
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
                                    codeGroupRowCount={
                                      row.sourceItemCode
                                        ? (actionableRecodeRowsByCode.get(row.sourceItemCode.trim())?.length ?? 1)
                                        : 1
                                    }
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
            {hasPendingRecodeDecisions && remainingHeldRows > 0
              ? `${pendingRecodeCodes.length} re-code ${pendingRecodeCodes.length === 1 ? "decision" : "decisions"} and ${remainingHeldRows} held ${remainingHeldRows === 1 ? "row" : "rows"} still need a choice.`
              : hasPendingRecodeDecisions
                ? `${pendingRecodeCodes.length} re-code ${pendingRecodeCodes.length === 1 ? "decision" : "decisions"} still required.`
                : remainingHeldRows > 0
                  ? `${remainingHeldRows} held ${remainingHeldRows === 1 ? "row" : "rows"} still need a choice.`
                  : resolvedHeldRows > 0
                    ? `${resolvedHeldRows} held ${resolvedHeldRows === 1 ? "row decision" : "row decisions"} recorded. Ready to approve.`
              : `You are approving ${s.totalRows.toLocaleString()} rows for ingestion.`}
          </div>
          <Button
            size="lg"
            onClick={() => submitApproval(false)}
            disabled={approvalDisabled}
            className="w-full md:w-auto shadow-md"
          >
            {approving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {approving
              ? "Starting approval..."
              : approvalIsRunning
                ? "Approval running..."
                : approvalJob?.status === "timed_out" || approvalJob?.status === "failed"
                  ? "Retry approval safely"
                  : `Approve ${s.totalRows.toLocaleString()} Rows`}
          </Button>
        </div>
      </div>
    </div>
  );
}
