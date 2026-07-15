import { useState } from "react";

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface VendorLogoProps {
  website: string | null;
  name: string;
  size?: number;
  className?: string;
}

const LOGO_SOURCES = [
  (domain: string) => `https://logo.clearbit.com/${domain}`,
  (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
];

export function VendorLogo({ website, name, size = 32, className = "" }: VendorLogoProps) {
  const [attempt, setAttempt] = useState(0);
  const domain = extractDomain(website);
  const initial = name.charAt(0).toUpperCase();

  if (!domain || attempt >= LOGO_SOURCES.length) {
    return (
      <div
        className={`shrink-0 rounded-md bg-muted flex items-center justify-center text-muted-foreground font-semibold select-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
        aria-hidden="true"
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={LOGO_SOURCES[attempt](domain)}
      alt=""
      className={`shrink-0 rounded-md object-contain bg-white ${className}`}
      style={{ width: size, height: size }}
      onError={() => setAttempt((a) => a + 1)}
      aria-hidden="true"
    />
  );
}
