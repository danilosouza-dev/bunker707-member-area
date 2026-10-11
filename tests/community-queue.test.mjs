import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunidade v1 (fase 1, frente D): mapeadores puros (linha do banco/RPC -> DTO) e regras das telas
// (fila, moderacao, denuncias, aulas, regras). Sem banco e sem React.

const mappers = await import("../src/server/community/mappers.ts");
const hrefs = await import("../src/components/admin/v2/community/hrefs.ts");
const queue = await import("../src/components/admin/v2/community/queue-model.ts");
const moderation = await import("../src/components/admin/v2/community/moderation-model.ts");
const stats = await import("../src/components/admin/v2/community/stats-model.ts");
const lessonRows = await import("../src/components/admin/v2/community/lesson-rows-model.ts");
const reports = await import("../src/components/admin/v2/community/report-model.ts");
const rules = await import("../src/components/admin/v2/community/rules-model.ts");
const { PRODUCT_ACCENTS } = await import("../src/server/catalog/model.ts");

const now = new Date("2026-10-10T12:00:00Z");

function commentRow(overrides = {}) {
  return {
    author_avatar_url: null,
    author_id: "11111111-1111-4111-8111-111111111111",
    author_name: "Helena Prado",
    author_role: "student",
    body: "A memória some quando reinicio. Preciso de banco?",
    content_id: "formacao-agentes",
    created_at: "2026-10-08T08:00:00Z",
    id: "22222222-2222-4222-8222-222222222222",
    lesson_id: "lesson-memoria",
    parent_comment_id: null,
    resolved_at: null,
    status: "approved",
    ...overrides
  };
}

const pathSources = {
  lessons: [
    { id: "lesson-memoria", module_id: "module-3", title: "Memória de longo prazo" },
    { id: "lesson-solta", module_id: "module-sem-dono", title: "Aula solta" }
  ],
  modules: [
    { id: "module-3", owner_id: "curso-agentes", title: "Módulo 3" },
    { id: "module-sem-dono", owner_id: null, title: "  " }
  ],
  products: [
    { id: "curso-agentes", title: "Agentes de IA" },
    { id: "formacao-agentes", title: "Formação Agentes" }
  ],
  settings: [{ content_id: "curso-agentes", settings: { accent: "roxo" } }]
};

/* ================================================================================================
 * Mapeadores
 * ============================================================================================== */

test("caminho da aula usa o produto dono do modulo e monta os links do admin e do aluno", () => {
  const resolve = mappers.createLessonPathResolver(pathSources);
  const path = resolve("formacao-agentes", "lesson-memoria");

  assert.equal(path.label, "Agentes de IA › Módulo 3 › Memória de longo prazo");
  assert.equal(path.productId, "curso-agentes");
  assert.equal(path.contentId, "formacao-agentes", "a aula abre pelo produto em que o aluno comentou");
  assert.equal(path.productAccent, "roxo");
  assert.equal(path.adminHref, "/admin/produtos/curso-agentes?aula=lesson-memoria");
  assert.equal(path.studentHref, "/conteudo/formacao-agentes/aulas/module-3?lessonId=lesson-memoria");

  const loose = resolve("formacao-agentes", "lesson-solta");
  assert.equal(loose.productId, "formacao-agentes", "modulo sem dono cai no produto do comentario");
  assert.equal(loose.label, "Formação Agentes › Aula solta", "sem partes vazias no caminho");
  assert.ok(Object.hasOwn(PRODUCT_ACCENTS, loose.productAccent), "cor calculada quando o produto nao tem uma");

  const gone = resolve("produto-x", "lesson-apagada");
  assert.equal(gone.lessonTitle, "Aula removida");
  assert.equal(gone.productTitle, "Produto removido");
  assert.equal(gone.studentHref, null, "sem modulo conhecido nao ha link para o aluno");

  const fromLessonsTab = resolve("", "lesson-memoria");
  assert.equal(fromLessonsTab.contentId, "curso-agentes", "sem comentario de contexto, abre pelo dono");
});

test("ids a ler para os caminhos incluem os donos dos modulos", () => {
  assert.deepEqual(
    mappers.collectProductIds(["formacao-agentes", "formacao-agentes"], pathSources.modules).sort(),
    ["curso-agentes", "formacao-agentes"]
  );
  assert.equal(mappers.buildLessonPathLabel({ lessonTitle: " Aula ", moduleTitle: null, productTitle: "Curso" }), "Curso › Aula");
});

test("linha do banco vira item da fila com iniciais, atraso e respostas de colegas", () => {
  const resolve = mappers.createLessonPathResolver(pathSources);
  const item = mappers.toQueueItem(commentRow(), {
    now,
    path: resolve("formacao-agentes", "lesson-memoria"),
    reactionCount: 4,
    replies: [commentRow({ author_name: "bruno", body: "Também quero saber", created_at: "2026-10-09T10:00:00Z", id: "r1", parent_comment_id: "x" })],
    reportCount: 0
  });

  assert.equal(item.author.initials, "HP");
  assert.equal(item.author.name, "Helena Prado");
  assert.equal(item.isOverdue, true, "52 h esperando passa de 24 h");
  assert.equal(item.reactionCount, 4);
  assert.equal(item.path.label, "Agentes de IA › Módulo 3 › Memória de longo prazo");
  assert.deepEqual(
    item.studentReplies.map((reply) => [reply.author.initials, reply.body]),
    [["B", "Também quero saber"]]
  );

  const fresh = mappers.toQueueItem(commentRow({ created_at: "2026-10-10T10:00:00Z" }), {
    now,
    path: item.path,
    reactionCount: 0,
    replies: [],
    reportCount: 0
  });
  assert.equal(fresh.isOverdue, false);
});

test("iniciais e autor nunca ficam vazios", () => {
  assert.equal(mappers.communityInitials("Helena Prado"), "HP");
  assert.equal(mappers.communityInitials("  ana  maria  da silva "), "AS");
  assert.equal(mappers.communityInitials("ana"), "A");
  assert.equal(mappers.communityInitials("   "), "?");
  assert.equal(mappers.communityInitials("élida"), "É");

  const anonymous = mappers.toCommunityAuthor({ author_avatar_url: "  ", author_id: null, author_name: "  " });
  assert.deepEqual(anonymous, { avatarUrl: null, id: null, initials: "A", name: "Aluno" });
});

test("item da aba Comentarios separa comentario de resposta e so raiz tem 'respondido'", () => {
  const path = mappers.createLessonPathResolver(pathSources)("formacao-agentes", "lesson-memoria");
  const root = mappers.toCommentListItem(commentRow({ resolved_at: "2026-10-09T00:00:00Z", status: "hidden" }), {
    answered: true,
    parentAuthorName: null,
    path,
    reactionCount: 1,
    reportCount: 2
  });
  const reply = mappers.toCommentListItem(commentRow({ id: "r1", parent_comment_id: "p1" }), {
    answered: true,
    parentAuthorName: " ",
    path,
    reactionCount: 0,
    reportCount: 0
  });

  assert.equal(root.kind, "comment");
  assert.equal(root.answered, true);
  assert.equal(root.resolved, true);
  assert.equal(root.statusLabel, "Oculto");
  assert.equal(root.parentAuthorName, null);
  assert.equal(reply.kind, "reply");
  assert.equal(reply.answered, false, "resposta nao tem 'respondido'");
  assert.equal(reply.parentAuthorName, "Comentário original");
});

test("numeros do topo: contagens do banco, mediana ausente fica null e idade da mais antiga", () => {
  const result = mappers.toCommunityStats(
    {
      comments_in_window: "212",
      median_response_hours: null,
      oldest_unanswered_at: "2026-10-08T08:00:00Z",
      open_reports: 1,
      p90_response_hours: "31.4",
      unanswered: "8"
    },
    28,
    now
  );

  assert.deepEqual(result, {
    commentsInWindow: 212,
    medianResponseHours: null,
    oldestUnansweredHours: 52,
    openReports: 1,
    p90ResponseHours: 31.4,
    unanswered: 8,
    windowDays: 28
  });
  assert.deepEqual(mappers.toCommunityStats(null, 28, now), {
    commentsInWindow: 0,
    medianResponseHours: null,
    oldestUnansweredHours: null,
    openReports: 0,
    p90ResponseHours: null,
    unanswered: 0,
    windowDays: 28
  });
  assert.equal(mappers.toCount("abc"), 0);
  assert.equal(mappers.toCount(-3), 0);
  assert.equal(mappers.toNullableNumber(""), null);
  assert.equal(mappers.toNullableNumber("0"), 0);
});

test("denuncia aberta: comentario visivel denunciado depois da ultima moderacao", () => {
  assert.equal(mappers.isReportOpen({ lastActionAt: null, lastReportedAt: "2026-10-10T10:00:00Z", status: "approved" }), true);
  assert.equal(
    mappers.isReportOpen({ lastActionAt: "2026-10-10T11:00:00Z", lastReportedAt: "2026-10-10T10:00:00Z", status: "approved" }),
    false,
    "mantido visivel depois da denuncia"
  );
  assert.equal(
    mappers.isReportOpen({ lastActionAt: "2026-10-09T11:00:00Z", lastReportedAt: "2026-10-10T10:00:00Z", status: "approved" }),
    true,
    "denuncia nova depois da ultima acao reabre"
  );
  assert.equal(mappers.isReportOpen({ lastActionAt: null, lastReportedAt: "2026-10-10T10:00:00Z", status: "hidden" }), false);
  assert.equal(mappers.isReportOpen({ lastActionAt: null, lastReportedAt: null, status: "approved" }), false);
});

test("motivos de denuncia agrupados e historico do mais novo para o mais antigo", () => {
  assert.deepEqual(
    mappers.summarizeReportReasons([{ reason: "Spam" }, { reason: " Spam " }, { reason: null }, { reason: "Ofensivo" }]),
    ["Spam (2)", "Ofensivo", "Sem motivo informado"]
  );

  const history = mappers.toReportHistory(
    [
      { action: "hidden", actor_id: "a1", comment_id: "c", created_at: "2026-10-09T10:00:00Z", note: " " },
      { action: "restored", actor_id: "a2", comment_id: "c", created_at: "2026-10-10T10:00:00Z", note: "Era ironia" }
    ],
    new Map([["a1", "Danilo"]])
  );

  assert.deepEqual(history, [
    { action: "restored", actorName: null, createdAt: "2026-10-10T10:00:00Z", note: "Era ironia" },
    { action: "hidden", actorName: "Danilo", createdAt: "2026-10-09T10:00:00Z", note: null }
  ]);
  assert.equal(reports.describeReportResolution(history, now), "Resolvida: comentário restaurado, há 2 h");
  assert.equal(reports.describeReportResolution(history.slice(1), now), "Resolvida: comentário ocultado por Danilo, há 26 h");
  assert.equal(reports.describeReportResolution([], now), null);
});

test("top alunos e linha da aba Aulas a partir das RPCs", () => {
  const top = mappers.toTopCommenter({
    author_avatar_url: null,
    author_id: "u1",
    author_name: "Carla Mendes",
    comments: "5",
    reactions_received: 7,
    replies_to_peers: 2,
    score: null
  });
  assert.equal(top.score, 14, "sem pontos da RPC, soma as tres partes");
  assert.equal(top.author.initials, "CM");

  const path = mappers.createLessonPathResolver(pathSources)("", "lesson-memoria");
  const row = mappers.toLessonCommunityRow(
    { comments: 12, lesson_id: "lesson-memoria", liked: "10", loved: 25, not_for_me: 5, total_count: 3, tutor_questions: "4", unanswered: 1 },
    path
  );
  assert.deepEqual(row.ratings, { balance: 0.5, liked: 10, loved: 25, notForMe: 5, total: 40 });
  assert.equal(row.tutorQuestions, 4);
});

test("opcoes de filtro: formacao entra como produto e aulas com nome repetido ganham o produto", () => {
  const options = mappers.buildFilterOptions([
    { formation_id: "formacao-agentes", formation_title: "Formação Agentes", lesson_id: "l1", lesson_title: "Boas-vindas", product_id: "curso-a", product_title: "Curso A" },
    { formation_id: null, formation_title: null, lesson_id: "l2", lesson_title: "Boas-vindas", product_id: "curso-b", product_title: "Curso B" },
    { formation_id: null, formation_title: null, lesson_id: "l3", lesson_title: "Prompts", product_id: "curso-b", product_title: "Curso B" }
  ]);

  assert.deepEqual(
    options.products.map((product) => product.label),
    ["Curso A", "Curso B", "Formação Agentes"]
  );
  assert.deepEqual(
    options.lessons.map((lesson) => lesson.label),
    ["Boas-vindas · Curso A", "Boas-vindas · Curso B", "Prompts"]
  );
  assert.deepEqual(
    mappers.lessonsForProduct(options.lessons, "formacao-agentes").map((lesson) => lesson.id),
    ["l1"],
    "filtrar pela formacao mostra as aulas dos cursos dela"
  );
  assert.equal(mappers.lessonsForProduct(options.lessons, null).length, 3);
});

test("pagina e janela das listas", () => {
  assert.equal(mappers.pageOffset(1, 20), 0);
  assert.equal(mappers.pageOffset(3, 20), 40);
  assert.equal(mappers.pageOffset(0, 20), 0);
  assert.equal(mappers.listWindowSince({ explicit: false, since: "2026-10-04T03:00:00.000Z" }), null, "sem periodo explicito a fila mostra tudo");
  assert.equal(mappers.listWindowSince({ explicit: true, since: "2026-10-04T03:00:00.000Z" }), "2026-10-04T03:00:00.000Z");
});

/* ================================================================================================
 * Enderecos e numeros do topo
 * ============================================================================================== */

test("enderecos dos filtros voltam para a pagina 1 e apagam valores vazios", () => {
  assert.equal(hrefs.communityHref("/admin/comunidade", { pagina: "3", produto: "a" }, { aula: "l1" }), "/admin/comunidade?produto=a&aula=l1");
  assert.equal(hrefs.communityHref("/admin/comunidade", { pagina: "3", produto: "a" }, { pagina: 4 }), "/admin/comunidade?pagina=4&produto=a");
  assert.equal(hrefs.communityHref("/admin/comunidade", { pagina: "3", produto: "a" }, { pagina: 1 }), "/admin/comunidade?produto=a");
  assert.equal(hrefs.communityHref("/admin/comunidade", { produto: "a" }, { produto: null }), "/admin/comunidade");
  assert.equal(hrefs.clearFiltersHref("/admin/comunidade/comentarios", { busca: "x", periodo: "7" }), "/admin/comunidade/comentarios?periodo=7");
  assert.equal(hrefs.hasActiveFilters({ busca: "", produto: undefined }, ["busca", "produto"]), false);
  assert.equal(hrefs.hasActiveFilters({ situacao: "spam" }, ["situacao"]), true);
  // Alunos v2 ainda nao existe: "Ver aluno" abre a lista do admin antigo com a busca preenchida.
  assert.equal(hrefs.studentSearchHref(" Ana Souza "), "/admin/legado?tela=alunos&busca=Ana+Souza");
});

test("faixa da paginacao em pt-BR", () => {
  assert.deepEqual(hrefs.describePageRange(2, 20, 54), { from: 21, hasNext: true, hasPrevious: true, label: "21–40 de 54", lastPage: 3, page: 2, to: 40 });
  assert.equal(hrefs.describePageRange(9, 20, 54).page, 3, "pagina alem do fim cai na ultima");
  assert.equal(hrefs.describePageRange(1, 20, 0).label, "0 de 0");
  assert.equal(hrefs.describePageRange(1, 20, 1234).label, "1–20 de 1.234");
  assert.equal(hrefs.plural(1, "reação", "reações"), "1 reação");
  assert.equal(hrefs.plural(1200, "reação", "reações"), "1.200 reações");
});

test("quatro numeros do topo: '—' sem dado e alerta so quando passa da meta", () => {
  const empty = stats.buildCommunityStatCells({
    commentsInWindow: 0,
    medianResponseHours: null,
    oldestUnansweredHours: null,
    openReports: 0,
    p90ResponseHours: null,
    unanswered: 0,
    windowDays: 28
  });

  assert.deepEqual(
    empty.map((cell) => [cell.label, cell.value, cell.sub, cell.subTone]),
    [
      ["Sem resposta", "0", "nenhuma esperando", undefined],
      ["Resposta mediana", "—", "sem respostas em 28 dias · meta abaixo de 24 h", undefined],
      ["Comentários", "0", "últimos 28 dias", undefined],
      ["Denúncias", "0", "nenhuma aberta", undefined]
    ]
  );

  const busy = stats.buildCommunityStatCells({
    commentsInWindow: 212,
    medianResponseHours: 30,
    oldestUnansweredHours: 52.4,
    openReports: 1,
    p90ResponseHours: 31,
    unanswered: 8,
    windowDays: 28
  });

  assert.deepEqual(
    busy.map((cell) => [cell.value, cell.sub, cell.subTone]),
    [
      ["8", "a mais antiga há 52 h", "warning"],
      ["30 h", "p90 31 h · meta abaixo de 24 h", "warning"],
      ["212", "últimos 28 dias", undefined],
      ["1", "aberta", undefined]
    ]
  );
  assert.ok(busy.every((cell) => cell.formula.length > 20), "toda metrica tem formula ao passar o mouse");
});

/* ================================================================================================
 * Fila
 * ============================================================================================== */

test("atalhos da fila: J/K navegam, R responde, nada enquanto digita ou com modificador", () => {
  const key = (value, extra = {}) =>
    queue.queueKeyCommand({ altKey: false, ctrlKey: false, key: value, metaKey: false, targetIsEditable: false, ...extra });

  assert.equal(key("j"), "next");
  assert.equal(key("K"), "previous");
  assert.equal(key("r"), "reply");
  assert.equal(key("x"), null);
  assert.equal(key("j", { targetIsEditable: true }), null);
  assert.equal(key("r", { metaKey: true }), null, "Cmd+R recarrega a pagina, nao responde");
  assert.equal(key("k", { ctrlKey: true }), null);
});

test("navegacao e foco depois de tirar uma pergunta da lista", () => {
  assert.equal(queue.moveQueueIndex(-1, 3, "next"), 0, "sem item ativo comeca do primeiro");
  assert.equal(queue.moveQueueIndex(2, 3, "next"), 2, "nao passa do fim");
  assert.equal(queue.moveQueueIndex(0, 3, "previous"), 0);
  assert.equal(queue.moveQueueIndex(1, 3, "previous"), 0);
  assert.equal(queue.moveQueueIndex(0, 0, "next"), -1);

  assert.equal(queue.focusAfterRemoval(["a", "b", "c"], "b"), "c");
  assert.equal(queue.focusAfterRemoval(["a", "b", "c"], "c"), "b");
  assert.equal(queue.focusAfterRemoval(["a"], "a"), null);
  assert.equal(queue.focusAfterRemoval(["a"], "z"), null);
});

test("resposta rapida entra no rascunho sem apagar o que ja foi escrito", () => {
  assert.equal(queue.insertQuickReply("", "Oi, Ana!"), "Oi, Ana!");
  assert.equal(queue.insertQuickReply("   ", "Oi, Ana!"), "Oi, Ana!");
  assert.equal(queue.insertQuickReply("Boa pergunta.  \n", "Veja o minuto 3."), "Boa pergunta.\n\nVeja o minuto 3.");
});

/* ================================================================================================
 * Moderacao
 * ============================================================================================== */

test("acoes da linha conforme a situacao do comentario (no maximo duas)", () => {
  const labels = (status) => moderation.rowModerationActions(status).map((action) => `${action.label}:${action.status}`);

  assert.deepEqual(labels("approved"), ["Ocultar:hidden", "Spam:spam"]);
  assert.deepEqual(labels("pending"), ["Aprovar:approved", "Ocultar:hidden"]);
  assert.deepEqual(labels("hidden"), ["Restaurar:approved"]);
  assert.deepEqual(labels("spam"), ["Restaurar:approved"]);
});

test("avisos da moderacao no singular, no plural e quando parte falhou", () => {
  assert.equal(moderation.moderationToastMessage("hidden", 1), "Comentário ocultado");
  assert.equal(moderation.moderationToastMessage("spam", 3), "3 comentários marcados como spam");
  assert.equal(moderation.moderationToastMessage("approved", 2), "2 comentários visíveis de novo");
  assert.equal(moderation.bulkFailureMessage(0), null);
  assert.match(moderation.bulkFailureMessage(1), /^1 comentário não pôde ser alterado/);
  assert.match(moderation.bulkFailureMessage(4), /^4 comentários não puderam ser alterados/);
});

test("desfazer volta cada comentario para a situacao anterior, agrupado, sem 'aguardando'", () => {
  const groups = moderation.undoGroups(
    new Map([
      ["a", "approved"],
      ["b", "hidden"],
      ["c", "approved"],
      ["d", "pending"]
    ]),
    ["a", "b", "c", "d", "e"]
  );

  assert.deepEqual(groups, [
    { ids: ["a", "c"], status: "approved" },
    { ids: ["b"], status: "hidden" }
  ]);
  assert.deepEqual(moderation.undoGroups({ a: "spam" }, ["a"]), [{ ids: ["a"], status: "spam" }]);
});

test("selecao em massa: marcar todos respeita o limite e a selecao segue a pagina", () => {
  const empty = new Set();
  const page = ["a", "b", "c"];

  assert.deepEqual([...moderation.toggleSelected(empty, "a")], ["a"]);
  assert.deepEqual([...moderation.toggleSelected(new Set(["a"]), "a")], []);
  assert.deepEqual([...moderation.toggleAllSelected(empty, page, 50)], ["a", "b", "c"]);
  assert.deepEqual([...moderation.toggleAllSelected(new Set(page), page, 50)], [], "tudo marcado desmarca a pagina");
  assert.deepEqual([...moderation.toggleAllSelected(new Set(["a"]), page, 2)], ["a", "b"], "nunca passa do limite");
  assert.equal(moderation.selectionState(empty, page), "none");
  assert.equal(moderation.selectionState(new Set(["a"]), page), "some");
  assert.equal(moderation.selectionState(new Set(page), page), "all");

  const selected = new Set(["a", "b"]);
  assert.equal(moderation.pruneSelection(selected, page), selected, "sem mudanca devolve o mesmo conjunto");
  assert.deepEqual([...moderation.pruneSelection(selected, ["b", "c"])], ["b"]);
});

/* ================================================================================================
 * Aulas e Regras
 * ============================================================================================== */

test("barra de avaliacao soma 100 % e o saldo so ganha cor com respostas suficientes", () => {
  const parts = lessonRows.ratingSegments({ liked: 1, loved: 1, notForMe: 1 });
  assert.deepEqual(parts.map((part) => [part.label, part.percent]), [["Não gostei", 34], ["Gostei", 33], ["Amei", 33]]);
  assert.equal(parts.reduce((sum, part) => sum + part.percent, 0), 100);
  assert.deepEqual(lessonRows.ratingSegments({ liked: 10, loved: 25, notForMe: 5 }).map((part) => part.percent), [13, 25, 62]);
  assert.deepEqual(lessonRows.ratingSegments({ liked: 0, loved: 0, notForMe: 0 }).map((part) => part.percent), [0, 0, 0]);

  assert.equal(lessonRows.ratingTone(null, 0), "none");
  assert.equal(lessonRows.ratingTone(-0.8, 19), "insufficient");
  assert.equal(lessonRows.ratingTone(-0.3, 20), "negative");
  assert.equal(lessonRows.ratingTone(0.05, 40), "neutral");
  assert.equal(lessonRows.ratingTone(0.5, 40), "positive");

  assert.equal(lessonRows.describeRatings({ liked: 0, loved: 0, notForMe: 0 }), "Sem avaliações");
  assert.equal(lessonRows.describeRatings({ liked: 10, loved: 25, notForMe: 5 }), "Não gostei 5, Gostei 10, Amei 25 (40 respostas)");
  assert.deepEqual(
    lessonRows.LESSON_ROWS_SORT_OPTIONS.map((option) => option.value),
    [null, "piores", "melhores"]
  );
});

test("regras: marcador no cursor, contagem de palavras e termo repetido sem acento", () => {
  assert.deepEqual(rules.insertAtCursor("Oi, !", "{nome}", 4, 4), { cursor: 10, value: "Oi, {nome}!" });
  assert.deepEqual(rules.insertAtCursor("Oi, XX!", "{nome}", 4, 6), { cursor: 10, value: "Oi, {nome}!" });
  assert.deepEqual(rules.insertAtCursor("abc", "{aula}", 99, 99), { cursor: 9, value: "abc{aula}" });

  assert.equal(rules.describeBlockedWordCount([]), "Nenhuma palavra");
  assert.equal(rules.describeBlockedWordCount([{ active: true }]), "1 ativa");
  assert.equal(rules.describeBlockedWordCount([{ active: true }, { active: false }, { active: true }]), "2 ativas de 3");

  const words = [{ word: "Link na Bio" }, { word: "promoção" }];
  assert.equal(rules.isDuplicateBlockedTerm("  link   na bio ", words), true);
  assert.equal(rules.isDuplicateBlockedTerm("PROMOCAO", words), true);
  assert.equal(rules.isDuplicateBlockedTerm("grupo vip", words), false);
  assert.equal(rules.isDuplicateBlockedTerm("!!!", words), false);
});
