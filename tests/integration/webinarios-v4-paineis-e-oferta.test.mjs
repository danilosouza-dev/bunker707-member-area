import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  SENHA_DE_TESTE,
  desconectarVendas,
  ligarProdutoNaHotmart,
  limparVendasDeTeste,
  limparWebinarios,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Webinarios, fase 4 (docs/30 §3.2, §3.3, §3.5, §3.6, §4.2, §4.6, §5.1, M7 e M8; docs/18 §3) contra o banco LOCAL de
// verdade, com as migracoes 202610290004 e 202610290005 aplicadas. Os numeros abaixo foram conferidos a mao (e num
// Postgres 16 local com os mesmos dados) e as sessoes ficam em marco de 2020, fora de qualquer outro teste, para o
// periodo do painel so ter o que este arquivo grava:
// - webinar_panel('live'): uma live encerrada de 10 min (20 baldes) lida pelas amostras: a aluna do comeco ao fim, o
//   aluno sem acesso ate o minuto 5, o produtor e o professor (equipe) fora de tudo; vagas (a sem sessao vale, a
//   cancelada nao), mensagens so de aluno (a apagada, a da equipe, o roteiro e o Assistente fora), perguntas por
//   situacao, reacoes, enquete, visitantes (webinar_joined), quem viu o replay, a retencao nos pontos de 5 % e os
//   unicos do periodo; nenhuma linha sim_* nem offer*;
// - webinar_panel('simulated'): a sessao gravada encerrada lida pelo resumo (webinar_attendance) e pela curva
//   congelada, o bloco Simulacao (sim_counter, sim_joins, sim_sales, sim_script) separado e nunca somado nos presentes,
//   a Oferta (viram na janela de webinar_offer_displays, cliques, compras e a receita da venda real) e a sessao fora do
//   periodo de fora; 'all' com o mesmo aluno em duas sessoes contando uma vez; p_session_ids restringindo;
// - a conversao com vendas reais pelo webhook da Hotmart (o mesmo caminho de tests/integration/vendas-hotmart):
//   o job webinar-offer-conversions do tick liga a venda ao ULTIMO clique antes dela em ate 7 dias, uma venda nunca
//   converte dois cliques, o clique de 8 dias atras nao converte e o job de novo nao muda nada;
// - webinar_report com as linhas offer / offer_revenue e o bloco sim_* (fase 4) sem mexer nos numeros reais;
// - webinar_offer_variant igual a offerVariantFor (offer-model.ts: md5(user_id || offer_id), pesos e variante desligada);
// - webinar_follow_up_facts (as regras de follow-up do segmento da Comunicacao), sem a equipe;
// - o aluno logado recebe 42501 nas quatro funcoes novas e nas quatro tabelas da Oferta.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const { fetchWebinarPanel } = await import("../../src/server/webinars/panel-store.ts");
const { fetchWebinarFollowUpFacts } = await import("../../src/server/webinars/offer-store.ts");
const { fetchWebinarReport } = await import("../../src/server/webinars/store.ts");
const { offerVariantFor } = await import("../../src/server/webinars/offer-model.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");
const { WEBINAR_OFFER_CONVERSIONS_JOB_NAME, webinarOfferConversionsJob } = await import("../../src/server/jobs/webinar-offer-conversions-job.ts");
const hotmartRoute = await import("../../src/app/api/webhooks/hotmart/route.ts");
const salesActions = await import("../../src/server/payments/actions.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const expirada = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const alunos = [aluna.id, alunoSemAcesso.id, expirada.id];
const pessoas = [...alunos, produtor.id, professor.id];

/** O periodo do painel: marco de 2020 em Sao Paulo (o fim e exclusivo). */
const PERIODO = { end: "2020-04-01T03:00:00.000Z", start: "2020-03-01T03:00:00.000Z" };
const AO_VIVO = {
  enqueteId: "bbbbbbbb-0000-4000-8000-000000000404",
  id: "bbbbbbbb-0000-4000-8000-000000000401",
  opcaoId: "bbbbbbbb-0000-4000-8000-000000000405",
  replayId: "bbbbbbbb-0000-4000-8000-000000000402",
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000403",
  slug: "teste-v4-painel-ao-vivo",
  titulo: "Live de Teste v4: Painel ao vivo"
};
const GRAVADA = {
  foraDoPeriodoId: "bbbbbbbb-0000-4000-8000-000000000413",
  gravacaoId: "bbbbbbbb-0000-4000-8000-000000000411",
  id: "bbbbbbbb-0000-4000-8000-000000000410",
  ofertaId: "bbbbbbbb-0000-4000-8000-000000000416",
  roteiro: ["bbbbbbbb-0000-4000-8000-000000000414", "bbbbbbbb-0000-4000-8000-000000000415"],
  sessaoId: "bbbbbbbb-0000-4000-8000-000000000412",
  slug: "teste-v4-painel-gravada",
  titulo: "Live de Teste v4: Painel gravada"
};
const VARIANTES = { id: "bbbbbbbb-0000-4000-8000-000000000420", ofertaId: "bbbbbbbb-0000-4000-8000-000000000421", slug: "teste-v4-variantes" };

/** As vendas de teste pela Hotmart: o codigo do produto, os eventos e as transacoes (HP-: a limpeza de vendas tambem pega). */
const HOTMART = { codigo: "7401", prefixo: "teste-v4-oferta-", token: "hottok-webinarios-v4-0123456789abcdef" };
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const INICIO = new Date(Date.now() - 2000).toISOString();
const DIA_MS = 24 * 60 * 60 * 1000;

const linha = (rows, metric, item = "", sessionId) =>
  rows.find((row) => row.metric === metric && row.item === item && (sessionId === undefined || row.sessionId === sessionId));
const daSessao = (rows, sessionId) => rows.filter((row) => row.sessionId === sessionId);
const doPeriodo = (rows) => Object.fromEntries(rows.filter((row) => row.sessionId === null).map((row) => [row.metric, row.total]));

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("entitlements").delete().eq("target_id", PRODUTO).eq("source_provider", "hotmart").in("user_id", alunos), "Apagando os acessos das vendas de teste");
  unwrap(await db.from("sale_grants").delete().like("transaction_id", "HP-TESTE-V4-%"), "Apagando os vinculos das vendas de teste");
  unwrap(await db.from("email_outbox").delete().in("to_email", [contas.aluna.email, contas.alunoSemAcesso.email]).gte("created_at", INICIO), "Apagando a fila de e-mail das vendas de teste");
  await desconectarVendas(db);
  await limparVendasDeTeste(db, { codigos: [HOTMART.codigo], prefixoDoEvento: HOTMART.prefixo });
}

function amostras(sessionId, userId, ate, de = 0) {
  return Array.from({ length: ate - de + 1 }, (_, index) => {
    const bucket = de + index;
    return { bucket, offset_seconds: bucket * 30, samples: 2, session_id: sessionId, state: "playing", user_id: userId };
  });
}

/** A live ao vivo encerrada (10 min, sem curva congelada: o painel le as amostras), o replay e o que os alunos fizeram. */
async function seedAoVivo() {
  unwrap(
    await db.from("webinars").insert({
      access_mode: "everyone",
      created_by: produtor.id,
      duration_minutes: 60,
      host_user_id: produtor.id,
      id: AO_VIVO.id,
      kind: "live",
      published_at: "2020-03-01T12:00:00.000Z",
      slug: AO_VIVO.slug,
      status: "published",
      title: AO_VIVO.titulo
    }),
    "Gravando a live ao vivo"
  );
  unwrap(
    await db.from("webinar_sessions").insert([
      { ended_at: "2020-03-10T23:10:00.000Z", id: AO_VIVO.sessaoId, kind: "live", scheduled_at: "2020-03-10T23:00:00.000Z", started_at: "2020-03-10T23:00:00.000Z", status: "ended", webinar_id: AO_VIVO.id },
      { id: AO_VIVO.replayId, kind: "replay", scheduled_at: "2020-03-11T00:00:00.000Z", status: "live", webinar_id: AO_VIVO.id }
    ]),
    "Gravando a live e o replay"
  );
  unwrap(
    await db.from("webinar_presence_samples").insert([
      ...amostras(AO_VIVO.sessaoId, aluna.id, 19),
      ...amostras(AO_VIVO.sessaoId, alunoSemAcesso.id, 9),
      ...amostras(AO_VIVO.sessaoId, produtor.id, 19),
      ...amostras(AO_VIVO.sessaoId, professor.id, 4),
      ...amostras(AO_VIVO.replayId, expirada.id, 2),
      ...amostras(AO_VIVO.replayId, produtor.id, 2)
    ]),
    "Gravando a presenca da live"
  );
  unwrap(
    await db.from("webinar_registrations").insert([
      { session_id: AO_VIVO.sessaoId, status: "registered", user_id: aluna.id, webinar_id: AO_VIVO.id },
      { session_id: null, status: "registered", user_id: expirada.id, webinar_id: AO_VIVO.id },
      { cancelled_at: "2020-03-09T12:00:00.000Z", session_id: AO_VIVO.sessaoId, status: "cancelled", user_id: alunoSemAcesso.id, webinar_id: AO_VIVO.id },
      { session_id: AO_VIVO.sessaoId, status: "registered", user_id: produtor.id, webinar_id: AO_VIVO.id }
    ]),
    "Gravando as vagas da live"
  );
  const mensagem = (extra) => ({ approved: true, kind: "message", session_id: AO_VIVO.sessaoId, webinar_id: AO_VIVO.id, ...extra });
  unwrap(
    await db.from("webinar_chat_messages").insert([
      mensagem({ author_user_id: aluna.id, body: "oi", display_name: "Aluna T.", offset_ms: 30_000, role: "student", source: "audience" }),
      mensagem({ author_user_id: aluna.id, body: "boa", display_name: "Aluna T.", offset_ms: 90_000, role: "student", source: "audience" }),
      mensagem({ author_user_id: aluna.id, body: "apagada", deleted_at: "2020-03-10T23:02:00.000Z", deleted_reason: "student", display_name: "Aluna T.", offset_ms: 95_000, role: "student", source: "audience" }),
      mensagem({ author_user_id: alunoSemAcesso.id, body: "ola", display_name: "Aluno S.", offset_ms: 120_000, role: "student", source: "audience" }),
      mensagem({ author_user_id: produtor.id, body: "bem-vindos", display_name: "Produtor", offset_ms: 10_000, role: "host", source: "team" }),
      mensagem({ body: "roteiro", display_name: "Bia", offset_ms: 20_000, role: "student", source: "scripted" }),
      mensagem({ body: "resposta", display_name: "Assistente", kind: "answer", offset_ms: 25_000, role: "ai", source: "ai" })
    ]),
    "Gravando o chat da live"
  );
  unwrap(
    await db.from("webinar_questions").insert([
      { body: "Tem replay?", display_name: "Aluno S.", offset_ms: 60_000, session_id: AO_VIVO.sessaoId, status: "answered", user_id: alunoSemAcesso.id },
      { body: "E o material?", display_name: "Aluna T.", offset_ms: 70_000, session_id: AO_VIVO.sessaoId, status: "open", user_id: aluna.id }
    ]),
    "Gravando as perguntas da live"
  );
  unwrap(
    await db.from("webinar_reactions").insert([
      { offset_ms: 40_000, reaction: "fire", session_id: AO_VIVO.sessaoId, user_id: aluna.id },
      { offset_ms: 41_000, reaction: "clap", session_id: AO_VIVO.sessaoId, user_id: aluna.id },
      { offset_ms: 42_000, reaction: "love", session_id: AO_VIVO.sessaoId, user_id: produtor.id }
    ]),
    "Gravando as reacoes da live"
  );
  unwrap(await db.from("webinar_polls").insert({ id: AO_VIVO.enqueteId, question: "Vem na próxima?", session_id: AO_VIVO.sessaoId, status: "closed", webinar_id: AO_VIVO.id }), "Gravando a enquete");
  unwrap(await db.from("webinar_poll_options").insert({ id: AO_VIVO.opcaoId, label: "Sim", poll_id: AO_VIVO.enqueteId, position: 0 }), "Gravando a opcao");
  unwrap(
    await db.from("webinar_poll_answers").insert({ offset_ms: 300_000, option_ids: [AO_VIVO.opcaoId], poll_id: AO_VIVO.enqueteId, session_id: AO_VIVO.sessaoId, user_id: aluna.id }),
    "Gravando a resposta da enquete"
  );
  unwrap(
    await db.from("student_events").insert(
      [aluna, alunoSemAcesso, produtor].map((user) => ({ entity_id: AO_VIVO.sessaoId, entity_type: "webinar", event_type: "webinar_joined", metadata: { device: "desktop", kind: "live" }, user_id: user.id }))
    ),
    "Gravando quem abriu a sala"
  );
}

/** A live gravada: a sessao encerrada (video de 10 min, curva congelada e resumo por aluno), a Simulacao e a Oferta. */
async function seedGravada() {
  unwrap(
    await db.from("webinars").insert({
      access_mode: "everyone",
      created_by: produtor.id,
      duration_minutes: 60,
      host_user_id: produtor.id,
      id: GRAVADA.id,
      kind: "simulated",
      published_at: "2020-03-01T12:00:00.000Z",
      slug: GRAVADA.slug,
      status: "published",
      title: GRAVADA.titulo
    }),
    "Gravando a live gravada"
  );
  unwrap(
    await db.from("webinar_recordings").insert({ duration_seconds: 600, id: GRAVADA.gravacaoId, provider: "bunny", source: "bunny", status: "ready", webinar_id: GRAVADA.id }),
    "Gravando o video"
  );
  const curva = { buckets: Array.from({ length: 20 }, (_, b) => ({ b, n: b <= 1 ? 3 : b <= 4 ? 2 : 1 })), durationMs: 600_000 };
  unwrap(
    await db.from("webinar_sessions").insert([
      {
        ended_at: "2020-03-12T23:10:00.000Z",
        id: GRAVADA.sessaoId,
        kind: "simulated",
        presence_curve: curva,
        recording_id: GRAVADA.gravacaoId,
        scheduled_at: "2020-03-12T23:00:00.000Z",
        script_fired_at: "2020-03-12T23:00:00.000Z",
        simulated_count_rule: { base: 40, jitter: 0, mode: "fixed", peak: 40 },
        simulation_summary: { counter_max: 240, joins_shown: 18, sale_notices_shown: 2 },
        started_at: "2020-03-12T23:00:00.000Z",
        status: "ended",
        webinar_id: GRAVADA.id
      },
      {
        ended_at: "2020-05-01T23:10:00.000Z",
        id: GRAVADA.foraDoPeriodoId,
        kind: "simulated",
        recording_id: GRAVADA.gravacaoId,
        scheduled_at: "2020-05-01T23:00:00.000Z",
        started_at: "2020-05-01T23:00:00.000Z",
        status: "ended",
        webinar_id: GRAVADA.id
      }
    ]),
    "Gravando as sessoes gravadas"
  );
  const resumo = (user, seconds, maxBucket, reachedEnd) => ({
    entries: 1,
    first_at: "2020-03-12T23:00:10.000Z",
    last_at: "2020-03-12T23:09:50.000Z",
    max_bucket: maxBucket,
    reached_end: reachedEnd,
    seconds,
    session_id: GRAVADA.sessaoId,
    user_id: user.id
  });
  unwrap(
    await db.from("webinar_attendance").insert([resumo(aluna, 600, 19, true), resumo(expirada, 150, 4, false), resumo(alunoSemAcesso, 60, 1, false), resumo(produtor, 600, 19, true)]),
    "Gravando o resumo por aluno"
  );
  unwrap(
    await db.from("webinar_presence_samples").insert([
      ...amostras(GRAVADA.sessaoId, aluna.id, 19),
      ...amostras(GRAVADA.sessaoId, expirada.id, 4),
      ...amostras(GRAVADA.sessaoId, alunoSemAcesso.id, 1),
      ...amostras(GRAVADA.sessaoId, produtor.id, 19),
      ...amostras(GRAVADA.foraDoPeriodoId, alunoSemAcesso.id, 19)
    ]),
    "Gravando as amostras da gravada"
  );
  unwrap(
    await db.from("webinar_chat_messages").insert({
      approved: true,
      author_user_id: expirada.id,
      body: "oi",
      display_name: "Aluna A.",
      offset_ms: 15_000,
      role: "student",
      session_id: GRAVADA.sessaoId,
      source: "audience",
      webinar_id: GRAVADA.id
    }),
    "Gravando a mensagem da gravada"
  );
  unwrap(
    await db.from("webinar_chat_script_items").insert(
      GRAVADA.roteiro.map((id, index) => ({ body: `roteiro ${index + 1}`, id, offset_ms: 5000 + index * 1000, persona_name: "Duda", persona_role: "student", status: "ready", trigger_kind: "at_offset", webinar_id: GRAVADA.id }))
    ),
    "Gravando o roteiro"
  );
  unwrap(
    await db.from("webinar_chat_messages").insert(
      GRAVADA.roteiro.map((scriptItemId, index) => ({
        approved: true,
        body: `roteiro ${index + 1}`,
        display_name: "Duda",
        offset_ms: 5000 + index * 1000,
        role: "student",
        script_item_id: scriptItemId,
        session_id: GRAVADA.sessaoId,
        source: "scripted",
        webinar_id: GRAVADA.id
      }))
    ),
    "Gravando o roteiro solto"
  );
  // A Oferta do produto que ninguem comprou (o curso bloqueado), A e B, e a janela da sessao: de 1:00 a 2:30.
  unwrap(
    await db
      .from("webinar_offers")
      .insert({ id: GRAVADA.ofertaId, product_id: PRODUTO, show_at_offset_ms: 60_000, status: "active", title: "Oferta de teste v4", trigger_kind: "at_offset", webinar_id: GRAVADA.id }),
    "Gravando a oferta"
  );
  unwrap(
    await db.from("webinar_offer_variants").insert([
      { checkout_url: "https://checkout.bunker707.test/a", headline: "Entre agora", label: "A", offer_id: GRAVADA.ofertaId },
      { checkout_url: "https://checkout.bunker707.test/b", headline: "Última chance", label: "B", offer_id: GRAVADA.ofertaId }
    ]),
    "Gravando as variantes"
  );
  unwrap(
    await db.from("webinar_offer_displays").insert({ hide_offset_ms: 150_000, offer_id: GRAVADA.ofertaId, session_id: GRAVADA.sessaoId, show_offset_ms: 60_000 }),
    "Gravando a janela da oferta"
  );
  // Quem viu a oferta, como o fim da sessao congela (webinar_close_session, 202610290010): aqui a curva e gravada
  // direto, entao o congelado tambem (os baldes 2 a 5: a aluna, a expirada e o produtor; o aluno sem acesso saiu no 1).
  unwrap(
    await db.from("webinar_offer_seen").insert(
      [aluna, expirada, produtor].map((user) => ({ offer_id: GRAVADA.ofertaId, session_id: GRAVADA.sessaoId, user_id: user.id, variant_label: varianteDe(user) }))
    ),
    "Gravando quem viu a oferta"
  );
}

/** A variante do aluno pelo banco (webinar_offer_variant). */
async function varianteNoBanco(userId, offerId) {
  return unwrap(await db.rpc("webinar_offer_variant", { p_offer_id: offerId, p_user_id: userId }), "Lendo a variante");
}

const VARIANTES_DA_OFERTA = [
  { enabled: true, label: "A", weight: 1 },
  { enabled: true, label: "B", weight: 1 }
];
const varianteDe = (user) => offerVariantFor({ offerId: GRAVADA.ofertaId, userId: user.id, variants: VARIANTES_DA_OFERTA })?.label;

/* ------------------------------------------------------------------------------------------------ Hotmart */

function compraNaHotmart({ comprador, id, transacao }) {
  return {
    creation_date: Date.now(),
    data: {
      buyer: { email: comprador.email, name: comprador.nome },
      product: { id: Number(HOTMART.codigo), name: "Curso de Teste na Hotmart" },
      purchase: { approved_date: Date.now(), order_date: Date.now(), price: { currency_value: "BRL", value: 1597.9 }, status: "APPROVED", transaction: transacao }
    },
    event: "PURCHASE_APPROVED",
    id: `${HOTMART.prefixo}${id}`,
    version: "2.0.0"
  };
}

async function postarNaHotmart(body) {
  const response = await hotmartRoute.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", "x-hotmart-hottok": HOTMART.token },
      method: "POST"
    })
  );
  return { body: await response.json(), status: response.status };
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedAoVivo();
  await seedGravada();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
});

test("1. webinar_panel('live') contra contas a mao: presentes, vagas, comparecimento, tempo, ate o fim, pico, retencao, mensagens, perguntas, replay e visitantes; a equipe fora e nada simulado", async () => {
  const rows = await fetchWebinarPanel(db, { ...PERIODO, kind: "live" });
  const sessao = AO_VIVO.sessaoId;

  assert.deepEqual([...new Set(rows.filter((row) => row.sessionId).map((row) => row.sessionId))], [sessao], "so a live do periodo (o replay nunca e sessao do painel)");
  assert.equal(linha(rows, "duration", "", sessao).total, 600_000, "a live sem gravacao mede ended_at - started_at");
  // Vagas: a da aluna (desta sessao) e a da aluna expirada (sem sessao = qualquer uma); a cancelada e a do produtor fora.
  assert.deepEqual([linha(rows, "registered", "", sessao).total, linha(rows, "registered", "", sessao).students], [2, 2]);
  assert.deepEqual([linha(rows, "present", "", sessao).total, linha(rows, "attended_registered", "", sessao).total], [2, 1], "presentes: aluna e aluno sem acesso; com vaga: so a aluna");
  // Tempo: 20 baldes x 2 sinais x 15 s = 600 s; 10 baldes = 300 s.
  assert.deepEqual([linha(rows, "watch_sum", "", sessao).total, linha(rows, "watch_sum", "", sessao).students], [900, 2]);
  assert.equal(linha(rows, "watch_max", "", sessao).total, 600);
  assert.equal(linha(rows, "reached_end", "", sessao).total, 1, "o ultimo balde 19 passa de 95 % de 20; o 9 nao");
  const pico = rows.find((row) => row.metric === "peak" && row.sessionId === sessao);
  assert.deepEqual([pico?.item, pico?.total], ["0", 2], "o pico no primeiro balde com 2 (o produtor e o professor nao contam)");
  // Retencao: o ponto p cai no balde floor(p% x 20); total = presentes nele, students = alunos da sessao.
  assert.deepEqual(
    ["0", "45", "50", "100"].map((ponto) => [linha(rows, "retention", ponto, sessao)?.total, linha(rows, "retention", ponto, sessao)?.students]),
    [
      [2, 2],
      [2, 2],
      [1, 2],
      [1, 2]
    ]
  );
  assert.equal(rows.filter((row) => row.metric === "retention" && row.sessionId === sessao).length, 21, "21 pontos, de 5 em 5");
  assert.deepEqual([linha(rows, "messages", "", sessao).total, linha(rows, "messages", "", sessao).students], [3, 2], "so audience nao apagada: equipe, roteiro e Assistente fora");
  assert.deepEqual([linha(rows, "question", "answered", sessao).total, linha(rows, "question", "open", sessao).total], [1, 1]);
  assert.deepEqual([linha(rows, "reactions", "", sessao).total, linha(rows, "reactions", "", sessao).students], [2, 1], "a reacao do produtor fora");
  assert.equal(linha(rows, "poll_answers", "", sessao).total, 1);
  assert.equal(linha(rows, "replay_viewers", "", sessao).total, 1, "a aluna expirada viu o replay; o produtor nao conta");
  assert.equal(linha(rows, "visitors", "", sessao).total, 2, "webinar_joined da aluna e do aluno sem acesso; o do produtor fora");
  assert.equal(daSessao(rows, sessao).filter((row) => row.metric.startsWith("sim_") || row.metric.startsWith("offer")).length, 0, "a live nunca tem Simulacao nem Oferta");

  assert.deepEqual(doPeriodo(rows), {
    unique_attended_registered: 1,
    unique_buyers: 0,
    unique_clickers: 0,
    unique_commenters: 2,
    unique_offer_seen: 0,
    unique_present: 2,
    unique_reached_end: 1,
    unique_registered: 2,
    unique_replay_viewers: 1,
    unique_visitors: 2
  });
});

test("2. a conversao pela venda real da Hotmart: o job liga o ULTIMO clique antes da venda em ate 7 dias, uma venda nunca converte dois cliques, 8 dias depois nao converte e o job de novo nao muda nada", async () => {
  // A Hotmart conectada e o codigo ligado ao curso que ninguem comprou (o produto da Oferta).
  actAs(produtor);
  const conectada = await salesActions.saveSalesSecret({ provider: "hotmart", secret: HOTMART.token });
  assert.equal(conectada.ok, true, JSON.stringify(conectada));
  await ligarProdutoNaHotmart(db, { codigo: HOTMART.codigo, produtoId: PRODUTO });
  actAs(null);

  // Os cliques ficam antes da venda: a aluna clicou ha 6 dias e 20 h e de novo ha 2 dias; o aluno sem acesso, ha 8 dias.
  const agora = Date.now();
  unwrap(
    await db.from("webinar_offer_clicks").insert([
      { click_token: "teste-v4-clique-aluna-antigo", clicked_at: new Date(agora - 6 * DIA_MS - 20 * 3_600_000).toISOString(), offer_id: GRAVADA.ofertaId, offset_ms: 70_000, session_id: GRAVADA.sessaoId, user_id: aluna.id, variant_label: varianteDe(aluna) },
      { click_token: "teste-v4-clique-aluna-ultimo", clicked_at: new Date(agora - 2 * DIA_MS).toISOString(), offer_id: GRAVADA.ofertaId, offset_ms: 80_000, session_id: GRAVADA.sessaoId, user_id: aluna.id, variant_label: varianteDe(aluna) },
      { click_token: "teste-v4-clique-aluno-de-8-dias", clicked_at: new Date(agora - 8 * DIA_MS).toISOString(), offer_id: GRAVADA.ofertaId, offset_ms: 90_000, session_id: GRAVADA.sessaoId, user_id: alunoSemAcesso.id, variant_label: varianteDe(alunoSemAcesso) }
    ]),
    "Gravando os cliques"
  );

  // As vendas so vem do webhook (sale_grants), com o valor em webhook_events (M8).
  for (const [comprador, id, transacao] of [
    [contas.aluna, "aluna", "HP-TESTE-V4-ALUNA"],
    [contas.alunoSemAcesso, "aluno", "HP-TESTE-V4-ALUNO"]
  ]) {
    const venda = await postarNaHotmart(compraNaHotmart({ comprador, id, transacao }));
    assert.equal(venda.status, 200, JSON.stringify(venda.body));
    assert.equal(venda.body.outcome, "access_granted", JSON.stringify(venda.body));
  }
  const vendas = unwrap(await db.from("sale_grants").select("id, user_id, product_id, webhook_event_id").like("transaction_id", "HP-TESTE-V4-%"), "Lendo as vendas");
  assert.deepEqual(vendas.map((venda) => venda.product_id), [PRODUTO, PRODUTO]);
  const evento = unwrap(await db.from("webhook_events").select("amount_cents, currency").eq("external_event_id", `${HOTMART.prefixo}aluna`).single(), "Lendo o evento da venda");
  assert.deepEqual([Number(evento.amount_cents), evento.currency], [159_790, "BRL"]);

  // Antes do job, nenhum clique tem compra (o clique nunca decide nada).
  const antes = unwrap(await db.from("webinar_offer_clicks").select("converted_sale_grant_id").eq("offer_id", GRAVADA.ofertaId), "Lendo os cliques");
  assert.ok(antes.every((clique) => clique.converted_sale_grant_id === null));

  const tick = await runJobsTick({ jobs: [webinarOfferConversionsJob], supabase: db });
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  assert.ok(tick.ran.includes(WEBINAR_OFFER_CONVERSIONS_JOB_NAME));

  const cliques = unwrap(await db.from("webinar_offer_clicks").select("click_token, converted_sale_grant_id, converted_at").eq("offer_id", GRAVADA.ofertaId), "Lendo os cliques");
  const doToken = Object.fromEntries(cliques.map((clique) => [clique.click_token, clique]));
  const vendaDaAluna = vendas.find((venda) => venda.user_id === aluna.id);
  assert.equal(doToken["teste-v4-clique-aluna-ultimo"].converted_sale_grant_id, vendaDaAluna.id, "o ultimo clique antes da venda");
  assert.ok(doToken["teste-v4-clique-aluna-ultimo"].converted_at);
  assert.equal(doToken["teste-v4-clique-aluna-antigo"].converted_sale_grant_id, null, "uma venda nao converte dois cliques");
  assert.equal(doToken["teste-v4-clique-aluno-de-8-dias"].converted_sale_grant_id, null, "8 dias depois do clique, a venda nao conta (attribution_days = 7)");

  const corridas = unwrap(await db.from("job_runs").select("metadata").eq("job", WEBINAR_OFFER_CONVERSIONS_JOB_NAME).gte("started_at", INICIO), "Lendo job_runs");
  assert.ok(
    corridas.some((corrida) => (corrida.metadata?.webinar_offer_conversions?.converted ?? 0) >= 1),
    `a contagem do job em job_runs: ${JSON.stringify(corridas.map((corrida) => corrida.metadata))}`
  );

  // O mesmo minuto entregue de novo: nada muda.
  assert.equal(unwrap(await db.rpc("webinar_offer_conversions", { p_limit: 500, p_now: new Date().toISOString() }), "Rodando de novo"), 0);
  const depois = unwrap(await db.from("webinar_offer_clicks").select("click_token, converted_sale_grant_id").eq("offer_id", GRAVADA.ofertaId), "Lendo os cliques");
  assert.deepEqual(
    depois.filter((clique) => clique.converted_sale_grant_id).map((clique) => clique.click_token),
    ["teste-v4-clique-aluna-ultimo"]
  );

  // Uma segunda venda do mesmo produto (outro pedido): o ultimo clique antes dela ja converteu, entao ela nao desce
  // para o clique mais antigo, ainda dentro dos 7 dias (revisao da fase 4, 202610290010).
  const segunda = await postarNaHotmart(compraNaHotmart({ comprador: contas.aluna, id: "aluna-segunda", transacao: "HP-TESTE-V4-ALUNA-2" }));
  assert.equal(segunda.status, 200, JSON.stringify(segunda.body));
  assert.equal(unwrap(await db.rpc("webinar_offer_conversions", { p_limit: 500, p_now: new Date().toISOString() }), "Rodando depois da segunda venda"), 0);
  const aposSegunda = unwrap(await db.from("webinar_offer_clicks").select("click_token, converted_sale_grant_id").eq("offer_id", GRAVADA.ofertaId), "Lendo os cliques");
  assert.equal(aposSegunda.find((clique) => clique.click_token === "teste-v4-clique-aluna-antigo").converted_sale_grant_id, null, "o clique antigo nao vira compra da segunda venda");
});

test("3. webinar_panel('simulated'): o resumo congelado, a Oferta com a venda real e o bloco Simulacao separado, nunca somado nos presentes; a sessao fora do periodo fica de fora", async () => {
  const rows = await fetchWebinarPanel(db, { ...PERIODO, kind: "simulated" });
  const sessao = GRAVADA.sessaoId;
  const daAluna = varianteDe(aluna);
  const doAluno = varianteDe(alunoSemAcesso);

  assert.deepEqual([...new Set(rows.filter((row) => row.sessionId).map((row) => row.sessionId))], [sessao], "a sessao de maio fica fora do periodo");
  assert.equal(linha(rows, "duration", "", sessao).total, 600_000, "a duracao da gravacao");
  assert.deepEqual([linha(rows, "present", "", sessao).total, linha(rows, "watch_sum", "", sessao).total, linha(rows, "reached_end", "", sessao).total], [3, 810, 1], "do resumo: 600 + 150 + 60 s; o produtor fora");
  const pico = rows.find((row) => row.metric === "peak" && row.sessionId === sessao);
  assert.deepEqual([pico?.item, pico?.total], ["0", 3], "da curva congelada");
  assert.deepEqual(
    ["0", "10", "25", "100"].map((ponto) => linha(rows, "retention", ponto, sessao)?.total),
    [3, 2, 1, 1]
  );
  assert.equal(linha(rows, "messages", "", sessao).total, 1, "o roteiro nao e mensagem de aluno");

  // A Oferta: viram = presentes nos baldes 2 a 5 (a aluna e a expirada; o aluno sem acesso saiu no balde 1).
  assert.deepEqual([linha(rows, "offer_seen", "", sessao).total, linha(rows, "offer_seen", "", sessao).students], [2, 2]);
  assert.deepEqual([linha(rows, "offer_clicks", "", sessao).total, linha(rows, "offer_clicks", "", sessao).students], [3, 2]);
  assert.deepEqual([linha(rows, "offer_purchases", "", sessao).total, linha(rows, "offer_purchases", "", sessao).students], [1, 1]);
  assert.deepEqual([linha(rows, "offer_revenue", "BRL", sessao).total, linha(rows, "offer_revenue", "BRL", sessao).students], [159_790, 1], "o valor do webhook, uma venda");
  const cliquesPorVariante = { [daAluna]: 2 };
  cliquesPorVariante[doAluno] = (cliquesPorVariante[doAluno] ?? 0) + 1;
  for (const [rotulo, total] of Object.entries(cliquesPorVariante)) {
    assert.equal(linha(rows, "offer_variant", `${rotulo}:clicks`, sessao)?.total, total, `cliques na variante ${rotulo}`);
  }
  assert.equal(linha(rows, "offer_variant", `${daAluna}:purchases`, sessao)?.total, 1, "a compra cai na variante da aluna");
  const viramPorVariante = {};
  for (const user of [aluna, expirada]) {
    const rotulo = varianteDe(user);
    viramPorVariante[rotulo] = (viramPorVariante[rotulo] ?? 0) + 1;
  }
  for (const [rotulo, total] of Object.entries(viramPorVariante)) {
    assert.equal(linha(rows, "offer_variant", `${rotulo}:seen`, sessao)?.total, total, `viram a variante ${rotulo}`);
  }

  // O bloco Simulacao: so do simulation_summary e do roteiro; nunca entra em presentes, pico ou mensagens.
  assert.deepEqual(
    [linha(rows, "sim_counter", "max", sessao).total, linha(rows, "sim_joins", "shown", sessao).total, linha(rows, "sim_sales", "shown", sessao).total, linha(rows, "sim_script", "fired", sessao).total],
    [240, 18, 2, 2]
  );
  assert.deepEqual(
    daSessao(rows, sessao)
      .filter((row) => row.metric.startsWith("sim_"))
      .map((row) => row.students),
    [0, 0, 0, 0],
    "o bloco nao conta alunos"
  );

  assert.deepEqual(doPeriodo(rows), {
    unique_attended_registered: 0,
    unique_buyers: 1,
    unique_clickers: 2,
    unique_commenters: 1,
    unique_offer_seen: 2,
    unique_present: 3,
    unique_reached_end: 1,
    unique_registered: 0,
    unique_replay_viewers: 0,
    unique_visitors: 0
  });

  // 'all' (a lista do admin): o mesmo aluno nas duas sessoes conta uma vez; p_session_ids restringe as sessoes e os unicos.
  const todas = doPeriodo(await fetchWebinarPanel(db, { ...PERIODO, kind: "all" }));
  assert.deepEqual([todas.unique_present, todas.unique_commenters, todas.unique_registered, todas.unique_reached_end], [3, 3, 2, 1]);
  const soALive = await fetchWebinarPanel(db, { ...PERIODO, kind: "all", sessionIds: [AO_VIVO.sessaoId] });
  assert.equal(daSessao(soALive, sessao).length, 0, "a gravada fica fora com o filtro");
  assert.deepEqual([doPeriodo(soALive).unique_present, doPeriodo(soALive).unique_clickers], [2, 0]);
});

test("4. webinar_report da sessao gravada: offer, offer_revenue e o bloco sim_* sem mexer em unique, chat_total e nas vagas", async () => {
  const rows = await fetchWebinarReport(db, GRAVADA.sessaoId);
  assert.equal(linha(rows, "unique").total, 3, "o resumo por aluno, sem a equipe nem o contador simulado");
  assert.equal(linha(rows, "chat_total").total, 1, "o roteiro fica fora das mensagens");
  assert.deepEqual([linha(rows, "offer", "seen").total, linha(rows, "offer", "clicks").total, linha(rows, "offer", "purchases").total], [2, 3, 1]);
  assert.equal(linha(rows, "offer", `${varianteDe(aluna)}:purchases`).students, 1);
  assert.deepEqual([linha(rows, "offer_revenue", "BRL").total, linha(rows, "offer_revenue", "BRL").students], [159_790, 1]);
  assert.deepEqual(
    [linha(rows, "sim_counter", "max").total, linha(rows, "sim_joins", "shown").total, linha(rows, "sim_sales", "shown").total],
    [240, 18, 2]
  );
  assert.deepEqual([linha(rows, "sim_script", "ready").total, linha(rows, "sim_script", "fired").total, linha(rows, "sim_script", "missed").total], [2, 2, 0]);

  const daLive = await fetchWebinarReport(db, AO_VIVO.sessaoId);
  assert.equal(daLive.filter((row) => row.metric.startsWith("sim_counter") || row.metric.startsWith("offer")).length, 0, "a live nao tem Oferta nem contador simulado");
});

test("5. webinar_offer_variant e offerVariantFor dao a mesma variante (md5(user_id || offer_id), pesos, a desligada nunca sai) para 40 contas", async () => {
  unwrap(await db.from("webinars").insert({ created_by: produtor.id, id: VARIANTES.id, kind: "simulated", slug: VARIANTES.slug, status: "draft", title: "Variantes de teste v4" }), "Gravando o webinario das variantes");
  unwrap(
    await db.from("webinar_offers").insert({ id: VARIANTES.ofertaId, product_id: PRODUTO, status: "active", title: "Pesos", trigger_kind: "manual", webinar_id: VARIANTES.id }),
    "Gravando a oferta das variantes"
  );
  const variantes = [
    { enabled: true, label: "A", weight: 3 },
    { enabled: true, label: "B", weight: 1 },
    { enabled: false, label: "C", weight: 50 },
    { enabled: true, label: "D", weight: 2 }
  ];
  unwrap(
    await db
      .from("webinar_offer_variants")
      .insert(variantes.map((variante) => ({ ...variante, checkout_url: `https://checkout.bunker707.test/${variante.label.toLowerCase()}`, headline: `Variante ${variante.label}`, offer_id: VARIANTES.ofertaId }))),
    "Gravando as variantes com pesos"
  );

  const usuarios = [...pessoas, ...Array.from({ length: 35 }, () => randomUUID())];
  const vistas = new Set();
  for (const userId of usuarios) {
    const noBanco = await varianteNoBanco(userId, VARIANTES.ofertaId);
    const noApp = offerVariantFor({ offerId: VARIANTES.ofertaId, userId, variants: variantes })?.label;
    assert.equal(noBanco, noApp, `a mesma variante para ${userId}`);
    assert.notEqual(noBanco, "C", "a variante desligada nunca sai");
    vistas.add(noBanco);
  }
  assert.ok(vistas.size >= 2, `as contas se dividem entre as variantes ligadas: ${[...vistas].join(", ")}`);
  assert.equal(await varianteNoBanco(aluna.id, GRAVADA.ofertaId), varianteDe(aluna), "a da Oferta da sessao tambem");
});

test("6. webinar_follow_up_facts: vaga, compareceu, replay, viu o card, saiu antes dele, clicou e comprou, por aluno e webinario, sem a equipe", async () => {
  const fatos = await fetchWebinarFollowUpFacts(db, [AO_VIVO.id, GRAVADA.id]);
  const de = (webinarId, user) => fatos.find((fato) => fato.webinarId === webinarId && fato.userId === user.id);
  const sinais = (fato) => fato && [fato.registered, fato.attended, fato.watchedReplay, fato.offerSeen, fato.leftBeforeOffer, fato.clicked, fato.purchased];

  assert.ok(!fatos.some((fato) => fato.userId === produtor.id || fato.userId === professor.id), "a equipe nunca entra");
  //                                                                    vaga   veio   replay viu    saiu   clicou comprou
  assert.deepEqual(sinais(de(AO_VIVO.id, aluna)), [true, true, false, false, false, false, false]);
  assert.deepEqual(sinais(de(AO_VIVO.id, alunoSemAcesso)), [false, true, false, false, false, false, false], "a vaga cancelada nao conta");
  assert.deepEqual(sinais(de(AO_VIVO.id, expirada)), [true, false, true, false, false, false, false]);
  assert.deepEqual(sinais(de(GRAVADA.id, aluna)), [false, true, false, true, false, true, true]);
  assert.deepEqual(sinais(de(GRAVADA.id, alunoSemAcesso)), [false, true, false, false, true, true, false], "saiu no balde 1, antes da oferta (balde 2): clicou e nao comprou");
  assert.deepEqual(sinais(de(GRAVADA.id, expirada)), [false, true, false, true, false, false, false]);
});

test("7. so a service_role: o aluno logado recebe 42501 em webinar_panel, webinar_offer_variant, webinar_offer_conversions, webinar_follow_up_facts e nas tabelas da Oferta", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const [nome, args] of [
    ["webinar_panel", { p_end: PERIODO.end, p_kind: "all", p_session_ids: null, p_start: PERIODO.start }],
    ["webinar_offer_variant", { p_offer_id: GRAVADA.ofertaId, p_user_id: aluna.id }],
    ["webinar_offer_conversions", { p_limit: 500, p_now: new Date().toISOString() }],
    ["webinar_follow_up_facts", { p_webinar_ids: [GRAVADA.id] }]
  ]) {
    const negado = await cliente.rpc(nome, args);
    assert.equal(negado.error?.code, "42501", `${nome}: ${JSON.stringify(negado.error)}`);
  }

  for (const tabela of ["webinar_offers", "webinar_offer_variants", "webinar_offer_displays", "webinar_offer_clicks"]) {
    const leitura = await cliente.from(tabela).select("*").limit(1);
    assert.equal(leitura.error?.code, "42501", `${tabela}: ${JSON.stringify(leitura.error)}`);
  }
  const gravar = await cliente
    .from("webinar_offer_clicks")
    .insert({ click_token: "teste-v4-clique-do-navegador", offer_id: GRAVADA.ofertaId, offset_ms: 0, session_id: GRAVADA.sessaoId, user_id: aluna.id, variant_label: "A" });
  assert.equal(gravar.error?.code, "42501", JSON.stringify(gravar.error));

  await cliente.auth.signOut();
  assert.equal(unwrap(await db.from("webinar_offer_clicks").select("id").eq("click_token", "teste-v4-clique-do-navegador"), "Conferindo").length, 0, "nada gravado");
});

test("8. a revisao da fase 4: Viram a oferta nao depende das amostras podadas; o reembolso tira a compra, a receita e o follow-up, e a oferta volta para a aluna", async () => {
  const { hasConvertedOfferClick } = await import("../../src/server/webinars/offer-store.ts");
  const sessao = GRAVADA.sessaoId;

  // A poda de 90 dias (prune_webinar_history) apaga as amostras da sessao encerrada: o congelado segura o numero.
  unwrap(await db.from("webinar_presence_samples").delete().eq("session_id", sessao), "Apagando as amostras (a poda)");
  const semAmostras = await fetchWebinarPanel(db, { ...PERIODO, kind: "simulated" });
  assert.deepEqual([linha(semAmostras, "offer_seen", "", sessao).total, linha(semAmostras, "offer_seen", "", sessao).students], [2, 2], "a aluna e a expirada, sem o produtor");
  const relatorio = await fetchWebinarReport(db, sessao);
  assert.equal(relatorio.find((row) => row.metric === "offer" && row.item === "seen")?.total, 2);

  // O reembolso da Hotmart fecha o sale_grants (closed_by refund): compra, receita e "comprou" deixam de contar.
  assert.equal(await hasConvertedOfferClick(db, { offerId: GRAVADA.ofertaId, userId: aluna.id }), true, "antes do reembolso, a aluna comprou");
  const reembolso = compraNaHotmart({ comprador: contas.aluna, id: "aluna-reembolso", transacao: "HP-TESTE-V4-ALUNA" });
  reembolso.event = "PURCHASE_REFUNDED";
  reembolso.data.purchase.status = "REFUNDED";
  const resposta = await postarNaHotmart(reembolso);
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const venda = unwrap(await db.from("sale_grants").select("closed_by").eq("transaction_id", "HP-TESTE-V4-ALUNA").single(), "Lendo a venda reembolsada");
  assert.equal(venda.closed_by, "refund");

  const depois = await fetchWebinarPanel(db, { ...PERIODO, kind: "simulated" });
  assert.equal(linha(depois, "offer_purchases", "", sessao)?.total ?? 0, 0, "a compra reembolsada nao conta");
  assert.equal(linha(depois, "offer_revenue", "BRL", sessao)?.total ?? 0, 0, "nem a receita");
  assert.equal(doPeriodo(depois).unique_buyers, 0);
  const relatorioDepois = await fetchWebinarReport(db, sessao);
  assert.equal(relatorioDepois.find((row) => row.metric === "offer" && row.item === "purchases")?.total ?? 0, 0);
  const fatos = await fetchWebinarFollowUpFacts(db, [GRAVADA.id]);
  assert.equal(fatos.find((fato) => fato.userId === aluna.id)?.purchased ?? false, false, "o follow-up 'comprou' tambem");
  assert.equal(await hasConvertedOfferClick(db, { offerId: GRAVADA.ofertaId, userId: aluna.id }), false, "a oferta volta para quem perdeu o acesso");
});
