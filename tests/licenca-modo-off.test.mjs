import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// O modo "off" (a nossa escola hoje, a dev, a Vercel e os testes) com a situação do pedido de verdade
// (src/server/licensing/current-state.ts): as guardas novas não leem o banco, não recusam nada e não mudam nenhuma
// resposta (docs/32 §11.3). E o outro lado, com BUNKER_LICENSING_MODE=enforce e a tabela sem linha (a cópia nunca
// ativada): uma leitura de license_state, guardada na memória do processo por um minuto, e só o dever legal passa.

const sessao = (globalThis.__licencaModoOffSessao ??= { user: null });

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

// A sessão das rotas vem do teste; o cliente do banco (pelo alias e por caminho relativo) é o de admin-action-stubs,
// contado: no modo "off" a situação do pedido nem cria o cliente.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__licencaModoOffSessao.user;
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

const { LICENSE_ROW_MEMORY_MS, forgetLicenseStateMemory, getCurrentLicenseState } = await import("../src/server/licensing/current-state.ts");
const { NO_DISABLED_FEATURES, WEBINARS_FEATURE } = await import("../src/server/licensing/features.ts");
const { LICENSE_REFUSAL_MESSAGES } = await import("../src/server/licensing/require-feature.ts");
const { getDisabledFeatures, isFeatureEnabledNow, licenseRouteRefusal, requireFeaturePage } = await import("../src/server/licensing/guards.ts");
const { reorderContent, setLessonsStatus } = await import("../src/server/catalog/content-actions.ts");
const liveNowRoute = await import("../src/app/api/webinars/live-now/route.ts");

const PRODUTO = "produto-modo-off";
const AGORA = "2026-11-11T12:00:00.000Z";
const antes = process.env.BUNKER_LICENSING_MODE;

function bancoDoCurso() {
  return createFakeDb({
    tables: {
      content_items: [{ id: PRODUTO, kind: "Curso", title: "Curso" }],
      course_modules: [{ id: "modulo-1", image: null, owner_id: PRODUTO, release_rule: null, sort_order: 0, status: "published", title: "Módulo", updated_at: AGORA }],
      lessons: [{ description: null, duration: null, id: "aula-1", image: null, module_id: "modulo-1", release_rule: null, sort_order: 0, status: "draft", title: "Aula", updated_at: AGORA, video_config: null }]
    }
  });
}

/** O banco do pedido, contando quantas vezes o cliente foi criado. */
function usarBanco(db) {
  const contagem = { criado: 0 };
  Object.defineProperty(actionStubs, "db", {
    configurable: true,
    get() {
      contagem.criado += 1;
      return db;
    }
  });
  return contagem;
}

test.beforeEach(() => {
  delete process.env.BUNKER_LICENSING_MODE;
  forgetLicenseStateMemory();
  sessao.user = null;
});

test.afterEach(() => {
  delete actionStubs.db;
  actionStubs.db = null;
});

test.after(() => {
  if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
  else process.env.BUNKER_LICENSING_MODE = antes;
});

test("modo off: as guardas não criam o cliente do banco, não recusam nada e não escondem nada", async () => {
  const contagem = usarBanco(createFakeDb());

  assert.deepEqual(await getCurrentLicenseState(), { mode: "off" });
  assert.equal(await getDisabledFeatures(), NO_DISABLED_FEATURES, "a mesma lista vazia de sempre");
  assert.equal(await isFeatureEnabledNow(WEBINARS_FEATURE), true);
  await assert.doesNotReject(requireFeaturePage(WEBINARS_FEATURE));

  for (const actionClass of ["leitura", "atendimento", "dever_legal", "matricula", "conteudo"]) {
    assert.equal(await licenseRouteRefusal({ actionClass, feature: WEBINARS_FEATURE }), null, actionClass);
  }

  assert.equal(contagem.criado, 0, "nenhuma pergunta à licença cria o cliente do banco no modo off");
});

test("modo off: a Server Action roda como antes e nada lê license_state", async () => {
  const db = bancoDoCurso();
  actionStubs.db = db;

  const reordenado = await reorderContent({ modules: [{ id: "modulo-1", lessonIds: ["aula-1"] }], productId: PRODUTO });
  const publicado = await setLessonsStatus({ ids: ["aula-1"], status: "published" });

  assert.equal(reordenado.ok, true, JSON.stringify(reordenado));
  assert.equal(publicado.ok, true, JSON.stringify(publicado));
  assert.ok(!db.calls.from.includes("license_state"));
});

test("modo off: a rota dos Webinários responde como antes (sem sessão, 401; nunca o 404 do módulo)", async () => {
  usarBanco(createFakeDb());

  const resposta = await liveNowRoute.GET();

  assert.equal(resposta.status, 401);
  assert.deepEqual(await resposta.json(), { error: "Sessao obrigatoria." });
});

test("enforce sem licença guardada: uma leitura de license_state, só o dever legal passa e o módulo some", async () => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  const db = bancoDoCurso();
  const contagem = usarBanco(db);

  const conteudo = await reorderContent({ modules: [{ id: "modulo-1", lessonIds: ["aula-1"] }], productId: PRODUTO });
  assert.deepEqual(conteudo, { error: LICENSE_REFUSAL_MESSAGES.actionClass, ok: false, status: 403 });

  const despublicar = await setLessonsStatus({ ids: ["aula-1"], status: "draft" });
  assert.equal(despublicar.ok, true, "despublicar é dever legal: passa até na cópia nunca ativada");

  assert.deepEqual(await getDisabledFeatures(), [WEBINARS_FEATURE]);
  const rota = await liveNowRoute.GET();
  assert.equal(rota.status, 404);
  assert.deepEqual(await rota.json(), { error: LICENSE_REFUSAL_MESSAGES.feature });
  await assert.rejects(requireFeaturePage(WEBINARS_FEATURE), /notFound/);

  // Quatro perguntas, uma leitura: a linha fica na memória do processo (as rotas consultadas sem parar).
  assert.deepEqual(db.calls.from.filter((tabela) => tabela === "license_state"), ["license_state"]);
  assert.ok(contagem.criado >= 1);
});

test("enforce: a memória da linha vale um minuto e some quando a tarefa do tick a esquece", async () => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  const db = createFakeDb();
  usarBanco(db);
  const leituras = () => db.calls.from.filter((tabela) => tabela === "license_state").length;

  await getCurrentLicenseState();
  await getCurrentLicenseState();
  assert.equal(leituras(), 1);

  forgetLicenseStateMemory();
  await getCurrentLicenseState();
  assert.equal(leituras(), 2);

  const agora = Date.now;
  try {
    Date.now = () => agora() + LICENSE_ROW_MEMORY_MS + 1;
    await getCurrentLicenseState();
  } finally {
    Date.now = agora;
  }
  assert.equal(leituras(), 3, "depois de um minuto, lê de novo");

  // A rota dos Webinários com a situação de agora; nenhuma gravação.
  const rota = await licenseRouteRefusal({ actionClass: "atendimento", feature: WEBINARS_FEATURE });
  assert.equal(rota.status, 404);
  assert.deepEqual(db.calls.writes, []);
});
