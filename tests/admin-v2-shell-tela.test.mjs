import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// A moldura do admin desenhada (docs/17 §1.4; docs/31 V2-13; docs/18 §1.1): o HTML do servidor do AdminShellV2 pelo
// caminho da tela. Nas telas comuns, a barra lateral ("Menu do admin", com as "Áreas do admin") e a barra superior
// (a busca); no console da sessao de um webinario (isAdminFullScreenPath), a tela cheia: sem a barra lateral, sem a
// gaveta, sem a barra superior e sem os avisos da moldura (o console monta os dele), com a mesma raiz data-scope="admin",
// o link de pular e o #admin-main. tests/admin-v2-shell.test.mjs le so os fontes; este desenha.
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS), como em tests/webinarios-console-tela.test.mjs.
// next/navigation le o caminho de globalThis.__adminPath; next/link e next/dynamic viram stubs; a busca (Server Action)
// vira uma funcao falsa.

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const STUBS = {
  "next/navigation": `export function useRouter() { return { back() {}, prefetch() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return globalThis.__adminPath; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(href) { throw new Error("redirect " + href); }
export function notFound() { throw new Error("notFound"); }`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
  "next/dynamic": `export default function dynamic() { return function Dynamic() { return null; }; }`,
  "@/server/admin/search-actions": `export const searchAdmin = async () => ({ error: "Falhou.", ok: false, status: 500 });`
};

function withExtension(base) {
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    const parent = context.parentURL ?? "";

    if (specifier.startsWith("@/")) {
      const found = withExtension(new URL(specifier.slice(2), srcUrl).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith(srcUrl) && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const found = withExtension(new URL(specifier, parent).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: new URL("package.json", root).href });
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(srcUrl) && url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName
      });

      return { format: "module", shortCircuit: true, source: outputText };
    }

    return nextLoad(url, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AdminShellV2 } = await import("../src/components/admin/v2/admin-shell.tsx");
const { ADMIN_ACTIONS } = await import("../src/server/auth/roles.ts");

const access = { actions: [...ADMIN_ACTIONS], courseIds: [], functions: [], role: "owner", scopedActions: [] };
const account = { email: "produtor@escola.test", name: "Produtor T.", roleLabel: "Dono" };
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;

function shellAt(pathname) {
  globalThis.__adminPath = pathname;
  return renderToStaticMarkup(createElement(AdminShellV2, { access, account }, createElement("p", { "data-tela": "" }, "Conteúdo da tela")));
}

/** A moldura de sempre: a barra lateral com as areas e a barra superior com a busca, em volta do #admin-main. */
function assertMolduraInteira(markup, pathname) {
  assert.match(markup, /<aside aria-label="Menu do admin"/, `${pathname}: a barra lateral`);
  assert.match(markup, /<nav aria-label="Áreas do admin"/, `${pathname}: as areas do admin`);
  assert.match(markup, /<header[^>]*>/, `${pathname}: a barra superior`);
  assert.match(markup, /role="combobox"/, `${pathname}: a busca da barra superior`);
}

test("a moldura de sempre nas telas do admin: a barra lateral e a barra superior em volta do conteudo", () => {
  for (const pathname of ["/admin/comunicacao/webinarios/abc", "/admin/comunicacao/webinarios", "/admin"]) {
    const markup = shellAt(pathname);
    assertMolduraInteira(markup, pathname);
    assert.match(markup, /<main[^>]*id="admin-main"[^>]*><p data-tela="">Conteúdo da tela<\/p><\/main>/, `${pathname}: o conteudo no #admin-main`);
    assert.equal(count(markup, /data-scope="admin"/g), 1, `${pathname}: uma raiz so`);
  }
});

test("o console da sessao em tela cheia (docs/31 V2-13): sem a barra lateral, sem a barra superior e sem o recuo; a mesma raiz, o link de pular e o #admin-main", () => {
  for (const pathname of ["/admin/comunicacao/webinarios/abc/sala", "/admin/comunicacao/webinarios/abc/sala/"]) {
    const markup = shellAt(pathname);
    assert.doesNotMatch(markup, /aria-label="Menu do admin"/, `${pathname}: sem a barra lateral nem a gaveta`);
    assert.doesNotMatch(markup, /aria-label="Áreas do admin"/, `${pathname}: sem as areas do admin`);
    assert.doesNotMatch(markup, /<header/, `${pathname}: sem a barra superior`);
    assert.doesNotMatch(markup, /role="combobox"/, `${pathname}: sem a busca`);
    assert.doesNotMatch(markup, /md:pl-60|md:pl-16/, `${pathname}: sem o recuo da barra lateral`);
    assert.doesNotMatch(markup, /aria-label="Notifications/, `${pathname}: sem os avisos da moldura (o console monta os dele)`);
    assert.equal(count(markup, /data-scope="admin"/g), 1, `${pathname}: a mesma raiz, uma vez`);
    assert.match(markup, /^<div[^>]*data-scope="admin"[^>]*><a[^>]*href="#admin-main"[^>]*>Pular para o conteúdo<\/a><main[^>]*id="admin-main"/, `${pathname}: a raiz, o link de pular e o #admin-main, nada entre eles`);
    assert.match(markup, /<main[^>]*id="admin-main"[^>]*tabindex="-1"[^>]*><p data-tela="">Conteúdo da tela<\/p><\/main>/);
  }
  // A moldura comum monta os avisos; a tela cheia nao (o console os monta na raiz dele, no tema).
  assert.match(shellAt("/admin/comunicacao/webinarios/abc"), /aria-label="Notifications/);
});
