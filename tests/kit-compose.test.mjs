import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { imagensDosServicos, separarReferencia, trocarImagem } from "../infra/kit/fixar-imagens.mjs";

// O compose do kit (infra/compose/docker-compose.kit.yml; docs/32 §11.6 e §11.7; docs/20 §9C): o stack da producao
// reduzido ao que o app usa, com as imagens de terceiros presas pelo resumo, os nomes do kit.conf (A10), so o Caddy com
// porta publicada, o app falando com o Supabase pela rede interna, os modelos de e-mail servidos por dentro e o Caddy
// com certificado direto (a Cloudflare e opcional). Estatico (sem Docker); o `docker compose config` roda quando ha
// o plugin do compose na maquina.
const raiz = fileURLToPath(new URL("..", import.meta.url));
const ler = (caminho) => readFileSync(join(raiz, caminho), "utf8");
const kitFonte = ler("infra/compose/docker-compose.kit.yml");
const producaoFonte = ler("infra/compose/docker-compose.yml");
const caddyKit = ler("infra/compose/caddy/Caddyfile.kit");
const frenteDireta = ler("infra/compose/caddy/frente/direta.caddyfile");
const frenteCloudflare = ler("infra/compose/caddy/frente/cloudflare.caddyfile");
const kitConf = ler("infra/kit/kit.conf");

const NO_KIT = ["db", "auth", "rest", "storage", "imgproxy", "api-gw", "app", "caddy"];
const FORA_DO_KIT = ["realtime", "supavisor", "functions", "studio", "meta"];

/** Os blocos de cada servico, pela indentacao (dois espacos sob `services:`). */
function servicos(fonte) {
  const corpo = fonte.slice(fonte.indexOf("\nservices:\n"));
  const blocos = {};
  let atual = null;
  for (const linha of corpo.split("\n").slice(2)) {
    const nome = linha.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (nome) {
      atual = nome[1];
      blocos[atual] = "";
    } else if (/^\S/.test(linha)) {
      break; // o proximo bloco de cima (volumes:) ja nao e servico
    } else if (atual) {
      blocos[atual] += `${linha}\n`;
    }
  }
  return blocos;
}
const kit = servicos(kitFonte);
const semComentarios = (texto) => texto.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const ambiente = (bloco) => Object.fromEntries([...bloco.matchAll(/^ {6}([A-Z][A-Z0-9_]*): (.*)$/gm)].map((m) => [m[1], m[2]]));

test("o kit leva o Postgres, o Auth, o PostgREST, o Storage com o imgproxy, o gateway, o app e o Caddy, e nada mais", () => {
  assert.deepEqual(Object.keys(kit).sort(), [...NO_KIT].sort());
  for (const nome of FORA_DO_KIT) assert.equal(kit[nome], undefined, `${nome} nao vai no kit`);
  // Nada fica atras de perfil: um `docker compose up -d` sobe tudo, e nenhum servico espera quem nao existe.
  for (const [nome, bloco] of Object.entries(kit)) {
    assert.doesNotMatch(bloco, /^ {4}profiles:/m, nome);
    const dependeDe = [...(bloco.match(/^ {4}depends_on:\n((?: {6}.*\n)+)/m)?.[1] ?? "").matchAll(/^ {6}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    for (const outro of dependeDe) assert.ok(NO_KIT.includes(outro), `${nome} depende de ${outro}`);
  }
  // Nem os scripts de inicio que so o Realtime, o Logflare e o Supavisor usavam, nem o volume do Edge Runtime.
  assert.doesNotMatch(kitFonte, /realtime\.sql|_supabase\.sql|logs\.sql|pooler\.sql|deno-cache|functions/);
  assert.doesNotMatch(semComentarios(caddyKit), /realtime|functions|graphql|studio|mautic/i);
});

test("toda imagem de terceiro vai presa pelo resumo, com a mesma etiqueta da producao", () => {
  const imagensKit = imagensDosServicos(kitFonte);
  const imagensProducao = imagensDosServicos(producaoFonte);
  for (const nome of NO_KIT) {
    if (nome === "app") continue;
    const ref = separarReferencia(imagensKit[nome]);
    assert.ok(ref, `${nome}: ${imagensKit[nome]}`);
    assert.match(ref.resumo ?? "", /^sha256:[0-9a-f]{64}$/, `${nome} sem resumo`);
    const producao = separarReferencia(imagensProducao[nome]);
    assert.ok(producao, `${nome} na producao`);
    // Trocou a versao na producao? `node infra/kit/fixar-imagens.mjs` resolve o resumo da etiqueta nova.
    assert.equal(`${ref.repositorio}:${ref.tag}`, `${producao.repositorio}:${producao.tag}`, `${nome}: a etiqueta do kit e a da producao`);
  }
  // Nenhum resumo repetido (copiar e colar a linha errada) e nenhum `latest`.
  const resumos = Object.entries(imagensKit).filter(([n]) => n !== "app").map(([, r]) => separarReferencia(r).resumo);
  assert.equal(new Set(resumos).size, resumos.length);
  assert.doesNotMatch(kitFonte, /:latest\b/);
  // O app e a imagem do Pacote da versao: sem padrao, sem build (o comprador nunca constroi).
  assert.equal(imagensKit.app, undefined, "a linha do app nao e uma referencia de registry");
  assert.match(kit.app, /^ {4}image: \$\{APP_IMAGE:\?falta APP_IMAGE, a imagem do app carregada do Pacote da versao\}$/m);
  assert.doesNotMatch(kit.app, /^ {4}build:/m);
});

test("fixar-imagens: le as etiquetas, separa a referencia e troca so a linha do servico", () => {
  assert.deepEqual(separarReferencia("caddy:2.11.7-alpine"), { repositorio: "caddy", tag: "2.11.7-alpine", resumo: null });
  assert.deepEqual(separarReferencia(`supabase/gotrue:v2.197.0@sha256:${"a".repeat(64)}`), { repositorio: "supabase/gotrue", tag: "v2.197.0", resumo: `sha256:${"a".repeat(64)}` });
  assert.equal(separarReferencia("ghcr.io/x/y"), null, "sem etiqueta");
  assert.equal(separarReferencia(`caddy@sha256:${"a".repeat(64)}`), null, "so resumo, sem etiqueta para quem le");
  const novo = trocarImagem(kitFonte, "rest", `postgrest/postgrest:v14.18@sha256:${"b".repeat(64)}`);
  assert.equal(imagensDosServicos(novo).rest, `postgrest/postgrest:v14.18@sha256:${"b".repeat(64)}`);
  const antes = imagensDosServicos(kitFonte);
  const depois = imagensDosServicos(novo);
  for (const nome of NO_KIT) if (nome !== "rest") assert.equal(depois[nome], antes[nome], nome);
  assert.equal(novo.split("\n").length, kitFonte.split("\n").length);
  assert.throws(() => trocarImagem(kitFonte, "realtime", "x:y"), /nao esta no compose/);
});

test("os nomes vem do kit.conf: nada de bunker707 no compose, no Caddy e nos arquivos da frente (A10)", () => {
  for (const [arquivo, fonte] of [["docker-compose.kit.yml", kitFonte], ["Caddyfile.kit", caddyKit], ["frente/direta", frenteDireta], ["frente/cloudflare", frenteCloudflare]]) {
    // BUNKER_AI_GATEWAY_* sao variaveis que o app le, nao nomes que o comprador ve.
    assert.doesNotMatch(fonte, /bunker707/i, `${arquivo} escreve o nome; ele vem de KIT_NOME`);
  }
  assert.match(kitFonte, /^name: \$\{KIT_NOME:\?falta KIT_NOME; rode pelos comandos do kit, que o leem de infra\/kit\/kit\.conf\}$/m);
  const nomes = {};
  for (const [nome, bloco] of Object.entries(kit)) {
    const m = /^ {4}container_name: \$\{KIT_NOME:\?falta KIT_NOME\}-([a-z-]+)$/m.exec(bloco);
    assert.ok(m, `${nome}: container_name a partir de KIT_NOME`);
    nomes[nome] = m[1];
  }
  // A lista do kit.conf (o que o ensaio nunca toca) e exatamente o que o compose cria.
  const lista = /^KIT_CONTAINERS_DA_ESCOLA="\$\{KIT_CONTAINERS_DA_ESCOLA:-(.*)\}"$/m.exec(kitConf)?.[1].split(" ").map((n) => n.replace("$KIT_NOME-", ""));
  assert.deepEqual(lista.sort(), Object.values(nomes).sort());
  assert.match(kitConf, /^KIT_ARQUIVO_COMPOSE="\$\{KIT_ARQUIVO_COMPOSE:-\$KIT_PASTA_COMPOSE\/docker-compose\.kit\.yml\}"$/m);
  assert.match(kitConf, /^KIT_VOLUMES_DA_ESCOLA="\$\{KIT_VOLUMES_DA_ESCOLA:-\$\{KIT_PROJETO_COMPOSE\}_db-config \$\{KIT_PROJETO_COMPOSE\}_caddy-config\}"$/m);
  assert.match(ler("infra/kit/lib-kit.sh"), /^export KIT_NOME KIT_PASTA_CERTIFICADOS$/m, "lib-kit exporta o que o compose interpola");
});

test("so o Caddy publica porta: 80 e 443 (TCP e UDP); o banco e o gateway ficam so na rede interna", () => {
  for (const [nome, bloco] of Object.entries(kit)) {
    if (nome === "caddy") continue;
    assert.doesNotMatch(bloco, /^ {4}(ports|expose):/m, `${nome} nao publica porta`);
  }
  const portas = [...kit.caddy.match(/^ {4}ports:\n((?: {6}- .*\n)+)/m)[1].matchAll(/^ {6}- (.*)$/gm)].map((m) => m[1]);
  assert.deepEqual(portas, [
    "${CADDY_BIND:-0.0.0.0}:${CADDY_HTTP_PORT:-80}:80",
    "${CADDY_BIND:-0.0.0.0}:${CADDY_HTTPS_PORT:-443}:443",
    "${CADDY_BIND:-0.0.0.0}:${CADDY_HTTPS_PORT:-443}:443/udp"
  ]);
  assert.doesNotMatch(kitFonte, /network_mode: host|privileged: true|\/var\/run\/docker\.sock/);
});

test("o app fala com o Supabase pela rede interna; o endereco publico fica para o navegador e os links", () => {
  const app = ambiente(kit.app);
  assert.equal(app.SUPABASE_INTERNAL_URL, "http://api-gw:8000");
  assert.equal(app.NEXT_PUBLIC_SUPABASE_URL, "${SUPABASE_PUBLIC_URL}");
  assert.equal(app.NEXT_PUBLIC_SITE_URL, "${APP_PUBLIC_URL}");
  // O mesmo pacote de variaveis da producao, mais o endereco interno (o resto da guarda esta em
  // tests/infra-compose-env.guard.test.mjs, que confere os dois composes).
  const producao = ambiente(servicos(producaoFonte).app);
  assert.deepEqual(Object.keys(app).filter((k) => k !== "SUPABASE_INTERNAL_URL").sort(), Object.keys(producao).sort());
  assert.match(kit.app, /^ {4}extra_hosts:\n {6}- "\$\{SUPABASE_PUBLIC_HOST:\?falta SUPABASE_PUBLIC_HOST, o host do endereco publico do Supabase\}:host-gateway"$/m, "so o otimizador do next/image usa o nome publico");
  assert.match(kit.app, /^ {4}depends_on:\n {6}api-gw:\n {8}condition: service_healthy$/m);
});

test("o Auth baixa os modelos de e-mail do Caddy pela rede interna, e a porta deles nao sai do compose", () => {
  const auth = ambiente(kit.auth);
  const modelos = Object.entries(auth).filter(([k]) => k.startsWith("GOTRUE_MAILER_TEMPLATES_"));
  assert.equal(modelos.length, 6);
  const pasta = readdirSync(join(raiz, "infra/compose/volumes/auth-templates")).filter((n) => n.endsWith(".html")).sort();
  assert.deepEqual(modelos.map(([, url]) => url.replace("http://caddy:8088/auth-templates/", "")).sort(), pasta);
  assert.doesNotMatch(kit.auth, /extra_hosts|SUPABASE_PUBLIC_URL/, "nem o DNS nem o certificado do endereco publico entram no envio");
  for (const [chave, valor] of Object.entries(auth).filter(([k]) => k.startsWith("GOTRUE_MAILER_SUBJECTS_"))) {
    assert.doesNotMatch(valor, /bunker707/i, chave);
  }
  // O Caddy serve a pasta na 8088 (so na rede do compose) e nao mais no endereco publico da API.
  const interno = caddyKit.slice(caddyKit.indexOf("http://:8088 {"));
  assert.match(interno, /handle_path \/auth-templates\/\* \{\n\t\troot \* \/srv\/auth-templates\n\t\tfile_server\n\t\}/);
  const api = semComentarios(caddyKit.slice(caddyKit.indexOf("{$SUPABASE_SITE_ADDRESS} {"), caddyKit.indexOf("http://:8088 {")));
  assert.doesNotMatch(api, /auth-templates/);
  assert.match(api, /^\t@api path \/auth\/v1\/\* \/rest\/v1\/\* \/storage\/v1\/\*$/m);
  assert.match(api, /handle \{\n\t\trespond 404\n\t\}/);
  assert.match(kit.caddy, /^ {6}- \.\/volumes\/auth-templates:\/srv\/auth-templates:ro$/m);
});

test("certificado direto, de mais de uma autoridade, numa pasta que sobrevive a reinstalacao; a Cloudflare e opcional", () => {
  // Os emissores padrao do Caddy 2.11 sao o Let's Encrypt e, com o e-mail da conta, o ZeroSSL: nada pode fixar um so.
  assert.match(caddyKit, /^\{\n\temail \{\$ACME_EMAIL\}\n/m);
  assert.doesNotMatch(semComentarios(caddyKit), /acme_ca|cert_issuer|local_certs|tls internal|acme_dns/);
  assert.match(ambiente(kit.caddy).ACME_EMAIL, /^\$\{ACME_EMAIL:\?/, "sem e-mail o compose para");
  // /data (a conta ACME e os certificados) numa pasta do servidor, fora do pacote e dos volumes do Docker.
  assert.match(kit.caddy, /^ {6}- \$\{KIT_PASTA_CERTIFICADOS:\?falta KIT_PASTA_CERTIFICADOS; rode pelos comandos do kit\}:\/data$/m);
  assert.doesNotMatch(kitFonte, /caddy-data/);
  assert.match(kitConf, /^KIT_PASTA_CERTIFICADOS="\$\{KIT_PASTA_CERTIFICADOS:-\$KIT_PASTA_ESTADO\/caddy\}"$/m);
  // A frente: direta por padrao (nenhum cabecalho de IP aceito), cloudflare so por escolha.
  assert.match(caddyKit, /^\tservers \{\n\t\timport \/etc\/caddy\/frente\/\{\$CADDY_FRENTE:direta\}\.caddyfile\n\t\}$/m);
  assert.equal(ambiente(kit.caddy).CADDY_FRENTE, "${CADDY_FRENTE:-direta}");
  assert.equal(semComentarios(frenteDireta).trim(), "", "a frente direta nao confia em ninguem");
  assert.deepEqual(semComentarios(frenteCloudflare).trim().split("\n"), [
    "import /etc/caddy/cloudflare-trusted-proxies.caddyfile",
    "client_ip_headers CF-Connecting-IP X-Forwarded-For"
  ]);
  for (const montagem of ["./caddy/Caddyfile.kit:/etc/caddy/Caddyfile:ro", "./caddy/frente:/etc/caddy/frente:ro", "./caddy/cloudflare-trusted-proxies.caddyfile:/etc/caddy/cloudflare-trusted-proxies.caddyfile:ro"]) {
    assert.ok(kit.caddy.includes(`      - ${montagem}\n`), montagem);
  }
  // As faixas da Cloudflare sao as da producao (um arquivo so para atualizar).
  assert.match(ler("infra/compose/caddy/cloudflare-trusted-proxies.caddyfile"), /^trusted_proxies static 173\.245\.48\.0\/20 /m);
});

test("o banco, o gateway e os modelos usam os arquivos da producao, nos mesmos caminhos", () => {
  const producao = servicos(producaoFonte);
  const montagens = (bloco) => [...bloco.matchAll(/^ {6}- (\.\/\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(montagens(kit["api-gw"]), montagens(producao["api-gw"]));
  for (const m of ["./volumes/db/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:Z", "./volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:Z", "./volumes/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:Z", "./volumes/db/data:/var/lib/postgresql/data:Z"]) {
    assert.ok(montagens(kit.db).includes(m), m);
    assert.ok(montagens(producao.db).includes(m), `${m} na producao`);
  }
  assert.match(kit.db, /^ {6}- db-config:\/etc\/postgresql-custom$/m, "a chave do Vault no volume que o backup le");
  assert.deepEqual(montagens(kit.storage), ["./volumes/storage:/var/lib/storage:z"]);
});

const temCompose = (() => {
  const r = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
})();
const pastas = [];
after(() => pastas.forEach((p) => rmSync(p, { recursive: true, force: true })));

test("docker compose config: os 8 servicos com os nomes de KIT_NOME, e sem KIT_NOME o compose para", { skip: temCompose ? false : "sem o plugin do docker compose" }, () => {
  const pasta = mkdtempSync(join(tmpdir(), "kit-compose-"));
  pastas.push(pasta);
  const envFile = join(pasta, "env");
  writeFileSync(envFile, [
    "SUPABASE_PUBLIC_URL=https://api.alunos.escola.test", "SUPABASE_PUBLIC_HOST=api.alunos.escola.test", "APP_PUBLIC_URL=https://alunos.escola.test",
    "APP_SITE_ADDRESS=alunos.escola.test", "SUPABASE_SITE_ADDRESS=api.alunos.escola.test", "ACME_EMAIL=dono@escola.test", "APP_IMAGE=escola-app:1.0.0",
    "POSTGRES_HOST=db", "POSTGRES_DB=postgres", "POSTGRES_PORT=5432", ""
  ].join("\n"));
  const compose = (extra, ...args) => spawnSync("docker", ["compose", "-f", join(raiz, "infra/compose/docker-compose.kit.yml"), "--env-file", envFile, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }
  });
  const nomes = { KIT_NOME: "escola-teste", KIT_PASTA_CERTIFICADOS: "/var/lib/escola-teste/caddy" };
  const r = compose(nomes, "config", "--format", "json");
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(r.stdout);
  assert.equal(config.name, "escola-teste");
  assert.deepEqual(Object.keys(config.services).sort(), [...NO_KIT].sort());
  for (const [nome, servico] of Object.entries(config.services)) {
    assert.match(servico.container_name, /^escola-teste-[a-z-]+$/, nome);
    if (nome !== "caddy") assert.equal(servico.ports, undefined, `${nome} sem porta`);
  }
  assert.deepEqual(config.services.caddy.ports.map((p) => `${p.host_ip}:${p.published}/${p.protocol}`).sort(), ["0.0.0.0:443/tcp", "0.0.0.0:443/udp", "0.0.0.0:80/tcp"]);
  assert.ok(config.services.caddy.volumes.some((v) => v.type === "bind" && v.source === "/var/lib/escola-teste/caddy" && v.target === "/data"));
  assert.equal(config.services.app.environment.SUPABASE_INTERNAL_URL, "http://api-gw:8000");
  const semNome = compose({ KIT_PASTA_CERTIFICADOS: "/x" }, "config", "--services");
  assert.notEqual(semNome.status, 0);
  assert.match(semNome.stderr, /falta KIT_NOME/);
  const semCertificados = compose({ KIT_NOME: "escola-teste" }, "config", "--services");
  assert.notEqual(semCertificados.status, 0);
  assert.match(semCertificados.stderr, /falta KIT_PASTA_CERTIFICADOS/);
});
