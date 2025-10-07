import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

type Unit = {
  id: string;
  name: string;
  kind: string;
  toBaseRatio: number;
  system: string;
};

type StorageLocation = {
  id: string;
  name: string;
  sortOrder: number;
};

export default function AddProduct() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unitId, setUnitId] = useState("");
  const [caseSize, setCaseSize] = useState<number>(20);
  const [yieldAmount, setYieldAmount] = useState<number>(1);
  const [yieldUnitId, setYieldUnitId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const createMutation = useMutation({
    mutationFn: async (productData: any) => {
      return apiRequest("/api/products", "POST", productData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Product created",
        description: "The product has been successfully created.",
      });
      navigate("/products");
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating product",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLocationToggle = (locationId: string) => {
    setSelectedLocationIds((prev) =>
      prev.includes(locationId)
        ? prev.filter((id) => id !== locationId)
        : [...prev, locationId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Validation error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }

    if (!unitId) {
      toast({
        title: "Validation error",
        description: "Unit is required",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      category: category.trim() || null,
      unitId,
      caseSize,
      yieldAmount: yieldAmount || null,
      yieldUnitId: yieldUnitId || null,
      imageUrl: imageUrl.trim() || null,
      storageLocationIds: selectedLocationIds.length > 0 ? selectedLocationIds : null,
      active: 1,
      lastCost: 0,
    });
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link href="/products">
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Products
          </Button>
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-add-product-title">
          Add Product
        </h1>
        <p className="text-muted-foreground mt-2">
          Create a new product with unit and storage details
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader>
              <CardTitle>Product Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter product name"
                  data-testid="input-product-name"
                  required
                />
              </div>

              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g., Dairy, Produce, Protein"
                  data-testid="input-category"
                />
              </div>

              <div>
                <Label htmlFor="unit">Unit of Measure *</Label>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger id="unit" data-testid="select-unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name} ({unit.kind})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="caseSize">Case Size (lbs)</Label>
                <Input
                  id="caseSize"
                  type="number"
                  min="0"
                  step="0.1"
                  value={caseSize}
                  onChange={(e) => setCaseSize(parseFloat(e.target.value) || 20)}
                  placeholder="Enter case size in pounds"
                  data-testid="input-case-size"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="yieldAmount">Yield Amount</Label>
                  <Input
                    id="yieldAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={yieldAmount}
                    onChange={(e) => setYieldAmount(parseFloat(e.target.value) || 1)}
                    placeholder="Enter yield amount"
                    data-testid="input-yield-amount"
                  />
                </div>

                <div>
                  <Label htmlFor="yieldUnit">Yield Unit</Label>
                  <Select value={yieldUnitId} onValueChange={setYieldUnitId}>
                    <SelectTrigger id="yieldUnit" data-testid="select-yield-unit">
                      <SelectValue placeholder="Select unit" />
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

              <div>
                <Label htmlFor="imageUrl">Image URL</Label>
                <Input
                  id="imageUrl"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  data-testid="input-image-url"
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Storage Locations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {locations && locations.length > 0 ? (
                    locations.map((location) => (
                      <div key={location.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`location-${location.id}`}
                          checked={selectedLocationIds.includes(location.id)}
                          onCheckedChange={() => handleLocationToggle(location.id)}
                          data-testid={`checkbox-location-${location.id}`}
                        />
                        <Label
                          htmlFor={`location-${location.id}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {location.name}
                        </Label>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No storage locations configured
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-create-product"
              >
                {createMutation.isPending ? "Creating..." : "Create Product"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/products")}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
