import { useUndo } from "@/contexts/undo-context";

export function useUndoableDelete() {
  const { register } = useUndo();

  return function scheduleDelete(options: {
    label: string;
    onCommit: () => Promise<void>;
    onOptimisticRemove?: () => void;
    onRestore?: () => void;
  }) {
    options.onOptimisticRemove?.();
    register(options.label, options.onCommit, options.onRestore);
  };
}
