import type { Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { CONSOLE_ROOM_RULES } from "../../src/server/webinars/live-console-model";
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
// `preparing` no banco, como o jibri-up deixaria. O card Configurações de quem apresenta (docs/30 §1.4): a barra do
// iframe do Apresentador com a engrenagem so de aparelhos, o fundo e sempre visivel; o botao Configurações abre o card
// acima do palco, o microfone e o alto-falante chegam a sala pelos metodos da api so com o id, a camera so depois de ligada na
// barra do iframe (antes, a frase de liga-la), Ligar a redução de ruído vira setNoiseSuppressionEnabled({ enabled }),
// Desfocar / Tirar o efeito do fundo, Inverter a minha imagem e Mais opções de fundo sao acoes sem estado e nada e
// reaplicado (nem o ruido depois da troca do microfone, nem o desfoque na camera que liga), nada de setVideoQuality
// (quem apresenta nao baixa o proprio palco) e o Esc e o proprio botao fecham o card com o foco no botao. O vigia da
// tela (docs/31 §5.4): quem compartilha com papel conhecido de participante tem a tela parada por
// muteRemoteParticipant(id, 'desktop'); o papel de quem ja moderava quando o console entrou vem do getRoomsInfo, e a
// saida da sala cancela o getRoomsInfo que esperava (o iframe que saiu responderia com o proprio console).

const { id, roomName, sessaoId } = LIVE_AO_VIVO_DE_TESTE;
const consoleAoVivo = WEBINAR_COPY.consoleAoVivo;
const aoVivo = WEBINAR_COPY.aoVivo;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const APRESENTADOR = "produtor-na-sala-0001";
const ALUNA_NA_SALA = "aluna-na-sala-0002";
const COAPRESENTADOR = "cohost-na-sala-0003";

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
    const pratica = await sala.esperarComando("toggleLobby");
    expect(pratica.args).toEqual([true]);
    // Nada de moderacao de tela (docs/31 §5.4): na tag o "desktop" do toggleModeration liga de novo a de audio. A
    // moderacao de audio sai uma vez so, e o motor responde com a de audio.
    const moderacoes = (await sala.comandos()).filter((item) => item.comando === "toggleModeration");
    expect(moderacoes.filter((item) => item.args.includes("desktop"))).toEqual([]);
    expect(moderacoes.filter((item) => JSON.stringify(item.args) === JSON.stringify([true, "audio"]))).toHaveLength(1);
    await expect
      .poll(async () => (await sala.sinais()).filter((sinal) => sinal.evento === "moderationStatusChanged").map((sinal) => sinal.payload))
      .toContainEqual({ enabled: true, mediaType: "audio" });

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

  test("Configurações do console: a engrenagem e o fundo na barra do iframe; o card (acima do palco) troca o microfone, o alto-falante e (com a camera ligada) a camera pelo id; ruido, fundo e espelho sao acoes sem estado e nada e reaplicado; sem setVideoQuality; Esc e o proprio botao fecham com o foco no botao", async ({ page }) => {
    const sala = await abrirConsole(page);
    const montagem = await entrarComoApresentador(sala);

    // A barra do iframe de quem apresenta: a engrenagem (so a aba de aparelhos), o fundo e sempre visivel. O
    // Apresentador entra com a captura inicial so do microfone (startWithVideoMuted): o duble nasce com o microfone
    // liberado e a camera nao, como o navegador.
    expect(montagem.configOverwrite.toolbarButtons).toEqual(expect.arrayContaining(["select-background", "settings"]));
    expect(montagem.configOverwrite.toolbarConfig).toEqual({ alwaysVisible: true });
    expect(montagem.configOverwrite).not.toHaveProperty("disableInitialGUM");
    expect(montagem.interfaceConfigOverwrite.SETTINGS_SECTIONS).toEqual(["devices"]);

    // Dentro do conteudo do admin: o menu lateral tem o grupo "Configurações" com o mesmo nome.
    const botao = page.locator("#admin-main").getByRole("button", { exact: true, name: consoleAoVivo.configuracoes });
    await expect(botao).toHaveAttribute("aria-expanded", "false");
    await botao.click();
    await expect(botao).toHaveAttribute("aria-expanded", "true");
    const card = page.locator("[data-live-settings]");
    await expect(card).toBeVisible();
    await expect(botao).toHaveAttribute("aria-controls", (await card.getAttribute("id")) ?? "");
    await sala.esperarComando("getAvailableDevices");
    await expect(card).toContainText(consoleAoVivo.configuracoesTexto);

    // A camera nunca ligada neste navegador: sem a lista de cameras, a frase de liga-la na barra do video (e nada de
    // desfocar, que so vale com o video no ar).
    await expect(card).toContainText(aoVivo.config.cameraNaBarraDoVideo);
    await expect(card.getByRole("combobox", { exact: true, name: aoVivo.camera })).toHaveCount(0);
    await expect(card.getByRole("button", { exact: true, name: aoVivo.config.desfocar })).toHaveCount(0);

    // O microfone e o alto-falante ja vem com os nomes (o "Padrão - …" do Chrome nao vira uma opcao a mais).
    const microfone = card.getByRole("combobox", { exact: true, name: aoVivo.microfone });
    await expect(microfone.locator("option")).toHaveCount(2);
    const altoFalante = card.getByRole("combobox", { exact: true, name: aoVivo.config.altoFalante });
    await expect(altoFalante.locator("option", { hasText: "Fone USB" })).toHaveCount(1);
    let antes = (await sala.comandos()).length;
    await altoFalante.selectOption({ label: "Fone USB" });
    expect((await sala.esperarComando("setAudioOutputDevice", { depoisDe: antes })).args).toEqual(["", "som-usb"]);

    // Reduzir ruído: Ligar / Desligar, sem caixa marcada (a setinha do microfone do iframe tambem muda o ruido).
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    antes = (await sala.comandos()).length;
    await card.getByRole("button", { exact: true, name: aoVivo.config.ruidoLigar }).click();
    expect((await sala.esperarComando("setNoiseSuppressionEnabled", { depoisDe: antes })).args).toEqual([{ enabled: true }]);

    // Trocar o microfone nao reaplica o ruido por cima do que quem apresenta escolheu no iframe (a propria tag desliga o
    // ruido na troca; quem apresenta liga de novo aqui ou na setinha do microfone).
    antes = (await sala.comandos()).length;
    await microfone.selectOption({ label: "Fone USB" });
    expect((await sala.esperarComando("setAudioInputDevice", { depoisDe: antes })).args).toEqual(["", "mic-usb"]);
    await sala.esperarComando("trocaConcluida", { depoisDe: antes });
    await page.waitForTimeout(1_000);
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "setNoiseSuppressionEnabled")).toBe(false);

    // A camera ligada pela barra do iframe: a lista chega com os nomes e a troca vai so pelo id.
    await sala.disparar("videoMuteStatusChanged", { muted: false });
    const camera = card.getByRole("combobox", { exact: true, name: aoVivo.camera });
    await expect(camera.locator("option", { hasText: "Webcam USB" })).toHaveCount(1);
    await expect(card).not.toContainText(aoVivo.config.cameraNaBarraDoVideo);
    antes = (await sala.comandos()).length;
    await camera.selectOption({ label: "Webcam USB" });
    expect((await sala.esperarComando("setVideoInputDevice", { depoisDe: antes })).args).toEqual(["", "cam-usb"]);
    await sala.esperarComando("trocaConcluida", { depoisDe: antes });

    // Desfocar o fundo e Tirar o efeito do fundo, acoes sem estado; fechar e abrir a camera pela barra do iframe nao
    // reaplica o desfoque (o iframe cria a faixa nova com o efeito; e quem apresenta pode ter trocado o fundo la).
    antes = (await sala.comandos()).length;
    await card.getByRole("button", { exact: true, name: aoVivo.config.desfocar }).click();
    expect((await sala.esperarComando("setBlurredBackground", { depoisDe: antes })).args).toEqual(["blur"]);
    antes = (await sala.comandos()).length;
    await sala.disparar("videoMuteStatusChanged", { muted: true });
    await sala.disparar("videoMuteStatusChanged", { muted: false });
    await page.waitForTimeout(500);
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "setBlurredBackground")).toBe(false);
    await card.getByRole("button", { exact: true, name: aoVivo.config.fundoTirar }).click();
    expect((await sala.esperarComando("setBlurredBackground", { depoisDe: antes })).args).toEqual(["none"]);

    // Inverter a minha imagem (o comando so inverte) e Mais opções de fundo (o dialogo de fundo do proprio iframe).
    antes = (await sala.comandos()).length;
    await card.getByRole("button", { exact: true, name: aoVivo.config.inverterImagem }).click();
    expect((await sala.esperarComando("toggleCameraMirror", { depoisDe: antes })).args).toEqual([]);
    const maisFundos = card.getByRole("button", { exact: true, name: aoVivo.config.maisFundos });
    antes = (await sala.comandos()).length;
    await maisFundos.click();
    expect((await sala.esperarComando("toggleVirtualBackgroundDialog", { depoisDe: antes })).args).toEqual([]);

    // Quem apresenta nunca baixa o proprio palco nem usa o comando de ruido que ninguem trata.
    const comandos = await sala.comandos();
    expect(comandos.some((item) => item.comando === "setVideoQuality" || item.comando === "toggleNoiseSuppression")).toBe(false);
    await expect(card.getByRole("radio")).toHaveCount(0);
    await expect(card.getByRole("slider")).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toHaveCount(0);

    // O card vem logo depois do botao no teclado (acima do palco, antes dos botoes da barra do iframe).
    const ordem = await page.evaluate(() => {
      const cartao = document.querySelector("[data-live-settings]");
      const palco = document.querySelector("[data-live-stage]");
      return cartao && palco ? cartao.compareDocumentPosition(palco) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(ordem, "o card antes do palco").toBeTruthy();

    // O foco no card (o WebKit nao foca o botao no clique): o Esc fecha e devolve o foco ao Configurações.
    await maisFundos.focus();
    await page.keyboard.press("Escape");
    await expect(botao).toHaveAttribute("aria-expanded", "false");
    await expect(card).toHaveCount(0);
    await expect(botao).toBeFocused();

    // Fechar pelo proprio botao com o foco num controle do card: o foco vai ao botao, nunca ao body.
    await botao.click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { exact: true, name: aoVivo.config.maisFundos }).focus();
    await botao.dispatchEvent("click");
    await expect(card).toHaveCount(0);
    await expect(botao).toBeFocused();
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/jitsi/i);
  });

  test("o vigia da tela: quem ja moderava quando o console entrou (o papel so pelo getRoomsInfo) continua compartilhando; a aluna sem liberacao tem a tela parada por muteRemoteParticipant de tela, uma vez; a tela do proprio console fica", async ({ page }) => {
    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);
    const pedidosDeParar = async () => (await sala.comandos()).filter((item) => item.comando === "muteRemoteParticipant" && item.args[1] === "desktop").map((item) => item.args);

    // O co-apresentador ja estava na sala: o participantJoined nao traz o papel e nenhum participantRoleChanged sai. A
    // tela dele chega sem papel conhecido: o console pede o getRoomsInfo e nunca para a tela de quem ainda nao tem papel.
    let antes = (await sala.comandos()).length;
    await sala.disparar("participantJoined", { displayName: "Co T.", id: COAPRESENTADOR, papel: "moderator" });
    expect((await sala.sinais()).filter((sinal) => sinal.evento === "participantJoined").map((sinal) => sinal.payload)).toContainEqual({ displayName: "Co T.", id: COAPRESENTADOR });
    await sala.disparar("contentSharingParticipantsChanged", { data: [COAPRESENTADOR] });
    await sala.esperarComando("getRoomsInfo", { depoisDe: antes });
    // O papel lido pelo getRoomsInfo: a linha dele vira Equipe, e a tela continua.
    await expect(page.locator(`[data-live-participant="${COAPRESENTADOR}"]`)).toContainText(WEBINAR_COPY.sala.selos.equipe, { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    expect(await pedidosDeParar(), "o moderador continua compartilhando").toEqual([]);

    // A aluna compartilha sem liberacao (o cliente padrao que chama o comando de tela pelo DevTools): o papel de
    // participante chega pelo getRoomsInfo e o pedido de parar sai so para ela.
    antes = (await sala.comandos()).length;
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_NA_SALA });
    await sala.disparar("contentSharingParticipantsChanged", { data: [COAPRESENTADOR, ALUNA_NA_SALA] });
    expect((await sala.esperarComando("muteRemoteParticipant", { depoisDe: antes })).args).toEqual([ALUNA_NA_SALA, "desktop"]);
    await page.waitForTimeout(1_500);
    expect(await pedidosDeParar(), "um pedido so, e so para a aluna").toEqual([[ALUNA_NA_SALA, "desktop"]]);

    // A tela do proprio console nunca e parada (nem pede o getRoomsInfo por ela).
    antes = (await sala.comandos()).length;
    await sala.disparar("contentSharingParticipantsChanged", { data: [APRESENTADOR] });
    await page.waitForTimeout(1_500);
    expect((await sala.comandos()).slice(antes).filter((item) => item.comando === "muteRemoteParticipant" || item.comando === "getRoomsInfo")).toEqual([]);

    // Nunca a recusa de tela (no motor ela recusa o audio) nem o mudo de tela de todos (pegaria o co-apresentador).
    const comandos = await sala.comandos();
    expect(comandos.filter((item) => (item.comando === "rejectParticipant" || item.comando === "muteEveryone") && item.args.includes("desktop"))).toEqual([]);
    expect(await pedidosDeParar()).toEqual([[ALUNA_NA_SALA, "desktop"]]);
  });

  test("a saida da sala cancela o getRoomsInfo que esperava: nenhum pedido sai depois do videoConferenceLeft e, de volta com outro id, nenhuma linha da sala de antes", async ({ page }) => {
    const ANTES = "produtor-antes-0004";
    const DE_VOLTA = "produtor-volta-0005";
    const ALUNA_DE_ANTES = "aluna-antes-0006";
    const ALUNA_DE_AGORA = "aluna-agora-0007";
    const sala = await abrirConsole(page);
    await sala.esperarMontada();
    await sala.disparar("videoConferenceJoined", { displayName: "Produtor T.", id: ANTES, roomName });
    await sala.disparar("participantRoleChanged", { id: ANTES, role: "moderator" });
    // O primeiro getRoomsInfo sai na entrada; o de quem entra logo depois espera o intervalo.
    await sala.esperarComando("getRoomsInfo");
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_DE_ANTES });
    await expect(page.locator(`[data-live-participant="${ALUNA_DE_ANTES}"]`)).toHaveCount(1);

    // O console sai (o hangup da barra do iframe) com o pedido ainda esperando: ele nao sai, e a lista fica vazia.
    const antesDaSaida = (await sala.comandos()).length;
    await sala.disparar("videoConferenceLeft", {});
    await page.waitForTimeout(CONSOLE_ROOM_RULES.roomsInfoMs + 1_500);
    expect((await sala.comandos()).slice(antesDaSaida).filter((item) => item.comando === "getRoomsInfo"), "nenhum getRoomsInfo depois da saida").toEqual([]);
    await expect(page.locator("[data-live-participant]")).toHaveCount(0);

    // De volta, num iframe novo e com outro id: so quem esta na sala nova, sem o console de antes nem a aluna de antes.
    await page.getByRole("button", { exact: true, name: aoVivo.entrarNaSala }).click();
    await expect.poll(() => sala.montagens(), { timeout: 20_000 }).toBe(2);
    await sala.disparar("videoConferenceJoined", { displayName: "Produtor T.", id: DE_VOLTA, roomName });
    await sala.disparar("participantRoleChanged", { id: DE_VOLTA, role: "moderator" });
    await sala.esperarComando("getRoomsInfo");
    await sala.disparar("participantJoined", { displayName: "Bia T.", id: ALUNA_DE_AGORA });
    await expect(page.locator(`[data-live-participant="${ALUNA_DE_AGORA}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-live-participant="${ANTES}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-live-participant="${DE_VOLTA}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-live-participant="${ALUNA_DE_ANTES}"]`)).toHaveCount(0);
  });
});
