import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Regua do pedaco do cartao Livre (docs/27 §7, L6a; scripts/livre-medir-cartao.mjs): numa pasta .next de mentira, no
// formato do Turbopack (o manifesto do Inicio, o build-manifest.json e os pedacos que se citam por
// "static/chunks/<nome>.js"), confere que a regua segue as referencias desde o manifesto do Inicio, ignora o pedaco
// velho sem referencia, o do editor e o do JS inicial, soma o que so o cartao baixa, mede em gzip, nao chuta quando
// acha nenhum ou dois cartoes e que a linha de comando falha acima de 12.288 B.

const { FREE_CARD_LIMIT_BYTES, measureFreeCard } = await import("../scripts/livre-medir-cartao.mjs");
const SCRIPT = fileURLToPath(new URL("../scripts/livre-medir-cartao.mjs", import.meta.url));

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Texto que o gzip quase nao encolhe, sempre igual para a mesma semente (xorshift; o teste nao depende da sorte). */
function noise(length, seed = 7) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let state = seed;
  let text = "";

  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    text += alphabet[(state >>> 0) % alphabet.length];
  }

  return text;
}

/** O carregador de um import() no Turbopack: a lista de pedacos do grupo. */
function load(...names) {
  return `e.v(t=>Promise.all([${names.map((name) => JSON.stringify(`static/chunks/${name}`)).join(",")}].map(t=>e.l(t))).then(()=>t(1)))`;
}

/**
 * Uma pasta .next de mentira. `manifest` sao os pedacos que o manifesto do Inicio cita nos clientModules; `entries`, os
 * entryJSFiles (a chave termina como no build de verdade, "[project]/src/app/page").
 */
function fakeNext({ chunks, manifest, rootMainFiles = [], entries = {} }) {
  const project = mkdtempSync(join(tmpdir(), "bunker707-livre-medir-"));
  const nextDir = join(project, ".next");

  dirs.push(project);
  mkdirSync(join(nextDir, "static", "chunks"), { recursive: true });
  mkdirSync(join(nextDir, "server", "app"), { recursive: true });

  for (const [name, text] of Object.entries(chunks)) {
    writeFileSync(join(nextDir, "static", "chunks", name), text);
  }

  const clientModules = Object.fromEntries(
    manifest.map((name, index) => [`[project]/src/modulo-${index}.tsx`, { id: index, name: "*", chunks: [`/_next/static/chunks/${name}`], async: false }])
  );
  const rsc = { moduleLoading: { prefix: "" }, clientModules, entryCSSFiles: {}, entryJSFiles: entries };

  writeFileSync(join(nextDir, "build-manifest.json"), JSON.stringify({ rootMainFiles: rootMainFiles.map((name) => `static/chunks/${name}`) }));
  writeFileSync(
    join(nextDir, "server", "app", "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify(rsc)};\n`
  );

  return nextDir;
}

const gz = (text) => gzipSync(Buffer.from(text)).length;

/**
 * O Inicio de mentira: casa.js (JS inicial) traz a janela com o comum e o editor por import(); a janela traz o cartao
 * junto com junto.js (so com ele) e o comum; o cartao traz o contador (so ele) e o comum de novo. velho.js tem a
 * prancheta, mas ninguem o cita.
 */
function homeChunks(cardText = `"data-free-artboard"${noise(3000, 11)}`) {
  return {
    "raiz.js": `runtime ${noise(400, 3)}`,
    "casa.js": `casa ${load("janela.js", "comum.js")} ${load("editor.js")} ${noise(500, 5)}`,
    "pagina.js": `pagina querySelector("[data-free-artboard]") ${noise(300, 9)}`,
    "erro.js": `erro ${noise(200, 13)}`,
    "janela.js": `"loadPopupFreeCard",()=>f.Q ${load("cartao.js", "junto.js", "comum.js")} ${noise(800, 17)}`,
    "comum.js": `comum ${noise(600, 19)}`,
    "junto.js": `junto ${noise(400, 47)}`,
    "cartao.js": `${cardText} ${load("contador.js", "comum.js")}`,
    "contador.js": `contador ${noise(700, 23)}`,
    "editor.js": `"data-free-artboard" "data-free-editor" ${noise(5000, 29)}`,
    "velho.js": `"data-free-artboard" ${noise(900, 31)}`
  };
}

function homeNext(chunks = homeChunks()) {
  return fakeNext({
    chunks,
    manifest: ["casa.js", "pagina.js"],
    rootMainFiles: ["raiz.js"],
    entries: {
      "[project]/src/app/layout": ["static/chunks/casa.js"],
      "[project]/src/app/global-error": ["static/chunks/casa.js", "static/chunks/erro.js"],
      "[project]/src/app/page": ["static/chunks/casa.js", "static/chunks/pagina.js"]
    }
  });
}

function runCli(nextDir) {
  const result = spawnSync(process.execPath, [SCRIPT, nextDir], { encoding: "utf8" });

  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const thousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

test("a régua segue do manifesto do Início até o cartão e soma em gzip o que só ele baixa", () => {
  const chunks = homeChunks();
  const result = measureFreeCard(homeNext(chunks));

  // O velho (sem referencia), o editor (data-free-editor) e o JS inicial (pagina.js) tem a prancheta e nao contam.
  assert.equal(result.card.file, "cartao.js");
  // Entram o que vem no import() do cartao (junto.js) e o que so ele alcanca (contador.js); o comum o Inicio baixa
  // sem o cartao (no import() da janela) e fica de fora.
  const card = ["cartao.js", "junto.js", "contador.js"];

  assert.deepEqual(result.card.files, card);
  assert.equal(result.card.gzip, card.reduce((total, name) => total + gz(chunks[name]), 0));
  assert.equal(result.card.raw, card.reduce((total, name) => total + Buffer.byteLength(chunks[name]), 0));
  assert.ok(result.card.gzip < result.card.raw, "mede o gzip, nao o arquivo cru");

  // A janela e o grupo do import() que tem o arquivo com loadPopupFreeCard.
  assert.deepEqual(result.dialog, { files: ["janela.js", "comum.js"], gzip: gz(chunks["janela.js"]) + gz(chunks["comum.js"]) });
  // JS inicial pelo docs/29 §7.2: rootMainFiles com o layout e a pagina, sem repetir casa.js e sem o global-error.
  assert.equal(result.initialGzip, gz(chunks["raiz.js"]) + gz(chunks["casa.js"]) + gz(chunks["pagina.js"]));
});

test("um cartão sem import() próprio e sozinho no import() da janela mede só o arquivo dele", () => {
  const chunks = homeChunks();

  chunks["cartao.js"] = `"data-free-artboard"${noise(3000, 11)}`;
  chunks["janela.js"] = `"loadPopupFreeCard" ${load("cartao.js")} ${noise(800, 17)}`;

  const result = measureFreeCard(homeNext(chunks));

  assert.deepEqual(result.card, { file: "cartao.js", files: ["cartao.js"], raw: Buffer.byteLength(chunks["cartao.js"]), gzip: gz(chunks["cartao.js"]) });
});

test("sem cartão, com dois cartões ou sem build, a régua para com a frase em vez de chutar", () => {
  const none = homeChunks();

  none["janela.js"] = `"loadPopupFreeCard" ${noise(800, 17)}`;
  assert.throws(() => measureFreeCard(homeNext(none)), { message: "Não achei um pedaço só do cartão Livre (0)." });

  const two = homeChunks();

  two["janela.js"] = `"loadPopupFreeCard" ${load("cartao.js")} ${load("outro-cartao.js")}`;
  two["outro-cartao.js"] = `"data-free-artboard" ${noise(1000, 37)}`;
  assert.throws(() => measureFreeCard(homeNext(two)), { message: "Não achei um pedaço só do cartão Livre (2)." });

  const empty = join(mkdtempSync(join(tmpdir(), "bunker707-livre-medir-")), ".next");

  dirs.push(dirname(empty));
  assert.throws(() => measureFreeCard(empty), /rode npm run build antes/);
});

test("a linha de comando imprime o tamanho e sai com 1 acima de 12.288 B", () => {
  assert.equal(FREE_CARD_LIMIT_BYTES, 12_288);

  const small = homeChunks();
  const ok = runCli(homeNext(small));
  const cardGzip = gz(small["cartao.js"]) + gz(small["junto.js"]) + gz(small["contador.js"]);

  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`pedaço do cartão Livre: ${thousands(cardGzip)} B gzip, limite 12\\.288 B`));
  assert.match(ok.stdout, new RegExp(`folga até o limite: ${thousands(FREE_CARD_LIMIT_BYTES - cardGzip)} B`));
  assert.match(ok.stdout, /, com junto\.js, contador\.js, que só ele baixa/);
  assert.match(ok.stdout, /janela do pop-up \(2 arquivos\)/);
  assert.equal(ok.stderr, "");

  // O cartao sozinho fica abaixo do limite; com o contador que so ele baixa, passa: a regra vale para a soma.
  const big = homeChunks(`"data-free-artboard"${noise(12_000, 41)}`);

  big["contador.js"] = `contador ${noise(6000, 43)}`;
  assert.ok(gz(big["cartao.js"]) <= FREE_CARD_LIMIT_BYTES);

  const over = runCli(homeNext(big));
  const overGzip = gz(big["cartao.js"]) + gz(big["junto.js"]) + gz(big["contador.js"]);

  assert.ok(overGzip > FREE_CARD_LIMIT_BYTES);
  assert.equal(over.status, 1);
  assert.match(over.stdout, new RegExp(`pedaço do cartão Livre: ${thousands(overGzip)} B gzip`));
  assert.match(over.stderr, new RegExp(`passou do limite: ${thousands(overGzip)} B gzip, limite 12\\.288 B`));

  const broken = homeChunks();

  broken["janela.js"] = `"loadPopupFreeCard" ${noise(800, 17)}`;

  const missing = runCli(homeNext(broken));

  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Não achei um pedaço só do cartão Livre \(0\)\./);
});

test("o npm run verify termina com a régua, depois do build (o CI roda o verify)", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(scripts["livre:medir"], "node scripts/livre-medir-cartao.mjs");
  assert.match(scripts.verify, /&& npm run build && npm run livre:medir$/);
});
