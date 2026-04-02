import { useState, useEffect, Fragment } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Check, Loader2, Trash2, Camera, Sparkles, AlertCircle } from "lucide-react";
const logoImage = "/logo.png";

interface ExtractedItem {
  name: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
}

type Step = 1 | 2 | 3;

export default function OnboardingMenuScan() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { company, selectedCompanyId, isLoading: companyLoading } = useCompany();
  const { user, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [storeName, setStoreName] = useState("");
  const [storeNameTouched, setStoreNameTouched] = useState(false);
  const [storeId, setStoreId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (company?.name && !storeNameTouched && !storeName) {
      setStoreName(`${company.name}'s Store`);
    }
  }, [company?.name]);

  const skip = () => setLocation("/choose-plan");

  const createStoreMutation = useMutation({
    mutationFn: async () => {
      const trimmed = storeName.trim();
      if (!trimmed) throw new Error("Please enter a name for your restaurant");
      const code = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "STORE1";
      const res = await apiRequest("POST", "/api/onboarding/store", { name: trimmed, code });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Failed to create store");
      }
      return (await res.json()) as { store: { id: string } };
    },
    onSuccess: (data) => {
      setStoreId(data.store.id);
      setStep(2);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleUploadComplete = async (objectPath: string) => {
    setScanning(true);
    try {
      const res = await apiRequest("POST", "/api/onboarding/menu-scan", {
        imageObjectPath: objectPath,
        storeId: storeId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Scan failed");
      }
      const data = await res.json() as { sessionId: string; items: ExtractedItem[]; count: number };
      setSessionId(data.sessionId);
      setItems(data.items || []);
      setStep(3);
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message || "Could not extract items from image", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const deleteItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItemName = (idx: number, name: string) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, name } : item));
  };

  const updateItemPrice = (idx: number, value: string) => {
    const price = value === "" ? null : parseFloat(value);
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, price: isNaN(price as number) ? null : price } : item));
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      const validItems = items.filter(i => i.name.trim().length > 0);
      if (validItems.length === 0) throw new Error("No items to import");
      const res = await apiRequest("POST", `/api/onboarding/menu-scan/${sessionId}/approve`, {
        items: validItems,
        storeId: storeId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Import failed");
      }
      return (await res.json()) as { menuItemsCreated: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items/hierarchy"] });
      const n = data.menuItemsCreated;
      toast({
        title: "Menu imported!",
        description: `${n} menu item${n !== 1 ? "s" : ""} imported — now let's choose your plan.`,
      });
      setLocation("/choose-plan");
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const stepLabels = ["Your restaurant", "Scan menu", "Review items"];

  // Auth guard — show spinner while auth resolves to avoid flashing the form.
  // Also wait for useCompany to resolve so selectedCompanyId is available.
  if (authLoading || (user && companyLoading && !selectedCompanyId)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Block truly unauthenticated visitors. Authenticated users without a company
  // link (global admins who haven't selected a company, or broken sessions) see
  // a helpful prompt instead of a broken form.
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto mx-auto mb-6" />
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <p>Please sign in to continue setting up your account.</p>
          </div>
          <Button onClick={() => setLocation("/login")} data-testid="button-go-to-login">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Global admins must select a company first (via the header company picker).
  if (user.role === "global_admin" && !selectedCompanyId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto mx-auto mb-6" />
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <p>Select a company from the header before running the setup wizard.</p>
          </div>
          <Button onClick={() => setLocation("/companies")} data-testid="button-go-to-companies">
            Select Company
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl">
        {/* Header row: logo + skip */}
        <div className="flex items-center justify-between mb-6">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
          <button
            onClick={skip}
            className="text-sm text-muted-foreground hover:underline"
            data-testid="button-onboarding-skip"
          >
            Skip for now
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-6 gap-0">
          {stepLabels.map((label, i) => {
            const s = (i + 1) as Step;
            const isDone = s < step;
            const isCurrent = s === step;
            return (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    isDone ? "bg-primary text-primary-foreground" :
                    isCurrent ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {isDone ? <Check className="w-4 h-4" /> : s}
                  </div>
                  <span className={`text-xs mt-1 whitespace-nowrap ${isCurrent ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div className={`flex-1 h-px mx-2 mb-4 ${isDone ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1: Store name */}
        {step === 1 && (
          <Card data-testid="card-step-store-name">
            <CardHeader>
              <CardTitle>What do you call your restaurant?</CardTitle>
              <CardDescription>
                This creates your first location. You can add more later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Restaurant name</label>
                <Input
                  placeholder="e.g. Joe's Pizza — Downtown"
                  value={storeName}
                  onChange={(e) => {
                    setStoreName(e.target.value);
                    setStoreNameTouched(true);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && createStoreMutation.mutate()}
                  data-testid="input-store-name"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => createStoreMutation.mutate()}
                  disabled={createStoreMutation.isPending || !storeName.trim()}
                  data-testid="button-continue-store"
                >
                  {createStoreMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                  ) : "Continue"}
                </Button>
                <Button variant="ghost" size="sm" onClick={skip} data-testid="button-skip-step1">
                  Skip this step
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Upload & scan */}
        {step === 2 && (
          <Card data-testid="card-step-upload">
            <CardHeader>
              <CardTitle>Upload a photo of your menu</CardTitle>
              <CardDescription>
                Take a photo of your printed menu, a PDF screenshot, or any image — our AI will pull out the items.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {scanning ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Sparkles className="w-10 h-10 text-primary animate-pulse" />
                  <p className="text-base font-medium">Scanning your menu…</p>
                  <p className="text-sm text-muted-foreground">This usually takes 10–20 seconds</p>
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-8 rounded-md border-2 border-dashed border-muted">
                  <Camera className="w-12 h-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground text-center px-4">
                    Supports JPG, PNG, WebP — up to 10 MB
                  </p>
                  <ObjectUploader
                    onUploadComplete={handleUploadComplete}
                    buttonText="Choose Menu Image"
                    dataTestId="button-upload-menu"
                    visibility="private"
                    maxFileSize={10485760}
                  />
                </div>
              )}
              {!scanning && (
                <Button variant="ghost" size="sm" onClick={skip} data-testid="button-skip-step2" className="w-full">
                  Skip for now
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <Card data-testid="card-step-review">
            <CardHeader>
              <CardTitle>
                {items.length > 0
                  ? `We found ${items.length} item${items.length !== 1 ? "s" : ""}`
                  : "No items found"}
              </CardTitle>
              <CardDescription>
                Remove anything that doesn't belong, then import.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.length > 0 ? (() => {
                const deptOrder: string[] = [];
                const deptGroups = new Map<string, number[]>();
                items.forEach((item, idx) => {
                  const dept = (item.department || "").trim() || "Other";
                  if (!deptGroups.has(dept)) { deptGroups.set(dept, []); deptOrder.push(dept); }
                  deptGroups.get(dept)!.push(idx);
                });
                return (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium">Item name</th>
                          <th className="text-left px-3 py-2 font-medium w-28">Price</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {deptOrder.map((dept) => (
                          <Fragment key={`dept-${dept}`}>
                            <tr className="border-b bg-muted/30">
                              <td colSpan={3} className="px-3 py-1.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide" data-testid={`header-department-${dept}`}>
                                {dept}
                              </td>
                            </tr>
                            {deptGroups.get(dept)!.map((idx) => (
                              <tr key={idx} className="border-b last:border-0">
                                <td className="px-3 py-1.5">
                                  <Input
                                    value={items[idx].name}
                                    onChange={(e) => updateItemName(idx, e.target.value)}
                                    className="h-8 border-0 px-0 shadow-none focus-visible:ring-0 bg-transparent"
                                    data-testid={`input-item-name-${idx}`}
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1">
                                    <span className="text-muted-foreground text-xs">$</span>
                                    <Input
                                      type="number"
                                      value={items[idx].price ?? ""}
                                      onChange={(e) => updateItemPrice(idx, e.target.value)}
                                      placeholder="—"
                                      className="h-8 border-0 px-0 shadow-none focus-visible:ring-0 bg-transparent w-20"
                                      data-testid={`input-item-price-${idx}`}
                                    />
                                  </div>
                                </td>
                                <td className="px-2 py-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deleteItem(idx)}
                                    data-testid={`button-delete-item-${idx}`}
                                    className="text-muted-foreground"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })() : (
                <div className="py-8 text-center text-muted-foreground">
                  <p className="text-sm">No items were extracted from the image.</p>
                  <p className="text-xs mt-1">Try a clearer photo or a different page of your menu.</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Tip: Upgrade to Basic to cost your menu items against your recipes and see real food cost percentages.
              </p>

              <div className="flex flex-col gap-2">
                {items.length > 0 && (
                  <Button
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                    data-testid="button-import-items"
                  >
                    {approveMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing…</>
                    ) : `Import ${items.filter(i => i.name.trim()).length} Item${items.filter(i => i.name.trim()).length !== 1 ? "s" : ""}`}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={skip} data-testid="button-skip-step3">
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
