import type { Page } from "@playwright/test";
import {
  contaDeTeste,
  contarPedidos,
  envelhecerPopup,
  esperarPlayerDaAula,
  estadoDoPopUpDaAluna,
  eventosDoPopUp,
  expect,
  publicarPopUp,
  reabrirPopUpParaAluna,
  test,
  trocarVideoDaAula,
  zerarComunicacao,
  zerarProgressoDosAlunos
} from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Pop-ups com paginas, momentos, frequencia e "Como fechar" no navegador (docs/25 §1 e §8; docs/18 §3.1).
// Cada grupo publica os seus pop-ups pela tela do produtor (publicarPopUp: a publicacao renova a lista de
// pop-ups no ar, 60 s em cache no servidor) e apaga tudo antes do proximo. A memoria de 1 minuto do navegador
// so vale entre paginas abertas pelo menu (sem recarregar): por isso as trocas de pagina sao pelo menu.
//
// - "Em qualquer página, menos Perfil", "Mais de uma vez" com 1 minuto: aparece em Favoritos, nao no Perfil;
//   1 minuto depois (relogio do navegador adiantado e a abertura voltada no banco) aparece de novo na proxima
//   pagina, com um pedido do resumo so.
// - Sem ritmo ("Só quando o pop-up terminar", sem limite por dia nem tempo entre uma vez e outra): fechado,
//   volta na pagina seguinte depois de 5 s sem pedir o resumo de novo (a memoria guardou quando).
// - Pagina de aula, "Ao abrir a página": aparece antes do play; dar o play antes dos 3 s descarta; num
//   aparelho de toque, numa aula com player de fora (iframe), nao abre.
// - "Ao concluir uma aula": Concluir abre; Concluir e trocar de aula pela playlist descarta.
// - "Só no X" a 375 px: o toque fora nao fecha, o Esc fecha, o X tem 44 px de toque e a pagina nao rola de lado.
// - Dois pop-ups do Inicio ao mesmo tempo: um de cada vez.
// - Pagina sem pop-up: nenhum pedido dentro de 1 minuto; a coberta pede uma vez.

const { curso, cursoLiberacao } = ESCOLA_DE_TESTE;
const AULA_1 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}`;
const AULA_3 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo2}`;
const AULA_LIBERADA = `/conteudo/${cursoLiberacao.id}/aulas/${cursoLiberacao.modulos.modulo1}`;
const RESUMO = /^\/api\/notifications\/summary$/;
const ABERTURA = /^\/api\/popups\/[^/]+\/show$/;
const TEXTO = "Turma nova de agentes começa segunda.";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** Troca de pagina pelo menu (sem recarregar: a memoria do navegador continua valendo). */
async function irPeloMenu(page: Page, nome: string, endereco: string) {
  await page.getByRole("button", { name: "Abrir menu" }).click();
  const gaveta = page.getByRole("dialog", { name: "Menu" });
  await gaveta.getByRole("navigation", { name: "Navegação da área do aluno" }).getByRole("link", { exact: true, name: nome }).click();
  await expect(page).toHaveURL(endereco);
  await expect(gaveta).toBeHidden();
}

/** Espera o tempo de um pop-up "Ao abrir a página" (3 s) com folga e confere que nada abriu. */
async function nadaAbre(page: Page, titulo: string) {
  await page.waitForTimeout(4_500);
  await expect(page.locator("[data-member-popup]")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: titulo })).toHaveCount(0);
}

test.describe("em qualquer página, menos Perfil, com 1 minuto entre uma vez e outra", () => {
  const TITULO = "Pop-up E2E: em qualquer página";
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    id = await publicarPopUp(browser, {
      botao: { href: "/materiais", label: "Ver materiais" },
      excecoes: ["profile"],
      frequencia: { everyMinutes: 1, mode: "repeat", stopOn: "click" },
      paginas: ["any"],
      texto: TEXTO,
      titulo: TITULO
    });
  });

  test("aparece em Favoritos e não no Perfil; 1 minuto depois volta na próxima página", async ({ page }) => {
    const aluna = await contaDeTeste("aluna");
    await page.clock.install();
    const resumos = contarPedidos(page, RESUMO);
    const aberturas = contarPedidos(page, ABERTURA, "POST");

    await page.goto("/favoritos");
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect(popUp.getByText(TEXTO)).toBeVisible();
    // O pedido do topo traz o plano (o host entra nele): um resumo e uma abertura.
    expect(resumos.total).toBe(1);
    expect(aberturas.total).toBe(1);
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed", "message_closed"]);
    const [abriu, fechou] = await eventosDoPopUp(id);
    expect(abriu.metadata).toMatchObject({ campaign_id: id, page: "saved", trigger: "page_load" });
    expect(fechou.metadata).toMatchObject({ campaign_id: id, via: "x" });

    // Perfil e excecao: nada abre, nada e pedido (o plano de 1 minuto ja diz).
    resumos.zerar();
    aberturas.zerar();
    await irPeloMenu(page, "Perfil", "/perfil");
    await nadaAbre(page, TITULO);
    expect(aberturas.total).toBe(0);
    expect(resumos.total).toBe(0);

    // 1 minuto depois: o navegador adianta o relogio e o banco volta a abertura no tempo (o servidor usa a
    // hora de verdade). Na proxima pagina ele aparece de novo.
    expect(await envelhecerPopup(id, aluna.id, 65 / 3_600)).toBe(1);
    await page.clock.fastForward("01:05");
    await irPeloMenu(page, "Materiais", "/materiais");
    await expect(popUp).toBeVisible();
    expect(resumos.total).toBe(1);
    expect(aberturas.total).toBe(1);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.impressions ?? 0).toBe(2);
    expect((await estadoDoPopUpDaAluna(TITULO))?.dayImpressions).toBe(2);
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("sem ritmo, até o pop-up terminar", () => {
  const TITULO = "Pop-up E2E: toda página";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUp(browser, { frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["any"], texto: TEXTO, titulo: TITULO });
  });

  test("fechado, volta na página seguinte depois de 5 s, sem pedir o resumo de novo", async ({ page }) => {
    await page.goto("/favoritos");
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.impressions ?? 0).toBe(1);

    // O show disse "de novo daqui a 5 s"; a memoria de 1 minuto guarda: a pagina seguinte arma sem pedir.
    await page.waitForTimeout(6_000);
    const resumos = contarPedidos(page, RESUMO);
    await irPeloMenu(page, "Materiais", "/materiais");
    await expect(popUp).toBeVisible();
    expect(resumos.total).toBe(0);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.impressions ?? 0).toBe(2);
  });
});

test.describe("na página da aula, ao abrir a página", () => {
  const TITULO = "Pop-up E2E: antes do play";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUp(browser, { frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["lesson:*"], texto: TEXTO, titulo: TITULO });
  });

  test("aparece antes do play; na página do produto, não", async ({ page }) => {
    await page.goto(AULA_1);
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);

    await page.goto(`/conteudo/${curso.id}`);
    await nadaAbre(page, TITULO);
  });
});

test.describe("players da aula: o nosso tocando e o de fora no toque", () => {
  const TITULO = "Pop-up E2E: nunca sobre o vídeo";
  let videoDaAula3: Record<string, unknown> | null = null;
  let videoDaLiberada: Record<string, unknown> | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await zerarComunicacao();
    // Aula 3: video de arquivo (o nosso player, <video>; o arquivo nao carrega, a rede de fora esta cortada,
    // mas o botao de play conta como tocar). Aula liberada: Vimeo (player de fora, em iframe).
    videoDaAula3 = await trocarVideoDaAula(curso.aulas.aula3, { provider: "custom_url", url: "https://videos.bunker707.test/aula-3.mp4" });
    videoDaLiberada = await trocarVideoDaAula(cursoLiberacao.aulas.liberada, { provider: "vimeo", url: "https://vimeo.com/76979871" });
    await publicarPopUp(browser, { frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["lesson:*"], texto: TEXTO, titulo: TITULO });
  });

  test.afterAll(async () => {
    if (videoDaAula3) {
      await trocarVideoDaAula(curso.aulas.aula3, videoDaAula3);
    }

    if (videoDaLiberada) {
      await trocarVideoDaAula(cursoLiberacao.aulas.liberada, videoDaLiberada);
    }
  });

  test("no nosso player: sem tocar, abre; dar o play antes dos 3 s descarta o pop-up desta página", async ({ page }) => {
    test.setTimeout(180_000);
    await esperarPlayerDaAula(page, AULA_3, "native");
    // Sem tocar no player, abre (as recargas da espera pelo catalogo tambem podem ter aberto: a aluna volta
    // a "nunca viu" antes de cada parte).
    await reabrirPopUpParaAluna(TITULO);
    await page.goto(AULA_3);
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);

    await reabrirPopUpParaAluna(TITULO);
    const aberturas = contarPedidos(page, ABERTURA, "POST");
    // Os 3 s contam de quando a pagina monta (o resumo sai junto), nao do "load", que no WebKit do CI chega a
    // passar dos 3 s: o play vem logo depois de a pagina nova montar.
    await page.goto(AULA_3, { waitUntil: "commit" });
    await page.waitForRequest((request) => RESUMO.test(new URL(request.url()).pathname));
    await page.getByRole("button", { name: "Reproduzir aula" }).click();
    await nadaAbre(page, TITULO);
    expect(aberturas.total).toBe(0);
  });

  test.describe("aparelho de toque", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { height: 812, width: 375 } });

    test("numa aula com player de fora (iframe) não abre; numa aula do nosso player, abre", async ({ page }) => {
      test.setTimeout(180_000);
      await esperarPlayerDaAula(page, AULA_LIBERADA, "iframe");
      await reabrirPopUpParaAluna(TITULO);
      const aberturas = contarPedidos(page, ABERTURA, "POST");
      await page.goto(AULA_LIBERADA);
      await nadaAbre(page, TITULO);
      expect(aberturas.total).toBe(0);

      await page.goto(AULA_1);
      await expect(page.getByRole("dialog", { name: TITULO })).toBeVisible();
      expect(aberturas.total).toBe(1);
    });
  });
});

test.describe("ao concluir uma aula", () => {
  const TITULO = "Pop-up E2E: aula concluída";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
    await publicarPopUp(browser, { frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["lesson:*"], quando: "lesson_completed", texto: TEXTO, titulo: TITULO });
  });

  test.afterAll(zerarProgressoDosAlunos);

  test("Concluir abre o pop-up; concluir e trocar de aula pela playlist descarta", async ({ page }) => {
    await page.goto(AULA_1);
    // Abrir a pagina nao abre o pop-up "ao concluir uma aula".
    await nadaAbre(page, TITULO);

    const gravou = page.waitForResponse((response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Concluir aula atual" }).click();
    expect((await gravou).status()).toBe(200);
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);

    // Aula 2 pela playlist, Concluir e logo a aula 1 de novo: a abertura era da aula 2, e ela saiu.
    const playlist = page.locator(".lesson-playlist-scroll");
    await playlist.getByRole("button", { name: /^Aula 2: As peças de um agente/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Aula 2: As peças de um agente" })).toBeVisible();
    const aberturas = contarPedidos(page, ABERTURA, "POST");
    const gravouAula2 = page.waitForResponse((response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Concluir aula atual" }).click();
    expect((await gravouAula2).status()).toBe(200);
    await playlist.getByRole("button", { name: /^Aula 1: O que é um agente/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
    await nadaAbre(page, TITULO);
    expect(aberturas.total).toBe(0);
  });
});

test.describe("só no X, no celular (375 px)", () => {
  const TITULO = "Pop-up E2E: só no X";
  let id = "";

  test.use({ hasTouch: true, isMobile: true, viewport: { height: 812, width: 375 } });

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    id = await publicarPopUp(browser, { fechar: "x_only", texto: TEXTO, titulo: TITULO });
  });

  test("tocar fora não fecha; o X tem 44 px de toque; a página não rola de lado; o Esc fecha", async ({ page }) => {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();

    // O veu (fora do cartao) nao fecha.
    await page.mouse.click(8, 8);
    await page.waitForTimeout(500);
    await expect(popUp).toBeVisible();

    // O X: circulo de 36 px e 44 px de toque (a caixa do before: passa 4 px de cada lado).
    const fechar = popUp.getByRole("button", { name: "Fechar" });
    const caixa = await fechar.boundingBox();
    expect(Math.round(caixa?.width ?? 0)).toBe(36);
    const centro = { x: (caixa?.x ?? 0) + (caixa?.width ?? 0) / 2, y: (caixa?.y ?? 0) + (caixa?.height ?? 0) / 2 };
    const toques = await page.evaluate(
      ({ x, y }) =>
        [
          [-21, 0],
          [21, 0],
          [0, -21],
          [0, 21]
        ].map(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.closest("button")?.getAttribute("aria-label") ?? null),
      centro
    );
    expect(toques).toEqual(["Fechar", "Fechar", "Fechar", "Fechar"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed", "message_closed"]);
    expect((await eventosDoPopUp(id))[1].metadata).toMatchObject({ via: "esc" });
  });
});

test.describe("dois pop-ups no Início ao mesmo tempo", () => {
  const PRIMEIRO = "Pop-up E2E: primeiro do Início";
  const SEGUNDO = "Pop-up E2E: segundo do Início";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUp(browser, { texto: TEXTO, titulo: PRIMEIRO });
    await publicarPopUp(browser, { texto: TEXTO, titulo: SEGUNDO });
  });

  test("um de cada vez: o segundo só aparece depois que o primeiro fecha", async ({ page }) => {
    const resumos = contarPedidos(page, RESUMO);
    await page.goto("/");
    // O publicado por ultimo abre primeiro.
    const primeiro = page.getByRole("dialog", { name: SEGUNDO });
    await expect(primeiro).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-member-popup]")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: PRIMEIRO })).toHaveCount(0);
    // Na home, um pedido so, 1,5 s depois de abrir, com a pagina.
    expect(resumos.total).toBe(1);

    await primeiro.getByRole("button", { name: "Fechar" }).click();
    await expect(primeiro).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: PRIMEIRO })).toBeVisible();
    await expect(page.locator("[data-member-popup]")).toHaveCount(1);
    expect(resumos.total).toBe(1);
  });
});

test.describe("página sem pop-up", () => {
  const TITULO = "Pop-up E2E: só em Materiais";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUp(browser, { paginas: ["materials"], texto: TEXTO, titulo: TITULO });
  });

  test("nenhum pedido dentro de 1 minuto; a página coberta pede uma vez e o pop-up abre", async ({ page }) => {
    const resumos = contarPedidos(page, RESUMO);
    const aberturas = contarPedidos(page, ABERTURA, "POST");

    await page.goto("/favoritos");
    await nadaAbre(page, TITULO);
    expect(resumos.total).toBe(1);

    await irPeloMenu(page, "Perfil", "/perfil");
    await nadaAbre(page, TITULO);
    expect(resumos.total).toBe(1);

    await irPeloMenu(page, "Materiais", "/materiais");
    await expect(page.getByRole("dialog", { name: TITULO })).toBeVisible();
    expect(resumos.total).toBe(2);
    expect(aberturas.total).toBe(1);
    await page.getByRole("dialog", { name: TITULO }).getByRole("button", { name: "Fechar" }).click();

    await irPeloMenu(page, "Minhas compras", "/minhas-compras");
    await nadaAbre(page, TITULO);
    expect(resumos.total).toBe(2);
    expect(aberturas.total).toBe(1);
  });
});
