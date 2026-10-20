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
