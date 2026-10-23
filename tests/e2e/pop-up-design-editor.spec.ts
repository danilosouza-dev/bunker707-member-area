import type { Page } from "@playwright/test";
import { expect, test, zerarComunicacao } from "./fixtures";

// O produtor monta o "Design do pop-up" no editor (docs/26; spec §7.3; docs/18 §3.1): Novo aviso > Pop-up >
// Design > Personalizado > "Mídia no topo com degradê"; o conteudo vira "Nome do pop-up" e esconde texto, icone,
// imagem e destino; envia o video (vai direto ao Storage e um quadro dele vira a capa); muda a cor da linha 1
// do titulo; deixa o texto com pouco contraste e ve a dica; acrescenta o Segundo botão "Fechar"; envia uma fonte
// (woff2 de teste pela rota) e usa no titulo; salvar sem o destino do botao foca o campo; escolhe o destino,
// salva, reabre e confere; a previa mostra celular e computador; publica.

const TITULO = "Pop-up E2E: design personalizado";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const FIXTURES = "tests/fixtures/popup-design";

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

function card(page: Page, titulo: string) {
  return page.getByRole("region", { exact: true, name: titulo });
}

test("monta o design personalizado, salva, reabre e publica", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título", { exact: true }).fill(TITULO);

  const design = card(page, "Design");
  await expect(design.getByRole("radio", { name: "Padrão" })).toBeChecked();
  await design.getByText("Personalizado", { exact: true }).click();
  await expect(design.getByText("Começar de um modelo", { exact: true })).toBeVisible();
  await design.getByRole("button", { name: "Usar este modelo: Mídia no topo com degradê" }).click();

  // No Personalizado, o titulo vira o nome; texto, icone, imagem e destino saem do conteudo.
  await expect(page.getByLabel("Nome do pop-up", { exact: true })).toHaveValue(TITULO);
  await expect(page.getByText("Aparece nas listas e nos relatórios. Para o aluno, vale o título do design.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Texto (opcional)", { exact: true })).toHaveCount(0);
  await expect(card(page, "Para onde leva")).toHaveCount(0);

  // Video: sem imagem, um quadro dele vira a capa.
  await design.getByRole("radiogroup", { name: "Mídia do pop-up" }).getByText("Vídeo", { exact: true }).click();
  await design.locator('input[type="file"][accept="video/mp4,video/webm"]').setInputFiles(`${FIXTURES}/video-de-teste.mp4`);
  await expect(design.getByText("Vídeo enviado", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(design.getByRole("button", { name: "Trocar imagem" })).toBeVisible({ timeout: 30_000 });

  // Cor da linha 1 do titulo.
  await design.getByRole("button", { name: "Editar o bloco Título" }).click();
  await design.getByLabel("Cor da linha 1", { exact: true }).fill("#ff9f1c");

  // Texto com pouco contraste: a dica aparece (nao impede salvar).
  await design.getByRole("button", { name: "Editar o bloco Texto" }).click();
  await design.locator("#popup-design-bloco-2-estilo-cor-cor").fill("#3a3a3a");
  await expect(design.getByText(/^Contraste baixo \(1,\d:1\)\. Para ler bem, use pelo menos 4,5:1\.$/)).toBeVisible();

  // Segundo botão "Fechar" no fim.
  await design.getByRole("group", { name: "Adicionar bloco" }).getByRole("button", { exact: true, name: "Segundo botão" }).click();
  await expect(design.getByText("Agora não · Fechar", { exact: true })).toBeVisible();

  // Fonte enviada pela rota e usada no titulo.
  await design.getByRole("button", { exact: true, name: "Enviar fonte" }).click();
  const dialogo = page.getByRole("dialog", { name: "Enviar fonte" });
  await dialogo.locator('input[type="file"]').setInputFiles(`${FIXTURES}/fonte-de-teste.woff2`);
  await expect(dialogo.getByLabel("Nome", { exact: true })).toHaveValue("fonte de teste");
  await dialogo.getByRole("button", { exact: true, name: "Enviar" }).click();
  await expect(dialogo).toBeHidden({ timeout: 30_000 });
  await expect(card(page, "Design").getByText("Normal (400) · Normal · 5 KB", { exact: true })).toBeVisible();
  await design.getByRole("button", { name: "Editar o bloco Título" }).click();
  await design.locator("#popup-design-bloco-1-estilo-fonte").click();
  await page.getByRole("option", { exact: true, name: "fonte de teste" }).click();
  await expect(design.locator("#popup-design-bloco-1-estilo-fonte")).toContainText("fonte de teste");

  // Sem o destino do botao "Saiba mais" do modelo: salvar recusa e foca o campo do destino no bloco.
  await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
  await expect(page.getByText("Revise os campos destacados.", { exact: true })).toBeVisible();
  await expect(page.locator("#aviso-botao-produto")).toBeFocused();

  await design.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Página da área", { exact: true }).click();
  await design.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
  await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // Reabre: tudo como foi salvo.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const reaberto = card(page, "Design");
  await expect(reaberto.getByRole("radio", { name: "Personalizado" })).toBeChecked();
  await expect(reaberto.getByText("Vídeo enviado", { exact: true })).toBeVisible();
  await expect(reaberto.getByText("Agora não · Fechar", { exact: true })).toBeVisible();
  await reaberto.getByRole("button", { name: "Editar o bloco Título" }).click();
  await expect(reaberto.getByLabel("Cor da linha 1", { exact: true })).toHaveValue("#ff9f1c");
  await expect(reaberto.locator("#popup-design-bloco-1-estilo-fonte")).toContainText("fonte de teste");

  // Previa: celular e computador juntos, sem a escolha do aparelho.
  const previa = page.getByRole("region", { exact: true, name: "Prévia" });
  await expect(previa.getByRole("figure", { name: "Prévia do pop-up no celular" })).toBeVisible();
  await expect(previa.getByRole("figure", { name: "Prévia do pop-up no computador" })).toBeVisible();
  await expect(previa.getByRole("radiogroup", { name: "Aparelho da prévia" })).toHaveCount(0);
  await expect(previa.getByText("Já disponível").first()).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
  await expect(page.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });
});
