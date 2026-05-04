import { Link } from "wouter";
import {
  Camera, ScanLine, FileText, BarChart3, Users, RefreshCw, Truck,
  CheckCircle, ChevronRight, Clock, DollarSign, MapPin, TrendingUp, QrCode, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingLayout, MarketingHead, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

type IconComponent = (props: { className?: string }) => JSX.Element;

function PhoneFrame({ src, alt, caption, testId }: { src: string; alt: string; caption: string; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative bg-gray-900 rounded-[2.5rem] p-2.5 shadow-2xl w-[180px] sm:w-[200px]"
        data-testid={testId}
      >
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-14 h-5 bg-gray-800 rounded-full z-10" />
        <div className="rounded-[2rem] overflow-hidden bg-black">
          <img src={src} alt={alt} className="w-full h-auto block" loading="lazy" />
        </div>
      </div>
      <p className="text-xs text-gray-500 text-center font-medium">{caption}</p>
    </div>
  );
}

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

const GROUP_SCREENSHOTS: string[] = [
  "/screenshots/inventory-management.png",
  "/screenshots/recipe-costing.png",
  "/screenshots/vendor-order-guides.png",
  "/screenshots/food-cost-variance.png",
  "/screenshots/inventory-counting.png",
  "/screenshots/multi-location.png",
];

const GROUP_SCREENSHOT_ALTS: string[] = [
  "FnB Cost Pro inventory management — set up your items from a photo",
  "FnB Cost Pro live recipe costing — cost per portion updated automatically",
  "FnB Cost Pro vendor order guides — Sysco, GFS, US Foods catalogs",
  "FnB Cost Pro food cost variance report — theoretical vs actual",
  "FnB Cost Pro inventory counting on mobile — scan shelves with your phone",
  "FnB Cost Pro multi-location store management",
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
                <div className="flex-1 hidden lg:flex items-center">
                  <div className="w-full rounded-xl overflow-hidden shadow-xl border border-gray-200 bg-white">
                    <img
                      src={GROUP_SCREENSHOTS[i]}
                      alt={GROUP_SCREENSHOT_ALTS[i]}
                      className="w-full h-auto block"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="py-20 bg-gray-50" data-testid="section-mobile-showcase">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Badge variant="outline" className="text-green-700 bg-green-50 border-green-200 mb-4">
              Inventory Companion App
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              Count inventory from any device
            </h2>
            <p className="text-gray-500 max-w-2xl mx-auto leading-relaxed">
              The Inventory Companion app puts scanning and counting in your team's hands on the floor. Desktop is great for reviewing reports and costs. And for logging waste, a tablet at the pass keeps it quick and simple.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-10 items-center justify-center mb-14">
            <div className="flex flex-wrap gap-8 items-end justify-center">
              <PhoneFrame
                src="/screenshots/mobile-count-session.jpg"
                alt="FnB Cost Pro Inventory Companion — count session overview"
                caption="Count session overview"
                testId="phone-frame-count-session"
              />
              <PhoneFrame
                src="/screenshots/mobile-count-items.jpg"
                alt="FnB Cost Pro Inventory Companion — items grouped by storage location"
                caption="Items grouped by location"
                testId="phone-frame-count-items"
              />
              <PhoneFrame
                src="/screenshots/mobile-waste-log.jpg"
                alt="FnB Cost Pro waste log on a tablet or mobile browser"
                caption="Waste log — great on a tablet"
                testId="phone-frame-waste-log"
              />
            </div>

            <div className="lg:max-w-xs w-full">
              <ul className="space-y-5">
                {[
                  { icon: QrCode, text: "Scan barcodes with the Inventory Companion app — no extra hardware" },
                  { icon: MapPin, text: "Items grouped by storage location so staff count aisle by aisle" },
                  { icon: TrendingUp, text: "Running cost totals update as you enter each count" },
                  { icon: Smartphone, text: "Desktop for reports and review, tablet for waste, phone for counts" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-gray-600 text-sm leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
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
