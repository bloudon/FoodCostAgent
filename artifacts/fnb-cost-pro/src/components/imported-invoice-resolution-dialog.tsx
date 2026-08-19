import { useDeferredValue, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ImportedInvoiceResolutionLine {
  id: string;
  description: string | null;
  itemCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  pack: unknown;
  sourceGlCode: string | null;
  sourceCategory: string | null;
}

interface Candidate {
  vendorItemId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  vendorSku: string | null;
  brandName: string | null;
  caseSize: number;
  innerPackSize: number | null;
  packUom: string | null;
}

interface ResolutionPreview {
  impact: {
    occurrenceCount: number;
    affectedOccurrenceCount: number;
    spend: number;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
  };
  classification: null | {
    status: "SAFE_CANDIDATE" | "AMBIGUOUS" | "CONFLICT" | "NO_CANDIDATE";
    reasons: string[];
    packCrossCheck: "match" | "conflict" | "unverifiable" | null;
    canConfirm: boolean;
    target: {
      vendorItemId: string;
      inventoryItemId: string;
      inventoryItemName: string | null;
    } | null;
  };
  blockers: string[];
}

function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function packLabel(candidate: Candidate) {
  const pieces = [
    candidate.caseSize ? `${candidate.caseSize}` : null,
    candidate.innerPackSize ? `× ${candidate.innerPackSize}` : null,
    candidate.packUom,
  ].filter(Boolean);
  return pieces.join(" ") || "Pack not recorded";
}

function sourcePackLabel(pack: unknown) {
  if (typeof pack === "string") return pack.trim() || "—";
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return "—";
  const object = pack as Record<string, unknown>;
  if (typeof object.raw === "string" && object.raw.trim()) return object.raw.trim();
  const values = Object.entries(object)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return values.join(", ") || "—";
}

export function ImportedInvoiceResolutionDialog({
  open,
  onOpenChange,
  invoiceId,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  line: ImportedInvoiceResolutionLine | null;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setConfirmed(false);
    }
  }, [open]);

  const basePath = line
    ? `/api/imported-invoices/${invoiceId}/lines/${line.id}`
    : "";
  const previewPath = selected
    ? `${basePath}/resolution-preview?vendorItemId=${encodeURIComponent(selected.vendorItemId)}`
    : `${basePath}/resolution-preview`;
  const { data: preview, isLoading: previewLoading } = useQuery<ResolutionPreview>({
    queryKey: [previewPath],
    enabled: open && !!line,
  });
  const candidatePath = `${basePath}/resolution-candidates?q=${encodeURIComponent(deferredSearch)}`;
  const { data: candidates = [], isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: [candidatePath],
    enabled: open && !!line && !!line.itemCode && preview?.blockers.length === 0,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected || !line) throw new Error("Select a vendor product.");
      const response = await apiRequest("POST", `${basePath}/resolve`, {
        vendorItemId: selected.vendorItemId,
        confirm: confirmed,
      });
      return response.json();
    },
    onSuccess: async (result: { affectedOccurrenceCount: number }) => {
      await queryClient.invalidateQueries({ queryKey: [`/api/imported-invoices/${invoiceId}`] });
      toast({
        title: "Ingredient resolved",
        description: `${result.affectedOccurrenceCount} historical occurrence${result.affectedOccurrenceCount === 1 ? "" : "s"} linked.`,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Resolution blocked",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit = !!selected &&
    confirmed &&
    preview?.classification?.canConfirm === true &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-resolve-ingredient">
        <DialogHeader>
          <DialogTitle>Resolve ingredient</DialogTitle>
          <DialogDescription>
            Link this Orderly source item code to an existing vendor product. Source invoice evidence will not change.
          </DialogDescription>
        </DialogHeader>

        {line && (
          <div className="space-y-5">
            <section className="rounded-lg border bg-muted/30 p-4" aria-label="Immutable source evidence">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-medium">Source evidence</h3>
                <Badge variant="outline">Read only</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                <div><dt className="text-muted-foreground">Item code</dt><dd className="font-mono">{line.itemCode || "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Description</dt><dd>{line.description || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Line total</dt><dd>{money(line.lineTotal)}</dd></div>
                <div><dt className="text-muted-foreground">Source pack</dt><dd data-testid="text-resolution-source-pack">{sourcePackLabel(line.pack)}</dd></div>
                <div><dt className="text-muted-foreground">Quantity</dt><dd>{line.quantity ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Unit price</dt><dd>{money(line.unitPrice)}</dd></div>
                <div><dt className="text-muted-foreground">Source GL</dt><dd>{line.sourceGlCode || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Category</dt><dd>{line.sourceCategory || "—"}</dd></div>
              </dl>
            </section>

            {preview?.blockers?.length ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  This line cannot be resolved
                </div>
                {preview.blockers.map(reason => <p key={reason}>{reason}</p>)}
              </div>
            ) : null}

            {preview && (
              <section className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm md:grid-cols-4" data-testid="resolution-impact-summary">
                <div><div className="text-muted-foreground">Occurrences</div><div className="font-semibold">{preview.impact.occurrenceCount}</div></div>
                <div><div className="text-muted-foreground">Will update</div><div className="font-semibold">{preview.impact.affectedOccurrenceCount}</div></div>
                <div><div className="text-muted-foreground">Historical spend</div><div className="font-semibold">{money(preview.impact.spend)}</div></div>
                <div>
                  <div className="text-muted-foreground">Date range</div>
                  <div className="font-semibold">
                    {preview.impact.dateRangeStart
                      ? `${preview.impact.dateRangeStart} – ${preview.impact.dateRangeEnd}`
                      : "—"}
                  </div>
                </div>
              </section>
            )}

            {!preview?.blockers?.length && (
              <section className="space-y-3">
                <Label htmlFor="resolution-search">Existing ingredient or vendor SKU</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="resolution-search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Search ingredient name, brand, or vendor SKU"
                    className="pl-9"
                    data-testid="input-resolution-search"
                  />
                </div>
                <ScrollArea className="h-52 rounded-md border">
                  <div className="p-2">
                    {candidatesLoading ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">Searching…</p>
                    ) : candidates.length === 0 ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">No existing vendor products found.</p>
                    ) : candidates.map(candidate => (
                      <button
                        key={candidate.vendorItemId}
                        type="button"
                        onClick={() => {
                          setSelected(candidate);
                          setConfirmed(false);
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
                        data-testid={`candidate-${candidate.vendorItemId}`}
                      >
                        <div>
                          <div className="font-medium">{candidate.inventoryItemName}</div>
                          <div className="text-xs text-muted-foreground">
                            SKU {candidate.vendorSku || "—"} · {candidate.brandName || "No brand"} · {packLabel(candidate)}
                          </div>
                        </div>
                        {selected?.vendorItemId === candidate.vendorItemId && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </section>
            )}

            {selected && (
              <section className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{selected.inventoryItemName}</div>
                    <div className="text-sm text-muted-foreground">Vendor SKU {selected.vendorSku || "—"}</div>
                  </div>
                  {preview?.classification && (
                    <Badge variant={preview.classification.canConfirm ? "default" : "destructive"}>
                      {preview.classification.canConfirm ? "Safe to link" : "Blocked"}
                    </Badge>
                  )}
                </div>
                {previewLoading && <p className="mt-3 text-sm text-muted-foreground">Checking source identity…</p>}
                {preview?.classification?.reasons.map(reason => (
                  <p key={reason} className="mt-2 text-sm text-destructive">{reason}</p>
                ))}
                {preview?.classification?.canConfirm && (
                  <div className="mt-4 flex items-start gap-2">
                    <Checkbox
                      id="confirm-resolution"
                      checked={confirmed}
                      onCheckedChange={value => setConfirmed(value === true)}
                      data-testid="checkbox-confirm-resolution"
                    />
                    <Label htmlFor="confirm-resolution" className="font-normal leading-5">
                      I confirm this source item code identifies {selected.inventoryItemName}. Apply the mapping to the eligible historical occurrences shown above and future imports.
                    </Label>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            data-testid="button-confirm-resolution"
          >
            {mutation.isPending ? "Resolving…" : "Confirm resolution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}