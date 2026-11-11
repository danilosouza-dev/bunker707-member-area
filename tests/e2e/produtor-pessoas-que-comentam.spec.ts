import type { Locator, Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, expect, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test, zerarHistoricoDeWebinarios } from "./fixtures";

// As pessoas que comentam e a pergunta simulada, o caminho principal (pedido do produtor de 11/11/2026; docs/30 D75 a
// D78; docs/18 §3): com a live no ar (o Jitsi de mentira), o produtor abre o console, vai a entrada Roteiro e, sem sair
// do console, cria a pessoa na lista "Pessoas que comentam" (Nome, a Foto enviada pelo navegador, Aparece como Aluno).
// Pelo "Comentar como {nome}" manda um comentario, depois uma Pergunta (o Tipo) e mais um comentario como a mesma
// pessoa, sem digitar o nome de novo (o formulario fica aberto, com "Enviado."). A aluna, na sala da live, ve os dois
// comentarios no chat com o nome e a foto da pessoa, e a pergunta na aba Perguntas com a mesma foto.
//
// Escrito na rodada v8 e rodado por quem junta (as frentes nao rodam o Playwright).

const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
const PESSOAS = WEBINAR_COPY.pessoas;
const NOME = "Adriano Souza";
const PRIMEIRO = "Cheguei agora, que aula boa!";
const PERGUNTA = "Quanto tempo de acesso tem o curso?";
const SEGUNDO = "Anotando tudo aqui.";
const FOTO_NO_ENDERECO = /webinars(%2F|\/)personas(%2F|\/)[a-f0-9]{24}\.webp/;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** A entrada Roteiro do console (pelo trilho; se nao coube, pelo Mais). */
async function abrirRoteiro(page: Page): Promise<Locator> {
  const nome = WEBINAR_COPY.consoleV2.entradas.roteiro;
  const item = page.locator('[data-console-rail="roteiro"]');
  if (await item.isVisible()) {
    if ((await item.getAttribute("aria-expanded")) !== "true") {
      await item.click();
    }
  } else {
    await page.locator('[data-console-rail="mais"]').click();
    await page.getByRole("menuitemradio", { exact: true, name: nome }).click();
  }
  const secao = page.locator("section[data-console-more]").and(page.getByRole("group", { exact: true, name: nome }));
  await expect(secao).toBeVisible();
  return secao;
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("no console da live: cria a pessoa com foto, comenta, pergunta e comenta de novo como ela sem digitar o nome outra vez", async ({ browserName, page }) => {
    // O preparo da foto no navegador gera WebP pelo canvas, que o WebKit do Playwright nao faz: a foto passa pelo Chromium.
    test.skip(browserName === "webkit", "o WebKit nao gera WebP no canvas");
    await salaFalsaDoJitsi(page);
    await page.goto(CONSOLE);
    await page.waitForLoadState("networkidle");

    const roteiro = await abrirRoteiro(page);
    const lista = roteiro.locator("[data-persona-list]");
    await expect(lista.getByText(PESSOAS.vazia, { exact: true })).toBeVisible();
    await lista.getByRole("button", { exact: true, name: PESSOAS.novaPessoa }).click();
    const formulario = lista.locator('[data-persona-form="nova"]');
    await formulario.getByLabel(COMENTARIOS.nome, { exact: true }).fill(NOME);
    await formulario.getByLabel(COMENTARIOS.enviarFoto, { exact: true }).setInputFiles({ buffer: pngQuadrado(640), mimeType: "image/png", name: "rosto-gerado.png" });
    await expect(formulario.locator("[data-persona-photo-preview]")).toHaveAttribute("src", /\/storage\/v1\/object\/public\/content-assets\/webinars\/personas\/[a-f0-9]{24}\.webp$/);
    await formulario.getByRole("radio", { exact: true, name: COMENTARIOS.papeis.student }).check();
    await formulario.getByRole("button", { exact: true, name: PESSOAS.adicionarPessoa }).click();
    const pessoa = lista.locator("[data-persona]").filter({ hasText: NOME });
    await expect(pessoa).toBeVisible();
    await expect(pessoa.locator("img")).toHaveAttribute("src", FOTO_NO_ENDERECO);

    // Comentar como a pessoa: o Novo comentário abre com ela escolhida, sem o campo do Nome.
    await pessoa.getByRole("button", { exact: true, name: PESSOAS.comentarComo(NOME) }).click();
    const novo = page.locator("[data-console-script-comment]");
    await expect(novo.locator("[data-console-script-name]")).toHaveCount(0);
    await novo.getByLabel(PESSOAS.comentario, { exact: true }).fill(PRIMEIRO);
    await novo.getByRole("button", { exact: true, name: COMENTARIOS.enviarAgora }).click();
    await expect(novo.locator("[data-console-script-sent]")).toHaveText(PESSOAS.avisos.enviado);
    // O repetir: a mesma pessoa, o texto limpo e o foco nele.
    const texto = novo.locator("[data-console-script-body]");
    await expect(texto).toHaveValue("");
    await expect(texto).toBeFocused();

    await novo.getByRole("radio", { exact: true, name: PESSOAS.tipos.question }).check();
    await novo.getByLabel(PESSOAS.pergunta, { exact: true }).fill(PERGUNTA);
    await novo.getByRole("button", { exact: true, name: COMENTARIOS.enviarAgora }).click();
    await expect(page.getByText(PESSOAS.avisos.perguntaEnviada)).toBeVisible();
    await expect(texto).toHaveValue("");

    await novo.getByRole("radio", { exact: true, name: PESSOAS.tipos.message }).check();
    await novo.getByLabel(PESSOAS.comentario, { exact: true }).fill(SEGUNDO);
    await novo.getByRole("button", { exact: true, name: COMENTARIOS.enviarAgora }).click();
    await expect(novo.locator("[data-console-script-sent]")).toHaveText(PESSOAS.avisos.enviado);
    await page.locator("[data-console-script-back]").click();
    await expect(novo).toHaveCount(0);

    // No banco: os dois comentarios e a pergunta da mesma pessoa, com a foto dela; a pergunta sem aluno.
    const db = createLocalAdminClient();
    const pessoaNoBanco = unwrap(await db.from("webinar_personas").select("id, avatar_path, role").eq("webinar_id", id).eq("name", NOME).single(), "Lendo a pessoa");
    expect(pessoaNoBanco?.avatar_path).toMatch(/^webinars\/personas\/[a-f0-9]{24}\.webp$/);
    const comentarios = unwrap(await db.from("webinar_chat_messages").select("body, display_name, persona_avatar_path").eq("session_id", sessaoId).eq("source", "scripted").order("created_at"), "Lendo os comentarios");
    expect(comentarios?.map((row) => [row.body, row.display_name, row.persona_avatar_path])).toEqual([
      [PRIMEIRO, NOME, pessoaNoBanco?.avatar_path],
      [SEGUNDO, NOME, pessoaNoBanco?.avatar_path]
    ]);
    const pergunta = unwrap(await db.from("webinar_questions").select("user_id, source, persona_id, persona_avatar_path, display_name").eq("session_id", sessaoId).eq("body", PERGUNTA).single(), "Lendo a pergunta");
    expect([pergunta?.user_id, pergunta?.source, pergunta?.persona_id, pergunta?.persona_avatar_path, pergunta?.display_name]).toEqual([null, "scripted", pessoaNoBanco?.id, pessoaNoBanco?.avatar_path, NOME]);

    // No console, a pergunta com o selo Simulada (so aqui).
    await page.locator('[data-console-rail="perguntas"]').click();
    const noConsole = page.locator("[data-console-question]").filter({ hasText: PERGUNTA });
    await expect(noConsole.locator("[data-console-question-simulated]")).toBeVisible();
  });
});

test.describe("aluna", () => {
  test.use({ storageState: "tests/e2e/.auth/aluna.json" });

  test("na sala da live: os comentarios da pessoa no chat e a pergunta dela na aba Perguntas, com o nome e a foto; nada de Simulada", async ({ browserName, page }) => {
    test.skip(browserName === "webkit", "depende do produtor, que so roda no Chromium");
    const sala = await salaFalsaDoJitsi(page);
    await page.goto(`/webinarios/${slug}`);
    await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
    const dialogo = page.getByRole("dialog", { name: titulo });
    await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.aoVivo.entrarNaSala }).click();
    await sala.esperarMontada();
    await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: "aluna-na-sala-0202", roomName });

    for (const texto of [PRIMEIRO, SEGUNDO]) {
      const comentario = dialogo.locator("[data-room-message]").filter({ hasText: texto });
      await expect(comentario).toBeVisible();
      await expect(comentario).toContainText(NOME);
      await expect(comentario.locator("img")).toHaveAttribute("src", FOTO_NO_ENDERECO);
    }
    await expect(dialogo.locator("[data-room-message]").filter({ hasText: PERGUNTA })).toHaveCount(0);

    await dialogo.getByRole("navigation", { name: WEBINAR_COPY.salaV2.painel.rotulo }).getByRole("button", { name: new RegExp(`^${WEBINAR_COPY.sala.abas.perguntas}`) }).click();
    const pergunta = dialogo.locator("[data-room-question]").filter({ hasText: PERGUNTA });
    await expect(pergunta).toBeVisible({ timeout: 20_000 });
    await expect(pergunta).toContainText(NOME);
    await expect(pergunta.locator("img")).toHaveAttribute("src", FOTO_NO_ENDERECO);
    await expect(pergunta).not.toContainText(PESSOAS.simulada);
  });
});
