import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const UNDO_DELAY = 5000;

type PendingAction = {
  label: string;
  onCommit: () => Promise<void>;
  onRestore: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout>;
};

type UndoContextType = {
  register: (
    label: string,
    onCommit: () => Promise<void>,
    onRestore?: () => void
  ) => void;
  triggerUndo: () => void;
};

const UndoContext = createContext<UndoContextType | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState("");
  const [progress, setProgress] = useState(100);

  const pendingRef = useRef<PendingAction | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const cancelAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startAnimation = useCallback(() => {
    cancelAnimation();
    startRef.current = Date.now();
    setProgress(100);

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 1 - elapsed / UNDO_DELAY);
      setProgress(remaining * 100);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation]);

  const commitAndClear = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    cancelAnimation();
    clearTimeout(p.timer);
    pendingRef.current = null;
    setVisible(false);
    p.onCommit().catch((e) => {
      console.error(e);
      toast({ title: "Action failed", description: "The change could not be saved. Please refresh and try again.", variant: "destructive" });
    });
  }, [cancelAnimation, toast]);

  const register = useCallback(
    (label: string, onCommit: () => Promise<void>, onRestore?: () => void) => {
      if (pendingRef.current) {
        commitAndClear();
      }

      const timer = setTimeout(() => {
        const p = pendingRef.current;
        if (!p) return;
        cancelAnimation();
        pendingRef.current = null;
        setVisible(false);
        p.onCommit().catch((e) => {
          console.error(e);
          toast({ title: "Action failed", description: "The change could not be saved. Please refresh and try again.", variant: "destructive" });
        });
      }, UNDO_DELAY);

      pendingRef.current = { label, onCommit, onRestore, timer };
      setLabel(label);
      setVisible(true);
      startAnimation();
    },
    [commitAndClear, cancelAnimation, startAnimation]
  );

  const triggerUndo = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    cancelAnimation();
    pendingRef.current = null;
    setVisible(false);
    p.onRestore?.();
  }, [cancelAnimation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        if (pendingRef.current) {
          e.preventDefault();
          triggerUndo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerUndo]);

  return (
    <UndoContext.Provider value={{ register, triggerUndo }}>
      {children}
      {visible && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] min-w-[280px] max-w-sm rounded-lg shadow-xl overflow-hidden bg-foreground text-background"
          data-testid="undo-toast"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm font-medium truncate">{label}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={triggerUndo}
              className="shrink-0 border-background/40 text-background hover:text-background hover:bg-background/20"
              data-testid="button-undo"
            >
              Undo
            </Button>
          </div>
          <div className="h-0.5 bg-background/20">
            <div
              className="h-full bg-background/60 transition-none will-change-transform"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </UndoContext.Provider>
  );
}

export function useUndo() {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndo must be used within UndoProvider");
  return ctx;
}
