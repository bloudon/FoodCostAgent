import { useState, useEffect, Fragment, useCallback, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  Check, Loader2, Trash2, Camera, Sparkles, AlertCircle,
  ChevronRight, Package, FolderTree, Warehouse, BookOpen,
  ClipboardList, Zap, Building2, Edit2, Plus, X,
  BarChart3, ExternalLink, ArrowRight, FileText, RefreshCw,
  Wine, Utensils,
} from "lucide-react";

const logoImage = "/logo.png";

// ---- Wizard State Persistence ----
interface MenuIntelligence {
  phones: string[];
  addresses: string[];
  locationCount: number;
  multiLocationSignal: boolean;
}

interface WizardState {
  step: number;
  approvedMenuItems: { id: string; name: string }[];
  skippedRecipes: string[];
  storeId?: string;
  scannedIntelligence?: MenuIntelligence;
  hasBar?: boolean;
}

interface ApprovedMenuItem {
  id: string;
  name: string;
}

interface MenuItem {
  id: string;
  name: string;
  parentMenuItemId?: string | null;
  recipeId?: string | null;
}

interface InvoiceItem {
  name: string;
  unitPrice: number;
  casePrice?: number;
  priceSource?: "unit" | "case" | "zero";
  unit?: string;
  categoryHint?: string;
  matchedItemId?: string;
  matchedItemName?: string;
  matchConfidence: "high" | "medium" | "none";
  action: "update" | "create" | "skip";
}

interface ExtractedMenuItem {
  name: string;
  department: string;
  category: string;
  size: string;
  price: number | null;
}

interface ApproveResponse {
  menuItemsCreated: number;
  menuItemIds: string[];
}

interface InvoiceApplyResponse {
  created: number;
  updated: number;
}

function getWizardKey(companyId: string) {
  return `onboarding_wizard_${companyId}`;
}

function loadWizardState(companyId: string): WizardState {
  try {
    const raw = localStorage.getItem(getWizardKey(companyId));
    if (raw) return JSON.parse(raw) as WizardState;
  } catch {}
  return { step: 1, approvedMenuItems: [], skippedRecipes: [] };
}

function saveWizardState(companyId: string, state: WizardState) {
  try {
    localStorage.setItem(getWizardKey(companyId), JSON.stringify(state));
  } catch {}
}

function clearWizardState(companyId: string) {
  try {
    localStorage.removeItem(getWizardKey(companyId));
  } catch {}
}

// ---- Step definitions ----
const STEPS = [
  { id: "menu_scan", label: "Menu", icon: Camera },
  { id: "plan", label: "Plan", icon: Zap },
  { id: "store_setup", label: "Store", icon: Building2 },
  { id: "storage", label: "Storage", icon: Warehouse },
  { id: "invoice_scan", label: "Invoice", icon: FileText },
  { id: "categories", label: "Categories", icon: FolderTree },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  { id: "review", label: "Review", icon: BarChart3 },
  { id: "inventory", label: "Count #1", icon: ClipboardList },
];

export const STEP_MILESTONE_IDS: Record<number, string> = {
  1: "menu_scan",
  2: "plan",
  3: "store",
  4: "storage_locations",
  5: "invoice_scan",
  6: "categories",
  7: "recipes",
  8: "review",
  9: "inventory_count",
};

export async function postReviewStep(milestoneId: string): Promise<void> {
  try {
    await apiRequest("POST", "/api/onboarding/milestones/review-step", { stepId: milestoneId });
    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
  } catch {
    // Non-fatal — milestone tracker will re-sync on next load
  }
}

/**
 * Core milestone-posting logic extracted from the advance() callback.
 * Looks up the milestone ID for a wizard step and calls postReviewStep.
 * Exported so this exact linkage (advance → milestone → POST) can be tested.
 */
export async function advanceStep(currentStep: number): Promise<void> {
  const milestoneId = STEP_MILESTONE_IDS[currentStep];
  if (milestoneId) {
    await postReviewStep(milestoneId);
  }
}

// ---- Progress Stepper ----
function StepperBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-between mb-8 px-2" data-testid="wizard-stepper">
      {STEPS.map((step, i) => {
        const stepNum = i + 1;
        const isDone = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-colors border-2 ${
                  isDone
                    ? "bg-primary border-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-card border-primary text-primary"
                    : "bg-card border-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${step.id}`}
              >
                {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                  isCurrent ? "text-primary" : isDone ? "text-primary/70" : "text-muted-foreground/50"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${isDone ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Step 1: Menu Scan ----
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
      // Merge new items, de-duplicating by normalized name across both existing and incoming
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
      // Merge intelligence from additional pages: union phones/addresses, keep max locationCount
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
      // Roll back the optimistically appended image — scan failed so it contributed nothing
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
        items: valid,
        storeId: storeId || undefined,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Import failed");
      }
      return res.json() as Promise<ApproveResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      // Use real IDs returned by the server; pair with display names from local items array
      const validItems = items.filter(i => i.name.trim());
      const named: ApprovedMenuItem[] = (data.menuItemIds || []).map((id, idx) => ({
        id,
        name: validItems[idx]?.name?.trim() || `Item ${idx + 1}`,
      }));
      toast({
        title: "Menu imported!",
        description: `${data.menuItemsCreated} menu item${data.menuItemsCreated !== 1 ? "s" : ""} added.`,
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
      // Non-fatal — best effort
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
                    return (
                      <div key={idx} className="flex items-center gap-1 px-2 py-0.5 border-t">
                        <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
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
                        <button
                          onClick={() => deleteItem(idx)}
                          className="p-0.5 rounded text-muted-foreground hover:text-destructive flex-shrink-0"
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

// ---- Step 2: Plan Selection ----
// Users must actively click to go to /choose-plan — no auto-redirect.
// On return from Stripe with ?planActivated=true the wizard polls for
// plan status automatically (up to ~20s). The "I've selected a plan"
// button is always available for manual re-check.
function PlanStep({
  company,
  planActivated,
  locationCount,
  onContinue,
}: {
  company: { subscriptionTier?: string; name?: string } | null;
  planActivated: boolean;
  locationCount: number;
  onContinue: () => void;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [polling, setPolling] = useState(false);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [confirmedTier, setConfirmedTier] = useState("");
  const hasPlan = !!(company?.subscriptionTier && company.subscriptionTier !== "free");

  // When a paid plan is already on the company record, surface the celebration card.
  useEffect(() => {
    if (hasPlan) {
      setPlanConfirmed(true);
      setConfirmedTier(company?.subscriptionTier || "");
    }
  }, [hasPlan, company?.subscriptionTier]);

  // When returning from Stripe (?planActivated=true), poll until the
  // subscription webhook has propagated (max ~20 seconds / 10 polls).
  useEffect(() => {
    if (!planActivated || hasPlan) return;

    let attempts = 0;
    const MAX_ATTEMPTS = 10;
    setPolling(true);

    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        if (res.ok) {
          const data = await res.json() as { subscriptionTier?: string };
          if (data.subscriptionTier && data.subscriptionTier !== "free") {
            clearInterval(interval);
            setPolling(false);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
            setPlanConfirmed(true);
            setConfirmedTier(data.subscriptionTier);
            return;
          }
        }
      } catch {}
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        setPolling(false);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  }, [planActivated, hasPlan]);

  if (planConfirmed) {
    const tierDisplay: Record<string, string> = {
      basic: "Basic", pro: "Pro", enterprise: "Enterprise", starter: "Starter",
    };
    const planName = tierDisplay[confirmedTier] || confirmedTier || "Pro";
    return (
      <Card data-testid="card-plan-celebration">
        <CardContent className="py-10 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="space-y-1.5">
            <p className="text-lg font-bold leading-tight">You're in — let's set up your kitchen</p>
            <p className="text-sm text-muted-foreground">
              You're on the{" "}
              <span className="font-semibold text-foreground">{planName} plan</span>.
              {" "}Recipe costing, invoice scanning, and food cost reports are ready to configure.
            </p>
          </div>
          <Button
            className="w-full"
            onClick={onContinue}
            data-testid="button-plan-celebration-continue"
          >
            Let's go <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (polling) {
    return (
      <Card data-testid="card-step-plan-polling">
        <CardContent className="py-10 text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="font-semibold">Confirming your plan…</p>
          <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </CardContent>
      </Card>
    );
  }

  const handleCheckPlan = async () => {
    setChecking(true);
    try {
      const res = await apiRequest("GET", "/api/auth/me");
      if (res.ok) {
        const data = await res.json() as { subscriptionTier?: string };
        if (data.subscriptionTier && data.subscriptionTier !== "free") {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          setPlanConfirmed(true);
          setConfirmedTier(data.subscriptionTier);
        } else {
          toast({ title: "No active plan found", description: "Complete your plan selection to continue.", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Could not check plan status", description: "Please try again.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card data-testid="card-step-plan">
      <CardHeader>
        <CardTitle>Choose your plan</CardTitle>
        <CardDescription>
          A plan is required to unlock recipe costing, invoice scanning, and more.
          Click below to review options — you'll return here automatically after selecting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          className="w-full bg-[#f2690d] border-[#f2690d] text-white"
          onClick={() => {
            const params = new URLSearchParams({ returnTo: "/onboarding/setup" });
            if (locationCount > 1) params.set("locations", String(locationCount));
            setLocation(`/choose-plan?${params.toString()}`);
          }}
          data-testid="button-choose-plan"
        >
          View Plans &amp; Pricing
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleCheckPlan}
          disabled={checking}
          data-testid="button-check-plan"
        >
          {checking
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking…</>
            : <><RefreshCw className="w-4 h-4 mr-2" /> I've selected a plan — continue</>}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 3: Store Setup ----
function StoreSetupStep({
  storeId,
  scannedIntelligence,
  onComplete,
}: {
  storeId?: string;
  scannedIntelligence?: MenuIntelligence;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const { data: storesData, isLoading } = useQuery<{ id: string; name: string; description?: string | null }[]>({
    queryKey: ["/api/stores/accessible"],
  });

  const store = storesData?.find(s => s.id === storeId) || storesData?.[0];
  const [storeName, setStoreName] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [prefillDismissed, setPrefillDismissed] = useState(false);

  const suggestedAddress = scannedIntelligence?.addresses[0] || null;
  const suggestedPhone = scannedIntelligence?.phones[0] || null;
  const hasPrefill = !prefillDismissed && (!!suggestedAddress || !!suggestedPhone);

  useEffect(() => {
    if (store) {
      if (!storeName) setStoreName(store.name);
      if (!storeDescription && store.description) setStoreDescription(store.description);
    }
  }, [store]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sid = store?.id;
      if (!sid) throw new Error("No store found");
      const name = storeName.trim();
      if (!name) throw new Error("Store name is required");
      const payload: Record<string, string> = { name };
      if (storeDescription.trim()) payload.description = storeDescription.trim();
      const res = await apiRequest("PATCH", `/api/stores/${sid}`, payload);
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores/accessible"] });
      onComplete();
    },
    onError: (err: Error) => {
      toast({ title: "Could not save store name", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="card-step-store-loading">
        <CardContent className="py-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-step-store">
      <CardHeader>
        <CardTitle>Name your store</CardTitle>
        <CardDescription>
          We created a default store for you based on your company name. Give it a name that your team will recognize.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasPrefill && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5" data-testid="banner-menu-prefill">
            <p className="text-xs font-semibold text-primary">We found this on your menu:</p>
            {suggestedAddress && (
              <p className="text-sm text-muted-foreground">{suggestedAddress}</p>
            )}
            {suggestedPhone && (
              <p className="text-sm text-muted-foreground">{suggestedPhone}</p>
            )}
            <p className="text-xs text-muted-foreground">This has been saved to your account profile.</p>
            <button
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setPrefillDismissed(true)}
              data-testid="button-dismiss-prefill"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="store-name-input">Store name</label>
          <Input
            id="store-name-input"
            value={storeName}
            onChange={e => setStoreName(e.target.value)}
            placeholder="e.g. Downtown Location, Main Kitchen…"
            data-testid="input-store-name"
            onKeyDown={e => { if (e.key === "Enter" && storeName.trim()) saveMutation.mutate(); }}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="store-description-input">
            Notes <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="store-description-input"
            value={storeDescription}
            onChange={e => setStoreDescription(e.target.value)}
            placeholder="e.g. Main production kitchen, open 7am–10pm…"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            data-testid="input-store-description"
          />
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !storeName.trim()}
          className="w-full"
          data-testid="button-save-store-name"
        >
          {saveMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
          ) : (
            <><Check className="w-4 h-4 mr-2" /> Save &amp; Continue</>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={onComplete}
          data-testid="button-skip-store-name"
        >
          Keep this name — Continue
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 4: Invoice Scan ----
export function InvoiceScanStep({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [subStep, setSubStep] = useState<"upload" | "review">("upload");
  const [scanning, setScanning] = useState<boolean | { current: number; total: number }>(false);
  const [addingPage, setAddingPage] = useState(false);
  const [addPageScanning, setAddPageScanning] = useState(false);
  const [extractedItems, setExtractedItems] = useState<InvoiceItem[]>([]);
  const [vendorName, setVendorName] = useState("");

  const defaultAction = (item: InvoiceItem): "update" | "create" => {
    return (item.matchConfidence === "high" || item.matchConfidence === "medium") && item.matchedItemId
      ? "update"
      : "create";
  };

  const handleUpload = async (objectPath: string) => {
    setScanning(true);
    try {
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan", {
        imageObjectPath: objectPath,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Scan failed");
      }
      const data = await res.json() as { items: InvoiceItem[]; vendorName?: string };
      setVendorName(data.vendorName || "");
      setExtractedItems(
        (data.items || []).map((item) => ({
          ...item,
          action: defaultAction(item),
        }))
      );
      setSubStep("review");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      toast({ title: "Scan failed", description: message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleMultiUpload = async (objectPaths: string[]) => {
    const allItems: InvoiceItem[] = [];
    let firstVendorName = "";
    for (let i = 0; i < objectPaths.length; i++) {
      setScanning({ current: i + 1, total: objectPaths.length });
      try {
        const res = await apiRequest("POST", "/api/onboarding/invoice-scan", {
          imageObjectPath: objectPaths[i],
        });
        if (!res.ok) {
          const err = await res.json() as { error?: string };
          throw new Error(err.error || "Scan failed");
        }
        const data = await res.json() as { items: InvoiceItem[]; vendorName?: string };
        if (i === 0) firstVendorName = data.vendorName || "";
        const seen = new Set(allItems.map(it => it.name.toLowerCase().trim()));
        for (const item of (data.items || [])) {
          const key = item.name.toLowerCase().trim();
          if (!seen.has(key)) {
            seen.add(key);
            allItems.push(item);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Scan failed";
        toast({ title: `Page ${i + 1} scan failed`, description: message, variant: "destructive" });
        setScanning(false);
        return;
      }
    }
    setVendorName(firstVendorName);
    setExtractedItems(allItems.map(item => ({ ...item, action: defaultAction(item) })));
    setSubStep("review");
    setScanning(false);
  };

  const handleAddPage = async (objectPath: string) => {
    setAddPageScanning(true);
    try {
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan", {
        imageObjectPath: objectPath,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Scan failed");
      }
      const data = await res.json() as { items: InvoiceItem[]; vendorName?: string };
      setExtractedItems(prev => {
        const seen = new Set(prev.map(i => i.name.toLowerCase().trim()));
        const newUnique = (data.items || []).filter(i => {
          const key = i.name.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...prev, ...newUnique.map(item => ({ ...item, action: defaultAction(item) }))];
      });
      if (!vendorName && data.vendorName) setVendorName(data.vendorName);
      setAddingPage(false);
      toast({ title: "Page added", description: `${data.items?.length || 0} items scanned and merged.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      toast({ title: "Scan failed", description: message, variant: "destructive" });
    } finally {
      setAddPageScanning(false);
    }
  };

  const applyMutation = useMutation({
    mutationFn: async () => {
      const activeItems = extractedItems
        .filter(i => i.action !== "skip")
        .map(i => ({
          name: i.name,
          unitPrice: i.unitPrice,
          casePrice: i.casePrice,
          unit: i.unit,
          categoryHint: i.categoryHint,
          action: i.action,
          inventoryItemId: i.action === "update" ? i.matchedItemId : undefined,
        }));
      const createdItems = activeItems.filter(i => i.action === "create");
      if (createdItems.length === 0) throw new Error("At least one item must be set to 'Create new' to seed your inventory.");
      const res = await apiRequest("POST", "/api/onboarding/invoice-scan/apply", { items: activeItems });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Apply failed");
      }
      return res.json() as Promise<InvoiceApplyResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Invoice applied!",
        description: `${data.created || 0} created, ${data.updated || 0} updated.`,
      });
      onComplete();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to apply", description: err.message, variant: "destructive" });
    },
  });

  const setAction = (idx: number, action: "update" | "create" | "skip") => {
    setExtractedItems(prev => prev.map((item, i) => i === idx ? { ...item, action } : item));
  };

  const setPrice = (idx: number, value: string) => {
    const parsed = parseFloat(value);
    const unitPrice = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setExtractedItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, unitPrice, priceSource: "unit" } : item
    ));
  };

  const confidenceBadge = (c: string) =>
    c === "high" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
    c === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" :
    "bg-muted text-muted-foreground";

  if (subStep === "upload") {
    return (
      <Card data-testid="card-step-invoice-upload">
        <CardHeader>
          <CardTitle>Upload a vendor invoice</CardTitle>
          <CardDescription>
            Take a photo of any vendor invoice or order guide. AI will extract the items and prices to seed your inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanning ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Sparkles className="w-10 h-10 text-primary animate-pulse" />
              <p className="font-medium">
                {typeof scanning === "object"
                  ? `Reading page ${scanning.current} of ${scanning.total}…`
                  : "Reading invoice…"}
              </p>
              <p className="text-sm text-muted-foreground">This usually takes 10–20 seconds per page</p>
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10 rounded-md border-2 border-dashed border-muted">
              <Package className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Supports JPG, PNG, WebP — up to 10 MB per page</p>
              <ObjectUploader
                onUploadComplete={handleUpload}
                onMultipleUploadsComplete={handleMultiUpload}
                multiple={true}
                buttonText="Choose Invoice Image(s)"
                dataTestId="button-upload-invoice"
                visibility="private"
                maxFileSize={10485760}
              />
              <p className="text-xs text-muted-foreground">You can select multiple pages at once</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const createdCount = extractedItems.filter(i => i.action === "create").length;
  const updatedCount = extractedItems.filter(i => i.action === "update").length;

  const applyLabel = (() => {
    if (createdCount === 0 && updatedCount === 0) return "Set at least one item to 'Create new'";
    if (createdCount === 0) return "Set at least one item to 'Create new'";
    const parts: string[] = [];
    parts.push(`Create ${createdCount}`);
    if (updatedCount > 0) parts.push(`Update ${updatedCount}`);
    return `Apply — ${parts.join(", ")}`;
  })();

  return (
    <Card data-testid="card-step-invoice-review">
      <CardHeader>
        <CardTitle>
          Review extracted items{vendorName ? ` from ${vendorName}` : ""}
        </CardTitle>
        <CardDescription>
          Adjust prices and actions, then click Apply to seed your inventory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border overflow-hidden max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-right px-3 py-2 font-medium w-28">Unit Price</th>
                <th className="px-3 py-2 font-medium w-40">Action</th>
              </tr>
            </thead>
            <tbody>
              {extractedItems.map((item, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">
                    <p className="font-medium leading-tight">{item.name}</p>
                    {item.matchedItemName && item.matchConfidence !== "none" && (
                      <p className="text-xs text-muted-foreground">
                        Matches: {item.matchedItemName}
                        <span className={`ml-1.5 px-1 rounded text-[10px] font-medium ${confidenceBadge(item.matchConfidence)}`}>
                          {item.matchConfidence}
                        </span>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-0.5">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={item.unitPrice.toFixed(4)}
                          onChange={e => setPrice(idx, e.target.value)}
                          className="w-20 text-right text-xs rounded border px-1.5 py-0.5 bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          data-testid={`input-price-${idx}`}
                        />
                      </div>
                      {item.priceSource === "case" && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 no-default-active-elevate"
                          title="The AI only found a case price — this may not be the correct per-unit cost. Please verify before applying."
                        >
                          case price
                        </Badge>
                      )}
                      {item.priceSource === "zero" && (
                        <span className="text-[10px] text-muted-foreground">not found</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={item.action}
                      onChange={e => setAction(idx, e.target.value as "update" | "create" | "skip")}
                      className="text-xs rounded border px-1.5 py-1 bg-background w-full"
                      data-testid={`select-action-${idx}`}
                    >
                      {item.matchedItemId && <option value="update">Update existing</option>}
                      <option value="create">Create new</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {addingPage ? (
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <p className="text-sm font-medium">Add another page</p>
            {addPageScanning ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Scanning page…
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ObjectUploader
                  onUploadComplete={handleAddPage}
                  buttonText="Choose Page Image"
                  dataTestId="button-upload-invoice-page"
                  visibility="private"
                  maxFileSize={10485760}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingPage(false)}
                  data-testid="button-cancel-add-page"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingPage(true)}
            disabled={applyMutation.isPending || addPageScanning}
            data-testid="button-add-invoice-page"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add another page
          </Button>
        )}

        <Button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending || createdCount === 0}
          data-testid="button-apply-invoice"
        >
          {applyMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
          ) : applyLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 4: Categories ----
const SUGGESTED_FOOD_CATEGORIES: { name: string; showAsIngredient: number }[] = [
  { name: "Produce",                 showAsIngredient: 1 },
  { name: "Dairy",                   showAsIngredient: 1 },
  { name: "Proteins",                showAsIngredient: 1 },
  { name: "Seafood",                 showAsIngredient: 1 },
  { name: "Cheese",                  showAsIngredient: 1 },
  { name: "Bread & Dough",           showAsIngredient: 1 },
  { name: "Dry Goods & Pantry",      showAsIngredient: 1 },
  { name: "Frozen",                  showAsIngredient: 1 },
  { name: "Oils & Condiments",       showAsIngredient: 1 },
  { name: "Spices & Seasonings",     showAsIngredient: 1 },
  { name: "Herbs & Garnish",         showAsIngredient: 1 },
  { name: "Beer",                    showAsIngredient: 1 },
  { name: "Wine",                    showAsIngredient: 1 },
  { name: "Spirits & Liquor",        showAsIngredient: 1 },
  { name: "Non-Alcoholic Beverages", showAsIngredient: 1 },
  { name: "Desserts & Pastry",       showAsIngredient: 1 },
  { name: "Cleaning & Supplies",     showAsIngredient: 0 },
  { name: "Paper & Smallwares",      showAsIngredient: 0 },
];

function CategoriesStep({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const { data: cats, isLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/categories"],
  });

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(SUGGESTED_FOOD_CATEGORIES.map(c => c.name))
  );
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const existingNames = useMemo(
    () => new Set((cats || []).map(c => c.name.toLowerCase())),
    [cats]
  );

  const extraDbCats = useMemo(
    () => (cats || []).filter(
      c => !SUGGESTED_FOOD_CATEGORIES.some(s => s.name.toLowerCase() === c.name.toLowerCase())
    ),
    [cats]
  );

  const toggle = (name: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const toCreate = SUGGESTED_FOOD_CATEGORIES.filter(
        c => checked.has(c.name) && !existingNames.has(c.name.toLowerCase())
      );
      for (const cat of toCreate) {
        const res = await apiRequest("POST", "/api/categories", {
          name: cat.name,
          showAsIngredient: cat.showAsIngredient,
        });
        if (!res.ok) throw new Error(`Failed to create category: ${cat.name}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      onComplete();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addCustomMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/categories", { name: newName.trim(), showAsIngredient: 1 });
      if (!res.ok) throw new Error("Failed to create category");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setNewName("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/categories/${id}`, { name });
      if (!res.ok) throw new Error("Failed to update category");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-step-categories">
      <CardHeader>
        <CardTitle>Choose your categories</CardTitle>
        <CardDescription>
          Select the categories that apply to your kitchen. Uncheck any you don't need — you can always add more later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading…</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {SUGGESTED_FOOD_CATEGORIES.map(cat => {
                const isExisting = existingNames.has(cat.name.toLowerCase());
                const isChecked = isExisting || checked.has(cat.name);
                const testId = `checkbox-category-${cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                return (
                  <label
                    key={cat.name}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer select-none transition-colors ${
                      isChecked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-transparent"
                    }`}
                    data-testid={`label-category-${cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => { if (!isExisting) toggle(cat.name); }}
                      disabled={isExisting}
                      data-testid={testId}
                    />
                    <span className="text-sm flex-1">{cat.name}</span>
                    {isExisting && (
                      <Badge variant="secondary" className="text-xs shrink-0">Added</Badge>
                    )}
                  </label>
                );
              })}
            </div>

            {extraDbCats.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">From your invoice</p>
                <div className="space-y-1">
                  {extraDbCats.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50" data-testid={`category-row-${cat.id}`}>
                      {editingId === cat.id ? (
                        <>
                          <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="h-7 text-sm"
                            autoFocus
                            data-testid={`input-category-edit-${cat.id}`}
                            onKeyDown={e => {
                              if (e.key === "Enter") updateMutation.mutate({ id: cat.id, name: editName });
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ id: cat.id, name: editName })} disabled={updateMutation.isPending} data-testid={`button-save-category-${cat.id}`}>
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-category-${cat.id}`}>
                            <X className="w-3 h-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{cat.name}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                            data-testid={`button-edit-category-${cat.id}`}
                          >
                            <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add a custom category</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. House-made Sauces…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && newName.trim() && addCustomMutation.mutate()}
                  data-testid="input-new-category"
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addCustomMutation.mutate()}
                  disabled={!newName.trim() || addCustomMutation.isPending}
                  data-testid="button-add-category"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>
          </>
        )}

        <Button
          onClick={() => saveMutation.mutate()}
          className="w-full"
          disabled={saveMutation.isPending}
          data-testid="button-continue-categories"
        >
          {saveMutation.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
            : "Categories look good — Continue"
          }
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 5: Storage Locations ----
function StorageStep({ hasBar, onComplete }: { hasBar?: boolean; onComplete: () => void }) {
  const { toast } = useToast();
  const { data: existingLocations } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/storage-locations"],
  });

  const BASE_OPTIONS = [
    { name: "Walk-in Cooler", defaultChecked: true },
    { name: "Dry Pantry", defaultChecked: true },
    { name: "Freezer", defaultChecked: true },
    { name: "Dry Storage", defaultChecked: false },
  ];
  const BAR_OPTIONS = [
    { name: "Bar", defaultChecked: true },
    { name: "Beer Cooler", defaultChecked: true },
  ];

  const allSeedOptions = hasBar ? [...BASE_OPTIONS, ...BAR_OPTIONS] : BASE_OPTIONS;

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(allSeedOptions.filter(o => o.defaultChecked).map(o => o.name))
  );
  const [customOptions, setCustomOptions] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);

  // If hasBar resolves to true after initial mount (company query loads async),
  // ensure bar options that should be pre-checked are added to the checked set.
  const barInitialized = useRef(false);
  useEffect(() => {
    if (hasBar && !barInitialized.current) {
      barInitialized.current = true;
      setChecked(prev => {
        const next = new Set(prev);
        BAR_OPTIONS.filter(o => o.defaultChecked).forEach(o => next.add(o.name));
        return next;
      });
    }
  }, [hasBar]);

  const toggleOption = (name: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (!customOptions.includes(trimmed) && !allSeedOptions.some(o => o.name === trimmed)) {
      setCustomOptions(prev => [...prev, trimmed]);
      setChecked(prev => new Set([...prev, trimmed]));
    }
    setCustomInput("");
  };

  const handleConfirm = async () => {
    const selectedNames = Array.from(checked);
    if (selectedNames.length === 0) {
      toast({ title: "Select at least one location", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const existingNames = new Set(
        (existingLocations || []).map(l => l.name.toLowerCase().trim())
      );
      // Deduplicate selected names by normalized key before POSTing
      const seenKeys = new Set<string>();
      const uniqueSelected = selectedNames.filter(n => {
        const key = n.toLowerCase().trim();
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      const toCreate = uniqueSelected.filter(
        n => !existingNames.has(n.toLowerCase().trim())
      );
      for (let i = 0; i < toCreate.length; i++) {
        await apiRequest("POST", "/api/storage-locations", {
          name: toCreate[i],
          sortOrder: (existingLocations?.length || 0) + i + 1,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      onComplete();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save locations";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const allOptionNames = [
    ...allSeedOptions.map(o => o.name),
    ...customOptions,
  ];

  return (
    <Card data-testid="card-step-storage">
      <CardHeader>
        <CardTitle>Where do you store things?</CardTitle>
        <CardDescription>
          Pick the storage areas in your kitchen — we'll use these to organise your inventory counts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2" data-testid="storage-options-grid">
          {allOptionNames.map((name) => {
            const isChecked = checked.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleOption(name)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm text-left ${
                  isChecked
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
                data-testid={`toggle-storage-${name.toLowerCase().replace(/[\s/]+/g, "-")}`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  isChecked ? "bg-primary border-primary" : "border-muted-foreground/40"
                }`}>
                  {isChecked && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <span>{name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Add your own (e.g. Prep Kitchen)…"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && customInput.trim() && addCustom()}
            data-testid="input-custom-storage"
            className="text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addCustom}
            disabled={!customInput.trim()}
            data-testid="button-add-custom-storage"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>

        <Button
          className="w-full"
          onClick={handleConfirm}
          disabled={checked.size === 0 || saving}
          data-testid="button-confirm-storage"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
          ) : (
            <>Confirm {checked.size} Location{checked.size !== 1 ? "s" : ""}<ArrowRight className="w-4 h-4 ml-2" /></>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 6: Recipes ----
function RecipesStep({
  approvedMenuItems,
  onComplete,
  onSkipRecipe,
  skippedRecipes,
}: {
  approvedMenuItems: ApprovedMenuItem[];
  onComplete: () => void;
  onSkipRecipe: (id: string) => void;
  skippedRecipes: string[];
}) {
  const [, setLocation] = useLocation();
  const [currentIdx, setCurrentIdx] = useState(0);

  const { data: menuItemsData } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });
  const { data: recipesData } = useQuery<{ id: string; computedCost: number; componentCount: number }[]>({ queryKey: ["/api/recipes"] });

  // A recipe is "costed" when it has at least one ingredient component. componentCount >= 1
  // is the authoritative check; computedCost > 0 was a weaker proxy that failed for
  // valid recipes where all ingredients happen to have $0 price (e.g., early setup).
  const costedRecipeIds = new Set<string>(
    (recipesData || []).filter((r) => r.componentCount >= 1).map((r) => r.id)
  );

  const menuItemsWithRecipes = new Set<string>(
    (menuItemsData || [])
      .filter((m) => m.recipeId && costedRecipeIds.has(m.recipeId))
      .map((m) => m.id)
  );

  const items = approvedMenuItems.length > 0
    ? approvedMenuItems
    : (menuItemsData || []).filter((m) => !m.parentMenuItemId).map((m) => ({ id: m.id, name: m.name }));

  const costedCount = items.filter(i => menuItemsWithRecipes.has(i.id) || skippedRecipes.includes(i.id)).length;
  const totalCount = items.length;
  const allDone = costedCount >= totalCount;

  const current = items[currentIdx];

  const goNext = () => {
    // Never auto-complete from goNext — onComplete() is only
    // triggered by the explicit "All done — Continue" button once
    // every item has been costed or explicitly skipped.
    if (currentIdx < items.length - 1) {
      setCurrentIdx(i => i + 1);
    }
  };

  const isCosted = (id: string) => menuItemsWithRecipes.has(id) || skippedRecipes.includes(id);

  if (items.length === 0) {
    return (
      <Card data-testid="card-step-recipes-empty">
        <CardHeader>
          <CardTitle>Build your recipes</CardTitle>
          <CardDescription>No menu items found yet — build a recipe from the recipe builder to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setLocation("/recipes/new")} className="w-full" data-testid="button-go-recipes">
            Open Recipe Builder <ExternalLink className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-step-recipes">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Build your recipes</CardTitle>
          <Badge variant="secondary" data-testid="badge-recipe-progress">
            {costedCount} of {totalCount} costed
          </Badge>
        </div>
        <CardDescription>
          Work through each menu item to build its recipe. You can mark any as "skip for now" to revisit later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress dots */}
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setCurrentIdx(idx)}
              title={item.name}
              data-testid={`dot-recipe-${idx}`}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                isCosted(item.id)
                  ? "bg-primary border-primary"
                  : idx === currentIdx
                  ? "bg-card border-primary"
                  : "bg-muted border-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Current item card */}
        {current && (
          <div className="rounded-md border p-4 space-y-3" data-testid="card-current-recipe-item">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold capitalize">{current.name}</p>
                <p className="text-xs text-muted-foreground">
                  Item {currentIdx + 1} of {items.length}
                </p>
              </div>
              {isCosted(current.id) && (
                <Badge className="bg-green-500 text-white" data-testid={`badge-costed-${current.id}`}>
                  <Check className="w-3 h-3 mr-1" /> Costed
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => setLocation(`/recipes/new?menuItemId=${current.id}&menuItemName=${encodeURIComponent(current.name)}`)}
                data-testid={`button-build-recipe-${current.id}`}
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Build Recipe for "{current.name}"
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
              <div className="flex gap-2">
                {currentIdx > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setCurrentIdx(i => i - 1)} data-testid="button-recipe-prev">
                    ← Prev
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-muted-foreground"
                  onClick={() => { onSkipRecipe(current.id); goNext(); }}
                  data-testid={`button-skip-recipe-${current.id}`}
                >
                  Skip for now →
                </Button>
                {currentIdx < items.length - 1 && (
                  <Button variant="outline" size="sm" onClick={() => setCurrentIdx(i => i + 1)} data-testid="button-recipe-next">
                    Next →
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {allDone && (
          <Button onClick={onComplete} className="w-full" data-testid="button-continue-recipes">
            <Check className="w-4 h-4 mr-2" /> All done — Continue to Review
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Step 7: Review ----
function ReviewStep({ approvedMenuItems, onComplete }: { approvedMenuItems: ApprovedMenuItem[]; onComplete: () => void }) {
  const { data: menuItemsData } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });
  const { data: inventoryData } = useQuery<{ id: string }[]>({ queryKey: ["/api/inventory-items"] });
  const { data: vendorsData } = useQuery<{ id: string }[]>({ queryKey: ["/api/vendors"] });
  const { data: recipesData } = useQuery<{ id: string; componentCount: number }[]>({ queryKey: ["/api/recipes"] });

  const [, setLocation] = useLocation();

  const allRootMenuItems = (menuItemsData || []).filter((m) => !m.parentMenuItemId);

  // When wizard-approved items are available, scope "Menu Items" to that set so the
  // count reflects what was reviewed in this onboarding session, not pre-existing items.
  // Fall back to all root items for accounts that skipped the menu scan step.
  const approvedIds = new Set(approvedMenuItems.map((a) => a.id));
  const scopedMenuItems = approvedMenuItems.length > 0
    ? allRootMenuItems.filter((m) => approvedIds.has(m.id))
    : allRootMenuItems;

  // Use componentCount >= 1 (same definition as Step 6) so recipes with zero-priced
  // ingredients are still counted as costed — matching the Step 6 progression check.
  const costedRecipeIdSet = new Set<string>(
    (recipesData || []).filter((r) => r.componentCount >= 1).map((r) => r.id)
  );
  const costedMenuItems = scopedMenuItems.filter(
    (m) => m.recipeId && costedRecipeIdSet.has(m.recipeId)
  );
  // Flag both: no recipe linked at all, AND recipe linked but uncosted (no ingredients yet).
  const missingRecipe = scopedMenuItems.filter(
    (m) => !m.recipeId || !costedRecipeIdSet.has(m.recipeId)
  );

  const stats = [
    { label: "Menu Items", value: scopedMenuItems.length, icon: Camera },
    { label: "Recipes Costed", value: costedMenuItems.length, icon: BookOpen },
    { label: "Inventory Items", value: (inventoryData || []).length, icon: Package },
    { label: "Vendors", value: (vendorsData || []).length, icon: Building2 },
  ];

  return (
    <Card data-testid="card-step-review">
      <CardHeader>
        <CardTitle>Setup Summary</CardTitle>
        <CardDescription>Here's where things stand before your first inventory count.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-md border p-3 text-center" data-testid={`stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}>
                <Icon className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {missingRecipe.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {missingRecipe.length} menu item{missingRecipe.length !== 1 ? "s" : ""} still need{missingRecipe.length === 1 ? "s" : ""} a recipe:
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {missingRecipe.slice(0, 10).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50" data-testid={`missing-recipe-row-${item.id}`}>
                  <span className="capitalize">{item.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLocation(`/recipes/new?menuItemId=${item.id}&menuItemName=${encodeURIComponent(item.name)}`)}
                    data-testid={`button-build-recipe-review-${item.id}`}
                  >
                    Build <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              ))}
              {missingRecipe.length > 10 && (
                <p className="text-xs text-muted-foreground px-2">…and {missingRecipe.length - 10} more</p>
              )}
            </div>
          </div>
        )}

        <Button onClick={onComplete} className="w-full bg-[#f2690d] border-[#f2690d] text-white" data-testid="button-start-first-count">
          <ClipboardList className="w-4 h-4 mr-2" />
          Start My First Count
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 8: Inventory #1 ----
function InventoryStep({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: storesData } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/stores/accessible"] });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const storeId = storesData?.[0]?.id;
      if (!storeId) throw new Error("No store found — please add a store first.");
      const today = new Date().toISOString().split("T")[0];
      const res = await apiRequest("POST", "/api/inventory-counts", {
        storeId,
        name: "Opening Count",
        note: "First inventory count to establish on-hand quantities.",
        countDate: today,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "Failed to create session");
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      onComplete();
      setLocation(`/count/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-step-inventory">
      <CardHeader>
        <CardTitle>Start your first inventory count</CardTitle>
        <CardDescription>
          A count session lets you walk your storage areas and record what you have on hand.
          This establishes your baseline so you can track usage and catch variance over time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 p-4 space-y-2 text-sm text-muted-foreground">
          <p><strong className="text-foreground">Walk each storage area</strong> — freezer, walk-in, dry storage, etc.</p>
          <p><strong className="text-foreground">Count every item</strong> — use your phone camera for shelf scans (Pro) or enter counts manually.</p>
          <p><strong className="text-foreground">Finalize when done</strong> — costs and on-hand quantities update instantly.</p>
        </div>
        {storesData?.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>No store locations found. You need at least one store to start a count.</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation("/stores")}
              data-testid="button-go-create-store"
            >
              <Building2 className="w-4 h-4 mr-2" /> Set Up Your First Store
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
            className="w-full bg-[#f2690d] border-[#f2690d] text-white"
            data-testid="button-start-count-session"
          >
            {createSessionMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating session…</>
            ) : (
              <><ClipboardList className="w-4 h-4 mr-2" /> Begin Opening Count</>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Main Wizard ----
export default function OnboardingSetup() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const { toast } = useToast();
  const { company, selectedCompanyId, isLoading: companyLoading } = useCompany();
  const { user, isLoading: authLoading } = useAuth();

  const companyId = selectedCompanyId || user?.companyId || "";

  const [wizardState, setWizardState] = useState<WizardState>(() =>
    companyId ? loadWizardState(companyId) : { step: 1, approvedMenuItems: [], skippedRecipes: [] }
  );

  // Load state from localStorage once companyId is known.
  // Never allow URL ?step=N to jump past earlier steps — sequential gating is enforced.
  useEffect(() => {
    if (companyId && wizardState.step === 1 && wizardState.approvedMenuItems.length === 0) {
      const saved = loadWizardState(companyId);
      setWizardState(saved);
    }
  }, [companyId]);

  // Detect Stripe return: ?planActivated=true triggers an immediate cache
  // bust so PlanStep can poll for the freshly activated subscription.
  const planActivated = new URLSearchParams(searchStr).get("planActivated") === "true";

  const updateState = useCallback((patch: Partial<WizardState>) => {
    setWizardState(prev => {
      const next = { ...prev, ...patch };
      if (companyId) saveWizardState(companyId, next);
      return next;
    });
  }, [companyId]);

  // Bootstrap storeId from API when not present in persisted wizard state
  // (e.g. first login, cleared localStorage, or different device).
  const { data: bootstrapStores } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/stores/accessible"],
    enabled: !!companyId && !wizardState.storeId,
  });
  useEffect(() => {
    if (bootstrapStores && bootstrapStores.length > 0 && !wizardState.storeId) {
      updateState({ storeId: bootstrapStores[0].id });
    }
  }, [bootstrapStores, wizardState.storeId]);

  const advance = useCallback(async (currentStep: number) => {
    await advanceStep(currentStep);
    setWizardState(prev => {
      const next = { ...prev, step: Math.min(9, prev.step + 1) };
      if (companyId) saveWizardState(companyId, next);
      return next;
    });
  }, [companyId]);

  const finishWizard = useCallback(async () => {
    await postReviewStep("inventory_count");
    if (companyId) clearWizardState(companyId);
    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
  }, [companyId]);

  // Auth guard
  if (authLoading || (user && companyLoading && !selectedCompanyId)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto mx-auto mb-6" />
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <p>Please sign in to continue setting up your account.</p>
          </div>
          <Button onClick={() => setLocation("/login")} data-testid="button-go-to-login">Sign In</Button>
        </div>
      </div>
    );
  }

  if (user.role === "global_admin" && !selectedCompanyId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto mx-auto mb-6" />
          <AlertCircle className="h-5 w-5 text-amber-500 mx-auto" />
          <p className="text-muted-foreground">Select a company from the header before running the setup wizard.</p>
          <Button onClick={() => setLocation("/companies")} data-testid="button-go-to-companies">Select Company</Button>
        </div>
      </div>
    );
  }

  const { step, approvedMenuItems, skippedRecipes, storeId } = wizardState;

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-start bg-white text-gray-900 p-4 pt-8"
      style={{ colorScheme: "light" }}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <img src={logoImage} alt="FNB Cost Pro" className="h-12 w-auto" />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Step {step} of 9</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => setLocation("/")}
              data-testid="button-exit-wizard"
            >
              Exit Setup
            </Button>
          </div>
        </div>

        {/* Stepper */}
        <StepperBar currentStep={step} />

        {/* Step content */}
        {step === 1 && (
          <MenuScanStep
            storeId={storeId}
            initialHasBar={company?.hasBar}
            onComplete={(items, _sessionId, intel, hasBar) => {
              updateState({ approvedMenuItems: items, scannedIntelligence: intel, hasBar });
              advance(1);
            }}
          />
        )}

        {step === 2 && (
          <PlanStep
            company={company}
            planActivated={planActivated}
            locationCount={wizardState.scannedIntelligence?.locationCount ?? 1}
            onContinue={() => advance(2)}
          />
        )}

        {step === 3 && (
          <StoreSetupStep
            storeId={storeId}
            scannedIntelligence={wizardState.scannedIntelligence}
            onComplete={() => advance(3)}
          />
        )}

        {step === 4 && (
          <StorageStep hasBar={company?.hasBar === 1} onComplete={() => advance(4)} />
        )}

        {step === 5 && (
          <InvoiceScanStep onComplete={() => advance(5)} />
        )}

        {step === 6 && (
          <CategoriesStep onComplete={() => advance(6)} />
        )}

        {step === 7 && (
          <RecipesStep
            approvedMenuItems={approvedMenuItems}
            skippedRecipes={skippedRecipes}
            onComplete={() => advance(7)}
            onSkipRecipe={(id) => updateState({ skippedRecipes: [...skippedRecipes, id] })}
          />
        )}

        {step === 8 && (
          <ReviewStep
            approvedMenuItems={approvedMenuItems}
            onComplete={() => advance(8)}
          />
        )}

        {step === 9 && (
          <InventoryStep
            onComplete={finishWizard}
          />
        )}

        {/* Back navigation */}
        {step > 1 && step < 9 && (
          <div className="mt-4 flex justify-start">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => {
                setWizardState(prev => {
                  const next = { ...prev, step: Math.max(1, prev.step - 1) };
                  if (companyId) saveWizardState(companyId, next);
                  return next;
                });
              }}
              data-testid="button-wizard-back"
            >
              ← Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
