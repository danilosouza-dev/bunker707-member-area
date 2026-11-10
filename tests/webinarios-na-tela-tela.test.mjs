import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Na tela na sala do aluno (especificacao de 10/11/2026, §3 e §9; docs/18 §2.2), desenhada no Node pelo HTML do
// servidor, sem navegador. As fixadas (R1 e R2, fatia S8): o link so na mensagem da equipe (target _blank, rel
// "noopener noreferrer nofollow", nenhum href fora de https; a do aluno continua texto), a area das fixadas como um
// espaco do proprio painel (tambem na aba Perguntas) e da gaveta do vertical, o corte em 3 linhas com Mostrar tudo, a
// enquete fixada que recolhe depois da resposta, as pilulas do palco largo e as linhas da faixa do palco estreito como
// botoes, as duas salas com o painel fechado, o vertical (a linha com o link e o Mostrar tudo, o botao "Enquete fixada:
// {pergunta}" que fica depois da resposta) e o aviso com Ver. O painel fechado vem de um duble da escolha guardada
// (use-room-prefs) so para as duas salas: o HTML do servidor sai sempre com o painel aberto.

const ROOM_DIR = new URL("../src/components/member/webinars/room/", import.meta.url).href;
const PREFS = `export function useRoomPanelOpen() {
  return [globalThis.__naTelaPainelAberto ?? true, () => undefined];
}
export function useDeferredPolls() {
  return [{ later: [], seen: [] }, () => undefined];
}
export function useRoomHydrated() {
  return false;
}
export function useRoomTheme() {
  return ["dark", () => undefined];
}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./use-room-prefs" && (context.parentURL === `${ROOM_DIR}webinar-room.tsx` || context.parentURL === `${ROOM_DIR}live-room.tsx`)) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(PREFS)}` };
    }
    return nextResolve(specifier, context);
  }
});

const teamText = await import("../src/components/member/webinars/room/screen/room-team-text.tsx");
const pinnedModule = await import("../src/components/member/webinars/room/screen/room-pinned.tsx");
const chat = await import("../src/components/member/webinars/room/room-chat.tsx");
const panelModule = await import("../src/components/member/webinars/room/room-panel.tsx");
const verticalChat = await import("../src/components/member/webinars/room/vertical/vertical-chat.tsx");
const drawer = await import("../src/components/member/webinars/room/vertical/vertical-drawer.tsx");
const snackbarModule = await import("../src/components/member/webinars/room/room-snackbar.tsx");
const recordedRoom = await import("../src/components/member/webinars/room/webinar-room.tsx");
const liveRoom = await import("../src/components/member/webinars/room/live-room.tsx");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const render = (component, props, ...children) => renderToStaticMarkup(createElement(component, props, ...children));
const noop = () => undefined;
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const at = (ms) => new Date(ms).toISOString();
const msg = (id, extra = {}) => ({ avatarUrl: null, body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", links: false, mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", sentAt: null, ...extra });
const LINK = "https://bunker707.com.br/apostila";
const FIXADA = msg("fx", { body: `Material da aula: ${LINK}. Bom estudo!`, displayName: "Equipe", links: true, pinned: true, role: "team" });
const LONGA = msg("fl", {
  body: `Pessoal, o material completo da aula de hoje esta na apostila: ${LINK}. Leiam antes da proxima aula, porque vamos usar os exemplos dela do comeco ao fim.`,
  displayName: "Danilo S.",
  links: true,
  pinned: true,
  role: "host"
});
const enquete = (extra = {}) => ({ id: "pf", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }, { id: "o2", label: "Não" }], question: "Já usa IA no trabalho?", results: null, status: "open", ...extra });
const TIMING = { kind: "live", nowMs: T0, skewMs: 0, zeroMs: null };
const AREA = { onAnswer: async () => undefined, readOnly: false, timing: TIMING };
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

/** As classes de uma abertura de tag, com o & do HTML de volta. */
const classesDe = (tag) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
/** Os <a> do HTML: o href e o texto visivel. */
const linksDe = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, texto]) => ({ attrs, href: /href="([^"]*)"/.exec(attrs)?.[1] ?? null, texto: texto.replace(/<[^>]+>/g, "") }));

/* ------------------------------------------------------------------------------------------------
 * Os links da equipe (§2 R1.4 e §8.1)
 * ---------------------------------------------------------------------------------------------- */

test("o link da equipe: abre em outra aba com rel noopener noreferrer nofollow e o anel de foco da sala; o texto visivel e o endereco, a pontuacao do fim fica de fora", () => {
  const html = render(teamText.RoomTeamText, { message: msg("e", { body: `Material: ${LINK}. Grupo: https://chat.bunker707.com.br/turma!`, links: true, role: "team" }) });
  const links = linksDe(html);
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.match(link.attrs, /\btarget="_blank"/);
    assert.match(link.attrs, /\brel="noopener noreferrer nofollow"/);
    assert.equal(link.texto, link.href, "o texto visivel e o proprio endereco");
    const classes = classesDe(`<a${link.attrs}>`);
    for (const classe of ["text-room-link", "underline", "focus-visible:outline-room-focus"]) {
      assert.ok(classes.includes(classe), `${classe} no link`);
    }
  }
  assert.deepEqual(
    links.map((link) => link.href),
    [LINK, "https://chat.bunker707.com.br/turma"]
  );
  assert.match(html, /<\/a>\. Grupo: <a /, "o ponto fica fora do link");
  assert.match(html, /turma<\/a>!$/, "a exclamacao tambem");
  // Apresentador e Co-apresentador tambem tem link.
  for (const role of ["host", "co_host"]) {
    assert.equal(linksDe(render(teamText.RoomTeamText, { message: msg("h", { body: LINK, links: true, role }) })).length, 1, role);
  }
});

test("nenhum href fora de https: http, javascript, data, usuario e senha e endereco sem ponto continuam texto, mesmo numa mensagem da equipe", () => {
  const body = "veja http://bunker707.com.br e javascript:alert(1) e data:text/html,oi e https://ana:senha@bunker707.com.br e https://localhost/x";
  const html = render(teamText.RoomTeamText, { message: msg("e", { body, links: true, role: "team" }) });
  assert.doesNotMatch(html, /<a\b|href=/, "nada vira link");
  assert.equal(html, body.replace(/&/g, "&amp;"), "o texto como veio");
});

test("o link de mensagem de aluno continua texto: sem `links`, com o Assistente e ate com um `links` errado no aluno (a defesa a mais)", () => {
  for (const [rotulo, message] of [
    ["aluno", msg("a", { body: `olha ${LINK}`, links: false, role: "student" })],
    ["aluno com links errado", msg("a", { body: `olha ${LINK}`, links: true, role: "student" })],
    ["Assistente", msg("ai", { body: `olha ${LINK}`, links: true, role: "ai" })],
    ["equipe sem links (o roteiro de aluno, o servidor de antes)", msg("t", { body: `olha ${LINK}`, links: false, role: "team" })],
    ["sem o campo", { body: `olha ${LINK}`, role: "team" }]
  ]) {
    const html = render(teamText.RoomTeamText, { message });
    assert.doesNotMatch(html, /<a\b/, rotulo);
    assert.equal(html, `olha ${LINK}`, rotulo);
  }
  assert.equal(teamText.teamLinksOn({ links: true, role: "team" }), true);
  assert.equal(teamText.teamLinksOn({ links: true, role: "student" }), false);
  assert.equal(teamText.teamLinksOn({ links: false, role: "host" }), false);
});

test("as linhas do chat: o comentario, o balao da gaveta e o item por cima do video ligam o link da equipe; a mensagem de aluno com o mesmo endereco fica texto", () => {
  const equipe = msg("e", { body: `Apostila: ${LINK}`, displayName: "Marina R.", links: true, role: "team" });
  const aluno = msg("a", { body: `Achei ${LINK}`, displayName: "Bia C." });
  const base = {
    chatMode: "open",
    consented: true,
    displayName: "Ana S.",
    error: null,
    messages: [equipe, aluno],
    nowMs: T0,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    readOnly: false,
    slowUntilMs: null,
    timeKind: "live"
  };
  for (const look of ["comment", "classic"]) {
    const html = render(chat.RoomChatPanel, { ...base, look });
    const linhaEquipe = elementWith(html, 'data-room-message="e"');
    const linhaAluno = elementWith(html, 'data-room-message="a"');
    assert.equal(linksDe(linhaEquipe).length, 1, `${look}: o link da equipe`);
    assert.equal(linksDe(linhaEquipe)[0].href, LINK);
    assert.doesNotMatch(linhaAluno, /<a\b/, `${look}: o aluno sem link`);
    assert.ok(linhaAluno.includes(`Achei ${LINK}`), `${look}: o endereco do aluno como texto`);
  }
  // O "@assistente" continua em peso 600 no comentario, junto do link.
  const mencao = render(chat.RoomChatPanel, { ...base, messages: [msg("m", { body: `@assistente veja ${LINK}`, links: true, role: "team" })] });
  assert.match(elementWith(mencao, 'data-room-message="m"'), /<span class="font-semibold">@assistente<\/span> veja <a [^>]*href="https:\/\/bunker707\.com\.br\/apostila"/);
  // O item por cima do video (o vertical), com o mesmo componente.
  const porCima = render(verticalChat.VerticalChat, { error: null, joins: null, messages: [equipe, aluno], onMore: noop, onOpenPoll: noop, pinned: null, pollButton: null, replay: false });
  assert.equal(linksDe(elementWith(porCima, 'data-room-message="e"')).length, 1);
  assert.doesNotMatch(elementWith(porCima, 'data-room-message="a"'), /<a\b/);
});

/* ------------------------------------------------------------------------------------------------
 * A area das fixadas (§3.1)
 * ---------------------------------------------------------------------------------------------- */

test("a area das fixadas fica no proprio painel, entre o cabecalho e o conteudo, tambem na aba Perguntas: 40 % da altura no maximo e rolando por dentro; a mensagem antes da enquete", () => {
  const area = createElement(pinnedModule.RoomPinnedArea, { ...AREA, message: FIXADA, poll: enquete() });
  const html = render(panelModule.RoomPanel, {
    children: "conteudo das perguntas",
    closable: true,
    firstFocus: false,
    id: "room-panel",
    kind: "live",
    onClose: noop,
    onTab: noop,
    open: true,
    pinned: area,
    pollOpen: true,
    tab: "perguntas",
    tabs: ["chat", "perguntas", "participantes", "enquetes"]
  });
  const slot = elementWith(html, 'data-room-slot="pinned"');
  assert.ok(slot, "o espaco das fixadas no painel");
  const classes = classesDe(slot.slice(0, slot.indexOf(">") + 1));
  for (const classe of ["max-h-[40%]", "shrink-0", "overflow-y-auto", "lg:border-b", "lg:border-room-panel-border"]) {
    assert.ok(classes.includes(classe), `${classe} no espaco`);
  }
  // A ordem: a linha das abas (abaixo de lg), o cabecalho com o h2 Perguntas (a partir de lg), as fixadas e a aba.
  const ordem = ['role="tablist"', 'id="room-panel-title">Perguntas', 'data-room-slot="pinned"', 'role="tabpanel"'].map((trecho) => html.indexOf(trecho));
  assert.ok(ordem.every((posicao) => posicao >= 0), ordem.join(" "));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, "a linha, o cabecalho, as fixadas e o conteudo");
  assert.match(html, /role="tabpanel">conteudo das perguntas<\/div><\/aside>$/, "o conteudo da aba fica como estava");
  assert.ok(slot.indexOf('data-testid="room-pinned"') < slot.indexOf('data-testid="room-pinned-poll"'), "a mensagem, depois a enquete");
  // Sem fixada, o painel nao ganha nada (o HTML de antes).
  const semFixada = render(panelModule.RoomPanel, { children: "c", closable: true, firstFocus: false, id: "room-panel", kind: "live", onClose: noop, onTab: noop, open: true, pollOpen: false, tab: "perguntas", tabs: ["chat", "perguntas"] });
  assert.doesNotMatch(semFixada, /data-room-slot="pinned"/);
  assert.equal(render(pinnedModule.RoomPinnedArea, { ...AREA, message: null, poll: null }), "", "a area sem nada nao desenha nada");
});

test("a mensagem fixada: 'Fixada pela equipe' em cima do autor, a secao com esse nome, o texto em 3 linhas com Mostrar tudo (aria-expanded e aria-controls) e o link clicavel; a curta, sem Mostrar tudo", () => {
  const html = render(pinnedModule.RoomPinnedArea, { ...AREA, message: LONGA, poll: null });
  const secao = elementWith(html, 'data-testid="room-pinned"');
  const abertura = secao.slice(0, secao.indexOf(">") + 1);
  assert.match(abertura, /^<section aria-labelledby="([^"]+)"/);
  assert.match(abertura, /tabindex="-1"/, "o foco pedido entra no bloco, fora da trava do Tab");
  const nome = /aria-labelledby="([^"]+)"/.exec(abertura)[1];
  assert.match(secao, new RegExp(`<p class="[^"]*" id="${nome}"><svg[^>]*lucide-pin[\\s\\S]*?</svg>Fixada pela equipe</p><p aria-hidden="true"[^>]*data-room-message-meta=""`), "a linha de cima nomeia a secao, antes do autor");
  assert.match(secao, /<div class="flex" data-room-message="fl">/, "o comentario fora da lista nao e um <li>");
  assert.match(secao, />Danilo S\.<\/span>[\s\S]*?>Apresentador</, "o nome e o selo do papel");
  // O texto cortado em 3 linhas e o botao que abre.
  const texto = secao.match(/<p class="([^"]*)" id="([^"]+)"><span class="sr-only">/);
  assert.ok(texto, "o paragrafo do texto");
  assert.ok(classesDe(`<p class="${texto[1]}">`).includes("line-clamp-3"), "o corte em 3 linhas");
  const botao = secao.match(/<button[^>]*data-room-pinned-more=""[^>]*>Mostrar tudo<\/button>/)?.[0] ?? "";
  assert.ok(botao, "o Mostrar tudo e um botao");
  assert.match(botao, /aria-expanded="false"/);
  assert.match(botao, new RegExp(`aria-controls="${texto[2]}"`), "o botao aponta para o texto");
  assert.deepEqual(linksDe(secao).map((link) => link.href), [LINK], "o link da equipe clicavel na fixada");

  const curta = elementWith(render(pinnedModule.RoomPinnedArea, { ...AREA, message: FIXADA, poll: null }), 'data-testid="room-pinned"');
  assert.doesNotMatch(curta, /Mostrar tudo/, "a curta cabe nas 3 linhas");
  assert.match(curta, /<span class="sr-only">Equipe: <\/span>Material da aula: <a /, "o leitor de tela ouve o autor antes do texto");
});

test("a enquete fixada: responde ali mesmo; respondida recolhe em 'Resposta enviada' com Mostrar; com o resultado compartilhado, aberta com as barras e Recolher", () => {
  const aberta = elementWith(render(pinnedModule.RoomPinnedArea, { ...AREA, message: null, poll: enquete() }), 'data-testid="room-pinned-poll"');
  assert.match(aberta, /^<section aria-labelledby="[^"]+"[^>]*data-room-pinned-poll="pf"/);
  assert.match(aberta, /lucide-chart-column[\s\S]*?Enquete fixada pela equipe<\/p>/);
  assert.match(aberta, /<fieldset[^>]*data-room-poll="pf"><legend class="sr-only">Já usa IA no trabalho\?<\/legend>/, "o RoomPollCard de sempre");
  assert.match(aberta, />Enviar<\/button>/);
  assert.match(aberta, /<p aria-live="polite" class="[^"]*"><\/p>/, "a regiao polida montada e vazia antes da resposta");
  assert.doesNotMatch(aberta, /Mostrar|Recolher/);
  assert.doesNotMatch(aberta, /hidden=""/);

  const respondida = elementWith(render(pinnedModule.RoomPinnedArea, { ...AREA, message: null, poll: enquete({ myOptionIds: ["o1"] }) }), 'data-testid="room-pinned-poll"');
  assert.match(respondida, /<p aria-live="polite" class="[^"]*">Resposta enviada<\/p>/);
  const mostrar = respondida.match(/<button aria-controls="([^"]+)" aria-expanded="false"[^>]*>Mostrar<svg/);
  assert.ok(mostrar, "Mostrar fechado");
  assert.match(respondida, new RegExp(`<div class="mt-2" hidden="" id="${mostrar[1]}"><fieldset`), "o cartao recolhido continua no HTML");

  const resultado = elementWith(
    render(pinnedModule.RoomPinnedArea, { ...AREA, message: null, poll: enquete({ myOptionIds: ["o1"], results: { counts: { o1: 3, o2: 1 }, total: 4 }, status: "closed" }) }),
    'data-testid="room-pinned-poll"'
  );
  assert.match(resultado, /<button aria-controls="[^"]+" aria-expanded="true"[^>]*>Recolher<svg/);
  assert.match(resultado, /<div class="mt-2" id="[^"]+"><fieldset/, "aberta com o resultado");
  assert.match(resultado, /bg-room-poll-bar" style="width:75%"/, "as barras");
  assert.match(resultado, />75%<\/span>/);
  assert.match(resultado, />Encerrada</);
});

test("a gaveta do vertical leva a mesma area no topo de toda aba, com 40 % no maximo e rolando por dentro", () => {
  const html = render(drawer.VerticalDrawer, {
    children: createElement("p", null, "conteudo"),
    id: "gaveta",
    onClose: noop,
    onTab: noop,
    pinned: createElement(pinnedModule.RoomPinnedArea, { ...AREA, message: FIXADA, poll: null }),
    pollOpen: false,
    reducedMotion: true,
    replay: false,
    tab: "perguntas",
    tabs: ["chat", "perguntas"]
  });
  const slot = elementWith(html, 'data-room-slot="pinned"');
  assert.ok(["max-h-[40%]", "shrink-0", "overflow-y-auto"].every((classe) => classesDe(slot.slice(0, slot.indexOf(">") + 1)).includes(classe)));
  assert.ok(html.indexOf('role="tablist"') < html.indexOf('data-room-slot="pinned"') && html.indexOf('data-room-slot="pinned"') < html.indexOf('role="tabpanel"'), "entre as abas e o conteudo");
  assert.match(slot, /data-testid="room-pinned"/);
  const semFixada = render(drawer.VerticalDrawer, { children: "c", id: "g", onClose: noop, onTab: noop, pollOpen: false, reducedMotion: true, replay: false, tab: "chat", tabs: ["chat"] });
  assert.doesNotMatch(semFixada, /data-room-slot="pinned"/);
});

/* ------------------------------------------------------------------------------------------------
 * Com o painel fechado: as pilulas do palco largo, as linhas da faixa e o aviso (§3.1)
 * ---------------------------------------------------------------------------------------------- */

test("as pilulas do palco sao botoes, so com 640 px ou mais de palco (o recipiente @container/tela), abaixo dos selos; o texto da fixada numa linha", () => {
  const html = render(pinnedModule.RoomPinnedPills, { message: msg("fx", { body: `Material:\n${LINK}`, links: true, role: "team" }), onMessage: noop, onPoll: noop, poll: enquete() });
  const camada = html.slice(0, html.indexOf(">") + 1);
  for (const classe of ["@container/tela", "pointer-events-none", "absolute", "inset-0"]) {
    assert.ok(classesDe(camada).includes(classe), `${classe} na camada`);
  }
  const lugar = html.match(/^<div[^>]*><div class="([^"]*)">/)?.[1] ?? "";
  for (const classe of ["hidden", "@min-[640px]/tela:flex", "left-2", "top-[42px]", "lg:left-4", "lg:top-14"]) {
    assert.ok(lugar.split(" ").includes(classe), `${classe} no lugar das pilulas`);
  }
  const botoes = [...html.matchAll(/<button class="([^"]*)" data-room-pinned-pill="(message|poll)" type="button">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(
    botoes.map(([, , qual, conteudo]) => [qual, conteudo.replace(/<[^>]+>/g, "")]),
    [
      ["message", `Fixada · Material: ${LINK}`],
      ["poll", "Enquete fixada · Já usa IA no trabalho?"]
    ],
    "as duas pilulas, a mensagem numa linha"
  );
  for (const [, classes] of botoes) {
    assert.ok(classes.includes("pointer-events-auto") && classes.includes("focus-visible:outline-room-focus"), "so o botao recebe o toque, com o anel de foco");
  }
  assert.doesNotMatch(html, /<a\b/, "a pilula nao e link: ela abre o painel");
  assert.equal(render(pinnedModule.RoomPinnedPills, { message: null, onMessage: noop, onPoll: noop, poll: null }), "");
});

test("as linhas da faixa (palco mais estreito): botoes de 56 px abaixo do palco, no maximo 120 px rolando por dentro, so abaixo de 640 px de palco e nunca a partir de lg", () => {
  const html = render(pinnedModule.RoomPinnedStrip, { message: FIXADA, onMessage: noop, onPoll: noop, poll: enquete() });
  assert.deepEqual(classesDe(html.slice(0, html.indexOf(">") + 1)).sort(), ["@container/tela", "lg:hidden", "shrink-0"]);
  const faixa = html.match(/^<div[^>]*><div class="([^"]*)">/)?.[1].split(" ") ?? [];
  for (const classe of ["@min-[640px]/tela:hidden", "max-h-[120px]", "overflow-y-auto", "flex-col"]) {
    assert.ok(faixa.includes(classe), `${classe} na faixa`);
  }
  const linhas = [...html.matchAll(/<button class="([^"]*)" data-room-pinned-row="(message|poll)" type="button">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(
    linhas.map(([, , qual, conteudo]) => [qual, conteudo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()]),
    [
      ["message", `Fixada pela equipe Material da aula: ${LINK}. Bom estudo!`],
      ["poll", "Enquete fixada pela equipe Já usa IA no trabalho?"]
    ]
  );
  for (const [, classes] of linhas) {
    assert.ok(classes.split(" ").includes("min-h-14"), "56 px");
  }
});

test("a gravada com o painel fechado: as pilulas no palco depois dos selos e as linhas entre o palco e a barra; o painel escondido continua com a area; no Replay, nada", () => {
  const sala = (extra = {}, sessionExtra = {}) =>
    render(recordedRoom.WebinarRoom, { coverUrl: null, design: "normal", payload: payloadGravada(extra, sessionExtra), presenterName: "Danilo S.", readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  const comFixadas = { pinned: FIXADA, polls: [enquete()], screen: { items: [], pinned: FIXADA, pinnedPollId: "pf", pollsKey: "k", stamp: "s1" } };
  globalThis.__naTelaPainelAberto = false;
  try {
    const html = sala(comFixadas);
    const caixa = elementWith(html, 'data-room-slot="stage-box"');
    assert.match(caixa, /data-room-pinned-pills=""/, "as pilulas no palco");
    assert.ok(caixa.indexOf('data-room-badges="top"') < caixa.indexOf("data-room-pinned-pills"), "depois dos selos");
    const coluna = elementWith(html, 'data-room-slot="stage-column"');
    const [palco, faixa, barra] = ['data-room-slot="stage-box"', "data-room-pinned-strip", 'data-testid="recorded-controls"'].map((trecho) => coluna.indexOf(trecho));
    assert.ok(palco >= 0 && palco < faixa && faixa < barra, "a faixa logo abaixo do palco e acima da barra");
    const painel = elementWith(html, 'data-testid="room-panel"');
    assert.match(painel, /^<aside[^>]*hidden=""/, "o painel fechado e montado");
    // A enquete fixada fica na area do painel (a aba Enquetes e o card "deixou para depois" sem ela: unpinnedPolls, no
    // teste do modelo).
    assert.match(elementWith(painel, 'data-room-slot="pinned"'), /data-room-pinned-poll="pf"/);

    const replay = sala(comFixadas, { kind: "replay", offsetMs: null, roomPhase: null });
    assert.doesNotMatch(replay, /data-room-pinned|data-room-slot="pinned"|data-testid="room-pinned"/, "no Replay nada da Na tela");
    const encerrada = sala(comFixadas, { roomPhase: "ended", status: "ended" });
    assert.doesNotMatch(encerrada, /data-room-pinned|data-room-slot="pinned"/, "encerrada, nada");
  } finally {
    globalThis.__naTelaPainelAberto = undefined;
  }
  // Aberto, nem pilula nem faixa: a area no painel, fora do chat.
  const aberto = sala(comFixadas);
  assert.doesNotMatch(aberto, /data-room-pinned-pills|data-room-pinned-strip/);
  const area = elementWith(aberto, 'data-room-slot="pinned"');
  assert.match(area, /data-testid="room-pinned"[\s\S]*data-testid="room-pinned-poll"/);
  assert.doesNotMatch(elementWith(aberto, 'data-testid="room-chat"'), /room-pinned|Fixada pela equipe/, "a fixada nao esta mais no chat");
});

test("a Live ao vivo com o painel fechado: as pilulas no palco (dentro da regiao do video) e as linhas antes da barra; removido, nada", () => {
  const sala = (extra = {}) => render(liveRoom.LiveWebinarRoom, { coverUrl: null, nonce: "n0nce", payload: payloadAoVivo(extra), presenterName: "Danilo S.", readOnly: false, staff: false, webinarHref: "/webinarios/aula-de-ia" });
  const comFixadas = { pinned: LONGA, polls: [enquete({ myOptionIds: ["o2"] })], screen: { items: [], pinned: LONGA, pinnedPollId: "pf", pollsKey: "k", stamp: "s1" } };
  globalThis.__naTelaPainelAberto = false;
  try {
    const html = sala(comFixadas);
    const palco = elementWith(html, 'data-room-stage="');
    assert.match(palco, /data-room-pinned-pill="message"[^>]*>[\s\S]*?Fixada · Pessoal, o material/);
    assert.match(palco, /data-room-pinned-pill="poll"[^>]*>[\s\S]*?Enquete fixada · Já usa IA no trabalho\?/);
    const coluna = elementWith(html, 'data-room-slot="stage-column"');
    assert.ok(coluna.indexOf("data-room-pinned-strip") > coluna.indexOf('data-room-slot="stage-box"'));
    assert.ok(coluna.indexOf("data-room-pinned-strip") < coluna.indexOf('data-testid="live-controls"'), "acima da barra");

    const removido = sala({ ...comFixadas, me: { ban: { banned: false, kicked: true, muted: false, mutedUntil: null } } });
    assert.doesNotMatch(removido, /data-room-pinned|data-testid="room-pinned"/, "removido: a sala da lugar a frase");
  } finally {
    globalThis.__naTelaPainelAberto = undefined;
  }
  const aberto = sala(comFixadas);
  const area = elementWith(aberto, 'data-room-slot="pinned"');
  assert.match(area, /Mostrar tudo/, "a longa com o Mostrar tudo");
  assert.match(area, /Resposta enviada/, "a enquete respondida recolhida");
  assert.doesNotMatch(aberto, /data-room-pinned-pills/);
});

test("o aviso da fixada nova: 'A equipe fixou uma mensagem.' com Ver como botao, na regiao polida do aviso da sala", () => {
  const value = { api: { clear: noop, composer: noop, show: noop }, composerPx: 0, listInsetPx: 0, onBox: noop, onPauseChange: noop, snack: layout.pinnedSnack(), stageOffsetPx: 0 };
  const html = renderToStaticMarkup(createElement(snackbarModule.RoomSnackbarProvider, { value }, createElement(snackbarModule.RoomSnackbarHost, { panelShown: false })));
  assert.match(html, /aria-live="polite"[^>]*role="status"/);
  assert.match(html, /data-testid="live-notice">A equipe fixou uma mensagem\.<\/p>/);
  assert.match(html, /<button[^>]*>Ver<\/button>/);
  assert.deepEqual([WEBINAR_COPY.naTela.aluno.avisoFixou, WEBINAR_COPY.naTela.aluno.ver], ["A equipe fixou uma mensagem.", "Ver"], "as frases da especificacao");
});

/* ------------------------------------------------------------------------------------------------
 * A sala vertical 9:16 (§3.4)
 * ---------------------------------------------------------------------------------------------- */

test("o vertical: a fixada na linha de 2 linhas com o link clicavel e o Mostrar tudo de 44 px; o botao 'Enquete fixada: {pergunta}' fica depois da resposta", () => {
  const sala = (extra) => render(recordedRoom.WebinarRoom, { coverUrl: null, design: "vertical", payload: payloadGravada(extra), presenterName: null, readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  const html = sala({ pinned: LONGA, polls: [enquete({ myOptionIds: ["o1"] })], screen: { items: [], pinned: LONGA, pinnedPollId: "pf", pollsKey: "k", stamp: "s1" } });
  const chatPorCima = elementWith(html, "data-room-vertical-chat");
  const linha = elementWith(chatPorCima, 'data-testid="room-pinned"');
  assert.match(linha, /<span class="sr-only">Fixada pela equipe: <\/span><span class="font-bold text-white">Danilo S\.<\/span>/);
  assert.deepEqual(linksDe(linha).map((link) => link.href), [LINK], "o link da equipe clicavel");
  const texto = linha.match(/<p class="([^"]*)" id="([^"]+)">/);
  assert.ok(classesDe(`<p class="${texto[1]}">`).includes("line-clamp-2"), "2 linhas");
  const mais = linha.match(/<button aria-controls="([^"]+)" aria-expanded="false" aria-label="Mostrar tudo" class="([^"]*)"/);
  assert.ok(mais, "o Mostrar tudo e um botao com aria-expanded");
  assert.equal(mais[1], texto[2], "aponta para o texto");
  assert.ok(mais[2].split(" ").includes("size-11"), "44 px");
  // O botao da enquete fixada continua depois da resposta, com o rotulo da Na tela (sem o "Enquetes:" de antes).
  assert.match(chatPorCima, /<button class="[^"]*min-h-11[^"]*" type="button"><svg[^>]*>(?:(?!<\/svg>)[\s\S])*<\/svg><span class="truncate">Enquete fixada: Já usa IA no trabalho\?<\/span><\/button>/);
  assert.doesNotMatch(chatPorCima, /Enquetes: /);
  // Todo botao do vertical continua com 44 px.
  for (const botao of html.match(/<button[^>]*>/g) ?? []) {
    assert.match(botao, /\b(size-11|h-11|min-h-11|h-12)\b/, botao.slice(0, 120));
  }
  // Sem enquete fixada, a primeira aberta como antes (com o "Enquetes:" para o leitor de tela); encerrada, sem botao.
  const semFixada = elementWith(sala({ polls: [enquete()] }), "data-room-vertical-chat");
  assert.match(semFixada, /<span class="sr-only">Enquetes: <\/span><span class="truncate">Já usa IA no trabalho\?<\/span>/);
  assert.doesNotMatch(semFixada, /Enquete fixada/);
  const encerrada = { myOptionIds: ["o1"], results: { counts: { o1: 1, o2: 0 }, total: 1 }, status: "closed" };
  assert.doesNotMatch(elementWith(sala({ polls: [enquete(encerrada)] }), "data-room-vertical-chat"), /Já usa IA/, "sem fixar, a encerrada nao tem botao");
  assert.match(
    elementWith(sala({ polls: [enquete(encerrada)], screen: { items: [], pinned: null, pinnedPollId: "pf", pollsKey: "k", stamp: "s3" } }), "data-room-vertical-chat"),
    /<span class="truncate">Enquete fixada: Já usa IA no trabalho\?<\/span>/,
    "fixada, a encerrada com o resultado continua com o botao"
  );
  // A fixada curta, sem o Mostrar tudo.
  assert.doesNotMatch(elementWith(sala({ pinned: FIXADA, screen: { items: [], pinned: FIXADA, pinnedPollId: null, pollsKey: "", stamp: "s2" } }), "data-room-vertical-chat"), /Mostrar tudo/);
});

/* ------------------------------------------------------------------------------------------------
 * As salas de teste
 * ---------------------------------------------------------------------------------------------- */

function payloadGravada(extra = {}, sessionExtra = {}) {
  return {
    me: { avatarUrl: null, ban: { banned: false, kicked: false, muted: false, mutedUntil: null }, calendarUrl: null, consented: true, displayName: "Ana S.", registered: false, registeredAt: null },
    pinned: null,
    polls: [],
    presentNow: 2,
    registeredCount: null,
    screen: { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp: "s0" },
    serverTime: at(T0),
    session: {
      chatMode: "open",
      chatSlowModeSeconds: null,
      durationMs: 60 * MIN,
      endedAt: null,
      id: "cccccccc-0000-4000-8000-000000000002",
      join: { ok: true },
      kind: "simulated",
      lateJoinMinutes: null,
      offsetMs: 2 * MIN,
      phase: "waiting",
      roomPhase: "live",
      scheduledAt: at(T0 - 2 * MIN),
      showLiveBadge: true,
      startedAt: null,
      status: "scheduled",
      ...sessionExtra
    },
    video: null,
    webinar: { durationMinutes: 60, id: "cccccccc-0000-4000-8000-000000000001", kind: "simulated", replaySessionId: null, slug: "aula-de-ia", title: "Aula de IA" },
    ...extra
  };
}

function payloadAoVivo({ me = {}, ...extra } = {}) {
  return {
    live: { locked: false, meetConfigured: true, recording: false, startedAt: at(T0 - 10 * MIN), status: "live" },
    me: { avatarUrl: null, ban: { banned: false, kicked: false, muted: false, mutedUntil: null }, calendarUrl: null, consented: true, displayName: "Ana S.", registered: false, registeredAt: null, ...me },
    pinned: null,
    polls: [],
    presentNow: 7,
    registeredCount: null,
    screen: { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp: "s0" },
    serverTime: at(T0),
    session: {
      chatMode: "open",
      chatSlowModeSeconds: null,
      durationMs: 60 * MIN,
      endedAt: null,
      id: "cccccccc-0000-4000-8000-000000000003",
      join: { ok: true },
      kind: "live",
      lateJoinMinutes: null,
      offsetMs: 10 * MIN,
      phase: "live",
      roomPhase: null,
      scheduledAt: at(T0 - 10 * MIN),
      showLiveBadge: false,
      startedAt: at(T0 - 10 * MIN),
      status: "live"
    },
    video: null,
    webinar: { durationMinutes: 60, id: "cccccccc-0000-4000-8000-000000000001", kind: "live", replaySessionId: null, slug: "aula-de-ia", title: "Aula de IA" },
    ...extra
  };
}
