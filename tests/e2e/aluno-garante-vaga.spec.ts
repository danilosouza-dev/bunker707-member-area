import { bloquearRedeExterna, expect, test } from "./fixtures";
import { WEBINARIO_DE_TESTE, limparWebinarios, seedWebinarioDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Webinarios, fase 1b (docs/30 §1.1, §1.2 e §10.2): a aluna ve o card "Proxima live" na pagina inicial, a
// pagina /webinarios com o destaque e a contagem regressiva, garante a vaga em 1 clique (confirmacao inline,
// Adicionar ao calendario com o .ics da nossa rota), cancela a vaga e tudo cabe a 375 px.

const { slug, titulo } = WEBINARIO_DE_TESTE;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await limparWebinarios(db);
  await seedWebinarioDeTeste(db);
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

test("o card Proxima live entra na fileira Lives da pagina inicial e leva a /webinarios", async ({ page }) => {
  await page.goto("/");
  const lives = page.getByRole("region", { name: "Lives" });
  await expect(lives).toBeVisible();
  await expect(lives.getByRole("link", { name: `Abrir ${titulo}` })).toBeVisible();
  await expect(lives.getByText(/Começa em/)).toBeVisible();

  await lives.getByRole("link", { name: "Ver todas" }).click();
  await expect(page).toHaveURL("/webinarios");
  await expect(page.getByRole("heading", { level: 1, name: "Webinários" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Próxima live" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: titulo })).toBeVisible();
  await expect(page.getByText(/Começa em \d+ d \d+ h/).first()).toBeVisible();
  await expect(page.getByText("Apresentador")).toBeVisible();
});

test("Garantir vaga em 1 clique: confirmacao, calendario (.ics da nossa rota, Google, Outlook) e Cancelar minha vaga", async ({ page }) => {
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await expect(page.getByText("horário de Brasília")).toBeVisible();

  const gravacao = page.waitForResponse((response) => response.url().includes("/api/webinars/") && response.url().endsWith("/register") && response.request().method() === "POST");
  await page.getByRole("button", { exact: true, name: "Garantir vaga" }).click();
  expect((await gravacao).status()).toBe(201);
  await expect(page.getByText("Vaga garantida. Avisamos você 1 dia e 1 hora antes.")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Cancelar minha vaga" })).toBeVisible();

  // Adicionar ao calendario: o arquivo vem da nossa rota, sem servico de fora; Google e Outlook abrem em outra aba.
  await page.getByText("Adicionar ao calendário").click();
  const baixar = page.getByRole("link", { name: "Baixar arquivo" });
  await expect(baixar).toBeVisible();
  const icsHref = await baixar.getAttribute("href");
  expect(icsHref).toMatch(new RegExp(`^/api/webinars/${WEBINARIO_DE_TESTE.id}/calendar\\?token=`));
  const ics = await page.request.get(icsHref!);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(ics.headers()["content-disposition"]).toContain(".ics");
  const corpo = await ics.text();
  expect(corpo).toContain("BEGIN:VEVENT");
  expect(corpo).toContain("TRIGGER:-PT15M");
  expect(corpo.replace(/\r\n /g, "")).toContain(`SUMMARY:${titulo}`);
  await expect(page.getByRole("link", { name: "Google Agenda" })).toHaveAttribute("href", /^https:\/\/calendar\.google\.com\//);
  await expect(page.getByRole("link", { name: "Outlook" })).toHaveAttribute("href", /^https:\/\/outlook\.live\.com\//);

  // Recarregar mantem a vaga (o servidor e a verdade) e o segundo clique nao duplica: o botao nem existe.
  await page.reload();
  await expect(page.getByText("Vaga garantida").first()).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Garantir vaga" })).toHaveCount(0);

  const cancelamento = page.waitForResponse((response) => response.url().endsWith("/register") && response.request().method() === "DELETE");
  await page.getByRole("button", { exact: true, name: "Cancelar minha vaga" }).click();
  expect((await cancelamento).status()).toBe(200);
  await expect(page.getByText("Vaga cancelada.")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Garantir vaga" })).toBeVisible();

  // Depois de cancelar, o token do calendario nao abre mais o arquivo.
  expect((await page.request.get(icsHref!)).status()).toBe(404);
});

test("a 375 px a pagina do Webinario cabe sem rolagem lateral e o botao continua ao alcance", async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 375 });
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Garantir vaga" })).toBeVisible();

  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);

  await page.goto("/webinarios");
  await expect(page.getByRole("heading", { level: 2, name: "Próxima live" })).toBeVisible();
  const lista = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(lista.pagina).toBeLessThanOrEqual(lista.tela);
});

test("quem nao entrou cai no login; a rota da sessao nao revela um webinario que nao existe", async ({ browser, page }) => {
  // Sem storageState explicito o contexto herda a sessao da aluna da configuracao.
  const anonimo = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await bloquearRedeExterna(anonimo);
  const visitante = await anonimo.newPage();
  await visitante.goto("/webinarios");
  await expect(visitante).toHaveURL(/\/login\?next=%2Fwebinarios/);
  await anonimo.close();

  const inexistente = await page.request.get("/api/webinars/bbbbbbbb-0000-4000-8000-00000000ffff/session");
  expect(inexistente.status()).toBe(404);
  const sessao = await page.request.get(`/api/webinars/${WEBINARIO_DE_TESTE.id}/session`);
  expect(sessao.status()).toBe(200);
  const { data } = (await sessao.json()) as { data: { me: { registered: boolean }; session: { id: string; phase: string }; webinar: { slug: string } } };
  expect(data.webinar.slug).toBe(slug);
  expect(data.session.id).toBe(WEBINARIO_DE_TESTE.sessaoId);
  expect(data.session.phase).toBe("scheduled");
  expect(data.me.registered).toBe(false);
});
