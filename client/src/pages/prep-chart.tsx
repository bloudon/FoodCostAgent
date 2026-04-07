import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, RefreshCw, CheckCircle2 } from "lucide-react";
import { TierGate } from "@/components/tier-gate";
import { useStoreContext } from "@/hooks/use-store-context";
import { format } from "date-fns";

interface Daypart { id: string; name: string; startTime: string | null }
interface Station { id: string; name: string }
interface PrepItem { id: string; name: string; outputUnit: string; outputQtyPerBatch: number }

interface ChartLine {
  id: string;
  prepItemId: string;
  stationId: string | null;
  forecastQty: number;
  onHandQty: number;
  recommendedQty: number;
  recommendedBatches: number;
  dueTime: string | null;
  confidenceScore: number | null;
  reasoningSummary: string | null;
}

interface ChartResult {
  run: {
    id: string;
    generatedAt: string;
    basedOnMode: string;
    bufferPercent: number;
    weeksLookback: number;
  };
  lines: ChartLine[];
}

function PrepChartContent() {
  const { selectedStoreId } = useStoreContext();
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [daypartId, setDaypartId] = useState<string>("");
  const [bufferPercent, setBufferPercent] = useState("10");
  const [chartResult, setChartResult] = useState<ChartResult | null>(null);

  const { data: dayparts = [] } = useQuery<Daypart[]>({ queryKey: ["/api/dayparts"] });
  const { data: stations = [] } = useQuery<Station[]>({ queryKey: ["/api/stations"] });
  const { data: prepItems = [] } = useQuery<PrepItem[]>({ queryKey: ["/api/prep-items"] });

  const stationMap = new Map(stations.map(s => [s.id, s.name]));
  const prepItemMap = new Map(prepItems.map(p => [p.id, p]));

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prep-chart/generate", {
        storeId: selectedStoreId,
        businessDate: new Date(businessDate).toISOString(),
        daypartId: daypartId || undefined,
        bufferPercent: Number(bufferPercent),
        weeksLookback: 4,
      });
      return res.json() as Promise<ChartResult>;
    },
    onSuccess: (data) => setChartResult(data),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="heading-prep-chart">Prep Chart</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate production recommendations based on historical sales averages.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label>Business Date</Label>
              <Input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} data-testid="input-business-date" />
            </div>
            <div className="space-y-1">
              <Label>Daypart</Label>
              <Select value={daypartId || "__all__"} onValueChange={v => setDaypartId(v === "__all__" ? "" : v)}>
                <SelectTrigger data-testid="select-daypart">
                  <SelectValue placeholder="All day" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All day</SelectItem>
                  {dayparts.map(dp => (
                    <SelectItem key={dp.id} value={dp.id}>
                      {dp.name}{dp.startTime ? ` (${dp.startTime})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Safety Buffer %</Label>
              <Input type="number" min="0" max="50" value={bufferPercent} onChange={e => setBufferPercent(e.target.value)} data-testid="input-buffer-pct" />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={!selectedStoreId || !businessDate || generateMutation.isPending}
                data-testid="button-generate-chart"
              >
                {generateMutation.isPending
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                  : <><ClipboardList className="h-4 w-4 mr-2" /> Generate Chart</>
                }
              </Button>
            </div>
          </div>
          {!selectedStoreId && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3">Select a store from the sidebar to generate a chart.</p>
          )}
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {generateMutation.isPending && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {/* Chart results */}
      {chartResult && !generateMutation.isPending && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Generated {format(new Date(chartResult.run.generatedAt), "MMM d, h:mma")} · {chartResult.run.weeksLookback}-week lookback · {chartResult.run.bufferPercent}% buffer
          </div>

          {chartResult.lines.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No prep items found</p>
                <p className="text-sm mt-1">Add active prep items with menu-item usages in the Prep Items page to see recommendations here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-md border" data-testid="section-chart-results">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="py-2 px-4 font-medium">Prep Item</th>
                    <th className="py-2 px-4 font-medium">Station</th>
                    <th className="py-2 px-4 font-medium">Recommended Qty</th>
                    <th className="py-2 px-4 font-medium">Batches</th>
                    <th className="py-2 px-4 font-medium">On Hand</th>
                    <th className="py-2 px-4 font-medium">Due By</th>
                    <th className="py-2 px-4 font-medium min-w-64">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Group by station for visual section headers
                    const grouped = new Map<string, ChartLine[]>();
                    for (const line of chartResult.lines) {
                      const key = line.stationId ?? "__none__";
                      const group = grouped.get(key) ?? [];
                      group.push(line);
                      grouped.set(key, group);
                    }

                    const rows: JSX.Element[] = [];
                    grouped.forEach((lines, stationKey) => {
                      const stationLabel = stationKey === "__none__"
                        ? "General"
                        : (stationMap.get(stationKey) ?? "Unknown Station");

                      rows.push(
                        <tr key={`header-${stationKey}`} className="bg-muted/50 border-b">
                          <td colSpan={7} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {stationLabel}
                          </td>
                        </tr>
                      );

                      lines.forEach(line => {
                        const item = prepItemMap.get(line.prepItemId);
                        const stationName = line.stationId ? (stationMap.get(line.stationId) ?? "—") : "—";
                        rows.push(
                          <tr key={line.id} className="border-b last:border-b-0 hover:bg-muted/20" data-testid={`row-chart-line-${line.id}`}>
                            <td className="py-3 px-4">
                              <span className="font-medium text-sm">{item?.name ?? line.prepItemId}</span>
                            </td>
                            <td className="py-3 px-4 text-sm text-muted-foreground">
                              {stationName}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-sm" data-testid={`text-recommended-qty-${line.id}`}>
                                {line.recommendedQty.toFixed(1)} {item?.outputUnit ?? ""}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={line.recommendedBatches === 0 ? "secondary" : "default"}
                                className="text-xs"
                                data-testid={`badge-batches-${line.id}`}
                              >
                                {line.recommendedBatches}x
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-sm text-muted-foreground" data-testid={`text-on-hand-${line.id}`}>
                              {line.onHandQty.toFixed(1)} {item?.outputUnit ?? ""}
                            </td>
                            <td className="py-3 px-4 text-sm text-muted-foreground">
                              {line.dueTime ? format(new Date(line.dueTime), "h:mma") : "—"}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground max-w-xs" data-testid={`text-reasoning-${line.id}`}>
                              {line.reasoningSummary ?? "—"}
                            </td>
                          </tr>
                        );
                      });
                    });
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PrepChart() {
  return (
    <TierGate feature="prep_chart">
      <PrepChartContent />
    </TierGate>
  );
}
