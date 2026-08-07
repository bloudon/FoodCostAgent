import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useScan } from "@/context/ScanContext";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import CatchWeightScanModal from "@/components/CatchWeightScanModal";

type Confidence = "high" | "medium" | "low";

type InventoryItem = {
  name: string;
  value: string;
  confidence: Confidence | null;
};

type ScanItem = {
  name: string;
  qty: number | null;
  unit?: string;
  catchWeight?: boolean;
};

type ApplyMode = "replace" | "add";

type SegmentLine = {
  id: string;
  name: string;
  currentCount: number;
  isCatchWeightCategory?: boolean;
};

type SegmentPendingMatch = {
  lineId: string;
  name: string;
  scanQty: number | null;
  currentCount: number;
  isCatchWeightCategory?: boolean;
  unit?: string;
  catchWeightUnreadable?: boolean;
};

type SegmentApplyResult = {
  applied: Array<{ name: string; qty: number }>;
  unmatched: string[];
  error: string | null;
};

const CONFIDENCE_COLORS: Record<Confidence, { bg: string; text: string }> = {
  high: { bg: "#DCFCE7", text: "#166534" },
  medium: { bg: "#FEF3C7", text: "#92400E" },
  low: { bg: "#FEE2E2", text: "#991B1B" },
};

function formatData(data: unknown): string {
  try {
    if (typeof data === "string") return data;
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function renderInventoryItems(data: unknown): { hasItems: boolean; items: InventoryItem[] } {
  if (!data || typeof data !== "object") return { hasItems: false, items: [] };

  const obj = data as Record<string, unknown>;
  const candidates = [
    obj["items"],
    obj["inventory"],
    obj["results"],
    obj["data"],
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      const items = candidate.slice(0, 20).map((item: unknown): InventoryItem => {
        if (typeof item === "object" && item !== null) {
          const o = item as Record<string, unknown>;
          const name =
            String(o["name"] ?? o["item"] ?? o["product"] ?? o["label"] ?? "Item");
          const count =
            o["count"] ?? o["quantity"] ?? o["qty"] ?? o["amount"] ?? "";
          const unit = o["unit"] ?? o["uom"] ?? "";
          const value = [count, unit].filter(Boolean).join(" ") || "—";
          const raw = o["confidence"];
          const confidence: Confidence | null =
            raw === "high" || raw === "medium" || raw === "low" ? raw : null;
          return { name, value, confidence };
        }
        return { name: String(item), value: "", confidence: null };
      });
      return { hasItems: true, items };
    }
  }

  return { hasItems: false, items: [] };
}

function getFrameCount(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const fc = (data as Record<string, unknown>)["frameCount"];
  return typeof fc === "number" ? fc : null;
}

function getNotes(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const n = (data as Record<string, unknown>)["notes"];
  if (!Array.isArray(n)) return [];
  return n.filter((x): x is string => typeof x === "string");
}

function parseNumericCount(value: string): number | null {
  if (!value || value === "—") return null;
  const match = value.match(/^(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function extractScanItems(data: unknown): ScanItem[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const candidates = [obj["items"], obj["inventory"], obj["results"], obj["data"]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.slice(0, 50).flatMap((item: unknown): ScanItem[] => {
        if (typeof item === "object" && item !== null) {
          const o = item as Record<string, unknown>;
          const name = String(o["name"] ?? o["item"] ?? o["product"] ?? "").trim();
          const rawQty =
            o["estimatedQty"] ?? o["quantity"] ?? o["count"] ?? o["qty"] ?? o["amount"];
          const qty =
            typeof rawQty === "number"
              ? rawQty
              : typeof rawQty === "string"
              ? parseFloat(rawQty)
              : NaN;
          const rawUnit = o["unit"];
          const unit = typeof rawUnit === "string" && rawUnit.trim() ? rawUnit.trim().toLowerCase() : undefined;
          const catchWeight = o["catchWeight"] === true;
          const qtyOrNull: number | null = isNaN(qty) ? null : qty;
          if (name && (qtyOrNull !== null && qtyOrNull >= 0 || catchWeight)) {
            return [{ name, qty: qtyOrNull, unit, catchWeight }];
          }
        }
        return [];
      });
    }
  }
  return [];
}

function extractLines(json: unknown): SegmentLine[] {
  let raws: Record<string, unknown>[] = [];
  if (Array.isArray(json)) {
    raws = json as Record<string, unknown>[];
  } else if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      raws = obj.items as Record<string, unknown>[];
    } else if (Array.isArray(obj.data)) {
      raws = obj.data as Record<string, unknown>[];
    } else if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      const inner = obj.data as Record<string, unknown>;
      if (Array.isArray(inner.items)) raws = inner.items as Record<string, unknown>[];
    }
  }
  return raws
    .map((raw) => {
      const rawQty = raw.quantity ?? raw.currentCount ?? raw.current_count ?? raw.count ?? 0;
      const currentCount =
        typeof rawQty === "number" ? rawQty :
        typeof rawQty === "string" ? parseFloat(rawQty) || 0 : 0;
      return {
        id: String(raw.id ?? raw.inventoryItemId ?? raw.inventory_item_id ?? ""),
        name: String(raw.name ?? "").trim(),
        currentCount,
        isCatchWeightCategory: !!(raw.isCatchWeightCategory ?? raw.is_catch_weight_category ?? raw.isTareWeightCategory ?? raw.is_tare_weight_category),
      };
    })
    .filter((l) => l.id && l.name);
}

// Overlap coefficient: intersection / min(|A|, |B|).
// Unlike Jaccard, this is not penalised when one set is much larger than the
// other, so "Boneless Breast" (2 words) correctly matches "FP ABF Chicken
// Breast" (4 words): 1 shared word / min(2,4) = 0.50.
function wordOverlapScore(a: string, b: string): number {
  // Strip packaging noise tokens (numbers, "pack", "lb", "lbs", "oz", "kg")
  // before scoring so they don't dilute the signal.
  const noise = new Set(["pack", "packs", "lb", "lbs", "oz", "kg", "g", "each", "ea"]);
  const tokenise = (s: string) =>
    new Set(s.split(/\W+/).filter((w) => w.length > 0 && !noise.has(w) && !/^\d+$/.test(w)));
  const wordsA = tokenise(a);
  const wordsB = tokenise(b);
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const smaller = Math.min(wordsA.size, wordsB.size);
  return smaller > 0 ? intersection / smaller : 0;
}

function bestLineMatch(aiName: string, lines: SegmentLine[]): SegmentLine | null {
  const ai = aiName.toLowerCase();
  // 1. Exact match
  const exact = lines.find((l) => l.name.toLowerCase() === ai);
  if (exact) return exact;
  // 2. AI name contains inventory name as substring
  const aiContains = lines.find((l) => ai.includes(l.name.toLowerCase()));
  if (aiContains) return aiContains;
  // 3. Inventory name contains AI name as substring
  const lineContains = lines.find((l) => l.name.toLowerCase().includes(ai));
  if (lineContains) return lineContains;
  // 4. Word-overlap (overlap coefficient ≥ 0.40) — handles partial label
  //    names. "Boneless Breast" vs "FP ABF Chicken Breast":
  //    1 shared word / min(2,4) = 0.50 ≥ 0.40 → match.
  let best: { line: SegmentLine; score: number } | null = null;
  for (const l of lines) {
    const score = wordOverlapScore(ai, l.name.toLowerCase());
    if (score >= 0.4 && (!best || score > best.score)) {
      best = { line: l, score };
    }
  }
  if (best) return best.line;
  return null;
}

function parseCatchWeight(data: unknown): number | null {
  if (data == null || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const netWeightRaw = obj["netWeight"];
  const netWeightN =
    typeof netWeightRaw === "number"
      ? netWeightRaw
      : typeof netWeightRaw === "string"
      ? parseFloat(netWeightRaw)
      : NaN;
  if (!isNaN(netWeightN) && netWeightN > 0) return Math.round(netWeightN * 1000) / 1000;
  const candidates = [obj["items"], obj["inventory"], obj["results"], obj["data"]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      for (const element of candidate) {
        if (element && typeof element === "object") {
          const item = element as Record<string, unknown>;
          const raw = item["weight"] ?? item["qty"] ?? item["quantity"] ?? item["count"] ?? item["amount"];
          const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
          if (!isNaN(n) && n > 0) return Math.round(n * 1000) / 1000;
        }
      }
    }
  }
  const topRaw = obj["weight"] ?? obj["qty"] ?? obj["quantity"] ?? obj["count"];
  const topN = typeof topRaw === "number" ? topRaw : typeof topRaw === "string" ? parseFloat(topRaw) : NaN;
  if (!isNaN(topN) && topN > 0) return Math.round(topN * 1000) / 1000;
  return null;
}

function parseCatchWeightConfidence(data: unknown): Confidence | null {
  if (data == null || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>)["confidence"];
  return raw === "high" || raw === "medium" || raw === "low" ? raw : null;
}

function parseCatchWeightUnit(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>)["weightUnit"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export default function ResultsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const {
    lastResult,
    setLastResult,
    selectedItemId,
    setSelectedItemId,
    selectedItemName,
    setSelectedItemName,
    selectedItemCurrentCount,
    selectedItemIsCatchWeight,
    selectedSessionId,
    backendUrl,
    scanCategoryId,
    scanLocationId,
    setLastApplied,
    catchWeightEntries,
    addCatchWeightEntry,
    removeCatchWeightEntry,
    clearCatchWeightEntries,
    setSelectedItemIsCatchWeight,
  } = useScan();

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyCountStr, setApplyCountStr] = useState("0");
  const [applyMode, setApplyMode] = useState<ApplyMode>("add");
  const appliedItemNameRef = useRef<string | null>(null);
  const catchWeightAutoAdded = useRef(false);
  const [lowConfidenceWeight, setLowConfidenceWeight] = useState<{ weight: number; unit: string | null } | null>(null);

  const [segmentFetching, setSegmentFetching] = useState(false);
  const [segmentFetchError, setSegmentFetchError] = useState<string | null>(null);
  const [segmentPending, setSegmentPending] = useState<SegmentPendingMatch[] | null>(null);
  const [segmentUnmatched, setSegmentUnmatched] = useState<string[]>([]);
  const [segmentMode, setSegmentMode] = useState<ApplyMode>("add");
  const [segmentApplying, setSegmentApplying] = useState(false);
  const [segmentResult, setSegmentResult] = useState<SegmentApplyResult | null>(null);
  const [skippedUnreliableIds, setSkippedUnreliableIds] = useState<Set<string>>(new Set());
  const [catchWeightOverrides, setCatchWeightOverrides] = useState<Map<string, string>>(new Map());
  const [catchWeightInputs, setCatchWeightInputs] = useState<Map<string, string>>(new Map());
  const [cwScanTarget, setCwScanTarget] = useState<{ lineId: string; name: string } | null>(null);
  const segmentFetchAttempted = useRef(false);

  useEffect(() => {
    if (lastResult?.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [lastResult]);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const isCatchWeightItem = !!(selectedItemId && selectedItemIsCatchWeight && selectedSessionId);

  const isSegmentScan =
    !selectedItemId &&
    !!selectedSessionId;

  const doSegmentFetch = useCallback(async () => {
    const scanData = lastResult?.data;
    if (!selectedSessionId || !scanData) return;
    setSegmentFetching(true);
    setSegmentFetchError(null);
    try {
      const scanItems = extractScanItems(scanData);
      if (!scanItems.length) {
        setSegmentFetchError("No countable items found in scan response.");
        return;
      }
      const token = await getToken();
      const params = new URLSearchParams();
      if (scanCategoryId) params.set("categoryId", scanCategoryId);
      else if (scanLocationId) params.set("locationId", scanLocationId);
      const invUrl = `${backendUrl}/api/mobile/sessions/${selectedSessionId}/inventory?${params}`;
      const invRes = await fetch(invUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!invRes.ok) {
        setSegmentFetchError(`Could not load inventory lines. (${invRes.status})`);
        return;
      }
      const invJson = (await invRes.json()) as unknown;
      const lines = extractLines(invJson);
      const pending: SegmentPendingMatch[] = [];
      const unmatched: string[] = [];
      for (const scanItem of scanItems) {
        const line = bestLineMatch(scanItem.name, lines);
        if (line) {
          const isCW = !!line.isCatchWeightCategory;
          // Sweep scan is for identification only — never trust GPT's weight
          // output for catch-weight proteins. Always route to manual entry.
          const catchWeightUnreadable = isCW;
          pending.push({
            lineId: line.id,
            name: line.name,
            scanQty: scanItem.qty,
            currentCount: line.currentCount,
            isCatchWeightCategory: isCW,
            unit: scanItem.unit,
            catchWeightUnreadable,
          });
        } else {
          unmatched.push(scanItem.name);
        }
      }
      setSkippedUnreliableIds(new Set());
      setCatchWeightOverrides(new Map());
      setCatchWeightInputs(new Map());
      setSegmentPending(pending);
      setSegmentUnmatched(unmatched);
    } catch {
      setSegmentFetchError("Network error loading inventory.");
    } finally {
      setSegmentFetching(false);
    }
  }, [backendUrl, getToken, selectedSessionId, scanCategoryId, scanLocationId, lastResult]);

  const doSegmentConfirm = useCallback(async () => {
    if (!segmentPending || !selectedSessionId) return;
    setSegmentApplying(true);
    const saveable = segmentPending.filter(
      (m) => !m.catchWeightUnreadable || catchWeightOverrides.has(m.lineId)
    );
    const result: SegmentApplyResult = { applied: [], unmatched: [...segmentUnmatched], error: null };
    try {
      const token = await getToken();
      const body = {
        lines: saveable.map((match) => {
          const overrideStr = catchWeightOverrides.get(match.lineId);
          const qty = overrideStr !== undefined ? parseFloat(overrideStr) : (match.scanQty ?? 0);
          return { lineId: match.lineId, qty };
        }),
        mode: segmentMode === "add" ? "add" : "set",
      };
      const applyRes = await fetch(
        `${backendUrl}/api/mobile/sessions/${selectedSessionId}/apply-scan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }
      );
      if (applyRes.ok) {
        const applyData = (await applyRes.json()) as {
          updated: number;
          lines: Array<{ lineId: string; newQty: number }>;
        };
        const updatedIds = new Set(applyData.lines.map((l) => l.lineId));
        for (const match of saveable) {
          if (updatedIds.has(match.lineId)) {
            const newQty = applyData.lines.find((l) => l.lineId === match.lineId)?.newQty ?? match.scanQty ?? 0;
            result.applied.push({ name: match.name, qty: newQty });
          } else {
            result.unmatched.push(match.name);
          }
        }
        if (result.applied.length > 0) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        const status = applyRes.status;
        if (status === 403) {
          result.error = "Session is locked. Counts could not be saved.";
        } else if (status === 404) {
          result.error = "Session not found.";
        } else {
          result.error = `Failed to apply counts. (${status})`;
        }
        result.unmatched = saveable.map((m) => m.name);
      }
    } catch {
      result.error = "Network error while applying counts.";
    } finally {
      setSegmentApplying(false);
      setSegmentResult(result);
      setSegmentPending(null);
      const delay = result.applied.length > 0 ? 1500 : 2500;
      setTimeout(() => {
        router.back();
        setTimeout(() => router.back(), 320);
      }, delay);
    }
  }, [backendUrl, getToken, selectedSessionId, segmentPending, segmentUnmatched, segmentMode, catchWeightOverrides]);

  useEffect(() => {
    if (
      isSegmentScan &&
      lastResult?.success &&
      !segmentFetchAttempted.current &&
      !segmentFetching &&
      !segmentPending &&
      !segmentFetchError
    ) {
      segmentFetchAttempted.current = true;
      doSegmentFetch();
    }
  }, [isSegmentScan, lastResult, segmentFetching, segmentPending, segmentFetchError, doSegmentFetch]);

  useEffect(() => {
    if (isCatchWeightItem && lastResult?.success && !catchWeightAutoAdded.current) {
      catchWeightAutoAdded.current = true;
      const parsed = parseCatchWeight(lastResult.data);
      if (parsed !== null) {
        const confidence = parseCatchWeightConfidence(lastResult.data);
        if (confidence === "low") {
          const unit = parseCatchWeightUnit(lastResult.data);
          setLowConfidenceWeight({ weight: parsed, unit });
        } else {
          addCatchWeightEntry(parsed);
        }
      }
    }
  }, [isCatchWeightItem, lastResult, addCatchWeightEntry]);

  const catchWeightTotal = catchWeightEntries.reduce((s, v) => s + v, 0);

  const doSaveTotal = useCallback(async () => {
    if (!selectedItemId || !selectedSessionId) return;
    setApplying(true);
    setApplyError(null);
    try {
      const token = await getToken();
      const finalCount = Math.round(catchWeightTotal * 1000) / 1000;
      const res = await fetch(
        `${backendUrl}/api/mobile/sessions/${selectedSessionId}/lines/${selectedItemId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ count: finalCount }),
        }
      );
      if (res.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        appliedItemNameRef.current = selectedItemName;
        setLastApplied(selectedItemId, finalCount);
        clearCatchWeightEntries();
        setApplied(true);
        setSelectedItemId(null);
        setSelectedItemName(null);
        setSelectedItemIsCatchWeight(false);
        setTimeout(() => {
          router.back();
          setTimeout(() => router.back(), 320);
        }, 800);
      } else {
        setApplyError(`Failed to save total. (${res.status})`);
      }
    } catch {
      setApplyError("Network error. Could not save total.");
    } finally {
      setApplying(false);
    }
  }, [
    backendUrl,
    getToken,
    selectedItemId,
    selectedItemName,
    selectedSessionId,
    catchWeightTotal,
    clearCatchWeightEntries,
    setLastApplied,
    setSelectedItemId,
    setSelectedItemName,
    setSelectedItemIsCatchWeight,
  ]);

  const handleScanAnotherCase = () => {
    catchWeightAutoAdded.current = false;
    setLastResult(null);
    router.replace("/camera");
  };

  const handleScanAgain = () => {
    if (isCatchWeightItem) {
      handleScanAnotherCase();
      return;
    }
    segmentFetchAttempted.current = false;
    setSelectedItemIsCatchWeight(false);
    setLastResult(null);
    router.replace("/camera");
  };

  const handleHome = () => {
    setLastResult(null);
    setSelectedItemId(null);
    setSelectedItemName(null);
    setSelectedItemIsCatchWeight(false);
    clearCatchWeightEntries();
    router.replace("/");
  };

  if (!lastResult) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="inbox" size={48} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          {t("results.noScanResults")}
        </Text>
        <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
          {t("results.scanDesc")}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
          ]}
          onPress={handleScanAgain}
        >
          <Feather name="camera" size={18} color={colors.primaryForeground} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            {t("results.startScanning")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const { success, statusCode, data, error } = lastResult;
  const { hasItems, items } = renderInventoryItems(data);
  const frameCount = data !== undefined ? getFrameCount(data) : null;
  const notes = data !== undefined ? getNotes(data) : [];

  const suggestedCount = useMemo(() => {
    if (!selectedItemId || !selectedItemName || !items.length) return null;
    const normalizedName = selectedItemName.toLowerCase().trim();
    const nameMatch = items.find(
      (i) =>
        i.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(i.name.toLowerCase())
    );
    const picked = nameMatch ?? (items.length === 1 ? items[0] : null);
    return picked ? parseNumericCount(picked.value) : null;
  }, [selectedItemId, selectedItemName, items]);

  useEffect(() => {
    if (suggestedCount !== null) {
      setApplyCountStr(String(suggestedCount));
    }
  }, [suggestedCount]);

  const doApply = useCallback(
    async (itemId: string, sessionId: string, scanQty: number, mode: ApplyMode, existingCount: number) => {
      setApplying(true);
      setApplyError(null);
      try {
        const finalCount = mode === "add" ? existingCount + scanQty : scanQty;
        const token = await getToken();
        const res = await fetch(
          `${backendUrl}/api/mobile/sessions/${sessionId}/lines/${itemId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ count: finalCount }),
          }
        );
        if (res.ok) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          appliedItemNameRef.current = selectedItemName;
          setLastApplied(itemId, finalCount);
          setApplied(true);
          setSelectedItemId(null);
          setSelectedItemName(null);
          setTimeout(() => {
            router.back();
            setTimeout(() => router.back(), 320);
          }, 800);
        } else {
          setApplyError(`Failed to save count. (${res.status})`);
        }
      } catch {
        setApplyError("Network error. Could not save count.");
      } finally {
        setApplying(false);
      }
    },
    [backendUrl, getToken, selectedItemName, setSelectedItemId, setSelectedItemName]
  );

  const handleApplyToItem = async () => {
    if (!selectedItemId || !selectedSessionId) return;
    const scanQty = parseFloat(applyCountStr);
    if (isNaN(scanQty) || scanQty < 0) return;
    const existingCount = selectedItemCurrentCount ?? 0;
    await doApply(selectedItemId, selectedSessionId, scanQty, applyMode, existingCount);
  };

  const showItemApply = !applied && !!selectedItemId && !!selectedSessionId && success;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {segmentFetching && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <ActivityIndicator size="small" color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>{t("results.matchingItems")}</Text>
                <Text style={styles.applyCardSub}>{t("results.loadingInventoryMatches")}</Text>
              </View>
            </View>
          </View>
        )}

        {segmentFetchError && !segmentFetching && (
          <View style={[styles.applyCard, { borderColor: "#EF4444" }]}>
            <View style={styles.applyCardHeader}>
              <View style={[styles.applyIconWrap, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="alert-circle" size={18} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.applyCardTitle, { color: "#991B1B" }]}>{t("results.couldNotMatch")}</Text>
                <Text style={[styles.applyCardSub, { color: "#B91C1C" }]}>{segmentFetchError}</Text>
              </View>
            </View>
          </View>
        )}

        {segmentPending && !segmentApplying && !segmentResult && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <Feather name="list" size={20} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>
                  {t("results.reviewMatched", { count: segmentPending.length })}
                </Text>
                <Text style={styles.applyCardSub}>{t("results.confirmBeforeSaving")}</Text>
              </View>
            </View>

            <View style={styles.modeToggleRow}>
              <Pressable
                style={[styles.modeBtn, segmentMode === "replace" && styles.modeBtnActive]}
                onPress={() => setSegmentMode("replace")}
              >
                <Text style={[styles.modeBtnText, segmentMode === "replace" && styles.modeBtnTextActive]}>
                  {t("results.replace")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, segmentMode === "add" && styles.modeBtnActive]}
                onPress={() => setSegmentMode("add")}
              >
                <Text style={[styles.modeBtnText, segmentMode === "add" && styles.modeBtnTextActive]}>
                  {t("results.addToExisting")}
                </Text>
              </Pressable>
            </View>

            <View style={styles.reviewCardList}>
              {segmentPending.map((match, i) => {
                if (skippedUnreliableIds.has(match.lineId)) return null;
                const isUnreliable = !!match.catchWeightUnreadable;
                const scanQtyNum = match.scanQty ?? 0;
                const finalQty = segmentMode === "add"
                  ? match.currentCount + scanQtyNum
                  : scanQtyNum;
                const isCW = !!match.isCatchWeightCategory;
                const scanQtyDisplay = match.scanQty != null
                  ? (isCW ? match.scanQty.toFixed(2) : String(match.scanQty))
                  : "?";
                const finalQtyDisplay = isCW ? finalQty.toFixed(2) : String(finalQty);
                const scanLabel = match.unit
                  ? `+${scanQtyDisplay} ${match.unit}`
                  : `+${scanQtyDisplay}`;
                const finalLabel = match.unit
                  ? `${finalQtyDisplay} ${match.unit}`
                  : finalQtyDisplay;

                const isOverridden = catchWeightOverrides.has(match.lineId);

                if (isUnreliable && !isOverridden) {
                  const inputVal = catchWeightInputs.get(match.lineId) ?? "";
                  const inputValid = /^\d+(\.\d*)?$/.test(inputVal.trim()) && parseFloat(inputVal) > 0;
                  return (
                    <View key={match.lineId} style={[styles.reviewItemCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                      <View style={styles.reviewItemNameRow}>
                        <View style={[styles.reviewCatchWeightBadge, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
                          <Text style={[styles.reviewCatchWeightBadgeText, { color: "#DC2626" }]}>{t("results.catchWeightBadge")}</Text>
                        </View>
                        <View style={styles.reviewItemNameWithBtn}>
                          <Text style={[styles.reviewItemName, { color: "#DC2626", flex: 1 }]}>{match.name}</Text>
                          <Pressable
                            onPress={() => setCwScanTarget({ lineId: match.lineId, name: match.name })}
                            hitSlop={8}
                            style={styles.reviewScanLabelBtn}
                            testID={`scan-label-btn-${match.lineId}`}
                          >
                            <Feather name="camera" size={15} color="#D97706" />
                            <Text style={styles.reviewScanLabelBtnText}>{t("results.scanLabel")}</Text>
                          </Pressable>
                        </View>
                      </View>
                      <View style={styles.reviewWeightEntryBlock}>
                        <Text style={styles.reviewWeightEntryLabel}>{t("results.weightUnreadable")}</Text>
                        <TextInput
                          style={styles.catchWeightInput}
                          value={inputVal}
                          onChangeText={(text) => {
                            setCatchWeightInputs((prev) => {
                              const next = new Map(prev);
                              next.set(match.lineId, text);
                              return next;
                            });
                          }}
                          keyboardType="decimal-pad"
                          placeholder="e.g. 3.5 lbs"
                          placeholderTextColor="#FCA5A5"
                          returnKeyType="done"
                          testID={`catch-weight-input-${match.lineId}`}
                        />
                        <View style={styles.reviewWeightEntryButtons}>
                          <Pressable
                            onPress={() => {
                              if (!inputValid) return;
                              setCatchWeightOverrides((prev) => {
                                const next = new Map(prev);
                                next.set(match.lineId, inputVal);
                                return next;
                              });
                            }}
                            hitSlop={8}
                            disabled={!inputValid}
                            style={[
                              styles.reviewActionBtn,
                              { borderColor: inputValid ? "#86EFAC" : "#FECACA", backgroundColor: inputValid ? "#DCFCE7" : "#FEE2E2" },
                            ]}
                            testID={`catch-weight-apply-${match.lineId}`}
                          >
                            <Text style={[styles.reviewActionBtnText, { color: inputValid ? "#15803D" : "#DC2626" }]}>{t("results.apply")}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setSkippedUnreliableIds((prev) => new Set([...prev, match.lineId]))}
                            hitSlop={8}
                            style={styles.reviewActionBtn}
                          >
                            <Text style={styles.reviewActionBtnText}>{t("results.skip")}</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                }

                if (isUnreliable && isOverridden) {
                  const overrideVal = catchWeightOverrides.get(match.lineId)!;
                  const overrideQty = parseFloat(overrideVal);
                  const finalQtyOverride = segmentMode === "add"
                    ? match.currentCount + overrideQty
                    : overrideQty;
                  return (
                    <View key={match.lineId} style={[styles.reviewItemCard, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
                      <View style={styles.reviewItemNameRow}>
                        <View style={[styles.reviewCatchWeightBadge, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}>
                          <Text style={styles.reviewCatchWeightBadgeText}>{t("results.catchWeightBadge")}</Text>
                        </View>
                        <Text style={styles.reviewItemName}>{match.name}</Text>
                      </View>
                      <View style={styles.reviewStatRow}>
                        <View style={styles.reviewStatCell}>
                          <Text style={styles.reviewStatLabel}>{t("results.before")}</Text>
                          <Text style={styles.reviewStatValue}>{match.currentCount.toFixed(2)}</Text>
                        </View>
                        <View style={styles.reviewStatDivider} />
                        <View style={styles.reviewStatCell}>
                          <Text style={styles.reviewStatLabel}>{t("results.scan")}</Text>
                          <Text style={styles.reviewStatValue}>+{parseFloat(overrideVal).toFixed(2)} lbs</Text>
                        </View>
                        <View style={styles.reviewStatDivider} />
                        <View style={styles.reviewStatCell}>
                          <Text style={styles.reviewStatLabel}>{t("results.after")}</Text>
                          <Text style={[styles.reviewStatValue, styles.reviewStatFinal]}>{finalQtyOverride.toFixed(2)} lbs</Text>
                        </View>
                      </View>
                    </View>
                  );
                }

                return (
                  <View
                    key={match.lineId}
                    style={[
                      styles.reviewItemCard,
                      match.isCatchWeightCategory
                        ? { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }
                        : { backgroundColor: "#FEFCE8", borderColor: "#FDE68A" },
                    ]}
                  >
                    <View style={styles.reviewItemNameRow}>
                      {match.isCatchWeightCategory ? (
                        <View style={[styles.reviewCatchWeightBadge, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}>
                          <Text style={styles.reviewCatchWeightBadgeText}>{t("results.catchWeightBadge")}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.reviewItemName}>{match.name}</Text>
                    </View>
                    <View style={styles.reviewStatRow}>
                      <View style={styles.reviewStatCell}>
                        <Text style={styles.reviewStatLabel}>{t("results.before")}</Text>
                        <Text style={styles.reviewStatValue}>{isCW ? match.currentCount.toFixed(2) : String(match.currentCount)}</Text>
                      </View>
                      <View style={styles.reviewStatDivider} />
                      <View style={styles.reviewStatCell}>
                        <Text style={styles.reviewStatLabel}>{t("results.scan")}</Text>
                        <Text style={styles.reviewStatValue}>{scanLabel}</Text>
                      </View>
                      <View style={styles.reviewStatDivider} />
                      <View style={styles.reviewStatCell}>
                        <Text style={styles.reviewStatLabel}>{t("results.after")}</Text>
                        <Text style={[styles.reviewStatValue, styles.reviewStatFinal]}>{finalLabel}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            {segmentUnmatched.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={[styles.applyCardSub, { color: "#92400E" }]}>
                  {t("results.notMatchedManual", { count: segmentUnmatched.length })}
                </Text>
                <View style={styles.reviewUnmatchedChips}>
                  {segmentUnmatched.map((name, i) => (
                    <View key={i} style={styles.reviewUnmatchedChip}>
                      <Text style={styles.reviewUnmatchedChipText}>{name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {(() => {
              const saveCount = segmentPending.filter(
                (m) => (!m.catchWeightUnreadable || catchWeightOverrides.has(m.lineId)) && !skippedUnreliableIds.has(m.lineId)
              ).length;
              return (
                <Pressable
                  style={({ pressed }) => [styles.applyBtn, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={doSegmentConfirm}
                  testID="segment-confirm-btn"
                  disabled={saveCount === 0}
                >
                  <Feather name="check" size={18} color="#fff" />
                  <Text style={styles.applyBtnText}>
                    {t("results.confirmSave", { count: saveCount })}
                  </Text>
                </Pressable>
              );
            })()}
          </View>
        )}

        {segmentApplying && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <ActivityIndicator size="small" color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>{t("results.savingCounts")}</Text>
                <Text style={styles.applyCardSub}>{t("results.patchingLines")}</Text>
              </View>
            </View>
          </View>
        )}

        {segmentResult && (segmentResult.applied.length > 0 || segmentResult.unmatched.length > 0) && !segmentResult.error && (
          <View style={[styles.appliedBanner, { flexDirection: "column", alignItems: "flex-start", gap: 6 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Feather name="check-circle" size={18} color="#059669" />
              <Text style={styles.appliedText}>
                {t("results.savedCount", { count: segmentResult.applied.length })}
                {segmentResult.unmatched.length > 0
                  ? ` · ${t("results.notMatched", { count: segmentResult.unmatched.length })}`
                  : ""}
                . {t("results.returning")}
              </Text>
            </View>
            {segmentResult.applied.map((a, i) => (
              <Text key={i} style={[styles.appliedText, { fontSize: 13, paddingLeft: 28 }]}>
                • {a.name}: {a.qty}
              </Text>
            ))}
          </View>
        )}

        {segmentResult && segmentResult.error && (
          <View style={[styles.applyCard, { borderColor: "#EF4444" }]}>
            <View style={styles.applyCardHeader}>
              <View style={[styles.applyIconWrap, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="alert-circle" size={18} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.applyCardTitle, { color: "#991B1B" }]}>{t("results.couldNotSave")}</Text>
                <Text style={[styles.applyCardSub, { color: "#B91C1C" }]}>{segmentResult.error}</Text>
              </View>
            </View>
          </View>
        )}

        {applying && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <ActivityIndicator size="small" color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>{t("results.savingCount")}</Text>
                <Text style={styles.applyCardSub} numberOfLines={1}>
                  {selectedItemName ?? "Selected item"}
                </Text>
              </View>
            </View>
          </View>
        )}

        {isCatchWeightItem && !applied && !applying && success && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <Text style={{ fontSize: 20 }}>⚖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>{t("results.catchWeightAccumulator")}</Text>
                <Text style={styles.applyCardSub} numberOfLines={1}>
                  {selectedItemName ?? "Selected item"}
                </Text>
              </View>
            </View>

            {lowConfidenceWeight !== null && (
              <View style={styles.lowConfCard}>
                <View style={styles.lowConfHeader}>
                  <Feather name="alert-triangle" size={16} color="#B45309" />
                  <Text style={styles.lowConfTitle}>{t("results.lowConfRead")}</Text>
                </View>
                <Text style={styles.lowConfWeight}>
                  {lowConfidenceWeight.weight.toFixed(2)} {lowConfidenceWeight.unit ?? "lb"}
                </Text>
                <Text style={styles.lowConfSub}>
                  {t("results.lowConfSub")}
                </Text>
                <View style={styles.lowConfBtns}>
                  <Pressable
                    style={({ pressed }) => [styles.lowConfConfirmBtn, { opacity: pressed ? 0.75 : 1 }]}
                    onPress={() => {
                      addCatchWeightEntry(lowConfidenceWeight.weight);
                      setLowConfidenceWeight(null);
                    }}
                    testID="low-conf-confirm-btn"
                  >
                    <Feather name="check" size={14} color="#fff" />
                    <Text style={styles.lowConfConfirmText}>{t("results.confirmWeight")}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.lowConfDiscardBtn, { opacity: pressed ? 0.75 : 1 }]}
                    onPress={() => setLowConfidenceWeight(null)}
                    testID="low-conf-discard-btn"
                  >
                    <Text style={styles.lowConfDiscardText}>{t("results.discard")}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {catchWeightEntries.length === 0 && !lowConfidenceWeight ? (
              <Text style={styles.applyHint}>
                {t("results.noWeightYet")}
              </Text>
            ) : catchWeightEntries.length > 0 ? (
              <View style={styles.cwAccumulatorList}>
                <ScrollView
                  style={{ maxHeight: 220 }}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {catchWeightEntries.map((w, i) => (
                    <View key={i} style={styles.cwEntry}>
                      <Text style={styles.cwEntryLabel}>{t("results.caseN", { n: i + 1 })}</Text>
                      <Text style={styles.cwEntryWeight}>{w.toFixed(2)} lb</Text>
                      <Pressable
                        style={({ pressed }) => [styles.cwRemoveBtn, { opacity: pressed ? 0.6 : 1 }]}
                        onPress={() => removeCatchWeightEntry(i)}
                        hitSlop={6}
                        testID={`cw-remove-${i}`}
                      >
                        <Feather name="x" size={14} color="#DC2626" />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.cwTotalRow}>
                  <Text style={styles.cwTotalLabel}>{t("results.total")}</Text>
                  <Text style={styles.cwTotalWeight}>{catchWeightTotal.toFixed(2)} lb</Text>
                </View>
              </View>
            ) : null}

            {applyError ? (
              <Text style={styles.applyErrorText}>{applyError}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.cwScanMoreBtn,
                { opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={handleScanAnotherCase}
              testID="scan-another-case-btn"
            >
              <Feather name="camera" size={16} color="#D97706" />
              <Text style={styles.cwScanMoreBtnText}>{t("results.scanAnotherCase")}</Text>
            </Pressable>

            {catchWeightEntries.length > 0 && (
              <Pressable
                style={({ pressed }) => [
                  styles.applyBtn,
                  { opacity: pressed || applying ? 0.75 : 1 },
                ]}
                onPress={doSaveTotal}
                disabled={applying}
                testID="save-total-btn"
              >
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.applyBtnText}>
                  {t("results.saveTotal", { weight: catchWeightTotal.toFixed(2) })}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {showItemApply && !applying && !isCatchWeightItem && (
          <View style={[styles.applyCard, { borderColor: "#D97706" }]}>
            <View style={styles.applyCardHeader}>
              <View style={styles.applyIconWrap}>
                <Feather name="zap" size={20} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.applyCardTitle}>{t("results.applyCountToItem")}</Text>
                <Text style={styles.applyCardSub} numberOfLines={1}>
                  {selectedItemName ?? "Selected item"}
                </Text>
              </View>
            </View>

            {suggestedCount === null && (
              <Text style={styles.applyHint}>{t("results.noMatchFound")}</Text>
            )}

            <View style={styles.modeToggleRow}>
              <Pressable
                style={[styles.modeBtn, applyMode === "replace" && styles.modeBtnActive]}
                onPress={() => setApplyMode("replace")}
              >
                <Text style={[styles.modeBtnText, applyMode === "replace" && styles.modeBtnTextActive]}>
                  {t("results.replace")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, applyMode === "add" && styles.modeBtnActive]}
                onPress={() => setApplyMode("add")}
              >
                <Text style={[styles.modeBtnText, applyMode === "add" && styles.modeBtnTextActive]}>
                  {t("results.addToExisting")}
                </Text>
              </Pressable>
            </View>

            <View style={styles.applyInputRow}>
              <Text style={styles.applyInputLabel}>
                {applyMode === "add" ? t("results.addQuantity") : t("results.newCount")}
              </Text>
              <TextInput
                style={[styles.applyInput, { borderColor: "#D97706" }]}
                value={applyCountStr}
                onChangeText={setApplyCountStr}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                maxLength={8}
                testID="apply-count-input"
              />
            </View>

            {applyMode === "add" && selectedItemCurrentCount !== null && (
              <Text style={[styles.applyHint, { color: "#059669" }]}>
                {t("results.finalCount", {
                  current: selectedItemCurrentCount,
                  add: parseFloat(applyCountStr) || 0,
                  total: selectedItemCurrentCount + (parseFloat(applyCountStr) || 0),
                })}
              </Text>
            )}

            {applyError ? (
              <Text style={styles.applyErrorText}>{applyError}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.applyBtn,
                { opacity: pressed || applying ? 0.75 : 1 },
              ]}
              onPress={handleApplyToItem}
              disabled={applying}
              testID="apply-count-btn"
            >
              <Feather name="check" size={18} color="#fff" />
              <Text style={styles.applyBtnText}>
                {applyMode === "add" ? t("results.addToCount") : t("results.applyCount")}
              </Text>
            </Pressable>
          </View>
        )}

        {applied && (
          <View style={[styles.appliedBanner]}>
            <Feather name="check-circle" size={18} color="#059669" />
            <Text style={styles.appliedText}>
              {t("results.countSavedFor", { name: appliedItemNameRef.current ?? t("common.item") })}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.statusCard,
            {
              backgroundColor: success ? "#F0FDF4" : "#FEF2F2",
              borderColor: success ? "#BBF7D0" : "#FECACA",
            },
          ]}
        >
          <View
            style={[
              styles.statusIcon,
              { backgroundColor: success ? "#DCFCE7" : "#FEE2E2" },
            ]}
          >
            <Feather
              name={success ? "check-circle" : "alert-circle"}
              size={28}
              color={success ? "#059669" : "#DC2626"}
            />
          </View>
          <View style={styles.statusText}>
            <Text
              style={[
                styles.statusTitle,
                { color: success ? "#065F46" : "#991B1B" },
              ]}
            >
              {success ? t("results.scanComplete") : t("results.scanFailed")}
            </Text>
            {frameCount !== null && (
              <View style={styles.framePill}>
                <Text style={styles.framePillText}>
                  {t("results.framesAnalysed", { count: frameCount })}
                </Text>
              </View>
            )}
            {statusCode ? (
              <Text
                style={[
                  styles.statusMeta,
                  { color: success ? "#059669" : "#DC2626" },
                ]}
              >
                HTTP {statusCode}
              </Text>
            ) : null}
          </View>
        </View>

        {error && (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {t("results.error")}
            </Text>
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              {error}
            </Text>
          </View>
        )}

        {hasItems && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Feather name="package" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t("results.inventoryItems", { count: items.length })}
              </Text>
            </View>
            {items.map((item, i) => (
              <View
                key={i}
                style={[
                  styles.itemRow,
                  i < items.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.itemName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <View style={styles.itemRight}>
                  {item.value ? (
                    <View
                      style={[styles.itemBadge, { backgroundColor: colors.secondary }]}
                    >
                      <Text style={[styles.itemValue, { color: colors.primary }]}>
                        {item.value}
                      </Text>
                    </View>
                  ) : null}
                  {item.confidence ? (
                    <View
                      style={[
                        styles.confidenceBadge,
                        { backgroundColor: CONFIDENCE_COLORS[item.confidence].bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.confidenceText,
                          { color: CONFIDENCE_COLORS[item.confidence].text },
                        ]}
                      >
                        {item.confidence.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {notes.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Feather name="info" size={16} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t("results.notes", { count: notes.length })}
              </Text>
            </View>
            {notes.map((note, i) => (
              <View
                key={i}
                style={[
                  styles.noteRow,
                  i < notes.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.noteBullet, { color: colors.mutedForeground }]}>
                  {"\u2022"}
                </Text>
                <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
                  {note}
                </Text>
              </View>
            ))}
          </View>
        )}

        {data !== undefined && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Feather name="code" size={16} color={colors.mutedForeground} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {hasItems ? t("results.rawResponse") : t("results.serverResponse")}
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.rawContainer}
            >
              <Text style={[styles.rawText, { color: colors.foreground }]}>
                {formatData(data)}
              </Text>
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.card,
            paddingBottom: bottomPad + 12,
          },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
          onPress={handleHome}
        >
          <Feather name="home" size={16} color={colors.foreground} />
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
            {t("results.home")}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: isCatchWeightItem ? "#D97706" : colors.primary,
              opacity: pressed ? 0.88 : 1,
              flex: 1,
            },
          ]}
          onPress={handleScanAgain}
          testID="scan-again-button"
        >
          <Feather name="camera" size={16} color={colors.primaryForeground} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            {isCatchWeightItem ? t("results.scanAnotherCase") : t("results.scanAgain")}
          </Text>
        </Pressable>
      </View>

      <CatchWeightScanModal
        visible={!!cwScanTarget}
        itemId={cwScanTarget?.lineId ?? ""}
        lineId={cwScanTarget?.lineId ?? ""}
        itemName={cwScanTarget?.name ?? ""}
        sessionId={selectedSessionId ?? ""}
        currentCount={0}
        autoCapture
        onClose={() => setCwScanTarget(null)}
        onWeightApplied={() => {}}
        onWeightRead={(weight) => {
          const target = cwScanTarget;
          if (!target) return;
          const key = target.lineId;
          const val = String(weight);
          setCatchWeightInputs((prev) => {
            const next = new Map(prev);
            next.set(key, val);
            return next;
          });
          setCatchWeightOverrides((prev) => {
            const next = new Map(prev);
            next.set(key, val);
            return next;
          });
          setCwScanTarget(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 36,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },

  applyCard: {
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: "#FFFBEB",
    padding: 16,
    gap: 12,
  },
  applyCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  applyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  applyCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#78350F",
  },
  applyCardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#B45309",
    marginTop: 1,
  },
  applyHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#92400E",
  },
  modeToggleRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderWidth: 1.5,
    borderColor: "#FDE68A",
  },
  modeBtnActive: {
    backgroundColor: "#D97706",
    borderColor: "#D97706",
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#92400E",
  },
  modeBtnTextActive: {
    color: "#fff",
  },
  reviewCardList: {
    gap: 10,
  },
  reviewItemCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FEFCE8",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  reviewItemNameRow: {
    gap: 6,
  },
  reviewItemName: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#78350F",
    lineHeight: 20,
  },
  reviewItemNameWithBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reviewScanLabelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  reviewScanLabelBtnText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#D97706",
  },
  reviewCatchWeightBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FEF3C7",
  },
  reviewCatchWeightBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#92400E",
  },
  reviewStatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  reviewStatCell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  reviewStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#FDE68A",
    marginHorizontal: 4,
  },
  reviewStatLabel: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#92400E",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  reviewStatValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#78350F",
  },
  reviewStatFinal: {
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#059669",
    fontSize: 15,
  },
  reviewWeightEntryBlock: {
    gap: 8,
  },
  reviewWeightEntryLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#991B1B",
    lineHeight: 18,
  },
  reviewWeightEntryButtons: {
    flexDirection: "column",
    gap: 8,
  },
  reviewActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  reviewActionBtnText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#DC2626",
  },
  catchWeightInput: {
    width: "100%",
    height: 44,
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#111827",
  },
  reviewUnmatchedChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  reviewUnmatchedChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FEF3C7",
  },
  reviewUnmatchedChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: "#92400E",
  },
  applyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  applyInputLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: "#78350F",
  },
  applyInput: {
    width: 80,
    height: 42,
    borderRadius: 10,
    borderWidth: 2,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    textAlign: "center",
    backgroundColor: "#fff",
    color: "#78350F",
  },
  applyErrorText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#DC2626",
  },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#D97706",
    paddingVertical: 13,
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  appliedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    padding: 14,
  },
  appliedText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: "#059669",
  },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  statusIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    flex: 1,
    gap: 3,
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  statusMeta: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  framePill: {
    alignSelf: "flex-start",
    backgroundColor: "#DCFCE7",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginTop: 3,
  },
  framePillText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#166534",
  },
  errorBox: {
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Inter_600SemiBold",
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  section: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  itemName: {
    fontSize: 14,
    flex: 1,
    fontFamily: "Inter_400Regular",
  },
  itemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  itemValue: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  confidenceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noteBullet: {
    fontSize: 16,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  rawContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  rawText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  cwAccumulatorList: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FDE68A",
    overflow: "hidden",
  },
  cwEntry: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#FDE68A",
    backgroundColor: "#FFFBEB",
    gap: 8,
  },
  cwEntryLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    color: "#78350F",
  },
  cwEntryWeight: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#92400E",
  },
  cwRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  cwTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FEF3C7",
    gap: 8,
  },
  cwTotalLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#78350F",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cwTotalWeight: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#059669",
  },
  cwScanMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
    paddingVertical: 12,
  },
  cwScanMoreBtnText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#D97706",
  },
  lowConfCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FFF7ED",
    padding: 14,
    gap: 8,
  },
  lowConfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  lowConfTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#B45309",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  lowConfWeight: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#92400E",
    textAlign: "center",
  },
  lowConfSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#78350F",
    textAlign: "center",
    lineHeight: 18,
  },
  lowConfBtns: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  lowConfConfirmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#D97706",
    borderRadius: 10,
    paddingVertical: 11,
  },
  lowConfConfirmText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  lowConfDiscardBtn: {
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEE2E2",
    paddingVertical: 11,
  },
  lowConfDiscardText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#DC2626",
  },
});
