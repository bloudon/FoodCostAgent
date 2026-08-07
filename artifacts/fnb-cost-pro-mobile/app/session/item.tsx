import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { useColors } from "@/hooks/useColors";
import { useUpdateItemCount } from "@/hooks/useUpdateItemCount";
import { useScan } from "@/context/ScanContext";

export default function ItemDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    setSelectedItemId,
    setSelectedItemName,
    setSelectedItemCurrentCount,
    setSelectedItemIsCatchWeight,
    setScanCategoryId,
    setScanLocationId,
    lastAppliedItemId,
    lastAppliedCount,
    setLastApplied,
    clearCatchWeightEntries,
  } = useScan();

  const {
    sessionId,
    itemId,
    itemName,
    unit,
    categoryName,
    locationName,
    expectedCount: expectedCountParam,
    currentCount: currentCountParam,
    sessionName,
    groupType,
    groupName,
    isCatchWeightCategory,
  } = useLocalSearchParams<{
    sessionId: string;
    itemId: string;
    itemName: string;
    unit?: string;
    categoryName?: string;
    locationName?: string;
    expectedCount?: string;
    currentCount?: string;
    sessionName?: string;
    groupType?: string;
    groupName?: string;
    isCatchWeightCategory?: string;
  }>();

  const isCatchWeight = isCatchWeightCategory === "true";

  // +/- steppers are relative edits sent as atomic server-side addQty
  // increments; the display reconciles from the server-returned quantity so
  // concurrent devices can't overwrite each other. Typed input remains an
  // intentional absolute direct-set.
  const { saveCount, addToCount, flushAll } = useUpdateItemCount(
    sessionId ?? "",
    (updatedItemId, serverQty) => {
      if (updatedItemId === itemId) setLocalCount(serverQty);
    }
  );
  const inputRef = useRef<TextInput>(null);

  const initCountNum = currentCountParam ? parseFloat(currentCountParam) || 0 : 0;
  const expectedCountNum = expectedCountParam && expectedCountParam !== ""
    ? parseFloat(expectedCountParam) || null
    : null;

  const [localCount, setLocalCount] = useState(initCountNum);
  const [inputVal, setInputVal] = useState(String(initCountNum));

  useEffect(() => {
    setInputVal(String(localCount));
  }, [localCount]);

  useFocusEffect(
    useCallback(() => {
      if (lastAppliedItemId && lastAppliedItemId === itemId && lastAppliedCount !== null) {
        setLocalCount(lastAppliedCount);
        setLastApplied(null, null);
      }
    }, [lastAppliedItemId, lastAppliedCount, itemId, setLastApplied])
  );

  const handleIncrement = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalCount((c) => c + 1); // optimistic; reconciled from server qty
    addToCount(itemId ?? "", 1);
  };

  const handleDecrement = () => {
    if (localCount === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalCount((c) => Math.max(0, c - 1)); // optimistic; reconciled from server qty
    addToCount(itemId ?? "", -1);
  };

  const handleInputBlur = () => {
    const parsed = parseFloat(inputVal);
    if (!isNaN(parsed) && parsed >= 0) {
      if (parsed !== localCount) {
        setLocalCount(parsed);
        saveCount(itemId ?? "", parsed);
      }
    } else {
      setInputVal(String(localCount));
    }
  };

  const handleInputSubmit = () => {
    handleInputBlur();
    inputRef.current?.blur();
  };

  const handleDone = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await flushAll();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const handleScanItem = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedItemId(itemId ?? null);
    setSelectedItemName(itemName ?? null);
    setSelectedItemCurrentCount(localCount);
    setSelectedItemIsCatchWeight(isCatchWeight);
    setScanCategoryId(null);
    setScanLocationId(null);
    if (isCatchWeight) {
      clearCatchWeightEntries();
    }
    router.push("/camera");
  };

  const isCounted = localCount > 0;
  const hasExpected = expectedCountNum !== null;
  const topPad = Platform.OS === "web" ? 0 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={handleDone} hitSlop={8} testID="back-btn">
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={2}>
              {itemName ?? t("common.item")}
            </Text>
            {sessionName ? (
              <Text style={styles.headerSub} numberOfLines={1}>
                {sessionName}{groupName ? ` · ${groupName}` : ""}
              </Text>
            ) : null}
          </View>
          <Pressable style={styles.scanItemBtn} onPress={handleScanItem} hitSlop={8} testID="scan-item-btn">
            <Feather name="camera" size={20} color="#D97706" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.metaRow}>
          {isCatchWeight ? (
            <View style={[styles.metaBadge, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
              <Text style={[styles.metaBadgeText, { color: "#92400E" }]}>{t("item.catchWeight")}</Text>
            </View>
          ) : null}
          {unit ? (
            <View style={[styles.metaBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="package" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaBadgeText, { color: colors.mutedForeground }]}>{unit}</Text>
            </View>
          ) : null}
          {categoryName ? (
            <View style={[styles.metaBadge, { backgroundColor: "#EDE9FE", borderColor: "#C4B5FD" }]}>
              <Feather name="tag" size={12} color="#7C3AED" />
              <Text style={[styles.metaBadgeText, { color: "#7C3AED" }]}>{categoryName}</Text>
            </View>
          ) : null}
          {locationName ? (
            <View style={[styles.metaBadge, { backgroundColor: "#DBEAFE", borderColor: "#BFDBFE" }]}>
              <Feather name="map-pin" size={12} color="#1D4ED8" />
              <Text style={[styles.metaBadgeText, { color: "#1D4ED8" }]}>{locationName}</Text>
            </View>
          ) : null}
        </View>

        {hasExpected && (
          <View style={[styles.expectedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.expectedLabel, { color: colors.mutedForeground }]}>
              {t("item.expectedCount")}
            </Text>
            <Text style={[styles.expectedValue, { color: colors.foreground }]}>
              {expectedCountNum}{unit ? ` ${unit}` : ""}
            </Text>
          </View>
        )}

        {isCatchWeight ? (
          <View
            style={[
              styles.countCard,
              { backgroundColor: "#FFFBEB", borderColor: isCounted ? "#22C55E" : "#FCD34D" },
            ]}
          >
            <View style={styles.cwHeader}>
              <Text style={[styles.cwHeaderEmoji]}>⚖</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.countCardLabel, { color: "#92400E" }]}>
                  {t("item.netWeight")} {unit ? `(${unit})` : "(lb)"}
                </Text>
                <Text style={styles.cwInstruction}>
                  {t("item.placeOnScale")}
                </Text>
              </View>
            </View>

            <TextInput
              ref={inputRef}
              style={[
                styles.cwInput,
                {
                  color: isCounted ? "#1B4332" : "#92400E",
                  borderColor: isCounted ? "#22C55E" : "#FCD34D",
                  backgroundColor: isCounted ? "#F0FDF4" : "#FEF9C3",
                },
              ]}
              value={inputVal}
              onChangeText={setInputVal}
              onBlur={handleInputBlur}
              onSubmitEditing={handleInputSubmit}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              textAlign="center"
              maxLength={10}
              placeholder="0.00"
              placeholderTextColor="#D97706"
              testID="count-input"
            />
          </View>
        ) : (
          <View
            style={[
              styles.countCard,
              {
                backgroundColor: colors.card,
                borderColor: isCounted ? "#22C55E" : colors.border,
              },
            ]}
          >
            <Text style={[styles.countCardLabel, { color: colors.mutedForeground }]}>
              {t("item.currentCount")}
            </Text>

            <View style={styles.countRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.controlBtn,
                  { backgroundColor: colors.secondary, borderColor: colors.border },
                  localCount === 0 && { opacity: 0.3 },
                  pressed && { opacity: 0.55 },
                ]}
                onPress={handleDecrement}
                disabled={localCount === 0}
                hitSlop={8}
                testID="decrement-btn"
              >
                <Feather name="minus" size={28} color={colors.foreground} />
              </Pressable>

              <TextInput
                ref={inputRef}
                style={[
                  styles.countInput,
                  {
                    color: isCounted ? "#1B4332" : colors.foreground,
                    borderColor: isCounted ? "#22C55E" : colors.border,
                    backgroundColor: isCounted ? "#F0FDF4" : colors.background,
                  },
                ]}
                value={inputVal}
                onChangeText={setInputVal}
                onBlur={handleInputBlur}
                onSubmitEditing={handleInputSubmit}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                textAlign="center"
                maxLength={8}
                testID="count-input"
              />

              <Pressable
                style={({ pressed }) => [
                  styles.controlBtn,
                  { backgroundColor: "#1B4332", borderColor: "#1B4332" },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={handleIncrement}
                hitSlop={8}
                testID="increment-btn"
              >
                <Feather name="plus" size={28} color="#fff" />
              </Pressable>
            </View>

            {unit ? (
              <Text style={[styles.unitHint, { color: colors.mutedForeground }]}>
                {unit}
              </Text>
            ) : null}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.doneBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={handleDone}
          testID="done-btn"
        >
          <Feather name="check" size={20} color="#fff" />
          <Text style={styles.doneBtnText}>{t("item.saveBack")}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.scanBtn,
            { opacity: pressed ? 0.75 : 1 },
          ]}
          onPress={handleScanItem}
          testID="scan-btn"
        >
          <Feather name="camera" size={18} color="#D97706" />
          <Text style={[styles.scanBtnText, { color: "#D97706" }]}>
            {t("item.scanWithAI")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    backgroundColor: "#0A0A0A",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
    textAlign: "center",
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
  },
  scanItemBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(217,119,6,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: { flex: 1 },
  content: {
    padding: 20,
    gap: 16,
  },

  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },

  expectedCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  expectedLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  expectedValue: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  countCard: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 24,
    alignItems: "center",
    gap: 20,
  },
  countCardLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    textAlign: "center",
  },
  cwHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    alignSelf: "stretch",
  },
  cwHeaderEmoji: {
    fontSize: 28,
    lineHeight: 36,
  },
  cwInstruction: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#92400E",
    lineHeight: 18,
    marginTop: 2,
  },
  cwInput: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 2,
    paddingVertical: 18,
    paddingHorizontal: 20,
    fontSize: 36,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },

  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  countInput: {
    width: 120,
    borderRadius: 12,
    borderWidth: 2,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  unitHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  scanBtnText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
});
