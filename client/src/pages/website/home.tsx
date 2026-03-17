import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, TrendingDown, BookOpen, Truck, BarChart3, Users, RefreshCw, CheckCircle, ClipboardList, Calculator, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

interface BgImage { id?: string; url: string; label?: string; }
interface BgResponse { images: BgImage[]; isBranded: boolean; }

function HeroBackground() {
  const { data } = useQuery<BgResponse>({
    queryKey: ["/api/background-images"],
    queryFn: async () => {
      const res = await fetch("/api/background-images");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const photos = data?.images ?? [];
  const [slotA, setSlotA] = useState(0);
  const [slotB, setSlotB] = useState(1);
  const [active, setActive] = useState<"a" | "b">("a");
  const idxRef = useRef(1);
  useEffect(() => {
    if (photos.length <= 1) return;
    const iv = setInterval(() => {
      const next = (idxRef.current + 1) % photos.length;
      if (active === "a") { setSlotB(next); setTimeout(() => setActive("b"), 50); }
      else { setSlotA(next); setTimeout(() => setActive("a"), 50); }
      idxRef.current = next;
    }, 10000);
    return () => clearInterval(iv);
  }, [active, photos.length]);
  const FADE = "transition-opacity duration-[1500ms] ease-in-out absolute inset-0 w-full h-full object-cover";
  return (
    <div className="absolute inset-0 overflow-hidden">
      {photos.length === 0 ? (
        <div className="absolute inset-0 bg-gray-900" />
      ) : photos.length === 1 ? (
        <img src={photos[0].url} alt="" className={FADE} style={{ opacity: 1 }} />
      ) : (
        <>
          <img src={photos[slotA]?.url} alt="" className={FADE} style={{ opacity: active === "a" ? 1 : 0 }} />
          <img src={photos[slotB]?.url} alt="" className={FADE} style={{ opacity: active === "b" ? 1 : 0 }} />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/55 to-black/70" />
    </div>
  );
}

const FEATURE_ICONS = [TrendingDown, BookOpen, Truck, BarChart3, Users, RefreshCw];
const RECIPE_ICONS = [ClipboardList, Calculator, ListChecks];

export default function WebsiteHome() {
  const { lang, t } = useLanguage();
  const home = t.home;

  return (
    <MarketingLayout>
      <MarketingHead
        title={home.meta.title}
        description={home.meta.description}
        lang={lang}
      />
      <section className="relative min-h-[88vh] flex items-center" data-testid="hero-section">
        <HeroBackground />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <span className="inline-block bg-orange-500/20 text-orange-300 text-xs font-semibold uppercase tracking-widest px-4 py-1 rounded-full mb-6 border border-orange-500/30">
            {home.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
            {home.headline1}<br />
            <span className="text-orange-400">{home.headline2}</span><br />
            {home.headline3}
          </h1>
          <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto mb-10 leading-relaxed">
            {home.subheadline}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a href={appLink("/signup")}>
              <Button
                size="lg"
                className="bg-orange-500 text-white border-0 text-base px-8"
                data-testid="btn-hero-trial"
              >
                {home.ctaTrial}
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </a>
            <Link href={lang === "es" ? "/es/pricing" : "/pricing"}>
              <Button
                size="lg"
                variant="outline"
                className="text-white border-white/50 bg-white/10 backdrop-blur-sm text-base px-8 hover:bg-white/20"
                data-testid="btn-hero-pricing"
              >
                {home.ctaPricing}
              </Button>
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-400">{home.trialNote}</p>
        </div>
      </section>

      <section className="py-12 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {home.stats.map((s, i) => (
              <div key={i} data-testid={`stat-${s.value}`}>
                <p className="text-3xl font-extrabold text-orange-400 mb-1">{s.value}</p>
                <p className="text-sm text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-white" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label={home.featuresLabel}
            title={home.featuresTitle}
            subtitle={home.featuresSubtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {home.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <div
                  key={f.title}
                  className="p-6 rounded-lg border border-gray-100 bg-gray-50 hover-elevate"
                  data-testid={`feature-card-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="w-11 h-11 rounded-lg bg-green-100 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5 text-green-700" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
          <div className="text-center mt-12">
            <Link href={lang === "es" ? "/es/features" : "/features"}>
              <Button variant="outline" className="gap-1" data-testid="btn-all-features">
                {home.seeAllFeatures} <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50" id="recipe-costing" data-testid="recipe-costing-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label={home.recipeLabel}
            title={home.recipeTitle}
            subtitle={home.recipeSubtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">
            {home.recipeSteps.map((step, i) => {
              const Icon = RECIPE_ICONS[i];
              return (
                <div
                  key={step.num}
                  className="bg-white rounded-xl border border-gray-200 p-8 text-center"
                  data-testid={`recipe-step-${step.num}`}
                >
                  <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-5">
                    <Icon className="h-6 w-6 text-orange-600" />
                  </div>
                  <div className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2">
                    {home.stepLabel} {step.num}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{step.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
                </div>
              );
            })}
          </div>
          <div className="text-center mt-10">
            <p className="text-gray-500 mb-4 text-sm">{home.recipeNote}</p>
            <Link href={lang === "es" ? "/es/pricing" : "/pricing"}>
              <Button variant="outline" className="gap-1" data-testid="btn-recipe-pricing">
                {home.seePlans} <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-green-900" id="how-it-works">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label={home.howItWorksLabel}
            title={home.howItWorksTitle}
            subtitle={home.howItWorksSubtitle}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mt-4">
            {home.steps.map((s) => (
              <div key={s.num} className="text-center" data-testid={`step-${s.num}`}>
                <div className="text-5xl font-black text-orange-400/40 mb-4">{s.num}</div>
                <h3 className="text-lg font-semibold text-white mb-3">{s.title}</h3>
                <p className="text-sm text-green-200 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50" id="cta-bottom">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            {home.ctaBottomTitle}
          </h2>
          <p className="text-lg text-gray-500 mb-8">
            {home.ctaBottomSubtitle}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href={appLink("/signup")} large>
              {home.ctaBottomTrial}
            </CTAButton>
            <Link href={lang === "es" ? "/es/contact" : "/contact"}>
              <Button size="lg" variant="outline" className="px-8" data-testid="btn-cta-contact">
                {home.ctaBottomContact}
              </Button>
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {home.ctaChecklist.map((item) => (
              <li key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingLayout>
  );
}
