import path from "path";
import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";

/**
 * Vitest configuration for @workspace/fnb-cost-pro-mobile.
 *
 * All native Expo / React-Native modules are replaced by vi.mock() factories
 * inside each test file.  The tests run in jsdom so React component rendering
 * and useEffect hooks work without a physical device or Metro.
 *
 * React version note
 * ------------------
 * The mobile package ships with React 19 in its own node_modules (needed by
 * Expo 54), but @testing-library/react at the workspace root targets React 18.
 * Mixing the two versions causes "Objects are not valid as a React child"
 * because the element shape changed between releases.  We resolve react and
 * react-dom to the workspace-root copies (React 18) so the JSX transform and
 * the testing library are always in sync.
 *
 * Run:  pnpm --filter @workspace/fnb-cost-pro-mobile test
 *        or:  pnpm run test  (from this directory)
 */

// vitest 4 exposes an `oxc` top-level option not yet in upstream Vite types.
interface VitestUserConfig extends UserConfig {
  oxc?: { jsx?: { runtime?: string; importSource?: string } };
}

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const root = path.resolve(import.meta.dirname); // artifacts/fnb-cost-pro-mobile

const config: VitestUserConfig = {
  root,
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  // Expo's Metro bundler injects __DEV__ as a global; polyfill it for vitest.
  define: {
    __DEV__: true,
  },
  test: {
    root,
    environment: "jsdom",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    exclude: ["node_modules"],
  },
  resolve: {
    // Force all React resolution to the workspace-root React 18 so that
    // @testing-library/react (which also lives at the workspace root) and the
    // OXC JSX transform share a single React instance.
    alias: {
      "@": root,
      "react": path.resolve(workspaceRoot, "node_modules", "react"),
      "react/jsx-runtime": path.resolve(workspaceRoot, "node_modules", "react", "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(workspaceRoot, "node_modules", "react", "jsx-dev-runtime.js"),
      "react-dom": path.resolve(workspaceRoot, "node_modules", "react-dom"),
      "react-dom/client": path.resolve(workspaceRoot, "node_modules", "react-dom", "client.js"),
    },
    dedupe: ["react", "react-dom"],
  },
};

export default defineConfig(config);
