import type { Locator, Page } from "@playwright/test";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { contaDeTeste, expect, test, zerarComunicacao } from "./fixtures";

// Livre: valores proprios do celular (docs/27 §9.10 e §13.8, PR L3; docs/18 §3.1). Num rascunho com um design
// Livre (Selo solto, Título na sequência, Forma solta e os Links), o produtor seleciona a Forma com o Computador
// ligado e abre a aba Celular, que liga "Ver como: Celular" (o editor diz "Editando o Celular."), arrasta o Selo no desenho (so o celular muda: o X do computador fica), abre a aba Celular
// do Título e desliga "Igual ao computador" do Tamanho para 24 px, esconde a Forma so no celular, salva o rascunho
// com o editor aberto, recarrega (as etiquetas "Celular" nas Camadas, a Forma some so no Celular) e publica. O
// gravado: devices.mobile com o lugar do Selo, o tamanho do Título e a Forma escondida; o computador como estava.
// Funciona no WebKit: so clique, preencher, teclado e o mouse dentro da janela.

const TITULO = "Pop-up E2E: o produtor ajusta o Livre no celular";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const SELO_NO_COMPUTADOR = { mode: "free", w: 116, x: 300, y: 16 } as const;
const DESIGN = {
  artboard: { width: 440 },
  children: [
    { id: "selo", label: "Novidade", place: SELO_NO_COMPUTADOR, type: "badge" },
    { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], textStyle: { size: 40 }, type: "heading" },
    { box: { fill: [{ color: "#38bdf8", kind: "solid" }], radius: 16 }, id: "forma", place: { h: 80, mode: "free", w: 80, x: 340, y: 120 }, type: "shape" },
    { id: "links", type: "links" }
  ],
  mode: "free",
  version: 1
};

type Gravado = {
  popup_design: {
    children: { hidden?: boolean; id: string; place?: { mode: string; w?: number; x?: number; y?: number }; textStyle?: { size?: number } }[];
    devices?: { mobile?: { nodes?: Record<string, { hidden?: boolean; place?: { mode: string; x?: number; y?: number }; textStyle?: { size?: number } }> } };
    mode: string;
  } | null;
  status: string;
};

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
        kind: "popup",
        popup_close: "any",
        popup_delay_seconds: 1,
        popup_design: DESIGN,
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

async function lerAviso() {
  const db = createLocalAdminClient();

  return unwrap(await db.from("campaigns").select("popup_design,status").eq("id", avisoId).single(), "Lendo o pop-up") as Gravado;
}

/** A linha das Camadas (o botao de selecionar) cujo nome comeca com o texto. */
function camada(editor: Locator, comeco: string) {
  return editor.locator("[data-free-layer-select]").filter({ hasText: comeco }).first();
}

/** O elemento do design desenhado no palco do editor. */
function noPalco(editor: Locator, id: string) {
  return editor.locator(`[data-free-canvas-card] [data-free-id="${id}"]`).first();
}

/** Um campo de numero (Base UI): clica antes de preencher (senao o texto novo vai para o fim do que ja tinha). */
async function preencherNumero(campo: Locator, valor: number) {
  await campo.click();
  await campo.fill(String(valor));
  await campo.press("Tab");
}

/** O numero de um campo do painel (aceita a virgula do pt-BR). */
async function numeroDe(campo: Locator) {
  return Number((await campo.inputValue()).replace(",", "."));
}

/** O tamanho da letra desenhado (px de tela, antes do zoom do palco). */
async function tamanhoDaLetra(locator: Locator) {
  return locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

/** A caixa (px de tela) do elemento depois de o palco parar de mudar (o "Ajustar à tela" muda a escala uns quadros depois). */
async function caixaParada(locator: Locator) {
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

/** Clica numa chave ate ela ficar como pedido (WebKit: um clique pode cair antes de o painel terminar de montar). */
async function deixarChave(chave: Locator, ligada: boolean) {
  await expect(async () => {
    if ((await chave.getAttribute("aria-checked")) !== String(ligada)) {
      await chave.click();
    }

    expect(await chave.getAttribute("aria-checked")).toBe(String(ligada));
  }).toPass();
}

async function abrirEditor(page: Page) {
  const design = page.getByRole("region", { exact: true, name: "Design" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });

  await design.getByRole("button", { name: "Abrir editor Livre" }).click();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator("[data-free-canvas-card] [data-free-artboard]")).toBeVisible();

  return editor;
}

test("ajusta o Livre só no celular: arrasta o Selo, muda o Título e esconde a Forma; salva, recarrega e publica", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/admin/comunicacao/avisos/${avisoId}`);
  await page.waitForLoadState("networkidle");

  const editor = await abrirEditor(page);
  const falado = editor.locator("[data-free-live]");
  const prancheta = editor.locator("[data-free-canvas-card] [data-free-artboard]");
  let xNoCelular = 0;

  await test.step("a aba Celular liga o Ver como: Celular e o editor diz o que passa a ser editado", async () => {
    const verCelular = editor.getByRole("button", { exact: true, name: "Celular" });
    const abaCelular = editor.getByRole("tab", { exact: true, name: "Celular" });

    // Com o Computador ligado, a Forma selecionada e a aba Celular aberta: o Celular liga sozinho.
    await expect(editor.getByRole("button", { exact: true, name: "Computador" })).toHaveAttribute("aria-pressed", "true");
    await expect(verCelular).toHaveAttribute("aria-pressed", "false");
    await camada(editor, "Forma").click();
    await expect(async () => {
      if ((await abaCelular.getAttribute("aria-selected")) !== "true") {
        await abaCelular.click();
      }

      expect(await abaCelular.getAttribute("aria-selected")).toBe("true");
    }).toPass();
    await expect(verCelular).toHaveAttribute("aria-pressed", "true");
    await expect(falado).toHaveText("Editando o Celular.");
    await expect(prancheta).toHaveJSProperty("offsetWidth", 343);
  });

  await test.step("arrasta o Selo no desenho: muda só o celular (a etiqueta Celular aparece)", async () => {
    await camada(editor, "Selo").click();
    await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
    await expect(editor.locator("#livre-selo-x")).toHaveValue("300");

    const box = await caixaParada(noPalco(editor, "selo"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();

    // O computador fica onde estava; o celular ganhou o lugar novo.
    await expect(editor.locator("[data-free-selection-mobile]")).toBeVisible();
    await expect(editor.locator("#livre-selo-x")).toHaveValue("300");
    await editor.getByRole("tab", { exact: true, name: "Celular" }).click();
    await expect(editor.locator("#livre-selo-celular-x-igual")).toHaveAttribute("aria-checked", "false");
    xNoCelular = await numeroDe(editor.locator("#livre-selo-celular-x-valor"));
    expect(xNoCelular).toBeLessThan(260);
    await expect(editor.locator('[data-free-layer-row="selo"] [id^="free-layer-tags-"]')).toContainText("Celular");
  });

  await test.step("aba Celular do Título: desliga Igual ao computador e põe 24 px só no celular", async () => {
    await camada(editor, "Título").click();
    // A aba Celular fica ao trocar de elemento; a frase de sempre no topo.
    await expect(editor.getByRole("tab", { exact: true, name: "Celular" })).toHaveAttribute("aria-selected", "true");
    await expect(editor.getByText("O que não mudar aqui encolhe como no computador (texto nunca abaixo de 12 px).", { exact: true })).toBeVisible();
    const tamanho = editor.locator("#livre-titulo-celular-tamanho-texto-igual");
    await expect(tamanho).toHaveAccessibleName("Tamanho: igual ao computador");
    await deixarChave(tamanho, false);
    await preencherNumero(editor.locator("#livre-titulo-celular-tamanho-texto-valor"), 24);
    // 24 px numa prancheta de 440 desenhada com 343 px: 18,7 px.
    await expect.poll(() => tamanhoDaLetra(noPalco(editor, "titulo"))).toBeCloseTo((24 * 343) / 440, 0);
  });

  await test.step("aba Celular da Forma: esconde só no celular", async () => {
    await camada(editor, "Forma").click();
    await deixarChave(editor.locator("#livre-forma-celular-esconder-igual"), false);
    await deixarChave(editor.locator("#livre-forma-celular-esconder-valor"), true);
    await expect(noPalco(editor, "forma")).toHaveCount(0);

    // No computador tudo continua como estava.
    await editor.getByRole("button", { exact: true, name: "Computador" }).click();
    await expect(falado).toHaveText("Editando o Computador.");
    await expect(noPalco(editor, "forma")).toBeVisible();
    await expect.poll(() => tamanhoDaLetra(noPalco(editor, "titulo"))).toBeCloseTo(40, 0);
    await editor.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(noPalco(editor, "forma")).toHaveCount(0);
  });

  await test.step("Salvar rascunho com o editor aberto: o gravado tem o celular, e o computador como estava", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);
    await expect(editor).toBeVisible();

    const gravado = (await lerAviso()).popup_design;
    const nodes = gravado?.devices?.mobile?.nodes ?? {};
    expect(nodes.titulo).toEqual({ textStyle: { size: 24 } });
    expect(nodes.forma).toEqual({ hidden: true });
    expect(nodes.selo?.place?.mode).toBe("free");
    expect(nodes.selo?.place?.x).toBe(xNoCelular);
    const computador = Object.fromEntries((gravado?.children ?? []).map((node) => [node.id, node]));
    expect(computador.selo?.place).toEqual(SELO_NO_COMPUTADOR);
    expect(computador.titulo?.textStyle?.size).toBe(40);
    expect(computador.forma?.hidden).toBeUndefined();
  });

  await test.step("recarrega: as etiquetas Celular nas Camadas e a Forma escondida só no celular", async () => {
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reaberto = await abrirEditor(page);

    for (const id of ["selo", "titulo", "forma"]) {
      await expect(reaberto.locator(`[data-free-layer-row="${id}"] [id^="free-layer-tags-"]`)).toContainText("Celular");
    }

    await expect(reaberto.locator('[data-free-layer-row="links"] [id^="free-layer-tags-"]')).toHaveCount(0);
    await expect(noPalco(reaberto, "forma")).toBeVisible();
    await reaberto.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(noPalco(reaberto, "forma")).toHaveCount(0);
    await expect.poll(() => tamanhoDaLetra(noPalco(reaberto, "titulo"))).toBeCloseTo((24 * 343) / 440, 0);
    await reaberto.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(reaberto).toHaveCount(0);
  });

  await test.step("publica: o gravado continua com o celular e o computador de antes", async () => {
    await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(page.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });

    const publicado = await lerAviso();
    expect(publicado.status).toBe("active");
    expect(publicado.popup_design?.devices?.mobile?.nodes?.titulo).toEqual({ textStyle: { size: 24 } });
    expect(publicado.popup_design?.devices?.mobile?.nodes?.forma).toEqual({ hidden: true });
    expect(publicado.popup_design?.devices?.mobile?.nodes?.selo?.place?.x).toBe(xNoCelular);
    expect(publicado.popup_design?.children.find((node) => node.id === "selo")?.place).toEqual(SELO_NO_COMPUTADOR);
  });
});
