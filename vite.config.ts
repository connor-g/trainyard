import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    // The app targets current Safari on iPad, so ship modern CSS (nesting, light-dark(), etc.)
    // as written instead of lowering it for older browsers.
    target: "safari26",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
