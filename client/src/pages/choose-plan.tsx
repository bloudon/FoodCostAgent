import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check, Loader2, Building, MapPin, ChevronRight, ArrowRight,
  Calendar, AlertTriangle, Zap, Plus, ExternalLink, BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RestaurantBackground } from "@/components/restaurant-background";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/lib/auth-context";
const logoImage = "/logo.png";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  PRICING,
  CORE_PLATFORM_CAPABILITIES,
  MULTI_LOCATION_CAPABILITIES,
  ENTERPRISE_CAPABILITIES,
  ADDITIONAL_LOCATION_PRICING,
  type BillingTerm,
} from "@shared/plan-catalog";

// ── Types ──────────────────────────────────────────────────────────────────

type Term = BillingTerm;

interface SubscriptionDetails {
  plan: string | null;
  status: string | null;
  billingInterval: string | null;
  currentPeriodEnd: string | null;
  licensedLocationCount: number;
  activeLocationCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TERM_LABELS: Record<string, string> = { monthly: "Monthly", annual: "Annual" };
const TRIAL_DAYS = 14;

function daysRemaining(periodEnd: string | null): number | null {
  if (!periodEnd) return null;
  const end = new Date(periodEnd);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function planLabel(plan: string | null): string {
  if (plan === "enterprise") return "Enterprise Operations";
  if (plan === "platform") return "FnB Cost Pro Platform";
  return "Platform";
}

function StatusBadge({ status, daysLeft }: { status: string | null; daysLeft: number | null }) {
  if (!status) return null;
  if (status === "trialing") {
    return (
      <Badge className="bg-amber-500 text-white" data-testid="badge-status-trialing">
        Trial{daysLeft !== null ? ` · ${daysLeft} day${daysLeft !== 1 ? "s" : ""} left` : ""}
      </Badge>
    );
  }
  if (status === "active") {
    return (
      <Badge className="bg-green-600 text-white" data-testid="badge-status-active">
        Active
      </Badge>
    );
  }
  if (status === "past_due") {
    return (
      <Badge variant="destructive" data-testid="badge-status-past-due">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Payment Due
      </Badge>
    );
  }
  if (status === "canceled") {
    return (
      <Badge variant="outline" data-testid="badge-status-canceled">
        Canceled
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ChoosePlan() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const { selectedCompanyId } = useCompany();
  const { user } = useAuth();
  const [selectedTerm, setSelectedTerm] = useState<Term>("monthly");
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);

  const { locationCount, returnTo } = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const val = parseInt(params.get("locations") || "0", 10);
    return {
      locationCount: isNaN(val) ? 0 : val,
      returnTo: params.get("returnTo") || null,
    };
  }, [searchString]);

  // Fetch full subscription details
  const { data: sub, isLoading: subLoading, isError: subError } = useQuery<SubscriptionDetails>({
    queryKey: ["/api/billing/subscription"],
    retry: 1,
    staleTime: 30_000,
  });

  const hasActivePlan = !!(
    sub?.plan &&
    sub.plan !== "free" &&
    sub.status &&
    sub.status !== "canceled"
  );

  // When the subscription fetch fails we do NOT default to trial checkout — we
  // show an explicit error so an existing subscriber never sees a checkout form
  // due to a transient network or backend issue.
  const showFetchError = subError && !sub;

  const isMultiLocation = (sub?.activeLocationCount ?? locationCount) > 1;
  const daysLeft = daysRemaining(sub?.currentPeriodEnd ?? null);

  // ── Checkout mutation ────────────────────────────────────────────────────

  const checkoutMutation = useMutation({
    mutationFn: async ({ term }: { term: Term }) => {
      const additionalLocations = Math.max(0, locationCount - 1);
      const res = await apiRequest("POST", "/api/billing/checkout", {
        plan: "platform",
        term,
        ...(additionalLocations > 0 ? { additionalLocations } : {}),
        ...(returnTo ? { returnTo } : {}),
      });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      setIsStartingCheckout(false);
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      setIsStartingCheckout(false);
      toast({
        title: "Something went wrong",
        description: err?.message || "Could not start checkout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleStartTrial = () => {
    setIsStartingCheckout(true);
    checkoutMutation.mutate({ term: selectedTerm });
  };

  // ── Loading / error guards ────────────────────────────────────────────────

  if (subLoading) {
    return (
      <div className="relative min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Subscription fetch failed — show a blocking error rather than defaulting
  // to the trial-signup flow, which would show checkout to existing subscribers.
  if (showFetchError) {
    return (
      <div
        className="relative min-h-screen bg-background flex items-center justify-center p-4"
        data-testid="subscription-fetch-error"
      >
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
          <h2 className="font-semibold text-lg">Could not load account details</h2>
          <p className="text-sm text-muted-foreground">
            We had trouble fetching your subscription information. Please refresh the page or try again in a moment.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  // ── Layout shell ─────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-background">
      <RestaurantBackground companyId={selectedCompanyId ?? undefined} />
      <div className="relative z-10 max-w-2xl mx-auto px-4 py-8">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src={logoImage} alt="FNB Cost Pro" className="h-14 w-auto" />
        </div>

        {hasActivePlan ? (
          <AccountOverview
            sub={sub!}
            daysLeft={daysLeft}
            isMultiLocation={isMultiLocation}
            returnTo={returnTo}
            onNavigate={navigate}
          />
        ) : (
          <TrialSignup
            selectedTerm={selectedTerm}
            onTermChange={setSelectedTerm}
            onStartTrial={handleStartTrial}
            isLoading={isStartingCheckout || checkoutMutation.isPending}
            locationCount={locationCount}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  );
}

// ── Account Overview (has plan) ────────────────────────────────────────────

function AccountOverview({
  sub,
  daysLeft,
  isMultiLocation,
  returnTo,
  onNavigate,
}: {
  sub: SubscriptionDetails;
  daysLeft: number | null;
  isMultiLocation: boolean;
  returnTo: string | null;
  onNavigate: (path: string) => void;
}) {
  const additionalPerMonth = ADDITIONAL_LOCATION_PRICING.monthlyCents / 100;
  const additionalPerMonthAnnual = ADDITIONAL_LOCATION_PRICING.annualCents / 100;
  const additionalLocations = Math.max(0, sub.activeLocationCount - sub.licensedLocationCount);
  const capabilities = isMultiLocation
    ? MULTI_LOCATION_CAPABILITIES
    : CORE_PLATFORM_CAPABILITIES;

  const periodEndStr = sub.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : null;

  return (
    <div className="space-y-4" data-testid="account-overview">

      {/* Header */}
      <div className="bg-card rounded-lg border p-6 text-center space-y-2">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Your Subscription</p>
        <h1 className="text-2xl font-bold">{planLabel(sub.plan)}</h1>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <StatusBadge status={sub.status} daysLeft={daysLeft} />
          {sub.billingInterval && (
            <Badge variant="outline" data-testid="badge-billing-interval">
              {sub.billingInterval === "annual" ? "Annual billing" : "Monthly billing"}
            </Badge>
          )}
        </div>
        {sub.status === "trialing" && daysLeft !== null && daysLeft <= 7 && (
          <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">
            Your trial ends {periodEndStr ? `on ${periodEndStr}` : "soon"} — add payment info to keep access.
          </p>
        )}
        {sub.status === "active" && periodEndStr && (
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <Calendar className="h-3 w-3" />
            Next renewal: {periodEndStr}
          </p>
        )}
        {sub.status === "past_due" && (
          <p className="text-sm text-destructive font-medium mt-1">
            A payment failed. Update your payment method to restore full access.
          </p>
        )}
      </div>

      {/* Locations */}
      <Card data-testid="card-locations">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Operating Locations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">
              {sub.activeLocationCount} active · {sub.licensedLocationCount} licensed
            </span>
            {additionalLocations > 0 && (
              <Badge variant="secondary" data-testid="badge-over-licensed">
                {additionalLocations} additional location{additionalLocations !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {sub.activeLocationCount === 1 && (
            <p className="text-sm text-muted-foreground">
              Add a second location to activate connected multi-location views, transfers, and consolidated reporting.
            </p>
          )}

          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Additional location pricing</p>
            <p className="text-sm">
              <span className="font-semibold">${additionalPerMonth}/mo</span>
              <span className="text-muted-foreground"> per location (monthly) · </span>
              <span className="font-semibold">${additionalPerMonthAnnual}/mo</span>
              <span className="text-muted-foreground"> billed annually</span>
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full"
            disabled
            data-testid="button-add-location"
            title="Location billing configuration coming soon"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add a Location
          </Button>
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card data-testid="card-capabilities">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-green-500" />
            {isMultiLocation ? "Multi-Location Capabilities" : "What's included"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Enterprise card */}
      <EnterpriseCard onNavigate={onNavigate} />

      {/* Back / Continue */}
      {returnTo ? (
        <Button
          className="w-full"
          style={{ backgroundColor: "#f2690d", borderColor: "#f2690d", color: "#fff" }}
          onClick={() => onNavigate(returnTo)}
          data-testid="button-continue-from-account"
        >
          Continue Setup
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onNavigate("/")}
          data-testid="button-back-to-dashboard"
        >
          Back to Dashboard
        </Button>
      )}
    </div>
  );
}

// ── Trial Signup (no plan yet) ─────────────────────────────────────────────

function TrialSignup({
  selectedTerm,
  onTermChange,
  onStartTrial,
  isLoading,
  locationCount,
  onNavigate,
}: {
  selectedTerm: Term;
  onTermChange: (t: Term) => void;
  onStartTrial: () => void;
  isLoading: boolean;
  locationCount: number;
  onNavigate: (path: string) => void;
}) {
  const price = PRICING.platform[selectedTerm as "monthly" | "annual"];
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
  const trialEndStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="space-y-4" data-testid="trial-signup">

      {/* Header */}
      <div className="bg-card rounded-lg border p-6 text-center space-y-3">
        <Badge className="bg-green-600 text-white" data-testid="badge-trial">
          {TRIAL_DAYS}-Day Opportunity Review
        </Badge>
        <h1 className="text-2xl font-bold">Review Your Account</h1>
        <p className="text-sm text-muted-foreground">
          Full access for {TRIAL_DAYS} days — no charge until {trialEndStr}. Cancel anytime before then.
        </p>

        {/* Term toggle */}
        <div className="flex items-center justify-center gap-2 pt-1">
          {(["monthly", "annual"] as Term[]).map((term) => (
            <button
              key={term}
              data-testid={`button-term-${term}`}
              onClick={() => onTermChange(term)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors border ${
                selectedTerm === term
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {TERM_LABELS[term]}
              {term === "annual" && (
                <span className="ml-1.5 text-xs text-green-500 font-semibold">Save ~14%</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan card */}
      <Card data-testid="card-platform-plan">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-bold text-lg">FnB Cost Pro Platform</h2>
              <p className="text-xs text-muted-foreground">Complete food-cost management for independent operators and growing groups</p>
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">${price}</span>
              <span className="text-muted-foreground text-sm">/mo</span>
              {selectedTerm === "annual" && (
                <span className="text-xs text-muted-foreground ml-1">billed ${price * 12}/year</span>
              )}
            </div>
            <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">
              1 operating location included · additional locations ${(ADDITIONAL_LOCATION_PRICING.monthlyCents / 100)}/mo each (monthly) · ${(ADDITIONAL_LOCATION_PRICING.annualCents / 100)}/mo billed annually
            </p>
          </div>

          <ul className="space-y-1.5">
            {CORE_PLATFORM_CAPABILITIES.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>

          {locationCount > 1 && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 flex items-start gap-2" data-testid="callout-multi-location">
              <MapPin className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                You indicated <strong>{locationCount} locations</strong> — your subscription will include the base plan plus {locationCount - 1} additional location seat{locationCount - 1 !== 1 ? "s" : ""}.
              </p>
            </div>
          )}

          <Button
            className="w-full text-white"
            style={{ backgroundColor: "#f2690d", borderColor: "#f2690d" }}
            onClick={onStartTrial}
            disabled={isLoading}
            data-testid="button-start-trial"
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
            ) : (
              <>Start {TRIAL_DAYS}-Day Opportunity Review <ChevronRight className="h-4 w-4 ml-1" /></>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Your card is required to reserve your spot, but you will not be charged until {trialEndStr}.
          </p>
        </CardContent>
      </Card>

      {/* Enterprise card */}
      <EnterpriseCard onNavigate={onNavigate} />
    </div>
  );
}

// ── Enterprise consultation card (shared) ──────────────────────────────────

function EnterpriseCard({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <Card data-testid="card-enterprise">
      <CardContent className="pt-5 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="font-semibold text-sm">Enterprise Operations</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Operating a club, resort, hotel, or complex multi-outlet organization?{" "}
              Schedule a Culinary Review and we'll configure a custom solution.
            </p>
            <ul className="space-y-1 pt-1">
              {ENTERPRISE_CAPABILITIES.slice(0, 4).map((cap) => (
                <li key={cap} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                  {cap}
                </li>
              ))}
            </ul>
          </div>
          <div className="sm:shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate("/enterprise-inquiry")}
              data-testid="button-enterprise-inquiry"
            >
              Schedule a Culinary Review
              <ExternalLink className="h-3 w-3 ml-1.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
