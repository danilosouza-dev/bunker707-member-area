import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda de arquitetura (docs/18 §1.2: conferencia de texto so vale como guarda, em arquivo .guard): o arquivo dos
// participantes simulados da instancia do motor (docs/30 D120), o que o monta e serve e o ?v= do carregador. O que ele
// pede ao motor tem teste de comportamento em tests/infra-jitsi-plateia.test.mjs; o carregador, em
// tests/infra-jitsi.test.mjs; o que o motor desenha com isso, so o ensaio local prova (docs/30 §6.9).
const here = dirname(fileURLToPath(import.meta.url));
const jitsiDir = join(here, "..", "infra", "jitsi");
const read = (path) => readFileSync(path, "utf8");
const script = read(join(jitsiDir, "web", "bunker707-plateia.js"));
const customConfig = read(join(jitsiDir, "web", "custom-config.js"));
// O que o arquivo executa, sem os comentarios (o cabecalho explica o motor e cita os nomes das fatias).
const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("o arquivo dos simulados nao busca nada, nao roda texto como codigo e nao mexe na pagina: so fala com o store do motor e com a conferencia", () => {
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import|require|eval|Function|innerHTML|outerHTML|insertAdjacentHTML|document|localStorage|sessionStorage|cookie|navigator)\b/, "nada de rede, de DOM nem de guardar no navegador");
  assert.doesNotMatch(code, /https?:\/\/|wss?:\/\//, "nenhum endereco escrito no arquivo (o https do filtro da foto e uma expressao, nao um endereco)");
  assert.doesNotMatch(code, /location\.(href|replace|assign)|\.postMessage\(/, "nao navega e nao manda mensagem para fora: so escuta a da pagina que o montou");
  assert.match(code, /event\.source !== window\.parent/, "a lista por mensagem so da pagina que montou o iframe");
  assert.match(code, /participant\.isModerator\(\)/, "no gravador, so de quem o Prosody marcou como moderador");
  assert.match(code, /botType: BOT/, "o simulado leva a marca que o motor pula ao escolher o video grande");
  assert.match(code, /var MAX_PEOPLE = 300;/, "o teto de miniaturas simuladas");
  assert.doesNotMatch(script, /<\/?script|<!--/i, "nem a tag de script nem o abre-comentario de HTML no arquivo");
});

test("so as quatro acoes e as quatro fatias conferidas na tag fixada: mudou a tag, o ensaio do docs/30 §6.9 se repete", () => {
  const types = [...new Set([...code.matchAll(/type: '([A-Z_]+)'/g)].map((match) => match[1]))].sort();
  assert.deepEqual(types, ["PARTICIPANT_JOINED", "PARTICIPANT_LEFT", "PARTICIPANT_UPDATED", "SET_REMOTE_PARTICIPANTS"]);
  const slices = [...new Set([...code.matchAll(/\['(features\/[a-z/-]+)'\]/g)].map((match) => match[1]))].sort();
  assert.deepEqual(slices, ["features/base/conference", "features/base/config", "features/base/participants", "features/filmstrip"]);
  const events = [...new Set([...code.matchAll(/\.on\('([a-zA-Z._]+)'/g)].map((match) => match[1]))].sort();
  assert.deepEqual(events, ["conference.endpoint_message_received", "conference.userJoined"]);
  const tag = /^JITSI_IMAGE_VERSION=(\S+)$/m.exec(read(join(jitsiDir, ".env.example")))?.[1];
  assert.ok(tag && script.includes(`(${tag})`), "o cabecalho do arquivo diz em que tag os nomes foram conferidos: a de agora");
});

test("montagem e smoke: o arquivo no nginx do web (somente leitura), servido em /libs, conferido pelo sha256 e pelo ?v= do config.js servido", () => {
  const compose = read(join(jitsiDir, "docker-compose.yml"));
  assert.match(compose, /- \.\/web\/bunker707-plateia\.js:\/usr\/share\/jitsi-meet\/libs\/bunker707-plateia\.js:ro/, "o arquivo montado no nginx do web, somente leitura");
  const smoke = read(join(jitsiDir, "scripts", "smoke.sh"));
  assert.match(smoke, /plateia_sha=\$\(sha256sum "\$plateia_file" \| cut -c1-64\); plateia_v=\$\{plateia_sha:0:8\}/, "o smoke calcula o v pelo arquivo do commit");
  assert.match(smoke, /check "libs\/bunker707-plateia\.js[^"]*" 200 "\$public_url\/libs\/bunker707-plateia\.js"/, "o smoke confere que o arquivo e servido");
  assert.match(smoke, /served_sha=\$\(curl [^\n]*"\$public_url\/libs\/bunker707-plateia\.js\?v=\$plateia_v"[^\n]*\| sha256sum/, "e que o servido e o do commit");
  assert.match(smoke, /"libs\/bunker707-plateia\.js\?v=\$plateia_v"; do/, "e que o config.js servido traz o carregador com o v atual");
});

test("o ?v= do carregador e o comeco do sha256 do arquivo: mudou o arquivo, muda o endereco (o nginx guarda /libs/* por um ano com ?v=)", () => {
  const v = createHash("sha256").update(readFileSync(join(jitsiDir, "web", "bunker707-plateia.js"))).digest("hex").slice(0, 8);
  const loaded = /script\.src = '\/libs\/bunker707-plateia\.js\?v=([0-9a-f]{8})';/.exec(customConfig)?.[1];
  assert.equal(loaded, v, `o arquivo mudou: troque o v do carregador em infra/jitsi/web/custom-config.js para ${v}`);
});
