import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after, before, beforeEach } from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { apiInternaFalsa, CREDENCIAL_DE_TESTE } from "./support/emissor-interno-falso.mjs";
import { bancoEmMemoria } from "./support/vendas-banco-em-memoria.mjs";

// Minhas licencas (docs/32 §2.4), do lado do comprador, sem o Supabase local: as Server Actions de verdade (o titular, a
// Chave, a troca e o revogar), a pagina montada no servidor (getMyLicensesPage e o LicensesView desenhado pelo
// react-dom/server) e o item do menu, com a API interna configurada apontando para a API falsa por HTTP
// (tests/support/emissor-interno-falso.mjs, que responde pelo simulador do produto). Aqui:
// - so o comprador (acesso aberto a um produto marcado) ve a pagina, o menu e as acoes; sem a configuracao, nada existe;
// - so o dono: todo pedido leva a conta da sessao, e a Licenca de outra conta responde como inexistente;
// - o titular: CPF e CNPJ (tambem o alfanumerico) conferidos, o segundo e-mail diferente do da conta, o aceite pedido e a
//   versao vinda do servidor; quando so os termos mudam, o titular que o Emissor tem e reaproveitado;
// - a Chave aparece uma vez, so na resposta da acao: nunca no banco, no HTML da pagina nem no log;
// - trocar pede a confirmacao com o que para de funcionar; revogar corta a chave e a instalacao;
// - os erros do Emissor viram frases simples; a situacao de cada Licenca sai em portugues.

const sessao = (globalThis.__alunoLicencas ??= { licenca: { mode: "off" }, usuario: null });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = (fonte) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(fonte)}` });

    if (specifier === "@/server/auth/session") {
      return stub(`
        export async function getAuthenticatedUser() { return globalThis.__alunoLicencas.usuario; }
        export async function getSessionUser() { return globalThis.__alunoLicencas.usuario; }`);
    }

    if (specifier === "@/server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }

    if (specifier === "@/server/licensing/current-state") {
      return stub(`
        export async function readCurrentLicenseState() { return globalThis.__alunoLicencas.licenca; }
        export const getCurrentLicenseState = readCurrentLicenseState;
        export function forgetLicenseStateMemory() {}`);
    }

    if (specifier === "next/cache") {
      return nextResolve(new URL("./support/integration-next-cache.mjs", import.meta.url).href, context);
    }

    return nextResolve(specifier, context);
  }
});

const actions = await import("../src/server/licensing/interno/student-actions.ts");
const student = await import("../src/server/licensing/interno/student.ts");
const holder = await import("../src/server/licensing/interno/holder.ts");
const studentModel = await import("../src/server/licensing/interno/student-model.ts");
const { LICENSE_TERMS_VERSION } = await import("../src/server/licensing/interno/terms.ts");
const { createInternalEmissorSimulator } = await import("../src/server/licensing/interno/simulator.ts");
const { getMemberSidebarSections } = await import("../src/components/member/shell/member-shell-model.ts");
const { LicensesView } = await import("../src/components/member/licenses/licenses-view.tsx");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

const ANA = { email: "ana@escola.test", id: "0b6f1f0e-1d7a-4c58-9a59-3f3a8c1d2e11" };
const BETO = { email: "beto@escola.test", id: "1c7f2f1e-2e8b-4d69-8a6a-4f4b9d2e3f22" };
const CAIO = { email: "caio@escola.test", id: "2d8f3f2e-3f9c-4e7a-9b7b-5a5cae3f4033" };
const CPF_VALIDO = "529.982.247-25";
const CNPJ_VALIDO = "11.222.333/0001-81";
const CNPJ_ALFANUMERICO = "12.ABC.345/01DE-35";

let simulador;
let falso;

before(async () => {
  simulador = createInternalEmissorSimulator({ products: { 9001: "licenca_anual", 9002: "licenca_vitalicia" } });
  falso = await apiInternaFalsa({ simulador });

  // As vendas que o Emissor ja aplicou: a Ana e o Beto compraram (a Ana duas Licencas); o Caio nunca comprou.
  const venda = (pessoa, transacao, produto) =>
    simulador.registerSale(
      {
        comprador: { areaUserId: pessoa.id, email: pessoa.email, nome: pessoa.email.split("@")[0] },
        compradoEm: "2026-11-11T12:00:00.000Z",
        garantiaAte: null,
        plataforma: "hotmart",
        produto,
        transacao
      },
      { requestId: `venda-${transacao}` }
    );
  await venda(ANA, "HP-ANA-1", "9001");
  await venda(ANA, "HP-ANA-2", "9002");
  await venda(BETO, "HP-BETO-1", "9001");
});

after(async () => {
  await falso.fechar();
});

/** A escola: o curso Bunker Members marcado; a Ana e o Beto com acesso aberto a ele; o Caio so com um curso comum. */
function escola() {
  return bancoEmMemoria({
    tabelas: {
      content_items: [
        { id: "curso-bm", kind: "Curso", title: "Bunker Members: instalação" },
        { id: "curso-a", kind: "Curso", title: "Curso A" }
      ],
      entitlements: [
        { ends_at: null, starts_at: "2026-11-01T00:00:00.000Z", status: "active", target_id: "curso-bm", user_id: ANA.id },
        { ends_at: null, starts_at: "2026-11-01T00:00:00.000Z", status: "active", target_id: "curso-bm", user_id: BETO.id },
        { ends_at: null, starts_at: "2026-11-01T00:00:00.000Z", status: "active", target_id: "curso-a", user_id: CAIO.id }
      ],
      license_products: [{ product_id: "curso-bm" }]
    }
  });
}

let db;

beforeEach(() => {
  process.env.EMISSOR_INTERNO_URL = falso.endereco;
  process.env.EMISSOR_INTERNO_CREDENCIAL = CREDENCIAL_DE_TESTE;
  delete process.env.BUNKER_LICENSING_MODE;
  sessao.licenca = { mode: "off" };
  sessao.usuario = ANA;
  db = escola();
  actionStubs.db = db;
  falso.proximas.length = 0;
  falso.pedidos.length = 0;
  student.forgetLicenseProductsMemory();
});

const escritas = () => db.chamadas.filter((chamada) => ["insert", "update", "upsert", "delete"].includes(chamada.op));
const pedidosA = (caminho) => falso.pedidos.filter((pedido) => pedido.caminho.endsWith(caminho));
const licencasDe = (pessoa) => simulador.inspect().licenses.filter((licenca) => licenca.owner === pessoa.id);

async function informarTitular(pessoa = ANA, dados = {}) {
  sessao.usuario = pessoa;
  return actions.saveLicenseHolder({ documento: CPF_VALIDO, email2: `financeiro.${pessoa.email}`, nome: "Escola da Ana Ltda", termos: true, ...dados });
}

/* ------------------------------------------------------------------------------------------------
 * Quem ve
 * ---------------------------------------------------------------------------------------------- */

test("só o comprador: sem acesso ao produto marcado, a página não existe, o menu não mostra e as ações respondem 404", async () => {
  sessao.usuario = CAIO;

  assert.equal(await student.getMyLicensesPage(CAIO), null);
  assert.equal(await student.readLicensesMenuVisible(CAIO.id, () => false), false);

  const respostas = [
    await actions.saveLicenseHolder({ documento: CPF_VALIDO, email2: "x@y.test", nome: "Caio", termos: true }),
    await actions.generateLicenseKey({ licenseId: "lic_sim00000001" }),
    await actions.revokeLicenseKey({ licenseId: "lic_sim00000001" })
  ];
  assert.deepEqual(respostas.map((resposta) => [resposta.ok, resposta.status]), [[false, 404], [false, 404], [false, 404]]);
  assert.equal(falso.pedidos.length, 0, "nada chega ao Emissor");

  // O acesso fechado tambem nao conta.
  db.linhas("entitlements").find((linha) => linha.user_id === ANA.id).status = "revoked";
  assert.equal(await student.getMyLicensesPage(ANA), null);
});

test("o menu: o item aparece só para o comprador, com as páginas de vendedor ligadas, e nunca na prévia da equipe", async () => {
  assert.equal(await student.readLicensesMenuVisible(ANA.id, (ids) => ids.includes("curso-bm")), true);
  assert.equal(await student.readLicensesMenuVisible(ANA.id, () => false), false);
  assert.equal(await student.readLicensesMenuVisible(null, () => true), false);

  const itens = (sinal, previa) => getMemberSidebarSections("/minhas-licencas", previa, undefined, { licenses: sinal }).flatMap((secao) => secao.items);
  assert.deepEqual(itens(true).find((item) => item.key === "licenses"), {
    active: true,
    description: "Suas licenças do Bunker Members",
    href: "/minhas-licencas",
    key: "licenses",
    label: "Minhas licenças"
  });
  assert.equal(itens(false).some((item) => item.key === "licenses"), false);
  assert.equal(itens(true, "student_with_access").some((item) => item.key === "licenses"), false, "a previa da equipe nunca abre Minhas licencas");
});

test("desligado (sem a configuração): nem a página, nem o menu, nem as ações; e nada é lido do banco", async () => {
  delete process.env.EMISSOR_INTERNO_URL;
  delete process.env.EMISSOR_INTERNO_CREDENCIAL;

  assert.equal(await student.getMyLicensesPage(ANA), null);
  assert.equal(await student.readLicensesMenuVisible(ANA.id, () => true), false);
  assert.equal((await actions.generateLicenseKey({ licenseId: "lic_sim00000001" })).status, 404);
  assert.deepEqual(db.chamadas, [], "nada lido nem gravado");
  assert.equal(falso.pedidos.length, 0);
});

test("sessão: sem login, 401; a classe atendimento para quando a licença desta Instalação não pode ser lida", async () => {
  sessao.usuario = null;
  assert.deepEqual(await actions.generateLicenseKey({ licenseId: "lic_sim00000001" }), {
    error: "Sua sessão terminou. Entre de novo para continuar.",
    ok: false,
    status: 401
  });

  sessao.usuario = ANA;
  sessao.licenca = null;
  const barrada = await actions.generateLicenseKey({ licenseId: "lic_sim00000001" });
  assert.deepEqual([barrada.ok, barrada.status], [false, 403]);
  assert.equal(falso.pedidos.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * O titular
 * ---------------------------------------------------------------------------------------------- */

test("CPF e CNPJ conferidos pelos dígitos (também o CNPJ alfanumérico); o resto é recusado", () => {
  for (const valido of [CPF_VALIDO, "52998224725", CNPJ_VALIDO, "11222333000181", CNPJ_ALFANUMERICO, "12abc34501de35"]) {
    assert.notEqual(holder.documentKindOf(valido), null, valido);
  }

  assert.equal(holder.documentKindOf(CPF_VALIDO), "cpf");
  assert.equal(holder.documentKindOf(CNPJ_ALFANUMERICO), "cnpj");

  for (const invalido of ["529.982.247-24", "111.111.111-11", "00000000000", "11.222.333/0001-82", "12.ABC.345/01DE-36", "AB.CDE.FGH/IJKL-MN", "1234", "", "529982247255"]) {
    assert.equal(holder.documentKindOf(invalido), null, invalido);
  }

  assert.equal(holder.maskedDocument("52998224725"), "CPF terminado em 25");
  assert.equal(holder.maskedDocument("11222333000181"), "CNPJ terminado em 81");
});

test("o titular: os campos conferidos aqui, o segundo e-mail diferente do da conta, o aceite pedido e a versão do servidor", async () => {
  const errado = await informarTitular(ANA, { documento: "123.456.789-00", email2: "ana@escola.test", nome: "A", termos: false });

  assert.deepEqual([errado.ok, errado.status], [false, 400]);
  assert.deepEqual(Object.keys(errado.fieldErrors).sort(), ["documento", "nome", "termos"]);
  assert.equal(errado.fieldErrors.documento[0], holder.HOLDER_MESSAGES.documento);
  assert.equal(errado.fieldErrors.termos[0], holder.HOLDER_MESSAGES.termos);

  const mesmoEmail = await informarTitular(ANA, { email2: "ANA@escola.test" });
  assert.deepEqual(mesmoEmail.fieldErrors, { email2: [holder.HOLDER_MESSAGES.email2Igual] });
  assert.equal(pedidosA("/titular").length, 0, "o que da para conferir aqui nem sai");

  const certo = await informarTitular(ANA, { documento: CNPJ_ALFANUMERICO });
  assert.deepEqual(certo, { data: { saved: true }, ok: true });
  const [chegou] = pedidosA("/titular");
  assert.equal(chegou.metodo, "PUT");
  assert.equal(chegou.caminho, `/interno/v1/clientes/${ANA.id}/titular`);
  assert.deepEqual(chegou.corpo, { aceiteTermos: { versao: LICENSE_TERMS_VERSION }, documento: "12ABC34501DE35", email2: "financeiro.ana@escola.test", nome: "Escola da Ana Ltda" });

  // A versao vem do servidor, mesmo se o navegador mandar outra.
  const outraVersao = await actions.saveLicenseHolder({ documento: CPF_VALIDO, email2: "f@escola.test", nome: "Escola", termos: true, versao: "v-falsa" });
  assert.equal(outraVersao.ok, true);
  assert.equal(pedidosA("/titular").at(-1).corpo.aceiteTermos.versao, LICENSE_TERMS_VERSION);
});

test("quando só os termos mudam: o aceite reaproveita o titular que o Emissor tem (o documento nunca vem do navegador)", async () => {
  await informarTitular(ANA);
  const pagina = await student.getMyLicensesPage(ANA);
  assert.equal(pagina.view.needsHolder, false);
  assert.equal(pagina.view.needsTerms, false);

  falso.pedidos.length = 0;
  const aceite = await actions.saveLicenseHolder({ somenteTermos: true, termos: true });

  assert.equal(aceite.ok, true);
  assert.deepEqual(pedidosA("/titular")[0].corpo, {
    aceiteTermos: { versao: LICENSE_TERMS_VERSION },
    documento: "52998224725",
    email2: "financeiro.ana@escola.test",
    nome: "Escola da Ana Ltda"
  });

  const semAceite = await actions.saveLicenseHolder({ somenteTermos: true, termos: false });
  assert.deepEqual(semAceite.fieldErrors, { termos: [holder.HOLDER_MESSAGES.termos] });
});

test("o Emissor recusa um campo do titular: a frase volta no campo; o cliente sem venda ouve que a compra está chegando", async () => {
  falso.proximas.push({ caminho: `/interno/v1/clientes/${ANA.id}/titular`, corpo: { campos: ["email2"], erro: "pedido_invalido", mensagem: "x" }, status: 400 });
  const recusa = await informarTitular(ANA);
  assert.deepEqual(recusa.fieldErrors, { email2: [holder.HOLDER_MESSAGES.email2Igual] });

  falso.proximas.push({ caminho: `/interno/v1/clientes/${ANA.id}/titular`, corpo: { erro: "cliente_desconhecido", mensagem: "x" }, status: 404 });
  const semVenda = await informarTitular(ANA);
  assert.equal(semVenda.error, studentModel.STUDENT_LICENSE_MESSAGES.conta);
});

/* ------------------------------------------------------------------------------------------------
 * A Chave
 * ---------------------------------------------------------------------------------------------- */

test("a Chave aparece uma vez, só na resposta da ação: nunca no banco, no HTML da página nem no log", async () => {
  await informarTitular(ANA);
  const [anual] = licencasDe(ANA);
  const logs = [];
  const originais = { error: console.error, info: console.info, log: console.log, warn: console.warn };

  for (const nivel of Object.keys(originais)) {
    console[nivel] = (...args) => logs.push(args.map(String).join(" "));
  }

  let gerada;
  let html;

  try {
    const escritasAntes = escritas().length;
    gerada = await actions.generateLicenseKey({ licenseId: anual.id });
    assert.equal(escritas().length, escritasAntes, "a acao nao grava nada no nosso banco");

    const pagina = await student.getMyLicensesPage(ANA);
    html = renderToStaticMarkup(createElement(LicensesView, { accountEmail: ANA.email, page: pagina }));
  } finally {
    Object.assign(console, originais);
  }

  assert.equal(gerada.ok, true);
  assert.equal(gerada.data.kind, "chave");
  assert.match(gerada.data.key, /^BKA-[0-9A-Z]{5}(?:-[0-9A-Z]{5}){5}$/);
  assert.equal(pedidosA("/chave")[0].corpo.areaUserId, ANA.id, "o pedido leva a conta da sessao");
  assert.equal(pedidosA("/chave")[0].corpo.confirmarTroca, undefined);

  assert.ok(!html.includes(gerada.data.key), "a pagina nunca escreve a Chave");
  assert.match(html, new RegExp(`terminada em ${gerada.data.key.slice(-4)}, esperando a instalação`), "so o final dela");
  assert.ok(!JSON.stringify(db.linhas("license_requests")).includes(gerada.data.key));
  assert.ok(logs.every((linha) => !linha.includes(gerada.data.key)), "nenhum log leva a Chave");
  assert.equal(licencasDe(ANA)[0].pendingKey.digest.length, 64, "o Emissor guarda so o resumo");
});

test("trocar a chave: sem confirmar, a ação devolve o que vai parar de funcionar; confirmando, a anterior deixa de valer", async () => {
  await informarTitular(ANA);
  const [anual] = licencasDe(ANA);
  const primeira = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.equal(simulador.simulateActivation(anual.id, "alunos.escola-da-ana.test"), true);

  const pagina = await student.getMyLicensesPage(ANA);
  const cartao = pagina.view.licenses.find((licenca) => licenca.id === anual.id);
  assert.deepEqual([cartao.canGenerate, cartao.canReplace, cartao.canRevoke], [false, true, true]);
  assert.match(cartao.replaceWarning, /a escola em alunos\.escola-da-ana\.test sai da Licença e fica congelada na próxima conferência/);
  assert.match(cartao.replaceWarning, /quem já é aluno continua com acesso/);
  assert.equal(cartao.installation.address, "alunos.escola-da-ana.test");

  const semConfirmar = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.deepEqual(semConfirmar.data, { address: "alunos.escola-da-ana.test", kind: "confirmar", pendingKeyFinal: null });

  const trocada = await actions.generateLicenseKey({ confirmReplace: true, licenseId: anual.id });
  assert.equal(trocada.data.kind, "chave");
  assert.notEqual(trocada.data.key, primeira.data.key);
  assert.equal(trocada.data.cutAddress, "alunos.escola-da-ana.test");
  assert.equal(pedidosA("/chave").at(-1).corpo.confirmarTroca, true);

  // Gerar de novo com a chave nova esperando: a confirmacao volta a ser pedida, agora pela chave.
  const outra = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.deepEqual(outra.data, { address: null, kind: "confirmar", pendingKeyFinal: trocada.data.key.slice(-4) });
});

test("revogar: a chave esperando e a instalação saem da Licença, e a página volta a oferecer Gerar chave", async () => {
  await informarTitular(ANA);
  const [anual] = licencasDe(ANA);
  await actions.generateLicenseKey({ licenseId: anual.id });
  simulador.simulateActivation(anual.id, "alunos.escola-da-ana.test");

  const revogada = await actions.revokeLicenseKey({ licenseId: anual.id });
  assert.deepEqual(revogada, { data: { canceledKeys: 0, cutAddress: "alunos.escola-da-ana.test" }, ok: true });

  const cartao = (await student.getMyLicensesPage(ANA)).view.licenses.find((licenca) => licenca.id === anual.id);
  assert.deepEqual([cartao.canGenerate, cartao.canReplace, cartao.canRevoke, cartao.key.state, cartao.installation], [true, false, false, "nenhuma", null]);
});

test("só o dono: a Licença de outra conta responde como inexistente, e nada chega ao Emissor para ela", async () => {
  const [daAna] = licencasDe(ANA);
  sessao.usuario = BETO;
  await informarTitular(BETO);
  falso.pedidos.length = 0;

  for (const resposta of [await actions.generateLicenseKey({ confirmReplace: true, licenseId: daAna.id }), await actions.revokeLicenseKey({ licenseId: daAna.id })]) {
    assert.deepEqual([resposta.ok, resposta.status, resposta.error], [false, 404, studentModel.STUDENT_LICENSE_MESSAGES.naoEncontrada]);
  }

  assert.equal(pedidosA("/chave").length + pedidosA("/revogar").length, 0, "o dono e conferido antes de qualquer pedido que muda");
  assert.ok(falso.pedidos.every((pedido) => pedido.caminho === `/interno/v1/clientes/${BETO.id}/licencas`), "so a lista do proprio Beto");

  const forjado = await actions.generateLicenseKey({ licenseId: "lic_../../vendas" });
  assert.deepEqual([forjado.ok, forjado.status], [false, 400]);
});

test("os erros do Emissor viram frases simples: fora do ar, limite, titular pendente; e a página fica sem botões", async () => {
  await informarTitular(ANA);
  const [anual] = licencasDe(ANA);

  falso.proximas.push({ caminho: `/interno/v1/clientes/${ANA.id}/licencas`, status: 503, texto: "" });
  const pagina = await student.getMyLicensesPage(ANA);
  assert.equal(pagina.view, null);
  assert.equal(pagina.emissorError, studentModel.STUDENT_LICENSE_MESSAGES.indisponivel);
  const html = renderToStaticMarkup(createElement(LicensesView, { accountEmail: ANA.email, page: pagina }));
  assert.match(html, /Licenças indisponíveis agora/);
  assert.doesNotMatch(html, />Gerar chave</);
  assert.match(html, /href="\/conteudo\/curso-bm"/, "o link da aula continua");

  falso.proximas.push({ caminho: `/interno/v1/licencas/${anual.id}/chave`, corpo: { erro: "limite_de_pedidos", mensagem: "x", tenteDeNovoEm: 60 }, status: 429 });
  const limite = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.deepEqual([limite.status, limite.error], [429, studentModel.STUDENT_LICENSE_MESSAGES.limite]);

  falso.proximas.push({ caminho: `/interno/v1/licencas/${anual.id}/chave`, corpo: { erro: "titular_pendente", falta: ["termos"], mensagem: "x" }, status: 409 });
  const pendente = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.equal(pendente.error, studentModel.STUDENT_LICENSE_MESSAGES.titular);

  falso.proximas.push({ caminho: `/interno/v1/licencas/${anual.id}/chave`, nuncaResponder: false, status: 200, texto: "{nao e json" });
  const invalida = await actions.generateLicenseKey({ licenseId: anual.id });
  assert.equal(invalida.error, studentModel.STUDENT_LICENSE_MESSAGES.indisponivel);
});

/* ------------------------------------------------------------------------------------------------
 * A pagina e a situacao
 * ---------------------------------------------------------------------------------------------- */

test("a página: o titular primeiro (antes da primeira chave), cada Licença com a situação, a validade e o Renovar, e o lugar da Instalação", async () => {
  // Uma compradora nova (o simulador e do arquivo inteiro: as outras ja informaram o titular).
  const DORA = { email: "dora@escola.test", id: "3e9f4f3e-4fad-4f8b-8c8c-6b6dbf405144" };
  await simulador.registerSale(
    { comprador: { areaUserId: DORA.id, email: DORA.email, nome: "Dora" }, compradoEm: "2026-11-11T12:00:00.000Z", garantiaAte: null, plataforma: "hotmart", produto: "9001", transacao: "HP-DORA-1" },
    { requestId: "venda-dora" }
  );
  db.linhas("entitlements").push({ ends_at: null, starts_at: "2026-11-01T00:00:00.000Z", status: "active", target_id: "curso-bm", user_id: DORA.id });
  sessao.usuario = DORA;

  const primeiroAcesso = await student.getMyLicensesPage(DORA);
  assert.deepEqual([primeiroAcesso.view.needsHolder, primeiroAcesso.view.needsTerms], [true, true]);
  const antes = renderToStaticMarkup(createElement(LicensesView, { accountEmail: DORA.email, page: primeiroAcesso }));
  assert.match(antes, /Titular da Licença/);
  assert.match(antes, /name="documento"/);
  assert.match(antes, new RegExp(`Versão ${LICENSE_TERMS_VERSION}`));
  assert.match(antes, /Diferente de dora@escola\.test/);

  await informarTitular(DORA);
  const pagina = await student.getMyLicensesPage(DORA);
  const html = renderToStaticMarkup(createElement(LicensesView, { accountEmail: DORA.email, page: pagina }));

  assert.doesNotMatch(html, /name="documento"/, "o formulario sai depois do titular");
  assert.match(html, /Licença anual/);
  assert.match(html, /O prazo começa em \d{2}\/\d{2}\/\d{4} ou quando você ativar/);
  assert.match(html, />Gerar chave</);
  assert.match(html, /href="https:\/\/pagamento\.exemplo\.test\/bunker-members\/renovar\/lic_sim\d+"/, "o Renovar da anual");
  assert.match(html, /Instalação/);
  assert.match(html, /o download do pacote e o comando de instalação ficam neste lugar/);
  assert.match(html, /CPF terminado em 25/);
  assert.doesNotMatch(html, /52998224725|529\.982\.247-25/, "o documento inteiro nunca vai para a pagina");
  assert.match(html, /Abrir a aula: Bunker Members: instalação/);
});

test("a situação de cada Licença em português simples, pelo calendário de Brasília", () => {
  const licenca = (extra = {}) => ({
    chave: { estado: "nenhuma", final: null, geradaEm: null, reservadaPara: null, validaAte: null },
    id: "lic_000000001",
    instalacao: null,
    links: { loja: null, renovar: "https://pagamento.exemplo.test/renovar" },
    modulos: [{ chave: "webinars", nome: "Webinários" }],
    prazoComecaEm: null,
    situacao: "ativa",
    tipo: "anual",
    trocasEm12Meses: 0,
    validade: "2027-11-10",
    ...extra
  });
  const situacao = (extra, hoje) => studentModel.licenseCardOf(licenca(extra), hoje).situation;

  assert.deepEqual(situacao({}, "2027-01-10"), { label: "Em dia", text: "Vale até 10/11/2027.", tone: "success" });
  assert.equal(situacao({}, "2027-10-20").label, "Vence em breve");
  assert.equal(situacao({}, "2027-11-10").label, "Vence em breve", "o ultimo dia ainda vale");
  assert.deepEqual(situacao({}, "2027-11-11"), {
    label: "Na carência",
    text: "Venceu em 10/11/2027. Até 25/11/2027 tudo continua funcionando; renove antes disso.",
    tone: "warning"
  });
  assert.equal(situacao({}, "2027-11-25").label, "Na carência");
  assert.equal(situacao({}, "2027-11-26").label, "Vencida");
  assert.match(situacao({}, "2027-11-26").text, /quem já é aluno continua com acesso/);
  assert.equal(situacao({ tipo: "vitalicia", validade: null }, "2030-01-01").text, "Licença vitalícia: não tem data de fim.");
  assert.match(situacao({ prazoComecaEm: "2026-12-11", validade: "2027-12-10" }, "2026-11-11").text, /O prazo de 12 meses começa em 11\/12\/2026/);
  assert.deepEqual([situacao({ situacao: "revogada" }, "2027-01-10").label, situacao({ situacao: "suspensa" }, "2027-01-10").label], ["Desfeita", "Em análise"]);
  assert.equal(situacao({ situacao: "nova_situacao" }, "2027-01-10").label, "Em atualização", "a situacao desconhecida nunca quebra a pagina");

  const desfeita = studentModel.licenseCardOf(licenca({ situacao: "revogada" }), "2027-01-10");
  assert.deepEqual([desfeita.canGenerate, desfeita.canReplace, desfeita.renewUrl], [false, false, null]);
  assert.equal(studentModel.licenseCardOf(licenca({ tipo: "vitalicia", validade: null }), "2027-01-10").renewUrl, null, "Renovar so na anual");
  assert.deepEqual(studentModel.licenseCardOf(licenca(), "2027-01-10").modules, ["Webinários"]);
});

test("na dev com o simulador: a compradora sem Licença ali ganha uma anual simulada, e a página avisa que é teste", async () => {
  delete process.env.EMISSOR_INTERNO_URL;
  delete process.env.EMISSOR_INTERNO_CREDENCIAL;
  process.env.EMISSOR_INTERNO_SIMULADOR = "on";
  const EVA = { email: "eva@escola.test", id: "4fa05f4e-5abe-4f9c-9d9d-7c7ec0516255" };
  db.linhas("entitlements").push({ ends_at: null, starts_at: "2026-11-01T00:00:00.000Z", status: "active", target_id: "curso-bm", user_id: EVA.id });
  sessao.usuario = EVA;

  try {
    const pagina = await student.getMyLicensesPage(EVA);
    assert.equal(pagina.simulator, true);
    assert.equal(pagina.view.licenses.length, 1);
    assert.equal(pagina.view.licenses[0].title, "Licença anual");
    assert.equal(falso.pedidos.length, 0, "nada vai ao Emissor (nem ao falso): o simulador e da memoria do processo");

    const html = renderToStaticMarkup(createElement(LicensesView, { accountEmail: EVA.email, page: pagina }));
    assert.match(html, /Ambiente de teste: estas licenças vêm do simulador/);

    // A segunda visita nao cria outra.
    assert.equal((await student.getMyLicensesPage(EVA)).view.licenses.length, 1);
  } finally {
    delete process.env.EMISSOR_INTERNO_SIMULADOR;
  }
});
