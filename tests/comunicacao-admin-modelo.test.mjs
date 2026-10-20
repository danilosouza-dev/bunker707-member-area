import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Comunicacao > Avisos e pop-ups no admin (docs/22 §2): regras puras da lista, do editor, da previa,
// do construtor de segmento, do audio e do relatorio
// (src/components/admin/v2/communication/notices-view-model.ts).

const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const campaign = await import("../src/server/communications/campaign-model.ts");

const FORBIDDEN_COPY = /campanha|público|audiência|evento|oferta/i;
const NOW = Date.parse("2026-10-20T15:00:00.000Z"); // 12:00 em Sao Paulo

function draft(overrides = {}) {
  return { ...schemas.emptyNoticeDraft("inbox"), title: "Aula ao vivo hoje", ...overrides };
}

test("enderecos: tipo no ?tipo=, pagina valida, editor do pop-up no ar e filtro que guarda o periodo", () => {
  assert.equal(model.parseNoticeKindParam("notificacao"), "inbox");
  assert.equal(model.parseNoticeKindParam(["popup"]), "popup");
  assert.equal(model.parseNoticeKindParam("POPUP"), "popup");
  assert.equal(model.parseNoticeKindParam("banner"), undefined);
  assert.equal(model.parseNoticeKindParam(undefined), undefined);

  assert.equal(model.parseNoticesPage("3"), 3);
  for (const invalid of ["0", "-1", "1.5", "abc", "", undefined, "99999"]) {
    assert.equal(model.parseNoticesPage(invalid), 1, String(invalid));
  }

  assert.equal(model.newNoticeHref(), "/admin/comunicacao/avisos/novo");
  assert.equal(model.newNoticeHref("inbox"), "/admin/comunicacao/avisos/novo");
  assert.equal(model.newNoticeHref("popup"), "/admin/comunicacao/avisos/novo?tipo=popup");
  assert.equal(model.noticeHref("abc"), "/admin/comunicacao/avisos/abc");
  assert.equal(model.noticeHref("abc", { edit: true }), "/admin/comunicacao/avisos/abc?editar=1");

  assert.equal(model.noticesFilterHref({ pagina: "3", periodo: "7d", tipo: "popup" }, "inbox"), "/admin/comunicacao/avisos?periodo=7d&tipo=notificacao");
  assert.equal(model.noticesFilterHref({ periodo: "7d" }, undefined), "/admin/comunicacao/avisos?periodo=7d");
  assert.equal(model.noticesFilterHref({}, undefined), "/admin/comunicacao/avisos");
});

test("numeros da lista: alunos, porcentagem, cliques e nomes de amostra", () => {
  assert.equal(model.formatStudentCount(1), "1 aluno");
  assert.equal(model.formatStudentCount(1318), "1.318 alunos");
  assert.equal(model.formatStudentCount(null), "—");
  assert.equal(model.formatPercent(8), "8%");
  assert.equal(model.formatPercent(12.5), "12,5%");
  assert.equal(model.formatPercent(null), "—");
  assert.equal(model.ratio(1, 3), 33.3);
  assert.equal(model.ratio(5, 0), null);
  assert.equal(model.formatClicks(12, 8), "12 · 8%");
  assert.equal(model.formatClicks(0, null), "0", "ninguem viu: so o numero");

  assert.equal(model.describeSampleNames(["Ana Souza", "Bruno Lima"], 318), "Ana Souza, Bruno Lima e mais 316");
  assert.equal(model.describeSampleNames(["Ana", "Bruno", "Carla"], 3), "Ana, Bruno e Carla");
  assert.equal(model.describeSampleNames(["Ana"], 1), "Ana");
  assert.equal(model.describeSampleNames([], 0), "");
});

test("menu de acoes: ordem fixa, Publicar fica no editor e uma linha antes do que tira do ar", () => {
  const entries = model.noticeMenuEntries(["delete", "duplicate", "publish", "edit", "send_test"]);

  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.destructive, entry.separated]),
    [
      ["Editar", false, false],
      ["Enviar teste para mim", false, false],
      ["Duplicar", false, false],
      ["Excluir", true, true]
    ]
  );

  const live = model.noticeMenuEntries(["edit", "pause", "end", "duplicate"], ["edit", "pause"]);
  assert.deepEqual(live.map((entry) => entry.action), ["duplicate", "end"]);
  assert.equal(live[1].separated, true);
  assert.deepEqual(model.noticeMenuEntries([]), []);

  for (const action of ["approve", "reject", "end", "withdraw", "delete"]) {
    assert.equal(model.noticeActionNeedsConfirm(action), true, action);
  }
  for (const action of ["pause", "resume", "duplicate", "send_test", "cancel_schedule"]) {
    assert.equal(model.noticeActionNeedsConfirm(action), false, action);
  }
});

test("confirmacoes: destrutivas pintadas, contagem certa e sem vocabulario proibido", () => {
  const notice = { audienceCount: 318, kind: "inbox", recipients: 300, title: "Live de hoje" };
  const withdraw = model.noticeActionConfirm("withdraw", notice);

  assert.equal(withdraw.destructive, true);
  assert.equal(withdraw.confirmLabel, "Retirar do sino");
  assert.match(withdraw.description, /dos 300 alunos que receberam/);
  assert.equal(model.noticeActionConfirm("end", { ...notice, kind: "popup" }).destructive, true);
  assert.equal(model.noticeActionConfirm("delete", notice).title, "Excluir “Live de hoje”?");
  assert.match(model.noticeActionConfirm("approve", notice).description, /318 alunos/);
  assert.equal(model.noticeActionConfirm("reject", notice).destructive, false);

  for (const action of ["approve", "reject", "end", "withdraw", "delete"]) {
    const copy = model.noticeActionConfirm(action, notice);
    assert.doesNotMatch(`${copy.title} ${copy.description} ${copy.confirmLabel}`, FORBIDDEN_COPY, action);
  }

  for (const text of [...Object.values(model.NOTICE_ACTION_LABELS), ...Object.values(model.NOTICE_ACTION_TOASTS)]) {
    assert.doesNotMatch(text, FORBIDDEN_COPY, text);
  }
});

test("toast depois de publicar segue o que o servidor decidiu", () => {
  assert.equal(model.publishedNoticeToast({ audienceCount: 320, recipients: 318, situation: "sent" }, "inbox"), "Notificação enviada para 318 alunos.");
  assert.equal(model.publishedNoticeToast({ audienceCount: 1, recipients: null, situation: "sent" }, "inbox"), "Notificação enviada para 1 aluno.");
  assert.equal(model.publishedNoticeToast({ audienceCount: 10, recipients: null, situation: "scheduled" }, "inbox"), "Envio agendado.");
  assert.equal(model.publishedNoticeToast({ audienceCount: 10, recipients: null, situation: "active" }, "popup"), "Pop-up publicado.");
  assert.equal(model.publishedNoticeToast({ audienceCount: 10, recipients: null, situation: "scheduled" }, "popup"), "Pop-up publicado.");
  assert.equal(model.publishedNoticeToast({ audienceCount: 900, recipients: null, situation: "pending_approval" }, "popup"), "Enviado para aprovação.");
});

test("botao principal: mesma regra do servidor (aprovacao acima de 500 sem a permissao de muitos)", () => {
  const editor = { canPublish: true, canPublishLarge: false };
  const owner = { canPublish: true, canPublishLarge: true };
  const intent = (input) => model.primaryIntentFor({ audienceCount: 10, kind: "inbox", permissions: owner, scheduleMode: "now", ...input });

  assert.equal(intent({}), "send_now");
  assert.equal(intent({ scheduleMode: "at" }), "schedule");
  assert.equal(intent({ kind: "popup" }), "popup");
  assert.equal(intent({ audienceCount: 501, permissions: editor }), "approval");
  assert.equal(intent({ audienceCount: 500, permissions: editor }), "send_now", "500 ainda publica direto");
  assert.equal(intent({ audienceCount: 5000, permissions: owner }), "send_now");
  assert.equal(intent({ permissions: { canPublish: false, canPublishLarge: false } }), "approval");
  assert.equal(intent({ audienceCount: null, permissions: editor }), "send_now", "sem contagem ainda: o servidor decide de novo");
  assert.deepEqual(Object.values(model.PRIMARY_INTENT_LABELS).sort(), ["Agendar envio", "Enviar agora", "Enviar para aprovação", "Publicar pop-up"]);

  for (const status of ["draft", "pending_approval", "scheduled", "sent"]) {
    assert.equal(model.isLivePopupStatus("popup", status), false, status);
  }
  assert.equal(model.isLivePopupStatus("popup", "active"), true);
  assert.equal(model.isLivePopupStatus("popup", "paused"), true);
  assert.equal(model.isLivePopupStatus("inbox", "active"), false);
  assert.equal(model.isNoticeKindLocked("draft"), false);
  assert.equal(model.isNoticeKindLocked("pending_approval"), false);
  assert.equal(model.isNoticeKindLocked("scheduled"), true);
  assert.equal(model.isNoticeKindLocked("active"), true);
});

test("rascunho: so os campos do tipo vao ao servidor e a comparacao ignora o que o banco reescreve", () => {
  const popupWindow = { endsAt: "", startsAt: "2026-10-21T12:00:00.000Z" };
  const inbox = draft({ allowSnooze: false, repeat: "until_action", window: popupWindow });
  const sent = model.noticeDraftForKind(inbox);

  assert.deepEqual(sent.window, { endsAt: null, startsAt: null }, "janela incompleta do pop-up nao trava a notificacao");
  assert.equal(sent.allowSnooze, true);
  assert.equal(sent.repeat, "once");
  assert.equal(schemas.noticeDraftSchema.safeParse(sent).success, true);

  const popup = model.noticeDraftForKind(draft({ kind: "popup", response: { acceptLabel: "Vou", declineLabel: "Não vou" }, schedule: { mode: "at", sendAt: "" } }));
  assert.equal(popup.response, null);
  assert.deepEqual(popup.schedule, { mode: "now" });

  // Banco devolve +00:00, ids ordenados e texto aparado: continua "sem mudanca".
  const local = draft({
    audience: { kind: "rules", root: { items: [{ op: "has", productIds: ["b", "a", "a"], type: "product" }], match: "all" } },
    schedule: { mode: "at", sendAt: "2026-10-21T17:30:00.000Z" },
    title: "  Aula ao vivo hoje  "
  });
  const stored = draft({
    audience: { kind: "rules", root: { items: [{ op: "has", productIds: ["a", "b"], type: "product" }], match: "all" } },
    schedule: { mode: "at", sendAt: "2026-10-21T17:30:00+00:00" }
  });
  assert.equal(model.isSameNoticeDraft(local, stored), true);
  assert.equal(model.isSameNoticeDraft(local, { ...stored, body: "Novo texto" }), false);
  assert.equal(model.isSameNoticeDraft(draft({ window: popupWindow }), draft()), true, "notificacao ignora a janela");
});

test("Recarregar depois de conflito: fica o que mudou aqui, o resto segue o banco", () => {
  const base = draft({ body: "Texto antigo" });
  const local = { ...base, body: "Texto novo daqui" };
  const server = { ...base, body: "Texto antigo", title: "Título mudado na outra tela" };
  const rebased = model.rebaseNoticeDraft(base, local, server);

  assert.equal(rebased.body, "Texto novo daqui");
  assert.equal(rebased.title, "Título mudado na outra tela");
  assert.deepEqual(model.rebaseNoticeDraft(base, base, server), server, "sem mudanca local: a versao do banco");
});

test("erros: caminho do campo, prefixo da Server Action e posicao da regra no segmento", () => {
  assert.deepEqual(
    model.noticeErrorsFrom([
      { message: "Escreva um título.", path: ["title"] },
      { message: "segunda", path: ["title"] },
      { message: "Escolha para onde o botão leva.", path: ["cta", "href"] }
    ]),
    { "cta.href": "Escolha para onde o botão leva.", title: "Escreva um título." }
  );
  assert.deepEqual(model.noticeErrorsFromAction({ "draft.title": ["Use até 80 caracteres."], "schedule.sendAt": ["Escolha uma data no futuro."], vazio: [] }), {
    "schedule.sendAt": "Escolha uma data no futuro.",
    title: "Use até 80 caracteres."
  });
  assert.deepEqual(
    model.audienceErrorsFrom({
      audience: "Use no máximo 20 regras.",
      "audience.root.items.1.items.0.percent": "Use de 0 a 100.",
      "audience.root.items.2.productIds": "Escolha pelo menos um produto.",
      title: "fora do segmento"
    }),
    { "": "Use no máximo 20 regras.", "1.0": "Use de 0 a 100.", 2: "Escolha pelo menos um produto." }
  );

  // O mesmo caminho que o zod devolve para uma regra de produto vazia dentro de um grupo.
  const parsed = schemas.noticeDraftSchema.safeParse(
    draft({ audience: { kind: "rules", root: { items: [{ items: [{ op: "has", productIds: [], type: "product" }], match: "any" }], match: "all" } } })
  );
  assert.equal(parsed.success, false);
  assert.deepEqual(Object.keys(model.audienceErrorsFrom(model.noticeErrorsFrom(parsed.error.issues))), ["0.0"]);
});

test("datas padrao: agendar amanha as 09:00 e janela de 7 dias ate 23:59 (Sao Paulo)", () => {
  assert.equal(model.defaultSendAt(NOW), "2026-10-21T12:00:00.000Z");
  assert.equal(campaign.formatSaoPauloDateTime(model.defaultSendAt(NOW)), "21/10/2026 às 09:00");
  assert.equal(campaign.formatSaoPauloDateTime(model.defaultWindowEnd(null, NOW)), "27/10/2026 às 23:59");
  assert.equal(campaign.formatSaoPauloDateTime(model.defaultWindowEnd("2026-11-01T12:00:00.000Z", NOW)), "08/11/2026 às 23:59");
  // 23h30 em Sao Paulo ja e o dia seguinte em UTC: "amanha" continua sendo o dia seguinte local.
  assert.equal(campaign.formatSaoPauloDateTime(model.defaultSendAt(Date.parse("2026-10-21T02:30:00.000Z"))), "21/10/2026 às 09:00");
});

test("previa: notificacao nao lida da escola, titulo vazio vira dica e botao incompleto some", () => {
  const item = model.draftToNotificationItem(
    draft({
      body: "  Começa às 20h.  ",
      cta: { href: "", label: "Assistir", target: "same_tab" },
      image: { alt: " Professora ", url: "https://cdn.test/a.webp" },
      response: { acceptLabel: " ", declineLabel: "Não vou" },
      title: "   "
    }),
    { createdAt: "2026-10-20T15:00:00.000Z" }
  );

  assert.equal(item.kind, "notice");
  assert.equal(item.actor, null, "aviso vem da escola");
  assert.equal(item.readAt, null, "aparece como nao lida");
  assert.equal(item.title, model.PREVIEW_TITLE_PLACEHOLDER);
  assert.equal(item.body, "Começa às 20h.");
  assert.equal(item.cta, null, "sem destino o botao nao aparece");
  assert.deepEqual(item.image, { alt: "Professora", url: "https://cdn.test/a.webp" });
  assert.deepEqual(item.response, { acceptLabel: "Aceitar", declineLabel: "Não vou", value: null });

  const uploading = model.draftToNotificationItem(draft(), { createdAt: "2026-10-20T15:00:00.000Z", imageUrl: "data:image/webp;base64,AAAA" });
  assert.equal(uploading.image.url, "data:image/webp;base64,AAAA", "imagem ainda subindo ja aparece");

  const popup = model.draftToPopupItem(
    draft({ allowSnooze: false, cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" }, kind: "popup", response: { acceptLabel: "a", declineLabel: "b" } })
  );
  assert.equal(popup.canSnooze, false);
  assert.deepEqual(popup.cta, { href: "/minhas-compras", label: "Ver", target: "same_tab" });
  assert.equal(model.draftToNotificationItem(draft({ kind: "popup", response: { acceptLabel: "a", declineLabel: "b" } }), { createdAt: "x" }).response, null);
});

test("construtor de segmento: regra padrao valida, grupos de um nivel e no maximo 20 regras", () => {
  const validate = (definition) => schemas.audienceDefinitionSchema.safeParse(definition).success;

  for (const type of model.AUDIENCE_RULE_ORDER) {
    const rule = model.defaultAudienceRule(type);
    assert.equal(rule.type, type);
    assert.ok(model.AUDIENCE_RULE_LABELS[type], type);

    if (type !== "product" && type !== "cohort") {
      assert.equal(validate({ kind: "rules", root: { items: [rule], match: "all" } }), true, `${type} ja nasce valida`);
    }
  }

  assert.deepEqual(model.AUDIENCE_RULE_ORDER.map((type) => model.AUDIENCE_RULE_LABELS[type]), [
    "Produto",
    "Progresso nas aulas",
    "Comentários",
    "Tempo de acesso",
    "Acesso terminando",
    "Último estudo",
    "Entrada na plataforma",
    "Ritmo",
    "Turma"
  ]);

  let root = model.starterAudience().root;
  root = model.appendAudienceNode(root, [], model.newAudienceGroup());
  root = model.appendAudienceNode(root, [1], model.defaultAudienceRule("last_study"));
  root = model.replaceAudienceNode(root, [0], { op: "has", productIds: ["curso-a"], type: "product" });
  root = model.replaceAudienceNode(root, [1, 0], { paces: ["inactive"], type: "pace" });

  const definition = { kind: "rules", root };
  assert.equal(validate(definition), true);
  assert.equal(root.items[1].match, "any", "grupo novo nasce com OU");
  assert.deepEqual(root.items[1].items.map((item) => item.type), ["pace", "last_study"]);
  assert.equal(model.appendAudienceNode(root, [0], model.defaultAudienceRule("pace")), root, "regra nao vira grupo");

  const removed = model.removeAudienceNode(root, [1, 1]);
  assert.equal(removed.items[1].items.length, 1);
  assert.equal(model.removeAudienceNode(root, [1]).items.length, 1);

  const twenty = { kind: "rules", root: { items: Array.from({ length: 20 }, () => model.defaultAudienceRule("pace")), match: "all" } };
  assert.equal(model.canAddAudienceRule(twenty), false);
  assert.equal(model.canAddAudienceRule({ kind: "rules", root: { ...twenty.root, items: twenty.root.items.slice(1) } }), true);

  assert.equal(model.commentWindowValue(null), "all");
  assert.equal(model.commentWindowDays("30"), 30);
  assert.equal(model.commentWindowDays("all"), null);
  assert.deepEqual(model.COMMENT_WINDOW_OPTIONS.map((option) => option.label), ["nos últimos 7 dias", "nos últimos 30 dias", "nos últimos 90 dias", "desde sempre"]);
});

test("audio: formato da gravacao, extensao, duracao para cima, limites e forma de onda de 48 barras", () => {
  assert.equal(model.pickRecorderMimeType((type) => type === "audio/webm;codecs=opus" || type === "audio/mp4"), "audio/webm;codecs=opus");
  assert.equal(model.pickRecorderMimeType((type) => type === "audio/mp4"), "audio/mp4", "Safari grava em mp4");
  assert.equal(
    model.pickRecorderMimeType((type) => {
      if (type.includes("codecs")) {
        throw new Error("tipo desconhecido");
      }

      return type === "audio/webm";
    }),
    "audio/webm"
  );
  assert.equal(model.pickRecorderMimeType(() => false), null);

  assert.equal(model.audioFileExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(model.audioFileExtension("audio/mp4"), "m4a");
  assert.equal(model.audioFileExtension("audio/mpeg"), "mp3");
  assert.equal(model.audioFileExtension("audio/x-wav"), "wav");

  assert.equal(model.audioDurationSeconds(57.3), 58);
  assert.equal(model.audioDurationSeconds(60.0004), 60);
  assert.equal(model.audioDurationSeconds(0.2), 1);
  assert.equal(model.audioDurationSeconds(Number.NaN), 1);

  assert.equal(model.describeAudioProblem({ bytes: 10 * 1024 * 1024 }), null);
  assert.equal(model.describeAudioProblem({ bytes: 10 * 1024 * 1024 + 1 }), "O áudio deve ter no máximo 10 MB.");
  assert.equal(model.describeAudioProblem({ seconds: 300 }), null);
  assert.equal(model.describeAudioProblem({ seconds: 300.6 }), "Use um áudio de até 5 minutos.");

  const samples = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 10) * (index < 24_000 ? 0.25 : 1));
  const peaks = model.computeAudioPeaks(samples);
  assert.equal(peaks.length, campaign.AUDIO_LIMITS.peaks);
  assert.ok(peaks.every((peak) => Number.isInteger(peak) && peak >= 0 && peak <= 100));
  assert.equal(Math.max(...peaks), 100);
  assert.ok(peaks[0] <= 26 && peaks[47] === 100, "trecho baixo e trecho alto");
  assert.deepEqual(model.computeAudioPeaks(new Float32Array(100), 4), [0, 0, 0, 0], "silencio");
  assert.equal(model.computeAudioPeaks([0.5], 3).length, 3, "audio curtissimo ainda da 3 barras");
  // A forma de onda passa na validacao do rascunho.
  assert.equal(
    schemas.noticeDraftSchema.safeParse(draft({ audio: { durationSeconds: 58, mimeType: "audio/webm", peaks, url: "https://cdn.test/a.webm" } })).success,
    true
  );

  assert.equal(model.formatAudioClock(5), "0:05");
  assert.equal(model.formatAudioClock(299.9), "4:59");
  assert.equal(model.formatAudioClock(model.RECORDING_LIMIT_SECONDS), "5:00");
});

test("relatorio: funil passo a passo e alerta de quem fecha sem clicar acima de 40%", () => {
  const stats = { accepted: 3, clicked: 30, closedWithoutClick: 81, declined: 1, dismissed: 9, recipients: 400, seen: 200, snoozed: 4, studied7d: 50 };
  const funnel = model.noticeFunnel(stats, "popup");

  assert.deepEqual(
    funnel.map((step) => [step.label, step.value, step.percent]),
    [
      ["Para quem", 400, null],
      ["Viram", 200, 50],
      ["Clicaram", 30, 15],
      ["Voltaram a estudar (7 dias)", 50, 25]
    ]
  );
  assert.equal(funnel[0].base, "podem ver o pop-up");
  assert.equal(funnel[1].base, "de quem pode ver");
  assert.equal(model.noticeFunnel(stats, "inbox")[0].base, "receberam no sino");
  assert.equal(model.noticeFunnel(stats, "inbox")[1].base, "de quem recebeu");
  assert.equal(model.noticeFunnel({ ...stats, recipients: 0, seen: 0 }, "inbox")[1].percent, null);

  assert.equal(model.closedWithoutClickRate(stats), 40.5);
  assert.equal(model.isHighCloseRate(40.5), true);
  assert.equal(model.isHighCloseRate(40), false, "40% ainda nao e alerta");
  assert.equal(model.isHighCloseRate(null), false);
});
