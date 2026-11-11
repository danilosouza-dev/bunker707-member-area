import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// As pecas base da sala no estilo do YouTube (docs/31; docs/18 §2.2), desenhadas no Node pelo HTML do servidor: a
// pilula M e a S nos cinco estilos e com os estados (ocupado, desligado sem motivo e com motivo), o circulo e a
// compacta de menu, o grupo segmentado, o chip (filtro e aba), o contador extraido do balao e o "ghost" sem title do
// RoomIconButton. O clique do desligado com motivo e conferido pelo elemento de React: chama o onBlocked, nunca o
// onClick. O console continua com as pecas de hoje (o padrao do RoomIconButton e o contador com o mesmo HTML).
// Y3: o menu (RoomMenu, que a Visão do vídeo passa a usar), a dica (RoomTooltip, que o servidor nunca desenha) e o aviso
// invertido (RoomSnackbar, ainda sem ligar); a escolha no menu e a acao e a pausa do aviso (o ponteiro e o foco, cada um
// no seu) pelos elementos de React; a caixa da dica (RoomTooltipBubble) pelo HTML dela.

const pill = await import("../src/components/member/webinars/room/room-pill.tsx");
const chipBar = await import("../src/components/member/webinars/room/room-chip-bar.tsx");
const ui = await import("../src/components/member/webinars/room/room-ui.tsx");
const bar = await import("../src/components/member/webinars/room/room-bar.tsx");
const menuModule = await import("../src/components/member/webinars/room/room-menu.tsx");
const tooltipModule = await import("../src/components/member/webinars/room/room-tooltip.tsx");
const snackModule = await import("../src/components/member/webinars/room/room-snackbar.tsx");
const viewMenuModule = await import("../src/components/member/webinars/room/room-view-menu.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { LogOut, Mic, PanelRight, SmilePlus, ThumbsUp, Volume2, Maximize2, X } = await import("lucide-react");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const noop = () => undefined;

/** A abertura da primeira tag (ou da tag com o nome) do HTML. */
const abertura = (html, tag = "button") => html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
/** As classes de uma abertura de tag, com o & do HTML de volta. */
const classesDe = (tag) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
const temTodas = (classes, esperadas) => esperadas.filter((classe) => !classes.includes(classe));

const TONS = {
  cta: ["bg-room-cta-bg", "text-room-cta-fg", "hover:bg-room-cta-hover", "active:shadow-[inset_0_0_0_999px_var(--room-cta-press)]"],
  red: ["bg-room-accent", "text-white", "hover:bg-room-accent-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-inverse)]"],
  text: ["bg-transparent", "text-room-fg", "hover:bg-room-control-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]"],
  tonal: ["bg-room-control", "text-room-fg", "hover:bg-room-control-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]"],
  white: ["bg-room-active-bg", "text-room-active-fg", "hover:bg-room-active-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-inverse)]"]
};
const TAMANHOS = {
  m: ["h-10", "px-4", "text-sm", "leading-5", "[&_svg]:size-6"],
  s: ["h-8", "px-3", "text-xs", "leading-[18px]", "[&_svg]:size-4"]
};

test("a pilula M e a S nos cinco estilos: as classes dos tokens, a altura, o raio total, o peso 500, o anel da sala e nenhuma transicao nem title", () => {
  for (const [tom, classesDoTom] of Object.entries(TONS)) {
    for (const [tamanho, classesDoTamanho] of Object.entries(TAMANHOS)) {
      const html = render(pill.RoomPill, { icon: SmilePlus, label: "Reagir", onClick: noop, size: tamanho, tone: tom });
      const classes = classesDe(abertura(html));
      const desligado = tom === "text" ? ["disabled:bg-transparent", "aria-disabled:bg-transparent"] : ["disabled:bg-room-control", "aria-disabled:bg-room-control"];
      const esperadas = [
        "inline-flex",
        "rounded-full",
        "font-medium",
        "whitespace-nowrap",
        "focus-visible:outline-room-focus",
        "disabled:text-room-fg-disabled",
        "disabled:shadow-none",
        "aria-disabled:text-room-fg-disabled",
        ...desligado,
        ...classesDoTom,
        ...classesDoTamanho
      ];
      assert.deepEqual(temTodas(classes, esperadas), [], `${tom} ${tamanho}: ${classes.join(" ")}`);
      assert.ok(!classes.some((classe) => classe.startsWith("transition")), `${tom} ${tamanho}: a troca de fundo e instantanea`);
      assert.doesNotMatch(html, /\stitle=/, `${tom} ${tamanho}: nunca title`);
      // O rotulo visivel e o nome: sem aria-label.
      assert.match(html, /<button(?![^>]*aria-label)[^>]*type="button">[\s\S]*<\/svg>Reagir<\/button>$/, `${tom} ${tamanho}`);
    }
  }
  // O icone: 24 com traco 1,75 e o recuo do M; 16 com traco 2 e o recuo do S.
  const m = render(pill.RoomPill, { icon: LogOut, label: "Sair", tone: "red" });
  assert.match(m, /<svg[^>]*stroke-width="1.75"[^>]*class="[^"]*-ml-1\.5 mr-1\.5[^"]*"/);
  const s = render(pill.RoomPill, { icon: LogOut, label: "Sair", size: "s", tone: "red" });
  assert.match(s, /<svg[^>]*stroke-width="2"[^>]*class="[^"]*-ml-1 mr-1[^"]*"/);
  // O icone do fim (a seta da Visão do vídeo com rotulo) com o recuo do outro lado.
  const comFim = render(pill.RoomPill, { icon: PanelRight, label: "Palco", trailing: X });
  assert.match(comFim, /Palco<svg[^>]*class="[^"]*-mr-1\.5 ml-1\.5[^"]*"/);
  // A classe do lado de fora (a largura) chega ao botao.
  assert.ok(classesDe(abertura(render(pill.RoomPill, { className: "lg:hidden", label: "Sair" }))).includes("lg:hidden"));
});

test("o circulo e a compacta de menu: o nome no aria-label, sem rotulo visivel; a forma vence o tamanho (a compacta nunca recebe o recuo da pilula)", () => {
  const circuloM = render(pill.RoomPill, { icon: Maximize2, label: "Tela cheia", shape: "circle" });
  assert.match(circuloM, /^<button aria-label="Tela cheia"/);
  assert.doesNotMatch(textoSemTags(circuloM), /Tela cheia/, "o circulo nao mostra o rotulo");
  const classesM = classesDe(abertura(circuloM));
  assert.deepEqual(temTodas(classesM, ["size-10", "p-0", "rounded-full", "[&_svg]:size-6"]), []);
  assert.ok(!classesM.includes("px-4") && !classesM.includes("h-10"), classesM.join(" "));

  const circuloS = render(pill.RoomPill, { icon: X, label: "Fechar o painel", shape: "circle", size: "s", tone: "text" });
  const classesS = classesDe(abertura(circuloS));
  assert.deepEqual(temTodas(classesS, ["size-8", "p-0", "[&_svg]:size-[18px]", "bg-transparent"]), []);
  assert.ok(!classesS.includes("[&_svg]:size-4") && !classesS.includes("px-3"), classesS.join(" "));
  assert.match(circuloS, /stroke-width="2"/, "o icone de 18 com traco 2");

  const compacta = render(pill.RoomPill, { icon: PanelRight, label: "Visão do vídeo: Palco", shape: "menu" });
  assert.match(compacta, /^<button aria-label="Visão do vídeo: Palco"/);
  assert.match(compacta, /lucide-panel-right[\s\S]*lucide-chevron-down/, "o icone e a seta de 16 colada");
  const classesC = classesDe(abertura(compacta));
  assert.deepEqual(temTodas(classesC, ["h-10", "w-14", "pl-2.5", "pr-1.5", "[&_svg+svg]:size-4"]), []);
  assert.ok(!classesC.includes("px-4") && !classesC.includes("px-3"), `a forma vence o tamanho: ${classesC.join(" ")}`);
  // Mesmo pedindo o S, a compacta continua com a forma dela.
  const compactaS = pill.roomPillClassName({ shape: "menu", size: "s" }).split(" ");
  assert.ok(compactaS.includes("w-14") && !compactaS.includes("px-3") && !compactaS.includes("h-8"), compactaS.join(" "));
  // A seta da compacta nao recebe o recuo da pilula com rotulo.
  assert.doesNotMatch(compacta, /-mr-1\.5|-ml-1\.5/);
});

test("os estados da pilula: aria-pressed so quando passado, o ocupado com aria-busy e o circulo girando, o disabled com o atributo, o icone cheio do ligado e o toque de 44", () => {
  assert.doesNotMatch(render(pill.RoomPill, { icon: Mic, label: "Microfone" }), /aria-pressed/);
  assert.match(render(pill.RoomPill, { "aria-pressed": false, icon: Mic, label: "Microfone" }), /aria-pressed="false"/);
  assert.match(render(pill.RoomPill, { "aria-pressed": true, icon: Mic, label: "Microfone", tone: "white" }), /aria-pressed="true"/);

  const ocupado = render(pill.RoomPill, { busy: true, icon: Mic, label: "Microfone" });
  assert.match(ocupado, /^<button aria-busy="true"/);
  assert.match(ocupado, /lucide-loader-circle[^"]*animate-spin motion-reduce:animate-none/);
  assert.doesNotMatch(ocupado, /lucide-mic/, "o circulo no lugar do icone");
  assert.doesNotMatch(render(pill.RoomPill, { icon: Mic, label: "Microfone" }), /aria-busy/);

  const desligado = render(pill.RoomPill, { disabled: true, label: "Enviar", tone: "cta" });
  assert.match(abertura(desligado), /\sdisabled=""/);
  assert.doesNotMatch(desligado, /\saria-disabled=|sr-only/);

  // Ligada, a pilula mostra o estado no icone: o polegar cheio do Curtir (a pilula Anonima saiu em 10/11/2026, D64).
  assert.match(render(pill.RoomPill, { "aria-pressed": true, icon: ThumbsUp, iconFilled: true, label: "Curtir", size: "s" }), /<svg[^>]*fill="currentColor"/);
  assert.match(render(pill.RoomPill, { icon: ThumbsUp, label: "Curtir", size: "s" }), /<svg[^>]*fill="none"/);

  const toque = classesDe(abertura(render(pill.RoomPill, { label: "Sair", size: "s", tone: "red", touch44: true })));
  assert.deepEqual(temTodas(toque, ["relative", "after:absolute", "after:-inset-1.5", "lg:after:hidden"]), []);
  assert.ok(!classesDe(abertura(render(pill.RoomPill, { label: "Sair", size: "s" }))).includes("after:-inset-1.5"));
});

/** Desenha a pilula dentro de uma renderizacao (o useId precisa dela) e devolve tambem a arvore de React. */
function pilulaComArvore(props) {
  let arvore = null;
  function Captura() {
    arvore = pill.RoomPill(props);
    return arvore;
  }
  const html = renderToStaticMarkup(createElement(Captura));
  const filhos = [arvore?.props.children].flat(2).filter(Boolean);
  return { botao: filhos.find((filho) => filho.type === "button"), html };
}

function textoSemTags(html) {
  return html.replace(/<[^>]+>/g, " ");
}

test("o desligado com motivo: focavel (sem o atributo disabled), aria-disabled, o motivo num sr-only ligado pelo aria-describedby, e o clique chama o onBlocked, nunca o onClick", () => {
  const motivo = "Muitos alunos com o microfone aberto agora. Tente daqui a pouco.";
  const cliques = [];
  const bloqueios = [];
  const { botao, html } = pilulaComArvore({
    disabledReason: motivo,
    icon: Mic,
    label: "Microfone",
    onBlocked: () => bloqueios.push("bloqueado"),
    onClick: () => cliques.push("clique")
  });
  const tag = abertura(html);
  assert.doesNotMatch(tag, /\sdisabled=/, "continua focavel");
  assert.match(tag, /\saria-disabled="true"/);
  const descrito = /\saria-describedby="([^"]+)"/.exec(tag)?.[1];
  assert.ok(descrito, tag);
  assert.match(html, new RegExp(`</button><span class="sr-only" id="${descrito.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">${motivo}</span>$`));
  assert.doesNotMatch(html, /\stitle=/);
  // O nome continua o rotulo: o motivo nao entra no nome (fica fora do botao).
  assert.match(html, /<\/svg>Microfone<\/button>/);

  // O clique (e o Enter e o Espaco, que o navegador transforma em clique no botao) chama o onBlocked.
  let evitado = false;
  botao.props.onClick({ preventDefault: () => (evitado = true) });
  assert.deepEqual(bloqueios, ["bloqueado"]);
  assert.deepEqual(cliques, [], "a acao nao acontece");
  assert.equal(evitado, true);

  // Sem o motivo, o clique e a acao.
  const livre = pilulaComArvore({ icon: Mic, label: "Microfone", onBlocked: () => bloqueios.push("bloqueado"), onClick: () => cliques.push("clique") });
  livre.botao.props.onClick({ preventDefault: noop });
  assert.deepEqual(cliques, ["clique"]);
  assert.deepEqual(bloqueios, ["bloqueado"]);
  assert.doesNotMatch(livre.html, /\saria-disabled=|\saria-describedby=|sr-only/);

  // Com o motivo, o disabled pedido junto nao vira atributo (o motivo precisa do foco).
  assert.doesNotMatch(abertura(pilulaComArvore({ disabled: true, disabledReason: motivo, label: "Microfone" }).html), /\sdisabled=/);
});

test("o grupo segmentado [Som | Tela cheia]: role=group sem nome, duas metades de 56 px com o nome de cada uma, o traco so na primeira", () => {
  const html = renderToStaticMarkup(
    createElement(
      pill.RoomSegment,
      null,
      createElement(pill.RoomSegmentButton, { "aria-pressed": true, icon: Volume2, label: "Som", onClick: noop, position: "start" }),
      createElement(pill.RoomSegmentButton, { icon: Maximize2, label: "Tela cheia", onClick: noop, position: "end" })
    )
  );
  const grupo = abertura(html, "div");
  assert.match(grupo, /\srole="group"/);
  assert.doesNotMatch(grupo, /aria-label/);
  assert.deepEqual(temTodas(classesDe(grupo), ["inline-flex", "h-10", "rounded-full"]), []);
  const botoes = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  assert.equal(botoes.length, 2);
  assert.match(botoes[0], /aria-label="Som"/);
  assert.match(botoes[0], /aria-pressed="true"/);
  assert.match(botoes[1], /aria-label="Tela cheia"/);
  assert.doesNotMatch(botoes[1], /aria-pressed/);
  const [inicio, fim] = botoes.map(classesDe);
  for (const classes of [inicio, fim]) {
    assert.deepEqual(temTodas(classes, ["w-14", "h-10", "bg-room-control", "text-room-fg", "hover:bg-room-control-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]"]), [], classes.join(" "));
  }
  assert.deepEqual(temTodas(inicio, ["rounded-l-full", "after:absolute", "after:right-0", "after:top-2", "after:h-6", "after:w-px", "after:bg-room-divider"]), []);
  assert.ok(fim.includes("rounded-r-full") && !fim.some((classe) => classe.startsWith("after:")), fim.join(" "));
  assert.doesNotMatch(html, /\stitle=/);
  // O S: 44 px por metade e o traco de 16.
  const s = render(pill.RoomSegmentButton, { icon: Volume2, label: "Som", position: "start", size: "s" });
  assert.deepEqual(temTodas(classesDe(abertura(s)), ["w-11", "h-8", "after:h-4"]), []);
});

test("o chip: o escolhido no branco do YouTube, os outros no tonal; como filtro, aria-pressed; como aba, role=tab e aria-selected", () => {
  const escolhido = render(chipBar.RoomChip, { children: "Todas", onClick: noop, selected: true });
  const outro = render(chipBar.RoomChip, { children: "Sem resposta", onClick: noop, selected: false });
  assert.match(escolhido, /^<button aria-pressed="true"[^>]*>Todas<\/button>$/);
  assert.match(outro, /^<button aria-pressed="false"[^>]*>Sem resposta<\/button>$/);
  assert.doesNotMatch(escolhido + outro, /role="tab"|aria-selected/);
  const base = ["h-8", "rounded-[8px]", "px-3", "text-sm", "font-medium", "leading-5", "focus-visible:outline-room-focus", "disabled:text-room-fg-disabled"];
  assert.deepEqual(temTodas(classesDe(abertura(escolhido)), [...base, "bg-room-active-bg", "text-room-active-fg"]), []);
  assert.deepEqual(temTodas(classesDe(abertura(outro)), [...base, "bg-room-control", "text-room-fg", "hover:bg-room-control-hover"]), []);
  assert.ok(!classesDe(abertura(outro)).includes("bg-room-active-bg"));

  const aba = render(chipBar.RoomChip, { as: "tab", children: "Chat", id: "room-tabbtn-chat", selected: true });
  assert.match(aba, /^<button(?=[^>]*\saria-selected="true")(?=[^>]*\srole="tab")[^>]*>Chat<\/button>$/);
  assert.doesNotMatch(aba, /aria-pressed/);
  assert.match(render(chipBar.RoomChip, { as: "tab", children: "Perguntas", selected: false }), /^<button(?=[^>]*\saria-selected="false")(?=[^>]*\srole="tab")/);

  assert.match(abertura(render(chipBar.RoomChip, { children: "Minhas", disabled: true, selected: false })), /\sdisabled=""/);
  const toque = classesDe(abertura(render(chipBar.RoomChip, { as: "tab", children: "Chat", selected: false, touch44: true })));
  assert.deepEqual(temTodas(toque, ["relative", "after:-inset-1.5", "lg:after:hidden"]), []);
});

test("o contador extraido do balao: o mesmo HTML de antes no anel da superficie, o anel do fundo onde ele fica e nada com zero; o balao usa ele", () => {
  // O <span> que o RoomPanelToggle desenhava (room-bar.tsx, antes da peca propria), byte a byte.
  const antes =
    '<span aria-hidden="true" class="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-room-accent px-[5px] text-[11px] font-bold leading-none tabular-nums text-white shadow-[0_0_0_2px_var(--room-surface)]" data-room-unread="">3</span>';
  assert.equal(render(ui.RoomCountBadge, { count: 3 }), antes);
  assert.equal(render(ui.RoomCountBadge, { count: 3, ring: "surface" }), antes);
  assert.equal(render(ui.RoomCountBadge, { count: 3, ring: "bg" }), antes.replace("var(--room-surface)", "var(--room-bg)"));
  assert.equal(render(ui.RoomCountBadge, { count: 3, ring: "panel" }), antes.replace("var(--room-surface)", "var(--room-panel)"));
  assert.equal(render(ui.RoomCountBadge, { count: 0 }), "");
  assert.equal(render(ui.RoomCountBadge, { count: -2 }), "");
  assert.equal(render(ui.RoomCountBadge, { count: 2.7 }), antes.replace(">3<", ">2<"));

  const balao = render(bar.RoomPanelToggle, { onToggle: noop, open: false, unread: 3 });
  assert.ok(balao.endsWith(`</svg>${antes}</button>`), balao);
  assert.doesNotMatch(render(bar.RoomPanelToggle, { onToggle: noop, open: true, unread: 3 }), /data-room-unread/);
});

test("o RoomIconButton ghost da sala: sem fundo, sem contorno e, com withTitle={false}, sem title; o padrao do console continua com o title e o contorno", () => {
  const ghost = abertura(render(ui.RoomIconButton, { label: "Fechar o painel", tone: "ghost", withTitle: false }));
  assert.match(ghost, /aria-label="Fechar o painel"/);
  assert.doesNotMatch(ghost, /\stitle=/);
  const classes = classesDe(ghost);
  assert.deepEqual(temTodas(classes, ["bg-transparent", "text-room-icon", "hover:bg-room-control-hover", "active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]", "rounded-full"]), []);
  assert.ok(!classes.some((classe) => classe === "border" || classe.startsWith("border-")), classes.join(" "));
  // O ghost com o title (o padrao de withTitle) e o padrao do console (outline) com o title e o contorno.
  assert.match(render(ui.RoomIconButton, { label: "Tema claro", tone: "ghost" }), /title="Tema claro"/);
  const padrao = abertura(render(ui.RoomIconButton, { label: "Tema claro", size: 36, square: true }));
  assert.match(padrao, /title="Tema claro"/);
  assert.ok(classesDe(padrao).includes("border-room-border-strong") && classesDe(padrao).includes("border"), padrao);
  const controle = abertura(render(ui.RoomIconButton, { active: true, label: "Som", tone: "control" }));
  assert.match(controle, /aria-pressed="true"[^>]*title="Som"/);
  assert.ok(classesDe(controle).includes("bg-room-active-bg"));
});

/* ------------------------------------------------------------------------------------------------
 * Y3: o menu, a dica e o aviso
 * ---------------------------------------------------------------------------------------------- */

/** Desenha o menu dentro de uma renderizacao (os ganchos precisam dela) e devolve tambem a arvore de React. */
function menuComArvore(props) {
  let arvore = null;
  function Captura() {
    arvore = menuModule.RoomMenu(props);
    return arvore;
  }
  const html = renderToStaticMarkup(createElement(Captura));
  // As opcoes sao os elementos com o item e a escolha (o RoomMenuOption, ainda sem desenhar).
  const opcoes = [];
  const visitar = (no) => {
    if (Array.isArray(no)) {
      no.forEach(visitar);
      return;
    }
    if (!no || typeof no !== "object" || !("props" in no)) {
      return;
    }
    if (no.props.item && typeof no.props.onSelect === "function") {
      opcoes.push(no);
    }
    visitar(no.props.children);
  };
  visitar(arvore);
  return { html, opcoes };
}

const MENU_PROPS = (extra = {}) => ({
  align: "end",
  groups: [],
  id: "menu-teste",
  label: "Filtrar e ordenar",
  onClose: noop,
  open: true,
  placement: "below",
  triggerRef: { current: null },
  ...extra
});

test("o menu aberto (RoomMenu): role=menu com o nome, a superficie do menu do YouTube, as opcoes de 40 px (44 abaixo de lg), a escolhida com o Check, o grupo com o rotulo e o traco entre os grupos", () => {
  const escolhas = [];
  const { html } = menuComArvore(
    MENU_PROPS({
      groups: [
        {
          items: [
            { checked: false, key: "all", label: "Todas", onSelect: () => escolhas.push("all"), radio: true },
            { checked: true, key: "answered", label: "Respondidas", onSelect: () => escolhas.push("answered"), radio: true }
          ],
          label: "Mostrar"
        },
        {
          items: [
            { checked: true, key: "votadas", label: "Mais votadas", onSelect: noop, radio: true },
            { checked: false, key: "recentes", label: "Mais recentes", onSelect: noop, radio: true }
          ],
          label: "Ordenar"
        }
      ]
    })
  );
  const caixa = abertura(html, "div");
  assert.match(caixa, /^<div aria-label="Filtrar e ordenar" class="[^"]*" id="menu-teste" role="menu">$/, "aberto, sem o hidden");
  assert.deepEqual(
    temTodas(classesDe(caixa), ["absolute", "z-40", "min-w-32", "max-w-[400px]", "rounded-[12px]", "bg-room-menu", "py-2", "shadow-[var(--room-menu-shadow)]", "top-full", "mt-2", "right-0"]),
    [],
    caixa
  );

  // As opcoes: menuitemradio com aria-checked, fora da ordem do Tab, 40 px no computador e 44 no toque.
  const opcoes = [...html.matchAll(/<button\b[^>]*role="menuitemradio"[^>]*>[\s\S]*?<\/button>/g)].map(([trecho]) => trecho);
  assert.equal(opcoes.length, 4);
  for (const opcao of opcoes) {
    const tag = abertura(opcao);
    assert.match(tag, /^<button aria-checked="(true|false)"/);
    assert.match(tag, /\stabindex="-1"/);
    assert.deepEqual(temTodas(classesDe(tag), ["h-10", "max-lg:h-11", "w-full", "gap-4", "pl-4", "pr-9", "text-sm", "leading-5", "text-room-fg", "hover:bg-room-control", "focus-visible:outline-2", "focus-visible:outline-offset-[-2px]", "focus-visible:outline-current"]), [], tag);
    assert.doesNotMatch(tag, /\stitle=/);
  }
  const marcadas = opcoes.filter((opcao) => /aria-checked="true"/.test(opcao));
  assert.deepEqual(marcadas.map((opcao) => /<span class="flex-1">([^<]+)<\/span>/.exec(opcao)?.[1]), ["Respondidas", "Mais votadas"]);
  // A escolhida: o fundo tonal e o Check de 20 (o estado nao depende so do fundo); as outras, sem o Check.
  for (const opcao of opcoes) {
    const marcada = /aria-checked="true"/.test(opcao);
    assert.equal(classesDe(abertura(opcao)).includes("bg-room-control"), marcada, opcao);
    assert.equal(/lucide-check[^"]*size-5/.test(opcao), marcada, opcao);
  }

  // Os grupos: role=group com o nome, o rotulo 12/18 do secundario em cima (fora do nome, que ja e o do grupo) e o
  // traco de 1 px entre eles.
  const grupos = [...html.matchAll(/<div aria-label="([^"]+)" role="group"><div aria-hidden="true" class="([^"]*)" role="presentation">([^<]+)<\/div>/g)];
  assert.deepEqual(grupos.map(([, nome, , rotulo]) => [nome, rotulo]), [["Mostrar", "Mostrar"], ["Ordenar", "Ordenar"]]);
  assert.deepEqual(temTodas(grupos[0][2].split(" "), ["px-4", "py-1", "text-xs", "leading-[18px]", "text-room-fg-subtle"]), []);
  const tracos = [...html.matchAll(/<div class="([^"]*)" role="separator"><\/div>/g)];
  assert.equal(tracos.length, 1, "um traco entre os dois grupos");
  assert.deepEqual(temTodas(tracos[0][1].split(" "), ["my-2", "h-px", "bg-room-divider"]), []);
  assert.ok(html.indexOf('role="separator"') > html.indexOf("Respondidas") && html.indexOf('role="separator"') < html.indexOf("Mais votadas"));
  assert.deepEqual(escolhas, [], "desenhar nao escolhe nada");
});

test("o menu: uma acao e menuitem sem aria-checked, com o icone de 24; fechado fica no HTML com o hidden; acima e abaixo, e os tres alinhamentos", () => {
  const acao = menuComArvore(MENU_PROPS({ groups: [{ items: [{ icon: X, key: "clear", label: "Remover minhas mensagens", onSelect: noop }] }] })).html;
  const tag = abertura(acao);
  assert.match(tag, /\srole="menuitem"/);
  assert.doesNotMatch(tag, /aria-checked/);
  assert.match(acao, /lucide-x[^"]*size-6/, "o icone da opcao, de 24");
  assert.doesNotMatch(acao, /role="group"|role="separator"/, "um grupo sem nome: as opcoes direto no menu");

  const fechado = abertura(menuComArvore(MENU_PROPS({ open: false })).html, "div");
  assert.match(fechado, /\shidden="" id="menu-teste" role="menu">$/);

  const lugar = (placement, align) => classesDe(abertura(menuComArvore(MENU_PROPS({ align, placement })).html, "div"));
  assert.deepEqual(temTodas(lugar("above", "start"), ["bottom-full", "mb-2", "left-0"]), []);
  assert.deepEqual(temTodas(lugar("below", "end"), ["top-full", "mt-2", "right-0"]), []);
  assert.deepEqual(temTodas(lugar("above", "center"), ["left-1/2", "-translate-x-1/2"]), []);
});

test("o menu: a escolha chama a acao e fecha com o foco de volta ao botao (onClose(true)); a opcao desligada continua na lista, mas nao faz nada", () => {
  const registro = [];
  const botao = { focus: () => registro.push("foco no botao") };
  const { html, opcoes } = menuComArvore(
    MENU_PROPS({
      groups: [
        {
          items: [
            { checked: true, key: "votadas", label: "Mais votadas", onSelect: () => registro.push("votadas"), radio: true },
            { disabled: true, key: "recentes", label: "Mais recentes", onSelect: () => registro.push("recentes"), radio: true }
          ]
        }
      ],
      onClose: (refocus) => registro.push(`fechou ${refocus}`),
      triggerRef: { current: botao }
    })
  );
  assert.equal(opcoes.length, 2);
  opcoes[0].props.onSelect(opcoes[0].props.item);
  assert.deepEqual(registro, ["votadas", "foco no botao", "fechou true"], "a acao, o foco antes de o menu sumir e o fechar");

  registro.length = 0;
  opcoes[1].props.onSelect(opcoes[1].props.item);
  assert.deepEqual(registro, [], "desligada: nada acontece e o menu fica aberto");
  const desligada = abertura(html.slice(html.indexOf("Mais votadas")));
  assert.match(desligada, /\saria-disabled="true"/);
  assert.doesNotMatch(desligada, /\sdisabled=""/, "continua focavel, como pede o menu da WAI-ARIA");
  assert.ok(classesDe(desligada).includes("text-room-fg-disabled"), desligada);
});

test("a Visão do vídeo usa o RoomMenu: a superficie do menu do YouTube, as opcoes de 40 px com o icone, e o Check so na marcada", () => {
  const html = render(viewMenuModule.RoomViewMenu, { disabled: false, onChoose: noop, onOpenChange: noop, open: true, shown: "grid" });
  const caixa = abertura(html.slice(html.indexOf('<div aria-label="Visão do vídeo"')), "div");
  assert.deepEqual(temTodas(classesDe(caixa), ["bg-room-menu", "rounded-[12px]", "shadow-[var(--room-menu-shadow)]", "z-40", "bottom-full", "right-0"]), [], caixa);
  assert.ok(!classesDe(caixa).includes("bg-room-surface"), "a superficie antiga sai");
  const opcoes = [...html.matchAll(/<button aria-checked="(true|false)"[^>]*data-room-view="([a-z]+)"[^>]*role="menuitemradio"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(opcoes.map(([, marcada, view]) => [view, marcada]), [["stage", "false"], ["grid", "true"]]);
  for (const [, marcada, view, dentro] of opcoes) {
    assert.match(dentro, view === "grid" ? /lucide-layout-grid/ : /lucide-panel-right/);
    assert.equal(/lucide-check/.test(dentro), marcada === "true", view);
  }
});

test("a dica (RoomTooltip): o HTML do servidor tem so o envoltorio e o botao; a dica e desenhada so no navegador e so quando aparece", () => {
  const html = renderToStaticMarkup(
    createElement(tooltipModule.RoomTooltip, { label: "Tela cheia", side: "above" }, createElement(pill.RoomPill, { icon: Maximize2, label: "Tela cheia", shape: "circle" }))
  );
  assert.match(html, /^<span class="relative inline-flex"><button aria-label="Tela cheia"[^>]*>[\s\S]*<\/button><\/span>$/);
  assert.doesNotMatch(html, /data-room-tooltip|bg-room-tooltip-bg|\stitle=/);
  assert.doesNotMatch(textoSemTags(html), /Tela cheia/, "o nome fica so no aria-label do botao");
  const longa = renderToStaticMarkup(
    createElement(
      tooltipModule.RoomTooltip,
      { label: "Muitos alunos com o microfone aberto agora. Tente daqui a pouco.", side: "above", wide: true },
      createElement(pill.RoomPill, { disabledReason: "Muitos alunos com o microfone aberto agora. Tente daqui a pouco.", icon: Mic, label: "Microfone" })
    )
  );
  assert.doesNotMatch(longa, /data-room-tooltip/);
  assert.equal(longa.match(/Muitos alunos/g)?.length, 1, "o motivo so uma vez: no sr-only do aria-describedby");
});

test("a caixa da dica (RoomTooltipBubble): o cinza da dica com o recuo de 8, acima ou abaixo, centrada no botao ou presa a borda direita dele; uma linha, e o motivo comprido corta na terceira linha num texto de dentro, nunca na caixa do recuo", () => {
  const curta = render(tooltipModule.RoomTooltipBubble, { hiding: false, label: "Tela cheia", side: "above", wide: false });
  assert.match(curta, /^<span aria-hidden="true" class="[^"]*" data-room-tooltip="">Tela cheia<\/span>$/);
  const caixa = classesDe(abertura(curta, "span"));
  assert.deepEqual(
    temTodas(caixa, ["absolute", "z-50", "rounded-[4px]", "bg-room-tooltip-bg", "p-2", "text-xs", "leading-[18px]", "text-room-tooltip-fg", "bottom-full", "mb-2", "whitespace-nowrap", "opacity-100", "motion-reduce:transition-none"]),
    [],
    caixa.join(" ")
  );
  // Centrada no botao, o padrao (a barra, o painel e o console).
  assert.deepEqual(temTodas(caixa, ["left-1/2", "-translate-x-1/2"]), [], caixa.join(" "));
  assert.ok(!caixa.includes("right-0"), caixa.join(" "));
  const abaixo = classesDe(abertura(render(tooltipModule.RoomTooltipBubble, { hiding: true, label: "Ordenar", side: "below", wide: false }), "span"));
  assert.deepEqual(temTodas(abaixo, ["top-full", "mt-2", "opacity-0", "left-1/2", "-translate-x-1/2"]), []);
  // Presa a borda direita do botao (align="end"), para o botao na ponta direita da janela: sem o centro e sem o
  // deslocamento de metade da largura, a dica cresce para a esquerda e nunca passa da borda direita do botao.
  const naPonta = classesDe(abertura(render(tooltipModule.RoomTooltipBubble, { align: "end", hiding: false, label: "Tema escuro", side: "below", wide: false }), "span"));
  assert.deepEqual(temTodas(naPonta, ["absolute", "right-0", "top-full", "mt-2", "w-max", "whitespace-nowrap", "bg-room-tooltip-bg"]), [], naPonta.join(" "));
  assert.ok(!naPonta.includes("left-1/2") && !naPonta.includes("-translate-x-1/2"), naPonta.join(" "));

  const motivo = "Muitos alunos com o microfone aberto agora. Tente daqui a pouco.";
  const larga = render(tooltipModule.RoomTooltipBubble, { hiding: false, label: motivo, side: "above", wide: true });
  const fora = classesDe(abertura(larga, "span"));
  assert.deepEqual(temTodas(fora, ["p-2", "max-w-[280px]", "whitespace-normal"]), []);
  // O corte das 3 linhas vale na borda do recuo: na caixa com p-2, o topo da quarta linha apareceria embaixo.
  assert.ok(!fora.some((classe) => classe.startsWith("line-clamp")), fora.join(" "));
  const dentro = /<span aria-hidden="true"[^>]*><span class="([^"]*)">([^<]*)<\/span><\/span>$/.exec(larga);
  assert.ok(dentro, larga);
  assert.deepEqual(dentro[1].split(" "), ["line-clamp-3"]);
  assert.equal(dentro[2], motivo);
});

test("o aviso (RoomSnackbar): a regiao polida sempre montada e vazia sem aviso; com aviso, a caixa invertida, o texto com o live-notice, a acao como pilula de texto com o nome exato, sem icone nem X", () => {
  for (const placement of ["stage", "screen", "sheet", "side"]) {
    const vazio = render(snackModule.RoomSnackbar, { className: "absolute bottom-2 left-2", placement, snack: null });
    assert.equal(vazio, `<div aria-atomic="true" aria-live="polite" class="absolute bottom-2 left-2" data-room-snackbar="${placement}" role="status"></div>`);
  }

  const semAcao = render(snackModule.RoomSnackbar, { placement: "stage", snack: { key: "hand-lowered", text: "A equipe abaixou a sua mão." } });
  assert.match(semAcao, /^<div aria-atomic="true" aria-live="polite" data-room-snackbar="stage" role="status"><div class="[^"]*">/);
  const caixa = classesDe(abertura(semAcao.slice(semAcao.indexOf("><") + 1), "div"));
  assert.deepEqual(
    temTodas(caixa, ["flex", "min-h-12", "w-full", "max-w-[448px]", "items-center", "rounded-[8px]", "bg-room-snackbar-bg", "text-room-snackbar-fg", "shadow-[var(--room-snackbar-shadow)]", "motion-safe:animate-[room-snack-in_0.5s_ease]", "lg:min-w-[288px]"]),
    [],
    caixa.join(" ")
  );
  const texto = abertura(semAcao, "p");
  assert.match(texto, /\sdata-testid="live-notice"/);
  // A margem de 8 e 12 em volta do texto (a do YouTube), nao o recuo: o corte das 2 linhas vale na borda do recuo.
  assert.deepEqual(temTodas(classesDe(texto), ["flex-1", "mx-3", "my-2", "text-sm", "leading-5", "line-clamp-2"]), []);
  assert.ok(!classesDe(texto).some((classe) => /^p[xy]?-/.test(classe)), texto);
  assert.match(semAcao, /data-testid="live-notice">A equipe abaixou a sua mão\.<\/p><\/div><\/div>$/, "a frase inteira, e nada depois dela");
  assert.doesNotMatch(semAcao, /<svg|<button|aria-label/, "nenhum icone, nenhum X");

  const configuracoes = WEBINAR_COPY.aoVivo.configuracoes;
  const comAcao = render(snackModule.RoomSnackbar, {
    onAction: noop,
    placement: "stage",
    snack: { action: { key: "settings", label: configuracoes }, key: "no-audio", text: "Não está chegando som do seu microfone." }
  });
  const botoes = [...comAcao.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(botoes.length, 1, "so a acao");
  assert.equal(botoes[0][1], configuracoes, "o nome exato da frase, so o texto");
  const acao = abertura(botoes[0][0]);
  assert.doesNotMatch(acao, /aria-label|\stitle=/);
  assert.deepEqual(
    temTodas(classesDe(acao), ["h-10", "px-4", "rounded-full", "font-medium", "bg-transparent", "mr-3", "text-room-snackbar-action", "hover:bg-room-snackbar-action-hover", "focus-visible:outline-room-snackbar-fg"]),
    [],
    acao
  );
  assert.ok(!classesDe(acao).includes("text-room-fg") && !classesDe(acao).includes("hover:bg-room-control-hover"), "a cor da acao do aviso vence a da pilula de texto");
  assert.ok(comAcao.indexOf('data-testid="live-notice"') < comAcao.indexOf("<button"), "a acao a direita do texto");
});

/** Desenha o aviso dentro de uma renderizacao (os ganchos precisam dela) e devolve a arvore de React, com os ouvintes. */
function avisoComArvore(registro) {
  let arvore = null;
  function Captura() {
    arvore = snackModule.RoomSnackbar({
      onAction: (key) => registro.push(`acao ${key}`),
      onPauseChange: (paused) => registro.push(paused ? "pausa" : "conta"),
      placement: "stage",
      snack: { action: { key: "settings", label: WEBINAR_COPY.aoVivo.configuracoes }, key: "no-audio", text: "Não está chegando som do seu microfone." }
    });
    return arvore;
  }
  renderToStaticMarkup(createElement(Captura));
  const { props } = arvore;
  return {
    /** O foco sai do aviso (para fora) ou anda dentro dele (do texto para a acao). */
    blur: (paraFora) => props.onBlur({ currentTarget: { contains: () => !paraFora }, relatedTarget: paraFora ? null : {} }),
    focus: () => props.onFocus(),
    pointerEnter: () => props.onPointerEnter(),
    pointerLeave: () => props.onPointerLeave(),
    props
  };
}

test("o aviso: a acao chama onAction com a chave dela; o ponteiro em cima e o foco dentro pausam o tempo, e a saida de cada um sozinho volta a contar", () => {
  const registro = [];
  const aviso = avisoComArvore(registro);
  const pilula = [aviso.props.children.props.children].flat().find((filho) => filho?.type === pill.RoomPill);
  assert.ok(pilula, "a acao e uma RoomPill");
  assert.equal(pilula.props.tone, "text");
  assert.equal(pilula.props.size ?? "m", "m");
  pilula.props.onClick();
  assert.deepEqual(registro, ["acao settings"]);

  registro.length = 0;
  aviso.pointerEnter();
  aviso.pointerLeave();
  aviso.focus();
  // O foco que passa do texto para a acao continua dentro: nada muda.
  aviso.blur(false);
  aviso.focus();
  aviso.blur(true);
  assert.deepEqual(registro, ["pausa", "conta", "pausa", "conta"]);
});

test("o aviso: com o foco dentro, o ponteiro que entra e sai nao volta a contar; com o ponteiro em cima, o foco que sai tambem nao; so a saida dos dois conta (WCAG 2.2.1)", () => {
  // O teclado parado na acao e o ponteiro que passa por cima: o tempo continua parado ate o foco sair.
  const registro = [];
  const comFoco = avisoComArvore(registro);
  comFoco.focus();
  comFoco.pointerEnter();
  comFoco.pointerLeave();
  assert.deepEqual(registro, ["pausa"], "o foco continua na acao: nenhum conta");
  comFoco.blur(true);
  assert.deepEqual(registro, ["pausa", "conta"]);

  // O inverso: o ponteiro em cima e o foco que entra e sai.
  registro.length = 0;
  const comPonteiro = avisoComArvore(registro);
  comPonteiro.pointerEnter();
  comPonteiro.focus();
  comPonteiro.blur(true);
  assert.deepEqual(registro, ["pausa"], "o ponteiro continua em cima: nenhum conta");
  comPonteiro.pointerLeave();
  assert.deepEqual(registro, ["pausa", "conta"]);
});
