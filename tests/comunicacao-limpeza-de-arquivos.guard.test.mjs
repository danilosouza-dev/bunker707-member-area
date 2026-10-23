import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Guarda da limpeza automatica dos arquivos da Comunicacao (docs/22 §4.6; docs/18 §1.2): o que se le no codigo.
// - nenhum campo de arquivo fica de fora: uma amostra COMPLETA de cada design (valida no schema estrito) e
//   varrida inteira atras de tudo que aponta para o nosso Storage, e tem que dar exatamente o que as funcoes de
//   media-refs.ts devolvem; o schema e os tipos dos designs tem a contagem de campos de arquivo conferida (campo
//   novo = esta guarda falha e lembra de ler o campo em media-refs.ts e por na amostra);
// - colunas de campaigns e tipos de notificacao: cada um decidido (guarda arquivo ou nao);
// - todo envio com nome pelo conteudo confere a marca ANTES de enviar (o prazo recomeca e uma remocao em andamento
//   termina primeiro; depois disso "ja existe" vale como enviado);
// - a 202610240001 passa pelo MCP numa secao so, sem drop, delete ou funcao, RLS sem politica, e nao cita a
//   coluna do design (a guarda do Livre proibe);
// - o job fica por ultimo no registro do tick.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
/** Sem comentarios: o que sobra e o codigo. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const refs = await import("../src/server/communications/media-refs.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const customSchema = await import("../src/server/communications/popup-design-schema.ts");
const freeSchema = await import("../src/server/communications/popup-free-schema.ts");
const freeStarters = await import("../src/server/communications/popup-free-starters.ts");

const ORIGEM = "https://abcdefgh.supabase.co";
const HEX = "0123456789abcdef01234567";
const HEX2 = "89abcdef0123456789abcdef";
const VIDEO = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const FONTE = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";
const publico = (bucket, path) => `${ORIGEM}/storage/v1/object/public/${bucket}/${path}`;
const chaves = (lista) => [...new Set(lista.map(refs.mediaKey))].sort();

/** Personalizado com todo campo que pode ter arquivo preenchido: video, imagem no fundo do cartao e todos os blocos. */
function personalizadoCompleto() {
  const design = custom.popupStarterDesign("media_top_fade", { hasAudio: true, video: { mimeType: "video/mp4", path: VIDEO, url: publico("communication-popup-video", VIDEO) } });
  const botao = design.blocks.find((block) => block.type === "button");

  design.blocks.push(
    { action: { href: "https://exemplo.com/depois", kind: "link", target: "new_tab" }, id: "b7", label: "Depois", style: botao.style, type: "button2" },
    { height: 16, id: "b8", type: "spacer" }
  );
  design.card.background = { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: publico("content-assets", `communications/images/${HEX}.webp`) };
  design.blocks[1].style.font = { id: FONTE, kind: "uploaded" };
  design.fonts = [FONTE];

  return design;
}

/** Livre com todo tipo de elemento e todo lugar de arquivo: fundo da prancheta, imagem, video com capa, forma com imagem. */
function livreCompleto() {
  return {
    artboard: { fill: [{ asset: "fundo", fit: "cover", focus: [50, 50], kind: "image" }, { color: "#111216", kind: "solid" }], width: 440 },
    assets: [
      { height: 90, id: "capa", kind: "image", path: `communications/images/${HEX}.webp`, width: 160 },
      { height: 48, id: "img", kind: "image", path: `communications/free/${HEX2}.webp`, width: 64 },
      { height: 300, id: "fundo", kind: "image", path: `communications/free/${"a".repeat(24)}.webp`, width: 400 },
      { id: "v", kind: "video", mimeType: "video/webm", path: "videos/1c8d8f4f-3e2b-4d66-8b5f-6a2a8c3d0e21.webm", poster: "capa" }
    ],
    children: [
      { asset: "v", id: "midia", type: "video" },
      { alt: "Foto", asset: "img", id: "foto", type: "image" },
      { box: { fill: [{ asset: "img", kind: "image" }] }, id: "forma", type: "shape" },
      { id: "titulo", lines: [[{ style: { font: { id: FONTE, kind: "uploaded" } }, text: "Oi" }]], type: "heading" },
      { id: "texto", lines: [[{ text: "Texto" }]], type: "text" },
      { id: "selo", label: "Novo", type: "badge" },
      { action: { href: "https://exemplo.com", kind: "link", target: "new_tab" }, id: "botao", label: "Ver", type: "button" },
      { icon: "star", id: "icone", type: "icon" },
      { id: "linha", type: "divider" },
      { id: "espaco", type: "spacer" },
      { id: "som", type: "audio" },
      { children: [{ id: "texto2", lines: [[{ text: "Dentro" }]], type: "text" }], id: "caixa", type: "box" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
}

const LEMBRETE = "campo de arquivo novo no design: leia-o em media-refs.ts (customDesignMediaRefs/freeDesignMediaRefs), ponha-o na amostra desta guarda e atualize a contagem";

test("amostras completas: tudo que aponta para o nosso Storage e exatamente o que as funcoes devolvem", () => {
  const personalizado = customSchema.parsePopupDesign(personalizadoCompleto());
  assert.ok(personalizado, "a amostra do Personalizado vale no schema estrito");
  assert.deepEqual(
    [...new Set(personalizado.blocks.map((block) => block.type))].sort(),
    [...custom.POPUP_BLOCK_TYPES].sort(),
    "a amostra tem todo tipo de bloco"
  );
  assert.deepEqual(chaves(refs.popupDesignMediaRefs(personalizado)), chaves(refs.mediaRefsInJson(personalizado)), LEMBRETE);
  assert.equal(refs.popupDesignMediaRefs(personalizado).length >= 2, true);

  const parsed = freeSchema.popupFreeDesignSchema.safeParse(livreCompleto());
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  const livre = parsed.data;
  assert.ok(livre.assets.length === 4, "nenhum arquivo da amostra sumiu na forma canonica");
  assert.deepEqual(chaves(refs.popupDesignMediaRefs(livre)), chaves(refs.mediaRefsInJson(livre)), LEMBRETE);

  // Os modelos para comecar tambem: o que eles citam do Storage, as funcoes leem.
  for (const starter of custom.POPUP_DESIGN_STARTERS) {
    const design = custom.popupStarterDesign(starter.id, { video: { mimeType: "video/mp4", path: VIDEO, url: publico("communication-popup-video", VIDEO) } });
    assert.deepEqual(chaves(refs.popupDesignMediaRefs(design)), chaves(refs.mediaRefsInJson(design)), `modelo ${starter.id}`);
  }

  for (const starter of freeStarters.FREE_DESIGN_STARTERS) {
    const design = freeStarters.freeStarterDesign(starter.id);
    assert.deepEqual(chaves(refs.popupDesignMediaRefs(design)), chaves(refs.mediaRefsInJson(design)), `modelo Livre ${starter.id}`);
  }
});

test("a amostra do Livre cobre todo tipo de elemento", () => {
  const parsed = freeSchema.popupFreeDesignSchema.parse(livreCompleto());
  const tipos = new Set();
  const visitar = (nodes) => nodes.forEach((node) => (tipos.add(node.type), node.children && visitar(node.children)));
  visitar(parsed.children);

  const model = read("src/server/communications/popup-free-model.ts");
  const lista = /export const FREE_NODE_TYPES = \[([^\]]+)\]/.exec(model)?.[1] ?? "";
  const todos = [...lista.matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();

  assert.ok(todos.length >= 13);
  assert.deepEqual([...tipos].sort(), todos, "elemento novo no Livre: ponha na amostra (e, se tiver arquivo, leia em freeDesignMediaRefs)");
});

/** Usos de cada validador de arquivo no codigo (sem os imports). */
function usos(source, nomes) {
  const code = codeOf(source).replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "");

  return Object.fromEntries(nomes.map((nome) => [nome, (code.match(new RegExp(`\\b${nome}\\b`, "g")) ?? []).length]));
}

test("schema dos designs: os campos de arquivo de hoje (contagem dos validadores do nosso Storage)", () => {
  assert.deepEqual(
    usos(read("src/server/communications/popup-design-schema.ts"), ["POPUP_VIDEO_PATH_PATTERN", "isOwnStorageUrl", "isOwnPopupCardImageUrl", "popupCardImagePathOf", "FREE_IMAGE_PATH_PATTERN"]),
    { FREE_IMAGE_PATH_PATTERN: 0, isOwnPopupCardImageUrl: 1, isOwnStorageUrl: 1, popupCardImagePathOf: 0, POPUP_VIDEO_PATH_PATTERN: 1 },
    LEMBRETE
  );
  assert.deepEqual(
    usos(read("src/server/communications/popup-free-schema.ts"), ["POPUP_VIDEO_PATH_PATTERN", "FREE_IMAGE_PATH_PATTERN", "isOwnStorageUrl", "isOwnPopupCardImageUrl", "popupCardImagePathOf"]),
    { FREE_IMAGE_PATH_PATTERN: 1, isOwnPopupCardImageUrl: 0, isOwnStorageUrl: 0, popupCardImagePathOf: 0, POPUP_VIDEO_PATH_PATTERN: 1 },
    LEMBRETE
  );
});

/** Propriedades com cara de arquivo (path, url, ...Path, ...Url) declaradas em cada `export type` do arquivo. */
function camposDeArquivo(source) {
  const campos = [];
  let tipo = null;

  for (const line of codeOf(source).split("\n")) {
    const inicio = /^export type (\w+)/.exec(line);

    if (inicio) {
      tipo = inicio[1];
    } else if (/^(?:export )?(?:function|const|async function)\b/.test(line)) {
      tipo = null;
    }

    if (tipo) {
      for (const match of line.matchAll(/\b(\w*(?:[pP]ath|[uU]rl|[sS]rc|[fF]ile))\??:\s/g)) {
        campos.push(`${tipo}.${match[1]}`);
      }
    }
  }

  return campos.sort();
}

test("tipos dos designs: os campos de arquivo de hoje", () => {
  assert.deepEqual(
    camposDeArquivo(read("src/server/communications/popup-design-model.ts")),
    // PopupFontFace.url sai da biblioteca na hora (nunca gravado); o ticket e do envio (nunca gravado).
    ["PopupCardImage.url", "PopupFontFace.url", "PopupVideo.path", "PopupVideo.url", "PopupVideoUploadTicket.path", "PopupVideoUploadTicket.signedUrl"],
    LEMBRETE
  );
  assert.deepEqual(camposDeArquivo(read("src/server/communications/popup-free-model.ts")), ["FreeImageAsset.path", "FreeVideoAsset.path"], LEMBRETE);
});

test("colunas de campaigns e tipos de notificacao: cada um decidido", () => {
  const store = read("src/server/communications/store.ts");
  const colunas = (/const CAMPAIGN_COLUMNS =\s*"([^"]+)"/.exec(store)?.[1] ?? "").split(",");
  assert.ok(colunas.length > 40, "lista de colunas lida");

  const comCaraDeArquivo = colunas.filter((coluna) => /url|path|image|audio|video|media|design|file|font|asset|poster|attachment/.test(coluna)).sort();
  assert.deepEqual(
    comCaraDeArquivo,
    ["audio_duration_seconds", "audio_mime", "audio_peaks", "audio_url", "image_alt", "image_url", "popup_design"],
    "coluna nova com arquivo em campaigns: ponha em CAMPAIGN_MEDIA_COLUMNS (media-refs.ts) e leia em campaignMediaRefs"
  );
  assert.deepEqual([...refs.CAMPAIGN_MEDIA_COLUMNS].sort(), ["audio_url", "image_url", "popup_design"]);
  assert.match(read("src/server/communications/media-cleanup.ts"), /select\(\["id", \.\.\.CAMPAIGN_MEDIA_COLUMNS\]\.join\(","\)\)/);

  const tipo = /export type NotificationInsert = \{[\s\S]*?\bkind: ([^;]+);/.exec(store)?.[1] ?? "";
  const tiposDoApp = [...tipo.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
  const decididos = [...refs.NOTIFICATION_KINDS_WITHOUT_MEDIA, ...refs.NOTIFICATION_KINDS_WITH_MEDIA].sort();
  assert.deepEqual(tiposDoApp, decididos, "tipo novo de notificacao: decida se o payload guarda arquivo (NOTIFICATION_KINDS_* em media-refs.ts)");

  const v1 = read("supabase/migrations/202610200001_communication_v1.sql");
  const banco = /create table if not exists public\.notifications \([\s\S]*?kind text not null check \(kind in \(([^)]+)\)\)/.exec(v1)?.[1] ?? "";
  assert.deepEqual([...banco.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort(), decididos);
});

test("todo envio com nome pelo conteudo confere a marca ANTES de enviar (nada enviado some na remocao em andamento)", () => {
  /** O trecho da funcao `name` ate a proxima funcao exportada. */
  const bodyOf = (file, name) => {
    const code = codeOf(read(file));
    const start = code.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${file}: ${name}`);
    const end = code.indexOf("\nexport ", start + 1);
    return code.slice(start, end === -1 ? undefined : end);
  };

  // Audio e fonte: a conferencia vem antes do upload ao Storage.
  for (const [file, name] of [
    ["src/server/communications/media.ts", "persistNoticeAudio"],
    ["src/server/communications/popup-media.ts", "persistPopupFont"]
  ]) {
    const body = bodyOf(file, name);
    const forget = body.indexOf("await forgetOrphanMark(");
    assert.ok(forget > 0 && forget < body.indexOf(".upload("), `${file}: ${name} confere a marca antes do upload`);
  }

  // Imagens do aviso e do Livre: a conferencia vai como beforeUpload do persistImageAsset, que roda antes do upload.
  for (const [file, name, folder] of [
    ["src/server/communications/actions.ts", "uploadNoticeImage", "communications/images"],
    ["src/server/communications/popup-free-actions.ts", "uploadPopupFreeImage", "communications/free"]
  ]) {
    const body = bodyOf(file, name);
    assert.match(body, new RegExp(`persistImageAsset\\(data\\.image, "${folder}", \\{ beforeUpload: \\(object\\) => forgetOrphanMark\\(communicationsDb\\(\\), object\\) \\}\\)`), `${file}: ${name}`);
  }

  const assets = bodyOf("src/server/db/media-assets.ts", "persistImageAsset");
  const hook = assets.indexOf("await options.beforeUpload?.(");
  assert.ok(hook > 0 && hook < assets.indexOf(".upload("), "persistImageAsset roda o beforeUpload antes do upload");
});

test("a rodada so tira a marca depois de apagar do Storage; desmarcar nunca mexe na reservada", () => {
  const code = codeOf(read("src/server/communications/media-cleanup.ts"));
  const run = code.slice(code.indexOf("export async function runMediaCleanup("));
  const claim = run.indexOf('.update({ claimed_at: claimToken })');
  const remove = run.indexOf(".remove(claimed)");
  const finish = run.indexOf("await endClaims(db, bucket, claimed, claimToken, true)");

  assert.ok(claim > 0 && claim < remove && remove < finish, "reserva, remocao e so entao a linha sai");
  assert.doesNotMatch(run, /\.delete\(\)/, "a rodada nao apaga marca direto: so por deleteMarks (livres) e endClaims (a propria reserva)");
  assert.match(code, /async function deleteMarks[\s\S]*?\.is\("claimed_at", null\)/);
  assert.match(code, /async function endClaims[\s\S]*?\.eq\("claimed_at", claimToken\)/);
  assert.doesNotMatch(code, /insertMarks\(db, claimed\)/, "falha nunca recria a marca com a data antiga (a linha so e solta)");
});

test("a 202610240001 passa pelo MCP numa secao so: tabela pequena, RLS sem politica, nada de drop, delete ou funcao", () => {
  const migration = read("supabase/migrations/202610240001_communication_media_cleanup.sql");
  const code = sqlCodeOf(migration);

  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "nada de delete from (o grant de delete e so o privilegio do service_role)");
  assert.doesNotMatch(code, /\btrigger\b/i);
  assert.doesNotMatch(code, /\bfunction\b/i);
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /storage\.objects/i, "o Storage so e apagado pela API, nunca por SQL");
  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 1, "uma secao, marcada MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.match(code, /create table if not exists public\.communication_media_orphans \(/);
  assert.match(code, /primary key \(bucket, path\)/);
  assert.match(code, /first_orphan_at timestamptz not null default now\(\)/);
  assert.match(code, /^  claimed_at timestamptz,$/m);
  assert.match(code, /alter table public\.communication_media_orphans add column if not exists claimed_at timestamptz;/);
  assert.match(code, /alter table public\.communication_media_orphans enable row level security;/);
  assert.match(code, /revoke all on public\.communication_media_orphans from anon, authenticated;/);
  assert.match(code, /grant select, insert, update, delete on public\.communication_media_orphans to service_role;/);
  assert.match(code, /create index if not exists communication_media_orphans_first_orphan_idx/);

  // Os buckets do check sao os dos lugares da limpeza; no bucket das capas, so communications/.
  const buckets = /check \(bucket in \(([^)]+)\)\)/.exec(code)?.[1] ?? "";
  assert.deepEqual(
    [...buckets.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort(),
    [...new Set(refs.COMMUNICATION_MEDIA_LOCATIONS.map((location) => location.bucket))].sort()
  );
  assert.match(code, /check \(bucket <> 'content-assets' or path like 'communications\/%'\)/);
  for (const location of refs.COMMUNICATION_MEDIA_LOCATIONS.filter((item) => item.bucket === "content-assets")) {
    assert.ok(location.prefix.startsWith("communications/"), location.prefix);
  }
});

test("o job fica por ultimo no registro do tick e so registra contagens", () => {
  const registry = read("src/server/jobs/registry.ts");
  assert.match(registry, /export const jobRegistry: readonly Job\[\] = \[[^\]]*, communicationMediaJob\];/);

  const job = codeOf(read("src/server/jobs/communication-media-job.ts"));
  const logs = [...job.matchAll(/console\.(?:info|error)\(([\s\S]*?)\);/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(logs, /\.path\b|bucket|title|email|user/i, "log so com numeros");
});
