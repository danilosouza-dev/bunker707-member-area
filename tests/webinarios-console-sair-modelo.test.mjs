import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Sair do console com a sala no ar (docs/31 §10; docs/18 §2.2), as regras puras, sem navegador. A sala ao vivo mora na
// pagina do console: trocar de pagina na mesma aba tirava quem apresenta da sala para todos (o video parado para quem
// assiste) ate ele voltar. Com o console dentro da sala, o clique num link que troca de pagina nesta aba pede
// confirmacao; o que abre noutra aba, baixa um arquivo, fica na mesma pagina ou nao e um endereco da web passa direto.

const { CONSOLE_LEAVE_WAIT_MS, consoleLeaveGuarded, consoleLinkLeave } = await import("../src/components/admin/v2/communication/webinars/session-console/console-leave-model.ts");

const AQUI = "https://membros.bunker707.com.br/admin/comunicacao/webinarios/w-1/sala?sessao=s-1";
const clique = (extra = {}) => ({ button: 0, currentHref: AQUI, download: false, href: "/admin/comunicacao/webinarios/w-1", modified: false, target: null, ...extra });

test("consoleLeaveGuarded: so com o console dentro da sala (fora dela, sair nao tira ninguem do ar)", () => {
  assert.equal(consoleLeaveGuarded({ joined: true }), true);
  assert.equal(consoleLeaveGuarded({ joined: false }), false);
});

test("consoleLinkLeave: a seta de voltar, o Ver relatório e um link de fora na mesma aba saem da pagina e pedem confirmacao, com o endereco inteiro", () => {
  assert.equal(consoleLinkLeave(clique()), "https://membros.bunker707.com.br/admin/comunicacao/webinarios/w-1");
  assert.equal(consoleLinkLeave(clique({ href: "/admin/comunicacao/webinarios/w-1/relatorio" })), "https://membros.bunker707.com.br/admin/comunicacao/webinarios/w-1/relatorio");
  assert.equal(consoleLinkLeave(clique({ href: "https://bunker707.com.br/" })), "https://bunker707.com.br/", "outra origem na mesma aba: a pagina inteira troca");
  assert.equal(consoleLinkLeave(clique({ target: "_self" })), "https://membros.bunker707.com.br/admin/comunicacao/webinarios/w-1", "_self e a propria aba");
  assert.equal(consoleLinkLeave(clique({ href: "?sessao=s-2" })), "https://membros.bunker707.com.br/admin/comunicacao/webinarios/w-1/sala?sessao=s-2", "outra sessao remonta o console");
});

test("consoleLinkLeave: o que deixa a sala onde esta passa direto (nova aba, tecla, outro botao, download, ancora, outro esquema, sem href)", () => {
  assert.equal(consoleLinkLeave(clique({ target: "_blank" })), null, "nova aba");
  assert.equal(consoleLinkLeave(clique({ target: "janela" })), null, "outra janela com nome");
  assert.equal(consoleLinkLeave(clique({ modified: true })), null, "Ctrl, ⌘, Shift ou Alt: outra aba, outra janela ou baixar");
  assert.equal(consoleLinkLeave(clique({ button: 1 })), null, "o botao do meio abre noutra aba");
  assert.equal(consoleLinkLeave(clique({ download: true })), null, "o CSV que baixa nao sai da pagina");
  assert.equal(consoleLinkLeave(clique({ href: "#chat" })), null, "a ancora da mesma pagina");
  assert.equal(consoleLinkLeave(clique({ href: AQUI })), null, "o mesmo endereco");
  assert.equal(consoleLinkLeave(clique({ href: `${AQUI}#perguntas` })), null, "o mesmo endereco com ancora");
  assert.equal(consoleLinkLeave(clique({ href: "mailto:suporte@exemplo.com" })), null);
  assert.equal(consoleLinkLeave(clique({ href: "tel:+5511999999999" })), null);
  assert.equal(consoleLinkLeave(clique({ href: "javascript:void(0)" })), null);
  assert.equal(consoleLinkLeave(clique({ href: null })), null, "sem href");
  assert.equal(consoleLinkLeave(clique({ currentHref: "nao e endereco", href: "/x" })), null, "endereco da pagina invalido: nada a perguntar");
});

test("o Sair confirmado espera a saida da sala por pouco tempo (a troca de pagina nunca fica presa)", () => {
  assert.ok(CONSOLE_LEAVE_WAIT_MS > 0 && CONSOLE_LEAVE_WAIT_MS <= 3_000);
});
