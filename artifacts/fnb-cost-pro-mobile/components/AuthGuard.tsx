import React, { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const onLoginScreen = segments[0] === 'login';

    if (!token && !onLoginScreen) {
      router.replace('/login');
    } else if (token && onLoginScreen) {
      router.replace('/');
    }
  }, [token, isLoading, segments, router]);

  if (isLoading) {
    return null; // or Splash/Loading screen
  }

  // Do not mount the protected screen tree for a brief moment before the
  // redirect; otherwise React Query fires mobile API requests unauthenticated.
  // Expo Router has no segments during its initial layout pass, so preserve
  // that pass rather than returning a permanent blank screen in web preview.
  if (!token && segments.length > 0 && segments[0] !== 'login') return null;

  return <>{children}</>;
}