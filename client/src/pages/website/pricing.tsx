/**
 * Pricing page — 4-component Option A architecture
 *
 * Page flow (per marketing direction):
 *  1. Hero — premium promise
 *  2. Benefit strip — Capture → Cost → Purchase → Control
 *  3. Billing toggle
 *  4. Main Platform pricing card (outcome groups + expandable detail)
 *  5. Additional Locations / Guided Implementation / Enterprise
 *  6. FAQs
 *  7. Final CTA — "Your kitchen already has the data"
 *
 * Language: uses t.pricing from marketing-translations.ts
 */

import { useState } from "react";
import { usePageEvent } from "@/lib/analytics";
import { CheckCircle2, ChevronRight, HelpCircle, Building2, MapPin, Cog, LayoutGrid, ChevronDown, Camera, DollarSign, ShoppingCart, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, CTAButton } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { Link } from "wouter";
import { MARKETING_PRICING } from "@/lib/pricing-constants";

type Term = "monthly" | "annual";

const BENEFIT_ICONS = [Camera, DollarSign, ShoppingCart, Smartphone];

export default function WebsitePricing() {
  const { lang, t } = useLanguage();
  const pricing = t.pricing;
  const [term, setTerm] = useState<Term>("monthly");
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  usePageEvent("pricing_page_viewed", { language: lang });

  const platformPrice =
    term === "monthly"
      ? `${pricing.platform.monthlyPrice}${pricing.platform.perMonth}`
      : `${pricing.platform.annualPrice}${pricing.platform.perMonthAnnual}`;

  const locPrice =
    term === "monthly"
      ? pricing.addOns.locations.monthlyPrice
      : pricing.addOns.locations.annualPrice;

  const contactHref = lang === "es" ? "/es/contact" : "/contact";

  return (
    <MarketingLayout>
      <MarketingHead
        title={pricing.meta.title}
        description={pricing.meta.description}
        lang={lang}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-5">
            {pricing.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
            {pricing.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed max-w-2xl mx-auto mb-4">
            {pricing.subheadline}
          </p>
          <p className="text-sm text-gray-400">
            {pricing.reassuranceLine}
          </p>
        </div>
      </section>

      {/* ── Benefit strip ────────────────────────────────────────────────────── */}
      <section className="bg-gray-900 border-t border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricing.benefitStrip.map((item: { title: string; body: string }, i: number) => {
              const Icon = BENEFIT_ICONS[i] ?? Camera;
              return (
                <div key={item.title} className="flex gap-4">
                  <div className="shrink-0 mt-0.5">
                    <div className="h-8 w-8 rounded-lg bg-green-900/60 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-green-400" />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white leading-snug mb-1">{item.title}</p>
                    <p className="text-xs text-gray-400 leading-relaxed">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Billing toggle ───────────────────────────────────────────────────── */}
      <div className="bg-gray-100 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-center">
          <div className="inline-flex items-center bg-white rounded-full border border-gray-200 shadow-sm p-1 gap-1">
            {(["monthly", "annual"] as Term[]).map((t) => (
              <button
                key={t}
                onClick={() => setTerm(t)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  term === t
                    ? "bg-gray-900 text-white shadow"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "monthly" ? pricing.monthly : pricing.annual}
                {t === "annual" && (
                  <span className="ml-1.5 text-xs text-green-600 font-semibold">
                    {pricing.annualSavings}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Platform card ────────────────────────────────────────────────────── */}
      <section className="py-14 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border-2 border-green-500 bg-gradient-to-br from-green-50 to-white shadow-xl shadow-green-100/50 p-8 sm:p-10">
            <div className="flex flex-col lg:flex-row lg:gap-12">

              {/* Left: price + CTA */}
              <div className="lg:w-72 shrink-0 mb-8 lg:mb-0">
                <div className="flex items-center gap-2 mb-1">
                  <LayoutGrid className="h-5 w-5 text-green-600" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-green-700">
                    {pricing.platform.firstLocation}
                  </span>
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900 mt-2 mb-1">
                  {pricing.platform.label}
                </h2>
                <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                  {pricing.platform.tagline}
                </p>

                <div className="mb-1">
                  <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                    {pricing.platform.from}
                  </span>
                </div>
                <div className="mb-6">
                  <span className="text-5xl font-extrabold text-gray-900">
                    {term === "monthly" ? pricing.platform.monthlyPrice : pricing.platform.annualPrice}
                  </span>
                  <span className="text-gray-500 text-sm ml-2">
                    {term === "monthly" ? pricing.platform.perMonth : pricing.platform.perMonthAnnual}
                  </span>
                </div>

                <Link href={contactHref}>
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white border-0 text-base py-3 h-auto">
                    {pricing.platform.cta}
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
                <p className="text-xs text-gray-400 mt-3 leading-relaxed text-center">
                  {pricing.platform.ctaNote}
                </p>
              </div>

              {/* Right: outcome groups + expandable detail */}
              <div className="flex-1">
                <div className="space-y-4">
                  {pricing.platform.outcomeGroups.map((group: { title: string; body: string }) => (
                    <div key={group.title} className="flex gap-3">
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 leading-snug">{group.title}</p>
                        <p className="text-sm text-gray-500 leading-snug mt-0.5">{group.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Expandable full feature list */}
                <div className="mt-5 border-t border-gray-200 pt-4">
                  <button
                    onClick={() => setShowAllFeatures(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-800 transition-colors"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${showAllFeatures ? "rotate-180" : ""}`} />
                    {pricing.platform.viewAll}
                  </button>

                  {showAllFeatures && (
                    <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                      {pricing.platform.features.map((f: string) => (
                        <li key={f} className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                          <span className="text-xs text-gray-600 leading-snug">{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Add-on cards ─────────────────────────────────────────────────────── */}
      <section className="pb-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Additional Locations */}
            <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-6">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="h-5 w-5 text-gray-600" />
                <h3 className="font-bold text-gray-900 text-base">
                  {pricing.addOns.locations.label}
                </h3>
              </div>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                {pricing.addOns.locations.tagline}
              </p>
              <div className="mb-4">
                <span className="text-xl font-extrabold text-gray-900">{locPrice}</span>
                <span className="text-xs text-gray-400 ml-1">
                  {term === "annual" ? `(${pricing.addOns.locations.monthlyPrice} monthly)` : ""}
                </span>
              </div>
              <ul className="space-y-2 mb-5">
                {pricing.addOns.locations.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-600">{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={contactHref}>
                <Button variant="outline" size="sm" className="w-full">
                  {pricing.addOns.locations.cta}
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>

            {/* Guided Implementation */}
            <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Cog className="h-5 w-5 text-gray-600" />
                <h3 className="font-bold text-gray-900 text-base">
                  {pricing.addOns.implementation.label}
                </h3>
              </div>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                {pricing.addOns.implementation.tagline}
              </p>
              <div className="mb-4">
                <span className="text-base font-semibold text-gray-700">
                  {pricing.addOns.implementation.price}
                </span>
              </div>
              <ul className="space-y-2 mb-5">
                {pricing.addOns.implementation.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-600">{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={contactHref}>
                <Button variant="outline" size="sm" className="w-full">
                  {pricing.addOns.implementation.cta}
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>

            {/* Enterprise Operations */}
            <div className="rounded-xl border-2 border-gray-800 bg-gray-900 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-5 w-5 text-gray-300" />
                <h3 className="font-bold text-white text-base">
                  {pricing.addOns.enterprise.label}
                </h3>
              </div>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                {pricing.addOns.enterprise.tagline}
              </p>
              <div className="mb-4">
                <span className="text-base font-semibold text-gray-200">
                  {pricing.addOns.enterprise.price}
                </span>
              </div>
              <ul className="space-y-2 mb-5">
                {pricing.addOns.enterprise.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-300">{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={contactHref}>
                <Button className="w-full bg-white text-gray-900 hover:bg-gray-100 border-0" size="sm">
                  {pricing.addOns.enterprise.cta}
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
            {pricing.faqTitle}
          </h2>
          <div className="space-y-4">
            {pricing.faqItems.map((item: { q: string; a: string }) => (
              <div
                key={item.q}
                className="bg-white rounded-xl border border-gray-200 p-6"
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

      {/* ── Bottom CTA ───────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            {pricing.ctaTitle}
          </h2>
          <p className="text-gray-400 mb-8 text-sm leading-relaxed">
            {pricing.ctaBody}
          </p>
          <Link href={contactHref}>
            <Button className="bg-green-600 hover:bg-green-700 text-white border-0 text-base px-8 py-3 h-auto rounded-full">
              {pricing.ctaButton}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
