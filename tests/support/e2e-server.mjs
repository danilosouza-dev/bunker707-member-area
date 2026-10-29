import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ambienteDaSalaAoVivo } from "../fixtures/escola-de-teste.mjs";
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
//
// A sala ao vivo (docs/30 §10.1): o .env.test.local deixa WEBINAR_MEET_DOMAIN, WEBINAR_JWT_SECRET,
// WEBINAR_RECORDER_WEBHOOK_SECRET e WEBINAR_RECORDER_DISPATCH vazios; aqui eles ganham os valores SO de teste de
// AMBIENTE_DA_SALA_AO_VIVO_DE_TESTE (tests/fixtures/escola-de-teste.mjs) quando vazios: o hostname meet.bunker707.test
// (o navegador recebe o external_api.js falso por page.route, salaFalsaDoJitsi), os dois segredos que os testes usam
// para conferir o token e assinar o webhook do gravador, e o duble do pedido ao GitHub (inerte aqui: o `next start` roda
// como producao, onde o duble nao vale, e sem GITHUB_INFRA_TOKEN nada e pedido; o teste do console poe a sessao em
// `preparing` direto no banco). O hostname entra no build (a
// Permissions-Policy de /webinarios e do console da sala e fixada no next.config.ts), por isso tambem vai no marcador.

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = process.env.E2E_PORT ?? "3100";
const buildMarker = `${root}.next/e2e-build.json`;

loadEnvFile();
const salaAoVivo = ambienteDaSalaAoVivo(process.env);
// Trava: nunca buildar nem subir o app de teste apontando para fora da maquina.
const { url } = readLocalSupabaseConfig();
console.log(`[e2e] app de teste com Supabase em ${url}, porta ${port}; sala ao vivo em ${salaAoVivo.WEBINAR_MEET_DOMAIN}.`);

const nextBinary = `${root}node_modules/.bin/next`;

function buildMarkerMatches() {
  try {
    if (!existsSync(buildMarker)) {
      return false;
    }

    const marker = JSON.parse(readFileSync(buildMarker, "utf8"));
    return marker.supabaseUrl === url && marker.meetDomain === salaAoVivo.WEBINAR_MEET_DOMAIN;
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

  writeFileSync(buildMarker, `${JSON.stringify({ builtAt: new Date().toISOString(), meetDomain: salaAoVivo.WEBINAR_MEET_DOMAIN, supabaseUrl: url })}\n`);
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
