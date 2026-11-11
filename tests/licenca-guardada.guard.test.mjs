import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guarda da licença guardada (docs/32 §11.3 e §16; docs/18 §1.2): o que se lê no código e na migração 202611100002.
// - a migração passa pelo MCP numa seção só, idempotente, sem drop, delete, função nova, política, Storage nem
//   security definer; a tabela é de uma linha, só do service_role (RLS ligada, revoke de anon e authenticated, grant
//   ao service_role), com os checks nomeados e o gatilho com a função que já existe dentro de "if not exists";
// - as migrações até a 202611010001 continuam byte a byte;
// - o adaptador lê e grava só colunas que a tabela tem;
// - quem grava: a tarefa do tick é a única que roda a rodada (a última hora vista só anda por ela); além dela e da
//   situação do pedido, só as Server Actions da tela Licença (ativar, Verificar agora, desativar, licença por arquivo) e
//   a rota interna do terminal (a ativação pelo instalador do kit, docs/20 §9D) criam o adaptador do banco; e o segredo da
//   Instalação só aparece nos arquivos do Verificador que falam com o banco e com o Emissor;
// - os arquivos de regras ficam puros (os testes os carregam pelo Node) e os que tocam no banco ou no Emissor são
//   "server-only";
// - o job está no registro do tick, antes da limpeza de arquivos (que fica por último).

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
/** Sem comentários: o que sobra é o código. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const MIGRATION = "supabase/migrations/202611100002_license_state.sql";
/** O endereço dos pedidos do dono e dos administradores (revisão de 11/11/2026): só acrescenta duas colunas. */
const REQUEST_HOST_MIGRATION = "supabase/migrations/202611110001_license_state_request_host.sql";
const LICENSING = "src/server/licensing/";

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath.replace(new URL(root).pathname, "").replace(/\/?$/, "/")}${entry.name}`);
}

test("a 202611100002: uma seção MCP, idempotente, sem drop, delete, função nova, política, Storage nem security definer", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);

  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 1, "uma seção, marcada MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proíbe migração nova que cite a coluna do design");
  assert.doesNotMatch(code, /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/, "não mexe nas tabelas dos webinários (o aviso de migração pendente deles aponta a mais nova que mexe)");
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "nada de delete from (o grant de delete é só o privilégio do service_role)");
  assert.doesNotMatch(code, /\bcreate\s+(?:or\s+replace\s+)?function\b/i, "o gatilho usa a função que já existe");
  assert.doesNotMatch(code, /\bcreate\s+policy\b|\balter\s+policy\b/i);
  assert.doesNotMatch(code, /storage\.objects/i);
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /\bconcurrently\b/i);
  assert.doesNotMatch(code, /security\s+definer/i);
  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, (code.match(/\bcreate table if not exists\b/gi) ?? []).length);
});

test("a 202611100002: uma linha só, checks nomeados, gatilho dentro de if not exists, RLS sem política e só o service_role", () => {
  const code = sqlCodeOf(read(MIGRATION));

  assert.match(code, /create table if not exists public\.license_state \(\s*id smallint primary key default 1,/);
  assert.match(code, /constraint license_state_single_row check \(id = 1\)/);
  assert.match(code, /constraint license_state_token_size check \(token is null or char_length\(token\) between 1 and 16384\)/);
  assert.match(code, /constraint license_state_installation_id_size check \(installation_id is null or char_length\(installation_id\) between 1 and 64\)/);
  assert.match(code, /constraint license_state_installation_secret_size check \(/);
  assert.match(code, /constraint license_state_check_in_sequence_size check \(check_in_sequence is null or char_length\(check_in_sequence\) between 1 and 128\)/);
  assert.match(code, /constraint license_state_check_in_result_format check \(check_in_result is null or check_in_result ~ '\^\[a-z_\]\{1,40\}\$'\)/);
  assert.match(code, /constraint license_state_last_check_in_pair check \(\(last_check_in_emissor_at is null\) = \(last_check_in_local_at is null\)\)/);
  assert.match(code, /constraint license_state_version_positive check \(version >= 0\)/);
  assert.equal((code.match(/\bcheck \(/g) ?? []).length, 8, "só os checks nomeados acima");

  assert.match(
    code,
    /do \$\$\s*begin\s*if not exists \(\s*select 1 from pg_trigger\s*where tgname = 'set_license_state_updated_at' and tgrelid = 'public\.license_state'::regclass\s*\) then\s*create trigger set_license_state_updated_at\s*before update on public\.license_state\s*for each row execute function public\.set_updated_at\(\);\s*end if;\s*end;\s*\$\$;/
  );
  assert.equal((code.match(/\bcreate trigger\b/gi) ?? []).length, 1);

  assert.match(code, /alter table public\.license_state enable row level security;/);
  assert.match(code, /revoke all on public\.license_state from anon, authenticated;/);
  assert.match(code, /grant select, insert, update, delete on public\.license_state to service_role;/);
  assert.doesNotMatch(code, /\bgrant\b[^;]*\b(?:anon|authenticated)\b/i, "nenhum privilégio para anon nem authenticated");
});

test("as migrações até a 202611010001 continuam byte a byte (a 202611100002 só acrescenta)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202611010001_webinars_v5_coapresentador.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 64);
  assert.equal(hash.digest("hex"), "5ce8b330f39f1180c45c06e7a744f2bbbf4e788637f6a74d33318fcc5e0ca8c8", "uma migração já aplicada mudou");
  assert.ok(files.includes("202611100002_license_state.sql"));
});

test("a 202611110001: uma seção MCP, idempotente, só duas colunas novas e dois checks nomeados dentro de if not exists", () => {
  const migration = read(REQUEST_HOST_MIGRATION);
  const code = sqlCodeOf(migration);

  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 1, "uma seção, marcada MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/);
  assert.doesNotMatch(code, /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/);
  for (const proibido of [/\bdrop\b/i, /\bdelete\s+from\b/i, /\bcreate\s+(?:or\s+replace\s+)?function\b/i, /\bcreate\s+policy\b|\balter\s+policy\b/i, /storage\.objects/i, /\btruncate\b/i, /security\s+definer/i, /\bgrant\b/i, /\bcreate table\b/i]) {
    assert.doesNotMatch(code, proibido);
  }

  assert.deepEqual(
    [...code.matchAll(/alter table public\.license_state add column if not exists ([a-z_]+) (text|timestamptz);/g)].map((match) => `${match[1]} ${match[2]}`),
    ["request_host text", "request_host_since timestamptz"]
  );
  assert.match(code, /add constraint license_state_request_host_size check \(request_host is null or char_length\(request_host\) between 1 and 260\);/);
  assert.match(code, /add constraint license_state_request_host_pair check \(\(request_host is null\) = \(request_host_since is null\)\);/);
  assert.equal((code.match(/\bcheck \(/g) ?? []).length, 2);
  assert.equal((code.match(/if not exists \(\s*select 1 from pg_constraint\s*where conname = 'license_state_request_host_(?:size|pair)' and conrelid = 'public\.license_state'::regclass\s*\) then/g) ?? []).length, 2);
});

test("o adaptador lê e grava só colunas que a tabela tem, e a tabela não tem coluna que o adaptador esqueça", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const body = code.slice(code.indexOf("create table if not exists public.license_state ("), code.indexOf("constraint license_state_single_row"));
  const added = [...sqlCodeOf(read(REQUEST_HOST_MIGRATION)).matchAll(/alter table public\.license_state add column if not exists ([a-z_]+) /g)].map((match) => match[1]);
  const tableColumns = [...body.matchAll(/^\s+([a-z_]+) (?:smallint|text|boolean|timestamptz|integer)\b/gm)].map((match) => match[1]).concat(added).sort();
  const adapter = read(`${LICENSING}store-db.ts`);
  const adapterColumns = adapter.match(/const COLUMNS =\s*"([^"]+)";/)[1].split(",").map((column) => column.trim()).sort();

  assert.deepEqual(tableColumns, [...adapterColumns, "created_at", "id", "updated_at"].sort());

  // Toda coluna que o adaptador grava está na lista que ele lê.
  for (const [, column] of adapter.matchAll(/columns\.([a-z_]+) =/g)) {
    assert.ok(adapterColumns.includes(column), column);
  }
});

test("quem grava: só o job do tick roda a rodada; ele, a situação do pedido e as ações da tela Licença criam o adaptador do banco", () => {
  const sources = sourceFiles("src/");
  const importers = (pattern) => sources.filter((file) => pattern.test(codeOf(read(file)))).sort();

  assert.deepEqual(importers(/\brunLicenseTick\b/), ["src/server/jobs/license-check-in-job.ts", `${LICENSING}tick.ts`]);
  assert.deepEqual(importers(/\bplanLicenseTick\b/), [`${LICENSING}store.ts`, `${LICENSING}tick.ts`]);
  assert.deepEqual(importers(/\blicenseStateDbOf\b/), [
    // A ativação pelo terminal (membros licenca e o instalador do kit): as mesmas operações da tela Licença.
    "src/app/api/licenca/instalador/route.ts",
    "src/server/jobs/license-check-in-job.ts",
    `${LICENSING}actions.ts`,
    `${LICENSING}current-state.ts`,
    // O endereço dos pedidos do dono e dos administradores (planRequestHostObservation), só quando muda.
    `${LICENSING}request-host.ts`,
    `${LICENSING}store-db.ts`
  ]);
  assert.deepEqual(importers(/\bplanRequestHostObservation\b/), [`${LICENSING}request-host.ts`, `${LICENSING}store.ts`]);
  assert.deepEqual(importers(/\bobserveAdminRequestHost\b/), ["src/app/admin/(v2)/layout.tsx", `${LICENSING}request-host.ts`]);
  assert.deepEqual(importers(/\blicense_state\b/), [`${LICENSING}store-db.ts`], "a tabela só é tocada pelo adaptador");
  // A conferência fora da rodada (Verificar agora) e as conversas da tela passam pela mesma reserva do store.
  assert.deepEqual(importers(/\brunLicenseCheckInNow\b/), [`${LICENSING}actions.ts`, `${LICENSING}tick.ts`]);
  assert.deepEqual(importers(/\bplanConversationStart\b/), [`${LICENSING}operations.ts`, `${LICENSING}store.ts`, `${LICENSING}tick.ts`]);
});

test("o segredo da Instalação só aparece no Verificador que fala com o banco e com o Emissor", () => {
  const sources = sourceFiles("src/");
  const citing = sources.filter((file) => /installation_?secret/i.test(codeOf(read(file)))).sort();

  assert.deepEqual(citing, [`${LICENSING}client.ts`, `${LICENSING}operations.ts`, `${LICENSING}store-db.ts`, `${LICENSING}store.ts`, `${LICENSING}tick.ts`]);

  const job = codeOf(read("src/server/jobs/license-check-in-job.ts"));
  const logs = [...job.matchAll(/console\.(?:info|warn|error)\(([\s\S]*?)\);/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(logs, /secret|token|sequence|nonce/i, "o log leva só motivos e códigos");
});

test("as regras ficam puras e o que toca no banco ou no Emissor é server-only", () => {
  for (const name of ["store.ts", "tick.ts", "state.ts", "operations.ts", "copy.ts", "screen-view.ts", "screen-result.ts", "degree-notice.ts", "admin-access.ts", "request-ids.ts", "node-start.ts", "installer.ts"]) {
    const source = read(`${LICENSING}${name}`);
    assert.doesNotMatch(source, /^import "server-only";/m, `${name} carrega pelo Node`);
    assert.doesNotMatch(source, /from "@\//, `${name} sem o alias "@/"`);
  }

  // Do cliente do Emissor, o tick só leva os tipos: o Node os apaga e o arquivo server-only nem é carregado.
  assert.match(read(`${LICENSING}tick.ts`), /^import type \{[^}]+\} from "\.\/client";$/m);
  assert.doesNotMatch(read(`${LICENSING}store.ts`), /from "\.\/client"/);

  for (const path of [
    `${LICENSING}client.ts`,
    `${LICENSING}store-db.ts`,
    `${LICENSING}current-state.ts`,
    `${LICENSING}degree-email.ts`,
    `${LICENSING}request-host.ts`,
    "src/server/jobs/license-check-in-job.ts"
  ]) {
    assert.match(read(path), /^import "server-only";/m, path);
  }

  // As ações da tela Licença são Server Actions (só rodam no servidor) e as operações delas só levam os tipos do cliente.
  assert.match(read(`${LICENSING}actions.ts`), /^"use server";/);
  assert.match(read(`${LICENSING}operations.ts`), /^import type \{[^}]+\} from "\.\/client";$/m);
});

test("o job licenca-conferencia está no registro do tick, antes da limpeza de arquivos, e no comentário dos jobs", () => {
  const registry = read("src/server/jobs/registry.ts");

  // As vendas guardadas (docs/32 §2.2) vem logo depois da conferencia: a licenca regularizada na rodada ja as libera.
  assert.match(registry, /export const jobRegistry: readonly Job\[\] = \[[^\]]*, licenseCheckInJob, heldSalesJob, licenseSalesJob, communicationMediaJob\];/);
  assert.match(registry, /- `licenca-conferencia` \(/);
});
