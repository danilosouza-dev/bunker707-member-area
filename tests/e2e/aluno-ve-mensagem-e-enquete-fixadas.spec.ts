import type { Browser, Page } from "@playwright/test";
import { abrirComoProdutor, contaDeTeste, expect, paginaFalsaPlayerJs, test, zerarHistoricoDeWebinarios } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";

// A mensagem e a enquete fixadas e a moderacao por pessoa na Live gravada (docs/30 §1.6, §2.4 e §8.3; docs/31 §12;
// especificacao de 10/11/2026, R1, R2, R5, §3.1 e §3.8), com dois contextos: o produtor no console da sessao no ar e a
// aluna na sala (1280 px).
// - Fixar ao enviar com um link: o console mostra o bloco Fixada agora; a aluna ve a fixada em ate 8 s na aba Perguntas
//   (a area das fixadas e do painel, em toda aba), com o link clicavel em outra aba; com o painel fechado, a pilula
//   "Fixada · ..." no palco e um botao que abre o painel no Chat.
// - Abrir e fixar a enquete pronta: a enquete abre no meio do palco, "Responder depois" a manda para a area das fixadas
//   (sem o card "deixou para depois"), e a aluna responde ali mesmo; a linha recolhe em "Resposta enviada".
// - Silenciar ate o fim pelo ⋯ da mensagem da aluna: a proxima mensagem e recusada e o campo da lugar a "Você está sem
//   escrever no chat até o fim desta live."; o bloco Removidos, silenciados e banidos mostra a aluna; o Desfazer devolve
//   o campo. Remover da sala: a proxima escrita tira a aluna da sala com "Você foi removido desta live.", a pagina da
//   sala recusa a entrada com a mesma frase, e o Desfazer devolve a sala.

const { id: webinarId, sessaoId, slug, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
const CONSOLE = `/admin/comunicacao/webinarios/${webinarId}/sala?sessao=${sessaoId}`;
const naTela = WEBINAR_COPY.naTela;
const aoVivo = WEBINAR_COPY.aoVivo;
const LINK = "https://material.bunker707.test/apostila";
const FIXADA = `A apostila da aula está aqui: ${LINK}`;
const ENQUETE = { opcoes: ["Sim", "Não"], pergunta: "Você vem na próxima aula?" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  // Uma enquete pronta (modelo, sem sessao) da Live gravada, como o editor salva.
  const pronta = unwrap(
    await db.from("webinar_polls").insert({ anonymous: false, kind: "single", position: 0, question: ENQUETE.pergunta, session_id: null, status: "draft", webinar_id: webinarId }).select("id").single(),
    "Gravando a enquete pronta de teste"
  ) as { id: string };
  unwrap(await db.from("webinar_poll_options").insert(ENQUETE.opcoes.map((label, position) => ({ label, poll_id: pronta.id, position }))), "Gravando as opcoes da enquete pronta");
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

async function entrarNaSala(page: Page) {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await page.getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();
  await sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.ativarSom }).click();
  return sala;
}

async function abrirConsole(browser: Browser) {
  const produtor = await abrirComoProdutor(browser);
  const console = produtor.pagina;
  await console.goto(CONSOLE);
  await console.waitForLoadState("networkidle");
  await expect(console.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();
  return { console, fechar: produtor.fechar };
}

/** O item do trilho a direita da sala pelo comeco do nome (a aba). */
function itemDoTrilho(sala: ReturnType<Page["getByRole"]>, rotulo: string) {
  return sala.getByRole("navigation", { name: WEBINAR_COPY.salaV2.painel.rotulo }).getByRole("button", { name: new RegExp(`^${rotulo}`) });
}

test("Fixar ao enviar com um link: o console mostra Fixada agora; a aluna ve a fixada na aba Perguntas com o link clicavel e, com o painel fechado, a pilula que abre o Chat", async ({ browser, page }) => {
  const sala = await entrarNaSala(page);
  const { console, fechar } = await abrirConsole(browser);
  try {
    const campo = console.getByPlaceholder("Escreva para a turma");
    await campo.fill(FIXADA);
    const fixarAoEnviar = console.getByRole("button", { exact: true, name: naTela.chat.fixarAoEnviar });
    await expect(fixarAoEnviar).toHaveAttribute("aria-pressed", "false");
    await fixarAoEnviar.click();
    await expect(fixarAoEnviar).toHaveAttribute("aria-pressed", "true");
    await console.getByRole("button", { exact: true, name: "Enviar" }).click();
    await expect(console.getByText(naTela.console.avisos.mensagemFixada)).toBeVisible();
    const fixadaAgora = console.getByRole("region", { name: naTela.chat.fixadaAgora });
    await expect(fixadaAgora).toBeVisible();
    await expect(fixadaAgora.getByRole("link", { exact: true, name: LINK })).toHaveAttribute("href", LINK);
    await expect(fixadaAgora.getByRole("button", { exact: true, name: naTela.chat.desafixar })).toBeVisible();
    // A pilula desliga sozinha depois do envio.
    await campo.fill("outra mensagem");
    await expect(console.getByRole("button", { exact: true, name: naTela.chat.fixarAoEnviar })).toHaveAttribute("aria-pressed", "false");
    await campo.fill("");
  } finally {
    await fechar();
  }

  // Na aba Perguntas, a area das fixadas do painel mostra a mensagem com o link da equipe.
  await itemDoTrilho(sala, WEBINAR_COPY.sala.abas.perguntas).click();
  const fixada = sala.getByTestId("room-pinned").filter({ visible: true });
  await expect(fixada).toBeVisible({ timeout: 8_000 });
  await expect(fixada.getByText(naTela.aluno.fixadaPelaEquipe)).toBeVisible();
  const link = fixada.getByRole("link", { exact: true, name: LINK });
  await expect(link).toHaveAttribute("href", LINK);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");

  // O painel fechado: a pilula no palco largo e um botao que abre o painel no Chat.
  await itemDoTrilho(sala, WEBINAR_COPY.sala.abas.perguntas).click();
  await expect(sala.getByTestId("room-panel")).toBeHidden();
  const pilula = sala.locator("[data-room-pinned-pill='message']");
  await expect(pilula).toBeVisible();
  await expect(pilula).toHaveJSProperty("tagName", "BUTTON");
  await expect(pilula).toContainText("Fixada · ");
  await pilula.click();
  await expect(sala.getByTestId("room-panel")).toBeVisible();
  await expect(itemDoTrilho(sala, WEBINAR_COPY.sala.abas.chat)).toHaveAttribute("aria-expanded", "true");
  await expect(sala.getByTestId("room-pinned").filter({ visible: true }).getByRole("link", { exact: true, name: LINK })).toBeVisible();
});

test("Abrir e fixar a enquete: Responder depois a manda para a area das fixadas e a aluna responde pelo painel; a linha recolhe em Resposta enviada", async ({ browser, page }) => {
  const sala = await entrarNaSala(page);
  const { console, fechar } = await abrirConsole(browser);
  try {
    await console.locator("[data-console-more-trigger]").click();
    await console.getByRole("menuitemradio", { exact: true, name: WEBINAR_COPY.consoleV2.entradas.enquetes }).click();
    const enquetes = console.getByRole("region", { name: "Enquetes" });
    await enquetes.getByRole("button", { exact: true, name: naTela.enquetes.abrirEFixar }).click();
    await expect(console.getByText(naTela.console.avisos.enqueteFixada)).toBeVisible();
    await expect(enquetes.getByText(naTela.enquetes.fixada, { exact: true })).toBeVisible();
    await expect(enquetes.getByRole("button", { exact: true, name: naTela.enquetes.desafixar })).toBeVisible();
  } finally {
    await fechar();
  }

  // A enquete abre uma vez no meio do palco; Responder depois a manda para a area das fixadas.
  const noPalco = sala.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.enquete.responderDepois });
  await expect(noPalco).toBeVisible({ timeout: 15_000 });
  await noPalco.click();
  await expect(sala.getByText(WEBINAR_COPY.salaV2.enquete.deixouParaDepois)).toHaveCount(0);
  const fixada = sala.getByTestId("room-pinned-poll").filter({ visible: true });
  await expect(fixada).toBeVisible();
  await expect(fixada.getByText(naTela.aluno.enqueteFixadaPelaEquipe)).toBeVisible();
  // As opcoes num grupo com o nome da pergunta (o legend so para o leitor de tela).
  const opcoes = fixada.getByRole("group", { name: ENQUETE.pergunta });
  await expect(opcoes).toBeVisible();
  await opcoes.getByRole("radio", { name: "Sim" }).check();
  const resposta = page.waitForResponse((response) => response.url().endsWith("/polls") && response.request().method() === "POST");
  await fixada.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.enquete.enviar }).click();
  expect((await resposta).status()).toBe(201);
  // Respondida, a enquete recolhe numa linha (anunciada) com o Mostrar; o cartao com as opcoes fica fechado.
  await expect(fixada.getByText(naTela.aluno.respostaEnviada).filter({ visible: true })).toHaveAttribute("aria-live", "polite");
  const mostrar = fixada.getByRole("button", { exact: true, name: naTela.aluno.mostrar });
  await expect(mostrar).toHaveAttribute("aria-expanded", "false");
  await expect(opcoes).toBeHidden();
  await mostrar.click();
  await expect(fixada.getByRole("button", { exact: true, name: naTela.aluno.recolher })).toHaveAttribute("aria-expanded", "true");
  await expect(opcoes).toBeVisible();

  const aluna = await contaDeTeste("aluna");
  const respostas = unwrap(await createLocalAdminClient().from("webinar_poll_answers").select("poll_id").eq("user_id", aluna.id), "Lendo as respostas da aluna") as { poll_id: string }[];
  expect(respostas).toHaveLength(1);
});

test("moderacao na Live gravada: Silenciar ate o fim troca o campo pela frase; Remover da sala tira a aluna e a pagina recusa a entrada; o Desfazer devolve", async ({ browser, page }) => {
  let sala = await entrarNaSala(page);
  const campo = () => sala.getByRole("textbox", { name: "Escreva uma mensagem" });
  await campo().fill("Boa noite, equipe!");
  await campo().press("Enter");
  const aceite = sala.getByRole("group", { name: /Ao enviar mensagens neste chat/ });
  if (await aceite.isVisible().catch(() => false)) {
    await aceite.getByRole("button", { exact: true, name: "Entendi e quero participar" }).click();
  }
  await expect(sala.getByRole("log").getByText("Boa noite, equipe!")).toBeVisible();

  const { console, fechar } = await abrirConsole(browser);
  try {
    const chat = console.getByRole("log", { name: "Chat" });
    const daAluna = chat.locator("li").filter({ hasText: "Boa noite, equipe!" }).first();
    await expect(daAluna).toBeVisible({ timeout: 15_000 });
    await daAluna.hover();
    const mais = daAluna.getByRole("button", { name: /^Mais ações da mensagem de / });
    await mais.click();
    await console.getByRole("menuitem", { exact: true, name: WEBINAR_COPY.consoleAoVivo.silenciarNoChat.fim }).click();
    const barrados = console.locator("[data-live-barred]");
    await expect(barrados).toBeVisible({ timeout: 10_000 });
    await expect(barrados).toContainText(WEBINAR_COPY.consoleAoVivo.removidosESilenciados);

    // A proxima mensagem e recusada (409 muted) e o campo da lugar a frase.
    await campo().fill("posso falar?");
    await campo().press("Enter");
    await expect(sala.getByText(aoVivo.silenciadoAteOFim)).toBeVisible();
    await expect(campo()).toHaveCount(0);

    // O Desfazer: a aluna volta a escrever (na leitura seguinte; aqui, ao abrir a sala de novo).
    await barrados.getByRole("button", { name: /^Desfazer: / }).click();
    await expect(barrados).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    sala = page.getByRole("dialog", { name: titulo });
    await expect(campo()).toBeVisible({ timeout: 15_000 });

    // Remover da sala: a proxima escrita tira a aluna, e a pagina da sala recusa a entrada com a mesma frase.
    await daAluna.hover();
    await daAluna.getByRole("button", { name: /^Mais ações da mensagem de / }).click();
    await console.getByRole("menuitem", { exact: true, name: WEBINAR_COPY.consoleAoVivo.removerDaSala }).click();
    await expect(barrados).toBeVisible({ timeout: 10_000 });
    await campo().fill("ainda estou aqui");
    await campo().press("Enter");
    await expect(sala.getByText(aoVivo.removido)).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByText(aoVivo.removido)).toBeVisible();
    await expect(page.getByRole("dialog", { name: titulo })).toHaveCount(0);

    await barrados.getByRole("button", { name: /^Desfazer: / }).click();
    await expect(barrados).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await expect(page.getByRole("dialog", { name: titulo })).toBeVisible({ timeout: 15_000 });
  } finally {
    await fechar();
  }
});
