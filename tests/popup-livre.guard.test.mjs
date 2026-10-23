import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda do design Livre do lado do aluno (docs/27; spec §6 e §7.1; docs/18 §1.2): regras de seguranca e de
// desempenho que se leem no codigo. O comportamento (desenho, nome do dialogo, url() so da origem conferida,
// video so com movimento) esta em popup-livre-desenho.test.mjs e no ponta a ponta do aluno.
// - texto e estilo so pelo React: nada de dangerouslySetInnerHTML, innerHTML, cssText, <style> ou style em texto;
// - o pedaco do cartao Livre (popup-free-load.ts) nao alcanca zod, popup-free-model.ts em tempo de execucao, o
//   schema, os modelos nem as dicas; a janela do pop-up e o host so chegam a ele por import();
// - o url( do cartao sai de uma funcao so, que monta pelo freeAssetUrl;
// - o editor Livre (admin) nunca e importado pelo lado do aluno;
// - o Livre nao trouxe migracao: as que existem nao mudaram e nenhuma outra mexe no popup_design.

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root);
const FREE_DIR = new URL("src/components/member/notifications/popup-free/", root);
const MEMBER_NOTIFICATIONS = new URL("src/components/member/notifications/", root);

const read = (url) => readFileSync(url, "utf8");
const filesIn = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => new URL(`${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`, "file://"));

/** Sem comentarios: o que sobra e o codigo (os comentarios explicam as regras com as palavras proibidas). */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function resolveImport(specifier, from) {
  let base;

  if (specifier.startsWith("@/")) {
    base = new URL(specifier.slice(2), srcUrl);
  } else if (/^\.{1,2}\//.test(specifier)) {
    base = new URL(specifier, from);
  } else {
    return { external: specifier };
  }

  for (const candidate of [base.href, `${base.href}.ts`, `${base.href}.tsx`, `${base.href}/index.ts`, `${base.href}/index.tsx`]) {
    const url = new URL(candidate);

    if (/\.(?:ts|tsx)$/.test(url.pathname) && existsSync(fileURLToPath(url))) {
      return { file: url.href };
    }
  }

  return { missing: base.href };
}

/**
 * Os imports que viram codigo (sem `import type`, `export type` e imports so de tipos), separados em estaticos
 * e dinamicos (import()).
 */
function importsOf(source) {
  const code = codeOf(source);
  const statics = [];
  const dynamics = [];

  for (const match of code.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const [, , typeOnly, clause, specifier] = match;

    if (typeOnly) {
      continue;
    }

    const named = /\{([^}]*)\}/.exec(clause);
    const hasDefaultOrNamespace = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim().length > 0;
    const allTypes = named && !hasDefaultOrNamespace && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));

    if (!allTypes) {
      statics.push(specifier);
    }
  }

  for (const match of code.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    statics.push(match[1]);
  }

  for (const match of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    dynamics.push(match[1]);
  }

  return { dynamics, statics };
}

/** Tudo o que um arquivo puxa em tempo de execucao (so imports estaticos; os import() param a caminhada). */
function staticGraph(entry) {
  const seen = new Set();
  const external = new Set();
  const stack = [entry.href];

  while (stack.length > 0) {
    const file = stack.pop();

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const specifier of importsOf(read(new URL(file))).statics) {
      const resolved = resolveImport(specifier, file);

      if (resolved.file) {
        stack.push(resolved.file);
      } else if (resolved.external) {
        external.add(resolved.external);
      }
    }
  }

  return { external, files: [...seen].map((file) => file.slice(root.href.length)) };
}

const FREE_FILES = filesIn(FREE_DIR);
const STUDENT_ENTRIES = ["member-popup.tsx", "member-popup-dialog.tsx", "member-popup-host.tsx"].map((name) => new URL(name, MEMBER_NOTIFICATIONS));

test("cartão Livre, member-popup e diálogo sem dangerouslySetInnerHTML, innerHTML, cssText, <style> nem style em texto", () => {
  assert.deepEqual(
    FREE_FILES.map((url) => url.pathname.split("/").pop()).sort(),
    ["popup-free-card.tsx", "popup-free-icons.tsx", "popup-free-load.ts", "popup-free-media.tsx", "popup-free-nodes.tsx", "popup-free-styles.ts"],
    "os arquivos do cartao Livre (spec §3.1)"
  );

  for (const file of [...FREE_FILES, ...STUDENT_ENTRIES]) {
    const code = codeOf(read(file));

    assert.doesNotMatch(code, /dangerouslySetInnerHTML/, file.pathname);
    assert.doesNotMatch(code, /\.(?:inner|outer)HTML\b|insertAdjacentHTML/, file.pathname);
    assert.doesNotMatch(code, /cssText|insertRule|<style[\s>]|createElement\(["']style["']\)/, `${file.pathname}: estilo so por objeto do React`);
    assert.doesNotMatch(code, /\bstyle=(?:["'`]|\{\s*["'`])/, `${file.pathname}: nada de style em texto`);
    assert.doesNotMatch(code, /setAttribute\(\s*["']style["']/, file.pathname);
  }
});

test("o cartão Livre não importa zod, popup-free-model, modelos nem dicas", () => {
  const graph = staticGraph(new URL("popup-free-card.tsx", FREE_DIR));
  const forbidden = /popup-free-model\.ts$|popup-free-schema\.ts$|popup-free-starters\.ts$|popup-free-checks\.ts$|popup-design-schema\.ts$|communications\/schemas\.ts$|\/admin\//;

  assert.ok(graph.files.some((file) => file.endsWith("popup-free-render.ts")), "o cartao usa popup-free-render.ts");
  assert.deepEqual(graph.files.filter((file) => forbidden.test(file)), [], "so tipos de popup-free-model.ts (import type)");

  // O que o pedaco do cartao Livre traz de novo (o resto ja esta na janela do pop-up, que o carrega): nada de zod.
  // (A janela ja tem o zod do sino por notifications-model -> interactions-model; o Livre nao acrescenta.)
  const dialog = new Set(staticGraph(new URL("member-popup-dialog.tsx", MEMBER_NOTIFICATIONS)).files);
  const added = graph.files.filter((file) => !dialog.has(file));

  assert.ok(added.length > 0 && added.every((file) => /popup-free\/|popup-free-render\.ts$/.test(file)), `o pedaco traz so o cartao e popup-free-render.ts: ${added.join(", ")}`);

  for (const file of added) {
    assert.equal(importsOf(read(new URL(file, root))).statics.some((specifier) => specifier === "zod" || specifier.startsWith("zod/")), false, `${file}: zod nunca no pedaco do aluno`);
  }

  // O modulo de estilos importa so popup-free-render.ts e popup-design-model.ts em tempo de execucao.
  const stylesImports = importsOf(read(new URL("popup-free-styles.ts", FREE_DIR))).statics;
  assert.deepEqual(stylesImports.sort(), ["../../../../server/communications/popup-design-model", "../../../../server/communications/popup-free-render"]);

  // popup-free-render.ts tambem nao puxa o modelo, o schema nem zod.
  const renderGraph = staticGraph(new URL("src/server/communications/popup-free-render.ts", root));
  assert.deepEqual(renderGraph.files.filter((file) => forbidden.test(file)), []);
  assert.equal(renderGraph.external.has("zod"), false);
});

test("member-popup e o diálogo só chegam ao cartão Livre por import() (popup-free-load)", () => {
  const cardFiles = /popup-free\/popup-free-(?:card|nodes|media|styles|icons)\.tsx?$/;

  for (const entry of STUDENT_ENTRIES) {
    const graph = staticGraph(entry);

    assert.deepEqual(graph.files.filter((file) => cardFiles.test(file)), [], `${entry.pathname}: o cartao Livre fica no pedaco proprio`);
    assert.deepEqual(graph.files.filter((file) => /popup-free-(?:model|schema|starters|checks)\.ts$/.test(file)), [], entry.pathname);
  }

  const load = read(new URL("popup-free-load.ts", FREE_DIR));
  assert.deepEqual(importsOf(load), { dynamics: ["./popup-free-card"], statics: [] }, "a unica porta do pedaco");

  // A janela fica leve: nem popup-free-render.ts entra nela (a aria do Livre vem do pedaco ja baixado).
  const dialogFiles = staticGraph(new URL("member-popup-dialog.tsx", MEMBER_NOTIFICATIONS)).files;
  assert.equal(dialogFiles.some((file) => file.endsWith("popup-free-render.ts")), false, "popup-free-render.ts so no pedaco do cartao Livre");
  const hostFiles = staticGraph(new URL("member-popup-host.tsx", MEMBER_NOTIFICATIONS)).files;
  assert.equal(hostFiles.some((file) => file.includes("popup-free")), false, "o host (JS inicial) chega ao Livre so pela janela, por import()");

  const member = codeOf(read(new URL("member-popup.tsx", MEMBER_NOTIFICATIONS)));
  assert.match(member, /const PopupFreeCard = lazy\(loadPopupFreeCard\);/);
  assert.match(codeOf(read(new URL("popup-free-card.tsx", FREE_DIR))), /export default PopupFreeCard;/, "o pedaco exporta o cartao como padrao para o lazy");
  assert.match(member, /<Suspense fallback=\{null\}>/, "nada no lugar enquanto o pedaco nao chega");

  // Ninguem alem de popup-free-load.ts faz import() do cartao.
  for (const file of filesIn(srcUrl)) {
    if (file.href === new URL("popup-free-load.ts", FREE_DIR).href) {
      continue;
    }

    assert.doesNotMatch(codeOf(read(file)), /import\(\s*["'][^"']*popup-free-card["']\s*\)/, file.pathname);
  }
});

test("url( só sai da função que monta pelo freeAssetUrl", () => {
  for (const file of [...FREE_FILES, ...STUDENT_ENTRIES]) {
    const code = codeOf(read(file));
    const count = (code.match(/url\(/g) ?? []).length;

    if (!file.pathname.endsWith("popup-free-styles.ts")) {
      assert.equal(count, 0, `${file.pathname}: url( so em popup-free-styles.ts`);
      continue;
    }

    assert.equal(count, 1, "um url( so");

    const fn = /function freeImageLayerUrl\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(fn, "a funcao que monta o url(");
    assert.match(fn[1], /url\(/, "o url( esta dentro dela");
    assert.match(fn[1], /freeAssetSrc\(ctx, id, "image"\)/);

    const src = /export function freeAssetSrc\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(src);
    assert.match(src[1], /freeAssetUrl\(asset, ctx\.origin\)/, "o endereco sai de freeAssetUrl (origem conferida + caminho do padrao)");
    assert.match(src[1], /SAFE_ASSET_URL\.test\(url\)/, "e e conferido de novo");
  }

  // A origem e lida uma vez, da mesma variavel do Supabase no navegador, e conferida.
  const cardCode = codeOf(read(new URL("popup-free-card.tsx", FREE_DIR)));
  assert.match(cardCode, /const STORAGE_ORIGIN = freeStorageOrigin\(process\.env\.NEXT_PUBLIC_SUPABASE_URL\);/);
});

test("o editor Livre não é importado pelo lado do aluno", () => {
  for (const file of filesIn(new URL("src/components/member/", root))) {
    const code = codeOf(read(file));

    assert.doesNotMatch(code, /admin\/v2\/communication\//, file.pathname);
    assert.doesNotMatch(code, /popup-free-(?:starters|checks|schema)/, file.pathname);
  }

  for (const entry of [...STUDENT_ENTRIES, new URL("popup-free-card.tsx", FREE_DIR)]) {
    assert.deepEqual(staticGraph(entry).files.filter((file) => file.includes("components/admin/")), [], entry.pathname);
  }

  // E o lado do aluno nunca chega ao editor por import() (o editor Livre fica so no admin).
  for (const file of filesIn(new URL("src/components/member/", root))) {
    assert.equal(importsOf(read(file)).dynamics.some((specifier) => specifier.includes("admin")), false, file.pathname);
  }
});

test("nenhuma migração nova nem mudança nas já aplicadas", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const before = files.filter((name) => name <= "202610230001_communication_popup_design.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  // As 49 migracoes ate a do Design do pop-up (base do Livre), byte a byte.
  assert.equal(before.length, 49);
  assert.equal(hash.digest("hex"), "844db07c3ef75fd7980b3663aad0d2ac18317d7d5b2ae603f1ca9e922757e445", "uma migracao ja aplicada mudou");

  // O Livre cabe na coluna e no check de hoje: nenhuma migracao depois da 202610230001 mexe no popup_design.
  for (const name of files.filter((file) => file > "202610230001_communication_popup_design.sql")) {
    assert.doesNotMatch(read(new URL(name, dir)), /popup_design/, `${name}: o Livre nao precisa de migracao (spec §2.8)`);
  }
});
