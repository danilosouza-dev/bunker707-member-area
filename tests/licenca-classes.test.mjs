import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// As classes que a revisão de 11/11/2026 achou frouxas (docs/32 §2.2 e §11.3): a regra é "o que só tira, corrige ou
// protege fica liberado; o que acrescenta ou promove fica barrado".
// - A página de entrar era dever legal inteira, por ter o contato da escola: no Admin limitado, mudava a aparência toda.
//   Agora a aparência é conteúdo, e só o contato da escola (saveLoginContact) é dever legal.
// - Salvar um segmento de alunos gravava sendo "leitura": agora é conteúdo; apagar é dever legal, como apagar o resto.
// - O PATCH de uma conexão de IA era dever legal inteiro, por trocar a chave: também retomava a conexão pausada, mudava
//   o nome e a prioridade. Agora só trocar a chave e pausar são dever legal; o resto é conteúdo.

const estado = (globalThis.__licencaClasses ??= { situacao: null, conexao: null, chamadas: [], loginPage: null, gravacoes: [] });

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
        export async function getCurrentLicenseState() { return globalThis.__licencaClasses.situacao; }
        export async function readCurrentLicenseState() { return globalThis.__licencaClasses.situacao; }
        export function forgetLicenseStateMemory() {}`);
    }
    if (modulo === "server/auth/permissions") {
      return stub(`
        export async function requireRole() { return globalThis.__adminActionStubs.role; }
        export async function requireScope() {}
        export async function requireApiRole() { return { response: null, user: { id: "00000000-0000-4000-8000-000000000001" } }; }`);
    }
    if (modulo === "server/ai/provider-connections") {
      return stub(`
        const estado = globalThis.__licencaClasses;
        export async function getAIProviderConnectionRow() { return estado.conexao; }
        export async function saveAIProviderAPIConnection(dados) { estado.chamadas.push(["trocar_chave", dados]); return { id: estado.conexao.id }; }
        export async function updateAIProviderConnection(dados) { estado.chamadas.push(["mudar", dados]); return { id: estado.conexao.id }; }
        export async function removeAIProviderConnection(id) { estado.chamadas.push(["remover", id]); return { id }; }`);
    }
    if (modulo === "server/member-area/settings-store") {
      return stub(`
        const estado = globalThis.__licencaClasses;
        export async function readPlatformSetting() { return estado.loginPage; }
        export function isSameSettingVersion(current, expected) { return expected === null ? !current.exists : current.exists && current.updatedAt === expected; }
        export async function writePlatformSettingGuarded(key, value, expected) {
          estado.gravacoes.push({ key, value, expected });
          return { updatedAt: "2026-11-11T12:30:00.000Z" };
        }`);
    }
    return nextResolve(specifier, context);
  }
});

const { computeLicenseState, EMPTY_LICENSE_SNAPSHOT } = await import("../src/server/licensing/state.ts");
const { LICENSE_REFUSAL_MESSAGES } = await import("../src/server/licensing/require-feature.ts");
const { actionClassOfAIConnectionChange } = await import("../src/server/actions/action-classes.ts");
const { saveLoginContact, saveLoginPage } = await import("../src/server/member-area/login-actions.ts");
const { defaultLoginPageSettings, isOnlyLoginContactChange } = await import("../src/server/member-area/login-model.ts");
const { deleteStudentSegment, saveStudentSegment } = await import("../src/server/students/actions.ts");
const conexaoRota = await import("../src/app/api/admin/ai-connections/[connectionId]/route.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const AGORA = new Date("2026-11-11T12:00:00.000Z");

function situacao(sobrescrever = {}) {
  return computeLicenseState({
    configuredHost: "alunos.escola.test",
    mode: "enforce",
    roots: [raiz.confiavel],
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, everActivated: true, lastSeenAt: AGORA, lastCheckIn: { emissorTime: AGORA, localTime: AGORA }, token: assinarLicenca(emissao, licencaBase(sobrescrever)) },
    systemNow: AGORA
  });
}

const ADMIN_LIMITADO = situacao({ statusSteps: [{ degree: "admin_limitado", from: "2026-11-10T12:00:00.000Z", reason: "pagamento_desfeito" }] });
const EM_DIA = situacao();

test.beforeEach(() => {
  estado.situacao = ADMIN_LIMITADO;
  estado.chamadas = [];
  estado.gravacoes = [];
  actionStubs.db = null;
  actionStubs.invalidations = [];
});

// ---- A página de entrar ------------------------------------------------------------------------------

const VERSAO = "2026-11-01T10:00:00.000Z";
const publicada = () => ({ ...defaultLoginPageSettings(), quote: "A frase publicada", template: "split-visual-right" });

test("página de entrar no Admin limitado: mudar a aparência é barrado; o contato da escola passa e só ele muda (revisão: classes)", async () => {
  estado.loginPage = { exists: true, updatedAt: VERSAO, value: publicada() };

  // A aparência inteira (outro modelo, outra frase): conteúdo. Antes da correção passava, por ser dever legal.
  const aparencia = await saveLoginPage({ expectedUpdatedAt: VERSAO, settings: { ...publicada(), quote: "Promoção!", template: "full-visual" } });
  assert.equal(aparencia.ok, false);
  assert.equal(aparencia.status, 403);
  assert.deepEqual(estado.gravacoes, []);

  // Só o contato: dever legal, passa, e o resto da página fica como estava publicado.
  const contato = await saveLoginContact({
    contact: { supportHref: "mailto:suporte@escola.test", supportLabel: "Precisa de ajuda?", supportLinkLabel: "Escreva para a escola" },
    expectedUpdatedAt: VERSAO
  });
  assert.equal(contato.ok, true, JSON.stringify(contato));
  assert.equal(estado.gravacoes.length, 1);
  const gravada = estado.gravacoes[0];
  assert.equal(gravada.key, "loginPage");
  assert.equal(gravada.expected, VERSAO);
  assert.deepEqual(gravada.value, { ...publicada(), supportHref: "mailto:suporte@escola.test", supportLabel: "Precisa de ajuda?", supportLinkLabel: "Escreva para a escola" });
  assert.deepEqual(actionStubs.invalidations.map((item) => item.target), ["login"]);

  // Campo de aparência mandado junto com o contato não entra.
  estado.gravacoes = [];
  const contrabando = await saveLoginContact({ contact: { supportHref: null, supportLabel: "Ajuda", supportLinkLabel: "", template: "full-visual", quote: "x" }, expectedUpdatedAt: VERSAO });
  assert.equal(contrabando.ok, true, JSON.stringify(contrabando));
  assert.equal(estado.gravacoes[0].value.template, "split-visual-right");
  assert.equal(estado.gravacoes[0].value.quote, "A frase publicada");
});

test("página de entrar: o contato com a versão velha volta 409; em dia, a aparência passa; o editor sabe quando só o contato mudou", async () => {
  estado.loginPage = { exists: true, updatedAt: VERSAO, value: publicada() };
  const velha = await saveLoginContact({ contact: { supportHref: null, supportLabel: "Ajuda", supportLinkLabel: "" }, expectedUpdatedAt: "2026-10-01T10:00:00.000Z" });
  assert.equal(velha.ok, false);
  assert.equal(velha.status, 409);
  assert.deepEqual(estado.gravacoes, []);

  estado.situacao = EM_DIA;
  const aparencia = await saveLoginPage({ expectedUpdatedAt: VERSAO, settings: { ...publicada(), quote: "Outra frase" } });
  assert.equal(aparencia.ok, true, JSON.stringify(aparencia));

  assert.equal(isOnlyLoginContactChange(publicada(), { ...publicada(), supportLabel: "Ajuda", supportHref: "https://escola.test/ajuda", supportLinkLabel: "Fale conosco" }), true);
  assert.equal(isOnlyLoginContactChange(publicada(), { ...publicada(), quote: "Outra" }), false);
  assert.equal(isOnlyLoginContactChange(publicada(), { ...publicada(), quote: "Outra", supportLabel: "Ajuda" }), false);
});

// ---- Os segmentos de alunos ----------------------------------------------------------------------------

test("segmentos de alunos: salvar é conteúdo (barrado no Admin limitado, antes do banco); apagar é dever legal (revisão: classes)", async () => {
  const db = createFakeDb({ tables: { student_segments: [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Inativos" }] } });
  actionStubs.db = db;

  const salvar = await saveStudentSegment({ name: "Novos", params: {} });
  assert.equal(salvar.ok, false);
  assert.equal(salvar.status, 403, "antes da correção era leitura e gravava");
  assert.deepEqual(db.calls.from, [], "nem toca no banco");

  const apagar = await deleteStudentSegment({ id: "00000000-0000-4000-8000-0000000000aa" });
  assert.notEqual(apagar.status, 403, JSON.stringify(apagar));
  assert.ok(db.calls.from.includes("student_segments"), "apagar chega ao banco");
});

// ---- A conexão de IA -------------------------------------------------------------------------------------

const CONEXAO = { id: "11111111-1111-4111-8111-111111111111", auth_mode: "api_key", label: "Chave OpenAI", priority: 3, provider: "openai", status: "paused" };

async function patch(corpo) {
  const resposta = await conexaoRota.PATCH(new Request(`https://alunos.escola.test/api/admin/ai-connections/${CONEXAO.id}`, { body: JSON.stringify(corpo), method: "PATCH" }), {
    params: Promise.resolve({ connectionId: CONEXAO.id })
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

test("conexão de IA no Admin limitado: trocar a chave e pausar passam; retomar, renomear e mudar a prioridade são barrados (revisão: classes)", async () => {
  estado.conexao = CONEXAO;

  // Trocar a chave vazada, com o nome e a prioridade como estão (o editor manda os dois junto): dever legal.
  assert.equal((await patch({ apiKey: "sk-nova", label: " Chave   OpenAI ", priority: 3 })).status, 200);
  assert.deepEqual(estado.chamadas.map(([nome]) => nome), ["trocar_chave"]);

  // Pausar (desligar a integração): dever legal.
  assert.equal((await patch({ paused: true })).status, 200);

  // Retomar a pausada: antes da correção passava no Admin limitado, por ser dever legal.
  estado.chamadas = [];
  for (const corpo of [{ paused: false }, { label: "Outro nome" }, { priority: 1 }, { apiKey: "sk-nova", label: "Chave OpenAI", priority: 9 }]) {
    const resposta = await patch(corpo);
    assert.equal(resposta.status, 403, JSON.stringify(corpo));
    assert.deepEqual(resposta.corpo, { error: LICENSE_REFUSAL_MESSAGES.route });
  }
  assert.deepEqual(estado.chamadas, [], "nada foi gravado");

  // Com a Licença em dia, tudo passa.
  estado.situacao = EM_DIA;
  assert.equal((await patch({ paused: false, priority: 1 })).status, 200);
  assert.deepEqual(estado.chamadas.map(([nome]) => nome), ["mudar"]);
});

test("a classe da mudança numa conexão de IA sai da própria mudança e da conexão como está", () => {
  const atual = { auth_mode: "api_key", label: "Chave OpenAI", priority: 3 };
  assert.equal(actionClassOfAIConnectionChange({ apiKey: "sk" }, atual), "dever_legal");
  assert.equal(actionClassOfAIConnectionChange({ apiKey: "sk", label: "Chave  OpenAI", priority: "3" }, atual), "dever_legal");
  assert.equal(actionClassOfAIConnectionChange({ paused: true }, atual), "dever_legal");
  assert.equal(actionClassOfAIConnectionChange({ paused: false }, atual), "conteudo");
  assert.equal(actionClassOfAIConnectionChange({ paused: "nao" }, atual), "conteudo");
  assert.equal(actionClassOfAIConnectionChange({ label: "Outra" }, atual), "conteudo");
  assert.equal(actionClassOfAIConnectionChange({ priority: 4 }, atual), "conteudo");
  assert.equal(actionClassOfAIConnectionChange({ apiKey: "sk", priority: 9 }, atual), "conteudo");
});
