import type { Locator, Page } from "@playwright/test";
import { popupStarterDesign } from "../../src/server/communications/popup-design-model";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { contaDeTeste, expect, test, zerarComunicacao } from "./fixtures";

// Acabamento do Livre (docs/27 L1.1; docs/18 §3.1): num pop-up em rascunho com o design Personalizado ("Só texto"),
// o produtor escolhe Livre e "Usar o design Personalizado" (o editor abre com os textos e o botao dele), copia o
// design (o JSON canonico vai para a area de transferencia, sem endereco), muda o titulo e cola o design de volta
// pela area de transferencia (um passo so: Ctrl + Z volta a mudanca, Ctrl + Shift + Z refaz), ve a frase de um texto
// que nao e JSON, cola um design com uma imagem de outro pop-up (a Imagem fica vazia e o Revisar pede a imagem),
// copia as instrucoes para a IA e salva o rascunho: o gravado e o Livre com o titulo do Personalizado. Por fim, troca
// para o modelo "Imagem recortada com selo" (a imagem comeca vazia, o selo inclinado) e Ctrl + Z volta. Com
// E2E_SHOTS_DIR, guarda as fotos do card, do menu, do dialogo e do modelo novo (computador e celular).

const TITULO = "Pop-up E2E: copiar e colar o Livre";
const TITULO_DO_PERSONALIZADO = "Conteúdo novo na sua área";
const OUTRO_TITULO = "Outro título";
const CTA = { href: "/minhas-compras", label: "Quero ver", target: "same_tab" as const };
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const IMAGEM_DE_OUTRO_POPUP = "communications/free/fedcba9876543210fedcba98.webp";
const SHOTS = process.env.E2E_SHOTS_DIR;

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const [linha] = unwrap(
    await db
      .from("campaigns")
      .insert({
        allow_snooze: true,
        audience: { kind: "everyone" },
        body: "",
        created_by: produtor.id,
        cta_href: CTA.href,
        cta_label: CTA.label,
        cta_target: CTA.target,
        kind: "popup",
        popup_close: "any",
        popup_delay_seconds: 1,
        popup_design: popupStarterDesign("text_only"),
        popup_exclude_pages: [],
        popup_frequency: "once",
        popup_pages: ["home"],
        popup_repeat: "once",
        popup_snooze_minutes: 1_440,
        popup_stop_on: null,
        popup_trigger: "page_load",
        status: "draft",
        title: TITULO,
        updated_by: produtor.id
      })
      .select("id"),
    `Gravando o rascunho "${TITULO}"`
  ) as { id: string }[];
  avisoId = linha.id;
});

test.afterAll(zerarComunicacao);

/** A linha das Camadas (o botao de selecionar) cujo nome comeca com o texto. */
function camada(editor: Locator, comeco: string) {
  return editor.locator("[data-free-layer-select]").filter({ hasText: comeco }).first();
}

/** O elemento do design desenhado no palco do editor. */
function noPalco(editor: Locator, id: string) {
  return editor.locator(`[data-free-canvas-card] [data-free-id="${id}"]`).first();
}

/** Abre "Copiar e colar" e escolhe a acao. */
async function copiarEColar(page: Page, editor: Locator, acao: "copy" | "instructions" | "paste") {
  await editor.locator("[data-free-transfer]").click();
  await page.locator(`[data-free-transfer-action="${acao}"]`).click();
}

test("usa o design Personalizado no Livre, copia e cola o design e copia as instruções para a IA", async ({ browserName, context, page }) => {
  test.setTimeout(180_000);
  // O WebKit so conhece a permissao de ler (escrever, depois de um clique, ja vale); o Chromium pede as duas.
  await context.grantPermissions(browserName === "webkit" ? ["clipboard-read"] : ["clipboard-read", "clipboard-write"]);
  await page.goto(`/admin/comunicacao/avisos/${avisoId}`);
  await page.waitForLoadState("networkidle");

  const design = page.getByRole("region", { exact: true, name: "Design" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });
  const falado = editor.locator("[data-free-live]");

  await test.step("no Livre, “Usar o design Personalizado” abre o editor com os textos e o botão do Personalizado", async () => {
    await design.getByText("Livre", { exact: true }).click();
    const opcao = design.locator("[data-free-from-custom]");
    await expect(opcao).toContainText("Seu design Personalizado");
    await expect(design.getByRole("button", { name: "Usar este modelo: Imagem recortada com selo" })).toBeVisible();

    if (SHOTS) {
      await design.screenshot({ path: `${SHOTS}/l11-card-modelos-1440.png` });
    }

    await opcao.getByRole("button", { exact: true, name: "Usar o design Personalizado" }).click();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(noPalco(editor, "titulo")).toHaveText(TITULO_DO_PERSONALIZADO);
    await expect(noPalco(editor, "selo")).toContainText("Novidade");
    await expect(noPalco(editor, "botao")).toContainText(CTA.label);

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/l11-editor-do-personalizado-1440.png` });
      await page.setViewportSize({ height: 768, width: 1024 });
      await page.screenshot({ path: `${SHOTS}/l11-editor-barra-1024.png` });
      await page.setViewportSize({ height: 900, width: 1440 });
    }
  });

  let copiado = "";

  await test.step("copiar o design: o JSON canônico vai para a área de transferência, sem endereço", async () => {
    if (SHOTS) {
      await editor.locator("[data-free-transfer]").click();
      await expect(page.locator('[data-free-transfer-action="copy"]')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/l11-menu-copiar-e-colar-1440.png` });
      await page.keyboard.press("Escape");
    }

    await copiarEColar(page, editor, "copy");
    await expect(falado).toHaveText("Design copiado.");
    copiado = await page.evaluate(() => navigator.clipboard.readText());
    const json = JSON.parse(copiado) as { children: { id: string; lines?: { text: string }[][] }[]; mode: string };
    expect(json.mode).toBe("free");
    expect(json.children.find((node) => node.id === "titulo")?.lines?.[0]?.[0]?.text).toBe(TITULO_DO_PERSONALIZADO);
    expect(copiado).not.toMatch(/https?:/);
  });

  await test.step("muda o título e cola o design de volta: um passo só no histórico", async () => {
    await camada(editor, "Conteúdo novo").click();
    await editor.locator("#livre-titulo-texto").fill(OUTRO_TITULO);
    await expect(noPalco(editor, "titulo")).toHaveText(OUTRO_TITULO);

    await copiarEColar(page, editor, "paste");
    const dialogo = page.getByRole("dialog", { name: "Colar o design" });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { exact: true, name: "Colar da área de transferência" }).click();
    await expect(dialogo.getByLabel("Design em JSON", { exact: true })).toHaveValue(copiado);
    await dialogo.getByRole("button", { exact: true, name: "Usar este design" }).click();
    await expect(dialogo).toBeHidden();
    await expect(noPalco(editor, "titulo")).toHaveText(TITULO_DO_PERSONALIZADO);
    await expect(falado).toHaveText("Design colado. Ctrl + Z desfaz.");

    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
    await expect(noPalco(editor, "titulo")).toHaveText(OUTRO_TITULO);
    await page.keyboard.press("Control+Shift+z");
    await expect(noPalco(editor, "titulo")).toHaveText(TITULO_DO_PERSONALIZADO);
  });

  await test.step("colar um texto que não é JSON mostra a frase; uma imagem de outro pop-up fica vazia", async () => {
    await copiarEColar(page, editor, "paste");
    const dialogo = page.getByRole("dialog", { name: "Colar o design" });
    const campo = dialogo.getByLabel("Design em JSON", { exact: true });
    await campo.fill("{ isto não é um design");
    await dialogo.getByRole("button", { exact: true, name: "Usar este design" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Não deu para ler o texto colado. Copie o design inteiro, do primeiro { ao último }.");
    await expect(campo).toBeFocused();

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/l11-colar-erro-1440.png` });
    }

    await campo.fill(
      JSON.stringify({
        assets: [{ height: 48, id: "foto", kind: "image", path: IMAGEM_DE_OUTRO_POPUP, width: 64 }],
        children: [
          { id: "titulo", lines: [[{ text: "Da IA" }]], type: "heading" },
          { asset: "foto", id: "imagem", type: "image" },
          { action: { kind: "cta" }, id: "botao", type: "button" },
          { id: "links", type: "links" }
        ],
        mode: "free",
        version: 1
      })
    );
    await dialogo.getByRole("button", { exact: true, name: "Usar este design" }).click();
    await expect(dialogo).toBeHidden();
    await expect(noPalco(editor, "titulo")).toHaveText("Da IA");
    await expect(falado).toContainText("1 arquivo não é deste pop-up e ficou de fora");
    await expect(noPalco(editor, "imagem")).toBeVisible();
    await expect(noPalco(editor, "imagem").locator("img")).toHaveCount(0);

    await editor.locator("[data-free-review-toggle]").click();
    await expect(editor.getByText("Escolha a imagem deste elemento.", { exact: true })).toBeVisible();
    await editor.locator("[data-free-review-back]").click();

    // Ctrl + Z volta ao design de antes da colagem.
    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
    await expect(noPalco(editor, "titulo")).toHaveText(TITULO_DO_PERSONALIZADO);
    await expect(noPalco(editor, "imagem")).toHaveCount(0);
  });

  await test.step("copiar as instruções para a IA: o contrato do JSON (docs/27 §9)", async () => {
    await copiarEColar(page, editor, "instructions");
    await expect(falado).toHaveText("Instruções copiadas. Cole na conversa com a IA junto com o design.");
    const instrucoes = await page.evaluate(() => navigator.clipboard.readText());
    expect(instrucoes.startsWith("Você vai escrever o design de um pop-up")).toBe(true);
    expect(instrucoes).toContain("### 9.9 Exemplos");
  });

  await test.step("salva o rascunho e conclui: o gravado é o Livre com o título do Personalizado", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(falado).toHaveText("Rascunho salvo.");
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
    await expect(design.getByText(/^\d+ elementos · 440 px$/)).toBeVisible();

    const db = createLocalAdminClient();
    const salvo = unwrap(await db.from("campaigns").select("popup_design,cta_label").eq("id", avisoId).single(), "Lendo o pop-up") as {
      cta_label: string;
      popup_design: { children: { id: string; lines?: { text: string }[][]; type: string }[]; mode: string };
    };
    expect(salvo.popup_design.mode).toBe("free");
    expect(salvo.cta_label).toBe(CTA.label);
    expect(salvo.popup_design.children.find((node) => node.id === "titulo")?.lines?.[0]?.[0]?.text).toBe(TITULO_DO_PERSONALIZADO);
    expect(salvo.popup_design.children.some((node) => node.type === "button")).toBe(true);
  });

  await test.step("Trocar de modelo › Imagem recortada com selo: a imagem começa vazia e Ctrl + Z volta", async () => {
    await design.getByRole("button", { name: "Trocar de modelo" }).click();
    await design.getByRole("button", { name: "Usar este modelo: Imagem recortada com selo" }).click();
    const confirmar = page.getByRole("alertdialog", { name: "Trocar de modelo?" }).or(page.getByRole("dialog", { name: "Trocar de modelo?" }));
    await confirmar.getByRole("button", { exact: true, name: "Trocar" }).click();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(noPalco(editor, "selo")).toHaveText("Aula bônus");
    await expect(noPalco(editor, "foto")).toBeVisible();
    await expect(noPalco(editor, "foto").locator("img")).toHaveCount(0);
    await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 480);

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/l11-modelo-imagem-recortada-1440.png` });
      await editor.locator('[data-free-segment="mobile"]').click();
      await page.screenshot({ path: `${SHOTS}/l11-modelo-imagem-recortada-celular.png` });
      await editor.locator('[data-free-segment="desktop"]').click();
    }

    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
    await expect(noPalco(editor, "titulo")).toHaveText(TITULO_DO_PERSONALIZADO);
    await expect(noPalco(editor, "foto")).toHaveCount(0);
  });
});
