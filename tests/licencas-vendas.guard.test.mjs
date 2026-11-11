import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da venda que vira Licenca do Bunker Members (docs/32 §2.4 e §11.10; docs/18 §1.2): o que se le na migracao
// 202611130001 e no codigo.
// - a migracao: duas secoes MCP, idempotente, sem drop, delete, funcao nova, politica, Storage nem security definer; as
//   duas tabelas so do service_role, com os checks nomeados, o indice unico da chave e o gatilho com a funcao que ja existe;
// - as migracoes ate a 202611120001 continuam byte a byte;
// - o adaptador le so colunas que a tabela tem, e o banco aceita os estados que o app grava;
// - a configuracao da API interna: lida so por config.ts, nunca NEXT_PUBLIC_; o cliente nao segue redirecionamento, nao
//   usa cache e nao escreve log;
// - quem toca nas tabelas: so o store; as regras ficam puras; o que le o banco ou o Emissor e "server-only";
// - a Chave de ativacao nunca vai ao banco: as acoes do comprador nao gravam nada nosso;
// - o navegador so leva as Server Actions (nunca o cliente, o simulador nem a credencial);
// - a pagina e protegida pelo proxy; a tarefa esta no registro.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const MIGRATION = "supabase/migrations/202611130001_license_sales.sql";
const INTERNO = "src/server/licensing/interno/";

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath.replace(new URL(root).pathname, "").replace(/\/?$/, "/")}${entry.name}`);
}

test("a 202611130001: duas seções MCP, idempotente, sem drop, delete, função nova, política, Storage nem security definer", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);

  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 2, "duas secoes, marcadas MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/);
  assert.doesNotMatch(code, /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/);

  for (const proibido of [
    /\bdrop\b/i,
    /\bdelete\s+from\b/i,
    /\bcreate\s+(?:or\s+replace\s+)?function\b/i,
    /\bcreate\s+policy\b|\balter\s+policy\b/i,
    /storage\.objects/i,
    /\btruncate\b/i,
    /\bconcurrently\b/i,
    /security\s+definer/i
  ]) {
    assert.doesNotMatch(code, proibido);
  }

  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 2);
  assert.equal((code.match(/\bcreate table if not exists public\.license_(?:products|requests) \(/g) ?? []).length, 2);
  assert.equal((code.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (code.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
});

test("a 202611130001: as tabelas só do service_role, os checks nomeados, a chave única e o gatilho com a função que já existe", async () => {
  const code = sqlCodeOf(read(MIGRATION));
  const { LICENSE_REQUEST_STATUSES, LICENSE_REQUEST_KINDS } = await import("../src/server/licensing/interno/requests-model.ts");
  const { UNDO_REASONS } = await import("../src/server/licensing/interno/contract.ts");

  for (const tabela of ["license_products", "license_requests"]) {
    assert.match(code, new RegExp(`alter table public\\.${tabela} enable row level security;`));
    assert.match(code, new RegExp(`revoke all on public\\.${tabela} from anon, authenticated;`));
    assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${tabela} to service_role;`));
  }

  assert.doesNotMatch(code, /\bgrant\b[^;]*\b(?:anon|authenticated)\b/i);
  assert.match(code, /product_id text primary key references public\.content_items\(id\) on delete cascade/);
  assert.match(code, /user_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(code, /webhook_event_id uuid references public\.webhook_events\(id\) on delete set null/);
  assert.match(code, /create unique index if not exists license_requests_key_idx on public\.license_requests \(request_key\);/);
  assert.match(code, /create index if not exists license_requests_pending_idx\s+on public\.license_requests \(next_attempt_at, created_at\)\s+where status in \('pendente', 'enviando'\);/);
  assert.match(
    code,
    /do \$\$\s*begin\s*if not exists \(\s*select 1 from pg_trigger\s*where tgname = 'set_license_requests_updated_at' and tgrelid = 'public\.license_requests'::regclass\s*\) then\s*create trigger set_license_requests_updated_at\s*before update on public\.license_requests\s*for each row execute function public\.set_updated_at\(\);\s*end if;\s*end;\s*\$\$;/
  );

  // O banco aceita exatamente os estados, os tipos e os motivos que o app grava.
  const lista = (nome) => [...(code.match(new RegExp(`constraint ${nome} check \\(([^;]*?)\\),?\\n`))?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(lista("license_requests_status_known"), [...LICENSE_REQUEST_STATUSES].sort());
  assert.deepEqual(lista("license_requests_kind_known"), [...LICENSE_REQUEST_KINDS].sort());
  assert.match(code, /\(kind = 'venda' and reason is null\)\s*or \(kind = 'desfazer' and reason is not null and reason in \('reembolso', 'chargeback', 'cancelamento'\)\)/);
  assert.deepEqual([...UNDO_REASONS].sort(), ["cancelamento", "chargeback", "reembolso"]);
  assert.equal((code.match(/\bconstraint license_requests_\w+ check \(/g) ?? []).length, 14, "os checks nomeados");
});

test("as migrações até a 202611120001 continuam byte a byte (a 202611130001 só acrescenta)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202611120001_storage_paths_checks.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 69);
  assert.equal(hash.digest("hex"), "efa57777a284e9220fd3b01795ef8fce04b2df19871d28269a21739900880719", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202611130001_license_sales.sql"));
});

test("o adaptador lê só colunas que a tabela tem", async () => {
  const code = sqlCodeOf(read(MIGRATION));
  const body = code.slice(code.indexOf("create table if not exists public.license_requests ("), code.indexOf("constraint license_requests_key_size"));
  const tableColumns = [...body.matchAll(/^\s+([a-z_]+) (?:uuid|text|integer|boolean|timestamptz)\b/gm)].map((match) => match[1]).sort();
  const { LICENSE_REQUEST_COLUMNS } = await import("../src/server/licensing/interno/requests-model.ts");

  assert.deepEqual(tableColumns, [...LICENSE_REQUEST_COLUMNS.split(","), "created_at", "updated_at"].sort());
});

test("a configuração da API interna: só config.ts a lê, nunca com NEXT_PUBLIC_; o cliente sem redirecionamento, sem cache e sem log", () => {
  const sources = sourceFiles("src/");
  const leitores = sources.filter((file) => /process\.env\.EMISSOR_INTERNO|env\.EMISSOR_INTERNO/.test(codeOf(read(file))));

  assert.deepEqual(leitores, [`${INTERNO}config.ts`]);
  assert.deepEqual(sources.filter((file) => /NEXT_PUBLIC_EMISSOR/.test(read(file))), []);
  assert.doesNotMatch(read(".env.example"), /NEXT_PUBLIC_EMISSOR/);
  assert.match(codeOf(read(`${INTERNO}seller.ts`)), /readInternalEmissorConfig\(process\.env, \{ mode \}\)/, "a configuracao e lida ao rodar, nunca gravada no build");

  const cliente = codeOf(read(`${INTERNO}http-client.ts`));
  assert.match(cliente, /redirect: "error"/);
  assert.match(cliente, /cache: "no-store"/);
  assert.match(cliente, /authorization = `Bearer \$\{options\.credential\}`/);
  assert.match(cliente, /"x-pedido": call\.requestId/);

  for (const arquivo of ["http-client.ts", "contract.ts", "config.ts", "simulator.ts", "student-actions.ts", "student-model.ts", "holder.ts"]) {
    assert.doesNotMatch(codeOf(read(`${INTERNO}${arquivo}`)), /console\./, `${arquivo} nao escreve log`);
  }
});

test("quem toca nas tabelas: só o store; as regras ficam puras; o que lê o banco ou o Emissor é server-only", () => {
  const sources = sourceFiles("src/");
  const citing = sources.filter((file) => /\.from\(\s*["'`]license_(?:products|requests)["'`]/.test(codeOf(read(file)))).sort();

  assert.deepEqual(citing, [`${INTERNO}requests-store.ts`]);

  for (const nome of ["contract.ts", "config.ts", "http-client.ts", "simulator.ts", "holder.ts", "terms.ts", "requests-model.ts", "requests-view.ts", "seller-model.ts", "student-model.ts"]) {
    const source = read(`${INTERNO}${nome}`);
    assert.doesNotMatch(source, /^import "server-only";/m, `${nome} carrega pelo Node`);
    assert.doesNotMatch(source, /from "@\//, `${nome} sem o alias "@/"`);
  }

  for (const path of [`${INTERNO}seller.ts`, `${INTERNO}requests-store.ts`, `${INTERNO}requests-tick.ts`, `${INTERNO}sale-requests.ts`, `${INTERNO}student.ts`, `${INTERNO}admin-queries.ts`, "src/server/jobs/license-sales-job.ts", "src/server/actions/run-student-action.ts"]) {
    assert.match(read(path), /^import "server-only";/m, path);
  }

  for (const path of [`${INTERNO}admin-actions.ts`, `${INTERNO}student-actions.ts`]) {
    assert.match(read(path), /^"use server";/, path);
  }
});

test("a Chave de ativação nunca vai ao banco: as ações do comprador não gravam nada nosso nem importam o store", () => {
  const acoes = codeOf(read(`${INTERNO}student-actions.ts`));

  assert.doesNotMatch(acoes, /requests-store|getSupabaseAdminClient|\.insert\(|\.update\(|\.upsert\(/);
  assert.match(acoes, /runStudentAction\("licenses\.key", "atendimento",/);
  assert.match(acoes, /runStudentAction\("licenses\.revoke", "atendimento",/);
  assert.match(acoes, /runStudentAction\("licenses\.holder", "atendimento",/);
  // O dono: o pedido de chave e de revogar so sai depois de conferir a Licenca na lista da conta da sessao.
  assert.match(acoes, /const buyer = await requireOwnLicense\(user\.id, input\.licenseId\);\s*const issued = await buyer\.client\.issueKey\(/);
  assert.match(acoes, /const buyer = await requireOwnLicense\(user\.id, input\.licenseId\);\s*const revoked = await buyer\.client\.revokeKey\(input\.licenseId, \{ areaUserId: user\.id \}/);
  // A versao dos termos vem do servidor.
  assert.match(acoes, /aceiteTermos: \{ versao: LICENSE_TERMS_VERSION \}/);

  const store = codeOf(read(`${INTERNO}requests-store.ts`));
  assert.doesNotMatch(store, /\bchave\b/i, "a fila nunca tem a Chave");
});

test("o navegador só leva as Server Actions: nunca o cliente, o simulador, a configuração nem o modelo da fila", () => {
  const clientes = sourceFiles("src/").filter((file) => /^["']use client["'];/m.test(read(file)));
  const importamInterno = clientes.filter((file) => /from "@\/server\/licensing\/interno\//.test(read(file)));

  assert.deepEqual(importamInterno.sort(), [
    "src/components/admin/v2/products/license-product-card.tsx",
    "src/components/admin/v2/settings/sales/license-request-buttons.tsx",
    "src/components/member/licenses/holder-form.tsx",
    "src/components/member/licenses/license-key-actions.tsx"
  ]);

  for (const file of importamInterno) {
    const imports = [...read(file).matchAll(/from "@\/server\/licensing\/interno\/([a-z-]+)"/g)].map((match) => match[1]);
    assert.ok(imports.every((nome) => nome === "student-actions" || nome === "admin-actions"), `${file}: ${imports.join(", ")}`);
  }

  // O simulador so e criado pelo seller.ts (e pelos testes).
  const simuladores = sourceFiles("src/").filter((file) => file !== `${INTERNO}simulator.ts` && /createInternalEmissorSimulator\(/.test(codeOf(read(file))));
  assert.deepEqual(simuladores, [`${INTERNO}seller.ts`]);
});

test("a página é protegida pelo proxy, a tarefa está no registro e o passo da Licença roda depois da regra de acesso", () => {
  assert.match(read("src/proxy.ts"), /"\/minhas-compras",\s*"\/minhas-licencas",/);
  assert.match(read("src/server/jobs/license-sales-job.ts"), /export const LICENSE_SALES_JOB_NAME = "licencas-vendas";/);
  assert.match(read("src/server/jobs/registry.ts"), /- `licencas-vendas` \(/);

  const venda = codeOf(read("src/server/payments/process-sale.ts"));
  assert.match(venda, /const result = await processSaleAccess\(db, input\);\s*let license[^;]*;\s*try \{\s*license = await requestLicensesAfterSale\(db,/);

  const pagina = codeOf(read("src/app/minhas-licencas/page.tsx"));
  assert.match(pagina, /const page = await getMyLicensesPage\(user\.id\);\s*if \(!page\) \{\s*notFound\(\);/);
  assert.match(pagina, /canUseAccessPreview=\{false\}/, "a previa da equipe nunca abre Minhas licencas");
});
