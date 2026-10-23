import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { actAs, actAsSignedIn, integrationSession } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Relatorio do pop-up (docs/29 §3.1 secao 4 e §8.3) contra o banco LOCAL de verdade: as linhas cruas da RPC
// communication_popup_report. As aberturas e os fechamentos saem pelas rotas do aluno (como o navegador); as
// linhas "de antes" e da equipe sao gravadas pela service role. Aqui: onde apareceu (tipo de pagina e produto),
// em que momento, como fecharam, quantas vezes cada aluno viu; a equipe fora; o insert forjado do aluno recusado
// pelo RLS (secao 5) e o teto pelas vezes da linha para as linhas de antes; evento sem pagina, momento ou jeito;
// e a RPC so para o service_role.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { fetchPopupReport } = await import("../../src/server/communications/store.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");
const eventsRoute = await import("../../src/app/api/popups/[id]/events/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const MARCA_AUTH = "teste_relatorio_popup";

const BASE = emptyNoticeDraft("popup");
const SEM_LIMITE = { everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "never" };

function popup(settings = {}, extra = {}) {
  const frequency = settings.frequency ?? SEM_LIMITE;

  return {
    ...BASE,
    audience: { kind: "everyone" },
    body: "Relatório do pop-up.",
    cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" },
    title: "Relatório",
    ...extra,
    popup: { ...BASE.popup, pages: ["saved", "lesson:*"], ...settings, frequency },
    repeat: frequency.mode === "once" ? "once" : "until_action"
  };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function publicar(draft) {
  actAs(produtor);
  const salvo = ok(await actions.saveNoticeDraft({ draft }));
  return ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
}

async function mostrar(user, id, page, trigger = "page_load") {
  actAs(user);
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify({ page, trigger }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
}

async function evento(user, id, body) {
  actAs(user);
  const response = await eventsRoute.POST(
    new Request(`http://localhost/api/popups/${id}/events`, { body: JSON.stringify(body), headers: { "content-type": "text/plain;charset=UTF-8" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
}

/** Passaram 10 s desde a ultima abertura (o mesmo pop-up nunca abre duas vezes em menos de 5 s). */
async function passaram(campaignId, userId) {
  const linha = unwrap(await db.from("campaign_deliveries").select("last_seen_at").eq("campaign_id", campaignId).eq("user_id", userId).single(), "Lendo");
  unwrap(
    await db
      .from("campaign_deliveries")
      .update({ last_seen_at: new Date(Date.parse(linha.last_seen_at) - 10_000).toISOString() })
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Voltando o relogio"
  );
}

/** As linhas da RPC como "metric|item" -> [total, students]. */
async function relatorio(campaignId) {
  return Object.fromEntries((await fetchPopupReport(db, campaignId)).map((row) => [`${row.metric}|${row.item}`, [row.total, row.students]]));
}

async function gravarComoServico(rows) {
  unwrap(await db.from("student_events").insert(rows), "Gravando o historico pela service role");
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(
    await db.from("student_events").delete().in("user_id", [aluna.id, alunoSemAcesso.id, produtor.id]).eq("entity_type", "campaign"),
    "Apagando o historico dos avisos de teste"
  );
  unwrap(await db.from("student_events").delete().eq("event_type", MARCA_AUTH), "Apagando o evento de auth do teste");
}

before(limpar);
beforeEach(limpar);
after(async () => {
  await limpar();
  actAs(null);
});

test("onde apareceu, em que momento, como fecharam e quantas vezes: das aberturas pelas rotas; a equipe nunca entra", async () => {
  const publicado = await publicar(popup());

  // Aluna: Favoritos (Esc), a aula do curso (X), Favoritos de novo (clique) = 3 vezes.
  await mostrar(aluna, publicado.id, "saved");
  await evento(aluna, publicado.id, { event: "closed", via: "esc" });
  await passaram(publicado.id, aluna.id);
  await mostrar(aluna, publicado.id, `lesson:${curso.id}`);
  await evento(aluna, publicado.id, { event: "closed", via: "x" });
  await passaram(publicado.id, aluna.id);
  await mostrar(aluna, publicado.id, "saved");
  await evento(aluna, publicado.id, { event: "clicked" });
  // Outro aluno: uma vez, sai sem o navegador avisar (sem resultado no historico).
  await mostrar(alunoSemAcesso, publicado.id, "saved");

  // A equipe com linha forcada e historico: nunca conta.
  unwrap(
    await db.from("campaign_deliveries").upsert({ campaign_id: publicado.id, eligible: true, impressions: 4, user_id: produtor.id }, { onConflict: "campaign_id,user_id" }),
    "Linha da equipe"
  );
  await gravarComoServico([
    { entity_id: publicado.id, entity_type: "campaign", event_type: "message_impressed", metadata: { campaign_id: publicado.id, page: "profile", trigger: "page_load" }, user_id: produtor.id }
  ]);

  const numeros = await relatorio(publicado.id);

  assert.deepEqual(numeros, {
    "max|": [3, 2],
    "median|": [1, 2],
    "opened_kind|lesson": [1, 1],
    "opened_kind|saved": [3, 2],
    "opened_product|teste-curso-agentes": [1, 1],
    "opened_trigger|page_load": [4, 2],
    "opened|": [4, 2],
    "outcome|clicked": [1, 1],
    "outcome|closed_esc": [1, 1],
    "outcome|closed_x": [1, 1],
    "outcomes|": [3, 1],
    "times|1": [1, 1],
    "times|3-5": [3, 1],
    "viewers|": [4, 2]
  });
});

test("o aluno nao grava linhas de avisos no proprio historico (RLS); as de antes ficam presas nas vezes da linha; quem nao viu nao conta", async () => {
  const visto = await publicar(popup({ pages: ["home"] }, { title: "Visto duas vezes" }));
  const naoVisto = await publicar(popup({ pages: ["home"] }, { title: "Nao visto" }));

  await actAsSignedIn(contas.aluna, SENHA_DE_TESTE);
  const cliente = integrationSession.supabase;
  const forjado = await cliente
    .from("student_events")
    .insert({ entity_id: visto.id, entity_type: "campaign", event_type: "message_impressed", metadata: { page: "home" }, user_id: contas.aluna.id });
  assert.ok(forjado.error, "o insert forjado e recusado");
  assert.match(forjado.error.message, /row-level security/);
  const doAuth = await cliente.from("student_events").insert({ entity_type: "auth", event_type: MARCA_AUTH, metadata: {}, user_id: contas.aluna.id });
  assert.equal(doAuth.error, null, "o historico de auth do navegador continua");

  const negado = await cliente.rpc("communication_popup_report", { p_campaign_id: visto.id });
  assert.equal(negado.error?.code, "42501", "so o service_role executa a funcao");
  actAs(null);

  // Linhas de antes da secao 5 (como se o aluno tivesse forjado), gravadas pela service role.
  unwrap(
    await db.from("campaign_deliveries").update({ impressions: 2, last_seen_at: new Date().toISOString() }).eq("campaign_id", visto.id).eq("user_id", aluna.id),
    "Linha de 2 vezes"
  );
  const cinco = Array.from({ length: 5 }, () => ({
    entity_id: visto.id,
    entity_type: "campaign",
    event_type: "message_impressed",
    metadata: { campaign_id: visto.id, page: "lesson:produto-forjado", trigger: "lesson_completed" },
    user_id: aluna.id
  }));
  await gravarComoServico([...cinco, ...cinco.map((row) => ({ ...row, entity_id: naoVisto.id, metadata: { campaign_id: naoVisto.id } }))]);

  const doVisto = await relatorio(visto.id);
  assert.deepEqual(doVisto["opened|"], [2, 1], "cinco aberturas com a linha de 2 vezes = 2");
  assert.deepEqual(doVisto["opened_product|produto-forjado"], [2, 1]);
  assert.deepEqual(doVisto["viewers|"], [2, 1]);

  const doNaoVisto = await relatorio(naoVisto.id);
  assert.deepEqual(doNaoVisto, { "max|": [0, 0], "median|": [0, 0], "viewers|": [0, 0] }, "sem linha vista, nada conta");
});

test("historico de antes da v3b-1: sem pagina = Inicio, sem momento = Ao abrir a pagina, fechar sem jeito = closed_unknown; valores fora da lista = other", async () => {
  const publicado = await publicar(popup({ pages: ["home"] }, { title: "Antigo" }));
  unwrap(
    await db.from("campaign_deliveries").update({ impressions: 3, last_seen_at: new Date().toISOString() }).eq("campaign_id", publicado.id).eq("user_id", aluna.id),
    "Linha de 3 vezes"
  );
  const base = { entity_id: publicado.id, entity_type: "campaign", user_id: aluna.id };
  await gravarComoServico([
    { ...base, event_type: "message_impressed", metadata: { campaign_id: publicado.id } },
    { ...base, event_type: "message_impressed", metadata: { campaign_id: publicado.id } },
    { ...base, event_type: "message_impressed", metadata: { campaign_id: publicado.id, page: "javascript:alert(1)", trigger: "exit_intent" } },
    { ...base, event_type: "message_closed", metadata: { campaign_id: publicado.id } },
    { ...base, event_type: "message_closed", metadata: { campaign_id: publicado.id, via: "teleporte" } },
    { ...base, event_type: "message_snoozed", metadata: { campaign_id: publicado.id } },
    { ...base, event_type: "message_dismissed", metadata: { campaign_id: publicado.id } }
  ]);

  const numeros = await relatorio(publicado.id);

  assert.deepEqual(numeros["opened_kind|home"], [2, 1]);
  assert.deepEqual(numeros["opened_kind|other"], [1, 1]);
  assert.deepEqual(numeros["opened_trigger|page_load"], [2, 1]);
  assert.deepEqual(numeros["opened_trigger|other"], [1, 1]);
  assert.deepEqual(numeros["outcome|closed_unknown"], [2, 1]);
  assert.deepEqual(numeros["outcome|snoozed"], [1, 1]);
  assert.deepEqual(numeros["outcome|dismissed"], [1, 1]);
  assert.deepEqual(numeros["outcomes|"], [3, 1], "cada linha limitada pelas vezes da linha");
  assert.equal(numeros["opened_product|javascript"], undefined, "pagina fora da lista nunca vira produto");
});

test("pagina conferida como POPUP_PAGE_KEY: id de produto com ate 240 caracteres; 241, dois pontos, curinga, maiuscula ou vazio = other", async () => {
  const publicado = await publicar(popup({ pages: ["home"] }, { title: "Paginas no limite" }));
  unwrap(
    await db.from("campaign_deliveries").update({ impressions: 10, last_seen_at: new Date().toISOString() }).eq("campaign_id", publicado.id).eq("user_id", aluna.id),
    "Linha de 10 vezes"
  );
  const limite = "a".repeat(240);
  const aberturas = [`lesson:${limite}`, `content:${"b".repeat(241)}`, "content:a:b", "lesson:*", "lesson:", "Home", "support", "content:produto_2-b"];
  await gravarComoServico(
    aberturas.map((page) => ({
      entity_id: publicado.id,
      entity_type: "campaign",
      event_type: "message_impressed",
      metadata: { campaign_id: publicado.id, page, trigger: "page_load" },
      user_id: aluna.id
    }))
  );

  const numeros = await relatorio(publicado.id);

  assert.deepEqual(numeros["opened|"], [8, 1]);
  assert.deepEqual(numeros["opened_kind|lesson"], [1, 1]);
  assert.deepEqual(numeros["opened_kind|content"], [1, 1]);
  assert.deepEqual(numeros["opened_kind|support"], [1, 1]);
  assert.deepEqual(numeros["opened_kind|other"], [5, 1], "241, dois pontos, curinga, vazio e maiuscula");
  assert.deepEqual(numeros[`opened_product|${limite}`], [1, 1], "240 caracteres ainda e produto");
  assert.deepEqual(numeros["opened_product|produto_2-b"], [1, 1]);
  assert.deepEqual(
    Object.keys(numeros).filter((key) => key.startsWith("opened_product|")).length,
    2,
    "so os dois ids validos viram produto"
  );
});
