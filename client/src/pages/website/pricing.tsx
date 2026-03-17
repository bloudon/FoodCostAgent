import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, HelpCircle, X, Building } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

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
  const { lang, t } = useLanguage();
  const pricing = t.pricing;

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
  const TERMS = ["monthly", "quarterly", "annual"];
  const termKeys = ["monthly", "quarterly", "annual"] as const;

  const filteredPlans = plans.filter((p) => getTerm(p.lookupKey) === selectedTerm);
  const basicPlan = filteredPlans.find((p) => getTier(p.lookupKey) === "basic");
  const proPlan = filteredPlans.find((p) => getTier(p.lookupKey) === "pro");

  const proOnlyLabel = pricing.proOnly;
  const enterpriseLabel = pricing.enterprise;

  function localizeInterval(interval: string | undefined): string {
    if (!interval) return "";
    const key = interval as keyof typeof pricing.intervalLabels;
    return `/${pricing.intervalLabels[key] ?? interval}`;
  }

  const tiers = [
    {
      key: "free",
      name: pricing.tierNames.free,
      plan: null as Plan | null,
      price: "$0",
      priceLabel: pricing.forever,
      features: pricing.freeFeatures.map((f) => ({ text: f })),
      highlighted: false,
      badge: null,
      cta: pricing.getStartedFree,
      ctaVariant: "outline" as const,
      note: pricing.noCardRequired,
      isEnterprise: false,
    },
    {
      key: "basic",
      name: pricing.tierNames.basic,
      plan: basicPlan || null,
      price: basicPlan?.unitAmount != null ? `$${(basicPlan.unitAmount / 100).toFixed(0)}` : null,
      priceLabel: basicPlan ? localizeInterval(basicPlan.interval) : "",
      features: pricing.basicFeatures.map((f) => ({ text: f })),
      highlighted: false,
      badge: null,
      cta: pricing.startFreeTrial,
      ctaVariant: "outline" as const,
      note: pricing.thirtyDayTrial,
      isEnterprise: false,
    },
    {
      key: "pro",
      name: pricing.tierNames.pro,
      plan: proPlan || null,
      price: proPlan?.unitAmount != null ? `$${(proPlan.unitAmount / 100).toFixed(0)}` : null,
      priceLabel: proPlan ? localizeInterval(proPlan.interval) : "",
      features: pricing.proFeatures.map((f) =>
        typeof f === "string" ? { text: f } : f
      ),
      highlighted: true,
      badge: pricing.mostPopular,
      cta: pricing.startFreeTrial,
      ctaVariant: "default" as const,
      note: pricing.thirtyDayTrial,
      isEnterprise: false,
    },
    {
      key: "enterprise",
      name: pricing.tierNames.enterprise,
      plan: null as Plan | null,
      price: pricing.custom,
      priceLabel: "",
      features: pricing.enterpriseFeatures.map((f) =>
        typeof f === "string" ? { text: f } : f
      ),
      highlighted: false,
      badge: null,
      cta: pricing.contactSales,
      ctaVariant: "outline" as const,
      note: pricing.tailoredNote,
      isEnterprise: true,
    },
  ];

  return (
    <MarketingLayout>
      <MarketingHead
        title={pricing.meta.title}
        description={pricing.meta.description}
        lang={lang}
      />
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {pricing.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {pricing.headline}
          </h1>
          <p className="text-lg text-gray-300">
            {pricing.subheadline}
          </p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center bg-gray-100 rounded-full p-1 gap-1" data-testid="term-toggle">
              {termKeys.map((term) => (
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
                  {pricing.termLabels[term]}
                  {pricing.savings[term as keyof typeof pricing.savings] && (
                    <span className="ml-1.5 text-xs text-green-600 font-semibold">
                      {pricing.savings[term as keyof typeof pricing.savings]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[0, 1, 2, 3].map((i) => (
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
              {tiers.map((tier) => (
                <div
                  key={tier.key}
                  className={`rounded-2xl border-2 p-8 relative ${
                    tier.highlighted
                      ? "border-green-500 bg-green-50 shadow-lg shadow-green-100"
                      : tier.isEnterprise
                      ? "border-gray-800 bg-gray-50"
                      : "border-gray-200 bg-white"
                  }`}
                  data-testid={`pricing-card-${tier.key}`}
                >
                  {tier.badge && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-semibold px-4 py-1 rounded-full whitespace-nowrap">
                      {tier.badge}
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-1">
                    {tier.isEnterprise && <Building className="h-5 w-5 text-gray-700" />}
                    <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                  </div>

                  <div className="mb-6 mt-3">
                    {tier.key === "free" ? (
                      <div>
                        <span className="text-4xl font-extrabold text-gray-900">$0</span>
                        <span className="text-gray-500 ml-1">{pricing.forever}</span>
                      </div>
                    ) : tier.isEnterprise ? (
                      <div>
                        <span className="text-4xl font-extrabold text-gray-900">{pricing.custom}</span>
                      </div>
                    ) : tier.price ? (
                      <div>
                        <span className="text-4xl font-extrabold text-gray-900">{tier.price}</span>
                        <span className="text-gray-500 ml-1">{tier.priceLabel}</span>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm">{pricing.pricingUnavailable}</p>
                    )}
                  </div>

                  {tier.isEnterprise ? (
                    <a href="/enterprise-inquiry" className="block mb-6">
                      <Button
                        className="w-full bg-gray-900 text-white border-0 hover:bg-gray-800"
                        variant="default"
                        data-testid={`btn-signup-${tier.key}`}
                      >
                        {tier.cta}
                      </Button>
                    </a>
                  ) : (
                    <a href={appLink("/signup")} className="block mb-6">
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
                  )}

                  <p className="text-xs text-gray-400 text-center mb-6">{tier.note}</p>

                  <ul className="space-y-3">
                    {tier.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2.5">
                        <CheckCircle
                          className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                            tier.highlighted ? "text-green-600" : tier.isEnterprise ? "text-gray-700" : "text-gray-400"
                          }`}
                        />
                        <span className="text-sm text-gray-600 flex items-center gap-1.5 flex-wrap">
                          {f.text}
                          {"proOnly" in f && f.proOnly && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                              {proOnlyLabel}
                            </Badge>
                          )}
                          {"enterpriseOnly" in f && f.enterpriseOnly && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-indigo-600 border-indigo-300 bg-indigo-50">
                              {enterpriseLabel}
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {tier.key === "free" && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 leading-relaxed">
                        {pricing.adsNote}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-sm text-gray-400 mt-8">
            {pricing.footerNote}
          </p>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title={pricing.comparisonTitle} subtitle={pricing.comparisonSubtitle} />
          <ComparisonTable />
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title={pricing.faqTitle} />
          <div className="space-y-6">
            {pricing.faqItems.map((item) => (
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

function ComparisonTable() {
  const { t } = useLanguage();
  const pricing = t.pricing;
  const headers = pricing.tableHeaders;
  const proOnlyLabel = pricing.proOnly;
  const enterpriseLabel = pricing.enterprise;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="comparison-table">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-4 pr-4 font-semibold text-gray-900 w-1/4">{headers.feature}</th>
            <th className="text-center py-4 px-3 font-semibold text-gray-900">{headers.free}</th>
            <th className="text-center py-4 px-3 font-semibold text-gray-900">{headers.basic}</th>
            <th className="text-center py-4 px-3 font-semibold text-green-700 bg-green-50 rounded-t-lg">{headers.pro}</th>
            <th className="text-center py-4 px-3 font-semibold text-gray-900">{headers.enterprise}</th>
          </tr>
        </thead>
        <tbody>
          {pricing.tableRows.map((row) => (
            <tr key={row.label} className="border-b border-gray-100">
              <td className="py-3 pr-4 text-gray-700 flex items-center gap-1.5 flex-wrap">
                {row.label}
                {"proOnly" in row && row.proOnly && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                    {proOnlyLabel}+
                  </Badge>
                )}
                {"enterpriseOnly" in row && row.enterpriseOnly && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-indigo-600 border-indigo-300 bg-indigo-50">
                    {enterpriseLabel}
                  </Badge>
                )}
              </td>
              {[row.free, row.basic, row.pro, row.enterprise].map((val, i) => (
                <td
                  key={i}
                  className={`text-center py-3 px-3 ${i === 2 ? "bg-green-50" : ""}`}
                >
                  {val === true ? (
                    <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                  ) : val === false ? (
                    <X className="h-4 w-4 text-gray-300 mx-auto" />
                  ) : (
                    <span className="text-gray-600 text-xs">{val as string}</span>
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
