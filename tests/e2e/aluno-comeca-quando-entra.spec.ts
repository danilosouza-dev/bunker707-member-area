import type { Page } from "@playwright/test";
import { JIT_DE_TESTE, bloquearRedeExterna, eventosDeWebinario, expect, paginaFalsaPlayerJs, seedJitDeTeste, sessoesJitNoBanco, test, zerarHistoricoDeWebinarios } from "./fixtures";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";

// "Começa quando você entra" (docs/30 §1.2, §1.6, §2.7, A14 e D25; docs/18 §3.1; fase 4e): a Live gravada de teste tem
// o just-in-time ligado o dia inteiro, uma sessao a cada 15 min e a Entrada atrasada em 0 (o horario que ja comecou
// nao aceita mais ninguem). A pagina do webinario mostra "A próxima sessão começa em {n} min" (n de 1 a 15, o mesmo
// minuto que o relogio diz), "Não precisa de vaga" e o Entrar, sem Garantir vaga; o Entrar pede a sessao do horario
// (POST /api/webinars/[id]/jit) e leva a aluna para a sala dela, na espera; o banco ganha UMA sessao `jit`, gravada, no
// limite de 15 min seguinte; o aluno sem acesso (outra conta, outro navegador) entra em seguida e cai na mesma sessao
// (a turma e quem entra no mesmo horario); webinar_jit_entered fica no historico das duas contas. Os textos vem de
// WEBINAR_COPY.jit.

const { slug, titulo } = JIT_DE_TESTE;
const JIT = WEBINAR_COPY.jit.aluno;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const QUINZE_MIN = 15 * 60_000;
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=([0-9a-f-]{36})`);

/** "A próxima sessão começa em {n} min" com o n capturado (a frase vem de WEBINAR_COPY, nunca reescrita). */
function fraseDaProxima() {
  const modelo = JIT.proximaSessaoEm(99).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("99", "(\\d+)");
  return new RegExp(`^${modelo}$`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedJitDeTeste(db, { aCada: 15, entradaAtrasada: 0 });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

async function abrirPagina(page: Page) {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
}

async function entrar(page: Page) {
  const botao = page.getByRole("button", { exact: true, name: JIT.entrar });
  await expect(botao).toBeEnabled();
  await botao.click();
  await expect(page).toHaveURL(SALA);
  const sessaoId = SALA.exec(page.url())?.[1] ?? "";
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();
  // A sessao do proximo horario: na espera (ou ja no ar, se o limite passou durante o teste).
  await expect(sala).toHaveAttribute("data-room-phase", /^(waiting|live)$/);
  return sessaoId;
}

test("a página mostra A próxima sessão começa em {n} min, sem Garantir vaga, e o Entrar leva à sala da sessão do horário, criada uma vez", async ({ page }) => {
  await abrirPagina(page);
  const frase = page.getByText(fraseDaProxima());
  await expect(frase).toBeVisible();
  const minutos = Number(fraseDaProxima().exec((await frase.textContent())?.trim() ?? "")?.[1]);
  expect(minutos).toBeGreaterThanOrEqual(1);
  expect(minutos).toBeLessThanOrEqual(15);
  // O mesmo minuto que o relogio diz (o proximo limite de 15 min; 1 minuto de folga para a virada).
  const proximo = Math.ceil(Date.now() / QUINZE_MIN) * QUINZE_MIN;
  expect(Math.abs(minutos - Math.max(1, Math.ceil((proximo - Date.now()) / 60_000)))).toBeLessThanOrEqual(1);
  await expect(page.getByText(JIT.semVaga, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: WEBINAR_COPY.aluno.garantirVaga })).toHaveCount(0);
  expect(await sessoesJitNoBanco()).toEqual([]);

  const antes = Date.now();
  const sessaoId = await entrar(page);

  const sessoes = await sessoesJitNoBanco();
  expect(sessoes.map((sessao) => sessao.id)).toEqual([sessaoId]);
  const [sessao] = sessoes;
  expect([sessao.jit, sessao.kind]).toEqual([true, "simulated"]);
  const horario = Date.parse(sessao.scheduled_at);
  expect(horario % QUINZE_MIN).toBe(0);
  expect(horario).toBeGreaterThan(antes - 60_000);
  expect(horario).toBeLessThanOrEqual(antes + QUINZE_MIN);

  await expect.poll(async () => (await eventosDeWebinario("webinar_jit_entered")).map((evento) => evento.entity_id)).toEqual([sessaoId]);
  const [evento] = await eventosDeWebinario("webinar_jit_entered");
  expect(evento.metadata).toMatchObject({ created: true, webinar_id: JIT_DE_TESTE.id });
});

test("o aluno sem acesso entra em seguida pelo outro navegador e cai na mesma sessão do horário (a turma)", async ({ browser }) => {
  const [sessaoDaAluna] = await sessoesJitNoBanco();
  expect(sessaoDaAluna, "a sessao do teste anterior").toBeTruthy();

  const contexto = await browser.newContext({ storageState: "tests/e2e/.auth/aluno-sem-acesso.json" });
  await bloquearRedeExterna(contexto);
  const outra = await contexto.newPage();
  await abrirPagina(outra);
  const sessaoId = await entrar(outra);
  await contexto.close();

  const sessoes = await sessoesJitNoBanco();
  // Mesmo horario = mesma sessao; se o limite de 15 min virou entre os dois testes, nasce a do horario seguinte.
  if (Date.parse(sessaoDaAluna.scheduled_at) > Date.now()) {
    expect(sessaoId).toBe(sessaoDaAluna.id);
    expect(sessoes).toHaveLength(1);
  } else {
    expect(new Set(sessoes.map((sessao) => sessao.scheduled_at)).size).toBe(sessoes.length);
  }
  await expect.poll(async () => (await eventosDeWebinario("webinar_jit_entered", "alunoSemAcesso")).map((evento) => evento.entity_id)).toEqual([sessaoId]);
});

test("a 375 px a página cabe sem rolar de lado e o Entrar tem 44 px", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 });
  await abrirPagina(page);
  await expect(page.getByText(fraseDaProxima())).toBeVisible();
  const botao = page.getByRole("button", { exact: true, name: JIT.entrar });
  expect((await botao.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
});
