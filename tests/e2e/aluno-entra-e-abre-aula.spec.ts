import { expect, test, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE, SENHA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Fluxo principal do aluno (docs/18 §3.1): entrar, cair na home, abrir o curso comprado e chegar na
// aula com player e playlist. Roda em Chromium e WebKit contra o app buildado e o Supabase local.

const { curso } = ESCOLA_DE_TESTE;
const enderecoDaAula = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}`;

// Sem progresso, a aula aberta pelo modulo e a primeira (Aula 1); outro arquivo pode ter concluido aulas.
test.beforeAll(zerarProgressoDosAlunos);

test.describe("entrar", () => {
  // Estes testes comecam sem sessao, ao contrario dos outros (que reaproveitam o login do setup).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pagina protegida sem sessao manda para a tela de entrar e volta para ela depois do login", async ({ page }) => {
    await page.goto(enderecoDaAula);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.waitForLoadState("networkidle");

    await page.locator('input[type="email"]').fill(ESCOLA_DE_TESTE.contas.aluna.email);
    await page.locator('input[type="password"]').fill(SENHA_DE_TESTE);
    await page.getByRole("button", { exact: true, name: "Entrar" }).click();

    await expect(page).toHaveURL(new RegExp(`${enderecoDaAula.replaceAll("/", "\\/")}`));
    await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  });

  test("senha errada mostra o aviso e continua na tela de entrar", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(ESCOLA_DE_TESTE.contas.aluna.email);
    await page.locator('input[type="password"]').fill("senha-errada");
    await page.getByRole("button", { exact: true, name: "Entrar" }).click();

    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test("aluna abre o curso pela home e chega na aula com player, playlist e botao Concluir", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "Minhas compras" })).toBeVisible();
  await page.getByRole("link", { name: `Abrir ${curso.titulo}` }).click();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);

  await page.getByRole("link", { name: "Abrir Módulo 1: Fundamentos" }).first().click();
  await expect(page).toHaveURL(new RegExp(enderecoDaAula.replaceAll("/", "\\/")));

  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  await expect(page.locator(".lesson-player-frame")).toBeVisible();

  const playlist = page.locator(".lesson-playlist-scroll");
  await expect(playlist.getByText("Aula 1: O que é um agente")).toBeVisible();
  await expect(playlist.getByText("Aula 2: As peças de um agente")).toBeVisible();
  await expect(playlist.getByText("Módulo 2: Na prática")).toBeVisible();

  await expect(page.getByRole("button", { name: "Concluir aula atual" })).toBeVisible();

  // Painel de apoio da aula: as tres abas, em portugues, e o atalho de materiais seleciona a aba certa.
  await expect(page.getByRole("tab", { name: /Comentários/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Materiais/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Tutor IA/ })).toBeVisible();
  await page.getByRole("button", { name: "Abrir materiais" }).click();
  await expect(page.getByRole("tab", { name: /Materiais/ })).toHaveAttribute("aria-selected", "true");
});

test("voltar do navegador da aula ate a home: cada pagina volta sem deixar o aviso de carregamento por cima", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "Minhas compras" })).toBeVisible();
  await page.getByRole("link", { name: `Abrir ${curso.titulo}` }).click();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);
  await page.getByRole("link", { name: "Abrir Módulo 1: Fundamentos" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();

  // O Next restaura a pagina anterior do cache de historico; o aviso de navegacao do app tem de sumir junto.
  // Antes da correcao de 19/10/2026 ele ficava por cima da pagina pronta ate o timeout (15 s + 4 s).
  const aviso = page.locator("[data-navigation-feedback]");
  await page.goBack();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);
  await expect(aviso).toBeHidden({ timeout: 3_000 });

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 2, name: "Minhas compras" })).toBeVisible();
  await expect(aviso).toBeHidden({ timeout: 3_000 });
});
