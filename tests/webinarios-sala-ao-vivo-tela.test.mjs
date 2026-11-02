import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A sala ao vivo desenhada (docs/30 §1.3, §1.4, §1.5, §1.7, §8.4, §8.5, §9, D2 e D18; docs/18 §2.2): os pedacos
// desenhados no Node, sem navegador, e a leitura das fontes. O palco monta o iframe pelo useJitsiMeet com o
// liveConfigOverwrite do papel e o nonce da pagina; nenhum texto da sala cita o motor de video (que as frases sao
// todas de WEBINAR_COPY fica em tests/webinarios-sala-frases.guard.test.mjs); o aviso de gravacao da camera vem antes
// do toggleVideo e o microfone so aparece depois do aviso e do Falar; a sala e um dialogo aria-modal com o chat em
// role=log e aria-live; os botoes da barra tem 44 px e o nome exato (Configurações no lugar do antigo Como usar, com
// o painel de som e aparelhos e os atalhos dentro); os sinais vao pelo sendBeacon no pagehide. Desenhada: Entrar na
// sala, Aguardando o apresentador (com a contagem), a sala trancada, em breve, encerrada (com Assistir o replay),
// removido e banido no lugar da sala, o silencio no lugar do campo, a equipe na Sessao de pratica, o "ver como", a aba
// Participantes, o selo Gravando, "Ao vivo · 00:42:10" e os dois avisos de gravacao.

const room = await import("../src/components/member/webinars/room/live-room.tsx");
const stageModule = await import("../src/components/member/webinars/room/live-stage.tsx");
const controls = await import("../src/components/member/webinars/room/live-controls.tsx");
const notices = await import("../src/components/member/webinars/room/live-notices.tsx");
const settingsPanel = await import("../src/components/member/webinars/room/live-settings.tsx");
const panelModule = await import("../src/components/member/webinars/room/room-panel.tsx");
const railModule = await import("../src/components/member/webinars/room/room-rail.tsx");
const pillsModule = await import("../src/components/member/webinars/room/room-chat-pills.tsx");
const snackbarModule = await import("../src/components/member/webinars/room/room-snackbar.tsx");
const barModule = await import("../src/components/member/webinars/room/room-bar.tsx");
const viewMenuModule = await import("../src/components/member/webinars/room/room-view-menu.tsx");
const { deviceSettingsFor } = await import("../src/lib/jitsi-device-settings.ts");
const { LIVE_ROOM_COPY, liveBarItems, liveNoticeSnack, overlayMessages } = await import("../src/components/member/webinars/room/live-room-model.ts");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

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
  // A largura do iframe (a coluna de miniaturas, docs/31 V2-A5) vem da medida do palco: a ligacao fica no guard.

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

// As frases da sala (nenhum texto direto no JSX nem rotulo literal) ficam na guarda
// tests/webinarios-sala-frases.guard.test.mjs, com as pecas da sala V2 (docs/18 §2.7).

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
  // O Microfone so entra na barra depois de liberado (e do Falar): a regra pura da barra (liveBarItems).
  assert.ok(!liveBarItems({ allowStudentCamera: true, micAllowed: false, showMedia: true }).center.includes("mic"));
  assert.ok(liveBarItems({ allowStudentCamera: true, micAllowed: true, showMedia: true }).center.includes("mic"));

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
  assert.match(noticesCode, /confirmLabel=\{copy\.falar\}\s*heading=\{title \?\? copy\.microfoneLiberado\}\s*initialFocus="cancel"/);
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

  // O primeiro abrir do microfone sozinho (docs/31 caminho A): o mesmo aviso de gravacao, com o titulo da politica.
  const sozinho = render(notices.LiveMicDialog, { onCancel: noop, onConfirm: noop, title: WEBINAR_COPY.aoVivo.microfoneSozinhoTitulo });
  assert.ok(sozinho.includes(WEBINAR_COPY.aoVivo.avisoMicrofone), "o texto de gravacao e o mesmo");
  assert.ok(sozinho.includes(WEBINAR_COPY.aoVivo.microfoneSozinhoTitulo));
  assert.doesNotMatch(sozinho, /O apresentador liberou/);
  assert.match(sozinho, />Falar</);
});

test("microfone sozinho (docs/31 caminho A): o Microfone na barra sem o Liberar; lotado, desligado com motivo (aria-disabled, focavel, sem disabled) e o motivo no sr-only do aria-describedby", () => {
  const botao = (html) => html.match(/<button[^>]*data-room-bar-item="mic"[^>]*>/)?.[0] ?? "";
  const livre = barra({ selfUnmute: true });
  assert.ok(botao(livre), "o Microfone aparece sem micAllowed");
  assert.doesNotMatch(botao(livre), /aria-disabled="/);
  assert.doesNotMatch(botao(livre), /\sdisabled=""/);

  const lotado = barra({ micBlocked: true, selfUnmute: true });
  const tag = botao(lotado);
  assert.match(tag, /aria-disabled="true"/);
  assert.doesNotMatch(tag, /\sdisabled=""/, "focavel: o Tab chega nele");
  const descrito = tag.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(descrito, "o botao aponta para o motivo");
  const motivo = lotado.match(new RegExp(`<span[^>]*id="${descrito.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)</span>`));
  assert.ok(motivo, "o sr-only existe");
  assert.match(motivo[0], /class="sr-only"/);
  assert.equal(motivo[1], WEBINAR_COPY.aoVivo.microfoneLotado);
  assert.equal(WEBINAR_COPY.aoVivo.microfoneLotado, "Muitos alunos com o microfone aberto agora. Tente daqui a pouco.");
  assert.ok(!barra({ selfUnmute: false }).includes('data-room-bar-item="mic"'), "sem a politica, so depois do Liberar");
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
  assert.match(roomCode, /if \(\(phase === "live" \|\| joined\) && !blocked\) \{\s*rememberLeaveOpener\(\);\s*setConfirmLeave\(true\)/, "Esc e Sair pedem confirmacao com a live no ar (e guardam quem a abriu, para o foco voltar la)");

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
    onCamera: noop,
    onFullscreen: noop,
    onHand: noop,
    onLeave: noop,
    onMic: noop,
    onReact: noop,
    onSound: noop,
    onTogglePanel: noop,
    onToggleReactions: noop,
    onToggleSettings: noop,
    onView: noop,
    onViewMenu: noop,
    panelOpen: true,
    reactionsDisabled: false,
    reactionsOpen: false,
    settingsOpen: false,
    showMedia: true,
    soundOn: true,
    videoOn: false,
    viewMenuOpen: false,
    viewShown: "stage",
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

/** Os circulos da barra (data-room-bar-item), na ordem do HTML, e o HTML de cada um. */
const circulos = (html) => [...html.matchAll(/<button[^>]*data-room-bar-item="([a-z]+)"[^>]*>/g)].map(([tag, item]) => ({ item, tag }));
/** O que fica na tela abaixo de lg: sem o `hidden` que so o lg tira (o Sair e a Tela cheia saem da barra no celular). */
const noCelular = (html) => circulos(html).filter(({ tag }) => !/class="(?:[^"]* )?hidden[ "]/.test(tag));

test("a barra do aluno (V2-6): o Sair a esquerda, Reagir, Levantar a mão, Câmera, Som e Tela cheia no centro, a Visão do vídeo, Configurações e o balao a direita; circulos de 44 px (48 a partir de lg) com o nome exato; o Microfone so depois de liberado", () => {
  const html = barra();
  assert.deepEqual(nomes(html), ["Reagir", "Levantar a mão", "Câmera", "Som", "Tela cheia", "Visão do vídeo: Palco", LIVE_ROOM_COPY.configuracoes, "Esconder o chat"], "a ordem nova: o Som antes da Tela cheia");
  // As tres zonas, na ordem da tela (o grupo "Controles da sala"); cada zona vai ate a seguinte (a da direita, ate o fim).
  // As dos lados nunca menores que o conteudo (max-content): a 1024 px com o painel aberto, a camera e o microfone, o
  // centro sai do meio em vez de a Visão do vídeo cobrir a Tela cheia (a medida da largura so o e2e confere).
  assert.match(html, /aria-label="Controles da sala" class="[^"]*lg:grid-cols-\[minmax\(max-content,1fr\)_auto_minmax\(max-content,1fr\)\][^"]*" data-room-bar="" role="group">/);
  assert.doesNotMatch(html, /lg:grid-cols-\[1fr_auto_1fr\]/);
  const zona = (nome) => {
    const inicio = html.indexOf(`data-room-bar-zone="${nome}"`);
    const proxima = html.indexOf("data-room-bar-zone=", inicio + 1);
    return html.slice(inicio, proxima > 0 ? proxima : undefined);
  };
  assert.deepEqual(circulos(zona("left")).map(({ item }) => item), ["leave"]);
  assert.deepEqual(circulos(zona("center")).map(({ item }) => item), ["react", "hand", "camera", "sound", "fullscreen"]);
  assert.deepEqual(circulos(zona("right")).map(({ item }) => item), ["view", "settings", "panel"], "a Visão do vídeo antes de Configurações");
  // Os circulos: 44 px no celular, 48 px a partir de lg, sem rotulo visivel (o nome no aria-label e no title). A Visão
  // do vídeo e o Sair tem o desenho deles (a pilula a partir de xl).
  const redondos = circulos(html).filter(({ item }) => item !== "leave" && item !== "view");
  assert.equal(redondos.length, 7);
  for (const { item, tag } of redondos) {
    const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
    assert.ok(["size-11", "lg:size-12", "rounded-full"].every((classe) => classes.includes(classe)), `${item}: um circulo de 44 px e 48 px`);
    assert.match(tag, /title="[^"]+"/, `${item}: o nome no title`);
  }
  assert.doesNotMatch(html, /<span aria-hidden="true" class="hidden xl:inline">/, "sem o rotulo visivel de antes");
  // O Sair na barra so a partir de lg, no acento, com o nome visivel em toda largura (a pilula cabe a 1024 px).
  const sair = html.match(/<button[^>]*data-room-bar-item="leave"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(sair, /class="[^"]*\bhidden\b[^"]*\blg:inline-flex\b/, "o Sair da barra so a partir de lg (abaixo, no cabecalho)");
  assert.match(sair, /bg-room-accent/, "no acento");
  assert.match(sair, /<\/svg>Sair<\/button>$/, "o nome Sair visivel ao lado do icone, sem o sr-only de antes");
  assert.doesNotMatch(sair, /sr-only|size-11/, "nunca so o icone entre lg e xl");
  // A Tela cheia sai da barra abaixo de lg (vai para o canto do palco).
  assert.match(circulos(html).find(({ item }) => item === "fullscreen")?.tag ?? "", /class="[^"]*\bhidden lg:grid\b/);
  assert.match(html, /aria-keyshortcuts="R"/);
  assert.match(html, /aria-keyshortcuts="M"/);
  assert.match(html, /aria-label="Câmera" aria-pressed="false"/);
  assert.match(html, /title="Ligar câmera"/);
  // O balao: aria-expanded e aria-controls do painel; o nome diz o que ele faz (nunca aria-pressed com um nome que muda:
  // "Esconder o chat, pressionado" se leria como o contrario).
  assert.match(html, /<button aria-controls="room-panel" aria-expanded="true" aria-label="Esconder o chat"/);
  assert.match(barra({ panelOpen: false }), /<button aria-controls="room-panel" aria-expanded="false" aria-label="Mostrar o chat"/);
  for (const aberto of [true, false]) {
    const balao = barra({ panelOpen: aberto }).match(/<button aria-controls="room-panel"[^>]*>/)?.[0] ?? "";
    assert.doesNotMatch(balao, /aria-pressed/, `o balao sem aria-pressed (painel ${aberto ? "aberto" : "fechado"})`);
    assert.ok(balao.split(" ").includes(aberto ? "bg-room-active-bg" : "bg-room-control"), "aberto, o circulo ligado continua na tela");
  }

  const cheia = barra({ handRaised: true, micAllowed: true, videoOn: true });
  assert.deepEqual(nomes(cheia), ["Reagir", "Abaixar a mão", "Câmera", "Microfone", "Som", "Tela cheia", "Visão do vídeo: Palco", LIVE_ROOM_COPY.configuracoes, "Esconder o chat"]);
  // No celular (V2-18), com o Microfone liberado, ficam 7 circulos de 44 px: Reagir, a mao, Câmera, Microfone, Som,
  // Configurações e o balao (a Visão do vídeo so a partir de lg, como o Sair e a Tela cheia). A conta usa a margem, a borda, o recuo e o vao da barra desenhada (abaixo de lg): os 7
  // cabem em 360 px e em 375 px sem rolar a barra por dentro (a rolagem dela fica escondida e cortaria o balao).
  assert.deepEqual(noCelular(cheia).map(({ item }) => item), ["react", "hand", "camera", "mic", "sound", "settings", "panel"]);
  const classesDaBarra = (cheia.match(/aria-label="Controles da sala" class="([^"]*)"/)?.[1] ?? "").split(" ");
  assert.ok(["mx-2", "my-2", "h-16", "border"].every((classe) => classesDaBarra.includes(classe)), "64 px no celular, com a margem de 8 px e a borda de 1 px");
  /** O valor em px da classe de espaco do Tailwind abaixo de lg (gap-0.5 = 2 px; px-1.5 = 6 px; mx-2 = 8 px). */
  const espaco = (prefixo) => {
    const classe = classesDaBarra.find((nome) => nome.startsWith(`${prefixo}-`));
    assert.ok(classe, `a barra tem ${prefixo}`);
    return Number(classe.slice(prefixo.length + 1)) * 4;
  };
  const larguraDaBarra = (circulosNaTela) => circulosNaTela * 44 + (circulosNaTela - 1) * espaco("gap") + 2 * espaco("px") + 2 * 1 + 2 * espaco("mx");
  for (const tela of [360, 375]) {
    assert.ok(larguraDaBarra(noCelular(cheia).length) <= tela, `os 7 circulos cabem em ${tela} px: ${larguraDaBarra(noCelular(cheia).length)}`);
  }
  assert.match(barra({ videoOn: true }), /title="Desligar câmera"/);
  assert.ok(!nomes(barra({ allowStudentCamera: false })).includes("Câmera"), "sem a camera dos alunos no webinario, sem o botao");
  assert.ok(!nomes(barra({ allowStudentCamera: null })).includes("Câmera"), "antes do token, sem o botao");
  // A frase da camera dos alunos desligada mora na secao Câmera do painel (antes, so no Como usar).
  const semCamera = deviceSettingsFor({ allowStudentCamera: false, cameraConsented: false, isIOS: false, isMobile: false, joined: true, micAllowed: false, outputChangeAvailable: false, outputs: [], role: "student", videoOn: false });
  assert.match(barra({ allowStudentCamera: false, settings: painelConfig(semCamera), settingsOpen: true }), /A câmera dos alunos está desligada nesta live\./);
  assert.ok(nomes(barra({ cinemaMode: true })).includes("Modo cinema"), "no iPhone, Modo cinema no lugar de Tela cheia");
  assert.ok(!nomes(barra({ cinemaMode: true })).includes("Tela cheia"));
  assert.match(barra({ joined: false }), /aria-label="Levantar a mão"[^>]*disabled=""/, "fora da sala, a mao espera");
  // A equipe recolheu o microfone sem o mudo (docs/31 V2-A16): com o som no ar o Microfone fica na barra, ligado, para o
  // aluno se calar; desligado, ele sai. Quem apresenta (sem a nossa barra de midia) nunca tem o nosso Microfone.
  const recolhidoNoAr = barra({ audioOn: true, micAllowed: false, showMedia: true });
  assert.ok(nomes(recolhidoNoAr).includes("Microfone"), "o som no ar: o Microfone na barra");
  assert.match(recolhidoNoAr, /<button aria-label="Microfone" aria-pressed="true"[^>]*data-room-bar-item="mic"/, "ligado");
  assert.ok(noCelular(recolhidoNoAr).some(({ item }) => item === "mic"), "tambem no celular");
  assert.ok(!nomes(barra({ audioOn: false, micAllowed: false, showMedia: true })).includes("Microfone"), "desligado, o Microfone sai");
  assert.ok(!nomes(barra({ audioOn: true, micAllowed: false, showMedia: false })).includes("Microfone"), "quem apresenta usa a barra do iframe");

  // No celular a Tela cheia (ou o Modo cinema) fica no canto do palco: um circulo de 32 px sobre o video, so abaixo de lg.
  const canto = (props) => render(controls.LiveStageFullscreen, { cinemaMode: false, cinemaOn: false, fullscreenOn: false, onFullscreen: noop, ...props });
  assert.match(canto(), /^<button aria-label="Tela cheia" aria-pressed="false" class="[^"]*\bsize-8\b[^"]*bg-black\/60 text-white[^"]*absolute bottom-2 right-2 z-30 lg:hidden"/);
  assert.match(canto({ cinemaMode: true, cinemaOn: true }), /^<button aria-label="Modo cinema" aria-pressed="true"/);
  // Deitado abaixo de lg o Modo cinema sai do canto (docs/31 V2-A27): a sala em linha ja da ao palco o que sobra ao lado
  // do chat, e o cinema nao mudaria nada na tela (a 844 x 390 as caixas sao as mesmas com e sem ele). A Tela cheia fica.
  const classesDoCanto = (html) => (html.match(/^<button [^>]*class="([^"]*)"/)?.[1] ?? "").split(" ");
  for (const cinemaOn of [false, true]) {
    const classes = classesDoCanto(canto({ cinemaMode: true, cinemaOn }));
    assert.ok(classes.includes("max-lg:landscape:hidden") && classes.includes("lg:hidden"), `o Modo cinema so em pe abaixo de lg: ${classes.join(" ")}`);
  }
  assert.ok(!classesDoCanto(canto()).includes("max-lg:landscape:hidden"), "a Tela cheia deitada fica no canto");

  // Host e co-apresentador que entram por aqui usam a barra do iframe: sem mao, camera e microfone nossos, e sem a
  // Visão do vídeo (o seguir a visao levaria a escolha de quem apresenta a todos).
  assert.deepEqual(nomes(barra({ micAllowed: true, showMedia: false })), ["Reagir", "Som", "Tela cheia", LIVE_ROOM_COPY.configuracoes, "Esconder o chat"]);
  assert.ok(!nomes(barra({ onView: undefined })).some((nome) => nome.startsWith(WEBINAR_COPY.salaV2.visao.rotulo)), "sem o comando da visao, sem o botao");

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
  // Os avisos passageiros sairam da barra: nenhuma linha de aviso embaixo dela (o aviso da sala fica no palco).
  assert.doesNotMatch(html, /data-testid="live-notice"|role="status"/, "a barra sem a linha de aviso");
  assert.doesNotMatch(aberto, /data-testid="live-notice"/);
});

test("o aviso da sala (RoomSnackbarHost): a regiao polida no palco a partir de lg; com o microfone sem som, a frase no live-notice e Configurações como botao; sem aviso, a regiao vazia", () => {
  const avisoDe = (snack) => {
    const value = {
      api: { clear: noop, composer: noop, show: noop },
      composerPx: 0,
      listInsetPx: 0,
      onBox: noop,
      onPauseChange: noop,
      snack,
      stageOffsetPx: 0
    };
    return renderToStaticMarkup(createElement(snackbarModule.RoomSnackbarProvider, { value }, createElement(snackbarModule.RoomSnackbarHost, { panelShown: false })));
  };
  const semSom = avisoDe(liveNoticeSnack("mic_no_signal"));
  // A regiao viva, polida e atomica; o lugar de antes da hidratacao (preso ao pe da tela) muda no navegador.
  assert.match(semSom, /^<div class="pointer-events-none [^"]*" data-room-snackbar-host=""><div aria-atomic="true" aria-live="polite" class="\[&amp;&gt;\*\]:pointer-events-auto" data-room-snackbar="screen" role="status">/);
  assert.match(semSom, /data-testid="live-notice">Não está chegando som do seu microfone\.<\/p>/);
  assert.match(semSom, /<button[^>]*>Configurações<\/button>/, "a acao com o nome exato, como botao");
  // Os avisos da barra de antes, sem acao.
  const fechada = avisoDe(liveNoticeSnack("camera_closed"));
  assert.match(fechada, /data-testid="live-notice">A equipe fechou a sua câmera\.<\/p><\/div><\/div><\/div>$/);
  assert.doesNotMatch(fechada, /<button/);
  assert.equal(liveNoticeSnack("mic_released"), null, "o microfone liberado e o dialogo Falar / Agora não, nunca aviso");
  assert.equal(liveNoticeSnack(null), null);
  // Sem aviso, a regiao continua montada e vazia (o leitor de tela ouve o que chega).
  assert.match(avisoDe(null), /role="status"><\/div><\/div>$/);
  // Fora do provider (o console, a gaveta do vertical), nada.
  assert.equal(render(snackbarModule.RoomSnackbarHost, { panelShown: false }), "");
});

test("a Visão do vídeo (V2-16): 'Visão do vídeo: Palco' desligada antes de entrar, so a partir de lg, com o menu de duas opcoes (Palco e Grade) e sem a palavra proibida", () => {
  const visao = WEBINAR_COPY.salaV2.visao;
  const menu = (props) => render(viewMenuModule.RoomViewMenu, { disabled: false, onChoose: noop, onOpenChange: noop, open: false, shown: "stage", ...props });

  // Antes de entrar na sala (sem iframe): o botao diz o Palco, fica desligado e o menu fechado.
  const antes = menu({ disabled: true });
  const botao = antes.match(/<button [^>]*data-room-bar-item="view"[^>]*>/)?.[0] ?? "";
  assert.match(botao, /aria-controls="room-view-menu" aria-expanded="false" aria-haspopup="menu" aria-label="Visão do vídeo: Palco"/);
  assert.match(botao, /disabled=""/, "fora da sala, nada a mudar");
  assert.match(botao, /title="Visão do vídeo: Palco"/, "a dica do mouse entre lg e xl, quando so o icone aparece");
  const classes = (botao.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
  for (const classe of ["hidden", "lg:inline-flex", "size-11", "lg:size-12", "rounded-full", "xl:h-11", "xl:w-auto", "xl:rounded-[var(--member-button-radius)]", "border-room-border-strong"]) {
    assert.ok(classes.includes(classe), `${classe}: so a partir de lg, um circulo de 48 px como os outros da barra, que vira a pilula de 44 px a partir de xl`);
  }
  assert.match(antes, /<span class="hidden xl:inline">Palco<\/span>/, "o nome visivel so na pilula");

  // O menu "Visão do vídeo": fechado (hidden), com as duas opcoes; a marcada e a que o video mostra.
  assert.match(antes, /<div aria-label="Visão do vídeo" class="[^"]*\bz-40\b[^"]*" hidden="" id="room-view-menu" role="menu">/, "por cima da enquete do palco (z-30)");
  const opcoes = (html) => [...html.matchAll(/<button aria-checked="(true|false)"[^>]*data-room-view="([a-z]+)"[^>]*role="menuitemradio"[^>]*>[\s\S]*?<span class="flex-1">([^<]+)<\/span>/g)].map(([, marcada, view, nome]) => ({ marcada: marcada === "true", nome, view }));
  assert.deepEqual(opcoes(antes), [
    { marcada: true, nome: visao.palco, view: "stage" },
    { marcada: false, nome: visao.grade, view: "grid" }
  ]);

  // Aberto pela sala: o menu na tela e o botao com aria-expanded; desligado (a reconexao), o menu some mesmo aberto.
  const aberto = menu({ open: true });
  assert.match(aberto, /aria-expanded="true" aria-haspopup="menu" aria-label="Visão do vídeo: Palco"/);
  assert.match(aberto, /<div aria-label="Visão do vídeo" class="[^"]*" id="room-view-menu" role="menu">/, "sem o hidden");
  const desligado = menu({ disabled: true, open: true });
  assert.match(desligado, /aria-expanded="false"/);
  assert.match(desligado, /hidden="" id="room-view-menu" role="menu"/, "desligado, o menu nunca aparece");
  // Na barra, quem abre e a sala (viewMenuOpen); sem o onViewMenu, a barra fica sem o botao (o menu nunca abriria).
  assert.match(barra({ joined: true, viewMenuOpen: true }), /<div aria-label="Visão do vídeo" class="[^"]*" id="room-view-menu" role="menu">/);
  assert.match(barra({ joined: true }), /hidden="" id="room-view-menu" role="menu"/);
  assert.doesNotMatch(barra({ onViewMenu: undefined }), /data-room-bar-item="view"/);

  // A Grade na tela (o motor avisou): o botao e a opcao marcada dizem a Grade.
  const grade = menu({ shown: "grid" });
  assert.match(grade, /aria-label="Visão do vídeo: Grade"/);
  assert.doesNotMatch(grade, /data-room-bar-item="view"[^>]*disabled=""/, "dentro da sala, ligada");
  assert.deepEqual(opcoes(grade).map(({ marcada, view }) => [view, marcada]), [["stage", false], ["grid", true]]);

  // Nenhuma palavra proibida no que o aluno le ou ouve (o nome acessivel, o title e o texto).
  for (const html of [antes, grade]) {
    const ouvido = [textoDe(html), ...[...html.matchAll(/(?:aria-label|title)="([^"]+)"/g)].map(([, valor]) => valor)].join(" ").toLowerCase();
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!ouvido.includes(palavra), palavra);
    }
  }

  // Na sala antes de entrar: o botao na barra do aluno, antes de Configurações, desligado.
  const naSala = sala();
  assert.match(naSala, /<button aria-controls="room-view-menu" aria-expanded="false" aria-haspopup="menu" aria-label="Visão do vídeo: Palco"[^>]*disabled=""/);
  assert.ok(naSala.indexOf('data-room-bar-item="view"') < naSala.indexOf('aria-label="Configurações"'), "antes de Configurações");
});

/* ------------------------------------------------------------------------------------------------
 * A sala inteira, nos estados
 * ---------------------------------------------------------------------------------------------- */

test("o painel Configurações no celular nao tira a barra da tela: depois da barra no teclado e acima dela na tela, encolhe e rola por dentro; aberto, toma o lugar da gaveta e o palco encolhe ate 96 px; Reagir e Configurações nunca juntos", () => {
  const entrou = deviceSettingsFor({ allowStudentCamera: true, cameraConsented: false, isIOS: false, isMobile: true, joined: true, micAllowed: false, outputChangeAvailable: true, outputs: [], role: "student", videoOn: false });
  const aberto = barra({ settings: painelConfig(entrou), settingsOpen: true });
  // A barra (role=group "Controles da sala") vem antes do painel no HTML: o Tab do botao Configurações entra no painel.
  assert.ok(aberto.indexOf('aria-label="Controles da sala"') < aberto.indexOf('id="live-room-settings"'), "o painel depois da barra no teclado");
  assert.match(aberto, /<div class="order-first [^"]*flex min-h-0 flex-col[^"]*" id="live-room-settings">/, "acima da barra na tela e encolhivel");
  // A partir de lg o painel abre por cima do palco, alinhado a direita da barra, sem empurrar o video (V2-6).
  assert.match(aberto, /<div class="[^"]*lg:absolute lg:bottom-full lg:right-0 lg:z-40[^"]*" id="live-room-settings">/);
  assert.match(aberto, /data-testid="live-controls"/);
  assert.match(aberto, /<div class="relative flex min-h-0 flex-col[^"]*" data-testid="live-controls">/, "a barra inteira encolhe so pelo painel");
  assert.match(aberto, /aria-label="Controles da sala" class="mx-2 my-2 flex h-16 shrink-0 /, "os botoes nunca encolhem");
  assert.match(aberto, /class="max-h-\[min\(55dvh,30rem\)\] min-h-0 overflow-y-auto/, "o painel rola por dentro (dvh: a altura que sobra de verdade no celular)");
  // Reagir: por cima do palco no meio da barra a partir de lg; no fluxo acima dela no celular.
  const reagir = (barra({ reactionsOpen: true }).match(/<div class="([^"]*)" id="live-room-reactions">/)?.[1] ?? "").split(" ");
  assert.ok(["mx-2", "mt-2", "lg:absolute", "lg:bottom-full", "lg:left-1/2", "lg:-translate-x-1/2"].every((classe) => reagir.includes(classe)), reagir.join(" "));
  // A partir de lg o painel tem 380 px por cima do palco: o conteudo numa coluna so (sem cortar os nomes dos aparelhos).
  const grade = aberto.match(/<div class="(grid [^"]*)">/)?.[1].split(" ") ?? [];
  assert.ok(grade.includes("sm:grid-cols-2") && grade.includes("lg:grid-cols-1"), grade.join(" "));
  // O painel do chat no celular com Configurações aberto, o palco que guarda 96 px e o balao que fecha Configurações e
  // mostra o chat: as regras puras (roomPanelShown, liveSkeletonState e panelToggleStep, webinarios-sala-v2-modelo); a
  // sala ligada a elas, em webinarios-sala-v2.guard.
  assert.equal(layout.roomPanelShown({ barShown: true, panelOpen: true, settingsTakeover: true }), false, "no celular, o painel Configurações toma o lugar do chat");
  assert.equal(layout.liveSkeletonState({ blocked: false, cinema: false, panelShown: false, settingsTakeover: true }).stageMin, true, "o palco encolhe, com no minimo 96 px");
  assert.deepEqual(layout.panelToggleStep({ panelShown: false, settingsTakeover: true }), { closeSettings: true, panelOpen: true }, "o balao fecha Configurações e mostra o chat");
  // Reagir, Configurações e o menu da Visão do vídeo nunca abertos juntos: a ligacao fica em
  // tests/webinarios-sala-v2.guard.test.mjs; o e2e da visao abre um com o outro aberto.
});

test("o Esc com o foco dentro do painel devolve o foco ao botao da barra antes de fechar (senao o foco cai no body e a sala para de ouvir o teclado)", () => {
  const room = semComentarios(FONTES.room);
  assert.match(room, /function returnFocusFrom\(panelId: string\) \{\s*const panel = document\.getElementById\(panelId\);\s*if \(panel && panel\.contains\(document\.activeElement\)\) \{\s*panelButton\(panelId\)\?\.focus\(\);/);
  assert.match(room, /querySelector<HTMLButtonElement>\(`\[aria-controls="\$\{panelId\}"\]`\)/, "o botao que abre o painel (aria-controls)");
  // O Esc da sala pela regra pura (roomEscapeStep, tests/webinarios-sala-v2-modelo.test.mjs; a ligacao no guard).
  assert.match(room, /function closeSettings\(focusButton = false\) \{[\s\S]*?returnFocusFrom\(LIVE_SETTINGS_ID\);[\s\S]*?setSettingsOpen\(false\);/);
});

test("no ar: o palco 16:9 com 'Ao vivo · 00:42:10', Gravando e quem apresenta (V2-4); o cabecalho com a linha que comeca por {n} assistindo agora (V2-3); Entrar na sala, as quatro abas e o painel a direita", () => {
  const html = sala({ payload: payload({ live: { recording: true } }) });
  assert.match(html, /data-room-kind="live"/);
  assert.match(html, /data-room-phase="live"/);
  assert.match(html, /data-room-screen="open"/);
  assert.match(html, />Entrar na sala</);
  assert.match(html, /aria-label="Vídeo da live"[^>]*data-lesson-id="webinar:cccccccc-0000-4000-8000-000000000002" data-lesson-player-kind="iframe" data-lesson-player-stage/);
  assert.match(html, /data-live-frame/, "o lugar do iframe");
  assert.match(html, /aspect-video/, "a 375 px o palco ocupa a largura em 16:9");
  assert.match(html, /role="tab"[^>]*>Chat</);
  assert.match(html, /role="tab"[^>]*>Perguntas</);
  assert.match(html, /role="tab"[^>]*>Participantes</);
  assert.doesNotMatch(html, />Enquetes</, "sem enquete aberta, sem a aba");
  // O painel no estilo do YouTube: a partir de lg o cartao com a largura da grade do YouTube e o trilho a direita, irmao
  // dele e depois dele no DOM; abaixo de lg, as abas em pilula no topo do painel (sem a aba de baixo que abria a gaveta).
  const aside = html.match(/<aside aria-labelledby="room-panel-title" class="([^"]*)" data-testid="room-panel" id="room-panel">/)?.[1].split(" ") ?? [];
  assert.ok(aside.includes("lg:w-[clamp(320px,27.5vw,514px)]") && !aside.includes("lg:w-80"), aside.join(" "));
  const painel = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  // Abaixo de lg as abas leem antes da aba escolhida, no topo do painel (a linha some a partir de lg).
  assert.ok(painel.indexOf('role="tablist"') < painel.indexOf('role="tabpanel"'), "as abas antes da aba escolhida, no topo do painel");
  const trilho = html.slice(html.indexOf("</aside>"), html.indexOf("</nav>", html.indexOf("</aside>")));
  assert.match(trilho, /^<\/aside><nav aria-label="Painel da sala" class="[^"]*">/, "o trilho logo depois do painel");
  // O primeiro foco da sala: o Chat do trilho (a partir de lg) e, abaixo de lg, a aba Chat com o painel na tela
  // (firstFocusTarget); a sala foca o primeiro dos dois que esta na tela (roomFocusTarget).
  assert.match(trilho, /<button aria-controls="room-panel" aria-expanded="true" class="[^"]*" data-room-first-focus="" data-room-rail="chat" id="room-railbtn-chat"/);
  assert.match(painel, /<button aria-controls="room-tab-chat" aria-selected="true" class="[^"]*" data-room-first-focus="" id="room-tabbtn-chat"/);
  assert.equal((html.match(/data-room-first-focus=""/g) ?? []).length, 2, "o Chat do trilho e a aba Chat; o balao, com o painel aberto, nao");
  assert.match(html, /aria-label="Escreva uma mensagem"/);

  // Os selos saem do cabecalho e vao para o palco (V2-4): Ao vivo e Gravando em cima a esquerda, quem apresenta embaixo.
  const cabecalho = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  const palcoInicio = html.indexOf("data-lesson-player-stage");
  // O palco vai do atributo do sinal de midia ate a nossa barra (o filho seguinte da coluna do palco).
  const palco = html.slice(palcoInicio, html.indexOf('data-testid="live-controls"'));
  assert.ok(palcoInicio > 0 && palco.length > 0, "o palco");
  assert.doesNotMatch(cabecalho, /Ao vivo|Gravando|room-on-air|live-recording/, "nenhum selo no cabecalho");
  assert.match(palco, /data-testid="room-on-air" title="Ao vivo · 00:42:10"/, "o Ao vivo no palco, a frase inteira no title");
  assert.match(palco, /<span class="hidden sm:inline">Ao vivo · 00:42:10<\/span>/, "no computador, a frase inteira");
  assert.match(palco, /<span aria-hidden="true" class="sm:hidden">00:42:10<\/span>/, "no celular, so o tempo");
  assert.match(palco, /<span class="sr-only sm:hidden">Ao vivo · 00:42:10<\/span>/, "e o leitor de tela ouve a frase");
  assert.match(palco, /data-testid="live-recording" title="Gravando">[\s\S]*?Gravando<\/span>/, "o Gravando no palco");
  assert.match(palco, /data-room-badge="presenter"[\s\S]*?>Danilo S\. · Apresentador</, "quem apresenta, embaixo a esquerda");
  assert.ok(palco.indexOf('data-testid="room-on-air"') < palco.indexOf('data-testid="live-recording"'), "o Gravando ao lado do Ao vivo");
  // Antes de entrar nao ha iframe, nem a coluna de miniaturas dele (docs/31 V2-A5): os selos e as pilulas vao ate a borda.
  assert.match(html, /data-room-stage="idle" role="region" style="--room-video-right:0px"/);
  assert.doesNotMatch(html, /data-room-badge="assistant"/, "o Assistente desligado (o servidor ainda nao leu o estado)");
  assert.doesNotMatch(sala(), /Gravando/, "sem gravador, sem o selo");

  // O cabecalho (V2-3, no estilo do YouTube): o titulo e a linha que comeca pelo numero, com a data, a duracao e quem
  // apresenta; no celular, o numero primeiro e quem apresenta.
  assert.match(cabecalho, /<h1 [^>]*>Aula de IA<\/h1>/);
  assert.match(cabecalho, /data-room-line="meta"><span data-testid="room-present">7 assistindo agora<\/span> · Quinta, 5 de novembro · 19:15 · 60 min · com Danilo S\.<\/p>/);
  assert.match(cabecalho, /data-testid="room-mobile-line">7 assistindo agora · com Danilo S\.<\/p>/);
  assert.match(cabecalho, /class="hidden shrink-0 items-center lg:flex" data-room-brand="logo"/, "a logo so a partir de lg (o ponto em que a sala vira computador)");
  assert.doesNotMatch(cabecalho, /data-room-brand="icon"/, "abaixo de lg, sem marca: o titulo tem a largura");

  const comEnquete = sala({ payload: payload({ polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }) });
  assert.match(comEnquete, /role="tab"[^>]*>Enquetes</);
  // A enquete aberta sem resposta abre no meio do palco (docs/31 V2-10), dentro do [data-lesson-player-stage] e por
  // cima do Entrar na sala, mesmo antes de o aluno pedir; o card do chat so com ela deixada para depois.
  // Ela depende do que esta guardado no navegador (o "depois", os resultados vistos), que o servidor nao sabe: o HTML do
  // servidor sai sem a camada e sem o card, com a regiao viva vazia no palco, e os dois entram depois da hidratacao
  // (useRoomHydrated; o e2e confere a camada). Sem isso, a enquete deixada para depois piscava no palco a cada carga.
  const noPalco = comEnquete.slice(comEnquete.indexOf("data-lesson-player-stage"), comEnquete.indexOf('data-testid="room-panel"'));
  assert.match(noPalco, /<p aria-live="polite" class="sr-only" data-room-poll-said=""><\/p>/, "a regiao viva fica montada no palco");
  assert.doesNotMatch(comEnquete, /data-room-poll-layer|data-room-stage-poll|Responder depois/, "nada da enquete no HTML do servidor");
  assert.doesNotMatch(comEnquete, /Responder agora|data-room-poll-later/, "nem o card do chat");
  // A sala bloqueada (removido) nao abre nada no palco.
  const removido = sala({ payload: payload({ me: { ban: { ...SEM_BAN, kicked: true } }, polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }) });
  assert.match(removido, /data-room-screen="kicked"/);
  assert.doesNotMatch(removido, /data-room-poll-layer|data-room-poll-said/);
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

  // Na espera fora da Sessao de pratica a sala abre (sem capa depois de entrar): o selo "Aguardando o apresentador" fica
  // no palco, em cima a esquerda, neutro sobre o video, onde o "Ao vivo" aparece quando a live comeca (V2-4).
  const palcoDe = (html) => html.slice(html.indexOf("data-lesson-player-stage"), html.indexOf('data-testid="live-controls"'));
  const cabecalhoDe = (html) => html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(espera, /data-room-screen="open"/);
  assert.match(palcoDe(espera), /data-room-badges="top"><span class="[^"]*bg-black\/60[^"]*" data-room-badge="waiting">Aguardando o apresentador<\/span><\/div>/);
  assert.doesNotMatch(cabecalhoDe(espera), /Aguardando o apresentador/, "nada no cabecalho");
  assert.doesNotMatch(palcoDe(espera), /room-on-air|data-room-badge="presenter"/, "sem o Ao vivo e sem quem apresenta antes de comecar");
  // Na capa da espera (a sessao que ainda nao abriu, a Sessao de pratica) a frase ja esta na capa: o selo nao repete.
  assert.equal((aluno.match(/Aguardando o apresentador/g) ?? []).length, 1, "so a capa");
  assert.doesNotMatch(aluno, /data-room-badge="waiting"/);
  const pratica = sala({ payload: payload({ live: { practice: true, startedAt: null, status: "waiting" }, session: { startedAt: null, status: "waiting" } }) });
  assert.match(pratica, /data-room-screen="waiting"/);
  assert.doesNotMatch(pratica, /data-room-badge="waiting"/);
  // A equipe na Sessao de pratica entra (a tela aberta) e tambem ve que a live ainda nao comecou para todos.
  assert.match(sala({ payload: payload({ live: { practice: true, startedAt: null, status: "waiting" }, session: { startedAt: null, status: "waiting" } }), staff: true }), /data-room-badge="waiting">Aguardando o apresentador</);
  // No ar, o selo da espera sai e o Ao vivo entra no lugar dele.
  assert.doesNotMatch(sala(), /data-room-badge="waiting"/);
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
  // Redesign V2, F3 (V2-3 e V2-4): o cabecalho nao tem selo; o fim fica no palco, sem "Ao vivo", sem contador.
  const cabecalho = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.doesNotMatch(cabecalho, /Encerrada|Ao vivo/);
  assert.doesNotMatch(html, /assistindo|data-testid="room-on-air"|data-room-badge=/, "encerrada: sem contador e sem selos no palco");

  const comReplay = sala({ payload: { ...fim, webinar: { ...fim.webinar, replaySessionId: "dddddddd-0000-4000-8000-000000000009" } } });
  assert.match(comReplay, /href="\/webinarios\/aula-de-ia\/sala\?sessao=dddddddd-0000-4000-8000-000000000009"[^>]*>Assistir o replay</);
  assert.doesNotMatch(comReplay, /O replay fica pronto em algumas horas/);
});

test("o mesmo esqueleto da gravada (V2-6): corpo > coluna > caixa do palco, a barra embaixo do palco na coluna, a Tela cheia no canto do palco no celular e o Sair do cabecalho so abaixo de lg com a barra na tela", () => {
  const html = sala();
  // O caminho do palco e o mesmo da gravada (ROOM_STAGE_PATH): abrir e fechar o painel so troca classes, o iframe fica.
  assert.match(html, /data-room-slot="body"><div class="[^"]*" data-room-slot="stage-column"><div class="[^"]*" data-room-slot="stage-box"><div aria-label="Vídeo da live"/);
  const coluna = html.slice(html.indexOf('data-room-slot="stage-column"'), html.indexOf("<aside"));
  assert.ok(coluna.indexOf('data-room-slot="stage-box"') < coluna.indexOf('data-testid="live-controls"'), "a barra embaixo do palco, na mesma coluna");
  // O balao controla o painel do chat (o aside com o id), aberto na primeira pintura (nada guardado ainda), so abaixo de
  // lg: a partir de lg o trilho a direita faz isso.
  assert.match(html, /<aside aria-labelledby="room-panel-title" class="[^"]*" data-testid="room-panel" id="room-panel">/);
  assert.match(html, /<button aria-controls="room-panel" aria-expanded="true" aria-label="Esconder o chat" class="[^"]*\blg:hidden\b[^"]*"/);
  // No celular a Tela cheia fica no canto do palco, dentro dele (a da barra so aparece a partir de lg).
  const palco = html.slice(html.indexOf("data-lesson-player-stage"), html.indexOf('data-testid="live-controls"'));
  assert.match(palco, /<button aria-label="Tela cheia"[^>]*class="[^"]*absolute bottom-2 right-2 z-30 lg:hidden"[^>]*data-room-stage-corner=""/);
  // O palco da live: 16:9 em pe; deitado abaixo de lg (V2-6) ele deixa o 16:9 e ocupa o que sobra na caixa, acima da
  // barra. Sem as tres classes, a 844 x 390 o palco 16:9 (556 x 313) passava da caixa de 254 px e os 59 px de baixo,
  // com o circulo do canto, ficavam embaixo da barra.
  const classesDoPalco = (html.match(/<div aria-label="Vídeo da live" class="([^"]*)"/)?.[1] ?? "").split(" ");
  for (const classe of ["aspect-video", "max-lg:landscape:aspect-auto", "max-lg:landscape:min-h-0", "max-lg:landscape:flex-1", "lg:aspect-auto", "lg:min-h-0", "lg:flex-1"]) {
    assert.ok(classesDoPalco.includes(classe), `${classe} em ${classesDoPalco.join(" ")}`);
  }
  // O Sair: na barra a partir de lg; o do cabecalho fica so abaixo de lg.
  const cabecalho = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(cabecalho, /<button class="[^"]*bg-room-accent[^"]*\blg:hidden" type="button">[\s\S]*?Sair<\/button>/);
  assert.match(html, /data-room-bar-item="leave"/);

  // Encerrada: sem a barra, o Sair do cabecalho vale em toda largura e o painel fica na tela (o balao saiu junto).
  const fim = sala({ payload: payload({ live: { status: "ended" }, session: { status: "ended" } }) });
  const cabecalhoFim = fim.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(cabecalhoFim, />Sair<\/button>/);
  assert.doesNotMatch(cabecalhoFim, /\blg:hidden" type="button">/, "o Sair do cabecalho tambem no computador");
  assert.doesNotMatch(fim, /data-room-bar-item=|data-room-stage-corner/);
  assert.match(fim, /<aside aria-labelledby="room-panel-title" class="[^"]*" data-testid="room-panel" id="room-panel">/);
  // O trilho continua (o painel na tela, sem o X): o Chat aberto.
  assert.match(fim, /<nav aria-label="Painel da sala"[^>]*><button aria-controls="room-panel" aria-expanded="true"[^>]*data-room-rail="chat"/);
  assert.doesNotMatch(fim, /Fechar o painel/);
});

test("removido e banido: a frase toma o lugar da sala (sem iframe montado, sem barra, sem chat); silenciado: o campo da lugar a hora de Sao Paulo", () => {
  const removido = sala({ payload: payload({ me: { ban: { ...SEM_BAN, kicked: true } } }) });
  assert.match(removido, /data-room-screen="kicked"/);
  assert.match(removido, /role="alert">Você foi removido desta live\.</);
  assert.doesNotMatch(removido, /data-testid="room-panel"/);
  assert.doesNotMatch(removido, /data-room-rail/, "nem o trilho");
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

test("a aba Participantes mostra quem esta no palco e o numero de alunos, nunca a lista de alunos; com o painel fechado, as 2 ultimas mensagens em pilulas sobre o palco (V2-8)", () => {
  const html = render(notices.LiveParticipantsTab, { presenterKnown: true, stage: ["Danilo S.", "Carla P."], students: 12 });
  assert.match(html, />No palco</);
  assert.match(html, /Danilo S\./);
  assert.match(html, /Carla P\./);
  assert.match(html, /12 alunos na sala/);
  assert.equal((html.match(/<li/g) ?? []).length, 2, "so o palco vira lista");
  // No estilo do YouTube: "No palco" em 14/20 peso 500 sem caixa alta; cada nome numa linha de 40 px com o avatar de 24;
  // o selo "Apresentador" so no primeiro, quando a sala sabe quem apresenta; o numero numa linha de 40 com o icone de 20.
  assert.match(html, /<h3 class="flex h-10 items-center text-sm font-medium leading-5 text-room-fg-subtle">No palco<\/h3>/);
  assert.doesNotMatch(html, /uppercase|var\(--accent\)|lucide-radio/, "sem a caixa alta e sem o icone no acento");
  const itens = [...html.matchAll(/<li class="([^"]*)">([\s\S]*?)<\/li>/g)];
  assert.ok(itens.every(([, classes]) => /\bh-10\b/.test(classes)), "as linhas de 40 px");
  assert.match(itens[0][2], /class="[^"]*\bsize-6\b[^"]*"><span[^>]*>DS<\/span><\/span><span class="[^"]*\btext-sm\b[^"]*\bleading-5\b[^"]*\btext-room-fg\b[^"]*">Danilo S\.<\/span><span class="[^"]*\bbg-room-control\b[^"]*">Apresentador<\/span>$/);
  assert.doesNotMatch(itens[1][2], /Apresentador/, "o selo so no primeiro");
  assert.match(html, /<p class="flex h-10 items-center gap-3 text-sm leading-5 text-room-fg"><svg[^>]*lucide-users[^"]*size-5[^>]*>[\s\S]*?<\/svg>12 alunos na sala<\/p>/);
  // Sem saber quem apresenta (a live ainda sem o nome), nenhum selo.
  assert.doesNotMatch(render(notices.LiveParticipantsTab, { presenterKnown: false, stage: ["Danilo S."], students: 12 }), /Apresentador/);
  assert.match(render(notices.LiveParticipantsTab, { presenterKnown: false, stage: [], students: 1 }), /1 aluno na sala/);
  // A live encerrada: o cabecalho tira o "{n} assistindo" e a aba tambem fica sem numero (so o palco).
  const encerrada = render(notices.LiveParticipantsTab, { presenterKnown: true, stage: ["Danilo S."], students: null });
  assert.match(encerrada, /Danilo S\./);
  assert.doesNotMatch(encerrada, /na sala/);

  // As pilulas (V2-8): as 2 ultimas (overlayMessages), a mais nova embaixo, sobre o video, tambem no computador.
  const mensagens = ["a", "b", "c"].map((id) => ({ body: `texto ${id}`, displayName: id === "c" ? "Bruna Souza" : "Ana S.", id, kind: "message", mine: false, offsetMs: 0, pending: false, pinned: false, replyToId: null, role: "student" }));
  const pilulas = render(pillsModule.RoomChatPills, { kind: "live", messages: overlayMessages(mensagens) });
  assert.equal((pilulas.match(/<li/g) ?? []).length, 2);
  assert.doesNotMatch(pilulas, /texto a/, "so as 2 ultimas");
  assert.ok(pilulas.indexOf("texto b") < pilulas.indexOf("texto c"), "a mais nova embaixo");
  assert.match(pilulas, /<ol aria-label="Chat" aria-live="polite" class="[^"]*" role="log">/);
  const caixa = (pilulas.match(/^<div class="([^"]*)" data-testid="room-chat-pills">/)?.[1] ?? "").split(" ");
  // Centradas entre a borda esquerda do video e a coluna de miniaturas do iframe, a 56 px da base (mais a altura do aviso
  // da sala no palco, --room-snackbar-offset); nada recebe o toque.
  for (const classe of ["pointer-events-none", "absolute", "left-0", "right-[var(--room-video-right)]", "bottom-[calc(3.5rem+var(--room-snackbar-offset,0px))]", "justify-center"]) {
    assert.ok(caixa.includes(classe), `${classe} em ${caixa.join(" ")}`);
  }
  assert.ok(!caixa.includes("lg:hidden"), "tambem no computador");
  assert.match(pilulas, /max-w-\[380px\]/);
  // Cada pilula: 32 px em preto a 55 % (igual nos dois temas), o avatar so com as iniciais (22 px), o nome e o texto.
  const pilula = pilulas.match(/<li class="([^"]*)">/)?.[1].split(" ") ?? [];
  assert.ok(["h-8", "rounded-full", "bg-black/55", "text-white"].every((classe) => pilula.includes(classe)), pilula.join(" "));
  assert.match(pilulas, /<span aria-hidden="true" class="[^"]*size-\[22px\][^"]*"><span class="[^"]*">BS<\/span><\/span><span class="[^"]*font-semibold[^"]*">Bruna Souza<\/span> <span class="min-w-0 truncate">texto c<\/span>/);
  // No Replay, acima da barra de controles da Bunny, e com o nome da aba do painel ("Chat da live").
  const doReplay = render(pillsModule.RoomChatPills, { kind: "replay", messages: overlayMessages(mensagens) });
  assert.match(doReplay, /^<div class="[^"]* bottom-\[calc\(5rem\+var\(--room-snackbar-offset,0px\)\)\]" data-testid="room-chat-pills"><ol aria-label="Chat da live"/);
  assert.match(render(pillsModule.RoomChatPills, { kind: "simulated", messages: overlayMessages(mensagens) }), /^<div class="[^"]* bottom-\[calc\(3\.5rem\+var\(--room-snackbar-offset,0px\)\)\]" data-testid="room-chat-pills"><ol aria-label="Chat"/);
  assert.equal(render(pillsModule.RoomChatPills, { kind: "live", messages: [] }), "", "sem mensagem, nada no palco");
});

test("o painel e o trilho no estilo do YouTube: o trilho 'Painel da sala' com um botao por aba (aria-expanded so no aberto, o contador no Chat, o ponto em Enquetes, sem title); o painel com o cabecalho h2, o numero e o X sem contorno; fechado, o aside fica hidden e o conteudo continua montado", () => {
  const trilho = (props = {}) =>
    render(railModule.RoomRail, { kind: "live", onItem: noop, panelShown: true, pollOpen: true, tab: "chat", tabs: layout.panelTabsFor({ kind: "live", openPolls: 1, tab: "chat" }), unread: 0, ...props });
  const botoes = (html) => [...html.matchAll(/<button ([^>]*)>/g)].map(([, atributos]) => atributos);
  const atributo = (atributos, nome) => atributos.match(new RegExp(`(?:^| )${nome}="([^"]*)"`))?.[1] ?? null;

  // O trilho: a navegacao "Painel da sala" (o mesmo nome da linha das abas, que so existe abaixo de lg), so a partir de lg.
  const aberto = trilho({ tab: "perguntas", unread: 3 });
  const nav = aberto.match(/^<nav aria-label="Painel da sala" class="([^"]*)">/)?.[1].split(" ") ?? [];
  assert.ok(["hidden", "w-12", "lg:flex", "lg:ml-2", "gap-4"].every((classe) => nav.includes(classe)), nav.join(" "));
  // Um botao por aba, todos controlando o painel; o aberto (o painel na tela e na aba dele) com aria-expanded true.
  const itens = botoes(aberto);
  assert.deepEqual(itens.map((item) => atributo(item, "data-room-rail")), ["chat", "perguntas", "participantes", "enquetes"]);
  assert.deepEqual(itens.map((item) => atributo(item, "id")), ["room-railbtn-chat", "room-railbtn-perguntas", "room-railbtn-participantes", "room-railbtn-enquetes"]);
  assert.ok(itens.every((item) => atributo(item, "aria-controls") === "room-panel"), "todos controlam o painel");
  assert.deepEqual(itens.map((item) => atributo(item, "aria-expanded")), ["false", "true", "false", "false"]);
  assert.doesNotMatch(aberto, /aria-pressed|title=/, "nunca aria-pressed e sem title: o rotulo esta na tela");
  // O rotulo visivel e o nome; o Chat com mensagens novas comeca pelo rotulo, e o numero fica so na tela.
  assert.deepEqual([...aberto.matchAll(/<span class="[^"]*text-\[10px\][^"]*">([^<]+)<\/span>/g)].map(([, rotulo]) => rotulo), ["Chat", "Perguntas", "Participantes", "Enquetes"]);
  assert.equal(atributo(itens[0], "aria-label"), "Chat, 3 mensagens novas");
  assert.ok(itens.slice(1).every((item) => atributo(item, "aria-label") === null), "os outros pelo rotulo");
  const contador = aberto.match(/<span aria-hidden="true" class="([^"]*)" data-room-unread="">3<\/span>/)?.[1].split(" ") ?? [];
  assert.ok(["absolute", "right-0.5", "top-0.5", "bg-room-accent", "shadow-[0_0_0_2px_var(--room-bg)]"].every((classe) => contador.includes(classe)), contador.join(" "));
  // O ponto da enquete aberta no Enquetes, com o anel no fundo da sala.
  const enquetes = aberto.slice(aberto.indexOf('data-room-rail="enquetes"'));
  assert.match(enquetes, /<span aria-hidden="true" class="absolute right-1\.5 top-1\.5 size-2 rounded-full bg-room-accent shadow-\[0_0_0_2px_var\(--room-bg\)\]"><\/span>/);
  assert.doesNotMatch(trilho({ pollOpen: false, tabs: ["chat", "perguntas", "participantes", "enquetes"] }), /size-2 rounded-full bg-room-accent/, "sem enquete aberta, sem o ponto");
  // O item aberto: o quadrado tonal e o rotulo em 600; o Chat e sempre o primeiro foco (a partir de lg).
  const quadrado = (html, aba) => html.slice(html.indexOf(`data-room-rail="${aba}"`)).match(/<span class="([^"]*)">/)?.[1].split(" ") ?? [];
  assert.ok(quadrado(aberto, "perguntas").includes("bg-room-control") && !quadrado(aberto, "chat").includes("bg-room-control"));
  assert.ok(["size-12", "rounded-[8px]", "group-hover:bg-room-control-hover", "group-focus-visible:outline-room-focus"].every((classe) => quadrado(aberto, "chat").includes(classe)), quadrado(aberto, "chat").join(" "));
  assert.equal(atributo(itens[0], "data-room-first-focus"), "");
  assert.ok(itens.slice(1).every((item) => atributo(item, "data-room-first-focus") === null));
  // O Chat aberto nao mostra o numero (o contador conta so com o Chat fora da tela).
  const chatAberto = trilho({ tab: "chat", unread: 3 });
  assert.doesNotMatch(chatAberto, /data-room-unread/);
  assert.match(chatAberto, /aria-expanded="true"[^>]*data-room-rail="chat"/);
  // Fechado, nenhum item aberto; o Chat com o numero e o nome.
  const fechado = trilho({ panelShown: false, unread: 1 });
  assert.ok(botoes(fechado).every((item) => atributo(item, "aria-expanded") === "false"));
  assert.equal(atributo(botoes(fechado)[0], "aria-label"), "Chat, 1 mensagem nova");
  // O Replay: sem Participantes, e o Chat se chama "Chat" no trilho (o painel diz "Chat da live").
  const replay = trilho({ kind: "replay", pollOpen: false, tabs: layout.panelTabsFor({ kind: "replay", openPolls: 0, tab: "chat" }) });
  assert.deepEqual([...replay.matchAll(/<span class="[^"]*text-\[10px\][^"]*">([^<]+)<\/span>/g)].map(([, rotulo]) => rotulo), ["Chat", "Perguntas"]);

  // O painel: o cartao do YouTube a partir de lg, com o cabecalho e a linha das abas so abaixo de lg.
  const painel = (props = {}) =>
    render(panelModule.RoomPanel, {
      children: createElement("textarea", { "aria-label": WEBINAR_COPY.sala.escreva, defaultValue: "rascunho" }),
      className: "flex min-h-0 flex-col flex-1",
      closable: true,
      firstFocus: true,
      id: "room-panel",
      kind: "live",
      onClose: noop,
      onTab: noop,
      open: true,
      pollOpen: false,
      tab: "chat",
      tabs: layout.panelTabsFor({ kind: "live", openPolls: 0, tab: "chat" }),
      ...props
    });
  const chat = painel();
  assert.match(chat, /^<aside aria-labelledby="room-panel-title" class="[^"]*" data-testid="room-panel" id="room-panel">/);
  // A largura da grade do YouTube, o raio 12 fixo, o contorno e o fundo do painel, sem cortar (o anel do X fica inteiro);
  // abaixo de lg deitado, ao lado do palco com 288 px, como antes.
  const asideClasses = (chat.match(/^<aside aria-labelledby="room-panel-title" class="([^"]*)"/)?.[1] ?? "").split(" ");
  for (const classe of ["lg:w-[clamp(320px,27.5vw,514px)]", "lg:flex-none", "lg:rounded-[12px]", "lg:border", "lg:border-room-panel-border", "lg:bg-room-panel", "max-lg:landscape:w-72", "max-lg:landscape:flex-none"]) {
    assert.ok(asideClasses.includes(classe), `${classe} em ${asideClasses.join(" ")}`);
  }
  assert.ok(!asideClasses.includes("lg:w-80") && !asideClasses.some((classe) => classe.includes("overflow-hidden")), "sem os 320 px fixos e sem cortar");
  // A linha das abas (com o tablist "Painel da sala") so abaixo de lg, e sem o X.
  const linha = chat.match(/<div class="([^"]*)"><div aria-label="Painel da sala" class="[^"]*" role="tablist">/)?.[1].split(" ") ?? [];
  assert.ok(linha.includes("lg:hidden"), linha.join(" "));
  const tablist = chat.slice(chat.indexOf('role="tablist"'), chat.indexOf("</div>", chat.indexOf('role="tablist"')));
  assert.doesNotMatch(tablist, /Fechar o painel/);
  // O cabecalho a partir de lg: o h2 com o nome da aba, sem numero no Chat, e o X sem contorno e sem title.
  const cabecalho = chat.match(/<div class="([^"]*)"><h2 [\s\S]*?<\/h2>[\s\S]*?<\/div><div aria-labelledby="room-tabbtn-chat"/);
  assert.ok(cabecalho, "o cabecalho entre a linha das abas e a aba escolhida");
  assert.ok(["hidden", "h-14", "lg:flex", "pl-4", "pr-0.5"].every((classe) => cabecalho[1].split(" ").includes(classe)), cabecalho[1]);
  assert.match(chat, /<h2 class="[^"]*\btext-xl\b[^"]*\bfont-bold\b[^"]*" id="room-panel-title">Chat<\/h2>/);
  const x = chat.match(/<button aria-label="Fechar o painel" class="([^"]*)" type="button">/)?.[1].replaceAll("&amp;", "&").split(" ") ?? [];
  assert.ok(x.includes("size-10") && x.includes("rounded-full") && x.includes("bg-transparent") && x.includes("hover:bg-room-control-hover"), x.join(" "));
  assert.ok(!x.includes("border") && !x.some((classe) => classe.startsWith("border-")), "o X sem contorno");
  assert.doesNotMatch(chat, /title="Fechar o painel"/, "sem title: a dica da sala mostra o nome");
  // A aba escolhida continua ligada a aba da linha (o tabpanel), com o cartao de hoje so abaixo de lg.
  const tabpanel = (chat.match(/<div aria-labelledby="room-tabbtn-chat" class="([^"]*)" id="room-tab-chat" role="tabpanel"><textarea/)?.[1] ?? "").split(" ");
  assert.ok(["max-lg:overflow-hidden", "lg:border-0", "lg:bg-transparent", "lg:rounded-none", "bg-room-surface"].every((classe) => tabpanel.includes(classe)), tabpanel.join(" "));
  assert.ok(!tabpanel.includes("overflow-hidden"), "a partir de lg sem cortar");
  // Participantes com o numero dentro do h2 (o mesmo do cabecalho da sala), no formato do Brasil.
  const participantes = painel({ tab: "participantes", titleCount: 1234 });
  assert.match(participantes, /<h2 [^>]*id="room-panel-title">Participantes<span class="[^"]*\btext-room-fg-subtle\b[^"]*">1\.234<\/span><\/h2>/);
  assert.match(painel({ tab: "enquetes", titleCount: 0 }), /id="room-panel-title">Enquetes<span class="[^"]*">0<\/span><\/h2>/, "o zero tambem");
  // A acao da aba, antes do X.
  const comAcao = painel({ titleAction: createElement("button", { type: "button" }, "ordenar") });
  assert.ok(comAcao.indexOf(">ordenar<") > comAcao.indexOf("</h2>") && comAcao.indexOf(">ordenar<") < comAcao.indexOf("Fechar o painel"));
  // Fechado: o aside hidden, e o campo com o rascunho continua no HTML (montado). O primeiro foco pela regra pura:
  // fechado, ele vai para o balao (abaixo de lg) e para o trilho, nunca para a aba escondida.
  const fechadoPainel = painel({ firstFocus: layout.firstFocusTarget({ panelShown: false }) === "tab", open: false });
  assert.match(fechadoPainel, /^<aside aria-labelledby="room-panel-title" class="[^"]*" data-testid="room-panel" hidden="" id="room-panel">/);
  assert.match(fechadoPainel, /<textarea aria-label="[^"]+">rascunho<\/textarea>/);
  assert.doesNotMatch(fechadoPainel, /data-room-first-focus/, "fechado, a aba nao e o primeiro foco");
  // Sem a barra (encerrada) o painel fica na tela: sem o X. Com enquete aberta, a aba Enquetes com o ponto.
  assert.doesNotMatch(painel({ closable: false }), /Fechar o painel/);
  const comEnquete = painel({ pollOpen: true, tabs: layout.panelTabsFor({ kind: "live", openPolls: 1, tab: "chat" }) });
  assert.match(comEnquete, /role="tab" type="button">Enquetes<span aria-hidden="true" class="[^"]*bg-room-accent[^"]*"><\/span><\/button>/);
  // As abas da linha com o rotulo inteiro, que rola de lado quando as quatro nao cabem.
  const classesDasAbas = [...comEnquete.matchAll(/<button aria-controls="room-tab-[a-z]+" aria-selected="(?:true|false)" class="([^"]*)"/g)].map(([, classes]) => classes.split(" "));
  assert.equal(classesDasAbas.length, 4);
  for (const classes of classesDasAbas) {
    assert.ok(classes.includes("shrink-0") && classes.includes("grow") && classes.includes("whitespace-nowrap"), classes.join(" "));
  }
  // O Replay chama o Chat de "Chat da live" (no titulo e na aba) e nao tem Participantes.
  const replayPainel = painel({ kind: "replay", tabs: layout.panelTabsFor({ kind: "replay", openPolls: 0, tab: "chat" }) });
  assert.match(replayPainel, /id="room-panel-title">Chat da live<\/h2>/);
  assert.match(replayPainel, /role="tab" type="button">Chat da live<\/button>/);
  assert.doesNotMatch(replayPainel, />Participantes</);
});

test("o balao com o painel fechado (V2-7 e V2-8): o contador vermelho das mensagens novas no canto e o nome 'Mostrar o chat, N mensagens novas'; aberto, sem contador; fechado, e o primeiro foco", () => {
  const balao = (props) => render(barModule.RoomPanelToggle, { onToggle: noop, ...props });
  const tres = balao({ open: false, unread: 3 });
  assert.match(tres, /^<button aria-controls="room-panel" aria-expanded="false" aria-label="Mostrar o chat, 3 mensagens novas"/);
  const contador = tres.match(/<span aria-hidden="true" class="([^"]*)" data-room-unread="">3<\/span>/)?.[1].split(" ") ?? [];
  assert.ok(["absolute", "h-[18px]", "min-w-[18px]", "bg-room-accent", "text-[11px]", "font-bold", "shadow-[0_0_0_2px_var(--room-surface)]"].every((classe) => contador.includes(classe)), contador.join(" "));
  assert.match(balao({ open: false, unread: 1 }), /aria-label="Mostrar o chat, 1 mensagem nova"/);
  // Sem novas, so "Mostrar o chat"; aberto, "Esconder o chat" e nunca o contador (abrir zera).
  assert.match(balao({ open: false, unread: 0 }), /aria-expanded="false" aria-label="Mostrar o chat"/);
  assert.doesNotMatch(balao({ open: false, unread: 0 }), /data-room-unread/);
  const aberto = balao({ open: true, unread: 5 });
  assert.match(aberto, /aria-expanded="true" aria-label="Esconder o chat"/);
  assert.doesNotMatch(aberto, /data-room-unread/);
  // Fechado, o balao recebe o primeiro foco da sala (a aba Chat esta escondida), pela regra pura.
  const focoNoBalao = layout.firstFocusTarget({ panelShown: false }) === "panel-toggle";
  assert.match(balao({ firstFocus: focoNoBalao, open: false }), /data-room-first-focus=""/);
  assert.doesNotMatch(balao({ firstFocus: layout.firstFocusTarget({ panelShown: true }) === "panel-toggle", open: true }), /data-room-first-focus/);
  // A barra da live leva o contador e o primeiro foco ao balao.
  const naBarra = barra({ panelFirstFocus: focoNoBalao, panelOpen: false, panelUnread: 2 });
  assert.match(naBarra, /<button aria-controls="room-panel" aria-expanded="false" aria-label="Mostrar o chat, 2 mensagens novas"[^>]*data-room-first-focus=""/);
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
