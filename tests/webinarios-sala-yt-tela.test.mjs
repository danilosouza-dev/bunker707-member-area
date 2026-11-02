import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A sala no estilo do YouTube (docs/31; docs/18 §2.2), as telas das fatias desenhadas no Node pelo HTML do servidor,
// sem navegador. Y8: as Perguntas com os chips de filtro numa linha so a partir de lg (Todas, Sem resposta,
// Respondidas, Minhas), o ordenar do cabecalho do painel com o menu e o vazio que diz o filtro; abaixo de lg as duas
// linhas de antes; sem as props (a gaveta do vertical), o HTML de antes.

const questionsModule = await import("../src/components/member/webinars/room/room-questions.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const noop = () => undefined;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
/** As classes de uma abertura de tag, com o & do HTML de volta. */
const classesDe = (tag) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);

const PERGUNTAS = { allowAnonymous: true, consented: true, defaultDisplayMode: "first_name_initial", enabled: false, getOffsetMs: () => 0, onConsented: noop, readOnly: false, sessionId: "s1", webinarId: "w1" };

test("Y8: as Perguntas da sala (look comment) com o filtro Respondidas: a linha de chips so a partir de lg, um chip ligado, as duas linhas de antes so abaixo de lg e o vazio que diz o filtro", () => {
  const novas = WEBINAR_COPY.salaV2.perguntas;
  const html = render(questionsModule.RoomQuestionsTab, { ...PERGUNTAS, filter: "answered", look: "comment", onCount: noop, onFilter: noop, onOrder: noop, order: "votadas" });

  // O grupo "Filtrar perguntas" dentro da caixa que so aparece a partir de lg.
  const linha = html.match(/<div class="hidden shrink-0 lg:block"><div class="relative"><div aria-label="Filtrar perguntas" class="([^"]*)" role="group">([\s\S]*?)<\/div><\/div><\/div>/);
  assert.ok(linha, "o grupo de chips dentro de hidden lg:block");
  assert.equal(novas.filtrar, "Filtrar perguntas");
  const caixa = linha[1].replace(/&amp;/g, "&").split(" ");
  for (const classe of ["flex", "gap-2", "overflow-x-auto", "[scrollbar-width:none]", "px-4", "pt-1", "pb-2", "[scroll-padding-inline:98px]"]) {
    assert.ok(caixa.includes(classe), `a linha que rola tem ${classe}`);
  }
  // Os quatro chips, cada um com aria-pressed, e so Respondidas ligada.
  const chips = [...linha[2].matchAll(/<button aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map(([, ligado, nome]) => [nome, ligado]);
  assert.deepEqual(chips, [
    ["Todas", "false"],
    ["Sem resposta", "false"],
    ["Respondidas", "true"],
    ["Minhas", "false"]
  ]);
  // Sem as setas no servidor (elas so aparecem quando a linha nao cabe, medida no navegador).
  assert.doesNotMatch(html, /data-room-chip-arrow/);

  // As duas linhas de antes ficam so abaixo de lg.
  const antes = html.match(/<div class="([^"]*)"><div aria-label="Todas" class="flex gap-1" role="group">/);
  assert.ok(antes, "a linha de antes continua");
  assert.ok(classesDe(`<div class="${antes[1]}">`).includes("lg:hidden"), "a linha de antes so abaixo de lg");
  assert.match(html, /Mais votadas<\/button>/, "a ordem de antes, abaixo de lg");

  // O vazio diz o filtro, em 14/20 no tom fraco, centrado com 24 px em cima.
  const vazio = html.match(/<li class="([^"]*)">Nenhuma pergunta respondida ainda\.<\/li>/);
  assert.ok(vazio, "o vazio de Respondidas");
  assert.deepEqual(classesDe(`<li class="${vazio[1]}">`).sort(), ["leading-5", "mt-6", "text-center", "text-room-fg-subtle", "text-sm"]);
  assert.doesNotMatch(html, new RegExp(WEBINAR_COPY.sala.semPerguntas.replace(".", "\\.")), "o vazio de Todas nao aparece com outro filtro");
});

test("Y8: o vazio de cada filtro e o chip ligado acompanham o filtro da sala", () => {
  for (const [filter, ligado, vazio] of [
    ["all", "Todas", WEBINAR_COPY.sala.semPerguntas],
    ["open", "Sem resposta", "Nenhuma pergunta sem resposta."],
    ["mine", "Minhas", "Você ainda não fez perguntas."]
  ]) {
    const html = render(questionsModule.RoomQuestionsTab, { ...PERGUNTAS, filter, look: "comment", onFilter: noop, onOrder: noop, order: "recentes" });
    const ligados = [...html.matchAll(/<button aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map(([, nome]) => nome);
    // O chip ligado e, abaixo de lg, a ordem de antes (Mais recentes); Todas tambem liga a linha de antes.
    assert.ok(ligados.includes(ligado), `${filter}: ${ligado} ligado`);
    assert.ok(ligados.includes("Mais recentes"), `${filter}: a ordem da sala na linha de antes`);
    assert.ok(html.includes(`>${vazio}</li>`), `${filter}: o vazio`);
  }
});

test("Y8: o ordenar do cabecalho (RoomQuestionsOrderButton): o circulo sem fundo e sem title com o ListSortDescending, o menu fechado no HTML abaixo e a direita, com Mais votadas marcada", () => {
  const html = render(questionsModule.RoomQuestionsOrderButton, { onOrder: noop, order: "votadas" });
  const botao = html.match(/<button\b[^>]*>/)?.[0] ?? "";
  assert.match(botao, /aria-label="Ordenar perguntas"/);
  assert.match(botao, /aria-haspopup="menu"/);
  assert.match(botao, /aria-expanded="false"/);
  assert.match(botao, /aria-controls="room-questions-order"/);
  assert.doesNotMatch(botao, /\stitle=/, "a dica no lugar do title");
  assert.doesNotMatch(botao, /aria-pressed/);
  const classes = classesDe(botao);
  for (const classe of ["bg-transparent", "size-10", "rounded-full", "[&_svg]:size-6"]) {
    assert.ok(classes.includes(classe), `o botao tem ${classe}`);
  }
  assert.ok(!classes.some((classe) => classe.startsWith("border")), "sem contorno");
  assert.match(html, /lucide-list-sort-descending/);

  const menu = html.match(/<div aria-label="Ordenar perguntas" class="([^"]*)" hidden="" id="room-questions-order" role="menu">([\s\S]*)<\/div>/);
  assert.ok(menu, "o menu fechado no HTML, com o nome");
  const menuClasses = menu[1].split(" ");
  assert.ok(menuClasses.includes("top-full") && menuClasses.includes("right-0"), "abaixo do botao, alinhado a direita");
  const opcoes = [...menu[2].matchAll(/<button aria-checked="(true|false)"[^>]*role="menuitemradio"[^>]*>[\s\S]*?<\/button>/g)].map(([inteiro, marcada]) => [/Mais votadas/.test(inteiro) ? "Mais votadas" : "Mais recentes", marcada]);
  assert.deepEqual(opcoes, [
    ["Mais votadas", "true"],
    ["Mais recentes", "false"]
  ]);

  const recentes = render(questionsModule.RoomQuestionsOrderButton, { onOrder: noop, order: "recentes" });
  assert.match(recentes, /aria-checked="true"[^>]*role="menuitemradio"[^>]*>[\s\S]*?Mais recentes/);
});

test("Y8: sem as props (a gaveta do vertical), as Perguntas tem o HTML de antes: sem chips, as duas linhas em toda largura e o vazio de sempre", () => {
  const html = render(questionsModule.RoomQuestionsTab, PERGUNTAS);
  assert.doesNotMatch(html, /Filtrar perguntas|Sem resposta|Minhas|lg:hidden|hidden shrink-0 lg:block/);
  assert.match(html, /<div class="flex min-h-0 flex-1 flex-col" data-testid="room-questions"><div class="flex flex-wrap items-center gap-1\.5 px-3 pt-2"><div aria-label="Todas" class="flex gap-1" role="group">/);
  assert.match(html, /<button aria-pressed="true" class="[^"]*" type="button">Todas<\/button>/);
  assert.match(html, /<button aria-pressed="true" class="[^"]*" type="button">Mais votadas<\/button>/);
  assert.match(html, /<li class="py-6 text-center text-sm text-room-fg-subtle">Nenhuma pergunta ainda\.<\/li>/);
});

// Y10: a pergunta como o comentario do YouTube (spec §8.4 e §8.5): o polegar com o numero, a situacao na linha de
// acoes e a resposta escrita no fio "1 resposta", aberto na minha e fechado nas outras, com a hora da resposta (V2-A66).
const AGORA = Date.parse("2026-11-05T23:30:00.000Z");
const pergunta = (id, extra = {}) => ({
  anonymous: false,
  answerSource: null,
  answerText: null,
  answeredAt: null,
  answeredLive: false,
  body: `pergunta ${id}`,
  createdAt: new Date(AGORA - 2 * 60_000).toISOString(),
  displayName: "Ana M.",
  id,
  mine: false,
  status: "open",
  upvotes: 0,
  voted: false,
  ...extra
});
const LISTA = [
  pergunta("q1", { answeredLive: true, status: "answered", upvotes: 18, voted: true }),
  pergunta("q2", { answerSource: "team", answerText: "Fica 7 dias.", answeredAt: new Date(AGORA - 3 * 60_000).toISOString(), mine: true, status: "answered" }),
  pergunta("q3", { answerSource: "ai", answerText: "Sim, ha certificado.", answeredAt: new Date(AGORA - 60_000).toISOString(), displayName: "Caio F.", status: "answered", upvotes: 2 }),
  pergunta("q4", { anonymous: true, displayName: "Aluno 123" }),
  pergunta("q5", { mine: true, status: "dismissed" })
];
const listaDePerguntas = (extra = {}) => render(questionsModule.RoomQuestionList, { emptyPhrase: "vazio", footerFor: () => null, onVote: noop, questions: LISTA, serverNowMs: AGORA, ...extra });
/** O item de uma pergunta, do <li data-room-question> ate o proximo item (ou o fim da lista). */
const itemDe = (html, id) => {
  const inicio = html.lastIndexOf("<li", html.indexOf(`data-room-question="${id}"`));
  const fim = html.indexOf('<li class="', inicio + 3);
  return html.slice(inicio, fim === -1 ? undefined : fim);
};

test("Y10: a pergunta votada: o polegar Curtir com aria-pressed e o icone cheio, o numero so para quem ve e o sr-only '18 curtidas'; 'Respondida ao vivo' logo depois do numero, sem margem propria; sem cartao", () => {
  const html = listaDePerguntas();
  assert.match(html, /^<ul class="min-h-0 flex-1 overflow-y-auto px-4 pt-2">/, "a lista sem cartao, 16 px dos lados");
  const q1 = itemDe(html, "q1");
  assert.doesNotMatch(q1, /rounded-\[12px\]|bg-room-surface-2|border-room-border/, "sem o cartao de antes");
  const voto = q1.match(/<button aria-pressed="true" aria-label="Curtir" class="([^"]*)" type="button"><svg[^>]*>/);
  assert.ok(voto, "o voto com o nome fixo Curtir e aria-pressed");
  const classes = classesDe(`<b class="${voto[1]}">`);
  for (const classe of ["size-8", "rounded-full", "bg-transparent", "hover:bg-room-control-hover", "max-lg:size-11", "[&_svg]:size-[18px]"]) {
    assert.ok(classes.includes(classe), `o voto tem ${classe}`);
  }
  assert.match(voto[0], /fill="currentColor"[^>]*stroke-width="2"[^>]*lucide-thumbs-up/, "o polegar cheio, traco 2");
  // O numero (aria-hidden, no tom forte quando votado), o sr-only e a situacao em seguida, sem margem.
  const linha = q1.match(/<\/button><span aria-hidden="true" class="([^"]*)">18<\/span><span class="sr-only">18 curtidas<\/span><span class="([^"]*)">Respondida ao vivo<\/span><\/div>/);
  assert.ok(linha, "o numero, o sr-only e a situacao, nessa ordem");
  assert.deepEqual(classesDe(`<b class="${linha[1]}">`).sort(), ["leading-[18px]", "mr-2", "tabular-nums", "text-room-fg", "text-xs"]);
  assert.deepEqual(classesDe(`<b class="${linha[2]}">`).sort(), ["leading-[18px]", "text-room-success-fg", "text-xs"], "a situacao sem margem propria");
  assert.doesNotMatch(q1, /aria-expanded|resposta-q1/, "so ao vivo, sem fio");

  // Nao votada: o polegar vazio e o numero no tom fraco.
  const q3 = itemDe(html, "q3");
  assert.match(q3, /<button aria-pressed="false" aria-label="Curtir"[^>]*><svg[^>]*fill="none"/);
  assert.match(q3, /<span aria-hidden="true" class="mr-2 text-xs leading-\[18px\] tabular-nums text-room-fg-subtle">2<\/span><span class="sr-only">2 curtidas<\/span>/);
  // Dispensada (so o autor a ve), no tom fraco.
  assert.match(itemDe(html, "q5"), /<span class="text-xs leading-\[18px\] text-room-fg-subtle">Dispensada<\/span>/);
  // Nada de "Não gostei" nem do ⋮ por comentario.
  assert.doesNotMatch(html, /Não gostei|thumbs-down|ellipsis-vertical|Mais opções/);
});

test("Y10: o fio como no YouTube: aberto na minha, a resposta (selo Equipe e hora) vem antes do botao 'Ocultar respostas' e a linha desce ate ele; fechado na de outro, '1 resposta' com a resposta no HTML e hidden; a Anonima com a mascara", () => {
  const html = listaDePerguntas();
  const q2 = itemDe(html, "q2");
  assert.match(q2, /^<li class="group\/comment relative mb-4" data-mine="" data-room-question="q2">/, "o comentario com o fio pega o ponteiro para a linha");
  // A linha do avatar (de 28 px ate o fim do comentario) e a curva ate o botao, decorativas.
  assert.match(q2, /<span aria-hidden="true" class="absolute bottom-0 left-3 w-px bg-room-thread-line group-hover\/comment:bg-room-thread-line-hover top-7"><\/span>/);
  assert.match(q2, /<span aria-hidden="true" class="[^"]*\brounded-bl-\[16px\] border-b border-l border-room-thread-line\b[^"]*\bleft-3 top-0 h-\[30px\]"><\/span>/);
  // Aberto, o botao vira "Ocultar respostas" e desce para depois da resposta (order-2 no fio em coluna; o elemento e o
  // mesmo, para o foco ficar nele).
  assert.equal(WEBINAR_COPY.salaV2.perguntas.ocultarRespostas, "Ocultar respostas");
  assert.match(q2, /<div class="flex flex-col"><div class="relative order-2">/, "o botao vai para depois da resposta");
  const botao = q2.match(/<button aria-controls="resposta-q2" aria-expanded="true" class="([^"]*)" type="button">Ocultar respostas<svg[^>]*lucide-chevron-up[^>]*>/);
  assert.ok(botao, "o botao aberto, Ocultar respostas com a seta para cima");
  for (const classe of ["ml-6", "mt-3", "h-10", "rounded-full", "px-4", "text-sm", "font-medium", "text-room-fg", "hover:bg-room-control-hover"]) {
    assert.ok(classesDe(`<b class="${botao[1]}">`).includes(classe), `o botao do fio tem ${classe}`);
  }
  assert.doesNotMatch(botao[1], /room-cta|room-link/, "sem azul");
  // Aberta, a resposta vem primeiro (order-1): a linha desce por ela (de x 12, ate o botao que vem depois) e a curva de
  // 12 x 24 chega ao avatar dela.
  const resposta = q2.match(/<div class="relative ml-9 mt-3 order-1" id="resposta-q2">([\s\S]*)$/);
  assert.ok(resposta, "a resposta aberta, sem hidden, alinhada ao texto");
  assert.match(resposta[1], /^<span aria-hidden="true" class="absolute -left-6 -top-3 bottom-0 w-px bg-room-thread-line group-hover\/comment:bg-room-thread-line-hover"><\/span>/);
  assert.match(resposta[1], /^<span[^>]*><\/span><span aria-hidden="true" class="[^"]*\brounded-bl-\[16px\][^"]*-left-6 -top-3 h-6"><\/span>/);
  assert.match(resposta[1], /lucide-users-round/, "o avatar da Equipe");
  assert.match(resposta[1], /<span class="inline-flex h-5 [^"]*">Equipe<\/span><time [^>]*dateTime="2026-11-05T23:27:00\.000Z" title="20:27">há 3 minutos<\/time>/, "so o selo e a hora da resposta");
  assert.match(resposta[1], /<span class="sr-only">Equipe, há 3 minutos: <\/span>Fica 7 dias\./);

  // A de outro: fechada, com a seta para baixo, e a resposta do Assistente no HTML com hidden.
  const q3 = itemDe(html, "q3");
  assert.match(q3, /<div class="flex flex-col"><div class="relative"><span/, "fechado, o botao fica logo abaixo do comentario");
  assert.match(q3, /<button aria-controls="resposta-q3" aria-expanded="false"[^>]*>1 resposta<svg[^>]*lucide-chevron-down/);
  assert.match(q3, /<div class="relative ml-9 mt-3" data-testid="question-answer-assistant" hidden="" id="resposta-q3">/);
  assert.match(q3, /lucide-sparkles/, "o avatar do Assistente");
  assert.match(q3, /<span class="sr-only">Assistente, há 1 minuto: <\/span>Sim, ha certificado\./);
  // Fechada, so a linha do comentario e a curva ate o botao (sem a continuacao).
  assert.equal((q3.match(/w-px bg-room-thread-line/g) ?? []).length, 1);

  // A Anonima: o nome e o avatar da mascara (nunca o nome guardado); a minha: "Você".
  const q4 = itemDe(html, "q4");
  assert.match(q4, /lucide-venetian-mask/);
  assert.match(q4, /<span class="sr-only">Anônima, há 2 minutos: <\/span>/);
  assert.doesNotMatch(q4, /Aluno 123/);
  assert.match(q2, /<span class="sr-only">Você, há 2 minutos: <\/span>pergunta q2/);
  // Sem o agora do servidor, sem tempo (nunca um tempo errado).
  assert.doesNotMatch(listaDePerguntas({ serverNowMs: undefined }), /<time/);
});

test("Y10: no look classic (a gaveta do vertical), a pergunta e o cartao de antes", () => {
  const classico = render(questionsModule.RoomQuestionItem, { onVote: noop, question: LISTA[1] });
  assert.match(classico, /^<li class="rounded-\[12px\] border border-room-border bg-room-surface-2 p-3" data-room-question="q2">/);
  assert.match(classico, /aria-label="Curtir" aria-pressed="false"/);
  assert.match(classico, />Respondida por escrito</);
  assert.match(classico, /<p class="mt-1\.5 whitespace-pre-line text-sm leading-5 text-room-fg">Fica 7 dias\.<\/p>/);
  assert.doesNotMatch(classico, /aria-expanded|resposta-q2|room-thread-line/);
});

// Y11: o campo "Adicione um comentário" do YouTube (RoomCommentField, spec §9) desenhado direto: fechado, aberto com e
// sem texto, a Anonima das Perguntas e a frase que toma o lugar do campo.
const fieldModule = await import("../src/components/member/webinars/room/room-comment-field.tsx");
const SAFE_AREA = "max-lg:pb-[max(16px,calc(env(safe-area-inset-bottom)+8px))]";
const CAMPO = {
  ariaLabel: "Escreva uma mensagem",
  avatar: { name: "Ana S." },
  expanded: false,
  maxLength: 1000,
  mode: "enter",
  onCancel: noop,
  onChange: noop,
  onExpandedChange: noop,
  onSubmit: noop,
  placeholder: "Escreva uma mensagem",
  submitLabel: "Enviar",
  value: ""
};
const campo = (extra = {}) => render(fieldModule.RoomCommentField, { ...CAMPO, ...extra });
/** O <button> pelo texto visivel. */
const botaoPeloTexto = (html, texto) => html.match(new RegExp(`<button[^>]*>(?:<svg[\\s\\S]*?</svg>)?${texto}</button>`))?.[0] ?? "";

test("Y11: o campo fechado: a faixa com a linha em cima e a folga do iPhone, o avatar com as iniciais, o textarea sem caixa (16 px abaixo de lg, 14 a partir de lg) com a linha de 1 px; sem Cancelar e sem envio", () => {
  const html = campo();
  const faixa = html.match(/^<form class="([^"]*)">/);
  assert.ok(faixa, "a faixa e o form");
  assert.ok(classesDe(`<b class="${faixa[1]}">`).includes(SAFE_AREA), "a classe exata da folga do iPhone");
  for (const classe of ["border-t", "border-room-panel-border", "p-4"]) {
    assert.ok(classesDe(`<b class="${faixa[1]}">`).includes(classe), `a faixa tem ${classe}`);
  }
  assert.match(html, /<div class="mr-4 flex items-start"><span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span[^>]*>AS<\/span><\/span>/, "o avatar de 24 com as iniciais");
  const area = html.match(/<textarea [^>]*>/)?.[0] ?? "";
  assert.match(area, /aria-label="Escreva uma mensagem"/);
  assert.match(area, /placeholder="Escreva uma mensagem"/);
  assert.match(area, /maxLength="1000"/i);
  assert.match(area, /rows="1"/);
  const classes = classesDe(area);
  for (const classe of ["text-base", "leading-[22px]", "lg:text-sm", "lg:leading-5", "bg-transparent", "resize-none", "pb-1"]) {
    assert.ok(classes.includes(classe), `o campo tem ${classe}`);
  }
  assert.ok(!classes.includes("text-sm") && !classes.some((classe) => classe.startsWith("rounded") || classe === "border"), "sem caixa e sem os 14 px abaixo de lg");
  assert.match(html, /<div class="relative border-b border-room-field-line"><textarea/, "a linha de 1 px do campo vazio");
  assert.match(html, /<span aria-hidden="true" class="[^"]*\bh-0\.5\b[^"]*\bbg-room-fg\b[^"]*\bmotion-reduce:transition-none\b[^"]*\bscale-x-0"><\/span>/, "a linha do foco escondida");
  assert.doesNotMatch(html, />Cancelar<|>Enviar<|type="submit"/, "fechado, nada de rodape");

  // Sem nome (antes do aceite), a pessoa no lugar das iniciais.
  assert.match(campo({ avatar: { name: null } }), /lucide-user-round/);
});

test("Y11: o campo aberto com texto: a dica, o Cancelar de texto e o Enviar azul (type=submit, ligado); vazio, o envio desligado; com rascunho e sem o foco, a linha mais forte", () => {
  const html = campo({ expanded: true, hint: "Escreva @assistente para perguntar ao Assistente.", value: "oi pessoal" });
  assert.match(html, /<div class="mt-1\.5 text-xs leading-\[18px\] text-room-fg-subtle">Escreva @assistente para perguntar ao Assistente\.<\/div>/);
  assert.match(html, /<div class="mt-2 flex flex-wrap items-center gap-2"><div class="ml-auto flex items-center gap-2">/, "o rodape, com o Cancelar e o envio a direita");
  const cancelar = botaoPeloTexto(html, "Cancelar");
  assert.ok(classesDe(cancelar).includes("bg-transparent") && classesDe(cancelar).includes("h-10"), "o Cancelar e a pilula M de texto");
  const enviar = botaoPeloTexto(html, "Enviar");
  assert.match(enviar, /type="submit"/);
  assert.doesNotMatch(enviar, /disabled=""/);
  for (const classe of ["bg-room-cta-bg", "text-room-cta-fg", "h-10", "rounded-full"]) {
    assert.ok(classesDe(enviar).includes(classe), `o Enviar tem ${classe}`);
  }
  // Sem o foco no servidor: aberto com rascunho, a linha de 1 px mais forte.
  assert.match(html, /<div class="relative border-b border-room-field-line-draft"><textarea/);
  assert.doesNotMatch(html, /VenetianMask|lucide-venetian-mask|>Anônima</, "a Anonima so nas Perguntas");

  // Aberto e vazio: o envio desligado, no tom do desligado.
  const vazio = botaoPeloTexto(campo({ expanded: true }), "Enviar");
  assert.match(vazio, /disabled=""/);
  assert.ok(classesDe(vazio).includes("disabled:text-room-fg-disabled"), "o envio desligado em --room-fg-disabled");
  // Ocupado, o envio desligado tambem.
  assert.match(botaoPeloTexto(campo({ busy: true, expanded: true, value: "oi" }), "Enviar"), /aria-busy="true"[^>]*disabled=""|disabled=""[^>]*aria-busy="true"/);
});

test("Y11: nas Perguntas com a Anonima ligada: a pilula S tonal com aria-pressed e a mascara cheia, o avatar da mascara e o envio Perguntar", () => {
  const html = campo({ allowAnonymous: true, anonymous: true, ariaLabel: "Sua pergunta", expanded: true, maxLength: 500, mode: "mod-enter", placeholder: "Fazer uma pergunta", submitLabel: WEBINAR_COPY.salaV2.perguntas.perguntar, value: "tem replay?" });
  const anonima = html.match(/<button aria-pressed="true" class="([^"]*)" type="button"><svg([^>]*)>[\s\S]*?<\/svg>Anônima<\/button>/);
  assert.ok(anonima, "a pilula Anonima ligada");
  for (const classe of ["h-8", "rounded-full", "bg-room-control", "text-xs"]) {
    assert.ok(classesDe(`<b class="${anonima[1]}">`).includes(classe), `a Anonima tem ${classe}`);
  }
  assert.match(anonima[2], /fill="currentColor"/, "a mascara cheia");
  assert.match(anonima[2], /lucide-venetian-mask/);
  assert.match(html, /<div class="mr-4 flex items-start"><span aria-hidden="true" class="[^"]*"><svg[^>]*lucide-venetian-mask/, "o avatar do campo vira a mascara");
  assert.match(botaoPeloTexto(html, "Perguntar"), /type="submit"/);
  // Desligada: a mascara vazia e o avatar com as iniciais.
  const desligada = campo({ allowAnonymous: true, anonymous: false, expanded: true, mode: "mod-enter" });
  assert.match(desligada, /<button aria-pressed="false" class="[^"]*" type="button"><svg[^>]*fill="none"[^>]*lucide-venetian-mask/);
  assert.match(desligada, /<span[^>]*>AS<\/span>/);
});

test("Y11: a frase no lugar do campo: role=status, 14/20 no tom de aviso, com a mesma faixa e a mesma folga do iPhone", () => {
  const html = render(fieldModule.RoomCommentFieldNotice, { children: "Essa live acabou.", testId: "room-questions-notice" });
  const faixa = html.match(/^<div class="([^"]*)"><p class="([^"]*)" data-testid="room-questions-notice" role="status">Essa live acabou\.<\/p><\/div>$/);
  assert.ok(faixa, "a frase dentro da faixa");
  for (const classe of ["border-t", "border-room-panel-border", "p-4", SAFE_AREA]) {
    assert.ok(classesDe(`<b class="${faixa[1]}">`).includes(classe), `a faixa tem ${classe}`);
  }
  for (const classe of ["text-sm", "leading-5", "text-room-warn-fg"]) {
    assert.ok(classesDe(`<b class="${faixa[2]}">`).includes(classe), `a frase tem ${classe}`);
  }
});

test("Y11: as Perguntas da sala: o campo do YouTube (Ctrl+Enter, Perguntar) no lugar do de antes e, com a live encerrada, 'Essa live acabou.' no lugar do campo; o 'ver como' continua desligado com a frase dele", () => {
  const html = render(questionsModule.RoomQuestionsTab, { ...PERGUNTAS, displayName: "Ana S.", look: "comment" });
  assert.match(html, /<form class="[^"]*\bborder-room-panel-border\b[^"]*"><div class="mr-4 flex items-start"><span aria-hidden="true" class="[^"]*"><span[^>]*>AS<\/span><\/span><div class="ml-3 min-w-0 flex-1"><div class="relative border-b border-room-field-line"><textarea aria-label="Sua pergunta"/);
  assert.match(html, /maxLength="500"/i);
  assert.doesNotMatch(html, /rows="2"|bg-room-composer|Fazer uma pergunta<\/button>/, "nada do campo de antes");
  const encerrada = render(questionsModule.RoomQuestionsTab, { ...PERGUNTAS, ended: true, look: "comment", readOnly: true });
  assert.doesNotMatch(encerrada, /<textarea/);
  assert.match(encerrada, /data-testid="room-questions-notice" role="status">Essa live acabou\.<\/p>/);
  const verComo = render(questionsModule.RoomQuestionsTab, { ...PERGUNTAS, look: "comment", readOnly: true });
  assert.match(verComo, /<textarea[^>]*disabled=""/);
  assert.match(verComo, new RegExp(WEBINAR_COPY.aluno.previaSemGravar.replace(/\./g, "\\.")));
  // A gaveta do vertical: o campo de antes.
  assert.match(render(questionsModule.RoomQuestionsTab, PERGUNTAS), /<form class="border-t border-room-border bg-room-composer[^"]*"><textarea aria-label="Sua pergunta"[^>]*rows="2"/);
});

test("o Sair da sala pergunta numa janela no centro (alertdialog modal sobre um veu), com o titulo, o texto e o Voltar antes do Sair", async () => {
  const { RoomLeaveDialog } = await import("../src/components/member/webinars/room/room-leave-dialog.tsx");
  const sala = WEBINAR_COPY.sala;
  const html = render(RoomLeaveDialog, { onCancel: noop, onLeave: noop });
  // O veu cobre a sala inteira e centraliza a janela.
  assert.match(html, /^<div class="absolute inset-0 z-\[80\] flex items-center justify-center bg-black\/60 p-4" data-room-confirm-backdrop="">/);
  const janela = html.match(/<div aria-describedby="([^"]+)" aria-labelledby="([^"]+)" aria-modal="true" class="([^"]*)" data-room-confirm="" role="alertdialog">([\s\S]*)<\/div><\/div>$/);
  assert.ok(janela, "a janela com o papel alertdialog, modal, com titulo e texto ligados");
  const [, textoId, tituloId, classes, dentro] = janela;
  for (const classe of ["max-w-[400px]", "rounded-xl", "bg-room-menu", "p-6"]) {
    assert.ok(classes.split(" ").includes(classe), `a janela tem ${classe}`);
  }
  assert.ok(dentro.includes(`id="${tituloId}">${sala.sairConfirmar}</h2>`), "o titulo e o nome da janela");
  assert.ok(dentro.includes(`id="${textoId}">${sala.sairConfirmarTexto}</p>`), "o texto descreve a janela");
  // Os botoes: o Voltar primeiro, com o primeiro foco; o Sair depois. Nenhum fica so com icone.
  const botoes = [...dentro.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, atributos, rotulo]) => ({ foco: /data-room-first-focus/.test(atributos), rotulo }));
  assert.deepEqual(botoes, [
    { foco: true, rotulo: sala.voltar },
    { foco: false, rotulo: sala.sair }
  ]);
});
