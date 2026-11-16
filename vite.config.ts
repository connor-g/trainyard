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
  fmt: { sortImports: {} },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest", "promise"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    // Only errors: promote the default (warn) correctness category, leave the rest off.
    categories: { correctness: "error" },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",

      // Explicit parameter and return types on everything exported.
      "typescript/explicit-module-boundary-types": "error",

      // Named imports and exports only.
      "import/no-default-export": "error",
      "import/no-named-default": "error",

      // Types and values in separate import / export statements.
      "typescript/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "typescript/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      "typescript/no-import-type-side-effects": "error",
      "import/no-duplicates": "error",

      // async/await over promise chains, and no async functions where a plain callback is expected.
      "promise/prefer-await-to-then": "error",
      "typescript/no-misused-promises": "error",

      // TypeScript already checks titles; tests pass Vitest's message argument to expect().
      "vitest/valid-title": "off",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      // Shared assertion helpers such as expectClose() count as assertions.
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect*"] }],
    },
    overrides: [
      // Vite+ loads its config through a default export.
      { files: ["vite.config.ts"], rules: { "import/no-default-export": "off" } },
    ],
    options: { typeAware: true, typeCheck: true },
  },
});
