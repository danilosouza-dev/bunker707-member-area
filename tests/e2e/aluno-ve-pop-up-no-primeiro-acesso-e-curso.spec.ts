import type { Locator, Page } from "@playwright/test";
import {
  abrirComoProdutor,
  concluirAulasDaAluna,
  contarPedidos,
  estadoDoPopUpDaAluna,
  eventosDoPopUp,
  expect,
  liberarAcessoDeTeste,
  publicarPopUp,
  recalcularPopUp,
  test,
  tirarAcessoDeTeste,
  zerarComunicacao,
  zerarProgressoDosAlunos
} from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Os dois momentos novos do pop-up (docs/29 §1, §4.3, §4.4 e §8.4; docs/18 §3.1).
//
// - "No primeiro acesso · A primeira vez com estes produtos": o produtor monta pela tela (a frase ao vivo, a
//   revisao com "para quem" e o toast dos alunos novos); a aluna (conta antiga, que ja entrou) nao conta como
//   aluna nova ate ganhar acesso ao produto escolhido (o curso que ela nao comprou). Liberado o acesso e
//   recalculado o pop-up (o job de 15 min, aqui na hora), ela abre o Início e ve; recarregando, nao ("Uma vez").
// - "Ao concluir um curso": com todas as aulas concluidas menos a ultima, Concluir na ultima abre o pop-up
//   (a gravacao que fecha o curso responde courseCompleted); Desmarcar nao abre nada; concluir de novo (na pagina
//   aberta de novo) e outra chance (cada virada para 100 % conta, dentro de "Quantas vezes").

const { curso, cursoBloqueado } = ESCOLA_DE_TESTE;
const AULA_3 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo2}?lessonId=${curso.aulas.aula3}`;
const ABERTURA = /^\/api\/popups\/[^/]+\/show$/;
const TEXTO = "Boas-vindas! Comece pela aula 1 e passe na comunidade.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarComunicacao();
  await zerarProgressoDosAlunos();
  await tirarAcessoDeTeste("aluna", cursoBloqueado.id);
});

test.afterAll(async () => {
  await tirarAcessoDeTeste("aluna", cursoBloqueado.id);
  await zerarComunicacao();
  await zerarProgressoDosAlunos();
});

/** Espera o tempo de um pop-up do Início (o pedido sai 1,5 s depois de abrir, mais os 3 s) e confere que nada abriu. */
async function nadaAbreNoInicio(page: Page) {
  await page.waitForTimeout(6_000);
  await expect(page.locator("[data-member-popup]")).toHaveCount(0);
}

/**
 * Marca a opcao (pilula ou caixa) clicando no texto dela ate ficar marcada: o primeiro clique logo depois de abrir a
 * pagina pode chegar antes da hidratacao. Nunca clica de novo numa opcao ja marcada (a caixa desmarcaria).
 */
async function marcarAte(grupo: Locator, nome: string, papel: "checkbox" | "radio" = "radio") {
  const opcao = papel === "radio" ? grupo.getByRole("radio", { exact: true, name: nome }) : grupo.getByRole("checkbox", { name: new RegExp(nome) });

  await expect(async () => {
    if (!(await opcao.isChecked())) {
      await grupo.getByText(nome, { exact: true }).click();
    }
    await expect(opcao).toBeChecked({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** O card do editor pelo titulo (SectionCard: uma regiao com o nome do h2). */
function card(page: Page, titulo: string) {
  return page.getByRole("region", { exact: true, name: titulo });
}

test.describe("no primeiro acesso, com o produto escolhido", () => {
  const TITULO = "Pop-up E2E: boas-vindas ao curso novo";

  test("o produtor publica pela tela; a aluna vê no Início só depois de ganhar o acesso, e uma vez", async ({ browser, page }) => {
    test.setTimeout(120_000);
    let id = "";
    const produtor = await abrirComoProdutor(browser);

    await test.step("o produtor monta “No primeiro acesso · A primeira vez com estes produtos” e publica", async () => {
      const tela = produtor.pagina;

      try {
        await tela.goto("/admin/comunicacao/avisos/novo?tipo=popup");
        await tela.waitForLoadState("networkidle");
        await tela.getByLabel("Título", { exact: true }).fill(TITULO);
        await expect(tela.getByLabel("Título", { exact: true })).toHaveValue(TITULO);
        await tela.getByLabel("Texto (opcional)", { exact: true }).fill(TEXTO);
        await expect(tela.getByLabel("Texto (opcional)", { exact: true })).toHaveValue(TEXTO);

        const lugar = card(tela, "Quando e onde aparece");
        const momento = lugar.getByRole("radiogroup", { name: "Quando o pop-up aparece" });
        await marcarAte(momento, "No primeiro acesso");
        await expect(lugar.getByText("Aparece só para aluno novo (ou para quem acabou de ganhar acesso aos produtos escolhidos), na primeira página escolhida que ele abrir.", { exact: true })).toBeVisible();

        const conta = lugar.getByRole("radiogroup", { name: "Conta como primeiro acesso" });
        await expect(conta.getByRole("radio", { exact: true, name: "A primeira vez na área" })).toBeChecked();
        await expect(lugar.getByText("Aparece na primeira vez que o aluno entra na área, no Início.", { exact: true })).toBeVisible();
        await marcarAte(conta, "A primeira vez com estes produtos");

        const produtos = lugar.getByRole("group", { exact: true, name: "Produtos" });
        await marcarAte(produtos, cursoBloqueado.titulo, "checkbox");
        await expect(lugar.getByRole("radiogroup", { name: "Onde o pop-up aparece" }).getByRole("radio", { name: "Só no Início" })).toBeChecked();
        await expect(lugar.getByText(`Aparece na primeira vez depois de ganhar acesso a ${cursoBloqueado.titulo}, no Início.`, { exact: true })).toBeVisible();
        await expect(
          lugar.getByText("Para quem acabou de comprar, pode levar até 15 minutos para valer: nesse caso, ele aparece na página seguinte que o aluno abrir.", { exact: true })
        ).toBeVisible();

        await expect(
          card(tela, "Revisão").getByText(
            new RegExp(
              `^Pop-up para quem entrar pela primeira vez depois de ganhar acesso a ${cursoBloqueado.titulo} \\(entre (\\d+ alunos?|os alunos) do segmento\\), no Início, a partir de agora, sem data para acabar, no máximo 1 vez\\.$`
            )
          )
        ).toBeVisible();

        await tela.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
        await expect(tela.getByText("Pop-up publicado. Ele aparece para os alunos novos a partir de agora.", { exact: true })).toBeVisible();
        await expect(tela).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
        id = new URL(tela.url()).pathname.split("/").at(-1) ?? "";
      } finally {
        await produtor.fechar();
      }
    });

    await test.step("antes de ganhar o acesso, a aluna (que já usava a área) não conta como aluna nova", async () => {
      // A publicacao ja recalculou: so os candidatos ganham linha.
      expect(await estadoDoPopUpDaAluna(TITULO)).toBeNull();
    });

    await test.step("com o acesso liberado agora e o pop-up recalculado, ela vê no Início; recarregando, não", async () => {
      await liberarAcessoDeTeste("aluna", cursoBloqueado.id);
      await recalcularPopUp(id);
      expect(await estadoDoPopUpDaAluna(TITULO)).toMatchObject({ impressions: 0 });

      const aberturas = contarPedidos(page, ABERTURA, "POST");
      await page.goto("/");
      const popUp = page.getByRole("dialog", { name: TITULO });
      await expect(popUp).toBeVisible();
      await expect(popUp.getByText(TEXTO)).toBeVisible();
      await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
      expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: "home", trigger: "first_login" });
      await popUp.getByRole("button", { name: "Fechar" }).click();
      await expect(popUp).toHaveCount(0);
      expect(aberturas.total).toBe(1);

      await page.reload();
      await nadaAbreNoInicio(page);
      expect(aberturas.total).toBe(1);
    });
  });
});

test.describe("ao concluir um curso", () => {
  const TITULO = "Pop-up E2E: parabéns pelo curso";
  let id = "";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await zerarProgressoDosAlunos();
    id = await publicarPopUp(browser, { frequencia: { mode: "repeat", stopOn: "never" }, paginas: ["lesson:*"], quando: "course_completed", texto: TEXTO, titulo: TITULO });
    // Todas menos a ultima aula do curso.
    await concluirAulasDaAluna(curso.id, [curso.aulas.aula1, curso.aulas.aula2]);
  });

  /** Toca no botao de concluir (ou desmarcar) da aula e devolve o corpo da gravacao. */
  async function tocarEmConcluir(page: Page, nome: "Concluir aula atual" | "Desmarcar aula atual como concluída") {
    const gravou = page.waitForResponse((response) => response.url().includes("/api/progress/lessons") && response.request().method() === "PUT");
    await page.getByRole("button", { exact: true, name: nome }).click();
    const resposta = await gravou;
    expect(resposta.status()).toBe(200);

    return (await resposta.json()) as { courseCompleted?: boolean };
  }

  test("Concluir na última aula abre o pop-up; Desmarcar não; concluir de novo, na página aberta de novo, abre de novo", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(AULA_3);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Aula 3: Seu primeiro agente" })).toBeVisible();
    const aberturas = contarPedidos(page, ABERTURA, "POST");
    const popUp = page.getByRole("dialog", { name: TITULO });

    expect(await tocarEmConcluir(page, "Concluir aula atual")).toMatchObject({ courseCompleted: true });
    await expect(popUp).toBeVisible();
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed"]);
    expect((await eventosDoPopUp(id))[0].metadata).toMatchObject({ page: `lesson:${curso.id}`, trigger: "course_completed" });
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    expect(aberturas.total).toBe(1);

    // Desmarcar: o curso deixa de estar completo; nada abre.
    const desmarcou = await tocarEmConcluir(page, "Desmarcar aula atual como concluída");
    expect(desmarcou.courseCompleted).toBeUndefined();
    await page.waitForTimeout(4_500);
    await expect(popUp).toHaveCount(0);
    expect(aberturas.total).toBe(1);

    // Concluir de novo vira o curso de novo: outra chance (sem limite em "Quantas vezes"), na MESMA pagina aberta:
    // cada virada do curso nesta visualizacao e uma chave propria (`pop-up:course:<virada>`, docs/29 §4.3), sem
    // recarregar nada.
    await expect(page.getByRole("button", { exact: true, name: "Concluir aula atual" })).toBeVisible();
    expect(await tocarEmConcluir(page, "Concluir aula atual")).toMatchObject({ courseCompleted: true });
    await expect(popUp).toBeVisible();
    expect(aberturas.total).toBe(2);
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});
