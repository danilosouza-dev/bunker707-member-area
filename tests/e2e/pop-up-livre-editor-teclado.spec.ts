import type { Locator, Page } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { applyFreeStarter } from "../../src/server/communications/popup-free-starters";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { contaDeTeste, expect, test, zerarComunicacao } from "./fixtures";
import { abrirEditorLivre, cliqueCom, escolhidos, falado, gravarRascunhoLivre, noPalco, zoomMostrado } from "./popup-livre-editor-fixtures";

// Editor Livre so pelo teclado (docs/27; spec §4.4, §4.5, §4.9 e §7.3; docs/18 §3.1): num pop-up Livre em
// rascunho (modelo "Em branco"), o produtor abre o editor com Enter (o foco vai para as Camadas), acrescenta um
// Título pelo painel Elementos e escreve nele, acrescenta uma Forma (solta) e move com as setas, sobe na lista com
// Alt + ↑, esconde com E e trava com T na linha, duplica com Ctrl + D, exclui com Delete e desfaz com Ctrl + Z. O
// Tab passa pela lista das Camadas uma vez so e o foco nunca sai do editor nem cai no vazio. Salvar com uma linha
// vazia abre o Revisar, e o item leva o foco a area de texto; com o "Nome do pop-up" vazio (um campo fora do
// editor), salvar mostra "Fechar o editor e revisar"; ao fechar, o foco volta para "Abrir editor Livre".
// L4b (docs/27 §13.10): num rascunho com [Título solto, Texto, duas Formas soltas, Links], varios pelo teclado. Nas
// Camadas, Shift + ↓ estende e Ctrl + Enter poe e tira; Delete exclui as duas e Ctrl + Z volta; Ctrl + A no palco
// escolhe os do mesmo nivel. Na troca do painel da direita (C11), o foco nunca cai no vazio: "Escolher só Título" no
// painel Vários leva o foco ao palco, Ctrl + A com o foco no painel de um elemento leva ao titulo do painel Vários, e o
// Esc no painel Vários deixa "Nada selecionado" com o foco no palco. Ctrl + = e Ctrl + − mudam o zoom do desenho. O
// Duplicar do painel Vários pelo Enter e o Ctrl + Z: as copias saem, o foco vai ao palco e o Ctrl + Shift + Z refaz sem
// escolher as copias de novo. O duplo clique no Título solto abre a area de texto dele; com Alt ou Shift, nao abre (C18).

const TITULO = "Pop-up E2E: Livre pelo teclado";
const ESCRITO = "Título pelo teclado";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
/** O rascunho do teste de varios (L4b): o Título solto embaixo da sequencia, duas Formas soltas e o Texto na sequencia. */
const TITULO_VARIOS = "Pop-up E2E: Livre com vários pelo teclado";
const COR = { fill: [{ color: "#38bdf8", kind: "solid" as const }], radius: 8 };
const CHILDREN_VARIOS: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], place: { mode: "free", w: 320, x: 40, y: 200 }, type: "heading" },
  { id: "texto", lines: [[{ text: "Veja o que mudou" }]], type: "text" },
  { box: COR, id: "fa", name: "Forma A", place: { h: 60, mode: "free", w: 60, x: 40, y: 300 }, type: "shape" },
  { box: COR, id: "fb", name: "Forma B", place: { h: 60, mode: "free", w: 60, x: 140, y: 300 }, type: "shape" },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const cta = { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" as const };
  const { design } = applyFreeStarter("blank", { audio: null, cta });
  const [linha] = unwrap(
    await db
      .from("campaigns")
      .insert({
        allow_snooze: true,
        audience: { kind: "everyone" },
        body: "",
        created_by: produtor.id,
        cta_href: cta.href,
        cta_label: cta.label,
        cta_target: cta.target,
        kind: "popup",
        popup_close: "any",
        popup_delay_seconds: 1,
        popup_design: design,
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

/** Onde o foco esta (id, atributos do editor, nome e se esta dentro do editor). */
async function foco(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;

    return {
      emLugarNenhum: !element || element === document.body,
      guarda: element?.hasAttribute("data-base-ui-focus-guard") ?? false,
      id: element?.id ?? "",
      layer: element?.hasAttribute("data-free-layer-select") ?? false,
      name: element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? "",
      noEditor: Boolean(element?.closest("[data-free-editor]")),
      stage: element?.hasAttribute("data-free-stage") ?? false,
      tab: element?.getAttribute("role") === "tab" ? (element.textContent?.trim() ?? "") : ""
    };
  });
}

type Foco = Awaited<ReturnType<typeof foco>>;

/** Tab (ou Shift + Tab) ate o foco chegar onde se quer; a cada tecla, o foco nunca se perde nem sai do editor. */
async function tabAte(page: Page, chegou: (atual: Foco) => boolean, opcoes: { max?: number; voltar?: boolean } = {}) {
  for (let passo = 0; passo < (opcoes.max ?? 60); passo += 1) {
    await page.keyboard.press(opcoes.voltar ? "Shift+Tab" : "Tab");
    // Do ultimo para o primeiro (e o contrario), o Tab passa pela guarda do Dialog, que devolve o foco ao editor no
    // quadro seguinte: espera esse quadro e confere onde o foco ficou.
    await expect.poll(async () => (await foco(page)).guarda, "a guarda do Dialog devolve o foco ao editor").toBe(false);
    const atual = await foco(page);
    expect(atual.emLugarNenhum, "o foco nunca cai no vazio").toBe(false);
    expect(atual.noEditor, `o foco fica no editor (${atual.name || atual.id})`).toBe(true);

    if (chegou(atual)) {
      return atual;
    }
  }

  throw new Error("O foco nao chegou onde devia pelo Tab.");
}

/** Os ids das linhas das Camadas, na ordem. */
async function linhas(editor: Locator) {
  return editor.locator("[data-free-layer-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-free-layer-row") ?? ""));
}

/** O elemento selecionado (a camada de selecao do palco) e quantos elementos estao desenhados. */
async function selecionado(editor: Locator) {
  return (await editor.locator("[data-free-selection]").getAttribute("data-free-selection")) ?? "";
}

async function desenhados(editor: Locator) {
  return editor.locator("[data-free-canvas-card] [data-free-id]").count();
}

/** A frase escondida do palco ("Selecionado: Forma, X 160, Y 200."). */
async function selecionadoNoPalco(editor: Locator) {
  return editor.locator("[data-free-stage]").evaluate((stage) => document.getElementById(stage.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
}

/** Do foco nas Camadas (ou no palco) para o painel Elementos e o botao do elemento. */
async function acrescentarPeloTeclado(page: Page, editor: Locator, nome: string) {
  await tabAte(page, (atual) => atual.tab === "Camadas" || atual.tab === "Elementos", { voltar: true });

  if ((await foco(page)).tab !== "Elementos") {
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
  }

  await expect(editor.getByRole("tab", { exact: true, name: "Elementos" })).toHaveAttribute("aria-selected", "true");
  await tabAte(page, (atual) => atual.name === nome || atual.name.startsWith(`${nome} `) || atual.name === nome.trim(), { max: 30 });
  await page.keyboard.press("Enter");
}

/** Das Camadas escondidas (painel Elementos aberto) para a lista, na linha do selecionado. */
async function voltarParaCamadas(page: Page, editor: Locator) {
  await tabAte(page, (atual) => atual.tab === "Camadas" || atual.tab === "Elementos", { voltar: true, max: 80 });

  if ((await foco(page)).tab !== "Camadas") {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
  }

  await expect(editor.getByRole("tab", { exact: true, name: "Camadas" })).toHaveAttribute("aria-selected", "true");
  return tabAte(page, (atual) => atual.layer, { max: 5 });
}

test("o editor Livre inteiro pelo teclado, com o foco sempre num lugar certo", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/admin/comunicacao/avisos/${avisoId}`);
  await page.waitForLoadState("networkidle");

  // Um campo fora do editor fica sem preencher (o "Nome do pop-up"): o salvar de dentro do editor avisa.
  await page.getByLabel("Nome do pop-up", { exact: true }).fill("");

  const design = page.getByRole("region", { exact: true, name: "Design" });
  const abrir = design.getByRole("button", { name: "Abrir editor Livre" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });

  await test.step("Enter abre o editor e o foco vai para a primeira linha das Camadas", async () => {
    await abrir.focus();
    await page.keyboard.press("Enter");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await foco(page)).layer).toBe(true);
    expect((await foco(page)).name).toMatch(/^Selecionar Título/);
  });

  await test.step("o Tab passa pela lista das Camadas uma vez so", async () => {
    const antes = await linhas(editor);
    expect(antes.length).toBeGreaterThan(2);
    await page.keyboard.press("Tab");
    const depois = await foco(page);
    expect(depois.layer, "um Tab sai da lista (as outras linhas e os botoes delas ficam fora do Tab)").toBe(false);
    expect(depois.noEditor).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect((await foco(page)).layer).toBe(true);
  });

  let titulo = "";

  await test.step("acrescenta um Título pelo painel Elementos e escreve nele", async () => {
    const antes = await desenhados(editor);
    await acrescentarPeloTeclado(page, editor, "Título");
    await expect.poll(() => desenhados(editor)).toBe(antes + 1);
    titulo = await selecionado(editor);
    expect(titulo).toMatch(/^titulo\d+$/);
    // O foco vai para a area de texto do Título novo.
    await expect.poll(async () => (await foco(page)).id).toBe(`livre-${titulo}-texto`);
    await page.keyboard.press("Control+a");
    await page.keyboard.type(ESCRITO);
    await expect(editor.locator(`[data-free-canvas-card] [data-free-id="${titulo}"]`)).toHaveText(ESCRITO);
  });

  let forma = "";

  await test.step("acrescenta uma Forma (solta) e move com as setas no palco", async () => {
    const antes = await desenhados(editor);
    await acrescentarPeloTeclado(page, editor, "Forma");
    await expect.poll(() => desenhados(editor)).toBe(antes + 1);
    forma = await selecionado(editor);
    expect(forma).not.toBe("");

    await tabAte(page, (atual) => atual.stage, { voltar: true, max: 40 });
    const inicio = (await selecionadoNoPalco(editor)).match(/X (-?\d+), Y (-?\d+)/);
    expect(inicio, "o palco diz o selecionado e onde ele esta").not.toBeNull();
    const [x, y] = [Number(inicio?.[1]), Number(inicio?.[2])];
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => selecionadoNoPalco(editor)).toContain(`X ${x + 3}, Y ${y + 10}.`);
    // Depois de mover pelas setas, a posicao e falada (500 ms depois).
    await expect(editor.locator("[aria-live='polite']").filter({ hasText: `X ${x + 3}, Y ${y + 10}.` })).toHaveCount(1);
  });

  await test.step("nas Camadas: Alt + ↑ sobe, E esconde, T trava, Ctrl + D duplica, Delete exclui e Ctrl + Z desfaz", async () => {
    const atual = await voltarParaCamadas(page, editor);
    expect(atual.name).toMatch(/^Selecionar Forma/);
    const ordem = await linhas(editor);
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await linhas(editor)).indexOf(forma)).toBe(ordem.indexOf(forma) - 1);
    expect((await foco(page)).layer, "o foco continua na linha que subiu").toBe(true);

    const esconder = editor.locator(`[data-free-layer-row="${forma}"]`).getByRole("button", { exact: true, name: "Esconder" });
    const travar = editor.locator(`[data-free-layer-row="${forma}"]`).getByRole("button", { exact: true, name: "Travar" });
    await page.keyboard.press("e");
    await expect(esconder).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("t");
    await expect(travar).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await page.keyboard.press("t");
    await expect(esconder).toHaveAttribute("aria-pressed", "false");
    await expect(travar).toHaveAttribute("aria-pressed", "false");

    const total = (await linhas(editor)).length;
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await linhas(editor)).length).toBe(total + 1);
    expect((await foco(page)).emLugarNenhum).toBe(false);
    await expect.poll(async () => (await foco(page)).layer).toBe(true);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await linhas(editor)).length).toBe(total);
    await expect.poll(async () => (await foco(page)).layer, "depois de excluir, o foco fica numa linha").toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await linhas(editor)).length).toBe(total + 1);
    expect((await foco(page)).noEditor).toBe(true);
  });

  await test.step("salvar com uma linha vazia abre o Revisar; o item leva o foco a area de texto", async () => {
    // Seleciona o Título novo pela lista e vai ate a area de texto dele.
    await voltarParaCamadas(page, editor).catch(() => undefined);
    const linhaDoTitulo = editor.locator(`[data-free-layer-row="${titulo}"] [data-free-layer-select]`);
    await linhaDoTitulo.focus();
    await page.keyboard.press("Enter");
    await tabAte(page, (atual) => atual.id === `livre-${titulo}-texto`, { max: 80 });
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("fim");

    await tabAte(page, (atual) => atual.name === "Salvar rascunho", { max: 120 });
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await foco(page)).name).toBe("Revisar");
    await expect(editor.getByText("Escreva algo nesta linha.", { exact: false }).first()).toBeVisible();
    await tabAte(page, (atual) => atual.name.includes("Escreva algo nesta linha.") || atual.name.includes("linha"), { max: 10 });
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await foco(page)).id).toBe(`livre-${titulo}-texto`);

    // Tira a linha vazia.
    await page.keyboard.press("Control+a");
    await page.keyboard.type(ESCRITO);
  });

  await test.step("um erro fora do editor mostra Fechar o editor e revisar; ao fechar, o foco volta para Abrir editor Livre", async () => {
    await tabAte(page, (atual) => atual.name === "Salvar rascunho", { max: 120 });
    await page.keyboard.press("Enter");
    await expect(editor.locator("[data-free-banner='outside']")).toContainText("Há campos para revisar fora do editor: Nome do pop-up.");
    await tabAte(page, (atual) => atual.name === "Fechar o editor e revisar", { max: 120 });
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(abrir).toBeFocused();
  });
});

test("Trocar de modelo pede confirmação e dá para desfazer no editor (Ctrl + Z volta ao design de antes)", async ({ page }) => {
  await page.goto(`/admin/comunicacao/avisos/${avisoId}`);
  await page.waitForLoadState("networkidle");
  const design = page.getByRole("region", { exact: true, name: "Design" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });

  await design.getByRole("button", { name: "Trocar de modelo" }).click();
  await design.getByRole("button", { name: "Usar este modelo: Só texto com brilho" }).click();
  const confirmar = page.getByRole("alertdialog", { name: "Trocar de modelo?" }).or(page.getByRole("dialog", { name: "Trocar de modelo?" }));
  await expect(confirmar.getByText("O design Livre atual será trocado pelo modelo. Dá para desfazer no editor.", { exact: true })).toBeVisible();
  await confirmar.getByRole("button", { exact: true, name: "Trocar" }).click();

  // O editor abre com o modelo novo; Ctrl + Z volta ao "Em branco" de antes (um passo), Ctrl + Shift + Z refaz.
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const primeiroTitulo = editor.locator("[data-free-canvas-card] h2");
  const doModelo = (await primeiroTitulo.textContent()) ?? "";
  expect(doModelo).not.toBe("Seu título aqui");
  await editor.locator("[data-free-stage]").focus();
  await page.keyboard.press("Control+z");
  await expect(primeiroTitulo).toHaveText("Seu título aqui");
  await page.keyboard.press("Control+Shift+z");
  await expect(primeiroTitulo).toHaveText(doModelo);
  await page.keyboard.press("Control+z");
  await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
  await expect(editor).toHaveCount(0);

  // O card Design volta ao "Em branco" (o rascunho segue o editor) e o foco volta para "Abrir editor Livre".
  await expect(design.getByRole("button", { name: "Abrir editor Livre" })).toBeFocused();
  await expect(page.getByRole("region", { exact: true, name: "Prévia" }).getByText("Seu título aqui").first()).toBeVisible();
});

test("vários pelo teclado, o foco na troca do painel Vários e o duplo clique no Título solto (L4b)", async ({ page }) => {
  test.setTimeout(180_000);
  const id = await gravarRascunhoLivre(TITULO_VARIOS, CHILDREN_VARIOS, { artboard: { minHeight: 380 } });
  const editor = await abrirEditorLivre(page, id);
  const frase = falado(editor);
  const palco = editor.locator("[data-free-stage]");
  const varios = editor.locator('[data-free-inspector="many"]');
  const linhaDe = (elemento: string) => editor.locator(`[data-free-layer-row="${elemento}"] [data-free-layer-select]`).first();
  const textoDoTitulo = editor.locator("#livre-titulo-texto");

  /** O foco nunca cai no vazio e nunca sai do editor. */
  async function focoNoEditor() {
    const atual = await foco(page);
    expect(atual.emLugarNenhum, "o foco nunca cai no vazio").toBe(false);
    expect(atual.noEditor, `o foco fica no editor (${atual.name || atual.id})`).toBe(true);
  }

  await test.step("nas Camadas, Shift + ↓ estende e Ctrl + Enter põe ou tira", async () => {
    await linhaDe("fa").focus();
    await page.keyboard.press("Enter");
    // Com um elemento, o desenho continua com o data-free-selection de antes.
    await expect.poll(() => selecionado(editor)).toBe("fa");

    await page.keyboard.press("Shift+ArrowDown");
    await expect(frase).toHaveText("2 elementos escolhidos.");
    await expect(linhaDe("fb")).toBeFocused();
    expect(await escolhidos(editor)).toEqual(["fa", "fb"]);

    await page.keyboard.press("Control+Enter");
    await expect(frase).toHaveText("Forma B saiu da seleção. 1 elemento.");
    expect(await selecionado(editor)).toBe("fa");
    await page.keyboard.press("Control+Enter");
    await expect(frase).toHaveText("Forma B entrou na seleção. 2 elementos.");
    expect(await escolhidos(editor)).toEqual(["fa", "fb"]);
    await expect(linhaDe("fb")).toBeFocused();
  });

  await test.step("Delete exclui as duas e Ctrl + Z volta, com o foco numa linha", async () => {
    await page.keyboard.press("Delete");
    await expect(frase).toHaveText("2 elementos excluídos. Ctrl + Z desfaz.");
    expect(await linhas(editor)).toEqual(["titulo", "texto", "links"]);
    // O foco vai para a linha que ficou no lugar da primeira excluida.
    await expect(linhaDe("links")).toBeFocused();

    await page.keyboard.press("Control+z");
    await expect(frase).toHaveText("Desfeito.");
    expect(await linhas(editor)).toEqual(["titulo", "texto", "fa", "fb", "links"]);
    await focoNoEditor();
  });

  await test.step("Ctrl + A no palco escolhe os do mesmo nível; Escolher só Título leva o foco ao palco", async () => {
    await palco.focus();
    await page.keyboard.press("Control+a");
    await expect(frase).toHaveText("5 elementos escolhidos.");
    expect(await escolhidos(editor)).toHaveLength(5);
    await expect(varios.getByRole("heading", { exact: true, name: "5 elementos selecionados" })).toBeVisible();
    await expect(palco).toBeFocused();

    // C11: o painel Vários some com o foco dentro dele; o foco vai ao palco.
    const soTitulo = varios.getByRole("button", { exact: true, name: "Escolher só Título" });
    await soTitulo.focus();
    await expect(soTitulo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(varios).toHaveCount(0);
    expect(await selecionado(editor)).toBe("titulo");
    await expect(palco).toBeFocused();
  });

  await test.step("Ctrl + A com o foco no painel de um elemento leva o foco ao título do painel Vários; o Esc nele deixa Nada selecionado", async () => {
    const conteudo = editor.getByRole("tab", { exact: true, name: "Conteúdo" });

    await conteudo.focus();
    await expect(conteudo).toBeFocused();
    await page.keyboard.press("Control+a");
    await expect(frase).toHaveText("5 elementos escolhidos.");
    await expect(editor.locator("#livre-varios-titulo")).toBeFocused();

    // C11: o Esc no painel Vários vai a nada (todos estao na prancheta) e o foco vai ao palco.
    await page.keyboard.press("Escape");
    await expect(varios).toHaveCount(0);
    expect(await escolhidos(editor)).toEqual([]);
    await expect(palco).toBeFocused();
    expect(await selecionadoNoPalco(editor)).toBe("Nada selecionado.");
  });

  await test.step("Ctrl + = e Ctrl + − com o foco no palco mudam o zoom do desenho", async () => {
    const antes = await zoomMostrado(editor);

    await page.keyboard.press("Control+Equal");
    await expect(frase).toHaveText(/^Zoom \d+ %\.$/);
    const depois = await zoomMostrado(editor);
    expect(depois).not.toBe(antes);
    await expect(frase).toHaveText(`Zoom ${depois}.`);
    await page.keyboard.press("Control+Minus");
    await expect(frase).not.toHaveText(`Zoom ${depois}.`);
    await expect(frase).toHaveText(/^Zoom \d+ %\.$/);
    await expect(palco).toBeFocused();
  });

  await test.step("C11 no desfazer: Duplicar no painel Vários pelo Enter; o Ctrl + Z leva o foco ao palco e o Ctrl + Shift + Z refaz", async () => {
    await linhaDe("fa").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => selecionado(editor)).toBe("fa");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(frase).toHaveText("2 elementos escolhidos.");

    // No WebKit o clique nao da foco a botao: o Duplicar vai pelo teclado.
    const duplicar = varios.getByRole("button", { exact: true, name: "Duplicar" });
    await duplicar.focus();
    await page.keyboard.press("Enter");
    await expect(frase).toHaveText("2 elementos duplicados.");
    const comCopias = await linhas(editor);
    expect(comCopias).toHaveLength(7);
    expect(await escolhidos(editor)).toHaveLength(2);
    await expect(duplicar).toBeFocused();

    // As copias saem e o painel Varios some com o foco dentro: o foco vai ao palco, e o Ctrl + Shift + Z chega ao editor.
    await page.keyboard.press("Control+z");
    await expect(frase).toHaveText("Desfeito.");
    expect(await linhas(editor)).toEqual(["titulo", "texto", "fa", "fb", "links"]);
    await expect(varios).toHaveCount(0);
    await expect(palco).toBeFocused();

    await page.keyboard.press("Control+Shift+z");
    await expect(frase).toHaveText("Refeito.");
    expect(await linhas(editor)).toEqual(comCopias);
    // O refazer nao devolve a escolha das copias, que a equipe nao fez de novo.
    expect(await escolhidos(editor)).toEqual([]);
    await expect(palco).toBeFocused();
    await focoNoEditor();
  });

  await test.step("C18: o duplo clique no Título solto abre a área de texto; com Alt ou com Shift, não abre", async () => {
    await cliqueCom(page, noPalco(editor, "titulo"), [], { duplo: true });
    await expect(textoDoTitulo).toBeFocused();
    expect(await selecionado(editor)).toBe("titulo");

    // Com a aba Avançado aberta e o foco no palco: Alt + duplo clique escolhe pela pilha, mas nao abre o texto.
    const avancado = editor.getByRole("tab", { exact: true, name: "Avançado" });
    await avancado.click();
    await expect(avancado).toHaveAttribute("aria-selected", "true");
    await palco.focus();
    await cliqueCom(page, noPalco(editor, "titulo"), ["Alt"], { duplo: true });
    await expect(frase).toHaveText("Selecionado: Título (1 de 1 neste ponto).");
    await expect(avancado).toHaveAttribute("aria-selected", "true");
    await expect(textoDoTitulo).toHaveCount(0);
    await expect(palco).toBeFocused();

    // Shift + duplo clique tira e poe na selecao, e tambem nao abre o texto.
    await cliqueCom(page, noPalco(editor, "titulo"), ["Shift"], { duplo: true });
    await expect(frase).toHaveText("Título entrou na seleção. 1 elemento.");
    await expect(textoDoTitulo).not.toBeFocused();
    await expect(palco).toBeFocused();
    await focoNoEditor();
  });
});
