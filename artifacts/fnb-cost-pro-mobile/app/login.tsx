import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
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
import { useBackgroundImages } from "@/hooks/useBackgroundImages";

const logo = require("../assets/images/fnb-logo.png");

const FORGOT_PASSWORD_URL = "https://app.fnbcostpro.com/forgot-password";
const CYCLE_MS = 6000;
const FADE_MS = 1500;

export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { images } = useBackgroundImages();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [displayIdx, setDisplayIdx] = useState(0);
  const [incomingIdx, setIncomingIdx] = useState<number | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const displayIdxRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (images.length <= 1) return;

    const interval = setInterval(() => {
      const next = (displayIdxRef.current + 1) % images.length;
      setIncomingIdx(next);
      fadeAnim.setValue(0);

      animRef.current = Animated.timing(fadeAnim, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      });
      animRef.current.start(({ finished }) => {
        if (finished) {
          displayIdxRef.current = next;
          setDisplayIdx(next);
          setIncomingIdx(null);
          fadeAnim.setValue(0);
        }
      });
    }, CYCLE_MS);

    return () => {
      clearInterval(interval);
      animRef.current?.stop();
    };
  }, [images.length, fadeAnim]);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t("login.errorEmail"));
      return;
    }
    if (!password) {
      setError(t("login.errorPassword"));
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      await login(trimmedEmail, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.errorFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const screenHeight = Dimensions.get("window").height;
  const cardMaxHeight = screenHeight * 0.43;

  const displayUrl = images[displayIdx]?.url ?? null;
  const incomingUrl = incomingIdx !== null ? (images[incomingIdx]?.url ?? null) : null;

  return (
    <View style={styles.root}>
      {displayUrl ? (
        <Image
          source={{ uri: displayUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.bgFallback]} />
      )}

      {incomingUrl ? (
        <Animated.Image
          source={{ uri: incomingUrl }}
          style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim }]}
          resizeMode="cover"
        />
      ) : null}

      <View style={[StyleSheet.absoluteFillObject, styles.overlay]} />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>{t("login.heroTitle")}</Text>
            <Text style={styles.heroSubtitle}>{t("login.heroSubtitle")}</Text>
          </View>
        </View>

        <LinearGradient
          colors={[
            "rgba(255,255,255,0.97)",
            "rgba(255,255,255,0.95)",
            "rgba(255,255,255,0.6)",
            "rgba(255,255,255,0.0)",
          ]}
          locations={[0, 0.55, 0.82, 1]}
          style={[styles.cardOuter, { height: cardMaxHeight }]}
        >
        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          scrollEnabled={false}
        >
          <Text style={styles.cardTitle}>{t("login.cardTitle")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("login.emailLabel")}</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null);
              }}
              placeholder={t("login.emailPlaceholder")}
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              editable={!isLoading}
              testID="email-input"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t("login.passwordLabel")}</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError(null);
                }}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!isLoading}
                testID="password-input"
              />
              <Pressable
                style={styles.eyeBtn}
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={8}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color="#94A3B8"
                />
              </Pressable>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={15} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.loginBtn,
              { opacity: pressed || isLoading ? 0.88 : 1 },
            ]}
            onPress={handleLogin}
            disabled={isLoading}
            testID="login-button"
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>{t("login.loginButton")}</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.forgotBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => Linking.openURL(FORGOT_PASSWORD_URL)}
            testID="forgot-password-button"
          >
            <Text style={styles.forgotText}>{t("login.forgotPassword")}</Text>
          </Pressable>
        </ScrollView>
        </LinearGradient>
        <View style={{ height: screenHeight * 0.12 }} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1B4332",
  },
  bgFallback: {
    backgroundColor: "#1B4332",
  },
  overlay: {
    backgroundColor: "rgba(0, 0, 0, 0.54)",
  },
  content: {
    flex: 1,
  },
  hero: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 36,
    justifyContent: "space-between",
  },
  logo: {
    width: 300,
    height: 100,
    alignSelf: "center",
  },
  heroTextWrap: {
    gap: 10,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.78)",
    lineHeight: 22,
  },
  cardOuter: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  card: {
    flex: 1,
  },
  cardContent: {
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0F172A",
    marginBottom: 2,
    textAlign: "center",
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#374151",
  },
  input: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "rgba(226, 232, 240, 0.7)",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#0F172A",
  },
  passwordWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 46,
  },
  eyeBtn: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    backgroundColor: "#FEF2F2",
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#DC2626",
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  loginBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "#1B4332",
    minHeight: 52,
    marginTop: 4,
  },
  loginBtnText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  forgotBtn: {
    alignItems: "center",
    paddingVertical: 6,
  },
  forgotText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#1B4332",
  },
});
