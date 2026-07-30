import { Target, TrendingUp, Lightbulb, Wrench } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, SectionHeading } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

const VALUE_ICONS = [Target, TrendingUp, Lightbulb, Wrench];

export default function WebsiteAbout() {
  const { lang, t } = useLanguage();
  const about = t.about;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";

  return (
    <MarketingLayout>
      <MarketingHead
        title={about.meta.title}
        description={about.meta.description}
        lang={lang}
      />

      {/* ── Founding story ───────────────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {about.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 leading-tight">
            {about.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-6">
            {about.subheadline}
          </p>
          <p className="text-base text-gray-400 leading-relaxed">
            {about.storyBody}
          </p>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">
              {about.missionTitle}
            </h2>
            {/* Mission statement — visually emphasised */}
            <p className="text-xl text-gray-900 font-medium leading-relaxed mb-6 border-l-4 border-orange-400 pl-5">
              {about.mission1}
            </p>
            <p className="text-gray-500 text-lg leading-relaxed mb-6">
              {about.mission2}
            </p>
            <p className="text-gray-500 text-lg leading-relaxed">
              {about.mission3}
            </p>
          </div>
        </div>
      </section>

      {/* ── Values ────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading label={about.valuesLabel} title={about.valuesTitle} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {about.values.map((v, i) => {
              const Icon = VALUE_ICONS[i];
              return (
                <div
                  key={v.title}
                  className="bg-white rounded-lg border border-gray-100 p-6"
                  data-testid={`value-${v.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5 text-green-700" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">{v.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{v.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Who we're built for ───────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label={about.whoLabel}
            title={about.whoTitle}
            subtitle={about.whoSubtitle}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {about.whoItems.map((item) => (
              <div
                key={item.title}
                className="p-5 rounded-lg bg-gray-50 border border-gray-100 hover-elevate"
                data-testid={`who-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <h4 className="text-sm font-semibold text-gray-900 mb-2">{item.title}</h4>
                <p className="text-xs text-gray-500 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            {about.ctaTitle}
          </h2>
          <p className="text-gray-400 mb-8">
            {about.ctaSubtitle}
          </p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-about-cta"
            >
              {about.getStartedFree}
              <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
