import type { Page } from "@playwright/test";
import {
  contaDeTeste,
  envelhecerPopup,
  enviarNotificacao,
  estadoDoPopUpDaAluna,
  expect,
  idDoAviso,
  linhaDoSino,
  test,
  zerarComunicacao
} from "./fixtures";

// CRUD dos avisos no navegador (docs/24 §2.1 a §2.4 e §11; docs/18 §3.1): o ⋯ de uma notificacao enviada
// mostra Ver relatório, Editar, Duplicar, Retirar do sino e Excluir; Editar troca o titulo e a aluna ve o
// novo sem a bolinha de nao lida voltar; Excluir tira da lista e do sino dela. Um pop-up no ar em "Uma vez"
// que a aluna fechou (o que ela viu volta 25 h no tempo): ela nao ve de novo; ⋯ "Mostrar de novo para quem
// já viu" -> "para 1 aluno" -> ela ve; o aluno que escolheu "Não mostrar de novo" nao ve. Em "Até o aluno
// clicar" o ⋯ nao tem "Mostrar de novo". O pop-up e publicado pela tela: a lista de pop-ups no ar fica 60 s
// em cache no servidor e so a publicacao a renova (como em aluno-ve-pop-up).

const ENVIADA = "Editar E2E: revisão no sábado";
const EDITADA = "Editar E2E: revisão no domingo";
const POPUP = "Pop-up E2E: plantão de dúvidas";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const SESSAO_DO_ALUNO_SEM_ACESSO = "tests/e2e/.auth/aluno-sem-acesso.json";

test.describe.configure({ mode: "serial" });

let idDaEnviada = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  idDaEnviada = await enviarNotificacao({ texto: "A revisão do módulo 1 vai ser ao vivo.", titulo: ENVIADA });
});

test.afterAll(zerarComunicacao);

/** Abre a home numa sessao nova do navegador e devolve o pop-up que o servidor mandou (ou null). */
async function abrirHomeEmSessaoNova(page: Page) {
  // O limite de 1 por sessao fica no sessionStorage: sem ele, quem decide e o servidor.
  await page.evaluate(() => window.sessionStorage.clear());
  const resumo = page.waitForResponse((response) => response.url().includes("/api/notifications/summary?popup=1"));
  await page.reload();
  const { data } = (await (await resumo).json()) as { data: { popup: { title: string } | null } };

  return data.popup;
}

/** O menu ⋯ da linha do aviso na lista (aberto). */
async function abrirMenuDaLinha(page: Page, titulo: string) {
  await page.goto("/admin/comunicacao/avisos");
  const linha = page.getByRole("row").filter({ hasText: titulo });
  await expect(linha).toHaveCount(1);
  const itens = page.getByRole("menuitem");
  // Logo depois de abrir a pagina o botao ja esta desenhado, mas o React pode ainda nao ter ligado o clique
  // (no WebKit da CI o primeiro clique se perdia e o menu nunca abria): clica de novo ate o menu abrir.
  await expect(async () => {
    if ((await itens.count()) === 0) {
      await linha.getByRole("button", { name: `Ações de ${titulo}` }).click();
    }
    await expect(itens.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  return itens;
}

test.describe("produtor publica", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR });

  test("um pop-up para todos os alunos, em Uma vez", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("radio", { name: "Pop-up na home" })).toBeChecked();
    await page.getByLabel("Título", { exact: true }).fill(POPUP);
    await page.getByLabel("Texto (opcional)", { exact: true }).fill("Toda quarta, das 19h às 20h, com a equipe.");
    await expect(page.getByRole("radio", { name: "Uma vez" })).toBeChecked();
    await expect(page.getByText(/^≈ \d+ alunos? agora$/)).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(page.getByText("Pop-up publicado.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: POPUP })).toBeVisible();
  });
});

test.describe("alunos veem", () => {
  test("a aluna fecha o pop-up no X e lê a notificação enviada", async ({ page }) => {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: POPUP });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    // O evento vai por sendBeacon: espera o servidor gravar.
    await expect.poll(async () => (await estadoDoPopUpDaAluna(POPUP))?.impressions ?? 0).toBe(1);
    expect((await estadoDoPopUpDaAluna(POPUP))?.dismissedAt ?? null).toBeNull();

    await page.getByRole("button", { name: /^Notificações/ }).click();
    const painel = page.getByRole("dialog", { name: "Notificações" });
    await expect(painel.getByRole("article", { name: ENVIADA })).toBeVisible();
    await painel.getByRole("button", { name: "Marcar todas como lidas" }).click();
    await expect(painel.getByRole("article", { name: ENVIADA }).getByText("Não lida")).toHaveCount(0);
    // O botao some e o foco vai para o titulo do painel (nao fica perdido no painel inteiro).
    await expect(painel.getByRole("heading", { name: "Notificações" })).toBeFocused();
    await page.waitForTimeout(200);
    await expect(painel.getByRole("heading", { name: "Notificações" })).toBeFocused();
    await expect.poll(async () => (await linhaDoSino(ENVIADA))?.read_at ?? null).not.toBeNull();
  });

  test.describe("aluno sem acesso", () => {
    test.use({ storageState: SESSAO_DO_ALUNO_SEM_ACESSO });

    test("escolhe Não mostrar de novo", async ({ page }) => {
      await page.goto("/");
      const popUp = page.getByRole("dialog", { name: POPUP });
      await expect(popUp).toBeVisible();
      await popUp.getByRole("button", { name: "Não mostrar de novo" }).click();
      await expect(popUp).toHaveCount(0);
      await expect.poll(async () => (await estadoDoPopUpDaAluna(POPUP, "alunoSemAcesso"))?.dismissedAt ?? null).not.toBeNull();
    });
  });

  test("25 h depois, em Uma vez, a aluna que fechou não vê o pop-up de novo", async ({ page }) => {
    const popupId = await idDoAviso(POPUP);
    expect(await envelhecerPopup(popupId, (await contaDeTeste("aluna")).id, 25)).toBe(1);
    expect(await envelhecerPopup(popupId, (await contaDeTeste("alunoSemAcesso")).id, 25)).toBe(1);

    await page.goto("/");
    expect(await abrirHomeEmSessaoNova(page)).toBeNull();
    await expect(page.getByRole("dialog", { name: POPUP })).toHaveCount(0);
  });
});

test.describe("produtor edita e mostra de novo", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR });

  test("⋯ da notificação enviada: Ver relatório, Editar, Duplicar, Retirar do sino e Excluir; Editar troca o título", async ({ page }) => {
    const itens = await abrirMenuDaLinha(page, ENVIADA);
    await expect(itens).toHaveText(["Ver relatório", "Editar", "Duplicar", "Retirar do sino", "Excluir"]);
    await page.getByRole("menuitem", { name: "Editar" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${idDaEnviada}\\?editar=1$`));
    await expect(page.getByRole("heading", { level: 1, name: "Editar notificação enviada" })).toBeVisible();
    await expect(page.getByText("Esta notificação já está no sino de 1 aluno.", { exact: false })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const titulo = page.getByLabel("Título", { exact: true });
    await titulo.fill(EDITADA);
    await expect(titulo).toHaveValue(EDITADA);
    await page.getByRole("button", { exact: true, name: "Salvar alterações" }).click();

    await expect(page.getByText("Notificação atualizada no sino de 1 aluno.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/avisos/${idDaEnviada}$`));
    await expect(page.getByRole("heading", { level: 1, name: EDITADA })).toBeVisible();
  });

  test("⋯ do pop-up em Uma vez: Mostrar de novo para quem já viu, para 1 aluno", async ({ page }) => {
    await abrirMenuDaLinha(page, POPUP);
    await page.getByRole("menuitem", { name: "Mostrar de novo para quem já viu" }).click();
    const dialogo = page.getByRole("dialog", { name: `Mostrar “${POPUP}” de novo?` });
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("O pop-up volta a aparecer para quem já viu e não clicou.");
    await dialogo.getByRole("button", { exact: true, name: "Mostrar de novo" }).click();
    await expect(page.getByText("O pop-up volta a aparecer para 1 aluno.", { exact: true })).toBeVisible();
  });
});

test.describe("depois de editar e mostrar de novo", () => {
  test("o pop-up volta para a aluna, e ela vê o título novo sem a bolinha de não lida", async ({ page }) => {
    // Primeiro o pop-up: ele espera o sino fechar, e ver um pop-up agora conta para o limite de 24 h.
    const resumo = page.waitForResponse((response) => response.url().includes("/api/notifications/summary?popup=1"));
    await page.goto("/");
    expect(((await (await resumo).json()) as { data: { popup: { title: string } | null } }).data.popup?.title).toBe(POPUP);
    const popUp = page.getByRole("dialog", { name: POPUP });
    await expect(popUp).toBeVisible();
    await popUp.getByRole("button", { name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(POPUP))?.impressions ?? 0).toBe(2);

    await page.getByRole("button", { name: /^Notificações/ }).click();
    const painel = page.getByRole("dialog", { name: "Notificações" });
    const editada = painel.getByRole("article", { name: EDITADA });
    await expect(editada).toBeVisible();
    await expect(editada.getByText("Não lida")).toHaveCount(0);
    await expect(painel.getByRole("article", { name: ENVIADA })).toHaveCount(0);
    expect((await linhaDoSino(EDITADA))?.read_at ?? null).not.toBeNull();
  });

  test.describe("aluno sem acesso", () => {
    test.use({ storageState: SESSAO_DO_ALUNO_SEM_ACESSO });

    test("quem escolheu Não mostrar de novo continua sem ver", async ({ page }) => {
      await page.goto("/");
      expect(await abrirHomeEmSessaoNova(page)).toBeNull();
      await expect(page.getByRole("dialog", { name: POPUP })).toHaveCount(0);
    });
  });
});

test.describe("produtor exclui e muda para Até o aluno clicar", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR });

  test("Excluir a notificação enviada: o diálogo explica, ela sai da lista", async ({ page }) => {
    await abrirMenuDaLinha(page, EDITADA);
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    const dialogo = page.getByRole("dialog", { name: `Excluir “${EDITADA}”?` });
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(
      "A notificação some do sino do 1 aluno que recebeu e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino."
    );
    await dialogo.getByRole("button", { exact: true, name: "Excluir notificação" }).click();
    await expect(page.getByText("Notificação excluída do sino de 1 aluno.", { exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: EDITADA })).toHaveCount(0);
  });

  test("o pop-up em Até o aluno clicar não oferece Mostrar de novo", async ({ page }) => {
    const itens = await abrirMenuDaLinha(page, POPUP);
    await expect(itens.filter({ hasText: "Mostrar de novo para quem já viu" })).toHaveCount(1);
    await page.getByRole("menuitem", { name: "Editar" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}\?editar=1$/);
    await page.waitForLoadState("networkidle");

    // Em "Uma vez" o editor mostra o "Mostrar de novo"; em "Até o aluno clicar" ele some e a dica explica.
    const mostrarDeNovo = page.getByRole("switch", { name: "Mostrar de novo para quem já viu" });
    await expect(mostrarDeNovo).toBeVisible();
    await page.getByRole("radiogroup", { name: "Quantas vezes o pop-up aparece" }).getByText("Até o aluno clicar").click();
    await expect(page.getByRole("radio", { name: "Até o aluno clicar" })).toBeChecked();
    await expect(mostrarDeNovo).toHaveCount(0);
    await expect(page.getByText("Quem só fechou volta a ver 24 horas depois de ter visto este pop-up, até clicar.", { exact: false })).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Salvar alterações" }).click();
    await expect(page.getByText("Pop-up atualizado. Quem fechou sem clicar volta a ver 24 horas depois de ter visto este pop-up.", { exact: true })).toBeVisible();

    const depois = await abrirMenuDaLinha(page, POPUP);
    await expect(depois.filter({ hasText: "Editar" })).toHaveCount(1);
    await expect(depois.filter({ hasText: "Mostrar de novo para quem já viu" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("depois de excluir", () => {
  test("a notificação excluída sumiu do sino da aluna", async ({ page }) => {
    await page.goto("/");
    expect(await linhaDoSino(EDITADA)).toBeNull();
    const resposta = await page.request.get("/api/notifications");
    const { data } = (await resposta.json()) as { data: { items: { title: string }[] } };
    expect(data.items.map((item) => item.title)).not.toContain(EDITADA);
  });
});
