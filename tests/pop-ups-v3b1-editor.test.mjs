import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Editor do pop-up no admin (v3b-1, docs/25 §2.1–§2.8): as pecas puras dos cards "Quando e onde aparece" e
// "Quantas vezes e como fecha" (popup-editor-model.ts: a escolha de "Onde aparece", a lista de paginas <->
// padroes nas paginas e nas excecoes, a troca do momento, o comeco de "Mais de uma vez", os tempos em
// minutos, horas ou dias), os blocos do pop-up em notices-view-model.ts (o rascunho por tipo, a forma
// canonica, os textos que deixaram de falar da "home", "Mostrar de novo" em qualquer "Quantas vezes", os
// toasts com o "até 1 minuto" e as linhas do pop-up no ar), o foco de cada erro do §2.5 (FIELD_FOCUS do
// editor) e o vocabulario fechado da equipe. Tudo carregado direto pelo Node.

const editor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const display = await import("../src/server/communications/popup-display-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");

const NOW = Date.parse("2026-10-22T12:00:00.000Z"); // 09:00 em Sao Paulo
const CTA = { display: "button", href: "/conteudo/formacao-ia", label: "Ver a turma", target: "same_tab" };
const config = (extra = {}) => ({ ...display.POPUP_SETTINGS_DEFAULT, exclude: [], pages: ["home"], ...extra });
const repetir = (extra = {}) => ({ everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click", ...extra });
const popupDraft = (extra = {}) => ({ ...schemas.emptyNoticeDraft("popup"), body: "As inscrições abriram.", cta: CTA, title: "Turma nova", ...extra });
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];

function semPalavrasProibidas(texto) {
  for (const palavra of PROIBIDAS) {
    assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Onde aparece e a lista de paginas
 * ---------------------------------------------------------------------------------------------- */

test("Onde aparece: a configuracao gravada reabre em Só no Início, Em qualquer página ou Escolher páginas", () => {
  assert.equal(editor.placementChoiceOf({ pages: ["home"] }), "home");
  assert.equal(editor.placementChoiceOf({ pages: ["any"] }), "any");
  assert.equal(editor.placementChoiceOf({ pages: ["home", "profile"] }), "pages");
  assert.equal(editor.placementChoiceOf({ pages: ["lesson:*"] }), "pages");
  assert.equal(editor.placementChoiceOf({ pages: [] }), "pages", "lista vazia: Escolher páginas (o erro pede uma)");
  assert.deepEqual(
    editor.POPUP_PLACEMENT_OPTIONS.map((option) => option.label),
    ["Só no Início", "Em qualquer página", "Escolher páginas"]
  );

  // Cada escolha grava as suas paginas; sem lugar para excecoes, elas saem.
  const qualquer = config({ exclude: ["profile", "support"], pages: ["any"] });
  assert.deepEqual(editor.settingsForPlacementChoice(qualquer, "home"), config({ pages: ["home"] }), "Só no Início leva as excecoes embora");
  assert.deepEqual(editor.settingsForPlacementChoice(config(), "any").pages, ["any"]);
  assert.deepEqual(editor.settingsForPlacementChoice(qualquer, "pages").pages, ["home"], "de qualquer pagina para a lista: comeca no Inicio");
  assert.deepEqual(editor.settingsForPlacementChoice(config({ pages: ["saved", "home"] }), "pages").pages, ["saved", "home"], "a lista fica como estava");
});

test("lista de paginas <-> padroes: Inicio, produto e aula (qualquer ou escolhidos) e as paginas fixas na ordem do menu", () => {
  const padroes = ["lesson:curso-b", "profile", "home", "content:curso-a", "content:curso-c"];
  const lista = editor.checklistOf(padroes);

  assert.deepEqual(lista, {
    content: { checked: true, mode: "some", products: ["curso-a", "curso-c"] },
    fixed: ["home", "profile"],
    lesson: { checked: true, mode: "some", products: ["curso-b"] }
  });
  assert.deepEqual(editor.patternsOfChecklist(lista), ["home", "profile", "content:curso-a", "content:curso-c", "lesson:curso-b"]);
  assert.deepEqual(editor.checklistOf(editor.patternsOfChecklist(lista)), lista, "ida e volta");

  const curingas = editor.checklistOf(["content:*", "lesson:*", "support"]);
  assert.deepEqual(curingas.content, { checked: true, mode: "any", products: [] });
  assert.deepEqual(curingas.lesson, { checked: true, mode: "any", products: [] });
  assert.deepEqual(editor.patternsOfChecklist(curingas), ["support", "content:*", "lesson:*"]);
  assert.deepEqual(editor.checklistOf(["any"]).fixed, [], "Em qualquer página fica fora da lista");
  assert.deepEqual(editor.POPUP_FIXED_PAGES, ["home", "purchases", "saved", "materials", "journey", "continue", "profile", "support"]);

  // Paginas fixas: marcar e desmarcar mantem a ordem do menu.
  let marcada = editor.checklistOf([]);
  marcada = editor.toggleChecklistPage(marcada, "support", true);
  marcada = editor.toggleChecklistPage(marcada, "home", true);
  marcada = editor.toggleChecklistPage(marcada, "saved", true);
  assert.deepEqual(marcada.fixed, ["home", "saved", "support"]);
  assert.deepEqual(editor.toggleChecklistPage(marcada, "saved", false).fixed, ["home", "support"]);
});

test("linha de produto: nas paginas comeca em Qualquer; nas excecoes, direto no seletor; sem produto, so o editor sabe", () => {
  const vazia = editor.checklistOf([]);

  // Paginas: marcar "Página do produto" = qualquer produto.
  const qualquer = editor.toggleChecklistLine(vazia, "content", true, "pages");
  assert.deepEqual(qualquer.content, { checked: true, mode: "any", products: [] });
  assert.deepEqual(editor.patternsOfChecklist(qualquer), ["content:*"]);

  // "Só estes produtos" sem produto: nenhum padrao, a linha fica esperando ("Escolha pelo menos um produto.").
  const esperando = editor.checklistLineMode(qualquer, "content", "some");
  assert.deepEqual(editor.patternsOfChecklist(esperando), []);
  assert.deepEqual(editor.pendingOfChecklist(esperando), { content: true, lesson: false });
  assert.equal(editor.checklistProblem(esperando), "Escolha pelo menos um produto.");
  assert.equal(editor.CHOOSE_PRODUCT_MESSAGE, "Escolha pelo menos um produto.");
  assert.deepEqual(editor.checklistOf([], { content: true, lesson: false }).content, { checked: true, mode: "some", products: [] }, "a linha volta marcada pelo pendente");

  const escolhidos = editor.checklistLineProducts(esperando, "content", ["curso-a", "curso-a", "curso-b"]);
  assert.deepEqual(escolhidos.content.products, ["curso-a", "curso-b"], "sem repetir");
  assert.deepEqual(editor.patternsOfChecklist(escolhidos), ["content:curso-a", "content:curso-b"]);
  assert.equal(editor.checklistProblem(escolhidos), null);
  assert.deepEqual(editor.checklistLineMode(escolhidos, "content", "any").content, { checked: true, mode: "any", products: [] }, "Qualquer produto limpa a escolha");
  assert.deepEqual(editor.toggleChecklistLine(escolhidos, "content", false, "pages").content, { checked: false, mode: "any", products: [] });

  // Excecoes: a linha marcada ja pede produtos (sem "Qualquer").
  const excecao = editor.toggleChecklistLine(vazia, "lesson", true, "exclude");
  assert.deepEqual(excecao.lesson, { checked: true, mode: "some", products: [] });
  assert.equal(editor.checklistProblem(excecao), "Escolha pelo menos um produto.");
  const excecoes = editor.toggleChecklistPage(editor.checklistLineProducts(excecao, "lesson", ["curso-x"]), "profile", true);
  assert.deepEqual(editor.patternsOfChecklist(excecoes), ["profile", "lesson:curso-x"]);
  assert.deepEqual(editor.checklistOf(["profile", "lesson:curso-x"]), excecoes, "ida e volta nas excecoes");
});

test("Nunca nestas páginas: so com Em qualquer página ou com Qualquer produto / Qualquer aula (ao concluir: De qualquer produto)", () => {
  assert.equal(editor.canExclude(config({ pages: ["any"] })), true);
  assert.equal(editor.canExclude(config({ pages: ["home", "content:*"] })), true);
  assert.equal(editor.canExclude(config({ pages: ["lesson:*"] })), true);
  assert.equal(editor.canExclude(config({ pages: ["home"] })), false, "Só no Início");
  assert.equal(editor.canExclude(config({ pages: ["home", "content:curso-a"] })), false, "produtos escolhidos");
  assert.equal(editor.canExclude(config({ pages: ["lesson:*"], trigger: "lesson_completed" })), true);
  assert.equal(editor.canExclude(config({ pages: ["lesson:curso-a"], trigger: "lesson_completed" })), false);

  // Sem lugar para elas, as excecoes saem (e a chave desliga sem nada esperando produto).
  assert.deepEqual(editor.tidyPopupPlacement(config({ exclude: ["profile"], pages: ["home"] })).exclude, []);
  const comLugar = config({ exclude: ["profile"], pages: ["any"] });
  assert.equal(editor.tidyPopupPlacement(comLugar), comLugar, "com lugar, nada muda");

  const ui = { choice: "any", exceptions: true, pending: { exclude: { content: true, lesson: false }, pages: editor.NO_PENDING_LINES } };
  assert.deepEqual(editor.syncPlacementUi(ui, config({ pages: ["home"] })), { ...ui, exceptions: false, pending: { ...ui.pending, exclude: editor.NO_PENDING_LINES } });
  assert.equal(editor.syncPlacementUi(ui, comLugar), ui);
  assert.deepEqual(editor.placementUiOf(comLugar), { choice: "any", exceptions: true, pending: { exclude: editor.NO_PENDING_LINES, pages: editor.NO_PENDING_LINES } });
  assert.equal(editor.placementUiOf(config()).exceptions, false);
});

test("erros so do editor: linha de produto sem produto nas paginas (popup.pages) e nas excecoes (popup.exclude)", () => {
  const ui = (extra = {}) => ({ choice: "pages", exceptions: false, pending: { exclude: editor.NO_PENDING_LINES, pages: editor.NO_PENDING_LINES }, ...extra });

  assert.deepEqual(editor.popupPlacementProblems(config(), ui()), {});
  assert.deepEqual(editor.popupPlacementProblems(config(), ui({ pending: { exclude: editor.NO_PENDING_LINES, pages: { content: true, lesson: false } } })), {
    "popup.pages": "Escolha pelo menos um produto."
  });
  assert.deepEqual(
    editor.popupPlacementProblems(config(), ui({ choice: "home", pending: { exclude: editor.NO_PENDING_LINES, pages: { content: true, lesson: false } } })),
    {},
    "Só no Início nao mostra a lista"
  );
  assert.deepEqual(
    editor.popupPlacementProblems(config({ pages: ["any"] }), ui({ choice: "any", exceptions: true, pending: { exclude: { content: false, lesson: true }, pages: editor.NO_PENDING_LINES } })),
    { "popup.exclude": "Escolha pelo menos um produto." }
  );
  assert.deepEqual(
    editor.popupPlacementProblems(config({ pages: [], trigger: "lesson_completed" }), ui({ choice: "home", pending: { exclude: editor.NO_PENDING_LINES, pages: { content: false, lesson: true } } })),
    { "popup.pages": "Escolha pelo menos um produto." },
    "Só de aulas destes produtos sem produto"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Quando aparece, de quais aulas e quanto tempo depois
 * ---------------------------------------------------------------------------------------------- */

test("trocar o momento: ao concluir ficam so as aulas (nenhuma -> qualquer aula); de volta, as aulas viram Páginas de aula", () => {
  assert.deepEqual(editor.POPUP_TRIGGER_OPTIONS.map((option) => option.label), ["Ao abrir a página", "Ao concluir uma aula"]);

  const qualquer = config({ delaySeconds: 30, exclude: ["profile", "lesson:curso-x"], pages: ["any"] });
  const concluir = editor.settingsForTrigger(qualquer, "lesson_completed");
  assert.deepEqual(concluir, config({ delaySeconds: 30, exclude: ["lesson:curso-x"], pages: ["lesson:*"], trigger: "lesson_completed" }), "Quanto tempo depois nao muda");

  assert.deepEqual(
    editor.settingsForTrigger(config({ pages: ["home", "content:curso-a", "lesson:curso-a", "lesson:curso-b"] }), "lesson_completed").pages,
    ["lesson:curso-a", "lesson:curso-b"]
  );
  assert.deepEqual(editor.settingsForTrigger(config({ exclude: ["profile"], pages: ["home"] }), "lesson_completed").exclude, []);

  const volta = editor.settingsForTrigger(concluir, "page_load");
  assert.deepEqual(volta, config({ delaySeconds: 30, exclude: ["lesson:curso-x"], pages: ["lesson:*"] }));
  assert.equal(editor.placementChoiceOf(volta), "pages");
  assert.deepEqual(editor.checklistOf(volta.pages).lesson, { checked: true, mode: "any", products: [] }, "Páginas de aula: Qualquer aula");

  const algumas = editor.settingsForTrigger(config({ pages: ["lesson:curso-a"], trigger: "lesson_completed" }), "page_load");
  assert.deepEqual(editor.checklistOf(algumas.pages).lesson, { checked: true, mode: "some", products: ["curso-a"] });
  assert.equal(editor.settingsForTrigger(qualquer, "page_load"), qualquer, "o mesmo momento nao muda nada");
});

test("De quais aulas e Quanto tempo depois", () => {
  assert.deepEqual(editor.POPUP_LESSON_SCOPE_OPTIONS.map((option) => option.label), ["De qualquer produto", "Só de aulas destes produtos"]);
  assert.equal(editor.lessonScopeOf({ pages: ["lesson:*"] }), "any");
  assert.equal(editor.lessonScopeOf({ pages: ["lesson:curso-a"] }), "some");
  assert.equal(editor.lessonScopeOf({ pages: [] }), "some");

  assert.deepEqual(editor.POPUP_DELAY_OPTIONS.map((option) => option.label), ["Logo", "3 s", "10 s", "30 s", "1 min", "Outro"]);
  assert.deepEqual([0, 3, 10, 30, 60, 5, 600, Number.NaN].map(editor.delayChoiceOf), ["0", "3", "10", "30", "60", "other", "other", "other"]);
});

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes e como fecha
 * ---------------------------------------------------------------------------------------------- */

test("Mais de uma vez comeca em 1 por dia, até clicar; sem botao, Só quando o pop-up terminar; os ultimos valores voltam", () => {
  assert.deepEqual(editor.POPUP_FREQUENCY_OPTIONS.map((option) => option.label), ["Uma vez", "Mais de uma vez"]);
  assert.deepEqual(editor.POPUP_STOP_OPTIONS.map((option) => option.label), ["Quando o aluno clica no botão", "Só quando o pop-up terminar"]);
  assert.deepEqual(editor.POPUP_CLOSE_OPTIONS.map((option) => option.label), ["No X ou clicando fora", "Só no X"]);

  assert.deepEqual(editor.repeatStartOf({ cta: CTA }), repetir({ maxPerDay: 1 }));
  assert.deepEqual(editor.repeatStartOf({ cta: null }), repetir({ maxPerDay: 1, stopOn: "never" }));
  assert.equal(editor.clickStopDisabled({ cta: null }), true, "sem botao, a pilula do clique fica desligada");
  assert.equal(editor.clickStopDisabled({ cta: CTA }), false);

  const lembrado = repetir({ everyMinutes: 120, maxPerDay: 3, maxTotal: 9 });
  assert.deepEqual(editor.repeatStartOf({ cta: CTA }, lembrado), lembrado, "ir e voltar traz os valores desta tela");
  assert.deepEqual(editor.repeatStartOf({ cta: null }, lembrado), { ...lembrado, stopOn: "never" }, "sem botao o clique nao volta");
  assert.deepEqual(editor.POPUP_REPEAT_DEFAULTS, { everyMinutes: 1_440, maxPerDay: 1, maxTotal: 10 }, "ligar: 1 por dia, 1 dia, 10 no total");

  // A mudanca passa por popupFrequencyPatch: frequency e repeat juntos.
  const draft = popupDraft();
  assert.deepEqual(display.popupFrequencyPatch(draft, editor.repeatStartOf(draft)), {
    popup: { ...draft.popup, frequency: repetir({ maxPerDay: 1 }) },
    repeat: "until_action"
  });
});

test("tempos em minutos, horas ou dias: reabrem na maior unidade exata (intervalo e Volta em)", () => {
  assert.deepEqual(editor.minutesToParts(1_440), { amount: 1, unit: "days" });
  assert.deepEqual(editor.minutesToParts(10_080), { amount: 7, unit: "days" });
  assert.deepEqual(editor.minutesToParts(120), { amount: 2, unit: "hours" });
  assert.deepEqual(editor.minutesToParts(90), { amount: 90, unit: "minutes" });
  assert.deepEqual(editor.minutesToParts(5), { amount: 5, unit: "minutes" });
  assert.equal(Number.isNaN(editor.minutesToParts(Number.NaN).amount), true);

  assert.equal(editor.partsToMinutes(1, "days"), 1_440);
  assert.equal(editor.partsToMinutes(2, "hours"), 120);
  assert.equal(editor.partsToMinutes(30, "minutes"), 30);
  assert.equal(Number.isNaN(editor.partsToMinutes(Number.NaN, "hours")), true, "campo vazio fica invalido (o zod diz o limite)");
  for (const minutes of [1, 59, 60, 90, 1_440, 2_880, 129_600]) {
    const parts = editor.minutesToParts(minutes);
    assert.equal(editor.partsToMinutes(parts.amount, parts.unit), minutes, `ida e volta de ${minutes}`);
  }
  assert.deepEqual(editor.POPUP_MINUTE_UNIT_OPTIONS.map((option) => option.label), ["minutos", "horas", "dias"]);

  assert.equal(editor.snoozeSwitchDescription(1_440), "Volta em 1 dia, até 2 vezes.");
  assert.equal(editor.snoozeSwitchDescription(30), "Volta em 30 minutos, até 2 vezes.");
  assert.equal(editor.snoozeSwitchDescription(120), "Volta em 2 horas, até 2 vezes.");
  assert.equal(editor.snoozeSwitchDescription(Number.NaN), "Volta no tempo de “Volta em”, até 2 vezes.");
});

test("textos dos dois cards (docs/25 §2.2–§2.4)", () => {
  const { frequency, placement } = editor.POPUP_EDITOR_COPY;

  assert.equal(placement.title, "Quando e onde aparece");
  assert.equal(placement.description, "Em que momento e em quais páginas o pop-up abre.");
  assert.equal(frequency.title, "Quantas vezes e como fecha");
  assert.equal(frequency.description, "Para cada aluno: quantas vezes aparece, o que faz parar e como ele fecha.");
  assert.equal(placement.whereHint.any, "Em todas as páginas da área do aluno, também nas aulas (só antes do play). Nunca no login nem no Modo TV.");
  assert.equal(placement.exceptionsLabel, "Nunca mostrar em algumas páginas");
  assert.equal(placement.exceptionsLegend, "Nunca nestas páginas");
  assert.equal(placement.startsAtHint, "A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up.");
  assert.equal(
    placement.note,
    "Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo do nosso player tocando; nos vídeos do Bunny, do Vimeo e do Mux, só antes do play (no computador) ou depois do Concluir."
  );
  assert.equal(frequency.onceHint, "Aparece uma vez para cada aluno e para quando ele fecha, clica no botão ou escolhe “Não mostrar de novo”. Cada “Lembrar depois” vale mais uma vez.");
  assert.equal(frequency.stopNoButton, "Este pop-up não tem botão. Ligue “Levar o aluno a algum lugar” ou escolha outra opção.");
  assert.equal(frequency.dismissLine, "“Não mostrar de novo” sempre vale: quem escolhe não vê mais este pop-up.");
  assert.equal(frequency.closeHint.x_only, "Clicar fora não fecha. O Esc continua fechando, para quem usa teclado ou leitor de tela.");
});

test("o pop-up do rascunho: a chave popup vence; sem ela, o padrao com Quantas vezes vindo de repeat", () => {
  const proprio = config({ frequency: repetir({ maxPerDay: 3 }), pages: ["any"] });
  assert.equal(editor.popupSettingsOfDraft({ popup: proprio, repeat: "until_action" }), proprio);
  assert.deepEqual(editor.popupSettingsOfDraft({ repeat: "once" }), config());
  assert.deepEqual(editor.popupSettingsOfDraft({ repeat: "until_action" }), config({ frequency: display.POPUP_UNTIL_CLICK_V1 }), "Até o aluno clicar da v1/v3a");
});

/* ------------------------------------------------------------------------------------------------
 * notices-view-model: rascunho por tipo e forma canonica
 * ---------------------------------------------------------------------------------------------- */

test("rascunho por tipo: o pop-up leva popup e repeat coerentes; a notificacao vai sem a chave", () => {
  const popup = model.noticeDraftForKind(popupDraft({ popup: config({ frequency: repetir({ maxPerDay: 2 }) }), repeat: "once" }));
  assert.deepEqual(popup.popup, config({ frequency: repetir({ maxPerDay: 2 }) }));
  assert.equal(popup.repeat, "until_action", "repeat segue o Quantas vezes");

  // Comecou como notificacao (sem a chave): o padrao.
  const inbox = { ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Aviso" };
  const virouPopup = model.noticeDraftForKind({ ...inbox, kind: "popup" });
  assert.deepEqual(virouPopup.popup, config());
  assert.equal(virouPopup.repeat, "once");

  const notificacao = model.noticeDraftForKind({ ...inbox, popup: config({ pages: ["any"] }) });
  assert.equal("popup" in notificacao, false, "notificacao nunca leva popup");
  assert.equal(schemas.noticeDraftSchema.safeParse(notificacao).success, true);
  assert.equal(schemas.noticeDraftSchema.safeParse(popup).success, true);
});

test("forma canonica: padroes em ordem, notificacao sem popup, mudanca no pop-up conta como nao salva", () => {
  const a = popupDraft({ popup: config({ exclude: ["support", "profile"], pages: ["any"] }) });
  const b = popupDraft({ popup: config({ exclude: ["profile", "support", "profile"], pages: ["any"] }) });

  assert.equal(model.isSameNoticeDraft(a, b), true, "ordem e repeticao dos padroes nao importam");
  assert.deepEqual(model.canonicalNoticeDraft(a).popup.exclude, ["profile", "support"]);
  assert.equal(model.isSameNoticeDraft(a, popupDraft({ popup: config({ exclude: ["profile"], pages: ["any"] }) })), false);
  assert.equal(model.isSameNoticeDraft(popupDraft(), popupDraft({ popup: config({ close: "x_only" }) })), false, "Como fechar e uma mudanca");
  assert.equal(model.isSameNoticeDraft(popupDraft(), popupDraft({ popup: config({ snoozeMinutes: 30 }) })), false, "Volta em e uma mudanca");
  assert.equal(model.isSameNoticeDraft(popupDraft(), { ...popupDraft(), popup: undefined }), true, "sem a chave = o padrao");

  const inbox = { ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Aviso" };
  assert.equal("popup" in model.canonicalNoticeDraft({ ...inbox, popup: config() }), false);
});

test("previa: Só no X leva close (sem a chave = fecha no X, no Esc ou clicando fora)", () => {
  assert.equal(model.draftToPopupItem(popupDraft({ popup: config({ close: "x_only" }) })).close, "x_only");
  assert.equal("close" in model.draftToPopupItem(popupDraft()), false);
  assert.equal("close" in model.draftToPopupItem({ ...popupDraft(), popup: undefined }), false);
});

/* ------------------------------------------------------------------------------------------------
 * Textos que mudam (§2.1), toasts e "Mostrar de novo"
 * ---------------------------------------------------------------------------------------------- */

const notice = (overrides = {}) => ({ audienceCount: 318, kind: "popup", recipients: null, situation: "active", title: "Turma nova", ...overrides });

test("textos do pop-up que deixaram de falar da home (§2.1)", async () => {
  const textos = {
    approve: model.noticeActionConfirm("approve", notice({ situation: "pending_approval" })).description,
    deleteActive: model.noticeActionConfirm("delete", notice()).description,
    deletePaused: model.noticeActionConfirm("delete", notice({ situation: "paused" })).description,
    deleteToast: model.deletedNoticeToast({ kind: "popup", removed: 0, situation: "active" }),
    end: model.noticeActionConfirm("end", notice()).description,
    reshow: model.noticeActionConfirm("reshow", notice()).description
  };

  assert.equal(textos.approve, "O pop-up passa a aparecer para 318 alunos, nas páginas e no momento escolhidos. A contagem é refeita na hora de publicar.");
  assert.equal(textos.end, "O pop-up para de aparecer para todos os alunos agora e não volta. Para mostrar de novo, duplique.");
  assert.equal(textos.deleteActive, "O pop-up para de aparecer para todos os alunos agora e o aviso sai desta lista, com o relatório. Não dá para desfazer.");
  assert.equal(textos.deletePaused, "O pop-up não volta a aparecer e o aviso sai desta lista, com o relatório. Não dá para desfazer.");
  assert.equal(textos.deleteToast, "Pop-up excluído. Ele não aparece mais para os alunos.");
  assert.equal(
    textos.reshow,
    "O pop-up volta a contar como novo para quem já viu: a contagem de “Quantas vezes” começa de novo. Quem escolheu “Não mostrar de novo” continua como está, e quem clicou no botão também (menos nos pop-ups que só param quando terminam)."
  );
  Object.values(textos).forEach(semPalavrasProibidas);

  // As telas (componentes React: conferidos no codigo).
  const fonte = async (arquivo) => readFile(new URL(`../src/components/admin/v2/communication/${arquivo}`, import.meta.url), "utf8");
  const editorTela = await fonte("notice-editor.tsx");
  assert.match(editorTela, /\{ label: "Pop-up", value: "popup" \}/, "a pilula do tipo");
  assert.ok(editorTela.includes("Aparece por cima da página, onde e quando você escolher."));
  assert.ok(editorTela.includes("Uma notificação no sino ou um pop-up, para um segmento."));
  assert.doesNotMatch(editorTela, /Pop-up na home|centro da home|pop-up na home/);

  const lista = await fonte("notices-list-view.tsx");
  assert.ok(lista.includes("Crie uma notificação para o sino ou um pop-up para os alunos."));
  assert.ok(lista.includes("Crie um pop-up para os alunos."));
  assert.doesNotMatch(lista, /para a home/);

  const quando = await fonte("notice-when-fields.tsx");
  assert.doesNotMatch(quando, /aparece só na home|Volta em 24 h/, "a caixa da home e o 24 h fixo sairam");

  const previa = await fonte("notice-preview.tsx");
  assert.match(previa, /mobile: \{ caption: "Celular · 375 px", minHeight: 720, width: 375 \}/);
  assert.match(previa, /popupCloseCaption\(draft\.popup\?\.close \?\? "any"\)/, "a legenda de como fecha");
});

test("toasts: publicar o pop-up no ar, salvar o pop-up no ar (quatro casos com o até 1 minuto) e pausado", () => {
  assert.equal(
    model.publishedNoticeToast({ audienceCount: 318, recipients: null, situation: "active" }, "popup"),
    "Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área."
  );
  assert.equal(model.publishedNoticeToast({ audienceCount: 318, recipients: null, situation: "scheduled" }, "popup"), "Pop-up publicado.", "janela no futuro");
  assert.equal(model.publishedNoticeToast({ audienceCount: 318, recipients: null, situation: "active" }, "inbox"), "Aviso publicado.");

  const minuto = " Para quem já está com a área aberta, pode levar até 1 minuto.";
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once", reshown: 120 }), `Pop-up atualizado. Ele volta a aparecer para 120 alunos que já tinham visto.${minuto}`);
  assert.equal(
    model.savedNoticeToast("popup", "active", { repeat: "until_action", reshown: 120 }),
    `Pop-up atualizado. A contagem de “Quantas vezes” recomeçou para 120 alunos que já tinham visto.${minuto}`
  );
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "until_action", reshown: 1 }), `Pop-up atualizado. A contagem de “Quantas vezes” recomeçou para 1 aluno que já tinha visto.${minuto}`);
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "once" }), `Pop-up atualizado. Quem já viu não vê de novo.${minuto}`);
  assert.equal(model.savedNoticeToast("popup", "active", { repeat: "until_action" }), `Pop-up atualizado. Vale na hora, contando as vezes que cada aluno já viu.${minuto}`);
  assert.equal(model.savedNoticeToast("popup", "paused", { repeat: "until_action" }), "Pop-up salvo. Ele continua pausado.", "pausado: o da v3a, sem o minuto");
  assert.equal(model.savedNoticeToast("popup", "paused", { repeat: "until_action", reshown: 4 }), "Pop-up salvo. Ele continua pausado. Ao retomar, volta a aparecer para quem já tinha visto.");
});

test("Mostrar de novo: em qualquer Quantas vezes, com o texto pelo que faz parar e o toast pelo modo", () => {
  for (const status of ["active", "paused"]) {
    assert.equal(model.showsReshowSwitch({ kind: "popup", status }), true, status);
  }
  assert.equal(model.showsReshowSwitch({ kind: "popup", status: "draft" }), false);
  assert.equal(model.showsReshowSwitch({ kind: "popup", status: "pending_approval" }), false);
  assert.equal(model.showsReshowSwitch({ kind: "inbox", status: "sent" }), false);

  // Uma vez e "Quando o aluno clica no botão": quem clicou fica de fora.
  for (const stopOn of [null, "click"]) {
    assert.deepEqual(model.reshowSwitchCopy(120, stopOn), {
      description: "Para os 120 alunos que já viram e não clicaram: o pop-up volta a contar como novo para eles. Quem clicou no botão ou escolheu “Não mostrar de novo” continua como está.",
      disabled: false
    });
    assert.equal(
      model.reshowSwitchCopy(1, stopOn).description,
      "Para 1 aluno que já viu e não clicou: o pop-up volta a contar como novo para ele. Quem clicou no botão ou escolheu “Não mostrar de novo” continua como está."
    );
    assert.equal(
      model.reshowSwitchCopy(null, stopOn).description,
      "Para quem já viu e não clicou: o pop-up volta a contar como novo. Quem clicou no botão ou escolheu “Não mostrar de novo” continua como está."
    );
    assert.deepEqual(model.reshowSwitchCopy(0, stopOn), {
      description: "Ninguém precisa ver de novo agora: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.",
      disabled: true
    });
  }

  // "Só quando o pop-up terminar": quem clicou tambem recomeca.
  assert.deepEqual(model.reshowSwitchCopy(120, "never"), {
    description: "Para os 120 alunos que já viram: a contagem de “Quantas vezes” recomeça para eles. Quem escolheu “Não mostrar de novo” continua como está.",
    disabled: false
  });
  assert.equal(model.reshowSwitchCopy(1, "never").description, "Para 1 aluno que já viu: a contagem de “Quantas vezes” recomeça para ele. Quem escolheu “Não mostrar de novo” continua como está.");
  assert.equal(model.reshowSwitchCopy(undefined, "never").description, "Para quem já viu: a contagem de “Quantas vezes” recomeça. Quem escolheu “Não mostrar de novo” continua como está.");
  assert.deepEqual(model.reshowSwitchCopy(0, "never"), {
    description: "Ninguém precisa ver de novo agora: quem viu escolheu “Não mostrar de novo” ou ainda vai ver.",
    disabled: true
  });

  assert.equal(model.reshownPopupToast(120, "repeat"), "A contagem de “Quantas vezes” recomeçou para 120 alunos.");
  assert.equal(model.reshownPopupToast(120, "once"), "O pop-up volta a aparecer para 120 alunos.");
  assert.equal(model.reshownPopupToast(120), "O pop-up volta a aparecer para 120 alunos.", "sem o modo: o texto de Uma vez");
  assert.equal(model.reshownPopupToast(0, "repeat"), "Ninguém precisava ver de novo: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.");
});

test("linha de Quantas vezes e linhas de Quando e onde no pop-up no ar ou pausado", () => {
  const umDia = repetir({ everyMinutes: 1_440 });
  assert.equal(
    model.popupFrequencyChangeHint({ saved: { mode: "once" }, shown: umDia, status: "active" }),
    "Mudar “Quantas vezes” vale na hora para todos, contando as vezes que cada aluno já viu."
  );
  assert.notEqual(model.popupFrequencyChangeHint({ saved: umDia, shown: { ...umDia, stopOn: "never" }, status: "paused" }), null);
  assert.equal(model.popupFrequencyChangeHint({ saved: umDia, shown: { ...umDia }, status: "active" }), null, "sem mudanca");
  assert.equal(model.popupFrequencyChangeHint({ saved: { mode: "once" }, shown: umDia, status: "draft" }), null, "rascunho");
  assert.equal(model.popupFrequencyChangeHint({ saved: null, shown: umDia, status: "active" }), null, "sem o salvo");

  const janela = { endsAt: null, startsAt: null };
  const salvo = { popup: config(), window: janela };
  const notes = (shown, status = "active") => model.popupPlacementChangeNotes({ now: NOW, saved: salvo, shown, status });
  const MUDOU =
    "Mudar onde ou quando ele aparece vale na hora. Quem já viu continua contando como visto, também nas páginas novas. Para todos verem de novo, ligue “Mostrar de novo para quem já viu”.";

  assert.deepEqual(notes(salvo), [], "nada mudou");
  assert.deepEqual(notes({ popup: config({ pages: ["any"] }), window: janela }), [MUDOU], "paginas");
  assert.deepEqual(notes({ popup: config({ exclude: ["profile"], pages: ["home"] }), window: janela }), [MUDOU], "excecoes");
  assert.deepEqual(notes({ popup: config({ pages: ["lesson:*"], trigger: "lesson_completed" }), window: janela }), [MUDOU], "momento");
  assert.deepEqual(notes({ popup: config({ delaySeconds: 10 }), window: janela }), [], "so o tempo: nada");
  assert.deepEqual(notes({ popup: config({ pages: ["home", "home"] }), window: janela }), [], "mesmos padroes");
  assert.deepEqual(notes({ popup: config({ pages: ["any"] }), window: janela }, "draft"), [], "rascunho");

  const futuro = { popup: config(), window: { endsAt: null, startsAt: "2026-10-25T23:00:00.000Z" } };
  assert.deepEqual(notes(futuro), ["Com o início no futuro, o pop-up deixa de aparecer para todos até 25/10/2026 às 20:00."]);
  assert.deepEqual(notes(futuro, "paused"), [], "pausado ja nao aparece");
  assert.deepEqual(
    model.popupPlacementChangeNotes({ now: NOW, saved: futuro, shown: futuro, status: "active" }),
    [],
    "o inicio ja estava no futuro"
  );
  assert.deepEqual(notes({ popup: config(), window: { endsAt: null, startsAt: "2026-10-20T12:00:00.000Z" } }), [], "inicio no passado");
  [MUDOU, ...notes(futuro)].forEach(semPalavrasProibidas);
});

/* ------------------------------------------------------------------------------------------------
 * Foco de cada erro do §2.5 (FIELD_FOCUS do editor)
 * ---------------------------------------------------------------------------------------------- */

test("cada erro do pop-up (§2.5) tem para onde levar o foco, no campo que existe na tela", async () => {
  const pasta = new URL("../src/components/admin/v2/communication/", import.meta.url);
  const editorTela = await readFile(new URL("notice-editor.tsx", pasta), "utf8");
  const bloco = editorTela.slice(editorTela.indexOf("const FIELD_FOCUS"), editorTela.indexOf("];", editorTela.indexOf("const FIELD_FOCUS")));
  const pares = [...bloco.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((match) => [match[1], match[2]]);
  const telas = (
    await Promise.all(["popup-placement-fields.tsx", "popup-pages-checklist.tsx", "popup-frequency-fields.tsx", "notice-when-fields.tsx"].map((file) => readFile(new URL(file, pasta), "utf8")))
  ).join("\n");

  // O mesmo laco do editor (focusFirstError): o primeiro prefixo, na ordem da tela, que casa com algum erro.
  const alvo = (keys) => pares.find(([prefix]) => keys.some((key) => key === prefix || key.startsWith(`${prefix}.`)))?.[1];
  const errosDe = (draft) => {
    const parsed = schemas.noticeDraftSchema.safeParse(model.noticeDraftForKind(draft));
    return parsed.success ? {} : model.noticeErrorsFrom(parsed.error.issues);
  };

  const casos = [
    [{ popup: config({ pages: [] }) }, "popup.pages", "Escolha pelo menos uma página.", "#popup-paginas"],
    [{ popup: config({ pages: Array.from({ length: 21 }, (_, index) => `content:curso-${index}`) }) }, "popup.pages", "Use até 20 páginas.", "#popup-paginas"],
    [{ popup: config({ exclude: ["profile"], pages: ["any", "profile"] }) }, "popup.exclude", "Esta página está em “Onde aparece” e em “Nunca nestas páginas”.", "#popup-excecoes"],
    [
      { popup: config({ exclude: ["home", "content:*", "lesson:*", "purchases", "saved", "materials", "journey", "continue", "profile", "support"], pages: ["any"] }) },
      "popup.exclude",
      "Com essas exceções, o pop-up não aparece em nenhuma página.",
      "#popup-excecoes"
    ],
    [{ popup: config({ pages: ["home"], trigger: "lesson_completed" }) }, "popup.pages", "Ao concluir uma aula vale só para páginas de aula.", "#popup-paginas"],
    [{ popup: config({ delaySeconds: 601 }) }, "popup.delaySeconds", "Use de 0 a 600 segundos.", "#popup-atraso-outro"],
    [{ popup: config({ frequency: repetir({ maxPerDay: 0 }) }), repeat: "until_action" }, "popup.frequency.maxPerDay", "Use de 1 a 100 vezes por dia.", "#popup-por-dia"],
    [{ popup: config({ frequency: repetir({ everyMinutes: 129_601 }) }), repeat: "until_action" }, "popup.frequency.everyMinutes", "Use de 1 minuto a 90 dias.", "#popup-intervalo"],
    [
      { popup: config({ frequency: repetir({ maxTotal: 1 }) }), repeat: "until_action" },
      "popup.frequency.maxTotal",
      "Use de 2 a 1.000 vezes. Para uma vez só, escolha “Uma vez”.",
      "#popup-total"
    ],
    [{ cta: null, popup: config({ frequency: repetir() }), repeat: "until_action" }, "popup.frequency.stopOn", "Este pop-up não tem botão: escolha quando ele para de aparecer.", "#popup-para"],
    [{ popup: config({ snoozeMinutes: 4 }) }, "popup.snoozeMinutes", "Use de 5 minutos a 7 dias.", "#popup-lembrar-tempo"],
    [{ popup: config({ close: "anywhere" }) }, "popup.close", "Escolha como o aluno fecha o pop-up.", "#popup-fechar"]
  ];

  for (const [extra, key, message, seletor] of casos) {
    const erros = errosDe(popupDraft(extra));
    assert.equal(erros[key], message, `${key}: ${JSON.stringify(erros)}`);
    assert.ok(alvo(Object.keys(erros))?.startsWith(seletor), `${key} leva a ${seletor} (foi ${alvo(Object.keys(erros))})`);
  }

  // Os erros so do editor e os caminhos que o zod pode dar sem formulario proprio.
  assert.ok(alvo(["popup.frequency.stopOn"]).includes("#popup-para"));
  assert.ok(alvo(["popup.frequency.mode"]).includes("popup-vezes"));
  assert.ok(alvo(["popup.trigger"]).includes("popup-momento"));
  assert.ok(alvo(["popup.frequency"]).includes("popup-vezes"));
  assert.ok(alvo(["popup"]).includes("popup-momento"));
  assert.ok(alvo(["popup.exclude", "popup.frequency.maxPerDay"]).includes("#popup-excecoes"), "o primeiro na ordem da tela");

  // Cada id e nome do foco existe nos campos.
  for (const [prefix, seletor] of pares.filter(([prefix]) => prefix.startsWith("popup"))) {
    for (const [, id] of seletor.matchAll(/#([\w-]+)/g)) {
      assert.ok(telas.includes(`id="${id}"`), `${prefix}: id ${id} nos campos`);
    }
    for (const [, name] of seletor.matchAll(/\[name='([\w-]+)'\]/g)) {
      assert.ok(telas.includes(`name="${name}"`), `${prefix}: name ${name} nos campos`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario fechado da equipe (docs/17 §1.3, docs/23 V19)
 * ---------------------------------------------------------------------------------------------- */

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

test("vocabulario: nenhum texto de popup-editor-model.ts (valores, nunca as chaves) usa as palavras fora do vocabulario", async () => {
  const source = await readFile(new URL("../src/components/admin/v2/communication/popup-editor-model.ts", import.meta.url), "utf8");
  // Texto que alguem le: tem espaco, acento ou comeca com maiuscula (os valores "home", "lesson:*" ficam de fora).
  const textos = literalsOf(source).filter((text) => /\s|[^\x00-\x7f]|^[A-Z]/.test(text));

  assert.ok(textos.length > 40, `achou os textos (${textos.length})`);
  textos.forEach(semPalavrasProibidas);

  // E o que vai para a tela: rotulos das opcoes, os textos dos cards e as frases das funcoes.
  const folhas = (value) => (typeof value === "string" ? [value] : Object.values(value).flatMap(folhas));
  const opcoes = [
    editor.POPUP_TRIGGER_OPTIONS,
    editor.POPUP_PLACEMENT_OPTIONS,
    editor.POPUP_LESSON_SCOPE_OPTIONS,
    editor.POPUP_DELAY_OPTIONS,
    editor.POPUP_FREQUENCY_OPTIONS,
    editor.POPUP_STOP_OPTIONS,
    editor.POPUP_CLOSE_OPTIONS,
    editor.POPUP_MINUTE_UNIT_OPTIONS
  ].flatMap((options) => options.map((option) => option.label));

  [...folhas(editor.POPUP_EDITOR_COPY), ...opcoes, editor.CHOOSE_PRODUCT_MESSAGE, editor.snoozeSwitchDescription(1_440), editor.snoozeSwitchDescription(Number.NaN)].forEach(
    semPalavrasProibidas
  );
});
