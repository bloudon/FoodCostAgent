import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { History } from "lucide-react";
import { useState } from "react";

type PackEvent = {
  date: string;
  source: string;
  vendorName: string | null;
  vendorItemId: string | null;
  sku: string | null;
  packLabel: string | null;
  rawPack: string | null;
  canonicalQuantity: number | null;
  casePrice: number | null;
  pricePerCanonicalUnit: number | null;
  observedUnitPrice?: number | null;
  evidenceRef: string | null;
  evidenceType: "current_vendor" | "historical_invoice" | "price_observation";
  packEvidenceDate?: string | null;
  geometryStatus?: string | null;
};

type PackCount = {
  id: string;
  countDate: string;
  storeId: string;
  qty: number;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  inferredUnitsPerCase: number | null;
  countPackSnapshot: {
    unitId: string;
    containerSize: number;
    casePkgCount: number;
    containerLabel: string | null;
    recordedAt: string;
  } | null;
};

type PackHistory = {
  currentStandard: {
    canonicalUnitsPerCase: number;
    containersPerCase: number;
    canonicalUnitsPerContainer: number;
    label: string | null;
    effectiveDate: string | null;
    confirmation: string;
  } | null;
  events: PackEvent[];
  counts: PackCount[];
  transitions: {
    id: string;
    effectiveDate: string;
    fromVendorItemId: string;
    toVendorItemId: string;
    fromPackSnapshot: { vendorName: string; sku: string | null; canonicalQuantity: number; packLabel: string };
    toPackSnapshot: { vendorName: string; sku: string | null; canonicalQuantity: number; packLabel: string };
    evidenceNote: string;
    countingStandardConfirmed: number;
    createdAt: string;
  }[];
  corrections: PackCorrection[];
};

type PackCorrection = {
  id: string;
  originalTransitionId: string;
  supersedesCorrectionId: string | null;
  decision: "correct" | "void";
  effectiveDate: string;
  reason: string;
  fromVendorItemId: string | null;
  toVendorItemId: string | null;
  fromPackSnapshot: PackHistory["transitions"][number]["fromPackSnapshot"] | null;
  toPackSnapshot: PackHistory["transitions"][number]["toPackSnapshot"] | null;
  createdAt: string;
};

const dateLabel = (value: string) => {
  // Invoice/count dates are calendar dates; do not shift them via local timezone.
  const iso = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
};

const amount = (value: number | null, precision = 2) =>
  value == null ? "—" : `$${value.toFixed(precision)}`;

export function SupplierPackHistory({
  itemId,
  storeId,
  unitLabel,
}: {
  itemId: string;
  storeId: string | null | undefined;
  unitLabel: string;
}) {
  const { user } = useAuth();
  const canConfirm = ["global_admin", "company_admin"].includes(user?.role ?? "");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [confirmCountingStandard, setConfirmCountingStandard] = useState(false);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"correct" | "void">("correct");
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctedFrom, setCorrectedFrom] = useState("");
  const [correctedTo, setCorrectedTo] = useState("");
  const { data, isLoading, isError } = useQuery<PackHistory>({
    queryKey: ["/api/inventory-items", itemId, "pack-history", storeId],
    queryFn: async () => {
      const query = storeId && storeId !== "all" ? `?storeId=${encodeURIComponent(storeId)}` : "";
      const response = await fetch(`/api/inventory-items/${itemId}/pack-history${query}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load supplier pack history");
      return response.json();
    },
    enabled: !!itemId,
  });
  const confirmTransition = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/inventory-items/${itemId}/pack-history/transitions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromVendorItemId: fromId, toVendorItemId: toId, effectiveDate, evidenceNote, confirmCountingStandard }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not record the transition");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", itemId, "pack-history"] });
      setFromId("");
      setToId("");
      setEffectiveDate("");
      setEvidenceNote("");
      setConfirmCountingStandard(false);
      setFormError("");
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const correctTransition = useMutation({
    mutationFn: async ({ transitionId, expectedCorrectionId }: { transitionId: string; expectedCorrectionId: string | null }) => {
      const response = await fetch(`/api/inventory-items/${itemId}/pack-history/transitions/${transitionId}/corrections`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision, effectiveDate: correctionDate, reason: correctionReason, expectedCorrectionId,
          ...(decision === "correct" ? { fromVendorItemId: correctedFrom, toVendorItemId: correctedTo } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not record correction");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", itemId, "pack-history"] });
      setEditingId(null);
      setFormError("");
    },
    onError: (error: Error) => {
      setFormError(error.message);
      // A stale form must be refreshed before the administrator can submit again.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items", itemId, "pack-history"] });
    },
  });

  const positiveCounts = data?.counts.filter(row => row.qty > 0 && row.caseQty != null && row.caseQty > 0) ?? [];
  const zeroCountDates = [...new Set(
    (data?.counts ?? []).filter(row => row.qty === 0 && row.caseQty == null).map(row => dateLabel(row.countDate)),
  )];
  const products = (data?.events ?? []).filter(
    (event): event is PackEvent & { vendorItemId: string } =>
      event.evidenceType === "current_vendor" && !!event.vendorItemId,
  );

  return (
    <Card data-testid="supplier-pack-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Supplier pack & count history</CardTitle>
        <CardDescription>Evidence by date. Different supplier products are not automatically treated as replacements.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">Loading pack history…</p>}
        {isError && <p className="text-sm text-destructive">Could not load pack history. Please try again.</p>}
        {data && (
          <>
            <section className="rounded-md border bg-muted/30 p-3">
              <h3 className="text-sm font-semibold">Current counting standard</h3>
              {data.currentStandard ? (
                <p className="mt-1 text-sm">
                  1 case = {data.currentStandard.containersPerCase} {data.currentStandard.label || "containers"} ×{" "}
                  {data.currentStandard.canonicalUnitsPerContainer} {unitLabel} ={" "}
                  <strong>{data.currentStandard.canonicalUnitsPerCase} {unitLabel}</strong>
                  <span className="block text-xs text-muted-foreground mt-1">
                    {data.currentStandard.confirmation === "operator_recorded"
                      ? `Operator transition recorded${data.currentStandard.effectiveDate ? ` for ${dateLabel(data.currentStandard.effectiveDate)}` : ""}; past counts remain unchanged.`
                      : "Currently configured; effective date and confirmation source were not recorded. This does not change past counts."}
                  </span>
                </p>
              ) : <p className="text-sm text-muted-foreground mt-1">No complete package counting standard configured.</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Confirmed product transitions</h3>
              {(data.transitions ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No predecessor or replacement has been confirmed for this item.</p>
              ) : data.transitions.map(transition => {
                const remaining = (data.corrections ?? []).filter(row => row.originalTransitionId === transition.id);
                const corrections: PackCorrection[] = [];
                let priorId: string | null = null;
                while (corrections.length < remaining.length) {
                  const next = remaining.find(row => row.supersedesCorrectionId === priorId);
                  if (!next) break;
                  corrections.push(next);
                  priorId = next.id;
                }
                const head = corrections.find(row => !corrections.some(next => next.supersedesCorrectionId === row.id)) ?? null;
                const current = head?.decision === "correct" ? head : head?.decision === "void" ? null : transition;
                const startCorrection = () => {
                  setEditingId(transition.id);
                  setDecision("correct");
                  setCorrectionDate(current?.effectiveDate ?? transition.effectiveDate);
                  setCorrectedFrom(current?.fromVendorItemId ?? transition.fromVendorItemId);
                  setCorrectedTo(current?.toVendorItemId ?? transition.toVendorItemId);
                  setCorrectionReason("");
                  setFormError("");
                };
                return <div key={transition.id} className="rounded-md border p-3 text-sm" data-testid="confirmed-pack-transition">
                  <strong>{dateLabel(transition.effectiveDate)} · Operator-recorded replacement</strong>
                   {head && <span className="ml-2 text-amber-700 dark:text-amber-300">Superseded by {head.decision === "void" ? "void" : "correction"}</span>}
                  <p className="mt-1">
                    {transition.fromPackSnapshot.vendorName} {transition.fromPackSnapshot.sku || ""}{" "}
                    ({transition.fromPackSnapshot.packLabel}, {transition.fromPackSnapshot.canonicalQuantity} {unitLabel})
                    {" → "}
                    {transition.toPackSnapshot.vendorName} {transition.toPackSnapshot.sku || ""}{" "}
                    ({transition.toPackSnapshot.packLabel}, {transition.toPackSnapshot.canonicalQuantity} {unitLabel})
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Basis: {transition.evidenceNote}</p>
                   {head && transition.countingStandardConfirmed === 1 && <p className="text-xs text-muted-foreground mt-1">The original counting-standard confirmation is not carried forward by this correction.</p>}
                   {corrections.map(row => <div key={row.id} className="mt-3 border-l-2 pl-3" data-testid="pack-transition-correction">
                     <strong>{dateLabel(row.effectiveDate)} · {row.decision === "void" ? "Voided approval" : "Corrected replacement"}{row.id === head?.id ? " (latest decision)" : " (superseded)"}</strong>
                     {row.decision === "correct" && row.fromPackSnapshot && row.toPackSnapshot && <p className="mt-1">
                       {row.fromPackSnapshot.vendorName} {row.fromPackSnapshot.sku || ""} ({row.fromPackSnapshot.packLabel}, {row.fromPackSnapshot.canonicalQuantity} {unitLabel})
                       {" → "}
                       {row.toPackSnapshot.vendorName} {row.toPackSnapshot.sku || ""} ({row.toPackSnapshot.packLabel}, {row.toPackSnapshot.canonicalQuantity} {unitLabel})
                     </p>}
                     <p className="text-xs text-muted-foreground">Reason: {row.reason} · Recorded {dateLabel(row.createdAt)}</p>
                   </div>)}
                   {canConfirm && editingId !== transition.id && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={startCorrection}>Correct or void approval</Button>}
                   {canConfirm && editingId === transition.id && <form className="mt-3 space-y-3 border-t pt-3" onSubmit={event => {
                     event.preventDefault();
                     setFormError("");
                     correctTransition.mutate({ transitionId: transition.id, expectedCorrectionId: head?.id ?? null });
                   }}>
                     <p className="text-xs text-muted-foreground">This adds a new decision; the original and all saved counts, prices, invoices and pack snapshots remain unchanged.</p>
                     <div className="space-y-1">
                       <Label htmlFor={`correction-kind-${transition.id}`}>Decision</Label>
                       <select id={`correction-kind-${transition.id}`} className="w-full rounded-md border bg-background px-3 py-2" value={decision} onChange={e => setDecision(e.target.value as "correct" | "void")}>
                         <option value="correct">Correct replacement</option><option value="void">Void approval</option>
                       </select>
                     </div>
                     {decision === "correct" && <div className="grid gap-3 sm:grid-cols-2">
                       <div className="space-y-1"><Label htmlFor="corrected-from">Correct previous product</Label>
                         <select id="corrected-from" required className="w-full rounded-md border bg-background px-3 py-2" value={correctedFrom} onChange={e => setCorrectedFrom(e.target.value)}>
                           <option value="">Select previous</option>{products.map(e => <option key={e.vendorItemId} value={e.vendorItemId}>{e.vendorName} · {e.sku || e.packLabel || e.vendorItemId}</option>)}
                         </select>
                       </div>
                       <div className="space-y-1"><Label htmlFor="corrected-to">Correct replacement product</Label>
                         <select id="corrected-to" required className="w-full rounded-md border bg-background px-3 py-2" value={correctedTo} onChange={e => setCorrectedTo(e.target.value)}>
                           <option value="">Select replacement</option>{products.map(e => <option key={e.vendorItemId} value={e.vendorItemId}>{e.vendorName} · {e.sku || e.packLabel || e.vendorItemId}</option>)}
                         </select>
                       </div>
                     </div>}
                     <div className="space-y-1"><Label htmlFor="correction-date">Decision effective date</Label>
                       <Input id="correction-date" type="date" required value={correctionDate} onChange={e => setCorrectionDate(e.target.value)} />
                     </div>
                     <div className="space-y-1"><Label htmlFor="correction-reason">Reason for {decision === "void" ? "voiding" : "correction"}</Label>
                       <Input id="correction-reason" required minLength={10} maxLength={500} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} />
                     </div>
                     {formError && <p role="alert" className="text-destructive">{formError}</p>}
                     <div className="flex gap-2"><Button size="sm" type="submit" disabled={correctTransition.isPending || (decision === "correct" && (!correctedFrom || !correctedTo || correctedFrom === correctedTo))}>
                       {correctTransition.isPending ? "Recording…" : "Record decision"}
                     </Button><Button size="sm" type="button" variant="ghost" onClick={() => { setEditingId(null); setFormError(""); }}>Cancel</Button></div>
                   </form>}
                </div>;
              })}
              {canConfirm && products.length >= 2 && (
                <form className="rounded-md border p-3 space-y-3" onSubmit={event => {
                  event.preventDefault();
                  setFormError("");
                  confirmTransition.mutate();
                }}>
                  <p className="text-xs text-muted-foreground">
                    Record only a replacement you have verified. The effective date is your decision, not the supplier price date.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="pack-transition-from">Previous product</Label>
                      <select id="pack-transition-from" required className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={fromId} onChange={e => setFromId(e.target.value)}>
                        <option value="">Select previous</option>
                        {products.map(e => <option key={e.vendorItemId} value={e.vendorItemId}>{e.vendorName} · {e.sku || e.packLabel || e.vendorItemId}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pack-transition-to">Replacement product</Label>
                      <select id="pack-transition-to" required className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={toId} onChange={e => setToId(e.target.value)}>
                        <option value="">Select replacement</option>
                        {products.map(e => <option key={e.vendorItemId} value={e.vendorItemId}>{e.vendorName} · {e.sku || e.packLabel || e.vendorItemId}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pack-transition-date">Effective date</Label>
                      <Input id="pack-transition-date" type="date" required value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pack-transition-basis">Evidence or approval basis</Label>
                    <Input id="pack-transition-basis" required minLength={10} maxLength={500} value={evidenceNote} onChange={e => setEvidenceNote(e.target.value)} placeholder="Describe the invoice, supplier notice, or verified manager decision" />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={confirmCountingStandard} onChange={e => setConfirmCountingStandard(e.target.checked)} />
                    <span>Also confirm the replacement pack is the current counting standard. This is accepted only when its verified quantity matches the item's configured case.</span>
                  </label>
                  {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
                  <Button type="submit" size="sm" disabled={confirmTransition.isPending || !fromId || !toId || fromId === toId}>
                    {confirmTransition.isPending ? "Recording…" : "Record verified replacement"}
                  </Button>
                </form>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Supplier evidence</h3>
              {data.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No dated supplier price or invoice evidence is linked to this item.</p>
              ) : (
                <div className="space-y-2">
                  {data.events.map((event, index) => (
                    <div key={`${event.evidenceType}-${event.evidenceRef ?? event.vendorItemId ?? index}-${index}`} className="rounded-md border p-3 text-sm" data-testid="pack-history-event">
                      <div className="flex flex-wrap items-baseline justify-between gap-1">
                        <strong>{event.vendorName || "Supplier not recorded"} · {event.sku ? `SKU ${event.sku}` : "SKU not recorded"}</strong>
                        <span className="text-xs text-muted-foreground">{dateLabel(event.date)}</span>
                      </div>
                      <p className="mt-1">
                        {event.packLabel || event.rawPack || "Pack not recorded"} · Case price {amount(event.casePrice)}
                        {event.pricePerCanonicalUnit != null && ` · ${amount(event.pricePerCanonicalUnit, 4)}/${unitLabel}`}
                        {event.observedUnitPrice != null && ` · Recorded unit price ${amount(event.observedUnitPrice, 4)} (basis not verified)`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {event.evidenceType === "historical_invoice"
                          ? "Dated invoice pack evidence; conversion requires verified source geometry"
                          : event.evidenceType === "price_observation"
                            ? "Dated price observation; pack at that date not recorded"
                            : `Current supplier record; date is the price observation, not proof of when this pack began${event.packEvidenceDate ? ` (pack last checked ${dateLabel(event.packEvidenceDate)})` : ""}`}
                        {" · "}{event.source}
                      </p>
                      {event.evidenceType === "current_vendor" && event.pricePerCanonicalUnit == null && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          Comparable unit price unavailable; verify pack geometry and pricing basis.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!data.events.some(e => e.evidenceType === "historical_invoice") && (
                <p className="text-xs text-muted-foreground">No linked historical invoice lines for this item.</p>
              )}
              {!data.events.some(e => e.evidenceType === "price_observation") && (
                <p className="text-xs text-muted-foreground">No dated price-history observations for this item; current vendor prices are shown separately.</p>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Saved count evidence</h3>
              {positiveCounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved positive case counts in accessible sessions.</p>
              ) : positiveCounts.map(line => {
                const snap = line.countPackSnapshot;
                return (
                  <div key={line.id} className="rounded-md border p-3 text-sm" data-testid="pack-history-count">
                    <strong>{dateLabel(line.countDate)}</strong>
                    <span className="ml-2">{line.caseQty} case{line.caseQty === 1 ? "" : "s"} · {line.qty} {unitLabel} saved</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {snap
                        ? `Conversion saved with count: ${snap.casePkgCount} × ${snap.containerSize} ${unitLabel} per case`
                        : line.inferredUnitsPerCase != null
                          ? `${line.inferredUnitsPerCase} ${unitLabel}/case implied by saved total; original pack identity not verified`
                          : "Original pack conversion not recorded; do not apply today's case size"}
                    </p>
                  </div>
                );
              })}
              {zeroCountDates.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Zero-only lines on {zeroCountDates.join(", ")} do not prove a case size or a completed count.
                </p>
              )}
            </section>
            {(data.transitions ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground border-t pt-3">
                A replacement date or predecessor relationship is not recorded. Confirm it from source evidence before treating two packs as a replacement.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}