import type { Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, expect, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test, zerarHistoricoDeWebinarios } from "./fixtures";

// O roteiro e a Simulacao na Live ao vivo, o caminho principal (adendo de 10/11/2026, R7 a R9; docs/18 §3): com a live
// no ar (o Jitsi de mentira, salaFalsaDoJitsi) e a Simulacao decidida para a sessao (o contador "Real + número fixo"
// +300, gravado com a frase da live), o produtor abre o console, vai a entrada Roteiro, abre "Novo comentário", poe
// Quem comenta (Nome, a Foto enviada pelo navegador, Aparece como Aluno) e o Comentário, e usa "Enviar agora": o console
// mostra o comentario com a foto de quem comenta no chat (o caminho webinars/personas, pela origem do nosso Supabase).
// A aluna, na sala da live, recebe o comentario pela consulta de 5 s com o nome e a foto no avatar, e o selo de quem
// assiste no palco mostra o real mais os 300 simulados; o console mostra a parte simulada separada ("· +300 simulados").

const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
const NOME = "Bia Comentarista";
const TEXTO = "Que aula boa, pessoal! Tô amando o exemplo.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
  // A Simulacao da live decidida (a frase da live, quem e quando): +300 no contador; nada de entradas nem avisos.
  unwrap(
    await db
      .from("webinar_sessions")
      .update({
        simulated_count_rule: { base: 300, jitter: 0, mode: "fixed", peak: 300 },
        simulation_ack_text: "Decisão do produtor em 10/11/2026: nesta live ao vivo, dentro da área de membros, os números de plateia são simulados e os avisos de venda não aparecem. Responsável: Produtor de Teste.",
        simulation_decided_at: new Date().toISOString()
      })
      .eq("id", sessaoId),
    "Decidindo a Simulacao da live"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** A entrada Roteiro do console (pelo trilho; se nao coube, pelo Mais). */
async function abrirRoteiro(page: Page) {
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

  test("Novo comentário na live: Quem comenta com a foto enviada e Enviar agora; o console mostra o comentario com a foto e a parte simulada separada", async ({ browserName, page }) => {
    // O preparo da foto no navegador gera WebP pelo canvas, que o WebKit do Playwright nao faz: a foto passa pelo Chromium.
    test.skip(browserName === "webkit", "o WebKit nao gera WebP no canvas");
    await salaFalsaDoJitsi(page);
    await page.goto(CONSOLE);
    await page.waitForLoadState("networkidle");
    // O selo dos presentes no palco do console (a sala da live): o real com a parte simulada separada.
    await expect(page.locator('[data-room-badge="present"]').first()).toHaveText(/presentes?( · pico \d+)? · \+300 simulados$/);

    const roteiro = await abrirRoteiro(page);
    await roteiro.getByRole("button", { exact: true, name: COMENTARIOS.novoComentario }).click();
    const formulario = page.locator("[data-console-script-comment]");
    await expect(formulario.getByText(COMENTARIOS.quemComenta, { exact: true })).toBeVisible();
    await formulario.getByLabel(COMENTARIOS.nome, { exact: true }).fill(NOME);
    const envio = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/admin/comunicacao/webinarios/"));
    await formulario.getByLabel(COMENTARIOS.enviarFoto, { exact: true }).setInputFiles({ buffer: pngQuadrado(640), mimeType: "image/png", name: "rosto-gerado.png" });
    await envio;
    const previa = formulario.locator("[data-persona-photo-preview]");
    await expect(previa).toHaveAttribute("src", /\/storage\/v1\/object\/public\/content-assets\/webinars\/personas\/[a-f0-9]{24}\.webp$/);
    await expect(formulario.getByText(COMENTARIOS.fotoConsentimento, { exact: true })).toBeVisible();
    // Desde 11/11/2026 (D75) a caixa "Usar esta foto em todos" saiu: a pessoa nova entra na lista ao enviar.
    await expect(formulario.locator("[data-persona-photo-all]")).toHaveCount(0);
    await formulario.getByRole("radio", { exact: true, name: COMENTARIOS.papeis.student }).check();
    await formulario.getByLabel(COMENTARIOS.comentario, { exact: true }).fill(TEXTO);
    await formulario.getByRole("button", { exact: true, name: COMENTARIOS.enviarAgora }).click();
    await expect(page.getByText(COMENTARIOS.avisos.enviado)).toBeVisible();
    // Desde 11/11/2026 (D78) o formulario fica aberto para o proximo, com a mesma pessoa e o texto limpo; o Voltar volta
    // ao Roteiro. O "Enviar agora" nao vira item, entao a live segue sem roteiro, com a frase e o Novo comentário de novo
    // (sem item, nenhuma lista vazia).
    await expect(formulario.getByText(WEBINAR_COPY.pessoas.avisos.enviado, { exact: true })).toBeVisible();
    await page.locator("[data-console-script-back]").click();
    await expect(formulario).toHaveCount(0);
    await expect(roteiro.getByText(WEBINAR_ADMIN_COPY.console.script.emptyLive, { exact: true })).toBeVisible();
    await expect(roteiro.getByRole("button", { exact: true, name: COMENTARIOS.novoComentario })).toBeVisible();

    // No Chat do console, o comentario com o nome e a foto de quem comenta, pela origem do nosso Supabase.
    await page.locator('[data-console-rail="chat"]').click();
    const noChat = page.locator("#console-panel [data-room-message]").filter({ hasText: TEXTO });
    await expect(noChat).toBeVisible();
    await expect(noChat).toContainText(NOME);
    // O avatar passa pelo next/image (o endereco do nosso bucket pode vir codificado no ?url=).
    await expect(noChat.locator("img")).toHaveAttribute("src", /storage(%2F|\/)v1(%2F|\/)object(%2F|\/)public(%2F|\/)content-assets(%2F|\/)webinars(%2F|\/)personas(%2F|\/)[a-f0-9]{24}\.webp/);

    const db = createLocalAdminClient();
    const linha = unwrap(await db.from("webinar_chat_messages").select("display_name, role, source, script_item_id, persona_avatar_path").eq("session_id", sessaoId).eq("body", TEXTO).single(), "Lendo o comentario");
    expect([linha?.display_name, linha?.role, linha?.source, linha?.script_item_id]).toEqual([NOME, "student", "scripted", null]);
    expect(linha?.persona_avatar_path).toMatch(/^webinars\/personas\/[a-f0-9]{24}\.webp$/);
  });
});

test.describe("aluna", () => {
  test.use({ storageState: "tests/e2e/.auth/aluna.json" });

  test("na sala da live: o comentario com o nome e a foto de quem comenta; o selo de quem assiste com o real mais os 300 simulados", async ({ browserName, page }) => {
    test.skip(browserName === "webkit", "depende do comentario do produtor, que so roda no Chromium");
    const sala = await salaFalsaDoJitsi(page);
    await page.goto(`/webinarios/${slug}`);
    await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
    const dialogo = page.getByRole("dialog", { name: titulo });
    await expect(dialogo).toHaveAttribute("data-room-kind", "live");
    await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.aoVivo.entrarNaSala }).click();
    await sala.esperarMontada();
    await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: "aluna-na-sala-0101", roomName });

    const comentario = dialogo.locator("[data-room-message]").filter({ hasText: TEXTO });
    await expect(comentario).toBeVisible();
    await expect(comentario).toContainText(NOME);
    await expect(comentario.locator("img")).toHaveAttribute("src", /webinars(%2F|\/)personas(%2F|\/)[a-f0-9]{24}\.webp/);

    // O selo do palco: o real (a aluna, e quem mais estiver) mais os 300 simulados; nunca so o real.
    const quemAssiste = dialogo.locator("[data-lesson-player-stage]").getByTestId("room-present");
    await expect(quemAssiste).toHaveAttribute("title", /^\d+ assistindo agora$/);
    await expect.poll(async () => Number((await quemAssiste.getAttribute("title"))?.match(/^(\d+)/)?.[1] ?? 0)).toBeGreaterThanOrEqual(301);
  });
});
