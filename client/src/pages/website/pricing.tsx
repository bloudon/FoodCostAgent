import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, HelpCircle, X, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const TERMS = ["monthly", "quarterly", "annual"];
const SAVINGS: Record<string, string> = {
  quarterly: "Save ~8%",
  annual: "Save ~17%",
};

interface TierFeature {
  text: string;
  proOnly?: boolean;
}

const FREE_FEATURES: TierFeature[] = [
  { text: "1 store location" },
  { text: "Unlimited inventory items" },
  { text: "Vendor order guide imports" },
  { text: "Purchase orders and receiving" },
  { text: "Inventory count sessions" },
  { text: "2 team member seats" },
  { text: "Community support" },
];

const BASIC_FEATURES: TierFeature[] = [
  { text: "Up to 2 store locations" },
  { text: "Unlimited inventory items" },
  { text: "Recipe costing with yield tracking" },
  { text: "Nested sub-recipe support" },
  { text: "Vendor order guide imports (Sysco, GFS, US Foods)" },
  { text: "Purchase orders and receiving" },
  { text: "Inventory count sessions" },
  { text: "5 team member seats" },
  { text: "Email support" },
];

const PRO_FEATURES: TierFeature[] = [
  { text: "Unlimited store locations" },
  { text: "Unlimited inventory items" },
  { text: "Advanced recipe costing with nested sub-recipes" },
  { text: "Vendor order guide imports (all vendors)" },
  { text: "Cross-shop vendor price comparison", proOnly: true },
  { text: "Purchase orders and receiving" },
  { text: "Power Inventory counting", proOnly: true },
  { text: "Theoretical Food Cost (TFC) variance reporting", proOnly: true },
  { text: "POS sales data import", proOnly: true },
  { text: "Transfer orders between locations", proOnly: true },
  { text: "Waste tracking with user accountability" },
  { text: "Unlimited team member seats" },
  { text: "Priority support" },
];

function formatAmount(cents: number | null, interval: string | undefined, intervalCount: number | undefined): string {
  if (cents === null) return "\u2014";
  const dollars = cents / 100;
  if (intervalCount && intervalCount > 1) {
    return `$${dollars.toFixed(0)}/${intervalCount} ${interval}s`;
  }
  return `$${dollars.toFixed(0)}/${interval}`;
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
    {
      key: "free",
      name: "Free",
      plan: null as Plan | null,
      price: "$0",
      priceLabel: "forever",
      features: FREE_FEATURES,
      highlighted: false,
      badge: null,
      cta: "Get Started Free",
      ctaVariant: "outline" as const,
      note: "No credit card required",
    },
    {
      key: "basic",
      name: "Basic",
      plan: basicPlan || null,
      price: basicPlan ? `$${(basicPlan.unitAmount! / 100).toFixed(0)}` : null,
      priceLabel: basicPlan ? `/${basicPlan.interval}` : "",
      features: BASIC_FEATURES,
      highlighted: false,
      badge: null,
      cta: "Start Free Trial",
      ctaVariant: "outline" as const,
      note: "14-day free trial",
    },
    {
      key: "pro",
      name: "Pro",
      plan: proPlan || null,
      price: proPlan ? `$${(proPlan.unitAmount! / 100).toFixed(0)}` : null,
      priceLabel: proPlan ? `/${proPlan.interval}` : "",
      features: PRO_FEATURES,
      highlighted: true,
      badge: "Most Popular",
      cta: "Start Free Trial",
      ctaVariant: "default" as const,
      note: "14-day free trial",
    },
  ];

  return (
    <MarketingLayout>
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            Transparent Pricing
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            A Plan for Every F&amp;B Operation
          </h1>
          <p className="text-lg text-gray-300">
            Start free with inventory and ordering essentials. Upgrade when you need recipe costing, multi-location support, or advanced variance reporting.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              {tiers.map((tier) => (
                <div
                  key={tier.key}
                  className={`rounded-2xl border-2 p-8 relative ${
                    tier.highlighted
                      ? "border-green-500 bg-green-50 shadow-lg shadow-green-100"
                      : "border-gray-200 bg-white"
                  }`}
                  data-testid={`pricing-card-${tier.key}`}
                >
                  {tier.badge && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-semibold px-4 py-1 rounded-full whitespace-nowrap">
                      {tier.badge}
                    </span>
                  )}

                  <h3 className="text-xl font-bold text-gray-900 mb-1">{tier.name}</h3>

                  <div className="mb-6 mt-3">
                    {tier.key === "free" ? (
                      <div>
                        <span className="text-4xl font-extrabold text-gray-900">$0</span>
                        <span className="text-gray-500 ml-1">/forever</span>
                      </div>
                    ) : tier.price ? (
                      <div>
                        <span className="text-4xl font-extrabold text-gray-900">{tier.price}</span>
                        <span className="text-gray-500 ml-1">{tier.priceLabel}</span>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm">Pricing not available</p>
                    )}
                  </div>

                  <a href={tier.key === "free" ? appLink("/signup") : appLink("/signup")} className="block mb-6">
                    <Button
                      className={`w-full ${
                        tier.highlighted ? "bg-green-600 text-white border-0 hover:bg-green-700" : ""
                      }`}
                      variant={tier.ctaVariant}
                      data-testid={`btn-signup-${tier.key}`}
                    >
                      {tier.cta}
                    </Button>
                  </a>

                  <p className="text-xs text-gray-400 text-center mb-6">{tier.note}</p>

                  <ul className="space-y-3">
                    {tier.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2.5">
                        <CheckCircle
                          className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                            tier.highlighted ? "text-green-600" : tier.key === "free" ? "text-gray-400" : "text-gray-400"
                          }`}
                        />
                        <span className="text-sm text-gray-600 flex items-center gap-1.5 flex-wrap">
                          {f.text}
                          {f.proOnly && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                              Pro
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {tier.key === "free" && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Includes ads. Upgrade anytime to remove ads and unlock recipe costing.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-sm text-gray-400 mt-8">
            Paid plans include a 14-day free trial. Cancel anytime.
          </p>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title="Plan Comparison" subtitle="See exactly what's included at every level" />
          <ComparisonTable />
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title="Frequently Asked Questions" />
          <div className="space-y-6">
            {[
              {
                q: "Is the Free plan really free?",
                a: "Yes. The Free plan includes inventory management, ordering, and receiving at no cost, forever. It's supported by ads within the app. No credit card required to get started.",
              },
              {
                q: "What's included in the free trial for paid plans?",
                a: "Both Basic and Pro come with a 14-day free trial with full access to all plan features. You won't be charged until the trial period ends.",
              },
              {
                q: "When should I upgrade from Free to Basic?",
                a: "When you need recipe costing. If you want to know the exact food cost of every dish, track ingredient costs, and calculate portion prices \u2014 that's when Basic pays for itself.",
              },
              {
                q: "When should I upgrade from Basic to Pro?",
                a: "When you're running multiple locations, need Theoretical Food Cost variance reporting, want to import POS sales data, or need transfer orders between stores. Pro is built for multi-unit operators who need full cost control.",
              },
              {
                q: "Can I switch plans later?",
                a: "Yes. You can upgrade or downgrade your plan at any time from within the app. Changes take effect immediately.",
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
              <div key={item.q} className="bg-gray-50 rounded-lg border border-gray-200 p-6" data-testid="faq-item">
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

const COMPARISON_ROWS: { label: string; free: boolean | string; basic: boolean | string; pro: boolean | string; proOnly?: boolean }[] = [
  { label: "Inventory management", free: true, basic: true, pro: true },
  { label: "Vendor order guide imports", free: true, basic: true, pro: true },
  { label: "Purchase orders & receiving", free: true, basic: true, pro: true },
  { label: "Inventory count sessions", free: true, basic: true, pro: true },
  { label: "Store locations", free: "1", basic: "Up to 2", pro: "Unlimited" },
  { label: "Team member seats", free: "2", basic: "5", pro: "Unlimited" },
  { label: "Recipe costing", free: false, basic: true, pro: true },
  { label: "Nested sub-recipes", free: false, basic: true, pro: true },
  { label: "Cross-shop vendor pricing", free: false, basic: false, pro: true, proOnly: true },
  { label: "Power Inventory counting", free: false, basic: false, pro: true, proOnly: true },
  { label: "TFC variance reporting", free: false, basic: false, pro: true, proOnly: true },
  { label: "POS sales data import", free: false, basic: false, pro: true, proOnly: true },
  { label: "Transfer orders", free: false, basic: false, pro: true, proOnly: true },
  { label: "Support", free: "Community", basic: "Email", pro: "Priority" },
  { label: "Ads", free: "Yes", basic: "No", pro: "No" },
];

function ComparisonTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="comparison-table">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-4 pr-4 font-semibold text-gray-900 w-1/3">Feature</th>
            <th className="text-center py-4 px-3 font-semibold text-gray-900">Free</th>
            <th className="text-center py-4 px-3 font-semibold text-gray-900">Basic</th>
            <th className="text-center py-4 px-3 font-semibold text-green-700 bg-green-50 rounded-t-lg">Pro</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-gray-100">
              <td className="py-3 pr-4 text-gray-700 flex items-center gap-1.5 flex-wrap">
                {row.label}
                {row.proOnly && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                    Pro
                  </Badge>
                )}
              </td>
              {[row.free, row.basic, row.pro].map((val, i) => (
                <td
                  key={i}
                  className={`text-center py-3 px-3 ${i === 2 ? "bg-green-50" : ""}`}
                >
                  {val === true ? (
                    <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                  ) : val === false ? (
                    <X className="h-4 w-4 text-gray-300 mx-auto" />
                  ) : (
                    <span className="text-gray-600 text-xs">{val}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
