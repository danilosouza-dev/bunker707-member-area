import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala desenhada (docs/30 §1.3 adaptado a §1.6, §1.7, §8.5 e §9; docs/18 §2.2): os pedacos desenhados no Node,
// sem navegador. O cabecalho V2 (docs/31 V2-3: o titulo, a linha da data com a duracao e quem apresenta, "{n}
// assistindo", o tema e o Sair; Replay sem contador), os selos do palco da gravada (V2-4: "Ao vivo" so com a
// decisao da equipe, senao "Sessao das 20:00"; Replay; quem apresenta), o palco nos estados (espera com a contagem,
// no ar com o iframe da Bunny coberto e "Ativar som", encerrada com "Assistir de novo" quando ha replay), o chat (V2-9:
// o balao primeiro e "nome · papel · hora" embaixo, a minha a direita, o papel so para Apresentador, Equipe e Assistente,
// sem etiqueta colorida; a pendente "Aguardando a equipe", a fixada, o menu ⋯ na linha do campo, o compositor desligado
// e no modo lento), o aceite com o
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

const header = await import("../src/components/member/webinars/room/room-header.tsx");
const branding = await import("../src/components/platform-branding.tsx");
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
const { roomSimulationStateOf } = await import("../src/components/member/webinars/room/use-room-simulation.ts");
const pollLayer = await import("../src/components/member/webinars/room/room-poll-layer.tsx");
const pollsTab = await import("../src/components/member/webinars/room/room-polls.tsx");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const noop = () => undefined;
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });
/**
 * A caixa de um campo pelas classes do Tailwind (a escala de 4 px; a linha do text-base e 24 px), no celular ou a partir
 * de lg (o lg: por cima): a altura, a borda, o respiro de cima e de baixo e a altura da linha, em px.
 */
function caixaDoCampo(classes, largura) {
  const valer = largura === "lg" ? [...classes.filter((name) => !name.includes(":")), ...classes.filter((name) => name.startsWith("lg:")).map((name) => name.slice(3))] : classes.filter((name) => !name.includes(":"));
  const px = (valor) => (valor.startsWith("[") ? Number.parseFloat(valor.slice(1)) : Number(valor) * 4);
  const caixa = { altura: 0, borda: 0, linha: 0, respiro: 0 };
  let linhaDoTexto = 0;
  for (const name of valer) {
    const [prefixo, ...resto] = name.split("-");
    const valor = resto.join("-");
    if (prefixo === "h" && valor) caixa.altura = px(valor);
    if (name === "border") caixa.borda = 1;
    if (prefixo === "py" && valor) caixa.respiro = px(valor);
    if (prefixo === "leading" && valor) caixa.linha = px(valor);
    if (name === "text-base") linhaDoTexto = 24;
  }
  caixa.linha ||= linhaDoTexto;
  return caixa;
}
/** A mensagem da Live ao vivo, com a hora que o servidor gravou (sentAt): a live das 20:00 mais o offset dado. */
const naLive = (id, offsetMs, extra = {}) => msg(id, { offsetMs, sentAt: new Date(T0 + offsetMs).toISOString(), ...extra });

/** As props do cabecalho V2 (V2-3), como a sala monta: a linha da data e a do celular ja juntas. */
const HEADER = {
  dateLine: "Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza",
  mobileLine: "com Danilo Souza · 3 assistindo",
  onLeave: noop,
  onToggleTheme: noop,
  presentNow: 3,
  theme: "dark",
  title: "Aula de IA"
};
/** O nome de cada botao, na ordem: o aria-label ou, sem ele, o texto. */
const buttonNames = (html) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => attrs.match(/aria-label="([^"]+)"/)?.[1] ?? inner.replace(/<[^>]+>/g, "").trim());

test("cabecalho (V2-3): o titulo, a linha da data com a duracao e quem apresenta, {n} assistindo, o tema e o Sair; nenhum selo e sem Minimizar (V2-2)", () => {
  const html = render(header.RoomHeader, HEADER);
  assert.match(html, /<header class="flex h-14 shrink-0 items-center /, "56 px");
  assert.doesNotMatch(html.match(/<header [^>]*>/)?.[0] ?? "", /bg-room-surface|border-b/, "transparente, sem a borda");
  assert.match(html, /<h1 class="[^"]*text-\[15px\] font-extrabold[^"]*lg:text-\[22px\][^"]*">Aula de IA<\/h1>/, "15/800 no celular, 22/800 no computador");
  assert.match(html, /<p class="hidden [^"]*lg:block" data-room-line="date">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/, "a linha da data so no computador");
  assert.match(html, /<p class="[^"]*lg:hidden" data-testid="room-mobile-line">com Danilo Souza · 3 assistindo<\/p>/, "a linha do celular abaixo de lg");
  assert.match(html, /<p class="hidden [^"]*lg:flex" data-testid="room-present">[\s\S]*?3 assistindo<\/p>/, "{n} assistindo a direita no computador");
  assert.ok(html.indexOf('data-testid="room-present"') < html.indexOf('aria-label="Tema claro"'), "o contador, o traco e o tema");
  assert.match(html, /<span aria-hidden="true" class="hidden h-7 w-px shrink-0 bg-room-divider lg:block"><\/span><button aria-label="Tema claro"/, "o traco antes do tema");
  assert.deepEqual(buttonNames(html), ["Tema claro", "Sair"], "os botoes do cabecalho: o tema (V2-12) e o Sair");
  assert.match(html, /<button aria-label="Tema claro" class="[^"]*\bhidden sm:grid\b/, "o tema so a partir de sm (abaixo, o cabecalho nao tem largura, V2-18)");
  assert.match(html, /<button class="[^"]*bg-\[var\(--accent\)\][^"]*" type="button"><svg[^>]*lucide-log-out[^>]*>[\s\S]*?<\/svg>Sair<\/button>/, "o Sair no acento, com o texto");
  assert.doesNotMatch(html, /Ao vivo|Sessão das|Replay|Gravando|Minimizar/, "nenhum selo no cabecalho (V2-4) e sem Minimizar (V2-2)");

  // Replay e sessao encerrada: a sala passa o contador nulo; a linha do celular fica so com quem apresenta.
  const replay = render(header.RoomHeader, { ...HEADER, dateLine: "60 min · com Danilo Souza", mobileLine: "com Danilo Souza", presentNow: null });
  assert.doesNotMatch(replay, /assistindo|room-present/, "o replay nao tem contador");
  assert.match(replay, /data-room-line="date">60 min · com Danilo Souza</);
  // Sem linha (nada a dizer), o paragrafo nao entra.
  const vazio = render(header.RoomHeader, { ...HEADER, dateLine: "", mobileLine: "" });
  assert.doesNotMatch(vazio, /data-room-line="date"|room-mobile-line/);
  assert.equal(render(header.RoomHeader, { ...HEADER, presentNow: 1 }).includes(">1 assistindo<"), true);
});

test("a sala gravada monta o cabecalho V2 com os dados dela: a data e a hora de Sao Paulo, a duracao e quem apresenta; no Replay, sem data, sem hora e sem contador", () => {
  // A sessao marcada para as 20:00 de Sao Paulo (T0), no ar ha 2 min.
  const noAr = (extra = {}, sessionExtra = {}) => payload(extra, { offsetMs: 120_000, scheduledAt: new Date(T0).toISOString(), ...sessionExtra });
  const props = { coverUrl: null, payload: noAr(), presenterName: "Danilo Souza", readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const cabecalho = (html) => html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  const gravada = cabecalho(render(room.WebinarRoom, props));
  assert.match(gravada, /data-room-line="date">Quinta, 5 de novembro · 20:00 · 60 min · com Danilo Souza<\/p>/);
  assert.match(gravada, /data-testid="room-mobile-line">com Danilo Souza · 2 assistindo<\/p>/);
  assert.match(gravada, /data-testid="room-present">[\s\S]*?2 assistindo<\/p>/);
  assert.doesNotMatch(gravada, /Ao vivo|Sessão das/, "o selo do momento fica no palco");

  const semApresentador = cabecalho(render(room.WebinarRoom, { ...props, presenterName: null }));
  assert.match(semApresentador, /data-room-line="date">Quinta, 5 de novembro · 20:00 · 60 min<\/p>/, "sem apresentador, sem o trecho");
  assert.match(semApresentador, /data-testid="room-mobile-line">2 assistindo<\/p>/);

  const replay = cabecalho(render(room.WebinarRoom, { ...props, payload: noAr({}, { kind: "replay", offsetMs: null, roomPhase: null }) }));
  assert.match(replay, /data-room-line="date">60 min · com Danilo Souza<\/p>/, "no replay sem data nem hora");
  assert.match(replay, /data-testid="room-mobile-line">com Danilo Souza<\/p>/);
  assert.doesNotMatch(replay, /assistindo/, "o replay nao tem contador");

  const encerrada = cabecalho(render(room.WebinarRoom, { ...props, payload: noAr({}, { roomPhase: "ended", status: "ended" }) }));
  assert.doesNotMatch(encerrada, /assistindo/, "encerrada, sem contador");
});

test("selos do palco da gravada (V2-4, a regra D10): Ao vivo so com a decisao da equipe, senao Sessao das 20:00 com o tempo; Replay sem selo embaixo; quem apresenta embaixo a esquerda", () => {
  const props = { coverUrl: null, payload: payload(), presenterName: "Danilo Souza", readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const caixa = (html) => {
    const inicio = html.indexOf('data-room-slot="stage-box"');
    return html.slice(inicio, html.indexOf('data-room-slot="bubbles"', inicio));
  };

  // O tempo no ar anda pelo relogio do aparelho (RoomElapsed): aqui so a forma.
  const aoVivo = caixa(render(room.WebinarRoom, { ...props, payload: payload({}, { showLiveBadge: true }) }));
  assert.match(aoVivo, /data-room-badges="top"><span class="[^"]*bg-\[var\(--accent\)\][^"]*" data-testid="room-on-air">/, "o Ao vivo vermelho em cima a esquerda");
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

test("o tema da sala (V2-12): o botao redondo de 40 px diz para qual tema vai; o dialogo leva o data-room-theme, escuro na primeira pintura; o vertical e sempre escuro e sem o botao", () => {
  const botao = (html, nome) => html.match(new RegExp(`<button aria-label="${nome}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? "";

  // No escuro, o Sol com "Tema claro"; no claro, a Lua com "Tema escuro" (o nome diz o que o clique faz).
  const escuro = botao(render(header.RoomHeader, HEADER), "Tema claro");
  assert.match(escuro, /title="Tema claro" type="button"/);
  assert.match(escuro, /lucide-sun/);
  const classes = (escuro.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
  assert.ok(classes.includes("size-10") && classes.includes("rounded-full"), "redondo, 40 px");
  assert.doesNotMatch(escuro, /aria-pressed/, "o nome muda com o tema: nada de aria-pressed");
  const claroHtml = render(header.RoomHeader, { ...HEADER, theme: "light" });
  assert.doesNotMatch(claroHtml, /Tema claro/);
  const claro = botao(claroHtml, "Tema escuro");
  assert.match(claro, /lucide-moon/);

  // A sala inteira: o atributo no dialogo (nunca no html), o escuro antes de ler o navegador, as cores pelos tokens.
  const props = { coverUrl: null, payload: payload(), readOnly: false, webinarHref: "/webinarios/aula-de-ia" };
  const dialogo = (html) => html.match(/<div [^>]*role="dialog"[^>]*>/)?.[0] ?? "";
  const normal = render(room.WebinarRoom, props);
  assert.match(dialogo(normal), /data-room-theme="dark"/);
  assert.equal((normal.match(/data-room-theme=/g) ?? []).length, 1, "um so lugar: o dialogo");
  assert.match(normal, /<button aria-label="Tema claro"/);
  assert.match(normal, /data-testid="room-panel"/);
  // O painel (V2-7): o cartao da aba pelo token do tema; a lista das abas e a aba escolhida tambem.
  assert.match(normal.match(/<div aria-labelledby="room-tabbtn-chat" class="[^"]*"/)?.[0] ?? "", /\bbg-room-surface\b/, "o cartao da aba pelo token do tema");
  assert.match(normal, /role="tablist"/);
  assert.match(normal.match(/<div aria-label="Painel da sala" class="[^"]*"/)?.[0] ?? "", /\bbg-room-tabs\b/, "a lista das abas pelo token");

  // O desenho vertical 9:16 fica sobre o video: sempre escuro, sem o cabecalho (e sem o botao de tema).
  const vertical = render(room.WebinarRoom, { ...props, design: "vertical" });
  assert.match(dialogo(vertical), /data-room-design="vertical"/);
  assert.match(dialogo(vertical), /data-room-theme="dark"/);
  assert.doesNotMatch(vertical, /Tema claro|Tema escuro/);
});

test("cabecalho: a marca sem link e so a partir de lg (a logo de Marca, ou Bunker707 sem logo); abaixo de lg, nenhuma marca e o titulo tem a largura", () => {
  const comMarca = (marca, props = {}) =>
    renderToStaticMarkup(createElement(branding.PlatformBrandingProvider, { branding: marca }, createElement(header.RoomHeader, { ...HEADER, ...props })));
  const tag = (html, nome) => html.match(new RegExp(`<[a-z]+[^>]*data-room-brand="${nome}"[^>]*>`))?.[0] ?? "";
  const LOGO = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/logo.png";
  const ICONE = "https://projeto.supabase.co/storage/v1/object/public/platform-assets/marca/icone.png";

  // Sem logo em Marca: o nome em texto pequeno, dentro do bloco que so aparece a partir de lg.
  const semLogo = comMarca({ logoImage: null });
  assert.match(semLogo, /data-room-brand="logo"[^>]*>\s*<span class="[^"]*text-sm font-black[^"]*">Bunker707<\/span>\s*<\/div>/);
  assert.match(tag(semLogo, "logo"), /class="hidden shrink-0 items-center lg:flex"/, "a marca so a partir de lg");
  assert.doesNotMatch(semLogo, /<img[^>]*class="[^"]*w-\[112px\]/, "sem logo, nenhuma imagem de logo");

  // Com a logo enviada em Marca: a imagem com o nome da escola, 112 px no maximo 32 de altura, alinhada a esquerda.
  const comLogo = comMarca({ logoImage: LOGO, schoolIcon: ICONE });
  const logo = comLogo.match(/<img[^>]*w-\[112px\][^>]*>/)?.[0] ?? "";
  assert.match(logo, /alt="Bunker707"/);
  assert.match(logo, new RegExp(`src="${LOGO.replace(/[.]/g, "\\.")}"`));
  assert.match(logo, /class="h-auto max-h-8 w-\[112px\] shrink-0 object-contain object-left"/);
  assert.doesNotMatch(comLogo, />Bunker707</, "com a logo, sem o nome em texto");

  // Abaixo de lg o cabecalho e o titulo, a linha do celular, o tema (a partir de sm) e o Sair (V2-18): sem o Icone.
  for (const html of [semLogo, comLogo]) {
    assert.equal(tag(html, "icon"), "", "sem o Icone da escola");
    assert.doesNotMatch(html, new RegExp(ICONE.replace(/[.]/g, "\\.")));
    // Sem link: sair da live passa pela confirmacao (askToLeave), nunca por um clique na logo.
    assert.doesNotMatch(html, /<a\b/);
    // A marca vem antes do titulo; o titulo continua encolhendo.
    assert.ok(html.indexOf('data-room-brand="logo"') < html.indexOf("<h1"));
    assert.match(html, /<h1 class="min-w-0 truncate/);
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
const chatMeta = (item) =>
  (item.match(/<p [^>]*data-room-message-meta="">([\s\S]*?)<\/p>/)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("chat no estilo do Zoom (V2-9): o balao primeiro e, embaixo, 'nome · papel · hora'; a minha a direita; o papel so para Apresentador, Equipe e Assistente; sem etiqueta colorida", () => {
  const base = {
    chatMode: "open",
    consented: true,
    defaultDisplayMode: "first_name_initial",
    displayName: "Ana S.",
    error: null,
    messages: [
      naLive("1", 42 * MIN, { displayName: "Bia C." }),
      naLive("2", 41 * MIN, { displayName: "Marina R.", role: "team" }),
      naLive("3", 1000, { displayName: "Danilo", role: "host" }),
      naLive("4", 1000, { displayName: "Assistente", role: "ai" }),
      naLive("5", 43 * MIN, { mine: true, pending: true }),
      naLive("6", 1000, { displayName: "Convidada", role: "guest" })
    ],
    nowMs: T0,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: null,
    readOnly: false,
    slowUntilMs: null,
    // A live: a hora de cada mensagem e a que o servidor gravou (sentAt), nunca o zero mais o offset.
    timeKind: "live"
  };
  const html = render(chat.RoomChatPanel, base);

  // A linha de baixo: o nome, o papel (so dos quatro) e a hora; o aluno e o convidado sem papel.
  assert.equal(chatMeta(chatItem(html, "2")), "Marina R. · Equipe · 20:41");
  assert.equal(chatMeta(chatItem(html, "1")), "Bia C. · 20:42", "o aluno sem papel");
  assert.equal(chatMeta(chatItem(html, "3")), "Danilo · Apresentador · 20:00");
  assert.equal(chatMeta(chatItem(html, "4")), "Assistente · Assistente · 20:00");
  assert.equal(chatMeta(chatItem(html, "6")), "Convidada · 20:00", "o convidado sem papel");
  // A pendente: "Aguardando a equipe" como texto na linha de baixo (e lido: fica fora do aria-hidden).
  assert.equal(chatMeta(chatItem(html, "5")), "Ana S. · 20:43 · Aguardando a equipe");
  assert.match(chatItem(html, "5"), /<\/span><span aria-hidden="true">·<\/span><span class="[^"]*">Aguardando a equipe<\/span><\/p>/);

  // O balao primeiro; a linha de baixo e so para quem ve; o leitor de tela ouve o autor antes do texto.
  const marina = chatItem(html, "2");
  assert.ok(marina.indexOf("texto 2") < marina.indexOf("data-room-message-meta"), "o balao antes da linha de baixo");
  assert.match(marina, /<p class="[^"]*\bbg-room-surface-2\b[^"]*"><span class="sr-only">Marina R\., Equipe, 20:41: <\/span>texto 2<\/p>/);
  assert.match(marina, /data-room-message-meta=""><span aria-hidden="true"[^>]*><span class="[^"]*\btext-room-meta-name\b[^"]*">Marina R\.<\/span>/);
  assert.match(chatItem(html, "1"), /<span class="sr-only">Bia C\., 20:42: <\/span>texto 1/, "sem papel, so o nome e a hora");
  // O avatar de 28 px so com as iniciais (docs/30 §8.5), escondido do leitor de tela.
  assert.match(marina, /^<li class="flex items-end gap-2" data-room-message="2"><span aria-hidden="true" class="[^"]*\bsize-7\b[^"]*"><span class="[^"]*">MR<\/span><\/span>/);

  // A minha: a direita (a linha invertida, o avatar a direita), no balao do meu tema.
  const minha = chatItem(html, "5");
  assert.match(minha, /^<li class="[^"]*\bflex-row-reverse\b[^"]*" data-mine="" data-room-message="5">/);
  assert.match(minha, /<p class="[^"]*\bbg-room-bubble-mine-bg\b[^"]*\btext-room-bubble-mine-fg\b[^"]*"><span class="sr-only">Ana S\., 20:43: <\/span>texto 5<\/p>/);
  assert.equal((html.match(/data-mine=""/g) ?? []).length, 1, "so a minha");
  assert.doesNotMatch(marina, /flex-row-reverse/);

  // Nenhuma etiqueta colorida no item (o selo de papel e o da pendente saem): nem RoomBadge nem MemberChip.
  const itens = ["1", "2", "3", "4", "5", "6"].map((id) => chatItem(html, id)).join("");
  assert.doesNotMatch(itens, /rounded-full border|h-\[22px\]|bg-\[var\(--accent\)\]/);

  // Na live o zero nao entra: o "Comecar para todos" e a ancora mudam o zero sem recalcular o que ja esta na tela.
  const zeroMudou = render(chat.RoomChatPanel, { ...base, zeroMs: T0 + 7 * MIN });
  assert.equal(chatMeta(chatItem(zeroMudou, "2")), "Marina R. · Equipe · 20:41", "o zero novo nao desloca a hora");
  const semHoraGravada = render(chat.RoomChatPanel, { ...base, messages: [msg("2", { displayName: "Marina R.", offsetMs: 41 * MIN, role: "team", sentAt: null })], zeroMs: T0 });
  assert.equal(chatMeta(chatItem(semHoraGravada, "2")), "Marina R. · Equipe", "sem a hora gravada, sem hora (nunca a conta pelo zero)");

  // Na gravada, a hora marcada mais o offset (a mensagem nao traz a hora gravada); no Replay, nenhuma hora (nem para
  // o leitor de tela).
  const gravada = render(chat.RoomChatPanel, { ...base, messages: base.messages.map((message) => ({ ...message, sentAt: null })), timeKind: "simulated", zeroMs: T0 });
  assert.equal(chatMeta(chatItem(gravada, "2")), "Marina R. · Equipe · 20:41");
  const replay = render(chat.RoomChatPanel, { ...base, phase: "replay", timeKind: "replay", zeroMs: T0 });
  assert.equal(chatMeta(chatItem(replay, "2")), "Marina R. · Equipe");
  assert.match(chatItem(replay, "2"), /<span class="sr-only">Marina R\., Equipe: <\/span>texto 2/);
  // Sem dizer de que sala e (a prop e obrigatoria no tipo: o typecheck pega quem esquece), tambem sem hora.
  assert.equal(chatMeta(chatItem(render(chat.RoomChatPanel, { ...base, timeKind: undefined }), "2")), "Marina R. · Equipe");
});

test("chat: a fixada, a lista em role=log; o menu ⋯ na linha do campo; compositor desligado, so a equipe, modo lento e encerrada", () => {
  const base = {
    chatMode: "open",
    consented: true,
    defaultDisplayMode: "first_name_initial",
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
  assert.match(html, /<div class="[^"]*\bbg-room-pinned\b[^"]*" data-testid="room-pinned">[\s\S]*?Fixada pela equipe[\s\S]*?link da apostila/);
  // Sai a linha do rotulo "Chat" (repetia o nome da aba): o nome fica so na lista.
  assert.doesNotMatch(html, />Chat</);
  assert.match(html, /<ol aria-label="Chat"/);

  // A linha do campo: o menu ⋯ a esquerda (40 px), o campo (44 px, 16 px abaixo de lg) e o Enviar redondo de 44 px.
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  assert.match(form, /<button aria-label="Mais opções" class="[^"]*\bsize-10\b[^"]*"[^>]*aria-expanded="false" aria-haspopup="menu">[\s\S]*<textarea/, "o menu antes do campo");
  assert.match(form, /<textarea aria-label="Escreva uma mensagem" class="[^"]*\bh-11\b[^"]*\btext-base\b[^"]*\blg:text-\[13px\][^"]*"/);
  // A linha cabe no campo de altura fixa (a caixa conta a borda, box-sizing do Tailwind): borda + respiro + linha <=
  // altura, no celular e a partir de lg. Com a linha de 24 px nos 44 px sobravam 22 e o Chrome do Windows e do Linux
  // mostrava a barra de rolar.
  const campo = form.match(/<textarea [^>]*class="([^"]*)"/)[1].split(/\s+/);
  for (const largura of ["celular", "lg"]) {
    const caixa = caixaDoCampo(campo, largura);
    assert.ok(caixa.altura > 0 && caixa.linha > 0, `${largura}: a altura e a linha vem das classes`);
    assert.ok(2 * caixa.borda + 2 * caixa.respiro + caixa.linha <= caixa.altura, `${largura}: ${JSON.stringify(caixa)} cabe sem rolar`);
  }
  assert.match(form, new RegExp(`maxlength="${CHAT_LIMITS.body}"`, "i"));
  assert.match(form, /<\/textarea><button aria-label="Enviar" class="[^"]*\bsize-11\b[^"]*\bbg-room-active-bg\b[^"]*" title="Enviar" type="submit" disabled="">/);
  assert.doesNotMatch(html.slice(0, html.indexOf("<form")), /Mais opções/, "nada de menu acima da lista");

  // Com a frase no lugar do campo (silenciado, sala que nao abriu), o menu continua na linha.
  const comFrase = render(chat.RoomChatPanel, { ...base, notice: "Você está sem escrever no chat até 20:15." });
  assert.doesNotMatch(comFrase, /<textarea/);
  assert.match(comFrase, /aria-label="Mais opções"[\s\S]*data-testid="room-chat-notice" role="status">Você está sem escrever no chat até 20:15\.</);

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

test("o aceite (§8.5): o texto palavra por palavra, como o nome aparece, Entendi e quero participar e Participar como anonimo", () => {
  const html = render(chat.RoomConsentBox, { defaultDisplayMode: "first_name_initial", onAccept: noop, onCancel: noop });
  assert.ok(html.includes(WEBINAR_COPY.sala.consentimento));
  assert.match(html, /Entendi e quero participar/);
  assert.match(html, /Participar como anônimo/);
  assert.match(html, /Como você aparece no chat/);
  assert.match(html, /Primeiro nome e inicial/);
  assert.match(html, /Apelido/);
  assert.match(html, /role="group"/);
  assert.equal(
    WEBINAR_COPY.sala.consentimento,
    "Ao enviar mensagens neste chat, você autoriza que o seu primeiro nome e o texto da mensagem apareçam para os outros alunos durante esta sessão e nas reexibições dela. Você pode remover as suas mensagens a qualquer momento em Perfil › Privacidade."
  );
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
  assert.match(barra({ panelOpen: false }), /<button aria-controls="room-panel" aria-label="Mostrar o chat" aria-pressed="false"/);
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

test("o Sair do cabecalho com a barra na tela (leaveInBar): so abaixo de lg; sem a barra, em toda largura", () => {
  const sair = (html) => html.match(/<button class="([^"]*)" type="button"><svg[^>]*lucide-log-out/)?.[1] ?? "";
  assert.ok(sair(render(header.RoomHeader, { ...HEADER, leaveInBar: true })).split(" ").includes("lg:hidden"));
  assert.ok(!sair(render(header.RoomHeader, HEADER)).split(" ").includes("lg:hidden"), "o padrao: sem a barra");
  assert.ok(sair(render(header.RoomHeader, HEADER)).length > 0);
});

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
  // O painel de 320 px a direita no computador (V2-7), com as abas em pilula na lista "Painel da sala".
  const aside = live.match(/<aside class="([^"]*)" data-testid="room-panel" id="room-panel">/)?.[1].split(" ") ?? [];
  assert.ok(aside.includes("lg:w-80") && aside.includes("lg:flex-none"), aside.join(" "));
  assert.match(live, /<div aria-label="Painel da sala" class="[^"]*" role="tablist">/);
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
    payload: payload({ polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: null, status: "open" }] }),
    readOnly: false,
    webinarHref: "/x"
  });
  assert.match(withPoll, />Enquetes</);
  // A enquete aberta sem resposta abre no meio do palco (V2-10), dentro da caixa do palco; o card do chat so com ela
  // deixada para depois.
  const caixaDoPalco = withPoll.slice(withPoll.indexOf('data-room-slot="stage-box"'), withPoll.indexOf('data-testid="room-panel"'));
  assert.match(caixaDoPalco, /<div aria-labelledby="([^"]+)" class="[^"]*" data-room-stage-poll="answer"[^>]*role="dialog"><p [^>]*>Enquete · resposta única<\/p><h2 [^>]*id="\1">Gostou\?<\/h2>/);
  assert.doesNotMatch(withPoll, /Responder agora|data-room-poll-later/, "fora do 'depois', nenhum card no chat");
  // So uma enquete encerrada com o resultado: sem a aba (o resultado aparece no palco, V2-10).
  const encerrada = render(room.WebinarRoom, {
    coverUrl: null,
    payload: payload({ polls: [{ anonymous: false, id: "p1", kind: "single", myOptionIds: ["o1"], options: [{ id: "o1", label: "Sim" }], question: "Gostou?", results: { counts: { o1: 3 }, total: 3 }, status: "closed" }] }),
    readOnly: false,
    webinarHref: "/x"
  });
  assert.doesNotMatch(encerrada, /role="tab"[^>]*>Enquetes</, "a enquete encerrada nao abre a aba no desenho normal");

  const replay = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { kind: "replay", offsetMs: null, roomPhase: null }), readOnly: false, webinarHref: "/x" });
  assert.match(replay, /data-room-phase="replay"/);
  assert.match(replay, /role="tab"[^>]*>Chat da live</);
  assert.match(replay, /role="tab"[^>]*>Perguntas</);
  assert.doesNotMatch(replay, /role="tab"[^>]*>Participantes</, "no Replay ninguem esta presente: sem Participantes");
  assert.doesNotMatch(replay, /Ativar som/, "o replay tem a barra do player");

  const preview = render(room.WebinarRoom, { coverUrl: null, payload: payload(), readOnly: true, webinarHref: "/x" });
  assert.match(preview, /No modo de visualização, nada é gravado\./);
});

/** Uma enquete do aluno (aberta, resposta unica, com duas opcoes). */
const enquete = (extra = {}) => ({ anonymous: false, id: "p1", kind: "single", myOptionIds: null, options: [{ id: "o1", label: "Sim" }, { id: "o2", label: "Ainda não" }], question: "Gostou?", results: null, status: "open", ...extra });
const camada = (props) => render(pollLayer.RoomPollLayer, { onAnswer: async () => undefined, onLater: noop, onSeen: noop, readOnly: false, ...props });

test("a enquete no meio do palco (V2-10): o rotulo pelo tipo, a pergunta em h2, opcoes de 48 px, Responder depois e Enviar resposta; um dialogo sem aria-modal que nao pega o foco e se anuncia", () => {
  const html = camada({ stage: { mode: "answer", poll: enquete() } });
  // A regiao viva fica antes e sempre montada: ela diz "Enquete aberta" quando a enquete abre sozinha.
  assert.match(html, /^<p aria-live="polite" class="sr-only" data-room-poll-said="">Enquete aberta<\/p>/);
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
  assert.match(html, /data-room-poll-said="">Enquete · resultado<\/p>/);
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

test("a gravada com enquete aberta: no desenho normal ela abre no palco; no vertical 9:16 nada muda (o card de antes abre a aba Enquetes da gaveta)", () => {
  const comEnquete = payload({ polls: [enquete()] });
  const normal = render(room.WebinarRoom, { coverUrl: null, payload: comEnquete, readOnly: false, webinarHref: "/x" });
  const caixaDoPalco = normal.slice(normal.indexOf('data-room-slot="stage-box"'), normal.indexOf('data-testid="room-panel"'));
  assert.match(caixaDoPalco, /data-room-poll-layer="answer"/);
  assert.match(caixaDoPalco, /<h2 [^>]*>Gostou\?<\/h2>/);

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
  const html = render(notices.LiveParticipantsTab, { stage: layout.panelStageNames("Danilo Souza"), students: shownCount });
  assert.match(html, />No palco</);
  assert.match(html, /Danilo Souza/);
  assert.match(html, /58 alunos na sala/, "o mesmo numero do cabecalho: a sala nao se contradiz");
  assert.equal((html.match(/<li/g) ?? []).length, 1, "so quem apresenta vira lista");
  // Sem o nome de quem apresenta, so o numero.
  const semNome = render(notices.LiveParticipantsTab, { stage: layout.panelStageNames(null), students: shownCount });
  assert.equal((semNome.match(/<li/g) ?? []).length, 0);
  assert.match(semNome, /58 alunos na sala/);
  // A sessao encerrada: o cabecalho tira o numero (verticalBadge, showCount) e a aba tambem, pela mesma condicao.
  const numeroDaAba = (phase) => (vertical.verticalBadge({ kind: "simulated", phase, showLiveBadge: true }).showCount ? shownCount : null);
  assert.match(render(notices.LiveParticipantsTab, { stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("live") }), /58 alunos na sala/);
  assert.match(render(notices.LiveParticipantsTab, { stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("waiting") }), /58 alunos na sala/);
  const encerrada = render(notices.LiveParticipantsTab, { stage: layout.panelStageNames("Danilo Souza"), students: numeroDaAba("ended") });
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
    html.includes(`<div class="${esqueleto.body}" data-room-slot="body"><div class="${esqueleto.stageColumn}" data-room-slot="stage-column"><div class="${esqueleto.stageBox.replaceAll("&", "&amp;").replaceAll(">", "&gt;")}" data-room-slot="stage-box" style="--room-video-right:0px"><div class="relative bg-black aspect-video w-full lg:aspect-auto lg:h-full"`),
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
  assert.match(barra, /<button aria-controls="room-panel" aria-label="Esconder o chat" aria-pressed="true"/);
  // O Som da gravada: o video comeca mudo (aria-pressed falso); antes do zero, sem player, nao ha o que ligar.
  assert.match(barra, /<button aria-label="Som" aria-pressed="false" class="[^"]*" data-room-bar-item="sound" title="Som" type="button">/);
  const antes = render(room.WebinarRoom, { coverUrl: null, payload: payload({}, { offsetMs: -4 * MIN, roomPhase: "waiting", scheduledAt: new Date(T0 + 4 * MIN).toISOString() }), readOnly: false, webinarHref: "/x" });
  assert.match(antes, /<button aria-label="Som" aria-pressed="false"[^>]*data-room-bar-item="sound" disabled=""/);
  assert.match(barra, /<button class="[^"]*\bhidden\b[^"]*\blg:inline-flex\b[^"]*"[^>]*data-room-bar-item="leave" title="Sair"><svg[\s\S]*?<span class="sr-only xl:not-sr-only">Sair<\/span><\/button>/, "o Sair da barra a partir de lg, com o nome no title entre lg e xl (so o icone)");
  assert.match(html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "", /\blg:hidden" type="button">[\s\S]*?Sair<\/button>/, "o Sair do cabecalho so abaixo de lg");
  assert.match(html, /<aside class="[^"]*" data-testid="room-panel" id="room-panel">/, "o painel do chat que o balao controla");
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
