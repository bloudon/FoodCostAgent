import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import WebSection from "@/components/WebSection";

/**
 * Waste tab: the web Waste page plus the native voice-capture entry point.
 * The mic button opens the native recording flow; its handoff back to the
 * web page happens on the dedicated waste-web stack screen (bridge protocol).
 */
export default function WasteScreen() {
  return (
    <View style={styles.root}>
      <WebSection path="/waste" label="Waste" />
      <Pressable
        style={({ pressed }) => [styles.voiceFab, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push("/voice-waste")}
        testID="voice-waste-fab"
        accessibilityLabel="Record a voice waste report"
      >
        <Feather name="mic" size={20} color="#fff" />
        <Text style={styles.voiceFabLabel}>Voice</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  voiceFab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    flexDirection: "row",
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    gap: 8,
    backgroundColor: "#1B4332",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  voiceFabLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
