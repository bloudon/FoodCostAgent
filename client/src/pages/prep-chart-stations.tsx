import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, Plus, Check, X, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TierGate } from "@/components/tier-gate";

interface Station {
  id: string;
  name: string;
  sortOrder: number;
  active: number;
}

function StationsContent() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const dragIndex = useRef<number | null>(null);

  const { data: stations = [], isLoading } = useQuery<Station[]>({
    queryKey: ["/api/stations"],
    select: (data) => {
      // Keep local order if we have one, otherwise use server order
      if (localOrder.length > 0) {
        const map = new Map(data.map(s => [s.id, s]));
        const ordered = localOrder.map(id => map.get(id)).filter(Boolean) as Station[];
        const extra = data.filter(s => !localOrder.includes(s.id));
        return [...ordered, ...extra];
      }
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/stations", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setNewName("");
      setLocalOrder([]);
      toast({ title: "Station created" });
    },
    onError: () => toast({ title: "Failed to create station", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/stations/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setEditId(null);
      toast({ title: "Station updated" });
    },
    onError: () => toast({ title: "Failed to update station", variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await apiRequest("PATCH", "/api/stations/reorder", { orderedIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
    },
    onError: () => {
      setLocalOrder([]);
      toast({ title: "Failed to reorder", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/stations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setLocalOrder([]);
      toast({ title: "Station deleted" });
    },
    onError: () => toast({ title: "Failed to delete station", variant: "destructive" }),
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  const handleEditSave = () => {
    if (!editId || !editName.trim()) return;
    updateMutation.mutate({ id: editId, name: editName.trim() });
  };

  const startEdit = (s: Station) => {
    setEditId(s.id);
    setEditName(s.name);
  };

  // Drag-to-reorder handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex.current === null || dragIndex.current === index) return;

    const newList = [...stations];
    const [moved] = newList.splice(dragIndex.current, 1);
    newList.splice(index, 0, moved);
    dragIndex.current = index;
    setLocalOrder(newList.map(s => s.id));
  };

  const handleDrop = () => {
    if (localOrder.length > 0) {
      reorderMutation.mutate(localOrder);
    }
    dragIndex.current = null;
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="heading-stations">Kitchen Stations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define your kitchen stations (Grill, Cold Prep, Fryer, etc.). Drag to reorder. Stations group prep items on the prep chart.
        </p>
      </div>

      {/* Add new station */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Station</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Grill, Cold Prep, Fryer…"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              data-testid="input-station-name"
            />
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending} data-testid="button-add-station">
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Station list */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : stations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No stations yet. Add one above.</p>
          ) : (
            <ul className="divide-y" data-testid="list-stations">
              {stations.map((s, index) => (
                <li
                  key={s.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={handleDrop}
                  className="flex items-center gap-3 py-3 cursor-default"
                  data-testid={`row-station-${s.id}`}
                >
                  <GripVertical
                    className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab"
                    data-testid={`drag-handle-station-${s.id}`}
                  />
                  {editId === s.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1"
                        onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
                        data-testid="input-edit-station-name"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" onClick={handleEditSave} disabled={updateMutation.isPending} data-testid="button-save-station">
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditId(null)} data-testid="button-cancel-station-edit">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium">{s.name}</span>
                      <Button size="icon" variant="ghost" onClick={() => startEdit(s)} data-testid={`button-edit-station-${s.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-station-${s.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PrepChartStations() {
  return (
    <TierGate feature="prep_chart">
      <StationsContent />
    </TierGate>
  );
}
