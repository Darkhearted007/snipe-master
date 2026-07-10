// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      // Inject Buffer/process/global polyfills into the client bundle so
      // @solana/web3.js and wallet-adapter chunks see them before evaluation.
      // Applies only to the client build, not SSR (workerd already has them).
      nodePolyfills({
        include: ["buffer", "process"],
        globals: { Buffer: true, global: true, process: true },
        protocolImports: false,
      }),
    ],
    resolve: {
      alias: [
        {
          // rpc-websockets has no workerd export condition; the SSR bundle
          // never opens a websocket (RPC subscriptions run in the browser
          // via /api/rpc), so alias it to a no-op stub.
          find: /^rpc-websockets$/,
          replacement: path.resolve(
            __dirname,
            "src/vendor/rpc-websockets-stub.ts",
          ),
        },
      ],
    },
  },
});
