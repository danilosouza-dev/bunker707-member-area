import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { bancoEmMemoria } from "./support/webinarios-banco-em-memoria.mjs";

// Publicar replay como aula (docs/30 §2.2, §2.3 e §6.8; D108 a D113), sem banco de verdade: o banco em memoria dos
// webinarios, a permissao por um duble (as acoes da pessoa em role.access; o escopo por produto em `foraDoEscopo`) e
// "next/cache" so anotando. Aqui:
// - o modelo: o id da aula sai do id do webinario, o titulo (o do card, senao o do webinario), o video da Bunny no
//   formato das outras aulas, a duracao e o modulo (o escolhido, senao o ultimo, senao criar);
// - publishReplayLesson: a aula nasce publicada no fim do modulo, com auditoria e o catalogo invalidado; uma aula por
//   webinario (de novo: nada muda, mesmo depois de a equipe editar); o produto sem modulo ganha o modulo Lives; cada
//   recusa com o motivo; a aula excluida so volta pelo botao; dois pedidos juntos criam uma aula so;
// - a Server Action Publicar replay: quem publica na Comunicacao e mexe no conteudo do produto; as recusas com a
//   frase e o status; o arquivado fica de leitura;
// - os modulos do produto para o card, e o destino recusado no Salvar para quem nao mexe no conteudo do produto.
// O replay que vira aula sozinho no tick e a retencao que poupa o video estao em tests/webinarios-gravacoes-job.test.mjs.

const estado = (globalThis.__replayAula ??= { foraDoEscopo: [], revalidados: [] });
const PRODUTORA = "00000000-0000-4000-8000-0000000000a1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stubs = {
      "@/server/auth/permissions": `
        export async function requireRole() { return globalThis.__adminActionStubs.role; }
        export async function requireScope(_access, _action, target) {
          if (target?.productIds?.some((id) => globalThis.__replayAula.foraDoEscopo.includes(id))) {
            const error = new Error("Fora dos seus cursos.");
            error.status = 403;
            throw error;
          }
        }`,
      "@/server/auth/session": `
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName() { return { fullName: "Produtora de Teste", name: "Produtora" }; }`,
      "next/cache": `
        export function revalidatePath(path) { globalThis.__replayAula.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__replayAula.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__replayAula.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`
    };
    const source = stubs[specifier] ?? (specifier.endsWith("/db/supabase/client") ? `export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; } export function hasSupabaseConfig() { return true; }` : null);

    return source === null ? nextResolve(specifier, context) : { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
  }
});

const acesso = (...actions) => ({ actions: new Set(actions), courseIds: [], functions: [], role: "owner", scopedActions: new Set() });
const pessoa = (...actions) => ({ access: acesso(...actions), role: "owner", user: { email: "produtora@bunker707.test", id: PRODUTORA } });
actionStubs.role = pessoa("messaging.write", "messaging.publish", "catalog.content");

const model = await import("../src/server/webinars/replay-lesson-model.ts");
const { publishReplayLesson, autoPublishReplayLesson } = await import("../src/server/webinars/replay-lesson.ts");
const actions = await import("../src/server/webinars/actions.ts");
const { emptyWebinarDraft } = await import("../src/server/webinars/model.ts");
const { PROIBIDAS_WEBINARIO } = await import("../src/lib/webinar-copy.ts");
const { describeForbidden } = await import("../src/server/auth/roles.ts");

const WEBINAR = "abababab-0000-4000-8000-000000000001";
const SESSAO = "abababab-0000-4000-8000-000000000011";
const REPLAY = "abababab-0000-4000-8000-000000000012";
const GRAVACAO = "abababab-0000-4000-8000-000000000031";
const VIDEO = "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab";
const PRODUTO = "course-lives-semanais-mf3k2";
const OUTUBRO = "module-outubro-mf3k3";
const NOVEMBRO = "module-novembro-mf3k4";
const AULA = `lesson-replay-${WEBINAR}`;
const PLAYER = `https://iframe.mediadelivery.net/embed/42/${VIDEO}`;
const AGORA = new Date("2026-11-13T15:00:00.000Z");
const DESTINO = { autoPublish: true, moduleId: null, productId: PRODUTO, title: null };

const UNIQUE = {
  lessons: (row) => row.id,
  webinar_sessions: (row) => (row.kind === "replay" ? row.webinar_id : null)
};

/** A live encerrada com o replay pronto, o produto Lives semanais com dois modulos e o destino do card no webinario. */
function escola({ gravacao = {}, lessons = [], modules, produto = {}, replay = true, target = DESTINO, webinar = {} } = {}) {
  const db = bancoEmMemoria(
    {
      admin_audit_log: [],
      content_items: produto === null ? [] : [{ id: PRODUTO, image: "/capas/lives.webp", kind: "Curso", publication_status: "published", title: "Lives semanais", ...produto }],
      course_modules: modules ?? [
        { id: OUTUBRO, meta: "0 aulas", owner_id: PRODUTO, sort_order: 0, status: "published", title: "Outubro" },
        { id: NOVEMBRO, meta: "0 aulas", owner_id: PRODUTO, sort_order: 1, status: "published", title: "Novembro" }
      ],
      lessons,
      webinar_recordings: [
        { bunny_library_id: "42", bunny_video_id: VIDEO, created_at: "2026-11-13T14:03:00.000Z", duration_seconds: 150, embed_url: PLAYER, id: GRAVACAO, provider: "bunny", session_id: SESSAO, source: "jibri", status: "ready", webinar_id: WEBINAR, ...gravacao }
      ],
      webinar_sessions: [
        { id: SESSAO, kind: "live", recording_id: GRAVACAO, scheduled_at: "2026-11-13T12:30:00.000Z", status: "ended", webinar_id: WEBINAR },
        ...(replay ? [{ id: REPLAY, kind: "replay", recording_id: GRAVACAO, scheduled_at: "2026-11-13T14:04:00.000Z", source_session_id: SESSAO, status: "live", webinar_id: WEBINAR }] : [])
      ],
      webinars: [
        { deleted_at: null, description: "O que muda com agentes.", id: WEBINAR, kind: "live", replay_lesson_target: target, slug: "live-de-agentes", status: "published", title: "Live de agentes", updated_at: "2026-11-13T14:00:00.000Z", ...webinar }
      ]
    },
    { unique: UNIQUE }
  );
  actionStubs.db = db;
  actionStubs.invalidations.length = 0;
  estado.foraDoEscopo.length = 0;
  estado.revalidados.length = 0;
  return db;
}

const aulaDe = (db) => db.tables.lessons.find((row) => row.id === AULA) ?? null;
const publicar = (db, mode = "manual", actorId = PRODUTORA) => publishReplayLesson(db, { actorId, mode, now: AGORA, webinarId: WEBINAR });

async function quieto(fn) {
  const linhas = [];
  const original = { error: console.error, info: console.info, warn: console.warn };
  for (const metodo of ["error", "info", "warn"]) {
    console[metodo] = (...args) => linhas.push(`${metodo}: ${args.join(" ")}`);
  }
  try {
    return [await fn(), linhas];
  } finally {
    Object.assign(console, original);
  }
}

/* ------------------------------------------------------------------------------------------------
 * O modelo
 * ---------------------------------------------------------------------------------------------- */

test("modelo: o id da aula sai do id do webinario; o titulo e o do card, senao o do webinario, em uma linha e ate 120 caracteres", () => {
  assert.equal(model.replayLessonIdFor(WEBINAR), AULA);
  assert.match(model.replayLessonIdFor(WEBINAR), /^[A-Za-z0-9_-]{1,240}$/, "cabe na regra dos ids do catalogo");
  assert.equal(model.replayLessonTitle({ title: "  Aula  12:\nagentes " }, "Live de agentes"), "Aula 12: agentes");
  assert.equal(model.replayLessonTitle({ title: null }, "Live de agentes"), "Live de agentes");
  assert.equal(model.replayLessonTitle({ title: "   " }, "Live de agentes"), "Live de agentes");
  assert.equal(model.replayLessonTitle({ title: null }, ""), "Replay da live");
  const longo = model.replayLessonTitle({ title: "a".repeat(200) }, "x");
  assert.equal(longo.length, 120);
  assert.ok(longo.endsWith("…"));
  assert.equal(model.replayLessonDescription(null), "");
  assert.equal(model.replayLessonDescription("  Resumo da live.  "), "Resumo da live.");
  assert.equal(model.replayLessonDescription("b".repeat(3000)).length, 2000);
});

test("modelo: o video e o da Bunny no formato das outras aulas (pelo player, senao pela biblioteca e o video); outro endereco nao vira aula; a duracao no relogio", () => {
  const video = { assetId: VIDEO, provider: "bunny", url: PLAYER };
  assert.deepEqual(model.replayLessonVideo({ bunny_library_id: "42", bunny_video_id: VIDEO, embed_url: PLAYER }), video);
  assert.deepEqual(model.replayLessonVideo({ bunny_library_id: null, bunny_video_id: null, embed_url: `https://player.mediadelivery.net/play/42/${VIDEO}` }), video, "o endereco do player vira o do embed");
  assert.deepEqual(model.replayLessonVideo({ bunny_library_id: "42", bunny_video_id: VIDEO, embed_url: null }), video);
  assert.equal(model.replayLessonVideo({ bunny_library_id: null, bunny_video_id: null, embed_url: null }), null);
  assert.equal(model.replayLessonVideo({ bunny_library_id: null, bunny_video_id: null, embed_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), null, "so a Bunny");
  assert.equal(model.replayLessonVideo({ bunny_library_id: null, bunny_video_id: VIDEO, embed_url: "javascript:alert(1)" }), null);
  assert.equal(model.replayLessonDuration(150), "2:30");
  assert.equal(model.replayLessonDuration(3700), "1:01:40");
  assert.equal(model.replayLessonDuration(null), "");
  assert.equal(model.replayLessonDuration(0), "");
});

test("modelo: o modulo e o escolhido se ainda e do produto; sem escolha, o ultimo; sem modulo nenhum, criar", () => {
  const modulos = [
    { id: NOVEMBRO, sort_order: 1 },
    { id: OUTUBRO, sort_order: 0 }
  ];
  assert.deepEqual(model.pickReplayLessonModule(modulos, OUTUBRO), { id: OUTUBRO, kind: "module" });
  assert.deepEqual(model.pickReplayLessonModule(modulos, "module-que-sumiu"), { kind: "missing" });
  assert.deepEqual(model.pickReplayLessonModule(modulos, null), { id: NOVEMBRO, kind: "module" }, "as lives novas ficam no fim do curso");
  assert.deepEqual(model.pickReplayLessonModule([], null), { kind: "create" });
  assert.deepEqual(model.pickReplayLessonModule([], OUTUBRO), { kind: "missing" });
});

test("modelo: cada recusa tem a sua frase, que passa pela lista de palavras dos webinarios", () => {
  assert.deepEqual(Object.keys(model.REPLAY_LESSON_MESSAGES).sort(), [...model.REPLAY_LESSON_SKIPS].sort());
  for (const frase of Object.values(model.REPLAY_LESSON_MESSAGES)) {
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!frase.toLocaleLowerCase("pt-BR").includes(palavra), `"${frase}" usa "${palavra}"`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * publishReplayLesson
 * ---------------------------------------------------------------------------------------------- */

test("o replay vira uma aula publicada no fim do modulo escolhido, com o titulo do card, a auditoria de quem pediu e o catalogo invalidado", async () => {
  const db = escola({
    lessons: [
      { id: "lesson-antiga-1", module_id: OUTUBRO, sort_order: 0, status: "published", title: "Live 1" },
      { id: "lesson-antiga-2", module_id: OUTUBRO, sort_order: 4, status: "deleted", title: "Excluida" }
    ],
    target: { autoPublish: false, moduleId: OUTUBRO, productId: PRODUTO, title: "Live 2: agentes" }
  });

  const outcome = await publicar(db);

  assert.deepEqual(outcome, { lessonId: AULA, moduleCreated: false, moduleId: OUTUBRO, productId: PRODUTO, restored: false, status: "published", title: "Live 2: agentes" });
  const aula = aulaDe(db);
  assert.deepEqual(
    { completed: aula.completed, description: aula.description, duration: aula.duration, image: aula.image, module_id: aula.module_id, release_rule: aula.release_rule, sort_order: aula.sort_order, status: aula.status, title: aula.title, video_config: aula.video_config },
    {
      completed: false,
      description: "O que muda com agentes.",
      duration: "2:30",
      image: null,
      module_id: OUTUBRO,
      release_rule: null,
      sort_order: 5,
      status: "published",
      title: "Live 2: agentes",
      video_config: { assetId: VIDEO, provider: "bunny", url: PLAYER }
    },
    "depois de toda aula do modulo, contando a excluida (como o Criar aula do admin)"
  );
  assert.equal(db.tables.course_modules.find((row) => row.id === OUTUBRO).meta, "2 aulas", "a contagem ignora a excluida");
  assert.deepEqual(actionStubs.invalidations, [{ from: "action" }]);
  assert.deepEqual(db.tables.admin_audit_log.map((row) => ({ action: row.action, actor_id: row.actor_id, entity_id: row.entity_id, entity_type: row.entity_type, metadata: row.metadata })), [
    {
      action: "webinar.replay_lesson_published",
      actor_id: PRODUTORA,
      entity_id: WEBINAR,
      entity_type: "webinar",
      metadata: { lesson_id: AULA, mode: "manual", module_created: false, module_id: OUTUBRO, product_id: PRODUTO, recording_id: GRAVACAO, restored: false }
    }
  ]);
});

test("uma aula por webinario: publicar de novo nao muda nada, nem depois de a equipe editar o titulo, o modulo ou o video", async () => {
  const db = escola();
  assert.equal((await publicar(db)).status, "published");
  Object.assign(aulaDe(db), { module_id: OUTUBRO, title: "Editada pela equipe", video_config: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  actionStubs.invalidations.length = 0;

  for (const mode of ["manual", "auto"]) {
    assert.deepEqual(await publicar(db, mode), { lessonId: AULA, status: "exists", title: "Editada pela equipe" });
  }

  assert.equal(db.tables.lessons.length, 1);
  assert.equal(aulaDe(db).module_id, OUTUBRO);
  assert.equal(aulaDe(db).video_config.provider, "youtube");
  assert.equal(db.tables.admin_audit_log.length, 1, "so a primeira publicacao e auditada");
  assert.deepEqual(actionStubs.invalidations, []);
});

test("sem modulo escolhido a aula entra no ultimo modulo do produto; o produto sem modulo ganha o modulo Lives, com a capa e o tipo do produto", async () => {
  const comModulos = escola();
  assert.equal((await publicar(comModulos)).moduleId, NOVEMBRO);

  const vazio = escola({ modules: [] });
  const outcome = await publicar(vazio);
  assert.equal(outcome.status, "published");
  assert.equal(outcome.moduleCreated, true);
  assert.equal(vazio.tables.course_modules.length, 1);
  const lives = vazio.tables.course_modules[0];
  assert.deepEqual(
    { description: lives.description, eyebrow: lives.eyebrow, image: lives.image, meta: lives.meta, owner_id: lives.owner_id, owner_kind: lives.owner_kind, sort_order: lives.sort_order, status: lives.status, title: lives.title },
    { description: "", eyebrow: "Módulo 01", image: "/capas/lives.webp", meta: "1 aula", owner_id: PRODUTO, owner_kind: "Curso", sort_order: 0, status: "published", title: "Lives" }
  );
  assert.match(lives.id, /^module-lives-[a-z0-9]+$/);
  assert.equal(aulaDe(vazio).module_id, lives.id);
  assert.equal(vazio.tables.admin_audit_log[0].metadata.module_created, true);

  // O modulo excluido nao conta como modulo do produto.
  const soExcluido = escola({ modules: [{ id: OUTUBRO, meta: "0 aulas", owner_id: PRODUTO, sort_order: 0, status: "deleted", title: "Outubro" }] });
  assert.equal((await publicar(soExcluido)).moduleCreated, true);
});

test("cada recusa devolve o motivo e nada e gravado: sem destino, sem replay pronto, sem video da Bunny, produto que sumiu, formacao, modulo que sumiu e modulo cheio", async () => {
  const cheio = Array.from({ length: 100 }, (_, index) => ({ id: `lesson-cheia-${index}`, module_id: NOVEMBRO, sort_order: index, status: "published", title: `Aula ${index + 1}` }));
  const casos = [
    ["no_target", { target: null }],
    ["no_target", { target: { autoPublish: true, moduleId: null, productId: "", title: null } }],
    ["no_replay", { replay: false }],
    ["no_replay", { gravacao: { status: "processing" } }],
    ["no_video", { gravacao: { bunny_library_id: null, bunny_video_id: null, embed_url: null } }],
    ["product_missing", { produto: null }],
    ["product_missing", { produto: { kind: "Aula" } }],
    ["formation", { produto: { kind: "Formacao" } }],
    ["module_missing", { target: { ...DESTINO, moduleId: "module-que-sumiu" } }],
    ["module_full", { lessons: cheio }]
  ];

  for (const [reason, opcoes] of casos) {
    const db = escola(opcoes);
    assert.deepEqual(await publicar(db), { reason, status: "skipped" }, reason);
    assert.equal(aulaDe(db), null, `${reason}: nenhuma aula`);
    assert.equal(db.tables.admin_audit_log.length, 0, `${reason}: nada na auditoria`);
    assert.deepEqual(actionStubs.invalidations, [], `${reason}: o catalogo nao e invalidado`);
  }

  // 99 aulas de pe e uma excluida: ainda cabe uma.
  const quase = escola({ lessons: [...cheio.slice(0, 99), { ...cheio[99], status: "deleted" }] });
  assert.equal((await publicar(quase)).status, "published");
});

test("no automatico so vira aula com Publicar sozinho; a aula excluida pela equipe nao volta sozinha, so pelo botao (publicada de novo, com o video e o destino de agora)", async () => {
  const semAuto = escola({ target: { ...DESTINO, autoPublish: false } });
  assert.deepEqual(await publicar(semAuto, "auto", null), { reason: "auto_off", status: "skipped" });
  assert.equal(aulaDe(semAuto), null);

  const excluida = { deleted_at: "2026-11-13T14:30:00.000Z", deleted_by: PRODUTORA, description: "", duration: "", id: AULA, module_id: OUTUBRO, sort_order: 0, status: "deleted", title: "Titulo antigo", video_config: null };
  const db = escola({ lessons: [excluida, { id: "lesson-outra", module_id: NOVEMBRO, sort_order: 2, status: "published", title: "Outra" }] });

  assert.deepEqual(await publicar(db, "auto", null), { reason: "removed", status: "skipped" });
  assert.equal(aulaDe(db).status, "deleted", "a exclusao da equipe e respeitada");

  const outcome = await publicar(db, "manual");
  assert.deepEqual(outcome, { lessonId: AULA, moduleCreated: false, moduleId: NOVEMBRO, productId: PRODUTO, restored: true, status: "published", title: "Live de agentes" });
  const aula = aulaDe(db);
  assert.deepEqual(
    { deleted_at: aula.deleted_at, deleted_by: aula.deleted_by, module_id: aula.module_id, sort_order: aula.sort_order, status: aula.status, title: aula.title, video_config: aula.video_config },
    { deleted_at: null, deleted_by: null, module_id: NOVEMBRO, sort_order: 3, status: "published", title: "Live de agentes", video_config: { assetId: VIDEO, provider: "bunny", url: PLAYER } }
  );
  assert.equal(db.tables.lessons.length, 2, "a aula volta; nenhuma segunda aula nasce");
  assert.equal(db.tables.admin_audit_log.at(-1).metadata.restored, true);
});

test("dois pedidos ao mesmo tempo criam uma aula so: quem perde a corrida ve a aula pronta; o automatico nunca lanca, nem com o banco fora", async () => {
  const db = escola();
  db.falhar("lessons", "insert", { code: "23505", message: "duplicate key value violates unique constraint \"lessons_pkey\"" });
  assert.deepEqual(await publicar(db), { lessonId: AULA, status: "exists", title: "Live de agentes" });
  assert.equal(db.tables.admin_audit_log.length, 0, "quem perdeu a corrida nao audita nem invalida");
  assert.deepEqual(actionStubs.invalidations, []);

  const fora = escola();
  fora.falhar("lessons", "select", { code: "XX000", message: "banco fora" });
  await assert.rejects(() => publicar(fora), /banco fora|aula do replay/);
  fora.falhar("lessons", "select", { code: "XX000", message: "banco fora" });
  const [resultado, logs] = await quieto(() => autoPublishReplayLesson(fora, WEBINAR, AGORA));
  assert.equal(resultado, null);
  assert.ok(logs.some((linha) => linha.startsWith("error:") && linha.includes(WEBINAR)));

  const [ok, falas] = await quieto(() => autoPublishReplayLesson(escola(), WEBINAR, AGORA));
  assert.equal(ok.status, "published");
  assert.deepEqual(actionStubs.invalidations, [{ from: "route" }], "fora do botao o catalogo e invalidado como rota");
  assert.ok(falas.some((linha) => linha.startsWith("info:") && linha.includes(AULA)));
});

/* ------------------------------------------------------------------------------------------------
 * As Server Actions
 * ---------------------------------------------------------------------------------------------- */

test("Publicar replay: quem publica na Comunicacao e mexe no conteudo do produto cria a aula; de novo, a resposta diz que ja existia", async () => {
  const db = escola();

  const primeira = await actions.publishWebinarReplay({ id: WEBINAR });
  assert.deepEqual(primeira, { data: { created: true, lessonId: AULA, title: "Live de agentes" }, ok: true });
  assert.equal(aulaDe(db).status, "published");
  assert.equal(db.tables.admin_audit_log[0].actor_id, PRODUTORA);
  assert.deepEqual(estado.revalidados, ["/admin/comunicacao/webinarios", `/admin/comunicacao/webinarios/${WEBINAR}`]);

  const segunda = await actions.publishWebinarReplay({ id: WEBINAR });
  assert.deepEqual(segunda, { data: { created: false, lessonId: AULA, title: "Live de agentes" }, ok: true });
  assert.equal(db.tables.lessons.length, 1);
});

test("Publicar replay recusa com a frase e o status: sem mexer no conteudo (403), produto fora dos cursos da pessoa (403), sem destino (422), sem replay (409), arquivado (409) e webinario que sumiu (404)", async () => {
  const recusa = async (opcoes, antes = () => {}) => {
    const db = escola(opcoes);
    antes();
    const result = await actions.publishWebinarReplay({ id: WEBINAR });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(aulaDe(db), null);
    return [result.status, result.error];
  };

  try {
    actionStubs.role = pessoa("messaging.write", "messaging.publish");
    const [status, frase] = await recusa({});
    assert.deepEqual([status, frase], [403, describeForbidden("catalog.content")], "a mesma frase de quem tenta criar a aula pelo admin");
  } finally {
    actionStubs.role = pessoa("messaging.write", "messaging.publish", "catalog.content");
  }

  assert.equal((await recusa({}, () => estado.foraDoEscopo.push(PRODUTO)))[0], 403);
  assert.deepEqual(await recusa({ target: null }), [422, model.REPLAY_LESSON_MESSAGES.no_target]);
  assert.deepEqual(await recusa({ replay: false }), [409, model.REPLAY_LESSON_MESSAGES.no_replay]);
  assert.deepEqual(await recusa({ target: { ...DESTINO, moduleId: "module-que-sumiu" } }), [422, model.REPLAY_LESSON_MESSAGES.module_missing]);
  assert.equal((await recusa({ webinar: { status: "archived" } }))[0], 409);
  assert.equal((await recusa({ webinar: { deleted_at: "2026-11-13T14:00:00.000Z" } }))[0], 404);
});

test("os modulos do produto para o card: na ordem do curso, sem os excluidos e sem os de outro produto", async () => {
  escola({
    modules: [
      { id: NOVEMBRO, owner_id: PRODUTO, sort_order: 1, status: "published", title: "Novembro" },
      { id: "module-excluido", owner_id: PRODUTO, sort_order: 2, status: "deleted", title: "Excluido" },
      { id: OUTUBRO, owner_id: PRODUTO, sort_order: 0, status: "draft", title: "Outubro" },
      { id: "module-de-outro", owner_id: "course-outro", sort_order: 0, status: "published", title: "De outro produto" }
    ]
  });

  assert.deepEqual(await actions.listReplayLessonModules({ productId: PRODUTO }), {
    data: {
      modules: [
        { id: OUTUBRO, title: "Outubro" },
        { id: NOVEMBRO, title: "Novembro" }
      ]
    },
    ok: true
  });
  assert.deepEqual((await actions.listReplayLessonModules({ productId: "course-sem-modulos" })).data, { modules: [] });
  assert.equal((await actions.listReplayLessonModules({ productId: "id com espaco" })).ok, false);

  // So quem mexe no conteudo do produto le os modulos dele (a mesma regra do destino no Salvar).
  estado.foraDoEscopo.push(PRODUTO);
  assert.deepEqual([(await actions.listReplayLessonModules({ productId: PRODUTO })).ok, (await actions.listReplayLessonModules({ productId: PRODUTO })).status], [false, 403]);
  estado.foraDoEscopo.length = 0;
  try {
    actionStubs.role = pessoa("messaging.write", "messaging.publish");
    assert.equal((await actions.listReplayLessonModules({ productId: PRODUTO })).status, 403);
  } finally {
    actionStubs.role = pessoa("messaging.write", "messaging.publish", "catalog.content");
  }
});

test("Salvar com o destino num produto em que a pessoa nao mexe no conteudo: recusa no campo do produto, antes de gravar qualquer coisa", async () => {
  const draft = { ...emptyWebinarDraft("live"), replayLessonTarget: { ...DESTINO }, title: "Live nova" };
  const recusado = async () => {
    const db = escola();
    const result = await actions.saveWebinarDraft({ draft });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(db.tables.webinars.length, 1, "nenhum webinario novo");
    return result;
  };

  try {
    actionStubs.role = pessoa("messaging.write", "messaging.publish");
    const semConteudo = await recusado();
    assert.ok(semConteudo.fieldErrors?.["replayLessonTarget.productId"], JSON.stringify(semConteudo));
  } finally {
    actionStubs.role = pessoa("messaging.write", "messaging.publish", "catalog.content");
  }

  const db = escola();
  estado.foraDoEscopo.push(PRODUTO);
  const foraDoEscopo = await actions.saveWebinarDraft({ draft });
  assert.ok(foraDoEscopo.fieldErrors?.["replayLessonTarget.productId"], JSON.stringify(foraDoEscopo));
  assert.equal(db.tables.webinars.length, 1);
});
