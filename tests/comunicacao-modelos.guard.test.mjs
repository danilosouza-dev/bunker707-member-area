import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guarda dos Modelos da Comunicacao (docs/28 §7.4; docs/18 §1.2): o que se le no codigo.
// - a 202610250001 passa pelo MCP numa secao so, idempotente, sem drop, delete, funcao nova, politica nem Storage,
//   sem citar a coluna do design (a guarda do Livre proibe), com os checks nomeados, o teto de 1 MB, o gatilho com a
//   funcao que ja existe dentro de "if not exists", RLS ligado sem politica e so o service_role;
// - as migracoes ate a 202610240001 continuam byte a byte;
// - as Server Actions dos Modelos pedem messaging.write, nunca gravam o nome na auditoria e nunca chamam
//   revalidatePath (D28);
// - o modulo puro nao importa "@/", "server-only", React nem a tela;
// - o aluno, as rotas /api e as paginas fora do admin nunca leem os Modelos;
// - o video recusado (D16): so o fim do envio pede para apagar; os salvar nunca.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
/** Sem comentarios: o que sobra e o codigo. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610250001_communication_templates.sql";
const TEMPLATE_FILES = ["template-model.ts", "template-store.ts", "template-queries.ts", "template-actions.ts"].map((name) => `src/server/communications/${name}`);

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath.replace(new URL(root).pathname, "").replace(/\/?$/, "/")}${entry.name}`);
}

/** O texto de cada chamada `prefix(...)` (parenteses balanceados). */
function callsOf(code, prefix) {
  const calls = [];
  let index = code.indexOf(prefix);

  while (index !== -1) {
    let depth = 0;
    let end = index + prefix.length - 1;

    for (; end < code.length; end += 1) {
      if (code[end] === "(") depth += 1;
      if (code[end] === ")") depth -= 1;
      if (depth === 0) break;
    }

    calls.push(code.slice(index, end + 1));
    index = code.indexOf(prefix, end);
  }

  return calls;
}

test("a 202610250001: uma secao MCP, idempotente, sem drop, delete, funcao nova, politica, Storage nem a coluna do design", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);

  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 1, "uma secao, marcada MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "nada de delete from (o grant de delete e so o privilegio do service_role)");
  assert.doesNotMatch(code, /\bcreate\s+(?:or\s+replace\s+)?function\b/i, "o gatilho usa a funcao que ja existe");
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /storage\.objects/i);
  assert.doesNotMatch(code, /\btruncate\b/i);
});

test("a 202610250001: tabela, checks nomeados, teto de 1 MB, gatilho dentro de if not exists, RLS e privilegios", () => {
  const code = sqlCodeOf(read(MIGRATION));

  assert.match(code, /create table if not exists public\.communication_templates \(/);
  assert.match(code, /constraint communication_templates_design_mode check \(/);
  assert.match(code, /constraint communication_templates_payload_v1 check \(/);
  assert.match(code, /pg_column_size\(payload\) <= 1048576/);
  assert.match(code, /coalesce\(jsonb_typeof\(payload -> 'version'\), 'null'\) = 'number'/);
  assert.match(code, /coalesce\(payload ->> 'kind', ''\) = kind/);
  assert.match(code, /kind text not null check \(kind in \('inbox', 'popup', 'design'\)\)/);
  assert.match(code, /create index if not exists communication_templates_list_idx/);
  assert.match(code, /create index if not exists communication_templates_kind_idx/);

  // O gatilho: so este, so dentro do bloco "if not exists", com a funcao que ja existe.
  assert.match(
    code,
    /do \$\$\s*begin\s*if not exists \(\s*select 1 from pg_trigger\s*where tgname = 'set_communication_templates_updated_at' and tgrelid = 'public\.communication_templates'::regclass\s*\) then\s*create trigger set_communication_templates_updated_at\s*before update on public\.communication_templates\s*for each row execute function public\.set_updated_at\(\);\s*end if;\s*end;\s*\$\$;/
  );
  assert.equal((code.match(/\bcreate trigger\b/gi) ?? []).length, 1);
  assert.equal((code.match(/\bexecute function\b/gi) ?? []).length, 1);

  assert.match(code, /alter table public\.communication_templates enable row level security;/);
  assert.match(code, /revoke all on public\.communication_templates from anon, authenticated;/);
  assert.match(code, /grant select, insert, update, delete on public\.communication_templates to service_role;/);
});

test("as migracoes ate a 202610240001 continuam byte a byte (e a dos Modelos e a do contrato)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610240001_communication_media_cleanup.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 50);
  assert.equal(hash.digest("hex"), "58e36dd0182b836496e3bf30eab6d00192908f88f726a403b6eaffdf0caf7672", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610250001_communication_templates.sql"));
  assert.equal(
    createHash("sha256").update(read(MIGRATION)).digest("hex"),
    "34f483af2a6e53c34b7ecaf1c4c6108b7f84bc0dfb548200903a0d416f89bb97",
    "a 202610250001 e o texto exato da spec (§3.1): mudou? atualize a spec e este hash juntos"
  );
});

test("template-actions.ts: \"use server\", toda funcao exportada e async e pede messaging.write; auditoria sem o nome", () => {
  const source = read("src/server/communications/template-actions.ts");
  const code = codeOf(source);

  assert.match(source, /^"use server";/);

  const exported = [...code.matchAll(/^export (async )?function (\w+)\(/gm)];
  assert.ok(exported.length >= 6, "as seis acoes");
  assert.doesNotMatch(code, /^export (?:const|let|var|class)\b/m, "um arquivo \"use server\" so exporta funcoes async");

  for (const [, isAsync, name] of exported) {
    assert.ok(isAsync, `${name} e async`);
    const start = code.indexOf(`export async function ${name}(`);
    const end = code.indexOf("\nexport ", start + 1);
    const body = code.slice(start, end === -1 ? undefined : end);
    assert.match(body, /runAdminAction\("messaging\.write",/, `${name} pede messaging.write`);
  }

  const calls = callsOf(code, "recordAudit(");
  assert.ok(calls.length >= 4, "salvo (as duas criacoes), renomeado, duplicado e excluido");

  for (const call of calls) {
    const metadata = call.slice(call.indexOf("metadata:"));
    assert.ok(call.includes("metadata:"), call);
    assert.doesNotMatch(metadata, /\bname\b/, `a auditoria nunca leva o nome do modelo: ${call}`);
  }
});

test("nenhum arquivo template-*.ts chama revalidatePath (D28)", () => {
  const files = readdirSync(new URL("src/server/communications/", root)).filter((name) => /^template-.*\.ts$/.test(name));
  assert.deepEqual(files.sort(), ["template-actions.ts", "template-model.ts", "template-queries.ts", "template-store.ts"]);

  for (const name of files) {
    assert.doesNotMatch(codeOf(read(`src/server/communications/${name}`)), /revalidatePath|revalidateTag|next\/cache/, name);
  }
});

test("template-model.ts e puro: sem \"@/\", server-only, React nem a tela", () => {
  const imports = [...read("src/server/communications/template-model.ts").matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((match) => match[1]);

  assert.ok(imports.length > 5);

  for (const specifier of imports) {
    assert.ok(specifier === "zod" || specifier.startsWith("./") || specifier.startsWith("../"), specifier);
    assert.doesNotMatch(specifier, /^@\/|server-only|^react|components\//, specifier);
  }
});

test("o aluno, as rotas /api e as paginas fora do admin nunca leem os Modelos", () => {
  const files = [
    ...sourceFiles("src/components/member/"),
    ...sourceFiles("src/app/").filter((path) => !path.startsWith("src/app/admin/"))
  ];

  assert.ok(files.some((path) => path.startsWith("src/app/api/")), "as rotas /api foram lidas");

  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /template-(?:model|queries|store|actions)|communication_templates/, path);
  }

  // O mesmo para os modulos do servidor que o aluno usa (sino e pop-ups).
  for (const path of ["src/server/communications/inbox.ts", "src/server/communications/popups.ts", "src/server/communications/popup-store.ts"]) {
    assert.doesNotMatch(read(path), /template-(?:model|queries|store|actions)|communication_templates/, path);
  }

  for (const path of TEMPLATE_FILES.slice(1)) {
    assert.match(read(path), /^(?:"use server";|import "server-only";)/, `${path}: so no servidor`);
  }
});

test("video recusado (D16): so popup-design-actions.ts pede para apagar; os salvar nunca", () => {
  const callers = sourceFiles("src/")
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => /\binspectPopupVideo\(/.test(codeOf(read(path))));

  for (const path of callers) {
    const code = codeOf(read(path));
    const calls = [...code.matchAll(/inspectPopupVideo\(([^;]*?)\)(?:;|\))/g)].map((match) => match[1]);
    const withOption = calls.filter((args) => /removeRefused/.test(args));

    if (path === "src/server/communications/popup-design-actions.ts") {
      assert.equal(withOption.length, 1, `${path}: o fim do envio pede, uma vez`);
      assert.match(code, /removeRefused: \(\{ createdAt \}\) => mayRemoveRefusedVideo\(db, data\.path, createdAt, new Date\(\)\)/);
    } else if (path !== "src/server/communications/popup-media.ts") {
      assert.equal(withOption.length, 0, `${path}: nunca pede para apagar`);
    }
  }

  assert.doesNotMatch(codeOf(read("src/server/communications/actions.ts")), /inspectPopupVideo/, "actions.ts nao confere video direto (design-checks.ts)");

  for (const path of ["src/server/communications/design-checks.ts", "src/server/communications/popup-free-assets.ts"]) {
    const code = codeOf(read(path));
    assert.match(code, /inspectPopupVideo\(db, [\w.]+\)/, `${path}: chama sem a opcao`);
    assert.doesNotMatch(code, /removeRefused/, path);
  }

  // So o arquivo do fim do envio passa a opcao (no codigo de todo src/).
  const passers = sourceFiles("src/")
    .filter((path) => /\.(?:ts|tsx)$/.test(path) && path !== "src/server/communications/popup-media.ts")
    .filter((path) => /removeRefused/.test(codeOf(read(path))));
  assert.deepEqual(passers, ["src/server/communications/popup-design-actions.ts"]);
});
