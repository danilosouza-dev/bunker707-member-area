import type { Page } from "@playwright/test";
import { abrirComoProdutor, eventosDoPopUp, expect, publicarPopUp, relatorioDoPopUp, test, zerarComunicacao, zerarProgressoDosAlunos } from "./fixtures";

// Relatorio do pop-up (docs/29 §6.5 e §8.4; docs/18 §3.1): a aluna ve o pop-up em Favoritos e fecha no Esc; o
// produtor abre a pagina do pop-up e ve "Como o pop-up foi visto": Vezes que apareceu 1, Favoritos em "Onde
// apareceu" e "Fecharam no Esc" em "Como fecharam". "Ver como tabela" troca os quatro blocos por tabelas e volta;
// a 375 px, nos dois modos, a pagina nao rola de lado. O relatorio fica 60 s em cache (a publicacao ja desenhou a
// pagina vazia): o produtor recarrega ate os numeros chegarem (no maximo pouco mais de 1 minuto).

const TITULO = "Pop-up E2E: relatório";
const TEXTO = "Novos materiais da semana na aba Materiais.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();
});
test.afterAll(zerarComunicacao);

/** A secao do relatorio do pop-up (h2 "Como o pop-up foi visto"). */
function relatorio(page: Page) {
  return page.getByRole("region", { exact: true, name: "Como o pop-up foi visto" });
}

/** Um bloco do relatorio pelo h3 ("Onde apareceu", "Como fecharam"...). */
function bloco(page: Page, titulo: string) {
  return relatorio(page).getByRole("region", { exact: true, name: titulo });
}

/** A pagina nao rola de lado (lido ate o desenho parar de mudar: logo depois de trocar a largura, ainda se acomoda). */
async function semRolagemLateral(page: Page) {
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
}

test("a aluna fecha no Esc em Favoritos; o produtor vê onde, como fecharam e quantas vezes, em gráfico e em tabela", async ({ browser, page }) => {
  test.setTimeout(240_000);
  const id = await publicarPopUp(browser, { paginas: ["saved"], texto: TEXTO, titulo: TITULO });

  await test.step("a aluna vê em Favoritos e fecha no Esc", async () => {
    await page.goto("/favoritos");
    const popUp = page.getByRole("dialog", { name: TITULO });
    await expect(popUp).toBeVisible();
    // O foco ja esta dentro do pop-up antes da tecla (no WebKit, a tecla antes disso se perde).
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("[data-member-popup]")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type)).toEqual(["message_impressed", "message_closed"]);
    expect((await eventosDoPopUp(id))[1].metadata).toMatchObject({ via: "esc" });
  });

  await test.step("o banco já conta: Favoritos 1, Fecharam no Esc 1, 1 vez para 1 aluno", async () => {
    const linhas = await relatorioDoPopUp(id);
    const linha = (metric: string, item = "") => linhas.find((candidata) => candidata.metric === metric && candidata.item === item);
    expect(linha("opened_kind", "saved")).toMatchObject({ students: 1, total: 1 });
    expect(linha("opened_trigger", "page_load")).toMatchObject({ students: 1, total: 1 });
    expect(linha("outcome", "closed_esc")).toMatchObject({ students: 1, total: 1 });
    expect(linha("viewers")).toMatchObject({ students: 1, total: 1 });
    expect(linha("times", "1")).toMatchObject({ students: 1, total: 1 });
  });

  const produtor = await abrirComoProdutor(browser);

  try {
    const tela = produtor.pagina;

    await test.step("o produtor abre o relatório (até os números passarem do cache de 60 s)", async () => {
      await tela.goto(`/admin/comunicacao/avisos/${id}`);
      await expect(tela.getByRole("heading", { level: 2, name: "Como o pop-up foi visto" })).toBeVisible();
      await expect(async () => {
        if (!(await relatorio(tela).getByRole("group", { name: /^Vezes que apareceu, 1,/ }).isVisible())) {
          await tela.reload();
        }
        await expect(relatorio(tela).getByRole("group", { name: /^Vezes que apareceu, 1,/ })).toBeVisible({ timeout: 2_000 });
      }).toPass({ intervals: [5_000], timeout: 120_000 });
    });

    await test.step("Vezes que apareceu 1, Favoritos 1 e Fecharam no Esc 1", async () => {
      const numeros = relatorio(tela);
      await expect(numeros.getByText("Desde a publicação. Atualiza a cada minuto.", { exact: true })).toBeVisible();
      await expect(numeros.getByRole("group", { name: /^Alunos que viram, 1,/ })).toBeVisible();
      await expect(numeros.getByRole("group", { name: /^No máximo, para um aluno, 1,/ })).toBeVisible();

      const favoritos = bloco(tela, "Onde apareceu").getByRole("listitem").filter({ has: tela.getByText("Favoritos", { exact: true }) });
      await expect(favoritos).toContainText("1 vez · 1 aluno");
      await expect(bloco(tela, "Em que momento").getByRole("listitem").filter({ has: tela.getByText("Ao abrir a página", { exact: true }) })).toContainText("1 vez · 1 aluno");
      const esc = bloco(tela, "Como fecharam").getByRole("listitem").filter({ has: tela.getByText("Fecharam no Esc", { exact: true }) });
      await expect(esc).toContainText("1 vez · 1 aluno");
      await expect(bloco(tela, "Como fecharam").getByText("Sem registro", { exact: true })).toHaveCount(0);
      await expect(bloco(tela, "Quantas vezes cada aluno viu").getByRole("listitem").filter({ has: tela.getByText("1 vez", { exact: true }) })).toContainText("1 aluno");
    });

    await test.step("Ver como tabela mostra as tabelas e Ver como gráfico volta", async () => {
      const alternar = relatorio(tela).getByRole("button", { name: /^Ver como (tabela|gráfico)$/ });
      await expect(alternar).toHaveText("Ver como tabela");
      await expect(alternar).toHaveAttribute("aria-pressed", "false");
      // Clica ate trocar (o primeiro clique logo depois de recarregar pode chegar antes da hidratacao).
      await expect(async () => {
        if ((await alternar.getAttribute("aria-pressed")) !== "true") {
          await alternar.click();
        }
        await expect(alternar).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      const voltar = relatorio(tela).getByRole("button", { name: "Ver como gráfico" });
      await expect(voltar).toHaveAttribute("aria-pressed", "true");

      const onde = relatorio(tela).getByRole("table", { name: "Onde apareceu" });
      await expect(onde).toBeVisible();
      await expect(onde.getByRole("columnheader", { name: "Página" })).toBeVisible();
      await expect(onde.getByRole("row").filter({ has: tela.getByRole("cell", { exact: true, name: "Favoritos" }) })).toContainText("1");
      const fecharam = relatorio(tela).getByRole("table", { name: "Como fecharam" });
      await expect(fecharam.getByRole("row").filter({ has: tela.getByRole("cell", { exact: true, name: "Fecharam no Esc" }) })).toBeVisible();
      await expect(relatorio(tela).getByRole("table")).toHaveCount(4);

      await voltar.click();
      await expect(relatorio(tela).getByRole("button", { name: "Ver como tabela" })).toHaveAttribute("aria-pressed", "false");
      await expect(relatorio(tela).getByRole("table")).toHaveCount(0);
      await expect(bloco(tela, "Onde apareceu").getByRole("listitem").filter({ has: tela.getByText("Favoritos", { exact: true }) })).toBeVisible();
    });

    await test.step("a 375 px, em gráfico e em tabela, a página não rola de lado", async () => {
      // Como o celular abre: a pagina carregada ja na largura de 375 px (o relatorio vem do cache de 60 s).
      await tela.setViewportSize({ height: 812, width: 375 });
      await tela.reload();
      await expect(relatorio(tela).getByRole("group", { name: /^Vezes que apareceu, 1,/ })).toBeVisible();
      await semRolagemLateral(tela);

      const alternar = relatorio(tela).getByRole("button", { name: /^Ver como (tabela|gráfico)$/ });
      await expect(async () => {
        if ((await alternar.getAttribute("aria-pressed")) !== "true") {
          await alternar.click();
        }
        await expect(alternar).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      // Abaixo de 768 px cada linha vira um cartao (lista de dl), sem tabela larga.
      const lista = relatorio(tela).getByRole("list", { name: "Onde apareceu" });
      await expect(lista).toBeVisible();
      await expect(lista.getByText("Favoritos", { exact: true })).toBeVisible();
      await semRolagemLateral(tela);
    });
  } finally {
    await produtor.fechar();
  }
});
