import { expect, test, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// A plataforma mostra so o que o aluno pode abrir (AGENTS.md), no navegador: o card do curso a venda
// aparece bloqueado e abre o modal de compra em vez da aula; os enderecos de aula e de curso sem
// acesso nao entregam conteudo; quem nao comprou nada nao ve Minhas compras nem Continue assistindo.

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;

test.beforeAll(zerarProgressoDosAlunos);

test.describe("aluna com dois cursos comprados", () => {
  test("home: Minhas compras com os dois cursos; o curso a venda so em Produtos a venda, bloqueado, e abre o modal de compra", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Abrir ${cursoLiberacao.titulo}` })).toBeVisible();

    const bloqueado = page.getByRole("link", { name: `Abrir ${cursoBloqueado.titulo}` });
    await expect(bloqueado).toBeVisible();
    await expect(bloqueado.getByText("Conteudo bloqueado")).toBeVisible();
    await expect(bloqueado.getByRole("button", { name: "Comprar" })).toBeVisible();

    // Clicar no card bloqueado nao leva a aula: abre os detalhes (titulo em h2, so no modal) com o
    // botao de compra, sem sair da home.
    await bloqueado.click();
    const tituloDoModal = page.getByRole("heading", { level: 2, name: cursoBloqueado.titulo });
    await expect(tituloDoModal).toBeVisible();
    // Dois botoes Comprar: o do card e o do modal.
    await expect(page.getByRole("button", { name: "Comprar" })).toHaveCount(2);
    await expect(page).toHaveURL("/");
    // Ha dois "Fechar detalhes": o fundo que cobre a tela (animado) e o botao do painel; o do painel e o ultimo.
    await page.getByRole("button", { name: "Fechar detalhes" }).last().click();
    await expect(tituloDoModal).toBeHidden();
  });

  test("detalhes do curso comprado: o modal lista as aulas do modulo e leva a aula", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // O botao de detalhes fica no card (aparece ao passar o mouse) e abre o modal sem sair da home.
    const card = page.getByRole("link", { name: `Abrir ${curso.titulo}` });
    await card.hover();
    await card.getByRole("button", { name: `Ver detalhes de ${curso.titulo}` }).click();
    await expect(page.getByRole("heading", { level: 2, name: curso.titulo })).toBeVisible();
    await expect(page).toHaveURL("/");

    // Cada modulo e um botao com o titulo e "Ver aulas"; abrir o modulo 1 lista so as aulas dele.
    await page.getByRole("button").filter({ hasText: "Módulo 1: Fundamentos" }).filter({ hasText: "Ver aulas" }).click();
    const aula1 = page.getByRole("link", { name: /Aula 1: O que é um agente/ });
    await expect(aula1).toBeVisible();
    await expect(page.getByRole("link", { name: /Aula 2: As peças de um agente/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Aula 3: Seu primeiro agente/ })).toHaveCount(0);

    // A aula listada no modal abre a pagina da aula certa.
    await aula1.click();
    await expect(page).toHaveURL(`/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`);
    await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  });

  test("endereco da aula do curso a venda nao entrega a aula: volta para a home", async ({ page }) => {
    await page.goto(`/conteudo/${cursoBloqueado.id}/aulas/${cursoBloqueado.modulos.modulo1}`);
    await expect(page).toHaveURL("/");
  });

  test("pagina do curso a venda abre, mas o modulo fica com acesso pendente e nao leva a aula", async ({ page }) => {
    await page.goto(`/conteudo/${cursoBloqueado.id}`);
    await expect(page).toHaveURL(`/conteudo/${cursoBloqueado.id}`);
    await expect(page.getByRole("heading", { level: 1, name: cursoBloqueado.titulo })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir Módulo 1: Introdução" })).toHaveCount(0);

    const modulo = page.getByRole("link", { name: /^Módulo 1: Introdução\./ });
    await expect(modulo.getByText("Acesso pendente")).toBeVisible();
    await modulo.click();
    await expect(page).toHaveURL(`/conteudo/${cursoBloqueado.id}`, { timeout: 3_000 });
  });

  test("curso de liberacao: a aula com data futura aparece com a data e nao abre; a liberada abre", async ({ page }) => {
    await page.goto(`/conteudo/${cursoLiberacao.id}/aulas/${cursoLiberacao.modulos.modulo1}`);
    await expect(page.getByRole("heading", { level: 1, name: "Aula liberada" })).toBeVisible();

    const playlist = page.locator(".lesson-playlist-scroll");
    await expect(playlist.getByText("Aula com liberação futura")).toBeVisible();
    await expect(playlist.getByText(/Liberação em 01\/01\/2099/)).toBeVisible();
    await expect(playlist.getByText("Aula em rascunho")).toHaveCount(0);
  });
});

test.describe("aluno que nao comprou nada", () => {
  test.use({ storageState: "tests/e2e/.auth/aluno-sem-acesso.json" });

  test("home sem Minhas compras nem Continue assistindo; os tres cursos a venda, bloqueados", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 2, name: "Produtos a venda" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Minhas compras" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Continue assistindo" })).toHaveCount(0);

    for (const titulo of [curso.titulo, cursoBloqueado.titulo, cursoLiberacao.titulo]) {
      const card = page.getByRole("link", { name: `Abrir ${titulo}` });
      await expect(card).toBeVisible();
      await expect(card.getByText("Conteudo bloqueado")).toBeVisible();
    }
  });

  test("endereco da aula de um curso nao comprado volta para a home", async ({ page }) => {
    await page.goto(`/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}`);
    await expect(page).toHaveURL("/");
  });
});
