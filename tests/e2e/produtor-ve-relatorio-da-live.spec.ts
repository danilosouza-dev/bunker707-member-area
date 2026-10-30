import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFile } from "node:fs/promises";
import { LIVE_GRAVADA_DE_TESTE, contasDeTeste, limparWebinarios, seedLiveGravadaEncerradaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// A aba Relatorio do webinario no navegador (docs/30 §2.5, §3.4 e §3.7; docs/18 §3.2): o produtor abre o relatorio
// de uma Live gravada ja encerrada da escola de teste (a curva congelada e a lista por aluno gravadas pela seed) e
// ve a sessao marcada no seletor, os numeros, a curva "Presentes minuto a minuto" em grafico e em tabela, a lista por
// aluno com o nome da aluna e baixa o CSV pela rota; a 375 px a pagina nao rola de lado. Fase 4 (docs/30 §3.7): o botao
// Exportar abre o menu com os relatorios nos nomes do Zoom e o Q&A baixa com o cabecalho certo e a pergunta da aluna
// (o botao com 44 px a 375 px); sem login, a rota do CSV responde 401 (contexto com storageState vazio).

const { id, sessaoId, titulo } = LIVE_GRAVADA_DE_TESTE;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await limparWebinarios(db);
  await seedLiveGravadaEncerradaDeTeste(db);
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

/** A pagina nao rola de lado (lida ate o desenho parar de mudar). */
async function semRolagemLateral(page: Page) {
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("abre o relatório da sessão encerrada: números, curva em gráfico e em tabela, lista por aluno e o CSV; 375 px sem rolar de lado", async ({ page }) => {
    await page.goto(`/admin/comunicacao/webinarios/${id}/relatorio`);
    await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
    await expect(page.getByText("Os números da sessão escolhida, só de alunos. Atualiza a cada minuto.", { exact: true })).toBeVisible();

    // O seletor: a sessao encerrada e a unica e esta marcada; o endereco dela leva ?sessao=.
    const seletor = page.getByRole("navigation", { name: "Sessão" });
    const marcada = seletor.locator('a[aria-current="page"]');
    await expect(marcada).toContainText("Sessão ·");
    expect(await marcada.getAttribute("href")).toBe(`/admin/comunicacao/webinarios/${id}/relatorio?sessao=${sessaoId}`);
    await expect(page.getByText("Encerrada", { exact: true })).toBeVisible();

    // Os numeros (role="group" com "rotulo, valor, definicao").
    await expect(page.getByRole("group", { name: /^Vagas garantidas, 2,/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Compareceram, 2,/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Taxa de comparecimento, 100/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Pico de presentes, 2,/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Até o fim, 50/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Mensagens, 2,/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Reações, 1,/ })).toBeVisible();

    // A curva: o SVG acessivel com o resumo, e a tabela por minuto no lugar dele.
    const curva = page.getByRole("region", { name: "Presentes minuto a minuto" });
    // A media vem da RPC (arredondada): 10 baldes com 2 e 50 com 1 dao 1,17 -> 1.
    await expect(curva.getByRole("img", { name: /^Pico de 2 às 00:00; média de 1 presentes\./ })).toBeVisible();
    // A queda aparece na lista "Maiores quedas" (o mesmo texto tambem e o <title> do ponto no SVG).
    await expect(curva.getByRole("list", { name: "Maiores quedas" }).getByText("05:00 · 1 saiu", { exact: true })).toBeVisible();
    await curva.getByRole("button", { name: "Ver como tabela" }).click();
    const tabela = curva.getByRole("table", { name: "Presentes minuto a minuto" });
    await expect(tabela).toBeVisible();
    await expect(tabela.getByRole("columnheader", { name: "Minuto" })).toBeVisible();
    await expect(tabela.getByRole("row").filter({ has: page.getByRole("cell", { exact: true, name: "00:00" }) })).toContainText("2");
    await curva.getByRole("button", { name: "Ver como gráfico" }).click();
    await expect(curva.getByRole("img")).toBeVisible();

    // O chat e a lista por aluno trazem o nome da aluna (de profiles), nunca o e-mail.
    await expect(page.getByRole("region", { name: "Chat" }).getByRole("link", { name: "Aluna de Teste" }).first()).toBeVisible();
    const lista = page.getByRole("region", { name: "Lista por aluno" });
    await expect(lista.getByRole("link", { name: "Aluna de Teste" })).toBeVisible();
    await expect(lista.getByRole("link", { name: "Aluno Sem Acesso" })).toBeVisible();
    await expect(page.getByText("aluna.teste@bunker707.test")).toHaveCount(0);

    // Baixar CSV: a rota serve o arquivo com as colunas do Zoom e o nome e o e-mail da aluna.
    const baixar = lista.getByRole("link", { name: "Baixar CSV" });
    const href = await baixar.getAttribute("href");
    expect(href).toBe(`/api/admin/webinars/${id}/relatorio/csv?sessao=${sessaoId}`);
    const csv = await page.request.get(href!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("-attendee.csv");
    const corpo = await csv.text();
    expect(corpo).toContain("Compareceu;Nome;E-mail;Hora da vaga;Entrou;Saiu;Entradas;Tempo na sessão (min);Até o fim (95 %)");
    expect(corpo).toContain("Sim;Aluna de Teste;aluna.teste@bunker707.test;");

    // A 375 px, em grafico e em tabela, a pagina nao rola de lado.
    await page.setViewportSize({ height: 812, width: 375 });
    await page.reload();
    await expect(page.getByRole("group", { name: /^Vagas garantidas, 2,/ })).toBeVisible();
    await semRolagemLateral(page);
    await page.getByRole("region", { name: "Presentes minuto a minuto" }).getByRole("button", { name: "Ver como tabela" }).click();
    await expect(page.getByRole("table", { name: "Presentes minuto a minuto" })).toBeVisible();
    await semRolagemLateral(page);
  });

  test("o botão Exportar abre o menu dos relatórios do Zoom e baixa o Q&A com o cabeçalho certo; 44 px a 375 px", async ({ page }) => {
    const db = createLocalAdminClient();
    const contas = await contasDeTeste(db);
    const { error } = await db.from("webinar_questions").insert({
      anonymous: false,
      answer_text: "Fica disponível por 7 dias.",
      answered_at: new Date().toISOString(),
      answered_by: contas.produtor.id,
      answered_live: true,
      body: "O replay fica até quando?",
      display_name: "Aluna T.",
      offset_ms: 125_000,
      session_id: sessaoId,
      status: "answered",
      upvotes: 1,
      user_id: contas.aluna.id
    });
    expect(error).toBeNull();

    await page.goto(`/admin/comunicacao/webinarios/${id}/relatorio?sessao=${sessaoId}`);
    await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
    const exportar = page.getByRole("button", { name: "Exportar" });
    await exportar.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    for (const nome of ["Registration (vagas)", "Attendee (lista por aluno)", "Performance (números da sessão)", "Q&A (perguntas)", "Poll (respostas das enquetes)", "Survey (pesquisa do fim)", "Simulação (só a parte simulada)"]) {
      await expect(menu.getByRole("menuitem", { exact: true, name: nome })).toBeVisible();
    }

    const baixando = page.waitForEvent("download");
    await menu.getByRole("menuitem", { exact: true, name: "Q&A (perguntas)" }).click();
    const download = await baixando;
    expect(download.suggestedFilename()).toMatch(/^webinario-teste-live-gravada-encerrada-\d{4}-\d{2}-\d{2}-\d{4}-qa\.csv$/);
    const caminho = await download.path();
    const linhas = (await readFile(caminho, "utf8")).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(linhas[0]).toBe("Nº;Hora;Minuto do vídeo;Nome;E-mail;Pergunta;Votos;Situação;Respondida por;Resposta;Ao vivo;Hora da resposta");
    expect(linhas[1]).toContain(";02:05;Aluna de Teste;aluna.teste@bunker707.test;O replay fica até quando?;1;Respondida;");
    expect(linhas[1]).toContain(";Fica disponível por 7 dias.;Sim;");

    // A 375 px o botao tem o alvo de toque de 44 px. A janela muda com a pagina aberta e o botao (transition-all) cresce
    // ate os 44 px animando: confere a altura depois que ela assenta, nunca no meio da animacao.
    await page.setViewportSize({ height: 812, width: 375 });
    await page.keyboard.press("Escape");
    await expect(exportar).toBeVisible();
    await expect.poll(async () => (await exportar.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await semRolagemLateral(page);
  });

  test("sem sessão que começou, a aba mostra o estado vazio em vez de números inventados", async ({ page }) => {
    const db = createLocalAdminClient();
    // A mesma live com a sessao devolvida a "agendada" para o futuro: nenhum relatorio ainda.
    const { error } = await db
      .from("webinar_sessions")
      .update({ ended_at: null, presence_curve: null, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), started_at: null, status: "scheduled" })
      .eq("id", sessaoId);
    expect(error).toBeNull();

    await page.goto(`/admin/comunicacao/webinarios/${id}/relatorio`);
    await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Nenhuma sessão começou ainda" })).toBeVisible();
    await expect(page.getByText("Os números aparecem depois da primeira sessão.", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Vagas garantidas/ })).toHaveCount(0);
  });
});

test.describe("sem login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a rota do CSV responde 401 sem sessão, sem arquivo", async ({ page }) => {
    const resposta = await page.request.get(`/api/admin/webinars/${id}/relatorio/csv?sessao=${sessaoId}&relatorio=qa`);
    expect(resposta.status()).toBe(401);
    expect(resposta.headers()["content-type"] ?? "").not.toContain("text/csv");
    const painel = await page.request.get("/api/admin/webinars/painel/csv?tipo=gravadas&inicio=2026-11-01T03:00:00.000Z&fim=2026-12-01T03:00:00.000Z");
    expect(painel.status()).toBe(401);
  });
});
