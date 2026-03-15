import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, TrendingDown, BookOpen, Truck, BarChart3, Users, RefreshCw, CheckCircle, ClipboardList, Calculator, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, CTAButton, SectionHeading, appLink } from "@/components/website/marketing-layout";

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

const FEATURES = [
  { icon: TrendingDown, title: "Food Cost Calculator", desc: "Know the exact restaurant food cost of every dish — a built-in food cost calculator covering ingredients, nested sub-recipes, yield losses, and live vendor pricing." },
  { icon: BookOpen, title: "Inventory Control", desc: "Track stock across all storage locations, record physical counts, and see theoretical vs. actual variances across your back of house." },
  { icon: Truck, title: "Vendor Order Guides", desc: "Import Sysco, GFS, and US Foods catalogs automatically. Build purchase orders in seconds and keep every recipe cost current." },
  { icon: BarChart3, title: "Food Cost Variance", desc: "Compare your restaurant food cost against actual sales to spot waste, theft, and pricing issues immediately — before they erode your margins." },
  { icon: Users, title: "Multi-Location", desc: "Manage recipes, inventory, and staff across every store from one central restaurant management software account." },
  { icon: RefreshCw, title: "Food & Beverage Cost Control", desc: "When vendor prices change, every food and beverage cost updates automatically across all recipes — complete cost control with no manual rework." },
];

const RECIPE_STEPS = [
  {
    icon: ClipboardList,
    num: "1",
    title: "Write Your Recipe Like You Always Have",
    body: "Add ingredients the way you think about them — \"2 lbs chicken breast,\" \"1 cup heavy cream.\" No formulas, no spreadsheets. Just your recipe, written your way.",
  },
  {
    icon: Calculator,
    num: "2",
    title: "Your Food Cost Calculator Does the Rest",
    body: "Tell us how many servings, set your yield percentages for trim and waste, and FnB Cost Pro calculates the true restaurant food cost per portion instantly.",
  },
  {
    icon: ListChecks,
    num: "3",
    title: "Know Your Food Cost — Always",
    body: "Every recipe updates automatically when your vendor prices change. Nested sub-recipes recalculate in the right order. Your food cost is always accurate, always current.",
  },
];

const STEPS = [
  { num: "01", title: "We Walk You Through Setup", body: "Our onboarding guides you step by step — from adding your first inventory item to connecting your vendors. You're never on your own." },
  { num: "02", title: "Build Your Recipes Your Way", body: "Create detailed recipes with ingredients, yields, and portion costs. Our team is here to help you get them right." },
  { num: "03", title: "Track, Adjust & Grow", body: "Run inventory counts, import sales data, and use our variance reports to make smarter decisions — with support along the way." },
];

const STATS = [
  { value: "Free", label: "Plan available — no credit card" },
  { value: "Guided", label: "Onboarding included" },
  { value: "3–5%", label: "Typical food cost reduction" },
  { value: "100%", label: "Cloud-based, access anywhere" },
];

export default function WebsiteHome() {
  return (
    <MarketingLayout>
      <section className="relative min-h-[88vh] flex items-center" data-testid="hero-section">
        <HeroBackground />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <span className="inline-block bg-orange-500/20 text-orange-300 text-xs font-semibold uppercase tracking-widest px-4 py-1 rounded-full mb-6 border border-orange-500/30">
            Restaurant Management Software
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
            Know Your Numbers.<br />
            <span className="text-orange-400">Control Your Costs.</span><br />
            Grow Your Business.
          </h1>
          <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto mb-10 leading-relaxed">
            FnB Cost Pro is the restaurant management software built for F&amp;B operators — restaurants, bars, catering companies, and Food &amp; Beverage businesses of every type. Get food cost control, beverage cost control, recipe costing, and inventory tracking in one platform.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a href={appLink("/signup")}>
              <Button
                size="lg"
                className="bg-orange-500 text-white border-0 text-base px-8"
                data-testid="btn-hero-trial"
              >
                Start Free — No Credit Card
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </a>
            <Link href="/pricing">
              <Button
                size="lg"
                variant="outline"
                className="text-white border-white/50 bg-white/10 backdrop-blur-sm text-base px-8 hover:bg-white/20"
                data-testid="btn-hero-pricing"
              >
                View Pricing
              </Button>
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-400">Free plan available. Paid plans include a 30-day free trial.</p>
        </div>
      </section>

      <section className="py-12 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {STATS.map((s) => (
              <div key={s.value} data-testid={`stat-${s.value}`}>
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
            label="What You Get"
            title="Restaurant Software Built for Food &amp; Beverage Cost Control"
            subtitle="A complete platform purpose-built for restaurants, bars, and Food &amp; Beverage businesses — not adapted from generic inventory or retail software."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="p-6 rounded-lg border border-gray-100 bg-gray-50 hover-elevate"
                data-testid={`feature-card-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="w-11 h-11 rounded-lg bg-green-100 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-green-700" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/features">
              <Button variant="outline" className="gap-1" data-testid="btn-all-features">
                See All Features <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50" id="recipe-costing" data-testid="recipe-costing-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label="Recipe Costing for Chefs"
            title="Your Food Cost Calculator — Built Into Your Recipe Builder"
            subtitle="No spreadsheets. No complicated formulas. Write your recipe the way you always have, and FnB Cost Pro gives you the exact restaurant food cost per portion — instantly."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">
            {RECIPE_STEPS.map((step) => (
              <div
                key={step.num}
                className="bg-white rounded-xl border border-gray-200 p-8 text-center"
                data-testid={`recipe-step-${step.num}`}
              >
                <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-5">
                  <step.icon className="h-6 w-6 text-orange-600" />
                </div>
                <div className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2">Step {step.num}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{step.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <p className="text-gray-500 mb-4 text-sm">Recipe costing is available on Basic and Pro plans.</p>
            <Link href="/pricing">
              <Button variant="outline" className="gap-1" data-testid="btn-recipe-pricing">
                See Plans <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-green-900" id="how-it-works">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            label="How It Works"
            title="Guided Onboarding, Every Step of the Way"
            subtitle="Getting started with FnB Cost Pro is straightforward — and you won't be doing it alone. We guide you through the entire setup process."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mt-4">
            {STEPS.map((s) => (
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
            Ready to Take Control of Your Food &amp; Beverage Costs?
          </h2>
          <p className="text-lg text-gray-500 mb-8">
            Join F&amp;B operators — from independent restaurants to multi-unit Food &amp; Beverage groups — using FnB Cost Pro for food cost control, beverage cost control, and smarter margin management.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href={appLink("/signup")} large>
              Start Free — No Credit Card
            </CTAButton>
            <Link href="/contact">
              <Button size="lg" variant="outline" className="px-8" data-testid="btn-cta-contact">
                Talk to Us
              </Button>
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {["Free plan available", "Paid plans: 30-day free trial", "Full access from day one", "Guided setup included"].map((item) => (
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
