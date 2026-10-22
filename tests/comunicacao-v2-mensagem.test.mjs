import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunicacao v2 (docs/23): o que acompanha o conteudo de cada notificacao. Catalogo do icone ao lado do
// titulo, quanto tempo fica no sino (validade, fim de cada linha e "Termina em"), o icone da escola e os
// schemas de quem envia, icone e validade (no aviso e nas notificacoes dos fluxos). Modulos puros
// (src/server/communications/message-meta.ts, schemas.ts, flow-schemas.ts e audience-model.ts).

const meta = await import("../src/server/communications/message-meta.ts");
const notification = await import("../src/server/communications/notification-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const flowSchemas = await import("../src/server/communications/flow-schemas.ts");
const audience = await import("../src/server/communications/audience-model.ts");
const { FLOW_LIMITS } = await import("../src/server/communications/flow-model.ts");

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// 20/10/2026 12:00 em Sao Paulo.
const now = Date.parse("2026-10-20T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();

const PESSOA = "6f0c1d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";
const AVISO = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PASSO = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const PASSO_2 = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

function problemas(schema, value) {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const notificacao = (extra = {}) => ({ ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Oferta especial!", ...extra });
const popup = (extra = {}) => ({ ...schemas.emptyNoticeDraft("popup"), title: "Turma nova", ...extra });

/* ------------------------------------------------------------------------------------------------
 * Icone ao lado do titulo
 * ---------------------------------------------------------------------------------------------- */

test("catalogo do icone: 16 ids estaveis com nome e cor sugerida, e 5 cores da paleta", () => {
  assert.deepEqual(meta.NOTICE_ICON_IDS, [
    "promo",
    "gift",
    "calendar",
    "live",
    "lesson",
    "book",
    "graduation",
    "sparkles",
    "rocket",
    "flame",
    "trophy",
    "star",
    "clock",
    "mic",
    "megaphone",
    "alert"
  ]);
  assert.deepEqual(meta.NOTICE_ICON_COLORS, ["white", "red", "orange", "amber", "green"]);
  assert.deepEqual(
    meta.NOTICE_ICON_COLORS.map((color) => meta.NOTICE_ICON_COLOR_LABELS[color]),
    ["Branco", "Vermelho", "Laranja", "Amarelo", "Verde"]
  );

  for (const id of meta.NOTICE_ICON_IDS) {
    assert.ok(meta.NOTICE_ICON_LABELS[id], `${id} tem nome`);
    assert.ok(meta.NOTICE_ICON_COLORS.includes(meta.NOTICE_ICON_SUGGESTED_COLOR[id]), `${id} sugere uma cor da paleta`);
    assert.match(id, /^[a-z][a-z0-9_]{1,23}$/, `${id} cabe no formato que o banco confere`);
  }

  assert.equal(meta.NOTICE_ICON_LABELS.promo, "Promoção");
  assert.equal(meta.NOTICE_ICON_SUGGESTED_COLOR.promo, "red", "promoção já marca Vermelho");
  assert.equal(meta.NOTICE_ICON_LABELS.calendar, "Agenda");
  assert.equal(meta.NOTICE_ICON_SUGGESTED_COLOR.gift, "green");
  assert.equal(meta.NOTICE_ICON_SUGGESTED_COLOR.rocket, "orange");
  assert.equal(meta.NOTICE_ICON_SUGGESTED_COLOR.lesson, "white");
});

test("icone gravado: id ou cor fora do catalogo nao desenha nada", () => {
  assert.deepEqual(meta.noticeIconOfColumns("promo", "red"), { color: "red", id: "promo" });
  assert.equal(meta.noticeIconOfColumns("unicornio", "red"), null, "id desconhecido (catalogo mudou no app)");
  assert.equal(meta.noticeIconOfColumns("promo", "blue"), null);
  assert.equal(meta.noticeIconOfColumns(null, null), null);
});

test("schema do icone e de quem envia: so o catalogo, so uma pessoa (uuid) ou a escola", () => {
  assert.deepEqual(problemas(schemas.iconSchema, { color: "red", id: "promo" }), []);
  assert.deepEqual(problemas(schemas.iconSchema, null), []);
  assert.deepEqual(problemas(schemas.iconSchema, { color: "red", id: "unicornio" }), [["id", "Escolha um ícone da lista."]]);
  assert.deepEqual(problemas(schemas.iconSchema, { color: "blue", id: "promo" }), [["color", "Escolha uma cor da lista."]]);

  assert.deepEqual(problemas(schemas.senderSchema, { userId: PESSOA }), []);
  assert.deepEqual(problemas(schemas.senderSchema, null), [], "null = a escola");
  assert.deepEqual(problemas(schemas.senderSchema, { userId: "carlos" }), [["userId", "Escolha alguém da equipe."]]);
  assert.deepEqual(problemas(schemas.senderSchema, "Carlos Lima"), [["", "Escolha alguém da equipe."]], "nome digitado nao vale");
});

/* ------------------------------------------------------------------------------------------------
 * Quanto tempo fica no sino
 * ---------------------------------------------------------------------------------------------- */

test("validade: opcoes rapidas 1, 3, 7, 30 e 90 dias (90 = o padrao, nada gravado)", () => {
  assert.deepEqual(
    meta.VALIDITY_PRESETS.map((preset) => preset.label),
    ["1 dia", "3 dias", "7 dias", "30 dias", "90 dias"]
  );
  assert.deepEqual(meta.VALIDITY_PRESETS.at(-1).validity, { mode: "default" });
  assert.equal(meta.validityPresetDays({ mode: "default" }), 90);
  assert.equal(meta.validityPresetDays({ minutes: 4_320, mode: "duration" }), 3);
  assert.equal(meta.validityPresetDays({ minutes: 300, mode: "duration" }), null, "5 horas = Outro");
  assert.equal(meta.validityPresetDays({ endsAt: iso(now + DAY), mode: "until" }), null);
});

test("validade <-> colunas: padrao sem nada, duracao em minutos, data fixa; 'ate a principal sumir' nao e coluna", () => {
  assert.deepEqual(meta.validityToColumns({ mode: "default" }), { valid_until: null, validity_minutes: null });
  assert.deepEqual(meta.validityToColumns({ minutes: 1_440, mode: "duration" }), { valid_until: null, validity_minutes: 1_440 });
  assert.deepEqual(meta.validityToColumns({ endsAt: "2026-10-21T17:30:00.000Z", mode: "until" }), {
    valid_until: "2026-10-21T17:30:00.000Z",
    validity_minutes: null
  });
  assert.deepEqual(meta.validityToColumns({ mode: "with_anchor" }), { valid_until: null, validity_minutes: null });

  assert.deepEqual(meta.validityOfRow({ valid_until: null, validity_minutes: null }), { mode: "default" });
  assert.deepEqual(meta.validityOfRow({ valid_until: null, validity_minutes: 4_320 }), { minutes: 4_320, mode: "duration" });
  assert.deepEqual(meta.validityOfRow({ valid_until: "2026-10-21T17:30:00+00:00", validity_minutes: null }), {
    endsAt: "2026-10-21T17:30:00+00:00",
    mode: "until"
  });
});

test("fim da linha no sino: o menor entre a data, o tempo escolhido, 90 dias e o fim da notificacao de referencia", () => {
  const padrao = { validUntil: null, validityMinutes: null };

  assert.equal(meta.computeExpiresAt(padrao, now), now + 90 * DAY, "sem escolha: 90 dias");
  assert.equal(meta.computeExpiresAt({ validUntil: null, validityMinutes: 1_440 }, now), now + DAY);
  assert.equal(meta.computeExpiresAt({ validUntil: null, validityMinutes: 129_600 }, now), now + 90 * DAY);
  assert.equal(meta.computeExpiresAt({ validUntil: iso(now + 5 * HOUR), validityMinutes: null }, now), now + 5 * HOUR, "ate uma data");
  assert.equal(meta.computeExpiresAt({ validUntil: now + 5 * HOUR, validityMinutes: null }, now), now + 5 * HOUR, "data em ms");
  assert.equal(meta.computeExpiresAt({ validUntil: iso(now + 120 * DAY), validityMinutes: null }, now), now + 90 * DAY, "nunca mais que 90 dias");

  // "Ate a notificacao principal sumir": o fim da principal deste aluno, nunca mais que a validade.
  assert.equal(meta.computeExpiresAt(padrao, now, now + 3 * HOUR), now + 3 * HOUR);
  assert.equal(meta.computeExpiresAt({ validUntil: null, validityMinutes: 60 }, now, now + 3 * HOUR), now + HOUR);
  assert.equal(meta.computeExpiresAt(padrao, now, null), now + 90 * DAY);

  // Quem chega depois tem o proprio fim, contado da propria chegada.
  assert.equal(meta.computeExpiresAt({ validUntil: null, validityMinutes: 1_440 }, now + 10 * HOUR), now + 34 * HOUR);
});

test("teste para mim: nunca menos de 1 hora, mesmo com 'ate uma data' que ja passou", () => {
  assert.equal(meta.testSendExpiresAt({ validUntil: iso(now - DAY), validityMinutes: null }, now), now + HOUR);
  assert.equal(meta.testSendExpiresAt({ validUntil: iso(now + 10 * MINUTE), validityMinutes: null }, now), now + HOUR);
  assert.equal(meta.testSendExpiresAt({ validUntil: null, validityMinutes: 1_440 }, now), now + DAY);
});

test("'Termina em': so com 24 h ou menos, validade de ate 30 dias, aviso da equipe sem resposta", () => {
  const item = (remaining, extra = {}) => ({
    createdAt: iso(now - HOUR),
    expiresAt: iso(now + remaining),
    kind: "notice",
    response: null,
    ...extra
  });
  const termina = (remaining, extra) => meta.urgencyLabel(item(remaining, extra), now);

  assert.equal(termina(25 * HOUR), null, "25 h: ainda nao");
  assert.equal(termina(24 * HOUR), "Termina em 24 h");
  assert.equal(termina(23 * HOUR + 30 * MINUTE), "Termina em 23 h");
  assert.equal(termina(3 * HOUR + 59 * MINUTE), "Termina em 3 h");
  assert.equal(termina(59 * MINUTE + 30_000), "Termina em 1 h", "59 min 30 s arredonda para 60 min");
  assert.equal(termina(40 * MINUTE), "Termina em 40 min");
  assert.equal(termina(20_000), "Termina em 1 min");
  assert.equal(termina(0), null, "ja venceu");
  assert.equal(termina(3 * HOUR, { createdAt: iso(now + 3 * HOUR - 31 * DAY) }), null, "fica 31 dias: nunca mostra");
  assert.equal(termina(3 * HOUR, { createdAt: iso(now + 3 * HOUR - 30 * DAY) }), "Termina em 3 h", "fica 30 dias: mostra");
  assert.equal(termina(3 * HOUR, { response: { acceptLabel: "Sim", declineLabel: "Não", value: "accepted" } }), null, "ja respondeu");
  assert.equal(termina(3 * HOUR, { response: { acceptLabel: "Sim", declineLabel: "Não", value: null } }), "Termina em 3 h");
  assert.equal(termina(3 * HOUR, { kind: "comment_reply" }), null, "notificacao de comentario");
  assert.equal(meta.urgencyLabel(item(3 * HOUR, { expiresAt: null }), now), null);

  // O padrao de 90 dias nunca mostra, nem no ultimo dia.
  assert.equal(termina(2 * HOUR, { createdAt: iso(now + 2 * HOUR - 90 * DAY) }), null);
});

test("frase da validade: 'fica 3 dias no sino', horas, data em Sao Paulo e 'ate a principal sumir'", () => {
  assert.equal(meta.describeValidity({ mode: "default" }), "fica 90 dias no sino");
  assert.equal(meta.describeValidity({ minutes: 1_440, mode: "duration" }), "fica 1 dia no sino");
  assert.equal(meta.describeValidity({ minutes: 4_320, mode: "duration" }), "fica 3 dias no sino");
  assert.equal(meta.describeValidity({ minutes: 60, mode: "duration" }), "fica 1 hora no sino");
  assert.equal(meta.describeValidity({ minutes: 300, mode: "duration" }), "fica 5 horas no sino");
  assert.equal(meta.describeValidity({ minutes: 90, mode: "duration" }), "fica 90 minutos no sino");
  assert.equal(meta.describeValidity({ endsAt: "2026-10-21T17:30:00.000Z", mode: "until" }), "fica no sino até 21/10/2026 às 14:30");
  assert.equal(meta.describeValidity({ mode: "with_anchor" }), "fica no sino até a principal sumir");
  assert.equal(meta.describeValidity({ mode: "with_anchor" }, { anchorLabel: "“Oferta especial!”" }), "fica no sino até “Oferta especial!” sumir");
});

test("schema da validade: de 5 minutos a 90 dias, data e hora validas; 'ate a principal sumir' so no fluxo", () => {
  const validade = (validity) => problemas(schemas.validitySchema, validity);

  assert.deepEqual(validade({ mode: "default" }), []);
  assert.deepEqual(validade({ minutes: 5, mode: "duration" }), [], "ajustes da v3a: a partir de 5 minutos");
  assert.deepEqual(validade({ minutes: 59, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 60, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 129_600, mode: "duration" }), []);
  assert.deepEqual(validade({ minutes: 4, mode: "duration" }), [["minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(validade({ minutes: 129_601, mode: "duration" }), [["minutes", "No máximo 90 dias."]]);
  assert.deepEqual(validade({ minutes: 90.5, mode: "duration" }), [["minutes", "Use de 5 minutos a 90 dias."]]);
  assert.deepEqual(validade({ endsAt: "2026-10-21T14:30:00-03:00", mode: "until" }), []);
  assert.deepEqual(validade({ endsAt: "amanhã", mode: "until" }), [["endsAt", "Escolha data e hora."]]);
  assert.deepEqual(validade({ mode: "with_anchor" }), [["mode", "Escolha quanto tempo fica no sino."]]);

  assert.deepEqual(problemas(schemas.flowValiditySchema, { mode: "with_anchor" }), []);
  assert.deepEqual(problemas(schemas.flowValiditySchema, { minutes: 4, mode: "duration" }), [["minutes", "No mínimo 5 minutos."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ validity: { mode: "with_anchor" } })), [
    ["validity.mode", "Escolha quanto tempo fica no sino."]
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho do aviso com os campos novos
 * ---------------------------------------------------------------------------------------------- */

test("rascunho novo: a escola envia, sem icone e 90 dias; um rascunho da v1 sem os campos continua igual", () => {
  const vazio = schemas.emptyNoticeDraft("inbox");

  assert.equal(vazio.sender, null);
  assert.equal(vazio.icon, null);
  assert.deepEqual(vazio.validity, { mode: "default" });

  const { icon, sender, validity, ...v1 } = notificacao();
  void icon;
  void sender;
  void validity;
  const lido = schemas.noticeDraftSchema.parse(v1);

  assert.equal(lido.sender, null);
  assert.equal(lido.icon, null);
  assert.deepEqual(lido.validity, { mode: "default" });

  const completo = schemas.noticeDraftSchema.parse(
    notificacao({ icon: { color: "red", id: "promo" }, sender: { userId: PESSOA }, validity: { minutes: 1_440, mode: "duration" } })
  );
  assert.deepEqual(completo.sender, { userId: PESSOA });
  assert.deepEqual(completo.icon, { color: "red", id: "promo" });
  assert.deepEqual(completo.validity, { minutes: 1_440, mode: "duration" });
});

test("pop-up: aceita o icone e recusa quem envia e o tempo no sino", () => {
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ icon: { color: "amber", id: "calendar" } })), []);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ sender: { userId: PESSOA } })), [
    ["sender", "Quem envia e o tempo no sino valem só para notificações."]
  ]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ validity: { minutes: 1_440, mode: "duration" } })), [
    ["validity", "Quem envia e o tempo no sino valem só para notificações."]
  ]);
});

test("na hora de publicar: 'ate uma data' pelo menos 1 hora e no maximo 90 dias depois do envio", () => {
  const ate = (endsAt, extra = {}) => notificacao({ validity: { endsAt: iso(endsAt), mode: "until" }, ...extra });
  const venceria = { message: "A notificação venceria antes de sair. Escolha um fim pelo menos 1 hora depois do envio.", path: "validity.endsAt" };
  const longe = { message: "O fim pode ser no máximo 90 dias depois do envio.", path: "validity.endsAt" };

  assert.deepEqual(problemas(schemas.noticeDraftSchema, ate(now - DAY)), [], "o rascunho pode guardar uma data que passou");
  assert.deepEqual(schemas.publishProblems(ate(now - DAY), now), [venceria]);
  assert.deepEqual(schemas.publishProblems(ate(now + 30 * MINUTE), now), [venceria]);
  assert.deepEqual(schemas.publishProblems(ate(now + HOUR), now), [venceria], "exatamente 1 hora ainda nao");
  assert.deepEqual(schemas.publishProblems(ate(now + 2 * HOUR), now), []);
  assert.deepEqual(schemas.publishProblems(ate(now + 90 * DAY), now), []);
  assert.deepEqual(schemas.publishProblems(ate(now + 91 * DAY), now), [longe]);

  // Agendada: conta do envio agendado, nao de agora.
  const agendada = { mode: "at", sendAt: iso(now + 2 * DAY) };
  assert.deepEqual(schemas.publishProblems(ate(now + 2 * DAY + 30 * MINUTE, { schedule: agendada }), now), [venceria]);
  assert.deepEqual(schemas.publishProblems(ate(now + 2 * DAY + 2 * HOUR, { schedule: agendada }), now), []);
  assert.deepEqual(schemas.publishProblems(notificacao({ validity: { minutes: 60, mode: "duration" } }), now), []);
});

/* ------------------------------------------------------------------------------------------------
 * Notificacoes dos fluxos e notificacoes seguintes (formato; a arvore e do motor)
 * ---------------------------------------------------------------------------------------------- */

const conteudo = (extra = {}) => ({ ...notificacao(), ...extra });
const seguinte = (extra = {}) => ({
  children: [],
  content: conteudo({ title: "Você viu a novidade?" }),
  id: PASSO,
  when: { anchor: "sent", minutes: 1_440 },
  who: { kind: "everyone" },
  ...extra
});
const salvarSeguintes = (followUps) => ({
  expectedNoticeUpdatedAt: "2026-10-20T15:00:00.000+00:00",
  followUps,
  goal: null,
  noticeId: AVISO
});

test("conteudo de notificacao do fluxo: o mesmo do aviso, mais 'ate a principal sumir'", () => {
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, conteudo({ validity: { mode: "with_anchor" } })), []);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, conteudo({ title: "x".repeat(81) })), [["title", "Use até 80 caracteres."]]);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, conteudo({ title: " " })), [["title", "Escreva um título."]]);
  assert.deepEqual(problemas(schemas.noticeContentSchema, conteudo({ validity: { mode: "with_anchor" } })), [
    ["validity.mode", "Escolha quanto tempo fica no sino."]
  ]);
});

test("notificacao seguinte: quando sai de 5 minutos (15 antes de vencer) a 60 dias, de 5 em 5", () => {
  const quando = (when) => problemas(flowSchemas.followUpDraftSchema, seguinte({ when }));

  assert.deepEqual(quando({ anchor: "sent", minutes: 1_440 }), []);
  assert.deepEqual(quando({ anchor: "expires", minutes: 180 }), []);
  assert.deepEqual(quando({ anchor: "sent", minutes: 0 }), [["when.minutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(quando({ anchor: "sent", minutes: 7 }), [["when.minutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(quando({ anchor: "expires", minutes: 10 }), [["when.minutes", "Escolha de 15 minutos a 60 dias."]]);
  assert.deepEqual(quando({ anchor: "sent", minutes: 86_405 }), [["when.minutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(problemas(flowSchemas.followUpDraftSchema, seguinte({ content: conteudo({ validity: { mode: "with_anchor" } }) })), []);
});

test("notificacoes seguintes: no maximo 5 por notificacao e 3 niveis contando a principal", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d${String(index).padStart(2, "0")}`);

  assert.deepEqual(problemas(flowSchemas.saveNoticeFollowUpsSchema, salvarSeguintes([seguinte()])), []);
  assert.deepEqual(
    problemas(flowSchemas.saveNoticeFollowUpsSchema, salvarSeguintes([seguinte({ children: [seguinte({ id: PASSO_2 })] })])),
    [],
    "Seguinte 1.1 vale"
  );
  assert.deepEqual(
    problemas(
      flowSchemas.saveNoticeFollowUpsSchema,
      salvarSeguintes([seguinte({ children: [seguinte({ children: [seguinte({ id: ids[0] })], id: PASSO_2 })] })])
    ),
    [["followUps.0.children.0.children", "As notificações seguintes vão até 3 níveis, contando a notificação principal."]]
  );
  assert.deepEqual(
    problemas(flowSchemas.saveNoticeFollowUpsSchema, salvarSeguintes(ids.slice(0, 6).map((id) => seguinte({ id })))),
    [["followUps", "Use no máximo 5 notificações seguintes por notificação."]]
  );
  assert.deepEqual(
    problemas(flowSchemas.saveNoticeFollowUpsSchema, salvarSeguintes([seguinte(), seguinte()])),
    [["followUps.1.id", "Passo inválido."]],
    "o mesmo passo duas vezes"
  );
  assert.deepEqual(
    problemas(flowSchemas.saveNoticeFollowUpsSchema, { ...salvarSeguintes([]), goal: { productId: "" } }),
    [["goal.productId", "Escolha o produto."]]
  );
  assert.deepEqual(problemas(flowSchemas.saveNoticeFollowUpsSchema, { ...salvarSeguintes([]), goal: { productId: "curso-ia" } }), []);
});

test("passos do construtor: espera de 5 em 5 minutos, 'antes de vencer' a partir de 15 e condicao com regra", () => {
  const passo = (extra = {}) => ({
    anchor: "previous",
    anchorNodeId: null,
    branch: null,
    filter: null,
    id: PASSO_2,
    kind: "message",
    offsetMinutes: 1_440,
    parentId: PASSO,
    position: 0,
    ...extra
  });
  const regra = { kind: "rules", root: { items: [{ action: "opened", negate: true, ref: { kind: "node", nodeId: PASSO }, type: "message" }], match: "all" } };

  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, { id: PASSO, kind: "entry", parentId: null, position: 0 }), []);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo()), []);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ offsetMinutes: 0 })), [], "Logo depois");
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ offsetMinutes: 7 })), [["offsetMinutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ offsetMinutes: 86_405 })), [["offsetMinutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ anchor: "expires", anchorNodeId: PASSO, offsetMinutes: 10 })), [
    ["offsetMinutes", "Escolha de 15 minutos a 60 dias."]
  ]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ anchor: "sent", anchorNodeId: null })), [["anchorNodeId", "Escolha a notificação."]]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, passo({ filter: regra })), [], "'So para quem...' aceita regra de fluxo");

  const condicao = (extra = {}) => ({ ...passo(), condition: regra, kind: "condition", maxWaitMinutes: null, waitUntilTrue: false, ...extra });
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, condicao()), []);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, condicao({ condition: { kind: "everyone" } })), [
    ["condition", "A condição precisa de pelo menos uma regra."]
  ]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, condicao({ waitUntilTrue: true })), [["maxWaitMinutes", "Escolha de 15 minutos a 30 dias."]]);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, condicao({ maxWaitMinutes: 2_880, waitUntilTrue: true })), []);
  assert.deepEqual(problemas(flowSchemas.flowNodeSchema, condicao({ maxWaitMinutes: 43_201, waitUntilTrue: true })), [
    ["maxWaitMinutes", "Escolha de 15 minutos a 30 dias."]
  ]);
});

test("rascunho do construtor -> arvore e conteudo para o motor conferir", () => {
  const { messages, tree } = flowSchemas.flowTreeOfDraft({
    messages: { [PASSO_2]: conteudo({ cta: { href: "/conteudo/curso-ia", label: "Ver", target: "same_tab" }, validity: { mode: "with_anchor" } }) },
    nodes: [
      { branch: null, id: PASSO, kind: "entry", parentId: null, position: 0 },
      { anchor: "expires", anchorNodeId: PASSO, branch: null, filter: null, id: PASSO_2, kind: "message", offsetMinutes: 180, parentId: PASSO, position: 0 }
    ],
    origin: "notice"
  });

  assert.equal(tree.origin, "notice");
  assert.deepEqual(tree.nodes[0], {
    anchor: "previous",
    anchorNodeId: null,
    branch: null,
    campaignId: null,
    condition: null,
    expireWithAnchor: false,
    filter: null,
    id: PASSO,
    kind: "entry",
    maxWaitMinutes: null,
    offsetMinutes: 0,
    parentId: null,
    position: 0,
    waitUntilTrue: false
  });
  assert.equal(tree.nodes[1].expireWithAnchor, true, "'ate a principal sumir' vira expire_with_anchor");
  assert.deepEqual(messages[PASSO_2], {
    allowsReactions: true,
    campaignId: "",
    ctaHref: "/conteudo/curso-ia",
    hasAudio: false,
    hasCta: true,
    hasPoll: false,
    hasResponse: false,
    pollOptionIds: [],
    title: "Oferta especial!",
    validUntil: null,
    validityMinutes: null
  });
});

/* ------------------------------------------------------------------------------------------------
 * Regras novas no segmento e avisos que o carregador precisa ler
 * ---------------------------------------------------------------------------------------------- */

test("segmento: aceita 'o que fez com a notificacao X' de um aviso e recusa as regras que so valem no fluxo", () => {
  const segmento = (...items) => ({ kind: "rules", root: { items, match: "all" } });
  const ouviu = { action: "audio_completed", negate: true, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" };
  const doFluxo = { action: "opened", negate: true, ref: { kind: "node", nodeId: PASSO }, type: "message" };
  const visita = { negate: false, page: { kind: "content", productId: "curso-ia" }, since: { kind: "entered" }, type: "page_visit" };
  const ganhou = { negate: false, productIds: ["curso-ia"], since: { kind: "message", nodeId: PASSO }, type: "access_gained" };
  const soNoFluxo = "Esta regra só vale dentro de um fluxo.";

  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, segmento(ouviu)), []);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, segmento(visita)), [["root.items.0", soNoFluxo]]);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, segmento(ouviu, ganhou)), [["root.items.1", soNoFluxo]]);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, segmento(doFluxo)), [["root.items.0", soNoFluxo]]);
  assert.deepEqual(
    problemas(schemas.audienceDefinitionSchema, segmento({ items: [visita], match: "any" })),
    [["root.items.0.items.0", soNoFluxo]],
    "dentro de um grupo tambem"
  );

  assert.deepEqual(problemas(schemas.flowRuleDefinitionSchema, segmento(ouviu, doFluxo, visita, ganhou)), []);
  assert.deepEqual(problemas(schemas.flowRuleDefinitionSchema, segmento({ ...ouviu, ref: { campaignId: "", kind: "campaign" } })), [
    ["root.items.0.ref.campaignId", "Escolha a notificação."]
  ]);
  assert.deepEqual(problemas(schemas.flowRuleDefinitionSchema, segmento({ ...ganhou, productIds: [] })), [
    ["root.items.0.productIds", "Escolha pelo menos um produto."]
  ]);
  assert.deepEqual(problemas(schemas.flowRuleDefinitionSchema, segmento({ ...visita, page: { kind: "message_cta", nodeId: "botao" } })), [
    ["root.items.0.page.nodeId", "Escolha a notificação."]
  ]);
  assert.equal(schemas.flowRuleDefinitionSchema.parse(segmento({ ...visita, negate: undefined })).root.items[0].negate, false);
});

test("avisos que o carregador le: os de toda regra de mensagem que aponta para um aviso, sem repetir, em ordem", () => {
  const regra = (campaignId) => ({ action: "opened", negate: false, ref: { campaignId, kind: "campaign" }, type: "message" });
  const segmento = { kind: "rules", root: { items: [regra("b"), { items: [regra("a"), regra("b")], match: "any" }], match: "all" } };
  const comPasso = {
    kind: "rules",
    root: { items: [{ action: "seen", negate: false, ref: { kind: "node", nodeId: PASSO }, type: "message" }, { op: "has", productIds: ["x"], type: "product" }], match: "all" }
  };

  assert.deepEqual(audience.collectMessageCampaignIds(segmento), ["a", "b"]);
  assert.deepEqual(audience.collectMessageCampaignIds(comPasso), [], "passo do fluxo vem dos fatos do lote");
  assert.deepEqual(audience.collectMessageCampaignIds({ kind: "everyone" }), []);
  assert.deepEqual(audience.collectMessageCampaignIds([segmento, null, { kind: "rules", root: { items: [regra("c")], match: "all" } }]), ["a", "b", "c"]);
  assert.deepEqual(audience.collectMessageCampaignIds(undefined), []);
  assert.equal(audience.messageRefKey({ campaignId: AVISO, kind: "campaign" }), `campaign:${AVISO}`);
  assert.equal(audience.messageRefKey({ kind: "node", nodeId: PASSO }), `node:${PASSO}`);
});

/* ------------------------------------------------------------------------------------------------
 * Icone da escola, audio ouvido e limites fixos
 * ---------------------------------------------------------------------------------------------- */

test("icone da escola: ausente ou vazio = o simbolo padrao (centralizado); uma imagem enviada fica como esta", () => {
  assert.equal(meta.SCHOOL_DEFAULT_ICON, "/brand/icon-bunker.svg");
  assert.equal(meta.normalizeSchoolIcon(undefined), "/brand/icon-bunker.svg");
  assert.equal(meta.normalizeSchoolIcon(null), "/brand/icon-bunker.svg");
  assert.equal(meta.normalizeSchoolIcon(""), "/brand/icon-bunker.svg");
  assert.equal(meta.normalizeSchoolIcon("   "), "/brand/icon-bunker.svg");
  assert.equal(meta.normalizeSchoolIcon("https://cdn.exemplo.test/icone.png"), "https://cdn.exemplo.test/icone.png");
  assert.equal(meta.isDefaultSchoolIcon(undefined), true);
  assert.equal(meta.isDefaultSchoolIcon("/brand/icon-bunker.svg"), true);
  assert.equal(meta.isDefaultSchoolIcon("https://cdn.exemplo.test/icone.png"), false);
  assert.equal(meta.SCHOOL_NAME_FALLBACK_TEAM, "Equipe Bunker707");
});

test("audio ouvido: 48 trechos, ouvido com 44 (90 %); limites fixos dos fluxos", () => {
  assert.equal(notification.AUDIO_HEARD_SLOTS, 48);
  assert.equal(notification.AUDIO_COMPLETE_SLOTS, 44);
  assert.ok(notification.AUDIO_COMPLETE_SLOTS / notification.AUDIO_HEARD_SLOTS >= 0.9);

  assert.equal(FLOW_LIMITS.dailyCap, 3);
  assert.equal(FLOW_LIMITS.minGapMinutes, 60);
  assert.equal(FLOW_LIMITS.maxNodes, 20);
  assert.equal(FLOW_LIMITS.followUpsPerNotice, 5);
  assert.equal(FLOW_LIMITS.followUpDepth, 3);
  assert.ok(FLOW_LIMITS.flowRowSettleMs > FLOW_LIMITS.applyStatementMs, "a folga do 'abriu o sino' cobre o teto do lote");
});

test("eventos de audio da rota: 'started' ou 'progress' com 48 trechos", () => {
  assert.deepEqual(problemas(schemas.audioEventSchema, { event: "started" }), []);
  assert.deepEqual(problemas(schemas.audioEventSchema, { event: "progress", heard: "1".repeat(48) }), []);
  assert.deepEqual(problemas(schemas.audioEventSchema, { event: "progress", heard: "1".repeat(47) }), [["heard", "Evento invalido."]]);
  assert.deepEqual(problemas(schemas.audioEventSchema, { event: "progress", heard: "2".repeat(48) }), [["heard", "Evento invalido."]]);
  assert.deepEqual(problemas(schemas.audioEventSchema, { event: "ended" }), [["event", "Evento invalido."]]);
  assert.equal(schemas.withdrawNoticeSchema.parse({ id: AVISO }).alsoFollowUps, true, "retirar tambem as seguintes, marcado por padrao");
});
