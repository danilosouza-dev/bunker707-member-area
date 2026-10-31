import type { Locator, Page } from "@playwright/test";
import { THEME_HASH_KEY } from "../../src/lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { CHAT_CONSENT_VERSION } from "../../src/server/webinars/model";
import { ESCOLA_DE_TESTE, limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  abrirComoProdutor,
  abrirEnqueteDeTeste,
  ambienteDaSalaAoVivo,
  apagarEnqueteDeTeste,
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
// sala (o botao flutuante cobria o Enviar do chat); a 375 px o cabecalho da sala tem o titulo, "com {apresentador} ·
// {n} assistindo" e o Sair (docs/31 V2-18), e o "Ao vivo" e o Gravando ficam dentro do palco (V2-4) (sem Minimizar nem
// pilula, docs/31 V2-2; o Sair pede a confirmacao e volta para a pagina da live, onde a IA Diretor reaparece); a 667 px
// (celular deitado) o cabecalho continua o do celular, sem marca, os selos ficam no palco e Configurações aberto deixa
// o palco com 96 px, acima do painel. O botao Configurações abre o painel de som e aparelhos: antes da liberacao nada
// troca de aparelho (nem pede o microfone); depois do Falar o microfone escolhido chega a sala so pelo id, o
// alto-falante tambem, a camera so depois do aviso de gravacao,
// Reduzir ruído e Economizar dados viram os comandos do iframe (o ruido so depois que a faixa nova entra) e nenhuma
// troca vira "a equipe fechou" nem linha no historico; a Câmera tocada no meio de uma troca espera a faixa nova; a
// equipe que silencia logo depois da troca do microfone chega como a equipe, e o foco do controle que some com a secao
// vai ao Fechar; a 375 x 667 o painel aberto deixa a barra na tela e o Esc e o proprio botao devolvem o foco ao botao.
// O Falar segura o "ligado" do iframe ate o microfone abrir de verdade, com ou sem a permissao do site (o microfone que
// nao abre nunca vira "ligado" na barra nem no historico), o pedido acaba na queda e o painel diz que falta a permissao
// (nunca "nenhum aparelho"); na volta depois de uma queda, a Câmera tocada no meio da troca da camera desligada espera a
// faixa da troca, e o botao que espera mostra o estado real com o circulo girando e a frase do que vem.
// O tema da sala (docs/31 V2-12): Tema claro troca a sala na hora (so o dialogo, nunca o html), fica guardado ao
// recarregar e chega ao iframe na montagem (bunkerTheme); trocar com a aluna dentro nao remonta o iframe. A 375 px o
// cabecalho fica sem o botao (V2-18) e o tema troca pela linha Tema do painel Configurações.
// A barra (docs/31 V2-6 a V2-8): no computador o Sair fica nela e o balao "Esconder o chat" esconde o painel (o palco
// cresce, o iframe nao remonta), guardado ao recarregar; "Mostrar o chat" reabre. A 375 px a barra cabe (a 360 px
// tambem), os circulos tem 44 px e a Tela cheia (ou o Modo cinema) fica no canto do palco.
// O painel fechado (docs/31 V2-7 e V2-8): o X "Fechar o painel" fecha e devolve o foco ao balao, as 2 ultimas mensagens
// ficam em pilulas dentro do palco, a mensagem nova do produtor aparece no nome do balao ("Mostrar o chat, 1 mensagem
// nova") e reabrir tira o contador.
// A enquete no palco (docs/31 V2-10): aberta pela equipe, ela abre centrada dentro do palco mesmo com o painel fechado,
// sem pegar o foco; "Responder depois" a recolhe para o card "Enquete aberta · você deixou para depois" do chat (o
// foco vai ao balao), que continua ao recarregar; "Responder agora" a traz de volta com o foco na primeira opcao, e
// "Enviar resposta" grava pela nossa rota (201) e a aba Enquetes diz "Resposta enviada".
// A Visão do vídeo (docs/31 V2-16 e V2-A5): Grade vai por setTileView(true) sem remontar o iframe; o botao diz o que o
// motor mostra (o tileViewChanged), nunca a escolha guardada; o Esc no menu so fecha o menu; ao recarregar e entrar, a
// Grade guardada volta depois do videoConferenceJoined. A 1280 px com o painel aberto o iframe fica abaixo de 1013 px e
// a coluna de miniaturas sai (toggleFilmStrip; os selos deixam de descontar a coluna quando o motor confirma); com o
// painel fechado ela volta.

const { roomName, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
/** Quem apresenta a live de teste (o produtor): o cabecalho e o selo do palco dizem o nome dele. */
const APRESENTADOR = ESCOLA_DE_TESTE.contas.produtor.nome;
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

test("o tema: Tema claro troca a sala na hora e fica guardado ao recarregar; o iframe monta no tema guardado e trocar com a aluna dentro nao remonta", async ({ page }) => {
  const tema = WEBINAR_COPY.salaV2.tema;
  const sala = await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);
  const dialogo = page.getByRole("dialog", { name: titulo });

  // Escuro por padrao; o botao diz para qual tema vai. So o dialogo da sala muda: o html continua sem o atributo.
  await expect(dialogo).toHaveAttribute("data-room-theme", "dark");
  await dialogo.getByRole("button", { exact: true, name: tema.claro }).click();
  await expect(dialogo).toHaveAttribute("data-room-theme", "light");
  await expect(dialogo.getByRole("button", { exact: true, name: tema.escuro })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-room-theme")).toBeNull();

  // Recarregar mantem o claro (guardado no navegador da aluna).
  await page.reload();
  await expect(dialogo).toHaveAttribute("data-room-theme", "light");

  // Entrar na sala: o iframe monta com o tema guardado (no hash, para o CSS da instancia).
  const token = page.waitForResponse((response) => response.url().endsWith("/join-token") && response.request().method() === "POST");
  await dialogo.getByRole("button", { exact: true, name: aoVivo.entrarNaSala }).click();
  expect((await token).status()).toBe(200);
  const montagem = await sala.esperarMontada();
  expect(montagem.configOverwrite[THEME_HASH_KEY]).toBe("light");
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();
  expect(await sala.montagens()).toBe(1);

  // Trocar o tema com a aluna dentro: a sala muda na hora e o iframe continua o mesmo (o motor nao tem comando de tema).
  await dialogo.getByRole("button", { exact: true, name: tema.escuro }).click();
  await expect(dialogo).toHaveAttribute("data-room-theme", "dark");
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();
  expect(await sala.montagens()).toBe(1);
});

test("o balao do chat (docs/31 V2-6 a V2-8): no computador Esconder o chat esconde o painel e o palco cresce sem remontar o iframe; recarregar mantem fechado e Mostrar o chat reabre; o Sair fica na barra; a 375 px a barra cabe, os circulos tem 44 px e a Tela cheia fica no palco", async ({ page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo, sala } = await entrarNaSala(page);
  const chat = dialogo.getByTestId("room-panel");
  const palco = dialogo.locator("[data-lesson-player-stage]");
  await expect(chat).toBeVisible();
  const larguraAntes = (await palco.boundingBox())?.width ?? 0;
  expect(larguraAntes).toBeGreaterThan(0);

  // Aberto, o balao fica ligado e controla o painel; fechar esconde o painel (sem desmontar) e o palco toma a largura.
  const esconder = dialogo.getByRole("button", { exact: true, name: painel.esconder });
  await expect(esconder).toHaveAttribute("aria-pressed", "true");
  await expect(esconder).toHaveAttribute("aria-controls", "room-panel");
  await esconder.click();
  await expect(chat).toBeHidden();
  await expect(chat).toHaveCount(1);
  await expect(dialogo.getByRole("button", { exact: true, name: painel.mostrar })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await palco.boundingBox())?.width ?? 0).toBeGreaterThan(larguraAntes + 300);
  expect(await sala.montagens(), "abrir e fechar o painel so troca classes: o iframe e o mesmo").toBe(1);

  // A escolha fica guardada no navegador: recarregar mantem fechado; Mostrar o chat reabre.
  await page.reload();
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  await expect(dialogo.getByTestId("room-panel")).toBeHidden();
  await dialogo.getByRole("button", { exact: true, name: painel.mostrar }).click();
  await expect(dialogo.getByTestId("room-panel")).toBeVisible();
  await expect(dialogo.getByRole("button", { exact: true, name: painel.esconder })).toHaveAttribute("aria-pressed", "true");

  // No computador o Sair fica na barra, a esquerda; o do cabecalho so aparece abaixo de lg.
  const barra = dialogo.getByRole("group", { name: aoVivo.barra });
  await expect(barra.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair })).toBeVisible();
  await expect(dialogo.locator("header").first().getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair })).toHaveCount(0);

  // A 375 px: a barra cabe na largura (sem rolar por dentro), os circulos tem 44 px e a Tela cheia (ou o Modo cinema)
  // sai da barra e fica no canto do palco.
  await page.setViewportSize({ height: 740, width: 375 });
  const caixaDaBarra = await barra.boundingBox();
  expect(caixaDaBarra?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((caixaDaBarra?.x ?? 0) + (caixaDaBarra?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(375);
  expect(await barra.evaluate((elemento) => elemento.scrollWidth <= elemento.clientWidth), "os circulos cabem sem rolar a barra").toBe(true);
  for (const nome of [WEBINAR_COPY.sala.reagir, aoVivo.levantarMao, aoVivo.som, aoVivo.configuracoes, painel.esconder]) {
    const caixa = await barra.getByRole("button", { exact: true, name: nome }).boundingBox();
    expect(caixa?.height, nome).toBeGreaterThanOrEqual(44);
    expect(caixa?.width, nome).toBeGreaterThanOrEqual(44);
  }
  const telaCheia = new RegExp(`^(?:${aoVivo.telaCheia}|${aoVivo.modoCinema})$`);
  await expect(barra.getByRole("button", { name: telaCheia })).toHaveCount(0);
  await expect(barra.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair })).toHaveCount(0);
  const noPalco = palco.getByRole("button", { name: telaCheia });
  await expect(noPalco).toBeVisible();
  const caixaDoPalco = await palco.boundingBox();
  const caixaDoCanto = await noPalco.boundingBox();
  expect(caixaDoCanto?.x ?? -1).toBeGreaterThanOrEqual(caixaDoPalco?.x ?? 0);
  expect((caixaDoCanto?.y ?? 0) + (caixaDoCanto?.height ?? 0)).toBeLessThanOrEqual((caixaDoPalco?.y ?? 0) + (caixaDoPalco?.height ?? 0));
  expect((caixaDoCanto?.x ?? 0) + (caixaDoCanto?.width ?? 0)).toBeLessThanOrEqual((caixaDoPalco?.x ?? 0) + (caixaDoPalco?.width ?? 0));

  // A 360 px (os Android pequenos) a barra tambem cabe sem rolar por dentro (a rolagem dela fica escondida).
  await page.setViewportSize({ height: 740, width: 360 });
  expect(await barra.evaluate((elemento) => elemento.scrollWidth <= elemento.clientWidth), "os circulos cabem em 360 px").toBe(true);
});

test("o painel fechado (docs/31 V2-7 e V2-8): o X fecha e o foco vai ao balao; as 2 ultimas mensagens ficam em pilulas no palco; a mensagem nova do produtor entra no nome do balao e reabrir zera o contador", async ({ browser, page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo } = await entrarNaSala(page);
  const chat = dialogo.getByTestId("room-panel");
  const palco = dialogo.locator("[data-lesson-player-stage]");
  await expect(chat).toBeVisible();
  // As abas em pilula na lista "Painel da sala" (a mesma regra nas tres salas): Chat, Perguntas e Participantes.
  const abas = chat.getByRole("tablist", { name: painel.rotulo });
  await expect(abas.getByRole("tab")).toHaveText([WEBINAR_COPY.sala.abas.chat, WEBINAR_COPY.sala.abas.perguntas, WEBINAR_COPY.sala.abas.participantes]);

  // O produtor escreve no chat da live pela rota da sala (a primeira mensagem com o aceite).
  const produtor = await abrirComoProdutor(browser);
  const escrever = async (texto: string) => {
    const resposta = await produtor.pagina.request.post(`/api/webinars/${LIVE_AO_VIVO_DE_TESTE.id}/chat`, {
      data: { body: texto, consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId }
    });
    expect(resposta.status(), texto).toBe(201);
  };
  try {
    await escrever("primeira do produtor no painel");
    await escrever("segunda do produtor no painel");
    await expect(chat.getByRole("log").getByText("segunda do produtor no painel")).toBeVisible({ timeout: 15_000 });

    // O X fecha o painel (montado e escondido) e o foco vai ao balao, que o reabre.
    await chat.getByRole("button", { exact: true, name: painel.fechar }).click();
    await expect(chat).toBeHidden();
    const mostrar = dialogo.getByRole("button", { exact: true, name: painel.mostrar });
    await expect(mostrar).toBeFocused();
    await expect(mostrar).toHaveAttribute("aria-pressed", "false");

    // As 2 ultimas mensagens em pilulas dentro do palco (tambem no computador), a mais nova embaixo.
    const pilulas = palco.getByTestId("room-chat-pills");
    await expect(pilulas.locator("li")).toHaveCount(2);
    await expect(pilulas.locator("li").nth(0)).toContainText("primeira do produtor no painel");
    await expect(pilulas.locator("li").nth(1)).toContainText("segunda do produtor no painel");

    // Uma mensagem nova com o painel fechado: o balao diz quantas chegaram, e as pilulas andam.
    await escrever("terceira do produtor no painel");
    const comNovas = dialogo.getByRole("button", { exact: true, name: painel.mostrarComNovas(WEBINAR_COPY.sala.mensagensNovas(1)) });
    await expect(comNovas).toBeVisible({ timeout: 15_000 });
    await expect(comNovas.locator("[data-room-unread]")).toHaveText("1");
    await expect(pilulas.locator("li").nth(1)).toContainText("terceira do produtor no painel");
    await expect(pilulas).not.toContainText("primeira do produtor no painel");

    // Reabrir mostra o chat e tira o contador (e as pilulas, porque o chat esta na tela).
    await comNovas.click();
    await expect(chat).toBeVisible();
    const esconder = dialogo.getByRole("button", { exact: true, name: painel.esconder });
    await expect(esconder).toHaveAttribute("aria-pressed", "true");
    await expect(esconder.locator("[data-room-unread]")).toHaveCount(0);
    await expect(palco.getByTestId("room-chat-pills")).toHaveCount(0);
    await expect(chat.getByRole("log").getByText("terceira do produtor no painel")).toBeVisible();
  } finally {
    await produtor.fechar();
  }
});

test("a enquete no palco (docs/31 V2-10): com o painel fechado ela abre centrada no palco sem pegar o foco; Responder depois recolhe para o card do chat, que fica ao recarregar; Responder agora volta ao palco e Enviar resposta grava", async ({ page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  const enquete = WEBINAR_COPY.salaV2.enquete;
  const pergunta = "Qual parte da live ajudou mais?";
  await page.setViewportSize({ height: 900, width: 1440 });
  await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);
  const dialogo = page.getByRole("dialog", { name: titulo });
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  const chat = dialogo.getByTestId("room-panel");
  const palco = dialogo.locator("[data-lesson-player-stage]");

  // O painel fechado pelo balao (guardado no navegador): a enquete abre assim mesmo.
  await dialogo.getByRole("button", { exact: true, name: painel.esconder }).click();
  await expect(chat).toBeHidden();

  const { optionIds, pollId } = await abrirEnqueteDeTeste({ options: ["O chat", "As perguntas"], question: pergunta, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId, webinarId: LIVE_AO_VIVO_DE_TESTE.id });
  try {
    await page.reload();
    await expect(dialogo).toHaveAttribute("data-room-kind", "live");
    await expect(chat).toBeHidden();
    const camada = palco.getByRole("dialog", { name: pergunta });
    await expect(camada).toBeVisible();
    await expect(camada.getByRole("heading", { level: 2, name: pergunta })).toBeVisible();
    await expect(camada.getByRole("radio")).toHaveCount(2);
    // Centrada sobre o palco, dentro dele.
    const caixaDoPalco = await palco.boundingBox();
    const caixaDaEnquete = await camada.boundingBox();
    expect(caixaDoPalco && caixaDaEnquete).toBeTruthy();
    if (caixaDoPalco && caixaDaEnquete) {
      expect(Math.abs(caixaDaEnquete.x + caixaDaEnquete.width / 2 - (caixaDoPalco.x + caixaDoPalco.width / 2))).toBeLessThan(2);
      expect(Math.abs(caixaDaEnquete.y + caixaDaEnquete.height / 2 - (caixaDoPalco.y + caixaDoPalco.height / 2))).toBeLessThan(2);
      expect(caixaDaEnquete.width).toBeLessThanOrEqual(440);
    }
    // Aberta sozinha, ela nao pega o foco (o leitor de tela ouve "Enquete aberta" pela regiao viva).
    expect(await camada.evaluate((elemento) => elemento.contains(document.activeElement))).toBe(false);
    await expect(palco.locator("[data-room-poll-said]")).toHaveText(enquete.aberta);

    // Responder depois: a camada sai e o foco vai ao balao (o card do chat esta no painel fechado).
    await camada.getByRole("button", { exact: true, name: enquete.responderDepois }).click();
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    const mostrar = dialogo.getByRole("button", { exact: true, name: painel.mostrar });
    await expect(mostrar).toBeFocused();
    await mostrar.click();
    await expect(chat).toBeVisible();
    const card = chat.getByRole("region", { name: enquete.deixouParaDepois });
    await expect(card).toContainText(pergunta);

    // Recarregar mantem no "depois": o card no chat e nada no palco.
    await page.reload();
    await expect(dialogo).toHaveAttribute("data-room-kind", "live");
    await expect(card).toBeVisible();
    await expect(palco.getByRole("dialog")).toHaveCount(0);

    // Responder agora: a enquete volta ao palco com o foco na primeira opcao, e o card sai.
    await card.getByRole("button", { exact: true, name: enquete.responderAgora }).click();
    await expect(camada).toBeVisible();
    await expect(camada.getByRole("radio", { name: "O chat" })).toBeFocused();
    await expect(card).toHaveCount(0);
    const enviar = camada.getByRole("button", { exact: true, name: enquete.enviarResposta });
    await expect(enviar).toBeDisabled();
    await camada.getByRole("radio", { name: "As perguntas" }).check();
    const resposta = page.waitForResponse((response) => response.url().endsWith("/polls") && response.request().method() === "POST");
    await enviar.click();
    const envio = await resposta;
    expect(envio.status()).toBe(201);
    expect(envio.request().postDataJSON()).toMatchObject({ optionIds: [optionIds[1]], pollId, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId });

    // Enviada: a camada sai, o foco vai ao balao, a regiao viva diz "Resposta enviada" e a aba Enquetes tambem.
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    await expect(dialogo.getByRole("button", { exact: true, name: painel.esconder })).toBeFocused();
    await expect(palco.locator("[data-room-poll-said]")).toHaveText(WEBINAR_COPY.sala.enquete.respondida);
    await chat.getByRole("tab", { exact: true, name: WEBINAR_COPY.sala.abas.enquetes }).click();
    await expect(dialogo.getByTestId("room-polls").getByText(WEBINAR_COPY.sala.enquete.respondida)).toBeVisible();
  } finally {
    // A enquete aberta ficaria no meio do palco dos testes seguintes.
    await apagarEnqueteDeTeste(pollId);
  }
});

test("a visão do vídeo e a coluna de miniaturas (docs/31 V2-16 e V2-A5): Grade por comando sem remontar, o botao diz o que o motor mostra, a Grade guardada volta na entrada; a 1280 px a coluna sai com o painel aberto e volta com ele fechado", async ({ page }) => {
  test.setTimeout(120_000);
  const visao = WEBINAR_COPY.salaV2.visao;
  const painel = WEBINAR_COPY.salaV2.painel;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo, sala } = await entrarNaSala(page);
  const barra = dialogo.getByRole("group", { name: aoVivo.barra });
  const palco = dialogo.locator("[data-lesson-player-stage]");
  const noPalco = barra.getByRole("button", { exact: true, name: visao.atual(visao.palco) });
  await expect(noPalco).toBeEnabled();
  await expect(noPalco).toHaveAttribute("aria-haspopup", "menu");
  await expect(noPalco).toHaveAttribute("aria-expanded", "false");
  // A margem que os selos descontam, lida pelo CSSOM: o servidor pinta 0px, e depois que o valor muda o navegador
  // reescreve o atributo style no formato dele ("--room-video-right: 222px;"), que uma regex do atributo nao pegaria.
  const margemDosSelos = () => palco.evaluate((elemento) => (elemento as HTMLElement).style.getPropertyValue("--room-video-right").trim());
  // A 1440 px com o painel aberto o iframe tem cerca de 1072 px: a coluna fica, e os selos param antes dela.
  await expect.poll(margemDosSelos).toBe("222px");

  // O menu abre com o foco na opcao marcada; o Esc fecha so o menu (nada de "sair da sala") e o foco volta ao botao.
  await noPalco.click();
  const menu = dialogo.getByRole("menu", { name: visao.rotulo });
  await expect(menu).toBeVisible();
  await expect(noPalco).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitemradio", { exact: true, name: visao.palco })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { exact: true, name: visao.palco })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(noPalco).toBeFocused();
  await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);

  // Nunca dois abertos juntos: com Configurações aberto, o botao da visao fecha o painel (que cobriria o menu) e abre o
  // menu com o foco na opcao marcada.
  const configuracoes = dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes });
  await configuracoes.click();
  await expect(dialogo.getByTestId("live-settings")).toBeVisible();
  await noPalco.click();
  await expect(dialogo.locator("#live-room-settings")).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { exact: true, name: visao.palco })).toBeFocused();
  // O atalho R com o foco no menu: Reagir abre, o menu fecha e o foco vai ao botao da visao (nunca ao body); o Esc
  // seguinte fecha Reagir sem pedir para sair.
  await page.keyboard.press("r");
  await expect(dialogo.locator("#live-room-reactions")).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(noPalco).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogo.locator("#live-room-reactions")).toHaveCount(0);
  await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);
  // O proprio botao fecha o menu com o foco numa opcao (no WebKit o clique nao foca o botao: o evento sem mover o foco
  // imita isso): o foco vai ao botao, e o Esc seguinte ainda chega a sala (pede para sair).
  await noPalco.click();
  await expect(menu.getByRole("menuitemradio", { exact: true, name: visao.palco })).toBeFocused();
  await noPalco.dispatchEvent("click");
  await expect(menu).toBeHidden();
  await expect(noPalco).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogo.getByRole("alertdialog", { name: WEBINAR_COPY.sala.sairConfirmar })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);
  // O clique no video tira o foco da pagina (ele entra no iframe do motor): o menu fecha.
  await noPalco.click();
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await expect(menu).toBeHidden();

  // Grade: por comando (setTileView), sem remontar o iframe.
  let antes = (await sala.comandos()).length;
  await noPalco.click();
  await menu.getByRole("menuitemradio", { exact: true, name: visao.grade }).click();
  await expect(menu).toBeHidden();
  expect((await sala.esperarComando("setTileView", { depoisDe: antes })).args).toEqual([true]);
  expect(await sala.montagens(), "trocar a visao nao remonta o iframe").toBe(1);

  // O botao diz o que o motor mostra: a Grade quando ele avisa; o Palco quando a equipe volta todos ao Palco, mesmo com
  // a Grade guardada.
  await sala.disparar("tileViewChanged", { enabled: true });
  await expect(barra.getByRole("button", { exact: true, name: visao.atual(visao.grade) })).toBeVisible();
  // Na Grade, nenhuma coluna a descontar.
  await expect.poll(margemDosSelos).toBe("0px");
  await sala.disparar("tileViewChanged", { enabled: false });
  await expect(noPalco).toBeVisible();

  // Recarregar e entrar de novo: a Grade guardada volta por setTileView(true), so depois do videoConferenceJoined.
  await page.reload();
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  const token = page.waitForResponse((response) => response.url().endsWith("/join-token") && response.request().method() === "POST");
  await dialogo.getByRole("button", { exact: true, name: aoVivo.entrarNaSala }).click();
  expect((await token).status()).toBe(200);
  await sala.esperarMontada();
  expect((await sala.comandos()).some((item) => item.comando === "setTileView"), "antes da entrada, nenhum comando").toBe(false);
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.levantarMao })).toBeEnabled();
  expect((await sala.esperarComando("setTileView")).args).toEqual([true]);

  // A 1280 px com o painel aberto o iframe fica com cerca de 912 px (abaixo de 1013): a coluna sai por toggleFilmStrip.
  antes = (await sala.comandos()).length;
  await page.setViewportSize({ height: 800, width: 1280 });
  await sala.esperarComando("toggleFilmStrip", { depoisDe: antes });
  // O motor confirma (a coluna escondida): os selos vao ate a borda. Fechar o painel deixa o iframe com mais de 1013 px
  // e a coluna volta.
  await sala.disparar("filmstripDisplayChanged", { visible: false });
  await expect.poll(margemDosSelos).toBe("0px");
  antes = (await sala.comandos()).length;
  await dialogo.getByRole("button", { exact: true, name: painel.esconder }).click();
  await sala.esperarComando("toggleFilmStrip", { depoisDe: antes });
  await sala.disparar("filmstripDisplayChanged", { visible: true });
  await expect.poll(margemDosSelos).toBe("222px");
  expect(await sala.montagens(), "a coluna e por comando: o iframe e o mesmo").toBe(1);

  // A sala cai com o menu aberto: o menu fecha de vez e o foco fica na sala (nunca no body); na volta o botao religa
  // sem reabrir o menu sozinho.
  await noPalco.click();
  await expect(menu).toBeVisible();
  await sala.disparar("videoConferenceLeft", {});
  await expect(menu).toBeHidden();
  await expect(noPalco).toBeDisabled();
  await expect.poll(() => dialogo.evaluate((elemento) => elemento.contains(document.activeElement))).toBe(true);
  await expect.poll(() => sala.montagens(), { timeout: 20_000 }).toBe(2);
  await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: PARTICIPANTE, roomName });
  await expect(noPalco).toBeEnabled();
  await expect(noPalco).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
});

test("Configurações: antes da liberacao nada troca de aparelho; a camera so depois do aviso, o alto-falante e o microfone so depois do Falar, Reduzir ruído e Economizar dados chegam a sala; nenhuma troca vira aviso falso nem linha no historico", async ({ page }) => {
  // O historico ja tem as linhas dos testes anteriores: so contam os sinais deste teste (`at`, a hora do aparelho).
  const inicio = new Date().toISOString();
  const desteTeste = async () => porHoraDoAparelho((await eventosDaLiveAoVivo("aluna")).filter((linha) => typeof linha.metadata.at === "string" && linha.metadata.at >= inicio));
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


// Os sinais de um mesmo lote chegam juntos e ganham o mesmo created_at: a ordem dos eventos e a hora do aparelho
// (metadata.at, ISO), nao a da gravacao.
function porHoraDoAparelho<T extends { metadata: Record<string, unknown> }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => String(a.metadata.at).localeCompare(String(b.metadata.at)));
}

/** Os registros desta parte do teste (`at`, a hora do aparelho em que o sinal saiu). */
function historicoDesde(inicio: string) {
  return async () => porHoraDoAparelho((await eventosDaLiveAoVivo("aluna")).filter((linha) => typeof linha.metadata.at === "string" && linha.metadata.at >= inicio));
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

test("a 375 px: a sala cabe sem rolagem lateral, o palco ocupa a largura e a nossa barra tem botoes de 44 px; o cabecalho tem o titulo, quem apresenta e quantos assistem; Ao vivo e Gravando no palco; sem Minimizar, o Sair pede a confirmacao e fecha a sala", async ({ page }) => {
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
  // Abaixo de sm o cabecalho nao tem o botao de tema (V2-18): o tema fica na linha Tema do painel, com o mesmo nome.
  const tema = WEBINAR_COPY.salaV2.tema;
  await expect(dialogo.locator("header").first().getByRole("button", { exact: true, name: tema.claro })).toBeHidden();
  await configuracoes.click();
  await painel.getByRole("button", { exact: true, name: tema.claro }).click();
  await expect(dialogo).toHaveAttribute("data-room-theme", "light");
  await painel.getByRole("button", { exact: true, name: tema.escuro }).click();
  await expect(dialogo).toHaveAttribute("data-room-theme", "dark");
  await dialogo.getByRole("button", { exact: true, name: aoVivo.config.fechar }).click();
  await expect(painel).toHaveCount(0);
  await page.setViewportSize({ height: 740, width: 375 });

  // O cabecalho do celular (docs/31 V2-18) com a gravacao ligada (o duble avisa, como o gravador): o titulo, "com
  // {apresentador} · {n} assistindo" e o Sair, sem marca e sem selo; o "Ao vivo" (so o tempo, a frase para o leitor de
  // tela) e o Gravando ficam dentro do palco, em cima a esquerda, e quem apresenta embaixo (V2-4).
  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  const cabecalho = dialogo.locator("header").first();
  const palcoDaSala = dialogo.locator("[data-lesson-player-stage]");
  const gravando = palcoDaSala.getByTestId("live-recording");
  const noAr = palcoDaSala.getByTestId("room-on-air");
  await expect(gravando).toBeVisible();
  await expect(noAr).toBeVisible();
  await expect(noAr).toHaveAttribute("title", /^Ao vivo · \d{2}:\d{2}:\d{2}$/);
  await expect(palcoDaSala.getByText(`${APRESENTADOR} · Apresentador`)).toBeVisible();
  await expect(cabecalho.getByTestId("live-recording")).toHaveCount(0);
  await expect(cabecalho.getByTestId("room-on-air")).toHaveCount(0);
  await expect(cabecalho.locator("[data-room-brand]")).toBeHidden();
  const tituloDoCabecalho = cabecalho.getByRole("heading", { level: 1, name: titulo });
  await expect(tituloDoCabecalho).toBeVisible();
  const linha = cabecalho.getByTestId("room-mobile-line");
  await expect(linha).toHaveText(new RegExp(`^com ${APRESENTADOR} · \\d+ assistindo$`));
  // Sem Minimizar (docs/31 V2-2): o cabecalho termina no Sair.
  await expect(dialogo.getByRole("button", { exact: true, name: "Minimizar" })).toHaveCount(0);
  const sair = cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair });
  await expect(sair).toBeVisible();
  const fim = (caixa: { width: number; x: number } | null) => (caixa?.x ?? Number.POSITIVE_INFINITY) + (caixa?.width ?? 0);
  const caixas = {
    gravando: await gravando.boundingBox(),
    linha: await linha.boundingBox(),
    noAr: await noAr.boundingBox(),
    palco: await palcoDaSala.boundingBox(),
    sair: await sair.boundingBox(),
    titulo: await tituloDoCabecalho.boundingBox()
  };
  const bordaDoSair = caixas.sair?.x ?? 0;
  expect(bordaDoSair).toBeGreaterThan(0);
  expect(fim(caixas.sair), "o Sair cabe na tela").toBeLessThanOrEqual(375);
  expect(caixas.titulo?.width ?? 0, "sobra largura para o titulo").toBeGreaterThan(0);
  expect(fim(caixas.titulo)).toBeLessThanOrEqual(bordaDoSair);
  expect(fim(caixas.linha), "a linha do celular termina antes do Sair").toBeLessThanOrEqual(bordaDoSair);
  // Os selos dentro do palco: o Ao vivo no canto de cima a esquerda e o Gravando ao lado, sem sair do palco.
  expect(caixas.noAr?.x ?? -1).toBeGreaterThanOrEqual(caixas.palco?.x ?? 0);
  expect(caixas.noAr?.y ?? -1).toBeGreaterThanOrEqual(caixas.palco?.y ?? 0);
  expect(caixas.gravando?.x ?? -1).toBeGreaterThan(caixas.noAr?.x ?? 0);
  expect(fim(caixas.gravando)).toBeLessThanOrEqual(fim(caixas.palco));

  // O Sair, com a live no ar, abre a confirmacao; o Sair dela volta para a pagina da live, onde a IA Diretor reaparece.
  // Nenhuma pilula fica no canto.
  await sair.click();
  const confirmacao = dialogo.getByRole("alertdialog", { name: WEBINAR_COPY.sala.sairConfirmar });
  await expect(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair }).click();
  await expect(page).toHaveURL(`/webinarios/${slug}`);
  await expect(page.getByRole("dialog", { name: titulo })).toHaveCount(0);
  await expect(page.getByTestId("room-pill")).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: IA_DIRETOR })).toBeVisible();
});

test("a 667 px (celular deitado): o cabecalho do celular (titulo e 'com {apresentador} · {n} assistindo', sem marca) e os selos Ao vivo e Gravando no palco; Configurações aberto deixa o palco com 96 px, fora de baixo do painel", async ({ page }) => {
  // Abaixo de lg (1024 px, onde a sala vira computador) o cabecalho e o do celular (docs/31 V2-18): a logo, a linha da
  // data e o "{n} assistindo" da direita so entram em lg; o contador fica na linha de baixo do titulo.
  await page.setViewportSize({ height: 740, width: 667 });
  const { dialogo, sala } = await entrarNaSala(page);
  // O iPhone SE deitado: 667 x 375 (a altura nao muda o cabecalho; a entrada usa a de cima para o Entrar na sala caber).
  await page.setViewportSize({ height: 375, width: 667 });

  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  const cabecalho = dialogo.locator("header").first();
  const palco = dialogo.locator("[data-lesson-player-stage]");
  await expect(palco.getByTestId("live-recording")).toBeVisible();
  await expect(palco.getByTestId("room-on-air")).toBeVisible();
  // A partir de sm o selo traz a frase inteira; so uma versao fica visivel.
  await expect(palco.getByText(/^Ao vivo · \d{2}:\d{2}:\d{2}$/).filter({ visible: true })).toBeVisible();
  await expect(cabecalho.getByTestId("live-recording")).toHaveCount(0);
  await expect(cabecalho.locator("[data-room-brand]")).toBeHidden();
  await expect(cabecalho.getByTestId("room-present")).toBeHidden();
  const linha = cabecalho.getByTestId("room-mobile-line");
  await expect(linha).toHaveText(new RegExp(`^com ${APRESENTADOR} · \\d+ assistindo$`));
  // A partir de sm o botao de tema volta ao cabecalho, antes do Sair.
  await expect(cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.tema.claro })).toBeVisible();

  const fim = (caixa: { width: number; x: number } | null) => (caixa?.x ?? Number.POSITIVE_INFINITY) + (caixa?.width ?? 0);
  const caixas = {
    linha: await linha.boundingBox(),
    palco: await palco.boundingBox(),
    tema: await cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.tema.claro }).boundingBox(),
    titulo: await cabecalho.getByRole("heading", { level: 1 }).boundingBox()
  };
  const bordaDoTema = caixas.tema?.x ?? 0;
  expect(bordaDoTema).toBeGreaterThan(0);
  expect(caixas.titulo?.width ?? 0, "sobra largura para o titulo").toBeGreaterThan(0);
  expect(fim(caixas.titulo)).toBeLessThanOrEqual(bordaDoTema);
  expect(fim(caixas.linha)).toBeLessThanOrEqual(bordaDoTema);
  expect(fim(caixas.palco), "o palco cabe na largura").toBeLessThanOrEqual(667);

  // Configurações deitado: o painel fica no fluxo e toma o lugar do chat; a caixa do palco guarda no minimo 96 px e o
  // palco acaba antes do painel (nunca por baixo dele): quem encolhe e o painel, que rola por dentro, e a barra continua
  // na tela.
  const configuracoes = dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes });
  await configuracoes.click();
  const painel = dialogo.getByTestId("live-settings");
  await expect(painel).toBeVisible();
  await expect(dialogo.getByTestId("room-panel")).toBeHidden();
  const deitado = {
    caixa: await dialogo.locator('[data-room-slot="stage-box"]').boundingBox(),
    painel: await dialogo.locator("#live-room-settings").boundingBox(),
    palco: await palco.boundingBox()
  };
  expect(deitado.caixa?.height ?? 0, "a caixa do palco com no minimo 96 px").toBeGreaterThanOrEqual(96);
  expect(deitado.palco?.height ?? 0, "o palco com no minimo 96 px").toBeGreaterThanOrEqual(96);
  expect((deitado.palco?.y ?? 0) + (deitado.palco?.height ?? 0), "o palco acaba antes do painel").toBeLessThanOrEqual((deitado.painel?.y ?? 0) + 1);
  await expect(configuracoes).toBeInViewport({ ratio: 1 });
  await expect(dialogo.getByRole("button", { exact: true, name: aoVivo.config.fechar })).toBeInViewport({ ratio: 1 });
  await dialogo.getByRole("button", { exact: true, name: aoVivo.config.fechar }).click();
  await expect(painel).toHaveCount(0);
  await expect(dialogo.getByTestId("room-panel")).toBeVisible();
});

// O Chrome fixa a Permissions-Policy no carregamento do documento, e a navegacao interna do Next nao carrega outro:
// a sala aberta pela faixa "Ao vivo agora" de qualquer pagina fica com a politica da pagina de onde a aluna veio. Com a
// regra so nas paginas da sala, a camera e o microfone davam "nao autorizado" sem o navegador perguntar (teste do
// produtor, 30/10/2026; os testes acima entram pela propria pagina da live). A politica agora e a mesma em todo o app
// (next.config.ts, docs/30 I10). A leitura da politica (permissionsPolicy, ou o featurePolicy de antes) so existe no
// Chromium; no WebKit fica a conferencia da navegacao.
test("entrar na sala pela faixa Ao vivo agora do Inicio, sem recarregar a pagina: o documento continua com camera, microfone e tela liberados para o Jitsi", async ({ page }) => {
  await salaFalsaDoJitsi(page);
  await page.goto("/");
  const faixa = page.getByRole("complementary", { name: WEBINAR_COPY.faixa.rotulo });
  await faixa.getByRole("link", { exact: true, name: WEBINAR_COPY.faixa.entrar }).click();
  await page.waitForURL(new RegExp(`/webinarios/${slug}`));
  if (!SALA.test(page.url())) {
    await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  }
  await expect(page).toHaveURL(SALA);
  await expect(page.getByRole("dialog", { name: titulo })).toHaveAttribute("data-room-kind", "live");

  const documento = await page.evaluate((origem) => {
    type Politica = { allowsFeature: (feature: string, origin?: string) => boolean };
    const leitor = document as Document & { featurePolicy?: Politica; permissionsPolicy?: Politica };
    const politica = leitor.permissionsPolicy ?? leitor.featurePolicy;
    const carregadoEm = new URL((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).name).pathname;
    return { carregadoEm, liberado: politica ? ["camera", "microphone", "display-capture"].map((feature) => politica.allowsFeature(feature, origem)) : null };
  }, `https://${ambienteDaSalaAoVivo().WEBINAR_MEET_DOMAIN}`);
  expect(documento.carregadoEm, "a sala abriu pela navegacao interna, no documento do Inicio").not.toMatch(/\/sala\/?$/);
  if (documento.liberado) {
    expect(documento.liberado, "camera, microfone e tela para o Jitsi").toEqual([true, true, true]);
  }
});
