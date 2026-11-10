import type { Locator, Page } from "@playwright/test";
import { THEME_HASH_KEY } from "../../src/lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { verifyJitsiToken } from "../../src/server/webinars/jitsi-token";
import { CHAT_CONSENT_VERSION } from "../../src/server/webinars/model";
import { ESCOLA_DE_TESTE, limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
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
// sala (o botao flutuante cobria o Enviar do chat); a 375 px o cabecalho da sala tem o titulo, "com {apresentador}"
// e o Sair (docs/31 V2-18), e o "Ao vivo", quem assiste agora (docs/31 §11.5) e o Gravando ficam dentro do palco (V2-4) (sem
// Minimizar nem pilula, docs/31 V2-2; o Sair pede a confirmacao e volta para a pagina da live, onde a IA Diretor
// reaparece); a 667 px (celular deitado) o cabecalho continua o do celular, sem marca, os selos ficam no palco e Configurações aberto deixa
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
// A logo da sala (docs/31 V2-3) e a do topo da area: a mesma largura, a mesma altura e o mesmo arquivo no Chromium (1x)
// e no WebKit (2x), a 16 px da borda, sem o menu; no tema claro a logo padrao fica preta.
// O tema da sala (docs/31 V2-12): Tema claro troca a sala na hora (so o dialogo, nunca o html), fica guardado ao
// recarregar e chega ao iframe na montagem (bunkerTheme); trocar com a aluna dentro nao remonta o iframe. A 375 px o
// cabecalho fica sem o botao (V2-18) e o tema troca pela linha Tema do painel Configurações.
// A barra (docs/31 V2-6 a V2-8; a sala no estilo do YouTube): no computador o Sair fica nela e o Chat do trilho a
// direita esconde o painel (o palco cresce, o iframe nao remonta), guardado ao recarregar; o mesmo item reabre. A 375
// px o trilho sai e o balao volta a barra, que cabe (a 360 px tambem), os circulos tem 44 px e a Tela cheia (ou o Modo
// cinema) fica no canto do palco.
// O painel fechado (docs/31 V2-7 e V2-8): o X "Fechar o painel" fecha e devolve o foco ao item do trilho da aba que
// estava aberta, as 2 ultimas mensagens ficam em pilulas dentro do palco, a mensagem nova do produtor aparece no nome
// do Chat do trilho ("Chat, 1 mensagem nova") e reabrir tira o contador. O trilho: o item Perguntas abre o painel na
// aba e, aberto, fecha com o foco nele; com o painel em Perguntas a mensagem nova tambem entra no Chat do trilho.
// As Perguntas no estilo do YouTube (Y8): a linha de chips que rola de lado (a seta e o Tab trazem o chip escondido, e
// o escolhido fica inteiro na vista) e o ordenar do cabecalho com o menu (o Esc fecha so o menu); o filtro e a ordem
// sao da sala e continuam depois de trocar de aba.
// A enquete no palco (docs/31 V2-10): aberta pela equipe, ela abre centrada dentro do palco mesmo com o painel fechado,
// sem pegar o foco; "Responder depois" a recolhe para o card "Enquete aberta · você deixou para depois" do chat (o
// foco vai ao Chat do trilho), que continua ao recarregar; "Responder agora" a traz de volta com o foco na primeira opcao, e
// "Enviar resposta" grava pela nossa rota (201) e a aba Enquetes diz "Resposta enviada".
// A Visão do vídeo (docs/31 V2-16 e V2-A5): Grade vai por setTileView(true) sem remontar o iframe; o botao diz o que o
// motor mostra (o tileViewChanged), nunca a escolha guardada; o Esc no menu so fecha o menu; ao recarregar e entrar, a
// Grade guardada volta depois do videoConferenceJoined. Com o painel aberto (a grade do YouTube, V2-A53) o iframe fica
// abaixo de 1013 px ja a 1440 px e a coluna de miniaturas sai (toggleFilmStrip; os selos deixam de descontar a coluna
// quando o motor confirma); com o painel fechado pelo trilho ela volta.
// O microfone recolhido (docs/31 V2-19): a equipe que recolhe o microfone (rejectParticipant de audio) o tira da barra
// mesmo ja desligado pela aluna, quando nenhum mudo chega, com o aviso da equipe; o foco que estava nele volta para a sala.

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

/**
 * O item do trilho a direita (a sala no estilo do YouTube, a partir de lg) pelo comeco do nome: o rotulo da aba, e no
 * Chat com mensagens novas, "Chat, 1 mensagem nova".
 */
function itemDoTrilho(dialogo: Locator, rotulo: string) {
  return dialogo.getByRole("navigation", { name: WEBINAR_COPY.salaV2.painel.rotulo }).getByRole("button", { name: new RegExp(`^${rotulo}`) });
}

test("Entrar na sala: o construtor recebe a sala, o token e a barra vazia; camera com o aviso, mao levantada, o microfone liberado com Falar e recolhido pela equipe; nada cita o Jitsi", async ({ page }) => {
  const ambiente = ambienteDaSalaAoVivo();
  const { dialogo, montagem, sala } = await entrarNaSala(page);
  // Dentro da sala a faixa "Ao vivo agora" nunca aparece (docs/30 §1.1).
  await expect(page.getByRole("complementary", { name: WEBINAR_COPY.faixa.rotulo })).toHaveCount(0);
  // A sala cobre o topo da area: no computador, a logo da escola no cabecalho da sala, sem link (sair passa pela
  // confirmacao).
  await expect(dialogo.getByRole("img", { name: "Bunker707" })).toBeVisible();
  await expect(dialogo.getByRole("link", { name: "Bunker707" })).toHaveCount(0);
  // O topo no estilo do YouTube a 1280 px: 64 px, a linha de baixo do titulo so com a data, a duracao e quem apresenta
  // (o numero de quem assiste saiu dela, docs/31 §11.5) e o tema redondo sem contorno.
  const topo = dialogo.locator("header").first();
  await expect.poll(async () => (await topo.boundingBox())?.height ?? 0).toBe(64);
  await expect(topo.locator('[data-room-line="meta"]')).toHaveText(new RegExp(`· com ${APRESENTADOR}$`));
  await expect(topo.locator('[data-room-line="meta"]')).not.toHaveText(/assistindo/);
  await expect(topo.getByTestId("room-present")).toHaveCount(0);
  // Quem assiste agora: o selo com o icone de pessoas e o numero, no palco, logo a direita do "Ao vivo".
  const palcoDoTopo = dialogo.locator("[data-lesson-player-stage]");
  const quemAssiste = palcoDoTopo.getByTestId("room-present");
  await expect(quemAssiste).toBeVisible();
  await expect(quemAssiste).toHaveAttribute("title", /^\d+ assistindo agora$/);
  await expect(quemAssiste.locator("svg")).toBeVisible();
  const caixaDoAoVivo = await palcoDoTopo.getByTestId("room-on-air").boundingBox();
  const caixaDeQuemAssiste = await quemAssiste.boundingBox();
  expect(caixaDeQuemAssiste?.x ?? 0, "a direita do Ao vivo").toBeGreaterThanOrEqual((caixaDoAoVivo?.x ?? 0) + (caixaDoAoVivo?.width ?? Number.POSITIVE_INFINITY));
  expect(Math.abs((caixaDeQuemAssiste?.y ?? 0) - (caixaDoAoVivo?.y ?? Number.POSITIVE_INFINITY)), "na mesma linha").toBeLessThanOrEqual(1);
  const botaoDoTema = topo.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.tema.claro });
  await expect(botaoDoTema).toBeVisible();
  expect(await botaoDoTema.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  // A dica do tema (o ultimo botao do topo, a 20 px da borda) fica presa a borda direita dele e inteira na janela:
  // centrada, ela passava da borda.
  await botaoDoTema.hover();
  const dicaDoTema = topo.locator("[data-room-tooltip]");
  await expect(dicaDoTema).toHaveText(WEBINAR_COPY.salaV2.tema.claro);
  await expect(dicaDoTema).toBeInViewport({ ratio: 1 });
  const [caixaDoTema, caixaDaDica] = [await botaoDoTema.boundingBox(), await dicaDoTema.boundingBox()];
  expect((caixaDaDica?.x ?? 0) + (caixaDaDica?.width ?? 0)).toBeLessThanOrEqual((caixaDoTema?.x ?? 0) + (caixaDoTema?.width ?? 0) + 0.5);
  await topo.getByRole("heading", { level: 1 }).hover();
  await expect(dicaDoTema).toHaveCount(0);

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
    // Nenhum aviso do motor na tela (os que importam viram o aviso da sala), nem o selo do motor no topo nem o som da mao.
    conferenceInfo: { alwaysVisible: [], autoHide: [] },
    disabledSounds: ["RAISE_HAND_SOUND"],
    notifications: [],
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
  const botaoMicrofone = dialogo.getByRole("button", { exact: true, name: aoVivo.microfone });
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "true");

  // Os avisos do motor ficam escondidos (notifications: []): o motor avisa o microfone ligado sem som e o aviso nosso
  // aparece no palco, com Configurações, que abre o painel (o foco vai ao botao da barra e o aviso sai).
  const aviso = dialogo.getByTestId("live-notice");
  await sala.disparar("notificationTriggered", { title: "toolbar.noAudioSignalTitle" });
  await expect(aviso).toHaveText(WEBINAR_COPY.salaV2.avisos.semSomDoMicrofone);
  await dialogo.locator("[data-room-snackbar]").getByRole("button", { exact: true, name: aoVivo.configuracoes }).click();
  const painelDeConfiguracoes = dialogo.getByTestId("live-settings");
  await expect(painelDeConfiguracoes).toBeVisible();
  await expect(aviso).toHaveCount(0);
  const botaoConfiguracoes = dialogo.getByRole("button", { exact: true, name: aoVivo.configuracoes });
  await expect(botaoConfiguracoes).toBeFocused();
  await botaoConfiguracoes.click();
  await expect(painelDeConfiguracoes).toHaveCount(0);
  // O aviso do motor fora da lista (a mao levantada de outra pessoa) nao mostra nada, nem o texto do motor.
  await sala.disparar("notificationTriggered", { description: "notify.raisedHand", title: "notify.somebody" });
  await page.evaluate(() => new Promise((pronto) => requestAnimationFrame(() => requestAnimationFrame(pronto))));
  expect(await aviso.count()).toBe(0);
  // A gravacao que liga com a aluna ja na sala: o aviso nosso, no lugar do "Gravando" do motor.
  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  await expect(aviso).toHaveText(WEBINAR_COPY.salaV2.avisos.gravacaoComecou);
  await expect(dialogo.locator("[data-lesson-player-stage]").getByTestId("live-recording")).toBeVisible();

  // A equipe recolhe o microfone (o "Tirar do palco" do console manda rejectParticipant de audio) com ele ja desligado
  // pela propria aluna, quando nenhum mudo chega: o Microfone sai da barra e o aviso da equipe aparece (V2-19).
  const antesDeDesligar = (await sala.comandos()).length;
  await botaoMicrofone.click();
  await sala.esperarComando("toggleAudio", { depoisDe: antesDeDesligar });
  await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "false");
  // O foco fica no Microfone (o WebKit nao foca o botao no clique): quando ele some, o foco volta para dentro da sala,
  // nunca para o body, onde o Esc, os atalhos e a trava do Tab deixariam de valer.
  await botaoMicrofone.focus();
  await sala.disparar("moderationParticipantRejected", { id: PARTICIPANTE, mediaType: "audio" });
  await expect(botaoMicrofone).toHaveCount(0);
  await expect(dialogo.getByTestId("live-notice")).toContainText(aoVivo.microfoneSilenciado);
  await expect(page.locator("body")).not.toBeFocused();
  await expect.poll(() => dialogo.evaluate((elemento) => elemento.contains(document.activeElement))).toBe(true);

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

test("a logo da sala e a do topo da area (docs/31 V2-3): a mesma largura, a mesma altura e o mesmo arquivo no Chromium (1x) e no WebKit (2x), a 16 px da borda, sem o menu", async ({ page }) => {
  /** A caixa da logo depois de carregada (a altura sai da proporcao do arquivo) e o arquivo que o navegador escolheu. */
  const caixaDaLogo = async (img: Locator) => {
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.currentSrc !== "")).toBe(true);
    const box = await img.boundingBox();
    const currentSrc = new URL(await img.evaluate((el: HTMLImageElement) => el.currentSrc));
    return { altura: box!.height, currentSrc: currentSrc.pathname + currentSrc.search, largura: box!.width, x: box!.x };
  };

  // Na pagina da live: a logo do topo da area.
  await salaFalsaDoJitsi(page);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  const daArea = await caixaDaLogo(page.locator("[data-member-topbar] img[alt='Bunker707']"));

  // Entrar: a sala cobre o topo da area, e a logo do cabecalho dela e a mesma (antes, 112 px contra 150).
  await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);
  const dialogo = page.getByRole("dialog", { name: titulo });
  const daSala = await caixaDaLogo(dialogo.locator("[data-room-brand] img"));
  expect(daSala.largura).toBe(daArea.largura);
  expect(daSala.altura).toBeCloseTo(daArea.altura, 1);
  expect(daSala.currentSrc).toBe(daArea.currentSrc);
  expect(daSala.x).toBe(16);
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
  // A logo padrao, toda branca, continua a mesma imagem e fica preta sobre o fundo claro (opcao C, docs/31 V2-A58).
  const logo = dialogo.locator("[data-room-brand] img");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveCSS("filter", "brightness(0)");

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

test("o trilho e o balao do chat (docs/31 V2-6 a V2-8; a sala no estilo do YouTube): no computador o Chat do trilho esconde o painel e o palco cresce sem remontar o iframe; recarregar mantem fechado e o Chat do trilho reabre; o Sair fica na barra; a 375 px a barra cabe, os circulos tem 44 px, o balao volta e a Tela cheia fica no palco", async ({ page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo, sala } = await entrarNaSala(page);
  const chat = dialogo.getByTestId("room-panel");
  const palco = dialogo.locator("[data-lesson-player-stage]");
  await expect(chat).toBeVisible();
  const larguraAntes = (await palco.boundingBox())?.width ?? 0;
  expect(larguraAntes).toBeGreaterThan(0);

  // No computador o trilho a direita abre e fecha o painel (o balao e as abas ficam so abaixo de lg). O Chat aberto
  // controla o painel (aria-expanded, nunca aria-pressed); tocar nele esconde o painel (sem desmontar) e o palco toma a
  // largura.
  const chatDoTrilho = itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.chat);
  await expect(dialogo.getByRole("button", { exact: true, name: painel.esconder })).toBeHidden();
  await expect(chat.getByRole("tablist")).toBeHidden();
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "true");
  expect(await chatDoTrilho.getAttribute("aria-pressed")).toBeNull();
  await expect(chatDoTrilho).toHaveAttribute("aria-controls", "room-panel");
  await chatDoTrilho.click();
  await expect(chat).toBeHidden();
  await expect(chat).toHaveCount(1);
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await palco.boundingBox())?.width ?? 0).toBeGreaterThan(larguraAntes + 300);
  expect(await sala.montagens(), "abrir e fechar o painel so troca classes: o iframe e o mesmo").toBe(1);

  // A escolha fica guardada no navegador: recarregar mantem fechado; o Chat do trilho reabre.
  await page.reload();
  await expect(dialogo).toHaveAttribute("data-room-kind", "live");
  await expect(dialogo.getByTestId("room-panel")).toBeHidden();
  await chatDoTrilho.click();
  await expect(dialogo.getByTestId("room-panel")).toBeVisible();
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "true");

  // No computador o Sair fica na barra, a esquerda; o do cabecalho so aparece abaixo de lg.
  const barra = dialogo.getByRole("group", { name: aoVivo.barra });
  await expect(barra.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair })).toBeVisible();
  await expect(dialogo.locator("header").first().getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair })).toHaveCount(0);

  // A 375 px: o trilho sai e o balao volta a barra; a barra cabe na largura (sem rolar por dentro), os circulos tem 44
  // px e a Tela cheia (ou o Modo cinema) sai da barra e fica no canto do palco.
  await page.setViewportSize({ height: 740, width: 375 });
  await expect(dialogo.getByRole("navigation", { name: painel.rotulo })).toBeHidden();
  await expect(barra.getByRole("button", { exact: true, name: painel.esconder })).toBeVisible();
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

test("o painel fechado (docs/31 V2-7 e V2-8; a sala no estilo do YouTube): o X fecha e o foco vai ao Chat do trilho; as 2 ultimas mensagens ficam em pilulas no palco; a mensagem nova do produtor entra no nome do Chat do trilho e reabrir zera o contador", async ({ browser, page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo } = await entrarNaSala(page);
  const chat = dialogo.getByTestId("room-panel");
  const palco = dialogo.locator("[data-lesson-player-stage]");
  await expect(chat).toBeVisible();
  // O trilho "Painel da sala" a direita (a mesma regra das abas nas tres salas): Chat, Perguntas e Participantes; o
  // titulo do painel diz a aba aberta.
  const trilho = dialogo.getByRole("navigation", { name: painel.rotulo });
  await expect(trilho.getByRole("button")).toHaveText([WEBINAR_COPY.sala.abas.chat, WEBINAR_COPY.sala.abas.perguntas, WEBINAR_COPY.sala.abas.participantes]);
  await expect(chat.getByRole("heading", { level: 2, name: WEBINAR_COPY.sala.abas.chat })).toBeVisible();

  // O produtor escreve no chat da live pela rota da sala (a primeira mensagem com o aceite).
  const produtor = await abrirComoProdutor(browser);
  const escrever = async (texto: string) => {
    const resposta = await produtor.pagina.request.post(`/api/webinars/${LIVE_AO_VIVO_DE_TESTE.id}/chat`, {
      data: { body: texto, consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId }
    });
    expect(resposta.status(), texto).toBe(201);
  };
  const lista = chat.getByRole("log");
  try {
    // Uma janela baixa, para a lista do chat transbordar: a 1440 x 900, com poucas mensagens, ela nem rolava, e o fim da
    // lista ao reabrir (abaixo) passava sem o chatListOnShow. A rajada do chat (5 por 60 s) limita o produtor a 4 aqui.
    await page.setViewportSize({ height: 380, width: 1440 });
    await escrever("abre a conversa do produtor no painel");
    await escrever("primeira do produtor no painel");
    await escrever("segunda do produtor no painel");
    await expect(lista.getByText("segunda do produtor no painel")).toBeVisible({ timeout: 15_000 });
    // A lista transborda e o aluno esta no fim dela (a mensagem que chega rola quem esta no fim).
    await expect.poll(() => lista.evaluate((elemento) => elemento.scrollHeight > elemento.clientHeight + 16)).toBe(true);
    await expect(lista.getByText("segunda do produtor no painel")).toBeInViewport();

    // O X fecha o painel (montado e escondido) e o foco vai ao item do trilho da aba que estava aberta, que o reabre;
    // o trilho continua na tela.
    await chat.getByRole("button", { exact: true, name: painel.fechar }).click();
    await expect(chat).toBeHidden();
    const mostrar = itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.chat);
    await expect(mostrar).toBeFocused();
    await expect(mostrar).toHaveAttribute("aria-expanded", "false");
    await expect(trilho).toBeVisible();

    // As 2 ultimas mensagens em pilulas dentro do palco (tambem no computador), a mais nova embaixo.
    const pilulas = palco.getByTestId("room-chat-pills");
    await expect(pilulas.locator("li")).toHaveCount(2);
    await expect(pilulas.locator("li").nth(0)).toContainText("primeira do produtor no painel");
    await expect(pilulas.locator("li").nth(1)).toContainText("segunda do produtor no painel");

    // Uma mensagem nova com o painel fechado: o Chat do trilho diz quantas chegaram (o nome comeca pelo rotulo), e as
    // pilulas andam.
    await escrever("terceira do produtor no painel");
    const comNovas = trilho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.trilho.comNovas(WEBINAR_COPY.sala.abas.chat, WEBINAR_COPY.sala.mensagensNovas(1)) });
    await expect(comNovas).toBeVisible({ timeout: 15_000 });
    await expect(comNovas.locator("[data-room-unread]")).toHaveText("1");
    await expect(pilulas.locator("li").nth(1)).toContainText("terceira do produtor no painel");
    await expect(pilulas).not.toContainText("primeira do produtor no painel");

    // Reabrir mostra o chat e tira o contador do item aberto (e as pilulas, porque o chat esta na tela).
    await comNovas.click();
    await expect(chat).toBeVisible();
    const esconder = itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.chat);
    await expect(esconder).toHaveAttribute("aria-expanded", "true");
    await expect(esconder).toHaveAccessibleName(WEBINAR_COPY.sala.abas.chat);
    await expect(esconder.locator("[data-room-unread]")).toHaveCount(0);
    await expect(palco.getByTestId("room-chat-pills")).toHaveCount(0);
    // A lista escondida nao rolou com a mensagem nova: reabrir a leva ao fim (chatListOnShow), e a nova fica na vista.
    // Sem ele, a lista ficava onde estava ao fechar, com a nova inteira abaixo do corte.
    await expect(lista.getByText("terceira do produtor no painel")).toBeInViewport();
    expect(await lista.evaluate((elemento) => elemento.scrollTop + elemento.clientHeight >= elemento.scrollHeight - 1), "a lista no fim").toBe(true);
  } finally {
    await produtor.fechar();
  }
});

test("o trilho a direita (a sala no estilo do YouTube): o item Perguntas abre o painel na aba e, aberto, fecha com o foco nele; fechado, o trilho continua; o X devolve o foco ao item da aba aberta; com o painel em Perguntas, a mensagem nova de outra pessoa entra no Chat do trilho", async ({ browser, page }) => {
  const painel = WEBINAR_COPY.salaV2.painel;
  const abas = WEBINAR_COPY.sala.abas;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo } = await entrarNaSala(page);
  const chat = dialogo.getByTestId("room-panel");
  const trilho = dialogo.getByRole("navigation", { name: painel.rotulo });
  const chatDoTrilho = itemDoTrilho(dialogo, abas.chat);
  const perguntas = itemDoTrilho(dialogo, abas.perguntas);
  await expect(chat).toBeVisible();
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "true");
  // O trilho fica a 16 px da borda direita da janela, com 48 px, e o topo junto com o do painel.
  const caixaDoTrilho = await trilho.boundingBox();
  const caixaDoPainel = await chat.boundingBox();
  expect(Math.round((caixaDoTrilho?.x ?? 0) + (caixaDoTrilho?.width ?? 0))).toBe(1440 - 16);
  expect(Math.round(caixaDoTrilho?.width ?? 0)).toBe(48);
  expect(Math.round(caixaDoTrilho?.y ?? 0)).toBe(Math.round(caixaDoPainel?.y ?? -1));
  // 24 px entre o painel e o trilho.
  expect(Math.round((caixaDoTrilho?.x ?? 0) - ((caixaDoPainel?.x ?? 0) + (caixaDoPainel?.width ?? 0)))).toBe(24);

  // O item Perguntas abre o painel na aba Perguntas: o item fica aberto, o titulo do painel diz o nome da aba e o
  // campo da pergunta esta na tela.
  await perguntas.click();
  await expect(perguntas).toHaveAttribute("aria-expanded", "true");
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "false");
  await expect(chat.getByRole("heading", { level: 2, name: abas.perguntas })).toBeVisible();
  await expect(chat.getByRole("textbox", { name: WEBINAR_COPY.sala.suaPergunta })).toBeVisible();

  // Com o painel em Perguntas, o Chat nao esta na tela: a mensagem nova de outra pessoa entra no Chat do trilho, com o
  // numero e o nome "Chat, 1 mensagem nova" (antes do trilho, o painel aberto em qualquer aba zerava o numero).
  const produtor = await abrirComoProdutor(browser);
  try {
    const resposta = await produtor.pagina.request.post(`/api/webinars/${LIVE_AO_VIVO_DE_TESTE.id}/chat`, {
      data: { body: "nova do produtor com as Perguntas abertas", consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId }
    });
    expect(resposta.status()).toBe(201);
  } finally {
    await produtor.fechar();
  }
  const comNova = trilho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.trilho.comNovas(abas.chat, WEBINAR_COPY.sala.mensagensNovas(1)) });
  await expect(comNova).toBeVisible({ timeout: 15_000 });
  await expect(comNova.locator("[data-room-unread]")).toHaveText("1");
  await expect(perguntas).toHaveAttribute("aria-expanded", "true");

  // O mesmo item fecha o painel, e o foco fica nele (pelo teclado: no WebKit o clique nao foca o botao); fechado, o
  // trilho continua na tela, sem item aberto, com o numero no Chat.
  await perguntas.focus();
  await page.keyboard.press("Enter");
  await expect(chat).toBeHidden();
  await expect(perguntas).toBeFocused();
  await expect(perguntas).toHaveAttribute("aria-expanded", "false");
  await expect(trilho).toBeVisible();
  await expect(comNova).toBeVisible();
  // O palco vai ate 24 px antes do trilho.
  const caixaDaColuna = await dialogo.locator('[data-room-slot="stage-column"]').boundingBox();
  expect(Math.round((caixaDoTrilho?.x ?? 0) - ((caixaDaColuna?.x ?? 0) + (caixaDaColuna?.width ?? 0)))).toBe(24);

  // Reaberto em Perguntas, o X devolve o foco ao item da aba que estava aberta (nao ao Chat).
  await page.keyboard.press("Enter");
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("heading", { level: 2, name: abas.perguntas })).toBeVisible();
  await chat.getByRole("button", { exact: true, name: painel.fechar }).click();
  await expect(chat).toBeHidden();
  await expect(perguntas).toBeFocused();

  // O Chat do trilho abre o Chat e tira o numero; a mensagem nova esta na lista.
  await comNova.click();
  await expect(chat).toBeVisible();
  await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "true");
  await expect(chatDoTrilho.locator("[data-room-unread]")).toHaveCount(0);
  await expect(chat.getByRole("log").getByText("nova do produtor com as Perguntas abertas")).toBeVisible();
});

test("as Perguntas no estilo do YouTube (Y8): a 1280 o chip Minhas fica fora da vista e chega pela seta e pelo Tab, e escolhido fica inteiro na vista; a 1440 o ordenar do cabecalho abre o menu, o Esc fecha so o menu com o foco de volta ao botao, e trocar de aba nao perde o filtro nem a ordem", async ({ page }) => {
  const abas = WEBINAR_COPY.sala.abas;
  const novas = WEBINAR_COPY.salaV2.perguntas;
  const ordem = WEBINAR_COPY.sala.ordem;
  await page.setViewportSize({ height: 800, width: 1280 });
  const { dialogo } = await entrarNaSala(page);
  const painel = dialogo.getByTestId("room-panel");
  await itemDoTrilho(dialogo, abas.perguntas).click();
  await expect(painel.getByRole("heading", { level: 2, name: abas.perguntas })).toBeVisible();

  // A linha de chips (Todas, Sem resposta, Respondidas, Minhas) nao cabe no painel de 352 px: Minhas fica fora da vista.
  const filtros = painel.getByRole("group", { name: novas.filtrar });
  await expect(filtros.getByRole("button")).toHaveText([WEBINAR_COPY.sala.filtros.todas, novas.semResposta, WEBINAR_COPY.sala.filtros.respondidas, novas.minhas]);
  const todas = filtros.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.filtros.todas });
  const minhas = filtros.getByRole("button", { exact: true, name: novas.minhas });
  await expect(todas).toHaveAttribute("aria-pressed", "true");
  /** O chip inteiro dentro da caixa que rola. */
  const inteiroNaVista = (chip: Locator) =>
    chip.evaluate((element) => {
      const caixa = element.closest('[role="group"]')?.getBoundingClientRect();
      const chipBox = element.getBoundingClientRect();
      return Boolean(caixa) && chipBox.left >= (caixa?.left ?? 0) - 0.5 && chipBox.right <= (caixa?.right ?? 0) + 0.5;
    });
  await expect.poll(() => inteiroNaVista(minhas)).toBe(false);
  const setaDireita = painel.locator('[data-room-chip-arrow="right"]');
  const setaEsquerda = painel.locator('[data-room-chip-arrow="left"]');
  await expect(setaDireita).toBeVisible();
  await expect(setaEsquerda).toHaveCount(0);

  // A seta da direita (so do ponteiro: fora do Tab e do leitor de tela) traz Minhas; no fim, so a seta da esquerda.
  await expect(setaDireita).toHaveAttribute("aria-hidden", "true");
  await expect(setaDireita).toHaveAttribute("tabindex", "-1");
  await setaDireita.click();
  await expect.poll(() => inteiroNaVista(minhas)).toBe(true);
  await expect(setaDireita).toHaveCount(0);
  await expect(setaEsquerda).toBeVisible();
  await setaEsquerda.click();
  await expect.poll(() => inteiroNaVista(minhas)).toBe(false);

  // Pelo Tab tambem: o chip focado rola para a vista.
  await todas.focus();
  for (let vez = 0; vez < 3; vez += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(minhas).toBeFocused();
  await expect.poll(() => inteiroNaVista(minhas)).toBe(true);

  // Escolhido, Minhas fica ligado e inteiro na vista, e so ele.
  await page.keyboard.press("Enter");
  await expect(minhas).toHaveAttribute("aria-pressed", "true");
  await expect(todas).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => inteiroNaVista(minhas)).toBe(true);

  // A 1440, o ordenar do cabecalho: o menu abre com o foco na ordem marcada; o Esc fecha so o menu (nada de "sair da
  // sala") e o foco volta ao botao.
  await page.setViewportSize({ height: 900, width: 1440 });
  const ordenar = painel.getByRole("button", { exact: true, name: novas.ordenar });
  await expect(ordenar).toHaveAttribute("aria-haspopup", "menu");
  await ordenar.click();
  const menu = dialogo.getByRole("menu", { name: novas.ordenar });
  await expect(menu).toBeVisible();
  await expect(ordenar).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitemradio", { exact: true, name: ordem.maisVotadas })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { exact: true, name: ordem.maisVotadas })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(ordenar).toBeFocused();
  await expect(ordenar).toHaveAttribute("aria-expanded", "false");
  await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);

  // Mais recentes, escolhida, fecha o menu; trocar de aba e voltar nao perde a ordem nem o filtro (sao da sala).
  await ordenar.click();
  await menu.getByRole("menuitemradio", { exact: true, name: ordem.maisRecentes }).click();
  await expect(menu).toBeHidden();
  await itemDoTrilho(dialogo, abas.chat).click();
  await expect(painel.getByRole("heading", { level: 2, name: abas.chat })).toBeVisible();
  await itemDoTrilho(dialogo, abas.perguntas).click();
  await expect(minhas).toHaveAttribute("aria-pressed", "true");
  await ordenar.click();
  await expect(menu.getByRole("menuitemradio", { exact: true, name: ordem.maisRecentes })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { exact: true, name: ordem.maisVotadas })).toHaveAttribute("aria-checked", "false");
});

test("as Perguntas no estilo do YouTube (Y10 e Y11): o campo abre no foco, o Enter quebra a linha e o Ctrl+Enter pergunta com a Anônima; o voto marca o polegar; a resposta escrita da equipe chega no fio '1 resposta' aberto na minha; os chips filtram e o ordenar rele", async ({ page }) => {
  const sala = WEBINAR_COPY.sala;
  const novas = WEBINAR_COPY.salaV2.perguntas;
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo } = await entrarNaSala(page);
  const painel = dialogo.getByTestId("room-panel");
  await itemDoTrilho(dialogo, sala.abas.perguntas).click();
  await expect(painel.getByRole("heading", { level: 2, name: sala.abas.perguntas })).toBeVisible();

  // Fechado, o campo nao tem o rodape; o foco (o fill) abre: a Anonima, o Cancelar e o Perguntar.
  const campo = painel.getByRole("textbox", { name: sala.suaPergunta });
  const perguntar = painel.getByRole("button", { exact: true, name: novas.perguntar });
  await expect(perguntar).toHaveCount(0);
  const pergunta = `o replay fica ate quando? ${Date.now()}`;
  await campo.fill(pergunta);
  await expect(perguntar).toBeVisible();
  await expect(painel.getByRole("button", { exact: true, name: WEBINAR_COPY.admin.cancelar })).toBeVisible();
  const anonima = painel.getByRole("button", { exact: true, name: sala.anonima });
  await expect(anonima).toHaveAttribute("aria-pressed", "false");
  await anonima.click();
  await expect(anonima).toHaveAttribute("aria-pressed", "true");

  // Nas Perguntas o Enter quebra a linha (nada vai ao servidor); o Ctrl ou o ⌘ com o Enter pergunta.
  await campo.press("End");
  await campo.press("Enter");
  await expect(campo).toHaveValue(`${pergunta}\n`);
  const enviou = page.waitForResponse((response) => response.url().endsWith("/questions") && response.request().method() === "POST");
  await campo.press("ControlOrMeta+Enter");
  // A primeira pergunta abre o aceite do chat quando a aluna ainda nao aceitou (os testes deste arquivo rodam em serie).
  const aceite = dialogo.getByRole("group", { name: /Ao enviar mensagens neste chat/ });
  const primeiro = await Promise.race([enviou.then(() => "enviou"), aceite.waitFor({ state: "visible" }).then(() => "aceite", () => "nada")]);
  if (primeiro === "aceite") {
    await aceite.getByRole("button", { exact: true, name: sala.consentimentoBotao }).click();
  }
  const resposta = await enviou;
  expect(resposta.status()).toBe(201);
  // A rota da sala responde no envelope { data } (room-route.ts ok()).
  const {
    data: { question }
  } = (await resposta.json()) as { data: { question: { anonymous: boolean; id: string } } };
  expect(question.anonymous).toBe(true);
  // Depois de perguntar, o campo fecha e fica vazio.
  await expect(campo).toHaveValue("");
  await expect(perguntar).toHaveCount(0);

  // A minha pergunta como comentario: "Anônima" no lugar do nome, e o voto marca o polegar e o numero.
  const minha = painel.locator(`[data-room-question="${question.id}"]`);
  await expect(minha).toContainText(pergunta);
  await expect(minha.getByText(sala.anonima, { exact: true })).toBeVisible();
  const curtir = minha.getByRole("button", { exact: true, name: sala.curtir });
  await expect(curtir).toHaveAttribute("aria-pressed", "false");
  const votou = page.waitForResponse((response) => response.url().includes(`/questions/${question.id}/vote`) && response.request().method() === "POST");
  await curtir.click();
  expect((await votou).status()).toBeLessThan(300);
  await expect(curtir).toHaveAttribute("aria-pressed", "true");
  await expect(minha.getByText(sala.curtidas(1), { exact: true })).toHaveCount(1);
  await expect(minha.getByRole("button", { name: novas.respostas(1) })).toHaveCount(0);

  // A equipe responde por escrito (como o console grava a resposta); a releitura (trocar de aba e voltar le de novo) traz
  // o fio "1 resposta" ja aberto na minha, com a resposta da Equipe.
  const textoDaResposta = "Fica disponível por 7 dias.";
  unwrap(
    await createLocalAdminClient()
      .from("webinar_questions")
      .update({ answer_source: "team", answer_text: textoDaResposta, answered_at: new Date().toISOString(), answered_live: false, status: "answered" })
      .eq("id", question.id),
    "Respondendo a pergunta por escrito"
  );
  await itemDoTrilho(dialogo, sala.abas.chat).click();
  await itemDoTrilho(dialogo, sala.abas.perguntas).click();
  // O botao do fio e o mesmo nos dois estados (o nome muda): aberto, "Ocultar respostas" depois da resposta, como no
  // YouTube; fechado, "1 resposta" logo abaixo da pergunta.
  const fio = minha.locator(`button[aria-controls="resposta-${question.id}"]`);
  await expect(fio).toHaveAttribute("aria-expanded", "true");
  await expect(fio).toHaveAccessibleName(novas.ocultarRespostas);
  const blocoDaResposta = minha.locator(`#resposta-${question.id}`);
  await expect(blocoDaResposta).toBeVisible();
  await expect(blocoDaResposta).toContainText(textoDaResposta);
  await expect(blocoDaResposta.getByText(sala.selos.equipe, { exact: true })).toBeVisible();
  const caixaDaResposta = await blocoDaResposta.boundingBox();
  const caixaDoBotao = await fio.boundingBox();
  expect(caixaDoBotao!.y, "o Ocultar respostas fica depois da resposta").toBeGreaterThanOrEqual(caixaDaResposta!.y + caixaDaResposta!.height - 1);
  // O clique fecha o fio (a resposta continua no HTML, escondida), o botao volta a "1 resposta" com o foco nele, e abre
  // de novo.
  await fio.click();
  await expect(fio).toHaveAttribute("aria-expanded", "false");
  await expect(fio).toHaveAccessibleName(novas.respostas(1));
  await expect(fio).toBeFocused();
  await expect(blocoDaResposta).toBeHidden();
  await fio.click();
  await expect(blocoDaResposta).toBeVisible();
  await expect(fio).toBeFocused();

  // Os chips filtram: em Sem resposta a minha (respondida) sai; em Respondidas ela volta.
  const filtros = painel.getByRole("group", { name: novas.filtrar });
  await filtros.getByRole("button", { exact: true, name: novas.semResposta }).click();
  await expect(minha).toHaveCount(0);
  await filtros.getByRole("button", { exact: true, name: sala.filtros.respondidas }).click();
  await expect(minha).toBeVisible();

  // O ordenar do cabecalho rele a lista na ordem escolhida.
  const releu = page.waitForRequest((request) => request.method() === "GET" && request.url().includes("/questions?") && request.url().includes("ordem=recentes"));
  await painel.getByRole("button", { exact: true, name: novas.ordenar }).click();
  await dialogo.getByRole("menu", { name: novas.ordenar }).getByRole("menuitemradio", { exact: true, name: sala.ordem.maisRecentes }).click();
  await releu;
  await expect(minha).toBeVisible();
});

test("o chat com mais de uma tela (Y11): a lista rola ate a primeira mensagem; com a aluna no fim, o foco no campo abre o rodape e a ultima mensagem continua inteira na vista", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  const { dialogo } = await entrarNaSala(page);
  const painel = dialogo.getByTestId("room-panel");
  const lista = painel.getByRole("log");
  await expect(painel.getByRole("heading", { level: 2, name: WEBINAR_COPY.sala.abas.chat })).toBeVisible();
  // Uma janela baixa, para a lista transbordar com poucas mensagens.
  await page.setViewportSize({ height: 420, width: 1440 });
  // A equipe escreve pelo banco (fora da rajada do chat), depois da entrada: a consulta de 5 s traz as novas.
  const agora = Date.now();
  const marca = `rolagem ${agora}`;
  // A sala ordena o chat pelo momento da live (offset_ms): as mensagens novas levam o momento de agora desde o inicio da
  // sessao, para entrarem no fim da lista, depois das que os testes anteriores deixaram.
  const db = createLocalAdminClient();
  const { started_at: inicioDaLive } = unwrap(
    await db.from("webinar_sessions").select("started_at").eq("id", LIVE_AO_VIVO_DE_TESTE.sessaoId).single(),
    "Lendo o inicio da live de teste"
  ) as { started_at: string };
  const momentoDeAgora = agora - Date.parse(inicioDaLive);
  unwrap(
    await db
      .from("webinar_chat_messages")
      .insert(
        Array.from({ length: 12 }, (_, index) => ({
          approved: true,
          author_user_id: null,
          body: `${marca}: mensagem ${index + 1}`,
          created_at: new Date(agora + index).toISOString(),
          display_name: "Equipe T.",
          kind: "message",
          master: false,
          offset_ms: momentoDeAgora + index,
          role: "team",
          session_id: LIVE_AO_VIVO_DE_TESTE.sessaoId,
          source: "team",
          webinar_id: LIVE_AO_VIVO_DE_TESTE.id
        }))
      ),
    "Gravando as mensagens da equipe"
  );
  // O texto do comentario comeca pelo autor so para o leitor de tela: a mensagem e o fim do texto.
  const primeira = lista.getByText(new RegExp(`${marca}: mensagem 1$`));
  const ultima = lista.getByText(new RegExp(`${marca}: mensagem 12$`));
  await expect(ultima).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => lista.evaluate((elemento) => elemento.scrollHeight > elemento.clientHeight + 16)).toBe(true);
  await expect(ultima).toBeInViewport();

  // A lista comeca em cima: rolada ate o topo, o primeiro item aparece (nunca fica fora do alcance). O primeiro item e a
  // mensagem mais antiga da sessao, que pode ser de um teste anterior; a "mensagem 1" daqui fica antes da 12.
  await lista.evaluate((elemento) => {
    elemento.scrollTop = 0;
  });
  await expect(lista.locator(":scope > li").first()).toBeInViewport();
  await expect(primeira).toBeAttached();

  // De volta ao fim, o foco no campo abre o rodape (a lista encolhe) e a ultima continua inteira na vista.
  await lista.evaluate((elemento) => {
    elemento.scrollTop = elemento.scrollHeight;
  });
  await expect(ultima).toBeInViewport({ ratio: 1 });
  await painel.getByRole("textbox", { name: WEBINAR_COPY.sala.escreva }).focus();
  await expect(painel.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.enviar })).toBeVisible();
  await expect(ultima).toBeInViewport({ ratio: 1 });
});

test("a enquete no palco (docs/31 V2-10): com o painel fechado ela abre centrada no palco sem pegar o foco; Responder depois recolhe para o card do chat, que fica ao recarregar; Responder agora volta ao palco e Enviar resposta grava", async ({ page }) => {
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

  // O painel fechado pelo Chat do trilho (guardado no navegador): a enquete abre assim mesmo.
  const chatDoTrilho = itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.chat);
  await chatDoTrilho.click();
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
    await expect(palco.locator("[data-room-poll-said]")).toHaveText(enquete.anuncioAberta(pergunta));

    // Responder depois: a camada sai e o foco vai ao Chat do trilho (o card do chat esta no painel fechado; o balao fica
    // so abaixo de lg).
    await camada.getByRole("button", { exact: true, name: enquete.responderDepois }).click();
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    const mostrar = chatDoTrilho;
    await expect(mostrar).toBeFocused();
    await expect(mostrar).toHaveAttribute("aria-expanded", "false");
    // O atalho E (V2-10) traz a enquete deixada para depois de volta ao palco, com o foco na primeira opcao; deixada para
    // depois de novo, o foco volta ao Chat do trilho.
    await page.keyboard.press("e");
    await expect(camada).toBeVisible();
    await expect(camada.getByRole("radio", { name: "O chat" })).toBeFocused();
    await camada.getByRole("button", { exact: true, name: enquete.responderDepois }).click();
    await expect(palco.getByRole("dialog")).toHaveCount(0);
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
    // O Esc com o foco na enquete vale como Responder depois: ela volta ao card do chat, o foco vai ao Responder agora e a
    // sala nao pergunta se quer sair. Responder agora a traz de novo.
    await page.keyboard.press("Escape");
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);
    await expect(card.getByRole("button", { exact: true, name: enquete.responderAgora })).toBeFocused();
    await card.getByRole("button", { exact: true, name: enquete.responderAgora }).click();
    await expect(camada).toBeVisible();
    await expect(camada.getByRole("radio", { name: "O chat" })).toBeFocused();
    const enviar = camada.getByRole("button", { exact: true, name: enquete.enviarResposta });
    await expect(enviar).toBeDisabled();
    await camada.getByRole("radio", { name: "As perguntas" }).check();
    const resposta = page.waitForResponse((response) => response.url().endsWith("/polls") && response.request().method() === "POST");
    await enviar.click();
    const envio = await resposta;
    expect(envio.status()).toBe(201);
    expect(envio.request().postDataJSON()).toMatchObject({ optionIds: [optionIds[1]], pollId, sessionId: LIVE_AO_VIVO_DE_TESTE.sessaoId });

    // Enviada: a camada sai, o foco vai ao Chat do trilho (o painel esta aberto no Chat), a regiao viva diz "Resposta
    // enviada" e a aba Enquetes tambem.
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    await expect(chatDoTrilho).toBeFocused();
    await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "true");
    await expect(palco.locator("[data-room-poll-said]")).toHaveText(WEBINAR_COPY.sala.enquete.respondida);
    // Com a enquete aberta, o trilho ganha o Enquetes por ultimo, com o ponto do acento.
    const enquetesDoTrilho = itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.enquetes);
    await expect(enquetesDoTrilho).toBeInViewport({ ratio: 1 });
    await expect(enquetesDoTrilho).toHaveAttribute("aria-expanded", "false");
    // Respondida, o atalho E abre a aba Enquetes no painel (nada volta ao palco): o item Enquetes do trilho fica aberto e
    // o titulo do painel diz Enquetes, com o numero de enquetes abertas.
    await page.keyboard.press("e");
    await expect(enquetesDoTrilho).toHaveAttribute("aria-expanded", "true");
    await expect(chatDoTrilho).toHaveAttribute("aria-expanded", "false");
    await expect(chat.getByRole("heading", { level: 2, name: new RegExp(`^${WEBINAR_COPY.sala.abas.enquetes}\\s*1$`) })).toBeVisible();
    await expect(palco.getByRole("dialog")).toHaveCount(0);
    await expect(dialogo.getByTestId("room-polls").getByText(WEBINAR_COPY.sala.enquete.respondida)).toBeVisible();
  } finally {
    // A enquete aberta ficaria no meio do palco dos testes seguintes.
    await apagarEnqueteDeTeste(pollId);
  }
});

test("a visão do vídeo e a coluna de miniaturas (docs/31 V2-16, V2-A5 e V2-A53): Grade por comando sem remontar, o botao diz o que o motor mostra, a Grade guardada volta na entrada; com o painel aberto a coluna sai (a grade do YouTube) e volta com ele fechado pelo trilho", async ({ page }) => {
  test.setTimeout(120_000);
  const visao = WEBINAR_COPY.salaV2.visao;
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
  // A 1440 px com o painel aberto (a grade do YouTube, docs/31 V2-A53) o iframe tem cerca de 924 px: a sala ja pediu
  // para tirar a coluna, mas ela fica na tela ate o motor confirmar, e os selos param antes dela.
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
  // A confirmacao recebe o foco no Voltar (o Enter seguinte nao tira ninguem da live); o Esc a fecha e o foco volta para
  // quem a abriu (o botao da visao), nunca para o body.
  await expect(dialogo.getByRole("alertdialog").getByRole("button", { exact: true, name: WEBINAR_COPY.sala.voltar })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogo.getByRole("alertdialog")).toHaveCount(0);
  await expect(noPalco).toBeFocused();
  // Um toque fora do botao e do menu (o titulo, que nao recebe foco) fecha o menu.
  await noPalco.click();
  await expect(menu).toBeVisible();
  await dialogo.getByRole("heading", { level: 1 }).click();
  await expect(menu).toBeHidden();
  await expect(noPalco).toHaveAttribute("aria-expanded", "false");
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

  // Com o painel aberto, a grade do YouTube (docs/31 V2-A53) deixa o iframe abaixo de 1013 px ja a 1440 px (cerca de
  // 924): a coluna sai por toggleFilmStrip logo depois da entrada; a 1280 px (cerca de 808) ela continua fora, sem outro
  // comando (um toggleFilmStrip a mais a poria de volta).
  await sala.esperarComando("toggleFilmStrip");
  await page.setViewportSize({ height: 800, width: 1280 });
  // O motor confirma (a coluna escondida): os selos vao ate a borda.
  await sala.disparar("filmstripDisplayChanged", { visible: false });
  await expect.poll(margemDosSelos).toBe("0px");
  expect((await sala.comandos()).filter((item) => item.comando === "toggleFilmStrip")).toHaveLength(1);
  // Fechar o painel pelo Chat do trilho deixa o iframe com mais de 1013 px (cerca de 1176) e a coluna volta.
  antes = (await sala.comandos()).length;
  await itemDoTrilho(dialogo, WEBINAR_COPY.sala.abas.chat).click();
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
  expect((await aviso.allTextContents()).join(" ")).not.toContain(aoVivo.cameraFechadaPelaEquipe);
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
  // O aviso da sala (RoomSnackbar, Y14) so existe enquanto mostra algo: sem aviso, nenhum elemento com a frase da troca.
  await expect(aviso.filter({ hasText: aoVivo.trocandoCameraDesliga })).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(botaoCamera).toHaveAttribute("aria-pressed", "false");
  expect((await aviso.allTextContents()).join(" ")).not.toContain(aoVivo.cameraFechadaPelaEquipe);

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
  expect((await aviso.allTextContents()).join(" ")).not.toContain(aoVivo.microfoneSilenciado);
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
  expect((await aviso.allTextContents()).join(" ")).not.toContain(aoVivo.cameraFechadaPelaEquipe);
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
  // {apresentador}" e o Sair, sem marca e sem selo; o "Ao vivo" (so o tempo, a frase para o leitor de tela), quem
  // assiste agora (docs/31 §11.5) e o Gravando ficam dentro do palco, em cima a esquerda, e quem apresenta embaixo (V2-4).
  await sala.disparar("recordingStatusChanged", { mode: "file", on: true });
  // O aviso da gravacao que comecou, em pe: preso ao pe da tela, acima do campo da folha aberta, nunca sobre o video; a
  // ultima mensagem do chat fica acima dele (a lista ganha o respiro da altura do aviso).
  const avisoDaGravacao = dialogo.getByTestId("live-notice");
  await expect(avisoDaGravacao).toHaveText(WEBINAR_COPY.salaV2.avisos.gravacaoComecou);
  const caixaDoAviso = dialogo.locator("[data-room-snackbar] > div");
  const caixaDoVideo = await dialogo.locator("[data-room-stage]").boundingBox();
  const topoDoAviso = async () => (await caixaDoAviso.boundingBox())?.y ?? 0;
  expect(await topoDoAviso(), "o aviso nao cruza o palco").toBeGreaterThanOrEqual((caixaDoVideo?.y ?? 0) + (caixaDoVideo?.height ?? Number.POSITIVE_INFINITY));
  const ultimaDoChat = dialogo.getByTestId("room-chat").getByRole("log").locator(":scope > li").last();
  await expect
    .poll(async () => {
      const caixa = await ultimaDoChat.boundingBox();
      return (caixa?.y ?? 0) + (caixa?.height ?? 0) <= (await topoDoAviso()) + 0.5;
    })
    .toBe(true);
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
  await expect(linha).toHaveText(`com ${APRESENTADOR}`);
  // Quem assiste agora fica no palco, entre o Ao vivo e o Gravando, e os tres cabem na largura do palco a 375 px.
  const assistindo = palcoDaSala.getByTestId("room-present");
  await expect(assistindo).toBeVisible();
  await expect(assistindo).toHaveAttribute("title", /^\d+ assistindo agora$/);
  await expect(cabecalho.getByTestId("room-present")).toHaveCount(0);
  const caixaDoPalco = await palcoDaSala.boundingBox();
  const selosDeCima = [await noAr.boundingBox(), await assistindo.boundingBox(), await gravando.boundingBox()];
  for (const [indice, caixa] of selosDeCima.entries()) {
    expect(caixa, `o selo ${indice} na tela`).not.toBeNull();
    expect((caixa?.x ?? 0) + (caixa?.width ?? 0), `o selo ${indice} dentro do palco`).toBeLessThanOrEqual((caixaDoPalco?.x ?? 0) + (caixaDoPalco?.width ?? 0));
    if (indice > 0) {
      expect(caixa?.x ?? 0, `o selo ${indice} depois do anterior`).toBeGreaterThanOrEqual((selosDeCima[indice - 1]?.x ?? 0) + (selosDeCima[indice - 1]?.width ?? Number.POSITIVE_INFINITY));
    }
  }
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

test("a 667 px (celular deitado): o cabecalho do celular (titulo e 'com {apresentador}', sem marca) e os selos Ao vivo, quem assiste e Gravando no palco; Configurações aberto deixa o palco com 96 px, fora de baixo do painel", async ({ page }) => {
  // Abaixo de lg (1024 px, onde a sala vira computador) o cabecalho e o do celular (docs/31 V2-18): a logo e a linha de
  // baixo do titulo com a data so entram em lg; o numero de quem assiste fica no palco (docs/31 §11.5).
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
  await expect(cabecalho.getByTestId("room-present")).toHaveCount(0);
  await expect(palco.getByTestId("room-present")).toBeVisible();
  await expect(palco.getByTestId("room-present")).toHaveAttribute("title", /^\d+ assistindo agora$/);
  const linha = cabecalho.getByTestId("room-mobile-line");
  await expect(linha).toHaveText(`com ${APRESENTADOR}`);
  // A partir de sm o botao de tema volta ao cabecalho, depois do Sair: o tema e sempre o ultimo.
  await expect(cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.tema.claro })).toBeVisible();

  // Deitado, o corpo fica em linha (roomSkeleton): o palco ocupa o que sobra acima da barra e o painel do chat fica ao
  // lado. A barra, o balao, a Tela cheia do canto do palco, as abas e o campo do chat cabem na tela (antes, o palco 16:9
  // na largura empurrava tudo para baixo dela, e o toBeVisible passava com eles fora da tela).
  await expect(dialogo.locator("[data-room-bar]")).toBeInViewport({ ratio: 1 });
  await expect(dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.painel.esconder })).toBeInViewport({ ratio: 1 });
  // O circulo do canto: a Tela cheia deitada fica na tela; o Modo cinema (o navegador sem tela cheia) sai do canto
  // deitado, porque ali ele nao mudaria nada (docs/31 V2-A27).
  const canto = palco.locator("[data-room-stage-corner]");
  if ((await canto.getAttribute("aria-label")) === WEBINAR_COPY.aoVivo.modoCinema) {
    await expect(canto).toBeHidden();
  } else {
    await expect(canto).toBeInViewport({ ratio: 1 });
  }
  await expect(dialogo.getByRole("tab", { exact: true, name: WEBINAR_COPY.sala.abas.chat })).toBeInViewport({ ratio: 1 });
  await expect(dialogo.getByRole("textbox", { name: WEBINAR_COPY.sala.escreva })).toBeInViewport({ ratio: 1 });

  const fim = (caixa: { width: number; x: number } | null) => (caixa?.x ?? Number.POSITIVE_INFINITY) + (caixa?.width ?? 0);
  const caixas = {
    linha: await linha.boundingBox(),
    palco: await palco.boundingBox(),
    sair: await cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair }).boundingBox(),
    tema: await cabecalho.getByRole("button", { exact: true, name: WEBINAR_COPY.salaV2.tema.claro }).boundingBox(),
    titulo: await cabecalho.getByRole("heading", { level: 1 }).boundingBox()
  };
  const bordaDoSair = caixas.sair?.x ?? 0;
  expect(bordaDoSair).toBeGreaterThan(0);
  expect(fim(caixas.sair), "o Sair antes do tema").toBeLessThanOrEqual(caixas.tema?.x ?? 0);
  expect(caixas.titulo?.width ?? 0, "sobra largura para o titulo").toBeGreaterThan(0);
  expect(fim(caixas.titulo)).toBeLessThanOrEqual(bordaDoSair);
  expect(fim(caixas.linha)).toBeLessThanOrEqual(bordaDoSair);
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
  await expect(dialogo.getByRole("tab", { exact: true, name: WEBINAR_COPY.sala.abas.chat })).toBeInViewport({ ratio: 1 });
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

test("o microfone sozinho (docs/31 caminho A): com a politica no banco o Microfone esta na barra sem o Liberar; o primeiro clique abre o aviso com o titulo da politica e so o Falar manda toggleAudio; lotado (moderationStatusChanged de audio ligado), o Microfone fica focavel com o motivo e o clique so avisa", async ({ page }) => {
  const db = createLocalAdminClient();
  const lido = unwrap(await db.from("webinars").select("room_settings").eq("id", LIVE_AO_VIVO_DE_TESTE.id).single(), "Lendo o room_settings da live de teste") as { room_settings: Record<string, unknown> | null };
  const original = lido.room_settings ?? {};
  unwrap(await db.from("webinars").update({ room_settings: { ...original, selfUnmute: true } }).eq("id", LIVE_AO_VIVO_DE_TESTE.id), "Ligando o microfone sozinho");

  try {
    const { dialogo, sala } = await entrarNaSala(page);
    const botaoMicrofone = dialogo.getByRole("button", { exact: true, name: aoVivo.microfone });
    await expect(botaoMicrofone).toBeVisible();
    await expect(botaoMicrofone).not.toHaveAttribute("aria-disabled", "true");

    // O primeiro clique: o aviso de gravacao com o titulo da politica (sem "O apresentador liberou"); nada chega a sala.
    const antes = (await sala.comandos()).length;
    await botaoMicrofone.click();
    const aviso = page.getByTestId("live-mic-dialog");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(aoVivo.microfoneSozinhoTitulo);
    await expect(aviso).toContainText(aoVivo.avisoMicrofone);
    await expect(aviso).not.toContainText(aoVivo.microfoneLiberado);
    expect((await sala.comandos()).slice(antes).some((item) => item.comando === "toggleAudio")).toBe(false);
    await aviso.getByRole("button", { exact: true, name: aoVivo.falar }).click();
    await sala.esperarComando("toggleAudio", { depoisDe: antes });
    await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "true");

    // Depois do aceite, o clique so alterna: fecha sem aviso.
    const antesDeFechar = (await sala.comandos()).length;
    await botaoMicrofone.click();
    await sala.esperarComando("toggleAudio", { depoisDe: antesDeFechar });
    await expect(botaoMicrofone).toHaveAttribute("aria-pressed", "false");
    await expect(aviso).toHaveCount(0);

    // Lotado: o vigia do console ligou a moderacao de audio. O Microfone fica, focavel, com o motivo; o clique so avisa.
    await sala.disparar("moderationStatusChanged", { enabled: true, mediaType: "audio" });
    await expect(botaoMicrofone).toHaveAttribute("aria-disabled", "true");
    await expect(botaoMicrofone).not.toHaveAttribute("disabled", /.*/);
    await expect(botaoMicrofone).toHaveAccessibleDescription(aoVivo.microfoneLotado);
    await botaoMicrofone.focus();
    await expect(botaoMicrofone).toBeFocused();
    const antesDoLotado = (await sala.comandos()).length;
    await page.keyboard.press("Enter");
    await expect(dialogo.getByTestId("live-notice")).toHaveText(aoVivo.microfoneLotado);
    expect((await sala.comandos()).slice(antesDoLotado).some((item) => item.comando === "toggleAudio")).toBe(false);

    // A moderacao desligada de novo (a conta caiu abaixo do teto): o Microfone volta a abrir direto.
    await sala.disparar("moderationStatusChanged", { enabled: false, mediaType: "audio" });
    await expect(botaoMicrofone).not.toHaveAttribute("aria-disabled", "true");
  } finally {
    unwrap(await createLocalAdminClient().from("webinars").update({ room_settings: original }).eq("id", LIVE_AO_VIVO_DE_TESTE.id), "Voltando o room_settings da live de teste");
  }
});
