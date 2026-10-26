// Regua do pedaco do cartao Livre (docs/27 §7, L6a): depois do `next build`, mede quanto o aluno baixa a mais quando
// o pop-up armado e Livre e falha acima de 12 KB (12.288 B gzip). Roda no fim do `npm run verify`:
//
//   npm run livre:medir                              (a pasta .next do projeto)
//   node scripts/livre-medir-cartao.mjs <pasta .next>
//
// O metodo e o das medidas do L3 e do L4b no docs/27 §7:
// - comeca nos arquivos que o manifesto do Inicio ("/", server/app/page_client-reference-manifest.js) cita e segue as
//   referencias static/chunks/<nome>.js de arquivo em arquivo (o import() do host que traz a janela, o da janela que
//   traz o cartao). Pedaco velho que nenhum arquivo cita (de um build anterior na mesma pasta) nao conta. Cada pagina
//   tem a sua copia do cartao (dezenas de bytes de diferenca entre elas); a regua mede a do Inicio;
// - o cartao e o unico arquivo alcancado, fora do manifesto, com `data-free-artboard` e sem `data-free-editor` (o
//   editor Livre tambem desenha a prancheta). Nenhum ou mais de um: erro, a regua nao chuta;
// - entram na conta os pedacos que vem no mesmo import() do cartao e os que so ele alcanca (um import() de dentro dele,
//   como o plano B do contador no L6f), menos os que o Inicio alcanca sem passar pelo cartao: separar um pedaco do
//   cartao nao tira esse pedaco da regua;
// - gzip no nivel padrao do zlib, arquivo por arquivo.
// So para conferir, tambem imprime a janela do pop-up (o grupo do import() do host com o arquivo que tem
// loadPopupFreeCard) e o JS inicial do Inicio pelo metodo do docs/29 §7.2 (os rootMainFiles com os entryJSFiles do
// layout e da pagina, sem repetir arquivo).

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** O teto do pedaco do cartao Livre: 12 KB gzip (docs/27 §7). */
export const FREE_CARD_LIMIT_BYTES = 12_288;

const HOME_MANIFEST = "server/app/page_client-reference-manifest.js";
const CHUNK_NAME = "[A-Za-z0-9_~.-]+\\.js";
const CHUNK_REF = new RegExp(`static/chunks/(${CHUNK_NAME})`, "g");
/** A lista de pedacos de um import() do Turbopack: ["static/chunks/a.js","static/chunks/b.js"]. */
const CHUNK_GROUP = new RegExp(`\\[("static/chunks/${CHUNK_NAME}"(?:,"static/chunks/${CHUNK_NAME}")*)\\]`, "g");

/**
 * Mede o pedaco do cartao Livre a partir da pasta `.next` de um `next build`. `card.files` comeca pelo arquivo com a
 * prancheta e traz depois os pedacos que so ele faz baixar; `card.raw` e `card.gzip` somam todos.
 */
export function measureFreeCard(nextDir) {
  const manifestPath = join(nextDir, HOME_MANIFEST);

  if (!existsSync(manifestPath)) {
    throw new Error(`Não achei ${manifestPath}: rode npm run build antes.`);
  }

  const chunksDir = join(nextDir, "static", "chunks");
  const texts = new Map();
  const textOf = (name) => {
    if (!texts.has(name)) {
      const path = join(chunksDir, name);

      texts.set(name, existsSync(path) ? readFileSync(path, "utf8") : null);
    }

    return texts.get(name);
  };
  const refsIn = (name) => (textOf(name) === null ? null : refsOf(textOf(name)));
  const manifestText = readFileSync(manifestPath, "utf8");
  const initial = refsOf(manifestText);
  const reached = reachable(initial, refsIn);
  const outside = [...reached].filter((name) => !initial.includes(name));
  const cards = outside.filter((name) => textOf(name).includes("data-free-artboard") && !textOf(name).includes("data-free-editor"));

  if (cards.length !== 1) {
    throw new Error(`Não achei um pedaço só do cartão Livre (${cards.length}).`);
  }

  const [file] = cards;
  const groups = [...reached].flatMap((name) => groupsOf(textOf(name)));
  // O Inicio sem o cartao: sem o arquivo dele e sem as listas de import() que o trazem.
  const withoutCard = reachable(initial, (name) => {
    const text = textOf(name);

    return text === null ? null : refsOf(text.replace(CHUNK_GROUP, (group) => (refsOf(group).includes(file) ? "" : group)));
  }, file);
  const cardStart = [file, ...groups.filter((list) => list.includes(file)).flat()];
  const files = [...reachable(cardStart, refsIn)].filter((name) => !withoutCard.has(name));
  const sizes = files.map((name) => sizeOf(join(chunksDir, name)));
  const dialogFile = outside.find((name) => textOf(name).includes("loadPopupFreeCard"));
  let dialog = null;

  if (dialogFile) {
    const group = (groups.find((list) => list.includes(dialogFile)) ?? [dialogFile]).filter((name) => textOf(name) !== null);

    dialog = { files: group, gzip: sum(group.map((name) => sizeOf(join(chunksDir, name)).gzip)) };
  }

  return {
    card: { file, files, raw: sum(sizes.map((size) => size.raw)), gzip: sum(sizes.map((size) => size.gzip)) },
    dialog,
    initialGzip: sum(homeInitialFiles(nextDir, manifestText).map((name) => sizeOf(join(nextDir, name)).gzip))
  };
}

function refsOf(text) {
  return [...new Set([...text.matchAll(CHUNK_REF)].map((match) => match[1]))];
}

function groupsOf(text) {
  return [...text.matchAll(CHUNK_GROUP)].map((match) => refsOf(match[1]));
}

/**
 * Os pedacos alcancados a partir de `start`, na ordem em que aparecem, sem entrar em `skip`. `refsIn` da as referencias
 * de um pedaco (null quando o arquivo nao existe, como um pedaco citado que o build nao gerou).
 */
function reachable(start, refsIn, skip) {
  const seen = new Set();
  const queue = [...start];

  while (queue.length) {
    const name = queue.shift();
    const refs = name === skip || seen.has(name) ? null : refsIn(name);

    if (refs === null) {
      continue;
    }

    seen.add(name);
    queue.push(...refs);
  }

  return seen;
}

/** O JS inicial do Inicio pelo docs/29 §7.2: os rootMainFiles com os entryJSFiles do layout e da pagina "/". */
function homeInitialFiles(nextDir, manifestText) {
  const buildManifestPath = join(nextDir, "build-manifest.json");
  const rootMainFiles = existsSync(buildManifestPath) ? (JSON.parse(readFileSync(buildManifestPath, "utf8")).rootMainFiles ?? []) : [];
  const home = manifestText.indexOf('__RSC_MANIFEST["/page"]');
  const start = home === -1 ? -1 : manifestText.indexOf("{", home);
  let entries;

  try {
    entries = JSON.parse(manifestText.slice(start, manifestText.lastIndexOf("}") + 1)).entryJSFiles;
  } catch {
    entries = undefined;
  }

  if (start === -1 || !entries) {
    throw new Error(`O manifesto do Início mudou de formato: não achei os entryJSFiles de "/" em ${HOME_MANIFEST}.`);
  }

  const pageFiles = Object.entries(entries)
    .filter(([key]) => /\/src\/app\/(?:layout|page)$/.test(key))
    .flatMap(([, list]) => list);

  return [...new Set([...rootMainFiles, ...pageFiles])].filter((name) => existsSync(join(nextDir, name)));
}

function sizeOf(path) {
  const bytes = readFileSync(path);

  return { raw: bytes.length, gzip: gzipSync(bytes).length };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function bytes(value) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} B`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const nextDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../.next", import.meta.url)));

  try {
    const { card, dialog, initialGzip } = measureFreeCard(nextDir);
    const extra = card.files.length > 1 ? `, com ${card.files.slice(1).join(", ")}, que só ele baixa` : "";

    console.log(`[livre] pedaço do cartão Livre: ${bytes(card.gzip)} gzip, limite ${bytes(FREE_CARD_LIMIT_BYTES)} (${card.file}${extra}; ${bytes(card.raw)} sem gzip)`);
    console.log(dialog ? `[livre] janela do pop-up (${dialog.files.length} arquivos): ${bytes(dialog.gzip)} gzip` : "[livre] janela do pop-up: não achei o arquivo com loadPopupFreeCard");
    console.log(`[livre] JS inicial do Início: ${bytes(initialGzip)} gzip`);

    if (card.gzip > FREE_CARD_LIMIT_BYTES) {
      console.error(`[livre] O pedaço do cartão Livre passou do limite: ${bytes(card.gzip)} gzip, limite ${bytes(FREE_CARD_LIMIT_BYTES)} (docs/27 §7).`);
      process.exitCode = 1;
    } else {
      console.log(`[livre] folga até o limite: ${bytes(FREE_CARD_LIMIT_BYTES - card.gzip)}`);
    }
  } catch (error) {
    console.error(`[livre] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
