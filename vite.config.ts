import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    // Forward save/load requests to the layouts service (`node layouts.ts`) during development.
    proxy: { "/api/layouts": "http://127.0.0.1:3000" },
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
