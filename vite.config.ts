import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    // The app targets current Safari on iPad, so ship modern CSS (nesting, light-dark(), etc.)
    // as written instead of lowering it for older browsers.
    target: "safari26",
  },
  plugins: [
    VitePWA({
      // src/sw.ts holds the caching rules; the plugin builds it and fills in the precache list.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // The worker takes over as soon as a new version installs; see src/sw.ts.
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      // The manifest is public/yard.webmanifest, linked from index.html.
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,svg,png,webmanifest}"],
      },
    }),
  ],
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
