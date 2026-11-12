import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O comentario ou a pergunta que a equipe traz para a tela (rodada v9, P11; docs/30 D89; docs/31 §5.1 e §14; docs/18
// §2.2), no Node e sem navegador. O produtor (12/11/2026): "Eu queria a funcionalidade de trazer um comentario ou
// pergunta para a tela. Isso e util para quando o apresentador quer responder e mostrar a pergunta na tela para todos
// verem ou mencionar algum comentario e mostrar na tela." Aqui: a regra pura (o que pode ir para a tela, o cartao lido
// da origem, onde ele fica), o cartao do palco largo, a linha da faixa e da doca do vertical, o anuncio para o leitor de
// tela e o estado que a sala recebe. As acoes do servidor ficam em webinarios-na-tela-acoes; o console desenhado, em
// webinarios-na-tela-console-tela; o banco de verdade, em tests/integration/webinarios-v9.

const model = await import("../src/server/webinars/screen-comment-model.ts");
const commentModule = await import("../src/components/member/webinars/room/screen/room-screen-comment.tsx");
const stripModule = await import("../src/components/member/webinars/room/screen/room-screen-strip.tsx");
const { NA_TELA_COPY } = await import("../src/lib/webinar-copy-v4/na-tela.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const classesDe = (tag) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
const FOTO = "https://projeto.supabase.co/storage/v1/object/public/avatars/00000000-0000-4000-8000-0000000000a1/foto.webp";
const SESSION = "cccccccc-0000-4000-8000-000000000001";
const WEBINAR = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIBICAO = { id: "dddddddd-0000-4000-8000-000000000001", shownAt: "2026-11-12T20:05:00.000Z" };

const mensagem = (extra = {}) => ({
  approved: true,
  authorUserId: "00000000-0000-4000-8000-0000000000a1",
  body: "Como faz isso?",
  createdAt: "2026-11-12T20:00:00.000Z",
  displayName: "Ana M.",
  id: "eeeeeeee-0000-4000-8000-000000000001",
  kind: "message",
  master: false,
  offsetMs: 0,
  pinnedAt: null,
  replyToId: null,
  role: "student",
  scriptItemId: null,
  sessionId: SESSION,
  source: "audience",
  webinarId: WEBINAR,
  ...extra
});
const pergunta = (extra = {}) => ({ anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: "Posso fazer?", createdAt: "2026-11-12T20:00:00.000Z", displayName: "Ana M.", id: "ffffffff-0000-4000-8000-000000000001", messageId: null, offsetMs: 0, sessionId: SESSION, simulated: false, status: "open", upvotes: 0, userId: "00000000-0000-4000-8000-0000000000a1", ...extra });

test("o que pode ir para a tela: a mensagem liberada desta sessao (ou da linha mestre do webinario), nunca a que espera a equipe, a de sistema nem o registro do item Pergunta do roteiro; a pergunta desta sessao que a turma ve", () => {
  assert.deepEqual([...model.SCREEN_COMMENT_SOURCES], ["chat", "question"]);
  assert.deepEqual([...model.SCREEN_COMMENT_HIDDEN_REASONS], ["team", "replaced", "removed"]);
  assert.equal(model.SCREEN_COMMENT_MIGRATION, "202611150001");
  assert.equal(model.messageCanGoOnScreen(mensagem()), true);
  assert.equal(model.messageCanGoOnScreen(mensagem({ approved: false })), false, "a que espera a equipe ainda nao foi vista pela turma");
  assert.equal(model.messageCanGoOnScreen(mensagem({ kind: "system" })), false);
  assert.equal(model.messageCanGoOnScreen(mensagem({ kind: "question", source: "scripted" })), false, "o registro do item Pergunta: a pergunta dele esta na aba Perguntas");
  assert.equal(model.messageCanGoOnScreen(mensagem({ role: "team", source: "scripted" })), true, "o comentario do roteiro pode");
  assert.equal(model.messageCanGoOnScreen(mensagem({ role: "ai", source: "ai" })), true, "a resposta do Assistente tambem");
  const sessao = { id: SESSION, webinarId: WEBINAR };
  assert.equal(model.messageBelongsToSession(mensagem(), sessao), true);
  assert.equal(model.messageBelongsToSession(mensagem({ master: true, sessionId: "outra" }), sessao), true, "a linha mestre que a gravada toca");
  assert.equal(model.messageBelongsToSession(mensagem({ sessionId: "outra" }), sessao), false);
  assert.equal(model.messageBelongsToSession(mensagem({ master: true, sessionId: "outra", webinarId: "outro" }), sessao), false);
  assert.equal(model.questionCanGoOnScreen(pergunta(), SESSION), true);
  assert.equal(model.questionCanGoOnScreen(pergunta({ status: "answered" }), SESSION), true);
  assert.equal(model.questionCanGoOnScreen(pergunta({ status: "dismissed" }), SESSION), false, "a dispensada so o autor ve");
  assert.equal(model.questionCanGoOnScreen(pergunta(), "outra"), false);
});

test("o cartao lido da origem: o nome que o chat ja mostra, a foto pela regra do chat, o selo so da equipe e do Assistente; a pergunta anonima antiga continua Anônima e sem foto", () => {
  assert.deepEqual(model.screenCommentOfMessage(EXIBICAO, mensagem(), FOTO), {
    avatar: "person",
    avatarUrl: FOTO,
    body: "Como faz isso?",
    displayId: EXIBICAO.id,
    name: "Ana M.",
    role: null,
    shownAt: EXIBICAO.shownAt,
    source: "chat",
    sourceId: "eeeeeeee-0000-4000-8000-000000000001"
  });
  assert.equal(model.screenCommentOfMessage(EXIBICAO, mensagem({ approved: false }), FOTO), null);
  const daEquipe = model.screenCommentOfMessage(EXIBICAO, mensagem({ displayName: "Danilo S.", role: "host", source: "team" }), FOTO);
  assert.deepEqual([daEquipe.role, daEquipe.avatarUrl], ["host", FOTO]);
  const doAssistente = model.screenCommentOfMessage(EXIBICAO, mensagem({ authorUserId: null, displayName: "Assistente", role: "ai", source: "ai" }), FOTO);
  assert.deepEqual([doAssistente.avatar, doAssistente.avatarUrl, doAssistente.role], ["assistant", null, "ai"], "o Assistente nao tem pessoa");
  assert.equal(model.screenCommentOfMessage(EXIBICAO, mensagem({ role: "guest" }), null).role, null);

  const daPergunta = model.screenCommentOfQuestion(EXIBICAO, pergunta(), FOTO);
  assert.deepEqual([daPergunta.source, daPergunta.sourceId, daPergunta.name, daPergunta.body, daPergunta.role, daPergunta.avatarUrl], ["question", pergunta().id, "Ana M.", "Posso fazer?", null, FOTO]);
  assert.equal(model.screenCommentOfQuestion(EXIBICAO, pergunta({ status: "dismissed" }), FOTO), null);
  const anonima = model.screenCommentOfQuestion(EXIBICAO, pergunta({ anonymous: true }), FOTO);
  assert.deepEqual([anonima.name, anonima.avatar, anonima.avatarUrl], ["Anônima", "anonymous", null], "o legado de antes de 10/11/2026 (D64): a foto diria quem e");
  assert.equal(model.screenCommentSourceId({ messageId: "m", questionId: null, source: "chat" }), "m");
  assert.equal(model.screenCommentSourceId({ messageId: null, questionId: "q", source: "question" }), "q");
});

test("onde o cartao fica no palco largo: embaixo, no meio; com um canto de baixo ocupado (banner, QR Code, Oferta), do outro lado; com a fileira de baixo tomada, em cima", () => {
  assert.equal(model.screenCommentPlace([]), "bottom_center");
  assert.equal(model.screenCommentPlace(["top_left", "top_right", "middle_left"]), "bottom_center", "o que esta em cima e no meio nao muda o lugar");
  assert.equal(model.screenCommentPlace(["bottom_right"]), "bottom_left", "o banner nasce embaixo, a direita");
  assert.equal(model.screenCommentPlace(["bottom_left"]), "bottom_right");
  assert.equal(model.screenCommentPlace([], true), "bottom_left", "a Oferta da gravada fica embaixo, a direita");
  assert.equal(model.screenCommentPlace(["bottom_center"]), "top_center");
  assert.equal(model.screenCommentPlace(["bottom_left", "bottom_right"]), "top_center");
  assert.equal(model.screenCommentPlace(["bottom_left"], true), "top_center");
});

const cartao = (extra = {}) => ({ avatar: "person", avatarUrl: null, body: "Como faz isso?", displayId: EXIBICAO.id, name: "Ana M.", role: null, shownAt: EXIBICAO.shownAt, source: "chat", sourceId: "m1", ...extra });

test("o cartao no palco: a secao nao modal com o nome de quem escreveu, a linha 'Comentário na tela' (ou 'Pergunta na tela'), a foto ou as iniciais, o selo do papel e o texto em ate 4 linhas; entra suave e nada nele recebe o toque", () => {
  const html = render(commentModule.RoomScreenCommentCard, { comment: cartao() });
  assert.match(html, /^<section aria-label="Comentário de Ana M\. na tela" class="[^"]*" data-room-screen-comment="chat" data-room-screen-display="dddddddd-0000-4000-8000-000000000001">/);
  const classes = classesDe(html.match(/^<section [^>]*>/)[0]);
  for (const classe of ["bg-room-on-video-bg", "text-room-on-video-fg", "rounded-[16px]", "motion-safe:animate-in", "motion-safe:fade-in-0", "motion-safe:slide-in-from-bottom-3", "motion-safe:duration-300", "motion-safe:ease-out"]) {
    assert.ok(classes.includes(classe), `${classe} no cartao`);
  }
  assert.ok(!classes.includes("pointer-events-auto"), "o cartao nao recebe o toque: o video por baixo continua clicavel");
  assert.doesNotMatch(html, /<button|<a |aria-modal|role="dialog"|tabindex/, "nada para clicar: so a equipe tira");
  assert.equal(textOf(html), "Comentário na tela AM Ana M. Como faz isso?", "a linha de cima, as iniciais do avatar, o nome e o texto");
  assert.match(html, /<span class="[^"]*">AM<\/span>/, "sem foto, as iniciais");
  assert.match(html, /<p class="[^"]*line-clamp-4[^"]*" data-room-screen-comment-body="">Como faz isso\?<\/p>/);

  const comFoto = render(commentModule.RoomScreenCommentCard, { comment: cartao({ avatarUrl: FOTO }) });
  assert.match(comFoto, /<img alt=""[^>]*src="[^"]*foto\.webp[^"]*"/);
  const daEquipe = render(commentModule.RoomScreenCommentCard, { comment: cartao({ name: "Danilo S.", role: "host" }) });
  assert.equal(textOf(daEquipe), "Comentário na tela DS Danilo S. Apresentador Como faz isso?");
  const daPergunta = render(commentModule.RoomScreenCommentCard, { comment: cartao({ body: "Posso fazer?", source: "question" }) });
  assert.match(daPergunta, /^<section aria-label="Pergunta de Ana M\. na tela"/);
  assert.equal(textOf(daPergunta), "Pergunta na tela AM Ana M. Posso fazer?");
  const anonima = render(commentModule.RoomScreenCommentCard, { comment: cartao({ avatar: "anonymous", name: "Anônima", source: "question" }) });
  assert.match(anonima, /lucide-venetian-mask/, "a mascara da pergunta anonima antiga");
  assert.doesNotMatch(anonima, /<img /);
});

test("a camada no palco: o proprio recipiente @container/tela, na area segura da Na tela, o cartao so com 640 px ou mais de palco, no lugar escolhido; com a capa ou sem comentario, nada", () => {
  const camada = (extra = {}) => render(commentModule.RoomScreenCommentLayer, { comment: cartao(), forced: false, place: "bottom_center", ...extra });
  const html = camada();
  assert.match(html, /^<div class="@container\/tela pointer-events-none absolute inset-0 z-20" data-room-screen-comment-layer="">/);
  assert.match(html, /<div class="absolute left-3 right-\[calc\(var\(--room-video-right,0px\)\+12px\)\] top-14 lg:left-4 bottom-14">/, "a mesma area segura do banner");
  assert.match(camada({ engineBar: true }), /top-14 lg:left-4 bottom-24">/, "com a barra do motor, 96 px embaixo");
  const lugar = (place) => classesDe(camada({ place }).match(/<div class="[^"]*" data-room-screen-comment-place="[a-z_]+">/)[0]);
  assert.ok(["bottom-[var(--room-snackbar-offset,0px)]", "justify-center"].every((classe) => lugar("bottom_center").includes(classe)), "embaixo no meio, subindo com o aviso da sala");
  assert.ok(lugar("bottom_left").includes("justify-start"));
  assert.ok(lugar("bottom_right").includes("justify-end"));
  assert.ok(["top-0", "justify-center"].every((classe) => lugar("top_center").includes(classe)));
  const secao = classesDe(html.match(/<section [^>]*>/)[0]);
  for (const classe of ["hidden", "@min-[640px]/tela:flex", "[@media(max-height:500px)]:hidden!", "w-[clamp(280px,44cqw,560px)]", "max-w-full"]) {
    assert.ok(secao.includes(classe), `${classe}: so no palco largo, com a largura do meio`);
  }
  assert.ok(classesDe(camada({ place: "bottom_left" }).match(/<section [^>]*>/)[0]).includes("w-[clamp(260px,52cqw,560px)]"), "ao lado de um item, ate 52 % do palco");
  assert.equal(camada({ forced: true }), "", "com a capa no palco, nada sobre o video (a faixa mostra)");
  assert.equal(camada({ comment: null }), "");
});

test("o palco estreito e a capa: o comentario e a primeira linha da faixa abaixo do palco, com o texto em ate 3 linhas; na doca do vertical, a linha escura sobre o video; sem comentario, a faixa e a doca de antes", () => {
  const faixa = render(stripModule.RoomScreenStrip, { comment: cartao(), forced: false, items: [], pinned: null });
  assert.match(faixa, /^<div class="@container\/tela shrink-0 lg:-mt-3" data-room-screen-strip="">/);
  const linha = faixa.match(/<section aria-label="Comentário de Ana M\. na tela" class="[^"]*" data-room-screen-comment-row="chat"[^>]*>/);
  assert.ok(linha, "a linha do comentario");
  assert.ok(classesDe(linha[0]).includes("text-room-fg"), "as cores da sala");
  assert.match(faixa, /<p class="[^"]*line-clamp-3[^"]*" data-room-screen-comment-body="">Como faz isso\?<\/p>/);
  assert.match(faixa, /max-h-\[200px\]/, "a faixa guarda lugar para o comentario inteiro");
  assert.ok(classesDe(faixa.match(/<div class="flex flex-col overflow-y-auto[^"]*">/)[0]).includes("@min-[640px]/tela:hidden"), "no palco largo a faixa some (o cartao esta no palco)");
  assert.match(render(stripModule.RoomScreenStrip, { comment: cartao(), forced: true, items: [], pinned: null }), /data-tela="faixa"/, "com a capa, a faixa vale em qualquer largura");
  assert.equal(render(stripModule.RoomScreenStrip, { forced: false, items: [], pinned: null }), "", "sem nada, sem faixa");

  const doca = render(stripModule.RoomScreenDock, { comment: cartao({ source: "question" }), items: [] });
  const daDoca = doca.match(/<section aria-label="Pergunta de Ana M\. na tela" class="[^"]*" data-room-screen-comment-row="question"[^>]*>/);
  assert.ok(daDoca, "a linha na doca do vertical");
  assert.ok(["bg-black/60", "text-white", "pointer-events-auto"].every((classe) => classesDe(daDoca[0]).includes(classe)));
  assert.equal(render(stripModule.RoomScreenDock, { items: [] }), "");
});

test("o leitor de tela: um anuncio educado na chegada do comentario; o que ja estava na abertura nao e anunciado e a saida e silenciosa", () => {
  assert.equal(commentModule.screenCommentAnnouncement(cartao()), "A equipe mostrou na tela o comentário de Ana M.: Como faz isso?");
  assert.equal(commentModule.screenCommentAnnouncement(cartao({ body: "Posso fazer?", source: "question" })), "A equipe mostrou na tela a pergunta de Ana M.: Posso fazer?");
  assert.equal(commentModule.screenCommentSectionName(cartao()), NA_TELA_COPY.aluno.secaoComentario("Ana M."));
  // No HTML do servidor a regiao polida existe e esta vazia (o comentario que ja estava na abertura nao e anunciado).
  assert.equal(render(commentModule.RoomScreenCommentAnnouncer, { comment: cartao() }), '<div aria-live="polite" class="sr-only" data-room-screen-comment-announce=""></div>');
  assert.equal(render(commentModule.RoomScreenCommentAnnouncer, { comment: null }), '<div aria-live="polite" class="sr-only" data-room-screen-comment-announce=""></div>');
});
