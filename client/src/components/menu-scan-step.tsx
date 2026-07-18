import { useState, Fragment } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  Check, Loader2, Trash2, Camera, Sparkles, Plus, ArrowRight,
  Wine, Utensils, BookOpen, ClipboardList, Package, Warehouse, BarChart3,
  Layers,
} from "lucide-react";

export interface MenuIntelligence {
  phones: string[];
  addresses: string[];
  locationCount: number;
  multiLocationSignal: boolean;
}

export interface ApprovedMenuItem {
  id: string;
  name: string;
  department?: string;
  price?: number | null;
}

export interface ExtractedMenuItem {
  name: string;
  description: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
  calorieCount?: number | null;
  variantGroupKey?: string;
}

export interface ApproveResponse {
  menuItemsCreated: number;
  menuItemIds: string[];
}

export function MenuScanStep({
  storeId,
  initialHasBar,
  onComplete,
}: {
  storeId?: string;
  initialHasBar?: number | null;
  onComplete: (items: ApprovedMenuItem[], sessionId: string, intelligence: MenuIntelligence, hasBar?: boolean) => void;
}) {
  const { toast } = useToast();
  const [subStep, setSubStep] = useState<"upload" | "bar-question" | "review">("upload");
  const [scanning, setScanning] = useState(false);
  const [addingPage, setAddingPage] = useState(false);
  const [addPageScanning, setAddPageScanning] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ExtractedMenuItem[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [intelligence, setIntelligence] = useState<MenuIntelligence>({
    phones: [], addresses: [], locationCount: 1, multiLocationSignal: false,
  });
  const [barAnswer, setBarAnswer] = useState<boolean | undefined>(
    initialHasBar === null || initialHasBar === undefined ? undefined : initialHasBar === 1,
  );
  const [barSaving, setBarSaving] = useState(false);
  const [disabledVariantGroups, setDisabledVariantGroups] = useState<Set<string>>(new Set());

  const handleUpload = async (objectPath: string) => {
    setUploadedImages([objectPath]);
    setCarouselIndex(0);
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
      const data = await res.json() as { sessionId: string; items: ExtractedMenuItem[]; intelligence?: MenuIntelligence };
      setSessionId(data.sessionId);
      setItems(data.items || []);
      if (data.intelligence) setIntelligence(data.intelligence);
      setSubStep("bar-question");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      toast({ title: "Scan failed", description: message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleAddPage = async (objectPath: string) => {
    setUploadedImages(prev => [...prev, objectPath]);
    setAddPageScanning(true);
    try {
      const res = await apiRequest("POST", "/api/onboarding/menu-scan", {
        imageObjectPath: objectPath,
        storeId: storeId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Scan failed");
      }
      const data = await res.json() as { sessionId: string; items: ExtractedMenuItem[]; intelligence?: MenuIntelligence };
      setItems(prev => {
        const seen = new Set(prev.map(i => i.name.toLowerCase().trim()));
        const newUnique = (data.items || []).filter(i => {
          const key = i.name.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...prev, ...newUnique];
      });
      if (data.intelligence) {
        setIntelligence(prev => {
          const mergedPhones = Array.from(new Set([...prev.phones, ...data.intelligence!.phones]));
          const mergedAddresses = Array.from(new Set([...prev.addresses, ...data.intelligence!.addresses]));
          const mergedLocationCount = Math.max(prev.locationCount, data.intelligence!.locationCount, mergedAddresses.length > 1 ? mergedAddresses.length : 1);
          return {
            phones: mergedPhones,
            addresses: mergedAddresses,
            locationCount: mergedLocationCount,
            multiLocationSignal: prev.multiLocationSignal || data.intelligence!.multiLocationSignal,
          };
        });
      }
      setAddingPage(false);
      toast({ title: "Page added", description: `${data.items?.length || 0} items scanned and merged.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setUploadedImages(prev => prev.filter(p => p !== objectPath));
      toast({ title: "Scan failed", description: message, variant: "destructive" });
    } finally {
      setAddPageScanning(false);
    }
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      const valid = items.filter(i => i.name.trim().length > 0);
      if (valid.length === 0) throw new Error("No items to import");
      const res = await apiRequest("POST", `/api/onboarding/menu-scan/${sessionId}/approve`, {
        items: valid.map(i => ({
          name: i.name,
          description: i.description,
          department: i.department,
          category: i.category,
          size: i.size,
          price: i.price,
          calorieCount: i.calorieCount ?? null,
          variantGroupKey: (i.variantGroupKey && !disabledVariantGroups.has(i.variantGroupKey)) ? i.variantGroupKey : "",
        })),
        storeId: storeId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Import failed");
      }
      return res.json() as Promise<ApproveResponse & { variantGroupsLinked?: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      const validItems = items.filter(i => i.name.trim());
      const named: ApprovedMenuItem[] = (data.menuItemIds || []).map((id, idx) => ({
        id,
        name: validItems[idx]?.name?.trim() || `Item ${idx + 1}`,
        department: validItems[idx]?.department,
        price: validItems[idx]?.price,
      }));
      const variantNote = data.variantGroupsLinked && data.variantGroupsLinked > 0
        ? ` ${data.variantGroupsLinked} size variant group${data.variantGroupsLinked !== 1 ? "s" : ""} linked automatically.`
        : "";
      toast({
        title: "Menu imported!",
        description: `${data.menuItemsCreated} menu item${data.menuItemsCreated !== 1 ? "s" : ""} added.${variantNote}`,
      });
      onComplete(named, sessionId, intelligence, barAnswer);
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateName = (idx: number, name: string) =>
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, name } : item));

  const handleBarAnswer = async (answer: boolean) => {
    setBarAnswer(answer);
    setBarSaving(true);
    try {
      await apiRequest("PATCH", "/api/onboarding/has-bar", { hasBar: answer });
    } catch {
      // Non-fatal
    } finally {
      setBarSaving(false);
    }
    setSubStep("review");
  };

  if (subStep === "bar-question") {
    return (
      <Card data-testid="card-step-bar-question">
        <CardHeader>
          <CardTitle>One quick question</CardTitle>
          <CardDescription>
            Do you serve alcohol or operate a bar?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3" data-testid="bar-question-tiles">
            <button
              className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 p-6 transition-colors ${
                barAnswer === true
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-primary/40"
              }`}
              onClick={() => handleBarAnswer(true)}
              disabled={barSaving}
              data-testid="tile-has-bar-yes"
            >
              <Wine className="w-8 h-8 text-muted-foreground" />
              <span className="font-medium text-sm">Yes, we serve alcohol</span>
            </button>
            <button
              className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 p-6 transition-colors ${
                barAnswer === false
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-primary/40"
              }`}
              onClick={() => handleBarAnswer(false)}
              disabled={barSaving}
              data-testid="tile-has-bar-no"
            >
              <Utensils className="w-8 h-8 text-muted-foreground" />
              <span className="font-medium text-sm">No, food only</span>
            </button>
          </div>
          {barSaving && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </div>
          )}
          <button
            className="w-full text-xs text-muted-foreground underline underline-offset-2 pt-1"
            onClick={() => setSubStep("review")}
            disabled={barSaving}
            data-testid="button-skip-bar-question"
          >
            Skip this question
          </button>
        </CardContent>
      </Card>
    );
  }

  if (subStep === "upload") {
    return (
      <Card data-testid="card-step-menu-scan">
        <CardHeader>
          <CardTitle>Scan your menu</CardTitle>
          <CardDescription>
            Upload a photo of your printed menu or PDF screenshot — our AI extracts the dishes automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanning ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Sparkles className="w-10 h-10 text-primary animate-pulse" />
              <p className="font-medium">Scanning your menu…</p>
              <p className="text-sm text-muted-foreground">Usually takes 10–20 seconds</p>
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10 rounded-md border-2 border-dashed border-muted">
              <Camera className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Supports JPG, PNG, WebP — up to 10 MB</p>
              <ObjectUploader
                onUploadComplete={handleUpload}
                buttonText="Choose Menu Image"
                dataTestId="button-upload-menu"
                visibility="private"
                maxFileSize={10485760}
              />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const deptOrder: string[] = [];
  const deptGroups = new Map<string, number[]>();
  items.forEach((item, idx) => {
    const dept = (item.department || "").trim() || "Other";
    if (!deptGroups.has(dept)) { deptGroups.set(dept, []); deptOrder.push(dept); }
    deptGroups.get(dept)!.push(idx);
  });

  const variantGroups = (() => {
    const keyToItems = new Map<string, { key: string; itemNames: string[] }>();
    for (const item of items) {
      const key = (item.variantGroupKey || "").trim();
      if (!key) continue;
      if (!keyToItems.has(key)) keyToItems.set(key, { key, itemNames: [] });
      keyToItems.get(key)!.itemNames.push(item.name.trim() || "(unnamed)");
    }
    return Array.from(keyToItems.values()).filter(g => g.itemNames.length >= 2);
  })();
  const detectedVariantGroupCount = variantGroups.length;

  const chainItems = [
    { Icon: BookOpen,     label: "Menu items",                     desc: "ready to cost as recipes" },
    { Icon: ClipboardList, label: "Recipes",                       desc: "costed automatically from your menu" },
    { Icon: Package,      label: "Vendor Order Guides",            desc: "prices tracked, changes flagged" },
    { Icon: Warehouse,    label: "Inventory",                      desc: "counted from your phone" },
    { Icon: BarChart3,    label: "Live food cost vs. theoretical",  desc: "variance visible at a glance" },
  ];

  return (
    <Card data-testid="card-step-menu-review">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <CardTitle className="text-base leading-snug">
              {items.length > 0
                ? "Your restaurant is already taking shape"
                : "No items found"}
            </CardTitle>
            <CardDescription className="mt-0.5">
              {items.length > 0
                ? `${items.length} item${items.length !== 1 ? "s" : ""} pulled from your menu — remove anything that doesn't belong, then import.`
                : "No items were extracted. Try a clearer photo or a different page of your menu."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length > 0 && (
          <div className="rounded-md border overflow-hidden max-h-64 overflow-y-auto">
            {deptOrder.map((dept) => {
              const indices = deptGroups.get(dept)!;
              return (
                <Fragment key={dept}>
                  <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 sticky top-0">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{dept}</span>
                    <Badge variant="secondary" className="text-xs">
                      {indices.length} {indices.length === 1 ? "item" : "items"}
                    </Badge>
                  </div>
                  {indices.map((idx) => {
                    const item = items[idx];
                    const hasPrice = item.price !== null && item.price > 0;
                    const hasDescription = item.description && item.description.trim().length > 0;
                    return (
                      <div key={idx} className="flex items-start gap-1 px-2 py-1 border-t">
                        <Check className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-1.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Input
                              value={item.name}
                              onChange={e => updateName(idx, e.target.value)}
                              className="h-6 border-0 px-0 shadow-none focus-visible:ring-0 bg-transparent flex-1 text-xs"
                              data-testid={`input-item-name-${idx}`}
                            />
                            {hasPrice && (
                              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">
                                ${item.price!.toFixed(2)}
                              </span>
                            )}
                          </div>
                          {hasDescription && (
                            <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2 mt-0.5" data-testid={`text-item-description-${idx}`}>
                              {item.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteItem(idx)}
                          className="p-0.5 rounded text-muted-foreground hover:text-destructive flex-shrink-0 mt-1"
                          data-testid={`button-delete-item-${idx}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}

        {variantGroups.length > 0 && (
          <div className="rounded-md border overflow-hidden" data-testid="section-variant-groups">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
              <Layers className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <p className="text-xs font-semibold text-foreground">
                {detectedVariantGroupCount} size variant group{detectedVariantGroupCount !== 1 ? "s" : ""} detected
              </p>
            </div>
            <div className="px-3 py-2 space-y-2.5">
              <p className="text-xs text-muted-foreground">
                Check each group you want linked as size variants. Unchecked groups import as separate standalone items.
              </p>
              {variantGroups.map((group) => {
                const enabled = !disabledVariantGroups.has(group.key);
                return (
                  <div key={group.key} className="flex items-start gap-2.5" data-testid={`variant-group-${group.key}`}>
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(checked) => {
                        setDisabledVariantGroups(prev => {
                          const next = new Set(prev);
                          if (checked) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      }}
                      data-testid={`checkbox-variant-group-${group.key}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1">
                        {group.itemNames.map((name: string, i: number) => (
                          <Badge key={i} variant="secondary" className={`text-xs ${!enabled ? "opacity-50" : ""}`}>
                            {name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {!addingPage ? (
            <Button variant="outline" size="sm" onClick={() => setAddingPage(true)} disabled={approveMutation.isPending} data-testid="button-add-page">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add another page
            </Button>
          ) : (
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <p className="text-xs text-muted-foreground font-medium">Scan the next page — items will be merged into the list above.</p>
              {addPageScanning ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <ObjectUploader
                    onUploadComplete={handleAddPage}
                    buttonText="Choose Next Page"
                    dataTestId="button-upload-next-page"
                    visibility="private"
                    maxFileSize={10485760}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setAddingPage(false)} data-testid="button-cancel-add-page">
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
          {items.length > 0 && (
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              data-testid="button-import-items"
            >
              {approveMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing…</>
              ) : (
                <>{`Import ${items.filter(i => i.name.trim()).length} Items`} <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setSubStep("upload"); setAddingPage(false); }} data-testid="button-scan-again">
            Scan a different image
          </Button>
        </div>

        <div className="rounded-md border overflow-hidden" data-testid="section-whats-next">
          {uploadedImages.length > 0 && (
            <div className="relative">
              <img
                src={uploadedImages[carouselIndex]}
                alt={`Menu page ${carouselIndex + 1}`}
                className="w-full h-24 object-cover object-top"
              />
              {uploadedImages.length > 1 && (
                <>
                  <button
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-base leading-none"
                    onClick={() => setCarouselIndex(i => (i - 1 + uploadedImages.length) % uploadedImages.length)}
                    aria-label="Previous image"
                    data-testid="button-carousel-prev"
                  >
                    ‹
                  </button>
                  <button
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-base leading-none"
                    onClick={() => setCarouselIndex(i => (i + 1) % uploadedImages.length)}
                    aria-label="Next image"
                    data-testid="button-carousel-next"
                  >
                    ›
                  </button>
                  <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
                    {uploadedImages.map((_, i) => (
                      <button
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${i === carouselIndex ? "bg-white" : "bg-white/50"}`}
                        onClick={() => setCarouselIndex(i)}
                        aria-label={`Go to page ${i + 1}`}
                        data-testid={`button-carousel-dot-${i}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="p-4 space-y-3">
            <p className="text-sm font-semibold">What's next — the full picture</p>
            <div className="space-y-2.5">
              {chainItems.map(({ Icon, label, desc }, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-3 h-3 text-primary" />
                  </div>
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{label}</span>
                    <span className="text-muted-foreground"> — {desc}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
