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
const layerModule = await import("../src/components/member/webinars/room/screen/room-screen-layer.tsx");
const stripModule = await import("../src/components/member/webinars/room/screen/room-screen-strip.tsx");
const cardModule = await import("../src/components/member/webinars/room/screen/room-screen-card.tsx");
const wideModule = await import("../src/components/member/webinars/room/screen/room-wide-hidden.tsx");
const badgesModule = await import("../src/components/member/webinars/room/room-stage-badges.tsx");
const screenModel = await import("../src/components/member/webinars/room/screen/room-screen-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

// O React 19 poe o preload das imagens (<link rel="preload" as="image">) no HTML do servidor: fora da comparacao.
const render = (component, props, ...children) => renderToStaticMarkup(createElement(component, props, ...children)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
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
const VIDEO = { embedUrl: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc" };
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

test("as pilulas do palco sao botoes, so com 640 px ou mais de palco (a camada da Na tela e o recipiente @container/tela), as primeiras da celula de cima a esquerda, abaixo dos selos; o texto da fixada numa linha", () => {
  const pills = createElement(pinnedModule.RoomPinnedPills, { message: msg("fx", { body: `Material:\n${LINK}`, links: true, role: "team" }), onMessage: noop, onPoll: noop, poll: enquete() });
  const placement = screenModel.screenPlacement({ items: [], offerShown: false, pinnedPills: true });
  const html = render(layerModule.RoomScreenLayer, { forced: false, fullscreen: false, items: [], pinned: pills, placement });
  const camada = html.slice(0, html.indexOf(">") + 1);
  for (const classe of ["@container/tela", "pointer-events-none", "absolute", "inset-0", "z-20"]) {
    assert.ok(classesDe(camada).includes(classe), `${classe} na camada`);
  }
  // A area segura: 56 px em cima (os selos), 12 px a esquerda (16 px a partir de lg).
  const area = elementWith(html, "data-room-screen-area");
  for (const classe of ["top-14", "left-3", "lg:left-4", "bottom-14"]) {
    assert.ok(classesDe(area.slice(0, area.indexOf(">") + 1)).includes(classe), `${classe} na area`);
  }
  const celula = elementWith(html, 'data-room-screen-cell="top_left"');
  assert.ok(celula.indexOf("data-room-pinned-pills") > 0, "as pilulas na celula de cima a esquerda");
  const bloco = elementWith(celula, "data-room-pinned-pills");
  for (const classe of ["hidden", "@min-[640px]/tela:flex", "flex-col", "[@media(max-height:500px)]:hidden!", "gap-3"]) {
    assert.ok(classesDe(bloco.slice(0, bloco.indexOf(">") + 1)).includes(classe), `${classe} no bloco das pilulas`);
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
    // A pilula de 32 px com a area de toque de 44 px abaixo de lg (A7); a 12 px uma da outra, as areas nao se cobrem.
    for (const classe of ["h-8", "relative", "after:absolute", "after:-inset-1.5", "lg:after:hidden"]) {
      assert.ok(classes.split(" ").includes(classe), `${classe} na pilula`);
    }
  }
  assert.doesNotMatch(html, /<a\b/, "a pilula nao e link: ela abre o painel");
  assert.equal(render(pinnedModule.RoomPinnedPills, { message: null, onMessage: noop, onPoll: noop, poll: null }), "");
});

test("as linhas da faixa (palco mais estreito ou com capa): botoes de 56 px abaixo do palco, no maximo 120 px rolando por dentro, so abaixo de 640 px de palco; com a capa, em qualquer largura (data-tela=faixa)", () => {
  const props = { forced: false, items: [], pinned: { message: FIXADA, onMessage: noop, onPoll: noop, poll: enquete() } };
  const html = render(stripModule.RoomScreenStrip, props);
  // A partir de lg o invólucro sobe os 12 px do gap da coluna e o conteudo desce 12 px (A6): escondida no palco largo, a
  // faixa tem altura zero e nao ocupa o gap, e o palco nao pula quando algo entra, sai ou e fixado.
  assert.deepEqual(classesDe(html.slice(0, html.indexOf(">") + 1)).sort(), ["@container/tela", "lg:-mt-3", "shrink-0"]);
  assert.doesNotMatch(html.slice(0, html.indexOf(">") + 1), /data-tela/);
  const faixa = html.match(/^<div[^>]*><div class="([^"]*)">/)?.[1].split(" ") ?? [];
  for (const classe of ["@min-[640px]/tela:hidden", "max-h-[120px]", "overflow-y-auto", "flex-col", "lg:mt-3"]) {
    assert.ok(faixa.includes(classe), `${classe} na faixa`);
  }
  // A tela baixa (o celular deitado, A5): o palco largo e baixo demais para os cartoes, a faixa volta (por cima dos 640 px).
  assert.ok(faixa.includes("[@media(max-height:500px)]:flex!"), "a faixa na tela baixa");
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
  // Com uma capa no palco, a faixa vale tambem no palco largo.
  const comCapa = render(stripModule.RoomScreenStrip, { ...props, forced: true });
  assert.match(comCapa, /^<div class="@container\/tela shrink-0 lg:-mt-3" data-room-screen-strip="" data-tela="faixa"><div class="([^"]*)">/);
  assert.ok(!comCapa.match(/^<div[^>]*><div class="([^"]*)">/)[1].includes("@min-[640px]/tela:hidden"), "sem esconder no palco largo");
  assert.equal(render(stripModule.RoomScreenStrip, { forced: false, items: [], pinned: null }), "", "sem nada, sem faixa");
});

test("a gravada com o painel fechado (o HTML do servidor abre com a capa Ativar som): as fixadas em linhas na faixa entre o palco e a barra, forcada pela capa; o palco sem pilula; o painel escondido continua com a area; no Replay, nada", () => {
  const sala = (extra = {}, sessionExtra = {}) =>
    render(recordedRoom.WebinarRoom, { coverUrl: null, design: "normal", payload: payloadGravada(extra, sessionExtra), presenterName: "Danilo S.", readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  const comFixadas = { pinned: FIXADA, polls: [enquete()], screen: { items: [], pinned: FIXADA, pinnedPollId: "pf", pollsKey: "k", stamp: "s1" } };
  globalThis.__naTelaPainelAberto = false;
  try {
    for (const [rotulo, extra] of [
      ["sem video", comFixadas],
      ["com o video e a capa Ativar som", { ...comFixadas, video: VIDEO }]
    ]) {
      const html = sala(extra);
      const caixa = elementWith(html, 'data-room-slot="stage-box"');
      assert.doesNotMatch(caixa, /data-room-pinned-pill=/, `${rotulo}: nada sobre o video com a capa`);
      const coluna = elementWith(html, 'data-room-slot="stage-column"');
      const [palco, faixa, barra] = ['data-room-slot="stage-box"', "data-room-screen-strip", 'data-testid="recorded-controls"'].map((trecho) => coluna.indexOf(trecho));
      assert.ok(palco >= 0 && palco < faixa && faixa < barra, `${rotulo}: a faixa logo abaixo do palco e acima da barra`);
      assert.match(elementWith(coluna, "data-room-screen-strip"), /^<div class="@container\/tela shrink-0 lg:-mt-3" data-room-screen-strip="" data-tela="faixa">[\s\S]*data-room-pinned-row="message"[\s\S]*data-room-pinned-row="poll"/);
    }
    const painel = elementWith(sala(comFixadas), 'data-testid="room-panel"');
    assert.match(painel, /^<aside[^>]*hidden=""/, "o painel fechado e montado");
    // A enquete fixada fica na area do painel (a aba Enquetes e o card "deixou para depois" sem ela: unpinnedPolls, no
    // teste do modelo).
    assert.match(elementWith(painel, 'data-room-slot="pinned"'), /data-room-pinned-poll="pf"/);

    const replay = sala(comFixadas, { kind: "replay", offsetMs: null, roomPhase: null });
    assert.doesNotMatch(replay, /data-room-pinned|data-room-slot="pinned"|data-testid="room-pinned"|data-room-screen-strip/, "no Replay nada da Na tela");
    const encerrada = sala(comFixadas, { roomPhase: "ended", status: "ended" });
    assert.doesNotMatch(encerrada, /data-room-pinned|data-room-slot="pinned"|data-room-screen-strip/, "encerrada, nada");
  } finally {
    globalThis.__naTelaPainelAberto = undefined;
  }
  // Aberto, nem pilula nem linha das fixadas: a area no painel, fora do chat.
  const aberto = sala(comFixadas);
  assert.doesNotMatch(aberto, /data-room-pinned-pill|data-room-pinned-row|data-room-screen-strip/);
  const area = elementWith(aberto, 'data-room-slot="pinned"');
  assert.match(area, /data-testid="room-pinned"[\s\S]*data-testid="room-pinned-poll"/);
  assert.doesNotMatch(elementWith(aberto, 'data-testid="room-chat"'), /room-pinned|Fixada pela equipe/, "a fixada nao esta mais no chat");
});

test("a Live ao vivo com o painel fechado (o HTML do servidor abre antes de Entrar na sala, uma capa): as fixadas em linhas antes da barra, forcadas para a faixa; removido, nada", () => {
  const sala = (extra = {}) => render(liveRoom.LiveWebinarRoom, { coverUrl: null, nonce: "n0nce", payload: payloadAoVivo(extra), presenterName: "Danilo S.", readOnly: false, staff: false, webinarHref: "/webinarios/aula-de-ia" });
  const comFixadas = { pinned: LONGA, polls: [enquete({ myOptionIds: ["o2"] })], screen: { items: [], pinned: LONGA, pinnedPollId: "pf", pollsKey: "k", stamp: "s1" } };
  globalThis.__naTelaPainelAberto = false;
  try {
    const html = sala(comFixadas);
    assert.doesNotMatch(elementWith(html, 'data-room-stage="'), /data-room-pinned-pill=/, "a capa Entrar na sala: nada sobre o video");
    const coluna = elementWith(html, 'data-room-slot="stage-column"');
    const faixa = elementWith(coluna, "data-room-screen-strip");
    assert.match(faixa, /data-tela="faixa"/);
    assert.match(faixa, /data-room-pinned-row="message"[^>]*>[\s\S]*?Pessoal, o material/);
    assert.match(faixa, /data-room-pinned-row="poll"[^>]*>[\s\S]*?Já usa IA no trabalho\?/);
    assert.ok(coluna.indexOf("data-room-screen-strip") > coluna.indexOf('data-room-slot="stage-box"'));
    assert.ok(coluna.indexOf("data-room-screen-strip") < coluna.indexOf('data-testid="live-controls"'), "acima da barra");

    const removido = sala({ ...comFixadas, me: { ban: { banned: false, kicked: true, muted: false, mutedUntil: null } } });
    assert.doesNotMatch(removido, /data-room-pinned|data-testid="room-pinned"|data-room-screen-/, "removido: a sala da lugar a frase");
  } finally {
    globalThis.__naTelaPainelAberto = undefined;
  }
  const aberto = sala(comFixadas);
  const area = elementWith(aberto, 'data-room-slot="pinned"');
  assert.match(area, /Mostrar tudo/, "a longa com o Mostrar tudo");
  assert.match(area, /Resposta enviada/, "a enquete respondida recolhida");
  assert.doesNotMatch(aberto, /data-room-pinned-pill|data-room-pinned-row/);
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
 * O banner e o QR Code (R3 e R4, fatia S9; §3.2 a §3.7)
 * ---------------------------------------------------------------------------------------------- */

const ORIGEM = "https://abcdefgh.supabase.co";
const IMAGEM = `${ORIGEM}/storage/v1/object/public/content-assets/webinars/screen/0123456789abcdef01234567.webp`;
const TURMA = "https://bunker707.com.br/turma";
const INSCRICAO = "https://bunker707.com.br/inscricao";
const banner = (extra = {}) => ({
  body: "Vagas até sexta.",
  buttonLabel: "Quero entrar",
  closable: true,
  displayId: "dddddddd-0000-4000-8000-000000000001",
  image: { alt: "Foguete subindo", height: 360, url: IMAGEM, width: 640 },
  kind: "banner",
  linkUrl: TURMA,
  place: "bottom_right",
  shownAt: at(T0),
  size: "m",
  title: "Turma nova",
  ...extra
});
const qr = (extra = {}) => ({ body: null, buttonLabel: null, closable: true, displayId: "dddddddd-0000-4000-8000-000000000002", image: null, kind: "qr", linkUrl: INSCRICAO, place: "top_right", shownAt: at(T0), size: "m", title: "Aponte a câmera", ...extra });
const abertura = (html) => html.slice(0, html.indexOf(">") + 1);

test("o cartao do banner: a secao nao modal com o nome, a largura pelo tamanho (clamp em cqw, no maximo 40 % do palco), a imagem inteira da nossa origem com width e height, o texto em 3 linhas e o botao como pilula com o link em outra aba", () => {
  const html = render(cardModule.RoomScreenCard, { item: banner() });
  const secao = abertura(html);
  assert.match(secao, /^<section aria-label="Banner da equipe: Turma nova"/);
  for (const classe of ["w-[clamp(240px,30cqw,380px)]", "max-w-[min(40cqw,100%)]", "bg-room-on-video-bg", "text-room-on-video-fg", "rounded-[16px]", "overflow-y-auto", "pointer-events-auto", "motion-safe:animate-in", "motion-safe:fade-in-0", "motion-safe:duration-200"]) {
    assert.ok(classesDe(secao).includes(classe), `${classe} no cartao`);
  }
  assert.doesNotMatch(html, /aria-modal|role="dialog"|tabindex="-1"/, "nunca dialogo: sem prender nem tirar o foco");
  assert.match(html, new RegExp(`<img alt="Foguete subindo" class="[^"]*object-contain[^"]*" data-room-screen-image="" decoding="async" height="360" src="${IMAGEM.replace(/[.]/g, "\\.")}" width="640"/>`));
  assert.match(html, /<span class="line-clamp-3 text-sm font-semibold leading-5">Turma nova<\/span><span class="line-clamp-3 [^"]*">Vagas até sexta\.<\/span>/, "o titulo e o texto em ate 3 linhas");
  const links = linksDe(html);
  assert.deepEqual(links.map((link) => [link.href, link.texto]), [[TURMA, "Quero entrar"]], "so o botao e link");
  assert.match(links[0].attrs, /\brel="noopener noreferrer nofollow"/);
  assert.match(links[0].attrs, /\btarget="_blank"/);
  assert.ok(classesDe(`<a${links[0].attrs}>`).includes("rounded-full"), "a pilula da sala");
  for (const classe of ["h-8", "relative", "after:absolute", "after:-inset-1.5", "lg:after:hidden"]) {
    assert.ok(classesDe(`<a${links[0].attrs}>`).includes(classe), `${classe}: o botao de 32 px com a area de toque de 44 px abaixo de lg (A7)`);
  }
  assert.match(html, /<button aria-label="Fechar o banner"[^>]*data-room-screen-close=""[^>]*>/, "o X, um botao");
  assert.ok(html.indexOf("Fechar o banner") > html.lastIndexOf("</a>"), "o X fora do link");
  assert.doesNotMatch(html, /Este banner sai quando a equipe tirar/);
  // As tres larguras.
  assert.ok(classesDe(abertura(render(cardModule.RoomScreenCard, { item: banner({ size: "s" }) }))).includes("w-[clamp(200px,22cqw,280px)]"));
  assert.ok(classesDe(abertura(render(cardModule.RoomScreenCard, { item: banner({ size: "l" }) }))).includes("w-[clamp(280px,40cqw,520px)]"));
});

test("o banner sem poder fechar nao tem X e o leitor de tela ouve que ele sai quando a equipe tirar; sem texto do botao, o banner inteiro e o link; sem link, e so um aviso", () => {
  const fixo = render(cardModule.RoomScreenCard, { item: banner({ closable: false }) });
  assert.doesNotMatch(fixo, /Fechar o banner|data-room-screen-close/);
  assert.match(fixo, /<p class="sr-only">Este banner sai quando a equipe tirar\.<\/p>/);
  const inteiro = render(cardModule.RoomScreenCard, { item: banner({ buttonLabel: null }) });
  const links = linksDe(inteiro);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, TURMA);
  assert.match(inteiro, /<a class="[^"]*" data-room-screen-link="" href="https:\/\/bunker707\.com\.br\/turma" rel="noopener noreferrer nofollow" target="_blank"><img alt="Foguete subindo"[^>]*>[\s\S]*Turma nova[\s\S]*<\/a>/, "a imagem e o texto dentro do link");
  assert.ok(inteiro.indexOf("</a>") < inteiro.indexOf("Fechar o banner"), "o X fora do link");
  const aviso = render(cardModule.RoomScreenCard, { item: banner({ buttonLabel: null, linkUrl: null }) });
  assert.doesNotMatch(aviso, /<a\b|href=/);
  // So a imagem: o nome da secao pela descricao.
  assert.match(render(cardModule.RoomScreenCard, { item: banner({ body: null, buttonLabel: null, linkUrl: null, title: null }) }), /^<section aria-label="Banner da equipe: Foguete subindo"/);
});

test("nenhum href fora de https e nenhuma imagem fora do nosso bucket: javascript, data, http, usuario e senha e endereco de fora ficam sem link e sem imagem", () => {
  for (const link of ["javascript:alert(1)", "data:text/html,oi", "http://bunker707.com.br/turma", "https://ana:senha@bunker707.com.br/turma", "https://localhost/x", "/turma"]) {
    for (const item of [banner({ linkUrl: link }), banner({ buttonLabel: null, linkUrl: link }), qr({ linkUrl: link })]) {
      const html = render(cardModule.RoomScreenCard, { item });
      assert.doesNotMatch(html, /href=/, `${item.kind}: ${link}`);
      const linha = render(stripModule.RoomScreenStrip, { forced: false, items: [item], pinned: null });
      assert.doesNotMatch(linha, /href=/, `faixa ${item.kind}: ${link}`);
    }
  }
  for (const url of ["https://cdn.de-fora.com/foto.webp", `${ORIGEM}/storage/v1/object/public/content-assets/communications/0123456789abcdef01234567.webp`, "javascript:alert(1)", `${IMAGEM}?x=1`]) {
    const html = render(cardModule.RoomScreenCard, { item: banner({ image: { alt: "Foto", height: 10, url, width: 10 } }) });
    assert.doesNotMatch(html, /<img\b/, url);
    assert.doesNotMatch(render(stripModule.RoomScreenStrip, { forced: false, items: [banner({ image: { alt: "Foto", height: 10, url, width: 10 } })], pinned: null }), /<img\b/, `faixa: ${url}`);
  }
});

test("o QR Code: um svg role=img com o nome 'QR Code do link {domínio}', modulos pretos no quadro branco, nivel M com a margem de 4 e o lado do tamanho; a legenda e sempre o Abrir o link com o mesmo endereco; o X fora do quadro", async () => {
  const { QR_SIDE_PX, qrModules } = await import("../src/server/webinars/screen-model.ts");
  const html = render(cardModule.RoomScreenCard, { item: qr() });
  assert.match(abertura(html), /^<section aria-label="QR Code da equipe: Aponte a câmera"/);
  const svg = html.match(/<svg [^>]*>/)?.[0] ?? "";
  assert.match(svg, /aria-label="QR Code do link bunker707\.com\.br"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, new RegExp(`height="${QR_SIDE_PX.m}"`));
  assert.match(svg, new RegExp(`width="${QR_SIDE_PX.m}"`));
  const modulos = qrModules(INSCRICAO);
  assert.match(svg, new RegExp(`viewBox="0 0 ${modulos} ${modulos}"`), "a margem de 4 modulos dentro do desenho");
  assert.match(html, /<path fill="#ffffff"[^>]*>/, "o quadro branco");
  assert.match(html, /<path fill="#000000"[^>]*>/, "os modulos pretos");
  const links = linksDe(html);
  assert.deepEqual(links.map((link) => [link.href, link.texto]), [[INSCRICAO, "Abrir o link"]], "o link de texto com o mesmo endereco");
  // A linha de 20 px com a area de toque de 44 px abaixo de lg (12 px acima e abaixo; A7).
  for (const classe of ["leading-5", "relative", "after:absolute", "after:-inset-y-3", "after:-inset-x-1.5", "lg:after:hidden"]) {
    assert.ok(classesDe(`<a${links[0].attrs}>`).includes(classe), `${classe} no Abrir o link`);
  }
  assert.match(links[0].attrs, /\brel="noopener noreferrer nofollow"/);
  assert.ok(html.indexOf(">Aponte a câmera<") > html.indexOf("</svg>") && html.indexOf(">Abrir o link<") > html.indexOf(">Aponte a câmera<"), "abaixo do codigo, a legenda e o link");
  assert.ok(html.indexOf("Fechar o QR Code") > html.indexOf("</svg>"), "o X depois do quadro, nunca sobre ele");
  // O tamanho Pequeno e o Grande; sem legenda, o nome sem ela.
  assert.match(render(cardModule.RoomScreenCard, { item: qr({ size: "s" }) }).match(/<svg [^>]*>/)[0], new RegExp(`width="${QR_SIDE_PX.s}"`));
  assert.match(render(cardModule.RoomScreenCard, { item: qr({ size: "l" }) }).match(/<svg [^>]*>/)[0], new RegExp(`width="${QR_SIDE_PX.l}"`));
  assert.match(render(cardModule.RoomScreenCard, { item: qr({ closable: false, title: null }) }), /^<section aria-label="QR Code da equipe"/);
  assert.doesNotMatch(render(cardModule.RoomScreenCard, { item: qr({ closable: false }) }), /Fechar o QR Code|Este banner sai/);
});

test("as nove posicoes: cada item na celula da posicao escolhida (as classes da grade), so no palco de 640 px ou mais; banner em cima do QR Code na mesma posicao; a Oferta empurra o de baixo a direita; com a capa, nada sobre o video", () => {
  const camada = (items, extra = {}) => {
    const placement = screenModel.screenPlacement({ items, offerShown: extra.offerShown ?? false, pinnedPills: false });
    return render(layerModule.RoomScreenLayer, { forced: false, fullscreen: false, items, pinned: null, placement, ...extra });
  };
  for (const place of ["top_left", "top_center", "top_right", "middle_left", "center", "middle_right", "bottom_left", "bottom_center", "bottom_right"]) {
    const html = camada([banner({ place })]);
    const celula = elementWith(html, `data-room-screen-cell="${place}"`);
    assert.ok(celula, place);
    const classes = classesDe(abertura(celula));
    for (const classe of screenModel.SCREEN_CELL_CLASSES[place].split(" ")) {
      assert.ok(classes.includes(classe), `${place}: ${classe}`);
    }
    const cartao = abertura(elementWith(celula, "data-room-screen-card"));
    assert.ok(classesDe(cartao).includes("hidden") && classesDe(cartao).includes("@min-[640px]/tela:flex"), `${place}: so no palco largo`);
  }
  const juntos = elementWith(camada([qr({ place: "bottom_left" }), banner({ place: "bottom_left" })]), 'data-room-screen-cell="bottom_left"');
  assert.ok(juntos.indexOf('data-room-screen-card="banner"') < juntos.indexOf('data-room-screen-card="qr"'), "o banner em cima");
  assert.ok(classesDe(abertura(juntos)).includes("gap-2"), "8 px entre os dois");
  const comOferta = camada([banner({ place: "bottom_right" })], { offerShown: true });
  assert.doesNotMatch(comOferta, /data-room-screen-cell="bottom_right"/);
  assert.match(elementWith(comOferta, 'data-room-screen-cell="bottom_left"'), /data-room-screen-card="banner"/, "a Oferta fica com o canto");
  // Com a capa, a sala passa a lista vazia: a camada marca a faixa e nada vai sobre o video.
  const items = [banner()];
  const capa = render(layerModule.RoomScreenLayer, { forced: true, fullscreen: false, items, pinned: null, placement: screenModel.screenPlacement({ items: [], offerShown: false, pinnedPills: false }) });
  assert.match(abertura(capa), /data-tela="faixa"/);
  assert.doesNotMatch(capa, /data-room-screen-card/);
});

test("banner e QR Code nas posicoes padrao (A1): uma celula so em cima a direita, o banner em cima e encolhendo primeiro; em cantos opostos, metade da largura cada; a fileira de baixo sobe com o aviso da sala; os cartoes saem na tela baixa (A5)", () => {
  const camada = (items, extra = {}) => {
    const placement = screenModel.screenPlacement({ items, offerShown: extra.offerShown ?? false, pinnedPills: false });
    return render(layerModule.RoomScreenLayer, { forced: false, fullscreen: false, items, pinned: null, placement, ...extra });
  };
  // O padrao: o QR Code em cima a direita e o banner embaixo a direita (a 1280 x 720 o banner cobria o QR Code).
  const padrao = camada([banner(), qr()]);
  assert.equal([...padrao.matchAll(/data-room-screen-cell="(\w+)"/g)].map(([, place]) => place).join(), "top_right", "uma celula so");
  const pilha = elementWith(padrao, 'data-room-screen-cell="top_right"');
  assert.ok(["max-h-full", "max-w-full", "gap-2"].every((classe) => classesDe(abertura(pilha)).includes(classe)), "a pilha usa a area inteira");
  assert.ok(pilha.indexOf('data-room-screen-card="banner"') < pilha.indexOf('data-room-screen-card="qr"'), "o banner em cima");
  const cartaoBanner = classesDe(abertura(elementWith(pilha, 'data-room-screen-card="banner"')));
  const cartaoQr = classesDe(abertura(elementWith(pilha, 'data-room-screen-card="qr"')));
  assert.ok(cartaoBanner.includes("shrink-[999]") && cartaoBanner.includes("min-h-14") && !cartaoBanner.includes("shrink"), "o banner encolhe primeiro e guarda 56 px");
  assert.ok(cartaoQr.includes("shrink") && cartaoQr.includes("min-h-0") && !cartaoQr.includes("shrink-[999]"), "o QR Code fica inteiro enquanto couber");
  // Sozinho, o banner encolhe como antes.
  assert.ok(classesDe(abertura(elementWith(camada([banner()]), 'data-room-screen-card="banner"'))).includes("shrink"));
  // A tela baixa vence sempre; a ultima classe continua a dos 640 px.
  for (const classes of [cartaoBanner, cartaoQr]) {
    assert.deepEqual(classes.slice(-3), ["hidden", "[@media(max-height:500px)]:hidden!", "@min-[640px]/tela:flex"]);
  }
  // Em cantos opostos: duas celulas com metade da largura, e o cartao nunca mais largo que a celula.
  const opostos = camada([banner({ place: "top_left" }), qr({ place: "bottom_right" })]);
  for (const place of ["top_left", "bottom_right"]) {
    assert.ok(classesDe(abertura(elementWith(opostos, `data-room-screen-cell="${place}"`))).includes("max-w-[calc(50%-4px)]"), `${place}: metade da largura`);
  }
  assert.ok(classesDe(abertura(elementWith(opostos, 'data-room-screen-card="banner"'))).includes("max-w-[min(40cqw,100%)]"));
  // Um em cima e o outro embaixo (sem dividir coluna): metade da altura, a de baixo descontando o aviso da sala.
  const altura = camada([banner({ place: "top_center" }), qr({ place: "bottom_left" })]);
  assert.ok(classesDe(abertura(elementWith(altura, 'data-room-screen-cell="top_center"'))).includes("max-h-[calc(50%-4px)]"));
  const baixo = classesDe(abertura(elementWith(altura, 'data-room-screen-cell="bottom_left"')));
  assert.ok(baixo.includes("max-h-[calc(50%-4px-var(--room-snackbar-offset,0px))]") && baixo.includes("bottom-[var(--room-snackbar-offset,0px)]"), "a fileira de baixo sobe com o aviso da sala");
  assert.ok(!baixo.includes("bottom-0"));
});

test("a area segura com a barra do motor (96 px embaixo) e a coluna de miniaturas a direita; na tela cheia de verdade, a linha compacta de 48 px na borda de cima, so no palco estreito (com a capa, em qualquer largura)", () => {
  const items = [banner(), qr()];
  const placement = screenModel.screenPlacement({ items, offerShown: false, pinnedPills: false });
  const motor = render(layerModule.RoomScreenLayer, { engineBar: true, forced: false, fullscreen: false, items, pinned: null, placement });
  const area = classesDe(abertura(elementWith(motor, "data-room-screen-area")));
  assert.ok(area.includes("bottom-24") && !area.includes("bottom-14"), "96 px embaixo");
  assert.ok(area.includes("right-[calc(var(--room-video-right,0px)+12px)]"), "a coluna de miniaturas fica livre");
  assert.doesNotMatch(motor, /data-room-screen-compact=/, "fora da tela cheia, sem a linha compacta");
  const cheia = render(layerModule.RoomScreenLayer, { forced: false, fullscreen: true, items, pinned: null, placement });
  const linhas = elementWith(cheia, "data-room-screen-compact=");
  const classes = classesDe(abertura(linhas));
  assert.ok(classes.includes("@min-[640px]/tela:hidden") && classes.includes("top-[42px]"), "na borda de cima, abaixo dos selos, so no palco estreito");
  assert.ok(classes.includes("[@media(max-height:500px)]:flex!"), "e no palco baixo (o celular deitado em tela cheia: os cartoes saem, A5)");
  const compactas = [...linhas.matchAll(/<section aria-label="([^"]*)" class="([^"]*)" data-room-screen-compact-row="(\w+)"/g)];
  assert.deepEqual(compactas.map(([, nome, , kind]) => [kind, nome]), [["banner", "Banner da equipe: Turma nova"], ["qr", "QR Code da equipe: Aponte a câmera"]]);
  for (const [, , classe] of compactas) {
    assert.ok(classe.split(" ").includes("h-12"), "48 px");
  }
  const capa = render(layerModule.RoomScreenLayer, { forced: true, fullscreen: true, items, pinned: null, placement: screenModel.screenPlacement({ items: [], offerShown: false, pinnedPills: false }) });
  assert.ok(!classesDe(abertura(elementWith(capa, "data-room-screen-compact="))).includes("@min-[640px]/tela:hidden"), "com a capa, em qualquer largura");
});

test("a faixa: linhas de 56 px sem classes de posicao, com a miniatura, o titulo e o texto numa linha, o botao ou Abrir o link, Mostrar / Recolher (aria-expanded e aria-controls) e o X so quando pode fechar; o QR Code aberto a 160 px", () => {
  const items = [banner({ closable: false }), qr()];
  const html = render(stripModule.RoomScreenStrip, { forced: false, items, pinned: { message: FIXADA, onMessage: noop, onPoll: noop, poll: null } });
  assert.ok(html.indexOf("data-room-pinned-row") < html.indexOf("data-room-screen-row"), "as fixadas primeiro");
  for (const classe of ["absolute", "fixed", ...Object.values(screenModel.SCREEN_CELL_CLASSES).flatMap((value) => value.split(" ")).filter((classe) => /^(?:top|left|right|bottom)-|translate/.test(classe))]) {
    assert.ok(!classesDe(html.replace(/<[^>]*class="sr-only"[^>]*>/g, "")).includes(classe), `sem ${classe} na faixa`);
    assert.doesNotMatch(html, new RegExp(`class="(?:[^"]* )?${classe.replace(/[[\]().\/-]/g, "\\$&")}(?: [^"]*)?"`), `sem ${classe}`);
  }
  const linhaBanner = elementWith(html, 'data-room-screen-row="banner"');
  assert.match(linhaBanner, /^<section aria-label="Banner da equipe: Turma nova"/);
  assert.match(linhaBanner, /<div class="flex min-h-14 items-center gap-3 px-3 py-2">/, "56 px");
  assert.match(linhaBanner, /<img alt="" aria-hidden="true" class="[^"]*size-10[^"]*"[^>]*src="https:\/\/abcdefgh\.supabase\.co\/storage/, "a miniatura de 40 px");
  assert.match(linhaBanner, /<span class="truncate text-sm font-semibold leading-5 text-room-fg">Turma nova<\/span><span class="truncate text-xs leading-\[18px\] text-room-fg-subtle">Vagas até sexta\.<\/span>/);
  assert.deepEqual(linksDe(linhaBanner).map((link) => [link.href, link.texto]), [[TURMA, "Quero entrar"]], "o botao do banner");
  assert.doesNotMatch(linhaBanner, /Fechar o banner/, "sem poder fechar, sem X");
  assert.match(linhaBanner, /Este banner sai quando a equipe tirar\./);
  const mostrar = linhaBanner.match(/<button aria-controls="([^"]+)" aria-expanded="false"[^>]*aria-label="Mostrar"/);
  assert.ok(mostrar, "Mostrar com aria-expanded e aria-controls");
  assert.match(linhaBanner, new RegExp(`<div class="[^"]*" data-room-screen-more="" hidden="" id="${mostrar[1]}"><img alt="Foguete subindo"`), "a imagem inteira com a descricao, recolhida");
  const linhaQr = elementWith(html, 'data-room-screen-row="qr"');
  assert.match(linhaQr, /<span class="truncate text-sm font-semibold leading-5 text-room-fg">Aponte a câmera<\/span><span class="truncate text-xs leading-\[18px\] text-room-fg-subtle">bunker707\.com\.br<\/span>/, "a legenda e o dominio");
  assert.deepEqual(linksDe(linhaQr).map((link) => [link.href, link.texto]), [[INSCRICAO, "Abrir o link"]], "no celular, a acao do QR Code e Abrir o link");
  // A acao principal da linha (no celular, o "Abrir o link"): a pilula de 32 px com a area de toque de 44 px (A7).
  for (const link of [...linksDe(linhaBanner), ...linksDe(linhaQr)]) {
    const classes = classesDe(`<a${link.attrs}>`);
    for (const classe of ["h-8", "relative", "after:absolute", "after:-inset-1.5", "lg:after:hidden"]) {
      assert.ok(classes.includes(classe), `${link.texto}: ${classe}`);
    }
  }
  assert.match(linhaQr, /<button aria-label="Fechar o QR Code"/);
  assert.match(linhaQr.match(/<svg [^>]*data-room-screen-qr=""[^>]*>/)[0], /width="160"/, "o QR Code aberto a 160 px");
  assert.doesNotMatch(html, /aria-modal|role="dialog"/);
  // Sem nada para mostrar a mais (sem imagem nem texto), sem o Mostrar.
  assert.doesNotMatch(render(stripModule.RoomScreenStrip, { forced: false, items: [banner({ body: null, image: null })], pinned: null }), /aria-expanded/);
});

test("as pilulas do chat e o selo do Assistente saem so do palco largo (RoomWideHidden: o recipiente @container/tela e o conteudo escondido a partir de 640 px); sem item embaixo, o HTML de antes", () => {
  const filho = createElement("p", { "data-x": "" }, "pilula");
  assert.equal(render(wideModule.RoomWideHidden, { hidden: false }, filho), '<p data-x="">pilula</p>');
  // Na tela baixa (o celular deitado, A5) o item esta na faixa: as pilulas e o selo continuam (por cima dos 640 px).
  assert.equal(
    render(wideModule.RoomWideHidden, { hidden: true }, filho),
    '<div class="@container/tela pointer-events-none absolute inset-0 z-20" data-room-wide-hidden=""><div class="contents @min-[640px]/tela:hidden [@media(max-height:500px)]:contents!"><p data-x="">pilula</p></div></div>'
  );
  const selos = (assistantWideHidden) => render(badgesModule.RoomStageBadges, { assistantOn: true, assistantWideHidden, presenterName: null, recording: false, topLeft: null });
  assert.match(selos(true), /^<div class="@container\/tela [^"]*" data-room-wide-hidden=""><div class="contents @min-\[640px\]\/tela:hidden \[@media\(max-height:500px\)\]:contents!"><span class="[^"]*" data-room-badge="assistant">/);
  assert.match(selos(false), /^<span class="[^"]*" data-room-badge="assistant">/, "sem item embaixo a direita, o selo como antes");
});

test("as duas salas com banner e QR Code no HTML do servidor (com a capa: Entrar na sala, Ativar som): tudo na faixa forcada; a regiao do anuncio montada e vazia (o que ja estava nao e anunciado); o vertical na doca, antes da Oferta, com alvos de 44 px", () => {
  const tela = { items: [banner(), qr({ closable: false })], pinned: null, pinnedPollId: null, pollsKey: "", stamp: "s9" };
  const aoVivo = render(liveRoom.LiveWebinarRoom, { coverUrl: null, nonce: "n0nce", payload: payloadAoVivo({ screen: tela }), presenterName: null, readOnly: false, staff: false, webinarHref: "/w" });
  const gravada = render(recordedRoom.WebinarRoom, { coverUrl: null, design: "normal", payload: payloadGravada({ screen: tela, video: VIDEO }), presenterName: null, readOnly: false, webinarHref: "/w" });
  for (const [nome, html] of [
    ["ao vivo", aoVivo],
    ["gravada", gravada]
  ]) {
    const faixa = elementWith(html, "data-room-screen-strip");
    assert.match(faixa, /data-tela="faixa"/, nome);
    assert.deepEqual([...faixa.matchAll(/data-room-screen-row="(\w+)"/g)].map(([, kind]) => kind), ["banner", "qr"], nome);
    assert.doesNotMatch(html, /data-room-screen-card=/, `${nome}: nada sobre o video com a capa`);
    assert.match(html, /<div aria-live="polite" class="sr-only" data-room-screen-announce=""><\/div>/, `${nome}: a regiao do anuncio, vazia`);
    const coluna = elementWith(html, 'data-room-slot="stage-column"');
    assert.ok(coluna.indexOf("data-room-screen-strip") > coluna.indexOf('data-room-slot="stage-box"'), `${nome}: abaixo do palco`);
    assert.doesNotMatch(html, /aria-modal="true"[\s\S]*aria-modal="true"/, `${nome}: so o dialogo da sala`);
  }
  // O Replay e a sessao encerrada nao mostram nada.
  const replay = render(recordedRoom.WebinarRoom, { coverUrl: null, design: "normal", payload: payloadGravada({ screen: tela }, { kind: "replay", offsetMs: null, roomPhase: null }), presenterName: null, readOnly: false, webinarHref: "/w" });
  assert.doesNotMatch(replay, /data-room-screen-(?:strip|row|card|dock|announce)/);

  const vertical = render(recordedRoom.WebinarRoom, { coverUrl: null, design: "vertical", payload: payloadGravada({ screen: tela, video: VIDEO }), presenterName: null, readOnly: false, webinarHref: "/w" });
  assert.doesNotMatch(vertical, /data-room-screen-strip|data-room-screen-layer/, "no vertical, nem a faixa nem a camada");
  const doca = elementWith(vertical, 'data-room-slot="dock"');
  assert.ok(doca.indexOf("data-room-screen-dock") > 0 && doca.indexOf("data-room-screen-dock") < doca.indexOf('data-room-slot="offer"'), "antes da pilula da Oferta");
  const linhas = [...doca.matchAll(/<section aria-label="([^"]*)" class="([^"]*)" data-room-screen-compact-row="(\w+)"/g)];
  assert.deepEqual(linhas.map(([, , , kind]) => kind), ["banner", "qr"], "no maximo duas");
  for (const [, , classe] of linhas) {
    assert.ok(classe.split(" ").includes("h-12"), "48 px");
  }
  assert.match(doca, /<button aria-label="Fechar o banner" class="[^"]*size-11/, "o X de 44 px");
  assert.doesNotMatch(elementWith(doca, 'data-room-screen-compact-row="qr"'), /Fechar o QR Code/, "sem poder fechar, sem X");
  for (const botao of vertical.match(/<button[^>]*>/g) ?? []) {
    assert.match(botao, /\b(size-11|h-11|min-h-11|h-12)\b/, botao.slice(0, 120));
  }
  for (const link of linksDe(doca)) {
    assert.ok(classesDe(`<a${link.attrs}>`).includes("h-11"), `o link com 44 px: ${link.texto}`);
  }
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
