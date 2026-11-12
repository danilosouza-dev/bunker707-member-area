import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// O campo que cresce com o texto (docs/30 D81; o defeito do teste do produtor de 11/11/2026): a medida de
// src/components/use-auto-grow-textarea.ts com um textarea de mentira e um ResizeObserver de mentira, sem navegador.
// Escondido (o painel do chat guardado fechado: display:none, scrollHeight 0), a medida nunca grava 0px (antes ficava a
// faixa de 4 px sem a frase); visivel, a altura do texto ate o teto; quando o campo aparece ou muda de largura, mede
// de novo; a altura que a propria medida grava nao chama outra medida. O caminho inteiro no navegador (entrar pelo
// link com o painel guardado fechado e abrir o painel) esta em tests/e2e/campo-de-escrever-no-painel-fechado.spec.ts.

const { fitTextareaHeight, observeAutoGrow } = await import("../src/components/use-auto-grow-textarea.ts");

/** Um textarea de mentira: o scrollHeight e o que o teste diz; guarda a altura que estava gravada a cada leitura. */
function campo(scrollHeight, height = "") {
  const lidas = [];
  const area = {
    _scroll: scrollHeight,
    get scrollHeight() {
      lidas.push(this.style.height);
      return this._scroll;
    },
    style: { height }
  };
  return { area, lidas };
}

/** O ResizeObserver de mentira: guarda o callback, o alvo e se desligou; `notificar` entrega uma leitura. */
function observadorFalso() {
  const estado = { alvo: null, callback: null, desligado: false };
  class Falso {
    constructor(callback) {
      estado.callback = callback;
    }
    observe(alvo) {
      estado.alvo = alvo;
    }
    disconnect() {
      estado.desligado = true;
    }
  }
  const notificar = (largura, borda = largura) => estado.callback([{ borderBoxSize: [{ inlineSize: borda }], contentRect: { width: largura } }]);
  return { Falso, estado, notificar };
}

test("D81: escondido (scrollHeight 0) a medida nunca grava 0px: o campo fica com a linha natural (auto), mesmo vindo de 0px", () => {
  for (const antes of ["", "0px", "44px"]) {
    const { area } = campo(0, antes);
    fitTextareaHeight(area, 100);
    assert.equal(area.style.height, "auto", `de "${antes}"`);
  }
});

test("D81: visivel, a altura do texto ate o teto, sempre lida com a altura em auto (o scrollHeight do texto, nao o da caixa de antes)", () => {
  for (const [scroll, teto, esperado] of [
    [22, 100, "22px"],
    [44, 100, "44px"],
    [100, 100, "100px"],
    [300, 100, "100px"],
    [300, 240, "240px"]
  ]) {
    const { area, lidas } = campo(scroll, "4px");
    fitTextareaHeight(area, teto);
    assert.equal(area.style.height, esperado, `${scroll} com o teto ${teto}`);
    assert.deepEqual(lidas, ["auto"], "le o scrollHeight uma vez, com a altura em auto");
  }
});

test("D81: o campo montado escondido mede de novo quando aparece (a largura sai de 0) e quando muda de largura; a altura gravada pela medida nao chama outra medida", () => {
  const { area } = campo(0, "");
  const { Falso, estado, notificar } = observadorFalso();
  const desligar = observeAutoGrow(area, 100, Falso);
  assert.equal(estado.alvo, area, "observa o proprio campo");

  // A primeira leitura com o painel escondido: 0 x 0.
  notificar(0);
  assert.equal(area.style.height, "auto", "escondido, nunca 0px");

  // O painel abre: o campo ganha a largura e o texto (vazio) ocupa uma linha.
  area._scroll = 22;
  notificar(266);
  assert.equal(area.style.height, "22px", "aberto, a linha inteira com a frase");

  // A medida grava a altura e o observador avisa de novo com a mesma largura: nada muda (sem laco).
  area._scroll = 60;
  notificar(266);
  assert.equal(area.style.height, "22px", "a mesma largura nao mede de novo");
  // A barra de rolagem que aparece dentro do campo estreita o conteudo, nao a borda: tambem nao mede.
  notificar(250, 266);
  assert.equal(area.style.height, "22px", "a largura da borda manda, nao a do conteudo");

  // O painel estreita: o texto quebra em mais linhas e o campo acompanha, ate o teto.
  area._scroll = 44;
  notificar(200);
  assert.equal(area.style.height, "44px");
  area._scroll = 180;
  notificar(160);
  assert.equal(area.style.height, "100px", "o teto");

  // O painel fecha de novo e abre: mede nas duas viradas.
  area._scroll = 0;
  notificar(0);
  assert.equal(area.style.height, "auto");
  area._scroll = 22;
  notificar(266);
  assert.equal(area.style.height, "22px");

  assert.equal(estado.desligado, false);
  desligar();
  assert.equal(estado.desligado, true, "desligado no desmontar");
});

test("D81: sem ResizeObserver (o servidor), o observar nao quebra e nao mexe no campo", () => {
  const { area } = campo(22, "");
  const desligar = observeAutoGrow(area, 100, undefined);
  assert.equal(area.style.height, "");
  assert.doesNotThrow(desligar);
});
