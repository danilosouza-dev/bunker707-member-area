import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { ALUNA, ALUNO, EQUIPE, SESSAO_ID, WEBINAR_ID, perfil, scriptedDb, sessaoRow, vagaRow, webinarRow } from "./support/webinarios-banco-falso.mjs";
import { bancoDoExportar, consultas, lerCsv } from "./support/webinarios-v4-exportar-banco.mjs";

// As rotas dos CSVs (docs/30 §3.1, §3.7, M6 e M9; docs/18 §2.2), sem banco e sem Next: GET /api/admin/webinars/[id]/
// relatorio/csv?sessao=&relatorio= (os sete relatorios; sem ?relatorio=, o Attendee de sempre) e GET /api/admin/
// webinars/painel/csv?tipo=&inicio=&fim=&relatorio= (Performance e Simulacao do periodo, com os filtros da aba). A guarda
// requireApiRole("messaging.write") vira um duble (401 sem sessao, 403 do analista); o banco e o banco falso dos CSVs.
// Aqui: 401/403 antes de qualquer leitura, 400 do pedido invalido, 404 da sessao de outro webinario, o arquivo
// (text/csv, attachment com o nome do Zoom, sem cache), a auditoria webinar_export (o relatorio, a sessao ou o periodo,
// o tipo e a contagem; nunca nome nem e-mail), o banco sem a migracao (503 com a migracao) e sem uma parte da fase 4
// (o CSV sai sem ela), e o erro comum (500 com a frase). Contra o banco local: tests/integration/webinarios-relatorio.test.mjs.

const guarda = (globalThis.__exportarRotasGuarda ??= { acoes: [], quem: "produtor" });

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      return stub(`
        export async function requireApiRole(action) {
          const guarda = globalThis.__exportarRotasGuarda;
          guarda.acoes.push(action);
          if (guarda.quem === "ninguem") return { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
          if (guarda.quem === "analista") return { response: Response.json({ error: "Sem permissao." }, { status: 403 }), user: { id: "analista" } };
          return { response: null, user: { id: "${EQUIPE}" } };
        }`);
    }
    const resolved = nextResolve(specifier, context);
    // db.ts importa o cliente por caminho relativo: o mesmo duble de admin-action-stubs vale aqui.
    if (typeof resolved.url === "string" && resolved.url.endsWith("/src/server/db/supabase/client.ts")) {
      return stub("export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; } export function hasSupabaseConfig() { return true; }");
    }
    return resolved;
  }
});

const sessionRoute = await import("../src/app/api/admin/webinars/[id]/relatorio/csv/route.ts");
const panelRoute = await import("../src/app/api/admin/webinars/painel/csv/route.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { anonymousNumber } = await import("../src/server/webinars/room-model.ts");

const OUTRO_WEBINAR = "aaaaaaaa-9999-4999-8999-999999999999";
const QUESTAO = "d1d1d1d1-0000-4000-8000-000000000001";
const COLUNAS = WEBINAR_COPY.exportar.colunas;

const encerrada = sessaoRow({
  ended_at: "2026-11-05T23:31:00.000Z",
  jit: false,
  // A decisao registrada (§8.6, D10): sem ela a sala nao mostrou nada e o CSV nao diz "Disparou: Sim".
  simulation_ack_text: "Decisão do produtor em 05/11/2026: ... Responsável: Produtora de Teste.",
  simulation_decided_at: "2026-11-05T20:00:00.000Z",
  simulated_count_rule: { base: 40, jitter: 0, mode: "fixed", peak: 40 },
  simulated_joins: null,
  simulated_sale_notices: { enabled: true, items: [{ offset_ms: 600_000, text: "Ana garantiu a vaga" }] },
  simulation_seed: 7,
  simulation_summary: { counter_max: 52, joins_shown: 0, sale_notices_shown: 1 },
  started_at: "2026-11-05T23:00:00.000Z",
  status: "ended"
});

const perguntaRow = (extra) => ({
  anonymous: false,
  answer_source: null,
  answer_text: null,
  answered_at: null,
  answered_by: null,
  answered_live: false,
  assigned_at: null,
  assigned_to: null,
  body: "Vai ter replay?",
  created_at: "2026-11-05T23:10:00.000Z",
  deleted_at: null,
  deleted_reason: null,
  display_name: "Ana S.",
  handoff_requested_at: null,
  id: QUESTAO,
  message_id: null,
  offset_ms: 600_000,
  session_id: SESSAO_ID,
  status: "open",
  updated_at: "2026-11-05T23:10:00.000Z",
  upvotes: 2,
  user_id: ALUNA,
  ...extra
});

const presente = (userId, extra = {}) => ({ entries: 1, first_at: "2026-11-05T23:00:10.000Z", last_at: "2026-11-05T23:29:40.000Z", messages: 1, polls: 0, questions: 0, reached_end: true, reactions: 0, registered: true, seconds: 1800, source: null, user_id: userId, ...extra });

function banco(extra = {}) {
  const db = bancoDoExportar({
    cliques: [{ click_token: "t".repeat(24), clicked_at: "2026-11-05T23:20:00.000Z", converted_at: null, converted_sale_grant_id: null, created_at: "", id: "c1", offer_id: "o1", offset_ms: 1_200_000, session_id: SESSAO_ID, user_id: ALUNA, variant_id: null, variant_label: "B" }],
    equipe: [EQUIPE],
    mensagens: [],
    painel: [],
    perfis: [perfil(ALUNA, "ana@exemplo.test", "Ana Souza"), perfil(ALUNO, "bruno@exemplo.test", "Bruno Lima"), perfil(EQUIPE, "carla@exemplo.test", "Carla Produtora")],
    perguntas: [
      perguntaRow({ answer_source: "ai", answer_text: "Sim, por 7 dias.", answered_at: "2026-11-05T23:11:00.000Z", status: "answered" }),
      perguntaRow({ anonymous: true, body: "Tem certificado?", created_at: "2026-11-05T23:12:00.000Z", id: "d2d2d2d2-0000-4000-8000-000000000002", user_id: ALUNO }),
      perguntaRow({ body: "Pergunta da equipe", created_at: "2026-11-05T23:13:00.000Z", id: "d3d3d3d3-0000-4000-8000-000000000003", user_id: EQUIPE })
    ],
    presentes: [presente(ALUNA)],
    relatorio: [{ item: "", metric: "unique", students: 1, total: 1 }],
    roteiro: [],
    sessoes: [encerrada],
    vagas: [vagaRow(ALUNA, { registered_at: "2026-11-01T12:00:00.000Z" }), vagaRow(EQUIPE)],
    ...extra
  });
  actionStubs.db = db;
  return db;
}

function pedirSessao(query, id = WEBINAR_ID) {
  return sessionRoute.GET(new Request(`http://localhost/api/admin/webinars/${id}/relatorio/csv${query}`), { params: Promise.resolve({ id }) });
}

function pedirPainel(query) {
  return panelRoute.GET(new Request(`http://localhost/api/admin/webinars/painel/csv${query}`));
}

const auditorias = (db) => consultas(db, "admin_audit_log").map((query) => query.payload);

test("a guarda vem antes de tudo: 401 sem sessao e 403 do analista, sem ler o banco nem gravar a auditoria; messaging.write nas duas rotas", async () => {
  for (const quem of ["ninguem", "analista"]) {
    const db = banco();
    guarda.quem = quem;
    guarda.acoes.length = 0;
    const sessao = await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`);
    const painel = await pedirPainel("?tipo=gravadas&inicio=2026-11-01T03:00:00.000Z&fim=2026-12-01T03:00:00.000Z");
    const esperado = quem === "ninguem" ? 401 : 403;
    assert.equal(sessao.status, esperado);
    assert.equal(painel.status, esperado);
    assert.equal(sessao.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(guarda.acoes, ["messaging.write", "messaging.write"]);
    assert.equal(db.queries.length, 0, "nada lido nem gravado");
  }
  guarda.quem = "produtor";
});

test("400 do pedido invalido: id ou sessao fora do formato, relatorio desconhecido; 404 da sessao de outro webinario ou que nao existe", async () => {
  banco();
  for (const [query, id] of [
    [`?sessao=${SESSAO_ID}`, "nao-e-uuid"],
    ["", WEBINAR_ID],
    ["?sessao=abc&relatorio=qa", WEBINAR_ID],
    [`?sessao=${SESSAO_ID}&relatorio=absentee`, WEBINAR_ID]
  ]) {
    const resposta = await pedirSessao(query, id);
    assert.equal(resposta.status, 400, `${id}${query}`);
    assert.deepEqual(await resposta.json(), { error: "Pedido inválido." });
  }

  const db = banco();
  const outro = await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`, OUTRO_WEBINAR);
  assert.equal(outro.status, 404);
  assert.deepEqual(await outro.json(), { error: "Essa sessão não existe mais." });
  const sumiu = await pedirSessao("?sessao=99999999-0000-4000-8000-000000000000&relatorio=qa");
  assert.equal(sumiu.status, 404);
  assert.deepEqual(auditorias(db), [], "sem arquivo, sem auditoria");
});

test("sem ?relatorio= sai o Attendee de sempre, com a variante clicada; a auditoria grava o relatorio, a sessao, o tipo e a contagem", async () => {
  const db = banco();
  const resposta = await pedirSessao(`?sessao=${SESSAO_ID}`);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(resposta.headers.get("content-disposition"), 'attachment; filename="webinario-live-de-agentes-2026-11-05-2000-attendee.csv"');
  assert.equal(resposta.headers.get("cache-control"), "private, no-store, max-age=0");
  const bytes = new Uint8Array(await resposta.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "o BOM do UTF-8 para o Excel");
  const [cabecalho, ana] = lerCsv(await resposta.text());
  assert.deepEqual(cabecalho, [...COLUNAS.attendee]);
  assert.equal(ana[1], "Ana Souza");
  assert.equal(ana[13], "B", "Oferta clicada (variante)");

  assert.deepEqual(auditorias(db), [
    {
      action: "webinar_export",
      actor_id: EQUIPE,
      count: 1,
      entity_id: WEBINAR_ID,
      entity_type: "webinar",
      metadata: { kind: "simulated", report: "attendee", session_id: SESSAO_ID, webinar_id: WEBINAR_ID }
    }
  ]);
});

test("cada um dos sete relatorios sai com as colunas do Zoom, o nome do arquivo e a auditoria; nome e e-mail nunca na auditoria", async () => {
  const esperado = {
    attendee: COLUNAS.attendee,
    performance: COLUNAS.performance,
    poll: COLUNAS.poll,
    qa: COLUNAS.qa,
    registration: COLUNAS.registration,
    simulacao: COLUNAS.simulacao,
    survey: COLUNAS.survey
  };

  for (const [relatorio, colunas] of Object.entries(esperado)) {
    const db = banco();
    const resposta = await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=${relatorio}`);
    assert.equal(resposta.status, 200, relatorio);
    assert.equal(resposta.headers.get("content-disposition"), `attachment; filename="webinario-live-de-agentes-2026-11-05-2000-${relatorio}.csv"`);
    const linhas = lerCsv(await resposta.text());
    const cabecalho = relatorio === "performance" || relatorio === "simulacao" ? linhas[1] : linhas[0];
    assert.deepEqual(cabecalho, [...colunas], relatorio);
    const [auditoria] = auditorias(db);
    assert.equal(auditoria.metadata.report, relatorio);
    assert.doesNotMatch(JSON.stringify(auditoria), /Ana|@exemplo/, "so ids e contagens");
  }
});

test("Q&A pela rota: o Assistente como quem respondeu, a anonima como 'Aluno {n}' sem e-mail, a pergunta da equipe fora", async () => {
  const db = banco();
  const linhas = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`)).text());
  assert.equal(linhas.length, 3, "cabecalho + duas perguntas de alunos");
  assert.deepEqual(linhas[1], ["1", "05/11/2026 às 20:10", "10:00", "Ana Souza", "ana@exemplo.test", "Vai ter replay?", "2", "Respondida", "Assistente", "Sim, por 7 dias.", "Não", "05/11/2026 às 20:11"]);
  assert.deepEqual(linhas[2].slice(3, 5), [`Aluno ${anonymousNumber(ALUNO, WEBINAR_ID)}`, ""]);
  assert.equal(auditorias(db)[0].count, 2);
});

test("Registration, Performance e Simulacao pela rota: a equipe fora das vagas; o Performance pela RPC do painel da sessao; a Simulacao com o contador e o aviso", async () => {
  let db = banco();
  const vagas = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=registration`)).text());
  assert.deepEqual(vagas.slice(1).map((linha) => [linha[0], linha[3], linha[6]]), [["Ana Souza", "Vaga garantida", "Sim"]]);

  db = banco({
    painel: [
      { item: "", metric: "present", session_id: SESSAO_ID, students: 3, total: 3 },
      { item: "max", metric: "sim_counter", session_id: SESSAO_ID, students: 0, total: 98765 }
    ]
  });
  const performance = await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=performance`)).text();
  const [rpc] = consultas(db, "webinar_panel");
  assert.equal(rpc.args.p_kind, "simulated");
  assert.deepEqual(rpc.args.p_session_ids, [SESSAO_ID]);
  assert.ok(Date.parse(rpc.args.p_start) < Date.parse(encerrada.scheduled_at) && Date.parse(rpc.args.p_end) > Date.parse(encerrada.scheduled_at));
  const linha = lerCsv(performance)[2];
  assert.equal(linha[0], "Live de agentes");
  assert.equal(linha[6], "3");
  assert.ok(!performance.includes("98765"), "o contador simulado nunca entra no Performance");

  banco();
  const simulacao = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=simulacao`)).text());
  assert.deepEqual(simulacao.slice(2), [
    ["Contador", "", "", "", "real + número fixo · maior número mostrado: 52 · participantes de verdade: 1", "Sim"],
    ["Aviso de venda", "10:00", "", "", "Ana garantiu a vaga", "Sim"]
  ]);
});

test("banco sem uma parte da fase 4: o Attendee sai sem a variante (sem a 202610290005) e o Q&A sem o Assistente (sem a 202610290006)", async () => {
  banco({ semMigracao: ["ofertas", "assistente"] });
  const attendee = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}`)).text());
  assert.equal(attendee[1][13], "");
  const qa = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`)).text());
  assert.equal(qa[1][8], "Equipe", "sem answer_source, a resposta sai como da equipe");
  const simulacao = lerCsv(await (await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=simulacao`)).text());
  assert.deepEqual(simulacao.slice(2), [], "sem as colunas da Simulacao: so o roteiro (vazio aqui)");
});

test("banco sem a migracao dos webinarios: 503 com a migracao; erro comum do banco: 500 com a frase, sem auditoria", async () => {
  actionStubs.db = scriptedDb(() => ({ data: null, error: { code: "42703", message: "column webinar_sessions.jit does not exist" } }));
  const sem = await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`);
  assert.equal(sem.status, 503);
  // INTEGRACAO (provisorio, ate a renumeracao das migracoes da fase 4): WEBINARS_MIGRATION aponta a mais nova (a
  // 202610300001, que inclui a 0008 do jit pela ordem dos arquivos).
  assert.deepEqual(await sem.json(), { error: "Esta parte precisa da atualização do banco (migração 202610300001)." });
  const semPainel = await pedirPainel("?tipo=gravadas&inicio=2026-11-01T03:00:00.000Z&fim=2026-12-01T03:00:00.000Z");
  assert.equal(semPainel.status, 503);

  const db = banco({ falha: "webinar_sessions" });
  const original = console.error;
  console.error = () => {};
  try {
    const erro = await pedirSessao(`?sessao=${SESSAO_ID}&relatorio=qa`);
    assert.equal(erro.status, 500);
    assert.deepEqual(await erro.json(), { error: "Não foi possível gerar o CSV. Tente de novo." });
  } finally {
    console.error = original;
  }
  assert.deepEqual(auditorias(db), []);
});

/* ------------------------------------------------------------------------------------------------
 * O painel
 * ---------------------------------------------------------------------------------------------- */

const PERIODO = "inicio=2026-11-01T03:00:00.000Z&fim=2026-12-01T03:00:00.000Z";
const NOVEMBRO_6 = "33333333-aaaa-4aaa-8aaa-333333333333";
const OUTRA_LIVE = "44444444-aaaa-4aaa-8aaa-444444444444";

const OFERTA = "abababab-0000-4000-8000-000000000001";
const ofertaRow = { attribution_days: 7, created_at: "", created_by: null, deadline_minutes: null, id: OFERTA, product_id: "curso-ia", show_at_offset_ms: 0, status: "active", title: "", trigger_kind: "at_offset", updated_at: "", visible_minutes: null, webinar_id: WEBINAR_ID };
const variante = (label, enabled) => ({ badge: null, checkout_url: "https://pay.example.com/x", coupon: null, created_at: "", enabled, headline: `Oferta ${label}`, id: `v-${label}`, image_url: null, label, offer_id: OFERTA, price_from_label: null, price_label: null, updated_at: "", weight: 1 });

function bancoDoPainel(extra = {}) {
  return banco({
    // A Oferta do webinario com so a A ligada; a sessao de 05/11 mostrou a B (a foto do que apareceu).
    exibicoes: [
      { created_at: "", deadline_at: null, hidden_at: null, hidden_by: null, hide_offset_ms: null, id: "x1", offer_id: OFERTA, session_id: SESSAO_ID, show_offset_ms: 0, shown_at: "", shown_by: null, snapshot: { capturedAt: "2026-11-05T23:00:00.000Z", deadlineAt: null, variants: [{ headline: "Oferta B", label: "B" }] }, updated_at: "" }
    ],
    ofertas: [ofertaRow],
    variantes: [variante("A", true), variante("B", false)],
    painel: (args) =>
      [
        { item: "", metric: "duration", session_id: SESSAO_ID, students: 0, total: 1_800_000 },
        { item: "", metric: "present", session_id: SESSAO_ID, students: 3, total: 3 },
        { item: "", metric: "offer_seen", session_id: SESSAO_ID, students: 2, total: 2 },
        { item: "B:seen", metric: "offer_variant", session_id: SESSAO_ID, students: 2, total: 2 },
        { item: "", metric: "present", session_id: NOVEMBRO_6, students: 5, total: 5 },
        { item: "max", metric: "sim_counter", session_id: NOVEMBRO_6, students: 0, total: 98765 },
        { item: "", metric: "unique_present", session_id: null, students: 7, total: 7 }
      ].filter((row) => !row.session_id || args.p_session_ids?.includes(row.session_id)),
    sessoes: [
      encerrada,
      sessaoRow({ id: NOVEMBRO_6, scheduled_at: "2026-11-06T23:00:00.000Z", simulated_count_rule: null, simulation_summary: { counter_max: 70 }, status: "ended" }),
      sessaoRow({ id: OUTRA_LIVE, scheduled_at: "2026-11-07T23:00:00.000Z", status: "ended", webinar_id: OUTRO_WEBINAR }),
      sessaoRow({ id: "66666666-aaaa-4aaa-8aaa-666666666666", scheduled_at: "2026-11-08T23:00:00.000Z", status: "cancelled" }),
      sessaoRow({ id: "55555555-aaaa-4aaa-8aaa-555555555555", scheduled_at: "2026-10-20T23:00:00.000Z", status: "ended" })
    ],
    webinars: [webinarRow({ product_id: "curso-ia" }), webinarRow({ id: OUTRO_WEBINAR, slug: "outra", title: "Outra live" })],
    ...extra
  });
}

test("o painel: 400 do tipo, do periodo e do relatorio que so existe por sessao", async () => {
  bancoDoPainel();
  for (const query of [`?tipo=replay&${PERIODO}`, "?tipo=gravadas&inicio=2026-01-01T00:00:00Z&fim=2027-06-01T00:00:00Z", `?tipo=gravadas&${PERIODO}&relatorio=qa`, "?tipo=gravadas"]) {
    const resposta = await pedirPainel(query);
    assert.equal(resposta.status, 400, query);
    assert.deepEqual(await resposta.json(), { error: "Pedido inválido." });
  }
});

test("o Performance do periodo: uma linha por sessao do periodo (com os filtros da aba), sem o bloco Simulacao; o nome e a auditoria do periodo", async () => {
  const db = bancoDoPainel();
  const resposta = await pedirPainel(`?tipo=gravadas&${PERIODO}&relatorio=performance`);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("content-disposition"), 'attachment; filename="webinario-gravadas-periodo-2026-11-01-a-2026-11-30-performance.csv"');
  const texto = await resposta.text();
  const linhas = lerCsv(texto);
  assert.deepEqual(linhas[0], [WEBINAR_COPY.exportar.cabecalhoPerformance]);
  assert.deepEqual(linhas[1], [...COLUNAS.performance]);
  assert.deepEqual(
    linhas.slice(2).map((linha) => [linha[0], linha[1], linha[6]]),
    [
      ["Live de agentes", SESSAO_ID, "3"],
      ["Live de agentes", NOVEMBRO_6, "5"],
      ["Outra live", OUTRA_LIVE, "0"]
    ],
    "as sessoes do periodo, na ordem das horas; a de outubro e a cancelada (sem o filtro Situacao) ficam fora, como na tela"
  );
  assert.ok(!texto.includes("98765"), "nada do bloco Simulacao");
  assert.deepEqual(consultas(db, "webinar_panel")[0].args.p_kind, "simulated");
  assert.deepEqual(auditorias(db), [
    {
      action: "webinar_export",
      actor_id: EQUIPE,
      count: 3,
      entity_id: null,
      entity_type: "webinar",
      metadata: { kind: "simulated", period: { end: "2026-12-01T03:00:00.000Z", start: "2026-11-01T03:00:00.000Z" }, report: "performance", sessions: 3 }
    }
  ]);

  bancoDoPainel();
  const filtrado = lerCsv(await (await pedirPainel(`?tipo=gravadas&${PERIODO}&produto=curso-ia&variante=B`)).text());
  assert.deepEqual(
    filtrado.slice(2).map((linha) => linha[1]),
    [SESSAO_ID],
    "o mesmo recorte do painel: Produto tira a outra live; Variante B so a sessao que mostrou a B"
  );
  bancoDoPainel();
  const comOferta = lerCsv(await (await pedirPainel(`?tipo=gravadas&${PERIODO}&com-oferta=1`)).text());
  assert.deepEqual(
    comOferta.slice(2).map((linha) => linha[1]),
    [SESSAO_ID, NOVEMBRO_6],
    "Com oferta: as sessoes do webinario com a Oferta montada"
  );
  bancoDoPainel();
  const canceladas = lerCsv(await (await pedirPainel(`?tipo=gravadas&${PERIODO}&situacao=canceladas`)).text());
  assert.deepEqual(canceladas.slice(2).map((linha) => linha[1]), ["66666666-aaaa-4aaa-8aaa-666666666666"]);
});

test("a Simulacao do periodo: so as sessoes gravadas, com o webinario, a sessao e a hora na frente; sem sessao no periodo, so as colunas", async () => {
  bancoDoPainel();
  const linhas = lerCsv(await (await pedirPainel(`?tipo=gravadas&${PERIODO}&relatorio=simulacao&webinario=${WEBINAR_ID}`)).text());
  assert.deepEqual(linhas[0], [WEBINAR_COPY.exportar.cabecalhoSimulacao]);
  assert.deepEqual(linhas[1], ["Webinário", "Sessão", "Data", ...COLUNAS.simulacao]);
  assert.deepEqual(
    linhas.slice(2).map((linha) => [linha[1], linha[3], linha[7]]),
    [
      [SESSAO_ID, "Contador", "real + número fixo · maior número mostrado: 52 · participantes de verdade: 3"],
      [SESSAO_ID, "Aviso de venda", "Ana garantiu a vaga"],
      [NOVEMBRO_6, "Contador", "real · maior número mostrado: 70 · participantes de verdade: 5"]
    ]
  );

  const vazio = bancoDoPainel({ sessoes: [] });
  const semSessao = lerCsv(await (await pedirPainel(`?tipo=gravadas&${PERIODO}&relatorio=simulacao`)).text());
  assert.equal(semSessao.length, 2, "a frase e as colunas");
  assert.equal(consultas(vazio, "webinar_panel").length, 0, "sem sessao, nem chama a RPC");
});
