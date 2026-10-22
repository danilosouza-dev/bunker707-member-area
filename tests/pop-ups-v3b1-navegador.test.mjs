import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O navegador do aluno na v3b-1 (docs/25 §4.9 e §4.10): o que o plano arma em cada visualizacao de pagina e
// em cada aula concluida (popup-host-model.ts), o que impede abrir agora e se isso descarta ou so espera
// (antes e depois do POST /show), a desistencia de 10 min, como fechou e o fechamento pela pagina; os sinais
// da pagina da aula (src/lib/lesson-media-signal.ts) lidos de um DOM de mentira (o <video> que para sem
// avisar, a tela cheia do iPhone, o iframe numa tela de toque, o foco dentro do player de fora); e as guardas
// das insercoes na aula, no AppShell, no host e na janela. Nada de rede.

// --- DOM de mentira (so o que lesson-media-signal.ts le) ------------------------------------------------

class FakeElement extends EventTarget {
  constructor(tagName, attrs = {}, children = []) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.children = [];
    this.parent = null;
    children.forEach((child) => this.append(child));
  }

  append(child) {
    child.parent = this;
    this.children.push(child);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (selector === "video" && child.tagName === "VIDEO") {
        return child;
      }

      const found = child.querySelector(selector);

      if (found) {
        return found;
      }
    }

    return null;
  }

  closest(selector) {
    if (selector === "[data-lesson-player-stage]" && Object.hasOwn(this.attrs, "data-lesson-player-stage")) {
      return this;
    }

    return this.parent ? this.parent.closest(selector) : null;
  }
}

let palco = null;
let toque = false;
const fakeDocument = {
  activeElement: null,
  fullscreenElement: null,
  querySelector: (selector) => (selector === "[data-lesson-player-stage]" ? palco : null)
};

globalThis.document = fakeDocument;
globalThis.window = Object.assign(new EventTarget(), {
  clearInterval: (id) => globalThis.clearInterval(id),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  matchMedia: (query) => ({ matches: toque && query === "(pointer: coarse)" }),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms)
});

const host = await import("../src/components/member/notifications/popup-host-model.ts");
const media = await import("../src/lib/lesson-media-signal.ts");

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const lessonSource = await source("../src/components/lesson-experience.tsx");
const shellSource = await source("../src/components/app-shell.tsx");
const hostSource = await source("../src/components/member/notifications/member-popup-host.tsx");
const dialogSource = await source("../src/components/member/notifications/member-popup-dialog.tsx");
const cardSource = await source("../src/components/member/notifications/member-popup.tsx");
const menuSource = await source("../src/components/member/shell/member-notifications-menu.tsx");

const agora = Date.parse("2026-10-23T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();

const item = (extra = {}) => ({
  delaySeconds: 3,
  exclude: [],
  id: "pop-a",
  notBefore: null,
  pages: ["any"],
  stopOn: null,
  trigger: "page_load",
  ...extra
});

const ambiente = (extra = {}) => ({ fullscreen: false, hidden: false, layer: false, lesson: null, popupOpen: false, ...extra });
const aula = (extra = {}) => ({ activeLessonId: "aula-1", playing: false, touched: false, ...extra });
const abrindo = (extra = {}) => ({ at: agora, id: "pop-a", key: "pop-a", lessonId: null, playingAtCompletion: false, trigger: "page_load", ...extra });
const concluindo = (extra = {}) => abrindo({ key: "pop-a:aula-1", lessonId: "aula-1", trigger: "lesson_completed", ...extra });

function montarPalco({ kind = "native", lessonId = "aula-1", video = { ended: false, paused: true } } = {}) {
  const attrs = { "data-lesson-id": lessonId, "data-lesson-player-kind": kind, "data-lesson-player-stage": "" };
  const children = [];
  let elemento = null;

  if (kind === "native" && video) {
    elemento = Object.assign(new FakeElement("video"), video);
    children.push(elemento);
  }

  if (kind === "iframe" || kind === "youtube") {
    children.push(new FakeElement("iframe"));
  }

  palco = new FakeElement("div", attrs, children);
  return { iframe: palco.children.find((child) => child.tagName === "IFRAME") ?? null, palco, video: elemento };
}

function recomecarDom() {
  palco = null;
  toque = false;
  fakeDocument.activeElement = null;
  fakeDocument.fullscreenElement = null;
  media.resetLessonMedia();
}

// --- O que o plano arma -------------------------------------------------------------------------------

test("ao abrir a pagina: arma com a espera do pop-up, so nas paginas dele (a excecao vence) e com a chave = id", () => {
  const itens = [
    item({ delaySeconds: 3, id: "qualquer", exclude: ["profile"] }),
    item({ delaySeconds: 0, id: "so-home", pages: ["home"] }),
    item({ id: "aula", trigger: "lesson_completed" }),
    item({ delaySeconds: 10, id: "produtos", pages: ["content:*"] })
  ];

  const naHome = host.openingsForPageView({ items: itens, offsetMs: 0, pageKey: "home", pageViewStart: agora });
  assert.deepEqual(
    naHome.map(({ at, id, key, trigger }) => ({ at, id, key, trigger })),
    [
      { at: agora + 3_000, id: "qualquer", key: "qualquer", trigger: "page_load" },
      { at: agora, id: "so-home", key: "so-home", trigger: "page_load" }
    ],
    "na ordem do plano; o de concluir aula nunca arma ao abrir a pagina"
  );
  assert.equal(naHome[0].lessonId, null);
  assert.equal(naHome[0].playingAtCompletion, false);

  assert.deepEqual(host.openingsForPageView({ items: itens, offsetMs: 0, pageKey: "profile", pageViewStart: agora }), [], "Perfil e excecao");
  assert.deepEqual(
    host.openingsForPageView({ items: itens, offsetMs: 0, pageKey: "content:abc", pageViewStart: agora }).map((armed) => [armed.id, armed.at]),
    [["qualquer", agora + 3_000], ["produtos", agora + 10_000]]
  );
  assert.deepEqual(host.openingsForPageView({ items: itens, offsetMs: 0, pageKey: "login", pageViewStart: agora }), [], "pagina sem chave valida");
});

test("ao abrir a pagina: o notBefore do servidor vale na hora da abertura, com 1 s de folga e o relogio acertado", () => {
  const ids = (notBefore, offsetMs = 0) =>
    host.openingsForPageView({ items: [item({ notBefore })], offsetMs, pageKey: "home", pageViewStart: agora }).map((armed) => armed.id);

  assert.deepEqual(ids(null), ["pop-a"]);
  assert.deepEqual(ids(iso(agora + 3_000)), ["pop-a"], "pode exatamente na hora da abertura");
  assert.deepEqual(ids(iso(agora + 4_000)), ["pop-a"], "1 s de folga");
  assert.deepEqual(ids(iso(agora + 4_001)), [], "depois da folga: volta na proxima pagina");
  assert.deepEqual(ids(iso(agora + 60 * 60_000)), [], "longe: nunca arma nesta pagina");
  assert.deepEqual(ids(iso(agora + 5_000), 2_000), ["pop-a"], "servidor 2 s adiantado: a hora dele ja chegou");
  assert.deepEqual(ids(iso(agora + 3_000), -2_000), [], "servidor 2 s atrasado: ainda nao");
  assert.deepEqual(ids("isto nao e data"), [], "notBefore ilegivel nao arma");
});

test("um pop-up sem ritmo abre em duas visualizacoes seguidas (o show disse: pode de novo 5 s depois)", () => {
  const vistoEm = agora;
  const depoisDoShow = item({ notBefore: iso(vistoEm + 5_000), stopOn: "never" });

  // Proxima pagina 2 s depois (abre 3 s depois dela = 5 s depois da anterior) e outra 6 s depois.
  for (const passou of [2_000, 6_000]) {
    const armadas = host.openingsForPageView({ items: [depoisDoShow], offsetMs: 0, pageKey: "materials", pageViewStart: vistoEm + passou });
    assert.equal(armadas.length, 1, `pagina ${passou} ms depois`);
    assert.equal(armadas[0].at, vistoEm + passou + 3_000);
  }
});

test("ao concluir uma aula: chave por aula (duas conclusoes, duas aberturas), so o produto da pagina, e se o player tocava", () => {
  const itens = [
    item({ id: "qualquer-aula", pages: ["lesson:*"], trigger: "lesson_completed" }),
    item({ id: "curso-x", pages: ["lesson:curso-x"], trigger: "lesson_completed" }),
    item({ id: "abrir", pages: ["any"], trigger: "page_load" }),
    item({ exclude: ["lesson:curso-y"], id: "menos-y", pages: ["lesson:*"], trigger: "lesson_completed" })
  ];
  const primeira = host.completionOpenings({ contentId: "curso-y", items: itens, lessonId: "aula-1", now: agora, offsetMs: 0, playing: true });

  assert.deepEqual(
    primeira.map(({ at, id, key, lessonId, playingAtCompletion, trigger }) => ({ at, id, key, lessonId, playingAtCompletion, trigger })),
    [{ at: agora + 3_000, id: "qualquer-aula", key: "qualquer-aula:aula-1", lessonId: "aula-1", playingAtCompletion: true, trigger: "lesson_completed" }]
  );

  const segunda = host.completionOpenings({ contentId: "curso-y", items: itens, lessonId: "aula-2", now: agora + 60_000, offsetMs: 0, playing: false });
  assert.deepEqual(segunda.map((armed) => armed.key), ["qualquer-aula:aula-2"], "outra aula, outra chave: outra chance");
  assert.equal(segunda[0].playingAtCompletion, false);

  assert.deepEqual(
    host.completionOpenings({ contentId: "curso-x", items: itens, lessonId: "a", now: agora, offsetMs: 0, playing: false }).map((armed) => armed.id),
    ["qualquer-aula", "curso-x", "menos-y"]
  );
  assert.deepEqual(
    host.completionOpenings({
      contentId: "curso-x",
      items: [item({ notBefore: iso(agora + 10_000), pages: ["lesson:*"], trigger: "lesson_completed" })],
      lessonId: "a",
      now: agora,
      offsetMs: 0,
      playing: false
    }),
    [],
    "ainda nao e a vez dele (frequencia): espera a proxima aula concluida"
  );
});

// --- O que impede abrir agora ---------------------------------------------------------------------------

test("blockReason: a ordem (outro pop-up, aba escondida, tela cheia, aula, algo por cima) e o que cada um faz", () => {
  const tudo = ambiente({ fullscreen: true, hidden: true, layer: true, lesson: aula({ playing: true, touched: true }), popupOpen: true });

  assert.equal(host.blockReason(tudo, abrindo(), "before_show"), "open");
  assert.equal(host.blockReason({ ...tudo, popupOpen: false }, abrindo(), "before_show"), "hidden");
  assert.equal(host.blockReason({ ...tudo, hidden: false, popupOpen: false }, abrindo(), "before_show"), "fullscreen");
  assert.equal(host.blockReason(ambiente({ layer: true, lesson: aula({ touched: true }) }), abrindo(), "before_show"), "touched");
  assert.equal(host.blockReason(ambiente({ layer: true }), abrindo(), "before_show"), "layer");
  assert.equal(host.blockReason(ambiente(), abrindo(), "before_show"), null);
  assert.equal(host.blockReason(ambiente(), abrindo(), "after_show"), null);

  assert.equal(host.blockAction("open"), "wait_close");
  assert.equal(host.blockAction("hidden"), "wait_visible");
  assert.equal(host.blockAction("fullscreen"), "wait_fullscreen");
  assert.equal(host.blockAction("playing"), "wait_paused");
  assert.equal(host.blockAction("layer"), "recheck");
  assert.equal(host.blockAction("touched"), "drop");
  assert.equal(host.blockAction("left_lesson"), "drop");
  assert.equal(host.blockAction("replayed"), "drop");
});

test("blockReason na aula, ao abrir a pagina: mexer no player descarta so antes do show; depois dele, tocando, espera", () => {
  assert.equal(host.blockReason(ambiente({ lesson: aula({ touched: true }) }), abrindo(), "before_show"), "touched");
  assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), abrindo(), "before_show"), "touched", "tocando sem toque (autoplay) tambem");
  assert.equal(host.blockReason(ambiente({ lesson: aula() }), abrindo(), "before_show"), null);

  assert.equal(host.blockReason(ambiente({ lesson: aula({ touched: true }) }), abrindo(), "after_show"), null, "ja contado: mexer nao descarta");
  assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true, touched: true }) }), abrindo(), "after_show"), "playing");
});

test("blockReason na aula, ao concluir: trocou de aula ou deu play de novo descarta antes do show e espera depois", () => {
  const outraAula = ambiente({ lesson: aula({ activeLessonId: "aula-2" }) });
  const tocandoDeNovo = ambiente({ lesson: aula({ playing: true }) });

  assert.equal(host.blockReason(outraAula, concluindo(), "before_show"), "left_lesson");
  assert.equal(host.blockReason(tocandoDeNovo, concluindo(), "before_show"), "replayed");
  assert.equal(host.blockReason(tocandoDeNovo, concluindo({ playingAtCompletion: true }), "before_show"), "playing", "Concluir no meio do video: espera parar");
  assert.equal(host.blockReason(ambiente({ lesson: aula() }), concluindo(), "before_show"), null);

  // Depois do show (ja contado): nada descarta.
  assert.equal(host.blockReason(outraAula, concluindo(), "after_show"), null);
  assert.equal(host.blockReason({ ...outraAula, lesson: aula({ activeLessonId: "aula-2", playing: true }) }, concluindo(), "after_show"), "playing");
  assert.equal(host.blockReason(tocandoDeNovo, concluindo(), "after_show"), "playing");
});

// Um elemento de mentira para hasBlockingLayer: escondido ([hidden]/[inert]), sem caixa (display: none) ou
// dentro do proprio pop-up.
function camada({ caixa = true, dentroDe = [] } = {}) {
  return {
    closest: (selector) => (selector.split(",").some((parte) => dentroDe.includes(parte.trim())) ? {} : null),
    getClientRects: () => ({ length: caixa ? 1 : 0 }),
    matches: () => false
  };
}

function documento({ ativo = null, dialogos = [], overflow = "", topo = [] } = {}) {
  const porSeletor = {
    '[data-member-topbar] [aria-expanded="true"]': topo,
    '[aria-modal="true"], [role="dialog"], [role="alertdialog"]': dialogos
  };

  return {
    activeElement: ativo,
    body: { style: { overflow } },
    documentElement: { style: { overflow: "" } },
    querySelectorAll: (selector) => porSeletor[selector] ?? []
  };
}

test("hasBlockingLayer: so o topo do AppShell e so o que esta na tela (o Tutor IA escondido nao segura)", () => {
  assert.equal(host.hasBlockingLayer(documento()), false);
  assert.equal(host.hasBlockingLayer(documento({ overflow: "hidden" })), true, "rolagem travada por uma gaveta");

  // Menu da conta, busca ou sino abertos no topo seguram; um botao do topo escondido (display: none no
  // celular) ou dentro de [hidden] nao.
  assert.equal(host.hasBlockingLayer(documento({ topo: [camada()] })), true);
  assert.equal(host.hasBlockingLayer(documento({ topo: [camada({ caixa: false })] })), false);
  assert.equal(host.hasBlockingLayer(documento({ topo: [camada({ dentroDe: ["[hidden]"] })] })), false);

  // O <header> do Tutor IA (aria-expanded no "Histórico") fica montado na aba escondida: fora do topo, o
  // seletor nem o encontra; e um dialogo escondido, inerte, sem caixa ou o proprio pop-up tambem nao conta.
  assert.equal(host.hasBlockingLayer(documento({ dialogos: [camada()] })), true);
  assert.equal(host.hasBlockingLayer(documento({ dialogos: [camada({ dentroDe: ["[hidden]"] })] })), false);
  assert.equal(host.hasBlockingLayer(documento({ dialogos: [camada({ dentroDe: ["[inert]"] })] })), false);
  assert.equal(host.hasBlockingLayer(documento({ dialogos: [camada({ caixa: false })] })), false);
  assert.equal(host.hasBlockingLayer(documento({ dialogos: [camada({ dentroDe: ["[data-member-popup]"] })] })), false);

  // Alguem digitando (input, textarea, contenteditable) segura; foco num botao nao.
  const digitando = { matches: (selector) => selector.includes("textarea") };
  assert.equal(host.hasBlockingLayer(documento({ ativo: digitando })), true);
  assert.equal(host.hasBlockingLayer(documento({ ativo: { matches: () => false } })), false);

  assert.match(shellSource, /<header className="fixed left-0 right-0 top-0 z-40 overflow-hidden" data-member-topbar="">/);
  assert.match(hostSource, /layer: hasBlockingLayer\(document\)/);
});

test("givenUp conta 10 min da hora da abertura (nao do comeco da pagina); closeViaOf; shouldSendPageClose", () => {
  const armada = abrindo({ at: agora + 600_000 });

  assert.equal(host.givenUp(armada, agora + 600_000 + 10 * 60_000), false, "espera de 600 s nao desiste na hora de abrir");
  assert.equal(host.givenUp(armada, agora + 600_000 + 10 * 60_000 + 1), true);
  assert.equal(host.POPUP_HOST_RULES.giveUpMs, 600_000);

  assert.equal(host.closeViaOf("outside-press"), "outside");
  assert.equal(host.closeViaOf("escape-key"), "esc");
  assert.equal(host.closeViaOf("close-press"), "x");
  assert.equal(host.closeViaOf(undefined), "x");

  assert.equal(host.shouldSendPageClose({ outcome: null, persisted: false }), true);
  assert.equal(host.shouldSendPageClose({ outcome: null, persisted: true }), false, "foi para o cache do navegador: nao e saida");
  assert.equal(host.shouldSendPageClose({ outcome: "clicked", persisted: false }), false, "ja respondeu");
});

test("readPopupsAnswer le sem confiar no formato; clockOffsetOf acerta o relogio pelo asOf", () => {
  const plano = [item(), { id: 7 }, item({ id: "b", stopOn: "never", trigger: "lesson_completed" }), item({ id: "c", trigger: "at_start" })];

  assert.deepEqual(host.readPopupsAnswer({ asOf: iso(agora), pages: ["any"], plan: plano }), {
    asOf: iso(agora),
    pages: ["any"],
    plan: [item(), item({ id: "b", stopOn: "never", trigger: "lesson_completed" })]
  });
  assert.deepEqual(host.readPopupsAnswer({ asOf: iso(agora), pages: [], plan: null }), { asOf: iso(agora), pages: [], plan: null });
  assert.equal(host.readPopupsAnswer(null), null);
  assert.equal(host.readPopupsAnswer({ pages: ["any"], plan: [] }), null, "sem asOf");
  assert.equal(host.readPopupsAnswer({ asOf: iso(agora), pages: "any", plan: [] }), null);

  assert.equal(host.clockOffsetOf(iso(agora + 1_500), agora), 1_500);
  assert.equal(host.clockOffsetOf("x", agora), 0);
});

// --- Sinais da pagina da aula ---------------------------------------------------------------------------

test("snapshot le o <video> do palco na hora: tocando, parado sem evento de pause (troca de src) e no fim", () => {
  recomecarDom();
  const { video } = montarPalco({ video: { ended: false, paused: false } });

  assert.deepEqual(media.lessonMediaSnapshot(), { activeLessonId: "aula-1", fullscreen: false, playerKind: "native", playing: true, touched: false });

  video.paused = true; // a troca de aula muda o src: o navegador para o video sem disparar `pause`
  assert.equal(media.lessonMediaSnapshot().playing, false);

  video.paused = false;
  video.ended = true;
  assert.equal(media.lessonMediaSnapshot().playing, false);

  palco = null;
  assert.deepEqual(media.lessonMediaSnapshot(), { activeLessonId: null, fullscreen: false, playerKind: null, playing: false, touched: false });
});

test("snapshot: tela cheia da pagina e a tela cheia propria do iPhone (webkitDisplayingFullscreen)", () => {
  recomecarDom();
  const { video } = montarPalco();

  assert.equal(media.lessonMediaSnapshot().fullscreen, false);
  video.webkitDisplayingFullscreen = true;
  assert.equal(media.lessonMediaSnapshot().fullscreen, true);
  video.webkitDisplayingFullscreen = false;
  fakeDocument.fullscreenElement = palco;
  assert.equal(media.lessonMediaSnapshot().fullscreen, true);
});

test("snapshot: iframe numa tela de toque conta como mexido desde o comeco; o foco dentro do iframe do palco tambem", () => {
  recomecarDom();
  const { iframe } = montarPalco({ kind: "iframe" });

  assert.equal(media.lessonMediaSnapshot().touched, false, "mouse: so depois de entrar no player");
  toque = true;
  assert.equal(media.lessonMediaSnapshot().touched, true, "toque: um toque no iframe nunca chega a pagina");

  toque = false;
  fakeDocument.activeElement = iframe;
  assert.equal(media.lessonMediaSnapshot().touched, true, "foco dentro do player de fora");

  fakeDocument.activeElement = new FakeElement("iframe");
  assert.equal(media.lessonMediaSnapshot().touched, false, "um iframe fora do palco nao conta");

  montarPalco({ kind: "native" });
  toque = true;
  assert.equal(media.lessonMediaSnapshot().touched, false, "o nosso player numa tela de toque: so o play conta");
});

test("watchLessonPlayerFocus: o blur da window com o foco no iframe do palco marca mexido ate o reset", async () => {
  recomecarDom();
  const { iframe } = montarPalco({ kind: "iframe" });
  const parar = media.watchLessonPlayerFocus();

  fakeDocument.activeElement = iframe;
  window.dispatchEvent(new Event("blur"));
  fakeDocument.activeElement = null;
  assert.equal(media.lessonMediaSnapshot().touched, true, "continua mexido depois que o foco sai");

  media.resetLessonMedia();
  assert.equal(media.lessonMediaSnapshot().touched, false);

  window.dispatchEvent(new Event("blur"));
  fakeDocument.activeElement = iframe; // o navegador acerta o activeElement logo depois do blur
  await new Promise((resolve) => setTimeout(resolve, 5));
  fakeDocument.activeElement = null;
  assert.equal(media.lessonMediaSnapshot().touched, true, "o foco que chega so depois do blur tambem conta");

  parar();
  media.resetLessonMedia();
  fakeDocument.activeElement = iframe;
  window.dispatchEvent(new Event("blur"));
  fakeDocument.activeElement = null;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(media.lessonMediaSnapshot().touched, false, "parou de observar");
});

test("announce guarda o estado e dispara o evento; reset zera; eventos de outro formato sao ignorados", () => {
  recomecarDom();
  montarPalco({ kind: "youtube" });
  const recebidos = [];
  const ouvir = (event) => recebidos.push(media.readLessonMediaSignal(event));

  window.addEventListener(media.LESSON_MEDIA_EVENT, ouvir);
  media.announceLessonMedia({ kind: "youtube", playing: true });
  assert.equal(media.lessonMediaSnapshot().playing, true);
  assert.equal(media.lessonMediaSnapshot().touched, true, "o YouTube tocando tambem e mexer no player");
  media.announceLessonMedia({ kind: "youtube", playing: false });
  assert.equal(media.lessonMediaSnapshot().playing, false);

  media.resetLessonMedia();
  media.announceLessonMedia({ kind: "touched" });
  assert.equal(media.lessonMediaSnapshot().touched, true);
  media.announceLessonMedia({ contentId: "curso-x", kind: "completed", lessonId: "aula-1" });
  media.resetLessonMedia();
  assert.deepEqual(media.lessonMediaSnapshot(), { activeLessonId: "aula-1", fullscreen: false, playerKind: "youtube", playing: false, touched: false });

  for (const detail of [null, "completed", { kind: "completed", contentId: "curso x", lessonId: "a" }, { kind: "completed", contentId: "c" }, { kind: "youtube" }, { kind: "outra" }]) {
    window.dispatchEvent(new CustomEvent(media.LESSON_MEDIA_EVENT, { detail }));
  }

  window.removeEventListener(media.LESSON_MEDIA_EVENT, ouvir);
  assert.deepEqual(recebidos, [
    { kind: "youtube", playing: true },
    { kind: "youtube", playing: false },
    { kind: "touched" },
    { contentId: "curso-x", kind: "completed", lessonId: "aula-1" },
    null,
    null,
    null,
    null,
    null,
    null
  ]);
});

test("waitLessonMediaStop: chama quando o video do palco esvazia (emptied), uma vez so; tocando ainda, nao", () => {
  recomecarDom();
  const { video } = montarPalco({ video: { ended: false, paused: false } });
  let parou = 0;
  const parar = media.waitLessonMediaStop(() => {
    parou += 1;
  });

  video.dispatchEvent(new Event("abort"));
  assert.equal(parou, 0, "o video continua tocando");

  video.paused = true;
  video.dispatchEvent(new Event("emptied"));
  assert.equal(parou, 1);

  video.dispatchEvent(new Event("pause"));
  assert.equal(parou, 1, "uma vez so (e parou de ouvir)");
  parar();
});

test("waitLessonMediaStop: o YouTube parado e a conferencia de 1 s (o video sumiu na troca de aula)", () => {
  mock.timers.enable({ apis: ["setInterval"] });

  try {
    recomecarDom();
    montarPalco({ kind: "youtube" });
    media.announceLessonMedia({ kind: "youtube", playing: true });
    let parou = 0;
    const parar = media.waitLessonMediaStop(() => {
      parou += 1;
    });

    media.announceLessonMedia({ kind: "youtube", playing: false });
    assert.equal(parou, 1, "o sinal do YouTube parado");
    parar();

    const { video } = montarPalco({ video: { ended: false, paused: false } });
    media.waitLessonMediaStop(() => {
      parou += 1;
    });
    mock.timers.tick(1_000);
    assert.equal(parou, 1, "ainda tocando");

    video.parent.children.length = 0; // trocou para uma aula de iframe: o <video> sumiu sem evento
    mock.timers.tick(1_000);
    assert.equal(parou, 2);
    mock.timers.tick(5_000);
    assert.equal(parou, 2, "parou de conferir");
  } finally {
    mock.timers.reset();
  }
});

// --- Guardas (insercoes e regras que se leem no codigo; o comportamento esta acima e nos testes e2e) ---

test("guarda: as cinco insercoes na aula (play, palco, YouTube, fim do video e Concluir; 'latest' antes do settle)", () => {
  assert.match(lessonSource, /import \{ announceLessonMedia \} from "@\/lib\/lesson-media-signal";/);
  assert.match(lessonSource, /function handlePlayerStart\(\) \{\s*\/\/[^\n]*\n\s*announceLessonMedia\(\{ kind: "touched" \}\);/);
  assert.match(lessonSource, /data-lesson-id=\{activeLessonKey \|\| undefined\}/);
  assert.match(
    lessonSource,
    /data-lesson-player-kind=\{!activePlayerRenderConfig \? undefined : activePlayerRenderConfig\.kind === "video" \? "native" : usesCustomYouTubeControls \? "youtube" : "iframe"\}/
  );
  assert.match(lessonSource, /announceLessonMedia\(\{ kind: "youtube", playing: youTubePlayingForPopup \}\);/);
  assert.match(lessonSource, /return \(\) => \{\s*announceLessonMedia\(\{ kind: "youtube", playing: false \}\);/);
  assert.ok(
    lessonSource.indexOf("announceLessonMedia({ kind: \"youtube\"") < lessonSource.indexOf("if (!activeLesson) {\n    return ("),
    "o efeito do YouTube vem antes do retorno da aula vazia (regra dos hooks)"
  );

  // Fim do video (syncLessonWatchProgress) e Concluir (handleLessonCompletionToggle): latest lido antes do settle.
  const fimDoVideo = lessonSource.slice(lessonSource.indexOf("const syncLessonWatchProgress = useCallback"), lessonSource.indexOf("function handlePlayerStart()"));
  const concluir = lessonSource.slice(lessonSource.indexOf("function handleLessonCompletionToggle("), lessonSource.indexOf("function handleNativeVideoProgress("));

  for (const [nome, trecho, condicao] of [
    ["fim do video", fimDoVideo, "saved && completesLesson && latest"],
    ["Concluir", concluir, "saved && toggle.willComplete && latest"]
  ]) {
    const latest = trecho.indexOf("const latest =");
    const settle = trecho.indexOf("settleOptimisticCompletion(lessonId, requestId, saved, snapshot);");
    const anuncio = trecho.indexOf("announceLessonMedia({ contentId: item.id, kind: \"completed\", lessonId });");

    assert.ok(latest > 0 && settle > latest && anuncio > settle, `${nome}: latest -> settle -> anuncio`);
    assert.ok(trecho.includes(`if (${condicao})`), `${nome}: so a conclusao gravada e mais nova`);
  }

  assert.match(fimDoVideo, /const latest = requestId === 0 \|\| pendingCompletionRef\.current\.get\(lessonId\) === requestId;/);
  assert.match(concluir, /const latest = pendingCompletionRef\.current\.get\(lessonId\) === requestId;/);
});

test("guarda: o AppShell passa a pagina ao sino e monta o host em toda pagina com chave (nunca no 'ver como')", () => {
  assert.match(shellSource, /const popupPage = accessPreviewMode \? null : popupPageKeyOf\(pathname\);/);
  assert.match(shellSource, /const popupHome = popupPage === "home";/);
  assert.match(shellSource, /<MemberNotificationsMenu[\s\S]*?popupPage=\{popupPage\}[\s\S]*?refreshSummaryOnMount=\{!popupHome\}/);
  assert.match(shellSource, /<MemberPopupHost onNavigate=\{[^}]*\} pageKey=\{popupPage\} \/>/);
  assert.doesNotMatch(shellSource, /<MemberPopupHost[^>]*enabled=/);
  assert.match(menuSource, /useNotificationsSummary\(\{ page: popupPage, refreshOnMount: refreshSummaryOnMount, userId: studentId \}\)/);
});

test("guarda: o host baixa a janela antes do POST /show e nao usa mais o pedido da v1 nem a espera fixa", () => {
  assert.match(hostSource, /const loadPopupDialog = \(\) => import\("\.\/member-popup-dialog"\);/);
  const show = hostSource.slice(hostSource.indexOf("async function show(armed: ArmedPopup)"));
  const importa = show.indexOf("await loadPopupDialog();");
  const pede = show.indexOf("postPopupShow(");

  assert.ok(importa > 0 && pede > importa, "await loadPopupDialog() antes de postPopupShow");
  assert.doesNotMatch(hostSource, /popup: true|"impressed"|POPUP_RULES|lastEmptyCheckAt/);
  assert.match(hostSource, /homeFetchDelayMs/);
  assert.match(hostSource, /holdSummaryForPopup\(true\)/);
});

test("guarda: a janela usa disablePointerDismissal em 'Só no X', diz como fechou e nao mexe no video da aula", () => {
  assert.match(dialogSource, /disablePointerDismissal=\{xOnly\}/);
  assert.match(dialogSource, /const xOnly = popup\.close === "x_only";/);
  assert.match(dialogSource, /onFinish\("closed", closeViaOf\(details\?\.reason\)\)/);
  assert.match(dialogSource, /useEscapeToClose\(open, \(\) => onFinish\("closed", "esc"\)/);
  assert.match(dialogSource, /onClose=\{\(\) => onFinish\("closed", "x"\)\}/);
  assert.match(dialogSource, /!video\.closest\("\[data-lesson-player-stage\]"\)/);
  assert.match(dialogSource, /nudgeClose=\{nudgeClose\}/);
});

test("guarda: o X tem 36 px visiveis e 44 px de toque (before: com -inset-1) e pulsa so com movimento permitido", () => {
  assert.match(cardSource, /grid size-9 place-items-center/);
  assert.match(cardSource, /before:absolute before:-inset-1/);
  assert.match(cardSource, /before:content-\[''\]/);
  assert.match(cardSource, /nudgeClose && "motion-safe:scale-\[1\.12\]"/);
});
