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
