import { expect, test } from "./fixtures";
import { ESCOLA_DE_TESTE, SENHA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Topo da area do aluno no navegador: o hamburguer abre a gaveta (um dialogo "Menu") com os grupos
// Estudar e Conta e ajuda, o item da pagina atual marcado e cada item levando a uma pagina real; Esc
// fecha e devolve o foco ao botao; o avatar abre o menu da conta (Perfil, Minhas compras, Suporte,
// Sair), que funciona pelo teclado e pelo clique do mouse (regressao do Safari); e o botao flutuante
// abre a IA Diretor com a saudacao pelo nome e, sem provedor configurado nesta escola de teste, o
// motivo no lugar das sugestoes. Se o codigo do painel do sino nao baixa (deploy novo), o erro fica no
// painel e a pagina continua.

const { aluna } = ESCOLA_DE_TESTE.contas;
const primeiroNome = aluna.nome.split(" ")[0];

test("hamburguer abre a gaveta: grupos, item atual marcado, Esc fecha e devolve o foco; o item leva a pagina", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const abrir = page.getByRole("button", { name: "Abrir menu" });
  await abrir.click();
  const gaveta = page.getByRole("dialog", { name: "Menu" });
  await expect(gaveta).toBeVisible();
  const navegacao = gaveta.getByRole("navigation", { name: "Navegação da área do aluno" });
  await expect(navegacao.getByRole("link")).toHaveText([
    "Início", "Minha jornada", "Continue assistindo", "Minhas compras", "Favoritos", "Materiais", "Suporte", "Perfil"
  ]);
  await expect(navegacao.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(navegacao.getByRole("link", { name: "Minha jornada" })).not.toHaveAttribute("aria-current", "page");

  // Esc fecha e o foco volta para o botao que abriu.
  await page.keyboard.press("Escape");
  await expect(gaveta).toBeHidden();
  await expect(abrir).toBeFocused();

  await abrir.click();
  await navegacao.getByRole("link", { name: "Minha jornada" }).click();
  await expect(page).toHaveURL("/minha-jornada");
  await expect(page).toHaveTitle(/Minha jornada/);

  // Na jornada, o item marcado e Minha jornada; o botao "Fechar menu" da gaveta tambem fecha.
  await abrir.click();
  await expect(navegacao.getByRole("link", { name: "Minha jornada" })).toHaveAttribute("aria-current", "page");
  await gaveta.getByRole("button", { name: "Fechar menu" }).click();
  await expect(gaveta).toBeHidden();
});

test("menu da conta: avatar abre o painel com o nome e os atalhos; Esc fecha; Enter no item (teclado) leva a pagina", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const botao = page.getByRole("button", { name: `Menu da conta de ${aluna.nome}` });
  await botao.click();
  await expect(botao).toHaveAttribute("aria-expanded", "true");
  const painel = page.getByLabel("Sua conta");
  await expect(painel).toBeVisible();
  await expect(painel.getByText(aluna.nome)).toBeVisible();
  await expect(painel.getByRole("link")).toHaveText(["Perfil", "Minhas compras", "Suporte"]);
  await expect(painel.getByRole("button", { name: "Sair" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(painel).toBeHidden();
  await expect(botao).toHaveAttribute("aria-expanded", "false");

  // Ao abrir, o foco vai para o primeiro atalho (Perfil): Enter leva a pagina.
  await botao.click();
  await expect(painel.getByRole("link", { name: "Perfil" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/perfil");
  await expect(page).toHaveTitle(/Perfil/);
});

test("menu da conta: clicar no atalho com o mouse leva a pagina", async ({ page }) => {
  // Regressao do Safari (WebKit no macOS e no iPhone): o clique num link nao move o foco, e o menu
  // fechava no blur antes de o clique completar; a pagina nao mudava. Corrigido em
  // member-account-menu.tsx (o blur so fecha quando o foco vai para outro elemento da pagina). No
  // WebKit do Linux (a CI) e no Chromium o clique foca o link, por isso so o WebKit do macOS reproduzia.
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: `Menu da conta de ${aluna.nome}` }).click();
  const painel = page.getByLabel("Sua conta");
  await expect(painel).toBeVisible();
  await painel.getByRole("link", { name: "Minhas compras" }).click();
  await expect(page).toHaveURL("/minhas-compras", { timeout: 5_000 });
});

test("IA Diretor: o botao flutuante abre o painel com a saudacao pelo nome; sem provedor, mostra o motivo e nao deixa escrever; fecha", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Abrir IA Diretor" }).click();
  const painel = page.getByRole("dialog", { name: "IA Diretor" });
  await expect(painel).toBeVisible();
  await expect(painel.getByRole("heading", { name: `Olá, ${primeiroNome}` })).toBeVisible();
  await expect(painel.getByText("O produtor ainda nao configurou o modelo da IA Diretor.")).toBeVisible();
  await expect(painel.getByText("Sugestões para começar")).toHaveCount(0);
  await expect(painel.getByRole("textbox", { name: "Mensagem para a IA Diretor" })).toBeDisabled();

  // Ha dois "Fechar IA Diretor" (o botao flutuante, que vira "fechar" enquanto aberto, e o do cabecalho do painel).
  await painel.getByRole("button", { name: "Fechar IA Diretor" }).click();
  await expect(painel).toBeHidden();
});

test("sino: se o codigo do painel nao baixa (deploy novo trocou os arquivos), o erro fica no painel e a pagina continua; recarregar resolve", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Depois de um deploy, os arquivos de JavaScript antigos que a pagina ainda nao baixou dao 404.
  const arquivos = "**/_next/static/chunks/**";
  await page.route(arquivos, (route) => route.fulfill({ body: "", status: 404 }));

  await page.getByRole("button", { name: /^Notificações/ }).click();
  const painel = page.getByRole("dialog", { name: "Notificações" });
  await expect(painel.getByRole("alert")).toHaveText(/Não foi possível abrir as notificações\./);
  // Sem a tela de erro geral: o topo da pagina continua ali.
  await expect(page.getByRole("heading", { name: "Algo deu errado" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();

  await page.unroute(arquivos);
  const recarregou = page.waitForEvent("load");
  await painel.getByRole("button", { name: "Recarregar a página" }).click();
  await recarregou;
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Notificações/ }).click();
  await expect(page.getByRole("dialog", { name: "Notificações" }).getByRole("group", { name: "Filtrar notificações" })).toBeVisible();
});

// Sair com o mouse (mesma regressao do Safari: o botao nao recebe foco no clique). Entra como a aluna
// com acesso expirado, porque sair revoga as sessoes da conta no Auth e derrubaria o login guardado
// pelo setup (a aluna e o aluno sem acesso).
test.describe("sair pelo menu da conta", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("menu da conta: clicar em Sair com o mouse chama a saida e leva a tela de entrar", async ({ page }) => {
    const { alunaAcessoExpirado } = ESCOLA_DE_TESTE.contas;
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(alunaAcessoExpirado.email);
    await expect(page.locator('input[type="email"]')).toHaveValue(alunaAcessoExpirado.email);
    await page.locator('input[type="password"]').fill(SENHA_DE_TESTE);
    await page.getByRole("button", { exact: true, name: "Entrar" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: `Menu da conta de ${alunaAcessoExpirado.nome}` }).click();
    const painel = page.getByLabel("Sua conta");
    await expect(painel).toBeVisible();

    // O clique chama a saida no servidor e a pagina vai para a tela de entrar. (Os cookies nao sao
    // conferidos: em http, o build de producao apaga o cookie com Secure e o WebKit ignora; em https,
    // na producao, nao ha esse problema.)
    const saida = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout"));
    await painel.getByRole("button", { name: "Sair" }).click();
    expect((await saida).ok()).toBe(true);
    await expect(page).toHaveURL(/\/login/);
  });
});
