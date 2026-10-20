import { expect, test, zerarComunicacao } from "./fixtures";

// Comunicacao > Avisos e pop-ups no navegador (docs/22 §2.2 e §1.1; docs/18 §3.1 e §3.2): o produtor
// cria uma notificacao no sino com um botao para "Minhas compras" e envia agora para todos os alunos; a
// aluna ve o numero no sino, abre o painel, segue o botao e chega a pagina; o numero nao volta. O
// beforeAll e o afterAll apagam o que foi enviado: um numero no sino mudaria o nome do botao nos
// outros arquivos.

const TITULO = "Aviso E2E: aula bônus liberada";
const TEXTO = "A aula bônus de agentes já está na sua área. Corre lá!";
const BOTAO = "Ver minhas compras";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("cria uma notificação com botão para Minhas compras e envia agora para todos os alunos", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos");
    // Lista vazia: o "Novo aviso" do cabecalho e o do estado vazio levam ao mesmo lugar.
    await page.getByRole("link", { name: "Novo aviso" }).first().click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/novo$/);
    await page.waitForLoadState("networkidle");

    // Tipo: o aviso novo ja nasce como notificacao no sino.
    await expect(page.getByRole("radio", { name: "Notificação no sino" })).toBeChecked();

    const titulo = page.getByLabel("Título", { exact: true });
    await titulo.fill(TITULO);
    await expect(titulo).toHaveValue(TITULO);
    const texto = page.getByLabel("Texto (opcional)", { exact: true });
    await texto.fill(TEXTO);
    await expect(texto).toHaveValue(TEXTO);

    // Botao: liga, escreve o texto e escolhe a pagina da area (as pilulas sao radios escondidos dentro
    // do label: clicar no texto marca).
    const mostrarBotao = page.getByRole("switch", { name: "Mostrar um botão" });
    await mostrarBotao.click();
    await expect(mostrarBotao).toHaveAttribute("aria-checked", "true");
    const textoDoBotao = page.getByLabel("Texto do botão", { exact: true });
    await textoDoBotao.fill(BOTAO);
    await expect(textoDoBotao).toHaveValue(BOTAO);
    await page.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Página da área").click();
    await expect(page.getByRole("radio", { name: "Página da área" })).toBeChecked();
    await page.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras").click();
    await expect(page.getByRole("radio", { name: "Minhas compras" })).toBeChecked();

    // Para quem: todos os alunos (o padrao), com a contagem ao vivo vinda do servidor.
    await expect(page.getByRole("radio", { name: "Todos os alunos" })).toBeChecked();
    await expect(page.getByText(/^≈ \d+ alunos? agora$/)).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    await expect(page.getByText(/^Notificação enviada para \d+ alunos?\.$/)).toBeVisible();

    // Enviado, o aviso abre no relatorio; na lista, a linha diz "Enviado".
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();
    await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();

    await page.goto("/admin/comunicacao/avisos");
    const linha = page.getByRole("row").filter({ hasText: TITULO });
    await expect(linha).toHaveCount(1);
    await expect(linha.getByText("Enviado", { exact: true })).toBeVisible();
  });
});

test.describe("aluna", () => {
  test("vê 1 nova no sino, abre o painel, segue o botão até Minhas compras e o número não volta", async ({ page }) => {
    await page.goto("/");

    // O numero do sino e aria-hidden; o nome do botao diz quantas chegaram.
    const sinoComNovidade = page.getByRole("button", { exact: true, name: "Notificações, 1 nova" });
    await expect(sinoComNovidade).toBeVisible();
    await sinoComNovidade.click();

    const painel = page.getByRole("dialog", { name: "Notificações" });
    await expect(painel).toBeVisible();
    const aviso = painel.getByRole("article", { name: TITULO });
    await expect(aviso).toBeVisible();
    await expect(aviso.getByText(TEXTO)).toBeVisible();
    await expect(aviso.getByText("Não lida")).toBeAttached();
    // Abrir o sino marca tudo como visto: o numero some na hora (a bolinha de nao lida fica).
    const sino = page.getByRole("button", { exact: true, name: "Notificações" });
    await expect(sino).toBeVisible();

    const botao = aviso.getByRole("link", { name: BOTAO });
    await expect(botao).not.toHaveAttribute("target", "_blank");
    await botao.click();
    await expect(page).toHaveURL("/minhas-compras");
    await expect(painel).toHaveCount(0);

    // O clique vale como leitura no servidor (sendBeacon): espera ele chegar antes de reabrir.
    await expect
      .poll(async () => {
        const resposta = await page.request.get("/api/notifications");
        const { data } = (await resposta.json()) as { data: { items: { readAt: string | null; title: string }[] } };
        return data.items.find((item) => item.title === TITULO)?.readAt ?? null;
      })
      .not.toBeNull();

    // Recarregar prova que vem do servidor: o resumo diz 0 novas, e o aviso aparece lido ao reabrir.
    const resumo = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/notifications/summary");
    await page.reload();
    expect(((await (await resumo).json()) as { data: { unseen: number } }).data.unseen).toBe(0);
    await expect(sino).toBeVisible();
    await sino.click();
    await expect(painel.getByRole("article", { name: TITULO })).toBeVisible();
    await expect(painel.getByRole("article", { name: TITULO }).getByText("Não lida")).toHaveCount(0);
    await expect(painel.getByRole("button", { name: "Marcar todas como lidas" })).toHaveCount(0);
  });
});
