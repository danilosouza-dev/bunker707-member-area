import type { Browser, Locator, Page } from "@playwright/test";
import { FREE_HISTORY_COALESCE_MS } from "../../src/components/admin/v2/communication/popup-free/free-editor-history";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { abrirComoProdutor, bloquearRedeExterna, expect, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";
import { TELA_DO_EDITOR, botaoDaCamada, falado, gravarRascunhoLivre, lerDesignDoAviso, noPalco, prancheta } from "./popup-livre-editor-fixtures";

// Livre: contorno e marca-texto numa parte do Título, so pelo teclado (docs/27 §13.11.2, L6b; docs/18 §3.1). Num
// rascunho com [Título "Aula nova no ar", Botão principal, Links] (o Botão principal semeado com o botao do aviso
// BOTAO), o produtor abre o editor com Enter, escolhe o Título nas Camadas, marca "nova" na area de texto com Shift +
// →, chega ao "Outro estilo na seleção" pelo Tab e liga, com Espaco, o Marca-texto (o vermelho de partida) e depois
// o Contorno (preto de 2 px): um passo cada. O Esc fecha o estilo da parte (o foco volta a area de texto e a ficha
// diz "contorno, marca-texto"); com o foco no botao, Ctrl + Z volta um passo so (sai o contorno, o marca-texto fica)
// e Ctrl + Shift + Z refaz. Salvar rascunho grava a parte na forma canonica (sem o respiro e os cantos de partida) e
// o pop-up e publicado. A aluna, a 1440 px, ve na parte o fundo do marca-texto, um fundo por linha
// (box-decoration-break clone, com ou sem o prefixo -webkit-), o respiro e os cantos de partida e o contorno de 2 px;
// as outras partes ficam sem fundo e sem contorno; a 375 px, o contorno e o respiro encolhem na proporcao 343/440. O
// paint-order so e conferido no Chromium (o WebKit nao e exigido). Funciona no WebKit: so teclado, o foco posto antes
// de cada tecla e as esperas pela tela antes de ler o banco.

const TITULO = "Pop-up E2E: o produtor usa contorno e marca-texto no Livre";
/** O nome do pop-up para a aluna: o texto do Título do design. */
const NOME_DO_POP_UP = "Aula nova no ar";
/** O botao do aviso que entra com o Botão principal do design (gravarRascunhoLivre so grava com o principal). */
const BOTAO = { href: "/minhas-compras", label: "Quero ver", target: "same_tab" } as const;
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: NOME_DO_POP_UP }]], type: "heading" },
  { action: { kind: "cta" }, id: "botao", type: "button" },
  { id: "links", type: "links" }
];
/** "nova" no texto do Título (letras 5 a 9). */
const PARTE = { fim: 9, inicio: 5, texto: "nova" } as const;
/** O marca-texto que a chave liga (o vermelho da marca) e o contorno que a chave liga (preto de 2 px). */
const MARCA_TEXTO = { hex: "#e50914", rgb: "rgb(229, 9, 20)" } as const;
const CONTORNO = { color: "#000000", width: 2 } as const;
/** O respiro [2, 6] e os cantos 4 de partida do marca-texto (px da prancheta de 440), que o gravado nao guarda. */
const RESPIRO_DOS_LADOS = 6;
const CANTOS = 4;
const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;

test.describe.configure({ mode: "serial" });
// A pagina do teste e a da aluna; o produtor usa uma aba propria (abrirComoProdutor).
test.use({ viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { botao: { ...BOTAO } });
});

test.afterAll(zerarComunicacao);

/** O card do aviso pelo titulo (SectionCard: uma regiao com o nome do h2). */
function card(pagina: Page, titulo: string) {
  return pagina.getByRole("region", { exact: true, name: titulo });
}

/** A ficha da parte em "Partes com estilo próprio" (o rotulo diz o texto e o que a parte muda). */
function ficha(editor: Locator, descricao: string) {
  return editor.getByRole("button", { exact: true, name: `“${PARTE.texto}” · ${descricao}` });
}

type ParteDesenhada = {
  cantos: number;
  contorno: number;
  corDoContorno: string;
  fundo: string;
  largura: number;
  ordem: string;
  quebra: string;
  respiro: number;
  texto: string;
};

/**
 * As partes desenhadas de um Título (os spans sem filhos, na ordem), com o que o navegador calcula no span da parte
 * (o filho da linha: com marca-texto, as letras ficam num span de dentro, acima dos fundos, e o fundo no de fora): o
 * fundo, a quebra entre linhas (o WebKit so conhece o nome com o prefixo), o respiro dos lados, os cantos, a
 * espessura e a cor do contorno e o paint-order, mais a largura do cartao (o container das medidas em cqw).
 */
async function partesDoTitulo(titulo: Locator): Promise<ParteDesenhada[]> {
  return titulo.evaluate((element) => {
    const largura = (element.closest("[data-popup-free]") as HTMLElement | null)?.clientWidth ?? 0;
    /** O span da parte: sobe ate o filho do span da linha (o filho direto do Titulo). */
    const parteDe = (span: HTMLElement) => {
      let parte = span;

      while (parte.parentElement && parte.parentElement.parentElement !== element) {
        parte = parte.parentElement;
      }

      return parte;
    };

    return [...element.querySelectorAll("span")]
      .filter((span) => span.childElementCount === 0)
      .map((span) => {
        const css = getComputedStyle(parteDe(span));

        return {
          cantos: Number.parseFloat(css.borderTopLeftRadius) || 0,
          contorno: Number.parseFloat(css.getPropertyValue("-webkit-text-stroke-width")) || 0,
          corDoContorno: css.getPropertyValue("-webkit-text-stroke-color"),
          fundo: css.backgroundColor,
          largura,
          ordem: css.getPropertyValue("paint-order"),
          quebra: css.getPropertyValue("box-decoration-break") || css.getPropertyValue("-webkit-box-decoration-break"),
          respiro: Number.parseFloat(css.paddingLeft) || 0,
          texto: span.textContent ?? ""
        };
      });
  });
}

/** A parte "nova" desenhada (no palco do editor ou no pop-up da aluna). */
async function parteNova(titulo: Locator): Promise<ParteDesenhada | null> {
  return (await partesDoTitulo(titulo)).find((parte) => parte.texto === PARTE.texto) ?? null;
}

/** O que a aluna ve: a parte com o marca-texto e o contorno, e as outras sem nada (a medida em px pela largura do cartao). */
async function conferirParteDaAluna(popUp: Locator, browserName: string) {
  const partes = await partesDoTitulo(popUp.locator('[data-free-id="titulo"]'));

  expect(partes.map((parte) => parte.texto)).toEqual(["Aula ", PARTE.texto, " no ar"]);

  const [antes, nova, depois] = partes;
  const px = (medida: number) => (medida * nova.largura) / 440;

  expect(nova.fundo, "o fundo do marca-texto").toBe(MARCA_TEXTO.rgb);
  expect(nova.quebra, "um fundo por linha quando a parte quebra").toBe("clone");
  expect(nova.respiro, "o respiro dos lados de partida").toBeCloseTo(px(RESPIRO_DOS_LADOS), 1);
  expect(nova.cantos, "os cantos de partida").toBeCloseTo(px(CANTOS), 1);
  expect(nova.contorno, "a espessura do contorno").toBeCloseTo(px(CONTORNO.width), 1);
  expect(nova.corDoContorno).toBe("rgb(0, 0, 0)");

  if (browserName === "chromium") {
    // O contorno pintado antes da cor (paint-order "stroke fill", que o Chromium calcula como "stroke").
    expect(nova.ordem).toMatch(/^stroke/);
  }

  for (const parte of [antes, depois]) {
    expect(parte.fundo, `"${parte.texto}" sem marca-texto`).toBe("rgba(0, 0, 0, 0)");
    expect(parte.contorno, `"${parte.texto}" sem contorno`).toBe(0);
  }

  return nova;
}

async function lerAviso() {
  const db = createLocalAdminClient();

  return unwrap(await db.from("campaigns").select("status").eq("id", avisoId).single(), "Lendo o pop-up") as { status: string };
}

/** Uma aba da aluna numa tela da largura dada (a sessao guardada pelo setup), com a rede de fora cortada. */
async function abaDaAluna(browser: Browser, width: number) {
  const contexto = await browser.newContext({
    baseURL: enderecoDoApp,
    locale: "pt-BR",
    storageState: "tests/e2e/.auth/aluna.json",
    timezoneId: "America/Sao_Paulo",
    viewport: { height: 812, width }
  });
  await bloquearRedeExterna(contexto);

  return { fechar: () => contexto.close(), pagina: await contexto.newPage() };
}

test("contorno e marca-texto numa parte pelo teclado: um passo cada, Ctrl + Z, o gravado e o que a aluna vê", async ({ browser, browserName, page }) => {
  test.setTimeout(180_000);
  const { fechar, pagina } = await abrirComoProdutor(browser, { viewport: TELA_DO_EDITOR });

  try {
    const editor = pagina.getByRole("dialog", { name: "Editor Livre" });
    const area = editor.locator("#livre-titulo-texto");
    const outroEstilo = editor.locator("#livre-titulo-texto-selecao");
    // O estilo da parte fica num popover em portal, fora do dialogo do editor.
    const marcaTexto = pagina.locator("#livre-titulo-texto-parte-marca-texto");
    const contorno = pagina.locator("#livre-titulo-texto-parte-contorno");
    const tituloNoPalco = noPalco(editor, "titulo");

    await test.step("Enter abre o editor e, nas Camadas, Enter escolhe o Título", async () => {
      await pagina.goto(`/admin/comunicacao/avisos/${avisoId}`);
      await pagina.waitForLoadState("networkidle");
      const abrir = card(pagina, "Design").getByRole("button", { name: "Abrir editor Livre" });

      await abrir.focus();
      await pagina.keyboard.press("Enter");
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(prancheta(editor)).toBeVisible();
      // Ao abrir, o foco vai para a primeira linha das Camadas: a dos Links (L64: o da frente em cima). O Título, o
      // primeiro de children, e a ultima linha: End leva a ela.
      await expect(botaoDaCamada(editor, "links")).toBeFocused();
      await pagina.keyboard.press("End");
      await expect(botaoDaCamada(editor, "titulo")).toBeFocused();
      await pagina.keyboard.press("Enter");
      await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "titulo");
    });

    await test.step("marca a palavra na área de texto com Shift + → e chega ao Outro estilo na seleção pelo Tab", async () => {
      await area.focus();
      await expect(area).toBeFocused();
      await pagina.keyboard.press("Home");

      for (let vez = 0; vez < PARTE.inicio; vez += 1) {
        await pagina.keyboard.press("ArrowRight");
      }

      for (let vez = PARTE.inicio; vez < PARTE.fim; vez += 1) {
        await pagina.keyboard.press("Shift+ArrowRight");
      }

      expect(await area.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(PARTE.texto);

      await pagina.keyboard.press("Tab");
      await expect(outroEstilo).toBeFocused();
      await pagina.keyboard.press("Enter");
      await expect(marcaTexto).toBeVisible();
      await expect(marcaTexto).toHaveAttribute("aria-checked", "false");
      await expect(contorno).toHaveAttribute("aria-checked", "false");
    });

    await test.step("Espaço liga o Marca-texto: a parte ganha o fundo vermelho no desenho", async () => {
      await marcaTexto.focus();
      await pagina.keyboard.press("Space");
      await expect(marcaTexto).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await parteNova(tituloNoPalco))?.fundo).toBe(MARCA_TEXTO.rgb);
      expect((await parteNova(tituloNoPalco))?.contorno).toBe(0);
      // O editor junta num passo so as mudancas das partes feitas em menos de 700 ms (FREE_HISTORY_COALESCE_MS): a
      // espera faz do Contorno um passo proprio, como quando a equipe usa o painel com calma.
      await pagina.waitForTimeout(FREE_HISTORY_COALESCE_MS + 200);
    });

    await test.step("Espaço liga o Contorno (preto, 2 px) na mesma parte", async () => {
      await contorno.focus();
      await pagina.keyboard.press("Space");
      await expect(contorno).toHaveAttribute("aria-checked", "true");
      await expect(pagina.locator("#livre-titulo-texto-parte-contorno-espessura")).toHaveValue(String(CONTORNO.width));
      await expect.poll(async () => (await parteNova(tituloNoPalco))?.contorno ?? 0).toBeGreaterThan(0);
      expect((await parteNova(tituloNoPalco))?.fundo).toBe(MARCA_TEXTO.rgb);
    });

    await test.step("Esc fecha o estilo da parte: o foco volta à área de texto e a ficha diz contorno e marca-texto", async () => {
      await pagina.keyboard.press("Escape");
      await expect(marcaTexto).toBeHidden();
      await expect(area).toBeFocused();
      await expect(ficha(editor, "contorno, marca-texto")).toBeVisible();
    });

    await test.step("Ctrl + Z volta um passo só (sai o contorno, o marca-texto fica) e Ctrl + Shift + Z refaz", async () => {
      // Na area de texto, o Ctrl + Z e do campo: o Tab leva ao botao, fora de campo de texto.
      await pagina.keyboard.press("Tab");
      await expect(outroEstilo).toBeFocused();
      await pagina.keyboard.press("Control+z");
      await expect(falado(editor)).toHaveText("Desfeito.");
      await expect(ficha(editor, "marca-texto")).toBeVisible();
      await expect.poll(async () => (await parteNova(tituloNoPalco))?.contorno ?? -1).toBe(0);
      expect((await parteNova(tituloNoPalco))?.fundo).toBe(MARCA_TEXTO.rgb);

      await pagina.keyboard.press("Control+Shift+z");
      await expect(falado(editor)).toHaveText("Refeito.");
      await expect(ficha(editor, "contorno, marca-texto")).toBeVisible();
      await expect.poll(async () => (await parteNova(tituloNoPalco))?.contorno ?? 0).toBeGreaterThan(0);
    });

    await test.step("Salvar rascunho grava a parte na forma canônica, sem o respiro e os cantos de partida", async () => {
      const salvar = editor.getByRole("button", { name: "Salvar rascunho" });

      await salvar.focus();
      await pagina.keyboard.press("Enter");
      await expect(falado(editor)).toHaveText("Rascunho salvo.");

      const gravado = await lerDesignDoAviso(avisoId);
      const titulo = gravado?.children.find((node) => node.id === "titulo");

      expect(gravado?.children.map((node) => node.id)).toEqual(["titulo", "botao", "links"]);
      expect(titulo?.type === "heading" ? { lines: titulo.lines, textStyle: titulo.textStyle } : null).toEqual({
        lines: [[{ text: "Aula " }, { style: { mark: { color: MARCA_TEXTO.hex }, stroke: { ...CONTORNO } }, text: PARTE.texto }, { text: " no ar" }]],
        textStyle: undefined
      });
    });

    await test.step("Concluir e Publicar pop-up pelo teclado", async () => {
      const concluir = editor.getByRole("button", { name: "Concluir e voltar ao aviso" });

      await concluir.focus();
      await pagina.keyboard.press("Enter");
      await expect(editor).toHaveCount(0);

      const publicar = pagina.getByRole("button", { exact: true, name: "Publicar pop-up" });

      // Logo depois de fechar o editor o Publicar pode estar desligado (o aviso ainda ocupado) e o foco volta ao botao
      // que abriu o Livre: o focus() num botao desligado nao move o foco e o Enter reabriria o editor.
      // E ele ainda pode desligar de novo por um instante (o aviso termina de gravar): o foco e repetido ate pegar,
      // em vez de esperar 10 s por um focus() que caiu num botao desligado (CI de 30/10/2026).
      await expect(publicar).toBeEnabled();
      await expect(async () => {
        await publicar.focus();
        await expect(publicar).toBeFocused({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await pagina.keyboard.press("Enter");
      await expect(pagina.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });
      await expect(pagina).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${avisoId}$`));
      expect(await lerAviso()).toEqual({ status: "active" });
    });
  } finally {
    await fechar();
  }

  let respiroNoComputador = 0;

  await test.step("a aluna, a 1440 px, vê o fundo do marca-texto, um fundo por linha e o contorno de 2 px só na parte", async () => {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: NOME_DO_POP_UP });

    await expect(popUp).toBeVisible();
    await expect(popUp.locator("[data-popup-free]")).toBeVisible();
    await expect(popUp.locator('a[data-free-button="cta"]')).toHaveText(BOTAO.label);

    const nova = await conferirParteDaAluna(popUp, browserName);

    expect(Math.round(nova.largura)).toBe(440);
    respiroNoComputador = nova.respiro;
  });

  await test.step("a 375 px, o contorno e o respiro encolhem com o cartão (343/440)", async () => {
    const { fechar: fecharCelular, pagina: celular } = await abaDaAluna(browser, 375);

    try {
      await reabrirPopUpParaAluna(TITULO);
      await celular.goto("/");
      const popUp = celular.getByRole("dialog", { name: NOME_DO_POP_UP });

      await expect(popUp).toBeVisible();
      const nova = await conferirParteDaAluna(popUp, browserName);

      expect(Math.round(nova.largura)).toBe(343);
      expect(nova.respiro).toBeLessThan(respiroNoComputador);
    } finally {
      await fecharCelular();
    }
  });
});
