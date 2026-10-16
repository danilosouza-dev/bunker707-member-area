import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./db.mjs";
import { readLocalSupabaseConfig } from "./local-db.mjs";

// Servidor do app para os testes de ponta a ponta (docs/18 §2.4): `next build` + `next start` na porta
// 3100, com as variaveis de .env.test.local (Supabase LOCAL) e tudo o que e externo vazio. O Playwright
// chama este arquivo pelo `webServer` de playwright.config.ts. E2E_SKIP_BUILD=1 reaproveita o build
// anterior (so para iterar localmente).

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = process.env.E2E_PORT ?? "3100";

loadEnvFile();
// Trava: nunca buildar nem subir o app de teste apontando para fora da maquina.
const { url } = readLocalSupabaseConfig();
console.log(`[e2e] app de teste com Supabase em ${url}, porta ${port}.`);

const nextBinary = `${root}node_modules/.bin/next`;

if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync(nextBinary, ["build"], { cwd: root, env: process.env, stdio: "inherit" });

  if (build.status !== 0) {
    console.error("[e2e] next build falhou.");
    process.exit(build.status ?? 1);
  }
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
