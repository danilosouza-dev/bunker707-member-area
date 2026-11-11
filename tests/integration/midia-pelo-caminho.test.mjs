import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";

// A conversao dos enderecos que ja estao no banco (supabase/dados/202611120001_midia_pelo_caminho.sql; docs/32 §11.5)
// contra um Postgres de verdade, com o esquema das migracoes, numa transacao que volta no fim (nada fica no banco):
// - previa: so le; mostra o que converte, o da nossa origem sem arquivo, as outras origens e o que ja esta pelo caminho;
// - converter: o endereco inteiro da nossa origem com o arquivo no Storage vira o caminho, em texto e dentro dos JSON
//   (a query da imagem transformada fica); outra origem (mesmo com o arquivo aqui), arquivo que nao existe, endereco
//   assinado, terceiro, texto que so cita o endereco e coluna fora da lista ficam; updated_at nao muda e os gatilhos
//   voltam ligados;
// - de novo: nada muda (nunca converte duas vezes); em lotes: uma linha por coluna por rodada;
// - reverter: o caminho volta a ser o endereco inteiro na base dada (inclusive o que ja vinha pelo caminho);
// - parametros errados param antes de ler qualquer coisa.
// E o transporte do app de verdade (src/server/db/storage-paths.ts) contra o PostgREST local: grava o caminho, le o
// endereco inteiro.
// Onde roda: no CI (e depois de `npm run db:start`), no Supabase local: os arquivos sobem pela API do Storage e o SQL vai
// pelo psql com SUPABASE_DB_URL. Fora dele, MIDIA_TESTE_PSQL com um psql e a conexao (ex.: um Postgres 16 de rascunho
// com as migracoes aplicadas sobre um Supabase de mentira, com auth.users, storage.buckets e storage.objects): os
// arquivos entram direto em storage.objects e a parte do PostgREST e pulada. Sem nenhum dos dois, pula fora do CI e
// falha no CI.

const psqlLocal = process.env.MIDIA_TESTE_PSQL;
const temSupabase = !psqlLocal && Boolean(process.env.SUPABASE_DB_URL && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL));
const skip = psqlLocal || temSupabase || process.env.CI ? false : "sem Postgres: suba o Supabase local (npm run db:start) ou defina MIDIA_TESTE_PSQL";

const SCRIPT = readFileSync(new URL("../../supabase/dados/202611120001_midia_pelo_caminho.sql", import.meta.url), "utf8");
const BASE = temSupabase ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL).replace(/\/+$/, "") : "https://api.escola-de-teste.exemplo";
const OUTRA = "https://outro-projeto.supabase.co";
const hex = () => randomBytes(12).toString("hex");
const ID = hex().slice(0, 8);
const USUARIO = randomUUID();
const VIDEO = `videos/${randomUUID()}.mp4`;

/** Os arquivos que existem aqui (bucket, caminho, tipo) e um que nao existe. */
const ARQUIVOS = {
  audio: { bucket: "communication-audio", path: `campaigns/${hex()}.mp3`, type: "audio/mpeg" },
  aviso: { bucket: "content-assets", path: `communications/images/${hex()}.webp`, type: "image/webp" },
  capa: { bucket: "content-assets", path: `content/midia-teste-${ID}/cover/${hex()}.webp`, type: "image/webp" },
  foto: { bucket: "content-assets", path: `avatars/${USUARIO}/${hex()}.png`, type: "image/png" },
  material: { bucket: "content-assets", path: `materiais/midia-teste-${ID}-apostila.webp`, type: "image/webp" },
  video: { bucket: "communication-popup-video", path: VIDEO, type: "video/mp4" }
};
const SUMIDO = { bucket: "content-assets", path: `content/midia-teste-${ID}/cover/${hex()}.webp` };

const caminho = (arquivo) => `/storage/v1/object/public/${arquivo.bucket}/${arquivo.path}`;
const nosso = (arquivo) => `${BASE}${caminho(arquivo)}`;
const transformada = (arquivo, query) => `${BASE}/storage/v1/render/image/public/${arquivo.bucket}/${arquivo.path}?${query}`;
const deOutra = (arquivo) => `${OUTRA}${caminho(arquivo)}`;
const assinado = (arquivo) => `${BASE}/storage/v1/object/sign/${arquivo.bucket}/${arquivo.path}?token=abc.def.ghi`;
const YOUTUBE = "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg";
const ANTES = "2026-01-01 00:00:00+00";

/** Literal do SQL (texto ou JSON). */
const lit = (valor) => `'${(typeof valor === "string" ? valor : JSON.stringify(valor)).replaceAll("'", "''")}'`;

let db = null;
const enviados = [];

before(async () => {
  if (!temSupabase) return;
  const { createLocalAdminClient, unwrap } = await import("../support/local-db.mjs");
  db = createLocalAdminClient();
  const webp = readFileSync(new URL("../fixtures/popup-livre/capa-de-teste.webp", import.meta.url));
  for (const arquivo of Object.values(ARQUIVOS)) {
    unwrap(await db.storage.from(arquivo.bucket).upload(arquivo.path, webp, { contentType: arquivo.type, upsert: false }), `Enviando ${arquivo.path}`);
    enviados.push(arquivo);
  }
});

after(async () => {
  for (const arquivo of enviados) {
    await db.storage.from(arquivo.bucket).remove([arquivo.path]);
  }
});

/** Um roteiro inteiro numa sessao do psql (saida sem alinhamento, campos com |). */
function psql(texto) {
  const opcoes = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|"];
  const r = psqlLocal
    ? spawnSync("bash", ["-c", `${psqlLocal} ${opcoes.map((o) => `'${o}'`).join(" ")}`], { encoding: "utf8", input: texto })
    : spawnSync("psql", [process.env.SUPABASE_DB_URL, ...opcoes], { encoding: "utf8", input: texto });
  return { saida: r.stdout, erro: r.stderr, status: r.status };
}

/** As linhas que o banco ja tem antes da conversao: o retrato de "antes" do app novo. */
function fixtures() {
  const objetos = psqlLocal
    ? `insert into storage.objects (bucket_id, name) values ${Object.values(ARQUIVOS).map((a) => `(${lit(a.bucket)}, ${lit(a.path)})`).join(", ")};`
    : "";

  return `
${objetos}
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '${USUARIO}', 'authenticated', 'authenticated', 'midia-${ID}@bunker707.test', '', now(), '{}', ${lit({ avatar_url: nosso(ARQUIVOS.foto), full_name: "Midia Teste" })}, now(), now());

insert into public.content_items (id, bucket, kind, title, eyebrow, image, status, instructor, updated_at)
values ('midia-teste-${ID}', 'courses', 'course', 'Curso da midia', 'Curso', ${lit(nosso(ARQUIVOS.capa))}, 'published', ${lit({ avatar: nosso(ARQUIVOS.foto), name: "Ana" })}, ${lit(ANTES)});

insert into public.content_page_settings (content_id, settings, updated_at)
values ('midia-teste-${ID}', ${lit({
    hero: { mediaSrc: transformada(ARQUIVOS.capa, "width=1200&quality=80"), mediaType: "image", poster: deOutra(ARQUIVOS.capa) },
    lista: [nosso(ARQUIVOS.aviso), `Veja ${nosso(ARQUIVOS.aviso)}`, nosso(SUMIDO), YOUTUBE, 7, null, true]
  })}, ${lit(ANTES)});

insert into public.course_modules (id, title, eyebrow, description, image, meta, owner_id, updated_at)
values ('midia-teste-mod-${ID}', 'Modulo', 'Modulo', 'Modulo da midia', ${lit(`${nosso(ARQUIVOS.capa)}?v=2`)}, '1 aula', 'midia-teste-${ID}', ${lit(ANTES)});

insert into public.lessons (id, module_id, title, description, duration, image, video_config, updated_at)
values ('midia-teste-aula-${ID}', 'midia-teste-mod-${ID}', 'Aula', 'Aula da midia', '10 min', ${lit(YOUTUBE)}, ${lit({ provider: "youtube", thumbnail: nosso(ARQUIVOS.capa), url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" })}, ${lit(ANTES)});

insert into public.lesson_materials (lesson_id, title, file_url, updated_at)
values ('midia-teste-aula-${ID}', 'Apostila', ${lit(nosso(ARQUIVOS.material))}, ${lit(ANTES)});

insert into public.lesson_comments (content_id, lesson_id, author_id, author_name, author_username, author_avatar_url, body, updated_at)
values
  ('midia-teste-${ID}', 'midia-teste-aula-${ID}', '${USUARIO}', 'Midia', 'midia', ${lit(nosso(ARQUIVOS.foto))}, ${lit(nosso(ARQUIVOS.foto))}, ${lit(ANTES)}),
  ('midia-teste-${ID}', 'midia-teste-aula-${ID}', '${USUARIO}', 'Midia', 'midia', ${lit(nosso(ARQUIVOS.foto))}, 'Segundo comentario', ${lit(ANTES)});

insert into public.platform_settings (key, value, updated_at)
values ('midia-teste-${ID}', ${lit({
    assinado: assinado(ARQUIVOS.capa),
    branding: { logoImage: nosso(ARQUIVOS.capa), schoolIcon: "/hero/bunker-707-red-front-hero.png" },
    ja: caminho(ARQUIVOS.aviso)
  })}, ${lit(ANTES)});

insert into public.campaigns (id, kind, title, image_url, audio_url, audio_duration_seconds, cta_label, cta_href, cta_target, popup_design, updated_at)
values (
  '${randomUUID()}', 'popup', 'Pop-up da midia ${ID}', ${lit(nosso(ARQUIVOS.aviso))}, ${lit(nosso(ARQUIVOS.audio))}, 5, 'Baixar', ${lit(nosso(ARQUIVOS.material))}, 'new_tab',
  ${lit({ card: { background: { kind: "image", url: nosso(ARQUIVOS.aviso) } }, media: { kind: "video", video: { mimeType: "video/mp4", path: VIDEO, url: nosso(ARQUIVOS.video) } }, version: 1 })},
  ${lit(ANTES)}
);
insert into public.campaigns (kind, title, image_url, updated_at) values ('inbox', 'Aviso da midia de outra origem ${ID}', ${lit(deOutra(ARQUIVOS.aviso))}, ${lit(ANTES)});

insert into public.communication_templates (kind, design_mode, name, payload, updated_at)
values ('design', 'custom', 'Modelo da midia ${ID}', ${lit({ design: { card: { background: { kind: "image", url: nosso(ARQUIVOS.aviso) } } }, kind: "design", version: 1 })}, ${lit(ANTES)});

insert into public.webinars (slug, kind, title, cover_url, updated_at) values ('midia-teste-${ID}', 'live', 'Live da midia', ${lit(nosso(ARQUIVOS.capa))}, ${lit(ANTES)});

insert into public.youtube_course_imports (playlist_id, playlist_url, course_id, last_manifest)
values ('midia-teste-${ID}', 'https://www.youtube.com/playlist?list=PLmidia', 'midia-teste-${ID}', ${lit({ image: nosso(ARQUIVOS.capa) })});
`;
}

/** O que as linhas do teste guardam agora, num JSON so (uma linha que comeca com "estado|"). */
const ESTADO = `
select 'estado|' || jsonb_build_object(
  'avatar', (select avatar_url from public.profiles where id = '${USUARIO}'),
  'campanhas', (select jsonb_agg(jsonb_build_object('audio', audio_url, 'cta', cta_href, 'design', popup_design, 'imagem', image_url, 'updated_at', updated_at) order by kind desc) from public.campaigns where title like '%midia%${ID}'),
  'capa', (select image from public.content_items where id = 'midia-teste-${ID}'),
  'comentarios', (select jsonb_agg(jsonb_build_object('avatar', author_avatar_url, 'body', body, 'updated_at', updated_at) order by body) from public.lesson_comments where lesson_id = 'midia-teste-aula-${ID}'),
  'gatilhos', (select jsonb_object_agg(tgname, tgenabled) from pg_trigger where tgname in ('set_campaigns_updated_at', 'set_content_items_updated_at', 'set_lesson_comments_updated_at', 'set_profiles_updated_at')),
  'instrutor', (select instructor from public.content_items where id = 'midia-teste-${ID}'),
  'live', (select cover_url from public.webinars where slug = 'midia-teste-${ID}'),
  'manifesto', (select last_manifest from public.youtube_course_imports where playlist_id = 'midia-teste-${ID}'),
  'marca', (select value from public.platform_settings where key = 'midia-teste-${ID}'),
  'material', (select file_url from public.lesson_materials where lesson_id = 'midia-teste-aula-${ID}'),
  'modelo', (select payload from public.communication_templates where name = 'Modelo da midia ${ID}'),
  'modulo', (select image from public.course_modules where id = 'midia-teste-mod-${ID}'),
  'aula', (select jsonb_build_object('image', image, 'video', video_config) from public.lessons where id = 'midia-teste-aula-${ID}'),
  'pagina', (select settings from public.content_page_settings where content_id = 'midia-teste-${ID}'),
  'datas', (select jsonb_build_object('linhas', count(*), 'todas_de_antes', bool_and(updated_at = timestamptz ${lit(ANTES)})) from (
    select updated_at from public.content_items where id = 'midia-teste-${ID}'
    union all select updated_at from public.course_modules where id = 'midia-teste-mod-${ID}'
    union all select updated_at from public.lessons where id = 'midia-teste-aula-${ID}'
    union all select updated_at from public.lesson_materials where lesson_id = 'midia-teste-aula-${ID}'
    union all select updated_at from public.lesson_comments where lesson_id = 'midia-teste-aula-${ID}'
    union all select updated_at from public.campaigns where title like '%midia%${ID}'
    union all select updated_at from public.communication_templates where name = 'Modelo da midia ${ID}'
    union all select updated_at from public.webinars where slug = 'midia-teste-${ID}'
    union all select updated_at from public.content_page_settings where content_id = 'midia-teste-${ID}'
    union all select updated_at from public.platform_settings where key = 'midia-teste-${ID}'
  ) d)
)::text;
`;

/** Uma rodada do script com os parametros dados, entre marcas, e o estado depois dela. */
function rodada(nome, parametros) {
  const sets = Object.entries(parametros).map(([chave, valor]) => `set bunker.midia_${chave} = ${lit(valor)};`).join("\n");
  return `select 'rodada|${nome}';\n${sets}\n${SCRIPT}\n${ESTADO}\nreset bunker.midia_modo; reset bunker.midia_origens; reset bunker.midia_base; reset bunker.midia_lote;\n`;
}

/** A saida em rodadas: { nome: { colunas: { "tabela.coluna": {...} }, estado } }. */
function lerSaida(saida) {
  const rodadas = {};
  let atual = null;
  for (const linha of saida.split("\n").filter(Boolean)) {
    const campos = linha.split("|");
    if (campos[0] === "rodada") {
      atual = rodadas[campos[1]] = { colunas: {}, estado: null };
    } else if (campos[0] === "estado") {
      atual.estado = JSON.parse(campos.slice(1).join("|"));
    } else if (campos.length === 7) {
      const [tabela, coluna, linhasMudadas, aConverter, semArquivo, outras, caminhos] = campos;
      atual.colunas[`${tabela}.${coluna}`] = { aConverter: Number(aConverter), caminhos: Number(caminhos), linhasMudadas: Number(linhasMudadas), outras, semArquivo: Number(semArquivo) };
    }
  }
  return rodadas;
}

let rodadas = null;

test("previa, converter, de novo, em lotes e reverter, numa transacao que volta no fim", { skip }, () => {
  const roteiro = [
    "begin;",
    fixtures(),
    "select 'rodada|antes';",
    ESTADO,
    rodada("previa", { origens: `${BASE}/` }),
    rodada("previa-sem-origem", {}),
    rodada("lote", { lote: "1", modo: "converter", origens: BASE }),
    rodada("converter", { modo: "converter", origens: ` ${BASE}/ , https://endereco-antigo.exemplo.com` }),
    rodada("de-novo", { modo: "converter", origens: BASE }),
    rodada("reverter", { base: BASE, modo: "reverter" }),
    "rollback;"
  ].join("\n");
  const r = psql(roteiro);
  assert.equal(r.status, 0, r.erro);
  rodadas = lerSaida(r.saida);
  assert.deepEqual(Object.keys(rodadas), ["antes", "previa", "previa-sem-origem", "lote", "converter", "de-novo", "reverter"]);
});

test("previa: so le; conta o que converte, o da nossa origem sem arquivo, as outras origens e o que ja esta pelo caminho", { skip }, () => {
  const { antes, previa } = rodadas;
  assert.deepEqual(previa.estado, antes.estado, "nada mudou");
  assert.equal(Object.keys(previa.colunas).length, 17, "uma linha por coluna da lista");
  for (const coluna of Object.values(previa.colunas)) assert.equal(coluna.linhasMudadas, 0);

  const pagina = previa.colunas["content_page_settings.settings"];
  assert.ok(pagina.aConverter >= 2, "a imagem transformada e o aviso da lista");
  assert.ok(pagina.semArquivo >= 1, "o arquivo que nao existe aqui");
  assert.match(pagina.outras, new RegExp(`${OUTRA.replaceAll(".", "\\.")} \\(\\d+\\)`), "a outra origem, com a contagem");
  assert.ok(previa.colunas["platform_settings.value"].caminhos >= 1, "o que ja esta pelo caminho");

  const semOrigem = rodadas["previa-sem-origem"].colunas["content_items.image"];
  assert.equal(semOrigem.aConverter, 0, "sem a origem, nada e nosso");
  assert.match(semOrigem.outras, new RegExp(`${BASE.replaceAll(".", "\\.")} \\(\\d+\\)`), "e a previa lista a nossa origem entre as que existem");
});

test("converter: o endereco da nossa origem com o arquivo aqui vira o caminho, em texto e dentro dos JSON; o resto fica", { skip }, () => {
  const { antes, converter } = rodadas;
  const e = converter.estado;

  assert.equal(e.capa, caminho(ARQUIVOS.capa));
  assert.equal(e.modulo, `${caminho(ARQUIVOS.capa)}?v=2`, "a query fica");
  assert.equal(e.avatar, caminho(ARQUIVOS.foto));
  assert.equal(e.material, caminho(ARQUIVOS.material));
  assert.equal(e.live, caminho(ARQUIVOS.capa));
  assert.deepEqual(e.instrutor, { avatar: caminho(ARQUIVOS.foto), name: "Ana" });
  assert.deepEqual(e.manifesto, { image: caminho(ARQUIVOS.capa) });
  assert.deepEqual(e.aula, { image: YOUTUBE, video: { ...antes.estado.aula.video, thumbnail: caminho(ARQUIVOS.capa) } }, "o YouTube fica");
  assert.deepEqual(e.pagina, {
    hero: { mediaSrc: `/storage/v1/render/image/public/${ARQUIVOS.capa.bucket}/${ARQUIVOS.capa.path}?width=1200&quality=80`, mediaType: "image", poster: deOutra(ARQUIVOS.capa) },
    lista: [caminho(ARQUIVOS.aviso), `Veja ${nosso(ARQUIVOS.aviso)}`, nosso(SUMIDO), YOUTUBE, 7, null, true]
  }, "a imagem transformada guarda a query; outra origem (mesmo com o arquivo aqui), o texto que cita, o arquivo que nao existe e o terceiro ficam");
  assert.deepEqual(e.marca, { assinado: assinado(ARQUIVOS.capa), branding: { logoImage: caminho(ARQUIVOS.capa), schoolIcon: "/hero/bunker-707-red-front-hero.png" }, ja: caminho(ARQUIVOS.aviso) }, "o endereco assinado fica");
  assert.deepEqual(e.modelo, { design: { card: { background: { kind: "image", url: caminho(ARQUIVOS.aviso) } } }, kind: "design", version: 1 });

  const [popup, aviso] = e.campanhas;
  assert.equal(popup.imagem, caminho(ARQUIVOS.aviso));
  assert.equal(popup.audio, caminho(ARQUIVOS.audio));
  assert.equal(popup.cta, caminho(ARQUIVOS.material), "o link do botao para um arquivo nosso tambem");
  assert.deepEqual(popup.design, { card: { background: { kind: "image", url: caminho(ARQUIVOS.aviso) } }, media: { kind: "video", video: { mimeType: "video/mp4", path: VIDEO, url: caminho(ARQUIVOS.video) } }, version: 1 });
  assert.equal(aviso.imagem, deOutra(ARQUIVOS.aviso), "outra origem fica, mesmo com o arquivo de mesmo nome aqui");

  assert.deepEqual(e.comentarios.map((c) => c.avatar), [caminho(ARQUIVOS.foto), caminho(ARQUIVOS.foto)]);
  assert.equal(e.comentarios.find((c) => c.body !== "Segundo comentario").body, nosso(ARQUIVOS.foto), "coluna fora da lista (o texto do comentario) fica");

  assert.deepEqual(e.datas, { linhas: 12, todas_de_antes: true }, "updated_at nao mudou em nenhuma linha");
  assert.deepEqual(e.gatilhos, Object.fromEntries(Object.keys(e.gatilhos).map((nome) => [nome, "O"])), "os gatilhos de data voltaram ligados");
  assert.equal(Object.keys(e.gatilhos).length, 4);
});

test("em lotes: uma linha por coluna por rodada; de novo: nada muda (nunca converte duas vezes)", { skip }, () => {
  const { lote, converter } = rodadas;
  for (const [coluna, valores] of Object.entries(lote.colunas)) {
    assert.ok(valores.linhasMudadas <= 1, `${coluna}: ${valores.linhasMudadas}`);
  }
  assert.equal(lote.colunas["lesson_comments.author_avatar_url"].linhasMudadas, 1);
  assert.ok(lote.colunas["lesson_comments.author_avatar_url"].aConverter >= 1, "o segundo comentario fica para a rodada seguinte");
  assert.ok(converter.colunas["lesson_comments.author_avatar_url"].linhasMudadas >= 1);

  const deNovo = rodadas["de-novo"];
  for (const [coluna, valores] of Object.entries(deNovo.colunas)) {
    assert.equal(valores.linhasMudadas, 0, coluna);
    assert.equal(valores.aConverter, 0, coluna);
  }
  assert.deepEqual(deNovo.estado, converter.estado);
});

test("reverter: o caminho volta a ser o endereco inteiro na base dada, igual ao de antes", { skip }, () => {
  const { antes, reverter } = rodadas;
  const esperado = structuredClone(antes.estado);
  // O que ja vinha pelo caminho tambem ganha a base: o app de antes so entende o endereco inteiro.
  esperado.marca.ja = nosso(ARQUIVOS.aviso);
  assert.deepEqual(reverter.estado, esperado);
  for (const valores of Object.values(reverter.colunas)) assert.equal(valores.caminhos, 0);
});

test("parametros errados param antes de ler qualquer coisa", { skip }, () => {
  for (const [parametros, mensagem] of [
    [{ modo: "converter" }, /converter pede bunker\.midia_origens/],
    [{ modo: "converter", origens: "api.exemplo.com" }, /nao e uma origem/],
    [{ modo: "converter", origens: `${BASE}?x=1` }, /nao e uma origem/],
    [{ modo: "reverter" }, /reverter pede bunker\.midia_base/],
    [{ modo: "apagar" }, /use previa, converter ou reverter/],
    [{ lote: "0", modo: "converter", origens: BASE }, /bunker\.midia_lote/]
  ]) {
    const r = psql(`begin;\n${rodada("erro", parametros)}\nrollback;`);
    assert.notEqual(r.status, 0, JSON.stringify(parametros));
    assert.match(r.erro, mensagem, JSON.stringify(parametros));
  }
});

test("o transporte do app contra o PostgREST local: grava o caminho e le o endereco inteiro", { skip: skip || (psqlLocal ? "so com o Supabase local" : false) }, async () => {
  await import("../support/integration-hooks.mjs");
  const { getSupabaseAdminClient } = await import("../../src/server/db/supabase/client.ts");
  const { unwrap } = await import("../support/local-db.mjs");
  const app = getSupabaseAdminClient();
  const chave = `midia-teste-app-${ID}`;
  const valor = { foto: nosso(ARQUIVOS.foto), outra: deOutra(ARQUIVOS.foto), texto: `Veja ${nosso(ARQUIVOS.foto)}` };

  try {
    const gravado = unwrap(await app.from("platform_settings").upsert({ key: chave, value: valor }, { onConflict: "key" }).select("value").single(), "Gravando pelo app");
    assert.deepEqual(gravado.value, valor, "o app recebe de volta o que mandou");
    const cru = unwrap(await db.from("platform_settings").select("value").eq("key", chave).single(), "Lendo cru");
    assert.deepEqual(cru.value, { ...valor, foto: caminho(ARQUIVOS.foto) }, "o banco guarda o caminho; outra origem e o texto que cita ficam");
    const lido = unwrap(await app.from("platform_settings").select("value").eq("key", chave).single(), "Lendo pelo app");
    assert.deepEqual(lido.value, valor, "a leitura monta o endereco inteiro");
  } finally {
    await db.from("platform_settings").delete().eq("key", chave);
  }
});
