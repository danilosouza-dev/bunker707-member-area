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
  statementsOf
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao das pessoas que comentam e da pergunta simulada (pedido do produtor de 11/11/2026; docs/30 §4.1,
// §4.2 e D75 a D78; docs/21 §9.14; docs/18 §1.2): a 202611140001_webinars_v8_pessoas.sql.
// - as 66 migracoes ate a 202611100002 (aplicadas na nuvem de teste) continuam byte a byte (hash acumulado); a
//   202611140001 vem logo depois e e o texto exato (hash);
// - nove secoes MCP, idempotente; so acrescenta: o unico `drop` e o `drop not null` de webinar_questions.user_id (afrouxa
//   para a pergunta simulada, sem aluno); a tabela nova e a funcao do nome so do service_role; os checks novos das
//   tabelas que ja existem entram `not valid` e a secao 9 so os valida;
// - o nome comparavel do banco (webinar_persona_name_key) e o do app (persona-model.personaNameKey): o mesmo texto
//   (NFC, espacos repetidos viram um, sem espacos nas pontas, sem caixa), conferido pelo texto da funcao e por uma copia
//   em JavaScript da expressao num punhado de nomes com acento e caixa (o par contra o banco de verdade fica na
//   integracao, tests/integration/webinarios-pessoas.test.mjs);
// - o preenchimento roda uma vez (a lista vazia), uma pessoa por nome dos itens e das mensagens scripted sem item, com
//   o nome e o papel do mais recente e a foto mais recente nao nula (a revisao v8, achado 5: o arquivo mudou antes de
//   ir para a nuvem de teste, e o hash junto);
// - webinar_open_session mantem o corpo inteiro da 202611100002 e so ganha a pergunta do item Pergunta na gravada;
// - webinar_report e webinar_panel mantem o corpo inteiro da 202610300007 e so ganham o filtro da turma
//   (source = 'audience') nas perguntas;
// - nenhuma coluna nova nas listas que o app sempre le (QUESTION_COLUMNS, SCRIPT_ITEM_COLUMNS); o aviso de migracao
//   pendente aponta esta (WEBINARS_MIGRATION) e a lista tem a propria constante, igual a do modelo puro.

const MIGRATION = "supabase/migrations/202611140001_webinars_v8_pessoas.sql";
const persona = await import("../src/server/webinars/persona-model.ts");
const model = await import("../src/server/webinars/model.ts");
const dbSource = read("src/server/webinars/db.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);
const DROP_NOT_NULL = "alter table public.webinar_questions alter column user_id drop not null;";
const PERSONA_PATH = "'^webinars/personas/[a-f0-9]{24}[.]webp$'";

function sectionsOf(source) {
  const headers = Array.from(source.matchAll(/^ \* (\d{1,2})\. .+\n \* -+ \*\/$/gm));
  return headers.map((header, index) => {
    const start = header.index + header[0].length;
    const end = index + 1 < headers.length ? source.lastIndexOf("/*", headers[index + 1].index) : source.length;
    return sqlCodeOf(source.slice(start, end)).trim();
  });
}

const sections = sectionsOf(migration);

test("as 66 migracoes ate a 202611100002 continuam byte a byte; a 202611140001 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611100002_webinars_v7_na_tela.sql");
  assert.equal(applied.count, 66);
  assert.equal(applied.hash, "9292354986d87ef4d7d03efff3c382b374b4937b1fc2ca421e423987a5b834bb", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  // Depois da Na tela e de todas as que ja estavam na dev (as do produto licenciado, 202611100003 a 202611130001, vieram
  // antes desta pela ordem dos arquivos; a 202611110001 de antes colidia com a da licenca e virou 202611140001).
  assert.ok(files.indexOf("202611140001_webinars_v8_pessoas.sql") > files.indexOf("202611100002_webinars_v7_na_tela.sql"), "depois da Na tela");
  assert.ok(files.indexOf("202611140001_webinars_v8_pessoas.sql") > files.indexOf("202611130001_license_sales.sql"), "depois das do produto licenciado");
  assert.equal(
    fileHash(MIGRATION),
    "8ec4b5bf89463d5ef428d834e1d77baaa8c92c13cff50aeafee9929c1d14ed4c",
    "a 202611140001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.14), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611140001: nove secoes MCP, idempotente, so acrescenta (o unico drop e o drop not null do user_id da pergunta); tabela e funcao so do service_role", () => {
  assertSections(migration, 9);
  assert.equal(sections.length, 9);
  assert.equal(migration.split(DROP_NOT_NULL).length, 2, "o drop not null uma vez so");
  assertOnlyAdds(migration.replace(DROP_NOT_NULL, ""));
  assert.equal((statementsOf(migration).match(/\bdrop\b/gi) ?? []).length, 1, "nenhum outro drop");
  assertServiceRoleOnly(code, "webinar_personas");
  assertFunctionServiceRole(code, "webinar_persona_name_key(text)");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 1, "uma tabela nova");
  assert.deepEqual(
    Array.from(code.matchAll(/create (?:unique )?index if not exists (\w+) on public\.(\w+) \(([^)]+)\)( where [^;]+)?;/g), (match) => `${match[1]} @ ${match[2]}: ${match[3]}${match[4] ?? ""}`),
    [
      "webinar_personas_name_idx @ webinar_personas: webinar_id, name_key",
      "webinar_chat_script_items_persona_idx @ webinar_chat_script_items: persona_id where persona_id is not null",
      "webinar_questions_scripted_message_idx @ webinar_questions: message_id where source = 'scripted' and message_id is not null",
      "webinar_questions_persona_idx @ webinar_questions: persona_id where persona_id is not null"
    ]
  );
  assert.match(code, /create unique index if not exists webinar_personas_name_idx/, "o nome unico no webinario");
  assert.match(code, /create unique index if not exists webinar_questions_scripted_message_idx/, "uma pergunta simulada por mensagem do roteiro");
  // A lista some com o webinario; a pessoa que sai deixa o item e a pergunta com a copia.
  assert.match(code, /webinar_id uuid not null references public\.webinars\(id\) on delete cascade,/);
  assert.match(code, /add constraint webinar_chat_script_items_persona_v8\s+foreign key \(persona_id\) references public\.webinar_personas\(id\) on delete set null not valid;/);
  assert.match(code, /add constraint webinar_questions_persona_fk_v8\s+foreign key \(persona_id\) references public\.webinar_personas\(id\) on delete set null not valid;/);
  assert.deepEqual(Array.from(statementsOf(migration).matchAll(/alter table (public\.\w+) add column if not exists (\w+)/g), (match) => `${match[1]}.${match[2]}`), [
    "public.webinar_chat_script_items.persona_id",
    "public.webinar_questions.source",
    "public.webinar_questions.persona_id",
    "public.webinar_questions.persona_role",
    "public.webinar_questions.persona_avatar_path"
  ]);
});

test("os limites e as listas do SQL sao os do app; a pergunta simulada nao tem aluno, e a da turma sempre tem", () => {
  const [, table, , questions] = sections;
  assert.match(table, new RegExp(`name text not null check \\(char_length\\(name\\) between 1 and ${model.CHAT_LIMITS.personaName}\\),`));
  assert.match(table, /role text not null default 'student' check \(role in \('student', 'team'\)\),/);
  assert.deepEqual([...model.PERSONA_ROLES], ["student", "team"]);
  assert.ok(table.includes(`avatar_path text check (avatar_path is null or avatar_path ~ ${PERSONA_PATH}),`), "a foto so da nossa pasta");
  assert.equal(persona.PERSONA_AVATAR_PATH_PATTERN.source, "^webinars\\/personas\\/[a-f0-9]{24}\\.webp$");
  assert.match(table, /name_key text generated always as \(public\.webinar_persona_name_key\(name\)\) stored,/, "o nome comparavel pelo banco");
  assert.match(questions, /alter table public\.webinar_questions add column if not exists source text not null default 'audience';/);
  assert.match(questions, /check \(source in \('audience', 'scripted'\)\) not valid;/);
  assert.match(questions, /check \(\(source = 'audience'\) = \(user_id is not null\)\) not valid;/, "a da turma tem aluno; a simulada nunca");
  assert.ok(questions.includes(`(persona_avatar_path is null or persona_avatar_path ~ ${PERSONA_PATH})`), "a foto da pessoa na pergunta, so da nossa pasta");
  assert.match(questions, /\(source = 'audience' and persona_id is null and persona_role is null and persona_avatar_path is null\)/, "a pergunta da turma sem as copias da pessoa");
  assert.equal((code.match(/\bnot valid\b/g) ?? []).length, 5, "os cinco checks novos das tabelas que ja existem entram not valid");
});

test("o nome comparavel: a funcao do banco e personaNameKey dao o mesmo texto (NFC, espacos, caixa)", () => {
  const body = functionBody(code, "webinar_persona_name_key").body.trim();
  assert.equal(body, "select lower(btrim(regexp_replace(normalize(coalesce(p_name, ''), NFC), '\\s+', ' ', 'g')))");
  assert.match(functionBody(code, "webinar_persona_name_key").header, /language sql\s+immutable\s+security invoker/);
  // A mesma expressao em JavaScript, passo a passo (lower, btrim de espaco, regexp_replace global de \s+, NFC).
  const doBanco = (nome) => nome.normalize("NFC").replace(/\s+/g, " ").replace(/^ +| +$/g, "").toLowerCase();
  const nomes = ["Adriano Souza", "  adriano   SOUZA ", "ÁLVARO  Çé", "João Ñandu", "\tBIA C.\n", "Érica de Assunção", "ana  maria", "Ítalo Ü"];
  for (const nome of nomes) {
    assert.equal(persona.personaNameKey(nome), doBanco(nome), nome);
  }
  assert.equal(persona.personaNameKey("  Adriano   SOUZA "), "adriano souza", "o exemplo da verificacao da migracao");
  assert.equal(persona.personaNameKey("João"), persona.personaNameKey("João"), "NFC: o til combinado e o til junto");
  assert.equal(persona.personaNameKey("ÁLVARO  Çé"), "álvaro çé", "o espaco duro tambem e espaco");
});

test("o preenchimento roda so com a lista vazia, uma pessoa por nome dos itens e do Enviar agora, e liga os itens com a copia da pessoa", () => {
  const fill = sections[4];
  assert.match(fill, /^do \$\$\s*begin\s*if not exists \(select 1 from public\.webinar_personas\) then/, "so a primeira vez");
  assert.match(fill, /select distinct on \(src\.webinar_id, public\.webinar_persona_name_key\(src\.name\)\)/);
  assert.match(fill, /from public\.webinar_chat_script_items i/);
  assert.match(fill, /where m\.source = 'scripted' and m\.script_item_id is null/, "as mensagens do Enviar agora");
  assert.match(fill, /order by src\.webinar_id, public\.webinar_persona_name_key\(src\.name\), src\.at desc\s+on conflict/, "o nome e o papel do mais recente");
  // A revisao v8 (achado 5): a foto e a mais recente que existe por nome; a linha mais nova sem foto nunca a apaga.
  assert.match(
    fill,
    /photo as \(\s*select distinct on \(src\.webinar_id, public\.webinar_persona_name_key\(src\.name\)\)\s+src\.webinar_id, public\.webinar_persona_name_key\(src\.name\) as photo_key, src\.avatar_path\s+from src\s+where src\.avatar_path is not null\s+order by src\.webinar_id, public\.webinar_persona_name_key\(src\.name\), src\.at desc\s*\)/,
    "a foto mais recente nao nula"
  );
  assert.match(fill, /src\.webinar_id, src\.name, src\.role, photo\.avatar_path, src\.at\s+from src\s+left join photo on photo\.webinar_id = src\.webinar_id and photo\.photo_key = public\.webinar_persona_name_key\(src\.name\)/);
  assert.doesNotMatch(fill, /src\.role, src\.avatar_path, src\.at/, "nunca a foto da linha mais recente, mesmo nula");
  assert.match(fill, /on conflict \(webinar_id, name_key\) do nothing;/);
  assert.match(fill, /set persona_id = p\.id, persona_name = p\.name, persona_role = p\.role, persona_avatar_path = p\.avatar_path/);
  assert.match(fill, /and p\.name_key = public\.webinar_persona_name_key\(i\.persona_name\);/);
  assert.doesNotMatch(fill, /webinar_chat_messages\s+set|update public\.webinar_chat_messages/, "o que a turma ja viu nao muda");
});

test("webinar_open_session: o corpo inteiro da 202611100002, e o item Pergunta da gravada abre a pergunta simulada ligada a mensagem, com a hora dela", () => {
  const before = functionBody(sqlCodeOf(read("supabase/migrations/202611100002_webinars_v7_na_tela.sql")), "webinar_open_session");
  const after = functionBody(sections[5], "webinar_open_session");
  assert.equal(after.header.replace(/\s+/g, " "), before.header.replace(/\s+/g, " "), "mesma assinatura");
  assertKeepsBody(before.body, after.body, "webinar_open_session");
  assert.match(after.body, /insert into public\.webinar_questions/);
  assert.match(after.body, /'scripted', i\.persona_id, case when m\.role = 'team' then 'team' else 'student' end, m\.persona_avatar_path/);
  assert.match(after.body, /m\.offset_ms, m\.created_at,/, "o minuto e a hora da mensagem (a sala so mostra quando a hora chega)");
  assert.match(after.body, /and v_session\.kind <> 'live'\s+and m\.source = 'scripted'\s+and m\.kind = 'question'/);
  assert.match(after.body, /left\(m\.body, 500\)/, "o texto cabe na pergunta");
  assert.equal(model.CHAT_LIMITS.question, 500);
  assert.match(after.body, /on conflict \(message_id\) where source = 'scripted' and message_id is not null do nothing;/);
  assert.doesNotMatch(sections[5], /\bgrant\b|\brevoke\b/);
});

test("webinar_report e webinar_panel: o corpo inteiro da 202610300007, e as perguntas so da turma", () => {
  const old = sqlCodeOf(read("supabase/migrations/202610300007_webinars_v4_ajustes.sql"));
  for (const [name, index] of [
    ["webinar_report", 6],
    ["webinar_panel", 7]
  ]) {
    const before = functionBody(old, name);
    const after = functionBody(sections[index], name);
    assert.equal(after.header.replace(/\s+/g, " "), before.header.replace(/\s+/g, " "), `${name}: mesma assinatura`);
    assertKeepsBody(before.body, after.body, name);
    // As linhas do corpo novo que o antigo nao tem (contando as repetidas).
    const left = new Map();
    for (const line of before.body.split("\n").map((value) => value.trim()).filter(Boolean)) {
      left.set(line, (left.get(line) ?? 0) + 1);
    }
    const added = after.body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        if ((left.get(line) ?? 0) > 0) {
          left.set(line, left.get(line) - 1);
          return false;
        }
        return true;
      });
    assert.deepEqual(added, name === "webinar_report" ? ["and q.source = 'audience'", "and q.source = 'audience'"] : ["and q.source = 'audience'"], `${name}: so o filtro da turma`);
  }
  assert.match(sections[6], /qs as \(\s*select q\.id, q\.user_id, q\.status, q\.upvotes\s+from public\.webinar_questions q, s\s+where q\.session_id = s\.id and q\.deleted_at is null\s+and q\.source = 'audience'/);
  // webinar_attendees (202610290001) conta pelo user_id do aluno: a simulada (sem aluno) ja fica de fora, e a funcao nao muda.
  assert.doesNotMatch(code, /function public\.webinar_attendees/);
  assert.match(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), /q\.user_id = p\.user_id/);
});

test("a secao 9 so valida os cinco checks novos; nenhuma coluna nova nas listas de sempre; o aviso aponta esta", () => {
  assert.deepEqual(sections[8].split("\n").map((line) => line.trim()).filter(Boolean), [
    "alter table public.webinar_chat_script_items validate constraint webinar_chat_script_items_persona_v8;",
    "alter table public.webinar_questions validate constraint webinar_questions_source_v8;",
    "alter table public.webinar_questions validate constraint webinar_questions_author_v8;",
    "alter table public.webinar_questions validate constraint webinar_questions_persona_v8;",
    "alter table public.webinar_questions validate constraint webinar_questions_persona_fk_v8;"
  ]);
  // O aviso geral aponta a mais nova dos webinarios (desde 11/11/2026 a 202611140002 dos participantes simulados, que vem
  // depois desta pela ordem dos arquivos): aplicar ate ela inclui esta.
  assert.ok((dbSource.match(/export const WEBINARS_MIGRATION = "(\d+)";/)?.[1] ?? "") >= "202611140001");
  assert.match(dbSource, /export const WEBINARS_PERSONAS_MIGRATION = "202611140001";/);
  assert.equal(persona.PERSONAS_MIGRATION_ID, "202611140001", "o aviso da tela (persona-model) e o do servidor (db.ts) apontam a mesma");
  for (const [list, novas] of [
    ["QUESTION_COLUMNS", /\bsource\b|persona_id|persona_role|persona_avatar_path/],
    ["SCRIPT_ITEM_COLUMNS", /persona_id|persona_avatar_path/]
  ]) {
    const columns = read("src/server/webinars/chat-rows.ts").match(new RegExp(`export const ${list} =\\s*"([^"]+)"`))?.[1];
    assert.ok(columns, list);
    assert.doesNotMatch(columns, novas, `${list} nao le as colunas novas`);
  }
});
