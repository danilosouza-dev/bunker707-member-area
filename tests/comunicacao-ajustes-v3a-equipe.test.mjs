import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Comunicacao v3a, ajustes depois do primeiro teste do produtor (lado da equipe, docs/24): "Permitir que o
// aluno exclua do sino" por notificacao (allowHide, padrao true, no aviso, no conteudo das seguintes e dos
// passos de fluxo; muda depois do envio), "Por um tempo" a partir de 5 minutos e a frase da enquete travada
// num passo que ja chegou a alguem. Modulos puros (schemas.ts e flow-schemas.ts) e o rascunho <-> colunas
// (store.ts, flow-store.ts e flow-queries.ts, sem banco: so as funcoes puras deles).

const schemas = await import("../src/server/communications/schemas.ts");
const flowSchemas = await import("../src/server/communications/flow-schemas.ts");
const store = await import("../src/server/communications/store.ts");
const flowStore = await import("../src/server/communications/flow-store.ts");
const flowQueries = await import("../src/server/communications/flow-queries.ts");

const PASSO = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

function problemas(schema, value) {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const notificacao = (extra = {}) => ({ ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Oferta especial!", ...extra });
/** O rascunho como um editor de antes dos ajustes manda (sem o campo). */
function semLixeira(draft) {
  const copia = { ...draft };
  delete copia.allowHide;
  return copia;
}

const conteudo = (extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, reactions: true, response: null, sender: null, title: "Lembrete", ...extra });

/* ------------------------------------------------------------------------------------------------
 * Lixeira do aluno por notificacao (allowHide)
 * ---------------------------------------------------------------------------------------------- */

test("allowHide: o rascunho novo ja deixa excluir, o antigo sem o campo vale true e o false fica gravado", () => {
  assert.equal(schemas.emptyNoticeDraft("inbox").allowHide, true);
  assert.equal(schemas.emptyNoticeDraft("popup").allowHide, true);

  const antigo = semLixeira(notificacao());
  assert.equal(schemas.noticeDraftSchema.parse(antigo).allowHide, true, "rascunho de antes dos ajustes = com lixeira");
  assert.equal(schemas.noticeDraftSchema.parse(notificacao({ allowHide: false })).allowHide, false);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ allowHide: "não" })), [["allowHide", "Escolha se o aluno pode excluir do sino."]]);

  // O pop-up nao vai para o sino: o campo nao e recusado (o servidor grava o padrao).
  assert.deepEqual(problemas(schemas.noticeDraftSchema, { ...schemas.emptyNoticeDraft("popup"), allowHide: false, title: "Turma nova" }), []);
});

test("allowHide no conteudo: notificacao do sino, seguinte e passo de fluxo (padrao true)", () => {
  assert.equal(schemas.noticeContentSchema.parse(conteudo()).allowHide, true);
  assert.equal(schemas.noticeContentSchema.parse(conteudo({ allowHide: false })).allowHide, false);
  assert.equal(flowSchemas.flowNoticeContentSchema.parse(conteudo()).allowHide, true);
  assert.equal(flowSchemas.flowNoticeContentSchema.parse(conteudo({ allowHide: false })).allowHide, false);

  const seguinte = flowSchemas.followUpDraftSchema.parse({
    content: conteudo({ allowHide: false }),
    id: PASSO,
    when: { anchor: "sent", minutes: 60 },
    who: { kind: "everyone" }
  });
  assert.equal(seguinte.content.allowHide, false);
});

test("allowHide muda depois do envio (nao trava a notificacao enviada)", () => {
  const salvo = schemas.noticeDraftSchema.parse(notificacao({ schedule: { mode: "now" } }));

  assert.deepEqual(schemas.sentNoticeLockedProblems(salvo, { ...salvo, allowHide: false }), []);
  assert.deepEqual(schemas.sentNoticeLockedProblems({ ...salvo, allowHide: false }, { ...salvo, allowHide: true }), []);
});

/** Linha de campaigns a partir das colunas que a equipe escreve (o resto como o banco devolve). */
function linhaDe(columns, extra = {}) {
  return {
    ...columns,
    approved_at: null,
    approved_by: null,
    audience_count: null,
    audience_counted_at: null,
    audience_refreshed_at: null,
    created_at: "2026-10-22T15:00:00.000Z",
    created_by: null,
    deleted_at: null,
    deleted_by: null,
    dispatch_attempts: 0,
    dispatch_started_at: null,
    edited_at: null,
    edited_by: null,
    flow_id: null,
    flow_node_id: null,
    id: "00000000-0000-4000-8000-000000000003",
    last_error: null,
    recipients_count: null,
    requested_at: null,
    requested_by: null,
    sent_at: null,
    status: "draft",
    updated_at: "2026-10-22T15:00:00.000Z",
    updated_by: null,
    ...extra
  };
}

test("allowHide <-> campaigns.allow_hide: notificacao grava o que a equipe escolheu; pop-up grava o padrao", () => {
  assert.equal(store.draftToColumns(notificacao()).allow_hide, true);
  assert.equal(store.draftToColumns(notificacao({ allowHide: false })).allow_hide, false);
  assert.equal(store.draftToColumns({ ...schemas.emptyNoticeDraft("popup"), allowHide: false, title: "Turma nova" }).allow_hide, true, "pop-up nao vai para o sino");

  assert.equal(store.draftToColumns(semLixeira(notificacao())).allow_hide, true, "rascunho sem o campo = com lixeira");

  assert.equal(store.rowToDraft(linhaDe(store.draftToColumns(notificacao({ allowHide: false })))).allowHide, false);
  assert.equal(store.rowToDraft(linhaDe(store.draftToColumns(notificacao()))).allowHide, true);
  assert.equal(store.rowToDraft(linhaDe(store.draftToColumns(notificacao()), { allow_hide: undefined })).allowHide, true, "linha sem a coluna = com lixeira");
  assert.ok(store.CAMPAIGN_COLUMNS.split(",").includes("allow_hide"));
  assert.ok(store.SENT_EDITABLE_COLUMNS.includes("allow_hide"), "muda depois do envio");
});

test("allowHide nos passos: conteudo -> colunas, linha -> conteudo do construtor (o salvar de novo nao perde)", () => {
  assert.equal(flowStore.flowContentColumns(conteudo({ validity: { mode: "default" } })).allow_hide, true);
  assert.equal(flowStore.flowContentColumns(conteudo({ allowHide: false, validity: { mode: "default" } })).allow_hide, false);

  const linha = linhaDe(flowStore.flowContentColumns(conteudo({ allowHide: false, validity: { mode: "default" } })));
  assert.equal(flowQueries.flowContentOfRow(linha, false).allowHide, false);
  assert.equal(flowQueries.flowContentOfRow({ ...linha, allow_hide: true }, true).allowHide, true);
});

/* ------------------------------------------------------------------------------------------------
 * "Por um tempo" a partir de 5 minutos
 * ---------------------------------------------------------------------------------------------- */

test("validade: de 5 minutos a 90 dias (4 minutos recusa com 'No mínimo 5 minutos.')", () => {
  const validade = (validity) => problemas(schemas.validitySchema, validity);

  assert.equal(schemas.VALIDITY_MIN_MINUTES, 5);
  assert.deepEqual(validade({ minutes: 5, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 30, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 59, mode: "duration" }), [], "menos de 1 hora agora vale");
  assert.deepEqual(validade({ minutes: 129_600, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 4, mode: "duration" }), [["minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(validade({ minutes: 0, mode: "duration" }), [["minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(validade({ minutes: 129_601, mode: "duration" }), [["minutes", "No máximo 90 dias."]]);
  assert.deepEqual(validade({ minutes: 7.5, mode: "duration" }), [["minutes", "Use de 5 minutos a 90 dias."]]);
  assert.deepEqual(validade({ minutes: Number.NaN, mode: "duration" }), [["minutes", "Use de 5 minutos a 90 dias."]]);

  // A mesma regra nas seguintes e nos passos de fluxo, e no rascunho do aviso.
  assert.deepEqual(problemas(schemas.flowValiditySchema, { minutes: 5, mode: "duration" }), []);
  assert.deepEqual(problemas(schemas.flowValiditySchema, { minutes: 4, mode: "duration" }), [["minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ validity: { minutes: 5, mode: "duration" } })), []);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ validity: { minutes: 4, mode: "duration" } })), [["validity.minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, conteudo({ validity: { minutes: 4, mode: "duration" } })), [["validity.minutes", "No mínimo 5 minutos."]]);
});

/* ------------------------------------------------------------------------------------------------
 * Enquete de um passo que ja chegou a alguem
 * ---------------------------------------------------------------------------------------------- */

test("a frase da enquete travada num passo de fluxo no ar", async () => {
  const flows = await import("../src/components/admin/v2/communication/flows/flows-view-model.ts");

  assert.equal(
    flowSchemas.FLOW_POLL_LOCKED_MESSAGE,
    "A enquete não muda depois que esta notificação chegou a alguém: os votos já dados ficariam com outro texto. Para outra enquete, crie uma notificação seguinte nova."
  );
  assert.equal(flows.LIVE_POLL_LOCKED_NOTE, flowSchemas.FLOW_POLL_LOCKED_MESSAGE, "a tela e a recusa do servidor dizem o mesmo");
});
