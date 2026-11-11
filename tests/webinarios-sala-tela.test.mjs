import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala desenhada (docs/30 §1.3 adaptado a §1.6, §1.7, §8.5 e §9; docs/18 §2.2): os pedacos desenhados no Node,
// sem navegador. O cabecalho V2 no estilo do YouTube (docs/31 V2-3: 64 px a partir de lg, o titulo, a linha com a
// data, a duracao e quem apresenta, sem o numero de quem assiste, o tema sem contorno e o Sair em pilula vermelha), os
// selos do palco da gravada (V2-4: "Ao vivo" so com a decisao da equipe, senao "Sessao das 20:00"; Replay; quem
// apresenta; e, ao lado do selo do momento, o selo de quem assiste agora, docs/31 §11.5), o palco nos estados (espera com a contagem,
// no ar com o iframe da Bunny coberto e "Ativar som", encerrada com "Assistir de novo" quando ha replay), o chat (no
// estilo do YouTube, o comentario: o avatar de 24, o nome, o selo tonal do papel e o tempo relativo, a minha com "Você"
// sem inverter, a pendente "Aguardando a equipe" na linha de acoes, a fixada no bloco do topo, o ⋮ no cabecalho do
// painel, o compositor desligado e no modo lento; o balao do Zoom fica no console e na gaveta do vertical), o aceite com o
// texto exato de §8.5 e os dois botoes, a barra de reacoes com seis botoes de 44 px, a sala inteira como dialogo
// (aria-modal, as abas, a 375 px: palco na largura, campo no rodape) e os botoes Entrar / Assistir o replay. A marca no
// cabecalho (a sala cobre o topo da area): a logo de Marca a partir de lg (o ponto em que a sala vira computador),
// "Bunker707" sem logo, sem link; abaixo de lg, nenhuma marca (V2-18).
// Fase 4d: sem o celular em pe (deitado, tablet, computador e a primeira pintura do servidor) a sala continua no
// desenho normal, igual a antes; as caixas novas do esqueleto (bolhas, aviso de venda, doca e lugar da Oferta) sao
// `contents` e nao mudam nada na tela. O desenho vertical e testado em tests/webinarios-sala-vertical-*.test.mjs.
// F7 (docs/31 V2-10): a enquete no meio do palco (o rotulo, a pergunta em h2, opcoes de 48 px, Responder depois e
// Enviar resposta; o resultado com as barras e Fechar), o card do chat com Responder agora e a aba Enquetes controlada
// pela sala; a gravada abre a enquete no palco so no desenho normal.
// A Na tela, R5 (a moderacao por pessoa na Live gravada, especificacao de 10/11/2026, §3.8): silenciado, o campo do
// chat da lugar a frase com a hora de Sao Paulo (ou "até o fim desta live") e a sala continua; removido ou banido, a sala
// inteira da lugar a frase de cada um, sem nada da Na tela; a recusa local ate a proxima leitura e o Desfazer da equipe
// que devolve o campo e a sala (as regras puras de live-room-model.ts); a pagina de entrada recusa o removido com a
// mesma frase. O desenho vertical das mesmas regras fica em tests/webinarios-sala-vertical-tela.test.mjs.

const header = await import("../src/components/member/webinars/room/room-header.tsx");
const tooltip = await import("../src/components/member/webinars/room/room-tooltip.tsx");
const branding = await import("../src/components/platform-branding.tsx");
const platformLogo = await import("../src/components/platform-logo.tsx");
const stage = await import("../src/components/member/webinars/room/room-stage.tsx");
const chat = await import("../src/components/member/webinars/room/room-chat.tsx");
const reactions = await import("../src/components/member/webinars/room/room-reactions.tsx");
const room = await import("../src/components/member/webinars/room/webinar-room.tsx");
const enter = await import("../src/components/member/webinars/webinar-enter-button.tsx");
const privacy = await import("../src/components/member/webinars/webinar-chat-privacy.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { CHAT_LIMITS, REACTIONS } = await import("../src/server/webinars/model.ts");
const vertical = await import("../src/components/member/webinars/room/vertical/vertical-model.ts");
const recorded = await import("../src/components/member/webinars/room/recorded-controls.tsx");
const notices = await import("../src/components/member/webinars/room/live-notices.tsx");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");
const { createSimulationChecker, roomSimulationStateOf } = await import("../src/components/member/webinars/room/use-room-simulation.ts");
const pollLayer = await import("../src/components/member/webinars/room/room-poll-layer.tsx");
const pollsTab = await import("../src/components/member/webinars/room/room-polls.tsx");
const questionsModule = await import("../src/components/member/webinars/room/room-questions.tsx");
const panelModule = await import("../src/components/member/webinars/room/room-panel.tsx");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const noop = () => undefined;
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });
/** A mensagem da Live ao vivo, com a hora que o servidor gravou (sentAt): a live das 20:00 mais o offset dado. */
const naLive = (id, offsetMs, extra = {}) => msg(id, { offsetMs, sentAt: new Date(T0 + offsetMs).toISOString(), ...extra });

/** As props do cabecalho V2 (V2-3), como a sala monta: a linha do computador (roomDateLine, ja junta) e a do celular. */
const HEADER = {
  metaLine: "Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza",
  mobileLine: "com Danilo Souza",
  onLeave: noop,
  onToggleTheme: noop,
  theme: "dark",
  title: "Aula de IA"
};
/** O nome de cada botao, na ordem: o aria-label ou, sem ele, o texto. */
const buttonNames = (html) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => attrs.match(/aria-label="([^"]+)"/)?.[1] ?? inner.replace(/<[^>]+>/g, "").trim());

test("cabecalho no estilo do YouTube (V2-3): 64 px a partir de lg, o titulo em 20/28 peso 700, a linha da data sem o numero de quem assiste (docs/31 §11.5), o Sair e, por ultimo, o tema; nenhum selo, sem traco e sem Minimizar (V2-2)", () => {
  const html = render(header.RoomHeader, HEADER);
  const casca = (html.match(/<header class="([^"]*)">/)?.[1] ?? "").split(" ");
  assert.ok(casca.includes("h-14") && casca.includes("lg:h-16"), `56 px no celular, 64 a partir de lg: ${casca.join(" ")}`);
  assert.ok(casca.includes("pl-4") && casca.includes("lg:pr-5") && casca.includes("lg:gap-7"), "a logo a 16 px, o tema centrado sobre o trilho, 28 px entre a logo e o titulo");
  assert.doesNotMatch(html.match(/<header [^>]*>/)?.[0] ?? "", /bg-room-surface|border-b/, "transparente, sem a borda");
  const titulo = (html.match(/<h1 class="([^"]*)">Aula de IA<\/h1>/)?.[1] ?? "").split(" ");
  for (const classe of ["text-[15px]", "font-bold", "leading-5", "lg:text-xl", "lg:leading-7", "truncate", "text-room-fg-strong"]) {
    assert.ok(titulo.includes(classe), `${classe} no titulo: ${titulo.join(" ")}`);
  }
  assert.ok(!titulo.includes("font-extrabold") && !titulo.some((nome) => nome.startsWith("lg:text-[")), "sem o 22/800 de antes");
  // A linha do computador: a data, a hora, a duracao e quem apresenta. O numero de quem assiste saiu dela (docs/31
  // §11.5: virou selo do palco, ao lado do selo do momento).
  assert.match(html, /<p class="hidden [^"]*lg:block" data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/, "a linha do computador e so a data");
  const meta = (html.match(/<p class="([^"]*)" data-room-line="meta">/)?.[1] ?? "").split(" ");
  assert.ok(["text-sm", "font-medium", "leading-5", "text-room-fg-subtle", "truncate"].every((classe) => meta.includes(classe)), `14/20 peso 500, com reticencias: ${meta.join(" ")}`);
  const celular = (html.match(/<p class="([^"]*)" data-testid="room-mobile-line">com Danilo Souza<\/p>/)?.[1] ?? "").split(" ");
  assert.ok(["text-xs", "leading-4", "font-medium", "lg:hidden"].every((classe) => celular.includes(classe)), `a linha do celular em 12/16 abaixo de lg: ${celular.join(" ")}`);
  assert.doesNotMatch(html, /room-present|assistindo/, "o numero de quem assiste nao fica mais no cabecalho");
  assert.doesNotMatch(html, /bg-room-divider|lucide-users/, "sem o traco e sem o icone de pessoas no cabecalho");
  // O Sair antes do tema, com a barra e sem ela: o tema e sempre o ultimo (a partir de lg, sobre o trilho, tambem sem a
  // barra, quando o Sair do cabecalho fica em toda largura), e o fim da sessao nao troca os dois de lugar.
  assert.deepEqual(buttonNames(html), ["Sair", "Tema claro"], "os botoes do cabecalho sem a barra: o Sair e o tema (V2-12)");
  assert.deepEqual(buttonNames(render(header.RoomHeader, { ...HEADER, leaveInBar: true })), ["Sair", "Tema claro"], "com a barra, a mesma ordem");
  assert.match(html, /<span class="relative hidden sm:inline-flex"><button aria-label="Tema claro"/, "o tema so a partir de sm (abaixo, o cabecalho nao tem largura, V2-18), sem deixar um vao vazio");
  assert.doesNotMatch(html, /Ao vivo|Sessão das|Replay|Gravando|Minimizar/, "nenhum selo no cabecalho (V2-4) e sem Minimizar (V2-2)");

  // No Replay a linha comeca na duracao (sem data e sem hora).
  const replay = render(header.RoomHeader, { ...HEADER, metaLine: "60 min · com Danilo Souza" });
  assert.match(replay, /data-room-line="meta">60 min · com Danilo Souza<\/p>/);
  // Sem linha (nada a dizer), o paragrafo nao entra.
  const vazio = render(header.RoomHeader, { ...HEADER, metaLine: "", mobileLine: "" });
  assert.doesNotMatch(vazio, /data-room-line="meta"|room-mobile-line/);
});

test("a sala gravada monta o cabecalho V2 com os dados dela: a data e a hora de Sao Paulo, a duracao e quem apresenta, sem o numero de quem assiste; no Replay, sem data e sem hora", () => {
  // A sessao marcada para as 20:00 de Sao Paulo (T0), no ar ha 2 min.
  const noAr = (extra = {}, sessionExtra = {}) => payload(extra, { offsetMs: 120_000, scheduledAt: new Date(T0).toISOString(), ...sessionExtra });
  const props = { coverUrl: null, payload: noAr(), presenterName: "Danilo Souza", readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const cabecalho = (html) => html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  const gravada = cabecalho(render(room.WebinarRoom, props));
  assert.match(gravada, /data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/);
  assert.match(gravada, /data-testid="room-mobile-line">com Danilo Souza<\/p>/);
  assert.doesNotMatch(gravada, /Ao vivo|Sessão das/, "o selo do momento fica no palco");
  assert.doesNotMatch(gravada, /assistindo|room-present/, "o numero de quem assiste fica no palco (docs/31 §11.5)");

  const semApresentador = cabecalho(render(room.WebinarRoom, { ...props, presenterName: null }));
  assert.match(semApresentador, /data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min<\/p>/, "sem apresentador, sem o trecho");
  assert.doesNotMatch(semApresentador, /room-mobile-line/, "sem apresentador, a linha do celular sai");

  const replay = cabecalho(render(room.WebinarRoom, { ...props, payload: noAr({}, { kind: "replay", offsetMs: null, roomPhase: null }) }));
  assert.match(replay, /data-room-line="meta">60 min · com Danilo Souza<\/p>/, "no replay sem data e sem hora: a linha comeca em 60 min");
  assert.match(replay, /data-testid="room-mobile-line">com Danilo Souza<\/p>/);

  const encerrada = cabecalho(render(room.WebinarRoom, { ...props, payload: noAr({}, { roomPhase: "ended", status: "ended" }) }));
  assert.match(encerrada, /data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/);
});

test("o selo de quem assiste agora fica no palco, ao lado do selo do momento (docs/31 §11.5): o icone de pessoas e o numero, com a frase inteira no title e para o leitor de tela; some no Replay e com a sessao encerrada", () => {
  const props = { coverUrl: null, payload: payload(), presenterName: "Danilo Souza", readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const caixa = (html) => {
    const inicio = html.indexOf('data-room-slot="stage-box"');
    return html.slice(inicio, html.indexOf('data-room-slot="bubbles"', inicio));
  };
  const selo = (html) => html.match(/<span class="([^"]*)" data-testid="room-present" title="([^"]*)">([\s\S]*?)<\/span><\/span>/);

  // Com o "Ao vivo" ligado pela equipe (D10): logo depois do selo vermelho, na mesma fileira de cima a esquerda.
  const aoVivo = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { showLiveBadge: true }) }));
  assert.match(aoVivo, /data-testid="room-on-air">[\s\S]*?<\/span><\/span><span class="[^"]*" data-testid="room-present"/, "o numero vem logo depois do Ao vivo");
  const [, classes, titulo, dentro] = selo(aoVivo) ?? [];
  assert.equal(titulo, "2 assistindo agora", "a frase inteira no title");
  assert.ok((classes ?? "").split(" ").includes("pointer-events-none") && (classes ?? "").includes("bg-black/60") && (classes ?? "").split(" ").includes("tabular-nums"), `a pilula neutra sobre o video, sem receber o toque: ${classes}`);
  assert.match(dentro ?? "", /^<svg[^>]*lucide-users[^>]*aria-hidden="true"[\s\S]*?<\/svg><span aria-hidden="true">2<\/span><span class="sr-only">2 assistindo agora$/, "o icone de pessoas, o numero para quem ve e a frase para o leitor de tela");
  assert.equal((aoVivo.match(/data-testid="room-present"/g) ?? []).length, 1, "uma vez so");

  // Sem a decisao da equipe ("Sessão das 19:58"), o numero tambem vem ao lado do selo do momento.
  const sessao = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { showLiveBadge: false }) }));
  assert.match(sessao, /Sessão das 19:58 · <span class="tabular-nums">[0-9:]+<\/span><\/span><span class="[^"]*" data-testid="room-present" title="2 assistindo agora">/);

  // O numero somado da Simulacao e o milhar como no Brasil saem do mesmo selo (roomPresentBadge).
  const cheia = caixa(render(room.WebinarRoom, { ...props, payload: payload({ presentNow: 1234 }, { showLiveBadge: true }) }));
  assert.match(cheia, /data-testid="room-present" title="1\.234 assistindo agora">[\s\S]*?<span aria-hidden="true">1\.234<\/span>/);

  // Replay e sessao encerrada: sem contador (a encerrada nem tem selos no palco).
  const replay = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { kind: "replay", offsetMs: null, roomPhase: null }) }));
  assert.doesNotMatch(replay, /room-present|assistindo/, "o replay nao tem contador");
  const encerrada = render(room.WebinarRoom, { ...props, payload: payload({}, { roomPhase: "ended", status: "ended" }) });
  assert.doesNotMatch(encerrada, /room-present|assistindo/, "encerrada, sem contador");
});

test("selos do palco da gravada (V2-4, a regra D10): Ao vivo so com a decisao da equipe, senao Sessao das 20:00 com o tempo; Replay sem selo embaixo; quem apresenta embaixo a esquerda", () => {
  const props = { coverUrl: null, payload: payload(), presenterName: "Danilo Souza", readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const caixa = (html) => {
    const inicio = html.indexOf('data-room-slot="stage-box"');
    return html.slice(inicio, html.indexOf('data-room-slot="bubbles"', inicio));
  };

  // O tempo no ar anda pelo relogio do aparelho (RoomElapsed): aqui so a forma.
  const aoVivo = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { showLiveBadge: true }) }));
  assert.match(aoVivo, /data-room-badges="top"><span class="[^"]*bg-room-accent[^"]*" data-testid="room-on-air">/, "o Ao vivo vermelho em cima a esquerda");
  assert.match(aoVivo, /<span class="max-sm:sr-only">Ao vivo · <\/span><span class="tabular-nums">[0-9:]+<\/span>/, "o tempo no ar; no celular so o tempo (a frase para o leitor de tela)");
  assert.doesNotMatch(aoVivo, /Sessão das/);
  assert.match(aoVivo, /data-room-badge="presenter"[\s\S]*?>Danilo Souza · Apresentador</);

  const sessao = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { showLiveBadge: false }) }));
  assert.match(sessao, /data-room-badges="top"><span class="[^"]*bg-black\/60[^"]*">Sessão das 19:58 · <span class="tabular-nums">[0-9:]+<\/span><\/span>/, "sem a decisao, Sessao das 19:58 e o tempo, neutro sobre o video");
  assert.doesNotMatch(sessao, /Ao vivo|room-on-air/, "sem a decisao, nada de Ao vivo");

  const espera = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString(), showLiveBadge: false }) }));
  assert.match(espera, /data-room-badges="top"><span class="[^"]*">Sessão das 20:04<\/span>/, "na espera, so a hora");
  assert.doesNotMatch(espera, /data-room-badge="presenter"/, "sem o video no ar, sem o selo de quem apresenta");

  const replay = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { kind: "replay", offsetMs: null, roomPhase: null }) }));
  assert.match(replay, /data-room-badges="top"><span class="[^"]*">Replay<\/span><\/div>/);
  // No Replay a barra de controles da Bunny ocupa a base do video (play, tempo, tela cheia): nenhum selo embaixo, nem
  // quem apresenta nem o Assistente, para nao cobrir os controles.
  assert.doesNotMatch(replay, /data-room-badge="presenter"|data-room-badge="assistant"/, "no Replay, nada embaixo");

  // Fora do acesso (D41) e no vertical, nenhum selo no palco (o vertical tem o topo dele).
  assert.doesNotMatch(render(room.WebinarRoom, { ...props, design: "vertical" }), /data-room-badges|data-room-badge=/);
  // Sem a gravada ter a coluna de miniaturas, os selos de baixo vao ate a borda do video.
  assert.match(render(room.WebinarRoom, props), /data-room-slot="stage-box" style="--room-video-right:0px"/);
});

test("o tema da sala (V2-12, no estilo do YouTube): o botao redondo de 40 px sem contorno e sem fundo diz para qual tema vai, sem title (a dica mostra o nome, presa a borda direita do botao); o dialogo leva o data-room-theme, escuro na primeira pintura; o vertical e sempre escuro e sem o botao", () => {
  const botao = (html, nome) => html.match(new RegExp(`<button aria-label="${nome}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? "";

  // No escuro, o Sol com "Tema claro"; no claro, a Lua com "Tema escuro" (o nome diz o que o clique faz).
  const escuro = botao(render(header.RoomHeader, HEADER), "Tema claro");
  assert.match(escuro, /^<button aria-label="Tema claro" class="[^"]*" type="button">/, "o nome no aria-label");
  assert.doesNotMatch(escuro, /title=/, "sem o title nativo: a dica da sala (RoomTooltip) mostra o nome");
  assert.match(escuro, /lucide-sun/);
  assert.match(escuro, /stroke-width="1.75"/, "o traco de 1,75 no icone de 24");
  const classes = (escuro.match(/class="([^"]*)"/)?.[1] ?? "").replaceAll("&amp;", "&").split(" ");
  assert.ok(classes.includes("size-10") && classes.includes("rounded-full"), "redondo, 40 px");
  assert.ok(classes.includes("[&_svg]:size-6") && !classes.includes("[&_svg]:size-[18px]"), "o icone de 24");
  assert.ok(!classes.includes("border") && !classes.some((nome) => nome.startsWith("border-")), "sem contorno (V2-12)");
  assert.ok(classes.includes("bg-transparent") && classes.includes("hover:bg-room-control-hover"), "sem fundo; o tonal so com o ponteiro");
  assert.ok(!classes.includes("bg-room-surface"), "sem o fundo do outline de antes");
  assert.doesNotMatch(escuro, /aria-pressed/, "o nome muda com o tema: nada de aria-pressed");
  assert.doesNotMatch(render(header.RoomHeader, HEADER), /data-room-tooltip/, "a dica so aparece no navegador, com o ponteiro ou o foco");
  const claroHtml = render(header.RoomHeader, { ...HEADER, theme: "light" });
  assert.doesNotMatch(claroHtml, /Tema claro/);
  const claro = botao(claroHtml, "Tema escuro");
  assert.match(claro, /lucide-moon/);
  // A dica do tema abaixo do botao e presa a borda direita dele: o tema e o ultimo do cabecalho (a 20 px da borda a
  // partir de lg, a 16 entre sm e lg), e a dica centrada ("Tema escuro", uns 89 px) passaria da borda da janela.
  for (const [tema, nome] of [["dark", "Tema claro"], ["light", "Tema escuro"]]) {
    const dica = header.RoomThemeButton({ onToggle: noop, theme: tema });
    assert.equal(dica.type, tooltip.RoomTooltip, tema);
    assert.deepEqual({ align: dica.props.align, label: dica.props.label, side: dica.props.side }, { align: "end", label: nome, side: "below" }, tema);
  }

  // A sala inteira: o atributo no dialogo (nunca no html), o escuro antes de ler o navegador, as cores pelos tokens.
  const props = { coverUrl: null, payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const dialogo = (html) => html.match(/<div [^>]*role="dialog"[^>]*>/)?.[0] ?? "";
  const normal = render(room.WebinarRoom, props);
  assert.match(dialogo(normal), /data-room-theme="dark"/);
  assert.equal((normal.match(/data-room-theme=/g) ?? []).length, 1, "um so lugar: o dialogo");
  assert.match(normal, /<button aria-label="Tema claro"/);
  assert.match(normal, /data-testid="room-panel"/);
  // O painel (V2-7): a partir de lg o cartao do YouTube pelo token do painel; abaixo de lg, o cartao da aba e a lista das
  // abas pelos tokens de antes.
  assert.match(normal.match(/<aside aria-labelledby="room-panel-title" class="[^"]*"/)?.[0] ?? "", /\blg:bg-room-panel\b/, "o cartao do painel pelo token do tema");
  assert.match(normal.match(/<div aria-labelledby="room-tabbtn-chat" class="[^"]*"/)?.[0] ?? "", /\bbg-room-surface\b[^"]*\blg:bg-transparent\b/, "o cartao da aba abaixo de lg");
  assert.match(normal, /role="tablist"/);
  assert.match(normal.match(/<div aria-label="Painel da sala" class="[^"]*"/)?.[0] ?? "", /\bbg-room-tabs\b/, "a lista das abas pelo token");

  // O desenho vertical 9:16 fica sobre o video: sempre escuro, sem o cabecalho (e sem o botao de tema).
  const vertical = render(room.WebinarRoom, { ...props, design: "vertical" });
  assert.match(dialogo(vertical), /data-room-design="vertical"/);
  assert.match(dialogo(vertical), /data-room-theme="dark"/);
  assert.doesNotMatch(vertical, /Tema claro|Tema escuro/);
});

test("cabecalho: a logo da sala e a do topo da area (PlatformLogo), a mesma tag, so a partir de lg e sem link; sem logo, o mesmo nome em texto; abaixo de lg, nenhuma marca", () => {
  const comMarca = (marca, props = {}) =>
    renderToStaticMarkup(createElement(branding.PlatformBrandingProvider, { branding: marca }, createElement(header.RoomHeader, { ...HEADER, ...props })));
  const tag = (html, nome) => html.match(new RegExp(`<[a-z]+[^>]*data-room-brand="${nome}"[^>]*>`))?.[0] ?? "";
  const imagem = (html) => html.match(/<img[^>]*>/)?.[0] ?? "";
  const daArea = (props) => render(platformLogo.PlatformLogo, { alt: "Bunker707", ...props });
  const classes = (html) => (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ").sort();
  const classesDaImagem = (html) => (html.match(/<img[^>]*class="([^"]*)"/)?.[1] ?? "").split(" ");
  const LOGO = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/logo.png";
  const ICONE = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/icone.png";

  // A logo padrao (sem Marca) e a enviada em Marca: na sala, a mesma tag que o topo da area desenha, atributo por
  // atributo (as classes, width 306 e height 35, o alt e o arquivo); nenhum tamanho proprio da sala.
  const semMarca = renderToStaticMarkup(createElement(header.RoomHeader, HEADER));
  const comLogo = comMarca({ logoImage: LOGO, schoolIcon: ICONE });
  for (const [html, src] of [[semMarca, branding.DEFAULT_PLATFORM_LOGO], [comLogo, LOGO]]) {
    const daSala = imagem(html);
    assert.ok(daSala, `a logo ${src} na sala`);
    assert.equal(daSala, imagem(daArea({ src })), `a logo ${src} igual a do topo da area`);
    assert.match(daSala, /width="306"/);
    assert.match(daSala, /height="35"/);
    const lista = classesDaImagem(daSala);
    assert.ok(!lista.includes("w-[112px]"), "sem a largura antiga da sala (112 px)");
    assert.deepEqual(lista.filter((nome) => nome.startsWith("max-h-")), ["max-h-10"], "no maximo 40 de altura, como no topo da area (antes, 32)");
    assert.doesNotMatch(daSala, /brightness-0/, "no escuro, a logo como e");
    assert.doesNotMatch(html, />Bunker707</, "com a logo, sem o nome em texto");
  }
  assert.match(imagem(semMarca), /src="\/brand\/logo-bunker\.svg"/, "sem Marca, a logo padrao");

  // Sem logo em Marca: o mesmo nome em texto do topo da area (o tamanho e o peso dele), na cor forte do tema da sala.
  const semLogo = comMarca({ logoImage: null });
  const nome = semLogo.match(/data-room-brand="logo"[^>]*>\s*(<span [^>]*>Bunker707<\/span>)\s*<\/div>/)?.[1] ?? "";
  assert.ok(nome, "o nome em texto dentro da marca");
  assert.deepEqual(classes(nome), [...classes(daArea({ src: null })), "text-room-fg-strong"].sort(), "o nome do topo da area mais a cor do tema");
  assert.doesNotMatch(semLogo, /<img/, "sem logo, nenhuma imagem");

  // Abaixo de lg o cabecalho e o titulo, a linha do celular, o tema (a partir de sm) e o Sair (V2-18): sem o Icone.
  for (const html of [semMarca, semLogo, comLogo]) {
    assert.match(tag(html, "logo"), /class="hidden shrink-0 items-center lg:flex"/, "a marca so a partir de lg");
    assert.equal(tag(html, "icon"), "", "sem o Icone da escola");
    assert.doesNotMatch(html, new RegExp(ICONE.replace(/[.]/g, "\\.")));
    // Sem link: sair da live passa pela confirmacao (askToLeave), nunca por um clique na logo.
    assert.doesNotMatch(html, /<a\b/);
    // A marca vem antes do titulo; o titulo continua encolhendo.
    assert.ok(html.indexOf('data-room-brand="logo"') < html.indexOf("<h1"));
    assert.match(html, /<h1 class="min-w-0 truncate/);
  }
});

test("cabecalho no tema claro (V2-3, opcao C): a logo padrao fica preta (brightness-0); a enviada em Marca, feita para a area escura, vira o nome em texto; no escuro, nenhum filtro", () => {
  const LOGO = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/logo.png";
  const comMarca = (marca, props = {}) =>
    renderToStaticMarkup(createElement(branding.PlatformBrandingProvider, { branding: marca }, createElement(header.RoomHeader, { ...HEADER, ...props })));
  const marca = (html) => html.slice(html.indexOf("data-room-brand"), html.indexOf("<h1"));
  const classes = (html) => (html.match(/<img[^>]*class="([^"]*)"/)?.[1] ?? "").split(" ");

  // Claro com a logo padrao (toda branca): a mesma imagem, com o filtro que a deixa preta sobre o fundo claro.
  const padraoClaro = marca(comMarca({ logoImage: branding.DEFAULT_PLATFORM_LOGO }, { theme: "light" }));
  assert.match(padraoClaro, /<img[^>]*alt="Bunker707"[^>]*src="\/brand\/logo-bunker\.svg"/);
  assert.ok(classes(padraoClaro).includes("brightness-0"), "a logo padrao em preto");
  assert.deepEqual(
    classes(padraoClaro).filter((nome) => nome !== "brightness-0"),
    classes(render(platformLogo.PlatformLogo, { alt: "Bunker707", src: branding.DEFAULT_PLATFORM_LOGO })),
    "fora o filtro, as classes do topo da area"
  );
  assert.ok(classes(marca(renderToStaticMarkup(createElement(header.RoomHeader, { ...HEADER, theme: "light" })))).includes("brightness-0"), "sem Marca, a padrao tambem");

  // Claro com a logo enviada: o nome da escola em texto, na cor forte do tema.
  const enviadaClaro = marca(comMarca({ logoImage: LOGO }, { theme: "light" }));
  assert.doesNotMatch(enviadaClaro, /<img/, "no claro, a logo enviada nao aparece");
  assert.match(enviadaClaro, /<span class="[^"]*\btext-room-fg-strong\b[^"]*">Bunker707<\/span>/, "o nome da escola, no texto forte do tema");

  // Escuro: as duas logos sem o filtro.
  for (const logoImage of [branding.DEFAULT_PLATFORM_LOGO, LOGO]) {
    const escuro = marca(comMarca({ logoImage }, { theme: "dark" }));
    assert.match(escuro, /<img[^>]*alt="Bunker707"/, `no escuro, a logo ${logoImage}`);
    assert.ok(!classes(escuro).includes("brightness-0"), `no escuro, ${logoImage} sem filtro`);
  }

  // O numero de quem assiste saiu do cabecalho (docs/31 §11.5): nenhum contador e nenhum traco antes do tema, nos dois
  // temas.
  for (const theme of ["dark", "light"]) {
    const cabecalho = comMarca({ logoImage: LOGO }, { theme });
    assert.match(cabecalho, /data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/, `${theme}: a linha da data`);
    assert.doesNotMatch(cabecalho, /room-present|bg-room-divider/, `${theme}: sem o contador e sem o traco`);
  }
});

test("os campos do painel tem 16 px abaixo de lg (o Safari do iPhone da zoom no foco de um campo menor): o chat e a pergunta; o aceite nao tem mais campo (sem apelido, D64)", () => {
  const questions = renderToStaticMarkup(
    createElement(questionsModule.RoomQuestionsTab, { consented: true, enabled: false, getOffsetMs: () => 0, onConsented: noop, readOnly: false, sessionId: "s1", webinarId: "w1" })
  );
  // O aceite nao tem mais o campo do apelido (D64): nenhum campo de texto que o iPhone pudesse ampliar.
  const aceite = render(chat.RoomConsentBox, { onAccept: noop, onCancel: noop });
  assert.doesNotMatch(aceite, /<input|<textarea|Apelido|apelido/);
  // O campo do YouTube (Y11) no chat e nas Perguntas da sala: 16/22 abaixo de lg e 14/20 a partir de lg.
  const campoDoChat = render(chat.RoomChatPanel, { chatMode: "open", consented: true, displayName: "Ana S.", error: null, messages: [], nowMs: T0, onRemoveMine: async () => 0, onSend: async () => ({ pending: false }), phase: "live", pinned: null, readOnly: false, slowUntilMs: null, timeKind: "live" });
  const perguntasDaSala = renderToStaticMarkup(
    createElement(questionsModule.RoomQuestionsTab, { consented: true, enabled: false, getOffsetMs: () => 0, look: "comment", onConsented: noop, readOnly: false, sessionId: "s1", webinarId: "w1" })
  );
  const classes = (tag) => (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
  for (const [nome, tag] of [
    ["o chat", campoDoChat.match(/<textarea aria-label="Escreva uma mensagem"[^>]*>/)?.[0] ?? ""],
    ["a pergunta da sala", perguntasDaSala.match(/<textarea aria-label="Sua pergunta"[^>]*>/)?.[0] ?? ""],
    ["a pergunta", questions.match(/<textarea aria-label="Sua pergunta"[^>]*>/)?.[0] ?? ""]
  ]) {
    const lista = classes(tag);
    assert.ok(lista.includes("text-base") && lista.includes("lg:text-sm"), `${nome}: ${lista.join(" ")}`);
    assert.ok(!lista.includes("text-sm"), `${nome}: sem os 14 px abaixo de lg`);
  }
});

test("D82: ao lado do campo do chat e do campo da pergunta, a minha foto do Perfil ou as minhas iniciais, antes e depois do aceite (so eu vejo); sem nome, a pessoa", () => {
  const FOTO = "https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/u1/ana.webp";
  const fotoNoAvatar = new RegExp(`<img[^>]*src="${FOTO.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`);
  /** O avatar da linha do campo (o primeiro filho da linha, antes da coluna do textarea) com o rotulo dado. */
  const avatarDoCampo = (markup, rotulo) => {
    const area = markup.indexOf(`<textarea aria-label="${rotulo}"`);
    assert.ok(area >= 0, `o campo ${rotulo}`);
    const linha = markup.lastIndexOf('<div class="mr-4 flex items-start">', area);
    assert.ok(linha >= 0, `a linha do campo ${rotulo}`);
    return markup.slice(linha, markup.indexOf('<div class="ml-3 min-w-0 flex-1">', linha));
  };
  const chatBase = { chatMode: "open", error: null, messages: [], nowMs: T0, onRemoveMine: async () => 0, onSend: async () => ({ pending: false }), phase: "live", readOnly: false, slowUntilMs: null, timeKind: "live" };
  const perguntasBase = { enabled: false, getOffsetMs: () => 0, look: "comment", onConsented: noop, readOnly: false, sessionId: "s1", webinarId: "w1" };
  const campos = (me) => [
    ["o chat", avatarDoCampo(render(chat.RoomChatPanel, { ...chatBase, ...me }), WEBINAR_COPY.sala.escreva)],
    ["a pergunta", avatarDoCampo(render(questionsModule.RoomQuestionsTab, { ...perguntasBase, ...me }), WEBINAR_COPY.sala.suaPergunta)]
  ];

  for (const consented of [false, true]) {
    const quando = consented ? "depois do aceite" : "antes do aceite";
    for (const [nome, avatar] of campos({ avatarUrl: FOTO, consented, displayName: "Ana S." })) {
      assert.match(avatar, fotoNoAvatar, `${nome}, ${quando}: a minha foto`);
      assert.doesNotMatch(avatar, /lucide-user-round/, `${nome}, ${quando}: nunca a pessoa com a foto`);
    }
    for (const [nome, avatar] of campos({ avatarUrl: null, consented, displayName: "Ana S." })) {
      assert.match(avatar, /<span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span[^>]*>AS<\/span><\/span>/, `${nome}, ${quando}: sem foto, as minhas iniciais`);
      assert.doesNotMatch(avatar, /lucide-user-round|<img/, `${nome}, ${quando}: nem a pessoa, nem foto`);
    }
  }
  // Sem nome (uma pagina com o payload de antes), a pessoa no lugar das iniciais.
  for (const [nome, avatar] of campos({ avatarUrl: null, consented: false, displayName: null })) {
    assert.match(avatar, /lucide-user-round/, `${nome}: sem nome, a pessoa`);
  }
});

test("palco: espera com a contagem, no ar com o iframe da Bunny coberto e Ativar som, encerrada com Assistir de novo; os atributos do sinal de midia", () => {
  const base = { countdownLabel: "4 min", coverUrl: null, embedUrl: EMBED, iframeRef: noop, muted: true, onUnmute: noop, replayHref: null, sessionId: "s1", state: "waiting", title: "Aula de IA" };
  const waiting = render(stage.RoomStage, base);
  assert.match(waiting, /Começa em 4 min/);
  assert.doesNotMatch(waiting, /<iframe/, "antes do zero o player nao monta");
  assert.match(waiting, /data-lesson-player-stage/);
  assert.match(waiting, /data-lesson-id="webinar:s1"/);
  assert.doesNotMatch(waiting, /data-lesson-player-kind/, "sem player, sem ponte");

  const live = render(stage.RoomStage, { ...base, state: "live" });
  assert.match(live, /<iframe[^>]+src="https:\/\/iframe\.mediadelivery\.net\/embed\/12345\/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc\?autoplay=true&amp;muted=true&amp;controls=false"/);
  assert.match(live, /data-lesson-player-kind="iframe"/);
  assert.match(live, /data-lesson-player-bridge=""/);
  assert.match(live, /data-room-lock/, "a capa que cobre o player travado");
  assert.match(live, /Ativar som/);
  assert.doesNotMatch(live, /allowfullscreen/i, "sem tela cheia na gravada");
  assert.match(live, /aspect-video w-full/, "a 375 px o palco ocupa a largura");

  const unmuted = render(stage.RoomStage, { ...base, muted: false, state: "live" });
  assert.doesNotMatch(unmuted, /Ativar som/);

  const replay = render(stage.RoomStage, { ...base, muted: false, state: "replay" });
  assert.doesNotMatch(replay, /data-room-lock/, "o replay e livre");
  assert.match(replay, /allowfullscreen/i);

  const ended = render(stage.RoomStage, { ...base, replayHref: "/webinarios/aula/sala?sessao=r1", state: "ended" });
  assert.match(ended, /Essa live acabou\./);
  assert.match(ended, /href="\/webinarios\/aula\/sala\?sessao=r1"/);
  assert.match(ended, /Assistir de novo/);
  const endedNoReplay = render(stage.RoomStage, { ...base, state: "ended" });
  assert.match(endedNoReplay, /O replay fica pronto em algumas horas\./);
  assert.doesNotMatch(endedNoReplay, /Assistir de novo/);

  const noVideo = render(stage.RoomStage, { ...base, embedUrl: null, state: "live" });
  assert.match(noVideo, /ainda não está disponível/);

  // Quem saiu do Quem pode no meio da sessao (o 404 da sessao ou da presenca, D41): o player desmonta e a frase fica.
  const fora = render(stage.RoomStage, { ...base, coverUrl: "https://cdn.example.com/capa.jpg", muted: false, state: "unavailable" });
  assert.doesNotMatch(fora, /<iframe/, "o player nao continua com a URL que ja veio");
  assert.doesNotMatch(fora, /data-lesson-player-kind/);
  assert.doesNotMatch(fora, /<img/, "sem a capa por tras da frase");
  assert.match(fora, /data-room-stage="unavailable"/);
  assert.match(fora, /role="alert">Esta live não está disponível para você\.</);
});

/** O item do chat (o li da mensagem) e a linha de baixo do balao, so o texto. */
const chatItem = (html, id) => {
  const inicio = html.lastIndexOf("<li", html.indexOf(`data-room-message="${id}"`));
  return html.slice(inicio, html.indexOf("</li>", inicio) + 5);
};
/** As classes esperadas que faltam numa lista de classes (o & do HTML de volta). */
const temTodasAs = (classes, esperadas) => {
  const lista = classes.replace(/&amp;/g, "&").split(/\s+/);
  return esperadas.filter((classe) => !lista.includes(classe));
};
const chatMeta = (item) =>
  (item.match(/<p [^>]*data-room-message-meta="">([\s\S]*?)<\/p>/)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("o chat da sala e o comentario do YouTube (V2-9 trocado): o avatar de 24, o nome, o selo tonal e o tempo relativo na linha do autor (so para quem ve), o autor antes do texto para o leitor de tela; a minha com Você e sem inverter; o Replay sem tempo", () => {
  const base = {
    chatMode: "open",
    consented: true,
    displayName: "Ana S.",
    error: null,
    messages: [
      naLive("1", 42 * MIN, { displayName: "Bia C." }),
      naLive("2", 41 * MIN, { displayName: "Marina R.", role: "team" }),
      naLive("3", 1000, { displayName: "Danilo", role: "host" }),
      naLive("4", 1000, { displayName: "Assistente", role: "ai" }),
      naLive("5", 43 * MIN, { mine: true, pending: true }),
      naLive("6", 1000, { displayName: "Convidada", role: "guest" }),
      naLive("7", 1000, { displayName: "Rui P.", role: "co_host" })
    ],
    // O agora do aparelho; com o skew, o do servidor (20:43).
    nowMs: T0 + 43 * MIN - 2 * MIN,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: null,
    readOnly: false,
    skewMs: 2 * MIN,
    slowUntilMs: null,
    // A live: o instante de cada mensagem e o que o servidor gravou (sentAt), nunca o zero mais o offset.
    timeKind: "live"
  };
  const html = render(chat.RoomChatPanel, base);

  // A linha do autor: o nome, o selo (so dos quatro papeis) e o tempo; o aluno e o convidado sem selo.
  assert.equal(chatMeta(chatItem(html, "2")), "Marina R. Equipe há 2 minutos");
  assert.equal(chatMeta(chatItem(html, "1")), "Bia C. há 1 minuto", "o aluno sem selo");
  assert.equal(chatMeta(chatItem(html, "3")), "Danilo Apresentador há 43 minutos");
  assert.equal(chatMeta(chatItem(html, "6")), "Convidada há 43 minutos", "o convidado sem selo");
  assert.equal(chatMeta(chatItem(html, "7")), "Rui P. Co-apresentador há 43 minutos", "o co-apresentador com o papel proprio (V2-A12)");
  // O Assistente: o nome igual ao papel, so o selo, e o leitor de tela nao repete o papel.
  assert.equal(chatMeta(chatItem(html, "4")), "Assistente há 43 minutos");
  assert.match(chatItem(html, "4"), /<span class="sr-only">Assistente, há 43 minutos: <\/span>texto 4/);
  assert.match(chatItem(html, "4"), /lucide-sparkles/, "o avatar do Assistente");

  const marina = chatItem(html, "2");
  // O item: o avatar de 24 (as iniciais), a coluna do texto, e o chat curto embaixo pelo margin-top auto do primeiro.
  assert.match(marina, /^<li class="flex mb-4 first:mt-auto" data-room-message="2"><span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span class="[^"]*">MR<\/span><\/span><div class="ml-3 min-w-0 flex-1">/);
  // A linha do autor e so para quem ve; o selo tonal de 20 px; o tempo num <time> com a hora exata no title.
  const linha = marina.match(/<p aria-hidden="true" class="([^"]*)" data-room-message-meta="">([\s\S]*?)<\/p>/);
  assert.ok(linha, "a linha do autor com aria-hidden");
  assert.deepEqual(temTodasAs(linha[1], ["mb-0.5", "flex", "h-5", "items-center", "gap-1"]), []);
  assert.match(linha[2], /<span class="[^"]*\btruncate\b[^"]*\btext-xs\b[^"]*\bfont-medium\b[^"]*\btext-room-fg\b[^"]*">Marina R\.<\/span>/);
  const selo = linha[2].match(/<span class="([^"]*)">Equipe<\/span>/);
  assert.ok(selo, "o selo do papel");
  assert.deepEqual(temTodasAs(selo[1], ["inline-flex", "h-5", "rounded-full", "bg-room-control", "px-1.5", "text-xs", "font-medium", "leading-[18px]", "text-room-fg"]), []);
  assert.match(linha[2], /<time class="[^"]*\btext-room-fg-subtle\b[^"]*" dateTime="2026-11-05T23:41:00\.000Z" title="20:41">há 2 minutos<\/time>/);
  // O texto 14/20 com o autor antes, para o leitor de tela.
  assert.match(marina, /<p class="whitespace-pre-wrap text-sm leading-5 text-room-fg \[overflow-wrap:anywhere\]"><span class="sr-only">Marina R\., Equipe, há 2 minutos: <\/span>texto 2<\/p>/);
  assert.match(chatItem(html, "1"), /<span class="sr-only">Bia C\., há 1 minuto: <\/span>texto 1/, "sem papel, so o nome e o tempo");
  assert.doesNotMatch(marina, /@Marina/, "o nome sem @");

  // A minha: a esquerda como as outras (sem inverter), com Você, o avatar com as minhas iniciais e o data-mine; a
  // pendente diz "Aguardando a equipe" na linha de acoes.
  const minha = chatItem(html, "5");
  assert.match(minha, /^<li class="flex mb-4 first:mt-auto" data-mine="" data-room-message="5">/);
  assert.equal(chatMeta(minha), "Você agora");
  assert.match(minha, /<span class="sr-only">Você, agora: <\/span>texto 5/);
  assert.match(minha, /<span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span class="[^"]*">AS<\/span><\/span>/);
  assert.doesNotMatch(minha, /Ana S\./, "o meu nome de exibicao nao aparece escrito na minha mensagem");
  assert.match(minha, /<div class="-ml-2 mt-1 flex min-h-8 items-center"><span class="ml-2 text-xs leading-\[18px\] text-room-warn-fg">Aguardando a equipe<\/span><\/div>/);
  assert.doesNotMatch(html, /flex-row-reverse/);
  assert.equal((html.match(/data-mine=""/g) ?? []).length, 1, "so a minha");
  // Sem acoes, sem a linha de acoes.
  assert.doesNotMatch(marina, /min-h-8/);
  // Nada do balao do Zoom no desenho normal.
  assert.doesNotMatch(html, /bg-room-surface-2|bg-room-bubble-mine-bg|text-room-meta-name/);

  // Na live o zero nao entra: o "Comecar para todos" e a ancora mudam o zero sem recalcular o que ja esta na tela.
  const zeroMudou = render(chat.RoomChatPanel, { ...base, zeroMs: T0 + 7 * MIN });
  assert.equal(chatMeta(chatItem(zeroMudou, "2")), "Marina R. Equipe há 2 minutos", "o zero novo nao desloca o tempo");
  const semHoraGravada = render(chat.RoomChatPanel, { ...base, messages: [msg("2", { displayName: "Marina R.", offsetMs: 41 * MIN, role: "team", sentAt: null })], zeroMs: T0 });
  assert.equal(chatMeta(chatItem(semHoraGravada, "2")), "Marina R. Equipe", "sem a hora gravada, sem tempo (nunca a conta pelo zero)");
  assert.doesNotMatch(chatItem(semHoraGravada, "2"), /<time/);

  // Na gravada, a hora marcada mais o offset; no Replay, nenhum tempo (nem para o leitor de tela).
  const gravada = render(chat.RoomChatPanel, { ...base, messages: base.messages.map((message) => ({ ...message, sentAt: null })), timeKind: "simulated", zeroMs: T0 });
  assert.equal(chatMeta(chatItem(gravada, "2")), "Marina R. Equipe há 2 minutos");
  assert.match(chatItem(gravada, "2"), /dateTime="2026-11-05T23:41:00\.000Z" title="20:41"/);
  const replay = render(chat.RoomChatPanel, { ...base, phase: "replay", timeKind: "replay", zeroMs: T0 });
  assert.equal(chatMeta(chatItem(replay, "2")), "Marina R. Equipe");
  assert.doesNotMatch(replay, /<time/);
  assert.match(chatItem(replay, "2"), /<span class="sr-only">Marina R\., Equipe: <\/span>texto 2/);

  // O "@assistente" do texto em peso 600, sem azul.
  const mencao = render(chat.RoomChatPanel, { ...base, messages: [naLive("m", 42 * MIN, { body: "@assistente o certificado sai quando?", displayName: "Bia C." })] });
  assert.match(chatItem(mencao, "m"), /<\/span><span class="font-semibold">@assistente<\/span> o certificado sai quando\?<\/p>/);

  // A gaveta do vertical (look classic) continua com o balao de antes.
  const classico = render(chat.RoomChatPanel, { ...base, look: "classic" });
  assert.match(chatItem(classico, "2"), /^<li class="flex items-end gap-2" data-room-message="2">/);
  assert.match(classico, /bg-room-surface-2/);
});

test("o balao da sala (RoomChatBubble) sem as props do console (a origem, as acoes, o rotulo da pendente e a largura) da o HTML de antes, letra por letra", () => {
  // O HTML de antes das props do console (docs/31 V2-15, a fase 2): a outra, a minha pendente e a sem hora com o rodape.
  const antes = {
    outra: `<li class="flex items-end gap-2" data-room-message="1"><span aria-hidden="true" class="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white ring-1 ring-white/10 size-7 bg-rose-800"><span class="text-[11px]">MR</span></span><div class="flex min-w-0 max-w-[270px] flex-col gap-1 lg:max-w-[230px] items-start"><p class="max-w-full whitespace-pre-line break-words rounded-[12px] px-3 py-2 text-[13px] leading-[18px] rounded-bl-[4px] bg-room-surface-2 text-room-bubble-other-fg"><span class="sr-only">Marina R., Equipe, 20:41: </span>texto 1</p><p class="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-room-fg-subtle pl-1" data-room-message-meta=""><span aria-hidden="true" class="inline-flex flex-wrap items-center gap-1.5"><span class="font-semibold text-room-meta-name">Marina R.</span><span>·</span><span>Equipe</span><span>·</span><span>20:41</span></span></p></div></li>`,
    minhaPendente: `<li class="flex items-end gap-2 flex-row-reverse" data-mine="" data-room-message="2"><span aria-hidden="true" class="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white ring-1 ring-white/10 size-7 bg-emerald-700"><span class="text-[11px]">AS</span></span><div class="flex min-w-0 max-w-[270px] flex-col gap-1 lg:max-w-[230px] items-end"><p class="max-w-full whitespace-pre-line break-words rounded-[12px] px-3 py-2 text-[13px] leading-[18px] rounded-br-[4px] bg-room-bubble-mine-bg text-room-bubble-mine-fg"><span class="sr-only">Você, 20:43: </span>texto 2</p><p class="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-room-fg-subtle justify-end pr-1" data-room-message-meta=""><span aria-hidden="true" class="inline-flex flex-wrap items-center gap-1.5"><span class="font-semibold text-room-meta-name">Você</span><span>·</span><span>20:43</span></span><span aria-hidden="true">·</span><span class="font-semibold text-room-warn-fg">Aguardando a equipe</span></p></div></li>`,
    semHora: `<li class="flex items-end gap-2" data-room-message="3"><span aria-hidden="true" class="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white ring-1 ring-white/10 size-7 bg-emerald-700"><span class="text-[11px]">AS</span></span><div class="flex min-w-0 max-w-[270px] flex-col gap-1 lg:max-w-[230px] items-start"><p class="max-w-full whitespace-pre-line break-words rounded-[12px] px-3 py-2 text-[13px] leading-[18px] rounded-bl-[4px] bg-room-surface-2 text-room-bubble-other-fg"><span class="sr-only">Ana S.: </span>texto 3</p><p class="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-room-fg-subtle pl-1" data-room-message-meta=""><span aria-hidden="true" class="inline-flex flex-wrap items-center gap-1.5"><span class="font-semibold text-room-meta-name">Ana S.</span></span></p><p>rodape</p></div></li>`
  };
  assert.equal(render(chat.RoomChatBubble, { message: msg("1", { displayName: "Marina R.", role: "team" }), time: "20:41" }), antes.outra);
  assert.equal(render(chat.RoomChatBubble, { message: msg("2", { mine: true, pending: true }), time: "20:43" }), antes.minhaPendente);
  assert.equal(render(chat.RoomChatBubble, { footer: createElement("p", null, "rodape"), message: msg("3"), time: "" }), antes.semHora);
});

test("chat: a fixada saiu do chat (a area das fixadas do painel, Na tela), a lista em role=log com o chat curto embaixo; o ⋮ no cabecalho do painel a partir de lg (o ⋯ da linha do campo so abaixo de lg); compositor desligado, so a equipe, modo lento e encerrada", () => {
  const base = {
    chatMode: "open",
    consented: true,
    displayName: "Ana S.",
    error: null,
    messages: [msg("1", { displayName: "Bia C." }), msg("2", { displayName: "Equipe", role: "team" }), msg("5", { mine: true, pending: true })],
    nowMs: T0,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: msg("p", { displayName: "Equipe", pinned: true, role: "team", body: "link da apostila" }),
    readOnly: false,
    slowUntilMs: null,
    timeKind: "live",
    zeroMs: T0
  };
  const html = render(chat.RoomChatPanel, base);
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="off"/, "em lista cheia o leitor de tela ouve so a contagem");
  // A fixada saiu do chat (Na tela, especificacao de 10/11/2026, §3.1): ela e a area das fixadas do proprio painel, em
  // toda aba (screen/room-pinned.tsx; o desenho dela em tests/webinarios-na-tela-tela.test.mjs). A fixada que a sala de
  // antes ainda mandasse para o chat nao aparece aqui: o chat comeca pela lista.
  assert.doesNotMatch(html, /data-testid="room-pinned"|Fixada pela equipe|link da apostila/);
  assert.match(html, /^<div class="flex min-h-0 flex-1 flex-col" data-testid="room-chat"><ol /, "a lista e o primeiro filho do chat");
  // Sai a linha do rotulo "Chat" (repetia o nome da aba): o nome fica so na lista.
  assert.doesNotMatch(html, />Chat</);
  assert.match(html, /<ol aria-label="Chat"/);
  // A lista que rola: comeca em cima, e o chat curto fica embaixo pelo margin-top auto do primeiro item (nunca
  // justify-content: flex-end, que deixaria as antigas fora do alcance).
  const lista = html.match(/<ol aria-label="Chat" aria-live="off" aria-relevant="additions" class="([^"]*)" role="log">/);
  assert.ok(lista, "o log");
  assert.deepEqual(temTodasAs(lista[1], ["flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "overscroll-contain", "px-4", "pt-4", "[scrollbar-gutter:stable]", "[scrollbar-width:thin]"]), []);
  assert.doesNotMatch(lista[1], /justify-end/);
  assert.match(html, /role="log"><li class="flex mb-4 first:mt-auto" data-room-message="1">/);

  // O campo "Adicione um comentário" do YouTube (RoomCommentField, Y11): o ⋯ so abaixo de lg, antes do avatar (a partir
  // de lg ele e o ⋮ do cabecalho do painel), o avatar com as minhas iniciais e o textarea sem caixa (16 px abaixo de lg).
  // Fechado, nada de Cancelar nem de Enviar (eles so aparecem com o campo aberto, pelo foco).
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  assert.match(form, /^<form class="[^"]*\bborder-room-panel-border\b[^"]*"><div class="mr-4 flex items-start"><div class="mr-3 shrink-0 lg:hidden"><div class="relative shrink-0"><button aria-label="Mais opções"[^>]*aria-haspopup="menu">[\s\S]*?<\/div><\/div><span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span[^>]*>AS<\/span><\/span>/, "o menu so abaixo de lg, antes do avatar com as iniciais");
  assert.equal((html.match(/aria-label="Mais opções"/g) ?? []).length, 1, "um menu so no chat");
  assert.doesNotMatch(html.slice(0, html.indexOf("<form")), /Mais opções/, "nada de menu acima da lista");
  assert.match(form, /<textarea aria-label="Escreva uma mensagem" class="[^"]*\btext-base\b[^"]*\blg:text-sm\b[^"]*"/);
  assert.doesNotMatch(form, /lg:text-\[13px\]|rounded-\[12px\]|bg-room-input-bg/, "o campo sem caixa");
  assert.match(form, new RegExp(`maxlength="${CHAT_LIMITS.body}"`, "i"));
  assert.doesNotMatch(form, /type="submit"|>Enviar<|>Cancelar</, "fechado, sem o envio e sem o Cancelar");
  assert.doesNotMatch(form, /SendHorizontal|lucide-send/);

  // Com a frase no lugar do campo (silenciado, sala que nao abriu), a frase e, abaixo de lg, o menu (o celular como
  // hoje); a faixa tem a folga do iPhone do campo.
  const comFrase = render(chat.RoomChatPanel, { ...base, notice: "Você está sem escrever no chat até 20:15." });
  assert.doesNotMatch(comFrase, /<textarea/);
  const frase = comFrase.match(/<div class="([^"]*)"><div class="mr-3 shrink-0 lg:hidden"><div class="relative shrink-0"><button aria-label="Mais opções"[\s\S]*?<p class="([^"]*)" data-testid="room-chat-notice" role="status">Você está sem escrever no chat até 20:15\.<\/p>/);
  assert.ok(frase, "a frase com o menu so abaixo de lg");
  assert.deepEqual(temTodasAs(frase[1], ["border-t", "border-room-panel-border", "p-4", "max-lg:pb-[max(16px,calc(env(safe-area-inset-bottom)+8px))]"]), []);
  assert.deepEqual(temTodasAs(frase[2], ["text-sm", "leading-5", "text-room-warn-fg"]), []);
  assert.doesNotMatch(frase[2], /font-semibold/);

  // A confirmacao de remover continua no chat, aberta pela sala (o ⋮ do cabecalho).
  assert.doesNotMatch(html, /role="alertdialog"/);
  assert.ok(render(chat.RoomChatPanel, { ...base, removeOpen: true }).includes(`role="alertdialog" aria-label="${WEBINAR_COPY.privacidade.confirmar}"`), "aberta pela sala");

  // O ⋮ "Mais opções" do cabecalho: o circulo sem fundo e sem title com o EllipsisVertical, e o menu fechado abaixo e a
  // direita com "Remover minhas mensagens"; no "ver como", a opcao desligada.
  const mais = render(chat.RoomChatMoreButton, { onRemove: noop });
  const botaoMais = mais.match(/<button\b[^>]*>/)?.[0] ?? "";
  assert.match(botaoMais, /aria-label="Mais opções"/);
  assert.match(botaoMais, /aria-haspopup="menu"/);
  assert.match(botaoMais, /aria-expanded="false"/);
  assert.match(botaoMais, /aria-controls="room-chat-more"/);
  assert.doesNotMatch(botaoMais, /\stitle=/);
  assert.deepEqual(temTodasAs(/class="([^"]*)"/.exec(botaoMais)?.[1] ?? "", ["bg-transparent", "size-10", "[&_svg]:size-6"]), []);
  assert.match(mais, /lucide-ellipsis-vertical/);
  assert.match(mais, /<div aria-label="Mais opções" class="[^"]*\btop-full\b[^"]*\bright-0\b[^"]*" hidden="" id="room-chat-more" role="menu"><button class="[^"]*" role="menuitem" tabindex="-1" type="button"><span class="flex-1">Remover minhas mensagens<\/span><\/button><\/div>/);
  assert.match(render(chat.RoomChatMoreButton, { onRemove: noop, readOnly: true }), /aria-disabled="true"[^>]*role="menuitem"|role="menuitem"[^>]*aria-disabled="true"/);

  const off = render(chat.RoomChatPanel, { ...base, chatMode: "off" });
  assert.match(off, /O chat está desligado nesta sessão\./);
  assert.match(off, /<textarea[^>]+disabled/);
  const teamOnly = render(chat.RoomChatPanel, { ...base, chatMode: "team_only" });
  assert.match(teamOnly, /Só a equipe escreve agora\./);
  const slow = render(chat.RoomChatPanel, { ...base, slowUntilMs: T0 + 12_000 });
  assert.match(slow, /Você pode enviar de novo em 12 s/);
  const ended = render(chat.RoomChatPanel, { ...base, phase: "ended" });
  assert.match(ended, /Essa live acabou\./);
  const readOnly = render(chat.RoomChatPanel, { ...base, readOnly: true });
  assert.match(readOnly, /No modo de visualização, nada é gravado\./);
  const empty = render(chat.RoomChatPanel, { ...base, messages: [], pinned: null });
  assert.match(empty, /Ainda não há mensagens\./);
  assert.match(empty, /aria-live="polite"/, "com uma mensagem por vez, cada uma e lida");
});

test("o aceite (§8.5 e D64): o texto palavra por palavra, Entendi e quero participar e Cancelar; sem radio, sem campo de apelido e sem anonimo", () => {
  const html = render(chat.RoomConsentBox, { onAccept: noop, onCancel: noop });
  assert.ok(html.includes(WEBINAR_COPY.sala.consentimento));
  assert.match(html, /Entendi e quero participar/);
  assert.match(html, /role="group"/);
  // D64 (10/11/2026): ninguem participa como anonimo nem com apelido. Nao ha escolha de como aparecer.
  assert.doesNotMatch(html, /an[oô]nim/i, "nenhum botao nem frase de anonimo");
  assert.doesNotMatch(html, /Apelido|apelido|Como você aparece|Primeiro nome e inicial/);
  assert.doesNotMatch(html, /<input|<fieldset|<legend|type="radio"|type="text"|<textarea/, "sem radio e sem campo de texto");
  assert.equal((html.match(/<button/g) ?? []).length, 2, "dois botoes: aceitar e cancelar");
  // Na sala (o cartao, Y11): o raio 12 no tom do controle e as pilulas M branca e de texto.
  const cartao = html.match(/^<div class="([^"]*)" data-testid="room-consent" role="group"/);
  assert.ok(cartao, "o cartao do aceite");
  assert.deepEqual(temTodasAs(cartao[1], ["rounded-[12px]", "bg-room-control", "p-4"]), []);
  const pilula = (nome) => html.match(new RegExp(`<button class="([^"]*)" type="button">${nome}</button>`))?.[1] ?? "";
  assert.deepEqual(temTodasAs(pilula("Entendi e quero participar"), ["h-10", "rounded-full", "bg-room-active-bg", "text-room-active-fg"]), []);
  assert.deepEqual(temTodasAs(pilula("Cancelar"), ["h-10", "rounded-full", "bg-transparent", "text-room-fg"]), []);
  // Na gaveta do vertical (classic), a faixa e os botoes de antes.
  const classico = render(chat.RoomConsentBox, { onAccept: noop, onCancel: noop, variant: "classic" });
  assert.match(classico, /^<div class="border-t border-room-border bg-room-pinned px-3 py-3" data-testid="room-consent" role="group"/);
  assert.doesNotMatch(classico, /rounded-full|rounded-\[12px\]/, "sem o cartao e sem as pilulas");
  assert.equal((classico.match(/rounded-\[var\(--member-button-radius\)\]/g) ?? []).length, 2, "os dois botoes de antes: aceitar e cancelar");
  assert.equal((classico.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(classico, /an[oô]nim|Apelido|<input|type="radio"/i);
  assert.equal(classico.replace(/<div class="[^"]*" data-testid="room-consent"/, "").replace(/<div class="mt-3 flex flex-wrap gap-2">[\s\S]*$/, ""), html.replace(/<div class="[^"]*" data-testid="room-consent"/, "").replace(/<div class="mt-3 flex flex-wrap gap-2">[\s\S]*$/, ""), "o texto igual nos dois");
  assert.equal(
    WEBINAR_COPY.sala.consentimento,
    "Ao enviar mensagens neste chat, você autoriza que o seu primeiro nome com a inicial do sobrenome, a sua foto de perfil e o texto da mensagem apareçam para os outros alunos durante esta sessão e nas reexibições dela. Você pode remover as suas mensagens a qualquer momento em Perfil › Privacidade."
  );
  // As frases que so serviam a escolha sairam do arquivo de frases; o texto da Privacidade nao fala mais de apelido.
  for (const chave of ["participarComoAnonimo", "responderComo", "apelidoPlaceholder", "comoAparece"]) {
    assert.ok(!(chave in WEBINAR_COPY.sala), `WEBINAR_COPY.sala.${chave} saiu`);
  }
  assert.doesNotMatch(WEBINAR_COPY.privacidade.texto, /apelido/i);
  assert.match(WEBINAR_COPY.privacidade.texto, /com o seu primeiro nome e a inicial do sobrenome\.$/);
});

test("reacoes: seis botoes de 44 px com nome acessivel, as bolhas nunca anunciadas, o contador do excesso", () => {
  const bar = render(reactions.RoomReactionBar, { disabled: false, onReact: noop });
  for (const reaction of REACTIONS) {
    assert.match(bar, new RegExp(`aria-label="${WEBINAR_COPY.sala.reacoes[reaction]}"`), reaction);
  }
  assert.equal((bar.match(/size-11/g) ?? []).length, 6, "44 px cada");
  assert.match(bar, /role="group"/);
  const bubbles = render(reactions.RoomReactionBubbles, { bubbles: [{ id: 1, reaction: "fire", until: T0 }], overflow: 5 });
  assert.match(bubbles, /aria-hidden="true"/);
  assert.match(bubbles, /motion-reduce:opacity-80/, "com prefers-reduced-motion a reacao fica parada");
  assert.match(bubbles, /\+5/);
});

test("a barra da gravada e do Replay (V2-6): Reagir abre as seis reacoes num painel (room-reactions); o Som so na gravada; a Tela cheia so com o navegador que deixa; o balao diz o que faz", () => {
  const props = {
    fullscreenEnabled: true,
    fullscreenOn: false,
    kind: "simulated",
    onFullscreen: noop,
    onLeave: noop,
    onReact: noop,
    onSound: noop,
    onTogglePanel: noop,
    onToggleReactions: noop,
    panelOpen: true,
    reactionsDisabled: false,
    reactionsOpen: false,
    soundDisabled: false,
    soundOn: false
  };
  const barra = (extra = {}) => render(recorded.RecordedControls, { ...props, ...extra });
  const nomes = (html) => buttonNames(html);
  assert.deepEqual(nomes(barra()), ["Sair", "Reagir", "Som", "Tela cheia", "Esconder o chat"]);
  assert.deepEqual(nomes(barra({ kind: "replay" })), ["Sair", "Reagir", "Tela cheia", "Esconder o chat"], "o Replay tem a barra da Bunny para o som");
  assert.deepEqual(nomes(barra({ fullscreenEnabled: false, kind: "replay" })), ["Sair", "Reagir", "Esconder o chat"], "sem tela cheia no navegador, sem o botao");
  assert.match(barra({ panelOpen: false }), /<button aria-controls="room-panel" aria-expanded="false" aria-label="Mostrar o chat"/);
  assert.match(barra({ soundOn: true }), /<button aria-label="Som" aria-pressed="true"/);
  // Fechado, as reacoes nao estao na tela; aberto, as seis, com o nome de cada uma e 44 px.
  assert.doesNotMatch(barra(), /id="room-reactions"|aria-label="Curtir"/);
  const aberta = barra({ reactionsOpen: true });
  assert.match(aberta, /<button aria-controls="room-reactions" aria-expanded="true" aria-label="Reagir"/);
  const painel = aberta.slice(aberta.indexOf('id="room-reactions"'), aberta.indexOf('data-room-bar=""'));
  for (const reaction of REACTIONS) {
    assert.match(painel, new RegExp(`aria-label="${WEBINAR_COPY.sala.reacoes[reaction]}"`), reaction);
  }
  assert.ok(aberta.indexOf('id="room-reactions"') < aberta.indexOf('data-room-bar=""'), "acima da barra no celular (e por cima do palco no computador)");
  assert.match(barra({ reactionsDisabled: true, reactionsOpen: true }), /aria-label="Curtir"[^>]*disabled=""/, "no ver como e antes do zero, desligadas");
});

test("o Sair do cabecalho em pilula S vermelha (32 px, o toque de 44 abaixo de lg) com o rotulo; com a barra na tela (leaveInBar), so abaixo de lg; sem a barra, em toda largura", () => {
  const sair = (html) => html.match(/<button class="([^"]*)" type="button"><svg[^>]*lucide-log-out[^>]*>[\s\S]*?<\/svg>Sair<\/button>/)?.[1].split(" ") ?? [];
  const comBarra = sair(render(header.RoomHeader, { ...HEADER, leaveInBar: true }));
  for (const classe of ["bg-room-accent", "text-white", "hover:bg-room-accent-hover", "h-8", "rounded-full", "text-xs", "after:-inset-1.5", "lg:after:hidden", "lg:hidden"]) {
    assert.ok(comBarra.includes(classe), `${classe} no Sair: ${comBarra.join(" ")}`);
  }
  const semBarra = sair(render(header.RoomHeader, HEADER));
  assert.ok(semBarra.length > 0 && semBarra.includes("bg-room-accent") && semBarra.includes("h-8"), "sem a barra, a mesma pilula");
  assert.ok(!semBarra.includes("lg:hidden"), "o padrao: sem a barra, em toda largura");
  assert.doesNotMatch(render(header.RoomHeader, HEADER), /title="Sair"|aria-label="Sair"/, "o nome e o proprio rotulo, sem title");
});

function payload(extra = {}, sessionExtra = {}) {
  return {
    me: { calendarUrl: null, consented: false, displayName: null, registered: false, registeredAt: null },
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

test("a sala inteira: dialogo aria-modal com o titulo, as abas Chat, Perguntas e Participantes (Enquetes so com enquete aberta; o Replay sem Participantes), no ar / espera / encerrada pelo relogio do servidor, 375 px", () => {
  const live = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  assert.match(live, /role="dialog"/);
  assert.match(live, /aria-modal="true"/);
  assert.match(live, /aria-label="Aula de IA"/);
  assert.match(live, /data-room-phase="live"/);
  assert.match(live, /role="tablist"/);
  assert.match(live, /role="tab"[^>]*>Chat</);
  assert.match(live, /role="tab"[^>]*>Perguntas</);
  assert.match(live, /role="tab"[^>]*>Participantes</, "a gravada tem Participantes, como a live (V2-7)");
  assert.doesNotMatch(live, />Enquetes</, "sem enquete aberta, sem a aba");
  assert.match(live, /2 assistindo/);
  assert.match(live, /Ao vivo/);
  assert.match(live, /<iframe[^>]+mediadelivery/);
  assert.match(live, /Ativar som/);
  assert.match(live, /fixed inset-0 flex flex-col/, "tela cheia por cima da area");
  // O painel a direita no computador com a largura da grade do YouTube (de 320 a 514 px) e o trilho "Painel da sala"
  // depois dele; abaixo de lg, as abas em pilula na lista "Painel da sala", na linha que some a partir de lg. O mesmo
  // nome em dois papeis, cada um so numa largura.
  const aside = live.match(/<aside aria-labelledby="room-panel-title" class="([^"]*)" data-testid="room-panel" id="room-panel">/)?.[1].split(" ") ?? [];
  assert.ok(aside.includes("lg:w-[clamp(320px,27.5vw,514px)]") && aside.includes("lg:flex-none") && !aside.includes("lg:w-80"), aside.join(" "));
  assert.match(live, /<div class="[^"]*\blg:hidden"><div aria-label="Painel da sala" class="[^"]*" role="tablist">/);
  assert.match(live, /<\/aside><nav aria-label="Painel da sala" class="[^"]*\blg:flex\b[^"]*">/);
  assert.equal((live.match(/aria-label="Painel da sala"/g) ?? []).length, 2, "na nav e no tablist");
  assert.deepEqual([...live.matchAll(/data-room-rail="([a-z]+)"/g)].map(([, aba]) => aba), ["chat", "perguntas", "participantes"], "a gravada tem Participantes no trilho");
  assert.match(live, /aspect-video w-full/, "o palco na largura a 375 px");
  assert.match(live, /data-testid="room-panel"/);
  assert.doesNotMatch(live, /room-pill|data-room-minimized|Minimizar/, "sem Minimizar e sem pilula (docs/31 V2-2)");

  const waiting = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() }), readOnly: false, webinarHref: "/x" });
  assert.match(waiting, /data-room-phase="waiting"/);
  assert.match(waiting, /Começa em 4 min/);
  assert.doesNotMatch(waiting, /<iframe/);

  const ended = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { roomPhase: "ended", status: "ended" }), readOnly: false, webinarHref: "/x" });
  assert.match(ended, /data-room-phase="ended"/);
  assert.match(ended, /Essa live acabou\./);
  assert.match(ended, /href="\/webinarios\/aula-de-ia\/sala\?sessao=cccccccc-0000-4000-8000-000000000004"/, "Assistir de novo abre o replay");

  const withPoll = render(room.WebinarRoom, {
    coverUrl: null,
    payload: payload({ polls: [{ id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }),
    readOnly: false,
    webinarHref: "/x"
  });
  assert.match(withPoll, />Enquetes</);
  // A enquete aberta sem resposta abre no meio do palco (V2-10) so depois da hidratacao: ela depende do que esta
  // guardado no navegador (o "depois"), e o HTML do servidor sai sem ela e sem o card do chat, com a regiao viva vazia
  // na caixa do palco (useRoomHydrated; o e2e confere a camada). Sem isso, a deixada para depois piscava a cada carga.
  const caixaDoPalco = withPoll.slice(withPoll.indexOf('data-room-slot="stage-box"'), withPoll.indexOf('data-testid="room-panel"'));
  assert.match(caixaDoPalco, /<p aria-live="polite" class="sr-only" data-room-poll-said=""><\/p>/);
  assert.doesNotMatch(withPoll, /data-room-stage-poll|data-room-poll-layer/, "nenhuma enquete no palco no HTML do servidor");
  assert.doesNotMatch(withPoll, /Responder agora|data-room-poll-later/, "nem o card do chat");
  // So uma enquete encerrada com o resultado: sem a aba (o resultado aparece no palco, V2-10).
  const encerrada = render(room.WebinarRoom, {
    coverUrl: null,
    payload: payload({ polls: [{ id: "p1", kind: "single", myOptionIds: ["o1"], options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: { counts: { o1: 3 }, total: 3 }, status: "closed" }] }),
    readOnly: false,
    webinarHref: "/x"
  });
  assert.doesNotMatch(encerrada, /role="tab"[^>]*>Enquetes</, "a enquete encerrada nao abre a aba no desenho normal");

  const replay = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { kind: "replay", offsetMs: null, roomPhase: null }), readOnly: false, webinarHref: "/x" });
  assert.match(replay, /data-room-phase="replay"/);
  assert.match(replay, /role="tab"[^>]*>Chat da live</);
  assert.match(replay, /role="tab"[^>]*>Perguntas</);
  assert.doesNotMatch(replay, /role="tab"[^>]*>Participantes</, "no Replay ninguem esta presente: sem Participantes");
  assert.deepEqual([...replay.matchAll(/data-room-rail="([a-z]+)"/g)].map(([, aba]) => aba), ["chat", "perguntas"]);
  assert.match(replay, /id="room-panel-title">Chat da live<\/h2>/, "no titulo do painel, Chat da live; no trilho, Chat");
  assert.doesNotMatch(replay, /Ativar som/, "o replay tem a barra do player");

  const preview = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: true, webinarHref: "/x" });
  assert.match(preview, /No modo de visualização, nada é gravado\./);
});

/** Uma enquete do aluno (aberta, resposta unica, com duas opcoes). */
const enquete = (extra = {}) => ({ id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }, { id: "o2", label: "Ainda não" }], question: "Gostou?", results: null, status: "open", ...extra });
const camada = (props) => render(pollLayer.RoomPollLayer, { onAnswer: async () => undefined, onLater: noop, onSeen: noop, readOnly: false, ...props });

test("a enquete no meio do palco (V2-10): o rotulo pelo tipo, a pergunta em h2, opcoes de 48 px, Responder depois e Enviar resposta; um dialogo sem aria-modal que nao pega o foco e se anuncia", () => {
  const html = camada({ stage: { mode: "answer", poll: enquete() } });
  // A regiao viva fica antes e sempre montada: ela diz "Enquete aberta: {pergunta}" quando a enquete abre sozinha (com a
  // pergunta, a segunda enquete que entra no lugar da primeira muda o texto e tambem e anunciada).
  assert.match(html, /^<p aria-live="polite" class="sr-only" data-room-poll-said="">Enquete aberta: Gostou\?<\/p>/);
  assert.match(camada({ stage: { mode: "answer", poll: enquete({ id: "p2", question: "E agora?" }) } }), /data-room-poll-said="">Enquete aberta: E agora\?<\/p>/);
  // O veu so sobre o palco a partir de lg (45 %); abaixo de lg, a folha presa embaixo da tela.
  const veu = (html.match(/<div class="([^"]*)" data-room-poll-layer="answer">/)?.[1] ?? "").split(" ");
  for (const classe of ["z-30", "lg:absolute", "lg:inset-0", "lg:bg-black/45", "max-lg:fixed", "max-lg:inset-x-0", "max-lg:bottom-0"]) {
    assert.ok(veu.includes(classe), `${classe} em ${veu.join(" ")}`);
  }
  const dialogo = html.match(/<div aria-labelledby="([^"]+)" class="([^"]*)" data-room-stage-poll="answer" role="dialog">/);
  assert.ok(dialogo, "role=dialog com o nome da pergunta");
  assert.doesNotMatch(html, /aria-modal/, "o resto da sala continua valendo");
  const caixa = dialogo[2].split(" ");
  for (const classe of ["lg:w-[440px]", "p-6", "bg-room-surface", "text-room-fg", "lg:rounded-[var(--member-cover-radius)]", "shadow-[0_24px_64px_rgba(0,0,0,0.35)]"]) {
    assert.ok(caixa.includes(classe), `${classe} em ${caixa.join(" ")}`);
  }
  assert.match(html, new RegExp(`<p class="[^"]*">Enquete · resposta única</p><h2 class="[^"]*text-lg font-extrabold[^"]*" id="${dialogo[1]}">Gostou\\?</h2>`));
  // As opcoes: label com 48 px de altura (minimo), cantos de 12 px e a borda do campo; o radio pelo tipo, nada marcado.
  const opcoes = [...html.matchAll(/<label class="([^"]*)"><input class="[^"]*" type="radio" name="[^"]+" value="(o\d)"\/><span class="[^"]*">([^<]+)<\/span><\/label>/g)];
  assert.deepEqual(opcoes.map(([, , value, label]) => [value, label]), [["o1", "Sim"], ["o2", "Ainda não"]]);
  for (const [, classes] of opcoes) {
    const lista = classes.split(" ");
    assert.ok(lista.includes("min-h-12") && lista.includes("rounded-[12px]") && lista.includes("border-room-input-border"), classes);
  }
  // Responder depois (fantasma) e Enviar resposta (cheio, desligado ate marcar), os dois com 44 px.
  const depois = html.match(/<button class="([^"]*)" type="button">Responder depois<\/button>/)?.[1].split(" ") ?? [];
  assert.ok(depois.includes("h-11") && depois.includes("text-room-icon"), depois.join(" "));
  const enviar = html.match(/<button class="([^"]*)" type="button" disabled="">Enviar resposta<\/button>/)?.[1].split(" ") ?? [];
  assert.ok(enviar.includes("h-11") && enviar.includes("bg-room-active-bg"), enviar.join(" "));
  assert.doesNotMatch(html, /Responder agora/);

  // Multipla: caixas de marcar e o rotulo dela. No "ver como", as opcoes desligadas (Responder depois continua).
  assert.match(camada({ stage: { mode: "answer", poll: enquete({ kind: "multiple" }) } }), /Enquete · resposta múltipla<\/p>[\s\S]*?type="checkbox"/);
  const verComo = camada({ readOnly: true, stage: { mode: "answer", poll: enquete() } });
  assert.equal((verComo.match(/<input [^>]*disabled=""/g) ?? []).length, 2);
  assert.match(verComo, /type="button">Responder depois<\/button>/);
});

test("o resultado compartilhado no mesmo lugar (V2-10): as barras com a porcentagem, o total de respostas e Fechar; sem enquete, so a regiao viva vazia", () => {
  const html = camada({ stage: { mode: "result", poll: enquete({ myOptionIds: ["o1"], results: { counts: { o1: 3, o2: 1 }, total: 4 }, status: "closed" }) } });
  assert.match(html, /data-room-poll-said="">Enquete · resultado: Gostou\?<\/p>/);
  assert.match(html, /data-room-stage-poll="result" role="dialog"><p [^>]*>Enquete · resultado<\/p><h2 [^>]*>Gostou\?<\/h2>/);
  const barras = [...html.matchAll(/<li class="[^"]*"><span aria-hidden="true" class="absolute inset-y-0 left-0 bg-room-poll-bar" style="width:(\d+)%"><\/span><span class="[^"]*">([^<]+)<\/span><span class="[^"]*">(\d+)%<\/span><\/li>/g)];
  assert.deepEqual(barras.map(([, largura, label, texto]) => [label, largura, texto]), [["Sim", "75", "75"], ["Ainda não", "25", "25"]]);
  assert.match(html, />4 respostas<\/p>/);
  assert.match(html, /<button class="[^"]*\bbg-room-active-bg\b[^"]*" type="button">Fechar<\/button>/);
  assert.doesNotMatch(html, /<input|Enviar resposta|Responder depois/, "no resultado nada se marca");

  // Sem enquete no palco: nada por cima do video, so a regiao viva (montada antes, para anunciar quando abrir).
  assert.equal(camada({ stage: null }), '<p aria-live="polite" class="sr-only" data-room-poll-said=""></p>');
});

test("o card do chat (V2-10): 'Enquete aberta · você deixou para depois', a pergunta e Responder agora; a aba Enquetes controlada pela sala", () => {
  const card = render(pollLayer.RoomPollLaterCard, { onResume: noop, poll: enquete() });
  assert.match(card, /^<section aria-labelledby="([^"]+)" class="([^"]*)" data-room-poll-later="p1"><p class="[^"]*" id="\1">Enquete aberta · você deixou para depois<\/p><p class="[^"]*">Gostou\?<\/p><button class="[^"]*" type="button" data-room-poll-resume="">Responder agora<\/button><\/section>$/);
  const classes = (card.match(/^<section aria-labelledby="[^"]+" class="([^"]*)"/)?.[1] ?? "").split(" ");
  assert.ok(classes.includes("rounded-[var(--member-cover-radius)]") && classes.includes("p-4"), classes.join(" "));
  const agora = (card.match(/<button class="([^"]*)" type="button" data-room-poll-resume="">/)?.[1] ?? "").split(" ");
  assert.ok(agora.includes("h-9") && agora.includes("bg-room-active-bg"), `Responder agora com 36 px, cheio: ${agora.join(" ")}`);

  // A aba desenha as enquetes que a sala passa: a respondida diz "Resposta enviada"; sem nenhuma, a frase.
  const aba = render(pollsTab.RoomPollsTab, { onAnswer: async () => undefined, polls: [enquete({ myOptionIds: ["o2"] })], readOnly: false });
  assert.match(aba, /data-testid="room-polls"/);
  assert.match(aba, /data-room-poll="p1"/);
  assert.match(aba, />Resposta enviada<\/p>/);
  assert.match(aba, />A equipe ainda não compartilhou o resultado\.<\/p>/);
  assert.equal((aba.match(/<input [^>]*disabled=""/g) ?? []).length, 2, "respondida, as opcoes ficam desligadas");
  assert.match(render(pollsTab.RoomPollsTab, { onAnswer: async () => undefined, polls: [], readOnly: false }), /Nenhuma enquete aberta\./);
});

test("a gravada com enquete aberta: no desenho normal ela abre no palco depois da hidratacao; no vertical 9:16 nada muda (o card de antes abre a aba Enquetes da gaveta)", () => {
  const comEnquete = payload({ polls: [enquete()] });
  const normal = render(room.WebinarRoom, { coverUrl: null, payload: comEnquete, readOnly: false, webinarHref: "/x" });
  const caixaDoPalco = normal.slice(normal.indexOf('data-room-slot="stage-box"'), normal.indexOf('data-testid="room-panel"'));
  // No desenho normal a camada fica na caixa do palco (a regiao viva ja esta la), e so entra depois da hidratacao.
  assert.match(caixaDoPalco, /data-room-poll-said=""/);
  assert.doesNotMatch(caixaDoPalco, /data-room-poll-layer/, "o HTML do servidor nao sabe o que ficou para depois");

  const deitado = render(room.WebinarRoom, { coverUrl: null, design: "vertical", payload: comEnquete, readOnly: false, webinarHref: "/x" });
  assert.doesNotMatch(deitado, /data-room-poll-layer|data-room-poll-said|Responder depois/, "o vertical nao tem a enquete no palco");
  // A sessao encerrada (sem a barra) tambem nao abre nada no palco.
  const encerrada = render(room.WebinarRoom, { coverUrl: null, payload: payload({ polls: [enquete()] }, { roomPhase: "ended", status: "ended" }), readOnly: false, webinarHref: "/x" });
  assert.doesNotMatch(encerrada, /data-room-poll-layer/);
});

test("a aba Participantes da gravada (V2-7): quem apresenta e o mesmo numero do cabecalho (o real mais a parte simulada), nunca a lista de alunos", () => {
  // O contador da gravada com a Simulacao ligada: 3 de verdade mais 55 simulados aos 16 s (o cabecalho mostra 58).
  const simulacao = roomSimulationStateOf({ counter: [{ atMs: 0, extra: 40 }, { atMs: 15_000, extra: 55 }], enabled: true, joins: [], saleNotices: [] });
  const shownCount = simulacao.displayCount(3, 16_000);
  assert.equal(shownCount, 58);
  const html = render(notices.LiveParticipantsTab, { presenterKnown: true, stage: layout.panelStageNames("Danilo Souza"), students: shownCount });
  assert.match(html, />No palco</);
  assert.match(html, /Danilo Souza/);
  assert.match(html, /58 alunos na sala/, "o mesmo numero do cabecalho: a sala nao se contradiz");
  assert.equal((html.match(/<li/g) ?? []).length, 1, "so quem apresenta vira lista");
  assert.match(html, /Danilo Souza<\/span><span class="[^"]*\bbg-room-control\b[^"]*">Apresentador<\/span><\/li>/, "a gravada sabe quem apresenta: o selo");
  // Sem o nome de quem apresenta, so o numero.
  const semNome = render(notices.LiveParticipantsTab, { presenterKnown: false, stage: layout.panelStageNames(null), students: shownCount });
  assert.equal((semNome.match(/<li/g) ?? []).length, 0);
  assert.match(semNome, /58 alunos na sala/);
  // A sessao encerrada: o cabecalho tira o numero (verticalBadge, showCount) e a aba tambem, pela mesma condicao.
  const numeroDaAba = (phase) => (vertical.verticalBadge({ kind: "simulated", phase, showLiveBadge: true }).showCount ? shownCount : null);
  assert.match(render(notices.LiveParticipantsTab, { presenterKnown: true, stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("live") }), /58 alunos na sala/);
  assert.match(render(notices.LiveParticipantsTab, { presenterKnown: true, stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("waiting") }), /58 alunos na sala/);
  const encerrada = render(notices.LiveParticipantsTab, { presenterKnown: true, stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("ended") });
  assert.match(encerrada, /Danilo Souza/, "encerrada, quem apresentou continua");
  assert.doesNotMatch(encerrada, /na sala/, "encerrada, sem o ultimo numero recebido (o sinal de presenca ja parou)");
});

test("o desenho normal continua igual (fase 4d): o padrao e a primeira pintura sao o normal; as caixas novas sao contents; o card da Oferta e o aviso de venda no palco", () => {
  const html = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" });
  assert.match(html, /data-room-design="normal"/, "sem o celular em pe (e no servidor), o desenho normal");
  assert.equal(html, render(room.WebinarRoom, { coverUrl: null, design: "normal", payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" }), "o normal forcado e o mesmo");
  // A marca no cabecalho (PR #137) poe os preloads das imagens da marca antes do dialogo.
  // Redesign V2, F2 (V2-11 e V2-12): o fundo e o texto pelos tokens do tema da sala, com o escuro na primeira pintura.
  assert.match(
    html,
    /^(?:<link rel="preload" as="image" href="[^"]+"\/>)*<div aria-label="Aula de IA" aria-modal="true" class="z-\[60\] text-room-fg fixed inset-0 flex flex-col bg-room-bg" data-room-design="normal" data-room-phase="live" data-room-theme="dark" role="dialog"/,
    "o dialogo, no tema escuro"
  );
  // F3 (V2-4): a caixa do palco leva a margem da coluna de miniaturas (0 na gravada) e os selos vem logo depois do palco.
  // F4 (V2-6): o esqueleto e o da live (roomSkeleton): o caminho corpo > coluna > caixa continua, com o palco 16:9.
  const esqueleto = vertical.roomSkeleton("normal", { cinema: false, panelShown: true, stageGrows: false });
  assert.ok(
    html.includes(`<div class="${esqueleto.body}" data-room-slot="body"><div class="${esqueleto.stageColumn}" data-room-slot="stage-column"><div class="${esqueleto.stageBox.replaceAll("&", "&amp;").replaceAll(">", "&gt;")}" data-room-slot="stage-box" style="--room-video-right:0px"><div class="relative bg-black aspect-video w-full max-lg:landscape:aspect-auto max-lg:landscape:h-full lg:aspect-auto lg:h-full"`),
    "o palco 16:9 na largura, no caminho de sempre"
  );
  assert.match(
    html,
    /<div class="contents" data-room-slot="bubbles"><div aria-hidden="true" class="pointer-events-none absolute right-3 [^"]*bottom-14 max-h-\[calc\(100%-3\.5rem\)\]"/,
    "as bolhas no canto do palco, acima da linha dos selos de baixo, sem passar do topo de um palco baixo (375 px)"
  );
  assert.match(html, /<div class="contents" data-room-slot="sales">/);
  assert.match(html, /<div class="contents" data-room-slot="dock"><div class="contents" data-room-slot="offer"><p aria-live="polite" class="sr-only" data-room-offer-announce="">/, "o card da Oferta no canto do palco (layout stage)");
  assert.match(html, /<header class="flex h-14/, "o cabecalho V2 (V2-3)");
  assert.match(html, /data-testid="room-panel"/);
  // F4 (V2-6): a barra da live no lugar da fileira de reacoes: o Sair (a partir de lg), Reagir (as reacoes num painel),
  // o Som da gravada e o balao do chat, embaixo do palco, na mesma coluna.
  assert.doesNotMatch(html, /aria-label="Curtir"/, "as reacoes so abrem pelo Reagir");
  const coluna = html.slice(html.indexOf('data-room-slot="stage-column"'), html.indexOf("<aside"));
  assert.ok(coluna.indexOf('data-room-slot="stage-box"') < coluna.indexOf('data-testid="recorded-controls"'), "a barra embaixo do palco");
  const barra = coluna.slice(coluna.indexOf('data-testid="recorded-controls"'));
  assert.deepEqual([...barra.matchAll(/data-room-bar-item="([a-z]+)"/g)].map(([, item]) => item), ["leave", "react", "sound", "panel"], "sem a Tela cheia no servidor (so com o navegador que deixa)");
  assert.match(barra, /<button aria-controls="room-reactions" aria-expanded="false" aria-label="Reagir"/);
  assert.match(barra, /<button aria-controls="room-panel" aria-expanded="true" aria-label="Esconder o chat" class="[^"]*\blg:hidden\b[^"]*"/, "o balao so abaixo de lg");
  // O Som da gravada: o video comeca mudo (aria-pressed falso); antes do zero, sem player, nao ha o que ligar.
  assert.match(barra, /<button aria-label="Som" aria-pressed="false" class="[^"]*" data-room-bar-item="sound" title="Som" type="button">/);
  const antes = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() }), readOnly: false, webinarHref: "/x" });
  assert.match(antes, /<button aria-label="Som" aria-pressed="false"[^>]*data-room-bar-item="sound" disabled=""/);
  assert.match(barra, /<button class="[^"]*\bhidden\b[^"]*\blg:inline-flex\b[^"]*"[^>]*data-room-bar-item="leave"><svg[\s\S]*?<\/svg>Sair<\/button>/, "o Sair da barra a partir de lg, com o nome visivel em toda largura (a pilula cabe a 1024 px)");
  assert.match(html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "", /\blg:hidden" type="button">[\s\S]*?Sair<\/button>/, "o Sair do cabecalho so abaixo de lg");
  assert.match(html, /<aside aria-labelledby="room-panel-title" class="[^"]*" data-testid="room-panel" id="room-panel">/, "o painel do chat que o balao e o trilho controlam");
  assert.doesNotMatch(html, /data-room-vertical|data-room-drawer|Comente…|Perguntas e enquetes/, "nada do desenho vertical");
});

test("Entrar e Assistir o replay na pagina da live: link para a sala dentro da janela, a frase fora dela, em breve na Live ao vivo sem a sala neste ambiente (liveRoomConfigured falso) e sem replay", () => {
  const session = { id: "s1", kind: "simulated", lateJoinMinutes: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "scheduled" };
  const within = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 5 * MIN, session, slug: "aula-de-ia" });
  assert.match(within, /href="\/webinarios\/aula-de-ia\/sala\?sessao=s1"/);
  assert.match(within, /Entrar/);
  const early = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 - 30 * MIN, session, slug: "aula-de-ia" });
  assert.match(early, /Essa sessão ainda não abriu\./);
  assert.doesNotMatch(early, /href=/);
  const late = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 20 * MIN, session: { ...session, lateJoinMinutes: 10 }, slug: "aula-de-ia" });
  assert.match(late, /já passou da hora de entrar/);
  const over = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + 61 * MIN, session, slug: "aula-de-ia" });
  assert.match(over, /Essa live acabou\./);
  const live = render(enter.WebinarEnterButton, { durationMinutes: 60, serverNow: T0 + MIN, session: { ...session, kind: "live", status: "live" }, slug: "aula-de-ia" });
  assert.match(live, /em breve/, "a sala ao vivo e da fase 3");
  assert.match(live, /disabled/);

  const replay = render(enter.WebinarReplayButton, { replaySessionId: "r1", slug: "aula-de-ia" });
  assert.match(replay, /href="\/webinarios\/aula-de-ia\/sala\?sessao=r1"/);
  assert.match(replay, /Assistir o replay/);
  const none = render(enter.WebinarReplayButton, { replaySessionId: null, slug: "aula-de-ia" });
  assert.match(none, /em breve/);
  assert.match(none, /disabled/);
});

test("Perfil › Privacidade › Chat das lives: o texto e o botao Remover minhas mensagens; na previa da equipe, desligado", () => {
  const html = render(privacy.WebinarChatPrivacy, {});
  assert.match(html, /Chat das lives/);
  assert.ok(html.includes(WEBINAR_COPY.privacidade.texto));
  assert.match(html, /Remover minhas mensagens/);
  assert.doesNotMatch(html, /Remover de todas as lives\?/, "a confirmacao so depois do clique");
  const preview = render(privacy.WebinarChatPrivacy, { readOnly: true });
  assert.match(preview, /<button[^>]+disabled/);
});


/* ------------------------------------------------------------------------------------------------
 * O RoomTabList (docs/31 V2-15): a linha das abas sai do RoomPanel para o console usar, e a sala fica com o mesmo HTML
 * ---------------------------------------------------------------------------------------------- */

// O HTML da linha das abas (o RoomTabList, que o console tambem usa) antes da sala no estilo do YouTube, byte a byte: no
// painel da sala ela so ganhou um envoltorio que a esconde a partir de lg (as abas viram o trilho a direita).
const LINHA_DAS_ABAS_ANTES = {
  live: "<div aria-label=\"Painel da sala\" class=\"flex h-11 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-[calc(var(--member-button-radius)+4px)] border border-room-tabs-border bg-room-tabs p-1 [scrollbar-width:none] lg:h-auto lg:gap-1 [&amp;::-webkit-scrollbar]:hidden\" role=\"tablist\"><button aria-controls=\"room-tab-chat\" aria-selected=\"false\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus font-semibold text-room-fg-muted hover:text-room-fg-strong\" data-room-first-focus=\"\" id=\"room-tabbtn-chat\" role=\"tab\" type=\"button\">Chat</button><button aria-controls=\"room-tab-perguntas\" aria-selected=\"true\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus bg-room-tab-on-bg font-bold text-room-tab-on-fg shadow-[var(--room-tab-on-shadow)]\" id=\"room-tabbtn-perguntas\" role=\"tab\" type=\"button\">Perguntas</button><button aria-controls=\"room-tab-participantes\" aria-selected=\"false\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus font-semibold text-room-fg-muted hover:text-room-fg-strong\" id=\"room-tabbtn-participantes\" role=\"tab\" type=\"button\">Participantes</button><button aria-controls=\"room-tab-enquetes\" aria-selected=\"false\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus font-semibold text-room-fg-muted hover:text-room-fg-strong\" id=\"room-tabbtn-enquetes\" role=\"tab\" type=\"button\">Enquetes<span aria-hidden=\"true\" class=\"ml-1 inline-block size-1.5 rounded-full bg-room-accent align-middle\"></span></button></div>",
  replay: "<div aria-label=\"Painel da sala\" class=\"flex h-11 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-[calc(var(--member-button-radius)+4px)] border border-room-tabs-border bg-room-tabs p-1 [scrollbar-width:none] lg:h-auto lg:gap-1 [&amp;::-webkit-scrollbar]:hidden\" role=\"tablist\"><button aria-controls=\"room-tab-chat\" aria-selected=\"true\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus bg-room-tab-on-bg font-bold text-room-tab-on-fg shadow-[var(--room-tab-on-shadow)]\" id=\"room-tabbtn-chat\" role=\"tab\" type=\"button\">Chat da live</button><button aria-controls=\"room-tab-perguntas\" aria-selected=\"false\" class=\"h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus font-semibold text-room-fg-muted hover:text-room-fg-strong\" id=\"room-tabbtn-perguntas\" role=\"tab\" type=\"button\">Perguntas</button></div>"
};

test("o painel da sala no estilo do YouTube, por partes: a linha das abas de antes (so abaixo de lg), o cabecalho com o h2 e o X so com a barra, e a aba escolhida ligada a aba da linha", () => {
  const live = render(panelModule.RoomPanel, { children: "conteudo", className: "flex", closable: true, contentClassName: "x-y", firstFocus: true, id: "room-panel", kind: "live", onClose: noop, onTab: noop, open: true, pollOpen: true, tab: "perguntas", tabs: ["chat", "perguntas", "participantes", "enquetes"] });
  const replay = render(panelModule.RoomPanel, { children: "c", closable: false, firstFocus: false, id: "room-panel", kind: "replay", onClose: noop, onTab: noop, open: false, pollOpen: false, tab: "chat", tabs: ["chat", "perguntas"] });
  // A linha das abas: o mesmo HTML de antes (as quatro abas com o ponto da enquete e o primeiro foco no Chat), dentro do
  // envoltorio que some a partir de lg e sem o X (que foi para o cabecalho).
  assert.ok(live.includes(`<div class="flex shrink-0 items-center gap-2 px-2 lg:hidden">${LINHA_DAS_ABAS_ANTES.live}</div>`), "a linha da live");
  assert.ok(replay.includes(`<div class="flex shrink-0 items-center gap-2 px-2 lg:hidden">${LINHA_DAS_ABAS_ANTES.replay}</div>`), "a linha do Replay fechado");
  assert.deepEqual(Array.from(live.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas", "Participantes", "Enquetes"]);
  assert.deepEqual(Array.from(replay.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat da live", "Perguntas"]);
  // O aside: o nome pelo h2 do cabecalho, a classe do esqueleto primeiro, fechado hidden e montado.
  assert.match(live, /^<aside aria-labelledby="room-panel-title" class="flex gap-2 [^"]*" data-testid="room-panel" id="room-panel">/);
  assert.match(replay, /^<aside aria-labelledby="room-panel-title" class="gap-2 [^"]*\bpt-2 lg:pt-0" data-testid="room-panel" hidden="" id="room-panel">/, "sem o X, o recuo de cima de antes abaixo de lg");
  // O cabecalho, depois da linha: o nome da aba escolhida no h2 e o X so com a barra (closable).
  assert.match(live, /<div class="hidden h-14 shrink-0 items-center py-1 pl-4 pr-0\.5 lg:flex"><h2 class="[^"]*" id="room-panel-title">Perguntas<\/h2><span class="relative inline-flex"><button aria-label="Fechar o painel" class="[^"]*" type="button">/);
  assert.match(replay, /<div class="hidden h-14 shrink-0 items-center py-1 pl-4 pr-0\.5 lg:flex"><h2 class="[^"]*" id="room-panel-title">Chat da live<\/h2><\/div>/, "sem a barra, sem o X");
  assert.ok(live.indexOf('role="tablist"') < live.indexOf('id="room-panel-title"') && live.indexOf('id="room-panel-title"') < live.indexOf('role="tabpanel"'), "a linha, o cabecalho e a aba, nessa ordem");
  // A aba escolhida ligada a aba da linha (o leitor de tela abaixo de lg), com as classes de quem chama no fim.
  assert.match(live, /<div aria-labelledby="room-tabbtn-perguntas" class="[^"]*\bx-y" id="room-tab-perguntas" role="tabpanel">conteudo<\/div><\/aside>$/);
  assert.match(replay, /<div aria-labelledby="room-tabbtn-chat" class="[^"]*" id="room-tab-chat" role="tabpanel">c<\/div><\/aside>$/);
});

test("RoomTabList fora da sala (o console): os ids pelo prefixo, o numero no nome da aba (tambem o zero), nenhuma aba escolhida quando o painel mostra outra coisa, sem o primeiro foco", () => {
  const tabs = [
    { label: "Chat", value: "chat" },
    { count: 3, label: "Perguntas", value: "perguntas" },
    { count: 0, label: "Mãos", value: "maos" }
  ];
  const html = render(panelModule.RoomTabList, { firstFocusValue: null, idPrefix: "console", label: "Painel do console", onSelect: noop, open: true, tab: "maos", tabs });
  assert.match(html, /^<div aria-label="Painel do console"[^>]*role="tablist">/);
  assert.deepEqual(Array.from(html.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas 3", "Mãos 0"]);
  assert.deepEqual(Array.from(html.matchAll(/aria-controls="([^"]+)"/g)).map((match) => match[1]), ["console-tab-chat", "console-tab-perguntas", "console-tab-maos"]);
  assert.deepEqual(Array.from(html.matchAll(/id="([^"]+)"/g)).map((match) => match[1]), ["console-tabbtn-chat", "console-tabbtn-perguntas", "console-tabbtn-maos"]);
  assert.deepEqual(Array.from(html.matchAll(/aria-selected="(true|false)"/g)).map((match) => match[1]), ["false", "false", "true"]);
  assert.doesNotMatch(html, /data-room-first-focus/);
  const nenhuma = render(panelModule.RoomTabList, { firstFocusValue: null, idPrefix: "console", label: "Painel do console", onSelect: noop, open: true, tab: null, tabs });
  assert.doesNotMatch(nenhuma, /aria-selected="true"/, "com o ⋯ escolhido, nenhuma aba fica escolhida");
});

/* ------------------------------------------------------------------------------------------------
 * A Na tela, R5: silenciado e removido na Live gravada (o aluno)
 * ---------------------------------------------------------------------------------------------- */

const liveModel = await import("../src/components/member/webinars/room/live-room-model.ts");
const SEM_BAN = { banned: false, kicked: false, muted: false, mutedUntil: null };
const isoDe = (ms) => new Date(ms).toISOString();
/** O aluno da sessao lida: com o aceite e o banimento que a leitura da sessao trouxe (me.ban). */
const euCom = (ban = {}) => ({ avatarUrl: null, ban: { ...SEM_BAN, ...ban }, calendarUrl: null, consented: true, displayName: "Ana S.", registered: false, registeredAt: null });
const salaR5 = (ban, { extra = {}, readOnly = false, sessionExtra = {} } = {}) =>
  render(room.WebinarRoom, { coverUrl: null, design: "normal", payload: payload({ me: euCom(ban), ...extra }, sessionExtra), presenterName: "Danilo Souza", readOnly, webinarHref: "/webinarios/aula-de-ia" });
const CAMPO_DO_CHAT = /<textarea aria-label="Escreva uma mensagem"/;
const AVISO_DO_CAMPO = /<p class="[^"]*" data-testid="room-chat-notice" role="status">([^<]*)<\/p>/;
/** O banner e a fixada que a equipe pos na frente da turma (a Na tela), para conferir que nada disso fica para o barrado. */
const FIXADA_R5 = msg("fx", { body: "Material da aula na apostila", displayName: "Equipe", pinned: true, role: "team" });
const TELA_R5 = {
  items: [{ body: "Vagas até sexta.", buttonLabel: "Quero entrar", closable: true, displayId: "dddddddd-0000-4000-8000-000000000001", image: null, kind: "banner", linkUrl: "https://exemplo.com/turma", place: "bottom_right", shownAt: isoDe(T0), size: "m", title: "Turma nova" }],
  pinned: FIXADA_R5,
  pinnedPollId: null,
  pollsKey: "",
  stamp: "s9"
};

test("R5, silenciado na gravada: o campo do chat da lugar a frase com a hora de Sao Paulo (ou ate o fim desta live); continua assistindo e reagindo; vencido o silencio ou no ver como, o campo", () => {
  const livre = salaR5({});
  assert.match(livre, CAMPO_DO_CHAT, "sem silencio, o campo");
  assert.doesNotMatch(livre, /data-testid="room-chat-notice"/);

  const ate = salaR5({ muted: true, mutedUntil: isoDe(T0 + 15 * MIN) });
  assert.equal(ate.match(AVISO_DO_CAMPO)?.[1], WEBINAR_COPY.aoVivo.silenciadoAte("20:15"), "a hora de Sao Paulo (T0 e 20:00 la)");
  assert.equal(ate.match(AVISO_DO_CAMPO)?.[1], "Você está sem escrever no chat até 20:15.");
  assert.doesNotMatch(ate, CAMPO_DO_CHAT, "o campo saiu");
  assert.doesNotMatch(ate, /aria-label="Enviar"/);
  // Continua assistindo (o player) e reagindo (o Reagir da barra ligado); o painel e as abas ficam.
  assert.match(ate, /<iframe[^>]*src="https:\/\/iframe\.mediadelivery\.net/);
  const reagir = ate.match(/<button[^>]*aria-label="Reagir"[^>]*>/)?.[0] ?? "";
  assert.ok(reagir && !/\sdisabled=""/.test(reagir), reagir);
  assert.match(ate, /role="tab"[^>]*>Perguntas</);
  assert.doesNotMatch(ate, /data-testid="room-unavailable"/);

  const ateOFim = salaR5({ muted: true, mutedUntil: null });
  assert.equal(ateOFim.match(AVISO_DO_CAMPO)?.[1], WEBINAR_COPY.aoVivo.silenciadoAteOFim);
  assert.equal(WEBINAR_COPY.aoVivo.silenciadoAteOFim, "Você está sem escrever no chat até o fim desta live.");

  // O silencio que venceu (a leitura velha ainda o traz) devolve o campo; no "ver como" nada e gravado e nada muda.
  assert.match(salaR5({ muted: true, mutedUntil: isoDe(T0 - MIN) }), CAMPO_DO_CHAT);
  assert.doesNotMatch(salaR5({ muted: true, mutedUntil: null }, { readOnly: true }), /data-testid="room-chat-notice"/);

  // As Perguntas recebem a mesma frase e a recusa de uma pergunta tambem muda a sala (a aba e escolhida na sala).
  const fonte = readFileSync(new URL("../src/components/member/webinars/room/webinar-room.tsx", import.meta.url), "utf8");
  assert.match(fonte, /<RoomQuestionsTab[^>]*?[\s\S]*?notice=\{composerNotice\}[\s\S]*?onRefused=\{onWriteRefused\}[\s\S]*?\/>/);
  assert.match(fonte, /const composerNotice = readOnly \? null : mutedPhrase\(ban, nowMs\);/);
  for (const hook of ["useRoomReactions", "useRoomPolls"]) {
    assert.match(fonte, new RegExp(`${hook}\\(\\{[^}]*onRefused: onWriteRefused`), `${hook}: o 409 da reacao e da enquete conta`);
  }
});

test("R5, removido ou banido na gravada: a sala inteira da lugar a frase de cada um (o mesmo caminho de fora do Quem pode), sem player, painel, campo, Oferta nem nada da Na tela; o cabecalho com o Sair fica", () => {
  const extra = { pinned: FIXADA_R5, screen: TELA_R5 };
  // Antes: a fixada e o banner aparecem (com o Ativar som no palco, na faixa abaixo dele).
  const antes = salaR5({}, { extra });
  assert.match(antes, /data-room-screen-row="banner"/);
  assert.match(antes, /Material da aula na apostila/);

  for (const [ban, frase] of [
    [{ kicked: true }, WEBINAR_COPY.aoVivo.removido],
    [{ banned: true }, WEBINAR_COPY.aoVivo.banido],
    [{ banned: true, kicked: true }, WEBINAR_COPY.aoVivo.banido]
  ]) {
    const html = salaR5(ban, { extra });
    assert.match(html, new RegExp(`data-room-stage="unavailable"`), frase);
    assert.equal(html.match(/data-testid="room-unavailable" role="alert">([^<]*)<\/p>/)?.[1], frase);
    assert.doesNotMatch(html, /<iframe/, "sem o player");
    assert.doesNotMatch(html, /role="tablist"|data-testid="room-panel"|data-room-bar-item=/, "sem o painel e sem a barra");
    assert.doesNotMatch(html, CAMPO_DO_CHAT);
    assert.doesNotMatch(html, /data-room-screen-|Material da aula na apostila|Turma nova/, "nada da Na tela para o barrado");
    assert.doesNotMatch(html, /data-room-badge=/, "sem os selos do palco");
    assert.match(html, /<header[\s\S]*?<button[^>]*>[\s\S]*?Sair[\s\S]*?<\/header>/, "o Sair do cabecalho continua");
  }
  assert.equal(WEBINAR_COPY.aoVivo.removido, "Você foi removido desta live.");
  // A frase de fora do "Quem pode" continua a mesma no palco sem a frase do banimento.
  const palco = render(stage.RoomStage, { countdownLabel: "", coverUrl: null, embedUrl: null, iframeRef: noop, muted: false, onUnmute: noop, replayHref: null, sessionId: "s", state: "unavailable", title: "Aula" });
  assert.match(palco, new RegExp(`role="alert">${WEBINAR_COPY.aluno.naoDisponivel}</p>`));
});

test("R5, a recusa local ate a proxima leitura e o Desfazer: o 409 muda a sala na hora; a leitura mais nova manda e devolve o campo e a sala sem recarregar", () => {
  const { NO_REFUSED_BAN, mutedPhrase, recordedBanNow, recordedBlockedScreen, refusedBanAfter, writeRefusalOf } = liveModel;
  const erro = (reason, message) => Object.assign(new Error(message ?? reason), { reason, status: 409 });
  const agora = (fromSession, refused, readMs) => recordedBanNow({ fromSession, refused, serverTimeIso: isoDe(readMs), skewMs: 0 });

  // O chat recusou com 409 muted antes da releitura: a frase "ate o fim" vale ja, sem a hora.
  assert.equal(writeRefusalOf(erro("muted")), "muted");
  const silencio = refusedBanAfter(NO_REFUSED_BAN, "muted", { nowMs: T0, serverTimeIso: isoDe(T0 - 30_000), skewMs: 0 });
  assert.deepEqual(silencio, { banned: false, kicked: false, muted: true, refusedAtMs: T0 });
  assert.equal(mutedPhrase(agora(SEM_BAN, silencio, T0 - 30_000), T0), WEBINAR_COPY.aoVivo.silenciadoAteOFim);
  // A releitura logo depois traz a hora do servidor.
  assert.equal(mutedPhrase(agora({ ...SEM_BAN, muted: true, mutedUntil: isoDe(T0 + 15 * MIN) }, silencio, T0 + 1_000), T0 + 1_000), "Você está sem escrever no chat até 20:15.");
  // A equipe desfez: a leitura seguinte, sem o silencio, devolve o campo (a recusa local ja foi coberta por ela).
  const desfeito = agora(SEM_BAN, silencio, T0 + 60_000);
  assert.deepEqual(desfeito, SEM_BAN);
  assert.equal(mutedPhrase(desfeito, T0 + 60_000), null);
  // Com o relogio do aparelho atrasado 10 s, a leitura de 5 s depois (na hora do servidor) ainda e de antes da recusa.
  assert.equal(recordedBanNow({ fromSession: SEM_BAN, refused: silencio, serverTimeIso: isoDe(T0 + 5_000), skewMs: 10_000 }).muted, true);

  // Removido: o 409 banned com a frase de removido; a sala da lugar a frase ate a leitura que traz o Desfazer.
  assert.equal(writeRefusalOf(erro("banned", WEBINAR_COPY.aoVivo.removido)), "kicked");
  assert.equal(writeRefusalOf(erro("banned", WEBINAR_COPY.aoVivo.banido)), "banned");
  const removido = refusedBanAfter(NO_REFUSED_BAN, "kicked", { nowMs: T0, serverTimeIso: isoDe(T0 - 30_000), skewMs: 0 });
  assert.equal(recordedBlockedScreen({ accessLost: false, ban: agora(SEM_BAN, removido, T0 - 30_000) }), "kicked");
  assert.equal(recordedBlockedScreen({ accessLost: false, ban: agora({ ...SEM_BAN, kicked: true }, removido, T0 + 1_000) }), "kicked", "a releitura confirma");
  assert.equal(recordedBlockedScreen({ accessLost: false, ban: agora(SEM_BAN, removido, T0 + 60_000) }), null, "o Desfazer devolve a sala");

  // Uma recusa nova soma com a que ainda vale e recomeca a ponte quando a de antes ja foi coberta.
  const soma = refusedBanAfter(silencio, "kicked", { nowMs: T0 + 2_000, serverTimeIso: isoDe(T0 - 30_000), skewMs: 0 });
  assert.deepEqual(soma, { banned: false, kicked: true, muted: true, refusedAtMs: T0 + 2_000 });
  const nova = refusedBanAfter(silencio, "kicked", { nowMs: T0 + 90_000, serverTimeIso: isoDe(T0 + 60_000), skewMs: 0 });
  assert.deepEqual(nova, { banned: false, kicked: true, muted: false, refusedAtMs: T0 + 90_000 }, "o silencio desfeito nao volta");

  // A ordem da sala ao vivo: fora do acesso antes de banido, banido antes de removido.
  assert.equal(recordedBlockedScreen({ accessLost: true, ban: { banned: true, kicked: true } }), "unavailable");
  assert.equal(recordedBlockedScreen({ accessLost: false, ban: { banned: true, kicked: true } }), "banned");
  assert.equal(recordedBlockedScreen({ accessLost: false, ban: { banned: false, kicked: false } }), null);
  // A leitura sem me.ban (a pagina de antes) vale como sem banimento.
  assert.deepEqual(recordedBanNow({ fromSession: undefined, refused: NO_REFUSED_BAN, serverTimeIso: isoDe(T0), skewMs: 0 }), SEM_BAN);

  // A sala usa estas regras: a recusa do chat, da pergunta, da enquete e da reacao muda a sala e rele a sessao.
  const fonte = readFileSync(new URL("../src/components/member/webinars/room/webinar-room.tsx", import.meta.url), "utf8");
  assert.match(fonte, /const ban = recordedBanNow\(\{ fromSession: session\.me\.ban, refused, serverTimeIso: session\.serverTime, skewMs: clock\.skewMs \}\);/);
  assert.match(fonte, /const blockedScreen = recordedBlockedScreen\(\{ accessLost: clock\.accessLost \|\| heartbeatLost, ban \}\);\s*\/\/[^\n]*\n[^\n]*\n\s*const unavailable = blockedScreen !== null;/);
  assert.match(fonte, /setRefused\(\(previous\) => refusedBanAfter\(previous, refusal, \{[^}]*\}\)\);\s*void refreshSession\(\);/);
  assert.match(fonte, /\} catch \(error\) \{\s*onWriteRefused\(error\);\s*throw error;\s*\}/, "o envio do chat recusado");
});

test("R5, a entrada: a pagina da Sala recusa o removido desta sessao da gravada com a mesma frase (a live mostra a frase na propria sala)", async () => {
  const queries = await import("../src/server/webinars/student-queries.ts");
  const sessao = (extra = {}) => ({
    session: { durationMs: 60 * MIN, join: { ok: true }, kind: "simulated", lateJoinMinutes: null, scheduledAt: isoDe(T0), startedAt: null, status: "scheduled", ...extra }
  });
  const decide = (payloadDaSessao) => queries.roomPageDecision(payloadDaSessao, { durationMs: 60 * MIN, now: T0 + 5 * MIN, staff: false });
  assert.deepEqual(decide(sessao()), { ok: true });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "kicked" } })), { ok: false, reason: "kicked" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "banned" } })), { ok: false, reason: "banned" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "kicked" }, kind: "live", status: "live" })), { ok: true }, "a live mostra a frase na sala");

  // O que a pagina escreve para cada recusa: o removido com a frase da sala.
  const pagina = readFileSync(new URL("../src/app/webinarios/[slug]/sala/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /data\.reason === "kicked"\s*\?\s*WEBINAR_COPY\.aoVivo\.removido/);
  assert.match(pagina, /data\.reason === "banned"\s*\?\s*WEBINAR_COPY\.aoVivo\.banido/);
});

test("a Simulacao confere de novo quando a live comeca (A9): quem chegou cedo e recebeu 'nada ligado' nao espera os 5 min depois do Começar para todos; sem a virada, a espera de 5 min e a de 30 s depois da falha continuam", async () => {
  const relogio = { agora: 0, offset: -60_000 };
  const pedidos = [];
  const respostas = [];
  const checker = createSimulationChecker({
    fetchFeed: async (janela) => {
      pedidos.push(janela);
      const resposta = respostas.shift() ?? { enabled: true };
      if (resposta.erro) {
        throw new Error("falhou");
      }
      return { counter: [], enabled: resposta.enabled, from: janela.fromMs, joins: [], saleNotices: [], to: janela.toMs };
    },
    getOffsetMs: () => relogio.offset,
    now: () => relogio.agora,
    onFeed: () => undefined
  });
  const conferir = async (agora, offset) => {
    relogio.agora = agora;
    relogio.offset = offset;
    await checker.check();
  };

  // Na espera (offset negativo, no maximo -1 s na live), a equipe ainda nao ligou nada.
  respostas.push({ enabled: false });
  await conferir(0, -60_000);
  assert.equal(pedidos.length, 1);
  await conferir(5_000, -1_000);
  await conferir(60_000, -1_000);
  assert.equal(pedidos.length, 1, "nada ligado: de novo so em 5 min");
  // A equipe liga as regras na espera (D74) e aperta Começar para todos: o offset vira 0 e a sala confere na hora.
  await conferir(65_000, 0);
  assert.equal(pedidos.length, 2, "a virada do offset acaba a espera");
  assert.deepEqual(pedidos[1], { fromMs: -15_000, toMs: 105_000 }, "a janela do offset de agora (a que veio vazia nao conta)");
  await conferir(70_000, 5_000);
  assert.equal(pedidos.length, 2, "a janela nova vale: nada a pedir");

  // Sem a virada, as esperas de sempre: 5 min depois do 'nada ligado' (mesmo parado em -1 s) e 30 s depois da falha.
  const outro = { agora: 0, offset: -1_000 };
  const pedidosDoOutro = [];
  const respostasDoOutro = [{ enabled: false }, { erro: true }];
  const espera = createSimulationChecker({
    fetchFeed: async (janela) => {
      pedidosDoOutro.push(janela);
      const resposta = respostasDoOutro.shift() ?? { enabled: true };
      if (resposta.erro) {
        throw new Error("falhou");
      }
      return { counter: [], enabled: resposta.enabled, from: janela.fromMs, joins: [], saleNotices: [], to: janela.toMs };
    },
    getOffsetMs: () => outro.offset,
    now: () => outro.agora,
    onFeed: () => undefined
  });
  await espera.check();
  outro.agora = 4 * 60_000;
  await espera.check();
  assert.equal(pedidosDoOutro.length, 1, "ainda na espera de 5 min");
  outro.agora = 5 * 60_000;
  await espera.check();
  assert.equal(pedidosDoOutro.length, 2, "depois de 5 min, de novo, mesmo com o offset parado em -1 s");
  outro.agora = 5 * 60_000 + 20_000;
  await espera.check();
  assert.equal(pedidosDoOutro.length, 2, "a falha espera 30 s");
  outro.agora = 5 * 60_000 + 30_000;
  await espera.check();
  assert.equal(pedidosDoOutro.length, 3);
  // Parada (a sala saiu), nada mais e pedido.
  espera.stop();
  outro.offset = 10 * 60_000;
  await espera.check();
  assert.equal(pedidosDoOutro.length, 3);
});
