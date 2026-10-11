import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Busca global do admin (Cmd/Ctrl+K, prototipo aprovado): modelo puro em
// src/components/admin/v2/search-model.ts, leitura em src/server/admin/search.ts e a Server Action em
// src/server/admin/search-actions.ts. search-model.ts importa caminhos sem extensao, entao o hook de
// resolucao entra antes e o modulo e carregado com import() dinamico.
await import("./support/resolve-extensionless-ts.mjs");
const model = await import("../src/components/admin/v2/search-model.ts");

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const v2RouteDir = join(repoRoot, "src/app/admin/(v2)");
const readSource = (path) => readFile(join(repoRoot, path), "utf8");

const hit = (id, title, meta = "") => ({ href: `/x/${id}`, id, meta, title });

test("normaliza o texto: minusculas, sem acento e com espacos simples", () => {
  assert.equal(model.normalizeAdminSearchText("  Formação   IA  "), "formacao ia");
  assert.equal(model.normalizeAdminSearchText("COMUNICAÇÃO"), "comunicacao");
  assert.equal(model.normalizeAdminSearchText("Área de Membros"), "area de membros");
  assert.equal(model.normalizeAdminSearchText(null), "");
  assert.equal(model.normalizeAdminSearchText(undefined), "");

  assert.equal(model.cleanAdminSearchQuery("  agentes   de ia "), "agentes de ia");
  assert.equal(model.cleanAdminSearchQuery("a".repeat(120)).length, model.ADMIN_SEARCH_MAX_LENGTH);
});

test("o banco so e consultado com 2 letras ou mais (espaco nao conta)", () => {
  assert.equal(model.ADMIN_SEARCH_MIN_LENGTH, 2);
  assert.equal(model.ADMIN_SEARCH_DEBOUNCE_MS, 150);
  assert.equal(model.ADMIN_SEARCH_GROUP_LIMIT, 5);

  assert.equal(model.shouldSearchAdminCatalog(""), false);
  assert.equal(model.shouldSearchAdminCatalog("a"), false);
  assert.equal(model.shouldSearchAdminCatalog(" a  "), false);
  assert.equal(model.shouldSearchAdminCatalog("ia"), true);
  assert.equal(model.shouldSearchAdminCatalog("  ia "), true);
  assert.equal(model.shouldSearchAdminCatalog(null), false);
});

test("enderecos de produto, modulo e aula", () => {
  assert.equal(model.buildAdminProductHref("curso-ia"), "/admin/produtos/curso-ia");
  assert.equal(model.buildAdminModuleHref("curso-ia"), "/admin/produtos/curso-ia", "modulo abre a arvore do produto dono");
  assert.equal(model.buildAdminLessonHref("curso-ia", "aula-1"), "/admin/produtos/curso-ia?aula=aula-1");
  assert.equal(model.buildAdminLessonHref("a b", "c&d"), "/admin/produtos/a%20b?aula=c%26d");
  assert.equal(model.formatAdminLessonMeta("Formação Agentes de IA", "Comece por aqui"), "Formação Agentes de IA › Comece por aqui");
  assert.equal(model.formatAdminLessonMeta("Prompts do Zero", null), "Prompts do Zero");
  assert.equal(model.formatAdminLessonMeta(null, "  "), "");
});

test("telas e acoes estaticas apontam so para destinos que existem", () => {
  const items = model.listAdminStaticSearchItems();
  const allowedOutside = new Set(["/", "/admin/legado", "/admin/legado?tela=alunos"]);

  assert.ok(items.length >= 10);

  for (const item of items) {
    assert.ok(["screens", "actions"].includes(item.group), item.id);

    if (allowedOutside.has(item.href)) {
      continue;
    }

    const route = item.href.replace(/^\/admin/, "");
    assert.ok(existsSync(join(v2RouteDir, route, "page.tsx")), `${item.title} -> ${item.href} precisa de page.tsx`);
  }

  const titles = items.map((item) => item.title);
  for (const missing of ["Novo aviso", "Novo webinário", "Nova promoção"]) {
    assert.ok(!titles.includes(missing), `${missing} ainda nao existe`);
  }

  assert.equal(new Set(items.map((item) => item.id)).size, items.length, "ids unicos");
});

test("campo vazio mostra Acoes e Telas principais, nessa ordem", () => {
  const groups = model.buildAdminSearchGroups("");

  assert.deepEqual(groups.map((group) => group.label), ["Ações", "Telas"]);
  assert.deepEqual(
    groups[0].items.map((item) => item.title),
    ["Novo produto", "Importar playlist do YouTube", "Adicionar aluno"]
  );
  assert.equal(groups[0].items[2].meta, "admin antigo");
  assert.deepEqual(
    groups[1].items.map((item) => item.title),
    ["Visão geral", "Alunos", "Produtos", "Área de membros", "Comunicação", "Comunidade", "Configurações"]
  );
});

test("texto: grupos na ordem Produtos · Módulos · Aulas · Telas · Ações, 5 por grupo", () => {
  const results = {
    lessons: Array.from({ length: 7 }, (_, index) => hit(`l${index}`, `Aula ${index}`, "Produto › Módulo")),
    modules: [hit("m1", "Ferramentas do agente", "Formação Agentes de IA")],
    products: [hit("p1", "Formação Agentes de IA", "Formação")]
  };
  const groups = model.buildAdminSearchGroups("agente", results);

  assert.deepEqual(groups.map((group) => group.id), ["products", "modules", "lessons", "actions"]);
  assert.equal(groups.find((group) => group.id === "lessons").items.length, 5);
  assert.equal(groups[0].items[0].meta, "Formação");

  const flat = model.flattenAdminSearchGroups(groups);
  assert.equal(flat[0].title, "Formação Agentes de IA");
  assert.equal(flat.at(-1).title, "Buscar “agente” em alunos");
  assert.equal(flat.at(-1).href, "/admin/legado?tela=alunos&busca=agente");
  assert.equal(new Set(flat.map((item) => item.id)).size, flat.length);
});

test("texto casa com telas e acoes sem acento e por palavras", () => {
  const titles = (query) => model.flattenAdminSearchGroups(model.buildAdminSearchGroups(query)).map((item) => item.title);

  assert.deepEqual(titles("comunicacao").slice(0, 1), ["Comunicação"]);
  assert.ok(titles("webinarios").includes("Webinários"));
  assert.ok(titles("tutor").includes("Tutor IA"));
  assert.ok(titles("youtube").includes("Importar playlist do YouTube"));
  assert.ok(titles("area membros").includes("Área de membros"));
  assert.deepEqual(titles("x"), [], "1 letra sem nada parecido: lista vazia (o campo mostra 'Nada encontrado')");
  assert.ok(!titles("x").some((title) => title.includes("em alunos")), "busca de alunos so com 2 letras");
});

test("Server Action valida o texto e usa o papel de leitura; a leitura so traz nome, contexto e endereco", async () => {
  const action = await readSource("src/server/admin/search-actions.ts");
  const server = await readSource("src/server/admin/search.ts");

  assert.match(action, /^"use server";/);
  assert.match(action, /runAdminAction\("admin\.read", searchAdminSchema, raw,/);
  assert.match(action, /min\(ADMIN_SEARCH_MIN_LENGTH/);

  assert.match(server, /^import "server-only";/);
  assert.match(server, /likeContains\(query\)/, "% e _ do texto nao viram curinga");
  assert.match(server, /\.neq\("status", "deleted"\)/);
  assert.match(server, /PRODUCT_UNIVERSE/);
  assert.doesNotMatch(server, /select\("\*"\)/);
});
