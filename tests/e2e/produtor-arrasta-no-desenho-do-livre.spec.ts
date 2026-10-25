import type { Locator } from "@playwright/test";
import type { FreeDevices, FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  arrastar,
  botaoDaCamada,
  caixaParada,
  centroDe,
  designDoRascunhoLivre,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  linhasDasCamadas,
  noPalco,
  prancheta
} from "./popup-livre-editor-fixtures";

// Livre: arrastar os elementos da sequencia no desenho (docs/27 §13.9, L4a; docs/18 §3.1). Num rascunho com [Título,
// Texto, Caixa em coluna com fundo e respiro de 16 [Selo, Botão principal], uma caixa cheia (20 linhas), Links] e a
// Caixa em linha so no celular (o Botão principal semeado com o botao do aviso, para o Revisar nao pedir nada), o
// produtor arrasta pelo proprio elemento. Com os Links em Renomear nas Camadas, o Título desce um lugar na coluna: o
// nome fica (a foto do arrastar vem depois do limiar, entao o blur do campo nao cancela o gesto), e Ctrl + Z e Ctrl +
// Shift + Z sao um passo. O Texto entra no fim da Caixa (o foco fica no palco) e sai dela pela faixa da borda de baixo,
// a Caixa vai para o topo pela alca da barrinha, o Título em cima da caixa cheia mostra o motivo e o Esc cancela (o
// foco fica no palco), e soltar fora da prancheta nao muda nada. Com "Ver como: Celular" (a Caixa em linha), o Selo vai
// para a direita do Botão: a etiqueta e a frase dizem que a ordem muda tambem no computador, e o Computador ve a mesma
// ordem. Salvar rascunho grava a ordem nova em children, e devices fica como foi semeado. Funciona no WebKit: o mouse
// sempre dentro da janela, a prancheta e os elementos parados antes de medir, o indicador antes de soltar e a frase
// falada antes do passo seguinte.

const TITULO = "Pop-up E2E: o produtor arrasta no desenho do Livre";
/** A caixa cheia: 20 linhas (o limite de uma caixa), baixas para a prancheta caber na tela. */
const RISCOS: FreeNode[] = Array.from({ length: 20 }, (_, index) => ({ id: `risco${String(index + 1).padStart(2, "0")}`, type: "divider" }));
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { id: "texto", lines: [[{ text: "Veja o que mudou" }]], type: "text" },
  {
    box: { fill: [{ color: "#1f2937", kind: "solid" }], padding: 16, radius: 12 },
    children: [
      { id: "selo", label: "Novidade", type: "badge" },
      // O Botão principal: o rascunho grava o botao do aviso junto (gravarRascunhoLivre).
      {
        action: { kind: "cta" },
        box: { fill: [{ color: "#ffffff", kind: "solid" }], padding: [13, 24], radius: 999 },
        id: "botao",
        textStyle: { paint: { color: "#16181c", kind: "solid" }, size: 16 },
        type: "button"
      }
    ],
    id: "caixa",
    layout: { dir: "column", gap: 8 },
    type: "box"
  },
  { box: { fill: [{ color: "#111827", kind: "solid" }], padding: 8 }, children: RISCOS, id: "cheia", layout: { dir: "column", gap: 2 }, type: "box" },
  { id: "links", type: "links" }
];
/** So no celular a Caixa e uma linha: o lugar sai do desenho do celular, a ordem e uma so. */
const DEVICES: FreeDevices = { mobile: { nodes: { caixa: { layout: { dir: "row" } } } } };

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { devices: DEVICES });
});

test.afterAll(zerarComunicacao);

/** A ordem das Camadas sem as 20 linhas da caixa cheia: "id" na prancheta e "caixa/id" dentro de uma caixa. */
async function ordem(editor: Locator) {
  return (await linhasDasCamadas(editor)).filter((linha) => !linha.id.startsWith("risco")).map((linha) => (linha.pai ? `${linha.pai}/${linha.id}` : linha.id));
}

/** Os ids desenhados dentro de um elemento do palco, na ordem do DOM (so os filhos diretos da caixa). */
async function filhosNoPalco(editor: Locator, id: string) {
  return noPalco(editor, id).evaluate((caixa) =>
    [...caixa.querySelectorAll("[data-free-id]")].filter((filho) => filho.parentElement?.closest("[data-free-id]") === caixa).map((filho) => filho.getAttribute("data-free-id") ?? "")
  );
}

test("arrasta os elementos da sequência no desenho: coluna, dentro e fora da caixa, alça, recusa, Esc e Celular", async ({ page }) => {
  test.setTimeout(180_000);

  const editor = await abrirEditorLivre(page, avisoId);
  const linha = editor.locator("[data-free-drop-line]");
  const destino = editor.locator("[data-free-drop-target]");
  const origem = editor.locator("[data-free-flow-origin]");
  const motivo = editor.locator("[data-free-drop-hint]");
  const ambos = editor.locator("[data-free-drop-both]");
  const barrinha = editor.getByRole("toolbar", { name: "Ações do elemento" });

  await expect(prancheta(editor)).toBeVisible();
  expect(await ordem(editor)).toEqual(["titulo", "texto", "caixa", "caixa/selo", "caixa/botao", "cheia", "links"]);

  await test.step("com os Links em Renomear, o Título desce um lugar na coluna; Ctrl + Z e Ctrl + Shift + Z: um passo", async () => {
    // O blur do campo grava o nome depois do pointerdown no desenho: a foto do arrastar so vem depois do limiar e
    // nao fica velha (o gesto nao e cancelado em silencio).
    await botaoDaCamada(editor, "links").focus();
    await page.keyboard.press("F2");
    const campo = editor.getByRole("textbox", { exact: true, name: "Nome na lista de camadas" });
    await expect(campo).toBeFocused();
    await page.keyboard.type("Rodapé");

    const titulo = await caixaParada(noPalco(editor, "titulo"));
    const texto = await caixaParada(noPalco(editor, "texto"));
    const caixa = await caixaParada(noPalco(editor, "caixa"));

    // Entre o Texto e a Caixa: a linha de onde entra e o lugar de antes aparecem antes de soltar (a prancheta nao e caixa de destino).
    await arrastar(page, centroDe(titulo), { x: texto.x + texto.width / 2, y: (texto.y + texto.height + caixa.y) / 2 }, {
      antesDeSoltar: async () => {
        await expect(linha).toBeVisible();
        await expect(origem).toBeVisible();
        await expect(destino).toHaveCount(0);
        // Durante o gesto, a barrinha do selecionado fica escondida.
        await expect(barrinha).toBeHidden();
      }
    });

    await expect(falado(editor)).toHaveText("Movido. Posição 2 de 5, no pop-up.");
    await expect(linha).toHaveCount(0);
    await expect(campo).toHaveCount(0);
    await expect(botaoDaCamada(editor, "links")).toContainText("Rodapé");
    expect(await ordem(editor)).toEqual(["texto", "titulo", "caixa", "caixa/selo", "caixa/botao", "cheia", "links"]);
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "titulo");

    // O foco no palco (o Ctrl + Z do editor ignora campo de digitar): um arrastar e um passo so.
    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
    await expect(falado(editor)).toHaveText("Desfeito.");
    expect(await ordem(editor)).toEqual(["titulo", "texto", "caixa", "caixa/selo", "caixa/botao", "cheia", "links"]);
    await page.keyboard.press("Control+Shift+z");
    await expect(falado(editor)).toHaveText("Refeito.");
    expect(await ordem(editor)).toEqual(["texto", "titulo", "caixa", "caixa/selo", "caixa/botao", "cheia", "links"]);
  });

  await test.step("o Texto entra no fim da Caixa (abaixo do Botão, longe da faixa da borda)", async () => {
    const texto = await caixaParada(noPalco(editor, "texto"));
    const caixa = await caixaParada(noPalco(editor, "caixa"));
    const botao = await caixaParada(noPalco(editor, "botao"));
    // Abaixo do meio do Botão e a mais de 8 px de tela da borda de baixo da Caixa (a faixa poria depois da Caixa).
    const ponto = { x: botao.x + botao.width / 2, y: botao.y + botao.height * 0.75 };
    expect(caixa.y + caixa.height - ponto.y, "o ponto fica fora da faixa da borda").toBeGreaterThan(10);

    await arrastar(page, centroDe(texto), ponto, {
      antesDeSoltar: async () => {
        await expect(linha).toBeVisible();
        await expect(destino).toBeVisible();
      }
    });

    await expect(falado(editor)).toHaveText("Movido. Posição 3 de 3, dentro de Caixa em coluna.");
    expect(await ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "cheia", "links"]);
    expect(await filhosNoPalco(editor, "caixa")).toEqual(["selo", "botao", "texto"]);
    // O soltar no desenho nao mexe no foco: ele fica no palco (o foco ja estava nele, do Ctrl + Z de cima, e o
    // mousedown no Texto foca o palco, o primeiro com tabIndex, nos dois navegadores).
    await expect(editor.locator("[data-free-stage]")).toBeFocused();
  });

  await test.step("o Texto sai da Caixa pela faixa da borda de baixo e fica logo depois dela", async () => {
    const texto = await caixaParada(noPalco(editor, "texto"));
    const caixa = await caixaParada(noPalco(editor, "caixa"));

    await arrastar(page, centroDe(texto), { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height - 3 }, {
      antesDeSoltar: async () => {
        await expect(linha).toBeVisible();
        // O destino e a prancheta: nenhuma caixa de destino.
        await expect(destino).toHaveCount(0);
      }
    });

    await expect(falado(editor)).toHaveText("Movido. Posição 3 de 5, no pop-up.");
    expect(await ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "texto", "cheia", "links"]);
    expect(await filhosNoPalco(editor, "caixa")).toEqual(["selo", "botao"]);
  });

  await test.step("a Caixa vai para o topo pela alça da barrinha", async () => {
    await botaoDaCamada(editor, "caixa").click();
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "caixa");

    const alca = editor.locator("[data-free-flow-grip]");
    await expect(alca).toHaveAttribute("title", "Arraste para mudar o lugar");
    const deOnde = await caixaParada(alca);
    const titulo = await caixaParada(noPalco(editor, "titulo"));

    await arrastar(page, centroDe(deOnde), { x: titulo.x + titulo.width / 2, y: titulo.y + titulo.height / 4 }, {
      antesDeSoltar: async () => {
        await expect(linha).toBeVisible();
        await expect(barrinha).toBeHidden();
      }
    });

    await expect(falado(editor)).toHaveText("Movido. Posição 1 de 5, no pop-up.");
    expect(await ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "titulo", "texto", "cheia", "links"]);
    await expect(barrinha).toBeVisible();
  });

  await test.step("em cima da caixa cheia aparece o motivo; o Esc cancela, nada muda e o foco fica no palco", async () => {
    const titulo = await caixaParada(noPalco(editor, "titulo"));
    const cheia = await caixaParada(noPalco(editor, "cheia"));
    const antes = await ordem(editor);
    // O foco antes do gesto, no palco, vem pelo teclado (nao depende de onde o clique de cima o deixou).
    await editor.locator("[data-free-stage]").focus();
    await expect(editor.locator("[data-free-stage]")).toBeFocused();

    await arrastar(page, centroDe(titulo), { x: cheia.x + cheia.width / 2, y: cheia.y + cheia.height / 3 }, {
      antesDeSoltar: async () => {
        await expect(motivo).toHaveText("Use até 20 elementos dentro de uma caixa.");
        await page.keyboard.press("Escape");
        await expect(motivo).toHaveCount(0);
        await expect(origem).toHaveCount(0);
      }
    });

    expect(await ordem(editor)).toEqual(antes);
    // O Esc ficou com o arrastar: a selecao nao subiu para a caixa de fora, e o foco continua no palco.
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "titulo");
    expect(await filhosNoPalco(editor, "cheia")).toHaveLength(20);
    await expect(editor.locator("[data-free-stage]")).toBeFocused();
  });

  await test.step("soltar na área escura fora da prancheta não muda nada", async () => {
    const titulo = await caixaParada(noPalco(editor, "titulo"));
    const quadro = await caixaParada(prancheta(editor));
    const antes = await ordem(editor);

    await arrastar(page, centroDe(titulo), { x: quadro.x - 40, y: titulo.y + titulo.height / 2 }, {
      antesDeSoltar: async () => {
        await expect(origem).toBeVisible();
        await expect(linha).toHaveCount(0);
      }
    });

    await expect(origem).toHaveCount(0);
    expect(await ordem(editor)).toEqual(antes);
  });

  await test.step("Ver como Celular, com a Caixa em linha: o Selo vai para a direita do Botão e a ordem muda também no computador", async () => {
    await editor.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(falado(editor)).toHaveText("Editando o Celular.");
    await expect(prancheta(editor)).toHaveJSProperty("offsetWidth", 343);

    const selo = await caixaParada(noPalco(editor, "selo"));
    const botao = await caixaParada(noPalco(editor, "botao"));
    // Em linha so no celular: o Botão fica ao lado do Selo, e o lugar sai pelo x.
    expect(botao.x, "no celular a Caixa e uma linha").toBeGreaterThan(selo.x + selo.width - 1);

    await arrastar(page, centroDe(selo), { x: botao.x + botao.width * 0.8, y: botao.y + botao.height / 2 }, {
      antesDeSoltar: async () => {
        await expect(linha).toBeVisible();
        await expect(ambos).toHaveText("Muda também no computador");
      }
    });

    await expect(falado(editor)).toHaveText("Movido. Posição 2 de 2, dentro de Caixa em coluna. A ordem muda também no computador.");
    expect(await ordem(editor)).toEqual(["caixa", "caixa/botao", "caixa/selo", "titulo", "texto", "cheia", "links"]);
    expect(await filhosNoPalco(editor, "caixa")).toEqual(["botao", "selo"]);

    // No Computador, a mesma ordem (a Caixa volta a ser coluna).
    await editor.getByRole("button", { exact: true, name: "Computador" }).click();
    await expect(falado(editor)).toHaveText("Editando o Computador.");
    expect(await filhosNoPalco(editor, "caixa")).toEqual(["botao", "selo"]);
  });

  await test.step("Salvar rascunho: children com a ordem nova e devices como foi semeado", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);

    const gravado = await lerDesignDoAviso(avisoId);
    const caixa = gravado?.children.find((node) => node.id === "caixa");

    expect(gravado?.children.map((node) => node.id)).toEqual(["caixa", "titulo", "texto", "cheia", "links"]);
    expect(caixa?.type === "box" ? caixa.children.map((node) => node.id) : null).toEqual(["botao", "selo"]);
    expect(gravado?.children.find((node) => node.id === "links")?.name).toBe("Rodapé");
    // A ordem e uma so: o arrastar no Celular nao gravou nada em devices.mobile.
    expect(gravado?.devices).toEqual(designDoRascunhoLivre(CHILDREN, { devices: DEVICES }).design.devices);
  });
});
