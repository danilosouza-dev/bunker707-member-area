import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Modelos da Comunicacao (docs/28 §4.4 e §7.1 S): as Server Actions de template-actions.ts e a decisao de apagar o
// video recusado (design-checks.ts), sem banco: um banco em memoria que entende as consultas destes modulos (filtros,
// contagem, @> do jsonb, insert e update com updated_at novo). A permissao vem de um duble que recusa quando o teste
// pede, e o "next/cache" registra qualquer revalidatePath (nenhuma acao de modelo pode chamar, D28).
// O mesmo contra o banco local de verdade esta em tests/integration/modelos.test.mjs.

const estado = (globalThis.__modelosAcoes ??= { negar: false, revalidados: [] });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole(action) {
          const estado = globalThis.__modelosAcoes;
          if (estado.negar) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;

      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__modelosAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__modelosAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__modelosAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;

      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

const actions = await import("../src/server/communications/template-actions.ts");
const checks = await import("../src/server/communications/design-checks.ts");
const model = await import("../src/server/communications/template-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const freeStarters = await import("../src/server/communications/popup-free-starters.ts");

const M = model.TEMPLATE_MESSAGES;
const EU = actionStubs.role.user.id;
const NOME = "Lançamento de novembro";

/* ------------------------------------------------------------------------------------------------
 * Banco em memoria
 * ---------------------------------------------------------------------------------------------- */

function contains(target, pattern) {
  if (Array.isArray(pattern)) {
    return Array.isArray(target) && pattern.every((item) => target.some((candidate) => contains(candidate, item)));
  }

  if (pattern && typeof pattern === "object") {
    return Boolean(target) && typeof target === "object" && Object.entries(pattern).every(([key, value]) => contains(target[key], value));
  }

  return target === pattern;
}

let relogio = Date.parse("2026-10-23T12:00:00.000Z");
const agora = () => new Date((relogio += 1_000)).toISOString();

function bancoEmMemoria(tabelas = {}, erros = {}) {
  const tables = { admin_audit_log: [], admin_roles: [{ user_id: EU }], communication_templates: [], ...structuredClone(tabelas) };
  const calls = [];

  function run(query) {
    calls.push(query);

    // erros[tabela]: o erro de toda leitura da tabela, ou uma funcao da consulta (so a contagem, so a lista...).
    const erro = typeof erros[query.table] === "function" ? erros[query.table](query) : erros[query.table];

    if (erro) {
      return { count: null, data: null, error: erro };
    }

    const rows = (tables[query.table] ??= []);
    const matches = (row) =>
      query.filters.every(([method, column, value]) => {
        switch (method) {
          case "eq":
            return row[column] === value;
          case "in":
            return value.includes(row[column]);
          case "is":
            return (row[column] ?? null) === value;
          case "gt":
            return row[column] > value;
          case "contains":
            return contains(row[column], value);
          default:
            return true;
        }
      });

    if (query.op === "insert") {
      const inserted = (Array.isArray(query.payload) ? query.payload : [query.payload]).map((row) => ({
        created_at: agora(),
        deleted_at: null,
        id: randomUUID(),
        ...structuredClone(row),
        updated_at: agora()
      }));
      rows.push(...inserted);
      return { data: query.single ? inserted[0] : inserted, error: null };
    }

    const found = rows.filter(matches);

    if (query.op === "update") {
      found.forEach((row) => Object.assign(row, structuredClone(query.payload), { updated_at: agora() }));
      return { data: structuredClone(found), error: null };
    }

    let result = [...found];

    for (const [column, ascending] of [...query.order].reverse()) {
      result.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }

    if (query.limit !== null) {
      result = result.slice(0, query.limit);
    }

    if (query.head) {
      return { count: found.length, data: null, error: null };
    }

    return { count: found.length, data: query.single ? (result[0] ?? null) : structuredClone(result), error: null };
  }

  function chain(query) {
    const self = {
      contains: (column, value) => (query.filters.push(["contains", column, value]), self),
      delete: () => ((query.op = "delete"), self),
      eq: (column, value) => (query.filters.push(["eq", column, value]), self),
      gt: (column, value) => (query.filters.push(["gt", column, value]), self),
      in: (column, value) => (query.filters.push(["in", column, value]), self),
      insert: (payload) => ((query.op = "insert"), (query.payload = payload), self),
      is: (column, value) => (query.filters.push(["is", column, value]), self),
      limit: (value) => ((query.limit = value), self),
      maybeSingle: () => ((query.single = true), self),
      order: (column, options = {}) => (query.order.push([column, options.ascending !== false]), self),
      select: (_columns, options = {}) => ((query.head = Boolean(options.head)), self),
      single: () => ((query.single = true), self),
      then: (resolve, reject) => Promise.resolve(run(query)).then(resolve, reject),
      update: (payload) => ((query.op = "update"), (query.payload = payload), self)
    };

    return self;
  }

  return {
    calls,
    from: (table) => chain({ filters: [], head: false, limit: null, op: "select", order: [], payload: undefined, single: false, table }),
    storage: {
      from: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/x/${path}` } }) })
    },
    tables
  };
}

function usar(db) {
  actionStubs.db = db;
  estado.negar = false;
  return db;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);

/* ------------------------------------------------------------------------------------------------
 * Entradas
 * ---------------------------------------------------------------------------------------------- */

const rascunho = (kind = "inbox", extra = {}) => ({ ...schemas.emptyNoticeDraft(kind), body: "Texto", title: "Oferta especial", ...extra });
const doRascunho = (extra = {}) => ({
  body: { draft: rascunho(), followUps: null, include: { audience: true, content: true, followUps: true }, source: "notice" },
  name: NOME,
  origin: "notice_editor",
  ...extra
});
const doDesign = (design, freeDesign = null, extra = {}) => ({
  body: { design, freeDesign, source: "design", support: { ctaLabel: "Quero", image: null } },
  name: "Design de teste",
  origin: "design_card",
  ...extra
});

function linhaDeModelo(payload, extra = {}) {
  return {
    created_at: agora(),
    created_by: EU,
    deleted_at: null,
    design_mode: model.templateDesignModeOf(payload),
    id: randomUUID(),
    kind: payload.kind,
    name: "Modelo",
    payload,
    updated_at: agora(),
    updated_by: EU,
    ...extra
  };
}

const payloadDeNotificacao = () => model.templatePayloadOfDraft({ draft: rascunho(), followUps: null, include: { audience: true, content: true, followUps: false } }).payload;
const payloadDeDesign = (mode = "custom") =>
  model.templatePayloadOfDesign(
    mode === "free"
      ? { design: null, freeDesign: freeStarters.freeStarterDesign("blank"), support: { ctaLabel: null, image: null } }
      : { design: custom.popupStarterDesign("text_only"), freeDesign: null, support: { ctaLabel: null, image: null } }
  );

/* ------------------------------------------------------------------------------------------------
 * Acoes
 * ---------------------------------------------------------------------------------------------- */

test("sem messaging.write: 403 em toda ação de modelo, sem tocar no banco", async () => {
  const db = usar(bancoEmMemoria());
  estado.negar = true;

  for (const chamada of [
    () => actions.saveTemplate(doRascunho()),
    () => actions.saveTemplateFromNotice({ include: { audience: true, content: true, followUps: false }, name: "X", noticeId: randomUUID() }),
    () => actions.renameTemplate({ expectedUpdatedAt: "2026-10-23T12:00:00.000Z", id: randomUUID(), name: "X" }),
    () => actions.duplicateTemplate({ id: randomUUID() }),
    () => actions.deleteTemplate({ id: randomUUID() }),
    () => actions.loadDesignTemplates({ mode: "custom" })
  ]) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }

  assert.equal(db.calls.length, 0);
  estado.negar = false;
});

test("salvar: cria, grava o tipo, o modo e o payload do construtor; atualizar sem a versão dá 400; a auditoria nunca leva o nome", async () => {
  const db = usar(bancoEmMemoria());
  const criado = await actions.saveTemplate(doRascunho({ name: `  ${NOME}  ` }));
  assert.equal(criado.ok, true, JSON.stringify(criado));
  assert.equal(criado.data.name, NOME);
  assert.equal(criado.data.kind, "inbox");
  assert.equal(criado.data.designMode, null);

  const [linha] = db.tables.communication_templates;
  assert.equal(linha.created_by, EU);
  assert.deepEqual(linha.payload, model.templatePayloadSchema.parse(model.templatePayloadOfDraft({ draft: model.templateDraftInputSchema.parse(rascunho()), followUps: null, include: { audience: true, content: true, followUps: true } }).payload));

  const semVersao = await actions.saveTemplate(doRascunho({ id: linha.id }));
  assert.deepEqual([semVersao.status, semVersao.fieldErrors], [400, { expectedUpdatedAt: ["Recarregue a página e tente de novo."] }]);

  const [auditoria] = audits(db, "communication.template_saved");
  assert.equal(auditoria.entity_type, "communication_template");
  assert.equal(auditoria.entity_id, linha.id);
  assert.deepEqual(auditoria.metadata, {
    created: true,
    design_mode: null,
    follow_ups: 0,
    kind: "inbox",
    origin: "notice_editor",
    source_campaign_id: null,
    source_template_ids: [],
    with_audience: true,
    with_content: true
  });

  // Renomear, duplicar e excluir tambem nunca gravam o nome.
  const renomeado = await actions.renameTemplate({ expectedUpdatedAt: criado.data.updatedAt, id: linha.id, name: `${NOME} 2` });
  assert.equal(renomeado.ok, true);
  const copia = await actions.duplicateTemplate({ id: linha.id });
  assert.equal(copia.ok, true);
  assert.equal(copia.data.name, `${NOME} 2 (cópia)`);
  assert.equal((await actions.deleteTemplate({ id: copia.data.id })).ok, true);
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /Lançamento/);
  assert.deepEqual(db.tables.admin_audit_log.map((row) => row.action), [
    "communication.template_saved",
    "communication.template_renamed",
    "communication.template_duplicated",
    "communication.template_deleted"
  ]);
});

test("o 201º modelo dá 422 pelas três criações (salvar sem id, a partir do aviso e duplicar)", async () => {
  const cheios = Array.from({ length: model.TEMPLATE_LIMITS.maxTemplates }, () => linhaDeModelo(payloadDeNotificacao()));
  const aviso = { audience: { kind: "everyone" }, created_by: EU, deleted_at: null, flow_id: null, id: randomUUID(), kind: "inbox" };
  const db = usar(bancoEmMemoria({ campaigns: [aviso], communication_templates: cheios }));

  for (const result of [
    await actions.saveTemplate(doRascunho()),
    await actions.saveTemplateFromNotice({ include: { audience: true, content: true, followUps: false }, name: "X", noticeId: aviso.id }),
    await actions.duplicateTemplate({ id: cheios[0].id })
  ]) {
    assert.deepEqual([result.ok, result.status, result.error], [false, 422, M.limit]);
  }

  assert.equal(db.tables.communication_templates.length, 200);

  // Um excluido libera a vaga.
  db.tables.communication_templates[0].deleted_at = agora();
  assert.equal((await actions.saveTemplate(doRascunho())).ok, true);
});

test("o tipo não muda (400 em kind); o modo do Design também não", async () => {
  const notificacao = linhaDeModelo(payloadDeNotificacao());
  const personalizado = linhaDeModelo(payloadDeDesign("custom"));
  const db = usar(bancoEmMemoria({ communication_templates: [notificacao, personalizado] }));

  const comoPopup = await actions.saveTemplate({
    ...doRascunho({ expectedUpdatedAt: notificacao.updated_at, id: notificacao.id }),
    body: { draft: rascunho("popup"), followUps: null, include: { audience: true, content: true, followUps: false }, source: "notice" }
  });
  assert.deepEqual([comoPopup.status, comoPopup.fieldErrors], [400, { kind: [M.kindFixed] }]);

  const comoDesign = await actions.saveTemplate(doDesign(custom.popupStarterDesign("text_only"), null, { expectedUpdatedAt: notificacao.updated_at, id: notificacao.id }));
  assert.deepEqual([comoDesign.status, comoDesign.fieldErrors], [400, { kind: [M.kindFixed] }]);

  const livre = await actions.saveTemplate(doDesign(null, freeStarters.freeStarterDesign("blank"), { expectedUpdatedAt: personalizado.updated_at, id: personalizado.id }));
  assert.deepEqual([livre.status, livre.fieldErrors], [400, { kind: [M.kindFixed] }]);
  assert.equal(db.tables.communication_templates.find((row) => row.id === personalizado.id).design_mode, "custom");

  // O mesmo modo grava.
  const mesmo = await actions.saveTemplate(doDesign(custom.popupStarterDesign("media_overlay"), null, { expectedUpdatedAt: personalizado.updated_at, id: personalizado.id }));
  assert.equal(mesmo.ok, true, JSON.stringify(mesmo));

  // Versao velha: 409.
  const velha = await actions.saveTemplate(doDesign(custom.popupStarterDesign("text_only"), null, { expectedUpdatedAt: personalizado.updated_at, id: personalizado.id }));
  assert.deepEqual([velha.status, velha.error], [409, M.changed]);
});

test("a auditoria só leva os modelos encontrados; 20 ids com repetidos passam, 21 dão 400", async () => {
  const fonte = linhaDeModelo(payloadDeDesign("custom"));
  const excluidoHaPouco = linhaDeModelo(payloadDeDesign("custom"), { deleted_at: new Date(Date.now() - 10 * 86_400_000).toISOString() });
  const excluidoHaMuito = linhaDeModelo(payloadDeDesign("custom"), { deleted_at: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  const db = usar(bancoEmMemoria({ communication_templates: [fonte, excluidoHaPouco, excluidoHaMuito] }));
  const inexistente = randomUUID();

  const salvo = await actions.saveTemplate(
    doDesign(custom.popupStarterDesign("text_only"), null, { sourceTemplateIds: [fonte.id, inexistente, excluidoHaPouco.id, excluidoHaMuito.id, fonte.id.toUpperCase()] })
  );
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const [auditoria] = audits(db, "communication.template_saved");
  assert.deepEqual([...auditoria.metadata.source_template_ids].sort(), [fonte.id, excluidoHaPouco.id].sort(), "só os encontrados (o excluído há 40 dias não conta)");
  assert.equal(auditoria.metadata.design_mode, "custom");
  assert.equal(auditoria.metadata.origin, "design_card");

  const vinte = [...Array.from({ length: 19 }, () => randomUUID()), fonte.id];
  assert.equal((await actions.saveTemplate(doDesign(custom.popupStarterDesign("text_only"), null, { sourceTemplateIds: [...vinte.slice(0, 19), vinte[0]] }))).ok, true);
  assert.equal((await actions.saveTemplate(doDesign(custom.popupStarterDesign("text_only"), null, { sourceTemplateIds: vinte }))).ok, true);

  const vinteEUm = await actions.saveTemplate(doDesign(custom.popupStarterDesign("text_only"), null, { sourceTemplateIds: [...vinte, randomUUID()] }));
  assert.deepEqual([vinteEUm.status, Object.keys(vinteEUm.fieldErrors)], [400, ["sourceTemplateIds"]]);
});

test("nenhuma ação de modelo chama revalidatePath (D28)", async () => {
  const linha = linhaDeModelo(payloadDeDesign("free"));
  usar(bancoEmMemoria({ communication_templates: [linha] }));
  estado.revalidados.length = 0;

  assert.equal((await actions.saveTemplate(doRascunho())).ok, true);
  assert.equal((await actions.saveTemplate(doDesign(null, freeStarters.freeStarterDesign("blank"), { expectedUpdatedAt: linha.updated_at, id: linha.id }))).ok, true);
  const atual = actionStubs.db.tables.communication_templates.find((row) => row.id === linha.id);
  assert.equal((await actions.renameTemplate({ expectedUpdatedAt: atual.updated_at, id: linha.id, name: "Outro" })).ok, true);
  assert.equal((await actions.duplicateTemplate({ id: linha.id })).ok, true);
  assert.equal((await actions.loadDesignTemplates({ mode: "free" })).ok, true);
  assert.equal((await actions.deleteTemplate({ id: linha.id })).ok, true);
  assert.deepEqual(estado.revalidados, []);
});

test("a partir do aviso: pop-up com design gravado ilegível dá 409 designUnreadable e não grava; passo de fluxo dá 409; aviso que não existe dá 404", async () => {
  const quebrado = { ...popupRow(), popup_design: { blocks: "não é um design" } };
  const passo = { ...popupRow(), flow_id: randomUUID() };
  const db = usar(bancoEmMemoria({ campaigns: [quebrado, passo] }));
  const include = { audience: true, content: false, followUps: false };

  const ilegivel = await actions.saveTemplateFromNotice({ include, name: "Pop", noticeId: quebrado.id });
  assert.deepEqual([ilegivel.status, ilegivel.error], [409, M.designUnreadable]);
  assert.equal(db.tables.communication_templates.length, 0);

  const doFluxo = await actions.saveTemplateFromNotice({ include, name: "Pop", noticeId: passo.id });
  assert.deepEqual([doFluxo.status, doFluxo.error], [409, M.flowStep]);

  const sumiu = await actions.saveTemplateFromNotice({ include, name: "Pop", noticeId: randomUUID() });
  assert.equal(sumiu.status, 404);
});

/** Linha de campaigns de um pop-up Padrao (o que rowToDraft le). */
function popupRow() {
  const columns = {
    allow_hide: true,
    allow_snooze: true,
    approved_at: null,
    approved_by: null,
    audience: { kind: "everyone" },
    audience_count: null,
    audience_counted_at: null,
    audio_duration_seconds: null,
    audio_mime: null,
    audio_peaks: null,
    audio_url: null,
    body: "",
    created_at: agora(),
    created_by: EU,
    cta_display: null,
    cta_href: null,
    cta_label: null,
    cta_target: null,
    deleted_at: null,
    ends_at: null,
    flow_id: null,
    flow_node_id: null,
    icon_color: null,
    icon_id: null,
    id: randomUUID(),
    image_alt: null,
    image_url: null,
    kind: "popup",
    popup_design: null,
    send_at: null,
    sender_user_id: null,
    starts_at: null,
    status: "draft",
    title: "Pop",
    updated_at: agora()
  };

  return columns;
}

test("Meus modelos: filtra pelo modo, corta em 50, deixa de fora o que não abre e traz o total", async () => {
  const livres = Array.from({ length: 55 }, (_, index) => linhaDeModelo(payloadDeDesign("free"), { name: `Livre ${index}` }));
  const personalizados = Array.from({ length: 3 }, () => linhaDeModelo(payloadDeDesign("custom")));
  const quebrado = linhaDeModelo(payloadDeDesign("custom"), { payload: { ...payloadDeDesign("custom"), design: { lixo: true } }, updated_at: "2099-01-01T00:00:00.000Z" });
  const excluido = linhaDeModelo(payloadDeDesign("custom"), { deleted_at: agora() });
  usar(bancoEmMemoria({ communication_templates: [...livres, ...personalizados, quebrado, excluido, linhaDeModelo(payloadDeNotificacao())] }));

  const livre = await actions.loadDesignTemplates({ mode: "free" });
  assert.equal(livre.ok, true);
  assert.equal(livre.data.items.length, 50);
  assert.equal(livre.data.total, 55);
  assert.ok(livre.data.items.every((item) => item.mode === "free" && item.design.mode === "free"));
  assert.deepEqual(livre.data.fonts, []);

  const meus = await actions.loadDesignTemplates({ mode: "custom" });
  assert.equal(meus.data.items.length, 3, "o que não abre fica de fora");
  assert.equal(meus.data.total, 4);
  assert.deepEqual(Object.keys(meus.data.items[0]).sort(), ["design", "id", "mode", "name", "support", "updatedAt"]);

  const errado = await actions.loadDesignTemplates({ mode: "outro" });
  assert.deepEqual([errado.status, errado.fieldErrors], [400, { mode: ["Modo inválido."] }]);
});

test("Meus modelos sem a migração dos modelos (tabela ausente, na lista ou na contagem): lista vazia, sem erro; qualquer outro erro continua dando erro", async () => {
  const ausentes = [
    { code: "PGRST205", message: "Could not find the table 'public.communication_templates' in the schema cache" },
    { code: "42P01", message: 'relation "public.communication_templates" does not exist' }
  ];
  // Em qual leitura o erro aparece: nas duas, so na lista (a contagem e um HEAD) ou so na contagem.
  const onde = { ambas: () => true, contagem: (query) => query.head, lista: (query) => !query.head };

  for (const erro of ausentes) {
    for (const [nome, filtro] of Object.entries(onde)) {
      usar(bancoEmMemoria({}, { communication_templates: (query) => (filtro(query) ? erro : null) }));

      for (const mode of ["custom", "free"]) {
        const result = await actions.loadDesignTemplates({ mode });
        assert.deepEqual(result, { data: { fonts: [], items: [], total: 0 }, ok: true }, `${erro.code} em ${nome} (${mode})`);
      }
    }
  }

  // A regra estreita de sempre (isMissingTemplatesTable): coluna que falta, outra tabela ou falha de conexao nao sao
  // "nenhum modelo" e continuam dando erro.
  const outros = [
    { code: "42703", message: "column communication_templates.payload does not exist" },
    { code: "PGRST204", message: "Could not find the 'payload' column of 'communication_templates' in the schema cache" },
    { code: "PGRST205", message: "Could not find the table 'public.outra_tabela' in the schema cache" },
    { code: null, message: "connection failure" }
  ];
  const silencio = console.error;
  console.error = () => {};

  try {
    for (const erro of outros) {
      for (const [nome, filtro] of Object.entries(onde)) {
        usar(bancoEmMemoria({}, { communication_templates: (query) => (filtro(query) ? erro : null) }));
        const result = await actions.loadDesignTemplates({ mode: "custom" });
        assert.equal(result.ok, false, `${erro.message} em ${nome}`);
      }
    }
  } finally {
    console.error = silencio;
  }
});

/* ------------------------------------------------------------------------------------------------
 * design-checks: a decisao de apagar o video recusado no fim do envio (D16)
 * ---------------------------------------------------------------------------------------------- */

test("mayRemoveRefusedVideo: só o envio novo de verdade (menos de 1 hora e sem uso) sai; tabela de modelos ausente conta como nenhum modelo; outro erro rejeita", async () => {
  const VIDEO = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
  const agoraMesmo = new Date("2026-10-23T12:00:00.000Z");
  const haMinutos = new Date(agoraMesmo.getTime() - 10 * 60_000).toISOString();
  const haDuasHoras = new Date(agoraMesmo.getTime() - 2 * 3_600_000).toISOString();
  const comVideo = custom.popupStarterDesign("media_top_fade", { video: { mimeType: "video/mp4", path: VIDEO, url: `https://x.supabase.co/storage/v1/object/public/communication-popup-video/${VIDEO}` } });
  const livreComVideo = { ...freeStarters.freeStarterDesign("blank"), assets: [{ id: "v", kind: "video", mimeType: "video/mp4", path: VIDEO }] };

  const vazio = bancoEmMemoria();
  assert.equal(await checks.mayRemoveRefusedVideo(vazio, VIDEO, haDuasHoras, agoraMesmo), false, "criado há 2 horas");
  assert.equal(await checks.mayRemoveRefusedVideo(vazio, VIDEO, null, agoraMesmo), false, "sem data");
  assert.equal(await checks.mayRemoveRefusedVideo(vazio, VIDEO, "lixo", agoraMesmo), false, "data ilegível");
  assert.equal(await checks.mayRemoveRefusedVideo(vazio, VIDEO, haMinutos, agoraMesmo), true, "recente e sem uso");
  assert.equal(vazio.calls.length, 4, "as quatro leituras (avisos e modelos, Personalizado e Livre) só no caso recente");

  const avisoCita = bancoEmMemoria({ campaigns: [{ deleted_at: null, id: "a", popup_design: comVideo }] });
  assert.equal(await checks.mayRemoveRefusedVideo(avisoCita, VIDEO, haMinutos, agoraMesmo), false, "citado por um aviso");
  const livreCita = bancoEmMemoria({ campaigns: [{ deleted_at: null, id: "a", popup_design: livreComVideo }] });
  assert.equal(await checks.mayRemoveRefusedVideo(livreCita, VIDEO, haMinutos, agoraMesmo), false, "citado por um aviso Livre");
  const avisoExcluido = bancoEmMemoria({ campaigns: [{ deleted_at: agora(), id: "a", popup_design: comVideo }] });
  assert.equal(await checks.mayRemoveRefusedVideo(avisoExcluido, VIDEO, haMinutos, agoraMesmo), true, "aviso excluído não segura");

  const modeloCita = bancoEmMemoria({ communication_templates: [linhaDeModelo({ ...payloadDeDesign("custom"), design: comVideo })] });
  assert.equal(await checks.mayRemoveRefusedVideo(modeloCita, VIDEO, haMinutos, agoraMesmo), false, "citado por um modelo");
  const modeloLivre = bancoEmMemoria({ communication_templates: [linhaDeModelo({ ...payloadDeDesign("free"), design: livreComVideo })] });
  assert.equal(await checks.mayRemoveRefusedVideo(modeloLivre, VIDEO, haMinutos, agoraMesmo), false, "citado por um modelo Livre");

  const semTabela = bancoEmMemoria({}, { communication_templates: { code: "PGRST205", message: "Could not find the table 'public.communication_templates' in the schema cache" } });
  assert.equal(await checks.mayRemoveRefusedVideo(semTabela, VIDEO, haMinutos, agoraMesmo), true, "tabela de modelos ausente = nenhum modelo");

  for (const erro of [
    { code: "42703", message: "column communication_templates.payload does not exist" },
    { code: null, message: "connection failure" }
  ]) {
    await assert.rejects(checks.mayRemoveRefusedVideo(bancoEmMemoria({}, { communication_templates: erro }), VIDEO, haMinutos, agoraMesmo), undefined, erro.message);
  }

  await assert.rejects(checks.mayRemoveRefusedVideo(bancoEmMemoria({}, { campaigns: { code: "PGRST205", message: "Could not find the table 'public.campaigns'" } }), VIDEO, haMinutos, agoraMesmo));
});
