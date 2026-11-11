import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Guarda de arquitetura dos módulos vendidos à parte (docs/32 §5.1 e §11.8). Na fase 1, a chave dos Webinários e a
// lista dos pontos deles ficam escritas à mão aqui (da fase 3 em diante, no manifesto src/server/licensing/features.ts).
// Regras, conferidas no disco (um ponto novo dos Webinários sem a pergunta à licença deixa a guarda vermelha):
// - toda página em src/app/webinarios e em Comunicação › Webinários pergunta primeiro (requireFeaturePage), e o layout
//   do admin também (o 404 do módulo desligado é o da raiz, não o "Webinário não encontrado");
// - toda rota dos Webinários (as do aluno, as do admin e os três webhooks do gravador e da sala), em todo método, tem
//   como primeira linha a guarda com o módulo (licenseRouteRefusal com WEBINARS_FEATURE);
// - toda Server Action de src/server/webinars passa por runWebinarAction (que põe o módulo), nunca por runAdminAction,
//   e nenhum arquivo "use server" fora dali usa código dos Webinários;
// - toda tarefa de minuto que usa código dos Webinários declara o módulo, e o agendador pula a do módulo desligado;
// - toda página, layout ou rota fora dessas pastas que usa código dos Webinários pergunta pelo módulo;
// - os componentes do núcleo que desenham peças dos Webinários (a faixa no AppShell, o bloco do Perfil) só as desenham
//   com o módulo ligado;
// - todo item de menu, busca, aba e "Criar" que leva aos Webinários diz o módulo, e some sem ele.

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
/** Sem comentários: o que sobra é o código. */
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

const WEBINAR_PAGE_DIRS = ["src/app/webinarios", "src/app/admin/(v2)/comunicacao/webinarios"];
const WEBINAR_ROUTE_DIRS = ["src/app/api/webinars", "src/app/api/admin/webinars", "src/app/api/webhooks/recorder", "src/app/api/webhooks/room-guard"];
// O código do módulo: o servidor, os componentes do aluno e do admin e os ajudantes (src/lib/webinar*, as frases, os
// caminhos e o cliente da sala; src/components/webinars, os ganchos do Jitsi).
const WEBINAR_CODE_DIRS = [
  "src/server/webinars/",
  "src/components/member/webinars/",
  "src/components/admin/v2/communication/webinars/",
  "src/components/webinars/",
  "src/lib/webinar"
];
const isInWebinarFolders = (path) =>
  [...WEBINAR_PAGE_DIRS, ...WEBINAR_ROUTE_DIRS].some((dir) => path.startsWith(`${dir}/`)) || WEBINAR_CODE_DIRS.some((dir) => path.startsWith(dir));

/** O arquivo importa código dos Webinários (servidor ou componentes), pelo alias ou por caminho relativo? */
function importsWebinarCode(path) {
  const specifiers = [...codeOf(read(path)).matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  return specifiers.some((specifier) => {
    const target = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? relative(root, join(root, path, "..", specifier)) : null;
    return target !== null && WEBINAR_CODE_DIRS.some((dir) => target.startsWith(dir) || `${target}/`.startsWith(dir));
  });
}

/** O corpo de cada função exportada (do `export ... function X(` até o próximo export). */
function exportedBodies(source) {
  const pattern = /^export (?:default )?async function (\w+)\(/gm;
  const starts = [...source.matchAll(pattern)];
  return starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    name: match[1]
  }));
}

/** O que vem logo depois da chave que abre a função, sem comentários e sem espaços nas pontas. */
function firstStatements(body) {
  const code = codeOf(body);
  return code.slice(code.indexOf("{", code.indexOf(")")) + 1).trimStart();
}

const ROUTE_GUARD = /^const licenseRefusal = await licenseRouteRefusal\(\{([^}]*)\}\);\s*if \(licenseRefusal\) return licenseRefusal;/;

test("toda página dos Webinários (aluno e admin) pergunta pelo módulo antes de tudo, e o layout do admin também", () => {
  const pages = WEBINAR_PAGE_DIRS.flatMap((dir) => filesIn(dir, /^page\.tsx$/));
  assert.ok(pages.length >= 8, `páginas: ${pages.length}`);

  for (const page of pages) {
    const source = read(page);
    const [main] = exportedBodies(source).filter((item) => /^export default/.test(item.body));
    assert.ok(main, `${page}: export default async function`);
    assert.match(firstStatements(main.body), /^await requireFeaturePage\(WEBINARS_FEATURE\);/, `${page}: a primeira linha é requireFeaturePage(WEBINARS_FEATURE)`);
  }

  const layout = read("src/app/admin/(v2)/comunicacao/webinarios/layout.tsx");
  assert.match(firstStatements(exportedBodies(layout)[0].body), /^await requireFeaturePage\(WEBINARS_FEATURE\);/);
  // Nenhuma pasta de página dos Webinários tem layout ou template sem a guarda.
  for (const file of WEBINAR_PAGE_DIRS.flatMap((dir) => filesIn(dir, /^(layout|template)\.tsx$/))) {
    assert.match(read(file), /await requireFeaturePage\(WEBINARS_FEATURE\);/, file);
  }
});

test("toda rota dos Webinários, em todo método, tem a guarda do módulo como primeira linha", () => {
  const routes = WEBINAR_ROUTE_DIRS.flatMap((dir) => filesIn(dir, /^route\.ts$/));
  let handlers = 0;
  assert.ok(routes.length >= 27, `rotas: ${routes.length}`);

  for (const route of routes) {
    const source = read(route);
    assert.doesNotMatch(codeOf(source), /^export (?:const (?:GET|POST|PUT|PATCH|DELETE)\b|\{[^}]*\bas (?:GET|POST|PUT|PATCH|DELETE)\b)/m, `${route}: handler só como export async function`);

    for (const { body, name } of exportedBodies(source)) {
      const guard = ROUTE_GUARD.exec(firstStatements(body));
      assert.ok(guard, `${route} ${name}: a primeira linha é a guarda da licença`);
      assert.match(guard[1], /\bfeature: WEBINARS_FEATURE\b/, `${route} ${name}: a guarda diz o módulo`);
      handlers += 1;
    }
  }

  assert.ok(handlers >= 34, `handlers: ${handlers}`);
});

test("toda Server Action dos Webinários passa por runWebinarAction, que põe o módulo; nenhuma ação de fora usa os Webinários", () => {
  const useServer = filesIn("src", /\.tsx?$/).filter((file) => /^["']use server["'];/m.test(read(file)));
  const webinarActions = useServer.filter((file) => file.startsWith("src/server/webinars/"));
  let actions = 0;
  assert.ok(webinarActions.length >= 9, `arquivos: ${webinarActions.length}`);

  for (const file of webinarActions) {
    const code = codeOf(read(file));
    assert.doesNotMatch(code, /\brunAdminAction\(/, `${file}: as dos Webinários nunca chamam runAdminAction direto`);

    for (const { body, name } of exportedBodies(read(file))) {
      assert.equal((codeOf(body).match(/\brunWebinarAction\(/g) ?? []).length, 1, `${file} ${name}: uma chamada a runWebinarAction`);
      actions += 1;
    }
  }

  assert.ok(actions >= 63, `ações dos Webinários: ${actions}`);
  assert.match(codeOf(read("src/server/webinars/run-webinar-action.ts")), /runAdminAction\(action, actionClass, schema, rawInput, handler, \{ \.\.\.options, feature: WEBINARS_FEATURE \}\)/);

  for (const file of useServer.filter((item) => !item.startsWith("src/server/webinars/"))) {
    assert.equal(importsWebinarCode(file), false, `${file}: ação de fora dos Webinários usando código deles escaparia da guarda do módulo`);
  }
});

test("toda tarefa de minuto dos Webinários declara o módulo, e o agendador pula a do módulo desligado", () => {
  const jobs = filesIn("src/server/jobs", /\.ts$/).filter((file) => importsWebinarCode(file));
  assert.ok(jobs.length >= 5, `tarefas: ${jobs.length}`);

  for (const job of jobs) {
    assert.match(codeOf(read(job)), /: Job = \{\s*feature: WEBINARS_FEATURE,/, `${job}: feature: WEBINARS_FEATURE`);
  }

  const tick = codeOf(read("src/server/jobs/run-tick.ts"));
  assert.match(tick, /if \(job\.feature !== undefined && !isFeatureEnabled\(job\.feature\)\) \{\s*featureOff\.push\(job\.name\);\s*continue;/);
  assert.ok(tick.indexOf("featureOff.push(job.name)") < tick.indexOf("startJobRun(supabase, job.name"), "pula antes de gravar job_runs");
  assert.match(codeOf(read("src/app/api/jobs/tick/route.ts")), /isFeatureEnabled: \(feature\) => isFeatureEnabled\(license, feature\)/);
});

// Lugares do núcleo que usam código dos Webinários sem ser ponto de entrada deles, cada um com o motivo. Um arquivo novo
// aqui pede pensar se ele precisa perguntar pelo módulo.
const NUCLEO_COM_CODIGO_DOS_WEBINARIOS = {
  // As frases dos números da aba Webinários (a aba some sem o módulo: COMMUNICATION_TAB_META.webinarios.feature).
  "src/components/admin/v2/frames/communication-model.ts": "as frases dos números da aba",
  // Só o caminho da sala, para a IA Diretor não cobrir o chat dela.
  "src/components/member/shell/member-shell-model.ts": "o caminho da sala",
  // Os e-mails do módulo: só as tarefas e as ações dele os enfileiram.
  "src/server/email/templates/webinar-cancelled.ts": "e-mail do módulo",
  "src/server/email/templates/webinar-recording-failed.ts": "e-mail do módulo",
  "src/server/email/templates/webinar-reminder.ts": "e-mail do módulo",
  // A regra "Participação em lives" dos segmentos da Comunicação: com as tabelas vazias não acha ninguém; esconder a
  // regra e recusá-la ao salvar fica para a peça seguinte (docs/32 §16).
  "src/components/admin/v2/communication/notices-view-model.ts": "a regra Participação em lives",
  "src/server/communications/audience-facts.ts": "a regra Participação em lives",
  "src/server/communications/facts-loader.ts": "a regra Participação em lives",
  "src/server/communications/schemas.ts": "a regra Participação em lives",
  // As notificações antigas de live no sino: deixar de apontar para a página que some fica para a peça seguinte.
  "src/server/communications/inbox.ts": "as notificações de live no sino"
};

test("toda página, layout ou rota fora das pastas dos Webinários que usa código deles pergunta pelo módulo", () => {
  const entries = filesIn("src/app", /^(page|layout|template|route)\.tsx?$/).filter((file) => !isInWebinarFolders(file) && importsWebinarCode(file));

  for (const entry of entries) {
    assert.match(codeOf(read(entry)), /\bWEBINARS_FEATURE\b/, `${entry}: usa os Webinários e precisa perguntar pela licença`);
  }

  // A pagina inicial le a fileira das lives so com o modulo; o Novo aviso ignora o ?webinario= sem ele.
  assert.match(codeOf(read("src/app/page.tsx")), /webinarsOn \? getHomeWebinars\(/);
  assert.match(codeOf(read("src/app/admin/(v2)/comunicacao/avisos/novo/page.tsx")), /!\(await isFeatureEnabledNow\(WEBINARS_FEATURE\)\) \? null : webinarNoticeRequestOf/);

  const outros = filesIn("src", /\.tsx?$/).filter(
    (file) => !file.startsWith("src/app/") && !isInWebinarFolders(file) && !file.startsWith("src/server/jobs/") && importsWebinarCode(file)
  );
  const conhecidos = ["src/components/app-shell.tsx", "src/components/member/pages/profile-view.tsx", ...Object.keys(NUCLEO_COM_CODIGO_DOS_WEBINARIOS)];
  assert.deepEqual(outros.filter((file) => !conhecidos.includes(file)), [], "código do núcleo novo usando os Webinários");
});

test("os componentes do núcleo só desenham as peças dos Webinários com o módulo ligado, e toda página do aluno passa a lista", () => {
  const shell = codeOf(read("src/components/app-shell.tsx"));
  assert.match(shell, /!accessPreviewMode && !disabledFeatures\.includes\(WEBINARS_FEATURE\) \? \(\s*<LiveNowBanner/);
  assert.match(shell, /disabledFeatures: readonly FeatureKey\[\];/, "a lista é obrigatória no tipo do AppShell");
  assert.match(shell, /getMemberSidebarSections\(pathname, accessPreviewMode, disabledFeatures(?:, \{ licenses: student\.licenses \})?\)/);
  assert.match(shell, /<MemberSidebar\s+accessPreviewMode=\{accessPreviewMode\}\s+disabledFeatures=\{disabledFeatures\}/);

  const profile = codeOf(read("src/components/member/pages/profile-view.tsx"));
  assert.match(profile, /\{webinars \? \(\s*<WebinarChatPrivacy/);
  assert.match(codeOf(read("src/app/perfil/page.tsx")), /webinars=\{featureVisible\(WEBINARS_FEATURE, shellData\.disabledFeatures\)\}/);

  const shells = filesIn("src/app", /\.tsx$/).filter((file) => /<AppShell\b/.test(read(file)));
  assert.ok(shells.length >= 13, `páginas com o AppShell: ${shells.length}`);
  for (const file of shells) {
    assert.match(read(file), /<AppShell[^>]*disabledFeatures=\{shellData\.disabledFeatures\}/, `${file}: passa a lista ao AppShell`);
  }
  // A lista vem das guardas (a mesma lista vazia de sempre no modo off; todos os módulos com a leitura que falha).
  const moldura = codeOf(read("src/server/db/platform-store.ts"));
  assert.match(moldura, /const \[database, adminAccess, profile, disabledFeatures\] = await Promise\.all\(\[[\s\S]*?getDisabledFeatures\(\)\s*\]\);/);
  assert.match(moldura, /^\s*disabledFeatures,$/m);
});

test("todo item de menu, busca, aba e Criar que leva aos Webinários diz o módulo", async () => {
  const { WEBINARS_FEATURE } = await import("../src/server/licensing/features.ts");
  const { MEMBER_NAVIGATION_ITEMS } = await import("../src/lib/member-navigation.ts");
  const { adminNavItems } = await import("../src/components/admin/v2/nav.ts");
  const { listAdminStaticSearchItems } = await import("../src/components/admin/v2/search-model.ts");
  const { TODAY_CREATE_ITEMS } = await import("../src/components/admin/v2/today/today-model.ts");
  const { COMMUNICATION_TAB_META } = await import("../src/components/admin/v2/frames/communication-model.ts");
  const webinarHref = (href) => typeof href === "string" && (href === "/webinarios" || href.startsWith("/webinarios/") || href.startsWith("/admin/comunicacao/webinarios"));

  for (const item of MEMBER_NAVIGATION_ITEMS.filter((entry) => webinarHref(entry.href))) {
    assert.equal(item.feature, WEBINARS_FEATURE, `menu do aluno: ${item.href}`);
  }
  for (const child of adminNavItems.flatMap((item) => item.children ?? []).filter((entry) => webinarHref(entry.href))) {
    assert.equal(child.feature, WEBINARS_FEATURE, `menu do admin: ${child.href}`);
  }
  for (const item of TODAY_CREATE_ITEMS.filter((entry) => webinarHref(entry.href))) {
    assert.equal(item.feature, WEBINARS_FEATURE, `Criar: ${item.href}`);
  }
  for (const meta of Object.values(COMMUNICATION_TAB_META).filter((entry) => webinarHref(entry.href))) {
    assert.equal(meta.feature, WEBINARS_FEATURE, `aba: ${meta.href}`);
  }
  assert.deepEqual(listAdminStaticSearchItems(undefined, [WEBINARS_FEATURE]).filter((item) => webinarHref(item.href)), [], "busca do admin");
  assert.ok(listAdminStaticSearchItems(undefined).some((item) => webinarHref(item.href)), "com o módulo, a busca leva aos Webinários");

  // As abas filtram pela lista da moldura do admin (o layout lê no servidor).
  assert.match(codeOf(read("src/components/admin/v2/section-tabs.tsx")), /allItems\.filter\(\(item\) => featureVisible\(item\.feature, disabledFeatures\)\)/);
  assert.match(codeOf(read("src/components/admin/v2/frames/communication-frame.tsx")), /feature: COMMUNICATION_TAB_META\[tab\]\.feature,/);
  assert.match(codeOf(read("src/app/admin/(v2)/layout.tsx")), /disabledFeatures=\{disabledFeatures\}/);
});
