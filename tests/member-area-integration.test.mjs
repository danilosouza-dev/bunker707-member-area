import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Integracao da rodada "Area de membros" (Login, Destaque, Modulos): menu e abas, guarda das telas e
// das Server Actions, vocabulario da tela e as travas que impedem o admin antigo (/admin/legado) de
// apagar o que o admin novo grava. Leitura de codigo, como o resto da suite.

const { adminNavItems } = await import("../src/components/admin/v2/nav.ts");
const { ADMIN_ACTION_ROLES, rolesFor } = await import("../src/server/auth/roles.ts");

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const memberAreaRoutes = join(repoRoot, "src/app/admin/(v2)/area-de-membros");

/** Remove comentarios de bloco e de linha (inclusive no fim da linha), para checar so o codigo. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function listFiles(directory, accept) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listFiles(path, accept);
    }

    return accept(entry) && !entry.startsWith("._") ? [path] : [];
  });
}

/** Corpo de cada funcao exportada: do `export async function X(` ate o proximo export. */
function exportedFunctions(source) {
  const starts = [...source.matchAll(/export async function (\w+)\(/g)];

  return starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    name: match[1]
  }));
}

const membersNav = adminNavItems.find((item) => item.id === "membros");

test("menu e abas da Area de membros tem os mesmos cinco destinos, na mesma ordem", () => {
  const navChildren = membersNav.children.map((child) => [child.label, child.href]);

  assert.deepEqual(navChildren, [
    ["Vitrine", "/admin/area-de-membros"],
    ["Destaque", "/admin/area-de-membros/destaque"],
    ["Módulos", "/admin/area-de-membros/modulos"],
    ["Login", "/admin/area-de-membros/login"],
    ["Marca", "/admin/area-de-membros/marca"]
  ]);

  const tabsSource = read("src/components/admin/v2/storefront/storefront-tabs.tsx");
  const tabs = [...tabsSource.matchAll(/\{ href: "([^"]+)", label: "([^"]+)" \}/g)].map((match) => [match[2], match[1]]);

  assert.deepEqual(tabs, navChildren, "storefront-tabs.tsx segue o menu");

  const layout = read("src/app/admin/(v2)/area-de-membros/layout.tsx");
  assert.match(layout, /a página de entrar, o topo e as fileiras da home, os módulos dos cursos e a logo da escola/);
});

test("toda tela da Area de membros tem guarda, loading e so libera gravacao para quem pode", () => {
  for (const child of membersNav.children) {
    const directory = join(memberAreaRoutes, child.href.replace(/^\/admin\/area-de-membros\/?/, ""));
    const pagePath = join(directory, "page.tsx");

    assert.ok(existsSync(pagePath), `${child.href} precisa de page.tsx`);
    assert.ok(existsSync(join(directory, "loading.tsx")), `${child.href} precisa de loading.tsx`);

    const page = readFileSync(pagePath, "utf8");
    assert.match(page, /const \{ access \} = await requirePageArea\("membros"\);/, `${child.href}: guarda (area do menu) antes de ler dados`);
    assert.match(page, /can\(access, "storefront\.write"\)/, `${child.href}: a tela so edita com storefront.write`);
  }

  // Modulos mistura as duas permissoes: "Como abre" e capa sao do produto (catalog.write).
  assert.match(read("src/app/admin/(v2)/area-de-membros/modulos/page.tsx"), /canWriteCatalog=\{can\(access, "catalog\.write"\)\}/);
});

test("Server Actions da rodada passam por runAdminAction com uma permissao de produtor", () => {
  const files = [
    "src/server/member-area/home-hero-actions.ts",
    "src/server/member-area/image-actions.ts",
    "src/server/member-area/login-actions.ts",
    "src/server/member-area/modules-actions.ts",
    "src/server/catalog/module-cover-actions.ts"
  ];
  const expected = {
    saveHomeHero: "storefront.write",
    saveLoginPage: "storefront.write",
    setHomeModuleRow: "storefront.write",
    setModuleCover: "catalog.content",
    setProductOpensAs: "catalog.write",
    uploadMemberAreaImage: "storefront.write"
  };
  const seen = [];

  for (const path of files) {
    const source = read(path);
    assert.match(source, /^"use server";/, `${path} e arquivo de Server Actions`);
    assert.doesNotMatch(source, /^export (?:const|let|function|default|class)\b/m, `${path}: so exporta funcoes async e tipos`);

    for (const { body, name } of exportedFunctions(source)) {
      const action = /runAdminAction\("([a-z_.]+)"/.exec(body)?.[1];

      assert.ok(action, `${name} precisa de runAdminAction(acao, ...)`);
      assert.ok(Object.hasOwn(ADMIN_ACTION_ROLES, action), `${name}: acao desconhecida ${action}`);
      assert.equal(action, expected[name], `${name} usa ${expected[name]}`);
      // Capa do modulo e conteudo do curso: o Professor tambem pode (so nos cursos dele, conferido por requireScope).
      const producers = action === "catalog.content" ? ["admin", "editor", "instructor", "owner"] : ["admin", "editor", "owner"];
      assert.deepEqual([...rolesFor(action)].sort(), producers, `${name}: analista e suporte so leem`);
      seen.push(name);
    }
  }

  assert.deepEqual(seen.sort(), Object.keys(expected).sort());
});

test("textos de tela da Area de membros nao usam jargao (template, hero, CTA, slug, entitlement, upload)", () => {
  const forbidden = /\b(?:templates?|heros?|ctas?|slugs?|entitlements?|uploads?)\b/i;
  const sources = [
    ...listFiles(join(repoRoot, "src/components/admin/v2/member-area"), (name) => name.endsWith(".tsx")),
    ...listFiles(memberAreaRoutes, (name) => name.endsWith(".tsx")),
    join(repoRoot, "src/components/admin/v2/content/module-cover-sheet.tsx"),
    join(repoRoot, "src/components/admin/v2/storefront/brand-editor.tsx"),
    join(repoRoot, "src/components/admin/v2/storefront/vitrine-editor.tsx"),
    join(repoRoot, "src/components/admin/v2/storefront/section-sheet.tsx")
  ];

  assert.ok(sources.length >= 20, `arquivos de tela encontrados: ${sources.length}`);

  for (const path of sources) {
    const code = stripComments(readFileSync(path, "utf8"));
    // Texto de tela: conteudo JSX entre tags e frases em string (rotulos, avisos, toasts). Uma frase
    // tem acento ou comeca com maiuscula; classes do Tailwind e nomes de campo nunca.
    const jsxText = [...code.matchAll(/>([^<>{};=]*[A-Za-zÀ-ú][^<>{};=]*)</g)].map((match) => match[1]);
    const phrases = [...code.matchAll(/"([^"\n]+)"|`([^`\n]+)`/g)]
      .map((match) => match[1] ?? match[2])
      .filter((value) => /[À-ú]/.test(value) || /^[A-ZÀ-Ú][a-zà-ú]/.test(value));

    for (const text of [...jsxText, ...phrases]) {
      assert.doesNotMatch(text, forbidden, `${path.replace(repoRoot, "")}: "${text.trim()}"`);
    }
  }
});

