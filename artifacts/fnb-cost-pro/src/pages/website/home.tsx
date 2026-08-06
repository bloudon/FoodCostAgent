/**
 * Homepage — Chef-driven culinary operations positioning
 *
 * Sections:
 *  1. Hero — badge + headline + subheadline + primary/secondary CTA
 *  2. Workflow strip — Capture → Cost → Compare → Predict
 *  3. Four-input showcase — what the platform can capture
 *  4. Purchasing Intelligence
 *  5. Multi-location
 *  6. Guided onboarding (replaces guarantee)
 *  7. Bottom CTA band
 */

import { useState, useEffect, useRef } from "react";
import { track, useInViewEvent } from "@/lib/analytics";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronRight, Camera, FileText, Boxes, QrCode,
  ArrowRight, MapPin, CheckCircle2, ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout, MarketingHead } from "@/components/website/marketing-layout";
import { useLanguage } from "@/lib/language-context";

// ── Background photo slideshow ────────────────────────────────────────────────

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
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/80" />
    </div>
  );
}

const CAPTURE_ICONS = [Camera, FileText, Boxes, QrCode] as const;

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WebsiteHome() {
  const { lang, t } = useLanguage();
  const home = t.home;
  const contactHref = lang === "es" ? "/es/contact" : "/contact";

  const workflowRef = useRef<HTMLElement>(null);
  // @ts-ignore
  useInViewEvent(workflowRef, "workflow_section_viewed", { language: lang });

  return (
    <MarketingLayout>
      <MarketingHead
        title={home.meta.title}
        description={home.meta.description}
        lang={lang}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[90vh] flex items-center" data-testid="hero-section">
        <HeroBackground />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <span className="inline-block bg-white/10 text-white/80 text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full mb-8 border border-white/20 backdrop-blur-sm">
            {home.badge}
          </span>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white leading-[1.05] mb-7 tracking-tight">
            {home.headline}
          </h1>
          <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto mb-10 leading-relaxed font-light">
            {home.subheadline}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href={contactHref}>
              <Button
                size="lg"
                className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
                data-testid="btn-hero-primary"
                onClick={() => track("hero_cta_click", { language: lang })}
              >
                {home.ctaPrimary}
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </Link>
            <a href="#workflow-strip">
              <Button
                size="lg"
                variant="outline"
                className="text-white border-white/50 bg-white/10 backdrop-blur-sm text-base px-8 h-auto py-3"
                data-testid="btn-hero-secondary"
                onClick={() => track("secondary_cta_click", { language: lang })}
              >
                {home.ctaSecondary}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── Workflow strip ────────────────────────────────────────────────── */}
      <section id="workflow-strip" className="py-14 bg-gray-900" data-testid="workflow-strip" ref={workflowRef}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-stretch">
            {home.workflowItems.map((item, i) => (
              <div key={item.step} className="flex flex-1 items-stretch">
                <div
                  className="flex-1 flex flex-col items-center text-center px-6 py-7"
                  data-testid={`workflow-step-${i}`}
                >
                  <div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-1">
                    0{i + 1}
                  </div>
                  <div className="text-base font-extrabold text-white mb-2 uppercase tracking-wide">
                    {item.step}
                  </div>
                  <div className="text-xs text-gray-400 leading-relaxed">{item.phrase}</div>
                </div>
                {i < home.workflowItems.length - 1 && (
                  <div className="hidden sm:flex items-center self-center py-7 text-gray-700">
                    <ArrowRight className="h-4 w-4 flex-shrink-0" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Four-input showcase ───────────────────────────────────────────── */}
      <section className="py-20 bg-white" id="capture" data-testid="capture-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-600 mb-4">
              {home.captureLabel}
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">
              {home.captureTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {home.captureCards.map((card, i) => {
              const Icon = CAPTURE_ICONS[i];
              return (
                <div
                  key={card.input}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-6"
                  data-testid={`capture-card-${i}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5 text-orange-700" />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 mb-4 leading-snug">{card.input}</h3>
                  <ul className="space-y-2.5">
                    {card.outputs.map((out) => (
                      <li key={out} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-gray-600 leading-snug">{out}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <p className="mt-10 text-center text-sm text-gray-500 italic max-w-2xl mx-auto leading-relaxed">
            {home.captureSummary}
          </p>
        </div>
      </section>

      {/* ── Purchasing Intelligence ───────────────────────────────────────── */}
      <section className="py-20 bg-gray-950" id="purchasing" data-testid="purchasing-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-14 items-start">
            <div className="flex-1">
              <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400 mb-4">
                {home.purchasingLabel}
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
                {home.purchasingTitle}
              </h2>
              <p className="text-gray-400 leading-relaxed mb-8 text-base">
                {home.purchasingBody}
              </p>
              <Link href={contactHref}>
                <Button
                  className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                  data-testid="btn-purchasing-cta"
                >
                  {home.purchasingCta}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="flex-1">
              <ul className="divide-y divide-gray-800">
                {home.purchasingBullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3 py-3.5">
                    <ShoppingCart className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Multi-location ────────────────────────────────────────────────── */}
      <section className="py-20 bg-white" id="multi-location" data-testid="multi-location-section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row-reverse gap-14 items-start">
            <div className="flex-1">
              <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-700 mb-4">
                {home.multiLabel}
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-5 leading-tight">
                {home.multiTitle}
              </h2>
              <p className="text-gray-500 leading-relaxed text-base">
                {home.multiBody}
              </p>
            </div>
            <div className="flex-1">
              <ul className="space-y-3">
                {home.multiBullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100"
                  >
                    <MapPin className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 text-sm leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Guided onboarding ─────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-900" id="onboarding" data-testid="onboarding-section">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-10 leading-tight">
            {home.onboardingTitle}
          </h2>
          <ul className="space-y-3 text-left max-w-xl mx-auto mb-12">
            {home.onboardingItems.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-gray-800 rounded-xl p-4">
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-white/50">
                  {i + 1}
                </div>
                <span className="text-gray-300 text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-white text-gray-900 hover:bg-gray-100 border-0 text-base px-8 h-auto py-3 font-semibold"
              data-testid="btn-onboarding-cta"
            >
              {home.onboardingCta}
              <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-50" id="cta-bottom">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
            {home.ctaBottomTitle}
          </h2>
          <p className="text-lg text-gray-500 mb-8 leading-relaxed">
            {home.ctaBottomBody}
          </p>
          <Link href={contactHref}>
            <Button
              size="lg"
              className="bg-orange-500 hover:bg-orange-600 text-white border-0 text-base px-8 h-auto py-3"
              data-testid="btn-cta-bottom"
            >
              {home.ctaBottomButton}
              <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
