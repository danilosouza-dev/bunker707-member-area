import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".claude/**",
    // Infraestrutura (compose, Caddy, Edge Functions do Deno vendidas do Supabase): nao e codigo do app.
    "infra/**",
    ".codex/**",
    ".codex-backups/**",
    ".gemini-scratch/**",
    "**/._*",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
