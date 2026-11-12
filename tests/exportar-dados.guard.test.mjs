import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guarda do Exportar dados (docs/32 §2.2 e §4; docs/18 §1.2): o que se le no codigo.
// - a rota: a guarda da licenca com dever legal na primeira linha (passa em todo degrau, sem ler a licenca), so o dono e
//   os administradores (admin-access.ts), auditoria antes do primeiro byte, sem cache;
// - nada de segredo: os arquivos da exportacao nunca citam as tabelas e colunas que guardam segredo nem o payload bruto;
// - o ZIP e as regras das colunas ficam puros (os testes os carregam pelo Node); o que le o banco e "server-only";
// - a tela e montada no servidor (sem JavaScript novo) e tambem so para o dono e os administradores.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const ROUTE = "src/app/api/admin/dados/exportar/route.ts";
const PAGE = "src/app/admin/(v2)/configuracoes/dados/page.tsx";

test("a rota: dever legal na primeira linha, só o dono e os administradores, auditada e sem cache", () => {
  const code = codeOf(read(ROUTE));
  const body = code.slice(code.indexOf("export async function GET("));
  const first = body.slice(body.indexOf("{") + 1).trimStart();

  assert.match(first, /^const licenseRefusal = await licenseRouteRefusal\(\{ actionClass: "dever_legal" \}\);\s*if \(licenseRefusal\) return licenseRefusal;/);
  assert.match(body, /await requireApiAdmin\(\)/);
  assert.ok(body.indexOf("isLicenseManager(auth.access)") > body.indexOf("requireApiAdmin()"), "o papel depois da sessao");
  assert.ok(body.indexOf('action: "data.export"') < body.indexOf("new ReadableStream"), "a auditoria antes do primeiro byte");
  assert.match(body, /action: "data\.export_finished"/);
  assert.match(code, /"Cache-Control": NO_STORE/);
  assert.match(code, /const NO_STORE = "private, no-store";/);
  assert.doesNotMatch(code, /export async function (POST|PUT|PATCH|DELETE)\b/, "so leitura");
});

test("nenhum segredo: a exportação nunca cita as tabelas e colunas que guardam segredo, nem o payload bruto", () => {
  const files = readdirSync(new URL("src/server/export/", root)).map((name) => `src/server/export/${name}`);

  for (const path of [...files, ROUTE]) {
    const code = codeOf(read(path));
    for (const proibido of [/integration_settings/, /license_state/, /installation_secret/, /\bsecret\b/, /\bpayload\b/, /\btoken\b/i, /ai_provider/, /email_outbox/]) {
      assert.doesNotMatch(code, proibido, `${path}: ${proibido}`);
    }
  }
});

test("o ZIP e as colunas ficam puros; o que lê o banco é server-only; a tela é do servidor e só do dono e dos administradores", () => {
  for (const path of ["src/server/export/zip.ts", "src/server/export/school-data-model.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /^import "server-only";/m, `${path} carrega pelo Node`);
    assert.doesNotMatch(source, /from "@\//, `${path} sem o alias "@/"`);
  }

  assert.match(read("src/server/export/school-data.ts"), /^import "server-only";/m);
  assert.doesNotMatch(read("src/server/export/zip.ts"), /from "(?!node:)[^"]+"/, "o ZIP so com a biblioteca do Node (nenhuma dependencia nova)");

  const page = codeOf(read(PAGE));
  assert.doesNotMatch(page, /^["']use client["'];/m);
  assert.match(page, /if \(!isLicenseManager\(access\)\) \{\s*redirect\("\/admin\/configuracoes"\);/);
  assert.match(page, /download href=\{EXPORT_DATA_HREF\}/);
});
