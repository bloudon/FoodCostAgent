import "@/i18n";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Pressable } from "react-native";
import { Path, Polyline, Svg } from "react-native-svg";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ScanProvider } from "@/context/ScanContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const HEADER_STYLE = {
  backgroundColor: "#1B4332",
} as const;

const HEADER_OPTIONS = {
  headerStyle: HEADER_STYLE,
  headerTintColor: "#FFFFFF",
  headerTitleStyle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: "#FFFFFF",
  } as const,
  headerBackTitle: "Back",
} as const;

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();

  const isOnLoginScreen = segments[0] === "login";

  if (isLoading) return null;

  if (!user && !isOnLoginScreen) {
    return <Redirect href="/login" />;
  }

  if (user && isOnLoginScreen) {
    return <Redirect href="/" />;
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="camera"
          options={{ title: "Scan Inventory", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="results"
          options={{ title: "Scan Results", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="web-section"
          options={{ title: "", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "Settings", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="session/items"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="session/count/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="voice-waste"
          options={{ title: "Voice Waste Report", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="waste-web"
          options={{ title: "Waste Entry", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="session/count-web"
          options={{ title: "Count Items", ...HEADER_OPTIONS }}
        />
        <Stack.Screen
          name="inventory-web"
          options={{
            title: "Inventory",
            ...HEADER_OPTIONS,
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace("/(tabs)")}
                hitSlop={10}
                style={{ paddingHorizontal: 4, paddingVertical: 4 }}
              >
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                    stroke="#fff"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Polyline
                    points="9 22 9 12 15 12 15 22"
                    stroke="#fff"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            ),
          }}
        />
      </Stack>
    </AuthGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <ScanProvider>
                  <RootLayoutNav />
                </ScanProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
