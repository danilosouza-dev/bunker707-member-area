import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda do CSS global (docs/27 §7 e §13.11.1; docs/18 §1.2): o Tailwind 4 do build le todo arquivo do projeto fora
// do .gitignore (src/, mas tambem tests/ e docs/) e gera uma regra para cada classe que acha escrita, ate num
// comentario ou num exemplo de teste. Essas regras nao servem a nenhum componente e vao para todo aluno, em toda
// pagina. Aqui o mesmo scanner e o mesmo compilador do @tailwindcss/postcss leem o projeto como o build le, e cada
// classe que vira regra precisa estar escrita no codigo de src/ (um comentario nao conta).

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// As versoes que o proprio plugin do build resolve (o @tailwindcss/postcss do package.json).
const fromPlugin = createRequire(require.resolve("@tailwindcss/postcss"));
const { Scanner } = fromPlugin("@tailwindcss/oxide");
const { compile, __unstable__loadDesignSystem: loadDesignSystem } = fromPlugin("@tailwindcss/node");
const ts = require("typescript");

/**
 * Regras que ja vinham de exemplos antes do L6a (planos antigos em docs/superpowers, docs/12, docs/25 e dois
 * testes). A lista so encolhe: quem mexer num desses textos troca o exemplo por uma classe que o codigo ja usa e
 * tira a linha daqui. Classe nova de exemplo, so as que o codigo ja usa (docs/27 §13.11.1).
 */
const KNOWN_BEFORE_L6A = [
  "-ml-1",
  "bg-[linear-gradient(90deg,rgba(0,0,0,.94),rgba(0,0,0,.54)_45%,rgba(0,0,0,.28)),linear-gradient(0deg,rgba(0,0,0,.82),transparent_55%)]",
  "bg-background/80",
  "bg-muted/20",
  "bg-muted/30",
  "collapse",
  "data-highlighted:bg-white/10",
  "h-screen",
  "lg:grid-cols-[minmax(16rem,.7fr)_minmax(0,1.3fr)]",
  "m-75",
  "md:grid-cols-3",
  "md:p-6",
  "min-w-64",
  "min-w-[13rem]",
  "outline-white",
  "scale-[1.12]",
  "selection:bg-white",
  "xl:grid-cols-[1.15fr_0.85fr]",
  "xl:grid-cols-[17rem_minmax(0,1fr)_20rem]"
];

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * O arquivo de src/ sem os comentarios, no mesmo lugar (cada comentario vira espacos): e o que o codigo escreve. Em
 * TS e JS os comentarios saem pelo parser do TypeScript (um // dentro de string, regex ou texto do JSX fica); no CSS,
 * os blocos.
 */
function codeTextOf(file, content) {
  if (!SCRIPT_FILE.test(file)) {
    return content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  }

  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const comments = [];
  const visit = (node) => {
    if (ts.isJSDoc(node)) {
      return;
    }

    const children = node.getChildren(source);

    if (children.length > 0) {
      children.forEach(visit);
      return;
    }

    // Um token: os comentarios ficam no espaco antes dele (o fim do arquivo tambem e um token). O TypeScript chama de
    // "trailing" os da mesma linha do token anterior e de "leading" os das linhas seguintes: os dois contam.
    const start = node.getStart(source);
    const ranges = [...(ts.getTrailingCommentRanges(content, node.pos) ?? []), ...(ts.getLeadingCommentRanges(content, node.pos) ?? [])];

    for (const range of ranges) {
      if (range.end <= start) {
        comments.push(range);
      }
    }
  };

  visit(source);

  let code = "";
  let cursor = 0;

  for (const { pos, end } of comments.sort((a, b) => a.pos - b.pos)) {
    if (pos >= cursor) {
      code += content.slice(cursor, pos) + content.slice(pos, end).replace(/[^\n]/g, " ");
      cursor = end;
    }
  }

  return code + content.slice(cursor);
}

let asTheBuildSees;

/** O que o build faria: o compilador do globals.css, o scanner com as fontes dele e as classes que ele acha. */
function tailwindAsTheBuildSees() {
  asTheBuildSees ??= readTailwind();
  return asTheBuildSees;
}

async function readTailwind() {
  const cssFile = path.join(root, "src/app/globals.css");
  const css = await readFile(cssFile, "utf8");
  const base = path.dirname(cssFile);
  const compiler = await compile(css, { base, onDependency() {} });
  const rootSource = compiler.root === "none" ? [] : compiler.root === null ? [{ base: root, negated: false, pattern: "**/*" }] : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...rootSource, ...compiler.sources] });
  const candidates = scanner.scan();
  const designSystem = await loadDesignSystem(css, { base });

  return { candidates, designSystem, files: scanner.files, scanner };
}

function extensionOf(file) {
  return path.extname(file).slice(1);
}

test("o CSS global so tem regra de classe escrita no codigo de src/ (exemplo em teste, doc ou comentario nao vira regra)", async () => {
  const { candidates, designSystem, files, scanner } = await tailwindAsTheBuildSees();
  const srcFiles = files.filter((file) => path.relative(root, file).startsWith(`src${path.sep}`));

  assert.ok(srcFiles.length > 300, "o scanner le o src/ do projeto");
  assert.ok(files.some((file) => path.relative(root, file).startsWith(`tests${path.sep}`)), "e le tests/ (por isso esta guarda)");

  const inCode = new Set();

  for (const file of srcFiles) {
    const content = await readFile(file, "utf8");

    for (const { candidate } of scanner.getCandidatesWithPositions({ content: codeTextOf(file, content), extension: extensionOf(file) })) {
      inCode.add(candidate);
    }
  }

  const outsideCode = candidates.filter((candidate) => !inCode.has(candidate));
  const rules = designSystem.candidatesToCss(outsideCode);
  const fromExamples = outsideCode.filter((candidate, index) => rules[index]).sort();
  const known = new Set(KNOWN_BEFORE_L6A);
  const unexpected = fromExamples.filter((candidate) => !known.has(candidate));
  const where = new Map(unexpected.map((candidate) => [candidate, []]));

  if (unexpected.length > 0) {
    for (const file of files) {
      const content = await readFile(file, "utf8");

      for (const { candidate } of scanner.getCandidatesWithPositions({ content, extension: extensionOf(file) })) {
        if (where.has(candidate) && !where.get(candidate).includes(path.relative(root, file))) {
          where.get(candidate).push(path.relative(root, file));
        }
      }
    }
  }

  assert.deepEqual(
    unexpected.map((candidate) => `${candidate} (${where.get(candidate).join(", ")})`),
    [],
    "troque o exemplo por uma classe que o codigo ja usa, nomeie a constante ou monte o texto aos pedacos"
  );
  assert.deepEqual(KNOWN_BEFORE_L6A.filter((candidate) => !fromExamples.includes(candidate)), [], "ja nao vira regra: tire da lista");
});

test("so o codigo conta: classe num comentario de src/ nao vale como uso; na string, no template e no JSX, vale", async () => {
  const { designSystem } = await tailwindAsTheBuildSees();
  const scanner = new Scanner({ sources: [] });
  const candidatesOf = (file, content) =>
    scanner.getCandidatesWithPositions({ content: codeTextOf(file, content), extension: extensionOf(file) }).map(({ candidate }) => candidate);
  // Montadas aos pedacos: escritas inteiras, este arquivo (em tests/) poria as duas no CSS global.
  const nudge = ["translate", "y", "px"].join("-");
  const fadeAll = ["transition-[opacity", "all]"].join(",");

  assert.ok(designSystem.candidatesToCss([nudge, fadeAll]).every(Boolean), "as duas viram regra quando o scanner as acha");

  const component = [
    `// o ${nudge} num comentario`,
    `export const Z = 1; // o ${nudge} depois do codigo`,
    `/** ${fadeAll} num bloco */`,
    `export const A = "active:${nudge}";`,
    "export const B = `motion-reduce:transition-none ${A}`;",
    'export const C = () => <p className="outline-none">em https://exemplo.com.br um block de texto</p>;',
    `export const D = () => <div>{/* o ${nudge} no JSX */}</div>;`
  ].join("\n");
  const found = candidatesOf("exemplo.tsx", component);

  assert.ok(found.includes(`active:${nudge}`), "a string");
  assert.ok(found.includes("motion-reduce:transition-none"), "o template");
  assert.ok(found.includes("outline-none"), "o atributo do JSX");
  assert.ok(!found.includes(nudge), "o comentario de linha e o do JSX nao contam");
  assert.ok(!found.includes(fadeAll), "o comentario de bloco nao conta");
  assert.ok(found.includes("block"), "o texto do JSX fica, mesmo depois de um // que nao e comentario");
  assert.ok(!candidatesOf("exemplo.css", `.a { color: red } /* ${nudge} */`).includes(nudge), "nem o comentario do CSS");
});
