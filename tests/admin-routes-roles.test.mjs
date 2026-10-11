import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Rotas REST legadas do admin (src/app/api/admin/**) depois da fase 1:
// - toda escrita passa por requireApiRole(acao) (ou requireApiAdmin({ roles }) nas de alunos) e o
//   conjunto de papeis exclui "analyst": analista recebe 403 em qualquer escrita;
// - toda leitura tem guarda;
// - as rotas que mudam o catalogo invalidam o cache dele com { from: "route" } depois de gravar.

const { ADMIN_ACTION_ROLES, rolesFor } = await import("../src/server/auth/roles.ts");

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const apiRoot = join(repoRoot, "src/app/api/admin");

function listRoutes(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listRoutes(path);
    }

    return entry === "route.ts" ? [path] : [];
  });
}

/** Corpo de cada handler exportado: do `export async function X(` ate o proximo export. */
function handlers(source) {
  const pattern = /export async function (GET|POST|PUT|PATCH|DELETE)\(/g;
  const starts = [...source.matchAll(pattern)];

  return starts.map((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    return { body: source.slice(match.index, end), method: match[1] };
  });
}

/** Papeis liberados pela guarda do handler; null quando nao ha guarda reconhecida. */
function guardRoles(body) {
  const role = /requireApiRole\("([a-z_.]+)"\)/.exec(body);

  if (role) {
    assert.ok(Object.hasOwn(ADMIN_ACTION_ROLES, role[1]), `acao desconhecida: ${role[1]}`);
    return rolesFor(role[1]);
  }

  const admin = /requireApiAdmin\(\{\s*roles:\s*\[([^\]]*)\]\s*\}\)/.exec(body);

  if (admin) {
    return [...admin[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  }

  return null;
}

const routes = listRoutes(apiRoot).map((path) => ({
  name: relative(apiRoot, path).replace(/\/route\.ts$/, ""),
  source: readFileSync(path, "utf8")
}));

test("a varredura encontrou as rotas do admin", () => {
  assert.ok(routes.length >= 25, `rotas encontradas: ${routes.length}`);
  assert.ok(routes.some((route) => route.name === "content"));
});

test("analista recebe 403 em qualquer escrita das rotas do admin", () => {
  for (const route of routes) {
    for (const handler of handlers(route.source).filter((item) => item.method !== "GET")) {
      const roles = guardRoles(handler.body);
      const label = `${handler.method} /api/admin/${route.name}`;

      assert.ok(roles, `${label}: precisa de requireApiRole(acao) ou requireApiAdmin({ roles })`);
      assert.ok(roles.length > 0, `${label}: ninguem pode executar`);
      assert.ok(!roles.includes("analyst"), `${label}: analista nao pode escrever`);
      assert.match(handler.body, /if \(auth\.response/, `${label}: a recusa da guarda volta antes de qualquer escrita`);
    }
  }
});

test("toda leitura das rotas do admin tem guarda", () => {
  for (const route of routes) {
    for (const handler of handlers(route.source).filter((item) => item.method === "GET")) {
      assert.ok(guardRoles(handler.body) || /requireApiAdmin\(\)/.test(handler.body), `GET /api/admin/${route.name}: sem guarda`);
    }
  }
});

test("cada escrita usa a acao certa do mapa da fase 1", () => {
  const expected = {
    appearance: { PUT: "storefront.write" },
    cohorts: { POST: "catalog.write" },
    collections: { POST: "settings.ai" },
    combos: { DELETE: "catalog.write", POST: "catalog.write" },
    content: { DELETE: "catalog.delete", PATCH: "catalog.write", POST: "catalog.write" },
    "home-sections": { PUT: "storefront.write" },
    "lessons/[lessonId]/transcript": { PUT: "catalog.write" },
    "lessons/[lessonId]/transcript/import-youtube": { POST: "catalog.write" },
    "lessons/[lessonId]/tutor/process": { POST: "catalog.write" },
    lessons: { DELETE: "catalog.write", PATCH: "catalog.write", POST: "catalog.write" },
    "moderation/blocked-words": { POST: "community.moderate" },
    "moderation/blocked-words/[ruleId]": { DELETE: "community.moderate", PATCH: "community.moderate" },
    "moderation/comments/[commentId]": { PATCH: "community.moderate" },
    modules: { DELETE: "catalog.write", PATCH: "catalog.write", POST: "catalog.write" },
    "youtube-playlists/import": { POST: "catalog.write" },
    "youtube-playlists/preview": { POST: "catalog.write" }
  };

  for (const [name, methods] of Object.entries(expected)) {
    const route = routes.find((item) => item.name === name);
    assert.ok(route, `rota ${name} existe`);

    for (const [method, action] of Object.entries(methods)) {
      const handler = handlers(route.source).find((item) => item.method === method);
      assert.ok(handler, `${method} /api/admin/${name} existe`);
      assert.match(handler.body, new RegExp(`requireApiRole\\("${action.replace(".", "\\.")}"\\)`), `${method} /api/admin/${name} -> ${action}`);
    }
  }

  for (const route of routes.filter((item) => item.name.startsWith("ai-"))) {
    for (const handler of handlers(route.source).filter((item) => item.method !== "GET")) {
      assert.match(handler.body, /requireApiRole\("settings\.ai"\)/, `${handler.method} /api/admin/${route.name}`);
    }
  }
});

test("alunos continuam restritos a dono e administrador ate Alunos v2", () => {
  for (const name of ["students", "students/access"]) {
    const route = routes.find((item) => item.name === name);
    assert.ok(route, `rota ${name} existe`);

    for (const handler of handlers(route.source).filter((item) => item.method !== "GET")) {
      assert.deepEqual(guardRoles(handler.body), ["owner", "admin"], `${handler.method} /api/admin/${name}`);
    }
  }
});

test("rotas que mudam o catalogo invalidam o cache depois de gravar", () => {
  const catalogRoutes = ["content", "modules", "lessons", "combos", "home-sections", "appearance", "youtube-playlists/import"];

  for (const name of catalogRoutes) {
    const route = routes.find((item) => item.name === name);
    assert.ok(route, `rota ${name} existe`);
    assert.match(route.source, /import \{ invalidateCatalog \} from "@\/server\/catalog\/cache";/, `${name}: importa invalidateCatalog`);

    for (const handler of handlers(route.source).filter((item) => item.method !== "GET")) {
      const label = `${handler.method} /api/admin/${name}`;
      const invalidation = handler.body.indexOf('invalidateCatalog({ from: "route" })');
      const firstWrite = handler.body.search(/await (?:upsert|delete|reorder|publish|update|import)[A-Za-z]*\(/);
      const success = handler.body.search(/return NextResponse\.json\((?:\{\s*data|result)/);

      assert.ok(invalidation >= 0, `${label}: chama invalidateCatalog({ from: "route" })`);
      assert.ok(firstWrite >= 0 && invalidation > firstWrite, `${label}: invalida depois de gravar`);
      assert.ok(success > invalidation, `${label}: invalida antes de responder sucesso`);
    }
  }

  for (const route of routes) {
    assert.doesNotMatch(route.source, /invalidateCatalog\(\{ from: "action" \}\)/, `${route.name}: rota usa from: "route"`);
  }
});
