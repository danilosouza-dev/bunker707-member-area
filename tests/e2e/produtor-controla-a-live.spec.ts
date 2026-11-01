import type { Page } from "@playwright/test";
import { THEME_HASH_KEY } from "../../src/lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY, webinarAdminHref } from "../../src/server/webinars/editor-model";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { CONSOLE_ROOM_RULES, lowerHandMessage } from "../../src/server/webinars/live-console-model";
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
// `preparing` no banco, como o jibri-up deixaria. A barra de quem apresenta (docs/31 V2-14) e nossa: o iframe do
// console fica sem a barra do motor (no Safari, so o botao de tela do motor, V2-A39), sem os atalhos e com o ⋮ da
// miniatura avisando o Liberar e o Remover; Microfone, Câmera e Compartilhar tela mandam o comando e o estado vem do eco
// do motor; Gravar sai pela barra; a Sala de espera com Admitir todos; o "Palco para todos ▾" manda setTileView; o
// "Pedir para ligar o microfone" do ⋮ vira askToUnmute e o Remover de quem ainda nao esta na lista da sessao tira pelo
// motor com o aviso. As Configurações de quem apresenta (docs/30 §1.4): a engrenagem do motor so de aparelhos; o botao
// Configurações da barra abre o painel logo depois dele, o microfone e o alto-falante chegam a sala pelos metodos da api
// so com o id, a camera so depois de ligada pela barra (antes, a frase de liga-la), Ligar a redução de ruído vira
// setNoiseSuppressionEnabled({ enabled }), Desfocar / Tirar o efeito do fundo, Inverter a minha imagem e Mais opções de
// fundo sao acoes sem estado e nada e reaplicado (nem o ruido depois da troca do microfone, nem o desfoque na camera que
// liga), nada de setVideoQuality (quem apresenta nao baixa o proprio palco) e o Esc e o proprio botao fecham o painel
// com o foco no botao. O vigia da
// tela (docs/31 §5.4): quem compartilha com papel conhecido de participante tem a tela parada por
// muteRemoteParticipant(id, 'desktop'); o papel de quem ja moderava quando o console entrou vem do getRoomsInfo, e a
// saida da sala cancela o getRoomsInfo que esperava (o iframe que saiu responderia com o proprio console). O console V2
// (docs/31 V2-12 e V2-13): a tela cheia, sem a barra lateral e sem a barra superior do admin, a seta de voltar ao
// editor, o Trancar no topo, o tema (escuro por padrao, guardado ao recarregar, levado ao iframe so na montagem: trocar
// com a sala no ar nao remonta) e a confirmacao de Encerrar live no portal dentro da raiz do console, no tema dela. O
// palco do console (docs/31 V2-4 e V2-A5): o selo Gravando no palco e a coluna de miniaturas do Apresentador com o
// motor (nenhum toggleFilmStrip pela propria largura), com os selos de cima a direita descontando a coluna. O painel
// com abas (docs/31 V2-15): Silenciar todos e as linhas da sala na aba Pessoas, as frases do preparo no ⋯ › Gravação;
// Mãos (o numero na barra) abre a aba Mãos, Abaixar todas as mãos manda um sinal so, para todos; Lançar enquete abre o ⋯
// › Enquetes e o Gravar por preparar, o ⋯ › Gravação; o microfone de cada linha vem do participantMuted.

const { id, roomName, sessaoId } = LIVE_AO_VIVO_DE_TESTE;
const consoleAoVivo = WEBINAR_COPY.consoleAoVivo;
const aoVivo = WEBINAR_COPY.aoVivo;
const CONSOLE = `/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const APRESENTADOR = "produtor-na-sala-0001";
const ALUNA_NA_SALA = "aluna-na-sala-0002";
const COAPRESENTADOR = "cohost-na-sala-0003";
const SEM_REGISTRO = "sem-registro-0004";
/** A barra de quem apresenta, embaixo do palco (o Admitir todos tambem existe na aba Pessoas do painel). */
const barraDe = (page: Page) => page.locator('[data-console-slot="bar"]');
const consoleV2 = WEBINAR_COPY.consoleV2;

/** Abre uma aba do painel do console pelo nome (o numero pode vir junto, "Mãos 1"). */
async function abrirAba(page: Page, nome: string) {
  const aba = page.getByRole("tab", { name: new RegExp(`^${nome}`) });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  return page.locator(`#${(await aba.getAttribute("aria-controls")) ?? ""}`);
}

/** Escolhe uma entrada no ⋯ do painel do console e devolve a secao dela, ja na tela (um grupo com o nome da entrada). */
async function abrirNoMais(page: Page, entrada: string) {
  await page.locator("[data-console-more-trigger]").click();
  await page.getByRole("menuitemradio", { exact: true, name: entrada }).click();
  const secao = page.locator("section[data-console-more]").and(page.getByRole("group", { exact: true, name: entrada }));
  await expect(secao).toBeVisible();
  return secao;
}
/** O nosso Compartilhar tela so nos navegadores com Chromium; no WebKit, o botao de tela do proprio motor (V2-A39). */
const barraDoMotor = (browserName: string) => (browserName === "chromium" ? [] : ["desktop"]);

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

  test("Abrir a sala (Sessao de pratica), Comecar para todos, Silenciar todos, Trancar a sala e Remover da sala", async ({ browserName, page }) => {
    const ambiente = ambienteDaSalaAoVivo();
    const sala = await abrirConsole(page);

    // A tela cheia (docs/31 V2-13): sem a barra lateral nem as areas do admin; a seta leva de volta ao editor.
    await expect(page.locator("[data-console-root]")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Menu do admin" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Áreas do admin" })).toHaveCount(0);
    await expect(page.getByRole("link", { exact: true, name: WEBINAR_ADMIN_COPY.console.backToEditor })).toHaveAttribute("href", webinarAdminHref(id));
    const topo = page.locator('[data-console-slot="top"]');

    await topo.getByRole("button", { exact: true, name: consoleAoVivo.abrirSala }).click();
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
    // A barra de quem apresenta e nossa (docs/31 V2-14): o iframe sem a do motor, sem os atalhos, e o ⋮ da miniatura
    // avisando o Liberar e o Remover.
    expect(montagem.configOverwrite.toolbarButtons).toEqual(barraDoMotor(browserName));
    expect(montagem.configOverwrite).not.toHaveProperty("toolbarConfig");
    expect(montagem.configOverwrite.disableShortcuts).toBe(true);
    expect(montagem.configOverwrite.participantMenuButtonsWithNotifyClick).toEqual([
      { key: "ask-unmute", preventExecution: true },
      { key: "kick", preventExecution: true }
    ]);
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
    await topo.getByRole("button", { exact: true, name: consoleAoVivo.comecarParaTodos }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).status).toBe("live");
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([false]);

    // Silenciar todos fica na aba Pessoas (docs/31 V2-14), com as linhas de quem esta na sala.
    const pessoas = await abrirAba(page, consoleV2.abas.pessoas);
    antes = (await sala.comandos()).length;
    await pessoas.getByRole("button", { exact: true, name: consoleAoVivo.silenciarTodos }).click();
    expect((await sala.esperarComando("muteEveryone", { depoisDe: antes })).args).toEqual(["audio"]);

    // Trancar a sala fica no topo (V2-13), com o estado no aria-pressed.
    antes = (await sala.comandos()).length;
    await topo.getByRole("button", { exact: true, name: consoleAoVivo.trancar }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).room_locked).toBe(true);
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([true]);
    await expect(topo.getByRole("button", { exact: true, name: consoleAoVivo.destrancar })).toHaveAttribute("aria-pressed", "true");
    antes = (await sala.comandos()).length;
    await topo.getByRole("button", { exact: true, name: consoleAoVivo.destrancar }).click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).room_locked).toBe(false);
    expect((await sala.esperarComando("toggleLobby", { depoisDe: antes })).args).toEqual([false]);

    // A aluna aparece na sala; Remover da sala grava o banimento da sessao e tira o participante do iframe.
    const aluna = await contaDeTeste("aluna");
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_NA_SALA });
    const linha = pessoas.locator(`[data-live-participant="${ALUNA_NA_SALA}"]`);
    await expect(linha).toHaveAttribute("data-live-user", aluna.id, { timeout: 15_000 });
    await expect(linha).toBeVisible();
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

    // O Gravar da barra de quem apresenta (V2-14), com o estado em aria-pressed.
    const gravar = barraDe(page).getByRole("button", { exact: true, name: consoleAoVivo.gravar });
    await expect(gravar).toBeEnabled({ timeout: 15_000 });
    await expect(gravar).toHaveAttribute("aria-pressed", "false");
    const antes = (await sala.comandos()).length;
    await gravar.click();
    expect((await sala.esperarComando("startRecording", { depoisDe: antes })).args).toEqual([{ mode: "file" }]);

    const clique = Date.now();
    await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).recording_anchor_at !== null, { timeout: 15_000 }).toBe(true);
    const sessao = await sessaoAoVivoNoBanco();
    expect(sessao.recorder_status).toBe("recording");
    expect(Math.abs(Date.parse(sessao.recording_anchor_at ?? "") - clique)).toBeLessThan(60_000);
    // O selo Gravando e o do palco (docs/31 V2-4), em cima a esquerda, por cima do video.
    await expect(page.locator('[data-console-slot="stage"]').getByTestId("live-recording")).toBeVisible();
    // Gravando: o circulo ligado, e o clique para.
    await expect(gravar).toHaveAttribute("aria-pressed", "true");
    const antesDeParar = (await sala.comandos()).length;
    await gravar.click();
    expect((await sala.esperarComando("stopRecording", { depoisDe: antesDeParar })).args).toEqual(["file"]);
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
    // A situacao do gravador fica no ⋯ › Gravação do painel (docs/31 V2-15).
    const gravacao = await abrirNoMais(page, consoleV2.entradas.gravacao);
    await expect(gravacao.getByText(/Preparando a gravação/).first()).toBeVisible();

    const antes = (await sala.comandos()).length;
    const gravar = barraDe(page).getByRole("button", { exact: true, name: consoleAoVivo.gravar });
    await expect(gravar).toBeEnabled({ timeout: 15_000 });
    await gravar.click();
    await expect.poll(async () => (await sessaoAoVivoNoBanco()).recording_requested_at !== null).toBe(true);
    await expect(gravacao.getByText(consoleAoVivo.gravarNaFila).first()).toBeVisible({ timeout: 15_000 });
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
    await expect(page.locator('[data-console-slot="stage"]').getByTestId("live-recording")).toBeVisible();
  });

  test("Configurações do console: a engrenagem do motor so de aparelhos; o painel (logo depois do botao da barra) troca o microfone, o alto-falante e (com a camera ligada pela barra) a camera pelo id; ruido, fundo e espelho sao acoes sem estado e nada e reaplicado; sem setVideoQuality; Esc e o proprio botao fecham com o foco no botao", async ({ browserName, page }) => {
    const sala = await abrirConsole(page);
    const montagem = await entrarComoApresentador(sala);

    // O iframe de quem apresenta sem a barra do motor (a nossa barra), com a engrenagem do motor so de aparelhos (o
    // dialogo de fundo do Mais opções de fundo). O Apresentador entra com a captura inicial so do microfone
    // (startWithVideoMuted): o duble nasce com o microfone liberado e a camera nao, como o navegador.
    expect(montagem.configOverwrite.toolbarButtons).toEqual(barraDoMotor(browserName));
    expect(montagem.configOverwrite).not.toHaveProperty("toolbarConfig");
    expect(montagem.configOverwrite).not.toHaveProperty("disableInitialGUM");
    expect(montagem.interfaceConfigOverwrite.SETTINGS_SECTIONS).toEqual(["devices"]);

    // O botao Configurações da barra de quem apresenta.
    const botao = barraDe(page).getByRole("button", { exact: true, name: consoleAoVivo.configuracoes });
    await expect(botao).toHaveAttribute("aria-expanded", "false");
    await botao.click();
    await expect(botao).toHaveAttribute("aria-expanded", "true");
    const card = page.locator("[data-live-settings]");
    await expect(card).toBeVisible();
    await expect(botao).toHaveAttribute("aria-controls", (await card.getAttribute("id")) ?? "");
    await sala.esperarComando("getAvailableDevices");

    // A camera nunca ligada neste navegador: sem a lista de cameras, a frase de liga-la pela barra (e nada de
    // desfocar, que so vale com o video no ar).
    await expect(card).toContainText(aoVivo.config.cameraAguardando);
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

    // Reduzir ruído: Ligar / Desligar, sem caixa marcada (a propria tag desliga o ruido na troca do microfone).
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    antes = (await sala.comandos()).length;
    await card.getByRole("button", { exact: true, name: aoVivo.config.ruidoLigar }).click();
    expect((await sala.esperarComando("setNoiseSuppressionEnabled", { depoisDe: antes })).args).toEqual([{ enabled: true }]);

    // Trocar o microfone nao reaplica o ruido (a propria tag desliga o ruido na troca; quem apresenta liga de novo aqui).
    antes = (await sala.comandos()).length;
    await microfone.selectOption({ label: "Fone USB" });
    expect((await sala.esperarComando("setAudioInputDevice", { depoisDe: antes })).args).toEqual(["", "mic-usb"]);
    await sala.esperarComando("trocaConcluida", { depoisDe: antes });
    await page.waitForTimeout(1_000);
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "setNoiseSuppressionEnabled")).toBe(false);

    // A camera ligada pela nossa barra (toggleVideo; o eco do motor liga o circulo e a permissao): a lista chega com os
    // nomes e a troca vai so pelo id. Quem apresenta nao passa pelo aviso de gravacao do aluno.
    const circuloDaCamera = barraDe(page).getByRole("button", { exact: true, name: aoVivo.camera });
    antes = (await sala.comandos()).length;
    await circuloDaCamera.click();
    await sala.esperarComando("toggleVideo", { depoisDe: antes });
    await expect(circuloDaCamera).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("live-camera-dialog")).toHaveCount(0);
    const camera = card.getByRole("combobox", { exact: true, name: aoVivo.camera });
    await expect(camera.locator("option", { hasText: "Webcam USB" })).toHaveCount(1);
    await expect(card).not.toContainText(aoVivo.config.cameraAguardando);
    antes = (await sala.comandos()).length;
    await camera.selectOption({ label: "Webcam USB" });
    expect((await sala.esperarComando("setVideoInputDevice", { depoisDe: antes })).args).toEqual(["", "cam-usb"]);
    await sala.esperarComando("trocaConcluida", { depoisDe: antes });

    // Desfocar o fundo e Tirar o efeito do fundo, acoes sem estado; fechar e abrir a camera nao reaplica o desfoque (o
    // iframe cria a faixa nova com o efeito; e quem apresenta pode ter trocado o fundo no dialogo do motor).
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

    // As Configurações vem logo depois do botao no teclado (o botao fica na barra, embaixo do palco; o painel abre por
    // cima do palco).
    const ordem = await page.evaluate(() => {
      const cartao = document.querySelector("[data-live-settings]");
      const botaoDoCard = document.querySelector('[aria-controls="console-live-settings"]');
      const palco = document.querySelector("[data-live-stage]");
      return cartao && botaoDoCard && palco
        ? Boolean(botaoDoCard.compareDocumentPosition(cartao) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(palco.compareDocumentPosition(botaoDoCard) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false;
    });
    expect(ordem, "o palco, o botao e o card, nessa ordem").toBe(true);

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

  test("a barra de quem apresenta (docs/31 V2-14): Microfone, Câmera e Compartilhar tela pelo eco do motor, um clique um comando; a Sala de espera com Admitir todos; o Palco para todos manda setTileView; o ⋮ da miniatura: o Liberar vira askToUnmute e o Remover de quem nao esta na lista da sessao sai pelo motor, com o aviso", async ({ browserName, page }) => {
    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);
    const barra = barraDe(page);
    await expect(page.getByRole("navigation", { name: WEBINAR_COPY.consoleV2.barra.rotulo })).toBeVisible();

    // Microfone: o comando sai uma vez e o estado vem do eco do motor (audioMuteStatusChanged), nunca do clique.
    const microfone = barra.getByRole("button", { exact: true, name: aoVivo.microfone });
    await expect(microfone).toHaveAttribute("aria-pressed", "false");
    let antes = (await sala.comandos()).length;
    await microfone.click();
    expect((await sala.esperarComando("toggleAudio", { depoisDe: antes })).args).toEqual([]);
    await expect(microfone).toHaveAttribute("aria-pressed", "true");
    expect((await sala.comandos()).slice(antes).filter((item) => item.comando === "toggleAudio")).toHaveLength(1);

    // Câmera: toggleVideo e o eco; quem apresenta nao passa pelo aviso de gravacao do aluno.
    const camera = barra.getByRole("button", { exact: true, name: aoVivo.camera });
    antes = (await sala.comandos()).length;
    await camera.click();
    await sala.esperarComando("toggleVideo", { depoisDe: antes });
    await expect(camera).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("live-camera-dialog")).toHaveCount(0);

    // Compartilhar tela: o nosso circulo so com Chromium (no WebKit, o botao de tela do proprio motor, V2-A39). O eco
    // liga e desliga; o vigia nunca para a tela do proprio console.
    const tela = barra.getByRole("button", { exact: true, name: WEBINAR_COPY.consoleV2.barra.compartilharTela });
    if (browserName === "chromium") {
      antes = (await sala.comandos()).length;
      await tela.click();
      expect((await sala.esperarComando("toggleShareScreen", { depoisDe: antes })).args).toEqual([{ enable: true }]);
      await expect(tela).toHaveAttribute("aria-pressed", "true");
      antes = (await sala.comandos()).length;
      await tela.click();
      expect((await sala.esperarComando("toggleShareScreen", { depoisDe: antes })).args).toEqual([{ enable: false }]);
      await expect(tela).toHaveAttribute("aria-pressed", "false");
      expect((await sala.comandos()).filter((item) => item.comando === "muteRemoteParticipant" && item.args[1] === "desktop")).toEqual([]);
    } else {
      await expect(tela).toHaveCount(0);
    }

    // A Sala de espera: quem bate aparece na pilula da barra, e Admitir todos admite cada um.
    await sala.disparar("knockingParticipant", { participant: { id: "batendo-0005", name: "Caio T." } });
    const espera = barra.locator('[data-console-lobby="knocking"]');
    await expect(espera).toContainText(WEBINAR_COPY.consoleV2.barra.salaDeEspera(1));
    antes = (await sala.comandos()).length;
    await espera.getByRole("button", { exact: true, name: consoleAoVivo.admitirTodos }).click();
    expect((await sala.esperarComando("answerKnockingParticipant", { depoisDe: antes })).args).toEqual(["batendo-0005", true]);
    await expect(espera).toHaveCount(0);

    // O Palco para todos: a Grade manda setTileView no proprio iframe (o seguir a visao leva a todos), e o botao diz o
    // que o motor mostra.
    await barra.getByRole("button", { exact: true, name: WEBINAR_COPY.consoleV2.visao.palcoParaTodos }).click();
    antes = (await sala.comandos()).length;
    await page.getByRole("menuitemradio", { exact: true, name: WEBINAR_COPY.salaV2.visao.grade }).click();
    expect((await sala.esperarComando("setTileView", { depoisDe: antes })).args).toEqual([true]);
    await sala.disparar("tileViewChanged", { enabled: true });
    await expect(barra.getByRole("button", { exact: true, name: WEBINAR_COPY.consoleV2.visao.gradeParaTodos })).toBeVisible();

    // O ⋮ da miniatura do motor so avisa: o "Pedir para ligar o microfone" vira o nosso Liberar.
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_NA_SALA });
    antes = (await sala.comandos()).length;
    await sala.disparar("participantMenuButtonClick", { key: "ask-unmute", participantId: ALUNA_NA_SALA, preventExecution: true });
    expect((await sala.esperarComando("askToUnmute", { depoisDe: antes })).args).toEqual([ALUNA_NA_SALA]);

    // O Remover de quem ainda nao aparece na lista da sessao (sem webinar_room_joined), com o papel de participante pelo
    // getRoomsInfo: sai pelo motor na hora, e o console avisa que a pessoa pode voltar.
    antes = (await sala.comandos()).length;
    await sala.disparar("participantJoined", { displayName: "Visitante T.", id: SEM_REGISTRO });
    await sala.esperarComando("getRoomsInfo", { depoisDe: antes });
    await page.waitForTimeout(500);
    antes = (await sala.comandos()).length;
    await sala.disparar("participantMenuButtonClick", { key: "kick", participantId: SEM_REGISTRO, preventExecution: true });
    expect((await sala.esperarComando("kickParticipant", { depoisDe: antes })).args).toEqual([SEM_REGISTRO]);
    await expect(page.getByText(WEBINAR_COPY.consoleV2.pessoas.removidoSemRegistro)).toBeVisible();
    await expect(page.locator(`[data-live-participant="${SEM_REGISTRO}"]`)).toHaveCount(0);
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

  test("o tema do console (docs/31 V2-12): escuro por padrao, Tema claro troca a raiz na hora e fica guardado ao recarregar; o iframe monta no tema guardado e trocar com a sala no ar nao remonta; a confirmacao de Encerrar live abre no portal da raiz", async ({ page }) => {
    const tema = WEBINAR_COPY.salaV2.tema;
    const sala = await abrirConsole(page);
    const raiz = page.locator("[data-console-root]");

    // A sessao esta no ar: o console entra sozinho, no tema de antes de escolher (escuro).
    await expect(raiz).toHaveAttribute("data-room-theme", "dark");
    expect((await sala.esperarMontada()).configOverwrite[THEME_HASH_KEY]).toBe("dark");
    await page.getByRole("button", { exact: true, name: tema.claro }).click();
    await expect(raiz).toHaveAttribute("data-room-theme", "light");
    await expect(page.getByRole("button", { exact: true, name: tema.escuro })).toBeVisible();
    expect(await sala.montagens(), "trocar o tema nao remonta a sala").toBe(1);
    // So a raiz do console muda: o documento continua sem o atributo.
    expect(await page.locator("html").getAttribute("data-room-theme")).toBeNull();

    // Recarregar mantem o claro (a chave propria do console), e o iframe monta nele.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(raiz).toHaveAttribute("data-room-theme", "light");
    const montagem = await sala.esperarMontada();
    expect(montagem.configOverwrite[THEME_HASH_KEY]).toBe("light");
    await sala.disparar("videoConferenceJoined", { displayName: "Produtor T.", id: APRESENTADOR, roomName });
    await sala.disparar("participantRoleChanged", { id: APRESENTADOR, role: "moderator" });
    await page.getByRole("button", { exact: true, name: tema.escuro }).click();
    await expect(raiz).toHaveAttribute("data-room-theme", "dark");
    expect(await sala.montagens(), "com a sala no ar, o iframe continua o mesmo").toBe(1);

    // A confirmacao de Encerrar live abre dentro da raiz (no portal do console, no tema dela); Cancelar fecha sem
    // encerrar.
    await page.getByRole("button", { exact: true, name: tema.claro }).click();
    await page.locator('[data-console-slot="top"]').getByRole("button", { exact: true, name: consoleAoVivo.encerrarLive }).click();
    const confirmacao = page.locator("[data-console-root] [data-console-portal]").getByRole("dialog");
    await expect(confirmacao).toBeVisible();
    await expect(confirmacao.getByText(consoleAoVivo.encerrarConfirmar)).toBeVisible();
    await confirmacao.getByRole("button", { exact: true, name: consoleAoVivo.cancelar }).click();
    await expect(confirmacao).toHaveCount(0);
    expect((await sessaoAoVivoNoBanco()).status).toBe("live");
  });

  test("a coluna de miniaturas do Apresentador fica com o motor (docs/31 V2-A5): a 1280 px, com o iframe abaixo de 1013 px, o console do host nunca manda toggleFilmStrip, e os presentes em cima a direita descontam a coluna", async ({ page }) => {
    // A 1280 px o painel tem 360 px: o iframe fica com cerca de 872 px, abaixo dos 1013 px que a coluna pede.
    await page.setViewportSize({ height: 720, width: 1280 });
    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);
    const palco = page.locator('[data-console-slot="stage"]');
    expect(await palco.locator("[data-live-stage]").evaluate((elemento) => Math.round(elemento.getBoundingClientRect().width))).toBeLessThan(1013);

    // O motor mostra a coluna (o padrao dele): o console do Apresentador nao a tira, e os selos param antes dela.
    await sala.disparar("filmstripDisplayChanged", { visible: true });
    const margemDosSelos = () => palco.evaluate((elemento) => (elemento as HTMLElement).style.getPropertyValue("--room-video-right").trim());
    await expect.poll(margemDosSelos).toBe("222px");
    await expect(palco.locator('[data-room-badges="top-right"]')).toBeVisible();
    await page.waitForTimeout(1_500);
    expect((await sala.comandos()).filter((item) => item.comando === "toggleFilmStrip"), "nenhum toggleFilmStrip do Apresentador").toEqual([]);

    // Na Grade nao ha coluna: os selos vao ate a borda, e nada muda no motor.
    await sala.disparar("tileViewChanged", { enabled: true });
    await expect.poll(margemDosSelos).toBe("0px");
    await sala.disparar("tileViewChanged", { enabled: false });
    await expect.poll(margemDosSelos).toBe("222px");
    expect((await sala.comandos()).filter((item) => item.comando === "toggleFilmStrip")).toEqual([]);
    expect(await sala.montagens(), "o mesmo iframe").toBe(1);
  });

  test("o painel com abas (docs/31 V2-15): Mãos com o numero na barra abre a aba Mãos, Abaixar todas as mãos manda um sinal so, para todos; o microfone da linha pelo participantMuted; Lançar enquete abre o ⋯ › Enquetes; o Gravar por preparar abre o ⋯ › Gravação", async ({ page }) => {
    // O gravador por preparar (nada pedido), como antes da primeira gravacao.
    unwrap(
      await createLocalAdminClient()
        .from("webinar_sessions")
        .update({ recorder_release_requested_at: null, recorder_requested_at: null, recorder_status: "none", recording_anchor_at: null, recording_requested_at: null })
        .eq("id", sessaoId),
      "Voltando o gravador para por preparar"
    );
    const sala = await abrirConsole(page);
    await entrarComoApresentador(sala);
    const barra = barraDe(page);

    // A aluna levanta a mao: o circulo Mãos da barra mostra quantas e, no clique, o painel abre na aba Mãos, com o foco
    // nela.
    await sala.disparar("participantJoined", { displayName: "Aluna T.", id: ALUNA_NA_SALA });
    const maosSemNinguem = barra.getByRole("button", { exact: true, name: consoleV2.barra.maos(0) });
    await expect(maosSemNinguem).toBeVisible();
    await sala.disparar("raiseHandUpdated", { handRaised: Date.now(), id: ALUNA_NA_SALA });
    const maos = barra.getByRole("button", { exact: true, name: consoleV2.barra.maos(1) });
    await expect(maos).toBeVisible();
    await expect(maos.locator("[data-console-hands-count]")).toHaveText("1");
    await maos.click();
    const abaMaos = page.getByRole("tab", { name: /^Mãos/ });
    await expect(abaMaos).toHaveAttribute("aria-selected", "true");
    await expect(abaMaos).toHaveText(`${consoleV2.abas.maos} 1`);
    await expect(abaMaos).toBeFocused();
    const painelMaos = page.locator(`#${(await abaMaos.getAttribute("aria-controls")) ?? ""}`);
    await expect(painelMaos.locator(`[data-live-hand="${ALUNA_NA_SALA}"]`)).toBeVisible();

    // Abaixar todas as mãos: um sinal so, com o destino vazio (cada aluno so abaixa a propria mao levantada).
    let antes = (await sala.comandos()).length;
    await painelMaos.getByRole("button", { exact: true, name: consoleAoVivo.abaixarTodas }).click();
    expect((await sala.esperarComando("sendEndpointTextMessage", { depoisDe: antes })).args).toEqual(["", lowerHandMessage()]);
    await page.waitForTimeout(500);
    expect((await sala.comandos()).slice(antes).filter((item) => item.comando === "sendEndpointTextMessage")).toHaveLength(1);
    await expect(barra.getByRole("button", { exact: true, name: consoleV2.barra.maos(0) })).toBeVisible();

    // O microfone de cada linha da aba Pessoas vem do participantMuted (sem sinal, desligado).
    const pessoas = await abrirAba(page, consoleV2.abas.pessoas);
    const linha = pessoas.locator(`[data-live-participant="${ALUNA_NA_SALA}"]`);
    await expect(linha.locator("[data-live-mic]")).toHaveAttribute("data-live-mic", "off");
    await sala.disparar("participantMuted", { id: ALUNA_NA_SALA, isMuted: false, mediaType: "audio" });
    await expect(linha.locator("[data-live-mic]")).toHaveAttribute("data-live-mic", "on");
    await expect(linha).toContainText(consoleV2.pessoas.midia.microfoneLigado);

    // Lançar enquete abre o ⋯ › Enquetes (a secao na tela, o foco no ⋯ com o nome dela).
    await barra.getByRole("button", { exact: true, name: consoleV2.barra.lancarEnquete }).click();
    await expect(page.locator('section[aria-label="Enquetes"]')).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: consoleV2.maisEscolhido(consoleV2.entradas.enquetes) })).toBeFocused();
    await expect(pessoas).toBeHidden();

    // O Gravar com o gravador por preparar abre o ⋯ › Gravação, onde fica o Preparar.
    const gravar = barra.getByRole("button", { exact: true, name: consoleAoVivo.gravar });
    await expect(gravar).toHaveAttribute("aria-controls", "console-panel");
    antes = (await sala.comandos()).length;
    await gravar.click();
    const gravacao = page.locator('section[aria-label="Gravação"]');
    await expect(gravacao).toBeVisible();
    await expect(gravacao.getByRole("button", { exact: true, name: consoleAoVivo.prepararGravacao })).toBeVisible();
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "startRecording"), "abrir o painel nao grava").toBe(false);

    // O X fecha o painel (montado) e o foco vai ao balao da barra.
    await page.getByRole("button", { exact: true, name: consoleV2.fecharPainel }).click();
    await expect(page.locator("#console-panel")).toBeHidden();
    await expect(barra.getByRole("button", { exact: true, name: consoleV2.painel.mostrar })).toBeFocused();
    expect(await sala.montagens(), "abrir e fechar o painel nao remonta a sala").toBe(1);
  });
});
