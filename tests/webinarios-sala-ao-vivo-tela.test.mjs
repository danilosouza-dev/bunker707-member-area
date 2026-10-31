import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A sala ao vivo desenhada (docs/30 §1.3, §1.4, §1.5, §1.7, §8.4, §8.5, §9, D2 e D18; docs/18 §2.2): os pedacos
// desenhados no Node, sem navegador, e a leitura das fontes. O palco monta o iframe pelo useJitsiMeet com o
// liveConfigOverwrite do papel e o nonce da pagina; nenhum texto da sala cita o motor de video; as frases sao todas de
// WEBINAR_COPY (ou das provisorias pedidas); o aviso de gravacao da camera vem antes do toggleVideo e o microfone so
// aparece depois do aviso e do Falar; a sala e um dialogo aria-modal com o chat em role=log e aria-live; os botoes
// da barra tem 44 px e o nome exato (Configurações no lugar do antigo Como usar, com o painel de som e aparelhos e os
// atalhos dentro); os sinais vao pelo sendBeacon no pagehide. Desenhada: Entrar na sala, Aguardando
// o apresentador (com a contagem), a sala trancada, em breve, encerrada (com Assistir o replay), removido e banido no
// lugar da sala, o silencio no lugar do campo, a equipe na Sessao de pratica, o "ver como", a aba Participantes, o
// selo Gravando, "Ao vivo · 00:42:10" e os dois avisos de gravacao.

const room = await import("../src/components/member/webinars/room/live-room.tsx");
const stageModule = await import("../src/components/member/webinars/room/live-stage.tsx");
const controls = await import("../src/components/member/webinars/room/live-controls.tsx");
const notices = await import("../src/components/member/webinars/room/live-notices.tsx");
const settingsPanel = await import("../src/components/member/webinars/room/live-settings.tsx");
const { deviceSettingsFor } = await import("../src/lib/jitsi-device-settings.ts");
const { LIVE_ROOM_COPY } = await import("../src/components/member/webinars/room/live-room-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\}/g, "");
const ROOM = "src/components/member/webinars/room";
const FONTES = {
  api: ler(`${ROOM}/room-api.ts`),
  controls: ler(`${ROOM}/live-controls.tsx`),
  devices: ler("src/components/webinars/use-jitsi-devices.ts"),
  hook: ler(`${ROOM}/use-live-room.ts`),
  model: ler(`${ROOM}/live-room-model.ts`),
  notices: ler(`${ROOM}/live-notices.tsx`),
  page: ler("src/app/webinarios/[slug]/sala/page.tsx"),
  queries: ler("src/server/webinars/student-queries.ts"),
  room: ler(`${ROOM}/live-room.tsx`),
  settings: ler(`${ROOM}/live-settings.tsx`),
  signal: ler("src/lib/lesson-media-signal.ts"),
  stage: ler(`${ROOM}/live-stage.tsx`)
};

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const noop = () => undefined;
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const at = (ms) => new Date(ms).toISOString();
const SEM_BAN = { banned: false, kicked: false, muted: false, mutedUntil: null };
/** O texto que o aluno le (sem as tags e sem os atributos). */
const textoDe = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function payload({ live = {}, me = {}, session = {}, webinar = {}, ...extra } = {}) {
  return {
    live: { locked: false, meetConfigured: true, recording: false, startedAt: at(T0 - (42 * 60 + 10) * 1000), status: "live", ...live },
    me: { ban: SEM_BAN, calendarUrl: null, consented: true, displayMode: "first_name_initial", displayName: "Ana S.", nickname: null, registered: false, registeredAt: null, ...me },
    pinned: null,
    polls: [],
    presentNow: 7,
    registeredCount: null,
    serverTime: at(T0),
    session: {
      anonymousQuestions: true,
      chatMode: "open",
      chatSlowModeSeconds: null,
      durationMs: 60 * MIN,
      endedAt: null,
      id: "cccccccc-0000-4000-8000-000000000002",
      join: { ok: true },
      kind: "live",
      lateJoinMinutes: null,
      offsetMs: (42 * 60 + 10) * 1000,
      phase: "live",
      roomPhase: null,
      scheduledAt: at(T0 - 45 * MIN),
      showLiveBadge: false,
      startedAt: at(T0 - (42 * 60 + 10) * 1000),
      status: "live",
      ...session
    },
    video: null,
    webinar: { durationMinutes: 60, id: "cccccccc-0000-4000-8000-000000000001", kind: "live", replaySessionId: null, slug: "aula-de-ia", title: "Aula de IA", ...webinar },
    ...extra
  };
}

const sala = (props = {}) =>
  render(room.LiveWebinarRoom, { coverUrl: null, nonce: "n0nce", payload: payload(), presenterName: "Danilo S.", readOnly: false, staff: false, webinarHref: "/webinarios/aula-de-ia", ...props });

/* ------------------------------------------------------------------------------------------------
 * As fontes
 * ---------------------------------------------------------------------------------------------- */

test("o palco monta o iframe pelo useJitsiMeet com o configOverwrite do papel, o interfaceConfigOverwrite e o nonce; nada de SDK nem de origem de terceiro", () => {
  const hook = semComentarios(FONTES.hook);
  assert.match(hook, /import \{ useJitsiMeet, type JitsiMeetApi, type JitsiStatus \} from "@\/components\/webinars\/use-jitsi-meet";/);
  // O papel vem do servidor (a resposta do join-token); o tema da sala (docs/31 V2-12) entra pelo look, so na montagem.
  assert.match(hook, /liveConfigOverwrite\(reply\.role, reply\.settings, look\) : (?:\{\})?\), \[reply, look\]\)/, "o papel vem do servidor (a resposta do join-token)");
  // A engrenagem do iframe so para quem apresenta: o papel entra no interfaceConfigOverwrite (e a memoria segue o papel).
  assert.match(hook, /const roomRole = reply\?\.role \?\? null;\s*const interfaceConfigOverwrite = useMemo\(\(\) => liveInterfaceConfigOverwrite\(roomRole, look\), \[roomRole, look\]\);/);
  assert.match(hook, /useJitsiMeet\(\{[\s\S]*?configOverwrite,[\s\S]*?container,[\s\S]*?domain: reply\?\.domain \?\? null,[\s\S]*?jwt: reply\?\.jwt \?\? null,[\s\S]*?nonce,[\s\S]*?onEvent,[\s\S]*?room: reply\?\.room \?\? null/);
  assert.match(hook, /toRoomEvent\(name, payload, \{ extra: consented \? \{ consented: true \} : undefined, nowIso: new Date\(\)\.toISOString\(\), ownId: ownIdRef\.current \}\)/);
  assert.match(hook, /tokenRefreshInMs\(reply, Date\.now\(\)\)/, "o token novo antes do exp");
  assert.match(hook, /reconnectStep\(attemptsRef\.current\)/, "as tentativas de voltar");
  assert.match(hook, /retryRef\.current\(\)/, "a sala remonta com o token mais novo");
  assert.doesNotMatch(hook, /meet\.jit\.si|8x8|lib-jitsi-meet/i);

  // O nonce sai da pagina (cabecalho x-nonce do src/proxy.ts) e chega ao palco.
  const page = semComentarios(FONTES.page);
  assert.match(page, /\(await headers\(\)\)\.get\("x-nonce"\)/);
  assert.match(page, /<LiveWebinarRoom[\s\S]*?nonce=\{nonce\}[\s\S]*?staff=\{data\.staff\}/);
  assert.match(page, /data\.payload\.session\.kind === "live" \?/, "a live usa a sala ao vivo; a gravada e o replay continuam na WebinarRoom");
  assert.match(semComentarios(FONTES.room), /useLiveRoom\(\{\s*allowed,\s*canSwitchDevice,\s*container: frameRef,\s*deviceNames: DEVICE_NAMES,\s*frameTitle: WEBINAR_COPY\.aoVivo\.palco,\s*lobby: live\.lobby === true,\s*look,\s*nonce,/);

  // O papel nunca vem do navegador: a pagina pergunta ao servidor pela regra unica (roomGrantFor).
  assert.match(semComentarios(FONTES.queries), /roomGrantFor\(db, \{ nowMs: now, userId, webinar: webinarFromRow\(row\) \}\)/);
});

test("nenhum texto da sala cita o motor de video (D2): nem nas frases, nem no titulo do iframe, nem no que a tela desenha", () => {
  for (const [nome, fonte] of Object.entries(FONTES)) {
    if (nome === "queries" || nome === "page") {
      continue;
    }
    const codigo = semComentarios(fonte).replace(/^import .*$/gm, "");
    const literais = codigo.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
    for (const literal of literais) {
      assert.ok(!/jitsi/i.test(literal), `${nome}: ${literal}`);
    }
  }
  for (const html of [sala(), sala({ payload: payload({ live: { status: "ended" }, session: { status: "ended" } }) }), sala({ payload: payload({ live: { meetConfigured: false } }) })]) {
    assert.doesNotMatch(html, /jitsi/i);
  }
});

test("as frases da sala ao vivo sao todas de WEBINAR_COPY (ou das provisorias de LIVE_ROOM_COPY): nenhum texto escrito direto no desenho", () => {
  for (const nome of ["room", "stage", "controls", "notices", "settings"]) {
    const codigo = semComentarios(FONTES[nome]);
    const textosNoJsx = codigo.match(/>[^<>{}\n]*[A-Za-zÀ-ú]{2,}[^<>{}\n]*</g) ?? [];
    assert.deepEqual(textosNoJsx, [], `${nome}: texto direto no JSX`);
    const atributos = codigo.match(/\b(aria-label|title|placeholder|alt)="[^"]+"/g) ?? [];
    assert.deepEqual(atributos, [], `${nome}: rotulo escrito direto`);
  }
  assert.match(FONTES.controls, /LIVE_ROOM_COPY\.configuracoes/);
  assert.doesNotMatch(FONTES.controls, /comoUsar|Keyboard/, "o Como usar virou o painel Configurações");
  assert.match(FONTES.model, /export const LIVE_ROOM_COPY = \{/);
});

test("o aviso de gravacao da camera vem antes do toggleVideo; o microfone so liga depois do aviso e do Falar", () => {
  const roomCode = semComentarios(FONTES.room);
  const onCamera = roomCode.slice(roomCode.indexOf("function onCamera()"), roomCode.indexOf("function confirmCamera()"));
  assert.match(onCamera, /action === "ask"[\s\S]*?setCameraAsk\(true\)/, "o primeiro ligar abre o aviso");
  assert.doesNotMatch(onCamera, /toggleCamera\(true\)/, "sem o aceite, nada de consented");
  const confirm = roomCode.slice(roomCode.indexOf("function confirmCamera()"), roomCode.indexOf("function toggleFullscreen()"));
  assert.match(confirm, /setCameraConsented\(true\);\s*room\.toggleCamera\(true\)/);
  assert.match(roomCode, /<LiveCameraDialog onCancel=\{\(\) => setCameraAsk\(false\)\} onConfirm=\{confirmCamera\} \/>/);

  const hook = semComentarios(FONTES.hook);
  assert.equal((hook.match(/"toggleVideo"/g) ?? []).length, 1, "um so lugar manda a camera");
  assert.match(hook, /const toggleCamera = useCallback\([\s\S]*?consentNextVideoRef\.current = true;[\s\S]*?sendCameraToggle\(\);/);
  assert.match(hook, /const sendCameraToggle = useCallback\(\(\) => \{[\s\S]*?commandRef\.current\("toggleVideo"\)/, "o toque (na hora, ou quando a troca de camera acaba) manda a camera");
  assert.equal((hook.match(/"toggleAudio"/g) ?? []).length, 2, "ligar (o Falar e o Microfone desligado, pelo turnMicOn) e desligar pelo Microfone");
  assert.match(hook, /const accept = useCallback\(\(\) => \{\s*setSignals\(acceptMic\);\s*turnMicOn\(\);/);
  assert.match(roomCode, /room\.signals\.micPrompt && !blocked \? <LiveMicDialog onCancel=\{room\.declineMic\} onConfirm=\{room\.acceptMic\} \/>/);
  assert.match(semComentarios(FONTES.controls), /props\.showMedia && props\.micAllowed \? <BarButton/);

  const camera = render(notices.LiveCameraDialog, { onCancel: noop, onConfirm: noop });
  assert.ok(camera.includes(WEBINAR_COPY.aoVivo.avisoCamera), "o texto de §8.5, palavra por palavra");
  assert.ok(camera.includes(WEBINAR_COPY.aoVivo.avisoCameraConsumo));
  assert.match(camera, /role="dialog"/);
  assert.match(camera, /aria-modal="true"/);
  assert.match(camera, />Ligar câmera</);
  assert.match(camera, />Agora não</);
  assert.equal(
    WEBINAR_COPY.aoVivo.avisoCamera,
    "Esta sessão está sendo gravada. Ao ligar a câmera, a sua imagem entra na gravação, que pode ser reexibida para outros alunos, e o consumo de dados aumenta. Você pode continuar só assistindo e participando pelo chat."
  );

  // O microfone abre sozinho (o apresentador liberou): o foco entra em Agora não, nunca em Falar (quem digitava no chat
  // nao liga o microfone com o Enter seguinte); a camera, que o proprio clique abriu, em Ligar câmera. O foco volta a
  // quem o tinha ao fechar.
  const noticesCode = semComentarios(ler("src/components/member/webinars/room/live-notices.tsx"));
  assert.match(noticesCode, /confirmLabel=\{copy\.falar\}\s*heading=\{copy\.microfoneLiberado\}\s*initialFocus="cancel"/);
  assert.match(noticesCode, /confirmLabel=\{copy\.ligarCamera\}\s*initialFocus="confirm"/);
  assert.match(noticesCode, /const previous = document\.activeElement;[\s\S]*?return \(\) => \{\s*focusBackTarget\(previous, document\)\?\.focus\(\);/);
  const campo = { disabled: false, focus() {} };
  const pagina = { body: {}, contains: (element) => element === campo };
  assert.equal(notices.focusBackTarget(campo, pagina), campo, "o campo do chat recebe o foco de volta");
  assert.equal(notices.focusBackTarget(pagina.body, pagina), null, "nunca o body");
  assert.equal(notices.focusBackTarget({ focus() {} }, pagina), null, "fora da pagina (desmontado)");
  assert.equal(notices.focusBackTarget({ disabled: true, focus() {} }, { body: {}, contains: () => true }), null, "desligado");
  assert.equal(notices.focusBackTarget(null, pagina), null);

  const mic = render(notices.LiveMicDialog, { onCancel: noop, onConfirm: noop });
  assert.ok(mic.includes(WEBINAR_COPY.aoVivo.avisoMicrofone));
  assert.match(mic, /O apresentador liberou o seu microfone\./);
  assert.match(mic, />Falar</);
  assert.match(mic, />Agora não</);
  assert.match(mic, /aria-modal="true"/);
});

test("a sala e um dialogo aria-modal com o foco preso e Esc com confirmacao; o chat em role=log com aria-live; os sinais vao pelo sendBeacon no pagehide", () => {
  const html = sala();
  // No desenho do servidor o React poe antes da raiz o preload das imagens (a marca no cabecalho); a raiz e o dialogo.
  assert.match(html.replace(/^(?:<link rel="preload" as="image"[^>]*\/>)+/, ""), /^<div aria-label="Aula de IA" aria-modal="true"[^>]*role="dialog"/);
  assert.doesNotMatch(html, /Minimizar|room-pill|data-room-minimized/, "sem Minimizar e sem pilula (docs/31 V2-2)");
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="polite"/);
  const roomCode = semComentarios(FONTES.room);
  assert.match(roomCode, /useRoomDialogLock\(rootRef, true\)/, "sem Minimizar (V2-2), a trava vale sempre");
  assert.match(roomCode, /trapRoomFocus\(event, rootRef\.current\)/);
  assert.match(roomCode, /if \(\(phase === "live" \|\| joined\) && !blocked\) \{\s*setConfirmLeave\(true\)/, "Esc e Sair pedem confirmacao com a live no ar");

  const hook = semComentarios(FONTES.hook);
  assert.match(hook, /window\.addEventListener\("pagehide", beacon\)/);
  assert.match(hook, /LIVE_ROOM_RULES\.eventFlushMs/, "um lote a cada 10 s");
  assert.match(semComentarios(FONTES.api), /navigator\.sendBeacon\(url, body\)/, "o mesmo corpo JSON do lote, como texto (Blob sai vazio no WebKit)");
  // Nenhum pop-up com a sala no ar: a mesma trava do player da aula, so acrescentada.
  assert.match(roomCode, /announceLiveRoomMedia\(\{ lessonId, on: true \}\);\s*return \(\) => announceLiveRoomMedia\(\{ lessonId, on: false \}\);/);
  assert.match(FONTES.signal, /export function announceLiveRoomMedia\(input: \{ lessonId: string; on: boolean \}\): void \{/);
  for (const existente of ["announceLessonMedia", "lessonMediaSnapshot", "resetLessonMedia", "readLessonMediaSignal", "watchLessonPlayerFocus", "waitLessonMediaStop", "waitLessonFullscreenEnd"]) {
    assert.match(FONTES.signal, new RegExp(`export function ${existente}\\(`), `${existente} continua la`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * A barra
 * ---------------------------------------------------------------------------------------------- */

const barra = (props = {}) =>
  render(controls.LiveControls, {
    allowStudentCamera: true,
    audioOn: false,
    cinemaMode: false,
    cinemaOn: false,
    fullscreenOn: false,
    handRaised: false,
    joined: true,
    micAllowed: false,
    notice: null,
    onCamera: noop,
    onFullscreen: noop,
    onHand: noop,
    onMic: noop,
    onReact: noop,
    onSound: noop,
    onToggleReactions: noop,
    onToggleSettings: noop,
    reactionsDisabled: false,
    reactionsOpen: false,
    settingsOpen: false,
    showMedia: true,
    soundOn: true,
    videoOn: false,
    ...props
  });
const nomes = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
/** O painel Configurações desenhado (o que a sala passa para a barra), com as secoes do momento. */
const painelConfig = (sections) =>
  createElement(settingsPanel.LiveSettings, {
    devices: {
      blur: false,
      current: { audioInput: null, audioOutput: null, videoInput: null },
      espelhar: noop,
      fundo: noop,
      lists: { audioInput: [], audioOutput: [], videoInput: [] },
      maisFundos: noop,
      mirror: true,
      noise: false,
      qualidade: noop,
      quality: "automatica",
      ruido: noop,
      volume: noop,
      volumePercent: 100
    },
    onChoose: noop,
    sections,
    showMedia: true
  });

test("a barra do aluno: Reagir, Levantar a mão, Câmera, Tela cheia, Som e Configurações com 44 px e o nome exato; o Microfone so depois de liberado", () => {
  const html = barra();
  assert.deepEqual(nomes(html), ["Reagir", "Levantar a mão", "Câmera", "Tela cheia", "Som", LIVE_ROOM_COPY.configuracoes]);
  assert.equal((html.match(/h-11 min-w-11/g) ?? []).length, 6, "44 px cada");
  assert.match(html, /aria-keyshortcuts="R"/);
  assert.match(html, /aria-keyshortcuts="M"/);
  assert.match(html, /aria-label="Câmera" aria-pressed="false"/);
  assert.match(html, /title="Ligar câmera"/);

  const cheia = barra({ handRaised: true, micAllowed: true, videoOn: true });
  assert.deepEqual(nomes(cheia), ["Reagir", "Abaixar a mão", "Câmera", "Microfone", "Tela cheia", "Som", LIVE_ROOM_COPY.configuracoes]);
  // 7 botoes de 44 px com 6 px entre eles e 8 px de cada lado cabem em 375 px: 7*44 + 6*6 + 16 = 360.
  assert.equal((cheia.match(/h-11 min-w-11/g) ?? []).length, 7);
  assert.ok(7 * 44 + 6 * 6 + 16 <= 375);
  assert.match(barra({ videoOn: true }), /title="Desligar câmera"/);
  assert.ok(!nomes(barra({ allowStudentCamera: false })).includes("Câmera"), "sem a camera dos alunos no webinario, sem o botao");
  assert.ok(!nomes(barra({ allowStudentCamera: null })).includes("Câmera"), "antes do token, sem o botao");
  // A frase da camera dos alunos desligada mora na secao Câmera do painel (antes, so no Como usar).
  const semCamera = deviceSettingsFor({ allowStudentCamera: false, cameraConsented: false, isIOS: false, isMobile: false, joined: true, micAllowed: false, outputChangeAvailable: false, outputs: [], role: "student", videoOn: false });
  assert.match(barra({ allowStudentCamera: false, settings: painelConfig(semCamera), settingsOpen: true }), /A câmera dos alunos está desligada nesta live\./);
  assert.ok(nomes(barra({ cinemaMode: true })).includes("Modo cinema"), "no iPhone, Modo cinema no lugar de Tela cheia");
  assert.ok(!nomes(barra({ cinemaMode: true })).includes("Tela cheia"));
  assert.match(barra({ joined: false }), /aria-label="Levantar a mão"[^>]*disabled=""/, "fora da sala, a mao espera");

  // Host e co-apresentador que entram por aqui usam a barra do iframe: sem mao, camera e microfone nossos.
  assert.deepEqual(nomes(barra({ micAllowed: true, showMedia: false })), ["Reagir", "Tela cheia", "Som", LIVE_ROOM_COPY.configuracoes]);

  const reagindo = barra({ reactionsOpen: true });
  assert.match(reagindo, /aria-expanded="true"/);
  for (const nome of Object.values(WEBINAR_COPY.sala.reacoes)) {
    assert.match(reagindo, new RegExp(`aria-label="${nome}"`), nome);
  }
  // Configurações: aria-expanded / aria-controls; aberto, o painel com os atalhos (o conteudo do antigo Como usar).
  assert.match(html, /<button aria-controls="live-room-settings" aria-expanded="false" aria-label="Configurações"/);
  assert.doesNotMatch(html, /id="live-room-settings"/, "fechado, sem o painel");
  const entrou = deviceSettingsFor({ allowStudentCamera: true, cameraConsented: false, isIOS: false, isMobile: false, joined: true, micAllowed: false, outputChangeAvailable: false, outputs: [], role: "student", videoOn: false });
  const aberto = barra({ settings: painelConfig(entrou), settingsOpen: true });
  assert.match(aberto, /<button aria-controls="live-room-settings" aria-expanded="true" aria-label="Configurações"/);
  assert.match(aberto, /id="live-room-settings"[\s\S]*data-testid="live-settings"/);
  for (const texto of [LIVE_ROOM_COPY.atalhoReagir, LIVE_ROOM_COPY.atalhoMao, LIVE_ROOM_COPY.atalhoEnquete]) {
    assert.ok(aberto.includes(texto), texto);
  }
  assert.doesNotMatch(aberto, /<select/, "antes do Falar e do aviso da camera, nenhuma escolha de aparelho");
  assert.ok(aberto.includes(WEBINAR_COPY.aoVivo.config.microfoneAguardando));
  assert.match(barra({ notice: WEBINAR_COPY.aoVivo.cameraFechadaPelaEquipe }), /aria-live="polite"[^>]*role="status">A equipe fechou a sua câmera\.</);
});

/* ------------------------------------------------------------------------------------------------
 * A sala inteira, nos estados
 * ---------------------------------------------------------------------------------------------- */

test("o painel Configurações no celular nao tira a barra da tela: depois da barra no teclado e acima dela na tela, encolhe e rola por dentro; aberto, toma o lugar da gaveta e o palco encolhe ate 96 px; Reagir e Configurações nunca juntos", () => {
  const entrou = deviceSettingsFor({ allowStudentCamera: true, cameraConsented: false, isIOS: false, isMobile: true, joined: true, micAllowed: false, outputChangeAvailable: true, outputs: [], role: "student", videoOn: false });
  const aberto = barra({ settings: painelConfig(entrou), settingsOpen: true });
  // A barra (role=group "Controles da sala") vem antes do painel no HTML: o Tab do botao Configurações entra no painel.
  assert.ok(aberto.indexOf('aria-label="Controles da sala"') < aberto.indexOf('id="live-room-settings"'), "o painel depois da barra no teclado");
  assert.match(aberto, /<div class="order-first flex min-h-0 flex-col[^"]*" id="live-room-settings">/, "acima da barra na tela e encolhivel");
  assert.match(aberto, /data-testid="live-controls"/);
  assert.match(aberto, /<div class="relative flex min-h-0 flex-col[^"]*" data-testid="live-controls">/, "a barra inteira encolhe so pelo painel");
  assert.match(aberto, /aria-label="Controles da sala" class="flex shrink-0 /, "os botoes nunca encolhem");
  assert.match(aberto, /class="max-h-\[min\(55dvh,30rem\)\] min-h-0 overflow-y-auto/, "o painel rola por dentro (dvh: a altura que sobra de verdade no celular)");

  const room = semComentarios(FONTES.room);
  assert.match(room, /const settingsTakeover = settingsShown && !desktop;\s*const drawerVisible = desktop \|\| \(drawerOpen && !settingsTakeover\);/, "no celular, o painel toma o lugar da gaveta (so com a barra na tela)");
  assert.match(room, /const stageGrows = blocked \|\| !drawerVisible \|\| cinemaOn;/);
  assert.match(room, /stageGrows \? cn\("flex-1", settingsTakeover \? "min-h-24" : "min-h-0"\) : "aspect-video"/, "o palco encolhe, com no minimo 96 px");
  assert.match(room, /!drawerVisible && !blocked && !settingsTakeover \? <LiveChatOverlay/, "sem o chat sobreposto no palco pequeno");
  assert.match(room, /function selectTab\(value: Tab\) \{\s*if \(settingsTakeover\) \{\s*closeSettings\(\);\s*setTab\(value\);\s*setDrawerOpen\(true\);/, "a aba de baixo fecha o painel e abre a gaveta");
  assert.match(room, /function toggleReactions\(\) \{\s*if \(!reactionsOpen && settingsOpen\) \{\s*closeSettings\(\);/, "Reagir fecha Configurações");
  assert.match(room, /function toggleSettings\(\) \{\s*if \(settingsOpen\) \{\s*closeSettings\(true\);\s*return;\s*\}\s*if \(reactionsOpen\) \{\s*returnFocusFrom\(LIVE_REACTIONS_ID\);\s*setReactionsOpen\(false\);/, "Configurações fecha Reagir");
  assert.match(room, /if \(shortcut === "react"\) \{\s*toggleReactions\(\);/, "o atalho R tambem");
});

test("o Esc com o foco dentro do painel devolve o foco ao botao da barra antes de fechar (senao o foco cai no body e a sala para de ouvir o teclado)", () => {
  const room = semComentarios(FONTES.room);
  assert.match(room, /function returnFocusFrom\(panelId: string\) \{\s*const panel = document\.getElementById\(panelId\);\s*if \(panel && panel\.contains\(document\.activeElement\)\) \{\s*panelButton\(panelId\)\?\.focus\(\);/);
  assert.match(room, /querySelector<HTMLButtonElement>\(`\[aria-controls="\$\{panelId\}"\]`\)/, "o botao que abre o painel (aria-controls)");
  assert.match(room, /\} else if \(reactionsShown \|\| settingsShown\) \{\s*returnFocusFrom\(LIVE_REACTIONS_ID\);\s*setReactionsOpen\(false\);\s*closeSettings\(\);\s*\} else \{\s*askToLeave\(\);/);
  assert.match(room, /function closeSettings\(focusButton = false\) \{[\s\S]*?returnFocusFrom\(LIVE_SETTINGS_ID\);[\s\S]*?setSettingsOpen\(false\);/);
});

test("no ar: 'Ao vivo · 00:42:10', {n} assistindo, Gravando, Entrar na sala no palco 16:9 com os atributos do sinal de midia, as quatro abas e o painel a direita", () => {
  const html = sala({ payload: payload({ live: { recording: true } }) });
  assert.match(html, /data-room-kind="live"/);
  assert.match(html, /data-room-phase="live"/);
  assert.match(html, /data-room-screen="open"/);
  assert.match(html, /Ao vivo · 00:42:10/);
  assert.match(html, /7 assistindo/);
  assert.match(html, />Gravando</);
  assert.match(html, />Entrar na sala</);
  assert.match(html, /aria-label="Vídeo da live"[^>]*data-lesson-id="webinar:cccccccc-0000-4000-8000-000000000002" data-lesson-player-kind="iframe" data-lesson-player-stage/);
  assert.match(html, /data-live-frame/, "o lugar do iframe");
  assert.match(html, /aspect-video/, "a 375 px o palco ocupa a largura em 16:9");
  assert.match(html, /role="tab"[^>]*>Chat</);
  assert.match(html, /role="tab"[^>]*>Perguntas</);
  assert.match(html, /role="tab"[^>]*>Participantes</);
  assert.doesNotMatch(html, />Enquetes</, "sem enquete aberta, sem a aba");
  assert.match(html, /lg:w-\[360px\]/);
  assert.match(html, /order-last[^"]*lg:order-first/, "no celular as abas ficam embaixo (a gaveta)");
  assert.match(html, /aria-label="Escreva uma mensagem"/);
  assert.doesNotMatch(sala(), />Gravando</, "sem gravador, sem o selo");

  // A 375 px o cabecalho cabe com a marca, o tempo e o Gravando: no celular, so o tempo (a frase inteira no title e
  // para o leitor de tela) e so o ponto vermelho (a palavra para o leitor de tela).
  assert.match(html, /title="Ao vivo · 00:42:10"/);
  assert.match(html, /<span aria-hidden="true" class="sm:hidden">00:42:10<\/span>/);
  assert.match(html, /<span class="sr-only sm:hidden">Ao vivo · 00:42:10<\/span>/);
  assert.match(html, /title="Gravando"/);
  assert.match(html, /<span class="max-sm:sr-only" data-testid="live-recording">Gravando<\/span>/);
  assert.match(html, /<img[^>]*class="[^"]*\blg:hidden\b[^"]*" data-room-brand="icon"/, "o Icone da escola abaixo de lg");
  assert.match(html, /class="hidden shrink-0 items-center gap-3 lg:flex" data-room-brand="logo"/, "a logo so a partir de lg (o ponto em que a sala vira computador)");

  const comEnquete = sala({ payload: payload({ polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }) });
  assert.match(comEnquete, /role="tab"[^>]*>Enquetes</);
  assert.match(comEnquete, /Gostou\?/);
});

test("antes de abrir: o aluno ve Aguardando o apresentador com a contagem (o chat diz que ainda nao abriu); a equipe ve Entrar na sala (Sessao de pratica)", () => {
  const agendada = payload({ live: { startedAt: null, status: "scheduled" }, session: { scheduledAt: at(T0 + 4 * MIN), startedAt: null, status: "scheduled" } });
  const aluno = sala({ payload: agendada });
  assert.match(aluno, /data-room-screen="waiting"/);
  assert.match(aluno, /Aguardando o apresentador/);
  assert.match(aluno, /Começa em 4 min/);
  assert.doesNotMatch(aluno, />Entrar na sala</);
  assert.match(aluno, /data-testid="room-chat-notice"[^>]*>Essa sessão ainda não abriu\. Volte na hora marcada\.</);
  assert.doesNotMatch(aluno, /aria-label="Escreva uma mensagem"/);

  const equipe = sala({ payload: agendada, staff: true });
  assert.match(equipe, /data-room-screen="open"/);
  assert.match(equipe, />Entrar na sala</);

  const espera = sala({ payload: payload({ live: { startedAt: null, status: "waiting" }, session: { startedAt: null, status: "waiting" } }) });
  assert.match(espera, />Entrar na sala</, "na espera o aluno ja recebe o token");
  assert.match(espera, /aria-label="Escreva uma mensagem"/, "e o chat aceita");
});

test("a sala trancada, em breve e o 'ver como': a frase no palco, o chat segue; no 'ver como' Entrar na sala fica desligado", () => {
  const trancada = sala({ payload: payload({ live: { locked: true } }) });
  assert.match(trancada, /data-room-screen="locked"/);
  assert.match(trancada, /A sala está cheia ou fechada\. Fique aqui: avisamos quando abrir\./);
  assert.doesNotMatch(trancada, />Entrar na sala</);
  assert.match(trancada, /aria-label="Escreva uma mensagem"/);
  assert.match(sala({ payload: payload({ live: { locked: true } }), staff: true }), />Entrar na sala</, "a equipe entra com a sala trancada");

  const emBreve = sala({ payload: payload({ live: { meetConfigured: false } }) });
  assert.match(emBreve, /data-room-screen="unconfigured"/);
  assert.match(emBreve, /A sala ao vivo ainda não está disponível\. Volte em breve\./);
  assert.match(emBreve, /aria-label="Escreva uma mensagem"/, "nada quebra: o chat continua");
  const semBloco = sala({ payload: { ...payload(), live: undefined } });
  assert.match(semBloco, /data-room-screen="unconfigured"/, "um servidor sem o bloco live: em breve");

  const previa = sala({ readOnly: true });
  assert.match(previa, /<button(?=[^>]*data-live-enter="true")(?=[^>]*disabled="")[^>]*>Entrar na sala</);
  assert.doesNotMatch(sala(), /<button(?=[^>]*data-live-enter="true")(?=[^>]*disabled="")[^>]*>/, "fora do 'ver como', ligado");
  assert.match(previa, /No modo de visualização, nada é gravado\./);
});

test("encerrada: o palco diz que acabou e, com o replay, Assistir o replay; a barra some e o chat fica so para ler", () => {
  const fim = payload({ live: { status: "ended" }, session: { status: "ended" } });
  const html = sala({ payload: fim });
  assert.match(html, /data-room-phase="ended"/);
  assert.match(html, /Essa live acabou\. O replay fica pronto em algumas horas\./);
  assert.doesNotMatch(html, /Assistir o replay/);
  assert.doesNotMatch(html, /data-testid="live-controls"/);
  assert.match(html, /Encerrada/);

  const comReplay = sala({ payload: { ...fim, webinar: { ...fim.webinar, replaySessionId: "dddddddd-0000-4000-8000-000000000009" } } });
  assert.match(comReplay, /href="\/webinarios\/aula-de-ia\/sala\?sessao=dddddddd-0000-4000-8000-000000000009"[^>]*>Assistir o replay</);
  assert.doesNotMatch(comReplay, /O replay fica pronto em algumas horas/);
});

test("removido e banido: a frase toma o lugar da sala (sem iframe montado, sem barra, sem chat); silenciado: o campo da lugar a hora de Sao Paulo", () => {
  const removido = sala({ payload: payload({ me: { ban: { ...SEM_BAN, kicked: true } } }) });
  assert.match(removido, /data-room-screen="kicked"/);
  assert.match(removido, /role="alert">Você foi removido desta live\.</);
  assert.doesNotMatch(removido, /data-testid="room-panel"/);
  assert.doesNotMatch(removido, /data-testid="live-controls"/);
  assert.doesNotMatch(removido, /role="log"/);
  assert.doesNotMatch(removido, />Entrar na sala</);

  const banido = sala({ payload: payload({ me: { ban: { ...SEM_BAN, banned: true, kicked: true } } }) });
  assert.match(banido, /Você não pode entrar nas lives desta área\. Fale com a equipe pelo suporte\./);
  assert.doesNotMatch(banido, /Você foi removido/);

  const silenciado = sala({ payload: payload({ me: { ban: { ...SEM_BAN, muted: true, mutedUntil: at(Date.parse("2026-11-05T23:15:00.000Z")) } } }) });
  assert.match(silenciado, /data-testid="room-chat-notice"[^>]*>Você está sem escrever no chat até 20:15\.</);
  assert.doesNotMatch(silenciado, /aria-label="Escreva uma mensagem"/, "o campo da lugar a frase");
  assert.match(silenciado, /data-testid="live-controls"/, "silenciado continua assistindo e reagindo");
  const ateOFim = sala({ payload: payload({ me: { ban: { ...SEM_BAN, muted: true, mutedUntil: null } } }) });
  assert.match(ateOFim, /Você está sem escrever no chat até o fim desta live\./);
});

test("a aba Participantes mostra quem esta no palco e o numero de alunos, nunca a lista de alunos; o chat por cima do palco mostra as ultimas", () => {
  const html = render(notices.LiveParticipantsTab, { stage: ["Danilo S.", "Carla P."], students: 12 });
  assert.match(html, />No palco</);
  assert.match(html, /Danilo S\./);
  assert.match(html, /Carla P\./);
  assert.match(html, /12 alunos na sala/);
  assert.equal((html.match(/<li/g) ?? []).length, 2, "so o palco vira lista");
  assert.match(render(notices.LiveParticipantsTab, { stage: [], students: 1 }), /1 aluno na sala/);

  const mensagens = ["a", "b", "c"].map((id) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 0, pending: false, pinned: false, replyToId: null, role: "student" }));
  const overlay = render(notices.LiveChatOverlay, { messages: mensagens });
  assert.match(overlay, /role="log"/);
  assert.match(overlay, /lg:hidden/, "so no celular");
  assert.equal((overlay.match(/<li/g) ?? []).length, 3);
  assert.equal(render(notices.LiveChatOverlay, { messages: [] }), "");
});

test("o palco em cada momento: Abrindo a sala…, Reconectando… por cima do iframe, Não conseguimos voltar e a abertura que falhou com Tentar de novo", () => {
  const ref = { current: null };
  const base = { countdownLabel: "", coverUrl: null, entry: "idle", frameRef: ref, onEnter: noop, onRetry: noop, readOnly: false, replayHref: null, screen: "open", sessionId: "s1", stageRef: ref, title: "Aula de IA" };
  const palco = (extra) => render(stageModule.LiveStage, { ...base, ...extra });
  assert.match(palco({ entry: "opening" }), /role="status">[\s\S]*Abrindo a sala…/);
  assert.match(palco({ entry: "joining" }), /Abrindo a sala…/);
  assert.doesNotMatch(palco({ entry: "joined" }), /Abrindo|Reconectando|Entrar na sala/, "dentro da sala, so o video");
  assert.match(palco({ entry: "joined" }), /data-room-stage="live"/);
  assert.match(palco({ entry: "reconnecting" }), /bg-black\/70[\s\S]*Reconectando…/, "o iframe fica por baixo");
  const perdida = palco({ entry: "lost" });
  assert.match(perdida, /role="alert">Não conseguimos voltar\.</);
  assert.match(perdida, />Tentar de novo</);
  const falhou = palco({ entry: "open_failed" });
  assert.match(falhou, /Não foi possível abrir a sala\. Tente de novo\./);
  assert.match(falhou, />Tentar de novo</);
  assert.equal(stageModule.liveStageState("open", "joined"), "live");
  assert.equal(stageModule.liveStageState("locked", "idle"), "locked");
});

test("fora do Quem pode no meio da live (D41): o palco da lugar a frase, sem capa, sem Entrar na sala e sem Tentar de novo; a sala desliga o iframe", () => {
  const ref = { current: null };
  const base = { countdownLabel: "", coverUrl: "https://cdn.example.com/capa.jpg", entry: "joined", frameRef: ref, onEnter: noop, onRetry: noop, readOnly: false, replayHref: null, sessionId: "s1", stageRef: ref, title: "Aula de IA" };
  const fora = render(stageModule.LiveStage, { ...base, screen: "unavailable" });
  assert.match(fora, /data-room-stage="unavailable"/);
  assert.match(fora, /role="alert">Esta live não está disponível para você\.</);
  assert.doesNotMatch(fora, /<img/);
  assert.doesNotMatch(textoDe(fora), /Entrar na sala|Tentar de novo|Não conseguimos voltar/);
  // A sala: o iframe so monta com a tela aberta (allowed), e o 404 da sessao, da presenca, do token ou dos sinais
  // vira `unavailable` (o mesmo `local` que nao se desfaz).
  const codigo = semComentarios(FONTES.room);
  assert.match(codigo, /unavailable: accessLost \|\| local\.unavailable/);
  assert.match(codigo, /onAccessLost: \(\) => setLocal/);
  assert.match(codigo, /const lostInside = screen === "unavailable" && entryInRoom\(room\.entry\)/, "dentro do iframe, a sala sai (hangUp) sem esperar o token");
  assert.match(codigo, /const allowed = !readOnly && liveRoomScreen\(\{ \.\.\.screenInput, inRoom: true \}\) === "open"/);
});
