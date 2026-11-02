import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda dos tokens da sala do webinario (docs/31 V2-11 e V2-12; docs/18 §2.7, por isso .guard): o texto do CSS e dos
// componentes, que nenhum teste de tela alcanca. O tema claro e o escuro moram em dois blocos de globals.css, cada um
// com TODOS os --room-* (um nome que falta num deles deixaria a cor vazia so naquele tema); cada --color-room-* do
// @theme inline aponta para um --room-* que existe; as superficies fora do video nao voltam aos hex fixos de antes; o
// atributo data-room-theme fica so no dialogo da sala, nunca no :root nem no html (a area continua escura); e a ponte
// do console de quem apresenta ([data-console-root], docs/31 V2-12 e V2-13) redefine cada token do admin por um --room-*.

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
  // Os valores fixos: o fundo (V2-11, o mesmo que o iframe do motor pinta), o painel do console e o ativo do YouTube
  // (a sala no estilo do YouTube, docs/31).
  assert.equal(ESCURO.get("--room-bg"), "#141414");
  assert.equal(CLARO.get("--room-bg"), "#f4f4f3");
  assert.equal(ESCURO.get("--room-surface"), "#171717");
  assert.equal(CLARO.get("--room-surface"), "#ffffff");
  assert.equal(ESCURO.get("--room-active-bg"), "#f1f1f1");
  assert.equal(CLARO.get("--room-active-bg"), "#0f0f0f");
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
  // Toda cor do tema tem a classe; so as tres sombras ficam de fora (nao sao cor): a da aba ativa, a do menu e a do aviso.
  const comClasse = new Set(cores.map(([, nome]) => `--${nome}`));
  assert.deepEqual(
    [...ESCURO.keys()].filter((nome) => !comClasse.has(nome)).sort(),
    ["--room-menu-shadow", "--room-snackbar-shadow", "--room-tab-on-shadow"]
  );
});

/** Os nomes que a sala no estilo do YouTube acrescenta (docs/31), as duas sombras sem classe. */
const NOVOS_YT = [
  "--room-panel",
  "--room-panel-border",
  "--room-menu",
  "--room-menu-shadow",
  "--room-fg-disabled",
  "--room-press-inverse",
  "--room-active-hover",
  "--room-thread-line",
  "--room-thread-line-hover",
  "--room-field-line",
  "--room-field-line-draft",
  "--room-cta-bg",
  "--room-cta-hover",
  "--room-cta-fg",
  "--room-cta-press",
  "--room-link",
  "--room-snackbar-bg",
  "--room-snackbar-fg",
  "--room-snackbar-action",
  "--room-snackbar-action-hover",
  "--room-snackbar-ring",
  "--room-snackbar-shadow",
  "--room-tooltip-bg",
  "--room-tooltip-fg",
  "--room-accent-hover"
];

test("a sala no estilo do YouTube: cada nome novo nos dois blocos, na mesma ordem, e cada cor nova com a classe", () => {
  assert.equal(NOVOS_YT.length, 25);
  const tema = css.slice(css.indexOf("@theme inline {"));
  const corpo = tema.slice(0, tema.indexOf("}"));
  for (const nome of NOVOS_YT) {
    assert.ok(ESCURO.has(nome) && CLARO.has(nome), `${nome} nos dois blocos`);
    const classe = `--color-${nome.slice(2)}: var(${nome});`;
    if (nome.endsWith("-shadow")) {
      assert.ok(!corpo.includes(classe), `${nome}: a sombra fica sem classe`);
    } else {
      assert.ok(corpo.includes(classe), `${nome}: a classe no @theme inline`);
    }
  }
  const ordem = (mapa) => [...mapa.keys()].filter((nome) => NOVOS_YT.includes(nome));
  assert.deepEqual(ordem(ESCURO), NOVOS_YT, "a ordem do escuro");
  assert.deepEqual(ordem(CLARO), NOVOS_YT, "a ordem do claro");
  // A sombra do aviso leva o anel de 1 px do proprio tema (o anel sobre o video, docs/31).
  for (const mapa of [ESCURO, CLARO]) {
    assert.match(mapa.get("--room-snackbar-shadow"), /^0 0 0 1px var\(--room-snackbar-ring\),/);
  }
  // O texto forte e o principal tem o mesmo valor; o nome fica porque o codigo de hoje o usa.
  assert.equal(ESCURO.get("--room-fg-strong"), ESCURO.get("--room-fg"));
  assert.equal(CLARO.get("--room-fg-strong"), CLARO.get("--room-fg"));
});

test("a ponte do console ([data-console-root]) redefine cada token do admin, e cada valor e um --room-* que existe", () => {
  // Os nomes do bloco do admin (o primeiro "[data-scope=admin] {", junto com o :root:has dele), menos os que nao mudam
  // com o tema: as series --chart-* (que leem --series-*), a curva --ease-admin e o --radius.
  const fica = (nome) => /^--chart-/.test(nome) || nome === "--ease-admin" || nome === "--radius";
  const admin = [...bloco('[data-scope="admin"]').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, nome]) => nome);
  assert.ok(admin.includes("--surface-0") && admin.includes("--popover") && admin.includes("--ring"), `o bloco do admin: ${admin.join(" ")}`);
  const esperados = admin.filter((nome) => !fica(nome)).sort();

  const corpo = bloco("[data-console-root]");
  const ponte = new Map([...corpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, nome, valor]) => [nome, valor.trim()]));
  assert.deepEqual([...ponte.keys()].sort(), esperados, "cada token do admin que muda com o tema, e so eles");
  for (const [nome, valor] of ponte) {
    const alvo = /^var\((--room-[a-z0-9-]+)\)$/.exec(valor);
    assert.ok(alvo, `${nome}: so var(--room-*), nenhum valor literal (${valor})`);
    assert.ok(ESCURO.has(alvo[1]) && CLARO.has(alvo[1]), `${nome}: ${alvo[1]} existe nos dois temas`);
  }
  // O que o console precisa de cada lado: o foco do anel do admin, o hover do shadcn (cinza) e o vermelho da marca.
  assert.equal(ponte.get("--focus-ring"), "var(--room-focus)");
  assert.equal(ponte.get("--accent"), "var(--room-surface-2)");
  assert.equal(ponte.get("--brand-red"), "var(--room-accent)");
  assert.equal(ESCURO.get("--room-accent"), "#e50914");
  assert.equal(CLARO.get("--room-accent"), "#e50914");
  // Um bloco so: um segundo [data-console-root] poderia vencer este.
  assert.equal(css.match(/\[data-console-root\][^{]*\{/g)?.length, 1);
});

test("as superficies fora do video nao voltam aos hex fixos de antes (#0b0b0b, #111, #0f0f0f, #161616, #1b1b1b, #121212)", () => {
  const ROOM = "src/components/member/webinars/room";
  const arquivos = [
    "room-chat.tsx",
    "room-questions.tsx",
    "room-polls.tsx",
    "room-poll-layer.tsx",
    "room-reactions.tsx",
    "room-header.tsx",
    "room-ui.tsx",
    "live-controls.tsx",
    "room-bar.tsx",
    "room-view-menu.tsx",
    "recorded-controls.tsx",
    "room-panel.tsx",
    "room-chat-pills.tsx",
    "live-settings.tsx",
    "live-notices.tsx",
    "live-room.tsx",
    "webinar-room.tsx",
    "room-pill.tsx",
    "room-chip-bar.tsx",
    "room-comment.tsx",
    "room-comment-field.tsx",
    "room-menu.tsx",
    "room-tooltip.tsx",
    "room-snackbar.tsx",
    "room-rail.tsx",
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

test("data-room-theme fica so no dialogo da sala e na raiz do console (com data-console-root): nunca no :root, no html ou no body", () => {
  // No CSS: so os dois blocos, sem :root, html ou body na frente nem :has() de fora.
  const seletores = [...css.matchAll(/([^{}]*\[data-room-theme[^{}]*)\{/g)].map(([, seletor]) => seletor.trim());
  assert.deepEqual(seletores.sort(), ['[data-room-theme="dark"]', '[data-room-theme="light"]']);
  assert.doesNotMatch(css, /(?::root|html|body)[^{,]*data-room-theme/);

  // No codigo: o atributo so nas duas salas, como atributo do dialogo, e na raiz do console de quem apresenta (a casca e
  // o esqueleto do carregamento), no mesmo elemento que o data-console-root (a ponte dos tokens do admin); ninguem o
  // poe no documento.
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
  const CONSOLE = "src/components/admin/v2/communication/webinars/session-console";
  const raizesDoConsole = [`${CONSOLE}/console-shell.tsx`, `${CONSOLE}/session-console-skeleton.tsx`];
  const salas = ["src/components/member/webinars/room/live-room.tsx", "src/components/member/webinars/room/webinar-room.tsx"];
  assert.deepEqual(quem.sort(), [...raizesDoConsole, ...salas].sort());
  for (const arquivo of quem) {
    const codigo = semComentarios(ler(arquivo));
    assert.equal((codigo.match(/data-room-theme=/g) ?? []).length, 1, `${arquivo}: um so atributo`);
    if (raizesDoConsole.includes(arquivo)) {
      // A raiz do console nao e dialogo: o tema e a ponte no mesmo elemento.
      assert.match(codigo, /<div(?=[^>]*\sdata-console-root="")(?=[^>]*\sdata-room-theme=)[^>]*>/, `${arquivo}: o tema na raiz com data-console-root`);
      assert.doesNotMatch(codigo, /role="dialog"/, arquivo);
    } else {
      assert.match(codigo, /role="dialog"/);
    }
    assert.doesNotMatch(codigo, /documentElement|document\.body\.(?:dataset|setAttribute)/, arquivo);
  }
  // A gravada e o replay passam pela regra do vertical (sempre escuro), testada em webinarios-sala-v2-modelo.
  assert.match(semComentarios(ler("src/components/member/webinars/room/webinar-room.tsx")), /data-room-theme=\{themeForDesign\(design, theme\)\}/);
});

/* --------------------------------------------------------------------------------------------------------------
 * O contraste dos dois temas (docs/12: texto pequeno com 4,5:1; traco, icone e estado com 3:1). Os valores saem dos
 * dois blocos de globals.css. Primeiro os fundos que o console e o vertical continuam usando (--room-surface e os
 * outros que ficam): um fundo translucido e composto sobre o painel (--room-surface, ele mesmo sobre --room-bg). Depois
 * os pares da sala no estilo do YouTube (PARES_YT, docs/31), cada fundo uma pilha de camadas de baixo para cima.
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
    // A porcentagem da enquete fica no texto principal, por cima da barra cheia: no card da aba e no dialogo do palco
    // (V2-10), que fica no fundo do painel.
    conferir("fg sobre a barra da enquete", cor("fg"), sobre(cor("poll-bar"), card));
    conferir("fg sobre a barra da enquete no palco", cor("fg"), sobre(cor("poll-bar"), painel));
    // O ativo, o meu balao e a aba ativa.
    conferir("active-fg sobre active-bg", cor("active-fg"), sobre(cor("active-bg"), painel));
    conferir("bubble-mine-fg sobre bubble-mine-bg", cor("bubble-mine-fg"), sobre(cor("bubble-mine-bg"), painel));
    conferir("tab-on-fg sobre tab-on-bg", cor("tab-on-fg"), sobre(cor("tab-on-bg"), painel));
    // O Encerrar do console (RoomButton stop, o --error da ponte) e o selo de sucesso do admin pela ponte (StatusChip),
    // os dois sobre o painel (docs/31 V2-13).
    conferir("danger-fg sobre danger-bg", cor("danger-fg"), sobre(cor("danger-bg"), painel));
    conferir("success-fg sobre success-bg", cor("success-fg"), sobre(cor("success-bg"), painel));
    assert.deepEqual(falhas, [], `pares abaixo de 4,5:1 no tema ${nomeDoTema}`);

    // A barra do resultado aparece sobre o card e sobre o dialogo do palco (a porcentagem escrita leva o dado; a barra
    // so precisa se ver).
    assert.ok(contraste(sobre(cor("poll-bar"), card), card) >= 1.3, "a barra da enquete se distingue do card");
    assert.ok(contraste(sobre(cor("poll-bar"), painel), painel) >= 1.3, "a barra da enquete se distingue do dialogo do palco");
  });
}

/**
 * Os pares da sala no estilo do YouTube (docs/31; os numeros esperados de cada tema na especificacao do redesign).
 * A frente e o fundo sao nomes de token sem o prefixo --room- ou uma cor literal (#ffffff, o texto do Sair; #000000, o
 * palco do motor, preto nos dois temas). O fundo e uma pilha: a primeira camada e opaca, e cada uma das seguintes e
 * composta sobre a de baixo. O --room-panel e o --room-menu sao opacos.
 */
const PARES_YT = [
  // Texto, 4,5:1.
  ...[
    ["bg"],
    ["panel"],
    ["menu"],
    ["bg", "control"],
    ["bg", "control-hover"],
    ["bg", "control-hover", "press-overlay"],
    ["panel", "control"],
    ["panel", "control-hover"],
    ["menu", "control"],
    ["menu", "control-hover"],
    ["menu", "control", "poll-bar"]
  ].map((fundo) => ({ rotulo: "texto", frente: "fg", fundo, minimo: 4.5 })),
  ...[["bg"], ["panel"], ["menu"], ["panel", "control"]].map((fundo) => ({ rotulo: "texto", frente: "fg-subtle", fundo, minimo: 4.5 })),
  ...[["active-bg"], ["active-hover"], ["active-hover", "press-inverse"]].map((fundo) => ({ rotulo: "texto", frente: "active-fg", fundo, minimo: 4.5 })),
  ...[["cta-bg"], ["cta-hover"], ["cta-hover", "cta-press"]].map((fundo) => ({ rotulo: "texto", frente: "cta-fg", fundo, minimo: 4.5 })),
  ...[["accent"], ["accent-hover"], ["accent-hover", "press-inverse"]].map((fundo) => ({ rotulo: "texto", frente: "#ffffff", fundo, minimo: 4.5 })),
  { rotulo: "texto", frente: "link", fundo: ["panel"], minimo: 4.5 },
  { rotulo: "texto", frente: "snackbar-fg", fundo: ["snackbar-bg"], minimo: 4.5 },
  { rotulo: "texto", frente: "snackbar-action", fundo: ["snackbar-bg"], minimo: 4.5 },
  { rotulo: "texto", frente: "snackbar-action", fundo: ["snackbar-action-hover"], minimo: 4.5 },
  ...[["bg", "tooltip-bg"], ["panel", "tooltip-bg"], ["#000000", "tooltip-bg"]].map((fundo) => ({ rotulo: "texto", frente: "tooltip-fg", fundo, minimo: 4.5 })),
  { rotulo: "texto", frente: "warn-fg", fundo: ["panel"], minimo: 4.5 },
  { rotulo: "texto", frente: "success-fg", fundo: ["panel"], minimo: 4.5 },
  // Traco e estado, 3:1: a linha do campo com rascunho e com foco, o anel de foco, os icones, o ativo contra o tonal, o
  // ponto vermelho e o contorno da opcao escolhida da enquete.
  { rotulo: "traco", frente: "field-line-draft", fundo: ["panel"], minimo: 3 },
  { rotulo: "traco", frente: "fg", fundo: ["panel"], minimo: 3 },
  ...[["bg"], ["panel"], ["menu"]].map((fundo) => ({ rotulo: "traco", frente: "focus", fundo, minimo: 3 })),
  ...[["bg"], ["panel", "control"]].map((fundo) => ({ rotulo: "traco", frente: "icon", fundo, minimo: 3 })),
  ...[["panel", "control"], ["bg", "control"]].map((fundo) => ({ rotulo: "estado", frente: "active-bg", fundo, minimo: 3 })),
  ...[["panel"], ["bg"]].map((fundo) => ({ rotulo: "estado", frente: "accent", fundo, minimo: 3 })),
  { rotulo: "traco", frente: "fg", fundo: ["menu", "control"], minimo: 3 }
];

/** Uma camada (token sem o prefixo, ou cor literal) do tema. */
function camada(tema, nome) {
  if (nome.startsWith("#")) {
    return rgba(nome);
  }
  const valor = tema.get(`--room-${nome}`);
  assert.ok(valor, `--room-${nome} existe`);
  return rgba(valor);
}

/** A pilha de camadas resolvida numa cor opaca, de baixo para cima. */
function pilha(tema, camadas) {
  const [base, ...resto] = camadas.map((nome) => camada(tema, nome));
  assert.equal(base[3], 1, `a primeira camada e opaca: ${camadas.join(" + ")}`);
  return resto.reduce((abaixo, cima) => sobre(cima, abaixo), base);
}

/** O contraste de um par no tema (a frente com alfa e composta sobre o proprio fundo). */
function contrasteDoPar(tema, par) {
  const fundo = pilha(tema, par.fundo);
  const frente = camada(tema, par.frente);
  return contraste(frente[3] === 1 ? frente : sobre(frente, fundo), fundo);
}

/** Os pares abaixo do minimo, com o valor. */
function falhasYt(tema, pares = PARES_YT) {
  return pares
    .map((par) => ({ par, valor: contrasteDoPar(tema, par) }))
    .filter(({ par, valor }) => valor < par.minimo)
    .map(({ par, valor }) => `${par.rotulo} ${par.frente} sobre ${par.fundo.join(" + ")}: ${valor.toFixed(2)} (minimo ${par.minimo})`);
}

for (const [nomeDoTema, tema] of [
  ["escuro", ESCURO],
  ["claro", CLARO]
]) {
  test(`tema ${nomeDoTema}: os pares da sala no estilo do YouTube com o minimo de cada um (texto 4,5:1; traco e estado 3:1)`, () => {
    assert.ok(PARES_YT.length >= 45, `pares: ${PARES_YT.length}`);
    assert.deepEqual(falhasYt(tema), [], `pares abaixo do minimo no tema ${nomeDoTema}`);
  });
}

test("os dois pares claros guardados pelo nome: o secundario sobre o tonal do painel e o Enviar pressionado", () => {
  const secundario = { rotulo: "texto", frente: "fg-subtle", fundo: ["panel", "control"], minimo: 4.5 };
  const pressionado = { rotulo: "texto", frente: "cta-fg", fundo: ["cta-hover", "cta-press"], minimo: 4.5 };
  const naLista = (alvo) => PARES_YT.some((par) => par.frente === alvo.frente && par.fundo.join("+") === alvo.fundo.join("+"));
  assert.ok(naLista(secundario), "o par do secundario esta na lista");
  assert.ok(naLista(pressionado), "o par do Enviar pressionado esta na lista");

  // O secundario do claro (#606060) sobre o tonal do painel: 5,6:1, mais que o cinza de antes (#63636b, 5,3:1).
  const agora = contrasteDoPar(CLARO, secundario);
  const antes = contrasteDoPar(new Map([...CLARO, ["--room-fg-subtle", "#63636b"]]), secundario);
  assert.equal(CLARO.get("--room-fg-subtle"), "#606060");
  assert.ok(agora >= 4.5 && agora > antes, `agora ${agora.toFixed(2)}, antes ${antes.toFixed(2)}`);

  // O pressionado do azul escurece nos dois temas. Com o clarear branco do YouTube no claro (rgba(255,255,255,0.2)), o
  // texto do Enviar pressionado cai a 3,95:1, e a guarda reprova o par.
  assert.equal(CLARO.get("--room-cta-press"), "rgba(0, 0, 0, 0.2)");
  assert.ok(contrasteDoPar(CLARO, pressionado) >= 4.5);
  const comBranco = new Map([...CLARO, ["--room-cta-press", "rgba(255, 255, 255, 0.2)"]]);
  const falhas = falhasYt(comBranco);
  assert.equal(falhas.length, 1, `so o Enviar pressionado cai: ${falhas.join(" | ")}`);
  assert.match(falhas[0], /^texto cta-fg sobre cta-hover \+ cta-press: 3\.95 \(minimo 4\.5\)$/);
});

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

test("o vermelho cheio (o RoomButton accent e a RoomPill red) e so o Sair: o do cabecalho e o da barra (docs/31 V2-6 e V2-11)", () => {
  const ROOM = "src/components/member/webinars/room";
  const usos = [];
  const visitar = (pasta) => {
    for (const nome of readdirSync(path.join(root, pasta))) {
      const caminho = `${pasta}/${nome}`;
      if (statSync(path.join(root, caminho)).isDirectory()) {
        visitar(caminho);
      } else if (/\.tsx?$/.test(nome)) {
        const codigo = semComentarios(ler(caminho));
        // O botao de texto: o rotulo e o filho. A abertura da tag pode ter "=>" (onClick={() => ...}): so o ">"
        // sozinho a fecha.
        for (const [, filhos] of codigo.matchAll(/<RoomButton\b(?:=>|[^>])*?\bvariant="accent"(?:=>|[^>])*>([\s\S]*?)<\/RoomButton>/g)) {
          usos.push({ caminho, rotulo: filhos.trim() });
        }
        // A pilula do YouTube (room-pill.tsx): o rotulo e o label, na tag que fecha sozinha ou com filhos.
        for (const [tag] of codigo.matchAll(/<RoomPill\b(?:=>|[^>])*?\btone="red"(?:=>|[^>])*>/g)) {
          usos.push({ caminho, rotulo: tag.match(/\blabel=(\{[^}]*\})/)?.[1] ?? "(sem label)" });
        }
        assert.doesNotMatch(codigo, /roomButtonClassName\(\{[^}]*variant:\s*"accent"/, `${caminho}: accent so no RoomButton do Sair`);
      }
    }
  };
  visitar(ROOM);
  assert.deepEqual([...new Set(usos.map((uso) => uso.caminho))].sort(), [`${ROOM}/room-bar.tsx`, `${ROOM}/room-header.tsx`], "o Sair do cabecalho e o da barra");
  for (const uso of usos) {
    assert.match(uso.rotulo, /\{copy\.sair\}/, `${uso.caminho}: ${uso.rotulo}`);
  }
});
