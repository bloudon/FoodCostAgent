// @vitest-environment jsdom
/**
 * Component tests for the HEIC/HEIF acceptance path in ObjectUploader.
 *
 * Browsers frequently hand us an iPhone photo with an empty or generic MIME
 * type (`""` or `application/octet-stream`) rather than `image/heic`. The
 * uploader validates the file type *before* conversion runs, so if that check
 * only trusted `file.type` a `.heif` upload would be refused with an
 * "unsupported file type" error and never reach the converter at all.
 *
 * These tests pin that behavior: an extension-only HEIC/HEIF file must reach
 * conversion and upload, while genuinely unsupported files are still rejected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";

const heic2anyMock = vi.fn(async () => new Blob(["converted-jpeg-bytes"], { type: "image/jpeg" }));
vi.mock("heic2any", () => ({ default: heic2anyMock }));

import { ObjectUploader } from "./ObjectUploader";

/** Captures the file the uploader actually sent to the server. */
function mockUploadEndpoint() {
  const uploaded: File[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/objects/upload")) {
      const body = init?.body as FormData;
      uploaded.push(body.get("file") as File);
      return new Response(JSON.stringify({ uploadUrl: null, objectPath: "/objects/uploads/abc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { uploaded, fetchMock };
}

function selectFile(file: File) {
  const input = screen.getByTestId("button-upload-image-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("ObjectUploader HEIC/HEIF handling", () => {
  beforeEach(() => {
    heic2anyMock.mockClear();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["an empty MIME type", "receipt.heif", ""],
    ["a generic MIME type", "IMG_1234.HEIC", "application/octet-stream"],
  ])("converts and uploads a HEIC/HEIF file reported with %s", async (_label, name, type) => {
    const { uploaded } = mockUploadEndpoint();
    const onUploadComplete = vi.fn();
    render(<ObjectUploader onUploadComplete={onUploadComplete} />);

    selectFile(new File(["heic-bytes"], name, { type }));

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    // It reached the converter rather than being refused as unsupported...
    expect(heic2anyMock).toHaveBeenCalledTimes(1);
    // ...and what went to the server is a JPEG, not the original HEIC.
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].type).toBe("image/jpeg");
    expect(uploaded[0].name).toMatch(/\.jpg$/);
    expect(onUploadComplete).toHaveBeenCalledWith("/objects/uploads/abc", expect.any(File));
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("uploads an ordinary JPEG untouched", async () => {
    const { uploaded } = mockUploadEndpoint();
    const onUploadComplete = vi.fn();
    render(<ObjectUploader onUploadComplete={onUploadComplete} />);

    selectFile(new File(["jpeg-bytes"], "menu.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(heic2anyMock).not.toHaveBeenCalled();
    expect(uploaded[0].name).toBe("menu.jpg");
  });

  it("still refuses a file that is neither an image nor a PDF", async () => {
    const { fetchMock } = mockUploadEndpoint();
    const onUploadComplete = vi.fn();
    render(<ObjectUploader onUploadComplete={onUploadComplete} />);

    selectFile(new File(["notes"], "notes.txt", { type: "text/plain" }));

    await waitFor(() => expect(globalThis.alert).toHaveBeenCalled());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.alert).mock.calls[0][0]).toContain("not a supported file type");
  });
});
