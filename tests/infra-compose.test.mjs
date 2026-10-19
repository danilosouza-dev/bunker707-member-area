import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Compose do servidor proprio (infra/compose; docs/20). O teste de carga de 19/10/2026 no CX23 mostrou o
// Studio e o meta comendo cerca de 35% de 1 vCPU sem ninguem usar o painel, o Auth validando a sessao duas
// vezes por pagina e o Envoy checando o PostgREST pelo GET / (o OpenAPI, ~150 ms de banco a cada 5 s). Os
// tres ajustes ficam travados aqui.
const composeSource = readFileSync(new URL("../infra/compose/docker-compose.yml", import.meta.url), "utf8");
const envExampleSource = readFileSync(new URL("../infra/compose/.env.example", import.meta.url), "utf8");
const envoyClustersSource = readFileSync(new URL("../infra/compose/volumes/api/envoy/cds.yaml", import.meta.url), "utf8");

// Blocos de servico pela indentacao (dois espacos sob `services:`), sem depender de um parser de YAML.
function services(source) {
  const body = source.slice(source.indexOf("\nservices:\n"));
  const blocks = {};
  let current = null;
  for (const line of body.split("\n").slice(2)) {
    const name = line.match(/^  ([a-z][a-z0-9-]*):\s*$/);
    if (name) {
      current = name[1];
      blocks[current] = "";
    } else if (/^\S/.test(line)) {
      current = null;
    } else if (current) {
      blocks[current] += `${line}\n`;
    }
  }
  return blocks;
}

test("Studio e meta so sobem com o perfil studio; o resto do stack nao tem perfil", () => {
  const blocks = services(composeSource);
  for (const name of ["studio", "meta"]) {
    assert.ok(blocks[name], `servico ${name} no compose`);
    assert.match(blocks[name], /^    profiles: \["studio"\]$/m, name);
  }
  for (const name of ["db", "auth", "rest", "storage", "realtime", "api-gw", "app", "caddy"]) {
    assert.ok(blocks[name], `servico ${name} no compose`);
    assert.doesNotMatch(blocks[name], /^    profiles:/m, `${name} precisa subir com um docker compose up -d simples`);
  }
});

test("nenhum servico sempre ligado espera o Studio ou o meta", () => {
  for (const [name, block] of Object.entries(services(composeSource))) {
    if (name === "studio" || name === "meta") continue;
    const dependsOn = block.match(/^    depends_on:\n((?: {6}.*\n)+)/m)?.[1] ?? "";
    assert.doesNotMatch(dependsOn, /^ {6}(studio|meta):/m, `${name} depende de servico do perfil studio`);
  }
});

test("servidor proprio valida a sessao pelos claims (JWKS ES256) por padrao", () => {
  assert.match(envExampleSource, /^AUTH_SESSION_STRATEGY=claims$/m);
  assert.match(services(composeSource).app, /AUTH_SESSION_STRATEGY: \$\{AUTH_SESSION_STRATEGY:-user\}/);
});

test("o Envoy checa o PostgREST so pela porta, nunca pelo GET / que monta o OpenAPI no banco", () => {
  const clusters = envoyClustersSource.split(/^  - '@type': /m).slice(1);
  const rest = clusters.find((cluster) => /^    name: rest$/m.test(cluster));
  assert.ok(rest, "cluster rest no cds.yaml");
  assert.match(rest, /^    health_checks:\n(?: {6}.*\n)*? {8}tcp_health_check: \{\}$/m);
  assert.doesNotMatch(rest, /http_health_check/);
  // Os outros clusters seguem o upstream: todos continuam com checagem ativa.
  for (const cluster of clusters) assert.match(cluster, /^    health_checks:$/m);
});
