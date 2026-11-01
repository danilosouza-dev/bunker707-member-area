import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guarda da logo da area num lugar so (docs/31 V2-3; docs/18 §1.2: conferencia de texto so para regra de arquitetura,
// nunca como unico teste de um comportamento). O topo da area, a gaveta e o cabecalho da sala desenham a logo pela
// PlatformLogo (src/components/platform-logo.tsx), com as mesmas classes e o mesmo arquivo; nenhum deles volta a ter
// uma imagem de logo "parecida", com tamanho proprio. O comportamento fica em tests/webinarios-sala-tela.test.mjs (a
// tag da sala igual a do topo da area, o claro e o nome em texto) e no e2e da sala ao vivo (a mesma caixa e o mesmo
// arquivo no Chromium e no WebKit).

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const LUGARES = [
  "../src/components/app-shell.tsx",
  "../src/components/member/shell/member-sidebar.tsx",
  "../src/components/member/webinars/room/room-header.tsx"
];

test("guarda: o topo da area, a gaveta e a sala desenham a logo pela PlatformLogo, sem uma imagem de logo propria", async () => {
  for (const caminho of LUGARES) {
    const fonte = semComentarios(await source(caminho));
    assert.match(fonte, /import \{ PlatformLogo \} from "@\/components\/platform-logo";/, `${caminho}: importa a PlatformLogo`);
    assert.equal((fonte.match(/<PlatformLogo\b/g) ?? []).length, 1, `${caminho}: uma logo, pela PlatformLogo`);
    assert.doesNotMatch(fonte, /width=\{306\}/, `${caminho}: nenhuma <Image> de logo com a caixa propria (306 x 35)`);
  }
});
