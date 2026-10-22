import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras da v3b-1 "Pop-ups: frequencia, paginas e como fechar" (docs/25; popup-display-model.ts e o
// schema do pop-up em schemas.ts): chave da pagina, padroes e excecoes, formacao -> cursos, colunas <->
// configuracao (as linhas de antes continuam como antes), "Quantas vezes" por aluno (paradas definitivas e
// esperas, o dia de Sao Paulo, o intervalo, o total, o piso de 5 s), a equivalencia com a regra da v3a, a
// decisao do show, o plano do aluno, o mapa grosso das paginas e quem o "Mostrar de novo" zera.

const model = await import("../src/server/communications/popup-display-model.ts");
const flow = await import("../src/server/communications/flow-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.parse("2026-10-23T15:00:00.000Z"); // 12:00 em Sao Paulo
const iso = (time) => new Date(time).toISOString();

const estado = (extra = {}) => ({
  campaignId: "a",
  clickedAt: null,
  dayImpressions: 0,
  dismissedAt: null,
  eligible: true,
  impressions: 0,
  impressionsBeforeReshow: 0,
  lastSeenAt: null,
  reshownAt: null,
  snoozeCount: 0,
  snoozedUntil: null,
  snoozesBeforeReshow: 0,
  ...extra
});
const umaVez = { mode: "once" };
const repetir = (extra = {}) => ({ everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click", ...extra });
const veredito = (frequency, extra) => model.frequencyVerdict(frequency, estado(extra), now);
const LIBERADO = { allowed: true };
const NUNCA = { allowed: false, nextAt: null };

/* ------------------------------------------------------------------------------------------------
 * Paginas
 * ---------------------------------------------------------------------------------------------- */

test("chave da pagina: Inicio, produto, aula e as fixas; query, hash e barra no fim nao contam; o resto nao tem chave", () => {
  const casos = {
    "/": "home",
    "/?x=1#topo": "home",
    "/conteudo/a": "content:a",
    "/conteudo/formacao-ia/": "content:formacao-ia",
    "/conteudo/a/aulas/m": "lesson:a",
    "/conteudo/a/aulas/m?lessonId=z#t": "lesson:a",
    "/perfil/": "profile",
    "/minhas-compras": "purchases",
    "/favoritos": "saved",
    "/materiais": "materials",
    "/minha-jornada": "journey",
    "/continue-assistindo": "continue",
    "/suporte": "support",
    "/login": null,
    "/alterar-senha": null,
    "/tv": null,
    "/admin": null,
    "/admin/comunicacao": null,
    "//x": null,
    "/conteudo/a/b": null,
    "/conteudo/a/aulas/m/extra": null,
    "/conteudo/a b": null,
    "": null,
    "perfil": null
  };

  for (const [path, key] of Object.entries(casos)) {
    assert.equal(model.popupPageKeyOf(path), key, path);
  }

  assert.equal(model.popupPageKeyOf(null), null);
  assert.equal(model.popupPageKeyOf(42), null);
  assert.equal(model.pageKindOf("lesson:a"), "lesson");
  assert.equal(model.pageKindOf("content:a"), "content");
  assert.equal(model.pageKindOf("profile"), "profile");
  assert.equal(model.pageKindOf("content:*"), null, "curinga nao e pagina");
  assert.equal(model.pageKindOf("checkout:a"), null);
  assert.equal(model.isPopupPageKey("lesson:a"), true);
  assert.equal(model.isPopupPageKey("any"), false);
  assert.equal(model.isPopupPageKey(undefined), false);
});

test("padroes: qualquer, curingas e pagina exata; a excecao vence; chave invalida nunca", () => {
  assert.equal(model.pagePatternMatches("any", "profile"), true);
  assert.equal(model.pagePatternMatches("content:*", "content:x"), true);
  assert.equal(model.pagePatternMatches("content:*", "lesson:x"), false);
  assert.equal(model.pagePatternMatches("lesson:*", "lesson:x"), true);
  assert.equal(model.pagePatternMatches("lesson:x", "lesson:x"), true);
  assert.equal(model.pagePatternMatches("lesson:x", "lesson:y"), false);

  const qualquerMenosPerfil = { exclude: ["profile"], pages: ["any"] };
  assert.equal(model.popupAllowsPage(qualquerMenosPerfil, "content:x"), true);
  assert.equal(model.popupAllowsPage(qualquerMenosPerfil, "saved"), true);
  assert.equal(model.popupAllowsPage(qualquerMenosPerfil, "profile"), false, "a excecao vence");
  assert.equal(model.popupAllowsPage({ exclude: ["lesson:b"], pages: ["lesson:*"] }, "lesson:a"), true);
  assert.equal(model.popupAllowsPage({ exclude: ["lesson:b"], pages: ["lesson:*"] }, "lesson:b"), false);
  assert.equal(model.popupAllowsPage({ exclude: [], pages: ["home"] }, "saved"), false);
  assert.equal(model.popupAllowsPage({ exclude: [], pages: ["any"] }, "login"), false, "so paginas de verdade");
  assert.equal(model.popupAllowsPage({ exclude: [], pages: ["any"] }, "content:*"), false);
});

test("mapa grosso: content:<id> e lesson:<id> viram curinga; cobrir ignora excecoes", () => {
  assert.equal(model.coarsePagePattern("content:formacao-ia"), "content:*");
  assert.equal(model.coarsePagePattern("lesson:curso-1"), "lesson:*");
  assert.equal(model.coarsePagePattern("lesson:*"), "lesson:*");
  assert.equal(model.coarsePagePattern("profile"), "profile");
  assert.equal(model.coarsePagePattern("any"), "any");

  assert.equal(model.coversPage(["any"], "profile"), true);
  assert.equal(model.coversPage(["lesson:*"], "lesson:x"), true);
  assert.equal(model.coversPage(["lesson:*"], "content:x"), false);
  assert.equal(model.coversPage(["home", "saved"], "saved"), true);
  assert.equal(model.coversPage([], "home"), false);
  assert.equal(model.coversPage(["any"], "nada"), false);
});

test("excecoes que tiram tudo: qualquer pagina so com as dez excluidas; curinga pelo curinga; pagina exata por ela ou pelo curinga", () => {
  const todas = ["home", "content:*", "lesson:*", "purchases", "saved", "materials", "journey", "continue", "profile", "support"];

  assert.equal(model.placementCoversNothing({ exclude: todas, pages: ["any"] }), true);
  assert.equal(model.placementCoversNothing({ exclude: todas.slice(1), pages: ["any"] }), false, "sobrou o Inicio");
  assert.equal(model.placementCoversNothing({ exclude: ["content:x"], pages: ["any"] }), false);
  assert.equal(model.placementCoversNothing({ exclude: ["content:*"], pages: ["content:*"] }), true);
  assert.equal(model.placementCoversNothing({ exclude: ["content:x"], pages: ["content:*"] }), false);
  assert.equal(model.placementCoversNothing({ exclude: ["lesson:*"], pages: ["lesson:a", "lesson:b"] }), true);
  assert.equal(model.placementCoversNothing({ exclude: ["lesson:a"], pages: ["lesson:a", "lesson:b"] }), false);
  assert.equal(model.placementCoversNothing({ exclude: ["home"], pages: ["home"] }), true);
  assert.equal(model.placementCoversNothing({ exclude: [], pages: ["home"] }), false);
  assert.equal(model.placementCoversNothing({ exclude: ["home"], pages: [] }), false, "sem paginas o erro e outro");
});

test("formacao vale tambem para as paginas dos cursos dela (mapa ou funcao); curingas e fixas ficam; sem repeticao, em ordem", () => {
  const cursos = new Map([["formacao", ["curso-b", "curso-a"]], ["vazia", []]]);

  assert.deepEqual(model.expandFormationPatterns(["lesson:formacao", "home", "profile"], cursos), ["home", "profile", "lesson:curso-a", "lesson:curso-b", "lesson:formacao"]);
  assert.deepEqual(model.expandFormationPatterns(["content:formacao", "lesson:formacao"], cursos), [
    "content:curso-a",
    "content:curso-b",
    "content:formacao",
    "lesson:curso-a",
    "lesson:curso-b",
    "lesson:formacao"
  ]);
  assert.deepEqual(model.expandFormationPatterns(["lesson:*", "any", "content:solto"], cursos), ["any", "content:solto", "lesson:*"]);
  assert.deepEqual(model.expandFormationPatterns(["lesson:formacao"], (id) => (id === "formacao" ? ["curso-a", "nao vale"] : null)), ["lesson:curso-a", "lesson:formacao"]);
  assert.deepEqual(model.expandFormationPatterns(["lesson:curso-a", "lesson:formacao"], cursos), ["lesson:curso-a", "lesson:curso-b", "lesson:formacao"], "curso ja escolhido nao repete");
});

/* ------------------------------------------------------------------------------------------------
 * Colunas <-> configuracao
 * ---------------------------------------------------------------------------------------------- */

const colunasV3b1 = (extra = {}) => ({
  popup_close: "any",
  popup_delay_seconds: 3,
  popup_every_minutes: null,
  popup_exclude_pages: [],
  popup_frequency: null,
  popup_max_per_day: null,
  popup_max_total: null,
  popup_pages: ["home"],
  popup_repeat: "once",
  popup_snooze_minutes: 1440,
  popup_stop_on: null,
  popup_trigger: "page_load",
  ...extra
});

test("linhas de antes: 'Uma vez' continua Uma vez; 'Até o aluno clicar' vira 1 dia entre uma vez e outra, ate clicar; nada e reescrito", () => {
  assert.deepEqual(model.frequencyOfColumns(colunasV3b1()), umaVez);
  assert.deepEqual(model.frequencyOfColumns(colunasV3b1({ popup_repeat: "until_action" })), model.POPUP_UNTIL_CLICK_V1);
  assert.deepEqual(model.POPUP_UNTIL_CLICK_V1, repetir({ everyMinutes: 1440 }));
  assert.deepEqual(model.frequencyOfColumns({ popup_repeat: "until_action" }), model.POPUP_UNTIL_CLICK_V1, "linha lida antes da migracao");
  assert.deepEqual(model.frequencyOfColumns({}), umaVez);

  const antiga = model.popupSettingsOfRow({ popup_repeat: "until_action" });
  assert.deepEqual(antiga, { ...model.POPUP_SETTINGS_DEFAULT, frequency: model.POPUP_UNTIL_CLICK_V1 });
  antiga.pages.push("profile");
  assert.deepEqual(model.POPUP_SETTINGS_DEFAULT.pages, ["home"], "o padrao nunca e compartilhado");
  assert.deepEqual(model.popupSettingsOfRow(colunasV3b1()), model.POPUP_SETTINGS_DEFAULT);
});

test("linhas da v3b-1: cada coluna lida; invalida ou desconhecida cai no padrao (at_start da v3b-2 vira page_load)", () => {
  assert.deepEqual(
    model.popupSettingsOfRow(
      colunasV3b1({
        popup_close: "x_only",
        popup_delay_seconds: 0,
        popup_every_minutes: 120,
        popup_exclude_pages: ["support", "profile"],
        popup_frequency: "repeat",
        popup_max_per_day: 3,
        popup_max_total: 10,
        popup_pages: ["any"],
        popup_repeat: "until_action",
        popup_snooze_minutes: 30,
        popup_stop_on: "never"
      })
    ),
    {
      close: "x_only",
      delaySeconds: 0,
      exclude: ["profile", "support"],
      frequency: repetir({ everyMinutes: 120, maxPerDay: 3, maxTotal: 10, stopOn: "never" }),
      pages: ["any"],
      snoozeMinutes: 30,
      trigger: "page_load"
    }
  );
  assert.equal(model.popupSettingsOfRow(colunasV3b1({ popup_trigger: "lesson_completed", popup_pages: ["lesson:*"] })).trigger, "lesson_completed");
  assert.equal(model.popupSettingsOfRow(colunasV3b1({ popup_trigger: "at_start" })).trigger, "page_load");
  assert.deepEqual(model.frequencyOfColumns(colunasV3b1({ popup_frequency: "once", popup_repeat: "until_action" })), umaVez, "popup_frequency manda");
  assert.deepEqual(model.frequencyOfColumns(colunasV3b1({ popup_frequency: "repeat", popup_stop_on: "close" })).stopOn, "click", "parada desconhecida = clique");
  assert.deepEqual(model.frequencyOfColumns(colunasV3b1({ popup_frequency: "lixo" })), umaVez);

  assert.deepEqual(
    model.popupSettingsOfRow({
      popup_close: "fora",
      popup_delay_seconds: 900,
      popup_exclude_pages: ["any", "nada", "profile"],
      popup_frequency: "repeat",
      popup_every_minutes: 0,
      popup_max_per_day: 101,
      popup_max_total: 1,
      popup_pages: "home",
      popup_snooze_minutes: 4,
      popup_trigger: 7
    }),
    {
      close: "any",
      delaySeconds: 3,
      exclude: ["profile"],
      frequency: repetir(),
      pages: ["home"],
      snoozeMinutes: 1440,
      trigger: "page_load"
    },
    "lixo vira o padrao, campo a campo"
  );
  assert.deepEqual(model.popupSettingsOfRow(colunasV3b1({ popup_pages: ["nada", 3] })).pages, ["home"], "nenhuma pagina valida = so no Inicio");
});

test("configuracao -> colunas -> configuracao: ida e volta; popup_repeat sempre coerente; notificacao grava os padroes", () => {
  const cheio = {
    close: "x_only",
    delaySeconds: 10,
    exclude: ["profile"],
    frequency: repetir({ everyMinutes: 30, maxPerDay: 2, maxTotal: 5, stopOn: "never" }),
    pages: ["any"],
    snoozeMinutes: 60,
    trigger: "page_load"
  };

  assert.deepEqual(model.popupSettingsToColumns(cheio), {
    popup_close: "x_only",
    popup_delay_seconds: 10,
    popup_every_minutes: 30,
    popup_exclude_pages: ["profile"],
    popup_frequency: "repeat",
    popup_max_per_day: 2,
    popup_max_total: 5,
    popup_pages: ["any"],
    popup_repeat: "until_action",
    popup_snooze_minutes: 60,
    popup_stop_on: "never",
    popup_trigger: "page_load"
  });
  assert.deepEqual(model.popupSettingsOfRow(model.popupSettingsToColumns(cheio)), cheio);

  const uma = { ...model.POPUP_SETTINGS_DEFAULT, pages: ["lesson:*"], trigger: "lesson_completed" };
  const colunas = model.popupSettingsToColumns(uma);
  assert.equal(colunas.popup_frequency, "once");
  assert.equal(colunas.popup_repeat, "once");
  assert.deepEqual([colunas.popup_every_minutes, colunas.popup_max_per_day, colunas.popup_max_total, colunas.popup_stop_on], [null, null, null, null]);
  assert.deepEqual(model.popupSettingsOfRow(colunas), uma);
  colunas.popup_pages.push("home");
  assert.deepEqual(uma.pages, ["lesson:*"], "as listas sao copiadas");

  assert.deepEqual(model.POPUP_COLUMNS_FOR_INBOX, {
    popup_close: "any",
    popup_delay_seconds: 3,
    popup_every_minutes: null,
    popup_exclude_pages: [],
    popup_frequency: null,
    popup_max_per_day: null,
    popup_max_total: null,
    popup_pages: ["home"],
    popup_repeat: "once",
    popup_snooze_minutes: 1440,
    popup_stop_on: null,
    popup_trigger: "page_load"
  });
  assert.equal(model.repeatOfFrequency(umaVez), "once");
  assert.equal(model.repeatOfFrequency(repetir()), "until_action");
});

test("conciliar 'Quantas vezes' com o repeat da v1: popup.frequency manda; so o repeat mudou -> a regra da v1", () => {
  const diario = repetir({ maxPerDay: 1 });

  assert.deepEqual(model.reconcilePopupFrequency({ frequency: undefined, repeat: "until_action", stored: null }), model.POPUP_UNTIL_CLICK_V1, "sem popup: a regra da v1");
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: undefined, repeat: "once", stored: diario }), umaVez);
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: diario, repeat: "until_action", stored: umaVez }), diario, "concordam");
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: umaVez, repeat: "once", stored: diario }), umaVez, "concordam");
  // { ...detalhe.draft, repeat: "until_action" } de uma linha "Uma vez": so o repeat mudou.
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: umaVez, repeat: "until_action", stored: umaVez }), model.POPUP_UNTIL_CLICK_V1);
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: diario, repeat: "once", stored: repetir({ maxPerDay: 1 }) }), umaVez);
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: diario, repeat: "once", stored: umaVez }), diario, "outra discordancia: frequency");
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: diario, repeat: "once", stored: null }), diario, "rascunho novo: frequency");
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: model.POPUP_UNTIL_CLICK_V1, repeat: "once", stored: null }), model.POPUP_UNTIL_CLICK_V1, "rascunho novo: frequency");
  // { ...emptyNoticeDraft("popup"), repeat: "until_action" } (os testes e o app da v1/v3a): o once veio do rascunho vazio.
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: umaVez, repeat: "until_action", stored: null }), model.POPUP_UNTIL_CLICK_V1);
  assert.deepEqual(model.reconcilePopupFrequency({ frequency: umaVez, repeat: "until_action", stored: diario }), umaVez, "com a linha gravada, a regra da linha");

  assert.equal(model.sameFrequency(umaVez, { mode: "once" }), true);
  assert.equal(model.sameFrequency(umaVez, diario), false);
  assert.equal(model.sameFrequency(diario, repetir({ maxPerDay: 1 })), true);
  assert.equal(model.sameFrequency(diario, repetir({ maxPerDay: 1, stopOn: "never" })), false);
  assert.equal(model.sameFrequency(diario, repetir({ maxPerDay: 2 })), false);
});

test("o editor muda 'Quantas vezes' so junto com o repeat; a forma canonica ordena paginas e tira sobras", () => {
  const patch = model.popupFrequencyPatch({ popup: { ...model.POPUP_SETTINGS_DEFAULT, close: "x_only" } }, repetir({ maxPerDay: 1 }));
  assert.deepEqual(patch, { popup: { ...model.POPUP_SETTINGS_DEFAULT, close: "x_only", frequency: repetir({ maxPerDay: 1 }) }, repeat: "until_action" });
  assert.deepEqual(model.popupFrequencyPatch({}, umaVez), { popup: model.POPUP_SETTINGS_DEFAULT, repeat: "once" }, "sem popup: o padrao");

  assert.deepEqual(
    model.canonicalPopupSettings({
      close: "any",
      delaySeconds: 3,
      exclude: [" support", "profile", "support"],
      frequency: { extra: true, mode: "once" },
      pages: ["lesson:b", "lesson:*", "content:z", "content:*", "support", "saved", "home", "lesson:a", "any"],
      snoozeMinutes: 1440,
      trigger: "page_load"
    }),
    {
      close: "any",
      delaySeconds: 3,
      exclude: ["profile", "support"],
      frequency: umaVez,
      pages: ["any", "home", "saved", "support", "content:*", "content:z", "lesson:*", "lesson:a", "lesson:b"],
      snoozeMinutes: 1440,
      trigger: "page_load"
    }
  );
  assert.deepEqual(model.canonicalPopupSettings({ ...model.POPUP_SETTINGS_DEFAULT, frequency: { ...repetir({ maxTotal: 4 }), sobra: 1 } }).frequency, repetir({ maxTotal: 4 }));

  assert.equal(model.isDefaultPlacement(model.POPUP_SETTINGS_DEFAULT), true);
  assert.equal(model.isDefaultPlacement({ ...model.POPUP_SETTINGS_DEFAULT, delaySeconds: 0 }), false);
  assert.equal(model.isDefaultPlacement({ ...model.POPUP_SETTINGS_DEFAULT, exclude: ["profile"] }), false);
  assert.equal(model.isDefaultPlacement({ ...model.POPUP_SETTINGS_DEFAULT, pages: ["home", "saved"] }), false);
  assert.equal(model.isDefaultPlacement({ ...model.POPUP_SETTINGS_DEFAULT, pages: ["lesson:*"], trigger: "lesson_completed" }), false);
  assert.equal(model.isDefaultPlacement({ ...model.POPUP_SETTINGS_DEFAULT, frequency: repetir(), close: "x_only" }), true, "frequencia e fechar nao sao lugar");
});

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes (por aluno)
 * ---------------------------------------------------------------------------------------------- */

test("dia de Sao Paulo: o mesmo de saoPauloDayBounds (02:59, 03:00 e 23:59 UTC)", () => {
  for (const at of ["2026-10-23T02:59:00.000Z", "2026-10-23T03:00:00.000Z", "2026-10-23T23:59:00.000Z", "2026-10-23T02:59:59.999Z"]) {
    assert.deepEqual(model.popupDayBounds(Date.parse(at)), flow.saoPauloDayBounds(Date.parse(at)), at);
  }

  assert.deepEqual(model.popupDayBounds(Date.parse("2026-10-23T02:59:00.000Z")), {
    nextStart: Date.parse("2026-10-23T03:00:00.000Z"),
    start: Date.parse("2026-10-22T03:00:00.000Z")
  });
  assert.equal(model.popupDayBounds(Date.parse("2026-10-23T03:00:00.000Z")).start, Date.parse("2026-10-23T03:00:00.000Z"));
});

test("paradas definitivas vem antes das esperas: fora do segmento, 'Não mostrar de novo', Uma vez visto, clicou em 'para quando clica', total", () => {
  const adiado = { snoozedUntil: now + HOUR };

  assert.deepEqual(veredito(umaVez, { eligible: false, ...adiado }), NUNCA);
  assert.deepEqual(veredito(repetir(), { dismissedAt: now - HOUR, ...adiado }), NUNCA, "dispensou e adiou: nunca mais");
  assert.deepEqual(veredito(umaVez, { impressions: 1, lastSeenAt: now - 2_000, ...adiado }), NUNCA, "Uma vez ja visto e adiado: parou");
  assert.deepEqual(veredito(umaVez, { clickedAt: now - HOUR }), NUNCA, "clicou sem a abertura gravada (beacon perdido)");
  assert.deepEqual(veredito(repetir({ stopOn: "click" }), { clickedAt: now - HOUR, impressions: 1, lastSeenAt: now - DAY }), NUNCA);
  assert.deepEqual(veredito(repetir({ stopOn: "never" }), { clickedAt: now - HOUR, impressions: 1, lastSeenAt: now - DAY }), LIBERADO, "so para quando termina: clique nao para");
  assert.deepEqual(veredito(repetir({ maxTotal: 3 }), { impressions: 3, lastSeenAt: now - DAY }), NUNCA);
  assert.deepEqual(veredito(repetir({ maxTotal: 3 }), { impressions: 3, lastSeenAt: now - DAY, snoozeCount: 1 }), LIBERADO, "Lembrar depois nao gasta vez");
  assert.deepEqual(veredito(repetir({ maxTotal: 3 }), { impressions: 4, lastSeenAt: now - DAY, snoozeCount: 1 }), NUNCA, "3 vezes + 1 adiada = 4 aberturas");
});

test("Uma vez: cada 'Lembrar depois' vale mais uma vez, depois do Volta em; depois do 'mostrar de novo' volta a ser nova", () => {
  assert.deepEqual(veredito(umaVez, {}), LIBERADO);
  assert.deepEqual(veredito(umaVez, { impressions: 1, lastSeenAt: now - DAY }), NUNCA);
  assert.deepEqual(veredito(umaVez, { impressions: 1, lastSeenAt: now - HOUR, snoozeCount: 1, snoozedUntil: now + 30 * MIN }), { allowed: false, nextAt: now + 30 * MIN });
  assert.deepEqual(veredito(umaVez, { impressions: 1, lastSeenAt: now - HOUR, snoozeCount: 1, snoozedUntil: now - MIN }), LIBERADO);
  assert.deepEqual(veredito(umaVez, { impressions: 2, lastSeenAt: now - HOUR, snoozeCount: 1, snoozedUntil: now - 2 * HOUR }), NUNCA);
  assert.deepEqual(
    veredito(umaVez, { impressions: 2, impressionsBeforeReshow: 2, lastSeenAt: now - HOUR, reshownAt: now - 30 * MIN, snoozeCount: 1, snoozesBeforeReshow: 1 }),
    LIBERADO,
    "depois do zerar"
  );
});

test("limite por dia: conta de meia-noite a meia-noite em Sao Paulo; linha vista hoje antes da v3b-1 conta 1", () => {
  const doisPorDia = repetir({ maxPerDay: 2, stopOn: "never" });
  const antesDaMeiaNoite = Date.parse("2026-10-23T02:58:00.000Z"); // 23:58 de 22/10 em Sao Paulo
  const meiaNoite = Date.parse("2026-10-23T03:00:00.000Z");

  assert.deepEqual(
    model.frequencyVerdict(doisPorDia, estado({ dayImpressions: 2, impressions: 2, lastSeenAt: antesDaMeiaNoite }), Date.parse("2026-10-23T02:59:00.000Z")),
    { allowed: false, nextAt: meiaNoite }
  );
  assert.deepEqual(model.frequencyVerdict(doisPorDia, estado({ dayImpressions: 2, impressions: 2, lastSeenAt: antesDaMeiaNoite }), meiaNoite), LIBERADO, "dia novo");
  assert.deepEqual(veredito(doisPorDia, { dayImpressions: 1, impressions: 1, lastSeenAt: now - HOUR }), LIBERADO);
  assert.deepEqual(veredito(doisPorDia, { dayImpressions: 2, impressions: 5, lastSeenAt: now - HOUR }), { allowed: false, nextAt: Date.parse("2026-10-24T03:00:00.000Z") });
  assert.deepEqual(veredito(repetir({ maxPerDay: 1 }), { dayImpressions: 0, impressions: 1, lastSeenAt: now - HOUR }), {
    allowed: false,
    nextAt: Date.parse("2026-10-24T03:00:00.000Z")
  }, "vista hoje antes da migracao (0) conta 1");
  assert.deepEqual(
    veredito(doisPorDia, { dayImpressions: 2, impressions: 2, impressionsBeforeReshow: 2, lastSeenAt: now - HOUR, reshownAt: now - 30 * MIN }),
    LIBERADO,
    "as vezes antes do zerar nao contam no dia"
  );
});

test("tempo entre uma vez e outra, o piso de 5 s em todo modo e a espera mais tardia entre varias", () => {
  const meiaHora = repetir({ everyMinutes: 30 });

  assert.deepEqual(veredito(meiaHora, { impressions: 1, lastSeenAt: now - 10 * MIN }), { allowed: false, nextAt: now + 20 * MIN });
  assert.deepEqual(veredito(meiaHora, { impressions: 1, lastSeenAt: now - 31 * MIN }), LIBERADO);
  assert.deepEqual(veredito(meiaHora, { impressions: 1, lastSeenAt: now - 10 * MIN, reshownAt: now - 5 * MIN }), LIBERADO, "visto antes do zerar nao conta");

  assert.deepEqual(veredito(repetir(), { impressions: 1, lastSeenAt: now - 2_000 }), { allowed: false, nextAt: now + 3_000 }, "sem ritmo: 5 s");
  assert.deepEqual(veredito(repetir(), { impressions: 1, lastSeenAt: now - 6_000 }), LIBERADO);
  assert.deepEqual(veredito(umaVez, { impressions: 1, lastSeenAt: now - 2_000, snoozeCount: 1, snoozedUntil: now - 1_000 }), { allowed: false, nextAt: now + 3_000 }, "Uma vez tambem");

  assert.deepEqual(
    veredito(repetir({ everyMinutes: 30 }), { impressions: 1, lastSeenAt: now - 5 * MIN, snoozeCount: 1, snoozedUntil: now + 10 * MIN }),
    { allowed: false, nextAt: now + 25 * MIN },
    "o intervalo vence o Lembrar depois"
  );
  assert.deepEqual(
    veredito(repetir({ everyMinutes: 30, maxPerDay: 1 }), { dayImpressions: 1, impressions: 1, lastSeenAt: now - 5 * MIN }),
    { allowed: false, nextAt: Date.parse("2026-10-24T03:00:00.000Z") },
    "o dia vence o intervalo"
  );
});

test("v1: 'Até o aluno clicar' e 'Uma vez' dao a mesma resposta que a regra da v3a (pickPopup), menos as duas diferencas de proposito", () => {
  // A resposta da v3a fica escrita (true = mostra): a regra antiga (pickPopup) saiu no fechamento da v3b-1.
  const v3b = (repeat, delivery) => model.frequencyVerdict(model.frequencyOfColumns({ popup_frequency: null, popup_repeat: repeat }), delivery, now).allowed;
  const estados = [
    ["nunca viu", estado(), [true, true]],
    ["viu ha 25 h", estado({ impressions: 1, lastSeenAt: now - 25 * HOUR }), [false, true]],
    ["viu ha 2 h", estado({ impressions: 1, lastSeenAt: now - 2 * HOUR }), [false, false]],
    ["clicou", estado({ clickedAt: now - DAY, impressions: 1, lastSeenAt: now - 2 * DAY }), [false, false]],
    ["Não mostrar de novo", estado({ dismissedAt: now - DAY, impressions: 1, lastSeenAt: now - 2 * DAY }), [false, false]],
    ["adiou e ainda vale", estado({ impressions: 1, lastSeenAt: now - 2 * HOUR, snoozeCount: 1, snoozedUntil: now + HOUR }), [false, false]],
    ["adiou e venceu", estado({ impressions: 1, lastSeenAt: now - 25 * HOUR, snoozeCount: 1, snoozedUntil: now - HOUR }), [true, true]],
    ["fora do segmento", estado({ eligible: false }), [false, false]],
    ["viu de novo depois do lembrete", estado({ impressions: 2, lastSeenAt: now - 25 * HOUR, snoozeCount: 1, snoozedUntil: now - 26 * HOUR }), [false, true]],
    ["dois lembretes vencidos", estado({ impressions: 2, lastSeenAt: now - 30 * HOUR, snoozeCount: 2, snoozedUntil: now - HOUR }), [true, true]],
    ["clicou sem a abertura gravada", estado({ clickedAt: now - HOUR }), [false, false]],
    ["zerado e ainda nao viu de novo", estado({ impressions: 1, impressionsBeforeReshow: 1, lastSeenAt: now - 25 * HOUR, reshownAt: now - HOUR }), [true, true]]
  ];

  for (const [nome, delivery, [once, untilAction]] of estados) {
    assert.equal(v3b("once", delivery), once, `once: ${nome}`);
    assert.equal(v3b("until_action", delivery), untilAction, `until_action: ${nome}`);
  }

  // Diferencas de proposito: (1) o piso de 5 s; (2) o 'mostrar de novo' da v3a feito em "Uma vez" antes de
  // passar para "Até o aluno clicar" (a v3a contava 24 h do last_seen_at cru; agora so vale o que veio depois).
  const vistoAgora = estado({ impressions: 1, lastSeenAt: now - 2_000, snoozeCount: 1, snoozedUntil: null });
  assert.equal(v3b("once", vistoAgora), false, "visto ha menos de 5 s");
  const zeradoNaV3a = estado({ impressions: 1, impressionsBeforeReshow: 1, lastSeenAt: now - 2 * HOUR, reshownAt: now - HOUR });
  assert.equal(v3b("until_action", zeradoNaV3a), true, "zerado depois de ver: volta a contar como novo");
  // (a v3a respondia o contrario nesses dois: mostrava o visto ha 2 s e escondia o zerado.)
});

test("depois de uma abertura: Uma vez nao volta; limite do dia -> meia-noite; intervalo; sem ritmo -> 5 s", () => {
  const depois = (extra) => estado({ dayImpressions: 1, impressions: 1, lastSeenAt: now, ...extra });

  assert.equal(model.showNext(umaVez, depois(), now), null);
  assert.deepEqual(model.showNext(repetir({ maxPerDay: 1 }), depois(), now), { notBefore: "2026-10-24T03:00:00.000Z" });
  assert.deepEqual(model.showNext(repetir({ everyMinutes: 60 }), depois(), now), { notBefore: iso(now + HOUR) });
  assert.deepEqual(model.showNext(repetir(), depois(), now), { notBefore: iso(now + 5_000) });
  assert.equal(model.showNext(repetir({ maxTotal: 2 }), depois({ impressions: 2 }), now), null, "chegou ao total");
  assert.deepEqual(model.showNext(repetir({ stopOn: "never" }), depois({ clickedAt: now - HOUR }), now), { notBefore: iso(now + 5_000) });
  assert.deepEqual(model.showNext(repetir(), depois({ lastSeenAt: now - DAY }), now), { notBefore: null }, "liberado (nao acontece logo depois de abrir)");
});

test("mostrar de novo: quem a RPC zera; quem clicou so entra quando o pop-up so para ao terminar", () => {
  const visto = (extra = {}) => estado({ impressions: 1, lastSeenAt: now - HOUR, ...extra });

  for (const stopOn of [null, "click", "never"]) {
    assert.equal(model.reshowTarget(visto(), stopOn), true, `viu e fechou (${stopOn})`);
    assert.equal(model.reshowTarget(visto({ eligible: false }), stopOn), false);
    assert.equal(model.reshowTarget(visto({ dismissedAt: now - MIN }), stopOn), false, "Não mostrar de novo fica");
    assert.equal(model.reshowTarget(estado(), stopOn), false, "ainda nao viu");
    assert.equal(model.reshowTarget(visto({ snoozeCount: 1 }), stopOn), false, "viu uma vez e adiou");
    assert.equal(model.reshowTarget(visto({ impressionsBeforeReshow: 1 }), stopOn), false, "ja zerado");
    assert.equal(model.reshowTarget(visto({ impressions: 2, snoozeCount: 1 }), stopOn), true, "viu de novo depois do lembrete");
    assert.equal(model.reshowTarget(visto({ impressions: 2, impressionsBeforeReshow: 1 }), stopOn), true, "zerado e viu de novo");
  }

  assert.equal(model.reshowTarget(visto({ clickedAt: now - MIN }), "click"), false);
  assert.equal(model.reshowTarget(visto({ clickedAt: now - MIN }), null), false);
  assert.equal(model.reshowTarget(visto({ clickedAt: now - MIN }), "never"), true, "o clique nunca parou ninguem ali");
});

/* ------------------------------------------------------------------------------------------------
 * Show, plano e mapa
 * ---------------------------------------------------------------------------------------------- */

const regras = (id, extra = {}, settings = {}) => ({
  allowSnooze: true,
  endsAt: null,
  id,
  rank: 0,
  startsAt: null,
  ...extra,
  settings: { ...model.POPUP_SETTINGS_DEFAULT, ...settings }
});

test("show: no ar, elegivel, pagina, momento e frequencia, nessa ordem", () => {
  const popup = regras("a", {}, { exclude: ["profile"], frequency: repetir({ everyMinutes: 30 }), pages: ["any"] });
  const decide = (extra) => model.decideShow({ delivery: estado(), now, pageKey: "saved", popup, trigger: "page_load", ...extra });

  assert.deepEqual(decide({}), { ok: true });
  assert.deepEqual(decide({ popup: null }), { nextAt: null, ok: false, reason: "not_live" });
  assert.deepEqual(decide({ popup: { ...popup, startsAt: now + MIN } }), { nextAt: null, ok: false, reason: "not_live" }, "janela por comecar");
  assert.deepEqual(decide({ popup: { ...popup, endsAt: now } }), { nextAt: null, ok: false, reason: "not_live" }, "janela terminou");
  assert.deepEqual(decide({ delivery: null }), { nextAt: null, ok: false, reason: "not_eligible" });
  assert.deepEqual(decide({ delivery: estado({ eligible: false }) }), { nextAt: null, ok: false, reason: "not_eligible" });
  assert.deepEqual(decide({ pageKey: "profile" }), { nextAt: null, ok: false, reason: "page" });
  assert.deepEqual(decide({ pageKey: "content:*" }), { nextAt: null, ok: false, reason: "page" });
  assert.deepEqual(decide({ trigger: "lesson_completed" }), { nextAt: null, ok: false, reason: "trigger" });
  assert.deepEqual(decide({ delivery: estado({ impressions: 1, lastSeenAt: now - 10 * MIN }) }), { nextAt: now + 20 * MIN, ok: false, reason: "frequency" });
  assert.deepEqual(decide({ delivery: estado({ dismissedAt: now - MIN }) }), { nextAt: null, ok: false, reason: "frequency" });
  const semRitmo = regras("a", {}, { frequency: repetir(), pages: ["any"] });
  assert.deepEqual(decide({ delivery: estado({ impressions: 1, lastSeenAt: now - 2_000 }), popup: semRitmo }), { nextAt: now + 3_000, ok: false, reason: "frequency" }, "dois show em 5 s");
  assert.deepEqual(decide({ delivery: estado({ impressions: 1, lastSeenAt: now - 6_000 }), popup: semRitmo }), { ok: true });
});

test("plano do aluno: so a janela aberta, so com linha elegivel, sem os que pararam; espera longe fica; parada; na ordem", () => {
  const plano = model.planPopups({
    deliveries: [
      estado({ campaignId: "uma" }),
      estado({ campaignId: "vista", impressions: 1, lastSeenAt: now - DAY }),
      estado({ campaignId: "diario", dayImpressions: 1, impressions: 1, lastSeenAt: now - HOUR }),
      estado({ campaignId: "sempre", clickedAt: now - MIN, impressions: 1, lastSeenAt: now - DAY }),
      estado({ campaignId: "futuro" }),
      estado({ campaignId: "fim" }),
      estado({ campaignId: "fora", eligible: false })
    ],
    live: [
      regras("uma", { rank: 1 }, { delaySeconds: 0, exclude: ["profile"], pages: ["any"] }),
      regras("vista", { rank: 9 }),
      regras("diario", { rank: 5 }, { frequency: repetir({ maxPerDay: 1 }), pages: ["lesson:x"], trigger: "lesson_completed" }),
      regras("sempre", { rank: 5 }, { frequency: repetir({ stopOn: "never" }) }),
      regras("futuro", { rank: 8, startsAt: now + HOUR }),
      regras("fim", { endsAt: now - 1, rank: 7 }),
      regras("fora", { rank: 6 }),
      regras("sem-linha", { rank: 4 })
    ],
    now
  });

  assert.deepEqual(plano, [
    { delaySeconds: 3, exclude: [], id: "diario", notBefore: "2026-10-24T03:00:00.000Z", pages: ["lesson:x"], stopOn: "click", trigger: "lesson_completed" },
    { delaySeconds: 3, exclude: [], id: "sempre", notBefore: null, pages: ["home"], stopOn: "never", trigger: "page_load" },
    { delaySeconds: 0, exclude: ["profile"], id: "uma", notBefore: null, pages: ["any"], stopOn: null, trigger: "page_load" }
  ]);
  assert.deepEqual(model.planPopups({ deliveries: [], live: [regras("a")], now }), []);
});

test("mapa das paginas: so pop-ups com a janela aberta, nunca um id de produto, 'qualquer' resume tudo", () => {
  assert.deepEqual(model.pagesCovering([], now), []);
  assert.deepEqual(
    model.pagesCovering(
      [
        regras("a", {}, { pages: ["lesson:formacao-ia", "lesson:curso-1", "home"] }),
        regras("b", {}, { exclude: ["content:x"], pages: ["content:x", "profile", "home"] }),
        regras("c", { startsAt: now + HOUR }, { pages: ["any"] })
      ],
      now
    ),
    ["home", "profile", "content:*", "lesson:*"]
  );
  assert.deepEqual(model.pagesCovering([regras("a", {}, { pages: ["saved"] }), regras("b", {}, { pages: ["any"] })], now), ["any"]);
  assert.deepEqual(model.pagesCovering([regras("a", { endsAt: now }, { pages: ["any"] })], now), [], "janela terminou");
});

/* ------------------------------------------------------------------------------------------------
 * Schema do pop-up (schemas.ts, §2.5)
 * ---------------------------------------------------------------------------------------------- */

const issues = (schema, value) => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
};
const config = (extra = {}) => ({ ...model.POPUP_SETTINGS_DEFAULT, ...extra });

test("schema do pop-up: padroes, forma canonica e cada mensagem no seu campo", () => {
  const parsed = schemas.popupSettingsSchema.parse({});
  assert.deepEqual(parsed, model.POPUP_SETTINGS_DEFAULT, "sem nada = o comportamento de antes");
  assert.deepEqual(schemas.popupSettingsSchema.parse(config({ pages: ["support", "home", "home"] })).pages, ["home", "support"]);

  const s = schemas.popupSettingsSchema;
  assert.deepEqual(issues(s, config({ pages: [] })), [["pages", "Escolha pelo menos uma página."]]);
  assert.deepEqual(issues(s, config({ pages: Array.from({ length: 21 }, (_, i) => `content:p${i}`) })), [["pages", "Use até 20 páginas."]]);
  assert.deepEqual(issues(s, config({ exclude: Array.from({ length: 21 }, (_, i) => `content:p${i}`), pages: ["any"] })), [["exclude", "Use até 20 páginas."]]);
  assert.deepEqual(issues(s, config({ exclude: ["home"], pages: ["home", "saved"] })), [["exclude", "Esta página está em “Onde aparece” e em “Nunca nestas páginas”."]]);
  assert.deepEqual(issues(s, config({ exclude: ["lesson:*"], pages: ["lesson:a"] })), [["exclude", "Com essas exceções, o pop-up não aparece em nenhuma página."]]);
  assert.deepEqual(issues(s, config({ exclude: ["any"], pages: ["home"] })), [["exclude", "Escolha páginas da lista."]]);
  assert.deepEqual(issues(s, config({ pages: ["checkout:a"] })), [["pages.0", "Escolha páginas da lista."]]);
  assert.deepEqual(issues(s, config({ pages: ["home"], trigger: "lesson_completed" })), [["pages", "Ao concluir uma aula vale só para páginas de aula."]]);
  assert.deepEqual(issues(s, config({ pages: ["lesson:*"], trigger: "lesson_completed" })), []);
  assert.deepEqual(issues(s, config({ trigger: "at_start" })), [["trigger", "Escolha quando o pop-up aparece."]], "a v3b-2 ainda nao");
  assert.deepEqual(issues(s, config({ delaySeconds: 601 })), [["delaySeconds", "Use de 0 a 600 segundos."]]);
  assert.deepEqual(issues(s, config({ delaySeconds: 1.5 })), [["delaySeconds", "Use de 0 a 600 segundos."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ maxPerDay: 0 }) })), [["frequency.maxPerDay", "Use de 1 a 100 vezes por dia."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ maxPerDay: 101 }) })), [["frequency.maxPerDay", "Use de 1 a 100 vezes por dia."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ everyMinutes: 129_601 }) })), [["frequency.everyMinutes", "Use de 1 minuto a 90 dias."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ everyMinutes: 0 }) })), [["frequency.everyMinutes", "Use de 1 minuto a 90 dias."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ maxTotal: 1 }) })), [["frequency.maxTotal", "Use de 2 a 1.000 vezes. Para uma vez só, escolha “Uma vez”."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ stopOn: "close" }) })), [["frequency.stopOn", "Escolha quando o pop-up para de aparecer."]]);
  assert.deepEqual(issues(s, config({ frequency: { mode: "sempre" } })), [["frequency.mode", "Escolha quantas vezes o pop-up aparece."]]);
  assert.deepEqual(issues(s, config({ snoozeMinutes: 4 })), [["snoozeMinutes", "Use de 5 minutos a 7 dias."]]);
  assert.deepEqual(issues(s, config({ snoozeMinutes: 10_081 })), [["snoozeMinutes", "Use de 5 minutos a 7 dias."]]);
  assert.deepEqual(issues(s, config({ close: "fora" })), [["close", "Escolha como o aluno fecha o pop-up."]]);
  assert.deepEqual(issues(s, config({ frequency: repetir({ everyMinutes: 1, maxPerDay: 100, maxTotal: 1000, stopOn: "never" }), snoozeMinutes: 5 })), []);
});

test("rascunho do pop-up: 'Quando o aluno clica no botão' sem botao e recusado; a notificacao ignora a chave popup", () => {
  const popup = (extra = {}) => ({ ...schemas.emptyNoticeDraft("popup"), title: "Turma nova", ...extra });
  const botao = { href: "/minhas-compras", label: "Ver", target: "same_tab" };
  const repetirAteClicar = { ...model.POPUP_SETTINGS_DEFAULT, frequency: repetir({ maxPerDay: 1 }) };

  assert.deepEqual(issues(schemas.noticeDraftSchema, popup({ popup: repetirAteClicar, repeat: "until_action" })), [
    ["popup.frequency.stopOn", "Este pop-up não tem botão: escolha quando ele para de aparecer."]
  ]);
  assert.deepEqual(issues(schemas.noticeDraftSchema, popup({ cta: botao, popup: repetirAteClicar, repeat: "until_action" })), []);
  assert.deepEqual(
    issues(schemas.noticeDraftSchema, popup({ popup: { ...repetirAteClicar, frequency: repetir({ maxPerDay: 1, stopOn: "never" }) }, repeat: "until_action" })),
    []
  );
  assert.deepEqual(issues(schemas.noticeDraftSchema, popup()), []);
  assert.deepEqual(issues(schemas.noticeDraftSchema, popup({ popup: undefined })), [], "rascunho da v1/v3a sem a chave");

  const parsed = schemas.noticeDraftSchema.parse(popup({ popup: { ...model.POPUP_SETTINGS_DEFAULT, pages: ["saved", "home"] } }));
  assert.deepEqual(parsed.popup.pages, ["home", "saved"], "o schema devolve a forma canonica");

  const notificacao = { ...schemas.emptyNoticeDraft("inbox"), body: "Texto", popup: { pages: [] }, title: "Aula" };
  assert.deepEqual(issues(schemas.noticeDraftSchema, notificacao), [], "notificacao com popup invalido: nunca um erro");
  assert.equal("popup" in schemas.noticeDraftSchema.parse(notificacao), false, "e a chave sai");
});
