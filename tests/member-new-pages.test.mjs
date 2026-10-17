import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Paginas novas da barra lateral do aluno (aluno v2): Minha jornada, Continue assistindo, Materiais,
// Suporte e Perfil. Invariantes: sessao obrigatoria (pagina + proxy), previa so para admin, dados da
// biblioteca do proprio aluno (nada inventado), material so de aula liberada e sem endereco quando
// bloqueado, canais de suporte so com link seguro.

const model = await import("../src/server/member-area/student-pages-model.ts");
const support = await import("../src/lib/member-support.ts");
const materialsFilter = await import("../src/components/member/pages/materials-filter.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

const routes = [
  { dir: "minha-jornada", loader: "getJourneyPageData", route: "/minha-jornada", usesLibrary: true },
  { dir: "continue-assistindo", loader: "getContinueWatchingPageData", route: "/continue-assistindo", usesLibrary: true },
  { dir: "materiais", loader: "getMaterialsPageData", route: "/materiais", usesLibrary: true },
  { dir: "suporte", loader: "getSupportPageData", route: "/suporte", usesLibrary: false },
  { dir: "perfil", loader: "getProfilePageData", route: "/perfil", usesLibrary: true }
];

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} existe`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("cada pagina nova exige sessao, so aceita previa de admin e tem esqueleto proprio", () => {
  const loaders = read("src/server/member-area/student-pages.ts");

  for (const { dir, loader, route, usesLibrary } of routes) {
    assert.ok(exists(`src/app/${dir}/page.tsx`), `${route} tem page.tsx`);
    assert.ok(exists(`src/app/${dir}/loading.tsx`), `${route} tem loading.tsx`);

    const page = read(`src/app/${dir}/page.tsx`);
    assert.match(page, new RegExp(`requirePageUser\\("${route}"\\)`), `${route} chama requirePageUser`);
    assert.match(page, /export const dynamic = "force-dynamic";/);
    assert.match(page, /const accessPreviewMode = shellData\.canUseAccessPreview \? requestedAccessPreviewMode : undefined;/);
    assert.match(page, /<AppShell[\s\S]*accessPreviewMode=\{accessPreviewMode\}[\s\S]*canUseAccessPreview=\{shellData\.canUseAccessPreview\}/);
    assert.match(page, new RegExp(`\\b${loader}\\(`), `${route} usa ${loader}`);
    // O modo de previa so e usado depois de conferir o papel de admin.
    if (usesLibrary) {
      assert.ok(
        page.indexOf("shellData.canUseAccessPreview ?") < page.indexOf(`${loader}(accessPreviewMode`),
        `${route} decide a previa antes de ler os dados`
      );
      assert.match(functionBody(loaders, loader), /getMemberLibrary\(accessPreviewMode, user\)/, `${loader} le a biblioteca do aluno`);
    }

    const loading = read(`src/app/${dir}/loading.tsx`);
    assert.match(loading, /<MemberShellSkeleton label="Carregando [^"]+\.\.\.">/);
    assert.doesNotMatch(loading, /data-route-loading/);
  }
});

test("proxy protege as cinco rotas novas e o rodape leva ao suporte", () => {
  const proxy = read("src/proxy.ts");
  const prefixes = proxy.match(/const protectedPagePrefixes = \[([^\]]*)\]/)?.[1] ?? "";

  for (const { route } of routes) {
    assert.ok(prefixes.includes(`"${route}"`), `${route} fica atras do login`);
  }

  const footer = read("src/components/member-footer.tsx");
  assert.match(footer, /href=\{MEMBER_ROUTES\.support\}/);
  assert.doesNotMatch(footer, /<button[^>]*>\s*Suporte\s*<\/button>/);

  // O rodape tambem aparece na pagina da aula: os links gravam o progresso antes de sair.
  assert.doesNotMatch(footer, /from "next\/link"/);
  assert.match(footer, /<MemberProgressLink[\s\S]*?href=\{MEMBER_ROUTES\.support\}/);
  const progressLink = read("src/components/member/ui/member-progress-link.tsx");
  assert.match(progressLink, /^"use client";/);
  assert.match(
    progressLink,
    /event\.preventDefault\(\);\s*startNavigation\(href\);[\s\S]*?await window\.__bunker707FlushLessonProgress\?\.\(\);\s*await flushPendingSavedItemChanges\(\);\s*router\.push\(href\);/
  );
  assert.match(progressLink, /event\.metaKey \|\|[\s\S]*?event\.ctrlKey \|\|/);
  assert.doesNotMatch(progressLink, /router\.refresh/);
});

test("servidor das paginas: so leitura do proprio aluno, sem chave de servico e sem dado inventado", () => {
  const loaders = read("src/server/member-area/student-pages.ts");
  const profile = read("src/server/member-area/student-profile.ts");

  assert.match(loaders, /^import "server-only";/m);
  assert.doesNotMatch(loaders, /getSupabaseAdminClient/);
  assert.match(profile, /^import "server-only";/m);
  assert.match(profile, /createSupabaseServerClient\(\)/);
  assert.doesNotMatch(profile, /getSupabaseAdminClient/);
  // A leitura e memoizada por id do usuario logado (menu do topo e Perfil leem uma vez so).
  assert.match(profile, /readStudentProfileRecord\(user\.id\)/);
  assert.match(profile, /\.from\("profiles"\)[\s\S]*\.eq\("id", userId\)/);

  // Perfil: a linha de profiles vai ao banco junto com o menu, nao depois dele.
  const profilePage = read("src/app/perfil/page.tsx");
  assert.match(profilePage, /const \[shellData, profile\] = await Promise\.all\(\[getAppShellData\(user\), getStudentProfileRecord\(user\)\]\);/);
  assert.match(profilePage, /getProfilePageData\(accessPreviewMode, user, shellData\.student\.fullName, profile\)/);
  assert.doesNotMatch(functionBody(loaders, "getProfilePageData"), /getStudentProfileRecord\(/);

  // Materiais: os lotes de aulas saem em paralelo.
  const materialsLayer = read("src/server/member-area/lesson-materials.ts");
  assert.match(materialsLayer, /await Promise\.all\(batches\.map\(\(batch\) =>/);
  assert.doesNotMatch(materialsLayer, /for \([^)]*\) \{\s*const batch[^;]*;\s*const \{ data, error \} = await/);

  // Materiais: aulas liberadas da biblioteca -> leitura em lote da camada de materiais.
  const materials = functionBody(loaders, "getMaterialsPageData");
  assert.match(materials, /const targets = getStudentMaterialTargets\(library\);/);
  assert.match(materials, /listStudentLessonMaterials\(\{[\s\S]*learnerByLessonId: targets\.learnerByLessonId,[\s\S]*lessonIds: targets\.lessons\.map\(\(lesson\) => lesson\.lessonId\)/);
  assert.match(materials, /if \(!hasSupabaseConfig\(\)\)/);
  assert.match(materials, /return \{ state: "error" \};/);

  // Suporte: canal vem da configuracao da escola, nunca de texto fixo com contato inventado.
  assert.match(functionBody(loaders, "getSupportPageData"), /getMemberSupportChannels\(\[loginConfig\.form\.supportHref\]\)/);
  assert.deepEqual([...support.MEMBER_SUPPORT_CHANNELS], []);
});

test("componentes das paginas: cliente so onde ha filtro ou botao, sem a biblioteca inteira", () => {
  const files = [
    "continue-watching-view.tsx",
    "journey-view.tsx",
    "materials-browser.tsx",
    "materials-view.tsx",
    "profile-sign-out-button.tsx",
    "profile-view.tsx",
    "support-view.tsx"
  ];
  const clientFiles = new Set(["materials-browser.tsx", "profile-sign-out-button.tsx"]);

  for (const file of files) {
    const source = read(`src/components/member/pages/${file}`);
    assert.equal(/^"use client";/m.test(source), clientFiles.has(file), `${file}: "use client" so quando precisa`);
    assert.doesNotMatch(source, /MemberLibrary\b|getMemberLibrary|platform-store/, `${file} nao recebe a biblioteca inteira`);
    assert.doesNotMatch(source, /\bmock|\bsample|exemplo\.com/i, `${file} sem dado de exemplo`);
  }

  const browser = read("src/components/member/pages/materials-browser.tsx");
  assert.match(browser, /view: StudentMaterialsView/);
  assert.match(browser, /<MemberMaterialRow className="h-full" material=\{material\} \/>/);

  const profile = read("src/components/member/pages/profile-view.tsx");
  assert.match(profile, /<MemberTabNav/);
  assert.match(profile, /\$\{MEMBER_ROUTES\.changePassword\}\?next=\$\{encodeURIComponent\(MEMBER_ROUTES\.profile\)\}/);
  assert.match(read("src/components/member/pages/profile-sign-out-button.tsx"), /signOutAndLeave\(\)/);
});

// ------------------------------------------------------------------------------------------------
// Biblioteca de exemplo (formato de src/lib/member-library.ts)
// ------------------------------------------------------------------------------------------------

const NOW = Date.parse("2026-10-11T15:00:00.000Z");

const watch = (progressPercent, lastWatchedAt, status = "in_progress", extra = {}) => ({
  lastWatchedAt,
  maxProgressPercent: progressPercent,
  progressPercent,
  progressSeconds: progressPercent * 6,
  status,
  ...extra
});

function lesson(id, contentId, moduleId, overrides = {}) {
  return {
    completed: false,
    contentId,
    duration: "10:00",
    id,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isReleaseLocked: false,
    isSaved: false,
    moduleId,
    rated: false,
    resumeImage: "",
    title: `Aula ${id}`,
    watch: null,
    ...overrides
  };
}

function courseModule(id, contentId, lessons, overrides = {}) {
  return { contentId, id, image: "", isReleaseLocked: false, isSaved: false, lessons, title: `Módulo ${id}`, ...overrides };
}

function content(id, modules, overrides = {}) {
  return {
    access: { endsAt: null, kind: "entitlement", startsAt: "2026-01-01T15:00:00.000Z" },
    childContentIds: [],
    commerceScope: "sellable_product",
    description: "",
    eyebrow: "",
    href: `/conteudo/${id}`,
    id,
    image: "",
    isReleaseLocked: false,
    isSaved: false,
    kind: "Curso",
    modules,
    title: `Curso ${id}`,
    ...overrides
  };
}

function buildLibrary() {
  const cursoA = content("curso-a", [
    courseModule("m1", "curso-a", [
      lesson("a1", "curso-a", "m1", { completed: true, rated: true, watch: watch(100, "2026-10-09T10:00:00.000Z", "completed") }),
      lesson("a2", "curso-a", "m1", { watch: watch(40, "2026-10-10T15:00:00.000Z", "in_progress", { durationSeconds: 600 }) }),
      lesson("a3", "curso-a", "m1"),
      lesson("a4", "curso-a", "m1", { image: "", isReleaseLocked: true, releaseLabel: "Liberação em 20/10/2026" })
    ])
  ], { title: "Curso de Prompts" });
  const interno = content("interno-1", [
    courseModule("mi", "interno-1", [
      lesson("i1", "interno-1", "mi", { completed: true, watch: watch(100, "2026-10-01T10:00:00.000Z", "completed") }),
      lesson("i2", "interno-1", "mi", { completed: true, watch: watch(100, "2026-10-02T10:00:00.000Z", "completed") })
    ])
  ], { commerceScope: "included_content", parentContentId: "formacao-1", title: "Curso interno" });
  const formacao = content("formacao-1", [], { childContentIds: ["interno-1"], kind: "Formacao", title: "Formação em IA" });
  const novo = content("curso-novo", [
    courseModule("mn", "curso-novo", [lesson("n1", "curso-novo", "mn"), lesson("n2", "curso-novo", "mn")])
  ], {
    access: { endsAt: "2026-10-20T12:00:00.000Z", kind: "entitlement", startsAt: "2026-09-01T12:00:00.000Z" },
    title: "Curso novo"
  });
  const bloqueado = content("curso-bloqueado", [
    courseModule("mb", "curso-bloqueado", [lesson("b1", "curso-bloqueado", "mb", { isReleaseLocked: true, releaseLabel: "Liberação em 08/11/2026" })], {
      isReleaseLocked: true,
      releaseLabel: "Liberação em 08/11/2026"
    })
  ], { isReleaseLocked: true, releaseLabel: "Liberação em 08/11/2026", title: "Bootcamp fechado" });
  const gratis = content("gratis", [courseModule("mg", "gratis", [lesson("g1", "gratis", "mg")])], {
    access: { endsAt: null, kind: "free", startsAt: null },
    title: "Aula aberta"
  });

  return { contents: [cursoA, formacao, interno, novo, bloqueado, gratis], userId: "aluno-1" };
}

test("jornada: numeros, ordem dos cursos e proximo passo vem do progresso do proprio aluno", () => {
  const view = model.buildJourneyView(buildLibrary(), NOW);

  assert.equal(view.stats.completedLessons, 3);
  assert.equal(view.stats.totalLessons, 10);
  assert.equal(view.stats.totalContents, 5, "curso interno conta dentro da formação");
  assert.equal(view.stats.inProgressContents, 1);
  assert.equal(view.stats.completedContents, 1);
  assert.equal(view.stats.lastActivityAt, "2026-10-10T15:00:00.000Z");
  assert.equal(view.stats.lastActivityLabel, "ontem");

  // Em andamento primeiro, depois não iniciados (ordem do produtor), depois concluídos.
  assert.deepEqual(view.products.map((product) => product.id), ["curso-a", "curso-novo", "gratis", "curso-bloqueado", "formacao-1"]);

  const cursoA = view.products[0];
  assert.equal(cursoA.percent, 25);
  assert.equal(cursoA.statusLabel, "Em andamento");
  assert.deepEqual(cursoA.resume, { href: "/conteudo/curso-a/aulas/m1?lessonId=a2", label: "Continuar", lessonTitle: "Aula a2" });
  assert.equal(cursoA.lockedLessons, 1);
  assert.equal(cursoA.nextReleaseLabel, "Liberação em 20/10/2026");
  assert.equal(cursoA.lastActivityLabel, "Última aula ontem");

  assert.equal(view.products[1].resume.label, "Começar");
  const bloqueado = view.products.find((product) => product.id === "curso-bloqueado");
  assert.equal(bloqueado.resume, null);
  assert.equal(bloqueado.nextReleaseLabel, "Liberação em 08/11/2026");

  const formacao = view.products.find((product) => product.id === "formacao-1");
  assert.equal(formacao.status, "completed");
  assert.equal(formacao.resume.label, "Revisar");
  assert.equal(formacao.resume.href, "/conteudo/interno-1/aulas/mi?lessonId=i1");
  assert.equal(formacao.kindLabel, "Formação");

  assert.deepEqual(view.primaryAction, { href: "/conteudo/curso-a/aulas/m1?lessonId=a2", label: "Continuar de onde parei" });
  assert.equal(view.continueWatchingTotal, 1);
  assert.equal(view.continueWatching[0].thumbnailLabel, "faltam 6min");
  assert.equal(view.continueWatching[0].meta, "Assistida ontem");

  // Atividade: mais recente primeiro, com a formação-mãe no contexto do curso interno.
  assert.deepEqual(view.activity.map((item) => item.id), ["curso-a:a2", "curso-a:a1", "interno-1:i2", "interno-1:i1"]);
  assert.equal(view.activity[0].statusLabel, "40% assistida");
  assert.equal(view.activity[1].statusLabel, "Concluída");
  assert.equal(view.activity[2].context, "Formação em IA · Curso interno · Módulo mi");
});

test("jornada de aluno sem nada: listas vazias e nenhum numero inventado", () => {
  const view = model.buildJourneyView({ contents: [], userId: "aluno-novo" }, NOW);

  assert.deepEqual(view.products, []);
  assert.deepEqual(view.activity, []);
  assert.equal(view.primaryAction, null);
  assert.equal(view.stats.completedLessons, 0);
  assert.equal(view.stats.lastActivityLabel, "");
});

test("continue assistindo: em andamento e concluidas recentemente, sem aula bloqueada", () => {
  const library = buildLibrary();
  library.contents[0].modules[0].lessons[3].watch = watch(30, "2026-10-11T14:00:00.000Z");
  const view = model.buildContinueWatchingView(library, NOW);

  assert.deepEqual(view.inProgress.map((card) => card.id), ["curso-a:a2"]);
  assert.equal(view.inProgress[0].progressPercent, 40);
  assert.equal(view.inProgress[0].context, "Curso de Prompts · Módulo m1");
  assert.deepEqual(view.recentlyCompleted.map((card) => card.id), ["curso-a:a1", "interno-1:i2", "interno-1:i1"]);
  assert.ok(view.recentlyCompleted.every((card) => card.progressPercent === 100 && card.thumbnailLabel === "Concluída"));
  assert.equal(view.recentlyCompleted[1].context, "Formação em IA · Curso interno · Módulo mi");
  assert.ok(view.recentlyCompleted.length <= model.RECENTLY_COMPLETED_LIMIT);
});

test("materiais: so aulas liberadas entram na leitura, com o estado do aluno para a regra extra", () => {
  const targets = model.getStudentMaterialTargets(buildLibrary());
  const ids = targets.lessons.map((target) => target.lessonId);

  assert.deepEqual(ids, ["a1", "a2", "a3", "i1", "i2", "n1", "n2", "g1"]);
  assert.ok(!ids.includes("a4"), "aula a liberar fica fora");
  assert.ok(!ids.includes("b1"), "conteudo a liberar fica fora");
  assert.deepEqual(targets.learnerByLessonId.get("a1"), { maxProgressPercent: 100, rated: true });
  assert.deepEqual(targets.learnerByLessonId.get("a3"), { maxProgressPercent: 0, rated: false });
  const internal = targets.lessons.find((target) => target.lessonId === "i1");
  assert.equal(internal.productId, "formacao-1");
  assert.equal(internal.productTitle, "Formação em IA");
  assert.equal(internal.context, "Curso interno · Módulo mi");
  assert.equal(internal.href, "/conteudo/interno-1/aulas/mi?lessonId=i1");

  const preview = model.getStudentMaterialTargets({ ...buildLibrary(), accessPreviewMode: "producer" });
  assert.match(preview.lessons[0].href, /accessPreview=producer$/);
});

const material = (overrides = {}) => ({
  description: "",
  fileType: "pdf",
  generatedByAi: false,
  id: "mat",
  lessonId: "a1",
  locked: false,
  sizeBytes: 1000,
  sortOrder: 0,
  title: "Material",
  typeLabel: "PDF",
  unlockThreshold: null,
  url: "https://cdn.escola.com.br/a.pdf",
  ...overrides
});

test("materiais: agrupa por curso e aula, descarta aula fora da lista e nunca leva endereco bloqueado", () => {
  const targets = model.getStudentMaterialTargets(buildLibrary());
  const view = model.buildStudentMaterialsView(targets, [
    material({ id: "m-a1", lessonId: "a1", title: "Prompt base" }),
    material({ id: "m-a1b", lessonId: "a1", fileType: "spreadsheet", title: "Planilha de apoio", typeLabel: "Planilha" }),
    material({ id: "m-a2", lessonId: "a2", lockMessage: "Avalie esta aula para liberar", lockReason: "lesson_rated", locked: true, title: "Resumo", url: "https://vazou.com/x.pdf" }),
    material({ id: "m-i1", lessonId: "i1", fileType: "link", title: "Guia", typeLabel: "Link" }),
    material({ id: "m-a4", lessonId: "a4", title: "De aula bloqueada" })
  ]);

  assert.equal(view.total, 4);
  assert.equal(view.lockedCount, 1);
  assert.deepEqual(view.groups.map((group) => group.id), ["curso-a", "formacao-1"]);
  assert.deepEqual(view.groups[0].lessons.map((item) => item.id), ["a1", "a2"]);
  const locked = view.groups[0].lessons[1].materials[0];
  assert.equal(locked.locked, true);
  assert.equal("url" in locked, false, "material bloqueado sem endereco");
  assert.equal(view.groups[0].lessons[0].materials[0].url, "https://cdn.escola.com.br/a.pdf");
  assert.ok(!JSON.stringify(view).includes("De aula bloqueada"));
  assert.deepEqual(view.types.map((type) => type.id), ["pdf", "link", "spreadsheet"]);
  assert.equal(model.formatMaterialsSummary(view), "4 materiais · 1 para liberar");

  // Filtro e busca do navegador: por curso, por tipo e sem acento.
  const all = materialsFilter.ALL_MATERIALS_FILTER;
  const byProduct = materialsFilter.filterMaterialGroups(view.groups, { productId: "formacao-1", query: "", type: all });
  assert.deepEqual(byProduct.map((group) => group.id), ["formacao-1"]);
  const byType = materialsFilter.filterMaterialGroups(view.groups, { productId: all, query: "", type: "spreadsheet" });
  assert.equal(byType.length, 1);
  assert.equal(byType[0].total, 1);
  assert.equal(materialsFilter.filterMaterialGroups(view.groups, { productId: all, query: "PLANÍLHA", type: all })[0].lessons[0].materials[0].id, "m-a1b");
  const byLesson = materialsFilter.filterMaterialGroups(view.groups, { productId: all, query: "aula a1", type: all });
  assert.equal(byLesson[0].lessons[0].materials.length, 2, "buscar a aula mostra todos os materiais dela");
  assert.deepEqual(materialsFilter.filterMaterialGroups(view.groups, { productId: all, query: "nada disso", type: all }), []);
});

test("perfil: acessos com inicio, fim, vitalicio, gratuito e previa; dados so com foto https", () => {
  const accesses = model.buildProfileAccesses(buildLibrary(), NOW);

  assert.deepEqual(accesses.map((access) => access.id), ["curso-a", "formacao-1", "curso-novo", "curso-bloqueado", "gratis"]);
  assert.equal(accesses[0].sinceLabel, "Desde 01/01/2026");
  assert.equal(accesses[0].durationLabel, "Acesso vitalício");
  assert.equal(accesses[0].statusLabel, "Ativo");
  const ending = accesses.find((access) => access.id === "curso-novo");
  assert.equal(ending.durationLabel, "Acesso até 20/10/2026");
  assert.equal(ending.endsSoon, true);
  assert.equal(ending.endsSoonLabel, "Termina em 9 dias");
  const free = accesses.find((access) => access.id === "gratis");
  assert.equal(free.statusLabel, "Gratuito");
  assert.equal(free.sinceLabel, "");

  const previewLibrary = buildLibrary();
  previewLibrary.contents[0].access = { endsAt: null, kind: "preview", startsAt: null };
  assert.equal(model.buildProfileAccesses(previewLibrary, NOW)[0].statusLabel, "Prévia");

  // Acesso so pelo cadastro antigo (sem datas conhecidas): "Ativo", sem prometer "vitalício".
  const legacyLibrary = buildLibrary();
  legacyLibrary.contents[0].access = { endsAt: null, kind: "entitlement", startsAt: null };
  const legacy = model.buildProfileAccesses(legacyLibrary, NOW)[0];
  assert.equal(legacy.statusLabel, "Ativo");
  assert.equal(legacy.durationLabel, "");
  assert.equal(legacy.sinceLabel, "");
  assert.equal(legacy.endsSoon, false);

  const details = model.buildProfileDetails({
    account: { createdAt: "2026-01-01T15:00:00.000Z", email: "aluno@escola.com.br", lastSignInAt: "2026-10-11T17:30:00.000Z" },
    displayName: "Maria Souza",
    profile: { avatarUrl: "http://inseguro.com/foto.png", phone: " +55 11 99999-8888 " }
  });
  assert.deepEqual(details, {
    avatarUrl: null,
    email: "aluno@escola.com.br",
    fullName: "Maria Souza",
    lastSignInLabel: "11/10/2026 às 14:30",
    memberSinceLabel: "01/01/2026",
    phone: "+55 11 99999-8888"
  });
  assert.equal(model.sanitizeProfileAvatarUrl("https://lh3.googleusercontent.com/a/foto"), "https://lh3.googleusercontent.com/a/foto");
  assert.equal(model.sanitizeProfileAvatarUrl("javascript:alert(1)"), null);
  assert.equal(model.sanitizeProfileAvatarUrl("https://user:senha@site.com/foto.png"), null);
  assert.equal(model.normalizeProfileTab("acessos"), "acessos");
  assert.equal(model.normalizeProfileTab(["seguranca"]), "seguranca");
  assert.equal(model.normalizeProfileTab("qualquer"), "dados");
});

test("suporte: e-mail, WhatsApp e pagina de ajuda; links inseguros sao ignorados", () => {
  const email = support.parseMemberSupportChannel("mailto:suporte@escola.com.br");
  assert.equal(email.kind, "email");
  assert.equal(email.display, "suporte@escola.com.br");
  assert.equal(email.opensNewTab, false);

  const whatsapp = support.parseMemberSupportChannel("https://wa.me/5511999998888?text=Oi");
  assert.equal(whatsapp.kind, "whatsapp");
  assert.equal(whatsapp.display, "+55 11 99999-8888");
  assert.equal(whatsapp.opensNewTab, true);
  assert.equal(support.parseMemberSupportChannel("https://api.whatsapp.com/send?phone=551133334444").display, "+55 11 3333-4444");

  const help = support.parseMemberSupportChannel("https://www.ajuda.escola.com.br/central");
  assert.equal(help.kind, "help_center");
  assert.equal(help.display, "ajuda.escola.com.br");

  for (const unsafe of ["javascript:alert(1)", "http://escola.com.br", "data:text/html,oi", "https://user:pass@escola.com.br", "", null, "mailto:nao-e-email"]) {
    assert.equal(support.parseMemberSupportChannel(unsafe), null, `${unsafe} ignorado`);
  }

  const channels = support.getMemberSupportChannels(
    ["https://wa.me/5511999998888", "javascript:alert(1)", null],
    ["mailto:suporte@escola.com.br", "https://wa.me/5511999998888"]
  );
  assert.deepEqual(channels.map((channel) => channel.kind), ["whatsapp", "email"]);
  assert.deepEqual(support.getMemberSupportChannels([null]), []);

  // Perguntas frequentes: links internos e texto em portugues com acento.
  assert.ok(support.MEMBER_SUPPORT_FAQ.length >= 5);
  for (const item of support.MEMBER_SUPPORT_FAQ) {
    assert.ok(item.question && item.answer);
    if (item.link) assert.match(item.link.href, /^\/[a-z-]/);
  }
  assert.ok(support.MEMBER_SUPPORT_FAQ.some((item) => item.question.includes("Liberação em")));
});
