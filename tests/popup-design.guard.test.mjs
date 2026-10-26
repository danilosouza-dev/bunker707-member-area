import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda do "Design do pop-up" (docs/26; docs/18 §1.2): regras de seguranca e de aplicacao que se leem no
// codigo. O comportamento (salvar, ler, mostrar) esta em popup-design-modelo.test.mjs e nos testes de
// integracao e de ponta a ponta dos pacotes U, S e A.
// - a 202610230001 e exatamente a do contrato (hash; o texto inteiro esta no spec do P0) e as migracoes de
//   Comunicacao ja aplicadas na nuvem nunca mudam;
// - as tres secoes passam pelo MCP: nada de drop, delete, gatilho nem funcao; a constraint dentro de if not exists;
// - communication_fonts com RLS e sem politica (so service_role); buckets e formatos iguais aos do app;
// - o desenho do aluno e o editor nunca usam dangerouslySetInnerHTML nem CSS em texto; o desenho do aluno nao
//   puxa o zod (o pedaco da janela do pop-up continua leve);
// - a CSP deixa baixar fonte so da origem do nosso Supabase;
// - a janela do pop-up anima a escala de verdade: no Tailwind 4 a escala e a propriedade `scale`, entao a classe que
//   usa scale-95 lista `scale` na transicao (`transform` nao cobre) e, com menos movimento, nao tem transicao.

const root = new URL("../", import.meta.url);
const migrations = new URL("supabase/migrations/", root);
const migration = await readFile(new URL("202610230001_communication_popup_design.sql", migrations), "utf8");
const model = await import("../src/server/communications/popup-design-model.ts");

/** Hash do arquivo combinado no contrato (spec do P0, §2): mudar a migracao exige mudar o contrato junto. */
const CONTRACT_SHA256 = "fe99f3d16ccf3455372d731b4bea43801aa35fd6266753a58ae1b09ab7c93750";

const APPLIED = {
  "202610200001_communication_v1.sql": "d4c0c3e33c1a4312a9001581148c2811eeaa2dd1bac1893ae9a58d17d8e60a23",
  "202610200002_communication_v2.sql": "8731688444b80cba7d94849908cf460496cb9975d28a8e2e73b89280b7d1c496",
  "202610210001_communication_v2_fixes.sql": "c4ac3b9a8f1a7aa5a1638b7017453a7bd30fdd135b01c287f1b5ff33011477f7",
  "202610220001_communication_v3a.sql": "2c6fc8a75dd84a777b414cbd35b491550e1c8e9bf1ba5c5b065e4f5840657c88",
  "202610220002_communication_v3a_ajustes.sql": "b7f3e3592ce6201a47613590f11db2ed36a9718860b86db73dc8dc3ee2f8cee2",
  "202610220003_communication_v3b1.sql": "34fcb8b340c6b9d9fc327ce8d501a2ab3dfaa4b534f80b60268e8dbfaf99d93a"
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Sem comentarios nem textos entre aspas simples: sobra so o que o banco executa. */
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

async function sourceFiles(directory) {
  const entries = await readdir(new URL(directory, root), { recursive: true, withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => new URL(`${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`, "file://").href);
}

test("a 202610230001 e a do contrato e as migracoes de Comunicacao ja aplicadas nao mudam", async () => {
  assert.equal(sha256(migration), CONTRACT_SHA256, "a migracao mudou: atualize o contrato (spec §2) e este hash juntos");

  for (const [file, hash] of Object.entries(APPLIED)) {
    assert.equal(sha256(await readFile(new URL(file, migrations), "utf8")), hash, `${file} ja foi aplicada e nao muda`);
  }
});

test("a migracao passa pelo MCP: tres secoes, nada de drop, delete, gatilho ou funcao, constraint com if not exists", () => {
  const code = codeOf(migration);

  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "o grant de delete ao service_role e o on delete set null podem");
  assert.doesNotMatch(code, /\btrigger\b/i);
  assert.doesNotMatch(code, /\bcreate\s+(?:or\s+replace\s+)?function\b/i);
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 3, "tres secoes, cada uma marcada MCP");
  assert.match(code, /if not exists \(select 1 from pg_constraint where conname = ''\) then\s+alter table public\.campaigns add constraint campaigns_popup_design_v1/);
  assert.match(migration, /add column if not exists popup_design jsonb;/);
  assert.match(migration, /kind = 'popup'/);
  assert.match(migration, /pg_column_size\(popup_design\) <= 32768/);
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
});

test("communication_fonts: RLS ligado, sem politica, so service_role; formatos iguais aos do app", () => {
  assert.match(migration, /create table if not exists public\.communication_fonts \(/);
  assert.match(migration, /alter table public\.communication_fonts enable row level security;/);
  assert.match(migration, /revoke all on public\.communication_fonts from anon, authenticated;/);
  assert.match(migration, /grant select, insert, update, delete on public\.communication_fonts to service_role;/);
  assert.doesNotMatch(migration, /create policy/i);

  assert.ok(migration.includes(`family_key ~ '${model.POPUP_FONT_FAMILY_PATTERN.source}'`), "familia: o mesmo formato do app");
  assert.ok(
    migration.includes("file_path ~ '^fonts/[a-f0-9]{24}\\.(woff2|woff|ttf|otf)$'") && model.POPUP_FONT_PATH_PATTERN.test("fonts/0123456789abcdef01234567.woff2"),
    "caminho: o mesmo formato do app"
  );
  assert.ok(migration.includes(`format in (${model.POPUP_FONT_FORMATS.map((format) => `'${format}'`).join(", ")})`));
  assert.ok(migration.includes(`style in (${model.POPUP_FONT_STYLES.map((style) => `'${style}'`).join(", ")})`));
  assert.ok(migration.includes(`size_bytes between 1 and ${model.POPUP_FONT_LIMITS.maxBytes}`));
});

test("buckets publicos com os limites e os tipos do app", () => {
  const bucket = (id) => {
    const match = new RegExp(`values \\(\\s*'${id}',\\s*'${id}',\\s*true,\\s*(\\d+),\\s*array\\[([^\\]]+)\\]`).exec(migration);
    assert.ok(match, `bucket ${id}`);
    return { limit: Number(match[1]), mimes: match[2].split(",").map((mime) => mime.trim().replace(/'/g, "")) };
  };

  assert.deepEqual(bucket(model.POPUP_VIDEO_BUCKET), { limit: model.POPUP_VIDEO_LIMITS.maxBytes, mimes: [...model.POPUP_VIDEO_MIME_TYPES] });
  assert.deepEqual(bucket(model.POPUP_FONTS_BUCKET), { limit: model.POPUP_FONT_LIMITS.maxBytes, mimes: ["font/woff2", "font/woff", "font/ttf", "font/otf"] });
  assert.equal((migration.match(/on conflict \(id\) do update/g) ?? []).length, 2);
});

test("desenho do aluno e editor do design: texto de verdade, nunca dangerouslySetInnerHTML nem CSS em texto", async () => {
  const files = [
    ...(await sourceFiles("src/components/member/notifications/popup-design/")),
    ...(await sourceFiles("src/components/admin/v2/communication/popup-design/")),
    new URL("src/components/member/notifications/member-popup.tsx", root).href,
    new URL("src/components/member/notifications/member-popup-dialog.tsx", root).href
  ];

  assert.ok(files.length >= 4, "os arquivos do design existem");

  for (const file of files) {
    const source = await readFile(new URL(file), "utf8");

    assert.doesNotMatch(source, /dangerouslySetInnerHTML/, file);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, file);
    assert.doesNotMatch(source, /cssText|insertRule|<style[\s>]/, `${file}: estilo so por objeto do React`);
  }
});

test("o desenho do aluno nao puxa o zod: so o modelo sem zod (o pedaco da janela do pop-up continua leve)", async () => {
  const modelSource = await readFile(new URL("src/server/communications/popup-design-model.ts", root), "utf8");
  assert.doesNotMatch(modelSource, /from "zod"/);

  for (const file of await sourceFiles("src/components/member/notifications/popup-design/")) {
    const source = await readFile(new URL(file), "utf8");

    assert.doesNotMatch(source, /from "zod"|popup-design-schema|communications\/schemas"/, file);
  }
});

/** A utilidade do Tailwind sem as variantes: `data-ending-style:scale-95` -> `scale-95` (o `:` dentro de [] fica). */
function utilityOf(token) {
  let depth = 0;
  let start = 0;

  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];

    if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth -= 1;
    } else if (char === ":" && depth === 0) {
      start = index + 1;
    }
  }

  return token.slice(start).replace(/^!|!$/g, "");
}

/**
 * Numa lista de classes que escala (scale-*), o que impede a escala de animar: nenhuma transicao, ou uma transicao
 * que nao cobre a propriedade `scale` do Tailwind 4. `transition`, `transition-all` e `transition-transform` cobrem
 * (no Tailwind 4 a ultima ja lista transform, translate, scale e rotate); a de lista entre colchetes, so com scale ou
 * all na lista.
 */
function scaleTransitionProblem(classes) {
  const utilities = classes.split(/\s+/).filter(Boolean).map(utilityOf);

  if (!utilities.some((utility) => /^-?scale-/.test(utility))) {
    return null;
  }

  const transitions = utilities.filter((utility) => /^transition(?:$|-)/.test(utility) && !/^transition-(?:none|discrete|normal)$/.test(utility));

  if (transitions.length === 0) {
    return "escala sem transicao";
  }

  const covers = (utility) => {
    if (utility === "transition" || utility === "transition-all" || utility === "transition-transform") {
      return true;
    }

    const list = /^transition-\[(.+)\]$/.exec(utility)?.[1].split(",").map((name) => name.trim());

    return Boolean(list?.includes("scale") || list?.includes("all"));
  };

  const missing = transitions.filter((utility) => !covers(utility));

  return missing.length > 0 ? `${missing.join(" ")} nao lista scale (no Tailwind 4 a escala e a propriedade scale, nao transform)` : null;
}

/** Os textos entre aspas duplas de uma linha de codigo (as classes do JSX e do cn()); comentarios ficam de fora. */
function classLiteralsOf(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .flatMap((line) => [...line.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1]));
}

test("a janela do pop-up anima a escala: a classe com scale-95 lista scale na transicao; menos movimento, sem transicao", async () => {
  // A guarda pega o defeito antigo (a escala pulava sem animar) e aceita as formas que animam.
  const before = "outline-none transition-[opacity,transform] duration-200 ease-out data-ending-style:scale-95 data-starting-style:scale-95";
  assert.match(scaleTransitionProblem(before) ?? "", /transition-\[opacity,transform\] nao lista scale/);
  assert.equal(scaleTransitionProblem("transition-[opacity,scale] data-starting-style:scale-95"), null);
  assert.equal(scaleTransitionProblem("transition-transform group-hover:scale-[1.03]"), null);
  assert.equal(scaleTransitionProblem("transition group-hover:scale-[1.03]"), null);
  // Montadas aos pedacos: o Tailwind le os testes e poria as duas no CSS global (tailwind-regras-de-exemplo.guard).
  const bracketVariant = ["data-[open]", "scale-95"].join(":");
  const allInList = ["transition-[opacity", "all]"].join(",");
  assert.equal(scaleTransitionProblem(`[&_svg]:size-5 ${bracketVariant} ${allInList}`), null);
  assert.equal(scaleTransitionProblem("focus-visible:[box-shadow:inset_0_0_0_4px_#000000b3]! transition-[filter]"), null, "sem escala, nada a conferir");
  assert.equal(scaleTransitionProblem("scale-95 transition-none"), "escala sem transicao");

  // Toda classe da pasta src/components/member/notifications (a janela, os cartoes do Padrão, do Personalizado e do
  // Livre) que escala e tem transicao lista scale. O X junta o pulso (motion-safe:scale-[1.12]) e a transicao em
  // textos separados do cn(), por isso fica fora desta conta (a dele ja lista scale). O menu do sino, o icone do
  // botao de retomar de Minhas compras e tres menus do admin, fora desta pasta, tem o mesmo defeito e ficam para uma
  // PR de correcao a parte (docs/27 §10).
  const files = await sourceFiles("src/components/member/notifications/");
  const problems = [];

  assert.ok(files.length >= 10, "os arquivos do pop-up existem");

  for (const file of files) {
    for (const classes of classLiteralsOf(await readFile(new URL(file), "utf8"))) {
      const utilities = classes.split(/\s+/).map(utilityOf);
      const problem = utilities.some((utility) => /^transition(?:$|-)/.test(utility)) ? scaleTransitionProblem(classes) : null;

      if (problem) {
        problems.push(`${file.replace(root.href, "")}: ${problem}`);
      }
    }
  }

  assert.deepEqual(problems, []);

  // A janela (Dialog.Popup, data-member-popup): fade e escala de 95 % ao abrir e ao fechar, e nada com menos movimento.
  const dialog = await readFile(new URL("src/components/member/notifications/member-popup-dialog.tsx", root), "utf8");
  const windowClasses = classLiteralsOf(dialog).filter((classes) => /(?:^|\s)data-starting-style:scale-95(?:\s|$)/.test(classes));

  assert.equal(windowClasses.length, 1, "uma classe da janela com scale-95");
  const windowUtilities = windowClasses[0].split(/\s+/);

  assert.ok(windowUtilities.includes("transition-[opacity,scale]"), windowClasses[0]);
  assert.ok(windowUtilities.includes("data-ending-style:scale-95"), "fecha encolhendo");
  assert.ok(windowUtilities.includes("motion-reduce:transition-none"), "com menos movimento, sem transicao");
  assert.equal(scaleTransitionProblem(windowClasses[0]), null);

  // A entrada so anima se o Root ja montado passar de fechado para aberto (o Base UI so marca o data-starting-style
  // nessa virada). O host monta a janela ja aberta: o Root nasce fechado e abre no quadro seguinte.
  assert.match(dialog, /const \[entered, setEntered\] = useState\(false\);/);
  assert.match(dialog, /const frame = window\.requestAnimationFrame\(\(\) => setEntered\(true\)\);\s+return \(\) => window\.cancelAnimationFrame\(frame\);/);
  assert.match(dialog, /<Dialog\.Root[\s\S]*?\n\s+open=\{open && entered\}\n\s+>/);
  assert.doesNotMatch(dialog, /\n\s+open=\{open\}\n/, "o Root nunca recebe o open do host direto");
});

test("CSP: fonte so do proprio app, data: e a origem do nosso Supabase (nada do Google na hora)", async () => {
  const proxy = await readFile(new URL("src/proxy.ts", root), "utf8");
  const line = proxy.split("\n").find((text) => text.includes("font-src"));

  assert.ok(line);
  assert.match(line, /font-src 'self' data: \$\{getSupabaseConnectionSources\(\)\.filter\(\(source\) => source\.startsWith\("http"\)\)/);
  assert.doesNotMatch(proxy, /fonts\.(?:googleapis|gstatic)\.com/);
});
