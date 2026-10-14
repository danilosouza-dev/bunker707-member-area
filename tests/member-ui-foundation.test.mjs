import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Base comum da area do aluno (rodada "aluno v2"): formatacao de datas no fuso de Sao Paulo, rotas da
// barra lateral, materiais de apoio e biblioteca do aluno (progresso dele, nunca dado inventado).

const format = await import("../src/lib/member-format.ts");
const navigation = await import("../src/lib/member-navigation.ts");
const materials = await import("../src/lib/lesson-materials.ts");
const library = await import("../src/lib/member-library.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("datas do aluno saem no fuso de Sao Paulo, nao no fuso da maquina", () => {
  // 02:30 UTC do dia 8 ainda e dia 7 em Sao Paulo (UTC-3).
  assert.equal(format.formatMemberDate("2026-01-08T02:30:00.000Z"), "07/01/2026");
  assert.equal(format.formatMemberDate("2026-01-08T15:00:00.000Z"), "08/01/2026");
  assert.equal(format.formatMemberTime("2026-01-08T15:05:00.000Z"), "12:05");
  assert.equal(format.formatMemberDateTime("2026-01-08T15:05:00.000Z"), "08/01/2026 às 12:05");
  assert.equal(format.formatMemberDate("nao e data"), "");
  assert.equal(format.formatMemberDate(null), "");
  assert.equal(format.getMemberDayKey("2026-01-08T02:30:00.000Z"), "2026-01-07");
  assert.equal(format.getMemberDayDifference("2026-01-07T23:00:00.000Z", "2026-01-08T03:30:00.000Z"), 1);
  assert.equal(format.getMemberDayDifference("2026-01-08T10:00:00.000Z", "2026-01-08T20:00:00.000Z"), 0);
});

test("tempos e contagens em portugues", () => {
  const now = Date.parse("2026-10-11T15:00:00.000Z");

  assert.equal(format.formatMemberRelativeTime("2026-10-11T14:59:40.000Z", now), "agora");
  assert.equal(format.formatMemberRelativeTime("2026-10-10T15:00:00.000Z", now), "ontem");
  assert.match(format.formatMemberRelativeTime("2026-10-11T12:00:00.000Z", now), /há 3 horas/);
  assert.equal(format.formatMemberDuration(3900), "1h 05min");
  assert.equal(format.formatMemberDuration(720), "12min");
  assert.equal(format.formatMemberDuration(-1), "");
  assert.equal(format.formatMemberRemaining(300, 1020), "faltam 12min");
  assert.equal(format.formatMemberRemaining(300, undefined), "");
  assert.equal(format.formatMemberCount(1, "aula"), "1 aula");
  assert.equal(format.formatMemberCount(3, "aula"), "3 aulas");
  assert.equal(format.formatMemberCount(2, "material", "materiais"), "2 materiais");
  assert.equal(format.clampMemberPercent(140), 100);
  assert.equal(format.clampMemberPercent(Number.NaN), 0);
});

test("barra lateral: oito destinos reais, agrupados, sem item sem pagina", () => {
  const items = navigation.MEMBER_NAVIGATION_ITEMS;

  assert.deepEqual(items.map((item) => item.href), [
    "/",
    "/minha-jornada",
    "/continue-assistindo",
    "/minhas-compras",
    "/favoritos",
    "/materiais",
    "/suporte",
    "/perfil"
  ]);
  assert.ok(items.every((item) => item.href && item.label && item.description));
  assert.deepEqual(navigation.MEMBER_NAVIGATION_GROUPS.map((group) => group.label), ["Estudar", "Conta e ajuda"]);
  assert.deepEqual([...navigation.MEMBER_NEW_PAGE_PREFIXES], ["/minha-jornada", "/continue-assistindo", "/materiais", "/suporte", "/perfil"]);
});

test("item ativo: home so na home, demais por rota e subrota, nunca por prefixo parcial", () => {
  const active = navigation.isMemberNavigationItemActive;

  assert.equal(active("/", "/"), true);
  assert.equal(active("/", "/favoritos"), false);
  assert.equal(active("/perfil", "/perfil"), true);
  assert.equal(active("/perfil", "/perfil/acessos"), true);
  assert.equal(active("/perfil", "/perfil-x"), false);
  assert.equal(active("/minhas-compras", "/minhas-compras?accessPreview=producer"), true);
  assert.equal(navigation.getActiveMemberNavigationKey("/continue-assistindo"), "continueWatching");
  assert.equal(navigation.getActiveMemberNavigationKey("/conteudo/curso-1/aulas/modulo-1"), undefined);
});

const materialRow = (overrides = {}) => ({
  created_at: "2026-10-01T10:00:00.000Z",
  description: "Modelo pronto",
  file_size_bytes: 2_516_582,
  file_type: "pdf",
  file_url: "https://cdn.exemplo.com/materiais/prompt.pdf",
  generated_by_ai: false,
  id: "mat-1",
  lesson_id: "aula-1",
  sort_order: 0,
  status: "published",
  title: "Prompt base",
  unlock_rule: "none",
  unlock_threshold: null,
  ...overrides
});

test("material bloqueado pela regra extra nunca leva o endereco do arquivo", () => {
  const notRated = { maxProgressPercent: 10, rated: false };
  const rated = { maxProgressPercent: 10, rated: true };

  const locked = materials.toStudentLessonMaterial(materialRow({ unlock_rule: "lesson_rated" }), notRated);
  assert.equal(locked.locked, true);
  assert.equal(locked.url, undefined);
  assert.equal(locked.lockMessage, "Avalie esta aula para liberar");

  const open = materials.toStudentLessonMaterial(materialRow({ unlock_rule: "lesson_rated" }), rated);
  assert.equal(open.locked, false);
  assert.equal(open.url, "https://cdn.exemplo.com/materiais/prompt.pdf");
  assert.equal(open.typeLabel, "PDF");

  const progressLocked = materials.toStudentLessonMaterial(materialRow({ unlock_rule: "lesson_progress", unlock_threshold: 30 }), notRated);
  assert.equal(progressLocked.locked, true);
  assert.equal(progressLocked.url, undefined);
  assert.equal(progressLocked.lockMessage, "Assista 30% da aula para liberar");
  assert.equal(
    materials.toStudentLessonMaterial(materialRow({ unlock_rule: "lesson_progress", unlock_threshold: 30 }), { maxProgressPercent: 30, rated: false }).locked,
    false
  );
});

test("material: so https publicado aparece; tipo e tamanho legiveis", () => {
  const learner = { maxProgressPercent: 0, rated: false };

  assert.equal(materials.toStudentLessonMaterial(materialRow({ file_url: "http://inseguro.com/a.pdf" }), learner), null);
  assert.equal(materials.toStudentLessonMaterial(materialRow({ file_url: "https://user:pass@site.com/a.pdf" }), learner), null);
  assert.equal(materials.toStudentLessonMaterial(materialRow({ status: "draft" }), learner), null);
  assert.equal(materials.toStudentLessonMaterial(materialRow({ title: "   " }), learner), null);
  assert.equal(materials.resolveLessonMaterialFileType("other", "https://x.com/planilha.xlsx"), "spreadsheet");
  assert.equal(materials.resolveLessonMaterialFileType(null, "https://notion.so/pagina"), "link");
  assert.equal(materials.resolveLessonMaterialFileType("presentation", "https://x.com/a.pdf"), "presentation");
  assert.equal(materials.formatLessonMaterialSize(2_516_582), "2,4 MB");
  assert.equal(materials.formatLessonMaterialSize(840_000), "820 KB");
  assert.equal(materials.formatLessonMaterialSize(null), "");
});

test("migracao de materiais: RLS ligada, sem acesso direto do aluno, so https e idempotente", () => {
  const path = "supabase/migrations/202610130001_lesson_materials.sql";
  assert.ok(existsSync(new URL(`../${path}`, import.meta.url)));
  const sql = read(path);

  assert.match(sql, /create table if not exists public\.lesson_materials/);
  assert.match(sql, /references public\.lessons\(id\) on delete cascade/);
  assert.match(sql, /alter table public\.lesson_materials enable row level security;/);
  assert.match(sql, /revoke all on public\.lesson_materials from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /file_url ~ '\^https:\/\//);
  assert.match(sql, /create index if not exists lesson_materials_lesson_order_idx/);
  assert.match(sql, /drop trigger if exists set_lesson_materials_updated_at/);
  assert.doesNotMatch(sql, /insert into public\.lesson_materials/i);
});

test("leitura de materiais: banco sem a migracao vira vazio honesto, nao erro", () => {
  const source = read("src/server/member-area/lesson-materials.ts");

  assert.match(source, /import "server-only";/);
  assert.match(source, /isMissingSchemaObjectError\(error\)/);
  assert.match(source, /return \{ available: false, materials: \[\] \}/);
  assert.match(source, /\.eq\("status", "published"\)/);
  assert.match(source, /toStudentLessonMaterial\(/);
});

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

function content(id, modules, overrides = {}) {
  return {
    access: { endsAt: null, kind: "entitlement", startsAt: "2026-01-01T12:00:00.000Z" },
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
    title: `Conteudo ${id}`,
    ...overrides
  };
}

const watch = (progressPercent, lastWatchedAt, status = "in_progress") => ({
  lastWatchedAt,
  maxProgressPercent: progressPercent,
  progressPercent,
  progressSeconds: progressPercent * 6,
  status
});

test("progresso do produto: aulas concluidas do proprio aluno e onde continuar", () => {
  const course = content("curso-1", [{
    contentId: "curso-1",
    id: "mod-1",
    image: "",
    isReleaseLocked: false,
    isSaved: false,
    lessons: [
      lesson("a1", { completed: true, watch: watch(100, "2026-10-01T10:00:00.000Z", "completed") }),
      lesson("a2", { watch: watch(40, "2026-10-05T10:00:00.000Z") }),
      lesson("a3"),
      lesson("a4", { isReleaseLocked: true, releaseLabel: "Liberação em 20/10/2026" })
    ],
    title: "Modulo 1"
  }]);
  const index = new Map([[course.id, course]]);
  const summary = library.summarizeMemberContentProgress(course, index);

  assert.equal(summary.totalLessons, 4);
  assert.equal(summary.completedLessons, 1);
  assert.equal(summary.lockedLessons, 1);
  assert.equal(summary.percent, 25);
  assert.equal(summary.status, "in_progress");
  assert.equal(summary.lastWatchedAt, "2026-10-05T10:00:00.000Z");
  assert.equal(summary.resume.lesson.id, "a2");
  assert.equal(summary.resume.href, "/conteudo/curso-1/aulas/mod-1?lessonId=a2");

  const fresh = content("curso-2", [{ ...course.modules[0], contentId: "curso-2", lessons: [lesson("b1", { contentId: "curso-2" })] }]);
  const freshSummary = library.summarizeMemberContentProgress(fresh, new Map([[fresh.id, fresh]]));
  assert.equal(freshSummary.status, "not_started");
  assert.equal(freshSummary.resume.lesson.id, "b1");
});

test("formacao soma as aulas dos cursos internos que o aluno pode abrir", () => {
  const internal = content("interno-1", [{
    contentId: "interno-1",
    id: "mod-i",
    image: "",
    isReleaseLocked: false,
    isSaved: false,
    lessons: [lesson("i1", { completed: true, contentId: "interno-1", moduleId: "mod-i" }), lesson("i2", { contentId: "interno-1", moduleId: "mod-i" })],
    title: "Modulo interno"
  }], { commerceScope: "included_content", parentContentId: "formacao-1" });
  const formation = content("formacao-1", [], { childContentIds: ["interno-1", "nao-existe"], kind: "Formacao" });
  const index = new Map([[formation.id, formation], [internal.id, internal]]);
  const summary = library.summarizeMemberContentProgress(formation, index, "producer");

  assert.equal(summary.totalLessons, 2);
  assert.equal(summary.completedLessons, 1);
  assert.equal(summary.percent, 50);
  assert.equal(summary.resume.href, "/conteudo/interno-1/aulas/mod-i?lessonId=i2&accessPreview=producer");
  assert.deepEqual(library.getMemberPurchasedContents({ contents: [formation, internal], userId: "u" }).map((item) => item.id), ["formacao-1"]);
});

test("continue assistindo: so aula comecada, nao concluida e liberada, da mais recente para a mais antiga", () => {
  const course = content("curso-1", [{
    contentId: "curso-1",
    id: "mod-1",
    image: "",
    isReleaseLocked: false,
    isSaved: false,
    lessons: [
      lesson("antiga", { watch: watch(30, "2026-10-01T10:00:00.000Z") }),
      lesson("recente", { watch: watch(55, "2026-10-09T10:00:00.000Z") }),
      lesson("concluida", { completed: true, watch: watch(100, "2026-10-10T10:00:00.000Z", "completed") }),
      lesson("zerada", { watch: watch(0, "2026-10-10T11:00:00.000Z") }),
      lesson("bloqueada", { isReleaseLocked: true, watch: watch(20, "2026-10-10T12:00:00.000Z") })
    ],
    title: "Modulo 1"
  }]);
  const entries = library.getMemberContinueWatching({ contents: [course], userId: "u" });

  assert.deepEqual(entries.map((entry) => entry.lesson.id), ["recente", "antiga"]);
  assert.equal(entries[0].progressPercent, 55);
  assert.equal(library.getMemberContinueWatching({ contents: [course], userId: "u" }, { limit: 1 }).length, 1);
  assert.equal(library.getMemberLessonHref("curso 1", "mod/1", "a&b"), "/conteudo/curso%201/aulas/mod%2F1?lessonId=a%26b");
});

test("biblioteca do servidor: so conteudo com acesso, progresso do aluno e nenhum dado de video", () => {
  const store = read("src/server/db/platform-store.ts");
  const start = store.indexOf("// --- Biblioteca do aluno");
  const end = store.indexOf("export async function getContentRouteParams");
  const section = store.slice(start, end);

  assert.ok(start > 0 && end > start, "secao da biblioteca existe");
  assert.match(section, /export async function getMemberLibrary\(/);
  assert.match(section, /hasPurchaseAccess\(item, accessPreviewMode, userAccessKeys\)/);
  assert.match(section, /applyLessonProgress\(database, item\.id, getModulesForContent\(database, item\), userId\)/);
  assert.match(section, /function resolveMemberLibraryRelease\(/);
  // Aula bloqueada nao usa a thumbnail do video; nenhum campo de video sai na biblioteca.
  assert.match(section, /lessonRelease\.isReleaseLocked\s*\?\s*lesson\.image \?\? ""\s*:\s*getVideoThumbnailUrl\(lesson\.video\)/);
  assert.doesNotMatch(section, /\bvideo:/);
  assert.doesNotMatch(section, /video_config|embedCode|assetId/);
});

test("componentes base do aluno existem e nao sao clientes pesados", () => {
  const files = [
    "member-avatar.tsx",
    "member-button.tsx",
    "member-chip.tsx",
    "member-empty-state.tsx",
    "member-filters.tsx",
    "member-lesson-card.tsx",
    "member-material-row.tsx",
    "member-page.tsx",
    "member-poster-card.tsx",
    "member-progress.tsx",
    "member-skeletons.tsx",
    "member-stat.tsx",
    "member-surface.tsx"
  ];

  for (const file of files) {
    const source = read(`src/components/member/ui/${file}`);
    assert.doesNotMatch(source, /^"use client";/m, `${file} funciona no servidor`);
    assert.doesNotMatch(source, /\buseState\b|\buseEffect\b/, `${file} sem estado proprio`);
  }

  const material = read("src/components/member/ui/member-material-row.tsx");
  assert.match(material, /rel="noopener noreferrer"/);
  assert.match(material, /target="_blank"/);

  const chip = read("src/components/member/ui/member-chip.tsx");
  assert.match(chip, /producer: \{ icon: GraduationCap, label: "Professor"/);
  assert.match(chip, /moderator: \{ icon: ShieldCheck, label: "Moderador"/);
  assert.match(chip, /student: \{ label: "Aluno"/);

  const skeletons = read("src/components/member/ui/member-skeletons.tsx");
  assert.doesNotMatch(skeletons, /data-route-loading/);
  assert.match(skeletons, /motion-safe:animate-pulse/);
});
