import type { Page } from "@playwright/test";
import {
  contarPedidos,
  esperarPlayerDaAula,
  esperarPlayerDeForaPronto,
  eventosDoPopUp,
  expect,
  horariosDoPopUp,
  paginaFalsaDoVimeo,
  playerDeFora,
  publicarPopUp,
  test,
  tocarNaCapaDoPlayer,
  trocarVideoDaAula,
  zerarComunicacao,
  zerarProgressoDosAlunos
} from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Hora marcada ao vivo (docs/29 §1.1, §4.1 e §9.3; docs/18 §3.1): com "Começa: Em uma data", o pop-up abre na hora
// certa tambem para quem ja esta parado numa das paginas escolhidas. A aberta sai entre a hora + 2 s e a hora + 6 s
// (folga de 2 s e espalhamento de 0 a 4 s), mais o "Quanto tempo depois". Cada grupo publica pelas fixtures (a
// publicacao renova a lista no ar) com o Começa alguns segundos a frente e a aluna abre a pagina antes da hora.
//
// - "Em qualquer página", Logo, Começa em 25 s: a aluna em Favoritos, parada, nao ve antes da hora; ve ate a hora
//   + 6 s (com folga), e o pedido de abrir sai so depois da hora; o historico diz Favoritos e "Ao abrir a página".
// - Dois pop-ups na mesma hora: um de cada vez, o segundo 1 s depois de o primeiro fechar.
// - Aula com o player de fora tocando (pagina falsa do Vimeo) na hora: nao aparece enquanto toca; Pausar abre.

const { curso } = ESCOLA_DE_TESTE;
const AULA_1 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`;
const ABERTURA = /^\/api\/popups\/[^/]+\/show$/;
const TEXTO = "A live de lançamento começa agora. Entre pelo link do botão.";
/** Do Começa ate a ultima abertura possivel: folga de 2 s + espalhamento de ate 4 s. */
const ATE_ABRIR_MS = 6_000;
/** Folga do teste por cima disso (pedido do show, a janela do pop-up, uma maquina lenta). */
const FOLGA_MS = 10_000;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();
});
test.afterAll(zerarComunicacao);

/** Espera ate `ms` antes da hora (se ainda der) e confere que nenhum pop-up abriu. */
async function nadaAntesDaHora(page: Page, comeca: number, antes = 1_000) {
  const espera = comeca - antes - Date.now();

  if (espera > 0) {
    await page.waitForTimeout(espera);
  }

  await expect(page.locator("[data-member-popup]")).toHaveCount(0);
}

/** O tempo que ainda resta ate a ultima abertura possivel, com a folga do teste (nunca menos de 5 s). */
function ateAbrir(comeca: number) {
  return Math.max(5_000, comeca + ATE_ABRIR_MS + FOLGA_MS - Date.now());
}

test.describe("em qualquer página, Logo, com a aluna parada em Favoritos", () => {
  const TITULO = "Pop-up E2E: hora marcada";
  let comeca = 0;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    comeca = Date.now() + 25_000;
    id = await publicarPopUp(browser, { depoisDe: 0, inicio: new Date(comeca).toISOString(), paginas: ["any"], texto: TEXTO, titulo: TITULO });
  });

  test("não aparece antes da hora; aparece até a hora + 6 s, sem trocar de página", async ({ page }) => {
    test.setTimeout(90_000);
    const aberturas = contarPedidos(page, ABERTURA, "POST");
    const resumo = page.waitForResponse((response) => response.url().includes("/api/notifications/summary?page=saved"));

    await page.goto("/favoritos");
    // O plano da pagina ja traz o pop-up que ainda vai comecar, com o Começa (a aluna abriu a pagina antes da hora).
    const { data } = (await (await resumo).json()) as { data: { popups?: { plan: { id: string; startsAt?: string }[] | null } | null } };
    const item = data.popups?.plan?.find((candidato) => candidato.id === id);
    expect(item?.startsAt && Date.parse(item.startsAt)).toBe(comeca);

    await nadaAntesDaHora(page, comeca);
    expect(aberturas.total).toBe(0);

    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible({ timeout: ateAbrir(comeca) });
    await expect(popUp.getByText(TEXTO)).toBeVisible();
    await expect(page).toHaveURL(/\/favoritos$/);
    // O pedido de abrir saiu depois da hora (o relogio do teste e o do servidor sao o mesmo).
    expect(aberturas.total).toBe(1);
    expect(aberturas.inicios[0]).toBeGreaterThanOrEqual(comeca);

    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: "saved", trigger: "page_load" });
    const [abriu] = await horariosDoPopUp(id);
    expect(Date.parse(abriu.occurred_at)).toBeGreaterThanOrEqual(comeca);

    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("dois pop-ups na mesma hora", () => {
  const A = "Pop-up E2E: hora marcada A";
  const B = "Pop-up E2E: hora marcada B";
  let comeca = 0;

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    comeca = Date.now() + 30_000;
    const inicio = new Date(comeca).toISOString();
    await publicarPopUp(browser, { depoisDe: 0, inicio, paginas: ["saved"], texto: TEXTO, titulo: A });
    await publicarPopUp(browser, { depoisDe: 0, inicio, paginas: ["saved"], texto: TEXTO, titulo: B });
  });

  test("um de cada vez: o segundo só aparece 1 s depois de o primeiro fechar", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/favoritos");
    await nadaAntesDaHora(page, comeca);

    const qualquer = page.getByRole("dialog", { name: /^Pop-up E2E: hora marcada [AB]$/ });
    await expect(qualquer).toBeVisible({ timeout: ateAbrir(comeca) });
    // Os dois venceram juntos (cada um no seu sorteio de ate 4 s): so um na tela.
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-member-popup]")).toHaveCount(1);
    const primeiroEhA = await page.getByRole("dialog", { name: A }).isVisible();
    const primeiro = page.getByRole("dialog", { name: primeiroEhA ? A : B });
    const segundo = page.getByRole("dialog", { name: primeiroEhA ? B : A });
    await expect(segundo).toHaveCount(0);

    await primeiro.getByRole("button", { name: "Fechar" }).click();
    const fechou = Date.now();
    await expect(primeiro).toHaveCount(0);
    await expect(segundo).toBeVisible();
    expect(Date.now() - fechou).toBeGreaterThanOrEqual(900);
    await expect(page.locator("[data-member-popup]")).toHaveCount(1);
    await segundo.getByRole("button", { name: "Fechar" }).click();
    await expect(segundo).toHaveCount(0);
  });
});

test.describe("na aula, com o player de fora tocando na hora", () => {
  const TITULO = "Pop-up E2E: hora marcada na aula";
  let videoDeAntes: Record<string, unknown> | null = null;

  test.beforeAll(async () => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
    videoDeAntes = await trocarVideoDaAula(curso.aulas.aula1, { assetId: "76979871", provider: "vimeo", url: "https://vimeo.com/76979871" });
  });

  test.afterAll(async () => {
    if (videoDeAntes) {
      await trocarVideoDaAula(curso.aulas.aula1, videoDeAntes);
    }

    await zerarProgressoDosAlunos();
  });

  test("não aparece enquanto o vídeo toca; aparece depois de Pausar", async ({ browser, page }) => {
    test.setTimeout(240_000);
    await paginaFalsaDoVimeo(page);
    // O catalogo da area do aluno renova em ate 1 minuto; o pop-up so e publicado depois (as recargas da espera
    // nao podem chegar perto da hora).
    await esperarPlayerDaAula(page, AULA_1, "iframe");
    const comeca = Date.now() + 35_000;
    const id = await publicarPopUp(browser, { depoisDe: 0, inicio: new Date(comeca).toISOString(), paginas: ["lesson:*"], texto: TEXTO, titulo: TITULO });

    const aberturas = contarPedidos(page, ABERTURA, "POST");
    await page.goto(AULA_1);
    await esperarPlayerDeForaPronto(page);
    await tocarNaCapaDoPlayer(page);
    await playerDeFora(page).getByRole("button", { exact: true, name: "Tocar" }).click();

    // Passou a hora e a ultima abertura possivel, com folga: com o video tocando, nada (nem o pedido de abrir).
    const depoisDaHora = comeca + ATE_ABRIR_MS + 3_000 - Date.now();
    expect(depoisDaHora).toBeGreaterThan(0);
    await page.waitForTimeout(depoisDaHora);
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toHaveCount(0);
    expect(aberturas.total).toBe(0);

    await playerDeFora(page).getByRole("button", { exact: true, name: "Pausar" }).click();
    await expect(popUp).toBeVisible({ timeout: 5_000 });
    expect(aberturas.total).toBe(1);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: `lesson:${curso.id}`, trigger: "page_load" });
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});
