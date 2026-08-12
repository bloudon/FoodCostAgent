import { Feather } from "@expo/vector-icons";
import { CameraType, CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useScan } from "@/context/ScanContext";
import { useColors } from "@/hooks/useColors";

const MAX_FRAMES = 5;

export default function CameraScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { backendUrl, setLastResult, selectedSessionId, setSelectedSessionId, selectedItemId, setSelectedItemId, setSelectedItemName, selectedItemIsCatchWeight, setSelectedItemIsCatchWeight, scanCategoryId, scanLocationId } = useScan();
  const { getToken, handleUnauthorized } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("back");
  const [isUploading, setIsUploading] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);

  const isCatchWeight = !!(selectedItemId && selectedItemIsCatchWeight);
  const effectiveMax = isCatchWeight ? 1 : MAX_FRAMES;
  const frameCount = frames.length;
  const atMax = frameCount >= effectiveMax;
  const sweepInitiated = useRef(false);

  useEffect(() => {
    return () => {
      if (!sweepInitiated.current) {
        setSelectedItemId(null);
        setSelectedItemName(null);
        setSelectedItemIsCatchWeight(false);
      }
    };
  }, [setSelectedItemId, setSelectedItemName, setSelectedItemIsCatchWeight]);

  useEffect(() => {
    if (selectedSessionId) return;
    getToken().then((token) => {
      return fetchWithAuth(
        `${backendUrl}/api/mobile/sessions/active`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        handleUnauthorized
      );
    }).then((res) => {
      if (res && res.ok) return res.json();
    }).then((data) => {
      const id = Array.isArray(data) ? data[0]?.id : data?.id;
      if (id) setSelectedSessionId(id);
    }).catch(() => {});
  }, []);

  const sweepImages = async (uris: string[]) => {
    sweepInitiated.current = true;
    setIsUploading(true);
    let navigateToResults = false;
    try {
      const formData = new FormData();
      for (let i = 0; i < uris.length; i++) {
        formData.append("image", {
          uri: uris[i],
          name: `image_${i}.jpg`,
          type: "image/jpeg",
        } as unknown as Blob);
      }
      if (selectedSessionId) {
        formData.append("sessionId", selectedSessionId);
      }
      if (selectedItemId) {
        formData.append("itemId", selectedItemId);
        if (isCatchWeight) {
          formData.append("lineId", selectedItemId);
        }
      } else if (scanCategoryId) {
        formData.append("categoryId", scanCategoryId);
      } else if (scanLocationId) {
        formData.append("locationId", scanLocationId);
      }

      const url = isCatchWeight
        ? `${backendUrl}/api/mobile/catch-weight-scan`
        : `${backendUrl}/api/mobile/sweep-scan`;
      const authToken = await getToken();

      const xhrResult = await new Promise<{ status: number; contentType: string; body: string }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", url);
          if (authToken) {
            xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
          }
          xhr.onload = () =>
            resolve({
              status: xhr.status,
              contentType: xhr.getResponseHeader("content-type") ?? "",
              body: xhr.responseText,
            });
          xhr.onerror = () => reject(new Error("Network request failed"));
          xhr.send(formData);
        }
      );

      if (xhrResult.status === 401) {
        let reauthenticate = false;
        try {
          const body = JSON.parse(xhrResult.body) as Record<string, unknown>;
          reauthenticate = body.reauthenticate === true;
        } catch { /* non-JSON body — treat as plain 401 */ }
        await handleUnauthorized(reauthenticate);
        return;
      }

      let data: unknown;
      if (xhrResult.contentType.includes("application/json")) {
        try { data = JSON.parse(xhrResult.body); } catch { data = xhrResult.body; }
      } else {
        data = xhrResult.body;
      }

      setLastResult({
        success: xhrResult.status >= 200 && xhrResult.status < 300,
        statusCode: xhrResult.status,
        data,
      });
      navigateToResults = true;
    } catch (error) {
      setLastResult({
        success: false,
        error:
          error instanceof Error ? error.message : "Upload failed. Check your connection.",
      });
      navigateToResults = true;
    } finally {
      setIsUploading(false);
      if (navigateToResults) {
        setFrames([]);
        router.replace("/results");
      }
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current || isUploading || atMax) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
      skipProcessing: false,
    });
    if (photo) {
      if (isCatchWeight) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        sweepImages([photo.uri]);
      } else {
        setFrames((prev) => [...prev, photo.uri]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };

  const handleLibrary = async () => {
    if (isUploading || atMax) return;
    const maxAdd = MAX_FRAMES - frameCount;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: maxAdd,
      // Expo's iOS default preserves the original HEIC. Request the compatible
      // representation so uploads are JPEG where iOS can provide one; the API
      // still validates and normalizes by file bytes as a safety net.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
    });
    if (!result.canceled && result.assets.length > 0) {
      setFrames((prev) =>
        [...prev, ...result.assets.map((a) => a.uri)].slice(0, MAX_FRAMES)
      );
    }
  };

  const handleRemoveFrame = (index: number) => {
    setFrames((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSweep = () => {
    if (frameCount === 0 || isUploading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    sweepImages(frames);
  };

  const ThumbStrip = () => (
    <ScrollView
      horizontal
      style={styles.thumbStrip}
      contentContainerStyle={styles.thumbContent}
      showsHorizontalScrollIndicator={false}
    >
      {frames.map((uri, i) => (
        <View key={i} style={styles.thumbWrap}>
          <Image source={{ uri }} style={styles.thumb} />
          <Pressable
            style={styles.removeBtn}
            onPress={() => handleRemoveFrame(i)}
            hitSlop={6}
          >
            <Feather name="x" size={10} color="#fff" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );

  if (Platform.OS === "web") {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.muted }]}>
            <Feather name="camera-off" size={40} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.permTitle, { color: colors.foreground }]}>
            {t("camera.webUnavailable")}
          </Text>
          <Text style={[styles.permSubtitle, { color: colors.mutedForeground }]}>
            {t("camera.webSubtitle", { max: MAX_FRAMES })}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                opacity: pressed || isUploading || atMax ? 0.6 : 1,
              },
            ]}
            onPress={handleLibrary}
            disabled={isUploading || atMax}
          >
            <Feather name="image" size={18} color={colors.primaryForeground} />
            <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
              {atMax
                ? t("camera.framesOf", { count: MAX_FRAMES, max: MAX_FRAMES })
                : `${t("camera.chooseLibraryShort")} (${frameCount}/${MAX_FRAMES})`}
            </Text>
          </Pressable>
        </View>

        {frameCount > 0 && (
          <View style={styles.webFrameArea}>
            <ThumbStrip />
            <Pressable
              style={({ pressed }) => [
                styles.webScanBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || isUploading ? 0.8 : 1,
                },
              ]}
              onPress={handleSweep}
              disabled={isUploading}
            >
              {isUploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="send" size={18} color="#fff" />
                  <Text style={styles.webScanBtnText}>
                    {t("camera.scanFrames", { count: frameCount })}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
            <Feather name="camera" size={40} color={colors.primary} />
          </View>
          <Text style={[styles.permTitle, { color: colors.foreground }]}>
            {t("camera.permTitle")}
          </Text>
          <Text style={[styles.permSubtitle, { color: colors.mutedForeground }]}>
            {t("camera.permSubtitle")}
          </Text>
          {permission.canAskAgain ? (
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}
              onPress={requestPermission}
            >
              <Feather name="camera" size={18} color={colors.primaryForeground} />
              <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
                {t("camera.allowAccess")}
              </Text>
            </Pressable>
          ) : (
            <View style={[styles.deniedBox, { backgroundColor: colors.muted }]}>
              <Text style={[styles.deniedText, { color: colors.mutedForeground }]}>
                {t("camera.permDenied")}
              </Text>
            </View>
          )}
          <Pressable
            style={[styles.libraryLink, (isUploading || atMax) && { opacity: 0.5 }]}
            onPress={handleLibrary}
            disabled={isUploading || atMax}
          >
            <Text style={[styles.libraryLinkText, { color: colors.primary }]}>
              {atMax ? t("camera.framesOf", { count: MAX_FRAMES, max: MAX_FRAMES }) : t("camera.chooseLibrary")}
            </Text>
          </Pressable>
        </View>

        {frameCount > 0 && (
          <View style={styles.webFrameArea}>
            <ThumbStrip />
            <Pressable
              style={({ pressed }) => [
                styles.webScanBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || isUploading ? 0.8 : 1,
                },
              ]}
              onPress={handleSweep}
              disabled={isUploading}
            >
              <Feather name="send" size={18} color="#fff" />
              <Text style={styles.webScanBtnText}>
                {t("camera.scanFrames", { count: frameCount })}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const scanHint = isCatchWeight
    ? t("camera.hintCatchWeight")
    : frameCount === 0
    ? t("camera.hintPosition")
    : atMax
    ? t("camera.hintAtMax", { max: MAX_FRAMES })
    : t("camera.hintAddAnother", { count: frameCount, max: MAX_FRAMES });

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
        <View style={styles.overlay}>
          {isCatchWeight ? (
            <View style={styles.catchWeightGuideWrap}>
              <Text style={styles.catchWeightLabel}>{t("camera.catchWeightLabel")}</Text>
              <View style={styles.catchWeightFrame}>
                <View style={[styles.catchCorner, styles.cwTopLeft]} />
                <View style={[styles.catchCorner, styles.cwTopRight]} />
                <View style={[styles.catchCorner, styles.cwBottomLeft]} />
                <View style={[styles.catchCorner, styles.cwBottomRight]} />
              </View>
              <Text style={styles.scanHint}>{scanHint}</Text>
            </View>
          ) : (
            <>
              {frameCount > 0 && (
                <View style={styles.framePill}>
                  <Feather name="layers" size={12} color="#fff" />
                  <Text style={styles.framePillText}>
                    {t("camera.framesOf", { count: frameCount, max: MAX_FRAMES })}
                  </Text>
                </View>
              )}
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
              <Text style={styles.scanHint}>{scanHint}</Text>
            </>
          )}
        </View>

        {isUploading && (
          <View style={styles.uploadingOverlay}>
            <View style={styles.uploadingCard}>
              <ActivityIndicator size="large" color="#1B4332" />
              <Text style={styles.uploadingTitle}>
                {isCatchWeight
                  ? t("camera.readingLabel")
                  : t("camera.analysingFrames", { count: frameCount })}
              </Text>
              <Text style={styles.uploadingSubtitle}>
                {t("camera.processingImages")}
              </Text>
            </View>
          </View>
        )}

        {frameCount > 0 && !isUploading && (
          <ScrollView
            horizontal
            style={styles.nativeThumbStrip}
            contentContainerStyle={styles.thumbContent}
            showsHorizontalScrollIndicator={false}
          >
            {frames.map((uri, i) => (
              <View key={i} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => handleRemoveFrame(i)}
                  hitSlop={6}
                >
                  <Feather name="x" size={10} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
          {isCatchWeight ? (
            <View style={styles.sidePlaceholder} />
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.sideBtn,
                { opacity: pressed || isUploading || atMax ? 0.5 : 1 },
              ]}
              onPress={handleLibrary}
              disabled={isUploading || atMax}
              testID="library-button"
            >
              <Feather name="image" size={22} color="white" />
              <Text style={styles.sideBtnLabel}>{t("camera.library")}</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.captureBtn,
              isCatchWeight && { borderColor: "#FCD34D" },
              { opacity: pressed || isUploading ? 0.5 : 1 },
            ]}
            onPress={handleCapture}
            disabled={isUploading}
            testID="capture-button"
          >
            <View
              style={[
                styles.captureBtnInner,
                isCatchWeight && { backgroundColor: "#FCD34D" },
              ]}
            />
          </Pressable>

          {isCatchWeight ? (
            <View style={styles.sidePlaceholder} />
          ) : frameCount > 0 ? (
            <Pressable
              style={({ pressed }) => [
                styles.sideBtn,
                { opacity: pressed || isUploading ? 0.7 : 1 },
              ]}
              onPress={handleSweep}
              disabled={isUploading}
              testID="sweep-button"
            >
              <Feather name="send" size={22} color="#D97706" />
              <Text style={[styles.sideBtnLabel, { color: "#D97706" }]}>
                {t("camera.scan")} ({frameCount})
              </Text>
            </Pressable>
          ) : (
            <View style={styles.sidePlaceholder} />
          )}
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 36,
    gap: 16,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },
  permSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  deniedBox: {
    borderRadius: 10,
    padding: 16,
    marginTop: 4,
  },
  deniedText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  libraryLink: {
    padding: 10,
  },
  libraryLinkText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  webFrameArea: {
    paddingBottom: 24,
    gap: 12,
  },
  thumbStrip: {
    backgroundColor: "rgba(0,0,0,0.08)",
    paddingVertical: 8,
  },
  nativeThumbStrip: {
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 8,
  },
  thumbContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  thumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: "hidden",
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  removeBtn: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  webScanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
  },
  webScanBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  framePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  framePillText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  scanFrame: {
    width: 270,
    height: 270,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "white",
    borderRadius: 3,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scanHint: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  catchWeightGuideWrap: {
    alignItems: "center",
    gap: 14,
    width: "100%",
    paddingHorizontal: 24,
  },
  catchWeightLabel: {
    color: "#FCD34D",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  catchWeightFrame: {
    width: "90%",
    height: 90,
    position: "relative",
  },
  catchCorner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#FCD34D",
    borderRadius: 3,
  },
  cwTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cwTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cwBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cwBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadingCard: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 36,
    alignItems: "center",
    gap: 12,
    width: 240,
  },
  uploadingTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  uploadingSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 48,
    paddingTop: 28,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  captureBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "white",
  },
  sideBtn: {
    alignItems: "center",
    gap: 4,
    width: 52,
  },
  sideBtnLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  sidePlaceholder: {
    width: 52,
  },
});
