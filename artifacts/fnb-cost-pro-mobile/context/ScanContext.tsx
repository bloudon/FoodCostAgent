import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

function getDefaultUrl(): string {
  if (__DEV__ && Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  // On native dev builds, point to the local Replit dev domain so testers
  // can exercise the full pipeline (including voice-waste) without needing
  // the endpoints deployed to production first.
  // Note: consumers append "/api/mobile/..." so this must NOT include "/api".
  if (__DEV__ && Platform.OS !== "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}`;
  }
  return "https://app.fnbcostpro.com";
}

const PROD_URL = "https://app.fnbcostpro.com";
const DEFAULT_URL = getDefaultUrl();
const URL_STORAGE_KEY = "fnb_backend_url";
const URL_STORAGE_KEY_LEGACY = "@fnb_backend_url";
const LOCATION_STORAGE_KEY = "fnb_selected_location_id";

export type ScanResult = {
  success: boolean;
  statusCode?: number;
  data?: unknown;
  error?: string;
} | null;

interface ScanContextValue {
  backendUrl: string;
  setBackendUrl: (url: string) => Promise<void>;
  lastResult: ScanResult;
  setLastResult: (result: ScanResult) => void;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  selectedLocationId: string | null;
  setSelectedLocationId: (id: string | null) => Promise<void>;
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  selectedItemName: string | null;
  setSelectedItemName: (name: string | null) => void;
  selectedItemCurrentCount: number | null;
  setSelectedItemCurrentCount: (count: number | null) => void;
  selectedItemIsCatchWeight: boolean;
  setSelectedItemIsCatchWeight: (v: boolean) => void;
  scanCategoryId: string | null;
  setScanCategoryId: (id: string | null) => void;
  scanLocationId: string | null;
  setScanLocationId: (id: string | null) => void;
  lastAppliedItemId: string | null;
  lastAppliedCount: number | null;
  setLastApplied: (itemId: string | null, count: number | null) => void;
  catchWeightEntries: number[];
  addCatchWeightEntry: (weight: number) => void;
  removeCatchWeightEntry: (index: number) => void;
  clearCatchWeightEntries: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_URL);
  const [lastResult, setLastResult] = useState<ScanResult>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [selectedItemCurrentCount, setSelectedItemCurrentCount] = useState<number | null>(null);
  const [selectedItemIsCatchWeight, setSelectedItemIsCatchWeight] = useState(false);
  const [scanCategoryId, setScanCategoryId] = useState<string | null>(null);
  const [scanLocationId, setScanLocationId] = useState<string | null>(null);
  const [lastAppliedItemId, setLastAppliedItemId] = useState<string | null>(null);
  const [lastAppliedCount, setLastAppliedCount] = useState<number | null>(null);
  const [catchWeightEntries, setCatchWeightEntries] = useState<number[]>([]);

  const setLastApplied = (itemId: string | null, count: number | null) => {
    setLastAppliedItemId(itemId);
    setLastAppliedCount(count);
  };

  const addCatchWeightEntry = (weight: number) => {
    setCatchWeightEntries((prev) => [...prev, weight]);
  };

  const removeCatchWeightEntry = (index: number) => {
    setCatchWeightEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const clearCatchWeightEntries = () => {
    setCatchWeightEntries([]);
  };

  useEffect(() => {
    async function loadPersistedValues() {
      try {
        const stored = await AsyncStorage.getItem(URL_STORAGE_KEY);
        if (stored) {
          if (__DEV__ && stored === PROD_URL) {
            // In dev mode, ignore a previously saved production URL so the
            // local dev server is used instead of accidentally hitting prod.
          } else {
            setBackendUrlState(stored);
          }
        } else {
          const legacy = await AsyncStorage.getItem(URL_STORAGE_KEY_LEGACY);
          if (legacy) {
            if (!(__DEV__ && legacy === PROD_URL)) {
              setBackendUrlState(legacy);
              await AsyncStorage.setItem(URL_STORAGE_KEY, legacy);
            }
          }
        }
      } catch {
        // fall back to default
      }

      try {
        const storedLocation = await AsyncStorage.getItem(LOCATION_STORAGE_KEY);
        if (storedLocation) {
          setSelectedLocationIdState(storedLocation);
        }
      } catch {
        // fall back to null
      }
    }
    loadPersistedValues();
  }, []);

  const setBackendUrl = async (url: string) => {
    const normalized = url.trim().replace(/\/$/, "");
    await AsyncStorage.setItem(URL_STORAGE_KEY, normalized);
    setBackendUrlState(normalized);
  };

  const setSelectedLocationId = async (id: string | null) => {
    try {
      if (id === null) {
        await AsyncStorage.removeItem(LOCATION_STORAGE_KEY);
      } else {
        await AsyncStorage.setItem(LOCATION_STORAGE_KEY, id);
      }
    } catch {
      // best-effort
    }
    setSelectedLocationIdState(id);
  };

  return (
    <ScanContext.Provider
      value={{
        backendUrl,
        setBackendUrl,
        lastResult,
        setLastResult,
        selectedSessionId,
        setSelectedSessionId,
        selectedLocationId,
        setSelectedLocationId,
        selectedItemId,
        setSelectedItemId,
        selectedItemName,
        setSelectedItemName,
        selectedItemCurrentCount,
        setSelectedItemCurrentCount,
        selectedItemIsCatchWeight,
        setSelectedItemIsCatchWeight,
        scanCategoryId,
        setScanCategoryId,
        scanLocationId,
        setScanLocationId,
        lastAppliedItemId,
        lastAppliedCount,
        setLastApplied,
        catchWeightEntries,
        addCatchWeightEntry,
        removeCatchWeightEntry,
        clearCatchWeightEntries,
      }}
    >
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used within ScanProvider");
  return ctx;
}
