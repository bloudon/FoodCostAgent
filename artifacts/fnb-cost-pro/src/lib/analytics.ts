/**
 * Marketing funnel analytics — thin typed wrapper around GA4 (gtag).
 *
 * - Only sends real events on fnbcostpro.com / www.fnbcostpro.com
 * - Logs to console.debug on all other origins (dev, staging, Replit preview)
 * - Every event receives standard base properties: page, language, timestamp
 * - Can be swapped for any provider by changing the `send` function below
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const MARKETING_DOMAINS = ["fnbcostpro.com", "www.fnbcostpro.com"];

function isMarketingDomain(): boolean {
  return (
    typeof window !== "undefined" &&
    MARKETING_DOMAINS.includes(window.location.hostname)
  );
}

type Props = Record<string, string | number | boolean | undefined>;

function send(eventName: string, payload: Props): void {
  if (!isMarketingDomain()) {
    console.debug(`[analytics] ${eventName}`, payload);
    return;
  }
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, payload as GtagEventParams);
}

/**
 * Fire a named event with optional extra properties.
 * Automatically adds: page, timestamp.
 * You should pass `language` in every call so sessions are distinguishable.
 */
export function track(eventName: string, props?: Props): void {
  const base: Props = {
    page: typeof window !== "undefined" ? window.location.pathname : "",
    timestamp: new Date().toISOString(),
  };
  send(eventName, { ...base, ...props });
}

/**
 * Fire an event exactly once when the component mounts (or when the route
 * changes). Idempotent within a single pathname — won't double-fire on
 * re-renders, but will re-fire if the user navigates to the same page again.
 */
export function usePageEvent(eventName: string, props?: Props): void {
  const [location] = useLocation();
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (firedRef.current === location) return;
    firedRef.current = location;
    track(eventName, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
}

/**
 * Fire an event once when the referenced element first scrolls into the
 * viewport (≥15% visible). Disconnects the observer after firing.
 */
export function useInViewEvent(
  ref: React.RefObject<Element>,
  eventName: string,
  props?: Props,
): void {
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || firedRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !firedRef.current) {
          firedRef.current = true;
          track(eventName, props);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
