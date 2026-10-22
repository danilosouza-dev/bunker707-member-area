import type { Page } from "@playwright/test";
import { expect, test, zerarComunicacao } from "./fixtures";

// O produtor configura o pop-up nos dois cards novos (docs/25 §2; docs/18 §3.1): "Quando e onde aparece"
// (Escolher páginas sem nenhuma pagina marcada recusa; "Em qualquer página" com "Nunca nestas páginas: Perfil" e a frase ao
// vivo) e "Quantas vezes e como fecha" (Mais de uma vez comeca em 1 por dia e, sem botao, em "Só quando o
// pop-up terminar"; o limite por dia fora de 1 a 100 recusa; 1 dia + 10 por dia avisa que cabe 1; a frase ao
// vivo; "Só no X"). A revisao, a legenda da previa, o toast de publicar (ate 1 minuto), as linhas de
// "Detalhes" do relatorio, a segunda linha da lista e, no pop-up no ar, "Mostrar de novo para quem já viu" em
// "Mais de uma vez" e a linha de quem ja viu ao mudar onde ele aparece.

const TITULO = "Pop-up E2E: configurado nos cards";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** O card do editor ou do relatorio pelo titulo (SectionCard: uma regiao com o nome do h2). */
function card(page: Page, titulo: string) {
  return page.getByRole("region", { exact: true, name: titulo });
}

test("monta o pop-up nos dois cards, com a validação, as frases e a prévia, e publica", async ({ page }) => {
  await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("radio", { exact: true, name: "Pop-up" })).toBeChecked();
  await expect(page.getByText("Aparece por cima da página, onde e quando você escolher.", { exact: true })).toBeVisible();
  await page.getByLabel("Título", { exact: true }).fill(TITULO);
  await page.getByLabel("Texto (opcional)", { exact: true }).fill("Plantão de dúvidas toda quarta.");

  // Quando e onde aparece.
  const lugar = card(page, "Quando e onde aparece");
  await expect(lugar.getByText("Em que momento e em quais páginas o pop-up abre.", { exact: true })).toBeVisible();
  await expect(lugar.getByRole("radiogroup", { name: "Quando o pop-up aparece" }).getByRole("radio", { name: "Ao abrir a página" })).toBeChecked();
  const onde = lugar.getByRole("radiogroup", { name: "Onde o pop-up aparece" });
  await expect(onde.getByRole("radio", { name: "Só no Início" })).toBeChecked();
  await onde.getByText("Escolher páginas", { exact: true }).click();
  // A lista comeca com o Início (o que estava escolhido); sem nenhuma pagina marcada, publicar recusa.
  const paginas = lugar.getByRole("group", { exact: true, name: "Páginas" });
  await expect(paginas.getByRole("checkbox", { exact: true, name: "Início" })).toBeChecked();
  await paginas.getByRole("checkbox", { exact: true, name: "Início" }).click();
  await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
  await expect(lugar.getByText("Escolha pelo menos uma página.", { exact: true })).toBeVisible();

  await onde.getByText("Em qualquer página", { exact: true }).click();
  await lugar.getByRole("switch", { name: "Nunca mostrar em algumas páginas" }).click();
  await lugar.getByRole("group", { name: "Nunca nestas páginas" }).getByRole("checkbox", { exact: true, name: "Perfil" }).click();
  await expect(lugar.getByText("Aparece em qualquer página, menos Perfil.", { exact: true })).toBeVisible();
  await expect(lugar.getByText("Escolha pelo menos uma página.", { exact: true })).toHaveCount(0);

  // Quantas vezes e como fecha.
  const vezes = card(page, "Quantas vezes e como fecha");
  await vezes.getByRole("radiogroup", { name: "Quantas vezes o pop-up aparece" }).getByText("Mais de uma vez", { exact: true }).click();
  await expect(vezes.getByRole("switch", { name: "Limitar por dia" })).toBeChecked();
  const porDia = vezes.getByLabel("Vezes por dia", { exact: true });
  await expect(porDia).toHaveValue("1");
  const parar = vezes.getByRole("radiogroup", { name: "O que faz o pop-up parar de aparecer" });
  await expect(parar.getByRole("radio", { name: "Só quando o pop-up terminar" })).toBeChecked();
  await expect(parar.getByRole("radio", { name: "Quando o aluno clica no botão" })).toBeDisabled();
  await expect(vezes.getByText("Este pop-up não tem botão. Ligue “Levar o aluno a algum lugar” ou escolha outra opção.", { exact: true })).toBeVisible();
  await expect(vezes.getByText("Sem data para acabar, ele continua aparecendo enquanto o aluno estiver no segmento.", { exact: true })).toBeVisible();

  await porDia.fill("0");
  await expect(vezes.getByText("Use de 1 a 100 vezes por dia.", { exact: true })).toBeVisible();
  await porDia.fill("10");
  await expect(vezes.getByText("Use de 1 a 100 vezes por dia.", { exact: true })).toHaveCount(0);
  await expect(
    vezes.getByText(
      "Sem tempo entre uma vez e outra, as 10 vezes do dia podem acontecer seguidas, uma em cada página que o aluno abrir. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”.",
      { exact: true }
    )
  ).toBeVisible();

  // 1 dia entre uma vez e outra com 10 por dia: cabe 1 por dia.
  await vezes.getByRole("switch", { name: "Tempo entre uma vez e outra" }).click();
  await expect(vezes.getByLabel("Tempo", { exact: true })).toHaveValue("1");
  await expect(vezes.getByRole("radiogroup", { exact: true, name: "Unidade do tempo" }).getByRole("radio", { name: "dias" })).toBeChecked();
  await expect(
    vezes.getByText("Com 1 dia entre uma vez e outra, cabem no máximo 1 vez por dia, não 10. Diminua o tempo entre uma vez e outra ou desligue essa opção.", {
      exact: true
    })
  ).toBeVisible();

  // 2 horas e 2 por dia: sem aviso.
  await vezes.getByLabel("Tempo", { exact: true }).fill("2");
  await vezes.getByRole("radiogroup", { exact: true, name: "Unidade do tempo" }).getByText("horas", { exact: true }).click();
  await porDia.fill("2");
  await expect(vezes.getByText(/^Com .* entre uma vez e outra, cabem no máximo/)).toHaveCount(0);
  await expect(
    vezes.getByText(
      "Cada aluno vê até 2 vezes por dia, com pelo menos 2 horas entre uma vez e outra (na próxima página que abrir depois desse tempo), até o pop-up terminar. Fecha no X, no Esc ou clicando fora.",
      { exact: true }
    )
  ).toBeVisible();

  // Como fechar: Só no X. A frase e a legenda da previa mudam.
  await expect(vezes.getByText("“Não mostrar de novo” sempre vale: quem escolhe não vê mais este pop-up.", { exact: true })).toBeVisible();
  await vezes.getByRole("radiogroup", { name: "Como o aluno fecha o pop-up" }).getByText("Só no X", { exact: true }).click();
  await expect(vezes.getByText("Clicar fora não fecha. O Esc continua fechando, para quem usa teclado ou leitor de tela.", { exact: true })).toBeVisible();
  await expect(vezes.getByText(/Fecha só no X \(e no Esc\)\.$/)).toBeVisible();
  const previa = page.getByRole("region", { name: "Prévia" });
  await expect(previa.getByText("Fecha só no X (e no Esc).", { exact: true })).toBeVisible();

  // Revisao com onde, quando e quantas vezes.
  await expect(
    card(page, "Revisão").getByText(
      /^Pop-up para \d+ alunos?, em qualquer página, menos Perfil, a partir de agora, sem data para acabar, até 2 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o pop-up terminar\.$/
    )
  ).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
  await expect(page.getByText("Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();

  // Relatorio: "Detalhes" com o que foi escolhido.
  const detalhes = card(page, "Detalhes");
  const linha = (rotulo: string) => detalhes.locator("dl > div").filter({ has: page.getByText(rotulo, { exact: true }) }).locator("dd");
  await expect(linha("Onde")).toHaveText("Em qualquer página, menos Perfil");
  await expect(linha("Quando aparece")).toHaveText("Ao abrir a página, 3 segundos depois");
  await expect(linha("Quantas vezes")).toHaveText("Até 2 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o pop-up terminar");
  await expect(linha("Como fecha")).toHaveText("Só no X (e no Esc)");
});

test("no ar: a lista mostra onde ele aparece; Editar tem Mostrar de novo em Mais de uma vez e avisa ao mudar onde ele aparece", async ({ page }) => {
  await page.goto("/admin/comunicacao/avisos");
  const linhaDaLista = page.getByRole("row").filter({ hasText: TITULO });
  await expect(linhaDaLista).toHaveCount(1);
  await expect(linhaDaLista.getByText("Em qualquer página (com exceções)", { exact: true })).toBeVisible();

  await linhaDaLista.getByRole("button", { name: `Ações de ${TITULO}` }).click();
  await expect(page.getByRole("menuitem", { name: "Mostrar de novo para quem já viu" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}\?editar=1$/);
  await page.waitForLoadState("networkidle");

  const vezes = card(page, "Quantas vezes e como fecha");
  await expect(vezes.getByRole("radio", { name: "Mais de uma vez" })).toBeChecked();
  await expect(vezes.getByRole("switch", { name: "Mostrar de novo para quem já viu" })).toBeVisible();
  await expect(vezes.getByLabel("Tempo", { exact: true })).toHaveValue("2");
  await expect(vezes.getByRole("radiogroup", { exact: true, name: "Unidade do tempo" }).getByRole("radio", { name: "horas" })).toBeChecked();

  const lugar = card(page, "Quando e onde aparece");
  await lugar.getByRole("group", { name: "Nunca nestas páginas" }).getByRole("checkbox", { exact: true, name: "Suporte" }).click();
  await expect(lugar.getByText("Aparece em qualquer página, menos Perfil e Suporte.", { exact: true })).toBeVisible();
  await expect(
    lugar.getByText(
      "Mudar onde ou quando ele aparece vale na hora. Quem já viu continua contando como visto, também nas páginas novas. Para todos verem de novo, ligue “Mostrar de novo para quem já viu”.",
      { exact: true }
    )
  ).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Salvar alterações" }).click();
  await expect(
    page.getByText("Pop-up atualizado. Vale na hora, contando as vezes que cada aluno já viu. Para quem já está com a área aberta, pode levar até 1 minuto.", { exact: true })
  ).toBeVisible();
  // Salvar o pop-up no ar fica no editor; o relatorio ja mostra a excecao nova.
  await page.goto(new URL(page.url()).pathname);
  await expect(card(page, "Detalhes").locator("dl > div").filter({ has: page.getByText("Onde", { exact: true }) }).locator("dd")).toHaveText(
    "Em qualquer página, menos Perfil e Suporte"
  );
});
