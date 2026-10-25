import type { Locator, Page } from "@playwright/test";
import type { FreeArtboard, FreeDevices, FreeNode, PopupFreeDesign } from "../../src/server/communications/popup-free-model";
import { popupFreeContentProblems, popupFreeDesignSchema } from "../../src/server/communications/popup-free-schema";
import { applyFreeStarter } from "../../src/server/communications/popup-free-starters";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { contaDeTeste, expect } from "./fixtures";

// Ajudas dos testes de ponta a ponta do editor Livre na tela do produtor (docs/27 §13.9, L4a; docs/18 §2.1), usadas
// pelos specs do arrastar (Camadas, camadas de fundo, desenho e painel Elementos): o rascunho semeado no banco sobre
// o modelo "Em branco" (conferido no schema e com o botao do aviso so quando o design tem o Botão principal, para o
// Revisar nao pedir nada), abrir o editor, a caixa parada antes de medir, o arrastar com o mouse sempre dentro da
// janela e a conferencia antes de soltar, as linhas das Camadas com o pai de cada uma, a frase falada e a conta px
// da prancheta <-> tela. As ajudas do aluno ficam em popup-livre-fixtures.ts. Funciona no WebKit: so mouse, teclado
// e o mouse dentro da janela; esperar a prancheta e a caixa parada antes do primeiro mouse.down.

export const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
/** A tela dos specs do editor (o palco e as tres colunas cabem sem rolar a pagina). */
export const TELA_DO_EDITOR = { height: 900, width: 1440 } as const;
/** O botao do aviso gravado quando o design tem o Botão principal (o mesmo do teste do teclado). */
export const BOTAO_DO_AVISO = { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" } as const;

export type Ponto = { x: number; y: number };
export type BotaoDoAviso = { href: string; label: string; target: "new_tab" | "same_tab" };

export type ExtraDoRascunhoLivre = {
  /** A prancheta, por cima da do "Em branco" (a largura padrao e 440 px). */
  artboard?: Partial<FreeArtboard>;
  /** O botao do aviso; so vale quando os children tem o Botão principal. Padrao: BOTAO_DO_AVISO. */
  botao?: BotaoDoAviso;
  /** Os valores proprios do celular (devices.mobile). */
  devices?: FreeDevices;
};

/** O design tem o Botão principal (um botao com action kind "cta"), em qualquer caixa. */
function temBotaoPrincipal(nodes: readonly FreeNode[]): boolean {
  return nodes.some((node) => (node.type === "button" && node.action.kind === "cta") || (node.type === "box" && temBotaoPrincipal(node.children)));
}

function descrever(problemas: readonly { message: string; path: readonly PropertyKey[] }[]) {
  return problemas.map((problema) => `${problema.path.map(String).join(".")}: ${problema.message}`).join("; ");
}

/**
 * O design semeado: o modelo "Em branco" com estes children (e a prancheta e o celular pedidos), na forma canonica
 * do popupFreeDesignSchema. O botao do aviso (`botao`) so existe quando os children tem o Botão principal; sem ele,
 * fica null (um design so com Fechar ou sem botao nao pede o botao principal). Lanca quando o design nao passa no
 * schema ou nao combina com o aviso (popupFreeContentProblems), para o spec nunca abrir um rascunho que o Revisar
 * recusaria.
 */
export function designDoRascunhoLivre(children: FreeNode[], extra: ExtraDoRascunhoLivre = {}): { botao: BotaoDoAviso | null; design: PopupFreeDesign } {
  const botao = temBotaoPrincipal(children) ? (extra.botao ?? { ...BOTAO_DO_AVISO }) : null;
  const { design: base } = applyFreeStarter("blank", { audio: null, cta: extra.botao ?? { ...BOTAO_DO_AVISO } });
  const parsed = popupFreeDesignSchema.safeParse({
    ...base,
    artboard: { ...base.artboard, ...extra.artboard },
    children,
    ...(extra.devices ? { devices: extra.devices } : {})
  });

  if (!parsed.success) {
    throw new Error(`O design semeado nao passa no schema do Livre: ${descrever(parsed.error.issues)}`);
  }

  const problemas = popupFreeContentProblems(parsed.data, { allowSnooze: true, audio: null, cta: botao });

  if (problemas.length > 0) {
    throw new Error(`O design semeado nao combina com o aviso: ${descrever(problemas)}`);
  }

  return { botao, design: parsed.data };
}

/**
 * Grava um pop-up Livre em rascunho (na home, "Uma vez", para todos) com o design de designDoRascunhoLivre, como o
 * teste do teclado. As colunas do botao (cta_href, cta_label, cta_target) so vao preenchidas quando o design tem o
 * Botão principal; senao ficam null. Devolve o id. Desfaca com zerarComunicacao.
 */
export async function gravarRascunhoLivre(titulo: string, children: FreeNode[], extra: ExtraDoRascunhoLivre = {}): Promise<string> {
  const { botao, design } = designDoRascunhoLivre(children, extra);
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
        cta_href: botao?.href ?? null,
        cta_label: botao?.label ?? null,
        cta_target: botao?.target ?? null,
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
        title: titulo,
        updated_by: produtor.id
      })
      .select("id"),
    `Gravando o rascunho "${titulo}"`
  ) as { id: string }[];

  return linha.id;
}

/** O design gravado do aviso (null quando nao ha design). */
export async function lerDesignDoAviso(id: string): Promise<PopupFreeDesign | null> {
  const db = createLocalAdminClient();
  const linha = unwrap(await db.from("campaigns").select("popup_design").eq("id", id).single(), "Lendo o design do pop-up") as {
    popup_design: PopupFreeDesign | null;
  };

  return linha.popup_design;
}

/** A prancheta desenhada no palco do editor. */
export function prancheta(editor: Locator) {
  return editor.locator("[data-free-canvas-card] [data-free-artboard]");
}

/**
 * Abre o aviso e o editor Livre e espera o networkidle e a prancheta (antes disso, o primeiro mouse.down do WebKit
 * pode cair antes de o palco montar). Devolve o dialogo do editor.
 */
export async function abrirEditorLivre(page: Page, id: string): Promise<Locator> {
  await page.goto(`/admin/comunicacao/avisos/${id}`);
  await page.waitForLoadState("networkidle");

  const design = page.getByRole("region", { exact: true, name: "Design" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });

  await design.getByRole("button", { name: "Abrir editor Livre" }).click();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(prancheta(editor)).toBeVisible();

  return editor;
}

/** A caixa (px de tela) do elemento depois de o palco parar de mudar (o "Ajustar à tela" muda a escala uns quadros depois). */
export async function caixaParada(locator: Locator) {
  const medida = await locator.evaluate(async (element) => {
    const quadro = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let antes = "";
    let iguais = 0;

    for (let vez = 0; vez < 240 && iguais < 3; vez += 1) {
      await quadro();
      const rect = element.getBoundingClientRect();
      const agora = [rect.x, rect.y, rect.width, rect.height].map((valor) => valor.toFixed(2)).join(",");
      iguais = agora === antes ? iguais + 1 : 0;
      antes = agora;
    }

    const rect = element.getBoundingClientRect();

    return { box: { height: rect.height, width: rect.width, x: rect.x, y: rect.y }, parado: iguais >= 3 };
  });

  expect(medida.parado, "o elemento parou de mudar de lugar").toBe(true);

  return medida.box;
}

/** O meio de uma caixa (px de tela). */
export function centroDe(caixa: { height: number; width: number; x: number; y: number }): Ponto {
  return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };
}

/** A linha das Camadas (o botao de selecionar) cujo nome tem o texto. */
export function camada(editor: Locator, comeco: string) {
  return editor.locator("[data-free-layer-select]").filter({ hasText: comeco }).first();
}

/** O botao de selecionar (o botao 0) da linha das Camadas deste id, sem pegar o de uma linha de dentro. */
export function botaoDaCamada(editor: Locator, id: string) {
  return editor.locator(`[data-free-layer-row="${id}"] [data-free-layer-select]`).first();
}

/** O elemento do design desenhado no palco do editor. */
export function noPalco(editor: Locator, id: string) {
  return editor.locator(`[data-free-canvas-card] [data-free-id="${id}"]`).first();
}

/** A frase falada do editor (a regiao aria-live). */
export function falado(editor: Locator) {
  return editor.locator("[data-free-live]");
}

/**
 * O foco esta nesta area (nela ou dentro dela). Para conferir o foco depois de um gesto do mouse nos dois navegadores:
 * o mousedown num botao foca o botao no Chromium; no WebKit, o primeiro de fora que recebe foco pelo clique (o painel
 * com tabIndex). Os dois ficam dentro da mesma area, e nunca no body.
 */
export async function focoDentro(area: Locator) {
  return area.evaluate((element) => element.contains(document.activeElement));
}

/** As linhas das Camadas na ordem da lista, com o id da caixa de fora (null na prancheta). */
export async function linhasDasCamadas(editor: Locator): Promise<{ id: string; pai: string | null }[]> {
  return editor.locator("[data-free-layer-row]").evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.getAttribute("data-free-layer-row") ?? "",
      pai: row.parentElement?.closest("[data-free-layer-row]")?.getAttribute("data-free-layer-row") ?? null
    }))
  );
}

function dentroDaJanela(page: Page, ponto: Ponto, nome: string) {
  const tela = page.viewportSize() ?? TELA_DO_EDITOR;

  if (!(ponto.x >= 0 && ponto.y >= 0 && ponto.x < tela.width && ponto.y < tela.height)) {
    throw new Error(`O ponto ${nome} (${ponto.x}, ${ponto.y}) fica fora da janela (${tela.width} x ${tela.height}): o WebKit perde o gesto.`);
  }
}

/**
 * Arrasta com o mouse de um ponto a outro (px de tela): move, aperta, move em passos (sempre dentro da janela: os
 * dois pontos sao conferidos, e o caminho entre eles fica dentro), roda a conferencia (`antesDeSoltar`, por exemplo
 * esperar o indicador) e solta. Se a conferencia falhar, aperta Esc antes de soltar (nada muda) e o erro segue.
 */
export async function arrastar(page: Page, de: Ponto, para: Ponto, opcoes: { antesDeSoltar?: () => Promise<void>; steps?: number } = {}) {
  dentroDaJanela(page, de, "de partida");
  dentroDaJanela(page, para, "de chegada");
  await page.mouse.move(de.x, de.y);
  await page.mouse.down();
  let conferido = false;

  try {
    await page.mouse.move(para.x, para.y, { steps: opcoes.steps ?? 10 });
    await opcoes.antesDeSoltar?.();
    conferido = true;
  } finally {
    if (!conferido) {
      await page.keyboard.press("Escape").catch(() => undefined);
    }

    await page.mouse.up();
  }
}

/** Escala (px de tela por px da prancheta) e o canto de dentro da borda da prancheta, depois de o palco parar. */
async function medidaDaPrancheta(editor: Locator, largura: number) {
  const medida = await prancheta(editor).evaluate(async (element, W) => {
    const quadro = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // A mesma conta do desenho (free-canvas.tsx, measure): escala = largura medida / W; a origem e o canto de
    // dentro da borda (clientLeft e clientTop em px de layout, vezes a escala do palco).
    const ler = () => {
      const html = element as HTMLElement;
      const box = html.getBoundingClientRect();
      const porLayout = box.width / (html.offsetWidth || W) || 1;

      return { escala: box.width / W || 1, x: box.left + html.clientLeft * porLayout, y: box.top + html.clientTop * porLayout };
    };
    let antes = "";
    let iguais = 0;

    for (let vez = 0; vez < 240 && iguais < 3; vez += 1) {
      await quadro();
      const agora = ler();
      const chave = [agora.escala, agora.x, agora.y].map((valor) => valor.toFixed(3)).join(",");
      iguais = chave === antes ? iguais + 1 : 0;
      antes = chave;
    }

    return { ...ler(), parado: iguais >= 3 };
  }, largura);

  expect(medida.parado, "a prancheta parou de mudar de lugar").toBe(true);

  return { escala: medida.escala, origem: { x: medida.x, y: medida.y } };
}

/**
 * Um ponto em px da prancheta (o X e o Y do Avançado) levado para a tela. `largura` e o W do design (padrao 440):
 * no Celular a prancheta desenha 343 px para os W, e a escala sai da largura medida / W.
 */
export async function pontoNaPrancheta(editor: Locator, x: number, y: number, largura = 440): Promise<Ponto> {
  const { escala, origem } = await medidaDaPrancheta(editor, largura);

  return { x: origem.x + x * escala, y: origem.y + y * escala };
}

/** Um ponto da tela levado para px da prancheta (a conta inversa de pontoNaPrancheta). */
export async function daPrancheta(editor: Locator, client: Ponto, largura = 440): Promise<Ponto> {
  const { escala, origem } = await medidaDaPrancheta(editor, largura);

  return { x: (client.x - origem.x) / escala, y: (client.y - origem.y) / escala };
}
