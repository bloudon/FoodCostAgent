import { Feather } from "@expo/vector-icons";
import { CameraType, CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useScan } from "@/context/ScanContext";

type Confidence = "high" | "medium" | "low";

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
  if (!isNaN(netWeightN) && netWeightN > 0) return Math.round(netWeightN * 100) / 100;
  const candidates = [obj["items"], obj["inventory"], obj["results"], obj["data"]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      for (const element of candidate) {
        if (element && typeof element === "object") {
          const item = element as Record<string, unknown>;
          const raw = item["weight"] ?? item["qty"] ?? item["quantity"] ?? item["count"] ?? item["amount"];
          const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
          if (!isNaN(n) && n > 0) return Math.round(n * 100) / 100;
        }
      }
    }
  }
  const topRaw = obj["weight"] ?? obj["qty"] ?? obj["quantity"] ?? obj["count"];
  const topN = typeof topRaw === "number" ? topRaw : typeof topRaw === "string" ? parseFloat(topRaw) : NaN;
  if (!isNaN(topN) && topN > 0) return Math.round(topN * 100) / 100;
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

type ScanState =
  | { phase: "camera" }
  | { phase: "uploading" }
  | { phase: "result"; weight: number; unit: string | null; confidence: Confidence | null }
  | { phase: "error"; message: string }
  | { phase: "saving" }
  | { phase: "saved"; newCount: number; unit: string | null };

interface CatchWeightScanModalProps {
  visible: boolean;
  itemId: string;
  lineId: string;
  itemName: string;
  sessionId: string;
  currentCount: number;
  onClose: () => void;
  onWeightApplied: (lineId: string, newCount: number) => void;
  onWeightRead?: (netWeight: number) => void;
  autoCapture?: boolean;
}

export default function CatchWeightScanModal({
  visible,
  itemId,
  lineId,
  itemName,
  sessionId,
  currentCount,
  onClose,
  onWeightApplied,
  onWeightRead,
  autoCapture = false,
}: CatchWeightScanModalProps) {
  const insets = useSafeAreaInsets();
  const { backendUrl } = useScan();
  const { getToken, handleUnauthorized } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing] = useState<CameraType>("back");
  const [scanState, setScanState] = useState<ScanState>({ phase: "camera" });
  const sheetAnim = useRef(new Animated.Value(0)).current;
  // Tracks user-edited weight for medium/low confidence flows (null = use extracted value)
  const [editedWeight, setEditedWeight] = useState<string | null>(null);
  // Auto-capture countdown (null = not running, 0 = fire now, 1-2 = display)
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Prevents countdown from re-arming while a capture/upload is already in flight
  const isCapturingRef = useRef(false);
  // Ref always pointing to latest handleCapture to avoid stale closure in countdown fire
  const handleCaptureRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!visible) {
      setScanState({ phase: "camera" });
      sheetAnim.setValue(0);
      setEditedWeight(null);
      setCountdown(null);
      isCapturingRef.current = false;
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
  }, [visible, sheetAnim]);

  // Keep handleCaptureRef in sync so the countdown fire effect always calls the latest version
  useEffect(() => {
    handleCaptureRef.current = handleCapture;
  });

  // Start auto-capture countdown when modal opens in sweep-review mode
  useEffect(() => {
    if (!visible || !autoCapture || !permission?.granted || Platform.OS === "web") return;
    if (scanState.phase !== "camera") return;
    if (countdownIntervalRef.current !== null) return; // already running
    if (isCapturingRef.current) return; // capture already in flight, don't re-arm

    setCountdown(2);
    let intervalId: ReturnType<typeof setInterval>;
    intervalId = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(intervalId);
          countdownIntervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    countdownIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      countdownIntervalRef.current = null;
    };
  }, [visible, autoCapture, permission?.granted, scanState.phase]);

  // Fire capture when countdown reaches 0
  useEffect(() => {
    if (countdown !== 0) return;
    setCountdown(null);
    handleCaptureRef.current();
  }, [countdown]);

  const showSheet = useCallback(() => {
    Animated.spring(sheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [sheetAnim]);

  const hideSheet = useCallback((cb?: () => void) => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => cb?.());
  }, [sheetAnim]);

  const sendCatchWeightRequest = useCallback(
    async (uri: string): Promise<{ status: number; data: unknown }> => {
      const formData = new FormData();
      formData.append("image", {
        uri,
        name: "image_0.jpg",
        type: "image/jpeg",
      } as unknown as Blob);
      formData.append("sessionId", sessionId);
      formData.append("itemId", itemId);
      formData.append("lineId", lineId);

      const authToken = await getToken();
      const url = `${backendUrl}/api/mobile/catch-weight-scan`;

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
        return { status: 401, data: null };
      }

      let data: unknown;
      if (xhrResult.contentType.includes("application/json")) {
        try { data = JSON.parse(xhrResult.body); } catch { data = xhrResult.body; }
      } else {
        data = xhrResult.body;
      }
      return { status: xhrResult.status, data };
    },
    [sessionId, itemId, lineId, backendUrl, getToken, handleUnauthorized]
  );

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || scanState.phase !== "camera") return;
    if (isCapturingRef.current) return; // prevent double-fire from race
    isCapturingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.65,
        skipProcessing: true,
      });
      if (!photo) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanState({ phase: "uploading" });
      setEditedWeight(null);

      try {
        const { status, data } = await sendCatchWeightRequest(photo.uri);

        if (status >= 200 && status < 300) {
          const weight = parseCatchWeight(data);
          if (weight !== null) {
            const confidence = parseCatchWeightConfidence(data);
            const unit = parseCatchWeightUnit(data);
            // Auto-apply in sweep-review (onWeightRead) mode — skip the sheet for high/low
            // confidence so the weight fills in immediately. Null confidence (AI uncertain)
            // still shows the sheet so the user can verify before the value is committed.
            if (onWeightRead && (confidence === "high" || confidence === "low")) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onWeightRead(weight);
              return;
            }
            setScanState({ phase: "result", weight, unit, confidence });
            showSheet();
          } else {
            setScanState({ phase: "error", message: "Could not read weight from label. Try again." });
            showSheet();
          }
        } else if (status !== 401) {
          setScanState({
            phase: "error",
            message: `Server returned an error (${status}). Try again.`,
          });
          showSheet();
        }
      } catch (err) {
        setScanState({
          phase: "error",
          message: err instanceof Error ? err.message : "Upload failed. Check your connection.",
        });
        showSheet();
      }
    } finally {
      isCapturingRef.current = false;
    }
  }, [scanState, sendCatchWeightRequest, showSheet, onWeightRead]);

  const handleConfirm = useCallback(async () => {
    if (scanState.phase !== "result") return;
    setScanState({ phase: "saving" });

    const extractedWeight = scanState.weight;
    const scanUnit = scanState.unit;
    const weightToApply = editedWeight !== null
      ? Math.round(parseFloat(editedWeight) * 100) / 100
      : extractedWeight;

    if (isNaN(weightToApply) || weightToApply <= 0) {
      setScanState({ phase: "error", message: "Invalid weight value. Please enter a positive number." });
      return;
    }

    if (onWeightRead) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      hideSheet(() => onWeightRead(weightToApply));
      return;
    }

    try {
      // Always PATCH directly — the weight was already read and verified by the first
      // GPT-4o call (shown to the user on screen).  Re-uploading the image for a
      // second GPT-4o round-trip is redundant and adds ~2–4 s per scan.
      // PATCH /api/mobile/sessions/:id/lines/:lineId accumulates atomically and writes
      // an audit entry, so this is exactly equivalent to the previous "apply" path.
      const token = await getToken();
      const res = await fetchWithAuth(
        `${backendUrl}/api/mobile/sessions/${sessionId}/lines/${lineId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ addQty: weightToApply }),
        },
        handleUnauthorized
      );
      if (res.status === 401) { return; } // handleUnauthorized already called by fetchWithAuth
      if (res.status === 403) {
        setScanState({ phase: "error", message: "Session is locked or you are not assigned to this store." });
        return;
      }
      if (res.ok) {
        const responseData = await res.json().catch(() => ({}));
        const newQty =
          typeof responseData?.qty === "number"
            ? responseData.qty
            : Math.round((currentCount + weightToApply) * 100) / 100;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setScanState({ phase: "saved", newCount: newQty, unit: scanUnit });
        onWeightApplied(lineId, newQty);
        setTimeout(() => hideSheet(() => onClose()), 900);
      } else {
        setScanState({ phase: "error", message: `Failed to save weight. (${res.status})` });
      }
    } catch {
      setScanState({ phase: "error", message: "Network error. Could not save weight." });
    }
  }, [scanState, editedWeight, currentCount, backendUrl, getToken, handleUnauthorized, sessionId, lineId, onWeightApplied, onClose, hideSheet, onWeightRead]);

  const handleDiscard = useCallback(() => {
    hideSheet(() => {
      setScanState({ phase: "camera" });
      setEditedWeight(null);
    });
  }, [hideSheet]);

  const handleClose = useCallback(() => {
    hideSheet(() => {
      onClose();
    });
  }, [hideSheet, onClose]);

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [320, 0],
  });

  const isSheetVisible =
    scanState.phase === "result" ||
    scanState.phase === "error" ||
    scanState.phase === "saving" ||
    scanState.phase === "saved";

  const renderCamera = () => {
    if (Platform.OS === "web") {
      return (
        <View style={styles.webPlaceholder}>
          <Feather name="camera-off" size={40} color="rgba(255,255,255,0.5)" />
          <Text style={styles.webPlaceholderText}>Camera not available on web</Text>
          <Pressable style={styles.closeBtn} onPress={handleClose}>
            <Feather name="x" size={20} color="#fff" />
          </Pressable>
        </View>
      );
    }

    if (!permission) {
      return (
        <View style={styles.permContainer}>
          <ActivityIndicator color="#fff" />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={styles.permContainer}>
          <Feather name="camera" size={40} color="#fff" style={{ marginBottom: 16 }} />
          <Text style={styles.permTitle}>Camera Access Required</Text>
          <Text style={styles.permSubtitle}>
            Allow camera access to scan catch-weight labels.
          </Text>
          {permission.canAskAgain ? (
            <Pressable style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Allow Camera</Text>
            </Pressable>
          ) : (
            <Text style={styles.permDenied}>
              Camera permission denied. Enable it in Settings.
            </Text>
          )}
          <Pressable style={styles.closeBtnAbs} onPress={handleClose} hitSlop={8}>
            <Feather name="x" size={20} color="#fff" />
          </Pressable>
        </View>
      );
    }

    return (
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing}>
        <View style={styles.cameraOverlay}>
          <View style={styles.cwGuideWrap}>
            <Text style={styles.cwLabel}>⚖ Catch Weight</Text>
            <Text style={styles.cwItemName} numberOfLines={1}>{itemName}</Text>
            <View style={styles.cwFrame}>
              <View style={[styles.cwCorner, styles.cwTopLeft]} />
              <View style={[styles.cwCorner, styles.cwTopRight]} />
              <View style={[styles.cwCorner, styles.cwBottomLeft]} />
              <View style={[styles.cwCorner, styles.cwBottomRight]} />
            </View>
            <Text style={styles.cwHint}>
              {autoCapture ? "Hold steady — scanning automatically" : "Align thermal label within the guide"}
            </Text>
          </View>
        </View>

        {scanState.phase === "uploading" && (
          <View style={styles.uploadingOverlay}>
            <View style={styles.uploadingCard}>
              <ActivityIndicator size="large" color="#1B4332" />
              <Text style={styles.uploadingTitle}>Reading label weight…</Text>
              <Text style={styles.uploadingSubtitle}>GPT-4o is processing your image</Text>
            </View>
          </View>
        )}

        <Pressable style={styles.closeBtnAbs} onPress={handleClose} hitSlop={8}>
          <Feather name="x" size={20} color="#fff" />
        </Pressable>

        {scanState.phase === "camera" && (
          <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
            {autoCapture && countdown !== null ? (
              <>
                <View style={styles.countdownCircle}>
                  <Text style={styles.countdownNum}>{countdown}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (countdownIntervalRef.current) {
                      clearInterval(countdownIntervalRef.current);
                      countdownIntervalRef.current = null;
                    }
                    setCountdown(null);
                    handleCapture();
                  }}
                  style={styles.scanNowBtn}
                  testID="cw-scan-now-btn"
                >
                  <Feather name="zap" size={14} color="#000" />
                  <Text style={styles.scanNowText}>Scan now</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={styles.captureBtn}
                onPress={handleCapture}
                testID="cw-modal-capture-btn"
              >
                <View style={[styles.captureBtnInner, { backgroundColor: "#FCD34D" }]} />
              </Pressable>
            )}
          </View>
        )}
      </CameraView>
    );
  };

  const renderSheet = () => {
    if (!isSheetVisible) return null;

    return (
      <Animated.View
        style={[
          styles.bottomSheet,
          { paddingBottom: insets.bottom + 16, transform: [{ translateY: sheetTranslateY }] },
        ]}
        testID="cw-result-sheet"
      >
        {scanState.phase === "result" && (() => {
          const conf = scanState.confidence;
          const isLow = conf === "low";
          const isMedium = conf === "medium";
          const isEditable = isLow || isMedium;
          const displayWeight = editedWeight ?? scanState.weight.toFixed(2);
          const confBg = conf === "high" ? "#DCFCE7" : conf === "medium" ? "#FEF3C7" : "#FEE2E2";
          const confColor = conf === "high" ? "#166534" : conf === "medium" ? "#92400E" : "#991B1B";
          return (
            <>
              <View style={styles.sheetHandle} />

              {/* Low confidence warning banner */}
              {isLow && (
                <View style={styles.lowConfWarning}>
                  <Feather name="alert-triangle" size={14} color="#991B1B" />
                  <Text style={styles.lowConfWarningText}>
                    Low confidence — please verify before applying
                  </Text>
                </View>
              )}

              <View style={styles.sheetHeader}>
                <View style={styles.sheetIconWrap}>
                  <Text style={styles.sheetIcon}>⚖</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>Label Scanned</Text>
                  <Text style={styles.sheetItemName} numberOfLines={1}>{itemName}</Text>
                </View>
                {conf && (
                  <View style={[styles.confidenceBadge, { backgroundColor: confBg }]}>
                    <Text style={[styles.confidenceText, { color: confColor }]}>
                      {conf} confidence
                    </Text>
                  </View>
                )}
              </View>

              {/* Weight — read-only for high, editable for medium/low */}
              <View style={styles.weightRow}>
                <Text style={styles.weightLabel}>Read Weight</Text>
                {isEditable ? (
                  <View style={styles.weightEditRow}>
                    <TextInput
                      style={styles.weightInput}
                      value={displayWeight}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9.]/g, "");
                        const parts = clean.split(".");
                        const sanitised =
                          parts.length > 1
                            ? parts[0] + "." + parts.slice(1).join("").slice(0, 2)
                            : clean;
                        setEditedWeight(sanitised);
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      testID="cw-weight-input"
                    />
                    <Text style={styles.weightUnitLabel}>{scanState.unit ?? "lbs"}</Text>
                  </View>
                ) : (
                  <Text style={styles.weightValue}>
                    {scanState.weight.toFixed(2)} {scanState.unit ?? "lbs"}
                  </Text>
                )}
              </View>

              <View style={styles.sheetActions}>
                <Pressable
                  style={({ pressed }) => [styles.discardBtn, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={handleDiscard}
                  testID="cw-discard-btn"
                >
                  <Feather name="rotate-ccw" size={16} color="#6B7280" />
                  <Text style={styles.discardBtnText}>Discard</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.confirmBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={handleConfirm}
                  testID="cw-confirm-btn"
                >
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.confirmBtnText}>
                    {isMedium ? "Confirm Weight" : "Apply Weight"}
                  </Text>
                </Pressable>
              </View>
            </>
          );
        })()}

        {scanState.phase === "saving" && (
          <>
            <View style={styles.sheetHandle} />
            <View style={styles.savingRow}>
              <ActivityIndicator color="#1B4332" />
              <Text style={styles.savingText}>Saving weight…</Text>
            </View>
          </>
        )}

        {scanState.phase === "saved" && (
          <>
            <View style={styles.sheetHandle} />
            <View style={styles.savedRow}>
              <View style={styles.savedIcon}>
                <Feather name="check-circle" size={22} color="#16A34A" />
              </View>
              <View>
                <Text style={styles.savedTitle}>Weight Applied</Text>
                <Text style={styles.savedSub}>
                  New total: {scanState.newCount.toFixed(2)} {scanState.unit ?? "lbs"}
                </Text>
              </View>
            </View>
          </>
        )}

        {scanState.phase === "error" && (
          <>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIconWrap, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="alert-circle" size={20} color="#DC2626" />
              </View>
              <Text style={[styles.sheetTitle, { color: "#DC2626" }]}>Scan Failed</Text>
            </View>
            <Text style={styles.errorMessage}>{scanState.message}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={handleDiscard}
              testID="cw-retry-btn"
            >
              <Feather name="camera" size={16} color="#1B4332" />
              <Text style={styles.retryBtnText}>Try Again</Text>
            </Pressable>
          </>
        )}
      </Animated.View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.modalRoot}>
        {renderCamera()}
        {renderSheet()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: "#000",
  },

  webPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  webPlaceholderText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  closeBtn: {
    marginTop: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnAbs: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },

  permContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 36,
    gap: 12,
    backgroundColor: "#111",
  },
  permTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  permSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  permBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: "#1B4332",
  },
  permBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  permDenied: {
    fontSize: 13,
    color: "#EF4444",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },

  cameraOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  cwGuideWrap: {
    alignItems: "center",
    gap: 12,
    width: "100%",
    paddingHorizontal: 24,
  },
  cwLabel: {
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
  cwItemName: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: "85%",
    textAlign: "center",
  },
  cwFrame: {
    width: "90%",
    height: 90,
    position: "relative",
  },
  cwCorner: {
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
  cwHint: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },

  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  uploadingCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 12,
    minWidth: 220,
  },
  uploadingTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#0A0A0A",
  },
  uploadingSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
  },

  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#FCD34D",
    alignItems: "center",
    justifyContent: "center",
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  countdownCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: "#FCD34D",
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNum: {
    fontSize: 38,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#FCD34D",
    lineHeight: 44,
  },
  scanNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 24,
    backgroundColor: "#FCD34D",
  },
  scanNowText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },

  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetIcon: {
    fontSize: 22,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
  sheetItemName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },

  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  weightLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  weightValue: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
  weightEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  weightInput: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
    borderBottomWidth: 2,
    borderBottomColor: "#1B4332",
    minWidth: 72,
    textAlign: "right",
    paddingVertical: 2,
  },
  weightUnitLabel: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  lowConfWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  lowConfWarningText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#991B1B",
    flex: 1,
  },

  sheetActions: {
    flexDirection: "row",
    gap: 10,
  },
  discardBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  discardBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#6B7280",
  },
  confirmBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#1B4332",
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  savingText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#374151",
  },

  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  savedIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  savedTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#0A0A0A",
  },
  savedSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },

  errorMessage: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#1B4332",
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#1B4332",
  },
});
