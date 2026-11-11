import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MIN, REPLAY, SESSION, WEBINAR, bancoFalso, escola, iso } from "./support/webinarios-sala-banco.mjs";

// O roteiro na Live ao vivo e a foto de quem comenta (adendo de 10/11/2026, R8 e R9; docs/18 §2.1 e §2.2), sem banco:
// o banco falso das rotas da Sala (tests/support/webinarios-sala-banco.mjs) com a escola de mentira virada Live ao
// vivo, a permissao e a sessao da equipe como dubles e "next/cache" so anotando. Aqui:
// - o modelo puro (persona-model.ts): o endereco da foto so pela origem conferida e so com o caminho da nossa pasta, o
//   mesmo nome de quem comenta (sem caixa e espacos), a foto nos itens com o mesmo nome, quando o tick solta (nunca
//   antes do Começar para todos, no maximo 5 min atrasado, so "Num minuto da live" prontos que nao entraram), o rotulo
//   "Aos 12 minutos da live" e os gatilhos da live (sem "Quando o apresentador diz");
// - a regra da foto no chat (room-model.authorPhotoUrl, que muda o D62 so nisto): a mensagem `scripted` mostra a foto
//   de quem comenta; sem ela, as iniciais; o Assistente nunca;
// - o tick da live (live-script-tick.ts): solta os itens vencidos como mensagens `scripted` da sessao com a foto
//   copiada, uma vez; a espera, a gravada e o Replay ficam de fora; a corrida com o "Soltar agora" nao repete; o banco
//   sem a coluna da foto solta sem foto; o tick sem tempo nao faz nada; banco sem as tabelas, zeros;
// - as Server Actions (script-actions.ts): o "Enviar agora" (a mensagem sem item, com nome, papel e foto, e o "Usar
//   esta foto em todos os comentários de {nome}"), o "Guardar na lista" (o item "Pelo botão da equipe" no fim), o
//   "Soltar agora" na live com a foto copiada, o salvar do roteiro com a foto (ausente fica, nula tira), o envio da foto
//   (512 px, 100 KB, sem animacao, so o caminho) e o banco sem a 202611100002 (409 com a frase so ao gravar uma foto);
// - a leitura: a sala recebe a foto de quem comenta no avatar das mensagens do roteiro pela origem do nosso Supabase,
//   com a memoria do processo e o banco sem a coluna tolerado; o console recebe o roteiro da live com a foto de cada item.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const estado = (globalThis.__roteiroAoVivo ??= { negar: false, revalidados: [] });
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole() {
          if (globalThis.__roteiroAoVivo.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "@/server/auth/session") {
      const source = `
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || "Equipe";
          return { fullName, name: fullName.split(/\\s+/)[0] };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__roteiroAoVivo.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__roteiroAoVivo.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__roteiroAoVivo.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "equipe.teste@bunker707.test", id: EQUIPE, user_metadata: { full_name: "Equipe de Teste" } } };

const persona = await import("../src/server/webinars/persona-model.ts");
const { authorPhotoUrl } = await import("../src/server/webinars/room-model.ts");
const tick = await import("../src/server/webinars/live-script-tick.ts");
const scriptActions = await import("../src/server/webinars/script-actions.ts");
const roomQueries = await import("../src/server/webinars/room-queries.ts");
const consoleQueries = await import("../src/server/webinars/console-queries.ts");
const { clearScriptedAvatarCache } = await import("../src/server/webinars/persona-store.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");

const COPY = WEBINAR_COPY.naTela.comentarios;
const FOTO = "webinars/personas/0123456789abcdef01234567.webp";
const OUTRA_FOTO = "webinars/personas/89abcdef0123456789abcdef.webp";
const ORIGEM = "https://projeto.supabase.co";

/* ------------------------------------------------------------------------------------------------
 * O cenario: a escola de mentira como Live ao vivo no ar ha 10 min, com o roteiro
 * ---------------------------------------------------------------------------------------------- */

const ITENS = {
  aos5: "dddddddd-0000-4000-8000-000000000001",
  aos9: "dddddddd-0000-4000-8000-000000000002",
  aos11: "dddddddd-0000-4000-8000-000000000003",
  botao: "dddddddd-0000-4000-8000-000000000004",
  desligado: "dddddddd-0000-4000-8000-000000000005",
  jaEntrou: "dddddddd-0000-4000-8000-000000000006",
  atrasado: "dddddddd-0000-4000-8000-000000000007"
};

function item(id, extra = {}) {
  return {
    body: `Comentário ${id.slice(-1)}`,
    created_at: iso(Date.now() - 60 * MIN),
    created_by: null,
    generated_by_ai: false,
    id,
    kind: "message",
    offset_ms: 60_000,
    persona_avatar_path: null,
    persona_name: "Bia C.",
    persona_role: "student",
    phrase: null,
    phrase_delay_ms: 0,
    position: 0,
    resolved_offset_ms: null,
    resolved_transcript_id: null,
    status: "ready",
    trigger_kind: "at_offset",
    updated_at: iso(Date.now() - 60 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

/** A Live ao vivo no ar (started_at ha `minutos`), sem ancora da gravacao, com o roteiro de sempre. */
function cenario({ minutos = 10, sessao = {} } = {}) {
  const tables = escola({ kind: "live", status: "live" });
  const now = Date.now();
  const live = tables.webinar_sessions.find((row) => row.id === SESSION);
  Object.assign(live, { kind: "live", recording_anchor_at: null, recording_id: null, scheduled_at: iso(now - (minutos + 5) * MIN), show_live_badge: false, source_session_id: null, started_at: iso(now - minutos * MIN), status: "live", ...sessao });
  tables.webinar_chat_script_items = [
    // 4:30 atrasado no tick (dentro dos 5 min; a borda exata fica no teste do modelo, com o relogio parado).
    item(ITENS.aos5, { offset_ms: 5 * MIN + 30_000, persona_avatar_path: FOTO, position: 0 }),
    item(ITENS.aos9, { offset_ms: 9 * MIN, persona_name: "Caio D.", persona_role: "team", position: 1 }),
    item(ITENS.aos11, { offset_ms: 11 * MIN, position: 2 }),
    item(ITENS.botao, { offset_ms: null, position: 3, trigger_kind: "manual" }),
    item(ITENS.desligado, { offset_ms: 1 * MIN, position: 4, status: "disabled" }),
    item(ITENS.jaEntrou, { offset_ms: 3 * MIN, position: 5 }),
    item(ITENS.atrasado, { offset_ms: 2 * MIN, position: 6 })
  ];
  tables.webinar_chat_messages.push({
    approved: true,
    author_user_id: null,
    body: "Já entrou",
    created_at: iso(now - 7 * MIN),
    deleted_at: null,
    display_name: "Bia C.",
    id: "eeeeeeee-0000-4000-8000-000000000001",
    kind: "message",
    master: false,
    offset_ms: 3 * MIN,
    persona_avatar_path: null,
    pinned_at: null,
    reply_to_id: null,
    role: "student",
    script_item_id: ITENS.jaEntrou,
    session_id: SESSION,
    source: "scripted",
    webinar_id: WEBINAR
  });
  tables.admin_audit_log = [];
  return tables;
}

function usar(tables = cenario()) {
  const db = bancoFalso({ tables });
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  clearScriptedAvatarCache();
  return db;
}

/**
 * O banco sem a 202611100002 para a foto: 42703 em qualquer leitura que pede persona_avatar_path e em qualquer escrita
 * que a leva (o resto do banco segue igual). Sem ela tambem nao ha a 202611110001 (vem depois): a lista de pessoas
 * (webinar_personas) e o persona_id do item e da pergunta tambem nao existem.
 */
function semAColunaDaFoto(db) {
  const from = db.from.bind(db);
  const erro = { code: "42703", message: "column webinar_chat_messages.persona_avatar_path does not exist" };
  const semTabela = { code: "PGRST205", message: "Could not find the table 'public.webinar_personas' in the schema cache" };
  const nova = /persona_avatar_path|persona_id/;
  db.from = (name) => {
    const chain = from(name);
    const falhar = (error = erro) => {
      chain.then = (resolve, reject) => Promise.resolve({ data: null, error }).then(resolve, reject);
      return chain;
    };
    if (name === "webinar_personas") {
      return falhar(semTabela);
    }
    for (const metodo of ["select", "insert", "update", "upsert"]) {
      const original = chain[metodo];
      chain[metodo] = (payload, ...resto) => {
        original(payload, ...resto);
        const leva = metodo === "select" ? nova.test(String(payload ?? "")) : nova.test(JSON.stringify(payload ?? {}));
        return leva ? falhar() : chain;
      };
    }
    return chain;
  };
  return db;
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const soltas = (db, sessionId = SESSION) => db.tables.webinar_chat_messages.filter((row) => row.session_id === sessionId && row.source === "scripted");
const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);

async function silenciando(fn) {
  const originais = { error: console.error, info: console.info };
  const linhas = [];
  console.info = (...args) => linhas.push(args.join(" "));
  console.error = (...args) => linhas.push(args.join(" "));
  try {
    return [await fn(), linhas];
  } finally {
    Object.assign(console, originais);
  }
}

/* ------------------------------------------------------------------------------------------------
 * O modelo puro
 * ---------------------------------------------------------------------------------------------- */

test("R9 modelo: o endereco da foto so pela origem conferida do nosso Supabase e so com o caminho da pasta webinars/personas", () => {
  assert.equal(persona.personaAvatarUrl(FOTO, ORIGEM), `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`);
  assert.equal(persona.personaAvatarUrl(FOTO, "http://127.0.0.1:54321"), `http://127.0.0.1:54321/storage/v1/object/public/content-assets/${FOTO}`, "o Supabase local");
  for (const caminho of ["webinars/screen/0123456789abcdef01234567.webp", "webinars/personas/0123456789ABCDEF01234567.webp", "https://golpe.com/foto.webp", "webinars/personas/x.webp", null, undefined]) {
    assert.equal(persona.personaAvatarUrl(caminho, ORIGEM), null, String(caminho));
  }
  for (const origem of ["http://golpe.com", "https://projeto.supabase.co/caminho", "https://user:senha@projeto.supabase.co", "", null]) {
    assert.equal(persona.personaAvatarUrl(FOTO, origem), null, String(origem));
  }
  assert.equal(persona.isPersonaAvatarPath(FOTO), true);
  assert.deepEqual(persona.PERSONA_AVATAR_LIMITS, { bytes: 100_000, sideMax: 512, sideMin: 16 });
});

test("R9 modelo: o mesmo nome de quem comenta (sem caixa nem espacos sobrando); desde 11/11/2026 a foto vai pela pessoa da lista, nos itens ligados a ela", () => {
  assert.equal(persona.samePersonaName("Bia C.", "  bia   c. "), true);
  assert.equal(persona.samePersonaName("Bia C.", "Bia D."), false);
  assert.equal(persona.samePersonaName("", ""), false, "sem nome, nunca");
  // O "Usar esta foto em todos os comentários de {nome}" saiu (D75): editar a pessoa troca a copia dos itens dela.
  assert.equal("withPersonaAvatarForName" in persona, false);
  const itens = [
    { personaAvatarPath: null, personaId: "p1", personaName: "Bia C.", personaRole: "student" },
    { personaAvatarPath: OUTRA_FOTO, personaId: null, personaName: "BIA C.", personaRole: "student" },
    { personaAvatarPath: null, personaId: "p2", personaName: "Caio D.", personaRole: "team" }
  ];
  assert.deepEqual(
    persona.withPersonaCopy(itens, { avatarPath: FOTO, id: "p1", name: "Bia Costa", role: "team" }).map((entry) => [entry.personaName, entry.personaRole, entry.personaAvatarPath]),
    [
      ["Bia Costa", "team", FOTO],
      ["BIA C.", "student", OUTRA_FOTO],
      ["Caio D.", "team", null]
    ],
    "so os itens ligados a pessoa; o de mesmo nome fora da lista fica"
  );
});

test("R8 modelo: o tick solta so 'Num minuto da live' prontos que nao entraram, nunca antes do Começar para todos e no maximo 5 min atrasados, na ordem do minuto", () => {
  const started = "2026-11-10T23:00:00.000Z";
  const nowMs = Date.parse(started) + 10 * MIN;
  const itens = [
    { id: "a", offsetMs: 9 * MIN, position: 5, status: "ready", triggerKind: "at_offset" },
    { id: "b", offsetMs: 5 * MIN, position: 0, status: "ready", triggerKind: "at_offset" },
    { id: "c", offsetMs: 11 * MIN, position: 1, status: "ready", triggerKind: "at_offset" },
    { id: "d", offsetMs: null, position: 2, status: "ready", triggerKind: "manual" },
    { id: "e", offsetMs: 1 * MIN, position: 3, status: "disabled", triggerKind: "at_offset" },
    { id: "f", offsetMs: 3 * MIN, position: 4, status: "ready", triggerKind: "at_offset" },
    { id: "g", offsetMs: 4 * MIN + 59_000, position: 6, status: "ready", triggerKind: "at_offset" },
    { id: "h", offsetMs: 6 * MIN, position: 7, status: "ready", triggerKind: "on_phrase" },
    { id: "i", offsetMs: 9 * MIN, position: 1, status: "ready", triggerKind: "at_offset" }
  ];
  const ids = (input) => persona.liveScriptDue(input).map((entry) => entry.id);
  assert.deepEqual(ids({ fired: new Set(["f"]), items: itens, nowMs, startedAt: started }), ["b", "i", "a"], "5 min atrasado ainda entra; 5:01 nao; o mesmo minuto pela posicao");
  assert.deepEqual(ids({ fired: new Set(), items: itens, nowMs, startedAt: null }), [], "na espera, nada");
  assert.deepEqual(ids({ fired: new Set(), items: itens, nowMs: Date.parse(started) - 1, startedAt: started }), []);
  const muitos = Array.from({ length: 80 }, (_, index) => ({ id: `m${index}`, offsetMs: index * 1000, position: index, status: "ready", triggerKind: "at_offset" }));
  assert.equal(persona.liveScriptDue({ fired: new Set(), items: muitos, nowMs: Date.parse(started) + 2 * MIN, startedAt: started }).length, persona.LIVE_SCRIPT_BATCH);
  assert.equal(persona.LIVE_SCRIPT_LATE_MAX_MS, 5 * MIN);
});

test("R8 modelo: 'Aos 12 minutos da live', os gatilhos da live sem 'Quando o apresentador diz'", () => {
  assert.equal(persona.liveScriptDueLabel(0), "No começo da live");
  assert.equal(persona.liveScriptDueLabel(MIN), "Com 1 minuto de live");
  assert.equal(persona.liveScriptDueLabel(12 * MIN), "Aos 12 minutos da live");
  assert.equal(persona.liveScriptDueLabel(12 * MIN + 30_000), "Aos 12:30 da live");
  assert.deepEqual(persona.scriptTriggersFor("live"), ["at_offset", "manual"]);
  assert.deepEqual(persona.scriptTriggersFor("simulated"), ["at_offset", "on_phrase", "manual"]);
  assert.deepEqual(persona.LIVE_SCRIPT_TRIGGER_LABELS, { at_offset: "Num minuto da live", manual: "Pelo botão da equipe" });
});

test("R9 a foto no chat (muda o D62 so nisto): a mensagem do roteiro mostra a foto de quem comenta para a turma e para a equipe; sem ela, as iniciais; o Assistente nunca", () => {
  const url = persona.personaAvatarUrl(FOTO, ORIGEM);
  const base = { authorUserId: null, displayName: "Bia C.", photo: null, webinarId: WEBINAR };
  assert.equal(authorPhotoUrl({ ...base, personaAvatarUrl: url, source: "scripted", viewer: "student" }), url);
  assert.equal(authorPhotoUrl({ ...base, personaAvatarUrl: url, source: "scripted", viewer: "team" }), url);
  assert.equal(authorPhotoUrl({ ...base, personaAvatarUrl: null, source: "scripted", viewer: "student" }), null);
  assert.equal(authorPhotoUrl({ ...base, source: "scripted", viewer: "student" }), null);
  assert.equal(authorPhotoUrl({ ...base, personaAvatarUrl: url, source: "ai", viewer: "student" }), null, "o Assistente nunca");
  const aluno = { authorUserId: "11111111-1111-4111-8111-111111111111", displayName: "Ana M.", photo: { avatarUrl: "https://x/y.webp", consentCurrent: true }, webinarId: WEBINAR };
  assert.equal(authorPhotoUrl({ ...aluno, personaAvatarUrl: url, source: "audience", viewer: "student" }), "https://x/y.webp", "o aluno real segue a regra dele");
});

test("vocabulario (adendo): nenhuma frase da tela diz 'personagem'; os campos do Novo comentário", () => {
  const textos = [];
  const coletar = (valor, vistos = new Set()) => {
    if (typeof valor === "string") {
      textos.push(valor);
    } else if (typeof valor === "function") {
      for (const args of [["Bia C.", 2], [12, 30], [1]]) {
        try {
          coletar(valor(...args), vistos);
        } catch {
          // outra assinatura
        }
      }
    } else if (valor && typeof valor === "object" && !vistos.has(valor)) {
      vistos.add(valor);
      Object.values(valor).forEach((item) => coletar(item, vistos));
    }
  };
  coletar(WEBINAR_COPY);
  coletar(WEBINAR_ADMIN_COPY);
  assert.ok(textos.length > 500);
  assert.deepEqual(textos.filter((texto) => /personage/i.test(texto)), []);
  assert.deepEqual([COPY.quemComenta, COPY.nome, COPY.foto, COPY.apareceComo, COPY.papeis.student, COPY.papeis.team, COPY.comentario], ["Quem comenta", "Nome", "Foto (opcional)", "Aparece como", "Aluno", "Equipe", "Comentário"]);
  // A caixa "Usar esta foto em todos os comentários de {nome}" saiu em 11/11/2026 (D75), com o aviso dela.
  assert.equal("usarEmTodos" in COPY, false);
  assert.equal("fotoEmTodos" in COPY.avisos, false);
  assert.equal(COPY.fotoConsentimento, "Use imagem gerada ou com autorização. Nunca a foto de uma pessoa real sem o consentimento dela.");
});

/* ------------------------------------------------------------------------------------------------
 * O tick da live
 * ---------------------------------------------------------------------------------------------- */

test("R8 tick: solta os itens vencidos da live no ar como mensagens scripted da sessao (nunca da linha mestre), com a foto copiada, uma vez", async () => {
  const db = usar();
  const antes = Date.now();
  const resultado = await tick.runLiveScriptTick({ db, now: new Date() });
  assert.deepEqual(resultado, { failed: 0, pendingMigration: false, released: 2, sessions: 1, skipped: 0 });
  const novas = soltas(db).filter((row) => row.script_item_id !== ITENS.jaEntrou);
  assert.deepEqual(
    novas.map((row) => [row.script_item_id, row.display_name, row.role, row.master, row.approved, row.persona_avatar_path ?? null, row.author_user_id]),
    [
      [ITENS.aos5, "Bia C.", "student", false, true, FOTO, null],
      [ITENS.aos9, "Caio D.", "team", false, true, null, null]
    ]
  );
  assert.ok(!("persona_avatar_path" in novas[1]), "sem foto, a chave fica de fora");
  for (const row of novas) {
    assert.ok(Math.abs(row.offset_ms - 10 * MIN) < 5_000, "o offset do relogio do chat da live (sem ancora, desde o inicio)");
    assert.ok(Date.parse(row.created_at) >= antes - 1000 && Date.parse(row.created_at) <= Date.now() + 1000, "nasce agora: chega pela consulta de 5 s");
  }
  const [consulta] = db.calls.reads.filter((read) => read.table === "webinar_sessions");
  assert.deepEqual(
    consulta.filters.filter(([op]) => op === "eq"),
    [
      ["eq", "kind", "live"],
      ["eq", "status", "live"]
    ]
  );

  const segunda = await tick.runLiveScriptTick({ db, now: new Date() });
  assert.equal(segunda.released, 0, "o tick seguinte nao repete");
  assert.equal(soltas(db).length, 3);
});

test("R8 tick: a espera (sem started_at), a gravada e o Replay ficam de fora; o tick sem tempo nao faz nada; banco sem as tabelas, zeros", async () => {
  const espera = usar(cenario({ sessao: { started_at: null, status: "waiting" } }));
  assert.equal((await tick.runLiveScriptTick({ db: espera, now: new Date() })).released, 0, "nunca antes do Começar para todos");
  assert.equal(soltas(espera).length, 1);

  const gravada = cenario({ sessao: { kind: "simulated" } });
  const banco = usar(gravada);
  assert.deepEqual(await tick.runLiveScriptTick({ db: banco, now: new Date() }), { failed: 0, pendingMigration: false, released: 0, sessions: 0, skipped: 0 });

  const abortado = new AbortController();
  abortado.abort();
  const parado = usar();
  assert.equal((await tick.runLiveScriptTick({ db: parado, now: new Date(), signal: abortado.signal })).released, 0);
  assert.equal(parado.calls.reads.length, 0);

  const semTabela = usar();
  semTabela.from = () => ({
    eq() {
      return this;
    },
    gte() {
      return this;
    },
    not() {
      return this;
    },
    order() {
      return this;
    },
    select() {
      return this;
    },
    then: (resolve) => resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_sessions' in the schema cache" } })
  });
  const [pendente, avisos] = await silenciando(() => tick.runLiveScriptTick({ db: semTabela, now: new Date() }));
  assert.deepEqual(pendente, { failed: 0, pendingMigration: true, released: 0, sessions: 0, skipped: 0 });
  // O log aponta a mais nova dos webinarios (WEBINARS_MIGRATION; desde 11/11/2026 a 202611110002).
  assert.ok(avisos.some((linha) => linha.includes("migracao 202611110002 pendente")));
});

test("R8 tick: a corrida com o Soltar agora (a chave unica) nao repete; o banco sem a coluna da foto solta sem a foto", async () => {
  const db = usar();
  const from = db.from.bind(db);
  db.from = (name) => {
    const chain = from(name);
    if (name !== "webinar_chat_messages") {
      return chain;
    }
    const insert = chain.insert;
    chain.insert = (payload) => {
      insert(payload);
      if (payload.script_item_id === ITENS.aos9) {
        chain.then = (resolve, reject) => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }).then(resolve, reject);
      }
      return chain;
    };
    return chain;
  };
  const resultado = await tick.runLiveScriptTick({ db, now: new Date() });
  assert.deepEqual([resultado.released, resultado.skipped], [1, 1]);

  const semColuna = semAColunaDaFoto(usar());
  const sem = await tick.runLiveScriptTick({ db: semColuna, now: new Date() });
  assert.equal(sem.released, 2, "sem a 202611100002, o roteiro entra sem a foto");
  assert.ok(soltas(semColuna).every((row) => !row.persona_avatar_path));
});

/* ------------------------------------------------------------------------------------------------
 * As Server Actions
 * ---------------------------------------------------------------------------------------------- */

test("R8 Enviar agora: a mensagem do roteiro sem item, com o nome, o papel e a foto da pessoa; a pessoa nova entra na lista (11/11/2026, D76), os itens do roteiro nao mudam; a auditoria sem o texto", async () => {
  const db = usar();
  const enviado = ok(await scriptActions.sendScriptedComment({ applyToName: true, body: "  Que aula!  ", personaAvatarPath: OUTRA_FOTO, personaName: " bia   c. ", personaRole: "team", sessionId: SESSION }));
  const linha = db.tables.webinar_chat_messages.find((row) => row.id === enviado.message.id);
  assert.deepEqual(
    [linha.source, linha.script_item_id, linha.display_name, linha.role, linha.body, linha.persona_avatar_path, linha.master, linha.approved, linha.session_id],
    ["scripted", null, "bia c.", "team", "Que aula!", OUTRA_FOTO, false, true, SESSION]
  );
  assert.ok(Math.abs(linha.offset_ms - 10 * MIN) < 5_000);
  // A pessoa nova entrou na lista (o nome sem espacos sobrando), e o "Usar esta foto em todos" saiu: os itens ficam.
  assert.equal(enviado.created, true);
  assert.deepEqual(
    db.tables.webinar_personas.map((row) => [row.name, row.role, row.avatar_path, row.webinar_id, row.created_by]),
    [["bia c.", "team", OUTRA_FOTO, WEBINAR, EQUIPE]]
  );
  assert.equal(enviado.persona.id, db.tables.webinar_personas[0].id);
  assert.equal(enviado.question, null, "Tipo Comentário: nada na aba Perguntas");
  assert.equal(db.tables.webinar_chat_script_items.find((row) => row.id === ITENS.aos5).persona_avatar_path, FOTO, "os itens do roteiro nao mudam");
  const [auditoria] = audits(db, "webinar.script_comment_sent");
  assert.deepEqual(Object.keys(auditoria.metadata).sort(), ["kind", "message_id", "offset_ms", "persona_created", "persona_id", "question_id", "role", "session_id", "with_photo"]);
  assert.doesNotMatch(JSON.stringify(auditoria), /Que aula|bia c\./);

  // Repetir (D78): a pessoa da lista pelo id; o nome digitado junto nao vale, vale a copia da pessoa.
  const deNovo = ok(await scriptActions.sendScriptedComment({ body: "De novo", personaId: enviado.persona.id, personaName: "Outro nome", sessionId: SESSION }));
  const segunda = db.tables.webinar_chat_messages.find((row) => row.id === deNovo.message.id);
  assert.deepEqual([segunda.display_name, segunda.role, segunda.persona_avatar_path, deNovo.created], ["bia c.", "team", OUTRA_FOTO, false]);
  assert.equal(db.tables.webinar_personas.length, 1, "nenhuma pessoa a mais");

  // O mesmo nome como pessoa nova (sem caixa nem espacos): o erro no campo Nome, nada gravado.
  const quantas = db.tables.webinar_chat_messages.length;
  const repetido = await scriptActions.sendScriptedComment({ body: "Oi", personaName: "BIA C.", sessionId: SESSION });
  assert.deepEqual([repetido.status, repetido.fieldErrors?.personaName?.[0]], [400, WEBINAR_COPY.pessoas.erros.nomeRepetido]);
  assert.equal(db.tables.webinar_chat_messages.length, quantas);
  // A pessoa de outro webinario (ou que saiu da lista): o erro no campo da escolha.
  const sumiu = await scriptActions.sendScriptedComment({ body: "Oi", personaId: "99999999-0000-4000-8000-000000000001", personaName: "X", sessionId: SESSION });
  assert.deepEqual([sumiu.status, sumiu.fieldErrors?.personaId?.[0]], [400, WEBINAR_COPY.pessoas.erros.sumiu]);

  const semFoto = ok(await scriptActions.sendScriptedComment({ body: "Sem foto", personaName: "Duda E.", sessionId: SESSION }));
  assert.ok(!("persona_avatar_path" in db.tables.webinar_chat_messages.find((row) => row.id === semFoto.message.id)), "sem foto, a chave fica de fora");
  assert.equal(semFoto.message.role, "student", "Aparece como Aluno por padrao");
});

test("R8 Enviar agora recusa: o Replay e a sessao encerrada (409), o nome e o comentario vazios e a foto fora da pasta (400 no campo), sem permissao (403); nada gravado", async () => {
  const db = usar();
  const quantas = db.tables.webinar_chat_messages.length;
  const replay = await scriptActions.sendScriptedComment({ body: "Oi", personaName: "Bia C.", sessionId: REPLAY });
  assert.deepEqual([replay.status, replay.error], [409, COPY.erros.replay]);
  db.tables.webinar_sessions.find((row) => row.id === SESSION).status = "ended";
  const encerrada = await scriptActions.sendScriptedComment({ body: "Oi", personaName: "Bia C.", sessionId: SESSION });
  assert.deepEqual([encerrada.status, encerrada.error], [409, COPY.erros.sessaoFechada]);
  db.tables.webinar_sessions.find((row) => row.id === SESSION).status = "live";
  const semNome = await scriptActions.sendScriptedComment({ body: "Oi", personaName: "  ", sessionId: SESSION });
  assert.deepEqual([semNome.status, semNome.fieldErrors?.personaName?.[0]], [400, COPY.erros.nome]);
  const semTexto = await scriptActions.sendScriptedComment({ body: " ", personaName: "Bia C.", sessionId: SESSION });
  assert.deepEqual([semTexto.status, semTexto.fieldErrors?.body?.[0]], [400, COPY.erros.comentario]);
  for (const caminho of ["webinars/screen/0123456789abcdef01234567.webp", "https://golpe.com/foto.webp"]) {
    const fora = await scriptActions.sendScriptedComment({ body: "Oi", personaAvatarPath: caminho, personaName: "Bia C.", sessionId: SESSION });
    assert.deepEqual([fora.status, fora.fieldErrors?.personaAvatarPath?.[0]], [400, COPY.erros.fotoSumiu], caminho);
  }
  estado.negar = true;
  assert.equal((await scriptActions.sendScriptedComment({ body: "Oi", personaName: "Bia C.", sessionId: SESSION })).status, 403);
  assert.equal(db.tables.webinar_chat_messages.length, quantas, "nada gravado");
});

test("R8 Guardar na lista: um item 'Pelo botão da equipe' pronto no fim do roteiro, ligado a pessoa (a nova entra na lista, 11/11/2026) e com a copia dela; os outros itens nao mudam; o webinario arquivado, 409", async () => {
  const db = usar();
  const guardado = ok(await scriptActions.saveScriptComment({ body: "Pergunta boa", personaAvatarPath: OUTRA_FOTO, personaName: "Caio D.", personaRole: "team", sessionId: SESSION }));
  const novo = db.tables.webinar_chat_script_items.find((row) => row.id === guardado.item.id);
  const pessoa = db.tables.webinar_personas.find((row) => row.name === "Caio D.");
  assert.deepEqual(
    [novo.trigger_kind, novo.status, novo.offset_ms, novo.position, novo.persona_name, novo.persona_role, novo.persona_avatar_path, novo.persona_id, novo.kind, novo.created_by, novo.webinar_id],
    ["manual", "ready", null, 7, "Caio D.", "team", OUTRA_FOTO, pessoa.id, "message", EQUIPE, WEBINAR]
  );
  assert.equal(guardado.item.triggerKind, "manual");
  assert.equal(guardado.item.personaAvatarPath, OUTRA_FOTO);
  assert.equal(guardado.item.personaId, pessoa.id);
  assert.equal(guardado.created, true);
  assert.equal(db.tables.webinar_chat_script_items.find((row) => row.id === ITENS.aos9).persona_avatar_path, null, "o 'Caio D.' de antes fica como estava");
  assert.equal(soltas(db).length, 1, "guardar nao solta nada");
  assert.equal(audits(db, "webinar.script_item_added").length, 1);

  db.tables.webinars.find((row) => row.id === WEBINAR).status = "archived";
  const arquivado = await scriptActions.saveScriptComment({ body: "Oi", personaName: "Bia C.", sessionId: SESSION });
  assert.equal(arquivado.status, 409);
});

test("R8 Soltar agora na live: o item entra na sessao com a foto de quem comenta copiada (o que a turma viu nao muda depois)", async () => {
  const db = usar();
  const solta = ok(await scriptActions.fireScriptItem({ itemId: ITENS.botao, sessionId: SESSION }));
  assert.equal(solta.message.source, "scripted");
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.id === solta.message.id).persona_avatar_path, undefined, "o item sem foto");
  const aos5 = ok(await scriptActions.fireScriptItem({ itemId: ITENS.aos5, sessionId: SESSION }));
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.id === aos5.message.id).persona_avatar_path, FOTO);
  db.tables.webinar_chat_script_items.find((row) => row.id === ITENS.aos5).persona_avatar_path = OUTRA_FOTO;
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.id === aos5.message.id).persona_avatar_path, FOTO, "a copia da mensagem fica");
});

test("R8 e R9 salvar o roteiro da live: a foto de cada item (ausente fica a de antes, nula tira); o banco sem a coluna salva sem foto e recusa gravar uma foto (409)", async () => {
  const db = usar();
  const base = { body: "Mensagem", kind: "message", personaRole: "student", phrase: null, phraseDelayMs: 0, status: "draft" };
  const salvo = ok(
    await scriptActions.saveScriptItems({
      items: [
        { ...base, id: ITENS.aos5, offsetMs: 5 * MIN, personaName: "Bia C.", triggerKind: "at_offset" },
        { ...base, id: ITENS.aos9, offsetMs: 9 * MIN, personaAvatarPath: OUTRA_FOTO, personaName: "Caio D.", triggerKind: "at_offset" },
        { ...base, id: ITENS.aos11, offsetMs: 11 * MIN, personaAvatarPath: null, personaName: "Bia C.", triggerKind: "at_offset" },
        { ...base, offsetMs: null, personaAvatarPath: FOTO, personaName: "Nova", triggerKind: "manual" }
      ],
      // O editor carregou os 7: os que nao vieram saem.
      loadedIds: db.tables.webinar_chat_script_items.map((row) => row.id),
      webinarId: WEBINAR
    })
  );
  assert.deepEqual(
    salvo.items.map((entry) => [entry.personaName, entry.personaAvatarPath]),
    [
      ["Bia C.", FOTO],
      ["Caio D.", OUTRA_FOTO],
      ["Bia C.", null],
      ["Nova", FOTO]
    ],
    "a foto de antes fica quando o rascunho nao a traz; nula tira"
  );

  // Sem a 202611100002, a Live gravada segue: o roteiro salva sem foto e so gravar uma foto pede a migracao.
  const semColuna = semAColunaDaFoto(usar());
  semColuna.tables.webinars.find((row) => row.id === WEBINAR).kind = "simulated";
  const semFoto = ok(await scriptActions.saveScriptItems({ items: [{ ...base, offsetMs: MIN, personaName: "Bia C.", triggerKind: "at_offset" }], loadedIds: semColuna.tables.webinar_chat_script_items.map((row) => row.id), webinarId: WEBINAR }));
  assert.equal(semFoto.items.length, 1);
  assert.equal(semFoto.items[0].personaAvatarPath, null);
  const comFoto = await scriptActions.saveScriptItems({ items: [{ ...base, offsetMs: MIN, personaAvatarPath: FOTO, personaName: "Bia C.", triggerKind: "at_offset" }], webinarId: WEBINAR });
  assert.deepEqual([comFoto.status, comFoto.error], [409, COPY.erros.migracao("202611100002")]);
  const enviar = await scriptActions.sendScriptedComment({ body: "Oi", personaAvatarPath: FOTO, personaName: "Bia C.", sessionId: SESSION });
  assert.deepEqual([enviar.status, enviar.error], [409, COPY.erros.migracao("202611100002")], "so gravar uma foto pede a migracao");
  ok(await scriptActions.sendScriptedComment({ body: "Oi", personaName: "Bia C.", sessionId: SESSION }));
  assert.ok(semColuna.tables.webinar_chat_messages.some((row) => row.body === "Oi"), "sem foto, o Enviar agora segue");
});

test("S1 e achado 2 (revisao de 11/11/2026): sem a 202611100002, nenhuma escrita do roteiro da Live ao vivo passa (409 da migracao, antes de gravar); a gravada segue como antes", async () => {
  // A webinar_open_session de antes da 202611100002 solta TODO o roteiro com minuto no "Começar para todos" (sem o
  // filtro da live): sem a migracao, o roteiro da live nao pode ganhar itens.
  const db = semAColunaDaFoto(usar());
  const antes = JSON.stringify(db.tables.webinar_chat_script_items);
  const escritasAntes = db.calls.writes.filter((write) => write.table === "webinar_chat_script_items").length;
  const migracao = COPY.erros.migracaoLive("202611100002");
  assert.equal(migracao, "O roteiro da live ao vivo precisa da atualização do banco (migração 202611100002).");
  const base = { body: "Mensagem", kind: "message", personaName: "Bia C.", personaRole: "student", phrase: null, phraseDelayMs: 0, status: "draft" };

  const salvar = await scriptActions.saveScriptItems({ items: [{ ...base, offsetMs: MIN, triggerKind: "at_offset" }], loadedIds: [], webinarId: WEBINAR });
  assert.deepEqual([salvar.ok, salvar.status, salvar.error], [false, 409, migracao], "salvar, mesmo sem foto");
  const importar = await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n12;Duda;Aluno;oi", webinarId: WEBINAR });
  assert.deepEqual([importar.ok, importar.status, importar.error], [false, 409, migracao], "importar");
  const substituir = await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n12;Duda;Aluno;oi", replace: true, webinarId: WEBINAR });
  assert.deepEqual([substituir.status, substituir.error], [409, migracao], "substituir");
  const guardar = await scriptActions.saveScriptComment({ body: "Pergunta boa", personaName: "Caio D.", sessionId: SESSION });
  assert.deepEqual([guardar.ok, guardar.status, guardar.error], [false, 409, migracao], "o Guardar na lista do console");
  assert.equal(JSON.stringify(db.tables.webinar_chat_script_items), antes, "nada gravado no roteiro");
  assert.equal(db.calls.writes.filter((write) => write.table === "webinar_chat_script_items").length, escritasAntes, "nenhuma escrita na tabela do roteiro");
  // O Enviar agora nao cria item do roteiro: sem foto, segue (a mensagem scripted sem item ja existia antes).
  ok(await scriptActions.sendScriptedComment({ body: "Oi", personaName: "Bia C.", sessionId: SESSION }));

  // A gravada, no mesmo banco sem a migracao: salva, importa e guarda como antes.
  db.tables.webinars.find((row) => row.id === WEBINAR).kind = "simulated";
  ok(await scriptActions.saveScriptItems({ items: [{ ...base, offsetMs: MIN, triggerKind: "at_offset" }], loadedIds: [], webinarId: WEBINAR }));
  ok(await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n0:12;Duda;Aluno;oi", webinarId: WEBINAR }));
  ok(await scriptActions.saveScriptComment({ body: "Pergunta boa", personaName: "Caio D.", sessionId: SESSION }));
});

test("achado 3 (revisao de 11/11/2026): o Salvar do editor com a pagina velha so apaga os ids que carregou; o comentario que o console guardou depois fica, ligado a pessoa e com a foto dela", async () => {
  const db = usar();
  // O editor abriu e carregou os 7 itens (Caio D. sem foto).
  const carregados = db.tables.webinar_chat_script_items.map((row) => row.id);
  // Depois, no console: "Guardar na lista" com a pessoa nova (com foto), que entra na lista. O "Usar esta foto em todos"
  // saiu em 11/11/2026 (a chave da pagina antiga e ignorada): o "Caio D." de antes, fora da lista, fica sem foto.
  const guardado = ok(await scriptActions.saveScriptComment({ applyToName: true, body: "Pergunta boa", personaAvatarPath: OUTRA_FOTO, personaName: "Caio D.", personaRole: "team", sessionId: SESSION }));
  assert.equal(db.tables.webinar_chat_script_items.find((row) => row.id === ITENS.aos9).persona_avatar_path, null);
  assert.equal(db.tables.webinar_chat_script_items.find((row) => row.id === guardado.item.id).persona_id, guardado.persona.id);

  // O editor (a pagina velha) tira o item desligado e salva o resto como carregou: a foto que nao mudou vai ausente.
  const base = { kind: "message", phrase: null, phraseDelayMs: 0, status: "draft" };
  const ficam = db.tables.webinar_chat_script_items.filter((row) => carregados.includes(row.id) && row.id !== ITENS.desligado);
  const salvo = ok(
    await scriptActions.saveScriptItems({
      items: ficam.map((row) => ({ ...base, body: row.body, id: row.id, offsetMs: row.offset_ms, personaName: row.persona_name, personaRole: row.persona_role, triggerKind: row.trigger_kind })),
      loadedIds: carregados,
      webinarId: WEBINAR
    })
  );
  const ids = salvo.items.map((item) => item.id);
  assert.ok(ids.includes(guardado.item.id), "o comentario guardado pelo console depois fica");
  assert.ok(!ids.includes(ITENS.desligado), "o que o editor carregou e tirou sai");
  assert.equal(ids.length, 7);
  assert.equal(db.tables.webinar_chat_script_items.find((row) => row.id === guardado.item.id).persona_id, guardado.persona.id, "a pagina velha (sem personaId) nao solta o item da pessoa");
  assert.equal(salvo.items.find((item) => item.id === guardado.item.id).personaAvatarPath, OUTRA_FOTO);

  // Sem os ids carregados (o pedido de antes), nada sai.
  const semIds = ok(await scriptActions.saveScriptItems({ items: [], webinarId: WEBINAR }));
  assert.equal(semIds.items.length, 7, "sem loadedIds, o Salvar nao apaga nada");
});

test("achado 1 (revisao de 11/11/2026): o CSV do roteiro da live le e escreve o Tempo em minutos da live; a gravada segue em segundos", async () => {
  const db = usar();
  const importado = ok(await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n12;Duda;Aluno;Cheguei\n12:30;Lia;Equipe;Bem-vindos", webinarId: WEBINAR }));
  assert.equal(importado.imported, 2);
  assert.deepEqual(importado.items.slice(-2).map((item) => [item.personaName, item.offsetMs]), [["Duda", 12 * MIN], ["Lia", 12 * MIN + 30_000]], "12 = 12 minutos da live");
  const exportado = ok(await scriptActions.exportScriptCsv({ webinarId: WEBINAR }));
  assert.match(exportado.csv, /\r?\n12:00;Duda;Aluno;Cheguei/);
  assert.match(exportado.csv, /\r?\n12:30;Lia;Equipe;Bem-vindos/);
  assert.match(exportado.csv, /\r?\n5:30;Bia C\.;Aluno;/, "o item aos 5:30 da live");
  // A volta: o arquivo exportado importado de novo da os mesmos minutos.
  const deNovo = ok(await scriptActions.importScriptCsv({ csv: exportado.csv, replace: true, webinarId: WEBINAR }));
  assert.deepEqual(deNovo.items.map((item) => item.offsetMs).sort((a, b) => a - b), importado.items.filter((item) => item.offsetMs != null && item.status !== "disabled").map((item) => item.offsetMs).sort((a, b) => a - b));

  db.tables.webinars.find((row) => row.id === WEBINAR).kind = "simulated";
  const gravada = ok(await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n12;Duda;Aluno;oi", webinarId: WEBINAR }));
  assert.equal(gravada.items.at(-1).offsetMs, 12_000, "na gravada, 12 = 12 segundos do video");
});

test("S4 e achado 7 (revisao de 11/11/2026; desde 11/11/2026 pela pessoa da lista): editar a pessoa troca a copia de todos os itens dela, alem dos 1.000 primeiros (uma escrita so, sem o teto do PostgREST)", async () => {
  const personas = await import("../src/server/webinars/persona-actions.ts");
  const tables = cenario();
  const PESSOA = "eeeeeeee-0000-4000-8000-0000000000aa";
  tables.webinar_personas = [{ avatar_path: null, created_at: iso(Date.now() - MIN), id: PESSOA, name: "Bia C.", role: "student", updated_at: iso(Date.now() - MIN), webinar_id: WEBINAR }];
  tables.webinar_chat_script_items = Array.from({ length: 1005 }, (_, index) =>
    item(`dddddddd-0000-4000-8000-${String(100000 + index).padStart(12, "0")}`, { offset_ms: null, persona_id: PESSOA, persona_name: "Bia C.", position: index, trigger_kind: "manual" })
  );
  const db = usar(tables);
  const salvo = ok(await personas.savePersona({ avatarPath: FOTO, id: PESSOA, name: "Bia Costa", role: "team", webinarId: WEBINAR }));
  assert.deepEqual([salvo.created, salvo.items], [false, 1005]);
  assert.ok(
    db.tables.webinar_chat_script_items.every((row) => row.persona_avatar_path === FOTO && row.persona_name === "Bia Costa" && row.persona_role === "team"),
    "todos, nenhum fica com a copia velha"
  );
});

test("achado 12 (revisao de 11/11/2026): na Live ao vivo, o Enviar agora e o Soltar agora valem na espera e no ar; so os itens 'Num minuto da live' esperam o Começar para todos", async () => {
  const db = usar(cenario({ sessao: { started_at: null, status: "waiting" } }));
  assert.equal((await tick.runLiveScriptTick({ db, now: new Date() })).released, 0, "na espera, o tick nao solta nada");
  const enviado = ok(await scriptActions.sendScriptedComment({ body: "Boa noite, já vamos começar", personaName: "Caio D.", personaRole: "team", sessionId: SESSION }));
  assert.equal(enviado.message.source, "scripted");
  const solto = ok(await scriptActions.fireScriptItem({ itemId: ITENS.botao, sessionId: SESSION }));
  assert.equal(solto.message.scriptItemId, ITENS.botao);
  const minuto = ok(await scriptActions.fireScriptItem({ itemId: ITENS.aos11, sessionId: SESSION }));
  assert.equal(minuto.message.scriptItemId, ITENS.aos11, "o Soltar agora e manual: vale tambem para um item com minuto");
  assert.equal(soltas(db).length, 4);
  assert.equal((await tick.runLiveScriptTick({ db, now: new Date() })).released, 0, "e o tick continua sem soltar nada antes do started_at");
});

/** Cabecalho WebP VP8X (32 bytes, ou `total`) com o canvas e as flags; `anim`: o chunk ANIM. */
function webpBytes(width, height, { anim = false, flags = 0, total = 32 } = {}) {
  const bytes = new Uint8Array(Math.max(total, anim ? 44 : 32));
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  bytes[20] = flags;
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  if (anim) {
    bytes.set([0x41, 0x4e, 0x49, 0x4d, 0x06, 0x00, 0x00, 0x00], 30);
  }
  return bytes;
}

const dataUrlDe = (bytes) => `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;

test("R9 Enviar foto: grava em content-assets/webinars/personas/<24 hex>.webp e devolve so o caminho; recusa o que nao e WebP, mais de 100 KB, lado fora de 16 a 512 px e o animado", async () => {
  const db = usar();
  const envios = [];
  db.storage = {
    from(bucket) {
      return {
        getPublicUrl: (path) => ({ data: { publicUrl: `${ORIGEM}/storage/v1/object/public/${bucket}/${path}` } }),
        upload: async (path, _bytes, options) => {
          envios.push({ bucket, contentType: options.contentType, path });
          return { error: null };
        }
      };
    }
  };
  const enviada = ok(await scriptActions.uploadPersonaPhoto({ image: dataUrlDe(webpBytes(512, 512)) }));
  assert.match(enviada.path, /^webinars\/personas\/[a-f0-9]{24}\.webp$/);
  assert.deepEqual(Object.keys(enviada).sort(), ["height", "path", "width"], "nunca um endereco");
  assert.deepEqual(envios, [{ bucket: "content-assets", contentType: "image/webp", path: enviada.path }]);
  assert.deepEqual(audits(db, "webinar.persona_photo_uploaded")[0].metadata, { height: 512, path: enviada.path, size_bytes: 32, width: 512 });

  for (const [image, frase] of [
    [`data:image/png;base64,${Buffer.from("png").toString("base64")}`, COPY.erros.fotoFormato],
    [dataUrlDe(webpBytes(400, 400, { total: 100_001 })), COPY.erros.fotoPesada],
    [dataUrlDe(webpBytes(513, 400)), COPY.erros.fotoLado],
    [dataUrlDe(webpBytes(400, 15)), COPY.erros.fotoLado],
    [dataUrlDe(webpBytes(400, 400, { flags: 0x02 })), COPY.erros.fotoAnimada],
    [dataUrlDe(webpBytes(400, 400, { anim: true })), COPY.erros.fotoAnimada]
  ]) {
    const recusada = await scriptActions.uploadPersonaPhoto({ image });
    assert.deepEqual([recusada.ok, recusada.status, recusada.fieldErrors?.image?.[0]], [false, 400, frase], frase);
  }
  assert.equal(envios.length, 1, "nada mais enviado");
});

/* ------------------------------------------------------------------------------------------------
 * A leitura: a sala e o console
 * ---------------------------------------------------------------------------------------------- */

test("R9 na sala: a foto de quem comenta no avatar das mensagens do roteiro, pela origem do nosso Supabase, lida uma vez por mensagem; o banco sem a coluna, as iniciais", async () => {
  const db = usar();
  await tick.runLiveScriptTick({ db, now: new Date() });
  const mensagens = soltas(db).map((row) => ({ id: row.id, source: row.source, scriptItemId: row.script_item_id }));
  const urls = await roomQueries.scriptedAvatarUrls(db, mensagens, Date.now());
  const comFoto = soltas(db).find((row) => row.script_item_id === ITENS.aos5);
  assert.deepEqual([...urls.entries()], [[comFoto.id, `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`]]);
  const leituras = db.calls.reads.filter((read) => read.table === "webinar_chat_messages").length;
  await roomQueries.scriptedAvatarUrls(db, mensagens, Date.now());
  assert.equal(db.calls.reads.filter((read) => read.table === "webinar_chat_messages").length, leituras, "a memoria do processo: a foto de uma mensagem nunca muda");
  assert.equal((await roomQueries.scriptedAvatarUrls(db, [{ id: "x", source: "audience" }], Date.now())).size, 0, "sem mensagem do roteiro, nenhuma consulta");

  // A mensagem do aluno na sala: o avatar e a foto de quem comenta.
  const { chatMessageFromRow } = await import("../src/server/webinars/chat-rows.ts");
  const aluno = roomQueries.studentMessageWithPhoto(chatMessageFromRow({ ...comFoto, approved_at: null, approved_by: null, deleted_by: null, deleted_reason: null }), "11111111-1111-4111-8111-111111111111", "live", new Map(), urls);
  assert.equal(aluno.avatarUrl, `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`);

  clearScriptedAvatarCache();
  const semColuna = semAColunaDaFoto(usar());
  semColuna.tables.webinar_chat_messages.push({ ...comFoto });
  assert.equal((await roomQueries.scriptedAvatarUrls(semColuna, [{ id: comFoto.id, source: "scripted" }], Date.now())).size, 0, "sem a 202611100002, as iniciais e nada quebra");
});

test("R8 e R9 no console da live: o roteiro da sessao ao vivo com a foto de cada item e o que ja entrou; a mensagem do roteiro com a foto no avatar", async () => {
  const db = usar();
  await tick.runLiveScriptTick({ db, now: new Date() });
  const retrato = await consoleQueries.getConsoleSnapshot(WEBINAR, SESSION, new Date());
  assert.equal(retrato.scriptItems.length, 7, "o roteiro tambem na sessao da live");
  assert.equal(retrato.scriptItems.find((entry) => entry.id === ITENS.aos5).personaAvatarPath, FOTO);
  assert.deepEqual(Object.keys(retrato.scriptFired).sort(), [ITENS.aos5, ITENS.aos9, ITENS.jaEntrou].sort());
  const mensagem = retrato.messages.find((entry) => entry.scriptItemId === ITENS.aos5);
  assert.equal(mensagem.avatarUrl, `${ORIGEM}/storage/v1/object/public/content-assets/${FOTO}`);
  assert.equal(retrato.messages.find((entry) => entry.scriptItemId === ITENS.aos9).avatarUrl, null);
});
