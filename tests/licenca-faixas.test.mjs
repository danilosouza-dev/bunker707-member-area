import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz, passosDaAnual } from "./support/licenca-de-teste.mjs";

// As faixas da Licença no admin e a tela Licença (docs/32 §2.2, §2.4 e §11.3), com licenças assinadas pelo dublê do
// Emissor e avaliadas pelo Verificador de verdade (computeLicenseState): uma faixa por situação (nunca ativada, a Licença
// anual perto do fim, na carência, vencida no 16º e no 46º dia, pagamento desfeito, sem contato, endereço diferente,
// licença ilegível, modo de observação, relógio errado), o que cada uma diz e os botões (Renovar com o endereço que chega
// na licença, Verificar agora e Ver a Licença só para o dono e os administradores); a tela com os dados e as ações de
// cada caso; e as frases de cada código de resultado. A faixa e a tela são montadas no servidor: nenhum JavaScript novo
// na moldura do admin.

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { computeLicenseState, EMPTY_LICENSE_SNAPSHOT } = await import("../src/server/licensing/state.ts");
const copy = await import("../src/server/licensing/copy.ts");
const { licenseScreenView, licenseHubStatusOf } = await import("../src/server/licensing/screen-view.ts");
const { licenseActionHref, licenseResultHref, parseLicenseScreenNotice } = await import("../src/server/licensing/screen-result.ts");
const { EMISSOR_ERROR_CODES } = await import("../src/server/licensing/client.ts");
const { LicenseBanner } = await import("../src/components/admin/v2/license/license-banner.tsx");
const { LicenseScreen } = await import("../src/components/admin/v2/license/license-screen.tsx");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const HOST = "alunos.escola.test";
const ENDERECO = `https://${HOST}`;
const VALIDADE = "2027-11-10T23:59:59-03:00";
const LINKS = { renew: "https://www.bunker707.test/minhas-licencas/lic_0001/renovar", store: "https://www.bunker707.test/modulos" };
const anual = { kind: "annual", validUntil: VALIDADE, steps: passosDaAnual(VALIDADE) };

/** A situação de uma Instalação com a licença dada, conferida agora (ou no instante dado), no endereço dado. */
function situacao(sobrescrever = {}, { agora = "2026-11-11T12:00:00.000Z", endereco = ENDERECO, snapshot = {} } = {}) {
  const issuedAt = sobrescrever.issuedAt ?? new Date(Date.parse(agora) - 60 * 60 * 1000).toISOString();
  const licenca = licencaBase({
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 90 * 24 * 60 * 60 * 1000).toISOString(),
    plan: anual,
    links: LINKS,
    ...sobrescrever
  });
  return computeLicenseState({
    mode: "enforce",
    roots: RAIZES,
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, everActivated: true, token: assinarLicenca(emissao, licenca), lastSeenAt: new Date(agora), ...snapshot },
    systemNow: new Date(agora),
    configuredHost: endereco
  });
}

const faixa = (estado, endereco = ENDERECO) => copy.licenseBannerOf(estado, { configuredHost: endereco });

/** A tag <input> do campo `nome` (o React escreve os atributos na ordem dele). */
function campo(desenho, nome) {
  const tag = [...desenho.matchAll(/<input[^>]*>/g)].map((match) => match[0]).find((item) => item.includes(`name="${nome}"`));
  assert.ok(tag, `o campo ${nome}`);
  return tag;
}
const html = (elemento) => renderToStaticMarkup(elemento);
const desenharFaixa = (modelo, canManage = true) =>
  html(createElement(LicenseBanner, { banner: modelo, canManage, checkNowAction: async () => {} }));

// ---- As faixas, situação por situação ------------------------------------------------------------------

test("sem faixa: Licença em dia, e o modo off (a nossa escola, a dev, os testes), que nem lê a licença", () => {
  assert.equal(faixa(situacao()), null);
  assert.equal(faixa({ mode: "off" }), null);
});

test("Instalação nunca ativada: a faixa leva a ativar (Ativar na tela Licença), sem Verificar agora", () => {
  const nunca = computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: new Date(), configuredHost: ENDERECO });
  const modelo = faixa(nunca);

  assert.equal(modelo.title, "Esta escola ainda não foi ativada");
  assert.equal(modelo.needsActivation, true);
  assert.equal(modelo.tone, "error");
  const desenho = desenharFaixa(modelo);
  assert.match(desenho, /<a[^>]*href="\/admin\/configuracoes\/licenca"[^>]*>Ativar<\/a>/);
  assert.doesNotMatch(desenho, /Verificar agora/);
});

test("Licença anual nos últimos 30 dias: Aviso com a data do fim, tudo funcionando, o próximo passo datado e o Renovar da licença", () => {
  const modelo = faixa(situacao({}, { agora: "2027-10-20T12:00:00.000Z" }));

  assert.equal(modelo.degree, "aviso");
  assert.equal(modelo.tone, "warning");
  assert.equal(modelo.title, "Aviso sobre a Licença");
  assert.deepEqual(modelo.lines, [
    "A sua Licença termina em 10/11/2027.",
    copy.LICENSE_DEGREE_MEANINGS.aviso,
    "A partir de 26/11/2027: Admin limitado (a equipe para de criar e publicar; os alunos seguem normalmente)."
  ]);
  assert.equal(modelo.renewUrl, LINKS.renew);
  assert.equal(modelo.lines.includes(copy.LICENSE_PAUSE_OFFERS), false, "a Licença em dia não pede para pausar ofertas");

  const desenho = desenharFaixa(modelo);
  assert.match(desenho, new RegExp(`<a[^>]*href="${LINKS.renew}"[^>]*rel="noopener noreferrer"[^>]*target="_blank"[^>]*>Renovar</a>`));
  assert.match(desenho, /<form[^>]*><button[^>]*type="submit"[^>]*>Verificar agora<\/button><\/form>/);
  assert.match(desenho, /<a[^>]*href="\/admin\/configuracoes\/licenca"[^>]*>Ver a Licença<\/a>/);
});

test("na carência: só o passo mais adiantado da anual (sem o 'termina em'), e tudo funciona", () => {
  const modelo = faixa(situacao({}, { agora: "2027-11-15T12:00:00.000Z" }));

  assert.equal(modelo.degree, "aviso");
  assert.equal(modelo.lines[0], "A sua Licença terminou em 10/11/2027. Nos 15 dias de carência, tudo continua funcionando.");
  assert.equal(modelo.lines.some((linha) => linha.includes("termina em")), false);
});

test("Admin limitado (16º dia) e Escola congelada (46º dia): o que vale, o próximo passo e o pedido para pausar as ofertas", () => {
  const limitado = faixa(situacao({}, { agora: "2027-12-01T12:00:00.000Z" }));
  assert.equal(limitado.title, "Licença: Admin limitado");
  assert.equal(limitado.tone, "error");
  assert.deepEqual(limitado.lines, [
    "A sua Licença terminou em 10/11/2027.",
    copy.LICENSE_DEGREE_MEANINGS.admin_limitado,
    "A partir de 26/12/2027: Escola congelada (ninguém ganha acesso novo; quem já é aluno continua com o que tem).",
    copy.LICENSE_PAUSE_OFFERS
  ]);

  const congelada = faixa(situacao({}, { agora: "2028-01-10T12:00:00.000Z" }));
  assert.equal(congelada.title, "Licença: Escola congelada");
  assert.deepEqual(congelada.lines, ["A sua Licença terminou em 10/11/2027.", copy.LICENSE_DEGREE_MEANINGS.escola_congelada, copy.LICENSE_PAUSE_OFFERS]);
  assert.match(copy.LICENSE_DEGREE_MEANINGS.escola_congelada, /Quem já é aluno continua/);
});

test("pagamento desfeito e Licença suspensa: o motivo em palavras simples e o pedido para pausar as ofertas já no Aviso", () => {
  const revogada = faixa(situacao({ statusSteps: [{ degree: "aviso", from: "2026-11-11T00:00:00-03:00", reason: "revogada" }, { degree: "admin_limitado", from: "2026-11-18T00:00:00-03:00", reason: "revogada" }] }));
  assert.equal(revogada.lines[0], "O pagamento da Licença foi desfeito (reembolso ou contestação).");
  assert.ok(revogada.lines.includes(copy.LICENSE_PAUSE_OFFERS));
  assert.ok(revogada.lines.includes("A partir de 18/11/2026: Admin limitado (a equipe para de criar e publicar; os alunos seguem normalmente)."));

  const suspensa = faixa(situacao({ statusSteps: [{ degree: "aviso", from: "2026-11-11T00:00:00-03:00", reason: "suspensa" }] }));
  assert.equal(suspensa.lines[0], "A Licença está suspensa enquanto uma análise é feita.");
});

test("sem contato com o Emissor desde o 8º dia: Aviso com a data do último contato", () => {
  const modelo = faixa(situacao({ issuedAt: "2026-11-01T12:00:00.000Z" }, { agora: "2026-11-11T12:00:00.000Z" }));

  assert.equal(modelo.degree, "aviso");
  assert.equal(modelo.lines[0], "Esta escola está sem contato com o Emissor de licenças desde 01/11/2026.");
});

test("endereço diferente do da licença: os dois endereços, e o acesso novo para já no Aviso", () => {
  const modelo = faixa(situacao({}, { endereco: "https://outra.escola.test" }), "https://outra.escola.test");

  assert.equal(modelo.degree, "aviso");
  assert.equal(modelo.lines[0], "Esta escola está no endereço outra.escola.test, e a Licença é do endereço alunos.escola.test.");
  assert.equal(modelo.lines[1], copy.LICENSE_NEW_ACCESS_STOPPED);
  assert.ok(modelo.lines.includes(copy.LICENSE_PAUSE_OFFERS));
});

test("licença guardada ilegível: Aviso, nenhum acesso novo, e a data desde quando", () => {
  const ilegivel = computeLicenseState({
    mode: "enforce",
    roots: RAIZES,
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, everActivated: true, token: "BKL1.estragada", unreadableSince: new Date("2026-11-09T12:00:00.000Z") },
    systemNow: new Date("2026-11-11T12:00:00.000Z"),
    configuredHost: ENDERECO
  });
  const modelo = faixa(ilegivel);

  assert.equal(modelo.degree, "aviso");
  assert.equal(modelo.lines[0], "A licença guardada não pôde ser conferida (desde 09/11/2026).");
  assert.equal(modelo.lines[1], copy.LICENSE_NEW_ACCESS_STOPPED);
  assert.equal(modelo.renewUrl, null, "sem licença legível, sem o endereço do Renovar");
});

test("modo de observação do lote fundador: avisa o degrau calculado da validade e diz que nada foi limitado", () => {
  const estado = situacao({ observeUntil: "2028-01-15T00:00:00-03:00" }, { agora: "2027-12-28T12:00:00.000Z" });
  const modelo = faixa(estado);

  assert.equal(estado.evaluation.degree, "escola_congelada", "a anual vencida há mais de 45 dias");
  assert.equal(estado.evaluation.enforcedDegree, "aviso");
  assert.equal(modelo.title, "Modo de observação da Licença");
  assert.equal(modelo.tone, "warning");
  assert.ok(modelo.lines.some((linha) => linha.startsWith("Modo de observação até 15/01/2028") && linha.includes("nada foi limitado") && linha.endsWith("estaria em Escola congelada.")));
});

test("modo de observação com uma ordem do Emissor: a faixa diz o que vale pela ordem, e nunca que nada foi limitado", () => {
  const ordem = { observeUntil: "2028-01-15T00:00:00-03:00", statusSteps: [{ degree: "admin_limitado", from: "2027-12-20T00:00:00-03:00", reason: "suspensa" }] };
  const estado = situacao(ordem, { agora: "2027-12-28T12:00:00.000Z" });
  const modelo = faixa(estado);

  assert.equal(estado.evaluation.degree, "escola_congelada");
  assert.equal(estado.evaluation.enforcedDegree, "admin_limitado");
  assert.equal(modelo.tone, "error");
  assert.ok(modelo.lines.includes(copy.LICENSE_DEGREE_MEANINGS.admin_limitado));
  assert.ok(modelo.lines.some((linha) => linha.startsWith("Modo de observação até 15/01/2028: as ordens do Emissor de licenças valem") && linha.endsWith("estaria em Escola congelada.")));
  assert.ok(modelo.lines.every((linha) => !linha.includes("nada foi limitado")));

  // Só a ordem, sem nada da validade: a faixa de sempre do degrau que vale.
  const soOrdem = faixa(situacao({ observeUntil: "2027-01-01T00:00:00-03:00", statusSteps: [{ degree: "escola_congelada", from: "2026-11-01T00:00:00-03:00", reason: "desativada" }] }));
  assert.equal(soOrdem.title, "Licença: Escola congelada");
});

test("relógio do servidor errado: faixa própria; até 48 h adiantado, nunca um degrau, e a faixa diz o preço de passar disso", () => {
  const agora = "2026-11-11T12:00:00.000Z";
  const estado = situacao({}, { agora, snapshot: { lastCheckIn: { emissorTime: new Date("2026-11-08T12:00:00.000Z"), localTime: new Date("2026-11-11T11:00:00.000Z") } } });
  const modelo = faixa(estado);

  assert.equal(estado.evaluation.degree, "ok");
  assert.equal(modelo.title, "O relógio deste servidor está errado");
  assert.match(modelo.lines[0], /Nada foi limitado/);
  assert.match(modelo.lines[0], /adiantado mais de 48 horas adianta os prazos/);
});

test("quem não é dono nem administrador lê a faixa e não recebe os botões; nenhuma faixa promete bloquear a escola", () => {
  const modelo = faixa(situacao({}, { agora: "2027-12-01T12:00:00.000Z" }));
  const desenho = desenharFaixa(modelo, false);

  assert.match(desenho, /Avise o dono ou um administrador da escola\./);
  assert.doesNotMatch(desenho, /Verificar agora|Renovar|<form/);

  for (const texto of [...Object.values(copy.LICENSE_DEGREE_MEANINGS), copy.LICENSE_NEW_ACCESS_STOPPED, copy.LICENSE_PAUSE_OFFERS]) {
    assert.doesNotMatch(texto, /bloquead/i);
  }
});

test("a faixa é montada no servidor, some no console em tela cheia e não muda a moldura do navegador", () => {
  const desenho = desenharFaixa(faixa(situacao({}, { agora: "2027-10-20T12:00:00.000Z" })));
  assert.match(desenho, /data-license-banner="aviso"/);
  assert.match(desenho, /\[body:not\(:has\(#admin-sidebar\)\)_&amp;\]:hidden/);

  const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
  for (const caminho of ["src/components/admin/v2/license/license-banner.tsx", "src/components/admin/v2/license/license-screen.tsx", "src/components/admin/v2/license/styles.ts"]) {
    assert.doesNotMatch(ler(caminho), /^["']use client["'];/m, caminho);
  }
  assert.match(ler("src/components/admin/v2/license/license-submit-button.tsx"), /^"use client";/m, "só o botão de envio da tela é do navegador");
  assert.doesNotMatch(ler("src/components/admin/v2/license/license-banner.tsx"), /license-submit-button|@\/components\/ui\//, "a faixa não puxa componente do navegador");
  assert.doesNotMatch(ler("src/components/admin/v2/admin-shell.tsx"), /LicenseBanner|license-banner|licenseBanner|checkLicenseNow/, "a moldura do navegador não leva a faixa");
  assert.match(ler("src/components/admin/v2/admin-shell.tsx"), /id=\{SIDEBAR_ID\}/);
  assert.match(ler("src/components/admin/v2/admin-shell.tsx"), /const SIDEBAR_ID = "admin-sidebar";/, "o seletor da faixa depende deste id");

  const layout = ler("src/app/admin/(v2)/layout.tsx");
  assert.match(layout, /licenseBanner \? <LicenseBanner banner=\{licenseBanner\} canManage=\{isLicenseManager\(access\)\} checkNowAction=\{checkLicenseNow\} \/> : null\}\s*\{children\}/);
});

// ---- A tela Licença ----------------------------------------------------------------------------------

const ACOES = { activate: async () => {}, checkNow: async () => {}, deactivate: async () => {}, uploadFile: async () => {} };

function tela(estado, extra = {}) {
  const view = licenseScreenView({
    state: estado,
    installationId: "inst_0001",
    hasInstallationCredentials: true,
    lastAttempt: { at: null, result: "ok" },
    configuredHost: ENDERECO,
    version: "1.4.0",
    ...extra
  });
  return { view, desenho: html(createElement(LicenseScreen, { actions: ACOES, notice: extra.notice ?? null, view })) };
}

test("a tela em dia: Licenciado para, tipo e validade, endereço, último contato, módulos, versão, Verificar agora, Renovar e Desativar", () => {
  const { view, desenho } = tela(situacao({}, { agora: "2026-11-11T12:00:00.000Z" }));

  assert.equal(view.degreeLabel, "Em dia");
  assert.equal(view.holder, "Escola de Teste Ltda");
  assert.equal(view.kind, "Anual");
  assert.equal(view.validUntil, "10/11/2027");
  assert.equal(view.lastContact, "11/11/2026 08:00", "a emissão assinada, no horário de Brasília");
  assert.deepEqual(view.modules, ["Webinários"]);

  for (const texto of ["Licenciado para", "Escola de Teste Ltda", "Anual", "10/11/2027", HOST, "11/11/2026 08:00", "Webinários", "1.4.0", "Verificar agora", "Desativar esta Instalação", "Ativar de novo com outra Chave de ativação"]) {
    assert.ok(desenho.includes(texto), texto);
  }
  assert.match(desenho, new RegExp(`href="${LINKS.renew}"`));
  const confirmar = campo(desenho, "confirmar");
  for (const atributo of ['type="checkbox"', 'value="desativar"', 'required=""']) {
    assert.ok(confirmar.includes(atributo), atributo);
  }
  assert.match(desenho, /Desativar coloca esta escola, na hora, em Escola congelada/);
  assert.match(desenho, /<details[^>]*><summary[^>]*>.*Desativar esta Instalação<\/summary>/s, "a confirmação fica fechada até abrir");
});

test("a tela da Instalação nunca ativada: ativação e licença por arquivo abertas; sem Verificar agora nem Desativar", () => {
  const nunca = computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: new Date(), configuredHost: ENDERECO });
  const { view, desenho } = tela(nunca, { installationId: null, hasInstallationCredentials: false, lastAttempt: { at: null, result: null } });

  assert.equal(view.degree, "nao_ativada");
  assert.match(desenho, /<details[^>]*open=""[^>]*><summary[^>]*>.*Ativar com a Chave de ativação/s);
  assert.ok(campo(desenho, "chave").includes('required=""'));
  assert.ok(campo(desenho, "arquivo").includes('type="file"'));
  assert.match(desenho, /<textarea[^>]*name="texto"/);
  assert.doesNotMatch(desenho, /Verificar agora|Desativar esta Instalação/);
});

test("a tela com licença por arquivo, endereço diferente, desativada e a última conferência que falhou", () => {
  const arquivo = tela(situacao({ delivery: "file" }));
  assert.match(arquivo.desenho, /Licença por arquivo, sem conferência pela internet/);

  const outroEndereco = tela(situacao({}, { endereco: "https://outra.escola.test" }), { configuredHost: "https://outra.escola.test" });
  assert.equal(outroEndereco.view.hostMismatch, true);
  assert.match(outroEndereco.desenho, /Esta escola está configurada em outra\.escola\.test\./);

  const desativada = tela(situacao({ statusSteps: [{ degree: "escola_congelada", from: "2026-11-11T11:00:00.000Z", reason: "desativada" }] }));
  assert.equal(desativada.view.degree, "escola_congelada");
  assert.doesNotMatch(desativada.desenho, /Desativar esta Instalação/, "já desativada: o botão some");
  assert.match(desativada.desenho, /Esta Instalação foi desativada\./);

  const falhou = tela(situacao(), { lastAttempt: { at: new Date("2026-11-11T13:00:00.000Z"), result: "sem_resposta" } });
  assert.match(falhou.desenho, /Última tentativa de conferência, em 11\/11\/2026 10:00: Sem resposta do Emissor de licenças/);

  const vitalicia = tela(situacao({ plan: { kind: "lifetime", steps: [] } }));
  assert.match(vitalicia.desenho, /Vitalícia/);
  assert.match(vitalicia.desenho, /Sem data de fim/);
  assert.equal(licenseScreenView({ state: { mode: "off" }, installationId: null, hasInstallationCredentials: false, lastAttempt: { at: null, result: null }, configuredHost: null, version: null }), null);
});

test("o resultado de cada ação volta pelo endereço só como código: cada código do Emissor, do cliente e da tela tem a sua frase", () => {
  for (const codigo of [...EMISSOR_ERROR_CODES, "licenca_antiga", "outra_instalacao", "tentativa_substituida", "nao_e_arquivo", "endereco_diferente", "em_andamento", "disputada", "sem_instalacao", "relogio_invalido"]) {
    assert.ok(copy.isLicenseResultCode(codigo), codigo);
    assert.notEqual(copy.licenseResultMessage(codigo).text, copy.licenseResultMessage("falhou").text, `${codigo} tem frase própria`);
  }

  assert.equal(licenseResultHref({ code: "vaga_em_uso", host: "membros.escola.test" }), "/admin/configuracoes/licenca?resultado=vaga_em_uso&endereco=membros.escola.test");
  assert.equal(licenseResultHref({ code: "<script>", host: "<b>" }), "/admin/configuracoes/licenca?resultado=falhou");
  assert.equal(licenseActionHref({ ok: false, status: 500, error: "x" }, "chave_mal_formada"), "/admin/configuracoes/licenca?resultado=falhou");

  const vaga = parseLicenseScreenNotice({ resultado: "vaga_em_uso", endereco: "membros.escola.test" });
  assert.equal(vaga.result.text, "A Licença já está em uso no endereço membros.escola.test. Desative a Instalação de lá, ou compre outra Licença.");

  const espera = parseLicenseScreenNotice({ resultado: "limite_de_pedidos", espera: "125" });
  assert.match(espera.result.text, /Espere 3 minutos/);

  const injetado = parseLicenseScreenNotice({ resultado: "texto qualquer <script>", endereco: "<script>alert(1)</script>" });
  assert.equal(injetado.result.text, copy.licenseResultMessage("falhou").text);

  const ativada = parseLicenseScreenNotice({ resultado: "ativada", aviso: "portas_fechadas" });
  assert.equal(ativada.result.tone, "success");
  assert.equal(ativada.note.tone, "warning");
  assert.equal(parseLicenseScreenNotice({}), null);

  const desenho = tela(situacao(), { notice: ativada }).desenho;
  assert.match(desenho, /role="status"[^>]*>.*Pronto: esta escola está ativada\./s);
  assert.match(desenho, /firewall/);
});

test("a linha do hub de Configurações: a validade em dia, o degrau quando não está; no modo off, nenhuma", () => {
  assert.deepEqual(licenseHubStatusOf(situacao()), { label: "Até 10/11/2027", tone: "success" });
  assert.deepEqual(licenseHubStatusOf(situacao({}, { agora: "2027-12-01T12:00:00.000Z" })), { label: "Admin limitado", tone: "error" });
  assert.deepEqual(licenseHubStatusOf(situacao({ plan: { kind: "lifetime", steps: [] } })), { label: "Vitalícia", tone: "success" });
  assert.equal(licenseHubStatusOf({ mode: "off" }), null);
});
