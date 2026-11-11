import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// A leitura da licença que falha no modo "enforce" (a migração 202611100001 pendente, ou o banco com erro; revisão de
// 11/11/2026): antes, a situação do pedido lançava e derrubava toda página do aluno (getAppShellData) e o admin inteiro
// (o layout), inclusive a tela Licença. Agora cada pedido segue: os módulos ficam escondidos e negados (fecha), só o
// dever legal passa, o log leva só o motivo, e a tela Licença diz o que houve.

const sessao = (globalThis.__licencaLeituraFalhaSessao ??= { user: null });

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
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__licencaLeituraFalhaSessao.user;
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

const { forgetLicenseStateMemory, readCurrentLicenseState, readLicenseOverview } = await import("../src/server/licensing/current-state.ts");
const { KNOWN_FEATURES, WEBINARS_FEATURE } = await import("../src/server/licensing/features.ts");
const { LICENSE_REFUSAL_MESSAGES, disabledFeaturesOf, isActionClassAllowed, isFeatureEnabled, isGrantEnabled } = await import(
  "../src/server/licensing/require-feature.ts"
);
const { getDisabledFeatures, isFeatureEnabledNow, licenseRouteRefusal, requireFeaturePage } = await import("../src/server/licensing/guards.ts");
const { reorderContent, setLessonsStatus } = await import("../src/server/catalog/content-actions.ts");

const PRODUTO = "produto-leitura-falha";
const AGORA = "2026-11-11T12:00:00.000Z";
const SEGREDO = "bks_segredo-que-nunca-vai-para-o-log-0000000000000";
const antes = process.env.BUNKER_LICENSING_MODE;

/** O banco do curso, com a leitura de license_state falhando como o Supabase falha. */
function bancoComLicencaQueFalha(erro) {
  const db = createFakeDb({
    tables: {
      content_items: [{ id: PRODUTO, kind: "Curso", title: "Curso" }],
      course_modules: [{ id: "modulo-1", image: null, owner_id: PRODUTO, release_rule: null, sort_order: 0, status: "published", title: "Módulo", updated_at: AGORA }],
      lessons: [{ description: null, duration: null, id: "aula-1", image: null, module_id: "modulo-1", release_rule: null, sort_order: 0, status: "draft", title: "Aula", updated_at: AGORA, video_config: null }]
    }
  });
  const from = db.from.bind(db);
  db.leiturasDaLicenca = 0;
  db.from = (tabela) => {
    if (tabela !== "license_state") {
      return from(tabela);
    }
    db.leiturasDaLicenca += 1;
    const falha = { data: null, error: erro };
    const cadeia = { eq: () => cadeia, maybeSingle: async () => falha, select: () => cadeia };
    return cadeia;
  };
  return db;
}

const MIGRACAO_PENDENTE = { code: "42P01", message: 'relation "public.license_state" does not exist' };
const ERRO_DO_BANCO = { code: "57P01", details: `token BKL1.x segredo ${SEGREDO}`, message: "terminating connection due to administrator command" };

function comLogs(fazer) {
  const linhas = [];
  const [erro, info] = [console.error, console.info];
  console.error = (...args) => linhas.push(args.map(String).join(" "));
  console.info = (...args) => linhas.push(args.map(String).join(" "));
  return Promise.resolve()
    .then(fazer)
    .finally(() => {
      console.error = erro;
      console.info = info;
    })
    .then(() => linhas);
}

test.beforeEach(() => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  forgetLicenseStateMemory();
  sessao.user = null;
});

test.after(() => {
  if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
  else process.env.BUNKER_LICENSING_MODE = antes;
  actionStubs.db = null;
});

test("leitura da licença que falha: os menus escondem os módulos em vez de derrubar a página (revisão: leitura que falha)", async () => {
  for (const erro of [MIGRACAO_PENDENTE, ERRO_DO_BANCO]) {
    forgetLicenseStateMemory();
    actionStubs.db = bancoComLicencaQueFalha(erro);

    const linhas = await comLogs(async () => {
      // Antes: as duas lançavam, e o layout do admin e a moldura do aluno (getAppShellData) iam junto.
      assert.deepEqual(await getDisabledFeatures(), [...KNOWN_FEATURES]);
      assert.equal(await isFeatureEnabledNow(WEBINARS_FEATURE), false);
      assert.equal(await readCurrentLicenseState(), null);
    });

    assert.ok(linhas.length >= 1, "a falha fica no log");
    assert.ok(linhas.every((linha) => !linha.includes(SEGREDO) && !linha.includes("BKL1")), "o log nunca leva a linha nem o segredo");
    assert.ok(linhas.some((linha) => linha.includes("[licenca]")));
  }
});

test("leitura da licença que falha: o módulo responde 404, a classe barrada 403, e o dever legal passa sem ler", async () => {
  actionStubs.db = bancoComLicencaQueFalha(MIGRACAO_PENDENTE);

  await comLogs(async () => {
    await assert.rejects(requireFeaturePage(WEBINARS_FEATURE), /notFound/);

    const modulo = await licenseRouteRefusal({ actionClass: "atendimento", feature: WEBINARS_FEATURE });
    assert.equal(modulo.status, 404);
    assert.deepEqual(await modulo.json(), { error: LICENSE_REFUSAL_MESSAGES.feature });

    const classe = await licenseRouteRefusal({ actionClass: "conteudo" });
    assert.equal(classe.status, 403);

    const leituras = actionStubs.db.leiturasDaLicenca;
    assert.equal(await licenseRouteRefusal({ actionClass: "dever_legal" }), null);
    assert.equal(actionStubs.db.leiturasDaLicenca, leituras, "dever legal nem lê a licença");
  });
});

test("leitura da licença que falha: no admin, a ação de conteúdo é recusada e a de dever legal (a tela Licença, despublicar) passa", async () => {
  actionStubs.db = bancoComLicencaQueFalha(MIGRACAO_PENDENTE);

  await comLogs(async () => {
    const conteudo = await reorderContent({ modules: [{ id: "modulo-1", lessonIds: ["aula-1"] }], productId: PRODUTO });
    assert.deepEqual(conteudo, { error: LICENSE_REFUSAL_MESSAGES.actionClass, ok: false, status: 403 });

    const despublicar = await setLessonsStatus({ ids: ["aula-1"], status: "draft" });
    assert.equal(despublicar.ok, true, JSON.stringify(despublicar));

    // A tela Licença lê a visão geral pelo mesmo caminho: sem leitura, ela mostra o aviso em vez de cair.
    assert.equal(await readLicenseOverview(), null);
  });
});

test("sem leitura (null), a fonte única fecha: nenhum módulo, nenhuma chave interna, só o dever legal", () => {
  assert.equal(isFeatureEnabled(null, WEBINARS_FEATURE), false);
  assert.deepEqual(disabledFeaturesOf(null), [...KNOWN_FEATURES]);
  assert.equal(isGrantEnabled(null, "vendedor"), false);
  assert.deepEqual(
    ["leitura", "atendimento", "dever_legal", "matricula", "conteudo"].map((classe) => isActionClassAllowed(null, classe)),
    [false, false, true, false, false]
  );
});

test("a moldura do aluno, o layout do admin, a tela Licença e o tick usam a leitura que não derruba", () => {
  const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

  const moldura = ler("src/server/db/platform-store.ts");
  const shell = moldura.slice(moldura.indexOf("export async function getAppShellData"), moldura.indexOf("export async function getHomePageData"));
  assert.match(shell, /getDisabledFeatures\(\)/);
  assert.doesNotMatch(shell, /getCurrentLicenseState\(\)/);

  assert.match(ler("src/app/admin/(v2)/layout.tsx"), /getDisabledFeatures\(\)/);
  const tela = ler("src/app/admin/(v2)/configuracoes/licenca/page.tsx");
  assert.match(tela, /await readLicenseOverview\(\)/);
  assert.doesNotMatch(tela, /getLicenseOverview\(\)/);
  const tick = ler("src/app/api/jobs/tick/route.ts");
  assert.match(tick, /await readCurrentLicenseState\(\)/);
  assert.doesNotMatch(tick, /getCurrentLicenseState\(\)/);
});
