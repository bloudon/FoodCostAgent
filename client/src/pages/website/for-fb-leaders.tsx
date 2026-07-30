import { ChevronRight, Building2, BookOpen, ShoppingCart, Package, Warehouse, ClipboardCheck, BarChart3 } from "lucide-react";
import { usePageEvent } from "@/lib/analytics";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { newPageTranslations } from "@/lib/new-page-translations";

const SECTION_ICONS = [Building2, BookOpen, ShoppingCart, Package, Warehouse, ClipboardCheck, BarChart3] as const;

export default function WebsiteForFbLeaders() {
  const { lang } = useLanguage();
  const t = newPageTranslations[lang];
  const p = t.forFbLeaders;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";
  usePageEvent("for_fb_leaders_page_viewed", { language: lang });

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
              data-testid="btn-leaders-hero-cta"
            >
              {p.ctaPrimary} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Feature sections */}
      {p.sections.map((section, i) => {
        const Icon = SECTION_ICONS[i] ?? Building2;
        const isEven = i % 2 === 1;
        return (
          <section
            key={section.eyebrow}
            className={`py-16 ${isEven ? "bg-gray-50" : "bg-white"}`}
            data-testid={`leaders-section-${i}`}
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className={`flex flex-col ${isEven ? "md:flex-row-reverse" : "md:flex-row"} gap-10 items-start`}>
                {/* Icon */}
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                    <Icon className="h-6 w-6 text-green-700" />
                  </div>
                </div>
                {/* Content */}
                <div className="flex-1">
                  <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-700 mb-2">
                    {section.eyebrow}
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 leading-tight">
                    {section.headline}
                  </h2>
                  <p className="text-gray-500 leading-relaxed mb-5">
                    {section.body}
                  </p>
                  <ul className="space-y-2.5">
                    {section.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5">
                        <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500" />
                        <span className="text-sm text-gray-600 leading-relaxed">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {/* Bottom CTA */}
      <section className="py-20 bg-gray-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">{p.ctaTitle}</h2>
          <p className="text-gray-400 mb-8">{p.ctaSubtitle}</p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-leaders-cta"
            >
              {p.ctaButton} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
