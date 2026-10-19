import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Minhas compras e Favoritos (aluno v2): recorte da tela montado a partir da biblioteca do aluno.
// Progresso e situacao sao do proprio aluno; nada vem de content_items.progress/status (colunas globais).

const purchases = await import("../src/server/member-area/purchases-view.ts");
const favorites = await import("../src/server/member-area/favorites-view.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-11T15:00:00.000Z");

function lesson(id, overrides = {}) {
  return {
    completed: false,
    contentId: "curso-1",
    duration: "10:00",
    id,
    image: "",
    isReleaseLocked: false,
    isSaved: false,
    moduleId: "mod-1",
    rated: false,
    resumeImage: "",
    title: `Aula ${id}`,
    watch: null,
    ...overrides
  };
}

function courseModule(id, contentId, lessons, overrides = {}) {
  return { contentId, id, image: `https://cdn.exemplo.com/${id}.jpg`, isReleaseLocked: false, isSaved: false, lessons, title: `Modulo ${id}`, ...overrides };
}

function content(id, modules, overrides = {}) {
  return {
    access: { endsAt: null, kind: "entitlement", startsAt: "2026-01-01T15:00:00.000Z" },
    childContentIds: [],
    commerceScope: "sellable_product",
    description: "",
    eyebrow: "Inteligência artificial",
    href: `/conteudo/${id}`,
    id,
    image: `https://cdn.exemplo.com/${id}.jpg`,
    isReleaseLocked: false,
    isSaved: false,
    kind: "Curso",
    modules,
    title: `Conteudo ${id}`,
    ...overrides
  };
}

const watch = (progressPercent, lastWatchedAt, status = "in_progress", extra = {}) => ({
  lastWatchedAt,
  maxProgressPercent: progressPercent,
  progressPercent,
  progressSeconds: progressPercent * 6,
  status,
  ...extra
});

function sampleLibrary(accessPreviewMode) {
  const emAndamento = content("em-andamento", [courseModule("m1", "em-andamento", [
    lesson("a1", { completed: true, contentId: "em-andamento", moduleId: "m1", watch: watch(100, "2026-10-01T10:00:00.000Z", "completed") }),
    lesson("a2", { contentId: "em-andamento", moduleId: "m1", title: "Prompt base", watch: watch(40, "2026-10-09T10:00:00.000Z") }),
    lesson("a3", { contentId: "em-andamento", moduleId: "m1" }),
    lesson("a4", { contentId: "em-andamento", isReleaseLocked: true, moduleId: "m1", releaseLabel: "Liberação em 20/10/2026" })
  ])]);
  const novo = content("novo", [courseModule("m2", "novo", [lesson("b1", { contentId: "novo", moduleId: "m2", title: "Boas-vindas" })])], {
    access: { endsAt: "2026-10-30T15:00:00.000Z", kind: "entitlement", startsAt: "2026-02-01T15:00:00.000Z" },
    kind: "Bootcamp"
  });
  const concluido = content("concluido", [courseModule("m3", "concluido", [
    lesson("c1", { completed: true, contentId: "concluido", moduleId: "m3", watch: watch(100, "2026-09-01T10:00:00.000Z", "completed") })
  ])], { access: { endsAt: null, kind: "free", startsAt: null } });
  const interno = content("interno", [courseModule("mi", "interno", [
    lesson("i1", { completed: true, contentId: "interno", moduleId: "mi", watch: watch(100, "2026-10-05T10:00:00.000Z", "completed") }),
    lesson("i2", { contentId: "interno", moduleId: "mi" })
  ])], { commerceScope: "included_content", parentContentId: "formacao" });
  const formacao = content("formacao", [], { childContentIds: ["interno"], kind: "Formacao" });
  const formacaoNova = content("formacao-nova", [], { kind: "Formacao" });

  return {
    accessPreviewMode,
    contents: [formacao, formacaoNova, emAndamento, novo, concluido, interno],
    userId: "aluno-1"
  };
}

test("minhas compras: progresso do proprio aluno, formacao soma os cursos internos", () => {
  const view = purchases.buildPurchasesPageView(sampleLibrary(), { now: NOW });
  const byId = new Map(view.products.map((product) => [product.id, product]));

  // Cursos internos nao viram produto separado.
  assert.deepEqual([...byId.keys()].sort(), ["concluido", "em-andamento", "formacao", "formacao-nova", "novo"]);

  const emAndamento = byId.get("em-andamento");
  assert.equal(emAndamento.completedLessons, 1);
  assert.equal(emAndamento.totalLessons, 4);
  assert.equal(emAndamento.percent, 25);
  assert.equal(emAndamento.status, "in_progress");
  assert.equal(emAndamento.statusLabel, "Em andamento");
  assert.equal(emAndamento.lockedLessons, 1);
  assert.equal(purchases.getPurchaseLessonsMeta(emAndamento), "1 de 4 aulas");

  const formacao = byId.get("formacao");
  assert.equal(formacao.totalLessons, 2);
  assert.equal(formacao.completedLessons, 1);
  assert.equal(formacao.percent, 50);
  assert.equal(formacao.kindLabel, "Formação");

  assert.deepEqual(view.stats, { completed: 1, completedLessons: 3, inProgress: 2, notStarted: 2, products: 5, totalLessons: 8 });
  assert.deepEqual(view.kindOptions.map((option) => [option.id, option.label, option.count]), [
    ["Formacao", "Formações", 2],
    ["Curso", "Cursos", 2],
    ["Bootcamp", "Bootcamps", 1]
  ]);
});

test("minhas compras: acao de cada produto (Continuar, Começar, Revisar, Ver cursos)", () => {
  const view = purchases.buildPurchasesPageView(sampleLibrary("producer"), { now: NOW });
  const byId = new Map(view.products.map((product) => [product.id, product]));

  const emAndamento = byId.get("em-andamento");
  assert.equal(emAndamento.resumeKind, "continue");
  assert.equal(emAndamento.resumeLabel, "Continuar: Prompt base");
  assert.equal(emAndamento.resumeLessonTitle, "Prompt base");
  assert.equal(emAndamento.resumeHref, "/conteudo/em-andamento/aulas/m1?lessonId=a2&accessPreview=producer");

  const novo = byId.get("novo");
  assert.equal(novo.resumeKind, "start");
  assert.equal(novo.resumeLabel, "Começar");
  assert.equal(novo.resumeHref, "/conteudo/novo/aulas/m2?lessonId=b1&accessPreview=producer");
  assert.equal(purchases.getPurchaseLessonsMeta(novo), "1 aula");

  const concluido = byId.get("concluido");
  assert.equal(concluido.resumeKind, "review");
  assert.equal(concluido.resumeLabel, "Revisar");
  assert.equal(concluido.resumeHref, concluido.href);

  const formacaoNova = byId.get("formacao-nova");
  assert.equal(formacaoNova.resumeKind, "browse");
  assert.equal(formacaoNova.resumeLabel, "Ver cursos");
  assert.equal(purchases.getPurchaseLessonsMeta(formacaoNova), "Aulas em breve");

  // Produto inteiro aguardando liberacao: sem acao para abrir aula, com a frase de liberacao.
  const library = sampleLibrary();
  library.contents.push(content("bloqueado", [courseModule("mb", "bloqueado", [
    lesson("x1", { contentId: "bloqueado", isReleaseLocked: true, moduleId: "mb", releaseLabel: "Liberação em 08/01/2026" })
  ], { isReleaseLocked: true, releaseLabel: "Liberação em 08/01/2026" })], { isReleaseLocked: true, releaseLabel: "Liberação em 08/01/2026" }));
  const locked = purchases.buildPurchasesPageView(library, { now: NOW }).products.find((product) => product.id === "bloqueado");
  assert.equal(locked.resumeHref, null);
  assert.equal(locked.releaseLabel, "Liberação em 08/01/2026");
  assert.equal(locked.lockedLessons, 1);
});

test("minhas compras: ultima atividade primeiro, depois os nao iniciados na ordem do produtor", () => {
  const view = purchases.buildPurchasesPageView(sampleLibrary(), { now: NOW });

  // em-andamento (09/10) > formacao (05/10, curso interno) > concluido (01/09) > formacao-nova, novo (ordem original).
  assert.deepEqual(view.products.map((product) => product.id), ["em-andamento", "formacao", "concluido", "formacao-nova", "novo"]);
  assert.deepEqual(view.continueTarget, {
    href: "/conteudo/em-andamento/aulas/m1?lessonId=a2",
    lessonTitle: "Prompt base",
    productTitle: "Conteudo em-andamento"
  });
  assert.equal(view.homeHref, "/");
  assert.equal(purchases.buildPurchasesPageView(sampleLibrary("student_with_access"), { now: NOW }).homeHref, "/?accessPreview=student_with_access");

  const empty = purchases.buildPurchasesPageView({ contents: [], userId: "aluno-1" }, { now: NOW });
  assert.equal(empty.continueTarget, null);
  assert.deepEqual(empty.products, []);
  assert.equal(empty.stats.products, 0);
});

test("minhas compras: texto do acesso so para acesso real, com data no fuso de Sao Paulo", () => {
  const label = (access) => purchases.getPurchaseAccessLabel(access, NOW);

  assert.deepEqual(label({ endsAt: null, kind: "entitlement", startsAt: "2026-01-01T15:00:00.000Z" }), {
    endsSoon: false,
    label: "Desde 01/01/2026 · Acesso vitalício"
  });
  // 02:30 UTC do dia 2 ainda e dia 1 em Sao Paulo.
  assert.equal(label({ endsAt: "2027-01-02T02:30:00.000Z", kind: "entitlement", startsAt: "2026-01-02T02:30:00.000Z" }).label, "Desde 01/01/2026 · Acesso até 01/01/2027");
  assert.deepEqual(label({ endsAt: "2026-10-30T15:00:00.000Z", kind: "entitlement", startsAt: null }), { endsSoon: true, label: "Acesso até 30/10/2026" });
  assert.deepEqual(label({ endsAt: null, kind: "free", startsAt: null }), { endsSoon: false, label: null });
  assert.deepEqual(label({ endsAt: null, kind: "preview", startsAt: null }), { endsSoon: false, label: null });
  // Acesso sem data conhecida (ex.: cadastro antigo): nada de "vitalício" inventado.
  assert.deepEqual(label({ endsAt: null, kind: "entitlement", startsAt: null }), { endsSoon: false, label: null });

  const view = purchases.buildPurchasesPageView(sampleLibrary(), { now: NOW });
  const byId = new Map(view.products.map((product) => [product.id, product]));
  assert.equal(byId.get("novo").accessLabel, "Desde 01/02/2026 · Acesso até 30/10/2026");
  assert.equal(byId.get("novo").accessEndsSoon, true);
  assert.equal(byId.get("concluido").accessLabel, null);
});

test("minhas compras: busca ignora acento e caixa; previa do admin antigo nao inventa progresso", () => {
  assert.equal(purchases.normalizeMemberSearchText("  Formação   em IA "), "formacao em ia");
  const view = purchases.buildPurchasesPageView(sampleLibrary(), { now: NOW });
  const formacao = view.products.find((product) => product.id === "formacao");
  assert.ok(formacao.searchText.includes(purchases.normalizeMemberSearchText("formação")));
  assert.ok(formacao.searchText.includes("inteligencia artificial"));

  // content_items.progress/status sao colunas globais: a previa do admin legado nao pode usa-las.
  const preview = purchases.buildPurchasesPreviewView([
    { eyebrow: "IA", id: "curso-x", image: "", kind: "Curso", progress: 80, status: "Concluido", title: "Curso X" }
  ]);
  assert.equal(preview.products[0].percent, 0);
  assert.equal(preview.products[0].status, "not_started");
  assert.equal(preview.products[0].resumeHref, null);
  assert.equal(preview.products[0].href, "/conteudo/curso-x");
  assert.equal(preview.showProgress, false);
  assert.equal(view.showProgress, true);

  const source = read("src/server/member-area/purchases-view.ts");
  assert.doesNotMatch(source, /\bitem\.(progress|status)\b/);
  assert.doesNotMatch(source, /^import\s+"server-only"/m);
  assert.doesNotMatch(source, /from "@\//);
});

function favoritesSource(overrides = {}) {
  return {
    savedContentItems: [
      { eyebrow: "IA", id: "em-andamento", image: "https://cdn.exemplo.com/em-andamento.jpg", kind: "Curso", progress: 0, status: "Novo", title: "Conteudo em-andamento" },
      { eyebrow: "IA", id: "em-andamento", image: "https://cdn.exemplo.com/em-andamento.jpg", kind: "Curso", progress: 0, status: "Novo", title: "Conteudo em-andamento" },
      { eyebrow: "Vendas", id: "nao-comprado", image: "https://cdn.exemplo.com/x.jpg", isLocked: true, kind: "Formacao", progress: 90, status: "Concluido", title: "Formação de vendas" }
    ],
    savedLessonItems: [
      {
        description: "",
        duration: "12:00",
        id: "a2",
        image: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
        moduleId: "m1",
        moduleTitle: "Modulo m1",
        parentContentId: "em-andamento",
        parentContentKind: "Curso",
        parentContentTitle: "Conteudo em-andamento",
        title: "Prompt base"
      },
      {
        description: "",
        duration: "08:00",
        id: "a4",
        image: "https://i.ytimg.com/vi/bloqueadoXYZ/hqdefault.jpg",
        moduleId: "m1",
        moduleTitle: "Modulo m1",
        parentContentId: "em-andamento",
        parentContentKind: "Curso",
        parentContentTitle: "Conteudo em-andamento",
        title: "Aula a4"
      },
      {
        description: "",
        duration: "05:00",
        id: "z1",
        image: "https://i.ytimg.com/vi/segredo1234/hqdefault.jpg",
        moduleId: "mz",
        moduleTitle: "Modulo fechado",
        parentContentId: "nao-comprado",
        parentContentKind: "Formacao",
        parentContentTitle: "Formação de vendas",
        parentIsLocked: true,
        title: "Aula fechada"
      }
    ],
    savedModuleItems: [
      {
        description: "",
        id: "mi",
        image: "https://cdn.exemplo.com/mi.jpg",
        meta: "2 aulas",
        parentContentId: "interno",
        parentContentKind: "Curso",
        parentContentTitle: "Conteudo interno",
        title: "Modulo mi"
      },
      {
        description: "",
        id: "mz",
        image: "https://cdn.exemplo.com/mz.jpg",
        meta: "4 aulas",
        parentContentId: "nao-comprado",
        parentContentKind: "Formacao",
        parentContentTitle: "Formação de vendas",
        parentIsLocked: true,
        title: "Modulo fechado"
      }
    ],
    ...overrides
  };
}

test("favoritos: progresso do aluno para o que ele pode abrir, sem repetir item", () => {
  const view = favorites.buildFavoritesPageView(favoritesSource(), sampleLibrary(), { now: NOW });
  const byKey = new Map(view.items.map((item) => [item.key, item]));

  assert.deepEqual(view.items.map((item) => item.key), [
    "standalone_course:em-andamento",
    "formation:nao-comprado",
    "module:mi",
    "module:mz",
    "lesson:a2",
    "lesson:a4",
    "lesson:z1"
  ]);

  const curso = byKey.get("standalone_course:em-andamento");
  assert.equal(curso.canOpen, true);
  assert.equal(curso.href, "/conteudo/em-andamento");
  assert.equal(curso.meta, "1 de 4 aulas");
  assert.deepEqual(curso.progress, { completed: false, percent: 25 });
  assert.equal(curso.statusLabel, "Em andamento");

  const modulo = byKey.get("module:mi");
  assert.equal(modulo.href, "/conteudo/interno/aulas/mi");
  assert.equal(modulo.meta, "1 de 2 aulas");
  assert.deepEqual(modulo.progress, { completed: false, percent: 50 });
  assert.equal(modulo.context, "Conteudo interno");

  const aula = byKey.get("lesson:a2");
  assert.equal(aula.href, "/conteudo/em-andamento/aulas/m1?lessonId=a2");
  assert.equal(aula.context, "Conteudo em-andamento · Modulo m1");
  assert.deepEqual(aula.progress, { completed: false, percent: 40 });
  assert.equal(aula.statusLabel, "Em andamento");
  assert.match(aula.meta, /^Assistida (?:anteontem|há 2 dias)$/);
  assert.equal(aula.thumbnailLabel, "10:00");
});

test("favoritos: sem acesso ou nao liberado nunca leva thumbnail do video e abre a pagina do produto", () => {
  const view = favorites.buildFavoritesPageView(favoritesSource(), sampleLibrary("producer"), { now: NOW });
  const byKey = new Map(view.items.map((item) => [item.key, item]));

  // Favoritar nao libera acesso; progresso global (90%, "Concluido") do catalogo e ignorado.
  const fechado = byKey.get("formation:nao-comprado");
  assert.equal(fechado.canOpen, false);
  assert.equal(fechado.statusLabel, "Sem acesso");
  assert.equal(fechado.progress, null);
  assert.equal(fechado.href, "/conteudo/nao-comprado?accessPreview=producer");

  const moduloFechado = byKey.get("module:mz");
  assert.equal(moduloFechado.canOpen, false);
  assert.equal(moduloFechado.href, "/conteudo/nao-comprado?accessPreview=producer");

  const aulaFechada = byKey.get("lesson:z1");
  assert.equal(aulaFechada.canOpen, false);
  assert.equal(aulaFechada.image, "");
  assert.equal(aulaFechada.href, "/conteudo/nao-comprado?accessPreview=producer");

  // Aula do aluno ainda nao liberada: frase de liberacao e imagem sem video (capa do modulo).
  const aulaBloqueada = byKey.get("lesson:a4");
  assert.equal(aulaBloqueada.canOpen, true);
  assert.equal(aulaBloqueada.releaseLabel, "Liberação em 20/10/2026");
  assert.equal(aulaBloqueada.image, "https://cdn.exemplo.com/m1.jpg");
  assert.equal(aulaBloqueada.href, "/conteudo/em-andamento/aulas/m1?lessonId=a4&accessPreview=producer");

  for (const item of view.items.filter((entry) => !entry.canOpen || entry.releaseLabel)) {
    assert.equal(favorites.isVideoThumbnailUrl(item.image), false, `${item.key} sem thumbnail de video`);
  }

  assert.equal(favorites.isVideoThumbnailUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg"), true);
  assert.equal(favorites.isVideoThumbnailUrl("https://cdn.exemplo.com/capa.jpg"), false);
  assert.equal(view.exploreHref, "/?accessPreview=producer");
});

test("favoritos: aula concluida e lista vazia", () => {
  const library = sampleLibrary();
  const source = favoritesSource({
    savedContentItems: [],
    savedLessonItems: [{
      description: "",
      duration: "03:00",
      id: "a1",
      image: "https://i.ytimg.com/vi/concluida12/hqdefault.jpg",
      moduleId: "m1",
      moduleTitle: "Modulo m1",
      parentContentId: "em-andamento",
      parentContentKind: "Curso",
      parentContentTitle: "Conteudo em-andamento",
      title: "Aula a1"
    }],
    savedModuleItems: []
  });
  const [aula] = favorites.buildFavoritesPageView(source, library, { now: NOW }).items;

  assert.deepEqual(aula.progress, { completed: true, percent: 100 });
  assert.equal(aula.statusLabel, "Concluída");
  assert.equal(aula.meta, "Concluída");

  const empty = favorites.buildFavoritesPageView({ savedContentItems: [], savedLessonItems: [], savedModuleItems: [] }, library, { now: NOW });
  assert.deepEqual(empty.items, []);

  const viewSource = read("src/server/member-area/favorites-view.ts");
  assert.doesNotMatch(viewSource, /\bitem\.(progress|status)\b/);
  assert.doesNotMatch(viewSource, /^import\s+"server-only"/m);
  assert.doesNotMatch(viewSource, /from "@\//);
});

test("paginas: usuario logado, previa so para admin, biblioteca do aluno e esqueleto proprio", () => {
  // Minhas compras confirma a sessao no Auth; Favoritos e pagina de conteudo (claims do JWT, docs/06).
  for (const [route, page, loading, guard] of [
    ["/minhas-compras", "src/app/minhas-compras/page.tsx", "src/app/minhas-compras/loading.tsx", "requirePageUser"],
    ["/favoritos", "src/app/favoritos/page.tsx", "src/app/favoritos/loading.tsx", "requireStudentPageUser"]
  ]) {
    const pageSource = read(page);
    const loadingSource = read(loading);

    assert.match(pageSource, new RegExp(`\\b${guard}\\("${route}"\\)`));
    assert.match(pageSource, /shellData\.canUseAccessPreview \? requestedAccessPreviewMode : undefined/);
    assert.match(pageSource, /getMemberLibrary\(accessPreviewMode, user\)/);
    assert.match(pageSource, /view=\{view\}/);
    assert.doesNotMatch(pageSource, /library=\{/);
    assert.match(loadingSource, /MemberShellSkeleton/);
    assert.match(loadingSource, /MemberPosterGridSkeleton/);
    assert.doesNotMatch(loadingSource, /data-route-loading/);
  }

  const purchasesPage = read("src/app/minhas-compras/page.tsx");
  assert.match(purchasesPage, /buildPurchasesPageView\(library\)/);
  assert.doesNotMatch(purchasesPage, /getPurchasesPageData/);
  assert.match(read("src/app/minhas-compras/loading.tsx"), /MemberPageHeaderSkeleton withStats/);

  const favoritesPage = read("src/app/favoritos/page.tsx");
  // Lista e biblioteca em paralelo (mesma leitura em cache da requisicao).
  assert.match(favoritesPage, /Promise\.all\(\[\s*getFavoritesPageData\(accessPreviewMode, user\),\s*getMemberLibrary\(accessPreviewMode, user\)\s*\]\)/);
  assert.match(favoritesPage, /buildFavoritesPageView\(favoritesData, library\)/);
});

test("componentes: cliente leve, sem biblioteca inteira, remocao de favorito na hora", () => {
  const purchasesClient = read("src/components/purchases-experience.tsx");
  const favoritesClient = read("src/components/favorites-experience.tsx");

  for (const source of [purchasesClient, favoritesClient]) {
    assert.match(source, /^"use client";/);
    assert.doesNotMatch(source, /MemberLibrary\b|getMemberLibrary/);
    // Situacao e progresso globais do catalogo (ContentItem.progress/status: "Concluido", "Novo") nao entram.
    assert.doesNotMatch(source, /\b(?:item|product)\.progress\s*(?:>=|>|\/)|\b(?:item|product)\.status\s*===\s*"[A-Z]|"Concluido"|"Novo"/);
    assert.match(source, /MemberPage\b/);
    assert.match(source, /MemberFilterPills/);
    assert.match(source, /MemberSearchField/);
    assert.match(source, /MemberEmptyState/);
    assert.match(source, /memberPosterGridClassName/);
  }

  // Minhas compras: numeros reais, vazio honesto com caminho para o suporte, acao fora do link da capa.
  assert.match(purchasesClient, /MemberStatGrid/);
  assert.match(purchasesClient, /Você ainda não tem produtos liberados/);
  assert.match(purchasesClient, /href="\/suporte"/);
  assert.match(purchasesClient, /Continuar de onde parei/);
  assert.match(purchasesClient, /Limpar filtros/);
  assert.doesNotMatch(purchasesClient, /Progresso medio|averageProgress/);

  // Favoritos: remover sem sair da tela (evento do botao de salvar), botao fora do link do card.
  assert.match(favoritesClient, /savedItemChangedEvent/);
  assert.match(favoritesClient, /setHiddenKeys/);
  assert.match(favoritesClient, /cornerAction=\{<RemoveFavoriteButton item=\{item\} \/>\}/);
  assert.match(favoritesClient, /MemberLessonCard/);
  assert.match(favoritesClient, /Você ainda não salvou nada/);
  assert.match(favoritesClient, /Explorar a página inicial/);
  assert.match(favoritesClient, /aria-live="polite"/);
});
