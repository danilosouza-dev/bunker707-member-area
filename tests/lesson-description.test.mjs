import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Descricao da aula com "Ver mais" / "Ver menos" (como no YouTube): fechada em tres linhas, o botao so
// aparece quando o texto nao cabe, e a pagina da aula usa o componente no lugar do paragrafo aberto.

const componentSource = await readFile(new URL("../src/components/lesson/lesson-description.tsx", import.meta.url), "utf8");
const experienceSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");

test("descricao da aula fecha em tres linhas e abre com Ver mais / Ver menos", () => {
  assert.match(componentSource, /!expanded && "line-clamp-3"/, "fechada: tres linhas");
  assert.match(componentSource, /whitespace-pre-line/, "quebras de linha do produtor");
  assert.match(componentSource, /scrollHeight > paragraph\.clientHeight \+ 1/, "o botao depende de o texto transbordar");
  assert.match(componentSource, /\{overflows \|\| expanded \? \(/, "sem botao quando o texto cabe");
  assert.match(componentSource, /\{expanded \? "Ver menos" : "Ver mais"\}/);
  assert.match(componentSource, /aria-expanded=\{expanded\}/);
  assert.match(componentSource, /type="button"/);
});

test("a pagina da aula usa o componente, reiniciando ao trocar de aula", () => {
  assert.match(experienceSource, /import \{ LessonDescription \} from "@\/components\/lesson\/lesson-description";/);
  assert.match(experienceSource, /<LessonDescription className="mt-4" key=\{activeLesson\.id\} text=\{activeLesson\.description\} \/>/);
  assert.doesNotMatch(experienceSource, /<p className="mt-4 max-w-4xl text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">\s*\{activeLesson\.description\}/);
});
