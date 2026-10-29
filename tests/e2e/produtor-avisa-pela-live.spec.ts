import { ESCOLA_DE_TESTE, WEBINARIO_DE_TESTE, limparWebinarios, seedWebinarioDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { expect, segmentoDoAviso, test, zerarComunicacao } from "./fixtures";

// Avisar › Aviso no sino e Pop-up (docs/30 §2.2; docs/28 D5; docs/18 §3.1): no webinario de teste publicado para "Quem
// tem o produto" (o curso da escola), o card Avisar leva o Aviso no sino a /admin/comunicacao/avisos/novo?webinario=
// &tipo=notificacao e o Pop-up ao mesmo endereco com tipo=popup. O editor do aviso abre com a nota de inicio, o titulo
// "Live: {nome}", o texto com a data, o botao "Ver a live" para a pagina do webinario e o "Para quem" com a regra do
// produto; nada e gravado ate "Salvar rascunho", que grava o aviso com o segmento traduzido.

const { id, slug, titulo } = WEBINARIO_DE_TESTE;
const TITULO_DO_AVISO = `Live: ${titulo}`;
const NOTA = `Você começou pelo webinário “${titulo}”. Nada foi salvo ainda.`;

test.describe.configure({ mode: "serial" });
test.use({ storageState: "tests/e2e/.auth/produtor.json", viewport: { height: 900, width: 1440 } });

/** Avisos com o titulo do atalho (fora de fluxo, nao excluidos). */
async function avisosDoAtalho() {
  const db = createLocalAdminClient();

  return unwrap(await db.from("campaigns").select("id,kind,cta_href,cta_label").eq("title", TITULO_DO_AVISO).is("flow_id", null).is("deleted_at", null), "Lendo os avisos do atalho") as {
    cta_href: string | null;
    cta_label: string | null;
    id: string;
    kind: string;
  }[];
}

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await zerarComunicacao();
  await limparWebinarios(db);
  await seedWebinarioDeTeste(db);
  // Quem pode: Quem tem o produto (o curso da escola de teste).
  unwrap(await db.from("webinars").update({ access_mode: "product", product_id: ESCOLA_DE_TESTE.curso.id }).eq("id", id), "Ligando o webinario de teste ao curso");
});

test.afterAll(async () => {
  await zerarComunicacao();
  await limparWebinarios(createLocalAdminClient());
});

test("Avisar › Aviso no sino abre o aviso preenchido (titulo, texto, botao e Para quem) e nada e gravado ate salvar", async ({ page }) => {
  await page.goto(`/admin/comunicacao/webinarios/${id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();

  const avisar = page.getByRole("region", { exact: true, name: "Avisar" });
  const sino = avisar.getByRole("link", { name: "Aviso no sino" });
  const popup = avisar.getByRole("link", { exact: true, name: "Pop-up" });
  await expect(sino).toHaveAttribute("href", `/admin/comunicacao/avisos/novo?webinario=${id}&tipo=notificacao`);
  await expect(popup).toHaveAttribute("href", `/admin/comunicacao/avisos/novo?webinario=${id}&tipo=popup`);
  await expect(avisar.getByText("Fluxo · em breve")).toBeVisible();
  await expect(avisar.locator("[data-webinar-notify-blocked]")).toHaveCount(0);

  await sino.click();
  await expect(page).toHaveURL(new RegExp(`/admin/comunicacao/avisos/novo\\?webinario=${id}&tipo=notificacao$`));
  await expect(page.getByText(NOTA, { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await test.step("o editor abre preenchido: titulo, texto com a data, botao Ver a live e a regra do produto", async () => {
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(TITULO_DO_AVISO);
    await expect(page.getByLabel("Texto (opcional)", { exact: true })).toHaveValue(/ às \d{2}:\d{2}\. Garanta sua vaga na página da live\.$/);
    await expect(page.getByRole("radiogroup", { exact: true, name: "Para quem" }).getByRole("radio", { name: "Escolher por regras" })).toBeChecked();
    await expect(page.getByRole("group", { exact: true, name: "Produtos" }).first().getByRole("checkbox", { name: new RegExp(ESCOLA_DE_TESTE.curso.titulo) })).toBeChecked();
    await expect(page.getByRole("button", { exact: true, name: "Salvar rascunho" })).toBeEnabled();
  });

  await test.step("nada foi gravado: nenhum aviso com o titulo do atalho", async () => {
    expect(await avisosDoAtalho()).toEqual([]);
  });

  await test.step("Salvar rascunho grava o aviso com o segmento do webinario e o botao para a pagina dele", async () => {
    await page.getByRole("button", { exact: true, name: "Salvar rascunho" }).click();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/avisos\/[0-9a-f-]{36}$/);
    await expect(page.getByText(NOTA, { exact: true })).toHaveCount(0);

    await expect.poll(async () => (await avisosDoAtalho()).length).toBe(1);
    const [aviso] = await avisosDoAtalho();
    expect(aviso.kind).toBe("inbox");
    expect(aviso.cta_href).toBe(`/webinarios/${slug}?origem=sino`);
    expect(aviso.cta_label).toBe("Ver a live");
    expect(await segmentoDoAviso(TITULO_DO_AVISO)).toMatchObject({ kind: "rules", root: { items: [{ op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }] } });
  });
});
