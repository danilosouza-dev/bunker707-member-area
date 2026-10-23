import type { Locator, Page } from "@playwright/test";
import { popupStarterDesign } from "../../src/server/communications/popup-design-model";
import { applyFreeStarter } from "../../src/server/communications/popup-free-starters";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { expect, idDoAviso, modeloNoBanco, modelosUsadosNoAviso, test, zerarComunicacao, zerarProgressoDosAlunos } from "./fixtures";
import { publicarPopUpComDesign } from "./popup-design-fixtures";
import { designVideoNoTopo, prepararMidiaDoLivre, publicarPopUpLivre } from "./popup-livre-fixtures";

// "Meus modelos" de design (docs/28 §5.7 a §5.9 e §7.3; docs/18 §3.1). 1. Personalizado: "Salvar design como
// modelo" num pop-up publicado; num pop-up novo, o Personalizado mostra "Meus modelos" antes dos "Modelos prontos";
// usar aplica o design com o botao "Saiba mais" sem destino e o toast com Desfazer (volta ao estado sem design); o
// salvar depois do Desfazer nao registra o modelo em template_used, e usar de novo e salvar registra (created false).
// 2. Livre (1440 px): a aba Modelos do editor Livre salva o design como modelo (o foco volta ao botao); noutro
// pop-up que ja tem Livre, o modelo entra pelo card com "Trocar de modelo?" e o editor abre com o Livre de antes
// um passo atras (Ctrl + Z / Ctrl + Shift + Z); num pop-up novo, o modelo e aplicado e o rascunho grava com os
// caminhos dos arquivos do modelo. 3. A pagina do modelo de Design: o editor Livre diz "Salvar modelo" e
// "Modelo: {nome}", nao tem a aba Modelos, o botao principal so tem o texto e salvar diz "Modelo salvo."; a previa
// mostra o celular e o computador juntos. 4. Um modelo novo de Design: antes de escolher o design, a previa tem a
// escolha Computador | Celular (a mesma do editor do aviso); com o design, os dois juntos.

const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const PERSONALIZADO = "Design E2E: pop-up Personalizado";
const MODELO_PERSONALIZADO = "Design E2E: só texto da escola";
const DESFEITO = "Design E2E: pop-up com o modelo desfeito";
const LIVRE = "Design E2E: pop-up Livre com vídeo";
const MODELO_LIVRE = "Design E2E: vídeo no topo da escola";
const OUTRO_LIVRE = "Design E2E: pop-up Livre com brilho";
const NOVO_LIVRE = "Design E2E: pop-up novo do modelo";

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();
});
test.afterAll(zerarComunicacao);

/** O card do editor pelo titulo. */
function card(page: Page, titulo: string) {
  return page.getByRole("region", { exact: true, name: titulo });
}

/** O elemento do design desenhado no palco do editor Livre. */
function noPalco(editor: Locator, id: string) {
  return editor.locator(`[data-free-canvas-card] [data-free-id="${id}"]`).first();
}

/** Sair de uma pagina com mudanca pede confirmacao (useWarnBeforeUnload): aceita sempre. */
function aceitarSaida(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
}

/** Clica ate o alvo aparecer (o primeiro clique logo depois de abrir a pagina pode chegar antes da hidratacao). */
async function clicarAte(alvo: Locator, aparece: Locator) {
  await expect(async () => {
    if (!(await aparece.isVisible())) {
      await alvo.click();
    }
    await expect(aparece).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test("Personalizado: salvar o design como modelo e usar em Meus modelos, com Desfazer", async ({ browser, page }) => {
  test.setTimeout(120_000);
  aceitarSaida(page);
  const id = await publicarPopUpComDesign(browser, {
    botao: { href: "/minhas-compras", label: "Saiba mais" },
    design: popupStarterDesign("text_only"),
    texto: "",
    titulo: PERSONALIZADO
  });

  await test.step("no pop-up publicado, Salvar design como modelo", async () => {
    await page.goto(`/admin/comunicacao/avisos/${id}?editar=1`);
    await page.waitForLoadState("networkidle");
    const design = card(page, "Design");
    const salvar = design.getByRole("button", { exact: true, name: "Salvar design como modelo" });
    const dialogo = page.getByRole("dialog", { name: "Salvar design como modelo" });
    await clicarAte(salvar, dialogo);
    await expect(dialogo).toContainText(
      "Fica em “Meus modelos” do design Personalizado e em Comunicação › Modelos. Os textos do design vão junto; o destino do botão fica em cada aviso."
    );
    const nome = dialogo.getByLabel("Nome do modelo", { exact: true });
    await expect(nome).toHaveValue(`Design de ${PERSONALIZADO}`);
    await nome.fill(MODELO_PERSONALIZADO);
    await expect(nome).toHaveValue(MODELO_PERSONALIZADO);
    await dialogo.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(page.getByText("Design salvo em Meus modelos.", { exact: true })).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    await expect(salvar).toBeFocused();
  });

  const modelo = await modeloNoBanco(MODELO_PERSONALIZADO);
  expect(modelo.kind).toBe("design");
  expect(modelo.design_mode).toBe("custom");
  expect(modelo.payload.designSupport).toEqual({ ctaLabel: "Saiba mais", image: null });

  await test.step("num pop-up novo, o Personalizado mostra Meus modelos e Modelos prontos; usar aplica com Desfazer", async () => {
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    const design = card(page, "Design");
    const meus = design.locator('[data-design-mine="ready"]');
    // Cuidado do WebKit: o primeiro clique logo depois de abrir a pagina repete ate a lista abrir.
    await clicarAte(design.getByText("Personalizado", { exact: true }), meus);
    await expect(meus.getByRole("heading", { level: 4, name: "Meus modelos" })).toBeVisible();
    await expect(design.getByRole("heading", { level: 4, name: "Modelos prontos" })).toBeVisible();
    await expect(meus.getByText(MODELO_PERSONALIZADO, { exact: true })).toBeVisible();
    await expect(meus.getByText(/^Atualizado em \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

    const usar = meus.getByRole("button", { exact: true, name: `Usar este modelo: ${MODELO_PERSONALIZADO}` });
    await usar.click();
    // O botao principal ganha o texto do modelo, sem destino (cada aviso escolhe o seu): o toast diz e oferece Desfazer.
    const aplicado = "Design aplicado. O botão principal ganhou o texto “Saiba mais”. Escolha para onde ele leva.";
    await expect(page.getByText(aplicado, { exact: true })).toBeVisible();
    const blocoDoBotao = card(page, "Blocos").getByRole("listitem").filter({ hasText: "Botão principal" });
    await expect(blocoDoBotao).toContainText("Saiba mais");
    await expect(design.getByRole("button", { exact: true, name: "Salvar design como modelo" })).toBeVisible();
    await expect(meus).toHaveCount(0);

    await page.getByRole("button", { exact: true, name: "Desfazer" }).click();
    // Volta ao estado sem design (o Padrão): o botao principal sai e "Salvar design como modelo" some.
    await expect(design.getByRole("radio", { name: /^Padrão/ })).toBeChecked();
    await expect(design.getByRole("button", { exact: true, name: "Salvar design como modelo" })).toHaveCount(0);
    await expect(card(page, "Blocos")).toHaveCount(0);
  });

  await test.step("o Desfazer tira o modelo dos aplicados: salvar agora não registra template_used com ele", async () => {
    // No Padrão o campo se chama "Título" (com design, "Nome do pop-up"): o mesmo id.
    const nome = page.locator("#aviso-titulo");
    await nome.fill(DESFEITO);
    await expect(nome).toHaveValue(DESFEITO);
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    expect(await modelosUsadosNoAviso(await idDoAviso(DESFEITO))).toEqual([]);
  });

  await test.step("usar de novo e salvar registra o modelo (created false)", async () => {
    const design = card(page, "Design");
    const meus = design.locator('[data-design-mine="ready"]');
    // Usa de novo: Personalizado > Meus modelos.
    await clicarAte(design.getByText("Personalizado", { exact: true }), meus);

    await meus.getByRole("button", { exact: true, name: `Usar este modelo: ${MODELO_PERSONALIZADO}` }).click();
    await expect(meus).toHaveCount(0);
    await expect(card(page, "Blocos").getByRole("listitem").filter({ hasText: "Botão principal" })).toContainText("Saiba mais");

    // O botao do modelo vem sem destino: o salvar pede e foca o campo; escolhe e salva.
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page.getByText("Revise os campos destacados.", { exact: true })).toBeVisible();
    await design.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Página da área", { exact: true }).click();
    await design.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();

    const id = await idDoAviso(DESFEITO);
    await expect
      .poll(async () => (await modelosUsadosNoAviso(id)).map((linha) => linha.metadata), { timeout: 15_000 })
      .toEqual([{ created: false, template_ids: [modelo.id] }]);
  });
});

test("Livre: salvar pela aba Modelos do editor, trocar noutro pop-up e usar num pop-up novo", async ({ browser, page }) => {
  test.setTimeout(240_000);
  aceitarSaida(page);
  const midia = await prepararMidiaDoLivre();
  const idDoLivre = await publicarPopUpLivre(browser, { design: designVideoNoTopo(midia), titulo: LIVRE });
  const brilho = applyFreeStarter("glow_text", { audio: null, cta: { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" } });
  const idDoOutro = await publicarPopUpLivre(browser, { design: brilho.design, titulo: OUTRO_LIVRE });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });

  await test.step("na aba Modelos do editor Livre, Salvar este design como modelo", async () => {
    await page.goto(`/admin/comunicacao/avisos/${idDoLivre}?editar=1`);
    await page.waitForLoadState("networkidle");
    await clicarAte(card(page, "Design").getByRole("button", { exact: true, name: "Abrir editor Livre" }), editor);
    await expect(noPalco(editor, "midia")).toBeVisible({ timeout: 30_000 });

    await editor.locator('[data-free-tab="templates"]').click();
    const painel = editor.locator("[data-free-templates]");
    await expect(painel).toBeVisible();
    await expect(painel.getByText("Seus designs Livres salvos aparecem aqui. Use “Salvar este design como modelo”.", { exact: true })).toBeVisible();
    const salvar = painel.locator("[data-free-template-save]");
    await salvar.click();
    const dialogo = page.getByRole("dialog", { name: "Salvar design como modelo" });
    await expect(dialogo).toBeVisible();
    const nome = dialogo.getByLabel("Nome do modelo", { exact: true });
    await expect(nome).toHaveValue(`Design de ${LIVRE}`);
    await nome.fill(MODELO_LIVRE);
    await expect(nome).toHaveValue(MODELO_LIVRE);
    await dialogo.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(dialogo).toHaveCount(0);
    // Cuidado (c): o foco volta ao botao antes de qualquer tecla.
    await expect(salvar).toBeFocused();
    await expect(painel.getByRole("button", { exact: true, name: `Usar este modelo: ${MODELO_LIVRE}` })).toBeVisible();

    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
  });

  const modelo = await modeloNoBanco(MODELO_LIVRE);
  expect(modelo.kind).toBe("design");
  expect(modelo.design_mode).toBe("free");
  const caminhosDoModelo = ((modelo.payload.design as { assets: { path: string }[] }).assets ?? []).map((asset) => asset.path).sort();
  expect(caminhosDoModelo).toEqual([midia.capa.path, midia.video.path].sort());

  await test.step("noutro pop-up com Livre, o modelo entra por Trocar de modelo; Ctrl + Z volta ao Livre de antes", async () => {
    await page.goto(`/admin/comunicacao/avisos/${idDoOutro}?editar=1`);
    await page.waitForLoadState("networkidle");
    const design = card(page, "Design");
    const meus = design.locator('[data-design-mine="ready"]');
    await clicarAte(design.getByRole("button", { exact: true, name: "Trocar de modelo" }), meus);
    await meus.getByRole("button", { exact: true, name: `Usar este modelo: ${MODELO_LIVRE}` }).click();
    const confirmar = page.getByRole("alertdialog", { name: "Trocar de modelo?" }).or(page.getByRole("dialog", { name: "Trocar de modelo?" }));
    await expect(confirmar).toContainText("O design Livre atual será trocado pelo modelo. Dá para desfazer no editor.");
    await confirmar.getByRole("button", { exact: true, name: "Trocar" }).click();

    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(noPalco(editor, "midia")).toBeVisible();
    await expect(noPalco(editor, "luz1")).toHaveCount(0);

    // Depois do dialogo "Trocar de modelo?", o foco volta ao palco antes de teclar (cuidado do WebKit).
    await editor.locator("[data-free-stage]").focus();
    await expect(editor.locator("[data-free-stage]")).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(noPalco(editor, "luz1")).toBeVisible();
    await expect(noPalco(editor, "midia")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await expect(noPalco(editor, "midia")).toBeVisible();
    await expect(noPalco(editor, "luz1")).toHaveCount(0);

    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
  });

  await test.step("num pop-up novo em Livre, o modelo é aplicado sem pergunta", async () => {
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    const design = card(page, "Design");
    const meus = design.locator('[data-design-mine="ready"]');
    await clicarAte(design.getByText("Livre", { exact: true }), meus);
    await meus.getByRole("button", { exact: true, name: `Usar este modelo: ${MODELO_LIVRE}` }).click();
    await expect(page.getByRole("dialog", { name: "Trocar de modelo?" })).toHaveCount(0);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(noPalco(editor, "midia")).toBeVisible();
    await expect(noPalco(editor, "titulo")).toBeVisible();
  });

  await test.step("cuidado (e): o botão do modelo vem sem destino; escolhe no editor, conclui, dá o nome e salva", async () => {
    await noPalco(editor, "botao").click();
    await editor.getByRole("tab", { exact: true, name: "Conteúdo" }).click();
    const destino = editor.getByRole("radiogroup", { name: "Para onde o botão leva" });
    await expect(destino.getByRole("radio", { checked: true })).toHaveCount(1);
    await destino.getByText("Página da área", { exact: true }).click();
    await editor.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
    await expect(editor.getByRole("radiogroup", { name: "Página da área do aluno" }).getByRole("radio", { name: "Minhas compras" })).toBeChecked();
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);

    const nome = page.getByLabel("Nome do pop-up", { exact: true });
    await nome.fill(NOVO_LIVRE);
    await expect(nome).toHaveValue(NOVO_LIVRE);
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);

    const db = createLocalAdminClient();
    const gravado = unwrap(await db.from("campaigns").select("id,popup_design").eq("title", NOVO_LIVRE).is("deleted_at", null).single(), "Lendo o pop-up novo") as {
      id: string;
      popup_design: { assets: { path: string }[]; mode: string };
    };
    expect(gravado.popup_design.mode).toBe("free");
    expect(gravado.popup_design.assets.map((asset) => asset.path).sort()).toEqual(caminhosDoModelo);
    const usados = await modelosUsadosNoAviso(await idDoAviso(NOVO_LIVRE));
    expect(usados.map((linha) => linha.metadata)).toEqual([{ created: true, template_ids: [modelo.id] }]);
  });
});

test("página do modelo de Design: Salvar modelo, Modelo: {nome}, sem a aba Modelos e sem o destino do botão", async ({ page }) => {
  test.setTimeout(120_000);
  aceitarSaida(page);
  const modelo = await modeloNoBanco(MODELO_LIVRE);
  await page.goto(`/admin/comunicacao/modelos/${modelo.id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: `Modelo: ${MODELO_LIVRE}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usar num pop-up novo" })).toHaveAttribute("href", `/admin/comunicacao/avisos/novo?modelo=${modelo.id}`);
  // O modo e fixo: sem a escolha Padrão/Personalizado/Livre.
  await expect(card(page, "Design").getByRole("radio", { name: /^Personalizado/ })).toHaveCount(0);
  // A mesma previa do editor do aviso: com design, o celular e o computador juntos, sem a escolha do aparelho.
  const previa = page.getByRole("region", { exact: true, name: "Prévia" });
  await expect(previa.getByRole("figure", { name: "Prévia do pop-up no celular" })).toBeVisible();
  await expect(previa.getByRole("figure", { name: "Prévia do pop-up no computador" })).toBeAttached();
  await expect(previa.getByRole("radiogroup", { name: "Aparelho da prévia" })).toHaveCount(0);

  const editor = page.getByRole("dialog", { name: "Editor Livre" });
  await clicarAte(card(page, "Design").getByRole("button", { exact: true, name: "Abrir editor Livre" }), editor);
  await expect(noPalco(editor, "midia")).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByText(`Modelo: ${MODELO_LIVRE}`, { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { exact: true, name: "Salvar modelo" })).toBeVisible();
  await expect(editor.getByRole("button", { exact: true, name: "Salvar rascunho" })).toHaveCount(0);
  await expect(editor.locator('[data-free-tab="templates"]')).toHaveCount(0);

  await noPalco(editor, "botao").click();
  await expect(editor.getByText("O destino do botão é escolhido em cada aviso.", { exact: true })).toBeVisible();
  await expect(editor.getByRole("radiogroup", { name: "Para onde o botão leva" })).toHaveCount(0);

  await editor.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
  await expect(editor.locator("[data-free-live]")).toHaveText("Modelo salvo.");
  await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(0);
});

test("modelo novo de Design: a prévia tem Computador | Celular antes do design e mostra os dois juntos depois", async ({ page }) => {
  test.setTimeout(60_000);
  aceitarSaida(page);
  await page.goto("/admin/comunicacao/modelos/novo?tipo=design-personalizado");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Novo modelo de design Personalizado" })).toBeVisible();

  const previa = page.getByRole("region", { exact: true, name: "Prévia" });
  const aparelho = previa.getByRole("radiogroup", { name: "Aparelho da prévia" });
  const computador = previa.getByRole("figure", { name: "Prévia do pop-up no computador" });
  const celular = previa.getByRole("figure", { name: "Prévia do pop-up no celular" });
  await expect(aparelho.getByRole("radio", { name: "Computador" })).toBeChecked();
  await expect(computador).toBeVisible();
  await expect(celular).toHaveCount(0);

  await clicarAte(aparelho.getByText("Celular", { exact: true }), celular);
  await expect(aparelho.getByRole("radio", { name: "Celular" })).toBeChecked();
  await expect(computador).toHaveCount(0);

  // Com o design escolhido: o celular e o computador juntos, sem a escolha (como no editor do aviso).
  await card(page, "Design").getByRole("button", { exact: true, name: "Usar este modelo: Só texto" }).click();
  await expect(aparelho).toHaveCount(0);
  await expect(celular).toBeVisible();
  await expect(computador).toBeAttached();
});
