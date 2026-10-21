import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunicacao v3a "Avisos: CRUD e edicao" (docs/24 §2.1–§2.4): o menu "…" com "Ver relatório" e "Mostrar de
// novo para quem já viu", os dialogos de Excluir pela situacao (com a frase das regras que citam a
// notificacao), os toasts, o editor da notificacao enviada (?editar=1, banner, revisao, campos travados), os
// toasts e as dicas do pop-up no ar e a ultima linha do relatorio. Regras puras de
// src/components/admin/v2/communication/notices-view-model.ts, carregadas direto pelo Node.

const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const campaign = await import("../src/server/communications/campaign-model.ts");

const FORBIDDEN_COPY = /campanha|público|audiência|evento|oferta|automação|gatilho|lembrete/i;
const NOW = Date.parse("2026-10-21T18:00:00.000Z"); // 15:00 em Sao Paulo
const HOUR = 3_600_000;
const WRITE = { canPublish: false, canPublishLarge: false, canWrite: true };
const PUBLISH = { canPublish: true, canPublishLarge: false, canWrite: true };
const OWNER = { canPublish: true, canPublishLarge: true, canWrite: true };

function timing(kind, status, extra = {}) {
  return { endsAt: null, kind, sendAt: null, startsAt: null, status, ...extra };
}

/** Os rotulos do menu de um aviso, como a lista mostra (sem `exclude`). */
function menu(kind, status, permissions, extra = {}, exclude = [], timingExtra = {}) {
  return model.noticeMenuEntries(campaign.availableNoticeActions(timing(kind, status, timingExtra), NOW, permissions, extra), exclude).map((entry) => entry.label);
}

const notice = (overrides = {}) => ({ audienceCount: 320, kind: "inbox", recipients: 318, situation: "sent", title: "Aula nova", ...overrides });

test("menu: Ver relatório primeiro, Mostrar de novo junto das acoes do pop-up no ar, separador antes do que tira do ar", () => {
  assert.deepEqual(menu("inbox", "sent", PUBLISH), ["Ver relatório", "Editar", "Duplicar", "Retirar do sino", "Excluir"], "notificacao enviada");
  assert.deepEqual(menu("inbox", "sent", WRITE), ["Ver relatório", "Duplicar"], "so cria avisos: sem Editar, Retirar nem Excluir");
  assert.deepEqual(menu("inbox", "sent", PUBLISH, { recipients: 501 }), ["Ver relatório", "Duplicar", "Retirar do sino", "Excluir"], "acima de 500 sem publish_large");
  assert.deepEqual(menu("inbox", "sent", OWNER, { recipients: 501 }), ["Ver relatório", "Editar", "Duplicar", "Retirar do sino", "Excluir"]);
  assert.deepEqual(menu("inbox", "sending", OWNER), ["Ver relatório", "Duplicar"], "enviando: nada de Excluir");
  assert.deepEqual(menu("inbox", "scheduled", PUBLISH), ["Editar", "Enviar teste para mim", "Duplicar", "Cancelar agendamento", "Excluir"]);
  assert.deepEqual(menu("inbox", "canceled", WRITE), ["Ver relatório", "Duplicar", "Excluir"]);
  assert.deepEqual(menu("inbox", "draft", WRITE), ["Editar", "Enviar teste para mim", "Duplicar", "Excluir"], "Publicar fica no editor");

  assert.deepEqual(
    menu("popup", "active", PUBLISH, { popupRepeat: "once" }),
    ["Ver relatório", "Editar", "Pausar", "Mostrar de novo para quem já viu", "Duplicar", "Encerrar", "Excluir"],
    "pop-up no ar em Uma vez"
  );
  assert.deepEqual(menu("popup", "active", PUBLISH, { popupRepeat: "until_action" }), ["Ver relatório", "Editar", "Pausar", "Duplicar", "Encerrar", "Excluir"], "Até o aluno clicar: sem Mostrar de novo");
  assert.deepEqual(
    menu("popup", "paused", PUBLISH, { popupRepeat: "once" }),
    ["Ver relatório", "Editar", "Retomar", "Mostrar de novo para quem já viu", "Duplicar", "Encerrar", "Excluir"]
  );
  assert.deepEqual(
    menu("popup", "active", PUBLISH, { popupRepeat: "once" }, [], { startsAt: new Date(NOW + HOUR).toISOString() }),
    ["Ver relatório", "Editar", "Pausar", "Duplicar", "Encerrar", "Excluir"],
    "janela ainda por comecar: ninguem viu, nada para mostrar de novo"
  );
  assert.deepEqual(menu("popup", "ended", WRITE), ["Ver relatório", "Duplicar", "Excluir"]);

  // O relatorio mostra Editar, Pausar e Retomar como botoes e ja e o relatorio; o editor tira Editar e Ver relatorio.
  assert.deepEqual(menu("popup", "active", PUBLISH, { popupRepeat: "once" }, ["edit", "pause", "resume", "view_report"]), [
    "Mostrar de novo para quem já viu",
    "Duplicar",
    "Encerrar",
    "Excluir"
  ]);
  assert.deepEqual(menu("inbox", "sent", PUBLISH, {}, ["edit", "view_report", "send_test", "approve", "reject"]), ["Duplicar", "Retirar do sino", "Excluir"]);

  const entries = model.noticeMenuEntries(campaign.availableNoticeActions(timing("popup", "active"), NOW, PUBLISH, { popupRepeat: "once" }));
  assert.deepEqual(
    entries.filter((entry) => entry.separated).map((entry) => entry.label),
    ["Encerrar"],
    "uma linha so, antes do primeiro que tira do ar"
  );
  assert.deepEqual(
    entries.filter((entry) => entry.destructive).map((entry) => entry.action),
    ["end", "delete"]
  );
  assert.equal(model.noticeActionNeedsConfirm("reshow"), true);
  assert.equal(model.noticeActionNeedsConfirm("view_report"), false);
  assert.equal(model.NOTICE_ACTION_LABELS.view_report, "Ver relatório");
  assert.equal(model.NOTICE_ACTION_LABELS.reshow, "Mostrar de novo para quem já viu");
});

test("Excluir: o texto do dialogo segue a situacao (enviada, agendada, pop-up no ar, pausado, por comecar)", () => {
  const draft = model.noticeActionConfirm("delete", notice({ situation: "draft" }));
  assert.deepEqual(draft, {
    confirmLabel: "Excluir aviso",
    description: "O aviso sai desta lista. Não dá para desfazer.",
    destructive: true,
    title: "Excluir “Aula nova”?"
  });

  for (const situation of ["pending_approval", "canceled", "ended"]) {
    assert.equal(model.noticeActionConfirm("delete", notice({ situation })).description, "O aviso sai desta lista. Não dá para desfazer.", situation);
  }

  assert.deepEqual(model.noticeActionConfirm("delete", notice({ situation: "scheduled" })), {
    confirmLabel: "Excluir aviso",
    description: "O envio agendado é cancelado e o aviso sai desta lista. Não dá para desfazer.",
    destructive: true,
    title: "Excluir “Aula nova”?"
  });

  assert.deepEqual(model.noticeActionConfirm("delete", notice()), {
    confirmLabel: "Excluir notificação",
    description:
      "A notificação some do sino dos 318 alunos que receberam e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino.",
    destructive: true,
    title: "Excluir “Aula nova”?"
  });
  assert.equal(
    model.noticeActionConfirm("delete", notice({ citations: { flows: 1, notices: 2 }, followUps: { count: 2, sent: 40 }, recipients: null })).description,
    "A notificação some do sino de quem recebeu e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino. As notificações seguintes deixam de sair. Atenção: 2 avisos e 1 fluxo usam esta notificação nas regras. Depois de excluir, para eles ninguém recebeu esta notificação.",
    "sem o numero, com seguintes e citada"
  );

  const popup = (situation) => model.noticeActionConfirm("delete", notice({ kind: "popup", situation, title: "Turma nova" }));
  assert.deepEqual(popup("active"), {
    confirmLabel: "Excluir pop-up",
    description: "O pop-up sai da home de todos os alunos agora e o aviso sai desta lista, com o relatório. Não dá para desfazer.",
    destructive: true,
    title: "Excluir “Turma nova”?"
  });

  for (const situation of ["paused", "scheduled"]) {
    const copy = popup(situation);
    assert.equal(copy.description, "O pop-up não volta para a home e o aviso sai desta lista, com o relatório. Não dá para desfazer.", situation);
    assert.doesNotMatch(copy.description, /sai da home/, "pausado ou por comecar nao diz que sai da home agora");
    assert.equal(copy.confirmLabel, "Excluir pop-up");
  }

  assert.equal(popup("ended").description, "O aviso sai desta lista. Não dá para desfazer.", "pop-up encerrado (tambem pelo fim da janela)");
  assert.equal(model.deleteFollowUpsLabel(12), "Excluir também as notificações seguintes que já saíram (12)");
});

test("regras que citam a notificacao: a frase de Excluir e Retirar do sino, singular e plural, nada sem citacao", () => {
  assert.equal(model.citationsSentence({ flows: 0, notices: 1 }, "delete"), "Atenção: 1 aviso usa esta notificação nas regras. Depois de excluir, para ele ninguém recebeu esta notificação.");
  assert.equal(model.citationsSentence({ flows: 1, notices: 0 }, "withdraw"), "Atenção: 1 fluxo usa esta notificação nas regras. Depois de retirar, para ele ninguém recebeu esta notificação.");
  assert.equal(model.citationsSentence({ flows: 1, notices: 2 }, "delete"), "Atenção: 2 avisos e 1 fluxo usam esta notificação nas regras. Depois de excluir, para eles ninguém recebeu esta notificação.");
  assert.equal(model.citationsSentence({ flows: 3, notices: 0 }, "withdraw"), "Atenção: 3 fluxos usam esta notificação nas regras. Depois de retirar, para eles ninguém recebeu esta notificação.");
  assert.equal(model.citationsSentence({ flows: 0, notices: 0 }, "delete"), "");
  assert.equal(model.citationsSentence(null, "delete"), "");
  assert.equal(model.citationsSentence(undefined, "withdraw"), "");

  const withdraw = model.noticeActionConfirm("withdraw", notice({ citations: { flows: 0, notices: 1 } }));
  assert.equal(
    withdraw.description,
    "A notificação some do sino dos 318 alunos que receberam. Os números continuam no relatório. Atenção: 1 aviso usa esta notificação nas regras. Depois de retirar, para ele ninguém recebeu esta notificação."
  );
  assert.equal(
    model.noticeActionConfirm("withdraw", notice()).description,
    "A notificação some do sino dos 318 alunos que receberam. Os números continuam no relatório.",
    "sem citacao, o texto de sempre"
  );
  assert.match(model.noticeActionConfirm("delete", notice({ citations: { flows: 1, notices: 0 } })).description, /Depois de excluir/);
});

test("Excluir e Retirar do sino com 1 aluno: \"do 1 aluno que recebeu\" (singular)", () => {
  assert.equal(
    model.noticeActionConfirm("delete", notice({ recipients: 1 })).description,
    "A notificação some do sino do 1 aluno que recebeu e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino."
  );
  assert.equal(
    model.noticeActionConfirm("withdraw", notice({ recipients: 1 })).description,
    "A notificação some do sino do 1 aluno que recebeu. Os números continuam no relatório."
  );
});

test("Mostrar de novo: dialogo sem numero e toasts com quantos voltam a ver (ou por que ninguem)", () => {
  assert.deepEqual(model.noticeActionConfirm("reshow", notice({ kind: "popup", situation: "active", title: "Turma nova" })), {
    confirmLabel: "Mostrar de novo",
    description:
      "O pop-up volta a aparecer para quem já viu e não clicou. Quem escolheu “Não mostrar de novo” ou clicou no botão continua sem ver.",
    destructive: false,
    title: "Mostrar “Turma nova” de novo?"
  });
  assert.equal(model.reshownPopupToast(120), "O pop-up volta a aparecer para 120 alunos.");
  assert.equal(model.reshownPopupToast(1), "O pop-up volta a aparecer para 1 aluno.");
  assert.equal(model.reshownPopupToast(0), "Ninguém precisava ver de novo: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.");
});

test("Excluir: o toast pela situacao e por quantos sairam do sino", () => {
  assert.equal(model.deletedNoticeToast({ kind: "inbox", removed: 318, situation: "sent" }), "Notificação excluída do sino de 318 alunos.");
  assert.equal(model.deletedNoticeToast({ kind: "inbox", removed: 1, situation: "sent" }), "Notificação excluída do sino de 1 aluno.");
  assert.equal(model.deletedNoticeToast({ kind: "inbox", removed: 0, situation: "sent" }), "Notificação excluída.");
  assert.equal(model.deletedNoticeToast({ kind: "popup", removed: 0, situation: "active" }), "Pop-up excluído. Ele saiu da home.");
  assert.equal(model.deletedNoticeToast({ kind: "popup", removed: 0, situation: "paused" }), "Pop-up excluído.");
  assert.equal(model.deletedNoticeToast({ kind: "popup", removed: 0, situation: "scheduled" }), "Pop-up excluído.");

  for (const [kind, situation] of [["inbox", "draft"], ["inbox", "pending_approval"], ["inbox", "scheduled"], ["inbox", "canceled"], ["popup", "ended"], ["popup", "draft"]]) {
    assert.equal(model.deletedNoticeToast({ kind, removed: 0, situation }), "Aviso excluído.", `${kind} ${situation}`);
  }
});

test("notificacao enviada: o editor so com ?editar=1 e Editar nas acoes; o Editar do menu leva para la", () => {
  const opens = (input) => model.opensNoticeEditor({ actions: ["edit"], kind: "inbox", situation: "sent", status: "sent", wantsEditor: false, ...input });

  assert.equal(opens({}), false, "sem ?editar=1: relatorio");
  assert.equal(opens({ wantsEditor: true }), true, "Editar do menu ou do relatorio");
  assert.equal(opens({ actions: ["view_report", "duplicate"], wantsEditor: true }), false, "sem a permissao (ou acima de 500): ?editar=1 abre o relatorio");
  assert.equal(opens({ situation: "canceled", status: "canceled", wantsEditor: true }), false, "retirada do sino nao muda");
  assert.equal(opens({ situation: "sending", status: "sending", wantsEditor: true }), false, "enviando nao muda");

  assert.equal(model.noticeEditHref({ id: "a1", kind: "inbox", status: "sent" }), "/admin/comunicacao/avisos/a1?editar=1");
  assert.equal(model.noticeEditHref({ id: "a1", kind: "popup", status: "paused" }), "/admin/comunicacao/avisos/a1?editar=1");
  assert.equal(model.noticeEditHref({ id: "a1", kind: "inbox", status: "scheduled" }), "/admin/comunicacao/avisos/a1", "agendada abre direto no editor");
  assert.equal(model.noticeEditHref({ id: "a1", kind: "popup", status: "draft" }), "/admin/comunicacao/avisos/a1");
});

test("editor da notificacao enviada: titulo, banner, revisao, cartoes so leitura, motivos e o toast", () => {
  assert.equal(model.isSentNotice("inbox", "sent"), true);
  assert.equal(model.isSentNotice("inbox", "scheduled"), false);
  assert.equal(model.isSentNotice("popup", "active"), false);
  assert.equal(model.SENT_NOTICE_COPY.title, "Editar notificação enviada");
  assert.equal(model.SENT_NOTICE_COPY.save, "Salvar alterações");
  assert.equal(model.SENT_NOTICE_COPY.viewReport, "Ver relatório");
  assert.equal(model.SENT_NOTICE_COPY.saveHint, "Ctrl+Enter (⌘+Enter no Mac) salva as alterações.");
  assert.equal(
    model.sentNoticeBanner(318),
    "Esta notificação já está no sino de 318 alunos. O que você salvar aparece para todos na hora, sem avisar de novo e sem marcar como nova. Para avisar de novo, envie uma notificação nova."
  );
  assert.match(model.sentNoticeBanner(null), /^Esta notificação já está no sino de quem recebeu\./);
  assert.equal(
    model.sentNoticeReview({ recipients: 318, sentAt: "2026-10-21T17:30:00.000Z" }),
    "Notificação enviada para 318 alunos em 21/10/2026 às 14:30. Salvar muda o que eles veem agora."
  );
  assert.equal(model.sentNoticeAudienceNote(318), "Já enviada para 318 alunos. O segmento não muda depois do envio.");
  assert.equal(
    model.sentNoticeWhenNote({ sentAt: "2026-10-21T17:30:00.000Z", validityLabel: "fica 3 dias no sino" }),
    "Enviada em 21/10/2026 às 14:30 · fica 3 dias no sino. Não muda depois do envio."
  );
  assert.equal(model.SENT_NOTICE_COPY.previewDirty, "Mudanças não salvas: os alunos ainda veem a versão anterior.");
  assert.equal(model.SENT_NOTICE_COPY.previewClean, "Assim os alunos veem agora.");
  assert.equal(model.SENT_NOTICE_COPY.followUps, "As notificações seguintes mudam no relatório.");
  assert.equal(model.SENT_NOTICE_COPY.followUpsLink, "Ir para o relatório");
  assert.equal(
    model.SENT_NOTICE_COPY.destinationNote,
    "As notificações seguintes que usam “visitou a página para onde a notificação leva” passam a olhar a página nova, contando a partir de agora."
  );
  assert.deepEqual(model.SENT_NOTICE_COPY.locked, {
    audio: "O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo. Para trocar, duplique a notificação.",
    poll: "A enquete não muda depois do envio. Para parar a votação, use Encerrar enquete no relatório.",
    responseMode: "Pedir uma resposta não muda depois do envio. Os textos dos botões podem mudar."
  });
  assert.equal(model.savedNoticeToast("inbox", "sent", { recipients: 318 }), "Notificação atualizada no sino de 318 alunos.");
  assert.equal(model.savedNoticeToast("inbox", "sent"), "Notificação atualizada no sino.");
});

test("seguintes que olham a pagina do destino: o aviso de que trocar o destino muda o que elas olham", () => {
  const entry = "entrada-1";
  const visited = (nodeId) => ({
    kind: "rules",
    root: { items: [{ negate: true, page: { kind: "message_cta", nodeId }, since: { kind: "message", nodeId }, type: "page_visit" }], match: "all" }
  });

  assert.equal(model.usesNoticeDestinationPage([visited(entry)], entry), true);
  assert.equal(model.usesNoticeDestinationPage([{ kind: "everyone" }, { kind: "rules", root: { items: [visited(entry).root], match: "any" } }], entry), true, "dentro de um grupo");
  assert.equal(model.usesNoticeDestinationPage([visited("outra-seguinte")], entry), false, "a pagina de outra seguinte");
  assert.equal(model.usesNoticeDestinationPage([{ kind: "everyone" }], entry), false);
  assert.equal(model.usesNoticeDestinationPage([], entry), false);
});

test("pop-up no ar: banner, toasts pela regra salva e quantos voltam a ver", () => {
  assert.equal(model.livePopupBanner("active"), "Este pop-up está no ar. As mudanças valem assim que você salvar.");
  assert.equal(model.livePopupBanner("paused"), "Este pop-up está pausado. As mudanças valem quando ele voltar ao ar.");

  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once" }), "Pop-up atualizado. Quem já viu não vê de novo.");
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "until_action" }), "Pop-up atualizado. Quem fechou sem clicar volta a ver 24 horas depois de ter visto este pop-up.");
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once", reshown: 120 }), "Pop-up atualizado. Ele volta a aparecer para 120 alunos que já tinham visto.");
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once", reshown: 1 }), "Pop-up atualizado. Ele volta a aparecer para 1 aluno que já tinha visto.");
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once", reshown: 0 }), "Pop-up atualizado. Quem já viu não vê de novo.", "ninguem para mostrar de novo");
  assert.equal(model.savedNoticeToast("popup", "paused", { repeat: "once" }), "Pop-up salvo. Ele continua pausado.");
  assert.equal(
    model.savedNoticeToast("popup", "paused", { repeat: "once", reshown: 4 }),
    "Pop-up salvo. Ele continua pausado. Ao retomar, volta a aparecer para quem já tinha visto."
  );
  assert.equal(model.savedNoticeToast("popup", "draft", { repeat: "once" }), "Rascunho salvo.", "rascunho nao muda");
});

test("Mostrar de novo no editor: so no pop-up no ar em Uma vez, com a contagem e as dicas de Quantas vezes", () => {
  assert.equal(model.showsReshowSwitch({ kind: "popup", repeat: "once", status: "active" }), true);
  assert.equal(model.showsReshowSwitch({ kind: "popup", repeat: "once", status: "paused" }), true);
  assert.equal(model.showsReshowSwitch({ kind: "popup", repeat: "until_action", status: "active" }), false, "Até o aluno clicar: sem switch");
  assert.equal(model.showsReshowSwitch({ kind: "popup", repeat: "once", status: "draft" }), false, "rascunho: ninguem viu");
  assert.equal(model.showsReshowSwitch({ kind: "inbox", repeat: "once", status: "sent" }), false);
  assert.equal(model.RESHOW_SWITCH_LABEL, "Mostrar de novo para quem já viu");

  assert.deepEqual(model.reshowSwitchCopy(120), {
    description: "Para os 120 alunos que já viram e não clicaram. Quem clicou no botão ou escolheu “Não mostrar de novo” continua sem ver.",
    disabled: false
  });
  assert.equal(
    model.reshowSwitchCopy(1).description,
    "Para 1 aluno que já viu e não clicou. Quem clicou no botão ou escolheu “Não mostrar de novo” continua sem ver."
  );
  assert.deepEqual(model.reshowSwitchCopy(0), {
    description: "Ninguém precisa ver de novo agora: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.",
    disabled: true
  });
  assert.equal(model.reshowSwitchCopy(null).disabled, false, "sem a contagem, o servidor confere");
  assert.match(model.reshowSwitchCopy(null).description, /^Para quem já viu e não clicou\./);

  assert.equal(
    model.popupRepeatChangeHint({ saved: "once", shown: "until_action", status: "active" }),
    "Quem só fechou volta a ver 24 horas depois de ter visto este pop-up, até clicar. Quem clicou ou escolheu “Não mostrar de novo” não vê mais."
  );
  assert.equal(
    model.popupRepeatChangeHint({ saved: "until_action", shown: "once", status: "paused" }),
    "Quem já viu não vê de novo, a não ser que você ligue “Mostrar de novo para quem já viu”."
  );
  assert.equal(model.popupRepeatChangeHint({ saved: "once", shown: "once", status: "active" }), null, "sem mudanca");
  assert.equal(model.popupRepeatChangeHint({ saved: "once", shown: "until_action", status: "draft" }), null, "rascunho: ninguem viu ainda");
});

test("relatorio: a ultima linha diz por que a notificacao enviada nao muda (e some quando ha Editar)", () => {
  const line = (input) =>
    model.noticeReportLastLine({ actions: ["view_report", "duplicate"], kind: "inbox", permissions: WRITE, recipients: 318, status: "sent", ...input });

  assert.equal(line({}), "Só quem pode publicar muda uma notificação enviada. Para mandar de novo, use Duplicar no menu.", "so cria avisos");
  assert.equal(
    line({ permissions: PUBLISH, recipients: 501 }),
    "Esta notificação chegou a mais de 500 alunos: só um dono ou administrador muda depois do envio. Para mandar de novo, use Duplicar no menu."
  );
  assert.equal(line({ actions: ["view_report", "edit", "duplicate"], permissions: PUBLISH }), null, "quem pode editar ve o Editar");
  assert.equal(line({ status: "canceled" }), "Este aviso não muda mais. Para mandar de novo ou ajustar, use Duplicar no menu.", "retirada do sino");
  assert.equal(line({ kind: "popup", status: "ended" }), "Este aviso não muda mais. Para mandar de novo ou ajustar, use Duplicar no menu.", "pop-up encerrado");
  assert.equal(line({ permissions: { ...WRITE, canWrite: false } }), null, "sem acesso a avisos");
});

test("vocabulario: nenhuma palavra proibida nos textos novos de CRUD e edicao", () => {
  const texts = [
    ...Object.values(model.NOTICE_ACTION_LABELS),
    ...Object.values(model.NOTICE_ACTION_TOASTS),
    model.citationsSentence({ flows: 2, notices: 3 }, "delete"),
    model.citationsSentence({ flows: 1, notices: 0 }, "withdraw"),
    model.deleteFollowUpsLabel(3),
    model.reshownPopupToast(3),
    model.reshownPopupToast(0),
    model.livePopupBanner("active"),
    model.livePopupBanner("paused"),
    model.reshowSwitchCopy(3).description,
    model.reshowSwitchCopy(0).description,
    model.popupRepeatChangeHint({ saved: "once", shown: "until_action", status: "active" }),
    model.popupRepeatChangeHint({ saved: "until_action", shown: "once", status: "active" }),
    model.sentNoticeBanner(10),
    model.sentNoticeReview({ recipients: 10, sentAt: "2026-10-21T17:30:00.000Z" }),
    model.sentNoticeAudienceNote(10),
    model.sentNoticeWhenNote({ sentAt: "2026-10-21T17:30:00.000Z", validityLabel: "fica 3 dias no sino" }),
    ...Object.values(model.SENT_NOTICE_COPY).filter((value) => typeof value === "string"),
    ...Object.values(model.SENT_NOTICE_COPY.locked),
    model.noticeReportLastLine({ actions: ["duplicate"], kind: "inbox", permissions: WRITE, recipients: 10, status: "sent" }),
    model.noticeReportLastLine({ actions: ["duplicate"], kind: "inbox", permissions: PUBLISH, recipients: 501, status: "sent" })
  ];

  for (const situation of ["draft", "scheduled", "sent", "active", "paused"]) {
    for (const kind of ["inbox", "popup"]) {
      const copy = model.noticeActionConfirm("delete", notice({ citations: { flows: 1, notices: 1 }, followUps: { count: 1, sent: 1 }, kind, situation }));
      texts.push(copy.title, copy.description, copy.confirmLabel, model.deletedNoticeToast({ kind, removed: 3, situation }));
    }
  }

  for (const [kind, status, repeat] of [["popup", "active", "once"], ["popup", "active", "until_action"], ["popup", "paused", "once"], ["inbox", "sent", "once"]]) {
    texts.push(model.savedNoticeToast(kind, status, { recipients: 3, repeat, reshown: 2 }), model.savedNoticeToast(kind, status, { recipients: 3, repeat }));
  }

  const reshow = model.noticeActionConfirm("reshow", notice({ kind: "popup", situation: "active" }));
  texts.push(reshow.title, reshow.description, reshow.confirmLabel);

  for (const text of texts) {
    assert.equal(typeof text, "string");
    assert.doesNotMatch(text, FORBIDDEN_COPY, text);
    assert.doesNotMatch(text, /\s{2}|\s[.,]/, `espaco sobrando: ${text}`);
  }
});
