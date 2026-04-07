import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { useStoreContext } from "@/hooks/use-store-context";
import { format, differenceInMinutes } from "date-fns";

interface PrepItem { id: string; name: string; outputUnit: string; shelfLifeHours: number }
interface PrepOnHand {
  id: string;
  prepItemId: string;
  quantityOnHand: number;
  preparedAt: string;
  expiresAt: string;
  locationId: string | null;
}

function PrepOnHandContent() {
  const { selectedStoreId } = useStoreContext();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [prepItemId, setPrepItemId] = useState("");
  const [qty, setQty] = useState("");
  const [preparedAt, setPreparedAt] = useState(() => new Date().toISOString().slice(0, 16));

  const { data: prepItems = [] } = useQuery<PrepItem[]>({ queryKey: ["/api/prep-items"] });

  const { data: onHand = [], isLoading } = useQuery<PrepOnHand[]>({
    queryKey: ["/api/prep-on-hand", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return [];
      const res = await fetch(`/api/prep-on-hand?storeId=${selectedStoreId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedStoreId,
  });

  const prepItemMap = new Map(prepItems.map(p => [p.id, p]));

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prep-on-hand", {
        prepItemId,
        storeId: selectedStoreId,
        quantityOnHand: Number(qty),
        preparedAt: new Date(preparedAt).toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prep-on-hand"] });
      setIsOpen(false);
      setPrepItemId("");
      setQty("");
      toast({ title: "On-hand entry logged" });
    },
    onError: () => toast({ title: "Failed to log entry", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/prep-on-hand/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prep-on-hand"] });
      toast({ title: "Entry removed" });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  const getExpiryStatus = (expiresAt: string) => {
    const minsLeft = differenceInMinutes(new Date(expiresAt), new Date());
    if (minsLeft < 0) return "expired";
    if (minsLeft < 120) return "expiring-soon";
    return "ok";
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-on-hand">Prep On Hand</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track available prep stock. Only non-expired entries are counted in chart calculations.
          </p>
        </div>
        <Button onClick={() => setIsOpen(true)} data-testid="button-log-on-hand">
          <Plus className="h-4 w-4 mr-2" />
          Log On Hand
        </Button>
      </div>

      {!selectedStoreId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Select a store to view on-hand prep.</CardContent></Card>
      ) : isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}</div>
      ) : onHand.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No on-hand entries. Log prep quantities above.</CardContent></Card>
      ) : (
        <div className="space-y-2" data-testid="list-on-hand">
          {onHand.map(entry => {
            const item = prepItemMap.get(entry.prepItemId);
            const status = getExpiryStatus(entry.expiresAt);
            const minsLeft = differenceInMinutes(new Date(entry.expiresAt), new Date());
            const hrsLeft = Math.floor(minsLeft / 60);
            const minRemainder = minsLeft % 60;
            return (
              <Card key={entry.id} data-testid={`row-on-hand-${entry.id}`}>
                <CardContent className="py-3 px-5">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{item?.name ?? entry.prepItemId}</span>
                        <Badge variant={status === "expired" ? "destructive" : status === "expiring-soon" ? "secondary" : "outline"} className="text-xs">
                          {status === "expired"
                            ? "Expired"
                            : status === "expiring-soon"
                              ? <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {hrsLeft}h {minRemainder}m left</span>
                              : <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{hrsLeft}h left</span>
                          }
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {entry.quantityOnHand} {item?.outputUnit ?? "units"} · prepped {format(new Date(entry.preparedAt), "MMM d h:mma")} · expires {format(new Date(entry.expiresAt), "MMM d h:mma")}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(entry.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-on-hand-${entry.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent data-testid="dialog-log-on-hand">
          <DialogHeader>
            <DialogTitle>Log On-Hand Prep</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Prep Item</Label>
              <Select value={prepItemId} onValueChange={setPrepItemId}>
                <SelectTrigger data-testid="select-on-hand-prep-item">
                  <SelectValue placeholder="Select prep item…" />
                </SelectTrigger>
                <SelectContent>
                  {prepItems.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Quantity On Hand</Label>
              <Input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="Enter qty…" data-testid="input-on-hand-qty" />
            </div>
            <div className="space-y-1">
              <Label>Prepared At</Label>
              <Input type="datetime-local" value={preparedAt} onChange={e => setPreparedAt(e.target.value)} data-testid="input-prepared-at" />
              {prepItemId && (
                <p className="text-xs text-muted-foreground">
                  Expires {prepItemMap.get(prepItemId)?.shelfLifeHours}h after prep time
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!prepItemId || !qty || !selectedStoreId || createMutation.isPending} data-testid="button-submit-on-hand">
              {createMutation.isPending ? "Logging…" : "Log Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PrepChartOnHand() {
  return (
    <TierGate feature="prep_chart">
      <PrepOnHandContent />
    </TierGate>
  );
}
