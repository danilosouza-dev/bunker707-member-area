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

const pill = await import("../src/components/member/webinars/room/room-pill.tsx");
const chipBar = await import("../src/components/member/webinars/room/room-chip-bar.tsx");
const ui = await import("../src/components/member/webinars/room/room-ui.tsx");
const bar = await import("../src/components/member/webinars/room/room-bar.tsx");
const { LogOut, Mic, PanelRight, SmilePlus, VenetianMask, Volume2, Maximize2, X } = await import("lucide-react");

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

test("os estados da pilula: aria-pressed so quando passado, o ocupado com aria-busy e o circulo girando, o disabled com o atributo, a mascara cheia e o toque de 44", () => {
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

  // Ligada, a Anonima mostra o estado no icone: a mascara cheia.
  assert.match(render(pill.RoomPill, { "aria-pressed": true, icon: VenetianMask, iconFilled: true, label: "Anônima", size: "s" }), /<svg[^>]*fill="currentColor"/);
  assert.match(render(pill.RoomPill, { icon: VenetianMask, label: "Anônima", size: "s" }), /<svg[^>]*fill="none"/);

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
