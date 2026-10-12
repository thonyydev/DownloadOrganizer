import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig({
  files: ["src/**/*.{ts,tsx}", "vite.config.ts", "vitest.config.ts"],
  extends: [js.configs.recommended, tseslint.configs.recommended],
});
