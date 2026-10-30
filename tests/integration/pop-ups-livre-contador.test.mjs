import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Contador do Livre (L6f, docs/27 §13.13) contra o banco LOCAL: o rascunho salva sem fim nem data; publicar pede o
// fim do pop-up (no campo Termina) e a data no futuro (no campo do Contador); o show leva o fim do pop-up e a hora do
// servidor so quando o design tem Contador; o Contador ate o fim num pop-up que ficou sem fim some no aluno; retomar o
// pausado confere de novo (a data que passou durante a pausa e o fim tirado sao 422, com a frase).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { invalidateLivePopups } = await import("../../src/server/communications/cache.ts");
const { POPUP_FREE_MESSAGES: M } = await import("../../src/server/communications/popup-free-schema.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");

const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ACESSO = "teste-pop-ups-livre-contador:";
const HORA = 3_600_000;
const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Garantir a vaga", target: "same_tab" };
const iso = (time) => new Date(time).toISOString();

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
}

before(limpar);
after(limpar);

beforeEach(async () => {
  await limpar();
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${aluna.id}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: aluna.id
    }),
    "Liberando acesso de teste"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

/** O Livre de teste: titulo, o Contador (ate o fim do pop-up ou ate `ate`), o botao principal e os links. */
function livre({ ate = null, contador = true } = {}) {
  return {
    children: [
      { id: "titulo", lines: [[{ text: "As inscrições fecham em breve" }]], type: "heading" },
      ...(contador ? [{ id: "contador", type: "countdown", ...(ate ? { until: { at: ate, kind: "date" } } : {}) }] : []),
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
}

function popup({ endsAt = null, ...extra } = {}) {
  return {
    ...emptyNoticeDraft("popup"),
    audience: quemTemOProduto,
    body: "",
    cta: BOTAO,
    design: null,
    title: "Pop-up com contador",
    window: { endsAt, startsAt: null },
    ...extra
  };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function salvar(draft, id) {
  actAs(produtor);
  return ok(await actions.saveNoticeDraft(id ? { draft, id } : { draft }));
}

async function publicarSalvo(salvo) {
  actAs(produtor);
  return actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id });
}

async function mostrar(user, id) {
  actAs(user);
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify({ page: "home", trigger: "page_load" }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

async function mudarNoBanco(id, patch) {
  unwrap(await db.from("campaigns").update(patch).eq("id", id), "Mudando o aviso direto no banco");
  invalidateLivePopups({ from: "route" });
}

async function linha(id) {
  return unwrap(await db.from("campaigns").select("ends_at,popup_design,status,updated_at").eq("id", id).single(), "Lendo o aviso");
}

/* ------------------------------------------------------------------------------------------------
 * Publicar
 * ---------------------------------------------------------------------------------------------- */

test("o rascunho salva sem fim nem data; publicar pede o fim do pop-up e a data no futuro, cada um no seu campo", async () => {
  // Ate o fim do pop-up, sem fim: o rascunho salva; publicar e 400 no campo Termina.
  const semFim = await salvar(popup({ freeDesign: livre() }));
  const recusado = await publicarSalvo(semFim);

  assert.equal(recusado.status, 400);
  assert.deepEqual(recusado.fieldErrors?.["window.endsAt"], [M.countdownEnd]);
  assert.equal((await linha(semFim.id)).status, "draft");

  // Ate uma data que ja passou: 400 no campo do Contador (o editor abre a Data dele).
  const passou = await salvar(popup({ endsAt: iso(Date.now() + 48 * HORA), freeDesign: livre({ ate: iso(Date.now() - HORA) }) }));
  const recusadoData = await publicarSalvo(passou);

  assert.equal(recusadoData.status, 400);
  assert.deepEqual(recusadoData.fieldErrors?.["freeDesign.nodes.contador.until.at"], [M.countdownPast]);

  // Com o fim (ou com uma data no futuro), publica.
  const comFim = await salvar(popup({ endsAt: iso(Date.now() + 48 * HORA), freeDesign: livre() }));

  assert.equal(ok(await publicarSalvo(comFim)).situation, "active");

  const comData = await salvar(popup({ freeDesign: livre({ ate: iso(Date.now() + 6 * HORA) }), title: "Outro pop-up com contador" }));

  assert.equal(ok(await publicarSalvo(comData)).situation, "active", "a data do Contador não pede o fim do pop-up");
});

/* ------------------------------------------------------------------------------------------------
 * O aluno
 * ---------------------------------------------------------------------------------------------- */

test("o show leva o fim do pop-up e a hora do servidor só quando o design tem Contador", async () => {
  const fim = iso(Date.now() + 48 * HORA);
  const comContador = await salvar(popup({ endsAt: fim, freeDesign: livre() }));

  ok(await publicarSalvo(comContador));

  const antes = Date.now();
  const mostrado = await mostrar(aluna, comContador.id);
  const depois = Date.now();

  assert.equal(mostrado.status, 200);

  const item = mostrado.body.data.popup;

  assert.equal(Date.parse(item.endsAt), Date.parse(fim));
  assert.match(item.endsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(item.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(item.asOf) >= antes - 1000 && Date.parse(item.asOf) <= depois + 1000, "a hora do servidor, agora");
  assert.equal(item.freeDesign.children.find((node) => node.id === "contador").hidden, undefined, "com fim, o Contador aparece");

  // Sem Contador, a resposta e a de antes (nem o fim nem a hora).
  await limparComunicacao(db);

  const semContador = await salvar(popup({ endsAt: fim, freeDesign: livre({ contador: false }) }));

  ok(await publicarSalvo(semContador));

  const outro = (await mostrar(aluna, semContador.id)).body.data.popup;

  assert.equal("endsAt" in outro, false);
  assert.equal("asOf" in outro, false);
});

test("o Contador até o fim num pop-up que ficou sem fim some no aluno; o com data continua", async () => {
  const fim = iso(Date.now() + 48 * HORA);
  const ateOFim = await salvar(popup({ endsAt: fim, freeDesign: livre() }));

  ok(await publicarSalvo(ateOFim));

  // O fim sai direto no banco (dado de antes, ou mudado fora do editor): o aluno nunca ve um Contador sem alvo.
  await mudarNoBanco(ateOFim.id, { ends_at: null });

  const item = (await mostrar(aluna, ateOFim.id)).body.data.popup;

  assert.equal(item.endsAt, null);
  assert.equal(item.freeDesign.children.find((node) => node.id === "contador").hidden, true);
  assert.ok(item.freeDesign.children.some((node) => node.id === "botao"), "o resto do pop-up continua");

  // O Contador com data nao depende do fim do pop-up: continua (cada pop-up abre uma vez, por isso outro).
  await limparComunicacao(db);

  const comData = await salvar(popup({ endsAt: fim, freeDesign: livre({ ate: iso(Date.now() + 6 * HORA) }) }));

  ok(await publicarSalvo(comData));
  await mudarNoBanco(comData.id, { ends_at: null });

  const outro = (await mostrar(aluna, comData.id)).body.data.popup;

  assert.equal(outro.endsAt, null);
  assert.equal(outro.freeDesign.children.find((node) => node.id === "contador").hidden, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * Retomar
 * ---------------------------------------------------------------------------------------------- */

test("retomar confere de novo: a data que passou durante a pausa e o fim tirado são 422; corrigido, retoma", async () => {
  const salvo = await salvar(popup({ freeDesign: livre({ ate: iso(Date.now() + 6 * HORA) }) }));

  ok(await publicarSalvo(salvo));
  actAs(produtor);
  ok(await actions.pauseNotice({ id: salvo.id }));

  // A data do Contador passou durante a pausa.
  const gravado = (await linha(salvo.id)).popup_design;
  const comData = (at) => ({ ...gravado, children: gravado.children.map((node) => (node.id === "contador" ? { ...node, until: { at, kind: "date" } } : node)) });

  await mudarNoBanco(salvo.id, { popup_design: comData(iso(Date.now() - HORA)) });
  actAs(produtor);

  const passou = await actions.resumeNotice({ id: salvo.id });

  assert.equal(passou.status, 422);
  assert.equal(passou.error, M.countdownPast);
  assert.equal((await linha(salvo.id)).status, "paused");

  // Ate o fim do pop-up, num pop-up sem fim.
  const ateOFim = { ...gravado, children: gravado.children.map((node) => (node.id === "contador" ? { id: "contador", type: "countdown" } : node)) };

  await mudarNoBanco(salvo.id, { ends_at: null, popup_design: ateOFim });
  actAs(produtor);

  const semFim = await actions.resumeNotice({ id: salvo.id });

  assert.equal(semFim.status, 422);
  assert.equal(semFim.error, M.countdownEnd);

  // Com o fim no futuro, retoma.
  await mudarNoBanco(salvo.id, { ends_at: iso(Date.now() + 48 * HORA) });
  actAs(produtor);
  assert.equal(ok(await actions.resumeNotice({ id: salvo.id })).situation, "active");
});
