import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  LIVE_GRAVADA_DE_TESTE,
  LIVE_GRAVADA_NO_AR_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoDeTeste,
  seedLiveGravadaDeTeste,
  seedLiveGravadaEncerradaDeTeste,
  SENHA_DE_TESTE,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// A "Na tela" e o banco do adendo (especificacao de 10/11/2026, §4; adendo R7 a R9) contra o banco LOCAL de verdade, com
// a migracao 202611100002 aplicada. Primeiro a parte do banco e a consulta do chat com o carimbo (fatia S1); depois os
// outros caminhos do app (as acoes, a imagem, as metricas pela rota e a moderacao na gravada; fatia S12).
// - o aluno logado nao le as duas tabelas nem roda a funcao do relatorio (so o service_role);
// - os checks do item (o QR Code com link de ate 240 caracteres, o banner com imagem ou titulo, o botao com link, a
//   imagem so da nossa pasta e com as medidas, "No meio" sem fechar nunca Grande) e o gatilho do updated_at;
// - o indice unico parcial segura uma exibicao ativa de cada tipo por sessao; a que saiu libera o lugar;
// - webinar_screen_report conta por exibicao alunos distintos (viram, clicaram, fecharam) e o total de cliques, sem a
//   equipe;
// - R7: a sessao `live` aceita as regras simuladas e o resumo, nunca o selo "Ao vivo" da gravada;
// - R9: a foto do personagem so com o caminho da pasta webinars/personas, e na mensagem so na scripted;
//   webinar_open_session copia a foto do item para a mensagem da gravada e nao solta o roteiro da live ao abrir;
// - a consulta de 5 s do chat com o carimbo (`tela`, o updated_at da sessao como o PostgREST devolve): o carimbo velho
//   traz o banner numa chamada, com a imagem pela origem do Supabase local; o mesmo carimbo, nada; tirar da tela e
//   atualizar a sessao (store.touchSessionRow) traz o estado sem o banner; GET .../session leva o mesmo estado.
// Os caminhos do app pelas Server Actions e pelas rotas (fatia S12, especificacao §9), na Live gravada no ar:
// - salvar o banner e o QR Code prontos (o analista recebe 403), mostrar, a consulta do chat com o carimbo velho traz
//   os dois numa chamada; o mesmo item de novo nao grava nada; editar o item na tela mantem a copia congelada ate o
//   Mostrar de novo; outro banner troca o atual (`replaced`) e o QR Code fica; dois Mostrar juntos passam pelo indice
//   unico (a segunda tentativa) e deixam um banner so; tirar da tela; excluir recusado (409) enquanto esta na tela;
//   Replay e sessao encerrada 409;
// - a imagem conferida no bucket de verdade: Enviar imagem grava em content-assets/webinars/screen e devolve as
//   medidas lidas dos bytes; salvar com um caminho que nao existe e recusado no campo; o endereco pela nossa origem;
// - Fixar ao enviar (uma fixada so, o link da equipe ligado; a da aluna fixada continua sem link), Desafixar; o Fixar
//   recusado na sessao encerrada;
// - a enquete fixada: Abrir e fixar, outra no lugar (`replaced`), Encerrar sem compartilhar desafixa (`poll_closed`) e
//   com compartilhar mantem, o Fixar recusado na encerrada sem resultado, Desafixar; a aluna responde a fixada;
// - POST .../screen-events grava viu, clicou e fechou em student_events (o id de outra sessao sai em silencio) e
//   webinar_screen_report conta sem a equipe; o retrato do console traz os mesmos numeros; Replay 404, 401 sem sessao;
// - a moderacao na Live gravada pelas acoes: silenciada recebe 409 muted no chat e na pergunta (e ainda reage),
//   removida e recusada na entrada (a sessao com join kicked e sem video; a pagina da sala recusa), o Desfazer
//   devolve tudo; a equipe nunca e alvo; no Replay, 409; o retrato do console lista os barrados.
// - R7 pelo app: o produtor decide a Simulacao da live na espera (saveSessionSimulation com a frase da live; o selo
//   recusado), a aluna recebe a janela pela rota depois do Comecar para todos e o console ve "+300" separado.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const GRAVADA = LIVE_GRAVADA_NO_AR_DE_TESTE;
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const ENCERRADA = LIVE_GRAVADA_DE_TESTE;
const IMAGEM = "webinars/screen/0123456789abcdef01234567.webp";
const FOTO = "webinars/personas/89abcdef0123456789abcdef.webp";
const pessoas = [contas.aluna.id, contas.alunoSemAcesso.id, contas.produtor.id];
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const { touchSessionRow } = await import("../../src/server/webinars/store.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");

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

/** As imagens que o teste enviou ao bucket de verdade (apagadas no fim). */
const imagensEnviadas = new Set();

after(async () => {
  actAs(null);
  await limparRastros();
  await limparWebinarios(db);
  if (imagensEnviadas.size > 0) {
    unwrap(await db.storage.from("content-assets").remove([...imagensEnviadas]), "Apagando as imagens de teste da Na tela");
  }
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

test("8. a consulta de 5 s do chat com o carimbo: o velho traz o banner numa chamada, o mesmo nada; tirar da tela e mudar o carimbo traz o estado sem ele", async () => {
  resetRoomLimits();
  unwrap(await db.from("webinar_screen_displays").delete().eq("session_id", GRAVADA.sessaoId), "Zerando as exibicoes da gravada");
  const snapshot = { body: "Vagas até sexta.", buttonLabel: "Quero entrar", closable: true, image: { alt: "Foguete", height: 360, path: IMAGEM, width: 640 }, linkUrl: "https://bunker707.com.br/turma", name: "Turma", place: "bottom_right", size: "m", title: "Turma nova", v: 1 };
  const mostrada = unwrap(await db.from("webinar_screen_displays").insert({ kind: "banner", session_id: GRAVADA.sessaoId, snapshot }).select("id").single(), "Mostrando o banner");
  // O dado antes, o carimbo depois.
  await touchSessionRow(db, GRAVADA.sessaoId);
  const contexto = { params: Promise.resolve({ id: GRAVADA.id }) };
  const consultar = async (tela) => {
    actAs(usuarioDeTeste(contas.aluna));
    const query = new URLSearchParams({ sessao: GRAVADA.sessaoId, since: new Date(Date.now() - 5000).toISOString(), ...(tela === undefined ? {} : { tela }) });
    const resposta = await chatRoute.GET(new Request(`http://localhost/api/webinars/${GRAVADA.id}/chat?${query}`), contexto);
    const body = await resposta.json();
    assert.equal(resposta.status, 200, JSON.stringify(body));
    return body.data.screen;
  };

  const estado = await consultar("2026-01-01T00:00:00+00:00");
  const linha = unwrap(await db.from("webinar_sessions").select("updated_at").eq("id", GRAVADA.sessaoId).single(), "Lendo o carimbo");
  assert.equal(estado.stamp, linha.updated_at, "o carimbo e o updated_at como o PostgREST devolve");
  assert.ok(estado.stamp.length <= 40, "cabe no tela (40 caracteres)");
  assert.deepEqual(estado.items.map((item) => [item.displayId, item.kind, item.title]), [[mostrada.id, "banner", "Turma nova"]]);
  assert.equal(estado.items[0].image.url, `${supabaseUrl}/storage/v1/object/public/content-assets/${IMAGEM}`, "pela origem do nosso Supabase");
  assert.equal(await consultar(estado.stamp), null, "o mesmo carimbo: nada");
  assert.equal(await consultar(), null, "sem tela: nada");

  const sessao = await sessionRoute.GET(new Request(`http://localhost/api/webinars/${GRAVADA.id}/session?sessao=${GRAVADA.sessaoId}`), contexto);
  const corpo = await sessao.json();
  assert.equal(sessao.status, 200, JSON.stringify(corpo));
  assert.deepEqual(corpo.data.screen, estado, "GET session leva o mesmo estado");

  unwrap(await db.from("webinar_screen_displays").update({ hidden_at: new Date().toISOString(), hidden_reason: "team" }).eq("id", mostrada.id), "Tirando da tela");
  await touchSessionRow(db, GRAVADA.sessaoId);
  const depois = await consultar(estado.stamp);
  assert.notEqual(depois.stamp, estado.stamp, "o carimbo mudou");
  assert.deepEqual(depois.items, [], "o banner saiu");
});

/* ------------------------------------------------------------------------------------------------
 * Os caminhos do app pelas Server Actions e pelas rotas (fatia S12)
 * ---------------------------------------------------------------------------------------------- */

/**
 * As Server Actions como uma conta da equipe (o produtor, por padrao): cada chamada entra como ela antes (a sessao do
 * teste e uma so, e as rotas da sala entram como o aluno no meio).
 */
function comoEquipe(module, user = produtor) {
  return new Proxy(module, {
    get(target, name) {
      const action = target[name];
      return typeof action === "function" ? (...args) => (actAs(user), action(...args)) : action;
    }
  });
}

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const acoesDaTela = await import("../../src/server/webinars/screen-actions.ts");
const acoesDaSala = await import("../../src/server/webinars/room-actions.ts");
const acoesDaLive = await import("../../src/server/webinars/live-actions.ts");
const screenActions = comoEquipe(acoesDaTela);
const roomActions = comoEquipe(acoesDaSala);
const liveActions = comoEquipe(acoesDaLive);
const screenEventsRoute = await import("../../src/app/api/webinars/[id]/screen-events/route.ts");
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const reactionsRoute = await import("../../src/app/api/webinars/[id]/reactions/route.ts");
const pollsRoute = await import("../../src/app/api/webinars/[id]/polls/route.ts");
const consoleRoute = await import("../../src/app/api/admin/webinars/[id]/console/route.ts");
const { clearScreenDisplayIdsCache, clearScreenStateCache, clearScreenStatsCache } = await import("../../src/server/webinars/screen-queries.ts");
const { getRoomPageData } = await import("../../src/server/webinars/student-queries.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../../src/lib/webinar-copy.ts");

const ERROS = WEBINAR_COPY.naTela.erros;
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
/** O Replay da Live gravada encerrada (um id da faixa 0009xx, so desta rodada). */
const REPLAY = "bbbbbbbb-0000-4000-8000-000000000951";
const LINK = "https://bunker707.com.br/turma";
const CAPA = readFileSync(new URL("../fixtures/popup-livre/capa-de-teste.webp", import.meta.url));
const LARGA = readFileSync(new URL("../fixtures/popup-livre/imagem-larga.webp", import.meta.url));

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

function falhou(result, status) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, status, JSON.stringify(result));
  return result;
}

const json = async (response) => ({ body: await response.json(), status: response.status });
const contextoDe = (webinarId) => ({ params: Promise.resolve({ id: webinarId }) });
const pedidoDaSala = (webinarId, path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${webinarId}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });

/** A consulta de 5 s do chat da Live gravada, como a aluna (ou outra conta) faz: devolve o `screen` da resposta. */
async function consultarChat(user, tela) {
  actAs(user);
  const query = new URLSearchParams({ sessao: GRAVADA.sessaoId, since: new Date(Date.now() - 5000).toISOString(), ...(tela === undefined ? {} : { tela }) });
  const resposta = await json(await chatRoute.GET(pedidoDaSala(GRAVADA.id, `chat?${query}`), contextoDe(GRAVADA.id)));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.screen;
}

/** O estado inteiro da Na tela pela consulta do chat (um carimbo que nunca e o de agora). */
const estadoDaTela = (user = aluna) => consultarChat(user, "2026-01-01T00:00:00+00:00");

/** GET .../session da Live gravada, como a conta dada. */
async function sessaoDaSala(user, sessionId = GRAVADA.sessaoId, webinarId = GRAVADA.id) {
  actAs(user);
  return json(await sessionRoute.GET(pedidoDaSala(webinarId, `session?sessao=${sessionId}`), contextoDe(webinarId)));
}

async function escreverNoChat(user, body) {
  actAs(user);
  return json(await chatRoute.POST(pedidoDaSala(GRAVADA.id, "chat", "POST", { body, consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: GRAVADA.sessaoId }), contextoDe(GRAVADA.id)));
}

async function perguntar(user, body) {
  actAs(user);
  return json(await questionsRoute.POST(pedidoDaSala(GRAVADA.id, "questions", "POST", { body, consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: GRAVADA.sessaoId }), contextoDe(GRAVADA.id)));
}

async function metricas(user, events, { sessionId = GRAVADA.sessaoId, webinarId = GRAVADA.id } = {}) {
  actAs(user);
  return json(await screenEventsRoute.POST(pedidoDaSala(webinarId, "screen-events", "POST", { events, sessionId }), contextoDe(webinarId)));
}

/** O retrato de 5 s do console da Live gravada, como o produtor. */
async function retratoDoConsole() {
  actAs(produtor);
  const resposta = await json(await consoleRoute.GET(new Request(`http://localhost/api/admin/webinars/${GRAVADA.id}/console?sessao=${GRAVADA.sessaoId}`), contextoDe(GRAVADA.id)));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data;
}

async function exibicoesAtivas(sessionId = GRAVADA.sessaoId) {
  return unwrap(await db.from("webinar_screen_displays").select("id, kind, item_id, poll_id, snapshot").eq("session_id", sessionId).is("hidden_at", null), "Lendo as exibicoes ativas");
}

async function exibicao(id) {
  return unwrap(await db.from("webinar_screen_displays").select("id, kind, hidden_at, hidden_reason, hidden_by, snapshot").eq("id", id).single(), "Lendo a exibicao");
}

async function auditoria(action) {
  return unwrap(await db.from("admin_audit_log").select("action, actor_id, metadata").eq("action", action).eq("actor_id", produtor.id).order("occurred_at", { ascending: false }).limit(5), `Lendo a auditoria ${action}`);
}

/** Uma enquete pronta (modelo, sem sessao) da Live gravada, com as opcoes, como o editor salva. */
async function enquetePronta(question, options) {
  const poll = unwrap(await db.from("webinar_polls").insert({ anonymous: false, kind: "single", position: 0, question, session_id: null, status: "draft", webinar_id: GRAVADA.id }).select("id").single(), "Gravando a enquete pronta");
  unwrap(await db.from("webinar_poll_options").insert(options.map((label, position) => ({ label, poll_id: poll.id, position }))), "Gravando as opcoes da enquete pronta");
  return poll.id;
}

/** A Live gravada de volta ao ar (comecou ha 2 min), sem exibicoes, sem fixada, sem enquetes, sem barrados. */
async function gravadaDoZero() {
  await seedLiveGravadaDeTeste(db, { comecouHa: 120_000 });
  unwrap(await db.from("webinar_screen_displays").delete().eq("session_id", GRAVADA.sessaoId), "Zerando as exibicoes da gravada");
  unwrap(await db.from("webinar_polls").delete().eq("webinar_id", GRAVADA.id), "Zerando as enquetes da gravada");
  unwrap(await db.from("webinar_session_bans").delete().eq("session_id", GRAVADA.sessaoId), "Zerando os barrados da gravada");
  unwrap(await db.from("webinar_sessions").update({ pinned_message_id: null }).eq("id", GRAVADA.sessaoId), "Tirando a fixada da gravada");
  unwrap(await db.from("webinar_chat_messages").delete().eq("session_id", GRAVADA.sessaoId), "Zerando o chat da gravada");
  resetRoomLimits();
  clearScreenStateCache();
  clearScreenDisplayIdsCache();
  clearScreenStatsCache();
}

test("9. pelas acoes: salvar, mostrar (a consulta do chat traz os dois numa chamada), o mesmo de novo nada, a copia congelada, outro banner troca o atual, dois Mostrar juntos deixam um so, tirar, excluir so fora da tela; Replay e encerrada 409", async () => {
  await gravadaDoZero();
  await seedLiveGravadaEncerradaDeTeste(db);
  unwrap(
    await db.from("webinar_sessions").upsert({ id: REPLAY, kind: "replay", recording_id: ENCERRADA.gravacaoId, scheduled_at: new Date().toISOString(), source_session_id: ENCERRADA.sessaoId, status: "live", webinar_id: ENCERRADA.id }, { onConflict: "id" }),
    "Gravando o Replay de teste"
  );

  falhou(await comoEquipe(acoesDaTela, analista).saveScreenItem({ kind: "banner", linkUrl: LINK, title: "Turma nova", webinarId: GRAVADA.id }), 403);

  const { item: banner } = ok(
    await screenActions.saveScreenItem({ body: "Vagas até sexta.", buttonLabel: "Quero entrar", closable: false, kind: "banner", linkUrl: LINK, place: "bottom_left", size: "s", title: "Turma nova", webinarId: GRAVADA.id })
  );
  assert.deepEqual([banner.name, banner.closable, banner.place, banner.size], ["Turma nova", false, "bottom_left", "s"], "sem nome, o titulo");
  const { item: qr } = ok(await screenActions.saveScreenItem({ kind: "qr", linkUrl: `${LINK}?origem=qr`, title: "Aponte a câmera", webinarId: GRAVADA.id }));
  assert.equal(qr.name, "Aponte a câmera", "sem nome, a legenda");
  const { item: semNome } = ok(await screenActions.saveScreenItem({ kind: "qr", linkUrl: "https://exemplo.com.br/x", webinarId: GRAVADA.id }));
  assert.equal(semNome.name, "exemplo.com.br", "sem nome nem legenda, o dominio do link");
  falhou(await screenActions.saveScreenItem({ kind: "banner", linkUrl: "javascript:alert(1)", title: "Golpe", webinarId: GRAVADA.id }), 400);
  falhou(await screenActions.saveScreenItem({ closable: false, kind: "banner", place: "center", size: "l", title: "No meio", webinarId: GRAVADA.id }), 400);

  const antes = await estadoDaTela();
  assert.deepEqual(antes.items, []);

  const mostrouBanner = ok(await screenActions.showScreenItem({ itemId: banner.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([mostrouBanner.changed, mostrouBanner.replaced, mostrouBanner.kind], [true, 0, "banner"]);
  const mostrouQr = ok(await screenActions.showScreenItem({ itemId: qr.id, sessionId: GRAVADA.sessaoId }));
  const estado = await consultarChat(aluna, antes.stamp);
  assert.notEqual(estado, null, "o carimbo velho traz o estado numa chamada");
  assert.notEqual(estado.stamp, antes.stamp);
  const porTipo = Object.fromEntries(estado.items.map((item) => [item.kind, item]));
  assert.deepEqual(
    [porTipo.banner.displayId, porTipo.banner.title, porTipo.banner.body, porTipo.banner.buttonLabel, porTipo.banner.linkUrl, porTipo.banner.closable, porTipo.banner.place, porTipo.banner.size, porTipo.banner.image],
    [mostrouBanner.displayId, "Turma nova", "Vagas até sexta.", "Quero entrar", LINK, false, "bottom_left", "s", null]
  );
  assert.deepEqual([porTipo.qr.displayId, porTipo.qr.title, porTipo.qr.linkUrl, porTipo.qr.place], [mostrouQr.displayId, "Aponte a câmera", `${LINK}?origem=qr`, "top_right"], "o QR Code em cima a direita por padrao");
  assert.equal(await consultarChat(aluno, estado.stamp), null, "o segundo aluno com o mesmo carimbo: nada");

  const deNovo = ok(await screenActions.showScreenItem({ itemId: banner.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([deNovo.changed, deNovo.displayId], [false, mostrouBanner.displayId], "o mesmo item como esta: nada gravado");
  assert.equal(await consultarChat(aluna, estado.stamp), null, "e o carimbo nao mudou");

  // Editar o item na tela: a turma continua vendo a copia mostrada ate o Mostrar de novo.
  ok(await screenActions.saveScreenItem({ body: "Vagas até sábado.", buttonLabel: "Quero entrar", closable: false, id: banner.id, kind: "banner", linkUrl: LINK, name: "Turma nova", place: "bottom_left", size: "s", title: "Turma de dezembro", webinarId: GRAVADA.id }));
  clearScreenStateCache();
  assert.equal((await estadoDaTela()).items.find((item) => item.kind === "banner").title, "Turma nova", "a copia congelada");
  const mostrouDeNovo = ok(await screenActions.showScreenItem({ itemId: banner.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([mostrouDeNovo.changed, mostrouDeNovo.replaced], [true, 1], "Mostrar de novo troca a copia");
  assert.equal((await exibicao(mostrouBanner.displayId)).hidden_reason, "replaced");
  assert.equal((await estadoDaTela()).items.find((item) => item.kind === "banner").title, "Turma de dezembro");

  // Outro banner troca o atual; o QR Code fica.
  const { item: outro } = ok(await screenActions.saveScreenItem({ kind: "banner", linkUrl: LINK, title: "Bônus de hoje", webinarId: GRAVADA.id }));
  const trocou = ok(await screenActions.showScreenItem({ itemId: outro.id, sessionId: GRAVADA.sessaoId }));
  assert.equal(trocou.replaced, 1);
  assert.deepEqual((await exibicoesAtivas()).map((row) => [row.kind, row.item_id]).sort(), [["banner", outro.id], ["qr", qr.id]]);

  // Dois Mostrar juntos (dois cliques de duas pessoas): o indice unico segura um banner so e a segunda tentativa passa.
  const { item: terceiro } = ok(await screenActions.saveScreenItem({ kind: "banner", linkUrl: LINK, title: "Aula extra", webinarId: GRAVADA.id }));
  const juntos = (await Promise.all([banner.id, terceiro.id].map((itemId) => screenActions.showScreenItem({ itemId, sessionId: GRAVADA.sessaoId })))).map(ok);
  assert.deepEqual(juntos.map((resultado) => resultado.changed), [true, true]);
  const ativas = await exibicoesAtivas();
  assert.equal(ativas.filter((row) => row.kind === "banner").length, 1, "um banner so na tela");
  assert.ok([banner.id, terceiro.id].includes(ativas.find((row) => row.kind === "banner").item_id));
  assert.equal(ativas.filter((row) => row.kind === "qr").length, 1, "o QR Code continua");
  const naTela = ativas.find((row) => row.kind === "banner");

  // Excluir o que esta na tela: 409; tirar da tela e entao excluir; o arquivado nao volta a tela.
  const itemNaTela = naTela.item_id;
  const recusado = falhou(await screenActions.archiveScreenItem({ id: itemNaTela }), 409);
  assert.equal(recusado.error, ERROS.tireDaTela);
  const tirou = ok(await screenActions.hideScreenItem({ displayId: naTela.id }));
  assert.equal(tirou.hidden, true);
  assert.equal(ok(await screenActions.hideScreenItem({ displayId: naTela.id })).hidden, false, "o que ja saiu nao muda nada");
  const saiu = await exibicao(naTela.id);
  assert.deepEqual([saiu.hidden_reason, saiu.hidden_by], ["team", produtor.id]);
  const semBanner = await consultarChat(aluna, estado.stamp);
  assert.deepEqual(semBanner.items.map((item) => item.kind), ["qr"], "tirar muda o carimbo e o banner some");
  assert.equal(ok(await screenActions.archiveScreenItem({ id: itemNaTela })).archived, true);
  falhou(await screenActions.showScreenItem({ itemId: itemNaTela, sessionId: GRAVADA.sessaoId }), 404);
  const { items: prontos } = await retratoDoConsole().then((retrato) => retrato.screen);
  assert.ok(!prontos.some((item) => item.id === itemNaTela), "o arquivado sai dos prontos do console");

  // De outro webinario: 404; Replay e sessao encerrada: 409 com a frase de cada um.
  falhou(await screenActions.showScreenItem({ itemId: qr.id, sessionId: AO_VIVO.sessaoId }), 404);
  const naEncerrada = falhou(await screenActions.showScreenItem({ itemId: qr.id, sessionId: ENCERRADA.sessaoId }), 409);
  assert.equal(naEncerrada.error, ERROS.sessaoFechada);
  const noReplay = falhou(await screenActions.showScreenItem({ itemId: qr.id, sessionId: REPLAY }), 409);
  assert.equal(noReplay.error, ERROS.replay);

  // A auditoria: quem e quando, nunca o texto nem o link.
  const [mostrado] = await auditoria("webinar.screen_shown");
  assert.equal(mostrado.metadata.session_id, GRAVADA.sessaoId);
  assert.ok(!JSON.stringify(await auditoria("webinar.screen_item_saved")).includes(LINK), "o link nao vai para a auditoria");
});

test("10. a imagem no bucket de verdade: Enviar imagem grava em content-assets/webinars/screen com as medidas dos bytes; salvar confere o objeto; o endereco pela nossa origem; caminho que nao existe e imagem grande recusados", async () => {
  await gravadaDoZero();
  const bytes = Buffer.concat([CAPA, randomBytes(8)]);
  const dataUrl = (conteudo) => `data:image/webp;base64,${Buffer.from(conteudo).toString("base64")}`;

  const enviada = ok(await screenActions.uploadScreenImage({ image: dataUrl(bytes) }));
  imagensEnviadas.add(enviada.path);
  assert.match(enviada.path, /^webinars\/screen\/[a-f0-9]{24}\.webp$/);
  assert.deepEqual([enviada.width, enviada.height], [880, 496], "as medidas lidas dos bytes pelo servidor");
  assert.ok(!JSON.stringify(enviada).includes("http"), "so o caminho, nunca um endereco");
  const objeto = await db.storage.from("content-assets").info(enviada.path);
  assert.equal(objeto.error, null, JSON.stringify(objeto.error));

  const grande = await screenActions.uploadScreenImage({ image: dataUrl(LARGA) });
  assert.equal(grande.ok, false);
  assert.deepEqual(grande.fieldErrors?.image, [ERROS.imagemLado]);
  const naoWebp = await screenActions.uploadScreenImage({ image: `data:image/png;base64,${Buffer.from("png").toString("base64")}` });
  assert.equal(naoWebp.ok, false);

  // Salvar: o objeto conferido no Storage e as medidas relidas (as do navegador nunca valem).
  const { item } = ok(await screenActions.saveScreenItem({ imageAlt: "Foguete da turma", imagePath: enviada.path, kind: "banner", linkUrl: LINK, webinarId: GRAVADA.id }));
  assert.deepEqual(item.image, { alt: "Foguete da turma", height: 496, path: enviada.path, width: 880 });
  assert.equal(item.name, "bunker707.com.br", "sem titulo nem nome, o dominio do link");
  const sumiu = await screenActions.saveScreenItem({ imageAlt: "Foguete", imagePath: "webinars/screen/ffffffffffffffffffffffff.webp", kind: "banner", linkUrl: LINK, webinarId: GRAVADA.id });
  assert.equal(sumiu.ok, false);
  assert.deepEqual(sumiu.fieldErrors?.imagePath, [ERROS.imagemSumiu]);
  const deFora = await screenActions.saveScreenItem({ imageAlt: "Foguete", imagePath: "https://golpe.com/foguete.webp", kind: "banner", linkUrl: LINK, webinarId: GRAVADA.id });
  assert.equal(deFora.ok, false, "um endereco nunca e caminho de imagem");

  ok(await screenActions.showScreenItem({ itemId: item.id, sessionId: GRAVADA.sessaoId }));
  const [mostrado] = (await estadoDaTela()).items;
  assert.deepEqual(mostrado.image, { alt: "Foguete da turma", height: 496, url: `${supabaseUrl}/storage/v1/object/public/content-assets/${enviada.path}`, width: 880 });
  const baixada = await fetch(mostrado.image.url);
  assert.equal(baixada.status, 200, "a imagem abre pelo endereco que a sala recebe");
  assert.equal(Buffer.compare(Buffer.from(await baixada.arrayBuffer()), bytes), 0);
});

test("11. Fixar ao enviar: uma fixada so, com o link da equipe ligado; a consulta do chat traz a fixada; Desafixar tira; fixar na sessao encerrada e 409", async () => {
  await gravadaDoZero();
  await seedLiveGravadaEncerradaDeTeste(db);
  const antes = await estadoDaTela();
  assert.equal(antes.pinned, null);

  const primeira = ok(await roomActions.sendTeamMessage({ body: `Inscrições abertas: ${LINK}`, pin: true, sessionId: GRAVADA.sessaoId })).message;
  const comFixada = await consultarChat(aluna, antes.stamp);
  assert.deepEqual([comFixada.pinned?.id, comFixada.pinned?.body, comFixada.pinned?.links], [primeira.id, `Inscrições abertas: ${LINK}`, true], "a mensagem da equipe leva o link");
  const [auditada] = await auditoria("webinar.team_message");
  assert.equal(auditada.metadata.pinned, true);

  const segunda = ok(await roomActions.sendTeamMessage({ body: "Agora a segunda fixada.", pin: true, sessionId: GRAVADA.sessaoId })).message;
  const fixadas = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", GRAVADA.sessaoId).not("pinned_at", "is", null), "Lendo as fixadas");
  assert.deepEqual(fixadas.map((row) => row.id), [segunda.id], "exatamente uma fixada");
  const sessao = unwrap(await db.from("webinar_sessions").select("pinned_message_id").eq("id", GRAVADA.sessaoId).single(), "Lendo a sessao");
  assert.equal(sessao.pinned_message_id, segunda.id);
  const trocada = await consultarChat(aluna, comFixada.stamp);
  assert.equal(trocada.pinned.id, segunda.id);
  assert.equal(trocada.pinned.links, true, "o link vem do papel e da origem da mensagem (a equipe), nao do texto");

  // A mensagem da aluna com um endereco nunca vira link, nem fixada.
  const daAluna = await escreverNoChat(aluna, `olhem ${LINK}`);
  assert.equal(daAluna.status, 201, JSON.stringify(daAluna.body));
  const fixouAluna = ok(await roomActions.moderateMessage({ action: "pin", messageId: daAluna.body.data.message.id }));
  assert.equal(fixouAluna.pinnedMessageId, daAluna.body.data.message.id);
  const comAluna = await consultarChat(aluna, trocada.stamp);
  assert.deepEqual([comAluna.pinned.id, comAluna.pinned.links], [daAluna.body.data.message.id, false]);

  // O retrato do console le a fixada pela chave.
  const retrato = await retratoDoConsole();
  assert.equal(retrato.pinned?.id, daAluna.body.data.message.id);

  ok(await roomActions.moderateMessage({ action: "unpin", messageId: daAluna.body.data.message.id }));
  const semFixada = await consultarChat(aluna, comAluna.stamp);
  assert.equal(semFixada.pinned, null, "Desafixar muda o carimbo e a fixada some");

  // Na sessao encerrada o Fixar e recusado no servidor (antes so a tela escondia).
  const [velha] = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", ENCERRADA.sessaoId).limit(1), "Lendo uma mensagem da encerrada");
  falhou(await roomActions.moderateMessage({ action: "pin", messageId: velha.id }), 409);
  falhou(await roomActions.sendTeamMessage({ body: "tarde demais", pin: true, sessionId: ENCERRADA.sessaoId }), 409);
});

test("12. a enquete fixada pelas acoes: Abrir e fixar, outra no lugar, a aluna responde a fixada, Encerrar sem compartilhar desafixa, com compartilhar mantem, Desafixar; na encerrada, 409", async () => {
  await gravadaDoZero();
  const antes = await estadoDaTela();
  const primeiraPronta = await enquetePronta("Qual curso você quer?", ["IA para negócios", "IA para criadores"]);
  const segundaPronta = await enquetePronta("Vem na próxima?", ["Sim", "Não"]);

  const aberta = ok(await roomActions.launchPoll({ pin: true, pollId: primeiraPronta, sessionId: GRAVADA.sessaoId }));
  assert.equal(aberta.pinned, true);
  const primeira = aberta.poll;
  const fixada = await consultarChat(aluna, antes.stamp);
  assert.equal(fixada.pinnedPollId, primeira.id);
  assert.notEqual(fixada.pollsKey, antes.pollsKey, "o resumo das enquetes mudou: a sala rele as enquetes");
  assert.deepEqual((await exibicoesAtivas()).map((row) => [row.kind, row.poll_id, row.snapshot.name]), [["poll", primeira.id, "Qual curso você quer?"]]);

  // A aluna responde a fixada pela rota das enquetes.
  actAs(aluna);
  const lista = await json(await pollsRoute.GET(pedidoDaSala(GRAVADA.id, `polls?sessao=${GRAVADA.sessaoId}`), contextoDe(GRAVADA.id)));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const daAluna = lista.body.data.polls.find((poll) => poll.id === primeira.id);
  assert.ok(daAluna, "a fixada esta nas enquetes da aluna");
  actAs(aluna);
  const resposta = await json(await pollsRoute.POST(pedidoDaSala(GRAVADA.id, "polls", "POST", { optionIds: [daAluna.options[0].id], pollId: primeira.id, sessionId: GRAVADA.sessaoId }), contextoDe(GRAVADA.id)));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));

  // Outra enquete fixada troca a de antes (que continua aberta na aba Enquetes).
  const segunda = ok(await roomActions.launchPoll({ pin: true, pollId: segundaPronta, sessionId: GRAVADA.sessaoId })).poll;
  const trocada = await consultarChat(aluna, fixada.stamp);
  assert.equal(trocada.pinnedPollId, segunda.id);
  const historico = unwrap(await db.from("webinar_screen_displays").select("poll_id, hidden_reason").eq("session_id", GRAVADA.sessaoId).eq("kind", "poll"), "Lendo as exibicoes de enquete");
  assert.deepEqual(Object.fromEntries(historico.map((row) => [row.poll_id, row.hidden_reason])), { [primeira.id]: "replaced", [segunda.id]: null });

  // Encerrar sem compartilhar: a turma ja nao ve a enquete, ela sai da tela; fixar de novo e recusado.
  const encerrada = ok(await roomActions.closePoll({ pollId: segunda.id, sessionId: GRAVADA.sessaoId }));
  assert.equal(encerrada.unpinned, true);
  const semFixada = await consultarChat(aluna, trocada.stamp);
  assert.equal(semFixada.pinnedPollId, null);
  const motivo = unwrap(await db.from("webinar_screen_displays").select("hidden_reason").eq("poll_id", segunda.id).single(), "Lendo o motivo");
  assert.equal(motivo.hidden_reason, "poll_closed");
  const recusada = falhou(await roomActions.pinPoll({ pollId: segunda.id, sessionId: GRAVADA.sessaoId }), 409);
  assert.equal(recusada.error, ERROS.enqueteNaoFixa);

  // A primeira (aberta) fixada pelo Fixar; Compartilhar resultado mantem fixada (agora com as barras).
  const fixouDeNovo = ok(await roomActions.pinPoll({ pollId: primeira.id, sessionId: GRAVADA.sessaoId }));
  assert.equal(fixouDeNovo.changed, true);
  assert.equal(ok(await roomActions.pinPoll({ pollId: primeira.id, sessionId: GRAVADA.sessaoId })).changed, false, "a mesma ja fixada: nada muda");
  const compartilhada = ok(await roomActions.closePoll({ pollId: primeira.id, sessionId: GRAVADA.sessaoId, shareResults: true }));
  assert.equal(compartilhada.unpinned, false);
  const comBarras = await consultarChat(aluna, semFixada.stamp);
  assert.equal(comBarras.pinnedPollId, primeira.id, "com o resultado compartilhado continua fixada");
  actAs(aluna);
  const barras = await json(await pollsRoute.GET(pedidoDaSala(GRAVADA.id, `polls?sessao=${GRAVADA.sessaoId}`), contextoDe(GRAVADA.id)));
  const resultado = barras.body.data.polls.find((poll) => poll.id === primeira.id);
  assert.equal(resultado.status, "closed");
  assert.deepEqual(resultado.results, { counts: { [daAluna.options[0].id]: 1, [daAluna.options[1].id]: 0 }, total: 1 }, "as barras: as contagens compartilhadas");

  const retrato = await retratoDoConsole();
  assert.equal(retrato.pinnedPollId, primeira.id, "o retrato do console traz a enquete fixada");

  const desafixou = ok(await roomActions.unpinPoll({ sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([desafixou.unpinned, desafixou.pollId], [true, primeira.id]);
  assert.equal(ok(await roomActions.unpinPoll({ sessionId: GRAVADA.sessaoId })).unpinned, false, "sem fixada, nada muda");
  assert.equal((await consultarChat(aluna, comBarras.stamp)).pinnedPollId, null);
  const [auditoriaFixar] = await auditoria("webinar.poll_pinned");
  assert.equal(auditoriaFixar.metadata.poll_id, primeira.id);

  await seedLiveGravadaEncerradaDeTeste(db);
  falhou(await roomActions.unpinPoll({ sessionId: ENCERRADA.sessaoId }), 409);
});

test("13. POST .../screen-events grava viu, clicou e fechou em student_events; webinar_screen_report e o retrato do console contam sem a equipe; outra sessao sai em silencio; 401 sem sessao e 404 no Replay", async () => {
  await gravadaDoZero();
  await limparRastros();
  const { item } = ok(await screenActions.saveScreenItem({ buttonLabel: "Quero entrar", kind: "banner", linkUrl: LINK, title: "Turma nova", webinarId: GRAVADA.id }));
  const { displayId } = ok(await screenActions.showScreenItem({ itemId: item.id, sessionId: GRAVADA.sessaoId }));
  unwrap(await db.from("webinar_screen_displays").delete().eq("session_id", AO_VIVO.sessaoId), "Zerando as exibicoes da live ao vivo");
  const daOutraSessao = unwrap(
    await db.from("webinar_screen_displays").insert({ item_id: null, kind: "banner", session_id: AO_VIVO.sessaoId, snapshot: { name: "x", v: 1 } }).select("id").single(),
    "Mostrando um banner na live ao vivo"
  ).id;
  const evento = (name, extra = {}) => ({ displayId, form: "stage", name, ...extra });

  const daAluna = await metricas(aluna, [evento("shown"), evento("clicked", { target: "button" }), evento("closed"), evento("shown", { displayId: daOutraSessao }), evento("clicked", { displayId: randomUUID(), target: "card" })]);
  assert.equal(daAluna.status, 202, JSON.stringify(daAluna.body));
  assert.deepEqual(daAluna.body.data, { accepted: 3 }, "a exibicao de outra sessao e o id inventado saem em silencio");
  const doAluno = await metricas(aluno, [evento("shown", { form: "strip" }), evento("clicked", { form: "strip", target: "button" }), evento("clicked", { form: "strip", target: "card" })]);
  assert.equal(doAluno.status, 202, JSON.stringify(doAluno.body));
  // A equipe que abre a sala fica gravada, mas nunca conta.
  assert.equal((await metricas(produtor, [evento("shown"), evento("clicked", { target: "button" })])).status, 202);

  const linhas = unwrap(
    await db.from("student_events").select("event_type, entity_id, metadata").eq("user_id", aluna.id).eq("entity_type", "webinar").like("event_type", "webinar_screen_%").order("event_type"),
    "Lendo as metricas da aluna"
  );
  assert.deepEqual(linhas.map((linha) => linha.event_type), ["webinar_screen_clicked", "webinar_screen_closed", "webinar_screen_shown"]);
  for (const linha of linhas) {
    assert.equal(linha.entity_id, GRAVADA.sessaoId, "por sessao: entity_id e a sessao");
    assert.deepEqual([linha.metadata.display_id, linha.metadata.item_id, linha.metadata.kind, linha.metadata.form], [displayId, item.id, "banner", "stage"]);
    assert.equal(typeof linha.metadata.offset_ms, "number", "o offset do relogio do servidor");
  }
  assert.equal(linhas.find((linha) => linha.event_type === "webinar_screen_clicked").metadata.target, "button");

  const relatorio = unwrap(await db.rpc("webinar_screen_report", { p_session_id: GRAVADA.sessaoId }), "Lendo o relatorio da Na tela");
  assert.deepEqual(
    relatorio.map((row) => [row.display_id, Number(row.shown), Number(row.clickers), Number(row.clicks), Number(row.closed)]),
    [[displayId, 2, 2, 3, 1]],
    "viram 2 (sem o produtor), clicaram 2, 3 cliques, fechou 1"
  );
  clearScreenStatsCache();
  const retrato = await retratoDoConsole();
  assert.deepEqual(retrato.screen.stats[displayId], { clickers: 2, clicks: 3, closed: 1, shown: 2 }, "os numeros de Na tela agora");
  assert.deepEqual(retrato.screen.active.map((display) => display.id), [displayId]);
  assert.equal(retrato.screen.pending, false);

  // A exibicao nova (mostrada depois da ultima leitura dos ids) entra numa releitura.
  const { item: qr } = ok(await screenActions.saveScreenItem({ kind: "qr", linkUrl: LINK, title: "Aponte a câmera", webinarId: GRAVADA.id }));
  const { displayId: doQr } = ok(await screenActions.showScreenItem({ itemId: qr.id, sessionId: GRAVADA.sessaoId }));
  clearScreenDisplayIdsCache();
  assert.deepEqual((await metricas(aluna, [{ displayId: doQr, form: "stage", name: "clicked", target: "qr_link" }])).body.data, { accepted: 1 });

  actAs(null);
  assert.equal((await json(await screenEventsRoute.POST(pedidoDaSala(GRAVADA.id, "screen-events", "POST", { events: [evento("shown")], sessionId: GRAVADA.sessaoId }), contextoDe(GRAVADA.id)))).status, 401);
  assert.equal((await metricas(aluna, [evento("shown")], { sessionId: REPLAY, webinarId: ENCERRADA.id })).status, 404, "no Replay nada e medido");
  assert.equal((await metricas(aluna, [evento("visto")])).status, 400, "nome desconhecido");
});

test("14. moderacao na Live gravada pelas acoes: silenciada 409 muted no chat e na pergunta (reage e assiste), removida recusada na entrada e na escrita, o Desfazer devolve tudo; a equipe nunca e alvo; no Replay, 409", async () => {
  await gravadaDoZero();
  const contexto = contextoDe(GRAVADA.id);
  assert.equal((await escreverNoChat(aluna, "Boa noite!")).status, 201);

  const silencio = ok(await liveActions.muteInChat({ minutes: null, sessionId: GRAVADA.sessaoId, userId: aluna.id }));
  assert.equal(silencio.untilAt, null, "ate o fim");
  const calada = await escreverNoChat(aluna, "posso falar?");
  assert.deepEqual([calada.status, calada.body.reason], [409, "muted"]);
  const pergunta = await perguntar(aluna, "Tem certificado?");
  assert.deepEqual([pergunta.status, pergunta.body.reason], [409, "muted"]);
  actAs(aluna);
  assert.equal((await reactionsRoute.POST(pedidoDaSala(GRAVADA.id, "reactions", "POST", { reaction: "clap", sessionId: GRAVADA.sessaoId }), contexto)).status, 201, "silenciada ainda reage");
  const silenciada = await sessaoDaSala(aluna);
  assert.equal(silenciada.status, 200, JSON.stringify(silenciada.body));
  assert.deepEqual([silenciada.body.data.me.ban.muted, silenciada.body.data.me.ban.mutedUntil, silenciada.body.data.session.join.ok], [true, null, true]);
  assert.ok(silenciada.body.data.video, "silenciada continua assistindo");
  assert.equal((await escreverNoChat(aluno, "eu posso")).status, 201, "so a aluna ficou sem escrever");

  const barrados = (await retratoDoConsole()).barred;
  assert.deepEqual(barrados.map((pessoa) => [pessoa.userId, pessoa.ban.muted, pessoa.staff]), [[aluna.id, true, false]], "o bloco Removidos, silenciados e banidos");

  assert.equal(ok(await liveActions.undoSessionBan({ kind: "muted", sessionId: GRAVADA.sessaoId, userId: aluna.id })).existed, true);
  assert.equal((await escreverNoChat(aluna, "voltei")).status, 201, "o Desfazer devolve o chat");

  ok(await liveActions.kickFromSession({ sessionId: GRAVADA.sessaoId, userId: aluna.id }));
  const removida = await sessaoDaSala(aluna);
  assert.deepEqual(removida.body.data.session.join, { ok: false, reason: "kicked" });
  assert.equal(removida.body.data.video, null, "sem o video");
  const escrita = await escreverNoChat(aluna, "ainda estou aqui");
  assert.deepEqual([escrita.status, escrita.body.reason], [409, "banned"]);
  const entrada = await getRoomPageData(undefined, aluna, GRAVADA.slug, GRAVADA.sessaoId);
  assert.deepEqual([entrada.state, entrada.reason], ["refused", "kicked"], "a pagina da sala recusa a removida");
  const outra = await getRoomPageData(undefined, aluno, GRAVADA.slug, GRAVADA.sessaoId);
  assert.equal(outra.state, "ready", "o outro aluno entra");

  ok(await liveActions.undoSessionBan({ kind: "kicked", sessionId: GRAVADA.sessaoId, userId: aluna.id }));
  const devolvida = await sessaoDaSala(aluna);
  assert.deepEqual(devolvida.body.data.session.join, { ok: true });
  assert.ok(devolvida.body.data.video, "o Desfazer devolve o video");
  assert.equal((await getRoomPageData(undefined, aluna, GRAVADA.slug, GRAVADA.sessaoId)).state, "ready");

  // Banir pede messaging.publish; a equipe nunca e alvo; no Replay nada muda.
  falhou(await comoEquipe(acoesDaLive, analista).banStudent({ sessionId: GRAVADA.sessaoId, userId: aluna.id }), 403);
  falhou(await liveActions.muteInChat({ minutes: 5, sessionId: GRAVADA.sessaoId, userId: produtor.id }), 409);
  await seedLiveGravadaEncerradaDeTeste(db);
  unwrap(
    await db.from("webinar_sessions").upsert({ ended_at: null, id: REPLAY, kind: "replay", recording_id: ENCERRADA.gravacaoId, scheduled_at: new Date().toISOString(), source_session_id: ENCERRADA.sessaoId, status: "live", webinar_id: ENCERRADA.id }, { onConflict: "id" }),
    "Gravando o Replay de teste"
  );
  falhou(await liveActions.kickFromSession({ sessionId: REPLAY, userId: aluna.id }), 409);
  ok(await liveActions.banStudent({ sessionId: GRAVADA.sessaoId, userId: aluna.id }));
  assert.deepEqual((await sessaoDaSala(aluna)).body.data.session.join, { ok: false, reason: "banned" });
  ok(await liveActions.unbanStudent({ userId: aluna.id }));
  ok(await liveActions.undoSessionBan({ kind: "kicked", sessionId: GRAVADA.sessaoId, userId: aluna.id }));
  assert.deepEqual((await sessaoDaSala(aluna)).body.data.session.join, { ok: true });
});

/* ------------------------------------------------------------------------------------------------
 * R7 pelo app: a Simulacao na Live ao vivo (adendo de 10/11/2026)
 * ---------------------------------------------------------------------------------------------- */

test("15. R7 pelo app: o produtor decide a Simulacao da live na espera com a frase da live; no ar, a aluna recebe a janela contada do started_at e o console ve a parte simulada separada", async () => {
  const simulationActions = await import("../../src/server/webinars/simulation-actions.ts");
  const simulationModel = await import("../../src/server/webinars/simulation-model.ts");
  const simulationRoute = await import("../../src/app/api/webinars/[id]/simulation/route.ts");
  const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
  const { resetRoomAccessCache } = await import("../../src/server/webinars/room-route.ts");
  unwrap(
    await db
      .from("webinar_sessions")
      .update({ ended_at: null, show_live_badge: false, simulated_count_rule: null, simulated_joins: null, simulated_sale_notices: null, simulation_ack_text: null, simulation_decided_at: null, simulation_summary: null, started_at: null, status: "waiting" })
      .eq("id", AO_VIVO.sessaoId),
    "Voltando a live para a espera"
  );
  const regras = { countRule: { base: 300, jitter: 0, mode: "fixed", peak: 300 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, showLiveBadge: false };
  const frase = simulationModel.simulationAckFor({ live: true, nowMs: Date.now(), responsible: contas.produtor.nome, rules: simulationModel.normalizeSimulationRules(regras) });

  actAs(usuarioDeTeste(contas.produtor));
  const comSelo = await simulationActions.saveSessionSimulation({ ...regras, ackText: frase, acknowledged: true, sessionId: AO_VIVO.sessaoId, showLiveBadge: true });
  assert.equal(comSelo.ok, false, "o selo Ao vivo nunca na live");
  const salvo = await simulationActions.saveSessionSimulation({ ...regras, ackText: frase, acknowledged: true, sessionId: AO_VIVO.sessaoId });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const linha = unwrap(await db.from("webinar_sessions").select("simulated_count_rule, simulation_ack_text, show_live_badge").eq("id", AO_VIVO.sessaoId).single(), "Lendo a decisao da live");
  assert.deepEqual([linha.simulated_count_rule.base, linha.simulation_ack_text, linha.show_live_badge], [300, frase, false]);

  // O Comecar para todos (a RPC), e a aluna pede a janela do minuto 1 ao 3 da live.
  unwrap(await db.rpc("webinar_open_session", { p_now: new Date(Date.now() - 2 * 60_000).toISOString(), p_session_id: AO_VIVO.sessaoId }), "Comecar para todos");
  resetRoomAccessCache();
  actAs(usuarioDeTeste(contas.aluna));
  const resposta = await simulationRoute.GET(new Request(`http://localhost/api/webinars/${AO_VIVO.id}/simulation?sessao=${AO_VIVO.sessaoId}&from=60000&to=180000`), { params: Promise.resolve({ id: AO_VIVO.id }) });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.data.enabled, true);
  assert.ok(corpo.data.counter.every((point) => point.extra === 300), "+300 para todos");

  const retrato = await consoleQueries.getConsoleSnapshot(AO_VIVO.id, AO_VIVO.sessaoId, new Date());
  assert.equal(retrato.simulatedNow, 300, "o console ve a parte simulada separada");

  const mudarNoAr = await (async () => {
    actAs(usuarioDeTeste(contas.produtor));
    return simulationActions.saveSessionSimulation({ sessionId: AO_VIVO.sessaoId });
  })();
  assert.equal(mudarNoAr.status, 409, "no ar, a regra nao muda");
  actAs(null);
});
