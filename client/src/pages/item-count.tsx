import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function ItemCount() {
  const params = useParams();
  const lineId = params.id;
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [caseCount, setCaseCount] = useState(0);
  const [openCaseUnits, setOpenCaseUnits] = useState(0);
  const [selectedUnitId, setSelectedUnitId] = useState("");

  const { data: countLine, isLoading: lineLoading } = useQuery<any>({
    queryKey: ["/api/inventory-count-line", lineId],
    enabled: !!lineId,
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: units } = useQuery<any[]>({
    queryKey: ["/api/units"],
  });

  const product = products?.find(p => p.id === countLine?.productId);
  const baseUnit = units?.find(u => u.id === product?.baseUnitId);
  const yieldUnit = units?.find(u => u.id === product?.yieldUnitId);

  // Calculate case size in base units
  const caseSizeInBaseUnits = product?.yieldAmount 
    ? (product.yieldAmount * (yieldUnit?.toBaseRatio || 1))
    : 1;

  // Initialize form values when countLine is loaded
  useEffect(() => {
    if (countLine && product) {
      setSelectedUnitId(countLine.unitId || product.baseUnitId);
      
      // If we have derivedMicroUnits, reverse calculate case count and open units
      if (countLine.derivedMicroUnits > 0) {
        const totalBaseUnits = countLine.derivedMicroUnits;
        const cases = Math.floor(totalBaseUnits / caseSizeInBaseUnits);
        const open = totalBaseUnits % caseSizeInBaseUnits;
        setCaseCount(cases);
        setOpenCaseUnits(open);
      }
    }
  }, [countLine, product, caseSizeInBaseUnits]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest(`/api/inventory-count-lines/${lineId}`, "PATCH", data);
    },
    onSuccess: () => {
      if (countLine?.inventoryCountId) {
        queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countLine.inventoryCountId] });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"], exact: false });
        toast({
          title: "Success",
          description: "Count updated successfully",
        });
        setLocation(`/count/${countLine.inventoryCountId}`);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update count",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const unit = units?.find(u => u.id === selectedUnitId);
    const baseUnits = (caseCount * caseSizeInBaseUnits) + openCaseUnits;
    const qty = unit ? baseUnits / unit.toBaseRatio : baseUnits;

    updateMutation.mutate({
      qty,
      unitId: selectedUnitId,
      derivedMicroUnits: baseUnits,
    });
  };

  const totalQty = (() => {
    const unit = units?.find(u => u.id === selectedUnitId);
    const baseUnits = (caseCount * caseSizeInBaseUnits) + openCaseUnits;
    return unit ? baseUnits / unit.toBaseRatio : baseUnits;
  })();

  const totalValue = totalQty * (product?.lastCost || 0);

  if (lineLoading || !countLine) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        {countLine?.inventoryCountId && (
          <Link href={`/count/${countLine.inventoryCountId}`}>
            <Button variant="ghost" className="mb-4" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Session
            </Button>
          </Link>
        )}

        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-item-count-title">
          Count Item
        </h1>
        <p className="text-muted-foreground mt-2">
          {product?.name || 'Unknown Product'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Item Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Product Name</div>
              <div className="text-lg font-medium">{product?.name || 'Unknown'}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Category</div>
              <div>{product?.category || 'Uncategorized'}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Case Size</div>
              <div className="font-mono">
                {caseSizeInBaseUnits.toFixed(1)} {baseUnit?.name || 'units'}/case
              </div>
            </div>

            <div className="pt-4 border-t space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Number of Cases
                </label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={caseCount}
                  onChange={(e) => setCaseCount(parseFloat(e.target.value) || 0)}
                  data-testid="input-case-count"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Open Case Units ({baseUnit?.name || 'units'})
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={openCaseUnits}
                  onChange={(e) => setOpenCaseUnits(parseFloat(e.target.value) || 0)}
                  data-testid="input-open-units"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Display Unit
                </label>
                <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                  <SelectTrigger data-testid="select-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Count Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Quantity</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-qty">
                  {totalQty.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {units?.find(u => u.id === selectedUnitId)?.name || 'units'}
                </div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground">Unit Cost</div>
                <div className="text-lg font-mono">
                  ${(product?.lastCost || 0).toFixed(4)}
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="text-sm text-muted-foreground">Total Value</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-value">
                  ${totalValue.toFixed(2)}
                </div>
              </div>

              <div className="pt-4">
                <Button 
                  className="w-full" 
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-count"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Count"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
