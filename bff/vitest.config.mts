import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // esbuild (vitest's default) doesn't emit the decorator metadata that NestJS needs.
  plugins: [swc.vite()],
});
