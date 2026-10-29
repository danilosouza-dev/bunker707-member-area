import type { Page } from "@playwright/test";
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
// 375 px a sala cabe sem rolagem lateral e os botoes da barra tem 44 px.

const { roomName, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const aoVivo = WEBINAR_COPY.aoVivo;
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
const PARTICIPANTE = "aluna-na-sala-0001";

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
async function entrarNaSala(page: Page) {
  const sala = await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
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

  return { dialogo, montagem, sala };
}

test("Entrar na sala: o construtor recebe a sala, o token e a barra vazia; camera com o aviso, mao levantada e o microfone liberado com Falar; nada cita o Jitsi", async ({ page }) => {
  const ambiente = ambienteDaSalaAoVivo();
  const { dialogo, montagem, sala } = await entrarNaSala(page);
  // Dentro da sala a faixa "Ao vivo agora" nunca aparece (docs/30 §1.1).
  await expect(page.getByRole("complementary", { name: WEBINAR_COPY.faixa.rotulo })).toHaveCount(0);

  // O external_api.js do nosso hostname, uma vez; o iframe no palco com o nosso titulo e o allow de §8.4.
  expect(sala.pedidosDoScript()).toBe(1);
  expect(montagem.dominio).toBe(ambiente.WEBINAR_MEET_DOMAIN);
  expect(montagem.roomName).toBe(roomName);
  expect(montagem.noPalco).toBe(true);
  const iframe = dialogo.locator("[data-live-frame] iframe");
  await expect(iframe).toHaveAttribute("title", aoVivo.palco);
  await expect(iframe).toHaveAttribute("allow", "camera; microphone; display-capture; autoplay; fullscreen");

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
    disablePolls: true,
    disableReactions: true,
    disableShortcuts: true,
    lobby: { autoKnock: true },
    readOnlyName: true,
    startWithAudioMuted: true,
    startWithVideoMuted: true
  });
  expect(config).not.toHaveProperty("startSilent");
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
  await campo.press("Enter");
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

test("a 375 px: a sala cabe sem rolagem lateral, o palco ocupa a largura e a nossa barra tem botoes de 44 px", async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 375 });
  const { dialogo } = await entrarNaSala(page);
  await expect(dialogo.getByRole("tab", { name: WEBINAR_COPY.sala.abas.chat })).toBeVisible();

  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);

  const palco = await dialogo.locator("[data-room-stage]").boundingBox();
  expect(palco?.width).toBeGreaterThanOrEqual(360);

  for (const nome of [aoVivo.levantarMao, aoVivo.camera, WEBINAR_COPY.sala.reagir]) {
    const caixa = await dialogo.getByRole("button", { exact: true, name: nome }).boundingBox();
    expect(caixa?.height, nome).toBeGreaterThanOrEqual(44);
    expect(caixa?.width, nome).toBeGreaterThanOrEqual(44);
  }
});
