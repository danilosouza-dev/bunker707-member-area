import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras dos avisos (docs/22): situacao, acoes por situacao e permissao, aprovacao acima de 500
// alunos (docs/17 D4), agenda no fuso de Sao Paulo, frase de revisao, escolha do pop-up e limites fixos
// (1 a cada 24 h, "Lembrar depois" ate 2 vezes), regras das notificacoes de comentario e paginacao do
// sino, e o schema do rascunho do editor.

const campaign = await import("../src/server/communications/campaign-model.ts");
const notification = await import("../src/server/communications/notification-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");

const HOUR = 3_600_000;
const now = Date.parse("2026-10-20T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();

const timing = (extra = {}) => ({ endsAt: null, kind: "inbox", sendAt: null, startsAt: null, status: "draft", ...extra });
const todas = { canPublish: true, canPublishLarge: true, canWrite: true };
const soEscreve = { canPublish: false, canPublishLarge: false, canWrite: true };

/* ------------------------------------------------------------------------------------------------
 * Situacao e acoes
 * ---------------------------------------------------------------------------------------------- */

test("situacao: pop-up publicado antes da janela aparece agendado e depois do fim aparece encerrado; o resto e a situacao gravada", () => {
  const popup = (extra) => timing({ kind: "popup", status: "active", ...extra });

  assert.equal(campaign.situationOf(popup({}), now), "active");
  assert.equal(campaign.situationOf(popup({ startsAt: iso(now + HOUR) }), now), "scheduled");
  assert.equal(campaign.situationOf(popup({ startsAt: iso(now - HOUR), endsAt: iso(now + HOUR) }), now), "active");
  assert.equal(campaign.situationOf(popup({ endsAt: iso(now) }), now), "ended");
  assert.equal(campaign.situationOf(popup({ endsAt: iso(now - HOUR), status: "paused" }), now), "paused");
  assert.equal(campaign.situationOf(timing({ sendAt: iso(now - HOUR), status: "scheduled" }), now), "scheduled");
  assert.equal(campaign.isPopupLive(popup({}), now), true);
  assert.equal(campaign.isPopupLive(popup({ startsAt: iso(now + HOUR) }), now), false);

  assert.equal(campaign.SITUATION_LABELS.pending_approval, "Aguardando aprovação");
  assert.deepEqual(
    campaign.CAMPAIGN_STATUSES.map((status) => campaign.situationTone(status)),
    ["muted", "warning", "warning", "warning", "success", "muted", "success", "neutral", "muted"]
  );
});

// v3a (docs/24 §2.1): o menu na ordem do "…", com Ver relatorio, Editar a enviada e Excluir em toda situacao.
const publica = { canPublish: true, canPublishLarge: false, canWrite: true };

test("acoes por situacao: rascunho, aguardando aprovacao, agendado, enviando, enviado e cancelado (na ordem do menu)", () => {
  const acoes = (status, perms = todas, kind = "inbox", extra) => campaign.availableNoticeActions(timing({ kind, status }), now, perms, extra);

  assert.deepEqual(acoes("draft"), ["edit", "publish", "send_test", "duplicate", "delete"]);
  assert.deepEqual(acoes("draft", soEscreve), ["edit", "publish", "send_test", "duplicate", "delete"]);
  assert.deepEqual(acoes("draft", todas, "popup"), ["edit", "publish", "duplicate", "delete"], "pop-up nao tem teste no sino");
  assert.deepEqual(acoes("pending_approval"), ["edit", "approve", "reject", "send_test", "duplicate", "delete"]);
  assert.deepEqual(acoes("pending_approval", publica), ["edit", "send_test", "duplicate", "delete"], "so quem aprova ve aprovar");
  assert.deepEqual(acoes("pending_approval", soEscreve), ["edit", "send_test", "duplicate", "delete"]);
  assert.deepEqual(acoes("scheduled"), ["edit", "send_test", "duplicate", "cancel_schedule", "delete"]);
  assert.deepEqual(acoes("scheduled", publica), ["edit", "send_test", "duplicate", "cancel_schedule", "delete"]);
  assert.deepEqual(acoes("scheduled", soEscreve), ["edit", "send_test", "duplicate"], "excluir o agendado cancela o envio: messaging.publish");
  assert.deepEqual(acoes("sending"), ["view_report", "duplicate"], "enviando: nada de excluir no meio do envio");
  assert.deepEqual(acoes("sending", soEscreve), ["view_report", "duplicate"]);
  assert.deepEqual(acoes("sent"), ["view_report", "edit", "duplicate", "withdraw", "delete"]);
  assert.deepEqual(acoes("sent", publica), ["view_report", "edit", "duplicate", "withdraw", "delete"]);
  assert.deepEqual(acoes("sent", soEscreve), ["view_report", "duplicate"], "quem so escreve nao muda nem tira do sino");
  assert.deepEqual(acoes("canceled"), ["view_report", "duplicate", "delete"]);
  assert.deepEqual(acoes("canceled", soEscreve), ["view_report", "duplicate", "delete"]);
  assert.deepEqual(acoes("draft", { canPublish: true, canPublishLarge: true, canWrite: false }), [], "sem messaging.write nada");
});

test("acoes da notificacao enviada: Editar acima de 500 alunos so com messaging.publish_large (o numero vem em extra)", () => {
  const acoes = (perms, extra) => campaign.availableNoticeActions(timing({ status: "sent" }), now, perms, extra);

  assert.deepEqual(acoes(publica, { recipients: 500 }), ["view_report", "edit", "duplicate", "withdraw", "delete"], "500 ainda e de quem publica");
  assert.deepEqual(acoes(publica, { recipients: 501 }), ["view_report", "duplicate", "withdraw", "delete"], "501 sem publish_large: Editar nem aparece");
  assert.deepEqual(acoes(todas, { recipients: 501 }), ["view_report", "edit", "duplicate", "withdraw", "delete"]);
  assert.deepEqual(acoes(publica, {}), ["view_report", "edit", "duplicate", "withdraw", "delete"], "sem o numero: so messaging.publish (o servidor confere)");
  assert.deepEqual(acoes(publica, { recipients: null }), ["view_report", "edit", "duplicate", "withdraw", "delete"]);
  assert.deepEqual(acoes(soEscreve, { recipients: 10 }), ["view_report", "duplicate"]);
  assert.ok(!acoes(todas, { popupRepeat: "once", recipients: 1 }).includes("reshow"), "mostrar de novo e so do pop-up");

  assert.equal(campaign.noticeRecipients({ audience_count: 318, recipients_count: 320 }), 320);
  assert.equal(campaign.noticeRecipients({ audience_count: 501, recipients_count: 12 }), 501, "o maior dos dois");
  assert.equal(campaign.noticeRecipients({ audience_count: null, recipients_count: null }), 0);
});

test("acoes do pop-up: no ar, agendado pela janela, encerrado pela janela, pausado e encerrado (v3b-1: Mostrar de novo em qualquer 'Quantas vezes')", () => {
  const acoes = (extra, perms = todas, more) => campaign.availableNoticeActions(timing({ kind: "popup", ...extra }), now, perms, more);
  const umaVez = { popupRepeat: "once" };
  const ateClicar = { popupRepeat: "until_action" };

  assert.deepEqual(acoes({ status: "active" }), ["view_report", "edit", "pause", "reshow", "duplicate", "end", "delete"], "sem extra: Mostrar de novo tambem");
  assert.deepEqual(acoes({ status: "active" }, todas, umaVez), ["view_report", "edit", "pause", "reshow", "duplicate", "end", "delete"]);
  assert.deepEqual(acoes({ status: "active" }, todas, ateClicar), ["view_report", "edit", "pause", "reshow", "duplicate", "end", "delete"], "Mais de uma vez: a contagem recomeca");
  assert.deepEqual(acoes({ status: "active" }, publica, umaVez), ["view_report", "edit", "pause", "reshow", "duplicate", "end", "delete"], "os 500 o servidor confere");
  assert.deepEqual(
    acoes({ startsAt: iso(now + HOUR), status: "active" }, todas, umaVez),
    ["view_report", "edit", "pause", "duplicate", "end", "delete"],
    "janela ainda por comecar: ninguem viu"
  );
  assert.deepEqual(acoes({ endsAt: iso(now - HOUR), status: "active" }, todas, umaVez), ["view_report", "duplicate", "delete"], "janela terminou");
  assert.deepEqual(acoes({ status: "paused" }), ["view_report", "edit", "resume", "reshow", "duplicate", "end", "delete"]);
  assert.deepEqual(acoes({ status: "paused" }, todas, umaVez), ["view_report", "edit", "resume", "reshow", "duplicate", "end", "delete"]);
  assert.deepEqual(acoes({ status: "paused" }, todas, ateClicar), ["view_report", "edit", "resume", "reshow", "duplicate", "end", "delete"]);
  assert.deepEqual(acoes({ status: "ended" }, todas, umaVez), ["view_report", "duplicate", "delete"]);

  // Editar, pausar, mostrar de novo, encerrar e excluir o pop-up no ar mudam o que o aluno ve: so quem publica.
  assert.deepEqual(acoes({ status: "active" }, soEscreve, umaVez), ["view_report", "duplicate"], "quem so escreve nao mexe no pop-up no ar");
  assert.deepEqual(acoes({ status: "paused" }, soEscreve, umaVez), ["view_report", "duplicate"]);
  assert.deepEqual(acoes({ endsAt: iso(now - HOUR), status: "active" }, soEscreve), ["view_report", "duplicate", "delete"], "encerrado pela janela: quem escreve exclui");
  assert.deepEqual(acoes({ status: "ended" }, soEscreve), ["view_report", "duplicate", "delete"]);
  assert.deepEqual(acoes({ status: "draft" }, soEscreve), ["edit", "publish", "duplicate", "delete"], "rascunho continua com quem escreve");

  assert.equal(campaign.isEditableStatus("popup", "active"), true);
  assert.equal(campaign.isEditableStatus("popup", "paused"), true);
  assert.equal(campaign.isEditableStatus("popup", "ended"), false);
  assert.equal(campaign.isEditableStatus("inbox", "scheduled"), true);
  assert.equal(campaign.isEditableStatus("inbox", "sent"), true, "v3a: a enviada muda o conteudo");
  assert.equal(campaign.isEditableStatus("inbox", "sending"), false);
  assert.equal(campaign.isEditableStatus("inbox", "canceled"), false);
  assert.equal(campaign.isEditableStatus("inbox", "pending_approval"), true);

  assert.equal(campaign.isLiveNoticeStatus("popup", "active"), true);
  assert.equal(campaign.isLiveNoticeStatus("popup", "paused"), true);
  assert.equal(campaign.isLiveNoticeStatus("popup", "ended"), false);
  assert.equal(campaign.isLiveNoticeStatus("inbox", "sent"), true);
  for (const status of ["draft", "pending_approval", "scheduled", "sending", "canceled", null, undefined]) {
    assert.equal(campaign.isLiveNoticeStatus("inbox", status), false, String(status));
  }
});

test("aprovacao (docs/17 D4): ate 500 alunos publica quem pode publicar; 501 precisa de messaging.publish_large; sem messaging.publish sempre aprovacao", () => {
  const decide = (audienceCount, canPublish, canPublishLarge) => campaign.publishDecision({ audienceCount, canPublish, canPublishLarge });

  assert.equal(campaign.APPROVAL_THRESHOLD, 500);
  assert.equal(decide(500, true, false), "publish");
  assert.equal(decide(501, true, false), "needs_approval");
  assert.equal(decide(501, true, true), "publish");
  assert.equal(decide(5000, true, true), "publish");
  assert.equal(decide(1, false, false), "needs_approval");
  assert.equal(decide(1, false, true), "needs_approval");
});

/* ------------------------------------------------------------------------------------------------
 * Fuso de Sao Paulo e frase de revisao
 * ---------------------------------------------------------------------------------------------- */

test("data e hora de Sao Paulo viram ISO em UTC e voltam para os campos; entrada invalida vira null", () => {
  assert.equal(campaign.saoPauloLocalToIso("2026-10-21", "14:30"), "2026-10-21T17:30:00.000Z");
  assert.equal(campaign.saoPauloLocalToIso("2026-10-21", "23:59"), "2026-10-22T02:59:00.000Z");
  assert.equal(campaign.saoPauloLocalToIso("2026-02-31", "10:00"), null, "dia que nao existe");
  assert.equal(campaign.saoPauloLocalToIso("2026-10-21", "24:00"), null);
  assert.equal(campaign.saoPauloLocalToIso("2026-10-21", "9:30"), null);
  assert.equal(campaign.saoPauloLocalToIso("21/10/2026", "10:00"), null);

  assert.deepEqual(campaign.isoToSaoPauloLocal("2026-10-22T02:30:00.000Z"), { date: "2026-10-21", time: "23:30" });
  assert.equal(campaign.isoToSaoPauloLocal("ontem"), null);
  assert.equal(campaign.isoToSaoPauloLocal(null), null);
  assert.equal(campaign.formatSaoPauloDateTime("2026-10-21T17:30:00.000Z"), "21/10/2026 às 14:30");
  assert.equal(campaign.formatSaoPauloDateTime("x"), "");
});

test("frase de revisao: notificacao agora ou agendada; pop-up com e sem janela, uma vez ou ate clicar", () => {
  const revisao = (extra) =>
    campaign.describeNoticeReview({ audienceCount: 318, kind: "inbox", repeat: "once", schedule: { mode: "now" }, window: { endsAt: null, startsAt: null }, ...extra });

  assert.equal(revisao({}), "Notificação para 318 alunos, enviada agora.");
  assert.equal(revisao({ schedule: { mode: "at", sendAt: "2026-10-21T17:30:00.000Z" } }), "Notificação para 318 alunos, agendada para 21/10/2026 às 14:30.");
  assert.equal(revisao({ audienceCount: 1 }), "Notificação para 1 aluno, enviada agora.");
  assert.equal(revisao({ audienceCount: 1234 }), "Notificação para 1.234 alunos, enviada agora.");
  assert.equal(revisao({ audienceCount: null }), "Notificação para os alunos do segmento, enviada agora.");

  assert.equal(revisao({ kind: "popup" }), "Pop-up para 318 alunos, a partir de agora, sem data para acabar, no máximo 1 vez.");
  assert.equal(
    revisao({ kind: "popup", repeat: "until_action", window: { endsAt: "2026-10-22T02:59:00.000Z", startsAt: "2026-10-14T12:00:00.000Z" } }),
    "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, até o aluno clicar (no máximo 1 vez por dia)."
  );
  assert.equal(
    revisao({ kind: "popup", window: { endsAt: null, startsAt: "2026-10-14T12:00:00.000Z" } }),
    "Pop-up para 318 alunos, a partir de 14/10/2026 às 09:00, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao({ kind: "popup", window: { endsAt: "2026-10-22T02:59:00.000Z", startsAt: null } }),
    "Pop-up para 318 alunos, a partir de agora até 21/10/2026 às 23:59, no máximo 1 vez."
  );
});

/* ------------------------------------------------------------------------------------------------
 * Eventos do pop-up (quando ele abre: popup-display-model.ts, tests/pop-ups-v3b1-modelo.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

const entrega = (campaignId, extra = {}) => ({
  campaignId,
  clickedAt: null,
  dismissedAt: null,
  eligible: true,
  impressions: 0,
  lastSeenAt: null,
  snoozeCount: 0,
  snoozedUntil: null,
  ...extra
});

test("versao do editor: o mesmo instante em qualquer formato ISO, ate o microssegundo", () => {
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:00.123456+00:00", "2026-10-20T15:09:00.123456+00:00"), true);
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:00.123456Z", "2026-10-20T15:09:00.123456+00:00"), true);
  assert.equal(campaign.isSameVersion("2026-10-20T12:09:00.1234560-03:00", "2026-10-20T15:09:00.123456+00:00"), true);
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:00.123+00:00", "2026-10-20T15:09:00.123000+00:00"), true);
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:00+00:00", "2026-10-20T15:09:00.000000+00:00"), true);
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:00.123457+00:00", "2026-10-20T15:09:00.123456+00:00"), false, "um microssegundo depois e outra versao");
  assert.equal(campaign.isSameVersion("2026-10-20T15:09:01.123456+00:00", "2026-10-20T15:09:00.123456+00:00"), false);
  assert.equal(campaign.isSameVersion("ontem", "2026-10-20T15:09:00.123456+00:00"), false);
});

test("recalculo dos pop-ups: relogio alinhado em faixas de 15 minutos (os vencidos caem no mesmo tick)", () => {
  const QUINZE = 15 * 60 * 1000;
  const faixa = (hora) => campaign.popupRefreshDueBefore(Date.parse(hora), QUINZE);

  assert.equal(faixa("2026-10-20T15:07:42.000Z"), Date.parse("2026-10-20T15:00:00.000Z"));
  assert.equal(faixa("2026-10-20T15:15:00.000Z"), Date.parse("2026-10-20T15:15:00.000Z"));
  assert.equal(faixa("2026-10-20T15:29:59.999Z"), Date.parse("2026-10-20T15:15:00.000Z"));
  // Dois pop-ups recalculados em minutos diferentes da mesma faixa vencem juntos no comeco da proxima.
  const proxima = faixa("2026-10-20T15:16:00.000Z");
  assert.ok(Date.parse("2026-10-20T15:02:00.000Z") < proxima && Date.parse("2026-10-20T15:13:00.000Z") < proxima);
  assert.ok(!(Date.parse("2026-10-20T15:15:30.000Z") < proxima), "recalculado nesta faixa: so na proxima");
});

test("eventos do pop-up: impressao conta e marca a primeira vez; clique e 'Não mostrar de novo' gravam uma vez; fechar nao muda nada", () => {
  const input = { allowSnooze: true, now };

  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "impressed", input), { first_seen_at: iso(now), impressions: 1, last_seen_at: iso(now) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a", { impressions: 1, lastSeenAt: now - HOUR }), "impressed", input), { impressions: 2, last_seen_at: iso(now) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "clicked", input), { clicked_at: iso(now) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a", { clickedAt: now - HOUR }), "clicked", input), {});
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "dismissed", input), { dismissed_at: iso(now) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a", { dismissedAt: now - HOUR }), "dismissed", input), {});
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "closed", input), {});
});

/* ------------------------------------------------------------------------------------------------
 * v3a (docs/24 §2.4 e §4.9): "Mostrar de novo para quem já viu" (v3b-1: em qualquer "Quantas vezes"; quem
 * a RPC zera e o que volta depois: tests/pop-ups-v3b1-modelo.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

test("mostrar de novo: 'Lembrar depois' conta desde o zerar (mais 2 vezes); sem zerar, a regra da v1 exatamente", () => {
  // Zerado com um lembrete antes: snoozeCount 1 e a base 1.
  const depoisDoZerar = (extra) => entrega("a", { impressions: 3, impressionsBeforeReshow: 3, lastSeenAt: now - 25 * HOUR, snoozeCount: 1, snoozesBeforeReshow: 1, ...extra });

  assert.equal(campaign.canSnooze(depoisDoZerar({}), true), true);
  assert.equal(campaign.canSnooze(depoisDoZerar({ snoozeCount: 2 }), true), true, "um lembrete desde o zerar");
  assert.equal(campaign.canSnooze(depoisDoZerar({ snoozeCount: 3 }), true), false, "dois desde o zerar: acabou");
  assert.equal(campaign.canSnooze(depoisDoZerar({}), false), false);
  assert.deepEqual(campaign.popupEventPatch(depoisDoZerar({ snoozeCount: 2 }), "snoozed", { allowSnooze: true, now }), {
    snooze_count: 3,
    snoozed_until: iso(now + 24 * HOUR)
  });
  assert.equal(campaign.popupEventPatch(depoisDoZerar({ snoozeCount: 3 }), "snoozed", { allowSnooze: true, now }), null);

  // Bases zeradas (a v1) = o mesmo resultado de sempre.
  for (const extra of [{}, { impressions: 1 }, { impressions: 1, snoozeCount: 1 }, { impressions: 2, snoozeCount: 1 }, { impressions: 3, snoozeCount: 2 }]) {
    const v1 = entrega("a", { lastSeenAt: extra.impressions ? now - 25 * HOUR : null, ...extra });
    const v3 = { ...v1, impressionsBeforeReshow: 0, snoozesBeforeReshow: 0 };

    assert.equal(campaign.canSnooze(v3, true), campaign.canSnooze(v1, true));
  }
});

test("'Lembrar depois' (v3b-1): volta no 'Volta em' do pop-up; sem o valor, 24 h; fechar continua sem gravar nada", () => {
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "snoozed", { allowSnooze: true, now, snoozeMinutes: 30 }), { snooze_count: 1, snoozed_until: iso(now + 30 * 60_000) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a", { snoozeCount: 1 }), "snoozed", { allowSnooze: true, now, snoozeMinutes: 10_080 }), {
    snooze_count: 2,
    snoozed_until: iso(now + 7 * 24 * HOUR)
  });
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "snoozed", { allowSnooze: true, now }), { snooze_count: 1, snoozed_until: iso(now + 24 * HOUR) }, "sem o valor: 24 h");
  assert.equal(campaign.popupEventPatch(entrega("a", { snoozeCount: 2 }), "snoozed", { allowSnooze: true, now, snoozeMinutes: 5 }), null, "continua no maximo 2 vezes");
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "closed", { allowSnooze: true, now, snoozeMinutes: 30 }), {});
});

test("frase de revisao (v3b-1): o pop-up padrao fica exatamente como antes; onde, quando e quantas vezes entram como partes", () => {
  const revisao = (extra) =>
    campaign.describeNoticeReview({ audienceCount: 318, kind: "popup", repeat: "once", schedule: { mode: "now" }, window: { endsAt: "2026-10-22T02:59:00.000Z", startsAt: "2026-10-14T12:00:00.000Z" }, ...extra });

  assert.equal(revisao({}), "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.");
  assert.equal(revisao({ popup: { frequency: "no máximo 1 vez", placement: null } }), "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.");
  assert.equal(revisao({ popup: null }), "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.", "null = a frase da v1");
  assert.equal(
    revisao({
      popup: { frequency: "até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar", placement: "em qualquer página, menos Perfil, logo ao abrir" },
      repeat: "until_action",
      window: { endsAt: null, startsAt: null }
    }),
    "Pop-up para 318 alunos, em qualquer página, menos Perfil, logo ao abrir, a partir de agora, sem data para acabar, até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar."
  );
  assert.equal(
    campaign.describeNoticeReview({ audienceCount: 318, kind: "inbox", popup: { frequency: "x", placement: "y" }, repeat: "once", schedule: { mode: "now" }, window: { endsAt: null, startsAt: null } }),
    "Notificação para 318 alunos, enviada agora.",
    "a notificacao ignora as partes do pop-up"
  );
});

test("'Lembrar depois': 24 h, ate 2 vezes, e so quando o aviso permite", () => {
  assert.deepEqual(campaign.popupEventPatch(entrega("a"), "snoozed", { allowSnooze: true, now }), { snooze_count: 1, snoozed_until: iso(now + 24 * HOUR) });
  assert.deepEqual(campaign.popupEventPatch(entrega("a", { snoozeCount: 1 }), "snoozed", { allowSnooze: true, now }), { snooze_count: 2, snoozed_until: iso(now + 24 * HOUR) });
  assert.equal(campaign.popupEventPatch(entrega("a", { snoozeCount: 2 }), "snoozed", { allowSnooze: true, now }), null);
  assert.equal(campaign.popupEventPatch(entrega("a"), "snoozed", { allowSnooze: false, now }), null);
  assert.equal(campaign.canSnooze({ snoozeCount: 1 }, true), true);
  assert.equal(campaign.canSnooze({ snoozeCount: 2 }, true), false);
  assert.equal(campaign.canSnooze({ snoozeCount: 0 }, false), false);
});

/* ------------------------------------------------------------------------------------------------
 * Notificacoes de comentario e paginacao do sino
 * ---------------------------------------------------------------------------------------------- */

test("mencao no comeco da resposta: @usuario em minusculas, mesmo conjunto de caracteres da aula; no meio do texto nao conta", () => {
  assert.equal(notification.parseLeadingMention("@Ana.Souza obrigada!"), "ana.souza");
  assert.equal(notification.parseLeadingMention("  @joao_1 veja"), "joao_1");
  assert.equal(notification.parseLeadingMention("@ana.souza. legal"), "ana.souza", "ponto final nao faz parte do usuario");
  assert.equal(notification.parseLeadingMention("@maria-clara"), "maria-clara");
  assert.equal(notification.parseLeadingMention("obrigada @ana"), null);
  assert.equal(notification.parseLeadingMention("@ texto"), null);
  assert.equal(notification.parseLeadingMention("@-"), null);
  assert.equal(notification.parseLeadingMention(""), null);
});

test("titulo e trecho das notificacoes de comentario", () => {
  assert.equal(notification.commentNotificationTitle("comment_reply", "Professor de Teste"), "Professor de Teste respondeu seu comentário");
  assert.equal(notification.commentNotificationTitle("comment_mention", " Ana "), "Ana mencionou você");
  assert.equal(notification.commentNotificationTitle("comment_reply", null), "Alguém respondeu seu comentário");
  assert.equal(notification.commentNotificationTitle("comment_mention", "  "), "Alguém mencionou você");

  assert.equal(notification.commentSnippet("  Muito   bom!\n\nValeu  "), "Muito bom! Valeu");
  const longo = notification.commentSnippet("a".repeat(300));
  assert.equal(longo.length, 280);
  assert.ok(longo.endsWith("…"));
  assert.equal(notification.commentSnippet("palavra ".repeat(10), 20), "palavra palavra pal…");
  assert.equal(
    notification.lessonNotificationHref({ contentId: "curso a", lessonId: "aula-1", moduleId: "mod-1" }),
    "/conteudo/curso%20a/aulas/mod-1?lessonId=aula-1"
  );
});

test("cursor do sino: guarda os microssegundos do banco (nenhuma notificacao do mesmo milissegundo se perde) e recusa texto invalido", () => {
  const id = "0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f";
  const cursor = notification.encodeCursor({ createdAt: "2026-10-20T12:00:00.123456+00:00", id });

  assert.equal(cursor, `2026-10-20T12:00:00.123456Z|${id}`);
  assert.deepEqual(notification.decodeCursor(cursor), { createdAt: "2026-10-20T12:00:00.123456Z", id });
  assert.equal(notification.encodeCursor({ createdAt: "2026-10-20T12:00:00Z", id }), `2026-10-20T12:00:00Z|${id}`);
  assert.equal(notification.encodeCursor({ createdAt: "2026-10-20T09:00:00-03:00", id }), `2026-10-20T12:00:00.000Z|${id}`, "outro fuso vira UTC");
  assert.deepEqual(notification.decodeCursor(`2026-10-20T12:00:00.000Z|${id.toUpperCase()}`), { createdAt: "2026-10-20T12:00:00.000Z", id });

  for (const invalido of [null, undefined, "", "qualquer", `2026-10-20T12:00:00Z|nao-e-id`, `ontem|${id}`, `2026-10-20T12:00:00Z|${id}|mais`, `2026-10-20T12:00:00+03:00|${id}`, `${"9".repeat(130)}|${id}`]) {
    assert.equal(notification.decodeCursor(invalido), null, String(invalido));
  }
});

test("asOf do 'Marcar todas': vale a hora do servidor em UTC ate 90 dias atras; futuro, antiga demais ou texto qualquer e ignorado", () => {
  const agora = Date.parse("2026-10-20T15:00:00.000Z");
  const dia = 86_400_000;

  assert.equal(notification.parseNotificationsAsOf("2026-10-20T14:59:59.123Z", agora), "2026-10-20T14:59:59.123Z");
  assert.equal(notification.parseNotificationsAsOf("2026-10-20T15:00:00.000Z", agora), "2026-10-20T15:00:00.000Z", "a propria hora vale");
  assert.equal(notification.parseNotificationsAsOf(new Date(agora - 90 * dia).toISOString(), agora), new Date(agora - 90 * dia).toISOString(), "90 dias ainda vale");

  for (const invalido of [
    "2026-10-20T15:00:00.001Z",
    new Date(agora - 90 * dia - 1).toISOString(),
    "2026-10-20T12:00:00-03:00",
    "2026-10-20",
    "ontem",
    "",
    null,
    undefined,
    agora,
    { asOf: "2026-10-20T14:00:00.000Z" }
  ]) {
    assert.equal(notification.parseNotificationsAsOf(invalido, agora), null, String(invalido));
  }
});

test("forma de onda: inteiros de 0 a 100 reamostrados para 48 barras; sem dado, barras baixas", () => {
  const padrao = notification.normalizePeaks(null);
  assert.equal(padrao.length, 48);
  assert.ok(padrao.every((peak) => peak === 12));
  assert.deepEqual(notification.normalizePeaks("lixo", 3), [12, 12, 12]);

  assert.deepEqual(notification.normalizePeaks([10.4, 250, -5, "x"], 4), [10, 100, 0, 0]);
  assert.deepEqual(notification.normalizePeaks([1, 9, 3, 7], 2), [9, 7], "cada barra fica com o maior pico do trecho");
  assert.deepEqual(notification.normalizePeaks([40, 80], 4), [40, 40, 80, 80]);
  assert.equal(notification.normalizePeaks(Array.from({ length: 96 }, (_, index) => index)).length, notification.NOTICE_PEAK_BARS);
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho do editor
 * ---------------------------------------------------------------------------------------------- */

function problemas(draft) {
  const result = schemas.noticeDraftSchema.safeParse(draft);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const notificacao = (extra = {}) => ({ ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Aula ao vivo", ...extra });
const popup = (extra = {}) => ({ ...schemas.emptyNoticeDraft("popup"), title: "Turma nova", ...extra });

test("rascunho vazio de cada tipo: todos os alunos, agora, sem janela, uma vez e com 'Lembrar depois'", () => {
  assert.deepEqual(schemas.emptyNoticeDraft("popup"), {
    allowHide: true,
    allowSnooze: true,
    audience: { kind: "everyone" },
    audio: null,
    body: "",
    cta: null,
    icon: null,
    image: null,
    kind: "popup",
    poll: null,
    popup: { close: "any", delaySeconds: 3, exclude: [], frequency: { mode: "once" }, pages: ["home"], snoozeMinutes: 1440, trigger: "page_load" },
    reactions: false,
    repeat: "once",
    response: null,
    schedule: { mode: "now" },
    sender: null,
    title: "",
    validity: { mode: "default" },
    window: { endsAt: null, startsAt: null }
  });
  assert.equal(schemas.emptyNoticeDraft("inbox").reactions, true, "v3a: a notificacao nova ja permite reacoes");
  assert.equal("popup" in schemas.emptyNoticeDraft("inbox"), false, "v3b-1: a notificacao nao leva a configuracao do pop-up");
  const primeiro = schemas.emptyNoticeDraft("popup");
  primeiro.popup.pages.push("profile");
  assert.deepEqual(schemas.emptyNoticeDraft("popup").popup.pages, ["home"], "cada rascunho com as proprias listas");
  assert.equal(schemas.emptyNoticeDraft("inbox").poll, null);
  assert.deepEqual(problemas(notificacao()), []);
  assert.deepEqual(problemas(popup()), []);
});

test("rascunho: titulo e texto com limite por tipo (notificacao 80/600, pop-up 60/240) e titulo obrigatorio", () => {
  assert.deepEqual(problemas(notificacao({ title: "x".repeat(80), body: "y".repeat(600) })), []);
  assert.deepEqual(problemas(notificacao({ title: "x".repeat(81) })), [["title", "Use até 80 caracteres."]]);
  assert.deepEqual(problemas(notificacao({ body: "y".repeat(601) })), [["body", "Use até 600 caracteres."]]);
  assert.deepEqual(problemas(popup({ title: "x".repeat(61) })), [["title", "Use até 60 caracteres."]]);
  assert.deepEqual(problemas(popup({ body: "y".repeat(241) })), [["body", "Use até 240 caracteres."]]);
  assert.deepEqual(problemas(notificacao({ title: "   " })), [["title", "Escreva um título."]]);
  assert.equal(schemas.noticeDraftSchema.parse(notificacao({ title: "  Aula  " })).title, "Aula", "titulo sem espacos nas pontas");
});

test("rascunho: o botao so leva a pagina da area ou a link https; pop-up nao pede resposta; fim da janela depois do inicio", () => {
  const botao = (href) => notificacao({ cta: { href, label: "Abrir", target: "same_tab" } });

  assert.deepEqual(problemas(botao("/conteudo/teste-curso-agentes")), []);
  assert.deepEqual(problemas(botao("https://exemplo.test/inscricao")), []);
  assert.deepEqual(problemas(botao("javascript:alert(1)")).map(([path]) => path), ["cta.href"]);
  assert.deepEqual(problemas(botao("http://exemplo.test")).map(([path]) => path), ["cta.href"]);
  assert.deepEqual(problemas(botao("//outro-site.test")).map(([path]) => path), ["cta.href"]);
  assert.deepEqual(problemas(botao("/api/notifications")).map(([path]) => path), ["cta.href"]);
  assert.deepEqual(problemas(notificacao({ cta: { href: "/", label: "x".repeat(31), target: "new_tab" } })), [["cta.label", "Use até 30 caracteres."]]);

  assert.deepEqual(problemas(popup({ response: { acceptLabel: "Sim", declineLabel: "Não" } })), [["response", "Pedir resposta vale só para notificações."]]);
  assert.deepEqual(problemas(notificacao({ response: { acceptLabel: "Sim", declineLabel: "Não" } })), []);
  assert.deepEqual(problemas(notificacao({ response: { acceptLabel: "", declineLabel: "Não" } })), [["response.acceptLabel", "Escreva o texto do botão de aceitar."]]);

  const janela = (startsAt, endsAt) => popup({ window: { endsAt, startsAt } });
  assert.deepEqual(problemas(janela("2026-10-21T12:00:00.000Z", "2026-10-21T12:00:00.000Z")), [["window.endsAt", "O fim precisa vir depois do início."]]);
  assert.deepEqual(problemas(janela("2026-10-21T12:00:00.000Z", "2026-10-22T12:00:00.000Z")), []);
});

test("rascunho: imagem e audio so do armazenamento seguro (https ou o Supabase local) e audio de ate 5 minutos", () => {
  assert.deepEqual(problemas(notificacao({ image: { alt: "", url: "https://cdn.exemplo.test/a.webp" } })), []);
  assert.deepEqual(problemas(notificacao({ image: { alt: "", url: "http://127.0.0.1:55321/storage/v1/object/public/a.webp" } })), []);
  assert.deepEqual(problemas(notificacao({ image: { alt: "", url: "http://exemplo.test/a.webp" } })), [["image.url", "Envie o arquivo de novo."]]);

  const audio = (durationSeconds) => notificacao({ audio: { durationSeconds, mimeType: "audio/webm", peaks: [10, 20], url: "https://cdn.exemplo.test/a.webm" } });
  assert.deepEqual(problemas(audio(300)), []);
  assert.deepEqual(problemas(audio(301)), [["audio.durationSeconds", "Use um áudio de até 5 minutos."]]);
  assert.deepEqual(problemas(audio(0)), [["audio.durationSeconds", "O áudio precisa ter pelo menos 1 segundo."]]);
});

test("na hora de publicar: data de envio e fim do pop-up precisam estar no futuro (o rascunho pode guardar uma data passada)", () => {
  const ontem = iso(now - 24 * HOUR);
  const amanha = iso(now + 24 * HOUR);

  assert.deepEqual(problemas(notificacao({ schedule: { mode: "at", sendAt: ontem } })), [], "rascunho aceita");
  assert.deepEqual(schemas.publishProblems(notificacao({ schedule: { mode: "at", sendAt: ontem } }), now), [{ message: "Escolha uma data no futuro.", path: "schedule.sendAt" }]);
  assert.deepEqual(schemas.publishProblems(notificacao({ schedule: { mode: "at", sendAt: amanha } }), now), []);
  assert.deepEqual(schemas.publishProblems(notificacao(), now), []);
  assert.deepEqual(schemas.publishProblems(popup({ window: { endsAt: ontem, startsAt: null } }), now), [{ message: "Escolha um fim no futuro.", path: "window.endsAt" }]);
  assert.deepEqual(schemas.publishProblems(popup({ window: { endsAt: amanha, startsAt: ontem } }), now), []);
  assert.deepEqual(schemas.publishProblems(popup({ schedule: { mode: "at", sendAt: ontem } }), now), [], "pop-up ignora a agenda da notificacao");
});

test("entradas das acoes: id do aviso e uuid; versao da tela e data ISO; imagem so WebP recortado", () => {
  assert.equal(schemas.noticeIdSchema.safeParse({ id: "x" }).success, false);
  assert.equal(schemas.noticeIdSchema.safeParse({ expectedUpdatedAt: "2026-10-20T15:09:00.123456+00:00", id: "0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f" }).success, true);
  assert.equal(schemas.uploadNoticeImageSchema.safeParse({ image: "data:image/webp;base64,AAAA" }).success, true);
  assert.equal(schemas.uploadNoticeImageSchema.safeParse({ image: "data:image/png;base64,AAAA" }).success, false);
  assert.equal(schemas.saveNoticeSchema.safeParse({ draft: notificacao() }).success, true);
});

/* ------------------------------------------------------------------------------------------------
 * v2 (docs/23): frase de revisao com o tempo no sino e as seguintes; e-mail "enviada em seu nome"
 * ---------------------------------------------------------------------------------------------- */

const messageMeta = await import("../src/server/communications/message-meta.ts");
const sentAs = await import("../src/server/email/templates/sent-as.ts");
const outboxRules = await import("../src/server/email/outbox-rules.ts");

test("frase de revisao v2: quanto tempo fica no sino e as notificacoes seguintes (singular e plural, com a linha de parar)", () => {
  const revisao = (extra) =>
    campaign.describeNoticeReview({ audienceCount: 318, kind: "inbox", repeat: "once", schedule: { mode: "now" }, window: { endsAt: null, startsAt: null }, ...extra });

  assert.equal(revisao({ validity: messageMeta.describeValidity({ minutes: 4_320, mode: "duration" }) }), "Notificação para 318 alunos, enviada agora, fica 3 dias no sino.");
  assert.equal(revisao({ validity: messageMeta.describeValidity({ mode: "default" }) }), "Notificação para 318 alunos, enviada agora, fica 90 dias no sino.");
  assert.equal(
    revisao({ schedule: { mode: "at", sendAt: "2026-10-21T17:30:00.000Z" }, validity: messageMeta.describeValidity({ endsAt: "2026-10-25T02:59:00.000Z", mode: "until" }) }),
    "Notificação para 318 alunos, agendada para 21/10/2026 às 14:30, fica no sino até 24/10/2026 às 23:59."
  );
  assert.equal(revisao({ validity: null }), "Notificação para 318 alunos, enviada agora.", "sem tempo (data incompleta): a frase da v1");
  assert.equal(
    revisao({ followUps: { count: 2 }, validity: "fica 3 dias no sino" }),
    "Notificação para 318 alunos, enviada agora, fica 3 dias no sino. Depois: 2 notificações seguintes."
  );
  assert.equal(revisao({ followUps: { count: 1 }, validity: "fica 3 dias no sino" }), "Notificação para 318 alunos, enviada agora, fica 3 dias no sino. Depois: 1 notificação seguinte.");
  assert.equal(
    revisao({ followUps: { count: 2, stopProductName: "Formação IA" }, validity: "fica 3 dias no sino" }),
    "Notificação para 318 alunos, enviada agora, fica 3 dias no sino. Depois: 2 notificações seguintes, que param para quem tiver acesso a Formação IA."
  );
  assert.equal(revisao({ followUps: { count: 0 } }), "Notificação para 318 alunos, enviada agora.", "sem seguintes, sem o 'Depois'");
  assert.equal(
    revisao({ followUps: { count: 2 }, kind: "popup", validity: "fica 3 dias no sino" }),
    "Pop-up para 318 alunos, a partir de agora, sem data para acabar, no máximo 1 vez.",
    "pop-up nao tem tempo no sino nem seguintes"
  );
});

test("e-mail 'enviada em seu nome': assunto, texto com e sem o botao do admin e 'Alguém da equipe' sem nome", () => {
  const aviso = sentAs.renderSentAsEmail({
    count: 318,
    link: "https://membros.test/admin/comunicacao/avisos/abc",
    origin: "notice",
    publisherName: " Ana Souza ",
    title: "Oferta especial!"
  });

  assert.equal(aviso.subject, "Uma notificação saiu em seu nome");
  assert.match(aviso.text, /Ana Souza enviou a notificação “Oferta especial!” para 318 alunos em seu nome, com a sua foto e o seu nome\./);
  assert.match(aviso.text, /Se você não combinou isso, fale com Ana Souza ou com o dono da escola\./);
  assert.match(aviso.text, /Ver a notificação: https:\/\/membros\.test\/admin\/comunicacao\/avisos\/abc/);
  assert.match(aviso.html, /href="https:\/\/membros\.test\/admin\/comunicacao\/avisos\/abc"/);

  const semLink = sentAs.renderSentAsEmail({ count: 1, link: null, origin: "notice", publisherName: null, title: "Aula <nova>" });
  assert.match(semLink.text, /^Uma notificação saiu em seu nome/);
  assert.match(semLink.text, /Alguém da equipe enviou a notificação “Aula <nova>” para 1 aluno em seu nome/);
  assert.match(semLink.text, /fale com Alguém da equipe ou com o dono da escola/);
  assert.doesNotMatch(semLink.text, /Ver a notificação/, "Professor, Suporte e Analista nao veem Comunicacao: sem link");
  assert.doesNotMatch(semLink.html, /<a href/);
  assert.match(semLink.html, /Aula &lt;nova&gt;/, "o titulo vai escapado no HTML");

  const fluxo = sentAs.renderSentAsEmail({ count: 0, link: "https://membros.test/admin/comunicacao/fluxos/f1", origin: "flow", publisherName: "Ana Souza", title: "Boas-vindas" });
  assert.equal(fluxo.subject, "Um fluxo de notificações usa o seu nome");
  assert.match(fluxo.text, /Ana Souza ativou o fluxo “Boas-vindas”, que envia notificações em seu nome, com a sua foto e o seu nome\./);
  assert.match(fluxo.text, /Ver o fluxo: https:\/\/membros\.test\/admin\/comunicacao\/fluxos\/f1/);
});

test("e-mail 'enviada em seu nome': o tipo sent_as na fila e uma chave por pessoa por aviso (ou por fluxo)", () => {
  assert.ok(outboxRules.EMAIL_KINDS.includes("sent_as"));
  assert.equal(outboxRules.sentAsIdempotencyKey({ campaignId: "c1", userId: "u1" }), "sent-as:campaign:c1:u1");
  assert.equal(outboxRules.sentAsIdempotencyKey({ flowId: "f1", userId: "u1" }), "sent-as:flow:f1:u1");
  assert.notEqual(outboxRules.sentAsIdempotencyKey({ campaignId: "c1", userId: "u1" }), outboxRules.sentAsIdempotencyKey({ campaignId: "c1", userId: "u2" }));
});
