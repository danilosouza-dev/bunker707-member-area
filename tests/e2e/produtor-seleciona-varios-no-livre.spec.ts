import type { Locator, Page } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  arrastar,
  botaoDaCamada,
  caixaParada,
  centroDe,
  cliqueCom,
  daPrancheta,
  escolhidos,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  linhasDasCamadas,
  menuDoZoom,
  noPalco
} from "./popup-livre-editor-fixtures";

// Livre: escolher varios (docs/27 §13.10, L4b; docs/18 §3.1). Num rascunho com [Título, três Formas soltas, uma Forma
// travada por cima da terceira, Caixa [Selo], Links], o produtor escolhe as três Formas com Shift + clique e Ctrl +
// clique (o clique na terceira passa pela travada): três contornos, a caixa do grupo com "3 elementos" e o painel
// Vários. As setas no palco movem as três juntas (a frase "Seleção em X, Y." e um Ctrl + Z volta tudo), arrastar uma
// leva as três num passo, o Esc no meio de outro arrastar nao muda nada, e o clique sem arrastar num escolhido deixa so
// ele. Ctrl + D duplica as três (as copias ficam escolhidas), Delete exclui as copias e Ctrl + Z volta. Nas Camadas
// (L64: como no Figma, de cima para baixo Links, Caixa, Selo, Travada, Forma C, Forma B, Forma A e Título): Shift + ↓
// a partir da Forma C pega o intervalo na ordem da lista, Ctrl + clique e Ctrl + Enter poem e tiram, e T na linha
// escolhida trava as três (com aria-current so no principal e "Na seleção" nas outras). Com "Ver como: Celular", as
// setas no grupo mudam so o celular. Salvar rascunho grava o computador como foi semeado e devices.mobile com o lugar
// novo. Desde o L65 (docs/27 §2.2), clicar fora da prancheta, na area escura em volta do pop-up, desmarca tudo e o
// painel volta a Pop-up (com Alt tambem); os paineis, a barra de cima, o zoom e as alcas nao desmarcam, com Shift ou
// Ctrl nada muda, o arrastar que comeca fora nao faz nada e o Esc continua indo a caixa de fora (sem caixa de fora,
// desmarca); sem nada escolhido, o clique fora com o Revisar aberto nao o fecha. Funciona no WebKit: o mouse sempre
// dentro da janela, o palco e o alvo parados antes de cada clique com tecla (cliqueCom), a caixa parada antes de medir
// e o foco posto pelo teclado antes de cada tecla (no WebKit o clique nao da foco a botao).

const TITULO = "Pop-up E2E: o produtor escolhe vários no Livre";
const COR = { fill: [{ color: "#38bdf8", kind: "solid" as const }], radius: 8 };
/** As tres Formas soltas (60 x 60), abaixo da sequencia, e o lugar de cada uma no computador. */
const LUGAR = { fa: { x: 40, y: 220 }, fb: { x: 160, y: 220 }, fc: { x: 280, y: 220 } } as const;
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { box: COR, id: "fa", name: "Forma A", place: { h: 60, mode: "free", w: 60, ...LUGAR.fa }, type: "shape" },
  { box: COR, id: "fb", name: "Forma B", place: { h: 60, mode: "free", w: 60, ...LUGAR.fb }, type: "shape" },
  { box: COR, id: "fc", name: "Forma C", place: { h: 60, mode: "free", w: 60, ...LUGAR.fc }, type: "shape" },
  // A travada por cima do meio da Forma C: o clique passa por ela (travado nao recebe o ponteiro na previa).
  { box: { fill: [{ color: "#f59e0b", kind: "solid" }], radius: 4 }, id: "ft", locked: true, name: "Travada", place: { h: 40, mode: "free", w: 40, x: 290, y: 230 }, type: "shape" },
  { children: [{ id: "selo", label: "Novidade", type: "badge" }], id: "caixa", layout: { dir: "column" }, type: "box" },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { artboard: { minHeight: 360 } });
});

test.afterAll(zerarComunicacao);

/** O canto de cima a esquerda do elemento no palco, em px da prancheta (o X e o Y do Avançado). */
async function lugar(editor: Locator, id: string) {
  const caixa = await caixaParada(noPalco(editor, id));
  const ponto = await daPrancheta(editor, { x: caixa.x, y: caixa.y });

  return { x: Math.round(ponto.x), y: Math.round(ponto.y) };
}

/** O lugar das tres Formas e da travada. */
async function lugares(editor: Locator) {
  return { fa: await lugar(editor, "fa"), fb: await lugar(editor, "fb"), fc: await lugar(editor, "fc"), ft: await lugar(editor, "ft") };
}

/** Uma tecla com o foco no palco (o foco vem pelo teclado: no WebKit o clique nao da foco). */
async function noPalcoTecla(page: Page, editor: Locator, tecla: string) {
  await editor.locator("[data-free-stage]").focus();
  await expect(editor.locator("[data-free-stage]")).toBeFocused();
  await page.keyboard.press(tecla);
}

/** A frase escondida do palco (a descricao do que esta escolhido). */
async function descricaoDoPalco(editor: Locator) {
  return editor.locator("[data-free-stage]").evaluate((stage) => document.getElementById(stage.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
}

test("escolhe várias Formas no desenho e nas Camadas: move junto, arrasta, duplica, exclui, trava e o Celular", async ({ page }) => {
  test.setTimeout(180_000);

  const editor = await abrirEditorLivre(page, avisoId);
  const frase = falado(editor);
  const varios = editor.locator('[data-free-inspector="many"]');
  const grupo = editor.locator("[data-free-selection-group]");
  const antes = await lugares(editor);

  expect(antes).toEqual({ fa: LUGAR.fa, fb: LUGAR.fb, fc: LUGAR.fc, ft: { x: 290, y: 230 } });

  await test.step("Shift + clique em duas Formas e Ctrl + clique na terceira (por cima da travada): três escolhidas", async () => {
    await cliqueCom(page, noPalco(editor, "fa"), ["Shift"]);
    await expect(frase).toHaveText("Forma A entrou na seleção. 1 elemento.");
    await cliqueCom(page, noPalco(editor, "fb"), ["Shift"]);
    await expect(frase).toHaveText("Forma B entrou na seleção. 2 elementos.");
    // O meio da Forma C fica embaixo da travada: o clique passa por ela.
    await cliqueCom(page, centroDe(await caixaParada(noPalco(editor, "ft"))), ["Control"]);
    await expect(frase).toHaveText("Forma C entrou na seleção. 3 elementos.");

    await expect.poll(() => escolhidos(editor)).toEqual(["fa", "fb", "fc"]);
    await expect(editor.locator("[data-free-selection]")).toHaveCount(0);
    await expect(grupo).toBeVisible();
    await expect(editor.locator("[data-free-selection-group-tag]")).toHaveText("3 elementos");
    await expect(varios.getByRole("heading", { exact: true, name: "3 elementos selecionados" })).toBeVisible();
    expect(await descricaoDoPalco(editor)).toBe("Selecionados: 3 elementos (Forma A, Forma B, Forma C).");
    // Com varios, nem alcas nem a barrinha do elemento.
    await expect(editor.locator("[data-free-handle]")).toHaveCount(0);
  });

  await test.step("as setas no palco movem as três juntas (a frase da seleção) e um Ctrl + Z volta tudo", async () => {
    await noPalcoTecla(page, editor, "ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(frase).toHaveText("Seleção em X 43, Y 220.");
    expect(await lugares(editor)).toEqual({ fa: { x: 43, y: 220 }, fb: { x: 163, y: 220 }, fc: { x: 283, y: 220 }, ft: antes.ft });

    await page.keyboard.press("Control+z");
    await expect(frase).toHaveText("Desfeito.");
    expect(await lugares(editor)).toEqual(antes);
    await expect.poll(() => escolhidos(editor)).toEqual(["fa", "fb", "fc"]);
  });

  await test.step("arrastar uma leva as três num passo; o Esc no meio de outro arrastar não muda nada", async () => {
    const de = centroDe(await caixaParada(noPalco(editor, "fb")));

    await arrastar(page, de, { x: de.x + 40, y: de.y + 30 }, {
      antesDeSoltar: async () => {
        // Durante o gesto, a caixa do grupo continua desenhada.
        await expect(grupo).toBeVisible();
      }
    });

    const depois = await lugares(editor);
    const dx = depois.fb.x - antes.fb.x;
    const dy = depois.fb.y - antes.fb.y;

    expect(dx, "o grupo andou para a direita").toBeGreaterThan(20);
    expect(dy, "o grupo andou para baixo").toBeGreaterThan(10);
    expect(depois).toEqual({
      fa: { x: antes.fa.x + dx, y: antes.fa.y + dy },
      fb: { x: antes.fb.x + dx, y: antes.fb.y + dy },
      fc: { x: antes.fc.x + dx, y: antes.fc.y + dy },
      ft: antes.ft
    });
    await expect.poll(() => escolhidos(editor)).toEqual(["fa", "fb", "fc"]);

    // Um passo so: um Ctrl + Z volta as tres.
    await noPalcoTecla(page, editor, "Control+z");
    await expect(frase).toHaveText("Desfeito.");
    expect(await lugares(editor)).toEqual(antes);

    // O Esc no meio cancela: nada muda e as tres continuam escolhidas.
    const outro = centroDe(await caixaParada(noPalco(editor, "fa")));

    await arrastar(page, outro, { x: outro.x + 30, y: outro.y + 40 }, {
      antesDeSoltar: async () => {
        await page.keyboard.press("Escape");
      }
    });

    expect(await lugares(editor)).toEqual(antes);
    await expect.poll(() => escolhidos(editor)).toEqual(["fa", "fb", "fc"]);
  });

  await test.step("o clique sem arrastar num dos escolhidos deixa só ele; Shift + clique volta às três", async () => {
    await cliqueCom(page, noPalco(editor, "fb"));
    await expect.poll(() => escolhidos(editor)).toEqual(["fb"]);
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "fb");
    await expect(varios).toHaveCount(0);

    await cliqueCom(page, noPalco(editor, "fa"), ["Shift"]);
    await cliqueCom(page, noPalco(editor, "fc"), ["Shift"]);
    await expect(frase).toHaveText("Forma C entrou na seleção. 3 elementos.");
    await expect.poll(() => escolhidos(editor)).toEqual(["fb", "fa", "fc"]);
  });

  await test.step("Ctrl + D duplica as três (as cópias ficam escolhidas), Delete exclui as cópias e Ctrl + Z volta", async () => {
    const linhas = (await linhasDasCamadas(editor)).length;

    await noPalcoTecla(page, editor, "Control+d");
    await expect(frase).toHaveText("3 elementos duplicados.");
    await expect.poll(async () => (await linhasDasCamadas(editor)).length).toBe(linhas + 3);
    await expect.poll(async () => (await escolhidos(editor)).length).toBe(3);
    const copias = await escolhidos(editor);
    expect(copias.filter((id) => ["fa", "fb", "fc"].includes(id))).toEqual([]);

    await noPalcoTecla(page, editor, "Delete");
    await expect(frase).toHaveText("3 elementos excluídos. Ctrl + Z desfaz.");
    await expect.poll(async () => (await linhasDasCamadas(editor)).length).toBe(linhas);
    await expect.poll(() => escolhidos(editor)).toEqual([]);
    // Depois de excluir pelo palco, o foco continua no palco.
    await expect(editor.locator("[data-free-stage]")).toBeFocused();

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await linhasDasCamadas(editor)).length).toBe(linhas + 3);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await linhasDasCamadas(editor)).length).toBe(linhas);
    expect(await lugares(editor)).toEqual(antes);
  });

  await test.step("nas Camadas: Shift + ↓ pega o intervalo, Ctrl + clique e Ctrl + Enter põem e tiram, e T trava as três", async () => {
    // Nas Camadas (L64), o da frente em cima: a Forma C vem acima da B, e a B acima da A.
    expect((await linhasDasCamadas(editor)).map((linhaDaCamada) => linhaDaCamada.id)).toEqual(["links", "caixa", "selo", "ft", "fc", "fb", "fa", "titulo"]);
    await botaoDaCamada(editor, "fc").click();
    await expect.poll(() => escolhidos(editor)).toEqual(["fc"]);

    // Shift + ↓ com o foco na linha: a linha de baixo entra e o intervalo cresce desde a ancora (a Forma C), na ordem
    // da lista, com a linha do foco no fim (o principal).
    await botaoDaCamada(editor, "fc").focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(frase).toHaveText("2 elementos escolhidos.");
    await expect(botaoDaCamada(editor, "fb")).toBeFocused();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(frase).toHaveText("3 elementos escolhidos.");
    await expect(botaoDaCamada(editor, "fa")).toBeFocused();
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);

    // Ctrl + clique poe o Título; Ctrl + Enter na linha dele o tira.
    await botaoDaCamada(editor, "titulo").click({ modifiers: ["Control"] });
    await expect(frase).toHaveText("Título entrou na seleção. 4 elementos.");
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa", "titulo"]);
    await botaoDaCamada(editor, "titulo").focus();
    await page.keyboard.press("Control+Enter");
    await expect(frase).toHaveText("Título saiu da seleção. 3 elementos.");
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);

    // aria-current so no principal (o ultimo escolhido); "Na seleção" nas outras linhas escolhidas.
    await expect(botaoDaCamada(editor, "fa")).toHaveAttribute("aria-current", "true");

    for (const id of ["fc", "fb"]) {
      await expect(botaoDaCamada(editor, id)).not.toHaveAttribute("aria-current", "true");
      await expect(editor.locator(`[data-free-layer-row="${id}"] [id^="free-layer-tags-"]`)).toContainText("Na seleção");
    }

    await expect(editor.locator('[data-free-layer-row="titulo"] [id^="free-layer-tags-"]')).toHaveCount(0);

    // T na linha escolhida trava as tres (a frase diz quantas); T de novo destrava.
    await botaoDaCamada(editor, "fa").focus();
    await page.keyboard.press("t");
    await expect(frase).toHaveText("3 elementos travados.");

    for (const id of ["fa", "fb", "fc"]) {
      await expect(editor.locator(`[data-free-layer-row="${id}"]`).getByRole("button", { exact: true, name: "Travar" })).toHaveAttribute("aria-pressed", "true");
    }

    await expect(editor.locator('[data-free-layer-row="titulo"]').getByRole("button", { exact: true, name: "Travar" })).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("t");
    await expect(frase).toHaveText("3 elementos destravados.");

    for (const id of ["fa", "fb", "fc"]) {
      await expect(editor.locator(`[data-free-layer-row="${id}"]`).getByRole("button", { exact: true, name: "Travar" })).toHaveAttribute("aria-pressed", "false");
    }
  });

  await test.step("Ver como Celular: as setas no grupo mudam só o celular", async () => {
    await editor.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(frase).toHaveText("Editando o Celular.");
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);
    await expect(varios.getByText("Com Ver como: Celular, alinhar e distribuir mudam só o celular.", { exact: true })).toBeVisible();

    await noPalcoTecla(page, editor, "ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(frase).toHaveText("Seleção em X 40, Y 222.");

    // No Computador, as tres continuam onde estavam.
    await editor.getByRole("button", { exact: true, name: "Computador" }).click();
    await expect(frase).toHaveText("Editando o Computador.");
    expect(await lugares(editor)).toEqual(antes);
  });

  await test.step("Salvar rascunho: o computador como foi semeado e devices.mobile com o lugar novo das três", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);

    const gravado = await lerDesignDoAviso(avisoId);
    const porId = Object.fromEntries((gravado?.children ?? []).map((node) => [node.id, node]));

    expect(gravado?.children.map((node) => node.id)).toEqual(["titulo", "fa", "fb", "fc", "ft", "caixa", "links"]);

    for (const id of ["fa", "fb", "fc"] as const) {
      expect(porId[id]?.place).toEqual({ h: 60, mode: "free", w: 60, ...LUGAR[id] });
      expect(porId[id]?.locked).toBeUndefined();
      expect(gravado?.devices?.mobile?.nodes?.[id]?.place).toEqual({ mode: "free", y: LUGAR[id].y + 2 });
    }

    expect(porId.ft?.locked).toBe(true);
    expect(porId.ft?.place).toEqual({ h: 40, mode: "free", w: 40, x: 290, y: 230 });
    expect(gravado?.devices?.mobile?.nodes?.ft).toBeUndefined();
  });

  await test.step("clicar fora da prancheta desmarca (o painel volta a Pop-up); painéis, barra de cima, zoom e alças não; arrastar de fora não muda nada", async () => {
    const area = editor.locator('[data-free-zone="canvas"]');
    const popup = editor.locator('[data-free-inspector="popup"]');
    /** Um ponto da area escura em volta do pop-up: 8 px para dentro da borda esquerda da area, na altura do meio. */
    const fora = async () => {
      const caixa = await caixaParada(area);

      return { x: caixa.x + 8, y: caixa.y + caixa.height / 2 };
    };

    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);

    // Os paineis, a barra de cima e o zoom ficam fora da area de desenho: nao desmarcam.
    await cliqueCom(page, varios.getByRole("heading", { exact: true, name: "3 elementos selecionados" }));
    await cliqueCom(page, editor.locator('[data-free-tab="layers"]'));
    await cliqueCom(page, editor.locator("header").getByText("Editor Livre", { exact: true }));
    await cliqueCom(page, editor.locator('[data-free-zoom="in"]'));
    await expect(frase).toHaveText(/^Zoom \d+ %\.$/);
    await menuDoZoom(editor).click();
    await page.getByRole("menuitemradio", { exact: true, name: "Ajustar à tela" }).click();
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);
    await expect(varios).toBeVisible();

    // Com Shift ou Ctrl, o clique fora nao muda nada (como no vazio da prancheta).
    await cliqueCom(page, await fora(), ["Shift"]);
    await cliqueCom(page, await fora(), ["Control"]);
    await expect.poll(() => escolhidos(editor)).toEqual(["fc", "fb", "fa"]);

    // O clique fora sem tecla desmarca tudo: o painel volta a Pop-up e o palco diz que nada esta escolhido.
    await cliqueCom(page, await fora());
    await expect.poll(() => escolhidos(editor)).toEqual([]);
    await expect(varios).toHaveCount(0);
    await expect(popup.getByText("Nada selecionado: aqui fica o pop-up inteiro.", { exact: true })).toBeVisible();
    expect(await descricaoDoPalco(editor)).toBe("Nada selecionado.");

    // O Alt nao conta: com Alt, o clique fora desmarca do mesmo jeito.
    await cliqueCom(page, noPalco(editor, "fb"));
    await expect.poll(() => escolhidos(editor)).toEqual(["fb"]);
    await cliqueCom(page, await fora(), ["Alt"]);
    await expect.poll(() => escolhidos(editor)).toEqual([]);

    // As alcas ficam no desenho: o clique numa delas, sem arrastar, nao desmarca nem muda o lugar.
    await cliqueCom(page, noPalco(editor, "fa"));
    await expect.poll(() => escolhidos(editor)).toEqual(["fa"]);
    await cliqueCom(page, editor.locator('[data-free-handle="se"]'));
    await expect.poll(() => escolhidos(editor)).toEqual(["fa"]);
    expect(await lugares(editor)).toEqual(antes);

    // O arrastar que comeca fora nao faz nada: nem na area escura, nem quando passa por cima de outra Forma.
    const de = await fora();

    await arrastar(page, de, { x: de.x + 60, y: de.y + 40 });
    await arrastar(page, de, centroDe(await caixaParada(noPalco(editor, "fb"))));
    await expect.poll(() => escolhidos(editor)).toEqual(["fa"]);
    expect(await lugares(editor)).toEqual(antes);

    // O Esc continua indo a caixa de fora e, sem caixa de fora, desmarca.
    await cliqueCom(page, noPalco(editor, "selo"));
    await expect.poll(() => escolhidos(editor)).toEqual(["selo"]);
    await noPalcoTecla(page, editor, "Escape");
    await expect.poll(() => escolhidos(editor)).toEqual(["caixa"]);
    await page.keyboard.press("Escape");
    await expect.poll(() => escolhidos(editor)).toEqual([]);
    await expect(popup).toBeVisible();

    // Sem nada escolhido nao ha o que desmarcar: com o Revisar aberto, o clique fora nao o fecha (o painel nao volta a
    // Pop-up).
    const revisar = editor.getByRole("heading", { exact: true, name: "Revisar" });

    await cliqueCom(page, editor.locator("[data-free-review-toggle]"));
    await expect(revisar).toBeVisible();
    await cliqueCom(page, await fora());
    await expect(revisar).toBeVisible();
    await expect(popup).toHaveCount(0);
    await expect.poll(() => escolhidos(editor)).toEqual([]);
  });
});
