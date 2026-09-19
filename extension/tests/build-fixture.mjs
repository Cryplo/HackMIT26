import { build } from "vite";
await build({
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "tests/.generated",
    emptyOutDir: false,
    lib: {
      entry: "tests/react-fixture.tsx",
      name: "fixture",
      formats: ["iife"],
      fileName: () => "react-fixture.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
