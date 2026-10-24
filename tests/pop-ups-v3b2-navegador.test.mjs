import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O navegador do aluno na v3b-2 (docs/29 §4.1, §4.3 e §4.5): a hora marcada (o pop-up com Comeca arma para a hora do servidor,
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
const bridge = await import("../src/lib/lesson-embed-bridge.ts");
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

/** O ambiente que o host monta do snapshot (member-popup-host.tsx, env()). */
const ambienteDaAula = () => {
  const snap = media.lessonMediaSnapshot();
  return ambiente({ lesson: { activeLessonId: snap.activeLessonId, bridge: snap.bridge, playing: snap.playing, readable: snap.readable, touched: snap.touched } });
};

const VIMEO = "https://player.vimeo.com/video/76979871";

/**
 * A sessao da ponte de verdade (a logica do hook use-lesson-embed-bridge) anunciando ao modulo do sinal, com um
 * iframe de mentira que recebe mensagens do "Vimeo" pela janela da ponte.
 */
function sessaoDaPonte() {
  const win = Object.assign(new EventTarget(), {
    clearInterval: (id) => globalThis.clearInterval(id),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms)
  });
  const nada = () => undefined;
  const sessao = bridge.createEmbedBridgeSession({
    announce: (signal) => media.announceLessonMedia({ bridge: signal.bridge, fullscreen: signal.fullscreen, kind: "embed", lessonId: signal.lessonId, playing: signal.playing }),
    callbacks: () => ({ onEnded: nada, onPause: nada, onPlay: nada, onTime: nada }),
    now: () => agora,
    win
  });
  const novoIframe = () => Object.assign(new EventTarget(), { contentWindow: { postMessage: nada } });
  const mensagem = (iframe, data) => win.dispatchEvent(Object.assign(new Event("message"), { data, origin: "https://player.vimeo.com", source: iframe.contentWindow }));

  return { mensagem, novoIframe, sessao };
}

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

test("segunda tentativa com o relogio acertado pelo asOf do 409 (o relogio do navegador mudou depois do plano), nao pelo acerto do plano", () => {
  // O plano chegou com o servidor 2 min "a frente" (o relogio do navegador estava 2 min atrasado); depois o sistema
  // acertou o relogio: agora o navegador e o servidor batem. O show saiu 2 min antes da hora e o servidor recusou.
  const comeca = agora + 5 * MINUTO;
  const doPlano = 120_000;
  const [armada] = abrir([agendado(comeca)], { offsetMs: doPlano });
  assert.equal(armada.clock, true);
  assert.equal(armada.at + doPlano, comeca + 2_000 + 2_000 + 3_000, "armou pelo acerto do plano");

  const recusa = { asOf: iso(agora), nextAt: iso(comeca) };
  const fresco = host.clockOffsetOf(recusa.asOf, agora);
  assert.equal(fresco, 0, "a recusa diz: servidor = navegador agora");

  const velho = host.rearmAfterNotStarted(armada, recusa.nextAt, doPlano, agora, meio);
  assert.ok(velho.at + fresco < comeca + host.POPUP_HOST_RULES.liveStartMarginMs, "com o acerto velho a segunda tentativa cairia de novo 2 min antes da hora do servidor");

  const novo = host.rearmAfterNotStarted(armada, recusa.nextAt, fresco, agora, meio);
  assert.ok(novo.at + fresco >= comeca + host.POPUP_HOST_RULES.liveStartMarginMs, "com o acerto da recusa, na hora do servidor (com a folga)");
  assert.equal(novo.at, comeca + 2_000 + 2_000 + 3_000);
  assert.equal(novo.key, `live@${recusa.nextAt}`);

  // O host usa o asOf da recusa quando ele veio; sem ele, o acerto do plano.
  assert.match(hostSource, /const offset = error\.asOf \? clockOffsetOf\(error\.asOf, Date\.now\(\)\) : offsetMs;/);
  assert.match(hostSource, /rearmAfterNotStarted\(armed, error\.nextAt, offset, Date\.now\(\)\)/);
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

test("blockReason (docs/29 §1.4 e §4.5): na aula, o momento de pagina espera o video parar em todo player que a pagina le", () => {
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
  const concluir = (extra = {}) =>
    host.completionOpenings({ activeLessonId: "ultima", contentId: "curso-x", courseCompleted: true, items: itens, lessonId: "ultima", now: agora, offsetMs: 0, playing: true, turn: 1, ...extra });
  const fechou = concluir();

  assert.deepEqual(
    fechou.map(({ at, clock, giveUpAt, id, key, lessonId, playingAtCompletion, trigger }) => ({ at, clock, giveUpAt, id, key, lessonId, playingAtCompletion, trigger })),
    [
      { at: agora, clock: false, giveUpAt: agora + 10 * MINUTO, id: "curso", key: "curso:course:1", lessonId: "ultima", playingAtCompletion: true, trigger: "course_completed" },
      { at: agora + 2_000, clock: false, giveUpAt: agora + 2_000 + 10 * MINUTO, id: "aula", key: "aula:ultima", lessonId: "ultima", playingAtCompletion: true, trigger: "lesson_completed" }
    ]
  );

  const semCurso = concluir({ courseCompleted: false, playing: false });
  assert.deepEqual(semCurso.map((armed) => armed.key), ["aula:ultima"]);

  // Desmarcar e concluir de novo a mesma aula na mesma pagina: a segunda virada e outra chave (outra chance); a da
  // aula continua uma por aula (mesma chave, nao arma de novo).
  const deNovo = concluir({ now: agora + MINUTO, turn: 2 });
  assert.deepEqual(deNovo.map((armed) => armed.key), ["curso:course:2", "aula:ultima"]);
  assert.notEqual(deNovo[0].key, fechou[0].key, "duas viradas, duas aberturas do curso");
});

test("Ao concluir um curso: a aula armada e a que esta na tela (o check de outra aula na playlist nao e 'outra aula'); so a troca de aula depois descarta", () => {
  const itens = [item({ delaySeconds: 0, id: "curso", pages: ["lesson:*"], trigger: "course_completed" }), item({ id: "aula", pages: ["lesson:*"], trigger: "lesson_completed" })];
  // Na tela, aula-5; a aluna marcou o check da aula-2 na playlist e isso fechou o curso.
  const [curso, daAula] = host.completionOpenings({ activeLessonId: "aula-5", contentId: "curso-x", courseCompleted: true, items: itens, lessonId: "aula-2", now: agora, offsetMs: 0, playing: false, turn: 1 });

  assert.equal(curso.lessonId, "aula-5", "o curso: a aula na tela");
  assert.equal(curso.key, "curso:course:1");
  assert.equal(daAula.lessonId, "aula-2", "a aula: a concluida, como antes");
  assert.equal(daAula.key, "aula:aula-2");

  assert.equal(host.blockReason(ambiente({ lesson: aula({ activeLessonId: "aula-5" }) }), curso, "before_show"), null, "aula-5 continua na tela: abre");
  assert.equal(host.blockReason(ambiente({ lesson: aula({ activeLessonId: "aula-5" }) }), daAula, "before_show"), "left_lesson", "a aula concluida nao e a da tela: como antes");
  assert.equal(host.blockReason(ambiente({ lesson: aula({ activeLessonId: "aula-6" }) }), curso, "before_show"), "left_lesson", "trocou de aula depois de concluir: descarta");

  // Sem palco (snapshot sem aula na tela), a aula concluida vale.
  assert.equal(host.completionOpenings({ activeLessonId: null, contentId: "curso-x", courseCompleted: true, items: itens, lessonId: "aula-2", now: agora, offsetMs: 0, playing: false, turn: 1 })[0].lessonId, "aula-2");

  // O host conta as viradas da visualizacao e passa a aula na tela.
  assert.match(hostSource, /let courseTurns = 0;/);
  assert.match(hostSource, /if \(courseCompleted\) \{\s*courseTurns \+= 1;\s*\}/);
  assert.match(hostSource, /const \{ activeLessonId, playing \} = lessonMediaSnapshot\(\);/);
  assert.match(hostSource, /activeLessonId,\s*contentId,\s*courseCompleted,\s*items: plan\.items,/);
  assert.match(hostSource, /playing,\s*turn\s*\}\)/);
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
  assert.equal(media.lessonMediaSnapshot().bridge, "pending", "o palco mostra o player da lista desde a abertura");
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

test("troca de aula dentro da pagina: o player da lista da aula nova reabre a janela pendente (bridge_pending, nao touched) ate a ponte dela falar", () => {
  const abriu = agora;
  const { mensagem, novoIframe, sessao } = sessaoDaPonte();

  try {
    novaPagina();
    montarPalco({ src: VIMEO });
    const primeiro = novoIframe();
    sessao.set({ enabled: true, iframe: primeiro, lessonId: "aula-1", src: VIMEO });
    mensagem(primeiro, { event: "ready" });
    mensagem(primeiro, { method: "getPaused", value: false });
    assert.deepEqual([media.lessonMediaSnapshot().bridge, media.lessonMediaSnapshot().playing], ["confirmed", true], "a ponte da aula-1 confirmou tocando");

    // A aluna mexeu no player (tela de toque) e assistiu 60 s; o pop-up "Ao abrir a página" espera o video parar.
    toque = true;
    agora = abriu + MINUTO;
    assert.equal(host.blockReason(ambienteDaAula(), naPagina(), "before_show"), "playing");
    const motivos = [];
    const parar = media.waitLessonMediaStop(() => motivos.push(host.blockReason(ambienteDaAula(), naPagina(), "before_show")));

    // Troca de aula pela playlist: o DOM ja mostra a aula-2 (outro Vimeo) quando a ponte da aula-1 se despede com
    // playing: false, que acorda a espera; a ponte da aula-2 ainda nem anunciou.
    montarPalco({ lessonId: "aula-2", src: `${VIMEO}1` });
    sessao.set({ enabled: true, iframe: novoIframe(), lessonId: "aula-2", src: `${VIMEO}1` });
    assert.deepEqual(motivos, ["bridge_pending"], "era touched (descartava): a janela pendente recomeca na troca");
    parar();

    // Com a ponte da aula-2 pendente de verdade, continua pendente; sem resposta, acaba.
    assert.equal(media.lessonMediaSnapshot().bridge, "pending");
  } finally {
    sessao.stop();
    agora = abriu;
  }
});

test("troca para um player da lista 40 s depois de a pagina abrir: pendente por 15 s a partir da troca, depois nada", () => {
  const abriu = agora;

  novaPagina();
  montarPalco({ kind: "youtube", src: "https://www.youtube.com/embed/x" });
  media.announceLessonMedia({ kind: "youtube", playing: true });
  agora = abriu + 40_000;
  assert.equal(host.blockReason(ambienteDaAula(), naPagina(), "before_show"), "playing");

  const motivos = [];
  const parar = media.waitLessonMediaStop(() => motivos.push(host.blockReason(ambienteDaAula(), naPagina(), "before_show")));

  montarPalco({ lessonId: "aula-2", src: VIMEO });
  media.announceLessonMedia({ kind: "youtube", playing: false }); // o efeito do YouTube desmontando
  assert.deepEqual(motivos, ["bridge_pending"], "a janela conta da troca, nao da abertura da pagina (40 s atras)");
  parar();

  agora = abriu + 40_000 + origins.EMBED_BRIDGE_RULES.pendingMaxMs - 1;
  assert.equal(media.lessonMediaSnapshot().bridge, "pending");
  agora = abriu + 40_000 + origins.EMBED_BRIDGE_RULES.pendingMaxMs;
  assert.equal(media.lessonMediaSnapshot().bridge, "none", "15 s depois da troca: a regra de antes (mexeu = descarta)");
  assert.equal(host.blockReason(ambienteDaAula(), naPagina(), "before_show"), "touched");

  // Voltar para a aula-1 (YouTube) e de novo para a aula-2: o palco voltou a mostrar o player da lista, a janela recomeca.
  montarPalco({ kind: "youtube", src: "https://www.youtube.com/embed/x" });
  assert.equal(media.lessonMediaSnapshot().bridge, "none");
  montarPalco({ lessonId: "aula-2", src: VIMEO });
  assert.equal(media.lessonMediaSnapshot().bridge, "pending");
  // A mesma aula na tela, o tempo passando: a janela nao recomeca sozinha.
  agora += origins.EMBED_BRIDGE_RULES.pendingMaxMs;
  assert.equal(media.lessonMediaSnapshot().bridge, "none");
  montarPalco({ lessonId: "aula-2", src: VIMEO });
  assert.equal(media.lessonMediaSnapshot().bridge, "none", "redesenhar o mesmo palco nao e troca");
  montarPalco({ lessonId: "aula-2", src: VIMEO });

  // O sinal da aula na tela sempre vence a janela.
  media.announceLessonMedia(embed({ bridge: "silent", lessonId: "aula-2" }));
  assert.equal(media.lessonMediaSnapshot().bridge, "none");
  agora = abriu;
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
      now,
      offsetMs: 0,
      openings: host.openingsForPageView({ items, now, offsetMs: 0, onlyClock: true, pageKey: "saved", pageViewStart, random: meio }),
      pageKey: "saved",
      queued,
      random: meio
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
  // O Comeca foi para antes da abertura da pagina (18:30): a hora velha (20:00) nao vale mais; abre agora, com o
  // sorteio e a espera, sem desistir, com a chave da hora nova.
  const agoraMesmo = h19 + 31 * MINUTO;
  const voltou = reconciliar({ armed: armadas, items: [vivo(h19 - 30 * MINUTO)], now: agoraMesmo });
  assert.deepEqual(voltou.disarm, ["live"], "Comeca foi para antes da abertura da pagina: desarma a hora velha");
  assert.deepEqual(voltou.arm, [
    {
      at: agoraMesmo + 2_000 + 3_000,
      clock: true,
      delayMs: 3_000,
      giveUpAt: null,
      id: "live",
      key: `live@${iso(h19 - 30 * MINUTO)}`,
      lessonId: null,
      playingAtCompletion: false,
      rearmed: false,
      startsAt: iso(h19 - 30 * MINUTO),
      trigger: "page_load"
    }
  ]);
  assert.deepEqual(
    reconciliar({ armed: new Map([["live", voltou.arm[0].key]]), items: [vivo(h19 - 30 * MINUTO)], now: agoraMesmo + MINUTO }),
    { arm: [], disarm: [] },
    "o mesmo plano de novo: ja armado com essa chave, nada"
  );

  // O Comeca saiu ("Ao publicar"): idem, com a chave `@now` e sem startsAt.
  const saiu = reconciliar({ armed: armadas, items: [item()], now: agoraMesmo });
  assert.deepEqual(saiu.disarm, ["live"], "o Comeca saiu: desarma a hora velha");
  assert.deepEqual(saiu.arm.map(({ at, clock, giveUpAt, key }) => ({ at, clock, giveUpAt, key })), [{ at: agoraMesmo + 2_000 + 3_000, clock: true, giveUpAt: null, key: "live@now" }]);
  assert.equal("startsAt" in saiu.arm[0], false);
  assert.deepEqual(reconciliar({ armed: new Map([["live", "live@now"]]), items: [item()], now: agoraMesmo + MINUTO }), { arm: [], disarm: [] }, "de novo: nada");
  assert.deepEqual(
    reconciliar({ armed: armadas, items: [item({ notBefore: iso(agoraMesmo + 10 * MINUTO) })], now: agoraMesmo }),
    { arm: [], disarm: ["live"] },
    "a frequencia nao deixa agora: so desarma (a proxima pagina decide)"
  );

  // Um pop-up publicado depois, sem Comeca, fica para a proxima pagina (nada de reler em laco).
  assert.deepEqual(reconciliar({ items: [item({ id: "novo" })], now: h19 + 31 * MINUTO }), { arm: [], disarm: [] });
});

test("newPlanAction: a resposta nova que nao cobre mais a pagina desarma a hora marcada; a falha e a memoria vencida nao mexem em nada", () => {
  const plano = [item()];

  assert.equal(host.newPlanAction(null), "skip", "memoria vencida (ou nunca houve resposta)");
  assert.equal(host.newPlanAction({ answered: false, covered: false, plan: null }), "skip", "o pedido falhou: nada se sabe");
  assert.equal(host.newPlanAction({ answered: true, covered: false, plan: null }), "disarm_all", "o unico pop-up que cobria a pagina pausou ou encerrou");
  assert.equal(host.newPlanAction({ answered: true, covered: true, plan: null }), "disarm_all", "coberta sem plano: a resposta veio de outra pagina (sem o plano desta), nada a armar");
  assert.equal(host.newPlanAction({ answered: true, covered: true, plan: plano }), "reconcile");

  // O host: null ou "skip" sai; "disarm_all" desarma toda hora marcada que ainda nao entrou na fila; senao reconcilia.
  assert.match(hostSource, /const action = newPlanAction\(kept\);\s*if \(cancelled \|\| !kept \|\| action === "skip"\) \{\s*return;\s*\}/);
  assert.match(hostSource, /if \(action === "disarm_all" \|\| !kept\.plan\) \{[\s\S]*?\[\.\.\.clockKeys\.keys\(\)\]\.filter\(\(id\) => !queued\.has\(id\)\)\.forEach\(cancelClock\);\s*return;\s*\}/);
  assert.match(hostSource, /reconcileClockOpenings\(\{\s*armed: clockKeys,\s*items: kept\.plan,\s*now,\s*offsetMs: kept\.offsetMs,/);
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
