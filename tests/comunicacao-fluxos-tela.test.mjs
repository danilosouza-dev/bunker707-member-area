import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunicacao > Fluxos no admin (docs/23 §2.4 a §2.10): as regras puras da lista, do construtor e do
// relatorio, carregadas direto pelo Node (flows-view-model.ts e flow-templates-model.ts). O que o servidor
// faz com cada acao (versao, 500 alunos, aprovacao) esta em tests/integration/fluxos-admin.test.mjs.

const vm = await import("../src/components/admin/v2/communication/flows/flows-view-model.ts");
const templates = await import("../src/components/admin/v2/communication/flows/flow-templates-model.ts");
const { flowDraftSchema, flowTreeOfDraft } = await import("../src/server/communications/flow-schemas.ts");
const { validateFlowTree } = await import("../src/server/communications/flow-model.ts");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sequence = () => {
  let n = 0;
  return () => id(++n);
};
const names = { cohorts: {}, products: { "formacao-ia": "Formação IA" } };
const ALL = { canPublish: true, canPublishLarge: true, canWrite: true };
const EDITOR = { canPublish: true, canPublishLarge: false, canWrite: true };
const WRITER = { canPublish: false, canPublishLarge: false, canWrite: true };
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const temAcesso = (productId) => regras({ op: "has", productIds: [productId], type: "product" });

/* ------------------------------------------------------------------------------------------------
 * Lista: enderecos, pilulas e vazios
 * ---------------------------------------------------------------------------------------------- */

test("lista: pilulas Todos · Ativos · Rascunhos · Encerrados escrevem ?situacao= e levam o periodo, sem a pagina", () => {
  assert.deepEqual(
    vm.FLOW_FILTERS.map((filter) => filter.label),
    ["Todos", "Ativos", "Rascunhos", "Encerrados"]
  );
  assert.equal(vm.flowsFilterHref({ pagina: "3", periodo: "7d" }, "active"), "/admin/comunicacao/fluxos?periodo=7d&situacao=ativos");
  assert.equal(vm.flowsFilterHref({ situacao: "ativos" }, undefined), "/admin/comunicacao/fluxos");
  assert.equal(vm.parseFlowFilterParam("rascunhos"), "drafts");
  assert.equal(vm.parseFlowFilterParam(["encerrados"]), "ended");
  assert.equal(vm.parseFlowFilterParam("qualquer"), undefined);
  assert.equal(vm.parseFlowsPage("2"), 2);
  assert.equal(vm.parseFlowsPage("-1"), 1);
});

test("lista: cada situacao cai na pilula certa (ativos = no ar, pausado, aguardando aprovacao e esperando a notificacao)", () => {
  assert.deepEqual(
    ["active", "paused", "pending_approval", "waiting_notice", "draft", "ended", "finished"].map(vm.flowFilterOfSituation),
    ["active", "active", "active", "active", "drafts", "ended", "ended"]
  );
});

test("lista: vazio geral e vazio de cada pilula, com titulo e frase", () => {
  assert.deepEqual(vm.FLOW_EMPTY_COPY.all, { description: "Monte uma sequência de notificações que segue o que cada aluno faz.", title: "Nenhum fluxo ainda" });
  assert.deepEqual(vm.FLOW_EMPTY_COPY.active, { description: "Ative um rascunho ou crie um fluxo novo.", title: "Nenhum fluxo ativo" });
  assert.deepEqual(vm.FLOW_EMPTY_COPY.drafts, { description: "Crie um fluxo a partir de um modelo.", title: "Nenhum rascunho" });
  assert.deepEqual(vm.FLOW_EMPTY_COPY.ended, { description: "Os fluxos encerrados ou concluídos aparecem aqui.", title: "Nenhum fluxo encerrado" });
});

test("lista: ?pagina= depois do fim volta para a ultima pagina com fluxos (ou para a primeira)", () => {
  assert.equal(vm.flowsPageFallbackHref({ itemCount: 0, page: 5, pageSize: 20, searchParams: { pagina: "5", situacao: "ativos" }, total: 41 }), "/admin/comunicacao/fluxos?situacao=ativos&pagina=3");
  assert.equal(vm.flowsPageFallbackHref({ itemCount: 0, page: 2, pageSize: 20, searchParams: { pagina: "2" }, total: 3 }), "/admin/comunicacao/fluxos");
  assert.equal(vm.flowsPageFallbackHref({ itemCount: 3, page: 2, pageSize: 20, searchParams: {}, total: 23 }), null);
});

test("lista: Quem entra com a contagem e 'e quem entrar depois' nos modos continuos; no de aviso, 'Recebeu …'", () => {
  assert.deepEqual(vm.entryListLines({ count: 318, description: "Todos os alunos", mode: "current_and_new", origin: "builder" }), {
    detail: "≈ 318 alunos e quem entrar depois",
    sentence: "Todos os alunos"
  });
  assert.deepEqual(vm.entryListLines({ count: 318, description: "Todos os alunos", mode: "current", origin: "builder" }).detail, "≈ 318 alunos");
  assert.deepEqual(vm.entryListLines({ count: null, description: "x", mode: "current", origin: "notice", sourceTitle: "Oferta especial!" }), {
    detail: null,
    sentence: "Recebeu “Oferta especial!”"
  });
  assert.deepEqual(vm.flowRowNumbers({ hasGoal: false, totals: null }), { active: "—", entered: "—", goal: "—", sent: "—" });
  assert.deepEqual(vm.flowRowNumbers({ hasGoal: true, totals: { active: 140, done: 1, ended: 0, entered: 1318, goal: 45, sent: 2000 } }), {
    active: "140",
    entered: "1.318",
    goal: "45",
    sent: "2.000"
  });
  assert.equal(vm.inFlowNowLine({ active: 140, done: 0, ended: 0, entered: 0, goal: 0, sent: 0 }), "No fluxo agora 140");
});

/* ------------------------------------------------------------------------------------------------
 * Situacao e acoes
 * ---------------------------------------------------------------------------------------------- */

test("situacao: Concluído e o fim pelo job; o fluxo de um aviso agendado, enviando ou aguardando aprovacao espera a notificacao", () => {
  const of = (status, extra = {}) => vm.flowSituationOf({ endedReason: null, origin: "builder", status, ...extra });

  assert.equal(of("ended", { endedReason: "finished" }), "finished");
  assert.equal(of("ended", { endedReason: "team" }), "ended");
  assert.equal(of("ended", { endedReason: "source_withdrawn", origin: "notice" }), "ended");
  assert.equal(of("active"), "active");

  for (const sourceStatus of ["scheduled", "sending", "pending_approval"]) {
    assert.equal(of("active", { origin: "notice", sourceStatus }), "waiting_notice", sourceStatus);
    assert.equal(of("draft", { origin: "notice", sourceStatus }), "waiting_notice", sourceStatus);
  }

  assert.equal(of("draft", { origin: "notice", sourceStatus: "draft" }), "draft");
  assert.equal(of("active", { origin: "notice", sourceStatus: "sent" }), "active");
  assert.equal(of("paused", { origin: "notice", sourceStatus: "sending" }), "paused", "pausado continua pausado");
  assert.deepEqual(
    ["draft", "pending_approval", "waiting_notice", "active", "paused", "ended", "finished"].map((situation) => vm.FLOW_SITUATION_LABELS[situation]),
    ["Rascunho", "Aguardando aprovação", "Esperando a notificação", "Ativo", "Pausado", "Encerrado", "Concluído"]
  );
  assert.equal(vm.flowSituationTone("active"), "success");
  assert.equal(vm.flowSituationTone("finished"), "muted");
});

test("acoes por situacao e permissao: so o que da para fazer agora", () => {
  const acoes = (status, permissions, origin = "builder") => vm.availableFlowActions({ origin, status }, permissions);

  assert.deepEqual(acoes("draft", WRITER), ["edit", "activate", "duplicate", "delete"]);
  assert.deepEqual(acoes("pending_approval", ALL), ["edit", "approve", "reject", "duplicate", "delete"]);
  assert.deepEqual(acoes("pending_approval", EDITOR), ["edit", "duplicate", "delete"], "aprovar so com messaging.publish_large");
  assert.deepEqual(acoes("active", EDITOR), ["edit", "pause", "end", "duplicate"]);
  assert.deepEqual(acoes("paused", EDITOR), ["edit", "resume", "end", "duplicate"]);
  assert.deepEqual(acoes("active", WRITER), ["duplicate"], "sem messaging.publish: nada no fluxo no ar, so duplicar");
  assert.deepEqual(acoes("ended", ALL), ["duplicate", "delete"]);
  assert.deepEqual(acoes("active", ALL, "notice"), ["edit", "pause", "end", "open_notice"], "fluxo de aviso: sem Duplicar nem Excluir");

  assert.deepEqual(
    vm.flowMenuEntries(acoes("active", EDITOR)).map((entry) => [entry.label, entry.destructive, entry.separated]),
    [
      ["Editar", false, false],
      ["Pausar", false, false],
      ["Duplicar", false, false],
      ["Encerrar", true, true]
    ]
  );
  assert.deepEqual(
    vm.flowMenuEntries(acoes("draft", ALL)).map((entry) => entry.label),
    ["Editar", "Duplicar", "Excluir"],
    "ativar fica no botao, nao no menu"
  );
  assert.ok(["pause", "end", "delete", "activate"].every(vm.flowActionNeedsConfirm));
  assert.ok(!vm.flowActionNeedsConfirm("resume") && !vm.flowActionNeedsConfirm("duplicate"));
});

test("confirmacoes: ativar diz quem entra em cada modo; pausar, encerrar e excluir com a frase de §2.6", () => {
  const ativar = (mode, count) => vm.flowActionConfirm("activate", { entryCount: count, entryMode: mode, name: "X" });

  assert.equal(ativar("current", 318).title, "Ativar o fluxo?");
  assert.equal(ativar("current", 318).confirmLabel, "Ativar");
  assert.equal(ativar("current", 318).description, "318 alunos entram agora. Os primeiros passos começam em até 1 minuto.");
  assert.equal(
    ativar("current_and_new", 318).description,
    "318 alunos entram agora. Os primeiros passos começam em até 1 minuto e quem entrar no segmento depois entra em até 15 minutos."
  );
  assert.equal(ativar("new_only", 318).description, "Ninguém entra agora: só quem passar a se encaixar daqui em diante.");
  assert.equal(ativar("current", 1).description, "1 aluno entra agora. Os primeiros passos começam em até 1 minuto.");

  const pausar = vm.flowActionConfirm("pause", { entryCount: 0, entryMode: "current", name: "X" });
  assert.equal(pausar.title, "Pausar o fluxo?");
  assert.match(pausar.description, /^Ninguém entra e nada sai enquanto estiver pausado\. As esperas continuam contando/);
  const encerrar = vm.flowActionConfirm("end", { entryCount: 0, entryMode: "current", name: "X" });
  assert.deepEqual([encerrar.title, encerrar.destructive], ["Encerrar o fluxo?", true]);
  assert.equal(encerrar.description, "Ninguém mais entra e nada mais sai. As notificações já enviadas continuam no sino. Não dá para desfazer.");
  const excluir = vm.flowActionConfirm("delete", { entryCount: 0, entryMode: "current", name: "X" });
  assert.deepEqual([excluir.title, excluir.description], ["Excluir o fluxo?", "Some da lista. As notificações já enviadas continuam no sino."]);

  assert.equal(vm.FLOW_TOASTS.activated, "Fluxo ativo. Os primeiros passos começam em até 1 minuto.");
  assert.equal(vm.FLOW_TOASTS.paused, "Fluxo pausado. Nada sai até você retomar.");
  assert.equal(vm.FLOW_TOASTS.applied, "Alterações aplicadas.");
});

/* ------------------------------------------------------------------------------------------------
 * Construtor: barra, quem entra, objetivo
 * ---------------------------------------------------------------------------------------------- */

test("barra do construtor: rascunho ativa ou pede aprovacao pela contagem; no ar, Aplicar alterações; fluxo de aviso, so Salvar", () => {
  const bar = (input) => vm.builderBarFor({ count: 10, origin: "builder", permissions: ALL, saved: true, status: "draft", ...input });

  assert.equal(bar({}).primary, "activate");
  assert.equal(bar({ count: 501, permissions: EDITOR }).primary, "request_approval", "acima de 500 sem publish_large");
  assert.equal(bar({ count: 10, permissions: WRITER }).primary, "request_approval", "sem messaging.publish");
  assert.equal(bar({ count: 501 }).primary, "activate");
  assert.ok(bar({}).saveDraft);
  assert.deepEqual(bar({}).menu, ["duplicate", "delete"]);
  assert.deepEqual(bar({ saved: false }).menu, [], "rascunho novo ainda sem menu");

  const live = bar({ status: "active" });
  assert.deepEqual([live.primary, live.applyBar, live.saveDraft], ["apply", true, false]);
  assert.deepEqual(live.menu, ["pause", "end", "duplicate"]);
  assert.equal(bar({ permissions: WRITER, status: "active" }).readOnly, "Só quem pode publicar muda um fluxo no ar. Duplique para criar outro.");

  // Fluxo de um aviso que ainda nao saiu: "Salvar" e "Abrir a notificação"; nem Ativar, nem Duplicar ou Excluir.
  const aviso = bar({ origin: "notice", status: "draft" });
  assert.deepEqual([aviso.primary, aviso.openNotice, aviso.saveDraft, aviso.menu], ["save", true, false, []]);
  assert.equal(vm.BUILDER_PRIMARY_LABELS[aviso.primary], "Salvar");
  const avisoNoAr = bar({ origin: "notice", status: "paused" });
  assert.deepEqual([avisoNoAr.primary, avisoNoAr.menu], ["apply", ["resume", "end"]]);
});

test("fluxo de aviso com a notificacao agendada ou aguardando aprovacao: so Abrir a notificação (nada de editar, pausar ou encerrar)", () => {
  const acoes = (status, sourceStatus) => vm.availableFlowActions({ origin: "notice", sourceStatus, status }, ALL);

  assert.deepEqual(acoes("active", "scheduled"), ["open_notice"], "agendada: o fluxo ativo espera a notificacao");
  assert.deepEqual(acoes("pending_approval", "pending_approval"), ["open_notice"], "aguardando aprovacao: muda pela notificacao");
  assert.deepEqual(acoes("active", "sent"), ["edit", "pause", "end", "open_notice"], "depois do envio, como antes");
  assert.deepEqual(acoes("active", "sending"), ["edit", "pause", "end", "open_notice"]);
  assert.deepEqual(acoes("draft", "draft"), ["edit", "open_notice"], "rascunho: Salvar no construtor");
  assert.deepEqual(vm.availableFlowActions({ origin: "builder", sourceStatus: "scheduled", status: "active" }, EDITOR), ["edit", "pause", "end", "duplicate"]);

  const bar = (input) => vm.builderBarFor({ count: null, origin: "notice", permissions: ALL, saved: true, ...input });
  const esperando = bar({ sourceStatus: "scheduled", status: "active" });
  assert.deepEqual([esperando.primary, esperando.applyBar, esperando.menu, esperando.openNotice], [null, false, [], true]);
  assert.equal(esperando.readOnly, vm.NOTICE_WAITING_NOTE);
  assert.equal(bar({ sourceStatus: "pending_approval", status: "pending_approval" }).readOnly, vm.NOTICE_WAITING_NOTE);
  assert.equal(bar({ sourceStatus: "draft", status: "draft" }).primary, "save");
  assert.equal(bar({ sourceStatus: "sent", status: "active" }).primary, "apply");
});

test("Quem entra: no de aviso fica so leitura; depois de ativar o jeito de entrar nao muda e, em 'Quem está no segmento agora', nem as regras", () => {
  assert.deepEqual(vm.entryLock({ live: false, mode: "current", origin: "notice" }), { modeLocked: true, note: null, rulesLocked: true });
  assert.deepEqual(vm.entryLock({ live: false, mode: "current", origin: "builder" }), { modeLocked: false, note: null, rulesLocked: false });
  assert.deepEqual(vm.entryLock({ live: true, mode: "current", origin: "builder" }), {
    modeLocked: true,
    note: "Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.",
    rulesLocked: true
  });
  assert.deepEqual(vm.entryLock({ live: true, mode: "new_only", origin: "builder" }), { modeLocked: true, note: null, rulesLocked: false });
  assert.deepEqual(
    vm.ENTRY_MODE_OPTIONS.map((option) => [option.label, option.help]),
    [
      ["Quem está no segmento agora", "Entram todos de uma vez ao ativar."],
      ["Quem está agora e quem entrar depois", "Quem passar a se encaixar entra em até 15 minutos."],
      ["Só quem entrar no segmento a partir de agora", "Quem já se encaixa ao ativar fica de fora. Bom para “ganhou acesso ao produto”."]
    ]
  );
  assert.equal(vm.ONCE_PER_FLOW_TEXT, "Cada aluno passa por este fluxo uma vez só.");
  assert.match(vm.DAILY_LIMIT_TEXT, /^Para não cansar o aluno: no máximo 3 notificações de fluxos e notificações seguintes por dia/);
  assert.equal(vm.entrySentence({ audience: { kind: "everyone" }, names, origin: "notice", sourceTitle: "Oferta especial!" }), "Recebeu a notificação “Oferta especial!”");
  assert.equal(vm.entryCountLine(318), "≈ 318 alunos agora");
});

test("Objetivo 'têm acesso a Y' com um segmento que deixa entrar quem ja tem Y: a sugestao e o Adicionar", () => {
  const goal = temAcesso("formacao-ia");

  assert.equal(vm.goalAccessFix({ entry: { kind: "everyone" }, goal, origin: "builder" }), "formacao-ia");
  assert.equal(vm.goalAccessFixMessage("Formação IA"), "Quem já tem acesso a Formação IA entra e sai na hora. Adicionar “não têm acesso a Formação IA” ao segmento?");

  const comExclusao = regras({ op: "has_not", productIds: ["formacao-ia"], type: "product" });
  assert.equal(vm.goalAccessFix({ entry: comExclusao, goal, origin: "builder" }), null, "o segmento ja exclui Y");
  assert.equal(vm.goalAccessFix({ entry: { kind: "everyone" }, goal: regras({ days: 2, op: "within", type: "last_study" }), origin: "builder" }), null);
  assert.equal(vm.goalAccessFix({ entry: { kind: "everyone" }, goal, origin: "notice" }), null);

  assert.deepEqual(vm.applyGoalAccessFix({ kind: "everyone" }, "formacao-ia"), comExclusao);
  const estudou = { days: 7, op: "within", type: "last_study" };
  assert.deepEqual(vm.applyGoalAccessFix(regras(estudou), "formacao-ia"), regras(estudou, { op: "has_not", productIds: ["formacao-ia"], type: "product" }));
  assert.deepEqual(vm.applyGoalAccessFix({ kind: "rules", root: { items: [estudou], match: "any" } }, "formacao-ia"), {
    kind: "rules",
    root: { items: [{ items: [estudou], match: "any" }, { op: "has_not", productIds: ["formacao-ia"], type: "product" }], match: "all" }
  });
  assert.equal(vm.applyGoalAccessFix({ kind: "rules", root: { items: [{ items: [estudou], match: "all" }], match: "any" } }, "formacao-ia"), null, "grupo dentro de grupo nao cabe");
  assert.equal(vm.GOAL_HINT, "Quem atingir o objetivo não recebe mais nada deste fluxo.");
});

test("frase de revisao: quem entra, quantas notificacoes e condicoes, e o objetivo", () => {
  const nodes = [{ kind: "entry" }, { kind: "message" }, { kind: "condition" }, { kind: "message" }, { kind: "message" }];

  assert.equal(
    vm.describeFlowReview({ count: 318, goal: temAcesso("formacao-ia"), mode: "current_and_new", names, nodes, origin: "builder" }),
    "Fluxo para 318 alunos agora e quem entrar depois, com 3 notificações e 1 condição. Sai quando o aluno tiver acesso a Formação IA."
  );
  assert.equal(vm.describeFlowReview({ count: 1, goal: null, mode: "current", names, nodes: nodes.slice(0, 2), origin: "builder" }), "Fluxo para 1 aluno agora, com 1 notificação.");
  assert.equal(vm.describeFlowReview({ count: null, goal: null, mode: "new_only", names, nodes: [{ kind: "entry" }], origin: "builder" }), "Fluxo para quem entrar no segmento a partir de agora, ainda sem notificações.");
  assert.equal(
    vm.describeFlowReview({ count: 10, goal: regras({ days: 2, op: "within", type: "last_study" }), mode: "current", names, nodes, origin: "notice", sourceTitle: "Oferta especial!" }),
    "Fluxo para quem recebeu a notificação “Oferta especial!”, com 3 notificações e 1 condição. Sai quando o aluno atingir o objetivo."
  );
});

/* ------------------------------------------------------------------------------------------------
 * Quando, cartoes e conectores
 * ---------------------------------------------------------------------------------------------- */

test("Quando: etiquetas do conector, escolhas e numero + unidade", () => {
  const titleOf = () => "Oferta especial!";

  assert.equal(vm.timingChipLabel({ anchor: "previous", anchorNodeId: null, offsetMinutes: 0 }, titleOf), "Logo depois");
  assert.equal(vm.timingChipLabel({ anchor: "previous", anchorNodeId: null, offsetMinutes: 1_440 }, titleOf), "Esperar 1 dia");
  assert.equal(vm.timingChipLabel({ anchor: "previous", anchorNodeId: null, offsetMinutes: 180 }, titleOf), "Esperar 3 h");
  assert.equal(vm.timingChipLabel({ anchor: "expires", anchorNodeId: id(2), offsetMinutes: 180 }, titleOf), "3 h antes de “Oferta especial!” vencer");
  assert.equal(vm.timingChipLabel({ anchor: "sent", anchorNodeId: id(2), offsetMinutes: 2_880 }, titleOf), "2 dias depois do envio de “Oferta especial!”");
  assert.equal(vm.formatWait(90), "1 h 30 min");
  assert.equal(vm.formatWait(1_620), "1 dia e 3 h");
  assert.equal(vm.formatWait(45), "45 min");

  assert.deepEqual(vm.waitParts(2_880), { amount: 2, unit: "days" });
  assert.deepEqual(vm.waitParts(180), { amount: 3, unit: "hours" });
  assert.deepEqual(vm.waitParts(95), { amount: 95, unit: "minutes" });
  assert.equal(vm.waitMinutes(3, "hours"), 180);
  assert.ok(Number.isNaN(vm.waitMinutes(Number.NaN, "days")));

  const above = [{ nodeId: id(2) }, { nodeId: id(3) }];
  const now = { anchor: "previous", anchorNodeId: null, offsetMinutes: 0 };
  assert.equal(vm.timingChoiceOf(now), "now");
  assert.deepEqual(vm.timingForChoice("wait", now, above), { anchor: "previous", anchorNodeId: null, offsetMinutes: 1_440 });
  assert.deepEqual(vm.timingForChoice("before_expiry", now, above), { anchor: "expires", anchorNodeId: id(3), offsetMinutes: 180 }, "a notificacao logo acima");
  assert.deepEqual(vm.timingForChoice("after_send", { anchor: "expires", anchorNodeId: id(2), offsetMinutes: 60 }, above), { anchor: "sent", anchorNodeId: id(2), offsetMinutes: 1_440 });
  assert.deepEqual(vm.timingForChoice("now", { anchor: "sent", anchorNodeId: id(2), offsetMinutes: 60 }, above), now);

  // "Até “X” sumir" e o padrao de "antes de vencer" quando o tempo no sino era o de 90 dias.
  assert.deepEqual(vm.validityAfterTiming({ mode: "default" }, "expires"), { mode: "with_anchor" });
  assert.deepEqual(vm.validityAfterTiming({ minutes: 4_320, mode: "duration" }, "expires"), { minutes: 4_320, mode: "duration" });
  assert.deepEqual(vm.validityAfterTiming({ mode: "with_anchor" }, "previous"), { mode: "default" });
});

test("cartoes: notificacao com o tempo no sino e o filtro; condicao com 'esperar ate'; o canvas vazio de 'Começar do zero'", () => {
  const titleOf = () => "Condição especial até sexta";
  const content = { audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title: "Faltam 3 horas", validity: { mode: "with_anchor" } };

  assert.deepEqual(vm.messageCardLines({ content, names, node: { anchorNodeId: id(2), filter: null }, titleOf }), {
    filter: null,
    title: "Faltam 3 horas",
    validity: "Fica no sino até “Condição especial até sexta” sumir"
  });

  const filtro = regras({ action: "opened", negate: true, ref: { kind: "node", nodeId: id(2) }, type: "message" });
  const lines = vm.messageCardLines({
    content: { ...content, validity: { minutes: 4_320, mode: "duration" } },
    names: { ...names, messages: { [`node:${id(2)}`]: "Oferta especial!" } },
    node: { anchorNodeId: null, filter: filtro },
    titleOf
  });
  assert.equal(lines.validity, "Fica 3 dias no sino");
  assert.equal(lines.filter, "Só para alunos que não abriram a notificação “Oferta especial!”");
  assert.equal(vm.conditionWaitLine({ maxWaitMinutes: 2_880, waitUntilTrue: true }), "Espera até ser Sim, por no máximo 2 dias");
  assert.equal(vm.conditionWaitLine({ maxWaitMinutes: null, waitUntilTrue: false }), null);
  assert.equal(vm.BLANK_CANVAS_HINT, "Toque em + para adicionar a primeira notificação.");
  assert.equal(vm.BRANCH_END_TEXT, "Fim: nada mais para quem chega aqui.");
  assert.equal(vm.ADD_STEP_LABEL, "Adicionar passo aqui");
});

test("a 375 px toda condicao vira as pilulas Sim (n) | Não (n); no computador, do 3o nivel para baixo", () => {
  assert.equal(vm.usesSidePills({ level: 1, narrow: true }), true);
  assert.equal(vm.usesSidePills({ level: 1, narrow: false }), false);
  assert.equal(vm.usesSidePills({ level: 3, narrow: false }), true);
  assert.equal(vm.sidePillLabel("yes", 120), "Sim (120)");
  assert.equal(vm.sidePillLabel("no", 1600), "Não (1.600)");
  assert.equal(vm.sidePillLabel("no", null), "Não");

  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [, , condicao, lembrete] = draft.nodes;
  assert.equal(vm.conditionLevel(draft.nodes, condicao.id), 1);
  assert.equal(vm.conditionLevel(draft.nodes, lembrete.id), 2);
});

/* ------------------------------------------------------------------------------------------------
 * Arvore: inserir e remover
 * ---------------------------------------------------------------------------------------------- */

test("inserir: espera padrao pelo passo de cima; no meio, o que vinha depois desce (na condicao, pelo Sim); no ar, entra ao lado", () => {
  const draft = templates.buildFlowTemplate("unopened", sequence());
  const [entrada, primeira, condicao] = draft.nodes;

  const depoisDaEntrada = vm.insertFlowStep(draft, { branch: null, id: id(50), kind: "condition", live: false, parentId: entrada.id });
  assert.equal(depoisDaEntrada.movedToYes, true, "toast 'O que vinha depois ficou no caminho Sim.'");
  const nova = depoisDaEntrada.draft.nodes.find((node) => node.id === id(50));
  assert.deepEqual([nova.parentId, nova.offsetMinutes, nova.branch], [entrada.id, 0, null], "depois de Quem entra: Logo depois");
  assert.deepEqual(nova.condition.root.items, [], "sem notificacao acima: a condicao comeca sem regra");
  const desceu = depoisDaEntrada.draft.nodes.find((node) => node.id === primeira.id);
  assert.deepEqual([desceu.parentId, desceu.branch], [id(50), "yes"]);

  const depoisDaPrimeira = vm.insertFlowStep(draft, { branch: null, id: id(51), kind: "message", live: false, parentId: primeira.id });
  assert.equal(depoisDaPrimeira.movedToYes, false);
  const mensagem = depoisDaPrimeira.draft.nodes.find((node) => node.id === id(51));
  assert.equal(mensagem.offsetMinutes, 1_440, "depois de uma notificacao: Esperar 1 dia");
  assert.ok(depoisDaPrimeira.draft.messages[id(51)], "conteudo vazio para preencher");
  assert.equal(depoisDaPrimeira.draft.nodes.find((node) => node.id === condicao.id).parentId, id(51));

  const condicaoNova = vm.insertFlowStep(draft, { branch: null, id: id(52), kind: "condition", live: true, parentId: primeira.id });
  assert.deepEqual(condicaoNova.draft.nodes.find((node) => node.id === id(52)).condition.root.items, [
    { action: "opened", negate: false, ref: { kind: "node", nodeId: primeira.id }, type: "message" }
  ]);
  assert.equal(condicaoNova.draft.nodes.find((node) => node.id === condicao.id).parentId, primeira.id, "no ar a ordem nao muda");
  assert.equal(condicaoNova.movedToYes, false);

  const noFimDoNao = vm.insertFlowStep(draft, { branch: "no", id: id(53), kind: "message", live: false, parentId: condicao.id });
  assert.deepEqual(
    [noFimDoNao.draft.nodes.find((node) => node.id === id(53)).branch, noFimDoNao.draft.nodes.find((node) => node.id === id(53)).offsetMinutes],
    ["no", 0]
  );

  // Ordem da gravacao: pai antes do filho.
  const { tree } = flowTreeOfDraft(depoisDaPrimeira.draft);
  assert.deepEqual(validateFlowTree(tree, {}).filter((issue) => issue.level === "save" && issue.message === "Passo inválido."), []);
});

test("inserir: a condicao nova confere 'viu' quando a notificacao de cima nao tem nada para abrir (V7)", () => {
  const draft = templates.buildFlowTemplate("unopened", sequence());
  const [entrada, primeira] = draft.nodes;
  const curta = { ...draft, messages: { ...draft.messages, [primeira.id]: { ...draft.messages[primeira.id], audio: null, body: "Curta.", cta: null, response: null } } };
  const regraDa = (result) => result.draft.nodes.find((node) => node.id === id(70)).condition.root.items[0];

  assert.equal(regraDa(vm.insertFlowStep(curta, { branch: null, id: id(70), kind: "condition", live: true, parentId: primeira.id })).action, "seen", "texto curto sem nada: 'abriu' nunca acontece");
  assert.equal(regraDa(vm.insertFlowStep(draft, { branch: null, id: id(70), kind: "condition", live: true, parentId: primeira.id })).action, "opened");

  // Fluxo de aviso: a principal (a entrada) decide pelo que ela tem.
  const doAviso = { ...draft, origin: "notice" };
  const aviso = (extra) => ({ body: "Curta.", ctaHref: null, hasAudio: false, hasResponse: false, id: id(900), title: "Principal", ...extra });
  assert.equal(regraDa(vm.insertFlowStep(doAviso, { branch: null, id: id(70), kind: "condition", live: true, parentId: entrada.id, source: aviso() })).action, "seen");
  assert.equal(regraDa(vm.insertFlowStep(doAviso, { branch: null, id: id(70), kind: "condition", live: true, parentId: entrada.id, source: aviso({ hasAudio: true }) })).action, "opened");
});

test("inserir: no maximo 20 passos", () => {
  let draft = templates.buildFlowTemplate("blank", sequence());
  let parent = draft.nodes[0].id;

  for (let n = 0; n < 20; n += 1) {
    const result = vm.insertFlowStep(draft, { branch: null, id: id(100 + n), kind: "message", live: false, parentId: parent });
    draft = result.draft;
    parent = id(100 + n);
  }

  assert.equal(vm.insertFlowStep(draft, { branch: null, id: id(200), kind: "message", live: false, parentId: parent }), null);
  assert.equal(vm.MAX_STEPS_MESSAGE, "Use no máximo 20 passos (notificações e condições).");
});

test("remover a condicao: manter o Sim sobe o caminho para o lugar dela; manter o Nao; ou tudo daqui para baixo", () => {
  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [entrada, primeira, condicao, lembrete, outra] = draft.nodes;

  assert.deepEqual(
    vm.CONDITION_REMOVE_OPTIONS.map((option) => option.label),
    ["Manter o caminho “Sim”", "Manter o caminho “Não”", "Remover tudo daqui para baixo"]
  );

  const sim = vm.removeFlowStep(draft, condicao.id, "keep_yes");
  assert.deepEqual(
    sim.nodes.map((node) => node.id),
    [entrada.id, primeira.id, lembrete.id]
  );
  const subiu = sim.nodes.find((node) => node.id === lembrete.id);
  assert.deepEqual([subiu.parentId, subiu.branch], [primeira.id, null], "no lugar da condicao (mesmo pai e mesmo lado)");
  assert.ok(!sim.messages[outra.id] && sim.messages[lembrete.id], "o conteudo do caminho que saiu sai junto");

  const nao = vm.removeFlowStep(draft, condicao.id, "keep_no");
  assert.deepEqual(
    nao.nodes.map((node) => node.id),
    [entrada.id, primeira.id, outra.id]
  );

  const tudo = vm.removeFlowStep(draft, condicao.id, "subtree");
  assert.deepEqual(
    tudo.nodes.map((node) => node.id),
    [entrada.id, primeira.id]
  );
  assert.deepEqual(Object.keys(tudo.messages), [primeira.id]);

  // Remover uma notificacao leva o que esta abaixo dela.
  assert.deepEqual(
    vm.removeFlowStep(draft, primeira.id, "subtree").nodes.map((node) => node.id),
    [entrada.id]
  );
});

test("frases de remover e de retirar do sino, com quem esta esperando", () => {
  assert.deepEqual(vm.removeStepCopy("message", "Faltam 3 horas", 0), {
    description: "As notificações e condições abaixo dela saem junto.",
    title: "Remover “Faltam 3 horas”?",
    waitingNote: null
  });
  assert.equal(
    vm.removeStepCopy("message", "Faltam 3 horas", 12).waitingNote,
    "12 alunos estão esperando este passo. Ao remover, eles param aqui neste caminho. Quem já recebeu continua com ela no sino."
  );
  assert.deepEqual(vm.removeStepCopy("condition", "", 12), {
    description: "Escolha o caminho que fica.",
    title: "Remover a condição?",
    waitingNote: "12 alunos estão esperando esta condição e param aqui."
  });

  const retirar = vm.withdrawStepCopy("Oferta especial!", 120);
  assert.equal(retirar.title, "Retirar “Oferta especial!” do sino?");
  assert.equal(retirar.description, "Some para os 120 alunos que receberam e não sai mais para ninguém. Quem estava esperando por ela para aqui neste caminho.");
  assert.equal(retirar.confirmLabel, "Retirar do sino");
});

/* ------------------------------------------------------------------------------------------------
 * Regras do fluxo e erros
 * ---------------------------------------------------------------------------------------------- */

test("regras: as notificacoes acima do passo (de cima para baixo), com o que cada uma tem; nomes 'node:<id>' para as frases", () => {
  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [entrada, primeira, condicao, lembrete] = draft.nodes;
  const contexto = vm.flowContextAbove(draft, lembrete.id);

  assert.deepEqual(
    contexto.messages.map((message) => [message.nodeId, message.title, message.hasCta, message.canOpen]),
    [[primeira.id, "Condição especial até sexta", true, true]]
  );
  assert.deepEqual(vm.flowContextAbove(draft, condicao.id).messages.length, 1);
  assert.equal(vm.flowContextAll(draft).messages.length, 3);
  assert.equal(vm.flowAudienceNames(names, draft).messages[`node:${primeira.id}`], "Condição especial até sexta");
  assert.deepEqual(
    vm.timingAnchorsAbove(draft, lembrete.id).map((item) => item.title),
    ["Condição especial até sexta"]
  );

  // Fluxo de aviso: a entrada e a notificacao principal.
  const aviso = { ...draft, origin: "notice" };
  const source = { body: "", ctaHref: null, hasAudio: true, hasResponse: false, id: id(99), title: "Oferta especial!", validUntil: null, validityMinutes: 1_440 };
  assert.deepEqual(
    vm.flowContextAbove(aviso, primeira.id, source).messages.map((message) => [message.nodeId, message.title, message.hasAudio]),
    [[entrada.id, "Oferta especial!", true]]
  );
});

test("erros: caminhos do zod pelo id do passo, separados em passo, conteudo e configuracao", () => {
  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [, primeira, condicao] = draft.nodes;
  const parsed = flowDraftSchema.safeParse(draft);

  assert.equal(parsed.success, false, "o produto ainda nao foi escolhido");
  const errors = vm.flowErrorsFrom(parsed.error.issues, draft.nodes);
  assert.equal(errors[`messages.${primeira.id}.cta.href`], "Escolha para onde o botão leva.");
  assert.ok(errors["entry.audience.root.items.0.productIds"], "o segmento pede o produto");
  assert.equal(vm.firstErrorTarget(errors, draft.nodes), "", "a configuracao vem primeiro na tela");
  assert.deepEqual(vm.stepErrors(errors, primeira.id).content, { "cta.href": "Escolha para onde o botão leva." });

  const daAcao = vm.flowErrorsFromAction({ [`flow.nodes.2.offsetMinutes`]: ["Escolha de 5 minutos a 60 dias."] }, draft.nodes);
  assert.deepEqual(daAcao, { [`nodes.${condicao.id}.offsetMinutes`]: "Escolha de 5 minutos a 60 dias." });
  assert.equal(vm.firstErrorTarget(daAcao, draft.nodes), condicao.id);

  const ativar = vm.activationErrors(vm.flowIssuesOf(draft));
  assert.equal(ativar.goal, "Escolha o produto.");
});

test("modelos: os quatro dao arvores validas e, com o produto escolhido, passam no zod como o servidor grava", () => {
  assert.deepEqual(
    templates.FLOW_TEMPLATES.map((template) => template.title),
    ["Para quem não abriu", "Boas-vindas a quem ganhou acesso", "Promoção com prazo", "Começar do zero"]
  );
  assert.ok(templates.FLOW_TEMPLATES.every((template) => !/lembrete|oferta/i.test(template.title)), "nomes sem Lembrete nem Oferta");

  for (const template of templates.FLOW_TEMPLATES) {
    const draft = templates.buildFlowTemplate(template.id, sequence());
    const saveIssues = vm.flowIssuesOf(draft).filter((issue) => issue.level === "save");
    assert.deepEqual(saveIssues, [], template.id);

    // O produto escolhido: as regras e o botao ganham o produto.
    const chosen = JSON.parse(JSON.stringify(draft).replaceAll('"productIds":[]', '"productIds":["formacao-ia"]').replaceAll('"href":""', '"href":"/conteudo/formacao-ia"'));
    const parsed = flowDraftSchema.safeParse(chosen);
    assert.equal(parsed.success, true, `${template.id}: ${JSON.stringify(parsed.error?.issues)}`);
  }

  const unopened = templates.buildFlowTemplate("unopened", sequence());
  assert.equal(unopened.nodes[2].offsetMinutes, 1_440, "Esperar 1 dia");
  assert.deepEqual(
    unopened.nodes[2].condition.root.items.map((rule) => [rule.action, rule.negate]),
    [
      ["seen", false],
      ["opened", true]
    ],
    "viram no sino e nao abriram"
  );
  const deadline = templates.buildFlowTemplate("deadline", sequence());
  assert.deepEqual(
    [deadline.nodes[3].anchor, deadline.nodes[3].offsetMinutes, deadline.messages[deadline.nodes[3].id].validity],
    ["expires", 180, { mode: "with_anchor" }],
    "Faltam 3 horas: 3 h antes de vencer, some com a principal"
  );
  assert.equal(templates.buildFlowTemplate("welcome", sequence()).entry.mode, "new_only");
  assert.deepEqual(templates.buildFlowTemplate("blank", sequence()).nodes.length, 1, "so Quem entra");
});

test("alteracoes em andamento: a mesma arvore com as regras em outra ordem nao conta como mudanca", () => {
  const draft = templates.buildFlowTemplate("unopened", sequence());
  const mesma = JSON.parse(JSON.stringify(draft));
  mesma.nodes = [...mesma.nodes].reverse();

  assert.ok(vm.isSameFlowDraft(draft, mesma));
  assert.ok(!vm.isSameFlowDraft(draft, { ...draft, name: "Outro nome" }));
  assert.ok(!vm.entryRulesChanged(draft, mesma));
  assert.ok(vm.entryRulesChanged(draft, { ...draft, entry: { ...draft.entry, audience: temAcesso("formacao-ia") } }));
  assert.deepEqual(vm.removedStepIds(draft, vm.removeFlowStep(draft, draft.nodes[2].id, "subtree")), [draft.nodes[2].id, draft.nodes[3].id]);
});

/* ------------------------------------------------------------------------------------------------
 * Relatorio
 * ---------------------------------------------------------------------------------------------- */

const STATS = {
  accepted: 30,
  audio_completed: 90,
  audio_started: 120,
  cap: 2,
  clicked: 60,
  declined: 10,
  deferred_now: 3,
  expired: 4,
  failed: 0,
  filtered: 12,
  goal: 6,
  no_count: 160,
  opened: 180,
  reached: 300,
  received: 260,
  removed: 4,
  seen: 220,
  sent: 260,
  studied_7d: 50,
  visited_cta: 40,
  waiting: 12,
  yes_count: 120
};

test("relatorio: funil da notificacao com a parte do anterior, so o que ela tem; sem numeros, '—'", () => {
  const lines = vm.messageReportLines(STATS, { ctaTracked: true, hasAudio: true, hasCta: true, hasResponse: true });

  assert.deepEqual(
    lines.map((line) => line.label),
    [
      "Chegaram",
      "Esperando",
      "Receberam",
      "Viram no sino",
      "Abriram",
      "Começaram o áudio",
      "Ouviram até o fim",
      "Foram para o destino",
      "Visitaram a página do destino",
      "Aceitaram",
      "Recusaram",
      "Voltaram a estudar em 7 dias"
    ]
  );
  assert.equal(lines.find((line) => line.id === "seen").share, "84,6%");
  assert.equal(lines.find((line) => line.id === "reached").share, null);

  const simples = vm.messageReportLines(STATS, { ctaTracked: false, hasAudio: false, hasCta: true, hasResponse: false });
  assert.ok(!simples.some((line) => line.id === "audio_started" || line.id === "visited_cta" || line.id === "accepted"));

  const vazio = vm.messageReportLines(null, { ctaTracked: false, hasAudio: false, hasCta: false, hasResponse: false });
  assert.ok(vazio.every((line) => line.value === null && vm.formatReportValue(line.value) === "—"));

  const naoReceberam = vm.notReceivedLines(STATS);
  assert.equal(naoReceberam.total, 28);
  assert.equal(naoReceberam.deferred, 3);
  // "removido" de 7.8 junta passo removido, retirado do sino, Encerrar e a principal retirada: o rotulo diz isso.
  assert.equal(
    vm.describeNotReceived(naoReceberam.parts),
    "fora do filtro 12 · atingiram o objetivo antes 6 · venceu o prazo 4 · limite do dia 2 · passo removido, retirado ou fluxo encerrado 4"
  );
  assert.equal(naoReceberam.parts.find((part) => part.id === "cap").help, vm.CAP_HELP);
  assert.match(vm.CAP_HELP, /^Não saiu por causa do limite de 3 por dia/);
});

test("relatorio: condicao, quem entra e a linha de atraso so quando ha fila vencida", () => {
  assert.deepEqual(
    vm.conditionReportLines(STATS).map((line) => [line.label, line.value]),
    [
      ["Chegaram", 300],
      ["Sim", 120],
      ["Não", 160],
      ["Esperando", 12]
    ]
  );

  const totals = { active: 140, done: 130, ended: 3, entered: 318, goal: 45, sent: 600 };
  const entrada = vm.entryReportLines({ enteredToday: 12, hasGoal: true, origin: "builder", sourceRecipients: null, totals });
  assert.deepEqual(
    entrada.map((line) => [line.label, line.value]),
    [
      ["Entraram", 318],
      ["No fluxo agora", 140],
      ["Atingiram o objetivo", 45],
      ["Terminaram", 133]
    ]
  );
  assert.equal(entrada[0].help, "12 hoje");
  assert.equal(vm.entryReportLines({ enteredToday: 0, hasGoal: false, origin: "builder", sourceRecipients: null, totals })[2].value, null, "sem objetivo: —");
  assert.equal(vm.entryReportLines({ enteredToday: 0, hasGoal: false, origin: "notice", sourceRecipients: 318, totals })[0].label, "Receberam a notificação principal");

  assert.equal(vm.backlogLine(0), null);
  assert.equal(vm.backlogLine(null), null);
  assert.equal(vm.backlogLine(1240), "Algumas notificações estão saindo com atraso (fila de 1.240).");
  assert.equal(vm.removedStepLabel("2026-10-21T15:00:00.000Z"), "Passo removido em 21/10");
});

test("vocabulario: nada de campanha, publico, audiencia, evento, oferta, gatilho, automacao ou lembrete nas frases da tela", () => {
  const texts = [
    ...Object.values(vm.FLOW_SITUATION_LABELS),
    ...Object.values(vm.FLOW_ACTION_LABELS),
    ...Object.values(vm.FLOW_TOASTS),
    ...Object.values(vm.FLOW_EMPTY_COPY).flatMap((copy) => [copy.title, copy.description]),
    ...vm.ENTRY_MODE_OPTIONS.flatMap((option) => [option.label, option.help]),
    vm.DAILY_LIMIT_TEXT,
    vm.LIVE_EDIT_BANNER,
    vm.FILTER_HINT,
    vm.WAIT_UNTIL_HINT,
    vm.GOAL_HINT,
    ...templates.FLOW_TEMPLATES.flatMap((template) => [template.title, template.description, template.steps])
  ];

  for (const text of texts) {
    assert.doesNotMatch(text, /campanha|público|audiência|evento|oferta|gatilho|automaç|lembrete/i, text);
  }
});

/* ------------------------------------------------------------------------------------------------
 * v3a (docs/24 §2.6 e §2.7): reacoes e enquete nas regras e no relatorio do fluxo
 * ---------------------------------------------------------------------------------------------- */

const SABADO = "a1b2c3d4";
const DOMINGO = "e5f6a7b8";
const enquete = { closesAt: null, multiple: false, options: [{ id: SABADO, label: "Sábado" }, { id: DOMINGO, label: "Domingo" }], question: "Qual dia?", showResults: true };

test("v3a: as notificacoes acima trazem reacoes e enquete (do passo e da principal); as opcoes entram nos nomes", () => {
  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [entrada, primeira, , lembrete] = draft.nodes;
  const comEnquete = { ...draft, messages: { ...draft.messages, [primeira.id]: { ...draft.messages[primeira.id], body: "Curta.", cta: null, poll: enquete } } };
  const [acima] = vm.flowContextAbove(comEnquete, lembrete.id).messages;

  assert.equal(acima.allowsReactions, true, "passo novo ja permite reacoes");
  assert.equal(acima.hasPoll, true);
  assert.deepEqual(acima.pollOptions, enquete.options);
  assert.equal(acima.canOpen, true, "enquete e algo para abrir");
  assert.equal(vm.flowContextAbove({ ...comEnquete, messages: { ...comEnquete.messages, [primeira.id]: { ...comEnquete.messages[primeira.id], poll: null } } }, lembrete.id).messages[0].canOpen, false, "texto curto sem nada: nada a abrir");

  const source = { allowsReactions: true, body: "", ctaHref: null, hasAudio: false, hasPoll: true, hasResponse: false, id: id(99), pollOptions: [{ id: "c0c0c0c0", label: "Manhã" }], title: "Oferta especial!", validUntil: null, validityMinutes: 1_440 };
  const aviso = { ...comEnquete, origin: "notice" };
  const [principal] = vm.flowContextAbove(aviso, primeira.id, source).messages;
  assert.deepEqual([principal.nodeId, principal.allowsReactions, principal.hasPoll, principal.canOpen], [entrada.id, true, true, true]);
  assert.deepEqual(vm.sourceMetaOf(source).pollOptionIds, ["c0c0c0c0"]);
  assert.equal(vm.sourceMetaOf(source).allowsReactions, true);
  assert.equal(vm.sourceMetaOf({ ...source, allowsReactions: undefined, hasPoll: undefined, pollOptions: undefined }).hasPoll, false, "principal sem os campos da v3a");

  const nomes = vm.flowAudienceNames(names, aviso, source);
  assert.deepEqual(nomes.pollOptions, { [`node:${entrada.id}`]: { c0c0c0c0: "Manhã" }, [`node:${primeira.id}`]: { [DOMINGO]: "Domingo", [SABADO]: "Sábado" } });
  assert.equal("pollOptions" in vm.flowAudienceNames(names, draft), false, "sem enquete, sem a chave");
});

test("v3a: a conferencia do construtor recusa 'reagiu' sem reacoes e 'votou' numa opcao que saiu", () => {
  const draft = templates.buildFlowTemplate("deadline", sequence());
  const [entrada, primeira, condicao] = draft.nodes;
  const comCondicao = (rule, messages = draft.messages, origin = draft.origin) => ({
    ...draft,
    messages,
    nodes: draft.nodes.map((node) => (node.id === condicao.id ? { ...node, condition: regras(rule) } : node)),
    origin
  });
  const saveIssues = (value, source = null) => vm.flowIssuesOf(value, source).filter((issue) => issue.level === "save" && issue.nodeId === condicao.id).map((issue) => issue.message);
  const votou = (choice) => ({ action: "voted", choice, negate: false, ref: { kind: "node", nodeId: primeira.id }, type: "message" });
  const comEnquete = { ...draft.messages, [primeira.id]: { ...draft.messages[primeira.id], poll: enquete } };

  assert.deepEqual(saveIssues(comCondicao(votou(SABADO))), ["A notificação escolhida não tem enquete. Escolha outra regra."]);
  assert.deepEqual(saveIssues(comCondicao(votou(SABADO), comEnquete)), []);
  assert.deepEqual(saveIssues(comCondicao(votou("f0f0f0f0"), comEnquete)), ["Esta opção não existe mais na enquete. Escolha outra."]);

  const reagiu = { action: "reacted", negate: false, ref: { kind: "node", nodeId: primeira.id }, type: "message" };
  assert.deepEqual(saveIssues(comCondicao(reagiu)), [], "os modelos ja permitem reacoes");
  assert.deepEqual(saveIssues(comCondicao(reagiu, { ...draft.messages, [primeira.id]: { ...draft.messages[primeira.id], reactions: false } })), ["A notificação escolhida não aceita reações. Escolha outra regra."]);

  // Na principal (fluxo de aviso), pelo que o aviso de origem tem.
  const source = { body: "", ctaHref: null, hasAudio: false, hasResponse: false, id: id(99), title: "Oferta", validUntil: null, validityMinutes: 1_440 };
  const naPrincipal = comCondicao({ action: "voted", negate: true, ref: { kind: "node", nodeId: entrada.id }, type: "message" }, draft.messages, "notice");
  assert.deepEqual(saveIssues(naPrincipal, source), ["A notificação escolhida não tem enquete. Escolha outra regra."]);
  assert.deepEqual(saveIssues(naPrincipal, { ...source, hasPoll: true, pollOptions: enquete.options }), []);
});

test("v3a: relatorio do passo com 'Votaram' e 'Reagiram' (parte de quem abriu) e uma linha por opcao da enquete", () => {
  const lines = vm.messageReportLines(STATS, { allowsReactions: true, ctaTracked: false, hasAudio: false, hasCta: false, hasPoll: true, hasResponse: false }, { reacted: 45, voters: 90 });

  assert.deepEqual(lines.map((line) => line.label), ["Chegaram", "Esperando", "Receberam", "Viram no sino", "Abriram", "Votaram", "Reagiram", "Voltaram a estudar em 7 dias"]);
  assert.deepEqual(lines.find((line) => line.id === "voted"), { id: "voted", label: "Votaram", share: "50%", value: 90 });
  assert.deepEqual(lines.find((line) => line.id === "reacted"), { id: "reacted", label: "Reagiram", share: "25%", value: 45 });
  assert.equal(vm.messageReportLines(STATS, { allowsReactions: true, ctaTracked: false, hasAudio: false, hasCta: false, hasResponse: false }).find((line) => line.id === "reacted").value, 0, "sem interacoes: 0");
  assert.equal(vm.messageReportLines(null, { allowsReactions: true, ctaTracked: false, hasAudio: false, hasCta: false, hasResponse: false }, { reacted: 3, voters: 0 }).find((line) => line.id === "reacted").value, null, "nunca ativado: —");
  assert.ok(!vm.messageReportLines(STATS, { ctaTracked: false, hasAudio: false, hasCta: false, hasResponse: false }).some((line) => line.id === "voted" || line.id === "reacted"), "forma da v2");

  const content = { audio: null, cta: null, poll: enquete, reactions: true, response: null };
  const interactions = { pollOptions: { [SABADO]: 60, [DOMINGO]: 30, f0f0f0f0: 4 }, pollVoters: 90, reacted: 45 };
  const step = vm.messageStepLines(STATS, content, interactions);

  assert.deepEqual(step.map((line) => line.label), ["Chegaram", "Esperando", "Receberam", "Viram no sino", "Abriram", "Votaram", "“Sábado”", "“Domingo”", "Opção removida", "Reagiram", "Voltaram a estudar em 7 dias"]);
  assert.deepEqual(step.find((line) => line.id === `poll:${SABADO}`), { id: `poll:${SABADO}`, label: "“Sábado”", share: "67%", value: 60 });
  assert.deepEqual(step.find((line) => line.id === "poll:f0f0f0f0"), { id: "poll:f0f0f0f0", label: "Opção removida", share: "4%", value: 4 }, "opcao de outra versao do passo");
  assert.deepEqual(vm.stepPollLines(enquete, null).map((line) => [line.label, line.value, line.share]), [["“Sábado”", 0, "0%"], ["“Domingo”", 0, "0%"]]);
  assert.deepEqual(vm.stepPollLines(null, interactions), []);
  assert.deepEqual(vm.messageStepLines(STATS, { audio: null, cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" }, response: null }).map((line) => line.label).slice(5), ["Foram para o destino", "Visitaram a página do destino", "Voltaram a estudar em 7 dias"]);
});
