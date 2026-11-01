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
