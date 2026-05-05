import { useEffect } from 'react';
import { useLocation } from 'wouter';

const GA4_EN_ID = 'G-HKQMSB7LYR';
const GA4_ES_ID = import.meta.env.VITE_GA4_ES_ID as string | undefined;

const MARKETING_DOMAINS = ['fnbcostpro.com', 'www.fnbcostpro.com'];

/**
 * Returns true only on the production marketing domains.
 * Deliberately excludes VITE_SHOW_WEBSITE so analytics never fires
 * on app.fnbcostpro.com, localhost, or any Replit dev hostname.
 */
function isMarketingDomain(): boolean {
  return MARKETING_DOMAINS.includes(window.location.hostname);
}

function sendPageview(measurementId: string, path: string): void {
  if (typeof window.gtag !== 'function') return;
  window.gtag('config', measurementId, {
    page_path: path,
    page_location: window.location.href,
  });
}

/**
 * Fires GA4 pageview events on every client-side navigation.
 *
 * - The gtag.js script and window.gtag shim are bootstrapped in index.html;
 *   this hook only issues gtag('config', ...) calls.
 * - Primary stream (G-HKQMSB7LYR) fires on all marketing pages.
 * - Spanish stream (VITE_GA4_ES_ID) fires additionally on /es and /es/* routes.
 * - Strict hostname guard: only fires on fnbcostpro.com / www.fnbcostpro.com.
 *   Never fires on app.fnbcostpro.com, localhost, or Replit dev hostnames.
 *
 * Call once inside WebsiteRouter.
 */
export function useGa4(): void {
  const [location] = useLocation();

  useEffect(() => {
    if (!isMarketingDomain()) return;

    const isSpanish = location === '/es' || location.startsWith('/es/');

    sendPageview(GA4_EN_ID, location);

    if (isSpanish && GA4_ES_ID) {
      sendPageview(GA4_ES_ID, location);
    }
  }, [location]);
}
