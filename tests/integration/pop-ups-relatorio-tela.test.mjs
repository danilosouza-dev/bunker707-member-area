import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Relatorio do pop-up na tela (docs/29 §2.6 e §4.6; spec §7.3 R) contra o banco LOCAL de verdade: getPopupReport le a
// RPC communication_popup_report (202610260001) e os nomes dos produtos citados e devolve o relatorio pronto
// (os quatro numeros, onde apareceu com "Por produto", em que momento, como fecharam e as faixas). As aberturas
// e o fechamento saem pelas rotas do aluno (como o navegador). As linhas cruas da funcao estao em
// tests/integration/pop-ups-relatorio.test.mjs (frente S).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const queries = await import("../../src/server/communications/queries.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");
const eventsRoute = await import("../../src/app/api/popups/[id]/events/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const BASE = emptyNoticeDraft("popup");
const SEM_LIMITE = { everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "never" };

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function publicar() {
  actAs(produtor);
  const draft = {
    ...BASE,
    audience: { kind: "everyone" },
    body: "Relatório na tela.",
    cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" },
    popup: { ...BASE.popup, frequency: SEM_LIMITE, pages: ["saved", "lesson:*"] },
    repeat: "until_action",
    title: "Relatório na tela"
  };
  const salvo = ok(await actions.saveNoticeDraft({ draft }));

  return ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
}

async function chamar(route, id, path, body, contentType = "application/json") {
  actAs(aluna);
  const response = await route.POST(new Request(`http://localhost/api/popups/${id}/${path}`, { body: JSON.stringify(body), headers: { "content-type": contentType }, method: "POST" }), {
    params: Promise.resolve({ id })
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
}

/** Passaram 10 s desde a ultima abertura (o mesmo pop-up nunca abre duas vezes em menos de 5 s). */
async function passaram(campaignId) {
  const linha = unwrap(await db.from("campaign_deliveries").select("last_seen_at").eq("campaign_id", campaignId).eq("user_id", aluna.id).single(), "Lendo");
  unwrap(
    await db
      .from("campaign_deliveries")
      .update({ last_seen_at: new Date(Date.parse(linha.last_seen_at) - 10_000).toISOString() })
      .eq("campaign_id", campaignId)
      .eq("user_id", aluna.id),
    "Voltando o relogio"
  );
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("student_events").delete().eq("user_id", aluna.id).eq("entity_type", "campaign"), "Apagando o historico dos avisos de teste");
}

before(limpar);
beforeEach(limpar);
after(async () => {
  await limpar();
  actAs(null);
});

test("getPopupReport: os números e os blocos do pop-up visto em Favoritos e na aula, com o nome do curso", async () => {
  const publicado = await publicar();

  // Favoritos (fecha no Esc), depois a aula do curso (sai sem o navegador avisar).
  await chamar(showRoute, publicado.id, "show", { page: "saved", trigger: "page_load" });
  await chamar(eventsRoute, publicado.id, "events", { event: "closed", via: "esc" }, "text/plain;charset=UTF-8");
  await passaram(publicado.id);
  await chamar(showRoute, publicado.id, "show", { page: `lesson:${curso.id}`, trigger: "page_load" });

  const resultado = await queries.getPopupReport(publicado.id);
  assert.equal(resultado.status, "ok", JSON.stringify(resultado));
  const { view } = resultado;

  assert.equal(view.empty, false);
  assert.deepEqual(
    view.kpis.map((kpi) => [kpi.label, kpi.value, kpi.definition]),
    [
      ["Vezes que apareceu", 2, "somando todos os alunos"],
      ["Alunos que viram", 1, "pelo menos 1 vez"],
      ["Viram mais de uma vez", 1, "100% de quem viu"],
      ["No máximo, para um aluno", 2, "em média 2,0 vezes por aluno; metade viu até 2"]
    ]
  );
  assert.deepEqual(
    view.pages.map((bar) => [bar.label, bar.total, bar.students, bar.percent]),
    [
      ["Páginas de aula", 1, 1, 50],
      ["Favoritos", 1, 1, 50]
    ],
    "empate: a ordem do menu"
  );
  assert.deepEqual(view.products, [{ id: curso.id, label: curso.titulo, students: 1, total: 1 }], "o nome do curso, lido do catalogo");
  assert.deepEqual(view.triggers.map((bar) => [bar.label, bar.total]), [["Ao abrir a página", 2]]);
  assert.deepEqual(
    view.outcomes.map((bar) => [bar.label, bar.total]),
    [
      ["Fecharam no Esc", 1],
      ["Sem registro", 1]
    ]
  );
  assert.deepEqual(view.times.map((bar) => [bar.label, bar.students]), [["2 vezes", 1]]);
});

test("getPopupReport: pop-up que ninguém viu (ou que não existe) volta vazio, sem erro", async () => {
  const publicado = await publicar();

  const visto = await queries.getPopupReport(publicado.id);
  assert.equal(visto.status, "ok");
  assert.equal(visto.view.empty, true);

  const outro = await queries.getPopupReport(randomUUID());
  assert.equal(outro.status, "ok");
  assert.equal(outro.view.empty, true);
});
