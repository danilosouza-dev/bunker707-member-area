import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assertFunctionServiceRole,
  assertKeepsBody,
  assertOnlyAdds,
  assertSections,
  assertServiceRoleOnly,
  cumulativeHash,
  fileHash,
  functionBody,
  migrationFiles,
  read,
  sqlCodeOf,
  sqlList,
  statementsOf
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao da "Na tela" (especificacao de 10/11/2026, §4 e §9; docs/30 §4.1 e §4.2; docs/21 §9.13; docs/18
// §1.2): a 202611100002_webinars_v7_na_tela.sql, com o banco do adendo do mesmo dia (R7 a R9).
// - as 65 migracoes ate a 202611100001 (todas aplicadas na nuvem de teste) continuam byte a byte (hash acumulado); a
//   202611100002 vem logo depois e e o texto exato (hash);
// - sete secoes MCP, idempotente; so acrescenta: o unico drop e o do check webinar_sessions_simulation_not_live_v4,
//   dentro do bloco que so roda sem o check novo; as duas tabelas novas e a funcao do relatorio so do service_role;
// - as listas e os limites do SQL sao os do app (screen-model.ts: SCREEN_KINDS, SCREEN_DISPLAY_KINDS, SCREEN_PLACES,
//   SCREEN_SIZES, SCREEN_HIDDEN_REASONS, SCREEN_LIMITS, o caminho da imagem e os registros das metricas);
// - R7: a sessao `live` aceita as regras simuladas e o resumo, nunca o selo "Ao vivo" da gravada;
// - R9: a foto do personagem no item do roteiro e na mensagem scripted (so o caminho webinars/personas/<24 hex>.webp);
//   webinar_open_session mantem o corpo inteiro da 202610290001 e so ganha a foto e a live fora do roteiro ao abrir;
// - os checks novos das tabelas que ja existem entram `not valid` e a secao 7 so os valida;
// - o aviso de migracao pendente aponta esta ou uma mais nova (WEBINARS_MIGRATION; desde 11/11/2026 a 202611110001 das
//   pessoas que comentam), e a Na tela tem a propria constante
//   (WEBINARS_SCREEN_MIGRATION).

const MIGRATION = "supabase/migrations/202611100002_webinars_v7_na_tela.sql";
const screen = await import("../src/server/webinars/screen-model.ts");
const model = await import("../src/server/webinars/model.ts");
// db.ts tem "server-only": as constantes sao lidas do texto.
const dbSource = read("src/server/webinars/db.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);

/** O codigo de cada secao (sem comentarios), na ordem: o que vem depois do cabecalho numerado ate o proximo. */
function sectionsOf(source) {
  const headers = Array.from(source.matchAll(/^ \* (\d{1,2})\. .+\n \* -+ \*\/$/gm));
  return headers.map((header, index) => {
    const start = header.index + header[0].length;
    const end = index + 1 < headers.length ? source.lastIndexOf("/*", headers[index + 1].index) : source.length;
    return sqlCodeOf(source.slice(start, end)).trim();
  });
}

const sections = sectionsOf(migration);
const PERSONA_PATH = "'^webinars/personas/[a-f0-9]{24}[.]webp$'";

test("as 65 migracoes ate a 202611100001 continuam byte a byte (todas aplicadas); a 202611100002 vem logo depois e e o texto exato", () => {
  const applied = cumulativeHash("202611100001_webinars_v6_respostas.sql");
  assert.equal(applied.count, 65);
  assert.equal(applied.hash, "4018bf8de06bf2d5c37dd475ead71f964365af2243a654da60e06f895a0b8d76", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.equal(files[files.indexOf("202611100001_webinars_v6_respostas.sql") + 1], "202611100002_webinars_v7_na_tela.sql", "logo depois da do fio das Perguntas");
  assert.equal(
    fileHash(MIGRATION),
    "f2abd33b279708a6248dbd7794973426c2de9736a55c7105e561f63b6c0e9418",
    "a 202611100002 mudou: depois de aplicada na nuvem de teste (docs/21 §9.13), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611100002: sete secoes MCP, idempotente, so acrescenta (o unico drop e o do check trocado); tabelas e funcao so do service_role", () => {
  assertSections(migration, 7);
  assert.equal(sections.length, 7);
  assertOnlyAdds(migration, { replaces: { webinar_sessions_simulation_live_v7: "webinar_sessions_simulation_not_live_v4" } });
  assertServiceRoleOnly(code, "webinar_screen_items");
  assertServiceRoleOnly(code, "webinar_screen_displays");
  assertFunctionServiceRole(code, "webinar_screen_report(uuid)");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 2, "duas tabelas novas");
  assert.deepEqual(
    Array.from(code.matchAll(/create (?:unique )?index if not exists (\w+) on public\.(\w+) \(([^)]+)\)( where [^;]+)?;/g), (match) => `${match[1]} @ ${match[2]}: ${match[3]}${match[4] ?? ""}`),
    [
      "webinar_screen_items_webinar_idx @ webinar_screen_items: webinar_id, created_at where archived_at is null",
      "webinar_screen_displays_active_idx @ webinar_screen_displays: session_id, kind where hidden_at is null",
      "webinar_screen_displays_session_idx @ webinar_screen_displays: session_id, shown_at"
    ]
  );
  assert.match(code, /create unique index if not exists webinar_screen_displays_active_idx/, "1 de cada tipo na tela por sessao");
  // Somem com o webinario e com a sessao; o item que some deixa a exibicao (com a copia) no relatorio.
  assert.match(code, /webinar_id uuid not null references public\.webinars\(id\) on delete cascade,/);
  assert.match(code, /session_id uuid not null references public\.webinar_sessions\(id\) on delete cascade,/);
  assert.match(code, /item_id uuid references public\.webinar_screen_items\(id\) on delete set null,/);
  assert.match(code, /poll_id uuid references public\.webinar_polls\(id\) on delete cascade,/);
  // Nenhuma coluna nova em webinar_sessions; as colunas novas sao so as da foto do personagem.
  assert.deepEqual(Array.from(statementsOf(migration).matchAll(/alter table (public\.\w+) add column if not exists (\w+)/g), (match) => `${match[1]}.${match[2]}`), [
    "public.webinar_chat_script_items.persona_avatar_path",
    "public.webinar_chat_messages.persona_avatar_path"
  ]);
  assert.doesNotMatch(code, /alter table public\.webinar_sessions add column/);
});

test("as listas e os limites do SQL sao os do app (screen-model.ts)", () => {
  const items = sections[0];
  const displays = sections[1];
  const L = screen.SCREEN_LIMITS;
  assert.match(items, new RegExp(`kind text not null check \\(kind in \\(${sqlList(screen.SCREEN_KINDS)}\\)\\),`));
  assert.match(displays, new RegExp(`kind text not null check \\(kind in \\(${sqlList(screen.SCREEN_DISPLAY_KINDS)}\\)\\),`));
  assert.match(items, new RegExp(`place text not null default '${screen.SCREEN_DEFAULT_PLACE.banner}' check \\(place in \\(${sqlList(screen.SCREEN_PLACES)}\\)\\),`));
  assert.match(items, new RegExp(`size text not null default '${screen.SCREEN_DEFAULT_SIZE}' check \\(size in \\(${sqlList(screen.SCREEN_SIZES)}\\)\\),`));
  assert.match(displays, new RegExp(`hidden_reason text check \\(hidden_reason is null or hidden_reason in \\(${sqlList(screen.SCREEN_HIDDEN_REASONS)}\\)\\),`));
  assert.match(items, new RegExp(`name text not null check \\(char_length\\(name\\) between 1 and ${L.name}\\),`));
  assert.match(items, new RegExp(`title text check \\(title is null or char_length\\(title\\) between 1 and ${L.title}\\),`));
  assert.match(items, new RegExp(`body text check \\(body is null or char_length\\(body\\) between 1 and ${L.body}\\),`));
  assert.match(items, new RegExp(`button_label text check \\(button_label is null or char_length\\(button_label\\) between 1 and ${L.buttonLabel}\\),`));
  assert.match(items, new RegExp(`image_alt text check \\(image_alt is null or char_length\\(image_alt\\) between 1 and ${L.imageAlt}\\),`));
  assert.match(items, new RegExp(`link_url text check \\(link_url is null or \\(char_length\\(link_url\\) <= ${L.link} and link_url ~ '\\^https://\\[\\^\\[:space:\\]\\]\\+\\$'\\)\\),`));
  assert.match(items, new RegExp(`kind = 'qr' and link_url is not null and char_length\\(link_url\\) <= ${L.qrLink} and body is null and button_label is null and image_path is null`));
  for (const side of ["image_width", "image_height"]) {
    assert.match(items, new RegExp(`${side} integer check \\(${side} is null or ${side} between ${L.imageSideMin} and ${L.imageSideMax}\\),`));
  }
  assert.match(displays, new RegExp(`pg_column_size\\(snapshot\\) <= ${L.snapshotBytes}\\)`));
  // O caminho da imagem: o mesmo padrao do app (24 hex do sha256 + .webp, na pasta webinars/screen).
  assert.equal(screen.SCREEN_IMAGE_PATH_PATTERN.source, "^webinars\\/screen\\/[a-f0-9]{24}\\.webp$");
  assert.match(items, /image_path text check \(image_path is null or image_path ~ '\^webinars\/screen\/\[a-f0-9\]\{24\}\[\.\]webp\$'\),/);
  assert.equal(screen.SCREEN_IMAGE_FOLDER, "webinars/screen");
  // A regra do meio e a mesma do app.
  assert.match(items, /constraint webinar_screen_items_center_v7 check \(not \(place = 'center' and closable = false and size = 'l'\)\)/);
  assert.equal(screen.screenCenterBlocked({ closable: false, place: "center", size: "l" }), true);
  // Os registros das metricas que a funcao le sao os que a rota grava.
  const report = functionBody(code, "webinar_screen_report").body;
  const types = screen.SCREEN_EVENT_TYPES;
  assert.match(report, new RegExp(`e\\.event_type in \\(${sqlList([types.shown, types.clicked, types.closed])}\\)`));
  for (const type of Object.values(screen.SCREEN_EVENT_TYPES)) {
    assert.ok(report.includes(`e.event_type = '${type}'`), type);
  }
  assert.match(report, /and not exists \(select 1 from public\.admin_roles a where a\.user_id = e\.user_id\)/, "a equipe fica de fora");
  assert.match(report, /e\.entity_type = 'webinar'\s+and e\.entity_id = p_session_id::text/, "pelo indice parcial student_events_webinar_idx");
});

test("R7: o check novo deixa a live ter as regras simuladas e o resumo, nunca o selo da gravada; entra not valid e a secao 7 valida", () => {
  const [, , , fourth] = sections;
  assert.match(
    fourth,
    /^do \$\$\s*begin\s*if not exists \(select 1 from pg_constraint where conname = 'webinar_sessions_simulation_live_v7'\) then\s*alter table public\.webinar_sessions drop constraint if exists webinar_sessions_simulation_not_live_v4;\s*alter table public\.webinar_sessions add constraint webinar_sessions_simulation_live_v7\s*check \(kind <> 'live' or show_live_badge = false\) not valid;\s*end if;\s*end;\s*\$\$;$/,
    "o drop e o add juntos, atras da guarda do pg_constraint, sem ler as linhas"
  );
  // O check antigo e o da 202610300003, com as quatro colunas da Simulacao (todas liberadas na live agora).
  assert.match(sqlCodeOf(read("supabase/migrations/202610300003_webinars_v4b_ofertas.sql")), /add constraint webinar_sessions_simulation_not_live_v4\s*check \(kind <> 'live' or \(simulated_count_rule is null and simulated_joins is null and simulated_sale_notices is null and simulation_summary is null\)\);/);
  assert.doesNotMatch(fourth, /simulated_count_rule|simulated_joins|simulated_sale_notices|simulation_summary/, "nenhuma regra simulada fica proibida na live");
});

test("R9: a foto do personagem no item e na mensagem scripted, so o caminho da nossa pasta; checks not valid", () => {
  const fifth = sections[4];
  assert.match(fifth, /alter table public\.webinar_chat_script_items add column if not exists persona_avatar_path text;/);
  assert.match(fifth, /alter table public\.webinar_chat_messages add column if not exists persona_avatar_path text;/);
  assert.ok(
    fifth.includes(`add constraint webinar_chat_script_items_persona_avatar_v7\n      check (persona_avatar_path is null or persona_avatar_path ~ ${PERSONA_PATH}) not valid;`),
    "o item: nulo ou o caminho da pasta webinars/personas"
  );
  assert.ok(
    fifth.includes(`add constraint webinar_chat_messages_persona_avatar_v7\n      check (persona_avatar_path is null or (source = 'scripted' and persona_avatar_path ~ ${PERSONA_PATH})) not valid;`),
    "a mensagem: so a scripted tem foto do personagem"
  );
  assert.ok(model.CHAT_SOURCES.includes("scripted"));
  // A pasta da foto do personagem e irma da pasta do banner (o mesmo envio e o mesmo nome pelo conteudo, com o prefixo proprio).
  assert.ok(sections[0].includes(`image_path ~ ${PERSONA_PATH.replace("personas", "screen")}`));
});

test("webinar_open_session: o corpo inteiro da 202610290001, mesma assinatura, mais so a foto do personagem e a live fora do roteiro ao abrir", () => {
  const before = functionBody(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), "webinar_open_session");
  const after = functionBody(sections[5], "webinar_open_session");
  assert.equal(after.header.replace(/\s+/g, " "), before.header.replace(/\s+/g, " "), "mesma assinatura, mesma linguagem, security invoker e search_path");
  assertKeepsBody(before.body, after.body, "webinar_open_session");
  const old = before.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const added = after.body.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of old) {
    added.splice(added.indexOf(line), 1);
  }
  assert.deepEqual(added, ["persona_avatar_path,", "i.persona_avatar_path,", "and v_session.kind <> 'live'"], "so tres linhas novas");
  // Nenhum grant novo: o create or replace mantem a funcao so do service_role (a 202610290001 fez o revoke).
  assert.doesNotMatch(sections[5], /\bgrant\b|\brevoke\b/);
});

test("a secao 7 so valida os tres checks novos (de novo, nada muda)", () => {
  assert.deepEqual(sections[6].split("\n").map((line) => line.trim()).filter(Boolean), [
    "alter table public.webinar_sessions validate constraint webinar_sessions_simulation_live_v7;",
    "alter table public.webinar_chat_script_items validate constraint webinar_chat_script_items_persona_avatar_v7;",
    "alter table public.webinar_chat_messages validate constraint webinar_chat_messages_persona_avatar_v7;"
  ]);
  assert.equal((code.match(/\bnot valid\b/g) ?? []).length, 3, "os tres entram not valid");
});

test("o aviso de migracao pendente aponta uma migracao que inclui a 202611100002, e a Na tela tem a propria constante", () => {
  // O aviso aponta a migracao mais nova dos webinarios (desde 11/11/2026 a das pessoas que comentam, 202611110001,
  // tests/webinarios-v8.guard.test.mjs): aplicar ate ela inclui esta.
  assert.ok((dbSource.match(/export const WEBINARS_MIGRATION = "(\d+)";/)?.[1] ?? "") >= "202611100002");
  assert.match(dbSource, /export const WEBINARS_SCREEN_MIGRATION = "202611100002";/);
  // Nenhuma coluna desta migracao entra nas listas que o app sempre le: o app de antes continua de pe sem ela.
  for (const [file, list] of [
    ["src/server/webinars/rows.ts", "SESSION_COLUMNS"],
    ["src/server/webinars/chat-rows.ts", "CHAT_MESSAGE_COLUMNS"],
    ["src/server/webinars/chat-rows.ts", "SCRIPT_ITEM_COLUMNS"]
  ]) {
    const columns = read(file).match(new RegExp(`export const ${list} =\\s*"([^"]+)"`))?.[1];
    assert.ok(columns, list);
    assert.doesNotMatch(columns, /persona_avatar_path|screen/, `${list} nao le as colunas novas`);
  }
});
