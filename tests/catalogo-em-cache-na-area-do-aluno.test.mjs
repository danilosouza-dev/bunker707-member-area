import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Cache do catalogo na area do aluno (platform-store; docs/17 §2.3 e docs/20 §12.1). No teste de carga de
// 19/10/2026 cada pagina do aluno relia o catalogo inteiro (produtos, configuracoes de pagina, modulos,
// aulas e platform_settings): 5 das 10 consultas por pagina, iguais para todos os alunos. Agora essas
// linhas vem de unstable_cache com a tag do catalogo, que toda gravacao do produtor invalida; progresso,
// favoritos e acessos do aluno continuam lidos a cada pagina, e o admin continua lendo direto do banco.
// Banco falso (admin-action-stubs) e um "next/cache" que memoriza de verdade e esquece pela tag.

const nextCache = (globalThis.__nextCacheStub = { entries: new Map(), registered: [] });
const nextCacheSource = `
const state = globalThis.__nextCacheStub;
const forget = (tag) => {
  for (const [key, entry] of state.entries) if (entry.tags.includes(tag)) state.entries.delete(key);
};
export function unstable_noStore() {}
export function revalidatePath() {}
export function refresh() {}
export function revalidateTag(tag) { forget(tag); }
export function updateTag(tag) { forget(tag); }
export function unstable_cache(fn, keyParts = [], options = {}) {
  state.registered.push({ keyParts, options });
  return async (...args) => {
    const key = JSON.stringify([keyParts, args]);
    if (!state.entries.has(key)) {
      // Como o Next: o resultado e gravado em JSON, entao so dado serializavel sobrevive.
      state.entries.set(key, { tags: options.tags ?? [], value: JSON.parse(JSON.stringify(await fn(...args))) });
    }
    return state.entries.get(key).value;
  };
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(nextCacheSource)}` };
    }

    return nextResolve(specifier, context);
  }
});

const store = await import("../src/server/db/platform-store.ts");
const { CATALOG_TAG } = await import("../src/server/catalog/cache-policy.ts");
const { revalidateTag } = await import("next/cache");

const ALUNA = { app_metadata: {}, email: "aluna@bunker707.test", id: "00000000-0000-4000-8000-000000000071", user_metadata: { full_name: "Aluna Cache" } };
const OUTRO_ALUNO = { app_metadata: {}, email: "aluno@bunker707.test", id: "00000000-0000-4000-8000-000000000072", user_metadata: {} };
const CATALOGO = ["content_items", "content_page_settings", "course_modules", "lessons", "platform_settings"];
const DO_ALUNO = ["entitlements", "lesson_progress", "saved_items"];

function curso(id, title, publicationStatus = "published") {
  return {
    access_model: "closed",
    bucket: "courses",
    commerce_scope: "sellable_product",
    description: `Curso ${title}`,
    eyebrow: "Curso",
    id,
    image: "/hero/bunker-ai-hero.png",
    is_locked: false,
    kind: "Curso",
    lessons_label: "1 aula",
    listing: "listed",
    progress: 0,
    publication_status: publicationStatus,
    purchase_label: "Comprar",
    purchase_url: "https://exemplo.test/comprar",
    sort_order: 1,
    status: "Liberado",
    title
  };
}

function acesso(userId, targetId) {
  return { ends_at: null, starts_at: "2026-01-01T00:00:00.000Z", status: "active", target_id: targetId, target_type: "standalone_course", user_id: userId };
}

function usarBanco(contentItems) {
  const db = createFakeDb({
    tables: {
      admin_roles: [],
      content_items: contentItems,
      content_page_settings: [],
      course_modules: [],
      entitlements: [acesso(ALUNA.id, "curso-cache"), acesso(OUTRO_ALUNO.id, "curso-cache")],
      lesson_progress: [],
      lessons: [],
      platform_settings: [],
      profiles: [],
      saved_items: []
    }
  });
  actionStubs.db = db;
  return db;
}

function leituras(db, tabelas) {
  return Object.fromEntries(tabelas.map((tabela) => [tabela, db.calls.from.filter((lida) => lida === tabela).length]));
}

const vezes = (tabelas, n) => Object.fromEntries(tabelas.map((tabela) => [tabela, n]));

test.beforeEach(() => {
  nextCache.entries.clear();
});

test("o loader do aluno fica em unstable_cache com a tag do catalogo e rede de seguranca de 60 s", () => {
  const registro = nextCache.registered.find(({ keyParts }) => keyParts.join("/") === "member-area/published-rows/v1");

  assert.ok(registro, "platform-store registra o cache do catalogo do aluno");
  assert.deepEqual(registro.options.tags, [CATALOG_TAG], "a mesma tag que invalidateCatalog limpa");
  assert.equal(registro.options.revalidate, 60);
});

test("tres paginas de dois alunos leem o catalogo uma vez; acessos, progresso e favoritos a cada pagina", async () => {
  const db = usarBanco([curso("curso-cache", "Curso em cache")]);

  const primeira = await store.getHomePageData(undefined, ALUNA);
  await store.getPurchasesPageData(undefined, ALUNA);
  const doOutro = await store.getHomePageData(undefined, OUTRO_ALUNO);

  assert.deepEqual(leituras(db, CATALOGO), vezes(CATALOGO, 1));
  assert.deepEqual(leituras(db, DO_ALUNO), vezes(DO_ALUNO, 3));
  // O cache nao mistura alunos: cada um ve o curso pelo proprio acesso.
  for (const pagina of [primeira, doOutro]) {
    const ids = pagina.homeRows.flatMap((row) => row.items.map((item) => item.id));
    assert.ok(ids.includes("curso-cache"), "o curso comprado aparece na home");
  }
});

test("rascunho nunca entra no cache do aluno; invalidar a tag faz a proxima pagina reler e mostrar o publicado", async () => {
  const conteudo = [curso("curso-cache", "Curso em cache"), curso("curso-rascunho", "Curso em rascunho", "draft")];
  const db = usarBanco(conteudo);
  const idsDaHome = async () => (await store.getHomePageData(undefined, ALUNA)).homeRows.flatMap((row) => row.items.map((item) => item.id));

  assert.ok(!(await idsDaHome()).includes("curso-rascunho"), "rascunho fora da home");

  // O produtor publica: a gravacao chama invalidateCatalog, que limpa a tag do catalogo.
  conteudo[1].publication_status = "published";
  assert.ok(!(await idsDaHome()).includes("curso-rascunho"), "sem invalidar, a home segue do cache");
  revalidateTag(CATALOG_TAG, "max");
  assert.ok((await idsDaHome()).includes("curso-rascunho"), "depois da invalidacao o curso publicado aparece");
  assert.equal(leituras(db, ["content_items"]).content_items, 2);
});

test("o admin le o catalogo direto do banco a cada chamada, com rascunhos", async () => {
  const db = usarBanco([curso("curso-cache", "Curso em cache"), curso("curso-rascunho", "Curso em rascunho", "draft")]);

  await store.getContentRouteParams();
  const rotas = await store.getContentRouteParams();

  assert.deepEqual(leituras(db, CATALOGO), vezes(CATALOGO, 2));
  assert.deepEqual(rotas.map((rota) => rota.id).sort(), ["curso-cache", "curso-rascunho"]);
  assert.equal(nextCache.entries.size, 0, "nada do admin vai para o cache");
});
