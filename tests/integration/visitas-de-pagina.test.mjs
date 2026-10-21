import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { definirCabecalhosDoPedido } from "../support/integration-next-headers.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Visitas das paginas da area do aluno (Comunicacao v2, docs/23 §5.2) contra o banco LOCAL de verdade.
// As paginas .tsx nao carregam no Node (o carregador so tira os tipos), entao trackMemberPageVisit e
// chamada direto, como cada pagina chama (a chamada nas 10 paginas fica em
// tests/visitas-de-pagina.guard.test.mjs). Fora de um pedido do Next, after() lanca e a gravacao roda na
// hora; settlePageVisits() espera por ela. O relogio do registro e simulado por `now` (a trava de 10 s
// fica na memoria do processo). So grava para pagina que um fluxo ativo ou pausado acompanha; nunca
// para a equipe, no "ver como" ou num prefetch do Next; e a rota do beacon confere a chave.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { PAGE_VISIT_THROTTLE_MS, settlePageVisits, trackMemberPageVisit } = await import("../../src/server/member-area/page-visits.ts");
const pageVisitsRoute = await import("../../src/app/api/page-visits/route.ts");

const { curso, cursoBloqueado } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const SEGUNDO = 1000;
const HORA = 60 * 60 * SEGUNDO;
const PAGINA_DO_CURSO = `content:${curso.id}`;
const COMPRAR_O_BLOQUEADO = `checkout:${cursoBloqueado.id}`;

// Cada teste usa a propria hora (bem separadas), para a trava de um nao valer no outro.
let horaDoTeste = Date.now();

function novaHora() {
  horaDoTeste += 10 * HORA;
  return horaDoTeste;
}

async function fluxo({ deletedAt = null, keys, status = "active" }) {
  const ended = status === "ended";

  return unwrap(
    await db
      .from("communication_flows")
      .insert({
        created_by: contas.produtor.id,
        deleted_at: deletedAt,
        ended_at: ended ? new Date().toISOString() : null,
        ended_reason: ended ? "finished" : null,
        name: `Fluxo de visitas (${status})`,
        status,
        watched_page_keys: keys
      })
      .select("id")
      .single(),
    "Criando o fluxo que acompanha as paginas"
  ).id;
}

async function visitas(userId) {
  return unwrap(
    await db.from("member_page_visits").select("page_key,first_visited_at,last_visited_at").eq("user_id", userId).order("page_key"),
    "Lendo as visitas"
  );
}

async function visitar(user, pageKey, at, extra = {}) {
  await trackMemberPageVisit({ now: new Date(at), pageKey, userId: user.id, ...extra });
  await settlePageVisits();
}

async function beacon(user, body, contentType = "text/plain;charset=UTF-8") {
  actAs(user);
  const response = await pageVisitsRoute.POST(
    new Request("http://localhost/api/page-visits", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": contentType },
      method: "POST"
    })
  );
  const text = await response.text();

  return { body: text ? JSON.parse(text) : null, headers: response.headers, status: response.status };
}

before(async () => {
  await limparComunicacao(db);
});

beforeEach(async () => {
  definirCabecalhosDoPedido(null);
  await limparComunicacao(db);
});

after(async () => {
  definirCabecalhosDoPedido(null);
  actAs(null);
  await limparComunicacao(db);
});

test("sem fluxo no ar acompanhando a pagina, a visita nao grava nada (nem rascunho, nem encerrado, nem excluido)", async () => {
  await visitar(aluna, PAGINA_DO_CURSO, novaHora());
  assert.deepEqual(await visitas(aluna.id), [], "nenhum fluxo");

  await fluxo({ keys: [PAGINA_DO_CURSO], status: "draft" });
  await fluxo({ keys: [PAGINA_DO_CURSO], status: "ended" });
  await fluxo({ deletedAt: new Date().toISOString(), keys: [PAGINA_DO_CURSO], status: "active" });
  await fluxo({ keys: ["purchases"], status: "active" });

  await visitar(aluna, PAGINA_DO_CURSO, novaHora());
  await visitar(aluna, null, novaHora());
  assert.deepEqual(await visitas(aluna.id), [], "so fluxo ativo ou pausado, e so a pagina que ele usa");
});

test("com um fluxo no ar usando content:X, a visita da aluna grava a primeira e a ultima visita; pausado tambem conta", async () => {
  await fluxo({ keys: [PAGINA_DO_CURSO, "home"], status: "active" });
  await fluxo({ keys: ["purchases"], status: "paused" });
  const hora = novaHora();

  await visitar(aluna, PAGINA_DO_CURSO, hora);
  await visitar(aluna, "purchases", hora + SEGUNDO);

  const gravadas = await visitas(aluna.id);
  assert.deepEqual(
    gravadas.map((visita) => [visita.page_key, Date.parse(visita.first_visited_at), Date.parse(visita.last_visited_at)]),
    [
      [PAGINA_DO_CURSO, hora, hora],
      ["purchases", hora + SEGUNDO, hora + SEGUNDO]
    ]
  );
  assert.deepEqual(await visitas(alunoSemAcesso.id), [], "so a aluna visitou");
});

test("equipe, \"ver como\" e prefetch do Next nao gravam visita", async () => {
  await fluxo({ keys: [PAGINA_DO_CURSO], status: "active" });

  await visitar(produtor, PAGINA_DO_CURSO, novaHora());
  await visitar(professor, PAGINA_DO_CURSO, novaHora());
  assert.deepEqual(await visitas(produtor.id), [], "produtor e equipe");
  assert.deepEqual(await visitas(professor.id), [], "professor e equipe");

  await visitar(aluna, PAGINA_DO_CURSO, novaHora(), { accessPreviewMode: "student_with_access" });
  assert.deepEqual(await visitas(aluna.id), [], "\"ver como\"");

  definirCabecalhosDoPedido({ "next-router-prefetch": "1" });
  await visitar(aluna, PAGINA_DO_CURSO, novaHora());
  definirCabecalhosDoPedido(null);
  assert.deepEqual(await visitas(aluna.id), [], "prefetch do Next");

  // O mesmo pedido sem prefetch grava (a trava nao foi gasta pelos casos acima).
  const hora = novaHora();
  await visitar(aluna, PAGINA_DO_CURSO, hora);
  assert.deepEqual((await visitas(aluna.id)).map((visita) => Date.parse(visita.last_visited_at)), [hora]);
});

test("a mesma visita so grava de novo depois de 10 s (recarga e redirecionamento); a primeira visita fica guardada", async () => {
  await fluxo({ keys: [PAGINA_DO_CURSO], status: "active" });
  const hora = novaHora();
  assert.equal(PAGE_VISIT_THROTTLE_MS, 10 * SEGUNDO);

  await visitar(aluna, PAGINA_DO_CURSO, hora);
  await visitar(aluna, PAGINA_DO_CURSO, hora + 5 * SEGUNDO);
  let [visita] = await visitas(aluna.id);
  assert.equal(Date.parse(visita.last_visited_at), hora, "5 s depois: dentro da trava, nada muda");

  // A notificacao ficou visivel 30 s depois e a aluna tocou no botao 50 s depois: essa visita conta.
  await visitar(aluna, PAGINA_DO_CURSO, hora + 50 * SEGUNDO);
  [visita] = await visitas(aluna.id);
  assert.equal(Date.parse(visita.last_visited_at), hora + 50 * SEGUNDO, "50 s depois: grava (o motor compara a hora exata)");
  assert.equal(Date.parse(visita.first_visited_at), hora, "a primeira visita nao muda");

  await visitar(aluna, PAGINA_DO_CURSO, hora + 61 * SEGUNDO);
  [visita] = await visitas(aluna.id);
  assert.equal(Date.parse(visita.last_visited_at), hora + 61 * SEGUNDO, "11 s depois da ultima: grava");

  // Outra aluna na mesma pagina tem a propria trava.
  await visitar(alunoSemAcesso, PAGINA_DO_CURSO, hora + 62 * SEGUNDO);
  assert.equal((await visitas(alunoSemAcesso.id)).length, 1);
});

test("rota /api/page-visits: sem sessao 401, chave fora de content:/checkout: 400, nao acompanhada 204 sem linha, acompanhada 204 e grava", async () => {
  await fluxo({ keys: [COMPRAR_O_BLOQUEADO], status: "active" });

  const semSessao = await beacon(null, { key: COMPRAR_O_BLOQUEADO });
  assert.equal(semSessao.status, 401);

  for (const corpo of [
    { key: "home" },
    { key: "content:" },
    { key: "content:a b" },
    { key: `checkout:${"x".repeat(241)}` },
    { key: "visita:teste" },
    { key: 42 },
    {},
    "nao e json"
  ]) {
    const resposta = await beacon(aluna, corpo);
    assert.equal(resposta.status, 400, JSON.stringify(corpo));
    assert.deepEqual(resposta.body, { error: "Pagina invalida." });
    assert.equal(resposta.headers.get("cache-control"), "private, no-store, max-age=0");
  }

  const naoAcompanhada = await beacon(aluna, { key: `content:${cursoBloqueado.id}` });
  await settlePageVisits();
  assert.equal(naoAcompanhada.status, 204);
  assert.equal(naoAcompanhada.body, null);
  assert.deepEqual(await visitas(aluna.id), [], "pagina que nenhum fluxo usa");

  const daEquipe = await beacon(produtor, { key: COMPRAR_O_BLOQUEADO });
  await settlePageVisits();
  assert.equal(daEquipe.status, 204);
  assert.deepEqual(await visitas(produtor.id), [], "equipe");

  const antes = Date.now();
  const comprar = await beacon(aluna, { key: COMPRAR_O_BLOQUEADO });
  await settlePageVisits();
  assert.equal(comprar.status, 204);
  assert.equal(comprar.headers.get("cache-control"), "private, no-store, max-age=0");

  const [clique] = await visitas(aluna.id);
  assert.equal(clique.page_key, COMPRAR_O_BLOQUEADO);
  assert.ok(Date.parse(clique.last_visited_at) >= antes - SEGUNDO, "hora do clique");

  // O mesmo clique logo depois cai na trava: 204 e a linha fica igual.
  const deNovo = await beacon(aluna, { key: COMPRAR_O_BLOQUEADO }, "application/json");
  await settlePageVisits();
  assert.equal(deNovo.status, 204);
  assert.deepEqual(await visitas(aluna.id), [clique]);
});
