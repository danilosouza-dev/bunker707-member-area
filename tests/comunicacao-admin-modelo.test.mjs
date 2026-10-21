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
  assert.equal(model.isNoticeKindLocked("sent"), true, "v3a: a enviada muda o conteudo, nunca o tipo");
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

  // v3a: o pop-up deixa reacoes e enquete e abre o destino pelo botao; a notificacao guarda o que tem.
  const enquete = { closesAt: null, multiple: false, options: [{ id: "a1", label: "Sim" }, { id: "b2", label: "Não" }], question: "Vem?", showResults: true };
  const comTudo = draft({ cta: { display: "card", href: "/minhas-compras", label: "Ver", target: "same_tab" }, poll: enquete, reactions: true });
  const comoPopup = model.noticeDraftForKind({ ...comTudo, kind: "popup" });
  assert.equal(comoPopup.reactions, false);
  assert.equal(comoPopup.poll, null);
  assert.equal(comoPopup.cta.display, "button");
  assert.equal(schemas.noticeDraftSchema.safeParse(comoPopup).success, true);
  assert.deepEqual(model.noticeDraftForKind(comTudo).poll, enquete);
  assert.equal(model.noticeDraftForKind(comTudo).cta.display, "card");

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
  assert.deepEqual(item.reactions, { value: null }, "v3a: notificacao nova com reacoes mostra o botao de reagir");
  assert.equal(item.poll, null);
  assert.equal(
    model.draftToNotificationItem(draft({ cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" } }), { createdAt: "2026-10-20T15:00:00.000Z" }).cta.display,
    "button",
    "rascunho sem display: pelo botao"
  );

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

test("lista: pagina depois do fim volta para a ultima com avisos (ou para a primeira), com os outros filtros", () => {
  const fallback = (input) => model.noticesPageFallbackHref({ itemCount: 0, page: 5, pageSize: 20, searchParams: { pagina: "5" }, total: 41, ...input });

  assert.equal(fallback({}), "/admin/comunicacao/avisos?pagina=3", "41 avisos: ultima pagina e a 3");
  assert.equal(
    fallback({ searchParams: { pagina: "5", periodo: "7d", tipo: "popup" } }),
    "/admin/comunicacao/avisos?pagina=3&periodo=7d&tipo=popup",
    "filtro e periodo continuam"
  );
  assert.equal(fallback({ total: 20 }), "/admin/comunicacao/avisos", "tudo cabe na primeira: sem ?pagina=");
  assert.equal(fallback({ searchParams: { pagina: "2", tipo: "notificacao" }, total: 0 }), "/admin/comunicacao/avisos?tipo=notificacao", "sem nenhum aviso");
  assert.equal(fallback({ itemCount: 3 }), null, "pagina com linhas fica");
  assert.equal(fallback({ page: 1, total: 0 }), null, "a primeira nunca redireciona");
  assert.equal(fallback({ page: 3, total: 41 }), null, "a pagina existe (a lista mudou no meio): sem laco de redirecionamento");
});

test("aviso: editor ou relatorio; ?editar=1 so abre o editor do pop-up no ar para quem pode editar", () => {
  const opens = (input) => model.opensNoticeEditor({ actions: ["edit"], kind: "inbox", situation: "draft", status: "draft", wantsEditor: false, ...input });

  assert.equal(opens({}), true, "rascunho");
  assert.equal(opens({ situation: "pending_approval", status: "pending_approval" }), true);
  assert.equal(opens({ situation: "scheduled", status: "scheduled" }), true, "notificacao agendada");
  assert.equal(opens({ situation: "sent", status: "sent" }), false, "enviada: relatorio");
  assert.equal(opens({ kind: "popup", situation: "active", status: "active" }), false, "pop-up no ar abre no relatorio");
  assert.equal(opens({ kind: "popup", situation: "active", status: "active", wantsEditor: true }), true, "Editar do relatorio");
  assert.equal(opens({ actions: ["duplicate"], kind: "popup", situation: "paused", status: "paused", wantsEditor: true }), false, "sem messaging.publish: link antigo nao abre o editor");
  assert.equal(opens({ kind: "popup", situation: "ended", status: "active", wantsEditor: true }), false, "janela terminou");
});

test("lista: Vistos e Cliques de aviso que nunca saiu mostram \"—\"", () => {
  const row = (situation, extra = {}) => model.noticeRowNumbers({ clickRate: null, situation, stats: { clicked: 0, seen: 0 }, ...extra });

  for (const situation of ["draft", "pending_approval", "scheduled"]) {
    assert.deepEqual(row(situation), { clicks: "—", seen: "—" }, situation);
  }

  assert.deepEqual(row("sent"), { clicks: "0", seen: "0" }, "enviada sem ninguem ver: zero de verdade");
  assert.deepEqual(row("canceled", { clickRate: 8, stats: { clicked: 12, seen: 150 } }), { clicks: "12 · 8%", seen: "150" }, "retirada do sino guarda os numeros");
  assert.deepEqual(row("active", { clickRate: 12.5, stats: { clicked: 1, seen: 1200 } }), { clicks: "1 · 12,5%", seen: "1.200" });
});

test("editor: salvar sem mudanca nao grava; com mudanca, o toast conta o que foi cancelado; situacao depois de publicar", () => {
  assert.equal(model.NOTHING_TO_SAVE_MESSAGE, "Nenhuma mudança para salvar.");
  assert.equal(model.savedNoticeToast("inbox", "draft"), "Rascunho salvo.");
  assert.equal(model.savedNoticeToast("inbox", null), "Rascunho salvo.", "aviso novo");
  assert.equal(model.savedNoticeToast("inbox", "scheduled"), "Rascunho salvo. O envio agendado foi cancelado: agende de novo.");
  assert.equal(model.savedNoticeToast("popup", "pending_approval"), "Rascunho salvo. O pedido de aprovação foi cancelado.");
  // v3a (docs/24 §2.4): o toast diz o que acontece com quem ja viu pela regra salva ("Uma vez" por padrao).
  assert.equal(model.savedNoticeToast("popup", "active"), "Pop-up atualizado. Quem já viu não vê de novo.");
  assert.equal(model.savedNoticeToast("popup", "paused"), "Pop-up salvo. Ele continua pausado.");
  assert.equal(model.testSentToast(false, "scheduled"), "Enviamos a notificação para o seu sino.", "teste sem mudanca nao grava nada");
  assert.equal(model.testSentToast(true, "scheduled"), "Enviamos a notificação para o seu sino. O envio agendado foi cancelado: agende de novo.");

  assert.equal(model.noticeStatusAfterPublish("inbox", "scheduled"), "scheduled");
  assert.equal(model.noticeStatusAfterPublish("inbox", "sending"), "sending");
  assert.equal(model.noticeStatusAfterPublish("inbox", "pending_approval"), "pending_approval");
  assert.equal(model.noticeStatusAfterPublish("popup", "pending_approval"), "pending_approval");
  assert.equal(model.noticeStatusAfterPublish("popup", "scheduled"), "active", "janela que ainda nao comecou: gravado como no ar");
  assert.equal(model.noticeStatusAfterPublish("popup", "active"), "active");

  assert.equal(model.noticeFailureTitle({ savedDraft: false, status: 400, step: "save" }), "O aviso não foi salvo");
  assert.equal(model.noticeFailureTitle({ savedDraft: true, status: 422, step: "publish" }), "O rascunho foi salvo, mas o aviso não saiu");
  assert.equal(model.noticeFailureTitle({ savedDraft: true, status: 500, step: "test" }), "O rascunho foi salvo, mas o teste não saiu");
  assert.equal(model.noticeFailureTitle({ savedDraft: false, status: 500, step: "test" }), "O teste não saiu");
  assert.equal(model.noticeFailureTitle({ savedDraft: false, status: 0, step: "approve" }), "Há mudanças sem salvar");
  assert.equal(model.noticeFailureTitle({ savedDraft: true, status: 409, step: "publish" }), "Este aviso mudou em outra tela");

  for (const text of [model.savedNoticeToast("inbox", "scheduled"), model.savedNoticeToast("inbox", "pending_approval"), model.noticeFailureTitle({ savedDraft: true, status: 422, step: "publish" })]) {
    assert.doesNotMatch(text, FORBIDDEN_COPY, text);
  }
});

test("construtor de segmento: foco depois de remover e nome do botao com o tipo da regra", () => {
  const root = {
    items: [
      model.defaultAudienceRule("product"),
      { items: [model.defaultAudienceRule("pace"), model.defaultAudienceRule("last_study")], match: "any" },
      model.defaultAudienceRule("comments")
    ],
    match: "all"
  };

  assert.equal(model.audienceFocusAfterRemoval(root, [2]), "1", "a anterior");
  assert.equal(model.audienceFocusAfterRemoval(root, [0]), "0", "a primeira sai: a seguinte assume a posicao");
  assert.equal(model.audienceFocusAfterRemoval(root, [1, 1]), "1.0", "dentro do grupo");
  assert.equal(model.audienceFocusAfterRemoval(root, [1, 0]), "1.0");
  assert.equal(model.audienceFocusAfterRemoval({ items: [{ items: [model.defaultAudienceRule("pace")], match: "any" }], match: "all" }, [0, 0]), "0", "grupo vazio fica com o foco");
  assert.equal(model.audienceFocusAfterRemoval({ items: [model.defaultAudienceRule("pace")], match: "all" }, [0]), null, "sem regra nenhuma: Adicionar regra");
  assert.equal(model.audienceFocusAfterRemoval(root, [7]), null);

  assert.equal(model.removeAudienceRuleLabel("product"), "Remover regra: Produto");
  assert.equal(model.removeAudienceRuleLabel("last_study"), "Remover regra: Último estudo");
});

test("gravacao: para meio segundo antes de 5 min, aceita o atraso da parada e reconhece o microfone bloqueado pela pagina", () => {
  assert.equal(model.RECORDING_AUTO_STOP_SECONDS, 299.5);
  assert.equal(model.settleRecordedDuration(57.3), 58);
  assert.equal(model.settleRecordedDuration(299.6), 300);
  assert.equal(model.settleRecordedDuration(300.4), 300, "atraso da parada automatica: fica no limite");
  assert.equal(model.settleRecordedDuration(302), 300);
  assert.equal(model.settleRecordedDuration(302.5), null, "bem acima do limite: recusa");

  assert.equal(model.MIC_RELOAD_MESSAGE, "Para gravar, recarregue a página. Salve o rascunho antes.");
  const policy = (allowed) => ({ allowsFeature: (feature) => (feature === "microphone" ? allowed : true) });
  assert.equal(model.isMicrophoneBlockedByPolicy({ featurePolicy: policy(false) }), true, "Chrome com microphone=()");
  assert.equal(model.isMicrophoneBlockedByPolicy({ permissionsPolicy: policy(false) }), true);
  assert.equal(model.isMicrophoneBlockedByPolicy({ featurePolicy: policy(true) }), false, "carregado em /admin");
  assert.equal(model.isMicrophoneBlockedByPolicy({}), false, "Firefox e Safari: sem a API, segue o pedido normal");
  assert.equal(model.isMicrophoneBlockedByPolicy(null), false);
  assert.equal(
    model.isMicrophoneBlockedByPolicy({
      featurePolicy: {
        allowsFeature() {
          throw new Error("indisponivel");
        }
      }
    }),
    false
  );
});

/* ------------------------------------------------------------------------------------------------
 * v2 (docs/23): quem envia, icone ao lado do titulo, tempo no sino, previa e relatorio
 * ---------------------------------------------------------------------------------------------- */

const meta = await import("../src/server/communications/message-meta.ts");

const EU = { avatarUrl: null, id: "11111111-1111-4111-8111-111111111111", isMe: true, name: "Ana Souza", roleLabel: "Dono" };
const PROFESSOR = { avatarUrl: "https://cdn.test/carlos.webp", id: "22222222-2222-4222-8222-222222222222", isMe: false, name: "Carlos Lima", roleLabel: "Professor" };
const SEM_FOTO = { avatarUrl: null, id: "33333333-3333-4333-8333-333333333333", isMe: false, name: "Bruna Alves", roleLabel: "Editor de conteúdo" };
const EQUIPE = [PROFESSOR, EU, SEM_FOTO];

test("previa v2: quem envia, icone, 'Termina em 23 h' de uma notificacao de 1 dia e o audio nas pilulas", () => {
  const createdAt = new Date(NOW - model.PREVIEW_AGE_MS).toISOString();
  const audio = { durationSeconds: 20, mimeType: "audio/webm", peaks: [10, 50], url: "https://cdn.test/a.webm" };
  const item = model.draftToNotificationItem(
    draft({ audio, icon: { color: "red", id: "promo" }, sender: { userId: PROFESSOR.id }, validity: { minutes: 1_440, mode: "duration" } }),
    { createdAt, listen: "heard", sender: model.previewSender({ userId: PROFESSOR.id }, EQUIPE) }
  );

  assert.deepEqual(item.actor, { avatarUrl: PROFESSOR.avatarUrl, name: "Carlos Lima" }, "o circulo e a pessoa");
  assert.deepEqual(item.icon, { color: "red", id: "promo" });
  assert.equal(item.expiresAt, new Date(Date.parse(createdAt) + 86_400_000).toISOString());
  assert.equal(meta.urgencyLabel(item, NOW), "Termina em 23 h", "chegou ha instantes: como o aluno ve logo depois do envio");
  assert.equal(model.formatPercent(item.audioProgress.percent), "100%");
  assert.deepEqual(item.audioProgress, { completed: true, heard: "1".repeat(48), percent: 100 });

  const naoOuvido = model.draftToNotificationItem(draft({ audio }), { createdAt });
  assert.deepEqual(naoOuvido.audioProgress, { completed: false, heard: "0".repeat(48), percent: 0 }, "padrao das pilulas: nao ouvido");
  assert.equal(model.draftToNotificationItem(draft(), { createdAt }).audioProgress, null, "sem audio, sem estado");

  const padrao = model.draftToNotificationItem(draft(), { createdAt });
  assert.equal(padrao.actor, null, "sem pessoa: a escola");
  assert.equal(padrao.icon, null);
  assert.equal(padrao.expiresAt, new Date(Date.parse(createdAt) + 90 * 86_400_000).toISOString());
  assert.equal(meta.urgencyLabel(padrao, NOW), null, "o padrao de 90 dias nunca mostra");

  assert.equal(model.previewSender({ userId: "44444444-4444-4444-8444-444444444444" }, EQUIPE), null, "quem saiu da equipe aparece como a escola");
  assert.equal(model.draftToNotificationItem(draft({ validity: { endsAt: new Date(NOW - 3_600_000).toISOString(), mode: "until" } }), { createdAt }).expiresAt, null, "data que ja passou: sem fim na previa");

  const seguinte = { ...draft(), validity: { mode: "with_anchor" } };
  assert.equal(model.draftToNotificationItem(seguinte, { createdAt }).expiresAt, null, "sem a hora da principal, sem fim");
  assert.equal(
    model.draftToNotificationItem(seguinte, { anchorExpiresAt: NOW + 3 * 3_600_000, createdAt }).expiresAt,
    new Date(NOW + 3 * 3_600_000).toISOString(),
    "ate a principal sumir: o fim da principal"
  );

  const popup = draft({ icon: null, kind: "popup", sender: { userId: PROFESSOR.id } });
  assert.equal(model.draftToNotificationItem(popup, { createdAt, sender: { avatarUrl: null, name: "x" } }).actor, null, "pop-up nao tem quem envia");
  assert.equal("icon" in model.draftToPopupItem(popup), false, "pop-up sem icone: a chave nem vai (como a API)");
  assert.deepEqual(model.draftToPopupItem({ ...popup, icon: { color: "amber", id: "clock" } }).icon, { color: "amber", id: "clock" });
});

test("rascunho v2: canonicalNoticeDraft e isSameNoticeDraft veem quem envia, icone e validade (e nada quando nada mudou)", () => {
  const base = draft({ icon: { color: "red", id: "promo" }, sender: { userId: PROFESSOR.id }, validity: { minutes: 4_320, mode: "duration" } });

  assert.equal(model.isSameNoticeDraft(base, { ...base, icon: { color: "red", id: "promo" }, sender: { userId: PROFESSOR.id } }), true);
  assert.equal(model.isSameNoticeDraft(base, { ...base, sender: null }), false, "quem envia");
  assert.equal(model.isSameNoticeDraft(base, { ...base, icon: { color: "white", id: "promo" } }), false, "cor do icone");
  assert.equal(model.isSameNoticeDraft(base, { ...base, icon: null }), false, "sem icone");
  assert.equal(model.isSameNoticeDraft(base, { ...base, validity: { mode: "default" } }), false, "tempo no sino");
  assert.equal(
    model.isSameNoticeDraft(draft({ validity: { endsAt: "2026-10-25T14:30:00-03:00", mode: "until" } }), draft({ validity: { endsAt: "2026-10-25T17:30:00.000Z", mode: "until" } })),
    true,
    "a mesma data em outro fuso"
  );
  assert.deepEqual(model.canonicalNoticeDraft(draft({ kind: "popup", sender: { userId: PROFESSOR.id }, validity: { minutes: 60, mode: "duration" } })).sender, null, "pop-up nao grava quem envia");
  assert.deepEqual(model.canonicalNoticeDraft(draft({ kind: "popup", validity: { minutes: 60, mode: "duration" } })).validity, { mode: "default" });
});

test("icone: escolher marca a cor sugerida (Promoção -> Vermelho) e os rotulos dizem a escolha em texto", () => {
  assert.deepEqual(model.pickNoticeIcon("promo"), { color: "red", id: "promo" });
  assert.deepEqual(model.pickNoticeIcon("gift"), { color: "green", id: "gift" });
  assert.equal(model.pickNoticeIcon(null), null);

  for (const id of meta.NOTICE_ICON_IDS) {
    assert.equal(model.pickNoticeIcon(id).color, meta.NOTICE_ICON_SUGGESTED_COLOR[id]);
    assert.ok(schemas.iconSchema.safeParse(model.pickNoticeIcon(id)).success, id);
  }

  assert.equal(model.noticeIconFieldLabel(null), "Ícone ao lado do título · Sem ícone");
  assert.equal(model.noticeIconFieldLabel({ color: "red", id: "promo" }), "Ícone ao lado do título · Promoção");
  assert.equal(model.noticeIconColorLabel({ color: "red", id: "promo" }), "Cor do ícone · Vermelho");
  assert.equal(model.noticeIconColorLabel({ color: "amber", id: "promo" }), "Cor do ícone · Amarelo", "a cor pode ser trocada");
});

test("quem envia: a escola primeiro, 'Eu (...)' e a equipe em ordem alfabetica; quem saiu fica no fim", () => {
  const options = model.noticeSenderOptions({ saved: null, schoolIconUrl: meta.SCHOOL_DEFAULT_ICON, schoolName: "Bunker707", senders: EQUIPE });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Bunker707 (a escola)", "Eu (Ana Souza)", "Bruna Alves · Editor de conteúdo", "Carlos Lima · Professor"]
  );
  assert.equal(options[0].value, model.SCHOOL_SENDER_VALUE);
  assert.equal(options[0].avatarUrl, meta.SCHOOL_DEFAULT_ICON);

  const comSaida = model.noticeSenderOptions({ saved: { id: "55555555-5555-4555-8555-555555555555", name: "Dora Reis" }, schoolIconUrl: null, schoolName: "Bunker707", senders: EQUIPE });
  assert.equal(comSaida.at(-1).label, "Dora Reis · fora da equipe");
});

test("quem envia: uma dica por vez, a primeira que vale", () => {
  const dica = (sender, extra = {}) => model.noticeSenderHint({ canEditBrand: false, saved: null, schoolName: "Bunker707", sender, senders: EQUIPE, ...extra });

  const saiu = dica({ userId: "55555555-5555-4555-8555-555555555555" }, { saved: { id: "55555555-5555-4555-8555-555555555555", name: "Dora Reis" } });
  assert.equal(saiu.text, "Dora Reis não está mais na equipe: a notificação sai como Bunker707.");
  assert.equal(saiu.tone, "warning");

  const euSemFoto = dica({ userId: EU.id });
  assert.equal(euSemFoto.text, "Você ainda não tem foto: o aluno vê as suas iniciais.");
  assert.deepEqual(euSemFoto.link, { href: "/perfil", label: "Colocar a minha foto em Perfil", newTab: true });
  assert.equal(euSemFoto.watchesProfile, true, "rele a equipe quando a janela volta ao foco");

  const euComFoto = model.noticeSenderHint({ canEditBrand: false, schoolName: "Bunker707", sender: { userId: EU.id }, senders: [{ ...EU, avatarUrl: "https://cdn.test/ana.webp" }] });
  assert.equal(euComFoto.text, "O aluno vê a foto e o nome de quem envia. Só pessoas da equipe aparecem aqui.");
  assert.equal(euComFoto.watchesProfile, false);

  assert.equal(dica({ userId: PROFESSOR.id }).text, "Quando sair, Carlos Lima recebe um e-mail avisando: “Ana Souza enviou uma notificação em seu nome”.");
  assert.equal(
    dica({ userId: SEM_FOTO.id }).text,
    "Quando sair, Bruna Alves recebe um e-mail avisando: “Ana Souza enviou uma notificação em seu nome”. Bruna Alves ainda não tem foto: o aluno vê as iniciais. Peça para Bruna Alves colocar a foto no Perfil da área de membros."
  );

  assert.equal(dica(null).text, "O aluno vê a foto e o nome de quem envia. Só pessoas da equipe aparecem aqui.", "padrao");
  const marca = dica(null, { canEditBrand: true });
  assert.equal(marca.text, "O círculo mostra o ícone da escola.");
  assert.deepEqual(marca.link, { href: "/admin/area-de-membros/marca", label: "Trocar em Área de membros › Marca", newTab: true });

  for (const hint of [saiu, euSemFoto, dica({ userId: PROFESSOR.id }), marca]) {
    assert.doesNotMatch(hint.text, FORBIDDEN_COPY);
  }
});

test("fica no sino por: pilulas 1, 3, 7, 30 e 90 dias, 'Outro' por um tempo ou ate uma data, e a dica do 'Termina em'", () => {
  assert.deepEqual(model.VALIDITY_CHOICE_OPTIONS.map((option) => option.label), ["1 dia", "3 dias", "7 dias", "30 dias", "90 dias", "Outro"]);
  assert.equal(model.validityChoiceOf({ mode: "default" }), "90", "90 dias e o padrao");
  assert.equal(model.validityChoiceOf({ minutes: 1_440, mode: "duration" }), "1");
  assert.equal(model.validityChoiceOf({ minutes: 43_200, mode: "duration" }), "30");
  assert.equal(model.validityChoiceOf({ minutes: 600, mode: "duration" }), "other");
  assert.equal(model.validityChoiceOf({ endsAt: "2026-10-25T17:30:00.000Z", mode: "until" }), "other");
  assert.equal(model.validityChoiceOf({ mode: "with_anchor" }), "anchor");

  assert.deepEqual(model.validityOfChoice("3", { mode: "default" }), { minutes: 4_320, mode: "duration" });
  assert.deepEqual(model.validityOfChoice("90", { minutes: 600, mode: "duration" }), { mode: "default" });
  assert.deepEqual(model.validityOfChoice("other", { mode: "default" }), model.DEFAULT_OTHER_VALIDITY);
  assert.deepEqual(model.validityOfChoice("other", { minutes: 600, mode: "duration" }), { minutes: 600, mode: "duration" }, "'Outro' guarda o que ja estava");
  assert.deepEqual(model.validityOfChoice("anchor", { mode: "default" }), { mode: "with_anchor" });
  assert.equal(schemas.validitySchema.safeParse(model.DEFAULT_OTHER_VALIDITY).success, true);

  assert.deepEqual(model.validityDurationParts(2_880), { amount: 2, unit: "days" });
  assert.deepEqual(model.validityDurationParts(600), { amount: 10, unit: "hours" });
  assert.equal(model.validityDurationMinutes(5, "hours"), 300);
  assert.equal(model.validityDurationMinutes(2, "days"), 2_880);
  assert.ok(Number.isNaN(model.validityDurationMinutes(Number.NaN, "days")));
  assert.equal(schemas.validitySchema.safeParse({ minutes: model.validityDurationMinutes(Number.NaN, "days"), mode: "duration" }).error.issues[0].message, "Use de 1 hora a 90 dias.");

  assert.equal(model.showsUrgencyHint({ minutes: 43_200, mode: "duration" }, NOW), true, "30 dias ou menos");
  assert.equal(model.showsUrgencyHint({ minutes: 43_260, mode: "duration" }, NOW), false);
  assert.equal(model.showsUrgencyHint({ mode: "default" }, NOW), false, "o padrao de 90 dias nunca mostra");
  assert.equal(model.showsUrgencyHint({ endsAt: new Date(NOW + 5 * 86_400_000).toISOString(), mode: "until" }, NOW), true);
  assert.equal(model.showsUrgencyHint({ endsAt: new Date(NOW + 31 * 86_400_000).toISOString(), mode: "until" }, NOW), false);
});

test("relatorio v2: Abriram no funil da notificacao (sobre quem viu), o audio sobre quem abriu e 'Criada por … · em nome de …'", () => {
  const stats = { accepted: 0, clicked: 30, closedWithoutClick: 0, declined: 0, dismissed: 0, opened: 80, recipients: 400, seen: 200, snoozed: 0, studied7d: 50 };

  assert.deepEqual(
    model.noticeFunnel(stats, "inbox").map((step) => [step.label, step.value, step.percent, step.base]),
    [
      ["Para quem", 400, null, "receberam no sino"],
      ["Viram", 200, 50, "de quem recebeu"],
      ["Abriram", 80, 40, "de quem viu"],
      ["Clicaram", 30, 15, "de quem viu"],
      ["Voltaram a estudar (7 dias)", 50, 25, "de quem viu"]
    ]
  );
  assert.equal(model.noticeFunnel(stats, "popup").some((step) => step.id === "opened"), false, "pop-up nao tem Abriram");
  assert.equal(model.noticeFunnel({ ...stats, opened: undefined }, "inbox")[2].value, 0);

  assert.deepEqual(
    model.noticeAudioSteps({ audioCompleted: 30, audioStarted: 60, opened: 80 }).map((step) => [step.label, step.value, step.percent, step.base]),
    [
      ["Começaram o áudio", 60, 75, "de quem abriu"],
      ["Ouviram até o fim", 30, 37.5, "de quem abriu"]
    ]
  );
  assert.equal(model.noticeAudioSteps({ audioCompleted: 0, audioStarted: 0, opened: 0 })[0].percent, null);

  assert.equal(model.noticeAuthorLine({ name: "Ana Souza" }, { name: "Carlos Lima" }), "Criada por Ana Souza · em nome de Carlos Lima");
  assert.equal(model.noticeAuthorLine({ name: "Ana Souza" }, null), null, "da escola, sem a linha");
  assert.equal(model.noticeAuthorLine(null, { name: "Carlos Lima" }), "Criada por Equipe · em nome de Carlos Lima");
});
