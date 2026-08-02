// @vitest-environment jsdom
/**
 * Component tests for WasteVoiceModal failure recovery (task #922).
 *
 * Coverage:
 *   1. Mic permission denied (NotAllowedError)  → user-visible "denied" error,
 *      no stuck spinner, Try again button present.
 *   2. Mic unavailable (generic error)          → user-visible "HTTPS" error,
 *      no stuck spinner.
 *   3. MediaRecorder not supported by browser   → user-visible "browser" error.
 *   4. Recorder produces no audio chunks        → fetch is still called, and
 *      when the server returns a 400 the UI shows the error stage (not a spinner).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ─── UI component stubs ───────────────────────────────────────────────────────
// Radix-based shadcn components can be brittle in jsdom; replace with thin
// pass-throughs so tests can focus on component logic.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? React.createElement("div", { "data-testid": "dialog" }, children) : null,
  DialogContent: ({ children }: any) =>
    React.createElement("div", { "data-testid": "dialog-content" }, children),
  DialogHeader: ({ children }: any) => React.createElement("div", null, children),
  DialogTitle: ({ children }: any) =>
    React.createElement("h2", { "data-testid": "dialog-title" }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, size, variant, className }: any) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-variant": variant },
      children,
    ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => React.createElement("span", null, children),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  const Icon = ({ className }: any) =>
    React.createElement("span", { className });
  const stubs: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    stubs[key] = Icon;
  }
  return stubs;
});

// ─── Import the component AFTER mocks ─────────────────────────────────────────

import { WasteVoiceModal } from "./waste-voice-modal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal props to open the modal. */
const DEFAULT_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  storeId: "store-uuid-1",
  onLoadEntry: vi.fn(),
};

function renderModal(propOverrides: Partial<typeof DEFAULT_PROPS> = {}) {
  return render(
    React.createElement(WasteVoiceModal, { ...DEFAULT_PROPS, ...propOverrides }),
  );
}

// ─── MediaRecorder factory ────────────────────────────────────────────────────

/**
 * Returns a fake MediaRecorder class + a ref that is populated with the most
 * recently constructed instance.  Using a real ES6 class satisfies the
 * `new MediaRecorder(...)` call inside the component.
 */
function makeMediaRecorderMock() {
  const instanceRef = { current: null as any };

  class FakeMediaRecorder {
    start = vi.fn();
    stop = vi.fn();
    state = "recording";
    ondataavailable: ((e: any) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;

    constructor(_stream: MediaStream, _opts?: any) {
      instanceRef.current = this;
    }

    static isTypeSupported = vi.fn(() => true);
  }

  return { instanceRef, Ctor: FakeMediaRecorder };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  // Restore any globals stubbed during the test
  vi.unstubAllGlobals();
});

// ─── 1. Mic permission denied ─────────────────────────────────────────────────

describe("WasteVoiceModal — microphone permission denied", () => {
  it("shows a user-visible 'denied' error and does NOT leave a spinner on screen", async () => {
    const deniedError = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(deniedError),
      },
    });

    // MediaRecorder must appear supported so the code reaches getUserMedia
    const { Ctor } = makeMediaRecorderMock();
    vi.stubGlobal("MediaRecorder", Ctor);

    renderModal();

    // Click "Start Recording"
    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    // Wait for the error message to appear
    await waitFor(() => {
      expect(screen.getByText(/microphone access was denied/i)).toBeDefined();
    });

    // No spinner should remain
    expect(screen.queryByText(/requesting microphone/i)).toBeNull();

    // "Try again" button must be visible so the user can recover
    expect(screen.getByText(/try again/i)).toBeDefined();
  });
});

// ─── 2. Generic mic error ─────────────────────────────────────────────────────

describe("WasteVoiceModal — microphone unavailable (generic error)", () => {
  it("shows a user-visible HTTPS/mic error and offers a Try again button", async () => {
    const notFoundError = Object.assign(new Error("Device not found"), {
      name: "NotFoundError",
    });

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(notFoundError),
      },
    });

    const { Ctor } = makeMediaRecorderMock();
    vi.stubGlobal("MediaRecorder", Ctor);

    renderModal();

    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/could not access the microphone/i)).toBeDefined();
    });

    // No spinner
    expect(screen.queryByText(/requesting microphone/i)).toBeNull();

    // Recovery path available
    expect(screen.getByText(/try again/i)).toBeDefined();
  });
});

// ─── 3. MediaRecorder unsupported ────────────────────────────────────────────

describe("WasteVoiceModal — MediaRecorder not supported by browser", () => {
  it("shows a browser-not-supported error immediately when no mime type is available", async () => {
    // Simulate a browser where MediaRecorder exists but supports no formats
    const Ctor: any = vi.fn();
    Ctor.isTypeSupported = vi.fn(() => false);
    vi.stubGlobal("MediaRecorder", Ctor);

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(),
      },
    });

    renderModal();

    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/does not support audio recording/i),
      ).toBeDefined();
    });

    // getUserMedia should NOT have been called — error fires before permission request
    expect(
      (navigator as any).mediaDevices.getUserMedia,
    ).not.toHaveBeenCalled();

    // Recovery path
    expect(screen.getByText(/try again/i)).toBeDefined();
  });

  it("shows a browser-not-supported error when MediaRecorder is completely absent", async () => {
    // jsdom does not define MediaRecorder; explicitly remove it
    vi.stubGlobal("MediaRecorder", undefined);

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(),
      },
    });

    renderModal();

    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/does not support audio recording/i),
      ).toBeDefined();
    });
  });
});

// ─── 5. MediaRecorder onerror event mid-recording ────────────────────────────

describe("WasteVoiceModal — MediaRecorder onerror fired mid-recording", () => {
  it("transitions to the error stage with a user-readable message when onerror fires", async () => {
    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { instanceRef, Ctor } = makeMediaRecorderMock();
    vi.stubGlobal("MediaRecorder", Ctor);

    renderModal();

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    // Wait for the recorder instance to be created
    await waitFor(() => {
      expect(instanceRef.current).not.toBeNull();
    });

    // Confirm we are in the recording stage
    await waitFor(() => {
      expect(screen.getByText(/stop recording/i)).toBeDefined();
    });

    // Fire the onerror event (simulates OS revoking mic access, device disconnect, etc.)
    await act(async () => {
      instanceRef.current?.onerror?.(new Event("error"));
    });

    // UI must move to the error stage
    await waitFor(() => {
      expect(screen.getByText(/microphone stopped unexpectedly/i)).toBeDefined();
    });

    // No recording-stage UI should remain
    expect(screen.queryByText(/stop recording/i)).toBeNull();

    // A "Try again" button must be present for recovery
    expect(screen.getByText(/try again/i)).toBeDefined();
  });
});

// ─── 6. Fetch times out (AbortError after 60 s) ──────────────────────────────

describe("WasteVoiceModal — fetch request times out", () => {
  it("transitions to the error stage with a 'timed out' message and shows Try again", async () => {
    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { instanceRef, Ctor } = makeMediaRecorderMock();
    vi.stubGlobal("MediaRecorder", Ctor);

    // Simulate fetch aborting (as if AbortController fired after timeout)
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    renderModal();

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    await waitFor(() => {
      expect(instanceRef.current).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText(/stop recording/i)).toBeDefined();
    });

    // Simulate recorder stopping with one audio chunk
    await act(async () => {
      instanceRef.current?.ondataavailable?.({
        data: new Blob(["audio"], { type: "audio/webm" }),
      });
      instanceRef.current?.onstop?.();
    });

    // UI must show the timeout error, not a spinner
    await waitFor(() => {
      expect(screen.getByText(/request timed out/i)).toBeDefined();
    });

    // No loading spinners should remain
    expect(screen.queryByText(/transcribing/i)).toBeNull();
    expect(screen.queryByText(/uploading/i)).toBeNull();
    expect(screen.queryByText(/resolving/i)).toBeNull();

    // "Try again" button must be present (may also appear in the error description text)
    expect(screen.getAllByText(/try again/i).length).toBeGreaterThan(0);
  });
});

// ─── 4. Recorder aborts mid-session (zero chunks) ────────────────────────────

describe("WasteVoiceModal — recorder abort mid-session (no audio chunks collected)", () => {
  it("shows the error stage (not a stuck spinner) when the server rejects the empty blob", async () => {
    // getUserMedia succeeds
    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { instanceRef, Ctor } = makeMediaRecorderMock();
    vi.stubGlobal("MediaRecorder", Ctor);

    // Server returns 400 for the zero-byte blob
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error:
            "Audio recording is empty — please speak for at least one second before stopping.",
        }),
      }),
    );

    renderModal();

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByText(/start recording/i));
    });

    // Wait for the recorder instance to be created and the recording stage to render
    await waitFor(() => {
      expect(instanceRef.current).not.toBeNull();
    });

    // Verify we are in the recording stage (Stop button visible)
    await waitFor(() => {
      expect(screen.getByText(/stop recording/i)).toBeDefined();
    });

    // Simulate the recorder stopping with NO data chunks collected
    await act(async () => {
      // Fire onstop without any ondataavailable events → chunksRef stays empty
      instanceRef.current?.onstop?.();
    });

    // The component calls processAudio() with a zero-byte Blob, which then
    // calls fetch. The server returns 400, so the UI should transition to error.
    await waitFor(() => {
      // Error stage text confirms the UI did not get stuck on a spinner
      expect(screen.getByText(/recording failed/i)).toBeDefined();
    });

    // The specific server error should be surfaced
    await waitFor(() => {
      expect(screen.getByText(/empty/i)).toBeDefined();
    });

    // No loading spinner should remain
    expect(screen.queryByText(/transcribing/i)).toBeNull();
    expect(screen.queryByText(/uploading/i)).toBeNull();
    expect(screen.queryByText(/resolving/i)).toBeNull();

    // "Try again" button allows recovery without a page reload
    expect(screen.getByText(/try again/i)).toBeDefined();
  });
});
