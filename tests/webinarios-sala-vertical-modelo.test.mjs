import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala Live vertical 9:16, a decisao (docs/30 §1.6, §6.6, §1.7 e §9; docs/18 §2.2): quando a sala usa o desenho do
// celular em pe (retrato ate 767 px; deitado, tablet ou computador, o normal; forcado vence), a consulta seguida pelo
// matchMedia (com o addListener do Safari antigo e sem matchMedia no servidor), a primeira pintura sempre no desenho
// normal (o servidor nao sabe do aparelho: a hidratacao confere), e a transicao sem remontar o player: o palco fica
// no mesmo caminho da arvore (corpo > coluna > caixa) no normal, no vertical e minimizada, com o MESMO HTML; so as
// classes de fora mudam (o video em cover e so CSS). O selo e o contador pela regra do cabecalho, as ultimas
// mensagens do chat por cima, o anuncio do leitor de tela (uma lida com o papel, rajada em "N mensagens novas"), a
// frase do compositor e em que aba a gaveta abre.

const model = await import("../src/components/member/webinars/room/vertical/vertical-model.ts");
const orientation = await import("../src/components/member/webinars/room/use-room-orientation.ts");
const room = await import("../src/components/member/webinars/room/webinar-room.tsx");

const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

/** Um matchMedia falso: responde pela consulta e guarda quem ouve a mudanca. */
function fakeMatchMedia(matches, { legacy = false } = {}) {
  const queries = [];
  const listeners = new Set();
  const media = {
    get matches() {
      return state.matches;
    }
  };
  const state = { matches };
  if (legacy) {
    media.addListener = (listener) => listeners.add(listener);
    media.removeListener = (listener) => listeners.delete(listener);
  } else {
    media.addEventListener = (type, listener) => type === "change" && listeners.add(listener);
    media.removeEventListener = (type, listener) => type === "change" && listeners.delete(listener);
  }
  const matchMedia = (query) => {
    queries.push(query);
    return media;
  };
  return {
    flip(next) {
      state.matches = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
    matchMedia,
    queries
  };
}

test("o desenho: celular em pe (retrato ate 767 px) e vertical; deitado, tablet e computador, normal; o forcado vence", () => {
  assert.equal(model.VERTICAL_ROOM_QUERY, "(orientation: portrait) and (max-width: 767px)");
  assert.deepEqual([...model.ROOM_DESIGNS], ["normal", "vertical"]);
  assert.equal(model.roomDesignFor({ portraitPhone: true }), "vertical");
  assert.equal(model.roomDesignFor({ portraitPhone: false }), "normal");
  assert.equal(model.roomDesignFor({ forced: "normal", portraitPhone: true }), "normal", "a previa forca o normal no celular");
  assert.equal(model.roomDesignFor({ forced: "vertical", portraitPhone: false }), "vertical", "a previa forca o vertical no computador");
  assert.equal(model.roomDesignFor({ forced: null, portraitPhone: true }), "vertical");
  assert.equal(model.roomDesignFor({ forced: "outro", portraitPhone: false }), "normal", "valor estranho nao forca nada");
});

test("o teclado aberto na WebView (360x330 vira 'deitado'): com o campo da sala em foco a sala continua vertical", () => {
  // 360x640 em pe com o teclado aberto: a viewport fica uns 360x330 e a consulta deixa de casar.
  const teclado = fakeMatchMedia(false);
  const portraitPhone = model.readPortraitPhone(teclado.matchMedia);
  assert.equal(portraitPhone, false, "a consulta da viewport diz deitado");
  const campo = { tagName: "INPUT", type: "text" };
  const editing = model.isTextEntry(campo);
  assert.equal(model.roomDesignFor({ editing, portraitPhone, portraitScreen: true, previous: "vertical" }), "vertical", "o campo nao desmonta");
  assert.equal(model.roomDesignFor({ editing, portraitPhone, portraitScreen: null, previous: "vertical" }), "vertical", "sem screen.orientation (WebView antiga), trava tambem");
  assert.equal(model.roomDesignFor({ editing, portraitPhone, portraitScreen: false, previous: "vertical" }), "normal", "o aparelho girou de verdade: troca");
  assert.equal(model.roomDesignFor({ editing: false, portraitPhone, portraitScreen: true, previous: "vertical" }), "normal", "sem foco, vale a consulta");
  assert.equal(model.roomDesignFor({ editing, portraitPhone, portraitScreen: true, previous: "normal" }), "normal", "so segura o vertical; nunca vira vertical por digitar");
  assert.equal(model.roomDesignFor({ editing, forced: "normal", portraitPhone, portraitScreen: true, previous: "vertical" }), "normal", "o forcado vence");

  assert.equal(model.isTextEntry({ tagName: "TEXTAREA" }), true);
  assert.equal(model.isTextEntry({ tagName: "input", type: "" }), true);
  assert.equal(model.isTextEntry({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(model.isTextEntry({ tagName: "BUTTON" }), false);
  assert.equal(model.isTextEntry({ isContentEditable: true, tagName: "DIV" }), true);
  assert.equal(model.isTextEntry(null), false);
  assert.equal(model.readPortraitScreen({ orientation: { type: "portrait-primary" } }), true);
  assert.equal(model.readPortraitScreen({ orientation: { type: "landscape-secondary" } }), false);
  assert.equal(model.readPortraitScreen({}), null);
  assert.equal(model.readPortraitScreen(undefined), null);
});

test("a consulta: le pelo matchMedia com a consulta exata; sem matchMedia (servidor) ou com erro, o normal", () => {
  const portrait = fakeMatchMedia(true);
  assert.equal(model.readPortraitPhone(portrait.matchMedia), true);
  assert.deepEqual(portrait.queries, ["(orientation: portrait) and (max-width: 767px)"]);
  assert.equal(model.readPortraitPhone(fakeMatchMedia(false).matchMedia), false);
  assert.equal(model.readPortraitPhone(undefined), false);
  assert.equal(model.readPortraitPhone(null), false);
  assert.equal(
    model.readPortraitPhone(() => {
      throw new Error("sem matchMedia");
    }),
    false
  );
});

test("girar o aparelho: a mudanca chega pelo change (e pelo addListener do Safari antigo); desligar para de ouvir", () => {
  for (const legacy of [false, true]) {
    const fake = fakeMatchMedia(false, { legacy });
    let calls = 0;
    const stop = model.subscribePortraitPhone(fake.matchMedia, () => {
      calls += 1;
    });
    assert.equal(fake.listeners.size, 1, legacy ? "addListener" : "addEventListener");
    fake.flip(true);
    assert.equal(calls, 1);
    assert.equal(model.readPortraitPhone(fake.matchMedia), true, "em pe: vertical");
    fake.flip(false);
    assert.equal(calls, 2);
    assert.equal(model.readPortraitPhone(fake.matchMedia), false, "deitado: normal de novo");
    stop();
    assert.equal(fake.listeners.size, 0, "desligado");
    fake.flip(true);
    assert.equal(calls, 2);
  }
  const none = model.subscribePortraitPhone(undefined, () => assert.fail("nada a ouvir"));
  assert.equal(typeof none, "function");
  none();
  const broken = model.subscribePortraitPhone(() => {
    throw new Error("quebrou");
  }, () => undefined);
  broken();
});

test("a primeira pintura e do desenho normal mesmo no celular em pe (o servidor nao sabe do aparelho); forcado, o forcado", () => {
  const fake = fakeMatchMedia(true);
  const previous = globalThis.window;
  globalThis.window = { matchMedia: fake.matchMedia };
  try {
    const Probe = ({ forced }) => createElement("p", null, orientation.useRoomOrientation(forced));
    assert.equal(renderToStaticMarkup(createElement(Probe, {})), "<p>normal</p>", "sem hidratacao quebrada: o HTML do servidor e o normal");
    assert.equal(renderToStaticMarkup(createElement(Probe, { forced: "vertical" })), "<p>vertical</p>");
  } finally {
    if (previous === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous;
    }
  }
});

test("o esqueleto: so as classes mudam; o vertical cobre a tela com o video em cover, o normal deixa as caixas sem caixa (contents)", () => {
  assert.deepEqual([...model.ROOM_STAGE_PATH], ["body", "stage-column", "stage-box"]);
  const normal = model.roomSkeleton("normal", false);
  const vertical = model.roomSkeleton("vertical", false);
  const small = model.roomSkeleton("vertical", true);
  assert.deepEqual(Object.keys(normal).sort(), Object.keys(vertical).sort(), "as mesmas pecas nos dois desenhos");
  assert.equal(normal.root, "z-[60] text-white fixed inset-0 flex flex-col bg-[#0b0b0b]", "o normal como era");
  assert.equal(normal.body, "flex min-h-0 flex-1 flex-col lg:flex-row");
  assert.equal(normal.bubbles, "contents");
  assert.equal(normal.sales, "contents");
  assert.match(vertical.root, /fixed inset-0/);
  assert.match(vertical.root, /overflow-hidden/, "nada passa da largura (o video cortado nos lados)");
  assert.match(vertical.stageColumn, /absolute inset-0/);
  assert.match(vertical.stageBox, /absolute inset-0/);
  for (const piece of ["[&_[data-room-stage]]:aspect-auto", "[&_[data-room-stage]]:h-full", "[&_[data-room-stage]]:overflow-hidden", "[&_[data-room-stage]>iframe]:w-[max(100vw,177.78dvh)]", "[&_[data-room-stage]>iframe]:h-[max(100dvh,56.25vw)]", "[&_[data-room-stage]>iframe]:-translate-x-1/2"]) {
    assert.ok(vertical.stageBox.includes(piece), `cover: ${piece}`);
  }
  assert.match(vertical.sales, /top-\[env\(safe-area-inset-top\)\]/, "o aviso de venda abaixo do entalhe");
  assert.equal(small.body, "contents", "minimizada, o corpo nao gera caixa");
  assert.match(small.root, /fixed bottom-4 right-4/, "a pilula no canto");
  assert.match(small.stageColumn, /absolute left-0 top-0 h-14 w-24/, "o palco por cima da miniatura da pilula (56 px)");
  assert.deepEqual(model.roomSkeleton("normal", true), small, "minimizada e igual nos dois desenhos");
});

/* ------------------------------------------------------------------------------------------------
 * A sala inteira nos dois desenhos: o caminho do palco e o HTML do palco
 * ---------------------------------------------------------------------------------------------- */

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

const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Os data-room-slot dos ancestrais do elemento que casa com `attribute` (do dialogo ate ele), e o HTML dele inteiro. */
function pathTo(html, attribute) {
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  let found = null;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    const [whole, closing, name, attrs, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (found && open === found.entry) {
        found.html = html.slice(found.start, match.index + whole.length);
        break;
      }
      continue;
    }
    const entry = { name, slot: /data-room-slot="([^"]+)"/.exec(attrs)?.[1] ?? null };
    if (!found && attrs.includes(attribute)) {
      found = { entry, path: stack.map((item) => item.slot).filter(Boolean), start: match.index };
    }
    if (!selfClosing && !VOID.has(name.toLowerCase())) {
      stack.push(entry);
    }
  }
  return found;
}

const render = (design, extra = {}, sessionExtra = {}) =>
  renderToStaticMarkup(createElement(room.WebinarRoom, { coverUrl: null, design, payload: payload(extra, sessionExtra), readOnly: false, webinarHref: "/webinarios/aula-de-ia" }));

test("girar o aparelho nao remonta o player: o palco no mesmo caminho (corpo > coluna > caixa) e com o MESMO HTML nos dois desenhos", () => {
  for (const sessionExtra of [{}, { kind: "replay", offsetMs: null, roomPhase: null }, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() }]) {
    const normal = render("normal", {}, sessionExtra);
    const vertical = render("vertical", {}, sessionExtra);
    assert.match(normal, /data-room-design="normal"/);
    assert.match(vertical, /data-room-design="vertical"/);
    const stageNormal = pathTo(normal, "data-room-stage=");
    const stageVertical = pathTo(vertical, "data-room-stage=");
    assert.deepEqual(stageNormal.path, [...model.ROOM_STAGE_PATH], "o caminho do palco no normal");
    assert.deepEqual(stageVertical.path, stageNormal.path, "o mesmo caminho no vertical");
    assert.equal(stageVertical.html, stageNormal.html, "o mesmo palco (iframe, capa e Ativar som): so as classes de fora mudam");
  }
  // O iframe e o mesmo (a mesma origem, o mesmo endereco, a mesma trava): girar nao troca o video.
  const iframe = /<iframe[^>]*>/.exec(render("vertical"))[0];
  assert.equal(iframe, /<iframe[^>]*>/.exec(render("normal"))[0]);
});

test("o card da Oferta fica no mesmo lugar nos dois desenhos (doca > lugar da oferta): girar nao perde o estado dele", () => {
  const normal = pathTo(render("normal"), "data-room-offer-announce");
  const vertical = pathTo(render("vertical"), "data-room-offer-announce");
  assert.deepEqual(normal.path, ["body", "stage-column", "stage-box", "dock", "offer"]);
  assert.deepEqual(vertical.path, normal.path);
});

test("o selo e o contador do topo pela regra do cabecalho: Ao vivo so com a decisao (D10); Sessao; Replay sem contador; encerrada sem contador", () => {
  assert.deepEqual(model.verticalBadge({ kind: "simulated", phase: "live", showLiveBadge: true }), { badge: "live", elapsed: true, showCount: true });
  assert.deepEqual(model.verticalBadge({ kind: "simulated", phase: "live", showLiveBadge: false }), { badge: "session", elapsed: true, showCount: true });
  assert.deepEqual(model.verticalBadge({ kind: "simulated", phase: "waiting", showLiveBadge: true }), { badge: "session", elapsed: false, showCount: true }, "na espera nunca Ao vivo");
  assert.deepEqual(model.verticalBadge({ kind: "simulated", phase: "ended", showLiveBadge: true }), { badge: "session", elapsed: false, showCount: false });
  assert.deepEqual(model.verticalBadge({ kind: "replay", phase: "live", showLiveBadge: true }), { badge: "replay", elapsed: false, showCount: false });
});

test("o chat por cima: as ultimas 6 mensagens, quantas ficam na gaveta; o anuncio de uma (com o papel) e da rajada", () => {
  assert.equal(model.VERTICAL_LIMITS.overlayMessages, 6);
  const few = [msg("1"), msg("2")];
  assert.deepEqual(model.verticalChatTail(few), { hidden: 0, tail: few });
  const many = Array.from({ length: 9 }, (_, index) => msg(String(index + 1)));
  const { hidden, tail } = model.verticalChatTail(many);
  assert.equal(hidden, 3);
  assert.deepEqual(
    tail.map((message) => message.id),
    ["4", "5", "6", "7", "8", "9"],
    "as ultimas, na ordem"
  );
  assert.equal(model.verticalChatTail(many, 0).tail.length, 1, "nunca menos de uma");

  assert.equal(model.verticalChatAnnouncement([]), "");
  assert.equal(model.verticalChatAnnouncement([msg("1", { body: "oi", displayName: "Bia C." })]), "Bia C.: oi");
  assert.equal(model.verticalChatAnnouncement([msg("1", { body: "o link", displayName: "Equipe", role: "team" })]), "Equipe: Equipe: o link");
  assert.equal(model.verticalChatAnnouncement([msg("1", { body: "resposta", displayName: "Assistente", role: "ai" })]), "Assistente: Assistente: resposta");
  assert.equal(model.verticalChatAnnouncement([msg("1", { body: "bem-vindos", displayName: "Danilo", role: "host" })]), "Apresentador: Danilo: bem-vindos");
  assert.equal(model.verticalChatAnnouncement(many), "9 mensagens novas", "em rajada so a contagem");
});

test("a frase do compositor: desligado, so a equipe, modo lento com a contagem, encerrada (nada no replay)", () => {
  assert.equal(model.verticalComposerHint({ disabled: true, reason: "chat_off", waitSeconds: 0 }, "live"), "O chat está desligado nesta sessão.");
  assert.equal(model.verticalComposerHint({ disabled: true, reason: "team_only", waitSeconds: 0 }, "live"), "Só a equipe escreve agora.");
  assert.equal(model.verticalComposerHint({ disabled: true, reason: "slow_mode", waitSeconds: 12 }, "live"), "Você pode enviar de novo em 12 s");
  assert.equal(model.verticalComposerHint({ disabled: true, reason: "ended", waitSeconds: 0 }, "ended"), "Essa live acabou.");
  assert.equal(model.verticalComposerHint({ disabled: true, reason: "ended", waitSeconds: 0 }, "replay"), "");
  assert.equal(model.verticalComposerHint({ disabled: false, reason: "consent", waitSeconds: 0 }, "live"), "", "o aceite abre na hora de enviar");
  assert.equal(model.verticalComposerHint({ disabled: false, reason: null, waitSeconds: 0 }, "live"), "");
});

test("a gaveta abre na aba certa: Ver mais mensagens no Chat, a enquete em Enquetes, o botao em Perguntas (ou onde o aluno estava)", () => {
  assert.equal(model.drawerTabFor({ current: "perguntas", from: "chat" }), "chat");
  assert.equal(model.drawerTabFor({ current: "chat", from: "poll" }), "enquetes");
  assert.equal(model.drawerTabFor({ current: "chat", from: "drawer" }), "perguntas");
  assert.equal(model.drawerTabFor({ current: "enquetes", from: "drawer" }), "enquetes");
});
