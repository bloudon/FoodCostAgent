import { useRef } from "react";
import { ChevronRight } from "lucide-react";
import { usePageEvent, useInViewEvent } from "@/lib/analytics";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";
import { newPageTranslations } from "@/lib/new-page-translations";

type PlatformSection = {
  id: string;
  eyebrow: string;
  headline: string;
  body: string;
  bullets: readonly string[];
  screenshot: string;
  screenshotAlt: string;
};

function PlatformAnchorSection({
  section,
  isEven,
  language,
}: {
  section: PlatformSection;
  isEven: boolean;
  language: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useInViewEvent(ref, "platform_anchor_viewed", { anchor: section.id, language });

  return (
    <section
      ref={ref}
      id={section.id}
      className={`py-20 ${isEven ? "bg-gray-50" : "bg-white"}`}
      data-testid={`platform-section-${section.id}`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex flex-col ${isEven ? "lg:flex-row-reverse" : "lg:flex-row"} gap-12 items-center`}>
          {/* Text */}
          <div className="flex-1">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-600 mb-3">
              {section.eyebrow}
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
              {section.headline}
            </h2>
            <p className="text-gray-500 leading-relaxed mb-6 text-base">
              {section.body}
            </p>
            <ul className="space-y-3">
              {section.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span className="text-sm text-gray-600 leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Screenshot */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-100">
              <img
                src={section.screenshot}
                alt={section.screenshotAlt}
                className="w-full h-auto object-cover"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function WebsitePlatform() {
  const { lang } = useLanguage();
  const t = newPageTranslations[lang];
  const p = t.platform;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";
  usePageEvent("platform_section_viewed", { language: lang });

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
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href={contactHref}>
              <Button
                size="lg"
                className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
                data-testid="btn-platform-hero-cta"
              >
                {p.ctaPrimary} <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </Link>
            <a href="#recipes">
              <Button variant="outline" size="lg" className="border-white/40 text-white bg-white/10 backdrop-blur-sm">
                {p.ctaSecondary}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Capability sections */}
      {p.sections.map((section, i) => (
        <PlatformAnchorSection
          key={section.id}
          section={section}
          isEven={i % 2 === 1}
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
              data-testid="btn-platform-cta"
            >
              {p.ctaButton} <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
