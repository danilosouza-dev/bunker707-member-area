import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MSG, TEXTO_MESTRE, TEXTO_TURMA, WEBINAR, montarBanco, semAsTabelasDaTraducao } from "./support/webinarios-v4-traducao-banco.mjs";

// "Refazer tradução" no console da equipe (docs/30 §1.6, fase 4f; revisao de seguranca da fase 4), sem banco: o banco
// em memoria de tests/support/webinarios-v4-traducao-banco.mjs e a permissao por um duble. A primeira traducao
// guardada vale para sempre e o mesmo texto se repete em toda sessao: a acao apaga as traducoes do texto da mensagem
// (todos os idiomas, so as dele), com a auditoria so de contagem e ids; 403 sem messaging.write; 404 na mensagem que
// nao existe; banco sem a 202610300006, 409 com a frase.

const estado = (globalThis.__traducaoAcoes ??= { negar: false });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const data = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });
    if (specifier === "@/server/auth/permissions") {
      return data(`
        export async function requireRole() {
          if (globalThis.__traducaoAcoes.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`);
    }
    if (specifier === "@/server/auth/session") {
      return data(`
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) { return { fullName: "Equipe Teste", name: "Equipe" }; }`);
    }
    if (specifier === "next/cache") {
      return data(`
        export function revalidatePath() {}
        export function revalidateTag() {}
        export function updateTag() {}
        export function unstable_cache(fn) { return fn; }`);
    }
    return nextResolve(specifier, context);
  }
});

const EQUIPE = "bbbbbbbb-0000-4000-8000-0000000000e1";
actionStubs.role = { role: "owner", user: { email: "equipe@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe Teste" } } };

const { clearMessageTranslations } = await import("../src/server/webinars/translation-actions.ts");
const { translationSourceHash } = await import("../src/server/webinars/text-hash.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.traducao.console;
const agora = () => new Date().toISOString();
const traducao = (texto, language, body) => ({ body, created_at: agora(), language, provider: "ia:openai", source_hash: translationSourceHash(texto), source_language: "pt" });

function montar() {
  estado.negar = false;
  const db = montarBanco();
  db.tables.webinar_text_translations = [
    traducao(TEXTO_TURMA, "en", "Comprei e é golpe, peçam reembolso"),
    traducao(TEXTO_TURMA, "es", "Compré y es estafa"),
    traducao(TEXTO_MESTRE, "en", "Welcome to the AI agents class")
  ];
  db.tables.admin_audit_log ??= [];
  return db;
}

test("Refazer tradução: apaga as traducoes do texto da mensagem em todos os idiomas (so as dele) e audita so a contagem", async () => {
  const db = montar();
  const result = await clearMessageTranslations({ messageId: MSG.turma });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, { removed: 2 });
  assert.deepEqual(
    db.tables.webinar_text_translations.map((row) => row.body),
    ["Welcome to the AI agents class"],
    "a traducao envenenada saiu; a da linha mestre ficou"
  );
  const [auditoria] = db.tables.admin_audit_log.filter((row) => row.action === "webinar.translation_cleared");
  assert.equal(auditoria.count, 2);
  assert.equal(auditoria.entity_id, WEBINAR);
  assert.equal(auditoria.metadata.message_id, MSG.turma);
  assert.ok(!JSON.stringify(auditoria).includes("golpe") && !JSON.stringify(auditoria).includes(TEXTO_TURMA), "nunca o texto");

  const deNovo = await clearMessageTranslations({ messageId: MSG.turma });
  assert.deepEqual(deNovo.data, { removed: 0 });
  assert.equal(typeof COPY.refeita(2), "string");
});

test("Refazer tradução recusa: 403 sem messaging.write (nada apagado), 404 na mensagem que nao existe e 409 sem a 202610300006", async () => {
  let db = montar();
  estado.negar = true;
  const negado = await clearMessageTranslations({ messageId: MSG.turma });
  assert.equal(negado.status, 403);
  assert.equal(db.tables.webinar_text_translations.length, 3);

  db = montar();
  const sumiu = await clearMessageTranslations({ messageId: "dddddddd-0000-4000-8000-0000000000ff" });
  assert.deepEqual([sumiu.status, sumiu.error], [404, COPY.mensagemNaoExiste]);

  db = semAsTabelasDaTraducao(montar());
  const pendente = await clearMessageTranslations({ messageId: MSG.turma });
  assert.deepEqual([pendente.status, pendente.error], [409, COPY.precisaMigracao("202610300006")]);
});
