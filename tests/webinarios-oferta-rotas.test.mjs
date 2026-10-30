import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  LIVE_SESSION,
  MIN,
  OFFER,
  OTHER_OFFER,
  OTHER_SESSION,
  OTHER_WEBINAR,
  PRODUCT,
  REPLAY,
  SESSION,
  WEBINAR,
  bancoDaOferta,
  escolaDaOferta,
  iso,
  offerRow,
  semAsTabelasDaOferta,
  variantRow
} from "./support/webinarios-v4-oferta-banco.mjs";

// As rotas da Oferta do aluno (docs/30 §1.6, §5.1, §8.6 e M7; docs/18 §2.2), sem banco: o banco da Oferta em memoria
// (tests/support/webinarios-v4-oferta-banco.mjs) e a sessao do aluno pelo teste. GET .../offer: 401 sem sessao, 400
// sem id ou sem ?sessao=, 404 para a sessao de outro webinario; a live e o banco sem a 202610300003 devolvem
// { offer: null }; antes do minuto a janela vem sem gravar nada; dentro dela a linha da sessao e gravada uma vez com a
// foto e o prazo real; quem ja tem o produto ou ja comprou nao recebe o card; rascunho, Nunca e o botao da equipe sem
// o Mostrar agora tambem nao; o replay grava a linha sem prazo. POST .../offer-click: o link do checkout da variante
// do aluno com ?b7=, o clique e o registro webinar_offer_clicked { offer_id, variant, offset_ms } (o offset do
// servidor na gravada, o do corpo no replay); a repeticao em 10 s devolve o mesmo link sem outro clique; 409
// offer_hidden fora da janela, com o prazo vencido ou na live; 409 banned; 404 a oferta de outro webinario; 429 no teto
// de 30 escritas por minuto; 400 corpo invalido e 413 corpo grande.

const sessao = (globalThis.__ofertaRotasSessao ??= { user: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__ofertaRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const offerRoute = await import("../src/app/api/webinars/[id]/offer/route.ts");
const clickRoute = await import("../src/app/api/webinars/[id]/offer-click/route.ts");
const { offerVariantFor } = await import("../src/server/webinars/offer-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

let proximoAluno = 300;

function novoAluno() {
  proximoAluno += 1;
  const id = `55555555-6666-4555-8555-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

function montar(options = {}) {
  const db = bancoDaOferta({ tables: escolaDaOferta(options) });
  actionStubs.db = db;
  return { db, userId: novoAluno() };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const json = async (response) => ({ body: await response.json(), headers: response.headers, status: response.status });
const ler = async (sessionId = SESSION, webinarId = WEBINAR) => json(await offerRoute.GET(new Request(`http://localhost/api/webinars/${webinarId}/offer?sessao=${sessionId}`), contexto(webinarId)));
const clicar = async (body, webinarId = WEBINAR) =>
  json(await clickRoute.POST(new Request(`http://localhost/api/webinars/${webinarId}/offer-click`, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" }), contexto(webinarId)));
const eventos = (db, type) => db.tables.student_events.filter((row) => row.event_type === type);
const variantes = [variantRow("A"), variantRow("B")];
const minhaVariante = (userId, rows = variantes) => offerVariantFor({ offerId: OFFER, userId, variants: rows.map((row) => ({ ...row, label: row.label, weight: row.weight })) });

/* ------------------------------------------------------------------------------------------------
 * Guardas
 * ---------------------------------------------------------------------------------------------- */

test("guardas: 401 sem sessao, 400 sem id ou sem ?sessao=, 404 sessao de outro webinario, 400 corpo invalido, 413 corpo grande", async () => {
  montar();
  sessao.user = null;
  assert.equal((await ler()).status, 401);
  assert.equal((await clicar({ offerId: OFFER, sessionId: SESSION })).status, 401);

  novoAluno();
  assert.equal((await json(await offerRoute.GET(new Request("http://localhost/api/webinars/x/offer?sessao=" + SESSION), contexto("nao-e-id")))).status, 400);
  assert.equal((await json(await offerRoute.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/offer`), contexto()))).status, 400, "sem ?sessao=");
  assert.equal((await ler(OTHER_SESSION)).status, 404, "a sessao e de outro webinario");
  assert.equal((await clicar({ offerId: OFFER, sessionId: OTHER_SESSION })).status, 404);
  assert.equal((await clicar({ offerId: "nao", sessionId: SESSION })).status, 400);
  const grande = await clickRoute.POST(
    new Request(`http://localhost/api/webinars/${WEBINAR}/offer-click`, { body: JSON.stringify({ offerId: OFFER, pad: "x".repeat(5000), sessionId: SESSION }), headers: { "content-type": "application/json" }, method: "POST" }),
    contexto()
  );
  assert.equal(grande.status, 413);
  assert.equal(grande.headers.get("cache-control"), "private, no-store, max-age=0");
});

/* ------------------------------------------------------------------------------------------------
 * GET .../offer
 * ---------------------------------------------------------------------------------------------- */

test("GET antes do minuto: a variante do aluno e a janela planejada, sem o link e sem gravar nada", async () => {
  const { db, userId } = montar({ minutosNoAr: 2 });
  const { body, status } = await ler();
  assert.equal(status, 200);
  const offer = body.data.offer;
  assert.equal(offer.offerId, OFFER);
  assert.equal(offer.variant, minhaVariante(userId).label);
  assert.equal(offer.showAtMs, 5 * MIN);
  assert.equal(offer.hideAtMs, 25 * MIN);
  assert.equal(offer.visible, false, "o servidor ainda nao chegou no minuto");
  assert.equal(body.data.pollMs, 60_000);
  assert.ok(Number.isFinite(Date.parse(body.data.serverTime)));
  assert.doesNotMatch(JSON.stringify(body), /hotmart|checkout|weight/i, "o link do checkout nunca sai no GET");
  assert.equal(db.tables.webinar_offer_displays.length, 0);
});

test("GET dentro da janela: grava a linha da sessao uma vez com a foto das variantes ligadas e o prazo real; le de novo sem gravar", async () => {
  const { db } = montar({ oferta: { deadline_minutes: 30 }, variantes: [variantRow("A"), variantRow("B", { enabled: false })] });
  const scheduled = Date.parse(db.tables.webinar_sessions.find((row) => row.id === SESSION).scheduled_at);
  const first = await ler();
  assert.equal(first.status, 200);
  assert.equal(first.body.data.offer.visible, true);
  assert.equal(first.body.data.offer.variant, "A", "so a A esta ligada");
  assert.equal(Date.parse(first.body.data.offer.deadlineAt), scheduled + 35 * MIN, "hora marcada + minuto 5 + 30 de prazo");
  assert.equal(first.body.data.pollMs, 20_000, "com o card na tela a sala rele mais vezes");

  const [row] = db.tables.webinar_offer_displays;
  assert.equal(db.tables.webinar_offer_displays.length, 1);
  assert.equal(row.session_id, SESSION);
  assert.equal(row.show_offset_ms, 5 * MIN);
  assert.equal(row.hide_offset_ms, 25 * MIN);
  assert.equal(row.shown_by, null, "foi o relogio, nao a equipe");
  assert.deepEqual(row.snapshot.variants.map((item) => item.label), ["A"]);
  assert.doesNotMatch(JSON.stringify(row.snapshot), /hotmart/);

  // Outro aluno, a oferta editada depois: a sessao continua com o que mostrou.
  db.tables.webinar_offers[0].visible_minutes = 1;
  novoAluno();
  const second = await ler();
  assert.equal(second.body.data.offer.hideAtMs, 25 * MIN);
  assert.equal(db.tables.webinar_offer_displays.length, 1, "uma linha por sessao");
  assert.equal(db.calls.writes.filter((write) => write.table === "webinar_offer_displays").length, 1);
});

test("GET: a live, quem ja tem o produto, quem ja comprou pela oferta, rascunho, Nunca e o banco sem a 202610300003 recebem { offer: null }", async () => {
  montar();
  assert.equal((await ler(LIVE_SESSION)).body.data.offer, null, "a sala ao vivo nunca tem card");

  const comProduto = montar();
  comProduto.db.tables.entitlements.push({
    created_at: iso(Date.now() - MIN),
    ends_at: null,
    id: "99999999-0000-4000-8000-000000000001",
    product_id: null,
    source_event_id: null,
    source_provider: "hotmart",
    starts_at: iso(Date.now() - MIN),
    status: "active",
    target_id: PRODUCT,
    target_type: "formation",
    updated_at: iso(Date.now() - MIN),
    user_id: comProduto.userId
  });
  assert.equal((await ler()).body.data.offer, null);

  const comprou = montar();
  comprou.db.tables.webinar_offer_clicks.push({ click_token: "x".repeat(24), clicked_at: iso(Date.now() - 86_400_000), converted_at: iso(Date.now()), converted_sale_grant_id: "77777777-0000-4000-8000-000000000001", id: "77777777-0000-4000-8000-000000000002", offer_id: OFFER, offset_ms: 0, session_id: LIVE_SESSION, user_id: comprou.userId, variant_id: null, variant_label: "A" });
  comprou.db.tables.sale_grants.push({ closed_at: null, closed_by: null, created_at: iso(Date.now()), id: "77777777-0000-4000-8000-000000000001", product_id: PRODUCT, user_id: comprou.userId });
  assert.equal((await ler()).body.data.offer, null, "comprou em qualquer sessao: o card some");
  // A assinatura cancelada foi venda de verdade: o card segue escondido.
  Object.assign(comprou.db.tables.sale_grants[0], { closed_at: iso(Date.now()), closed_by: "subscription_canceled" });
  assert.equal((await ler()).body.data.offer, null, "assinatura cancelada continua sendo compra");
  // Reembolso ou chargeback desfazem a venda: quem perdeu o acesso volta a ver a oferta (e pode comprar de novo).
  for (const closedBy of ["refund", "chargeback"]) {
    Object.assign(comprou.db.tables.sale_grants[0], { closed_by: closedBy });
    assert.notEqual((await ler()).body.data.offer, null, `${closedBy}: o card volta`);
  }

  montar({ oferta: { status: "draft" } });
  assert.equal((await ler()).body.data.offer, null);
  montar({ oferta: { trigger_kind: "never" } });
  assert.equal((await ler()).body.data.offer, null);
  montar({ variantes: [variantRow("A", { enabled: false })] });
  assert.equal((await ler()).body.data.offer, null, "sem variante ligada");
  montar({ oferta: false });
  assert.equal((await ler()).body.data.offer, null);

  const pendente = montar();
  semAsTabelasDaOferta(pendente.db);
  const { body, status } = await ler();
  assert.equal(status, 200);
  assert.equal(body.data.offer, null);
});

test("GET pelo botao da equipe: sem o Mostrar agora nada aparece e a sala rele em 20 s; com a linha do console, o card", async () => {
  const { db } = montar({ oferta: { show_at_offset_ms: null, trigger_kind: "manual" } });
  const waiting = await ler();
  assert.equal(waiting.body.data.offer, null);
  assert.equal(waiting.body.data.pollMs, 20_000);

  db.tables.webinar_offer_displays.push({ created_at: iso(Date.now()), deadline_at: null, hidden_at: null, hidden_by: null, hide_offset_ms: null, id: "88888888-0000-4000-8000-000000000001", offer_id: OFFER, session_id: SESSION, show_offset_ms: 9 * MIN, shown_at: iso(Date.now() - MIN), shown_by: "eeeeeeee-5555-4555-8555-555555555555", snapshot: {}, updated_at: iso(Date.now()) });
  const shown = await ler();
  assert.equal(shown.body.data.offer.visible, true);
  assert.equal(shown.body.data.offer.showAtMs, 9 * MIN);

  db.tables.webinar_offer_displays[0].hidden_at = iso(Date.now());
  db.tables.webinar_offer_displays[0].hide_offset_ms = 9 * MIN + 30_000;
  assert.equal((await ler()).body.data.offer, null, "escondida pela equipe");
});

test("GET no replay: a janela pelo minuto do video de cada aluno, a linha gravada sem prazo (cada aluno assiste numa hora)", async () => {
  const { db } = montar({ oferta: { deadline_minutes: 30 } });
  const { body } = await ler(REPLAY);
  assert.equal(body.data.offer.showAtMs, 5 * MIN);
  assert.equal(body.data.offer.visible, true, "no replay quem decide e o player");
  assert.equal(body.data.offer.deadlineAt, null);
  assert.equal(body.data.pollMs, 60_000);
  const [row] = db.tables.webinar_offer_displays;
  assert.equal(row.session_id, REPLAY);
  assert.equal(row.deadline_at, null);
});

/* ------------------------------------------------------------------------------------------------
 * POST .../offer-click
 * ---------------------------------------------------------------------------------------------- */

test("POST dentro da janela: o checkout da variante com ?b7=, o clique gravado e webinar_offer_clicked com o offset do servidor", async () => {
  const { db, userId } = montar();
  const variant = minhaVariante(userId);
  const { body, status } = await clicar({ offerId: OFFER, offsetMs: 1, sessionId: SESSION });
  assert.equal(status, 201);
  const url = new URL(body.data.url);
  assert.equal(`${url.origin}${url.pathname}`, `https://pay.hotmart.com/${variant.label}`);
  assert.equal(url.searchParams.get("off"), "lancamento", "o resto do link fica");
  const token = url.searchParams.get("b7");
  assert.match(token, /^[A-Za-z0-9_-]{24}$/);

  const [click] = db.tables.webinar_offer_clicks;
  assert.equal(click.click_token, token);
  assert.equal(click.user_id, userId);
  assert.equal(click.variant_label, variant.label);
  assert.equal(click.variant_id, variant.id);
  assert.ok(Math.abs(click.offset_ms - 10 * MIN) < 5_000, "o offset e o do relogio do servidor (o do corpo e ignorado)");

  const [event] = eventos(db, "webinar_offer_clicked");
  assert.equal(event.entity_type, "webinar");
  assert.equal(event.entity_id, SESSION);
  assert.deepEqual(Object.keys(event.metadata).sort(), ["offer_id", "offset_ms", "variant"]);
  assert.equal(event.metadata.offer_id, OFFER);
  assert.equal(event.metadata.variant, variant.label);
  assert.equal(event.metadata.offset_ms, click.offset_ms);
  assert.equal(db.tables.webinar_offer_displays.length, 1, "o clique tambem garante a linha do que a sessao mostrou");
});

test("POST repetido em 10 s devolve o mesmo link sem outro clique; depois disso, um token novo", async () => {
  const { db } = montar();
  const first = await clicar({ offerId: OFFER, sessionId: SESSION });
  const again = await clicar({ offerId: OFFER, sessionId: SESSION });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.url, first.body.data.url);
  assert.equal(db.tables.webinar_offer_clicks.length, 1);
  assert.equal(eventos(db, "webinar_offer_clicked").length, 1);

  db.tables.webinar_offer_clicks[0].clicked_at = iso(Date.now() - 11_000);
  const later = await clicar({ offerId: OFFER, sessionId: SESSION });
  assert.equal(later.status, 201);
  assert.notEqual(later.body.data.url, first.body.data.url);
  assert.equal(db.tables.webinar_offer_clicks.length, 2);
  assert.equal(eventos(db, "webinar_offer_clicked").length, 2);
});

test("POST fora da janela, com o prazo vencido, na live ou desligada: 409 offer_hidden e nada gravado", async () => {
  const antes = montar({ minutosNoAr: 2 });
  const early = await clicar({ offerId: OFFER, sessionId: SESSION });
  assert.equal(early.status, 409);
  assert.equal(early.body.reason, "offer_hidden");
  assert.equal(early.body.error, WEBINAR_COPY.oferta.aluno.foraDaTela);
  assert.equal(antes.db.tables.webinar_offer_clicks.length, 0);

  montar({ minutosNoAr: 30 });
  assert.equal((await clicar({ offerId: OFFER, sessionId: SESSION })).body.reason, "offer_hidden", "o Some em ja passou");

  montar({ oferta: { deadline_minutes: 2 } });
  assert.equal((await clicar({ offerId: OFFER, sessionId: SESSION })).body.reason, "offer_hidden", "o prazo real venceu aos 7 min");

  montar();
  assert.equal((await clicar({ offerId: OFFER, sessionId: LIVE_SESSION })).body.reason, "offer_hidden");

  montar({ oferta: { status: "draft" } });
  assert.equal((await clicar({ offerId: OFFER, sessionId: SESSION })).status, 409);

  const naoHttps = montar({ variantes: [variantRow("A", { checkout_url: "http://pay.exemplo.test/A" })] });
  assert.equal((await clicar({ offerId: OFFER, sessionId: SESSION })).body.reason, "offer_hidden", "so abre https");
  assert.equal(naoHttps.db.tables.webinar_offer_clicks.length, 0);
});

test("POST no replay usa o offset do corpo (a posicao do player); sem ele, 409", async () => {
  const { db } = montar();
  assert.equal((await clicar({ offerId: OFFER, offsetMs: 2 * MIN, sessionId: REPLAY })).body.reason, "offer_hidden");
  assert.equal((await clicar({ offerId: OFFER, sessionId: REPLAY })).body.reason, "offer_hidden");
  const inside = await clicar({ offerId: OFFER, offsetMs: 6 * MIN, sessionId: REPLAY });
  assert.equal(inside.status, 201);
  assert.equal(db.tables.webinar_offer_clicks[0].offset_ms, 6 * MIN);
  assert.equal(db.tables.webinar_offer_clicks[0].session_id, REPLAY);
});

test("POST: banido de todos os webinarios 409 banned; a oferta de outro webinario 404", async () => {
  const banido = montar();
  banido.db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: null, user_id: banido.userId });
  const refused = await clicar({ offerId: OFFER, sessionId: SESSION });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.reason, "banned");
  assert.equal(banido.db.tables.webinar_offer_clicks.length, 0);

  const outra = montar();
  outra.db.tables.webinar_offers.push(offerRow({ id: OTHER_OFFER, webinar_id: OTHER_WEBINAR }));
  outra.db.tables.webinar_offer_variants.push(variantRow("A", { id: "eeeeeeee-0000-4000-8000-0000000000f1", offer_id: OTHER_OFFER }));
  const wrong = await clicar({ offerId: OTHER_OFFER, sessionId: SESSION });
  assert.equal(wrong.status, 404);
  assert.equal(outra.db.tables.webinar_offer_clicks.length, 0);
});

test("POST: o teto de 30 escritas por minuto do aluno vale para o clique (429 com Retry-After)", async () => {
  montar();
  const statuses = [];
  for (let index = 0; index < 31; index += 1) {
    statuses.push((await clicar({ offerId: OFFER, sessionId: SESSION })).status);
  }
  assert.deepEqual(statuses.slice(0, 2), [201, 200]);
  const last = await clicar({ offerId: OFFER, sessionId: SESSION });
  assert.equal(statuses.at(-1), 429);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("retry-after"), "60");
});
