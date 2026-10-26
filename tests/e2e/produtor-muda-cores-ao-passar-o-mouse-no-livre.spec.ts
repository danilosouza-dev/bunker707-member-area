import type { Locator } from "@playwright/test";
import { FREE_HISTORY_COALESCE_MS } from "../../src/components/admin/v2/communication/popup-free/free-editor-history";
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
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  noPalco,
  prancheta
} from "./popup-livre-editor-fixtures";

// Livre: as cores ao passar o mouse no Estilo do Botão e dos Links (docs/27 §13.11.3, L6c; docs/18 §3.1). Num rascunho
// com [Título, Botão principal vermelho sem borda, Links] (o Botão principal semeado com o botao do aviso BOTAO), o
// produtor escolhe o Botão e abre o Estilo: a seção "Ao passar o mouse" diz que vale pelo teclado, que o botão sem
// cores próprias clareia, deixa a Cor da borda parada (sem borda) e a chave "Ver com o mouse em cima" parada até haver
// uma cor. O Fundo (um vermelho escuro) e a Cor do texto (um amarelo claro) gravam um passo cada; com a chave ligada
// pelo Espaço, o palco mostra as duas cores sem o mouse. Ctrl + Z volta só a Cor do texto (a chave continua ligada,
// o Fundo fica) e Ctrl + Shift + Z refaz. Sair do Estilo desliga a chave, e com Ver como: Celular ela fica parada (no
// celular não tem mouse). Ao escolher os Links, a chave volta a Normal; nos Links só existe a Cor
// (sem Fundo nem borda). Com a chave desligada, o mouse no palco mostra as cores como o aluno vê. Salvar rascunho
// grava as cores na forma canônica (sem a cor da borda nem nada no celular), lidas do banco. No segundo teste, um
// Botão solto com cores ao passar o mouse, arrastado até perto do fim da prancheta: no palco ele não anima (é o span da
// prévia; a transição é só do aluno), fica onde foi solto desde o primeiro quadro e o Revisar mede onde ele ficou, sem
// a dica de corte. Funciona no WebKit: o foco posto antes de cada tecla, o mouse sempre dentro da janela, as medidas
// depois de o palco parar e as esperas pela tela antes de ler o banco.

const TITULO = "Pop-up E2E: cores ao passar o mouse no Livre";
/** O botao do aviso que entra com o Botão principal do design (gravarRascunhoLivre so grava com o principal). */
const BOTAO = { href: "/minhas-compras", label: "Quero ver", target: "same_tab" } as const;
const VERMELHO = { hex: "#e50914", rgb: "rgb(229, 9, 20)" } as const;
const VERMELHO_ESCURO = { hex: "#b20710", rgb: "rgb(178, 7, 16)" } as const;
const AMARELO_CLARO = { hex: "#fde68a", rgb: "rgb(253, 230, 138)" } as const;
const LIMAO = "#e5ff1f";
const BRANCO = "rgb(255, 255, 255)";
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { action: { kind: "cta" }, box: { fill: [{ color: VERMELHO.hex, kind: "solid" }], padding: [12, 24], radius: 999 }, id: "botao", type: "button" },
  { id: "links", type: "links" }
];
const TITULO_SOLTO = "Pop-up E2E: Botão solto com cores no palco do Livre";
/** Um Título de três linhas (a prancheta alta), o Botão principal solto perto do topo, com cores ao passar o mouse, e os Links. */
const CHILDREN_SOLTO: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }], [{ text: "com cores" }], [{ text: "ao passar o mouse" }]], type: "heading" },
  {
    action: { kind: "cta" },
    box: { fill: [{ color: VERMELHO.hex, kind: "solid" }], padding: [12, 24], radius: 999 },
    hover: { color: "#111111", fill: { color: "#ffffff", kind: "solid" } },
    id: "botao",
    place: { mode: "free", w: 160, x: 40, y: 20 },
    type: "button"
  },
  { id: "links", type: "links" }
];

/** A caixa do Botão no palco em cada quadro depois de soltar (gravada pela página, em px de tela). */
type QuadrosDoBotao = { quadrosDoBotao?: { x: number; y: number }[] };

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";
let avisoSoltoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { botao: { ...BOTAO } });
  avisoSoltoId = await gravarRascunhoLivre(TITULO_SOLTO, CHILDREN_SOLTO, { botao: { ...BOTAO } });
});

test.afterAll(zerarComunicacao);

/** O fundo e a cor da letra desenhados agora. */
async function coresDe(locator: Locator) {
  return locator.evaluate((element) => {
    const css = getComputedStyle(element);
    return { fundo: css.backgroundImage, letra: css.color };
  });
}

test("cores ao passar o mouse no Estilo: a seção, Ver com o mouse em cima, um passo cada, Ctrl + Z e o gravado", async ({ page }) => {
  test.setTimeout(180_000);
  const editor = await abrirEditorLivre(page, avisoId);
  const secao = editor.getByRole("region", { exact: true, name: "Ao passar o mouse" });
  const fundo = editor.locator("#livre-botao-passar-mouse-fundo-cor");
  const corDoTexto = editor.locator("#livre-botao-passar-mouse-cor");
  const corDaBorda = editor.locator("#livre-botao-passar-mouse-borda");
  const verComOMouse = editor.getByRole("switch", { name: "Ver com o mouse em cima" });
  const botaoNoPalco = noPalco(editor, "botao");

  await test.step("o Estilo do Botão tem a seção, com a Cor da borda e a chave paradas até haver o que mostrar", async () => {
    await botaoDaCamada(editor, "botao").click();
    await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
    await secao.scrollIntoViewIfNeeded();
    await expect(secao.getByText("Vale também quando o aluno chega pelo teclado. No celular não tem mouse.")).toBeVisible();
    await expect(secao.getByText("Sem cores próprias, o botão clareia um pouco quando o mouse passa.")).toBeVisible();
    // Cada campo parte da cor de sempre, sem gravar nada.
    await expect(fundo).toHaveValue(VERMELHO.hex);
    await expect(corDoTexto).toHaveValue("#ffffff");
    await expect(corDaBorda).toBeDisabled();
    await expect(secao.getByText("Escolha uma borda em Borda para mudar a cor dela.")).toBeVisible();
    await expect(verComOMouse).toBeDisabled();
    await expect(secao.getByText("Escolha uma cor acima para ver aqui.")).toBeVisible();
    expect(await botaoNoPalco.getAttribute("data-free-hover")).toBeNull();
  });

  await test.step("o Fundo e a Cor do texto gravam um passo cada; o palco ganha a lista do que muda", async () => {
    await fundo.fill(VERMELHO_ESCURO.hex);
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover", "fill");
    await expect(secao.getByText("Sem cores próprias, o botão clareia um pouco quando o mouse passa.")).toHaveCount(0);
    await expect(secao.getByRole("button", { exact: true, name: "Fundo: voltar ao padrão" })).toBeVisible();
    // O editor junta num passo so as mudancas da mesma cor feitas em menos de 700 ms (FREE_HISTORY_COALESCE_MS): a
    // espera faz da Cor do texto um passo proprio, como quando a equipe usa o painel com calma.
    await page.waitForTimeout(FREE_HISTORY_COALESCE_MS + 200);

    await corDoTexto.fill(AMARELO_CLARO.hex);
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover", "color fill");
    // Parado, sem o mouse e com a chave desligada, o palco mostra as cores de sempre.
    expect(await coresDe(botaoNoPalco)).toMatchObject({ letra: BRANCO });
    expect((await coresDe(botaoNoPalco)).fundo).toContain(VERMELHO.rgb);
  });

  await test.step("Espaço liga Ver com o mouse em cima: o palco mostra as duas cores sem o mouse", async () => {
    await expect(verComOMouse).toBeEnabled();
    await verComOMouse.focus();
    await page.keyboard.press("Space");
    await expect(verComOMouse).toHaveAttribute("aria-checked", "true");
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover-on", "");
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(AMARELO_CLARO.rgb);
    expect((await coresDe(botaoNoPalco)).fundo).toContain(VERMELHO_ESCURO.rgb);
  });

  await test.step("Ctrl + Z volta só a Cor do texto (a chave continua ligada) e Ctrl + Shift + Z refaz", async () => {
    // Com o foco na chave (fora de campo de texto), o Ctrl + Z e do editor.
    await expect(verComOMouse).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(falado(editor)).toHaveText("Desfeito.");
    await expect(corDoTexto).toHaveValue("#ffffff");
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover", "fill");
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(BRANCO);
    await expect(verComOMouse).toHaveAttribute("aria-checked", "true");
    expect((await coresDe(botaoNoPalco)).fundo).toContain(VERMELHO_ESCURO.rgb);

    await verComOMouse.focus();
    await page.keyboard.press("Control+Shift+z");
    await expect(falado(editor)).toHaveText("Refeito.");
    await expect(corDoTexto).toHaveValue(AMARELO_CLARO.hex);
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(AMARELO_CLARO.rgb);
  });

  await test.step("sair do Estilo desliga a chave; com Ver como: Celular ela fica parada, com o motivo", async () => {
    const verComputador = editor.getByRole("button", { exact: true, name: "Computador" });
    const verCelular = editor.getByRole("button", { exact: true, name: "Celular" });

    // Na aba Conteúdo a chave não aparece: o palco volta ao normal, e o Estilo de novo mostra a chave desligada.
    await expect(verComOMouse).toHaveAttribute("aria-checked", "true");
    await editor.getByRole("tab", { exact: true, name: "Conteúdo" }).click();
    await expect(botaoNoPalco).not.toHaveAttribute("data-free-hover-on", "");
    await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
    await secao.scrollIntoViewIfNeeded();
    await expect(verComOMouse).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(BRANCO);

    // Ligada de novo, o Ver como: Celular desliga: no celular não tem mouse, e a chave fica parada até o Computador.
    await verComOMouse.focus();
    await page.keyboard.press("Space");
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover-on", "");
    await verCelular.click();
    await expect(verCelular).toHaveAttribute("aria-pressed", "true");
    await expect(botaoNoPalco).not.toHaveAttribute("data-free-hover-on", "");
    await expect(verComOMouse).toBeDisabled();
    await expect(verComOMouse).toHaveAttribute("aria-checked", "false");
    await expect(secao.getByText("No celular não tem mouse. Para ver aqui, use Ver como: Computador.")).toBeVisible();
    await verComputador.click();
    await expect(verComputador).toHaveAttribute("aria-pressed", "true");
    await expect(verComOMouse).toBeEnabled();
    await expect(verComOMouse).toHaveAttribute("aria-checked", "false");
    await expect(botaoNoPalco).not.toHaveAttribute("data-free-hover-on", "");

    // Ligada outra vez para o passo seguinte (escolher outro elemento também desliga).
    await verComOMouse.focus();
    await page.keyboard.press("Space");
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover-on", "");
  });

  await test.step("ao escolher os Links, a chave volta a Normal; nos Links só existe a Cor", async () => {
    await botaoDaCamada(editor, "links").click();
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "links");
    await expect(botaoNoPalco).not.toHaveAttribute("data-free-hover-on", "");
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(BRANCO);

    const corDosLinks = editor.locator("#livre-links-passar-mouse-cor");

    // Outro elemento abre no Conteúdo: o Estilo de novo.
    await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
    await secao.scrollIntoViewIfNeeded();
    await expect(corDosLinks).toBeVisible();
    await expect(editor.locator("#livre-links-passar-mouse-fundo, #livre-links-passar-mouse-borda")).toHaveCount(0);
    await corDosLinks.fill(LIMAO);
    await expect(noPalco(editor, "links").locator("[data-free-link]").first()).toHaveAttribute("data-free-hover", "color");

    await botaoDaCamada(editor, "botao").click();
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "botao");
    await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
    await expect(verComOMouse).toHaveAttribute("aria-checked", "false");
    await expect(botaoNoPalco).not.toHaveAttribute("data-free-hover-on", "");
  });

  await test.step("com a chave desligada, o mouse no palco mostra as cores como o aluno vê", async () => {
    await page.mouse.move(8, 8);
    await botaoNoPalco.hover();
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(AMARELO_CLARO.rgb);
    expect((await coresDe(botaoNoPalco)).fundo).toContain(VERMELHO_ESCURO.rgb);
    await page.mouse.move(8, 8);
    await expect.poll(async () => (await coresDe(botaoNoPalco)).letra).toBe(BRANCO);
  });

  await test.step("Salvar rascunho grava as cores na forma canônica, sem nada no celular", async () => {
    const salvar = editor.getByRole("button", { name: "Salvar rascunho" });

    await salvar.focus();
    await page.keyboard.press("Enter");
    await expect(falado(editor)).toHaveText("Rascunho salvo.");

    const gravado = await lerDesignDoAviso(avisoId);
    const porId = new Map((gravado?.children ?? []).map((node) => [node.id, node]));
    const botao = porId.get("botao");
    const links = porId.get("links");

    expect([...porId.keys()]).toEqual(["titulo", "botao", "links"]);
    expect(botao?.type === "button" ? botao.hover : null).toEqual({ color: AMARELO_CLARO.hex, fill: { color: VERMELHO_ESCURO.hex, kind: "solid" } });
    expect(links?.type === "links" ? links.hover : null).toEqual({ color: LIMAO });
    expect(gravado?.devices).toBeUndefined();
  });
});

test("no palco, o Botão solto com cores ao passar o mouse fica onde foi solto e o Revisar mede onde ele ficou", async ({ page }) => {
  test.setTimeout(120_000);
  const editor = await abrirEditorLivre(page, avisoSoltoId);
  const botaoNoPalco = noPalco(editor, "botao");

  await test.step("no palco, o Botão é o span da prévia, com as cores ao passar o mouse e sem transição", async () => {
    await botaoDaCamada(editor, "botao").click();
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "botao");
    await expect(botaoNoPalco).toHaveAttribute("data-free-hover", "color fill");
    // A transição de 150 ms é só do <a> e do <button> do aluno: o arrastar move o span por translate.
    expect(await botaoNoPalco.evaluate((element) => [element.tagName, getComputedStyle(element).transitionDuration])).toEqual(["SPAN", "0s"]);
  });

  await test.step("arrastado até perto do fim da prancheta, o botão fica onde foi solto desde o primeiro quadro", async () => {
    const caixa = await caixaParada(botaoNoPalco);
    const folha = await caixaParada(prancheta(editor));
    const de = centroDe(caixa);
    // O fim do botão a 24 px de tela do fim da prancheta, dentro dela.
    const para = { x: de.x, y: de.y + (folha.y + folha.height - 24) - (caixa.y + caixa.height) };

    await arrastar(page, de, para, {
      antesDeSoltar: () =>
        page.evaluate(() => {
          const pagina = window as Window & QuadrosDoBotao;
          const quadros: { x: number; y: number }[] = [];

          pagina.quadrosDoBotao = quadros;
          window.addEventListener(
            "pointerup",
            () => {
              const quadro = () => {
                const rect = document.querySelector("[data-free-canvas-card] [data-free-id='botao']")?.getBoundingClientRect();

                if (rect) {
                  quadros.push({ x: rect.x, y: rect.y });
                }

                if (quadros.length < 12) {
                  requestAnimationFrame(quadro);
                }
              };

              requestAnimationFrame(quadro);
            },
            { capture: true, once: true }
          );
        })
    });

    const fim = await caixaParada(botaoNoPalco);
    const quadros = await page.evaluate(() => (window as Window & QuadrosDoBotao).quadrosDoBotao ?? []);
    const folhaDepois = await caixaParada(prancheta(editor));
    const selecao = await caixaParada(editor.locator("[data-free-selection]"));

    expect(quadros.length).toBeGreaterThan(0);

    // Sem a transição, nenhum quadro mostra o botão escorregando do lugar do arrastar para o novo.
    for (const quadro of quadros) {
      expect(Math.abs(quadro.x - fim.x), `x de um quadro: ${quadro.x} contra ${fim.x}`).toBeLessThanOrEqual(1.5);
      expect(Math.abs(quadro.y - fim.y), `y de um quadro: ${quadro.y} contra ${fim.y}`).toBeLessThanOrEqual(1.5);
    }

    expect(fim.y + fim.height).toBeLessThan(folhaDepois.y + folhaDepois.height);
    // A seleção (do retângulo medido) por cima do botão desenhado.
    expect(Math.abs(selecao.y - fim.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(selecao.x - fim.x)).toBeLessThanOrEqual(1.5);
  });

  await test.step("o Revisar mede o botão onde ele ficou: nenhuma dica de corte", async () => {
    await editor.locator("[data-free-review-toggle]").click();
    await expect(editor.locator("[data-free-review-back]")).toBeVisible();
    await expect(editor.getByText(/está cortado no fim do pop-up/)).toHaveCount(0);
  });
});
