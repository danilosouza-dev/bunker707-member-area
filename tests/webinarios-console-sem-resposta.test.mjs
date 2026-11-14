import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O console da live nunca fica preso quando um pedido fica sem resposta (docs/30 D123; docs/18 §2.2). Em 14/11/2026 os
// servidores de producao reiniciaram sozinhos (as atualizacoes de seguranca, 05:30 UTC) no meio de um teste do
// produtor: o pedido de aplicar os participantes simulados morreu com o app, a chamada da Server Action lancou e o
// console, que tinha marcado "ocupado" antes do await, nunca desmarcou. "Aplicando…" ficou na tela e todos os botoes
// ficaram desligados, o Encerrar a live tambem, ate reabrir a pagina. Aqui: a regra pura (settleAction) e a ligacao no
// console (toda acao da mesa passa por ela).

const { GENERIC_ACTION_ERROR, UNREACHABLE_ACTION_ERROR, actionError, actionOk, settleAction } = await import("../src/lib/action-result.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SEM_RESPOSTA = { error: UNREACHABLE_ACTION_ERROR, ok: false, status: 500 };

test("a frase diz o que fazer e nao e a generica", () => {
  assert.match(UNREACHABLE_ACTION_ERROR, /não respondeu/);
  assert.match(UNREACHABLE_ACTION_ERROR, /tente de novo/);
  assert.match(UNREACHABLE_ACTION_ERROR, /recarregue a página/);
  assert.notEqual(UNREACHABLE_ACTION_ERROR, GENERIC_ACTION_ERROR);
});

test("a resposta da acao passa como veio: o sucesso e o erro com o status e os campos", async () => {
  const ok = actionOk({ n: 6 });
  assert.equal(await settleAction(async () => ok), ok);
  const recusa = actionError(409, "A sessão já foi encerrada.", { extra: ["Número inválido."] });
  assert.equal(await settleAction(async () => recusa), recusa);
});

test("o pedido sem resposta vira um erro comum, nunca uma promessa que lanca ou que nao termina de lancar", async () => {
  // A rede caiu ou o app reiniciou no meio do pedido.
  assert.deepEqual(await settleAction(() => Promise.reject(new TypeError("Failed to fetch"))), SEM_RESPOSTA);
  // A pagina e de uma versao anterior a do servidor (a acao nao existe mais la).
  assert.deepEqual(await settleAction(() => Promise.reject(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))), SEM_RESPOSTA);
  // O erro lancado antes de a promessa existir.
  assert.deepEqual(
    await settleAction(() => {
      throw new Error("antes do pedido");
    }),
    SEM_RESPOSTA
  );
  // Uma resposta fora do contrato (o servidor de outra versao devolveu outra coisa).
  for (const estranha of [undefined, null, "ok", 200, {}, { ok: "sim" }]) {
    assert.deepEqual(await settleAction(async () => estranha), SEM_RESPOSTA, JSON.stringify(estranha));
  }
});

test("os sinais de navegacao do Next (redirect, notFound) passam adiante: nao sao falha do pedido", async () => {
  for (const digest of ["NEXT_REDIRECT;replace;/admin;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
    const sinal = Object.assign(new Error("navegacao"), { digest });
    await assert.rejects(settleAction(() => Promise.reject(sinal)), (error) => error === sinal, digest);
  }
  // Um erro comum com outro digest (o do proprio Next para erro do servidor) e pedido sem resposta.
  assert.deepEqual(await settleAction(() => Promise.reject(Object.assign(new Error("x"), { digest: "1234567890" }))), SEM_RESPOSTA);
});

test("a mesa que marca ocupada antes do pedido sempre desmarca: o roteiro do reinicio do servidor", async () => {
  // O mesmo desenho do run() do console: ocupada, pedido, livre, aviso.
  const mesa = { aviso: null, ocupada: null };
  async function run(key, action) {
    if (mesa.ocupada) {
      return false;
    }
    mesa.ocupada = key;
    mesa.aviso = null;
    const result = await settleAction(action);
    mesa.ocupada = null;
    if (!result.ok) {
      mesa.aviso = result.error;
      return false;
    }
    return true;
  }
  assert.equal(await run("audience", () => Promise.reject(new TypeError("Failed to fetch"))), false);
  assert.equal(mesa.ocupada, null, "os botoes voltam (o Encerrar a live tambem)");
  assert.equal(mesa.aviso, UNREACHABLE_ACTION_ERROR, "o aviso aparece");
  // O servidor voltou: o mesmo botao funciona sem reabrir a pagina.
  assert.equal(await run("audience", async () => actionOk({ extra: 6 })), true);
  assert.equal(await run("live:end", async () => actionOk(null)), true);
  assert.equal(mesa.aviso, null);
});

test("no console, toda acao da mesa passa pelo settleAction; nenhuma chamada direta fica depois do setBusyKey", () => {
  const consoleSource = semComentarios(ler("src/components/admin/v2/communication/webinars/session-console/session-console.tsx"));
  assert.match(consoleSource, /import \{ settleAction, type ActionResult \} from "@\/lib\/action-result";/);
  const run = consoleSource.slice(consoleSource.indexOf("async function run<T>("), consoleSource.indexOf("async function openNow("));
  assert.ok(run.length > 0 && run.length < 1500, "o run() da mesa");
  assert.match(run, /setBusyKey\(key\);\s*setFailure\(null\);\s*const result = await settleAction\(action\);\s*setBusyKey\(null\);/);
  assert.doesNotMatch(consoleSource, /await action\(\)/, "nunca o pedido cru");
  // As acoes chamadas fora do run() (as que devolvem o resultado ao formulario) tambem.
  const acoes = ["markRecordingAnchor", "sendScriptedComment", "saveScriptComment", "savePersona", "deletePersona", "createConsolePoll", "archiveScreenItem", "saveScreenItem", "showScreenItem"];
  for (const acao of acoes) {
    assert.ok(consoleSource.includes(`${acao}(`), `${acao} existe no console`);
    assert.doesNotMatch(consoleSource, new RegExp(`await ${acao}\\(`), `${acao} nunca com await direto`);
    assert.match(consoleSource, new RegExp(`settleAction\\(\\(\\) => \\(?[^;]*${acao}\\(`), `${acao} dentro do settleAction`);
  }
  // Toda vez que a mesa marca ocupada, ha um settleAction antes de desmarcar.
  const marcas = consoleSource.split(/setBusyKey\((?!null\))/).slice(1);
  assert.ok(marcas.length >= 7, "os pontos em que a mesa marca ocupada");
  for (const trecho of marcas) {
    const ateSoltar = trecho.slice(0, trecho.indexOf("setBusyKey(null)"));
    assert.match(ateSoltar, /await settleAction\(/, ateSoltar.slice(0, 80));
  }
});
