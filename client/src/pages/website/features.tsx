import { Link } from "wouter";
import {
  Package, BookOpen, TrendingDown, BarChart3, Truck, Users, RefreshCw,
  ScanLine, ArrowRightLeft, ClipboardList, ChevronRight, CheckCircle, Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

type FrameType = "flat" | "laptop" | "phone";

function LaptopFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative mx-auto" style={{ maxWidth: 560 }}>
      <div className="rounded-xl bg-gray-800 p-2 shadow-2xl">
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <img src={src} alt={alt} className="w-full rounded-md" loading="lazy" />
      </div>
      <div className="mx-auto -mt-px h-3 w-[70%] rounded-b-xl bg-gray-700" />
    </div>
  );
}

function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative mx-auto" style={{ maxWidth: 220 }}>
      <div className="rounded-[2rem] bg-gray-800 p-3 shadow-2xl">
        <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-gray-600" />
        <div className="overflow-hidden rounded-[1.25rem]" style={{ aspectRatio: "9 / 19.5" }}>
          <img src={src} alt={alt} className="w-full h-full object-cover object-top" loading="lazy" />
        </div>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-600" />
      </div>
    </div>
  );
}

function FlatFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto" style={{ maxWidth: 560 }}>
      <div className="overflow-hidden rounded-xl shadow-lg border border-gray-200" style={{ aspectRatio: "16 / 9" }}>
        <img src={src} alt={alt} className="w-full h-full object-cover object-top" loading="lazy" />
      </div>
    </div>
  );
}

function ScreenshotFrame({ src, alt, frame }: { src: string; alt: string; frame: FrameType }) {
  switch (frame) {
    case "laptop": return <LaptopFrame src={src} alt={alt} />;
    case "phone": return <PhoneFrame src={src} alt={alt} />;
    default: return <FlatFrame src={src} alt={alt} />;
  }
}

type TierLevel = "free" | "basic" | "pro";

const GROUP_META: { icon: React.ElementType; imageSrc: string; frameType: FrameType; tier: TierLevel; color: string }[] = [
  { icon: Package, imageSrc: "/screenshots/inventory-management.png", frameType: "laptop", tier: "free", color: "green" },
  { icon: BookOpen, imageSrc: "/screenshots/recipe-costing.png", frameType: "flat", tier: "basic", color: "orange" },
  { icon: Truck, imageSrc: "/screenshots/vendor-order-guides.png", frameType: "flat", tier: "free", color: "green" },
  { icon: BarChart3, imageSrc: "/screenshots/food-cost-variance.png", frameType: "flat", tier: "pro", color: "orange" },
  { icon: ClipboardList, imageSrc: "/screenshots/inventory-counting.png", frameType: "phone", tier: "free", color: "green" },
  { icon: Users, imageSrc: "/screenshots/multi-location.png", frameType: "flat", tier: "pro", color: "orange" },
];

function TierBadge({ tier, labels }: { tier: TierLevel; labels: Record<TierLevel, string> }) {
  const configs: Record<TierLevel, { color: string; bg: string; border: string }> = {
    free: { color: "text-gray-600", bg: "bg-gray-100", border: "border-gray-300" },
    basic: { color: "text-green-700", bg: "bg-green-50", border: "border-green-300" },
    pro: { color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-300" },
  };
  const config = configs[tier];
  return (
    <Badge
      variant="outline"
      className={`text-[11px] px-2 py-0 h-5 font-semibold ${config.color} ${config.border} ${config.bg}`}
      data-testid={`tier-badge-${tier}`}
    >
      {labels[tier]}
    </Badge>
  );
}

export default function WebsiteFeatures() {
  const { lang, t } = useLanguage();
  const feat = t.features;

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
          <p className="text-lg text-gray-300 leading-relaxed mb-6">
            {feat.subheadline}
          </p>
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            {(["free", "basic", "pro"] as TierLevel[]).map((tier) => (
              <TierBadge key={tier} tier={tier} labels={feat.tierLabels} />
            ))}
            <span className="text-xs text-gray-400 self-center ml-1">{feat.badgesNote}</span>
          </div>
          <CTAButton href={appLink("/signup")} large>
            {feat.startFree}
          </CTAButton>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
          {feat.groups.map((group, i) => {
            const meta = GROUP_META[i];
            const colorMap = {
              green: { icon: "bg-green-100 text-green-700", badge: "text-green-600", check: "text-green-500" },
              orange: { icon: "bg-orange-100 text-orange-600", badge: "text-orange-500", check: "text-orange-500" },
            };
            const c = colorMap[meta.color as keyof typeof colorMap];
            const Icon = meta.icon;
            const reverse = i % 2 === 1;
            return (
              <div
                key={group.title}
                className={`flex flex-col ${reverse ? "lg:flex-row-reverse" : "lg:flex-row"} gap-12 items-center`}
                data-testid={`feature-group-${group.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${c.icon}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <TierBadge tier={meta.tier} labels={feat.tierLabels} />
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-widest ${c.badge} mb-2 block`}>
                    {group.title}
                  </span>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">{group.title}</h3>
                  <p className="text-gray-500 leading-relaxed mb-6">{group.description}</p>
                  <ul className="space-y-3">
                    {group.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <CheckCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${c.check}`} />
                        <span className="text-sm text-gray-600">{f}</span>
                      </li>
                    ))}
                  </ul>
                  {"proFeature" in group && group.proFeature && (
                    <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200">
                      <div className="flex items-start gap-2">
                        <Star className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-orange-800">{group.proFeature}</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 w-full flex items-center justify-center">
                  <ScreenshotFrame
                    src={meta.imageSrc}
                    alt={`${group.title} — FnB Cost Pro app screenshot`}
                    frame={meta.frameType}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            title={feat.upgradeTitle}
            subtitle={feat.upgradeSubtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-free">
              <TierBadge tier="free" labels={feat.tierLabels} />
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">{feat.upgradeFreeTitle}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feat.upgradeFreebody}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-basic">
              <TierBadge tier="basic" labels={feat.tierLabels} />
              <h3 className="text-lg font-semibold text-gray-900 mt-3 mb-2">{feat.upgradeBasicTitle}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feat.upgradeBasicBody}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6" data-testid="upgrade-path-pro">
              <TierBadge tier="pro" labels={feat.tierLabels} />
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
