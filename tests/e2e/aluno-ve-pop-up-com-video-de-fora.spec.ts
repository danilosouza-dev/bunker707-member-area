import type { Page } from "@playwright/test";
import {
  aulasConcluidasDaAluna,
  concluirAulasDaAluna,
  contarPedidos,
  esperarPlayerDaAula,
  esperarPlayerDeForaPronto,
  eventosDoPopUp,
  expect,
  paginaFalsaDeOutroPlayer,
  paginaFalsaDoVimeo,
  paginaFalsaPlayerJs,
  playerDeFora,
  publicarPopUp,
  segurarResumoDoSino,
  test,
  tocarNaCapaDoPlayer,
  trocarVideoDaAula,
  zerarComunicacao,
  zerarProgressoDosAlunos
} from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Pop-up com os players de fora da aula (Bunny, Vimeo e Mux; docs/29 §1.4, §4.4, §4.5 e §9.3; docs/18 §3.1). Os players
// sao paginas falsas servidas nas URLs reais (page.route vence o corte de rede do contexto): o iframe fica com a
// origem verdadeira do player e a conferencia de origem da ponte e exercitada de verdade. Cada pagina falsa fala o
// protocolo do player (Vimeo ou Player.js) e escreve "pronto" quando responde o getPaused (a confirmacao da ponte).
//
// - "Ao abrir a página", 3 s: o aluno toca na capa e da Tocar dentro do player antes da hora do pop-up; depois de
//   5 s, nada (nem o pedido de abrir); Pausar abre em ate 2 s e grava o progresso com o tempo do player (D15).
// - "Ao concluir uma aula": Tocar e Terminar concluem a aula sem tocar em Concluir, e o pop-up abre.
// - Player.js nos tres enderecos: a aula Bunny gravada em iframe.mediadelivery.net (a pagina falsa ali, e depois
//   o mesmo endereco levando ao player novo em player.mediadelivery.net) e a aula Mux: Terminar conclui.
// - Terminar na ultima aula que faltava abre "Ao concluir um curso" (pelo `ended` da ponte, sem tocar em Concluir).
// - Um player de outra origem (video colado de outro site) mandando `ended`: nada conclui.

const { curso, cursoLiberacao } = ESCOLA_DE_TESTE;
const AULA_1 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`;
const AULA_2 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula2}`;
const AULA_3 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo2}?lessonId=${curso.aulas.aula3}`;
const AULA_LIBERADA = `/conteudo/${cursoLiberacao.id}/aulas/${cursoLiberacao.modulos.modulo1}?lessonId=${cursoLiberacao.aulas.liberada}`;
const ABERTURA = /^\/api\/popups\/[^/]+\/show$/;
const TEXTO = "Material extra liberado para quem terminou a aula.";

/** Os videos das aulas durante este arquivo (todos de uma vez: o catalogo da area do aluno fica 60 s em cache). */
const VIDEOS: readonly { aula: string; endereco: string; video: Record<string, unknown> }[] = [
  { aula: curso.aulas.aula1, endereco: AULA_1, video: { assetId: "76979871", provider: "vimeo", url: "https://vimeo.com/76979871" } },
  { aula: curso.aulas.aula2, endereco: AULA_2, video: { provider: "bunny", url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc" } },
  { aula: cursoLiberacao.aulas.liberada, endereco: AULA_LIBERADA, video: { assetId: "teste707mux", provider: "mux", url: "https://player.mux.com/teste707mux" } },
  { aula: curso.aulas.aula3, endereco: AULA_3, video: { provider: "embed_code", url: "https://player.exemplo.com/video/707" } }
];

const videosDeAntes = new Map<string, Record<string, unknown> | null>();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();

  for (const { aula, video } of VIDEOS) {
    videosDeAntes.set(aula, await trocarVideoDaAula(aula, video));
  }
});

test.afterAll(async () => {
  for (const [aula, video] of videosDeAntes) {
    if (video) {
      await trocarVideoDaAula(aula, video);
    }
  }

  await zerarComunicacao();
  await zerarProgressoDosAlunos();
});

/** O botao de concluir da aula na tela: concluida pela ponte (sem o aluno tocar nele). */
function concluida(page: Page) {
  return page.getByRole("button", { exact: true, name: "Desmarcar aula atual como concluída" });
}

/** Tocar e Terminar dentro do player falso (a capa ja saiu). */
async function tocarETerminar(page: Page) {
  const player = playerDeFora(page);

  await player.getByRole("button", { exact: true, name: "Tocar" }).click();
  await player.getByRole("button", { exact: true, name: "Terminar" }).click();
}

test("as aulas mostram os players de fora (o catálogo renova em até 1 minuto)", async ({ page }) => {
  test.setTimeout(240_000);

  for (const { endereco } of VIDEOS) {
    await esperarPlayerDaAula(page, endereco, "iframe");
  }

  // So os players da lista ganham a ponte (o palco marcado); o colado de outro site, nao.
  await page.goto(AULA_1);
  await expect(page.locator("[data-lesson-player-stage]")).toHaveAttribute("data-lesson-player-bridge", "");
  await page.goto(AULA_3);
  await expect(page.locator("[data-lesson-player-stage]")).toHaveAttribute("data-lesson-player-kind", "iframe");
  expect(await page.locator("[data-lesson-player-stage]").getAttribute("data-lesson-player-bridge")).toBeNull();
});

test.describe("ao abrir a página, com o Vimeo tocando", () => {
  const TITULO = "Pop-up E2E: espera o Vimeo parar";
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    id = await publicarPopUp(browser, { depoisDe: 3, frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["lesson:*"], texto: TEXTO, titulo: TITULO });
  });

  test("Tocar antes dos 3 s: depois de 5 s, nada; Pausar abre em até 2 s", async ({ page }) => {
    await paginaFalsaDoVimeo(page);
    const aberturas = contarPedidos(page, ABERTURA, "POST");
    // O plano so chega depois do Tocar: o pop-up nunca pode armar antes de o video tocar, mesmo numa pagina lenta.
    const resumo = await segurarResumoDoSino(page);

    await page.goto(AULA_1);
    await esperarPlayerDeForaPronto(page);
    await tocarNaCapaDoPlayer(page);
    await playerDeFora(page).getByRole("button", { exact: true, name: "Tocar" }).click();
    const plano = page.waitForResponse((response) => response.url().includes("/api/notifications/summary"));
    resumo.soltar();
    await plano;

    const popUp = page.getByRole("dialog", { name: TITULO });
    await page.waitForTimeout(5_000);
    await expect(popUp).toHaveCount(0);
    expect(aberturas.total).toBe(0);

    // D15: com a ponte confirmada, o progresso da aula usa o tempo do player (nunca o cronometro de 15 s): Pausar
    // grava na hora (force) os segundos e a duracao que a pagina falsa mandou (1 s de 120 s).
    const gravouAPausa = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/progress/lessons" && request.method() === "PUT");
    await playerDeFora(page).getByRole("button", { exact: true, name: "Pausar" }).click();
    expect((await gravouAPausa).postDataJSON()).toMatchObject({ durationSeconds: 120, progressSeconds: 1, status: "in_progress" });
    await expect(popUp).toBeVisible({ timeout: 2_000 });
    expect(aberturas.total).toBe(1);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: `lesson:${curso.id}`, trigger: "page_load" });

    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("ao concluir uma aula, pelo fim do vídeo do Vimeo", () => {
  const TITULO = "Pop-up E2E: aula concluída pelo Vimeo";
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
    id = await publicarPopUp(browser, { paginas: ["lesson:*"], quando: "lesson_completed", texto: TEXTO, titulo: TITULO });
  });

  test("Tocar e Terminar concluem a aula sem tocar em Concluir; o pop-up abre", async ({ page }) => {
    await paginaFalsaDoVimeo(page);
    await page.goto(AULA_1);
    await esperarPlayerDeForaPronto(page);
    await expect(page.getByRole("button", { exact: true, name: "Concluir aula atual" })).toBeVisible();
    await tocarNaCapaDoPlayer(page);

    const gravou = page.waitForResponse(
      (response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT" && /"completed"/.test(response.request().postData() ?? "")
    );
    await tocarETerminar(page);
    expect((await gravou).status()).toBe(200);
    await expect(concluida(page)).toBeVisible();
    await expect(concluida(page)).toHaveAttribute("aria-pressed", "true");
    expect(await aulasConcluidasDaAluna(curso.id)).toContain(curso.aulas.aula1);

    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: `lesson:${curso.id}`, trigger: "lesson_completed" });
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("Player.js nos três endereços: Terminar conclui a aula", () => {
  const CASOS = [
    {
      aula: curso.aulas.aula2,
      conteudo: curso.id,
      endereco: AULA_2,
      montar: (page: Page) => paginaFalsaPlayerJs(page, "https://iframe.mediadelivery.net"),
      nome: "Bunny em iframe.mediadelivery.net",
      origemDoDocumento: "https://iframe.mediadelivery.net"
    },
    {
      aula: curso.aulas.aula2,
      conteudo: curso.id,
      endereco: AULA_2,
      // O endereco gravado leva ao player novo: o src fica em iframe.mediadelivery.net e as mensagens chegam de
      // player.mediadelivery.net (o mesmo grupo). O ready sai so 2 s depois de carregar, como a Bunny no loadeddata.
      montar: (page: Page) =>
        paginaFalsaPlayerJs(page, "https://player.mediadelivery.net", { prontoDepoisDe: 2_000, redirecionarDe: "https://iframe.mediadelivery.net" }),
      nome: "Bunny levando a player.mediadelivery.net",
      origemDoDocumento: "https://player.mediadelivery.net"
    },
    {
      aula: cursoLiberacao.aulas.liberada,
      conteudo: cursoLiberacao.id,
      endereco: AULA_LIBERADA,
      montar: (page: Page) => paginaFalsaPlayerJs(page, "https://player.mux.com"),
      nome: "Mux em player.mux.com",
      origemDoDocumento: "https://player.mux.com"
    }
  ] as const;

  test.beforeAll(async () => {
    await zerarComunicacao();
  });

  for (const caso of CASOS) {
    test(caso.nome, async ({ page }) => {
      await zerarProgressoDosAlunos();
      await caso.montar(page);
      await page.goto(caso.endereco);
      await esperarPlayerDeForaPronto(page);
      expect(page.frames().some((frame) => frame.url().startsWith(`${caso.origemDoDocumento}/`))).toBe(true);
      await expect(page.getByRole("button", { exact: true, name: "Concluir aula atual" })).toBeVisible();
      await tocarNaCapaDoPlayer(page);

      await tocarETerminar(page);
      await expect(concluida(page)).toBeVisible();
      await expect.poll(() => aulasConcluidasDaAluna(caso.conteudo)).toContain(caso.aula);
    });
  }
});

test.describe("ao concluir um curso, pelo fim do vídeo na última aula que faltava", () => {
  const TITULO = "Pop-up E2E: curso concluído pelo Vimeo";
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
    id = await publicarPopUp(browser, { paginas: ["lesson:*"], quando: "course_completed", texto: TEXTO, titulo: TITULO });
    // Todas menos a aula 1 (a do Vimeo).
    await concluirAulasDaAluna(curso.id, [curso.aulas.aula2, curso.aulas.aula3]);
  });

  test("Tocar e Terminar concluem a aula e o curso; o pop-up “Ao concluir um curso” abre", async ({ page }) => {
    await paginaFalsaDoVimeo(page);
    await page.goto(AULA_1);
    await esperarPlayerDeForaPronto(page);
    await expect(page.getByRole("button", { exact: true, name: "Concluir aula atual" })).toBeVisible();
    await tocarNaCapaDoPlayer(page);

    const fechouOCurso = page.waitForResponse(
      (response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT" && /"completed"/.test(response.request().postData() ?? "")
    );
    await tocarETerminar(page);
    const resposta = await fechouOCurso;
    expect(resposta.status()).toBe(200);
    expect(await resposta.json()).toMatchObject({ courseCompleted: true });
    await expect(concluida(page)).toBeVisible();
    expect([...(await aulasConcluidasDaAluna(curso.id))].sort()).toEqual([curso.aulas.aula1, curso.aulas.aula2, curso.aulas.aula3].sort());

    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: `lesson:${curso.id}`, trigger: "course_completed" });
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("player de outra origem (vídeo colado de outro site)", () => {
  test.beforeAll(async () => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
  });

  test("mandando ended, nada conclui", async ({ page }) => {
    await paginaFalsaDeOutroPlayer(page, "https://player.exemplo.com");
    const gravacoes = contarPedidos(page, /^\/api\/progress\/lessons$/, "PUT");
    await page.goto(AULA_3);
    await expect(playerDeFora(page).getByRole("button", { exact: true, name: "Terminar" })).toBeVisible();
    await tocarNaCapaDoPlayer(page);

    await tocarETerminar(page);
    await page.waitForTimeout(3_000);
    await expect(page.getByRole("button", { exact: true, name: "Concluir aula atual" })).toHaveAttribute("aria-pressed", "false");
    await expect(concluida(page)).toHaveCount(0);
    expect(await aulasConcluidasDaAluna(curso.id)).not.toContain(curso.aulas.aula3);
    // So o "comecou a aula" da capa grava progresso (em andamento); nada de concluida.
    expect(gravacoes.total).toBeLessThanOrEqual(1);
  });
});
