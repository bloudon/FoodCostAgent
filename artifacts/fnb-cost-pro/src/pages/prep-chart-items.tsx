import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Clock, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";
import { Link } from "wouter";

interface PrepItem {
  id: string;
  name: string;
  outputUnit: string;
  outputQtyPerBatch: number;
  shelfLifeHours: number;
  prepLeadMinutes: number;
  stationId: string | null;
  yieldPercent: number;
  active: number;
}

interface Station {
  id: string;
  name: string;
}

function PrepChartItemsContent() {
  const { toast } = useToast();

  const { data: prepItems = [], isLoading } = useQuery<PrepItem[]>({
    queryKey: ["/api/prep-items"],
  });

  const { data: stations = [] } = useQuery<Station[]>({
    queryKey: ["/api/stations"],
  });

  const stationMap = new Map(stations.map(s => [s.id, s.name]));

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/prep-items/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prep-items"] });
      toast({ title: "Prep item deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-prep-items">Prep Items</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define batch-produced kitchen outputs (sauces, proteins, doughs). These drive your prep chart recommendations.
          </p>
        </div>
        <Button asChild data-testid="button-new-prep-item">
          <Link href="/prep-chart/items/new">
            <Plus className="h-4 w-4 mr-2" />
            New Prep Item
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-md" />)}
        </div>
      ) : prepItems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No prep items yet</p>
            <p className="text-sm mt-1">Create your first prep item to get started with prep chart planning.</p>
            <Button className="mt-4" asChild>
              <Link href="/prep-chart/items/new">
                <Plus className="h-4 w-4 mr-2" /> New Prep Item
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-prep-items">
          {prepItems.map(item => (
            <Card key={item.id} data-testid={`card-prep-item-${item.id}`}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" data-testid={`text-prep-item-name-${item.id}`}>
                        {item.name}
                      </span>
                      {item.active === 0 && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      {item.stationId && stationMap.get(item.stationId) && (
                        <Badge variant="outline" className="text-xs">{stationMap.get(item.stationId)}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span data-testid={`text-batch-output-${item.id}`}>
                        Batch: {item.outputQtyPerBatch} {item.outputUnit}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Expires {item.shelfLifeHours}h · {item.prepLeadMinutes}min lead
                      </span>
                      {item.yieldPercent !== 100 && (
                        <span>Yield: {item.yieldPercent}%</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" asChild data-testid={`button-edit-prep-item-${item.id}`}>
                      <Link href={`/prep-chart/items/${item.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-prep-item-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PrepChartItems() {
  return (
    <TierGate feature="prep_chart">
      <PrepChartItemsContent />
    </TierGate>
  );
}
