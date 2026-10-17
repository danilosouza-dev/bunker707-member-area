import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Pacotes: mapeamento das linhas (product_combos + itens + produtos) para a tela, formulario e a
// validacao pelo mesmo schema da Server Action (comboSchema).

const combos = await import("../src/server/catalog/combo-model.ts");
const { comboSchema, deleteComboSchema } = await import("../src/server/catalog/schemas.ts");

const comboRows = [
  { cohort_name: "Turma B", description: "Tudo de IA", id: "combo-ia", name: "Pacote IA", status: "active", updated_at: "2026-10-01T10:00:00Z" },
  { cohort_name: "", description: null, id: "combo-velho", name: "Antigo", status: "estranho", updated_at: "2026-09-01T10:00:00Z" },
  { cohort_name: null, description: "", id: "combo-novo", name: "Novo", status: "paused", updated_at: "2026-10-09T10:00:00Z" }
];

const itemRows = [
  { combo_id: "combo-ia", product_id: "curso-b", sort_order: 1 },
  { combo_id: "combo-ia", product_id: "form-a", sort_order: 0 },
  { combo_id: "combo-ia", product_id: "apagado", sort_order: 2 },
  { combo_id: "combo-novo", product_id: "curso-b", sort_order: 0 }
];

const productRows = [
  { id: "form-a", image: "https://cdn.exemplo.com/a.webp", kind: "Formacao", publication_status: "published", title: "Formação A" },
  { id: "curso-b", image: " ", kind: "Curso", publication_status: "draft", title: "Curso B" }
];

test("linhas do banco viram a lista da tela: produtos na ordem gravada, turma e situacao com padrao", () => {
  const list = combos.mapComboRows({
    accents: [{ accent: "laranja", content_id: "form-a" }],
    combos: comboRows,
    items: itemRows,
    products: productRows
  });

  assert.deepEqual(
    list.map((combo) => combo.id),
    ["combo-novo", "combo-ia", "combo-velho"],
    "mais recentes primeiro"
  );

  const ia = list.find((combo) => combo.id === "combo-ia");
  assert.deepEqual(
    ia.products.map((product) => [product.id, product.coverUrl]),
    [
      ["form-a", "https://cdn.exemplo.com/a.webp"],
      ["curso-b", null]
    ],
    "produto apagado fica de fora; capa em branco vira null"
  );
  assert.equal(ia.products[0].accent, "laranja");
  assert.equal(ia.cohortName, "Turma B");
  assert.equal(ia.status, "active");
  assert.equal(ia.description, "Tudo de IA");

  const old = list.find((combo) => combo.id === "combo-velho");
  assert.equal(old.cohortName, combos.DEFAULT_COHORT_NAME);
  assert.equal(old.status, "draft", "situacao desconhecida vira rascunho");
  assert.equal(old.description, "");
  assert.deepEqual(old.products, []);
});

test("seletor de produtos do pacote: formato e situacao do produto, em ordem alfabetica", () => {
  const options = combos.mapComboProductOptions(
    [...productRows, { id: "aula-1", image: null, kind: "Aula", publication_status: "published", title: "Aula solta" }],
    []
  );

  assert.deepEqual(
    options.map((option) => [option.id, option.format, option.situation]),
    [
      ["curso-b", "curso", "draft"],
      ["form-a", "formacao", "published"]
    ]
  );
});

test("formulario: ida e volta sem perder nada, turma padrao fica em branco", () => {
  const [ia] = combos.mapComboRows({ accents: [], combos: [comboRows[0]], items: itemRows, products: productRows });
  const form = combos.comboToForm(ia);

  assert.deepEqual(form, {
    cohortName: "Turma B",
    description: "Tudo de IA",
    hotmartProductId: "",
    name: "Pacote IA",
    productIds: ["form-a", "curso-b"],
    status: "active"
  });
  assert.equal(combos.comboToForm({ ...ia, cohortName: "Turma A" }).cohortName, "", "turma padrao aparece como placeholder");
  assert.deepEqual(combos.comboToForm(null), { cohortName: "", description: "", hotmartProductId: "", name: "", productIds: [], status: "draft" });

  const input = combos.formToComboInput({ ...form, name: "  Pacote IA 2 ", productIds: ["form-a", "form-a", "curso-b"] }, "combo-ia");
  assert.deepEqual(input, {
    cohortName: "Turma B",
    description: "Tudo de IA",
    hotmartProductId: "",
    id: "combo-ia",
    name: "Pacote IA 2",
    productIds: ["form-a", "curso-b"],
    status: "active"
  });

  // Codigo da Hotmart: vem da ligacao gravada e volta no pedido; vazio tira a ligacao (null no schema).
  const [ligado] = combos.mapComboRows({
    accents: [],
    combos: [comboRows[0]],
    items: itemRows,
    products: productRows,
    salesLinks: [{ combo_id: comboRows[0].id, external_product_id: "7002" }]
  });
  assert.equal(ligado.hotmartProductId, "7002");
  assert.equal(combos.comboToForm(ligado).hotmartProductId, "7002");
  assert.equal(comboSchema.parse(combos.formToComboInput(combos.comboToForm(ligado))).hotmartProductId, "7002");
  assert.equal(comboSchema.parse(combos.formToComboInput({ ...combos.comboToForm(ligado), hotmartProductId: " " })).hotmartProductId, null);
  assert.equal(comboSchema.safeParse({ hotmartProductId: "12 34", name: "IA", productIds: ["a"] }).success, false, "codigo com espaco e recusado");
  assert.equal("id" in combos.formToComboInput(form), false, "pacote novo nao manda id");
  assert.equal(combos.isComboFormDirty(form, { ...form }), false);
  assert.equal(combos.isComboFormDirty(form, { ...form, status: "paused" }), true);
});

test("o mesmo schema da Server Action valida o formulario", () => {
  const empty = comboSchema.safeParse(combos.formToComboInput(combos.comboToForm(null)));
  assert.equal(empty.success, false);
  const messages = Object.fromEntries(empty.error.issues.map((issue) => [issue.path[0], issue.message]));
  assert.equal(messages.name, "Dê um nome ao pacote.");
  assert.equal(messages.productIds, "Escolha pelo menos um produto.");

  const ok = comboSchema.parse(combos.formToComboInput({ ...combos.comboToForm(null), name: "IA", productIds: ["form-a"] }));
  assert.equal(ok.status, "draft");
  assert.equal(ok.cohortName, "");

  assert.equal(comboSchema.safeParse({ name: "IA", productIds: ["../x"] }).success, false, "id de produto invalido");
  assert.equal(comboSchema.safeParse({ name: "IA", productIds: ["a"], status: "deleted" }).success, false);
  assert.equal(deleteComboSchema.safeParse({ id: "combo-ia" }).success, true);
});

test("situacao do pacote: rotulo, tom e efeito escrito", () => {
  assert.deepEqual(
    combos.COMBO_STATUSES.map((status) => [combos.COMBO_STATUS_LABELS[status], combos.comboStatusTone(status)]),
    [
      ["Rascunho", "neutral"],
      ["Ativo", "success"],
      ["Pausado", "warning"]
    ]
  );
  assert.match(combos.COMBO_STATUS_HINTS.active, /liberam todos os produtos/);
  assert.deepEqual(combos.summarizeComboProducts([1, 2, 3, 4, 5]), { extra: 2, visible: [1, 2, 3] });
  assert.deepEqual(combos.summarizeComboProducts([1]), { extra: 0, visible: [1] });
});

test("data relativa da coluna Atualizado", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  assert.equal(combos.formatRelativeDate("2026-10-10T11:59:40Z", now), "agora há pouco");
  assert.equal(combos.formatRelativeDate("2026-10-10T11:15:00Z", now), "há 45 min");
  assert.equal(combos.formatRelativeDate("2026-10-10T07:00:00Z", now), "há 5 h");
  assert.equal(combos.formatRelativeDate("2026-10-09T10:00:00Z", now), "ontem");
  assert.equal(combos.formatRelativeDate("2026-10-05T12:00:00Z", now), "há 5 dias");
  assert.equal(combos.formatRelativeDate("2026-09-12T12:00:00Z", now), "há 4 semanas");
  assert.equal(combos.formatRelativeDate("2026-01-02T12:00:00Z", now), "02/01/2026");
  assert.equal(combos.formatRelativeDate(null, now), "—");
  assert.equal(combos.formatRelativeDate("ontem", now), "—");
});

test("acoes de pacote: permissao de acesso e venda, escrita granular e cache do catalogo invalidado", async () => {
  const source = await readFile(new URL("../src/server/catalog/combo-actions.ts", import.meta.url), "utf8");

  assert.match(source, /^"use server";/);
  assert.equal(source.match(/runAdminAction\("catalog\.access"/g)?.length, 2, "salvar e excluir checam a permissao de acesso e venda");
  assert.equal(source.match(/invalidateCatalog\(\{ from: "action" \}\)/g)?.length, 2, "salvar e excluir invalidam o catalogo");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /readAdminDatabase|upsertProductCombo|getAdminDashboardData|upsertRows/, "sem regravar o banco inteiro");
});
