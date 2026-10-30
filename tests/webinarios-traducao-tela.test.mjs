import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A traducao do chat na tela (docs/30 §1.6, fase 4f; docs/18 §2.2), desenhada no Node sem navegador: o seletor em
// Perfil › Privacidade (Como foi escrito, Português, English, Español, o Salvar, a frase das legendas; carregando,
// escolhido, desligado e a previa da equipe), o hook da sala devolvendo as mensagens com o corpo traduzido que a
// memoria guardou (as do proprio aluno e sem traducao como vieram; desligado, sem idioma ou no "ver como", tudo como
// veio), uma rodada da consulta de 5 s com um fetch falso (so as dos outros, ate 100, o que ja tem resposta nao volta,
// a pendente ate 6 vezes, desligado pela sala, o Retry-After), a faixa "Chat traduzido para English" com "Ver original"
// e o codigo do navegador sem node:crypto nem o provedor.

const privacy = await import("../src/components/member/webinars/webinar-chat-privacy.tsx");
const preference = await import("../src/components/member/webinars/translation/chat-language-preference.tsx");
const bar = await import("../src/components/member/webinars/translation/room-translation-bar.tsx");
const hook = await import("../src/components/member/webinars/room/use-room-translation.ts");
const cache = await import("../src/components/member/webinars/translation/room-translation-cache.ts");
const api = await import("../src/components/member/webinars/translation/translation-api.ts");
const { TRANSLATION_MAX_ATTEMPTS, TRANSLATION_POLL_MS } = await import("../src/server/webinars/translation-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const copy = WEBINAR_COPY.traducao;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WEBINAR = id(900);
const SESSION = id(901);
const msg = (n, extra = {}) => ({ body: `texto ${n}`, displayName: "Ana S.", id: id(n), kind: "message", mine: false, offsetMs: 1000 * n, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

/** Um componente de prova: o que o hook devolve, uma linha por mensagem. */
function Probe(props) {
  const state = hook.useRoomTranslation(props);
  return createElement(
    "ul",
    { "data-language": state.language ?? "", "data-translated": state.translated },
    state.messages.map((message) => createElement("li", { "data-id": message.id, key: message.id }, message.body))
  );
}

const bodiesOf = (html) => [...html.matchAll(/<li data-id="([^"]+)">([^<]*)<\/li>/g)].map((match) => [match[1], match[2]]);

/* ------------------------------------------------------------------------------------------------
 * Perfil › Privacidade
 * ---------------------------------------------------------------------------------------------- */

test("Perfil › Privacidade: o seletor do idioma do chat abaixo do Remover minhas mensagens, carregando ate ler", () => {
  cache.resetRoomTranslationCache();
  const html = render(privacy.WebinarChatPrivacy, {});
  assert.match(html, /Remover minhas mensagens/, "o cartao de antes continua");
  assert.ok(html.indexOf("Remover minhas mensagens") < html.indexOf(copy.titulo), "o idioma vem depois");
  assert.ok(html.includes(copy.titulo));
  assert.ok(html.includes(copy.descricao));
  for (const label of [copy.comoFoiEscrito, "Português", "English", "Español"]) {
    assert.ok(html.includes(label), label);
  }
  assert.equal((html.match(/type="radio"/g) ?? []).length, 4);
  assert.match(html, /<span lang="en">English<\/span>/, "o leitor de tela le cada idioma no proprio idioma");
  assert.ok(html.includes(copy.legendasDeFora), "as legendas do video ficam de fora");
  assert.ok(html.includes(copy.salvar));
  assert.ok(html.includes(copy.carregando), "antes de ler o idioma do aluno");
  assert.match(html, /<fieldset[^>]*disabled/, "nada a escolher antes de ler");
  assert.match(html, /aria-live="polite"/);
});

test("o seletor com o idioma lido: a escolha marcada, o Salvar so com mudanca; desligado mostra a frase; a previa da equipe desliga", () => {
  cache.resetRoomTranslationCache();
  const chosen = render(preference.ChatLanguagePreference, { initial: { chatLanguage: "en", enabled: true } });
  assert.match(chosen, /<input[^>]*checked=""[^>]*value="en"/);
  assert.doesNotMatch(chosen, /<fieldset[^>]*disabled/);
  assert.match(chosen, /<button[^>]*disabled=""[^>]*type="submit"[^>]*>Salvar idioma|<button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar idioma/, "nada mudou: o Salvar espera");
  assert.ok(!chosen.includes(copy.carregando));

  const original = render(preference.ChatLanguagePreference, { initial: { chatLanguage: null, enabled: true } });
  assert.match(original, /<input[^>]*checked=""[^>]*value="original"/, "nulo = Como foi escrito");

  const off = render(privacy.WebinarChatPrivacy, { translation: { chatLanguage: null, enabled: false } });
  assert.ok(off.includes(copy.desligada));
  assert.doesNotMatch(off, /type="radio" value="en"|value="en"/, "sem seletor quando desligado");

  const preview = render(privacy.WebinarChatPrivacy, { readOnly: true });
  assert.match(preview, /<fieldset[^>]*disabled/);
  assert.ok(!preview.includes(copy.carregando), "a previa nao le nada");
  assert.ok(preview.includes(WEBINAR_COPY.aluno.previaSemGravar));
});

test("o seletor segue a memoria da pagina: o idioma salvo (aqui ou na sala) vale sem ler de novo", () => {
  cache.resetRoomTranslationCache();
  cache.rememberViewerPrefs({ chatLanguage: "es", enabled: true });
  const html = render(preference.ChatLanguagePreference, {});
  assert.match(html, /<input[^>]*checked=""[^>]*value="es"/);
  assert.ok(!html.includes(copy.carregando));
  cache.resetRoomTranslationCache();
});

/* ------------------------------------------------------------------------------------------------
 * O hook da sala
 * ---------------------------------------------------------------------------------------------- */

test("o hook: com o idioma e a memoria, as mensagens saem com o corpo traduzido; as do aluno e as sem traducao, como vieram", () => {
  cache.resetRoomTranslationCache();
  cache.rememberViewerPrefs({ chatLanguage: "en", enabled: true });
  const key = cache.translationMemoryKey(WEBINAR, SESSION, "en");
  cache.rememberRoomAnswer(key, [id(1), id(2), id(3)], { pending: [id(3)], translations: [{ body: "hello class", id: id(1) }, { body: "the link is pinned", id: id(2) }] });

  const messages = [msg(1, { body: "oi turma" }), msg(2, { body: "o link esta fixado", role: "team" }), msg(3), msg(4, { body: "minha mensagem", mine: true })];
  const html = render(Probe, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR });
  assert.deepEqual(bodiesOf(html), [
    [id(1), "hello class"],
    [id(2), "the link is pinned"],
    [id(3), "texto 3"],
    [id(4), "minha mensagem"]
  ]);
  assert.match(html, /data-language="en"/);
  assert.match(html, /data-translated="2"/);
  assert.equal(messages[0].body, "oi turma", "a original nao muda");

  // Outra sessao (ou outro idioma): memoria propria, nada trocado.
  assert.deepEqual(bodiesOf(render(Probe, { enabled: true, messages, sessionId: id(902), webinarId: WEBINAR }))[0], [id(1), "oi turma"]);
});

test("o hook: no 'ver como' (enabled falso), sem idioma ou com a traducao desligada, tudo como veio", () => {
  cache.resetRoomTranslationCache();
  const key = cache.translationMemoryKey(WEBINAR, SESSION, "en");
  cache.rememberRoomAnswer(key, [id(1)], { pending: [], translations: [{ body: "hello", id: id(1) }] });
  const messages = [msg(1, { body: "oi" })];

  cache.rememberViewerPrefs({ chatLanguage: "en", enabled: true });
  assert.deepEqual(bodiesOf(render(Probe, { enabled: false, messages, sessionId: SESSION, webinarId: WEBINAR })), [[id(1), "oi"]], "ver como");

  cache.rememberViewerPrefs({ chatLanguage: null, enabled: true });
  assert.deepEqual(bodiesOf(render(Probe, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR })), [[id(1), "oi"]], "como foi escrito");

  cache.rememberViewerPrefs({ chatLanguage: "en", enabled: false });
  const off = render(Probe, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR });
  assert.deepEqual(bodiesOf(off), [[id(1), "oi"]], "desligada no ambiente");
  assert.match(off, /data-language=""/);

  cache.resetRoomTranslationCache();
  assert.deepEqual(bodiesOf(render(Probe, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR })), [[id(1), "oi"]], "antes de ler o idioma (primeira pintura)");
});

test("uma rodada da consulta: so as dos outros e ainda sem resposta, ate 100; a pendente volta ate o limite; desligado e Retry-After", async () => {
  cache.resetRoomTranslationCache();
  cache.rememberViewerPrefs({ chatLanguage: "en", enabled: true });
  const key = cache.translationMemoryKey(WEBINAR, SESSION, "en");
  const messages = [msg(1), msg(2), msg(3, { mine: true }), { ...msg(4), id: "otimista-1" }, ...Array.from({ length: 110 }, (_, n) => msg(100 + n))];
  const pedidos = [];
  let resposta = (ids) => ({ enabled: true, pending: [id(2)], translations: [{ body: "one", id: id(1) }].filter((item) => ids.includes(item.id)) });
  const fetchTranslations = async (ids) => {
    pedidos.push(ids);
    return resposta(ids);
  };

  const primeira = await cache.pollRoomTranslations({ fetchTranslations, key, messages });
  assert.equal(pedidos[0].length, 100, "lotes de ate 100");
  assert.equal(pedidos[0][0], id(1));
  assert.ok(!pedidos[0].includes(id(3)), "a do proprio aluno fica como ele escreveu");
  assert.ok(!pedidos[0].includes("otimista-1"), "a otimista ainda nao tem id do banco");
  assert.equal(primeira, 1_000, "sobraram mais de 100: a proxima vem logo");
  assert.equal(cache.translationMemoryOf(key).bodies.get(id(1)), "one");

  const segunda = await cache.pollRoomTranslations({ fetchTranslations, key, messages });
  assert.equal(segunda, TRANSLATION_POLL_MS);
  assert.ok(!pedidos[1].includes(id(1)), "a traduzida nao volta");
  assert.ok(pedidos[1].includes(id(2)), "a pendente volta");
  assert.ok(!pedidos[1].includes(id(100)), "a que voltou como foi escrita nao volta");
  assert.ok(pedidos[1].includes(id(208)), "as que sobraram do primeiro lote");

  for (let rodada = 2; rodada < TRANSLATION_MAX_ATTEMPTS + 2; rodada += 1) {
    await cache.pollRoomTranslations({ fetchTranslations, key, messages });
  }
  const antes = pedidos.length;
  assert.equal(await cache.pollRoomTranslations({ fetchTranslations, key, messages }), TRANSLATION_POLL_MS);
  assert.equal(pedidos.length, antes, "nada mais a pedir: a pendente passou do limite e ficou como foi escrita");

  const outra = cache.translationMemoryKey(WEBINAR, SESSION, "es");
  const erro = Object.assign(new api.WebinarsRequestError(copy.muitosPedidos, 429), { retryAfterSeconds: 7 });
  assert.equal(await cache.pollRoomTranslations({ fetchTranslations: async () => Promise.reject(erro), key: outra, messages: [msg(1)] }), 7_000);
  assert.equal(await cache.pollRoomTranslations({ fetchTranslations: async () => Promise.reject(new Error("rede")), key: outra, messages: [msg(1)] }), TRANSLATION_POLL_MS);

  resposta = () => ({ enabled: false, pending: [], translations: [] });
  await cache.pollRoomTranslations({ fetchTranslations, key: outra, messages: [msg(1)] });
  assert.deepEqual(cache.viewerPrefsSnapshot().value, { chatLanguage: "en", enabled: false }, "a sala disse desligado: a pagina para de pedir");
  cache.resetRoomTranslationCache();
});

test("o idioma e lido uma vez por pagina: quem chega depois espera a mesma leitura; a falha deixa como foi escrito", async () => {
  cache.resetRoomTranslationCache();
  let leituras = 0;
  const load = async () => {
    leituras += 1;
    return { chatLanguage: "pt", enabled: true };
  };
  const [a, b] = await Promise.all([cache.loadViewerPrefsOnce(load), cache.loadViewerPrefsOnce(load)]);
  assert.deepEqual(a, { chatLanguage: "pt", enabled: true });
  assert.deepEqual(b, a);
  await cache.loadViewerPrefsOnce(load);
  assert.equal(leituras, 1);

  cache.resetRoomTranslationCache();
  const falhou = await cache.loadViewerPrefsOnce(async () => Promise.reject(new Error("rede")));
  assert.equal(falhou, null);
  assert.equal(cache.viewerPrefsSnapshot().status, "error");
  cache.resetRoomTranslationCache();
});

test("os caminhos das rotas: ?sessao=&lang=&ids= e /api/webinars/preferences", () => {
  assert.equal(api.translationsPath(WEBINAR, SESSION, "es", [id(1), id(2)]), `/api/webinars/${WEBINAR}/translations?ids=${id(1)}%2C${id(2)}&lang=es&sessao=${SESSION}`);
  assert.equal(api.VIEWER_PREFS_PATH, "/api/webinars/preferences");
});

/* ------------------------------------------------------------------------------------------------
 * A faixa da sala
 * ---------------------------------------------------------------------------------------------- */

test("a faixa: Chat traduzido para English com Ver original; com a original, Ver traducao; Traduzindo… enquanto espera; o seletor sempre na sala", () => {
  const base = { available: true, language: "en", showOriginal: false, toggleOriginal: () => undefined, translated: 2, translating: false };
  const translated = render(bar.RoomTranslationBar, { state: base });
  assert.ok(translated.includes(copy.chatTraduzido("English")));
  assert.match(translated, /<button[^>]*aria-pressed="false"[^>]*>Ver original<\/button>/);
  assert.match(translated, /min-h-11/, "44 px no celular");

  const original = render(bar.RoomTranslationBar, { state: { ...base, showOriginal: true } });
  assert.ok(original.includes(copy.chatOriginal));
  assert.match(original, /aria-pressed="true"[^>]*>Ver tradução</);

  const waiting = render(bar.RoomTranslationBar, { state: { ...base, translated: 0, translating: true } });
  assert.ok(waiting.includes(copy.traduzindo));
  assert.doesNotMatch(waiting, /<button/, "nada para ver original ainda");

  // Sem idioma escolhido, a sala ainda deixa escolher (antes so o Perfil: o aluno tinha de sair da sala).
  const semIdioma = render(bar.RoomTranslationBar, { state: { ...base, language: null, translated: 0 } });
  assert.ok(semIdioma.includes(copy.idiomaDaSala));
  assert.match(semIdioma, /<select[^>]*data-room-translation-language=""[^>]*>/);
  assert.match(semIdioma, /<option[^>]*value="original" selected=""[^>]*>Como foi escrito<\/option>/);
  for (const nome of ["Português", "English", "Español"]) {
    assert.ok(semIdioma.includes(`>${nome}</option>`), nome);
  }
  assert.doesNotMatch(semIdioma, /<button/, "nada para ver original");
  assert.match(translated, /<option[^>]*value="en" selected=""[^>]*>English<\/option>/, "o escolhido marcado");
  assert.match(render(bar.RoomTranslationBar, { state: { ...base, choosing: true } }), /<select[^>]*disabled=""/);
  assert.ok(render(bar.RoomTranslationBar, { state: { ...base, chooseError: copy.erro } }).includes(copy.erro));

  // Desligada (ambiente, banco) ou no "ver como": sem faixa.
  assert.equal(render(bar.RoomTranslationBar, { state: { ...base, available: false } }), "");
  assert.equal(render(bar.RoomTranslationBar, { state: { ...base, available: undefined } }), "");
});

test("o hook na sala: escolher o idioma pelo seletor grava pelo mesmo PUT do Perfil e liga a traducao sem recarregar", async () => {
  cache.resetRoomTranslationCache();
  cache.rememberViewerPrefs({ chatLanguage: null, enabled: true });
  const key = cache.translationMemoryKey(WEBINAR, SESSION, "es");
  cache.rememberRoomAnswer(key, [id(1)], { pending: [], translations: [{ body: "hola clase", id: id(1) }] });
  const messages = [msg(1, { body: "oi turma" })];
  let state = null;
  function Captura(props) {
    state = hook.useRoomTranslation(props);
    return createElement("ul", { "data-language": state.language ?? "" }, state.messages.map((message) => createElement("li", { "data-id": message.id, key: message.id }, message.body)));
  }
  const antes = render(Captura, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR });
  assert.deepEqual(bodiesOf(antes), [[id(1), "oi turma"]]);
  assert.equal(state.available, true, "a faixa mostra o seletor");

  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ body: init?.body, method: init?.method, url: String(url) });
    return new Response(JSON.stringify({ data: { chatLanguage: "es", enabled: true } }), { headers: { "content-type": "application/json" }, status: 200 });
  };
  try {
    await state.chooseLanguage("es");
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(pedidos.map((pedido) => [pedido.method, pedido.url, pedido.body]), [["PUT", api.VIEWER_PREFS_PATH, JSON.stringify({ chatLanguage: "es" })]]);
  assert.equal(cache.viewerPrefsSnapshot().value.chatLanguage, "es", "a memoria da pagina ja tem o idioma novo");
  const depois = render(Captura, { enabled: true, messages, sessionId: SESSION, webinarId: WEBINAR });
  assert.deepEqual(bodiesOf(depois), [[id(1), "hola clase"]], "a mesma sala, agora traduzida");

  // No "ver como", a sala nunca grava nem mostra o seletor.
  render(Captura, { enabled: false, messages, sessionId: SESSION, webinarId: WEBINAR });
  assert.equal(state.available, false);
  cache.resetRoomTranslationCache();
});

test("o codigo do navegador nunca leva node:crypto, o provedor nem server-only", () => {
  const files = [
    "src/components/member/webinars/room/use-room-translation.ts",
    "src/components/member/webinars/webinar-chat-privacy.tsx",
    ...readdirSync(new URL("../src/components/member/webinars/translation/", import.meta.url)).map((name) => `src/components/member/webinars/translation/${name}`)
  ];
  for (const file of files) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /from "node:crypto"|from "[^"]*(?:text-hash|translation-provider|translation-store|webinars\/translation)"|^import "server-only"/m, file);
  }
  const modelCode = readFileSync(new URL("../src/server/webinars/translation-model.ts", import.meta.url), "utf8");
  assert.doesNotMatch(modelCode, /^import "server-only"|from "node:crypto"|from "@\//m, "o modelo e puro (a sala importa)");
});
