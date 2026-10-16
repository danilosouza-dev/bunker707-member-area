import type { Page } from "@playwright/test";
import { expect, test, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Progresso da aula de ponta a ponta (docs/18 §3.1, "Concluir aula e progresso"): concluir e desmarcar
// pelo botao da aula, e o MESMO estado aparecer em todos os caminhos que levam a aula: card do curso
// na home, card do modulo na pagina do curso e card "Continue assistindo". E o teste de regressao do
// bug de 16/10 (#58): a pagina da aula chegava com a conclusao velha pelo card do modulo, porque o
// <Link prefetch> guardava uma copia da pagina por ate 5 minutos no build de producao. Por isso os
// passos abaixo repetem o caminho pelo card do modulo depois de mudar o estado, no mesmo navegador.

const { curso } = ESCOLA_DE_TESTE;
const enderecoDaAula = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}`;
const CONCLUIR = "Concluir aula atual";
const DESMARCAR = "Desmarcar aula atual como concluída";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarProgressoDosAlunos);

// Na playlist, a linha inteira da aula e um botao cujo nome inclui o do botao redondo de marcar;
// por isso os seletores da playlist usam `exact: true`, para pegar so o botao redondo.

/** Clica no botao e espera a gravacao do progresso responder 200. */
async function clicarEGravar(page: Page, nomeDoBotao: string) {
  const gravacao = page.waitForResponse(
    (response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT"
  );
  await page.getByRole("button", { name: nomeDoBotao }).click();
  expect((await gravacao).status()).toBe(200);
}

/**
 * Da home, abre o curso e entra no modulo 1 pelo card do modulo (o caminho do bug #58). O modulo abre
 * na primeira aula ainda nao concluida; quem chama confere qual.
 */
async function abrirModulo1PeloCard(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: `Abrir ${curso.titulo}` }).click();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);
  await page.getByRole("link", { name: "Abrir Módulo 1: Fundamentos" }).first().click();
  await expect(page).toHaveURL(new RegExp(enderecoDaAula.replaceAll("/", "\\/")));
}

test("concluir pelo botao da aula grava e o botao vira Desmarcar; a playlist marca a aula", async ({ page }) => {
  await page.goto(enderecoDaAula);
  await expect(page.getByRole("button", { name: CONCLUIR })).toBeVisible();

  await clicarEGravar(page, CONCLUIR);

  await expect(page.getByRole("button", { name: DESMARCAR })).toBeVisible();
  const playlist = page.locator(".lesson-playlist-scroll");
  await expect(playlist.getByRole("button", { exact: true, name: "Desmarcar aula concluída" })).toHaveCount(1);
});

test("a home mostra o progresso do curso e o modulo abre com a aula concluida pelo card do modulo", async ({ page }) => {
  await page.goto("/");
  // 1 de 3 aulas: modulo 1 pela metade, modulo 2 zerado; o card do curso faz a media dos modulos.
  await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` }).getByRole("img", { name: "25% concluído" })).toBeVisible();

  await abrirModulo1PeloCard(page);
  // O modulo abre na proxima aula a assistir (aula 2); a aula 1 continua marcada na playlist.
  await expect(page.getByRole("heading", { level: 1, name: "Aula 2: As peças de um agente" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONCLUIR })).toBeVisible();
  await expect(page.locator(".lesson-playlist-scroll").getByRole("button", { exact: true, name: "Desmarcar aula concluída" })).toHaveCount(1);
  await expect(page.getByText("1/3 aulas")).toBeVisible();
});

test("desmarcar e voltar ao modulo pelo card, so com cliques, mostra o estado novo e nao a copia antiga da pagina", async ({ page }) => {
  // Regressao do #58. Tudo por cliques, sem recarregar: e entre navegacoes no cliente que o roteador do
  // Next guardava a copia da pagina da aula buscada pelo card do modulo (prefetch cheio, ate 5 min).
  // Estado inicial (teste anterior): aula 1 concluida.
  await page.goto("/");
  await page.getByRole("link", { name: `Abrir ${curso.titulo}` }).click();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);
  await page.getByRole("link", { name: "Abrir Módulo 1: Fundamentos" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Aula 2: As peças de um agente" })).toBeVisible();

  // Abre a aula 1 pela playlist e desmarca.
  const playlist = page.locator(".lesson-playlist-scroll");
  await playlist.getByRole("button", { name: /^Aula 1: O que é um agente/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  await expect(page.getByRole("button", { name: DESMARCAR })).toBeVisible();
  await clicarEGravar(page, DESMARCAR);
  await expect(page.getByRole("button", { name: CONCLUIR })).toBeVisible();

  // Volta ao curso pelo caminho de navegacao e entra de novo pelo card do modulo: sem aula concluida, o
  // modulo abre na aula 1, e ela precisa chegar como "Concluir", nao com a conclusao antiga.
  await page.getByRole("link", { exact: true, name: curso.titulo }).first().click();
  await expect(page).toHaveURL(`/conteudo/${curso.id}`);
  await page.getByRole("link", { name: "Abrir Módulo 1: Fundamentos" }).first().click();
  await expect(page).toHaveURL(new RegExp(enderecoDaAula.replaceAll("/", "\\/")));
  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONCLUIR })).toBeVisible();
  await expect(playlist.getByRole("button", { exact: true, name: "Desmarcar aula concluída" })).toHaveCount(0);
});

test("aula comecada entra em Continue assistindo e abre pelo card com o mesmo estado da playlist", async ({ page }) => {
  // Concluir a aula 1 de novo pela playlist e deixar a aula 2 pela metade (como o player faria).
  await page.goto(enderecoDaAula);
  const playlist = page.locator(".lesson-playlist-scroll");
  const gravacao = page.waitForResponse((response) => response.url().includes("/api/progress/lessons"));
  await playlist.getByRole("button", { exact: true, name: "Marcar aula como concluída" }).first().click();
  expect((await gravacao).status()).toBe(200);

  const meio = await page.request.put("/api/progress/lessons", {
    data: {
      contentId: curso.id,
      durationSeconds: 600,
      lessonId: curso.aulas.aula2,
      progressSeconds: 180,
      status: "in_progress"
    }
  });
  expect(meio.status()).toBe(200);

  await page.goto("/");
  const continuar = page.getByRole("heading", { level: 2, name: "Continue assistindo" });
  await expect(continuar).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar Aula 2: As peças de um agente" })).toBeVisible();
  // A aula 1 esta concluida: nao aparece em Continue assistindo.
  await expect(page.getByRole("button", { name: "Continuar Aula 1: O que é um agente" })).toHaveCount(0);

  await page.getByRole("button", { name: "Continuar Aula 2: As peças de um agente" }).click();
  await expect(page).toHaveURL(new RegExp(`lessonId=${curso.aulas.aula2}`));
  await expect(page.getByRole("heading", { level: 1, name: "Aula 2: As peças de um agente" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONCLUIR })).toBeVisible();
  // E a aula 1 continua marcada como concluida na playlist, igual ao outro caminho.
  await expect(playlist.getByRole("button", { exact: true, name: "Desmarcar aula concluída" })).toHaveCount(1);
});
