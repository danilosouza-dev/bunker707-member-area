import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as adminFilters from "../src/components/admin/v2/filters.ts";
import {
  EMPTY_VALUE,
  formatAdminRole,
  formatDelta,
  formatDeltaMagnitude,
  formatKpiValue,
  formatLongDate,
  getGreeting,
  getInitials
} from "../src/components/admin/v2/format.ts";
import {
  ADMIN_LEGACY_HREF,
  adminNavItems,
  buildAdminNavHref,
  formatAdminNavCount,
  getActiveAdminNavChild,
  getAdminLegacyAvailability,
  getAdminMobileTitle,
  getAdminTopbarScope,
  isAdminLegacyPath,
  isAdminNavChildActive,
  isAdminNavSectionActive,
  isAdminV2Href
} from "../src/components/admin/v2/nav.ts";

// Os tres modulos acima sao puros (sem React) para que este teste os carregue direto pelo Node.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const v2RouteDir = join(repoRoot, "src/app/admin/(v2)");
const v2ComponentDir = join(repoRoot, "src/components/admin/v2");
const adminLoadingPath = join(repoRoot, "src/app/admin/loading.tsx");

async function listFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("._"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function readSources(paths) {
  return Promise.all(paths.map(async (path) => ({ path: relative(repoRoot, path), source: await readFile(path, "utf8") })));
}

const v2RouteFiles = await listFiles(v2RouteDir);
const v2ComponentFiles = await listFiles(v2ComponentDir);
const v2Sources = await readSources([...v2RouteFiles, ...v2ComponentFiles, adminLoadingPath]);
const sourceOf = (path) => {
  const entry = v2Sources.find((item) => item.path === path);
  assert.ok(entry, `arquivo esperado: ${path}`);
  return entry.source;
};
const globalsCss = await readFile(join(repoRoot, "src/app/globals.css"), "utf8");

/** Remove comentarios de bloco e de linha inteira, para checar so o que vira interface. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const { buildAdminProductFilterHref, parseAdminProduct } = adminFilters;

test("o periodo tem um modelo so (period.ts): o filtro antigo 7 · 30 · 90 saiu de filters.ts", () => {
  // Rodada "Layout do prototipo" (11/10/2026): Hoje, 1d, 3d, 7d, 30d e o calendario, em period.ts
  // (tests/admin-period.test.mjs). Os links antigos ?periodo=7|30|90 continuam valendo por la.
  for (const name of ["ADMIN_PERIOD_OPTIONS", "DEFAULT_ADMIN_PERIOD", "parseAdminPeriod", "describeAdminPeriod", "describePreviousPeriod"]) {
    assert.equal(name in adminFilters, false, `filters.ts nao exporta mais ${name}`);
  }

  assert.equal(adminFilters.ADMIN_PERIOD_PARAM, "periodo");
  assert.equal(adminFilters.ADMIN_PRODUCT_PARAM, "produto");

  for (const { path, source } of v2Sources) {
    assert.doesNotMatch(
      stripComments(source),
      /\b(parseAdminPeriod|describeAdminPeriod|describePreviousPeriod|ADMIN_PERIOD_OPTIONS)\b/,
      `${path} usa o modelo de periodo de period.ts`
    );
  }
});

test("parseAdminProduct aceita so identificadores simples", () => {
  assert.equal(parseAdminProduct("abc_1"), "abc_1");
  assert.equal(parseAdminProduct(["  curso-ia-2026  "]), "curso-ia-2026");
  assert.equal(parseAdminProduct("a".repeat(80)), "a".repeat(80));

  for (const invalid of ["<script>", "<script>alert(1)</script>", "../segredo", "produto 1", "a".repeat(81), "", "   ", null, undefined, []]) {
    assert.equal(parseAdminProduct(invalid), null, `produto invalido: ${JSON.stringify(invalid)}`);
  }
});

test("barra superior mostra so os filtros que a tela usa (prototipo aprovado)", () => {
  const both = { period: true, product: true };
  const periodOnly = { period: true, product: false };
  const none = { period: false, product: false };

  assert.deepEqual(getAdminTopbarScope("/admin"), both, "Hoje: Periodo e Produto");
  assert.deepEqual(getAdminTopbarScope("/admin/?periodo=7d"), both);
  assert.deepEqual(getAdminTopbarScope("/admin/produtos/curso-ia/desempenho"), periodOnly, "Desempenho do produto");
  assert.deepEqual(getAdminTopbarScope("/admin/comunicacao"), periodOnly);
  assert.deepEqual(getAdminTopbarScope("/admin/comunicacao/avisos?periodo=hoje"), periodOnly);
  assert.deepEqual(getAdminTopbarScope("/admin/comunicacao/webinarios"), periodOnly);
  assert.deepEqual(getAdminTopbarScope("/admin/comunicacao/promocoes"), periodOnly);
  assert.deepEqual(getAdminTopbarScope("/admin/configuracoes/ia/consumo"), periodOnly, "Consumo do Tutor IA");

  for (const path of [
    "/admin/alunos",
    "/admin/produtos",
    "/admin/produtos/novo",
    "/admin/produtos/importar",
    "/admin/produtos/pacotes",
    "/admin/produtos/curso-ia",
    "/admin/produtos/curso-ia/detalhes",
    "/admin/produtos/curso-ia/alunos",
    "/admin/produtos/a/b/desempenho",
    "/admin/comunidade",
    "/admin/comunidade/denuncias",
    "/admin/comunicacao/avisos/novo",
    "/admin/area-de-membros",
    "/admin/area-de-membros/modulos",
    "/admin/configuracoes",
    "/admin/configuracoes/ia",
    "/admin/configuracoes/ia/conexoes",
    "/admin/legado",
    null,
    undefined
  ]) {
    assert.deepEqual(getAdminTopbarScope(path), none, String(path));
  }
});

test("titulo da barra do celular: area ou tela interna", () => {
  assert.equal(getAdminMobileTitle("/admin"), "Visão geral");
  assert.equal(getAdminMobileTitle("/admin/alunos?busca=ana"), "Alunos");
  assert.equal(getAdminMobileTitle("/admin/produtos"), "Produtos");
  assert.equal(getAdminMobileTitle("/admin/produtos/curso-ia/detalhes"), "Produtos", "a pagina troca pelo nome do produto");
  assert.equal(getAdminMobileTitle("/admin/produtos/novo"), "Novo produto");
  assert.equal(getAdminMobileTitle("/admin/produtos/importar"), "Importar");
  assert.equal(getAdminMobileTitle("/admin/produtos/pacotes"), "Pacotes");
  assert.equal(getAdminMobileTitle("/admin/area-de-membros/marca"), "Área de membros");
  assert.equal(getAdminMobileTitle("/admin/home"), "Área de membros");
  assert.equal(getAdminMobileTitle("/admin/comunicacao/webinarios"), "Comunicação");
  assert.equal(getAdminMobileTitle("/admin/comunidade/denuncias"), "Comunidade");
  assert.equal(getAdminMobileTitle("/admin/configuracoes"), "Configurações");
  assert.equal(getAdminMobileTitle("/admin/configuracoes/ia/consumo"), "Tutor IA");
  assert.equal(getAdminMobileTitle("/admin/desconhecida"), "Bunker707");
  assert.equal(getAdminMobileTitle(null), "Bunker707");
});

test("links do menu levam o periodo so para as telas que usam o Periodo da barra", () => {
  assert.equal(buildAdminNavHref("/admin", "7d"), "/admin?periodo=7d");
  assert.equal(buildAdminNavHref("/admin", "2026-10-01..2026-10-10"), "/admin?periodo=2026-10-01..2026-10-10");
  assert.equal(buildAdminNavHref("/admin/comunicacao/avisos", "hoje"), "/admin/comunicacao/avisos?periodo=hoje");
  assert.equal(buildAdminNavHref("/admin/produtos", "7d"), "/admin/produtos", "Produtos nao usa o Periodo");
  assert.equal(buildAdminNavHref("/admin/comunidade", "7d"), "/admin/comunidade", "Comunidade tem o filtro na pagina");
  assert.equal(buildAdminNavHref("/admin/configuracoes/ia", "7d"), "/admin/configuracoes/ia");
  assert.equal(buildAdminNavHref("/admin", null), "/admin");
  assert.equal(buildAdminNavHref("/admin", "  "), "/admin");
  assert.equal(buildAdminNavHref("/admin", "<script>"), "/admin", "valor estranho nao e repassado");
  assert.equal(buildAdminNavHref("/admin", "7d&produto=x"), "/admin");
});

test("filtro Produto: endereco com outro produto, sem pagina e com os outros filtros", () => {
  assert.equal(buildAdminProductFilterHref("/admin", "periodo=7d&pagina=3", "curso-ia"), "/admin?periodo=7d&produto=curso-ia");
  assert.equal(buildAdminProductFilterHref("/admin", "periodo=7d&produto=curso-ia", null), "/admin?periodo=7d");
  assert.equal(buildAdminProductFilterHref("/admin", new URLSearchParams("produto=a"), "b"), "/admin?produto=b");
  assert.equal(buildAdminProductFilterHref("/admin", "", "../segredo"), "/admin", "id invalido vira todos");
  assert.equal(buildAdminProductFilterHref("/admin", "", null), "/admin");
});

test("menu tem sete areas, na ordem do mapa, e so a area certa fica ativa", () => {
  assert.deepEqual(
    adminNavItems.map((item) => item.id),
    ["hoje", "alunos", "produtos", "membros", "comunicacao", "comunidade", "configuracoes"]
  );
  assert.deepEqual(
    adminNavItems.map((item) => item.label),
    ["Visão geral", "Alunos", "Produtos", "Área de membros", "Comunicação", "Comunidade", "Configurações"]
  );

  const childrenOf = (id) => adminNavItems.find((item) => item.id === id).children.map((child) => [child.label, child.href]);

  assert.deepEqual(childrenOf("produtos"), [
    ["Todos os produtos", "/admin/produtos"],
    ["Pacotes", "/admin/produtos/pacotes"],
    ["Importar", "/admin/produtos/importar"]
  ]);
  assert.deepEqual(childrenOf("membros"), [
    ["Vitrine", "/admin/area-de-membros"],
    ["Destaque", "/admin/area-de-membros/destaque"],
    ["Módulos", "/admin/area-de-membros/modulos"],
    ["Login", "/admin/area-de-membros/login"],
    ["Marca", "/admin/area-de-membros/marca"]
  ]);
  assert.deepEqual(childrenOf("configuracoes"), [
    ["Todas as configurações", "/admin/configuracoes"],
    ["Tutor IA", "/admin/configuracoes/ia"]
  ]);

  const active = (pathname) => adminNavItems.filter((item) => isAdminNavSectionActive(pathname, item)).map((item) => item.id);

  assert.deepEqual(active("/admin"), ["hoje"]);
  assert.deepEqual(active("/admin/home"), ["membros"]);
  assert.deepEqual(active("/admin/area-de-membros/marca"), ["membros"]);
  assert.deepEqual(active("/admin/area-de-membros/login"), ["membros"]);
  assert.deepEqual(active("/admin/produtos/pacotes"), ["produtos"]);
  assert.deepEqual(active("/admin/comunicacao/webinarios?periodo=7"), ["comunicacao"]);
  assert.deepEqual(active("/admin/alunosx"), []);
});

test("subitem ativo: vence o endereco mais especifico, e o exato so no proprio endereco", () => {
  const item = (id) => adminNavItems.find((entry) => entry.id === id);
  const activeLabel = (pathname, id) => getActiveAdminNavChild(pathname, item(id))?.label ?? null;

  assert.equal(activeLabel("/admin/produtos", "produtos"), "Todos os produtos");
  assert.equal(activeLabel("/admin/produtos/pacotes", "produtos"), "Pacotes");
  assert.equal(activeLabel("/admin/produtos/pacotes/", "produtos"), "Pacotes");
  assert.equal(activeLabel("/admin/produtos/importar?x=1", "produtos"), "Importar");
  assert.equal(activeLabel("/admin/produtos/curso-1/detalhes", "produtos"), "Todos os produtos", "pagina do produto");
  assert.equal(activeLabel("/admin/produtos-velhos", "produtos"), null);

  assert.equal(activeLabel("/admin/area-de-membros", "membros"), "Vitrine");
  assert.equal(activeLabel("/admin/area-de-membros/marca", "membros"), "Marca");
  assert.equal(activeLabel("/admin/area-de-membros/destaque", "membros"), "Destaque");
  assert.equal(activeLabel("/admin/area-de-membros/modulos?pagina=2", "membros"), "Módulos");
  assert.equal(activeLabel("/admin/area-de-membros/login", "membros"), "Login");
  assert.equal(activeLabel("/admin/area-de-membros/loginx", "membros"), "Vitrine", "endereco parecido nao acende Login");
  assert.equal(activeLabel("/admin/home", "membros"), null);

  assert.equal(activeLabel("/admin/configuracoes", "configuracoes"), "Todas as configurações");
  assert.equal(activeLabel("/admin/configuracoes/ia/conexoes", "configuracoes"), "Tutor IA");
  assert.equal(activeLabel("/admin/configuracoes/equipe", "configuracoes"), null, "exato nao acende em subpaginas");

  const products = item("produtos");
  const [allProducts, bundles] = products.children;
  assert.equal(isAdminNavChildActive("/admin/produtos/pacotes", allProducts, products), false);
  assert.equal(isAdminNavChildActive("/admin/produtos/pacotes", bundles, products), true);
});

test("contador do menu: so numeros positivos, com teto de 99+", () => {
  assert.equal(formatAdminNavCount(8), "8");
  assert.equal(formatAdminNavCount(99), "99");
  assert.equal(formatAdminNavCount(100), "99+");
  assert.equal(formatAdminNavCount(3.7), "3");

  for (const hidden of [0, -2, 0.5, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatAdminNavCount(hidden), null, String(hidden));
  }
});

test("cada destino do menu que pertence a esta fase tem uma pagina", () => {
  for (const href of [
    "/admin/produtos/pacotes",
    "/admin/area-de-membros",
    "/admin/area-de-membros/destaque",
    "/admin/area-de-membros/modulos",
    "/admin/area-de-membros/login",
    "/admin/area-de-membros/marca",
    "/admin/configuracoes",
    "/admin/configuracoes/ia",
    "/admin/configuracoes/ia/conexoes",
    "/admin/configuracoes/ia/consumo"
  ]) {
    const page = join(v2RouteDir, href.replace(/^\/admin/, ""), "page.tsx");
    assert.ok(existsSync(page), `${href} precisa de page.tsx`);
    assert.ok(existsSync(join(v2RouteDir, href.replace(/^\/admin/, ""), "loading.tsx")), `${href} precisa de loading.tsx`);
  }
});

test("isAdminV2Href separa o admin novo do legado e da area do aluno", () => {
  assert.equal(isAdminV2Href("/admin"), true);
  assert.equal(isAdminV2Href("/admin/"), true);
  assert.equal(isAdminV2Href("/admin/alunos?periodo=7"), true);
  assert.equal(isAdminV2Href("/admin/legado"), false);
  assert.equal(isAdminV2Href("/admin/legado/"), false);
  assert.equal(isAdminV2Href("/admin/legado?aba=alunos"), false);
  assert.equal(isAdminV2Href("/administrador"), false);
  assert.equal(isAdminV2Href("/"), false);

  assert.equal(isAdminLegacyPath("/admin/legado"), true);
  assert.equal(isAdminLegacyPath("/admin/legado/qualquer"), true);
  assert.equal(isAdminLegacyPath("/admin/legadox"), false);
  assert.equal(isAdminLegacyPath("/admin"), false);
  assert.equal(isAdminLegacyPath(null), false);
});

test("so areas que existem no admin antigo oferecem o atalho para ele", () => {
  for (const area of ["alunos", "produtos", "membros", "comunidade", "configuracoes"]) {
    assert.deepEqual(getAdminLegacyAvailability(area), { href: ADMIN_LEGACY_HREF, kind: "legacy" }, area);
  }

  assert.deepEqual(getAdminLegacyAvailability("comunicacao"), {
    kind: "new",
    note: "Avisos, webinários e promoções são novidade: ainda não existem no admin antigo."
  });
});

test("getGreeting usa o horario de Sao Paulo", () => {
  // America/Sao_Paulo e UTC-3 o ano todo desde 2019.
  assert.equal(getGreeting(new Date("2026-10-10T12:00:00Z")), "Bom dia"); // 9h
  assert.equal(getGreeting(new Date("2026-10-10T18:00:00Z")), "Boa tarde"); // 15h
  assert.equal(getGreeting(new Date("2026-10-11T01:00:00Z")), "Boa noite"); // 22h

  assert.equal(getGreeting(new Date("2026-10-10T07:59:00Z")), "Boa noite", "4h59 ainda e noite");
  assert.equal(getGreeting(new Date("2026-10-10T08:00:00Z")), "Bom dia", "5h ja e dia");
  assert.equal(getGreeting(new Date("2026-10-10T15:00:00Z")), "Boa tarde", "12h ja e tarde");
  assert.equal(getGreeting(new Date("2026-10-10T21:00:00Z")), "Boa noite", "18h ja e noite");

  assert.equal(getGreeting(new Date("2026-10-10T12:00:00Z"), "UTC"), "Boa tarde", "fuso explicito");
});

test("formatadores do admin escrevem em pt-BR e nunca inventam valor", () => {
  assert.equal(formatKpiValue(1234567), "1.234.567");
  assert.equal(formatKpiValue(0), "0");
  assert.equal(formatKpiValue(12.5, "percent"), "12,5%");
  assert.equal(formatKpiValue(100, "percent"), "100%");

  for (const missing of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatKpiValue(missing), EMPTY_VALUE);
    assert.equal(formatKpiValue(missing, "percent"), EMPTY_VALUE);
  }
  assert.equal(EMPTY_VALUE, "—");

  assert.equal(formatDeltaMagnitude(12), "12\u00a0%");
  assert.equal(formatDeltaMagnitude(-12.5), "12,5\u00a0%", "sem sinal: a seta mostra a direcao");
  assert.equal(formatDeltaMagnitude(2, "points"), "2\u00a0pts");
  assert.equal(formatDeltaMagnitude(-1, "points"), "1\u00a0pt");
  assert.equal(formatDeltaMagnitude(0), "0\u00a0%");

  assert.equal(formatDelta(12.5), "+12,5%");
  assert.equal(formatDelta(-3), "-3,0%");
  assert.equal(formatDelta(0), "0,0%");

  assert.equal(formatAdminRole("owner"), "Dono");
  assert.equal(formatAdminRole("admin"), "Administrador");
  assert.equal(formatAdminRole("support"), "Suporte");

  assert.equal(getInitials("Danilo Souza"), "DS");
  assert.equal(getInitials("  ana  maria da silva "), "AS");
  assert.equal(getInitials("ana"), "AN");
  assert.equal(getInitials("   "), "?");

  assert.equal(formatLongDate(new Date("2026-10-10T15:00:00Z")), "Sábado, 10 de outubro de 2026");
  assert.equal(formatLongDate(new Date("2026-10-11T02:00:00Z")), "Sábado, 10 de outubro de 2026", "23h em Sao Paulo");
});

test("layout e toda pagina do admin novo chamam o guard de admin antes de renderizar", () => {
  const routeEntries = v2Sources.filter((entry) => entry.path.startsWith("src/app/admin/(v2)/"));
  const pages = routeEntries.filter((entry) => entry.path.endsWith("/page.tsx"));

  assert.ok(pages.length >= 10, `esperava as 10 rotas do admin novo, achei ${pages.length}`);

  for (const entry of [...pages, { path: "src/app/admin/(v2)/layout.tsx", source: sourceOf("src/app/admin/(v2)/layout.tsx") }]) {
    assert.match(entry.source, /import \{ requirePageAdmin \} from "@\/server\/auth\/guards";/, entry.path);

    const guardIndex = entry.source.search(/requirePageAdmin\(\)/);
    // Fim da pagina: o primeiro JSX devolvido ou, numa pagina so de redirecionamento, o redirect.
    const exits = [entry.source.search(/return \(/), entry.source.search(/\bredirect\(/)].filter((index) => index >= 0);
    const renderIndex = exits.length > 0 ? Math.min(...exits) : -1;

    assert.ok(guardIndex > 0, `${entry.path} precisa chamar requirePageAdmin()`);
    assert.ok(renderIndex > 0, `${entry.path} precisa devolver JSX ou redirecionar`);
    assert.ok(guardIndex < renderIndex, `${entry.path} chama o guard antes de devolver o JSX ou redirecionar`);
    assert.match(entry.source, /export default async function/, `${entry.path} precisa aguardar o guard`);
  }

  assert.equal(existsSync(join(v2RouteDir, "_lib/admin-session.ts")), false, "sem a abstracao vazia sobre o guard");
  for (const entry of v2Sources) {
    assert.doesNotMatch(entry.source, /getAdminSession|admin-session/, entry.path);
  }
});

test("admin novo nao carrega o painel antigo nem usa cores nomeadas do Tailwind", () => {
  const namedColorClass = /[a-z]-(?:zinc|sky|emerald|red|amber|blue)-\d{2,3}\b/;

  for (const { path, source } of v2Sources) {
    assert.doesNotMatch(source, /getAdminDashboardData/, path);
    assert.doesNotMatch(source, namedColorClass, `${path}: use os tokens var(--...) do admin`);
  }
});

test("textos do admin novo evitam o vocabulario tecnico proibido", () => {
  const forbidden = /\b(?:entitlements?|rbac|assets?|escopo|persistid[oa]s?|crm|drip|webhooks?|supabase)\b/i;

  for (const { path, source } of v2Sources) {
    assert.doesNotMatch(stripComments(source), forbidden, path);
  }
});

test("tokens do admin valem tambem nos portais, sem repetir data-scope a mao", () => {
  assert.match(globalsCss, /:root:has\(\[data-scope="admin"\]\),\s*\[data-scope="admin"\] \{/);

  // Comentarios podem citar o atributo; o que conta e o JSX.
  const scopedFiles = v2Sources
    .filter(({ source }) => stripComments(source).includes('data-scope="admin"'))
    .map(({ path }) => path);

  assert.deepEqual(
    scopedFiles,
    ["src/components/admin/v2/admin-shell.tsx", "src/components/admin/v2/skeletons.tsx"],
    "so a raiz da moldura (e o skeleton dela) leva data-scope"
  );
  for (const path of scopedFiles) {
    assert.equal(stripComments(sourceOf(path)).match(/data-scope="admin"/g).length, 1, path);
  }
  assert.match(sourceOf("src/components/admin/v2/styles.ts"), /:root:has\(\[data-scope="admin"\]\)/);
});

test("botao e foco do admin sao temados uma vez em globals.css (36/32/44 px do prototipo)", () => {
  assert.match(
    globalsCss,
    /:root:has\(\[data-scope="admin"\]\) \[data-slot="button"\] \{\s*height: 2\.25rem;\s*min-width: 2\.25rem;\s*border-radius: 0\.5rem;\s*\}/
  );
  assert.match(
    globalsCss,
    /:root:has\(\[data-scope="admin"\]\) \[data-slot="button"\]:is\(\.h-7, \.size-7\) \{\s*height: 2rem;\s*min-width: 2rem;\s*\}/,
    "size=sm: 32 px"
  );
  assert.match(
    globalsCss,
    /@media \(pointer: coarse\), \(max-width: 767px\) \{\s*:root:has\(\[data-scope="admin"\]\) \[data-slot="button"\] \{\s*height: 2\.75rem;/,
    "toque e celular: 44 px"
  );
  assert.match(globalsCss, /--border-stronger: rgba\(255, 255, 255, 0\.22\);/);
  assert.match(globalsCss, /--press-overlay: rgba\(255, 255, 255, 0\.07\);/);
  assert.match(
    globalsCss,
    /:root:has\(\[data-scope="admin"\]\)\s*:is\([^)]*a\[href\][^)]*button[^)]*\):focus-visible \{\s*outline: 2px solid var\(--focus-ring\);\s*outline-offset: 2px;\s*box-shadow: none;\s*\}/
  );

  for (const { path, source } of v2Sources) {
    assert.doesNotMatch(source, /adminFocusRing/, path);
  }

  const linkButton = sourceOf("src/components/admin/v2/link-button.tsx");
  assert.match(linkButton, /buttonVariants\(/);
  assert.match(linkButton, /data-slot="button"/);
  assert.doesNotMatch(linkButton, /\bh-(?:8|10)\b|rounded-lg/);
  assert.doesNotMatch(sourceOf("src/components/admin/v2/save-bar.tsx"), /\bh-10\b|rounded-lg h-|focus-visible:/);
});

test("barra superior: busca a esquerda, Periodo e Produto so no escopo, lembretes e conta a direita, sem migalha", () => {
  const topbar = sourceOf("src/components/admin/v2/admin-topbar.tsx");

  assert.match(topbar, /<GlobalSearch \/>/);
  assert.match(topbar, /getAdminTopbarScope\(pathname\)/);
  assert.match(topbar, /getAdminMobileTitle\(pathname\)/);
  assert.doesNotMatch(topbar, /Breadcrumb|Busca em breve/, "sem migalha e sem o aviso antigo");
  assert.match(topbar, /<NotificationsMenu counts=\{counts\} \/>/);
  assert.match(topbar, /<AccountMenu account=\{account\} \/>/, "a conta fica na barra superior");

  const notifications = sourceOf("src/components/admin/v2/notifications-menu.tsx");
  assert.match(notifications, /counts\.hoje/);
  assert.match(notifications, /counts\.comunidade/);
  assert.match(notifications, /Tudo em dia\./, "sem pendencia, nunca um exemplo");

  const search = sourceOf("src/components/admin/v2/global-search.tsx");
  assert.match(search, /<input/);
  assert.match(search, /role="combobox"/);
  assert.match(search, /aria-activedescendant=/);
  assert.match(search, /role="listbox"/);
  assert.match(search, /from "@\/server\/admin\/search-actions"/);
  assert.match(search, /ADMIN_SEARCH_DEBOUNCE_MS/);
  assert.match(search, /event\.key\.toLowerCase\(\) === "k"/, "Cmd/Ctrl+K");
  assert.match(search, /Não foi possível buscar agora\./);
  assert.match(search, /Nada encontrado para “/);

  const filters = sourceOf("src/components/admin/v2/global-filters.tsx");
  assert.match(filters, /scope\.period \? <PeriodMenu \/>/);
  assert.match(filters, /scope\.product \? <ProductFilter/);
  assert.doesNotMatch(filters, /<select|<option|ToggleGroup/);

  const periodMenu = sourceOf("src/components/admin/v2/period-menu.tsx");
  assert.match(periodMenu, /ADMIN_PERIOD_PRESET_OPTIONS/);
  assert.match(periodMenu, /buildAdminPeriodMenuHref\(/);
  assert.match(periodMenu, /parseAdminPeriodParamStrict\(/);
  assert.match(periodMenu, /Escolher datas…/);
  assert.match(periodMenu, /dynamic\(\(\) => import\("\.\/period-calendar"\)/, "calendario carregado so ao abrir");
  assert.match(periodMenu, /startTransition\(/);
  assert.match(periodMenu, /aria-busy=\{pending \|\| undefined\}/);
  assert.doesNotMatch(periodMenu, /<select|<option/);

  const calendar = sourceOf("src/components/admin/v2/period-calendar.tsx");
  assert.match(calendar, /from "react-day-picker"/);
  assert.match(calendar, /from "react-day-picker\/locale"/);
  assert.match(calendar, /mode="range"/);
  assert.match(calendar, /validateAdminPeriodRange\(/);
  assert.match(calendar, /civilDateToPickerDate\(/);
  assert.match(calendar, /pickerDateToCivilDate\(/);
  assert.match(calendar, /getAdminPeriodShortcuts\(/);
  assert.doesNotMatch(calendar, /disabled=\{!validation/, "Aplicar nunca fica desativado por validacao");

  const usesDayPicker = v2Sources.filter(({ source }) => /from "react-day-picker"/.test(source)).map(({ path }) => path);
  assert.deepEqual(usesDayPicker, ["src/components/admin/v2/period-calendar.tsx"], "so o calendario carrega a biblioteca");

  const productFilter = sourceOf("src/components/admin/v2/product-filter.tsx");
  assert.match(productFilter, /buildAdminProductFilterHref\(/);
  assert.match(productFilter, /"Produto selecionado"/);
});

test("barra lateral: trilho de 72 px so com icones; o menu completo abre por cima, com veu (pedido do produtor)", () => {
  const shell = sourceOf("src/components/admin/v2/admin-shell.tsx");
  const layout = sourceOf("src/app/admin/(v2)/layout.tsx");

  assert.match(shell, /w-\[72px\]/, "trilho fixo de 72 px");
  assert.match(shell, /md:pl-\[72px\]/, "o conteudo nunca e empurrado pelo menu aberto");
  assert.doesNotMatch(shell, /md:pl-60|ADMIN_SIDEBAR_COOKIE|setCollapsed/, "nao existe mais barra que empurra o conteudo");
  assert.doesNotMatch(layout, /cookies\(\)/);
  assert.match(shell, /<Dialog\.Backdrop/, "veu escuro por cima da pagina");
  assert.match(shell, /bg-black\/70/);
  assert.doesNotMatch(shell, /Dialog\.Backdrop[^>]*md:hidden|Dialog\.Popup[^>]*md:hidden/, "o menu por cima vale em todas as larguras");
  assert.match(shell, /\/brand\/icon-bunker\.png/, "trilho mostra so o simbolo");
  assert.match(shell, /\/brand\/logo-bunker\.svg/, "menu aberto mostra a logo inteira");
  assert.match(shell, /title=\{item\.label\}/, "trilho mostra o nome ao passar o mouse");
  assert.match(shell, /<button\s[^>]*aria-expanded=\{groupOpen\}/, "grupo abre e fecha, nao navega");
  assert.match(shell, /data-nav-group=\{item\.id\}/);
  assert.match(shell, /rotate-90/);
  assert.match(shell, /Ver área do aluno/);
  assert.match(shell, /Admin antigo/);
  assert.doesNotMatch(shell, /<AccountMenu/, "a conta saiu da barra lateral");
  assert.match(shell, /buildAdminNavHref\(/, "menu leva o periodo para as telas");
  assert.match(shell, /w-\[min\(280px,86vw\)\]/, "largura do menu aberto");
  assert.doesNotMatch(shell, /\bSun\b|\bMoon\b|theme/i, "sempre escuro, sem troca de tema");
  assert.match(shell, /hoje: LayoutDashboard/, "Visão geral com icone de painel, nao sol");
  assert.match(shell, /produtos: Box/);
  assert.match(shell, /comunidade: MessageCircle/);
  assert.match(shell, /configuracoes: SlidersHorizontal/);
});

test("telas em construcao falam a lingua do produto e guardam a fase so no atributo", () => {
  const placeholder = sourceOf("src/components/admin/v2/phase-placeholder.tsx");

  assert.match(placeholder, /"Esta tela ainda está sendo construída\."/);
  assert.match(placeholder, /"Abrir no admin antigo"/);
  assert.match(placeholder, /data-phase=\{phase\}/);
  assert.doesNotMatch(stripComments(placeholder), /chega na fase|docs\/17|Até lá, use o admin antigo/);

  // Telas em construcao: paginas que marcam a fase (data-phase={N}, numa moldura ou no PhasePlaceholderPage).
  const constructionPages = v2Sources.filter(
    ({ path, source }) => path.endsWith("/page.tsx") && (/data-phase=\{\d+\}/.test(source) || /<PhasePlaceholderPage\b/.test(source))
  );
  assert.ok(constructionPages.length > 0, "ainda ha telas em construcao no admin novo");

  for (const { path, source } of constructionPages) {
    assert.doesNotMatch(stripComments(source).replace(/data-phase=\{\d+\}|phase=\{\d+\}/g, ""), /\bfase \d/i, path);

    if (/<PhasePlaceholderPage\b/.test(source)) {
      const area = source.match(/area="([a-z]+)"/)?.[1];
      assert.ok(area, `${path} informa a area`);
      assert.equal(path.includes("/comunicacao/"), area === "comunicacao", path);
    }
  }

  // Molduras que recebem a fase (data-phase={phase}) mostram o mesmo aviso de construcao.
  const phaseComponents = v2Sources.filter(
    ({ path, source }) => path.startsWith("src/components/admin/v2/") && /data-phase=\{phase\}/.test(stripComments(source))
  );
  assert.ok(phaseComponents.length > 0);
  for (const { path, source } of phaseComponents) {
    assert.match(source, /UNDER_CONSTRUCTION_MESSAGE|Esta tela ainda está sendo construída\./, path);
  }

  const today = sourceOf("src/app/admin/(v2)/page.tsx");
  assert.doesNotMatch(stripComments(today), /fase \d|próximas fases/);
});

test("loading de /admin respeita o admin antigo e o menu da conta usa o sair compartilhado", () => {
  const loading = sourceOf("src/app/admin/loading.tsx");

  assert.match(loading, /^"use client";/);
  assert.match(loading, /usePathname\(\)/);
  assert.match(loading, /isAdminLegacyPath\(pathname\) \? <AdminLegacyLoading \/> : <AdminShellSkeleton \/>/);
  assert.match(loading, /from "\.\/legado\/loading"/);

  const accountMenu = sourceOf("src/components/admin/v2/account-menu.tsx");
  assert.match(accountMenu, /import \{ signOutAndLeave \} from "@\/lib\/auth\/sign-out";/);
  assert.doesNotMatch(accountMenu, /\/api\/auth\/logout|function signOutAndLeave/);
});
