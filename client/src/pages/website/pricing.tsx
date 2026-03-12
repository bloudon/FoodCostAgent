import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, SectionHeading, appLink } from "@/components/website/marketing-layout";

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

const TERM_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

const TERM_KEYS: Record<string, string> = {
  monthly: "month",
  quarterly: "month",
  annual: "year",
};

const PLAN_FEATURES: Record<string, string[]> = {
  basic: [
    "Up to 2 store locations",
    "Unlimited inventory items",
    "Recipe costing with yield tracking",
    "Vendor order guide imports (Sysco, GFS, US Foods)",
    "Purchase orders and receiving",
    "Inventory count sessions",
    "5 team member seats",
    "Email support",
  ],
  pro: [
    "Unlimited store locations",
    "Unlimited inventory items",
    "Advanced recipe costing with nested sub-recipes",
    "Vendor order guide imports (all vendors)",
    "Purchase orders and receiving",
    "Inventory count sessions",
    "Theoretical Food Cost (TFC) variance reporting",
    "POS sales data import",
    "Transfer orders between locations",
    "Waste tracking with user accountability",
    "Unlimited team member seats",
    "Priority support",
  ],
};

function formatAmount(cents: number | null, interval: string | undefined, intervalCount: number | undefined): string {
  if (cents === null) return "—";
  const dollars = cents / 100;
  if (intervalCount && intervalCount > 1) {
    return `$${dollars.toFixed(0)} / ${intervalCount} ${interval}s`;
  }
  return `$${dollars.toFixed(0)} / ${interval}`;
}

function getTier(lookupKey: string | null): "basic" | "pro" | null {
  if (!lookupKey) return null;
  if (lookupKey.includes("basic")) return "basic";
  if (lookupKey.includes("pro")) return "pro";
  return null;
}

function getTerm(lookupKey: string | null): string | null {
  if (!lookupKey) return null;
  if (lookupKey.includes("monthly")) return "monthly";
  if (lookupKey.includes("quarterly")) return "quarterly";
  if (lookupKey.includes("annual")) return "annual";
  return null;
}

const TERMS = ["monthly", "quarterly", "annual"];
const SAVINGS: Record<string, string> = {
  quarterly: "Save ~8%",
  annual: "Save ~17%",
};

export default function WebsitePricing() {
  const [selectedTerm, setSelectedTerm] = useState("monthly");

  const { data, isLoading } = useQuery<{ plans: Plan[] }>({
    queryKey: ["/api/billing/plans"],
    queryFn: async () => {
      const res = await fetch("/api/billing/plans");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const plans = data?.plans ?? [];

  const filteredPlans = plans.filter((p) => getTerm(p.lookupKey) === selectedTerm);
  const basicPlan = filteredPlans.find((p) => getTier(p.lookupKey) === "basic");
  const proPlan = filteredPlans.find((p) => getTier(p.lookupKey) === "pro");

  const tiers = [
    { key: "basic", plan: basicPlan, highlighted: false },
    { key: "pro", plan: proPlan, highlighted: true },
  ];

  return (
    <MarketingLayout>
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            Transparent Pricing
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Simple Plans for Every Operation
          </h1>
          <p className="text-lg text-gray-300">
            Start with a 14-day free trial. No credit card required.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center bg-gray-100 rounded-full p-1 gap-1" data-testid="term-toggle">
              {TERMS.map((term) => (
                <button
                  key={term}
                  onClick={() => setSelectedTerm(term)}
                  data-testid={`btn-term-${term}`}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    selectedTerm === term
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {TERM_LABELS[term]}
                  {SAVINGS[term] && (
                    <span className="ml-1.5 text-xs text-green-600 font-semibold">{SAVINGS[term]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-2xl border border-gray-200 p-8 animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
                  <div className="h-10 bg-gray-200 rounded w-1/2 mb-6" />
                  <div className="space-y-3">
                    {[...Array(6)].map((_, j) => <div key={j} className="h-4 bg-gray-100 rounded" />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              {tiers.map(({ key, plan, highlighted }) => (
                <div
                  key={key}
                  className={`rounded-2xl border-2 p-8 relative ${
                    highlighted
                      ? "border-green-500 bg-green-50 shadow-lg shadow-green-100"
                      : "border-gray-200 bg-white"
                  }`}
                  data-testid={`pricing-card-${key}`}
                >
                  {highlighted && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-semibold px-4 py-1 rounded-full">
                      Most Popular
                    </span>
                  )}
                  <h3 className="text-xl font-bold text-gray-900 mb-1 capitalize">
                    {plan?.productName || (key === "basic" ? "Basic" : "Pro")}
                  </h3>
                  {plan?.productDescription && (
                    <p className="text-sm text-gray-500 mb-4">{plan.productDescription}</p>
                  )}
                  <div className="mb-6">
                    {plan ? (
                      <p className="text-4xl font-extrabold text-gray-900">
                        {formatAmount(plan.unitAmount, plan.interval, plan.intervalCount)}
                      </p>
                    ) : (
                      <p className="text-gray-400 text-sm">Pricing not available</p>
                    )}
                  </div>
                  <a href={appLink("/signup")} className="block mb-8">
                    <Button
                      className={`w-full ${
                        highlighted ? "bg-green-600 text-white border-0 hover:bg-green-700" : ""
                      }`}
                      variant={highlighted ? "default" : "outline"}
                      data-testid={`btn-signup-${key}`}
                    >
                      Start Free Trial
                    </Button>
                  </a>
                  <ul className="space-y-3">
                    {(PLAN_FEATURES[key] || []).map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <CheckCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${highlighted ? "text-green-600" : "text-gray-400"}`} />
                        <span className="text-sm text-gray-600">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-sm text-gray-400 mt-8">
            All plans include a 14-day free trial. No credit card required. Cancel anytime.
          </p>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title="Frequently Asked Questions" />
          <div className="space-y-6">
            {[
              {
                q: "Do I need a credit card to start?",
                a: "No. Your 14-day free trial starts immediately with no payment information required. You only need to add a card if you decide to continue after the trial.",
              },
              {
                q: "Can I switch plans later?",
                a: "Yes. You can upgrade or downgrade your plan at any time from within the app. Changes take effect immediately.",
              },
              {
                q: "What happens when my trial ends?",
                a: "At the end of your trial, you'll be prompted to choose a plan. Your data is preserved regardless of when you decide to subscribe.",
              },
              {
                q: "Is there a setup fee?",
                a: "No setup fees, ever. The price you see is the price you pay.",
              },
              {
                q: "Can I add more locations later?",
                a: "Yes. The Pro plan supports unlimited locations. You can add stores at any time as your operation grows.",
              },
            ].map((item) => (
              <div key={item.q} className="bg-white rounded-lg border border-gray-200 p-6" data-testid="faq-item">
                <div className="flex items-start gap-3 mb-2">
                  <HelpCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <h4 className="font-semibold text-gray-900 text-sm">{item.q}</h4>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed pl-7">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
