import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Visitas das paginas da area do aluno (Comunicacao v2, docs/23): a chave normalizada de cada pagina que
// um fluxo pode acompanhar, igual ao formato que o banco confere (member_page_visits.page_key). Modulo
// puro (src/server/member-area/page-visit-model.ts).

const model = await import("../src/server/member-area/page-visit-model.ts");

test("chave de cada rota da area do aluno; a aula conta como visita ao produto", () => {
  const rotas = {
    "/": "home",
    "/minhas-compras": "purchases",
    "/favoritos": "saved",
    "/materiais": "materials",
    "/minha-jornada": "journey",
    "/continue-assistindo": "continue",
    "/perfil": "profile",
    "/suporte": "support",
    "/conteudo/formacao-ia": "content:formacao-ia",
    "/conteudo/formacao-ia/aulas/modulo-1": "content:formacao-ia",
    "/minhas-compras/": "purchases"
  };

  for (const [rota, chave] of Object.entries(rotas)) {
    assert.equal(model.pageKeyOfRoute(rota), chave, rota);
  }

  assert.equal(model.pageKeyOfRoute("/admin"), null, "admin nao e pagina do aluno");
  assert.equal(model.pageKeyOfRoute("/conteudo"), null);
  assert.equal(model.pageKeyOfRoute("/conteudo/formacao-ia/aulas"), null);
  assert.equal(model.pageKeyOfRoute("/conteudo/curso%20novo"), null, "id fora do formato");
  assert.equal(model.pageKeyOfRoute("//outro-site.test"), null);
  assert.equal(model.pageKeyOfRoute("perfil"), null);
});

test("pagina do botao: tira query e hash; produtos e paginas fixas; qualquer outro caminho e link externo -> null", () => {
  assert.equal(model.pageKeyOfHref("/conteudo/formacao-ia"), "content:formacao-ia");
  assert.equal(model.pageKeyOfHref("/conteudo/curso-x/aulas/modulo-y?lessonId=aula-z"), "content:curso-x", "aula com query e o produto");
  assert.equal(model.pageKeyOfHref("/minhas-compras?aba=ativas#topo"), "purchases");
  assert.equal(model.pageKeyOfHref("/#destaque"), "home");
  assert.equal(model.pageKeyOfHref(" /favoritos "), "saved");
  assert.equal(model.pageKeyOfHref("/algo-novo"), null, "o servidor aceita qualquer caminho interno, mas so estes sao acompanhados");
  assert.equal(model.pageKeyOfHref("https://pay.hotmart.com/X123"), null, "link externo");
  assert.equal(model.pageKeyOfHref("//outro-site.test/conteudo/x"), null);
  assert.equal(model.pageKeyOfHref(""), null);
  assert.equal(model.pageKeyOfHref(null), null);
});

test("formato da chave: o mesmo do banco; o beacon so manda produto ou Comprar", () => {
  for (const chave of [...model.FIXED_PAGE_KEYS, "content:formacao-ia", "checkout:formacao-ia", `content:${"a".repeat(240)}`]) {
    assert.ok(model.isPageKey(chave), chave);
  }

  for (const chave of ["loja", "content:", "content:a b", "checkout:x/y", `content:${"a".repeat(241)}`, "/conteudo/x", "Home"]) {
    assert.equal(model.isPageKey(chave), false, chave);
  }

  assert.ok(model.BEACON_PAGE_KEY_PATTERN.test("content:formacao-ia"));
  assert.ok(model.BEACON_PAGE_KEY_PATTERN.test("checkout:formacao-ia"));
  assert.equal(model.BEACON_PAGE_KEY_PATTERN.test("home"), false, "navegacao e gravada pelo servidor, nao pelo beacon");

  assert.equal(model.contentPageKey("formacao-ia"), "content:formacao-ia");
  assert.equal(model.checkoutPageKey("formacao-ia"), "checkout:formacao-ia");
  assert.equal(model.contentPageKey("a b"), null);
  assert.equal(model.pageKeyOfTarget({ kind: "checkout", productId: "formacao-ia" }), "checkout:formacao-ia");
  assert.equal(model.pageKeyOfTarget({ key: "journey", kind: "fixed" }), "journey");
});

test("paginas fixas: nome e endereco de cada uma, na ordem do menu", () => {
  assert.deepEqual(model.FIXED_PAGE_KEYS, ["home", "purchases", "saved", "materials", "journey", "continue", "profile", "support"]);
  assert.deepEqual(
    model.FIXED_PAGE_KEYS.map((key) => model.FIXED_PAGE_LABELS[key]),
    ["Início", "Minhas compras", "Favoritos", "Materiais", "Minha jornada", "Continue assistindo", "Perfil", "Suporte"]
  );

  for (const key of model.FIXED_PAGE_KEYS) {
    assert.equal(model.pageKeyOfRoute(model.FIXED_PAGE_PATHS[key]), key, `${key} volta pela rota`);
  }
});
