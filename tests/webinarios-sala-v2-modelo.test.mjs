import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// A sala do aluno V2 (docs/31 §1, V2-1 a V2-19; docs/18 §2.2), as regras puras, sem navegador. Cada fatia da fase 1
// acrescenta aqui as suas funcoes (liveBarShown, panelTabsFor, liveBarItems, firstFocusTarget, chatPillsShown,
// viewOnJoin, filmstripStep e stagePollFor), no lugar das conferencias de texto do codigo-fonte que elas substituem.
// F1 (V2-2): sem Minimizar, a nossa barra da sala ao vivo so depende de a sala estar no ar: a live encerrada, removido,
// banido ou fora do acesso a tiram; na espera, trancada, sem o ambiente ou aberta, ela fica.

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
