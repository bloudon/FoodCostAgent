import { Target, Heart, Lightbulb } from "lucide-react";
import { MarketingLayout, MarketingHead, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

const VALUE_ICONS = [Target, Heart, Lightbulb];

export default function WebsiteAbout() {
  const { lang, t } = useLanguage();
  const about = t.about;

  return (
    <MarketingLayout>
      <MarketingHead
        title={about.meta.title}
        description={about.meta.description}
        lang={lang}
      />
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {about.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">
            {about.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed">
            {about.subheadline}
          </p>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">{about.missionTitle}</h2>
            <p className="text-gray-500 text-lg leading-relaxed mb-6">
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

      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading label={about.valuesLabel} title={about.valuesTitle} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {about.values.map((v, i) => {
              const Icon = VALUE_ICONS[i];
              return (
                <div key={v.title} className="bg-white rounded-lg border border-gray-100 p-6" data-testid={`value-${v.title.toLowerCase().replace(/\s+/g, "-")}`}>
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

      <section className="py-20 bg-green-900 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            {about.ctaTitle}
          </h2>
          <p className="text-green-200 mb-8">
            {about.ctaSubtitle}
          </p>
          <CTAButton href={appLink("/signup")} large>
            {about.getStartedFree}
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}
