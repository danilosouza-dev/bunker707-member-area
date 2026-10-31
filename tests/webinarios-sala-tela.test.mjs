import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Sala desenhada (docs/30 §1.3 adaptado a §1.6, §1.7, §8.5 e §9; docs/18 §2.2): os pedacos desenhados no Node,
// sem navegador. O cabecalho V2 (docs/31 V2-3: o titulo, a linha da data com a duracao e quem apresenta, "{n}
// assistindo", o tema e o Sair; Replay sem contador), os selos do palco da gravada (V2-4: "Ao vivo" so com a
// decisao da equipe, senao "Sessao das 20:00"; Replay; quem apresenta), o palco nos estados (espera com a contagem,
// no ar com o iframe da Bunny coberto e "Ativar som", encerrada com "Assistir de novo" quando ha replay), o chat (os selos Equipe / Apresentador /
// Assistente, a pendente "Aguardando a equipe", a fixada, o compositor desligado e no modo lento), o aceite com o
// texto exato de §8.5 e os dois botoes, a barra de reacoes com seis botoes de 44 px, a sala inteira como dialogo
// (aria-modal, as abas, a 375 px: palco na largura, campo no rodape) e os botoes Entrar / Assistir o replay. A marca no
// cabecalho (a sala cobre o topo da area): a logo de Marca a partir de lg (o ponto em que a sala vira computador),
// "Bunker707" sem logo, sem link; abaixo de lg, nenhuma marca (V2-18).
// Fase 4d: sem o celular em pe (deitado, tablet, computador e a primeira pintura do servidor) a sala continua no
// desenho normal, igual a antes; as caixas novas do esqueleto (bolhas, aviso de venda, doca e lugar da Oferta) sao
// `contents` e nao mudam nada na tela. O desenho vertical e testado em tests/webinarios-sala-vertical-*.test.mjs.

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

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const EMBED = "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc?autoplay=true&muted=true&controls=false";
const noop = () => undefined;
const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 1000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

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

test("chat: os selos, a pendente, a fixada, a lista em role=log; compositor desligado, so a equipe, modo lento e encerrada; Remover minhas mensagens no menu", () => {
  const base = {
    chatMode: "open",
    consented: true,
    defaultDisplayMode: "first_name_initial",
    displayName: "Ana S.",
    error: null,
    messages: [msg("1", { displayName: "Bia C." }), msg("2", { displayName: "Equipe", role: "team" }), msg("3", { displayName: "Danilo", role: "host" }), msg("4", { displayName: "Assistente", role: "ai" }), msg("5", { mine: true, pending: true })],
    nowMs: T0,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: msg("p", { displayName: "Equipe", pinned: true, role: "team", body: "link da apostila" }),
    readOnly: false,
    slowUntilMs: null
  };
  const html = render(chat.RoomChatPanel, base);
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="off"/, "em lista cheia o leitor de tela ouve so a contagem");
  assert.match(html, />Equipe</);
  assert.match(html, />Apresentador</);
  assert.match(html, />Assistente</);
  assert.match(html, /Aguardando a equipe/);
  assert.match(html, /Fixada pela equipe/);
  assert.match(html, /link da apostila/);
  assert.match(html, /aria-haspopup="menu"[^>]*aria-label="Mais opções"/, "o menu ... (Remover minhas mensagens abre nele)");
  assert.match(html, /aria-label="Escreva uma mensagem"/);
  assert.match(html, new RegExp(`maxlength="${CHAT_LIMITS.body}"`, "i"));
  assert.match(html, /min-h-11/, "o campo tem 44 px");

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
  assert.match(withPoll, /Gostou\?/, "o card da enquete por cima do chat");
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
