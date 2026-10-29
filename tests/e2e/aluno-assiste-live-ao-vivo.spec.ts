import type { Locator, Page } from "@playwright/test";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  ambienteDaSalaAoVivo,
  eventosDaLiveAoVivo,
  expect,
  salaFalsaDoJitsi,
  seedLiveAoVivoDeTeste,
  test,
  zerarHistoricoDeWebinarios
} from "./fixtures";

// Webinarios, fase 3 (docs/30 §1.3, §1.7, §5.4, §6.3, §8.4, §8.5 e §10.2): a aluna entra na Live ao vivo pela pagina
// da live (Entrar) e pelo "Entrar na sala" do palco. O external_api.js do Jitsi proprio e o de mentira
// (salaFalsaDoJitsi, servido no endereco real do hostname de teste): o construtor recebe a sala, o token (conferido com
// o segredo de teste) e o configOverwrite do aluno, sem a barra do iframe (a barra e a nossa) e sem startSilent. A
// camera passa pelo aviso de gravacao e do consumo antes do toggleVideo (e webinar_camera_toggled e gravado com o
// aceite), a mao levantada vai por toggleRaiseHand, o microfone liberado pelo apresentador abre o aviso com Falar /
// Agora não e so o Falar manda toggleAudio. O chat e as reacoes sao os nossos; nenhum texto da pagina cita o Jitsi; a
// 375 px a sala cabe sem rolagem lateral e os botoes da barra tem 44 px. A IA Diretor fica na pagina da live e some na
// sala (o botao flutuante cobria o Enviar do chat e o X da pilula); o cabecalho da sala tem a marca da escola e, a 375 px
// com a gravacao ligada, o tempo curto e o ponto do Gravando cabem antes de Minimizar; a 667 px (celular deitado) o
// Icone da escola fica no lugar da logo e os selos inteiros terminam antes do "{n} assistindo". O botao Configurações
// abre o painel de som e aparelhos: antes da liberacao nada troca de aparelho (nem pede o microfone); depois do Falar o
// microfone escolhido chega a sala so pelo id, o alto-falante tambem, a camera so depois do aviso de gravacao,
// Reduzir ruído e Economizar dados viram os comandos do iframe (o ruido so depois que a faixa nova entra) e nenhuma
// troca vira "a equipe fechou" nem linha no historico; a Câmera tocada no meio de uma troca espera a faixa nova; a
// equipe que silencia logo depois da troca do microfone chega como a equipe, e o foco do controle que some com a secao
// vai ao Fechar; a 375 x 667 o painel aberto deixa a barra na tela e o Esc e o proprio botao devolvem o foco ao botao.
// O Falar segura o "ligado" do iframe ate o microfone abrir de verdade, com ou sem a permissao do site (o microfone que
// nao abre nunca vira "ligado" na barra nem no historico), o pedido acaba na queda e o painel diz que falta a permissao
// (nunca "nenhum aparelho"); na volta depois de uma queda, a Câmera tocada no meio da troca da camera desligada espera a
// faixa da troca, e o botao que espera mostra o estado real com o circulo girando e a frase do que vem.

const { roomName, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const aoVivo = WEBINAR_COPY.aoVivo;
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
const PARTICIPANTE = "aluna-na-sala-0001";
/** O botao flutuante da IA Diretor (PlatformDirectorLauncher em src/components/app-shell.tsx). */
const IA_DIRETOR = "Abrir IA Diretor";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveAoVivoDeTeste(db, { comecouHa: 5 * 60_000, status: "live" });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** Pagina da live -> Entrar -> a sala -> Entrar na sala; o iframe falso entra e confirma a entrada (videoConferenceJoined). */
async function entrarNaSala(page: Page, opcoes: Parameters<typeof salaFalsaDoJitsi>[1] = {}) {
  const sala = await salaFalsaDoJitsi(page, opcoes);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  // Na pagina da live a IA Diretor continua no canto.
  await expect(page.getByRole("button", { exact: true, name: IA_DIRETOR })).toBeVisible();
  // A faixa "Ao vivo agora" (fora do <main>) tambem tem um Entrar: o da pagina da live e o do miolo.
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);

  const dialogo = page.getByRole("dialog", { name: titulo });
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  const token = page.waitForResponse((response) => response.url().endsWith("/join-token") && response.request().method() === "POST");
  await dialogo.getByRole("button", { exact: true, name: aoVivo.entrarNaSala }).click();
  expect((await token).status()).toBe(200);

  const montagem = await sala.esperarMontada();
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();
  // Na sala o botao da IA Diretor nao existe (docs/30 §1.3): nem fechado, nem o do chat aberto.
  await expect(page.getByRole("button", { name: /IA Diretor/ })).toHaveCount(0);

  return { dialogo, montagem, sala };
}

test("Entrar na sala: o construtor recebe a sala, o token e a barra vazia; camera com o aviso, mao levantada e o microfone liberado com Falar; nada cita o Jitsi", async ({ page }) => {
  const ambiente = ambienteDaSalaAoVivo();
  const { dialogo, montagem, sala } = await entrarNaSala(page);
  // Dentro da sala a faixa "Ao vivo agora" nunca aparece (docs/30 §1.1).
  await expect(page.getByRole("complementary", { name: WEBINAR_COPY.faixa.rotulo })).toHaveCount(0);
  // A sala cobre o topo da area: no computador, a logo da escola no cabecalho da sala, sem link (sair passa pela
  // confirmacao).
  await expect(dialogo.getByRole("img", { name: "Bunker707" })).toBeVisible();
  await expect(dialogo.getByRole("link", { name: "Bunker707" })).toHaveCount(0);

  // O external_api.js do nosso hostname, uma vez; o iframe no palco com o nosso titulo e o allow de §8.4.
  expect(sala.pedidosDoScript()).toBe(1);
  expect(montagem.dominio).toBe(ambiente.WEBINAR_MEET_DOMAIN);
  expect(montagem.roomName).toBe(roomName);
  expect(montagem.noPalco).toBe(true);
  const iframe = dialogo.locator("[data-live-frame] iframe");
  await expect(iframe).toHaveAttribute("title", aoVivo.palco);
  await expect(iframe).toHaveAttribute("allow", "camera; microphone; display-capture; autoplay; fullscreen; speaker-selection");

  const claims = verifyJitsiToken(montagem.jwt ?? "", ambiente.WEBINAR_JWT_SECRET) as { context: { features?: unknown; user: { moderator?: boolean } }; room: string; sub: string } | null;
  expect(claims).not.toBeNull();
  expect(claims?.room).toBe(roomName);
  expect(claims?.sub).toBe(ambiente.WEBINAR_MEET_DOMAIN);
  expect(claims?.context.user.moderator).toBeUndefined();
  expect(claims?.context.features).toEqual({ livestreaming: false, "outbound-call": false, recording: false, "screen-sharing": false });

  // A barra do iframe some (a nossa barra passa pelo aviso de gravacao); tudo mudo ao entrar, sem startSilent.
  const config = montagem.configOverwrite;
  expect(config.toolbarButtons).toEqual([]);
  expect(config).toMatchObject({
    disableChat: true,
    disableInitialGUM: true,
    // O espelho so pelo nosso painel: sem o "Flip" do menu da propria miniatura.
    disableLocalVideoFlip: true,
    disablePolls: true,
    disableReactions: true,
    disableShortcuts: true,
    lobby: { autoKnock: true },
    readOnlyName: true,
    startWithAudioMuted: true,
    startWithVideoMuted: true
  });
  expect(config).not.toHaveProperty("startSilent");
  // Sem engrenagem nem barra sempre visivel do iframe para o aluno: as configuracoes sao as nossas.
  expect(config).not.toHaveProperty("toolbarConfig");
  expect(montagem.interfaceConfigOverwrite).not.toHaveProperty("SETTINGS_SECTIONS");
  expect(config.constraints).toEqual({ video: { height: { ideal: 360, max: 360, min: 180 } } });

  // Camera: o primeiro clique abre o aviso de gravacao e o consumo; so Ligar câmera chega a sala.
  await dialogo.getByRole("button", { exact: true, name: aoVivo.camera }).click();
  const avisoCamera = page.getByTestId("live-camera-dialog");
  await expect(avisoCamera).toBeVisible();
  await expect(avisoCamera).toContainText(aoVivo.avisoCamera);
  await expect(avisoCamera).toContainText(aoVivo.avisoCameraConsumo);
  expect((await sala.comandos()).some((item) => item.comando === "toggleVideo")).toBe(false);
  await avisoCamera.getByRole("button", { exact: true, name: aoVivo.ligarCamera }).click();
  await sala.esperarComando("toggleVideo");
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.camera })).toHaveAttribute("aria-pressed", "true");

  // Levantar a mao: toggleRaiseHand e a sala responde raiseHandUpdated do proprio participante.
  await dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao }).click();
  await sala.esperarComando("toggleRaiseHand");
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.abaixarMao })).toHaveAttribute("aria-pressed", "true");

  // O apresentador libera o microfone desta aluna: o aviso de gravacao com Falar / Agora não; so o Falar liga.
  const antes = (await sala.comandos()).length;
  await sala.disparar("moderationParticipantApproved", { id: PARTICIPANTE, mediaType: "audio" });
  const avisoMicrofone = page.getByTestId("live-mic-dialog");
  await expect(avisoMicrofone).toBeVisible();
  await expect(avisoMicrofone).toContainText(aoVivo.avisoMicrofone);
  await expect(avisoMicrofone.getByRole("button", { exact: true, name: aoVivo.agoraNao })).toBeVisible();
  // Abriu sozinho: o foco fica em Agora não (o Enter de quem digitava no chat nao liga o microfone).
  await expect(avisoMicrofone.getByRole("button", { exact: true, name: aoVivo.agoraNao })).toBeFocused();
  expect((await sala.comandos()).slice(antes).some((item) => item.comando === "toggleAudio")).toBe(false);
  await avisoMicrofone.getByRole("button", { exact: true, name: aoVivo.falar }).click();
  await sala.esperarComando("toggleAudio", { depoisDe: antes });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.microfone })).toHaveAttribute("aria-pressed", "true");

  // Os sinais do iframe viram registros so com codigos (o lote sai a cada 10 s): a camera com o aceite e a mao.
  await expect
    .poll(
      async () => {
        const linhas = await eventosDaLiveAoVivo("aluna");
        return {
          camera: linhas.some((linha) => linha.event_type === "webinar_camera_toggled" && linha.metadata.on === true && linha.metadata.consented === true),
          mao: linhas.some((linha) => linha.event_type === "webinar_hand_raised" && linha.metadata.raised === true)
        };
      },
      { timeout: 30_000 }
    )
    .toEqual({ camera: true, mao: true });

  // Nenhum texto da pagina (nem titulo, rotulo ou dica) cita o motor de video (D2).
  const textos = await page.evaluate(() =>
    [
      document.title,
      document.body.innerText,
      ...Array.from(document.querySelectorAll("[title], [aria-label], [alt], [placeholder]")).flatMap((elemento) =>
        ["title", "aria-label", "alt", "placeholder"].map((atributo) => elemento.getAttribute(atributo) ?? "")
      )
    ].join("\n")
  );
  expect(textos).not.toMatch(/jitsi/i);
});

test("o chat e as reacoes sao os nossos: o aceite na primeira mensagem, a mensagem no chat e Palmas pela nossa rota", async ({ page }) => {
  const { dialogo } = await entrarNaSala(page);

  const campo = dialogo.getByRole("textbox", { name: "Escreva uma mensagem" });
  await campo.fill("olá da sala ao vivo");
  // Em tela de computador o Enviar fica no canto de baixo, onde ficava o botao da IA Diretor: o clique chega nele.
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.enviar }).click();
  const aceite = dialogo.getByRole("group", { name: /Ao enviar mensagens neste chat/ });
  await expect(aceite).toBeVisible();
  const envio = page.waitForResponse((response) => response.url().includes("/api/webinars/") && response.url().endsWith("/chat") && response.request().method() === "POST");
  await aceite.getByRole("button", { exact: true, name: "Entendi e quero participar" }).click();
  expect((await envio).status()).toBe(201);
  await expect(dialogo.getByRole("log").getByText("olá da sala ao vivo")).toBeVisible();

  const reacao = page.waitForResponse((response) => response.url().endsWith("/reactions") && response.request().method() === "POST");
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.reagir }).click();
  await dialogo.getByRole("button", { exact: true, name: "Palmas" }).click();
  expect((await reacao).status()).toBe(201);
});

test("Configurações: antes da liberacao nada troca de aparelho; a camera so depois do aviso, o alto-falante e o microfone so depois do Falar, Reduzir ruído e Economizar dados chegam a sala; nenhuma troca vira aviso falso nem linha no historico", async ({ page }) => {
  // O historico ja tem as linhas dos testes anteriores: so contam os sinais deste teste (`at`, a hora do aparelho).
  const inicio = new Date().toISOString();
  const desteTeste = async () => (await eventosDaLiveAoVivo("aluna")).filter((linha) => typeof linha.metadata.at === "string" && linha.metadata.at >= inicio);
  const { dialogo, sala } = await entrarNaSala(page);
  const config = aoVivo.config;
  const TROCAS = ["setAudioInputDevice", "setAudioOutputDevice", "setVideoInputDevice"];
  const aviso = dialogo.getByTestId("live-notice");

  // O iframe guarda o ruido e o fundo da live anterior: na entrada a sala manda o que o painel mostra (os dois desligados).
  expect((await sala.esperarComando("setNoiseSuppressionEnabled")).args).toEqual([{ enabled: false }]);
  expect((await sala.esperarComando("setVirtualBackground")).args).toEqual([false, ""]);

  // Antes da liberacao: o painel abre, le a lista (sem trocar nada) e explica quando cada escolha aparece.
  const botao = dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes });
  await expect(botao).toHaveAttribute("aria-expanded", "false");
  await botao.click();
  await expect(botao).toHaveAttribute("aria-expanded", "true");
  await expect(botao).toHaveAttribute("aria-controls", "live-room-settings");
  const painel = dialogo.getByTestId("live-settings");
  await expect(painel).toBeVisible();
  await sala.esperarComando("getAvailableDevices");
  await expect(painel).toContainText(config.microfoneAguardando);
  await expect(painel).toContainText(config.cameraAguardando);
  await expect(painel).toContainText(config.altoFalanteAguardando);
  await expect(painel.getByRole("combobox")).toHaveCount(0);
  await expect(painel.getByRole("slider", { name: config.volume })).toBeVisible();
  expect((await sala.comandos()).some((item) => TROCAS.includes(item.comando) || item.comando === "toggleAudio")).toBe(false);

  // Economizar dados: o palco chega em 360p (setVideoQuality); Automática volta para 2160, o valor de entrada do iframe
  // (so nele a tela compartilhada no palco chega sem teto).
  let antes = (await sala.comandos()).length;
  await painel.getByRole("radio", { exact: true, name: config.qualidadeEconomizar }).check();
  expect((await sala.esperarComando("setVideoQuality", { depoisDe: antes })).args).toEqual([360]);
  antes = (await sala.comandos()).length;
  await painel.getByRole("radio", { exact: true, name: config.qualidadeAutomatica }).check();
  expect((await sala.esperarComando("setVideoQuality", { depoisDe: antes })).args).toEqual([2160]);

  // A camera: so depois do aviso de gravacao aceito a escolha aparece; a troca vai so pelo id (com o rotulo, o iframe
  // pegaria o primeiro de rotulo igual) e o mudo da faixa nova nao vira "A equipe fechou a sua câmera".
  await dialogo.getByRole("button", { exact: true, name: aoVivo.camera }).click();
  await page.getByTestId("live-camera-dialog").getByRole("button", { exact: true, name: aoVivo.ligarCamera }).click();
  await sala.esperarComando("toggleVideo");
  const camera = painel.getByRole("combobox", { exact: true, name: aoVivo.camera });
  await expect(camera.locator("option", { hasText: "Webcam USB" })).toHaveCount(1);
  // So a camera liberada: as saidas de som continuam sem nome (no navegador o rotulo delas depende do microfone).
  await expect(painel).toContainText(config.altoFalanteAguardando);
  await expect(painel.getByRole("combobox", { exact: true, name: config.altoFalante })).toHaveCount(0);
  antes = (await sala.comandos()).length;
  await camera.selectOption({ label: "Webcam USB" });
  expect((await sala.esperarComando("setVideoInputDevice", { depoisDe: antes })).args).toEqual(["", "cam-usb"]);
  await sala.esperarComando("trocaConcluida", { depoisDe: antes });
  await page.waitForTimeout(300);
  expect(await aviso.textContent()).not.toContain(aoVivo.cameraFechadaPelaEquipe);
  const botaoCamera = dialogo.getByRole("button", { exact: true, name: aoVivo.camera });
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "true");
  await expect(camera).toHaveValue("cam-usb");

  // Câmera tocada no meio de outra troca (a faixa nova ainda abrindo): o toque espera a troca acabar e vai na faixa
  // nova; na tag ele seria desfeito quando a faixa nova entrasse (a camera voltaria ao ar sozinha). Enquanto espera, o
  // botao mostra o estado REAL (a camera segue no ar), ocupado, com o circulo girando, e a frase diz o que vem. Nada de
  // "A equipe fechou a sua câmera".
  antes = (await sala.comandos()).length;
  await camera.selectOption({ label: "Câmera integrada" });
  await sala.esperarComando("setVideoInputDevice", { depoisDe: antes });
  await botaoCamera.click();
  await expect(botaoCamera).toHaveAttribute("aria-busy", "true");
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "true");
  await expect(botaoCamera).toHaveAttribute("title", aoVivo.desligarCamera);
  await expect(botaoCamera.locator("svg.animate-spin")).toHaveCount(1);
  await expect(aviso).toHaveText(aoVivo.trocandoCameraDesliga);
  await sala.esperarComando("toggleVideo", { depoisDe: antes });
  const ordemDaCamera = (await sala.comandos()).slice(antes).map((item) => item.comando);
  expect(ordemDaCamera.indexOf("trocaConcluida")).toBeGreaterThan(-1);
  expect(ordemDaCamera.indexOf("toggleVideo"), "o toque so depois da faixa nova").toBeGreaterThan(ordemDaCamera.indexOf("trocaConcluida"));
  await expect(botaoCamera).not.toHaveAttribute("aria-busy", "true");
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "false");
  await expect(botaoCamera.locator("svg.animate-spin")).toHaveCount(0);
  await expect(aviso).not.toContainText(aoVivo.trocandoCameraDesliga);
  await page.waitForTimeout(300);
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "false");
  expect(await aviso.textContent()).not.toContain(aoVivo.cameraFechadaPelaEquipe);

  // O microfone: a liberacao do apresentador e o Falar; antes disso, nada de escolha nem de troca.
  await expect(painel.getByRole("combobox", { exact: true, name: aoVivo.microfone })).toHaveCount(0);
  expect((await sala.comandos()).some((item) => item.comando === "setAudioInputDevice" || item.comando === "toggleAudio")).toBe(false);
  await sala.disparar("moderationParticipantApproved", { id: PARTICIPANTE, mediaType: "audio" });
  await page.getByTestId("live-mic-dialog").getByRole("button", { exact: true, name: aoVivo.falar }).click();
  await sala.esperarComando("toggleAudio");
  const botaoMicrofone = dialogo.getByRole("button", { exact: true, name: aoVivo.microfone });
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "true");

  // O alto-falante depois do Falar (o microfone liberou os nomes das saidas): so pelo id.
  const altoFalante = painel.getByRole("combobox", { exact: true, name: config.altoFalante });
  await expect(altoFalante.locator("option", { hasText: "Fone USB" })).toHaveCount(1);
  antes = (await sala.comandos()).length;
  await altoFalante.selectOption({ label: "Fone USB" });
  expect((await sala.esperarComando("setAudioOutputDevice", { depoisDe: antes })).args).toEqual(["", "som-usb"]);

  // Reduzir ruído em objeto ({ enabled }), nunca o toggleNoiseSuppression.
  antes = (await sala.comandos()).length;
  await painel.getByRole("checkbox", { exact: true, name: config.reduzirRuido }).check();
  expect((await sala.esperarComando("setNoiseSuppressionEnabled", { depoisDe: antes })).args).toEqual([{ enabled: true }]);

  // Fone USB: so o id; a troca do microfone nao muda o mudo (como no iframe de verdade); o ruido volta depois que a
  // faixa nova entra (o fone abre em 2 s; mandado antes, iria para a faixa velha e o fone ficaria sem ele).
  const microfone = painel.getByRole("combobox", { exact: true, name: aoVivo.microfone });
  await expect(microfone.locator("option", { hasText: "Fone USB" })).toHaveCount(1);
  antes = (await sala.comandos()).length;
  await microfone.selectOption({ label: "Fone USB" });
  expect((await sala.esperarComando("setAudioInputDevice", { depoisDe: antes })).args).toEqual(["", "mic-usb"]);
  await page.waitForTimeout(300);
  expect(await aviso.textContent()).not.toContain(aoVivo.microfoneSilenciado);
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "true");
  expect((await sala.esperarComando("setNoiseSuppressionEnabled", { depoisDe: antes })).args).toEqual([{ enabled: true }]);
  const ordemDoMicrofone = (await sala.comandos()).slice(antes).map((item) => item.comando);
  expect(ordemDoMicrofone.indexOf("setNoiseSuppressionEnabled"), "o ruido so depois da faixa nova").toBeGreaterThan(ordemDoMicrofone.indexOf("trocaConcluida"));
  expect(ordemDoMicrofone.indexOf("trocaConcluida")).toBeGreaterThan(-1);
  await expect(microfone).toHaveValue("mic-usb");
  expect((await sala.comandos()).some((item) => item.comando === "toggleNoiseSuppression")).toBe(false);

  // Logo depois da troca, com o foco no Reduzir ruído, a equipe usa "Silenciar quem está falando": o aviso da equipe na
  // hora (nenhuma troca aberta engole o mudo), o Microfone sai da barra, a secao vira a frase e o foco, que estava num
  // controle que sumiu, vai ao Fechar: o Esc continua fechando o painel.
  await painel.getByRole("checkbox", { exact: true, name: config.reduzirRuido }).focus();
  await sala.disparar("audioMuteStatusChanged", { muted: true });
  await expect(aviso).toContainText(aoVivo.microfoneSilenciado);
  await expect(botaoMicrofone).toHaveCount(0);
  await expect(painel).toContainText(config.microfoneAguardando);
  await expect(painel.getByRole("button", { exact: true, name: config.fechar })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await expect(botao).toBeFocused();

  // O historico: a mao levantada depois das trocas marca que a fila ja mandou tudo o que veio antes. So o aceite da
  // camera (on + consented), o toque que a desligou depois da troca, o Falar e o silencio da equipe viram linha; as
  // trocas nao geram webinar_camera_toggled nem webinar_mic_toggled.
  await dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao }).click();
  await sala.esperarComando("toggleRaiseHand");
  await expect
    .poll(async () => (await desteTeste()).some((linha) => linha.event_type === "webinar_hand_raised" && linha.metadata.raised === true), { timeout: 30_000 })
    .toBe(true);
  const novas = await desteTeste();
  expect(novas.filter((linha) => linha.event_type === "webinar_camera_toggled").map((linha) => ({ consented: linha.metadata.consented, on: linha.metadata.on }))).toEqual([
    { consented: true, on: true },
    { consented: false, on: false }
  ]);
  expect(novas.filter((linha) => linha.event_type === "webinar_mic_toggled").map((linha) => linha.metadata.on)).toEqual([true, false]);
});

/** Os registros desta parte do teste (`at`, a hora do aparelho em que o sinal saiu). */
function historicoDesde(inicio: string) {
  return async () => (await eventosDaLiveAoVivo("aluna")).filter((linha) => typeof linha.metadata.at === "string" && linha.metadata.at >= inicio);
}

/** A mao levantada e baixada marca que a fila ja mandou tudo o que veio antes (os lotes saem na ordem). */
async function esperarAFilaAteAqui(dialogo: Locator, sala: Awaited<ReturnType<typeof salaFalsaDoJitsi>>, desteTeste: () => Promise<{ event_type: string; metadata: Record<string, unknown> }[]>) {
  const antes = (await sala.comandos()).length;
  await dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao }).click();
  await sala.esperarComando("toggleRaiseHand", { depoisDe: antes });
  await expect
    .poll(async () => (await desteTeste()).some((linha) => linha.event_type === "webinar_hand_raised" && linha.metadata.raised === true), { timeout: 30_000 })
    .toBe(true);
  await dialogo.getByRole("button", { exact: true, name: aoVivo.abaixarMao }).click();
}

test("o Falar com o microfone liberado no site numa live anterior e o microfone que nao abre (o sistema bloqueou o navegador, outro programa o usa): nada de 'ligado' na barra nem no historico, e o aviso de que ele nao abriu", async ({ page }) => {
  const desteTeste = historicoDesde(new Date().toISOString());
  const { dialogo, sala } = await entrarNaSala(page, { microfone: "falha", permissaoDoMicrofone: "granted" });
  const aviso = dialogo.getByTestId("live-notice");

  await sala.disparar("moderationParticipantApproved", { id: PARTICIPANTE, mediaType: "audio" });
  await page.getByTestId("live-mic-dialog").getByRole("button", { exact: true, name: aoVivo.falar }).click();
  await sala.esperarComando("toggleAudio");
  // O iframe mandou o "ligado" (base/media) e o getUserMedia nao abriu: a barra nao acredita no "ligado".
  const botaoMicrofone = dialogo.getByRole("button", { exact: true, name: aoVivo.microfone });
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1_500);
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "false");
  // Com a permissao dada, o prazo e de 5 s: o aviso de que o microfone nao abriu, e o Microfone desligado na barra.
  await expect(aviso).toHaveText(aoVivo.microfoneFalhou, { timeout: 10_000 });
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "false");

  await esperarAFilaAteAqui(dialogo, sala, desteTeste);
  expect((await desteTeste()).filter((linha) => linha.event_type === "webinar_mic_toggled" && linha.metadata.on === true)).toEqual([]);
});

test("o Falar sem a permissao do navegador: o painel diz que falta liberar o acesso (nunca 'nenhum aparelho'); a queda encerra o pedido e o 'ligado' guardado nunca vai para o historico", async ({ page }) => {
  test.setTimeout(150_000);
  const desteTeste = historicoDesde(new Date().toISOString());
  const { dialogo, sala } = await entrarNaSala(page, { microfone: "falha" });
  const config = aoVivo.config;

  await sala.disparar("moderationParticipantApproved", { id: PARTICIPANTE, mediaType: "audio" });
  await page.getByTestId("live-mic-dialog").getByRole("button", { exact: true, name: aoVivo.falar }).click();
  const falouEm = Date.now();
  await sala.esperarComando("toggleAudio");

  // O painel com o pedido do navegador ainda aberto: a frase de liberar o acesso, o alto-falante esperando, sem
  // "Nenhum aparelho encontrado" nem Reduzir ruído.
  await dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes }).click();
  const painel = dialogo.getByTestId("live-settings");
  await expect(painel).toContainText(config.microfoneSemPermissao);
  await expect(painel).toContainText(config.altoFalanteAguardando);
  await expect(painel).not.toContainText(config.semAparelho);
  await expect(painel.getByRole("checkbox", { exact: true, name: config.reduzirRuido })).toHaveCount(0);
  await expect(painel.getByRole("combobox", { exact: true, name: aoVivo.microfone })).toHaveCount(0);
  await dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes }).click();

  // A rede cai com o pedido aberto e nao volta (o join-token sem rede): Reconectando… e "Não conseguimos voltar".
  await page.route("**/join-token", (route) => route.abort());
  await sala.disparar("videoConferenceLeft", {});
  await expect(dialogo.getByText(aoVivo.naoConseguimosVoltar)).toBeVisible({ timeout: 40_000 });
  // Passado o prazo do pedido (30 s), sem iframe nenhum: antes, o "ligado" guardado ia para a fila nesse momento.
  await page.waitForTimeout(Math.max(0, falouEm + 32_000 - Date.now()));

  // A rede volta: Tentar de novo, a sala nova entra (sem o Microfone: quem volta entra mudo) e a fila manda o resto.
  await page.unroute("**/join-token");
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.tentarDeNovo }).click();
  await expect.poll(() => sala.montagens(), { timeout: 20_000 }).toBe(2);
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.microfone })).toHaveCount(0);
  await esperarAFilaAteAqui(dialogo, sala, desteTeste);
  expect((await desteTeste()).filter((linha) => linha.event_type === "webinar_mic_toggled" && linha.metadata.on === true)).toEqual([]);
});

test("a volta depois de uma queda, com a camera desligada: trocar a camera e tocar em Câmera logo depois liga a camera na faixa nova (o toque espera a faixa da troca), sem 'A equipe fechou a sua câmera'", async ({ page }) => {
  test.setTimeout(120_000);
  const { dialogo, sala } = await entrarNaSala(page);
  const aviso = dialogo.getByTestId("live-notice");
  const botaoCamera = dialogo.getByRole("button", { exact: true, name: aoVivo.camera });

  // O aviso de gravacao aceito e a camera ligada e desligada: o navegador deu a permissao da camera a pagina.
  await botaoCamera.click();
  await page.getByTestId("live-camera-dialog").getByRole("button", { exact: true, name: aoVivo.ligarCamera }).click();
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "true");
  await botaoCamera.click();
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "false");

  // A queda e a volta: um iframe novo, que ainda nao teve faixa de camera.
  await sala.disparar("videoConferenceLeft", {});
  await expect.poll(() => sala.montagens(), { timeout: 20_000 }).toBe(2);
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();

  // A webcam USB com a camera desligada e o toque em Câmera logo depois: o iframe ja diz a webcam em uso (o escolhido),
  // mas a faixa da troca ainda esta abrindo; o toque espera, com o botao desligado (o real), ocupado, e a frase.
  await dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes }).click();
  const camera = dialogo.getByTestId("live-settings").getByRole("combobox", { exact: true, name: aoVivo.camera });
  await expect(camera.locator("option", { hasText: "Webcam USB" })).toHaveCount(1);
  const antes = (await sala.comandos()).length;
  await camera.selectOption({ label: "Webcam USB" });
  await sala.esperarComando("setVideoInputDevice", { depoisDe: antes });
  await botaoCamera.click();
  await expect(botaoCamera).toHaveAttribute("aria-busy", "true");
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "false");
  await expect(aviso).toHaveText(aoVivo.trocandoCameraLiga);
  await sala.esperarComando("toggleVideo", { depoisDe: antes, timeout: 20_000 });
  const ordem = (await sala.comandos()).slice(antes).map((item) => item.comando);
  expect(ordem.indexOf("trocaConcluida")).toBeGreaterThan(-1);
  expect(ordem.indexOf("toggleVideo"), "o toque so depois da faixa da troca").toBeGreaterThan(ordem.indexOf("trocaConcluida"));
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "true");
  await expect(botaoCamera).not.toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(500);
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "true");
  expect(await aviso.textContent()).not.toContain(aoVivo.cameraFechadaPelaEquipe);
});

test("a 375 px: a sala cabe sem rolagem lateral, o palco ocupa a largura e a nossa barra tem botoes de 44 px; o cabecalho cabe com o Gravando; o X da pilula fecha a sala", async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 375 });
  const { dialogo, sala } = await entrarNaSala(page);
  await expect(dialogo.getByRole("tab", { name: WEBINAR_COPY.sala.abas.chat })).toBeVisible();

  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);

  const palco = await dialogo.locator("[data-room-stage]").boundingBox();
  expect(palco?.width).toBeGreaterThanOrEqual(360);

  for (const nome of [aoVivo.levantarMao, aoVivo.camera, WEBINAR_COPY.sala.reagir, aoVivo.configuracoes]) {
    const caixa = await dialogo.getByRole("button", { exact: true, name: nome }).boundingBox();
    expect(caixa?.height, nome).toBeGreaterThanOrEqual(44);
    expect(caixa?.width, nome).toBeGreaterThanOrEqual(44);
  }

  // O painel Configurações num celular baixo (375 x 667, com a gaveta do chat aberta): cabe na largura (sem rolagem
  // lateral), a gaveta da lugar ao painel, o palco encolhe e a barra inteira continua na tela (o Configurações, que
  // fecha o painel no toque, e o Som); o Esc com o foco dentro do painel fecha e devolve o foco ao botao.
  await page.setViewportSize({ height: 667, width: 375 });
  const configuracoes = dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes });
  await configuracoes.click();
  const painel = dialogo.getByTestId("live-settings");
  await expect(painel).toBeVisible();
  const caixaDoPainel = await painel.boundingBox();
  expect(caixaDoPainel?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((caixaDoPainel?.x ?? 0) + (caixaDoPainel?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(375);
  const comPainel = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(comPainel.pagina).toBeLessThanOrEqual(comPainel.tela);
  await expect(configuracoes).toBeInViewport({ ratio: 1 });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.som })).toBeInViewport({ ratio: 1 });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.config.fechar })).toBeInViewport({ ratio: 1 });
  // Reagir fecha o painel (os dois nunca abertos juntos) e Configurações o abre de novo.
  await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.reagir }).click();
  await expect(painel).toHaveCount(0);
  await configuracoes.click();
  await expect(dialogo.locator("#live-room-reactions")).toHaveCount(0);
  await expect(painel).toBeVisible();
  // O foco num controle do painel (a faixa de volume): o Esc fecha o painel sem pedir para sair, o foco volta ao botao
  // e a sala continua ouvindo o teclado (o Esc seguinte pede para sair).
  await painel.getByRole("slider", { name: aoVivo.config.volume }).focus();
  await page.keyboard.press("Escape");
  await expect(configuracoes).toHaveAttribute("aria-expanded", "false");
  await expect(painel).toHaveCount(0);
  await expect(configuracoes).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogo.getByRole("alertdialog", { name: WEBINAR_COPY.sala.sairConfirmar })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogo.getByRole("alertdialog", { name: WEBINAR_COPY.sala.sairConfirmar })).toHaveCount(0);
  // Fechar, dentro do painel, tambem devolve o foco ao botao.
  await configuracoes.click();
  await dialogo.getByRole("button", { exact: true, name: aoVivo.config.fechar }).click();
  await expect(painel).toHaveCount(0);
  await expect(configuracoes).toBeFocused();
  // O proprio Configurações fecha com o foco num controle do painel (no WebKit o clique nao foca o botao: o evento sem
  // mover o foco imita isso): o foco vai ao botao, nunca ao body, e o Esc seguinte pede para sair.
  await configuracoes.click();
  await painel.getByRole("slider", { name: aoVivo.config.volume }).focus();
  await configuracoes.dispatchEvent("click");
  await expect(painel).toHaveCount(0);
  await expect(configuracoes).toBeFocused();
  await page.setViewportSize({ height: 740, width: 375 });

  // O cabecalho com a gravacao ligada (o duble avisa, como o gravador): o Icone da escola de 24 px, o tempo curto e so o
  // ponto do Gravando terminam antes de Minimizar, e sobra largura para o titulo.
  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  const cabecalho = dialogo.locator("header").first();
  const gravando = cabecalho.locator(`[title="${aoVivo.gravando}"]`);
  await expect(gravando).toBeVisible();
  const icone = cabecalho.getByRole("img", { name: "Bunker707" });
  await expect(icone).toBeVisible();
  const minimizar = cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.minimizar });
  const caixas = {
    gravando: await gravando.boundingBox(),
    icone: await icone.boundingBox(),
    minimizar: await minimizar.boundingBox(),
    noAr: await cabecalho.locator('[title^="Ao vivo"]').boundingBox(),
    titulo: await cabecalho.getByRole("heading", { level: 1 }).boundingBox()
  };
  expect(caixas.icone?.width ?? 0).toBeCloseTo(24, 0);
  const bordaDoMinimizar = caixas.minimizar?.x ?? 0;
  expect(bordaDoMinimizar).toBeGreaterThan(0);
  expect((caixas.noAr?.x ?? Number.POSITIVE_INFINITY) + (caixas.noAr?.width ?? 0), "o selo Ao vivo").toBeLessThanOrEqual(bordaDoMinimizar);
  expect((caixas.gravando?.x ?? Number.POSITIVE_INFINITY) + (caixas.gravando?.width ?? 0), "o ultimo selo").toBeLessThanOrEqual(bordaDoMinimizar);
  expect(caixas.titulo?.width ?? 0, "sobra largura para o titulo").toBeGreaterThan(0);
  expect((caixas.titulo?.x ?? Number.POSITIVE_INFINITY) + (caixas.titulo?.width ?? 0)).toBeLessThanOrEqual(bordaDoMinimizar);

  // Minimizar: a pilula no canto de baixo, onde ficava a IA Diretor; o X dela (Sair) recebe o clique e fecha a sala.
  await minimizar.click();
  const pilula = page.getByTestId("room-pill");
  await expect(pilula).toBeVisible();
  await pilula.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair }).click();
  await expect(page).toHaveURL(`/webinarios/${slug}`);
  await expect(page.getByTestId("room-pill")).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: IA_DIRETOR })).toBeVisible();
});

test("a 667 px (celular deitado): ate o computador fica o Icone da escola e, com a gravacao ligada, os selos terminam antes de quem assiste e o titulo tem largura", async ({ page }) => {
  // Entre sm (640 px) e lg (1024 px, onde a sala vira computador) o cabecalho ja tem a frase inteira do Ao vivo, a
  // palavra Gravando, o "{n} assistindo" e Minimizar/Sair com texto: a logo de 125 px so entra em lg.
  await page.setViewportSize({ height: 740, width: 667 });
  const { dialogo, sala } = await entrarNaSala(page);
  // O iPhone SE deitado: 667 x 375 (a altura nao muda o cabecalho; a entrada usa a de cima para o Entrar na sala caber).
  await page.setViewportSize({ height: 375, width: 667 });

  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  const cabecalho = dialogo.locator("header").first();
  await expect(cabecalho.getByTestId("live-recording")).toBeVisible();
  const icone = cabecalho.locator('[data-room-brand="icon"]');
  await expect(icone).toBeVisible();
  await expect(cabecalho.locator('[data-room-brand="logo"]')).toBeHidden();
  const presentes = cabecalho.getByTestId("room-present");
  await expect(presentes).toBeVisible();

  const caixas = {
    gravando: await cabecalho.locator(`[title="${aoVivo.gravando}"]`).boundingBox(),
    icone: await icone.boundingBox(),
    noAr: await cabecalho.locator('[title^="Ao vivo"]').boundingBox(),
    presentes: await presentes.boundingBox(),
    titulo: await cabecalho.getByRole("heading", { level: 1 }).boundingBox()
  };
  const fim = (caixa: { width: number; x: number } | null) => (caixa?.x ?? Number.POSITIVE_INFINITY) + (caixa?.width ?? 0);
  expect(caixas.icone?.width ?? 0).toBeCloseTo(24, 0);
  const bordaDosPresentes = caixas.presentes?.x ?? 0;
  expect(bordaDosPresentes).toBeGreaterThan(0);
  expect(fim(caixas.noAr), "o selo Ao vivo").toBeLessThanOrEqual(bordaDosPresentes);
  expect(fim(caixas.gravando), "o ultimo selo termina antes de quem assiste").toBeLessThanOrEqual(bordaDosPresentes);
  expect(caixas.titulo?.width ?? 0, "sobra largura para o titulo").toBeGreaterThan(0);
  expect(fim(caixas.titulo)).toBeLessThanOrEqual(bordaDosPresentes);
});
