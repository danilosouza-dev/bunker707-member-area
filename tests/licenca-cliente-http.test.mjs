import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import "./support/admin-action-stubs.mjs";
import { subirEmissorFalso, statusDoErro } from "./support/emissor-falso.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// O cliente HTTP do Emissor (src/server/licensing/client.ts; docs/32 §2.1 e §11.3; o contrato de fio em docs/protocolo.md
// do bunker-licensing) contra um Emissor falso local que segue o protocolo (tests/support/emissor-falso.mjs): a
// conferência inicial, a ativação, a conferência com o nonce certo e com outro, a resposta velha repetida recusada, o
// desativar, o tempo esgotado, o corpo fora do formato e cada código de erro do protocolo. E o endereço do Emissor
// gravado no build: só https, ou http://127.0.0.1 nos testes.

const { EMISSOR_ERROR_CODES, EMISSOR_PROTOCOL_ERROR_CODES, createHttpEmissorClient, emissorClient, notConfiguredEmissorClient } = await import(
  "../src/server/licensing/client.ts"
);
const { parseEmissorBaseUrl } = await import("../src/server/licensing/build-config.ts");
const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");
const { CHECK_IN_RESULT_PATTERN } = await import("../src/server/licensing/store.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const HOST = "alunos.escola.test";
const LINKS = { renew: "https://www.bunker707.test/renovar/lic", store: "https://www.bunker707.test/modulos" };

let emissor;
let cliente;

before(async () => {
  emissor = await subirEmissorFalso({ emissao, links: LINKS });
  cliente = createHttpEmissorClient({ baseUrl: emissor.base, roots: RAIZES });
});

after(async () => {
  await emissor?.fechar();
});

const nonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const instanceId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
const conteudo = (token) => JSON.parse(Buffer.from(token.split(".")[3], "base64url").toString("utf8"));
const ultimoPedido = () => emissor.pedidos.at(-1);

/** Uma Instalação ativada no Emissor falso: o que a Instalação guardaria. */
async function ativada(dados = {}) {
  const { chave, licenseId } = emissor.novaLicenca(undefined, dados);
  const pedido = { activationKey: chave, host: HOST, instanceId: instanceId(), nonce: nonce() };
  const resposta = await cliente.activate(pedido);
  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  return { ...resposta, chave, licenseId, nonceDaAtivacao: pedido.nonce };
}

/** Responde o próximo pedido com uma licença assinada sob medida (o mesmo dublê de chaves do Emissor falso). */
function proximaLicenca(fazer) {
  emissor.proximas.push({
    responder: ({ corpo, estado }) => {
      const instalacao = estado.instalacoes.get(corpo.installationId);
      return { status: 200, corpo: fazer({ corpo, instalacao }) };
    }
  });
}

// ---- O endereço do Emissor gravado no build ----------------------------------------------------------

test("o endereço do Emissor: só https (sem usuário, busca nem âncora), ou http://127.0.0.1 nos testes; o resto vale como ausente", () => {
  assert.equal(parseEmissorBaseUrl("https://licencas-api.bunker707.com.br"), "https://licencas-api.bunker707.com.br");
  assert.equal(parseEmissorBaseUrl(" https://licencas-api.bunker707.com.br/ "), "https://licencas-api.bunker707.com.br");
  assert.equal(parseEmissorBaseUrl("https://emissor.test/api/"), "https://emissor.test/api");
  assert.equal(parseEmissorBaseUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(parseEmissorBaseUrl("http://127.0.0.1"), "http://127.0.0.1");

  for (const recusado of [
    undefined,
    "",
    "   ",
    "licencas-api.bunker707.com.br",
    "http://licencas-api.bunker707.com.br",
    "http://localhost:8080",
    "http://127.0.0.1.evil.test",
    "http://[::1]:8080",
    "http://10.0.0.5",
    "https://usuario:senha@emissor.test",
    "https://emissor.test/?a=1",
    "https://emissor.test/#topo",
    "ftp://emissor.test",
    "javascript:alert(1)",
    `https://${"a".repeat(300)}.test`
  ]) {
    assert.equal(parseEmissorBaseUrl(recusado), null, String(recusado));
  }
});

test("sem o endereço no build o cliente é o 'não configurado'; com o endereço, o HTTP, que fala com o Emissor gravado", async () => {
  const antes = { url: process.env.BUNKER_LICENSING_EMISSOR_URL, raizes: process.env.BUNKER_LICENSING_ROOTS };

  try {
    delete process.env.BUNKER_LICENSING_EMISSOR_URL;
    assert.equal(emissorClient(), notConfiguredEmissorClient);
    process.env.BUNKER_LICENSING_EMISSOR_URL = "http://emissor.test";
    assert.equal(emissorClient(), notConfiguredEmissorClient, "http fora de 127.0.0.1 nunca vale");

    process.env.BUNKER_LICENSING_EMISSOR_URL = emissor.base;
    process.env.BUNKER_LICENSING_ROOTS = JSON.stringify(RAIZES);
    const doBuild = emissorClient();
    assert.notEqual(doBuild, notConfiguredEmissorClient);
    const { chave } = emissor.novaLicenca();
    const resposta = await doBuild.preflight({ activationKey: chave, host: HOST });
    assert.equal(resposta.ok, true);
  } finally {
    if (antes.url === undefined) delete process.env.BUNKER_LICENSING_EMISSOR_URL;
    else process.env.BUNKER_LICENSING_EMISSOR_URL = antes.url;
    if (antes.raizes === undefined) delete process.env.BUNKER_LICENSING_ROOTS;
    else process.env.BUNKER_LICENSING_ROOTS = antes.raizes;
  }
});

// ---- Conferência inicial e ativação ------------------------------------------------------------------

test("conferência inicial: o pedido leva a Chave, o endereço e o identificador; a resposta diz a vaga e as portas sem gastar a Chave", async () => {
  const { chave } = emissor.novaLicenca();
  const id = instanceId();
  const resposta = await cliente.preflight({ activationKey: chave, host: HOST, instanceId: id });

  assert.deepEqual(resposta, { ok: true, passed: false, slot: "livre", ip: "127.0.0.1", ipPublic: false, ports: null, reservedUntil: null });
  assert.deepEqual(ultimoPedido(), { caminho: "/v1/preflight", metodo: "POST", tipo: "application/json", corpo: { activationKey: chave, host: HOST, instanceId: id } });

  emissor.portas = { ipPublic: true, ports: { 80: "aberta", 443: "aberta" } };
  const passou = await cliente.preflight({ activationKey: chave, host: HOST });
  emissor.portas = { ipPublic: false, ports: null };
  assert.equal(passou.ok && passou.passed, true);
  assert.match(passou.reservedUntil, /^\d{4}-\d\d-\d\dT/);
});

test("ativação: o pedido leva o nonce, o identificador e só as versões no formato; a licença devolvida confere, traz o nonce e é deste endereço", async () => {
  const { chave } = emissor.novaLicenca();
  const pedido = { activationKey: chave, host: HOST, instanceId: instanceId(), nonce: nonce(), versions: { product: "1.4.0", bundle: "versão ruim" } };
  const resposta = await cliente.activate(pedido);

  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  assert.match(resposta.installationId, /^inst_[0-9a-z]{8,40}$/);
  assert.match(resposta.installationSecret, /^bks_[A-Za-z0-9_-]{43}$/);
  assert.match(resposta.sequence, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(resposta.license.nonce, pedido.nonce);
  assert.equal(resposta.license.installation.id, resposta.installationId);
  assert.equal(resposta.license.installation.host, HOST);
  assert.equal(verifyLicenseToken(resposta.token, RAIZES).ok, true);
  assert.deepEqual(ultimoPedido().corpo, {
    activationKey: chave,
    host: HOST,
    instanceId: pedido.instanceId,
    nonce: pedido.nonce,
    versions: { product: "1.4.0" }
  });
});

test("ativação com o endereço em outra forma (https, maiúsculas, ponto final) vai no formato do protocolo; sem endereço válido, nem sai pedido", async () => {
  const { chave } = emissor.novaLicenca();
  const resposta = await cliente.activate({ activationKey: chave, host: "https://ALUNOS.Escola.test./", instanceId: instanceId(), nonce: nonce() });
  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  assert.equal(ultimoPedido().corpo.host, HOST);
  assert.equal(resposta.license.installation.host, HOST);

  const antes = emissor.pedidos.length;

  assert.deepEqual(await cliente.activate({ activationKey: chave, host: "alunos.escola.test:8443", instanceId: instanceId(), nonce: nonce() }), {
    ok: false,
    error: "sem_endereco"
  });
  assert.deepEqual(await cliente.preflight({ activationKey: chave, host: "" }), { ok: false, error: "sem_endereco" });
  assert.deepEqual(await cliente.preflight({ activationKey: chave, host: "http://alunos.escola.test" }), { ok: false, error: "sem_endereco" }, "só https");
  assert.deepEqual(await cliente.preflight({ activationKey: chave, host: "203.0.113.10" }), { ok: false, error: "sem_endereco" }, "IP não é endereço de escola");
  assert.deepEqual(await cliente.checkIn({ host: null, installationId: "inst_0000000000", installationSecret: "x", nonce: nonce(), sequence: null }), {
    ok: false,
    error: "sem_endereco"
  });
  assert.equal(emissor.pedidos.length, antes, "nenhum pedido saiu");
});

// ---- Conferência: o nonce, a resposta repetida e a anti-volta --------------------------------------------

test("conferência com o nonce certo: licença nova, sequência nova; o pedido leva a sequência, a licença guardada e o número da Licença", async () => {
  const instalacao = await ativada();
  const pedido = {
    installationId: instalacao.installationId,
    installationSecret: instalacao.installationSecret,
    sequence: instalacao.sequence,
    nonce: nonce(),
    host: HOST,
    storedLicense: instalacao.token,
    licenseId: instalacao.licenseId,
    versions: { product: "1.4.0" },
    newestIssuedAt: new Date(instalacao.license.issuedAt)
  };
  const resposta = await cliente.checkIn(pedido);

  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  assert.equal(resposta.license.nonce, pedido.nonce);
  assert.notEqual(resposta.sequence, instalacao.sequence);
  assert.ok(Date.parse(resposta.license.issuedAt) > Date.parse(instalacao.license.issuedAt));
  assert.deepEqual(ultimoPedido().corpo, {
    installationId: instalacao.installationId,
    secret: instalacao.installationSecret,
    host: HOST,
    nonce: pedido.nonce,
    sequence: instalacao.sequence,
    licenseId: instalacao.licenseId,
    versions: { product: "1.4.0" },
    license: instalacao.token
  });
  assert.equal(emissor.instalacao(instalacao.installationId).sequenciaApresentada, instalacao.sequence);
});

test("conferência: campo opcional fora do formato não vai (a sequência estragada, a licença grande demais), para o Emissor não recusar o pedido inteiro", async () => {
  const instalacao = await ativada();
  const resposta = await cliente.checkIn({
    installationId: instalacao.installationId,
    installationSecret: instalacao.installationSecret,
    sequence: "curta",
    nonce: nonce(),
    host: HOST,
    storedLicense: "x".repeat(20_000),
    licenseId: "outro-formato"
  });

  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  const corpo = ultimoPedido().corpo;
  assert.equal("sequence" in corpo, false);
  assert.equal("license" in corpo, false);
  assert.equal("licenseId" in corpo, false);
});

test("conferência com a licença de outro pedido (nonce diferente): recusada como nonce_diferente, nunca como conferência boa", async () => {
  const instalacao = await ativada();
  proximaLicenca(({ instalacao: alvo }) => {
    const outra = assinarLicenca(emissao, licencaBase({ installation: { id: alvo.id, host: alvo.host }, issuedAt: "2026-11-12T12:00:00.000Z", nonce: nonce() }));
    return { license: outra, sequence: "sequencia-nova-0000000" };
  });

  const resposta = await cliente.checkIn({
    installationId: instalacao.installationId,
    installationSecret: instalacao.installationSecret,
    sequence: instalacao.sequence,
    nonce: nonce(),
    host: HOST
  });

  assert.deepEqual(resposta, { ok: false, error: "nonce_diferente" });
});

test("a resposta velha repetida (a de ontem, inteira, licença legítima e sequência) é recusada: o nonce não é o deste pedido", async () => {
  const instalacao = await ativada();
  const credenciais = { installationId: instalacao.installationId, installationSecret: instalacao.installationSecret, host: HOST };
  const ontem = await cliente.checkIn({ ...credenciais, sequence: instalacao.sequence, nonce: nonce() });
  assert.equal(ontem.ok, true);

  // Alguém no meio do caminho (ou no banco) devolve a mesma resposta boa, byte a byte.
  emissor.proximas.push({ status: 200, corpo: { license: ontem.token, sequence: ontem.sequence } });
  const repetida = await cliente.checkIn({ ...credenciais, sequence: ontem.sequence, nonce: nonce(), newestIssuedAt: new Date(ontem.license.issuedAt) });
  assert.deepEqual(repetida, { ok: false, error: "nonce_diferente" });

  // E com o mesmo nonce (o pedido repetido por inteiro), a licença mais antiga que a mais nova já aceita não volta o relógio.
  emissor.proximas.push({ status: 200, corpo: { license: instalacao.token, sequence: ontem.sequence } });
  const antiga = await cliente.checkIn({ ...credenciais, sequence: ontem.sequence, nonce: instalacao.nonceDaAtivacao, newestIssuedAt: new Date(ontem.license.issuedAt) });
  assert.deepEqual(antiga, { ok: false, error: "licenca_antiga" });

  // A marca guardada com data inválida (o banco mexido) nunca deixa passar.
  emissor.proximas.push({ status: 200, corpo: { license: ontem.token, sequence: ontem.sequence } });
  assert.deepEqual(
    await cliente.checkIn({ ...credenciais, sequence: ontem.sequence, nonce: conteudo(ontem.token).nonce, newestIssuedAt: new Date("infinity") }),
    { ok: false, error: "licenca_antiga" }
  );
});

test("licença de outra Instalação, de outra chave de emissão ou adulterada: licenca_invalida", async () => {
  const instalacao = await ativada();
  const credenciais = { installationId: instalacao.installationId, installationSecret: instalacao.installationSecret, host: HOST, sequence: instalacao.sequence };
  const n1 = nonce();
  proximaLicenca(() => ({ license: assinarLicenca(emissao, licencaBase({ installation: { id: "inst_9999999999", host: HOST }, issuedAt: "2026-11-12T12:00:00.000Z", nonce: n1 })), sequence: "sequencia-nova-0000000" }));
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: n1 }), { ok: false, error: "licenca_invalida" });

  const n2 = nonce();
  const pirata = novaChaveDeEmissao(novaRaiz("raiz-2026"));
  proximaLicenca(({ instalacao: alvo }) => ({ license: assinarLicenca(pirata, licencaBase({ installation: { id: alvo.id, host: HOST }, issuedAt: "2026-11-12T12:00:00.000Z", nonce: n2 })), sequence: "sequencia-nova-0000000" }));
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: n2 }), { ok: false, error: "licenca_invalida" });

  const n3 = nonce();
  proximaLicenca(({ instalacao: alvo }) => {
    const partes = assinarLicenca(emissao, licencaBase({ installation: { id: alvo.id, host: HOST }, issuedAt: "2026-11-12T12:00:00.000Z", nonce: n3 })).split(".");
    partes[3] = Buffer.from(JSON.stringify(licencaBase({ installation: { id: alvo.id, host: HOST }, nonce: n3, features: [{ key: "pago" }] }))).toString("base64url");
    return { license: partes.join("."), sequence: "sequencia-nova-0000000" };
  });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: n3 }), { ok: false, error: "licenca_invalida" });
});

test("ativação devolvendo licença de outro endereço ou de outro identificador: recusada, sem segredo nenhum na resposta", async () => {
  const { chave } = emissor.novaLicenca();
  const n = nonce();
  emissor.proximas.push({
    responder: () => ({
      status: 200,
      corpo: {
        installationId: "inst_aaaaaaaaaaaaaaaaaaaa",
        secret: `bks_${"s".repeat(43)}`,
        sequence: "sequencia-0000000000000",
        license: assinarLicenca(emissao, licencaBase({ installation: { id: "inst_aaaaaaaaaaaaaaaaaaaa", host: "outra.escola.test" }, nonce: n }))
      }
    })
  });

  const resposta = await cliente.activate({ activationKey: chave, host: HOST, instanceId: instanceId(), nonce: n });
  assert.deepEqual(resposta, { ok: false, error: "licenca_invalida" });
});

// ---- Desativar -------------------------------------------------------------------------------------------

test("desativar: devolve a ordem assinada (Escola congelada, desativada) com o nonce; a conferência seguinte recebe a mesma ordem", async () => {
  const instalacao = await ativada();
  const n = nonce();
  const resposta = await cliente.deactivate({ installationId: instalacao.installationId, installationSecret: instalacao.installationSecret, nonce: n });

  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  assert.equal(resposta.license.nonce, n);
  assert.deepEqual(resposta.license.statusSteps.map((step) => [step.degree, step.reason]), [["escola_congelada", "desativada"]]);
  assert.deepEqual(ultimoPedido().corpo, { installationId: instalacao.installationId, secret: instalacao.installationSecret, nonce: n });

  const depois = await cliente.checkIn({
    installationId: instalacao.installationId,
    installationSecret: instalacao.installationSecret,
    sequence: instalacao.sequence,
    nonce: nonce(),
    host: HOST
  });
  assert.equal(depois.ok, true);
  assert.equal(depois.sequence, instalacao.sequence, "a desativada recebe a mesma sequência de antes");
});

// ---- Erros do protocolo, do fio e do tempo -----------------------------------------------------------

test("cada código de erro do protocolo chega como ele é, com os detalhes que a tela usa; código desconhecido vira 'recusado'", async () => {
  const credenciais = { installationId: "inst_0000000000", installationSecret: `bks_${"a".repeat(43)}`, host: HOST, sequence: null, nonce: nonce() };

  for (const codigo of EMISSOR_PROTOCOL_ERROR_CODES) {
    emissor.proximas.push({ status: statusDoErro(codigo), corpo: { error: codigo, message: "texto do Emissor" } });
    assert.deepEqual(await cliente.checkIn(credenciais), { ok: false, error: codigo }, codigo);
  }

  emissor.proximas.push({ status: 409, corpo: { error: "vaga_em_uso", message: "x", host: "membros.escola.test" } });
  assert.deepEqual(await cliente.activate({ activationKey: "BKA-X", host: HOST, instanceId: instanceId(), nonce: nonce() }), {
    ok: false,
    error: "vaga_em_uso",
    host: "membros.escola.test"
  });

  emissor.proximas.push({ status: 409, corpo: { error: "vaga_em_uso", message: "x", host: "<script>" } });
  assert.deepEqual(await cliente.preflight({ activationKey: "BKA-X", host: HOST }), { ok: false, error: "vaga_em_uso" }, "endereço fora do formato não passa");

  emissor.proximas.push({ status: 429, corpo: { error: "limite_de_pedidos", message: "x", retryAfterSeconds: 120 }, cabecalhos: { "retry-after": "120" } });
  assert.deepEqual(await cliente.checkIn(credenciais), { ok: false, error: "limite_de_pedidos", retryAfterSeconds: 120 });

  emissor.proximas.push({ status: 409, corpo: { error: "limite_de_mudancas", message: "x", changes: 2 } });
  assert.deepEqual(await cliente.deactivate({ installationId: "inst_0000000000", installationSecret: credenciais.installationSecret, nonce: nonce() }), {
    ok: false,
    error: "limite_de_mudancas",
    changes: 2
  });

  emissor.proximas.push({ status: 409, corpo: { error: "codigo_que_nao_existe", message: "x" } });
  assert.deepEqual(await cliente.checkIn(credenciais), { ok: false, error: "recusado" });

  for (const codigo of EMISSOR_ERROR_CODES) {
    assert.match(codigo, CHECK_IN_RESULT_PATTERN, `${codigo} cabe na coluna check_in_result`);
  }
});

test("os erros de verdade do Emissor falso: Chave desconhecida, vaga noutro endereço, segredo errado e terceira mudança no ano", async () => {
  assert.deepEqual(await cliente.preflight({ activationKey: "BKA-00000-00000-00000-00000-00000-00000", host: HOST }), { ok: false, error: "chave_invalida" });

  const instalacao = await ativada();
  const outraChave = emissor.novaChave(instalacao.licenseId);
  assert.deepEqual(await cliente.preflight({ activationKey: outraChave, host: "outra.escola.test" }), { ok: false, error: "vaga_em_uso", host: HOST });

  assert.deepEqual(
    await cliente.checkIn({ installationId: instalacao.installationId, installationSecret: `bks_${"z".repeat(43)}`, sequence: null, nonce: nonce(), host: HOST }),
    { ok: false, error: "credencial_invalida" }
  );

  emissor.estado.mudancas.set(instalacao.licenseId, 2);
  assert.deepEqual(
    await cliente.deactivate({ installationId: instalacao.installationId, installationSecret: instalacao.installationSecret, nonce: nonce() }),
    { ok: false, error: "limite_de_mudancas", changes: 2 }
  );
});

test("corpo fora do formato: HTML, JSON sem campo, corpo grande demais e 2xx que não é 200 viram resposta_invalida; 5xx sem JSON vira indisponivel", async () => {
  const credenciais = { installationId: "inst_0000000000", installationSecret: `bks_${"a".repeat(43)}`, host: HOST, sequence: null };

  emissor.proximas.push({ status: 200, cru: "<html>ok</html>" });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "resposta_invalida" });

  emissor.proximas.push({ status: 200, corpo: { license: "BKL1.a.b.c.d" } });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "resposta_invalida" });

  emissor.proximas.push({ status: 200, corpo: { license: "x".repeat(70 * 1024), sequence: "sequencia-0000000000000" } });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "resposta_invalida" });

  emissor.proximas.push({ status: 201, corpo: { license: "x", sequence: "sequencia-0000000000000" } });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "resposta_invalida" });

  emissor.proximas.push({ status: 200, corpo: { ok: "sim" } });
  assert.deepEqual(await cliente.preflight({ activationKey: "BKA-X", host: HOST }), { ok: false, error: "resposta_invalida" });

  emissor.proximas.push({ status: 502, cru: "<html>Bad Gateway</html>", cabecalhos: { "content-type": "text/html" } });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "indisponivel" });

  emissor.proximas.push({ status: 429, cru: "devagar", cabecalhos: { "content-type": "text/plain", "retry-after": "30" } });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "limite_de_pedidos", retryAfterSeconds: 30 });

});

test("o cliente não segue redirecionamento nem lê corpo acima do teto, mesmo quando o que viria depois seria uma resposta boa", async () => {
  const instalacao = await ativada();
  const credenciais = { installationId: instalacao.installationId, installationSecret: instalacao.installationSecret, host: HOST, sequence: instalacao.sequence };
  const respostaBoa = ({ corpo, estado }) => ({
    status: 200,
    corpo: { license: estado && corpo ? emissorLicencaPara(estado, corpo) : "x", sequence: "sequencia-nova-0000000" }
  });
  const emissorLicencaPara = (estado, corpo) => {
    const alvo = estado.instalacoes.get(corpo.installationId);
    return assinarLicenca(emissao, licencaBase({ installation: { id: alvo.id, host: alvo.host }, issuedAt: "2026-11-12T12:00:00.000Z", nonce: corpo.nonce }));
  };

  // Um 307 (o método e o corpo vão junto) para o próprio Emissor falso, que responderia certo: o cliente não vai.
  emissor.proximas.push({ caminho: "/v1/check-in", status: 307, cru: "", cabecalhos: { location: `${emissor.base}/v1/desvio` } });
  emissor.proximas.push({ caminho: "/v1/desvio", responder: respostaBoa });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "sem_resposta" }, "redirecionamento não é seguido");
  assert.equal(emissor.pedidos.at(-1).caminho, "/v1/check-in", "o desvio nem foi pedido");
  emissor.proximas.length = 0;

  // A resposta boa, com um campo a mais que passa do teto do corpo (64 KB): não é lida.
  emissor.proximas.push({
    caminho: "/v1/check-in",
    responder: (contexto) => ({ status: 200, corpo: { ...respostaBoa(contexto).corpo, folga: "x".repeat(70 * 1024) } })
  });
  assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "resposta_invalida" });

  // A mesma resposta sem a folga é aceita: o que barrou acima foi o teto.
  emissor.proximas.push({ caminho: "/v1/check-in", responder: respostaBoa });
  assert.equal((await cliente.checkIn({ ...credenciais, nonce: nonce() })).ok, true);
});

test("Emissor que não responde: sem_resposta dentro do tempo limite, sem lançar; o prazo de quem chama também vale", async () => {
  // O timer do AbortSignal.timeout não segura o processo: um timer comum fica vivo enquanto o teste espera.
  const vivo = setInterval(() => {}, 1_000);

  try {
    const rapido = createHttpEmissorClient({ baseUrl: emissor.base, roots: RAIZES, timeoutMs: 150 });
    const credenciais = { installationId: "inst_0000000000", installationSecret: `bks_${"a".repeat(43)}`, host: HOST, sequence: null };

    emissor.proximas.push({ nuncaResponde: true });
    const inicio = Date.now();
    assert.deepEqual(await rapido.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "sem_resposta" });
    assert.ok(Date.now() - inicio < 2_000, "não espera além do prazo");

    emissor.proximas.push({ nuncaResponde: true });
    const prazo = new AbortController();
    const timer = setTimeout(() => prazo.abort(), 100);
    assert.deepEqual(await cliente.checkIn({ ...credenciais, nonce: nonce(), signal: prazo.signal }), { ok: false, error: "sem_resposta" });
    clearTimeout(timer);

    emissor.proximas.push({ atrasoMs: 400, status: 200, corpo: { license: "x", sequence: "sequencia-0000000000000" } });
    assert.deepEqual(await rapido.checkIn({ ...credenciais, nonce: nonce() }), { ok: false, error: "sem_resposta" });
  } finally {
    clearInterval(vivo);
  }
});

test("sem rede (porta fechada) vira sem_resposta; o cliente nunca escreve log e nenhuma falha carrega o segredo", async () => {
  const fechada = await new Promise((resolve) => {
    const servidor = createServer();
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
  const semRede = createHttpEmissorClient({ baseUrl: `http://127.0.0.1:${fechada}`, roots: RAIZES });
  const segredo = `bks_${"q".repeat(43)}`;
  const chamadas = [];
  const originais = {};

  for (const nivel of ["log", "info", "warn", "error", "debug"]) {
    originais[nivel] = console[nivel];
    console[nivel] = (...args) => chamadas.push([nivel, ...args]);
  }

  try {
    const respostas = [
      await semRede.checkIn({ installationId: "inst_0000000000", installationSecret: segredo, sequence: "sequencia-0000000000000", nonce: nonce(), host: HOST }),
      await semRede.deactivate({ installationId: "inst_0000000000", installationSecret: segredo, nonce: nonce() }),
      await semRede.activate({ activationKey: "BKA-SEGREDO", host: HOST, instanceId: instanceId(), nonce: nonce() })
    ];

    emissor.proximas.push({ status: 401, corpo: { error: "credencial_invalida", message: segredo } });
    respostas.push(await cliente.checkIn({ installationId: "inst_0000000000", installationSecret: segredo, sequence: null, nonce: nonce(), host: HOST }));

    assert.deepEqual(respostas.map((item) => item.error), ["sem_resposta", "sem_resposta", "sem_resposta", "credencial_invalida"]);
    assert.equal(JSON.stringify(respostas).includes(segredo), false);
    assert.equal(JSON.stringify(respostas).includes("BKA-SEGREDO"), false);
  } finally {
    Object.assign(console, originais);
  }

  assert.deepEqual(chamadas, [], "o cliente não escreve log");
});
