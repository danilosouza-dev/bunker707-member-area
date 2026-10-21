import { avisoNoBanco, expect, linhaDoSino, test, zerarComunicacao } from "./fixtures";

// Ajustes da v3a depois do primeiro teste do produtor (docs/24 §10; docs/18 §3.1): o produtor desliga
// "Permitir que o aluno exclua do sino" (a previa perde o "⋯") e escolhe "Fica no sino por" > "Outro" >
// "Por um tempo" em minutos: 4 minutos e recusado com "No mínimo 5 minutos." e 5 minutos passa. A aluna ve a
// notificacao no sino sem o "Mais opções" e a linha dela some 5 minutos depois de chegar. O beforeAll e o
// afterAll apagam o que foi enviado: um numero no sino mudaria o nome do botao nos outros arquivos.

const TITULO = "Lixeira E2E: aviso rápido que fica no sino";
const MINUTO = 60_000;

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("desliga a lixeira do sino, tenta 4 minutos, envia com 5 minutos", async ({ page }) => {
    await page.goto("/admin/comunicacao/avisos/novo");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(TITULO);

    // "Permitir que o aluno exclua do sino": ligado por padrao, com o "⋯" na previa; desligar tira o "⋯".
    const previa = page.getByRole("figure", { name: /^Prévia da notificação no sino/ });
    await expect(previa.locator("article [data-card-more]")).toHaveCount(1);
    const lixeira = page.getByRole("switch", { name: "Permitir que o aluno exclua do sino" });
    await expect(lixeira).toHaveAttribute("aria-checked", "true");
    await lixeira.click();
    await expect(lixeira).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Sem essa opção, a notificação fica no sino do aluno até o tempo dela acabar.", { exact: true })).toBeVisible();
    await expect(previa.locator("article [data-card-more]")).toHaveCount(0);

    // "Fica no sino por" > "Outro" > "Por um tempo": a unidade "minutos" vem antes de horas e dias.
    await page.getByRole("radiogroup", { name: "Fica no sino por" }).getByText("Outro", { exact: true }).click();
    await expect(page.getByRole("radiogroup", { name: "Outro tempo no sino" }).getByRole("radio", { name: "Por um tempo" })).toBeChecked();
    const unidades = page.getByRole("radiogroup", { name: "Unidade" });
    await expect(unidades.locator("label")).toHaveText(["minutos", "horas", "dias"]);
    await unidades.getByText("minutos", { exact: true }).click();
    await expect(unidades.getByRole("radio", { name: "minutos" })).toBeChecked();
    const quanto = page.getByRole("spinbutton", { name: "Quanto tempo" });

    // Abaixo de 5 minutos o envio para no campo, com a frase.
    await quanto.fill("4");
    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    await expect(page.getByText("No mínimo 5 minutos.", { exact: true })).toBeVisible();
    await expect(quanto).toHaveAttribute("aria-invalid", "true");

    await quanto.fill("5");
    await expect(page.getByText("No mínimo 5 minutos.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { exact: true, name: "Enviar agora" }).click();
    await expect(page.getByText(/^Notificação enviada para \d+ alunos?\.$/)).toBeVisible();

    // O que ficou gravado: sem lixeira e 5 minutos no sino.
    expect(await avisoNoBanco(TITULO)).toEqual({ allow_hide: false, valid_until: null, validity_minutes: 5 });
  });
});

test.describe("aluna", () => {
  test("vê a notificação sem o “Mais opções” e ela sai do sino 5 minutos depois de chegar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    const painel = page.getByRole("dialog", { name: "Notificações" });
    const cartao = painel.getByRole("article", { name: TITULO });
    await expect(cartao).toBeVisible();
    await expect(cartao.getByRole("button", { name: /Mais opções/ })).toHaveCount(0);
    await expect(painel.getByRole("button", { name: /Mais opções/ })).toHaveCount(0);

    // A linha do sino vence 5 minutos depois de chegar (o fim e contado no app e a chegada e gravada pelo
    // banco no insert: uns segundos de folga). O "Termina em" conta dela.
    const linha = await linhaDoSino(TITULO);
    expect(linha).not.toBeNull();
    const duracao = Date.parse(linha?.expires_at ?? "") - Date.parse(linha?.created_at ?? "");
    expect(duracao).toBeGreaterThan(5 * MINUTO - 10_000);
    expect(duracao).toBeLessThanOrEqual(5 * MINUTO + 10_000);
    await expect(cartao.getByText(/· Termina em [1-5] min$/)).toBeVisible();
  });
});
