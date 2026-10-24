import type { Locator, Page } from "@playwright/test";
import { popupStarterDesign } from "../../src/server/communications/popup-design-model";
import { defaultPopupSettings } from "../../src/server/communications/popup-display-model";
import { freeStarterDesign } from "../../src/server/communications/popup-free-starters";
import { templatePayloadOfDesign, type TemplatePayload } from "../../src/server/communications/template-model";
import { contarModelosNoBanco, criarModeloNoBanco, expect, test, zerarComunicacao, zerarProgressoDosAlunos } from "./fixtures";

// A aba Modelos da Comunicacao (docs/28 §5.2 e §7.3; docs/18 §3.1): a lista vazia leva a escolha do tipo (quatro
// cartoes); com tres modelos montados no banco (uma notificacao, um pop-up Padrão e um design Livre), a busca nao
// liga para acento ("lanc" acha "Lançamento") e o filtro "Design Livre" mostra so o Livre; a busca sem resultado
// mostra "Limpar filtros". So pelo teclado: o ⋯ da primeira linha, Renomear (o nome selecionado, Enter salva e o
// foco volta ao ⋯), Duplicar ("(cópia)") e Excluir (o foco vai para a linha seguinte). A 375 px, cartoes sem
// rolagem lateral, ⋯ de 44 px e "Atualizado" no cartao. A analista nao ve a Comunicacao e o endereco a leva embora.

const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const SESSAO_DA_ANALISTA = "tests/e2e/.auth/analista.json";
const LANCAMENTO = "Modelo E2E: Lançamento do curso";
const PADRAO = "Modelo E2E: Pop-up de boas-vindas";
const LIVRE = "Modelo E2E: Design de brilho";
const RENOMEADO = "Modelo E2E: Lançamento da turma";
const PERSONALIZADO = "Modelo E2E: Design por seções";

const NOTIFICACAO: TemplatePayload = {
  audience: null,
  content: null,
  followUps: null,
  kind: "inbox",
  settings: { allowHide: true, icon: null, sender: null, validity: { mode: "default" } },
  version: 1
};
const POPUP_PADRAO: TemplatePayload = {
  audience: null,
  content: null,
  design: null,
  designSupport: null,
  kind: "popup",
  settings: { allowSnooze: true, icon: null, popup: defaultPopupSettings() },
  version: 1
};
const DESIGN_LIVRE = templatePayloadOfDesign({ design: null, freeDesign: freeStarterDesign("glow_text"), support: { ctaLabel: "Saiba mais", image: null } });
const DESIGN_PERSONALIZADO = templatePayloadOfDesign({ design: popupStarterDesign("text_only"), freeDesign: null, support: { ctaLabel: "Saiba mais", image: null } });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();
});
test.afterAll(zerarComunicacao);

/** A linha da lista (ou o cartao no celular) pelo nome exato do modelo. */
function linha(page: Page, nome: string) {
  return page.getByRole("row").filter({ has: page.getByText(nome, { exact: true }) });
}

/** O ⋯ da linha do modelo. */
function menuDe(page: Page, nome: string) {
  return linha(page, nome).getByRole("button", { exact: true, name: `Ações de ${nome}` });
}

/** Espera a lista desenhar e o React ligar os cliques (o clique logo depois de abrir a pagina pode se perder). */
async function abrirLista(page: Page, endereco = "/admin/comunicacao/modelos") {
  await page.goto(endereco);
  await page.waitForLoadState("networkidle");
}

/** Clica num link ate a pagina mudar (o primeiro clique pode chegar antes da hidratacao, no WebKit da CI). */
async function clicarAteNavegar(page: Page, alvo: Locator, endereco: RegExp) {
  await expect(async () => {
    if (!endereco.test(page.url())) {
      await alvo.click();
    }
    await expect(page).toHaveURL(endereco, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("produtor", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

  test("lista vazia: Nenhum modelo ainda, e Novo modelo leva à escolha do tipo com quatro cartões", async ({ page }) => {
    await abrirLista(page);
    await expect(page.getByRole("heading", { level: 1, name: "Comunicação" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Modelos" }).first()).toBeVisible();
    await expect(page.getByText("Nenhum modelo ainda", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Um modelo guarda a configuração de uma notificação, de um pop-up ou só de um design, para começar o próximo aviso pronto. Crie aqui ou use “Salvar como modelo” num aviso.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Ver avisos" })).toHaveAttribute("href", "/admin/comunicacao/avisos");

    // O estado vazio e o cabecalho tem "Novo modelo": o do estado vazio leva a escolha do tipo.
    const novo = page.getByRole("main").getByRole("link", { exact: true, name: "Novo modelo" }).last();
    await clicarAteNavegar(page, novo, /\/admin\/comunicacao\/modelos\/novo$/);
    await expect(page.getByRole("heading", { level: 1, name: "Novo modelo" })).toBeVisible();
    await expect(page.getByText("Que tipo de modelo você quer criar?", { exact: true })).toBeVisible();
    const cartoes = page.getByRole("list", { name: "Tipos de modelo" }).getByRole("link");
    await expect(cartoes).toHaveCount(4);
    await expect(cartoes).toHaveText([/^Notificação/, /^Pop-up/, /^Design Personalizado/, /^Design Livre/]);
    await expect(page.locator('[data-template-kind="design_free"]')).toHaveAttribute("href", "/admin/comunicacao/modelos/novo?tipo=design-livre");
  });

  test("busca sem acento e filtro por tipo; a busca sem resultado mostra Limpar filtros", async ({ page }) => {
    // Do mais antigo para o mais novo: a lista mostra o mais recente primeiro.
    await criarModeloNoBanco(NOTIFICACAO, LANCAMENTO);
    await criarModeloNoBanco(POPUP_PADRAO, PADRAO);
    await criarModeloNoBanco(DESIGN_LIVRE, LIVRE);

    await abrirLista(page);
    const nomes = page.locator("[data-template-name]");
    await expect(nomes).toHaveText([LIVRE, PADRAO, LANCAMENTO]);
    await expect(linha(page, LANCAMENTO)).toContainText("Notificação");
    await expect(linha(page, PADRAO)).toContainText("Pop-up");
    await expect(linha(page, LIVRE)).toContainText("Design Livre");
    // A linha "{n} de 200 modelos" so aparece a partir de 150.
    await expect(page.getByText(/de 200 modelos$/)).toHaveCount(0);

    const busca = page.getByRole("searchbox", { name: "Buscar modelo pelo nome" });
    await busca.fill("lanc");
    await expect(busca).toHaveValue("lanc");
    await expect(page).toHaveURL(/[?&]busca=lanc/);
    await expect(nomes).toHaveText([LANCAMENTO]);

    await busca.fill("");
    await expect(page).not.toHaveURL(/busca=/);
    await expect(nomes).toHaveCount(3);
    const tipo = page.getByRole("navigation", { name: "Tipo do modelo" });
    await clicarAteNavegar(page, tipo.getByRole("link", { exact: true, name: "Design Livre" }), /[?&]tipo=design-livre/);
    await expect(nomes).toHaveText([LIVRE]);
    await expect(tipo.getByRole("link", { exact: true, name: "Design Livre" })).toHaveAttribute("aria-current", "page");

    await busca.fill("nada parecido");
    await expect(page.getByText("Nenhum modelo encontrado", { exact: true })).toBeVisible();
    await expect(page.getByText("Tente outro nome ou outro tipo.", { exact: true })).toBeVisible();
    await clicarAteNavegar(page, page.getByRole("link", { exact: true, name: "Limpar filtros" }), /\/admin\/comunicacao\/modelos$/);
    await expect(nomes).toHaveCount(3);
    await expect(busca).toHaveValue("");
  });

  test("só pelo teclado: renomeia, duplica e exclui pelo ⋯ da primeira linha", async ({ page }) => {
    // A primeira linha passa a ser o Lancamento (mexer nele o leva ao topo): comeca por ele mesmo, renomeando.
    await abrirLista(page, "/admin/comunicacao/modelos?tipo=notificacao");
    const primeiraLinha = page.locator("[data-template-name]").first();
    await expect(primeiraLinha).toHaveText(LANCAMENTO);

    // Tab do nome (o link da linha) chega ao ⋯; Enter abre o menu e as setas descem ate Renomear.
    const menu = menuDe(page, LANCAMENTO);
    await primeiraLinha.locator("xpath=ancestor::a[1]").focus();
    await page.keyboard.press("Tab");
    await expect(menu).toBeFocused();
    const itens = page.getByRole("menuitem");
    await expect(async () => {
      if ((await itens.count()) === 0) {
        await page.keyboard.press("Enter");
      }
      await expect(itens.first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(itens).toHaveText(["Usar", "Editar", "Renomear", "Duplicar", "Excluir"]);
    const renomear = page.getByRole("menuitem", { exact: true, name: "Renomear" });
    for (let tentativa = 0; tentativa < 5 && !(await renomear.evaluate((item) => item === document.activeElement)); tentativa += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(renomear).toBeFocused();
    await page.keyboard.press("Enter");

    // O dialogo abre com o nome selecionado: digitar troca o nome inteiro, e Enter salva.
    const dialogo = page.getByRole("dialog", { name: "Renomear modelo" });
    await expect(dialogo).toBeVisible();
    const campo = dialogo.getByLabel("Nome do modelo", { exact: true });
    await expect(campo).toBeFocused();
    await expect(campo).toHaveValue(LANCAMENTO);
    expect(await campo.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, LANCAMENTO.length]);
    await page.keyboard.type(RENOMEADO);
    await expect(campo).toHaveValue(RENOMEADO);
    await expect(dialogo.getByText(`${RENOMEADO.length}/80`, { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Nome salvo.", { exact: true })).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    await expect(page.locator("[data-template-name]").first()).toHaveText(RENOMEADO);
    // Cuidado (c): o foco volta ao ⋯ da linha antes de usar o teclado de novo.
    const menuRenomeado = menuDe(page, RENOMEADO);
    await expect(menuRenomeado).toBeFocused();

    // ⋯ > Duplicar: a copia aparece na lista com "(cópia)".
    await page.keyboard.press("Enter");
    await expect(itens.first()).toBeVisible();
    const duplicar = page.getByRole("menuitem", { exact: true, name: "Duplicar" });
    for (let tentativa = 0; tentativa < 6 && !(await duplicar.evaluate((item) => item === document.activeElement)); tentativa += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(duplicar).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Modelo duplicado.", { exact: true })).toBeVisible();
    await expect(page.locator("[data-template-name]")).toHaveText([`${RENOMEADO} (cópia)`, RENOMEADO]);

    // ⋯ > Excluir na primeira linha (a copia): confirma; a linha some e o foco vai para o nome da seguinte.
    const menuDaCopia = menuDe(page, `${RENOMEADO} (cópia)`);
    await menuDaCopia.focus();
    await expect(menuDaCopia).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(itens.first()).toBeVisible();
    const excluir = page.getByRole("menuitem", { exact: true, name: "Excluir" });
    for (let tentativa = 0; tentativa < 6 && !(await excluir.evaluate((item) => item === document.activeElement)); tentativa += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(excluir).toBeFocused();
    await page.keyboard.press("Enter");
    const confirmar = page.getByRole("alertdialog", { name: "Excluir o modelo?" }).or(page.getByRole("dialog", { name: "Excluir o modelo?" }));
    await expect(confirmar).toBeVisible();
    await expect(confirmar).toContainText(`“${RENOMEADO} (cópia)” sai da lista de modelos. Os avisos criados com ele não mudam.`);
    await confirmar.getByRole("button", { exact: true, name: "Excluir modelo" }).click();
    await expect(page.getByText("Modelo excluído.", { exact: true })).toBeVisible();
    await expect(page.locator("[data-template-name]")).toHaveText([RENOMEADO]);
    await expect(page.locator("[data-template-name]").first().locator("xpath=ancestor::a[1]")).toBeFocused();
    expect(await contarModelosNoBanco(`${RENOMEADO} (cópia)`)).toBe(0);
  });
});

test.describe("a 375 px", () => {
  // Um celular de verdade (toque): o ⋯ ganha os 44 px do pointer-coarse.
  test.use({ hasTouch: true, isMobile: true, storageState: SESSAO_DO_PRODUTOR, viewport: { height: 812, width: 375 } });

  test("cartões sem rolagem lateral, ⋯ com 44 px, Atualizado visível e nada abaixo de 12 px", async ({ page }) => {
    // O tipo mais comprido ("Design Personalizado") quebra dentro da coluna, sem passar por cima da data.
    await criarModeloNoBanco(DESIGN_PERSONALIZADO, PERSONALIZADO);
    await abrirLista(page);
    await expect(page.locator("[data-template-name]")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const tipo = linha(page, PERSONALIZADO).locator('td[data-label="Tipo"]');
    await expect(tipo).toHaveText("Design Personalizado");
    expect(await tipo.evaluate((celula) => celula.scrollWidth <= celula.clientWidth)).toBe(true);
    const caixaDoTipo = await tipo.boundingBox();
    const caixaDaData = await linha(page, PERSONALIZADO).locator('td[data-label="Atualizado"]').boundingBox();
    expect((caixaDoTipo?.x ?? 0) + (caixaDoTipo?.width ?? 0)).toBeLessThanOrEqual(caixaDaData?.x ?? 0);

    const cartao = linha(page, LIVRE);
    await expect(cartao).toBeVisible();
    // O rotulo do celular vem do data-label da celula (::before): "Atualizado" com a data.
    const atualizado = cartao.locator('td[data-label="Atualizado"]');
    await expect(atualizado).toBeVisible();
    await expect(atualizado).toHaveText(/^\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/);
    expect(await atualizado.evaluate((celula) => getComputedStyle(celula, "::before").content)).toBe('"Atualizado"');

    const menu = menuDe(page, LIVRE);
    const caixa = await menu.boundingBox();
    expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);

    const menores = await page.locator("main").evaluate((main) =>
      Array.from(main.querySelectorAll<HTMLElement>("*"))
        .filter((element) => element.childNodes.length > 0 && Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent?.trim()))
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({ size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) }))
        .filter((item) => item.size < 12)
    );
    expect(menores).toEqual([]);
  });
});

test.describe("analista", () => {
  test.use({ storageState: SESSAO_DA_ANALISTA });

  test("não vê a Comunicação no menu, e o endereço dos modelos a leva para fora da Comunicação", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    // O menu lateral esta na tela (a area dela aparece) e nao tem a Comunicacao.
    await expect(page.getByRole("link", { exact: true, name: "Visão geral" }).first()).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Comunicação" })).toHaveCount(0);
    await expect(page.getByRole("link", { exact: true, name: "Modelos" })).toHaveCount(0);

    await page.goto("/admin/comunicacao/modelos").catch(() => undefined);
    await expect(page).not.toHaveURL(/\/admin\/comunicacao/);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText("Nenhum modelo ainda", { exact: true })).toHaveCount(0);
  });
});
