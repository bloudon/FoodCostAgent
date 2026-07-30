import { useRef } from "react";
import { ChevronRight, Camera, Clock, Layers, TrendingUp, Smartphone, RefreshCw, MinusCircle } from "lucide-react";
import { usePageEvent, useInViewEvent } from "@/lib/analytics";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { newPageTranslations } from "@/lib/new-page-translations";

const SECTION_ICONS = [Camera, Clock, Layers, TrendingUp, Smartphone, RefreshCw, MinusCircle] as const;

type ChefsSection = {
  eyebrow: string;
  headline: string;
  body: string;
  bullets: readonly string[];
};

function ChefsSectionItem({
  section,
  index,
  language,
}: {
  section: ChefsSection;
  index: number;
  language: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useInViewEvent(ref, "for_chefs_section_viewed", { section: section.eyebrow, language });

  const Icon = SECTION_ICONS[index] ?? Camera;
  const isEven = index % 2 === 1;

  return (
    <section
      ref={ref}
      className={`py-16 ${isEven ? "bg-gray-50" : "bg-white"}`}
      data-testid={`chefs-section-${index}`}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex flex-col ${isEven ? "md:flex-row-reverse" : "md:flex-row"} gap-10 items-start`}>
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
              <Icon className="h-6 w-6 text-orange-700" />
            </div>
          </div>
          {/* Content */}
          <div className="flex-1">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-600 mb-2">
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
                  <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-600 leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function WebsiteForChefs() {
  const { lang } = useLanguage();
  const t = newPageTranslations[lang];
  const p = t.forChefs;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";
  usePageEvent("for_chefs_page_viewed", { language: lang });

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
              data-testid="btn-chefs-hero-cta"
            >
              {p.ctaPrimary} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Feature sections */}
      {p.sections.map((section, i) => (
        <ChefsSectionItem
          key={section.eyebrow}
          section={section}
          index={i}
          language={lang}
        />
      ))}

      {/* Bottom CTA */}
      <section className="py-20 bg-gray-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">{p.ctaTitle}</h2>
          <p className="text-gray-400 mb-8">{p.ctaSubtitle}</p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-chefs-cta"
            >
              {p.ctaButton} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
