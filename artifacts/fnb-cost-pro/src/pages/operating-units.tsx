/**
 * Operating Units
 *
 * Operating units represent the revenue-producing areas within a single operating
 * location — Dining Room, Bar, Patio, Catering, etc.  They are distinct from
 * storage locations (where inventory physically lives) and from store/billing
 * locations (company_stores).
 *
 * CRUD: GET/POST/PATCH/DELETE /api/operating-units
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Layers, Plus, Pencil, PowerOff, Power, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatingUnit {
  id: string;
  name: string;
  sourceSystem: string | null;
  active: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperatingUnits() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<OperatingUnit | null>(null);
  const [togglingUnit, setTogglingUnit] = useState<OperatingUnit | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data: units = [], isLoading } = useQuery<OperatingUnit[]>({
    queryKey: ["/api/operating-units"],
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/operating-units"] });

  // ── Create ──────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/operating-units", { name });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setIsAddOpen(false);
      toast({ title: "Operating unit created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Rename ──────────────────────────────────────────────────────────────────

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/operating-units/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setEditingUnit(null);
      toast({ title: "Operating unit renamed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Toggle active ───────────────────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: number }) => {
      const res = await apiRequest("PATCH", `/api/operating-units/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setTogglingUnit(null);
      toast({ title: "Operating unit updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Form submission helpers ──────────────────────────────────────────────────

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = (new FormData(e.currentTarget).get("name") as string).trim();
    if (!name) return;
    createMutation.mutate(name);
  };

  const handleRename = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUnit) return;
    const name = (new FormData(e.currentTarget).get("name") as string).trim();
    if (!name) return;
    renameMutation.mutate({ id: editingUnit.id, name });
  };

  const activeUnits = units.filter((u) => u.active === 1);
  const inactiveUnits = units.filter((u) => u.active !== 1);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-semibold tracking-tight"
            data-testid="text-operating-units-title"
          >
            Operating Units
          </h1>
          <p className="text-muted-foreground mt-2">
            Define the revenue-producing areas within your operation
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-operating-unit">
          <Plus className="h-4 w-4 mr-2" />
          Add Unit
        </Button>
      </div>

      {/* Explanation */}
      <Card className="mb-6 border-blue-200 bg-blue-500/5 dark:border-blue-800">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
            <div className="text-sm space-y-1">
              <p className="font-medium">What are operating units?</p>
              <p className="text-muted-foreground">
                Operating units are the areas of your business where revenue and costs are attributed —
                Dining Room, Bar, Patio, Catering, Takeout, etc. They are separate from
                storage locations (where inventory lives) and allow you to see food cost,
                sales, and waste broken down by area.
              </p>
              <p className="text-muted-foreground">
                A simple restaurant can use the default <strong>Main Operation</strong> unit and
                never think about this again. Add more units whenever you need per-area reporting.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Units table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          Loading operating units…
        </div>
      ) : units.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No operating units yet</h3>
            <p className="text-muted-foreground text-sm mb-4 text-center max-w-sm">
              Create your first operating unit to start tracking revenue and food cost by area.
            </p>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Unit
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Operating Units</CardTitle>
            <CardDescription>
              {activeUnits.length} active
              {inactiveUnits.length > 0 ? `, ${inactiveUnits.length} inactive` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((unit) => (
                  <TableRow key={unit.id} data-testid={`row-unit-${unit.id}`}>
                    <TableCell className="font-medium">{unit.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {unit.sourceSystem === "SALES_BY_ITEM"
                        ? "Jonas Encore import"
                        : unit.sourceSystem === "manual" || !unit.sourceSystem
                        ? "Manual"
                        : unit.sourceSystem}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={unit.active === 1 ? "default" : "secondary"}
                        data-testid={`badge-unit-status-${unit.id}`}
                      >
                        {unit.active === 1 ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingUnit(unit)}
                          data-testid={`button-rename-${unit.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setTogglingUnit(unit)}
                          data-testid={`button-toggle-${unit.id}`}
                        >
                          {unit.active === 1 ? (
                            <PowerOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Power className="h-4 w-4 text-emerald-500" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Operating Unit</DialogTitle>
            <DialogDescription>
              Create a new area for tracking revenue and food cost.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                name="name"
                placeholder="e.g. Bar, Patio, Catering"
                autoFocus
                required
                data-testid="input-unit-name"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-save-unit"
              >
                {createMutation.isPending ? "Creating…" : "Create Unit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={!!editingUnit}
        onOpenChange={(open) => { if (!open) setEditingUnit(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Operating Unit</DialogTitle>
            <DialogDescription>
              Update the name for "{editingUnit?.name}".
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                name="name"
                defaultValue={editingUnit?.name ?? ""}
                autoFocus
                required
                data-testid="input-edit-unit-name"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={renameMutation.isPending}
                data-testid="button-save-rename"
              >
                {renameMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Toggle confirm dialog */}
      <AlertDialog
        open={!!togglingUnit}
        onOpenChange={(open) => { if (!open) setTogglingUnit(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {togglingUnit?.active === 1 ? "Deactivate" : "Reactivate"} Operating Unit
            </AlertDialogTitle>
            <AlertDialogDescription>
              {togglingUnit?.active === 1
                ? `Deactivating "${togglingUnit?.name}" will hide it from new imports and TFC breakdowns. Existing sales data is preserved.`
                : `Reactivating "${togglingUnit?.name}" will make it available again for imports and TFC breakdowns.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-toggle">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                togglingUnit &&
                toggleMutation.mutate({
                  id: togglingUnit.id,
                  active: togglingUnit.active === 1 ? 0 : 1,
                })
              }
              data-testid="button-confirm-toggle"
            >
              {togglingUnit?.active === 1 ? "Deactivate" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
