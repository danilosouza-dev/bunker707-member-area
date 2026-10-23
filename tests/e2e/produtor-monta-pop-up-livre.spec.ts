import type { Locator, Page } from "@playwright/test";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { contaDeTeste, estadoDoPopUpDaAluna, eventosDoPopUp, expect, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";

// Design Livre de ponta a ponta (docs/27 §8; spec §7.3; docs/18 §3.1). Num aviso NOVO, o produtor escolhe Livre,
// usa o modelo "Vídeo no topo com degradê" (o editor de tela cheia abre), envia o video de teste, troca as duas
// linhas do titulo na area de texto e da outra cor a cada linha com "Outro estilo na seleção", envia a fonte de
// teste e usa no titulo, acerta o Botão principal (texto e destino), acrescenta um Selo, solta, arrasta com o mouse
// e ajusta com as setas, centraliza com "Alinhar ao centro", poe um respiro proprio em cada lado, acrescenta uma
// Imagem (envio), solta, arrasta ate a borda (a guia aparece e ela gruda) e redimensiona pela alca com Shift
// (proporcao mantida), esconde o Texto pelas Camadas e desfaz/refaz, troca a largura para G (os elementos
// acompanham), ve Computador e Celular, "Salvar rascunho" COM O EDITOR ABERTO (o editor continua aberto, o
// endereco ainda e o de aviso novo e Ctrl + Z ainda desfaz), "Concluir" (o endereco passa a ser o do aviso),
// recarrega (tudo igual) e publica. A aluna ve o Livre a 1440 e a 375 px: texto de verdade (selecionavel), as
// duas cores e a fonte enviada, tudo encolhido na mesma proporcao no celular (343 / 520), nenhum texto abaixo de
// 12 px, o X fecha e o clique no botao conta. Com E2E_SHOTS_DIR, guarda as fotos do editor e do pop-up.
// Depois, com o pop-up NO AR (docs/27 L16): o salvar de dentro do editor Livre diz "Salvar alterações" e a frase do
// pop-up no ar (nunca "Rascunho salvo."), e o "Mostrar de novo para quem já viu" ligado fica para o salvar do aviso.

const TITULO = "Pop-up E2E: o produtor monta no Livre";
const LINHA_1 = "Aprenda IA";
const LINHA_2 = "Do zero ao agente";
const NOME_NO_DIALOGO = `${LINHA_1} ${LINHA_2}`;
const COR_1 = { hex: "#38bdf8", rgb: "rgb(56, 189, 248)" };
const COR_2 = { hex: "#f472b6", rgb: "rgb(244, 114, 182)" };
const BOTAO = "Quero assistir";
const FONTE = "Fonte do Livre E2E";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const SHOTS = process.env.E2E_SHOTS_DIR;
const GUIA = "rgb(255, 62, 165)";
/** O respiro proprio do selo: em cima/embaixo 6, nos lados 14. */
const RESPIRO = [6, 14, 6, 14] as const;

type DesignGravado = {
  artboard?: { width?: number };
  assets: { height?: number; id: string; kind: "image" | "video"; path: string; poster?: string; width?: number }[];
  children: {
    box?: { padding?: number | number[] };
    hidden?: boolean;
    id: string;
    label?: string;
    lines?: { style?: { font?: { id?: string; kind: string }; paint?: { color: string } }; text: string }[][];
    place?: { h?: number; mode: string; w?: number; x?: number; y?: number };
    textStyle?: { font?: { id?: string; kind: string } };
    type: string;
  }[];
  fonts: string[];
  mode: string;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

async function lerAviso(titulo: string) {
  const db = createLocalAdminClient();

  return unwrap(
    await db.from("campaigns").select("id,cta_href,cta_label,popup_design,status").eq("kind", "popup").eq("title", titulo).is("deleted_at", null).maybeSingle(),
    `Lendo o pop-up "${titulo}"`
  ) as { cta_href: string | null; cta_label: string | null; id: string; popup_design: DesignGravado | null; status: string } | null;
}

/** Quando o pop-up voltou a contar como novo para a aluna ("Mostrar de novo para quem já viu"); null = nunca. */
async function mostradoDeNovoParaAluna(campaignId: string) {
  const db = createLocalAdminClient();
  const aluna = await contaDeTeste("aluna");
  const entrega = unwrap(
    await db.from("campaign_deliveries").select("reshown_at").eq("campaign_id", campaignId).eq("user_id", aluna.id).single(),
    "Lendo a entrega do pop-up da aluna"
  ) as { reshown_at: string | null };

  return entrega.reshown_at;
}

/** A linha das Camadas (o botao de selecionar) cujo nome comeca com o texto. */
function camada(editor: Locator, comeco: string) {
  return editor.locator("[data-free-layer-select]").filter({ hasText: comeco }).first();
}

/** O elemento do design desenhado no palco do editor. */
function noPalco(editor: Locator, id: string) {
  return editor.locator(`[data-free-canvas-card] [data-free-id="${id}"]`).first();
}

/** Seleciona um trecho da area de texto (inicio e fim em letras do texto inteiro). */
async function selecionarTrecho(area: Locator, inicio: number, fim: number) {
  await area.focus();
  await area.evaluate((element: HTMLTextAreaElement, [start, end]) => element.setSelectionRange(start, end), [inicio, fim] as const);
}

/** Uma cor so para o trecho: "Outro estilo na seleção" e a cor no estilo da parte. */
async function corNoTrecho(page: Page, editor: Locator, idDoTitulo: string, inicio: number, fim: number, cor: string) {
  const area = editor.locator(`#livre-${idDoTitulo}-texto`);
  await selecionarTrecho(area, inicio, fim);
  await editor.locator(`#livre-${idDoTitulo}-texto-selecao`).click();
  const campo = page.locator(`#livre-${idDoTitulo}-texto-parte-cor-cor`);
  await expect(campo).toBeVisible();
  await campo.fill(cor);
  await page.getByRole("button", { exact: true, name: "Fechar" }).filter({ visible: true }).last().click();
  await expect(campo).toBeHidden();
  // Ao fechar, o foco volta para a area de texto (com o trecho marcado); so depois o passo seguinte mexe no foco.
  await expect(area).toBeFocused();
}

/** Um campo de numero (Base UI): clica antes de preencher (senao o texto novo vai para o fim do que ja tinha). */
async function preencherNumero(campo: Locator, valor: number) {
  await campo.click();
  await campo.fill(String(valor));
  await campo.press("Tab");
}

/**
 * A caixa (px de tela) de um elemento, medida pela propria pagina quando para de mudar: com "Ajustar à tela", o
 * palco muda de escala alguns quadros depois de o cartao crescer ou encolher (soltar um elemento perto do pe muda a
 * altura), e o WebKit da CI chegava a medir antes. `livre`: o ponto do meio e o proprio elemento (nada por cima).
 */
async function caixaParada(locator: Locator) {
  return locator.evaluate(async (element) => {
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
    const meio = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

    return {
      box: rect.width > 0 && rect.height > 0 ? { height: rect.height, width: rect.width, x: rect.x, y: rect.y } : null,
      livre: document.elementFromPoint(meio.x, meio.y) === element,
      meio,
      parado: iguais >= 3
    };
  });
}

/** A caixa (px de tela) de um elemento desenhado, depois de o palco parar de mudar. */
async function caixa(locator: Locator) {
  const medida = await caixaParada(locator);
  expect(medida.parado, "o elemento parou de mudar de lugar").toBe(true);
  expect(medida.box, "elemento desenhado").not.toBeNull();
  return medida.box as { height: number; width: number; x: number; y: number };
}

/** O meio do elemento, conferido depois de o palco parar: o que esta nesse ponto da tela e o proprio elemento. */
async function meioLivre(locator: Locator) {
  const medida = await caixaParada(locator);
  expect(medida.parado, "o elemento parou de mudar de lugar").toBe(true);
  expect(medida.livre, "o meio do elemento esta livre na tela").toBe(true);
  return medida.meio;
}

/** O numero de um campo do painel (aceita a virgula do pt-BR). */
async function numeroDe(campo: Locator) {
  return Number((await campo.inputValue()).replace(",", "."));
}

/** Ha uma guia de alinhamento (linha de 1 px na cor das guias) na camada de selecao. */
async function guiaVisivel(editor: Locator) {
  return editor.locator("[data-free-overlay] > div").evaluateAll(
    (divs, cor) => divs.some((div) => getComputedStyle(div).backgroundColor === cor),
    GUIA
  );
}

test.describe("produtor", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

  test("monta o Livre do zero ao publicado num aviso novo, com o editor aberto até o Concluir", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(TITULO);

    const design = page.getByRole("region", { exact: true, name: "Design" });
    const editor = page.getByRole("dialog", { name: "Editor Livre" });

    await test.step("escolhe Livre e o modelo; o editor de tela cheia abre nas Camadas", async () => {
      await design.getByText("Livre", { exact: true }).click();
      await expect(design.getByText("Escolha um ponto de partida. No editor, tudo pode ser mudado.", { exact: true })).toBeVisible();
      await design.getByRole("button", { name: "Usar este modelo: Vídeo no topo com degradê" }).click();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-free-layer-select") ?? false)).toBe(true);
    });

    await test.step("envia o video do topo (um quadro dele vira a capa)", async () => {
      await camada(editor, "Vídeo do topo").click();
      await editor.locator('input[type="file"][accept="video/mp4,video/webm"]').setInputFiles("tests/fixtures/popup-design/video-de-teste.mp4");
      await expect(editor.getByText("Vídeo enviado.", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(noPalco(editor, "midia").locator("video, img").first()).toBeVisible();
    });

    await test.step("troca as duas linhas do titulo e da uma cor a cada uma com Outro estilo na seleção", async () => {
      await camada(editor, "Título").click();
      const area = editor.locator("#livre-titulo-texto");
      await area.fill(`${LINHA_1}\n${LINHA_2}`);
      await expect(area).toHaveValue(`${LINHA_1}\n${LINHA_2}`);
      await corNoTrecho(page, editor, "titulo", 0, LINHA_1.length, COR_1.hex);
      await corNoTrecho(page, editor, "titulo", LINHA_1.length + 1, LINHA_1.length + 1 + LINHA_2.length, COR_2.hex);

      const titulo = noPalco(editor, "titulo");
      await expect(titulo.getByText(LINHA_1, { exact: true })).toHaveCSS("color", COR_1.rgb);
      await expect(titulo.getByText(LINHA_2, { exact: true })).toHaveCSS("color", COR_2.rgb);
      await expect(editor.getByRole("button", { name: `“${LINHA_1}”` })).toBeVisible();
    });

    await test.step("envia a fonte de teste no painel Pop-up e usa no titulo", async () => {
      await editor.locator("[data-free-stage]").focus();
      await page.keyboard.press("Escape");
      await expect(editor.getByText("Nada selecionado: aqui fica o pop-up inteiro.", { exact: true })).toBeVisible();
      await editor.getByRole("button", { exact: true, name: "Enviar fonte" }).click();
      const envio = page.getByRole("dialog", { name: "Enviar fonte" });
      await envio.locator('input[type="file"]').setInputFiles("tests/fixtures/popup-design/fonte-de-teste.woff2");
      await envio.getByLabel("Nome", { exact: true }).fill(FONTE);
      await envio.getByRole("button", { exact: true, name: "Enviar" }).click();
      await expect(envio).toBeHidden({ timeout: 30_000 });

      await camada(editor, "Título").click();
      await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
      await editor.locator("#livre-titulo-fonte-lista").click();
      await page.getByRole("option", { exact: true, name: FONTE }).click();
      await expect.poll(() => noPalco(editor, "titulo").evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/bf_[a-f0-9]{12}/);
    });

    await test.step("acerta o Botão principal: texto e destino", async () => {
      await camada(editor, "Botão principal").click();
      await editor.getByRole("tab", { exact: true, name: "Conteúdo" }).click();
      await editor.locator("#livre-botao-botao-texto").fill(BOTAO);
      await editor.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Página da área", { exact: true }).click();
      await editor.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
      await expect(noPalco(editor, "botao")).toContainText(BOTAO);
    });

    let selo = "";

    await test.step("acrescenta um Selo, solta, arrasta com o mouse, ajusta com as setas e centraliza", async () => {
      await camada(editor, "Título").click();
      await editor.getByRole("tab", { exact: true, name: "Elementos" }).click();
      await editor.locator("[data-free-element]").filter({ hasText: "Selo" }).click();
      selo = await editor.locator("[data-free-selection]").getAttribute("data-free-selection").then((value) => value ?? "");
      expect(selo).toMatch(/^[a-z][a-z0-9]*$/);
      expect(selo).not.toBe("selo");

      await editor.locator("[data-free-toolbar='Soltar']").click();
      await expect(editor.getByText("Agora está solto.", { exact: true })).toHaveCount(1);
      await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
      const campoX = editor.locator(`#livre-${selo}-x`);
      const campoY = editor.locator(`#livre-${selo}-y`);
      const antes = { x: await numeroDe(campoX), y: await numeroDe(campoY) };

      // Arrastar com o mouse: o design so muda no fim (um passo no historico).
      const box = await caixa(noPalco(editor, selo));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => numeroDe(campoY)).toBeGreaterThan(antes.y + 10);

      // Setas no palco: 1 px; Shift + seta: 10 px.
      const depois = { x: await numeroDe(campoX), y: await numeroDe(campoY) };
      await editor.locator("[data-free-stage]").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowDown");
      await expect.poll(() => numeroDe(campoX)).toBe(depois.x + 2);
      await expect.poll(() => numeroDe(campoY)).toBe(depois.y + 10);

      // Alinhar ao centro (o caminho pelos campos): X = (440 - largura) / 2, pelo retangulo medido (1 px de folga).
      await editor.getByRole("button", { exact: true, name: "Alinhar ao centro" }).click();
      const largura = await numeroDe(editor.locator(`#livre-${selo}-largura`));
      await expect.poll(async () => Math.abs((await numeroDe(campoX)) - (440 - largura) / 2)).toBeLessThanOrEqual(1);

      // Respiro interno proprio em cada lado ("Todos iguais" desligado: o selo novo ja vem com [4, 10]).
      const iguais = editor.locator(`#livre-${selo}-respiro-iguais`);

      if ((await iguais.getAttribute("aria-checked")) === "true") {
        await iguais.click();
      }

      for (const [index, valor] of RESPIRO.entries()) {
        await preencherNumero(editor.locator(`#livre-${selo}-respiro-${index}`), valor);
      }

      await expect(noPalco(editor, selo)).toHaveCSS("padding-top", /^\d/);
      const padding = await noPalco(editor, selo).evaluate((element) => {
        const css = getComputedStyle(element);
        return [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map((value) => parseFloat(value));
      });
      // Em cqw da prancheta: a proporcao entre os lados e a escolhida (6 : 14).
      expect(Math.abs(padding[1] / padding[0] - 14 / 6)).toBeLessThan(0.05);
    });

    let imagem = "";

    await test.step("acrescenta uma Imagem, envia, solta, arrasta ate a borda (guia) e redimensiona pela alca", async () => {
      await editor.getByRole("tab", { exact: true, name: "Elementos" }).click();
      await editor.locator("[data-free-element]").filter({ hasText: "Imagem" }).click();
      // O editor poe o foco em "Enviar imagem" (o seletor de arquivos nunca abre sozinho).
      await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/^livre-[a-z0-9]+-enviar$/);
      const enviar = await page.evaluate(() => document.activeElement?.id ?? "");
      imagem = enviar.replace(/^livre-/, "").replace(/-enviar$/, "");
      await editor.locator(`#${enviar} ~ input[type="file"]`).setInputFiles("tests/fixtures/popup-livre/imagem-transparente.webp");
      await expect(editor.getByText(/^Imagem de \d+ × \d+ px$/)).toBeVisible({ timeout: 30_000 });

      await editor.locator("[data-free-toolbar='Soltar']").click();
      await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
      const campoX = editor.locator(`#livre-${imagem}-x`);
      const prancheta = await caixa(editor.locator("[data-free-canvas-card] [data-free-artboard]"));
      const box = await caixa(noPalco(editor, imagem));

      // Arrasta ate 3 px de tela da borda esquerda: a guia aparece e a borda gruda no X 0.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const alvo = prancheta.x + 3 - box.x;
      await page.mouse.move(box.x + box.width / 2 + alvo / 2, box.y + box.height / 2 + 10, { steps: 4 });
      await page.mouse.move(box.x + box.width / 2 + alvo, box.y + box.height / 2 + 20, { steps: 4 });
      await expect.poll(() => guiaVisivel(editor)).toBe(true);
      await page.mouse.up();
      await expect.poll(() => numeroDe(campoX)).toBe(0);

      // Redimensiona pela alca do canto de baixo a direita, com Shift: a proporcao fica.
      const antes = { h: await numeroDe(editor.locator(`#livre-${imagem}-altura`)), w: await numeroDe(editor.locator(`#livre-${imagem}-largura`)) };
      const alca = editor.locator("[data-free-handle='se']");
      const ponto = await meioLivre(alca);
      // A alca fica perto do pe da tela: o ponteiro nao sai da janela (o WebKit nao entrega movimento fora dela). No
      // canto com Shift vale o maior dos dois movimentos, entao o lado direito puxa a largura.
      const janela = page.viewportSize() ?? { height: 900, width: 1440 };
      const desce = Math.max(0, Math.min(60, janela.height - ponto.y - 4));
      await page.keyboard.down("Shift");
      await page.mouse.move(ponto.x, ponto.y);
      await page.mouse.down();
      await page.mouse.move(ponto.x + 60, ponto.y + desce, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      const largura = editor.locator(`#livre-${imagem}-largura`);
      await expect.poll(() => numeroDe(largura)).toBeGreaterThan(antes.w);
      const depois = { h: await numeroDe(editor.locator(`#livre-${imagem}-altura`)), w: await numeroDe(largura) };
      expect(Math.abs(depois.w / depois.h - antes.w / antes.h)).toBeLessThan(0.05);
    });

    await test.step("esconde o Texto pelas Camadas e desfaz/refaz", async () => {
      await editor.getByRole("tab", { exact: true, name: "Camadas" }).click();
      const esconder = editor.locator('[data-free-layer-row="texto"]').getByRole("button", { exact: true, name: "Esconder" });
      await esconder.click();
      await expect(esconder).toHaveAttribute("aria-pressed", "true");
      await expect(noPalco(editor, "texto")).toHaveCount(0);
      await editor.getByRole("button", { exact: true, name: "Desfazer" }).click();
      await expect(noPalco(editor, "texto")).toBeVisible();
      await editor.getByRole("button", { exact: true, name: "Refazer" }).click();
      await expect(noPalco(editor, "texto")).toHaveCount(0);
      await editor.getByRole("button", { exact: true, name: "Desfazer" }).click();
      await expect(noPalco(editor, "texto")).toBeVisible();
    });

    await test.step("troca a largura para G: os elementos acompanham", async () => {
      await editor.locator("[data-free-stage]").focus();
      await page.keyboard.press("Escape");
      await expect(editor.getByText("Nada selecionado: aqui fica o pop-up inteiro.", { exact: true })).toBeVisible();
      await editor.locator('label:has(input[name="livre-popup-largura"][value="520"]), label:has-text("G (520 px)")').first().click();
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 520);
      // O video do topo continua na largura toda.
      await expect.poll(() => noPalco(editor, "midia").evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(520);
    });

    await test.step("ve Computador e Celular", async () => {
      await editor.getByRole("button", { exact: true, name: "Celular" }).click();
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 343);

      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/editor-livre-celular-1440.png` });
      }

      await editor.getByRole("button", { exact: true, name: "Computador" }).click();
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 520);

      if (SHOTS) {
        await camada(editor, "Imagem").click();
        await page.screenshot({ path: `${SHOTS}/editor-livre-1440.png` });
      }
    });

    await test.step("Salvar rascunho com o editor aberto: continua aberto, sem trocar de endereco, e Ctrl + Z ainda desfaz", async () => {
      await editor.getByRole("button", { name: "Salvar rascunho" }).click();
      await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);
      await expect(editor).toBeVisible();
      expect(page.url()).toMatch(/\/admin\/comunicacao\/avisos\/novo/);

      const salvo = await lerAviso(TITULO);
      expect(salvo?.popup_design?.mode).toBe("free");
      expect(salvo?.popup_design?.artboard?.width).toBe(520);

      // O historico continua: Ctrl + Z volta a largura e Ctrl + Shift + Z refaz.
      await editor.locator("[data-free-stage]").focus();
      await page.keyboard.press("Control+z");
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 440);
      await page.keyboard.press("Control+Shift+z");
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 520);
    });

    await test.step("Concluir: o endereco passa a ser o do aviso, o card mostra o resumo", async () => {
      await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
      await expect(editor).toHaveCount(0);
      await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
      await page.waitForLoadState("networkidle");
      await expect(design.getByText(/^\d+ elementos · 520 px$/)).toBeVisible();
      await expect(design.getByRole("button", { name: "Abrir editor Livre" })).toBeVisible();
      // No Livre, o conteudo esconde texto, icone, imagem e destino (como no Personalizado): o titulo vira o nome.
      await expect(page.getByLabel("Nome do pop-up", { exact: true })).toHaveValue(TITULO);
      await expect(page.locator("#aviso-texto")).toHaveCount(0);
      await expect(page.locator("#aviso-botao-texto")).toHaveCount(0);
    });

    await test.step("recarrega: tudo igual (o editor abre com o que foi salvo)", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await design.getByRole("button", { name: "Abrir editor Livre" }).click();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      const titulo = noPalco(editor, "titulo");
      await expect(titulo.getByText(LINHA_1, { exact: true })).toHaveCSS("color", COR_1.rgb);
      await expect(titulo.getByText(LINHA_2, { exact: true })).toHaveCSS("color", COR_2.rgb);
      await expect(noPalco(editor, selo)).toBeVisible();
      await expect(noPalco(editor, imagem)).toBeVisible();
      await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toHaveJSProperty("offsetWidth", 520);
      await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
      await expect(editor).toHaveCount(0);
      await expect(design.getByRole("button", { name: "Abrir editor Livre" })).toBeFocused();
    });

    await test.step("a previa do aviso mostra o Livre no celular e no computador; publica", async () => {
      const previa = page.getByRole("region", { exact: true, name: "Prévia" });
      for (const aparelho of ["celular", "computador"]) {
        const figura = previa.getByRole("figure", { name: `Prévia do pop-up no ${aparelho}` });
        await expect(figura.locator("[data-free-artboard]")).toBeVisible();
        await expect(figura.getByText(LINHA_1, { exact: true })).toHaveCSS("color", COR_1.rgb);
      }

      await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
      await expect(page.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });
    });

    // O que ficou gravado: o Livre na forma canonica, so com caminhos dos nossos buckets.
    const gravado = await lerAviso(TITULO);
    const livre = gravado?.popup_design as DesignGravado;
    expect(gravado?.status).toBe("active");
    expect(gravado?.cta_label).toBe(BOTAO);
    expect(gravado?.cta_href).toBe("/minhas-compras");
    expect(livre.mode).toBe("free");
    expect(livre.artboard?.width).toBe(520);
    expect(JSON.stringify(livre)).not.toMatch(/https?:/);
    const titulo = livre.children.find((node) => node.id === "titulo");
    expect(titulo?.lines?.map((line) => line.map((span) => [span.text, span.style?.paint?.color ?? null]))).toEqual([
      [[LINHA_1, COR_1.hex]],
      [[LINHA_2, COR_2.hex]]
    ]);
    expect(titulo?.textStyle?.font).toEqual({ id: livre.fonts[0], kind: "uploaded" });
    const seloGravado = livre.children.find((node) => node.id === selo);
    expect(seloGravado?.type).toBe("badge");
    expect(seloGravado?.place?.mode).toBe("free");
    expect(seloGravado?.box?.padding).toEqual([RESPIRO[0], RESPIRO[1]].map((valor) => Math.round((valor * 520) / 440)));
    const imagemGravada = livre.children.find((node) => node.id === imagem);
    expect(imagemGravada?.place).toMatchObject({ mode: "free", x: 0 });
    expect(livre.children.find((node) => node.id === "texto")?.hidden).toBeUndefined();
    const video = livre.assets.find((asset) => asset.kind === "video");
    expect(video?.path).toMatch(/^videos\/[0-9a-f-]{36}\.mp4$/);
    expect(livre.assets.filter((asset) => asset.kind === "image").every((asset) => /^communications\/free\/[a-f0-9]{24}\.webp$/.test(asset.path))).toBe(true);
  });
});

test.describe("aluna", () => {
  async function abrirPopUp(page: Page) {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: NOME_NO_DIALOGO });
    await expect(popUp).toBeVisible();
    await expect(popUp.locator("[data-free-artboard]")).toBeVisible();
    return popUp;
  }

  async function proporcoes(popUp: Locator) {
    const prancheta = await caixa(popUp.locator("[data-free-artboard]"));
    const midia = await caixa(popUp.locator('[data-free-id="midia"]'));

    return { largura: prancheta.width, midia: midia.width / prancheta.width, midiaAltura: midia.height / prancheta.width };
  }

  test.describe("computador (1440 px)", () => {
    test.use({ viewport: { height: 900, width: 1440 } });

    test("vê o Livre com texto de verdade, as duas cores e a fonte enviada; o clique no botão conta", async ({ page }) => {
      const popUp = await abrirPopUp(page);
      const titulo = popUp.getByRole("heading", { level: 2, name: NOME_NO_DIALOGO });
      await expect(titulo).toBeVisible();
      await expect(popUp.getByText(TITULO)).toHaveCount(0);

      if (SHOTS) {
        await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
        await page.screenshot({ path: `${SHOTS}/aluno-livre-montado-1440.png` });
      }

      // Texto de verdade: a selecao pega as duas linhas; nada de imagem no lugar do texto.
      const selecionado = await titulo.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        return window.getSelection()?.toString() ?? "";
      });
      expect(selecionado.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR")).toBe(NOME_NO_DIALOGO.toLocaleLowerCase("pt-BR"));
      expect(await titulo.evaluate((element) => element.querySelectorAll("img, svg, canvas, picture, video").length)).toBe(0);
      await expect(titulo.getByText(LINHA_1, { exact: true })).toHaveCSS("color", COR_1.rgb);
      await expect(titulo.getByText(LINHA_2, { exact: true })).toHaveCSS("color", COR_2.rgb);
      expect(await titulo.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/bf_[a-f0-9]{12}/);

      // Largura G: 520 px no computador; o video do topo na largura toda.
      const medidas = await proporcoes(popUp);
      expect(Math.round(medidas.largura)).toBe(520);
      expect(Math.abs(medidas.midia - 1)).toBeLessThan(0.01);
      await expect.poll(() => popUp.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime > 0 && element.muted)).toBe(true);

      const botao = popUp.getByRole("link", { name: BOTAO });
      await botao.click();
      await expect(page).toHaveURL(/\/minhas-compras$/);
      await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.clickedAt ?? null).not.toBeNull();
      const aviso = await lerAviso(TITULO);
      await expect.poll(async () => (await eventosDoPopUp(aviso?.id ?? "")).map((evento) => evento.event_type)).toContain("message_clicked");
    });
  });

  test.describe("celular (375 px)", () => {
    test.use({ viewport: { height: 812, width: 375 } });

    test("o mesmo desenho menor (343 / 520), nenhum texto abaixo de 12 px, sem rolagem lateral; o X fecha", async ({ page }) => {
      await reabrirPopUpParaAluna(TITULO);
      const popUp = await abrirPopUp(page);
      const medidas = await proporcoes(popUp);
      expect(Math.round(medidas.largura)).toBe(343);
      // O video tem altura fixa (solto): encolhe na mesma proporcao da prancheta (248 * 520 / 440 = 293 de 520).
      expect(Math.abs(medidas.midiaAltura - 293 / 520)).toBeLessThan(0.02);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      // Texto de verdade e nunca abaixo de 12 px (os links de 13 px no desenho viram 12 px no celular).
      const tamanhos = await popUp.locator("[data-free-artboard] :is(h2, h3, p, a, button, span)").evaluateAll((elements) =>
        elements.filter((element) => (element.textContent ?? "").trim().length > 0 && element.getClientRects().length > 0).map((element) => parseFloat(getComputedStyle(element).fontSize))
      );
      expect(tamanhos.length).toBeGreaterThan(3);
      expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(12);
      expect(Math.round((await popUp.getByRole("link", { name: BOTAO }).boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(30);

      if (SHOTS) {
        await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
        await page.screenshot({ path: `${SHOTS}/aluno-livre-montado-375.png` });
      }

      await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
      await expect(popUp).toHaveCount(0);
      const aviso = await lerAviso(TITULO);
      await expect.poll(async () => (await eventosDoPopUp(aviso?.id ?? "")).at(-1)?.event_type).toBe("message_closed");
      expect((await eventosDoPopUp(aviso?.id ?? "")).at(-1)?.metadata).toMatchObject({ via: "x" });
    });
  });
});

test.describe("produtor com o pop-up no ar", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

  test("o editor Livre salva como o editor do aviso; o Mostrar de novo fica para o salvar do aviso", async ({ page }) => {
    const aviso = await lerAviso(TITULO);
    expect(aviso?.status).toBe("active");
    const id = aviso?.id ?? "";
    expect(await mostradoDeNovoParaAluna(id)).toBeNull();

    await page.goto(`/admin/comunicacao/avisos/${id}?editar=1`);
    await page.waitForLoadState("networkidle");
    const mostrarDeNovo = page.getByRole("switch", { name: "Mostrar de novo para quem já viu" });
    await mostrarDeNovo.click();
    await expect(mostrarDeNovo).toBeChecked();

    const editor = page.getByRole("dialog", { name: "Editor Livre" });
    await page.getByRole("region", { exact: true, name: "Design" }).getByRole("button", { name: "Abrir editor Livre" }).click();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.locator('[data-free-layer-row="texto"]').getByRole("button", { exact: true, name: "Esconder" }).click();
    await expect(noPalco(editor, "texto")).toHaveCount(0);

    // No ar: o botao do editor do aviso e a frase do pop-up no ar, sem o "Mostrar de novo" (a contagem fica para la).
    await expect(editor.getByRole("button", { name: "Salvar rascunho" })).toHaveCount(0);
    await editor.getByRole("button", { exact: true, name: "Salvar alterações" }).click();
    await expect(
      editor.getByText("Pop-up atualizado. Quem já viu não vê de novo. Para quem já está com a área aberta, pode levar até 1 minuto.", { exact: true })
    ).toHaveCount(1);
    await expect(page.getByText("Rascunho salvo.", { exact: true })).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect.poll(async () => (await lerAviso(TITULO))?.popup_design?.children.find((node) => node.id === "texto")?.hidden ?? false).toBe(true);
    expect((await lerAviso(TITULO))?.status).toBe("active");
    expect(await mostradoDeNovoParaAluna(id)).toBeNull();

    // O pedido continua ligado: o salvar do aviso (sem outra mudanca) mostra de novo e conta quantos.
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
    await expect(mostrarDeNovo).toBeChecked();
    await page.getByRole("button", { exact: true, name: "Salvar alterações" }).click();
    await expect(
      page.getByText("Pop-up atualizado. Ele volta a aparecer para 1 aluno que já tinha visto. Para quem já está com a área aberta, pode levar até 1 minuto.", {
        exact: true
      })
    ).toBeVisible();
    await expect(mostrarDeNovo).not.toBeChecked();
    expect(await mostradoDeNovoParaAluna(id)).not.toBeNull();
  });
});
