import { useEffect } from 'react';
import { useLocation } from 'wouter';

const GA4_EN_ID = 'G-HKQMSB7LYR';
const GA4_ES_ID = import.meta.env.VITE_GA4_ES_ID as string | undefined;

const WEBSITE_DOMAINS = ['fnbcostpro.com', 'www.fnbcostpro.com'];

function isWebsiteDomain(): boolean {
  return (
    WEBSITE_DOMAINS.includes(window.location.hostname) ||
    import.meta.env.VITE_SHOW_WEBSITE === 'true'
  );
}

let scriptInjected = false;

function injectGtagScript(): void {
  if (scriptInjected) return;
  scriptInjected = true;

  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).gtag = function gtag() {
    (window as any).dataLayer.push(arguments);
  };
  (window as any).gtag('js', new Date());

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_EN_ID}`;
  document.head.appendChild(script);
}

function sendPageview(measurementId: string, path: string): void {
  if (typeof (window as any).gtag !== 'function') return;
  (window as any).gtag('config', measurementId, {
    page_path: path,
    page_location: window.location.href,
  });
}

/**
 * Fires GA4 pageview events on every client-side navigation.
 * - Primary stream (G-HKQMSB7LYR) fires on all marketing pages.
 * - Spanish stream (VITE_GA4_ES_ID) fires additionally on /es and /es/* routes.
 * - No-op on non-marketing hostnames (app.fnbcostpro.com, localhost, Replit dev).
 *
 * Call this hook once inside WebsiteRouter.
 */
export function useGa4(): void {
  const [location] = useLocation();

  useEffect(() => {
    if (!isWebsiteDomain()) return;

    injectGtagScript();

    const isSpanish = location === '/es' || location.startsWith('/es/');

    sendPageview(GA4_EN_ID, location);

    if (isSpanish && GA4_ES_ID) {
      sendPageview(GA4_ES_ID, location);
    }
  }, [location]);
}
