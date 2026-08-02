import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Square, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, HelpCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved" | "needs_unit";

export interface WasteInterpretEntry {
  sourceText: string;
  wasteType: "inventory" | "menu_item" | null;
  spokenItem: string;
  qty: number | null;
  spokenUnit: string | null;
  reasonCode: string | null;
  notes: string | null;
  resolutionStatus: ResolutionStatus;
  itemId: string | null;
  itemName: string | null;
  categoryId: string | null;
  department: string | null;
  /** Resolved unit (may be canonical or a configured alternate). Null when needs_unit. */
  unitId: string | null;
  unitName: string | null;
  /**
   * Item's canonical unit (the unit the waste form submits in).
   * Null for menu items. Use to detect unit mismatch before prefilling qty.
   */
  canonicalUnitId: string | null;
  canonicalUnitName: string | null;
  matchScore: number;
  matchMargin: number;
  candidates: { itemId: string; itemName: string; wasteType: "inventory" | "menu_item"; score: number }[];
  warnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return SUPPORTED_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}

function mimeToExtension(mime: string): string {
  if (mime.startsWith("audio/webm")) return "webm";
  if (mime.startsWith("audio/mp4")) return "mp4";
  if (mime.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const MAX_RECORDING_SECONDS = 60;

type ModalStage =
  | "idle"
  | "requesting"
  | "recording"
  | "uploading"
  | "transcribing"
  | "resolving"
  | "results"
  | "error";

// ─── Entry card ───────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  index,
  onLoad,
}: {
  entry: WasteInterpretEntry;
  index: number;
  onLoad: () => void;
}) {
  const [showAlts, setShowAlts] = useState(false);

  const statusMeta: Record<ResolutionStatus, { icon: JSX.Element; color: string; label: string }> = {
    resolved: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: "bg-green-100 text-green-800 border-green-200",
      label: "Ready",
    },
    ambiguous: {
      icon: <HelpCircle className="h-4 w-4" />,
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      label: "Review needed",
    },
    needs_unit: {
      icon: <AlertTriangle className="h-4 w-4" />,
      color: "bg-orange-100 text-orange-800 border-orange-200",
      label: "Select unit",
    },
    unresolved: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "bg-red-100 text-red-800 border-red-200",
      label: "Not found",
    },
  };

  const meta = statusMeta[entry.resolutionStatus];

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium text-muted-foreground shrink-0">{index + 1}.</span>
          <div className="min-w-0">
            <p className="font-medium truncate">
              {entry.itemName ?? entry.spokenItem}
            </p>
            {entry.qty != null && (
              <p className="text-sm text-muted-foreground">
                {entry.qty} {entry.unitName ?? entry.spokenUnit ?? ""}
                {entry.reasonCode && ` · ${entry.reasonCode.replace(/_/g, " ")}`}
              </p>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${meta.color}`}>
          {meta.icon}
          {meta.label}
        </span>
      </div>

      <p className="text-xs text-muted-foreground italic">"{entry.sourceText}"</p>

      {entry.warnings.length > 0 && (
        <p className="text-xs text-orange-700 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          {entry.warnings[0]}
        </p>
      )}

      {entry.candidates.length > 1 && (
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
            onClick={() => setShowAlts(v => !v)}
          >
            {showAlts ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {entry.candidates.length - 1} alternative{entry.candidates.length > 2 ? "s" : ""}
          </button>
          {showAlts && (
            <ul className="mt-1 space-y-0.5">
              {entry.candidates.slice(1, 4).map(c => (
                <li key={c.itemId} className="text-xs text-muted-foreground pl-3">
                  {c.itemName}
                  <span className="ml-1 text-muted-foreground/60">
                    ({Math.round(c.score * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button
        size="sm"
        className="w-full h-9"
        onClick={onLoad}
        disabled={entry.resolutionStatus === "unresolved"}
        variant={entry.resolutionStatus === "resolved" ? "default" : "outline"}
      >
        Load into form
      </Button>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Called when the user taps Load on an entry. All entries + the selected index are passed. */
  onLoadEntry: (entries: WasteInterpretEntry[], transcript: string, loadIndex: number) => void;
  /** Called once a transcription/interpretation cycle completes (even if no entries were found). */
  onInterpretComplete?: () => void;
}

export function WasteVoiceModal({ open, onOpenChange, storeId, onLoadEntry, onInterpretComplete }: Props) {
  const [stage, setStage] = useState<ModalStage>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [entries, setEntries] = useState<WasteInterpretEntry[]>([]);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setStage("idle");
      setErrorMessage("");
      setElapsedSecs(0);
      setTranscript("");
      setEntries([]);
      setTranscriptExpanded(false);
    } else {
      stopTracks();
    }
  }, [open]);

  function stopTracks() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /** Safely stop the MediaRecorder — only calls stop() if it is actively recording. */
  function safeStopRecorder() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      try {
        rec.stop();
      } catch {
        // Swallow any InvalidStateError from race conditions
      }
    }
    recorderRef.current = null;
  }

  const handleClose = useCallback(() => {
    stopTracks();
    safeStopRecorder();
    onOpenChange(false);
  }, [onOpenChange]);

  async function startRecording() {
    const mimeType = pickMimeType();
    if (!mimeType) {
      setStage("error");
      setErrorMessage("Your browser does not support audio recording. Please use Chrome, Firefox, or Safari.");
      return;
    }
    mimeTypeRef.current = mimeType;
    setStage("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      setStage("error");
      setErrorMessage(
        err?.name === "NotAllowedError"
          ? "Microphone access was denied. Please allow microphone access in your browser settings."
          : "Could not access the microphone. Make sure the page is served over HTTPS.",
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stopTracks();
      processAudio(new Blob(chunksRef.current, { type: mimeType }));
    };

    recorder.onerror = (_event: Event) => {
      stopTracks();
      recorderRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setStage("error");
      setErrorMessage("The microphone stopped unexpectedly. Please try recording again.");
    };

    recorder.start(250); // collect chunks every 250ms
    setStage("recording");
    setElapsedSecs(0);

    timerRef.current = setInterval(() => {
      setElapsedSecs(s => {
        if (s + 1 >= MAX_RECORDING_SECONDS) {
          stopRecording();
          return MAX_RECORDING_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Guard: only stop if still recording to avoid InvalidStateError
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      try {
        rec.stop();
      } catch {
        // Swallow race-condition errors; onstop will still fire or we fall back
      }
    }
  }

  async function processAudio(blob: Blob) {
    setStage("uploading");
    try {
      const ext = mimeToExtension(mimeTypeRef.current);
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("storeId", storeId);

      setStage("transcribing");
      const res = await fetch("/api/waste/interpret", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Server error" }));
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      setStage("resolving");
      const data = await res.json();
      setTranscript(data.transcript ?? "");
      setEntries(data.entries ?? []);
      setStage("results");
      onInterpretComplete?.();
    } catch (err: any) {
      setStage("error");
      setErrorMessage(err.message ?? "Failed to process recording. Please try again.");
    }
  }

  function handleLoadEntry(idx: number) {
    onLoadEntry(entries, transcript, idx);
    onOpenChange(false);
  }

  // ─── Render helpers ──────────────────────────────────────────────────────

  function renderBody() {
    switch (stage) {
      case "idle":
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-6">
            <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
              <Mic className="h-12 w-12 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-medium text-lg">Ready to listen</p>
              <p className="text-sm text-muted-foreground mt-1">
                Speak one or more waste events naturally.<br />
                Recording stops automatically at {MAX_RECORDING_SECONDS} seconds.
              </p>
            </div>
            <Button size="lg" className="h-14 px-8 text-lg" onClick={startRecording}>
              <Mic className="h-5 w-5 mr-2" />
              Start Recording
            </Button>
          </div>
        );

      case "requesting":
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Requesting microphone access…</p>
          </div>
        );

      case "recording":
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-6">
            <div className="relative">
              <div className="h-24 w-24 rounded-full bg-red-500/10 flex items-center justify-center animate-pulse">
                <Mic className="h-12 w-12 text-red-500" />
              </div>
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-medium">
                REC
              </span>
            </div>
            <div className="text-center">
              <p className="text-4xl font-mono font-bold tabular-nums">
                {formatTime(elapsedSecs)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                of {formatTime(MAX_RECORDING_SECONDS)} max
              </p>
            </div>
            {/* Audio level indicator */}
            <div className="flex gap-1 h-8 items-end">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="w-2 bg-red-400 rounded-sm opacity-70"
                  style={{
                    height: `${20 + Math.sin((Date.now() / 200) + i) * 15}%`,
                    animationName: "none",
                  }}
                />
              ))}
            </div>
            <Button
              variant="destructive"
              size="lg"
              className="h-14 px-8 text-lg"
              onClick={stopRecording}
            >
              <Square className="h-5 w-5 mr-2 fill-current" />
              Stop Recording
            </Button>
          </div>
        );

      case "uploading":
      case "transcribing":
      case "resolving":
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="font-medium">
              {stage === "uploading" && "Uploading…"}
              {stage === "transcribing" && "Transcribing…"}
              {stage === "resolving" && "Resolving items…"}
            </p>
            <p className="text-sm text-muted-foreground">This usually takes a few seconds</p>
          </div>
        );

      case "results":
        return (
          <div className="space-y-4">
            {/* Transcript */}
            {transcript && (
              <div className="rounded-lg bg-muted/50 p-3">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setTranscriptExpanded(v => !v)}
                >
                  {transcriptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Transcript
                </button>
                {transcriptExpanded && (
                  <p className="mt-2 text-sm text-foreground italic">"{transcript}"</p>
                )}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>No waste entries could be identified.</p>
                <p className="text-sm mt-1">Try speaking more clearly or include item names and quantities.</p>
                <Button variant="outline" className="mt-4" onClick={() => setStage("idle")}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {entries.length} entr{entries.length === 1 ? "y" : "ies"} found — tap <strong>Load into form</strong> to fill in the wizard.
                </p>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {entries.map((entry, i) => (
                    <EntryCard
                      key={i}
                      entry={entry}
                      index={i}
                      onLoad={() => handleLoadEntry(i)}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="flex justify-between pt-2 border-t">
              <Button variant="ghost" onClick={() => setStage("idle")}>
                Re-record
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <MicOff className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <p className="font-medium text-destructive">Recording failed</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{errorMessage}</p>
            </div>
            <Button variant="outline" onClick={() => setStage("idle")}>
              Try again
            </Button>
          </div>
        );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            Voice Waste Entry
          </DialogTitle>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  );
}
