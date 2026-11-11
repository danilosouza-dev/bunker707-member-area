import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Guarda das cinco classes de ação (docs/32 §11.3): nenhuma ação nova sem classe. Conferido no disco:
// - toda Server Action mora num arquivo "use server" (nenhum "use server" dentro de função) e passa por runAdminAction
//   (ou runWebinarAction) com a classe logo depois da permissão: uma das cinco, ou um resolvedor de
//   src/server/actions/action-classes.ts que tira a classe da entrada;
// - runAdminAction exige a classe e confere a licença antes de validar a entrada e antes do handler;
// - toda rota que muda algo (POST, PUT, PATCH, DELETE) tem como primeira linha a guarda da licença com a classe;
// - a classificação conferida nos casos em que o §2.2 é explícito.

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

function filesIn(directory, pattern) {
  const absolute = join(root, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) {
      return filesIn(relative(root, path), pattern);
    }
    return pattern.test(entry) ? [relative(root, path)] : [];
  });
}

const { ACTION_CLASSES } = await import("../src/server/licensing/model.ts");
const resolvers = await import("../src/server/actions/action-classes.ts");
const CLASS = `"(?:${ACTION_CLASSES.join("|")})"`;
const RESOLVER = "actionClassOf[A-Z]\\w*";
const RUNNER_CALL = new RegExp(`\\brun(?:Admin|Webinar)Action\\(\\s*"([a-z_.]+)",\\s*(${CLASS}|${RESOLVER}),`, "g");

const sources = filesIn("src", /\.tsx?$/);
const useServer = sources.filter((file) => /^["']use server["'];/m.test(read(file)));

/** As funções exportadas de um arquivo: nome e corpo (até o próximo export). */
function exportedFunctions(source) {
  const pattern = /^export (?:default )?(?:async )?function (\w+)\(|^export const (\w+) = (?:async )?\(/gm;
  const starts = [...source.matchAll(pattern)];
  return starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    name: match[1] ?? match[2]
  }));
}

test("nenhum \"use server\" dentro de função: toda Server Action mora num arquivo \"use server\"", () => {
  const inline = sources.filter((file) => /^[ \t]+["']use server["'];?/m.test(read(file)));
  assert.deepEqual(inline, []);
  assert.ok(useServer.length >= 30, `arquivos "use server": ${useServer.length}`);
});

test("toda Server Action declara uma das cinco classes (ou um resolvedor pela entrada) logo depois da permissão", () => {
  const counts = {};
  let total = 0;

  for (const file of useServer) {
    const source = read(file);
    assert.doesNotMatch(codeOf(source), /^export const \w+ = (?:async )?\(/m, `${file}: Server Action só como export async function`);

    for (const { body, name } of exportedFunctions(source)) {
      const code = codeOf(body);
      const calls = [...code.matchAll(RUNNER_CALL)];
      const runners = code.match(/\brun(?:Admin|Webinar)Action\(/g) ?? [];

      assert.equal(runners.length, 1, `${file} ${name}: uma chamada a runAdminAction (ou runWebinarAction)`);
      assert.equal(calls.length, 1, `${file} ${name}: a classe (uma das cinco ou actionClassOf...) vem logo depois da permissão`);

      const actionClass = calls[0][2].replaceAll('"', "");
      if (!ACTION_CLASSES.includes(actionClass)) {
        assert.equal(typeof resolvers[actionClass], "function", `${file} ${name}: ${actionClass} existe em action-classes.ts`);
      }
      counts[actionClass] = (counts[actionClass] ?? 0) + 1;
      total += 1;
    }
  }

  assert.ok(total >= 175, `Server Actions: ${total} (${JSON.stringify(counts)})`);
});

test("runAdminAction exige a classe e confere a licença antes de validar a entrada e antes do handler", () => {
  const code = codeOf(read("src/server/actions/run-action.ts"));
  const signature = code.match(/export async function runAdminAction<Input, Output>\(([\s\S]*?)\): Promise/)?.[1] ?? "";

  assert.match(signature, /^\s*action: AdminAction,\s*actionClass: AdminActionClass<Input>,\s*schema: ZodType<Input>,/, "a classe é o segundo parâmetro, sem valor padrão");

  const role = code.indexOf("await requireRole(action)");
  const license = code.indexOf("await getCurrentLicenseState()");
  const fixed = code.indexOf("requireLicensed(license,");
  const parse = code.indexOf("schema.parse(rawInput)");
  const resolved = code.indexOf("requireActionClass(license, actionClass(input))");
  const handler = code.indexOf("await handler(");

  assert.ok(role >= 0 && role < license, "a licença depois do papel: quem não é da equipe nunca ouve falar da Licença");
  assert.ok(license < fixed && fixed < parse, "o módulo e a classe fixa antes de validar a entrada");
  assert.ok(parse < resolved && resolved < handler, "a classe que sai da entrada antes do handler");
  assert.match(code, /feature: options\.feature/);
});

/** As rotas que mudam algo: o corpo de cada POST, PUT, PATCH e DELETE exportado, e os apelidos. */
function mutatingHandlers(source) {
  const pattern = /^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm;
  const starts = [...source.matchAll(pattern)];
  const bodies = starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    method: match[1]
  }));
  const aliases = [...source.matchAll(/^export \{ (GET|POST|PUT|PATCH|DELETE) as (GET|POST|PUT|PATCH|DELETE) \};/gm)].map((match) => ({
    method: match[2],
    target: match[1]
  }));
  return { aliases, bodies };
}

const ROUTE_GUARD = /^const licenseRefusal = await licenseRouteRefusal\(\{([^}]*)\}\);\s*if \(licenseRefusal\) return licenseRefusal;/;

function firstStatements(body) {
  const code = codeOf(body);
  return code.slice(code.indexOf("{", code.indexOf(")")) + 1).trimStart();
}

test("toda rota que muda algo (POST, PUT, PATCH, DELETE) tem como primeira linha a guarda da licença com a classe", () => {
  const routes = filesIn("src/app", /^route\.tsx?$/);
  const counts = {};
  let total = 0;

  for (const route of routes) {
    const source = read(route);
    assert.doesNotMatch(codeOf(source), /^export const (?:GET|POST|PUT|PATCH|DELETE)\b/m, `${route}: handler só como export async function`);
    const { aliases, bodies } = mutatingHandlers(source);

    for (const { body, method } of bodies.filter((item) => item.method !== "GET")) {
      const guard = ROUTE_GUARD.exec(firstStatements(body));
      assert.ok(guard, `${route} ${method}: a primeira linha é a guarda da licença`);
      const declared = new RegExp(`\\bactionClass: ${CLASS}`).exec(guard[1]);
      assert.ok(declared, `${route} ${method}: a guarda diz a classe (uma das cinco)`);
      const actionClass = declared[0].split('"')[1];
      counts[actionClass] = (counts[actionClass] ?? 0) + 1;
      total += 1;
    }

    // Um apelido (export { PUT as POST }) só vale apontando para um handler que muda algo e já tem a guarda.
    for (const alias of aliases) {
      assert.notEqual(alias.target, "GET", `${route}: ${alias.method} apontando para um GET ficaria sem classe`);
      assert.ok(bodies.some((item) => item.method === alias.target), `${route}: ${alias.method} aponta para ${alias.target}`);
    }
  }

  assert.ok(total >= 72, `rotas que mudam algo: ${total} (${JSON.stringify(counts)})`);
});

/** A classe declarada por uma Server Action (o texto logo depois da permissão). */
function actionClassOf(file, name) {
  const fn = exportedFunctions(read(file)).find((item) => item.name === name);
  assert.ok(fn, `${file} ${name}`);
  return [...codeOf(fn.body).matchAll(RUNNER_CALL)][0][2].replaceAll('"', "");
}

/** A classe declarada pela rota no método dado. */
function routeClassOf(route, method) {
  const { bodies } = mutatingHandlers(read(route));
  const body = bodies.find((item) => item.method === method)?.body ?? "";
  return /\bactionClass: "([a-z_]+)"/.exec(ROUTE_GUARD.exec(firstStatements(body))?.[1] ?? "")?.[1];
}

test("a classificação onde o §2.2 é explícito: o que a lei e a segurança pedem nunca é conteúdo nem matrícula", () => {
  const casos = [
    // Despublicar e apagar conteúdo; apagar dados de aluno; trocar o segredo de uma integração ou desligá-la.
    ["src/server/catalog/product-actions.ts", "setProductSituation", "dever_legal"],
    ["src/server/catalog/product-actions.ts", "deleteProduct", "dever_legal"],
    ["src/server/catalog/content-actions.ts", "softDeleteStructure", "dever_legal"],
    ["src/server/communications/actions.ts", "deleteNotice", "dever_legal"],
    ["src/server/communications/actions.ts", "withdrawNotice", "dever_legal"],
    ["src/server/students/actions.ts", "deleteStudent", "dever_legal"],
    ["src/server/students/actions.ts", "sendStudentAccessEmail", "dever_legal"],
    ["src/server/payments/actions.ts", "saveSalesSecret", "dever_legal"],
    ["src/server/payments/actions.ts", "disconnectSalesProvider", "dever_legal"],
    ["src/server/team/actions.ts", "removeTeamMember", "dever_legal"],
    ["src/server/webinars/room-actions.ts", "removeStudentMessages", "dever_legal"],
    // A tela Licença (docs/32 §2.4): o caminho para sair de qualquer degrau, inclusive da Instalação nunca ativada.
    ["src/server/licensing/actions.ts", "activateLicense", "dever_legal"],
    ["src/server/licensing/actions.ts", "checkLicenseNow", "dever_legal"],
    ["src/server/licensing/actions.ts", "deactivateLicense", "dever_legal"],
    ["src/server/licensing/actions.ts", "uploadLicenseFile", "dever_legal"],
    // Atendimento: remover acesso, responder e moderar comentários, operar a live já marcada.
    ["src/server/students/actions.ts", "updateStudentAccess", "atendimento"],
    ["src/server/community/actions.ts", "replyToComment", "atendimento"],
    ["src/server/community/actions.ts", "moderateComment", "atendimento"],
    ["src/server/webinars/live-actions.ts", "openLiveRoom", "atendimento"],
    ["src/server/webinars/live-actions.ts", "endLiveSession", "atendimento"],
    ["src/server/webinars/room-actions.ts", "openSessionNow", "atendimento"],
    // Acesso novo.
    ["src/server/students/actions.ts", "grantStudentAccess", "matricula"],
    ["src/server/students/actions.ts", "createStudent", "actionClassOfNewStudent"],
    ["src/server/students/actions.ts", "runBulkStudentAction", "actionClassOfBulkStudentAction"],
    // Conteúdo e configuração: criar, editar, publicar, importar alunos, mudar a aparência.
    ["src/server/students/actions.ts", "importStudentsBatch", "conteudo"],
    ["src/server/catalog/product-actions.ts", "publishProduct", "conteudo"],
    ["src/server/catalog/content-actions.ts", "createLessons", "conteudo"],
    ["src/server/catalog/content-actions.ts", "setLessonsStatus", "actionClassOfLessonsStatus"],
    ["src/server/communications/actions.ts", "publishNotice", "conteudo"],
    ["src/server/communications/flow-actions.ts", "activateFlow", "conteudo"],
    ["src/server/webinars/actions.ts", "publishWebinar", "conteudo"],
    ["src/server/member-area/home-hero-actions.ts", "saveHomeHero", "conteudo"]
  ];

  for (const [file, name, expected] of casos) {
    assert.equal(actionClassOf(file, name), expected, `${file} ${name}`);
  }

  const rotas = [
    ["src/app/api/webhooks/hotmart/route.ts", "POST", "dever_legal"],
    ["src/app/api/webhooks/ticto/route.ts", "POST", "dever_legal"],
    ["src/app/api/jobs/tick/route.ts", "POST", "dever_legal"],
    ["src/app/api/auth/logout/route.ts", "POST", "dever_legal"],
    ["src/app/api/webinars/chat/route.ts", "DELETE", "dever_legal"],
    ["src/app/api/admin/appearance/route.ts", "PUT", "conteudo"],
    ["src/app/api/admin/moderation/comments/[commentId]/route.ts", "PATCH", "atendimento"],
    ["src/app/api/progress/lessons/route.ts", "PUT", "atendimento"],
    ["src/app/api/webinars/[id]/heartbeat/route.ts", "POST", "atendimento"]
  ];

  for (const [route, method, expected] of rotas) {
    assert.equal(routeClassOf(route, method), expected, `${route} ${method}`);
  }
});
