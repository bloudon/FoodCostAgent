import { useEffect, useState, type CSSProperties } from "react";

/** Fixed-position coordinates are relative to the layout viewport. On iOS the
 * keyboard can shrink and pan the visual viewport without resizing that layout. */
export function countEditorViewportStyle(
  height: number,
  offsetTop: number,
): CSSProperties | undefined {
  if (!Number.isFinite(height) || height <= 0) return undefined;
  const top = Number.isFinite(offsetTop) ? Math.max(0, offsetTop) : 0;
  return {
    top: `${top + height * 0.04}px`,
    bottom: "auto",
    height: `${height * 0.96}px`,
    maxHeight: `${height * 0.96}px`,
  };
}

function readViewport(): CSSProperties | undefined {
  if (typeof window === "undefined") return undefined;
  const viewport = window.visualViewport;
  return countEditorViewportStyle(
    viewport?.height ?? window.innerHeight,
    viewport?.offsetTop ?? 0,
  );
}

/** Keep the sheet footer within the visible WebView, above the device keyboard. */
export function useCountEditorViewport(open: boolean) {
  const [style, setStyle] = useState<CSSProperties | undefined>(readViewport);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const update = () => setStyle(readViewport());
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [open]);

  return style;
}