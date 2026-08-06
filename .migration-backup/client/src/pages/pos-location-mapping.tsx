import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, ArrowRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";

interface LocationMapping {
  id?: string;
  externalLocationId: string;
  externalLocationName: string;
  storeId: string | null;
}

export default function PosLocationMapping() {
  const [, params] = useRoute("/pos/location-mapping/:connectionId");
  const connectionId = params?.connectionId ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: stores = [] } = useAccessibleStores();

  const { data: locations = [], isLoading } = useQuery<LocationMapping[]>({
    queryKey: [`/api/pos/connections/${connectionId}/locations`],
    enabled: !!connectionId,
  });

  const [mappings, setMappings] = useState<Record<string, string | null>>({});

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = locations.map((loc) => ({
        externalLocationId: loc.externalLocationId,
        externalLocationName: loc.externalLocationName,
        storeId: mappings[loc.externalLocationId] ?? loc.storeId,
      }));
      await apiRequest("POST", `/api/pos/connections/${connectionId}/location-mappings`, {
        mappings: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pos/connections/${connectionId}/locations`] });
      toast({ title: "Locations mapped", description: "Proceeding to menu item mapping." });
      navigate(`/pos/item-mapping/${connectionId}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getStoreId = (loc: LocationMapping) =>
    mappings[loc.externalLocationId] !== undefined
      ? mappings[loc.externalLocationId]
      : loc.storeId;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Map Square Locations to Stores</h1>
        <p className="text-muted-foreground mt-1">
          Connect each Square location to the matching FnB store so sales flow to the right place.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading locations…
        </div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MapPin className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No locations found in your Square account.</p>
            <Button className="mt-4" onClick={() => navigate("/settings?tab=connections")}>
              Back to Settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {locations.map((loc) => {
            const currentStoreId = getStoreId(loc);
            return (
              <Card key={loc.externalLocationId}>
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{loc.externalLocationName}</p>
                    <p className="text-xs text-muted-foreground">{loc.externalLocationId}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="w-52 shrink-0">
                    <Select
                      value={currentStoreId ?? "__none__"}
                      onValueChange={(v) =>
                        setMappings((prev) => ({
                          ...prev,
                          [loc.externalLocationId]: v === "__none__" ? null : v,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select store…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not mapped —</SelectItem>
                        {stores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {currentStoreId && (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => navigate("/settings?tab=connections")}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save & Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
