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
  const has = (classes, name) => classes.split(" ").includes(name);
  for (const parte of ["stage", "bar", "stageColumn"]) {
    assert.equal(typeof live[parte], "string", `com palco: ${parte}`);
  }
  assert.match(live.stage, /(?:^| )bg-black(?: |$)/, "o palco preto nos dois temas");
  assert.match(live.stage, /(?:^| )aspect-video(?: |$)/, "16:9 abaixo de lg");
  assert.match(live.stage, /(?:^| )lg:flex-1(?: |$)/, "a altura que sobra a partir de lg");
  assert.match(live.stage, /(?:^| )rounded-2xl(?: |$)/, "16 px de canto");
  // Com o card Configurações aberto e a fila da Sala de espera na coluna (ate G6 e G7), o palco nao some: guarda 240 px
  // e a coluna rola por dentro, entao a barra continua ao alcance (a raiz nao rola a partir de lg).
  assert.ok(has(live.stage, "lg:min-h-60"), "o piso de 240 px do palco a partir de lg");
  assert.ok(!has(live.stage, "lg:min-h-0"), "sem o piso zero, que deixava o palco encolher a nada");
  assert.ok(has(live.stageColumn, "lg:overflow-y-auto"), "a coluna do palco rola por dentro a partir de lg");
  assert.ok(has(live.stageColumn, "relative"), "a coluna e a referencia do que fica por cima do palco e dos rotulos dela");
  // Cada parte que rola e `relative`: sem isso os rotulos sr-only (absolute) tomam a pagina como referencia, esticam o
  // documento por baixo da raiz de altura fixa e a pagina inteira rola para fora da tela (na gravada, 1594 px a 1280 x 720).
  assert.ok(has(live.panel, "relative"), "o painel com palco e a referencia dos rotulos dele");
  assert.ok(has(live.panel, "lg:overflow-y-auto"), "o painel rola por dentro");
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
  assert.ok(has(gravada.panel, "relative"), "sem palco o painel tambem e a referencia dos rotulos dele");
  assert.ok(has(gravada.panel, "lg:overflow-y-auto"), "sem palco o painel rola por dentro");
  assert.ok(has(gravada.root, "lg:overflow-hidden"), "a raiz nao rola a partir de lg: cada parte rola por dentro");
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

test("consolePresenceBadge: os presentes com o pico, que nunca fica abaixo dos presentes; sem pico, so os presentes", () => {
  assert.equal(v2.consolePresenceBadge({ peak: 14, presentNow: 12 }), "12 presentes · pico 14");
  assert.equal(v2.consolePresenceBadge({ peak: 10, presentNow: 12 }), "12 presentes · pico 12", "o pico do cache de 60 s atrasado nao fica abaixo do retrato de 5 s");
  assert.equal(v2.consolePresenceBadge({ peak: null, presentNow: 12 }), "12 presentes", "o Replay e antes de comecar, sem pico");
  assert.equal(v2.consolePresenceBadge({ peak: null, presentNow: 1 }), "1 presente");
  assert.equal(v2.consolePresenceBadge({ peak: 3, presentNow: 1 }), "1 presente · pico 3");
  assert.equal(v2.consolePresenceBadge({ peak: null, presentNow: 0 }), "0 presentes");
  assert.equal(v2.consolePresenceBadge({ peak: null, presentNow: Number.NaN }), "0 presentes", "um retrato sem numero conta zero");
  assert.equal(v2.consolePresenceBadge({ peak: Number.NaN, presentNow: 4 }), "4 presentes", "um pico sem numero nao entra");
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

/* ------------------------------------------------------------------------------------------------
 * G5 (V2-4, V2-13 e V2-A5): o palco da live no console
 * ---------------------------------------------------------------------------------------------- */

const { EMPTY_ROOM } = await import("../src/server/webinars/live-console-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

// Os ids de endpoint do motor sao hex de 8 caracteres, sem hifen; a tela compartilhada e o participante virtual `<id>-v1`.
const EU = "e0e0e0e0";
const CO = "c0c0c0c0";
const ALUNA = "a1a1a1a1";
const sala = (extra = {}) => ({
  ...EMPTY_ROOM,
  people: [
    { id: CO, name: "Co T." },
    { id: ALUNA, name: "Ana M." }
  ],
  roles: { [ALUNA]: "participant", [CO]: "moderator" },
  selfId: EU,
  ...extra
});
const selo = (room, extra = {}) => v2.consoleStageBadgeFor({ joined: true, presenterName: "Produtor T.", role: "host", room, ...extra });

test("consoleStageBadgeFor: o proprio console no video grande e \"Você\" com o papel dele (tambem a propria tela); outro moderador, o nome do apresentador da pagina; sem papel, um aluno, a Grade ou fora da sala, nada", () => {
  assert.deepEqual(selo(sala({ onStageId: EU })), { name: "Você", role: "Apresentador" });
  assert.deepEqual(selo(sala({ onStageId: `${EU}-v1` })), { name: "Você", role: "Apresentador" }, "a tela do Apresentador vale pelo dono");
  assert.deepEqual(selo(sala({ onStageId: EU }), { role: "co_host" }), { name: "Você", role: "Co-apresentador" });
  assert.deepEqual(selo(sala({ onStageId: EU }), { role: "team" }), { name: "Você", role: WEBINAR_COPY.sala.selos.equipe });
  // Outro moderador (o papel pelo participantRoleChanged ou pelo getRoomsInfo): o nome do apresentador da pagina; sem
  // ele, o nome com que essa pessoa esta na sala.
  assert.deepEqual(selo(sala({ onStageId: CO }), { role: "co_host" }), { name: "Produtor T.", role: "Apresentador" });
  assert.deepEqual(selo(sala({ onStageId: `${CO}-v1` }), { presenterName: null }), { name: "Co T.", role: "Apresentador" });
  assert.equal(selo(sala({ onStageId: CO, people: [] }), { presenterName: "  " }), null, "sem nome nenhum, nada");
  // O dono sem papel lido (quem ja moderava quando o console entrou, antes do getRoomsInfo): nada, nunca por palpite.
  assert.equal(selo(sala({ onStageId: CO, roles: {} })), null);
  assert.equal(selo(sala({ onStageId: ALUNA })), null, "um aluno no video grande");
  assert.equal(selo(sala({ onStageId: EU, viewShown: "grid" })), null, "na Grade nao ha video grande");
  assert.equal(selo(sala({ onStageId: null })), null, "o motor ainda nao disse quem esta ali");
  assert.equal(selo(sala({ onStageId: EU }), { joined: false }), null, "fora da sala");
  // A frase do selo: o nome e o papel, com o ponto do meio.
  assert.equal(WEBINAR_COPY.consoleV2.palco.selo("Você", "Co-apresentador"), "Você · Co-apresentador");
});

test("consoleColumnPolicy: o Apresentador deixa a coluna de miniaturas com o motor (o seguir a visao levaria a escolha a todos); o co-apresentador e a Equipe seguem a largura, como o aluno", () => {
  assert.equal(v2.consoleColumnPolicy("host"), "engine");
  assert.equal(v2.consoleColumnPolicy("co_host"), "width");
  assert.equal(v2.consoleColumnPolicy("team"), "width");
});

test("consoleStageTopLeft: no ar com o inicio, \"Ao vivo · 00:42:10\" pelo relogio do servidor; agendada, \"Começa em\"; encerrada, \"Durou\"; sem frase, nada", () => {
  const now = Date.parse("2026-11-05T23:42:10.000Z");
  const base = { endedAt: null, kind: "live", recordingAnchorAt: null, scheduledAt: "2026-11-05T23:00:00.000Z", startedAt: "2026-11-05T23:00:00.000Z", status: "live" };
  assert.deepEqual(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now, session: base, skewMs: 0 }), { kind: "on_air", label: "Ao vivo · 00:42:10", short: "00:42:10" });
  // O aparelho 10 s atrasado: o skew do servidor corrige.
  assert.equal(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now - 10_000, session: base, skewMs: 10_000 })?.label, "Ao vivo · 00:42:10");
  const agendada = { ...base, scheduledAt: "2026-11-05T23:50:00.000Z", startedAt: null, status: "scheduled" };
  assert.deepEqual(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now, session: agendada, skewMs: 0 }), { kind: "label", label: "Começa em 7:50" });
  const encerrada = { ...base, endedAt: "2026-11-06T00:00:00.000Z", status: "ended" };
  assert.deepEqual(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now + 3_600_000, session: encerrada, skewMs: 0 }), { kind: "label", label: "Durou 1:00:00" });
  assert.equal(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now, session: { ...base, status: "cancelled" }, skewMs: 0 }), null, "cancelada");
  assert.equal(v2.consoleStageTopLeft({ durationMs: 3_600_000, nowMs: now, session: { ...agendada, scheduledAt: "2026-11-05T23:00:00.000Z", status: "waiting" }, skewMs: 0 }), null, "na espera depois da hora, sem o inicio");
});
