/**
 * In-app navigation history context.
 *
 * Maintains an in-memory stack of visited pathnames so the top bar can
 * offer ← Back and → Forward buttons that work independently of the
 * browser's native history buttons.
 *
 * Rules:
 *  - Only pathname changes are tracked (search/hash changes are ignored).
 *  - Consecutive duplicate pathnames are de-duplicated (no-op pushes).
 *  - goBack / goForward navigate via wouter without pushing to the stack.
 *  - refresh() invalidates all active React Query caches for the current page.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { useLocation } from "wouter";
import { queryClient } from "./queryClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface HistoryState {
  stack: string[];   // visited pathnames
  index: number;     // current position within stack
}

type HistoryAction =
  | { type: "PUSH"; path: string }
  | { type: "GO_BACK" }
  | { type: "GO_FORWARD" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH": {
      const current = state.stack[state.index];
      if (action.path === current) return state; // no-op duplicate
      // Truncate any forward stack, then append
      const newStack = [...state.stack.slice(0, state.index + 1), action.path];
      return { stack: newStack, index: newStack.length - 1 };
    }
    case "GO_BACK": {
      if (state.index <= 0) return state;
      return { ...state, index: state.index - 1 };
    }
    case "GO_FORWARD": {
      if (state.index >= state.stack.length - 1) return state;
      return { ...state, index: state.index + 1 };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NavHistoryContext = createContext<NavHistoryState>({
  canGoBack: false,
  canGoForward: false,
  goBack: () => {},
  goForward: () => {},
  refresh: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function NavHistoryProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const [state, dispatch] = useReducer(historyReducer, {
    stack: [location.split("?")[0]],
    index: 0,
  });

  // Flag set to true before a programmatic back/forward navigate so the
  // location-change effect knows NOT to push the resulting path to the stack.
  const internalNavRef = useRef(false);

  // When wouter's location changes, push it onto the stack — unless this
  // change was triggered by our own goBack/goForward.
  useEffect(() => {
    const pathname = location.split("?")[0];

    if (internalNavRef.current) {
      internalNavRef.current = false;
      return;
    }

    dispatch({ type: "PUSH", path: pathname });
  }, [location]);

  const canGoBack = state.index > 0;
  const canGoForward = state.index < state.stack.length - 1;

  const goBack = useCallback(() => {
    const nextIndex = state.index - 1;
    if (nextIndex < 0) return;
    internalNavRef.current = true;
    dispatch({ type: "GO_BACK" });
    setLocation(state.stack[nextIndex]);
  }, [state.index, state.stack, setLocation]);

  const goForward = useCallback(() => {
    const nextIndex = state.index + 1;
    if (nextIndex >= state.stack.length) return;
    internalNavRef.current = true;
    dispatch({ type: "GO_FORWARD" });
    setLocation(state.stack[nextIndex]);
  }, [state.index, state.stack, setLocation]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries();
  }, []);

  return (
    <NavHistoryContext.Provider
      value={{ canGoBack, canGoForward, goBack, goForward, refresh }}
    >
      {children}
    </NavHistoryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNavHistory(): NavHistoryState {
  return useContext(NavHistoryContext);
}
