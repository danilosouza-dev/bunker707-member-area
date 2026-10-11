import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Aba Materiais da aula: dado real do banco (lesson_materials), nunca lista inventada, e so de aula que
// o aluno pode abrir (sessao + acesso + liberacao validados antes de ler os materiais).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("src/app/api/materials/lessons/[lessonId]/route.ts");
const panel = read("src/components/lesson/lesson-materials-panel.tsx");
const lesson = read("src/components/lesson-experience.tsx");
const {
  EMPTY_LESSON_MATERIAL_LEARNER_STATE,
  mergeSavedLessonMaterialLearnerState,
  shouldRefetchLessonMaterials
} = await import("../src/lib/lesson-materials.ts");

test("rota valida sessao e acesso a aula antes de ler os materiais", () => {
  const getHandler = route.slice(route.indexOf("export async function GET"));
  const sessionIndex = getHandler.indexOf("requireApiUser()");
  const accessIndex = getHandler.indexOf("await requireLessonAccess({ contentId, lessonId, userId: auth.user.id })");
  const progressIndex = getHandler.indexOf('.from("lesson_progress")');
  const materialsIndex = getHandler.indexOf("listStudentLessonMaterials({");

  assert.ok(sessionIndex >= 0 && accessIndex > sessionIndex, "sessao antes do acesso");
  assert.ok(progressIndex > accessIndex, "progresso so depois do acesso");
  assert.ok(materialsIndex > progressIndex, "materiais so depois do acesso e do progresso");
  assert.match(getHandler, /if \(auth\.response \|\| !auth\.user\) return noStore\(auth\.response!\);/);
  // Progresso do proprio aluno, so desta aula.
  assert.match(getHandler, /\.eq\("user_id", auth\.user\.id\)\s*\.eq\("content_id", contentId\)/);
  assert.match(getHandler, /learnerByLessonId: new Map\(\[\[lessonId, learner\]\]\),\s*lessonIds: \[lessonId\]/);
});

test("rota exige conteudo, nao entra em cache e devolve erros pelo mesmo tratamento", () => {
  assert.match(route, /searchParams\.get\("contentId"\)/);
  assert.match(route, /if \(!contentId \|\| !lessonId\) \{\s*return noStore\(NextResponse\.json\(\{ error: "Aula e conteúdo são obrigatórios\." \}, \{ status: 400 \}\)\);/);
  assert.match(route, /response\.headers\.set\("Cache-Control", "private, no-store, max-age=0"\)/);
  assert.match(route, /response\.headers\.set\("Vary", "Cookie"\)/);
  assert.match(route, /return noStore\(jsonRouteError\(error, "Não foi possível carregar os materiais da aula\."\)\);/);
  assert.match(route, /export const dynamic = "force-dynamic";/);
  assert.doesNotMatch(route, /return NextResponse\.json/);
});

test("pagina da aula nao tem mais a lista fixa de materiais de exemplo", () => {
  assert.doesNotMatch(lesson, /Prompt base da aula/);
  assert.doesNotMatch(lesson, /Checklist de qualidade visual/);
  assert.doesNotMatch(lesson, /const lessonMaterials = \[/);
  assert.match(lesson, /<LessonMaterialsPanel/);
  assert.match(lesson, /lockedNotice=\{activeReleaseNotice\}/);
  // Numero da aba so aparece depois de carregar (o real).
  assert.match(lesson, /count: materialsCountByLesson\[activeLessonKey\] \?\? null/);
  // Atalho de Materiais continua.
  assert.match(lesson, /aria-label="Abrir materiais"[\s\S]*?onClick=\{handleMaterialsShortcut\}/);
});

test("aba Materiais: busca real, grupos, vazio honesto, erro com nova tentativa", () => {
  assert.match(panel, /^"use client";/);
  assert.match(panel, /fetch\(`\/api\/materials\/lessons\/\$\{encodeURIComponent\(lessonId\)\}\?\$\{search\}`/);
  assert.match(panel, /cache: "no-store"/);
  assert.match(panel, /<MemberMaterialRow material=\{material\} \/>/);
  assert.match(panel, /title="Disponíveis"/);
  assert.match(panel, /title="Para liberar"/);
  assert.match(panel, /Esta aula ainda não tem materiais/);
  assert.match(panel, /Quando o professor publicar arquivos de apoio, eles aparecem aqui\./);
  assert.match(panel, /Tentar de novo/);
  assert.match(panel, /Materiais liberados junto com a aula/);
  // Aula bloqueada nao busca nada; resultado com tabela ausente mostra o mesmo vazio.
  assert.match(panel, /const needsFetch = !isLocked && shouldRefetchLessonMaterials\(/);
  assert.match(panel, /if \(!requestKey\) \{\s*return;\s*\}/);
  assert.match(panel, /!cached\.result\.available \|\| materials\.length === 0/);
  assert.doesNotMatch(panel, /mock|fixture|exemplo/i);
});

const material = (overrides = {}) => ({
  description: "",
  fileType: "pdf",
  generatedByAi: false,
  id: "m1",
  lessonId: "aula-1",
  locked: false,
  sizeBytes: null,
  sortOrder: 0,
  title: "Material",
  typeLabel: "PDF",
  unlockThreshold: null,
  ...overrides
});

test("materiais buscam de novo pelo que ja foi gravado, com o limite do proprio material", () => {
  const notRated = { maxProgressPercent: 40, rated: false };
  const byProgress = material({ id: "m-75", lockReason: "lesson_progress", locked: true, unlockThreshold: 75 });
  const byRating = material({ id: "m-avaliar", lockReason: "lesson_rated", locked: true });

  assert.equal(shouldRefetchLessonMaterials(undefined, notRated), true, "sem lista: busca");
  const cached = { fetchedWith: notRated, materials: [byProgress, byRating] };
  assert.equal(shouldRefetchLessonMaterials(cached, notRated), false, "nada novo gravado: nao busca");
  // Regra de 75%: busca aos 75% gravados (antes, as faixas de 10% so destravavam aos 80%).
  assert.equal(shouldRefetchLessonMaterials(cached, { maxProgressPercent: 74, rated: false }), false);
  assert.equal(shouldRefetchLessonMaterials(cached, { maxProgressPercent: 75, rated: false }), true);
  // Avaliacao gravada (nos dois sentidos) busca de novo.
  assert.equal(shouldRefetchLessonMaterials(cached, { maxProgressPercent: 40, rated: true }), true);
  assert.equal(
    shouldRefetchLessonMaterials({ fetchedWith: { maxProgressPercent: 40, rated: true }, materials: [] }, notRated),
    true
  );
  // Progresso subiu, mas nenhum material bloqueado por progresso ficou cumprido: nao busca.
  assert.equal(shouldRefetchLessonMaterials({ fetchedWith: notRated, materials: [byRating] }, { maxProgressPercent: 90, rated: false }), false);
  // A nova busca vira o ponto de partida: resposta ainda bloqueada nao repete a busca sem fim.
  assert.equal(
    shouldRefetchLessonMaterials({ fetchedWith: { maxProgressPercent: 75, rated: false }, materials: [byProgress] }, { maxProgressPercent: 75, rated: false }),
    false
  );
});

test("estado gravado do aluno: so sobe, aula concluida conta 100% e avaliacao so muda quando enviada", () => {
  const start = EMPTY_LESSON_MATERIAL_LEARNER_STATE;
  assert.deepEqual(start, { maxProgressPercent: 0, rated: false });
  assert.deepEqual(mergeSavedLessonMaterialLearnerState(start, { maxProgressPercent: 42, progressPercent: 30 }), { maxProgressPercent: 42, rated: false });
  assert.deepEqual(mergeSavedLessonMaterialLearnerState({ maxProgressPercent: 60, rated: true }, { progressPercent: 10 }), { maxProgressPercent: 60, rated: true });
  assert.deepEqual(mergeSavedLessonMaterialLearnerState(start, { completed: true }), { maxProgressPercent: 100, rated: false });
  assert.deepEqual(mergeSavedLessonMaterialLearnerState({ maxProgressPercent: 50, rated: true }, { rated: false }), { maxProgressPercent: 50, rated: false });
  assert.equal(mergeSavedLessonMaterialLearnerState(start, { maxProgressPercent: 180 }).maxProgressPercent, 100);
});

test("pagina da aula passa para a aba Materiais so o que o servidor confirmou", () => {
  // Nada de chave otimista por faixas de 10%.
  assert.doesNotMatch(lesson, /learnerKey=/);
  assert.doesNotMatch(lesson, /Math\.floor\(activeLessonMaxWatchedPercent \/ 10\)/);
  assert.match(lesson, /savedLearner=\{savedMaterialLearnerStates\[activeLessonKey\] \?\? EMPTY_LESSON_MATERIAL_LEARNER_STATE\}/);
  // O estado gravado so muda depois que o PUT do progresso responde ok.
  assert.match(
    lesson,
    /if \(response\.ok\) \{[\s\S]{0,200}setSavedMaterialLearnerStates\(\(current\) => applySavedProgressToLearnerStates\(current, payload\)\);\s*return true;/
  );
  assert.equal(lesson.match(/setSavedMaterialLearnerStates\(/g)?.length, 1, "nenhum outro lugar muda o estado gravado");
});
