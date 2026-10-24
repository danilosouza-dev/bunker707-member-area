import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Editor Livre do pop-up (docs/27; spec §4.6, §4.7, §7.1 e §9.6; docs/18 §1.1), pacote I: as pecas puras do painel
// da direita. A area de texto (Enter, limite de linhas), "Outro estilo na seleção" (antes / selecao / depois, com
// acentos, emoji e letras combinadas), editar o texto mantendo o estilo das partes, "Voltar ao estilo do elemento",
// as paradas do degradê, as camadas de fundo, os lados, as sombras com os atalhos, o mapa chave -> aba/campo, o
// "Abrir um link" so um, a largura com a reescala, os pesos de cada fonte, a conta da imagem e o vocabulario.

const panel = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");

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

test("Abrir um link desliga quando outro botão já abre um link", () => {
  const value = design([
    { action: { href: "https://exemplo.com", kind: "link", target: "new_tab" }, id: "link", label: "Ver", type: "button" },
    { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" },
    LINKS
  ]);

  // O outro botão não pode virar link; o próprio botão de link pode continuar.
  assert.equal(panel.freeLinkActionDisabledReason(value, "fechar"), "Use um botão “Abrir um link” só.");
  assert.equal(panel.freeLinkActionDisabledReason(value, "link"), null);
  assert.equal(M.linkButtons, "Use um botão “Abrir um link” só.");

  // Sem link nenhum, pode.
  const free = design([{ action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" }, LINKS]);
  assert.equal(panel.freeLinkActionDisabledReason(free, "fechar"), null);

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
  "free-artboard-settings.tsx",
  "free-fields.tsx",
  "free-assets.ts"
].map((name) => new URL(`../src/components/admin/v2/communication/popup-free/${name}`, import.meta.url));

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
  assert.equal(C.links.snoozeNote, "“Lembrar depois” aparece sozinho quando o pop-up deixa adiar.");
  assert.equal(C.advanced.freeHint, "Solta: você escolhe o lugar. Só fora de caixas.");
  assert.equal(C.advanced.layerNote, "Quem vem depois nas Camadas fica por cima; aqui você muda isso.");
  assert.equal(C.popup.widthNote, "No celular, o pop-up inteiro encolhe junto, igual.");
  assert.equal(C.popup.closeNote, "O X fica sempre por cima e sempre funciona.");
  assert.equal(panel.freeRangeMessage({ max: 160, min: 10 }), "Use de 10 a 160.");

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
