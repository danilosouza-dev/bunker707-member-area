import type { Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  ambienteDaSalaAoVivo,
  chamarWebhookDoGravador,
  contaDeTeste,
  expect,
  salaFalsaDoJitsi,
  seedLiveAoVivoDeTeste,
  sessaoAoVivoNoBanco,
  test,
  zerarHistoricoDeWebinarios,
  type SalaFalsaDoJitsi
} from "./fixtures";

// Webinarios, fase 3 (docs/30 §1.4, §2.4, §2.9, §6.4, §6.5, §6.7 e §10.2): o produtor (o Apresentador da Live ao vivo de
// teste) comanda a sala pelo console /admin/comunicacao/webinarios/[id]/sala com o Jitsi de mentira
// (salaFalsaDoJitsi). Abrir a sala poe a sessao na espera e o console entra com o token de moderador (a Sessao de
// pratica liga a sala de espera: toggleLobby true); Comecar para todos poe no ar e desliga a sala de espera; Silenciar
// todos manda muteEveryone; Trancar a sala grava room_locked e manda toggleLobby; Remover da sala manda
// kickParticipant e grava webinar_session_bans. Gravar com o gravador pronto (o webhook assinado com o segredo de teste
// manda `ready`) manda startRecording; com recordingStatusChanged ligado, a ancora e gravada (hora do servidor) e o
// selo Gravando aparece. Gravar antes de o gravador ficar pronto mostra "Preparando a gravação", fica na fila
// (recording_requested_at) e dispara sozinho quando o webhook manda `ready`. O `next start` do e2e roda como producao,
// onde o duble do pedido ao GitHub (WEBINAR_RECORDER_DISPATCH=fake) nao vale: a maquina "pedida" e a sessao posta em
// `preparing` no banco, como o jibri-up deixaria.

const { id, roomName, sessaoId } = LIVE_AO_VIVO_DE_TESTE;
const consoleAoVivo = WEBINAR_COPY.consoleAoVivo;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const APRESENTADOR = "produtor-na-sala-0001";
const ALUNA_NA_SALA = "aluna-na-sala-0002";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveAoVivoDeTeste(db, { status: "scheduled" });

  // A aluna ja entrou na sala por outro navegador: o console liga o participante dela a conta pelo ultimo
  // webinar_room_joined (o mesmo registro que o POST .../room-events grava).
  const aluna = await contaDeTeste("aluna");
  unwrap(
    await db.from("student_events").insert({
      entity_id: sessaoId,
      entity_type: "webinar",
      event_type: "webinar_room_joined",
      metadata: { at: new Date().toISOString(), offset_ms: 0, participant_id: ALUNA_NA_SALA },
      user_id: aluna.id
    }),
    "Gravando a entrada da aluna na sala"
  );
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** O console entrou na sala: o iframe falso confirma a entrada do Apresentador e o papel de moderador (do token). */
async function entrarComoApresentador(sala: SalaFalsaDoJitsi) {
  const montagem = await sala.esperarMontada();
  await sala.disparar("videoConferenceJoined", { displayName: "Produtor T.", id: APRESENTADOR, roomName });
  await sala.disparar("participantRoleChanged", { id: APRESENTADOR, role: "moderator" });
  return montagem;
}

async function abrirConsole(page: Page) {
  const sala = await salaFalsaDoJitsi(page);
  await page.goto(CONSOLE);
  await page.waitForLoadState("networkidle");
  return sala;
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("Abrir a sala (Sessao de pratica), Comecar para todos, Silenciar todos, Trancar a sala e Remover da sala", async ({ page }) => {
    const ambiente = ambienteDaSalaAoVivo();
    const sala = await abrirConsole(page);

    await page.getByRole("button", { exact: true, name: consoleAoVivo.abrirSala }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).status).toBe("waiting");

    // O console entra sozinho com a sala aberta: o token de moderador do Apresentador, a sala da sessao.
    const montagem = await entrarComoApresentador(sala);
    expect(montagem.dominio).toBe(ambiente.WEBINAR_MEET_DOMAIN);
    expect(montagem.roomName).toBe(roomName);
    const claims = verifyJitsiToken(montagem.jwt ?? "", ambiente.WEBINAR_JWT_SECRET) as { context: { features: { recording: boolean }; user: { affiliation?: string; moderator?: boolean } }; room: string } | null;
    expect(claims?.room).toBe(roomName);
    expect(claims?.context.user.moderator).toBe(true);
    expect(claims?.context.user.affiliation).toBe("owner");
    expect(claims?.context.features.recording).toBe(true);
    expect(montagem.configOverwrite.toolbarButtons).toContain("recording");
    expect(montagem.configOverwrite).not.toHaveProperty("startSilent");

    // Moderador: o aluno so fala depois de Liberar, e a Sessao de pratica liga a sala de espera.
    const moderacao = await sala.esperarComando("toggleModeration");
    expect(moderacao.args).toEqual([true, "audio"]);
    // E a tela compartilhada: so moderador compartilha, mesmo com um cliente que ignore a barra e as features do token.
    await expect.poll(async () => (await sala.comandos()).some((item) => item.comando === "toggleModeration" && JSON.stringify(item.args) === JSON.stringify([true, "desktop"]))).toBe(true);
    const pratica = await sala.esperarComando("toggleLobby");
    expect(pratica.args).toEqual([true]);

    let antes = (await sala.comandos()).length;
    await page.getByRole("button", { exact: true, name: consoleAoVivo.comecarParaTodos }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).status).toBe("live");
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([false]);

    antes = (await sala.comandos()).length;
    await page.getByRole("button", { exact: true, name: consoleAoVivo.silenciarTodos }).click();
    expect((await sala.esperarComando("muteEveryone", { depoisDe: antes })).args).toEqual(["audio"]);

    antes = (await sala.comandos()).length;
    await page.getByRole("button", { exact: true, name: consoleAoVivo.trancar }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).room_locked).toBe(true);
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([true]);
    antes = (await sala.comandos()).length;
    await page.getByRole("button", { exact: true, name: consoleAoVivo.destrancar }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).room_locked).toBe(false);
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([false]);

    // A aluna aparece na sala; Remover da sala grava o banimento da sessao e tira o participante do iframe.
    const aluna = await contaDeTeste("aluna");
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_NA_SALA });
    const linha = page.locator(`[data-live-participant="${ALUNA_NA_SALA}"]`);
    await expect(linha).toHaveAttribute("data-live-user", aluna.id, { timeout: 15_000 });
    antes = (await sala.comandos()).length;
    await linha.getByRole("button", { name: /^Mais ações para / }).click();
    await page.getByRole("menuitem", { exact: true, name: consoleAoVivo.removerDaSala }).click();
    expect((await sala.esperarComando("kickParticipant", { depoisDe: antes })).args).toEqual([ALUNA_NA_SALA]);
    await expect
      .poll(async () => {
        const linhas = unwrap(
          await createLocalAdminClient().from("webinar_session_bans").select("kind, until_at").eq("session_id", sessaoId).eq("user_id", aluna.id),
          "Lendo os banimentos da sessao"
        ) as { kind: string; until_at: string | null }[];
        return linhas;
      })
      .toEqual([{ kind: "kicked", until_at: null }]);

    // Nenhum texto do console cita o motor de video (D2).
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/jitsi/i);
  });

  test("Gravar com o gravador pronto: startRecording e, com recordingStatusChanged ligado, a ancora gravada pelo servidor e o selo Gravando", async ({ page }) => {
    const pronto = await chamarWebhookDoGravador({ room: roomName, sessionId: sessaoId, state: "ready" });
    expect(pronto.status).toBe(200);
    expect(pronto.corpo).toMatchObject({ recorderStatus: "ready", status: "processed" });

    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);

    const gravar = page.getByRole("button", { exact: true, name: consoleAoVivo.gravar });
    await expect(gravar).toBeEnabled({ timeout: 15_000 });
    const antes = (await sala.comandos()).length;
    await gravar.click();
    expect((await sala.esperarComando("startRecording", { depoisDe: antes })).args).toEqual([{ mode: "file" }]);

    const clique = Date.now();
    await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).recording_anchor_at !== null, { timeout: 15_000 }).toBe(true);
    const sessao = await sessaoAoVivoNoBanco();
    expect(sessao.recorder_status).toBe("recording");
    expect(Math.abs(Date.parse(sessao.recording_anchor_at ?? "") - clique)).toBeLessThan(60_000);
    await expect(page.getByText(consoleAoVivo.gravador.recording, { exact: true }).first()).toBeVisible();
  });

  test("Gravar antes de o gravador ficar pronto: Preparando a gravacao, o clique na fila e a gravacao comeca sozinha quando o webhook manda ready", async ({ page }) => {
    const db = createLocalAdminClient();
    // A maquina pedida agora (o que o jibri-up deixa), sem ancora nem pedido anterior do gravador.
    unwrap(await db.from("webinar_recording_events").delete().eq("session_id", sessaoId), "Apagando os pedidos do gravador");
    unwrap(
      await db
        .from("webinar_sessions")
        .update({ recorder_requested_at: new Date().toISOString(), recorder_status: "preparing", recording_anchor_at: null, recording_requested_at: null })
        .eq("id", sessaoId),
      "Pondo o gravador em preparo"
    );

    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);
    await expect(page.getByText(/Preparando a gravação/).first()).toBeVisible();

    const antes = (await sala.comandos()).length;
    const gravar = page.getByRole("button", { exact: true, name: consoleAoVivo.gravar });
    await expect(gravar).toBeEnabled({ timeout: 15_000 });
    await gravar.click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).recording_requested_at !== null).toBe(true);
    await expect(page.getByText(consoleAoVivo.gravarNaFila).first()).toBeVisible({ timeout: 15_000 });
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "startRecording")).toBe(false);

    const pronto = await chamarWebhookDoGravador({ room: roomName, sessionId: sessaoId, state: "ready" });
    expect(pronto.status).toBe(200);
    expect(pronto.corpo).toMatchObject({ recorderStatus: "ready", status: "processed" });

    // O retrato do console (a cada 5 s) traz o `ready` com o Gravar na fila: o navegador do Apresentador grava sozinho.
    expect((await sala.esperarComando("startRecording", { depoisDe: antes, timeout: 20_000 })).args).toEqual([{ mode: "file" }]);
    await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).recording_anchor_at !== null, { timeout: 15_000 }).toBe(true);
    const sessao = await sessaoAoVivoNoBanco();
    expect([sessao.recorder_status, sessao.recording_requested_at]).toEqual(["recording", null]);
    await expect(page.getByText(consoleAoVivo.gravador.recording, { exact: true }).first()).toBeVisible();
  });
});
