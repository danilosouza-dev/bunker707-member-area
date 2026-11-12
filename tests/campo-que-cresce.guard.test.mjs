import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda do campo que cresce com o texto (docs/30 D81; docs/18 §2.7, por isso .guard): a medida mora num lugar so
// (src/components/use-auto-grow-textarea.ts, com o comportamento em tests/campo-que-cresce.test.mjs). Um campo novo que
// copiasse o `height = min(scrollHeight, teto)` de antes voltaria a ficar com 0px quando monta escondido; aqui, nenhum
// arquivo de src/ grava a altura a partir do scrollHeight fora do ajudante, e os campos que crescem usam o ajudante.

const root = fileURLToPath(new URL("../", import.meta.url));
const AJUDANTE = "src/components/use-auto-grow-textarea.ts";

function arquivos(pasta) {
  return readdirSync(path.join(root, pasta)).flatMap((nome) => {
    const relativo = `${pasta}/${nome}`;
    return statSync(path.join(root, relativo)).isDirectory() ? arquivos(relativo) : /\.tsx?$/.test(nome) ? [relativo] : [];
  });
}

test("D81: nenhum arquivo de src/ grava a altura de um campo pelo scrollHeight fora do ajudante", () => {
  const copias = arquivos("src").filter((arquivo) => arquivo !== AJUDANTE && /\.style\.height\s*=[^;\n]*scrollHeight/.test(readFileSync(path.join(root, arquivo), "utf8")));
  assert.deepEqual(copias, [], "use useAutoGrowTextarea");
});

test("D81: os campos que crescem com o texto usam o ajudante", () => {
  for (const arquivo of [
    "src/components/member/webinars/room/room-comment-field.tsx",
    "src/components/member/webinars/room/room-reply-field.tsx",
    "src/components/lesson/lesson-comment-composer.tsx",
    "src/components/lesson-ai-tutor.tsx",
    "src/components/platform-director-chat.tsx"
  ]) {
    assert.match(readFileSync(path.join(root, arquivo), "utf8"), /useAutoGrowTextarea\(/, arquivo);
  }
});
