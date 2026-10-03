// Shared flat config for the non-Expo workspace packages. apps/mobile has its own.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.expo/**", "apps/mobile/**", "apps/ai-service/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
