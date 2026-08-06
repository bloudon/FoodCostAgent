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
import { formatUnitName } from "@/lib/utils";

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
  const unit = units?.find(u => u.id === product?.unitId);

  // Get case size (in pounds)
  const caseSize = product?.caseSize || 20;

  // Initialize form values when countLine is loaded
  useEffect(() => {
    if (countLine && product) {
      setSelectedUnitId(countLine.unitId || product.unitId);
      
      // If we have qty, reverse calculate case count and open units
      const selectedUnit = units?.find(u => u.id === (countLine.unitId || product.unitId));
      if (countLine.qty > 0) {
        // Convert qty to pounds
        const totalPounds = selectedUnit ? countLine.qty * selectedUnit.toBaseRatio : countLine.qty;
        const cases = Math.floor(totalPounds / caseSize);
        const open = totalPounds % caseSize;
        setCaseCount(cases);
        setOpenCaseUnits(open);
      }
    }
  }, [countLine, product, caseSize, units]);

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
    const totalPounds = (caseCount * caseSize) + openCaseUnits;
    const qty = unit ? totalPounds / unit.toBaseRatio : totalPounds;

    updateMutation.mutate({
      qty,
      unitId: selectedUnitId,
    });
  };

  const totalQty = (() => {
    const unit = units?.find(u => u.id === selectedUnitId);
    const totalPounds = (caseCount * caseSize) + openCaseUnits;
    return unit ? totalPounds / unit.toBaseRatio : totalPounds;
  })();

  const costPerPound = product?.caseSize ? (product.lastCost / product.caseSize) : 0;
  const totalValue = totalQty * costPerPound;

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
              {product?.id ? (
                <Link href={`/products/${product.id}`}>
                  <div className="text-lg font-medium text-primary hover:underline cursor-pointer" data-testid="link-product-name">
                    {product.name}
                  </div>
                </Link>
              ) : (
                <div className="text-lg font-medium">Unknown</div>
              )}
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Category</div>
              <div>{product?.category || 'Uncategorized'}</div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">Case Size</div>
              <div className="font-mono">
                {caseSize.toFixed(1)} {unit?.name || 'lbs'}/case
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
                  Open Case Units ({unit?.name || 'lbs'})
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
                        {formatUnitName(unit.name)}
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
                <div className="text-sm text-muted-foreground">Cost Per Pound</div>
                <div className="text-lg font-mono">
                  ${costPerPound.toFixed(4)}
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
