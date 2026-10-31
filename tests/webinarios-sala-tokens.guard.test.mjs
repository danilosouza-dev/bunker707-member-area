import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda dos tokens da sala do webinario (docs/31 V2-11 e V2-12; docs/18 §2.7, por isso .guard): o texto do CSS e dos
// componentes, que nenhum teste de tela alcanca. O tema claro e o escuro moram em dois blocos de globals.css, cada um
// com TODOS os --room-* (um nome que falta num deles deixaria a cor vazia so naquele tema); cada --color-room-* do
// @theme inline aponta para um --room-* que existe; as superficies fora do video nao voltam aos hex fixos de antes; e o
// atributo data-room-theme fica so no dialogo da sala, nunca no :root nem no html (a area continua escura).

const root = fileURLToPath(new URL("../", import.meta.url));
const ler = (caminho) => readFileSync(path.join(root, caminho), "utf8");
const CSS = ler("src/app/globals.css");
const semComentariosCss = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const css = semComentariosCss(CSS);

/** O corpo de um bloco de regra pelo seletor exato (o primeiro). */
function bloco(seletor) {
  const inicio = css.indexOf(`${seletor} {`);
  assert.ok(inicio >= 0, `o bloco ${seletor} existe`);
  const abre = css.indexOf("{", inicio);
  const fecha = css.indexOf("}", abre);
  return css.slice(abre + 1, fecha);
}

/** Os nomes --room-* definidos num corpo de bloco, com o valor. */
function definicoes(corpo) {
  return new Map([...corpo.matchAll(/(--room-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, nome, valor]) => [nome, valor.trim()]));
}

const ESCURO = definicoes(bloco('[data-room-theme="dark"]'));
const CLARO = definicoes(bloco('[data-room-theme="light"]'));

test("os dois temas definem os mesmos --room-*, cada um com o color-scheme dele", () => {
  assert.ok(ESCURO.size >= 30, `tokens do escuro: ${ESCURO.size}`);
  assert.deepEqual([...CLARO.keys()].sort(), [...ESCURO.keys()].sort(), "todo --room-* nos DOIS blocos");
  assert.match(bloco('[data-room-theme="dark"]'), /color-scheme:\s*dark;/);
  assert.match(bloco('[data-room-theme="light"]'), /color-scheme:\s*light;/);
  // Os valores do texto aprovado (V2-11): o fundo, o painel e o ativo de cada tema.
  assert.equal(ESCURO.get("--room-bg"), "#141414");
  assert.equal(CLARO.get("--room-bg"), "#f4f4f3");
  assert.equal(ESCURO.get("--room-surface"), "#171717");
  assert.equal(CLARO.get("--room-surface"), "#ffffff");
  assert.equal(ESCURO.get("--room-active-bg"), "#ffffff");
  assert.equal(CLARO.get("--room-active-bg"), "#141414");
  // Nenhum --room-* fora dos dois blocos (um terceiro lugar poderia vencer um deles).
  const fora = semComentariosCss(CSS)
    .replace(/\[data-room-theme="(?:dark|light)"\]\s*\{[^}]*\}/g, "")
    .match(/(^|[;{\s])--room-[a-z0-9-]+\s*:/gm);
  assert.equal(fora, null, "--room-* so nos dois blocos");
});

test("cada --color-room-* do @theme inline aponta para um --room-* definido (as classes bg-room-*, text-room-*)", () => {
  const tema = css.slice(css.indexOf("@theme inline {"));
  const corpo = tema.slice(0, tema.indexOf("}"));
  const cores = [...corpo.matchAll(/--color-(room-[a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)\s*;/g)];
  assert.ok(cores.length >= 30, `cores da sala no @theme: ${cores.length}`);
  for (const [, nome, alvo] of cores) {
    assert.equal(alvo, nome, `--color-${nome} aponta para --${nome}`);
    assert.ok(ESCURO.has(`--${alvo}`), `--${alvo} definido`);
  }
  // Toda cor do tema tem a classe; so a sombra da aba ativa fica de fora (nao e cor).
  const comClasse = new Set(cores.map(([, nome]) => `--${nome}`));
  assert.deepEqual(
    [...ESCURO.keys()].filter((nome) => !comClasse.has(nome)),
    ["--room-tab-on-shadow"]
  );
});

test("as superficies fora do video nao voltam aos hex fixos de antes (#0b0b0b, #111, #0f0f0f, #161616, #1b1b1b, #121212)", () => {
  const ROOM = "src/components/member/webinars/room";
  const arquivos = [
    "room-chat.tsx",
    "room-questions.tsx",
    "room-polls.tsx",
    "room-reactions.tsx",
    "room-header.tsx",
    "room-ui.tsx",
    "live-controls.tsx",
    "room-bar.tsx",
    "recorded-controls.tsx",
    "live-settings.tsx",
    "live-notices.tsx",
    "live-room.tsx",
    "webinar-room.tsx",
    ...readdirSync(path.join(root, ROOM, "assistant")).map((nome) => `assistant/${nome}`)
  ].map((nome) => `${ROOM}/${nome}`);
  arquivos.push("src/components/member/webinars/translation/room-translation-bar.tsx", `${ROOM}/vertical/vertical-model.ts`);
  const HEX = ["0b0b0b", "111", "0f0f0f", "161616", "1b1b1b", "121212"];
  const proibido = new RegExp(`#(?:${HEX.join("|")})(?![0-9a-f])`, "i");
  for (const arquivo of arquivos) {
    assert.ok(statSync(path.join(root, arquivo)).isFile(), arquivo);
    let codigo = semComentarios(ler(arquivo));
    if (arquivo.endsWith("vertical-model.ts")) {
      // O desenho vertical 9:16 fica sobre o video e continua como esta: so o esqueleto normal entra aqui.
      const inicio = codigo.indexOf("const NORMAL_CONFIRM");
      const fim = codigo.indexOf("\n}\n", codigo.indexOf("export function roomSkeleton"));
      assert.ok(inicio >= 0 && fim > inicio, "o esqueleto da sala em vertical-model.ts");
      codigo = codigo.slice(inicio, fim).replace(/if \(design === "vertical"\) \{[\s\S]*?\n {2}\}/, "");
      assert.match(codigo, /root: "[^"]*bg-room-bg[^"]*"/, "o fundo do desenho normal pelo token");
    }
    assert.doesNotMatch(codigo, proibido, arquivo);
  }
});

test("data-room-theme fica so no dialogo da sala: nunca no :root, no html ou no body", () => {
  // No CSS: so os dois blocos, sem :root, html ou body na frente nem :has() de fora.
  const seletores = [...css.matchAll(/([^{}]*\[data-room-theme[^{}]*)\{/g)].map(([, seletor]) => seletor.trim());
  assert.deepEqual(seletores.sort(), ['[data-room-theme="dark"]', '[data-room-theme="light"]']);
  assert.doesNotMatch(css, /(?::root|html|body)[^{,]*data-room-theme/);

  // No codigo: o atributo so nas duas salas, como atributo do dialogo; ninguem o poe no documento.
  const quem = [];
  const visitar = (pasta) => {
    for (const nome of readdirSync(path.join(root, pasta))) {
      const caminho = `${pasta}/${nome}`;
      if (statSync(path.join(root, caminho)).isDirectory()) {
        visitar(caminho);
      } else if (/\.(?:tsx?|mjs|js)$/.test(nome) && /data-room-theme|roomTheme/.test(semComentarios(ler(caminho)))) {
        quem.push(caminho);
      }
    }
  };
  visitar("src");
  assert.deepEqual(quem.sort(), ["src/components/member/webinars/room/live-room.tsx", "src/components/member/webinars/room/webinar-room.tsx"]);
  for (const arquivo of quem) {
    const codigo = semComentarios(ler(arquivo));
    assert.equal((codigo.match(/data-room-theme=/g) ?? []).length, 1, `${arquivo}: um so atributo, o do dialogo`);
    assert.match(codigo, /role="dialog"/);
    assert.doesNotMatch(codigo, /documentElement|document\.body\.(?:dataset|setAttribute)/, arquivo);
  }
  // A gravada e o replay passam pela regra do vertical (sempre escuro), testada em webinarios-sala-v2-modelo.
  assert.match(semComentarios(ler("src/components/member/webinars/room/webinar-room.tsx")), /data-room-theme=\{themeForDesign\(design, theme\)\}/);
});

/* --------------------------------------------------------------------------------------------------------------
 * O contraste dos dois temas (docs/12: texto pequeno com 4,5:1). Os valores saem dos dois blocos de globals.css;
 * um fundo translucido e composto sobre o painel (--room-surface, ele mesmo sobre --room-bg), como a sala desenha.
 * -------------------------------------------------------------------------------------------------------------- */

function rgba(valor) {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor);
  if (hex) {
    return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(valor);
  assert.ok(fn, `cor que o teste entende: ${valor}`);
  const [r, g, b, a = 1] = fn[1].split(",").map(Number);
  return [r, g, b, a];
}

/** A cor de cima composta sobre a de baixo (opaca). */
function sobre(cima, baixo) {
  const a = cima[3];
  return [0, 1, 2].map((i) => cima[i] * a + baixo[i] * (1 - a)).concat(1);
}

function luminancia([r, g, b]) {
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** O texto pequeno de cada fundo da sala (fora do video). */
const PARES_DE_TEXTO = {
  // Os fundos onde ficam textos de 11 a 14 px: a sala, o painel, os cards (enquete, pergunta), a fixada, a linha do
  // campo, a lista das abas e o circulo da barra.
  fundos: ["bg", "surface", "surface-2", "pinned", "composer", "tabs", "control"],
  textos: ["fg", "fg-strong", "fg-muted", "fg-subtle", "icon", "meta-name", "success-fg", "warn-fg", "bubble-other-fg"]
};

for (const [nomeDoTema, tema] of [
  ["escuro", ESCURO],
  ["claro", CLARO]
]) {
  test(`tema ${nomeDoTema}: todo texto da sala com 4,5:1 sobre os fundos dela (docs/12)`, () => {
    const cor = (nome) => rgba(tema.get(`--room-${nome}`));
    const sala = cor("bg");
    const painel = sobre(cor("surface"), sala);
    const fundo = (nome) => (nome === "bg" ? sala : sobre(cor(nome), painel));
    const falhas = [];
    const conferir = (rotulo, texto, atras) => {
      const valor = contraste(texto, atras);
      if (valor < 4.5) {
        falhas.push(`${rotulo}: ${valor.toFixed(2)}`);
      }
    };

    for (const nomeDoFundo of PARES_DE_TEXTO.fundos) {
      for (const nomeDoTexto of PARES_DE_TEXTO.textos) {
        conferir(`${nomeDoTexto} sobre ${nomeDoFundo}`, cor(nomeDoTexto), fundo(nomeDoFundo));
      }
    }
    const card = fundo("surface-2");
    // O selo de sucesso (RoomBadge success: o verde de quem fala a 10 % sobre o card) e o aviso (Sair, remover).
    conferir("success-fg sobre o selo de sucesso", cor("success-fg"), sobre([...cor("speaking").slice(0, 3), 0.1], card));
    for (const nomeDoTexto of ["warn-fg", "fg-strong", "fg-muted"]) {
      conferir(`${nomeDoTexto} sobre o aviso`, cor(nomeDoTexto), sobre(cor("warn-bg"), painel));
    }
    // A porcentagem da enquete fica no texto principal, por cima da barra cheia.
    conferir("fg sobre a barra da enquete", cor("fg"), sobre(cor("poll-bar"), card));
    // O ativo, o meu balao e a aba ativa.
    conferir("active-fg sobre active-bg", cor("active-fg"), sobre(cor("active-bg"), painel));
    conferir("bubble-mine-fg sobre bubble-mine-bg", cor("bubble-mine-fg"), sobre(cor("bubble-mine-bg"), painel));
    conferir("tab-on-fg sobre tab-on-bg", cor("tab-on-fg"), sobre(cor("tab-on-bg"), painel));
    assert.deepEqual(falhas, [], `pares abaixo de 4,5:1 no tema ${nomeDoTema}`);

    // A barra do resultado aparece sobre o card (a porcentagem escrita leva o dado; a barra so precisa se ver).
    assert.ok(contraste(sobre(cor("poll-bar"), card), card) >= 1.3, "a barra da enquete se distingue do card");
  });
}

test("o acento (#e50914) so no Sair: o RoomButton danger e so o Sair das confirmacoes (docs/31 V2-11)", () => {
  const ROOM = "src/components/member/webinars/room";
  const usos = [];
  const visitar = (pasta) => {
    for (const nome of readdirSync(path.join(root, pasta))) {
      const caminho = `${pasta}/${nome}`;
      if (statSync(path.join(root, caminho)).isDirectory()) {
        visitar(caminho);
      } else if (/\.tsx?$/.test(nome)) {
        const codigo = semComentarios(ler(caminho));
        // A abertura da tag pode ter "=>" (onClick={() => ...}): so o ">" sozinho a fecha.
        for (const [, filhos] of codigo.matchAll(/<RoomButton\b(?:=>|[^>])*?\bvariant="danger"(?:=>|[^>])*>([\s\S]*?)<\/RoomButton>/g)) {
          usos.push(`${caminho}: ${filhos.trim()}`);
        }
        assert.doesNotMatch(codigo, /roomButtonClassName\(\{[^}]*variant:\s*"danger"/, `${caminho}: danger so no RoomButton do Sair`);
      }
    }
  };
  visitar(ROOM);
  assert.ok(usos.length >= 2, `o Sair das duas salas: ${usos.join(" | ")}`);
  for (const uso of usos) {
    assert.match(uso, /: \{copy\.sair\}$/, uso);
  }
});

test("o RoomButton cheio no acento (accent) e so o Sair: o do cabecalho e o da barra (docs/31 V2-6 e V2-11)", () => {
  const ROOM = "src/components/member/webinars/room";
  const usos = [];
  const visitar = (pasta) => {
    for (const nome of readdirSync(path.join(root, pasta))) {
      const caminho = `${pasta}/${nome}`;
      if (statSync(path.join(root, caminho)).isDirectory()) {
        visitar(caminho);
      } else if (/\.tsx?$/.test(nome)) {
        const codigo = semComentarios(ler(caminho));
        for (const [, filhos] of codigo.matchAll(/<RoomButton\b(?:=>|[^>])*?\bvariant="accent"(?:=>|[^>])*>([\s\S]*?)<\/RoomButton>/g)) {
          usos.push({ caminho, filhos: filhos.trim() });
        }
        assert.doesNotMatch(codigo, /roomButtonClassName\(\{[^}]*variant:\s*"accent"/, `${caminho}: accent so no RoomButton do Sair`);
      }
    }
  };
  visitar(ROOM);
  assert.deepEqual(usos.map((uso) => uso.caminho).sort(), [`${ROOM}/room-bar.tsx`, `${ROOM}/room-header.tsx`], "o Sair do cabecalho e o da barra");
  for (const uso of usos) {
    assert.match(uso.filhos, /\{copy\.sair\}/, `${uso.caminho}: ${uso.filhos}`);
  }
});
