import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ambienteDaSalaAoVivo, LIVE_AO_VIVO_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveAoVivoDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// O microfone sozinho da Live ao vivo (docs/31, caminho A, sem migracao; docs/18 §3) contra o banco LOCAL de verdade:
// a Server Action setSelfUnmute grava so a chave `selfUnmute` no jsonb webinars.room_settings (o resto fica igual), o
// co-apresentador tambem grava (com messaging.write), a Equipe que nao apresenta recebe 403, cada gravacao deixa a linha
// de auditoria so com ids, e o GET do retrato do console (a rota de 5 s) devolve live.selfUnmute.

ambienteDaSalaAoVivo(process.env);
const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const live = await import("../../src/server/webinars/live-actions.ts");
const consoleRoute = await import("../../src/app/api/admin/webinars/[id]/console/route.ts");

const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const { id: webinarId, sessaoId } = LIVE_AO_VIVO_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function roomSettings() {
  return unwrap(await db.from("webinars").select("room_settings").eq("id", webinarId).single(), "Lendo o room_settings da live de teste").room_settings;
}

async function retrato() {
  const resposta = await consoleRoute.GET(new Request(`http://localhost/api/admin/webinars/${webinarId}/console?sessao=${sessaoId}`), contexto);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  return (await resposta.json()).data;
}

/** O professor (co-apresentador da live de teste) com messaging.write so neste arquivo; o seed volta a funcao dele. */
async function darEscritaAoProfessor() {
  unwrap(
    await db.from("admin_roles").upsert({ permissions: { actions: ["messaging.write"] }, role: "custom", user_id: professor.id }, { onConflict: "user_id" }),
    "Dando messaging.write ao co-apresentador de teste"
  );
}

before(async () => {
  await limparWebinarios(db);
  await seedLiveAoVivoDeTeste(db);
  await darEscritaAoProfessor();
});

after(async () => {
  actAs(null);
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  unwrap(await db.from("admin_audit_log").delete().eq("entity_id", webinarId).eq("action", "webinar.self_unmute"), "Apagando a auditoria de teste");
});

test("setSelfUnmute grava so a chave selfUnmute, o co-apresentador consegue, a Equipe recebe 403 e o retrato devolve a politica", async () => {
  const antes = await roomSettings();
  assert.ok(!Object.hasOwn(antes, "selfUnmute") || antes.selfUnmute === false, "a live de teste comeca sem o microfone sozinho");

  actAs(produtor);
  assert.equal((await retrato()).live.selfUnmute, false, "sem a chave, desligado");
  assert.deepEqual(ok(await live.setSelfUnmute({ allowed: true, sessionId: sessaoId })), { allowed: true, sessionId: sessaoId });
  assert.deepEqual(await roomSettings(), { ...antes, selfUnmute: true }, "so a chave muda; o resto do room_settings fica igual");
  assert.equal((await retrato()).live.selfUnmute, true, "o GET do retrato devolve a politica gravada");

  actAs(professor);
  ok(await live.setSelfUnmute({ allowed: false, sessionId: sessaoId }));
  assert.deepEqual(await roomSettings(), { ...antes, selfUnmute: false }, "o co-apresentador fecha o microfone da turma");

  // A Equipe que nao apresenta (aqui com messaging.write pela funcao personalizada) recebe a recusa e nada muda.
  unwrap(
    await db.from("admin_roles").upsert({ permissions: { actions: ["messaging.write"] }, role: "custom", user_id: analista.id }, { onConflict: "user_id" }),
    "Dando messaging.write a Equipe de teste"
  );
  actAs(analista);
  const recusa = await live.setSelfUnmute({ allowed: true, sessionId: sessaoId });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.status, 403);
  assert.equal((await roomSettings()).selfUnmute, false);

  const auditoria = unwrap(
    await db.from("admin_audit_log").select("action,actor_id,metadata").eq("entity_id", webinarId).eq("action", "webinar.self_unmute").order("occurred_at", { ascending: true }),
    "Lendo a auditoria do microfone sozinho"
  );
  assert.deepEqual(
    auditoria.map((row) => [row.actor_id, row.metadata.allowed, row.metadata.session_id]),
    [
      [produtor.id, true, sessaoId],
      [professor.id, false, sessaoId]
    ],
    "uma linha por gravacao, so com ids; a recusa nao grava"
  );
});
