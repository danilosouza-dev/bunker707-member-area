import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala Live vertical 9:16 desenhada (docs/30 §1.6, §6.6, §1.7, §8.5 e §9; docs/18 §2.2): a sala inteira no desenho do
// celular em pe, no Node, sem navegador. Os tres pontos de encaixe da fase 4 que a sala usa viram dubles so para
// webinar-room.tsx: a Simulacao (o contador soma 120 ao real, "Ana M. entrou" e um aviso de venda no segundo da sala),
// a traducao (devolve mensagens JA traduzidas, diferentes das que a sala revelou: o chat por cima tem de mostrar as do
// hook) e o card da Oferta (marca o desenho que recebeu). Confere: o selo e o contador somado no topo, o chat por cima
// com as traduzidas, a entrada simulada no chat, o aviso de venda e a pilula nos lugares do vertical, o compositor
// compacto com o mesmo campo, os botoes de 44 px, o dialogo e o leitor de tela, nada passando de 375 px e nenhuma frase
// citando o motor de video. Depois as pecas sozinhas: o chat por cima, o compositor (o mesmo aceite de §8.5), a doca e
// a gaveta.

const ROOM_DIR = new URL("../src/components/member/webinars/room/", import.meta.url).href;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const MIN = 60_000;
/** O segundo da sala no desenho de teste: 2 min depois do zero (a sessao comecou as T0 - 2 min). */
const OFFSET = 120_000;

const STUBS = {
  "./room-offer": `import { createElement } from "react";
export function RoomOffer(props) {
  return createElement("div", { "data-stub-offer": props.layout, "data-stub-offer-enabled": String(props.enabled), "data-stub-offer-readonly": String(props.readOnly) });
}`,
  "./use-room-simulation": `export function useRoomSimulation(input) {
  if (!input.enabled) {
    return { displayCount: (real) => real, enabled: false, joins: [], saleNotices: [] };
  }
  return {
    displayCount: (real) => real + 120,
    enabled: true,
    joins: [{ atMs: ${OFFSET - 3000}, name: "Ana M." }],
    saleNotices: [{ atMs: ${OFFSET - 1000}, text: "Carlos acabou de garantir a vaga" }]
  };
}`,
  "./use-room-translation": `export function useRoomTranslation(input) {
  globalThis.__traducaoRecebeu = input.messages.length;
  const base = { kind: "message", mine: false, pending: false, pinned: false, replyToId: null };
  return {
    language: "en",
    messages: [
      { ...base, body: "EN: welcome everyone", displayName: "Danilo", id: "t1", offsetMs: 1000, role: "host" },
      { ...base, body: "EN: the link is in the pinned message", displayName: "Equipe", id: "t2", offsetMs: 2000, role: "team" }
    ]
  };
}`
};

// Os dubles so valem para os imports de webinar-room.tsx (o resto da sala carrega os modulos de verdade).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier] && context.parentURL === `${ROOM_DIR}webinar-room.tsx`) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }
    return nextResolve(specifier, context);
  }
});

const room = await import("../src/components/member/webinars/room/webinar-room.tsx");
const verticalChat = await import("../src/components/member/webinars/room/vertical/vertical-chat.tsx");
const verticalComposer = await import("../src/components/member/webinars/room/vertical/vertical-composer.tsx");
const dock = await import("../src/components/member/webinars/room/vertical/room-dock.tsx");
const drawer = await import("../src/components/member/webinars/room/vertical/vertical-drawer.tsx");
const topBar = await import("../src/components/member/webinars/room/vertical/vertical-top-bar.tsx");
const offerView = await import("../src/components/member/webinars/room/offer/offer-card-view.tsx");
const { RoomConsentBox } = await import("../src/components/member/webinars/room/room-chat.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { CHAT_LIMITS } = await import("../src/server/webinars/model.ts");

const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const noop = () => undefined;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

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
      offsetMs: OFFSET,
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

const sala = (design, { extra = {}, readOnly = false, sessionExtra = {} } = {}) =>
  render(room.WebinarRoom, { coverUrl: null, design, payload: payload(extra, sessionExtra), readOnly, webinarHref: "/webinarios/aula-de-ia" });

const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** O HTML do primeiro elemento com `attribute` (ele e tudo dentro). */
function elementWith(html, attribute) {
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  let depth = 0;
  let start = -1;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    const [whole, closing, name, attrs, selfClosing] = match;
    const isVoid = Boolean(selfClosing) || VOID.has(name.toLowerCase());
    if (start < 0) {
      if (!closing && attrs.includes(attribute)) {
        if (isVoid) {
          return whole;
        }
        start = match.index;
        depth = 1;
      }
      continue;
    }
    if (closing) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, match.index + whole.length);
      }
    } else if (!isVoid) {
      depth += 1;
    }
  }
  return "";
}

/** O texto que a pessoa le (sem as tags, sem os atributos, sem o CSS embutido). */
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

test("o desenho vertical: dialogo de tela cheia, o selo Ao vivo e o contador SOMADO no topo, so o Sair com 44 px (sem Minimizar, V2-2)", () => {
  const html = sala("vertical");
  assert.match(html, /^<div aria-label="Aula de IA" aria-modal="true" class="[^"]*fixed inset-0[^"]*overflow-hidden[^"]*" data-room-design="vertical" data-room-phase="live" data-room-theme="dark" role="dialog"/, "sempre escuro (V2-12): o vertical fica sobre o video");
  const top = elementWith(html, "data-room-vertical-top");
  assert.match(top, /data-room-vertical-badge="live">Ao vivo · /, "o selo Ao vivo com o tempo no ar (a decisao da equipe, D10)");
  assert.match(top, /data-testid="room-present"[\s\S]*122 assistindo/, "o real (2) mais a parte simulada (120) daquele instante");
  assert.match(top, /<h1[^>]*>Aula de IA<\/h1>/);
  assert.doesNotMatch(html, /Minimizar|room-pill|data-room-minimized/, "sem Minimizar e sem pilula");
  assert.equal(top.match(/<button[^>]*>/g)?.length, 1, "o topo tem um botao so");
  assert.match(top, /<button aria-label="Sair" class="[^"]*size-11/);
  assert.doesNotMatch(html, /role="tablist"/, "sem o painel de abas do desenho normal");
  assert.doesNotMatch(html, /lg:w-\[360px\]/);
  assert.doesNotMatch(html, /<header class="flex h-12/, "sem o cabecalho do desenho normal");
});

test("o selo pela regra do cabecalho: sem a decisao, Sessao das 19:58 com o contador; na espera a contagem no meio; encerrada sem contador; Replay com a dica de girar", () => {
  const plain = elementWith(sala("vertical", { sessionExtra: { showLiveBadge: false } }), "data-room-vertical-top");
  assert.match(plain, /data-room-vertical-badge="session">Sessão das 19:58 · /);
  assert.doesNotMatch(plain, /Ao vivo/);
  assert.match(plain, /122 assistindo/);

  const waiting = sala("vertical", { sessionExtra: { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() } });
  assert.match(waiting, /data-room-phase="waiting"/);
  assert.match(elementWith(waiting, "data-room-vertical-top"), /data-room-vertical-badge="session">Sessão das 20:04<\/span>/, "na espera, sem tempo no ar");
  assert.match(waiting, /Começa em 4 min/, "a contagem no palco, no meio da tela");
  assert.doesNotMatch(waiting, /<iframe/);

  const ended = sala("vertical", { sessionExtra: { roomPhase: "ended", status: "ended" } });
  assert.doesNotMatch(ended, /assistindo/, "encerrada, sem contador");
  assert.match(ended, /Essa live acabou\./);
  assert.match(ended, /Assistir de novo/);
  assert.match(elementWith(ended, "data-room-vertical-composer"), /<input[^>]*disabled=""/, "nada a escrever depois do fim");

  const replay = sala("vertical", { sessionExtra: { kind: "replay", offsetMs: null, roomPhase: null } });
  const replayTop = elementWith(replay, "data-room-vertical-top");
  assert.match(replayTop, />Replay</);
  assert.doesNotMatch(replayTop, /assistindo/, "o replay nao tem contador");
  assert.match(replayTop, /Gire o celular para ver a sala completa\./, "a barra do player inteira com o celular deitado");
  assert.match(elementWith(replay, 'role="log"'), /aria-label="Chat da live"/);
  assert.doesNotMatch(replay, /data-room-simulation-sale/, "o replay nunca simula");
});

test("o chat por cima mostra as mensagens que a traducao devolveu (nunca as reveladas direto), com os selos e o leitor de tela", () => {
  globalThis.__traducaoRecebeu = undefined;
  const html = sala("vertical");
  assert.equal(globalThis.__traducaoRecebeu, 0, "o hook recebeu as reveladas (vazias no servidor)");
  const chat = elementWith(html, "data-room-vertical-chat");
  const log = elementWith(chat, 'role="log"');
  assert.match(log, /aria-label="Chat"/);
  assert.match(log, /EN: welcome everyone/);
  assert.match(log, /EN: the link is in the pinned message/);
  assert.match(log, /<span class="sr-only">Apresentador: <\/span>/, "o prefixo do papel para o leitor de tela");
  assert.match(log, />Equipe</);
  assert.match(chat, /<p aria-live="polite" class="sr-only" data-room-vertical-announce="">/, "aria-live polite no chat");
  assert.match(chat, /data-room-simulation-join="entrou"[\s\S]*Ana M\. entrou/, "a entrada simulada no chat");
  assert.match(chat, /\[text-shadow:/, "o texto com sombra sobre o degrade");
  const dockHtml = elementWith(html, 'data-room-slot="dock"');
  assert.match(dockHtml, /^<div aria-label="Sala no celular em pé" class="[^"]*bg-gradient-to-t from-black\/90[^"]*" data-room-slot="dock" role="group"/, "o degrade para leitura sobre o video");

  // O mesmo hook vale no desenho normal (o painel do chat mostra as traduzidas tambem).
  const normal = sala("normal");
  assert.match(elementWith(normal, 'data-testid="room-chat"'), /EN: welcome everyone/);
  assert.match(normal, /122 assistindo/, "o contador somado no cabecalho normal");
});

test("os lugares do vertical: o aviso de venda no topo (abaixo da barra), a pilula da Oferta acima do campo, as bolhas a direita", () => {
  const html = sala("vertical");
  const sales = elementWith(html, 'data-room-slot="sales"');
  assert.match(sales, /^<div class="pointer-events-none absolute inset-x-0 top-\[env\(safe-area-inset-top\)\] h-28 z-30" data-room-slot="sales">/);
  assert.match(sales, /data-room-simulation-sale=""/);
  assert.match(sales, /inset-x-0 top-14 mx-auto w-fit/, "o toast no desenho vertical");
  assert.match(sales, /Carlos acabou de garantir a vaga/);
  assert.match(sales, /aria-live="polite"/, "o leitor de tela ouve o aviso pela regiao polite");

  const offer = elementWith(html, 'data-room-slot="offer"');
  assert.match(offer, /data-stub-offer="vertical" data-stub-offer-enabled="true" data-stub-offer-readonly="false"/, "a pilula (layout vertical) no lugar da oferta");
  const dockHtml = elementWith(html, 'data-room-slot="dock"');
  assert.ok(dockHtml.indexOf('data-room-slot="offer"') < dockHtml.indexOf("data-room-vertical-composer"), "a pilula acima do campo");
  assert.ok(dockHtml.indexOf("data-room-vertical-chat") < dockHtml.indexOf('data-room-slot="offer"'), "e abaixo das mensagens");

  assert.match(elementWith(html, 'data-room-slot="bubbles"'), /absolute bottom-\[46%\] right-0[\s\S]*data-testid="room-reactions"/);
  assert.match(elementWith(html, 'data-room-slot="bubbles"'), /class="pointer-events-none absolute right-3 [^"]*bottom-3" data-testid="room-reactions"/, "no vertical as bolhas continuam onde eram (no palco elas sobem acima dos selos)");

  // No desenho normal, os mesmos componentes com o desenho do palco.
  const normal = sala("normal");
  assert.match(normal, /data-stub-offer="stage"/);
  assert.match(elementWith(normal, 'data-room-slot="sales"'), /left-4 top-14/, "abaixo dos selos de cima do palco (docs/31 V2-4)");
  assert.match(elementWith(normal, 'data-room-slot="offer"'), /^<div class="contents" data-room-slot="offer">/);

  // No "ver como" a equipe ve o card como o aluno, sem gravar clique (RoomOffer com readOnly).
  assert.match(sala("vertical", { readOnly: true }), /data-stub-offer="vertical" data-stub-offer-enabled="true" data-stub-offer-readonly="true"/);
});

test("o compositor compacto: o mesmo campo (Escreva uma mensagem, limite do chat), Comente…, Enviar, Fechar o chat, Reagir e a gaveta com 44 px", () => {
  const html = sala("vertical");
  const composer = elementWith(html, "data-room-vertical-composer");
  assert.match(composer, /<input aria-label="Escreva uma mensagem"[^>]*class="h-11 [^"]*text-base[^"]*"/, "16 px: o iPhone nao amplia a pagina");
  assert.match(composer, new RegExp(`maxLength="${CHAT_LIMITS.body}"`, "i"));
  assert.match(composer, /placeholder="Comente…"/);
  assert.match(composer, /enterKeyHint="send"/i);
  for (const label of ["Fechar o chat", "Enviar", "Reagir", "Perguntas e enquetes"]) {
    assert.match(composer, new RegExp(`<button[^>]*aria-label="${label}"[^>]*class="[^"]*size-11`), label);
  }
  assert.match(composer, /aria-expanded="false" aria-label="Reagir"/);
  assert.match(composer, /aria-expanded="false" aria-label="Perguntas e enquetes"/);
  assert.match(composer, /data-room-first-focus=""/, "o foco entra pelo chat, como a aba Chat no desenho normal");
  assert.doesNotMatch(composer, /data-testid="room-consent"/, "o aceite so abre ao enviar a primeira");

  const preview = elementWith(sala("vertical", { readOnly: true }), "data-room-vertical-composer");
  assert.match(preview, /No modo de visualização, nada é gravado\./);
  assert.match(preview, /<input[^>]*disabled=""/);

  const off = elementWith(sala("vertical", { sessionExtra: { chatMode: "off" } }), "data-room-vertical-composer");
  assert.match(off, /placeholder="O chat está desligado nesta sessão\."/);
  assert.match(off, /<p aria-live="polite" class="min-w-0 px-1 text-xs text-zinc-200">O chat está desligado nesta sessão\.<\/p>/);
});

test("375 px e 44 px: todo botao tem 44 px, nada com largura fixa maior que a tela, nenhuma frase cita o motor de video", () => {
  for (const html of [sala("vertical"), sala("vertical", { sessionExtra: { kind: "replay", offsetMs: null, roomPhase: null } })]) {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    // Sem Minimizar desde o V2-2: um botao a menos no topo.
    assert.ok(buttons.length >= 5, `achou os botoes (${buttons.length})`);
    for (const button of buttons) {
      assert.match(button, /\b(size-11|h-11|min-h-11|h-12)\b/, `44 px: ${button.slice(0, 120)}`);
    }
    assert.doesNotMatch(html, /\bmin-w-\[/, "nenhuma largura minima fixa");
    for (const width of html.matchAll(/\bw-\[(\d+)px\]/g)) {
      assert.ok(Number(width[1]) <= 375, `largura fixa ${width[0]}`);
    }
    assert.doesNotMatch(textOf(html), /bunny|vimeo|mux|jitsi|mediadelivery/i, "nenhuma frase cita o motor de video");
  }
});

test("a enquete aberta vira um botao no chat por cima (abre a gaveta em Enquetes); a fixada numa linha com o rotulo do leitor de tela", () => {
  const html = sala("vertical", {
    extra: {
      pinned: msg("p", { body: "link da apostila", displayName: "Equipe", pinned: true, role: "team" }),
      polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }]
    }
  });
  const chat = elementWith(html, "data-room-vertical-chat");
  assert.match(chat, /<button class="[^"]*min-h-11[^"]*"[^>]*>[\s\S]*<span class="sr-only">Enquetes: <\/span><span class="truncate">Gostou\?<\/span>/);
  assert.match(chat, /data-testid="room-pinned"[\s\S]*<span class="sr-only">Fixada pela equipe: <\/span>[\s\S]*link da apostila/);
});

/* ------------------------------------------------------------------------------------------------
 * As pecas sozinhas
 * ---------------------------------------------------------------------------------------------- */

test("chat por cima: so as ultimas 6 e Ver mais mensagens (44 px); vazio fica vazio; a falha aparece", () => {
  const base = { error: null, joins: null, onMore: noop, onOpenPoll: noop, openPollQuestion: null, pinned: null, replay: false };
  const many = Array.from({ length: 9 }, (_, index) => msg(String(index + 1)));
  const html = render(verticalChat.VerticalChat, { ...base, messages: many });
  assert.equal((html.match(/data-room-message=/g) ?? []).length, 6);
  assert.doesNotMatch(html, /data-room-message="3"/);
  assert.match(html, /data-room-message="9"/);
  assert.match(html, /<button class="[^"]*min-h-11[^"]*"[^>]*>[\s\S]*Ver mais mensagens<\/button>/);
  assert.match(elementWith(html, 'role="log"'), /^<ol[^>]*tabindex="0"/, "a lista entra pelo Tab (as setas rolam)");

  const few = render(verticalChat.VerticalChat, { ...base, messages: [msg("1")] });
  assert.doesNotMatch(few, /Ver mais mensagens/);
  const empty = render(verticalChat.VerticalChat, { ...base, messages: [] });
  assert.doesNotMatch(empty, /<li/, "por cima do video, nada de lista vazia");
  const failed = render(verticalChat.VerticalChat, { ...base, error: "O chat não carregou. Tente de novo.", messages: [] });
  assert.match(failed, /O chat não carregou\. Tente de novo\./);
});

test("compositor: Abrir o chat quando fechado (sem campo), o modo lento com a contagem, so a equipe, a gaveta aberta", () => {
  const base = {
    chatMode: "open",
    chatOpen: true,
    consented: true,
    defaultDisplayMode: "first_name_initial",
    drawerId: "gaveta",
    drawerOpen: false,
    nowMs: T0,
    onOpenDrawer: noop,
    onReact: noop,
    onSend: async () => ({ pending: false }),
    onToggleChat: noop,
    phase: "live",
    reactionsDisabled: false,
    readOnly: false,
    slowUntilMs: null
  };
  const closed = render(verticalComposer.VerticalComposer, { ...base, chatOpen: false });
  assert.match(closed, /aria-label="Abrir o chat"/);
  assert.doesNotMatch(closed, /<input/, "chat fechado: so o video");
  assert.match(closed, /aria-label="Reagir"/);
  const slow = render(verticalComposer.VerticalComposer, { ...base, slowUntilMs: T0 + 12_000 });
  assert.match(slow, /Você pode enviar de novo em 12 s/);
  assert.match(slow, /<input[^>]*disabled=""/);
  const team = render(verticalComposer.VerticalComposer, { ...base, chatMode: "team_only" });
  assert.match(team, /Só a equipe escreve agora\./);
  const open = render(verticalComposer.VerticalComposer, { ...base, drawerOpen: true });
  assert.match(open, /aria-controls="gaveta" aria-expanded="true" aria-label="Perguntas e enquetes"/);
});

test("o aceite da primeira mensagem e o MESMO do chat da sala (o texto de §8.5 e os dois botoes) e o envio e o da sala", () => {
  const source = readFileSync(new URL("../src/components/member/webinars/room/vertical/vertical-composer.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ RoomConsentBox \} from "\.\.\/room-chat";/, "o componente do aceite e o da sala");
  assert.match(source, /consent: true,\s*consentVersion: CHAT_CONSENT_VERSION,/, "o envio leva o aceite e a versao, como no chat da sala");
  assert.match(source, /if \(!consented\) \{\s*setConsentOpen\(true\);/, "sem o aceite, a primeira abre o aceite");
  const roomSource = readFileSync(new URL("../src/components/member/webinars/room/webinar-room.tsx", import.meta.url), "utf8");
  assert.equal((roomSource.match(/onSend=\{sendChat\}/g) ?? []).length, 2, "o painel do chat e o compositor compacto usam o mesmo envio");
  assert.match(roomSource, /const answer = await chat\.send\(/);
  const box = render(RoomConsentBox, { defaultDisplayMode: "first_name_initial", onAccept: noop, onCancel: noop });
  assert.ok(box.includes(WEBINAR_COPY.sala.consentimento));
  assert.match(box, /Entendi e quero participar/);
  assert.match(box, /Participar como anônimo/);
});

test("a doca: no normal as caixas nao geram caixa (contents); no vertical o grupo com o degrade e a pilula de verdade a direita", () => {
  const offer = createElement(offerView.OfferPill, {
    busy: false,
    countdown: "12:34",
    ended: false,
    error: null,
    fallbackUrl: null,
    onBuy: noop,
    onClose: noop,
    onToggle: noop,
    open: false,
    readOnly: false,
    reducedMotion: false,
    view: { badge: "Só hoje", coupon: null, deadlineAt: null, headline: "Formação em IA", hideAtMs: null, imageUrl: null, offerId: "o1", priceFromLabel: null, priceLabel: "R$ 997", showAtMs: 0, variant: "A", visible: true }
  });
  const chatNode = createElement("p", null, "chat");
  const composerNode = createElement("p", null, "campo");
  const normal = render(dock.RoomDock, { chat: chatNode, composer: composerNode, design: "normal", hidden: false, offer });
  assert.match(normal, /^<div class="contents" data-room-slot="dock"><div class="contents" data-room-slot="offer">/);
  assert.doesNotMatch(normal, />chat<|>campo</, "o chat e o campo do vertical nao entram no normal");
  const vertical = render(dock.RoomDock, { chat: chatNode, composer: composerNode, design: "vertical", hidden: false, offer });
  assert.match(vertical, /role="group"/);
  assert.match(vertical, /<p>chat<\/p><div class="pointer-events-none flex min-w-0 justify-end \[&amp;&gt;\*\]:pointer-events-auto" data-room-slot="offer"><div class="relative" data-room-offer="vertical">/);
  assert.match(vertical, /data-room-offer-pill=""[\s\S]*Só hoje[\s\S]*12:34/);
  assert.match(vertical, /<p>campo<\/p><\/div>$/);
  assert.match(render(dock.RoomDock, { chat: null, composer: null, design: "vertical", hidden: true, offer: null }), /^<div[^>]*class="[^"]*\bhidden\b/, "com a gaveta aberta a doca some");
  assert.match(render(dock.RoomDock, { chat: null, composer: null, design: "normal", hidden: true, offer: null }), /^<div class="hidden" data-room-slot="dock">/, "escondida, tambem no normal");
});

test("a gaveta: as mesmas abas (Chat da live no replay), 44 px, Voltar para o video, o rodape de girar; sem animacao com prefers-reduced-motion", () => {
  const base = { children: createElement("p", null, "conteudo"), id: "gaveta", onClose: noop, onTab: noop, pollOpen: true, reducedMotion: false, replay: false, tab: "perguntas", tabs: ["chat", "perguntas", "enquetes"] };
  const html = render(drawer.VerticalDrawer, base);
  assert.match(html, /<section aria-label="Chat, perguntas e enquetes" class="[^"]*animate-in slide-in-from-bottom-6[^"]*"[^>]*id="gaveta"/);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.match(html, /aria-selected="true" class="relative h-11[^"]*"[^>]*role="tab"[^>]*>Perguntas/);
  assert.match(html, /<button aria-label="Voltar para o vídeo" class="grid size-11/);
  assert.match(html, /role="tabpanel"><p>conteudo<\/p>/);
  assert.match(html, /Gire o celular para ver a sala completa\./);
  assert.match(html, /data-room-drawer-scrim=""/, "tocar fora fecha");
  const calm = render(drawer.VerticalDrawer, { ...base, reducedMotion: true });
  assert.doesNotMatch(calm, /animate-in/, "prefers-reduced-motion: a gaveta aparece parada");
  const replay = render(drawer.VerticalDrawer, { ...base, replay: true, tab: "chat" });
  assert.match(replay, />Chat da live/);
});

test("o topo sozinho: so o Sair, de 44 px, e o titulo truncado a 375 px; so o botao recebe o toque", () => {
  const html = render(topBar.VerticalTopBar, { getOffsetMs: () => 2_530_000, kind: "simulated", onLeave: noop, phase: "live", presentNow: 1, showLiveBadge: true, timeLabel: "20:00", title: "Aula de IA com um titulo bem comprido" });
  assert.equal(html.match(/<button[^>]*>/g)?.length, 1, "sem Minimizar (V2-2)");
  assert.match(html, /<div class="pointer-events-auto flex shrink-0 items-center gap-1"><button aria-label="Sair" class="grid size-11 /);
  assert.match(html, /Ao vivo · <span class="tabular-nums">42:10<\/span>/);
  assert.match(html, /1 assistindo/);
  assert.match(html, /<header class="pointer-events-none/);
  assert.match(html, /<div class="pointer-events-auto flex shrink-0/);
  assert.match(html, /<h1 class="min-w-0 truncate/);
});

test("fora do Quem pode no meio da sessao (D41) com o foco na gaveta, numa aba ou no campo do chat: as pecas saem e o foco volta para a sala (o primeiro controle do topo), nunca fica no body", () => {
  const focados = [];
  const controle = (nome) => ({ focus: () => focados.push(nome) });
  const body = { nome: "body" };
  const campo = { nome: "campo da aba Perguntas" };
  const sair = controle("Sair da confirmacao");
  const sairDoTopo = controle("Sair do topo");
  const raiz = ({ dentro = [], primeiro = null, topo = sairDoTopo } = {}) => ({
    contains: (node) => dentro.includes(node),
    querySelector: (selector) => (selector === "[data-room-first-focus]" ? primeiro : selector === room.ROOM_FOCUSABLE ? topo : null)
  });

  // A gaveta (e o compositor com o botao dela) saiu com o foco no campo: o foco caiu no body e volta para o topo da sala,
  // onde o Esc ainda sai e o Tab continua preso.
  assert.equal(room.refocusRoom(raiz(), body), true);
  assert.deepEqual(focados, ["Sair do topo"]);
  // Com a confirmacao de saida aberta, o [data-room-first-focus] dela vem primeiro.
  assert.equal(room.refocusRoom(raiz({ primeiro: sair }), null), true, "sem elemento ativo tambem conta como fora");
  assert.deepEqual(focados.at(-1), "Sair da confirmacao");
  // O foco ainda dentro da sala: nada muda.
  assert.equal(room.refocusRoom(raiz({ dentro: [campo] }), campo), false);
  assert.equal(room.refocusRoom(null, body), false);
  assert.equal(room.refocusRoom(raiz({ topo: null }), body), false, "sem controle nenhum, nada a focar");
  assert.equal(focados.length, 2);

  // A sala chama a volta do foco no mesmo quadro em que fica indisponivel (antes da proxima tecla); sem Minimizar (V2-2)
  // a sala esta sempre aberta.
  const roomSource = readFileSync(new URL("../src/components/member/webinars/room/webinar-room.tsx", import.meta.url), "utf8");
  assert.match(roomSource, /useLayoutEffect\(\(\) => \{\s*if \(unavailable\) \{\s*refocusRoom\(rootRef\.current, document\.activeElement\);\s*\}\s*\}, \[unavailable\]\);/);
  assert.match(roomSource, /composer=\{\s*vertical && !unavailable \?/, "o compositor (com o botao da gaveta) sai com a sala indisponivel");
  assert.match(roomSource, /const drawerVisible = vertical && drawerOpen && !unavailable;/);
});
