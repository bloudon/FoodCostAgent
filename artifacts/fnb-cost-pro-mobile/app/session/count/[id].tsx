import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { useSessionInventory, InventoryItem, InventorySection } from "@/hooks/useSessionInventory";
import { useUpdateItemCount } from "@/hooks/useUpdateItemCount";
import { useScan } from "@/context/ScanContext";
import CatchWeightScanModal from "@/components/CatchWeightScanModal";

interface ItemRowProps {
  item: InventoryItem;
  count: number;
  onChangeCount: (value: number) => void;
  onTap: () => void;
  onScanCatchWeight?: () => void;
  colors: ReturnType<typeof useColors>;
}

function formatItemCount(count: number, isCatchWeight: boolean): string {
  return isCatchWeight ? count.toFixed(2) : String(count);
}

function ItemRow({ item, count, onChangeCount, onTap, onScanCatchWeight, colors }: ItemRowProps) {
  const [inputVal, setInputVal] = useState(formatItemCount(count, !!item.isCatchWeightCategory));
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setInputVal(formatItemCount(count, !!item.isCatchWeightCategory));
  }, [count, item.isCatchWeightCategory]);

  const handleInputBlur = () => {
    const parsed = parseFloat(inputVal);
    if (!isNaN(parsed) && parsed >= 0) {
      onChangeCount(parsed);
    } else {
      setInputVal(formatItemCount(count, !!item.isCatchWeightCategory));
    }
  };

  const handleInputSubmit = () => {
    const parsed = parseFloat(inputVal);
    if (!isNaN(parsed) && parsed >= 0) {
      onChangeCount(parsed);
    } else {
      setInputVal(formatItemCount(count, !!item.isCatchWeightCategory));
    }
    inputRef.current?.blur();
  };

  const isCounted = count > 0;

  return (
    <View
      style={[
        styles.itemRow,
        { borderBottomColor: colors.border },
        isCounted && { backgroundColor: "#F0FDF4" },
      ]}
      testID={`item-row-${item.id}`}
    >
      <Pressable
        style={({ pressed }) => [styles.itemInfo, pressed && { opacity: 0.7 }]}
        onPress={onTap}
        hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
      >
        <View style={styles.itemNameRow}>
          {item.isCatchWeightCategory ? (
            <View style={styles.cwBadge}>
              <Text style={styles.cwBadgeText}>⚖</Text>
            </View>
          ) : null}
          <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={2}>
            {item.name}
          </Text>
        </View>
        {(item.unit || item.locationName) ? (
          <View style={[styles.unitBadge, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.unitText, { color: colors.mutedForeground }]}>
              {[item.unit, item.locationName].filter(Boolean).join(" · ")}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.countControls}>
        {item.isCatchWeightCategory && onScanCatchWeight ? (
          <Pressable
            style={({ pressed }) => [styles.cwScanBtn, { opacity: pressed ? 0.65 : 1 }]}
            onPress={onScanCatchWeight}
            hitSlop={6}
            testID={`cw-scan-btn-${item.id}`}
          >
            <Feather name="camera" size={16} color="#D97706" />
          </Pressable>
        ) : null}
        <TextInput
        ref={inputRef}
        style={[
          styles.countInput,
          {
            color: "#0A0A0A",
            borderColor: isCounted ? "#16A34A" : colors.border,
            backgroundColor: isCounted ? "#DCFCE7" : "#fff",
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
        testID={`count-input-${item.id}`}
      />
      </View>
    </View>
  );
}

export default function CountScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    setSelectedItemId,
    setSelectedItemName,
    setScanCategoryId,
    setScanLocationId,
  } = useScan();
  const [cwModalItem, setCwModalItem] = useState<InventoryItem | null>(null);
  const {
    id,
    sessionName,
    groupType,
    groupName,
    categoryId,
    locationId,
  } = useLocalSearchParams<{
    id: string;
    sessionName?: string;
    groupType?: string;
    groupName?: string;
    categoryId?: string;
    locationId?: string;
  }>();
  const topPad = Platform.OS === "web" ? 0 : insets.top;

  const filter = useMemo(() => {
    if (categoryId) return { categoryId };
    if (locationId) return { locationId };
    return undefined;
  }, [categoryId, locationId]);

  const { sections, allItems, isLoading, error, refetch } = useSessionInventory(id ?? "", filter);
  const { saveCount, flushAll, hasSaveError, clearSaveError, clearAllCounts } = useUpdateItemCount(id ?? "");

  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    clearSaveError();
    await flushAll();
    setIsSyncing(false);
  }, [flushAll, clearSaveError]);

  const handleClearAll = useCallback(() => {
    const scopeLabel = groupName
      ? `"${groupName}"`
      : t("count.thisSession");
    Alert.alert(
      t("count.clearAll"),
      t("count.clearAllMsg", { scope: scopeLabel }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("count.clearAllBtn"),
          style: "destructive",
          onPress: async () => {
            if (isClearingAll) return;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setIsClearingAll(true);
            await flushAll();
            const ok = await clearAllCounts(
              categoryId ? { categoryId } : locationId ? { locationId } : undefined
            );
            if (ok) {
              setLocalCounts((prev) => {
                const next = { ...prev };
                for (const item of allItems) next[item.id] = 0;
                return next;
              });
            }
            setIsClearingAll(false);
          },
        },
      ]
    );
  }, [allItems, localCounts, groupName, isClearingAll, flushAll, clearAllCounts, categoryId, locationId, t]);

  useFocusEffect(
    useCallback(() => {
      if (id) refetch();
    }, [id, refetch])
  );

  useEffect(() => {
    if (allItems.length > 0) {
      setLocalCounts((prev) => {
        const next: Record<string, number> = {};
        for (const item of allItems) {
          next[item.id] = prev[item.id] ?? item.currentCount;
        }
        return next;
      });
    }
  }, [allItems]);

  const handleChangeCount = useCallback(
    (lineId: string, value: number) => {
      const clamped = Math.max(0, value);
      setLocalCounts((prev) => {
        const next = { ...prev, [lineId]: clamped };
        saveCount(lineId, clamped);
        return next;
      });
    },
    [saveCount]
  );

  const handleItemTap = useCallback(
    (item: InventoryItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/session/item",
        params: {
          sessionId: id ?? "",
          itemId: item.id,
          itemName: item.name,
          unit: item.unit ?? "",
          categoryName: item.categoryName ?? "",
          locationName: item.locationName ?? "",
          expectedCount: item.expectedCount != null ? String(item.expectedCount) : "",
          currentCount: String(localCounts[item.id] ?? item.currentCount),
          sessionName: sessionName ?? "",
          groupType: groupType ?? "",
          groupName: groupName ?? "",
          isCatchWeightCategory: item.isCatchWeightCategory ? "true" : "false",
        },
      });
    },
    [id, sessionName, groupType, groupName, localCounts]
  );

  const handleScanSegment = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedItemId(null);
    setSelectedItemName(null);
    if (categoryId) {
      setScanCategoryId(categoryId);
      setScanLocationId(null);
    } else if (locationId) {
      setScanCategoryId(null);
      setScanLocationId(locationId);
    } else {
      setScanCategoryId(null);
      setScanLocationId(null);
    }
    router.push("/camera");
  }, [setSelectedItemId, setSelectedItemName, setScanCategoryId, setScanLocationId, categoryId, locationId]);

  const handleScanCatchWeight = useCallback(
    (item: InventoryItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCwModalItem(item);
    },
    []
  );

  const handleCwWeightApplied = useCallback(
    (lineId: string, newCount: number) => {
      setLocalCounts((prev) => ({ ...prev, [lineId]: newCount }));
    },
    []
  );

  const handleCwModalClose = useCallback(() => {
    setCwModalItem(null);
  }, []);

  const { countedItems, totalItems } = useMemo(() => {
    const total = allItems.length;
    const counted = allItems.filter(
      (i) => (localCounts[i.id] ?? i.currentCount) > 0
    ).length;
    return { countedItems: counted, totalItems: total };
  }, [allItems, localCounts]);

  const progress = totalItems > 0 ? countedItems / totalItems : 0;
  const progressPct = Math.round(progress * 100);

  const handleBack = useCallback(async () => {
    await flushAll();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [flushAll]);

  const hasSegment = !!(groupName);

  const renderSectionHeader = useCallback(
    ({ section }: { section: InventorySection }) => {
      const sectionCounted = section.data.filter(
        (i) => (localCounts[i.id] ?? i.currentCount) > 0
      ).length;
      const sectionTotal = section.data.length;
      return (
        <View
          style={[
            styles.sectionHeader,
            { backgroundColor: colors.background, borderBottomColor: colors.border },
          ]}
        >
          <Feather name="tag" size={13} color="#1B4332" />
          <Text style={[styles.sectionHeaderText, { color: colors.foreground }]}>
            {section.categoryName}
          </Text>
          <View
            style={[
              styles.sectionBadge,
              {
                backgroundColor:
                  sectionCounted === sectionTotal && sectionTotal > 0
                    ? "#DCFCE7"
                    : colors.secondary,
              },
            ]}
          >
            <Text
              style={[
                styles.sectionBadgeText,
                {
                  color:
                    sectionCounted === sectionTotal && sectionTotal > 0
                      ? "#15803D"
                      : colors.mutedForeground,
                },
              ]}
            >
              {sectionCounted}/{sectionTotal}
            </Text>
          </View>
        </View>
      );
    },
    [colors, localCounts]
  );

  const renderItem = useCallback(
    ({ item }: { item: InventoryItem }) => (
      <ItemRow
        item={item}
        count={localCounts[item.id] ?? item.currentCount}
        onChangeCount={(v) => handleChangeCount(item.id, v)}
        onTap={() => handleItemTap(item)}
        onScanCatchWeight={item.isCatchWeightCategory ? () => handleScanCatchWeight(item) : undefined}
        colors={colors}
      />
    ),
    [localCounts, handleChangeCount, handleItemTap, handleScanCatchWeight, colors]
  );

  const keyExtractor = useCallback((item: InventoryItem) => item.id, []);

  const SegmentDetailCard = useMemo(() => {
    if (!hasSegment || isLoading || error) return null;
    const groupIcon = groupType === "location" ? "map-pin" : "tag";
    const isComplete = totalItems > 0 && countedItems === totalItems;

    return (
      <View style={[styles.segmentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.segmentCardTop}>
          <View style={[styles.segmentIcon, { backgroundColor: groupType === "location" ? "#DBEAFE" : "#EDE9FE" }]}>
            <Feather name={groupIcon} size={18} color={groupType === "location" ? "#1D4ED8" : "#7C3AED"} />
          </View>
          <View style={styles.segmentInfo}>
            <Text style={[styles.segmentName, { color: colors.foreground }]} numberOfLines={1}>
              {groupName}
            </Text>
            <Text style={[styles.segmentProgress, { color: isComplete ? "#059669" : colors.mutedForeground }]}>
              {countedItems} {t("count.of")} {totalItems} {t("count.itemsCounted")}
            </Text>
          </View>
          {groupType !== "category" && (
            <Pressable
              style={({ pressed }) => [
                styles.segmentScanBtn,
                { opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={handleScanSegment}
              testID="scan-segment-btn"
            >
              <Feather name="camera" size={16} color="#D97706" />
              <Text style={styles.segmentScanText}>{t("camera.scan")}</Text>
            </Pressable>
          )}
        </View>
        {totalItems > 0 && (
          <View style={styles.segmentProgressTrack}>
            <View
              style={[
                styles.segmentProgressFill,
                {
                  width: `${progressPct}%` as `${number}%`,
                  backgroundColor: isComplete ? "#22C55E" : "#D97706",
                },
              ]}
            />
          </View>
        )}
      </View>
    );
  }, [hasSegment, isLoading, error, groupType, groupName, countedItems, totalItems, progressPct, colors, handleScanSegment, t]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={handleBack} hitSlop={8}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {hasSegment ? groupName : (sessionName ? sessionName : t("count.countItems"))}
            </Text>
            {hasSegment && sessionName ? (
              <Text style={styles.headerSub} numberOfLines={1}>{sessionName}</Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Pressable
              style={({ pressed }) => [styles.headerCameraBtn, { opacity: pressed ? 0.65 : 1 }]}
              onPress={handleScanSegment}
              hitSlop={8}
              testID="header-scan-btn"
            >
              <Feather name="camera" size={20} color="#D97706" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.headerClearBtn, { opacity: (pressed || isClearingAll) ? 0.5 : 1 }]}
              onPress={handleClearAll}
              disabled={isClearingAll || isLoading || allItems.length === 0}
              hitSlop={8}
              testID="clear-all-btn"
            >
              {isClearingAll ? (
                <ActivityIndicator size={14} color="#EF4444" />
              ) : (
                <Feather name="trash-2" size={16} color="#EF4444" />
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.syncBtn, pressed && { opacity: 0.65 }]}
              onPress={handleSync}
              disabled={isSyncing}
              hitSlop={8}
              testID="sync-btn"
            >
              {isSyncing ? (
                <ActivityIndicator size={14} color="#fff" />
              ) : (
                <Text style={styles.syncBtnText}>{t("common.save")}</Text>
              )}
            </Pressable>
          </View>
        </View>

        {!isLoading && !error && totalItems > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>
                {countedItems} {t("count.of")} {totalItems} {t("count.itemsCounted")}
              </Text>
              <Text style={styles.progressPct}>{progressPct}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progressPct}%` as `${number}%` },
                ]}
              />
            </View>
          </View>
        )}
      </View>

      {hasSaveError && (
        <View style={styles.saveErrorBanner} testID="save-error-banner">
          <Text style={[styles.saveErrorText, { flex: 1 }]}>
            Some counts may not have saved
          </Text>
          <Pressable
            style={styles.retryInlineBtnText}
            onPress={async () => { clearSaveError(); await flushAll(); }}
          >
            <Text style={styles.retryInlineText}>Retry</Text>
          </Pressable>
          <Pressable onPress={clearSaveError} hitSlop={8}>
            <Text style={{ color: "#fff", fontSize: 16, paddingLeft: 8 }}>✕</Text>
          </Pressable>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centeredContainer}>
          <ActivityIndicator color="#1B4332" size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            {t("count.loadingInventory")}
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centeredContainer}>
          <Feather name="alert-circle" size={28} color="#EF4444" />
          <Text style={[styles.errorText, { color: "#EF4444" }]}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={refetch}>
            <Text style={styles.retryBtnText}>{t("common.tryAgain")}</Text>
          </Pressable>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centeredContainer}>
          <Feather name="inbox" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {t("count.noItems")}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {hasSegment
              ? t("count.noItemsHint", { name: groupName })
              : t("count.noItemsHintGeneral")}
          </Text>
          <Pressable style={styles.goBackBtn} onPress={handleBack} testID="go-back-btn">
            <Text style={styles.goBackBtnText}>{t("count.goBack")}</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={SegmentDetailCard}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="inventory-section-list"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#1B4332"
              colors={["#1B4332"]}
            />
          }
        />
      )}

      {cwModalItem && id && (
        <CatchWeightScanModal
          visible={!!cwModalItem}
          itemId={cwModalItem.inventoryItemId}
          lineId={cwModalItem.id}
          itemName={cwModalItem.name}
          sessionId={id}
          currentCount={localCounts[cwModalItem.id] ?? cwModalItem.currentCount}
          onClose={handleCwModalClose}
          onWeightApplied={handleCwWeightApplied}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    backgroundColor: "#0A0A0A",
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 14,
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

  progressContainer: { gap: 6 },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)",
  },
  progressPct: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#fff",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22C55E",
  },

  segmentCard: {
    margin: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  segmentCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  segmentIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentInfo: {
    flex: 1,
    gap: 2,
  },
  segmentName: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  segmentProgress: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  segmentScanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#D97706",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  segmentScanText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#D97706",
  },
  segmentProgressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E5E7EB",
    overflow: "hidden",
  },
  segmentProgressFill: {
    height: 6,
    borderRadius: 3,
  },

  centeredContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#1B4332",
  },
  retryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#1B4332",
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
  goBackBtn: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    backgroundColor: "#1B4332",
  },
  goBackBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  sectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  itemNameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    flexWrap: "wrap",
  },
  itemName: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    flexShrink: 1,
  },
  cwBadge: {
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 1,
  },
  cwBadgeText: {
    fontSize: 11,
  },
  countControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cwScanBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
    alignItems: "center",
    justifyContent: "center",
  },
  unitBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  unitText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },

  countInput: {
    width: 90,
    height: 56,
    borderRadius: 8,
    borderWidth: 1.5,
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    paddingHorizontal: 4,
  },

  saveErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#B45309",
  },
  saveErrorText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#fff",
  },
  retryInlineBtnText: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  retryInlineText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#fff",
  },

  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerCameraBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(217,119,6,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerClearBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtn: {
    width: 52,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtnText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
