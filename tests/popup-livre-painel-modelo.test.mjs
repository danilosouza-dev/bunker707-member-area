import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Editor Livre do pop-up (docs/27; spec §4.6, §4.7, §7.1 e §9.6; docs/18 §1.1), pacote I: as pecas puras do painel
// da direita. A area de texto (Enter, limite de linhas), "Outro estilo na seleção" (antes / selecao / depois, com
// acentos, emoji e letras combinadas), editar o texto mantendo o estilo das partes, "Voltar ao estilo do elemento",
// as paradas do degradê, as camadas de fundo, os lados, as sombras com os atalhos, o mapa chave -> aba/campo, o
// "Abrir um link" que nunca desliga (ate 3, L4b), a largura com a reescala, os pesos de cada fonte, a conta da
// imagem e o vocabulario.

const panel = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const styles = await import("../src/components/member/notifications/popup-free/popup-free-styles.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const checks = await import("../src/server/communications/popup-free-checks.ts");
const popupEditor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { FreeInspectorContent } = await import("../src/components/admin/v2/communication/popup-free/free-inspector-content.tsx");
const { FreeInspectorMobile } = await import("../src/components/admin/v2/communication/popup-free/free-inspector-mobile.tsx");
const { FreeArtboardSettings } = await import("../src/components/admin/v2/communication/popup-free/free-artboard-settings.tsx");
const { FreeInspectorStyle } = await import("../src/components/admin/v2/communication/popup-free/free-inspector-style.tsx");
const history = await import("../src/components/admin/v2/communication/popup-free/free-editor-history.ts");

const C = panel.FREE_INSPECTOR_COPY;
const M = schema.POPUP_FREE_MESSAGES;
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];
// Nas frases do painel tambem nao entra o nome tecnico dos arquivos do design (o campo do JSON).
const PROIBIDAS_NAS_FRASES = [...PROIBIDAS, "asset", "assets"];
const VERDE = { color: "#e5ff1f", kind: "solid" };
const ROSA = { color: "#ff3d9a", kind: "solid" };
const HEADING_BASE = render.freeTextStyleOf({ id: "titulo", lines: [[{ text: "x" }]], type: "heading" });
const TEXT_BASE = render.freeTextStyleOf({ id: "texto", lines: [[{ text: "x" }]], type: "text" });

function design(children, extra = {}) {
  return model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });
}

const LINKS = { id: "links", type: "links" };

/** A frase de dentro de um texto: o mesmo texto das linhas, sem estilo (para comparar so o texto). */
function textOf(lines) {
  return panel.freeLinesText(lines);
}

/* ------------------------------------------------------------------------------------------------
 * Area de texto
 * ---------------------------------------------------------------------------------------------- */

test("área de texto: Enter cria linha, limite de linhas do Título e do Texto", () => {
  const lines = [[{ text: "Experimente grátis" }]];

  // Enter no meio: a linha se parte em duas, com o mesmo estilo.
  const enter = panel.freeTextAreaChange("heading", lines, "Experimente\ngrátis", { base: HEADING_BASE, caret: 12 });
  assert.equal(enter.problem, null);
  assert.deepEqual(enter.lines, [[{ text: "Experimente" }], [{ text: "grátis" }]]);

  // Enter no fim: linha nova vazia (a forma canonica recusa ao salvar, o editor deixa escrever nela).
  const atEnd = panel.freeTextAreaChange("text", lines, "Experimente grátis\n", { base: TEXT_BASE, caret: 19 });
  assert.deepEqual(atEnd.lines, [[{ text: "Experimente grátis" }], [{ text: "" }]]);

  // Título: até 4 linhas; a quinta não entra e volta a frase do limite (nada muda).
  const four = "a\nb\nc\nd";
  assert.equal(panel.freeTextAreaChange("heading", lines, four).problem, null);
  const five = panel.freeTextAreaChange("heading", lines, `${four}\ne`);
  assert.equal(five.problem, "Use até 4 linhas.");
  assert.equal(five.lines, lines);

  // Texto: até 12 linhas.
  const twelve = Array.from({ length: 12 }, (_, index) => `linha ${index + 1}`).join("\n");
  assert.equal(panel.freeTextAreaChange("text", lines, twelve).problem, null);
  assert.equal(panel.freeTextAreaChange("text", lines, `${twelve}\nmais`).problem, "Use até 12 linhas.");
  assert.equal(panel.freeTextLineLimit("heading"), model.FREE_DESIGN_LIMITS.headingLines);
  assert.equal(panel.freeTextLineLimit("text"), model.FREE_DESIGN_LIMITS.textLines);

  // Colar com \r\n (Windows) vira linhas comuns.
  assert.deepEqual(panel.freeTextAreaChange("text", lines, "um\r\ndois").lines, [[{ text: "um" }], [{ text: "dois" }]]);

  // Linhas -> texto da area e de volta, sem perder nada.
  const styled = [[{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis" }], [{ text: "Nova aula" }]];
  assert.equal(panel.freeLinesText(styled), "Experimente grátis\nNova aula");
  assert.equal(panel.applyFreeTextEdit(styled, "Experimente grátis\nNova aula"), styled);
});

test("Outro estilo na seleção divide a parte em antes, seleção e depois", () => {
  const lines = [[{ text: "Experimente grátis hoje" }]];
  const split = panel.splitFreeSpanAtSelection(lines, { end: 18, start: 12 });

  assert.deepEqual(split.targets, [{ end: 18, line: 0, start: 12 }]);
  assert.deepEqual(split.lines, [[{ text: "Experimente " }, { text: "grátis" }, { text: " hoje" }]]);

  // A parte do meio começa com o estilo de onde estava (o do elemento numa parte sem estilo; o da parte numa com).
  const inStyled = panel.splitFreeSpanAtSelection([[{ style: { paint: VERDE, weight: 900 }, text: "Nova aula ao vivo" }]], { end: 9, start: 5 });
  assert.deepEqual(inStyled.lines, [[{ style: { paint: VERDE, weight: 900 }, text: "Nova " }, { style: { paint: VERDE, weight: 900 }, text: "aula" }, { style: { paint: VERDE, weight: 900 }, text: " ao vivo" }]]);

  // Aplicar uma cor só no trecho: só "grátis" muda; antes e depois ficam com o estilo do elemento.
  const green = panel.applyFreeSpanStyle(lines, split.targets, { paint: VERDE }, HEADING_BASE);
  assert.deepEqual(green, [[{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis" }, { text: " hoje" }]]);

  // Seleção do começo da linha ou até o fim: só duas partes.
  assert.deepEqual(panel.splitFreeSpanAtSelection(lines, { end: 11, start: 0 }).lines, [[{ text: "Experimente" }, { text: " grátis hoje" }]]);
  assert.deepEqual(panel.splitFreeSpanAtSelection(lines, { end: 23, start: 19 }).lines, [[{ text: "Experimente grátis " }, { text: "hoje" }]]);

  // Seleção de trás para frente (o navegador pode dar start > end) vale igual.
  assert.deepEqual(panel.splitFreeSpanAtSelection(lines, { end: 12, start: 18 }).targets, [{ end: 18, line: 0, start: 12 }]);

  // Seleção que pega duas linhas: um trecho em cada uma (a quebra de linha não conta).
  const two = [[{ text: "Experimente grátis" }], [{ text: "Nova aula" }]];
  const across = panel.splitFreeSpanAtSelection(two, { end: 23, start: 12 });
  assert.deepEqual(across.targets, [
    { end: 18, line: 0, start: 12 },
    { end: 4, line: 1, start: 0 }
  ]);
  const crossed = panel.applyFreeSpanStyle(two, across.targets, { weight: 900 }, HEADING_BASE);
  assert.deepEqual(crossed, [[{ text: "Experimente " }, { style: { weight: 900 }, text: "grátis" }], [{ style: { weight: 900 }, text: "Nova" }, { text: " aula" }]]);

  // Seleção que passa por partes com estilos diferentes: cada uma guarda o que já tinha e ganha o novo.
  const mixed = [[{ style: { paint: VERDE }, text: "Experimente" }, { text: " grátis" }]];
  const mixedSplit = panel.splitFreeSpanAtSelection(mixed, { end: 14, start: 6 });
  const bold = panel.applyFreeSpanStyle(mixed, mixedSplit.targets, { weight: 900 }, HEADING_BASE);
  assert.deepEqual(bold, [[{ style: { paint: VERDE }, text: "Experi" }, { style: { paint: VERDE, weight: 900 }, text: "mente" }, { style: { weight: 900 }, text: " gr" }, { text: "átis" }]]);

  // O popover mostra o estilo do trecho: o do elemento com o da primeira parte por cima.
  assert.deepEqual(panel.freeRangeStyle(mixed, { end: 14, line: 0, start: 6 }, HEADING_BASE).paint, VERDE);
  assert.equal(panel.freeRangeStyle(mixed, { end: 18, line: 0, start: 12 }, HEADING_BASE).weight, 800);
});

test("Outro estilo na seleção: seleção vazia ou só de quebra de linha não divide nada", () => {
  const lines = [[{ text: "Experimente" }], [{ text: "grátis" }]];

  assert.equal(panel.splitFreeSpanAtSelection(lines, { end: 4, start: 4 }), null);
  // Só o "\n" entre as linhas (posição 11 a 12).
  assert.equal(panel.splitFreeSpanAtSelection(lines, { end: 12, start: 11 }), null);
  assert.deepEqual(panel.freeSelectionRanges(lines, { end: 12, start: 11 }), []);
  // Uma linha vazia selecionada também não tem o que estilizar.
  assert.equal(panel.splitFreeSpanAtSelection([[{ text: "" }]], { end: 0, start: 0 }), null);
  // Fora do texto: fica dentro dele.
  assert.deepEqual(panel.freeSelectionRanges(lines, { end: 99, start: 13 }), [{ end: 6, line: 1, start: 1 }]);
  assert.equal(C.text.selectFirst, "Selecione palavras na área de texto primeiro.");
});

test("Outro estilo na seleção: acentos, emoji e letras combinadas nunca são partidos ao meio", () => {
  // "á" composto (a + acento combinando, 2 unidades) e um emoji de bandeira (4 unidades) e um de família (ZWJ).
  const combining = "Grátis";
  const lines = [[{ text: `Oi ${combining} 🇧🇷 👨‍👩‍👧 fim` }]];
  const text = textOf(lines);

  // Selecionar só o acento (no meio do "á"): o trecho cresce até a letra inteira.
  const accentAt = text.indexOf("́");
  const accent = panel.freeSelectionRanges(lines, { end: accentAt + 1, start: accentAt });
  assert.deepEqual(accent, [{ end: accentAt + 1, line: 0, start: accentAt - 1 }]);

  // Selecionar metade da bandeira: ela inteira entra.
  const flagAt = text.indexOf("🇧🇷");
  const flag = panel.splitFreeSpanAtSelection(lines, { end: flagAt + 1, start: flagAt });
  assert.equal(flag.lines[0][1].text, "🇧🇷");

  // A família (ZWJ) inteira, mesmo selecionando só o começo.
  const familyAt = text.indexOf("👨‍👩‍👧");
  const family = panel.splitFreeSpanAtSelection(lines, { end: familyAt + 2, start: familyAt });
  assert.equal(family.lines[0][1].text, "👨‍👩‍👧");

  // Estilo no emoji e o texto continua o mesmo (nenhuma unidade perdida ou duplicada).
  const styled = panel.applyFreeSpanStyle(lines, family.targets, { paint: ROSA }, TEXT_BASE);
  assert.equal(textOf(styled), text);
  assert.deepEqual(styled[0][1], { style: { paint: ROSA }, text: "👨‍👩‍👧" });

  // Contagem de letras como o zod: pontos de código (o emoji de 2 unidades conta 1).
  assert.equal(panel.freeTextLength("😀"), 1);
  assert.equal(panel.freeTextLength("ação"), 4);
});

test("editar o texto mantém o estilo das partes, tira as vazias e junta as iguais", () => {
  const lines = [[{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis" }], [{ text: "Nova aula" }]];

  // Escrever no fim de uma parte com estilo continua o estilo dela.
  assert.deepEqual(panel.applyFreeTextEdit(lines, "Experimente grátis!\nNova aula", { base: HEADING_BASE, caret: 19 }), [
    [{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis!" }],
    [{ text: "Nova aula" }]
  ]);

  // Escrever no meio da parte verde: ela cresce.
  assert.deepEqual(panel.applyFreeTextEdit(lines, "Experimente gráaatis\nNova aula", { base: HEADING_BASE, caret: 16 })[0][1], { style: { paint: VERDE }, text: "gráaatis" });

  // No começo da linha, o estilo da primeira parte.
  const startStyled = [[{ style: { paint: VERDE }, text: "grátis" }, { text: " hoje" }]];
  assert.deepEqual(panel.applyFreeTextEdit(startStyled, "Já grátis hoje", { base: TEXT_BASE, caret: 3 }), [[{ style: { paint: VERDE }, text: "Já grátis" }, { text: " hoje" }]]);

  // Apagar a parte verde inteira: ela sai e as vizinhas (iguais) se juntam numa só.
  const middle = [[{ text: "Antes " }, { style: { paint: VERDE }, text: "meio" }, { text: " depois" }]];
  assert.deepEqual(panel.applyFreeTextEdit(middle, "Antes  depois", { base: TEXT_BASE, caret: 6 }), [[{ text: "Antes  depois" }]]);

  // Escrever por cima de uma seleção: o texto novo fica com o estilo do começo dela.
  assert.deepEqual(panel.applyFreeTextEdit(middle, "Antes XYZ depois", { base: TEXT_BASE, caret: 9 }), [[{ text: "Antes " }, { style: { paint: VERDE }, text: "XYZ" }, { text: " depois" }]]);
  assert.deepEqual(panel.applyFreeTextEdit(middle, "Antes mXYZ depois", { base: TEXT_BASE, caret: 10 }), [[{ text: "Antes " }, { style: { paint: VERDE }, text: "mXYZ" }, { text: " depois" }]]);
  // Seleção que pega o fim da parte verde e o começo da de depois ("io de"): o texto novo fica verde e a parte
  // de depois perde só o começo.
  assert.deepEqual(panel.applyFreeTextEdit(middle, "Antes meZpois", { base: TEXT_BASE, caret: 9 }), [[{ text: "Antes " }, { style: { paint: VERDE }, text: "meZ" }, { text: "pois" }]]);
  // Seleção que começa na parte sem estilo e passa pela verde inteira: a verde some e tudo junta.
  assert.deepEqual(panel.applyFreeTextEdit(middle, "AnteZ depois", { base: TEXT_BASE, caret: 5 }), [[{ text: "AnteZ depois" }]]);

  // Apagar a quebra de linha junta as duas linhas; partes iguais se juntam.
  assert.deepEqual(panel.applyFreeTextEdit([[{ text: "um" }], [{ text: "dois" }]], "umdois", { caret: 2 }), [[{ text: "umdois" }]]);
  // E as diferentes ficam lado a lado.
  assert.deepEqual(panel.applyFreeTextEdit(lines, "Experimente grátisNova aula", { base: HEADING_BASE, caret: 18 }), [
    [{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis" }, { text: "Nova aula" }]
  ]);

  // Enter no meio da parte verde: as duas metades continuam verdes.
  assert.deepEqual(panel.applyFreeTextEdit(lines, "Experimente grá\ntis\nNova aula", { base: HEADING_BASE, caret: 16 }), [
    [{ text: "Experimente " }, { style: { paint: VERDE }, text: "grá" }],
    [{ style: { paint: VERDE }, text: "tis" }],
    [{ text: "Nova aula" }]
  ]);

  // Apagar tudo: uma linha vazia que guarda o estilo do começo (o que for escrito volta com ele).
  const cleared = panel.applyFreeTextEdit(startStyled, "", { base: TEXT_BASE, caret: 0 });
  assert.deepEqual(cleared, [[{ style: { paint: VERDE }, text: "" }]]);
  assert.deepEqual(panel.applyFreeTextEdit(cleared, "Oi", { base: TEXT_BASE, caret: 2 }), [[{ style: { paint: VERDE }, text: "Oi" }]]);

  // "aa" -> "aaa": o cursor diz quem cresceu.
  const twins = [[{ style: { paint: VERDE }, text: "a" }, { style: { paint: ROSA }, text: "a" }]];
  assert.deepEqual(panel.applyFreeTextEdit(twins, "aaa", { caret: 1 })[0], [{ style: { paint: VERDE }, text: "aa" }, { style: { paint: ROSA }, text: "a" }]);
  assert.deepEqual(panel.applyFreeTextEdit(twins, "aaa", { caret: 3 })[0], [{ style: { paint: VERDE }, text: "a" }, { style: { paint: ROSA }, text: "aa" }]);

  // Emoji trocado por outro emoji (o mesmo começo de par): a parte certa, nenhum par partido.
  const emoji = [[{ text: "Oi " }, { style: { paint: ROSA }, text: "😀" }, { text: " fim" }]];
  assert.deepEqual(panel.applyFreeTextEdit(emoji, "Oi 😁 fim", { caret: 5 }), [[{ text: "Oi " }, { style: { paint: ROSA }, text: "😁" }, { text: " fim" }]]);
  assert.deepEqual(panel.freeTextDiff("a😀b", "a😁b"), { end: 3, inserted: "😁", start: 1 });

  // Uma parte com estilo igual ao do elemento perde o estilo e junta com a vizinha.
  const sameAsBase = [[{ text: "Nova " }, { style: { weight: 800 }, text: "aula" }]];
  assert.deepEqual(panel.normalizeFreeLines(sameAsBase, HEADING_BASE), [[{ text: "Nova aula" }]]);

  // Juntar nunca passa de 600 letras numa parte.
  const long = "a".repeat(400);
  const kept = panel.normalizeFreeLines([[{ text: long }, { text: long }]]);
  assert.equal(kept[0].length, 2);

  // Sem mudança: o mesmo objeto (o histórico não ganha passo à toa).
  assert.equal(panel.applyFreeTextEdit(lines, textOf(lines)), lines);
});

test("voltar ao estilo do elemento", () => {
  const lines = [[{ text: "Experimente " }, { style: { paint: VERDE, weight: 900 }, text: "grátis" }, { text: " hoje" }]];
  const range = { end: 18, line: 0, start: 12 };

  assert.equal(panel.freeRangeHasOwnStyle(lines, [range], HEADING_BASE), true);

  // "Voltar ao estilo do elemento" (patch null): a parte perde tudo e junta com as vizinhas.
  const reset = panel.applyFreeSpanStyle(lines, [range], null, HEADING_BASE);
  assert.deepEqual(reset, [[{ text: "Experimente grátis hoje" }]]);
  assert.equal(panel.freeRangeHasOwnStyle(reset, [range], HEADING_BASE), false);

  // Tirar só uma coisa (chave com undefined): a cor sai, o peso fica.
  const onlyWeight = panel.applyFreeSpanStyle(lines, [range], { paint: undefined }, HEADING_BASE);
  assert.deepEqual(onlyWeight[0][1], { style: { weight: 900 }, text: "grátis" });

  // Escolher o mesmo valor do elemento é o mesmo que voltar: a parte some.
  const back = panel.applyFreeSpanStyle(onlyWeight, [range], { weight: 800 }, HEADING_BASE);
  assert.deepEqual(back, [[{ text: "Experimente grátis hoje" }]]);
  assert.equal(C.span.reset, "Voltar ao estilo do elemento");

  // As fichas de "Partes com estilo próprio": uma por parte com estilo, com o texto e o que muda.
  const parts = panel.freeStyledParts(lines, HEADING_BASE);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].label, "“grátis” · verde, black");
  assert.deepEqual(parts[0].range, range);
  assert.deepEqual(panel.freeStyledParts(reset, HEADING_BASE), []);
  assert.equal(panel.describeFreeSpanStyle({ decoration: "line-through", italic: true, size: 18 }), "itálico, 18 px, riscado");
  assert.equal(panel.describeFreeSpanStyle({ font: { id: "f1", kind: "uploaded" } }, [{ id: "f1", name: "Bebas" }]), "Bebas");
  assert.equal(panel.freeColorName("#ffffff"), "branco");
  assert.equal(panel.freeColorName("#e50914"), "vermelho");
  assert.equal(panel.freeColorName("#00000000"), "transparente");
});

test("letras usadas: o design todo, como o zod conta", () => {
  const value = design([
    { id: "titulo", lines: [[{ text: "Olá " }, { style: { paint: VERDE }, text: "😀" }]], type: "heading" },
    { id: "selo", label: "Novo", type: "badge" },
    { action: { kind: "close" }, id: "botao", label: "Agora não", type: "button" },
    LINKS
  ]);

  assert.equal(panel.freeLetterCount(value), 4 + 1 + 4 + 9);
  assert.equal(C.text.letters(312), "Letras usadas: 312 de 1.200");
});

test("qualquer edição devolve exatamente o texto escrito, sem parte vazia no meio e sem vizinhas iguais", () => {
  // Gerador com semente fixa (o teste sempre faz as mesmas 400 edições).
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const alphabet = ["a", "b", " ", "ç", "é", "😀", "\n", "Z"];
  const styles = [undefined, { paint: VERDE }, { weight: 900 }, { paint: ROSA, italic: true }];
  let lines = [[{ text: "Experimente " }, { style: { paint: VERDE }, text: "grátis" }], [{ text: "Nova aula" }]];

  for (let step = 0; step < 400; step += 1) {
    const text = textOf(lines);
    const units = [...text];
    const from = Math.floor(random() * (units.length + 1));
    const to = Math.min(units.length, from + Math.floor(random() * 3));
    const inserted = Array.from({ length: Math.floor(random() * 3) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
    const next = units.slice(0, from).join("") + inserted + units.slice(to).join("");
    const caret = (units.slice(0, from).join("") + inserted).length;

    if (next.split("\n").length > 12) {
      continue;
    }

    lines = panel.applyFreeTextEdit(lines, next, { base: TEXT_BASE, caret });
    assert.equal(textOf(lines), next, `passo ${step}`);

    for (const line of lines) {
      assert.ok(line.length >= 1);
      assert.ok(line.length === 1 || line.every((span) => span.text !== ""), `parte vazia no passo ${step}`);

      for (let index = 1; index < line.length; index += 1) {
        assert.notDeepEqual(line[index].style, line[index - 1].style, `vizinhas iguais no passo ${step}`);
      }
    }

    // De vez em quando, um estilo numa seleção (o texto continua o mesmo).
    if (step % 9 === 0 && units.length > 2) {
      const split = panel.splitFreeSpanAtSelection(lines, { end: Math.min(textOf(lines).length, 4), start: 1 });

      if (split) {
        lines = panel.applyFreeSpanStyle(lines, split.targets, styles[step % styles.length] ?? null, TEXT_BASE);
        assert.equal(textOf(lines), next);
      }
    }
  }
});

test("arquivos: imagem enviada entra com id novo, o mesmo caminho reaproveita e o que ficou sem uso sai", () => {
  const PATH_A = "communications/free/aaaaaaaaaaaaaaaaaaaaaaaa.webp";
  const PATH_B = "communications/free/bbbbbbbbbbbbbbbbbbbbbbbb.webp";
  const start = design([{ asset: null, id: "img", type: "image" }, { asset: null, id: "img2", type: "image" }, LINKS]);

  // A primeira imagem: id novo (o id "img" do elemento já existe, então o arquivo vira "img3").
  const one = panel.withFreeNodeImage(start, "img", { height: 48, path: PATH_A, width: 64 });
  assert.deepEqual(one.assets, [{ height: 48, id: "img3", kind: "image", path: PATH_A, width: 64 }]);
  assert.equal(model.findFreeNode(one, "img").node.asset, "img3");

  // O mesmo caminho no outro elemento: o mesmo arquivo.
  const two = panel.withFreeNodeImage(one, "img2", { height: 48, path: PATH_A, width: 64 });
  assert.equal(two.assets.length, 1);
  assert.equal(model.findFreeNode(two, "img2").node.asset, "img3");

  // "Usar uma imagem deste pop-up" pelo id.
  assert.equal(panel.withFreeNodeImage(start, "img", "img3").children[0].asset, null);

  // Trocar a imagem dos dois elementos: a antiga fica sem uso e sai da lista.
  const swapped = panel.withFreeNodeImage(panel.withFreeNodeImage(two, "img", { height: 20, path: PATH_B, width: 30 }), "img2", { height: 20, path: PATH_B, width: 30 });
  assert.deepEqual(
    swapped.assets.map((asset) => asset.path),
    [PATH_B]
  );
  assert.ok(schema.parsePopupFreeDesign(swapped));
  assert.deepEqual(panel.freeImageAssets(swapped).map((asset) => asset.path), [PATH_B]);

  // O que nenhum elemento usa sai (a capa de um vídeo usado fica).
  assert.equal(panel.pruneFreeAssets(swapped), swapped);
});

test("vídeo e capa: trocar o vídeo tira o anterior e a capa dele; enviar e tirar a capa", () => {
  const VIDEO_A = { mimeType: "video/mp4", path: "videos/0b7c7f2e-3a0e-4d39-9b39-0f6c0f9b2a11.mp4" };
  const VIDEO_B = { mimeType: "video/webm", path: "videos/1c8d8f3f-4b1f-4e4a-8c4a-1f7d1f0c3b22.webm" };
  const CAPA = { height: 248, path: "communications/free/cccccccccccccccccccccccc.webp", width: 440 };
  const start = design([{ asset: null, id: "midia", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, type: "video" }, LINKS]);

  const withVideo = panel.withFreeNodeVideo(start, "midia", VIDEO_A, CAPA);
  const { poster, video } = panel.freeVideoAssetOf(withVideo, "midia");
  assert.equal(video.path, VIDEO_A.path);
  assert.equal(poster.path, CAPA.path);
  assert.equal(video.poster, poster.id);
  assert.ok(schema.parsePopupFreeDesign(withVideo));

  // Trocar o vídeo sem capa: o anterior e a capa dele saem.
  const replaced = panel.withFreeNodeVideo(withVideo, "midia", VIDEO_B, null);
  assert.deepEqual(replaced.assets.map((asset) => asset.path), [VIDEO_B.path]);
  assert.equal(panel.freeVideoAssetOf(replaced, "midia").poster, null);
  assert.ok(schema.parsePopupFreeDesign(replaced));

  // Enviar uma capa depois e tirar de novo.
  const covered = panel.withFreeVideoPoster(replaced, "midia", CAPA);
  assert.equal(panel.freeVideoAssetOf(covered, "midia").poster.path, CAPA.path);
  const uncovered = panel.withFreeVideoPoster(covered, "midia", null);
  assert.equal(panel.freeVideoAssetOf(uncovered, "midia").poster, null);
  assert.equal(uncovered.assets.length, 1);

  // Sem vídeo no elemento, a capa não entra.
  assert.equal(panel.withFreeVideoPoster(start, "midia", CAPA), start);
});

test("camada de imagem no fundo da prancheta e de um elemento", () => {
  const PATH = "communications/free/dddddddddddddddddddddddd.webp";
  const start = design([{ id: "forma", type: "shape" }, LINKS]);
  const add = (assetId, current) => panel.addFreeFillLayer(current, { asset: assetId, kind: "image" });

  const artboard = panel.withFreeFillImage(start, null, { height: 100, path: PATH, width: 100 }, add);
  assert.deepEqual(artboard.artboard.fill[0], { asset: "img", kind: "image" });
  assert.equal(artboard.assets.length, 1);
  assert.ok(schema.parsePopupFreeDesign(artboard));

  const shape = panel.withFreeFillImage(artboard, "forma", "img", add);
  assert.deepEqual(model.findFreeNode(shape, "forma").node.box.fill, [{ asset: "img", kind: "image" }]);
  assert.equal(shape.assets.length, 1);
});

test("estilo do texto, caixa, prancheta e X: mudar e voltar ao padrão tira o campo", () => {
  const start = design([{ id: "titulo", lines: [[{ text: "Aula" }]], type: "heading" }, { id: "forma", type: "shape" }, LINKS]);

  const styled = panel.withFreeTextStyle(start, "titulo", { size: 40, uppercase: true });
  assert.deepEqual(model.findFreeNode(styled, "titulo").node.textStyle, { size: 40, uppercase: true });
  const back = panel.withFreeTextStyle(styled, "titulo", { size: undefined, uppercase: undefined });
  assert.equal("textStyle" in model.findFreeNode(back, "titulo").node, false);
  // Elemento sem texto não ganha estilo de texto.
  assert.equal(panel.withFreeTextStyle(start, "forma", { size: 40 }), start);

  const boxed = panel.withFreeBox(start, "forma", { blur: 20, radius: 16 });
  assert.deepEqual(model.findFreeNode(boxed, "forma").node.box, { blur: 20, radius: 16 });
  assert.equal("box" in model.findFreeNode(panel.withFreeBox(boxed, "forma", { blur: undefined, radius: undefined }), "forma").node, false);

  const fields = panel.withFreeNodeFields(start, "forma", { name: "Mancha", shape: "ellipse" });
  assert.equal(model.findFreeNode(fields, "forma").node.shape, "ellipse");
  assert.equal("name" in model.findFreeNode(panel.withFreeNodeFields(fields, "forma", { name: undefined }), "forma").node, false);

  const wide = panel.withFreeArtboard(start, { gap: 0, justify: "center" });
  assert.deepEqual(wide.artboard, { gap: 0, justify: "center" });
  assert.equal("artboard" in panel.withFreeArtboard(wide, { gap: undefined, justify: undefined }), false);

  const closed = panel.withFreeClose(start, { color: "#000000", background: "#ffffff" });
  assert.deepEqual(closed.close, { background: "#ffffff", color: "#000000" });
  assert.ok(schema.parsePopupFreeDesign(closed));
  assert.equal("close" in panel.withFreeClose(closed, { background: undefined, color: undefined }), false);
});

test("erros e dicas de um campo: a chave e o que está dentro dela", () => {
  const errors = { "freeDesign.nodes.titulo.lines.1.0.text": "Escreva algo nesta linha.", "close.color": "O X precisa aparecer bem." };

  assert.equal(panel.freeErrorAt(errors, "nodes.titulo.lines"), "Escreva algo nesta linha.");
  assert.equal(panel.freeErrorAt(errors, "nodes.titulo"), "Escreva algo nesta linha.");
  assert.equal(panel.freeErrorAt(errors, "nodes.titul"), undefined);
  assert.equal(panel.freeErrorAt(errors, "close.background", "close.color"), "O X precisa aparecer bem.");

  const hints = [
    { key: "nodes.titulo.textStyle.paint", kind: "contrast", message: "a", nodeId: "titulo" },
    { key: "nodes.titulo.textStyle.size", kind: "small-text", message: "b", nodeId: "titulo" },
    { key: "artboard.minHeight", kind: "phone-scroll", message: "c", nodeId: null }
  ];
  assert.deepEqual(panel.freeHintsOf(hints, "titulo", ["contrast"]).map((hint) => hint.message), ["a"]);
  assert.equal(panel.freeHintsOf(hints, "titulo").length, 2);
  assert.equal(panel.freeHintsOf(hints, null).length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * Estilo
 * ---------------------------------------------------------------------------------------------- */

test("paradas do degradê: acrescentar, tirar e posição", () => {
  const two = [
    { at: 0, color: "#000000" },
    { at: 100, color: "#ffffff" }
  ];

  // "+ Cor": no meio do maior vão, com a cor do meio.
  const three = panel.addFreeStop(two);
  assert.deepEqual(three, [
    { at: 0, color: "#000000" },
    { at: 50, color: "#808080" },
    { at: 100, color: "#ffffff" }
  ]);

  // Vão maior depois da última parada.
  assert.deepEqual(panel.addFreeStop([{ at: 0, color: "#ff0000" }, { at: 20, color: "#00ff00" }]).at(-1), { at: 60, color: "#00ff00" });

  // Até 5 paradas.
  const five = panel.addFreeStop(panel.addFreeStop(three));
  assert.equal(five.length, 5);
  assert.equal(panel.addFreeStop(five).length, 5);

  // Tirar: guarda pelo menos 2.
  assert.deepEqual(panel.removeFreeStop(three, 1), two);
  assert.deepEqual(panel.removeFreeStop(two, 0), two);

  // Posição: inteira, de 0 a 100; cor só se valer.
  assert.deepEqual(panel.setFreeStop(two, 1, { at: 72.6 })[1], { at: 73, color: "#ffffff" });
  assert.deepEqual(panel.setFreeStop(two, 1, { at: 140 })[1].at, 100);
  assert.deepEqual(panel.setFreeStop(two, 0, { at: -5 })[0].at, 0);
  assert.deepEqual(panel.setFreeStop(two, 0, { color: "#E5FF1F" })[0].color, "#e5ff1f");
  assert.deepEqual(panel.setFreeStop(two, 0, { color: "verde" })[0].color, "#000000");

  // A faixa da prévia só leva cores hex e posições em ordem.
  assert.equal(panel.freeStopsPreview([{ at: 100, color: "#ffffff" }, { at: 0, color: "#000000" }]), "linear-gradient(90deg, #000000 0%, #ffffff 100%)");
  assert.equal(panel.freeStopsPreview([{ at: 0, color: "red);background:url(x" }]), "none");

  // Trocar Cor | Degradê | Degradê circular mantém as cores.
  const solid = { color: "#e50914", kind: "solid" };
  const linear = panel.freeTextPaintOfKind("linear", solid);
  assert.equal(linear.kind, "linear");
  assert.equal(linear.stops[0].color, "#e50914");
  const radial = panel.freeTextPaintOfKind("radial", linear);
  assert.deepEqual(radial.stops, linear.stops);
  assert.deepEqual(panel.freeTextPaintOfKind("solid", radial), { color: "#e50914", kind: "solid" });
});

test("camadas de fundo: até 3, subir e descer", () => {
  const base = panel.newFreeFillLayer("solid", "#16181c");
  const glow = panel.newFreeFillLayer("radial", "#e50914");
  const fade = panel.newFreeFillLayer("linear", "#16181c");

  assert.deepEqual(base, { color: "#16181c", kind: "solid" });
  assert.equal(glow.kind, "radial");
  assert.equal(fade.stops[0].color, "#16181c00");

  // A nova entra por cima (a primeira da lista).
  let fill = panel.addFreeFillLayer(undefined, base);
  fill = panel.addFreeFillLayer(fill, glow);
  assert.deepEqual(fill, [glow, base]);
  fill = panel.addFreeFillLayer(fill, fade);
  assert.deepEqual(fill, [fade, glow, base]);

  // A quarta não entra.
  assert.equal(panel.addFreeFillLayer(fill, base).length, 3);

  // Subir e descer (fora da lista não muda).
  assert.deepEqual(panel.moveFreeFillLayer(fill, 2, -1), [fade, base, glow]);
  assert.deepEqual(panel.moveFreeFillLayer(fill, 0, 1), [glow, fade, base]);
  assert.deepEqual(panel.moveFreeFillLayer(fill, 0, -1), fill);
  assert.deepEqual(panel.moveFreeFillLayer(fill, 2, 1), fill);

  // Tirar; a prancheta guarda pelo menos uma camada.
  assert.deepEqual(panel.removeFreeFillLayer(fill, 1), [fade, base]);
  assert.deepEqual(panel.removeFreeFillLayer([base], 0, 1), [base]);
  assert.deepEqual(panel.removeFreeFillLayer([base], 0), []);

  // Imagem só com um arquivo do design.
  assert.equal(panel.newFreeFillLayer("image", null), null);
  assert.deepEqual(panel.newFreeFillLayer("image", null, "img1"), { asset: "img1", kind: "image" });
  assert.equal(panel.freeFillPaintOfKind("image", base, null), null);
  assert.deepEqual(panel.freeFillPaintOfKind("image", base, "img1"), { asset: "img1", kind: "image" });
  assert.deepEqual(panel.freeFillPaintOfKind("solid", glow, null), { color: "#e50914cc", kind: "solid" });

  // A cor de base de um fundo é a camada de baixo.
  assert.equal(panel.freeFillBaseColor([fade, glow, base]), "#16181c");
  assert.equal(panel.freeFillBaseColor([{ asset: "img1", kind: "image" }]), null);
});

/* ------------------------------------------------------------------------------------------------
 * Faixa Ordem do Fundo (docs/27 §13.9, L4a): arrastar a ficha ou Alt e as setas
 * ---------------------------------------------------------------------------------------------- */

const VERMELHO = { color: "#ff0000", kind: "solid" };
const VERDE_FUNDO = { color: "#00ff00", kind: "solid" };
const AZUL = { color: "#0000ff", kind: "solid" };
const LARANJA = { color: "#ffaa00", kind: "solid" };
const TRES = [VERMELHO, VERDE_FUNDO, AZUL];
const SELO_COM_FUNDO = { box: { fill: TRES }, id: "selo", label: "Novidade", type: "badge" };
const TITULO_FUNDO = { id: "titulo", lines: [[{ text: "Aula nova" }]], textStyle: { size: 40 }, type: "heading" };

test("camadas de fundo de um lugar a outro: a posição final, sem perder nem duplicar camada", () => {
  assert.deepEqual(panel.moveFreeFillLayerTo(TRES, 0, 2), [VERDE_FUNDO, AZUL, VERMELHO]);
  assert.deepEqual(panel.moveFreeFillLayerTo(TRES, 2, 0), [AZUL, VERMELHO, VERDE_FUNDO]);
  assert.deepEqual(panel.moveFreeFillLayerTo(TRES, 1, 0), [VERDE_FUNDO, VERMELHO, AZUL]);

  // O mesmo lugar e fora da lista: null (nada muda e não há passo vazio).
  assert.equal(panel.moveFreeFillLayerTo(TRES, 1, 1), null);
  assert.equal(panel.moveFreeFillLayerTo(TRES, -1, 0), null);
  assert.equal(panel.moveFreeFillLayerTo(TRES, 0, 3), null);
  assert.equal(panel.moveFreeFillLayerTo(TRES, 0.5, 1), null);
  assert.equal(panel.moveFreeFillLayerTo([], 0, 0), null);
  assert.deepEqual(TRES, [VERMELHO, VERDE_FUNDO, AZUL], "a lista de antes não muda");

  // Todas as idas: a camada levada fica no lugar pedido, com as mesmas referências (nenhuma se perde ou se repete), e o
  // design continua valendo num Selo e na prancheta (com cores escuras: a camada de baixo da prancheta é a base do X, e
  // o X precisa contrastar com ela em qualquer ordem).
  const ESCURAS = [{ color: "#550000", kind: "solid" }, { color: "#005500", kind: "solid" }, { color: "#000055", kind: "solid" }];
  const base = design([SELO_COM_FUNDO, LINKS], { artboard: { fill: ESCURAS } });

  for (let from = 0; from < 3; from += 1) {
    for (let to = 0; to < 3; to += 1) {
      const moved = panel.moveFreeFillLayerTo(TRES, from, to);

      if (from === to) {
        assert.equal(moved, null);
        continue;
      }

      assert.equal(moved.length, 3);
      assert.equal(moved[to], TRES[from]);
      assert.equal(new Set(moved).size, 3);
      assert.ok(TRES.every((layer) => moved.includes(layer)));
      assert.ok(schema.parsePopupFreeDesign(panel.withFreeArtboard(base, { fill: panel.moveFreeFillLayerTo(ESCURAS, from, to) })), `prancheta ${from} -> ${to}`);
      assert.ok(schema.parsePopupFreeDesign(panel.withFreeBox(base, "selo", { fill: moved })), `selo ${from} -> ${to}`);
    }
  }

  // O lugar de soltar pelos meios das fichas de hoje (px de tela), sem contar o da ficha arrastada.
  const mids = [10, 50, 90];
  assert.equal(panel.freeFillDropIndex(2, 5, mids), 0);
  assert.equal(panel.freeFillDropIndex(2, 30, mids), 1);
  assert.equal(panel.freeFillDropIndex(2, 70, mids), 2, "entre a ficha de cima e a própria: o mesmo lugar");
  assert.equal(panel.freeFillDropIndex(0, 95, mids), 2);
  assert.equal(panel.freeFillDropIndex(0, 60, mids), 1);
  assert.equal(panel.freeFillDropIndex(0, 20, mids), 0);
  assert.equal(panel.freeFillDropIndex(1, -40, mids), 0);
  assert.equal(panel.freeFillDropIndex(1, 400, mids), 2);

  // Longe da faixa (mais de 32 px): sem lugar, soltar ali não muda nada.
  const area = { bottom: 100, left: 0, right: 200, top: 0 };
  assert.equal(panel.FREE_FILL_DROP_SLACK_PX, 32);
  assert.equal(panel.freeFillDropAt(2, { x: 100, y: 5 }, area, mids), 0);
  assert.equal(panel.freeFillDropAt(2, { x: -31, y: 50 }, area, mids), 1);
  assert.equal(panel.freeFillDropAt(0, { x: 100, y: 131 }, area, mids), 2);
  assert.equal(panel.freeFillDropAt(2, { x: -33, y: 50 }, area, mids), null);
  assert.equal(panel.freeFillDropAt(0, { x: 100, y: 133 }, area, mids), null);
  assert.equal(panel.freeFillDropAt(0, { x: 233, y: 50 }, area, mids), null);
  assert.equal(panel.freeFillDropAt(1, { x: 100, y: -33 }, area, mids), null);

  // O soltar só grava com o fundo igual ao do começo, camada por camada (a prancheta sem fundo próprio desenha uma
  // cópia nova da lista padrão a cada vez: a cópia vale).
  assert.deepEqual(panel.freeFillReorder(TRES, TRES, 2, 0), [AZUL, VERMELHO, VERDE_FUNDO]);
  assert.deepEqual(panel.freeFillReorder(TRES, [...TRES], 2, 0), [AZUL, VERMELHO, VERDE_FUNDO]);
  assert.equal(panel.freeFillReorder(TRES, [LARANJA, VERDE_FUNDO, AZUL], 2, 0), null, "uma camada mudou durante o gesto");
  assert.equal(panel.freeFillReorder(TRES, [VERMELHO, VERDE_FUNDO], 1, 0), null, "uma camada saiu durante o gesto");
  assert.equal(panel.freeFillReorder(TRES, undefined, 1, 0), null);
  assert.equal(panel.freeFillReorder(TRES, TRES, 1, 1), null, "o mesmo lugar");

  // A amostra da ficha: só cores hex validadas; a imagem não tem amostra.
  assert.equal(panel.freeFillSwatch(VERMELHO), "linear-gradient(90deg, #ff0000 0%, #ff0000 100%)");
  assert.equal(panel.freeFillSwatch({ kind: "linear", stops: [{ at: 0, color: "#00000000" }, { at: 100, color: "#16181c" }] }), "linear-gradient(90deg, #00000000 0%, #16181c 100%)");
  assert.equal(panel.freeFillSwatch({ asset: "img1", kind: "image" }), null);
  assert.equal(panel.freeFillSwatch({ color: "red; background: url(x)", kind: "solid" }), null);
});

test("camadas de fundo: o foco segue a camada (Subir, Descer, a faixa, Tirar e + Camada)", () => {
  // Subir: a camada foi para cima; no topo, o Subir dela desliga e o foco vai para o Descer.
  assert.deepEqual(panel.freeFillFocusAfter("up", 2, 3, 0), { button: "subir", index: 1 });
  assert.deepEqual(panel.freeFillFocusAfter("up", 1, 3, 0), { button: "descer", index: 0 });
  // Descer: no fim, o Descer dela desliga e o foco vai para o Subir.
  assert.deepEqual(panel.freeFillFocusAfter("down", 0, 3, 0), { button: "descer", index: 1 });
  assert.deepEqual(panel.freeFillFocusAfter("down", 1, 3, 0), { button: "subir", index: 2 });
  // A faixa (arrastar ou Alt e as setas): a ficha no lugar novo.
  assert.deepEqual(panel.freeFillFocusAfter("order", 2, 3, 0), { button: "ordem", index: 2 });
  // Tirar: o Tirar que ficou no lugar (ou o de cima); sem o que tirar, o + Camada.
  assert.deepEqual(panel.freeFillFocusAfter("remove", 2, 2, 0), { button: "tirar", index: 1 });
  assert.deepEqual(panel.freeFillFocusAfter("remove", 0, 2, 0), { button: "tirar", index: 0 });
  assert.deepEqual(panel.freeFillFocusAfter("remove", 1, 1, 1), { button: "acrescentar", index: 0 }, "a prancheta guarda uma camada: o Tirar desliga");
  assert.deepEqual(panel.freeFillFocusAfter("remove", 0, 0, 0), { button: "acrescentar", index: 0 });
  // + Camada (a nova entra em cima): o foco fica nele enquanto ele continua ligado; a terceira camada desliga o botão,
  // e o foco vai para a ficha da camada nova (no WebKit ele cairia no vazio).
  assert.deepEqual(panel.freeFillFocusAfter("add", 0, 1, 0), { button: "acrescentar", index: 0 });
  assert.deepEqual(panel.freeFillFocusAfter("add", 0, 2, 1), { button: "acrescentar", index: 0 });
  assert.deepEqual(panel.freeFillFocusAfter("add", 0, model.FREE_DESIGN_LIMITS.fills, 0), { button: "ordem", index: 0 });

  // Os ids da tela.
  assert.equal(panel.freeFillFocusId("livre-selo-fundo", { button: "subir", index: 1 }), "livre-selo-fundo-1-subir");
  assert.equal(panel.freeFillFocusId("livre-popup-fundo", { button: "ordem", index: 0 }), "livre-popup-fundo-0-ordem");
  assert.equal(panel.freeFillFocusId("livre-popup-fundo", { button: "acrescentar", index: 0 }), "livre-popup-fundo-acrescentar");

  // As frases da faixa, palavra por palavra.
  assert.equal(C.fill.order, "Ordem");
  assert.equal(C.fill.orderLabel, "Ordem das camadas de fundo");
  assert.equal(C.fill.handle(C.fill.layer(0, "Cor")), "Mover Camada 1: Cor. Arraste ou use Alt e as setas.");
  assert.equal(C.fill.moved(C.fill.layer(2, "Imagem")), "Camada de fundo movida. Agora é a Camada 3: Imagem.");

  // Na tela: cada mudança estrutural pede o foco, e ele é resolvido depois de a lista nova aparecer.
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-fields.tsx", import.meta.url), "utf8");
  for (const call of ['commitStep(moveFreeFillLayer(fill, index, -1), "up", index)', 'commitStep(moveFreeFillLayer(fill, index, 1), "down", index)', 'commitStep(removeFreeFillLayer(fill, index, min), "remove", index)', 'commitStep(addFreeFillLayer(fill, layer), "add", 0)', 'commitStep(next, "order", to)']) {
    assert.ok(source.includes(call), call);
  }
  assert.match(source, /freeFillFocusId\(id, freeFillFocusAfter\(focusAfter\.action, focusAfter\.index, fill\.length, min\)\)/);
});

test("camadas de fundo: a imagem que sobe acha a sua camada pela referência, e o cartão que espera fica parado", () => {
  const PATH = "communications/free/eeeeeeeeeeeeeeeeeeeeeeee.webp";
  const imagem = { asset: "img", kind: "image" };
  const antes = [VERMELHO, imagem];

  // "+ Camada" durante o envio: a imagem passou a ser a terceira, e o arquivo vai para ela (pelo índice da hora do
  // envio iria para a Cor).
  const deslocada = panel.addFreeFillLayer(antes, VERDE_FUNDO);
  assert.deepEqual(panel.withFreeFillLayerAsset(deslocada, imagem, "img2"), [VERDE_FUNDO, VERMELHO, { asset: "img2", kind: "image" }]);
  // Desfazer um arrastar feito antes do envio: a lista velha tem a mesma camada.
  assert.deepEqual(panel.withFreeFillLayerAsset([imagem, VERMELHO], imagem, "img2"), [{ asset: "img2", kind: "image" }, VERMELHO]);
  // Tirada (ou trocada) durante o envio: nada muda.
  assert.deepEqual(panel.withFreeFillLayerAsset([VERMELHO], imagem, "img2"), [VERMELHO]);
  assert.deepEqual(panel.withFreeFillLayerAsset([VERMELHO, { ...imagem }], imagem, "img2"), [VERMELHO, { ...imagem }]);

  // Pelo design inteiro (o caminho do envio): o arquivo novo entra na camada certa e o design vale. A camada que pediu é
  // a do design desenhado (a mesma referência que o design mais novo guarda).
  const start = design([{ box: { fill: deslocada }, id: "forma", type: "shape" }, LINKS], {
    assets: [{ height: 10, id: "img", kind: "image", path: "communications/free/ffffffffffffffffffffffff.webp", width: 10 }]
  });
  const pediu = model.findFreeNode(start, "forma").node.box.fill[2];
  const placed = panel.withFreeFillImage(start, "forma", { height: 100, path: PATH, width: 100 }, (assetId, current) => panel.withFreeFillLayerAsset(current, pediu, assetId));
  const fill = model.findFreeNode(placed, "forma").node.box.fill;
  assert.deepEqual(fill.slice(0, 2), [VERDE_FUNDO, VERMELHO]);
  assert.equal(fill[2].kind, "image");
  assert.equal(placed.assets.find((asset) => asset.id === fill[2].asset)?.path, PATH);
  assert.equal(placed.assets.length, 1, "o arquivo antigo, sem uso, sai");
  assert.ok(schema.parsePopupFreeDesign(placed));

  // Na tela: enquanto uma imagem desta lista sobe, a faixa, Subir, Descer, Tirar, "+ Camada" e o tipo da camada nova
  // ficam desligados; o cartão que espera a imagem também (Tipo, Como preenche e ponto de foco).
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-fields.tsx", import.meta.url), "utf8");
  assert.match(source, /const off = Boolean\(disabled\) \|\| busy;/);
  assert.equal((source.match(/disabled=\{off \|\| full\}/g) ?? []).length, 2, "+ Camada e o tipo da camada nova");
  assert.match(source, /disabled=\{off\}\n\s+id=\{`\$\{id\}-\$\{index\}-ordem`\}/);
  assert.match(source, /const cardOff = Boolean\(disabled\) \|\| sending === paint;/);
  assert.equal((source.match(/disabled=\{cardOff\}/g) ?? []).length, 3, "Tipo, Como preenche e ponto de foco");
  assert.ok(source.includes("onPick={(image) => onImageLayer((assetId, current) => withFreeFillLayerAsset(current, paint, assetId), image)}"));
});

test("camadas de fundo: a imagem que termina de subir depois de a camada sumir (Ctrl + Z no envio) não grava passo e o Refazer fica", () => {
  const PATH = "communications/free/eeeeeeeeeeeeeeeeeeeeeeee.webp";
  const ENVIADA = { height: 100, path: PATH, width: 100 };
  const IMG = { height: 100, id: "img", kind: "image", path: "communications/free/ffffffffffffffffffffffff.webp", width: 100 };
  const imagem = { asset: "img", kind: "image" };

  // Sem a camada (ou com o mesmo arquivo), a própria lista volta, sem cópia.
  const sem = [VERMELHO];
  assert.equal(panel.withFreeFillLayerAsset(sem, imagem, "img2"), sem);
  const com = [imagem, VERMELHO];
  assert.equal(panel.withFreeFillLayerAsset(com, imagem, "img"), com);

  // Um passo põe a camada de imagem na Forma; o envio de um arquivo novo começa para ela e um Ctrl + Z no meio a tira.
  // O arquivo de antes fica em uso no Fundo (a forma canônica tira o que ninguém usa).
  const FUNDO = { box: { fill: [imagem] }, id: "fundo", type: "shape" };
  const base = design([FUNDO, { box: { fill: [VERMELHO] }, id: "forma", type: "shape" }, LINKS], { assets: [IMG] });
  assert.equal(base.assets.length, 1);
  const withImage = panel.withFreeBox(base, "forma", { fill: [imagem, VERMELHO] });
  const pediu = model.findFreeNode(withImage, "forma").node.box.fill[0];
  let h = history.pushFreeHistory(history.createFreeHistory({ cta: null, design: base }), { cta: null, design: withImage }, { now: 1_000 });
  h = history.undoFreeHistory(h);
  assert.deepEqual([h.past.length, h.future.length], [0, 1]);

  // O envio termina pelo caminho do onPick: o design volta o mesmo (nem o arquivo entra) e o histórico não muda.
  const latest = h.present.design;
  const next = panel.withFreeFillImage(latest, "forma", ENVIADA, (assetId, current) => panel.withFreeFillLayerAsset(current, pediu, assetId));
  assert.equal(next, latest);
  const after = history.pushFreeHistory(h, { cta: null, design: next }, { now: 5_000 });
  assert.equal(after, h);
  assert.deepEqual([after.past.length, after.future.length], [0, 1], "o Refazer do passo desfeito continua");
  assert.equal(history.redoFreeHistory(after).present.design, withImage);

  // Na prancheta, o mesmo: sem a camada, o design volta o mesmo (com e sem fundo próprio).
  const boardImage = panel.withFreeArtboard(base, { fill: [imagem, VERMELHO] });
  const pediuNaPrancheta = boardImage.artboard.fill[0];
  assert.equal(panel.withFreeFillImage(base, null, ENVIADA, (assetId, current) => panel.withFreeFillLayerAsset(current, pediuNaPrancheta, assetId)), base);
  const semFundo = design([FUNDO, LINKS], { assets: [IMG] });
  assert.equal(semFundo.artboard?.fill, undefined);
  assert.equal(panel.withFreeFillImage(semFundo, null, ENVIADA, (assetId, current) => panel.withFreeFillLayerAsset(current, pediuNaPrancheta, assetId)), semFundo);

  // "+ Camada" de imagem que chega com a lista já cheia (um Refazer no meio do envio): nada muda.
  const cheia = design([FUNDO, { box: { fill: [VERMELHO, VERDE_FUNDO, AZUL] }, id: "forma", type: "shape" }, LINKS], { assets: [IMG] });
  assert.equal(panel.withFreeFillImage(cheia, "forma", ENVIADA, (assetId, current) => panel.addFreeFillLayer(current, { asset: assetId, kind: "image" })), cheia);

  // Com a camada no lugar, o arquivo novo entra nela (um passo, como antes).
  const placed = panel.withFreeFillImage(withImage, "forma", ENVIADA, (assetId, current) => panel.withFreeFillLayerAsset(current, pediu, assetId));
  assert.notEqual(placed, withImage);
  assert.equal(placed.assets.find((asset) => asset.id === model.findFreeNode(placed, "forma").node.box.fill[0].asset)?.path, PATH);
  assert.equal(placed.assets.length, 2);
  assert.ok(schema.parsePopupFreeDesign(placed));
});

test("camadas de fundo: mudar a ordem é um passo próprio, montado pelo design mais novo; a cor continua juntando", () => {
  const base = design([TITULO_FUNDO, { ...SELO_COM_FUNDO, place: { mode: "free", w: 116, x: 300, y: 16 } }, LINKS], {
    devices: { mobile: { nodes: { selo: { place: { mode: "free", x: 120, y: 30 } } } } }
  });
  const entry = (value) => ({ cta: null, design: value });

  // A cor (chave "selo:box.fill") e, 300 ms depois, a ordem sem chave: dois passos; desfazer volta só a ordem.
  const colored = panel.withFreeBox(base, "selo", { fill: [LARANJA, VERDE_FUNDO, AZUL] });
  const reordered = panel.withFreeBox(colored, "selo", { fill: panel.moveFreeFillLayerTo([LARANJA, VERDE_FUNDO, AZUL], 2, 0) });
  let steps = history.pushFreeHistory(history.createFreeHistory(entry(base)), entry(colored), { coalesceKey: "selo:box.fill", now: 1_000 });
  steps = history.pushFreeHistory(steps, entry(reordered), { now: 1_300 });
  assert.equal(steps.past.length, 2);
  const undone = history.undoFreeHistory(steps);
  assert.equal(undone.present.design, colored, "desfazer volta só a ordem; a cor nova fica");
  assert.equal(history.undoFreeHistory(undone).present.design, base);
  // Com a chave de antes, a ordem juntava com a cor num passo só.
  const merged = history.pushFreeHistory(
    history.pushFreeHistory(history.createFreeHistory(entry(base)), entry(colored), { coalesceKey: "selo:box.fill", now: 1_000 }),
    entry(reordered),
    { coalesceKey: "selo:box.fill", now: 1_300 }
  );
  assert.equal(merged.past.length, 1);

  // A ordem é uma só: o celular não muda e desenha a mesma ordem.
  assert.deepEqual(reordered.devices, base.devices);
  assert.deepEqual(model.findFreeNode(render.resolveFreeForDevice(reordered, "mobile"), "selo").node.box.fill, [AZUL, LARANJA, VERDE_FUNDO]);

  // O Estilo: a ordem (step) vai sem chave e montada pelo design mais novo (latest): uma mudança em outro elemento
  // durante o arrastar continua lá. A cor vai com a chave e pelo design desenhado.
  const forma = { box: { fill: TRES }, id: "forma", place: { h: 100, mode: "free", w: 100, x: 40, y: 40 }, type: "shape" };
  const drawn = design([TITULO_FUNDO, forma, LINKS]);
  const newer = panel.withFreeTextStyle(drawn, "titulo", { size: 44 });
  const calls = [];
  const props = {
    design: drawn,
    disabled: false,
    errors: {},
    fonts: [],
    hints: [],
    latest: () => newer,
    node: model.findFreeNode(drawn, "forma").node,
    onBusyChange() {},
    onChange: (next, field) => calls.push({ field, next }),
    onCtaChange() {},
    onFontsChange() {},
    rects: {}
  };
  const field = fillFieldOf(FreeInspectorStyle(props));
  assert.ok(field, "o Estilo tem o campo do Fundo");
  assert.equal(field.props.id, "livre-forma-fundo");

  field.props.onChange(panel.moveFreeFillLayerTo(TRES, 2, 0), { step: true });
  assert.equal(calls[0].field, undefined, "sem chave: um passo próprio");
  assert.equal(model.findFreeNode(calls[0].next, "titulo").node.textStyle.size, 44, "a mudança do outro elemento continua lá");
  assert.deepEqual(model.findFreeNode(calls[0].next, "forma").node.box.fill, [AZUL, VERMELHO, VERDE_FUNDO]);

  field.props.onChange([LARANJA, VERDE_FUNDO, AZUL]);
  assert.equal(calls[1].field, "box.fill", "a cor junta pela chave do campo");
  assert.equal(model.findFreeNode(calls[1].next, "titulo").node.textStyle.size, 40);

  // A prancheta faz o mesmo (conferido no fonte: o componente usa estado).
  const artboard = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-artboard-settings.tsx", import.meta.url), "utf8");
  assert.match(artboard, /onChange\(withFreeArtboard\(options\?\.step \? latest\(\) : design, \{ fill:/);
  assert.match(artboard, /options\?\.step \? undefined : "artboard\.fill"\)/);
  const style = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-inspector-style.tsx", import.meta.url), "utf8");
  assert.match(style, /options\?\.step \? onChange\(withFreeBox\(latest\(\), node\.id, \{ fill \}\)\) : set\(\{ fill \}, "fill"\)/);
  // O campo manda { step: true } só nas mudanças estruturais; a cor, o tipo e os números vão sem.
  const fields = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-fields.tsx", import.meta.url), "utf8");
  assert.equal((fields.match(/commit\(next, \{ step: true \}\)/g) ?? []).length, 1);
  assert.match(fields, /function commitStep\([^)]*\) \{\n\s+commit\(next, \{ step: true \}\);/);
  assert.match(fields, /function update\(index: number, paint: FreeFillPaint\) \{\n\s+commit\(fill\.map\(\(layer, position\) => \(position === index \? paint : layer\)\)\);/);
});

/** O FreeFillLayersField do Estilo (BoxSections nao usa ganchos: e desenhado aqui na mao). */
function fillFieldOf(element) {
  if (!element || typeof element !== "object") {
    return null;
  }

  if (Array.isArray(element)) {
    for (const child of element) {
      const found = fillFieldOf(child);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof element.type === "function" && element.type.name === "FreeFillLayersField") {
    return element;
  }

  if (typeof element.type === "function" && element.type.name === "BoxSections") {
    return fillFieldOf(element.type(element.props));
  }

  return fillFieldOf(element.props?.children);
}

test("lados: todos iguais e cada lado", () => {
  assert.deepEqual(panel.freeSidesFour(undefined), [0, 0, 0, 0]);
  assert.deepEqual(panel.freeSidesFour(12), [12, 12, 12, 12]);
  assert.deepEqual(panel.freeSidesFour([4, 10]), [4, 10, 4, 10]);
  assert.deepEqual(panel.freeSidesFour([1, 2, 3, 4]), [1, 2, 3, 4]);

  // A forma mais curta: todos iguais = um número; [v, h, v, h] = [v, h].
  assert.equal(panel.freeSidesFromFour([8, 8, 8, 8]), 8);
  assert.deepEqual(panel.freeSidesFromFour([4, 10, 4, 10]), [4, 10]);
  assert.deepEqual(panel.freeSidesFromFour([168, 24, 20, 24]), [168, 24, 20, 24]);

  // Mudar um lado só.
  assert.deepEqual(panel.setFreeSide(24, 0, 168), [168, 24, 24, 24]);
  assert.deepEqual(panel.setFreeSide([168, 24, 24, 24], 0, 24), 24);
  assert.deepEqual(panel.setFreeSide([4, 10], 1, 12), [4, 12, 4, 10]);
  assert.equal(panel.freeSidesUniform(16), true);
  assert.equal(panel.freeSidesUniform([4, 10]), false);

  // Cantos: todos iguais ou cada canto.
  assert.deepEqual(panel.freeRadiusFour(999), [999, 999, 999, 999]);
  assert.equal(panel.freeRadiusFromFour([10, 10, 10, 10]), 10);
  assert.deepEqual(panel.freeRadiusFromFour([10, 10, 0, 0]), [10, 10, 0, 0]);
  assert.deepEqual(C.advanced.sides, ["Em cima", "Direita", "Embaixo", "Esquerda"]);
});

test("sombra: atalhos Brilho e Borda de baixo", () => {
  // Brilho: sem deslocamento, na cor do fundo com 25 %.
  assert.deepEqual(panel.freeGlowShadow("#e0007a"), { blur: 24, color: "#e0007a40", spread: 0, x: 0, y: 0 });
  assert.deepEqual(panel.freeGlowShadow("#e0007acc").color, "#e0007a40");
  assert.equal(panel.freeGlowShadow(null).color, "#ffffff40");

  // Borda de baixo: sólida de 3 px, mais escura que o fundo.
  const edge = panel.freeBottomEdgeShadow("#d9f500");
  assert.deepEqual(edge, { blur: 0, color: "#9cb000", spread: 0, x: 0, y: 3 });

  // Até 2 sombras.
  const one = panel.addFreeShadow(undefined, edge);
  const two = panel.addFreeShadow(one, panel.freeGlowShadow("#d9f500"));
  assert.equal(two.length, 2);
  assert.equal(panel.addFreeShadow(two, panel.newFreeShadow()).length, 2);

  // Os atalhos valem no schema (cores e limites).
  const value = design([{ action: { kind: "close" }, box: { shadows: two }, id: "botao", label: "Agora não", type: "button" }, LINKS]);
  assert.ok(schema.parsePopupFreeDesign(value));

  // Sombra da prancheta: Sem, Suave, Forte e Personalizada.
  assert.equal(panel.freeArtboardShadowChoice(undefined), "none");
  assert.equal(panel.freeArtboardShadowChoice(panel.FREE_ARTBOARD_SHADOW_PRESETS.strong), "strong");
  assert.equal(panel.freeArtboardShadowChoice([{ blur: 80, color: "#000000B3", spread: 0, x: 0, y: 24 }]), "strong");
  assert.equal(panel.freeArtboardShadowChoice([edge]), "custom");

  // Esmaecer: o fim fica sempre pelo menos 5 % depois do começo.
  assert.deepEqual(panel.withFreeFadeStart({ end: 60, side: "bottom", start: 40 }, 58), { end: 63, side: "bottom", start: 58 });
  assert.deepEqual(panel.withFreeFadeEnd({ end: 100, side: "top", start: 40 }, 42), { end: 42, side: "top", start: 37 });
  assert.deepEqual(panel.withFreeFadeStart(panel.FREE_FADE_DEFAULT, 100), { end: 100, side: "bottom", start: 95 });
});

/* ------------------------------------------------------------------------------------------------
 * Mapa chave -> aba e campo
 * ---------------------------------------------------------------------------------------------- */

test("chave de erro leva à aba e ao campo, e o pedido de envio põe o foco em Enviar imagem", () => {
  const value = design(
    [
      { asset: "video", id: "midia", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, type: "video" },
      {
        children: [{ alt: "", asset: "img1", id: "img2", type: "image" }],
        id: "caixa",
        layout: { dir: "row" },
        type: "box"
      },
      { id: "titulo", lines: [[{ text: "Aula" }]], textStyle: { size: 40 }, type: "heading" },
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { action: { href: "https://exemplo.com", kind: "link", target: "new_tab" }, id: "link", label: "Ver", type: "button" },
      { box: { fill: [{ asset: "fundo", kind: "image" }] }, id: "forma", type: "shape" },
      { id: "audio", type: "audio" },
      LINKS
    ],
    {
      assets: [
        { height: 100, id: "img1", kind: "image", path: "communications/free/aaaaaaaaaaaaaaaaaaaaaaaa.webp", width: 100 },
        { height: 100, id: "fundo", kind: "image", path: "communications/free/bbbbbbbbbbbbbbbbbbbbbbbb.webp", width: 100 },
        { height: 100, id: "capa", kind: "image", path: "communications/free/cccccccccccccccccccccccc.webp", width: 100 },
        { id: "video", kind: "video", mimeType: "video/mp4", path: "videos/0b7c7f2e-3a0e-4d39-9b39-0f6c0f9b2a11.mp4", poster: "capa" }
      ]
    }
  );
  const target = (key) => panel.freeInspectorTargetOf(value, key);

  // Texto e estilo do texto.
  assert.deepEqual(target("freeDesign.nodes.titulo.lines.0.0.text"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });
  assert.deepEqual(target("nodes.titulo.textStyle.size"), { fieldId: "livre-titulo-tamanho-texto", nodeId: "titulo", tab: "style" });
  assert.deepEqual(target("nodes.titulo.textStyle.paint"), { fieldId: "livre-titulo-cor-texto", nodeId: "titulo", tab: "style" });
  assert.deepEqual(target("nodes.titulo"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });

  // Caixa (fundo, sombras) no Estilo; respiro, posição e margem no Avançado.
  assert.deepEqual(target("nodes.forma.box.fill.0.stops"), { fieldId: "livre-forma-fundo", nodeId: "forma", tab: "style" });
  assert.deepEqual(target("nodes.forma.box.shadows.1.color"), { fieldId: "livre-forma-sombras", nodeId: "forma", tab: "style" });
  assert.deepEqual(target("nodes.forma.box.padding"), { fieldId: "livre-forma-respiro", nodeId: "forma", tab: "advanced" });
  assert.deepEqual(target("nodes.midia.place.x"), { fieldId: "livre-midia-x", nodeId: "midia", tab: "advanced" });
  assert.deepEqual(target("nodes.midia.place.h"), { fieldId: "livre-midia-altura", nodeId: "midia", tab: "advanced" });
  assert.deepEqual(target("nodes.img2.place.margin"), { fieldId: "livre-img2-margem", nodeId: "img2", tab: "advanced" });
  assert.deepEqual(target("nodes.caixa.layout.gap"), { fieldId: "livre-caixa-espaco", nodeId: "caixa", tab: "content" });

  // Botões: o destino do "Abrir um link" e o texto e destino do principal (que mora no cta do aviso).
  assert.deepEqual(target("nodes.link.action.href"), { fieldId: "livre-link-destino", nodeId: "link", tab: "content" });
  assert.deepEqual(target("cta.label"), { fieldId: "livre-botao-botao-texto", nodeId: "botao", tab: "content" });
  assert.deepEqual(target("cta.href"), { fieldId: "livre-botao-botao-destino", nodeId: "botao", tab: "content" });
  assert.deepEqual(target("audio"), { fieldId: "livre-audio-audio", nodeId: "audio", tab: "content" });

  // Arquivos: a imagem do elemento, a capa do vídeo, a imagem do fundo de uma forma.
  assert.deepEqual(target("freeDesign.assets.img1"), { fieldId: "livre-img2-enviar", nodeId: "img2", tab: "content" });
  assert.deepEqual(target("assets.capa"), { fieldId: "livre-midia-capa", nodeId: "midia", tab: "content" });
  assert.deepEqual(target("assets.fundo"), { fieldId: "livre-forma-fundo", nodeId: "forma", tab: "style" });

  // Prancheta, X e fontes: a aba Pop-up (sem elemento).
  assert.deepEqual(target("freeDesign.artboard.padding"), { fieldId: "livre-popup-respiro", nodeId: null, tab: "popup" });
  assert.deepEqual(target("close.color"), { fieldId: "livre-popup-x-cor", nodeId: null, tab: "popup" });
  assert.deepEqual(target("fonts"), { fieldId: "livre-popup-fontes", nodeId: null, tab: "popup" });

  // O que não tem campo: o design inteiro, o tamanho, um elemento que já saiu.
  assert.equal(target("freeDesign"), null);
  assert.equal(target("size"), null);
  assert.equal(target("nodes.sumiu.lines"), null);

  // O pedido de envio (Imagem ou Vídeo recém-adicionados): o botão Enviar imagem/vídeo do elemento.
  assert.deepEqual(panel.freeFocusTargetOf(value, { intent: "upload", key: "nodes.img2.asset" }), { fieldId: "livre-img2-enviar", nodeId: "img2", tab: "content" });
  assert.deepEqual(panel.freeFocusTargetOf(value, { intent: "upload", key: "nodes.midia" }), { fieldId: "livre-midia-enviar", nodeId: "midia", tab: "content" });
  assert.deepEqual(panel.freeFocusTargetOf(value, { key: "nodes.titulo" }), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });
  assert.equal(panel.freeFirstContentField({ id: "x", label: "Novo", type: "badge" }), "selo-texto");

  // A aba fica ao trocar de elemento do mesmo tipo; outro tipo volta para Conteúdo.
  assert.equal(panel.freeTabAfterSelection("style", "heading", "heading"), "style");
  assert.equal(panel.freeTabAfterSelection("style", "heading", "button"), "content");
  assert.equal(panel.freeTabAfterSelection("advanced", null, "heading"), "content");
});

test("Abrir um link nunca desliga: com outro botão já em link, a pílula do Fechar continua ligada (L4b, até 3)", () => {
  const value = design([
    { action: { kind: "cta" }, id: "principal", type: "button" },
    { action: { href: "https://exemplo.com", kind: "link", target: "new_tab" }, id: "link", label: "Ver", type: "button" },
    { action: { href: "/minhas-compras", kind: "link", target: "same_tab" }, id: "link2", label: "Compras", type: "button" },
    { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" },
    LINKS
  ]);

  // O limite de um link so saiu do painel e do schema.
  assert.equal("freeLinkActionDisabledReason" in panel, false);
  assert.equal("linkButtons" in M, false);

  // O Conteudo do Fechar desenhado de verdade: as 3 opcoes ligadas, sem o motivo embaixo.
  const content = { allowSnooze: true, allowSnoozeEditable: true, audio: null, cta: null, onAllowSnoozeChange() {}, onCtaChange() {}, products: [], productsLoaded: true, snoozeMinutes: 1_440, title: "Aula nova" };
  const html = renderToStaticMarkup(
    createElement(FreeInspectorContent, {
      content,
      design: value,
      disabled: false,
      errors: {},
      fonts: [],
      hints: [],
      latest: () => value,
      node: model.findFreeNode(value, "fechar").node,
      onBusyChange() {},
      onChange() {},
      onCtaChange() {},
      onFontsChange() {},
      rects: {}
    })
  );
  const radios = [...html.matchAll(/<input[^>]*name="livre-fechar-acao"[^>]*>/g)].map(([tag]) => tag);

  assert.equal(radios.length, 3, html);
  assert.ok(radios.some((tag) => tag.includes('value="link"')), "a opcao Abrir um link esta la");
  assert.equal(radios.some((tag) => /\sdisabled=""/.test(tag)), false, "nenhuma opcao desligada");
  assert.doesNotMatch(html, /id="livre-fechar-acao-motivo"/, "sem frase de motivo");
  assert.doesNotMatch(html, /aria-describedby="livre-fechar-acao-motivo"/);
  assert.equal(html.includes("Abrir um link” só"), false);

  // Trocar o que o botão faz: link começa sem destino, na mesma aba; o texto fica.
  const button = { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" };
  assert.deepEqual(panel.freeButtonActionOf("link", button), { action: { href: "", kind: "link", target: "same_tab" }, id: "fechar", label: "Agora não", type: "button" });
  assert.deepEqual(panel.freeButtonActionOf("snooze", button).action, { kind: "snooze" });
  assert.equal(panel.freeButtonActionOf("close", button), button);
  assert.deepEqual(
    panel.FREE_BUTTON_ACTION_OPTIONS.map((option) => option.label),
    ["Fechar", "Lembrar depois", "Abrir um link"]
  );
});

test("trocar a largura com a chave ligada reescala", () => {
  const value = design([
    { id: "midia", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, shape: "rect", type: "shape" },
    { id: "titulo", lines: [[{ text: "Aula" }]], place: { margin: [12, 0, 0, 0], mode: "flow" }, textStyle: { size: 40 }, type: "heading" },
    LINKS
  ], { artboard: { padding: 24 } });

  // Ligada: tudo acompanha na mesma proporção (440 -> 660 = 1,5).
  const scaled = panel.withFreeArtboardWidth(value, 660, true);
  assert.equal(scaled.artboard.width, 660);
  const media = model.findFreeNode(scaled, "midia").node;
  assert.deepEqual(media.place, { h: 372, mode: "free", w: 660, x: 0, y: 0 });
  assert.equal(model.findFreeNode(scaled, "titulo").node.textStyle.size, 60);

  // Desligada: só a largura muda.
  const plain = panel.withFreeArtboardWidth(value, 660, false);
  assert.equal(plain.artboard.width, 660);
  assert.deepEqual(model.findFreeNode(plain, "midia").node.place, { h: 248, mode: "free", w: 440, x: 0, y: 0 });

  // A mesma largura não muda nada; fora de 280 a 720 fica no limite.
  assert.equal(panel.withFreeArtboardWidth(value, 440, true), value);
  assert.equal(panel.withFreeArtboardWidth(value, 9999, false).artboard.width, 720);
  assert.equal(panel.withFreeArtboardWidth(value, 10, false).artboard.width, 280);

  // Atalhos P, M, G, GG.
  assert.equal(panel.freeWidthChoice(360), "P");
  assert.equal(panel.freeWidthChoice(520), "G");
  assert.equal(panel.freeWidthChoice(500), "other");
  assert.equal(panel.freeWidthOfChoice("GG"), 640);
  assert.deepEqual(
    panel.FREE_WIDTH_OPTIONS.map((option) => option.label),
    ["P (360 px)", "M (440 px)", "G (520 px)", "GG (640 px)", "Outra"]
  );
});

test("pesos de cada fonte", () => {
  const values = (font) => panel.freeWeightOptions(font).map((option) => option.value);

  assert.deepEqual(values({ key: "exo2", kind: "builtin" }), ["500", "600", "700"]);
  assert.deepEqual(values({ key: "serif", kind: "builtin" }), ["400", "700"]);
  assert.deepEqual(values({ key: "mono", kind: "builtin" }), ["400", "700"]);
  assert.equal(values({ key: "inter", kind: "builtin" }).length, 9);
  assert.equal(values({ id: "f1", kind: "uploaded" }).length, 9);

  // Trocar de fonte: o peso que existe nela fica; senão o mais perto; a enviada começa no peso dela.
  assert.equal(panel.freeWeightAfterFontChange({ key: "exo2", kind: "builtin" }, 800, []), 700);
  assert.equal(panel.freeWeightAfterFontChange({ key: "serif", kind: "builtin" }, 500, []), 400);
  assert.equal(panel.freeWeightAfterFontChange({ key: "inter", kind: "builtin" }, 300, []), 300);
  assert.equal(panel.freeWeightAfterFontChange({ id: "f1", kind: "uploaded" }, 800, [{ id: "f1", weight: 600 }]), 600);
});

test("imagem: conta de reduzir até 1.600 px e as qualidades até caber", () => {
  // O lado maior vai até 1.600 px, na mesma proporção; nunca aumenta.
  assert.deepEqual(panel.freeImageTargetSize({ height: 1800, width: 3200 }), { height: 900, width: 1600 });
  assert.deepEqual(panel.freeImageTargetSize({ height: 4000, width: 1000 }), { height: 1600, width: 400 });
  assert.deepEqual(panel.freeImageTargetSize({ height: 48, width: 64 }), { height: 48, width: 64 });
  // Um lado final abaixo de 16 px não dá (1.700 × 10 vira 1.600 × 9).
  assert.equal(panel.freeImageTargetSize({ height: 10, width: 1700 }), null);
  assert.equal(panel.freeImageTargetSize({ height: 0, width: 100 }), null);

  // Qualidades nesta ordem.
  assert.deepEqual([...panel.FREE_IMAGE_QUALITIES], [0.86, 0.75, 0.6]);

  // A primeira que coube em 420.000 bytes (e é WebP de verdade).
  const big = `data:image/webp;base64,${"A".repeat(Math.ceil((430_000 * 4) / 3))}`;
  const fits = `data:image/webp;base64,${"A".repeat(Math.ceil((400_000 * 4) / 3))}`;
  const png = `data:image/png;base64,${"A".repeat(100)}`;
  const choice = panel.pickFreeImageEncoding([
    { dataUrl: png, quality: 0.86 },
    { dataUrl: big, quality: 0.75 },
    { dataUrl: fits, quality: 0.6 }
  ]);
  assert.equal(choice.quality, 0.6);
  assert.ok(choice.bytes <= model.FREE_DESIGN_LIMITS.imageBytes);
  assert.equal(panel.pickFreeImageEncoding([{ dataUrl: big, quality: 0.6 }]), null);
  assert.equal(panel.freeDataUrlBytes("data:image/webp;base64,QUJD"), 3);
  assert.equal(panel.freeDataUrlBytes("data:image/webp;base64,QUI="), 2);

  // Formato e tamanho do arquivo de origem.
  assert.equal(panel.freeImageFileProblem({ size: 1000, type: "image/gif" }), "Envie uma imagem JPG, PNG ou WebP.");
  assert.equal(panel.freeImageFileProblem({ size: 30 * 1024 * 1024, type: "image/png" }), "A imagem passa de 20 MB. Use uma menor.");
  assert.equal(panel.freeImageFileProblem({ size: 1000, type: "image/png" }), null);
});

/* ------------------------------------------------------------------------------------------------
 * Contorno e marca-texto (L6b): a chave Contorno, o "Só o contorno" e o Outro estilo na seleção
 * ---------------------------------------------------------------------------------------------- */

const CONTORNO_PRETO = { color: "#000000", width: 2 };
const CONTORNO_BRANCO = { color: "#ffffff", width: 2 };

/** Um elemento do Estilo pelo id (TextStyleSection, BoxSections, HoverSection e HoverReset nao usam ganchos: sao abertos aqui na mao). */
function elementById(element, id) {
  if (!element || typeof element !== "object") {
    return null;
  }

  if (Array.isArray(element)) {
    for (const child of element) {
      const found = elementById(child, id);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (element.props?.id === id) {
    return element;
  }

  if (typeof element.type === "function" && ["TextStyleSection", "BoxSections", "HoverSection", "HoverReset"].includes(element.type.name)) {
    return elementById(element.type(element.props), id);
  }

  return elementById(element.props?.children, id);
}

function styleProps(value, id, calls = []) {
  return {
    design: value,
    disabled: false,
    errors: {},
    fonts: [],
    hints: [],
    latest: () => value,
    node: model.findFreeNode(value, id).node,
    onBusyChange() {},
    onChange: (next, field) => calls.push({ field, next }),
    onCtaChange() {},
    onFontsChange() {},
    rects: {}
  };
}

test("L6b: a chave Contorno liga o preto de 2 px e desliga num passo; desligar a letra vazada devolve a cor dela", () => {
  assert.deepEqual(panel.FREE_STROKE_DEFAULT, CONTORNO_PRETO);
  assert.deepEqual(panel.freeStrokeSwitchPatch(HEADING_BASE, true), { stroke: CONTORNO_PRETO });
  assert.deepEqual(panel.freeStrokeSwitchPatch({ ...HEADING_BASE, stroke: CONTORNO_BRANCO }, false), { stroke: undefined });
  // A letra vazada sem contorno sumiria: desligar o Contorno devolve a mesma cor sem transparência.
  const vazado = { ...HEADING_BASE, paint: { color: "#e5ff1f00", kind: "solid" }, stroke: CONTORNO_BRANCO };
  assert.equal(panel.freeIsOutlineOnly(vazado), true);
  assert.deepEqual(panel.freeStrokeSwitchPatch(vazado, false), { paint: { color: "#e5ff1f", kind: "solid" }, stroke: undefined });

  // No painel: a chave manda o design novo sem chave de campo (um passo); a espessura e a cor juntam pela chave do campo.
  const start = design([TITULO, LINKS]);
  const calls = [];
  const tree = FreeInspectorStyle(styleProps(start, "titulo", calls));
  elementById(tree, "livre-titulo-contorno-ligado").props.onCheckedChange(true);
  assert.equal(calls[0].field, undefined, "ligar: um passo próprio");
  assert.deepEqual(model.findFreeNode(calls[0].next, "titulo").node.textStyle, { size: 40, stroke: CONTORNO_PRETO });

  const on = calls[0].next;
  const onTree = FreeInspectorStyle(styleProps(on, "titulo", calls));
  elementById(onTree, "livre-titulo-contorno-espessura").props.onChange(4);
  elementById(onTree, "livre-titulo-contorno-cor").props.onChange("#e50914");
  assert.deepEqual([calls[1].field, calls[2].field], ["textStyle.stroke", "textStyle.stroke"]);
  assert.deepEqual(model.findFreeNode(calls[1].next, "titulo").node.textStyle.stroke, { color: "#000000", width: 4 });
  assert.deepEqual(model.findFreeNode(calls[2].next, "titulo").node.textStyle.stroke, { color: "#e50914", width: 2 });
  elementById(onTree, "livre-titulo-contorno-ligado").props.onCheckedChange(false);
  assert.equal(calls[3].field, undefined, "desligar: um passo próprio");
  assert.deepEqual(model.findFreeNode(calls[3].next, "titulo").node.textStyle, { size: 40 });

  // Ligar e desligar são dois passos (Ctrl + Z volta um de cada vez); a espessura seguida vira um passo só.
  const entry = (value) => ({ cta: null, design: value });
  let steps = history.pushFreeHistory(history.createFreeHistory(entry(start)), entry(on), { coalesceKey: null, now: 1_000 });
  steps = history.pushFreeHistory(steps, entry(calls[1].next), { coalesceKey: "titulo:textStyle.stroke", now: 1_100 });
  steps = history.pushFreeHistory(steps, entry(panel.withFreeTextStyle(calls[1].next, "titulo", { stroke: { color: "#000000", width: 5 } })), { coalesceKey: "titulo:textStyle.stroke", now: 1_300 });
  steps = history.pushFreeHistory(steps, entry(calls[3].next), { coalesceKey: null, now: 1_400 });
  assert.equal(steps.past.length, 3);
  assert.equal(model.findFreeNode(history.undoFreeHistory(steps).present.design, "titulo").node.textStyle.stroke.width, 5);
  assert.equal(history.undoFreeHistory(history.undoFreeHistory(history.undoFreeHistory(steps))).present.design, start);
});

test("L6b: Só o contorno (texto vazado) só no Título e no Texto; ligar e desligar é um passo", () => {
  // Ligado: a cor de agora com alfa 00 e o contorno na cor da letra (2 px, o que o Revisar conta).
  assert.deepEqual(panel.freeOutlineOnlyPatch(HEADING_BASE, true), { paint: { color: "#ffffff00", kind: "solid" }, stroke: CONTORNO_BRANCO });
  // Com degradê, a primeira cor; com contorno, o dele, com pelo menos 2 px.
  const degrade = { kind: "linear", stops: [{ at: 0, color: "#E5FF1F" }, { at: 100, color: "#ff3d9a" }] };
  assert.deepEqual(panel.freeOutlineOnlyPatch({ paint: degrade }, true), { paint: { color: "#e5ff1f00", kind: "solid" }, stroke: { color: "#e5ff1f", width: 2 } });
  assert.deepEqual(panel.freeOutlineOnlyPatch({ paint: VERDE, stroke: { color: "#111111", width: 1 } }, true).stroke, { color: "#111111", width: 2 });
  assert.deepEqual(panel.freeOutlineOnlyPatch({ paint: VERDE, stroke: { color: "#111111", width: 6 } }, true).stroke, { color: "#111111", width: 6 });
  // Desligado: a mesma cor sem transparência; o contorno continua.
  assert.deepEqual(panel.freeOutlineOnlyPatch({ paint: { color: "#ffffff00", kind: "solid" }, stroke: CONTORNO_BRANCO }, false), { paint: { color: "#ffffff", kind: "solid" } });
  assert.equal(panel.freeIsOutlineOnly({ paint: { color: "#ffffff00", kind: "solid" } }), false, "sem contorno não é vazado");
  assert.equal(panel.freeIsOutlineOnly({ paint: { color: "#ffffff80", kind: "solid" }, stroke: CONTORNO_BRANCO }), false);

  const start = design([TITULO, { action: { kind: "close" }, icon: { name: "arrow-right" }, id: "fechar", label: "Agora não", type: "button" }, { icon: "sparkles", id: "selo", label: "Novidade", type: "badge" }, LINKS]);
  const calls = [];
  const button = elementById(FreeInspectorStyle(styleProps(start, "titulo", calls)), "livre-titulo-so-contorno");
  assert.equal(button.props["aria-pressed"], false);
  button.props.onClick();
  assert.equal(calls[0].field, undefined, "um passo próprio");
  const vazado = calls[0].next;
  assert.deepEqual(model.findFreeNode(vazado, "titulo").node.textStyle, { paint: { color: "#ffffff00", kind: "solid" }, size: 40, stroke: CONTORNO_BRANCO });
  assert.ok(schema.parsePopupFreeDesign(vazado), "o vazado vale no schema");

  const pressed = elementById(FreeInspectorStyle(styleProps(vazado, "titulo", calls)), "livre-titulo-so-contorno");
  assert.equal(pressed.props["aria-pressed"], true);
  pressed.props.onClick();
  assert.equal(calls[1].field, undefined);
  assert.deepEqual(
    model.findFreeNode(model.canonicalPopupFreeDesign(calls[1].next), "titulo").node.textStyle,
    { size: 40, stroke: CONTORNO_BRANCO },
    "a letra volta ao branco (o padrão sai na forma canônica)"
  );

  // Selo, Botão e Links: a chave Contorno, sem o atalho (o ícone usa a cor da letra e sumiria; os Links o aluno lê).
  for (const id of ["fechar", "selo", "links"]) {
    const tree = FreeInspectorStyle(styleProps(start, id));
    assert.ok(elementById(tree, `livre-${id}-contorno-ligado`), id);
    assert.equal(elementById(tree, `livre-${id}-so-contorno`), null, id);
  }

  // Desenhado: a chave, os campos com o contorno ligado e o atalho com aria-pressed.
  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, styleProps(vazado, "titulo")));
  assert.match(html, /id="livre-titulo-contorno"/);
  assert.ok(html.includes(">Contorno<"));
  assert.ok(html.includes(">Espessura<"));
  assert.ok(html.includes(">Cor do contorno<"));
  // Apertado: aria-pressed e a marca de ligado (o ícone, fora do leitor de tela).
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*id="livre-titulo-so-contorno"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Só o contorno \(texto vazado\)<\/button>/);
  assert.match(html, /id="livre-titulo-contorno-espessura"/);
  const off = renderToStaticMarkup(createElement(FreeInspectorStyle, styleProps(start, "titulo")));
  assert.equal(off.includes("livre-titulo-contorno-espessura"), false, "desligado, sem os campos");
  assert.equal(renderToStaticMarkup(createElement(FreeInspectorStyle, styleProps(start, "selo"))).includes("Só o contorno"), false);
});

test("L6b: Outro estilo na seleção com contorno e marca-texto: a parte guarda o que muda, as fichas dizem o quê", () => {
  const lines = [[{ text: "Semana de " }, { text: "revisão" }]];
  const range = { end: 17, line: 0, start: 10 };

  // Contorno na parte (o elemento sem contorno): fica; desligar volta ao elemento.
  const stroked = panel.applyFreeSpanStyle(lines, [range], panel.freeStrokeSwitchPatch(HEADING_BASE, true), HEADING_BASE);
  assert.deepEqual(stroked, [[{ text: "Semana de " }, { style: { stroke: CONTORNO_PRETO }, text: "revisão" }]]);
  assert.deepEqual(panel.applyFreeSpanStyle(stroked, [range], { stroke: undefined }, HEADING_BASE), [[{ text: "Semana de revisão" }]]);
  // Com o mesmo contorno do elemento, a parte não guarda nada (a forma canônica faz o mesmo); outro contorno troca.
  const comContorno = { ...HEADING_BASE, stroke: CONTORNO_PRETO };
  assert.deepEqual(panel.applyFreeSpanStyle(lines, [range], { stroke: { color: "#000000", width: 2 } }, comContorno), [[{ text: "Semana de revisão" }]]);
  assert.deepEqual(panel.applyFreeSpanStyle(lines, [range], { stroke: { color: "#ffffff", width: 3 } }, comContorno)[0][1].style, { stroke: { color: "#ffffff", width: 3 } });
  assert.equal(panel.effectiveFreeSpanStyle({ stroke: { color: "#FFFFFF", width: 2 } }, { ...HEADING_BASE, stroke: CONTORNO_BRANCO }), undefined, "maiúsculas e minúsculas na cor são a mesma");
  // O popover mostra o contorno do elemento na parte (a chave fica ligada e presa, com a frase).
  assert.deepEqual(panel.freeRangeStyle(lines, range, comContorno).stroke, CONTORNO_PRETO);

  // Marca-texto: a cor de partida e os padrões fora do design; vizinhas com o mesmo marca-texto juntam.
  assert.equal(panel.FREE_MARK_DEFAULT_COLOR, "#e50914");
  const marked = panel.applyFreeSpanStyle(lines, [range], { mark: { color: panel.FREE_MARK_DEFAULT_COLOR } }, HEADING_BASE);
  assert.deepEqual(marked[0][1], { style: { mark: { color: "#e50914" } }, text: "revisão" });
  assert.deepEqual(panel.freeRangeStyle(marked, range, HEADING_BASE).mark, { color: "#e50914" });
  const both = panel.applyFreeSpanStyle(marked, [{ end: 10, line: 0, start: 7 }], { mark: { color: "#e50914" } }, HEADING_BASE);
  assert.deepEqual(both, [[{ text: "Semana " }, { style: { mark: { color: "#e50914" } }, text: "de revisão" }]]);
  // Voltar ao estilo do elemento tira os dois.
  const full = panel.applyFreeSpanStyle(marked, [range], { stroke: CONTORNO_BRANCO }, HEADING_BASE);
  assert.deepEqual(full[0][1].style, { mark: { color: "#e50914" }, stroke: CONTORNO_BRANCO });
  assert.deepEqual(panel.applyFreeSpanStyle(full, [range], null, HEADING_BASE), [[{ text: "Semana de revisão" }]]);

  // As fichas: “contorno” e “marca-texto”.
  assert.equal(panel.describeFreeSpanStyle({ stroke: CONTORNO_PRETO }), "contorno");
  assert.equal(panel.describeFreeSpanStyle({ mark: { color: "#e5ff1f" } }), "marca-texto");
  assert.equal(panel.describeFreeSpanStyle({ mark: { color: "#e5ff1f" }, paint: { color: "#111111", kind: "solid" }, stroke: CONTORNO_BRANCO }), "preto, contorno, marca-texto");
  assert.deepEqual(panel.freeStyledParts(full, HEADING_BASE).map((part) => part.label), ["“revisão” · contorno, marca-texto"]);

  // O que o painel monta já é a forma canônica (nada muda ao salvar).
  const value = design([{ id: "titulo", lines: full, type: "heading" }, LINKS]);
  assert.deepEqual(model.findFreeNode(value, "titulo").node.lines, full);
  assert.ok(schema.parsePopupFreeDesign(value));

  // O painel liga cada chave com um onApply (um passo das partes) e o contorno do elemento prende a chave da parte.
  const fields = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-fields.tsx", import.meta.url), "utf8");
  assert.match(fields, /onCheckedChange=\{\(on\) => onApply\(freeStrokeSwitchPatch\(style, on\)\)\}/);
  assert.match(fields, /disabled=\{disabled \|\| base\.stroke !== undefined \|\| strokeReason !== null\}/);
  assert.match(fields, /onCheckedChange=\{\(on\) => onApply\(\{ mark: on \? \{ color: FREE_MARK_DEFAULT_COLOR \} : undefined \}\)\}/);
  for (const label of ["C.span.stroke", "C.span.strokeWidth", "C.span.strokeColor", "C.span.mark", "C.span.markColor", "C.span.markPaddingY", "C.span.markPaddingX", "C.span.markRadius"]) {
    assert.ok(fields.includes(`label={${label}}`), label);
  }
});

test("L6b: com a letra em degradê, a chave Contorno e o Só o contorno ficam parados, com o motivo; o contorno ligado ainda desliga", () => {
  const degrade = { kind: "linear", stops: [{ at: 0, color: "#ff3b3b" }, { at: 100, color: "#ffd400" }] };
  const circular = { kind: "radial", stops: [{ at: 0, color: "#ff3b3b" }, { at: 100, color: "#ffd400" }], x: 50, y: 50 };

  assert.equal(C.style.strokeGradient, schema.POPUP_FREE_MESSAGES.strokeGradient, "a mesma frase do schema");
  assert.equal(C.style.strokeOnlyGradient, "No degradê, escolha uma cor sólida antes.");

  for (const paint of [degrade, circular]) {
    assert.equal(panel.freeStrokeDisabledReason({ paint }), C.style.strokeGradient);
    assert.equal(panel.freeOutlineOnlyDisabledReason({ paint }), C.style.strokeOnlyGradient);
    // Com o contorno já ligado (um design colado), a chave fica livre para desligar.
    assert.equal(panel.freeStrokeDisabledReason({ paint, stroke: CONTORNO_PRETO }), null);
  }

  assert.equal(panel.freeStrokeDisabledReason({ paint: VERDE }), null);
  assert.equal(panel.freeStrokeDisabledReason({}), null, "sem pintura própria, a cor de partida é sólida");
  assert.equal(panel.freeOutlineOnlyDisabledReason({ paint: VERDE }), null);
  assert.equal(panel.freeOutlineOnlyDisabledReason({ paint: { color: "#ffffff00", kind: "solid" } }), null);

  // No painel: a chave e o botão parados, com o motivo ligado a eles.
  const emDegrade = design([{ ...TITULO, textStyle: { paint: degrade, size: 40 } }, LINKS]);
  const calls = [];
  const tree = FreeInspectorStyle(styleProps(emDegrade, "titulo", calls));
  const chave = elementById(tree, "livre-titulo-contorno-ligado");
  const botao = elementById(tree, "livre-titulo-so-contorno");

  assert.equal(chave.props.disabled, true);
  assert.equal(chave.props.description, C.style.strokeGradient);
  assert.equal(botao.props.disabled, true);
  assert.equal(botao.props["aria-describedby"], "livre-titulo-so-contorno-motivo");
  assert.equal(elementById(tree, "livre-titulo-so-contorno-motivo").props.children, C.style.strokeOnlyGradient);

  // Com cor sólida, os dois ficam livres e sem motivo.
  const solida = FreeInspectorStyle(styleProps(design([TITULO, LINKS]), "titulo"));

  assert.equal(elementById(solida, "livre-titulo-contorno-ligado").props.disabled, false);
  assert.equal(elementById(solida, "livre-titulo-contorno-ligado").props.description, undefined);
  assert.equal(elementById(solida, "livre-titulo-so-contorno").props.disabled, false);
  assert.equal(elementById(solida, "livre-titulo-so-contorno-motivo"), null);

  // O degradê com o contorno já ligado (colado ou pela troca da cor): a chave desliga num passo e o erro do schema
  // aparece no grupo do contorno (o da espessura fica no campo dela, sem repetir).
  const invalido = design([{ ...TITULO, textStyle: { paint: degrade, size: 40, stroke: CONTORNO_PRETO } }, LINKS]);
  const errors = { "nodes.titulo.textStyle.stroke": schema.POPUP_FREE_MESSAGES.strokeGradient };
  const comErro = FreeInspectorStyle({ ...styleProps(invalido, "titulo", calls), errors });

  assert.equal(elementById(comErro, "livre-titulo-contorno-ligado").props.disabled, false);
  assert.equal(elementById(comErro, "livre-titulo-contorno-erro").props.message, schema.POPUP_FREE_MESSAGES.strokeGradient);
  elementById(comErro, "livre-titulo-contorno-ligado").props.onCheckedChange(false);
  assert.equal(calls.at(-1).field, undefined, "um passo próprio");
  assert.deepEqual(model.findFreeNode(calls.at(-1).next, "titulo").node.textStyle, { paint: degrade, size: 40 });
  assert.ok(schema.parsePopupFreeDesign(calls.at(-1).next), "sem o contorno, vale de novo");

  const daEspessura = FreeInspectorStyle({ ...styleProps(invalido, "titulo"), errors: { "nodes.titulo.textStyle.stroke.width": "Use de 1 a 8." } });

  assert.equal(elementById(daEspessura, "livre-titulo-contorno-erro").props.message, undefined);
  assert.equal(elementById(daEspessura, "livre-titulo-contorno-espessura").props.error, "Use de 1 a 8.");

  // Na parte: a chave fica parada com o motivo quando a pintura que vale ali (da parte ou do elemento) é degradê.
  const fields = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-fields.tsx", import.meta.url), "utf8");

  assert.match(fields, /const strokeReason = freeStrokeDisabledReason\(style\);/);
  assert.match(fields, /description=\{base\.stroke \? C\.span\.strokeFromElement : \(strokeReason \?\? undefined\)\}/);
  assert.equal(panel.freeStrokeDisabledReason(panel.freeRangeStyle([[{ text: "Semana" }]], { end: 3, line: 0, start: 0 }, { ...HEADING_BASE, paint: degrade })), C.style.strokeGradient);
  assert.equal(
    panel.freeStrokeDisabledReason(panel.freeRangeStyle([[{ style: { paint: VERDE }, text: "Semana" }]], { end: 3, line: 0, start: 0 }, { ...HEADING_BASE, paint: degrade })),
    null,
    "a parte sólida no elemento em degradê liga o contorno"
  );
});

test("L6b: respiro e cantos do marca-texto: os padrões saem e [n, n] vira n, como na forma canônica", () => {
  const mark = { color: "#e5ff1f" };

  assert.deepEqual(panel.freeMarkPadding(mark), [2, 6]);
  assert.deepEqual(panel.freeMarkPadding({ ...mark, padding: 4 }), [4, 4]);
  assert.deepEqual(panel.freeMarkPadding({ ...mark, padding: [0, 8] }), [0, 8]);
  assert.equal(panel.freeMarkRadius(mark), 4);
  assert.equal(panel.freeMarkRadius({ ...mark, radius: 0 }), 0);

  assert.deepEqual(panel.withFreeMarkPadding(mark, 0, 0), { ...mark, padding: [0, 6] });
  assert.deepEqual(panel.withFreeMarkPadding(mark, 1, 2), { ...mark, padding: 2 }, "[2, 2] vira 2");
  assert.deepEqual(panel.withFreeMarkPadding({ ...mark, padding: [0, 6] }, 0, 2), mark, "de volta ao [2, 6], o respiro sai");
  assert.deepEqual(panel.withFreeMarkRadius(mark, 12), { ...mark, radius: 12 });
  assert.deepEqual(panel.withFreeMarkRadius({ ...mark, radius: 12 }, 4), mark, "de volta ao 4, os cantos saem");

  // O mesmo que a forma canônica guardaria.
  for (const value of [panel.withFreeMarkPadding(mark, 0, 0), panel.withFreeMarkPadding(mark, 1, 2), panel.withFreeMarkRadius(mark, 12)]) {
    const lines = [[{ text: "Oi " }, { style: { mark: value }, text: "você" }]];
    assert.deepEqual(model.findFreeNode(design([{ id: "texto", lines, type: "text" }, LINKS]), "texto").node.lines, lines);
  }
});

test("L6b: as chaves de erro do contorno e do marca-texto levam ao campo certo (crítica C12)", () => {
  const value = design([
    { id: "titulo", lines: [[{ text: "Semana" }], [{ text: "de " }, { style: { mark: { color: "#e5ff1f" } }, text: "revisão" }]], textStyle: { stroke: CONTORNO_BRANCO }, type: "heading" },
    { id: "selo", label: "Novidade", textStyle: { stroke: CONTORNO_PRETO }, type: "badge" },
    LINKS
  ]);
  const target = (key) => panel.freeInspectorTargetOf(value, key);

  // O contorno do elemento: Estilo, no campo (nunca a Fonte).
  assert.deepEqual(target("freeDesign.nodes.titulo.textStyle.stroke.width"), { fieldId: "livre-titulo-contorno-espessura", nodeId: "titulo", tab: "style" });
  assert.deepEqual(target("nodes.titulo.textStyle.stroke.color"), { fieldId: "livre-titulo-contorno-cor", nodeId: "titulo", tab: "style" });
  assert.deepEqual(target("nodes.selo.textStyle.stroke"), { fieldId: "livre-selo-contorno", nodeId: "selo", tab: "style" });
  // O contorno e o marca-texto da parte: a área de texto (onde fica o Outro estilo na seleção).
  assert.deepEqual(target("nodes.titulo.lines.1.1.style.mark.padding"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });
  assert.deepEqual(target("nodes.titulo.lines.1.1.style.stroke.width"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });
  assert.deepEqual(target("nodes.titulo.lines.1.1.style.mark"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });

  // Os campos existem no Estilo com esses ids, e o erro aparece no campo.
  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, { ...styleProps(value, "titulo"), errors: { "freeDesign.nodes.titulo.textStyle.stroke.width": "Use de 1 a 8." } }));
  for (const id of ["livre-titulo-contorno", "livre-titulo-contorno-espessura", "livre-titulo-contorno-cor"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.ok(html.includes("Use de 1 a 8."));
});

/* ------------------------------------------------------------------------------------------------
 * Cores ao passar o mouse (L6c): o "Ao passar o mouse" do Estilo, "Voltar ao padrão" e "Ver com o mouse em cima"
 * ---------------------------------------------------------------------------------------------- */

const VERMELHO_BOTAO = { fill: [{ color: "#e50914", kind: "solid" }], padding: [12, 24], radius: 999 };
const BORDA_BRANCA = { border: { color: "#ffffff40", width: 1 } };
const DEGRADE_LETRA = { kind: "linear", stops: [{ at: 0, color: "#ff3b3b" }, { at: 100, color: "#ffd400" }] };
const ESCURECE_FUNDO = { angle: 90, kind: "linear", stops: [{ at: 0, color: "#e50914" }, { at: 100, color: "#b20710" }] };
/** Um botão Fechar ("Agora não") com `extra` por cima. */
const fecharCom = (extra = {}) => ({ action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button", ...extra });

/** As props do Estilo com a chave "Ver com o mouse em cima" (as mudanças em `calls`, a chave em `previews`). */
function hoverProps(value, id, calls = [], previews = [], extra = {}) {
  return { ...styleProps(value, id, calls), onHoverPreviewChange: (on) => previews.push(on), ...extra };
}

test("L6c: withFreeHover muda as cores do Botão e a dos Links; voltar ao padrão tira a chave e o objeto vazio sai", () => {
  const start = design([fecharCom({ box: { ...VERMELHO_BOTAO, ...BORDA_BRANCA } }), TITULO, LINKS]);

  // Cada cor no Botão, uma de cada vez, juntas no mesmo objeto (o que o painel monta já é a forma canônica).
  let value = panel.withFreeHover(start, "fechar", { fill: ESCURECE_FUNDO });
  value = panel.withFreeHover(value, "fechar", { color: "#111111" });
  value = panel.withFreeHover(value, "fechar", { borderColor: "#ffffff" });
  assert.deepEqual(model.findFreeNode(value, "fechar").node.hover, { borderColor: "#ffffff", color: "#111111", fill: ESCURECE_FUNDO });
  assert.deepEqual(model.canonicalPopupFreeDesign(value), value, "nada muda ao salvar");
  assert.ok(schema.parsePopupFreeDesign(value), "vale no schema");

  // Voltar ao padrão: uma de cada vez; a última leva o objeto junto (sem `hover: {}`).
  const semFundo = panel.withFreeHover(value, "fechar", { fill: undefined });
  assert.deepEqual(model.findFreeNode(semFundo, "fechar").node.hover, { borderColor: "#ffffff", color: "#111111" });
  const vazio = panel.withFreeHover(panel.withFreeHover(semFundo, "fechar", { borderColor: undefined }), "fechar", { color: undefined });
  assert.equal("hover" in model.findFreeNode(vazio, "fechar").node, false);
  assert.deepEqual(vazio, start);

  // Os Links só mudam a cor: o fundo e a borda ao passar o mouse não existem neles (o pedido só deles não muda nada).
  const links = panel.withFreeHover(start, "links", { borderColor: "#ffffff", color: "#e5ff1f", fill: ESCURECE_FUNDO });
  assert.deepEqual(model.findFreeNode(links, "links").node.hover, { color: "#e5ff1f" });
  assert.ok(schema.parsePopupFreeDesign(links));
  assert.equal(panel.withFreeHover(start, "links", { fill: ESCURECE_FUNDO }), start, "só o fundo nos Links: nada muda");

  // Os outros tipos não têm cores ao passar o mouse.
  assert.equal(panel.withFreeHover(start, "titulo", { color: "#111111" }), start);
  assert.equal(panel.isFreeHoverNode(model.findFreeNode(start, "titulo").node), false);
  assert.equal(panel.isFreeHoverNode(model.findFreeNode(start, "links").node), true);
  assert.equal(panel.freeHasHover(model.findFreeNode(start, "fechar").node), false);
  assert.equal(panel.freeHasHover(model.findFreeNode(links, "links").node), true);
  assert.equal(panel.freeHasHover({ ...fecharCom(), hover: {} }), false, "o objeto vazio não conta");
});

test("L6c: cada campo sem escolha mostra a cor de sempre como ponto de partida, sem gravar nada", () => {
  const values = (node) => panel.freeHoverFieldValues(node);

  // O Botão vermelho de borda: o fundo é a camada de cima de cor ou degradê, a letra é a dele, a borda a dela.
  assert.deepEqual(values(fecharCom({ box: { ...VERMELHO_BOTAO, ...BORDA_BRANCA }, textStyle: { paint: { color: "#111111", kind: "solid" } } })), {
    borderColor: "#ffffff40",
    color: "#111111",
    fill: { color: "#e50914", kind: "solid" }
  });
  // Sem fundo nem borda: branco. A letra padrão do Botão é branca.
  assert.deepEqual(values(fecharCom()), { borderColor: "#ffffff", color: "#ffffff", fill: { color: "#ffffff", kind: "solid" } });
  // A imagem no fundo não serve de ponto de partida: vale a primeira camada de cor ou degradê embaixo dela.
  assert.deepEqual(values(fecharCom({ box: { fill: [{ asset: "img", kind: "image" }, { ...ESCURECE_FUNDO }] } })).fill, ESCURECE_FUNDO);
  // O texto vazado (alfa 00) parte da mesma cor sem a transparência; outro alfa fica; o degradê, da primeira cor.
  assert.equal(values(fecharCom({ textStyle: { paint: { color: "#e5ff1f00", kind: "solid" }, stroke: CONTORNO_BRANCO } })).color, "#e5ff1f");
  assert.equal(values(fecharCom({ textStyle: { paint: { color: "#e5ff1f80", kind: "solid" } } })).color, "#e5ff1f80");
  assert.equal(values(fecharCom({ textStyle: { paint: DEGRADE_LETRA } })).color, "#ff3b3b");
  // Com a cor própria, ela.
  assert.deepEqual(values(fecharCom({ hover: { borderColor: "#000000", color: "#222222", fill: ESCURECE_FUNDO } })), { borderColor: "#000000", color: "#222222", fill: ESCURECE_FUNDO });
  assert.equal(values({ hover: { color: "#e5ff1f" }, id: "links", type: "links" }).color, "#e5ff1f");
});

test("L6c: no Estilo do Botão, Fundo, Cor do texto e Cor da borda juntam passos pela chave de cada uma; Voltar ao padrão é um passo próprio", () => {
  const start = design([fecharCom({ box: { ...VERMELHO_BOTAO, ...BORDA_BRANCA } }), LINKS]);
  const calls = [];
  const tree = FreeInspectorStyle(hoverProps(start, "fechar", calls));

  // A seção e os campos, nos ids do mapa de chaves; sem cor própria, nenhum Voltar ao padrão e a frase do brilho.
  for (const field of ["passar-mouse", "passar-mouse-fundo", "passar-mouse-cor", "passar-mouse-borda", "passar-mouse-ver"]) {
    assert.ok(elementById(tree, `livre-fechar-${field}`), field);
  }
  for (const field of ["passar-mouse-fundo", "passar-mouse-cor", "passar-mouse-borda"]) {
    assert.equal(elementById(tree, `livre-fechar-${field}-padrao`), null, `${field}: sem cor própria, sem Voltar ao padrão`);
  }
  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(start, "fechar")));
  assert.ok(html.includes(">Ao passar o mouse<"));
  assert.ok(html.includes(C.hover.note));
  assert.ok(html.includes(C.hover.buttonDefault));
  assert.ok(html.includes(">Cor do texto<") && html.includes(">Cor da borda<") && html.includes(">Fundo<"));
  assert.ok(html.indexOf(">Efeitos<") < html.indexOf(">Ao passar o mouse<"), "a última seção do Estilo");

  // Cada campo grava pela chave dele (Ctrl + Z junta as mudanças seguidas do mesmo campo).
  elementById(tree, "livre-fechar-passar-mouse-fundo").props.onChange(ESCURECE_FUNDO);
  elementById(tree, "livre-fechar-passar-mouse-cor").props.onChange("#111111");
  elementById(tree, "livre-fechar-passar-mouse-borda").props.onChange("#ffffff");
  assert.deepEqual(
    calls.map((call) => call.field),
    ["hover.fill", "hover.color", "hover.borderColor"]
  );
  assert.deepEqual(model.findFreeNode(calls[0].next, "fechar").node.hover, { fill: ESCURECE_FUNDO });
  assert.deepEqual(model.findFreeNode(calls[1].next, "fechar").node.hover, { color: "#111111" });
  assert.deepEqual(model.findFreeNode(calls[2].next, "fechar").node.hover, { borderColor: "#ffffff" });

  // Com as três cores: um Voltar ao padrão em cada campo, com o nome falado de cada um; a frase do brilho sai.
  const full = panel.withFreeHover(start, "fechar", { borderColor: "#ffffff", color: "#111111", fill: ESCURECE_FUNDO });
  const fullCalls = [];
  const fullTree = FreeInspectorStyle(hoverProps(full, "fechar", fullCalls));
  const labels = { "passar-mouse-borda": "Cor da borda", "passar-mouse-cor": "Cor do texto", "passar-mouse-fundo": "Fundo" };

  for (const [field, label] of Object.entries(labels)) {
    const reset = elementById(fullTree, `livre-fechar-${field}-padrao`);
    assert.equal(reset.props["aria-label"], `${label}: voltar ao padrão`);
    assert.equal(reset.props.disabled, false);
  }
  assert.equal(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(full, "fechar"))).includes(C.hover.buttonDefault), false);

  elementById(fullTree, "livre-fechar-passar-mouse-fundo-padrao").props.onClick();
  assert.equal(fullCalls[0].field, undefined, "Voltar ao padrão: um passo próprio");
  assert.deepEqual(model.findFreeNode(fullCalls[0].next, "fechar").node.hover, { borderColor: "#ffffff", color: "#111111" });
  elementById(fullTree, "livre-fechar-passar-mouse-cor-padrao").props.onClick();
  elementById(fullTree, "livre-fechar-passar-mouse-borda-padrao").props.onClick();
  assert.deepEqual(model.findFreeNode(fullCalls[1].next, "fechar").node.hover, { borderColor: "#ffffff", fill: ESCURECE_FUNDO });
  assert.deepEqual(model.findFreeNode(fullCalls[2].next, "fechar").node.hover, { color: "#111111", fill: ESCURECE_FUNDO });

  // No histórico: as cores seguidas do mesmo campo são um passo; o Voltar ao padrão é outro (Ctrl + Z volta um de cada vez).
  const entry = (value) => ({ cta: null, design: value });
  const escura = panel.withFreeHover(start, "fechar", { color: "#111111" });
  const comFundo = panel.withFreeHover(escura, "fechar", { fill: ESCURECE_FUNDO });
  let steps = history.createFreeHistory(entry(start));
  steps = history.pushFreeHistory(steps, entry(panel.withFreeHover(start, "fechar", { color: "#222222" })), { coalesceKey: "fechar:hover.color", now: 1_000 });
  steps = history.pushFreeHistory(steps, entry(escura), { coalesceKey: "fechar:hover.color", now: 1_200 });
  steps = history.pushFreeHistory(steps, entry(comFundo), { coalesceKey: "fechar:hover.fill", now: 1_400 });
  steps = history.pushFreeHistory(steps, entry(panel.withFreeHover(comFundo, "fechar", { fill: undefined })), { coalesceKey: null, now: 1_600 });
  assert.equal(steps.past.length, 3);
  assert.deepEqual(model.findFreeNode(history.undoFreeHistory(steps).present.design, "fechar").node.hover, { color: "#111111", fill: ESCURECE_FUNDO });
  assert.deepEqual(model.findFreeNode(history.undoFreeHistory(history.undoFreeHistory(steps)).present.design, "fechar").node.hover, { color: "#111111" });
  assert.equal(history.undoFreeHistory(history.undoFreeHistory(history.undoFreeHistory(steps))).present.design, start);
});

test("L6c: nos Links, só a Cor; o Selo, o Título e os outros tipos não têm a seção", () => {
  const start = design([TITULO, { icon: "sparkles", id: "selo", label: "Novidade", type: "badge" }, { id: "forma", type: "shape" }, LINKS]);
  const calls = [];
  const tree = FreeInspectorStyle(hoverProps(start, "links", calls));

  assert.ok(elementById(tree, "livre-links-passar-mouse"));
  assert.equal(elementById(tree, "livre-links-passar-mouse-fundo"), null);
  assert.equal(elementById(tree, "livre-links-passar-mouse-borda"), null);
  const color = elementById(tree, "livre-links-passar-mouse-cor");
  assert.equal(color.props.label, "Cor");
  color.props.onChange("#e5ff1f");
  assert.equal(calls[0].field, "hover.color");
  assert.deepEqual(model.findFreeNode(calls[0].next, "links").node.hover, { color: "#e5ff1f" });

  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(start, "links")));
  assert.ok(html.includes(">Ao passar o mouse<"));
  assert.equal(html.includes(C.hover.buttonDefault), false, "a frase do brilho é só do Botão");

  for (const id of ["titulo", "selo", "forma"]) {
    assert.equal(elementById(FreeInspectorStyle(hoverProps(start, id)), `livre-${id}-passar-mouse`), null, id);
    assert.equal(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(start, id))).includes("Ao passar o mouse"), false, id);
  }
});

test("L6c: Cor do texto parada com a letra em degradê e Cor da borda parada sem borda, com o motivo; com a cor própria, ficam livres para voltar ao padrão", () => {
  assert.equal(C.hover.colorGradient, "Com o texto em degradê, a cor ao passar o mouse não muda o texto.");
  assert.ok(schema.POPUP_FREE_MESSAGES.hoverGradient.startsWith(C.hover.colorGradient), "a mesma frase do schema, que ainda diz o que fazer");
  assert.equal(C.hover.borderNone, "Escolha uma borda em Borda para mudar a cor dela.");

  // Letra em degradê (linear ou circular), no Botão e nos Links: a cor parada com o motivo; o fundo continua livre.
  for (const paint of [DEGRADE_LETRA, { ...DEGRADE_LETRA, kind: "radial", x: 50, y: 50 }]) {
    const value = design([fecharCom({ box: BORDA_BRANCA, textStyle: { paint } }), { ...LINKS, textStyle: { paint } }]);

    for (const id of ["fechar", "links"]) {
      const node = model.findFreeNode(value, id).node;
      assert.equal(panel.freeHoverColorDisabledReason(node), C.hover.colorGradient, id);
      const tree = FreeInspectorStyle(hoverProps(value, id));
      assert.equal(elementById(tree, `livre-${id}-passar-mouse-cor`).props.disabled, true, id);
      assert.ok(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(value, id))).includes(C.hover.colorGradient), id);
    }

    assert.equal(elementById(FreeInspectorStyle(hoverProps(value, "fechar")), "livre-fechar-passar-mouse-fundo").props.disabled, false);
  }

  assert.equal(panel.freeHoverColorDisabledReason(fecharCom()), null, "a letra padrão é sólida");
  assert.equal(panel.freeHoverColorDisabledReason(fecharCom({ textStyle: { paint: { color: "#ffffff00", kind: "solid" }, stroke: CONTORNO_BRANCO } })), null, "a vazada ganha cor");

  // A cor já escolhida com a letra em degradê (colada, ou a letra virou degradê depois): o campo fica livre, com o erro
  // do schema nele, e o Voltar ao padrão tira a cor num passo (o design volta a valer).
  const invalido = design([fecharCom({ hover: { color: "#111111" }, textStyle: { paint: DEGRADE_LETRA } }), LINKS]);
  assert.equal(panel.freeHoverColorDisabledReason(model.findFreeNode(invalido, "fechar").node), null);
  assert.equal(schema.parsePopupFreeDesign(invalido), null, "o schema recusa");
  const errors = { "freeDesign.nodes.fechar.hover.color": schema.POPUP_FREE_MESSAGES.hoverGradient };
  const calls = [];
  const comErro = FreeInspectorStyle({ ...hoverProps(invalido, "fechar", calls), errors });
  const campo = elementById(comErro, "livre-fechar-passar-mouse-cor");
  assert.equal(campo.props.disabled, false);
  assert.equal(campo.props.error, schema.POPUP_FREE_MESSAGES.hoverGradient);
  assert.equal(elementById(comErro, "livre-fechar-passar-mouse-erro").props.message, undefined, "o erro fica no campo, sem repetir na seção");
  elementById(comErro, "livre-fechar-passar-mouse-cor-padrao").props.onClick();
  assert.equal(calls[0].field, undefined);
  assert.ok(schema.parsePopupFreeDesign(calls[0].next), "sem a cor, vale de novo");

  // Sem borda: a Cor da borda parada com o motivo; com borda, livre e sem a nota.
  const semBorda = design([fecharCom(), LINKS]);
  assert.equal(panel.freeHoverBorderNote(model.findFreeNode(semBorda, "fechar").node), C.hover.borderNone);
  assert.equal(elementById(FreeInspectorStyle(hoverProps(semBorda, "fechar")), "livre-fechar-passar-mouse-borda").props.disabled, true);
  assert.ok(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(semBorda, "fechar"))).includes(C.hover.borderNone));
  const comBorda = design([fecharCom({ box: BORDA_BRANCA }), LINKS]);
  assert.equal(panel.freeHoverBorderNote(model.findFreeNode(comBorda, "fechar").node), null);
  assert.equal(elementById(FreeInspectorStyle(hoverProps(comBorda, "fechar")), "livre-fechar-passar-mouse-borda").props.disabled, false);
  assert.equal(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(comBorda, "fechar"))).includes(C.hover.borderNone), false);
  // A cor da borda escolhida e a borda tirada depois: o campo fica livre (para voltar ao padrão), com a nota.
  const borda = design([fecharCom({ hover: { borderColor: "#ffffff" } }), LINKS]);
  const bordaTree = FreeInspectorStyle(hoverProps(borda, "fechar"));
  assert.equal(elementById(bordaTree, "livre-fechar-passar-mouse-borda").props.disabled, false);
  assert.ok(elementById(bordaTree, "livre-fechar-passar-mouse-borda-padrao"));
  assert.ok(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(borda, "fechar"))).includes(C.hover.borderNone));
  assert.equal(panel.freeHoverBorderNote({ hover: { color: "#ffffff" }, id: "links", type: "links" }), null, "os Links não têm borda ao passar o mouse");

  // O editor parado (salvando) para tudo, inclusive o Voltar ao padrão.
  const parado = FreeInspectorStyle({ ...hoverProps(borda, "fechar"), disabled: true });
  assert.equal(elementById(parado, "livre-fechar-passar-mouse-borda").props.disabled, true);
  assert.equal(elementById(parado, "livre-fechar-passar-mouse-borda-padrao").props.disabled, true);
});

test("L6c: a nota do brilho, a chave e a Cor da borda seguem o cartão: só conta a cor que aparece", () => {
  /** O que o cartão do aluno põe em data-free-hover (null = nada muda e o botão clareia, como sem cores). */
  const cartao = (node) => styles.freeHoverAttrs(node, render.freeTextStyleOf(node), false).attrs["data-free-hover"] ?? null;

  // Só a Cor da borda sem borda (a borda tirada depois) ou com borda de 0 px (colada), e só a Cor com a letra em
  // degradê (colada; o schema recusa ao salvar, mas o editor mostra): no cartão nada muda e o botão continua clareando.
  // O editor diz o mesmo: a frase do brilho aparece e a chave fica parada, com o motivo.
  const semBorda = design([fecharCom({ box: VERMELHO_BOTAO, hover: { borderColor: "#ffffff" } }), LINKS]);
  const bordaZero = design([fecharCom({ box: { ...VERMELHO_BOTAO, border: { color: "#ffffff", width: 0 } }, hover: { borderColor: "#000000" } }), LINKS]);
  const degrade = design([fecharCom({ box: VERMELHO_BOTAO, hover: { color: "#111111" }, textStyle: { paint: DEGRADE_LETRA } }), LINKS]);
  const linksDegrade = design([fecharCom(), { ...LINKS, hover: { color: "#111111" }, textStyle: { paint: DEGRADE_LETRA } }]);

  for (const [nome, value, id] of [
    ["sem borda", semBorda, "fechar"],
    ["borda de 0 px", bordaZero, "fechar"],
    ["letra em degradê", degrade, "fechar"],
    ["Links em degradê", linksDegrade, "links"]
  ]) {
    const node = model.findFreeNode(value, id).node;
    const chave = elementById(FreeInspectorStyle(hoverProps(value, id, [], [], { hoverPreview: true })), `livre-${id}-passar-mouse-ver`);

    assert.equal(cartao(node), null, `${nome}: o cartão não muda nada`);
    assert.equal(panel.freeHasHover(node), false, nome);
    assert.equal(panel.freeHoverPreviewDisabledReason(node, "desktop"), C.hover.previewEmpty, nome);
    assert.equal(chave.props.disabled, true, nome);
    assert.equal(chave.props.checked, false, nome);
    assert.equal(panel.freeHoverPreviewAfter(id, { activeId: id, device: "desktop", hasHover: panel.freeHasHover(node), many: false, panel: "inspector" }), null, nome);

    if (id === "fechar") {
      assert.ok(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(value, id))).includes(C.hover.buttonDefault), `${nome}: o botão clareia, e a frase diz`);
    }
  }

  // A borda de 0 px é como sem borda: a Cor da borda ganha a nota (e fica livre só para voltar ao padrão).
  assert.equal(panel.freeHoverBorderNote(model.findFreeNode(bordaZero, "fechar").node), C.hover.borderNone);
  assert.ok(renderToStaticMarkup(createElement(FreeInspectorStyle, hoverProps(bordaZero, "fechar"))).includes(C.hover.borderNone));
  assert.equal(panel.freeHoverBorderNote(fecharCom({ box: { border: { color: "#ffffff", width: 0 } } })), C.hover.borderNone);
  assert.equal(elementById(FreeInspectorStyle(hoverProps(design([fecharCom({ box: { border: { color: "#ffffff", width: 0 } } }), LINKS]), "fechar")), "livre-fechar-passar-mouse-borda").props.disabled, true);

  // O que aparece conta nos dois lados: a borda de 1 px, a letra de cor sólida (também a vazada), o fundo (também com
  // a letra em degradê) e a cor dos Links.
  for (const [nome, node] of [
    ["borda de 1 px", fecharCom({ box: { ...VERMELHO_BOTAO, ...BORDA_BRANCA }, hover: { borderColor: "#000000" } })],
    ["letra vazada", fecharCom({ hover: { color: "#111111" }, textStyle: { paint: { color: "#ffffff00", kind: "solid" }, stroke: CONTORNO_BRANCO } })],
    ["fundo com a letra em degradê", fecharCom({ hover: { fill: ESCURECE_FUNDO }, textStyle: { paint: DEGRADE_LETRA } })],
    ["Links", { ...LINKS, hover: { color: "#e5ff1f" } }]
  ]) {
    assert.notEqual(cartao(node), null, nome);
    assert.equal(panel.freeHasHover(node), true, nome);
    assert.equal(panel.freeHoverPreviewDisabledReason(node, "desktop"), null, nome);
  }

  // Combinação por combinação, o editor diz o mesmo que o cartão (a regra mora nos dois, sem o editor importar o
  // módulo do cartão): os dois tipos, a letra (sólida, vazada, em degradê), a borda (sem, de 0 px, de 1 px) e cada
  // conjunto das três cores, inclusive o objeto vazio e sem a chave.
  const CORES = { borderColor: "#000000", color: "#111111", fill: ESCURECE_FUNDO };
  const letras = [undefined, { paint: { color: "#ffffff00", kind: "solid" }, stroke: CONTORNO_BRANCO }, { paint: DEGRADE_LETRA }];
  const bordas = [undefined, { color: "#ffffff", width: 0 }, { color: "#ffffff", width: 1 }];
  const conjuntos = [null, ...[0, 1, 2, 3, 4, 5, 6, 7].map((bits) => Object.keys(CORES).filter((_, index) => bits & (1 << index)))];
  let combinacoes = 0;

  for (const base of [fecharCom(), LINKS]) {
    for (const letra of letras) {
      for (const borda of bordas) {
        for (const conjunto of conjuntos) {
          const node = {
            ...base,
            ...(borda ? { box: { border: borda } } : {}),
            ...(conjunto ? { hover: Object.fromEntries(conjunto.map((key) => [key, CORES[key]])) } : {}),
            ...(letra ? { textStyle: letra } : {})
          };

          assert.equal(panel.freeHasHover(node), cartao(node) !== null, JSON.stringify(node));
          combinacoes += 1;
        }
      }
    }
  }

  assert.equal(combinacoes, 2 * 3 * 3 * 9);
});

test("L6c: a chave Ver com o mouse em cima liga e desliga o palco, sem mudar o design; parada sem cor própria", () => {
  assert.equal(C.hover.preview, "Ver com o mouse em cima");
  assert.equal(C.hover.previewNote, "Só para você ver aqui. Não muda o pop-up.");

  const comCor = design([fecharCom({ hover: { fill: ESCURECE_FUNDO } }), LINKS]);
  const calls = [];
  const previews = [];
  const off = elementById(FreeInspectorStyle(hoverProps(comCor, "fechar", calls, previews)), "livre-fechar-passar-mouse-ver");

  assert.equal(off.props.checked, false);
  assert.equal(off.props.disabled, false);
  assert.equal(off.props.description, C.hover.previewNote);
  assert.equal(off.props.label, C.hover.preview);
  off.props.onCheckedChange(true);
  assert.deepEqual(previews, [true]);
  assert.deepEqual(calls, [], "não muda o design nem o histórico");

  const on = elementById(FreeInspectorStyle(hoverProps(comCor, "fechar", calls, previews, { hoverPreview: true })), "livre-fechar-passar-mouse-ver");
  assert.equal(on.props.checked, true);
  on.props.onCheckedChange(false);
  assert.deepEqual(previews, [true, false]);
  assert.deepEqual(calls, []);

  // Sem cor própria, o palco não teria o que mostrar: a chave fica parada, com o motivo, e nunca aparece ligada.
  const semCor = design([fecharCom(), LINKS]);
  const parada = elementById(FreeInspectorStyle(hoverProps(semCor, "fechar", [], [], { hoverPreview: true })), "livre-fechar-passar-mouse-ver");
  assert.equal(parada.props.disabled, true);
  assert.equal(parada.props.checked, false);
  assert.equal(parada.props.description, C.hover.previewEmpty);
  assert.equal(panel.freeHoverPreviewDisabledReason(model.findFreeNode(semCor, "fechar").node, "desktop"), C.hover.previewEmpty);
  assert.equal(panel.freeHoverPreviewDisabledReason(model.findFreeNode(comCor, "fechar").node, "desktop"), null);

  // Com Ver como: Celular, o palco desenha o celular, onde não tem mouse: a chave fica parada, com o motivo, e nunca
  // aparece ligada (o aluno no celular nunca vê as cores ao passar o mouse).
  assert.equal(C.hover.previewMobile, "No celular não tem mouse. Para ver aqui, use Ver como: Computador.");
  assert.equal(panel.freeHoverPreviewDisabledReason(model.findFreeNode(comCor, "fechar").node, "mobile"), C.hover.previewMobile);
  assert.equal(panel.freeHoverPreviewDisabledReason(model.findFreeNode(semCor, "fechar").node, "mobile"), C.hover.previewEmpty, "sem cor, o motivo de sempre");
  const noCelular = elementById(FreeInspectorStyle(hoverProps(comCor, "fechar", [], [], { device: "mobile", hoverPreview: true })), "livre-fechar-passar-mouse-ver");
  assert.equal(noCelular.props.disabled, true);
  assert.equal(noCelular.props.checked, false);
  assert.equal(noCelular.props.description, C.hover.previewMobile);

  // A chave continua ligada só com o mesmo elemento sozinho, com cor própria, com o painel do elemento aberto e com Ver
  // como: Computador: volta ao normal ao trocar de elemento, com vários, no Revisar, no Celular e quando a última cor
  // volta ao padrão (ou sai pelo Ctrl + Z). Sair do Estilo também desliga (o painel, logo abaixo).
  const now = { activeId: "fechar", device: "desktop", hasHover: true, many: false, panel: "inspector" };
  assert.equal(panel.freeHoverPreviewAfter("fechar", now), "fechar");
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, device: "mobile" }), null, "Ver como: Celular");
  assert.equal(panel.freeHoverPreviewAfter(null, now), null);
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, activeId: "links" }), null, "outro elemento");
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, activeId: null }), null, "nada escolhido (ou o elemento saiu)");
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, many: true }), null, "vários escolhidos");
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, panel: "review" }), null, "no Revisar");
  assert.equal(panel.freeHoverPreviewAfter("fechar", { ...now, hasHover: false }), null, "sem cor própria");

  // O painel liga a chave pelo id do elemento e o editor leva ao palco, que passa ao cartão (o atributo do aluno).
  const inspector = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-inspector.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-editor.tsx", import.meta.url), "utf8");
  const canvas = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-canvas.tsx", import.meta.url), "utf8");
  assert.match(inspector, /hoverPreview: hoverPreviewId === node\.id,/);
  assert.match(inspector, /onHoverPreviewChange: \(on\) => onHoverPreviewChange\?\.\(on \? node\.id : null\)/);
  assert.match(inspector, /const sectionProps: FreeSectionProps = \{[^}]*\sdevice,/, "o Estilo sabe o aparelho do Ver como");
  // Em outra aba a chave some: o painel desliga a prévia ao sair do Estilo (por clique, pelo foco de um erro ou pela
  // aba Celular).
  assert.match(inspector, /useEffect\(\(\) => \{\s+if \(tab !== "style" && hoverPreviewId !== null\) \{\s+onHoverPreviewChangeRef\.current\?\.\(null\);\s+\}\s+\}, \[hoverPreviewId, onHoverPreviewChangeRef, tab\]\);/);
  assert.match(editor, /freeHoverPreviewAfter\(hoverPreviewId, \{ activeId, device, hasHover: freeHasHover\(selectedNode\), many, panel: rightPanel \}\)/);
  assert.match(editor, /hoverPreviewId=\{hoverPreviewId\}\s+onBusyChange=/);
  assert.match(editor, /onHoverPreviewChange=\{setHoverPreviewId\}/);
  assert.match(editor, /hoverPreviewId=\{hoverPreviewId\}\s+onCommitMoves=/);
  assert.match(canvas, /<PopupFreeCard[\s\S]*?\shoverPreviewId=\{hoverPreviewId\}[\s\S]*?preview\s*\/>/);
});

test("L6c: as chaves de erro e de dica das cores ao passar o mouse levam ao campo certo no Estilo (crítica C12)", () => {
  const value = design([
    { children: [fecharCom({ box: BORDA_BRANCA, hover: { borderColor: "#ffffff", color: "#111111", fill: ESCURECE_FUNDO } })], id: "caixa", type: "box" },
    { action: { kind: "cta" }, id: "botao", type: "button" },
    TITULO,
    { ...LINKS, hover: { color: "#e5ff1f" } }
  ]);
  const target = (key) => panel.freeInspectorTargetOf(value, key);
  const style = (id, field) => ({ fieldId: `livre-${id}-${field}`, nodeId: id, tab: "style" });

  // Cada cor no campo dela (nunca o Conteúdo), com ou sem "freeDesign." e dentro da caixa.
  assert.deepEqual(target("freeDesign.nodes.fechar.hover.color"), style("fechar", "passar-mouse-cor"));
  assert.deepEqual(target("nodes.fechar.hover.fill.stops"), style("fechar", "passar-mouse-fundo"));
  assert.deepEqual(target("nodes.fechar.hover.fill.angle"), style("fechar", "passar-mouse-fundo"));
  assert.deepEqual(target("nodes.fechar.hover.borderColor"), style("fechar", "passar-mouse-borda"));
  assert.deepEqual(target("nodes.botao.hover.fill"), style("botao", "passar-mouse-fundo"));
  assert.deepEqual(target("nodes.links.hover.color"), style("links", "passar-mouse-cor"));
  // O objeto inteiro (a frase do formato) e, nos Links, o que não é a cor: a seção.
  assert.deepEqual(target("nodes.fechar.hover"), style("fechar", "passar-mouse"));
  assert.deepEqual(target("nodes.links.hover"), style("links", "passar-mouse"));
  assert.deepEqual(target("nodes.links.hover.fill"), style("links", "passar-mouse"));
  // Fora do Botão e dos Links não há seção: o primeiro campo do Conteúdo, como antes.
  assert.deepEqual(target("nodes.titulo.hover"), { fieldId: "livre-titulo-texto", nodeId: "titulo", tab: "content" });
  assert.deepEqual(panel.freeFocusTargetOf(value, { key: "nodes.fechar.hover.color" }), style("fechar", "passar-mouse-cor"));

  // A dica do Revisar sai na chave da cor ao passar o mouse e leva ao mesmo campo.
  const comDica = design([fecharCom({ hover: { fill: { color: "#ffffff", kind: "solid" } } }), LINKS]);
  const dica = checks.popupFreeHints(comDica).find((hint) => panel.freeIsHoverKey(hint.key));
  assert.equal(dica.key, "nodes.fechar.hover.color");
  assert.deepEqual(panel.freeInspectorTargetOf(comDica, dica.key), style("fechar", "passar-mouse-cor"));

  // Os campos existem no Estilo com esses ids, e o erro aparece no campo.
  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, { ...styleProps(value, "fechar"), errors: { "freeDesign.nodes.fechar.hover.fill.stops": "Use de 2 a 5 cores." } }));
  for (const id of ["livre-fechar-passar-mouse", "livre-fechar-passar-mouse-fundo", "livre-fechar-passar-mouse-cor", "livre-fechar-passar-mouse-borda"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.ok(html.includes("Use de 2 a 5 cores."));
  // O erro do objeto inteiro aparece na seção.
  const objeto = FreeInspectorStyle({ ...styleProps(value, "fechar"), errors: { "nodes.fechar.hover": schema.POPUP_FREE_MESSAGES.hover } });
  assert.equal(elementById(objeto, "livre-fechar-passar-mouse-erro").props.message, schema.POPUP_FREE_MESSAGES.hover);

  assert.equal(panel.freeIsHoverKey("nodes.fechar.hover"), true);
  assert.equal(panel.freeIsHoverKey("freeDesign.nodes.fechar.hover.fill.stops"), true);
  assert.equal(panel.freeIsHoverKey("nodes.fechar.textStyle.paint"), false);
  assert.equal(panel.freeIsHoverKey("nodes.hover.textStyle.paint"), false, "um elemento com o id hover");
  assert.equal(panel.freeIsHoverKey("nodes.fechar.hovered"), false);
});

test("L6c: a dica de contraste ao passar o mouse fica na seção dela; a de sempre, embaixo da Cor do texto", () => {
  const value = design([fecharCom({ box: VERMELHO_BOTAO, hover: { fill: { color: "#ffffff", kind: "solid" } } }), LINKS]);
  const hints = [
    { key: "nodes.fechar.textStyle.paint", kind: "contrast", message: "Contraste de sempre.", nodeId: "fechar" },
    { key: "nodes.fechar.hover.color", kind: "contrast", message: "Ao passar o mouse, contraste baixo.", nodeId: "fechar" }
  ];
  const html = renderToStaticMarkup(createElement(FreeInspectorStyle, { ...hoverProps(value, "fechar"), hints }));
  const at = html.indexOf('id="livre-fechar-passar-mouse"');
  const before = html.slice(0, at);
  const section = html.slice(at);

  assert.ok(at > 0);
  assert.ok(before.includes("Contraste de sempre.") && !before.includes("Ao passar o mouse, contraste baixo."));
  assert.ok(section.includes("Ao passar o mouse, contraste baixo.") && !section.includes("Contraste de sempre."));
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario
 * ---------------------------------------------------------------------------------------------- */

function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (typeof value === "function") {
    collectStrings(value(3, 4), out);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectStrings(entry, out));
  }

  return out;
}

const UI_FILES = [
  "free-inspector.tsx",
  "free-inspector-content.tsx",
  "free-inspector-style.tsx",
  "free-inspector-advanced.tsx",
  "free-inspector-mobile.tsx",
  "free-artboard-settings.tsx",
  "free-fields.tsx",
  "free-assets.ts"
].map((name) => new URL(`../src/components/admin/v2/communication/popup-free/${name}`, import.meta.url));

test("Links › Conteúdo: a chave do Lembrar depois no aviso; na página do modelo de Design, só a nota (o modelo não guarda a regra)", () => {
  // docs/27 §13.7 e docs/28 §1.7: `allowSnoozeEditable` false vem da pagina do modelo de Design pelo card Design.
  const base = design([{ id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" }, LINKS]);

  function render(allowSnoozeEditable) {
    const content = { allowSnooze: true, allowSnoozeEditable, audio: null, cta: null, onAllowSnoozeChange() {}, onCtaChange() {}, products: [], productsLoaded: true, snoozeMinutes: 1_440, title: "Aula nova" };
    const props = { content, design: base, disabled: false, errors: {}, fonts: [], hints: [], latest: () => base, node: model.findFreeNode(base, "links").node, onBusyChange() {}, onChange() {}, onCtaChange() {}, onFontsChange() {}, rects: {} };

    return renderToStaticMarkup(createElement(FreeInspectorContent, props));
  }

  const aviso = render(true);
  assert.match(aviso, /id="livre-links-lembrar"/, "no aviso, a chave esta la");
  assert.match(aviso, /Permitir “Lembrar depois”/);
  assert.match(aviso, /Volta em 1 dia, até 2 vezes\./);
  assert.equal(aviso.includes(C.links.snoozeFixed), false);

  const modelo = render(false);
  assert.doesNotMatch(modelo, /id="[^"]*-lembrar"/, "na pagina do modelo de Design nao ha a chave");
  assert.equal(modelo.includes("Permitir “Lembrar depois”"), false);
  assert.ok(modelo.includes(C.links.snoozeFixed), "no lugar, a nota");
  assert.match(modelo, /id="livre-links-nao-mostrar"/, "a chave do Não mostrar de novo continua");
  assert.equal(C.links.snoozeFixed, "“Lembrar depois” é regra do pop-up, não do modelo de design: define-se no aviso.");

  // Sem a chave (o aviso comum e o modo modelo de Pop-up nao passam nada), o padrao e a chave.
  assert.match(render(undefined), /id="livre-links-lembrar"/);
});

/* ------------------------------------------------------------------------------------------------
 * Aba Celular (docs/27 §9.10 e §13.8, PR L3)
 * ---------------------------------------------------------------------------------------------- */

const SELO = { id: "selo", label: "Novidade", place: { mode: "free", w: 116, x: 300, y: 16 }, type: "badge" };
const TITULO = { id: "titulo", lines: [[{ text: "Aula nova" }]], textStyle: { size: 40 }, type: "heading" };
const FORMA = { box: { fill: [{ color: "#ffffff26", kind: "solid" }] }, id: "forma", place: { h: 100, mode: "free", w: 100, x: 40, y: 40 }, type: "shape" };

test("aba Celular: só os campos que têm versão do celular, por tipo (nunca cor, camada ou girar)", () => {
  const keys = (node) => panel.freeMobileFieldsOf(node).map((field) => field.key);

  assert.deepEqual(keys(SELO), ["hidden", "place.x", "place.y", "place.w", "textStyle.size", "textStyle.lineHeight", "textStyle.letterSpacing", "textStyle.align", "box.padding", "box.radius"]);
  assert.deepEqual(keys(TITULO), ["hidden", "place.width", "place.height", "place.align", "place.margin", "textStyle.size", "textStyle.lineHeight", "textStyle.letterSpacing", "textStyle.align", "box.padding", "box.radius"]);
  assert.deepEqual(keys(FORMA), ["hidden", "place.x", "place.y", "place.w", "place.h", "box.padding", "box.radius"], "sem texto, a altura aparece");
  assert.deepEqual(keys({ id: "espaco", type: "spacer" }).filter((key) => !key.startsWith("place.")), ["hidden", "size", "box.padding", "box.radius"]);
  assert.ok(keys({ icon: "star", id: "icone", type: "icon" }).includes("size"));
  assert.ok(keys(LINKS).includes("gap") && keys(LINKS).includes("textStyle.size"));
  assert.deepEqual(keys({ children: [], id: "caixa", type: "box" }).filter((key) => key.startsWith("layout.")), ["layout.dir", "layout.gap", "layout.align", "layout.justify", "layout.wrap"]);

  for (const node of [SELO, TITULO, FORMA, LINKS, { children: [], id: "caixa", type: "box" }]) {
    for (const key of keys(node)) {
      assert.equal(/color|paint|fill|shadow|z$|rotate|font|weight/i.test(key), false, `${node.type}: ${key}`);
    }
  }

  // Os rotulos sao os dos outros paineis (o mesmo nome do mesmo campo).
  const labels = Object.fromEntries(panel.freeMobileFieldsOf(TITULO).map((field) => [field.key, field.label]));
  assert.equal(labels["textStyle.size"], C.style.size);
  assert.equal(labels["place.margin"], C.advanced.margin);
  assert.equal(labels.hidden, "Esconder no celular");
});

test("aba Celular: Igual ao computador ligada mostra o do computador; desligada grava o próprio, começando dele", () => {
  const base = design([SELO, TITULO, FORMA, LINKS]);
  const node = (value, id) => model.findFreeNode(value, id).node;

  // Ligada (padrao): sem valor proprio, o celular usa o do computador (com o padrao do tipo preenchido).
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "titulo"), "textStyle.size"), { own: false, value: 40 });
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "titulo"), "textStyle.align"), { own: false, value: render.freeTextStyleOf(TITULO).align });
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "selo"), "place.x"), { own: false, value: 300 });
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "titulo"), "place.width"), { own: false, value: "fill" });
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "titulo"), "place.height", { titulo: { h: 52.4, w: 392, x: 24, y: 24 } }), { own: false, value: 52 });
  assert.deepEqual(panel.freeMobileFieldValue(base, node(base, "forma"), "hidden"), { own: false, value: false });

  // Desligar: o valor proprio comeca do computador (a chave fica desligada enquanto o editor esta aberto).
  const off = panel.withFreeMobileField(base, "titulo", "textStyle.size", panel.freeMobileDesktopValue(base, node(base, "titulo"), "textStyle.size"));
  assert.deepEqual(panel.freeMobileFieldValue(off, node(off, "titulo"), "textStyle.size"), { own: true, value: 40 });
  assert.ok(schema.popupFreeDesignSchema.safeParse(off).success);
  assert.equal(model.canonicalPopupFreeDesign(off).devices, undefined, "igual ao computador: a forma canônica tira ao salvar");

  // Mudar o valor: so o celular muda; o computador fica.
  const smaller = panel.withFreeMobileField(off, "titulo", "textStyle.size", 28);
  assert.equal(node(smaller, "titulo").textStyle.size, 40);
  assert.deepEqual(model.canonicalPopupFreeDesign(smaller).devices, { mobile: { nodes: { titulo: { textStyle: { size: 28 } } } } });
  assert.equal(model.resolveFreeForDevice(smaller, "mobile").children[1].textStyle.size, 28);

  // A posicao entra com o modo do computador: na sequencia continua na sequencia; solto continua solto.
  const flow = panel.withFreeMobileField(smaller, "titulo", "place.margin", [8, 0]);
  assert.deepEqual(model.freeMobileNodeOf(flow, "titulo").place, { margin: [8, 0], mode: "flow" });
  const free = panel.withFreeMobileField(flow, "selo", "place.x", 24);
  assert.deepEqual(model.freeMobileNodeOf(free, "selo"), { place: { mode: "free", x: 24 } });
  assert.ok(schema.popupFreeDesignSchema.safeParse(free).success);

  // Esconder so no celular (o computador continua mostrando).
  const hidden = panel.withFreeMobileField(free, "forma", "hidden", true);
  assert.equal(node(hidden, "forma").hidden, undefined);
  assert.equal(model.resolveFreeForDevice(hidden, "mobile").children[2].hidden, true);
  assert.equal(model.canonicalPopupFreeDesign(hidden).devices.mobile.nodes.forma.hidden, true);

  // Ligar de novo: o campo sai; a parte vazia e a entrada vazia saem junto.
  const back = panel.withFreeMobileField(hidden, "selo", "place.x", undefined);
  assert.equal(model.freeMobileNodeOf(back, "selo"), undefined);
  const onlySize = panel.withFreeMobileField(panel.withFreeMobileField(back, "titulo", "place.margin", undefined), "titulo", "textStyle.size", undefined);
  assert.equal(model.freeMobileNodeOf(onlySize, "titulo"), undefined);
  assert.equal(panel.freeHasMobileValues(onlySize, "forma"), true);
  assert.equal(panel.freeHasMobileValues(onlySize, "titulo"), false);
  assert.equal(panel.withFreeMobileField(base, "sumiu", "hidden", true), base, "elemento que nao existe: nada muda");
});

test("aba Celular: Voltar tudo ao do computador e o grupo No celular do Pop-up", () => {
  const base = design([SELO, TITULO, LINKS], {
    artboard: { padding: 32 },
    devices: { mobile: { artboard: { gap: 8 }, nodes: { selo: { place: { mode: "free", x: 24 }, textStyle: { size: 14 } }, titulo: { textStyle: { size: 28 } } } } }
  });

  const reset = panel.withoutFreeMobileValues(base, "selo");
  assert.equal(model.freeMobileNodeOf(reset, "selo"), undefined);
  assert.deepEqual(model.freeMobileNodeOf(reset, "titulo"), { textStyle: { size: 28 } }, "os outros elementos ficam");
  assert.equal(panel.withoutFreeMobileValues(panel.withoutFreeMobileValues(reset, "titulo"), "titulo").devices.mobile.artboard.gap, 8);

  // A prancheta no celular: Respiro interno, Espaço entre os elementos e Altura mínima.
  assert.deepEqual(panel.FREE_MOBILE_ARTBOARD_FIELDS.map((field) => field.key), ["padding", "gap", "minHeight"]);
  assert.deepEqual(panel.freeMobileArtboardValue(base, "padding"), { own: false, value: 32 });
  assert.deepEqual(panel.freeMobileArtboardValue(base, "gap"), { own: true, value: 8 });
  assert.deepEqual(panel.freeMobileArtboardValue(base, "minHeight"), { own: false, value: 0 });
  const padded = panel.withFreeMobileArtboardField(base, "padding", 16);
  assert.deepEqual(padded.devices.mobile.artboard, { gap: 8, padding: 16 });
  assert.equal(padded.artboard.padding, 32, "o computador fica");
  assert.equal(model.resolveFreeForDevice(padded, "mobile").artboard.padding, 16);
  assert.ok(schema.popupFreeDesignSchema.safeParse(padded).success);

  // Tudo igual de novo: devices sai do design.
  const empty = panel.withFreeMobileArtboardField(panel.withFreeMobileArtboardField(panel.withoutFreeMobileValues(reset, "titulo"), "gap", undefined), "padding", undefined);
  assert.equal("devices" in empty, false);
});

test("aba Celular: a chave de erro do celular leva à aba Celular e ao campo; a da prancheta, ao No celular", () => {
  const value = design([SELO, TITULO, FORMA, LINKS]);
  const target = (key) => panel.freeInspectorTargetOf(value, key);

  assert.deepEqual(target("freeDesign.devices.mobile.nodes.titulo.textStyle.size"), { fieldId: "livre-titulo-celular-tamanho-texto", nodeId: "titulo", tab: "mobile" });
  assert.deepEqual(target("devices.mobile.nodes.selo.place.x"), { fieldId: "livre-selo-celular-x", nodeId: "selo", tab: "mobile" });
  assert.deepEqual(target("devices.mobile.nodes.selo.place.mode"), { fieldId: "livre-selo-celular-x", nodeId: "selo", tab: "mobile" }, "o modo: o primeiro campo da posição");
  assert.deepEqual(target("devices.mobile.nodes.titulo.place.margin"), { fieldId: "livre-titulo-celular-margem", nodeId: "titulo", tab: "mobile" });
  assert.deepEqual(target("devices.mobile.nodes.forma.box.radius"), { fieldId: "livre-forma-celular-cantos", nodeId: "forma", tab: "mobile" });
  assert.deepEqual(target("devices.mobile.nodes.forma.hidden"), { fieldId: "livre-forma-celular-esconder", nodeId: "forma", tab: "mobile" });
  assert.deepEqual(target("devices.mobile.nodes.forma.textStyle"), { fieldId: "livre-forma-celular-esconder", nodeId: "forma", tab: "mobile" }, "campo de outro tipo: a aba Celular do elemento");
  assert.deepEqual(target("devices.mobile.nodes.titulo"), { fieldId: "livre-titulo-celular-esconder", nodeId: "titulo", tab: "mobile" });
  assert.deepEqual(target("freeDesign.devices.mobile.artboard.padding"), { fieldId: "livre-popup-celular-respiro", nodeId: null, tab: "popup" });
  assert.deepEqual(target("devices.mobile.artboard.minHeight"), { fieldId: "livre-popup-celular-altura", nodeId: null, tab: "popup" });
  assert.equal(target("devices.mobile.nodes.sumiu.place.x"), null);
  assert.equal(target("devices.mobile.nodes"), null);
  // "Ajustar no Celular" (dica "texto no celular") pede o tamanho do texto do celular.
  assert.deepEqual(panel.freeFocusTargetOf(value, { key: panel.freeMobileTextSizeKey("titulo") }), { fieldId: "livre-titulo-celular-tamanho-texto", nodeId: "titulo", tab: "mobile" });
  // O elemento do erro do celular (o aviso nas Camadas e o nome no Revisar), pelo id.
  assert.equal(model.freeNodeIdOfKey("devices.mobile.nodes.selo.place.x"), "selo");

  // A aba Celular fica com qualquer elemento; sem elemento, volta ao Conteúdo.
  assert.equal(panel.freeTabAfterSelection("mobile", "heading", "image"), "mobile");
  assert.equal(panel.freeTabAfterSelection("mobile", "heading", "heading"), "mobile");
  assert.equal(panel.freeTabAfterSelection("mobile", "heading", null), "content");
});

test("aba Celular: a altura própria do celular de um texto solto sem altura no computador aparece em Altura (e sai com Igual ao computador)", async () => {
  const editorModel = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
  const solto = { id: "titulo", lines: [[{ text: "Aula nova" }]], place: { mode: "free", w: 300, x: 20, y: 20 }, type: "heading" };
  const base = design([solto, LINKS]);
  const keys = (value) => panel.freeMobileFieldsOf(model.findFreeNode(value, "titulo").node, value).map((field) => field.key);

  // Sem altura no computador e sem altura no celular: o texto cresce sozinho, sem o campo Altura.
  assert.equal(keys(base).includes("place.h"), false);

  // As alcas de cima e de baixo no Ver como Celular gravam a altura so no celular: o campo Altura aparece.
  const alto = editorModel.setFreeNodeRect(base, "titulo", { h: 90, w: 300, x: 20, y: 20 }, "mobile");
  assert.deepEqual(model.freeMobileNodeOf(alto, "titulo"), { place: { h: 90, mode: "free" } });
  assert.equal(model.findFreeNode(alto, "titulo").node.place.h, undefined, "o computador fica sem altura");
  assert.deepEqual(keys(alto), ["hidden", "place.x", "place.y", "place.w", "place.h", "textStyle.size", "textStyle.lineHeight", "textStyle.letterSpacing", "textStyle.align", "box.padding", "box.radius"]);
  assert.deepEqual(panel.freeMobileFieldValue(alto, model.findFreeNode(alto, "titulo").node, "place.h"), { own: true, value: 90 });
  // O Revisar com a chave da altura do celular cai no campo Altura (e nao no primeiro da posicao).
  assert.deepEqual(panel.freeInspectorTargetOf(alto, "devices.mobile.nodes.titulo.place.h"), { fieldId: "livre-titulo-celular-altura", nodeId: "titulo", tab: "mobile" });

  // "Igual ao computador" de novo: a altura sai do celular e o campo some.
  const igual = panel.withFreeMobileField(alto, "titulo", "place.h", undefined);
  assert.equal(model.freeMobileNodeOf(igual, "titulo"), undefined);
  assert.equal(keys(igual).includes("place.h"), false);
});

test("aba Celular: o alinhamento do botão sem escolha é o centro desenhado, e o Esquerda do celular fica ao salvar", async () => {
  const styles = await import("../src/components/member/notifications/popup-free/popup-free-styles.ts");
  const botao = { action: { kind: "close" }, id: "botao", label: "Fechar", type: "button" };
  const base = design([botao, LINKS]);
  const node = model.findFreeNode(base, "botao").node;

  // O computador desenha o botao sem alinhamento escolhido no centro: e o valor do computador da aba Celular.
  assert.equal(styles.freeButtonLayoutCss(node).justifyContent, "center");
  assert.equal(panel.freeMobileDesktopValue(base, node, "textStyle.align"), "center");
  assert.deepEqual(panel.freeMobileFieldValue(base, node, "textStyle.align"), { own: false, value: "center" });

  // Esquerda so no celular: a forma canonica guarda (nao e igual ao computador) e o celular desenha no inicio.
  const esquerda = design([botao, LINKS], { devices: { mobile: { nodes: { botao: { textStyle: { align: "left" } } } } } });
  assert.deepEqual(esquerda.devices, { mobile: { nodes: { botao: { textStyle: { align: "left" } } } } });
  assert.ok(schema.popupFreeDesignSchema.safeParse(esquerda).success);
  const noCelular = model.findFreeNode(render.resolveFreeForDevice(esquerda, "mobile"), "botao").node;
  assert.equal(styles.freeButtonLayoutCss(noCelular).justifyContent, "flex-start");
  assert.equal(styles.freeButtonLayoutCss(model.findFreeNode(esquerda, "botao").node).justifyContent, "center", "o computador continua no centro");

  // Centro no celular e igual ao desenhado no computador: sai ao salvar. Com Direita no computador, o Esquerda fica.
  assert.equal(design([botao, LINKS], { devices: { mobile: { nodes: { botao: { textStyle: { align: "center" } } } } } }).devices, undefined);
  const direita = design([{ ...botao, textStyle: { align: "right" } }, LINKS], { devices: { mobile: { nodes: { botao: { textStyle: { align: "left" } } } } } });
  assert.deepEqual(direita.devices, { mobile: { nodes: { botao: { textStyle: { align: "left" } } } } });
  assert.equal(panel.freeMobileDesktopValue(direita, model.findFreeNode(direita, "botao").node, "textStyle.align"), "right");
});

test("aba Celular: entrar nela liga o Ver como Celular; sair dela mantém o aparelho", () => {
  assert.equal(panel.freeDeviceAfterTabChange("mobile", "content", "desktop"), "mobile");
  assert.equal(panel.freeDeviceAfterTabChange("mobile", "advanced", "mobile"), "mobile");
  assert.equal(panel.freeDeviceAfterTabChange("content", "mobile", "mobile"), "mobile", "sair da aba Celular nao volta ao Computador");
  assert.equal(panel.freeDeviceAfterTabChange("style", "content", "desktop"), "desktop");
  assert.equal(panel.freeDeviceAfterTabChange("advanced", "style", "mobile"), "mobile");
  assert.equal(panel.freeDeviceAfterTabChange("mobile", "mobile", "desktop"), "desktop", "ja estava na aba: o Ver como escolhido depois fica");

  // O painel do elemento usa a mesma regra.
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-inspector.tsx", import.meta.url), "utf8");
  assert.match(source, /const nextDevice = freeDeviceAfterTabChange\(value as ElementTab, tab, device\);/);
});

test("painel Pop-up desenhado: o grupo No celular com Igual ao computador em cada campo", () => {
  function draw(value, errors = {}) {
    return renderToStaticMarkup(createElement(FreeArtboardSettings, { design: value, disabled: false, errors, fonts: [], hints: [], latest: () => value, onBusyChange() {}, onChange() {}, onFontsChange() {}, rects: {} }));
  }

  const same = draw(design([LINKS]));
  assert.ok(same.includes(">No celular<"));
  assert.deepEqual(same.match(/aria-label="[^"]*: igual ao computador"/g), [
    'aria-label="Respiro interno: igual ao computador"',
    'aria-label="Espaço entre os elementos: igual ao computador"',
    'aria-label="Altura mínima em px: igual ao computador"'
  ]);
  assert.equal((same.match(/aria-checked="true" aria-label="[^"]*: igual ao computador"/g) ?? []).length, 3);
  assert.match(same, /id="livre-popup-celular-respiro"/);

  const own = draw(design([LINKS], { devices: { mobile: { artboard: { padding: 12 } } } }), { "devices.mobile.artboard.padding": "Use de 0 a 200." });
  assert.match(own, /aria-checked="false" aria-label="Respiro interno: igual ao computador"/);
  assert.ok(own.includes("Use de 0 a 200."));
});

test("Fundo desenhado: a faixa Ordem só com 2 ou 3 camadas, com fichas que se arrastam e os ids do foco", () => {
  function draw(value) {
    return renderToStaticMarkup(createElement(FreeArtboardSettings, { design: value, disabled: false, errors: {}, fonts: [], hints: [], latest: () => value, onBusyChange() {}, onChange() {}, onFontsChange() {}, rects: {} }));
  }

  // Uma camada (o padrão da prancheta): sem faixa.
  const one = draw(design([LINKS]));
  assert.equal(one.includes("data-free-fill-grip"), false);
  assert.equal(one.includes("Ordem das camadas de fundo"), false);
  assert.match(one, /id="livre-popup-fundo-acrescentar"/);

  const two = draw(design([LINKS], { artboard: { fill: [VERMELHO, AZUL] } }));
  assert.match(two, /<ol aria-label="Ordem das camadas de fundo"/);
  assert.ok(two.includes(">Ordem<"));
  assert.equal((two.match(/data-free-fill-grip="/g) ?? []).length, 2);
  assert.deepEqual(two.match(/aria-label="Mover [^"]+"/g), [
    'aria-label="Mover Camada 1: Cor. Arraste ou use Alt e as setas."',
    'aria-label="Mover Camada 2: Cor. Arraste ou use Alt e as setas."'
  ]);
  assert.equal((two.match(/aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/g) ?? []).length, 2);
  for (const fieldId of ["livre-popup-fundo-0-ordem", "livre-popup-fundo-0-subir", "livre-popup-fundo-0-descer", "livre-popup-fundo-0-tirar", "livre-popup-fundo-1-ordem", "livre-popup-fundo-acrescentar"]) {
    assert.match(two, new RegExp(`id="${fieldId}"`), fieldId);
  }
  // A ficha tem touch-action: none (a caneta arrasta sem rolar o painel) e a amostra da cor.
  assert.match(two, /<button[^>]*class="[^"]*touch-none[^"]*select-none[^"]*"[^>]*data-free-fill-grip="0"/);
  assert.ok(two.includes("background-image:linear-gradient(90deg, #ff0000 0%, #ff0000 100%)"));
  // Subir na de cima e Descer na de baixo desligados; a região que fala a mudança já está montada.
  assert.match(two, /<button[^>]*disabled=""[^>]*id="livre-popup-fundo-0-subir"|<button[^>]*id="livre-popup-fundo-0-subir"[^>]*disabled=""/);
  assert.match(two, /<button[^>]*disabled=""[^>]*id="livre-popup-fundo-1-descer"|<button[^>]*id="livre-popup-fundo-1-descer"[^>]*disabled=""/);
  assert.match(two, /<div aria-live="polite" class="sr-only" data-free-fill-status="" role="status">/);

  // Três camadas: o + Camada desliga (o foco vai para a ficha da nova; ver freeFillFocusAfter).
  const three = draw(design([LINKS], { artboard: { fill: TRES } }));
  assert.equal((three.match(/data-free-fill-grip="/g) ?? []).length, 3);
  assert.match(three, /<button[^>]*disabled=""[^>]*id="livre-popup-fundo-acrescentar"|<button[^>]*id="livre-popup-fundo-acrescentar"[^>]*disabled=""/);
});

test("aba Celular desenhada: a frase, Voltar tudo, uma chave com nome por campo e o valor próprio", () => {
  function draw(value, id, errors = {}) {
    const content = { allowSnooze: true, audio: null, cta: null, onAllowSnoozeChange() {}, onCtaChange() {}, products: [], productsLoaded: true, snoozeMinutes: 1_440, title: "Aula nova" };
    const props = { content, design: value, disabled: false, errors, fonts: [], hints: [], latest: () => value, node: model.findFreeNode(value, id).node, onBusyChange() {}, onChange() {}, onCtaChange() {}, onFontsChange() {}, onReset() {}, rects: {} };

    return renderToStaticMarkup(createElement(FreeInspectorMobile, props));
  }

  const same = draw(design([TITULO, LINKS]), "titulo");
  assert.ok(same.includes("O que não mudar aqui encolhe como no computador (texto nunca abaixo de 12 px)."));
  assert.match(same, /<button[^>]*disabled=""[^>]*data-free-mobile-reset=""|<button[^>]*data-free-mobile-reset=""[^>]*disabled=""/, "sem nada no celular, Voltar tudo fica desligado");
  assert.ok(same.includes("Voltar tudo ao do computador"));
  assert.match(same, /aria-checked="true" aria-label="Tamanho: igual ao computador"/);
  assert.match(same, /aria-label="Esconder no celular: igual ao computador"/);
  assert.match(same, /id="livre-titulo-celular-tamanho-texto"/);
  assert.equal((same.match(/data-free-mobile-field="own"/g) ?? []).length, 0);
  for (const word of ["Mostrar", "Posição", "Texto", "Respiro e cantos"]) {
    assert.ok(same.includes(`>${word}<`), word);
  }

  const own = draw(design([TITULO, LINKS], { devices: { mobile: { nodes: { titulo: { textStyle: { size: 28 } } } } } }), "titulo", { "devices.mobile.nodes.titulo.textStyle.size": "Use de 10 a 160." });
  assert.match(own, /aria-checked="false" aria-label="Tamanho: igual ao computador"/);
  assert.equal((own.match(/data-free-mobile-field="own"/g) ?? []).length, 1);
  assert.match(own, /value="28"/);
  assert.ok(own.includes("Use de 10 a 160."), "o erro do campo do celular aparece no campo");
  assert.doesNotMatch(own, /<button[^>]*disabled=""[^>]*data-free-mobile-reset=""|<button[^>]*data-free-mobile-reset=""[^>]*disabled=""/);

  // O erro do celular que nao e de um campo da tela (o modo trocado, colado de fora) aparece no topo da aba; o de outro
  // elemento (mesmo com o id comecando igual) nao.
  const mode = draw(design([TITULO, { ...TITULO, id: "titulo2" }, LINKS]), "titulo", {
    "devices.mobile.nodes.titulo.place.mode": M.mobilePlace,
    "devices.mobile.nodes.titulo2.textStyle.size": "Use de 10 a 160."
  });
  assert.ok(mode.includes(M.mobilePlace));
  assert.equal(mode.includes("Use de 10 a 160."), false);
});

test("vocabulário das frases do painel", () => {
  const strings = [
    ...collectStrings(C),
    ...collectStrings(panel.FREE_IMAGE_COPY_PROBLEMS),
    ...Object.values(panel)
      .filter((value) => Array.isArray(value) && value.every((entry) => entry && typeof entry === "object" && "label" in entry))
      .flatMap((options) => options.map((option) => option.label)),
    ...collectStrings(panel.FREE_ALIGN_LABELS),
    ...panel.freeFlowHeightOptions(true).map((option) => option.label),
    ...panel.freeFlowHeightOptions(false).map((option) => option.label)
  ];

  assert.ok(strings.length > 150);

  for (const text of strings) {
    for (const word of PROIBIDAS_NAS_FRASES) {
      assert.equal(new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "iu").test(text), false, `“${text}” usa “${word}”`);
    }
  }

  // Frases da spec, palavra por palavra.
  assert.equal(C.text.styleSelection, "Outro estilo na seleção");
  assert.equal(C.text.parts, "Partes com estilo próprio");
  assert.equal(C.image.hint, "JPG, PNG ou WebP. O editor deixa leve sozinho; transparência funciona.");
  assert.equal(C.video.hint, "MP4 (H.264) ou WEBM, até 15 MB. Toca sem som, em repetição. Quem prefere menos movimento vê só a capa.");
  // Links › Conteúdo (docs/27 §13.7): a chave do "Lembrar depois" e a MESMA do card "Quantas vezes e como fecha".
  assert.equal(C.links.snooze, "Permitir “Lembrar depois”");
  assert.equal(C.links.snooze, popupEditor.POPUP_EDITOR_COPY.frequency.snoozeLabel, "o mesmo nome do card");
  assert.equal(C.links.dismiss, "Mostrar “Não mostrar de novo”");
  assert.equal(C.links.snoozeOff, "Sem “Lembrar depois”, o pop-up volta só pela regra de “Quantas vezes”.");
  assert.equal(panel.freeLinksSnoozeDescription(true, 1_440), "Volta em 1 dia, até 2 vezes.");
  assert.equal(panel.freeLinksSnoozeDescription(true, 1_440), popupEditor.snoozeSwitchDescription(1_440), "ligada, a mesma frase do card");
  assert.equal(panel.freeLinksSnoozeDescription(true, 90), "Volta em 90 minutos, até 2 vezes.");
  assert.equal(panel.freeLinksSnoozeDescription(false, 1_440), C.links.snoozeOff);
  assert.equal("snoozeNote" in C.links, false, "a nota fixa de antes saiu: a chave esta no painel");
  assert.equal(C.advanced.freeHint, "Solta: você escolhe o lugar. Só fora de caixas.");
  assert.equal(C.advanced.layerNote, "Quem vem depois nas Camadas fica por cima; aqui você muda isso.");
  assert.equal(C.popup.widthNote, "No celular, o pop-up inteiro encolhe junto, igual.");
  assert.equal(C.popup.closeNote, "O X fica sempre por cima e sempre funciona.");
  assert.equal(panel.freeRangeMessage({ max: 160, min: 10 }), "Use de 10 a 160.");
  // Aba Celular e o grupo "No celular" (docs/27 §13.8).
  assert.equal(C.tabs.mobile, "Celular");
  assert.equal(C.mobile.same, "Igual ao computador");
  assert.equal(C.mobile.sameLabel("Tamanho"), "Tamanho: igual ao computador");
  assert.equal(C.mobile.reset, "Voltar tudo ao do computador");
  assert.equal(C.mobile.note, "O que não mudar aqui encolhe como no computador (texto nunca abaixo de 12 px).");
  assert.equal(C.mobile.popupTitle, "No celular");
  assert.equal(C.mobile.hidden, "Esconder no celular");

  // Contorno e marca-texto (L6b): as frases do plano, sem o nome do campo do JSON nas frases.
  assert.deepEqual([C.style.stroke, C.style.strokeWidth, C.style.strokeColor, C.style.strokeOnly], ["Contorno", "Espessura", "Cor do contorno", "Só o contorno (texto vazado)"]);
  assert.deepEqual(
    [C.span.stroke, C.span.mark, C.span.markColor, C.span.markPaddingY, C.span.markPaddingX, C.span.markRadius],
    ["Contorno", "Marca-texto", "Cor do marca-texto", "Respiro em cima e embaixo", "Respiro dos lados", "Cantos do marca-texto"]
  );
  for (const text of [...collectStrings(C.style), ...collectStrings(C.span)]) {
    assert.doesNotMatch(text, /\b(?:stroke|mark|outline|highlight)\b/i, text);
  }

  // Cores ao passar o mouse (L6c): as frases do plano, sem o nome do campo do JSON.
  assert.deepEqual(
    [C.hover.title, C.hover.fill, C.hover.color, C.hover.borderColor, C.hover.linksColor, C.hover.reset],
    ["Ao passar o mouse", "Fundo", "Cor do texto", "Cor da borda", "Cor", "Voltar ao padrão"]
  );
  assert.equal(C.hover.note, "Vale também quando o aluno chega pelo teclado. No celular não tem mouse.");
  assert.equal(C.hover.buttonDefault, "Sem cores próprias, o botão clareia um pouco quando o mouse passa.");
  assert.equal(C.hover.resetLabel("Fundo"), "Fundo: voltar ao padrão");
  for (const text of collectStrings(C.hover)) {
    assert.doesNotMatch(text, /\b(?:hover|fill|border|color|preview)\b/i, text);
  }

  // As telas do painel: o texto que aparece direto no JSX e nos aria-label escritos à mão também.
  for (const url of UI_FILES) {
    const source = readFileSync(url, "utf8");
    const visible = [
      ...[...source.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)].map((match) => match[1]),
      ...[...source.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])
    ];

    for (const text of visible) {
      for (const word of PROIBIDAS) {
        assert.equal(new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "iu").test(text), false, `${url.pathname.split("/").at(-1)}: “${text}” usa “${word}”`);
      }
    }
  }
});
