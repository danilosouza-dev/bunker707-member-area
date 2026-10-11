import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Aba Conteudo do produto (docs/17 §1.6.3 e §1.6.4): regras puras da arvore, da colagem de aulas,
// do rascunho do painel e da fila de gravacoes. Nada aqui depende de React nem do banco.

const tree = await import("../src/components/admin/v2/content/tree-model.ts");
const paste = await import("../src/components/admin/v2/content/lesson-paste.ts");
const draftModel = await import("../src/components/admin/v2/content/lesson-draft.ts");
const store = await import("../src/components/admin/v2/content/tree-store.ts");

const NOW = "2026-10-10T12:00:00.000Z";
const LATER = "2026-10-10T12:05:00.000Z";

function lesson(id, moduleId, extra = {}) {
  return {
    durationLabel: null,
    id,
    moduleId,
    position: 0,
    release: { mode: "immediate" },
    releaseLabel: "Libera na hora",
    status: "published",
    title: `Aula ${id}`,
    updatedAt: NOW,
    video: null,
    ...extra
  };
}

function module(id, lessonIds, extra = {}) {
  return {
    id,
    lessons: lessonIds.map((lessonId) => lesson(lessonId, id)),
    position: 0,
    release: { mode: "immediate" },
    releaseLabel: "Libera na hora",
    title: `Módulo ${id}`,
    updatedAt: NOW,
    ...extra
  };
}

function shape(value) {
  return value.map((item) => `${item.id}:${item.lessons.map((entry) => entry.id).join(",")}`);
}

const base = tree.toTree([module("m1", ["a", "b", "c"]), module("m2", ["d"]), module("m3", [])]);

test("toTree numera modulos e aulas e mantem o moduleId coerente", () => {
  assert.deepEqual(base.map((item) => item.position), [1, 2, 3]);
  assert.deepEqual(base[0].lessons.map((item) => item.position), [1, 2, 3]);
  assert.equal(base[1].lessons[0].moduleId, "m2");
  assert.deepEqual(tree.countTree(base), { lessons: 4, modules: 3, publishedLessons: 4 });
});

test("arrastar aula antes/depois de outra, para o comeco e para o fim de um modulo", () => {
  assert.deepEqual(shape(tree.moveLesson(base, "c", { kind: "before", lessonId: "a" })), ["m1:c,a,b", "m2:d", "m3:"]);
  assert.deepEqual(shape(tree.moveLesson(base, "a", { kind: "after", lessonId: "d" })), ["m1:b,c", "m2:d,a", "m3:"]);
  assert.deepEqual(shape(tree.moveLesson(base, "b", { kind: "end", moduleId: "m3" })), ["m1:a,c", "m2:d", "m3:b"]);
  assert.deepEqual(shape(tree.moveLesson(base, "d", { kind: "start", moduleId: "m1" })), ["m1:d,a,b,c", "m2:", "m3:"]);

  const moved = tree.moveLesson(base, "a", { kind: "after", lessonId: "d" });
  const movedLesson = moved[1].lessons[1];
  assert.equal(movedLesson.moduleId, "m2", "aula muda de modulo");
  assert.equal(movedLesson.position, 2);
  assert.deepEqual(moved[0].lessons.map((item) => item.position), [1, 2], "o modulo de origem e renumerado");

  assert.equal(tree.moveLesson(base, "a", { kind: "before", lessonId: "b" }), null, "mesma posicao nao gera gravacao");
  assert.equal(tree.moveLesson(base, "a", { kind: "before", lessonId: "a" }), null);
  assert.equal(tree.moveLesson(base, "x", { kind: "end", moduleId: "m1" }), null);
  assert.equal(tree.moveLesson(base, "a", { kind: "end", moduleId: "nao-existe" }), null);
});

test("Alt+setas: troca com a vizinha e atravessa modulos nas pontas", () => {
  assert.deepEqual(shape(tree.moveLessonByStep(base, "b", -1)), ["m1:b,a,c", "m2:d", "m3:"]);
  assert.deepEqual(shape(tree.moveLessonByStep(base, "b", 1)), ["m1:a,c,b", "m2:d", "m3:"]);
  assert.deepEqual(shape(tree.moveLessonByStep(base, "c", 1)), ["m1:a,b", "m2:c,d", "m3:"], "desce para o comeco do proximo");
  assert.deepEqual(shape(tree.moveLessonByStep(base, "d", -1)), ["m1:a,b,c,d", "m2:", "m3:"], "sobe para o fim do anterior");
  assert.deepEqual(shape(tree.moveLessonByStep(base, "d", 1)), ["m1:a,b,c", "m2:", "m3:d"], "entra em modulo vazio");
  assert.equal(tree.moveLessonByStep(base, "a", -1), null, "primeira aula da arvore nao sobe");

  assert.deepEqual(shape(tree.moveModuleByStep(base, "m2", -1)), ["m2:d", "m1:a,b,c", "m3:"]);
  assert.deepEqual(shape(tree.moveModuleByStep(base, "m2", 1)), ["m1:a,b,c", "m3:", "m2:d"]);
  assert.equal(tree.moveModuleByStep(base, "m1", -1), null);
  assert.equal(tree.moveModuleByStep(base, "m3", 1), null);
});

test("arrastar modulo inteiro e 'Mover para…' com varias aulas", () => {
  assert.deepEqual(shape(tree.moveModule(base, "m3", { kind: "before", moduleId: "m1" })), ["m3:", "m1:a,b,c", "m2:d"]);
  assert.equal(tree.moveModule(base, "m1", { kind: "before", moduleId: "m2" }), null);

  const moved = tree.moveLessonsToModule(base, ["c", "a"], "m3");
  assert.deepEqual(shape(moved), ["m1:b", "m2:d", "m3:a,c"], "vai para o fim, na ordem da arvore");
  assert.equal(tree.moveLessonsToModule(base, ["d"], "m2"), null, "ja esta no fim do modulo");
  assert.equal(tree.moveLessonsToModule(base, ["a"], "nao-existe"), null);
});

test("ordem completa para reorderContent pula provisorias e traduz ids criados", () => {
  const tempLesson = { ...lesson(tree.makeTempId("lesson"), "m2"), pending: true };
  const withTemp = tree.appendLessons(base, "m2", [tempLesson]);

  assert.deepEqual(tree.buildReorderInput("p1", withTemp), {
    modules: [
      { id: "m1", lessonIds: ["a", "b", "c"] },
      { id: "m2", lessonIds: ["d"] },
      { id: "m3", lessonIds: [] }
    ],
    productId: "p1"
  });

  const ids = store.createIdMap(tree.isTempId);
  ids.set(tempLesson.id, "lesson-real");
  assert.deepEqual(tree.buildReorderInput("p1", withTemp, ids.resolve).modules[1], { id: "m2", lessonIds: ["d", "lesson-real"] });

  ids.fail(tempLesson.id);
  assert.deepEqual(tree.buildReorderInput("p1", withTemp, ids.resolve).modules[1], { id: "m2", lessonIds: ["d"] });
});

test("excluir some na hora e Desfazer devolve cada aula ao lugar de antes", () => {
  const { removed, tree: without } = tree.removeLessons(base, ["b", "d"]);

  assert.deepEqual(shape(without), ["m1:a,c", "m2:", "m3:"]);
  assert.deepEqual(removed.map((item) => [item.lesson.id, item.moduleId, item.index]), [["b", "m1", 1], ["d", "m2", 0]]);

  const restored = tree.restoreLessons(without, removed);
  assert.deepEqual(shape(restored), shape(base));
  assert.deepEqual(restored[0].lessons.map((item) => item.position), [1, 2, 3]);

  const { removed: removedModule, tree: noModule } = tree.removeModule(base, "m1");
  assert.deepEqual(shape(noModule), ["m2:d", "m3:"]);
  assert.deepEqual(shape(tree.restoreModule(noModule, removedModule)), shape(base));
  assert.deepEqual(shape(tree.restoreModule(base, removedModule)), shape(base), "restaurar duas vezes nao duplica");
});

test("linhas provisorias viram as aulas criadas, na ordem, e falhas saem da arvore", () => {
  const first = tree.makeTempId("lesson");
  const second = tree.makeTempId("lesson");
  assert.notEqual(first, second);
  assert.equal(tree.isTempId(first), true);
  assert.equal(tree.isTempId("lesson-abc"), false);

  const pending = tree.appendLessons(base, "m3", [
    { ...lesson(first, "m3"), pending: true },
    { ...lesson(second, "m3"), pending: true }
  ]);
  const resolved = tree.resolveTempLessons(pending, [first, second], [lesson("x1", "m3"), lesson("x2", "m3")]);
  assert.deepEqual(shape(resolved), ["m1:a,b,c", "m2:d", "m3:x1,x2"]);
  assert.equal(resolved[2].lessons.some((item) => item.pending), false);

  const skipped = tree.resolveTempLessons(pending, [first, second], [lesson("x1", "m3")]);
  assert.deepEqual(shape(skipped), ["m1:a,b,c", "m2:d", "m3:x1"], "linha que o servidor pulou some");

  assert.deepEqual(shape(tree.dropTempItems(pending, [first, second])), shape(base));

  const tempModuleId = tree.makeTempId("module");
  const withModule = tree.appendModule(base, { ...module(tempModuleId, []), pending: true });
  const realModule = tree.resolveTempModule(withModule, tempModuleId, module("m4", [], { title: "Prática", updatedAt: LATER }));
  assert.equal(realModule[3].id, "m4");
  assert.equal(realModule[3].title, "Prática");
  assert.equal(realModule[3].pending, false);
});

test("salvar no painel atualiza a linha sem mudar o lugar; status em massa tem volta", () => {
  const updated = tree.applyLessonUpdate(base, { ...lesson("b", "m9"), position: 9, title: "Novo nome", updatedAt: LATER });
  assert.equal(updated[0].lessons[1].title, "Novo nome");
  assert.equal(updated[0].lessons[1].moduleId, "m1");
  assert.equal(updated[0].lessons[1].position, 2);

  const before = tree.pickLessonStatuses(base, ["a", "d"]);
  const drafted = tree.setLessonStatuses(base, new Map([["a", "draft"], ["d", "draft"]]));
  assert.deepEqual(tree.countTree(drafted).publishedLessons, 2);
  assert.deepEqual(tree.countTree(tree.setLessonStatuses(drafted, before)).publishedLessons, 4);
});

test("datas novas da reordenacao entram sem desfazer a ordem local", () => {
  const local = tree.moveLessonByStep(base, "a", 1);
  const merged = tree.mergeServerTimestamps(local, [module("m1", ["a", "b", "c"], { updatedAt: LATER })].map((item) => ({
    ...item,
    lessons: item.lessons.map((entry) => ({ ...entry, updatedAt: LATER }))
  })));

  assert.deepEqual(shape(merged), shape(local));
  assert.equal(merged[0].updatedAt, LATER);
  assert.equal(merged[0].lessons.every((item) => item.updatedAt === LATER), true);
  assert.equal(merged[1].updatedAt, NOW, "modulo que o servidor nao devolveu fica como estava");

  assert.equal(tree.latestTimestamp(NOW, LATER), LATER);
  assert.equal(tree.latestTimestamp(LATER, NOW), LATER);
  assert.equal(tree.latestTimestamp(null, NOW), NOW);
});

test("navegacao do painel, rotulo de posicao e selecao valida", () => {
  assert.deepEqual(tree.neighborLessonIds(base, "c"), { next: "d", previous: "b" });
  assert.deepEqual(tree.neighborLessonIds(base, "a"), { next: "b", previous: null });
  assert.equal(tree.lessonPositionLabel(base, "b"), "Módulo 1, aula 2 de 3");
  assert.equal(tree.describeLessonPlace(base, "d"), "Aula 1 de 1 no Módulo 2");
  assert.deepEqual(tree.pruneSelection(base, new Set(["d", "nao-existe", "a"])), ["a", "d"]);
});

test("lista de cursos da formacao reordena por arrastar e por Alt+setas", () => {
  const items = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];

  assert.deepEqual(tree.moveListItem(items, "c3", { id: "c1", kind: "before" }).map((item) => item.id), ["c3", "c1", "c2"]);
  assert.equal(tree.moveListItem(items, "c1", { id: "c2", kind: "before" }), null);
  assert.deepEqual(tree.moveListItemByStep(items, "c2", 1).map((item) => item.id), ["c1", "c3", "c2"]);
  assert.equal(tree.moveListItemByStep(items, "c1", -1), null);
});

test("colar varias linhas cria varias aulas; link desconhecido e recusado", () => {
  const plan = paste.planLessonInput([
    "Boas-vindas",
    "https://youtu.be/dQw4w9WgXcQ",
    "Ferramentas | https://vimeo.com/123456789",
    "https://www.loom.com/share/abc",
    "   "
  ].join("\n"));

  assert.deepEqual(plan.items.map((item) => [item.title, item.video?.provider ?? null]), [
    ["Boas-vindas", null],
    ["", "youtube"],
    ["Ferramentas", "vimeo"]
  ]);
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0].message, /Não reconhecemos este link/);
  assert.equal(plan.truncated, 0);

  const many = paste.planLessonInput(Array.from({ length: 5 }, (_, index) => `Aula ${index + 1}`).join("\n"), 3);
  assert.equal(many.items.length, 3);
  assert.equal(many.truncated, 2);

  assert.equal(paste.isMultiLinePaste("a\n\nb"), true);
  assert.equal(paste.isMultiLinePaste("a\n  \n"), false);
  assert.equal(paste.isSingleVideoPaste("https://youtu.be/dQw4w9WgXcQ"), true);
  assert.equal(paste.isSingleVideoPaste("Aula sobre prompts"), false);
});

test("o campo de nova aula mostra o provedor reconhecido ou o erro na hora", () => {
  assert.deepEqual(paste.describeLessonInput(""), { kind: "hint" });
  assert.deepEqual(paste.describeLessonInput("Primeiro prompt"), { kind: "hint" });

  const youtube = paste.describeLessonInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(youtube.kind, "video");
  assert.equal(youtube.label, "YouTube");
  assert.equal(youtube.notice, "YouTube — a logo e o título do YouTube aparecem no player.");

  const bunny = paste.describeLessonInput("Setup | https://iframe.mediadelivery.net/embed/12345/0f4d7c5e-1234-4abc-9def-0123456789ab");
  assert.equal(bunny.kind, "video");
  assert.equal(bunny.tone, "neutral");

  assert.equal(paste.describeLessonInput("http://youtu.be/dQw4w9WgXcQ").kind, "error");

  assert.equal(
    paste.describeCreationResult({ created: 3, rejected: 1, skipped: 0, truncated: 0 }),
    "3 aulas criadas · 1 link não reconhecido"
  );
  assert.equal(paste.describeCreationResult({ created: 1, rejected: 0, skipped: 0, truncated: 2 }), "1 aula criada · 2 linhas ficaram de fora (limite de 100 por vez)");
  assert.equal(paste.provisionalLessonTitle({ title: " Setup ", video: null }), "Setup");
  assert.equal(paste.provisionalLessonTitle({ title: "", video: { label: "YouTube", provider: "youtube" } }), "Lendo o título do vídeo…");
});

function editorLesson(extra = {}) {
  return {
    ...lesson("a", "m1"),
    description: "",
    durationLabel: "12:40",
    thumbnailUrl: null,
    videoConfig: { assetId: "dQw4w9WgXcQ", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    videoInput: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ...extra
  };
}

test("painel da aula manda so o que mudou e video vazio remove o video", () => {
  const baseline = draftModel.draftFromLesson(editorLesson());
  assert.equal(draftModel.isDraftDirty(baseline, { ...baseline, title: " Aula a " }), false, "espacos nas pontas nao contam");

  const draft = { ...baseline, release: { amount: 7, mode: "after_access", unit: "dias" }, status: "draft", title: "Boas-vindas", videoInput: "" };
  assert.deepEqual(draftModel.changedFields(baseline, draft).sort(), ["release", "status", "title", "videoInput"]);

  assert.deepEqual(draftModel.buildLessonUpdate({ baseline, draft, expectedUpdatedAt: NOW, id: "a" }), {
    allowEmbedCode: false,
    expectedUpdatedAt: NOW,
    id: "a",
    release: { amount: 7, mode: "after_access", unit: "dias" },
    status: "draft",
    title: "Boas-vindas",
    videoInput: null
  });

  assert.equal(draftModel.draftFromLesson(editorLesson({ videoConfig: { provider: "embed_code", url: "https://x.example/e" } })).allowEmbedCode, true);
});

test("leitura nova do servidor nao apaga o que o produtor esta digitando", () => {
  const oldBaseline = draftModel.draftFromLesson(editorLesson());
  const typed = { ...oldBaseline, description: "Texto novo" };
  const server = { ...oldBaseline, status: "draft", title: "Renomeada em outro lugar" };
  const rebased = draftModel.rebaseDraft(oldBaseline, server, typed);

  assert.equal(rebased.description, "Texto novo", "o que foi digitado fica");
  assert.equal(rebased.status, "draft", "o que mudou no servidor e nao foi mexido entra");
  assert.equal(rebased.title, "Renomeada em outro lugar");
  assert.deepEqual(draftModel.changedFields(server, rebased), ["description"], "salvar depois nao desfaz o status publicado em massa");
});

test("validacao do painel: nome, link e liberacao, com as mensagens do produtor", () => {
  const baseline = draftModel.draftFromLesson(editorLesson());
  assert.deepEqual(draftModel.validateLessonDraft(baseline), {});

  const errors = draftModel.validateLessonDraft({
    ...baseline,
    release: { amount: 0, mode: "after_access", unit: "dias" },
    title: "   ",
    videoInput: "https://www.loom.com/share/abc"
  });
  assert.equal(errors.title, "Dê um nome.");
  assert.match(errors.videoInput, /Não reconhecemos este link/);
  assert.equal(errors.release, "Use pelo menos 1.");

  assert.deepEqual(
    draftModel.validateLessonDraft({ ...baseline, allowEmbedCode: true, videoInput: '<iframe src="https://player.exemplo.com/v/1"></iframe>' }),
    {},
    "Outro provedor aceita codigo de incorporacao de host desconhecido"
  );

  assert.equal(draftModel.shouldAdoptSuggestedTitle(""), true);
  assert.equal(draftModel.shouldAdoptSuggestedTitle("Aula 3"), true);
  assert.equal(draftModel.shouldAdoptSuggestedTitle("Boas-vindas"), false);
});

test("estado da transcricao e do Tutor IA em frases do produtor", () => {
  assert.deepEqual(draftModel.describeTranscript(null), { label: "Sem transcrição", tone: "muted" });

  const ready = {
    chunkCount: 12,
    createdAt: "2026-09-12T15:00:00.000Z",
    errorMessage: null,
    format: "vtt",
    language: "pt-BR",
    profileStatus: "waiting_provider",
    source: "upload",
    sourceVideoId: null,
    status: "ready",
    transcriptId: "t1",
    version: 2
  };
  assert.deepEqual(draftModel.describeTranscript(ready), { label: "Gerada em 12/09", tone: "success" });
  assert.equal(draftModel.describeTranscript({ ...ready, status: "processing" }).tone, "warning");
  assert.match(draftModel.describeTutorReadiness(ready), /Configurações › Tutor IA/);
  assert.match(draftModel.describeTutorReadiness({ ...ready, profileStatus: "ready" }), /já responde/);

  assert.equal(draftModel.transcriptFormatFromFileName("aula.SRT"), "srt");
  assert.equal(draftModel.transcriptFormatFromFileName("aula.pdf"), null);
});

test("fila de gravacoes roda em ordem, nunca quebra e avisa quando esvazia", async () => {
  const queue = store.createMutationQueue();
  const order = [];
  let idleCalls = 0;
  queue.onIdle(() => {
    idleCalls += 1;
  });

  const slow = queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    order.push("criar");
    return "lesson-1";
  });
  const failing = queue.enqueue(async () => {
    order.push("falha");
    throw new Error("rede");
  });
  const after = queue.enqueue(async () => {
    order.push("reordenar");
    return "ok";
  });

  assert.equal(queue.size(), 3);
  assert.equal(queue.isIdle(), false);
  assert.equal(await slow, "lesson-1");
  assert.equal(await failing, undefined);
  assert.equal(await after, "ok");
  assert.deepEqual(order, ["criar", "falha", "reordenar"]);
  assert.equal(queue.isIdle(), true);
  assert.equal(idleCalls, 1);

  const values = store.createValueStore(1);
  let notified = 0;
  const unsubscribe = values.subscribe(() => {
    notified += 1;
  });
  values.set(1);
  values.update(() => null);
  values.update((value) => value + 1);
  unsubscribe();
  values.set(5);
  assert.equal(values.get(), 5);
  assert.equal(notified, 1);
});

test("linha criada na tela mantem a chave estavel e o campo acha o modulo pelo id provisorio", () => {
  const tempModuleId = tree.makeTempId("module");
  const withModule = tree.appendModule(base, { ...module(tempModuleId, []), clientKey: tempModuleId, pending: true });
  assert.equal(tree.resolveModuleRef(withModule, tempModuleId), tempModuleId);

  const realModule = tree.resolveTempModule(withModule, tempModuleId, module("m4", []));
  assert.equal(realModule[3].clientKey, tempModuleId, "o bloco nao remonta quando o id definitivo chega");
  assert.equal(tree.resolveModuleRef(realModule, tempModuleId), "m4", "o campo aberto antes continua achando o modulo");
  assert.equal(tree.resolveModuleRef(realModule, "m2"), "m2");
  assert.equal(tree.resolveModuleRef(realModule, "nao-existe"), null);

  const tempLessonId = tree.makeTempId("lesson");
  const pending = tree.appendLessons(realModule, "m4", [{ ...lesson(tempLessonId, "m4"), clientKey: tempLessonId, pending: true }]);
  const created = tree.resolveTempLessons(pending, [tempLessonId], [lesson("x1", "m4")]);
  assert.equal(created[3].lessons[0].id, "x1");
  assert.equal(created[3].lessons[0].clientKey, tempLessonId);

  const saved = tree.applyLessonUpdate(created, { ...lesson("x1", "m4"), title: "Novo nome" });
  assert.equal(saved[3].lessons[0].clientKey, tempLessonId, "salvar no painel nao troca a chave da linha");
});

test("lista de cursos: resposta do servidor entra sem desfazer a ordem da tela", () => {
  const course = (id, position, extra = {}) => ({ id, lessonsPublished: 0, lessonsTotal: 0, position, title: id, ...extra });
  const local = [course("c2", 1), course("c1", 2), course("c3", 3)];
  const server = [course("c1", 1, { lessonsTotal: 4 }), course("c2", 2), course("c4", 3)];
  const merged = tree.mergeCourseList(local, server);

  assert.deepEqual(merged.map((item) => item.id), ["c2", "c1", "c4"], "c3 saiu no servidor e c4 entrou no fim");
  assert.deepEqual(merged.map((item) => item.position), [1, 2, 3]);
  assert.equal(merged[1].lessonsTotal, 4, "os dados vem do servidor");

  assert.deepEqual(tree.orderListLike(server, ["c4", "c1"]).map((item) => item.id), ["c4", "c1", "c2"]);
  const renumbered = tree.renumberList(local);
  assert.equal(renumbered[0], local[0], "item que ja esta na posicao certa e reaproveitado");
  assert.deepEqual(tree.renumberList([course("a", 9), course("b", 9)]).map((item) => item.position), [1, 2]);
});

test("colagem com links nao reconhecidos devolve cada linha inteira, com o motivo, para corrigir", () => {
  const text = [
    "Boas-vindas | https://youtu.be/dQw4w9WgXcQ",
    "Ferramentas | https://www.loom.com/share/abc",
    "https://exemplo.com/video-123",
    "Encerramento"
  ].join("\n");
  const plan = paste.planLessonInput(text);

  assert.equal(plan.items.length, 2);
  assert.deepEqual(
    paste.leftoverLines(plan).map((item) => item.line),
    ["Ferramentas | https://www.loom.com/share/abc", "https://exemplo.com/video-123"],
    "a linha volta como foi colada, com o titulo"
  );
  for (const item of paste.leftoverLines(plan)) {
    assert.ok(item.message.length > 0, item.line);
  }

  // A linha devolvida, depois de corrigida, vira aula normalmente.
  const fixed = paste.planLessonInput("Ferramentas | https://vimeo.com/123456789");
  assert.deepEqual(fixed.items.map((item) => [item.title, item.video?.provider ?? null]), [["Ferramentas", "vimeo"]]);
  assert.deepEqual(paste.leftoverLines(fixed), []);
});

test("linhas alem do limite tambem voltam para a lista, e colagem sem nenhuma aula diz isso", () => {
  const plan = paste.planLessonInput(["Aula 1", "Aula 2", "Aula 3 | https://youtu.be/dQw4w9WgXcQ"].join("\n"), 1);

  assert.equal(plan.truncated, 2);
  assert.deepEqual(plan.overflow, ["Aula 2", "Aula 3 | https://youtu.be/dQw4w9WgXcQ"]);
  assert.deepEqual(
    paste.leftoverLines(plan).map((item) => item.message),
    ["Ficou de fora do limite de 100 aulas por vez.", "Ficou de fora do limite de 100 aulas por vez."]
  );

  const nothing = paste.planLessonInput(["https://www.loom.com/share/abc", "https://exemplo.com/x"].join("\n"));
  assert.equal(nothing.items.length, 0);
  assert.equal(paste.describeNothingCreated(nothing), "Nenhuma aula criada · 2 links não reconhecidos");
  assert.equal(paste.leftoverLines(nothing).length, 2);
});
