import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala desenhada (docs/30 §1.3 adaptado a §1.6, §1.7, §8.5 e §9; docs/18 §2.2): os pedacos desenhados no Node,
// sem navegador. O cabecalho (o selo "Ao vivo" so com a decisao da equipe; senao "Sessao das 20:00"; Replay sem
// contador; "{n} assistindo"), o palco nos estados (espera com a contagem, no ar com o iframe da Bunny coberto e
// "Ativar som", encerrada com "Assistir de novo" quando ha replay), o chat (os selos Equipe / Apresentador /
// Assistente, a pendente "Aguardando a equipe", a fixada, o compositor desligado e no modo lento), o aceite com o
// texto exato de §8.5 e os dois botoes, a barra de reacoes com seis botoes de 44 px, a sala inteira como dialogo
// (aria-modal, as abas, a 375 px: palco na largura, campo no rodape) e os botoes Entrar / Assistir o replay. A marca no
// cabecalho (a sala cobre o topo da area): a logo de Marca a partir de lg (o ponto em que a sala vira computador),
// "Bunker707" sem logo, o Icone da escola de 24 px abaixo de lg, sem link; e o "Ao vivo · 00:42:10" curto no celular da
// Live ao vivo.

const header = await import("../src/components/member/webinars/room/room-header.tsx");
const branding = await import("../src/components/platform-branding.tsx");
const stage = await import("../src/components/member/webinars/room/room-stage.tsx");
const chat = await import("../src/components/member/webinars/room/room-chat.tsx");
const reactions = await import("../src/components/member/webinars/room/room-reactions.tsx");
const room = await import("../src/components/member/webinars/room/webinar-room.tsx");
const enter = await import("../src/components/member/webinars/webinar-enter-button.tsx");
const privacy = await import("../src/components/member/webinars/webinar-chat-privacy.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { CHAT_LIMITS, REACTIONS } = await import("../src/server/webinars/model.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const noop = () => undefined;
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

test("cabecalho: Ao vivo com o tempo so com a decisao da equipe; senao Sessao das 20:00; Replay sem contador; {n} assistindo; Minimizar e Sair", () => {
  const base = { getOffsetMs: () => 2_530_000, kind: "simulated", onLeave: noop, onMinimize: noop, phase: "live", presentNow: 3, showLiveBadge: true, timeLabel: "20:00", title: "Aula de IA" };
  const live = render(header.RoomHeader, base);
  assert.match(live, /Ao vivo/);
  assert.match(live, /42:10/, "o tempo no ar");
  assert.match(live, /3 assistindo/);
  assert.match(live, /aria-label="Minimizar"/);
  assert.match(live, /aria-label="Sair"/);
  assert.doesNotMatch(live, /Sessão das/);

  const plain = render(header.RoomHeader, { ...base, showLiveBadge: false });
  assert.match(plain, /Sessão das 20:00/);
  assert.doesNotMatch(plain, /Ao vivo/, "sem a decisao, nada de Ao vivo");

  const replay = render(header.RoomHeader, { ...base, kind: "replay" });
  assert.match(replay, />Replay</);
  assert.doesNotMatch(replay, /assistindo/, "o replay nao tem contador");
  assert.equal(render(header.RoomHeader, { ...base, presentNow: 1 }).includes("1 assistindo"), true);
});

test("cabecalho: a marca sem link; a logo de Marca a partir de lg (ou Bunker707 sem logo) com o traco; o Icone da escola de 24 px abaixo de lg", () => {
  const base = { getOffsetMs: () => 2_530_000, kind: "simulated", onLeave: noop, onMinimize: noop, phase: "live", presentNow: 3, showLiveBadge: true, timeLabel: "20:00", title: "Aula de IA" };
  const comMarca = (marca, props = {}) =>
    renderToStaticMarkup(createElement(branding.PlatformBrandingProvider, { branding: marca }, createElement(header.RoomHeader, { ...base, ...props })));
  const tag = (html, nome) => html.match(new RegExp(`<[a-z]+[^>]*data-room-brand="${nome}"[^>]*>`))?.[0] ?? "";
  const LOGO = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/logo.png";
  const ICONE = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/icone.png";

  // Sem logo em Marca: o nome em texto pequeno, dentro do bloco que so aparece a partir de lg, com o traco.
  const semLogo = comMarca({ logoImage: null });
  assert.match(semLogo, /data-room-brand="logo"[^>]*>\s*<span class="[^"]*text-sm font-black[^"]*">Bunker707<\/span>\s*<span aria-hidden="true" class="h-5 w-px bg-white\/15"><\/span>/);
  assert.match(tag(semLogo, "logo"), /class="hidden shrink-0 items-center gap-3 lg:flex"/, "a logo e o traco so a partir de lg");
  assert.doesNotMatch(semLogo, /<img[^>]*class="[^"]*w-\[112px\]/, "sem logo, nenhuma imagem de logo");

  // Com a logo enviada em Marca: a imagem com o nome da escola, 112 px no maximo 32 de altura, alinhada a esquerda.
  const comLogo = comMarca({ logoImage: LOGO });
  const logo = comLogo.match(/<img[^>]*w-\[112px\][^>]*>/)?.[0] ?? "";
  assert.match(logo, /alt="Bunker707"/);
  assert.match(logo, new RegExp(`src="${LOGO.replace(/[.]/g, "\\.")}"`));
  assert.match(logo, /class="h-auto max-h-8 w-\[112px\] shrink-0 object-contain object-left"/);
  assert.doesNotMatch(comLogo, />Bunker707</, "com a logo, sem o nome em texto");

  // O Icone da escola no celular: o simbolo padrao sem nada em Marca; o enviado preenche o quadrado.
  const icone = tag(semLogo, "icon");
  assert.match(icone, /^<img/);
  assert.match(icone, /alt="Bunker707"/);
  assert.match(icone, /src="\/brand\/icon-bunker\.svg"/);
  assert.match(icone, /class="size-6 shrink-0 rounded-\[6px\] lg:hidden object-contain"/, "24 px, so abaixo de lg");
  // A troca e no ponto da sala (lg, DESKTOP em live-room.tsx), nunca em sm: entre 640 e 1023 px o cabecalho ja tem o
  // "{n} assistindo" e Minimizar/Sair com texto, e os 125 px da logo cobririam os selos e zerariam o titulo.
  for (const html of [semLogo, comLogo]) {
    assert.doesNotMatch(tag(html, "logo"), /\bsm:flex\b/, "a logo nao entra em sm");
    assert.doesNotMatch(tag(html, "icon"), /\bsm:hidden\b/, "o icone nao sai em sm");
  }
  const enviado = tag(comMarca({ logoImage: LOGO, schoolIcon: ICONE }), "icon");
  assert.match(enviado, new RegExp(`src="${ICONE.replace(/[.]/g, "\\.")}"`));
  assert.match(enviado, /object-cover/);

  // Sem link: sair da live passa pela confirmacao (askToLeave), nunca por um clique na logo.
  for (const html of [semLogo, comLogo]) {
    assert.doesNotMatch(html, /<a\b/);
  }
  // A marca vem antes do selo e do titulo; o titulo continua encolhendo.
  assert.ok(comLogo.indexOf('data-room-brand="logo"') < comLogo.indexOf("<h1"));
  assert.match(comLogo, /<h1 class="min-w-0 truncate/);

  // Live ao vivo: no celular, so o icone e "00:42:10" (a frase inteira no title e para o leitor de tela).
  const aoVivo = comMarca({ logoImage: null }, { kind: "live", liveLabel: "Ao vivo · 00:42:10", liveTime: "00:42:10", showLiveBadge: true });
  assert.match(aoVivo, /title="Ao vivo · 00:42:10"/);
  assert.match(aoVivo, /<span class="hidden sm:inline">Ao vivo · 00:42:10<\/span>/, "no computador, a frase inteira");
  assert.match(aoVivo, /<span aria-hidden="true" class="sm:hidden">00:42:10<\/span>/, "no celular, so o tempo");
  assert.match(aoVivo, /<span class="sr-only sm:hidden">Ao vivo · 00:42:10<\/span>/, "e o leitor de tela ouve a frase");
});

test("palco: espera com a contagem, no ar com o iframe da Bunny coberto e Ativar som, encerrada com Assistir de novo; os atributos do sinal de midia", () => {
  const base = { countdownLabel: "4 min", coverUrl: null, embedUrl: EMBED, iframeRef: noop, minimized: false, muted: true, onUnmute: noop, replayHref: null, sessionId: "s1", state: "waiting", title: "Aula de IA" };
  const waiting = render(stage.RoomStage, base);
  assert.match(waiting, /Começa em 4 min/);
  assert.doesNotMatch(waiting, /<iframe/, "antes do zero o player nao monta");
  assert.match(waiting, /data-lesson-player-stage/);
  assert.match(waiting, /data-lesson-id="webinar:s1"/);
  assert.doesNotMatch(waiting, /data-lesson-player-kind/, "sem player, sem ponte");

  const live = render(stage.RoomStage, { ...base, state: "live" });
  assert.match(live, /<iframe[^>]+src="https:\/\/iframe\.mediadelivery\.net\/embed\/12345\/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc\?autoplay=true&amp;muted=true&amp;controls=false"/);
  assert.match(live, /data-lesson-player-kind="iframe"/);
  assert.match(live, /data-lesson-player-bridge=""/);
  assert.match(live, /data-room-lock/, "a capa que cobre o player travado");
  assert.match(live, /Ativar som/);
  assert.doesNotMatch(live, /allowfullscreen/i, "sem tela cheia na gravada");
  assert.match(live, /aspect-video w-full/, "a 375 px o palco ocupa a largura");

  const unmuted = render(stage.RoomStage, { ...base, muted: false, state: "live" });
  assert.doesNotMatch(unmuted, /Ativar som/);

  const replay = render(stage.RoomStage, { ...base, muted: false, state: "replay" });
  assert.doesNotMatch(replay, /data-room-lock/, "o replay e livre");
  assert.match(replay, /allowfullscreen/i);

  const ended = render(stage.RoomStage, { ...base, replayHref: "/webinarios/aula/sala?sessao=r1", state: "ended" });
  assert.match(ended, /Essa live acabou\./);
  assert.match(ended, /href="\/webinarios\/aula\/sala\?sessao=r1"/);
  assert.match(ended, /Assistir de novo/);
  const endedNoReplay = render(stage.RoomStage, { ...base, state: "ended" });
  assert.match(endedNoReplay, /O replay fica pronto em algumas horas\./);
  assert.doesNotMatch(endedNoReplay, /Assistir de novo/);

  const noVideo = render(stage.RoomStage, { ...base, embedUrl: null, state: "live" });
  assert.match(noVideo, /ainda não está disponível/);
});

test("chat: os selos, a pendente, a fixada, a lista em role=log; compositor desligado, so a equipe, modo lento e encerrada; Remover minhas mensagens no menu", () => {
  const base = {
    chatMode: "open",
    consented: true,
    defaultDisplayMode: "first_name_initial",
    displayName: "Ana S.",
    error: null,
    messages: [msg("1", { displayName: "Bia C." }), msg("2", { displayName: "Equipe", role: "team" }), msg("3", { displayName: "Danilo", role: "host" }), msg("4", { displayName: "Assistente", role: "ai" }), msg("5", { mine: true, pending: true })],
    nowMs: T0,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: msg("p", { displayName: "Equipe", pinned: true, role: "team", body: "link da apostila" }),
    readOnly: false,
    slowUntilMs: null
  };
  const html = render(chat.RoomChatPanel, base);
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="off"/, "em lista cheia o leitor de tela ouve so a contagem");
  assert.match(html, />Equipe</);
  assert.match(html, />Apresentador</);
  assert.match(html, />Assistente</);
  assert.match(html, /Aguardando a equipe/);
  assert.match(html, /Fixada pela equipe/);
  assert.match(html, /link da apostila/);
  assert.match(html, /aria-haspopup="menu"[^>]*aria-label="Mais opções"/, "o menu ... (Remover minhas mensagens abre nele)");
  assert.match(html, /aria-label="Escreva uma mensagem"/);
  assert.match(html, new RegExp(`maxlength="${CHAT_LIMITS.body}"`, "i"));
  assert.match(html, /min-h-11/, "o campo tem 44 px");

  const off = render(chat.RoomChatPanel, { ...base, chatMode: "off" });
  assert.match(off, /O chat está desligado nesta sessão\./);
  assert.match(off, /<textarea[^>]+disabled/);
  const teamOnly = render(chat.RoomChatPanel, { ...base, chatMode: "team_only" });
  assert.match(teamOnly, /Só a equipe escreve agora\./);
  const slow = render(chat.RoomChatPanel, { ...base, slowUntilMs: T0 + 12_000 });
  assert.match(slow, /Você pode enviar de novo em 12 s/);
  const ended = render(chat.RoomChatPanel, { ...base, phase: "ended" });
  assert.match(ended, /Essa live acabou\./);
  const readOnly = render(chat.RoomChatPanel, { ...base, readOnly: true });
  assert.match(readOnly, /No modo de visualização, nada é gravado\./);
  const empty = render(chat.RoomChatPanel, { ...base, messages: [], pinned: null });
  assert.match(empty, /Ainda não há mensagens\./);
  assert.match(empty, /aria-live="polite"/, "com uma mensagem por vez, cada uma e lida");
});

test("o aceite (§8.5): o texto palavra por palavra, como o nome aparece, Entendi e quero participar e Participar como anonimo", () => {
  const html = render(chat.RoomConsentBox, { defaultDisplayMode: "first_name_initial", onAccept: noop, onCancel: noop });
  assert.ok(html.includes(WEBINAR_COPY.sala.consentimento));
  assert.match(html, /Entendi e quero participar/);
  assert.match(html, /Participar como anônimo/);
  assert.match(html, /Como você aparece no chat/);
  assert.match(html, /Primeiro nome e inicial/);
  assert.match(html, /Apelido/);
  assert.match(html, /role="group"/);
  assert.equal(
    WEBINAR_COPY.sala.consentimento,
    "Ao enviar mensagens neste chat, você autoriza que o seu primeiro nome e o texto da mensagem apareçam para os outros alunos durante esta sessão e nas reexibições dela. Você pode remover as suas mensagens a qualquer momento em Perfil › Privacidade."
  );
});

test("reacoes: seis botoes de 44 px com nome acessivel, as bolhas nunca anunciadas, o contador do excesso", () => {
  const bar = render(reactions.RoomReactionBar, { disabled: false, onReact: noop });
  for (const reaction of REACTIONS) {
    assert.match(bar, new RegExp(`aria-label="${WEBINAR_COPY.sala.reacoes[reaction]}"`), reaction);
  }
  assert.equal((bar.match(/size-11/g) ?? []).length, 6, "44 px cada");
  assert.match(bar, /role="group"/);
  const bubbles = render(reactions.RoomReactionBubbles, { bubbles: [{ id: 1, reaction: "fire", until: T0 }], overflow: 5 });
  assert.match(bubbles, /aria-hidden="true"/);
  assert.match(bubbles, /motion-reduce:opacity-80/, "com prefers-reduced-motion a reacao fica parada");
  assert.match(bubbles, /\+5/);
});

function payload(extra = {}, sessionExtra = {}) {
  return {
    me: { calendarUrl: null, consented: false, displayMode: null, displayName: null, nickname: null, registered: false, registeredAt: null },
    pinned: null,
    polls: [],
    presentNow: 2,
    registeredCount: null,
    serverTime: new Date(T0).toISOString(),
    session: {
      chatMode: "open",
      chatSlowModeSeconds: null,
      durationMs: 60 * MIN,
      endedAt: null,
      id: "cccccccc-0000-4000-8000-000000000002",
      join: { ok: true },
      kind: "simulated",
      lateJoinMinutes: null,
      offsetMs: 120_000,
      phase: "waiting",
      roomPhase: "live",
      scheduledAt: new Date(T0 - 2 * MIN).toISOString(),
      showLiveBadge: true,
      startedAt: null,
      status: "scheduled",
      ...sessionExtra
    },
    video: { embedUrl: EMBED, expires: null, libraryId: "12345", provider: "bunny", videoId: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc" },
    webinar: { durationMinutes: 60, id: "cccccccc-0000-4000-8000-000000000001", kind: "simulated", replaySessionId: "cccccccc-0000-4000-8000-000000000004", slug: "aula-de-ia", title: "Aula de IA" },
    ...extra
  };
}

test("a sala inteira: dialogo aria-modal com o titulo, as abas Chat e Perguntas (Enquetes so com enquete), no ar / espera / encerrada pelo relogio do servidor, 375 px", () => {
  const live = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  assert.match(live, /role="dialog"/);
  assert.match(live, /aria-modal="true"/);
  assert.match(live, /aria-label="Aula de IA"/);
  assert.match(live, /data-room-phase="live"/);
  assert.match(live, /role="tablist"/);
  assert.match(live, /role="tab"[^>]*>Chat</);
  assert.match(live, /role="tab"[^>]*>Perguntas</);
  assert.doesNotMatch(live, />Enquetes</, "sem enquete aberta, sem a aba");
  assert.match(live, /2 assistindo/);
  assert.match(live, /Ao vivo/);
  assert.match(live, /<iframe[^>]+mediadelivery/);
  assert.match(live, /Ativar som/);
  assert.match(live, /fixed inset-0 flex flex-col/, "tela cheia por cima da area");
  assert.match(live, /lg:w-\[360px\]/, "o painel a direita no computador");
  assert.match(live, /aspect-video w-full/, "o palco na largura a 375 px");
  assert.match(live, /data-testid="room-pill"/.test(live) ? /nada/ : /room-panel/, "a pilula so ao minimizar");

  const waiting = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() }), readOnly: false, webinarHref: "/x" });
  assert.match(waiting, /data-room-phase="waiting"/);
  assert.match(waiting, /Começa em 4 min/);
  assert.doesNotMatch(waiting, /<iframe/);

  const ended = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { roomPhase: "ended", status: "ended" }), readOnly: false, webinarHref: "/x" });
  assert.match(ended, /data-room-phase="ended"/);
  assert.match(ended, /Essa live acabou\./);
  assert.match(ended, /href="\/webinarios\/aula-de-ia\/sala\?sessao=cccccccc-0000-4000-8000-000000000004"/, "Assistir de novo abre o replay");

  const withPoll = render(room.WebinarRoom, {
    coverUrl: null,
    payload: payload({ polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }),
    readOnly: false,
    webinarHref: "/x"
  });
  assert.match(withPoll, />Enquetes</);
  assert.match(withPoll, /Gostou\?/, "o card da enquete por cima do chat");

  const replay = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { kind: "replay", offsetMs: null, roomPhase: null }), readOnly: false, webinarHref: "/x" });
  assert.match(replay, /data-room-phase="replay"/);
  assert.match(replay, /Chat da live/);
  assert.doesNotMatch(replay, /Ativar som/, "o replay tem a barra do player");

  const preview = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: true, webinarHref: "/x" });
  assert.match(preview, /No modo de visualização, nada é gravado\./);
});

test("Entrar e Assistir o replay na pagina da live: link para a sala dentro da janela, a frase fora dela, em breve na Live ao vivo sem a sala neste ambiente (liveRoomConfigured falso) e sem replay", () => {
  const session = { id: "s1", kind: "simulated", lateJoinMinutes: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "scheduled" };
  const within = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 5 * MIN, session, slug: "aula-de-ia" });
  assert.match(within, /href="\/webinarios\/aula-de-ia\/sala\?sessao=s1"/);
  assert.match(within, /Entrar/);
  const early = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 - 30 * MIN, session, slug: "aula-de-ia" });
  assert.match(early, /Essa sessão ainda não abriu\./);
  assert.doesNotMatch(early, /href=/);
  const late = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 20 * MIN, session: { ...session, lateJoinMinutes: 10 }, slug: "aula-de-ia" });
  assert.match(late, /já passou da hora de entrar/);
  const over = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 61 * MIN, session, slug: "aula-de-ia" });
  assert.match(over, /Essa live acabou\./);
  const live = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + MIN, session: { ...session, kind: "live", status: "live" }, slug: "aula-de-ia" });
  assert.match(live, /em breve/, "a sala ao vivo e da fase 3");
  assert.match(live, /disabled/);

  const replay = render(enter.WebinarReplayButton, { replaySessionId: "r1", slug: "aula-de-ia" });
  assert.match(replay, /href="\/webinarios\/aula-de-ia\/sala\?sessao=r1"/);
  assert.match(replay, /Assistir o replay/);
  const none = render(enter.WebinarReplayButton, { replaySessionId: null, slug: "aula-de-ia" });
  assert.match(none, /em breve/);
  assert.match(none, /disabled/);
});

test("Perfil › Privacidade › Chat das lives: o texto e o botao Remover minhas mensagens; na previa da equipe, desligado", () => {
  const html = render(privacy.WebinarChatPrivacy, {});
  assert.match(html, /Chat das lives/);
  assert.ok(html.includes(WEBINAR_COPY.privacidade.texto));
  assert.match(html, /Remover minhas mensagens/);
  assert.doesNotMatch(html, /Remover de todas as lives\?/, "a confirmacao so depois do clique");
  const preview = render(privacy.WebinarChatPrivacy, { readOnly: true });
  assert.match(preview, /<button[^>]+disabled/);
});
