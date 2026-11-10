import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  LIVE_GRAVADA_NO_AR_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoDeTeste,
  seedLiveGravadaDeTeste,
  SENHA_DE_TESTE
} from "../fixtures/escola-de-teste.mjs";

// A "Na tela" e o banco do adendo (especificacao de 10/11/2026, §4; adendo R7 a R9) contra o banco LOCAL de verdade, com
// a migracao 202611100002 aplicada. Esta e a parte do banco (a primeira fatia); os caminhos do app (salvar, mostrar, a
// consulta do chat com o carimbo, as metricas pela rota) entram neste mesmo arquivo nas fatias seguintes.
// - o aluno logado nao le as duas tabelas nem roda a funcao do relatorio (so o service_role);
// - os checks do item (o QR Code com link de ate 240 caracteres, o banner com imagem ou titulo, o botao com link, a
//   imagem so da nossa pasta e com as medidas, "No meio" sem fechar nunca Grande) e o gatilho do updated_at;
// - o indice unico parcial segura uma exibicao ativa de cada tipo por sessao; a que saiu libera o lugar;
// - webinar_screen_report conta por exibicao alunos distintos (viram, clicaram, fecharam) e o total de cliques, sem a
//   equipe;
// - R7: a sessao `live` aceita as regras simuladas e o resumo, nunca o selo "Ao vivo" da gravada;
// - R9: a foto do personagem so com o caminho da pasta webinars/personas, e na mensagem so na scripted;
//   webinar_open_session copia a foto do item para a mensagem da gravada e nao solta o roteiro da live ao abrir.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const GRAVADA = LIVE_GRAVADA_NO_AR_DE_TESTE;
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const IMAGEM = "webinars/screen/0123456789abcdef01234567.webp";
const FOTO = "webinars/personas/89abcdef0123456789abcdef.webp";
const pessoas = [contas.aluna.id, contas.alunoSemAcesso.id, contas.produtor.id];

/** O erro do insert (ou null quando entrou), para conferir o codigo do check. */
async function codigoDoInsert(table, row) {
  const { error } = await db.from(table).insert(row).select("id").maybeSingle();
  return error?.code ?? null;
}

const banner = (extra = {}) => ({ kind: "banner", link_url: "https://bunker707.com.br/turma", name: "Turma nova", title: "Turma nova", webinar_id: GRAVADA.id, ...extra });
const qr = (extra = {}) => ({ kind: "qr", link_url: "https://bunker707.com.br/turma", name: "Inscrição", webinar_id: GRAVADA.id, ...extra });

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar").like("event_type", "webinar_screen_%"), "Apagando as metricas de teste da Na tela");
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: -60_000 });
  await seedLiveAoVivoDeTeste(db, { status: "waiting" });
});

after(async () => {
  await limparRastros();
  await limparWebinarios(db);
});

test("1. o aluno logado nao le webinar_screen_items nem webinar_screen_displays e nao roda webinar_screen_report (so o service_role)", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");
  for (const table of ["webinar_screen_items", "webinar_screen_displays"]) {
    const negado = await cliente.from(table).select("id").limit(1);
    assert.equal(negado.error?.code, "42501", `${table}: ${JSON.stringify(negado.error)}`);
  }
  const relatorio = await cliente.rpc("webinar_screen_report", { p_session_id: GRAVADA.sessaoId });
  assert.equal(relatorio.error?.code, "42501", JSON.stringify(relatorio.error));
  await cliente.auth.signOut();
});

test("2. os checks do item pronto: o QR Code com link https de ate 240, o banner com imagem ou titulo e botao com link, a imagem da nossa pasta, o meio; o gatilho move o updated_at", async () => {
  const base = "https://bunker707.com.br/";
  assert.equal(await codigoDoInsert("webinar_screen_items", banner()), null);
  assert.equal(await codigoDoInsert("webinar_screen_items", qr({ link_url: base + "a".repeat(240 - base.length), title: "Aponte a câmera" })), null);
  assert.equal(await codigoDoInsert("webinar_screen_items", banner({ image_alt: "Foguete", image_height: 360, image_path: IMAGEM, image_width: 640, title: null })), null, "so a imagem, com a descricao");

  for (const [rotulo, row] of [
    ["QR Code com link de 241", qr({ link_url: base + "a".repeat(241 - base.length) })],
    ["QR Code sem link", qr({ link_url: null })],
    ["QR Code com texto", qr({ body: "texto" })],
    ["link http", banner({ link_url: "http://bunker707.com.br" })],
    ["link com espaco", banner({ link_url: "https://bunker707.com.br/a b" })],
    ["banner sem imagem nem titulo", banner({ title: null })],
    ["botao sem link", banner({ button_label: "Quero", link_url: null })],
    ["imagem de outra pasta", banner({ image_height: 360, image_path: "communications/images/0123456789abcdef01234567.webp", image_width: 640 })],
    ["imagem sem as medidas", banner({ image_path: IMAGEM })],
    ["imagem sem titulo nem descricao", banner({ image_height: 360, image_path: IMAGEM, image_width: 640, title: null })],
    ["imagem grande demais", banner({ image_height: 360, image_path: IMAGEM, image_width: 1281 })],
    ["no meio, sem fechar e Grande", banner({ closable: false, place: "center", size: "l" })],
    ["posicao desconhecida", banner({ place: "rodape" })],
    ["titulo de 81", banner({ title: "t".repeat(81) })]
  ]) {
    assert.equal(await codigoDoInsert("webinar_screen_items", row), "23514", rotulo);
  }
  assert.equal(await codigoDoInsert("webinar_screen_items", banner({ closable: false, place: "center", size: "m" })), null, "no meio sem fechar, Medio passa");

  const criado = unwrap(await db.from("webinar_screen_items").insert(banner({ name: "Para o gatilho" })).select("id, updated_at").single(), "Gravando o item do gatilho");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const editado = unwrap(await db.from("webinar_screen_items").update({ title: "Turma de dezembro" }).eq("id", criado.id).select("updated_at").single(), "Editando o item");
  assert.ok(Date.parse(editado.updated_at) > Date.parse(criado.updated_at), "o gatilho move o updated_at");
});

test("3. uma exibicao ativa de cada tipo por sessao: o segundo banner esbarra no indice unico; banner, QR Code e enquete juntos passam; a que saiu libera o lugar", async () => {
  const item = unwrap(await db.from("webinar_screen_items").insert(banner({ name: "Exibicao" })).select("id").single(), "Gravando o item");
  const enquete = unwrap(
    await db.from("webinar_polls").insert({ kind: "single", question: "Qual curso?", session_id: GRAVADA.sessaoId, status: "open", webinar_id: GRAVADA.id }).select("id").single(),
    "Gravando a enquete"
  );
  const mostrar = (kind, extra = {}) => ({ item_id: kind === "poll" ? null : item.id, kind, poll_id: kind === "poll" ? enquete.id : null, session_id: GRAVADA.sessaoId, snapshot: { name: "x", v: 1 }, ...extra });

  const primeiro = unwrap(await db.from("webinar_screen_displays").insert(mostrar("banner")).select("id").single(), "Mostrando o banner");
  assert.equal(await codigoDoInsert("webinar_screen_displays", mostrar("banner")), "23505", "o segundo banner ativo na mesma sessao");
  assert.equal(await codigoDoInsert("webinar_screen_displays", mostrar("qr")), null);
  assert.equal(await codigoDoInsert("webinar_screen_displays", mostrar("poll")), null);
  assert.equal(await codigoDoInsert("webinar_screen_displays", mostrar("banner", { session_id: AO_VIVO.sessaoId })), null, "outra sessao tem o proprio lugar");

  for (const [rotulo, row] of [
    ["enquete sem a enquete", mostrar("poll", { poll_id: null })],
    ["banner com enquete", mostrar("banner", { hidden_at: new Date().toISOString(), hidden_reason: "team", poll_id: enquete.id })],
    ["saiu sem motivo", mostrar("banner", { hidden_at: new Date().toISOString() })],
    ["motivo sem sair", mostrar("qr", { hidden_reason: "team", session_id: AO_VIVO.sessaoId })],
    ["copia que nao e objeto", mostrar("banner", { hidden_at: new Date().toISOString(), hidden_reason: "team", snapshot: [1, 2] })],
    ["motivo desconhecido", mostrar("banner", { hidden_at: new Date().toISOString(), hidden_reason: "tempo" })]
  ]) {
    assert.equal(await codigoDoInsert("webinar_screen_displays", row), "23514", rotulo);
  }

  unwrap(await db.from("webinar_screen_displays").update({ hidden_at: new Date().toISOString(), hidden_reason: "replaced" }).eq("id", primeiro.id), "Tirando o primeiro banner");
  assert.equal(await codigoDoInsert("webinar_screen_displays", mostrar("banner")), null, "o lugar ficou livre");
  const ativos = unwrap(await db.from("webinar_screen_displays").select("kind").eq("session_id", GRAVADA.sessaoId).is("hidden_at", null), "Lendo as ativas");
  assert.deepEqual(ativos.map((row) => row.kind).sort(), ["banner", "poll", "qr"]);
});

test("4. webinar_screen_report: por exibicao, alunos distintos que viram, clicaram e fecharam e o total de cliques, sem a equipe", async () => {
  const exibicao = randomUUID();
  const outra = randomUUID();
  const evento = (user, tipo, displayId = exibicao) => ({ entity_id: GRAVADA.sessaoId, entity_type: "webinar", event_type: tipo, metadata: { display_id: displayId, form: "stage" }, user_id: user });
  unwrap(
    await db.from("student_events").insert([
      evento(contas.aluna.id, "webinar_screen_shown"),
      evento(contas.aluna.id, "webinar_screen_shown"),
      evento(contas.aluna.id, "webinar_screen_closed"),
      evento(contas.alunoSemAcesso.id, "webinar_screen_shown"),
      evento(contas.alunoSemAcesso.id, "webinar_screen_clicked"),
      evento(contas.alunoSemAcesso.id, "webinar_screen_clicked"),
      // A equipe nunca conta.
      evento(contas.produtor.id, "webinar_screen_shown"),
      evento(contas.produtor.id, "webinar_screen_clicked"),
      evento(contas.aluna.id, "webinar_screen_shown", outra),
      // Outro registro do webinario nao entra.
      { entity_id: GRAVADA.sessaoId, entity_type: "webinar", event_type: "webinar_offer_clicked", metadata: { display_id: exibicao }, user_id: contas.aluna.id }
    ]),
    "Gravando as metricas de teste"
  );
  const linhas = unwrap(await db.rpc("webinar_screen_report", { p_session_id: GRAVADA.sessaoId }), "Lendo o relatorio da Na tela");
  const porExibicao = Object.fromEntries(linhas.map((row) => [row.display_id, [Number(row.shown), Number(row.clickers), Number(row.clicks), Number(row.closed)]]));
  assert.deepEqual(porExibicao, { [exibicao]: [2, 1, 2, 1], [outra]: [1, 0, 0, 0] });
  assert.deepEqual(unwrap(await db.rpc("webinar_screen_report", { p_session_id: AO_VIVO.sessaoId }), "Outra sessao"), []);
});

test("5. R7: a sessao live aceita o contador, as entradas, os avisos de venda simulados e o resumo; o selo Ao vivo da gravada, nunca", async () => {
  const regras = {
    simulated_count_rule: { base: 300, jitter: 0, mode: "fixed", peak: 300 },
    simulated_joins: { enabled: true, every_seconds: 30, max: 5, names: "generic" },
    simulated_sale_notices: { enabled: false },
    simulation_summary: { counter_max: 312, joins_shown: 4, sale_notices_shown: 0 }
  };
  const live = await db.from("webinar_sessions").update(regras).eq("id", AO_VIVO.sessaoId).select("kind, simulated_count_rule").single();
  assert.equal(live.error, null, JSON.stringify(live.error));
  assert.deepEqual([live.data.kind, live.data.simulated_count_rule.base], ["live", 300]);
  const selo = await db.from("webinar_sessions").update({ show_live_badge: true }).eq("id", AO_VIVO.sessaoId);
  assert.equal(selo.error?.code, "23514", "o selo da gravada nunca na live");
  const gravada = await db.from("webinar_sessions").update({ show_live_badge: true, simulated_count_rule: regras.simulated_count_rule }).eq("id", GRAVADA.sessaoId);
  assert.equal(gravada.error, null, "a gravada continua com as duas coisas");
  unwrap(await db.from("webinar_sessions").update({ simulated_count_rule: null, simulated_joins: null, simulated_sale_notices: null, simulation_summary: null }).eq("id", AO_VIVO.sessaoId), "Limpando as regras da live");
});

test("6. R9: a foto do personagem so com o caminho de webinars/personas, no item e na mensagem scripted (nunca em outra mensagem)", async () => {
  const item = (extra = {}) => ({ body: "Que aula boa!", offset_ms: 60_000, persona_name: "Bia C.", persona_role: "student", status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id, ...extra });
  assert.equal(await codigoDoInsert("webinar_chat_script_items", item({ persona_avatar_path: FOTO })), null);
  assert.equal(await codigoDoInsert("webinar_chat_script_items", item({ persona_avatar_path: null })), null);
  for (const caminho of [IMAGEM, "webinars/personas/89ABCDEF0123456789ABCDEF.webp", "https://golpe.com/foto.webp", "webinars/personas/x.webp"]) {
    assert.equal(await codigoDoInsert("webinar_chat_script_items", item({ persona_avatar_path: caminho })), "23514", caminho);
  }
  const mensagem = (extra = {}) => ({ body: "oi", display_name: "Bia C.", offset_ms: 1000, role: "student", session_id: GRAVADA.sessaoId, source: "scripted", webinar_id: GRAVADA.id, ...extra });
  assert.equal(await codigoDoInsert("webinar_chat_messages", mensagem({ persona_avatar_path: FOTO })), null);
  assert.equal(await codigoDoInsert("webinar_chat_messages", mensagem({ persona_avatar_path: FOTO, source: "audience" })), "23514", "so a scripted");
  assert.equal(await codigoDoInsert("webinar_chat_messages", mensagem({ persona_avatar_path: FOTO, role: "team", source: "team" })), "23514");
  assert.equal(await codigoDoInsert("webinar_chat_messages", mensagem({ persona_avatar_path: "avatars/u/foto.webp" })), "23514");
});

test("7. webinar_open_session: a gravada solta o roteiro com a foto do personagem; a live nao solta o roteiro ao abrir (o tick solta)", async () => {
  unwrap(await db.from("webinar_chat_script_items").delete().in("webinar_id", [GRAVADA.id, AO_VIVO.id]), "Zerando os roteiros de teste");
  const [comFoto, semFoto] = unwrap(
    await db
      .from("webinar_chat_script_items")
      .insert([
        { body: "Cheguei!", offset_ms: 30_000, persona_avatar_path: FOTO, persona_name: "Bia C.", persona_role: "student", position: 0, status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id },
        { body: "Boa noite", offset_ms: 45_000, persona_name: "Caio D.", persona_role: "student", position: 1, status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id }
      ])
      .select("id, position"),
    "Gravando o roteiro da gravada"
  ).sort((a, b) => a.position - b.position);
  unwrap(await db.from("webinar_sessions").update({ script_fired_at: null, status: "scheduled" }).eq("id", GRAVADA.sessaoId), "Voltando a gravada para marcada");
  const aberta = unwrap(await db.rpc("webinar_open_session", { p_now: new Date().toISOString(), p_session_id: GRAVADA.sessaoId }), "Abrindo a gravada");
  assert.equal(aberta.fired, 2);
  const soltas = unwrap(await db.from("webinar_chat_messages").select("script_item_id, persona_avatar_path, display_name, source").eq("session_id", GRAVADA.sessaoId).not("script_item_id", "is", null), "Lendo o roteiro solto");
  assert.deepEqual(
    Object.fromEntries(soltas.map((row) => [row.script_item_id, [row.display_name, row.source, row.persona_avatar_path]])),
    { [comFoto.id]: ["Bia C.", "scripted", FOTO], [semFoto.id]: ["Caio D.", "scripted", null] }
  );

  unwrap(
    await db.from("webinar_chat_script_items").insert({ body: "Oi, gente!", offset_ms: 10_000, persona_avatar_path: FOTO, persona_name: "Duda E.", persona_role: "student", status: "ready", trigger_kind: "at_offset", webinar_id: AO_VIVO.id }),
    "Gravando o roteiro da live"
  );
  const live = unwrap(await db.rpc("webinar_open_session", { p_now: new Date().toISOString(), p_session_id: AO_VIVO.sessaoId }), "Comecar para todos na live");
  assert.deepEqual([live.status, live.fired, live.changed], ["live", 0, true]);
  const nada = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", AO_VIVO.sessaoId).not("script_item_id", "is", null), "Lendo o roteiro da live");
  assert.equal(nada.length, 0, "nenhum item da live entra ao abrir");
  const sessao = unwrap(await db.from("webinar_sessions").select("status, started_at").eq("id", AO_VIVO.sessaoId).single(), "Lendo a live");
  assert.equal(sessao.status, "live");
  assert.ok(sessao.started_at, "o Comecar para todos continua marcando o started_at");
});
