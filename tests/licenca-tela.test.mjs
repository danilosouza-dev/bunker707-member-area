import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, before, test } from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";
import { subirEmissorFalso } from "./support/emissor-falso.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// A tela Licença do admin (docs/32 §2.1, §2.3 e §2.4): o que cada ação faz com a licença desta Instalação, contra o
// Emissor falso que segue o protocolo (tests/support/emissor-falso.mjs) e um banco em memória com a interface do store.
// - As operações (src/server/licensing/operations.ts e runLicenseCheckInNow de tick.ts): ativar (conferência inicial e
//   ativação, com a reserva da conversa), Verificar agora, desativar e a licença por arquivo.
// - As Server Actions (src/server/licensing/actions.ts): dever legal, então passam em todo degrau, inclusive na
//   Instalação nunca ativada, que barra todas as outras classes; só o dono e os administradores; só no modo "enforce";
//   a volta para a tela com o código do resultado; a memória da linha esquecida, a moldura refeita e a auditoria só com o
//   código.

const tela = (globalThis.__licencaTela ??= { banco: null, situacao: null, esquecida: 0, revalidadas: [], redirecionada: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/licensing/current-state") {
      return stub(`
        export async function getCurrentLicenseState() { return globalThis.__licencaTela.situacao; }
        export async function readCurrentLicenseState() { return globalThis.__licencaTela.situacao; }
        export function forgetLicenseStateMemory() { globalThis.__licencaTela.esquecida += 1; }`);
    }
    if (modulo === "server/licensing/request-host") {
      return stub(`export async function currentRequestHost() { return globalThis.__licencaTela.host ?? "alunos.escola.test"; }`);
    }
    if (modulo === "server/licensing/store-db") {
      return stub(`
        export const LICENSE_STATE_MIGRATION = "202611100003";
        export function licenseStateDbOf() { return globalThis.__licencaTela.banco; }`);
    }
    if (modulo === "server/auth/permissions") {
      return stub(`
        export class AdminPermissionError extends Error {
          constructor(message, status) { super(message); this.name = "AdminPermissionError"; this.status = status; }
        }
        export async function requireRole() {
          const role = globalThis.__adminActionStubs.role;
          if (!role) { throw new AdminPermissionError("Sua sessão expirou. Entre de novo para continuar.", 401); }
          return role;
        }
        export async function requireScope() {}`);
    }
    if (specifier === "next/cache") {
      return stub(`export function revalidatePath(...args) { globalThis.__licencaTela.revalidadas.push(args); }`);
    }
    if (specifier === "next/navigation") {
      return stub(`
        export function unstable_rethrow() {}
        export function redirect(url) { globalThis.__licencaTela.redirecionada = url; throw new Error("NEXT_REDIRECT"); }
        export function notFound() { throw new Error("NEXT_NOT_FOUND"); }`);
    }
    return nextResolve(specifier, context);
  }
});

const store = await import("../src/server/licensing/store.ts");
const { computeLicenseState } = await import("../src/server/licensing/state.ts");
const { createHttpEmissorClient } = await import("../src/server/licensing/client.ts");
const { activateWithKey, deactivateInstallation, loadLicenseFile } = await import("../src/server/licensing/operations.ts");
const { runLicenseCheckInNow } = await import("../src/server/licensing/tick.ts");
const actions = await import("../src/server/licensing/actions.ts");
const { resolveAdminAccess } = await import("../src/server/auth/roles.ts");
const { isLicenseManager, isLicenseManagerRow } = await import("../src/server/licensing/admin-access.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const HOST = "alunos.escola.test";
const ENDERECO = `https://${HOST}`;
const AGORA = new Date("2026-11-11T12:00:00.000Z");
const MINUTO = 60_000;
const VAZIO = store.EMPTY_LICENSE_RECORD;

let emissor;
let cliente;
const ambienteAntes = {};

before(async () => {
  emissor = await subirEmissorFalso({ emissao });
  cliente = createHttpEmissorClient({ baseUrl: emissor.base, roots: RAIZES });

  for (const nome of ["BUNKER_LICENSING_MODE", "BUNKER_LICENSING_EMISSOR_URL", "BUNKER_LICENSING_ROOTS", "NEXT_PUBLIC_SITE_URL", "APP_VERSION"]) {
    ambienteAntes[nome] = process.env[nome];
  }

  process.env.BUNKER_LICENSING_MODE = "enforce";
  process.env.BUNKER_LICENSING_EMISSOR_URL = emissor.base;
  process.env.BUNKER_LICENSING_ROOTS = JSON.stringify(RAIZES);
  process.env.NEXT_PUBLIC_SITE_URL = ENDERECO;
  process.env.APP_VERSION = "1.4.0";
});

after(async () => {
  for (const [nome, valor] of Object.entries(ambienteAntes)) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }

  await emissor?.fechar();
});

/** As dependências das operações, com o relógio andando um segundo por leitura (como o servidor). */
function dependencias(banco, extra = {}) {
  let relogio = AGORA.getTime();
  return {
    db: () => banco,
    client: () => cliente,
    roots: () => RAIZES,
    configuredHost: () => ENDERECO,
    // O admin aberto pelo endereço da licença (o pedido que envia a licença por arquivo).
    requestHost: () => HOST,
    now: () => new Date((relogio += 1_000)),
    ...extra
  };
}

const situacaoDe = (banco, agora = new Date(AGORA.getTime() + MINUTO)) =>
  computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: store.snapshotOf(banco.linha), systemNow: agora, configuredHost: ENDERECO });

const caminhosDesde = (inicio) => emissor.pedidos.slice(inicio).map((pedido) => pedido.caminho);

/** Uma Instalação ativada de verdade pelo Emissor falso, com a linha no banco em memória. */
async function ativada() {
  const banco = bancoDaLicenca(VAZIO);
  const { chave, licenseId } = emissor.novaLicenca();
  const resultado = await activateWithKey(dependencias(banco), chave);
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  return { banco, chave, licenseId };
}

// ---- Ativar ----------------------------------------------------------------------------------------------

test("ativar a Instalação nunca ativada: conferência inicial e ativação com o mesmo identificador; licença, segredo e sequência gravados juntos", async () => {
  const banco = bancoDaLicenca(VAZIO);
  assert.equal(situacaoDe(banco).evaluation.degree, "nao_ativada");
  const { chave } = emissor.novaLicenca();
  const inicio = emissor.pedidos.length;

  const resultado = await activateWithKey(dependencias(banco, { versions: () => ({ product: "1.4.0" }) }), chave);

  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(resultado.slot, "livre");
  assert.equal(resultado.ports, "sem_ipv4_publico", "daqui o Emissor não bate nas portas: a ativação segue com o aviso");
  assert.deepEqual(caminhosDesde(inicio), ["/v1/preflight", "/v1/activate"]);
  const [preflight, ativacao] = emissor.pedidos.slice(inicio);
  assert.equal(preflight.corpo.instanceId, ativacao.corpo.instanceId, "o mesmo identificador sorteado nas duas");
  assert.match(ativacao.corpo.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(ativacao.corpo.versions, { product: "1.4.0" });

  const linha = banco.linha;
  const noEmissor = emissor.instalacao(linha.installationId);
  assert.equal(linha.installationSecret, noEmissor.secret);
  assert.equal(linha.checkInSequence, noEmissor.sequence);
  assert.equal(linha.checkInResult, "ok");
  assert.equal(linha.everActivated, true);
  assert.equal(linha.lastCheckIn.emissorTime.toISOString(), resultado.license.issuedAt, "a ativação vale como conferência boa (o nonce conferiu)");
  assert.deepEqual(banco.chamadas.filter((chamada) => chamada === "write").length, 2, "a reserva e a gravação do resultado");

  const situacao = situacaoDe(banco);
  assert.equal(situacao.evaluation.degree, "ok");
  assert.deepEqual(situacao.evaluation.features, ["webinars"]);
});

test("a conferência inicial com as portas abertas: ativa sem aviso", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const { chave } = emissor.novaLicenca();
  emissor.portas = { ipPublic: true, ports: { 80: "aberta", 443: "aberta" } };

  try {
    const resultado = await activateWithKey(dependencias(banco), chave);
    assert.equal(resultado.ok && resultado.ports, "ok");
  } finally {
    emissor.portas = { ipPublic: false, ports: null };
  }

  emissor.portas = { ipPublic: true, ports: { 80: "fechada", 443: "aberta" } };

  try {
    const outra = bancoDaLicenca(VAZIO);
    const resultado = await activateWithKey(dependencias(outra), emissor.novaLicenca().chave);
    assert.equal(resultado.ok && resultado.ports, "portas_fechadas");
  } finally {
    emissor.portas = { ipPublic: false, ports: null };
  }
});

test("erro da conferência inicial para tudo antes de gastar a Chave; a reserva volta como estava e a agenda da conferência não muda", async () => {
  const { banco, licenseId } = await ativada();
  const antes = banco.linha;
  const inicio = emissor.pedidos.length;

  const errada = await activateWithKey(dependencias(banco), "BKA-00000-00000-00000-00000-00000-00000");
  assert.deepEqual(errada, { ok: false, error: "chave_invalida" });
  assert.deepEqual(caminhosDesde(inicio), ["/v1/preflight"], "a ativação nem foi pedida");

  const noutroEndereco = await activateWithKey(dependencias(banco, { configuredHost: () => "https://outra.escola.test" }), emissor.novaChave(licenseId));
  assert.deepEqual(noutroEndereco, { ok: false, error: "vaga_em_uso", host: HOST }, "a tela mostra onde a vaga está em uso");

  const depois = banco.linha;
  for (const campo of ["token", "installationId", "installationSecret", "checkInSequence", "checkInResult", "lastCheckIn", "newestIssuedAt"]) {
    assert.deepEqual(depois[campo], antes[campo], campo);
  }
  assert.equal(depois.checkInAttemptedAt.toISOString(), antes.checkInAttemptedAt.toISOString(), "a reserva devolvida como estava");
});

test("erro da ativação depois da conferência inicial que passou: a reserva volta e nada da Instalação muda", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const { chave } = emissor.novaLicenca();
  emissor.proximas.push({ caminho: "/v1/activate", status: 410, corpo: { error: "chave_vencida", message: "x" } });

  assert.deepEqual(await activateWithKey(dependencias(banco), chave), { ok: false, error: "chave_vencida" });
  assert.equal(banco.linha.installationId, null);
  assert.equal(banco.linha.checkInResult, null);
  assert.equal(banco.linha.checkInAttemptedAt, null);
  assert.equal(situacaoDe(banco).evaluation.degree, "nao_ativada");
});

test("ativar de novo no mesmo endereço com outra Chave: a mesma Instalação, segredo novo; o segredo antigo para de valer no Emissor", async () => {
  const { banco, licenseId } = await ativada();
  const antes = banco.linha;

  const resultado = await activateWithKey(dependencias(banco), emissor.novaChave(licenseId));
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(resultado.slot, "mesmo_endereco");
  assert.equal(banco.linha.installationId, antes.installationId);
  assert.notEqual(banco.linha.installationSecret, antes.installationSecret);

  const comAntigo = await cliente.checkIn({ installationId: antes.installationId, installationSecret: antes.installationSecret, sequence: null, nonce: "n".repeat(43), host: HOST });
  assert.deepEqual(comAntigo, { ok: false, error: "credencial_invalida" });
  assert.deepEqual(await runLicenseCheckInNow(dependencias(banco)), { done: true, result: "ok" }, "o segredo novo confere");
});

test("duas ativações ao mesmo tempo: uma fala com o Emissor e a outra recebe em_andamento (dois segredos deixariam a Instalação sem conferir)", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const { chave } = emissor.novaLicenca();
  const inicio = emissor.pedidos.length;

  const [a, b] = await Promise.all([activateWithKey(dependencias(banco), chave), activateWithKey(dependencias(banco), chave)]);

  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal((a.ok ? b : a).error, "em_andamento");
  assert.deepEqual(caminhosDesde(inicio), ["/v1/preflight", "/v1/activate"]);
  assert.equal(banco.linha.installationSecret, emissor.instalacao(banco.linha.installationId).secret, "o segredo guardado é o que o Emissor tem");
});

test("sem endereço configurado não há ativação: sem_endereco, sem pedido ao Emissor", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const inicio = emissor.pedidos.length;

  assert.deepEqual(await activateWithKey(dependencias(banco, { configuredHost: () => null }), emissor.novaLicenca().chave), { ok: false, error: "sem_endereco" });
  assert.deepEqual(caminhosDesde(inicio), []);
  assert.equal(banco.linha, null, "nada gravado");
});

// ---- Verificar agora ----------------------------------------------------------------------------------

test("Verificar agora: confere na hora, mesmo com a nova tentativa de 1 hora esperando, e mesmo em Escola congelada", async () => {
  const { banco } = await ativada();
  const tentativa = new Date(AGORA.getTime() + 20 * MINUTO);
  banco.mexer({ checkInResult: "sem_resposta", checkInAttemptedAt: tentativa });
  assert.equal(store.checkInDecision(banco.linha, new Date(tentativa.getTime() + 5 * MINUTO)).reason, "aguardando_nova_tentativa");
  const antes = banco.linha;
  const inicio = emissor.pedidos.length;

  const resultado = await runLicenseCheckInNow(dependencias(banco, { now: () => new Date(tentativa.getTime() + 5 * MINUTO) }));

  assert.deepEqual(resultado, { done: true, result: "ok" });
  assert.deepEqual(caminhosDesde(inicio), ["/v1/check-in"]);
  const pedido = emissor.pedidos.at(-1).corpo;
  assert.equal(pedido.sequence, antes.checkInSequence);
  assert.equal(pedido.license, antes.token, "a licença guardada vai junto");
  assert.notEqual(banco.linha.checkInSequence, antes.checkInSequence);
  assert.equal(banco.linha.checkInResult, "ok");
  assert.ok(banco.linha.newestIssuedAt > antes.newestIssuedAt);
  assert.equal(banco.linha.lastSeenAt.toISOString(), banco.linha.lastCheckIn.emissorTime.toISOString(), "realinhada com a hora assinada");
});

test("Verificar agora sem identificador e segredo (nunca ativada): sem_instalacao; com outra conversa em andamento: em_andamento", async () => {
  const inicio = emissor.pedidos.length;
  assert.deepEqual(await runLicenseCheckInNow(dependencias(bancoDaLicenca(VAZIO))), { done: false, reason: "sem_instalacao" });

  const { banco } = await ativada();
  banco.mexer({ checkInResult: "em_andamento", checkInAttemptedAt: new Date(AGORA.getTime() + 500) });
  assert.deepEqual(await runLicenseCheckInNow(dependencias(banco)), { done: false, reason: "em_andamento" });
  assert.deepEqual(caminhosDesde(inicio).filter((caminho) => caminho === "/v1/check-in"), []);
});

test("Verificar agora com a resposta repetida de outro pedido: recusada pelo nonce, gravada como falha, e a licença guardada continua", async () => {
  const { banco } = await ativada();
  const antes = banco.linha;
  emissor.proximas.push({ caminho: "/v1/check-in", status: 200, corpo: { license: antes.token, sequence: "sequencia-repetida-000" } });

  assert.deepEqual(await runLicenseCheckInNow(dependencias(banco)), { done: true, result: "nonce_diferente" });
  assert.equal(banco.linha.token, antes.token);
  assert.equal(banco.linha.checkInSequence, antes.checkInSequence);
  assert.equal(banco.linha.checkInResult, "nonce_diferente");
});

test("o resultado de uma tentativa que outra substituiu não grava nada (a reserva venceu e outra conversa começou)", () => {
  const linha = { ...VAZIO, version: 3, installationId: "inst_0001", checkInAttemptedAt: new Date(AGORA.getTime() + 10 * MINUTO), checkInResult: "em_andamento" };

  assert.deepEqual(store.planCheckInFailure(linha, { result: "sem_resposta", attemptStartedAt: AGORA }), {
    patch: {},
    outcome: { accepted: false, result: "tentativa_substituida" }
  });
  assert.deepEqual(store.planCheckInSuccess(linha, { token: "x", sequence: "s", roots: RAIZES, receivedAt: AGORA, attemptStartedAt: AGORA }).outcome, {
    accepted: false,
    result: "tentativa_substituida"
  });
});

// ---- Desativar -----------------------------------------------------------------------------------------

test("desativar: grava a ordem assinada, e a escola vai na hora para Escola congelada; a terceira mudança no ano não muda nada", async () => {
  const { banco, licenseId } = await ativada();
  const resultado = await deactivateInstallation(dependencias(banco));

  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(emissor.instalacao(banco.linha.installationId).status, "deactivated");
  const situacao = situacaoDe(banco);
  assert.equal(situacao.evaluation.degree, "escola_congelada");
  assert.deepEqual(situacao.evaluation.reasons.map((item) => item.reason), ["desativada"]);
  assert.equal(situacao.evaluation.restrictions.newAccess, true);

  const outra = await ativada();
  emissor.estado.mudancas.set(outra.licenseId, 2);
  const antes = outra.banco.linha;
  assert.deepEqual(await deactivateInstallation(dependencias(outra.banco)), { ok: false, error: "limite_de_mudancas", changes: 2 });
  assert.equal(outra.banco.linha.token, antes.token);
  assert.equal(situacaoDe(outra.banco).evaluation.degree, "ok");
  assert.ok(licenseId);
});

test("desativar sem Instalação ativada: sem_instalacao, sem pedido", async () => {
  const inicio = emissor.pedidos.length;
  assert.deepEqual(await deactivateInstallation(dependencias(bancoDaLicenca(VAZIO))), { ok: false, error: "sem_instalacao" });
  assert.deepEqual(caminhosDesde(inicio), []);
});

// ---- Licença por arquivo -----------------------------------------------------------------------------

/** A licença por arquivo que o Painel baixa: delivery "file", sem nonce. */
function porArquivo(instalacao, extra = {}) {
  return assinarLicenca(
    emissao,
    licencaBase({
      installation: instalacao,
      delivery: "file",
      issuedAt: "2026-11-11T15:00:00.000Z",
      expiresAt: "2026-12-11T15:00:00.000Z",
      ...extra
    })
  );
}

test("licença por arquivo numa Instalação ativada: aceita a deste endereço e desta Instalação; nunca vale como conferência", async () => {
  const { banco } = await ativada();
  const antes = banco.linha;
  const arquivo = porArquivo({ id: antes.installationId, host: HOST }, { issuedAt: new Date(antes.newestIssuedAt.getTime() + MINUTO).toISOString() });

  const resultado = await loadLicenseFile(dependencias(banco), `\n  ${arquivo}\n`);

  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(banco.linha.token, arquivo);
  assert.deepEqual(banco.linha.lastCheckIn, antes.lastCheckIn, "não mexe na última conferência");
  assert.equal(banco.linha.checkInSequence, antes.checkInSequence);
  assert.equal(situacaoDe(banco).license.delivery, "file");
});

test("licença por arquivo recusada: a da conversa (com nonce), outro endereço, outra Instalação, mais antiga, adulterada e o texto vazio", async () => {
  const { banco } = await ativada();
  const antes = banco.linha;
  const id = antes.installationId;
  const depois = new Date(antes.newestIssuedAt.getTime() + MINUTO).toISOString();
  const adulterada = porArquivo({ id, host: HOST }, { issuedAt: depois }).split(".");
  adulterada[3] = Buffer.from(JSON.stringify(licencaBase({ installation: { id, host: HOST }, delivery: "file", features: [{ key: "pago" }] }))).toString("base64url");
  const casos = [
    [antes.token, "nao_e_arquivo"],
    [porArquivo({ id, host: HOST }, { issuedAt: depois, nonce: "n".repeat(43) }), "nao_e_arquivo"],
    [porArquivo({ id, host: "outra.escola.test" }, { issuedAt: depois }), "endereco_diferente"],
    [porArquivo({ id: "inst_9999", host: HOST }, { issuedAt: depois }), "outra_instalacao"],
    [porArquivo({ id, host: HOST }, { issuedAt: "2026-11-10T00:00:00.000Z" }), "licenca_antiga"],
    [adulterada.join("."), "licenca_invalida"],
    ["BKL1.isto.nao.e.licenca", "licenca_invalida"],
    ["qualquer texto", "licenca_invalida"],
    ["   ", "arquivo_vazio"]
  ];

  for (const [texto, esperado] of casos) {
    assert.deepEqual(await loadLicenseFile(dependencias(banco), texto), { ok: false, error: esperado }, esperado);
  }

  assert.equal(banco.linha.token, antes.token, "nada trocado");
});

test("licença por arquivo na Instalação nunca ativada: vale como licença (o identificador vem do arquivo), sem segredo para conferir", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const arquivo = porArquivo({ id: "inst_doarquivo01", host: HOST });

  // A cópia aberta por outro endereço, com o endereço configurado no da licença, não adota o arquivo.
  assert.deepEqual(await loadLicenseFile(dependencias(banco, { requestHost: () => "pirata.example.com" }), arquivo), { ok: false, error: "endereco_diferente" });
  assert.equal(banco.linha, null);

  assert.equal((await loadLicenseFile(dependencias(banco), arquivo)).ok, true);
  assert.equal(banco.linha.installationId, "inst_doarquivo01");
  assert.equal(banco.linha.everActivated, true);
  assert.equal(situacaoDe(banco, new Date("2026-11-11T16:00:00.000Z")).evaluation.degree, "ok");
  assert.deepEqual(await runLicenseCheckInNow(dependencias(banco)), { done: false, reason: "sem_instalacao" });
});

// ---- As Server Actions ---------------------------------------------------------------------------------

const DONO = { id: "00000000-0000-4000-8000-000000000001" };

function comPapel(papel, permissoes = {}) {
  actionStubs.role = { access: resolveAdminAccess(papel, permissoes), role: papel, user: DONO };
}

function formulario(campos) {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) dados.append(nome, valor);
  return dados;
}

/** Roda a ação e devolve para onde ela mandou (a Server Action termina com redirect). */
async function rodar(acao, dados) {
  tela.redirecionada = null;
  await assert.rejects(dados === undefined ? acao() : acao(dados), /NEXT_REDIRECT/);
  return tela.redirecionada;
}

/** A situação de uma Instalação nunca ativada, e uma em cada degrau (a licença assinada pelo dublê). */
function situacaoCom(sobrescrever) {
  if (sobrescrever === null) {
    return computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: store.snapshotOf(null), systemNow: AGORA, configuredHost: ENDERECO });
  }

  return computeLicenseState({
    mode: "enforce",
    roots: RAIZES,
    snapshot: { ...store.snapshotOf(null), everActivated: true, token: assinarLicenca(emissao, licencaBase(sobrescrever)), lastSeenAt: AGORA },
    systemNow: AGORA,
    configuredHost: ENDERECO
  });
}

function prepararAcao({ situacao, banco = bancoDaLicenca(VAZIO), papel = "owner", permissoes = {} } = {}) {
  tela.situacao = situacao;
  tela.banco = banco;
  tela.esquecida = 0;
  tela.revalidadas = [];
  actionStubs.db = createFakeDb();
  comPapel(papel, permissoes);
  return banco;
}

test("Ativar pela ação na Instalação nunca ativada (que barra todas as outras classes): passa por ser dever legal e ativa de verdade", async () => {
  const situacao = situacaoCom(null);
  assert.equal(situacao.evaluation.restrictions.activationOnly, true);
  const banco = prepararAcao({ situacao });
  const { chave } = emissor.novaLicenca();

  const destino = await rodar(actions.activateLicense, formulario({ chave: ` ${chave.toLowerCase()} ` }));

  assert.equal(destino, "/admin/configuracoes/licenca?resultado=ativada&aviso=sem_ipv4_publico");
  assert.ok(banco.linha.installationId, "gravou a Instalação");
  assert.deepEqual(emissor.pedidos.at(-1).corpo.versions, { product: "1.4.0" }, "a versão que roda vai junto");
  assert.equal(tela.esquecida, 1, "a linha da memória do processo é esquecida");
  assert.deepEqual(tela.revalidadas, [["/admin", "layout"]], "a faixa da moldura é refeita");
  const auditoria = actionStubs.db.calls.writes.filter((escrita) => escrita.table === "admin_audit_log");
  assert.deepEqual(auditoria.map((escrita) => [escrita.payload.action, escrita.payload.metadata]), [["license.activate", { resultado: "ativada" }]]);
  assert.equal(JSON.stringify(auditoria).includes(chave), false, "a Chave nunca vai para a auditoria");
});

test("Ativar pela ação: Chave mal colada não sai do servidor; Chave errada volta com o código do protocolo; vaga em uso, com o endereço", async () => {
  const banco = prepararAcao({ situacao: situacaoCom(null) });
  const inicio = emissor.pedidos.length;

  assert.equal(await rodar(actions.activateLicense, formulario({ chave: "   " })), "/admin/configuracoes/licenca?resultado=chave_mal_formada");
  assert.equal(await rodar(actions.activateLicense, formulario({ chave: "<script>" })), "/admin/configuracoes/licenca?resultado=chave_mal_formada");
  assert.equal(await rodar(actions.activateLicense, new FormData()), "/admin/configuracoes/licenca?resultado=chave_mal_formada");
  assert.deepEqual(caminhosDesde(inicio), [], "nada foi ao Emissor");

  assert.equal(await rodar(actions.activateLicense, formulario({ chave: "BKA-00000-00000-00000-00000-00000-00000" })), "/admin/configuracoes/licenca?resultado=chave_invalida");

  // A Licença já ativa em alunos.escola.test, e esta escola configurada noutro endereço: a tela mostra onde a vaga está.
  const outra = await ativada();
  process.env.NEXT_PUBLIC_SITE_URL = "https://outra.escola.test";

  try {
    assert.equal(
      await rodar(actions.activateLicense, formulario({ chave: emissor.novaChave(outra.licenseId) })),
      "/admin/configuracoes/licenca?resultado=vaga_em_uso&endereco=alunos.escola.test"
    );
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = ENDERECO;
  }

  assert.equal(banco.linha?.installationId ?? null, null);
});

test("Verificar agora pela ação em Escola congelada: passa (dever legal) e confere; desativar pede a confirmação marcada", async () => {
  const { banco } = await ativada();
  prepararAcao({ banco, situacao: situacaoCom({ statusSteps: [{ degree: "escola_congelada", from: "2026-11-01T00:00:00.000Z", reason: "revogada" }] }) });

  assert.equal(await rodar(actions.checkLicenseNow), "/admin/configuracoes/licenca?resultado=verificada");

  const inicio = emissor.pedidos.length;
  assert.equal(await rodar(actions.deactivateLicense, formulario({})), "/admin/configuracoes/licenca?resultado=confirmacao_pendente");
  assert.equal(await rodar(actions.deactivateLicense, formulario({ confirmar: "sim" })), "/admin/configuracoes/licenca?resultado=confirmacao_pendente");
  assert.deepEqual(caminhosDesde(inicio), [], "sem a confirmação, nada sai");

  assert.equal(await rodar(actions.deactivateLicense, formulario({ confirmar: "desativar" })), "/admin/configuracoes/licenca?resultado=desativada");
  assert.equal(situacaoDe(banco).evaluation.degree, "escola_congelada");
  // A confirmação que faltou nem chega ao handler: só as ações que rodaram vão para a auditoria.
  const auditoria = actionStubs.db.calls.writes.filter((escrita) => escrita.table === "admin_audit_log").map((escrita) => escrita.payload.action);
  assert.deepEqual(auditoria, ["license.check_now", "license.deactivate"]);
});

test("licença por arquivo pela ação: o arquivo escolhido ou o texto colado; vazio e grande demais voltam com a frase", async () => {
  const arquivo = porArquivo({ id: "inst_doarquivo02", host: HOST });

  // O admin aberto por outro endereço (a cópia nunca ativada noutro domínio): a ação manda o endereço do pedido, e o
  // arquivo não é adotado.
  tela.host = "pirata.example.com";
  const copia = prepararAcao({ situacao: situacaoCom(null) });
  try {
    assert.equal(await rodar(actions.uploadLicenseFile, formulario({ texto: arquivo })), "/admin/configuracoes/licenca?resultado=endereco_diferente");
    assert.equal(copia.linha, null);
  } finally {
    delete tela.host;
  }

  const banco = prepararAcao({ situacao: situacaoCom(null) });

  assert.equal(
    await rodar(actions.uploadLicenseFile, formulario({ arquivo: new File([`${arquivo}\n`], "licenca.txt", { type: "text/plain" }) })),
    "/admin/configuracoes/licenca?resultado=arquivo_carregado"
  );
  assert.equal(banco.linha.token, arquivo);

  prepararAcao({ situacao: situacaoCom(null) });
  assert.equal(await rodar(actions.uploadLicenseFile, formulario({ arquivo: new File([], ""), texto: arquivo })), "/admin/configuracoes/licenca?resultado=arquivo_carregado");
  assert.equal(await rodar(actions.uploadLicenseFile, formulario({ arquivo: new File([], ""), texto: "" })), "/admin/configuracoes/licenca?resultado=arquivo_vazio");
  assert.equal(
    await rodar(actions.uploadLicenseFile, formulario({ arquivo: new File(["x".repeat(40 * 1024)], "grande.txt") })),
    "/admin/configuracoes/licenca?resultado=arquivo_grande"
  );
  assert.equal(await rodar(actions.uploadLicenseFile, formulario({ texto: "não é licença" })), "/admin/configuracoes/licenca?resultado=licenca_invalida");
});

test("só o dono e os administradores: o editor e o suporte recebem sem_permissao e nada sai; o administrador por função combinada passa", async () => {
  const inicio = emissor.pedidos.length;

  for (const papel of ["editor", "support", "analyst", "instructor"]) {
    prepararAcao({ situacao: situacaoCom(null), papel });
    assert.equal(await rodar(actions.checkLicenseNow), "/admin/configuracoes/licenca?resultado=sem_permissao", papel);
    assert.equal(await rodar(actions.activateLicense, formulario({ chave: emissor.novaLicenca().chave })), "/admin/configuracoes/licenca?resultado=sem_permissao", papel);
  }

  assert.deepEqual(caminhosDesde(inicio), [], "nada foi ao Emissor");

  prepararAcao({ situacao: situacaoCom(null), papel: "custom", permissoes: { functions: ["admin", "editor"] } });
  assert.equal(await rodar(actions.checkLicenseNow), "/admin/configuracoes/licenca?resultado=sem_instalacao");

  assert.equal(isLicenseManager(resolveAdminAccess("owner", {})), true);
  assert.equal(isLicenseManager(resolveAdminAccess("admin", {})), true);
  assert.equal(isLicenseManager(resolveAdminAccess("custom", { functions: ["support"], actions: ["settings.ai", "students.export"] })), false);
  assert.equal(isLicenseManager(null), false);
  assert.equal(isLicenseManagerRow("owner", null), true);
  assert.equal(isLicenseManagerRow("custom", { functions: ["admin"] }), true);
  assert.equal(isLicenseManagerRow("custom", { functions: ["editor"] }), false);
  assert.equal(isLicenseManagerRow("superuser", {}), false);
});

test("sessão vencida vai para o login; no modo off a tela não existe: a ação responde como não encontrada e nada é lido nem enviado", async () => {
  prepararAcao({ situacao: situacaoCom(null) });
  actionStubs.role = null;
  assert.equal(await rodar(actions.checkLicenseNow), "/login?next=%2Fadmin%2Fconfiguracoes%2Flicenca");

  const banco = prepararAcao({ situacao: { mode: "off" } });
  const inicio = emissor.pedidos.length;
  process.env.BUNKER_LICENSING_MODE = "off";

  try {
    assert.equal(await rodar(actions.checkLicenseNow), "/admin/configuracoes/licenca");
    assert.equal(await rodar(actions.activateLicense, formulario({ chave: emissor.novaLicenca().chave })), "/admin/configuracoes/licenca");
    assert.equal(await rodar(actions.deactivateLicense, formulario({ confirmar: "desativar" })), "/admin/configuracoes/licenca");
  } finally {
    process.env.BUNKER_LICENSING_MODE = "enforce";
  }

  assert.deepEqual(caminhosDesde(inicio), []);
  assert.deepEqual(banco.chamadas, [], "o banco da licença nem foi lido");
  assert.equal(tela.esquecida, 0);
});
