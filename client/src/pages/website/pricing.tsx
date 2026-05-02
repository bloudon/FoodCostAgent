import { useState } from "react";
import { CheckCircle, HelpCircle, X, Building, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, SectionHeading, CTAButton, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { Link } from "wouter";
import { PRICING, type BillingTerm } from "@/lib/pricing-constants";

type Term = BillingTerm;

interface FeatureItem {
  text: string;
  proOnly?: boolean;
  enterpriseOnly?: boolean;
}

export default function WebsitePricing() {
  const { lang, t } = useLanguage();
  const pricing = t.pricing;

  const [selectedTerm, setSelectedTerm] = useState<Term>("monthly");

  const starterPrice = PRICING.starter[selectedTerm];
  const proP = PRICING.pro[selectedTerm];
  const proTotalFirstStore = proP.platform + proP.perStore;

  const locParam = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("locations");
  const locCount = locParam ? parseInt(locParam, 10) : 0;
  const isMultiLoc = locCount >= 2;

  const proOnlyLabel = pricing.proOnly;
  const enterpriseLabel = pricing.enterprise;

  const tiers = [
    {
      key: "starter",
      name: "Starter",
      highlighted: !isMultiLoc,
      badge: null as string | null,
      price: `$${starterPrice}`,
      priceLabel: `/${selectedTerm === "monthly" ? (lang === "es" ? "mes" : "month") : (lang === "es" ? "año" : "mo, billed annually")}`,
      priceSub: null,
      features: pricing.starterFeatures.map((f): FeatureItem => ({ text: f })),
      cta: pricing.startFreeTrial,
      ctaHref: appLink("/signup"),
      note: pricing.fourteenDayTrial,
      isEnterprise: false,
    },
    {
      key: "pro",
      name: "Pro",
      highlighted: isMultiLoc,
      badge: isMultiLoc ? pricing.recommendedForYou : pricing.mostPopular,
      price: `$${proTotalFirstStore}`,
      priceLabel: `/${selectedTerm === "monthly" ? (lang === "es" ? "mes" : "month") : (lang === "es" ? "año" : "mo, billed annually")}`,
      priceSub: `$${proP.platform} platform + $${proP.perStore}/location`,
      features: pricing.proFeatures.map((f): FeatureItem =>
        typeof f === "string" ? { text: f } : (f as FeatureItem)
      ),
      cta: pricing.startFreeTrial,
      ctaHref: appLink("/signup"),
      note: pricing.fourteenDayTrial,
      isEnterprise: false,
    },
    {
      key: "enterprise",
      name: "Enterprise",
      highlighted: false,
      badge: null,
      price: pricing.custom,
      priceLabel: "",
      priceSub: null,
      features: pricing.enterpriseFeatures.map((f): FeatureItem =>
        typeof f === "string" ? { text: f } : (f as FeatureItem)
      ),
      cta: pricing.contactSales,
      ctaHref: lang === "es" ? "/es/contact" : "/contact",
      note: pricing.tailoredNote,
      isEnterprise: true,
    },
  ];

  const termKeys: Term[] = ["monthly", "annual"];

  return (
    <MarketingLayout>
      <MarketingHead
        title={pricing.meta.title}
        description={pricing.meta.description}
        lang={lang}
      />

      {/* ── Header ───────────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {pricing.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {pricing.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed">
            {pricing.subheadline}
          </p>
        </div>
      </section>

      {/* ── Multi-loc callout ─────────────────────────────────── */}
      {isMultiLoc && (
        <div className="bg-orange-50 border-b border-orange-200 py-4">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-orange-800 text-sm font-medium">
              Based on your location count, we recommend <strong>Pro</strong> — it includes unlimited locations, transfer orders, and cross-location variance reporting.
              Starter is still available and a great starting point if you prefer to start smaller.
            </p>
          </div>
        </div>
      )}

      {/* ── Plan Cards ───────────────────────────────────────── */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Term toggle */}
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center bg-gray-100 rounded-full p-1 gap-1" data-testid="term-toggle">
              {termKeys.map((term) => (
                <button
                  key={term}
                  onClick={() => setSelectedTerm(term)}
                  data-testid={`btn-term-${term}`}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    selectedTerm === term
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {pricing.termLabels[term]}
                  {pricing.savings[term] && (
                    <span className="ml-1.5 text-xs text-green-600 font-semibold">
                      {pricing.savings[term]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
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
                  <span
                    className={`absolute -top-4 left-1/2 -translate-x-1/2 text-white text-xs font-semibold px-4 py-1 rounded-full whitespace-nowrap ${
                      tier.key === "pro" && isMultiLoc ? "bg-orange-500" : "bg-green-600"
                    }`}
                  >
                    {tier.badge}
                  </span>
                )}

                <div className="flex items-center gap-2 mb-1">
                  {tier.isEnterprise && <Building className="h-5 w-5 text-gray-700" />}
                  <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                </div>

                <div className="mt-3 mb-1">
                  <span className="text-4xl font-extrabold text-gray-900">{tier.price}</span>
                  {tier.priceLabel && (
                    <span className="text-gray-500 ml-1 text-sm">{tier.priceLabel}</span>
                  )}
                </div>
                {tier.priceSub && (
                  <p className="text-xs text-gray-400 mb-5">{tier.priceSub}</p>
                )}
                <div className="mb-6 mt-3" />

                {tier.isEnterprise ? (
                  <Link href={tier.ctaHref} className="block mb-6">
                    <Button
                      className="w-full bg-gray-900 text-white border-0"
                      variant="default"
                      data-testid={`btn-signup-${tier.key}`}
                    >
                      {tier.cta}
                    </Button>
                  </Link>
                ) : (
                  <a href={tier.ctaHref} className="block mb-6">
                    <Button
                      className={`w-full ${
                        tier.highlighted ? "bg-green-600 text-white border-0" : ""
                      }`}
                      variant={tier.highlighted ? "default" : "outline"}
                      data-testid={`btn-signup-${tier.key}`}
                    >
                      {tier.cta}
                      <ChevronRight className="h-4 w-4 ml-1" />
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
                        {f.proOnly && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                            {proOnlyLabel}
                          </Badge>
                        )}
                        {f.enterpriseOnly && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-indigo-600 border-indigo-300 bg-indigo-50">
                            {enterpriseLabel}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-gray-400 mt-8">
            {pricing.footerNote}
          </p>
          {pricing.founderNote && (
            <p className="text-center text-xs text-orange-500 mt-2">
              {pricing.founderNote}
            </p>
          )}
        </div>
      </section>

      {/* ── Comparison Table ─────────────────────────────────── */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title={pricing.comparisonTitle} subtitle={pricing.comparisonSubtitle} />
          <ComparisonTable />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title={pricing.faqTitle} />
          <div className="space-y-4">
            {pricing.faqItems.map((item) => (
              <div
                key={item.q}
                className="bg-gray-50 rounded-lg border border-gray-200 p-6"
                data-testid="faq-item"
              >
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

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-16 bg-green-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            {lang === "es" ? "Inicia tu prueba gratuita de 14 días" : "Start Your 14-Day Free Trial"}
          </h2>
          <p className="text-green-200 mb-8 text-sm">
            {lang === "es"
              ? "Acceso completo. Sin tarjeta de crédito. Cancela cuando quieras."
              : "Full access from day one. No credit card required. Cancel anytime."}
          </p>
          <CTAButton href={appLink("/signup")} large>
            {pricing.startFreeTrial}
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}

interface TableHeaders {
  feature: string;
  starter?: string;
  pro: string;
  enterprise: string;
  free?: string;
  basic?: string;
}

interface TableRow {
  label: string;
  starter?: boolean | string;
  pro?: boolean | string;
  enterprise?: boolean | string;
  free?: boolean | string;
  basic?: boolean | string;
  proOnly?: boolean;
  enterpriseOnly?: boolean;
}

function ComparisonTable() {
  const { t } = useLanguage();
  const pricing = t.pricing;

  const headers = pricing.tableHeaders as unknown as TableHeaders;
  const rows = pricing.tableRows as unknown as TableRow[];
  const hasNewHeaders = "starter" in headers;
  const hasNewRows = rows.length > 0 && "starter" in rows[0];

  const proOnlyLabel = pricing.proOnly;
  const enterpriseLabel = pricing.enterprise;

  if (hasNewHeaders || hasNewRows) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="comparison-table">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-4 pr-4 font-semibold text-gray-900 w-2/5">{headers.feature}</th>
              <th className="text-center py-4 px-3 font-semibold text-gray-900">{headers.starter || "Starter"}</th>
              <th className="text-center py-4 px-3 font-semibold text-green-700 bg-green-50 rounded-t-lg">{headers.pro}</th>
              <th className="text-center py-4 px-3 font-semibold text-gray-900">{headers.enterprise}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-gray-100">
                <td className="py-3 pr-4 text-gray-700">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {row.label}
                    {row.proOnly && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-orange-600 border-orange-300 bg-orange-50">
                        {proOnlyLabel}
                      </Badge>
                    )}
                    {row.enterpriseOnly && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold text-indigo-600 border-indigo-300 bg-indigo-50">
                        {enterpriseLabel}
                      </Badge>
                    )}
                  </span>
                </td>
                {(["starter", "pro", "enterprise"] as const).map((col, colIdx) => {
                  const val = row[col];
                  return (
                    <td key={col} className={`text-center py-3 px-3 ${colIdx === 1 ? "bg-green-50" : ""}`}>
                      {val === true ? (
                        <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                      ) : val === false ? (
                        <X className="h-4 w-4 text-gray-300 mx-auto" />
                      ) : (
                        <span className="text-gray-600 text-xs">{val as string}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}
