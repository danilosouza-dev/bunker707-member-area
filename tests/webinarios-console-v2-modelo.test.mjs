import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O console V2 de quem apresenta (docs/31 §1, V2-12 a V2-15; docs/18 §2.2), as regras puras, sem navegador. Cada fatia
// da fase 2 acrescenta aqui as suas funcoes, no lugar das conferencias de texto do codigo-fonte que elas substituem.
// G3 (V2-12): o tema e o painel do console ficam guardados em chaves proprias, nunca nas da sala: o localStorage e o
// mesmo da area (mesma origem), e a chave da sala misturaria a escolha do produtor no console com a da sala que ele
// abre como aluno. O tema guardado segue a regra da sala: escuro por padrao, claro so com "light".

const prefs = await import("../src/lib/webinar-room-prefs.ts");

test("storedConsoleTheme: escuro por padrao; so \"light\" guardado vira o claro", () => {
  assert.equal(prefs.storedConsoleTheme(null), "dark", "nada guardado");
  assert.equal(prefs.storedConsoleTheme(undefined), "dark", "sem armazenamento");
  assert.equal(prefs.storedConsoleTheme(""), "dark", "vazio");
  assert.equal(prefs.storedConsoleTheme("x"), "dark", "estragado");
  assert.equal(prefs.storedConsoleTheme("LIGHT"), "dark", "so o valor exato que o console grava");
  assert.equal(prefs.storedConsoleTheme("dark"), "dark");
  assert.equal(prefs.storedConsoleTheme("light"), "light");
});

test("o painel do console guardado: aberto por padrao, fechado so com \"0\" (o que useConsolePanelOpen grava)", () => {
  assert.equal(prefs.storedPanelOpen(null), true, "nada guardado: aberto");
  assert.equal(prefs.storedPanelOpen("1"), true);
  assert.equal(prefs.storedPanelOpen("x"), true, "estragado: aberto");
  assert.equal(prefs.storedPanelOpen("0"), false);
});

test("as chaves do console sao proprias: o tema e o painel nunca nas chaves da sala", () => {
  assert.equal(prefs.CONSOLE_THEME_KEY, "bunker707:webinar-console-tema");
  assert.equal(prefs.CONSOLE_PANEL_KEY, "bunker707:webinar-console-painel");
  const sala = [prefs.ROOM_THEME_KEY, prefs.ROOM_PANEL_KEY, prefs.ROOM_VIEW_KEY, prefs.ROOM_POLLS_KEY];
  for (const chave of [prefs.CONSOLE_THEME_KEY, prefs.CONSOLE_PANEL_KEY]) {
    assert.ok(!sala.includes(chave), `${chave} diferente de todas as da sala`);
  }
  assert.notEqual(prefs.CONSOLE_THEME_KEY, prefs.CONSOLE_PANEL_KEY);
  // O mesmo prefixo das escolhas da escola no navegador.
  for (const chave of [prefs.CONSOLE_THEME_KEY, prefs.CONSOLE_PANEL_KEY]) {
    assert.match(chave, /^bunker707:webinar-console-/);
  }
});

/* ------------------------------------------------------------------------------------------------
 * G4 (V2-13): a tela cheia pelo caminho, o esqueleto, o seletor de sessoes e os botoes de situacao do topo
 * ---------------------------------------------------------------------------------------------- */

const nav = await import("../src/components/admin/v2/nav.ts");
const layout = await import("../src/components/admin/v2/communication/webinars/session-console/console-layout-model.ts");
const v2 = await import("../src/server/webinars/console-v2-model.ts");
const tempo = await import("../src/lib/webinar-time.ts");

test("isAdminFullScreenPath: so o console da sessao de um webinario fica em tela cheia (com ou sem a barra no fim)", () => {
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/abc/sala"), true);
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/abc/sala/"), true, "com a barra no fim");
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/abc"), false, "o editor continua com a moldura");
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/abc/sala/x"), false, "nada abaixo do console");
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/sala"), false, "a lista nao e um webinario");
  assert.equal(nav.isAdminFullScreenPath("/admin/comunicacao/webinarios/a/b/sala"), false);
  assert.equal(nav.isAdminFullScreenPath("/admin"), false);
  assert.equal(nav.isAdminFullScreenPath("/webinarios/abc/sala"), false, "a sala do aluno nao e do admin");
  assert.equal(nav.isAdminFullScreenPath(""), false);
  assert.equal(nav.isAdminFullScreenPath(null), false);
  assert.equal(nav.isAdminFullScreenPath(undefined), false);
});

test("consoleSkeleton: com palco, a coluna do palco com o palco e a barra e o painel com a largura por faixa; sem palco, so o painel no meio com 720 px no maximo", () => {
  const live = layout.consoleSkeleton({ hasStage: true, panelOpen: true });
  for (const parte of ["stage", "bar", "stageColumn"]) {
    assert.equal(typeof live[parte], "string", `com palco: ${parte}`);
  }
  assert.match(live.stage, /(?:^| )bg-black(?: |$)/, "o palco preto nos dois temas");
  assert.match(live.stage, /(?:^| )aspect-video(?: |$)/, "16:9 abaixo de lg");
  assert.match(live.stage, /(?:^| )lg:flex-1(?: |$)/, "a altura que sobra a partir de lg");
  assert.match(live.stage, /(?:^| )rounded-2xl(?: |$)/, "16 px de canto");
  for (const largura of ["lg:w-80", "xl:w-[360px]", "2xl:w-[440px]"]) {
    assert.ok(live.panel.split(" ").includes(largura), `o painel com ${largura}`);
  }
  assert.doesNotMatch(live.panel, /max-w-\[720px\]/);
  assert.match(live.root, /(?:^| )lg:h-dvh(?: |$)/, "a altura da janela a partir de lg");
  assert.match(live.root, /(?:^| )bg-room-bg(?: |$)/, "o fundo do tema, o mesmo atras do iframe");
  assert.match(live.top, /(?:^| )lg:h-14(?: |$)/, "o topo de 56 px a partir de lg");

  // Fechado, o painel some (continua montado) e nada mais disputa o display com o `hidden`.
  assert.equal(layout.consoleSkeleton({ hasStage: true, panelOpen: false }).panel, "hidden");

  const gravada = layout.consoleSkeleton({ hasStage: false, panelOpen: true });
  assert.equal(gravada.stage, null);
  assert.equal(gravada.bar, null);
  assert.equal(gravada.stageColumn, null);
  assert.ok(gravada.panel.split(" ").includes("max-w-[720px]"), "a coluna de ate 720 px");
  assert.ok(gravada.panel.split(" ").includes("mx-auto"), "no meio");
  assert.equal(layout.consoleSkeleton({ hasStage: false, panelOpen: false }).panel, gravada.panel, "sem palco o painel nunca fecha");
  assert.equal(layout.CONSOLE_PANEL_ID, "console-panel");
  assert.equal(layout.CONSOLE_SETTINGS_ID, "console-live-settings");
});

test("formatWebinarDayMonthTime: \"30/10 às 20:00\" em Sao Paulo, sem o ano nem o dia da semana", () => {
  assert.equal(tempo.formatWebinarDayMonthTime("2026-10-30T23:00:00.000Z"), "30/10 às 20:00");
  assert.equal(tempo.formatWebinarDayMonthTime("2026-11-05T12:30:00.000Z"), "5/11 às 09:30");
  assert.equal(tempo.formatWebinarDayMonthTime(""), "");
  assert.equal(tempo.formatWebinarDayMonthTime(null), "");
  assert.equal(tempo.formatWebinarDayMonthTime("x"), "");
});

test("consoleSessionOptionLabel: \"Sessão de 30/10 às 20:00 · no ar\" pela situacao gravada, sem o ano; o Replay so com a hora", () => {
  const at = "2026-10-30T23:00:00.000Z";
  assert.equal(v2.consoleSessionOptionLabel({ kind: "live", scheduledAt: at, status: "live" }), "Sessão de 30/10 às 20:00 · no ar");
  assert.equal(v2.consoleSessionOptionLabel({ kind: "simulated", scheduledAt: at, status: "waiting" }), "Sessão de 30/10 às 20:00 · na espera");
  assert.equal(v2.consoleSessionOptionLabel({ kind: "live", scheduledAt: at, status: "scheduled" }), "Sessão de 30/10 às 20:00 · agendada");
  assert.equal(v2.consoleSessionOptionLabel({ kind: "live", scheduledAt: at, status: "ended" }), "Sessão de 30/10 às 20:00 · encerrada");
  assert.equal(v2.consoleSessionOptionLabel({ kind: "simulated", scheduledAt: at, status: "cancelled" }), "Sessão de 30/10 às 20:00 · cancelada");
  assert.equal(v2.consoleSessionOptionLabel({ kind: "replay", scheduledAt: at, status: "live" }), "Replay · 30/10 às 20:00");
  for (const status of ["scheduled", "waiting", "live", "ended", "cancelled"]) {
    assert.doesNotMatch(v2.consoleSessionOptionLabel({ kind: "live", scheduledAt: at, status }), /2026/, `${status}: sem o ano`);
  }
});

test("consoleTopActionsFor: a matriz dos botoes de situacao do topo pela especie, pela situacao, pelo papel e pela permissao", () => {
  const ids = (input) => v2.consoleTopActionsFor(input).map((action) => action.id);
  const host = { lock: true, session: true, sessionEnabled: true };
  const coHost = { lock: true, session: false, sessionEnabled: false };
  const equipe = { lock: false, session: true, sessionEnabled: true };
  const live = (status, controls = host, phase = status === "live" || status === "waiting" || status === "ended" || status === "cancelled" ? status : "scheduled") =>
    ({ canPublish: true, controls, kind: "live", phase, status });

  // Live: agendada, na espera, no ar, encerrada e cancelada.
  assert.deepEqual(ids(live("scheduled")), ["open_room", "start", "lock"], "agendada: o Trancar fica (a Sessão de prática)");
  assert.deepEqual(ids(live("waiting")), ["start", "lock", "end_live"]);
  assert.deepEqual(ids(live("live")), ["lock", "end_live"]);
  assert.deepEqual(ids(live("ended")), ["report"], "encerrada: so o relatorio, o servidor recusa o Trancar");
  assert.deepEqual(ids(live("cancelled")), [], "cancelada: nada");
  // O co-apresentador nao abre, nao comeca e nao encerra; a Equipe nao tranca.
  assert.deepEqual(ids(live("scheduled", coHost)), ["lock"]);
  assert.deepEqual(ids(live("waiting", coHost)), ["lock"]);
  assert.deepEqual(ids(live("live", coHost)), ["lock"]);
  assert.deepEqual(ids(live("scheduled", equipe)), ["open_room", "start"]);
  assert.deepEqual(ids(live("live", equipe)), ["end_live"]);
  // Sem messaging.publish: os botoes da sessao aparecem desligados (o motivo vai no title); o Trancar continua ligado.
  const semPublicar = v2.consoleTopActionsFor({ ...live("waiting", { lock: true, session: true, sessionEnabled: false }), canPublish: false });
  assert.deepEqual(semPublicar, [
    { enabled: false, id: "start" },
    { enabled: true, id: "lock" },
    { enabled: false, id: "end_live" }
  ]);
  assert.deepEqual(v2.consoleTopActionsFor(live("scheduled", { lock: true, session: true, sessionEnabled: false })), [
    { enabled: false, id: "open_room" },
    { enabled: false, id: "start" },
    { enabled: true, id: "lock" }
  ]);

  // Gravada: Abrir sessão e Encerrar sessão so com messaging.publish e pela situacao; o relatorio pela fase encerrada.
  const gravada = (status, phase, canPublish = true) => ({ canPublish, controls: host, kind: "simulated", phase, status });
  assert.deepEqual(ids(gravada("scheduled", "scheduled")), ["open_session"]);
  assert.deepEqual(ids(gravada("waiting", "waiting")), ["open_session", "end_session"]);
  assert.deepEqual(ids(gravada("live", "live")), ["end_session"]);
  assert.deepEqual(ids(gravada("live", "ended")), ["end_session", "report"], "o video acabou e o tick ainda nao fechou");
  assert.deepEqual(ids(gravada("ended", "ended")), ["report"]);
  for (const [status, phase] of [["scheduled", "scheduled"], ["waiting", "waiting"], ["live", "live"]]) {
    assert.deepEqual(ids(gravada(status, phase, false)), [], `sem messaging.publish (${status}): nem abre nem encerra`);
  }
  assert.ok(v2.consoleTopActionsFor(gravada("live", "live")).every((action) => action.enabled));
  // A gravada nunca tem os botoes da live.
  assert.ok(!ids(gravada("waiting", "waiting")).some((id) => ["open_room", "start", "lock", "end_live"].includes(id)));

  // Replay: nunca abre nem encerra, nem com messaging.publish; encerrado, o relatorio.
  const replay = (status, phase) => ({ canPublish: true, controls: host, kind: "replay", phase, status });
  assert.deepEqual(ids(replay("scheduled", "replay")), []);
  assert.deepEqual(ids(replay("live", "replay")), []);
  assert.deepEqual(ids(replay("ended", "ended")), ["report"]);

  // A ordem fixa do topo.
  assert.deepEqual(v2.CONSOLE_TOP_ACTIONS, ["open_room", "start", "lock", "end_live", "open_session", "end_session", "report"]);
});
