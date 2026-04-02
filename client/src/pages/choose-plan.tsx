import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Zap, Building2, Loader2, Star, Building, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RestaurantBackground } from "@/components/restaurant-background";
import { useCompany } from "@/hooks/use-company";
const logoImage = "/logo.png";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Term = "monthly" | "quarterly" | "annual";
type Tier = "basic" | "pro";

interface Plan {
  id: string;
  lookupKey: string | null;
  unitAmount: number | null;
  currency: string;
  interval: string | undefined;
  intervalCount: number | undefined;
  productName: string;
  productDescription: string;
}

const TERM_LABELS: Record<Term, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

const TERM_SAVINGS: Record<Term, string | null> = {
  monthly: null,
  quarterly: "Save ~10%",
  annual: "Best Value",
};

const TIER_FEATURES: Record<Tier, string[]> = {
  basic: [
    "Up to 2 store locations",
    "Recipe costing with yield tracking",
    "Nested sub-recipe support",
    "Vendor order guide imports",
    "TFC variance reporting",
    "POS sales data import",
    "Smart dashboard",
    "Order reminders",
    "5 team member seats",
    "Online chat support",
  ],
  pro: [
    "Unlimited store locations",
    "Everything in Basic",
    "Cross-shop vendor price comparison",
    "QuickBooks export",
    "Power Inventory counting",
    "Transfer orders between locations",
    "Custom Security Levels",
    "Order reminders",
    "Unlimited team member seats",
    "Priority support",
  ],
};

const ENTERPRISE_FEATURES: string[] = [
  "Multi-brand inventory management",
  "Everything in Pro",
  "Multi-POS integration",
  "Franchise analytics",
  "Unlimited locations & seats",
  "SLA + dedicated onboarding",
];

function formatPrice(unitAmount: number | null, currency: string, intervalCount?: number): string {
  if (unitAmount === null) return "—";
  const dollars = unitAmount / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(dollars);
  if (intervalCount && intervalCount > 1) return formatted;
  return formatted;
}

function perMonthAmount(unitAmount: number | null, term: Term): string {
  if (unitAmount === null) return "—";
  const dollars = unitAmount / 100;
  let perMonth = dollars;
  if (term === "quarterly") perMonth = dollars / 3;
  if (term === "annual") perMonth = dollars / 12;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "usd",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(perMonth);
}

function getPriceForTierTerm(plans: Plan[], tier: Tier, term: Term): Plan | undefined {
  const suffix = term === "monthly" ? "monthly" : term === "quarterly" ? "quarterly" : "annual";
  const key = `fnb_${tier}_${suffix}`;
  return plans.find((p) => p.lookupKey === key);
}

const TRIAL_DAYS = 30;

export default function ChoosePlan() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const { selectedCompanyId } = useCompany();
  const [selectedTerm, setSelectedTerm] = useState<Term>("monthly");
  const [loadingTier, setLoadingTier] = useState<Tier | null>(null);

  const locationCount = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const val = parseInt(params.get("locations") || "0", 10);
    return isNaN(val) ? 0 : val;
  }, [searchString]);

  const isMultiLocation = locationCount > 1;

  const { data, isLoading: plansLoading } = useQuery<{ plans: Plan[] }>({
    queryKey: ["/api/billing/plans"],
  });

  const plans = data?.plans ?? [];

  const checkoutMutation = useMutation({
    mutationFn: async ({ tier, term }: { tier: Tier; term: Term }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { tier, term });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data, variables) => {
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

  const handleSelectPlan = (tier: Tier) => {
    setLoadingTier(tier);
    checkoutMutation.mutate({ tier, term: selectedTerm });
  };

  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
  const trialEndStr = trialEndDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const tiers: Tier[] = ["basic", "pro"];

  return (
    <div className="relative min-h-screen bg-background">
      <RestaurantBackground companyId={selectedCompanyId ?? undefined} />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-8">
        <div className="flex justify-center mb-8">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
        </div>

        <div className="bg-card rounded-lg border overflow-hidden mb-6">
          <div className="p-6 md:p-8 text-center">
            <Badge className="mb-3 bg-green-600 text-white no-default-active-elevate">
              {TRIAL_DAYS}-Day Free Trial
            </Badge>
            <h1 className="text-2xl font-bold mb-2">Choose Your Plan</h1>
            <p className="text-muted-foreground text-sm">
              Start free — no charge until {trialEndStr}. Cancel anytime before then.
            </p>

            <div className="flex items-center justify-center gap-2 mt-5">
              {(["monthly", "quarterly", "annual"] as Term[]).map((term) => (
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

        {isMultiLocation && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4 flex items-start gap-3" data-testid="callout-multi-location">
            <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              You have <strong>{locationCount} locations</strong> — the Pro plan includes unlimited locations and cross-location reporting.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {plansLoading ? (
            <div className="col-span-2 flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            tiers.map((tier) => {
              const plan = getPriceForTierTerm(plans, tier, selectedTerm);
              const isPro = tier === "pro";
              const isRecommended = isPro && isMultiLocation;

              return (
                <div
                  key={tier}
                  data-testid={`card-plan-${tier}`}
                  className={`bg-card rounded-lg border overflow-hidden flex flex-col ${
                    isPro ? "border-primary ring-1 ring-primary" : ""
                  }`}
                >
                  {(isPro || isRecommended) && (
                    <div className="bg-primary text-primary-foreground text-center text-xs font-semibold py-1.5 flex items-center justify-center gap-1">
                      <Star className="w-3 h-3" />
                      {isRecommended ? "Recommended for You" : "Most Popular"}
                    </div>
                  )}

                  <div className="p-6 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {isPro ? (
                        <Zap className="w-5 h-5 text-primary" />
                      ) : (
                        <Building2 className="w-5 h-5 text-muted-foreground" />
                      )}
                      <h2 className="text-lg font-bold capitalize">{tier}</h2>
                    </div>

                    <div className="mb-4">
                      {plan ? (
                        <>
                          <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold">
                              {perMonthAmount(plan.unitAmount, selectedTerm)}
                            </span>
                            <span className="text-muted-foreground text-sm">/mo</span>
                          </div>
                          {selectedTerm !== "monthly" && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Billed {formatPrice(plan.unitAmount, plan.currency)} {selectedTerm === "quarterly" ? "every 3 months" : "annually"}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Price unavailable</p>
                      )}
                    </div>

                    <ul className="space-y-2 mb-6 flex-1">
                      {TIER_FEATURES[tier].map((feat) => (
                        <li key={feat} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      data-testid={`button-select-${tier}`}
                      onClick={() => handleSelectPlan(tier)}
                      disabled={!plan || loadingTier !== null}
                      variant={isPro ? "default" : "outline"}
                      className={isPro ? "bg-[#f2690d] hover:bg-[#f2690d] border-[#f2690d]" : ""}
                    >
                      {loadingTier === tier ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        `Start ${TRIAL_DAYS}-Day Free Trial`
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

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

        <div className="bg-card rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-3">
            Your card is required to reserve your spot, but you will not be charged until your {TRIAL_DAYS}-day trial ends on {trialEndStr}.
            Cancel any time before then and pay nothing.
          </p>
          <button
            data-testid="button-skip-plan"
            onClick={() => navigate("/?welcome=true")}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Skip for now — I'll choose a plan later
          </button>
        </div>
      </div>
    </div>
  );
}
