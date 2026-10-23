import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Frases da equipe sobre onde, quando e quantas vezes o pop-up aparece (v3b-1, docs/25 §2.3, §2.4, §2.7,
// §2.8 e §2.9; popup-sentences.ts): partes da revisao (o pop-up padrao fica exatamente como antes), frases ao
// vivo dos cards, avisos de "Quantas vezes", a segunda linha da lista, as linhas de "Detalhes", a legenda da
// previa e o vocabulario fechado da equipe (docs/17 §1.3).

const frases = await import("../src/server/communications/popup-sentences.ts");
const model = await import("../src/server/communications/popup-display-model.ts");
const campaign = await import("../src/server/communications/campaign-model.ts");

const nomes = { "curso-x": "Curso X", "curso-y": "Curso Y", "curso-z": "Curso Z", "formacao-ia": "Formação IA" };
const config = (extra = {}) => ({ ...model.POPUP_SETTINGS_DEFAULT, ...extra });
const repetir = (extra = {}) => ({ everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click", ...extra });

test("uma pagina sozinha: cada frase da revisao", () => {
  const casos = {
    any: "em qualquer página",
    "content:*": "na página de qualquer produto",
    "content:formacao-ia": "na página de Formação IA",
    "content:sem-nome": "na página de um produto",
    continue: "em Continue assistindo",
    home: "no Início",
    journey: "em Minha jornada",
    "lesson:*": "em qualquer aula",
    "lesson:formacao-ia": "nas aulas de Formação IA",
    "lesson:sem-nome": "nas aulas de um produto",
    materials: "em Materiais",
    profile: "no Perfil",
    purchases: "em Minhas compras",
    saved: "em Favoritos",
    support: "no Suporte"
  };

  for (const [pattern, phrase] of Object.entries(casos)) {
    assert.equal(frases.describePopupPages([pattern], nomes), phrase, pattern);
  }

  assert.equal(frases.describePopupPages(["content:curso-x", "content:curso-y"], nomes), "na página de 2 produtos");
  assert.equal(frases.describePopupPages(["lesson:curso-x", "lesson:curso-y"], nomes), "nas aulas de 2 produtos");
  assert.equal(frases.describePopupPages(["any", "home", "lesson:*"], nomes), "em qualquer página", "qualquer resume tudo");
  assert.equal(frases.describePopupPages(["content:*", "content:curso-x"], nomes), "na página de qualquer produto");
});

test("varias paginas: ate 3 frases com virgula e 'e', na ordem do menu; mais que isso, quantas", () => {
  assert.equal(frases.describePopupPages(["lesson:formacao-ia", "home"], nomes), "no Início e nas aulas de Formação IA");
  assert.equal(frases.describePopupPages(["profile", "home", "saved"], nomes), "no Início, em Favoritos e no Perfil");
  assert.equal(frases.describePopupPages(["home", "saved", "content:curso-x", "content:curso-y"], nomes), "no Início, em Favoritos e na página de 2 produtos");
  assert.equal(frases.describePopupPages(["home", "saved", "profile", "support"], nomes), "em 4 páginas escolhidas");
  assert.equal(frases.describePopupPages(["home", "saved", "profile", "content:curso-x"], nomes), "em 4 páginas escolhidas");
});

test("excecoes: ', menos A', ', menos A e B'; mais de duas, quantas", () => {
  assert.equal(frases.describePopupExceptions([], nomes), "");
  assert.equal(frases.describePopupExceptions(["profile"], nomes), ", menos Perfil");
  assert.equal(frases.describePopupExceptions(["support", "profile"], nomes), ", menos Perfil e Suporte");
  assert.equal(frases.describePopupExceptions(["home", "profile", "support"], nomes), ", menos 3 páginas");
  assert.equal(frases.describePopupExceptions(["content:formacao-ia"], nomes), ", menos a página de Formação IA");
  assert.equal(frases.describePopupExceptions(["lesson:formacao-ia"], nomes), ", menos as aulas de Formação IA");
  assert.equal(frases.describePopupExceptions(["content:sem-nome"], nomes), ", menos a página de um produto");
  assert.equal(frases.describePopupExceptions(["content:*", "lesson:*"], nomes), ", menos páginas de produto e aulas");
  assert.equal(frases.describePopupExceptions(["home", "purchases"], nomes), ", menos Início e Minhas compras");
  assert.equal(frases.describePopupExceptions(["saved", "materials"], nomes), ", menos Favoritos e Materiais");
  assert.equal(frases.describePopupExceptions(["journey", "continue"], nomes), ", menos Minha jornada e Continue assistindo");
});

test("frase ao vivo de 'Quando e onde aparece'", () => {
  assert.equal(frases.describePopupPlacement(config({ exclude: ["profile", "support"], pages: ["any"] }), nomes), "Aparece em qualquer página, menos Perfil e Suporte.");
  assert.equal(frases.describePopupPlacement(config({ pages: ["home", "lesson:formacao-ia"] }), nomes), "Aparece no Início e nas aulas de Formação IA.");
  assert.equal(frases.describePopupPlacement(config({ pages: ["lesson:formacao-ia"], trigger: "lesson_completed" }), nomes), "Aparece ao concluir uma aula de Formação IA.");
  assert.equal(frases.describePopupPlacement(config({ pages: ["lesson:*"], trigger: "lesson_completed" }), nomes), "Aparece ao concluir uma aula.");
  assert.equal(
    frases.describePopupPlacement(config({ exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" }), nomes),
    "Aparece ao concluir uma aula, menos as aulas de Curso X."
  );
  assert.equal(
    frases.describePopupPlacement(config({ exclude: ["lesson:curso-x", "lesson:curso-y"], pages: ["lesson:*"], trigger: "lesson_completed" }), nomes),
    "Aparece ao concluir uma aula, menos as aulas de 2 produtos."
  );
  assert.equal(frases.describePopupPlacement(config({ pages: ["lesson:curso-x", "lesson:curso-y"], trigger: "lesson_completed" }), nomes), "Aparece ao concluir uma aula de 2 produtos.");
  assert.equal(frases.describePopupPlacement(config(), nomes), "Aparece no Início.");
});

test("curso que abre direto na aula escolhido so em 'Página do produto': a frase avisa (um e varios); nada quando 'Páginas de aula' cobre", () => {
  const direto = ["curso-x", "curso-y", "curso-z"];

  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:curso-x"] }), direto, nomes), " (Curso X abre direto na aula: marque também “Páginas de aula”.)");
  assert.equal(
    frases.opensOnLessonNote(config({ pages: ["content:curso-z", "content:curso-x", "content:curso-y"] }), direto, nomes),
    " (Curso X e mais 2 abrem direto na aula: marque também “Páginas de aula”.)"
  );
  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:curso-x", "lesson:*"] }), direto, nomes), null);
  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:curso-x", "lesson:curso-x"] }), direto, nomes), null);
  assert.equal(
    frases.opensOnLessonNote(config({ pages: ["content:curso-x", "content:curso-y", "lesson:curso-x"] }), direto, nomes),
    " (Curso Y abre direto na aula: marque também “Páginas de aula”.)"
  );
  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:formacao-ia"] }), direto, nomes), null, "nao abre direto na aula");
  assert.equal(frases.opensOnLessonNote(config({ pages: ["home"] }), direto, nomes), null);
  assert.equal(frases.opensOnLessonNote(config({ pages: ["lesson:curso-x"], trigger: "lesson_completed" }), direto, nomes), null);
  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:sem-nome"] }), ["sem-nome"], nomes), " (Um produto abre direto na aula: marque também “Páginas de aula”.)");
});

test("tempo em palavras: a maior unidade exata", () => {
  const casos = [
    [1, "1 minuto"],
    [30, "30 minutos"],
    [45, "45 minutos"],
    [60, "1 hora"],
    [90, "90 minutos"],
    [120, "2 horas"],
    [1440, "1 dia"],
    [2880, "2 dias"],
    [1500, "25 horas"],
    [1501, "1.501 minutos"],
    [129_600, "90 dias"],
    [10_080, "7 dias"]
  ];

  for (const [minutes, text] of casos) {
    assert.equal(frases.describeMinutes(minutes), text, String(minutes));
  }
});

test("quantas vezes na revisao: Uma vez, as partes de 'Mais de uma vez' e o ritmo das linhas de antes", () => {
  assert.equal(frases.describePopupFrequency({ mode: "once" }, "page_load"), "no máximo 1 vez");
  assert.equal(
    frases.describePopupFrequency(repetir({ everyMinutes: 120, maxPerDay: 3 }), "page_load"),
    "até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar"
  );
  assert.equal(frases.describePopupFrequency(repetir({ maxPerDay: 1 }), "page_load"), "até 1 vez por dia, até o aluno clicar");
  assert.equal(frases.describePopupFrequency(repetir({ stopOn: "never" }), "page_load"), "toda vez que o aluno abrir uma das páginas, até o pop-up terminar");
  assert.equal(frases.describePopupFrequency(repetir(), "lesson_completed"), "toda vez que o aluno concluir uma aula, até o aluno clicar");
  assert.equal(
    frases.describePopupFrequency(repetir({ maxPerDay: 2, maxTotal: 1000, stopOn: "never" }), "page_load"),
    "até 2 vezes por dia, no máximo 1.000 vezes no total, até o pop-up terminar"
  );
  assert.equal(frases.describePopupFrequency(model.POPUP_UNTIL_CLICK_V1, "page_load"), "com pelo menos 1 dia entre uma vez e outra, até o aluno clicar", "Até o aluno clicar de antes");
});

test("revisao: o pop-up padrao fica exatamente como antes; onde, quando e o atraso entram como partes", () => {
  const revisao = (settings, extra = {}) =>
    campaign.describeNoticeReview({
      audienceCount: 318,
      kind: "popup",
      popup: frases.popupReviewParts(settings, nomes),
      repeat: model.repeatOfFrequency(settings.frequency),
      schedule: { mode: "now" },
      window: { endsAt: "2026-10-22T02:59:00.000Z", startsAt: "2026-10-14T12:00:00.000Z" },
      ...extra
    });

  assert.equal(revisao(config()), "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.");
  // v3b-2: `audience` (o "para quem" do "No primeiro acesso") fica null nos outros momentos.
  assert.deepEqual(frases.popupReviewParts(config(), nomes), { audience: null, frequency: "no máximo 1 vez", placement: null });
  assert.equal(
    revisao(config({ delaySeconds: 0, exclude: ["profile"], frequency: repetir({ everyMinutes: 120, maxPerDay: 3 }), pages: ["any"] }), { window: { endsAt: null, startsAt: null } }),
    "Pop-up para 318 alunos, em qualquer página, menos Perfil, logo ao abrir, a partir de agora, sem data para acabar, até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar."
  );
  assert.equal(
    revisao(config({ frequency: model.POPUP_UNTIL_CLICK_V1 })),
    "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, com pelo menos 1 dia entre uma vez e outra, até o aluno clicar."
  );

  const lugar = (extra) => frases.popupReviewParts(config(extra), nomes).placement;
  assert.equal(lugar({ delaySeconds: 10 }), "no Início, 10 segundos depois de abrir");
  assert.equal(lugar({ delaySeconds: 1 }), "no Início, 1 segundo depois de abrir");
  assert.equal(lugar({ delaySeconds: 60 }), "no Início, 1 minuto depois de abrir");
  assert.equal(lugar({ delaySeconds: 600 }), "no Início, 10 minutos depois de abrir");
  assert.equal(lugar({ delaySeconds: 90 }), "no Início, 90 segundos depois de abrir");
  assert.equal(lugar({ pages: ["saved"] }), "em Favoritos");
  assert.equal(lugar({ pages: ["lesson:*"], trigger: "lesson_completed" }), "ao concluir uma aula");
  assert.equal(lugar({ pages: ["lesson:formacao-ia"], trigger: "lesson_completed" }), "ao concluir uma aula de Formação IA");
  assert.equal(lugar({ pages: ["lesson:curso-x", "lesson:curso-y"], trigger: "lesson_completed" }), "ao concluir uma aula de 2 produtos");
  assert.equal(lugar({ delaySeconds: 0, exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" }), "ao concluir uma aula, menos as aulas de Curso X, logo depois");
  assert.equal(lugar({ delaySeconds: 10, exclude: ["lesson:curso-x", "lesson:curso-y"], pages: ["lesson:*"], trigger: "lesson_completed" }), "ao concluir uma aula, menos as aulas de 2 produtos, 10 segundos depois");
  assert.equal(lugar({ delaySeconds: 3, pages: ["lesson:*"], trigger: "lesson_completed" }), "ao concluir uma aula", "3 s nao aparece");
});

test("frase ao vivo de 'Quantas vezes e como fecha'", () => {
  assert.equal(frases.describePopupFrequencyLive(config(), true), "Cada aluno vê uma vez (mais uma a cada “Lembrar depois”). Fecha no X, no Esc ou clicando fora.");
  assert.equal(frases.describePopupFrequencyLive(config({ close: "x_only" }), false), "Cada aluno vê uma vez. Fecha só no X (e no Esc).");
  assert.equal(
    frases.describePopupFrequencyLive(config({ close: "x_only", frequency: repetir({ everyMinutes: 120, maxPerDay: 3 }) }), true),
    "Cada aluno vê até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra (na próxima página que abrir depois desse tempo), até clicar no botão. Fecha só no X (e no Esc)."
  );
  assert.equal(
    frases.describePopupFrequencyLive(config({ frequency: repetir({ everyMinutes: 60, maxTotal: 5, stopOn: "never" }), pages: ["lesson:*"], trigger: "lesson_completed" }), true),
    "Cada aluno vê com pelo menos 1 hora entre uma vez e outra (na próxima aula concluída depois desse tempo), no máximo 5 vezes no total, até o pop-up terminar. Fecha no X, no Esc ou clicando fora."
  );
  assert.equal(frases.describePopupFrequencyLive(config({ frequency: repetir() }), true), "Cada aluno vê toda vez que abrir uma das páginas, até clicar no botão. Fecha no X, no Esc ou clicando fora.");
  assert.equal(
    frases.describePopupFrequencyLive(config({ frequency: repetir({ stopOn: "never" }), pages: ["lesson:*"], trigger: "lesson_completed" }), false),
    "Cada aluno vê toda vez que concluir uma aula, até o pop-up terminar. Fecha no X, no Esc ou clicando fora."
  );
  assert.equal(frases.describePopupFrequencyLive(config({ frequency: repetir({ maxPerDay: 1 }) }), true), "Cada aluno vê até 1 vez por dia, até clicar no botão. Fecha no X, no Esc ou clicando fora.");
});

test("avisos de 'Mais de uma vez': o conflito, sem ritmo, seguidas e sem data para acabar, nessa ordem; nada nos valores do comeco", () => {
  const notas = (frequency, extra = {}) => frases.popupFrequencyNotes({ endsAt: "2026-12-01T03:00:00.000Z", frequency, trigger: "page_load", ...extra });
  const textos = (frequency, extra) => notas(frequency, extra).map((note) => note.text);

  assert.deepEqual(notas({ mode: "once" }), []);
  assert.deepEqual(notas(repetir({ maxPerDay: 1 })), [], "valores do comeco: 1 por dia, ate clicar");
  assert.deepEqual(notas(repetir({ everyMinutes: 1440, maxPerDay: 10 })), [
    {
      text: "Com 1 dia entre uma vez e outra, cabem no máximo 1 vez por dia, não 10. Diminua o tempo entre uma vez e outra ou desligue essa opção.",
      tone: "warning"
    }
  ]);
  assert.deepEqual(textos(repetir({ everyMinutes: 120, maxPerDay: 20 })), [
    "Com 2 horas entre uma vez e outra, cabem no máximo 12 vezes por dia, não 20. Diminua o tempo entre uma vez e outra ou desligue essa opção."
  ]);
  assert.deepEqual(notas(repetir({ everyMinutes: 120, maxPerDay: 12 })), [], "12 cabem em 2 horas");
  assert.deepEqual(notas(repetir({ everyMinutes: 420, maxPerDay: 4 })), [], "de 7 em 7 horas cabem 4 no dia");
  assert.deepEqual(notas(repetir()), [
    {
      text: "Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno abrir uma das páginas escolhidas, até ele clicar no botão.",
      tone: "warning"
    }
  ]);
  assert.deepEqual(textos(repetir({ stopOn: "never" }), { endsAt: null, trigger: "lesson_completed" }), [
    "Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno concluir uma aula, até o pop-up terminar.",
    "Sem data para acabar, ele continua aparecendo enquanto o aluno estiver no segmento."
  ]);
  assert.deepEqual(notas(repetir({ maxPerDay: 10 })), [
    {
      text: "Sem tempo entre uma vez e outra, as 10 vezes do dia podem acontecer seguidas, uma em cada página que o aluno abrir. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”.",
      tone: "info"
    }
  ]);
  assert.deepEqual(textos(repetir({ maxPerDay: 10 }), { trigger: "lesson_completed" }), [
    "Sem tempo entre uma vez e outra, as 10 vezes do dia podem acontecer seguidas, uma a cada aula concluída. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”."
  ]);
  assert.deepEqual(notas(repetir({ maxPerDay: 1, stopOn: "never" }), { endsAt: null }), [
    { text: "Sem data para acabar, ele continua aparecendo enquanto o aluno estiver no segmento.", tone: "warning" }
  ]);
  assert.deepEqual(notas(repetir({ maxPerDay: 1, stopOn: "never" })), [], "com data de fim");
  assert.deepEqual(
    notas(repetir({ everyMinutes: 1440, maxPerDay: 10, stopOn: "never" }), { endsAt: null }).map((note) => note.tone),
    ["warning", "warning"],
    "conflito e sem data, nessa ordem"
  );
  assert.equal(notas(repetir({ everyMinutes: 1440, maxPerDay: 10, stopOn: "never" }), { endsAt: null })[0].text.startsWith("Com 1 dia"), true);
});

test("'Lembrar depois' mais longo do que o tempo entre uma vez e outra: a linha de aviso; nada nos outros casos", () => {
  const nota = (extra) => frases.popupSnoozeNote({ allowSnooze: true, frequency: repetir({ everyMinutes: 30 }), snoozeMinutes: 1440, ...extra });

  assert.equal(nota({}), "“Lembrar depois” esconde o pop-up por 1 dia, mais do que o tempo entre uma vez e outra.");
  assert.equal(nota({ snoozeMinutes: 90 }), "“Lembrar depois” esconde o pop-up por 90 minutos, mais do que o tempo entre uma vez e outra.");
  assert.equal(nota({ allowSnooze: false }), null);
  assert.equal(nota({ frequency: { mode: "once" } }), null);
  assert.equal(nota({ frequency: repetir({ maxPerDay: 2 }) }), null, "sem intervalo");
  assert.equal(nota({ frequency: repetir({ everyMinutes: 1440 }) }), null, "igual nao e mais longo");
  assert.equal(nota({ frequency: repetir({ everyMinutes: 2880 }) }), null);
});

test("segunda linha da lista (sem nomes) e legenda da previa", () => {
  const curta = (extra) => frases.describePopupPlacementShort(config(extra));

  assert.equal(curta({}), null, "padrao: so a linha de sempre");
  assert.equal(curta({ frequency: repetir(), close: "x_only" }), null, "frequencia nao e lugar");
  assert.equal(curta({ pages: ["lesson:*"], trigger: "lesson_completed" }), "Ao concluir uma aula");
  assert.equal(curta({ exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" }), "Ao concluir uma aula (com exceções)");
  assert.equal(curta({ pages: ["any"] }), "Em qualquer página");
  assert.equal(curta({ exclude: ["profile"], pages: ["any"] }), "Em qualquer página (com exceções)");
  assert.equal(curta({ pages: ["home", "saved"] }), "Em 2 páginas");
  assert.equal(curta({ delaySeconds: 10 }), "No Início");
  assert.equal(curta({ exclude: ["content:*"], pages: ["home"] }), "No Início (com exceções)");
  assert.equal(curta({ pages: ["purchases"] }), "Em Minhas compras");
  assert.equal(curta({ pages: ["saved"] }), "Em Favoritos");
  assert.equal(curta({ pages: ["materials"] }), "Em Materiais");
  assert.equal(curta({ pages: ["journey"] }), "Em Minha jornada");
  assert.equal(curta({ pages: ["continue"] }), "Em Continue assistindo");
  assert.equal(curta({ pages: ["profile"] }), "No Perfil");
  assert.equal(curta({ pages: ["support"] }), "No Suporte");
  assert.equal(curta({ pages: ["content:curso-x"] }), "Na página do produto");
  assert.equal(curta({ pages: ["content:*"] }), "Na página do produto");
  assert.equal(curta({ pages: ["lesson:*"] }), "Nas páginas de aula");
  assert.equal(curta({ pages: ["content:curso-x", "content:curso-y"] }), "Em 2 páginas");

  assert.equal(frases.popupCloseCaption("any"), "Fecha no X, no Esc ou clicando fora.");
  assert.equal(frases.popupCloseCaption("x_only"), "Fecha só no X (e no Esc).");
  assert.deepEqual(Object.values(frases.POPUP_PAGE_KIND_LABELS).sort(), [
    "Continue assistindo",
    "Favoritos",
    "Início",
    "Materiais",
    "Minha jornada",
    "Minhas compras",
    "Perfil",
    "Página do produto",
    "Páginas de aula",
    "Suporte"
  ]);
  assert.deepEqual(Object.keys(frases.POPUP_PAGE_KIND_LABELS).sort(), [...model.POPUP_PAGE_KINDS].sort());
});

test("'Detalhes' do relatorio: Onde, Quando aparece, Quantas vezes e Como fecha", () => {
  assert.deepEqual(frases.popupSettingsLines(config({ exclude: ["profile"], frequency: repetir({ maxPerDay: 3 }), pages: ["any"] }), nomes), [
    { label: "Onde", value: "Em qualquer página, menos Perfil" },
    { label: "Quando aparece", value: "Ao abrir a página, 3 segundos depois" },
    { label: "Quantas vezes", value: "Até 3 vezes por dia, até o aluno clicar" },
    { label: "Como fecha", value: "No X, no Esc ou clicando fora" }
  ]);
  assert.deepEqual(frases.popupSettingsLines(config(), nomes), [
    { label: "Onde", value: "No Início" },
    { label: "Quando aparece", value: "Ao abrir a página, 3 segundos depois" },
    { label: "Quantas vezes", value: "No máximo 1 vez" },
    { label: "Como fecha", value: "No X, no Esc ou clicando fora" }
  ]);
  assert.equal(frases.popupSettingsLines(config({ delaySeconds: 0 }), nomes)[1].value, "Ao abrir a página, logo");
  assert.equal(frases.popupSettingsLines(config({ delaySeconds: 60 }), nomes)[1].value, "Ao abrir a página, 1 minuto depois");
  assert.deepEqual(frases.popupSettingsLines(config({ close: "x_only", delaySeconds: 0, pages: ["lesson:formacao-ia"], trigger: "lesson_completed" }), nomes), [
    { label: "Onde", value: "Nas aulas de Formação IA" },
    { label: "Quando aparece", value: "Ao concluir uma aula, logo depois" },
    { label: "Quantas vezes", value: "No máximo 1 vez" },
    { label: "Como fecha", value: "Só no X (e no Esc)" }
  ]);
  assert.equal(frases.popupSettingsLines(config({ pages: ["lesson:*"], trigger: "lesson_completed" }), nomes)[0].value, "Em qualquer aula");
  assert.equal(frases.popupSettingsLines(config({ exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" }), nomes)[0].value, "Em qualquer aula, menos as aulas de Curso X");
  assert.equal(frases.popupSettingsLines(config({ pages: ["lesson:*"], trigger: "lesson_completed" }), nomes)[1].value, "Ao concluir uma aula, 3 segundos depois");
  assert.equal(frases.popupSettingsLines(config({ frequency: model.POPUP_UNTIL_CLICK_V1 }), nomes)[2].value, "Com pelo menos 1 dia entre uma vez e outra, até o aluno clicar");
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario fechado da equipe (docs/17 §1.3, docs/23 V19)
 * ---------------------------------------------------------------------------------------------- */

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];

/** Os textos dos literais do arquivo (aspas e crases, sem os trechos ${...}), sem comentarios. */
function literalsOf(source) {
  const found = [];
  let index = 0;

  function readQuoted(quote) {
    let text = "";
    index += 1;

    while (index < source.length && source[index] !== quote) {
      text += source[index] === "\\" ? source[(index += 1)] : source[index];
      index += 1;
    }

    index += 1;
    found.push(text);
  }

  function readTemplate() {
    let text = "";
    index += 1;

    while (index < source.length && source[index] !== "`") {
      if (source.startsWith("${", index)) {
        index += 2;
        readCode("}");
        text += " ";
        continue;
      }

      text += source[index] === "\\" ? source[(index += 1)] : source[index];
      index += 1;
    }

    index += 1;
    found.push(text);
  }

  function readCode(until) {
    let depth = 0;

    while (index < source.length) {
      const char = source[index];

      if (until && char === "}" && depth === 0) {
        index += 1;
        return;
      }

      if (source.startsWith("//", index)) {
        index = source.indexOf("\n", index);
        index = index === -1 ? source.length : index;
      } else if (source.startsWith("/*", index)) {
        index = source.indexOf("*/", index) + 2;
      } else if (char === '"' || char === "'") {
        readQuoted(char);
      } else if (char === "`") {
        readTemplate();
      } else {
        depth += char === "{" ? 1 : char === "}" ? -1 : 0;
        index += 1;
      }
    }
  }

  readCode(null);
  return found;
}

test("vocabulario: nenhum texto de popup-sentences.ts (valores, nunca as chaves) usa as palavras fora do vocabulario da equipe", async () => {
  const source = await readFile(new URL("../src/server/communications/popup-sentences.ts", import.meta.url), "utf8");
  // Texto que alguem le: tem espaco, acento ou comeca com maiuscula (as chaves "home", "content:*" ficam de fora).
  const textos = literalsOf(source).filter((text) => /\s|[^\x00-\x7f]|^[A-Z]/.test(text));

  assert.ok(textos.length > 40, `achou os textos (${textos.length})`);
  for (const texto of textos) {
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }

  // E o que as funcoes devolvem, numa amostra larga.
  const amostras = [];
  const configs = [
    config(),
    config({ close: "x_only", delaySeconds: 0, exclude: ["profile", "support"], frequency: repetir({ everyMinutes: 30, maxPerDay: 3, maxTotal: 9, stopOn: "never" }), pages: ["any"] }),
    config({ frequency: repetir(), pages: ["home", "saved", "content:curso-x", "lesson:*"], delaySeconds: 600 }),
    config({ exclude: ["lesson:curso-x"], frequency: repetir({ maxPerDay: 10 }), pages: ["lesson:*"], trigger: "lesson_completed" })
  ];

  for (const settings of configs) {
    amostras.push(frases.describePopupPlacement(settings, nomes), frases.describePopupFrequencyLive(settings, true), frases.describePopupPlacementShort(settings) ?? "");
    amostras.push(...Object.values(frases.popupReviewParts(settings, nomes)).filter(Boolean));
    amostras.push(...frases.popupSettingsLines(settings, nomes).map((line) => `${line.label} ${line.value}`));
    amostras.push(...frases.popupFrequencyNotes({ endsAt: null, frequency: settings.frequency, trigger: settings.trigger }).map((note) => note.text));
    amostras.push(frases.popupSnoozeNote({ allowSnooze: true, frequency: settings.frequency, snoozeMinutes: 10_080 }) ?? "");
    amostras.push(frases.opensOnLessonNote(settings, ["curso-x"], nomes) ?? "");
  }

  for (const texto of amostras) {
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
});
