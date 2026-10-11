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
const { MEMBER_AREA_SETTING_KEYS } = await import("../src/server/member-area/schemas.ts");

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
    assert.match(page, /const \{ role \} = await requirePageAdmin\(\);/, `${child.href}: guarda antes de ler dados`);
    assert.match(page, /canRole\(role, "storefront\.write"\)/, `${child.href}: a tela so edita com storefront.write`);
  }

  // Modulos mistura as duas permissoes: "Como abre" e capa sao do produto (catalog.write).
  assert.match(read("src/app/admin/(v2)/area-de-membros/modulos/page.tsx"), /canWriteCatalog=\{canRole\(role, "catalog\.write"\)\}/);
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
    setModuleCover: "catalog.write",
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
      assert.deepEqual([...rolesFor(action)].sort(), ["admin", "editor", "owner"], `${name}: analista e suporte so leem`);
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

test("admin antigo grava platform_settings chave por chave e nunca toca em loginPage", () => {
  const store = read("src/server/db/platform-store.ts");
  const settingsRows = /function settingsRows\(database: PlatformDatabase\) \{[\s\S]*?\n\}/.exec(store)?.[0];

  assert.ok(settingsRows, "settingsRows existe");
  assert.doesNotMatch(settingsRows, /loginPage/, "a lista de chaves do legado nao inclui loginPage");
  assert.ok(MEMBER_AREA_SETTING_KEYS.includes("loginPage"));

  // Toda gravacao do legado em platform_settings escolhe as chaves e carimba updated_at.
  const settingsWrites = [...store.matchAll(/upsertRows\(\s*[^,]+,\s*"platform_settings"/g)];
  assert.ok(settingsWrites.length >= 3, `gravacoes encontradas: ${settingsWrites.length}`);
  for (const write of settingsWrites) {
    const functionStart = store.lastIndexOf("\nexport async function ", write.index);
    const callEnd = store.indexOf("\n  );", write.index);
    const body = store.slice(functionStart, callEnd);
    const name = /function (\w+)/.exec(body)?.[1];

    assert.match(body, /stampPlatformSettingRows\(/, `${name}: gravacao sem carimbo de versao`);
  }
  for (const use of store.matchAll(/settingsRows\(database\)([^\n]*)/g)) {
    assert.match(use[1], /^\.filter\(/, "o snapshot inteiro de configuracoes nunca e regravado");
  }
  assert.match(store, /const rows = stampPlatformSettingRows\(settingsRows\(database\)\.filter\(\(row\) => updatedKeys\.has\(row\.key\)\)\);/);
});

test("admin antigo preserva o botao e a capa do destaque e as chaves desconhecidas de content_page_settings", () => {
  const store = read("src/server/db/platform-store.ts");

  // O hero e lido cru (sem normalizar) e a aparencia do legado so troca enabled/image/mediaType.
  assert.match(store, /hero: \(settingsMap\.get\("hero"\) as HomeHeroConfig \| undefined\) \?\? defaultHero,/);
  const appearance = /export async function updatePlatformAppearance[\s\S]*?\n\}/.exec(store)?.[0] ?? "";
  const applyHero = /function applyAppearanceToHero[\s\S]*?\n\}/.exec(store)?.[0] ?? "";
  assert.equal(applyHero.match(/\.\.\.current,/g)?.length, 2, "ligar e desligar o destaque espalham o hero gravado agora");

  // Envia a imagem primeiro (leva segundos) e so depois rele o destaque e grava com a versao lida: o
  // que a tela Destaque publicar nesse meio-tempo nao some (updatePlatformSettingLatest tenta de novo
  // uma vez e, se mudar de novo, responde 409).
  const upload = appearance.indexOf('persistAppearanceImage(providedImage, "platform/home-hero"');
  const write = appearance.indexOf('updatePlatformSettingLatest("hero"');
  assert.ok(upload > 0 && write > upload, "envio da imagem antes de reler e gravar o destaque");
  assert.match(appearance, /applyAppearanceToHero\(current\.exists \? current\.value : null,/);
  assert.doesNotMatch(appearance, /database\.hero = \{/, "nada de gravar o destaque lido no inicio");
  assert.doesNotMatch(appearance, /wantedKeys[\s\S]*"hero"/, "o destaque nao vai junto no upsert sem versao");

  // O salvar do curso no legado relê a linha do banco e espalha o que ja existia antes de mudar a chave.
  assert.match(store, /\(\(contentSettingsResult\.data \?\? \[\]\) as Array<\{ content_id: string; settings: ContentPageSettings \}>\)\.map\(\(setting\) => \[\s*setting\.content_id,\s*setting\.settings\s*\]\)/);
  assert.ok((store.match(/\.\.\.currentSettings,/g)?.length ?? 0) >= 5, "cada chave do legado espalha currentSettings");
  assert.match(store, /await upsertRows\(supabase, "content_page_settings", \[\{\s*content_id: item\.id,\s*settings: itemSettings\s*\}\]/);
});

test("Vitrine do admin antigo manda a versao das fileiras e recebe 409 em vez de apagar", () => {
  const store = read("src/server/db/platform-store.ts");
  const editor = read("src/components/admin/personalization/home-showcase-editor.tsx");
  const dashboard = read("src/components/admin-dashboard.tsx");
  const route = read("src/app/api/admin/home-sections/route.ts");

  assert.match(store, /const homeSectionsUpdatedAt = settingsRowsRead\.find\(\(setting\) => setting\.key === "homeSections"\)\?\.updated_at \?\? null;/);
  assert.match(store, /homeSectionsUpdatedAt: database\.homeSectionsUpdatedAt,/);

  // Com versao, a gravacao das fileiras e condicional no proprio UPDATE (sem janela entre conferir e
  // gravar) e a versao devolvida e a desta gravacao.
  const publish = /export async function publishHomeSections[\s\S]*?\n\}/.exec(store)?.[0] ?? "";
  assert.match(publish, /if \(options\.expectedUpdatedAt !== undefined\) \{\s*sectionsUpdatedAt = \(await writePlatformSettingGuarded\("homeSections", normalized, options\.expectedUpdatedAt, now\)\)\.updatedAt;/);
  assert.match(publish, /database\.homeSectionsUpdatedAt = sectionsUpdatedAt;/);
  assert.doesNotMatch(publish, /\{ key: "homeSections", value: normalized \},\s*\{ key: "updatedAt"/, "fileiras nunca no mesmo upsert sem condicao");

  assert.match(dashboard, /homeSectionsUpdatedAt=\{dashboardData\.homeSectionsUpdatedAt\}/);
  assert.match(dashboard, /homeSectionsUpdatedAt=\{homeSectionsUpdatedAt\}/);

  // A versao e lida junto com o rascunho (montagem do editor) e so muda depois de publicar.
  assert.match(editor, /const \[publishedVersion, setPublishedVersion\] = useState\(homeSectionsUpdatedAt\);/);
  assert.match(editor, /\.\.\.\(publishedVersion !== undefined \? \{ expectedUpdatedAt: publishedVersion \} : \{\}\)/);
  assert.match(editor, /setPublishedVersion\(payload\.sectionsUpdatedAt \?\? payload\.data\.homeSectionsUpdatedAt \?\? publishedVersion\);/);

  assert.match(route, /await publishHomeSections\(payload\.sections, \{ expectedUpdatedAt \}\)/, "a versao vai para a gravacao condicional");
  assert.match(route, /sectionsUpdatedAt: data\.homeSectionsUpdatedAt \?\? null/, "devolve a versao desta gravacao");
  assert.doesNotMatch(route, /readPlatformSetting|assertPlatformSettingVersion/, "nada de conferir antes e reler depois");
});

test("editor de modulo do admin antigo so manda a capa quando o produtor mudou", () => {
  const dashboard = read("src/components/admin-dashboard.tsx");

  assert.match(dashboard, /initialImage: module\.image \?\? "",/);
  assert.match(dashboard, /return form\.image !== \(form\.initialImage \?\? ""\) \? form\.image : undefined;/);
  assert.match(dashboard, /id: editingModuleId,\s*image: changedModuleImage\(moduleBuilderForm\),/);
});
