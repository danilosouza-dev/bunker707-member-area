import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// O app perguntando a licença (docs/32 §2.2, §11.3 e §11.8), no modo "enforce", com a situação do pedido trocada por
// uma situação de teste: licenças assinadas pelo dublê do Emissor e avaliadas pelo Verificador de verdade
// (computeLicenseState), uma para cada degrau. Aqui: o que cada degrau barra em cada uma das cinco classes; o runner
// das Server Actions (a classe fixa, a classe pela entrada e o módulo); as rotas (404 sem o módulo antes da sessão, 403
// com a classe barrada, a do aluno passando em todo degrau); a página (notFound); o agendador (a tarefa do módulo
// desligado não roda nem grava job_runs); e os menus do aluno e do admin. O modo "off" de verdade fica em
// tests/licenca-modo-off.test.mjs.

const licencaDoPedido = (globalThis.__licencaDoPedido ??= { leituras: 0, situacao: null });
const sessao = (globalThis.__licencaGuardasSessao ??= { user: null });

/** O modulo de src/ que um import pede ("server/auth/guards"), pelo alias ou por caminho relativo. */
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
    if (modulo === "server/licensing/current-state") {
      return stub(`
        export async function getCurrentLicenseState() {
          globalThis.__licencaDoPedido.leituras += 1;
          return globalThis.__licencaDoPedido.situacao;
        }
        export const readCurrentLicenseState = getCurrentLicenseState;
        export function forgetLicenseStateMemory() {}`);
    }
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__licencaGuardasSessao.user;
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

const { computeLicenseState, EMPTY_LICENSE_SNAPSHOT } = await import("../src/server/licensing/state.ts");
const { ACTION_CLASSES } = await import("../src/server/licensing/model.ts");
const { WEBINARS_FEATURE } = await import("../src/server/licensing/features.ts");
const { LICENSE_REFUSAL_MESSAGES, disabledFeaturesOf, isActionClassAllowed, licenseRefusalOf, needsLicenseState } = await import(
  "../src/server/licensing/require-feature.ts"
);
const { getDisabledFeatures, licenseRouteRefusal, requireFeaturePage } = await import("../src/server/licensing/guards.ts");
const { actionClassOfBulkStudentAction, actionClassOfLessonsStatus, actionClassOfNewStudent } = await import("../src/server/actions/action-classes.ts");
const { reorderContent, setLessonsStatus } = await import("../src/server/catalog/content-actions.ts");
const { loadJitSettings } = await import("../src/server/webinars/jit-actions.ts");
const liveNowRoute = await import("../src/app/api/webinars/live-now/route.ts");
const heartbeatRoute = await import("../src/app/api/webinars/[id]/heartbeat/route.ts");
const { runJobsTick } = await import("../src/server/jobs/run-tick.ts");
const { getMemberSidebarSections } = await import("../src/components/member/shell/member-shell-model.ts");
const { visibleAdminNav } = await import("../src/components/admin/v2/nav.ts");
const { buildAdminSearchGroups, listAdminStaticSearchItems } = await import("../src/components/admin/v2/search-model.ts");
const { getTodayCreateItems } = await import("../src/components/admin/v2/today/today-model.ts");
const { resolveAdminAccess } = await import("../src/server/auth/roles.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const AGORA = new Date("2026-11-11T12:00:00.000Z");
const ONTEM = "2026-11-10T12:00:00.000Z";
const ENDERECO = "alunos.escola.test";

/** A situação de uma Instalação conferida hoje, com a licença dada (e o endereço configurado). */
function situacao(sobrescrever = {}, endereco = ENDERECO) {
  const licenca = licencaBase(sobrescrever);
  return computeLicenseState({
    configuredHost: endereco,
    mode: "enforce",
    roots: [raiz.confiavel],
    snapshot: {
      ...EMPTY_LICENSE_SNAPSHOT,
      everActivated: true,
      lastCheckIn: { emissorTime: AGORA, localTime: AGORA },
      lastSeenAt: AGORA,
      token: assinarLicenca(emissao, licenca)
    },
    systemNow: AGORA
  });
}

const passo = (degree, reason) => ({ degree, from: ONTEM, reason });

const SITUACOES = {
  em_dia: situacao(),
  sem_o_modulo: situacao({ features: [] }),
  aviso: situacao({ statusSteps: [passo("aviso", "licenca_suspensa")] }),
  admin_limitado: situacao({ statusSteps: [passo("admin_limitado", "pagamento_desfeito")] }),
  escola_congelada: situacao({ statusSteps: [passo("escola_congelada", "pagamento_desfeito")] }),
  // Endereço diferente: o Aviso, e o acesso novo já para (docs/32 §2.2).
  endereco_diferente: situacao({}, "outra.escola.test"),
  // Lote fundador em observação: o que vem da validade (aqui, a anual vencida há meses) é registrado sem limitar nada.
  observacao: situacao({
    observeUntil: "2027-01-01T00:00:00.000Z",
    plan: { kind: "annual", validUntil: "2026-06-30T23:59:59-03:00", steps: [{ degree: "escola_congelada", from: "2026-08-15T03:00:00.000Z", reason: "anual_vencida" }] }
  }),
  // A ordem do Emissor (aqui, o pagamento desfeito) vale mesmo na observação.
  observacao_com_ordem: situacao({ observeUntil: "2027-01-01T00:00:00.000Z", statusSteps: [passo("escola_congelada", "pagamento_desfeito")] }),
  nao_ativada: computeLicenseState({ configuredHost: ENDERECO, mode: "enforce", roots: [raiz.confiavel], snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: AGORA })
};

function noPedido(nome) {
  licencaDoPedido.situacao = SITUACOES[nome];
  licencaDoPedido.leituras = 0;
}

test.beforeEach(() => {
  sessao.user = null;
  actionStubs.db = null;
  actionStubs.invalidations = [];
});

test("as situações de teste estão no degrau que dizem", () => {
  assert.equal(SITUACOES.em_dia.evaluation.degree, "ok");
  assert.equal(SITUACOES.aviso.evaluation.enforcedDegree, "aviso");
  assert.equal(SITUACOES.admin_limitado.evaluation.enforcedDegree, "admin_limitado");
  assert.equal(SITUACOES.escola_congelada.evaluation.enforcedDegree, "escola_congelada");
  assert.equal(SITUACOES.endereco_diferente.evaluation.enforcedDegree, "aviso");
  assert.equal(SITUACOES.observacao.evaluation.observing, true);
  assert.equal(SITUACOES.observacao.evaluation.degree, "escola_congelada");
  assert.equal(SITUACOES.observacao.evaluation.enforcedDegree, "aviso");
  assert.equal(SITUACOES.observacao_com_ordem.evaluation.observing, true);
  assert.equal(SITUACOES.observacao_com_ordem.evaluation.enforcedDegree, "escola_congelada");
  assert.equal(SITUACOES.nao_ativada.evaluation.degree, "nao_ativada");
  assert.deepEqual(disabledFeaturesOf(SITUACOES.em_dia), []);
  assert.deepEqual(disabledFeaturesOf(SITUACOES.sem_o_modulo), [WEBINARS_FEATURE]);
});

test("cada degrau barra as classes do §2.2: o Admin limitado para o conteúdo, a Escola congelada também o acesso novo, e o dever legal nunca para", () => {
  const passa = (nome) => Object.fromEntries(ACTION_CLASSES.map((classe) => [classe, isActionClassAllowed(SITUACOES[nome], classe)]));
  const tudo = { atendimento: true, conteudo: true, dever_legal: true, leitura: true, matricula: true };

  assert.deepEqual(passa("em_dia"), tudo);
  assert.deepEqual(passa("aviso"), tudo, "o Aviso só avisa");
  assert.deepEqual(passa("observacao"), tudo, "a observação do lote fundador não limita o que vem da validade");
  assert.deepEqual(passa("observacao_com_ordem"), { ...tudo, conteudo: false, matricula: false }, "a ordem do Emissor vale mesmo na observação");
  // Admin limitado: o que é novo para; o que já estava combinado com o aluno continua, e a matrícula também.
  assert.deepEqual(passa("admin_limitado"), { ...tudo, conteudo: false });
  // Escola congelada: admin limitado e nenhum acesso novo, para ninguém.
  assert.deepEqual(passa("escola_congelada"), { ...tudo, conteudo: false, matricula: false });
  // Fora do endereço da licença, o acesso novo para já no Aviso.
  assert.deepEqual(passa("endereco_diferente"), { ...tudo, matricula: false });
  // Cópia nunca ativada: só a tela de ativação e o dever legal.
  assert.deepEqual(passa("nao_ativada"), { atendimento: false, conteudo: false, dever_legal: true, leitura: false, matricula: false });
});

test("a recusa das rotas: 404 sem o módulo, 403 com a classe barrada, nada quando passa; dever legal nem lê a licença", () => {
  assert.deepEqual(licenseRefusalOf(SITUACOES.sem_o_modulo, { feature: WEBINARS_FEATURE }), { message: LICENSE_REFUSAL_MESSAGES.feature, status: 404 });
  // O módulo vem antes da classe: sem o módulo, nada diz se a ação passaria.
  assert.equal(licenseRefusalOf(SITUACOES.sem_o_modulo, { actionClass: "conteudo", feature: WEBINARS_FEATURE }).status, 404);
  assert.deepEqual(licenseRefusalOf(SITUACOES.admin_limitado, { actionClass: "conteudo" }), { message: LICENSE_REFUSAL_MESSAGES.route, status: 403 });
  assert.equal(licenseRefusalOf(SITUACOES.admin_limitado, { actionClass: "atendimento", feature: WEBINARS_FEATURE }), null);
  assert.equal(licenseRefusalOf(SITUACOES.escola_congelada, { actionClass: "matricula" }).status, 403);
  assert.equal(licenseRefusalOf(SITUACOES.nao_ativada, { actionClass: "dever_legal" }), null);

  assert.equal(needsLicenseState({ actionClass: "dever_legal" }), false);
  assert.equal(needsLicenseState({ actionClass: "dever_legal", feature: WEBINARS_FEATURE }), true);
  assert.equal(needsLicenseState({ actionClass: "atendimento" }), true);
  // A frase das rotas nunca fala da Licença: o aluno nunca vê aviso sobre a Licença da escola.
  assert.doesNotMatch(LICENSE_REFUSAL_MESSAGES.route, /licen/i);
  assert.doesNotMatch(LICENSE_REFUSAL_MESSAGES.feature, /webin|m[oó]dulo|licen/i);
});

test("licenseRouteRefusal: a resposta da rota, sem cache; dever legal sem módulo passa sem ler a licença", async () => {
  noPedido("admin_limitado");
  const barrada = await licenseRouteRefusal({ actionClass: "conteudo" });
  assert.equal(barrada.status, 403);
  assert.equal(barrada.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await barrada.json(), { error: LICENSE_REFUSAL_MESSAGES.route });
  assert.equal(await licenseRouteRefusal({ actionClass: "atendimento" }), null);

  noPedido("nao_ativada");
  assert.equal(await licenseRouteRefusal({ actionClass: "dever_legal" }), null);
  assert.equal(licencaDoPedido.leituras, 0, "webhooks de venda, o tick e sair da conta não leem a licença");

  noPedido("sem_o_modulo");
  const semModulo = await licenseRouteRefusal({ feature: WEBINARS_FEATURE });
  assert.equal(semModulo.status, 404);
  assert.deepEqual(await semModulo.json(), { error: LICENSE_REFUSAL_MESSAGES.feature });
});

test("as classes que saem da entrada: publicar aula é conteúdo e despublicar é dever legal; aluno com produto é matrícula", () => {
  assert.equal(actionClassOfLessonsStatus({ status: "published" }), "conteudo");
  assert.equal(actionClassOfLessonsStatus({ status: "draft" }), "dever_legal");
  assert.equal(actionClassOfNewStudent({ productIds: ["curso-1"] }), "matricula");
  assert.equal(actionClassOfNewStudent({ productIds: [] }), "conteudo", "conta sem produto já é barrada no Admin limitado");
  assert.equal(actionClassOfBulkStudentAction({ action: "grant" }), "matricula");
  assert.equal(actionClassOfBulkStudentAction({ action: "resend_access_email" }), "dever_legal");
  for (const action of ["revoke", "extend_30", "extend_90", "set_end", "set_cohort"]) {
    assert.equal(actionClassOfBulkStudentAction({ action }), "atendimento", action);
  }
});

// ---- Server Actions, pelo runAdminAction de verdade -----------------------------------------------------

const PRODUTO = "produto-licenca";

function bancoDoCurso() {
  return createFakeDb({
    tables: {
      content_items: [{ id: PRODUTO, kind: "Curso", title: "Curso" }],
      course_modules: [{ id: "modulo-1", image: null, owner_id: PRODUTO, release_rule: null, sort_order: 0, status: "published", title: "Módulo", updated_at: AGORA.toISOString() }],
      lessons: [{ description: null, duration: null, id: "aula-1", image: null, module_id: "modulo-1", release_rule: null, sort_order: 0, status: "draft", title: "Aula", updated_at: AGORA.toISOString(), video_config: null }]
    }
  });
}

test("Server Action de conteúdo no Admin limitado: 403 com a frase da Licença, antes de ler a entrada e sem tocar no banco", async () => {
  noPedido("admin_limitado");
  const db = bancoDoCurso();
  actionStubs.db = db;

  const resultado = await reorderContent({ modules: [{ id: "modulo-1", lessonIds: ["aula-1"] }], productId: PRODUTO });

  assert.deepEqual(resultado, { error: LICENSE_REFUSAL_MESSAGES.actionClass, ok: false, status: 403 });
  assert.deepEqual(db.calls, { from: [], rpc: [], writes: [] });
  assert.equal(licencaDoPedido.leituras, 1, "uma leitura da situação por pedido");

  // Entrada inválida também volta 403: a licença vem antes do zod.
  assert.equal((await reorderContent({})).status, 403);
});

test("a mesma ação de conteúdo com a Licença em dia, no Aviso e na observação chega ao banco", async () => {
  for (const nome of ["em_dia", "aviso", "observacao"]) {
    noPedido(nome);
    const db = bancoDoCurso();
    actionStubs.db = db;

    const resultado = await reorderContent({ modules: [{ id: "modulo-1", lessonIds: ["aula-1"] }], productId: PRODUTO });

    assert.equal(resultado.ok, true, `${nome}: ${JSON.stringify(resultado)}`);
    assert.deepEqual(db.calls.rpc.map((call) => call.name), ["admin_reorder_product_content"], nome);
  }
});

test("a classe pela entrada: no Admin limitado despublicar aulas passa e publicar é barrado; na cópia nunca ativada também", async () => {
  for (const nome of ["admin_limitado", "escola_congelada", "nao_ativada"]) {
    noPedido(nome);
    const db = bancoDoCurso();
    actionStubs.db = db;

    const publicar = await setLessonsStatus({ ids: ["aula-1"], status: "published" });
    assert.deepEqual(publicar, { error: LICENSE_REFUSAL_MESSAGES.actionClass, ok: false, status: 403 }, nome);
    assert.deepEqual(db.calls.writes, [], `${nome}: publicar não grava`);

    const despublicar = await setLessonsStatus({ ids: ["aula-1"], status: "draft" });
    assert.equal(despublicar.ok, true, `${nome}: ${JSON.stringify(despublicar)}`);
    assert.deepEqual(db.calls.writes.map((write) => [write.op, write.table, write.payload]), [["update", "lessons", { status: "draft" }]], nome);
  }
});

test("Server Action dos Webinários sem o módulo: 404 sem dizer que o módulo existe, sem tocar no banco", async () => {
  noPedido("sem_o_modulo");
  const db = createFakeDb();
  actionStubs.db = db;

  const resultado = await loadJitSettings({ webinarId: randomUUID() });

  assert.deepEqual(resultado, { error: LICENSE_REFUSAL_MESSAGES.feature, ok: false, status: 404 });
  assert.deepEqual(db.calls, { from: [], rpc: [], writes: [] });
});

// ---- Rotas -------------------------------------------------------------------------------------------------

test("rota dos Webinários sem o módulo: 404 antes da sessão (quem não entrou também não fica sabendo do módulo)", async () => {
  noPedido("sem_o_modulo");

  const faixa = await liveNowRoute.GET();
  assert.equal(faixa.status, 404);
  assert.deepEqual(await faixa.json(), { error: LICENSE_REFUSAL_MESSAGES.feature });

  const presenca = await heartbeatRoute.POST(new Request("http://127.0.0.1/api/webinars/x/heartbeat", { body: "{}", method: "POST" }), {
    params: Promise.resolve({ id: randomUUID() })
  });
  assert.equal(presenca.status, 404);

  // Com o módulo, a mesma chamada sem sessão chega à guarda da sessão (401), como sempre.
  noPedido("em_dia");
  assert.equal((await liveNowRoute.GET()).status, 401);
});

test("rota do aluno que já é aluno: passa no Aviso, no Admin limitado e na Escola congelada; na cópia nunca ativada, recusa", async () => {
  const presenca = () =>
    heartbeatRoute.POST(new Request("http://127.0.0.1/api/webinars/x/heartbeat", { body: "{}", method: "POST" }), { params: Promise.resolve({ id: randomUUID() }) });

  for (const nome of ["aviso", "admin_limitado", "escola_congelada", "endereco_diferente"]) {
    noPedido(nome);
    assert.equal((await presenca()).status, 401, `${nome}: a licença deixa passar e a sessão decide`);
  }

  noPedido("nao_ativada");
  assert.equal((await presenca()).status, 404, "a cópia nunca ativada não tem módulo nenhum");
  // A rota do aluno fora de um módulo (atendimento), na cópia nunca ativada: 403 com a frase neutra.
  const recusa = await licenseRouteRefusal({ actionClass: "atendimento" });
  assert.equal(recusa.status, 403);
  assert.deepEqual(await recusa.json(), { error: LICENSE_REFUSAL_MESSAGES.route });
});

// ---- Página ------------------------------------------------------------------------------------------------

test("página de um módulo desligado: notFound() antes de tudo; com o módulo, segue", async () => {
  noPedido("sem_o_modulo");
  await assert.rejects(requireFeaturePage(WEBINARS_FEATURE), /notFound/);

  noPedido("nao_ativada");
  await assert.rejects(requireFeaturePage(WEBINARS_FEATURE), /notFound/);

  for (const nome of ["em_dia", "admin_limitado", "escola_congelada"]) {
    noPedido(nome);
    await assert.doesNotReject(requireFeaturePage(WEBINARS_FEATURE), nome);
  }

  noPedido("sem_o_modulo");
  assert.deepEqual(await getDisabledFeatures(), [WEBINARS_FEATURE]);
});

// ---- Agendador --------------------------------------------------------------------------------------------

/** Um job_runs em memória: insert devolve o id; update aplica nas linhas que batem com os eq. */
function bancoDosJobs() {
  const linhas = [];
  return {
    linhas,
    from(tabela) {
      assert.equal(tabela, "job_runs");
      return {
        insert(payload) {
          const linha = { id: `run-${linhas.length + 1}`, ...payload };
          linhas.push(linha);
          return { select: () => ({ single: async () => ({ data: { id: linha.id }, error: null }) }) };
        },
        update(payload) {
          const filtros = [];
          const consulta = {
            eq(coluna, valor) {
              filtros.push([coluna, valor]);
              return consulta;
            },
            lt: () => consulta,
            then(resolve, reject) {
              for (const linha of linhas) {
                if (filtros.length > 0 && filtros.every(([coluna, valor]) => linha[coluna] === valor)) {
                  Object.assign(linha, payload);
                }
              }
              return Promise.resolve({ error: null }).then(resolve, reject);
            }
          };
          return consulta;
        }
      };
    }
  };
}

test("agendador: a tarefa de um módulo desligado não roda, não grava job_runs e não deixa o tick vermelho", async () => {
  const rodou = [];
  const jobs = [
    { name: "email-outbox", run: async () => rodou.push("email-outbox") },
    { feature: WEBINARS_FEATURE, name: "webinar-sessions", run: async () => rodou.push("webinar-sessions") },
    { name: "licenca-conferencia", run: async () => rodou.push("licenca-conferencia") }
  ];
  const supabase = bancoDosJobs();

  const resultado = await runJobsTick({ isFeatureEnabled: () => false, jobs, supabase });

  assert.deepEqual(rodou, ["email-outbox", "licenca-conferencia"]);
  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.ran, ["email-outbox", "licenca-conferencia"]);
  assert.deepEqual(resultado.featureOff, ["webinar-sessions"]);
  assert.deepEqual(resultado.skipped, []);
  assert.deepEqual(supabase.linhas.map((linha) => linha.job), ["tick", "email-outbox", "licenca-conferencia"]);
  assert.deepEqual(supabase.linhas[0].metadata.feature_off, ["webinar-sessions"]);
});

test("agendador sem a pergunta do módulo (o modo off): toda tarefa roda e a linha do tick fica como antes", async () => {
  const rodou = [];
  const jobs = [
    { name: "email-outbox", run: async () => rodou.push("email-outbox") },
    { feature: WEBINARS_FEATURE, name: "webinar-sessions", run: async () => rodou.push("webinar-sessions") }
  ];
  const supabase = bancoDosJobs();

  const resultado = await runJobsTick({ jobs, supabase });

  assert.deepEqual(rodou, ["email-outbox", "webinar-sessions"]);
  assert.deepEqual(resultado.featureOff, []);
  assert.deepEqual(Object.keys(supabase.linhas[0].metadata).sort(), ["failed", "ran", "skipped"], "nenhuma chave nova no modo off");
});

// ---- Menus -------------------------------------------------------------------------------------------------

const DONO = resolveAdminAccess("owner", {});

test("menu do aluno: sem o módulo, o item Webinários some; sem a lista (modo off), fica", () => {
  const chaves = (desligados) =>
    getMemberSidebarSections("/", undefined, desligados).flatMap((section) => section.items.map((item) => item.key));

  assert.ok(chaves(undefined).includes("webinars"));
  assert.ok(chaves([]).includes("webinars"));
  assert.ok(!chaves([WEBINARS_FEATURE]).includes("webinars"));
  assert.equal(chaves([WEBINARS_FEATURE]).length, chaves([]).length - 1, "só o item do módulo some");
});

test("menu, busca e Criar do admin: sem o módulo, nada leva aos Webinários; com ele (ou no modo off), como antes", () => {
  const telas = (desligados) => visibleAdminNav(DONO, desligados).flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]);
  const leva = (hrefs) => hrefs.some((href) => href.startsWith("/admin/comunicacao/webinarios"));

  assert.ok(leva(telas()));
  assert.ok(!leva(telas([WEBINARS_FEATURE])));

  const busca = (desligados) => listAdminStaticSearchItems(DONO, desligados).map((item) => item.href);
  assert.ok(leva(busca()));
  assert.ok(!leva(busca([WEBINARS_FEATURE])));
  assert.ok(!leva(listAdminStaticSearchItems(undefined, [WEBINARS_FEATURE]).map((item) => item.href)));

  const grupos = buildAdminSearchGroups("webinario", undefined, DONO, [WEBINARS_FEATURE]).flatMap((group) => group.items.map((item) => item.href));
  assert.ok(!leva(grupos));
  assert.ok(leva(buildAdminSearchGroups("webinario", undefined, DONO).flatMap((group) => group.items.map((item) => item.href))));

  const criar = (desligados) => getTodayCreateItems(() => true, desligados).map((item) => item.id);
  assert.ok(criar().includes("webinario"));
  assert.ok(!criar([WEBINARS_FEATURE]).includes("webinario"));
});
