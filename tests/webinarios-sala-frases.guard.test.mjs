import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda das frases da sala do webinario (docs/30 §2.7 e §10.1; docs/31 §1; docs/18 §2.7, por isso .guard): o texto
// do codigo-fonte, que nenhum teste de tela alcanca por inteiro (o servidor pinta so o computador e nada aberto). Toda
// frase que o aluno le ou ouve na sala vem de WEBINAR_COPY (src/lib/webinar-copy.ts e src/lib/webinar-copy-v4/, que
// tests/webinarios-frases.test.mjs confere contra a PROIBIDAS_WEBINARIO) ou das provisorias de LIVE_ROOM_COPY: nenhum
// texto escrito direto no JSX e nenhum aria-label, title, placeholder ou alt literal. Vale para os arquivos da sala ao
// vivo de antes do redesign V2 e para as pecas novas da sala V2, que a live, a gravada e o Replay dividem.

const root = fileURLToPath(new URL("../", import.meta.url));
const ROOM = "src/components/member/webinars/room";
const ler = (caminho) => readFileSync(path.join(root, caminho), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\}/g, "");

/** Os arquivos da sala que desenham ou nomeiam alguma coisa. */
const FONTES = {
  // A sala ao vivo de antes do redesign V2.
  "live-controls": `${ROOM}/live-controls.tsx`,
  "live-notices": `${ROOM}/live-notices.tsx`,
  "live-room": `${ROOM}/live-room.tsx`,
  "live-settings": `${ROOM}/live-settings.tsx`,
  "live-stage": `${ROOM}/live-stage.tsx`,
  // As pecas da sala V2 (docs/31 V2-3 a V2-19), nas tres salas, e a sala da gravada e do Replay que as monta.
  "recorded-controls": `${ROOM}/recorded-controls.tsx`,
  "room-bar": `${ROOM}/room-bar.tsx`,
  "room-chat": `${ROOM}/room-chat.tsx`,
  "room-chat-pills": `${ROOM}/room-chat-pills.tsx`,
  "room-header": `${ROOM}/room-header.tsx`,
  "room-layout-model": `${ROOM}/room-layout-model.ts`,
  "room-panel": `${ROOM}/room-panel.tsx`,
  "room-poll-layer": `${ROOM}/room-poll-layer.tsx`,
  "room-polls": `${ROOM}/room-polls.tsx`,
  "room-stage-badges": `${ROOM}/room-stage-badges.tsx`,
  "room-ui": `${ROOM}/room-ui.tsx`,
  "room-view-menu": `${ROOM}/room-view-menu.tsx`,
  "webinar-room": `${ROOM}/webinar-room.tsx`
};

/**
 * O texto direto no JSX: algo com duas letras ou mais entre o > de uma tag e o < seguinte, na mesma linha e fora das
 * chaves. A seta (=>) nunca fecha uma tag, entao o > dela nao conta: o tipo `() => Promise<number>` e a conta
 * `(at) => nowMs - at < 60_000` nao sao frase.
 */
function textosNoJsx(codigo) {
  return codigo.match(/(?<!=)>[^<>{}\n]*[A-Za-zÀ-ú]{2,}[^<>{}\n]*</g) ?? [];
}

/** Os rotulos escritos direto, no lugar de uma frase de WEBINAR_COPY. */
function rotulosLiterais(codigo) {
  return codigo.match(/\b(aria-label|title|placeholder|alt)="[^"]+"/g) ?? [];
}

test("o detector acha o texto e o rotulo escritos direto, e deixa passar a seta do TypeScript e a frase pela copy", () => {
  assert.deepEqual(textosNoJsx('<span className="x">Sair</span>'), [">Sair<"]);
  assert.deepEqual(textosNoJsx("<p>\n  {copy.sair}\n</p>"), [], "a frase pela copy, entre chaves");
  assert.deepEqual(textosNoJsx("onRemoveMine: () => Promise<number>;"), [], "a seta de um tipo");
  assert.deepEqual(textosNoJsx("previous.filter((at) => nowMs - at < 60_000)"), [], "a seta de uma conta");
  assert.deepEqual(rotulosLiterais('<button aria-label="Fechar" title={copy.fechar}>'), ['aria-label="Fechar"']);
  assert.deepEqual(rotulosLiterais('<Image alt="Bunker707" />'), ['alt="Bunker707"']);
  assert.deepEqual(rotulosLiterais("<Image alt={copy.marca} />"), []);
});

test("as frases da sala sao todas de WEBINAR_COPY (ou das provisorias de LIVE_ROOM_COPY): nenhum texto escrito direto no desenho", () => {
  for (const [nome, caminho] of Object.entries(FONTES)) {
    const codigo = semComentarios(ler(caminho));
    assert.deepEqual(textosNoJsx(codigo), [], `${nome}: texto direto no JSX`);
    assert.deepEqual(rotulosLiterais(codigo), [], `${nome}: rotulo escrito direto`);
  }
});

test("Configurações tomou o lugar do Como usar, com a frase provisoria de LIVE_ROOM_COPY; a marca do cabecalho vem da copy", () => {
  const controls = ler(FONTES["live-controls"]);
  assert.match(controls, /LIVE_ROOM_COPY\.configuracoes/);
  assert.doesNotMatch(controls, /comoUsar|Keyboard/, "o Como usar virou o painel Configurações");
  assert.match(ler(`${ROOM}/live-room-model.ts`), /export const LIVE_ROOM_COPY = \{/);
  // Sem a logo de Marca, o nome da escola em texto (e o alt da logo) pela mesma frase (docs/31 V2-3).
  const header = semComentarios(ler(FONTES["room-header"]));
  assert.match(header, /alt=\{copy\.marca\}/);
  assert.match(header, />\{copy\.marca\}</);
});
