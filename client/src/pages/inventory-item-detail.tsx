import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useState } from "react";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Product, Unit, StorageLocation, Vendor } from "@shared/schema";

type VendorProduct = {
  id: string;
  vendorId: string;
  productId: string;
  vendorSku: string | null;
  purchaseUnitId: string;
  caseSize: number;
  innerPackSize: number | null;
  lastPrice: number;
  leadTimeDays: number | null;
  active: number;
  vendor?: Vendor;
  unit?: Unit;
};

export default function InventoryItemDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNewItem = id === "new";

  const [formData, setFormData] = useState<Partial<Product>>({});
  const [newVendor, setNewVendor] = useState({
    vendorId: "",
    vendorSku: "",
    purchaseUnitId: "",
    caseSize: 1,
    lastPrice: 0,
  });

  const { data: product, isLoading: productLoading } = useQuery<Product>({
    queryKey: ["/api/products", id],
    enabled: !isNewItem,
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ["/api/units"],
  });

  const { data: locations } = useQuery<StorageLocation[]>({
    queryKey: ["/api/storage-locations"],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: vendorProducts, refetch: refetchVendorProducts } = useQuery<VendorProduct[]>({
    queryKey: ["/api/vendor-products", { product_id: id }],
    enabled: !isNewItem,
  });

  if (product && Object.keys(formData).length === 0) {
    setFormData(product);
  }

  const updateProductMutation = useMutation({
    mutationFn: async (data: Partial<Product>) => {
      return await apiRequest("PATCH", \`/api/products/\${id}\`, data);
    },
    onSuccess: () => {
      toast({ title: "Product updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", id] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update product", description: error.message, variant: "destructive" });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: Partial<Product>) => {
      const response = await apiRequest("POST", "/api/products", data);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Product created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setLocation(\`/inventory-items/\${data.id}\`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create product", description: error.message, variant: "destructive" });
    },
  });

  const addVendorProductMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/vendor-products", {
        ...data,
        productId: id,
      });
    },
    onSuccess: () => {
      toast({ title: "Vendor added successfully" });
      refetchVendorProducts();
      setNewVendor({
        vendorId: "",
        vendorSku: "",
        purchaseUnitId: "",
        caseSize: 1,
        lastPrice: 0,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add vendor", description: error.message, variant: "destructive" });
    },
  });

  const deleteVendorProductMutation = useMutation({
    mutationFn: async (vendorProductId: string) => {
      return await apiRequest("DELETE", \`/api/vendor-products/\${vendorProductId}\`);
    },
    onSuccess: () => {
      toast({ title: "Vendor removed successfully" });
      refetchVendorProducts();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove vendor", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (isNewItem) {
      createProductMutation.mutate(formData);
    } else {
      updateProductMutation.mutate(formData);
    }
  };

  const handleAddVendor = () => {
    if (!newVendor.vendorId || !newVendor.purchaseUnitId) {
      toast({ title: "Please select vendor and unit", variant: "destructive" });
      return;
    }
    addVendorProductMutation.mutate(newVendor);
  };

  if (productLoading) {
    return <div className="p-6">Loading...</div>;
  }

  const currentData = isNewItem ? formData : { ...product, ...formData };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Link href="/inventory-items">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">
                {isNewItem ? "Add New Item" : currentData.name}
              </h1>
              <p className="text-muted-foreground mt-1">
                {isNewItem ? "Create a new inventory item" : "Edit product details, pricing, and vendors"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={updateProductMutation.isPending || createProductMutation.isPending}
            data-testid="button-save-product"
          >
            <Save className="h-4 w-4 mr-2" />
            {isNewItem ? "Create Item" : "Save Changes"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Product identification and categorization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  value={currentData.name || ""}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter product name"
                  data-testid="input-product-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pluSku">PLU/SKU</Label>
                <Input
                  id="pluSku"
                  value={currentData.pluSku || ""}
                  onChange={(e) => setFormData({ ...formData, pluSku: e.target.value })}
                  placeholder="Enter PLU or SKU"
                  data-testid="input-plu-sku"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={currentData.category || ""}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g. Protein, Produce, Dairy"
                  data-testid="input-category"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={currentData.barcode || ""}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="Enter barcode"
                  data-testid="input-barcode"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={currentData.active === 1}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked ? 1 : 0 })}
                data-testid="switch-active"
              />
              <Label htmlFor="active" className="cursor-pointer">
                Item is active
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Units & Pricing</CardTitle>
            <CardDescription>Unit configuration and cost information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="baseUnitId">Base Unit *</Label>
                <Select
                  value={currentData.baseUnitId || ""}
                  onValueChange={(value) => setFormData({ ...formData, baseUnitId: value })}
                >
                  <SelectTrigger id="baseUnitId" data-testid="select-base-unit">
                    <SelectValue placeholder="Select base unit" />
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
              <div className="space-y-2">
                <Label htmlFor="microUnitId">Micro Unit *</Label>
                <Select
                  value={currentData.microUnitId || ""}
                  onValueChange={(value) => setFormData({ ...formData, microUnitId: value })}
                >
                  <SelectTrigger id="microUnitId" data-testid="select-micro-unit">
                    <SelectValue placeholder="Select micro unit" />
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
              <div className="space-y-2">
                <Label htmlFor="microUnitsPerPurchaseUnit">Micro Units Per Purchase Unit *</Label>
                <Input
                  id="microUnitsPerPurchaseUnit"
                  type="number"
                  step="0.01"
                  value={currentData.microUnitsPerPurchaseUnit || 1}
                  onChange={(e) => setFormData({ ...formData, microUnitsPerPurchaseUnit: parseFloat(e.target.value) })}
                  data-testid="input-micro-units"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastCost">Last Cost (per purchase unit)</Label>
                <Input
                  id="lastCost"
                  type="number"
                  step="0.01"
                  value={currentData.lastCost || 0}
                  onChange={(e) => setFormData({ ...formData, lastCost: parseFloat(e.target.value) })}
                  data-testid="input-last-cost"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Levels</CardTitle>
            <CardDescription>Par and reorder level targets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="parLevel">Par Level</Label>
                <Input
                  id="parLevel"
                  type="number"
                  step="0.01"
                  value={currentData.parLevel || ""}
                  onChange={(e) => setFormData({ ...formData, parLevel: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="Target inventory level"
                  data-testid="input-par-level"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reorderLevel">Reorder Level</Label>
                <Input
                  id="reorderLevel"
                  type="number"
                  step="0.01"
                  value={currentData.reorderLevel || ""}
                  onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="Level to trigger reorder"
                  data-testid="input-reorder-level"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {!isNewItem && (
          <Card>
            <CardHeader>
              <CardTitle>Vendors</CardTitle>
              <CardDescription>Manage vendor relationships and pricing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Vendor SKU</TableHead>
                    <TableHead>Purchase Unit</TableHead>
                    <TableHead>Case Size</TableHead>
                    <TableHead>Last Price</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorProducts?.map((vp) => (
                    <TableRow key={vp.id}>
                      <TableCell data-testid={\`vendor-name-\${vp.id}\`}>
                        {vp.vendor?.name || "Unknown"}
                      </TableCell>
                      <TableCell>{vp.vendorSku || "-"}</TableCell>
                      <TableCell>{vp.unit?.name || "Unknown"}</TableCell>
                      <TableCell>{vp.caseSize}</TableCell>
                      <TableCell>\${vp.lastPrice.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteVendorProductMutation.mutate(vp.id)}
                          data-testid={\`button-delete-vendor-\${vp.id}\`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell>
                      <Select
                        value={newVendor.vendorId}
                        onValueChange={(value) => setNewVendor({ ...newVendor, vendorId: value })}
                      >
                        <SelectTrigger data-testid="select-new-vendor">
                          <SelectValue placeholder="Select vendor" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendors?.map((vendor) => (
                            <SelectItem key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={newVendor.vendorSku}
                        onChange={(e) => setNewVendor({ ...newVendor, vendorSku: e.target.value })}
                        placeholder="Vendor SKU"
                        data-testid="input-new-vendor-sku"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={newVendor.purchaseUnitId}
                        onValueChange={(value) => setNewVendor({ ...newVendor, purchaseUnitId: value })}
                      >
                        <SelectTrigger data-testid="select-new-purchase-unit">
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {units?.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="1"
                        value={newVendor.caseSize}
                        onChange={(e) => setNewVendor({ ...newVendor, caseSize: parseFloat(e.target.value) })}
                        data-testid="input-new-case-size"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={newVendor.lastPrice}
                        onChange={(e) => setNewVendor({ ...newVendor, lastPrice: parseFloat(e.target.value) })}
                        data-testid="input-new-last-price"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        onClick={handleAddVendor}
                        size="icon"
                        disabled={addVendorProductMutation.isPending}
                        data-testid="button-add-vendor"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
