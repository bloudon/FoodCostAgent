import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useSessionItems } from "@/hooks/useSessionItems";
import { useColors } from "@/hooks/useColors";

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function SkeletonLine({ width, height = 14 }: { width: number | `${number}%`; height?: number }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <Animated.View
      style={{ width, height, borderRadius: 6, backgroundColor: "#E5E7EB", opacity: anim }}
    />
  );
}

export default function SessionItemsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessionId, groupType, groupId, groupName, sessionName } = useLocalSearchParams<{
    sessionId: string;
    groupType: "category" | "location";
    groupId: string;
    groupName: string;
    sessionName: string;
  }>();
  const [refreshing, setRefreshing] = useState(false);

  const filter =
    groupType === "category"
      ? { categoryId: groupId }
      : { locationId: groupId };

  const { items, isLoading, error, refetch } = useSessionItems(sessionId ?? "", filter);

  useFocusEffect(
    useCallback(() => {
      if (sessionId && groupId) {
        refetch();
        const interval = setInterval(refetch, 5000);
        return () => clearInterval(interval);
      }
    }, [sessionId, groupId, refetch])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const topPad = Platform.OS === "web" ? 0 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.replace("/(tabs)")} hitSlop={8}>
            <Feather name="home" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {groupName ?? t("items.items")}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {sessionName ?? ""}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>

      {isLoading && !refreshing ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.itemRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1, gap: 8 }}>
                <SkeletonLine width="60%" height={14} />
                <SkeletonLine width="35%" height={12} />
              </View>
              <SkeletonLine width={50} height={18} />
            </View>
          ))}
        </ScrollView>
      ) : error ? (
        <ScrollView
          contentContainerStyle={[styles.centerBox, { flexGrow: 1 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <Feather name="alert-circle" size={28} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Pressable style={[styles.retryBtn, { borderColor: colors.primary }]} onPress={refetch}>
            <Text style={[styles.retryText, { color: colors.primary }]}>{t("items.tryAgain")}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <View style={[styles.summaryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather
              name={groupType === "category" ? "tag" : "map-pin"}
              size={14}
              color={colors.primary}
            />
            <Text style={[styles.summaryText, { color: colors.foreground }]}>
              {t("items.itemCount", { count: items.length, group: groupName })}
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="package" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {t("items.noItemsCounted", { type: groupType })}
              </Text>
            </View>
          ) : (
            <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {items.map((item, i) => (
                <View
                  key={item.id}
                  style={[
                    styles.itemRow,
                    { borderColor: colors.border },
                    i < items.length - 1 && styles.itemRowDivider,
                  ]}
                >
                  <View style={styles.itemLeft}>
                    <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>
                      {item.unit ?? "ea"}
                      {item.categoryName && groupType !== "category"
                        ? ` · ${item.categoryName}`
                        : ""}
                      {item.locationName && groupType !== "location"
                        ? ` · ${item.locationName}`
                        : ""}
                    </Text>
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={[styles.itemQty, { color: colors.primary }]}>
                      {item.quantity}
                    </Text>
                    <Text style={[styles.itemValue, { color: colors.mutedForeground }]}>
                      {formatCurrency(item.value)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
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
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
  },

  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },

  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  itemRowDivider: {
    borderBottomWidth: 1,
  },
  itemLeft: {
    flex: 1,
    gap: 3,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  itemMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  itemRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  itemQty: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  itemValue: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },

  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
