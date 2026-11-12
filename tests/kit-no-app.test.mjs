import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

// O script que o kit roda dentro do container do app (infra/kit/no-app.mjs; docs/20 §9D), de verdade, pelo Node, como
// o `docker compose exec -T app node --input-type=module -e "<script>" <acao>` roda: a entrada e a saida em JSON, os
// segredos (o token do tick e a chave secreta do Supabase) so do ambiente, nunca na saida. Do outro lado, um app e um
// Auth de mentira numa porta local, que anotam o que chegou.

const SCRIPT = readFileSync(new URL("../infra/kit/no-app.mjs", import.meta.url), "utf8");
const TOKEN = "token-do-tick-0123456789abcdef0123456789abcdef";
const SEGREDO = "sb_secret_chave-secreta-do-supabase_abc123";
const pedidos = [];
const respostas = new Map();
let servidor;
let base;

before(async () => {
  servidor = createServer((pedido, resposta) => {
    let corpo = "";
    pedido.on("data", (d) => (corpo += d));
    pedido.on("end", () => {
      pedidos.push({ caminho: pedido.url, cabecalhos: pedido.headers, corpo: corpo ? JSON.parse(corpo) : null });
      const [status, json] = respostas.get(pedido.url) ?? [404, null];
      resposta.writeHead(status, { "content-type": "application/json" });
      resposta.end(json === null ? "" : JSON.stringify(json));
    });
  });
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor?.close());

function rodar(acao, entrada, ambiente = {}) {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, ["--input-type=module", "-e", SCRIPT, acao], {
      env: { PATH: process.env.PATH, KIT_APP_URL: base, SUPABASE_INTERNAL_URL: base, JOBS_TICK_TOKEN: TOKEN, SUPABASE_SECRET_KEY: SEGREDO, ...ambiente },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (saida += d));
    filho.on("close", (status) => resolver({ status, saida, json: saida.trim() ? JSON.parse(saida.trim().split("\n").at(-1)) : null }));
    filho.stdin.end(entrada === undefined ? "" : JSON.stringify(entrada));
  });
}

test("a Licenca: o estado e a ativacao vao ao app pela rota interna, com o token do ambiente; a Chave so pela entrada", async () => {
  respostas.set("/api/licenca/instalador", [200, { ok: true, modo: "enforce", ativada: false, degrau: "nao_ativada" }]);
  let r = await rodar("licenca-estado", {});
  assert.equal(r.status, 0, r.saida);
  assert.deepEqual(r.json, { ok: true, modo: "enforce", ativada: false, degrau: "nao_ativada" });
  let p = pedidos.at(-1);
  assert.equal(p.cabecalhos.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(p.corpo, { acao: "estado" });
  assert.equal(p.cabecalhos["x-forwarded-for"], undefined, "pedido de dentro do servidor, sem cabecalho de proxy");

  respostas.set("/api/licenca/instalador", [200, { ok: false, codigo: "chave_usada", mensagem: "Esta Chave de ativação já foi usada." }]);
  r = await rodar("licenca-ativar", { chave: "BKA-12345-ABCDE" });
  assert.equal(r.status, 0, "o pedido chegou ao app: o codigo vem no JSON");
  assert.equal(r.json.codigo, "chave_usada");
  p = pedidos.at(-1);
  assert.deepEqual(p.corpo, { acao: "ativar", chave: "BKA-12345-ABCDE" });
  assert.ok(!r.saida.includes(TOKEN) && !r.saida.includes(SEGREDO));

  // A imagem de antes da rota (404 sem codigo): o caminho e a tela Licenca.
  respostas.set("/api/licenca/instalador", [404, null]);
  r = await rodar("licenca-estado", {});
  assert.equal(r.status, 1);
  assert.equal(r.json.codigo, "sem_rota");
  assert.match(r.json.mensagem, /ative pela tela Configuracoes > Licenca/);
  // Sem o token no ambiente, nem chama; com o app fora do ar, diz isso.
  r = await rodar("licenca-estado", {}, { JOBS_TICK_TOKEN: "" });
  assert.equal(r.json.codigo, "sem_token");
  r = await rodar("licenca-estado", {}, { KIT_APP_URL: "http://127.0.0.1:9" });
  assert.equal(r.status, 1);
  assert.equal(r.json.codigo, "app_fora");
});

test("a conta do dono: criada confirmada e sem senha pela API administrativa do Auth; a que ja existe volta como existe", async () => {
  respostas.set("/auth/v1/admin/users", [200, { id: "0b5d3c1e-0001-4a2b-9c8d-123456789abc", email: "dono@escola.test" }]);
  let r = await rodar("dono-criar", { email: "dono@escola.test" });
  assert.equal(r.status, 0, r.saida);
  assert.deepEqual(r.json, { ok: true, id: "0b5d3c1e-0001-4a2b-9c8d-123456789abc", criada: true });
  const p = pedidos.at(-1);
  assert.equal(p.cabecalhos.apikey, SEGREDO);
  assert.equal(p.cabecalhos.authorization, `Bearer ${SEGREDO}`);
  assert.deepEqual(p.corpo, { email: "dono@escola.test", email_confirm: true }, "sem senha: o dono cria a dele pelo link");
  assert.ok(!r.saida.includes(SEGREDO));

  respostas.set("/auth/v1/admin/users", [422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" }]);
  r = await rodar("dono-criar", { email: "dono@escola.test" });
  assert.deepEqual(r.json, { ok: false, codigo: "existe" });
  respostas.set("/auth/v1/admin/users", [500, { msg: "erro" }]);
  r = await rodar("dono-criar", { email: "dono@escola.test" });
  assert.equal(r.json.codigo, "auth_recusou");
  r = await rodar("dono-criar", { email: "nao-e-email" });
  assert.equal(r.status, 1);
  assert.equal(r.json.codigo, "email_invalido");
});

test("o link do dono: o hashed_token da recuperacao, no formato do GoTrue ou do supabase-js; sem ele, recusado", async () => {
  const hash = "a1b2c3".repeat(9) + "dd";
  respostas.set("/auth/v1/admin/generate_link", [200, { id: "x", email: "dono@escola.test", action_link: "https://api/verify?token=y", hashed_token: hash, verification_type: "recovery" }]);
  let r = await rodar("dono-link", { email: "dono@escola.test" });
  assert.deepEqual(r.json, { ok: true, token_hash: hash });
  assert.deepEqual(pedidos.at(-1).corpo, { type: "recovery", email: "dono@escola.test" });
  respostas.set("/auth/v1/admin/generate_link", [200, { properties: { hashed_token: hash } }]);
  r = await rodar("dono-link", { email: "dono@escola.test" });
  assert.equal(r.json.token_hash, hash);
  respostas.set("/auth/v1/admin/generate_link", [200, { hashed_token: "../../etc" }]);
  r = await rodar("dono-link", { email: "dono@escola.test" });
  assert.equal(r.json.codigo, "auth_recusou");
  r = await rodar("acao-que-nao-existe", {});
  assert.equal(r.status, 1);
  assert.equal(r.json.codigo, "acao_desconhecida");
});
