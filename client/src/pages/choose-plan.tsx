import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Check, Zap, Building2, Loader2, Star, Building, MapPin, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RestaurantBackground } from "@/components/restaurant-background";
import { useCompany } from "@/hooks/use-company";
const logoImage = "/logo.png";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PRICING, type BillingTerm } from "@/lib/pricing-constants";

const TRIAL_DAYS = 14;

type Term = BillingTerm;
type AppTier = "basic" | "pro";  // internal DB values

const TERM_LABELS: Record<Term, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

const TERM_SAVINGS: Record<Term, string | null> = {
  monthly: null,
  annual: "Save ~14%",
};

const STARTER_FEATURES: string[] = [
  "1 store location · 3 team seats",
  "AI menu scan — seed your recipe library from a photo",
  "AI recipe scan — photograph recipe cards, get costed recipes",
  "AI invoice scan — photograph invoices, auto-match to inventory",
  "Live recipe costing with automatic price updates",
  "Nested sub-recipe support",
  "Vendor order guide imports (Sysco, GFS, US Foods)",
  "TFC variance reporting",
  "POS sales data import",
  "Smart dashboard",
  "AI kitchen assistant",
  "Online chat support",
];

const PRO_FEATURES: string[] = [
  "Unlimited store locations",
  "Everything in Starter",
  "AI shelf scan — count inventory with your phone camera",
  "AI catch-weight scanning for proteins",
  "Cross-shop vendor price comparison",
  "QuickBooks export for received orders",
  "Power Inventory counting",
  "Transfer orders between locations",
  "Custom Security Levels",
  "Unlimited team member seats",
  "Priority support",
];

const ENTERPRISE_FEATURES: string[] = [
  "Everything in Pro",
  "Multi-brand inventory management",
  "Multi-POS integration",
  "Franchise analytics",
  "Unlimited locations & seats",
  "SLA + dedicated onboarding",
  "Custom implementation & API integrations",
];

export default function ChoosePlan() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const { selectedCompanyId } = useCompany();
  const [selectedTerm, setSelectedTerm] = useState<Term>("monthly");
  const [loadingTier, setLoadingTier] = useState<AppTier | null>(null);

  const { locationCount, returnTo } = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const val = parseInt(params.get("locations") || "0", 10);
    return {
      locationCount: isNaN(val) ? 0 : val,
      returnTo: params.get("returnTo") || null,
    };
  }, [searchString]);

  const isMultiLocation = locationCount > 1;

  const checkoutMutation = useMutation({
    mutationFn: async ({ tier, term }: { tier: AppTier; term: Term }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", {
        tier,
        term,
        ...(returnTo ? { returnTo } : {}),
      });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      setLoadingTier(null);
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: any) => {
      setLoadingTier(null);
      toast({
        title: "Something went wrong",
        description: err?.message || "Could not start checkout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSelectPlan = (tier: AppTier) => {
    setLoadingTier(tier);
    checkoutMutation.mutate({ tier, term: selectedTerm });
  };

  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
  const trialEndStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const starterPrice = PRICING.starter[selectedTerm];
  const proData = PRICING.pro[selectedTerm];

  return (
    <div className="relative min-h-screen bg-background">
      <RestaurantBackground companyId={selectedCompanyId ?? undefined} />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-8">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
        </div>

        {/* Header card */}
        <div className="bg-card rounded-lg border overflow-hidden mb-6">
          <div className="p-6 md:p-8 text-center">
            <Badge className="mb-3 bg-green-600 text-white no-default-active-elevate" data-testid="badge-trial">
              {TRIAL_DAYS}-Day Free Trial
            </Badge>
            <h1 className="text-2xl font-bold mb-2">Choose Your Plan</h1>
            <p className="text-muted-foreground text-sm">
              Full access for {TRIAL_DAYS} days — no charge until {trialEndStr}. Cancel anytime before then.
            </p>

            {/* Term toggle */}
            <div className="flex items-center justify-center gap-2 mt-5">
              {(["monthly", "annual"] as Term[]).map((term) => (
                <button
                  key={term}
                  data-testid={`button-term-${term}`}
                  onClick={() => setSelectedTerm(term)}
                  className={`relative px-4 py-2 rounded-md text-sm font-medium transition-colors border ${
                    selectedTerm === term
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover-elevate"
                  }`}
                >
                  {TERM_LABELS[term]}
                  {TERM_SAVINGS[term] && (
                    <span className="ml-1.5 text-xs text-green-500 font-semibold">
                      {TERM_SAVINGS[term]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Multi-location callout */}
        {isMultiLocation && (
          <div
            className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
            data-testid="callout-multi-location"
          >
            <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              You indicated <strong>{locationCount} locations</strong> — Pro includes unlimited locations, transfer orders, and cross-location reporting.
              Starter covers one location and is the right starting point for a single-store operation.
            </p>
          </div>
        )}

        {/* Starter + Pro cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Starter */}
          <div
            data-testid="card-plan-starter"
            className="bg-card rounded-lg border overflow-hidden flex flex-col"
          >
            <div className="p-6 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-bold">Starter</h2>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-3">{TRIAL_DAYS}-day free trial included</p>

              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${starterPrice}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                {selectedTerm === "annual" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Billed ${starterPrice * 12}/year
                  </p>
                )}
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {STARTER_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <Button
                data-testid="button-select-starter"
                onClick={() => handleSelectPlan("basic")}
                disabled={loadingTier !== null}
                variant="outline"
              >
                {loadingTier === "basic" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    Start {TRIAL_DAYS}-Day Free Trial
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Pro */}
          <div
            data-testid="card-plan-pro"
            className="bg-card rounded-lg border border-primary ring-1 ring-primary overflow-hidden flex flex-col"
          >
            <div className="bg-primary text-primary-foreground text-center text-xs font-semibold py-1.5 flex items-center justify-center gap-1">
              <Star className="w-3 h-3" />
              {isMultiLocation ? "Recommended for You" : "Most Popular"}
            </div>
            <div className="p-6 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold">Pro</h2>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-3">{TRIAL_DAYS}-day free trial included</p>

              <div className="mb-1">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${proData.total}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ${proData.platform} platform + ${proData.perStore}/location
                </p>
                {selectedTerm === "annual" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Billed ${proData.total * 12}/year for first location
                  </p>
                )}
              </div>

              <div className="mb-4" />

              <ul className="space-y-2 mb-6 flex-1">
                {PRO_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <Button
                data-testid="button-select-pro"
                onClick={() => handleSelectPlan("pro")}
                disabled={loadingTier !== null}
                className="bg-[#f2690d] border-[#f2690d] text-white"
              >
                {loadingTier === "pro" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    Start {TRIAL_DAYS}-Day Free Trial
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Enterprise card */}
        <div
          data-testid="card-plan-enterprise"
          className="bg-card rounded-lg border overflow-hidden mb-6"
        >
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Building className="w-5 h-5 text-muted-foreground" />
                  <h2 className="text-lg font-bold">Enterprise</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  For franchise groups and large multi-unit operators. Custom pricing with dedicated onboarding.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ENTERPRISE_FEATURES.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-center gap-2 md:min-w-[180px]">
                <span className="text-2xl font-bold">Custom</span>
                <Button
                  data-testid="button-contact-sales"
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/enterprise-inquiry")}
                >
                  Contact Sales
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer note — no skip button */}
        <div className="bg-card rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Your card is required to reserve your spot, but you will not be charged until your {TRIAL_DAYS}-day trial ends on {trialEndStr}.
            Cancel any time before then and pay nothing.
          </p>
        </div>
      </div>
    </div>
  );
}
