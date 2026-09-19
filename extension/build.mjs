import { build } from "vite";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: ["panel.html", "offscreen.html", "microphone.html"],
    },
  },
});
for (const [entry, name, format] of [
  ["src/background.ts", "background", "es"],
  ["src/content/index.ts", "content", "iife"],
  ["src/offscreen/pcm-worklet.ts", "pcm-worklet", "iife"],
]) {
  await build({
    configFile: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      lib: {
        entry,
        name: name.replaceAll("-", "_"),
        formats: [format],
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
await copyFile("manifest.json", "dist/manifest.json");
