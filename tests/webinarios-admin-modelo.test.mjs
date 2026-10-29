import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Modelo de tela do admin dos Webinarios (docs/30 §2.1 a §2.3; docs/18 §2.2): enderecos e filtros, situacoes e os
// botoes de cada uma, o menu "…", as confirmacoes, os cards do editor, o mapa dos erros para os campos, as
// conferencias de tela e a previa. Modulo puro carregado direto pelo Node.

const vm = await import("../src/server/webinars/editor-model.ts");
const model = await import("../src/server/webinars/model.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-28T15:00:00.000Z");
const iso = (value) => new Date(value).toISOString();
const UUID_A = "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const UUID_B = "1c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const both = { canPublish: true, canWrite: true };
const writeOnly = { canPublish: false, canWrite: true };

/* ------------------------------------------------------------------------------------------------
 * Enderecos e filtros (§2.1)
 * ---------------------------------------------------------------------------------------------- */

test("enderecos: aba, situacao, tipo, busca e pagina no endereco; qualquer troca volta a pagina 1 e leva o periodo", () => {
  assert.equal(vm.WEBINARS_HREF, "/admin/comunicacao/webinarios");
  assert.equal(vm.NEW_WEBINAR_HREF, "/admin/comunicacao/webinarios/novo");
  assert.equal(vm.webinarAdminHref(UUID_A), `/admin/comunicacao/webinarios/${UUID_A}`);
  assert.equal(vm.newWebinarHref("simulated"), "/admin/comunicacao/webinarios/novo?tipo=gravada");
  assert.equal(vm.newWebinarHref(null), "/admin/comunicacao/webinarios/novo");

  assert.deepEqual(vm.webinarsStateOf({}), { kind: null, page: 1, search: "", situation: null, tab: "webinarios" });
  assert.deepEqual(vm.webinarsStateOf({ aba: "ao-vivo", busca: "  agente  ", pagina: "3", situacao: "em-andamento", tipo: "gravada" }), {
    kind: "simulated",
    page: 3,
    search: "agente",
    situation: "in_progress",
    tab: "ao-vivo"
  });
  assert.deepEqual(vm.webinarsStateOf({ aba: ["gravadas", "x"], pagina: "0", situacao: "x", tipo: "x" }), { kind: null, page: 1, search: "", situation: null, tab: "gravadas" });
  assert.equal(vm.parseWebinarSearchParam("a".repeat(120)).length, 80, "a busca para em 80");

  assert.equal(vm.webinarsHref(), "/admin/comunicacao/webinarios");
  assert.equal(vm.webinarsHref({ tab: "webinarios" }), "/admin/comunicacao/webinarios", "a primeira aba e o endereco limpo");
  assert.equal(vm.webinarsHref({ kind: "live", page: 2, periodo: "7d", search: "ia", situation: "scheduled", tab: "webinarios" }), "/admin/comunicacao/webinarios?situacao=agendado&tipo=ao-vivo&busca=ia&pagina=2&periodo=7d");
  assert.equal(vm.webinarsHref({ periodo: "7d", tab: "ao-vivo" }), "/admin/comunicacao/webinarios?aba=ao-vivo&periodo=7d");

  const current = { busca: "ia", pagina: "3", periodo: "7d", situacao: "agendado", tipo: "ao-vivo" };
  assert.equal(vm.webinarsFilterHref(current, { situation: "ended" }), "/admin/comunicacao/webinarios?situacao=encerrado&tipo=ao-vivo&busca=ia&periodo=7d");
  assert.equal(vm.webinarsFilterHref(current, { kind: null }), "/admin/comunicacao/webinarios?situacao=agendado&busca=ia&periodo=7d", "clicar no tipo ativo tira o filtro");
  assert.equal(vm.webinarsFilterHref(current, { search: "" }), "/admin/comunicacao/webinarios?situacao=agendado&tipo=ao-vivo&periodo=7d");
  assert.equal(vm.webinarsFilterHref(current, { situation: null }), "/admin/comunicacao/webinarios?tipo=ao-vivo&busca=ia&periodo=7d");

  assert.equal(vm.webinarsPageFallbackHref({ itemCount: 0, page: 5, pageSize: 20, searchParams: current, total: 41 }), "/admin/comunicacao/webinarios?situacao=agendado&tipo=ao-vivo&busca=ia&pagina=3&periodo=7d");
  assert.equal(vm.webinarsPageFallbackHref({ itemCount: 0, page: 2, pageSize: 20, searchParams: {}, total: 0 }), "/admin/comunicacao/webinarios");
  assert.equal(vm.webinarsPageFallbackHref({ itemCount: 3, page: 2, pageSize: 20, searchParams: {}, total: 23 }), null);

  assert.deepEqual(
    vm.WEBINAR_SITUATION_FILTERS.map((filter) => [filter.label, filter.value]),
    [
      ["Todos", null],
      ["Rascunho", "draft"],
      ["Agendado", "scheduled"],
      ["Em andamento", "in_progress"],
      ["Encerrado", "ended"],
      ["Cancelado", "cancelled"]
    ]
  );
  assert.deepEqual(
    vm.WEBINAR_KIND_FILTERS.map((filter) => [filter.label, filter.value]),
    [
      ["Ao vivo", "live"],
      ["Gravada", "simulated"]
    ]
  );
  assert.deepEqual(
    vm.WEBINAR_LIST_TABS.map((tab) => [tab.label, tab.value]),
    [
      ["Webinários", "webinarios"],
      ["Lives ao vivo", "ao-vivo"],
      ["Lives gravadas", "gravadas"]
    ]
  );
  assert.equal(vm.hasWebinarFilters({ kind: null, search: "  ", situation: null }), false);
  assert.equal(vm.hasWebinarFilters({ kind: "live", search: "", situation: null }), true);
  assert.equal(vm.matchesWebinarSearch("Sessão de Perguntas", "sessao"), true, "sem acento acha com acento");
  assert.equal(vm.matchesWebinarSearch("Sessão de Perguntas", "resposta"), false);
  assert.equal(vm.matchesWebinarSearch("Qualquer", ""), true);
});

/* ------------------------------------------------------------------------------------------------
 * Situacoes e botoes (§2.3)
 * ---------------------------------------------------------------------------------------------- */

test("situacoes: rotulo, tom e os botoes do topo de §2.3; sem messaging.publish nao ha Publicar, Cancelar nem Excluir", () => {
  assert.deepEqual(
    model.WEBINAR_SITUATIONS.map((situation) => [situation, vm.webinarSituationLabel(situation), vm.webinarSituationTone(situation)]),
    [
      ["draft", "Rascunho", "neutral"],
      ["scheduled", "Agendado", "success"],
      ["in_progress", "Em andamento", "warning"],
      ["ended", "Encerrado", "muted"],
      ["cancelled", "Cancelado", "error"]
    ]
  );
  assert.deepEqual(vm.WEBINAR_HEADER_ACTIONS, {
    cancelled: ["duplicate"],
    draft: ["save", "publish", "delete"],
    ended: ["view_report", "publish_replay", "duplicate"],
    in_progress: ["open_console", "end"],
    scheduled: ["save", "open_room", "cancel", "duplicate"]
  });

  // Abrir e Duplicar valem em qualquer situacao (o menu "…" da lista, §2.1).
  assert.deepEqual(vm.webinarActionsFor("draft", both), ["open", "save", "publish", "delete", "duplicate"]);
  assert.deepEqual(vm.webinarActionsFor("draft", writeOnly), ["open", "save", "duplicate"]);
  assert.deepEqual(vm.webinarActionsFor("scheduled", writeOnly), ["open", "save", "open_room", "duplicate"]);
  assert.deepEqual(vm.webinarActionsFor("in_progress", writeOnly), ["open", "open_console", "duplicate"]);
  assert.deepEqual(vm.webinarActionsFor("ended", both), ["open", "view_report", "publish_replay", "duplicate"]);
  assert.deepEqual(vm.webinarActionsFor("cancelled", { canPublish: false, canWrite: false }), [], "sem messaging.write nada aparece");
});

test("menu '…' (§2.1): Abrir, Duplicar, Cancelar e Excluir (so rascunho); o que chega em outra fase vem desligado com 'em breve'", () => {
  const rows = (situation, permissions = both, exclude = []) => vm.webinarMenuEntries(situation, permissions, exclude).map((entry) => [entry.action, entry.label, entry.destructive, entry.separated, entry.soon]);

  assert.deepEqual(rows("draft"), [
    ["open", "Abrir", false, false, false],
    ["duplicate", "Duplicar", false, false, false],
    ["delete", "Excluir", true, true, false]
  ]);
  assert.deepEqual(
    rows("draft", writeOnly),
    [
      ["open", "Abrir", false, false, false],
      ["duplicate", "Duplicar", false, false, false]
    ],
    "sem messaging.publish nao exclui"
  );
  assert.deepEqual(rows("scheduled"), [
    ["open", "Abrir", false, false, false],
    ["open_room", "Abrir a sala", false, false, true],
    ["duplicate", "Duplicar", false, false, false],
    ["cancel", "Cancelar", true, true, false]
  ]);
  // Fase 2b: Abrir o console, Encerrar live e Ver relatório valem; Abrir a sala e Publicar replay seguem "em breve".
  assert.deepEqual(rows("in_progress"), [
    ["open", "Abrir", false, false, false],
    ["open_console", "Abrir o console", false, false, false],
    ["duplicate", "Duplicar", false, false, false],
    ["end", "Encerrar live", true, true, false]
  ]);
  assert.deepEqual(rows("ended"), [
    ["open", "Abrir", false, false, false],
    ["view_report", "Ver relatório", false, false, false],
    ["publish_replay", "Publicar replay", false, false, true],
    ["duplicate", "Duplicar", false, false, false]
  ]);
  assert.deepEqual([...vm.WEBINAR_SOON_ACTIONS], ["open_room", "publish_replay"]);
  assert.deepEqual([...vm.WEBINAR_LINK_ACTIONS], ["open", "open_console", "view_report"]);
  assert.equal(vm.webinarActionHref("open_console", "abc"), "/admin/comunicacao/webinarios/abc/sala");
  assert.equal(vm.webinarActionHref("view_report", "abc"), "/admin/comunicacao/webinarios/abc/relatorio");
  assert.equal(vm.webinarActionHref("end", "abc"), null);
  assert.equal(vm.webinarConsoleHref("abc", "s1"), "/admin/comunicacao/webinarios/abc/sala?sessao=s1");
  assert.deepEqual(rows("cancelled"), [
    ["open", "Abrir", false, false, false],
    ["duplicate", "Duplicar", false, false, false]
  ]);
  assert.deepEqual(
    rows("scheduled", both, ["open", ...vm.WEBINAR_SOON_ACTIONS]).map((row) => row[0]),
    ["duplicate", "cancel"],
    "no editor, Abrir e os botoes do topo ficam fora do menu"
  );

  assert.equal(vm.webinarActionNeedsConfirm("cancel"), true);
  assert.equal(vm.webinarActionNeedsConfirm("delete"), true);
  assert.equal(vm.webinarActionNeedsConfirm("end"), true, "Encerrar live pede confirmacao (fase 2b)");
  assert.equal(vm.webinarActionNeedsConfirm("duplicate"), false);
  assert.equal(vm.webinarActionConfirm("end", { registeredCount: 0, title: "Aula" }).title, "Encerrar “Aula” agora?");
  assert.equal(vm.webinarActionConfirm("end", { registeredCount: 0, title: "Aula" }).destructive, true);

  const cancel = vm.webinarActionConfirm("cancel", { registeredCount: 12, title: "Aula de IA" });
  assert.equal(cancel.title, "Cancelar “Aula de IA”?");
  assert.match(cancel.description, /^12 alunos com vaga garantida recebem o aviso de live cancelada/);
  assert.equal(cancel.destructive, true);
  assert.match(vm.webinarActionConfirm("cancel", { registeredCount: 1, title: "x" }).description, /^1 aluno com vaga garantida recebe/);
  assert.match(vm.webinarActionConfirm("cancel", { registeredCount: 0, title: "x" }).description, /^Ninguém garantiu vaga ainda/);
  assert.equal(vm.webinarActionConfirm("delete", { registeredCount: 0, title: "x" }).title, "Excluir este rascunho?");

  assert.equal(vm.savedWebinarToast("draft"), "Rascunho salvo.");
  assert.equal(vm.savedWebinarToast("published"), "Webinário atualizado.");
  assert.equal(vm.webinarFailureTitle({ savedDraft: false, status: 409 }), "Este webinário mudou em outra tela");
  assert.equal(vm.webinarFailureTitle({ savedDraft: true, status: 400 }), "O rascunho foi salvo, mas não foi publicado");
  assert.equal(vm.webinarFailureTitle({ savedDraft: false, status: 500 }), "Não foi possível concluir");
});

/* ------------------------------------------------------------------------------------------------
 * Cards, erros e conferencias de tela (§2.2)
 * ---------------------------------------------------------------------------------------------- */

test("cards por tipo: Sessoes so na Live gravada, Gravacao so na Live ao vivo; cada campo sabe o card dele", () => {
  // Fase 2b: Simulacao e Roteiro so na Live gravada; Enquetes nos dois tipos (prontas para o console).
  assert.deepEqual(vm.webinarEditorCards("live"), ["dados", "quemPode", "vagaLembretes", "avisar", "sala", "enquetes", "qualidade", "gravacao", "replayAula", "revisao"]);
  assert.deepEqual(vm.webinarEditorCards("simulated"), ["dados", "sessoes", "simulacao", "roteiro", "quemPode", "vagaLembretes", "avisar", "sala", "enquetes", "qualidade", "replayAula", "revisao"]);
  assert.deepEqual([...vm.WEBINAR_SAVED_ONLY_CARDS], ["simulacao", "roteiro", "enquetes"]);
  assert.equal(vm.webinarCardTitle("vagaLembretes").title, "Vaga e lembretes");
  assert.equal(vm.webinarCardOfField("sessions.1.scheduledAt"), "sessoes");
  assert.equal(vm.webinarCardOfField("audience.root.items.0"), "quemPode");
  assert.equal(vm.webinarCardOfField("reminderTexts.h24"), "vagaLembretes");
  assert.equal(vm.webinarCardOfField("roomSettings.chatMode"), "sala");
  assert.equal(vm.webinarCardOfField("replayLessonTarget.productId"), "replayAula");
  assert.equal(vm.webinarCardOfField("hostUserId"), "dados");
  assert.equal(vm.webinarCardOfField("qualquer-coisa"), "dados");
});

test("erros: zod e fieldErrors viram a primeira frase por campo, sem o 'draft.' do schema de salvar; segmento por regra", () => {
  assert.deepEqual(vm.webinarErrorsFrom([{ message: "A", path: ["sessions", 1, "scheduledAt"] }, { message: "B", path: ["sessions", 1, "scheduledAt"] }, { message: "C", path: ["title"] }]), {
    "sessions.1.scheduledAt": "A",
    title: "C"
  });
  assert.deepEqual(vm.webinarErrorsFromAction({ "draft.title": ["Dê um título."], hostUserId: ["Escolha."], vazio: [] }), { hostUserId: "Escolha.", title: "Dê um título." });
  assert.deepEqual(vm.webinarErrorsFromAction(undefined), {});
  assert.deepEqual(vm.webinarAudienceErrorsFrom({ audience: "Monte o segmento.", "audience.root.items.1.items.0.percent": "De 1 a 100.", title: "x" }), { "": "Monte o segmento.", "1.0": "De 1 a 100." });
});

test("conferencias de tela: apresentador fora dos co-apresentadores e com permissao de publicar, 'Produto ou segmento' com segmento, sessao com data, aula do replay com produto", () => {
  const draft = { ...vm.startWebinarDraft("live"), hostUserId: UUID_A, presenters: [{ canModerateRoom: false, role: "co_host", userId: UUID_A }] };

  assert.deepEqual(vm.webinarScreenProblems(draft), { "presenters.0.userId": "O apresentador já é quem apresenta." });
  assert.deepEqual(vm.webinarScreenProblems({ ...draft, presenters: [] }, { publishers: new Set([UUID_B]) }), { hostUserId: "O apresentador precisa poder publicar na Comunicação." });
  assert.deepEqual(vm.webinarScreenProblems({ ...draft, presenters: [] }, { publishers: new Set([UUID_A]) }), {});
  assert.deepEqual(vm.webinarScreenProblems({ ...draft, presenters: [] }, { publishers: null }), {}, "sem a lista de permissoes, o servidor confere");
  assert.deepEqual(vm.webinarScreenProblems({ ...draft, accessMode: "either", presenters: [], productId: "curso" }), { audience: "Monte o segmento ou escolha só o produto." });
  assert.deepEqual(vm.webinarScreenProblems({ ...vm.startWebinarDraft("simulated"), sessions: [{ scheduledAt: iso(now + DAY) }, { scheduledAt: "" }] }), { "sessions.1.scheduledAt": "Informe data e hora." });
  assert.deepEqual(vm.webinarScreenProblems({ ...vm.startWebinarDraft("live"), scheduledAt: "" }), { scheduledAt: "Informe data e hora." });
  assert.deepEqual(vm.webinarScreenProblems({ ...vm.startWebinarDraft("live"), replayLessonTarget: { autoPublish: false, moduleId: null, productId: "", title: null } }), {
    "replayLessonTarget.productId": "Escolha o produto da aula do replay."
  });
});

test("rascunho canonico: espacos nas pontas somem, vagas so com Garantir vaga, produto so com acesso por produto; trocar o tipo leva a hora marcada", () => {
  const draft = { ...vm.startWebinarDraft("live"), capacity: 50, coverUrl: " ", description: "  oi  ", registrationRequired: false, title: "  Aula  " };
  const canonical = vm.canonicalWebinarDraft(draft);

  assert.equal(canonical.title, "Aula");
  assert.equal(canonical.description, "oi");
  assert.equal(canonical.coverUrl, null);
  assert.equal(canonical.capacity, null, "sem Garantir vaga nao ha limite de vagas");
  assert.equal(canonical.productId, null);
  assert.equal(vm.isSameWebinarDraft(draft, { ...draft, title: "Aula" }), true);
  assert.equal(vm.isSameWebinarDraft(draft, { ...draft, title: "Outra" }), false);

  const live = { ...vm.startWebinarDraft("live"), scheduledAt: iso(now + DAY) };
  const simulated = vm.webinarDraftForKind(live, "simulated");
  assert.equal(simulated.kind, "simulated");
  assert.equal(simulated.scheduledAt, null);
  assert.deepEqual(simulated.sessions, [{ lateJoinMinutes: null, scheduledAt: iso(now + DAY) }]);
  // Entrada atrasada (fase 2): vazio, negativo ou quebrado vira "sempre"; acima do teto, o teto.
  assert.deepEqual(vm.canonicalSession({ scheduledAt: iso(now + DAY) }), { lateJoinMinutes: null, scheduledAt: iso(now + DAY) });
  assert.deepEqual(vm.canonicalSession({ lateJoinMinutes: 15, scheduledAt: iso(now + DAY) }), { lateJoinMinutes: 15, scheduledAt: iso(now + DAY) });
  assert.equal(vm.canonicalSession({ lateJoinMinutes: -1, scheduledAt: iso(now + DAY) }).lateJoinMinutes, null);
  assert.equal(vm.canonicalSession({ lateJoinMinutes: 2.5, scheduledAt: iso(now + DAY) }).lateJoinMinutes, null);
  assert.equal(vm.canonicalSession({ lateJoinMinutes: 9_999, scheduledAt: iso(now + DAY) }).lateJoinMinutes, 600);
  const back = vm.webinarDraftForKind({ ...simulated, recordingVideoUrl: "https://x.test/v" }, "live");
  assert.equal(back.scheduledAt, iso(now + DAY));
  assert.deepEqual(back.sessions, []);
  assert.equal(back.recordingVideoUrl, null);
  assert.equal(vm.webinarDraftForKind(live, "live"), live, "mesmo tipo: o mesmo objeto");
  assert.equal(vm.isWebinarKindLocked("published"), true);
  assert.equal(vm.isWebinarKindLocked("draft"), false);
  assert.equal(vm.isWebinarKindLocked(null), false);

  // Depois do Recarregar de um 409: o que esta tela mudou fica; o resto segue o servidor.
  const base = vm.startWebinarDraft("live");
  const local = { ...base, title: "Meu título" };
  const server = { ...base, description: "Do servidor", title: "Título de outra tela" };
  assert.deepEqual(vm.rebaseWebinarDraft(base, local, server), { ...base, description: "Do servidor", title: "Meu título" });
});

test("datas do editor: amanha as 20:00 de Sao Paulo; a proxima sessao um dia depois da ultima; em ordem", () => {
  assert.equal(vm.defaultWebinarScheduledAt(now), "2026-10-29T23:00:00.000Z");
  assert.equal(vm.nextWebinarSessionAt([], now), "2026-10-29T23:00:00.000Z");
  assert.equal(vm.nextWebinarSessionAt([{ scheduledAt: iso(now + DAY) }, { scheduledAt: iso(now + 3 * DAY) }], now), iso(now + 4 * DAY));
  assert.deepEqual(
    vm.sortWebinarSessions([{ scheduledAt: iso(now + 3 * DAY) }, { scheduledAt: iso(now + DAY) }]).map((session) => session.scheduledAt),
    [iso(now + DAY), iso(now + 3 * DAY)]
  );
  assert.equal(vm.webinarFirstSessionAt({ kind: "simulated", scheduledAt: null, sessions: [{ scheduledAt: iso(now - DAY) }, { scheduledAt: iso(now + 2 * DAY) }, { scheduledAt: iso(now + DAY) }] }, now), iso(now + DAY));
  assert.equal(vm.webinarFirstSessionAt({ kind: "simulated", scheduledAt: null, sessions: [{ scheduledAt: iso(now - DAY) }] }, now), iso(now - DAY), "todas passadas: a ultima");
  assert.equal(vm.webinarFirstSessionAt({ kind: "live", scheduledAt: "", sessions: [] }, now), null);
});

/* ------------------------------------------------------------------------------------------------
 * Previa e revisao
 * ---------------------------------------------------------------------------------------------- */

test("previa do card do aluno: o que falta vira '—' e 'Seu título aparece aqui'; com data, o dia e a contagem", () => {
  const empty = vm.webinarPreviewCard(vm.startWebinarDraft("live"), now);
  assert.equal(empty.title, "Seu título aparece aqui");
  assert.equal(empty.whenLabel, "—");
  assert.equal(empty.countdown, "");
  assert.equal(empty.kindLabel, "Live ao vivo");
  assert.equal(empty.registrationLabel, "Garantir vaga");

  const card = vm.webinarPreviewCard({ ...vm.startWebinarDraft("live"), registrationRequired: false, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Aula de IA" }, now);
  assert.equal(card.whenLabel, "Quinta, 5/11 às 20:00");
  assert.match(card.countdown, /^Começa em 8 d \d+ h( \d+ min)?$/, "a mesma contagem da pagina do aluno");
  assert.equal(card.registrationLabel, "Entrar");

  const simulated = vm.webinarPreviewCard({ ...vm.startWebinarDraft("simulated"), sessions: [{ scheduledAt: iso(now + DAY) }, { scheduledAt: iso(now + 2 * DAY) }], title: "Gravada" }, now);
  assert.equal(simulated.sessionsLabel, "2 sessões marcadas");
  assert.equal(simulated.kindLabel, "Live gravada");

  assert.equal(vm.reminderPreviewText("h24", { reminderTexts: model.emptyReminderTexts(), title: "Aula" }, "2026-11-05T23:00:00.000Z"), "Amanhã às 20:00: Aula. Sua vaga está garantida.");
  assert.equal(vm.reminderPreviewText("h24", { reminderTexts: { ...model.emptyReminderTexts(), h24: "  Meu texto  " }, title: "Aula" }, null), "Meu texto", "texto da equipe vale");
  assert.equal(vm.reminderPreviewText("started", { reminderTexts: model.emptyReminderTexts(), title: "" }, null), "Começou agora: Seu título aparece aqui. Entrar.");
});

test("frase da revisao: o que falta para publicar; depois, o resumo com tipo, hora, duracao, quem pode, vaga e lembretes", () => {
  const draft = vm.startWebinarDraft("live");
  assert.equal(
    vm.webinarReviewSentence({ draft, now, productName: null, registeredCount: null, situation: null }),
    "Para publicar, falta: Dê um título ao webinário; Informe data e hora; Escolha o apresentador."
  );

  const complete = { ...draft, hostUserId: UUID_A, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Aula de IA" };
  assert.equal(
    vm.webinarReviewSentence({ draft: complete, now, productName: null, registeredCount: 0, situation: null }),
    "Live ao vivo em 05/11/2026 às 20:00, 60 min, para todos os alunos, com Garantir vaga e lembrete 1 dia e 1 hora antes. O card entra na página inicial."
  );
  assert.equal(
    vm.webinarReviewSentence({ draft: { ...complete, accessMode: "product", capacity: 100, productId: "curso", reminders: { email: true, h1: false, h24: true }, showOnHome: false }, now, productName: "Curso de IA", registeredCount: 3, situation: "scheduled" }),
    "Live ao vivo em 05/11/2026 às 20:00, 60 min, para quem tem Curso de IA, até 100 vagas, com Garantir vaga e lembrete 1 dia antes. 3 alunos já garantiram vaga."
  );
  assert.equal(
    vm.webinarReviewSentence({ draft: { ...complete, accessMode: "either", productId: "curso", registrationRequired: false }, now, productName: null, registeredCount: 1, situation: "scheduled" }),
    "Live ao vivo em 05/11/2026 às 20:00, 60 min, para quem tem o produto escolhido ou está no segmento, sem vaga. O card entra na página inicial. 1 aluno já garantiu vaga."
  );
  // Publicado com a data ja passada: a frase e o resumo, nao a lista do que falta (so o rascunho lista).
  assert.match(vm.webinarReviewSentence({ draft: { ...complete, scheduledAt: iso(now - HOUR) }, now, productName: null, registeredCount: 0, situation: "ended" }), /^Live ao vivo em /);
  assert.equal(vm.describeWebinarAccess({ accessMode: "audience", capacity: 1, registrationRequired: true }, null), "quem está no segmento, até 1 vaga");
});
