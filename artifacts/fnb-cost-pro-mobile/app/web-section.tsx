import { Stack, useLocalSearchParams } from "expo-router";

import WebSection from "@/components/WebSection";

/**
 * Generic wrapped main-app page opened from the "More" tab
 * (e.g. Inventory Items, Shelf Scans, Stores).
 */
export default function WebSectionScreen() {
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>();
  // Only allow same-app relative paths; anything else falls back to the dashboard.
  const safePath = typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
    ? path
    : "/dashboard/mobile";
  const label = typeof title === "string" && title ? title : "Page";

  return (
    <>
      <Stack.Screen options={{ title: label }} />
      <WebSection path={safePath} label={label} />
    </>
  );
}
