import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import { useColors } from "@/hooks/useColors";

const DEFAULT_URL = "https://app.fnbcostpro.com";
const DEBOUNCE_MS = 600;

function getDevUrl(): string | null {
  if (__DEV__ && Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return null;
}

function initials(name?: string | null, email?: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (email?.trim()) return email[0].toUpperCase();
  return "?";
}

function toProperCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRole(role?: string | null): string | null {
  if (!role) return null;
  return role
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { backendUrl, setBackendUrl } = useScan();
  const { user, logout, language, setLanguage } = useAuth();
  const [inputValue, setInputValue] = useState(backendUrl);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(backendUrl);
  }, [backendUrl]);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const topPad = Platform.OS === "web" ? 67 : 0;

  const persistUrl = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaveState("saving");
    try {
      await setBackendUrl(trimmed);
      setSaveState("saved");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("idle");
    }
  };

  const handleChangeText = (text: string) => {
    setInputValue(text);
    setSaveState("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistUrl(text);
    }, DEBOUNCE_MS);
  };

  const handleReset = () => {
    Alert.alert(
      t("settings.resetDefault"),
      `${t("settings.resetDefaultMsg")}\n${DEFAULT_URL}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: "Reset",
          onPress: async () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            setInputValue(DEFAULT_URL);
            await persistUrl(DEFAULT_URL);
          },
        },
      ]
    );
  };

  const saveIconName =
    saveState === "saved" ? "check" : saveState === "saving" ? "loader" : "save";
  const saveLabel =
    saveState === "saved"
      ? t("settings.saved")
      : saveState === "saving"
      ? t("settings.saving")
      : t("settings.autoSaves");

  const handleLanguageChange = async (lang: string) => {
    if (lang === language) return;
    Haptics.selectionAsync();
    await setLanguage(lang);
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 8, paddingBottom: bottomPad + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Language section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {t("settings.language")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, paddingVertical: 12 },
          ]}
        >
          <View style={styles.langRow}>
            <Pressable
              style={[
                styles.langBtn,
                language === "en" && { backgroundColor: colors.primary, borderColor: colors.primary },
                language !== "en" && { borderColor: colors.border },
              ]}
              onPress={() => handleLanguageChange("en")}
              testID="lang-en-btn"
            >
              <Text
                style={[
                  styles.langBtnText,
                  { color: language === "en" ? "#fff" : colors.foreground },
                ]}
              >
                {t("settings.english")}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.langBtn,
                language === "es" && { backgroundColor: colors.primary, borderColor: colors.primary },
                language !== "es" && { borderColor: colors.border },
              ]}
              onPress={() => handleLanguageChange("es")}
              testID="lang-es-btn"
            >
              <Text
                style={[
                  styles.langBtnText,
                  { color: language === "es" ? "#fff" : colors.foreground },
                ]}
              >
                {t("settings.spanish")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Backend configuration */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {t("settings.backendConfig")}
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.fieldHeader}>
            <Feather name="server" size={16} color={colors.primary} />
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              {t("settings.backendUrl")}
            </Text>
            <View style={[styles.savePill, {
              backgroundColor: saveState === "saved" ? colors.secondary : colors.muted,
            }]}>
              <Feather
                name={saveIconName}
                size={11}
                color={saveState === "saved" ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.savePillText, {
                color: saveState === "saved" ? colors.primary : colors.mutedForeground,
              }]}>
                {saveLabel}
              </Text>
            </View>
          </View>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.muted,
                borderColor: saveState === "saved"
                  ? colors.primary
                  : inputValue !== backendUrl
                  ? colors.accent
                  : colors.border,
                color: colors.foreground,
              },
            ]}
            value={inputValue}
            onChangeText={handleChangeText}
            placeholder="https://app.fnbcostpro.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            testID="backend-url-input"
          />

          <Text style={[styles.fieldDesc, { color: colors.mutedForeground }]}>
            {t("settings.imagesDesc")}{" "}
            <Text style={{ color: colors.primary }}>
              {(inputValue.trim() || DEFAULT_URL).replace(/\/$/, "")}/api/mobile/sweep-scan
            </Text>
          </Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.resetBtn,
          {
            borderColor: colors.border,
            backgroundColor: colors.background,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
        onPress={handleReset}
      >
        <Feather name="rotate-ccw" size={16} color={colors.mutedForeground} />
        <Text style={[styles.resetBtnText, { color: colors.mutedForeground }]}>
          {t("settings.resetDefault")}
        </Text>
      </Pressable>

      {__DEV__ && getDevUrl() ? (
        <Pressable
          style={({ pressed }) => [
            styles.resetBtn,
            {
              borderColor: colors.primary,
              backgroundColor: colors.secondary,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
          onPress={() => {
            const devUrl = getDevUrl();
            if (!devUrl) return;
            Alert.alert(
              t("settings.switchDevServer"),
              `${t("settings.switchDevServerMsg")}\n${devUrl}`,
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: "Switch",
                  onPress: async () => {
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    setInputValue(devUrl);
                    await persistUrl(devUrl);
                  },
                },
              ]
            );
          }}
        >
          <Feather name="zap" size={16} color={colors.primary} />
          <Text style={[styles.resetBtnText, { color: colors.primary }]}>
            {t("settings.resetDevServer")}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {t("settings.about")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {[
            { labelKey: "settings.aboutApp", value: "FNB Cost Pro Mobile" },
            { labelKey: "settings.aboutEndpoint", value: "/api/mobile/sweep-scan" },
            { labelKey: "settings.aboutMethod", value: "POST (multipart/form-data)" },
            { labelKey: "settings.aboutModel", value: "GPT-4o" },
          ].map(({ labelKey, value }, i, arr) => (
            <View
              key={labelKey}
              style={[
                styles.infoRow,
                i < arr.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
                {t(labelKey)}
              </Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {t("settings.account")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.avatarHeader, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>
                {initials(user?.name, user?.email)}
              </Text>
            </View>
            <View style={styles.avatarInfo}>
              {user?.name ? (
                <Text style={[styles.avatarName, { color: colors.foreground }]} numberOfLines={1}>
                  {toProperCase(user.name)}
                </Text>
              ) : null}
              <Text style={[styles.avatarEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
                {user?.email ?? ""}
              </Text>
              {formatRole(user?.role) ? (
                <View style={[styles.rolePill, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.rolePillText, { color: colors.primary }]}>
                    {formatRole(user?.role)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.logoutRow,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => {
              Alert.alert(
                t("settings.signOut"),
                t("settings.signOutConfirm"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("settings.signOut"),
                    style: "destructive",
                    onPress: async () => {
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Warning
                      );
                      await logout();
                    },
                  },
                ]
              );
            }}
            testID="logout-button"
          >
            <Feather name="log-out" size={16} color="#DC2626" />
            <Text style={styles.logoutText}>{t("settings.signOut")}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  langRow: {
    flexDirection: "row",
    gap: 10,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  langBtnText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  savePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  savePillText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  input: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  fieldDesc: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  infoValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
    flex: 1,
  },
  avatarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingBottom: 14,
    marginBottom: 2,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1B4332",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.5,
  },
  avatarInfo: {
    flex: 1,
    gap: 3,
  },
  avatarName: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  avatarEmail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  rolePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    marginTop: 2,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#DC2626",
  },
});
