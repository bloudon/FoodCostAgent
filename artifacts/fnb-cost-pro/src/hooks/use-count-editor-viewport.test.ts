// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countEditorViewportStyle, useCountEditorViewport } from "./use-count-editor-viewport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("count editor keyboard viewport", () => {
  it("places the footer at the visible viewport bottom", () => {
    expect(countEditorViewportStyle(700, 0)).toEqual({
      top: "28px", bottom: "auto", height: "672px", maxHeight: "672px",
    });
  });

  it("follows a keyboard-shrunken and panned viewport", () => {
    const style = countEditorViewportStyle(300, 80)!;
    expect(style).toEqual({
      top: "92px", bottom: "auto", height: "288px", maxHeight: "288px",
    });
    expect(parseFloat(String(style.top)) + parseFloat(String(style.height))).toBe(380);
  });

  it("does not position a sheet using invalid viewport dimensions", () => {
    expect(countEditorViewportStyle(0, 0)).toBeUndefined();
    expect(countEditorViewportStyle(NaN, 0)).toBeUndefined();
    expect(countEditorViewportStyle(100, -10)?.top).toBe("4px");
  });

  it("responds to keyboard resize/scroll and removes listeners on close", () => {
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    viewport.height = 700;
    viewport.offsetTop = 0;
    vi.stubGlobal("visualViewport", viewport);
    const remove = vi.spyOn(viewport, "removeEventListener");
    const hook = renderHook(({ open }) => useCountEditorViewport(open), {
      initialProps: { open: true },
    });
    expect(hook.result.current?.height).toBe("672px");
    act(() => {
      viewport.height = 300;
      viewport.offsetTop = 80;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(hook.result.current?.top).toBe("92px");
    act(() => {
      viewport.offsetTop = 100;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(hook.result.current?.top).toBe("112px");
    hook.rerender({ open: false });
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});