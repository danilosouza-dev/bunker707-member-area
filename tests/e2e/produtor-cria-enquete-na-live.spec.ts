import type { Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { CHAT_MESSAGES } from "../../src/server/webinars/chat-schemas";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, abrirComoProdutor, contaDeTeste, expect, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test, zerarHistoricoDeWebinarios } from "./fixtures";

// A "Nova enquete" do console na Live ao vivo, o caminho principal (D83; pedido do produtor de 11/11/2026: "poderia ser
// possível criar diretamente no console a enquete"; docs/18 §3): com a live no ar (o Jitsi de mentira, salaFalsaDoJitsi,
// nos dois navegadores), a aluna entra na sala; o produtor abre o console, vai a entrada Enquetes (sem enquete pronta,
// a frase manda para a Nova enquete), abre "Nova enquete" (o foco no titulo do formulario), tenta com uma opcao vazia (o
// erro do campo, nada gravado), escreve a Pergunta e tres Opções e usa "Abrir agora": o aviso "Enquete aberta para a
// turma.", o formulario fecha com o foco de volta no "Nova enquete", e a enquete aparece aberta em "Nesta sessão" e nas
// Prontas (no banco: a pronta sem sessao e a copia aberta da sessao). A aluna recebe a enquete no meio do palco e
// responde ("Enviar resposta", 201); a resposta fica no banco e o console conta "1 resposta".

const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const CONSOLE_POLLS = WEBINAR_ADMIN_COPY.console.polls;
const NOVA = CONSOLE_POLLS.create;
const PERGUNTA = "Qual parte você quer ver de novo?";
const OPCOES = ["Os prompts", "Os agentes", "O fechamento"];

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

/** A entrada Enquetes do console (pelo trilho; se nao coube, pelo Mais). */
async function abrirEnquetes(page: Page) {
  const nome = WEBINAR_COPY.consoleV2.entradas.enquetes;
  const item = page.locator('[data-console-rail="enquetes"]');
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

test("Nova enquete na live: o produtor cria e usa Abrir agora no console; a enquete entra nas prontas e abre para a turma; a aluna responde no palco", async ({ browser, page }) => {
  // A aluna na sala da live (o iframe falso entra).
  const salaDaAluna = await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  const dialogo = page.getByRole("dialog", { name: titulo });
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.aoVivo.entrarNaSala }).click();
  await salaDaAluna.esperarMontada();
  await salaDaAluna.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: "aluna-na-sala-0201", roomName });

  const produtor = await abrirComoProdutor(browser);
  const console = produtor.pagina;
  try {
    await salaFalsaDoJitsi(console);
    await console.goto(CONSOLE);
    await console.waitForLoadState("networkidle");

    const enquetes = await abrirEnquetes(console);
    await expect(enquetes.getByText(CONSOLE_POLLS.empty, { exact: true })).toBeVisible();
    await enquetes.getByRole("button", { exact: true, name: NOVA.novaEnquete }).click();

    // O formulario no lugar da lista, com o foco no titulo.
    const formulario = console.locator("[data-console-poll-form]");
    await expect(formulario).toBeVisible();
    await expect(console.getByRole("heading", { level: 2, name: NOVA.novaEnquete })).toBeFocused();
    await expect(enquetes.locator("[data-console-polls-templates]")).toHaveCount(0);

    // A primeira tentativa com uma opcao vazia: o erro no campo, nada gravado.
    await formulario.getByLabel(WEBINAR_ADMIN_COPY.polls.question, { exact: true }).fill(PERGUNTA);
    await formulario.getByLabel("Opção 1", { exact: true }).fill(OPCOES[0]);
    await formulario.getByRole("button", { exact: true, name: NOVA.abrirAgora }).click();
    await expect(formulario.getByLabel("Opção 2", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(formulario.getByText(CHAT_MESSAGES.option, { exact: true })).toBeVisible();
    const db = createLocalAdminClient();
    expect(unwrap(await db.from("webinar_polls").select("id").eq("webinar_id", id), "Lendo as enquetes da live") as unknown[]).toHaveLength(0);

    // As tres opcoes e o Abrir agora.
    await formulario.getByLabel("Opção 2", { exact: true }).fill(OPCOES[1]);
    await formulario.getByRole("button", { exact: true, name: WEBINAR_ADMIN_COPY.polls.addOption }).click();
    await formulario.getByLabel("Opção 3", { exact: true }).fill(OPCOES[2]);
    await expect(formulario.getByRole("radio", { exact: true, name: WEBINAR_ADMIN_COPY.polls.kinds.single })).toBeChecked();
    await formulario.getByRole("button", { exact: true, name: NOVA.abrirAgora }).click();
    await expect(console.getByText(NOVA.avisos.aberta)).toBeVisible();

    // O formulario fecha, o foco volta ao Nova enquete e a enquete aparece aberta em "Nesta sessão" e nas Prontas.
    await expect(formulario).toHaveCount(0);
    await expect(enquetes.getByRole("button", { exact: true, name: NOVA.novaEnquete })).toBeFocused();
    const nestaSessao = enquetes.locator("[data-console-polls-launched] [data-console-poll]").filter({ hasText: PERGUNTA });
    await expect(nestaSessao).toBeVisible();
    await expect(nestaSessao).toHaveAttribute("data-poll-status", "open");
    await expect(enquetes.locator("[data-console-polls-templates] [data-console-poll-template]").filter({ hasText: PERGUNTA })).toBeVisible();

    const linhas = unwrap(await db.from("webinar_polls").select("id, session_id, status, template_poll_id, question").eq("webinar_id", id), "Lendo as enquetes da live") as { id: string; question: string; session_id: string | null; status: string; template_poll_id: string | null }[];
    const pronta = linhas.find((linha) => linha.session_id === null);
    const copia = linhas.find((linha) => linha.session_id === sessaoId);
    expect(pronta?.question).toBe(PERGUNTA);
    expect([copia?.status, copia?.template_poll_id]).toEqual(["open", pronta?.id]);

    // A aluna recebe a enquete no meio do palco e responde.
    const palco = dialogo.locator("[data-lesson-player-stage]");
    const camada = palco.getByRole("dialog", { name: PERGUNTA });
    await expect(camada).toBeVisible({ timeout: 15_000 });
    await expect(camada.getByRole("radio")).toHaveCount(3);
    await camada.getByRole("radio", { name: OPCOES[1] }).check();
    const resposta = page.waitForResponse((response) => response.url().endsWith("/polls") && response.request().method() === "POST");
    await camada.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.enquete.enviarResposta }).click();
    expect((await resposta).status()).toBe(201);
    await expect(palco.getByRole("dialog")).toHaveCount(0);

    const aluna = await contaDeTeste("aluna");
    const respostas = unwrap(await db.from("webinar_poll_answers").select("poll_id").eq("user_id", aluna.id), "Lendo as respostas da aluna") as { poll_id: string }[];
    expect(respostas.map((linha) => linha.poll_id)).toEqual([copia?.id]);

    // O console conta a resposta no retrato seguinte.
    await expect(nestaSessao.getByText(CONSOLE_POLLS.answers(1), { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await produtor.fechar();
  }
});
