import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
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
//   usa scale-95 lista `scale` na transicao (`transform` nao cobre) e, com menos movimento, nao tem transicao;
// - a mesma regra em todo o src/ (desde a PR de correcao do docs/27 §10): o painel do sino, o icone de retomar de
//   Minhas compras e tres menus do admin listam `scale`. A guarda le os .ts e .tsx pelo parser do TypeScript: cada
//   texto entre aspas duplas ou simples, cada template literal e, juntos, os textos de cada cn(), clsx() e cva().

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

/** O arquivo lido pelo parser do TypeScript (o .tsx com JSX); os comentarios ficam de fora sozinhos. */
function parsed(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** O texto de um literal: entre aspas (duplas ou simples) ou template literal, com cada ${...} virando um espaco. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ") : null;
}

/**
 * Os textos de classe de um arquivo (as classes do JSX, do cn() e das constantes): cada texto entre aspas duplas ou
 * simples e cada template literal (o ${...} vira um espaco, e um texto de dentro dele conta a parte, como os outros).
 */
function classLiteralsOf(source, fileName = "amostra.tsx") {
  const out = [];
  const visit = (node) => {
    const text = literalText(node);

    if (text !== null) {
      out.push(text);
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed(source, fileName));

  return out;
}

/** As funcoes que juntam classes de varios argumentos. */
const CLASS_CALLS = new Set(["clsx", "cn", "cva"]);

/**
 * Os textos de cada chamada que junta classes (cn, clsx e cva), juntos por espaco: a escala e a transicao podem estar
 * em argumentos separados (`cn("transition-[opacity,scale]", open && "data-starting-style:scale-95")`). Entram os
 * textos de qualquer parte dos argumentos e o texto das constantes do proprio arquivo usadas ali (`cn(CLOSE_CLASS,
 * ...)`, com a constante iniciada por um texto ou por outra dessas chamadas).
 */
function classCallsOf(source, fileName = "amostra.tsx") {
  const file = parsed(source, fileName);
  const constants = new Map();
  const calls = [];
  const textsIn = (node, seen = new Set()) => {
    const out = [];
    const visit = (child) => {
      const text = literalText(child);

      if (text !== null) {
        out.push(text);
      } else if (ts.isIdentifier(child) && constants.has(child.text) && !seen.has(child.text)) {
        seen.add(child.text);
        out.push(...textsIn(constants.get(child.text), seen));
      }

      ts.forEachChild(child, visit);
    };

    visit(node);

    return out;
  };
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CLASS_CALLS.has(node.expression.text)) {
      calls.push(node);
    }

    ts.forEachChild(node, collect);
  };

  collect(file);

  return calls.map((call) => call.arguments.flatMap((argument) => textsIn(argument)).join(" "));
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

  // A conta de toda classe de src/ (a janela inclusive) fica no teste seguinte.

  // A janela (Dialog.Popup, data-member-popup): fade e escala de 95 % ao abrir e ao fechar, e nada com menos movimento.
  const dialog = await readFile(new URL("src/components/member/notifications/member-popup-dialog.tsx", root), "utf8");
  const windowClasses = classLiteralsOf(dialog).filter((classes) => /(?:^|\s)data-starting-style:scale-95(?:\s|$)/.test(classes));

  assert.equal(windowClasses.length, 1, "uma classe da janela com scale-95");
  const windowUtilities = windowClasses[0].split(/\s+/);

  assert.ok(windowUtilities.includes("transition-[opacity,scale]"), windowClasses[0]);
  assert.ok(windowUtilities.includes("data-ending-style:scale-95"), "fecha encolhendo");
  assert.ok(windowUtilities.includes("motion-reduce:transition-none"), "com menos movimento, sem transicao");
  assert.equal(scaleTransitionProblem(windowClasses[0]), null);

  // A entrada: o host monta a janela ja aberta, e o Base UI so marca o data-starting-style quando o Root ja montado
  // passa de fechado para aberto. Quem anima o primeiro desenho e o CSS (`starting:`, o @starting-style), na janela e
  // no veu; o Root recebe o open do host direto (nada muda quando a janela abre).
  assert.ok(windowUtilities.includes("starting:scale-95") && windowUtilities.includes("starting:opacity-0"), "entra crescendo e aparecendo");
  const veil = classLiteralsOf(dialog).filter((classes) => classes.split(/\s+/).includes("bg-black/70"));
  assert.equal(veil.length, 1, "uma classe do veu");
  assert.ok(veil[0].split(/\s+/).includes("starting:opacity-0"), "o veu entra aparecendo");
  assert.ok(veil[0].split(/\s+/).includes("motion-reduce:transition-none"), "o veu, com menos movimento, sem transicao");
  assert.match(dialog, /<Dialog\.Root[\s\S]*?\n\s+open=\{open\}\n\s+>/);
  assert.doesNotMatch(dialog, /requestAnimationFrame|useLayoutEffect|entered/, "a janela abre quando o host abre, sem esperar");
});

/** O que impede a escala de animar num texto de classe que tem transicao (null = nada, ou sem transicao). */
function scaleProblemWithTransition(classes) {
  const utilities = classes.split(/\s+/).map(utilityOf);

  return utilities.some((utility) => /^transition(?:$|-)/.test(utility)) ? scaleTransitionProblem(classes) : null;
}

/** Os problemas de escala de um arquivo: cada texto de classe e os textos de cada chamada cn, clsx e cva juntos. */
function scaleProblemsOf(source, fileName = "amostra.tsx") {
  return [...classLiteralsOf(source, fileName), ...classCallsOf(source, fileName)].map(scaleProblemWithTransition).filter(Boolean);
}

test("a guarda da escala lê aspas duplas e simples, template literals e os argumentos de um mesmo cn(), sem comentários", () => {
  // A mesma classe errada (a transicao lista transform, e no Tailwind 4 a escala e a propriedade scale) escrita de cada
  // jeito do codigo: antes, so a de aspas duplas era vista. As corretas (com scale ou com `transition`) passam. Montadas
  // aos pedacos: o Tailwind le os testes e poria as classes no CSS global (tailwind-regras-de-exemplo.guard).
  const wrong = ["transition-[opacity", "transform]"].join(",");
  const right = ["transition-[opacity", "scale]"].join(",");
  // Ja usada em src/ (os botoes da TV e da aula): nao vira regra nova.
  const cresce = "hover:scale-105";
  const open = ["data-starting-style", "scale-95"].join(":");
  const samples = {
    "aspas duplas": `<span className="${wrong} ${cresce}" />`,
    "aspas simples": `const classe = '${wrong} ${open}';`,
    "template literal": `<span className={\`grid ${wrong} ${cresce} \${extra}\`} />`,
    "texto dentro do template": `<span className={\`grid \${open ? "${wrong} ${cresce}" : ""}\`} />`,
    "argumentos do cn()": `const classe = cn("${wrong} duration-150", open && "${open}");`,
    "constante no cn()": `const BASE = "${wrong} duration-150";\nconst classe = cn(BASE, aberto && "${open}");`,
    "cva()": `const variantes = cva("${wrong}", { variants: { tamanho: { grande: "${cresce}" } } });`
  };

  for (const [name, source] of Object.entries(samples)) {
    assert.equal(scaleProblemsOf(source).length > 0, true, name);
    assert.equal(scaleProblemsOf(source.replaceAll(wrong, right)).length, 0, `${name}, com scale na transicao`);
    assert.equal(scaleProblemsOf(source.replaceAll(wrong, "transition")).length, 0, `${name}, com transition`);
  }

  // Comentarios nao contam (nem com a classe errada escrita nele); uma escala sem transicao tambem nao (nao anima).
  assert.deepEqual(scaleProblemsOf(`// "${wrong} ${cresce}"\n/* '${wrong} ${open}' */\nconst x = 1;`), []);
  assert.deepEqual(scaleProblemsOf(`const classe = cn("duration-150", "${cresce}");`), []);
  // Um .ts com tipo generico le como .ts (sem JSX), e o texto continua contando.
  assert.equal(scaleProblemsOf(`const lista = new Set<string>(["${wrong} ${cresce}"]);`, "modelo.ts").length, 1);
});

test("a escala anima em todo o src/: o painel do sino, o icone de retomar de Minhas compras e tres menus do admin listam scale", async () => {
  // Toda classe de src/ que escala e tem transicao lista scale (ou all, ou uma transicao que ja a cobre): a janela e os
  // cartoes do pop-up e, desde a PR de correcao do docs/27 §10, os cinco lugares de fora do Livre que listavam
  // transform e por isso pulavam sem animar. Conta cada texto de classe dos .ts e .tsx (entre aspas duplas ou simples
  // e em template literals) e, juntos, os textos de cada cn(), clsx() e cva() (com as constantes do proprio arquivo
  // usadas ali): o X do pop-up, que junta o pulso (motion-safe:scale-[1.12]) e a transicao em argumentos separados,
  // entra na conta. Quem anima o transform em linha (o fundo da barra do topo do aluno, com scaleY no style) nao tem
  // classe de escala e continua certo.
  const files = await sourceFiles("src/");
  const problems = [];
  let templates = 0;

  for (const file of files) {
    const source = await readFile(new URL(file), "utf8");
    const name = file.replace(root.href, "");

    for (const problem of scaleProblemsOf(source, name)) {
      problems.push(`${name}: ${problem}`);
    }

    templates += [...source.matchAll(/`([^`]*)`/g)].filter(([, text]) => /(?:^|\s)\S*scale-/.test(text) && /(?:^|\s)\S*transition/.test(text)).length;
  }

  assert.deepEqual(problems, []);
  // Os template literals que escalam com transicao (o fundo do cartao de curso, botoes da aula e da TV) entram na conta.
  assert.ok(templates >= 6, `template literals com escala e transicao: ${templates}`);

  for (const [path, piece] of [
    ["src/components/content-row.tsx", "group-hover/course:scale-[1.035]"],
    ["src/components/tv-receiver-experience.tsx", "hover:scale-105"]
  ]) {
    const texts = classLiteralsOf(await readFile(new URL(path, root), "utf8"), path).filter((text) => text.split(/\s+/).includes(piece) && text.split(/\s+/).includes("transition"));

    assert.ok(texts.length >= 1, `${path}: o template literal com ${piece} entra na conta`);
  }

  // O X do pop-up (os tres cartoes): a escala do pulso e a transicao em argumentos do mesmo cn(), juntas na conta.
  for (const path of ["src/components/member/notifications/member-popup.tsx", "src/components/member/notifications/popup-design/popup-design-card.tsx", "src/components/member/notifications/popup-free/popup-free-card.tsx"]) {
    const joined = classCallsOf(await readFile(new URL(path, root), "utf8"), path).filter((text) => text.split(/\s+/).includes("motion-safe:scale-[1.12]"));

    assert.equal(joined.length, 1, `${path}: um cn() com o pulso`);
    assert.ok(joined[0].split(/\s+/).some((utility) => /^transition-\[[^\]]*\bscale\b/.test(utility)), `${path}: a transicao do X lista scale (${joined[0]})`);
  }

  // Os cinco lugares, um a um: a classe que escala lista scale (nunca transform) e, com menos movimento, nada anima.
  const places = [
    ["src/components/member/shell/member-notifications-menu.tsx", "data-starting-style:scale-95", "transition-[opacity,scale]"],
    ["src/components/purchases-experience.tsx", "group-hover/resume:scale-105", "transition-[scale,background-color]"],
    ["src/components/admin/v2/styles.ts", "data-starting-style:scale-[0.98]", "transition-[opacity,scale]"],
    ["src/components/admin/v2/period-menu.tsx", "data-starting-style:scale-[0.98]", "transition-[opacity,scale]"],
    ["src/components/admin/v2/communication/popup-free/free-fields.tsx", "data-starting-style:scale-[0.98]", "transition-[opacity,scale]"]
  ];

  for (const [path, scaleClass, transition] of places) {
    assert.ok(files.includes(new URL(path, root).href), `${path} entra na conta de src/`);

    const classes = classLiteralsOf(await readFile(new URL(path, root), "utf8")).filter((text) => text.split(/\s+/).includes(scaleClass));

    assert.equal(classes.length, 1, `${path}: uma classe com ${scaleClass}`);

    const utilities = classes[0].split(/\s+/);

    assert.ok(utilities.includes(transition), `${path}: ${classes[0]}`);
    assert.equal(utilities.some((utility) => /^transition-\[[^\]]*\btransform\b/.test(utility)), false, `${path}: a transicao nao lista transform`);
    assert.ok(utilities.includes("motion-reduce:transition-none"), `${path}: com menos movimento, nada anima`);
    assert.equal(scaleTransitionProblem(classes[0]), null);
  }
});

test("CSP: fonte so do proprio app, data: e a origem do nosso Supabase (nada do Google na hora)", async () => {
  const proxy = await readFile(new URL("src/proxy.ts", root), "utf8");
  const line = proxy.split("\n").find((text) => text.includes("font-src"));

  assert.ok(line);
  assert.match(line, /font-src 'self' data: \$\{getSupabaseConnectionSources\(\)\.filter\(\(source\) => source\.startsWith\("http"\)\)/);
  assert.doesNotMatch(proxy, /fonts\.(?:googleapis|gstatic)\.com/);
});
