import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regra pura da fileira da home: qual card esta encostado na borda esquerda ou direita do carrossel
// (esses crescem "para dentro" no hover, em vez de sair da tela). O resto do hover e CSS, coberto pelo
// olho e pelo fluxo de ponta a ponta da home; aqui so a conta das bordas.

const { getHomeRowHoverEdgeIndexes } = await import("../src/lib/home-row-hover-layout.ts");

test("fileira curta com dois cards: so o primeiro encosta na borda; o segundo fica livre no meio", () => {
  const edges = getHomeRowHoverEdgeIndexes({
    cardBounds: [
      { left: 48, right: 328 },
      { left: 340, right: 620 }
    ],
    edgeTolerance: 2,
    leftBoundary: 48,
    rightBoundary: 1232
  });

  assert.equal(edges.leftEdgeIndex, 0);
  assert.equal(edges.rightEdgeIndex, undefined);
});

test("card que chega na borda direita da tela conta como borda, mesmo passando um pouco dela", () => {
  const edges = getHomeRowHoverEdgeIndexes({
    cardBounds: [
      { left: 48, right: 328 },
      { left: 964, right: 1244 }
    ],
    edgeTolerance: 2,
    leftBoundary: 48,
    rightBoundary: 1232
  });

  assert.equal(edges.leftEdgeIndex, 0);
  assert.equal(edges.rightEdgeIndex, 1);
});

test("fileira cheia: primeiro e ultimo cards sao as bordas; os do meio nao", () => {
  const edges = getHomeRowHoverEdgeIndexes({
    cardBounds: [
      { left: 48, right: 328 },
      { left: 340, right: 620 },
      { left: 632, right: 912 },
      { left: 952, right: 1232 }
    ],
    edgeTolerance: 2,
    leftBoundary: 48,
    rightBoundary: 1232
  });

  assert.equal(edges.leftEdgeIndex, 0);
  assert.equal(edges.rightEdgeIndex, 3);
});
