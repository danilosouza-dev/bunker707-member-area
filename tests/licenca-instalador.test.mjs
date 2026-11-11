import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import "./support/admin-action-stubs.mjs";
import { subirEmissorFalso } from "./support/emissor-falso.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// A Licenca pelo terminal do servidor (docs/32 §2.1 e §3.2; docs/20 §9D): a regra da rota interna
// POST /api/licenca/instalador (src/server/licensing/installer.ts), que o `membros licenca` e o instalador do kit chamam
// de dentro do container do app (infra/kit/no-app.mjs). So pedido de dentro do servidor e com o token do tick; o
// "estado" sem segredo; o "ativar" com as mesmas operacoes da tela Licenca (operations.ts), aqui contra o Emissor falso
// que segue o protocolo (tests/support/emissor-falso.mjs) e um banco em memoria.

const { handleInstallerLicenseRequest, normalizeActivationKey } = await import("../src/server/licensing/installer.ts");
const store = await import("../src/server/licensing/store.ts");
const { computeLicenseState } = await import("../src/server/licensing/state.ts");
const { createHttpEmissorClient } = await import("../src/server/licensing/client.ts");
const { activateWithKey } = await import("../src/server/licensing/operations.ts");
const { authorizeJobsTickRequest } = await import("../src/server/jobs/tick-auth.ts");

const raiz = novaRaiz("raiz-instalador");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const HOST = "alunos.escola.test";
const TOKEN = "7".repeat(64);
const AGORA = new Date("2026-11-11T12:00:00.000Z");
let emissor;
let cliente;

before(async () => {
  emissor = await subirEmissorFalso({ emissao });
  cliente = createHttpEmissorClient({ baseUrl: emissor.base, roots: RAIZES });
});
after(async () => {
  await emissor?.fechar();
});

/** A rota com tudo no lugar: o pedido de dentro do servidor, o token certo e o banco em memoria. */
function rota({ modo = "enforce", cabecalhos = {}, corpo = { acao: "estado" }, banco = bancoDaLicenca(store.EMPTY_LICENSE_RECORD), token = TOKEN } = {}) {
  const registro = { ativacoes: [], depois: [] };
  let relogio = AGORA.getTime();
  const operacoes = {
    db: () => banco,
    client: () => cliente,
    roots: () => RAIZES,
    configuredHost: () => `https://${HOST}`,
    now: () => new Date((relogio += 1_000))
  };
  const deps = {
    mode: () => modo,
    tickToken: () => token ?? undefined,
    isValidToken: (cabecalho, configurado) => {
      const resultado = authorizeJobsTickRequest(cabecalho, configurado);
      return resultado.ok ? "ok" : resultado.status === 503 ? "sem_token" : "recusado";
    },
    readBody: async () => {
      if (corpo instanceof Error) throw corpo;
      return corpo;
    },
    headers: new Headers({ authorization: `Bearer ${TOKEN}`, ...cabecalhos }),
    overview: async () => ({
      state: computeLicenseState({ mode: modo, roots: RAIZES, snapshot: store.snapshotOf(banco.linha ?? store.EMPTY_LICENSE_RECORD), systemNow: new Date(relogio + 60_000), configuredHost: `https://${HOST}` }),
      hasInstallationCredentials: store.hasInstallationCredentials(banco.linha),
      lastCheckIn: banco.linha?.lastCheckIn ?? null
    }),
    activate: async (chave) => {
      registro.ativacoes.push(chave);
      return activateWithKey(operacoes, chave);
    },
    afterActivation: async (codigo) => {
      registro.depois.push(codigo);
    }
  };
  return { deps, registro, banco };
}

test("so de dentro do servidor: o pedido que passou por um proxy responde 404 antes do token, e o token do tick e obrigatorio", async () => {
  for (const cabecalho of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip"]) {
    const { deps, registro } = rota({ cabecalhos: { [cabecalho]: "203.0.113.9" }, corpo: { acao: "ativar", chave: emissor.novaLicenca().chave } });
    assert.deepEqual(await handleInstallerLicenseRequest(deps), { status: 404, body: { ok: false, codigo: "nao_encontrado" } }, cabecalho);
    assert.deepEqual(registro.ativacoes, [], cabecalho);
  }
  const semToken = rota({ token: null });
  assert.equal((await handleInstallerLicenseRequest(semToken.deps)).status, 503);
  const errado = rota({ cabecalhos: { authorization: `Bearer ${"8".repeat(64)}` } });
  assert.deepEqual(await handleInstallerLicenseRequest(errado.deps), { status: 401, body: { ok: false, codigo: "nao_autorizado" } });
  const sem = rota();
  sem.deps.headers = new Headers();
  assert.equal((await handleInstallerLicenseRequest(sem.deps)).status, 401);
  assert.equal((await handleInstallerLicenseRequest(rota({ corpo: new Error("grande demais") }).deps)).status, 400);
  assert.deepEqual(await handleInstallerLicenseRequest(rota({ corpo: { acao: "desativar" } }).deps), { status: 400, body: { ok: false, codigo: "pedido_invalido" } });
});

test("modo off: o estado diz o modo (o instalador pula a ativacao) e ativar nao existe", async () => {
  assert.deepEqual(await handleInstallerLicenseRequest(rota({ modo: "off" }).deps), { status: 200, body: { ok: true, modo: "off" } });
  const { deps, registro } = rota({ modo: "off", corpo: { acao: "ativar", chave: "BKA-11111-22222-33333-44444-55555-66666" } });
  assert.equal((await handleInstallerLicenseRequest(deps)).status, 404);
  assert.deepEqual(registro.ativacoes, []);
});

test("ativar: a conferencia inicial e a ativacao de verdade; a resposta tem a frase da tela e nunca a Chave, o segredo ou a licenca", async () => {
  const banco = bancoDaLicenca(store.EMPTY_LICENSE_RECORD);
  const antes = await handleInstallerLicenseRequest(rota({ banco }).deps);
  assert.equal(antes.body.ativada, false);
  assert.equal(antes.body.degrau, "nao_ativada");

  const { chave } = emissor.novaLicenca();
  const inicio = emissor.pedidos.length;
  const { deps, registro } = rota({ banco, corpo: { acao: "ativar", chave: ` ${chave.slice(0, 10)} ${chave.slice(10)} ` } });
  const resposta = await handleInstallerLicenseRequest(deps);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.ok, true, JSON.stringify(resposta.body));
  assert.equal(resposta.body.codigo, "ativada");
  assert.equal(resposta.body.mensagem, "Pronto: esta escola está ativada.");
  assert.equal(resposta.body.vaga, "livre");
  assert.equal(resposta.body.aviso, "sem_ipv4_publico", "daqui o Emissor falso nao bate nas portas: a ativacao segue com o aviso");
  assert.match(resposta.body.mensagem_aviso, /nao conseguiu conferir as portas 80 e 443|não conseguiu conferir as portas 80 e 443/);
  assert.deepEqual(registro.ativacoes, [chave], "os espacos colados saem da Chave");
  assert.deepEqual(registro.depois, ["ativada"], "a memoria esquecida e a auditoria so com o codigo");
  assert.deepEqual(emissor.pedidos.slice(inicio).map((p) => p.caminho), ["/v1/preflight", "/v1/activate"]);
  const texto = JSON.stringify(resposta.body);
  const linha = banco.linha;
  for (const segredo of [chave, linha.installationSecret, linha.checkInSequence, linha.token]) assert.ok(!texto.includes(segredo), "nada de segredo na resposta");

  const depois = await handleInstallerLicenseRequest(rota({ banco }).deps);
  assert.equal(depois.body.ativada, true);
  assert.equal(depois.body.degrau, "ok");
  assert.equal(depois.body.endereco, HOST);
  assert.deepEqual(depois.body.modulos, ["webinars"]);
  assert.equal(typeof depois.body.ultima_conferencia, "string");
  for (const segredo of [chave, linha.installationSecret, linha.checkInSequence, linha.token]) assert.ok(!JSON.stringify(depois.body).includes(segredo));
});

test("ativar: Chave mal formada nao chega ao Emissor; Chave que nao vale e vaga em uso voltam com o codigo e a frase da tela", async () => {
  const malFormada = rota({ corpo: { acao: "ativar", chave: "BKA-<script>" } });
  const r1 = await handleInstallerLicenseRequest(malFormada.deps);
  assert.equal(r1.status, 400);
  assert.equal(r1.body.codigo, "chave_mal_formada");
  assert.match(r1.body.mensagem, /Ela começa com BKA-/);
  assert.deepEqual(malFormada.registro.ativacoes, []);

  const errada = rota({ corpo: { acao: "ativar", chave: "BKA-00000-00000-00000-00000-00000-00000" } });
  const r2 = await handleInstallerLicenseRequest(errada.deps);
  assert.deepEqual(r2, { status: 200, body: { ok: false, codigo: "chave_invalida", mensagem: r2.body.mensagem } });
  assert.match(r2.body.mensagem, /Esta Chave de ativação não vale/);
  assert.deepEqual(errada.registro.depois, ["chave_invalida"]);

  const { banco } = rota();
  const { licenseId, chave } = emissor.novaLicenca();
  assert.equal((await handleInstallerLicenseRequest(rota({ banco, corpo: { acao: "ativar", chave } }).deps)).body.ok, true);
  const outra = rota({ corpo: { acao: "ativar", chave: emissor.novaChave(licenseId) } });
  outra.deps.activate = (k) =>
    activateWithKey({ db: () => bancoDaLicenca(store.EMPTY_LICENSE_RECORD), client: () => cliente, roots: () => RAIZES, configuredHost: () => "https://outra.escola.test", now: () => new Date(AGORA.getTime() + 5_000) }, k);
  const r3 = await handleInstallerLicenseRequest(outra.deps);
  assert.equal(r3.body.codigo, "vaga_em_uso");
  assert.equal(r3.body.endereco, HOST);
  assert.match(r3.body.mensagem, /em uso no endereço alunos\.escola\.test/);
});

test("a Chave como a tela aceita, e a rota interna e dever legal, com a regra num arquivo puro", () => {
  assert.equal(normalizeActivationKey(" BKA-1 2 "), "BKA-12");
  assert.equal(normalizeActivationKey("BKA-" + "1".repeat(77)), null);
  assert.equal(normalizeActivationKey("BKA-1;rm"), null);
  assert.equal(normalizeActivationKey(42), null);
  const rotaTs = readFileSync(new URL("../src/app/api/licenca/instalador/route.ts", import.meta.url), "utf8");
  assert.match(rotaTs, /export async function POST\(request: Request\) \{\n {2}const licenseRefusal = await licenseRouteRefusal\(\{ actionClass: "dever_legal" \}\);/);
  assert.match(rotaTs, /headers: request\.headers/);
  assert.match(rotaTs, /tickToken: \(\) => process\.env\.JOBS_TICK_TOKEN/);
  assert.match(rotaTs, /metadata: \{ resultado: code, origem: "terminal" \}/, "a auditoria leva so o codigo");
  const regra = readFileSync(new URL("../src/server/licensing/installer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(regra, /console\.(log|info|warn|error)/, "nada de log com a Chave");
});
