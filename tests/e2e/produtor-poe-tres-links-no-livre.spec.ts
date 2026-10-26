import type { Locator, Page } from "@playwright/test";
import type { FreeDevices, FreeNode } from "../../src/server/communications/popup-free-model";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { abrirComoProdutor, estadoDoPopUpDaAluna, eventosDoPopUp, expect, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";
import { TELA_DO_EDITOR, botaoDaCamada, falado, gravarRascunhoLivre, lerDesignDoAviso, prancheta } from "./popup-livre-editor-fixtures";

// Livre: ate 3 "Abrir um link" (docs/27 §13.10, L45, L46 e L47; decisoes 3 e 4 do produtor; docs/18 §3.1). Num
// rascunho com [Título, Botão principal, um "Abrir um link" para o Perfil, dois "Fechar", Links] (o Botão principal
// semeado com o botao do aviso), o Botão principal e o link do Perfil escondidos so no celular, o produtor liga "Mais
// de uma vez": "Quando o aluno clica no botão" fica desligada (D9 por aparelho: o computador tem dois botoes que contam,
// mas o celular nenhum). No editor, pelo teclado, os dois "Fechar" viram "Abrir um link" (a pilula nunca desliga), cada
// um com um destino e um texto; o Elementos › Botão desliga com "Use até 3 botões além do principal.". Com os links
// visiveis no celular, "Quando o aluno clica no botão" liga, e o pop-up e publicado. A aluna, a 1440 px, clica no 2º
// link: vai ao destino, o clique fica gravado e o message_clicked leva metadata.button "link:<id>" (decisao 4); com o
// pop-up de volta, o Botão principal grava "cta". Funciona no WebKit: o foco posto pelo teclado antes de cada tecla
// (Espaco nas pilulas), a prancheta montada antes do primeiro passo e as esperas pela tela antes de ler o banco.

const TITULO = "Pop-up E2E: o produtor põe três links no Livre";
/** O nome do pop-up para a aluna: o texto do Título do design. */
const NOME_DO_POP_UP = "Aula nova no ar";
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: NOME_DO_POP_UP }]], type: "heading" },
  // O Botão principal: o rascunho grava o botao do aviso junto ("Saiba mais", para Minhas compras).
  { action: { kind: "cta" }, id: "botao", type: "button" },
  { action: { href: "/perfil", kind: "link", target: "same_tab" }, id: "l1", label: "Meu perfil", type: "button" },
  { action: { kind: "close" }, id: "l2", label: "Agora não", type: "button" },
  { action: { kind: "close" }, id: "l3", label: "Fechar aviso", type: "button" },
  { id: "links", type: "links" }
];
/** So no celular: o Botão principal e o link do Perfil escondidos (o celular fica sem nada que conte como o clique). */
const DEVICES: FreeDevices = { mobile: { nodes: { botao: { hidden: true }, l1: { hidden: true } } } };

test.describe.configure({ mode: "serial" });
// A pagina do teste e a da aluna; o produtor usa uma aba propria (abrirComoProdutor).
test.use({ viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { devices: DEVICES });
});

test.afterAll(zerarComunicacao);

/** O card do aviso pelo titulo (SectionCard: uma regiao com o nome do h2). */
function card(pagina: Page, titulo: string) {
  return pagina.getByRole("region", { exact: true, name: titulo });
}

/** "Quando o aluno clica no botão" no card "Quantas vezes e como fecha". */
function pararNoClique(pagina: Page) {
  return card(pagina, "Quantas vezes e como fecha").getByRole("radiogroup", { name: "O que faz o pop-up parar de aparecer" }).getByRole("radio", { name: "Quando o aluno clica no botão" });
}

/** Marca uma pilula (radio) pelo teclado: o foco nela e o Espaco. */
async function marcarPeloTeclado(pagina: Page, pilula: Locator) {
  await pilula.focus();
  await expect(pilula).toBeFocused();
  await pagina.keyboard.press("Space");
  await expect(pilula).toBeChecked();
}

/**
 * Um "Fechar" vira "Abrir um link" pelo teclado: a linha das Camadas com Enter, a pilula "Abrir um link" (nunca
 * desligada), "Página da área" e a pagina, e o texto do botao.
 */
async function virarLink(pagina: Page, editor: Locator, id: string, destino: string, texto: string) {
  await botaoDaCamada(editor, id).focus();
  await pagina.keyboard.press("Enter");
  await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", id);

  const acao = editor.getByRole("radiogroup", { name: "O que o botão faz" });
  const abrirUmLink = acao.getByRole("radio", { exact: true, name: "Abrir um link" });

  await expect(acao.getByRole("radio", { exact: true, name: "Fechar" })).toBeChecked();
  await expect(abrirUmLink).toBeEnabled();
  await marcarPeloTeclado(pagina, abrirUmLink);
  await marcarPeloTeclado(pagina, editor.getByRole("radiogroup", { name: "Para onde leva" }).getByRole("radio", { exact: true, name: "Página da área" }));
  await marcarPeloTeclado(pagina, editor.getByRole("radiogroup", { exact: true, name: "Página" }).getByRole("radio", { exact: true, name: destino }));
  await expect(editor.getByText("O clique neste botão conta como o clique do pop-up.", { exact: true })).toBeVisible();

  const campo = editor.locator(`#livre-${id}-botao-texto`);
  await campo.focus();
  await pagina.keyboard.press("Control+a");
  await pagina.keyboard.type(texto);
  await expect(campo).toHaveValue(texto);
}

async function lerAviso() {
  const db = createLocalAdminClient();

  return unwrap(await db.from("campaigns").select("popup_frequency,popup_stop_on,status").eq("id", avisoId).single(), "Lendo o pop-up") as {
    popup_frequency: string;
    popup_stop_on: string | null;
    status: string;
  };
}

/** Os botoes gravados no message_clicked da aluna, na ordem. */
async function botoesClicados() {
  return (await eventosDoPopUp(avisoId)).filter((evento) => evento.event_type === "message_clicked").map((evento) => evento.metadata.button ?? null);
}

test("até 3 Abrir um link: o D9 por aparelho, o 4º botão recusado, publicar e o botão clicado gravado", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const { fechar, pagina } = await abrirComoProdutor(browser, { viewport: TELA_DO_EDITOR });

  try {
    const design = card(pagina, "Design");
    const editor = pagina.getByRole("dialog", { name: "Editor Livre" });

    await test.step("Mais de uma vez: Quando o aluno clica no botão desligada, porque o celular não tem nada que conte", async () => {
      await pagina.goto(`/admin/comunicacao/avisos/${avisoId}`);
      await pagina.waitForLoadState("networkidle");
      const vezes = card(pagina, "Quantas vezes e como fecha");

      await vezes.getByRole("radiogroup", { name: "Quantas vezes o pop-up aparece" }).getByText("Mais de uma vez", { exact: true }).click();
      await expect(vezes.getByRole("radio", { name: "Mais de uma vez" })).toBeChecked();
      // O computador tem o Botão principal e o link do Perfil, mas o celular nao tem nenhum: a regra vale por aparelho.
      await expect(pararNoClique(pagina)).toBeDisabled();
      await expect(vezes.getByRole("radio", { name: "Só quando o pop-up terminar" })).toBeChecked();
    });

    await test.step("no editor, pelo teclado, os dois Fechar viram Abrir um link, cada um com destino e texto", async () => {
      await design.getByRole("button", { name: "Abrir editor Livre" }).click();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(prancheta(editor)).toBeVisible();

      await virarLink(pagina, editor, "l2", "Favoritos", "Ver favoritos");
      await virarLink(pagina, editor, "l3", "Início", "Voltar ao início");
    });

    await test.step("com 3 botões além do principal, o Elementos › Botão desliga com o motivo", async () => {
      await editor.getByRole("tab", { exact: true, name: "Elementos" }).click();
      const botao = editor.locator('[data-free-element="button"]');

      await expect(botao).toHaveAttribute("aria-disabled", "true");
      await expect(botao).toHaveAccessibleDescription("Use até 3 botões além do principal.");
      await expect(botao).toHaveAttribute("title", "Use até 3 botões além do principal.");
      await expect(editor.locator('[data-free-element="heading"]')).not.toHaveAttribute("aria-disabled", "true");
    });

    await test.step("Salvar rascunho grava os três links; com eles no celular, Quando o aluno clica no botão liga e o pop-up é publicado", async () => {
      await editor.getByRole("button", { name: "Salvar rascunho" }).click();
      await expect(falado(editor)).toHaveText("Rascunho salvo.");

      const gravado = await lerDesignDoAviso(avisoId);
      const acoes = Object.fromEntries((gravado?.children ?? []).flatMap((node) => (node.type === "button" ? [[node.id, node.action]] : [])));
      expect(acoes).toEqual({
        botao: { kind: "cta" },
        l1: { href: "/perfil", kind: "link", target: "same_tab" },
        l2: { href: "/favoritos", kind: "link", target: "same_tab" },
        l3: { href: "/", kind: "link", target: "same_tab" }
      });

      await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
      await expect(editor).toHaveCount(0);

      const parar = pararNoClique(pagina);
      await expect(parar).toBeEnabled();
      await card(pagina, "Quantas vezes e como fecha").getByText("Quando o aluno clica no botão", { exact: true }).click();
      await expect(parar).toBeChecked();

      await pagina.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
      await expect(pagina.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });
      await expect(pagina).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${avisoId}$`));

      const aviso = await lerAviso();
      expect(aviso).toEqual({ popup_frequency: "repeat", popup_stop_on: "click", status: "active" });
      expect((await lerDesignDoAviso(avisoId))?.mode, "o Livre continua gravado depois de publicar").toBe("free");
    });
  } finally {
    await fechar();
  }

  await test.step("a aluna clica no 2º link: vai ao destino, o clique conta e o message_clicked diz qual botão", async () => {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: NOME_DO_POP_UP });
    await expect(popUp).toBeVisible();
    await expect(popUp.locator("[data-popup-free]")).toBeVisible();
    // No computador, o Botão principal e os tres "Abrir um link", na ordem do design.
    await expect(popUp.locator('a[data-free-button="cta"]')).toHaveText("Saiba mais");
    await expect(popUp.locator('a[data-free-button="link"]')).toHaveText(["Meu perfil", "Ver favoritos", "Voltar ao início"]);

    await popUp.getByRole("link", { exact: true, name: "Ver favoritos" }).click();
    await expect(page).toHaveURL(/\/favoritos$/);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.clickedAt ?? null).not.toBeNull();
    await expect.poll(botoesClicados).toEqual(["link:l2"]);
    expect((await eventosDoPopUp(avisoId)).find((evento) => evento.event_type === "message_clicked")?.metadata).toMatchObject({ button: "link:l2", campaign_id: avisoId });
  });

  await test.step("com o pop-up de volta, o Botão principal grava cta", async () => {
    await reabrirPopUpParaAluna(TITULO);
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: NOME_DO_POP_UP });
    await expect(popUp).toBeVisible();

    await popUp.getByRole("link", { exact: true, name: "Saiba mais" }).click();
    await expect(page).toHaveURL(/\/minhas-compras$/);
    await expect.poll(botoesClicados).toEqual(["link:l2", "cta"]);
  });
});
