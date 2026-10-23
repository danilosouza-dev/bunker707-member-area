import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Frases da equipe, v3b-2 (docs/29 §6.3; spec §7.3 R; critica 17): cada frase com ramo por momento ganha "No
// primeiro acesso" (como "Ao abrir a página", com quem conta como aluno novo) e "Ao concluir um curso" (como
// "Ao concluir uma aula", com os cursos), palavra por palavra: a frase ao vivo, a revisao com "para quem", a
// segunda linha da lista, "Detalhes", "Quantas vezes" (revisao, frase ao vivo e avisos) e a nota do curso que
// abre direto na aula. O pop-up padrao continua com a frase de antes. Produto sem nome (removido do catalogo)
// fica "um produto", como nas outras frases deste modulo desde a v3b-1.

const frases = await import("../src/server/communications/popup-sentences.ts");
const model = await import("../src/server/communications/popup-display-model.ts");
const campaign = await import("../src/server/communications/campaign-model.ts");
const editor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");

const nomes = { "curso-x": "Curso X", "curso-y": "Curso Y", "formacao-ia": "Formação IA" };
const config = (extra = {}) => ({ ...model.POPUP_SETTINGS_DEFAULT, ...extra });
const primeiro = (extra = {}) => config({ accessProducts: [], trigger: "first_login", ...extra });
const curso = (extra = {}) => config({ pages: ["lesson:*"], trigger: "course_completed", ...extra });
const repetir = (extra = {}) => ({ everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click", ...extra });
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];

function semPalavrasProibidas(texto) {
  for (const palavra of PROIBIDAS) {
    assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
  }
}

function revisao(settings, extra = {}) {
  return campaign.describeNoticeReview({
    audienceCount: 318,
    kind: "popup",
    popup: frases.popupReviewParts(settings, nomes),
    repeat: model.repeatOfFrequency(settings.frequency),
    schedule: { mode: "now" },
    window: { endsAt: null, startsAt: null },
    ...extra
  });
}

/* ------------------------------------------------------------------------------------------------
 * Frase ao vivo do card "Quando e onde aparece"
 * ---------------------------------------------------------------------------------------------- */

test("frase ao vivo: No primeiro acesso (a área ou os produtos) e Ao concluir um curso", () => {
  assert.equal(frases.describePopupPlacement(primeiro({ pages: ["home"] }), nomes), "Aparece na primeira vez que o aluno entra na área, no Início.");
  assert.equal(
    frases.describePopupPlacement(primeiro({ accessProducts: ["formacao-ia"], exclude: ["profile"], pages: ["any"] }), nomes),
    "Aparece na primeira vez depois de ganhar acesso a Formação IA, em qualquer página, menos Perfil."
  );
  assert.equal(
    frases.describePopupPlacement(primeiro({ accessProducts: ["curso-x", "formacao-ia"], pages: ["home"] }), nomes),
    "Aparece na primeira vez depois de ganhar acesso a 2 produtos, no Início."
  );
  assert.equal(
    frases.describePopupPlacement(primeiro({ accessProducts: ["saiu-do-catalogo"], pages: ["saved"] }), nomes),
    "Aparece na primeira vez depois de ganhar acesso a um produto, em Favoritos.",
    "produto removido"
  );
  assert.equal(
    frases.describePopupPlacement(config({ accessProducts: ["formacao-ia"], pages: ["home"] }), nomes),
    "Aparece no Início.",
    "produtos fora do primeiro acesso nao entram na frase"
  );

  assert.equal(frases.describePopupPlacement(curso(), nomes), "Aparece ao concluir um curso.");
  assert.equal(frases.describePopupPlacement(curso({ pages: ["lesson:formacao-ia"] }), nomes), "Aparece ao concluir um curso de Formação IA.");
  assert.equal(frases.describePopupPlacement(curso({ pages: ["lesson:curso-x", "lesson:curso-y"] }), nomes), "Aparece ao concluir um curso de 2 produtos.");
  assert.equal(frases.describePopupPlacement(curso({ pages: ["lesson:saiu"] }), nomes), "Aparece ao concluir um curso de um produto.", "produto removido");
  assert.equal(frases.describePopupPlacement(curso({ exclude: ["lesson:curso-x"] }), nomes), "Aparece ao concluir um curso, menos os cursos de Curso X.");
  assert.equal(frases.describePopupPlacement(curso({ exclude: ["lesson:curso-x", "lesson:curso-y"] }), nomes), "Aparece ao concluir um curso, menos os cursos de 2 produtos.");

  // Os momentos de antes, como estavam.
  assert.equal(frases.describePopupPlacement(config({ pages: ["lesson:*"], trigger: "lesson_completed" }), nomes), "Aparece ao concluir uma aula.");
  assert.equal(frases.describePopupPlacement(config({ exclude: ["profile"], pages: ["any"] }), nomes), "Aparece em qualquer página, menos Perfil.");
});

test("curso que abre direto na aula: a nota vale no primeiro acesso (como Ao abrir a página) e nunca no curso", () => {
  const nota = " (Formação IA abre direto na aula: marque também “Páginas de aula”.)";

  assert.equal(frases.opensOnLessonNote(primeiro({ pages: ["content:formacao-ia"] }), ["formacao-ia"], nomes), nota);
  assert.equal(frases.opensOnLessonNote(config({ pages: ["content:formacao-ia"] }), ["formacao-ia"], nomes), nota);
  assert.equal(frases.opensOnLessonNote(curso(), ["formacao-ia"], nomes), null);
  assert.equal(frases.opensOnLessonNote(config({ pages: ["lesson:*"], trigger: "lesson_completed" }), ["formacao-ia"], nomes), null);
});

/* ------------------------------------------------------------------------------------------------
 * Revisao com "para quem"
 * ---------------------------------------------------------------------------------------------- */

test("revisão: No primeiro acesso começa por quem entra pela primeira vez, com a contagem do segmento entre parênteses", () => {
  assert.equal(
    revisao(primeiro({ pages: ["home"] })),
    "Pop-up para quem entrar pela primeira vez (entre 318 alunos do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao(primeiro({ accessProducts: ["formacao-ia"], pages: ["home"] })),
    "Pop-up para quem entrar pela primeira vez depois de ganhar acesso a Formação IA (entre 318 alunos do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao(primeiro({ accessProducts: ["curso-x", "formacao-ia"], delaySeconds: 0, pages: ["any"] })),
    "Pop-up para quem entrar pela primeira vez depois de ganhar acesso a 2 produtos (entre 318 alunos do segmento), em qualquer página, logo ao abrir, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao(primeiro({ pages: ["home"] }), { audienceCount: null }),
    "Pop-up para quem entrar pela primeira vez (entre os alunos do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez.",
    "sem a contagem"
  );
  assert.equal(
    revisao(primeiro({ pages: ["home"] }), { audienceCount: 1 }),
    "Pop-up para quem entrar pela primeira vez (entre 1 aluno do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao(primeiro({ accessProducts: ["saiu"], pages: ["home"] })),
    "Pop-up para quem entrar pela primeira vez depois de ganhar acesso a um produto (entre 318 alunos do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez.",
    "produto removido"
  );
  assert.deepEqual(frases.popupReviewParts(primeiro({ pages: ["home"] }), nomes), {
    audience: "para quem entrar pela primeira vez",
    frequency: "no máximo 1 vez",
    placement: "no Início"
  });
});

test("revisão: Ao concluir um curso (de, menos, e o tempo como na aula); o pop-up padrão com a frase de antes", () => {
  assert.equal(revisao(curso()), "Pop-up para 318 alunos, ao concluir um curso, a partir de agora, sem data para acabar, no máximo 1 vez.");
  assert.equal(
    revisao(curso({ delaySeconds: 0, pages: ["lesson:formacao-ia"] })),
    "Pop-up para 318 alunos, ao concluir um curso de Formação IA, logo depois, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(
    revisao(curso({ delaySeconds: 10, exclude: ["lesson:curso-x"] })),
    "Pop-up para 318 alunos, ao concluir um curso, menos os cursos de Curso X, 10 segundos depois, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
  assert.equal(frases.popupReviewParts(curso({ pages: ["lesson:curso-x", "lesson:curso-y"] }), nomes).placement, "ao concluir um curso de 2 produtos");
  assert.equal(frases.popupReviewParts(curso(), nomes).audience, null);

  // O pop-up padrao (Inicio, ao abrir, 3 s, Uma vez) continua exatamente a frase de antes (docs/25 §2.6).
  assert.equal(
    revisao(config(), { window: { endsAt: "2026-10-22T02:59:00.000Z", startsAt: "2026-10-14T12:00:00.000Z" } }),
    "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez."
  );
  assert.deepEqual(frases.popupReviewParts(config(), nomes), { audience: null, frequency: "no máximo 1 vez", placement: null });
  // "No primeiro acesso" no Início nunca e o padrao (isDefaultPlacement exige "Ao abrir a página").
  assert.notEqual(frases.popupReviewParts(primeiro({ pages: ["home"] }), nomes).placement, null);
  // Sem `audience` (um chamador de antes), a frase de sempre.
  assert.equal(
    campaign.describeNoticeReview({ audienceCount: 318, kind: "popup", popup: { frequency: "no máximo 1 vez", placement: "no Início" }, repeat: "once", schedule: { mode: "now" }, window: { endsAt: null, startsAt: null } }),
    "Pop-up para 318 alunos, no Início, a partir de agora, sem data para acabar, no máximo 1 vez."
  );
});

/* ------------------------------------------------------------------------------------------------
 * Lista e "Detalhes"
 * ---------------------------------------------------------------------------------------------- */

test("segunda linha da lista: No primeiro acesso e Ao concluir um curso (com exceções)", () => {
  assert.equal(frases.describePopupPlacementShort(primeiro({ pages: ["home"] })), "No primeiro acesso");
  assert.equal(frases.describePopupPlacementShort(primeiro({ exclude: ["profile"], pages: ["any"] })), "No primeiro acesso (com exceções)");
  assert.equal(frases.describePopupPlacementShort(curso()), "Ao concluir um curso");
  assert.equal(frases.describePopupPlacementShort(curso({ exclude: ["lesson:curso-x"] })), "Ao concluir um curso (com exceções)");
  assert.equal(frases.describePopupPlacementShort(config()), null, "o padrao continua sem linha");
});

test("Detalhes: Quando aparece e Onde nos dois momentos novos, com nomes e com produto removido", () => {
  const linhas = (settings) => Object.fromEntries(frases.popupSettingsLines(settings, nomes).map((line) => [line.label, line.value]));

  assert.deepEqual(linhas(primeiro({ pages: ["home"] })), {
    "Como fecha": "No X, no Esc ou clicando fora",
    Onde: "No Início",
    "Quando aparece": "No primeiro acesso à área, 3 segundos depois",
    "Quantas vezes": "No máximo 1 vez"
  });
  assert.equal(linhas(primeiro({ accessProducts: ["formacao-ia"], delaySeconds: 0, pages: ["home"] }))["Quando aparece"], "No primeiro acesso a Formação IA, logo");
  assert.equal(linhas(primeiro({ accessProducts: ["curso-x", "formacao-ia"], delaySeconds: 10, pages: ["home"] }))["Quando aparece"], "No primeiro acesso a 2 produtos, 10 segundos depois");
  assert.equal(linhas(primeiro({ accessProducts: ["saiu"], delaySeconds: 0, pages: ["home"] }))["Quando aparece"], "No primeiro acesso a um produto, logo", "produto removido");
  assert.equal(linhas(primeiro({ exclude: ["profile"], pages: ["any"] })).Onde, "Em qualquer página, menos Perfil", "Onde como Ao abrir a página");

  assert.equal(linhas(curso())["Quando aparece"], "Ao concluir um curso, 3 segundos depois");
  assert.equal(linhas(curso({ delaySeconds: 0 }))["Quando aparece"], "Ao concluir um curso, logo depois");
  assert.equal(linhas(curso({ exclude: ["lesson:curso-x"] })).Onde, "Em qualquer aula, menos as aulas de Curso X", "Onde como Ao concluir uma aula");
  assert.equal(linhas(curso({ pages: ["lesson:formacao-ia"] })).Onde, "Nas aulas de Formação IA");
});

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes (critica 17: o curso nunca cai no texto da pagina nem no da aula)
 * ---------------------------------------------------------------------------------------------- */

test("Quantas vezes do curso, palavra por palavra (revisão, frase ao vivo, avisos e a descrição do intervalo)", () => {
  const semRitmo = repetir();

  assert.equal(frases.describePopupFrequency(semRitmo, "course_completed"), "toda vez que o aluno concluir um curso, até o aluno clicar");
  assert.equal(
    frases.describePopupFrequencyLive(curso({ frequency: semRitmo }), false),
    "Cada aluno vê toda vez que concluir um curso, até clicar no botão. Fecha no X, no Esc ou clicando fora."
  );
  assert.equal(
    frases.describePopupFrequencyLive(curso({ frequency: repetir({ everyMinutes: 120 }) }), false),
    "Cada aluno vê com pelo menos 2 horas entre uma vez e outra (no próximo curso concluído depois desse tempo), até clicar no botão. Fecha no X, no Esc ou clicando fora."
  );
  assert.deepEqual(frases.popupFrequencyNotes({ endsAt: "2026-11-01T00:00:00.000Z", frequency: semRitmo, trigger: "course_completed" }), [
    {
      text: "Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno concluir um curso, até ele clicar no botão.",
      tone: "warning"
    }
  ]);
  assert.deepEqual(frases.popupFrequencyNotes({ endsAt: "2026-11-01T00:00:00.000Z", frequency: repetir({ stopOn: "never" }), trigger: "course_completed" }), [
    {
      text: "Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno concluir um curso, até o pop-up terminar.",
      tone: "warning"
    }
  ]);
  assert.deepEqual(frases.popupFrequencyNotes({ endsAt: null, frequency: repetir({ maxPerDay: 3 }), trigger: "course_completed" })[0], {
    text: "Sem tempo entre uma vez e outra, as 3 vezes do dia podem acontecer seguidas, uma a cada curso concluído. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”.",
    tone: "info"
  });
  assert.equal(editor.POPUP_EDITOR_COPY.frequency.intervalDescription.course_completed, "Depois desse tempo, ele volta no próximo curso concluído.");
});

test("Quantas vezes do primeiro acesso: como Ao abrir a página; a aula continua com o texto dela", () => {
  const semRitmo = repetir();

  for (const trigger of ["first_login", "page_load"]) {
    assert.equal(frases.describePopupFrequency(semRitmo, trigger), "toda vez que o aluno abrir uma das páginas, até o aluno clicar", trigger);
    assert.equal(
      frases.describePopupFrequencyLive(config({ frequency: repetir({ everyMinutes: 60 }), trigger }), false),
      "Cada aluno vê com pelo menos 1 hora entre uma vez e outra (na próxima página que abrir depois desse tempo), até clicar no botão. Fecha no X, no Esc ou clicando fora.",
      trigger
    );
    assert.equal(
      frases.describePopupFrequencyLive(config({ frequency: semRitmo, trigger }), false),
      "Cada aluno vê toda vez que abrir uma das páginas, até clicar no botão. Fecha no X, no Esc ou clicando fora.",
      trigger
    );
    assert.equal(
      frases.popupFrequencyNotes({ endsAt: "2026-11-01T00:00:00.000Z", frequency: semRitmo, trigger })[0].text,
      "Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno abrir uma das páginas escolhidas, até ele clicar no botão.",
      trigger
    );
    assert.equal(
      frases.popupFrequencyNotes({ endsAt: null, frequency: repetir({ maxPerDay: 2 }), trigger })[0].text,
      "Sem tempo entre uma vez e outra, as 2 vezes do dia podem acontecer seguidas, uma em cada página que o aluno abrir. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”.",
      trigger
    );
  }

  assert.equal(editor.POPUP_EDITOR_COPY.frequency.intervalDescription.first_login, editor.POPUP_EDITOR_COPY.frequency.intervalDescription.page_load);
  assert.equal(frases.describePopupFrequency(semRitmo, "lesson_completed"), "toda vez que o aluno concluir uma aula, até o aluno clicar");
  assert.equal(
    frases.popupFrequencyNotes({ endsAt: null, frequency: repetir({ maxPerDay: 2 }), trigger: "lesson_completed" })[0].text,
    "Sem tempo entre uma vez e outra, as 2 vezes do dia podem acontecer seguidas, uma a cada aula concluída. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”."
  );
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario
 * ---------------------------------------------------------------------------------------------- */

test("vocabulário: as frases novas (nada de home, trigger ou nome interno)", () => {
  const textos = [
    frases.describePopupPlacement(primeiro({ pages: ["home"] }), nomes),
    frases.describePopupPlacement(primeiro({ accessProducts: ["formacao-ia"], exclude: ["profile"], pages: ["any"] }), nomes),
    frases.describePopupPlacement(curso({ exclude: ["lesson:curso-x"] }), nomes),
    revisao(primeiro({ accessProducts: ["formacao-ia"], pages: ["home"] })),
    revisao(curso({ delaySeconds: 0 })),
    frases.describePopupPlacementShort(primeiro({ pages: ["home"] })),
    frases.describePopupPlacementShort(curso()),
    ...frases.popupSettingsLines(primeiro({ accessProducts: ["formacao-ia"], pages: ["home"] }), nomes).map((line) => line.value),
    ...frases.popupSettingsLines(curso(), nomes).map((line) => line.value),
    frases.describePopupFrequencyLive(curso({ frequency: repetir({ everyMinutes: 120 }) }), true),
    ...frases.popupFrequencyNotes({ endsAt: null, frequency: repetir({ maxPerDay: 3 }), trigger: "course_completed" }).map((note) => note.text)
  ];

  for (const texto of textos) {
    semPalavrasProibidas(texto);
    assert.doesNotMatch(texto, /first_login|course_completed|lesson_completed|page_load/);
  }
});
