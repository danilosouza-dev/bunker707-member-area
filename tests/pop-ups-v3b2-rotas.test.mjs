import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Pop-ups da v3b-2 no servidor (docs/29 §4.4 e §4.5), sem banco: um banco falso (copia enxuta do de
// tests/pop-ups-v3b1-rotas.test.mjs, que e interno daquele arquivo) que conta as idas, com a RPC da abertura
// simulada. Aqui: o resumo numa pagina coberta so por um agendado (uma leitura, item com startsAt) e numa fora
// (nenhuma); o show do agendado (409 not_started com o Comeca no segmento, 404 fora, 200 na hora com o relogio
// injetado); o show de "Ao concluir um curso" (curso completo no banco: 200; incompleto: 409 trigger sem
// gravar; a leitura do curso so nesse momento); a rota de progresso (courseCompleted so na virada, nunca para a
// equipe, o "antes" e o da gravacao e nao o da leitura do acesso).

const estado = (globalThis.__popupV3b2Rotas ??= { acesso: null, gravar: null, user: null });
const cacheDoNext = new URL("./support/integration-next-cache.mjs", import.meta.url).href;

function modulo(source) {
  return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/guards") {
      return modulo(`
        export async function requireApiSessionUser() {
          const user = globalThis.__popupV3b2Rotas.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiUser = requireApiSessionUser;`);
    }

    // A rota de progresso: o acesso e a gravacao viram dubles controlados pelo teste.
    if (specifier === "@/server/access/lesson-access") {
      return modulo(`export async function requireLessonsAccess(input) { return globalThis.__popupV3b2Rotas.acesso(input); }`);
    }

    if (specifier === "@/server/db/platform-store") {
      return modulo(`export async function replaceCompletedLessonsWithPrevious(input) { return globalThis.__popupV3b2Rotas.gravar(input); }`);
    }

    if (specifier === "next/cache") {
      return { shortCircuit: true, url: cacheDoNext };
    }

    return nextResolve(specifier, context);
  }
});

const summaryRoute = await import("../src/app/api/notifications/summary/route.ts");
const showRoute = await import("../src/app/api/popups/[id]/show/route.ts");
const progressRoute = await import("../src/app/api/progress/lessons/route.ts");
const popups = await import("../src/server/communications/popups.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const POPUP = "cccccccc-0000-4000-8000-000000000001";
const CURSO = "curso-agentes";
let proximoAluno = 100;
let proximaVersao = 1;

function novoAluno() {
  proximoAluno += 1;
  estado.user = { id: `66666666-6666-4666-8666-${String(proximoAluno).padStart(12, "0")}` };
  return estado.user.id;
}

const iso = (time) => new Date(time).toISOString();

function novaVersao() {
  proximaVersao += 1;
  return `2026-10-23T12:00:00.${String(proximaVersao).padStart(6, "0")}+00:00`;
}

function passa(row, [op, column, value]) {
  switch (op) {
    case "eq":
      return row[column] === value;
    case "in":
      return value.includes(row[column]);
    case "is":
      return row[column] === value || (value === null && row[column] === undefined);
    case "or": {
      const depois = /ends_at\.gt\."([^"]+)"/.exec(column)?.[1];
      return row.ends_at === null || row.ends_at === undefined || (depois !== undefined && row.ends_at > depois);
    }
    default:
      return true;
  }
}

function projetar(row, columns) {
  return !columns || columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((column) => [column, row[column]]));
}

function aberturaSimulada(args, tables) {
  const row = tables.campaign_deliveries.find((item) => item.campaign_id === args.p_campaign_id && item.user_id === args.p_user_id);

  if (!row || row.updated_at !== args.p_expected_updated_at || !row.eligible) {
    return null;
  }

  row.day_impressions = 1;
  row.impressions += 1;
  row.last_seen_at = args.p_now;
  row.updated_at = novaVersao();

  return { day_impressions: row.day_impressions, impressions: row.impressions };
}

/** Banco falso: tabelas em memoria, select com filtros (eq, in, is, or da lista no ar), insert e a RPC da abertura. */
function banco(tables) {
  const all = { campaign_deliveries: [], campaigns: [], course_modules: [], lesson_progress: [], lessons: [], ...tables };
  const calls = { from: [], inserts: [], rpc: [] };
  const rpcs = { communication_inbox_counts: () => ({ unread: 0, unseen: 0 }), communication_record_popup_impression: aberturaSimulada };

  function chain(resolve) {
    const state = { filters: [], single: false };
    const c = {
      eq: (column, value) => (state.filters.push(["eq", column, value]), c),
      in: (column, value) => (state.filters.push(["in", column, value]), c),
      is: (column, value) => (state.filters.push(["is", column, value]), c),
      limit: (value) => ((state.limit = value), c),
      maybeSingle: () => ((state.single = true), c),
      or: (expression) => (state.filters.push(["or", expression]), c),
      order: () => c,
      select: (columns) => ((state.select = columns), c),
      then: (ok, fail) => Promise.resolve().then(() => resolve(state)).then(ok, fail)
    };
    return c;
  }

  const db = {
    calls,
    from(table) {
      calls.from.push(table);
      return {
        insert(payload) {
          calls.inserts.push({ payload, table });
          return chain(() => ({ data: null, error: null }));
        },
        select(columns) {
          return chain((state) => {
            const rows = (all[table] ?? [])
              .filter((row) => state.filters.every((filter) => passa(row, filter)))
              .slice(0, state.limit ?? undefined)
              .map((row) => projetar(row, columns));
            return { data: state.single ? (rows[0] ?? null) : rows, error: null };
          });
        }
      };
    },
    rpc(name, args) {
      calls.rpc.push({ args, name });
      return chain(() => ({ data: rpcs[name] ? rpcs[name](args, all) : null, error: null }));
    }
  };
  actionStubs.db = db;
  return db;
}

function popupNoAr(extra = {}) {
  const agora = Date.now();

  return {
    allow_snooze: true,
    audio_duration_seconds: null,
    audio_mime: null,
    audio_peaks: null,
    audio_url: null,
    body: "A live comeca agora.",
    created_at: iso(agora - 2 * HORA),
    cta_href: null,
    cta_label: null,
    cta_target: null,
    deleted_at: null,
    ends_at: null,
    icon: null,
    icon_color: null,
    id: POPUP,
    image_alt: null,
    image_url: null,
    kind: "popup",
    popup_access_products: [],
    popup_close: "any",
    popup_delay_seconds: 3,
    popup_every_minutes: null,
    popup_exclude_pages: [],
    popup_frequency: "once",
    popup_max_per_day: null,
    popup_max_total: null,
    popup_pages: ["saved"],
    popup_repeat: "once",
    popup_snooze_minutes: 1440,
    popup_stop_on: null,
    popup_trigger: "page_load",
    sent_at: iso(agora - HORA),
    starts_at: null,
    status: "active",
    title: "Live hoje",
    ...extra
  };
}

function linha(userId, extra = {}) {
  return {
    campaign_id: POPUP,
    clicked_at: null,
    day_impressions: 0,
    dismissed_at: null,
    eligible: true,
    impressions: 0,
    impressions_before_reshow: 0,
    last_seen_at: null,
    reshown_at: null,
    snooze_count: 0,
    snoozed_until: null,
    snoozes_before_reshow: 0,
    updated_at: novaVersao(),
    user_id: userId,
    ...extra
  };
}

const leiturasDe = (db, table) => db.calls.from.filter((item) => item === table).length;
const aberturas = (db) => db.calls.rpc.filter((call) => call.name === "communication_record_popup_impression");

async function resumo(query) {
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary${query}`));
  return { body: await response.json(), status: response.status };
}

async function mostrar(id, body) {
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  return { body: await response.json(), status: response.status };
}

/* ------------------------------------------------------------------------------------------------
 * Resumo e show do agendado
 * ---------------------------------------------------------------------------------------------- */

test("resumo: pagina coberta so por um agendado = uma leitura e o item com startsAt; pagina fora = nenhuma leitura", async () => {
  const aluno = novoAluno();
  const comeca = iso(Date.now() + HORA);
  const db = banco({ campaign_deliveries: [linha(aluno)], campaigns: [popupNoAr({ starts_at: comeca })] });

  const coberta = await resumo("?page=saved");
  assert.equal(coberta.status, 200);
  assert.deepEqual(coberta.body.data.popups.pages, ["saved"], "o mapa cobre a pagina do agendado");
  assert.equal(leiturasDe(db, "campaign_deliveries"), 1);
  assert.deepEqual(coberta.body.data.popups.plan, [
    { delaySeconds: 3, exclude: [], id: POPUP, notBefore: comeca, pages: ["saved"], startsAt: comeca, stopOn: null, trigger: "page_load" }
  ]);

  const fora = await resumo("?page=profile");
  assert.equal(fora.body.data.popups.plan, null);
  assert.equal(leiturasDe(db, "campaign_deliveries"), 1, "nenhuma leitura a mais");
});

test("show do agendado: 409 not_started com o Comeca no segmento; 404 fora; com o relogio na hora, 200 e a abertura gravada", async () => {
  const aluno = novoAluno();
  const comeca = Date.now() + HORA;
  const db = banco({ campaign_deliveries: [linha(aluno)], campaigns: [popupNoAr({ starts_at: iso(comeca) })] });

  const antes = await mostrar(POPUP, { page: "saved", trigger: "page_load" });
  assert.equal(antes.status, 409);
  assert.deepEqual(antes.body, { error: "Pop-up fora da vez.", nextAt: iso(comeca), reason: "not_started" });
  assert.deepEqual(aberturas(db), [], "nada gravado antes da hora");

  await assert.rejects(popups.showPopup(aluno, POPUP, { page: "saved", trigger: "page_load" }, comeca - 1), (error) => {
    assert.ok(error instanceof popups.PopupRefusedError);
    assert.equal(error.reason, "not_started");
    assert.equal(error.nextAt, iso(comeca));
    return true;
  });

  const naHora = await popups.showPopup(aluno, POPUP, { page: "saved", trigger: "page_load" }, comeca + 3_000);
  assert.equal(naHora.popup.title, "Live hoje");
  assert.equal(aberturas(db).length, 1);
  assert.equal(aberturas(db)[0].args.p_now, iso(comeca + 3_000));

  novoAluno();
  const fora = await mostrar(POPUP, { page: "saved", trigger: "page_load" });
  assert.equal(fora.status, 404, "quem nao esta no segmento nao fica sabendo do agendado");
  assert.deepEqual(fora.body, { error: "Pop-up nao encontrado." });
});

/* ------------------------------------------------------------------------------------------------
 * Ao concluir um curso
 * ---------------------------------------------------------------------------------------------- */

function cursoNoBanco(aluno, concluidas) {
  return {
    course_modules: [
      { id: "m1", owner_id: CURSO, status: "published" },
      { id: "m-rascunho", owner_id: CURSO, status: "draft" }
    ],
    lesson_progress: [{ completed_lesson_ids: concluidas, content_id: CURSO, user_id: aluno }],
    lessons: [
      { id: "a1", module_id: "m1", status: "published" },
      { id: "a2", module_id: "m1", status: "published" },
      { id: "a3", module_id: "m1", status: "draft" },
      { id: "a4", module_id: "m-rascunho", status: "published" }
    ]
  };
}

test("show de 'Ao concluir um curso': curso completo no banco = 200; incompleto = 409 trigger sem gravar", async () => {
  const aluno = novoAluno();
  const pop = popupNoAr({ popup_pages: ["lesson:*"], popup_trigger: "course_completed" });
  const completo = banco({ ...cursoNoBanco(aluno, ["a1", "a2"]), campaign_deliveries: [linha(aluno)], campaigns: [pop] });

  const ok = await mostrar(POPUP, { page: `lesson:${CURSO}`, trigger: "course_completed" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(aberturas(completo).length, 1);
  assert.equal(leiturasDe(completo, "lesson_progress"), 1);
  assert.equal(leiturasDe(completo, "course_modules"), 1);
  assert.equal(leiturasDe(completo, "lessons"), 1);
  const eventos = completo.calls.inserts.filter((insert) => insert.table === "student_events").flatMap((insert) => insert.payload);
  assert.deepEqual(eventos.map((evento) => evento.metadata), [{ campaign_id: POPUP, page: `lesson:${CURSO}`, trigger: "course_completed" }]);

  const outro = novoAluno();
  const incompleto = banco({ ...cursoNoBanco(outro, ["a1", "a3", "a4"]), campaign_deliveries: [linha(outro)], campaigns: [pop] });
  const recusa = await mostrar(POPUP, { page: `lesson:${CURSO}`, trigger: "course_completed" });
  assert.equal(recusa.status, 409);
  assert.deepEqual(recusa.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "trigger" }, "aula em rascunho ou de modulo em rascunho nao conta");
  assert.deepEqual(aberturas(incompleto), [], "o aviso forjado da pagina nao grava nada");

  const semProgresso = novoAluno();
  banco({ ...cursoNoBanco("outra-pessoa", ["a1", "a2"]), campaign_deliveries: [linha(semProgresso)], campaigns: [pop] });
  assert.equal((await mostrar(POPUP, { page: `lesson:${CURSO}`, trigger: "course_completed" })).status, 409, "sem linha de progresso");
});

test("a leitura do curso so acontece no momento 'Ao concluir um curso'", async () => {
  const aluno = novoAluno();
  const db = banco({
    ...cursoNoBanco(aluno, ["a1", "a2"]),
    campaign_deliveries: [linha(aluno)],
    campaigns: [popupNoAr({ popup_pages: ["lesson:*"], popup_trigger: "lesson_completed" })]
  });

  assert.equal((await mostrar(POPUP, { page: `lesson:${CURSO}`, trigger: "lesson_completed" })).status, 200);
  assert.equal(leiturasDe(db, "lesson_progress") + leiturasDe(db, "course_modules") + leiturasDe(db, "lessons"), 0);

  const outro = novoAluno();
  const primeiro = banco({
    ...cursoNoBanco(outro, []),
    campaign_deliveries: [linha(outro)],
    campaigns: [popupNoAr({ popup_pages: ["home"], popup_trigger: "first_login" })]
  });
  assert.equal((await mostrar(POPUP, { page: "home", trigger: "first_login" })).status, 200);
  assert.equal(leiturasDe(primeiro, "lesson_progress") + leiturasDe(primeiro, "course_modules"), 0);
});

/* ------------------------------------------------------------------------------------------------
 * Rota de progresso
 * ---------------------------------------------------------------------------------------------- */

async function progresso(body, method = "PUT") {
  const response = await progressRoute[method](
    new Request("http://localhost/api/progress/lessons", { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method })
  );
  return { body: await response.json(), status: response.status };
}

function registro(concluidas) {
  return { completedLessonIds: concluidas, contentId: CURSO, lessonReactions: {}, lessonWatchStates: {}, updatedAt: new Date().toISOString(), userId: estado.user.id };
}

test("progresso: courseCompleted so no pedido que fecha o curso; o 'antes' e o da gravacao, nunca o da leitura do acesso", async () => {
  novoAluno();
  let antes = ["a1"];
  let depois = ["a1", "a2"];
  const gravados = [];
  estado.acesso = async (input) => ({ contentId: input.contentId, isAdmin: false, lessonIds: input.lessonIds, lessonVideoConfigs: {}, publishedLessonIds: ["a1", "a2"] });
  estado.gravar = async (input) => {
    gravados.push(input);
    return { previousCompletedLessonIds: antes, record: registro(depois) };
  };

  const virada = await progresso({ completedLessonIds: ["a1", "a2"], contentId: CURSO, lessonId: "a2", status: "completed" });
  assert.equal(virada.status, 200);
  assert.equal(virada.body.courseCompleted, true);
  assert.deepEqual(virada.body.data.completedLessonIds, ["a1", "a2"]);
  assert.equal(gravados.at(-1).contentId, CURSO);

  antes = ["a1", "a2"];
  const deNovo = await progresso({ completedLessonIds: ["a1", "a2"], contentId: CURSO, lessonId: "a2", status: "completed" });
  assert.deepEqual(Object.keys(deNovo.body), ["data"], "ja estava completo: sem a chave");

  antes = [];
  depois = ["a1"];
  const metade = await progresso({ completedLessonIds: ["a1"], contentId: CURSO, lessonId: "a1", status: "completed" });
  assert.deepEqual(Object.keys(metade.body), ["data"], "ainda falta aula");

  // A leitura do acesso "velha" (como se ja viesse sem nada concluido) nao muda a resposta: vale o da gravacao.
  antes = ["a1", "a2"];
  depois = ["a1", "a2"];
  estado.acesso = async (input) => ({ completedLessonIds: [], contentId: input.contentId, isAdmin: false, lessonIds: input.lessonIds, lessonVideoConfigs: {}, publishedLessonIds: ["a1", "a2"] });
  assert.deepEqual(Object.keys((await progresso({ contentId: CURSO, lessonId: "a2", progressSeconds: 30 })).body), ["data"]);

  // O beacon de saida (POST) e o mesmo handler.
  antes = ["a1"];
  assert.equal((await progresso({ completedLessonIds: ["a1", "a2"], contentId: CURSO, lessonId: "a2", status: "completed" }, "POST")).body.courseCompleted, true);
});

test("progresso: a equipe nunca recebe courseCompleted; pedido invalido continua 400 sem gravar", async () => {
  novoAluno();
  let gravou = 0;
  estado.acesso = async (input) => ({ contentId: input.contentId, isAdmin: true, lessonIds: input.lessonIds, lessonVideoConfigs: {}, publishedLessonIds: null });
  estado.gravar = async () => {
    gravou += 1;
    return { previousCompletedLessonIds: ["a1"], record: registro(["a1", "a2"]) };
  };

  const equipe = await progresso({ completedLessonIds: ["a1", "a2"], contentId: CURSO, lessonId: "a2", status: "completed" });
  assert.equal(equipe.status, 200);
  assert.deepEqual(Object.keys(equipe.body), ["data"]);

  const invalido = await progresso({ contentId: CURSO });
  assert.equal(invalido.status, 400);
  assert.equal(gravou, 1);
});
