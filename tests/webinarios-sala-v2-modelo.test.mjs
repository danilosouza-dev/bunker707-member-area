import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// A sala do aluno V2 (docs/31 §1, V2-1 a V2-19; docs/18 §2.2), as regras puras, sem navegador. Cada fatia da fase 1
// acrescenta aqui as suas funcoes (liveBarShown, panelTabsFor, liveBarItems, firstFocusTarget, chatPillsShown,
// viewOnJoin, filmstripStep e stagePollFor), no lugar das conferencias de texto do codigo-fonte que elas substituem.
// F1 (V2-2): sem Minimizar, a nossa barra da sala ao vivo so depende de a sala estar no ar: a live encerrada, removido,
// banido ou fora do acesso a tiram; na espera, trancada, sem o ambiente ou aberta, ela fica.
// F3 (V2-3, V2-4 e V2-18): a linha da data do cabecalho, a do celular e a margem que a coluna de miniaturas do iframe
// tira da direita do video (room-layout-model.ts), e o selo do momento no palco da live (no ar ou na espera).
// F5 (V2-7 e V2-8): as abas do painel nas tres salas, o contador de mensagens novas do balao (tambem com o zero da live
// mudando), o primeiro foco, quando as 2 ultimas mensagens ficam em pilulas sobre o palco e o card da Oferta no canto.

const model = await import("../src/components/member/webinars/room/live-room-model.ts");

const TELAS = ["banned", "ended", "kicked", "locked", "open", "unavailable", "unconfigured", "waiting"];

test("liveBarShown: a barra fica com a sala aberta e some com a live encerrada ou com a sala bloqueada (removido, banido, fora do acesso)", () => {
  // As telas como a sala calcula: blocked vem de screenBlocksRoom(screen).
  const mostra = (screen) => model.liveBarShown({ blocked: model.screenBlocksRoom(screen), screen });

  assert.equal(mostra("open"), true, "aberta, a barra fica");
  assert.equal(mostra("ended"), false, "encerrada, a barra sai (e com ela Configurações e Reagir)");
  for (const screen of ["banned", "kicked", "unavailable"]) {
    assert.equal(mostra(screen), false, `bloqueada (${screen}): a sala inteira da lugar a frase`);
  }
  for (const screen of ["waiting", "locked", "unconfigured"]) {
    assert.equal(mostra(screen), true, `${screen}: a sala continua de pe, com a barra`);
  }
  assert.deepEqual(
    TELAS.filter(mostra),
    ["locked", "open", "unconfigured", "waiting"],
    "so quatro das oito telas mostram a barra"
  );
});

test("liveBarShown: o bloqueio vence a tela (a recusa local chega antes da tela mudar) e a encerrada vence o desbloqueio", () => {
  assert.equal(model.liveBarShown({ blocked: true, screen: "open" }), false, "bloqueada, nada de barra mesmo com a tela aberta");
  assert.equal(model.liveBarShown({ blocked: false, screen: "ended" }), false, "encerrada sem bloqueio, tambem sem barra");
  assert.equal(model.liveBarShown({ blocked: false, screen: "open" }), true);
});

test("sem Minimizar (V2-2): a barra nao tem outro jeito de sumir, e a volta do foco continua valendo quando ela sai", () => {
  // Antes, a pilula do Minimizar tambem tirava a barra; agora so o fim da live ou o bloqueio tiram.
  for (const screen of TELAS) {
    const blocked = model.screenBlocksRoom(screen);
    assert.equal(model.liveBarShown({ blocked, screen }), !blocked && screen !== "ended", screen);
  }
  // A barra que acabou de sumir com o foco no body: a sala manda o foco de volta para dentro dela.
  const body = { nome: "body" };
  const antes = model.liveBarShown({ blocked: false, screen: "open" });
  const depois = model.liveBarShown({ blocked: false, screen: "ended" });
  assert.equal(model.barFocusLost({ active: body, barShown: depois, barWasShown: antes, body }), true);
});

// F2 (V2-7, V2-10, V2-12 e V2-16): o que a sala guarda no navegador de cada pessoa. Um valor que falta, vem estragado ou
// e de outra sessao vira o padrao: o escuro, o painel aberto, o Palco e nada deixado para depois.
const prefs = await import("../src/lib/webinar-room-prefs.ts");

test("as chaves do navegador: tema, painel, visao e enquetes, todas com o prefixo bunker707:", () => {
  assert.equal(prefs.ROOM_THEME_KEY, "bunker707:webinar-sala-tema");
  assert.equal(prefs.ROOM_PANEL_KEY, "bunker707:webinar-sala-painel");
  assert.equal(prefs.ROOM_VIEW_KEY, "bunker707:webinar-sala-visao");
  assert.equal(prefs.ROOM_POLLS_KEY, "bunker707:webinar-sala-enquetes");
  const chaves = [prefs.ROOM_THEME_KEY, prefs.ROOM_PANEL_KEY, prefs.ROOM_VIEW_KEY, prefs.ROOM_POLLS_KEY];
  assert.equal(new Set(chaves).size, 4, "uma chave para cada escolha");
});

test("storedRoomTheme: escuro por padrao; so 'light' vira o claro", () => {
  assert.equal(prefs.storedRoomTheme(null), "dark", "nada guardado (o servidor e a primeira pintura)");
  assert.equal(prefs.storedRoomTheme(undefined), "dark");
  assert.equal(prefs.storedRoomTheme("x"), "dark", "valor estragado");
  assert.equal(prefs.storedRoomTheme("LIGHT"), "dark", "sem adivinhar maiusculas");
  assert.equal(prefs.storedRoomTheme("dark"), "dark");
  assert.equal(prefs.storedRoomTheme("light"), "light");
});

test("storedPanelOpen: o painel abre por padrao e so fecha com '0'", () => {
  assert.equal(prefs.storedPanelOpen(null), true);
  assert.equal(prefs.storedPanelOpen("1"), true);
  assert.equal(prefs.storedPanelOpen("qualquer"), true);
  assert.equal(prefs.storedPanelOpen("0"), false);
});

test("storedRoomView: o Palco por padrao; so 'grid' vira a Grade", () => {
  assert.equal(prefs.storedRoomView(null), "stage");
  assert.equal(prefs.storedRoomView("stage_duo"), "stage", "o Palco duplo nao existe para o aluno nesta fase");
  assert.equal(prefs.storedRoomView("grid"), "grid");
});

test("storedDeferredPolls: so as enquetes da sessao aberta; outra sessao ou valor estragado volta vazio", () => {
  const sessao = "cccccccc-0000-4000-8000-000000000002";
  const guardado = prefs.deferredPollsValue(sessao, { later: ["p1"], seen: ["p0"] });
  assert.deepEqual(prefs.storedDeferredPolls(guardado, sessao), { later: ["p1"], seen: ["p0"] }, "ida e volta");
  assert.deepEqual(prefs.storedDeferredPolls(guardado, "outra-sessao"), { later: [], seen: [] }, "de outra sessao volta vazio");
  assert.deepEqual(prefs.storedDeferredPolls(null, sessao), { later: [], seen: [] });
  assert.deepEqual(prefs.storedDeferredPolls("{nao e json", sessao), { later: [], seen: [] });
  assert.deepEqual(prefs.storedDeferredPolls(JSON.stringify({ later: [1, "", "p2"], seen: "p3", sessionId: sessao }), sessao), { later: ["p2"], seen: [] }, "so ids de verdade");
});

// F2 (V2-12 e V2-18): o tema do dialogo. O HTML do servidor sempre sai escuro (nada guardado ainda), entao so a regra
// pura prova que o vertical 9:16, que fica todo sobre o video, ignora o claro guardado e que o normal o respeita.
const vertical = await import("../src/components/member/webinars/room/vertical/vertical-model.ts");

test("themeForDesign: o desenho normal usa o tema da pessoa; o vertical e sempre escuro, mesmo com o claro guardado", () => {
  assert.equal(vertical.themeForDesign("vertical", "light"), "dark", "o claro guardado nao chega ao vertical");
  assert.equal(vertical.themeForDesign("vertical", "dark"), "dark");
  assert.equal(vertical.themeForDesign("normal", "light"), "light", "no normal, o claro guardado vale");
  assert.equal(vertical.themeForDesign("normal", "dark"), "dark");
  // Girar o aparelho com o claro guardado: em pe escuro, deitado claro, em pe de novo escuro (a escolha nao se perde).
  const guardado = prefs.storedRoomTheme("light");
  assert.deepEqual(
    ["vertical", "normal", "vertical"].map((design) => vertical.themeForDesign(design, guardado)),
    ["dark", "light", "dark"]
  );
});

/* ------------------------------------------------------------------------------------------------
 * F3 (V2-3, V2-4 e V2-18): a linha da data do cabecalho, a linha do celular e a margem da coluna de miniaturas
 * ---------------------------------------------------------------------------------------------- */

const time = await import("../src/lib/webinar-time.ts");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");

test("formatWebinarDayLong: o dia da semana e o mes por extenso no horario de Sao Paulo", () => {
  assert.equal(time.formatWebinarDayLong("2026-11-05T23:00:00.000Z"), "Quinta, 5 de novembro");
  assert.equal(time.formatWebinarDayLong("2026-10-30T23:00:00.000Z"), "Sexta, 30 de outubro");
  // 23:30 de Sao Paulo ja e o dia seguinte em UTC: vale o dia de Sao Paulo.
  assert.equal(time.formatWebinarDayLong("2026-10-31T02:30:00.000Z"), "Sexta, 30 de outubro");
  assert.equal(time.formatWebinarDayLong("2026-03-01T15:00:00.000Z"), "Domingo, 1 de março");
  assert.equal(time.formatWebinarDayLong(null), "");
  assert.equal(time.formatWebinarDayLong("nao e data"), "");
});

test("roomDateLine (V2-3): a data, a hora, a duracao e quem apresenta; no Replay sem data e sem hora; o trecho sem valor sai", () => {
  const base = { durationMinutes: 60, kind: "live", presenterName: "Danilo Souza", scheduledAt: "2026-11-05T23:00:00.000Z" };
  const linha = (extra = {}) => layout.roomDateLine({ ...base, ...extra }).join(" · ");
  assert.deepEqual(layout.roomDateLine(base), ["Quinta, 5 de novembro", "20:00", "60 min", "com Danilo Souza"], "os trechos");
  assert.equal(linha(), "Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza");
  assert.equal(linha({ kind: "simulated" }), "Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza", "a gravada como a live");
  assert.equal(linha({ presenterName: null }), "Quinta, 5 de novembro · 20:00 · 60 min", "sem apresentador, sem o trecho");
  assert.equal(linha({ presenterName: "   " }), "Quinta, 5 de novembro · 20:00 · 60 min", "nome em branco tambem");
  assert.equal(linha({ kind: "replay" }), "60 min · com Danilo Souza", "no replay sem data nem hora");
  assert.equal(linha({ durationMinutes: 0 }), "Quinta, 5 de novembro · 20:00 · com Danilo Souza", "duracao zero omite o trecho");
  assert.equal(linha({ durationMinutes: -5 }), "Quinta, 5 de novembro · 20:00 · com Danilo Souza");
  assert.equal(linha({ durationMinutes: null }), "Quinta, 5 de novembro · 20:00 · com Danilo Souza");
  assert.equal(linha({ scheduledAt: null }), "60 min · com Danilo Souza", "sem a hora marcada, so o resto");
  assert.equal(linha({ durationMinutes: 0, kind: "replay", presenterName: null }), "", "nada a dizer: a linha fica vazia");
});

test("roomMobileLine (V2-18): 'com {apresentador} · {n} assistindo'; sem contador (replay, encerrada) ou sem apresentador, o trecho sai", () => {
  assert.equal(layout.roomMobileLine({ presenterName: "Danilo Souza", presentNow: 128 }).join(" · "), "com Danilo Souza · 128 assistindo");
  assert.equal(layout.roomMobileLine({ presenterName: "Danilo Souza", presentNow: 1 }).join(" · "), "com Danilo Souza · 1 assistindo");
  assert.deepEqual(layout.roomMobileLine({ presenterName: "Danilo Souza", presentNow: null }), ["com Danilo Souza"], "o replay e a encerrada nao tem contador");
  assert.deepEqual(layout.roomMobileLine({ presenterName: null, presentNow: 0 }), ["0 assistindo"], "sem apresentador, so o contador (zero tambem e numero)");
  assert.deepEqual(layout.roomMobileLine({ presenterName: null, presentNow: null }), []);
});

test("stageVideoRightPx: a coluna de miniaturas do iframe (213 px) mais o puxador (9 px; 21 px com toque); sem a coluna, 0", () => {
  assert.equal(layout.stageVideoRightPx({ columnShown: true, touch: false }), 222);
  assert.equal(layout.stageVideoRightPx({ columnShown: true, touch: true }), 234);
  assert.equal(layout.stageVideoRightPx({ columnShown: true }), 222, "sem saber do toque, o puxador do mouse");
  assert.equal(layout.stageVideoRightPx({ columnShown: false, touch: true }), 0);
  assert.equal(layout.stageVideoRightPx({ columnShown: false }), 0);
});

test("liveStageMoment (V2-4): no ar, o Ao vivo; na espera com a sala aberta, Aguardando o apresentador; a capa da espera e a encerrada ja dizem a frase", () => {
  // O momento que a sala calcula: a fase pelo status (livePhaseOf) e a tela pela regra da sala (liveRoomScreen).
  const momento = (phase, screen) => layout.liveStageMoment({ phase, screen });
  for (const screen of TELAS) {
    assert.equal(momento("live", screen), "on_air", `no ar (${screen}): o Ao vivo com o tempo`);
    assert.equal(momento("ended", screen), null, `encerrada (${screen}): a capa diz que acabou`);
  }
  // Antes do Comecar para todos: o aluno dentro do iframe (a tela aberta, sem capa nenhuma) ve que a live nao comecou.
  assert.equal(momento("waiting", "open"), "waiting");
  assert.equal(momento("waiting", "locked"), "waiting", "a sala trancada antes de comecar tambem");
  assert.equal(momento("waiting", "unconfigured"), "waiting");
  // A capa da espera (a Sessao de pratica, a sessao que ainda nao abriu) ja diz "Aguardando o apresentador": nada repete.
  assert.equal(momento("waiting", "waiting"), null);
  assert.equal(momento(model.livePhaseOf("waiting"), "open"), "waiting", "status waiting, fora da pratica");
  assert.equal(momento(model.livePhaseOf("scheduled"), "waiting"), null, "agendada: a capa com a contagem");
});

/* ------------------------------------------------------------------------------------------------
 * F4 (V2-6 a V2-8 e V2-18): os botoes da barra nas tres zonas, quando o painel do chat aparece e o esqueleto das salas
 * ---------------------------------------------------------------------------------------------- */

test("liveBarItems (V2-6): o Sair a esquerda; Reagir, a mao, a camera, o microfone, o Som e a Tela cheia no centro (o Som antes da Tela cheia); Configurações e o balao a direita", () => {
  const aluno = model.liveBarItems({ allowStudentCamera: false, micAllowed: false, showMedia: true });
  assert.deepEqual(aluno, { center: ["react", "hand", "sound", "fullscreen"], left: ["leave"], right: ["settings", "panel"] }, "o aluno sem a camera dos alunos");
  assert.deepEqual(model.liveBarItems({ allowStudentCamera: true, micAllowed: true, showMedia: true }).center, ["react", "hand", "camera", "mic", "sound", "fullscreen"], "com a camera permitida e o microfone liberado");
  assert.deepEqual(model.liveBarItems({ allowStudentCamera: true, micAllowed: false, showMedia: true }).center, ["react", "hand", "camera", "sound", "fullscreen"], "o microfone so depois de liberado");
  assert.deepEqual(model.liveBarItems({ allowStudentCamera: null, micAllowed: false, showMedia: true }).center, ["react", "hand", "sound", "fullscreen"], "antes do token, sem a camera");
  // Host e co-apresentador que entram por esta pagina usam a barra do iframe: sem mao, camera e microfone nossos.
  const quemApresenta = model.liveBarItems({ allowStudentCamera: true, micAllowed: true, showMedia: false });
  assert.deepEqual(quemApresenta.center, ["react", "sound", "fullscreen"]);
  assert.deepEqual([quemApresenta.left, quemApresenta.right], [["leave"], ["settings", "panel"]], "o Sair, Configurações e o balao ficam para todos");
});

test("recordedBarItems (V2-6, a mesma casca): a gravada com o Som; o Replay sem ele (a barra da Bunny); a Tela cheia so com o navegador que deixa; sem Configurações", () => {
  assert.deepEqual(layout.recordedBarItems({ fullscreenEnabled: true, kind: "simulated" }), { center: ["react", "sound", "fullscreen"], left: ["leave"], right: ["panel"] });
  assert.deepEqual(layout.recordedBarItems({ fullscreenEnabled: false, kind: "simulated" }).center, ["react", "sound"], "no iPhone, sem a Tela cheia");
  assert.deepEqual(layout.recordedBarItems({ fullscreenEnabled: true, kind: "replay" }).center, ["react", "fullscreen"], "o Replay sem o Som");
  assert.deepEqual(layout.recordedBarItems({ fullscreenEnabled: false, kind: "replay" }), { center: ["react"], left: ["leave"], right: ["panel"] }, "o Replay sem o Som e sem a Tela cheia");
  for (const kind of ["simulated", "replay"]) {
    for (const fullscreenEnabled of [true, false]) {
      const itens = layout.recordedBarItems({ fullscreenEnabled, kind });
      assert.ok(![...itens.left, ...itens.center, ...itens.right].includes("settings"), "a gravada nao tem aparelhos para configurar");
    }
  }
});

test("roomPanelShown (V2-7 e V2-8): o balao abre e fecha; no celular Configurações toma o lugar do chat; sem a barra o painel fica (o balao saiu junto)", () => {
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: true, settingsTakeover: false }), true, "aberto (o padrao)");
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: false, settingsTakeover: false }), false, "fechado pelo balao, tambem no computador");
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: true, settingsTakeover: true }), false, "Configurações aberto no celular esconde o chat");
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: false, settingsTakeover: true }), false);
  // A live encerrada tira a barra: o painel volta para a tela mesmo fechado (o chat continua para ler).
  assert.equal(layout.roomPanelShown({ barShown: false, panelOpen: false, settingsTakeover: false }), true);
  // O guardado chega pela regra pura de webinar-room-prefs: nada guardado e o painel aberto.
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: prefs.storedPanelOpen(null), settingsTakeover: false }), true);
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: prefs.storedPanelOpen("0"), settingsTakeover: false }), false);
});

test("roomSkeleton (V2-6): o mesmo desenho normal nas duas salas; o painel fechado faz o palco crescer e o painel some; o vertical nao muda", () => {
  const aberto = vertical.roomSkeleton("normal", { cinema: false, panelShown: true, stageGrows: false });
  const fechado = vertical.roomSkeleton("normal", { cinema: false, panelShown: false, stageGrows: true });
  assert.deepEqual(aberto, vertical.roomSkeleton("normal"), "sem estado, o painel aberto e o palco 16:9");
  // O palco que cresce: a coluna e a caixa ocupam o lugar e o palco deixa o 16:9 (o mesmo palco, so classes).
  assert.match(fechado.stageColumn, /\bflex-1\b/);
  assert.doesNotMatch(aberto.stageColumn, /(?:^| )flex-1\b/);
  assert.match(fechado.stageBox, /\[&>\[data-room-stage\]\]:aspect-auto/);
  assert.doesNotMatch(aberto.stageBox, /\[&>\[data-room-stage\]\]:aspect-auto/);
  // O painel aberto ocupa a coluna no celular; fechado (ou no Modo cinema) nao ocupa.
  assert.match(aberto.panel, /(?:^| )flex-1(?: |$)/);
  assert.match(fechado.panel, /(?:^| )flex-none(?: |$)/);
  assert.match(vertical.roomSkeleton("normal", { cinema: true, panelShown: true, stageGrows: true }).panel, /(?:^| )flex-none(?: |$)/, "no Modo cinema o chat fica embaixo, menor");
  // No computador: o corpo com recuo, o palco com cantos de 16 px (os do iframe) e a barra a 12 px dele.
  assert.match(aberto.body, /lg:px-4/);
  assert.match(aberto.stageBox, /lg:rounded-\[16px\]/);
  assert.match(aberto.stageColumn, /lg:gap-3/);
  // O vertical 9:16 continua como estava: o estado nao muda nada nele.
  assert.deepEqual(vertical.roomSkeleton("vertical", { cinema: true, panelShown: false, stageGrows: true }), vertical.roomSkeleton("vertical"));
  assert.deepEqual(vertical.roomSkeleton("vertical", { cinema: false, panelShown: false, stageGrows: true, stageMin: true }), vertical.roomSkeleton("vertical"));
});

/** As classes de uma peca do esqueleto, separadas. */
const classesDe = (texto) => texto.split(" ");

test("panelToggleStep (V2-7 e V2-8): o balao abre e fecha o painel; no celular com Configurações aberto, fecha Configurações e mostra o chat", () => {
  assert.deepEqual(layout.panelToggleStep({ panelShown: true, settingsTakeover: false }), { closeSettings: false, panelOpen: false }, "aberto: o balao fecha (tambem no computador)");
  assert.deepEqual(layout.panelToggleStep({ panelShown: false, settingsTakeover: false }), { closeSettings: false, panelOpen: true }, "fechado: o balao abre");
  // Configurações no celular esconde o chat (roomPanelShown da false): o balao nunca deixa os dois fechados.
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: true, settingsTakeover: true }), false);
  assert.deepEqual(layout.panelToggleStep({ panelShown: false, settingsTakeover: true }), { closeSettings: true, panelOpen: true }, "fecha Configurações e mostra o chat");
  // Depois do passo, o chat fica na tela: Configurações fechou (sem takeover) e o painel abriu.
  const passo = layout.panelToggleStep({ panelShown: false, settingsTakeover: true });
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: passo.panelOpen, settingsTakeover: !passo.closeSettings }), true);
});

test("liveSkeletonState (V2-6): o palco da live cresce com o chat fora da tela, no Modo cinema e removido; com Configurações no celular a caixa do palco guarda 96 px (o celular deitado tem uns 320 px de coluna)", () => {
  const estado = (extra = {}) => layout.liveSkeletonState({ blocked: false, cinema: false, panelShown: true, settingsTakeover: false, ...extra });
  assert.deepEqual(estado(), { cinema: false, panelShown: true, stageGrows: false, stageMin: false }, "o painel aberto: o palco 16:9");
  assert.equal(estado({ panelShown: false }).stageGrows, true, "o balao fechou o painel");
  assert.equal(estado({ cinema: true }).stageGrows, true, "Modo cinema");
  assert.equal(estado({ blocked: true }).stageGrows, true, "a frase de removido ou banido");
  assert.equal(estado({ panelShown: false }).stageMin, false, "o painel fechado pelo balao: o palco ocupa a coluna inteira, sem minimo");

  // Configurações no celular: o chat sai da tela (roomPanelShown) e o palco divide a coluna com o painel, que fica no
  // fluxo. O minimo vai na CAIXA do palco (a peca que divide a coluna com a barra), nao so no palco dentro dela: com o
  // minimo so no filho, a caixa encolhia para uns 23 px a 667 x 375 e o palco vazava por baixo do painel.
  const panelShown = layout.roomPanelShown({ barShown: true, panelOpen: true, settingsTakeover: true });
  const takeover = estado({ panelShown, settingsTakeover: true });
  assert.deepEqual(takeover, { cinema: false, panelShown: false, stageGrows: true, stageMin: true });
  const caixa = classesDe(vertical.roomSkeleton("normal", takeover).stageBox);
  assert.ok(caixa.includes("min-h-24"), "a caixa do palco com no minimo 96 px");
  assert.ok(!caixa.includes("min-h-0"), "sem o min-h-0 que deixava a caixa encolher");
  assert.ok(caixa.includes("flex-1") && caixa.includes("lg:min-h-0"), "cresce na coluna; a partir de lg nao ha takeover");
  assert.ok(classesDe(vertical.roomSkeleton("normal", takeover).stageColumn).includes("flex-1"), "a coluna ocupa o corpo (o chat esta escondido)");

  // Sem o takeover, a caixa que cresce pode encolher (min-h-0): o painel do chat fechado ou o Modo cinema.
  for (const extra of [{ panelShown: false }, { cinema: true }, { blocked: true }]) {
    const semMinimo = classesDe(vertical.roomSkeleton("normal", estado(extra)).stageBox);
    assert.ok(semMinimo.includes("min-h-0") && !semMinimo.includes("min-h-24"), JSON.stringify(extra));
  }
  // O palco 16:9 (sem crescer) nao leva minimo nenhum alem do lg.
  assert.ok(!classesDe(vertical.roomSkeleton("normal", estado()).stageBox).some((classe) => classe === "min-h-0" || classe === "min-h-24"));
});

const salaAoVivo = await import("../src/components/member/webinars/room/webinar-room.tsx");

test("returnFocusFromPanel: o painel fechou com o foco nele (ou no body): o foco vai ao balao na tela; um foco em outro lugar da sala fica", () => {
  const focados = [];
  const no = (nome, extra = {}) => ({ focus: () => focados.push(nome), nome, offsetParent: {}, ...extra });
  const aba = no("aba Chat");
  const balao = no("balao");
  const tema = no("Tema claro");
  const body = { nome: "body" };
  const painel = { contains: (node) => node === aba };
  const raiz = ({ toggles = [balao], controles = [tema] } = {}) => ({
    contains: (node) => [aba, balao, tema].includes(node),
    querySelectorAll: (selector) => (selector === '[aria-controls="room-panel"]' ? toggles : selector === salaAoVivo.ROOM_FOCUSABLE ? controles : [])
  });

  assert.equal(salaAoVivo.returnFocusFromPanel(raiz(), aba, painel), true, "o foco estava na aba do painel");
  assert.deepEqual(focados, ["balao"]);
  assert.equal(salaAoVivo.returnFocusFromPanel(raiz(), body, painel), true, "o foco ja tinha caido no body");
  assert.equal(salaAoVivo.returnFocusFromPanel(raiz(), null, painel), true);
  assert.deepEqual(focados, ["balao", "balao", "balao"]);
  assert.equal(salaAoVivo.returnFocusFromPanel(raiz(), tema, painel), false, "o foco no cabecalho fica onde esta");
  // Sem o balao na tela (escondido pela largura), o primeiro controle da sala na tela.
  assert.equal(salaAoVivo.returnFocusFromPanel(raiz({ toggles: [{ ...balao, offsetParent: null }] }), aba, painel), true);
  assert.equal(focados.at(-1), "Tema claro");
  assert.equal(salaAoVivo.returnFocusFromPanel(raiz({ controles: [], toggles: [] }), aba, painel), false, "nada na tela, nada a focar");
  assert.equal(salaAoVivo.returnFocusFromPanel(null, aba, painel), false);
});

/* ------------------------------------------------------------------------------------------------
 * F5 (V2-7 e V2-8): as abas do painel nas tres salas, o contador do balao, o primeiro foco e as pilulas do chat
 * ---------------------------------------------------------------------------------------------- */

/** Uma enquete do aluno, como a sessao traz (aberta, ou encerrada com o resultado compartilhado). */
const enquete = (status, extra = {}) => ({ anonymous: false, id: `p-${status}`, kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status, ...extra });
const abertas = (polls) => polls.filter((poll) => poll.status === "open").length;

test("panelTabsFor (V2-7): Chat, Perguntas e Participantes na live e na gravada; o Replay sem Participantes; Enquetes so com enquete aberta ou com a aba ja escolhida", () => {
  assert.deepEqual(layout.panelTabsFor({ kind: "live", openPolls: 0, tab: "chat" }), ["chat", "perguntas", "participantes"]);
  assert.deepEqual(layout.panelTabsFor({ kind: "simulated", openPolls: 0, tab: "chat" }), ["chat", "perguntas", "participantes"], "a gravada tambem tem Participantes");
  assert.deepEqual(layout.panelTabsFor({ kind: "replay", openPolls: 0, tab: "chat" }), ["chat", "perguntas"], "no Replay ninguem esta presente");
  // A gravada com so uma enquete encerrada com resultado: sem a aba (o resultado vai para o palco, V2-10).
  const encerrada = [enquete("closed", { myOptionIds: ["o1"], results: { counts: { o1: 4 }, total: 4 } })];
  assert.deepEqual(layout.panelTabsFor({ kind: "simulated", openPolls: abertas(encerrada), tab: "chat" }), ["chat", "perguntas", "participantes"]);
  // Com enquete aberta, a aba entra por ultimo, nas tres salas.
  for (const kind of ["live", "simulated", "replay"]) {
    assert.equal(layout.panelTabsFor({ kind, openPolls: abertas([enquete("open")]), tab: "chat" }).at(-1), "enquetes", kind);
  }
  // A enquete fechou com o aluno na aba: ela continua (a aba nao some de baixo dele).
  assert.deepEqual(layout.panelTabsFor({ kind: "live", openPolls: 0, tab: "enquetes" }), ["chat", "perguntas", "participantes", "enquetes"]);
  assert.deepEqual(layout.panelTabsFor({ kind: "replay", openPolls: 0, tab: "enquetes" }), ["chat", "perguntas", "enquetes"]);
});

test("panelStageNames: na gravada, 'No palco' e so quem apresenta (sem nome, ninguem); nunca a lista de alunos", () => {
  assert.deepEqual(layout.panelStageNames("Danilo Souza"), ["Danilo Souza"]);
  assert.deepEqual(layout.panelStageNames("  Danilo Souza "), ["Danilo Souza"]);
  assert.deepEqual(layout.panelStageNames(null), []);
  assert.deepEqual(layout.panelStageNames("   "), []);
});

const client = await import("../src/lib/webinar-room-client.ts");

/** Uma mensagem do chat (a do proprio aluno com mine). */
const mensagem = (id, offsetMs, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

test("unreadCount (V2-7): conta as mensagens que chegaram depois de o painel fechar; ignora as do proprio aluno, as ja vistas e as mais antigas que o fechar", () => {
  const vistas = new Set(["a", "b"]);
  const chat = [mensagem("a", 1_000), mensagem("b", 2_000), mensagem("c", 9_000), mensagem("d", 9_500, { mine: true }), mensagem("e", 10_000)];
  assert.equal(layout.unreadCount(vistas, chat), 2, "c e e; a minha (d) nao conta");
  assert.equal(layout.unreadCount(new Set(), [mensagem("x", 1, { mine: true })]), 0, "so as minhas: nada novo");
  assert.equal(layout.unreadCount(new Set(chat.map((item) => item.id)), chat), 0, "tudo ja visto");
  // Com o offset do fechar (a gravada e o Replay, onde o zero nao muda): so conta o que e mais novo que ele.
  assert.equal(layout.unreadCount(new Set(), chat, 8_000), 2, "o historico (a e b) nao e novo; c e e sim");
  assert.equal(layout.unreadCount(new Set(), chat, 10_000), 0, "a mensagem do mesmo instante do fechar ja estava na tela");
  // Reusa a contagem das mensagens novas da sala (o leitor de tela ja anunciava "N mensagens novas").
  assert.equal(layout.unreadCount(vistas, chat), client.newMessageCount(vistas, chat.filter((item) => !item.mine)));
});

const salaModelo = await import("../src/server/webinars/room-model.ts");

/** O offset da live como o servidor da (o zero e a ancora, ou o inicio, ou a hora marcada) e a sala calcula. */
const HORA_MARCADA = Date.parse("2026-11-05T23:00:00.000Z");
const minutos = (n) => n * 60_000;
const offsetDaLive = (nowMs, { anchorMin = null, startedMin = null } = {}) =>
  salaModelo.sessionOffsetMs(
    {
      kind: "live",
      recordingAnchorAt: anchorMin === null ? null : new Date(HORA_MARCADA + minutos(anchorMin)).toISOString(),
      scheduledAt: new Date(HORA_MARCADA).toISOString(),
      startedAt: startedMin === null ? null : new Date(HORA_MARCADA + minutos(startedMin)).toISOString()
    },
    nowMs
  );

test("o contador do balao na Live ao vivo (V2-7): a live que comeca atrasada e a ancora da gravacao mudam o zero do offset, e a mensagem nova depois do fechar conta assim mesmo", () => {
  const antiga = mensagem("antiga", -minutos(2));

  // Caso 1: o painel fecha na espera, 8 min depois da hora marcada; a live comeca aos +10 min e a mensagem chega 30 s depois.
  const fechouNaEspera = offsetDaLive(HORA_MARCADA + minutos(8));
  assert.equal(fechouNaEspera, 480_000);
  const marca1 = layout.panelUnreadMark({ chatLoaded: true, kind: "live", messages: [antiga], offsetMs: fechouNaEspera });
  const nova1 = mensagem("nova-1", offsetDaLive(HORA_MARCADA + minutos(10.5), { startedMin: 10 }));
  assert.equal(nova1.offsetMs, 30_000, "o zero andou para o inicio: o offset da nova e menor que o do fechar");
  assert.equal(layout.panelUnreadCount(marca1, [antiga, nova1]), 1, "a nova conta");
  assert.equal(layout.unreadCount(marca1.seenIds, [antiga, nova1], fechouNaEspera), 0, "pelo offset do fechar, ela sumiria do contador");

  // Caso 2: o painel fecha aos 10 min de live, a ancora entra aos 12 min e a mensagem chega 1 min depois.
  const fechouNoAr = offsetDaLive(HORA_MARCADA + minutos(10), { startedMin: 0 });
  assert.equal(fechouNoAr, 600_000);
  const marca2 = layout.panelUnreadMark({ chatLoaded: true, kind: "live", messages: [antiga], offsetMs: fechouNoAr });
  const nova2 = mensagem("nova-2", offsetDaLive(HORA_MARCADA + minutos(13), { anchorMin: 12, startedMin: 0 }));
  assert.equal(nova2.offsetMs, 60_000);
  assert.equal(layout.panelUnreadCount(marca2, [antiga, nova2]), 1, "a nova conta");
  // O servidor recalcula pela ancora o offset do que ja havia: a mesma mensagem com outro offset continua vista.
  assert.equal(layout.panelUnreadCount(marca2, [{ ...antiga, offsetMs: -minutos(14) }, nova2]), 1);
  assert.equal(layout.panelUnreadCount(marca2, [antiga, nova2, mensagem("minha", 61_000, { mine: true })]), 1, "a do aluno nunca");
  assert.deepEqual(marca2.afterOffsetMs, null, "na live a marca nao guarda o offset");
});

test("o contador do balao na gravada e no Replay (V2-7): o zero nao muda, entao a marca guarda tambem o offset do fechar", () => {
  const chat = [mensagem("a", 1_000), mensagem("b", 2_000), mensagem("c", 9_000)];
  for (const kind of ["simulated", "replay"]) {
    const marca = layout.panelUnreadMark({ chatLoaded: true, kind, messages: chat.slice(0, 2), offsetMs: 8_000 });
    assert.equal(marca.afterOffsetMs, 8_000, kind);
    assert.equal(layout.panelUnreadCount(marca, chat), 1, `${kind}: c chegou depois do fechar`);
    // No Replay o aluno volta o video: o que fica antes do fechar ja era do chat.
    assert.equal(layout.panelUnreadCount(marca, [mensagem("antes", 3_000), ...chat]), 1, kind);
  }
});

test("o painel que fecha antes da primeira leitura do chat (ja monta fechado): essa leitura vira o visto, e so o que chega depois conta", () => {
  for (const kind of ["live", "simulated", "replay"]) {
    const marca = layout.panelUnreadMark({ chatLoaded: false, kind, messages: [], offsetMs: 0 });
    assert.equal(marca.seenIds, null, kind);
    assert.equal(layout.panelUnreadCount(marca, [mensagem("x", 5)]), 0, `${kind}: antes da leitura, nada`);
    assert.equal(layout.panelUnreadSeen(marca, { chatLoaded: false, messages: [] }), marca, "sem a leitura, a mesma marca");
    // A primeira leitura traz o historico (na live, offsets menores que zero na espera ou o que veio antes da ancora).
    const historico = [mensagem("h1", -minutos(3)), mensagem("h2", -minutos(1))];
    const vista = layout.panelUnreadSeen(marca, { chatLoaded: true, messages: historico });
    assert.deepEqual([...vista.seenIds].sort(), ["h1", "h2"], kind);
    assert.equal(layout.panelUnreadCount(vista, historico), 0, `${kind}: o historico nao e novo`);
    assert.equal(layout.panelUnreadCount(vista, [...historico, mensagem("nova", 10)]), 1, `${kind}: a nova conta`);
    assert.equal(layout.panelUnreadSeen(vista, { chatLoaded: true, messages: [...historico, mensagem("nova", 10)] }), vista, "depois da leitura, a marca nao muda");
  }
});

test("firstFocusTarget: o primeiro foco da sala na aba Chat com o painel na tela; fechado, no balao da barra", () => {
  assert.equal(layout.firstFocusTarget({ panelShown: true }), "tab");
  assert.equal(layout.firstFocusTarget({ panelShown: false }), "panel-toggle");
  // Sem a barra o painel fica sempre na tela (roomPanelShown): o foco vai para a aba, nunca para um balao que nao existe.
  assert.equal(layout.firstFocusTarget({ panelShown: layout.roomPanelShown({ barShown: false, panelOpen: false, settingsTakeover: false }) }), "tab");
});

test("chatPillsShown (V2-8): as pilulas so no desenho normal, com o painel fechado e o palco de pe; o card da Oferta e Configurações no celular tiram as pilulas", () => {
  const base = { blocked: false, design: "normal", offerShown: false, panelShown: false, settingsTakeover: false };
  const linhas = [
    [{}, true, "o painel fechado pelo balao (tambem no computador)"],
    [{ panelShown: true }, false, "o painel na tela: o chat ja esta la"],
    [{ blocked: true }, false, "removido ou banido: a frase toma a sala"],
    [{ settingsTakeover: true }, false, "Configurações no celular: o palco fica com 96 px"],
    [{ offerShown: true }, false, "o card da Oferta tem o canto"],
    [{ design: "vertical" }, false, "o vertical tem o chat dele por cima do video"],
    [{ design: "vertical", panelShown: true }, false, "o vertical nunca"]
  ];
  for (const [extra, esperado, motivo] of linhas) {
    assert.equal(layout.chatPillsShown({ ...base, ...extra }), esperado, motivo);
  }
});

test("o card da Oferta no palco (V2-4 e V2-8): na tela, tira as pilulas do chat e o selo do Assistente; fechado pelo aluno, os dois voltam; a janela seguinte mostra de novo", () => {
  const card = { closedKey: null, enabled: true, hasView: true, shown: true, windowKey: "oferta-1@120000" };
  const canto = (offer) => {
    const offerShown = layout.offerOnScreen(offer);
    return {
      assistente: layout.stageAssistantShown({ assistantEnabled: true, bottomBadges: true, offerShown }),
      pilulas: layout.chatPillsShown({ blocked: false, design: "normal", offerShown, panelShown: false, settingsTakeover: false })
    };
  };
  assert.deepEqual(canto({ ...card, shown: false }), { assistente: true, pilulas: true }, "antes da janela, o canto e das pilulas e do selo");
  assert.equal(layout.offerOnScreen(card), true);
  assert.deepEqual(canto(card), { assistente: false, pilulas: false }, "o card no palco tem o canto");
  const fechado = { ...card, closedKey: card.windowKey };
  assert.equal(layout.offerOnScreen(fechado), false);
  assert.deepEqual(canto(fechado), { assistente: true, pilulas: true }, "o aluno fechou o card: os dois voltam");
  assert.equal(layout.offerOnScreen({ ...fechado, windowKey: "oferta-1@600000" }), true, "a janela seguinte mostra de novo");
  assert.equal(layout.offerOnScreen({ ...card, enabled: false }), false, "fora da sessao no ar (ou no ver como sem a oferta), nada");
  assert.equal(layout.offerOnScreen({ ...card, hasView: false, windowKey: null }), false, "sem o desenho da oferta, nada");
  // O selo do Assistente so com os selos de baixo (o video no ar, sem a barra da Bunny do Replay) e o Assistente ligado.
  assert.equal(layout.stageAssistantShown({ assistantEnabled: true, bottomBadges: false, offerShown: false }), false);
  assert.equal(layout.stageAssistantShown({ assistantEnabled: false, bottomBadges: true, offerShown: false }), false);
});

test("overlayMessages (V2-8): sem contagem, as 2 ultimas mensagens (a mais nova por ultimo), tambem no computador", () => {
  assert.equal(model.LIVE_ROOM_RULES.overlayMessages, 2);
  assert.deepEqual(model.overlayMessages(["a", "b", "c", "d"]), ["c", "d"]);
  assert.deepEqual(model.overlayMessages(["a"]), ["a"]);
  assert.deepEqual(model.overlayMessages([]), []);
  assert.deepEqual(model.overlayMessages(["a", "b", "c"], 0), [], "contagem zero, nada");
});
