// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const FALLBACK_BACKEND_URL = "https://wqpykfbacsczqvvigaqr.supabase.co";
const FALLBACK_BACKEND_PUBLISHABLE_KEY = "sb_publishable_9CcocmqcwnlO84vCVvrSKg_g2RrxgGG";

const clientBackendUrl =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_BACKEND_URL;
const clientBackendPublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  FALLBACK_BACKEND_PUBLISHABLE_KEY;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      // Permanent preview safety net: the generated browser backend client also
      // checks process.env fallbacks. Defining these public values prevents the
      // app from crashing when Vite's VITE_* injection is delayed or absent.
      "process.env.SUPABASE_URL": JSON.stringify(clientBackendUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(clientBackendPublishableKey),
    },
    plugins: [
      {
        ...nodePolyfills({
          include: ["buffer", "process"],
          globals: { Buffer: true, global: true, process: true },
          protocolImports: false,
        }),
        applyToEnvironment: (env) => env.name === "client",
      },
    ],
    resolve: {
      alias: [
        {
          // rpc-websockets has no workerd export condition; the SSR bundle
          // never opens a websocket (RPC subscriptions run in the browser
          // via /api/rpc), so alias it to a no-op stub.
          find: /^rpc-websockets$/,
          replacement: path.resolve(__dirname, "src/vendor/rpc-websockets-stub.ts"),
        },
      ],
    },
  },
});
