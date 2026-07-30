import { ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { newPageTranslations } from "@/lib/new-page-translations";
import { usePageEvent } from "@/lib/analytics";

export default function WebsiteIndustryClubs() {
  const { lang } = useLanguage();
  const t = newPageTranslations[lang];
  const p = t.industryClubs;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";
  usePageEvent("industry_page_viewed", { segment: "clubs-resorts", language: lang });

  return (
    <MarketingLayout>
      <MarketingHead
        title={p.meta.title}
        description={p.meta.description}
        lang={lang}
      />

      {/* Hero */}
      <section className="py-20 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {p.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
            {p.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-8">
            {p.subheadline}
          </p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-clubs-hero-cta"
            >
              {p.ctaButton} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Challenge */}
      <section className="py-20 bg-white" data-testid="clubs-challenge">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-red-600 mb-3">
            {p.challenge.eyebrow}
          </span>
          <h2 className="text-3xl font-bold text-gray-900 mb-4 leading-tight">
            {p.challenge.headline}
          </h2>
          <p className="text-gray-500 leading-relaxed mb-7 max-w-2xl">{p.challenge.body}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
            {p.challenge.bullets.map((b) => (
              <div key={b} className="flex items-start gap-3 p-4 bg-red-50 rounded-lg border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-gray-700 leading-relaxed">{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-gray-50" data-testid="clubs-how-it-works">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row-reverse gap-12 items-start">
            <div className="flex-1">
              <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-700 mb-3">
                {p.howItWorks.eyebrow}
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4 leading-tight">
                {p.howItWorks.headline}
              </h2>
              <p className="text-gray-500 leading-relaxed mb-6">{p.howItWorks.body}</p>
              <ul className="space-y-3">
                {p.howItWorks.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700 leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-1">
              <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-100">
                <img
                  src={p.screenshot}
                  alt={p.screenshotAlt}
                  className="w-full h-auto object-cover"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gray-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">{p.ctaTitle}</h2>
          <p className="text-gray-400 mb-8">{p.ctaSubtitle}</p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-clubs-cta"
            >
              {p.ctaButton} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
