import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { expect, test, zerarComunicacao } from "./fixtures";

// Botão principal sem destino no Livre (docs/27 §4; docs/18 §3.1). Num aviso NOVO sem botão, o modelo "Só texto com
// brilho" cria o "Saiba mais" com o destino vazio. "Salvar rascunho" do editor do aviso recusa (`Revise os campos
// destacados.`) e o card Design diz "1 problema para revisar": esse resumo abre o editor Livre no Revisar, que
// mostra o mesmo item (Botão principal: `Escolha para onde o botão leva.`, a frase do Personalizado), e o item leva
// o foco ao "Para onde leva" no Conteúdo do Botão principal. Dentro do editor, "Salvar rascunho" abre o Revisar com o
// item, que continua depois de mudar o texto do botão (o destino segue vazio); escolhida a página, o item some, o
// salvar passa e o card fica sem problema.

const TITULO = "Pop-up E2E: Livre com o botão sem destino";
const SEM_DESTINO = "Escolha para onde o botão leva.";
const BOTAO = "Quero assistir";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

async function lerAviso() {
  const db = createLocalAdminClient();

  return unwrap(
    await db.from("campaigns").select("cta_href,cta_label,popup_design").eq("kind", "popup").eq("title", TITULO).is("deleted_at", null).maybeSingle(),
    `Lendo o pop-up "${TITULO}"`
  ) as { cta_href: string | null; cta_label: string | null; popup_design: { mode?: string } | null } | null;
}

test("o Botão principal sem destino aparece no Revisar do Livre, leva ao “Para onde leva” e some ao escolher", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título", { exact: true }).fill(TITULO);

  const design = page.getByRole("region", { exact: true, name: "Design" });
  const editor = page.getByRole("dialog", { name: "Editor Livre" });
  const abrir = design.getByRole("button", { name: "Abrir editor Livre" });
  const resumo = design.getByRole("button", { exact: true, name: "1 problema para revisar" });
  const itens = editor.locator("[data-free-review-item]");
  const itemDoDestino = editor.locator('[data-free-review-item="cta.href"]');
  const paraOndeLeva = editor.getByRole("radiogroup", { name: "Para onde o botão leva" });

  await test.step("escolhe Livre e o modelo “Só texto com brilho” (o “Saiba mais” sem destino) e volta ao aviso", async () => {
    // Um clique antes da hidratacao pode se perder: clica ate os modelos aparecerem.
    await expect(async () => {
      await design.getByText("Livre", { exact: true }).click();
      await expect(design.getByText("Escolha um ponto de partida. No editor, tudo pode ser mudado.", { exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await design.getByRole("button", { name: "Usar este modelo: Só texto com brilho" }).click();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
    // O Dialog devolve o foco ao card antes do proximo passo.
    await expect(abrir).toBeFocused();
  });

  await test.step("“Salvar rascunho” do aviso recusa e o card Design diz “1 problema para revisar”", async () => {
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page.getByText("Revise os campos destacados.", { exact: true })).toBeVisible();
    await expect(resumo).toBeVisible();
    await expect(resumo).toBeFocused();
    expect(await lerAviso(), "nada foi gravado").toBeNull();
  });

  await test.step("o resumo abre o Revisar com o mesmo item: o Botão principal, com a frase do Personalizado", async () => {
    await resumo.click();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByRole("heading", { exact: true, name: "Revisar" })).toBeVisible();
    await expect(editor.getByText("Tudo certo por aqui.", { exact: true })).toHaveCount(0);
    await expect(itens, "o Revisar conta o mesmo que o card").toHaveCount(1);
    await expect(itemDoDestino).toContainText("Botão principal");
    await expect(itemDoDestino).toContainText(SEM_DESTINO);
    // As Camadas marcam o Botão principal.
    await expect(editor.locator('[data-free-layer-row="botao"]')).toContainText("Tem algo para revisar");
  });

  await test.step("o item leva o foco ao “Para onde leva” no Conteúdo do Botão principal", async () => {
    await itemDoDestino.getByRole("button").first().click();
    await expect(editor.getByRole("tab", { exact: true, name: "Conteúdo" })).toHaveAttribute("aria-selected", "true");
    await expect(editor.locator("[data-free-selection]")).toHaveAttribute("data-free-selection", "botao");
    await expect(paraOndeLeva.getByRole("radio", { checked: true })).toBeFocused();
    await expect(editor.getByText(SEM_DESTINO, { exact: true }).first()).toBeVisible();
  });

  await test.step("“Salvar rascunho” de dentro do editor abre o Revisar com o item (sem a faixa de erro solta)", async () => {
    await editor.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(editor.getByRole("heading", { exact: true, name: "Revisar" })).toBeFocused();
    await expect(itens).toHaveCount(1);
    await expect(itemDoDestino).toContainText(SEM_DESTINO);
    await expect(editor.locator("[data-free-banner]")).toHaveCount(0);
    expect(await lerAviso(), "nada foi gravado").toBeNull();
  });

  await test.step("mudar o texto do botão não apaga o item: o destino continua vazio", async () => {
    await itemDoDestino.getByRole("button").first().click();
    await expect(paraOndeLeva.getByRole("radio", { checked: true })).toBeFocused();
    await editor.locator("#livre-botao-botao-texto").fill(BOTAO);
    await expect(editor.locator("#livre-botao-botao-texto")).toHaveValue(BOTAO);
    await editor.getByRole("button", { exact: true, name: "Revisar (1 item)" }).click();
    await expect(itens).toHaveCount(1);
    await expect(itemDoDestino).toContainText(SEM_DESTINO);
  });

  await test.step("escolhida a página, o item some, o salvar passa e o card fica sem problema", async () => {
    await itemDoDestino.getByRole("button").first().click();
    await expect(paraOndeLeva.getByRole("radio", { checked: true })).toBeFocused();
    await paraOndeLeva.getByText("Página da área", { exact: true }).click();
    await editor.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
    await expect(editor.getByText(SEM_DESTINO, { exact: true })).toHaveCount(0);

    await editor.getByRole("button", { exact: true, name: "Revisar" }).click();
    await expect(editor.getByText("Tudo certo por aqui.", { exact: true })).toBeVisible();
    await expect(itens).toHaveCount(0);

    await editor.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);
    await editor.getByRole("button", { name: "Concluir e voltar ao aviso" }).click();
    await expect(editor).toHaveCount(0);
    await expect(design.getByText(/problemas? para revisar/)).toHaveCount(0);

    const gravado = await lerAviso();
    expect(gravado?.popup_design?.mode).toBe("free");
    expect(gravado?.cta_href).toBe("/minhas-compras");
    expect(gravado?.cta_label).toBe(BOTAO);
  });
});
