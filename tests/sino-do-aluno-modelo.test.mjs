import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras do sino e do pop-up do aluno (src/components/member/notifications/notifications-model.ts):
// grupos por dia civil de Sao Paulo, numero e nome acessivel do sino, relogio e onda do audio, destino
// dos links e marcacao local de lidas. O que e tela (abrir o sino, clicar, pop-up na home) esta nos
// fluxos de ponta a ponta.

const model = await import("../src/components/member/notifications/notifications-model.ts");

// 20/10/2026 12:00 em Sao Paulo (UTC-3).
const now = Date.parse("2026-10-20T15:00:00.000Z");

test("grupos por dia seguem o dia civil de Sao Paulo, mantem a ordem e somem quando vazios", () => {
  const items = [
    { createdAt: "2026-10-20T14:59:00.000Z", id: "agora" },
    // 00:30 de 20/10 em Sao Paulo (03:30 UTC): ainda e hoje.
    { createdAt: "2026-10-20T03:30:00.000Z", id: "madrugada" },
    // 23:30 de 19/10 em Sao Paulo (02:30 UTC de 20/10): ontem, mesmo sendo 20/10 em UTC.
    { createdAt: "2026-10-20T02:30:00.000Z", id: "ontem-tarde-da-noite" },
    { createdAt: "2026-10-15T12:00:00.000Z", id: "cinco-dias" },
    { createdAt: "2026-10-13T15:00:00.000Z", id: "sete-dias" },
    { createdAt: "2026-07-01T12:00:00.000Z", id: "julho" }
  ];

  const groups = model.groupNotificationsByDay(items, now);

  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.items.map((item) => item.id)]),
    [
      ["today", "Hoje", ["agora", "madrugada"]],
      ["yesterday", "Ontem", ["ontem-tarde-da-noite"]],
      ["week", "Últimos 7 dias", ["cinco-dias"]],
      ["older", "Mais antigas", ["sete-dias", "julho"]]
    ]
  );

  assert.deepEqual(
    model.groupNotificationsByDay([{ createdAt: "2026-10-19T12:00:00.000Z" }], now).map((group) => group.label),
    ["Ontem"]
  );
  assert.deepEqual(model.groupNotificationsByDay([], now), []);
});

test("numero do sino: nada sem novidades, 1 a 9 e 9+ dali para cima", () => {
  assert.equal(model.formatBadgeCount(0), "");
  assert.equal(model.formatBadgeCount(-3), "");
  assert.equal(model.formatBadgeCount(Number.NaN), "");
  assert.equal(model.formatBadgeCount(1), "1");
  assert.equal(model.formatBadgeCount(9), "9");
  assert.equal(model.formatBadgeCount(10), "9+");
  assert.equal(model.formatBadgeCount(250), "9+");
});

test("nome acessivel do sino diz quantas chegaram (singular e plural)", () => {
  assert.equal(model.bellLabel(0), "Notificações");
  assert.equal(model.bellLabel(1), "Notificações, 1 nova");
  assert.equal(model.bellLabel(3), "Notificações, 3 novas");
  assert.equal(model.bellLabel(1200), "Notificações, 1.200 novas");
});

test("numero guardado vale por 1 minuto entre paginas", () => {
  assert.equal(model.SUMMARY_TTL_MS, 60_000);
  assert.equal(model.isSummaryFresh(null, now), false);
  assert.equal(model.isSummaryFresh(now - 59_999, now), true);
  assert.equal(model.isSummaryFresh(now - 60_000, now), false);
  // Relogio do computador voltou: busca de novo.
  assert.equal(model.isSummaryFresh(now + 5_000, now), false);
});

test("relogio do audio: minutos e segundos com dois digitos", () => {
  assert.equal(model.formatAudioClock(0), "0:00");
  assert.equal(model.formatAudioClock(5), "0:05");
  assert.equal(model.formatAudioClock(5.9), "0:05");
  assert.equal(model.formatAudioClock(62), "1:02");
  assert.equal(model.formatAudioClock(720), "12:00");
  assert.equal(model.formatAudioClock(-4), "0:00");
  assert.equal(model.formatAudioClock(Number.POSITIVE_INFINITY), "0:00");

  assert.equal(model.formatAudioTime(12, 58, false), "0:58");
  assert.equal(model.formatAudioTime(12, 58, true), "0:12 / 0:58");
  assert.equal(model.formatAudioPosition(12, 58), "0:12 de 0:58");
});

test("velocidade do audio gira 1x, 1,5x, 2x e volta", () => {
  assert.deepEqual(model.AUDIO_RATES.map(model.formatAudioRate), ["1x", "1,5x", "2x"]);
  assert.equal(model.nextAudioRate(1), 1.5);
  assert.equal(model.nextAudioRate(1.5), 2);
  assert.equal(model.nextAudioRate(2), 1);
  assert.equal(model.clampAudioTime(-3, 40), 0);
  assert.equal(model.clampAudioTime(55, 40), 40);
  assert.equal(model.clampAudioTime(12.5, 40), 12.5);
});

test("onda do audio cabe na largura e reamostra os picos pelo maior de cada trecho", () => {
  assert.equal(model.waveformBarCount(400), 48);
  assert.equal(model.waveformBarCount(126), 25);
  assert.equal(model.waveformBarCount(20), 12);
  assert.equal(model.waveformBarCount(0), 48);

  const heights = model.waveformHeights([0, 100, 50, 50], 2);
  assert.deepEqual(heights, [100, 58]);
  assert.deepEqual(model.waveformHeights([], 3), [15, 15, 15]);
  assert.equal(model.waveformHeights(Array.from({ length: 48 }, () => 40), 20).length, 20);
  assert.ok(model.waveformHeights([200, -5], 2).every((height) => height >= 15 && height <= 100));
});

test("link da notificacao: caminho interno leva o modo ver como; https abre conforme o aviso; o resto nao vira link", () => {
  assert.deepEqual(model.resolveNotificationLink("/conteudo/abc/aulas/m1?lessonId=l1", "same_tab"), {
    href: "/conteudo/abc/aulas/m1?lessonId=l1",
    internal: true,
    newTab: false
  });
  assert.deepEqual(model.resolveNotificationLink("/minhas-compras", "same_tab", "student_with_access"), {
    href: "/minhas-compras?accessPreview=student_with_access",
    internal: true,
    newTab: false
  });
  assert.deepEqual(model.resolveNotificationLink("https://ao-vivo.bunker707.test/live", "new_tab"), {
    href: "https://ao-vivo.bunker707.test/live",
    internal: false,
    newTab: true
  });

  for (const unsafe of ["javascript:alert(1)", "//outro.site", "/\\outro.site", "/api/notifications", "http://site.test", "", null]) {
    assert.equal(model.resolveNotificationLink(unsafe, "same_tab"), null, String(unsafe));
  }
});

test("marcar como lida localmente: so os pedidos (ou todos) e sem mexer nos ja lidos", () => {
  const items = [
    { id: "a", readAt: null },
    { id: "b", readAt: "2026-10-19T10:00:00.000Z" },
    { id: "c", readAt: null }
  ];
  const at = "2026-10-20T15:00:00.000Z";

  assert.deepEqual(model.markNotificationsRead(items, ["a"], at), [
    { id: "a", readAt: at },
    { id: "b", readAt: "2026-10-19T10:00:00.000Z" },
    { id: "c", readAt: null }
  ]);
  assert.deepEqual(
    model.markNotificationsRead(items, "all", at).map((item) => item.readAt),
    [at, "2026-10-19T10:00:00.000Z", at]
  );
  assert.deepEqual(model.appendNotifications(items, [{ id: "c", readAt: at }, { id: "d", readAt: null }]).map((item) => item.id), ["a", "b", "c", "d"]);
});

test("titulo de comentario separa o nome (negrito) do resto; texto longo comeca recolhido", () => {
  assert.deepEqual(model.splitActorTitle("Ana Souza respondeu seu comentário", "Ana Souza"), {
    actor: "Ana Souza",
    rest: " respondeu seu comentário"
  });
  assert.deepEqual(model.splitActorTitle("Alguém mencionou você", null), { actor: null, rest: "Alguém mencionou você" });
  assert.equal(model.shouldClampNotificationBody("a".repeat(180)), false);
  assert.equal(model.shouldClampNotificationBody("a".repeat(181)), true);
  assert.equal(model.POPUP_SESSION_KEY, "bunker707:popup-shown");
});

/* ------------------------------------------------------------------------------------------------
 * v2 (docs/23): audio ouvido, "abriu", quem envia com o "Termina em" e o rodape
 * ---------------------------------------------------------------------------------------------- */

const zeros = "0".repeat(48);
const uns = "1".repeat(48);
const trechos = (quantos) => "1".repeat(quantos) + "0".repeat(48 - quantos);

test("ouvido sai do que tocou de verdade: pular deixa os trechos pulados em 0, meio trecho conta, 2x conta", () => {
  // Audio de 48 s: cada trecho tem 1 s.
  assert.equal(model.heardSlotsFromRanges([], 48), zeros);
  assert.equal(model.heardSlotsFromRanges([{ end: 48, start: 0 }], 48), uns);

  // Ouviu os 3 primeiros segundos e pulou para o fim (ouviu 46..48): o meio nunca tocou.
  const pulou = model.heardSlotsFromRanges(
    [
      { end: 3, start: 0 },
      { end: 48, start: 46 }
    ],
    48
  );
  assert.equal(pulou, "111" + "0".repeat(43) + "11");
  assert.equal(model.countHeard(pulou), 5);

  // Meio trecho conta (0,5 s de 1 s); menos que isso nao.
  assert.equal(model.heardSlotsFromRanges([{ end: 1.5, start: 0 }], 48).slice(0, 3), "110");
  assert.equal(model.heardSlotsFromRanges([{ end: 1.49, start: 0 }], 48).slice(0, 3), "100");
  // Dois pedacos de 0,25 s no mesmo trecho somam meio trecho.
  assert.equal(
    model.heardSlotsFromRanges(
      [
        { end: 0.25, start: 0 },
        { end: 1, start: 0.75 }
      ],
      48
    )[0],
    "1"
  );

  // Em 2x o audio inteiro toca em metade do tempo de relogio: o que conta e o trecho tocado.
  assert.equal(model.heardSlotsFromRanges([{ end: 120, start: 0 }], 120), uns);
  // Pedacos sobrepostos, fora do audio ou invalidos nao quebram nem contam a mais.
  assert.equal(
    model.heardSlotsFromRanges(
      [
        { end: 30, start: 0 },
        { end: 24, start: 10 },
        { end: 99, start: 47.5 },
        { end: Number.NaN, start: 2 },
        { end: 5, start: 9 }
      ],
      48
    ),
    "1".repeat(30) + "0".repeat(17) + "1"
  );
  // Sem duracao (webm sem metadados e sem a medida gravada): nada ouvido.
  assert.equal(model.heardSlotsFromRanges([{ end: 10, start: 0 }], 0), zeros);
  assert.equal(model.heardSlotsFromRanges([{ end: 10, start: 0 }], Number.POSITIVE_INFINITY), zeros);
  assert.equal(model.heardSlotsFromRanges([{ end: 12, start: 0 }], 12, 12), "1".repeat(12));
});

test("ouvido soma por OU (so cresce) e conta os trechos; mascara fora do formato vira nada ouvido", () => {
  assert.equal(model.EMPTY_HEARD, zeros);
  assert.equal(model.orHeard(trechos(10), "0".repeat(40) + "1".repeat(8)), "1".repeat(10) + "0".repeat(30) + "1".repeat(8));
  assert.equal(model.orHeard(uns, zeros), uns);
  assert.equal(model.orHeard("abc", null), zeros);
  assert.equal(model.orHeard("1".repeat(47), trechos(2)), trechos(2), "47 trechos nao e mascara");
  assert.equal(model.countHeard(trechos(44)), 44);
  assert.equal(model.countHeard(undefined), 0);
  assert.equal(model.heardPercent(trechos(44)), 91);
  assert.equal(model.heardPercent(trechos(1)), 2);
  assert.equal(model.heardPercent(uns), 100);
  assert.equal(model.normalizeHeard(trechos(3)), trechos(3));
  assert.equal(model.normalizeHeard("2".repeat(48)), zeros);
});

test("barras ouvidas da onda: cada barra cobre seus trechos e conta pela maioria, de 12 a 48 barras", () => {
  const metade = trechos(24);

  for (const barras of [12, 13, 25, 36, 47, 48]) {
    const ouvidas = model.heardBars(metade, barras);
    assert.equal(ouvidas.length, barras);
    // Primeira metade ouvida, segunda nao (a barra do meio pode cair de qualquer lado).
    assert.equal(ouvidas[0], true, `${barras} barras`);
    assert.equal(ouvidas[barras - 1], false, `${barras} barras`);
    assert.ok(Math.abs(ouvidas.filter(Boolean).length - barras / 2) <= 1, `${barras} barras`);
  }

  assert.deepEqual(model.heardBars(uns, 12), Array.from({ length: 12 }, () => true));
  assert.deepEqual(model.heardBars(zeros, 12), Array.from({ length: 12 }, () => false));
  // 12 barras: cada uma cobre 4 trechos; 2 de 4 nao e a maioria, 3 de 4 e.
  assert.equal(model.heardBars("1100" + "0".repeat(44), 12)[0], false);
  assert.equal(model.heardBars("1110" + "0".repeat(44), 12)[0], true);
  // 48 barras: uma por trecho.
  assert.deepEqual(model.heardBars("10" + "0".repeat(46), 48).slice(0, 3), [true, false, false]);
  // Fora da faixa: no maximo 48 barras.
  assert.equal(model.heardBars(uns, 200).length, 48);
});

test("estado do audio: nunca tocado, ouvido em parte e ouvido a partir de 44 de 48 trechos", () => {
  assert.equal(model.listenState(zeros, false), "never");
  assert.equal(model.listenState(zeros, true), "partial", "comecou nesta visita: nao e mais 'nunca'");
  assert.equal(model.listenState(trechos(1), false), "partial");
  assert.equal(model.listenState(trechos(43), false), "partial");
  assert.equal(model.listenState(trechos(44), false), "completed");
  assert.equal(model.listenState(uns, true), "completed");

  assert.equal(model.audioGroupLabel("Áudio do aviso", { percent: 0, playing: false, state: "never" }), "Áudio do aviso, ainda não ouvido");
  assert.equal(model.audioGroupLabel("Áudio do aviso", { percent: 37, playing: false, state: "partial" }), "Áudio do aviso, ouvido até 37%");
  assert.equal(model.audioGroupLabel("Áudio do aviso", { percent: 100, playing: false, state: "completed" }), "Áudio do aviso, ouvido");
  assert.equal(model.audioGroupLabel("Áudio do aviso", { percent: 37, playing: true, state: "partial" }), "Áudio do aviso", "tocando, a barra de posicao ja anuncia onde esta");

  const audio = { durationSeconds: 30, mimeType: "audio/mpeg", peaks: [], url: "https://midia.test/a.mp3" };
  assert.equal(model.audioListenOf({ audio: null, audioProgress: null }), null, "sem audio, o player nao guarda nada");
  assert.deepEqual(model.audioListenOf({ audio, audioProgress: null }), { completed: false, heard: zeros });
  assert.deepEqual(model.audioListenOf({ audio, audioProgress: { completed: true, heard: uns, percent: 100 } }), { completed: true, heard: uns });

  assert.equal(model.needsAudioStart({ audioProgress: null }), true);
  assert.equal(model.needsAudioStart({ audioProgress: { completed: false, heard: zeros, percent: 0 } }), true);
  assert.equal(model.needsAudioStart({ audioProgress: { completed: false, heard: trechos(3), percent: 6 } }), false, "o servidor ja gravou o comeco");
});

test("quando mandar o ouvido: tocando so com 5 trechos a mais e 15 s, ou ao chegar em 44; pausa e fim por fetch; saindo por beacon", () => {
  const tocando = (heard, known, ms) => model.shouldFlushAudio({ heard, known, msSinceLastSend: ms, reason: "timeupdate" });

  assert.equal(model.AUDIO_FLUSH_MIN_SLOTS, 5);
  assert.equal(model.AUDIO_FLUSH_MIN_MS, 15_000);
  assert.equal(tocando(10, 5, 15_000), "fetch");
  assert.equal(tocando(9, 5, 60_000), null, "4 trechos a mais ainda nao");
  assert.equal(tocando(20, 5, 14_999), null, "antes de 15 s nao");
  assert.equal(tocando(44, 43, 1_000), "fetch", "chegou a 44: confirma o verde na hora");
  assert.equal(tocando(46, 44, 1_000), null, "ja ouvido: so com 5 a mais e 15 s");
  assert.equal(tocando(5, 5, 60_000), null, "nao cresceu");

  for (const reason of ["pause", "ended"]) {
    assert.equal(model.shouldFlushAudio({ heard: 6, known: 5, msSinceLastSend: 0, reason }), "fetch", reason);
    assert.equal(model.shouldFlushAudio({ heard: 5, known: 5, msSinceLastSend: 99_000, reason }), null, `${reason} sem crescer`);
  }

  for (const reason of ["hidden", "pagehide", "unmount"]) {
    assert.equal(model.shouldFlushAudio({ heard: 6, known: 5, msSinceLastSend: 0, reason }), "beacon", reason);
    assert.equal(model.shouldFlushAudio({ heard: 5, known: 5, msSinceLastSend: 0, reason }), null, `${reason} sem crescer`);
  }
});

test("abrir marca lida e aberta, tambem um cartao ja lido pelo Marcar todas; Marcar todas nao abre", () => {
  const at = "2026-10-20T15:00:00.000Z";
  const antes = "2026-10-20T14:00:00.000Z";
  const items = [
    { id: "nova", openedAt: null, readAt: null },
    { id: "lida", openedAt: null, readAt: antes },
    { id: "aberta", openedAt: antes, readAt: antes }
  ];

  assert.deepEqual(model.markNotificationsOpened(items, ["nova", "lida", "aberta"], at), [
    { id: "nova", openedAt: at, readAt: at },
    { id: "lida", openedAt: at, readAt: antes },
    { id: "aberta", openedAt: antes, readAt: antes }
  ]);
  assert.deepEqual(model.markNotificationsOpened(items, ["outra"], at), items);
  assert.equal(model.markNotificationsRead(items, "all", at)[0].openedAt, null, "Marcar todas so le");
});

test("linha de quem envia: a pessoa ou a escola, e Termina em pela hora do servidor da lista", () => {
  const serverNow = Date.parse("2026-10-20T15:00:00.000Z");
  const aviso = {
    actor: null,
    createdAt: "2026-10-20T13:00:00.000Z",
    expiresAt: "2026-10-21T13:00:00.000Z",
    kind: "notice",
    response: null
  };

  assert.deepEqual(model.noticeMeta(aviso, { schoolName: "Bunker707", serverNow }), { hint: "Termina em 22 h", sender: "Bunker707" });
  assert.deepEqual(
    model.noticeMeta({ ...aviso, actor: { avatarUrl: null, name: "  Prof. Carlos Lima " } }, { schoolName: "Bunker707", serverNow }).sender,
    "Prof. Carlos Lima"
  );
  // 90 dias (o padrao): nunca mostra, nem no ultimo dia.
  assert.equal(
    model.noticeMeta(
      { ...aviso, createdAt: "2026-07-23T16:00:00.000Z", expiresAt: "2026-10-21T13:00:00.000Z" },
      { schoolName: "Bunker707", serverNow }
    ).hint,
    null
  );
  // Respondida: nunca; comentario: nunca.
  assert.equal(model.noticeMeta({ ...aviso, response: { value: "accepted" } }, { schoolName: "Bunker707", serverNow }).hint, null);
  assert.equal(model.noticeMeta({ ...aviso, kind: "comment_reply" }, { schoolName: "Bunker707", serverNow }).hint, null);
  // Faltando 40 min.
  assert.equal(
    model.noticeMeta({ ...aviso, expiresAt: "2026-10-20T15:40:00.000Z" }, { schoolName: "Bunker707", serverNow }).hint,
    "Termina em 40 min"
  );
});

test("rodape da lista e a frase da notificacao que saiu do sino", () => {
  assert.equal(model.NOTIFICATIONS_FOOTER, "As notificações ficam aqui por até 90 dias.");
  assert.equal(model.NOTIFICATION_GONE_MESSAGE, "Esta notificação não está mais disponível.");
});

test("avisos mostrados ha menos de 15 s vao em shown (ate 50); comentarios e os mais antigos nao", () => {
  const asOf = "2026-10-20T15:00:00.000Z";
  const items = [
    { createdAt: "2026-10-20T14:59:50.000Z", id: "recente", kind: "notice" },
    { createdAt: "2026-10-20T14:59:45.000Z", id: "na-borda", kind: "notice" },
    { createdAt: "2026-10-20T14:59:44.000Z", id: "antiga", kind: "notice" },
    { createdAt: "2026-10-20T14:59:59.000Z", id: "comentario", kind: "comment_reply" }
  ];

  assert.deepEqual(model.recentFlowIds(items, asOf), ["recente"]);
  assert.deepEqual(model.recentFlowIds(items, ""), []);
  assert.equal(model.MAX_SHOWN_IDS, 50);

  const muitas = Array.from({ length: 70 }, (_, index) => ({ createdAt: asOf, id: `n${index}`, kind: "notice" }));
  assert.equal(model.recentFlowIds(muitas, asOf).length, 50);
});
