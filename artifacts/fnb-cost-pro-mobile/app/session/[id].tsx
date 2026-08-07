import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import { useScan } from "@/context/ScanContext";
import { useSessionDetail } from "@/hooks/useSessionDetail";
import { useColors } from "@/hooks/useColors";

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function SkeletonBlock({ width, height, style }: { width: number | `${number}%`; height: number; style?: object }) {
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
      style={[{ width, height, borderRadius: 8, backgroundColor: "#E5E7EB", opacity: anim }, style]}
    />
  );
}

export default function SessionDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setSelectedSessionId } = useScan();
  const { data, isLoading, error, refetch } = useSessionDetail(id ?? "");
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === "web" ? 0 : insets.top;

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      refetch();
      const interval = setInterval(() => {
        refetch();
      }, 5000);
      return () => clearInterval(interval);
    }, [id, refetch])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleScanIntoSession = () => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedSessionId(id);
    router.push("/camera");
  };

  const handleViewGroup = (
    groupType: "category" | "location",
    groupId: string,
    groupName: string
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/session/items",
      params: {
        sessionId: id,
        groupType,
        groupId,
        groupName,
        sessionName: data?.name ?? "",
      },
    });
  };

  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isLoading ? "Loading…" : (data?.name ?? "Inventory Session")}
          </Text>
          <View style={{ width: 40 }} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {isLoading ? (
          <>
            <View style={[styles.statsRow]}>
              <SkeletonBlock width="45%" height={70} style={{ borderRadius: 12 }} />
              <SkeletonBlock width="45%" height={70} style={{ borderRadius: 12 }} />
            </View>
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SkeletonBlock width={120} height={14} style={{ marginBottom: 16 }} />
              <View style={styles.cardGrid}>
                <SkeletonBlock width="47%" height={80} />
                <SkeletonBlock width="47%" height={80} />
              </View>
            </View>
          </>
        ) : error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={24} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            <Pressable style={[styles.retryBtn, { borderColor: colors.primary }]} onPress={refetch}>
              <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: colors.primary }]} numberOfLines={1}>
                  {(data?.totalItems ?? 0) > 0
                    ? `${data?.countedItems ?? 0}/${data!.totalItems}`
                    : String(data?.totalItems ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  Counted
                </Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: colors.primary }]}>
                  {formatCurrency(data?.totalValue ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Value</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {data?.startedAt ? timeAgo(data.startedAt) : "—"}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Started</Text>
              </View>
            </View>

            {categories.length === 0 && locations.length === 0 ? (
              <>
                <View style={[styles.emptySessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.emptySessionIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="clipboard" size={28} color={colors.primary} />
                  </View>
                  <Text style={[styles.emptySessionTitle, { color: colors.foreground }]}>
                    No items counted yet
                  </Text>
                  <Text style={[styles.emptySessionBody, { color: colors.mutedForeground }]}>
                    Use the camera to scan shelves or invoices, or tap{" "}
                    <Text style={{ fontWeight: "700", color: colors.foreground }}>Start Counting</Text>
                    {" "}to enter quantities manually.
                  </Text>

                  <Pressable
                    style={({ pressed }) => [
                      styles.startCountingBtn,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      router.push({
                        pathname: "/session/count-web",
                        params: { sessionId: id ?? "", sessionName: data?.name ?? "" },
                      });
                    }}
                  >
                    <Feather name="edit-3" size={16} color="#fff" />
                    <Text style={styles.startCountingBtnText}>Start Counting</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.scanBtn,
                    { backgroundColor: "#D97706", opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={handleScanIntoSession}
                >
                  <Feather name="camera" size={18} color="#fff" />
                  <Text style={styles.scanBtnText}>Scan Shelves / Invoice</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.actionBtnPrimary,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      router.push({
                        pathname: "/session/count-web",
                        params: { sessionId: id ?? "", sessionName: data?.name ?? "" },
                      });
                    }}
                  >
                    <Feather name="edit-3" size={17} color="#fff" />
                    <Text style={styles.actionBtnText}>Count Items</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.actionBtnAmber,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                    onPress={handleScanIntoSession}
                  >
                    <Feather name="camera" size={17} color="#fff" />
                    <Text style={styles.actionBtnText}>Scan</Text>
                  </Pressable>
                </View>

                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.sectionHeader}>
                    <Feather name="tag" size={15} color={colors.primary} />
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Categories</Text>
                    <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
                      {categories.length}
                    </Text>
                  </View>
                  {categories.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                        No categories yet
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.cardGrid}>
                      {categories.map((cat) => (
                        <Pressable
                          key={cat.id}
                          style={({ pressed }) => [
                            styles.groupCard,
                            { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                          ]}
                          onPress={() => handleViewGroup("category", cat.id, cat.name)}
                          testID={`category-card-${cat.id}`}
                        >
                          <Text style={[styles.groupCardName, { color: colors.foreground }]} numberOfLines={2}>
                            {cat.name}
                          </Text>
                          <View style={styles.groupCardStats}>
                            <Text style={[styles.groupCardCount, { color: colors.primary }]}>
                              {cat.countedItems}/{cat.itemCount} counted
                            </Text>
                          </View>
                          <View style={styles.groupCardArrow}>
                            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.sectionHeader}>
                    <Feather name="map-pin" size={15} color={colors.primary} />
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Locations</Text>
                    <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
                      {locations.length}
                    </Text>
                  </View>
                  {locations.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                        No locations yet
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.cardGrid}>
                      {locations.map((loc) => (
                        <Pressable
                          key={loc.id}
                          style={({ pressed }) => [
                            styles.groupCard,
                            { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                          ]}
                          onPress={() => handleViewGroup("location", loc.id, loc.name)}
                          testID={`location-card-${loc.id}`}
                        >
                          <Text style={[styles.groupCardName, { color: colors.foreground }]} numberOfLines={2}>
                            {loc.name}
                          </Text>
                          <View style={styles.groupCardStats}>
                            <Text style={[styles.groupCardCount, { color: colors.primary }]}>
                              {loc.countedItems}/{loc.itemCount} counted
                            </Text>
                          </View>
                          <View style={styles.groupCardArrow}>
                            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </>
            )}
          </>
        )}
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
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
    textAlign: "center",
  },

  scroll: { flex: 1 },
  content: { padding: 16, gap: 14 },

  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },

  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  scanBtnText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
  },
  actionBtnPrimary: {
    backgroundColor: "#1B4332",
  },
  actionBtnAmber: {
    backgroundColor: "#D97706",
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  section: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  sectionCount: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 10,
  },
  groupCard: {
    width: "47%",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 6,
    position: "relative",
  },
  groupCardName: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    paddingRight: 16,
  },
  groupCardStats: {
    gap: 2,
  },
  groupCardCount: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  groupCardValue: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  groupCardArrow: {
    position: "absolute",
    top: 10,
    right: 10,
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  emptySessionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  emptySessionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptySessionTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  emptySessionBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
  startCountingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 4,
    alignSelf: "stretch",
  },
  startCountingBtnText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  errorBox: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
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
