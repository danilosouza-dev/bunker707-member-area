import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Progresso do produto no card da home: a mesma conta do modal (media dos modulos; modulo = progresso
// gravado ou fracao de aulas concluidas), aplicada aos itens da home no servidor.

const progress = await import("../src/lib/course-progress.ts");

test("progresso do produto: media dos modulos, aulas concluidas quando nao ha progresso gravado, gravado sem modulos", () => {
  const moduleOf = (value, lessons) => ({ lessons, progress: value });
  assert.equal(progress.getCourseProgressFromModules([moduleOf(84, [{ completed: false }])], 0), 84, "1 modulo, 1 aula em 84%");
  assert.equal(progress.getCourseProgressFromModules([moduleOf(100, [{ completed: true }]), moduleOf(0, [{ completed: false }, { completed: false }])], 0), 50);
  assert.equal(progress.getCourseProgressFromModules([moduleOf(0, [{ completed: true }, { completed: false }, { completed: false }, { completed: false }])], 0), 25, "sem progresso gravado, conta as aulas concluidas");
  assert.equal(progress.getCourseProgressFromModules([], 37), 37, "sem modulos vale o gravado no produto");
  assert.equal(progress.getCourseProgressFromModules([], 140), 100);
  assert.equal(progress.getModuleProgress(moduleOf(Number.NaN, [])), 0);
  assert.equal(progress.getCompletedLessonsCount(moduleOf(0, [{ completed: true }, {}, { completed: true }])), 2);
});

test("a home aplica o progresso do aluno aos itens das fileiras e o modal usa a mesma conta", async () => {
  const store = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
  const modal = await readFile(new URL("../src/components/content-details-modal.tsx", import.meta.url), "utf8");

  assert.match(store, /import \{ getCourseProgressFromModules \} from "@\/lib\/course-progress";/);
  assert.match(store, /function withStudentProgress\(row: HomeRow, structures: Record<string, ContentModalStructure>\): HomeRow/);
  assert.match(store, /progress: getCourseProgressFromModules\(structures\[item\.id\]\?\.modules \?\? \[\], item\.progress\)/);
  assert.match(store, /homeRows: homeRows\.map\(\(row\) => withStudentProgress\(row, modalStructures\)\)/);
  assert.match(modal, /import \{ clampProgress, getCompletedLessonsCount, getCourseProgressFromModules, getModuleProgress \} from "@\/lib\/course-progress";/);
  assert.doesNotMatch(modal, /^function getCourseProgressFromModules/m, "o modal nao tem mais a conta propria");
});
