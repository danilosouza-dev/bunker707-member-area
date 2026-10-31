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
