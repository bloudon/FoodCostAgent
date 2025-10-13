import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUnitName } from "@/lib/utils";

type Unit = {
  id: string;
  name: string;
  kind: string;
  toBaseRatio: number;
  system: string;
};

type UnitConversion = {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  conversionFactor: number;
  fromUnit?: Unit;
  toUnit?: Unit;
};

export default function UnitConversions() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConversion, setEditingConversion] = useState<UnitConversion | null>(null);
  const [fromUnitId, setFromUnitId] = useState("");
  const [toUnitId, setToUnitId] = useState("");
  const [conversionFactor, setConversionFactor] = useState<number>(1);

  const { data: conversions, isLoading } = useQuery<UnitConversion[]>({
    queryKey: ["/api/unit-conversions"],
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/unit-conversions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unit-conversions"] });
      toast({
        title: "Conversion created",
        description: "Unit conversion has been successfully created.",
      });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PATCH", `/api/unit-conversions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unit-conversions"] });
      toast({
        title: "Conversion updated",
        description: "Unit conversion has been successfully updated.",
      });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/unit-conversions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unit-conversions"] });
      toast({
        title: "Conversion deleted",
        description: "Unit conversion has been successfully deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOpenDialog = (conversion?: UnitConversion) => {
    if (conversion) {
      setEditingConversion(conversion);
      setFromUnitId(conversion.fromUnitId);
      setToUnitId(conversion.toUnitId);
      setConversionFactor(conversion.conversionFactor);
    } else {
      setEditingConversion(null);
      setFromUnitId("");
      setToUnitId("");
      setConversionFactor(1);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingConversion(null);
    setFromUnitId("");
    setToUnitId("");
    setConversionFactor(1);
  };

  const handleSubmit = () => {
    if (!fromUnitId || !toUnitId || !conversionFactor) {
      toast({
        title: "Validation error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    const data = {
      fromUnitId,
      toUnitId,
      conversionFactor,
    };

    if (editingConversion) {
      updateMutation.mutate({ id: editingConversion.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this conversion?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-unit-conversions-title">
            Unit Conversions
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage unit conversion factors for inventory counting
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()} data-testid="button-create-conversion">
              <Plus className="h-4 w-4 mr-2" />
              New Conversion
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingConversion ? "Edit Conversion" : "Create Conversion"}
              </DialogTitle>
              <DialogDescription>
                Define how many of one unit equals another unit
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="fromUnit">From Unit</Label>
                <Select value={fromUnitId} onValueChange={setFromUnitId}>
                  <SelectTrigger id="fromUnit" data-testid="select-from-unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {formatUnitName(unit.name)} ({unit.kind})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="conversionFactor">Conversion Factor</Label>
                <Input
                  id="conversionFactor"
                  type="number"
                  step="0.01"
                  value={conversionFactor}
                  onChange={(e) => setConversionFactor(parseFloat(e.target.value) || 1)}
                  placeholder="e.g., 16 for 1 pound = 16 ounces"
                  data-testid="input-conversion-factor"
                />
                <p className="text-sm text-muted-foreground">
                  How many {toUnitId ? units?.find(u => u.id === toUnitId)?.name : "to units"} in 1{" "}
                  {fromUnitId ? units?.find(u => u.id === fromUnitId)?.name : "from unit"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="toUnit">To Unit</Label>
                <Select value={toUnitId} onValueChange={setToUnitId}>
                  <SelectTrigger id="toUnit" data-testid="select-to-unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {formatUnitName(unit.name)} ({unit.kind})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingConversion ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversion Factors</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From Unit</TableHead>
                <TableHead>Conversion Factor</TableHead>
                <TableHead>To Unit</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : conversions && conversions.length > 0 ? (
                conversions.map((conversion) => (
                  <TableRow key={conversion.id} data-testid={`row-conversion-${conversion.id}`}>
                    <TableCell className="font-medium">
                      {formatUnitName(conversion.fromUnit?.name)}
                    </TableCell>
                    <TableCell className="font-mono">
                      1 : {conversion.conversionFactor}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatUnitName(conversion.toUnit?.name)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(conversion)}
                          data-testid={`button-edit-${conversion.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(conversion.id)}
                          data-testid={`button-delete-${conversion.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No unit conversions found. Create your first conversion to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
