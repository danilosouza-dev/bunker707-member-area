import type { Locator, Page } from "@playwright/test";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";
import { popupStarterDesign } from "../../src/server/communications/popup-design-model";
import { emptyNoticeDraft } from "../../src/server/communications/schemas";
import { templatePayloadOfDraft, type TemplatePayload } from "../../src/server/communications/template-model";
import {
  avisoNoBanco,
  criarModeloNoBanco,
  expect,
  idDoAviso,
  idDoFluxo,
  idsDosPassosDoFluxo,
  modeloNoBanco,
  modelosUsadosNoAviso,
  segmentoDoAviso,
  test,
  versaoDoAviso,
  zerarComunicacao,
  zerarProgressoDosAlunos
} from "./fixtures";
import { prepararMidiaDoDesign, publicarPopUpComDesign } from "./popup-design-fixtures";

// Modelos de notificacao e de pop-up (docs/28 §7.3; docs/18 §3.1). 1. O produtor monta uma notificacao (titulo,
// texto, icone, 1 dia no sino, uma regra de produto em "Para quem" e uma notificacao seguinte) e clica em "Salvar
// como modelo" sem salvar o aviso; na aba Modelos, ⋯ > Usar abre /avisos/novo?modelo= preenchido e o "Salvar
// rascunho" grava o aviso, com o fluxo das seguintes em ids novos. 2. Um pop-up Personalizado com video e botao
// vira modelo pelo ⋯ da lista com "Levar o conteúdo" desligado; o pop-up e excluido; o modelo e editado (so
// "Quantas vezes"; o conteudo continua de fora) e o "Novo aviso" vira menu: o pop-up feito do modelo abre com o
// design e o video, pede o destino do botao (cuidado e) e grava sem conferir o video de novo (template_used). 3.
// Duas abas no mesmo modelo: a segunda recebe o 409 "Este modelo mudou em outra tela", Recarregar traz o nome novo
// e mantem a mudanca dela (rebase) e o salvar seguinte grava. 4. Um modelo com o design que nao abre (D29): o
// primeiro "Salvar modelo" pergunta "Salvar o modelo assim?", Cancelar nao grava, salvar grava o Padrao no lugar e o
// salvar seguinte nao pergunta mais. 5. Num pop-up no ar com uma mudanca sem salvar, Ctrl+Enter (e ⌘+Enter) no nome
// do "Salvar como modelo" e do "Salvar design como modelo" nao grava o pop-up por tras do dialogo (os alunos veriam
// na hora, contra a D11); Enter salva o modelo com o que esta na tela; fora dos dialogos, Ctrl+Enter salva o pop-up.
// No modo modelo do pop-up sem o conteudo, o botao principal so tem o texto ("O destino do botão é escolhido em cada
// aviso.") e nenhuma nota do "Usar" aparece; o banner de erro do "Salvar modelo" diz "Não foi possível salvar o modelo".

const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const TITULO = "Modelo E2E: aula ao vivo na quinta";
const TEXTO = "A aula ao vivo de quinta vai tirar as dúvidas do módulo 2.";
const SEGUINTE = "Modelo E2E: a aula ao vivo começa em 1 hora";
const POPUP = "Modelo E2E: pop-up com vídeo";
const BOTAO = "Quero ver";
const POPUP_DO_MODELO = "Modelo E2E: pop-up feito do modelo";
const NOME_NOVO = "Modelo E2E: pop-up com vídeo (revisado)";
const QUEBRADO = "Modelo E2E: pop-up com o design que não abre";
const DESTINO_POR_AVISO = "O destino do botão é escolhido em cada aviso.";
const NO_AR = "Modelo E2E: pop-up no ar";
const NO_AR_MUDADO = "Modelo E2E: pop-up no ar (mudança sem salvar)";
const MODELO_DO_NO_AR = "Modelo E2E: modelo do pop-up no ar";
const DESIGN_DO_NO_AR = "Modelo E2E: design do pop-up no ar";

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComunicacao();
});
test.afterAll(zerarComunicacao);

/** O card do editor pelo titulo (SectionCard = region com nome). */
function card(page: Page, titulo: string) {
  return page.getByRole("region", { exact: true, name: titulo });
}

/** Abre o ⋯ de uma linha (clica de novo ate o menu abrir: o primeiro clique pode chegar antes da hidratacao). */
async function abrirMenu(page: Page, linha: Locator, nome: string) {
  const itens = page.getByRole("menuitem");
  await expect(async () => {
    if ((await itens.count()) === 0) {
      await linha.getByRole("button", { exact: true, name: `Ações de ${nome}` }).click();
    }
    await expect(itens.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  return itens;
}

/** Clica ate o alvo aparecer (o primeiro clique logo depois de abrir a pagina pode chegar antes da hidratacao). */
async function clicarAte(alvo: Locator, aparece: Locator) {
  await expect(async () => {
    if (!(await aparece.isVisible())) {
      await alvo.click();
    }
    await expect(aparece).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Marca um radio clicando no rotulo ate ele ficar marcado (o mesmo cuidado da hidratacao). */
async function marcarAte(rotulo: Locator, radio: Locator) {
  await expect(async () => {
    if (!(await radio.isChecked())) {
      await rotulo.click();
    }
    await expect(radio).toBeChecked({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** A linha da aba Modelos pelo nome exato. */
function linhaDoModelo(page: Page, nome: string) {
  return page.getByRole("row").filter({ has: page.getByText(nome, { exact: true }) });
}

test("notificação: salvar como modelo no editor e usar pela aba Modelos", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin/comunicacao/avisos/novo");
  await page.waitForLoadState("networkidle");

  await test.step("monta a notificação: título, texto, ícone, 1 dia no sino, uma regra de produto e uma seguinte", async () => {
    await page.getByLabel("Título", { exact: true }).fill(TITULO);
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(TITULO);
    await page.getByLabel("Texto (opcional)", { exact: true }).fill(TEXTO);
    await expect(page.getByLabel("Texto (opcional)", { exact: true })).toHaveValue(TEXTO);
    await page.getByRole("radiogroup", { name: "Ícone ao lado do título" }).getByRole("radio", { name: "Promoção" }).click();
    await page.getByRole("radiogroup", { name: "Fica no sino por" }).getByText("1 dia", { exact: true }).click();
    await expect(page.getByRole("radiogroup", { name: "Fica no sino por" }).getByRole("radio", { name: "1 dia" })).toBeChecked();

    await page.getByRole("radiogroup", { exact: true, name: "Para quem" }).getByText("Escolher por regras", { exact: true }).click();
    const produtos = page.getByRole("group", { exact: true, name: "Produtos" }).first();
    await produtos.getByText(ESCOLA_DE_TESTE.curso.titulo, { exact: true }).click();
    await expect(produtos.getByRole("checkbox", { name: new RegExp(ESCOLA_DE_TESTE.curso.titulo) })).toBeChecked();

    await page.getByRole("button", { name: "Adicionar notificação seguinte" }).click();
    const folha = page.getByRole("dialog", { name: "Notificação seguinte 1" });
    await expect(folha).toBeVisible();
    await folha.getByLabel("Título", { exact: true }).fill(SEGUINTE);
    await expect(folha.getByLabel("Título", { exact: true })).toHaveValue(SEGUINTE);
    await folha.getByRole("button", { name: "Concluir" }).click();
    await expect(folha).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Notificação seguinte 1" }).getByText(SEGUINTE)).toBeVisible();
  });

  await test.step("Salvar como modelo: o nome é o título, as três chaves ligadas, e o aviso continua sem salvar", async () => {
    const abrir = page.getByRole("button", { exact: true, name: "Salvar como modelo" });
    await abrir.click();
    const dialogo = page.getByRole("dialog", { name: "Salvar como modelo" });
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Um modelo de notificação guarda a configuração para começar outro aviso pronto. Data e hora de envio não vão.");
    await expect(dialogo.getByLabel("Nome do modelo", { exact: true })).toHaveValue(TITULO);
    await expect(dialogo.getByRole("switch", { name: "Levar o conteúdo" })).toBeChecked();
    await expect(dialogo.getByRole("switch", { name: "Levar o segmento" })).toBeChecked();
    await expect(dialogo.getByRole("switch", { name: "Levar as notificações seguintes (1)" })).toBeChecked();
    await dialogo.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(page.getByText(/^Modelo salvo em Comunicação › Modelos\./)).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    // O dialogo devolve o foco ao botao que o abriu; o aviso nao foi gravado (a pagina continua em /novo).
    await expect(abrir).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/novo$/);
  });

  const modelo = await modeloNoBanco(TITULO);
  expect(modelo.kind).toBe("inbox");
  expect(modelo.design_mode).toBeNull();
  expect(modelo.payload).toMatchObject({
    audience: { kind: "rules" },
    content: { body: TEXTO, title: TITULO },
    settings: { validity: { minutes: 1_440, mode: "duration" } },
    version: 1
  });
  const seguintesDoModelo = (modelo.payload.followUps as { entryId: string; items: { id: string }[] }).items;
  expect(seguintesDoModelo).toHaveLength(1);
  expect(JSON.stringify(modelo.payload)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);

  await test.step("na aba Modelos, ⋯ > Usar abre o aviso novo preenchido, sem salvar nada", async () => {
    // Sair do editor com mudanca pede confirmacao (useWarnBeforeUnload): aceita.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin/comunicacao/modelos");
    await page.waitForLoadState("networkidle");
    const linha = linhaDoModelo(page, TITULO);
    await expect(linha).toContainText("Notificação");
    await expect(linha).toContainText("Leva conteúdo, segmento e 1 notificação seguinte");
    await abrirMenu(page, linha, TITULO);
    await page.getByRole("menuitem", { exact: true, name: "Usar" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/avisos/novo\\?modelo=${modelo.id}$`));
    await expect(page.getByText(`Você começou do modelo “${TITULO}”. Nada foi salvo ainda.`, { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(TITULO);
    await expect(page.getByLabel("Texto (opcional)", { exact: true })).toHaveValue(TEXTO);
    await expect(page.getByRole("radiogroup", { name: "Fica no sino por" }).getByRole("radio", { name: "1 dia" })).toBeChecked();
    await expect(page.getByRole("radiogroup", { exact: true, name: "Para quem" }).getByRole("radio", { name: "Escolher por regras" })).toBeChecked();
    await expect(page.getByRole("group", { exact: true, name: "Produtos" }).first().getByRole("checkbox", { name: new RegExp(ESCOLA_DE_TESTE.curso.titulo) })).toBeChecked();
    await expect(page.getByRole("article", { name: "Notificação seguinte 1" }).getByText(SEGUINTE)).toBeVisible();
  });

  await test.step("Salvar rascunho grava o aviso, e o fluxo das seguintes tem ids diferentes dos do modelo", async () => {
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();

    expect((await avisoNoBanco(TITULO)).validity_minutes).toBe(1_440);
    expect(await segmentoDoAviso(TITULO)).toMatchObject({ kind: "rules", root: { items: [{ productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }] } });
    const passos = await idsDosPassosDoFluxo(await idDoFluxo({ aviso: TITULO }));
    expect(passos.length).toBeGreaterThanOrEqual(1);
    const doModelo = new Set([...seguintesDoModelo.map((item) => item.id), (modelo.payload.followUps as { entryId: string }).entryId]);
    expect(passos.filter((id) => doModelo.has(id))).toEqual([]);
    const usados = await modelosUsadosNoAviso(await idDoAviso(TITULO));
    expect(usados.map((linha) => linha.metadata)).toEqual([{ created: true, template_ids: [modelo.id] }]);
  });
});

test("pop-up: salvar pelo ⋯ da lista, excluir o pop-up, editar o modelo e usar pelo Novo aviso", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const midia = await prepararMidiaDoDesign();
  await publicarPopUpComDesign(browser, {
    botao: { href: "/minhas-compras", label: BOTAO },
    design: popupStarterDesign("media_top_fade", { video: midia.video }),
    imagem: midia.capa,
    titulo: POPUP
  });

  await test.step("⋯ da lista > Salvar como modelo, com Levar o conteúdo desligado", async () => {
    await page.goto("/admin/comunicacao/avisos");
    await page.waitForLoadState("networkidle");
    const linha = page.getByRole("row").filter({ hasText: POPUP });
    await abrirMenu(page, linha, POPUP);
    await page.getByRole("menuitem", { exact: true, name: "Salvar como modelo" }).click();
    const dialogo = page.getByRole("dialog", { name: "Salvar como modelo" });
    await expect(dialogo).toContainText("Um modelo de pop-up guarda onde, quando, quantas vezes e o design. Data de início e fim não vão.");
    await expect(dialogo.getByLabel("Nome do modelo", { exact: true })).toHaveValue(POPUP);
    await expect(dialogo.getByRole("switch", { name: "Levar as notificações seguintes" })).toHaveCount(0);
    const conteudo = dialogo.getByRole("switch", { name: "Levar o conteúdo" });
    await conteudo.click();
    await expect(conteudo).not.toBeChecked();
    await dialogo.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(page.getByText(/^Modelo salvo em Comunicação › Modelos\./)).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    // O foco volta ao ⋯ da linha (cuidado c).
    await expect(linha.getByRole("button", { exact: true, name: `Ações de ${POPUP}` })).toBeFocused();
  });

  const salvo = await modeloNoBanco(POPUP);
  expect(salvo.kind).toBe("popup");
  expect(salvo.design_mode).toBe("custom");
  expect(salvo.payload.content).toBeNull();
  expect(salvo.payload.designSupport).toEqual({ ctaLabel: BOTAO, image: { alt: "", url: midia.capa.url } });
  expect((salvo.payload.design as { media: { video: { path: string } } }).media.video.path).toBe(midia.video.path);

  await test.step("exclui o pop-up pelo ⋯", async () => {
    const linha = page.getByRole("row").filter({ hasText: POPUP });
    await abrirMenu(page, linha, POPUP);
    await page.getByRole("menuitem", { exact: true, name: "Excluir" }).click();
    const confirmar = page.getByRole("alertdialog", { name: `Excluir “${POPUP}”?` }).or(page.getByRole("dialog", { name: `Excluir “${POPUP}”?` }));
    await confirmar.getByRole("button", { exact: true, name: "Excluir pop-up" }).click();
    await expect(page.getByRole("row").filter({ hasText: POPUP })).toHaveCount(0);
  });

  await test.step("Modelos > Editar: modo modelo sem envio, sem janela e com Levar o conteúdo desligado", async () => {
    await page.goto("/admin/comunicacao/modelos");
    await page.waitForLoadState("networkidle");
    await abrirMenu(page, linhaDoModelo(page, POPUP), POPUP);
    await page.getByRole("menuitem", { exact: true, name: "Editar" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/modelos/${salvo.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: `Modelo: ${POPUP}` })).toBeVisible();
    await page.waitForLoadState("networkidle");

    for (const nome of ["Enviar teste para mim", "Publicar pop-up", "Publicar", "Salvar rascunho", "Salvar como modelo"]) {
      await expect(page.getByRole("button", { exact: true, name: nome })).toHaveCount(0);
    }
    await expect(page.getByText("Começa", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Termina", { exact: true })).toHaveCount(0);
    const modelo = card(page, "Modelo");
    await expect(modelo.getByLabel("Nome do modelo", { exact: true })).toHaveValue(POPUP);
    await expect(modelo.getByRole("switch", { name: "Levar o conteúdo" })).not.toBeChecked();
    await expect(modelo.getByRole("switch", { name: "Levar o segmento" })).toBeChecked();
    await expect(page.getByText("O conteúdo não vai neste modelo. Ligue “Levar o conteúdo” no card Modelo para guardar o que está aqui.", { exact: true })).toBeVisible();
    await expect(page.getByText("Prévia do modelo: os alunos nunca veem um modelo.", { exact: true })).toBeVisible();
  });

  await test.step("sem o conteúdo, o botão principal só tem o texto e nenhuma nota do Usar pede o destino", async () => {
    // A nota do "Usar" (o botao ganhou o texto, escolha o destino) nao aparece: o destino nao iria para o modelo.
    await expect(page.getByText(/O botão principal ganhou o texto/)).toHaveCount(0);
    const design = card(page, "Design");
    const soOTexto = design.getByText(DESTINO_POR_AVISO, { exact: true });
    await clicarAte(design.getByRole("button", { name: "Editar o bloco Botão principal" }), soOTexto);
    await expect(design.locator("#aviso-botao-texto")).toHaveValue(BOTAO);
    await expect(design.getByRole("radiogroup", { name: "Para onde o botão leva" })).toHaveCount(0);

    // Com "Levar o conteúdo" ligado, o destino vai junto e aparece; desligado de novo, some.
    const conteudo = card(page, "Modelo").getByRole("switch", { name: "Levar o conteúdo" });
    await conteudo.click();
    await expect(conteudo).toBeChecked();
    await expect(design.getByRole("radiogroup", { name: "Para onde o botão leva" })).toBeVisible();
    await expect(soOTexto).toHaveCount(0);
    await conteudo.click();
    await expect(conteudo).not.toBeChecked();
    await expect(soOTexto).toBeVisible();
    await expect(design.getByRole("radiogroup", { name: "Para onde o botão leva" })).toHaveCount(0);
  });

  await test.step("o banner de erro do Salvar modelo fala do modelo, nunca do aviso", async () => {
    const nome = card(page, "Modelo").getByLabel("Nome do modelo", { exact: true });
    await nome.fill("");
    await expect(nome).toHaveValue("");
    await page.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    const banner = page.getByRole("alert").filter({ hasText: "Revise os campos destacados." });
    await expect(banner).toContainText("Não foi possível salvar o modelo");
    await expect(banner).not.toContainText("aviso");
    await expect(card(page, "Modelo").getByText("Dê um nome ao modelo.", { exact: true })).toBeVisible();
    await nome.fill(POPUP);
    await expect(nome).toHaveValue(POPUP);
    await expect(banner).toHaveCount(0);
  });

  await test.step("muda Quantas vezes e salva: a janela nunca vai e o conteúdo continua de fora", async () => {
    const vezes = card(page, "Quantas vezes e como fecha");
    await marcarAte(vezes.getByRole("radiogroup", { name: "Quantas vezes o pop-up aparece" }).getByText("Mais de uma vez", { exact: true }), vezes.getByRole("radio", { name: "Mais de uma vez" }));
    await page.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(page.getByText("Modelo salvo.", { exact: true })).toBeVisible();

    const editado = await modeloNoBanco(POPUP);
    expect((editado.payload.settings as { popup: { frequency: { mode: string } } }).popup.frequency.mode).not.toBe("once");
    expect(JSON.stringify(editado.payload)).not.toMatch(/"window"|"startsAt"|"endsAt"|\d{4}-\d{2}-\d{2}T/);
    expect(editado.payload.content).toBeNull();
    expect(editado.payload.designSupport).toEqual(salvo.payload.designSupport);
    expect(editado.updated_at).not.toBe(salvo.updated_at);
  });

  await test.step("Novo aviso vira menu: o pop-up feito do modelo abre com o design e o vídeo, pede o destino e grava", async () => {
    await page.goto("/admin/comunicacao/avisos");
    await page.waitForLoadState("networkidle");
    const itens = page.getByRole("menuitem");
    await expect(async () => {
      if ((await itens.count()) === 0) {
        await page.getByRole("button", { name: "Novo aviso" }).click();
      }
      await expect(itens.first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("menuitem", { exact: true, name: "Começar em branco" })).toHaveAttribute("href", "/admin/comunicacao/avisos/novo");
    await expect(page.getByRole("menuitem", { name: /^Ver todos os modelos \(\d+\)$/ })).toBeVisible();
    await page.getByRole("menuitem", { name: new RegExp(`^${POPUP.replace(/[()]/g, "\\$&")}`) }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/avisos/novo\\?modelo=${salvo.id}$`));
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("radio", { exact: true, name: "Pop-up" })).toBeChecked();
    const design = card(page, "Design");
    await expect(design.getByRole("radio", { name: "Personalizado" })).toBeChecked();
    const midiaDoDesign = card(page, "Mídia");
    await expect(midiaDoDesign.getByRole("radio", { exact: true, name: "Vídeo" })).toBeChecked();
    await expect(midiaDoDesign.getByText("Vídeo enviado", { exact: true })).toBeVisible();

    // Cuidado (e): sem conteudo, o botao do design abre com o texto do modelo e o destino vazio; o salvar recusa.
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page.getByText("Escolha para onde o botão leva.", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/avisos\/novo\?modelo=/);

    const destino = page.getByRole("radiogroup", { name: "Para onde o botão leva" }).first();
    await destino.getByText("Página da área", { exact: true }).click();
    await page.getByRole("radiogroup", { name: "Página da área do aluno" }).first().getByText("Minhas compras", { exact: true }).click();
    const nome = page.getByLabel("Nome do pop-up", { exact: true });
    await nome.fill(POPUP_DO_MODELO);
    await expect(nome).toHaveValue(POPUP_DO_MODELO);
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);

    const avisoId = await idDoAviso(POPUP_DO_MODELO);
    const usados = await modelosUsadosNoAviso(avisoId);
    expect(usados.map((linha) => linha.metadata)).toEqual([{ created: true, template_ids: [salvo.id] }]);
  });
});

test("duas abas no mesmo modelo: a segunda recebe o 409 e Recarregar faz o rebase", async ({ context, page }) => {
  test.setTimeout(120_000);
  const modelo = await modeloNoBanco(POPUP);
  const endereco = `/admin/comunicacao/modelos/${modelo.id}`;
  const outra = await context.newPage();
  await page.goto(endereco);
  await outra.goto(endereco);
  await page.waitForLoadState("networkidle");
  await outra.waitForLoadState("networkidle");

  await test.step("a primeira aba muda o nome e salva", async () => {
    const nome = card(page, "Modelo").getByLabel("Nome do modelo", { exact: true });
    await nome.fill(NOME_NOVO);
    await expect(nome).toHaveValue(NOME_NOVO);
    await page.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(page.getByText("Modelo salvo.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: `Modelo: ${NOME_NOVO}` })).toBeVisible();
  });

  await test.step("a segunda aba muda Quantas vezes e recebe o banner do 409", async () => {
    const vezes = card(outra, "Quantas vezes e como fecha");
    await marcarAte(vezes.getByRole("radiogroup", { name: "Quantas vezes o pop-up aparece" }).getByText("Uma vez", { exact: true }), vezes.getByRole("radio", { exact: true, name: "Uma vez" }));
    await outra.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    const banner = outra.getByRole("alert").filter({ hasText: "Este modelo mudou em outra tela" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Este modelo mudou em outra tela há instantes. Recarregue a página para ver a versão atual.");

    await banner.getByRole("button", { exact: true, name: "Recarregar" }).click();
    await expect(card(outra, "Modelo").getByLabel("Nome do modelo", { exact: true })).toHaveValue(NOME_NOVO);
    await expect(outra.getByRole("heading", { level: 1, name: `Modelo: ${NOME_NOVO}` })).toBeVisible();
    await expect(card(outra, "Quantas vezes e como fecha").getByRole("radio", { exact: true, name: "Uma vez" })).toBeChecked();
  });

  await test.step("salva de novo e grava as duas mudanças", async () => {
    await outra.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(outra.getByText("Modelo salvo.", { exact: true })).toBeVisible();
    const gravado = await modeloNoBanco(NOME_NOVO);
    expect(gravado.id).toBe(modelo.id);
    expect((gravado.payload.settings as { popup: { frequency: { mode: string } } }).popup.frequency.mode).toBe("once");
    await outra.close();
  });
});

test("parte que não abriu (D29): o primeiro Salvar modelo pergunta, Cancelar não grava e o salvar seguinte não pergunta mais", async ({ page }) => {
  test.setTimeout(120_000);
  // Um pop-up Personalizado sem o conteudo, com o design gravado num formato que nao passa no schema (como o do
  // teste de integracao 9): abre no Padrao, com a nota de leitura.
  const valido = templatePayloadOfDraft({
    draft: { ...emptyNoticeDraft("popup"), cta: { display: "button", href: "/minhas-compras", label: BOTAO, target: "same_tab" }, design: popupStarterDesign("text_only") },
    followUps: null,
    include: { audience: true, content: false, followUps: false }
  }).payload;
  const id = await criarModeloNoBanco({ ...valido, design: { blocks: "quebrado" } } as unknown as TemplatePayload, QUEBRADO);
  const antes = await modeloNoBanco(QUEBRADO);
  const nota = page.getByText("O design guardado neste modelo não pôde ser lido e ficou no Padrão.", { exact: true });
  const salvar = card(page, "Revisão").getByRole("button", { exact: true, name: "Salvar modelo" });
  const pergunta = page.getByRole("alertdialog", { name: "Salvar o modelo assim?" }).or(page.getByRole("dialog", { name: "Salvar o modelo assim?" }));

  await page.goto(`/admin/comunicacao/modelos/${id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: `Modelo: ${QUEBRADO}` })).toBeVisible();
  await expect(nota).toBeVisible();

  await test.step("o primeiro Salvar modelo pergunta; Cancelar não grava", async () => {
    await clicarAte(salvar, pergunta);
    await expect(pergunta).toContainText("Uma parte deste modelo não pôde ser lida e voltou ao padrão. Ao salvar, o padrão fica no lugar dela.");
    await pergunta.getByRole("button", { exact: true, name: "Cancelar" }).click();
    await expect(pergunta).toHaveCount(0);
    expect((await modeloNoBanco(QUEBRADO)).updated_at).toBe(antes.updated_at);
  });

  await test.step("Salvar modelo na pergunta grava o Padrão no lugar do design que não abriu", async () => {
    await salvar.click();
    await expect(pergunta).toBeVisible();
    await pergunta.getByRole("button", { exact: true, name: "Salvar modelo" }).click();
    await expect(pergunta).toHaveCount(0);
    await expect(page.getByText("Modelo salvo.", { exact: true }).first()).toBeVisible();
    await expect(nota).toHaveCount(0);
    const salvo = await modeloNoBanco(QUEBRADO);
    expect(salvo.updated_at).not.toBe(antes.updated_at);
    expect(salvo.payload.design).toBeNull();
  });

  await test.step("o salvar seguinte não pergunta mais", async () => {
    const primeiro = (await modeloNoBanco(QUEBRADO)).updated_at;
    await salvar.click();
    await expect.poll(async () => (await modeloNoBanco(QUEBRADO)).updated_at, { timeout: 10_000 }).not.toBe(primeiro);
    await expect(pergunta).toHaveCount(0);
  });
});

test("Ctrl+Enter nos diálogos de modelo de um pop-up no ar não salva o pop-up por trás deles", async ({ browser, page }) => {
  test.setTimeout(120_000);
  // Sair do editor com mudanca pede confirmacao (useWarnBeforeUnload): aceita, para uma falha nao travar o teste.
  page.on("dialog", (dialog) => void dialog.accept());
  const id = await publicarPopUpComDesign(browser, {
    botao: { href: "/minhas-compras", label: BOTAO },
    design: popupStarterDesign("text_only"),
    texto: "",
    titulo: NO_AR
  });
  const antes = await versaoDoAviso(id);
  const editor = new RegExp(`/admin/comunicacao/avisos/${id}\\?editar=1$`);

  await page.goto(`/admin/comunicacao/avisos/${id}?editar=1`);
  await page.waitForLoadState("networkidle");
  const nomeDoPopUp = page.getByLabel("Nome do pop-up", { exact: true });
  await nomeDoPopUp.fill(NO_AR_MUDADO);
  await expect(nomeDoPopUp).toHaveValue(NO_AR_MUDADO);

  await test.step("Salvar como modelo: Ctrl+Enter e ⌘+Enter no nome não gravam o pop-up; Enter salva o modelo", async () => {
    const abrir = page.getByRole("button", { exact: true, name: "Salvar como modelo" });
    const dialogo = page.getByRole("dialog", { name: "Salvar como modelo" });
    await clicarAte(abrir, dialogo);
    const nome = dialogo.getByLabel("Nome do modelo", { exact: true });
    await nome.fill(MODELO_DO_NO_AR);
    await expect(nome).toHaveValue(MODELO_DO_NO_AR);
    await expect(nome).toBeFocused();
    await nome.press("Control+Enter");
    await nome.press("Meta+Enter");
    await expect(dialogo).toBeVisible();
    // Enter envia o formulario do dialogo: o modelo leva o que esta na tela (D11) e o pop-up fica como estava.
    await nome.press("Enter");
    await expect(page.getByText(/^Modelo salvo em Comunicação › Modelos\./)).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    await expect(page).toHaveURL(editor);
    await expect(page.getByText(/^Pop-up atualizado\./)).toHaveCount(0);
    expect(await versaoDoAviso(id)).toEqual(antes);
    expect((await modeloNoBanco(MODELO_DO_NO_AR)).payload.content).toMatchObject({ title: NO_AR_MUDADO });
  });

  await test.step("Salvar design como modelo: Ctrl+Enter no nome não grava o pop-up; Enter salva o design", async () => {
    const abrir = card(page, "Design").getByRole("button", { exact: true, name: "Salvar design como modelo" });
    const dialogo = page.getByRole("dialog", { name: "Salvar design como modelo" });
    await clicarAte(abrir, dialogo);
    const nome = dialogo.getByLabel("Nome do modelo", { exact: true });
    await nome.fill(DESIGN_DO_NO_AR);
    await expect(nome).toHaveValue(DESIGN_DO_NO_AR);
    await expect(nome).toBeFocused();
    await nome.press("Control+Enter");
    await expect(dialogo).toBeVisible();
    await nome.press("Enter");
    await expect(page.getByText("Design salvo em Meus modelos.", { exact: true })).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    await expect(page).toHaveURL(editor);
    await expect(page.getByText(/^Pop-up atualizado\./)).toHaveCount(0);
    expect(await versaoDoAviso(id)).toEqual(antes);
    expect((await modeloNoBanco(DESIGN_DO_NO_AR)).kind).toBe("design");
  });

  await test.step("fora dos diálogos, Ctrl+Enter continua salvando o pop-up no ar", async () => {
    await nomeDoPopUp.focus();
    await expect(nomeDoPopUp).toBeFocused();
    await nomeDoPopUp.press("Control+Enter");
    await expect(page.getByText(/^Pop-up atualizado\./)).toBeVisible();
    await expect.poll(async () => (await versaoDoAviso(id)).title, { timeout: 10_000 }).toBe(NO_AR_MUDADO);
  });
});
