import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda (docs/20 §8B.9): toda variavel do .env.example da raiz que o app le no servidor chega ao container `app` do
// servidor proprio. Em 30/10/2026 as dos webinarios estavam no .env do servidor mas fora do `environment:` do compose,
// e a sala ao vivo da producao ficaria em "em breve" mesmo com o segredo gravado pelo envelope.
const root = fileURLToPath(new URL("..", import.meta.url));

// Fora da producao de proposito: o duble do gravador (so testes e `next dev`), o simulador do Emissor interno (so fora
// da producao, docs/32 §11.10) e os nomes antigos das chaves do Supabase, que o app so le como reserva quando os nomes
// novos (PUBLISHABLE/SECRET) faltam.
const NOT_IN_PRODUCTION = new Set(["WEBINAR_RECORDER_DISPATCH", "EMISSOR_INTERNO_SIMULADOR", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// SUPABASE_INTERNAL_URL e so do kit (docs/32 §11.7): o servidor do app do comprador fala com o Supabase pela rede
// interna. A nossa producao continua pelo endereco publico (vazio = o comportamento de antes) ate a A29.
const KIT_ONLY = new Set(["SUPABASE_INTERNAL_URL"]);
// So da nossa producao, nunca do kit: a API interna do Emissor de licencas (docs/32 §11.10), que so a nossa escola fala.
const SELLER_ONLY = new Set(["EMISSOR_INTERNO_URL", "EMISSOR_INTERNO_CREDENCIAL"]);

function appEnvironment(file = "infra/compose/docker-compose.yml") {
  const compose = readFileSync(join(root, file), "utf8");
  const start = compose.indexOf("\n  app:\n");
  const end = compose.indexOf("\n  caddy:\n", start);
  assert.ok(start > 0 && end > start, "servicos app e caddy no compose");
  const block = compose.slice(start, end);
  return new Set([...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]));
}

test("o container app recebe toda variavel do .env.example que o app le (producao e kit)", () => {
  const keys = [...readFileSync(join(root, ".env.example"), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  const source = sourceFiles(join(root, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const readByApp = keys.filter((key) => !NOT_IN_PRODUCTION.has(key) && new RegExp(`\\b${key}\\b`).test(source));
  const environment = appEnvironment();
  const missing = readByApp.filter((key) => !KIT_ONLY.has(key) && !environment.has(key));
  assert.deepEqual(missing, [], "variaveis lidas pelo app e fora do environment do servico app");
  const kitEnvironment = appEnvironment("infra/compose/docker-compose.kit.yml");
  assert.deepEqual(readByApp.filter((key) => !SELLER_ONLY.has(key) && !kitEnvironment.has(key)), [], "variaveis lidas pelo app e fora do app do kit");
  for (const key of KIT_ONLY) assert.equal(environment.has(key), false, `${key} so no kit por enquanto`);
  for (const key of SELLER_ONLY) {
    assert.ok(readByApp.includes(key), `${key} e lida pelo app`);
    assert.equal(kitEnvironment.has(key), false, `${key} nunca no kit (o produto vendido nao fala com a API interna)`);
  }
});

test("as variaveis dos webinarios chegam ao app e o duble do gravador nunca (producao e kit)", () => {
  for (const file of ["infra/compose/docker-compose.yml", "infra/compose/docker-compose.kit.yml"]) assertWebinarEnvironment(appEnvironment(file));
  const example = readFileSync(join(root, "infra/compose/.env.example"), "utf8");
  assert.doesNotMatch(example, /^WEBINAR_RECORDER_DISPATCH=/m);
  assert.match(example, /^WEBINAR_JWT_SECRET=$/m);
});

function assertWebinarEnvironment(environment) {
  for (const key of [
    "WEBINAR_MEET_DOMAIN",
    "WEBINAR_JWT_APP_ID",
    "WEBINAR_JWT_SECRET",
    "WEBINAR_RECORDER_WEBHOOK_SECRET",
    "GITHUB_INFRA_TOKEN",
    "BUNNY_STREAM_API_KEY",
    "BUNNY_STREAM_LIBRARY_ID",
    "WEBINAR_ASSISTANT_ENABLED",
    "WEBINAR_TRANSLATION_ENABLED",
  ]) {
    assert.ok(environment.has(key), key);
  }
  assert.equal(environment.has("WEBINAR_RECORDER_DISPATCH"), false);
}
