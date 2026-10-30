import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  MIN,
  OFFER,
  OTHER_OFFER,
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

// As Server Actions da Oferta (docs/30 §2.2, §2.4, §8.6 e M7; docs/18 §2.3), sem banco: o banco da Oferta em memoria,
// a permissao por um duble que recusa tudo (o analista sem messaging.write), "next/cache" so anota e os produtos do
// seletor por um duble do catalogo. Aqui: 403 sem messaging.write em todas; o editor le a oferta e os produtos (e
// segue sem a lista quando ela falha; banco sem a 202610300003 = pendingMigration); salvar cria e atualiza a oferta
// com as variantes (pesos 1, a letra que saiu e apagada) e audita so ids e contagens; o zod recusa o link sem https e
// a oferta ligada sem variante; arquivar; Mostrar agora grava a janela da sessao no segundo do servidor com quem
// mostrou e o prazo real, mostrar de novo guarda o comeco e o prazo; Esconder fecha agora (e grava a linha do minuto
// marcado que ainda nao tinha); so na sessao gravada que nao terminou; o console conta os cliques por variante.

const estado = (globalThis.__ofertaAcoes ??= { negar: false, produtos: [], produtosFalham: false, revalidados: [] });
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });
    if (specifier === "@/server/auth/permissions") {
      return stub(`
        export async function requireRole(action) {
          if (globalThis.__ofertaAcoes.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`);
    }
    if (specifier === "@/server/catalog/queries") {
      return stub(`
        export async function listProductOptions() {
          if (globalThis.__ofertaAcoes.produtosFalham) throw new Error("catalogo fora do ar");
          return globalThis.__ofertaAcoes.produtos;
        }`);
    }
    if (specifier.endsWith("/db/supabase/client")) {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    if (specifier === "next/cache") {
      return stub(`
        export function revalidatePath(path) { globalThis.__ofertaAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__ofertaAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__ofertaAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`);
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtor.teste@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Produtor de Teste" } } };

const actions = await import("../src/server/webinars/offer-actions.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const PRODUTOS = [{ accent: "lima", coverUrl: null, format: "formation", id: PRODUCT, situation: "published", title: "Formação em Agentes" }];

function usar(options = {}) {
  const db = bancoDaOferta({ tables: escolaDaOferta(options) });
  actionStubs.db = db;
  estado.negar = false;
  estado.produtos = PRODUTOS;
  estado.produtosFalham = false;
  estado.revalidados.length = 0;
  return db;
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);

const draft = (extra = {}) => ({
  attributionDays: 7,
  deadlineMinutes: 15,
  productId: PRODUCT,
  showAtOffsetMs: 45 * MIN,
  status: "active",
  title: "Oferta da live",
  triggerKind: "at_offset",
  variants: [
    { badge: "Vagas limitadas", checkoutUrl: "https://pay.hotmart.com/A", coupon: "B707", enabled: true, headline: "Formação A", imageUrl: null, label: "A", priceFromLabel: "R$ 1.997", priceLabel: "R$ 997", weight: 1 },
    { badge: null, checkoutUrl: "https://pay.hotmart.com/B", coupon: null, enabled: true, headline: "Formação B", imageUrl: "https://cdn.exemplo.test/b.png", label: "B", priceFromLabel: null, priceLabel: "R$ 897", weight: 1 }
  ],
  visibleMinutes: 20,
  ...extra
});

test("403 sem messaging.write em todas as acoes da Oferta, sem tocar no banco", async () => {
  const db = usar();
  estado.negar = true;
  const results = await Promise.all([
    actions.loadOfferEditor({ webinarId: WEBINAR }),
    actions.saveOffer({ draft: draft(), webinarId: WEBINAR }),
    actions.archiveOffer({ offerId: OFFER, webinarId: WEBINAR }),
    actions.loadOfferConsole({ sessionId: SESSION }),
    actions.showOfferNow({ offerId: OFFER, sessionId: SESSION }),
    actions.hideOffer({ offerId: OFFER, sessionId: SESSION })
  ]);
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  }
  assert.equal(db.calls.from.length, 0);
});

test("o editor le a oferta e os produtos; sem oferta, nulo; a lista que falha nao derruba o card; banco sem a 202610300003 = aviso", async () => {
  usar({ oferta: false });
  const empty = ok(await actions.loadOfferEditor({ webinarId: WEBINAR }));
  assert.equal(empty.pendingMigration, false);
  assert.equal(empty.offer, null);
  assert.equal(empty.kind, "simulated");
  assert.deepEqual(empty.products.map((item) => item.id), [PRODUCT]);
  assert.equal(empty.productsLoaded, true);

  usar();
  estado.produtosFalham = true;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let loaded;
  try {
    loaded = ok(await actions.loadOfferEditor({ webinarId: WEBINAR }));
  } finally {
    console.error = original;
  }
  assert.match(errors.join("\n"), /produtos da oferta/, "a falha da lista vai para o log");
  assert.equal(loaded.offer.id, OFFER);
  assert.deepEqual(loaded.offer.variants.map((item) => item.label), ["A", "B"]);
  assert.equal(loaded.productsLoaded, false);
  assert.deepEqual(loaded.products, []);

  semAsTabelasDaOferta(usar());
  assert.deepEqual(ok(await actions.loadOfferEditor({ webinarId: WEBINAR })), { migration: "202610300003", pendingMigration: true });

  usar();
  const missing = await actions.loadOfferEditor({ webinarId: "cccccccc-0000-4000-8000-0000000000ff" });
  assert.equal(missing.status, 404);
});

test("salvar cria a oferta com as variantes (Divisao igual) e audita so ids e contagens; salvar de novo atualiza e apaga a letra que saiu", async () => {
  const db = usar({ oferta: false });
  const saved = ok(await actions.saveOffer({ draft: draft(), webinarId: WEBINAR }));
  assert.equal(saved.webinarId, WEBINAR);
  assert.equal(saved.status, "active");
  assert.equal(saved.showAtOffsetMs, 45 * MIN);
  assert.equal(saved.deadlineMinutes, 15);
  assert.deepEqual(saved.variants.map((item) => [item.label, item.weight]), [["A", 1], ["B", 1]]);
  assert.equal(db.tables.webinar_offers.length, 1);
  assert.equal(db.tables.webinar_offers[0].created_by, EQUIPE);

  const [audit] = audits(db, "webinar.offer_saved");
  assert.equal(audit.actor_id, EQUIPE);
  assert.equal(audit.entity_id, WEBINAR);
  assert.equal(audit.count, 2);
  assert.deepEqual(audit.metadata, { attribution_days: 7, enabled_variants: 2, offer_id: saved.id, product_id: PRODUCT, status: "active", trigger_kind: "at_offset", variants: 2 });
  assert.doesNotMatch(JSON.stringify(audit), /hotmart|Formação|R\$/, "a auditoria nunca guarda o link nem o texto");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`));
  assert.ok(estado.revalidados.includes("webinars"), "o cache do relatorio cai");

  const updated = ok(
    await actions.saveOffer({
      draft: draft({ triggerKind: "manual", variants: [{ ...draft().variants[1], enabled: true }], visibleMinutes: null }),
      webinarId: WEBINAR
    })
  );
  assert.equal(updated.id, saved.id, "a mesma oferta");
  assert.equal(updated.triggerKind, "manual");
  assert.equal(updated.showAtOffsetMs, null, "o minuto so vale no Num minuto do video");
  assert.deepEqual(updated.variants.map((item) => item.label), ["B"]);
  assert.equal(db.tables.webinar_offer_variants.length, 1, "a A saiu do rascunho e foi apagada");
  assert.equal(audits(db, "webinar.offer_saved").length, 2);
});

test("o zod do salvar: link sem https, oferta ligada sem variante ligada e minuto faltando voltam como erro do campo, sem gravar", async () => {
  const db = usar({ oferta: false });
  const http = await actions.saveOffer({ draft: draft({ variants: [{ ...draft().variants[0], checkoutUrl: "http://pay.hotmart.com/A" }] }), webinarId: WEBINAR });
  assert.equal(http.status, 400);
  assert.equal(http.fieldErrors["draft.variants.0.checkoutUrl"][0], "Cole o link de checkout completo, começando com https://.");

  const none = await actions.saveOffer({ draft: draft({ variants: [{ ...draft().variants[0], enabled: false }] }), webinarId: WEBINAR });
  assert.equal(none.status, 400);
  assert.equal(none.fieldErrors["draft.variants"][0], "Ligue pelo menos uma variante com título e link de checkout.");

  const minute = await actions.saveOffer({ draft: draft({ showAtOffsetMs: null }), webinarId: WEBINAR });
  assert.equal(minute.status, 400);
  assert.ok(minute.fieldErrors["draft.showAtOffsetMs"]);

  const product = await actions.saveOffer({ draft: draft({ productId: "" }), webinarId: WEBINAR });
  assert.equal(product.fieldErrors["draft.productId"][0], "Escolha o produto que a compra libera.");
  assert.equal(db.tables.webinar_offers.length, 0);
  assert.equal(db.tables.admin_audit_log.length, 0);
});

test("arquivar: a oferta sai da sala (archived) e a auditoria fica; oferta de outro webinario 404", async () => {
  const db = usar();
  db.tables.webinar_offers.push(offerRow({ id: OTHER_OFFER, webinar_id: OTHER_WEBINAR }));
  const wrong = await actions.archiveOffer({ offerId: OTHER_OFFER, webinarId: WEBINAR });
  assert.equal(wrong.status, 404);

  assert.deepEqual(ok(await actions.archiveOffer({ offerId: OFFER, webinarId: WEBINAR })), { archived: true, offerId: OFFER });
  assert.equal(db.tables.webinar_offers.find((row) => row.id === OFFER).status, "archived");
  const [audit] = audits(db, "webinar.offer_archived");
  assert.deepEqual(audit.metadata, { offer_id: OFFER, previous_status: "active", variants: 2 });
  assert.equal(ok(await actions.loadOfferEditor({ webinarId: WEBINAR })).offer, null, "arquivada nao volta ao editor");
});

test("Mostrar agora: a janela no segundo do servidor com quem mostrou e o prazo real; o painel na tela; mostrar de novo guarda o comeco e o prazo", async () => {
  const db = usar({ minutosNoAr: 12, oferta: { deadline_minutes: 30, show_at_offset_ms: null, trigger_kind: "manual", visible_minutes: 10 } });
  const scheduled = Date.parse(db.tables.webinar_sessions.find((row) => row.id === SESSION).scheduled_at);
  const before = Date.now();
  const view = ok(await actions.showOfferNow({ offerId: OFFER, sessionId: SESSION }));
  assert.equal(view.onScreen, true);
  assert.equal(view.canShow, true);
  assert.equal(view.window.source, "display");

  const [row] = db.tables.webinar_offer_displays;
  assert.ok(Math.abs(row.show_offset_ms - 12 * MIN) < 5_000, "o segundo do video de agora");
  assert.equal(row.hide_offset_ms - row.show_offset_ms, 10 * MIN);
  assert.equal(row.shown_by, EQUIPE);
  assert.ok(Date.parse(row.deadline_at) >= before + 30 * MIN && Date.parse(row.deadline_at) <= Date.now() + 30 * MIN);
  assert.deepEqual(row.snapshot.variants.map((item) => item.label), ["A", "B"]);
  assert.ok(Date.parse(row.deadline_at) > scheduled);

  const [audit] = audits(db, "webinar.offer_shown");
  assert.equal(audit.entity_id, WEBINAR);
  assert.equal(audit.metadata.offer_id, OFFER);
  assert.equal(audit.metadata.session_id, SESSION);
  assert.equal(audit.metadata.with_deadline, true);
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}/sala`));

  // Esconder e mostrar de novo dois minutos depois (a hora marcada anda para tras = o video anda para a frente).
  ok(await actions.hideOffer({ offerId: OFFER, sessionId: SESSION }));
  const firstShow = row.show_offset_ms;
  const firstDeadline = row.deadline_at;
  db.tables.webinar_sessions.find((item) => item.id === SESSION).scheduled_at = iso(scheduled - 2 * MIN);
  const reshown = ok(await actions.showOfferNow({ offerId: OFFER, sessionId: SESSION }));
  assert.equal(reshown.onScreen, true);
  const [again] = db.tables.webinar_offer_displays;
  assert.equal(db.tables.webinar_offer_displays.length, 1);
  assert.equal(again.show_offset_ms, firstShow, "o comeco mais cedo da sessao fica");
  assert.equal(again.deadline_at, firstDeadline, "o prazo real nao recomeca");
  assert.equal(again.hidden_at, null);
});

test("Esconder: fecha a janela agora e audita; de novo e 409; o minuto marcado na tela sem linha ganha a linha e fecha", async () => {
  const db = usar({ oferta: { show_at_offset_ms: null, trigger_kind: "manual" } });
  ok(await actions.showOfferNow({ offerId: OFFER, sessionId: SESSION }));
  const view = ok(await actions.hideOffer({ offerId: OFFER, sessionId: SESSION }));
  assert.equal(view.onScreen, false);
  const [row] = db.tables.webinar_offer_displays;
  assert.equal(row.hidden_by, EQUIPE);
  assert.ok(row.hidden_at);
  assert.ok(row.hide_offset_ms >= row.show_offset_ms);
  assert.equal(audits(db, "webinar.offer_hidden").length, 1);
  const twice = await actions.hideOffer({ offerId: OFFER, sessionId: SESSION });
  assert.equal(twice.status, 409);
  assert.equal(twice.error, WEBINAR_COPY.oferta.console.jaEscondida);

  const planned = usar();
  assert.equal(planned.tables.webinar_offer_displays.length, 0);
  ok(await actions.hideOffer({ offerId: OFFER, sessionId: SESSION }));
  const [closed] = planned.tables.webinar_offer_displays;
  assert.equal(closed.show_offset_ms, 5 * MIN);
  assert.ok(closed.hidden_at);
  assert.ok(Math.abs(closed.hide_offset_ms - 10 * MIN) < 5_000);
});

test("Mostrar e Esconder so na sessao gravada que nao terminou e com a oferta ligada; oferta de outro webinario 404", async () => {
  usar();
  const replay = await actions.showOfferNow({ offerId: OFFER, sessionId: REPLAY });
  assert.equal(replay.status, 409);
  assert.equal(replay.error, WEBINAR_COPY.oferta.console.soNaGravada);

  usar({ sessao: { status: "ended" } });
  assert.equal((await actions.showOfferNow({ offerId: OFFER, sessionId: SESSION })).status, 409);

  usar({ oferta: { status: "draft" } });
  const draftOffer = await actions.showOfferNow({ offerId: OFFER, sessionId: SESSION });
  assert.equal(draftOffer.status, 409);
  assert.equal(draftOffer.error, WEBINAR_COPY.oferta.console.naoLigada);

  const db = usar();
  db.tables.webinar_offers.push(offerRow({ id: OTHER_OFFER, webinar_id: OTHER_WEBINAR }));
  assert.equal((await actions.showOfferNow({ offerId: OTHER_OFFER, sessionId: SESSION })).status, 404);
  assert.equal(db.tables.webinar_offer_displays.length, 0);
  assert.equal(db.tables.admin_audit_log.length, 0);
});

test("o console: a janela, na tela pelo relogio do servidor e os cliques por variante (cliques e alunos); o replay sem botoes; banco sem a migracao", async () => {
  const db = usar();
  const click = (userId, label, sessionId = SESSION) => ({
    click_token: `${userId.slice(-4)}${label}${"x".repeat(19)}`.slice(0, 24),
    clicked_at: iso(Date.now()),
    converted_at: null,
    converted_sale_grant_id: null,
    created_at: iso(Date.now()),
    id: `${userId.slice(0, 30)}${label}${sessionId.slice(-1)}`,
    offer_id: OFFER,
    offset_ms: 6 * MIN,
    session_id: sessionId,
    user_id: userId,
    variant_id: null,
    variant_label: label
  });
  db.tables.webinar_offer_clicks.push(
    click("u0000000-0000-4000-8000-000000000001", "A"),
    click("u0000000-0000-4000-8000-000000000001", "A"),
    click("u0000000-0000-4000-8000-000000000002", "B"),
    click("u0000000-0000-4000-8000-000000000003", "B", REPLAY)
  );
  const data = ok(await actions.loadOfferConsole({ sessionId: SESSION }));
  assert.equal(data.pendingMigration, false);
  assert.equal(data.view.onScreen, true, "aos 10 min, dentro da janela de 5 a 25");
  assert.equal(data.view.canShow, true);
  assert.equal(data.view.window.source, "planned");
  assert.deepEqual(data.view.clicks, {
    byVariant: [
      { clicks: 2, label: "A", students: 1 },
      { clicks: 1, label: "B", students: 1 }
    ],
    clicks: 3,
    students: 2
  });
  assert.deepEqual(data.view.offer.variants.map((item) => item.label), ["A", "B"]);
  assert.doesNotMatch(JSON.stringify(data.view), /hotmart/, "o console nao precisa do link");

  const replay = ok(await actions.loadOfferConsole({ sessionId: REPLAY })).view;
  assert.equal(replay.canShow, false);
  assert.equal(replay.onScreen, false);
  assert.equal(replay.clicks.clicks, 1);

  semAsTabelasDaOferta(usar());
  assert.deepEqual(ok(await actions.loadOfferConsole({ sessionId: SESSION })), { migration: "202610300003", pendingMigration: true });

  usar();
  assert.equal((await actions.loadOfferConsole({ sessionId: "cccccccc-0000-4000-8000-0000000000ff" })).status, 404);
});

test("sem oferta: o console diz que nao ha; uma variante ligada a mais nao muda quem ja viu (o editor nao mexe nas linhas da sessao)", async () => {
  usar({ oferta: false });
  const data = ok(await actions.loadOfferConsole({ sessionId: SESSION }));
  assert.equal(data.view.offer, null);
  assert.equal(data.view.canShow, false);

  const db = usar({ variantes: [variantRow("A")] });
  ok(await actions.hideOffer({ offerId: OFFER, sessionId: SESSION }));
  const snapshot = structuredClone(db.tables.webinar_offer_displays[0].snapshot);
  ok(await actions.saveOffer({ draft: draft({ showAtOffsetMs: 5 * MIN }), webinarId: WEBINAR }));
  assert.deepEqual(db.tables.webinar_offer_displays[0].snapshot, snapshot, "a foto do que a sessao mostrou fica");
});
