import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Prazo de acesso por curso (docs/05, "Prazo de acesso por curso e todas as formacoes"; docs/17 §1.6.10): as regras
// puras, sem banco.
// - o prazo: frases do produtor, soma no calendario da escola e o fim do dia;
// - compra repetida soma, quem venceu conta da compra, "para sempre" vence qualquer prazo e nunca encurta;
// - a venda desfeita refaz a conta so com as compras que sobraram (a mais nova e a mais antiga reembolsadas);
// - a mesma venda processada de novo nao soma duas vezes;
// - o pacote: o prazo de cada produto e o item "todas as formacoes" no formulario e no schema da Server Action;
// - a importacao: o termino (ou "vitalício") por produto, pela celula de Produtos ou pela coluna Término;
// - a migracao 202611280001: colunas, tabela com RLS so para a chave de servico e a funcao nova.

const term = await import("../src/server/access/access-term.ts");
const saleAccess = await import("../src/server/payments/sale-access.ts");
const model = await import("../src/server/payments/model.ts");
const combos = await import("../src/server/catalog/combo-model.ts");
const { accessTermSchema, comboSchema, updateProductAccessSchema } = await import("../src/server/catalog/schemas.ts");
const importModel = await import("../src/server/students/import-model.ts");
const { importRowSchema } = await import("../src/server/students/schemas.ts");

const ANO = { amount: 1, unit: "years" };
const iso = (text) => new Date(text).toISOString();
const ms = (text) => Date.parse(text);

/* ------------------------------------------------------------------------------------------------
 * O prazo
 * ---------------------------------------------------------------------------------------------- */

test("o prazo em frases do produtor: Para sempre, Por 1 ano, Por 6 meses, Por 30 dias", () => {
  assert.equal(term.accessTermLabel(null), "Para sempre");
  assert.equal(term.accessTermLabel(ANO), "Por 1 ano");
  assert.equal(term.accessTermLabel({ amount: 2, unit: "years" }), "Por 2 anos");
  assert.equal(term.accessTermLabel({ amount: 1, unit: "months" }), "Por 1 mês");
  assert.equal(term.accessTermLabel({ amount: 6, unit: "months" }), "Por 6 meses");
  assert.equal(term.accessTermLabel({ amount: 30, unit: "days" }), "Por 30 dias");
  assert.equal(term.accessTermLabel({ amount: 1, unit: "days" }), "Por 1 dia");

  // O que vem do banco ou de um formulario: fora da regra vira "para sempre" (o padrao de sempre).
  assert.deepEqual(term.normalizeAccessTerm("years", 1), ANO);
  assert.deepEqual(term.normalizeAccessTerm("months", "6"), { amount: 6, unit: "months" });
  for (const [unit, amount] of [[null, null], ["weeks", 2], ["years", 0], ["years", 1.5], ["days", 3651], ["days", ""], [undefined, 3]]) {
    assert.equal(term.normalizeAccessTerm(unit, amount), null, `${unit} ${amount}`);
  }

  // Os prazos prontos do seletor e a chave de cada um.
  assert.deepEqual(term.ACCESS_TERM_PRESETS.map(term.accessTermLabel), ["Para sempre", "Por 30 dias", "Por 3 meses", "Por 6 meses", "Por 1 ano", "Por 2 anos"]);
  assert.equal(term.accessTermKey(null), "");
  assert.deepEqual(term.accessTermFromKey(term.accessTermKey(ANO)), ANO);
  assert.equal(term.isAccessTermPreset({ amount: 45, unit: "days" }), false);
});

test("a soma no calendário da escola: dias de 24 h; meses e anos no dia do mês, parando no último quando ele não existe", () => {
  const add = (from, value) => new Date(term.addAccessTerm(ms(from), value)).toISOString();

  assert.equal(add("2026-11-28T13:00:00.000Z", { amount: 30, unit: "days" }), "2026-12-28T13:00:00.000Z");
  assert.equal(add("2026-11-28T13:00:00.000Z", ANO), "2027-11-28T13:00:00.000Z");
  assert.equal(add("2026-11-28T13:00:00.000Z", { amount: 3, unit: "months" }), "2027-02-28T13:00:00.000Z");
  // 31 de janeiro + 1 mes: fevereiro nao tem dia 31.
  assert.equal(add("2027-01-31T13:00:00.000Z", { amount: 1, unit: "months" }), "2027-02-28T13:00:00.000Z");
  // 29 de fevereiro de 2028 + 1 ano.
  assert.equal(add("2028-02-29T13:00:00.000Z", ANO), "2029-02-28T13:00:00.000Z");
  // 00:30 UTC do dia 1 ainda e dia 30 (21:30) no fuso da escola: o mes anda a partir do dia 30.
  assert.equal(add("2026-12-01T00:30:00.000Z", { amount: 1, unit: "months" }), "2026-12-31T00:30:00.000Z");

  // O termino de uma compra vale ate o fim daquele dia no fuso da escola (23:59:59.999 de Sao Paulo).
  assert.equal(term.accessEndFromPurchase(ms("2026-11-28T13:00:00.000Z"), ANO), "2027-11-29T02:59:59.999Z");
  assert.equal(term.accessEndFromPurchase(ms("2026-11-28T13:00:00.000Z"), null), null);
  assert.equal(term.formatAccessDate("2027-11-29T02:59:59.999Z"), "28/11/2027");
  assert.equal(term.accessEndedLabel("2027-11-29T02:59:59.999Z"), "Seu acesso terminou em 28/11/2027");
});

test("compra repetida soma; quem venceu conta da compra; para sempre vence qualquer prazo; nunca encurta", () => {
  const compra = ms("2026-11-28T13:00:00.000Z");
  const next = (input) => term.nextAccessEndOnSale({ purchasedAt: compra, ...input });

  // Ainda tem 3 meses e compra mais 1 ano: 1 ano e 3 meses.
  assert.equal(next({ currentEndsAt: iso("2027-02-28T02:59:59.999Z"), term: ANO, wasOpen: true }), "2028-02-28T02:59:59.999Z");
  // Ja venceu (ou nunca teve): conta a partir da compra.
  assert.equal(next({ currentEndsAt: iso("2026-10-01T02:59:59.999Z"), term: ANO, wasOpen: false }), "2027-11-29T02:59:59.999Z");
  assert.equal(next({ currentEndsAt: null, term: ANO, wasOpen: false }), "2027-11-29T02:59:59.999Z");
  // Para sempre vence dos dois lados.
  assert.equal(next({ currentEndsAt: iso("2027-02-28T02:59:59.999Z"), term: null, wasOpen: true }), null, "comprou vitalicio");
  assert.equal(next({ currentEndsAt: null, term: ANO, wasOpen: true }), null, "ja era vitalicio");
  // Nunca encurta: o resultado de somar e sempre depois do que havia.
  assert.ok(ms(next({ currentEndsAt: iso("2030-01-01T02:59:59.999Z"), term: { amount: 1, unit: "days" }, wasOpen: true })) > ms("2030-01-01T02:59:59.999Z"));

  assert.equal(term.maxAccessEnd("2027-01-01T00:00:00.000Z", null), null);
  assert.equal(term.maxAccessEnd("2027-01-01T00:00:00.000Z", "2028-01-01T00:00:00.000Z"), "2028-01-01T00:00:00.000Z");
  assert.deepEqual(term.longerAccessTerm(ANO, { amount: 6, unit: "months" }), ANO);
  assert.equal(term.longerAccessTerm(ANO, null), null);
});

test("refazer a conta: as compras na ordem em que foram feitas, a partir do que o aluno tinha", () => {
  const t1 = ms("2026-11-28T13:00:00.000Z");
  const t2 = ms("2027-03-10T13:00:00.000Z");

  // Duas compras de 1 ano: a segunda soma ao termino da primeira.
  const duas = term.replaySaleTerms({ open: false }, [{ purchasedAt: t2, term: ANO }, { purchasedAt: t1, term: ANO }]);
  assert.equal(duas.endsAt, "2028-11-29T02:59:59.999Z");
  assert.deepEqual(duas.before, [{ open: false }, { endsAt: "2027-11-29T02:59:59.999Z", open: true }], "o termino de antes de cada compra");

  // So a segunda (a primeira foi reembolsada): 1 ano a partir da compra dela.
  assert.equal(term.replaySaleTerms({ open: false }, [{ purchasedAt: t2, term: ANO }]).endsAt, "2028-03-11T02:59:59.999Z");
  // A equipe tinha dado acesso ate uma data: a compra soma a ela.
  assert.equal(term.replaySaleTerms({ endsAt: "2027-06-30T02:59:59.999Z", open: true }, [{ purchasedAt: t1, term: ANO }]).endsAt, "2028-06-30T02:59:59.999Z");
  // A primeira compra ja tinha vencido quando a segunda chegou: conta da segunda.
  const mes = { amount: 1, unit: "months" };
  assert.equal(term.replaySaleTerms({ open: false }, [{ purchasedAt: t1, term: mes }, { purchasedAt: t2, term: mes }]).endsAt, "2027-04-11T02:59:59.999Z");
  // Uma compra vitalicia no meio: para sempre.
  assert.equal(term.replaySaleTerms({ open: false }, [{ purchasedAt: t1, term: ANO }, { purchasedAt: t2, term: null }]).endsAt, null);
});

/* ------------------------------------------------------------------------------------------------
 * O plano de uma venda para um acesso
 * ---------------------------------------------------------------------------------------------- */

const AGORA = ms("2026-11-28T13:00:00.000Z");
const venda = { provider: "hotmart", transactionId: "HP-2" };
const acesso = (extra = {}) => ({ ends_at: null, source_event_id: "HP-1", source_provider: "hotmart", starts_at: "2026-01-01T00:00:00.000Z", status: "active", ...extra });

test("o plano de uma venda: abre, soma, e a mesma venda de novo nunca soma duas vezes", () => {
  const plan = (input) => saleAccess.planSaleAccess({ now: AGORA, purchasedAt: AGORA, sale: venda, term: ANO, ...input });

  // Nunca teve: a venda abre, com o termino da compra + prazo.
  assert.deepEqual(plan({ previous: null }), {
    endsAt: "2027-11-29T02:59:59.999Z",
    opened: true,
    previousEndsAt: null,
    purchasedAt: "2026-11-28T13:00:00.000Z",
    term: ANO
  });

  // Aberto com data: soma, e o vinculo guarda o termino de antes.
  const aberto = acesso({ ends_at: "2027-02-28T02:59:59.999Z" });
  assert.deepEqual(plan({ previous: aberto }), {
    endsAt: "2028-02-28T02:59:59.999Z",
    opened: false,
    previousEndsAt: "2027-02-28T02:59:59.999Z",
    purchasedAt: "2026-11-28T13:00:00.000Z",
    term: ANO
  });

  // Vencido, revogado ou suspenso: a venda abre de novo e conta da compra.
  for (const fechado of [acesso({ ends_at: "2026-10-01T02:59:59.999Z" }), acesso({ status: "revoked" }), acesso({ status: "suspended" })]) {
    const reaberto = plan({ previous: fechado });
    assert.equal(reaberto.opened, true);
    assert.equal(reaberto.endsAt, "2027-11-29T02:59:59.999Z");
    assert.equal(reaberto.previousEndsAt, null);
  }

  // Vitalicio dos dois lados.
  assert.equal(plan({ previous: aberto, term: null }).endsAt, null);
  assert.equal(plan({ previous: acesso() }).endsAt, null);

  // A mesma venda de novo, com o vinculo ja gravado e o acesso ja somado: fica como esta.
  const somado = acesso({ ends_at: "2028-02-28T02:59:59.999Z" });
  const vinculo = { closed_at: null, created_at: "2026-11-28T13:00:01.000Z", opened: false, previous_ends_at: "2027-02-28T02:59:59.999Z", purchased_at: "2026-11-28T13:00:00.000Z", term_amount: 1, term_unit: "years" };
  assert.equal(plan({ previous: somado, saleGrant: vinculo }).endsAt, "2028-02-28T02:59:59.999Z");
  assert.equal(plan({ previous: somado, saleGrant: vinculo }).previousEndsAt, "2027-02-28T02:59:59.999Z", "o termino de antes continua o da primeira vez");
  // A falha foi antes de somar (o vinculo existe, o acesso ainda com o termino de antes): o reprocesso soma uma vez.
  assert.equal(plan({ previous: aberto, saleGrant: vinculo }).endsAt, "2028-02-28T02:59:59.999Z");
  // Outra compra somou depois: reprocessar a antiga nao encurta.
  assert.equal(plan({ previous: acesso({ ends_at: "2029-02-28T02:59:59.999Z" }), saleGrant: vinculo }).endsAt, "2029-02-28T02:59:59.999Z");
  // O acesso nasceu desta venda e o vinculo nao chegou a ser gravado: continua "aberto por ela", sem somar.
  const daVenda = acesso({ ends_at: "2027-11-29T02:59:59.999Z", source_event_id: "HP-2:curso-a" });
  assert.deepEqual([plan({ previous: daVenda }).opened, plan({ previous: daVenda }).endsAt], [true, "2027-11-29T02:59:59.999Z"]);

  // A formacao que entrou depois para quem tem "todas as formacoes": o termino da concessao, sem encurtar.
  assert.equal(plan({ fixedEndsAt: "2027-06-30T02:59:59.999Z", previous: null }).endsAt, "2027-06-30T02:59:59.999Z");
  assert.equal(plan({ fixedEndsAt: "2027-06-30T02:59:59.999Z", previous: acesso({ ends_at: "2028-01-01T02:59:59.999Z" }) }).endsAt, "2028-01-01T02:59:59.999Z");
  assert.equal(plan({ fixedEndsAt: "2027-06-30T02:59:59.999Z", previous: acesso() }).endsAt, null);

  // A data da compra: a da compra aprovada; na reativacao, quando ela aconteceu; nunca no futuro.
  assert.equal(saleAccess.salePurchasedAt({ occurredAt: "2026-11-28T12:00:00.000Z", purchasedAt: "2026-11-20T12:00:00.000Z" }, AGORA), ms("2026-11-20T12:00:00.000Z"));
  assert.equal(saleAccess.salePurchasedAt({ occurredAt: "2026-11-28T12:00:00.000Z", purchasedAt: "2026-11-20T12:00:00.000Z", reactivatesSubscription: true }, AGORA), ms("2026-11-28T12:00:00.000Z"));
  assert.equal(saleAccess.salePurchasedAt({ occurredAt: null, purchasedAt: "2099-01-01T00:00:00.000Z" }, AGORA), AGORA);
  assert.equal(saleAccess.salePurchasedAt({ occurredAt: null, purchasedAt: null }, AGORA), AGORA);
});

/* ------------------------------------------------------------------------------------------------
 * A venda desfeita
 * ---------------------------------------------------------------------------------------------- */

const vinculo = (extra) => ({ closed_at: null, closed_by: null, created_at: "2026-11-28T13:00:01.000Z", opened: true, previous_ends_at: null, subscription_code: null, term_amount: 1, term_unit: "years", transaction_id: "T1", ...extra });

function decidir(grants, { rowEndsAt, transactions = ["T1"] }) {
  return model.decideEntitlementAfterSale({
    closingSubscriptionCodes: new Set(),
    closingTransactionIds: new Set(transactions),
    eventProvider: "hotmart",
    grants,
    rowEndsAt,
    rowSourceProvider: "hotmart"
  });
}

test("reembolso da compra que somou devolve o término de antes, na ordem que for", () => {
  const t1 = vinculo({ purchased_at: "2026-11-28T13:00:00.000Z" });
  const t2 = vinculo({ created_at: "2027-03-10T13:00:01.000Z", opened: false, previous_ends_at: "2027-11-29T02:59:59.999Z", purchased_at: "2027-03-10T13:00:00.000Z", transaction_id: "T2" });
  const somado = "2028-11-29T02:59:59.999Z";

  // A mais nova reembolsada: volta ao termino da primeira.
  assert.deepEqual(decidir([t1, t2], { rowEndsAt: somado, transactions: ["T2"] }), { endsAt: "2027-11-29T02:59:59.999Z", kind: "restore_deadline" });
  // A mais antiga reembolsada: sobra 1 ano a partir da segunda compra.
  assert.deepEqual(decidir([t1, t2], { rowEndsAt: somado, transactions: ["T1"] }), { endsAt: "2028-03-11T02:59:59.999Z", kind: "restore_deadline" });
  // O reprocesso do mesmo reembolso (o termino ja voltou): nada muda.
  assert.deepEqual(decidir([t1, t2], { rowEndsAt: "2027-11-29T02:59:59.999Z", transactions: ["T2"] }), { kind: "keep_sustained" });
  // As duas reembolsadas: a primeira abriu o acesso e nada mais o sustenta.
  assert.deepEqual(decidir([{ ...t1, closed_at: "2027-04-01T00:00:00.000Z", closed_by: "refund" }, t2], { rowEndsAt: "2028-03-11T02:59:59.999Z", transactions: ["T2"] }), { kind: "close" });

  // A compra vitalicia reembolsada volta ao prazo da outra.
  const vitalicia = vinculo({ created_at: "2027-03-10T13:00:01.000Z", opened: false, previous_ends_at: "2027-11-29T02:59:59.999Z", purchased_at: "2027-03-10T13:00:00.000Z", term_amount: null, term_unit: null, transaction_id: "T2" });
  assert.deepEqual(decidir([t1, vitalicia], { rowEndsAt: null, transactions: ["T2"] }), { endsAt: "2027-11-29T02:59:59.999Z", kind: "restore_deadline" });
  // A compra com prazo reembolsada e a vitalicia de pe: continua para sempre.
  assert.deepEqual(decidir([t1, vitalicia], { rowEndsAt: null, transactions: ["T1"] }), { kind: "keep_sustained" });

  // A equipe tinha dado o acesso ate uma data e duas compras somaram: cada reembolso devolve o proprio pedaco.
  const e1 = vinculo({ opened: false, previous_ends_at: "2027-06-30T02:59:59.999Z", purchased_at: "2026-11-28T13:00:00.000Z" });
  const e2 = vinculo({ created_at: "2027-03-10T13:00:01.000Z", opened: false, previous_ends_at: "2028-06-30T02:59:59.999Z", purchased_at: "2027-03-10T13:00:00.000Z", transaction_id: "T2" });
  assert.deepEqual(decidir([e1, e2], { rowEndsAt: "2029-06-30T02:59:59.999Z", transactions: ["T2"] }), { endsAt: "2028-06-30T02:59:59.999Z", kind: "restore_deadline" });
  assert.deepEqual(decidir([{ ...e1, closed_at: "2027-04-01T00:00:00.000Z", closed_by: "refund" }, { ...e2, closed_at: "2027-04-02T00:00:00.000Z", closed_by: "refund" }], { rowEndsAt: "2028-06-30T02:59:59.999Z", transactions: ["T2"] }), {
    endsAt: "2027-06-30T02:59:59.999Z",
    kind: "restore_deadline"
  });

  // A equipe mudou a data depois das compras: o que as vendas nao explicam fica como esta...
  assert.deepEqual(decidir([t1, t2], { rowEndsAt: "2030-01-01T02:59:59.999Z", transactions: ["T1"] }), { kind: "keep_sustained" });
  // ...mas a compra mais nova, que guardou o termino de antes (com a extensao da equipe), devolve exatamente ele.
  const depoisDaEquipe = vinculo({ created_at: "2027-03-10T13:00:01.000Z", opened: false, previous_ends_at: "2028-01-15T02:59:59.999Z", purchased_at: "2027-03-10T13:00:00.000Z", transaction_id: "T2" });
  assert.deepEqual(decidir([t1, depoisDaEquipe], { rowEndsAt: "2029-01-15T02:59:59.999Z", transactions: ["T2"] }), { endsAt: "2028-01-15T02:59:59.999Z", kind: "restore_deadline" });
});

test("vendas de antes do prazo (sem prazo no vínculo) continuam como eram: para sempre, e o reembolso não inventa data", () => {
  const antiga1 = { closed_at: null, closed_by: null, created_at: "2026-10-17T00:00:00.000Z", opened: true, previous_ends_at: null, subscription_code: null, transaction_id: "T1" };
  const antiga2 = { ...antiga1, created_at: "2026-10-18T00:00:00.000Z", opened: false, transaction_id: "T2" };

  assert.deepEqual(decidir([antiga1, antiga2], { rowEndsAt: null, transactions: ["T1"] }), { kind: "keep_sustained" });
  assert.deepEqual(decidir([antiga1, antiga2], { rowEndsAt: null, transactions: ["T2"] }), { kind: "keep_sustained" });
  // Sem o termino do acesso informado, a regra do prazo nao roda (o contrato de antes).
  assert.deepEqual(decidir([antiga1, antiga2], { transactions: ["T1"] }), { kind: "keep_sustained" });
  // A equipe pos uma data num acesso que duas vendas antigas sustentam: o reembolso de uma nao tira a data.
  assert.deepEqual(decidir([antiga1, antiga2], { rowEndsAt: "2027-06-30T02:59:59.999Z", transactions: ["T1"] }), { kind: "keep_sustained" });
});

/* ------------------------------------------------------------------------------------------------
 * O pacote e o codigo de venda
 * ---------------------------------------------------------------------------------------------- */

test("pacote: o prazo de cada produto e o item todas as formações vão e voltam pelo formulário", () => {
  const [pacote] = combos.mapComboRows({
    accents: [],
    combos: [{ all_formations: true, all_formations_amount: 2, all_formations_unit: "years", cohort_name: "Black 2026", description: "", id: "combo-black", name: "Black", status: "active", updated_at: "2026-11-28T10:00:00Z" }],
    items: [
      { access_amount: null, access_unit: null, combo_id: "combo-black", product_id: "curso-a", sort_order: 0 },
      { access_amount: 1, access_unit: "years", combo_id: "combo-black", product_id: "curso-b", sort_order: 1 }
    ],
    products: [{ id: "curso-a", image: null, title: "Curso A" }, { id: "curso-b", image: null, title: "Curso B" }]
  });

  assert.deepEqual(pacote.products.map((product) => [product.id, product.accessTerm]), [["curso-a", null], ["curso-b", ANO]]);
  assert.equal(pacote.allFormations, true);
  assert.deepEqual(pacote.allFormationsTerm, { amount: 2, unit: "years" });
  assert.equal(pacote.cohortName, "Black 2026");
  assert.equal(combos.summarizeComboTerms(pacote), "Prazos diferentes");
  assert.equal(combos.summarizeComboTerms({ allFormations: false, allFormationsTerm: null, products: pacote.products.map((product) => ({ ...product, accessTerm: ANO })) }), "Por 1 ano");
  assert.equal(combos.summarizeComboTerms({ allFormations: false, allFormationsTerm: null, products: [pacote.products[0]] }), "Para sempre");

  const form = combos.comboToForm(pacote);
  assert.deepEqual(form.productTerms, { "curso-b": ANO }, "so quem tem prazo; o resto e para sempre");
  assert.equal(form.allFormations, true);
  assert.deepEqual(form.allFormationsTerm, { amount: 2, unit: "years" });

  // O produtor muda um prazo e tira um produto: o prazo de quem saiu nao vai para o servidor.
  const mudado = { ...form, productIds: ["curso-a"], productTerms: combos.withProductTerm(form.productTerms, "curso-a", { amount: 6, unit: "months" }) };
  const entrada = comboSchema.parse(combos.formToComboInput(mudado, "combo-black"));
  assert.deepEqual(entrada.productTerms, { "curso-a": { amount: 6, unit: "months" } });
  assert.equal(combos.isComboFormDirty(form, mudado), true);
  assert.equal(combos.isComboFormDirty(form, { ...form, productTerms: { ...form.productTerms } }), false);
  assert.deepEqual(combos.withProductTerm({ "curso-a": ANO }, "curso-a", null), {}, "voltar para Para sempre tira o prazo");

  // Desligar "todas as formacoes" leva o prazo dele junto; sem ele e sem produto, o pacote nao vale.
  assert.equal(comboSchema.parse(combos.formToComboInput({ ...form, allFormations: false })).allFormationsTerm, null);
  const vazio = comboSchema.safeParse(combos.formToComboInput({ ...form, allFormations: false, productIds: [] }));
  assert.equal(vazio.success, false);
  assert.equal(vazio.error.issues[0].message, "Escolha pelo menos um produto.");
  assert.equal(comboSchema.safeParse(combos.formToComboInput({ ...form, productIds: [] })).success, true, "so com todas as formacoes");

  // O mesmo campo no codigo de venda do produto sozinho.
  assert.equal(updateProductAccessSchema.safeParse({ expectedUpdatedAt: "2026-11-28T10:00:00.000Z", id: "curso-a", saleAccessTerm: ANO }).success, true);
  assert.equal(updateProductAccessSchema.safeParse({ expectedUpdatedAt: "2026-11-28T10:00:00.000Z", id: "curso-a", saleAccessTerm: null }).success, true, "para sempre");
  assert.equal(updateProductAccessSchema.safeParse({ expectedUpdatedAt: "2026-11-28T10:00:00.000Z", id: "curso-a", saleAccessTerm: { amount: 5000, unit: "days" } }).success, false);
  assert.equal(accessTermSchema.safeParse({ amount: 12, unit: "months" }).success, true);
});

/* ------------------------------------------------------------------------------------------------
 * A importacao
 * ---------------------------------------------------------------------------------------------- */

test("importação: a data de término, ou vitalício, por produto (na célula de Produtos ou na coluna Término)", () => {
  assert.equal(importModel.parseAccessEndCell("31/12/2027"), "2027-12-31");
  assert.equal(importModel.parseAccessEndCell("1-2-2028"), "2028-02-01");
  assert.equal(importModel.parseAccessEndCell("2027-12-31"), "2027-12-31");
  for (const texto of ["vitalício", "Vitalicio", "PARA SEMPRE", "sem prazo"]) {
    assert.equal(importModel.parseAccessEndCell(texto), null, texto);
  }
  for (const texto of ["31/02/2027", "amanhã", "12/2027", "2027-13-01"]) {
    assert.equal(importModel.parseAccessEndCell(texto), undefined, texto);
  }

  const products = [{ id: "curso-a", title: "Prompts do Zero" }, { id: "form-b", title: "Formação Agentes" }, { id: "curso-c", title: "Automações" }];
  const mapping = importModel.detectImportMapping(["Nome", "E-mail", "Produtos", "Término"]);
  assert.deepEqual(mapping, { email: 1, ends: 3, fullName: 0, products: 2 });

  const preview = importModel.buildImportPreview({
    cohorts: [],
    mapping,
    products,
    rows: [
      // O termino de cada produto na propria celula; o que nao traz segue a coluna Término.
      ["Ana Souza", "ana@exemplo.com", "Prompts do Zero = vitalício | Formação Agentes = 30/06/2027 | Automações", "31/12/2027"],
      // So a coluna Término: vale para todos os produtos da linha.
      ["Bruno Lima", "bruno@exemplo.com", "Prompts do Zero | form-b", "Vitalício"],
      // Sem termino nenhum: segue o "Acesso até" da tela.
      ["Carla Dias", "carla@exemplo.com", "Prompts do Zero", ""],
      // Datas erradas viram erro da linha, nunca acesso sem prazo por engano.
      ["Davi Reis", "davi@exemplo.com", "Prompts do Zero = 31/02/2027", ""],
      ["Elis Maia", "elis@exemplo.com", "Prompts do Zero", "ano que vem"]
    ]
  });

  assert.equal(preview[0].ok, true);
  assert.deepEqual(preview[0].row.productIds, ["curso-a", "form-b", "curso-c"]);
  assert.deepEqual(preview[0].row.productEndsAt, { "curso-a": null, "curso-c": "2027-12-31", "form-b": "2027-06-30" });
  assert.deepEqual(preview[0].summary.productTitles, ["Prompts do Zero (vitalício)", "Formação Agentes (até 30/06/2027)", "Automações (até 31/12/2027)"]);

  assert.deepEqual(preview[1].row.productEndsAt, { "curso-a": null, "form-b": null });
  assert.deepEqual(preview[2].row.productEndsAt, {});
  assert.deepEqual(preview[2].summary.productTitles, ["Prompts do Zero"]);

  assert.equal(preview[3].ok, false);
  assert.match(preview[3].errors.join(" "), /término “31\/02\/2027” de “Prompts do Zero” inválido: use dd\/mm\/aaaa ou “vitalício”/);
  assert.equal(preview[4].ok, false);
  assert.match(preview[4].errors.join(" "), /término “ano que vem” inválido/);

  // O servidor revalida a linha com o mesmo schema: data fora do formato nao passa.
  assert.equal(importRowSchema.safeParse({ ...preview[0].row }).success, true);
  assert.equal(importRowSchema.safeParse({ ...preview[0].row, productEndsAt: { "curso-a": "31/12/2027" } }).success, false);
  assert.deepEqual(importRowSchema.parse({ email: "f@exemplo.com", fullName: "Fabi Luz", index: 1, phone: null }).productEndsAt, {}, "linha antiga, sem o campo");

  assert.match(importModel.importTemplateCsv(), /Nome do produto = vitalício \| Outro produto = 30\/06\/2027/);
});

/* ------------------------------------------------------------------------------------------------
 * A migracao 202611280001 (sem banco local: confere o contrato no SQL)
 * ---------------------------------------------------------------------------------------------- */

test("migração 202611280001: o prazo nas colunas, a tabela de todas as formações só para a chave de serviço e a função nova", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202611280001_access_terms_all_formations.sql", import.meta.url), "utf8");

  for (const [table, columns] of [
    ["product_combo_items", ["access_unit", "access_amount"]],
    ["sales_product_links", ["access_unit", "access_amount"]],
    ["product_combos", ["all_formations", "all_formations_unit", "all_formations_amount"]],
    ["sale_grants", ["term_unit", "term_amount", "purchased_at"]]
  ]) {
    const alter = sql.slice(sql.indexOf(`alter table public.${table}\n  add column if not exists`));
    for (const column of columns) {
      assert.match(alter.slice(0, alter.indexOf(";")), new RegExp(`add column if not exists ${column} `), `${table}.${column}`);
    }
  }

  // O padrao e "para sempre": nenhuma coluna de prazo e obrigatoria nem tem valor inicial.
  assert.doesNotMatch(sql, /access_unit text not null|term_unit text not null|access_amount integer not null/);
  assert.match(sql, /all_formations boolean not null default false/);
  // O par (unidade, quantidade) anda junto, com as tres unidades e o teto.
  assert.equal((sql.match(/in \('days', 'months', 'years'\)/g) ?? []).length, 5);

  // A tabela nova: uma concessao por (venda, aluno), nada para o navegador.
  assert.match(sql, /create table if not exists public\.all_formations_grants \(/);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /create unique index if not exists all_formations_grants_sale_idx\s+on public\.all_formations_grants \(provider, transaction_id, user_id\);/);
  assert.match(sql, /alter table public\.all_formations_grants enable row level security;/);
  assert.match(sql, /revoke all on public\.all_formations_grants from anon, authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on public\.all_formations_grants to service_role;/);
  assert.doesNotMatch(sql, /create policy/, "nenhuma politica: so a chave de servico le e grava");

  // A funcao nova: security invoker, fora do alcance do navegador; a antiga continua existindo.
  const signature = "admin_save_combo_v2(text, boolean, text, text, text, text, jsonb, boolean, text, integer)";
  const body = sql.slice(sql.indexOf("function public.admin_save_combo_v2("));
  assert.match(body.slice(0, body.indexOf("$$")), /security invoker\s+set search_path = public/);
  assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
  assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  assert.doesNotMatch(sql, /drop function|drop table|drop column/);
});
