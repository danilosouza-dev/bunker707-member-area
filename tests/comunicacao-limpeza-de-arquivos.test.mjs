import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Limpeza automatica dos arquivos da Comunicacao sem uso (docs/22 §4.6; docs/18 §1.1): o que conta como uso em
// cada tipo de conteudo (Padrão, Personalizado, Livre, aviso, notificacao, fonte, modelo da docs/28), os prazos de 24 h e de
// 30 dias, quando o job trabalha no dia, o plano de cada rodada e a rodada inteira contra um banco e um Storage em
// memoria (inclusive a falha do Storage, que solta a reserva). A reserva antes de apagar: a linha so sai depois da
// remocao, o envio do mesmo arquivo confere a marca antes de enviar (livre sai, reservada espera, esquecida e
// tomada) e, no meio de uma remocao, o arquivo enviado fica. A rodada contra o banco e o Storage locais de verdade
// esta em tests/integration/limpeza-de-arquivos.test.mjs; os campos de arquivo dos designs, na guarda.

const refs = await import("../src/server/communications/media-refs.ts");
const model = await import("../src/server/communications/media-cleanup-model.ts");
const cleanup = await import("../src/server/communications/media-cleanup.ts");
const router = await import("../src/server/communications/popup-design-router.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const { COMMUNICATION_MEDIA_JOB_NAME, communicationMediaJob } = await import("../src/server/jobs/communication-media-job.ts");

const NUVEM = "https://abcdefgh.supabase.co";
const HETZNER = "https://storage.bunker707.com.br";
const HEX = "0123456789abcdef01234567";
const HEX2 = "89abcdef0123456789abcdef";
const VIDEO = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const VIDEO2 = "videos/1c8d8f4f-3e2b-4d66-8b5f-6a2a8c3d0e21.webm";
const AVISO_IMG = `communications/images/${HEX}.webp`;
const LIVRE_IMG = `communications/free/${HEX2}.webp`;
const AUDIO = `campaigns/${HEX}.mp3`;
const FONTE = `fonts/${HEX}.woff2`;
const FONTE_ID = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";
const publico = (origin, bucket, path) => `${origin}/storage/v1/object/public/${bucket}/${path}`;
const chaves = (lista) => lista.map(refs.mediaKey).sort();

const DIA = 86_400_000;
const HORA = 3_600_000;
const AGORA = new Date("2026-11-30T10:00:00.000Z");
const antes = (ms) => new Date(AGORA.getTime() - ms).toISOString();

function personalizadoComTudo(origin = NUVEM) {
  const design = custom.popupStarterDesign("media_top_fade", {
    video: { mimeType: "video/mp4", path: VIDEO, url: publico(origin, "communication-popup-video", VIDEO) }
  });
  design.card.background = { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: publico(origin, "content-assets", AVISO_IMG) };
  design.fonts = [FONTE_ID];

  return design;
}

function livreComTudo() {
  return {
    assets: [
      { height: 90, id: "capa", kind: "image", path: AVISO_IMG, width: 160 },
      { height: 48, id: "img", kind: "image", path: LIVRE_IMG, width: 64 },
      { id: "v", kind: "video", mimeType: "video/webm", path: VIDEO2, poster: "capa" }
    ],
    children: [
      { asset: "v", id: "midia", type: "video" },
      { asset: "img", id: "foto", type: "image" },
      { box: { fill: [{ asset: "img", kind: "image" }] }, id: "forma", type: "shape" },
      { id: "links", type: "links" }
    ],
    fonts: [FONTE_ID.toUpperCase()],
    mode: "free",
    version: 1
  };
}

/* ------------------------------------------------------------------------------------------------
 * O que conta como uso
 * ---------------------------------------------------------------------------------------------- */

test("Padrão: nenhum arquivo no design; a imagem e o áudio do aviso contam, de qualquer origem", () => {
  assert.deepEqual(refs.popupDesignMediaRefs(null), []);
  assert.deepEqual(refs.popupDesignMediaRefs(undefined), []);
  assert.deepEqual(refs.designFontIds(null), []);

  const linha = { audio_url: publico(HETZNER, "communication-audio", AUDIO), image_url: publico(NUVEM, "content-assets", AVISO_IMG), popup_design: null };
  assert.deepEqual(chaves(refs.campaignMediaRefs(linha)), [`communication-audio/${AUDIO}`, `content-assets/${AVISO_IMG}`]);

  // Imagem de fora do nosso Storage nao e nossa para apagar (e nao atrapalha).
  assert.deepEqual(refs.campaignMediaRefs({ audio_url: null, image_url: "https://cdn.exemplo.com/capa.jpg", popup_design: null }), []);
  // Imagem transformada do Storage tambem conta.
  assert.deepEqual(chaves([refs.storageRefOfUrl(`${NUVEM}/storage/v1/render/image/public/content-assets/${AVISO_IMG}?width=320`)]), [`content-assets/${AVISO_IMG}`]);
  assert.equal(refs.storageRefOfUrl("nao e endereco"), null);
  assert.equal(refs.storageRefOfUrl(`${NUVEM}/storage/v1/object/public/content-assets/`), null);
});

test("Personalizado: o vídeo (mesmo com a mídia em imagem) e a imagem do fundo do cartão; a origem não importa", () => {
  const design = personalizadoComTudo();
  const esperado = [`communication-popup-video/${VIDEO}`, `content-assets/${AVISO_IMG}`];

  assert.deepEqual(chaves(refs.customDesignMediaRefs(design)), esperado);
  assert.deepEqual(chaves(refs.popupDesignMediaRefs(design)), esperado);
  assert.deepEqual(chaves(refs.popupDesignMediaRefs(personalizadoComTudo(HETZNER))), esperado, "nuvem e Hetzner dão o mesmo arquivo");
  assert.deepEqual(refs.designFontIds(design), [FONTE_ID]);

  design.media.kind = "image";
  assert.deepEqual(chaves(refs.popupDesignMediaRefs(design)), esperado, "o vídeo fica guardado ao trocar para imagem: continua em uso");

  assert.deepEqual(refs.popupDesignMediaRefs(custom.popupStarterDesign("text_only")), []);
});

test("Livre: todo arquivo de assets, no bucket do tipo (tipo desconhecido segura os dois)", () => {
  assert.deepEqual(chaves(refs.freeDesignMediaRefs(livreComTudo())), [
    `communication-popup-video/${VIDEO2}`,
    `content-assets/${LIVRE_IMG}`,
    `content-assets/${AVISO_IMG}`
  ]);
  assert.deepEqual(refs.designFontIds(livreComTudo()), [FONTE_ID], "ids das fontes em minúsculas");
  assert.deepEqual(chaves(refs.freeDesignMediaRefs({ assets: [{ id: "x", kind: "gif", path: LIVRE_IMG }], mode: "free" })), [
    `communication-popup-video/${LIVRE_IMG}`,
    `content-assets/${LIVRE_IMG}`
  ]);
  assert.deepEqual(refs.freeDesignMediaRefs({ assets: "lixo", mode: "free" }), []);
});

test("ao salvar e na limpeza é a mesma leitura: storedPopupDesignAssetPaths sai de popupDesignMediaRefs", () => {
  for (const design of [personalizadoComTudo(), livreComTudo(), custom.popupStarterDesign("text_only"), null]) {
    assert.deepEqual(
      router.storedPopupDesignAssetPaths(design).sort(),
      [...new Set(refs.popupDesignMediaRefs(design).map((ref) => ref.path))].sort()
    );
    assert.deepEqual(router.storedPopupDesignFontIds(design), refs.designFontIds(design));
  }
});

test("notificações: os tipos de hoje não guardam arquivo; um payload com arquivo seria lido", () => {
  assert.deepEqual([...refs.NOTIFICATION_KINDS_WITHOUT_MEDIA].sort(), ["comment_mention", "comment_reply", "notice", "webinar"]);
  assert.deepEqual([...refs.NOTIFICATION_KINDS_WITH_MEDIA], []);

  const comentario = { payload: { commentId: "c1", contentId: "p1", lessonId: "l1", lessonTitle: "Aula 1", moduleId: "m1", parentCommentId: null } };
  assert.deepEqual(refs.notificationMediaRefs(comentario), []);
  // A de live (docs/30 D27) guarda so ids e o tipo do aviso.
  assert.deepEqual(refs.notificationMediaRefs({ payload: { kind: "h24", sessionId: "s1", webinarId: "w1" } }), []);
  assert.deepEqual(refs.notificationMediaRefs({ payload: null }), []);

  const comArquivo = { payload: { extra: { audio: publico(NUVEM, "communication-audio", AUDIO), lista: [VIDEO, "texto qualquer"] } } };
  assert.deepEqual(chaves(refs.notificationMediaRefs(comArquivo)), [`communication-audio/${AUDIO}`, `communication-popup-video/${VIDEO}`]);
});

test("fontes: a da biblioteca fica; a excluída só fica se um aviso não excluído ou um modelo ainda usa", () => {
  const linhas = [
    { deleted_at: null, file_path: `fonts/${HEX2}.ttf`, id: "a" },
    { deleted_at: antes(DIA), file_path: FONTE, id: FONTE_ID },
    { deleted_at: antes(DIA), file_path: `fonts/${"f".repeat(24)}.otf`, id: "sem-uso" }
  ];

  assert.deepEqual(chaves(refs.fontFileRefs(linhas, [])), [`communication-fonts/fonts/${HEX2}.ttf`]);
  assert.deepEqual(chaves(refs.fontFileRefs(linhas, [FONTE_ID.toUpperCase()])), [`communication-fonts/${FONTE}`, `communication-fonts/fonts/${HEX2}.ttf`]);
  // O mesmo arquivo numa linha excluida e numa nova: um uso so.
  assert.deepEqual(chaves(refs.fontFileRefs([{ deleted_at: antes(DIA), file_path: FONTE, id: "velha" }, { deleted_at: null, file_path: FONTE, id: "nova" }], [])), [`communication-fonts/${FONTE}`]);
});

/** Payload de modelo de pop-up (docs/28): conteudo com imagem e audio, design Personalizado com video e fundo. */
function modeloDePopUp(origin = NUVEM) {
  return {
    audience: null,
    content: {
      audio: { durationSeconds: 3, mimeType: "audio/mpeg", peaks: [], url: publico(origin, "communication-audio", AUDIO) },
      body: "",
      cta: null,
      image: { alt: "", url: publico(origin, "content-assets", `communications/images/${HEX2}.webp`) },
      poll: null,
      reactions: false,
      response: null,
      title: "Oferta"
    },
    design: personalizadoComTudo(origin),
    designSupport: null,
    kind: "popup",
    settings: { allowSnooze: true, icon: null, popup: {} },
    version: 1
  };
}

test("modelos: o que o modelo segura sai do jsonb cru, pelas mesmas funções do aviso (design, conteúdo e fontes)", () => {
  const uso = refs.templateMediaUse({ payload: modeloDePopUp() });
  assert.deepEqual(chaves(uso.refs), [
    `communication-audio/${AUDIO}`,
    `communication-popup-video/${VIDEO}`,
    `content-assets/${AVISO_IMG}`,
    `content-assets/communications/images/${HEX2}.webp`
  ]);
  assert.deepEqual(uso.fontIds, [FONTE_ID]);
  assert.deepEqual(refs.templateMediaUse({ payload: null }), { fontIds: [], refs: [] });
  assert.deepEqual(refs.templateMediaUse({}), { fontIds: [], refs: [] });
  assert.deepEqual(chaves(refs.templateMediaUse({ payload: { ...modeloDePopUp(HETZNER), design: livreComTudo() } }).refs), [
    `communication-audio/${AUDIO}`,
    `communication-popup-video/${VIDEO2}`,
    `content-assets/${LIVRE_IMG}`,
    `content-assets/${AVISO_IMG}`,
    `content-assets/communications/images/${HEX2}.webp`
  ], "nuvem e Hetzner dão o mesmo arquivo; o Livre segura todo arquivo de assets");
});

test("os lugares: só os nossos padrões; o resto do bucket das capas nunca é da limpeza", () => {
  assert.ok(refs.mediaLocationOf({ bucket: "content-assets", path: AVISO_IMG }));
  assert.ok(refs.mediaLocationOf({ bucket: "content-assets", path: LIVRE_IMG }));
  assert.ok(refs.mediaLocationOf({ bucket: "communication-audio", path: AUDIO }));
  assert.ok(refs.mediaLocationOf({ bucket: "communication-fonts", path: FONTE }));
  assert.ok(refs.mediaLocationOf({ bucket: "communication-popup-video", path: VIDEO }));
  assert.equal(refs.mediaLocationOf({ bucket: "content-assets", path: `products/${HEX}.webp` }), null, "capa de produto");
  assert.equal(refs.mediaLocationOf({ bucket: "content-assets", path: `communications/images/${HEX}.png` }), null, "nome fora do padrão");
  assert.equal(refs.mediaLocationOf({ bucket: "communication-popup-video", path: AVISO_IMG }), null, "bucket errado");
});

/* ------------------------------------------------------------------------------------------------
 * Prazos e o dia
 * ---------------------------------------------------------------------------------------------- */

test("24 h: o arquivo enviado há menos de um dia (ou sem data) não é julgado", () => {
  assert.equal(model.isTooRecentToJudge(antes(24 * HORA - 60_000), AGORA), true);
  assert.equal(model.isTooRecentToJudge(antes(24 * HORA), AGORA), false);
  assert.equal(model.isTooRecentToJudge(null, AGORA), true);
  assert.equal(model.isTooRecentToJudge("ontem", AGORA), true);
});

test("30 dias: sai com 30 dias sem uso, nunca antes (data ilegível nunca vence)", () => {
  assert.equal(model.isOrphanDue(antes(30 * DIA - 60_000), AGORA), false);
  assert.equal(model.isOrphanDue(antes(30 * DIA), AGORA), true);
  assert.equal(model.isOrphanDue("lixo", AGORA), false);
  assert.equal(model.orphanDueCutoff(AGORA).toISOString(), antes(30 * DIA));
});

test("reserva: esquecida com 15 min; o envio do mesmo arquivo segue sem marca, apaga a livre, espera a reservada e toma a esquecida", () => {
  assert.equal(model.MEDIA_CLEANUP_RULES.claimStaleMinutes, 15);
  assert.ok(model.MEDIA_CLEANUP_RULES.claimRemoveWindowMs < model.MEDIA_CLEANUP_RULES.claimStaleMinutes * 60_000, "a remoção sai bem antes de a reserva ficar esquecida");
  assert.equal(model.claimStaleCutoff(AGORA).toISOString(), antes(15 * 60_000));
  assert.equal(model.isClaimStale(antes(15 * 60_000 - 1_000), AGORA), false);
  assert.equal(model.isClaimStale(antes(15 * 60_000), AGORA), true);
  assert.equal(model.isClaimStale("lixo", AGORA), true, "data ilegível nunca segura um envio");

  assert.equal(model.orphanMarkUploadStep(null, AGORA), "proceed");
  assert.equal(model.orphanMarkUploadStep({ claimedAt: null }, AGORA), "delete_free");
  assert.equal(model.orphanMarkUploadStep({ claimedAt: antes(2_000) }, AGORA), "wait");
  assert.equal(model.orphanMarkUploadStep({ claimedAt: new Date(AGORA.getTime() + 5_000).toISOString() }, AGORA), "wait", "relógio um pouco à frente: espera");
  assert.equal(model.orphanMarkUploadStep({ claimedAt: antes(16 * 60_000) }, AGORA), "take_stale");
});

test("o dia: a rodada sai a partir das 06:53 UTC, uma vez; falha espera 1 h; parou no teto continua em 5 min", () => {
  assert.equal(model.dailySlotStart(new Date("2026-11-30T06:52:00.000Z")).toISOString(), "2026-11-29T06:53:00.000Z");
  assert.equal(model.dailySlotStart(new Date("2026-11-30T06:53:00.000Z")).toISOString(), "2026-11-30T06:53:00.000Z");

  const decidir = (runs) => model.mediaCleanupDecision(AGORA, runs).reason;
  assert.equal(decidir([]), "due");
  assert.equal(decidir([{ done: true, startedAt: "2026-11-30T06:53:10.000Z", status: "succeeded" }]), "already_done");
  assert.equal(decidir([{ done: true, startedAt: "2026-11-29T06:53:10.000Z", status: "succeeded" }]), "due", "a de ontem não vale hoje");
  assert.equal(decidir([{ done: false, startedAt: antes(30 * 60_000), status: "failed" }]), "cooling_down");
  assert.equal(decidir([{ done: false, startedAt: antes(61 * 60_000), status: "failed" }]), "due");
  assert.equal(decidir([{ done: false, startedAt: antes(5 * 60_000), status: "running" }]), "running");
  assert.equal(decidir([{ done: false, startedAt: antes(20 * 60_000), status: "running" }]), "due", "execução esquecida");
  assert.equal(decidir([{ done: false, startedAt: antes(3 * 60_000), status: "succeeded" }]), "cooling_down");
  assert.equal(decidir([{ done: false, startedAt: antes(6 * 60_000), status: "succeeded" }]), "due");
});

/* ------------------------------------------------------------------------------------------------
 * O plano
 * ---------------------------------------------------------------------------------------------- */

const LUGARES_COMPLETOS = new Set(refs.COMMUNICATION_MEDIA_LOCATIONS.map((location) => model.mediaLocationKey(location)));
const velho = (bucket, path) => ({ bucket, createdAt: antes(40 * DIA), path });

test("plano: marca o sem uso, ignora o recente, desmarca o que voltou a ser usado, o que sumiu e o enviado de novo", () => {
  const plano = model.planMediaCleanup({
    completeLocations: LUGARES_COMPLETOS,
    listed: [
      velho("communication-popup-video", VIDEO),
      velho("communication-popup-video", VIDEO2),
      { bucket: "communication-audio", createdAt: antes(HORA), path: AUDIO },
      { bucket: "content-assets", createdAt: antes(2 * HORA), path: LIVRE_IMG },
      velho("content-assets", `communications/images/${HEX}.png`)
    ],
    marked: [
      { bucket: "content-assets", firstOrphanAt: antes(5 * DIA), path: AVISO_IMG },
      { bucket: "communication-fonts", firstOrphanAt: antes(40 * DIA), path: FONTE },
      { bucket: "content-assets", firstOrphanAt: antes(40 * DIA), path: `products/${HEX}.webp` },
      { bucket: "content-assets", firstOrphanAt: antes(40 * DIA), path: LIVRE_IMG }
    ],
    now: AGORA,
    referenced: new Set([`communication-popup-video/${VIDEO}`, `communication-fonts/${FONTE}`])
  });

  assert.deepEqual(chaves(plano.mark), [`communication-popup-video/${VIDEO2}`]);
  assert.equal(plano.recent, 1, "o áudio de 1 h atrás");
  assert.deepEqual(chaves(plano.unmark), [
    `communication-fonts/${FONTE}`,
    `content-assets/${LIVRE_IMG}`,
    `content-assets/${AVISO_IMG}`,
    `content-assets/products/${HEX}.webp`
  ]);
  assert.deepEqual(plano.due, []);
});

test("plano: só o vencido que ainda está no Storage sai, os mais antigos primeiro, até o teto", () => {
  const marcados = [
    { bucket: "communication-popup-video", firstOrphanAt: antes(31 * DIA), path: VIDEO },
    { bucket: "communication-popup-video", firstOrphanAt: antes(45 * DIA), path: VIDEO2 },
    { bucket: "communication-audio", firstOrphanAt: antes(29 * DIA), path: AUDIO }
  ];
  const listados = [velho("communication-popup-video", VIDEO), velho("communication-popup-video", VIDEO2), velho("communication-audio", AUDIO)];
  const plano = model.planMediaCleanup({ completeLocations: LUGARES_COMPLETOS, listed: listados, marked: marcados, maxDeletes: 1, now: AGORA, referenced: new Set() });

  assert.deepEqual(chaves(plano.due), [`communication-popup-video/${VIDEO2}`]);
  assert.equal(plano.remaining, 1);
  assert.equal(plano.waiting, 1, "o áudio com 29 dias espera");
  assert.deepEqual(plano.mark, []);

  // Lugar listado pela metade: "não está na lista" não quer dizer que sumiu.
  const pela = model.planMediaCleanup({ completeLocations: new Set(), listed: [], marked: marcados, now: AGORA, referenced: new Set() });
  assert.deepEqual(pela.unmark, []);
  assert.deepEqual(pela.due, []);
});

test("plano: marca reservada por outra rodada fica com ela (nem desmarcada, nem vencida, nem marcada de novo)", () => {
  const reservada = (path, extra = {}) => ({ bucket: "communication-popup-video", claimedAt: antes(60_000), firstOrphanAt: antes(40 * DIA), path, ...extra });
  const plano = model.planMediaCleanup({
    completeLocations: LUGARES_COMPLETOS,
    listed: [velho("communication-popup-video", VIDEO)],
    marked: [reservada(VIDEO), reservada(VIDEO2)],
    now: AGORA,
    referenced: new Set([`communication-popup-video/${VIDEO}`])
  });

  assert.equal(plano.claimed, 2);
  assert.deepEqual([plano.due, plano.unmark, plano.mark], [[], [], []], "em uso ou sumida, a reservada não é mexida aqui");
});

/* ------------------------------------------------------------------------------------------------
 * A rodada inteira, com banco e Storage em memoria
 * ---------------------------------------------------------------------------------------------- */

/** Banco e Storage em memoria que entendem so as consultas da limpeza. */
function memoria({ campaigns = [], fonts = [], marks = [], objects = [], onRemove = null, removeError = null, tableErrors = {}, templates = [] }) {
  const state = { campaigns, fonts, marks: marks.map((row) => ({ ...row })), objects: objects.map((row) => ({ ...row })), removed: [], templates };

  function run(query) {
    // tableErrors: { tabela: erro } ou uma funcao (query) => erro | null (o erro so numa pagina seguinte, por exemplo).
    const tableError = typeof tableErrors === "function" ? tableErrors(query) : tableErrors[query.table];

    if (tableError) {
      return { data: null, error: tableError };
    }

    const value = (name) => query.filters.find(([method, column]) => method === name || column === name);
    const matches = (row) =>
      query.filters.every(([method, column, arg]) => {
        if (method === "eq") return row[column] === arg;
        if (method === "in") return arg.includes(row[column]);
        if (method === "lte") return row[column] <= arg;
        if (method === "lt") return row[column] != null && row[column] < arg;
        if (method === "gt") return row[column] > arg;
        if (method === "is") return (row[column] ?? null) === arg;
        return true;
      });
    const limited = (rows) => {
      const limit = value("limit");
      const range = value("range");
      const sorted = [...rows].sort((a, b) => String(a.id ?? `${a.bucket}/${a.path}`).localeCompare(String(b.id ?? `${b.bucket}/${b.path}`)));
      return range ? sorted.slice(range[1], range[2] + 1) : limit ? sorted.slice(0, limit[1]) : sorted;
    };

    if (query.table === "communication_media_orphans") {
      if (query.op === "upsert") {
        for (const row of query.payload) {
          if (!state.marks.some((mark) => mark.bucket === row.bucket && mark.path === row.path)) {
            state.marks.push({ ...row });
          }
        }
        return { data: null, error: null };
      }

      if (query.op === "delete") {
        const gone = state.marks.filter(matches);
        state.marks = state.marks.filter((row) => !gone.includes(row));
        return { data: gone, error: null };
      }

      if (query.op === "update") {
        const changed = state.marks.filter(matches);
        changed.forEach((row) => Object.assign(row, query.payload));
        return { data: changed.map((row) => ({ ...row })), error: null };
      }

      return { data: limited(state.marks.filter(matches)), error: null };
    }

    const table = { campaigns: state.campaigns, communication_fonts: state.fonts, communication_templates: state.templates }[query.table] ?? [];
    return { data: limited(table.filter(matches)), error: null };
  }

  function chain(query) {
    return new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(run(query)).then(resolve, reject);
          }

          return (...args) => {
            if (["delete", "insert", "upsert", "update"].includes(property)) {
              query.op = property;
              query.payload = args[0];
            } else if (property !== "select" && property !== "order") {
              query.filters.push([property, ...args]);
            }

            return chain(query);
          };
        }
      }
    );
  }

  return {
    from: (table) => chain({ filters: [], op: "select", payload: undefined, table }),
    state,
    storage: {
      from(bucket) {
        return {
          async list(prefix, { limit, offset }) {
            const entries = state.objects
              .filter((object) => object.bucket === bucket && object.path.startsWith(`${prefix}/`))
              .map((object) => ({ created_at: object.createdAt, id: `${bucket}:${object.path}`, name: object.path.slice(prefix.length + 1) }))
              .sort((a, b) => a.name.localeCompare(b.name));
            return { data: entries.slice(offset, offset + limit), error: null };
          },
          async remove(paths) {
            await onRemove?.(bucket, paths);

            if (removeError) {
              return { data: null, error: { message: removeError } };
            }

            state.removed.push(...paths.map((path) => `${bucket}/${path}`));
            state.objects = state.objects.filter((object) => !(object.bucket === bucket && paths.includes(object.path)));
            return { data: paths.map((name) => ({ name })), error: null };
          }
        };
      }
    }
  };
}

test("rodada: marca, espera os 30 dias, apaga o vencido, nunca o usado, e repetir não muda nada", async () => {
  const db = memoria({
    campaigns: [{ audio_url: null, deleted_at: null, id: "c1", image_url: null, popup_design: personalizadoComTudo() }],
    marks: [{ bucket: "communication-popup-video", first_orphan_at: antes(30 * DIA), path: VIDEO2 }],
    objects: [velho("communication-popup-video", VIDEO), velho("communication-popup-video", VIDEO2), velho("communication-audio", AUDIO), velho("content-assets", AVISO_IMG)]
  });

  const primeira = await cleanup.runMediaCleanup({ db, now: AGORA });
  assert.equal(primeira.deleted, 1);
  assert.deepEqual(db.state.removed, [`communication-popup-video/${VIDEO2}`]);
  assert.equal(primeira.marked, 1, "o áudio sem uso");
  assert.deepEqual(db.state.marks.map((row) => `${row.bucket}/${row.path}`), [`communication-audio/${AUDIO}`]);
  assert.equal(db.state.marks[0].first_orphan_at, AGORA.toISOString());
  assert.equal(primeira.done, true);

  const segunda = await cleanup.runMediaCleanup({ db, now: AGORA });
  assert.deepEqual([segunda.deleted, segunda.marked, segunda.unmarked, segunda.waiting], [0, 0, 0, 1]);
  assert.ok(db.state.objects.some((object) => object.path === VIDEO), "o vídeo usado pelo pop-up fica");
});

test("rodada: falha no Storage solta a reserva e a marca fica com a data de antes (sai amanhã)", async () => {
  const db = memoria({
    marks: [{ bucket: "communication-audio", first_orphan_at: antes(40 * DIA), path: AUDIO }],
    objects: [velho("communication-audio", AUDIO)],
    removeError: "falha de rede"
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const result = await cleanup.runMediaCleanup({ db, now: AGORA });
    assert.deepEqual([result.deleted, result.failed, result.done], [0, 1, true]);
  } finally {
    console.error = original;
  }

  assert.deepEqual(db.state.marks, [{ bucket: "communication-audio", claimed_at: null, first_orphan_at: antes(40 * DIA), path: AUDIO }]);
  assert.ok(errors.some((line) => line.includes("nao sairam do Storage")), errors.join("\n"));
  assert.ok(!errors.join("\n").includes(AUDIO), "o log não leva o caminho");
});

test("rodada: a reserva só sai da tabela depois da remoção; a esquecida é solta e decidida de novo; a de outra rodada fica", async () => {
  const agora = new Date();
  const db = memoria({
    marks: [
      { bucket: "communication-audio", claimed_at: null, first_orphan_at: antes(40 * DIA), path: AUDIO },
      // Rodada que caiu entre reservar e terminar, há 20 min: solta no começo e apagada nesta.
      { bucket: "communication-fonts", claimed_at: new Date(agora.getTime() - 20 * 60_000).toISOString(), first_orphan_at: antes(40 * DIA), path: FONTE },
      // Outra rodada apagando agora: fica com ela.
      { bucket: "communication-popup-video", claimed_at: new Date(agora.getTime() - 5_000).toISOString(), first_orphan_at: antes(40 * DIA), path: VIDEO }
    ],
    objects: [velho("communication-audio", AUDIO), velho("communication-fonts", FONTE), velho("communication-popup-video", VIDEO)],
    onRemove(bucket, paths) {
      for (const path of paths) {
        const linha = db.state.marks.find((row) => row.bucket === bucket && row.path === path);
        assert.ok(linha?.claimed_at, `${bucket}/${path}: reservada durante a remoção, e a linha ainda está lá`);
      }
    }
  });

  const result = await cleanup.runMediaCleanup({ db, now: AGORA });
  assert.equal(result.released, 1);
  assert.equal(result.deleted, 2);
  assert.deepEqual(db.state.removed.sort(), [`communication-audio/${AUDIO}`, `communication-fonts/${FONTE}`]);
  assert.deepEqual(db.state.marks.map((row) => `${row.bucket}/${row.path}`), [`communication-popup-video/${VIDEO}`], "só a reserva da outra rodada fica");
  assert.ok(db.state.objects.some((object) => object.path === VIDEO));
});

test("rodada: banco sem a migração 202610240001 (ou sem a coluna claimed_at) termina sem erro", async () => {
  for (const error of [{ code: "PGRST205", message: "Could not find the table" }, { code: "42703", message: "column communication_media_orphans.claimed_at does not exist" }]) {
    const db = memoria({});
    const from = db.from;
    const falha = async () => ({ data: null, error });
    const proxied = {
      ...db,
      from: (table) =>
        table === "communication_media_orphans"
          ? {
              select: () => ({ order: () => ({ order: () => ({ range: falha }) }) }),
              update: () => ({ lt: () => ({ select: falha }) })
            }
          : from(table)
    };

    const result = await cleanup.runMediaCleanup({ db: proxied, now: AGORA });
    assert.equal(result.pendingMigration, true, error.code);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Modelos (docs/28 D17): a leitura dos modelos nao excluidos e a regra estreita da tabela ausente
 * ---------------------------------------------------------------------------------------------- */

test("modelos: loadTemplateMediaUse le os não excluídos (jsonb cru, mesmo o que não passa no schema) e a rodada não marca o que eles seguram", async () => {
  const quebrado = { ...modeloDePopUp(), settings: "não é configuração", version: 1 };
  const db = memoria({
    objects: [velho("communication-popup-video", VIDEO), velho("communication-audio", AUDIO), velho("content-assets", AVISO_IMG), velho("communication-popup-video", VIDEO2)],
    templates: [
      { deleted_at: null, id: "t1", payload: quebrado },
      { deleted_at: antes(DIA), id: "t2", payload: { design: livreComTudo(), designSupport: { ctaLabel: null, image: null }, kind: "design", version: 1 } }
    ]
  });

  const usos = await cleanup.loadTemplateMediaUse(db);
  assert.equal(usos.length, 1, "o excluído não segura nada");
  assert.ok(chaves(usos[0].refs).includes(`communication-popup-video/${VIDEO}`), "o payload que não passa no schema ainda segura os arquivos");

  const rodada = await cleanup.runMediaCleanup({ db, now: AGORA });
  assert.deepEqual(db.state.marks.map((row) => `${row.bucket}/${row.path}`), [`communication-popup-video/${VIDEO2}`], "só o vídeo do modelo excluído fica sem uso");
  assert.equal(rodada.marked, 1);
});

test("modelos: só a tabela ausente (42P01/PGRST205 citando communication_templates) vale como nenhum modelo; coluna que falta ou falha de conexão para a rodada sem marcar nem apagar", async () => {
  for (const error of [
    { code: "PGRST205", message: "Could not find the table 'public.communication_templates' in the schema cache" },
    { code: "42P01", message: 'relation "public.communication_templates" does not exist' }
  ]) {
    assert.deepEqual(await cleanup.loadTemplateMediaUse(memoria({ tableErrors: { communication_templates: error } })), [], error.code);
  }

  assert.equal(cleanup.isMissingTemplatesTable({ code: "PGRST205", message: "Could not find the table 'public.outra_tabela' in the schema cache" }), false, "outra tabela não é a dos modelos");
  assert.equal(cleanup.isMissingTemplatesTable(null), false);

  for (const error of [
    { code: "42703", message: "column communication_templates.payload does not exist" },
    { code: "PGRST204", message: "Could not find the 'payload' column of 'communication_templates' in the schema cache" },
    { code: null, message: "connection failure" },
    { code: "PGRST205", message: "Could not find the table 'public.outra_tabela' in the schema cache" }
  ]) {
    const db = memoria({
      marks: [{ bucket: "communication-audio", first_orphan_at: antes(40 * DIA), path: AUDIO }],
      objects: [velho("communication-audio", AUDIO), velho("communication-popup-video", VIDEO2)],
      tableErrors: { communication_templates: error }
    });

    await assert.rejects(cleanup.loadTemplateMediaUse(db), undefined, `${error.code}: loadTemplateMediaUse`);
    await assert.rejects(cleanup.loadReferencedMedia(db), undefined, `${error.code}: loadReferencedMedia`);
    await assert.rejects(cleanup.runMediaCleanup({ db, now: AGORA }), undefined, `${error.code}: a rodada para`);
    assert.deepEqual(db.state.removed, [], `${error.code}: nada apagado`);
    assert.deepEqual(db.state.marks.map((row) => `${row.bucket}/${row.path}`), [`communication-audio/${AUDIO}`], `${error.code}: nada marcado`);
  }
});

test("modelos: a tabela ausente só vale como nenhum modelo na primeira página; numa página seguinte a leitura lança e a rodada para sem marcar nem apagar", async () => {
  const templates = Array.from({ length: 20 }, (_, index) => ({ deleted_at: null, id: `t${String(index).padStart(2, "0")}`, payload: modeloDePopUp() }));
  const ausente = { code: "PGRST205", message: "Could not find the table 'public.communication_templates' in the schema cache" };
  // A pagina 1 (sem "gt") le as 20 linhas; a 2 (gt id) acha a tabela ausente (a migracao desfeita no meio da leitura).
  const naSegunda = (query) => (query.table === "communication_templates" && query.filters.some(([method]) => method === "gt") ? ausente : null);
  const db = memoria({
    marks: [{ bucket: "communication-audio", first_orphan_at: antes(40 * DIA), path: AUDIO }],
    objects: [velho("communication-audio", AUDIO), velho("communication-popup-video", VIDEO2)],
    tableErrors: naSegunda,
    templates
  });

  await assert.rejects(cleanup.loadTemplateMediaUse(db), undefined, "nao devolve [] descartando os 20 ja lidos");
  await assert.rejects(cleanup.runMediaCleanup({ db, now: AGORA }), undefined, "a rodada para");
  assert.deepEqual(db.state.removed, [], "nada apagado: o audio que os modelos seguram fica");
  assert.deepEqual(db.state.marks.map((row) => `${row.bucket}/${row.path}`), [`communication-audio/${AUDIO}`], "nada marcado");

  // Na primeira pagina continua valendo como nenhum modelo (a migracao pendente).
  assert.deepEqual(await cleanup.loadTemplateMediaUse(memoria({ tableErrors: { communication_templates: ausente } })), []);
});

/* ------------------------------------------------------------------------------------------------
 * O envio do mesmo arquivo (antes de enviar)
 * ---------------------------------------------------------------------------------------------- */

const AUDIO_REF = { bucket: "communication-audio", path: AUDIO };

test("envio: sem marca segue; a livre sai; a esquecida é tomada; caminho que não é nosso nem consulta", async () => {
  const semMarca = memoria({});
  await cleanup.forgetOrphanMark(semMarca, AUDIO_REF, { sleep: () => assert.fail("não devia esperar") });

  const livre = memoria({ marks: [{ bucket: AUDIO_REF.bucket, claimed_at: null, first_orphan_at: antes(40 * DIA), path: AUDIO }] });
  await cleanup.forgetOrphanMark(livre, AUDIO_REF, { sleep: () => assert.fail("não devia esperar") });
  assert.deepEqual(livre.state.marks, []);

  const esquecida = memoria({ marks: [{ bucket: AUDIO_REF.bucket, claimed_at: new Date(Date.now() - 16 * 60_000).toISOString(), first_orphan_at: antes(40 * DIA), path: AUDIO }] });
  await cleanup.forgetOrphanMark(esquecida, AUDIO_REF, { sleep: () => assert.fail("não devia esperar") });
  assert.deepEqual(esquecida.state.marks, []);

  await cleanup.forgetOrphanMark({ from: () => assert.fail("não devia consultar") }, { bucket: "content-assets", path: `products/${HEX}.webp` });
  await cleanup.forgetOrphanMark({ from: () => assert.fail("não devia consultar") }, null);
});

test("envio: marca reservada espera a rodada terminar; não terminou a tempo, 409 e nada enviado", async () => {
  const reservada = () => ({ bucket: AUDIO_REF.bucket, claimed_at: new Date().toISOString(), first_orphan_at: antes(40 * DIA), path: AUDIO });

  const db = memoria({ marks: [reservada()] });
  let esperas = 0;
  await cleanup.forgetOrphanMark(db, AUDIO_REF, {
    sleep: async () => {
      esperas += 1;
      // A rodada termina enquanto o envio espera: apagou do Storage e tirou a linha.
      if (esperas === 2) {
        db.state.marks = [];
      }
    }
  });
  assert.equal(esperas, 2);

  // A remoção falhou e a rodada soltou a reserva: a marca volta livre e o envio a apaga.
  const falhou = memoria({ marks: [reservada()] });
  await cleanup.forgetOrphanMark(falhou, AUDIO_REF, {
    sleep: async () => {
      falhou.state.marks[0].claimed_at = null;
    }
  });
  assert.deepEqual(falhou.state.marks, []);

  const presa = memoria({ marks: [reservada()] });
  await assert.rejects(
    cleanup.forgetOrphanMark(presa, AUDIO_REF, { sleep: async () => {}, waitMs: 0 }),
    (error) => error.status === 409 && error.message === cleanup.MEDIA_BUSY_MESSAGE
  );
  assert.equal(presa.state.marks.length, 1, "a reserva da rodada fica");
});

test("envio: banco sem a migração segue; outro erro do banco falha o envio (sem conferir, o arquivo podia sair)", async () => {
  const comErro = (error) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error }) }) }) }) }) });

  await cleanup.forgetOrphanMark(comErro({ code: "PGRST205", message: "Could not find the table" }), AUDIO_REF);
  await cleanup.forgetOrphanMark(comErro({ code: "42703", message: "column communication_media_orphans.claimed_at does not exist" }), AUDIO_REF);
  await assert.rejects(cleanup.forgetOrphanMark(comErro({ code: "08006", message: "connection failure" }), AUDIO_REF), /nao conferida antes do envio/);
});

test("envio no meio da remoção (reserva, envio dos mesmos bytes, remoção): o envio espera e o arquivo fica, sem marca", async () => {
  let envio = null;
  let enviado = false;
  const db = memoria({
    marks: [{ bucket: AUDIO_REF.bucket, claimed_at: null, first_orphan_at: antes(40 * DIA), path: AUDIO }],
    objects: [velho(AUDIO_REF.bucket, AUDIO)],
    async onRemove(bucket, paths) {
      if (!paths.includes(AUDIO)) {
        return;
      }

      // O editor envia o mesmo áudio entre a reserva e a remoção: confere a marca antes de enviar e grava depois.
      envio = cleanup
        .forgetOrphanMark(db, AUDIO_REF, { sleep: () => new Promise((resolve) => setTimeout(resolve, 5)) })
        .then(() => {
          enviado = true;
          db.state.objects.push({ bucket: AUDIO_REF.bucket, createdAt: new Date().toISOString(), path: AUDIO });
        });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(enviado, false, "o envio espera a remoção terminar");
    }
  });

  const result = await cleanup.runMediaCleanup({ db, now: AGORA });
  await envio;

  assert.equal(result.deleted, 1);
  assert.ok(db.state.objects.some((object) => object.path === AUDIO), "o arquivo que o editor recebeu continua lá");
  assert.deepEqual(db.state.marks, [], "e sem marca");
});

/* ------------------------------------------------------------------------------------------------
 * O job
 * ---------------------------------------------------------------------------------------------- */

/** Banco do job: job_runs devolve `runs`; o resto vem de `memoria`. Anota o que foi gravado em job_runs. */
function bancoDoJob(runs, base = memoria({})) {
  const writes = [];

  return {
    ...base,
    from(table) {
      if (table !== "job_runs") {
        return base.from(table);
      }

      const builder = {
        gte: () => builder,
        limit: async () => ({ data: runs, error: null }),
        neq: () => builder,
        not: () => builder,
        order: () => builder,
        select: () => builder,
        eq: () => builder,
        update(payload) {
          writes.push(payload);
          return { eq: async () => ({ error: null }) };
        }
      };
      return builder;
    },
    writes
  };
}

const contexto = (supabase, tickStartedAt = new Date()) => ({ runId: "run", signal: new AbortController().signal, supabase, tickRunId: "tick", tickStartedAt });

test("job: já rodou hoje, nada no Storage; com o tick quase no fim, nem consulta; senão roda e grava só contagens", async () => {
  assert.equal(COMMUNICATION_MEDIA_JOB_NAME, "comunicacao-limpeza-de-arquivos");
  assert.match(communicationMediaJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);

  const semStorage = { ...memoria({}), storage: { from: () => assert.fail("não devia listar o Storage") } };
  const feito = bancoDoJob([{ metadata: { media_cleanup: { done: true } }, started_at: new Date().toISOString(), status: "succeeded" }], semStorage);
  await communicationMediaJob.run(contexto(feito));
  assert.deepEqual(feito.writes, []);

  const nadaPermitido = { from: () => assert.fail("não devia consultar"), storage: { from: () => assert.fail("não devia listar") } };
  await communicationMediaJob.run(contexto(nadaPermitido, new Date(Date.now() - 40_000)));

  const db = bancoDoJob([], memoria({ objects: [{ bucket: "communication-audio", createdAt: new Date(Date.now() - 2 * DIA).toISOString(), path: AUDIO }] }));
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(" "));

  try {
    await communicationMediaJob.run(contexto(db));
  } finally {
    console.info = original;
  }

  assert.equal(db.writes.length, 2, "começo e fim");
  assert.deepEqual(Object.keys(db.writes[0].metadata.media_cleanup), ["started_at"]);
  assert.equal(db.writes[0].metadata.tick_run_id, "tick");
  const fim = db.writes[1].metadata.media_cleanup;
  assert.equal(fim.marked, 1);
  assert.equal(fim.done, true);
  assert.ok(Object.values(fim).every((value) => typeof value === "number" || typeof value === "boolean"), "só números");
  assert.ok(logs.some((line) => line.includes("limpeza de arquivos") && !line.includes(AUDIO)), logs.join("\n"));
});
