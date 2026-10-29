import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Sino no servidor (Comunicacao v3a, docs/24 §4.2 a §4.6 e §4.14), sem banco: um banco falso que conta as
// idas (rpc e from) e guarda as escritas. A pagina do sino e uma ida so (communication_inbox_page), os
// numeros outra (communication_inbox_counts); a regra do que aparece e do banco (testada contra o banco
// local em tests/integration/sino-v3.test.mjs). Aqui: o mapeamento da pagina, o que cada escrita exige da
// linha, os caminhos sem escrita, o teto de eventos por linha e o limite de 30 escritas por minuto nas
// quatro rotas do aluno.

const sessao = (globalThis.__sinoSessao ??= { user: null });

// A sessao das rotas (requireApiSessionUser) vem do teste; o resto (inbox, rotas, eventos) e o codigo real.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/guards") {
      const source = `
        export async function requireApiSessionUser() {
          const user = globalThis.__sinoSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiUser = requireApiSessionUser;`;

      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

const inbox = await import("../src/server/communications/inbox.ts");
const limit = await import("../src/server/communications/student-write-limit.ts");
const { INTERACTION_EVENTS_PER_ROW } = await import("../src/server/communications/interactions-model.ts");
const listRoute = await import("../src/app/api/notifications/route.ts");
const summaryRoute = await import("../src/app/api/notifications/summary/route.ts");
const reactionRoute = await import("../src/app/api/notifications/[id]/reaction/route.ts");
const pollRoute = await import("../src/app/api/notifications/[id]/poll/route.ts");
const hideRoute = await import("../src/app/api/notifications/[id]/hide/route.ts");
const responseRoute = await import("../src/app/api/notifications/[id]/response/route.ts");

const AGORA = Date.parse("2026-10-21T15:00:00.000Z");
const ALUNA = "11111111-1111-4111-8111-111111111111";
const EQUIPE = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const COMENTARIO = "aaaaaaaa-0000-4000-8000-000000000002";
const AVISO = "cccccccc-0000-4000-8000-000000000001";
let proximoAluno = 100;

/** Um aluno novo por teste: o limite de escritas e por aluno e vive no modulo. */
function novoAluno() {
  proximoAluno += 1;
  return `33333333-3333-4333-8333-${String(proximoAluno).padStart(12, "0")}`;
}

function filtrar(rows, filters) {
  return rows.filter((row) =>
    filters.every(([op, column, value]) => {
      const current = row[column];
      switch (op) {
        case "eq":
          return current === value;
        case "in":
          return value.includes(current);
        case "is":
          return current === value || (value === null && current === undefined);
        case "not":
          return current !== null && current !== undefined;
        case "gt":
          return current > value;
        case "lte":
          return current <= value;
        default:
          return true;
      }
    })
  );
}

/**
 * Banco falso: `notifications` e uma tabela em memoria (select, update com os filtros, insert de eventos em
 * student_events); `rpc[nome](args)` devolve o que o teste quiser. Conta toda ida em `calls`.
 */
function bancoFalso({ notifications = [], rpc = {} } = {}) {
  const calls = { from: [], inserts: [], rpc: [], updates: [] };
  const tables = { notifications };

  function chain(resolve) {
    const state = { filters: [], single: false };
    const c = {
      eq: (column, value) => (state.filters.push(["eq", column, value]), c),
      gt: (column, value) => (state.filters.push(["gt", column, value]), c),
      in: (column, value) => (state.filters.push(["in", column, value]), c),
      is: (column, value) => (state.filters.push(["is", column, value]), c),
      lte: (column, value) => (state.filters.push(["lte", column, value]), c),
      maybeSingle: () => ((state.single = true), c),
      not: (column) => (state.filters.push(["not", column]), c),
      order: () => c,
      range: () => c,
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
            const rows = filtrar(tables[table] ?? [], state.filters);
            return { data: state.single ? (rows[0] ?? null) : rows, error: null, select: columns };
          });
        },
        update(patch) {
          return chain((state) => {
            const rows = filtrar(tables[table] ?? [], state.filters);
            calls.updates.push({ filters: state.filters, patch, table });
            rows.forEach((row) => Object.assign(row, patch));
            return { data: rows.map((row) => ({ id: row.id })), error: null };
          });
        }
      };
    },
    rpc(name, args) {
      calls.rpc.push({ args, name });
      return chain((state) => {
        const data = rpc[name] ? rpc[name](args, state) : null;
        return { data: state.single && Array.isArray(data) ? (data[0] ?? null) : data, error: null };
      });
    }
  };
}

/** Linha do sino como communication_visible_notifications devolve (4.1). */
function visivel(extra = {}) {
  return {
    allow_reactions: false,
    campaign_id: AVISO,
    clicked_at: null,
    created_at: "2026-10-21T14:00:00.000000+00:00",
    expires_at: "2026-11-21T14:00:00.000000+00:00",
    flow_node_id: null,
    has_audio: false,
    hidden_at: null,
    id: ID,
    interaction_writes: 0,
    is_test: false,
    kind: "notice",
    opened_at: null,
    poll: null,
    poll_choice: null,
    reaction: null,
    read_at: null,
    response: null,
    response_mode: "none",
    seen_at: null,
    sent_at: "2026-10-21T14:00:00.000000+00:00",
    user_id: ALUNA,
    ...extra
  };
}

/** O banco falso com a regra do que aparece: linhas do aluno, nao excluidas (o resto da regra e do banco). */
function bancoComLinhas(linhas, rpc = {}) {
  return bancoFalso({
    notifications: linhas,
    rpc: {
      communication_inbox_counts: () => ({ unread: 3, unseen: 2 }),
      communication_visible_notifications: (args) =>
        linhas.filter((row) => row.user_id === args.p_user_id && !row.hidden_at && (args.p_id === null || row.id === args.p_id)).map((row) => ({ ...row })),
      ...rpc
    }
  });
}

const ENQUETE = {
  closesAt: null,
  multiple: false,
  options: [
    { id: "a1", label: "Sábado" },
    { id: "b2", label: "Domingo" }
  ],
  question: "Qual dia da live?",
  showResults: true
};

function campanha(extra = {}) {
  return {
    accept_label: null,
    allow_reactions: false,
    audio_duration_seconds: null,
    audio_mime: null,
    audio_peaks: null,
    audio_url: null,
    body: "Traga suas dúvidas.",
    cta_display: "button",
    cta_href: "/minhas-compras",
    cta_label: "Abrir",
    cta_target: "same_tab",
    decline_label: null,
    icon: null,
    icon_color: null,
    id: AVISO,
    image_alt: null,
    image_url: null,
    poll: null,
    response_mode: "none",
    sender_user_id: null,
    status: "sent",
    title: "Aula nova",
    ...extra
  };
}

/** Item de communication_inbox_page (4.3). */
function itemDaPagina(extra = {}) {
  return {
    actor_id: null,
    actor_profile: null,
    audio_completed_at: null,
    audio_heard: null,
    audio_heard_percent: null,
    audio_started_at: null,
    body: null,
    campaign: campanha(),
    campaign_id: AVISO,
    clicked_at: null,
    created_at: "2026-10-21T14:00:00.123456+00:00",
    expires_at: "2026-11-21T14:00:00+00:00",
    href: null,
    id: ID,
    is_test: false,
    kind: "notice",
    opened_at: null,
    payload: {},
    poll_choice: null,
    poll_tally: null,
    reaction: null,
    read_at: null,
    reply: null,
    responded_at: null,
    response: null,
    seen_at: null,
    sender_on_team: false,
    sender_profile: null,
    title: null,
    ...extra
  };
}

function idDe(n) {
  return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function pagina(items, counts = { unread: 7, unseen: 4 }) {
  return bancoFalso({ rpc: { communication_inbox_page: () => ({ items, ...counts }) } });
}

const post = (route, id, body) =>
  route.POST(
    new Request(`http://localhost/api/notifications/${id}/x`, { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );

const eventos = (db) => db.calls.inserts.filter((insert) => insert.table === "student_events").flatMap((insert) => insert.payload);

test("a pagina do sino e uma ida so ao banco: uma rpc communication_inbox_page e nenhum from()", async () => {
  const db = pagina([itemDaPagina()]);
  actionStubs.db = db;

  const resultado = await inbox.listNotifications({ cursor: `2026-10-21T13:00:00.654321Z|${idDe(9)}`, filter: "unread", limit: 5, now: AGORA, userId: ALUNA });

  assert.equal(db.calls.rpc.length, 1);
  assert.deepEqual(db.calls.from, []);
  assert.deepEqual(db.calls.rpc[0], {
    args: {
      p_cursor_created_at: "2026-10-21T13:00:00.654321Z",
      p_cursor_id: idDe(9),
      p_filter: "unread",
      p_limit: 5,
      p_now: "2026-10-21T15:00:00.000Z",
      p_user_id: ALUNA
    },
    name: "communication_inbox_page"
  });
  assert.equal(resultado.asOf, "2026-10-21T15:00:00.000Z", "asOf e a hora de antes da leitura");
  assert.equal(resultado.unread, 7);
  assert.equal(resultado.unseen, 4);
  assert.equal(resultado.items.length, 1);

  await inbox.listNotifications({ now: AGORA, userId: ALUNA });
  assert.deepEqual(
    { cursor: db.calls.rpc[1].args.p_cursor_created_at, filter: db.calls.rpc[1].args.p_filter, limit: db.calls.rpc[1].args.p_limit },
    { cursor: null, filter: "all", limit: 20 }
  );
});

test("o banco devolve ate limit + 1: a sobra vira o cursor da proxima pagina (com os microssegundos), sem sobra nao ha proxima", async () => {
  const linhas = [1, 2, 3].map((n) => itemDaPagina({ created_at: `2026-10-21T14:0${n}:00.12345${n}+00:00`, id: idDe(n) }));
  actionStubs.db = pagina(linhas);

  const primeira = await inbox.listNotifications({ limit: 2, now: AGORA, userId: ALUNA });
  assert.deepEqual(primeira.items.map((item) => item.id), [idDe(1), idDe(2)]);
  assert.equal(primeira.nextCursor, `2026-10-21T14:02:00.123452Z|${idDe(2)}`);

  actionStubs.db = pagina(linhas.slice(0, 2));
  assert.equal((await inbox.listNotifications({ limit: 2, now: AGORA, userId: ALUNA })).nextCursor, null);
});

test("quem envia: pessoa na equipe com o perfil; sem nome no perfil, Equipe Bunker707; fora da equipe, a escola", async () => {
  actionStubs.db = pagina([
    itemDaPagina({ campaign: campanha({ sender_user_id: EQUIPE }), id: idDe(1), sender_on_team: true, sender_profile: { avatar_url: null, full_name: "  Ana Souza " } }),
    itemDaPagina({ campaign: campanha({ sender_user_id: EQUIPE }), id: idDe(2), sender_on_team: true, sender_profile: null }),
    itemDaPagina({ campaign: campanha({ sender_user_id: EQUIPE }), id: idDe(3), sender_on_team: true, sender_profile: { avatar_url: null, full_name: " " } }),
    itemDaPagina({ campaign: campanha({ sender_user_id: EQUIPE }), id: idDe(4), sender_on_team: false, sender_profile: { avatar_url: null, full_name: "Saiu da Equipe" } })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(
    items.map((item) => item.actor),
    [{ avatarUrl: null, name: "Ana Souza" }, { avatarUrl: null, name: "Equipe Bunker707" }, { avatarUrl: null, name: "Equipe Bunker707" }, null]
  );
});

test("comentario: quem respondeu vem do perfil; sem perfil, o nome gravado no comentario; sem reacoes nem enquete", async () => {
  const comentario = (extra) =>
    itemDaPagina({
      body: "Comece pelo módulo 2.",
      campaign: null,
      campaign_id: null,
      href: "/conteudo/curso/aulas/modulo?lessonId=aula",
      kind: "comment_reply",
      payload: { commentId: COMENTARIO, lessonTitle: " Aula 1 " },
      ...extra
    });
  actionStubs.db = pagina([
    comentario({ actor_id: EQUIPE, actor_profile: { avatar_url: null, full_name: "Professor de Teste" }, id: idDe(1), reply: { author_avatar_url: null, author_name: "Outro Nome" } }),
    comentario({ actor_id: null, id: idDe(2), reply: { author_avatar_url: null, author_name: " Autora Gravada " } }),
    comentario({ actor_id: EQUIPE, actor_profile: { avatar_url: null, full_name: null }, id: idDe(3), reply: { author_avatar_url: null, author_name: "Do Comentario" } })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(
    items.map((item) => item.title),
    ["Professor de Teste respondeu seu comentário", "Autora Gravada respondeu seu comentário", "Do Comentario respondeu seu comentário"]
  );
  assert.equal(items[0].context, "Aula 1");
  assert.equal(items[0].href, "/conteudo/curso/aulas/modulo?lessonId=aula");
  assert.ok(items.every((item) => item.reactions === null && item.poll === null && item.cta === null));
});

test("destino: como o aluno chega la vem da coluna; valor fora dos tres vira o botao", async () => {
  actionStubs.db = pagina([
    itemDaPagina({ campaign: campanha({ cta_display: "card", cta_label: "Ver a aula nova" }), id: idDe(1) }),
    itemDaPagina({ campaign: campanha({ cta_display: "button_and_card" }), id: idDe(2) }),
    itemDaPagina({ campaign: campanha({ cta_display: "qualquer" }), id: idDe(3) }),
    itemDaPagina({ campaign: campanha({ cta_display: null }), id: idDe(4) }),
    itemDaPagina({ campaign: campanha({ cta_display: "card", cta_href: "javascript:alert(1)" }), id: idDe(5) })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(items[0].cta, { display: "card", href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" });
  assert.deepEqual(
    items.map((item) => item.cta?.display ?? null),
    ["card", "button_and_card", "button", "button", null]
  );
});

test("reacoes: null quando a equipe nao permitiu; senao a do aluno (fora do catalogo = nenhuma)", async () => {
  actionStubs.db = pagina([
    itemDaPagina({ id: idDe(1), reaction: "love" }),
    itemDaPagina({ campaign: campanha({ allow_reactions: true }), id: idDe(2), reaction: "love" }),
    itemDaPagina({ campaign: campanha({ allow_reactions: true }), id: idDe(3) }),
    itemDaPagina({ campaign: campanha({ allow_reactions: true }), id: idDe(4), reaction: "raiva" })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(
    items.map((item) => item.reactions),
    [null, { value: "love" }, { value: null }, { value: null }]
  );
});

test("enquete: resultado so com a equipe deixando, e o aluno votou ou ela encerrou; sem contagem do banco, sem resultado", async () => {
  const contagem = { counts: { a1: 3, b2: 1, zz: 9 }, voters: 4 };
  const encerrada = { ...ENQUETE, closesAt: "2026-10-21T14:30:00.000Z" };
  actionStubs.db = pagina([
    itemDaPagina({ campaign: campanha({ poll: ENQUETE }), id: idDe(1), poll_choice: ["a1"], poll_tally: contagem }),
    itemDaPagina({ campaign: campanha({ poll: ENQUETE }), id: idDe(2), poll_choice: null, poll_tally: null }),
    itemDaPagina({ campaign: campanha({ poll: encerrada }), id: idDe(3), poll_choice: null, poll_tally: contagem }),
    itemDaPagina({ campaign: campanha({ poll: { ...ENQUETE, showResults: false } }), id: idDe(4), poll_choice: ["b2"], poll_tally: contagem }),
    itemDaPagina({ campaign: campanha({ poll: ENQUETE }), id: idDe(5), poll_choice: ["a1"], poll_tally: null }),
    itemDaPagina({ campaign: campanha({ poll: { question: "quebrada" } }), id: idDe(6) }),
    itemDaPagina({ id: idDe(7) })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(items[0].poll, {
    choice: ["a1"],
    closed: false,
    closesAt: null,
    multiple: false,
    options: ENQUETE.options,
    question: "Qual dia da live?",
    results: { counts: { a1: 3, b2: 1 }, voters: 4 },
    showResults: true
  });
  assert.equal(items[1].poll.results, null, "nao votou numa enquete aberta");
  assert.deepEqual(items[1].poll.choice, []);
  assert.equal(items[2].poll.closed, true);
  assert.deepEqual(items[2].poll.results, { counts: { a1: 3, b2: 1 }, voters: 4 }, "encerrada: todos veem");
  assert.equal(items[3].poll.results, null, "a equipe nao deixou mostrar");
  assert.equal(items[4].poll.results, null, "sem contagem do banco nao ha resultado");
  assert.equal(items[5].poll, null, "enquete fora do formato = sem enquete");
  assert.equal(items[6].poll, null);
});

test("os numeros sao uma rpc so (communication_inbox_counts), tambem no resumo do topo", async () => {
  const db = bancoFalso({ rpc: { communication_inbox_counts: () => ({ unread: 12, unseen: 3 }) } });
  actionStubs.db = db;

  assert.deepEqual(await inbox.readNotificationCounts(ALUNA, AGORA), { unread: 12, unseen: 3 });
  assert.equal(await inbox.countUnseen(ALUNA, AGORA), 3);
  assert.equal(await inbox.countUnread(ALUNA, AGORA), 12);
  assert.deepEqual(db.calls.rpc.map((call) => call.name), ["communication_inbox_counts", "communication_inbox_counts", "communication_inbox_counts"]);
  assert.deepEqual(db.calls.rpc[0].args, { p_now: "2026-10-21T15:00:00.000Z", p_user_id: ALUNA });

  db.calls.rpc.length = 0;
  sessao.user = { id: ALUNA };
  const resumo = await summaryRoute.GET(new Request("http://localhost/api/notifications/summary"));
  assert.equal(resumo.status, 200);
  assert.deepEqual((await resumo.json()).data, { popup: null, unseen: 3 });
  assert.equal(resumo.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(db.calls.rpc.length, 1, "fora da home, uma ida so");
  assert.deepEqual(db.calls.from, []);
});

test("rota da lista: sem sessao e 401; com sessao, a pagina numa ida e sem cache", async () => {
  const db = pagina([itemDaPagina()]);
  actionStubs.db = db;

  sessao.user = null;
  assert.equal((await listRoute.GET(new Request("http://localhost/api/notifications"))).status, 401);

  sessao.user = { id: ALUNA };
  const resposta = await listRoute.GET(new Request("http://localhost/api/notifications"));
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("vary"), "Cookie");
  assert.equal((await resposta.json()).data.items[0].title, "Aula nova");
  assert.deepEqual(db.calls.rpc.map((call) => call.name), ["communication_inbox_page"]);
});

test("banco sem a migracao: sino vazio e numeros zerados, nunca erro", async () => {
  const faltando = { code: "PGRST202", message: "Could not find the function public.communication_inbox_page" };
  actionStubs.db = { from: () => assert.fail("sem from"), rpc: () => Promise.resolve({ data: null, error: faltando }) };

  assert.deepEqual(await inbox.listNotifications({ now: AGORA, userId: ALUNA }), { asOf: "2026-10-21T15:00:00.000Z", items: [], nextCursor: null, unread: 0, unseen: 0 });
  assert.deepEqual(await inbox.readNotificationCounts(ALUNA, AGORA), { unread: 0, unseen: 0 });
});

test("o que cada escrita exige da linha: fora do sino 404; sem audio, sem resposta, sem enquete ou comentario 404; reacoes nao permitidas 409", async () => {
  const comentario = visivel({ campaign_id: null, id: COMENTARIO, kind: "comment_reply" });
  const agora = new Date(AGORA);
  actionStubs.db = bancoComLinhas([visivel(), comentario]);

  const falha = async (promessa) => {
    try {
      await promessa;
    } catch (error) {
      return { message: error.message, status: error.status };
    }
    return assert.fail("deveria falhar");
  };
  const naoEncontrada = { message: "Notificacao nao encontrada.", status: 404 };

  assert.deepEqual(await falha(inbox.markClicked(ALUNA, idDe(99), agora)), naoEncontrada, "linha que nao aparece");
  assert.deepEqual(await falha(inbox.markClicked(ALUNA, "nao-e-uuid", agora)), naoEncontrada);
  assert.deepEqual(await falha(inbox.markClicked(EQUIPE, ID, agora)), naoEncontrada, "de outra pessoa");
  assert.deepEqual(await falha(inbox.recordNotificationAudio(ALUNA, ID, { event: "started" }, agora)), naoEncontrada, "sem audio");
  assert.deepEqual(await falha(inbox.respondToNotification(ALUNA, ID, "accepted", agora)), naoEncontrada, "nao pede resposta");
  assert.deepEqual(await falha(inbox.respondToNotification(ALUNA, COMENTARIO, "accepted", agora)), naoEncontrada);
  assert.deepEqual(await falha(inbox.voteOnNotificationPoll(ALUNA, ID, ["a1"], agora)), naoEncontrada, "sem enquete");
  assert.deepEqual(await falha(inbox.reactToNotification(ALUNA, COMENTARIO, "love", agora)), naoEncontrada, "comentario nao tem reacao");
  assert.deepEqual(await falha(inbox.reactToNotification(ALUNA, ID, "love", agora)), { message: "Esta notificação não aceita reações.", status: 409 });
  assert.deepEqual(actionStubs.db.calls.updates, [], "nada foi escrito");

  // A conferencia de uma linha e a regra unica do banco, com p_id.
  assert.deepEqual(actionStubs.db.calls.rpc[0], {
    args: { p_id: idDe(99), p_now: "2026-10-21T15:00:00.000Z", p_user_id: ALUNA },
    name: "communication_visible_notifications"
  });
});

test("excluir do sino: grava hidden_at, visto e a escrita; repetir o excluido e sucesso sem escrita; de outra pessoa 404", async () => {
  const linha = visivel({ interaction_writes: 4 });
  const db = bancoComLinhas([linha]);
  actionStubs.db = db;
  const agora = new Date(AGORA);

  const excluida = await inbox.setNotificationHidden(ALUNA, ID, true, agora);
  assert.equal(excluida.changed, true);
  assert.equal(excluida.recordEvent, true);
  assert.deepEqual(excluida.counts, { unread: 3, unseen: 2 });
  assert.deepEqual(db.calls.updates[0].patch, { hidden_at: "2026-10-21T15:00:00.000Z", interaction_writes: 5, seen_at: "2026-10-21T15:00:00.000Z" });
  assert.deepEqual(db.calls.updates[0].filters, [["eq", "id", ID], ["eq", "user_id", ALUNA], ["is", "hidden_at", null]]);

  const repetida = await inbox.setNotificationHidden(ALUNA, ID, true, agora);
  assert.equal(repetida.changed, false);
  assert.equal(repetida.recordEvent, false);
  assert.equal(db.calls.updates.length, 1, "excluir de novo nao escreve");

  await assert.rejects(inbox.setNotificationHidden(EQUIPE, ID, true, agora), { status: 404 });
  await assert.rejects(inbox.setNotificationHidden(ALUNA, idDe(77), true, agora), { status: 404 });

  // Visto ja gravado fica o de antes.
  const vista = visivel({ id: idDe(5), seen_at: "2026-10-21T14:10:00.000Z" });
  actionStubs.db = bancoComLinhas([vista]);
  await inbox.setNotificationHidden(ALUNA, idDe(5), true, agora);
  assert.equal(actionStubs.db.calls.updates[0].patch.seen_at, "2026-10-21T14:10:00.000Z");
});

test("desfazer: volta para o sino com uma escrita; desfazer o que esta no sino e sucesso sem escrita; linha que nao existe 404", async () => {
  const linha = visivel({ hidden_at: "2026-10-21T14:59:00.000Z", interaction_writes: 6 });
  const db = bancoComLinhas([linha]);
  actionStubs.db = db;
  const agora = new Date(AGORA);

  const desfeita = await inbox.setNotificationHidden(ALUNA, ID, false, agora);
  assert.equal(desfeita.changed, true);
  assert.deepEqual(db.calls.updates[0].patch, { hidden_at: null, interaction_writes: 7 });
  assert.deepEqual(db.calls.updates[0].filters, [["eq", "id", ID], ["eq", "user_id", ALUNA], ["not", "hidden_at"]]);

  const repetida = await inbox.setNotificationHidden(ALUNA, ID, false, agora);
  assert.equal(repetida.changed, false);
  assert.equal(db.calls.updates.length, 1);

  await assert.rejects(inbox.setNotificationHidden(ALUNA, idDe(78), false, agora), { status: 404 });
  await assert.rejects(inbox.setNotificationHidden(EQUIPE, ID, false, agora), { status: 404 });
});

test("reagir: grava a reacao e a interacao; a mesma reacao nao escreve; tirar limpa reaction e reacted_at", async () => {
  const linha = visivel({ allow_reactions: true, interaction_writes: 2, read_at: "2026-10-21T14:10:00.000Z", seen_at: "2026-10-21T14:10:00.000Z" });
  const db = bancoComLinhas([linha]);
  actionStubs.db = db;
  const agora = new Date(AGORA);

  const reagiu = await inbox.reactToNotification(ALUNA, ID, "love", agora);
  assert.deepEqual(reagiu, { campaignId: AVISO, changed: true, reaction: "love", recordEvent: true });
  assert.deepEqual(db.calls.updates[0].patch, {
    interaction_writes: 3,
    opened_at: "2026-10-21T15:00:00.000Z",
    reacted_at: "2026-10-21T15:00:00.000Z",
    reaction: "love",
    read_at: "2026-10-21T14:10:00.000Z",
    seen_at: "2026-10-21T14:10:00.000Z"
  });

  assert.deepEqual(await inbox.reactToNotification(ALUNA, ID, "love", agora), { campaignId: AVISO, changed: false, reaction: "love", recordEvent: false });
  assert.equal(db.calls.updates.length, 1, "a mesma reacao nao escreve");

  await inbox.reactToNotification(ALUNA, ID, null, agora);
  assert.deepEqual(db.calls.updates[1].patch, { interaction_writes: 4, reacted_at: null, reaction: null });
});

test("responder e mudar a resposta: pela rpc; a mesma resposta nao muda nada e nao grava evento", async () => {
  const db = bancoComLinhas([visivel({ response_mode: "accept_decline" })], {
    communication_respond_notification: (args) =>
      args.p_response === "accepted" ? { changed: false, first: false, response: "accepted", writes: 3 } : { changed: true, first: false, response: "declined", writes: 3 }
  });
  actionStubs.db = db;
  const agora = new Date(AGORA);

  const mesma = await inbox.respondToNotification(ALUNA, ID, "accepted", agora);
  assert.deepEqual(mesma, { campaignId: AVISO, changed: false, first: false, recordEvent: false, response: "accepted" });

  const mudou = await inbox.respondToNotification(ALUNA, ID, "declined", agora);
  assert.deepEqual(mudou, { campaignId: AVISO, changed: true, first: false, recordEvent: true, response: "declined" });
  assert.deepEqual(db.calls.rpc.find((call) => call.name === "communication_respond_notification").args, {
    p_notification_id: ID,
    p_now: "2026-10-21T15:00:00.000Z",
    p_response: "accepted",
    p_user_id: ALUNA
  });
  assert.deepEqual(db.calls.updates, [], "a escrita e da rpc");
});

test("votar: enquete encerrada 409; opcao que nao existe ou duas numa enquete de uma 400; o voto vai normalizado para a rpc", async () => {
  const encerrada = { ...ENQUETE, closesAt: "2026-10-21T14:59:59.000Z" };
  const db = bancoComLinhas([visivel({ poll: ENQUETE }), visivel({ id: idDe(2), poll: encerrada })], {
    communication_vote_notification_poll: (args) => ({
      changed: false,
      choice: args.p_option_ids,
      first: true,
      tally: args.p_option_ids.length ? { counts: { a1: 1 }, voters: 1 } : null,
      writes: 0
    })
  });
  actionStubs.db = db;
  const agora = new Date(AGORA);

  await assert.rejects(inbox.voteOnNotificationPoll(ALUNA, idDe(2), ["a1"], agora), { message: "A enquete foi encerrada.", status: 409 });
  await assert.rejects(inbox.voteOnNotificationPoll(ALUNA, ID, ["zz"], agora), { message: "Voto invalido.", status: 400 });
  await assert.rejects(inbox.voteOnNotificationPoll(ALUNA, ID, ["a1", "b2"], agora), { message: "Voto invalido.", status: 400 });
  assert.equal(db.calls.rpc.filter((call) => call.name === "communication_vote_notification_poll").length, 0);

  const votou = await inbox.voteOnNotificationPoll(ALUNA, ID, ["a1", "a1"], agora);
  assert.deepEqual(db.calls.rpc.at(-1).args.p_option_ids, ["a1"]);
  assert.deepEqual(votou.poll.results, { counts: { a1: 1, b2: 0 }, voters: 1 });
  assert.deepEqual(votou.poll.choice, ["a1"]);
  assert.equal(votou.recordEvent, true);

  const tirou = await inbox.voteOnNotificationPoll(ALUNA, ID, [], agora);
  assert.deepEqual(tirou.poll.choice, []);
  assert.equal(tirou.poll.results, null, "sem voto, sem resultado");
});

test("teto de eventos: com 19 escritas na linha o evento sai; com 20 a escrita acontece e o evento nao", async () => {
  sessao.user = { id: novoAluno() };
  const aluno = sessao.user.id;
  const linha = (writes) => visivel({ allow_reactions: true, interaction_writes: writes, user_id: aluno });

  actionStubs.db = bancoComLinhas([linha(INTERACTION_EVENTS_PER_ROW - 1)]);
  const antes = await post(reactionRoute, ID, { reaction: "fire" });
  assert.equal(antes.status, 200);
  assert.deepEqual((await antes.json()).data, { reaction: "fire" });
  assert.deepEqual(eventos(actionStubs.db).map((evento) => [evento.event_type, evento.metadata]), [["notification_reacted", { campaign_id: AVISO, reaction: "fire" }]]);

  actionStubs.db = bancoComLinhas([linha(INTERACTION_EVENTS_PER_ROW)]);
  const depois = await post(reactionRoute, ID, { reaction: "fire" });
  assert.equal(depois.status, 200);
  assert.equal(actionStubs.db.calls.updates.length, 1, "a linha muda");
  assert.equal(actionStubs.db.calls.updates[0].patch.interaction_writes, INTERACTION_EVENTS_PER_ROW + 1);
  assert.deepEqual(eventos(actionStubs.db), [], "o evento nao");

  // Voto e resposta: o teto vem das escritas de antes, que a rpc devolve.
  for (const [writes, esperado] of [
    [19, 1],
    [20, 0]
  ]) {
    actionStubs.db = bancoComLinhas([visivel({ poll: ENQUETE, response_mode: "none", user_id: aluno })], {
      communication_vote_notification_poll: () => ({ changed: true, choice: ["b2"], first: false, tally: null, writes })
    });
    assert.equal((await post(pollRoute, ID, { optionIds: ["b2"] })).status, 200);
    assert.equal(eventos(actionStubs.db).length, esperado, `voto com ${writes}`);

    actionStubs.db = bancoComLinhas([visivel({ response_mode: "accept_decline", user_id: aluno })], {
      communication_respond_notification: () => ({ changed: true, first: false, response: "declined", writes })
    });
    assert.equal((await post(responseRoute, ID, { response: "declined" })).status, 200);
    assert.equal(eventos(actionStubs.db).length, esperado, `resposta com ${writes}`);
  }
});

test("eventos das escritas do aluno so com ids e catalogo: voto, resposta (com changed) e excluir/desfazer", async () => {
  sessao.user = { id: novoAluno() };
  const aluno = sessao.user.id;

  actionStubs.db = bancoComLinhas([visivel({ poll: ENQUETE, user_id: aluno })], {
    communication_vote_notification_poll: () => ({ changed: false, choice: ["a1"], first: true, tally: { counts: { a1: 1 }, voters: 1 }, writes: 0 })
  });
  const voto = await post(pollRoute, ID, { optionIds: ["a1"] });
  assert.deepEqual((await voto.json()).data.poll.results, { counts: { a1: 1, b2: 0 }, voters: 1 });
  assert.deepEqual(eventos(actionStubs.db), [
    { entity_id: ID, entity_type: "notification", event_type: "notification_voted", metadata: { campaign_id: AVISO, option_ids: ["a1"] }, user_id: aluno }
  ]);

  actionStubs.db = bancoComLinhas([visivel({ response_mode: "accept_decline", user_id: aluno })], {
    communication_respond_notification: () => ({ changed: true, first: false, response: "declined", writes: 1 })
  });
  const resposta = await post(responseRoute, ID, { response: "declined" });
  assert.deepEqual((await resposta.json()).data, { changed: true, response: "declined" });
  assert.deepEqual(eventos(actionStubs.db)[0].metadata, { campaign_id: AVISO, changed: true, response: "declined" });

  actionStubs.db = bancoComLinhas([visivel({ user_id: aluno })]);
  const excluir = await post(hideRoute, ID, { hidden: true });
  assert.deepEqual((await excluir.json()).data, { unread: 3, unseen: 2 });
  const desfazer = await post(hideRoute, ID, { hidden: false });
  assert.equal(desfazer.status, 200);
  assert.deepEqual(
    eventos(actionStubs.db).map((evento) => [evento.event_type, evento.metadata]),
    [
      ["notification_hidden", { campaign_id: AVISO, hidden: true }],
      ["notification_hidden", { campaign_id: AVISO, hidden: false }]
    ]
  );
  await post(hideRoute, ID, { hidden: false });
  assert.equal(eventos(actionStubs.db).length, 2, "desfazer o que ja esta no sino nao grava evento");
});

test("corpos das rotas novas: invalido 400 com a frase da rota, grande demais 413, id invalido 400", async () => {
  sessao.user = { id: novoAluno() };
  actionStubs.db = bancoComLinhas([]);

  const erro = async (resposta) => [resposta.status, (await resposta.json()).error];

  assert.deepEqual(await erro(await post(reactionRoute, ID, { reaction: "raiva" })), [400, "Reacao invalida."]);
  assert.deepEqual(await erro(await post(reactionRoute, ID, "{nao e json")), [400, "Reacao invalida."]);
  assert.deepEqual(await erro(await post(pollRoute, ID, { optionIds: ["A-1"] })), [400, "Voto invalido."]);
  assert.deepEqual(await erro(await post(pollRoute, ID, { optionIds: ["a", "b", "c", "d", "e", "f", "g"] })), [400, "Voto invalido."]);
  assert.deepEqual(await erro(await post(hideRoute, ID, { hidden: "sim" })), [400, "Pedido invalido."]);
  assert.deepEqual(await erro(await post(responseRoute, ID, { response: "talvez" })), [400, "Resposta invalida."]);
  assert.deepEqual(await erro(await post(hideRoute, "nao-e-uuid", { hidden: true })), [400, "Notificacao invalida."]);
  assert.equal((await post(reactionRoute, ID, { reaction: "love", sobra: "x".repeat(1_200) })).status, 413);
  assert.deepEqual(await erro(await post(reactionRoute, ID, { reaction: "love" })), [404, "Notificacao nao encontrada."]);

  sessao.user = null;
  assert.equal((await post(reactionRoute, ID, { reaction: "love" })).status, 401);
});

test("limite de escritas: 30 por minuto passam, a 31a nao; a janela seguinte passa; outro aluno nao divide o limite", () => {
  const aluno = novoAluno();
  const outro = novoAluno();
  const inicio = AGORA;

  assert.deepEqual(limit.STUDENT_WRITE_LIMIT, { max: 30, windowMs: 60_000 });

  for (let n = 0; n < 30; n += 1) {
    assert.equal(limit.takeStudentWrite(aluno, inicio + n * 1_000), true, `escrita ${n + 1}`);
  }

  assert.equal(limit.takeStudentWrite(aluno, inicio + 59_999), false, "a 31a no mesmo minuto");
  assert.equal(limit.takeStudentWrite(outro, inicio + 59_999), true, "outro aluno");
  assert.equal(limit.takeStudentWrite(aluno, inicio + 60_000), true, "a janela seguinte");
});

test("as quatro rotas de escrita respondem 429 'Muitas tentativas. Espere um pouco.' com Retry-After na 31a escrita do minuto", async () => {
  const pedidos = [
    [reactionRoute, { reaction: "love" }],
    [pollRoute, { optionIds: ["a1"] }],
    [hideRoute, { hidden: true }],
    [responseRoute, { response: "accepted" }]
  ];

  for (const [route, body] of pedidos) {
    sessao.user = { id: novoAluno() };
    actionStubs.db = bancoComLinhas([]);

    for (let n = 0; n < 30; n += 1) {
      assert.equal((await post(route, ID, body)).status, 404, "dentro do limite a rota segue (aqui, a linha nao existe)");
    }

    const barrada = await post(route, ID, body);
    assert.equal(barrada.status, 429);
    assert.equal(barrada.headers.get("retry-after"), "60");
    assert.equal(barrada.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(await barrada.json(), { error: "Muitas tentativas. Espere um pouco." });
  }

  // O limite soma as quatro rotas do mesmo aluno.
  sessao.user = { id: novoAluno() };
  actionStubs.db = bancoComLinhas([]);
  for (let n = 0; n < 30; n += 1) {
    await post(pedidos[n % 4][0], ID, pedidos[n % 4][1]);
  }
  assert.equal((await post(hideRoute, ID, { hidden: true })).status, 429);
});

test("live (kind webinar, docs/30 D27): titulo, texto e link vem da propria linha, o icone pelo tipo do payload, sem botao, reacoes, enquete nem resposta; link que nao vale some", async () => {
  const live = (extra) =>
    itemDaPagina({
      body: "Amanhã às 20:00: Live de agentes. Sua vaga está garantida.",
      campaign: null,
      campaign_id: null,
      href: "/webinarios/live-de-agentes",
      kind: "webinar",
      payload: { kind: "h24", sessionId: idDe(7), webinarId: idDe(8) },
      title: "Lembrete da live",
      ...extra
    });
  actionStubs.db = pagina([
    live({ id: idDe(1) }),
    live({ body: "Começou agora: Live de agentes. Entrar.", id: idDe(2), payload: { kind: "started", sessionId: idDe(7), webinarId: idDe(8) }, title: "Começou agora" }),
    live({ id: idDe(3), payload: { kind: "cancelled" }, title: "Live cancelada" }),
    live({ href: "javascript:alert(1)", id: idDe(4), title: "  " })
  ]);

  const { items } = await inbox.listNotifications({ now: AGORA, userId: ALUNA });

  assert.deepEqual(
    items.map((item) => [item.kind, item.title, item.href, item.icon]),
    [
      ["webinar", "Lembrete da live", "/webinarios/live-de-agentes", { color: "white", id: "calendar" }],
      ["webinar", "Começou agora", "/webinarios/live-de-agentes", { color: "red", id: "live" }],
      ["webinar", "Live cancelada", "/webinarios/live-de-agentes", { color: "amber", id: "alert" }],
      ["webinar", "Lembrete da live", null, { color: "white", id: "calendar" }]
    ]
  );
  assert.equal(items[0].body, "Amanhã às 20:00: Live de agentes. Sua vaga está garantida.");
  assert.equal(items[1].body, "Começou agora: Live de agentes. Entrar.");
  assert.ok(
    items.every(
      (item) =>
        item.actor === null && item.cta === null && item.reactions === null && item.poll === null && item.response === null && item.audio === null && item.image === null && item.context === null && item.allowHide === true
    ),
    "a escola envia; nada de botao, reacao, enquete ou resposta; a lixeira sempre"
  );
});
