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

export function VendorLogo({ website, name, size = 32, className = "" }: VendorLogoProps) {
  const [failed, setFailed] = useState(false);
  const domain = extractDomain(website);
  const initial = name.charAt(0).toUpperCase();

  if (!domain || failed) {
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
      src={`https://logo.clearbit.com/${domain}`}
      alt=""
      className={`shrink-0 rounded-md object-contain bg-white ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      aria-hidden="true"
    />
  );
}
