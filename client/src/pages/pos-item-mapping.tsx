import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";

interface CatalogVariation {
  externalItemId: string;
  externalVariationId: string;
  externalItemName: string;
  externalVariationName: string;
  menuItemId: string | null;
  isMapped: boolean;
  isModifier: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  pluSku: string;
}

export default function PosItemMapping() {
  const [, params] = useRoute("/pos/item-mapping/:connectionId");
  const connectionId = params?.connectionId ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { getEffectiveCompanyId } = useAuth();
  const companyId = getEffectiveCompanyId();

  const [search, setSearch] = useState("");
  const [localMappings, setLocalMappings] = useState<Record<string, string | null>>({});

  const { data: catalog = [], isLoading: catalogLoading } = useQuery<CatalogVariation[]>({
    queryKey: [`/api/pos/connections/${connectionId}/catalog`],
    enabled: !!connectionId,
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu-items"],
    enabled: !!companyId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = catalog.map((v) => ({
        externalItemId: v.externalItemId,
        externalVariationId: v.externalVariationId,
        externalItemName: v.externalItemName,
        externalVariationName: v.externalVariationName,
        menuItemId:
          localMappings[v.externalVariationId] !== undefined
            ? localMappings[v.externalVariationId]
            : v.menuItemId,
      }));
      await apiRequest("POST", `/api/pos/connections/${connectionId}/item-mappings`, {
        mappings: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pos/connections/${connectionId}/catalog`] });
      toast({
        title: "Item mappings saved",
        description: "You can now run a sync from Settings → Connections.",
      });
      navigate("/settings?tab=connections&pos_connected=1");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getMenuItemId = (v: CatalogVariation) =>
    localMappings[v.externalVariationId] !== undefined
      ? localMappings[v.externalVariationId]
      : v.menuItemId;

  const filtered = useMemo(() => {
    if (!search.trim()) return catalog;
    const q = search.toLowerCase();
    return catalog.filter(
      (v) =>
        v.externalItemName.toLowerCase().includes(q) ||
        v.externalVariationName.toLowerCase().includes(q),
    );
  }, [catalog, search]);

  const mappedCount = catalog.filter((v) => getMenuItemId(v)).length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Map Square Menu Items</h1>
        <p className="text-muted-foreground mt-1">
          Link each Square item variation to the matching FnB menu item. Suggested matches are auto-filled by name.
        </p>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline">
          {mappedCount} / {catalog.length} mapped
        </Badge>
      </div>

      {catalogLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading catalog…
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const currentMenuItemId = getMenuItemId(v);
            const mapped = !!currentMenuItemId;
            return (
              <Card key={v.externalVariationId} className={mapped ? "border-green-200 dark:border-green-900" : ""}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-sm truncate">{v.externalItemName}</p>
                      {v.isModifier && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          Modifier
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{v.externalVariationName}</p>
                  </div>
                  <div className="w-60 shrink-0">
                    <Select
                      value={currentMenuItemId ?? "__none__"}
                      onValueChange={(val) =>
                        setLocalMappings((prev) => ({
                          ...prev,
                          [v.externalVariationId]: val === "__none__" ? null : val,
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select menu item…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not mapped —</SelectItem>
                        {menuItems.map((mi) => (
                          <SelectItem key={mi.id} value={mi.id}>
                            {mi.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {mapped ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  )}
                </CardContent>
              </Card>
            );
          })}

          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No items match your search.</p>
          )}
        </div>
      )}

      <div className="flex justify-between pt-6">
        <Button
          variant="outline"
          onClick={() => navigate(`/pos/location-mapping/${connectionId}`)}
        >
          Back
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Mappings & Finish
        </Button>
      </div>
    </div>
  );
}
