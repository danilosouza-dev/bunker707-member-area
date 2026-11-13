import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "../../src/server/webinars/editor-model";
import { CHAT_CONSENT_VERSION } from "../../src/server/webinars/model";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, abrirComoProdutor, expect, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test, zerarHistoricoDeWebinarios } from "./fixtures";

// A rodada v12 no console da Live ao vivo, o caminho principal dos dois pedidos do produtor de 12/11/2026 (docs/30 D106
// e D107; docs/18 §3), com a live no ar e o Jitsi de mentira (salaFalsaDoJitsi) nos dois navegadores:
// - "um usuário comenta no chat e o apresentador não recebe notificação no ícone de mensagem": o produtor esta na aba
//   Perguntas; a aluna escreve no chat da sala; o item Chat do trilho do console ganha o numero ("Chat, 1 mensagem
//   nova"); ele abre o Chat, ve o comentario e o numero some;
// - "Onde está a opção de tirar da tela a quantidade de alunos assistindo? Isso tem que estar ... também no console":
//   o produtor toca nos presentes do palco, a Presença abre com a chave "Mostrar quantas pessoas estão na sala" no alto;
//   ele desliga, o aviso confirma, o selo dele passa a dizer "só a equipe vê" e a chave fica gravada no webinario; na
//   sala da aluna o numero some no sinal seguinte (sem recarregar a pagina); ligada de novo, o numero volta.

const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const v2 = WEBINAR_COPY.consoleV2;
const COMENTARIO = "Boa noite! Cheguei agora.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  const contas = await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
  // A aluna ja aceitou as regras do chat (o texto de agora): o comentario dela vai direto.
  unwrap(
    await db.from("webinar_chat_consents").upsert({ consent_version: CHAT_CONSENT_VERSION, display_mode: "first_name_initial", user_id: contas.aluna.id }, { onConflict: "user_id" }),
    "Gravando o aceite da aluna"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

const chaveNoBanco = async () => {
  const linha = unwrap(await createLocalAdminClient().from("webinars").select("room_settings").eq("id", id).single(), "Lendo as configuracoes da live") as { room_settings: Record<string, unknown> | null } | null;
  return linha?.room_settings?.showPresentCount;
};

test("no console da live: o comentario da aluna vira o numero no item Chat; a chave do numero de pessoas, pelos presentes do palco, tira o numero da sala dela e traz de volta", async ({ browser, page }) => {
  test.setTimeout(180_000);
  // A aluna na sala da live (o iframe falso entra): o numero de pessoas aparece no palco dela.
  await page.setViewportSize({ height: 800, width: 1280 });
  const salaDaAluna = await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  const dialogo = page.getByRole("dialog", { name: titulo });
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.aoVivo.entrarNaSala }).click();
  await salaDaAluna.esperarMontada();
  await salaDaAluna.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: "aluna-na-sala-0301", roomName });
  const numeroDaAluna = dialogo.getByTestId("room-present");
  await expect(numeroDaAluna).toBeVisible({ timeout: 30_000 });

  const produtor = await abrirComoProdutor(browser, { viewport: { height: 900, width: 1440 } });
  const console = produtor.pagina;
  try {
    await salaFalsaDoJitsi(console);
    await console.goto(CONSOLE);
    await console.waitForLoadState("networkidle");

    /* O Chat com mensagens novas (D106) */

    // O produtor vai para as Perguntas: o Chat sai da tela, sem numero.
    const itemChat = console.locator('[data-console-rail="chat"]');
    const itemPerguntas = console.locator('[data-console-rail="perguntas"]');
    await itemPerguntas.click();
    await expect(itemPerguntas).toHaveAttribute("aria-expanded", "true");
    await expect(itemChat.locator("[data-room-unread]")).toHaveCount(0);
    await expect(itemChat).toHaveAccessibleName(v2.abas.chat);

    // A aluna comenta no chat da sala.
    const campo = dialogo.getByRole("textbox", { name: "Escreva uma mensagem" });
    await campo.fill(COMENTARIO);
    const envio = page.waitForResponse((response) => response.url().includes("/api/webinars/") && response.url().endsWith("/chat") && response.request().method() === "POST");
    await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.enviar }).click();
    expect((await envio).status()).toBe(201);

    // No console, o item Chat ganha o numero (a leitura de 5 s do retrato) e o nome diz quantas.
    await expect(itemChat.locator("[data-room-unread]")).toHaveText("1", { timeout: 30_000 });
    await expect(itemChat).toHaveAccessibleName(v2.trilho.comNumero(v2.abas.chat, v2.trilho.mensagensNovas(1)));
    // As Perguntas continuam na tela: o numero nao tira o produtor de onde ele esta.
    await expect(itemPerguntas).toHaveAttribute("aria-expanded", "true");

    // Ele abre o Chat: o comentario esta la, e o numero some.
    await itemChat.click();
    await expect(itemChat).toHaveAttribute("aria-expanded", "true");
    await expect(console.locator("#console-tab-chat").getByText(COMENTARIO)).toBeVisible();
    await expect(itemChat.locator("[data-room-unread]")).toHaveCount(0);
    await expect(itemChat).toHaveAccessibleName(v2.abas.chat);
    // De volta as Perguntas, o que ele ja viu nao vira numero de novo.
    await itemPerguntas.click();
    await console.waitForTimeout(6_000);
    await expect(itemChat.locator("[data-room-unread]")).toHaveCount(0);

    /* A chave do numero de pessoas (D107) */

    // Os presentes do palco sao o botao que abre a Presença: no alto dela, a chave, ligada (o foco vai ao titulo dos
    // participantes simulados, logo abaixo, como ja ia: docs/30 D79).
    const presentes = console.locator('[data-console-audience-open="stage"]');
    await expect(presentes).toBeVisible();
    await expect(presentes).not.toContainText(v2.numeroDePessoas.soEquipe);
    await presentes.click();
    await expect(console.locator('[data-console-rail="presenca"]')).toHaveAttribute("aria-expanded", "true");
    const presenca = console.locator('section[data-console-more="presenca"]');
    const chave = presenca.getByRole("switch", { name: WEBINAR_ADMIN_COPY.fields.showPresentCount });
    await expect(chave).toBeVisible();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(presenca.getByRole("heading", { exact: true, name: v2.numeroDePessoas.titulo })).toBeVisible();

    // Desliga: o aviso confirma, a chave fica desligada, o selo diz que so a equipe ve, e o webinario guarda.
    await chave.click();
    await expect(console.getByText(v2.numeroDePessoas.escondido)).toBeVisible();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(presentes).toContainText(v2.numeroDePessoas.soEquipe);
    expect(await chaveNoBanco()).toBe(false);

    // Na sala da aluna o numero some no sinal seguinte, sem recarregar a pagina.
    await expect(numeroDaAluna).toHaveCount(0, { timeout: 60_000 });

    // Liga de novo: o numero volta para ela, e o selo do console fica como antes.
    await chave.click();
    await expect(console.getByText(v2.numeroDePessoas.mostrando)).toBeVisible();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(presentes).not.toContainText(v2.numeroDePessoas.soEquipe);
    expect(await chaveNoBanco()).toBe(true);
    await expect(numeroDaAluna).toBeVisible({ timeout: 60_000 });
  } finally {
    await produtor.fechar();
  }
});
