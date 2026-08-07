import { Feather } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import {
  setWasteDraft,
  type VoiceWasteEntry,
} from "@/lib/wasteBridge";

const MAX_RECORDING_SECONDS = 60;

// Pipeline states shown to the user. The native screen deliberately offers
// only Retry / Cancel / Open Waste Entry — no editing (the wrapped Waste
// wizard is the sole confirmation/correction interface).
type PipelineState =
  | "idle"
  | "listening"
  | "recorded"
  | "transcribing"
  | "interpreting"
  | "ready";

type ErrorCategory = "recording" | "transcription" | "interpretation" | null;

interface StoreOption {
  id: string;
  name: string;
}

interface InterpretResponse {
  transcript: string;
  entries: VoiceWasteEntry[];
  transcriptionWarnings: string[];
  interpretationWarnings: string[];
  model: string;
  requestId: string;
}

export default function VoiceWasteScreen() {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { backendUrl } = useScan();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);

  const [pipeline, setPipeline] = useState<PipelineState>("idle");
  const [error, setError] = useState<{ category: ErrorCategory; message: string } | null>(null);
  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [result, setResult] = useState<InterpretResponse | null>(null);

  // Load the stores the user can report waste against.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("no token");
        const res = await fetch(`${backendUrl}/api/mobile/locations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const locs = (await res.json()) as StoreOption[];
        if (cancelled) return;
        setStores(locs);
        if (locs.length === 1) setStoreId(locs[0].id);
      } catch {
        if (!cancelled) setStores([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, getToken]);

  // Auto-stop at the 60s limit.
  const durationSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
  useEffect(() => {
    if (pipeline === "listening" && durationSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationSeconds, pipeline]);

  const startRecording = useCallback(async () => {
    setError(null);
    setResult(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError({
          category: "recording",
          message:
            "Microphone access is required to record a waste report. Enable it in your device settings.",
        });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPipeline("listening");
    } catch {
      setError({ category: "recording", message: "Could not start recording. Please try again." });
      setPipeline("idle");
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      setPipeline("recorded");
    } catch {
      setError({ category: "recording", message: "Recording failed. Please try again." });
      setPipeline("idle");
    }
  }, [recorder]);

  const interpret = useCallback(async () => {
    if (!storeId) return;
    const uri = recorder.uri;
    if (!uri) {
      setError({ category: "recording", message: "No recording found. Please record again." });
      setPipeline("idle");
      return;
    }
    setError(null);
    setPipeline("transcribing");
    try {
      const token = await getToken();
      if (!token) throw new Error("auth");

      const formData = new FormData();
      formData.append("storeId", storeId);
      formData.append("durationSeconds", String(Math.max(durationSeconds, 1)));
      formData.append("audio", {
        uri,
        name: "voice-waste.m4a",
        type: "audio/m4a",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const res = await fetch(`${backendUrl}/api/mobile/voice/waste/interpret`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      setPipeline("interpreting");
      const body = (await res.json().catch(() => null)) as
        | (InterpretResponse & { error?: string; errorStage?: string })
        | null;

      if (!res.ok || !body) {
        const stage: ErrorCategory =
          body?.errorStage === "interpretation" ? "interpretation" : "transcription";
        setError({
          category: stage,
          message: body?.error ?? "Something went wrong while processing the recording.",
        });
        setPipeline("recorded");
        return;
      }

      setResult(body);
      setWasteDraft({
        requestId: body.requestId,
        storeId,
        transcript: body.transcript,
        entries: body.entries,
      });
      setPipeline("ready");
    } catch {
      setError({
        category: "transcription",
        message: "Could not reach the server. Check your connection and try again.",
      });
      setPipeline("recorded");
    }
  }, [backendUrl, durationSeconds, getToken, recorder.uri, storeId]);

  const retry = useCallback(() => {
    setResult(null);
    setError(null);
    setPipeline("idle");
  }, []);

  const cancel = useCallback(() => {
    if (pipeline === "listening") {
      recorder.stop().catch(() => undefined);
    }
    router.back();
  }, [pipeline, recorder]);

  const openWasteEntry = useCallback(() => {
    router.push("/waste-web");
  }, []);

  const busy = pipeline === "transcribing" || pipeline === "interpreting";
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const stateLabel: Record<PipelineState, string> = {
    idle: "Ready to record",
    listening: "Listening…",
    recorded: "Recording complete",
    transcribing: "Transcribing…",
    interpreting: "Interpreting…",
    ready: "Ready to open",
  };

  return (
    <View style={[styles.root, { paddingBottom: bottomPad + 16 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Store selection */}
        {stores === null ? (
          <ActivityIndicator color="#1B4332" style={{ marginTop: 24 }} />
        ) : stores.length === 0 ? (
          <Text style={styles.errorText}>
            No stores available. Check your connection and try again.
          </Text>
        ) : !storeId ? (
          <View style={styles.storeCard}>
            <Text style={styles.sectionTitle}>Which store is this waste for?</Text>
            {stores.map((s) => (
              <Pressable
                key={s.id}
                style={({ pressed }) => [styles.storeOption, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setStoreId(s.id)}
              >
                <Feather name="map-pin" size={16} color="#1B4332" />
                <Text style={styles.storeOptionText}>{s.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <View style={styles.stateBadge}>
              {busy && <ActivityIndicator size="small" color="#1B4332" />}
              <Text style={styles.stateText}>{stateLabel[pipeline]}</Text>
              {pipeline === "listening" && (
                <Text style={styles.timerText}>
                  {durationSeconds}s / {MAX_RECORDING_SECONDS}s
                </Text>
              )}
            </View>

            {error && (
              <View style={styles.errorCard}>
                <Feather name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}

            {pipeline === "idle" && (
              <Pressable
                style={({ pressed }) => [styles.micButton, { opacity: pressed ? 0.8 : 1 }]}
                onPress={startRecording}
                testID="start-recording-btn"
              >
                <Feather name="mic" size={40} color="#fff" />
              </Pressable>
            )}

            {pipeline === "listening" && (
              <Pressable
                style={({ pressed }) => [
                  styles.micButton,
                  styles.micButtonActive,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={stopRecording}
                testID="stop-recording-btn"
              >
                <Feather name="square" size={36} color="#fff" />
              </Pressable>
            )}

            {pipeline === "idle" && (
              <Text style={styles.hint}>
                Tap the microphone and describe the waste — for example “two pounds of chicken
                breast spoiled in the walk-in”.
              </Text>
            )}

            {pipeline === "recorded" && !busy && (
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={interpret}
                testID="interpret-btn"
              >
                <Feather name="upload-cloud" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Transcribe recording</Text>
              </Pressable>
            )}

            {/* Read-only transcript + entries (no editing on native by design) */}
            {result && pipeline === "ready" && (
              <View style={styles.resultCard}>
                <Text style={styles.sectionTitle}>What we heard</Text>
                <Text style={styles.transcript}>“{result.transcript}”</Text>

                <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                  {result.entries.length} item{result.entries.length === 1 ? "" : "s"} detected
                </Text>
                {result.entries.map((e, i) => (
                  <View key={i} style={styles.entryRow}>
                    <Feather name="trash-2" size={14} color="#6B7280" />
                    <Text style={styles.entryText}>
                      {e.qty !== null ? `${e.qty} ` : ""}
                      {e.spokenUnit ? `${e.spokenUnit} ` : ""}
                      {e.spokenItem}
                      {e.reasonCode ? ` — ${e.reasonCode.toLowerCase().replace(/_/g, " ")}` : ""}
                    </Text>
                  </View>
                ))}
                {result.entries.length === 0 && (
                  <Text style={styles.entryText}>
                    No waste items detected. Try recording again.
                  </Text>
                )}

                {[...result.transcriptionWarnings, ...result.interpretationWarnings].map((w, i) => (
                  <View key={`w-${i}`} style={styles.warningRow}>
                    <Feather name="alert-triangle" size={13} color="#D97706" />
                    <Text style={styles.warningText}>{w}</Text>
                  </View>
                ))}

                <Text style={styles.finishNote}>
                  You’ll review, correct, and confirm everything in Waste Entry before anything is
                  saved.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Action bar: Retry / Cancel / Open Waste Entry only */}
      <View style={styles.actions}>
        {(pipeline === "recorded" || pipeline === "ready" || error) && !busy ? (
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.75 : 1 }]}
            onPress={retry}
            testID="retry-btn"
          >
            <Feather name="rotate-ccw" size={16} color="#1B4332" />
            <Text style={styles.secondaryBtnText}>Retry</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.75 : 1 }]}
          onPress={cancel}
          testID="cancel-btn"
        >
          <Feather name="x" size={16} color="#1B4332" />
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </Pressable>
        {pipeline === "ready" && result && result.entries.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { flex: 1, opacity: pressed ? 0.8 : 1 }]}
            onPress={openWasteEntry}
            testID="open-waste-entry-btn"
          >
            <Feather name="arrow-right-circle" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Open Waste Entry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 20, alignItems: "center", gap: 16 },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 8,
  },
  stateText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#1B4332" },
  timerText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1B4332",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  micButtonActive: { backgroundColor: "#DC2626" },
  hint: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  storeCard: { alignSelf: "stretch", gap: 10, marginTop: 8 },
  storeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 14,
  },
  storeOptionText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#111827" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  resultCard: {
    alignSelf: "stretch",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  transcript: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
    fontStyle: "italic",
    lineHeight: 20,
  },
  entryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#374151", flex: 1 },
  warningRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  warningText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D97706", flex: 1 },
  finishNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    marginTop: 8,
    lineHeight: 17,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    alignSelf: "stretch",
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626", flex: 1 },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 20 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1B4332",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#1B4332",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1B4332" },
});
