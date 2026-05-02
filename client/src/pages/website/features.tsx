import { Link } from "wouter";
import {
  Camera, ScanLine, FileText, BarChart3, Users, RefreshCw, Truck,
  CheckCircle, ChevronRight, Clock, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingLayout, MarketingHead, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

type IconComponent = (props: { className?: string }) => JSX.Element;

const SECTION_ICONS: Record<string, IconComponent[]> = {
  setup: [Camera, FileText, ScanLine],
  count: [Camera, BarChart3],
  manage: [RefreshCw, BarChart3, Users, Truck],
};

const SECTION_COLORS: Record<string, { accent: string; badge: string; icon: string; check: string; border: string; bg: string }> = {
  setup: {
    accent: "text-orange-600",
    badge: "text-orange-700 bg-orange-50 border-orange-200",
    icon: "bg-orange-100 text-orange-700",
    check: "text-orange-500",
    border: "border-orange-100",
    bg: "bg-orange-50/50",
  },
  count: {
    accent: "text-blue-600",
    badge: "text-blue-700 bg-blue-50 border-blue-200",
    icon: "bg-blue-100 text-blue-700",
    check: "text-blue-500",
    border: "border-blue-100",
    bg: "bg-blue-50/50",
  },
  manage: {
    accent: "text-green-700",
    badge: "text-green-700 bg-green-50 border-green-200",
    icon: "bg-green-100 text-green-700",
    check: "text-green-600",
    border: "border-green-100",
    bg: "bg-green-50/50",
  },
};

const GROUP_META: { icon: IconComponent; color: "green" | "orange" }[] = [
  { icon: Camera, color: "orange" },
  { icon: RefreshCw, color: "green" },
  { icon: Truck, color: "green" },
  { icon: BarChart3, color: "orange" },
  { icon: Camera, color: "orange" },
  { icon: Users, color: "green" },
];

export default function WebsiteFeatures() {
  const { lang, t } = useLanguage();
  const feat = t.features;

  const hasNewSections = feat.sections && feat.sections.length > 0;

  return (
    <MarketingLayout>
      <MarketingHead
        title={feat.meta.title}
        description={feat.meta.description}
        lang={lang}
      />

      {/* ── Page Header ──────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-b from-gray-900 to-gray-800 text-white text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-400 mb-4">
            {feat.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4">
            {feat.headline}
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-8">
            {feat.subheadline}
          </p>
          <CTAButton href={appLink("/signup")} large>
            {feat.startFree}
          </CTAButton>
        </div>
      </section>

      {/* ── Three Photo-First Sections ───────────────────────── */}
      {hasNewSections && (
        <section className="bg-white">
          {feat.sections.map((section, sectionIdx) => {
            const c = SECTION_COLORS[section.key] || SECTION_COLORS.manage;
            const icons = SECTION_ICONS[section.key] || [Camera];
            const isEven = sectionIdx % 2 === 1;

            return (
              <div
                key={section.key}
                className={`py-20 ${isEven ? "bg-gray-50" : "bg-white"}`}
                data-testid={`section-${section.key}`}
              >
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="mb-12 max-w-2xl">
                    <Badge variant="outline" className={`mb-4 ${c.badge}`}>
                      {section.badge}
                    </Badge>
                    <div className={`text-xs font-semibold uppercase tracking-widest ${c.accent} mb-2`}>
                      {section.label}
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 mb-4">{section.headline}</h2>
                    <p className="text-gray-500 leading-relaxed">{section.body}</p>
                  </div>

                  <div className={`grid grid-cols-1 ${section.items.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"} gap-6`}>
                    {section.items.map((item, itemIdx) => {
                      const Icon = icons[itemIdx] || Camera;
                      return (
                        <div
                          key={item.title}
                          className={`rounded-xl border ${c.border} ${c.bg} p-6`}
                          data-testid={`feature-item-${section.key}-${itemIdx}`}
                        >
                          <div className={`w-10 h-10 rounded-lg ${c.icon} flex items-center justify-center mb-4`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <h3 className="text-base font-semibold text-gray-900 mb-2">{item.title}</h3>
                          <p className="text-sm text-gray-500 leading-relaxed mb-4">{item.desc}</p>
                          {"stat" in item && item.stat && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200">
                              <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                              <p className="text-xs text-gray-500 italic">{item.stat}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── Feature Groups (detail list) ─────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
          {feat.groups.map((group, i) => {
            const meta = GROUP_META[i] || { icon: Camera, color: "green" };
            const colorMap = {
              green: { icon: "bg-green-100 text-green-700", badge: "text-green-600", check: "text-green-500" },
              orange: { icon: "bg-orange-100 text-orange-600", badge: "text-orange-500", check: "text-orange-500" },
            };
            const c = colorMap[meta.color];
            const Icon = meta.icon;
            const reverse = i % 2 === 1;

            return (
              <div
                key={group.title}
                className={`flex flex-col ${reverse ? "lg:flex-row-reverse" : "lg:flex-row"} gap-12 items-start`}
                data-testid={`feature-group-${i}`}
              >
                <div className="flex-1">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${c.icon} mb-4`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-widest ${c.badge} mb-2 block`}>
                    {group.title}
                  </span>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">{group.title}</h3>
                  <p className="text-gray-500 leading-relaxed mb-6">{group.description}</p>
                  <ul className="space-y-3">
                    {group.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5">
                        <CheckCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${c.check}`} />
                        <span className="text-sm text-gray-600">{f}</span>
                      </li>
                    ))}
                  </ul>
                  {"proFeature" in group && group.proFeature && (
                    <div className="mt-4 p-4 rounded-lg bg-orange-50 border border-orange-200">
                      <p className="text-sm text-orange-800">{group.proFeature}</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 hidden lg:block" />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Tier Upgrade Path ────────────────────────────────── */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            title={feat.upgradeTitle}
            subtitle={feat.upgradeSubtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-starter">
              <Badge variant="outline" className="text-green-700 bg-green-50 border-green-200 mb-3">
                Starter
              </Badge>
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">{feat.upgradeBasicTitle}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feat.upgradeBasicBody}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-pro">
              <Badge variant="outline" className="text-orange-700 bg-orange-50 border-orange-200 mb-3">
                Pro
              </Badge>
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">{feat.upgradeProTitle}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feat.upgradeProBody}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-20 bg-green-900 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            {feat.ctaTitle}
          </h2>
          <p className="text-green-200 mb-8">
            {feat.ctaSubtitle}
          </p>
          <CTAButton href={appLink("/signup")} large>
            {feat.getStartedFree}
          </CTAButton>
        </div>
      </section>
    </MarketingLayout>
  );
}
