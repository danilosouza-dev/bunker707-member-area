import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O navegador do aluno na v3b-2 (docs/29 §5): a hora marcada (o pop-up com Comeca arma para a hora do servidor,
// com folga, sorteio e "Quanto tempo depois", sem desistir por tempo), o relogio acertado, a segunda tentativa
// depois do 409 not_started, o plano mais novo que chega com a pagina aberta (arma, desarma ou troca a hora), o
// despertador que segue a hora de parede (o aparelho dormindo), "No primeiro acesso" como momento de pagina,
// "Ao concluir um curso" junto da conclusao da aula, o que bloqueia na aula (esperar o video parar em todo player
// que a pagina le, a ponte pendente que confere de novo), e os sinais da ponte com o player de fora lidos de um DOM
// de mentira (src/lib/lesson-media-signal.ts). Plano dublê e relogio falso; nada de rede.

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
      if (child.tagName === selector.toUpperCase()) {
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
let agora = Date.parse("2026-10-23T19:00:00.000Z");
const fakeDocument = Object.assign(new EventTarget(), {
  activeElement: null,
  fullscreenElement: null,
  querySelector: (selector) => (selector === "[data-lesson-player-stage]" ? palco : null)
});

globalThis.document = fakeDocument;
globalThis.window = Object.assign(new EventTarget(), {
  clearInterval: (id) => globalThis.clearInterval(id),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  matchMedia: (query) => ({ matches: toque && query === "(pointer: coarse)" }),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms)
});
Date.now = () => agora;

const host = await import("../src/components/member/notifications/popup-host-model.ts");
const media = await import("../src/lib/lesson-media-signal.ts");
const origins = await import("../src/lib/lesson-embed-origins.ts");
const hostSource = await readFile(new URL("../src/components/member/notifications/member-popup-host.tsx", import.meta.url), "utf8");

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const iso = (time) => new Date(time).toISOString();
const meio = () => 0.5;

const item = (extra = {}) => ({
  delaySeconds: 3,
  exclude: [],
  id: "live",
  notBefore: null,
  pages: ["any"],
  stopOn: null,
  trigger: "page_load",
  ...extra
});

/** Pop-up que comeca em `startsAt` (como o servidor manda: antes da hora, notBefore = startsAt). */
const agendado = (startsAt, extra = {}) => item({ notBefore: startsAt > agora ? iso(startsAt) : null, startsAt: iso(startsAt), ...extra });

const abrir = (items, extra = {}) =>
  host.openingsForPageView({ items, now: agora, offsetMs: 0, pageKey: "saved", pageViewStart: agora, random: meio, ...extra });

const ambiente = (extra = {}) => ({ fullscreen: false, hidden: false, layer: false, lesson: null, popupOpen: false, ...extra });
const aula = (extra = {}) => ({ activeLessonId: "aula-1", bridge: "none", playing: false, readable: true, touched: false, ...extra });
const naPagina = (extra = {}) => ({
  at: agora,
  clock: false,
  delayMs: 0,
  giveUpAt: agora + 10 * MINUTO,
  id: "pop-a",
  key: "pop-a",
  lessonId: null,
  playingAtCompletion: false,
  rearmed: false,
  trigger: "page_load",
  ...extra
});
const naConclusao = (extra = {}) => naPagina({ key: "pop-a:aula-1", lessonId: "aula-1", trigger: "lesson_completed", ...extra });

/** O palco como a aula desenha: o player de fora da lista da ponte marcado com data-lesson-player-bridge. */
function montarPalco({ kind = "iframe", lessonId = "aula-1", src = "https://player.vimeo.com/video/76979871", video = null } = {}) {
  const attrs = { "data-lesson-id": lessonId, "data-lesson-player-kind": kind, "data-lesson-player-stage": "" };

  if (kind === "iframe" && origins.embedBridgeTarget(src)) {
    attrs["data-lesson-player-bridge"] = "";
  }

  const children = [];

  if (kind === "native") {
    children.push(Object.assign(new FakeElement("video"), video ?? { ended: false, paused: true }));
  } else {
    children.push(new FakeElement("iframe", { src }));
  }

  palco = new FakeElement("div", attrs, children);
  return palco;
}

/** Nova visualizacao de pagina "agora" (o host chama resetLessonMedia ao abrir). */
function novaPagina() {
  palco = null;
  toque = false;
  fakeDocument.activeElement = null;
  fakeDocument.fullscreenElement = null;
  media.resetLessonMedia();
}

const embed = (extra = {}) => ({ bridge: "confirmed", fullscreen: false, kind: "embed", lessonId: "aula-1", playing: false, ...extra });

// --- 1. A hora marcada no plano -------------------------------------------------------------------------

test("hora marcada: Comeca daqui a 60 s arma para a hora do servidor + 2 s + sorteio + espera, sem desistir, com a chave da hora", () => {
  const comeca = agora + MINUTO;
  const [armada] = abrir([agendado(comeca)]);

  assert.deepEqual(armada, {
    at: comeca + 2_000 + 2_000 + 3_000,
    clock: true,
    delayMs: 3_000,
    giveUpAt: null,
    id: "live",
    key: `live@${iso(comeca)}`,
    lessonId: null,
    playingAtCompletion: false,
    rearmed: false,
    startsAt: iso(comeca),
    trigger: "page_load"
  });

  // O sorteio: de 0 a 4 s (nunca 4 s inteiros), sempre depois da folga.
  assert.equal(abrir([agendado(comeca)], { random: () => 0 })[0].at, comeca + 2_000 + 3_000);
  assert.equal(abrir([agendado(comeca)], { random: () => 0.999_9 })[0].at, comeca + 2_000 + 3_999 + 3_000);
  assert.equal(abrir([agendado(comeca)], { random: () => 1 })[0].at, comeca + 2_000 + 3_999 + 3_000, "random fora do intervalo nao passa de 4 s");
  assert.equal(abrir([agendado(comeca)], { random: () => Number.NaN })[0].at, comeca + 2_000 + 3_000);
  assert.equal(host.POPUP_HOST_RULES.liveStartMarginMs, 2_000);
  assert.equal(host.POPUP_HOST_RULES.liveSpreadMs, 4_000);
  assert.equal(host.POPUP_HOST_RULES.liveHorizonMs, 86_400_000);
  assert.equal(host.POPUP_HOST_RULES.armWakeMs, 30_000);
});

test("hora marcada: Comeca que ja passou antes de a pagina abrir arma como sempre; a pagina aberta antes dele arma pela hora (mesmo vencida)", () => {
  const comecou = agora - MINUTO;
  const [normal] = abrir([agendado(comecou)]);

  assert.equal(normal.clock, false);
  assert.equal(normal.key, "live", "chave = id");
  assert.equal(normal.at, agora + 3_000);
  assert.equal(normal.giveUpAt, agora + 3_000 + 10 * MINUTO);
  assert.equal("startsAt" in normal, false);

  // A pagina abriu 2 min atras (antes do Comeca) e o plano novo chega agora: abre na hora (at ja vencido).
  const [vencida] = abrir([agendado(comecou)], { onlyClock: true, pageViewStart: agora - 2 * MINUTO });
  assert.equal(vencida.clock, true);
  assert.equal(vencida.at, comecou + 2_000 + 2_000 + 3_000);
  assert.ok(vencida.at < agora);

  // Dentro da folga de 2 s a pagina abriu "antes" da hora (o servidor ainda nao deixava).
  assert.equal(abrir([agendado(agora - 1_500)])[0].clock, true);
  assert.equal(abrir([agendado(agora - 2_000)])[0].clock, false);
});

test("hora marcada: onlyClock so devolve as da hora; mais de 24 h nada; Lembrar depois alem do comeco nada; primeiro acesso arma como pagina; conclusao nunca", () => {
  const itens = [
    agendado(agora + HORA, { id: "live" }),
    item({ id: "comum" }),
    agendado(agora - HORA, { id: "ja-comecou" }),
    item({ id: "aula", pages: ["lesson:*"], trigger: "lesson_completed" })
  ];

  assert.deepEqual(abrir(itens, { pageKey: "lesson:curso" }).map((armed) => [armed.id, armed.clock]), [["live", true], ["comum", false], ["ja-comecou", false]]);
  assert.deepEqual(abrir(itens, { onlyClock: true }).map((armed) => armed.id), ["live"]);

  assert.deepEqual(abrir([agendado(agora + 25 * HORA)]), [], "mais de 24 h a frente");
  assert.equal(abrir([agendado(agora + 24 * HORA - 8_000)]).length, 1, "dentro das 24 h (com folga, sorteio e espera)");

  const lembrarDepois = agendado(agora + MINUTO, { notBefore: iso(agora + MINUTO + 10 * MINUTO) });
  assert.deepEqual(abrir([lembrarDepois]), [], "Lembrar depois ate depois do comeco: nao arma nesta pagina");

  const primeiroAcesso = abrir([agendado(agora + MINUTO, { trigger: "first_login" }), item({ id: "boas-vindas", trigger: "first_login" })]);
  assert.deepEqual(primeiroAcesso.map((armed) => [armed.id, armed.trigger, armed.clock]), [["live", "first_login", true], ["boas-vindas", "first_login", false]]);

  assert.deepEqual(
    abrir([item({ trigger: "lesson_completed" }), item({ id: "curso", trigger: "course_completed" }), agendado(agora + MINUTO, { trigger: "course_completed" })], {
      pageKey: "lesson:x"
    }),
    [],
    "os momentos de conclusao nunca armam pela pagina"
  );
});

test("hora marcada: o relogio acertado (servidor adiantado ou atrasado) muda o at certo", () => {
  const comeca = agora + MINUTO;
  const base = abrir([agendado(comeca)])[0].at;

  assert.equal(abrir([agendado(comeca)], { offsetMs: 5_000 })[0].at, base - 5_000, "servidor 5 s adiantado: a hora chega 5 s antes no relogio do aluno");
  assert.equal(abrir([agendado(comeca)], { offsetMs: -5_000 })[0].at, base + 5_000, "servidor 5 s atrasado");
  assert.equal(abrir([agendado(comeca)], { offsetMs: -5_000 })[0].key, `live@${iso(comeca)}`, "a chave e sempre a hora do servidor");
});

// --- 3 e 4. Segunda tentativa e desistencia ---------------------------------------------------------------

test("rearmAfterNotStarted: uma vez so, para o nextAt (com folga, sorteio e a espera de antes); nunca para o que nao e da hora marcada", () => {
  const comeca = agora + MINUTO;
  const [armada] = abrir([agendado(comeca)]);
  const adiada = iso(comeca + 5 * MINUTO);
  const segunda = host.rearmAfterNotStarted(armada, adiada, 0, agora, meio);

  assert.deepEqual(segunda, {
    ...armada,
    at: comeca + 5 * MINUTO + 2_000 + 2_000 + 3_000,
    key: `live@${adiada}`,
    rearmed: true,
    startsAt: adiada
  });
  assert.equal(host.rearmAfterNotStarted(armada, adiada, 4_000, agora, meio).at, segunda.at - 4_000, "o acerto do relogio");
  assert.equal(host.rearmAfterNotStarted(segunda, adiada, 0, agora, meio), null, "a terceira nunca");
  assert.equal(host.rearmAfterNotStarted(armada, "nao e data", 0, agora, meio), null);
  assert.equal(host.rearmAfterNotStarted(naPagina(), adiada, 0, agora, meio), null, "abertura comum");
  assert.equal(host.rearmAfterNotStarted(armada, iso(agora + 25 * HORA), 0, agora, meio), null, "mais de 24 h a frente: o proximo plano traz");
});

test("givenUp: a hora marcada (giveUpAt null) nunca desiste por tempo; as outras, 10 min depois da hora delas", () => {
  const [armada] = abrir([agendado(agora + MINUTO)]);

  assert.equal(host.givenUp(armada, agora + 30 * 24 * HORA), false);
  assert.equal(host.givenUp(naPagina({ giveUpAt: agora }), agora), false);
  assert.equal(host.givenUp(naPagina({ giveUpAt: agora }), agora + 1), true);

  const [comum] = abrir([item()]);
  assert.equal(comum.giveUpAt, comum.at + host.POPUP_HOST_RULES.giveUpMs);
});

// --- 5. O que bloqueia ------------------------------------------------------------------------------------

test("blockReason (docs/29 §5.4): na aula, o momento de pagina espera o video parar em todo player que a pagina le", () => {
  for (const trigger of ["page_load", "first_login"]) {
    const armada = naPagina({ trigger });
    const hora = naPagina({ clock: true, giveUpAt: null, key: "pop-a@x", trigger });

    // Arquivo e YouTube: tocando espera (era descartar); tocado e parado, abre.
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true, touched: true }) }), armada, "before_show"), "playing", trigger);
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), hora, "before_show"), "playing");
    assert.equal(host.blockReason(ambiente({ lesson: aula({ touched: true }) }), armada, "before_show"), null);
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), armada, "after_show"), "playing");

    // Iframe sem ponte (outra origem, ou a ponte acabou sem resposta) e o aluno mexeu: descarta antes do show.
    const semPonte = aula({ readable: false, touched: true });
    assert.equal(host.blockReason(ambiente({ lesson: semPonte }), armada, "before_show"), "touched");
    assert.equal(host.blockReason(ambiente({ lesson: semPonte }), armada, "after_show"), null);

    // Iframe com a ponte confirmada tocando: espera.
    assert.equal(host.blockReason(ambiente({ lesson: aula({ bridge: "confirmed", playing: true, touched: true }) }), armada, "before_show"), "playing");
    assert.equal(host.blockReason(ambiente({ lesson: aula({ bridge: "confirmed", touched: true }) }), armada, "before_show"), null);

    // Tela de toque (o iframe conta como mexido desde o comeco) com a ponte pendente: confere de novo, nao descarta.
    const pendente = aula({ bridge: "pending", readable: false, touched: true });
    assert.equal(host.blockReason(ambiente({ lesson: pendente }), armada, "before_show"), "bridge_pending");
    assert.equal(host.blockReason(ambiente({ lesson: pendente }), hora, "after_show"), "bridge_pending");
    // A mesma, depois de a ponte acabar sem resposta: a regra de antes (descarta).
    assert.equal(host.blockReason(ambiente({ lesson: { ...pendente, bridge: "none" } }), armada, "before_show"), "touched");
  }

  assert.equal(host.blockAction("bridge_pending"), "recheck");
  assert.equal(host.blockAction("playing"), "wait_paused");
  assert.equal(host.blockAction("touched"), "drop");

  // Os de cima continuam primeiro.
  const pendente = aula({ bridge: "pending", playing: true });
  assert.equal(host.blockReason(ambiente({ hidden: true, lesson: pendente }), naPagina(), "before_show"), "hidden");
  assert.equal(host.blockReason(ambiente({ fullscreen: true, lesson: pendente }), naPagina(), "before_show"), "fullscreen");
  assert.equal(host.blockReason(ambiente({ layer: true, lesson: aula() }), naPagina(), "before_show"), "layer");
});

test("blockReason: conclusao de aula e de curso (outra aula na tela, deu play de novo, tocando)", () => {
  for (const trigger of ["lesson_completed", "course_completed"]) {
    const armada = naConclusao({ key: trigger === "course_completed" ? "pop-a:course:aula-1" : "pop-a:aula-1", trigger });

    assert.equal(host.blockReason(ambiente({ lesson: aula({ activeLessonId: "aula-2" }) }), armada, "before_show"), "left_lesson", trigger);
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), armada, "before_show"), "replayed");
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), { ...armada, playingAtCompletion: true }, "before_show"), "playing");
    assert.equal(host.blockReason(ambiente({ lesson: aula({ playing: true }) }), armada, "after_show"), "playing");
    assert.equal(host.blockReason(ambiente({ lesson: aula({ bridge: "pending", readable: false, touched: true }) }), armada, "before_show"), null, "a ponte pendente nao segura a conclusao");
  }
});

// --- 6. Curso concluido ----------------------------------------------------------------------------------

test("completionOpenings com courseCompleted arma os dois momentos (na ordem do plano, chave do curso); sem ele, so o da aula", () => {
  const itens = [
    item({ delaySeconds: 0, id: "curso", pages: ["lesson:*"], trigger: "course_completed" }),
    item({ delaySeconds: 2, id: "aula", pages: ["lesson:curso-x"], trigger: "lesson_completed" }),
    item({ id: "outro-curso", pages: ["lesson:curso-y"], trigger: "course_completed" }),
    item({ id: "pagina", pages: ["any"], trigger: "page_load" })
  ];
  const fechou = host.completionOpenings({ contentId: "curso-x", courseCompleted: true, items: itens, lessonId: "ultima", now: agora, offsetMs: 0, playing: true });

  assert.deepEqual(
    fechou.map(({ at, clock, giveUpAt, id, key, lessonId, playingAtCompletion, trigger }) => ({ at, clock, giveUpAt, id, key, lessonId, playingAtCompletion, trigger })),
    [
      { at: agora, clock: false, giveUpAt: agora + 10 * MINUTO, id: "curso", key: "curso:course:ultima", lessonId: "ultima", playingAtCompletion: true, trigger: "course_completed" },
      { at: agora + 2_000, clock: false, giveUpAt: agora + 2_000 + 10 * MINUTO, id: "aula", key: "aula:ultima", lessonId: "ultima", playingAtCompletion: true, trigger: "lesson_completed" }
    ]
  );

  const semCurso = host.completionOpenings({ contentId: "curso-x", courseCompleted: false, items: itens, lessonId: "ultima", now: agora, offsetMs: 0, playing: false });
  assert.deepEqual(semCurso.map((armed) => armed.key), ["aula:ultima"]);
});

// --- 7. O plano lido sem confiar no formato ----------------------------------------------------------------

test("readPopupsAnswer: startsAt lido so como data; primeiro acesso e curso aceitos; at_start ainda descartado", () => {
  const plano = [
    item({ id: "a", startsAt: iso(agora + HORA) }),
    item({ id: "b", startsAt: "amanha" }),
    item({ id: "c", startsAt: 12 }),
    item({ id: "d", trigger: "first_login" }),
    item({ id: "e", trigger: "course_completed" }),
    item({ id: "f", trigger: "at_start" })
  ];
  const lido = host.readPopupsAnswer({ asOf: iso(agora), pages: ["any"], plan: plano });

  assert.deepEqual(lido.plan.map((entry) => [entry.id, entry.trigger, entry.startsAt]), [
    ["a", "page_load", iso(agora + HORA)],
    ["b", "page_load", undefined],
    ["c", "page_load", undefined],
    ["d", "first_login", undefined],
    ["e", "course_completed", undefined]
  ]);
  assert.equal("startsAt" in lido.plan[1], false, "a chave some (nao fica undefined)");
});

// --- 8 a 10. Os sinais da ponte na aula --------------------------------------------------------------------

test("snapshot: a ponte confirmada da aula na tela le o tocar e a tela cheia do Vimeo; de outra aula e ignorada", () => {
  novaPagina();
  montarPalco();

  media.announceLessonMedia(embed({ playing: true }));
  assert.deepEqual(media.lessonMediaSnapshot(), {
    activeLessonId: "aula-1",
    bridge: "confirmed",
    fullscreen: false,
    playerKind: "iframe",
    playing: true,
    readable: true,
    touched: false
  });

  media.announceLessonMedia(embed({ fullscreen: true, playing: true }));
  assert.equal(media.lessonMediaSnapshot().fullscreen, true, "a tela cheia do Vimeo vem pela ponte");

  media.announceLessonMedia(embed({ lessonId: "aula-2", playing: true }));
  const outra = media.lessonMediaSnapshot();
  assert.equal(outra.playing, false, "sinal de outra aula nao vale");
  assert.equal(outra.readable, false);
  assert.equal(outra.bridge, "pending", "a pagina acabou de abrir e o iframe e do Vimeo: pendente");

  media.announceLessonMedia(embed({ bridge: "pending", playing: true }));
  assert.deepEqual([media.lessonMediaSnapshot().bridge, media.lessonMediaSnapshot().readable, media.lessonMediaSnapshot().playing], ["pending", false, false]);

  media.announceLessonMedia(embed({ bridge: "silent", fullscreen: true, playing: true }));
  assert.deepEqual([media.lessonMediaSnapshot().bridge, media.lessonMediaSnapshot().readable, media.lessonMediaSnapshot().fullscreen], ["none", false, false]);
});

test("snapshot sem sinal: iframe da lista conta como pendente nos primeiros 15 s da pagina; outra origem nunca", () => {
  const abriu = agora;

  novaPagina();
  montarPalco();
  agora = abriu + 2_000;
  assert.equal(media.lessonMediaSnapshot().bridge, "pending");
  agora = abriu + origins.EMBED_BRIDGE_RULES.pendingMaxMs - 1;
  assert.equal(media.lessonMediaSnapshot().bridge, "pending", "o teto e o mesmo da ponte");
  agora = abriu + origins.EMBED_BRIDGE_RULES.pendingMaxMs;
  assert.equal(media.lessonMediaSnapshot().bridge, "none");
  agora = abriu + 16_000;
  assert.equal(media.lessonMediaSnapshot().bridge, "none");

  agora = abriu;
  novaPagina();
  montarPalco({ src: "https://player.exemplo.com/v/1" });
  agora = abriu + 2_000;
  assert.equal(media.lessonMediaSnapshot().bridge, "none", "outra origem");

  montarPalco({ kind: "native" });
  assert.equal(media.lessonMediaSnapshot().bridge, "none", "o nosso player");
  assert.equal(media.lessonMediaSnapshot().readable, true);
  agora = abriu;
});

test("tela de toque + iframe da lista: o snapshot da tocado e pendente (a abertura confere de novo); sem resposta, descarta", () => {
  novaPagina();
  montarPalco();
  toque = true;

  const env = () => {
    const snap = media.lessonMediaSnapshot();
    return ambiente({ lesson: { activeLessonId: snap.activeLessonId, bridge: snap.bridge, playing: snap.playing, readable: snap.readable, touched: snap.touched } });
  };

  assert.equal(host.blockReason(env(), naPagina(), "before_show"), "bridge_pending");
  media.announceLessonMedia(embed({ bridge: "silent" }));
  assert.equal(host.blockReason(env(), naPagina(), "before_show"), "touched");
  media.announceLessonMedia(embed({ bridge: "confirmed" }));
  assert.equal(host.blockReason(env(), naPagina(), "before_show"), null, "confirmada e parada: abre");
});

test("waitLessonMediaStop termina com o sinal da ponte parada", () => {
  novaPagina();
  montarPalco();
  media.announceLessonMedia(embed({ playing: true }));
  let parou = 0;
  const parar = media.waitLessonMediaStop(() => {
    parou += 1;
  });

  media.announceLessonMedia(embed({ fullscreen: true, playing: true }));
  assert.equal(parou, 0);
  media.announceLessonMedia(embed({ playing: false }));
  assert.equal(parou, 1);
  media.announceLessonMedia(embed({ playing: false }));
  assert.equal(parou, 1, "uma vez so");
  parar();
});

test("readLessonMediaSignal: courseCompleted so com true; embed com campo errado vira null", () => {
  const ler = (detail) => media.readLessonMediaSignal(new CustomEvent(media.LESSON_MEDIA_EVENT, { detail }));
  const concluida = { contentId: "curso-x", kind: "completed", lessonId: "aula-1" };

  assert.deepEqual(ler({ ...concluida, courseCompleted: true }), { ...concluida, courseCompleted: true });
  for (const courseCompleted of ["true", 1, false, null, {}]) {
    assert.deepEqual(ler({ ...concluida, courseCompleted }), concluida, `courseCompleted ${JSON.stringify(courseCompleted)}: so a aula`);
  }

  assert.deepEqual(ler(embed({ playing: true })), embed({ playing: true }));
  for (const errado of [
    embed({ bridge: "none" }),
    embed({ bridge: "confirmada" }),
    embed({ lessonId: "" }),
    embed({ lessonId: "x".repeat(241) }),
    embed({ lessonId: 7 }),
    embed({ playing: "sim" }),
    { bridge: "confirmed", kind: "embed", lessonId: "aula-1", playing: true }
  ]) {
    assert.equal(ler(errado), null, JSON.stringify(errado));
  }
});

// --- 11. Plano que chega com a pagina aberta ----------------------------------------------------------------

test("reconcileClockOpenings: o plano mais novo arma, troca, desarma ou deixa a hora marcada (nunca duas vezes na fila)", () => {
  const h19 = Date.parse("2026-10-23T19:00:00.000Z");
  const h20 = Date.parse("2026-10-23T20:00:00.000Z");
  const reconciliar = ({ armed = new Map(), items, now, pageViewStart = h19, queued = new Set() }) =>
    host.reconcileClockOpenings({
      armed,
      items,
      openings: host.openingsForPageView({ items, now, offsetMs: 0, onlyClock: true, pageKey: "saved", pageViewStart, random: meio }),
      pageKey: "saved",
      queued
    });
  const vivo = (startsAt, extra = {}) => item({ notBefore: null, startsAt: iso(startsAt), ...extra });

  // Pagina aberta as 19:00 sem o pop-up; as 19:30 chega um plano com Comeca 20:00.
  const chegou = reconciliar({ items: [vivo(h20)], now: h19 + 30 * MINUTO });
  assert.deepEqual(chegou.disarm, []);
  assert.deepEqual(chegou.arm.map((armed) => [armed.key, armed.at]), [[`live@${iso(h20)}`, h20 + 7_000]]);

  // Pagina aberta antes da publicacao; o plano novo chega as 20:05 com Comeca 20:00: abre na hora.
  const atrasado = reconciliar({ items: [vivo(h20)], now: h20 + 5 * MINUTO });
  assert.ok(atrasado.arm[0].at < h20 + 5 * MINUTO, "at ja vencido");

  const armadas = new Map([["live", `live@${iso(h20)}`]]);

  // A equipe adiantou para 19:45.
  const adiantou = reconciliar({ armed: armadas, items: [vivo(h20 - 15 * MINUTO)], now: h19 + 31 * MINUTO });
  assert.deepEqual(adiantou.disarm, ["live"]);
  assert.deepEqual(adiantou.arm.map((armed) => armed.key), [`live@${iso(h20 - 15 * MINUTO)}`]);

  assert.deepEqual(reconciliar({ armed: armadas, items: [vivo(h20)], now: h19 + 31 * MINUTO }), { arm: [], disarm: [] }, "mesma hora: nada");
  assert.deepEqual(
    reconciliar({ armed: new Map(), items: [vivo(h20)], now: h19 + 31 * MINUTO, queued: new Set(["live"]) }),
    { arm: [], disarm: [] },
    "ja entrou na fila nesta visualizacao"
  );
  assert.deepEqual(reconciliar({ armed: armadas, items: [], now: h19 + 31 * MINUTO }), { arm: [], disarm: ["live"] }, "saiu do plano (segmento, pausado)");
  assert.deepEqual(
    reconciliar({ armed: armadas, items: [vivo(h20, { pages: ["home"] })], now: h19 + 31 * MINUTO }),
    { arm: [], disarm: ["live"] },
    "agora so em outra pagina"
  );
  assert.deepEqual(
    reconciliar({ armed: armadas, items: [vivo(h19 - 30 * MINUTO)], now: h19 + 31 * MINUTO }),
    { arm: [], disarm: [] },
    "Comeca foi para antes da abertura da pagina: fica como estava (o show decide)"
  );
  assert.deepEqual(
    reconciliar({ armed: armadas, items: [item()], now: h19 + 31 * MINUTO }),
    { arm: [], disarm: [] },
    "o Comeca saiu: fica como estava"
  );

  // Um pop-up publicado depois, sem Comeca, fica para a proxima pagina (nada de reler em laco).
  assert.deepEqual(reconciliar({ items: [item({ id: "novo" })], now: h19 + 31 * MINUTO }), { arm: [], disarm: [] });
});

// --- 12. O relogio de parede -------------------------------------------------------------------------------

/** Temporizadores de mentira: so disparam quando o teste manda (o aparelho dormindo nao dispara nada). */
function temporizadores() {
  let proximo = 1;
  const ativos = new Map();
  const cancelados = [];

  return {
    ativos,
    cancelados,
    clearTimeout: (id) => {
      cancelados.push(id);
      ativos.delete(id);
    },
    disparar(ate) {
      for (;;) {
        const [id, timer] = [...ativos].sort((a, b) => a[1].when - b[1].when)[0] ?? [];

        if (!timer || timer.when > ate) {
          return;
        }

        ativos.delete(id);
        relogio = timer.when;
        timer.callback();
      }
    },
    setTimeout: (callback, ms) => {
      const id = proximo;
      proximo += 1;
      ativos.set(id, { callback, ms, when: relogio + ms });
      return id;
    }
  };
}

let relogio = 0;

test("nextWakeDelay: no maximo 30 s, 0 quando venceu", () => {
  assert.equal(host.nextWakeDelay(agora + HORA, agora), 30_000);
  assert.equal(host.nextWakeDelay(agora + 12_000, agora), 12_000);
  assert.equal(host.nextWakeDelay(agora, agora), 0);
  assert.equal(host.nextWakeDelay(agora - 5, agora), 0);
});

test("despertador: segue a hora de parede de 30 em 30 s e abre na hora; o aparelho que dormiu abre na volta (checkDue) e o temporizador velho e cancelado", () => {
  relogio = 1_000_000;
  const timers = temporizadores();
  const venceu = [];
  const despertador = host.createArmedClock({ now: () => relogio, onDue: (armed) => venceu.push([armed.key, relogio]), timers });

  despertador.arm(naPagina({ at: relogio + 65_000, key: "a" }));
  assert.deepEqual([...timers.ativos.values()].map((timer) => timer.ms), [30_000], "nunca um temporizador de horas");
  timers.disparar(relogio + 65_000);
  assert.deepEqual(venceu, [["a", 1_065_000]], "30 s + 30 s + 5 s: na hora");

  // Armada para daqui a 1 h; o aparelho dorme e o relogio salta 1 h sem nenhum temporizador disparar.
  despertador.arm(naPagina({ at: relogio + HORA, clock: true, giveUpAt: null, key: "live@20:00" }));
  const velho = [...timers.ativos.keys()][0];
  relogio += HORA + 10_000;
  despertador.checkDue(); // visibilitychange visivel, pageshow persisted ou focus
  assert.deepEqual(venceu.at(-1), ["live@20:00", relogio]);
  assert.ok(timers.cancelados.includes(velho), "o temporizador velho foi cancelado");
  assert.equal(timers.ativos.size, 0);

  // Antes da hora, a conferencia de volta nao abre nada.
  despertador.arm(naPagina({ at: relogio + MINUTO, key: "b" }));
  despertador.checkDue();
  assert.equal(venceu.length, 2);

  // Cancelar (a equipe mudou a hora) e parar (fim da pagina) nao deixam nada para tras.
  despertador.cancel("b");
  assert.equal(timers.ativos.size, 0);
  despertador.arm(naPagina({ at: relogio + MINUTO, key: "c" }));
  despertador.stop();
  timers.disparar(relogio + HORA);
  despertador.checkDue();
  assert.equal(venceu.length, 2);
});

test("guarda: o host confere o que venceu na volta da aba, do cache e no foco, ouve o plano novo e arma de novo so no not_started", () => {
  assert.match(hostSource, /function handleVisibility\(\) \{\s*if \(document\.visibilityState === "visible"\) \{\s*checkDue\(\);/);
  assert.match(hostSource, /function handlePageShow\(event: PageTransitionEvent\) \{\s*if \(!event\.persisted\) \{\s*return;\s*\}\s*\/\/[^\n]*\n\s*checkDue\(\);/);
  assert.match(hostSource, /window\.addEventListener\("focus", checkDue\);/);
  assert.match(hostSource, /document\.addEventListener\("visibilitychange", handleVisibility\);/);
  assert.match(hostSource, /const stopMemory = subscribePopupMemory\(handleNewPlan\);/);
  assert.match(hostSource, /refused && error\.reason === "not_started" && error\.nextAt/);
  assert.match(hostSource, /stopWaiting = waitLessonFullscreenEnd\(resume\);/);
  assert.match(hostSource, /courseCompleted,\s*items: plan\.items,/);
  assert.match(hostSource, /e do despertador de ate 30 s de uma\n\/\/ abertura armada \(so o relogio do navegador; nenhum pedido em laco\)/);
  assert.doesNotMatch(hostSource, /setInterval/, "nada em intervalo no host");
});

// --- 13. A tela cheia avisada so por mensagem ----------------------------------------------------------------

test("waitLessonFullscreenEnd: a tela cheia do Vimeo (so por mensagem) segura e libera; sem aviso, a conferencia de 1 s libera", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  novaPagina();
  montarPalco();
  media.announceLessonMedia(embed({ fullscreen: true }));
  let voltou = 0;
  const parar = media.waitLessonFullscreenEnd(() => {
    voltou += 1;
  });

  t.mock.timers.tick(3_000);
  fakeDocument.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(voltou, 0, "ainda em tela cheia");
  media.announceLessonMedia(embed({ fullscreen: false }));
  assert.equal(voltou, 1, "o sinal da ponte libera a fila");
  media.announceLessonMedia(embed({ fullscreen: false }));
  t.mock.timers.tick(3_000);
  assert.equal(voltou, 1, "uma vez so");
  parar();

  // A tela cheia do document que acaba sem aviso nenhum: a conferencia de 1 s libera.
  fakeDocument.fullscreenElement = palco;
  const parar2 = media.waitLessonFullscreenEnd(() => {
    voltou += 1;
  });
  t.mock.timers.tick(2_000);
  assert.equal(voltou, 1);
  fakeDocument.fullscreenElement = null;
  t.mock.timers.tick(1_000);
  assert.equal(voltou, 2);
  parar2();

  // Fora da aula (sem palco): so o document; o aviso do document tambem libera na hora.
  palco = null;
  fakeDocument.fullscreenElement = {};
  const parar3 = media.waitLessonFullscreenEnd(() => {
    voltou += 1;
  });
  fakeDocument.fullscreenElement = null;
  fakeDocument.dispatchEvent(new Event("webkitendfullscreen"));
  assert.equal(voltou, 3);
  parar3();
});
