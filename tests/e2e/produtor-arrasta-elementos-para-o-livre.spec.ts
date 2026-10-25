import type { Locator } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  arrastar,
  caixaParada,
  centroDe,
  daPrancheta,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  noPalco,
  pontoNaPrancheta,
  prancheta,
  type Ponto
} from "./popup-livre-editor-fixtures";

// Arrastar do painel Elementos para o desenho do Livre (docs/27 §13.9, L4a; docs/18 §3.1): num pop-up Livre em
// rascunho, o produtor ve a dica de 12 px no topo do painel, arrasta o Texto ate o vao entre o Titulo e a Caixa (a
// linha de onde entra e a ficha com o nome aparecem antes de soltar; o Texto entra em segundo, selecionado e com o
// foco na area de texto, num passo so do Ctrl + Z), arrasta outro Texto ate entre os dois Icones da Caixa em linha
// (entra dentro dela, pelo x), arrasta a Forma ate um ponto (o centro fica onde soltou: X e Y do Avançado), solta
// fora da prancheta e no proprio painel (nada entra), aperta Esc no meio (nada entra e a selecao fica), clica no
// Selo logo depois (entra um so) e salva o rascunho: o gravado tem tudo isso, sem nenhum elemento a mais.
// Semeado com um Fechar ("Agora não") e sem o Botão principal: o aviso fica sem botao e o Revisar nao pede nada.
// So mouse e teclado, com o mouse sempre dentro da janela (WebKit).

const TITULO = "Pop-up E2E: arrastar do painel Elementos";
const ICONE = 40;

const SEMEADO: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  {
    box: { padding: [8, 8] },
    children: [
      { icon: "sparkles", id: "icone1", size: ICONE, type: "icon" },
      { icon: "star", id: "icone2", size: ICONE, type: "icon" }
    ],
    id: "caixa",
    layout: { align: "center", dir: "row", gap: 24 },
    type: "box"
  },
  { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, SEMEADO);
});

test.afterAll(zerarComunicacao);

/** O botao do painel Elementos deste tipo. */
function botao(editor: Locator, kind: string) {
  return editor.locator(`[data-free-element="${kind}"]`);
}

/** Quantos elementos estao desenhados no palco. */
function desenhados(editor: Locator) {
  return editor.locator("[data-free-canvas-card] [data-free-id]").count();
}

/** O elemento selecionado (a camada de selecao do palco). */
async function selecionado(editor: Locator) {
  return (await editor.locator("[data-free-selection]").getAttribute("data-free-selection")) ?? "";
}

/** Os elementos do palco na ordem do desenho, com o id da caixa de fora (null na prancheta). */
function noDesenho(editor: Locator): Promise<{ id: string; pai: string | null }[]> {
  return editor.locator("[data-free-canvas-card] [data-free-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-free-id") ?? "",
      pai: node.parentElement?.closest("[data-free-id]")?.getAttribute("data-free-id") ?? null
    }))
  );
}

/** O meio do botao do painel (depois de o painel parar). */
async function doPainel(editor: Locator, kind: string): Promise<Ponto> {
  return centroDe(await caixaParada(botao(editor, kind)));
}

async function numeroDe(campo: Locator) {
  return Number((await campo.inputValue()).replace(",", "."));
}

/** Os elementos do design, de todas as caixas. */
function todos(nodes: readonly FreeNode[]): FreeNode[] {
  return nodes.flatMap((node) => (node.type === "box" ? [node, ...todos(node.children)] : [node]));
}

test("arrasta elementos do painel para o desenho do Livre: entra onde soltou, um passo, e nada entra fora ou com Esc", async ({ page }) => {
  test.setTimeout(180_000);
  const editor = await abrirEditorLivre(page, avisoId);
  const linha = editor.locator("[data-free-drop-line]");
  const caixaDeDestino = editor.locator("[data-free-drop-target]");
  const soltoNovo = editor.locator("[data-free-drop-new]");
  const ficha = editor.locator("[data-free-element-chip]");
  const inicial = await desenhados(editor);
  let texto = "";
  let texto2 = "";
  let forma = "";
  let lugarDaForma = { x: 0, y: 0 };

  await test.step("o painel Elementos tem a dica de 12 px no topo", async () => {
    const aba = editor.getByRole("tab", { exact: true, name: "Elementos" });

    await aba.click();
    await expect(aba).toHaveAttribute("aria-selected", "true");
    const dica = editor.getByText("Clique para acrescentar ou arraste até o lugar no desenho.", { exact: true });
    await expect(dica).toBeVisible();
    await expect(dica).toHaveCSS("font-size", "12px");
  });

  await test.step("arrasta o Texto até o vão entre o Título e a Caixa: entra em segundo, selecionado, e Ctrl + Z tira num passo", async () => {
    const de = await doPainel(editor, "text");
    const titulo = await caixaParada(noPalco(editor, "titulo"));
    const caixa = await caixaParada(noPalco(editor, "caixa"));
    const para = { x: Math.round(titulo.x + titulo.width / 2), y: Math.round((titulo.y + titulo.height + caixa.y) / 2) };

    await arrastar(page, de, para, {
      antesDeSoltar: async () => {
        // A linha de onde entra (na prancheta, sem o contorno de uma caixa) e a ficha com o nome seguindo o ponteiro.
        await expect(linha).toHaveCount(1);
        await expect(caixaDeDestino).toHaveCount(0);
        await expect(ficha).toBeVisible();
        await expect(ficha).toHaveText("Texto");
        await expect(ficha).toHaveAttribute("aria-hidden", "true");
        await expect(editor.locator('[data-free-element="text"][data-free-element-dragging]')).toHaveCount(1);
      }
    });

    await expect(falado(editor)).toHaveText("Texto adicionado.");
    await expect(ficha).toHaveCount(0);
    await expect(linha).toHaveCount(0);
    await expect(editor.locator("[data-free-element-dragging]")).toHaveCount(0);
    texto = await selecionado(editor);
    expect(texto).toMatch(/^texto\d*$/);
    await expect(editor.locator(`#livre-${texto}-texto`)).toBeFocused();
    await expect.poll(() => desenhados(editor)).toBe(inicial + 1);
    expect((await noDesenho(editor)).map((node) => node.id).slice(0, 3)).toEqual(["titulo", texto, "caixa"]);

    // Um passo so: Ctrl + Z tira o Texto e Ctrl + Shift + Z poe de volta no mesmo lugar.
    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
    await expect(noPalco(editor, texto)).toHaveCount(0);
    await expect.poll(() => desenhados(editor)).toBe(inicial);
    await page.keyboard.press("Control+Shift+z");
    await expect(noPalco(editor, texto)).toHaveCount(1);
    expect((await noDesenho(editor)).map((node) => node.id).slice(0, 3)).toEqual(["titulo", texto, "caixa"]);
  });

  await test.step("arrasta outro Texto até entre os dois Ícones: entra na Caixa em linha, entre eles (pelo x)", async () => {
    const de = await doPainel(editor, "text");
    const icone1 = await caixaParada(noPalco(editor, "icone1"));
    const icone2 = await caixaParada(noPalco(editor, "icone2"));
    const para = { x: Math.round((icone1.x + icone1.width + icone2.x) / 2), y: Math.round(icone1.y + icone1.height / 2) };

    await arrastar(page, de, para, {
      antesDeSoltar: async () => {
        await expect(linha).toHaveCount(1);
        await expect(caixaDeDestino).toHaveCount(1);
      }
    });

    await expect.poll(() => desenhados(editor)).toBe(inicial + 2);
    await expect.poll(() => selecionado(editor)).not.toBe(texto);
    texto2 = await selecionado(editor);
    expect(texto2).toMatch(/^texto\d*$/);
    await expect(falado(editor)).toHaveText("Texto adicionado.");
    const naCaixa = (await noDesenho(editor)).filter((node) => node.pai === "caixa").map((node) => node.id);
    expect(naCaixa).toEqual(["icone1", texto2, "icone2"]);
  });

  await test.step("arrasta a Forma até um ponto: o centro fica onde soltou (X e Y do Avançado)", async () => {
    const de = await doPainel(editor, "shape");
    const alvo = await pontoNaPrancheta(editor, 300, 120);
    const para = { x: Math.round(alvo.x), y: Math.round(alvo.y) };
    // O ponto de verdade (o mouse vai em px inteiros de tela), em px da prancheta.
    const ponto = await daPrancheta(editor, para);

    await arrastar(page, de, para, {
      antesDeSoltar: async () => {
        // A Forma e solta: o retangulo dela no lugar, sem a linha da sequencia.
        await expect(soltoNovo).toHaveCount(1);
        await expect(linha).toHaveCount(0);
      }
    });

    await expect(falado(editor)).toHaveText("Forma adicionada.");
    await expect(soltoNovo).toHaveCount(0);
    forma = await selecionado(editor);
    expect(forma).toMatch(/^forma\d*$/);
    await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
    const campoX = editor.locator(`#livre-${forma}-x`);
    const campoY = editor.locator(`#livre-${forma}-y`);
    await expect(campoX).toBeVisible();
    lugarDaForma = { x: await numeroDe(campoX), y: await numeroDe(campoY) };
    // 120 x 120 com o centro no ponto (1 px de folga do arredondamento).
    expect(Math.abs(lugarDaForma.x - (ponto.x - 60))).toBeLessThanOrEqual(1);
    expect(Math.abs(lugarDaForma.y - (ponto.y - 60))).toBeLessThanOrEqual(1);
  });

  await test.step("soltar fora da prancheta e no próprio painel não acrescenta; Esc no meio cancela e a seleção fica", async () => {
    const antes = await desenhados(editor);
    const selecaoAntes = await selecionado(editor);

    await editor.getByRole("tab", { exact: true, name: "Elementos" }).click();
    const de = await doPainel(editor, "text");
    const area = await caixaParada(editor.locator('[data-free-zone="canvas"]'));
    const pop = await caixaParada(prancheta(editor));
    // Na area escura a direita da prancheta, ainda dentro da area de desenho (e da janela).
    const fora = { x: Math.round((pop.x + pop.width + area.x + area.width) / 2), y: Math.round(pop.y + Math.min(40, pop.height / 2)) };
    expect(fora.x).toBeGreaterThan(pop.x + pop.width + 8);

    await arrastar(page, de, fora, {
      antesDeSoltar: async () => {
        await expect(ficha).toBeVisible();
        await expect(editor.locator("[data-free-drop-line], [data-free-drop-new], [data-free-drop-target]")).toHaveCount(0);
      }
    });
    await expect(ficha).toHaveCount(0);
    expect(await desenhados(editor)).toBe(antes);

    // Do Selo ate o botao da Linha, no proprio painel: nem o Selo nem a Linha entram.
    await arrastar(page, await doPainel(editor, "badge"), await doPainel(editor, "divider"), {
      antesDeSoltar: async () => {
        await expect(ficha).toHaveText("Selo");
        await expect(editor.locator("[data-free-drop-line], [data-free-drop-new]")).toHaveCount(0);
      }
    });
    await expect(ficha).toHaveCount(0);
    expect(await desenhados(editor)).toBe(antes);

    // Esc no meio: o lugar some, a ficha some, nada entra e o Esc nao sobe para a caixa de fora.
    const sobre = { x: Math.round(pop.x + pop.width / 2), y: Math.round(pop.y + Math.min(60, pop.height / 2)) };
    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(sobre.x, sobre.y, { steps: 10 });
    await expect(linha).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(linha).toHaveCount(0);
    await expect(ficha).toHaveCount(0);
    await page.mouse.move(sobre.x, sobre.y + 10, { steps: 2 });
    await page.mouse.up();
    expect(await desenhados(editor)).toBe(antes);
    expect(await selecionado(editor)).toBe(selecaoAntes);
  });

  await test.step("um clique no Selo logo depois acrescenta um só", async () => {
    const antes = await desenhados(editor);

    await botao(editor, "badge").click();
    await expect(falado(editor)).toHaveText("Selo adicionado.");
    await expect.poll(() => desenhados(editor)).toBe(antes + 1);
    // Nenhum click guardado de um arrastar de antes acrescenta mais nada.
    expect(await desenhados(editor)).toBe(inicial + 4);
  });

  await test.step("Salvar rascunho: o gravado tem os elementos onde foram soltos, sem nenhum a mais", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);
    await expect(editor).toBeVisible();

    const gravado = await lerDesignDoAviso(avisoId);
    expect(gravado).not.toBeNull();
    const children = gravado?.children ?? [];
    expect(children.slice(0, 3).map((node) => node.id)).toEqual(["titulo", texto, "caixa"]);
    const caixa = children.find((node) => node.id === "caixa");
    expect(caixa?.type === "box" ? caixa.children.map((node) => node.id) : []).toEqual(["icone1", texto2, "icone2"]);
    const lista = todos(children);
    // Os 6 semeados (com os dois Icones) e os 4 que entraram: os dois Textos, a Forma e o Selo.
    expect(lista).toHaveLength(todos(SEMEADO).length + 4);
    expect(lista.filter((node) => node.type === "text").map((node) => node.id).sort()).toEqual([texto, texto2].sort());
    expect(lista.filter((node) => node.type === "badge")).toHaveLength(1);
    expect(lista.filter((node) => node.type === "divider")).toHaveLength(0);
    const salva = lista.find((node) => node.id === forma);
    expect(salva?.place).toMatchObject({ h: 120, mode: "free", w: 120, x: lugarDaForma.x, y: lugarDaForma.y });
    expect(children.map((node) => node.id)).toEqual(expect.arrayContaining(["fechar", "links", forma]));
  });
});
