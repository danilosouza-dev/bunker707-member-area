import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda das frases da sala do webinario (docs/30 §2.7 e §10.1; docs/31 §1; docs/18 §2.7, por isso .guard): o texto
// do codigo-fonte, que nenhum teste de tela alcanca por inteiro (o servidor pinta so o computador e nada aberto). Toda
// frase que o aluno le ou ouve na sala vem de WEBINAR_COPY (src/lib/webinar-copy.ts e src/lib/webinar-copy-v4/, que
// tests/webinarios-frases.test.mjs confere contra a PROIBIDAS_WEBINARIO) ou das provisorias de LIVE_ROOM_COPY: nenhum
// texto escrito direto no JSX e nenhum aria-label, title, placeholder, alt ou label literal. Vale para todas as pecas
// da sala (a live, a gravada e o Replay dividem as da sala V2), achadas pela pasta: uma peca nova entra sozinha.

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOM = "src/components/member/webinars/room";
const ler = (caminho) => readFileSync(path.join(root, caminho), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\}/g, "");

/**
 * Os arquivos da sala que desenham alguma coisa: todo .tsx da pasta, nas subpastas tambem (vertical/, assistant/,
 * offer/). Os .ts (modelos, ganchos e chamadas) nao carregam JSX; as frases deles sao de WEBINAR_COPY.
 */
const FONTES = readdirSync(path.join(root, ROOM), { recursive: true })
  .map((arquivo) => String(arquivo).split(path.sep).join("/"))
  .filter((arquivo) => arquivo.endsWith(".tsx"))
  .sort()
  .map((arquivo) => `${ROOM}/${arquivo}`);

/** Os atributos que o aluno le ou ouve: o nome acessivel, a dica, o campo vazio, a imagem e o rotulo das pecas. */
const ROTULOS = new Set(["alt", "aria-description", "aria-label", "aria-placeholder", "aria-roledescription", "aria-valuetext", "label", "placeholder", "title"]);

/** Duas letras seguidas: o que separa uma frase de um espaco, de um ponto do meio ou de um numero. */
const temLetras = (texto) => /\p{L}{2,}/u.test(texto.replace(/&[#\w]+;/g, " "));

/** Os pedacos fixos de um texto em aspas ou em crases (o que fica fora dos ${}), ou null se nao e um texto. */
function pedacosFixos(no) {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) {
    return [no.text];
  }
  if (ts.isTemplateExpression(no)) {
    return [no.head.text, ...no.templateSpans.map((trecho) => trecho.literal.text)];
  }
  return null;
}

/** Os textos que uma expressao entre chaves pode desenhar: o proprio texto, os dois lados do ? : e o fim do && e do ??. */
function textosDaExpressao(no) {
  if (!no) {
    return [];
  }
  const fixos = pedacosFixos(no);
  if (fixos) {
    return fixos.filter(temLetras);
  }
  if (ts.isParenthesizedExpression(no) || ts.isAsExpression(no) || ts.isSatisfiesExpression(no)) {
    return textosDaExpressao(no.expression);
  }
  if (ts.isConditionalExpression(no)) {
    return [...textosDaExpressao(no.whenTrue), ...textosDaExpressao(no.whenFalse)];
  }
  if (ts.isBinaryExpression(no)) {
    const operador = no.operatorToken.kind;
    if (operador === ts.SyntaxKind.AmpersandAmpersandToken) {
      return textosDaExpressao(no.right);
    }
    if (operador === ts.SyntaxKind.BarBarToken || operador === ts.SyntaxKind.QuestionQuestionToken) {
      return [...textosDaExpressao(no.left), ...textosDaExpressao(no.right)];
    }
  }
  return [];
}

/** O nome da tag de um elemento JSX (style, span, RoomCircleButton). */
const nomeDaTag = (elemento) => elemento.openingElement.tagName.getText();

/**
 * O que esta escrito direto no desenho, pela arvore do TypeScript (o texto em varias linhas tambem): o texto entre as
 * tags, o texto entre chaves no lugar de um filho ({"Sair"}, {`Sair`}, {aberto ? "Fechar" : copy.abrir}) e os rotulos
 * de ROTULOS em aspas ou em chaves. O CSS de um <style> nao e frase.
 */
function escritosDireto(codigo, arquivo = "peca.tsx") {
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados = [];
  const visitar = (no) => {
    if (ts.isJsxElement(no) && nomeDaTag(no) === "style") {
      ts.forEachChild(no.openingElement, visitar);
      return;
    }
    if (ts.isJsxText(no) && temLetras(no.text)) {
      achados.push(`texto: ${no.text.trim()}`);
    }
    if (ts.isJsxExpression(no) && no.parent && (ts.isJsxElement(no.parent) || ts.isJsxFragment(no.parent))) {
      for (const texto of textosDaExpressao(no.expression)) {
        achados.push(`texto: ${texto.trim()}`);
      }
    }
    if (ts.isJsxAttribute(no) && no.initializer && ROTULOS.has(no.name.getText())) {
      const valor = no.initializer;
      const textos = ts.isStringLiteral(valor) ? [valor.text].filter(temLetras) : ts.isJsxExpression(valor) ? textosDaExpressao(valor.expression) : [];
      for (const texto of textos) {
        achados.push(`${no.name.getText()}: ${texto.trim()}`);
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

test("o detector acha o texto e o rotulo escritos direto (em varias linhas e entre chaves) e deixa passar a frase pela copy", () => {
  assert.deepEqual(escritosDireto('<span className="x">Sair</span>'), ["texto: Sair"]);
  assert.deepEqual(escritosDireto('<p className="x">\n  Aguardando a equipe\n</p>'), ["texto: Aguardando a equipe"], "o texto sozinho na linha");
  assert.deepEqual(escritosDireto("<span>\n  {copy.a} Sair agora\n</span>"), ["texto: Sair agora"], "o texto depois de uma frase da copy");
  assert.deepEqual(escritosDireto('<span>{"Sair"}</span>'), ["texto: Sair"], "o texto em aspas entre chaves");
  assert.deepEqual(escritosDireto("<span>{`Sair ${nome}`}</span>"), ["texto: Sair"], "o texto em crases entre chaves");
  assert.deepEqual(escritosDireto('<span>{aberto ? "Fechar" : copy.abrir}</span>'), ["texto: Fechar"], "um lado do ? :");
  assert.deepEqual(escritosDireto('<>{mudo && "Sem som"}</>'), ["texto: Sem som"], "o fim do &&");
  assert.deepEqual(escritosDireto('<button aria-label={"Fechar"} title={`Sair`}>{copy.x}</button>'), ["aria-label: Fechar", "title: Sair"]);
  assert.deepEqual(escritosDireto('<button aria-label="Fechar" title={copy.fechar}>'.concat("</button>")), ["aria-label: Fechar"]);
  assert.deepEqual(escritosDireto('<Image alt="Bunker707" />'), ["alt: Bunker707"]);
  assert.deepEqual(escritosDireto('<RoomCircleButton label="Reagir" />'), ["label: Reagir"]);

  assert.deepEqual(escritosDireto("<p>\n  {copy.sair}\n</p>"), [], "a frase pela copy, entre chaves");
  assert.deepEqual(escritosDireto("<span>{`${copy.selos.assistente}: `}</span>"), [], "so a copy dentro das crases");
  assert.deepEqual(escritosDireto('<span>{" · "}</span>'), [], "o ponto do meio");
  assert.deepEqual(escritosDireto('<Image alt="" src={logo} />'), [], "a imagem decorativa");
  assert.deepEqual(escritosDireto("<Image alt={copy.marca} />"), []);
  assert.deepEqual(escritosDireto('<div role="dialog" aria-live="polite" data-room-slot="dock" className="flex gap-2" />'), [], "os codigos");
  assert.deepEqual(escritosDireto("<span>&nbsp;{copy.a}</span>"), [], "o espaco que nao quebra");
  assert.deepEqual(escritosDireto("<style>{`@keyframes room-reaction { 0% { opacity: 0; } }`}</style>"), [], "o CSS de um <style>");
  assert.deepEqual(escritosDireto("const conta = (at: number) => nowMs - at < 60_000;\ntype T = { onRemoveMine: () => Promise<number> };"), [], "a seta e o tipo");
});

test("a lista de pecas vem da pasta da sala e tem as da sala ao vivo de antes e as da sala V2", () => {
  for (const peca of [
    "live-controls", "live-notices", "live-room", "live-settings", "live-stage",
    "recorded-controls", "room-bar", "room-chat", "room-chat-pills", "room-header", "room-panel", "room-poll-layer",
    "room-polls", "room-questions", "room-reactions", "room-stage", "room-stage-badges", "room-offer", "room-simulation",
    "room-ui", "room-view-menu", "webinar-room",
    "vertical/vertical-top-bar", "vertical/vertical-chat", "vertical/vertical-composer", "vertical/vertical-drawer", "vertical/room-dock",
    "assistant/assistant-handoff", "assistant/assistant-hint", "offer/offer-card-view"
  ]) {
    assert.ok(FONTES.includes(`${ROOM}/${peca}.tsx`), `${peca}.tsx na guarda`);
  }
});

test("as frases da sala sao todas de WEBINAR_COPY (ou das provisorias de LIVE_ROOM_COPY): nenhum texto escrito direto no desenho", () => {
  for (const caminho of FONTES) {
    assert.deepEqual(escritosDireto(ler(caminho), caminho), [], `${caminho}: texto ou rotulo escrito direto`);
  }
});

test("Configurações tomou o lugar do Como usar, com a frase provisoria de LIVE_ROOM_COPY; a marca do cabecalho vem da copy", () => {
  const controls = ler(`${ROOM}/live-controls.tsx`);
  assert.match(controls, /LIVE_ROOM_COPY\.configuracoes/);
  assert.doesNotMatch(controls, /comoUsar|Keyboard/, "o Como usar virou o painel Configurações");
  assert.match(ler(`${ROOM}/live-room-model.ts`), /export const LIVE_ROOM_COPY = \{/);
  // Sem a logo de Marca, o nome da escola em texto (e o alt da logo) pela mesma frase (docs/31 V2-3).
  const header = semComentarios(ler(`${ROOM}/room-header.tsx`));
  assert.match(header, /alt=\{copy\.marca\}/);
  assert.match(header, />\{copy\.marca\}</);
});
