import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./db.mjs";
import { readLocalSupabaseConfig } from "./local-db.mjs";

// Servidor do app para os testes de ponta a ponta (docs/18 §2.4): `next build` + `next start` na porta
// 3100, com as variaveis de .env.test.local (Supabase LOCAL) e tudo o que e externo vazio. O Playwright
// chama este arquivo pelo `webServer` de playwright.config.ts.
//
// O build grava em .next (o mesmo de `npm run build`), e as variaveis NEXT_PUBLIC_* entram no JavaScript
// do navegador na hora do build. Por isso o marcador .next/e2e-build.json diz com qual Supabase o build
// foi feito: E2E_SKIP_BUILD=1 so reaproveita o build se o marcador bater (um `npm run verify` no meio
// refaz o .next com o .env.local, e o app de teste passaria a falar com o projeto errado).

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = process.env.E2E_PORT ?? "3100";
const buildMarker = `${root}.next/e2e-build.json`;

loadEnvFile();
// Trava: nunca buildar nem subir o app de teste apontando para fora da maquina.
const { url } = readLocalSupabaseConfig();
console.log(`[e2e] app de teste com Supabase em ${url}, porta ${port}.`);

const nextBinary = `${root}node_modules/.bin/next`;

function buildMarkerMatches() {
  try {
    return existsSync(buildMarker) && JSON.parse(readFileSync(buildMarker, "utf8")).supabaseUrl === url;
  } catch {
    return false;
  }
}

if (process.env.E2E_SKIP_BUILD === "1" && buildMarkerMatches()) {
  console.log("[e2e] reaproveitando o build anterior feito para o Supabase local.");
} else {
  if (process.env.E2E_SKIP_BUILD === "1") {
    console.log("[e2e] o build em .next nao foi feito para o Supabase local (ou nao existe): buildando de novo.");
  }

  const build = spawnSync(nextBinary, ["build"], { cwd: root, env: process.env, stdio: "inherit" });

  if (build.status !== 0) {
    console.error("[e2e] next build falhou.");
    process.exit(build.status ?? 1);
  }

  writeFileSync(buildMarker, `${JSON.stringify({ builtAt: new Date().toISOString(), supabaseUrl: url })}\n`);
}

const server = spawn(nextBinary, ["start", "-p", port], { cwd: root, env: process.env, stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

server.on("exit", (code) => {
  process.exit(code ?? 0);
});
