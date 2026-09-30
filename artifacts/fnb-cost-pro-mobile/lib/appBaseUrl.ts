import { Platform } from "react-native";

export const PROD_APP_BASE_URL = "https://app.fnbcostpro.com";

export function resolveAppBaseUrl({
  isDev,
  platform,
  domain,
  webOrigin,
}: {
  isDev: boolean;
  platform: string;
  domain?: string;
  webOrigin?: string;
}): string {
  if (!isDev) return PROD_APP_BASE_URL;

  if (platform === "web") {
    return webOrigin?.replace(/\/+$/, "") || PROD_APP_BASE_URL;
  }

  return domain ? `https://${domain}` : PROD_APP_BASE_URL;
}

export function getAppBaseUrl(): string {
  return resolveAppBaseUrl({
    isDev: __DEV__,
    platform: Platform.OS,
    domain: process.env.EXPO_PUBLIC_DOMAIN,
    webOrigin:
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : undefined,
  });
}