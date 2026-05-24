import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronRight, Camera, ScanLine, BarChart3, Users, RefreshCw, Truck,
  CheckCircle, ClipboardList, Calculator, ListChecks, DollarSign, Clock, TrendingDown,
  Wifi, Battery, Signal, Scale, ArrowLeft, CheckCircle2, TrendingUp,
} from "lucide-react";
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
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
    </div>
  );
}

const FEATURE_ICONS = [Camera, ScanLine, BarChart3, Truck, Users, RefreshCw];
const RECIPE_ICONS = [Camera, Calculator, ListChecks];
const ROI_ICONS = [DollarSign, Clock, TrendingDown];

// ── Phone frame + mockup screens ─────────────────────────────────────────────
function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 flex-shrink-0">
      <div
        className="relative rounded-[2.5rem] bg-gray-900 shadow-2xl"
        style={{ width: 220, height: 460, border: "6px solid #374151" }}
      >
        <div className="absolute -left-[8px] top-20 w-[4px] h-8 bg-gray-600 rounded-l-sm" />
        <div className="absolute -left-[8px] top-32 w-[4px] h-12 bg-gray-600 rounded-l-sm" />
        <div className="absolute -right-[8px] top-24 w-[4px] h-14 bg-gray-600 rounded-r-sm" />
        <div className="absolute inset-0 rounded-[2rem] overflow-hidden bg-gray-50">
          <div className="flex items-center justify-between px-4 pt-2 pb-1 bg-white" style={{ fontSize: 9 }}>
            <span className="font-semibold text-gray-800">9:41</span>
            <div className="absolute left-1/2 -translate-x-1/2 top-1 w-16 h-4 bg-gray-900 rounded-full" />
            <div className="flex items-center gap-1 text-gray-800">
              <Signal className="h-2.5 w-2.5" />
              <Wifi className="h-2.5 w-2.5" />
            </div>
          </div>
          {children}
        </div>
      </div>
      <p className="text-sm font-medium text-gray-300 text-center">{label}</p>
    </div>
  );
}

function ScreenInventoryCount() {
  return (
    <div className="flex flex-col h-full bg-gray-50" style={{ fontSize: 10 }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b border-gray-100">
        <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="h-2.5 w-2.5 text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate" style={{ fontSize: 10 }}>Brian's Pizza</div>
          <div className="text-gray-400" style={{ fontSize: 8 }}>12 / 45 items counted</div>
        </div>
        <div className="bg-emerald-500 text-white rounded-full px-2 py-0.5 font-semibold" style={{ fontSize: 8 }}>
          Apply
        </div>
      </div>
      <div className="flex gap-1.5 px-2 py-1.5 overflow-x-hidden border-b border-gray-100 bg-white">
        <div className="flex items-center gap-1 bg-slate-600 text-white rounded-full px-2 py-0.5 flex-shrink-0" style={{ fontSize: 8 }}>
          <span className="font-medium">Walk-In</span>
          <span className="opacity-70">8/8</span>
        </div>
        <div className="flex items-center gap-1 border border-emerald-300 text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 flex-shrink-0" style={{ fontSize: 8 }}>
          <CheckCircle2 className="h-2 w-2" />
          <span>Dry Store 4/4</span>
        </div>
        <div className="flex items-center gap-1 border border-gray-200 text-gray-400 rounded-full px-2 py-0.5 flex-shrink-0" style={{ fontSize: 8 }}>
          Freezer 0/12
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-1 bg-slate-50 border-b border-gray-100">
        <span className="text-gray-500" style={{ fontSize: 8 }}>Walk-In: <span className="font-semibold text-gray-700">$2,340</span></span>
        <span className="text-gray-500" style={{ fontSize: 8 }}>Session: <span className="font-semibold text-gray-700">$4,120</span></span>
      </div>
      <div className="flex-1 overflow-hidden divide-y divide-gray-100">
        {[
          { name: "Ground Beef", qty: "12.50 lb", cost: "$187.50", counted: true, mode: null },
          { name: "Chicken Breast", qty: "8.00 lb", cost: "$96.00", counted: true, mode: null },
          { name: "Mozzarella", qty: "6.00 lb", cost: "$78.00", counted: true, mode: "catch" },
          { name: "Salmon Fillet", qty: null, cost: null, counted: false, mode: "catch" },
          { name: "Jumbo Shrimp", qty: null, cost: null, counted: false, mode: null },
          { name: "Roma Tomatoes", qty: null, cost: null, counted: false, mode: null },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.counted ? "bg-emerald-500" : "bg-gray-300"}`} />
            <div className="flex-1 min-w-0">
              <div className={`font-medium truncate ${item.counted ? "text-gray-800" : "text-gray-400"}`}>{item.name}</div>
              {item.counted && <div className="text-emerald-600 font-semibold" style={{ fontSize: 8 }}>{item.qty}</div>}
            </div>
            {item.mode === "catch" && <Scale className="h-2.5 w-2.5 text-amber-400 flex-shrink-0" />}
            {item.counted && <div className="text-gray-500 font-mono" style={{ fontSize: 8 }}>{item.cost}</div>}
            <div className="text-gray-300" style={{ fontSize: 8 }}>›</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenInvoiceScan() {
  return (
    <div className="flex flex-col h-full bg-gray-50" style={{ fontSize: 10 }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b border-gray-100">
        <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="h-2.5 w-2.5 text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900" style={{ fontSize: 10 }}>Sysco Invoice</div>
          <div className="text-gray-400" style={{ fontSize: 8 }}>Delivery #4892 · Mar 28</div>
        </div>
        <div className="bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-semibold" style={{ fontSize: 8 }}>
          13/14 matched
        </div>
      </div>
      <div className="mx-2 mt-2 mb-1 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2 px-3 py-2">
        <Camera className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
        <div>
          <div className="font-semibold text-blue-800" style={{ fontSize: 9 }}>Invoice scanned by photo</div>
          <div className="text-blue-500" style={{ fontSize: 8 }}>All line items extracted automatically</div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden divide-y divide-gray-100 mx-1">
        {[
          { name: "80/20 Ground Beef", pack: "10 lb cs", price: "$42.80", ok: true },
          { name: "Chicken Breast Bnls", pack: "40 lb cs", price: "$89.60", ok: true },
          { name: "Mozzarella Whole", pack: "6/5 lb", price: "$67.20", ok: true },
          { name: "Roma Tomatoes", pack: "25 lb cs", price: "$28.40", ok: true },
          { name: "Canola Oil", pack: "6/1 gal", price: "$54.90", ok: true },
          { name: "Rigatoni Pasta", pack: "20 lb cs", price: "$31.60", ok: true },
          { name: "Heavy Cream", pack: "1 gal", price: "—", ok: false },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${item.ok ? "bg-emerald-100" : "bg-amber-100"}`}>
              {item.ok
                ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                : <span className="text-amber-600 font-bold" style={{ fontSize: 8 }}>?</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 truncate" style={{ fontSize: 9 }}>{item.name}</div>
              <div className="text-gray-400" style={{ fontSize: 7.5 }}>{item.pack}</div>
            </div>
            <div className={`font-mono font-semibold ${item.ok ? "text-gray-700" : "text-amber-500"}`} style={{ fontSize: 9 }}>{item.price}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 bg-white border-t border-gray-100">
        <div className="bg-slate-600 text-white rounded-lg py-1.5 text-center font-semibold" style={{ fontSize: 9 }}>
          Confirm Receipt — $314.50
        </div>
      </div>
    </div>
  );
}

function ScreenRecipeCosting() {
  return (
    <div className="flex flex-col h-full bg-gray-50" style={{ fontSize: 10 }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b border-gray-100">
        <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="h-2.5 w-2.5 text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900" style={{ fontSize: 10 }}>Margherita Pizza</div>
          <div className="text-gray-400" style={{ fontSize: 8 }}>Recipe · 1 serving</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-emerald-600" style={{ fontSize: 10 }}>$2.18</div>
          <div className="text-gray-400" style={{ fontSize: 8 }}>18.2% cost</div>
        </div>
      </div>
      <div className="mx-2 mt-2 mb-1 rounded-lg bg-orange-50 border border-orange-200 flex items-center gap-2 px-3 py-1.5">
        <Camera className="h-3 w-3 text-orange-500 flex-shrink-0" />
        <div className="font-semibold text-orange-700" style={{ fontSize: 8 }}>
          Scanned from recipe card · 5 ingredients extracted
        </div>
      </div>
      <div className="flex-1 overflow-hidden divide-y divide-gray-100 mx-1">
        {[
          { name: "Pizza Dough", qty: "14 oz", cost: "$0.42" },
          { name: "Tomato Sauce", qty: "4 oz", cost: "$0.18" },
          { name: "Mozzarella", qty: "6 oz", cost: "$1.24" },
          { name: "Fresh Basil", qty: "0.5 oz", cost: "$0.08" },
          { name: "Olive Oil", qty: "1 oz", cost: "$0.26" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 truncate">{item.name}</div>
              <div className="text-gray-400" style={{ fontSize: 8 }}>{item.qty}</div>
            </div>
            <div className="font-mono font-semibold text-gray-700" style={{ fontSize: 9 }}>{item.cost}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-gray-500" style={{ fontSize: 8 }}>Food cost per serving</span>
          <span className="font-bold text-gray-900" style={{ fontSize: 11 }}>$2.18</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded py-1 text-center">
            <div className="font-bold text-emerald-700" style={{ fontSize: 10 }}>18.2%</div>
            <div className="text-emerald-500" style={{ fontSize: 7 }}>of $12 menu price</div>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded py-1 text-center">
            <div className="font-bold text-gray-700" style={{ fontSize: 10 }}>$9.82</div>
            <div className="text-gray-400" style={{ fontSize: 7 }}>gross margin</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ROI Math Table section ────────────────────────────────────────────────────
function RoiMathSection() {
  const { t } = useLanguage();
  const home = t.home;
  return (
    <section className="py-20 bg-gray-950" id="roi-math" data-testid="roi-math-section">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400 mb-3">
            {home.roiMathLabel}
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            {home.roiMathTitle}
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-base">
            {home.roiMathSubtitle}
          </p>
        </div>

        <div className="rounded-xl overflow-hidden border border-gray-800">
          <div className="grid grid-cols-4 bg-gray-800">
            <div className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{home.roiMathHeaders.sales}</div>
            <div className="px-4 py-3 text-xs font-semibold text-orange-400 uppercase tracking-wide text-right">{home.roiMathHeaders.half}</div>
            <div className="px-4 py-3 text-xs font-semibold text-orange-400 uppercase tracking-wide text-right">{home.roiMathHeaders.one}</div>
            <div className="px-4 py-3 text-xs font-semibold text-orange-400 uppercase tracking-wide text-right">{home.roiMathHeaders.two}</div>
          </div>
          {home.roiMathRows.map((row, i) => (
            <div
              key={i}
              className={`grid grid-cols-4 border-t border-gray-800 ${i === 1 ? "bg-gray-800/60" : "bg-gray-900"}`}
            >
              <div className="px-4 py-4 text-sm font-semibold text-white">{row.sales}</div>
              <div className="px-4 py-4 text-sm text-emerald-400 font-mono text-right">{row.half}</div>
              <div className="px-4 py-4 text-sm text-emerald-400 font-mono font-semibold text-right">{row.one}</div>
              <div className="px-4 py-4 text-sm text-emerald-400 font-mono font-bold text-right">{row.two}</div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500 italic">{home.roiMathNote}</p>
      </div>
    </section>
  );
}

// ── Mobile showcase section ───────────────────────────────────────────────────
function MobileShowcase() {
  const { t } = useLanguage();
  const home = t.home;
  return (
    <section className="py-20 bg-gray-950 overflow-hidden" id="mobile-showcase">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400 mb-3">
            {home.menuScanLabel}
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Every workflow feeds food cost insight
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-base">
            Count inventory, scan invoices, cost recipes — each one closing the loop between what you spend and what you should spend. No app store needed.
          </p>
        </div>
        <div className="flex gap-10 justify-center items-start overflow-x-auto pb-4 px-4" style={{ scrollSnapType: "x mandatory" }}>
          <div style={{ scrollSnapAlign: "center" }}>
            <PhoneFrame label="Actual vs. theoretical — find the variance">
              <ScreenInventoryCount />
            </PhoneFrame>
          </div>
          <div style={{ scrollSnapAlign: "center" }}>
            <PhoneFrame label="Catch vendor price changes automatically">
              <ScreenInvoiceScan />
            </PhoneFrame>
          </div>
          <div style={{ scrollSnapAlign: "center" }}>
            <PhoneFrame label="True plate cost — always current">
              <ScreenRecipeCosting />
            </PhoneFrame>
          </div>
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto text-center">
          {[
            { Icon: TrendingUp, label: "Food cost visibility", sub: "Every scan feeds clearer cost insight" },
            { Icon: RefreshCw, label: "Always current", sub: "Vendor price changes update recipes instantly" },
            { Icon: ClipboardList, label: "Actual vs. theoretical", sub: "Counts feed directly into variance reports" },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
                <item.Icon className="h-4 w-4 text-orange-400" />
              </div>
              <div className="font-semibold text-white text-sm">{item.label}</div>
              <div className="text-gray-500 text-xs">{item.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Menu Scan Highlight section ───────────────────────────────────────────────
function MenuScanHighlight() {
  const { t } = useLanguage();
  const home = t.home;
  return (
    <section className="py-20 bg-white" id="menu-scan" data-testid="menu-scan-section">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row gap-12 items-center">
          <div className="flex-1">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-500 mb-3">
              {home.menuScanLabel}
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
              {home.menuScanTitle}
            </h2>
            <p className="text-gray-500 text-base leading-relaxed mb-8">
              {home.menuScanSubtitle}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {home.menuScanCallouts.map((callout) => (
                <div key={callout} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700">{callout}</span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <a href={appLink("/signup")}>
                <Button
                  className="bg-orange-500 text-white border-0 gap-1"
                  data-testid="btn-menu-scan-cta"
                >
                  Scan Your Menu <ChevronRight className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </div>
          <div className="flex-1 w-full">
            <div className="bg-gray-900 rounded-xl p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Camera className="h-4 w-4 text-orange-400" />
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">Menu scan complete</div>
                  <div className="text-gray-400 text-xs">Brian's Bistro — 3 sections, 42 items</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { section: "Appetizers", count: "8 items", avg: "avg $12.50" },
                  { section: "Entrees", count: "18 items", avg: "avg $24.00" },
                  { section: "Desserts", count: "6 items", avg: "avg $9.75" },
                  { section: "Beverages", count: "10 items", avg: "avg $6.50" },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                      <span className="text-white text-sm font-medium">{row.section}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs">{row.count}</span>
                      <span className="text-emerald-400 text-xs font-mono">{row.avg}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
                <span className="text-gray-400 text-xs">42 items ready for recipe build-out</span>
                <span className="text-orange-400 text-xs font-semibold">Starting map created</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center" data-testid="hero-section">
        <HeroBackground />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <span className="inline-block bg-orange-500/20 text-orange-300 text-xs font-semibold uppercase tracking-widest px-4 py-1 rounded-full mb-6 border border-orange-500/30">
            {home.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold text-white leading-tight mb-6">
            {home.headline1}<br />
            <span className="text-orange-400">{home.headline2}</span>
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
                className="text-white border-white/50 bg-white/10 backdrop-blur-sm text-base px-8"
                data-testid="btn-hero-pricing"
              >
                {home.ctaPricing}
              </Button>
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-400">{home.trialNote}</p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="py-12 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {home.stats.map((s, i) => (
              <div key={i} data-testid={`stat-item-${i}`}>
                <p className="text-3xl font-extrabold text-orange-400 mb-1">{s.value}</p>
                <p className="text-sm text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI Math Table */}
      <RoiMathSection />

      {/* Mobile Showcase */}
      <MobileShowcase />

      {/* Menu Scan Highlight */}
      <MenuScanHighlight />

      {/* Features grid */}
      <section className="py-20 bg-gray-50" id="features">
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
                  className="p-6 rounded-lg border border-gray-100 bg-white hover-elevate"
                  data-testid={`feature-card-${i}`}
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

      {/* ROI / Labor savings — reframed as secondary payoff */}
      <section className="py-20 bg-gray-900" id="roi" data-testid="roi-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400 mb-3">
              {home.roiLabel}
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              {home.roiTitle}
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {home.roiSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {home.roiItems.map((item, i) => {
              const Icon = ROI_ICONS[i];
              return (
                <div key={i} className="bg-gray-800 rounded-xl p-6" data-testid={`roi-item-${i}`}>
                  <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5 text-orange-400" />
                  </div>
                  <h3 className="text-white font-semibold mb-2">{item.task}</h3>
                  <p className="text-xs text-gray-500 mb-3 italic">Manual: {item.manual}</p>
                  <p className="text-sm text-orange-300 font-medium mb-3">{item.saved}</p>
                  <p className="text-sm text-gray-400 leading-relaxed">{item.how}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-6 text-center">
            <p className="text-orange-300 font-semibold text-lg mb-2">{home.roiTotal}</p>
            <p className="text-gray-400 text-sm">{home.roiNote}</p>
          </div>
        </div>
      </section>

      {/* Recipe costing */}
      <section className="py-20 bg-gray-50" id="recipe-costing" data-testid="recipe-costing-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-12 items-center">
            <div className="flex-1">
              <SectionHeading
                label={home.recipeLabel}
                title={home.recipeTitle}
                subtitle={home.recipeSubtitle}
                align="left"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-6 mt-6">
                {home.recipeSteps.map((step, i) => {
                  const Icon = RECIPE_ICONS[i];
                  return (
                    <div
                      key={step.num}
                      className="flex items-start gap-4"
                      data-testid={`recipe-step-${step.num}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Icon className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-1">
                          {home.stepLabel} {step.num}
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 mb-1">{step.title}</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-8">
                <p className="text-gray-500 mb-4 text-sm">{home.recipeNote}</p>
                <Link href={lang === "es" ? "/es/pricing" : "/pricing"}>
                  <Button variant="outline" className="gap-1" data-testid="btn-recipe-pricing">
                    {home.seePlans} <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="flex-1 w-full">
              <div className="rounded-xl overflow-hidden shadow-xl">
                <img
                  src="/screenshots/recipe-card-vs-app.png"
                  alt="FnB Cost Pro recipe costing — photograph a handwritten recipe card and get exact food costs instantly"
                  className="w-full h-auto block"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — Guided Launch Journey */}
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

      {/* Final CTA */}
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
