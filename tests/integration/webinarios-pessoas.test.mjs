import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  LIVE_GRAVADA_NO_AR_DE_TESTE,
  SENHA_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoDeTeste,
  seedLiveGravadaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// As pessoas que comentam e a pergunta simulada (pedido do produtor de 11/11/2026; docs/30 D75 a D78) contra o banco
// LOCAL de verdade, com a migracao 202611140001 aplicada (docs/18 §2.3). Escrito na rodada v8 e rodado por quem junta.
// - o nome comparavel do banco (webinar_persona_name_key) e o do app (personaNameKey) dao o mesmo texto;
// - a aluna logada nao le webinar_personas nem roda a funcao do nome (so o service_role);
// - criar, editar (as copias dos itens mudam), o nome repetido recusado (no app e no indice unico), remover (os itens
//   ficam com a copia e sem a pessoa, pelo on delete set null do banco);
// - o preenchimento da migracao (a secao 5, numa transacao desfeita no fim): uma pessoa por nome dos itens e das
//   mensagens do Enviar agora, o nome e o papel do mais recente e a foto mais recente que existe (revisao v8, achado
//   5), os itens ligados com a copia da pessoa;
// - duplicar o webinario copia a lista;
// - a pergunta simulada na Live ao vivo: o "Enviar agora" de Tipo Pergunta grava sem aluno; a aluna ve a pergunta na
//   aba com o nome e a foto da pessoa, vota, e nao responde no fio (403); a equipe responde; o relatorio, o painel e o
//   CSV Q&A nao contam a pergunta; os checks do banco recusam a simulada com aluno e a da turma sem aluno;
// - o item Pergunta da Live gravada: webinar_open_session abre a pergunta ligada a mensagem, com a hora dela, e a aba
//   so mostra a que ja chegou a hora; o Atendimento da equipe tambem (revisao v8, achado 2: nem na fila, nem
//   distribuida, nem na conta de abertas);
// - importar o CSV liga e cria as pessoas, com duas importacoes ao mesmo tempo contra o indice unico de verdade (revisao
//   v8, achado 3); a lista com mais de 1.000 pessoas vem inteira (revisao v8, achado 4);
// - a lista da escola (pedido do produtor de 13/11/2026; docs/30 D117; migracao 202611180001): o nome e unico na escola
//   pelo indice de verdade, a pessoa criada numa live vale na outra, o Duplicar nao copia mais a lista, excluir o
//   webinario de origem deixa a pessoa na lista (a origem nula), e a secao 2 da migracao junta as repetidas de
//   webinarios diferentes numa transacao desfeita.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const GRAVADA = LIVE_GRAVADA_NO_AR_DE_TESTE;
const FOTO = "webinars/personas/0123456789abcdef01234567.webp";
const OUTRA_FOTO = "webinars/personas/89abcdef0123456789abcdef.webp";
const produtor = usuarioDeTeste(contas.produtor);
const aluna = usuarioDeTeste(contas.aluna);

const persona = await import("../../src/server/webinars/persona-model.ts");
const personaActions = await import("../../src/server/webinars/persona-actions.ts");
const scriptActions = await import("../../src/server/webinars/script-actions.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const webinarActions = await import("../../src/server/webinars/actions.ts");
const assistantActions = await import("../../src/server/webinars/assistant-actions.ts");
const assistantQueries = await import("../../src/server/webinars/assistant-queries.ts");
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const voteRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/vote/route.ts");
const repliesRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/replies/route.ts");
const { loadSessionExport } = await import("../../src/server/webinars/export-queries.ts");
const { clearScriptedAvatarCache } = await import("../../src/server/webinars/persona-store.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { resetRoomAccessCache } = await import("../../src/server/webinars/room-route.ts");
const { WEBINAR_COPY } = await import("../../src/lib/webinar-copy.ts");

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

/** psql no banco local (SUPABASE_DB_URL do .env.test.local), devolvendo a saida. */
function sql(script) {
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url, "SUPABASE_DB_URL vem do .env.test.local (npm run db:start)");
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** A secao 2 da 202611180001 (juntar as repetidas e o indice unico do nome), como esta no arquivo. */
function secaoDaEscola() {
  const texto = readFileSync(new URL("../../supabase/migrations/202611180001_webinars_pessoas_da_escola.sql", import.meta.url), "utf8");
  return texto.slice(texto.indexOf("set lock_timeout", texto.indexOf(" * 2. ")));
}

/** A secao 5 da migracao (o preenchimento), como esta no arquivo. */
function secaoDoPreenchimento() {
  const texto = readFileSync(new URL("../../supabase/migrations/202611140001_webinars_v8_pessoas.sql", import.meta.url), "utf8");
  const inicio = texto.indexOf("do $$", texto.indexOf(" * 5. "));
  const fim = texto.indexOf("$$;", texto.indexOf("end if;", inicio)) + 3;
  return texto.slice(inicio, fim);
}

async function pedirPerguntas(user, webinarId, sessionId) {
  actAs(user);
  const resposta = await questionsRoute.GET(new Request(`http://localhost/api/webinars/${webinarId}/questions?sessao=${sessionId}&ordem=recentes`), { params: Promise.resolve({ id: webinarId }) });
  const body = await resposta.json();
  assert.equal(resposta.status, 200, JSON.stringify(body));
  return body.data.questions;
}

before(async () => {
  await limparWebinarios(db);
  await seedLiveAoVivoDeTeste(db, { comecouHa: 5 * 60_000, status: "live" });
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  resetRoomLimits();
  resetRoomAccessCache();
  clearScriptedAvatarCache();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
});

test("1. o nome comparavel do banco e o do app dao o mesmo texto (acento, caixa, espacos, NFC); so o service_role le a lista", async () => {
  for (const nome of ["Adriano Souza", "  adriano   SOUZA ", "ÁLVARO  Çé", "João Ñandu", "\tÉrica de Assunção\n", "ÍTALO Ü"]) {
    const doBanco = unwrap(await db.rpc("webinar_persona_name_key", { p_name: nome }), `O nome de ${nome}`);
    assert.equal(doBanco, persona.personaNameKey(nome), nome);
  }
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");
  assert.equal((await cliente.from("webinar_personas").select("id").limit(1)).error?.code, "42501");
  assert.equal((await cliente.rpc("webinar_persona_name_key", { p_name: "x" })).error?.code, "42501");
  await cliente.auth.signOut();
});

test("2. criar, editar (as copias dos itens mudam), o nome repetido recusado e remover (os itens ficam com a copia, sem a pessoa)", async () => {
  actAs(produtor);
  const criada = ok(await personaActions.savePersona({ avatarPath: FOTO, name: "Adriano Souza", role: "student", webinarId: AO_VIVO.id }));
  const repetida = await personaActions.savePersona({ avatarPath: null, name: "  adriano SOUZA ", role: "team", webinarId: AO_VIVO.id });
  assert.deepEqual([repetida.status, repetida.fieldErrors?.name?.[0]], [400, WEBINAR_COPY.pessoas.erros.nomeRepetido]);
  // O indice unico do banco segura o mesmo nome por outro caminho, tambem noutro webinario (D117: o nome e da escola).
  const direto = await db.from("webinar_personas").insert({ name: "ADRIANO  souza", webinar_id: AO_VIVO.id });
  assert.equal(direto.error?.code, "23505");
  const noutro = await db.from("webinar_personas").insert({ name: "Adriano Souza", webinar_id: GRAVADA.id });
  assert.equal(noutro.error?.code, "23505", "o mesmo nome noutro webinario");
  const naGravada = await personaActions.savePersona({ avatarPath: null, name: "adriano souza", role: "student", webinarId: GRAVADA.id });
  assert.deepEqual([naGravada.status, naGravada.fieldErrors?.name?.[0]], [400, WEBINAR_COPY.pessoas.erros.nomeRepetido], "pela tela da outra live tambem");

  const [um, dois] = unwrap(
    await db
      .from("webinar_chat_script_items")
      .insert([
        { body: "Primeiro", kind: "message", persona_avatar_path: FOTO, persona_id: criada.persona.id, persona_name: "Adriano Souza", persona_role: "student", position: 0, status: "ready", trigger_kind: "manual", webinar_id: AO_VIVO.id },
        { body: "Segundo", kind: "message", persona_avatar_path: FOTO, persona_id: criada.persona.id, persona_name: "Adriano Souza", persona_role: "student", position: 1, status: "ready", trigger_kind: "manual", webinar_id: AO_VIVO.id }
      ])
      .select("id"),
    "Os itens do Adriano"
  );
  const editada = ok(await personaActions.savePersona({ avatarPath: OUTRA_FOTO, id: criada.persona.id, name: "Adriano S.", role: "team", webinarId: AO_VIVO.id }));
  assert.equal(editada.items, 2);
  const copias = unwrap(await db.from("webinar_chat_script_items").select("persona_name, persona_role, persona_avatar_path").in("id", [um.id, dois.id]), "As copias");
  assert.deepEqual(copias.map((row) => [row.persona_name, row.persona_role, row.persona_avatar_path]), [["Adriano S.", "team", OUTRA_FOTO], ["Adriano S.", "team", OUTRA_FOTO]]);

  const removida = ok(await personaActions.deletePersona({ id: criada.persona.id, webinarId: AO_VIVO.id }));
  assert.equal(removida.items, 2);
  const depois = unwrap(await db.from("webinar_chat_script_items").select("persona_id, persona_name, persona_avatar_path").in("id", [um.id, dois.id]), "Os itens sem a pessoa");
  assert.deepEqual(depois.map((row) => [row.persona_id, row.persona_name, row.persona_avatar_path]), [[null, "Adriano S.", OUTRA_FOTO], [null, "Adriano S.", OUTRA_FOTO]]);
  unwrap(await db.from("webinar_chat_script_items").delete().in("id", [um.id, dois.id]), "Limpando os itens");
  actAs(null);
});

test("3. o preenchimento da migracao (numa transacao desfeita): uma pessoa por nome dos itens e do Enviar agora, o nome e o papel do mais recente, a foto mais recente que existe, os itens ligados com a copia", () => {
  const webinar = AO_VIVO.id;
  // A Bia (revisao v8, achado 5): a linha mais nova nao tem foto; a foto da mais velha fica na pessoa e vai para os
  // dois itens (antes, a pessoa pegava a foto nula da mais recente e a copia apagava a foto do item mais velho).
  const saida = sql(`
    begin;
    delete from public.webinar_personas;
    insert into public.webinar_chat_script_items (webinar_id, trigger_kind, persona_name, persona_role, body, kind, status, position, persona_avatar_path, updated_at) values
      ('${webinar}', 'manual', 'adriano  souza', 'student', 'Velho', 'message', 'ready', 10, null, now() - interval '2 hours'),
      ('${webinar}', 'manual', 'Adriano Souza', 'team', 'Novo', 'message', 'ready', 11, '${FOTO}', now() - interval '1 hour'),
      ('${webinar}', 'manual', 'Bia Velha', 'student', 'Com foto', 'message', 'ready', 12, '${OUTRA_FOTO}', now() - interval '3 hours'),
      ('${webinar}', 'manual', 'bia   velha', 'team', 'Sem foto', 'message', 'ready', 13, null, now() - interval '30 minutes');
    insert into public.webinar_chat_messages (webinar_id, session_id, offset_ms, display_name, role, source, body, kind, master, approved)
      values ('${webinar}', '${AO_VIVO.sessaoId}', 1000, 'Carla  M.', 'student', 'scripted', 'Enviado agora', 'message', false, true);
    ${secaoDoPreenchimento()}
    select coalesce(json_agg(json_build_object('nome', name, 'papel', role, 'foto', avatar_path) order by name_key), '[]'::json) from public.webinar_personas where webinar_id = '${webinar}';
    select coalesce(json_agg(json_build_object('nome', persona_name, 'papel', persona_role, 'foto', persona_avatar_path, 'ligado', persona_id is not null) order by position), '[]'::json)
      from public.webinar_chat_script_items where webinar_id = '${webinar}' and position in (10, 11, 12, 13);
    rollback;
  `);
  const [pessoas, itens] = saida.trim().split("\n").filter((linha) => linha.startsWith("[")).map((linha) => JSON.parse(linha));
  assert.deepEqual(pessoas, [
    { foto: FOTO, nome: "Adriano Souza", papel: "team" },
    { foto: OUTRA_FOTO, nome: "bia velha", papel: "team" },
    { foto: null, nome: "Carla M.", papel: "student" }
  ]);
  assert.deepEqual(itens, [
    { foto: FOTO, ligado: true, nome: "Adriano Souza", papel: "team" },
    { foto: FOTO, ligado: true, nome: "Adriano Souza", papel: "team" },
    { foto: OUTRA_FOTO, ligado: true, nome: "bia velha", papel: "team" },
    { foto: OUTRA_FOTO, ligado: true, nome: "bia velha", papel: "team" }
  ]);
});

test("4. D117 a lista da escola: o Duplicar nao copia a lista; a pessoa criada na copia vale na outra live; excluir a copia deixa a pessoa, com a origem nula", async () => {
  actAs(produtor);
  const personaStore = await import("../../src/server/webinars/persona-store.ts");
  ok(await personaActions.savePersona({ avatarPath: FOTO, name: "Lia Escola", role: "student", webinarId: AO_VIVO.id }));
  const copia = ok(await webinarActions.duplicateWebinar({ id: AO_VIVO.id }));
  const daCopia = unwrap(await db.from("webinar_personas").select("id").eq("webinar_id", copia.id), "As pessoas com a copia de origem");
  assert.deepEqual(daCopia, [], "nada copiado: a lista e uma so");
  assert.ok((await personaStore.listPersonas(db)).personas.some((pessoa) => pessoa.name === "Lia Escola"), "a copia ja enxerga a Lia");

  // A pessoa criada na copia vale no roteiro da live ao vivo (a lista e da escola).
  const nasceuNaCopia = ok(await personaActions.savePersona({ avatarPath: OUTRA_FOTO, name: "Nina Copia", role: "team", webinarId: copia.id })).persona;
  const base = { body: "Da outra live", kind: "message", offsetMs: null, phrase: null, phraseDelayMs: 0, status: "draft", triggerKind: "manual" };
  const salvo = ok(await scriptActions.saveScriptItems({ items: [{ ...base, personaId: nasceuNaCopia.id, personaName: "Nina Copia", personaRole: "team" }], loadedIds: [], webinarId: AO_VIVO.id }));
  const item = salvo.items.find((entry) => entry.body === "Da outra live");
  assert.deepEqual([item.personaId, item.personaAvatarPath], [nasceuNaCopia.id, OUTRA_FOTO]);

  // Excluir a copia (a origem da Nina): a Nina fica na lista, com a origem nula, e o item da live ao vivo continua ligado.
  unwrap(await db.from("webinars").delete().eq("id", copia.id), "Apagando a copia");
  const nina = unwrap(await db.from("webinar_personas").select("id, webinar_id").eq("id", nasceuNaCopia.id).maybeSingle(), "A Nina depois");
  assert.deepEqual(nina, { id: nasceuNaCopia.id, webinar_id: null });
  const ligado = unwrap(await db.from("webinar_chat_script_items").select("persona_id").eq("id", item.id).single(), "O item da Nina");
  assert.equal(ligado.persona_id, nasceuNaCopia.id);
  unwrap(await db.from("webinar_chat_script_items").delete().eq("id", item.id), "Limpando o item");
  unwrap(await db.from("webinar_personas").delete().in("name", ["Lia Escola", "Nina Copia"]), "Limpando as pessoas");
  actAs(null);
});

test("4b. a secao 2 da 202611180001 (numa transacao desfeita, sem o indice novo): as repetidas de webinarios diferentes viram uma, a mudada por ultimo, com a foto mais recente; os itens e as perguntas passam para ela, com a copia dela", () => {
  const [vivo, gravada] = [AO_VIVO.id, GRAVADA.id];
  const saida = sql(`
    begin;
    drop index public.webinar_personas_school_name_idx;
    delete from public.webinar_personas;
    insert into public.webinar_personas (id, webinar_id, name, role, avatar_path, created_at, updated_at) values
      ('10000000-0000-4000-8000-0000000000a1', '${vivo}', 'Rui Souza', 'student', '${FOTO}', now() - interval '5 days', now() - interval '5 days'),
      ('10000000-0000-4000-8000-0000000000a2', '${gravada}', 'rui  SOUZA', 'team', null, now() - interval '1 day', now() - interval '1 day'),
      ('10000000-0000-4000-8000-0000000000a3', '${gravada}', 'Tais Lima', 'student', null, now() - interval '2 days', now() - interval '2 days');
    insert into public.webinar_chat_script_items (webinar_id, trigger_kind, persona_id, persona_name, persona_role, body, kind, status, position, persona_avatar_path) values
      ('${vivo}', 'manual', '10000000-0000-4000-8000-0000000000a1', 'Rui Souza', 'student', 'Do vivo', 'message', 'ready', 20, '${FOTO}'),
      ('${gravada}', 'manual', '10000000-0000-4000-8000-0000000000a2', 'rui  SOUZA', 'team', 'Da gravada', 'message', 'ready', 21, null);
    ${secaoDaEscola()}
    select coalesce(json_agg(json_build_object('id', id, 'nome', name, 'papel', role, 'foto', avatar_path) order by name_key), '[]'::json) from public.webinar_personas;
    select coalesce(json_agg(json_build_object('corpo', body, 'pessoa', persona_id, 'nome', persona_name, 'papel', persona_role, 'foto', persona_avatar_path) order by position), '[]'::json)
      from public.webinar_chat_script_items where position in (20, 21);
    select count(*) from pg_indexes where schemaname = 'public' and indexname = 'webinar_personas_school_name_idx';
    rollback;
  `);
  const linhas = saida.trim().split("\n");
  const [pessoas, itens] = linhas.filter((linha) => linha.startsWith("[")).map((linha) => JSON.parse(linha));
  const RUI = "10000000-0000-4000-8000-0000000000a2";
  assert.deepEqual(pessoas, [
    { foto: FOTO, id: RUI, nome: "rui  SOUZA", papel: "team" },
    { foto: null, id: "10000000-0000-4000-8000-0000000000a3", nome: "Tais Lima", papel: "student" }
  ], "fica a mudada por ultimo, com a foto da outra");
  assert.deepEqual(itens, [
    { corpo: "Do vivo", foto: FOTO, nome: "rui  SOUZA", papel: "team", pessoa: RUI },
    { corpo: "Da gravada", foto: FOTO, nome: "rui  SOUZA", papel: "team", pessoa: RUI }
  ], "os itens das duas lives ligados a ela, com a copia dela");
  assert.equal(linhas.at(-1), "1", "o indice unico do nome de novo, criado pela secao");
});

test("5. a pergunta simulada na Live ao vivo: sem aluno, com o nome e a foto da pessoa na aba; a aluna vota e nao responde no fio; a equipe responde; nada conta no relatorio nem no CSV", async () => {
  actAs(produtor);
  const enviada = ok(await scriptActions.sendScriptedComment({ body: "Quanto tempo de acesso?", kind: "question", personaAvatarPath: FOTO, personaName: "Bia Pergunta", personaRole: "student", sessionId: AO_VIVO.sessaoId }));
  assert.equal(enviada.message, null);
  const linha = unwrap(await db.from("webinar_questions").select("user_id, source, persona_id, persona_role, persona_avatar_path, display_name").eq("id", enviada.question.id).single(), "A pergunta simulada");
  assert.deepEqual([linha.user_id, linha.source, linha.persona_id, linha.persona_role, linha.persona_avatar_path, linha.display_name], [null, "scripted", enviada.persona.id, "student", FOTO, "Bia Pergunta"]);

  // Os checks do banco: a simulada nunca com aluno, a da turma nunca sem aluno.
  const comAluno = await db.from("webinar_questions").insert({ body: "x", display_name: "X", offset_ms: 0, persona_role: "student", session_id: AO_VIVO.sessaoId, source: "scripted", user_id: contas.aluna.id });
  assert.equal(comAluno.error?.code, "23514");
  const semAluno = await db.from("webinar_questions").insert({ body: "x", display_name: "X", offset_ms: 0, session_id: AO_VIVO.sessaoId, user_id: null });
  assert.equal(semAluno.error?.code, "23514");

  const naAba = (await pedirPerguntas(aluna, AO_VIVO.id, AO_VIVO.sessaoId)).find((entry) => entry.id === enviada.question.id);
  assert.deepEqual([naAba.displayName, naAba.avatarUrl, naAba.mine, naAba.canReply], ["Bia Pergunta", `${supabaseUrl}/storage/v1/object/public/content-assets/${FOTO}`, false, false]);
  assert.equal("simulated" in naAba, false);

  actAs(aluna);
  const voto = await voteRoute.POST(new Request("http://localhost/x", { body: JSON.stringify({ sessionId: AO_VIVO.sessaoId }), headers: { "content-type": "application/json" }, method: "POST" }), { params: Promise.resolve({ id: AO_VIVO.id, qid: enviada.question.id }) });
  assert.equal(voto.status, 200, await voto.clone().text());
  assert.equal(unwrap(await db.from("webinar_questions").select("upvotes").eq("id", enviada.question.id).single(), "Os votos").upvotes, 1);

  actAs(produtor);
  ok(await roomActions.answerQuestion({ answerText: "Um ano de acesso.", questionId: enviada.question.id }));
  actAs(aluna);
  const resposta = await repliesRoute.POST(
    new Request("http://localhost/x", { body: JSON.stringify({ body: "Obrigada!", consent: true, consentVersion: 2, sessionId: AO_VIVO.sessaoId }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id: AO_VIVO.id, qid: enviada.question.id }) }
  );
  assert.equal(resposta.status, 403, "nenhum aluno e dono da simulada");
  actAs(produtor);
  ok(await roomActions.replyToQuestion({ body: "E o replay fica 7 dias.", questionId: enviada.question.id }));

  // Fora de toda metrica: o relatorio e o CSV Q&A.
  const relatorio = unwrap(await db.rpc("webinar_report", { p_session_id: AO_VIVO.sessaoId }), "O relatorio");
  assert.equal(relatorio.filter((row) => row.metric === "question" || row.metric === "top_question").length, 0, "nenhuma pergunta da turma");
  const painel = unwrap(await db.rpc("webinar_panel", { p_end: new Date(Date.now() + 60_000).toISOString(), p_kind: "live", p_session_ids: [AO_VIVO.sessaoId], p_start: new Date(Date.now() - 86_400_000).toISOString() }), "O painel");
  assert.equal(painel.filter((row) => row.metric === "question").length, 0);
  const csv = await loadSessionExport(db, { report: "qa", sessionId: AO_VIVO.sessaoId, webinarId: AO_VIVO.id });
  assert.ok(csv, "o CSV Q&A");
  assert.doesNotMatch(csv.csv, /Quanto tempo de acesso/);
  actAs(null);
});

test("6. o item Pergunta da Live gravada: a abertura da sessao abre a pergunta ligada a mensagem, com a hora dela; a aba so mostra a que ja chegou a hora", async () => {
  const [agora, depois] = unwrap(
    await db
      .from("webinar_chat_script_items")
      .insert([
        { body: "Tem certificado?", kind: "question", offset_ms: 0, persona_avatar_path: FOTO, persona_name: "Duda Gravada", persona_role: "student", position: 0, status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id },
        { body: "E bonus?", kind: "question", offset_ms: 30 * 60_000, persona_name: "Duda Gravada", persona_role: "student", position: 1, status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id }
      ])
      .select("id"),
    "Os itens Pergunta da gravada"
  );
  const aberta = unwrap(await db.rpc("webinar_open_session", { p_now: new Date().toISOString(), p_session_id: GRAVADA.sessaoId }), "Abrindo a sessao gravada");
  assert.equal(aberta.fired, 2);
  const mensagens = unwrap(await db.from("webinar_chat_messages").select("id, script_item_id, created_at, kind").eq("session_id", GRAVADA.sessaoId).eq("source", "scripted"), "As mensagens do roteiro");
  const perguntas = unwrap(await db.from("webinar_questions").select("message_id, created_at, source, user_id, persona_avatar_path, body").eq("session_id", GRAVADA.sessaoId), "As perguntas abertas");
  assert.equal(perguntas.length, 2);
  for (const pergunta of perguntas) {
    const mensagem = mensagens.find((row) => row.id === pergunta.message_id);
    assert.ok(mensagem, "ligada a mensagem do item");
    assert.equal(Date.parse(pergunta.created_at), Date.parse(mensagem.created_at), "a hora da mensagem");
    assert.deepEqual([pergunta.source, pergunta.user_id, mensagem.kind], ["scripted", null, "question"]);
  }
  assert.ok(mensagens.some((row) => row.script_item_id === agora.id) && mensagens.some((row) => row.script_item_id === depois.id));
  const naAba = await pedirPerguntas(aluna, GRAVADA.id, GRAVADA.sessaoId);
  assert.deepEqual(naAba.map((entry) => entry.body), ["Tem certificado?"], "a dos 30 minutos ainda nao chegou a hora");

  // O Atendimento da equipe (revisao v8, achado 2): pelo filtro de verdade do PostgREST, a dos 30 minutos tambem fica
  // fora da fila, nao e distribuida e nao entra na conta de abertas do modo hibrido.
  actAs(produtor);
  unwrap(await db.from("webinar_attendants").upsert({ last_seen_at: new Date().toISOString(), session_id: GRAVADA.sessaoId, status: "online", user_id: contas.produtor.id }, { onConflict: "session_id,user_id" }), "O produtor atendendo");
  const retrato = ok(await assistantActions.loadAttendanceSnapshot({ sessionId: GRAVADA.sessaoId }));
  assert.deepEqual(retrato.queue.filter((item) => item.target === "question").map((item) => item.body), ["Tem certificado?"]);
  const futura = unwrap(await db.from("webinar_questions").select("assigned_to").eq("session_id", GRAVADA.sessaoId).eq("body", "E bonus?").single(), "A dos 30 minutos");
  assert.equal(futura.assigned_to, null, "o distribute nao atribui o que a sala ainda nao perguntou");
  unwrap(await db.from("webinar_questions").update({ assigned_to: contas.produtor.id }).eq("session_id", GRAVADA.sessaoId).eq("body", "E bonus?"), "Dando a do futuro a mao");
  const abertas = await assistantQueries.listAssignedOpenQuestions(db, GRAVADA.sessaoId);
  assert.equal(abertas.length, 1, "so a que ja apareceu conta");
  unwrap(await db.from("webinar_attendants").delete().eq("session_id", GRAVADA.sessaoId), "Saindo do atendimento");
  actAs(null);
});

test("7. abrir de novo nao repete a pergunta (o indice unico por mensagem); o Soltar agora de um item Pergunta na live abre a pergunta uma vez", async () => {
  unwrap(await db.from("webinar_sessions").update({ script_fired_at: null }).eq("id", GRAVADA.sessaoId), "Forcando a abertura de novo");
  unwrap(await db.rpc("webinar_open_session", { p_now: new Date().toISOString(), p_session_id: GRAVADA.sessaoId }), "Abrindo de novo");
  assert.equal(unwrap(await db.from("webinar_questions").select("id").eq("session_id", GRAVADA.sessaoId), "As perguntas").length, 2, "nenhuma a mais");

  actAs(produtor);
  const guardado = ok(await scriptActions.saveScriptComment({ body: "E o suporte?", kind: "question", personaName: `Lia ${randomUUID().slice(0, 4)}`, personaRole: "student", sessionId: AO_VIVO.sessaoId }));
  const solta = ok(await scriptActions.fireScriptItem({ itemId: guardado.item.id, sessionId: AO_VIVO.sessaoId }));
  assert.equal(unwrap(await db.from("webinar_questions").select("id").eq("message_id", solta.message.id), "A pergunta do item").length, 1);
  assert.equal((await scriptActions.fireScriptItem({ itemId: guardado.item.id, sessionId: AO_VIVO.sessaoId })).status, 409);
  assert.equal(unwrap(await db.from("webinar_questions").select("id").eq("message_id", solta.message.id), "A pergunta do item").length, 1);
  actAs(null);
});

test("8. importar o CSV (revisao v8, achado 3): cada linha ligada a pessoa do mesmo nome, as que faltam criadas; duas importacoes ao mesmo tempo deixam uma pessoa so por nome", async () => {
  actAs(produtor);
  const sufixo = randomUUID().slice(0, 6);
  const csv = ["Tempo;Nome;Papel;Mensagem", `12;Gil ${sufixo};Equipe;Oi ${sufixo}`, `13;gil  ${sufixo.toUpperCase()};Aluno;De novo ${sufixo}`, `14;Rafa ${sufixo};Aluno;Ola ${sufixo}`].join("\n");
  // O indice unico do nome de verdade (na escola, 202611180001): as duas leem a lista sem o Gil e o Rafa e gravam ao
  // mesmo tempo.
  const [um, dois] = await Promise.all([scriptActions.importScriptCsv({ csv, webinarId: AO_VIVO.id }), scriptActions.importScriptCsv({ csv, webinarId: AO_VIVO.id })]);
  ok(um);
  ok(dois);
  const pessoas = unwrap(
    await db.from("webinar_personas").select("id, name, role, avatar_path").eq("webinar_id", AO_VIVO.id).in("name_key", [`gil ${sufixo}`, `rafa ${sufixo}`]),
    "As pessoas novas"
  );
  assert.equal(pessoas.length, 2, "uma pessoa por nome");
  const gil = pessoas.find((pessoa) => pessoa.name.toLowerCase().startsWith("gil"));
  assert.deepEqual([gil.role, gil.avatar_path], ["team", null], "o papel da primeira linha, sem foto");
  const itens = unwrap(
    await db.from("webinar_chat_script_items").select("id, persona_id, persona_name, persona_role").eq("webinar_id", AO_VIVO.id).in("body", [`Oi ${sufixo}`, `De novo ${sufixo}`, `Ola ${sufixo}`]),
    "Os itens importados"
  );
  assert.equal(itens.length, 6, "as duas importacoes acrescentaram as tres linhas");
  for (const item of itens) {
    const dona = pessoas.find((pessoa) => pessoa.id === item.persona_id);
    assert.ok(dona, "todo item ligado a uma das duas pessoas");
    assert.deepEqual([item.persona_name, item.persona_role], [dona.name, dona.role], "com a copia dela");
  }
  unwrap(await db.from("webinar_chat_script_items").delete().in("id", itens.map((item) => item.id)), "Limpando os itens");
  unwrap(await db.from("webinar_personas").delete().in("id", pessoas.map((pessoa) => pessoa.id)), "Limpando as pessoas");
  actAs(null);
});

test("9. a lista com mais de 1.000 pessoas (revisao v8, achado 4): listPersonas le a lista da escola inteira pelo teto de 1.000 do PostgREST", async () => {
  const personaStore = await import("../../src/server/webinars/persona-store.ts");
  const linhas = Array.from({ length: 1005 }, (_, index) => ({ name: `Pessoa ${String(index).padStart(4, "0")}`, role: "student", webinar_id: GRAVADA.id }));
  unwrap(await db.from("webinar_personas").insert(linhas), "As 1.005 pessoas");
  const lista = await personaStore.listPersonas(db);
  assert.equal(lista.personas.filter((pessoa) => pessoa.name.startsWith("Pessoa ")).length, 1005);
  assert.equal(new Set(lista.personas.map((pessoa) => pessoa.id)).size, lista.personas.length, "nenhuma repetida entre as paginas");
  unwrap(await db.from("webinar_personas").delete().eq("webinar_id", GRAVADA.id).like("name", "Pessoa %"), "Limpando as pessoas");
});
