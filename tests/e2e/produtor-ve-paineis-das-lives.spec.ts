import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { LIVE_AO_VIVO_ENCERRADA_DE_TESTE, expect, seedLiveAoVivoEncerradaDeTeste, seedSimulacaoDeTeste, SIMULACAO_DE_TESTE, test } from "./fixtures";
import { LIVE_GRAVADA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaEncerradaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { parseCsv } from "../../src/lib/csv";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";

// Os paineis "Lives ao vivo" e "Lives gravadas" no navegador (docs/30 §2.1, §3.1 a §3.3, §3.5 e §3.7; docs/18 §3.2;
// fase 4a): o produtor escolhe "Ultimos 7 dias" no menu Periodo da barra superior, ve na aba Lives ao vivo os numeros
// da live encerrada de ontem (Lives realizadas, Presentes, Comparecimento) e a linha dela na tabela "Lives do periodo",
// baixa pelo Exportar o CSV Performance do periodo (a frase do cabecalho e as colunas de WEBINAR_COPY.exportar, a linha
// da live com os numeros reais); na aba Lives gravadas ve a sessao encerrada da Live gravada de teste com o bloco
// Simulacao por ultimo, a frase de que os numeros sao da simulacao e o contador ao lado dos participantes de verdade
// (nunca somado nos cartoes); a 375 px a pagina nao rola de lado e o Exportar tem 44 px. Os textos vem de WEBINAR_COPY.

const PAINEIS = WEBINAR_COPY.paineis;
const EXPORTAR = WEBINAR_COPY.exportar;
const ABAS = WEBINAR_COPY.admin.abas;
const PAGINA = "/admin/comunicacao/webinarios";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await seedLiveAoVivoEncerradaDeTeste(db);
  await seedLiveGravadaEncerradaDeTeste(db);
  await seedSimulacaoDeTeste(db, { sessaoId: LIVE_GRAVADA_DE_TESTE.sessaoId });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

/** A pagina nao rola de lado (lida ate o desenho parar de mudar). */
async function semRolagemLateral(page: Page) {
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
}

function abas(page: Page) {
  return page.getByRole("navigation", { name: WEBINAR_ADMIN_COPY.list.tabsLabel });
}

/** O cartao do painel (role="group" com "rotulo, valor, definicao"). */
function cartao(page: Page, rotulo: string, valor: string) {
  const escapado = `${rotulo}, ${valor},`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("group", { name: new RegExp(`^${escapado}`) });
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("Lives ao vivo: o Período da barra, os números da live de ontem, a tabela e o CSV Performance com o cabeçalho e as colunas certas", async ({ page }) => {
    await page.goto(PAGINA);
    await abas(page).getByRole("link", { exact: true, name: ABAS.aoVivo }).click();
    await expect(page).toHaveURL(/[?&]aba=ao-vivo/);
    await expect(page.getByRole("heading", { level: 3, name: PAINEIS.titulo.aoVivo })).toBeVisible();

    // O Periodo da barra superior: Ultimos 7 dias (a aba continua a mesma).
    await page.getByRole("button", { name: /^Período:/ }).click();
    await page.getByRole("menuitemradio", { name: /Últimos 7 dias/ }).click();
    await expect(page).toHaveURL(/[?&]periodo=7d/);
    await expect(page).toHaveURL(/[?&]aba=ao-vivo/);

    const numeros = page.getByRole("region", { name: PAINEIS.numerosDoPainel(PAINEIS.titulo.aoVivo) });
    await expect(numeros).toBeVisible();
    await expect(cartao(page, PAINEIS.cartoes.livesRealizadas, "1")).toBeVisible();
    await expect(cartao(page, PAINEIS.cartoes.vagasGarantidas, "1")).toBeVisible();
    await expect(cartao(page, PAINEIS.cartoes.presentes, "2")).toBeVisible();
    await expect(page.getByRole("group", { name: new RegExp(`^${PAINEIS.cartoes.comparecimento}, 100`) })).toBeVisible();

    // A tabela das lives do periodo, com o caminho para o relatorio da sessao.
    const tabela = page.getByRole("table", { name: PAINEIS.tabela.tituloAoVivo });
    await expect(tabela).toBeVisible();
    await expect(tabela.getByRole("row").filter({ hasText: LIVE_AO_VIVO_ENCERRADA_DE_TESTE.titulo })).toBeVisible();
    await expect(page.getByRole("link", { name: PAINEIS.tabela.abrirRelatorioDe(LIVE_AO_VIVO_ENCERRADA_DE_TESTE.titulo) })).toHaveAttribute(
      "href",
      new RegExp(`/admin/comunicacao/webinarios/${LIVE_AO_VIVO_ENCERRADA_DE_TESTE.id}.*sessao=${LIVE_AO_VIVO_ENCERRADA_DE_TESTE.sessaoId}`)
    );

    // Exportar: na aba ao vivo so o Performance do periodo; o arquivo abre com a frase e as colunas do Zoom.
    await page.getByRole("button", { name: EXPORTAR.botao }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { exact: true, name: EXPORTAR.relatoriosDoPeriodo.performance })).toBeVisible();
    await expect(menu.getByRole("menuitem", { exact: true, name: EXPORTAR.relatoriosDoPeriodo.simulacao })).toHaveCount(0);
    const baixando = page.waitForEvent("download");
    await menu.getByRole("menuitem", { exact: true, name: EXPORTAR.relatoriosDoPeriodo.performance }).click();
    const download = await baixando;
    expect(download.suggestedFilename()).toMatch(/^webinario-ao-vivo-periodo-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}-performance\.csv$/);
    const texto = await readFile(await download.path(), "utf8");
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    const csv = parseCsv(texto);
    expect(csv.headers).toEqual([EXPORTAR.cabecalhoPerformance]);
    expect(csv.rows[0]).toEqual([...EXPORTAR.colunas.performance]);
    const coluna = (nome: (typeof EXPORTAR.colunas.performance)[number]) => EXPORTAR.colunas.performance.indexOf(nome);
    const daLive = csv.rows.slice(1).find((linha) => linha[coluna("Webinário")] === LIVE_AO_VIVO_ENCERRADA_DE_TESTE.titulo);
    expect(daLive, "a live do periodo no arquivo").toBeTruthy();
    expect(daLive?.[coluna("Tipo")]).toBe(EXPORTAR.valores.tipos.live);
    expect(daLive?.[coluna("Vagas garantidas")]).toBe("1");
    expect(daLive?.[coluna("Presentes")]).toBe("2");
    expect(daLive?.[coluna("Pico")]).toBe("2");
  });

  test("Lives gravadas: a sessão encerrada, os participantes de verdade nos cartões e o bloco Simulação separado, por último", async ({ page }) => {
    await page.goto(`${PAGINA}?aba=gravadas&periodo=7d`);
    await expect(page.getByRole("heading", { level: 3, name: PAINEIS.titulo.gravadas })).toBeVisible();
    await expect(abas(page).getByRole("link", { exact: true, name: ABAS.gravadas })).toHaveAttribute("aria-current", "page");

    await expect(cartao(page, PAINEIS.cartoes.sessoesRealizadas, "1")).toBeVisible();
    // Os participantes sao os de verdade (2): o contador simulado (42) nunca entra num cartao.
    await expect(cartao(page, PAINEIS.cartoes.participantes, "2")).toBeVisible();
    await expect(page.getByRole("group", { name: new RegExp(`^[^,]+, ${SIMULACAO_DE_TESTE.resumo.counter_max},`) })).toHaveCount(0);

    const tabela = page.getByRole("table", { name: PAINEIS.tabela.tituloGravadas });
    await expect(tabela.getByRole("row").filter({ hasText: LIVE_GRAVADA_DE_TESTE.titulo })).toBeVisible();

    const simulacao = page.getByRole("region", { name: PAINEIS.simulacao.titulo });
    await expect(simulacao).toBeVisible();
    await expect(simulacao.getByText(PAINEIS.simulacao.aviso, { exact: true })).toBeVisible();
    await expect(simulacao.getByText(PAINEIS.simulacao.comparacaoReal(2), { exact: true })).toBeVisible();
    await expect(simulacao.getByText(String(SIMULACAO_DE_TESTE.resumo.counter_max), { exact: true })).toBeVisible();
    await expect(simulacao.getByText(PAINEIS.simulacao.seloLigado(1, 1), { exact: true })).toBeVisible();
    // O bloco fica por ultimo, abaixo da tabela das sessoes.
    const caixaDaTabela = await tabela.boundingBox();
    const caixaDoBloco = await simulacao.boundingBox();
    expect(caixaDoBloco?.y ?? 0).toBeGreaterThan(caixaDaTabela?.y ?? Number.POSITIVE_INFINITY);

    // Aqui o Exportar tem tambem o CSV Simulacao do periodo.
    await page.getByRole("button", { name: EXPORTAR.botao }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { exact: true, name: EXPORTAR.relatoriosDoPeriodo.simulacao })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a 375 px as duas abas cabem sem rolar de lado e o Exportar tem 44 px", async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    for (const aba of ["ao-vivo", "gravadas"] as const) {
      await page.goto(`${PAGINA}?aba=${aba}&periodo=7d`);
      await expect(page.getByRole("heading", { level: 3, name: aba === "ao-vivo" ? PAINEIS.titulo.aoVivo : PAINEIS.titulo.gravadas })).toBeVisible();
      await expect(cartao(page, aba === "ao-vivo" ? PAINEIS.cartoes.livesRealizadas : PAINEIS.cartoes.sessoesRealizadas, "1")).toBeVisible();
      const exportar = page.getByRole("button", { name: EXPORTAR.botao });
      await expect(exportar).toBeVisible();
      expect((await exportar.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await semRolagemLateral(page);
    }
  });
});
