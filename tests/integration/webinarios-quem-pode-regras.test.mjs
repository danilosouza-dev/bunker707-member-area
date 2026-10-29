import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { limparWebinarios, seedEscolaDeTeste, SENHA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Quem pode da live por regras (docs/30 §1.6; docs/22 §3; docs/18 §3) contra o banco LOCAL de verdade, com a migracao
// 202610300001 aplicada: a RPC communication_webinar_facts devolve uma linha por aluno com as lives em que ele garantiu
// vaga e as em que entrou na sala (igual ao "Compareceram" do relatorio). Vaga 'registered' conta e a cancelada nao; a
// presenca resumida de uma sessao encerrada conta; a sessao em andamento conta pelas amostras depois do inicio (a sala
// de espera nao); o replay nao conta; a equipe fica de fora; com p_user_ids so esses alunos. Pelo app: loadWebinarFacts
// e as regras "Participação em lives" do segmento sobre os fatos lidos. O aluno logado recebe 42501 (so service_role);
// o "both" do app grava 'product' + audience_restricts e o check da 0028 continua recusando um valor novo ('both'). Todos
// os alunos por chave (p_after + p_limit), sem repetir nem pular.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const { loadAudienceFactsFor, loadWebinarFacts } = await import("../../src/server/communications/audience-facts.ts");
const { evaluateAudience } = await import("../../src/server/communications/audience-model.ts");
const { WEBINAR_COLUMNS, webinarFromRow } = await import("../../src/server/webinars/rows.ts");

const aluna = contas.aluna;
const alunoSemAcesso = contas.alunoSemAcesso;
const alunaAcessoExpirado = contas.alunaAcessoExpirado;
const produtor = contas.produtor;
const alunos = [aluna.id, alunoSemAcesso.id, alunaAcessoExpirado.id];
const pessoas = [...alunos, produtor.id];

/** Live ao vivo ja encerrada (com o replay) e Live gravada em andamento. */
const LIVE_A = {
  id: "bbbbbbbb-0000-4000-8000-0000000000a1",
  replayId: "bbbbbbbb-0000-4000-8000-0000000000a3",
  sessaoId: "bbbbbbbb-0000-4000-8000-0000000000a2",
  slug: "teste-quem-pode-live-a",
  titulo: "Live de Teste: Quem pode A"
};
const LIVE_B = {
  id: "bbbbbbbb-0000-4000-8000-0000000000a4",
  sessaoId: "bbbbbbbb-0000-4000-8000-0000000000a5",
  slug: "teste-quem-pode-live-b",
  titulo: "Live de Teste: Quem pode B"
};
const MINUTO_MS = 60_000;
const emMinutos = (minutos) => new Date(Date.now() + minutos * MINUTO_MS).toISOString();

async function seed() {
  unwrap(
    await db.from("webinars").upsert(
      [
        { access_mode: "everyone", created_by: produtor.id, host_user_id: produtor.id, id: LIVE_A.id, kind: "live", published_at: emMinutos(-180), scheduled_at: emMinutos(-120), slug: LIVE_A.slug, status: "published", title: LIVE_A.titulo },
        { access_mode: "everyone", created_by: produtor.id, host_user_id: produtor.id, id: LIVE_B.id, kind: "simulated", published_at: emMinutos(-60), slug: LIVE_B.slug, status: "published", title: LIVE_B.titulo }
      ],
      { onConflict: "id" }
    ),
    "Gravando as lives"
  );
  unwrap(
    await db.from("webinar_sessions").upsert(
      [
        { ended_at: emMinutos(-60), id: LIVE_A.sessaoId, kind: "live", scheduled_at: emMinutos(-120), started_at: emMinutos(-120), status: "ended", webinar_id: LIVE_A.id },
        { id: LIVE_A.replayId, kind: "replay", scheduled_at: emMinutos(-60), status: "live", webinar_id: LIVE_A.id },
        { id: LIVE_B.sessaoId, kind: "simulated", scheduled_at: emMinutos(-10), started_at: emMinutos(-10), status: "live", webinar_id: LIVE_B.id }
      ],
      { onConflict: "id" }
    ),
    "Gravando as sessoes"
  );
  unwrap(
    await db.from("webinar_registrations").insert([
      { status: "registered", user_id: alunoSemAcesso.id, webinar_id: LIVE_A.id },
      { cancelled_at: emMinutos(-150), status: "cancelled", user_id: alunaAcessoExpirado.id, webinar_id: LIVE_A.id },
      { status: "registered", user_id: produtor.id, webinar_id: LIVE_A.id }
    ]),
    "Gravando as vagas"
  );
  // A aluna entrou na live A (resumo da sessao encerrada); a aluna com o acesso expirado so viu o replay; a equipe entrou.
  unwrap(
    await db.from("webinar_attendance").insert([
      { first_at: emMinutos(-118), last_at: emMinutos(-70), seconds: 2880, session_id: LIVE_A.sessaoId, user_id: aluna.id },
      { first_at: emMinutos(-50), last_at: emMinutos(-40), seconds: 600, session_id: LIVE_A.replayId, user_id: alunaAcessoExpirado.id },
      { first_at: emMinutos(-119), last_at: emMinutos(-61), seconds: 3480, session_id: LIVE_A.sessaoId, user_id: produtor.id }
    ]),
    "Gravando as presencas encerradas"
  );
  // Live B em andamento (ainda sem o resumo): o aluno sem acesso entrou depois do inicio; a aluna com o acesso expirado
  // so ficou na sala de espera (balde negativo); a equipe tambem entrou.
  const amostra = (userId, bucket) => ({ bucket, first_at: emMinutos(-5), last_at: emMinutos(-5), session_id: LIVE_B.sessaoId, state: "playing", user_id: userId });
  unwrap(
    await db.from("webinar_presence_samples").insert([amostra(alunoSemAcesso.id, 2), amostra(alunoSemAcesso.id, 3), amostra(alunaAcessoExpirado.id, -3), amostra(produtor.id, 1)]),
    "Gravando as amostras da live em andamento"
  );
}

before(async () => {
  await limparWebinarios(db);
  await seed();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
});

/** As linhas da RPC (uma por aluno, com as listas) como "aluno|live|vaga|entrou", em ordem. */
const chaves = (rows) =>
  rows
    .flatMap((row) => {
      const registered = row.registered ?? [];
      const attended = row.attended ?? [];

      return [...new Set([...registered, ...attended])].map((webinarId) => `${row.user_id}|${webinarId}|${registered.includes(webinarId)}|${attended.includes(webinarId)}`);
    })
    .sort();

test("1. a RPC: vaga, presenca encerrada e em andamento contam; vaga cancelada, sala de espera e replay nao; a equipe fica de fora", async () => {
  const rows = unwrap(await db.rpc("communication_webinar_facts", { p_user_ids: pessoas }), "Lendo as lives dos alunos de teste");

  assert.equal(rows.length, new Set(rows.map((row) => row.user_id)).size, "uma linha por aluno");
  assert.deepEqual(
    chaves(rows),
    [
      `${aluna.id}|${LIVE_A.id}|false|true`,
      `${alunoSemAcesso.id}|${LIVE_A.id}|true|false`,
      `${alunoSemAcesso.id}|${LIVE_B.id}|false|true`
    ].sort()
  );

  // Sem p_user_ids: todos os alunos (as linhas dos de teste sao as mesmas).
  const todos = unwrap(await db.rpc("communication_webinar_facts"), "Lendo as lives de todos");
  assert.deepEqual(chaves(todos.filter((row) => pessoas.includes(row.user_id))), chaves(rows));

  // So a aluna: so a linha dela.
  const soAluna = unwrap(await db.rpc("communication_webinar_facts", { p_user_ids: [aluna.id] }), "Lendo as lives da aluna");
  assert.deepEqual(chaves(soAluna), [`${aluna.id}|${LIVE_A.id}|false|true`]);

  // Todos por chave (p_after + p_limit, como loadWebinarFacts pagina), um aluno por pagina: as mesmas linhas, na ordem
  // do id, sem repetir nem pular ninguem.
  const porChave = [];

  for (let after = null; ; ) {
    const pagina = unwrap(await db.rpc("communication_webinar_facts", { p_after: after, p_limit: 1 }), "Lendo uma pagina por chave");

    if (pagina.length === 0) {
      break;
    }

    assert.equal(pagina.length, 1, "o p_limit vale");
    porChave.push(...pagina);
    after = pagina[0].user_id;
  }

  assert.deepEqual(porChave.map((row) => row.user_id), [...porChave.map((row) => row.user_id)].sort(), "na ordem do id");
  assert.equal(new Set(porChave.map((row) => row.user_id)).size, porChave.length, "ninguem repetido");
  assert.deepEqual(chaves(porChave), chaves(todos));
});

test("2. encerrada a live B, o resumo passa a contar no lugar das amostras (o mesmo aluno continua 'participou')", async () => {
  unwrap(
    await db.from("webinar_attendance").insert({ first_at: emMinutos(-9), last_at: emMinutos(-1), seconds: 480, session_id: LIVE_B.sessaoId, user_id: alunoSemAcesso.id }),
    "Gravando o resumo da live B"
  );
  unwrap(await db.from("webinar_sessions").update({ ended_at: emMinutos(0), status: "ended" }).eq("id", LIVE_B.sessaoId), "Encerrando a live B");

  const rows = unwrap(await db.rpc("communication_webinar_facts", { p_user_ids: pessoas }), "Lendo as lives depois do fim");
  assert.ok(chaves(rows).includes(`${alunoSemAcesso.id}|${LIVE_B.id}|false|true`));
  assert.equal(rows.some((row) => row.user_id === alunaAcessoExpirado.id), false, "a sala de espera continua nao contando");
});

test("3. pelo app: loadWebinarFacts e as regras 'Participação em lives' sobre os fatos lidos", async () => {
  const lives = await loadWebinarFacts(db, { userIds: pessoas });

  assert.deepEqual(lives.get(aluna.id), { attended: [LIVE_A.id], registered: [] });
  assert.deepEqual(lives.get(alunoSemAcesso.id), { attended: [LIVE_B.id], registered: [LIVE_A.id] });
  assert.equal(lives.has(alunaAcessoExpirado.id), false);
  assert.equal(lives.has(produtor.id), false, "a equipe fica de fora");

  const loaded = await loadAudienceFactsFor(db, alunos, Date.now(), { comments: "none", webinars: true });
  const quem = (rule) =>
    loaded.facts
      .filter((fact) => evaluateAudience({ kind: "rules", root: { items: [rule], match: "all" } }, fact, loaded.context))
      .map((fact) => fact.userId)
      .sort();

  assert.equal(loaded.context.webinarFactsLoaded, true);
  assert.deepEqual(quem({ action: "attended", negate: false, type: "webinar", webinarId: LIVE_A.id }), [aluna.id]);
  assert.deepEqual(quem({ action: "registered", negate: false, type: "webinar", webinarId: LIVE_A.id }), [alunoSemAcesso.id]);
  assert.deepEqual(quem({ action: "attended", negate: true, type: "webinar", webinarId: null }), [alunaAcessoExpirado.id], "so viu o replay: nunca participou");
  assert.deepEqual(quem({ action: "attended", negate: false, type: "webinar", webinarId: null }), [aluna.id, alunoSemAcesso.id].sort());
});

test("4. a RPC e so do service_role: o aluno logado recebe 42501; o both grava 'product' + audience_restricts e o check recusa um valor novo", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const args of [{}, { p_user_ids: [aluna.id] }]) {
    const negado = await cliente.rpc("communication_webinar_facts", args);
    assert.equal(negado.error?.code, "42501", JSON.stringify(negado.error));
  }

  await cliente.auth.signOut();

  // O "both" do app: 'product' + audience_restricts. O app de antes (num rollback) le 'product' e exige o produto.
  unwrap(
    await db.from("webinars").update({ access_mode: "product", audience_restricts: true, product_id: "teste-curso-agentes" }).eq("id", LIVE_A.id),
    "Gravando o modo both"
  );
  const linha = unwrap(await db.from("webinars").select(WEBINAR_COLUMNS).eq("id", LIVE_A.id).single(), "Lendo a live");
  assert.equal(webinarFromRow(linha).accessMode, "both");

  for (const valor of ["both", "todos_e_ninguem"]) {
    const recusado = await db.from("webinars").update({ access_mode: valor }).eq("id", LIVE_A.id);
    assert.equal(recusado.error?.code, "23514", `o check da 0028 recusa '${valor}'`);
  }
});
