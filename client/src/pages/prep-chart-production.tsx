import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChefHat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { useStoreContext } from "@/hooks/use-store-context";
import { format } from "date-fns";

interface PrepItem { id: string; name: string; outputUnit: string; outputQtyPerBatch: number }
interface PrepProductionRecord {
  id: string;
  prepItemId: string;
  quantityProduced: number;
  batchCount: number;
  producedAt: string;
  notes: string | null;
}

function PrepProductionContent() {
  const { selectedStoreId } = useStoreContext();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [prepItemId, setPrepItemId] = useState("");
  const [batchCount, setBatchCount] = useState("1");
  const [notes, setNotes] = useState("");

  const { data: prepItems = [] } = useQuery<PrepItem[]>({ queryKey: ["/api/prep-items"] });

  const { data: records = [], isLoading } = useQuery<PrepProductionRecord[]>({
    queryKey: ["/api/prep-production-records", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return [];
      const res = await fetch(`/api/prep-production-records?storeId=${selectedStoreId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedStoreId,
  });

  const prepItemMap = new Map(prepItems.map(p => [p.id, p]));

  const selectedItem = prepItemMap.get(prepItemId);
  const qtyProduced = selectedItem ? Number(batchCount) * selectedItem.outputQtyPerBatch : 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prep-production-records", {
        prepItemId,
        storeId: selectedStoreId,
        quantityProduced: qtyProduced,
        batchCount: Number(batchCount),
        notes: notes || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prep-production-records"] });
      setIsOpen(false);
      setPrepItemId("");
      setBatchCount("1");
      setNotes("");
      toast({ title: "Production logged" });
    },
    onError: () => toast({ title: "Failed to log production", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-production-log">Production Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Record completed prep runs. These help track what was produced vs. what was recommended.
          </p>
        </div>
        <Button onClick={() => setIsOpen(true)} data-testid="button-log-production">
          <Plus className="h-4 w-4 mr-2" />
          Log Production
        </Button>
      </div>

      {!selectedStoreId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Select a store to view production records.</CardContent></Card>
      ) : isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}</div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ChefHat className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No production records yet</p>
            <p className="text-sm mt-1">Log a completed prep run to start tracking production history.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="list-production-records">
          {records.map(r => {
            const item = prepItemMap.get(r.prepItemId);
            return (
              <Card key={r.id} data-testid={`row-production-${r.id}`}>
                <CardContent className="py-3 px-5">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5">
                      <span className="font-medium text-sm">{item?.name ?? r.prepItemId}</span>
                      <div className="text-xs text-muted-foreground">
                        {r.quantityProduced} {item?.outputUnit ?? "units"} · {r.batchCount} batch{r.batchCount !== 1 ? "es" : ""} · {format(new Date(r.producedAt), "MMM d, h:mma")}
                        {r.notes && <span className="ml-2 italic">"{r.notes}"</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent data-testid="dialog-log-production">
          <DialogHeader>
            <DialogTitle>Log Production Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Prep Item</Label>
              <Select value={prepItemId} onValueChange={setPrepItemId}>
                <SelectTrigger data-testid="select-production-prep-item">
                  <SelectValue placeholder="Select prep item…" />
                </SelectTrigger>
                <SelectContent>
                  {prepItems.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Number of Batches</Label>
              <Input type="number" min="0.5" step="0.5" value={batchCount} onChange={e => setBatchCount(e.target.value)} data-testid="input-batch-count" />
              {selectedItem && Number(batchCount) > 0 && (
                <p className="text-xs text-muted-foreground">
                  = {qtyProduced.toFixed(1)} {selectedItem.outputUnit} produced ({selectedItem.outputQtyPerBatch} {selectedItem.outputUnit} per batch)
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this run…" rows={2} data-testid="input-production-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!prepItemId || !batchCount || !selectedStoreId || createMutation.isPending} data-testid="button-submit-production">
              {createMutation.isPending ? "Logging…" : "Log Production"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PrepChartProduction() {
  return (
    <TierGate feature="prep_chart">
      <PrepProductionContent />
    </TierGate>
  );
}
