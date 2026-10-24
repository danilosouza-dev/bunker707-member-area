import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Pop-ups da v3b-1 no servidor (docs/25 §4.3 a §4.8 e §5.1), sem banco: um banco falso (copia propria do de
// tests/sino-servidor-v3.test.mjs, que e interno daquele arquivo) que conta as idas e guarda as escritas, com
// a RPC da abertura simulada (compara o updated_at como texto). O cache do Next vira passagem direta e o
// after() do Next, fora de um pedido, roda na hora (o fallback da rota). Aqui: o resumo nao le linha de aluno
// em pagina que nenhum pop-up cobre e le uma so na pagina coberta; o mapa nunca leva id de produto; o
// ?popup=1 da v1 continua igual; o show (400/404/409/200, o updated_at exato, os 5 s, o teto de 100 eventos
// por dia); o limite de 30 chamadas de pop-up por minuto (chave propria, sem gastar a do sino); os eventos
// (jeito de fechar so no historico, "Volta em" do pop-up, o "impressed" da v1 pela RPC) e a falha da
// leitura das formacoes, que nunca derruba os pop-ups.

const sessao = (globalThis.__popupRotasSessao ??= { user: null });
const cacheDoNext = new URL("./support/integration-next-cache.mjs", import.meta.url).href;

// A sessao das rotas (requireApiSessionUser) vem do teste; o cache do Next vira passagem direta.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/guards") {
      const source = `
        export async function requireApiSessionUser() {
          const user = globalThis.__popupRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiUser = requireApiSessionUser;`;

      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier === "next/cache") {
      return { shortCircuit: true, url: cacheDoNext };
    }

    return nextResolve(specifier, context);
  }
});

const limit = await import("../src/server/communications/student-write-limit.ts");
const { popupDayBounds } = await import("../src/server/communications/popup-display-model.ts");
const summaryRoute = await import("../src/app/api/notifications/summary/route.ts");
const showRoute = await import("../src/app/api/popups/[id]/show/route.ts");
const eventsRoute = await import("../src/app/api/popups/[id]/events/route.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const POPUP = "bbbbbbbb-0000-4000-8000-000000000001";
const OUTRO = "bbbbbbbb-0000-4000-8000-000000000002";
const TERCEIRO = "bbbbbbbb-0000-4000-8000-000000000003";
let proximoAluno = 100;
let proximaVersao = 1;

/** Um aluno novo por teste: o limite de chamadas e por aluno e vive no modulo. */
function novoAluno() {
  proximoAluno += 1;
  sessao.user = { id: `44444444-4444-4444-8444-${String(proximoAluno).padStart(12, "0")}` };
  return sessao.user.id;
}

const iso = (time) => new Date(time).toISOString();

/** updated_at como o PostgREST devolve (microssegundos, +00:00): por new Date() a comparacao nunca bateria. */
function novaVersao() {
  proximaVersao += 1;
  return `2026-10-22T12:00:00.${String(proximaVersao).padStart(6, "0")}+00:00`;
}

/** Valor da coluna; "settings->>parentFormationId" le dentro do json. */
function valorDe(row, column) {
  const json = /^([a-z_]+)->>([A-Za-z_]+)$/.exec(column);

  return json ? (row[json[1]]?.[json[2]] ?? null) : row[column];
}

function passa(row, [op, column, value]) {
  switch (op) {
    case "eq":
      return valorDe(row, column) === value;
    case "in":
      return value.includes(valorDe(row, column));
    case "is":
      return valorDe(row, column) === value || (value === null && valorDe(row, column) === undefined);
    case "or": {
      // So o filtro da lista no ar: ends_at.is.null,ends_at.gt."<agora>".
      const depois = /ends_at\.gt\."([^"]+)"/.exec(column)?.[1];
      return row.ends_at === null || row.ends_at === undefined || (depois !== undefined && row.ends_at > depois);
    }
    default:
      return true;
  }
}

/** As colunas pedidas no select (com apelido "nome:coluna->>chave"), como o PostgREST devolve. */
function projetar(row, columns) {
  if (!columns || columns === "*") {
    return { ...row };
  }

  return Object.fromEntries(
    columns.split(",").map((item) => {
      const [alias, source] = item.includes(":") ? item.split(":") : [item, item];
      return [alias, valorDe(row, source)];
    })
  );
}

/** A RPC 5.1 simulada: grava so com o updated_at lido (texto igual), elegivel, sem dispensa e pop-up publicado. */
function aberturaSimulada(args, tables) {
  const row = (tables.campaign_deliveries ?? []).find((item) => item.campaign_id === args.p_campaign_id && item.user_id === args.p_user_id);
  const campanha = (tables.campaigns ?? []).find((item) => item.id === args.p_campaign_id);

  if (!row || row.updated_at !== args.p_expected_updated_at || !row.eligible || row.dismissed_at || !campanha || campanha.status !== "active") {
    return null;
  }

  const hoje = row.last_seen_at && row.last_seen_at >= args.p_day_start && (!row.reshown_at || row.last_seen_at > row.reshown_at);
  row.day_impressions = hoje ? Math.min(Math.max(row.day_impressions, 1) + 1, 1000) : 1;
  row.impressions += 1;
  row.first_seen_at ??= args.p_now;
  row.last_seen_at = args.p_now;
  row.updated_at = novaVersao();

  return { day_impressions: row.day_impressions, impressions: row.impressions };
}

/**
 * Banco falso: cada tabela e uma lista em memoria (select com filtros e projecao, update com os filtros,
 * insert); `rpc[nome](args, tables)` devolve o que o teste quiser (a abertura e os numeros do sino ja vem
 * simulados); `falhas[tabela]` faz o select daquela tabela devolver o erro. Conta toda ida em `calls`.
 */
function bancoFalso({ falhas = {}, rpc = {}, tables = {} } = {}) {
  const calls = { from: [], inserts: [], rpc: [], selects: [], updates: [] };
  const rpcs = { communication_inbox_counts: () => ({ unread: 0, unseen: 2 }), communication_record_popup_impression: aberturaSimulada, ...rpc };

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

  return {
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
            calls.selects.push({ columns, filters: state.filters, limit: state.limit, table });

            if (falhas[table]) {
              return { data: null, error: falhas[table] };
            }

            const rows = (tables[table] ?? [])
              .filter((row) => state.filters.every((filter) => passa(row, filter)))
              .slice(0, state.limit ?? undefined)
              .map((row) => projetar(row, columns));
            return { data: state.single ? (rows[0] ?? null) : rows, error: null };
          });
        },
        update(patch) {
          return chain((state) => {
            const rows = (tables[table] ?? []).filter((row) => state.filters.every((filter) => passa(row, filter)));
            calls.updates.push({ filters: state.filters, patch, table });
            rows.forEach((row) => Object.assign(row, patch, { updated_at: novaVersao() }));
            return { data: rows.map((row) => projetar(row, state.select)), error: null };
          });
        }
      };
    },
    rpc(name, args) {
      calls.rpc.push({ args, name });
      return chain(() => {
        if (falhas[`rpc:${name}`]) {
          return { data: null, error: falhas[`rpc:${name}`] };
        }

        return { data: rpcs[name] ? rpcs[name](args, tables) : null, error: null };
      });
    }
  };
}

/** Um pop-up publicado como a tabela campaigns guarda (padrao: so no Inicio, 3 s, Uma vez, fecha em qualquer lugar). */
function popupNoAr(extra = {}) {
  const agora = Date.now();

  return {
    allow_snooze: true,
    audio_duration_seconds: null,
    audio_mime: null,
    audio_peaks: null,
    audio_url: null,
    body: "A turma nova começa segunda.",
    created_at: iso(agora - 2 * HORA),
    cta_href: "/minhas-compras",
    cta_label: "Ver minhas compras",
    cta_target: "same_tab",
    deleted_at: null,
    ends_at: null,
    icon: null,
    icon_color: null,
    id: POPUP,
    image_alt: null,
    image_url: null,
    kind: "popup",
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
    sent_at: iso(agora - HORA),
    starts_at: null,
    status: "active",
    title: "Turma nova",
    ...extra
  };
}

/** "Mais de uma vez" com os numeros dados (o resto nulo), parando no clique. */
function maisDeUmaVez(extra = {}) {
  return { popup_frequency: "repeat", popup_repeat: "until_action", popup_stop_on: "click", ...extra };
}

/** A linha do aluno em campaign_deliveries (elegivel, nunca viu). */
function linha(userId, extra = {}) {
  return {
    campaign_id: POPUP,
    clicked_at: null,
    day_impressions: 0,
    dismissed_at: null,
    eligible: true,
    first_seen_at: null,
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

function banco({ campaigns = [], deliveries = [], ...rest } = {}) {
  const db = bancoFalso({ ...rest, tables: { campaign_deliveries: deliveries, campaigns, ...(rest.tables ?? {}) } });
  actionStubs.db = db;
  return db;
}

const leiturasDeLinhas = (db) => db.calls.from.filter((table) => table === "campaign_deliveries").length;
const eventos = (db) => db.calls.inserts.filter((insert) => insert.table === "student_events").flatMap((insert) => insert.payload);

async function resumo(query) {
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary${query}`));
  return { body: await response.json(), headers: response.headers, status: response.status };
}

async function mostrar(id, body) {
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );
  const corpo = await response.json();

  // v3b-2: todo 409 traz a hora do servidor (asOf, ISO, nunca no futuro); conferida aqui e tirada do corpo para
  // os testes compararem o resto palavra por palavra.
  if (response.status === 409) {
    const { asOf, ...resto } = corpo;
    assert.match(asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "o 409 traz asOf");
    assert.ok(Date.parse(asOf) <= Date.now());
    return { asOf, body: resto, headers: response.headers, status: response.status };
  }

  return { body: corpo, headers: response.headers, status: response.status };
}

/** Evento como o navegador manda no sendBeacon: corpo JSON em text/plain. */
async function evento(id, body) {
  const response = await eventsRoute.POST(
    new Request(`http://localhost/api/popups/${id}/events`, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "text/plain;charset=UTF-8" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );
  return { body: await response.json(), headers: response.headers, status: response.status };
}

const NA_HOME = { page: "home", trigger: "page_load" };

test("sem pop-up no ar: o resumo com ?page= traz o mapa vazio e plano null, sem ler linha de aluno", async () => {
  novoAluno();
  const db = banco();

  const { body, headers, status } = await resumo("?page=home");

  assert.equal(status, 200);
  assert.equal(headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(body.data.popups.pages, []);
  assert.equal(body.data.popups.plan, null);
  assert.ok(Number.isFinite(Date.parse(body.data.popups.asOf)), "asOf e a hora do servidor");
  assert.equal(body.data.popup, null);
  assert.equal(body.data.unseen, 2);
  assert.equal(leiturasDeLinhas(db), 0);
});

test("pagina que nenhum pop-up cobre: mapa grosso e plano null, sem ler linha; a lista no ar e lida com folga (60)", async () => {
  const aluno = novoAluno();
  const db = banco({ campaigns: [popupNoAr({ popup_pages: ["lesson:teste-curso-agentes"], popup_trigger: "lesson_completed" })], deliveries: [linha(aluno)] });

  const { body } = await resumo("?page=home");

  assert.deepEqual(body.data.popups.pages, ["lesson:*"]);
  assert.equal(body.data.popups.plan, null);
  assert.equal(leiturasDeLinhas(db), 0);
  assert.equal(db.calls.selects.find((call) => call.table === "campaigns").limit, 60);
});

test("pagina coberta: uma leitura so das linhas do aluno; o plano leva ids, paginas e horarios, nunca o conteudo", async () => {
  const aluno = novoAluno();
  const db = banco({
    campaigns: [popupNoAr({ ...maisDeUmaVez(), popup_exclude_pages: ["profile"], popup_pages: ["any"] })],
    deliveries: [linha(aluno), linha("55555555-5555-4555-8555-000000000001")]
  });

  const { body } = await resumo("?page=content%3Ateste-curso-agentes");

  assert.equal(leiturasDeLinhas(db), 1);
  assert.deepEqual(body.data.popups.pages, ["any"]);
  assert.deepEqual(body.data.popups.plan, [
    { delaySeconds: 3, exclude: ["profile"], id: POPUP, notBefore: null, pages: ["any"], stopOn: "click", trigger: "page_load" }
  ]);
  assert.ok(!JSON.stringify(body.data.popups).includes("Turma nova"), "o conteudo so vem no show");
  const leitura = db.calls.selects.find((call) => call.table === "campaign_deliveries");
  assert.deepEqual(
    leitura.filters.map(([op, column]) => [op, column]),
    [
      ["eq", "user_id"],
      ["in", "campaign_id"]
    ]
  );
});

test("o mapa das paginas nunca leva id de produto; chave de pagina invalida e ignorada (sem `popups`)", async () => {
  const aluno = novoAluno();
  banco({
    campaigns: [
      popupNoAr({ popup_pages: ["content:formacao-ia-generativa", "lesson:curso-secreto", "profile"] }),
      popupNoAr({ id: OUTRO, popup_pages: ["home"] })
    ],
    deliveries: [linha(aluno), linha(aluno, { campaign_id: OUTRO })]
  });

  const { body } = await resumo("?page=profile");
  assert.deepEqual(body.data.popups.pages, ["home", "profile", "content:*", "lesson:*"]);
  assert.ok(!JSON.stringify(body.data.popups.pages).includes("formacao-ia"));
  assert.ok(!JSON.stringify(body.data.popups.pages).includes("secreto"));

  for (const query of ["?page=%2Fadmin", "?page=any", "?page=content%3A*", "?page="]) {
    const invalida = await resumo(query);
    assert.equal(invalida.status, 200);
    assert.deepEqual(invalida.body.data, { popup: null, unseen: 2 }, query);
  }
});

test("?popup=1 da v1 continua igual: o objeto da v1 (sem `close`, sem `popups`) e nada gravado; sem parametro, so o numero", async () => {
  const aluno = novoAluno();
  const db = banco({
    campaigns: [popupNoAr(), popupNoAr({ id: OUTRO, popup_pages: ["lesson:teste-curso-agentes"], popup_trigger: "lesson_completed", starts_at: iso(Date.now() - MIN) })],
    deliveries: [linha(aluno), linha(aluno, { campaign_id: OUTRO })]
  });

  const { body } = await resumo("?popup=1");

  assert.deepEqual(body.data, {
    popup: {
      audio: null,
      body: "A turma nova começa segunda.",
      canSnooze: true,
      cta: { href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" },
      id: POPUP,
      image: null,
      title: "Turma nova"
    },
    unseen: 2
  });
  assert.deepEqual(db.calls.rpc.map((call) => call.name), ["communication_inbox_counts"], "o ?popup=1 nao grava abertura");
  assert.deepEqual(db.calls.updates, []);

  assert.deepEqual((await resumo("")).body.data, { popup: null, unseen: 2 });
});

test("show 200: grava pela RPC com o updated_at exato lido e o dia de Sao Paulo; o pop-up padrao e o objeto da v1; 'Uma vez' nao volta (next null)", async () => {
  const aluno = novoAluno();
  const versaoLida = novaVersao();
  const db = banco({ campaigns: [popupNoAr()], deliveries: [linha(aluno, { updated_at: versaoLida })] });

  const { body, status } = await mostrar(POPUP, NA_HOME);

  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.data, {
    next: null,
    popup: {
      audio: null,
      body: "A turma nova começa segunda.",
      canSnooze: true,
      cta: { href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" },
      id: POPUP,
      image: null,
      title: "Turma nova"
    }
  });

  const [rpc] = db.calls.rpc.filter((call) => call.name === "communication_record_popup_impression");
  assert.equal(rpc.args.p_expected_updated_at, versaoLida, "o texto exato do banco, com os microssegundos");
  assert.equal(rpc.args.p_campaign_id, POPUP);
  assert.equal(rpc.args.p_user_id, aluno);
  assert.equal(rpc.args.p_day_start, iso(popupDayBounds(Date.parse(rpc.args.p_now)).start));
  assert.equal(leiturasDeLinhas(db), 1, "uma leitura da linha pela chave primaria");

  assert.deepEqual(eventos(db), [
    {
      entity_id: POPUP,
      entity_type: "campaign",
      event_type: "message_impressed",
      metadata: { campaign_id: POPUP, page: "home", trigger: "page_load" },
      user_id: aluno
    }
  ]);
});

test("show 200 do 'Só no X' leva close: x_only; o 'next' diz quando pode voltar (5 s sem ritmo, o intervalo com ritmo)", async () => {
  const aluno = novoAluno();
  const db = banco({
    campaigns: [
      popupNoAr({ ...maisDeUmaVez({ popup_stop_on: "never" }), popup_close: "x_only", popup_pages: ["any"] }),
      popupNoAr({ ...maisDeUmaVez({ popup_every_minutes: 30 }), id: OUTRO, popup_pages: ["any"] })
    ],
    deliveries: [linha(aluno), linha(aluno, { campaign_id: OUTRO })]
  });

  const semRitmo = await mostrar(POPUP, { page: "saved", trigger: "page_load" });
  assert.equal(semRitmo.status, 200, JSON.stringify(semRitmo.body));
  assert.equal(semRitmo.body.data.popup.close, "x_only");
  const vista = db.calls.rpc.at(-1).args.p_now;
  assert.equal(Date.parse(semRitmo.body.data.next.notBefore) - Date.parse(vista), 5_000);

  const comRitmo = await mostrar(OUTRO, { page: "saved", trigger: "page_load" });
  assert.equal(comRitmo.status, 200);
  assert.equal("close" in comRitmo.body.data.popup, false, "fecha em qualquer lugar: sem a chave");
  assert.equal(Date.parse(comRitmo.body.data.next.notBefore) - Date.parse(db.calls.rpc.at(-1).args.p_now), 30 * MIN);

  const deNovo = await mostrar(POPUP, { page: "saved", trigger: "page_load" });
  assert.equal(deNovo.status, 409, "o mesmo pop-up nunca abre duas vezes em menos de 5 s");
  assert.deepEqual(deNovo.body, { error: "Pop-up fora da vez.", nextAt: semRitmo.body.data.next.notBefore, reason: "frequency" });
});

test("show 409: pagina de excecao, outro momento, frequencia (com nextAt) e linha mudada no meio (RPC devolve null)", async () => {
  const aluno = novoAluno();
  const vistaHa10Min = iso(Date.now() - 10 * MIN);
  banco({
    campaigns: [
      popupNoAr({ popup_exclude_pages: ["profile"], popup_pages: ["any"] }),
      popupNoAr({ ...maisDeUmaVez({ popup_every_minutes: 30 }), id: OUTRO }),
      popupNoAr({ id: TERCEIRO })
    ],
    deliveries: [
      linha(aluno),
      linha(aluno, { campaign_id: OUTRO, day_impressions: 1, impressions: 1, last_seen_at: vistaHa10Min }),
      linha(aluno, { campaign_id: TERCEIRO, impressions: 1, last_seen_at: iso(Date.now() - 3 * HORA) })
    ]
  });

  assert.deepEqual((await mostrar(POPUP, { page: "profile", trigger: "page_load" })).body, { error: "Pop-up fora da vez.", nextAt: null, reason: "page" });
  assert.deepEqual((await mostrar(POPUP, { page: "home", trigger: "lesson_completed" })).body, { error: "Pop-up fora da vez.", nextAt: null, reason: "trigger" });

  const intervalo = await mostrar(OUTRO, NA_HOME);
  assert.equal(intervalo.status, 409);
  assert.deepEqual(intervalo.body, { error: "Pop-up fora da vez.", nextAt: iso(Date.parse(vistaHa10Min) + 30 * MIN), reason: "frequency" });

  const umaVez = await mostrar(TERCEIRO, NA_HOME);
  assert.deepEqual(umaVez.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "frequency" }, "'Uma vez' visto: nunca mais");

  const db = banco({ campaigns: [popupNoAr()], deliveries: [linha(aluno)], rpc: { communication_record_popup_impression: () => null } });
  const mudou = await mostrar(POPUP, NA_HOME);
  assert.equal(mudou.status, 409);
  assert.deepEqual(mudou.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "changed" });
  assert.deepEqual(eventos(db), [], "recusado: nada no historico");
});

test("show 404 sem dizer se existe (desconhecido, fora do segmento, sem linha, pausado, janela futura fora do segmento) e 400 para pedido invalido", async () => {
  const aluno = novoAluno();
  banco({
    campaigns: [
      popupNoAr(),
      popupNoAr({ id: OUTRO, status: "paused" }),
      popupNoAr({ id: TERCEIRO, starts_at: iso(Date.now() + HORA) })
    ],
    // v3b-2 (D4): o agendado so responde 404 para quem esta fora do segmento (no segmento: 409 not_started, abaixo).
    deliveries: [linha(aluno, { eligible: false }), linha(aluno, { campaign_id: OUTRO }), linha(aluno, { campaign_id: TERCEIRO, eligible: false })]
  });

  for (const id of [POPUP, OUTRO, TERCEIRO, "bbbbbbbb-0000-4000-8000-000000000099"]) {
    const resposta = await mostrar(id, NA_HOME);
    assert.equal(resposta.status, 404, id);
    assert.deepEqual(resposta.body, { error: "Pop-up nao encontrado." });
  }

  novoAluno();
  assert.equal((await mostrar(POPUP, NA_HOME)).status, 404, "sem linha (a equipe nunca tem)");

  assert.deepEqual((await mostrar("nao-e-id", NA_HOME)).body, { error: "Pop-up invalido." });
  for (const body of [
    { page: "/perfil", trigger: "page_load" },
    { page: "any", trigger: "page_load" },
    { page: "lesson:*", trigger: "page_load" },
    { page: "home", trigger: "exit_intent" },
    { page: "home" },
    "{quebrado",
    "[]"
  ]) {
    const resposta = await mostrar(POPUP, body);
    assert.equal(resposta.status, 400, JSON.stringify(body));
    assert.deepEqual(resposta.body, { error: "Pedido invalido." });
  }

  assert.equal((await mostrar(POPUP, { page: "home", padding: "x".repeat(1_200), trigger: "page_load" })).status, 413);

  sessao.user = null;
  assert.equal((await mostrar(POPUP, NA_HOME)).status, 401);
});

test("show de pop-up agendado (v3b-2, D4): 409 not_started com o Comeca para quem esta no segmento, sem gravar nada", async () => {
  const aluno = novoAluno();
  const comeca = iso(Date.now() + HORA);
  const db = banco({ campaigns: [popupNoAr({ starts_at: comeca })], deliveries: [linha(aluno)] });

  const resposta = await mostrar(POPUP, NA_HOME);

  assert.equal(resposta.status, 409);
  assert.deepEqual(resposta.body, { error: "Pop-up fora da vez.", nextAt: comeca, reason: "not_started" });
  assert.deepEqual(db.calls.rpc.filter((call) => call.name === "communication_record_popup_impression"), [], "nada gravado antes da hora");
  assert.deepEqual(eventos(db), []);
});

test("historico: message_impressed so enquanto as aberturas do dia sao ate 100 (a linha guarda a conta exata)", async () => {
  const aluno = novoAluno();
  let dia = 100;
  const db = banco({
    campaigns: [popupNoAr({ popup_pages: ["any"] })],
    deliveries: [linha(aluno)],
    rpc: { communication_record_popup_impression: () => ({ day_impressions: dia, impressions: dia + 4 }) }
  });

  assert.equal((await mostrar(POPUP, { page: "support", trigger: "page_load" })).status, 200);
  assert.equal(eventos(db).length, 1, "a 100a abertura do dia entra");
  assert.deepEqual(eventos(db)[0].metadata, { campaign_id: POPUP, page: "support", trigger: "page_load" });

  dia = 101;
  assert.equal((await mostrar(POPUP, { page: "support", trigger: "page_load" })).status, 200, "a abertura vale; so o historico para");
  assert.equal(eventos(db).length, 1, "a 101a nao entra no historico");
});

test("limite: a 31a chamada de pop-up no minuto (show e eventos somados) e 429 com Retry-After; a chave do sino fica intacta", async () => {
  const aluno = novoAluno();
  banco({ campaigns: [popupNoAr()], deliveries: [linha(aluno)] });

  for (let n = 0; n < 15; n += 1) {
    assert.notEqual((await mostrar("nao-e-id", NA_HOME)).status, 429, `show ${n + 1}`);
    assert.notEqual((await evento("nao-e-id", { event: "closed" })).status, 429, `evento ${n + 1}`);
  }

  for (const barrada of [await mostrar(POPUP, NA_HOME), await evento(POPUP, { event: "clicked" })]) {
    assert.equal(barrada.status, 429);
    assert.deepEqual(barrada.body, { error: "Muitas tentativas. Espere um pouco." });
    assert.equal(barrada.headers.get("retry-after"), "60");
    assert.equal(barrada.headers.get("cache-control"), "private, no-store, max-age=0");
  }

  assert.equal(limit.takeStudentWrite(aluno), true, "as escritas do sino tem a sua chave");
  novoAluno();
  banco({ campaigns: [popupNoAr()], deliveries: [linha(sessao.user.id)] });
  assert.equal((await mostrar(POPUP, NA_HOME)).status, 200, "outro aluno nao e barrado");
});

test("eventos: fechar nao muda a linha e leva o jeito (x, outside, esc, page; padrao x); `via` desconhecido e 400", async () => {
  const aluno = novoAluno();
  const db = banco({ campaigns: [popupNoAr()], deliveries: [linha(aluno, { impressions: 1, last_seen_at: iso(Date.now() - MIN) })] });

  for (const via of ["x", "outside", "esc", "page", undefined]) {
    const resposta = await evento(POPUP, via === undefined ? { event: "closed" } : { event: "closed", via });
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    assert.deepEqual(resposta.body, { data: { ok: true } });
  }

  assert.deepEqual(db.calls.updates, [], "fechar nao muda a linha");
  assert.deepEqual(
    eventos(db).map((item) => [item.event_type, item.metadata]),
    ["x", "outside", "esc", "page", "x"].map((via) => ["message_closed", { campaign_id: POPUP, via }])
  );

  for (const body of [{ event: "closed", via: "voando" }, { event: "closed", via: 1 }, { event: "talvez" }]) {
    const resposta = await evento(POPUP, body);
    assert.equal(resposta.status, 400, JSON.stringify(body));
    assert.deepEqual(resposta.body, { error: "Evento invalido." });
  }

  assert.equal((await evento(POPUP, { event: "clicked", via: "x" })).status, 200, "`via` valido fora do fechar nao conta");
  assert.deepEqual(eventos(db).at(-1).metadata, { campaign_id: POPUP });
});

test("eventos: 'Lembrar depois' volta no 'Volta em' do pop-up (30 min), so sobre o valor lido; alem do limite e 409", async () => {
  const aluno = novoAluno();
  const db = banco({
    campaigns: [popupNoAr({ popup_snooze_minutes: 30 })],
    deliveries: [linha(aluno, { impressions: 1, last_seen_at: iso(Date.now() - MIN) })]
  });

  const antes = Date.now();
  assert.equal((await evento(POPUP, { event: "snoozed" })).status, 200);
  const [update] = db.calls.updates;
  const volta = Date.parse(update.patch.snoozed_until) - antes;
  assert.ok(volta >= 30 * MIN && volta < 30 * MIN + 5_000, `volta em 30 min (${volta} ms)`);
  assert.equal(update.patch.snooze_count, 1);
  assert.deepEqual(update.filters.find(([, column]) => column === "snooze_count"), ["eq", "snooze_count", 0]);

  assert.equal((await evento(POPUP, { event: "snoozed" })).status, 200);
  const terceira = await evento(POPUP, { event: "snoozed" });
  assert.equal(terceira.status, 409);
  assert.deepEqual(terceira.body, { error: "Não dá para lembrar depois de novo." });

  // Pop-up de antes da v3b-1 (sem a coluna): 24 h.
  novoAluno();
  const antigo = banco({ campaigns: [popupNoAr({ popup_snooze_minutes: undefined })], deliveries: [linha(sessao.user.id, { impressions: 1 })] });
  const inicio = Date.now();
  assert.equal((await evento(POPUP, { event: "snoozed" })).status, 200);
  const vinteQuatro = Date.parse(antigo.calls.updates[0].patch.snoozed_until) - inicio;
  assert.ok(vinteQuatro >= 24 * HORA && vinteQuatro < 24 * HORA + 5_000);
});

test("eventos: o 'impressed' da v1 grava pela RPC da abertura (pagina do Inicio); fora da vez e 409 'Pop-up fora da vez.'", async () => {
  const aluno = novoAluno();
  const db = banco({ campaigns: [popupNoAr()], deliveries: [linha(aluno)] });

  assert.equal((await evento(POPUP, { event: "impressed" })).status, 200);
  assert.equal(db.calls.rpc.filter((call) => call.name === "communication_record_popup_impression").length, 1);
  assert.deepEqual(eventos(db).map((item) => [item.event_type, item.metadata]), [["message_impressed", { campaign_id: POPUP, page: "home", trigger: "page_load" }]]);

  const deNovo = await evento(POPUP, { event: "impressed" });
  assert.equal(deNovo.status, 409, "'Uma vez' ja visto");
  assert.deepEqual(deNovo.body, { error: "Pop-up fora da vez." });
  assert.equal(eventos(db).length, 1);

  // Pop-up que so vale numa aula: o "impressed" (Inicio) nao passa.
  novoAluno();
  banco({ campaigns: [popupNoAr({ popup_pages: ["lesson:*"], popup_trigger: "lesson_completed" })], deliveries: [linha(sessao.user.id)] });
  assert.equal((await evento(POPUP, { event: "impressed" })).status, 409);
});

test("formacao: content:/lesson: da formacao valem para os cursos incluidos dela (o curso avulso com parentFormationId velho nao)", async () => {
  const aluno = novoAluno();
  const db = banco({
    campaigns: [popupNoAr({ popup_pages: ["lesson:formacao-ia"] })],
    deliveries: [linha(aluno)],
    tables: {
      content_items: [
        { commerce_scope: "included_content", id: "curso-da-formacao" },
        { commerce_scope: "sellable_product", id: "curso-avulso" }
      ],
      content_page_settings: [
        { content_id: "curso-da-formacao", settings: { parentFormationId: "formacao-ia" } },
        { content_id: "curso-avulso", settings: { parentFormationId: "formacao-ia" } },
        { content_id: "outro-curso", settings: { parentFormationId: "outra-formacao" } }
      ]
    }
  });

  const { body } = await resumo("?page=lesson%3Acurso-da-formacao");
  assert.deepEqual(body.data.popups.pages, ["lesson:*"]);
  assert.deepEqual(body.data.popups.plan[0].pages, ["lesson:curso-da-formacao", "lesson:formacao-ia"]);
  assert.equal((await mostrar(POPUP, { page: "lesson:curso-da-formacao", trigger: "page_load" })).status, 200);
  assert.equal((await mostrar(POPUP, { page: "lesson:curso-avulso", trigger: "page_load" })).body.reason, "page");
  assert.ok(db.calls.from.includes("content_page_settings"));
});

test("a falha da leitura das formacoes nunca derruba os pop-ups: quem nao nomeia produto segue no plano e abre", async () => {
  const aluno = novoAluno();
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));

  try {
    banco({
      campaigns: [popupNoAr(), popupNoAr({ id: OUTRO, popup_pages: ["lesson:formacao-ia"], starts_at: iso(Date.now() - MIN) })],
      deliveries: [linha(aluno), linha(aluno, { campaign_id: OUTRO })],
      falhas: { content_page_settings: { code: "57014", message: "canceling statement due to statement timeout" } }
    });

    const { body, status } = await resumo("?page=home");
    assert.equal(status, 200);
    assert.deepEqual(body.data.popups.pages, ["home", "lesson:*"]);
    assert.deepEqual(
      body.data.popups.plan.map((item) => [item.id, item.pages]),
      [
        [OUTRO, ["lesson:formacao-ia"]],
        [POPUP, ["home"]]
      ]
    );
    assert.equal((await mostrar(POPUP, NA_HOME)).status, 200);
    assert.ok(logs.some((line) => line.includes("[comunicacao] cursos das formacoes")), logs.join("\n"));
  } finally {
    console.error = original;
  }
});

test("banco sem a migracao 202610220003: o resumo responde popups: null (o numero continua) e o show e 404", async () => {
  const aluno = novoAluno();
  banco({
    deliveries: [linha(aluno)],
    falhas: { campaigns: { code: "42703", message: "column campaigns.popup_pages does not exist" } }
  });

  const { body, status } = await resumo("?page=home");
  assert.equal(status, 200);
  assert.deepEqual(body.data, { popup: null, popups: null, unseen: 2 });
  assert.equal((await resumo("?popup=1")).body.data.popup, null);
  assert.equal((await mostrar(POPUP, NA_HOME)).status, 404);
});
