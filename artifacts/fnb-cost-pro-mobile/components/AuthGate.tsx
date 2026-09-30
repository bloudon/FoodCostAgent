import { router, useSegments } from "expo-router";
import React, { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

export function getAuthRedirect(
  user: unknown,
  isLoading: boolean,
  firstSegment: string | undefined,
): "/" | "/login" | null {
  if (isLoading) return null;

  const isOnLoginScreen = firstSegment === "login";
  if (!user && !isOnLoginScreen) return "/login";
  if (user && isOnLoginScreen) return "/";
  return null;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const redirectTo = getAuthRedirect(user, isLoading, segments[0]);

  useEffect(() => {
    if (redirectTo) {
      router.replace(redirectTo);
    }
  }, [redirectTo]);

  if (isLoading || redirectTo) return null;
  return <>{children}</>;
}