import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunicacao v3a, ajustes depois do primeiro teste do produtor (telas da equipe, docs/24): "Fica no sino
// por" -> "Outro" -> "Por um tempo" em minutos tambem (a partir de 5; o tempo gravado reabre na maior
// unidade exata), "Permitir que o aluno exclua do sino" (allowHide, ligado por padrao no aviso, na seguinte
// e no passo do fluxo; a previa tira o "⋯" quando desligado) e a enquete travada num passo de fluxo no ar
// que ja chegou a alguem. Modulos puros dos editores (notices, follow-ups e flows view models) com os
// schemas do servidor para as mensagens.

const notices = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const followUps = await import("../src/components/admin/v2/communication/follow-ups-view-model.ts");
const flows = await import("../src/components/admin/v2/communication/flows/flows-view-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const flowSchemas = await import("../src/server/communications/flow-schemas.ts");
const meta = await import("../src/server/communications/message-meta.ts");
const bell = await import("../src/components/member/notifications/notifications-model.ts");

const NOW = Date.parse("2026-10-22T15:00:00.000Z");
const createdAt = new Date(NOW - notices.PREVIEW_AGE_MS).toISOString();
const ENTRADA = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const SEGUINTE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const notificacao = (extra = {}) => ({ ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Aula nova no ar", ...extra });

function semLixeira(value) {
  const copia = { ...value };
  delete copia.allowHide;
  return copia;
}

function problemas(schema, value) {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

/* ------------------------------------------------------------------------------------------------
 * "Por um tempo" em minutos, horas ou dias
 * ---------------------------------------------------------------------------------------------- */

test("por um tempo: a unidade 'minutos' vem antes de 'horas' e 'dias'", () => {
  assert.deepEqual(
    notices.VALIDITY_UNIT_OPTIONS.map((option) => [option.label, option.value]),
    [
      ["minutos", "minutes"],
      ["horas", "hours"],
      ["dias", "days"]
    ]
  );
});

test("por um tempo: o tempo gravado reabre na maior unidade exata (1440 = 1 dia, 120 = 2 horas, 90 = 90 minutos)", () => {
  assert.deepEqual(notices.validityDurationParts(1_440), { amount: 1, unit: "days" });
  assert.deepEqual(notices.validityDurationParts(2_880), { amount: 2, unit: "days" });
  assert.deepEqual(notices.validityDurationParts(129_600), { amount: 90, unit: "days" }, "o teto de 90 dias");
  assert.deepEqual(notices.validityDurationParts(120), { amount: 2, unit: "hours" });
  assert.deepEqual(notices.validityDurationParts(60), { amount: 1, unit: "hours" });
  assert.deepEqual(notices.validityDurationParts(1_500), { amount: 25, unit: "hours" }, "25 horas nao fecha em dias");
  assert.deepEqual(notices.validityDurationParts(90), { amount: 90, unit: "minutes" });
  assert.deepEqual(notices.validityDurationParts(5), { amount: 5, unit: "minutes" });
  assert.deepEqual(notices.validityDurationParts(1_441), { amount: 1_441, unit: "minutes" }, "nunca arredonda para horas");

  const invalido = notices.validityDurationParts(Number.NaN);
  assert.ok(Number.isNaN(invalido.amount), "numero invalido continua invalido");

  // Ida e volta: o que reabre grava o mesmo numero de minutos.
  for (const minutes of [5, 30, 59, 90, 120, 600, 1_440, 1_500, 4_320, 129_600]) {
    const parts = notices.validityDurationParts(minutes);
    assert.equal(notices.validityDurationMinutes(parts.amount, parts.unit), minutes, String(minutes));
  }
});

test("por um tempo: numero e unidade viram minutos; 5 minutos vale, 4 da 'No mínimo 5 minutos.' e o teto continua 90 dias", () => {
  assert.equal(notices.validityDurationMinutes(5, "minutes"), 5);
  assert.equal(notices.validityDurationMinutes(90, "minutes"), 90);
  assert.equal(notices.validityDurationMinutes(2, "hours"), 120);
  assert.equal(notices.validityDurationMinutes(1, "days"), 1_440);
  assert.ok(Number.isNaN(notices.validityDurationMinutes(Number.NaN, "minutes")));

  const duracao = (amount, unit) => ({ minutes: notices.validityDurationMinutes(amount, unit), mode: "duration" });

  assert.equal(schemas.validitySchema.safeParse(duracao(5, "minutes")).success, true, "5 minutos");
  assert.equal(schemas.validitySchema.safeParse(duracao(4, "minutes")).error.issues[0].message, "No mínimo 5 minutos.");
  assert.equal(schemas.validitySchema.safeParse(duracao(90, "days")).success, true, "90 dias");
  assert.equal(schemas.validitySchema.safeParse(duracao(91, "days")).error.issues[0].message, "No máximo 90 dias.");

  // O erro chega no campo do numero, no aviso e no conteudo da seguinte ou do passo do fluxo.
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ validity: duracao(4, "minutes") })), [["validity.minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ validity: duracao(5, "minutes") })), []);
  const passo = { ...flows.newMessageContent(), title: "Faltam poucos minutos" };
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, { ...passo, validity: duracao(4, "minutes") }), [["validity.minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, { ...passo, validity: duracao(5, "minutes") }), []);
});

test("por um tempo em minutos: 'Outro' na pilula, a frase do cartao e o 'Termina em 30 min' da previa", () => {
  assert.equal(notices.validityChoiceOf({ minutes: 90, mode: "duration" }), "other");
  assert.equal(meta.describeValidity({ minutes: 90, mode: "duration" }), "fica 90 minutos no sino");
  assert.equal(followUps.followUpValidityLine({ minutes: 30, mode: "duration" }, "main"), "Fica 30 minutos no sino");
  assert.equal(notices.showsUrgencyHint({ minutes: 30, mode: "duration" }, NOW), true, "a dica do 'Termina em' continua valendo");

  const item = notices.draftToNotificationItem(notificacao({ validity: { minutes: 30, mode: "duration" } }), { createdAt });
  assert.equal(item.expiresAt, new Date(Date.parse(createdAt) + 30 * 60_000).toISOString());
  assert.equal(meta.urgencyLabel(item, NOW), "Termina em 30 min", "chegou ha instantes: como o aluno ve logo depois do envio");
});

/* ------------------------------------------------------------------------------------------------
 * "Permitir que o aluno exclua do sino" (allowHide)
 * ---------------------------------------------------------------------------------------------- */

test("allowHide: aviso, seguinte e passo de fluxo novos ja deixam o aluno excluir", () => {
  assert.equal(schemas.emptyNoticeDraft("inbox").allowHide, true);
  assert.equal(followUps.emptyFollowUpContent().allowHide, true);
  assert.equal(flows.newMessageContent().allowHide, true);

  const seguinte = followUps.newFollowUpItem(SEGUINTE, followUps.followUpParentOf(ENTRADA, "main", notificacao()));
  assert.equal(seguinte.content.allowHide, true);
});

test("allowHide: rascunho canonico, comparacao, tipo e o 'Recarregar' depois de um 409", () => {
  const base = notificacao();

  assert.equal(notices.canonicalNoticeDraft(base).allowHide, true);
  assert.equal(notices.canonicalNoticeDraft(semLixeira(base)).allowHide, true, "rascunho antigo sem o campo: pode excluir");
  assert.equal(notices.canonicalNoticeDraft({ ...base, allowHide: false }).allowHide, false);
  assert.equal(notices.canonicalNoticeDraft({ ...base, allowHide: false, kind: "popup" }).allowHide, true, "o pop-up nao tem lixeira");

  assert.equal(notices.isSameNoticeDraft(base, { ...base, allowHide: false }), false, "desligar e uma mudanca nao salva");
  assert.equal(notices.isSameNoticeDraft(semLixeira(base), { ...base, allowHide: true }), true, "ausente = true");

  assert.equal(notices.noticeDraftForKind({ ...base, allowHide: false }).allowHide, false, "a notificacao manda o que escolheu");
  assert.equal(notices.noticeDraftForKind({ ...base, allowHide: false, kind: "popup" }).allowHide, true);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notices.noticeDraftForKind({ ...base, allowHide: false })), []);

  // O produtor desligou aqui; outra tela mudou o titulo: fica o desligado e o titulo novo.
  const rebased = notices.rebaseNoticeDraft(base, { ...base, allowHide: false }, { ...base, title: "Título de outra tela" });
  assert.equal(rebased.allowHide, false);
  assert.equal(rebased.title, "Título de outra tela");
  // Ele nao mexeu; a outra tela desligou: segue o banco.
  assert.equal(notices.rebaseNoticeDraft(base, base, { ...base, allowHide: false }).allowHide, false);
});

test("allowHide: muda depois do envio (nao trava como o audio e a enquete)", () => {
  const saved = notificacao();

  assert.deepEqual(schemas.sentNoticeLockedProblems(saved, { ...saved, allowHide: false }), []);
  assert.equal("allowHide" in notices.SENT_NOTICE_COPY.locked, false);
});

test("allowHide: a previa mostra o botao de excluir so quando o aluno pode excluir", () => {
  const ligado = notices.draftToNotificationItem(notificacao(), { createdAt });
  const desligado = notices.draftToNotificationItem(notificacao({ allowHide: false }), { createdAt });
  const antigo = notices.draftToNotificationItem(semLixeira(notificacao()), { createdAt });

  assert.equal(ligado.allowHide, true);
  assert.equal(bell.canHideNotification(ligado), true);
  assert.equal(desligado.allowHide, false);
  assert.equal(bell.canHideNotification(desligado), false, "sem o excluir no cartao da previa");
  assert.equal(bell.canHideNotification(antigo), true, "conteudo sem o campo: como sempre foi");
});

test("allowHide: a seguinte gravada reabre com o que tinha (sem o campo = ligado) e volta igual para o servidor", () => {
  const main = followUps.followUpParentOf(ENTRADA, "main", notificacao());
  const conteudo = (extra) => ({ ...followUps.emptyFollowUpContent(), title: "Faltam 3 horas", ...extra });
  const gravada = (content) => ({
    campaignId: "c1",
    children: [],
    content,
    id: SEGUINTE,
    when: { anchor: "sent", minutes: 1_440 },
    who: followUps.quickChoiceRules(followUps.defaultQuickChoice(main), main, null) ?? { kind: "everyone" }
  });

  const [antiga] = followUps.followUpFormItemsOf([gravada(semLixeira(conteudo()))], main);
  assert.equal(antiga.content.allowHide, true);

  const [desligada] = followUps.followUpFormItemsOf([gravada(conteudo({ allowHide: false }))], main);
  assert.equal(desligada.content.allowHide, false);

  const [draft] = followUps.followUpDraftsOf([desligada], main);
  assert.equal(draft.content.allowHide, false);
  assert.equal(flowSchemas.flowNoticeContentSchema.parse(draft.content).allowHide, false, "o servidor recebe o desligado");

  // Reabrir sem mudar nada nao conta como mudanca nao aplicada.
  const stop = { enabled: false, kind: "product", productId: null };
  const [religada] = followUps.followUpFormItemsOf([gravada(conteudo({ allowHide: true }))], main);
  assert.equal(followUps.followUpsStateKey([antiga], stop, main), followUps.followUpsStateKey([religada], stop, main));
});

test("allowHide: o texto do campo", () => {
  assert.equal(notices.NOTICE_INTERACTION_COPY.allowHideLabel, "Permitir que o aluno exclua do sino");
  assert.equal(
    notices.NOTICE_INTERACTION_COPY.allowHideOn,
    "Mostra a opção de excluir na notificação. O aluno exclui só do sino dele; nos relatórios continua como recebida."
  );
  assert.ok(notices.NOTICE_INTERACTION_COPY.allowHideOff.length > 0);

  for (const text of [notices.NOTICE_INTERACTION_COPY.allowHideLabel, notices.NOTICE_INTERACTION_COPY.allowHideOn, notices.NOTICE_INTERACTION_COPY.allowHideOff]) {
    assert.doesNotMatch(text, /campanha|público|audiência|evento|oferta/i, text);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Enquete de um passo no ar que ja chegou a alguem
 * ---------------------------------------------------------------------------------------------- */

test("enquete travada: so no fluxo no ar (ou pausado) quando o passo ja chegou a alguem", () => {
  const motivo =
    "A enquete não muda depois que esta notificação chegou a alguém: os votos já dados ficariam com outro texto. Para outra enquete, crie uma notificação seguinte nova.";

  assert.equal(flows.LIVE_POLL_LOCKED_NOTE, motivo);
  assert.deepEqual(flows.livePollLockedFields({ live: true, received: 3 }), { poll: motivo });
  assert.deepEqual(flows.livePollLockedFields({ live: true, received: 1 }), { poll: motivo });
  assert.equal(flows.livePollLockedFields({ live: true, received: 0 }), undefined, "ninguem recebeu ainda: renomear nao estraga voto");
  assert.equal(flows.livePollLockedFields({ live: true, received: undefined }), undefined, "passo novo, sem numeros");
  assert.equal(flows.livePollLockedFields({ live: true, received: null }), undefined);
  assert.equal(flows.livePollLockedFields({ live: false, received: 3 }), undefined, "rascunho: o servidor nao recusa");
});

test("enquete travada e lixeira: as telas passam o travamento e o campo novo", async () => {
  const read = (file) => readFile(new URL(`../src/components/admin/v2/communication/${file}`, import.meta.url), "utf8");
  const inspector = await read("flows/flow-inspector.tsx");
  const sheet = await read("follow-up-sheet.tsx");
  const followUpsCard = await read("notice-follow-ups.tsx");
  const content = await read("notice-content-fields.tsx");
  const validity = await read("notice-validity-field.tsx");
  const editor = await read("notice-editor.tsx");

  assert.match(inspector, /lockedFields=\{livePollLockedFields\(\{ live: context\.live, received \}\)\}/);
  assert.match(followUpsCard, /lockedFields=\{livePollLockedFields\(\{ live: flowLive, received: stats\[editing\.item\.id\]\?\.received \}\)\}/);
  assert.match(sheet, /lockedFields=\{lockedFields\}/);

  assert.match(content, /NOTICE_INTERACTION_COPY\.allowHideLabel/);
  assert.match(content, /onChange\(\{ allowHide: next \}\)/);
  assert.match(content, /id=\{id\("excluir"\)\}/);
  assert.match(content, /NoticeLockedFields = Partial<Record<"audio" \| "poll" \| "responseMode", string>>/, "a lixeira nao entra nos campos travados");
  assert.match(editor, /\["allowHide", "#aviso-excluir"\]/);

  assert.match(validity, /options=\{VALIDITY_UNIT_OPTIONS\}/);
  assert.doesNotMatch(validity, /1 hora a 90 dias/);
});
