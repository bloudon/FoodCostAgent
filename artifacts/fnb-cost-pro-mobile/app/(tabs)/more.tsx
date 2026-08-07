import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Item = {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  testID: string;
};

/**
 * "More" tab — secondary destinations that don't fit in the footer, mirroring
 * the ••• item at the bottom of the main app's sidebar.
 */
export default function MoreScreen() {
  const colors = useColors();

  const webItems: Item[] = [
    {
      icon: "box",
      label: "Inventory Items",
      onPress: () =>
        router.push({ pathname: "/web-section", params: { path: "/inventory-items", title: "Inventory Items" } }),
      testID: "more-inventory-items",
    },
    {
      icon: "file-text",
      label: "Shelf Scans",
      onPress: () =>
        router.push({ pathname: "/web-section", params: { path: "/shelf-scans", title: "Shelf Scans" } }),
      testID: "more-shelf-scans",
    },
    {
      icon: "map-pin",
      label: "Stores",
      onPress: () =>
        router.push({ pathname: "/web-section", params: { path: "/stores", title: "Stores" } }),
      testID: "more-stores",
    },
  ];

  const nativeItems: Item[] = [
    {
      icon: "camera",
      label: "Scan Inventory",
      onPress: () => router.push("/camera"),
      testID: "more-scan",
    },
    {
      icon: "settings",
      label: "Settings",
      onPress: () => router.push("/settings"),
      testID: "more-settings",
    },
  ];

  const renderGroup = (items: Item[]) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {items.map((item, i) => (
        <Pressable
          key={item.testID}
          style={({ pressed }) => [
            styles.row,
            i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={item.onPress}
          testID={item.testID}
        >
          <Feather name={item.icon} size={18} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </View>
  );

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>More</Text>
      {renderGroup(webItems)}
      {renderGroup(nativeItems)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingTop: 60, gap: 16 },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
