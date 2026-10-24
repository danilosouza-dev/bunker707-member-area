import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Editor Livre do pop-up (docs/27; spec §4.2 a §4.9 e §7.1; docs/18 §1.1), pacote E: as pecas puras da casca,
// do palco, dos Elementos e das Camadas. Onde um elemento novo entra, duplicar, excluir, subir/descer e as caixas,
// soltar e seguir a sequencia sem mexer no que se ve, as setas, redimensionar (com Shift e girado), alinhar no
// pop-up, as guias, a escala do zoom e do celular, o arrastar que so muda o design no fim, o historico, a copia de
// recuperacao, o teclado das Camadas e o vocabulario. Tudo carregado direto pelo Node.

const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const geometry = await import("../src/components/admin/v2/communication/popup-free/free-editor-geometry.ts");
const history = await import("../src/components/admin/v2/communication/popup-free/free-editor-history.ts");
const recovery = await import("../src/components/admin/v2/communication/popup-free/free-editor-recovery.ts");
const model = await import("../src/server/communications/popup-free-model.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const inspector = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const designEditor = await import("../src/components/admin/v2/communication/popup-design/popup-design-editor-model.ts");
const noticeSchemas = await import("../src/server/communications/schemas.ts");
const noticeView = await import("../src/components/admin/v2/communication/notices-view-model.ts");

const M = schema.POPUP_FREE_MESSAGES;
const C = editor.FREE_EDITOR_COPY;
const CTA = { href: "/minhas-compras", label: "Quero ver", target: "new_tab" };
const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete", "fluxo"];

function design(children, extra = {}) {
  return model.canonicalPopupFreeDesign({ children, mode: "free", version: 1, ...extra });
}

const TITLE = { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" };
const TEXT = { id: "texto", lines: [[{ text: "Assista hoje." }]], type: "text" };
const CTA_NODE = { action: { kind: "cta" }, id: "principal", type: "button" };
const LINKS = { id: "links", type: "links" };
const AUDIO = { id: "audio", type: "audio" };

function ids(nodes) {
  return nodes.map((node) => node.id);
}

function find(value, id) {
  return model.findFreeNode(value, id);
}

test("adicionar entra na caixa selecionada, depois do selecionado ou no fim antes dos links", () => {
  const box = { children: [{ id: "selo", label: "Novo", type: "badge" }], id: "caixa", layout: { dir: "row", gap: 8 }, type: "box" };
  const base = design([TITLE, box, TEXT, LINKS]);

  // Sem selecao: no fim da prancheta, antes dos Links.
  const none = editor.addFreeElement(base, "heading");
  assert.equal(none.id, "titulo2");
  assert.deepEqual(ids(none.design.children), ["titulo", "caixa", "texto", "titulo2", "links"]);
  assert.equal(editor.freeAddedAnnouncement("heading"), "Título adicionado.");
  assert.equal(editor.freeAddedAnnouncement("image"), "Imagem adicionada.");

  // Caixa selecionada: no fim dela.
  const inBox = editor.addFreeElement(base, "text", { selectedId: "caixa" });
  assert.deepEqual(ids(find(inBox.design, "caixa").node.children), ["selo", inBox.id]);

  // Elemento da sequencia selecionado: logo depois dele, na mesma caixa.
  const afterBadge = editor.addFreeElement(base, "badge", { selectedId: "selo" });
  assert.deepEqual(ids(find(afterBadge.design, "caixa").node.children), ["selo", afterBadge.id]);
  const afterTitle = editor.addFreeElement(base, "divider", { selectedId: "titulo" });
  assert.deepEqual(ids(afterTitle.design.children), ["titulo", afterTitle.id, "caixa", "texto", "links"]);

  // Solto selecionado ou elemento solto novo (Forma, Degradê): na prancheta, antes dos Links.
  const loose = design([{ ...TITLE, place: { mode: "free", w: 200, x: 10, y: 10 } }, LINKS]);
  assert.deepEqual(ids(editor.addFreeElement(loose, "text", { selectedId: "titulo" }).design.children), ["titulo", "texto", "links"]);
  const shape = editor.addFreeElement(base, "shape", { center: { x: 220, y: 100 }, selectedId: "selo" });
  assert.deepEqual(ids(shape.design.children), ["titulo", "caixa", "texto", shape.id, "links"]);
  assert.deepEqual(find(shape.design, shape.id).node.place, { h: 120, mode: "free", w: 120, x: 160, y: 40 });

  // Caixa nova dentro de uma caixa de dentro passaria da profundidade: entra logo depois dela.
  const nested = design([{ children: [{ children: [], id: "dentro", type: "box" }], id: "fora", type: "box" }, LINKS]);
  const boxInInner = editor.addFreeElement(nested, "row", { selectedId: "dentro" });
  assert.deepEqual(ids(find(boxInInner.design, "fora").node.children), ["dentro", boxInInner.id]);
  assert.equal(find(boxInInner.design, boxInInner.id).depth, 2);
  assert.ok(schema.popupFreeDesignSchema.safeParse(boxInInner.design).success);

  // Caixa cheia (20): sobe um nivel.
  const full = design([{ children: Array.from({ length: 20 }, (_, index) => ({ id: `e${index}`, type: "spacer" })), id: "cheia", type: "box" }, LINKS]);
  const overflow = editor.addFreeElement(full, "spacer", { selectedId: "cheia" });
  assert.deepEqual(ids(overflow.design.children), ["cheia", overflow.id, "links"]);

  // Limites: o botao desliga com a frase.
  const thirtyTwo = design([...Array.from({ length: 31 }, (_, index) => ({ id: `s${index}`, type: "spacer" })), LINKS]);
  assert.equal(editor.freeElementDisabledReason(thirtyTwo, "heading"), "Use até 32 elementos.");
  assert.deepEqual(editor.addFreeElement(thirtyTwo, "heading"), { reason: "Use até 32 elementos." });
  const withCta = design([TITLE, CTA_NODE, LINKS]);
  assert.equal(editor.freeElementDisabledReason(withCta, "cta"), "O pop-up já tem o botão principal.");
  assert.equal(editor.freeElementDisabledReason(withCta, "button"), null);
  const withVideo = design([{ asset: null, id: "video", type: "video" }, LINKS]);
  assert.equal(editor.freeElementDisabledReason(withVideo, "video"), "Use um vídeo só por pop-up.");
  const fourTitles = design([1, 2, 3, 4].map((n) => ({ ...TITLE, id: `t${n}` })).concat(LINKS));
  assert.equal(editor.freeElementDisabledReason(fourTitles, "heading"), M.headings);

  // O Botão principal novo cria "Saiba mais" com o destino vazio quando o aviso nao tem botao.
  assert.deepEqual(editor.freeCtaForNewButton(null), { href: "", label: "Saiba mais", target: "same_tab" });
  assert.equal(editor.freeCtaForNewButton(CTA), CTA);
});

test("adicionar Imagem ou Vídeo pede o foco no envio", () => {
  const base = design([TITLE, LINKS]);
  const image = editor.addFreeElement(base, "image");
  const video = editor.addFreeElement(base, "video");
  const title = editor.addFreeElement(base, "heading");

  assert.deepEqual(editor.freeFocusAfterAdd(image.node), { intent: "upload", key: `nodes.${image.id}.asset` });
  assert.deepEqual(editor.freeFocusAfterAdd(video.node), { intent: "upload", key: `nodes.${video.id}.asset` });
  assert.deepEqual(editor.freeFocusAfterAdd(title.node), { key: `nodes.${title.id}` });
  assert.equal(find(image.design, image.id).node.asset, null);
});

test("duplicar cria ids novos e o principal duplicado vira Abrir um link, só se ainda não há um", () => {
  const box = { children: [{ ...TITLE, id: "t1" }, { ...TEXT, id: "x1" }], id: "caixa", type: "box" };
  const base = design([box, CTA_NODE, LINKS]);
  const copy = editor.duplicateFreeNode(base, "caixa", CTA);
  const all = [];

  model.walkFreeNodes(copy.design.children, (node) => all.push(node.id));
  assert.equal(new Set(all).size, all.length, "ids unicos");
  assert.deepEqual(ids(copy.design.children), ["caixa", copy.id, "principal", "links"]);
  assert.equal(find(copy.design, copy.id).node.children.length, 2);
  assert.ok(schema.popupFreeDesignSchema.safeParse(copy.design).success);

  const fromCta = editor.duplicateFreeNode(base, "principal", CTA);
  const link = find(fromCta.design, fromCta.id).node;
  assert.deepEqual(link.action, { href: "/minhas-compras", kind: "link", target: "new_tab" });
  assert.equal(link.label, "Quero ver");
  assert.equal(editor.freeHasLinkButton(fromCta.design), true);

  // Ja existe um "Abrir um link": duplicar o principal (ou o link) desliga.
  assert.deepEqual(editor.duplicateFreeNode(fromCta.design, "principal", CTA), { reason: "Use um botão “Abrir um link” só." });
  assert.equal(editor.freeDuplicateProblem(fromCta.design, fromCta.id), "Use um botão “Abrir um link” só.");

  // Links, Áudio e Vídeo nao duplicam.
  assert.equal(editor.freeDuplicateProblem(base, "links"), M.linksDuplicate);
  assert.equal(editor.freeDuplicateProblem(design([AUDIO, LINKS]), "audio"), M.audioDuplicate);
  assert.equal(editor.freeDuplicateProblem(design([{ asset: null, id: "video", type: "video" }, LINKS]), "video"), M.videoDuplicate);

  // Solto duplicado anda 16 px.
  const loose = design([{ box: { fill: [{ color: "#ffffff26", kind: "solid" }] }, id: "forma", place: { h: 50, mode: "free", w: 50, x: 10, y: 20 }, type: "shape" }, LINKS]);
  const looseCopy = editor.duplicateFreeNode(loose, "forma", null);
  assert.deepEqual(find(looseCopy.design, looseCopy.id).node.place, { h: 50, mode: "free", w: 50, x: 26, y: 36 });
});

test("excluir: links e áudio não saem; o principal tira o botão do aviso", () => {
  const base = design([TITLE, { children: [AUDIO], id: "caixa", type: "box" }, CTA_NODE, LINKS]);

  assert.deepEqual(editor.removeFreeNode(base, "links"), { reason: C.canNotRemove.links });
  assert.deepEqual(editor.removeFreeNode(base, "audio"), { reason: C.canNotRemove.audio });
  assert.deepEqual(editor.removeFreeNode(base, "caixa"), { reason: C.canNotRemove.audio }, "a caixa com o Áudio dentro também fica");
  // docs/27 §13.7: os links nao se excluem (o contrato pede um Links), mas cada um se tira pela chave em Conteúdo.
  assert.equal(C.canNotRemove.links, "Os links ficam no desenho, mas cada um se tira em Conteúdo: desligue “Permitir Lembrar depois” ou “Mostrar Não mostrar de novo”.");
  assert.equal(C.canNotRemove.audio, "Para tirar o áudio, tire o arquivo no campo Áudio do aviso.");

  const noCta = editor.removeFreeNode(base, "principal");
  assert.equal(noCta.ctaRemoved, true);
  assert.equal(editor.freeCtaNode(noCta.design), null);

  const noTitle = editor.removeFreeNode(base, "titulo");
  assert.equal(noTitle.ctaRemoved, false);
  assert.deepEqual(ids(noTitle.design.children), ["caixa", "principal", "links"]);
});

test("subir, descer, colocar dentro e tirar da caixa respeitam a profundidade", () => {
  const inner = { children: [], id: "dentro", type: "box" };
  const outer = { children: [{ ...TEXT, id: "x1" }, inner], id: "fora", type: "box" };
  const other = { children: [{ children: [], id: "neta", type: "box" }], id: "outra", type: "box" };
  const base = design([TITLE, outer, other, LINKS]);

  // Subir e descer entre os irmaos; nas pontas, nada.
  assert.deepEqual(ids(editor.moveFreeNodeInList(base, "fora", -1).children), ["fora", "titulo", "outra", "links"]);
  assert.deepEqual(ids(editor.moveFreeNodeInList(base, "titulo", 1).children), ["fora", "titulo", "outra", "links"]);
  assert.equal(editor.moveFreeNodeInList(base, "titulo", -1), null);
  assert.equal(editor.moveFreeNodeInList(base, "links", 1), null);

  // Colocar dentro: um elemento simples vai para qualquer caixa (menos a sua); uma caixa com caixa dentro nao entra em
  // caixa nenhuma; uma caixa simples nao entra numa caixa de dentro.
  assert.deepEqual(
    editor.freeBoxTargets(base, "titulo").map((target) => target.id),
    ["fora", "dentro", "outra", "neta"]
  );
  assert.deepEqual(editor.freeBoxTargets(base, "outra"), []);
  assert.deepEqual(editor.freeBoxTargets(base, "dentro").map((target) => target.id), ["outra"]);
  assert.equal(editor.moveFreeNodeIntoBox(base, "outra", "fora"), null);

  const moved = editor.moveFreeNodeIntoBox(base, "titulo", "dentro");
  assert.deepEqual(ids(find(moved.design, "dentro").node.children), ["titulo"]);
  assert.equal(find(moved.design, "titulo").depth, 3);
  assert.equal(moved.becameFlow, false);
  assert.ok(schema.popupFreeDesignSchema.safeParse(moved.design).success);

  // Um solto colocado numa caixa vira sequencia sozinho.
  const loose = design([{ ...TITLE, place: { mode: "free", w: 200, x: 5, y: 5, z: 2 } }, { children: [], id: "caixa", type: "box" }, LINKS]);
  const flowed = editor.moveFreeNodeIntoBox(loose, "titulo", "caixa");
  assert.equal(flowed.becameFlow, true);
  assert.deepEqual(find(flowed.design, "titulo").node.place, { mode: "flow", z: 2 });

  // Tirar da caixa: logo depois dela, na caixa de fora.
  const out = editor.moveFreeNodeOutOfBox(moved.design, "titulo");
  assert.deepEqual(ids(find(out, "fora").node.children), ["x1", "dentro", "titulo"]);
  const outRoot = editor.moveFreeNodeOutOfBox(out, "titulo");
  assert.deepEqual(ids(outRoot.children), ["fora", "titulo", "outra", "links"]);
  assert.equal(editor.moveFreeNodeOutOfBox(outRoot, "titulo"), null);

  // Esc: a caixa de fora, depois nada.
  assert.equal(editor.freeParentId(moved.design, "titulo"), "dentro");
  assert.equal(editor.freeParentId(moved.design, "fora"), null);
});

test("soltar e seguir a sequência mantêm o lugar na tela", () => {
  const box = { children: [{ asset: null, id: "img", type: "image" }, { ...TEXT, id: "x1" }], id: "caixa", type: "box" };
  const base = design([TITLE, box, TEXT, LINKS]);
  const rects = {
    "@artboard": { h: 400, w: 440, x: 0, y: 0 },
    caixa: { h: 180, w: 392, x: 24, y: 80 },
    img: { h: 120.4, w: 392, x: 24, y: 80 },
    links: { h: 20, w: 392, x: 24, y: 330 },
    texto: { h: 40, w: 392, x: 24, y: 272 },
    titulo: { h: 44, w: 392, x: 24, y: 24 },
    x1: { h: 40, w: 392, x: 24, y: 212 }
  };

  // Soltar a imagem de dentro da caixa: vai para a prancheta logo depois da caixa, no mesmo lugar, com a altura medida.
  const freed = editor.freeNodeToFree(base, "img", rects);
  assert.deepEqual(ids(freed.children), ["titulo", "caixa", "img", "texto", "links"]);
  assert.deepEqual(find(freed, "img").node.place, { h: 120, mode: "free", w: 392, x: 24, y: 80 });
  assert.ok(schema.popupFreeDesignSchema.safeParse(freed).success);

  // Soltar um texto: altura automatica (o texto empurra).
  const freedText = editor.freeNodeToFree(base, "texto", rects);
  assert.deepEqual(find(freedText, "texto").node.place, { mode: "free", w: 392, x: 24, y: 272 });
  assert.deepEqual(ids(freedText.children), ["titulo", "caixa", "texto", "links"]);

  // Seguir a sequencia: logo antes do primeiro da sequencia cujo topo esta abaixo do topo dele.
  const back = editor.freeNodeToSequence(freed, "img", { ...rects, img: { h: 120, w: 392, x: 24, y: 70 } });
  assert.deepEqual(ids(back.children), ["titulo", "img", "caixa", "texto", "links"]);
  assert.equal(find(back, "img").node.place, undefined);
  const low = editor.freeNodeToSequence(freed, "img", { ...rects, img: { h: 120, w: 392, x: 24, y: 300 } });
  assert.deepEqual(ids(low.children), ["titulo", "caixa", "texto", "img", "links"]);
  const bottom = editor.freeNodeToSequence(freed, "img", { ...rects, img: { h: 10, w: 10, x: 0, y: 390 } });
  assert.deepEqual(ids(bottom.children), ["titulo", "caixa", "texto", "links", "img"]);
  assert.equal(editor.freeNodeToSequence(base, "titulo", rects), null, "quem ja segue a sequencia fica");
});

test("setas movem 1 e 10 px e não mexem em travados", () => {
  const base = design([{ ...TITLE, place: { mode: "free", w: 200, x: 10, y: 10 } }, { ...TEXT, locked: true, place: { mode: "free", w: 200, x: 0, y: 100 } }, LINKS]);
  const one = editor.nudgeFreeNode(base, "titulo", 1, 0);
  const ten = editor.nudgeFreeNode(one, "titulo", 0, -10);

  assert.deepEqual(find(one, "titulo").node.place, { mode: "free", w: 200, x: 11, y: 10 });
  assert.deepEqual(find(ten, "titulo").node.place, { mode: "free", w: 200, x: 11, y: 0 });
  assert.equal(editor.nudgeFreeNode(base, "texto", 10, 10), base, "travado nao anda");
  assert.equal(editor.nudgeFreeNode(base, "links", 1, 1), base, "na sequencia nao anda");

  // Dentro dos limites do design.
  const edge = design([{ ...TITLE, place: { mode: "free", w: 200, x: -720, y: -400 } }, LINKS]);
  assert.equal(editor.nudgeFreeNode(edge, "titulo", -10, -10), edge);
  assert.equal(C.announce.position(11, 0), "X 11, Y 0.");
  assert.equal(C.announce.size(120, 80), "Largura 120, altura 80.");
});

test("redimensionar com Shift mantém a proporção e respeita o mínimo", () => {
  const rect = { h: 50, w: 100, x: 10, y: 10 };

  assert.deepEqual(geometry.resizeFreeRect(rect, "se", 20, 10), { h: 60, w: 120, x: 10, y: 10 });
  assert.deepEqual(geometry.resizeFreeRect(rect, "nw", 20, 10), { h: 40, w: 80, x: 30, y: 20 });
  // Shift no canto: vale o maior dos dois movimentos e a proporcao 2:1 fica.
  assert.deepEqual(geometry.resizeFreeRect(rect, "se", 50, 0, { keepRatio: true }), { h: 75, w: 150, x: 10, y: 10 });
  assert.deepEqual(geometry.resizeFreeRect(rect, "e", 100, 0, { keepRatio: true }), { h: 100, w: 200, x: 10, y: 10 });
  assert.deepEqual(geometry.resizeFreeRect(rect, "n", 0, -50, { keepRatio: true }), { h: 100, w: 200, x: 10, y: -40 });
  // Minimo de 4 px, sem passar do lado parado.
  assert.deepEqual(geometry.resizeFreeRect(rect, "w", 500, 0), { h: 50, w: 4, x: 106, y: 10 });
  assert.deepEqual(geometry.resizeFreeRect(rect, "s", 0, -500), { h: 4, w: 100, x: 10, y: 10 });
  const tiny = geometry.resizeFreeRect(rect, "se", -500, -500, { keepRatio: true });
  assert.ok(tiny.w >= 4 && tiny.h >= 4 && Math.abs(tiny.w / tiny.h - 2) < 1e-9);

  // Girado 90°: puxar a alca da direita (que na tela aponta para baixo) cresce a largura e o lado oposto fica parado.
  const turned = geometry.resizeRotatedFreeRect(rect, 90, "e", 0, 20);
  assert.equal(Math.round(turned.w), 120);
  assert.equal(Math.round(turned.h), 50);
  // O centro desce 10 px na tela (o lado de cima, girado, fica parado).
  assert.equal(Math.round(turned.x + turned.w / 2), 60);
  assert.equal(Math.round(turned.y + turned.h / 2), 45);
});

test("alinhar no pop-up: esquerda, centro, direita, em cima, no meio e embaixo pelo retângulo medido", () => {
  const base = design([{ ...TEXT, place: { mode: "free", w: 100, x: 33, y: 47 } }, { ...TITLE, locked: true, place: { mode: "free", w: 100, x: 1, y: 1 } }, LINKS]);
  const rects = { "@artboard": { h: 300, w: 440, x: 0, y: 0 }, texto: { h: 40, w: 100, x: 33, y: 47 } };
  const placeAfter = (edge) => find(editor.alignFreeNode(base, "texto", edge, rects), "texto").node.place;

  assert.equal(placeAfter("left").x, 0);
  assert.equal(placeAfter("center").x, 170);
  assert.equal(placeAfter("right").x, 340);
  assert.equal(placeAfter("top").y, 0);
  assert.equal(placeAfter("middle").y, 130);
  assert.equal(placeAfter("bottom").y, 260);
  assert.equal(placeAfter("center").y, 47, "alinhar ao centro nao mexe no Y");
  assert.equal(editor.alignFreeNode(base, "titulo", "left", { ...rects, titulo: { h: 10, w: 100, x: 1, y: 1 } }), base, "travado nao alinha");
  assert.deepEqual(geometry.alignFreeRect({ h: 10, w: 20, x: 5, y: 5 }, "middle", { h: 100, w: 200 }), { y: 45 });
});

test("guias grudam nas bordas e no centro da prancheta e dos outros soltos; Alt desliga", () => {
  const targets = geometry.freeSnapTargets({ h: 400, w: 440 }, [{ h: 50, w: 100, x: 300, y: 200 }]);

  // Centro do retangulo a 3 px do centro da prancheta (220): gruda.
  const center = geometry.snapFreeMove({ h: 40, w: 100, x: 173, y: 10 }, targets, 6);
  assert.equal(center.dx, -3);
  assert.deepEqual(center.guides.filter((guide) => guide.axis === "x"), [{ at: 220, axis: "x" }]);
  // Borda de cima a 4 px da borda de cima do outro solto (200).
  const top = geometry.snapFreeMove({ h: 40, w: 100, x: 10, y: 196 }, targets, 6);
  assert.equal(top.dy, 4);
  assert.deepEqual(top.guides, [{ at: 200, axis: "y" }]);
  // Borda direita gruda na borda da prancheta.
  assert.equal(geometry.snapFreeMove({ h: 10, w: 100, x: 335, y: 100 }, targets, 6).dx, 5);
  // Longe de tudo: sem guia.
  assert.deepEqual(geometry.snapFreeMove({ h: 10, w: 10, x: 50, y: 130 }, targets, 6), { dx: 0, dy: 0, guides: [] });
  // Alt desliga.
  assert.deepEqual(geometry.snapFreeMove({ h: 40, w: 100, x: 173, y: 10 }, targets, 6, true), { dx: 0, dy: 0, guides: [] });

  // Redimensionar: so a borda que a alca mexe gruda.
  const resized = geometry.snapFreeResize({ h: 40, w: 296, x: 0, y: 0 }, "e", targets, 6);
  assert.deepEqual(resized.rect, { h: 40, w: 300, x: 0, y: 0 });
  assert.deepEqual(resized.guides, [{ at: 300, axis: "x" }]);
  assert.deepEqual(geometry.snapFreeResize({ h: 40, w: 296, x: 0, y: 0 }, "e", targets, 6, { disabled: true }).guides, []);
});

test("escala do zoom e do celular nas contas do ponteiro", () => {
  // Computador a 100 %: 1 px de tela = 1 px da prancheta.
  assert.equal(geometry.freeStageScale(440, 440), 1);
  // Celular: o cartao tem 343 px para uma prancheta de 440.
  const phone = geometry.freeStageScale(343, 440);
  assert.deepEqual(geometry.freeScreenToArtboard({ x: 34.3, y: 0 }, phone), { x: 44, y: 0 });
  // Zoom de 50 % no computador: 10 px de tela = 20 px da prancheta.
  assert.deepEqual(geometry.freeScreenToArtboard({ x: 10, y: -5 }, geometry.freeStageScale(220, 440)), { x: 20, y: -10 });
  // Celular com zoom de 50 %.
  const both = geometry.freeStageScale(343 * 0.5, 440);
  assert.ok(Math.abs(geometry.freeScreenToArtboard({ x: 17.15, y: 0 }, both).x - 44) < 1e-9);
  assert.equal(geometry.freeStageScale(0, 440), 1, "sem medida nao divide por zero");

  // Ajustar a tela: o palco cabe no espaco visivel, nunca acima de 100 %.
  assert.equal(geometry.freeFitZoom({ h: 900, w: 1200 }, { h: 600, w: 600 }), 1);
  assert.equal(geometry.freeFitZoom({ h: 548, w: 1200 }, { h: 1000, w: 600 }), 0.5);
  assert.equal(geometry.freeDesktopStageWidth(440), 600);
  assert.equal(geometry.freeDesktopStageWidth(720), 752);
  assert.equal(geometry.FREE_PHONE_FRAME_PX, 375);

  // As guias medem 6 px de tela: no celular com zoom de 50 % isso e mais px da prancheta.
  const session = geometry.startFreeDrag({
    hadHeight: true,
    id: "forma",
    mode: "move",
    origin: { x: 0, y: 0 },
    rect: { h: 40, w: 40, x: 0, y: 100 },
    scale: both,
    targets: geometry.freeSnapTargets({ h: 400, w: 440 }, [])
  });
  // 4 px de tela andam ~10 px da prancheta; a borda esquerda (10) fica a 10 px do 0, dentro dos ~15 px do limite.
  const moved = geometry.updateFreeDrag(session, { x: 4, y: 0 });
  assert.equal(moved.last.rect.x, 0);
});

test("arrastar muda o design uma vez só, no fim", () => {
  const base = design([{ box: { fill: [{ color: "#ffffff26", kind: "solid" }] }, id: "forma", place: { h: 100, mode: "free", w: 100, x: 50, y: 50 }, type: "shape" }, LINKS]);
  let steps = history.createFreeHistory({ cta: null, design: base });
  const targets = geometry.freeSnapTargets({ h: 400, w: 440 }, []);
  let session = geometry.startFreeDrag({ hadHeight: true, id: "forma", mode: "move", origin: { x: 500, y: 300 }, rect: { h: 100, w: 100, x: 50, y: 50 }, scale: 1, targets });

  // 2 px: ainda e um clique (nada muda, nada desenha).
  session = geometry.updateFreeDrag(session, { x: 502, y: 300 });
  assert.equal(geometry.freeDragPreview(session), null);
  assert.equal(geometry.finishFreeDrag(session), null);

  // Varios movimentos: so a previa muda; o design e o historico ficam.
  for (const [x, y] of [[510, 310], [530, 330], [541, 337]]) {
    session = geometry.updateFreeDrag(session, { x, y });
  }

  assert.deepEqual(geometry.freeDragPreview(session), { dx: 41, dy: 37, id: "forma" });
  assert.equal(steps.present.design, base);
  assert.equal(steps.past.length, 0);

  // Fim: um passo so.
  const patch = geometry.finishFreeDrag(session);
  assert.deepEqual(patch, { x: 91, y: 87 });
  steps = history.pushFreeHistory(steps, { cta: null, design: editor.setFreeNodeRect(base, "forma", patch) });
  assert.equal(steps.past.length, 1);
  assert.deepEqual(find(steps.present.design, "forma").node.place, { h: 100, mode: "free", w: 100, x: 91, y: 87 });

  // Redimensionar um texto sem altura pela alca da direita: so a largura muda (a altura continua automatica).
  const text = geometry.startFreeDrag({ hadHeight: false, id: "texto", mode: "e", origin: { x: 0, y: 0 }, rect: { h: 40, w: 200, x: 10, y: 10 }, scale: 1, targets });
  const wider = geometry.updateFreeDrag(text, { x: 30, y: 15 }, { altKey: true });
  assert.deepEqual(geometry.freeDragPreview(wider), { dw: 30, dx: 0, dy: 0, id: "texto" });
  assert.deepEqual(geometry.finishFreeDrag(wider), { w: 230, x: 10, y: 10 });
  // Pela alca de baixo: ganha altura minima.
  const taller = geometry.updateFreeDrag({ ...text, mode: "s" }, { x: 0, y: 20 }, { altKey: true });
  assert.deepEqual(geometry.finishFreeDrag(taller), { h: 60, w: 200, x: 10, y: 10 });
});

test("histórico junta edições do mesmo campo e guarda o cta junto, com o texto do botão principal", () => {
  const base = design([TITLE, CTA_NODE, LINKS]);
  const start = history.createFreeHistory({ cta: CTA, design: base });
  const typed = ["Q", "Qu", "Que"].reduce(
    (current, label, index) => history.pushFreeHistory(current, { cta: { ...CTA, label }, design: current.present.design }, { coalesceKey: "principal:cta.label", now: 1_000 + index * 200 }),
    start
  );

  assert.equal(typed.past.length, 1, "tres letras seguidas = um passo");
  assert.equal(typed.present.cta.label, "Que");

  // Depois de 700 ms, outro passo; outro campo, outro passo.
  const later = history.pushFreeHistory(typed, { cta: { ...CTA, label: "Quer" }, design: typed.present.design }, { coalesceKey: "principal:cta.label", now: 2_200 });
  assert.equal(later.past.length, 2);
  const otherField = history.pushFreeHistory(later, { cta: { ...CTA, href: "/x", label: "Quer" }, design: later.present.design }, { coalesceKey: "principal:cta.href", now: 2_300 });
  assert.equal(otherField.past.length, 3);

  // Excluir o Botão principal e desfazer devolve o design e o botao juntos.
  const removed = editor.removeFreeNode(otherField.present.design, "principal");
  const afterRemove = history.pushFreeHistory(otherField, { cta: null, design: removed.design });
  const undone = history.undoFreeHistory(afterRemove);
  assert.equal(undone.present.cta.label, "Quer");
  assert.ok(editor.freeCtaNode(undone.present.design));
  const redone = history.redoFreeHistory(undone);
  assert.equal(redone.present.cta, null);
  assert.equal(editor.freeCtaNode(redone.present.design), null);

  // Nada mudou: nenhum passo.
  assert.equal(history.pushFreeHistory(redone, { ...redone.present }), redone);
  assert.equal(history.canUndoFreeHistory(start), false);
  assert.equal(history.canRedoFreeHistory(undone), true);
});

test("histórico para em 100 passos", () => {
  let current = history.createFreeHistory({ cta: null, design: design([LINKS]) });

  for (let index = 0; index < 130; index += 1) {
    current = history.pushFreeHistory(current, { cta: null, design: design([{ id: "espaco", size: index, type: "spacer" }, LINKS]) }, { now: index * 1_000 });
  }

  assert.equal(current.past.length, 100);
  let undos = 0;

  while (history.canUndoFreeHistory(current)) {
    current = history.undoFreeHistory(current);
    undos += 1;
  }

  assert.equal(undos, 100);
  assert.equal(find(current.present.design, "espaco").node.size, 29);
});

test("aplicar modelo e recuperar são um passo", () => {
  const base = design([TITLE, LINKS]);
  let current = history.createFreeHistory({ cta: null, design: base });
  const applied = starters.applyFreeStarter("blank", { audio: null, cta: null });

  current = history.pushFreeHistory(current, applied, { now: 10 });
  assert.equal(current.past.length, 1);

  // Recuperar logo em seguida (sem chave): outro passo, nunca junta.
  const saved = { cta: CTA, design: design([TEXT, CTA_NODE, LINKS]) };
  current = history.pushFreeHistory(current, saved, { now: 20 });
  assert.equal(current.past.length, 2);
  assert.equal(history.undoFreeHistory(current).present.design, applied.design);
  assert.equal(history.undoFreeHistory(history.undoFreeHistory(current)).present.design, base);
});

function memoryStorage() {
  const map = new Map();

  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    map,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => map.set(key, String(value))
  };
}

test("cópia de recuperação: grava, lê com o zod, descarta a inválida e some ao salvar; sem armazenamento não quebra", () => {
  const storage = memoryStorage();
  const key = recovery.freeRecoveryKey("2b7c6f9e-1d2a-4c55-9a4e-5f1f7b2c9d10");
  const entry = { cta: CTA, design: design([TITLE, CTA_NODE, LINKS]) };

  assert.equal(recovery.freeRecoveryKey(null), "bunker707:livre:novo");
  assert.equal(key, "bunker707:livre:2b7c6f9e-1d2a-4c55-9a4e-5f1f7b2c9d10");
  assert.equal(recovery.writeFreeRecovery(storage, key, entry, new Date("2026-10-23T17:05:00Z")), true);

  const read = recovery.readFreeRecovery(storage, key);
  assert.deepEqual(read.design, entry.design);
  assert.deepEqual(read.cta, CTA);
  assert.equal(read.savedAt, "2026-10-23T17:05:00.000Z");
  assert.equal(recovery.freeRecoveryTime(read.savedAt, "pt-BR", "UTC"), "17:05");
  assert.equal(recovery.freeRecoveryDiffers(read, entry), false, "igual ao que abriu: a faixa nao aparece");
  assert.equal(recovery.freeRecoveryDiffers(read, { cta: CTA, design: design([TEXT, CTA_NODE, LINKS]) }), true);
  assert.equal("allowSnooze" in read, false, "sem a regra do Lembrar depois na copia, nada e devolvido (copias de antes)");

  // docs/27 §13.7: a regra "Permitir “Lembrar depois”" vai ao lado do cta (o Livre tambem a edita) e volta como veio.
  assert.equal(recovery.writeFreeRecovery(storage, key, { ...entry, allowSnooze: false }), true);
  assert.equal(recovery.readFreeRecovery(storage, key).allowSnooze, false);
  assert.equal(JSON.parse(storage.getItem(key)).allowSnooze, false);
  assert.equal(recovery.writeFreeRecovery(storage, key, { ...entry, allowSnooze: true }), true);
  assert.equal(recovery.readFreeRecovery(storage, key).allowSnooze, true);
  storage.setItem(key, JSON.stringify({ allowSnooze: "sim", cta: CTA, design: entry.design, savedAt: "2026-10-23T17:05:00Z" }));
  assert.equal("allowSnooze" in recovery.readFreeRecovery(storage, key), false, "allowSnooze que nao e booleano fica de fora; o resto vale");

  // Uma copia que nao passa no zod (chave a mais, X invisivel, JSON quebrado) e apagada em silencio.
  storage.setItem(key, JSON.stringify({ cta: CTA, design: { ...entry.design, url: "https://exemplo.com/x.webp" }, savedAt: "2026-10-23T17:05:00Z" }));
  assert.equal(recovery.readFreeRecovery(storage, key), null);
  assert.equal(storage.map.has(key), false);
  storage.setItem(key, "{nao e json");
  assert.equal(recovery.readFreeRecovery(storage, key), null);
  assert.equal(storage.map.has(key), false);
  storage.setItem(key, JSON.stringify({ cta: { href: 1 }, design: entry.design, savedAt: "2026-10-23T17:05:00Z" }));
  assert.equal(recovery.readFreeRecovery(storage, key), null);

  // Salvar com sucesso apaga.
  recovery.writeFreeRecovery(storage, key, entry);
  recovery.clearFreeRecovery(storage, key);
  assert.equal(recovery.readFreeRecovery(storage, key), null);

  // Sem armazenamento, ou com um que recusa tudo: nada quebra.
  const broken = {
    getItem() {
      throw new Error("bloqueado");
    },
    removeItem() {
      throw new Error("bloqueado");
    },
    setItem() {
      throw new Error("cheio");
    }
  };
  assert.equal(recovery.writeFreeRecovery(null, key, entry), false);
  assert.equal(recovery.readFreeRecovery(null, key), null);
  assert.equal(recovery.writeFreeRecovery(broken, key, entry), false);
  assert.equal(recovery.readFreeRecovery(broken, key), null);
  assert.doesNotThrow(() => recovery.clearFreeRecovery(broken, key));
  assert.equal(recovery.browserFreeRecoveryStorage(), null, "no Node nao ha janela");
});

test("Camadas: setas na linha, E esconde, T trava", () => {
  const key = (value, extra = {}) => ({ altKey: false, ctrlKey: false, key: value, metaKey: false, shiftKey: false, ...extra });
  const at = { button: 0, buttons: 4, row: 2, rows: 5 };

  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowDown"), at), { index: 3, kind: "row" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowUp"), at), { index: 1, kind: "row" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowDown"), { ...at, row: 4 }), { index: 4, kind: "row" });
  assert.deepEqual(editor.freeLayerKeyAction(key("Home"), at), { index: 0, kind: "row" });
  assert.deepEqual(editor.freeLayerKeyAction(key("End"), at), { index: 4, kind: "row" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowRight"), at), { index: 1, kind: "button" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowRight"), { ...at, button: 3 }), { index: 3, kind: "button" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowLeft"), { ...at, button: 2 }), { index: 1, kind: "button" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowUp", { altKey: true }), at), { kind: "moveUp" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ArrowDown", { altKey: true }), at), { kind: "moveDown" });
  assert.deepEqual(editor.freeLayerKeyAction(key("e"), at), { kind: "toggleHidden" });
  assert.deepEqual(editor.freeLayerKeyAction(key("T", { shiftKey: true }), at), { kind: "toggleLocked" });
  assert.deepEqual(editor.freeLayerKeyAction(key("Enter"), at), { kind: "select" });
  assert.equal(editor.freeLayerKeyAction(key("Enter"), { ...at, button: 1 }), null, "nos outros botoes o Enter aperta o proprio botao");
  assert.deepEqual(editor.freeLayerKeyAction(key("F10", { shiftKey: true }), at), { kind: "menu" });
  assert.deepEqual(editor.freeLayerKeyAction(key("ContextMenu"), at), { kind: "menu" });
  assert.deepEqual(editor.freeLayerKeyAction(key("Delete"), at), { kind: "remove" });
  assert.deepEqual(editor.freeLayerKeyAction(key("d", { ctrlKey: true }), at), { kind: "duplicate" });
  assert.deepEqual(editor.freeLayerKeyAction(key("F2"), at), { kind: "rename" });
  assert.equal(editor.freeLayerKeyAction(key("e", { ctrlKey: true }), at), null);

  // As linhas: ordem do DOM, nivel, etiquetas, nome falado com a caixa de fora e o aviso.
  const box = { children: [{ ...TITLE, id: "t1", lines: [[{ text: "Experimente grátis" }]] }], id: "caixa", layout: { dir: "row" }, type: "box" };
  const value = design([
    { ...TEXT, hidden: true, locked: true, place: { mode: "free", w: 200, x: 0, y: 0 } },
    box,
    CTA_NODE,
    { id: "forma", name: "Mancha de luz", place: { h: 10, mode: "free", w: 10, x: 0, y: 0 }, type: "shape" },
    LINKS
  ]);
  const rows = editor.freeLayerRows(value, CTA, new Set(["t1"]));

  assert.deepEqual(rows.map((row) => [row.id, row.depth]), [["texto", 1], ["caixa", 1], ["t1", 2], ["principal", 1], ["forma", 1], ["links", 1]]);
  assert.equal(rows[0].label, "Texto · Assista hoje.");
  assert.deepEqual([rows[0].free, rows[0].hidden, rows[0].locked], [true, true, true]);
  assert.equal(rows[1].label, "Caixa em linha");
  assert.equal(rows[2].selectLabel, "Selecionar Título: Experimente grátis dentro de Caixa em linha");
  assert.equal(rows[2].warning, true);
  assert.equal(rows[3].label, "Botão principal · Quero ver");
  assert.equal(rows[4].label, "Mancha de luz");
  assert.equal(rows[5].selectLabel, "Selecionar Links");

  // Esconder, travar, renomear e camada.
  const hidden = editor.setFreeNodeFlag(value, "forma", "hidden", true);
  assert.equal(find(hidden, "forma").node.hidden, true);
  assert.equal(find(editor.setFreeNodeFlag(hidden, "forma", "hidden", false), "forma").node.hidden, undefined);
  assert.equal(editor.setFreeNodeFlag(value, "texto", "locked", true), value, "sem mudanca, o mesmo design");
  assert.equal(find(editor.renameFreeNode(value, "forma", "  Brilho   rosa "), "forma").node.name, "Brilho rosa");
  assert.equal(find(editor.renameFreeNode(value, "forma", "   "), "forma").node.name, undefined);
  assert.equal(find(editor.shiftFreeNodeLayer(value, "forma", 1), "forma").node.place.z, 1);
  assert.equal(find(editor.shiftFreeNodeLayer(editor.shiftFreeNodeLayer(value, "forma", 1), "forma", -1), "forma").node.place.z, undefined);
  assert.deepEqual(find(editor.shiftFreeNodeLayer(value, "principal", -1), "principal").node.place, { mode: "flow", z: -1 });
  assert.equal(find(editor.shiftFreeNodeLayer(editor.shiftFreeNodeLayer(value, "principal", -1), "principal", 1), "principal").node.place, undefined);

  // O palco diz o selecionado.
  assert.equal(editor.freeSelectionDescription(value, "texto", {}), "Selecionado: Texto, X 0, Y 0.");
  assert.equal(editor.freeSelectionDescription(value, "principal", { principal: { h: 44, w: 120, x: 160.4, y: 220.6 } }), "Selecionado: Botão principal, X 160, Y 221.");
  assert.equal(editor.freeSelectionDescription(value, null, {}), "Nada selecionado.");
});

test("Revisar: erros do navegador e do salvar levam ao elemento; campos de fora viram a frase", () => {
  const value = design([{ ...TITLE, lines: [[{ text: " " }]] }, { asset: null, id: "img", type: "image" }, CTA_NODE, LINKS]);
  const errors = editor.freeEditorErrors(value, { allowSnooze: true, audio: null, cta: null });

  assert.equal(errors["nodes.titulo.lines.0"] ?? errors["nodes.titulo.lines.0.0.text"] ?? errors["nodes.titulo.lines"], M.lineEmpty);
  assert.equal(errors["nodes.img.asset"], M.imageMissing);
  assert.equal(errors["cta.label"], M.cta);

  const review = editor.freeReviewItems(value, errors, [{ key: "nodes.titulo.textStyle.font", kind: "font-device", message: "x", nodeId: "titulo" }]);
  const ctaItem = review.errors.find((item) => item.key === "cta.label");
  assert.equal(ctaItem.nodeId, "principal");
  assert.equal(ctaItem.nodeName, "Botão principal");
  assert.equal(review.errors.find((item) => item.key === "nodes.img.asset").nodeName, "Imagem");
  assert.equal(review.hints[0].action, "font");
  assert.deepEqual([...editor.freeFlaggedNodeIds(value, errors, [])].sort(), ["img", "principal", "titulo"]);

  // Erros do salvar com o prefixo e indices viram as chaves do editor.
  assert.deepEqual(editor.freeEditorErrorKeys(value, { "freeDesign.children.1.asset": "a", freeDesign: "b", title: "c" }), { design: "b", "nodes.img.asset": "a", title: "c" });
  assert.deepEqual(editor.freeOutsideFieldNames({ "freeDesign.size": "x", "cta.href": "y", title: "z", "popup.frequency.maxTotal": "w", "window.endsAt": "v", estranho: "u" }), ["Nome do pop-up", "Quantas vezes", "Quando", "outros campos"]);
  assert.equal(C.save.outside("Nome do pop-up"), "Há campos para revisar fora do editor: Nome do pop-up.");

  // Aumentar a altura: a prancheta vai ate o fim do elemento cortado.
  const raised = editor.raiseFreeArtboardTo(value, "img", { img: { h: 100.2, w: 10, x: 0, y: 500 } });
  assert.equal(raised.artboard.minHeight, 601);

  // Enviar fonte…: a fonte enviada entra no texto da dica.
  const font = { id: "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b", kind: "uploaded" };
  assert.deepEqual(find(editor.applyFreeFontAtKey(value, "nodes.titulo.textStyle.font", font), "titulo").node.textStyle.font, font);
  const spans = design([{ ...TITLE, lines: [[{ text: "a " }, { style: { weight: 400 }, text: "b" }]] }, LINKS]);
  assert.deepEqual(find(editor.applyFreeFontAtKey(spans, "nodes.titulo.lines.0.1.style.font", font), "titulo").node.lines[0][1].style.font, font);

  // O palco recalcula as fontes do design (o item de previa filtra por elas).
  const withFont = { ...value, children: [{ ...TITLE, textStyle: { font } }, LINKS], fonts: [] };
  assert.deepEqual(editor.freeStageDesign(withFont).fonts, [font.id]);
  assert.equal(editor.freeStageDesign(value), value);
  assert.equal(editor.freeOnlyLinks(design([LINKS])), true);
  assert.equal(C.review.size(12), "Tamanho do design: 12 % do máximo.");
});

/** Os erros que o editor do aviso confere ao salvar (o mesmo zod do servidor), com as chaves dos elementos. */
function noticeDraftErrors(draft) {
  const parsed = noticeSchemas.noticeDraftSchema.safeParse(noticeView.noticeDraftForKind(draft));

  return parsed.success ? {} : schema.freeErrorKeys(draft.freeDesign, noticeView.noticeErrorsFrom(parsed.error.issues));
}

test("Revisar: o Botão principal sem destino aparece com a frase do Personalizado, leva ao “Para onde leva” e some ao preencher", () => {
  // Um modelo pronto num aviso sem botao: o "Saiba mais" com o destino vazio (o produtor escolhe no editor).
  const { cta, design: value } = starters.applyFreeStarter("glow_text", { audio: null, cta: null });
  assert.deepEqual(cta, { href: "", label: "Saiba mais", target: "same_tab" });
  const content = (next) => ({ allowSnooze: true, audio: null, cta: next });

  // O salvar do aviso recusa (e o card Design conta "1 problema para revisar"); o Personalizado diz a mesma frase.
  const draft = { ...noticeSchemas.emptyNoticeDraft("popup"), cta, freeDesign: value, title: "Ao vivo hoje" };
  const card = Object.fromEntries(Object.entries(noticeDraftErrors(draft)).filter(([key]) => designEditor.isFreeProblemKey(key)));
  const personalizado = noticeDraftErrors({ ...noticeSchemas.emptyNoticeDraft("popup"), ...designEditor.applyStarter({ audio: null, cta: null }, "text_only", null), title: "Ao vivo hoje" });
  assert.equal(personalizado["cta.href"], "Escolha para onde o botão leva.");
  assert.deepEqual(card, { "cta.href": personalizado["cta.href"] });

  // O Revisar do editor Livre mostra o mesmo erro, no Botão principal, e leva ao "Para onde leva" no Conteúdo.
  const errors = editor.freeEditorErrors(value, content(cta));
  assert.deepEqual(errors, editor.freeEditorErrorKeys(value, card), "o card, o salvar e o Revisar contam o mesmo");
  const review = editor.freeReviewItems(value, errors, []);
  assert.deepEqual(review.errors, [{ action: null, key: "cta.href", kind: "error", message: "Escolha para onde o botão leva.", nodeId: "botao", nodeName: "Botão principal" }]);
  assert.deepEqual([...editor.freeFlaggedNodeIds(value, errors, [])], ["botao"]);
  assert.deepEqual(inspector.freeFocusTargetOf(value, { key: "cta.href" }), { fieldId: "livre-botao-botao-destino", nodeId: "botao", tab: "content" });

  // Com o destino escolhido, o item some (e o salvar passa); a regra e a do botao do aviso, com as frases dele.
  const filled = { ...cta, href: "/minhas-compras" };
  assert.deepEqual(editor.freeEditorErrors(value, content(filled)), {});
  assert.deepEqual(noticeDraftErrors({ ...draft, cta: filled }), {});
  assert.deepEqual(editor.freeEditorErrors(value, content({ ...cta, href: "http://exemplo.com" })), { "cta.href": "Use um link que comece com https://." });
  assert.deepEqual(editor.freeEditorErrors(value, content({ ...filled, label: "   " })), { "cta.label": "Escreva o texto do botão." });

  for (const broken of [{ ...cta, href: "http://exemplo.com" }, { ...filled, label: "   " }, { ...filled, label: "x".repeat(31) }]) {
    const fromNotice = Object.fromEntries(Object.entries(noticeDraftErrors({ ...draft, cta: broken })).filter(([key]) => designEditor.isFreeProblemKey(key)));

    assert.deepEqual(editor.freeEditorErrors(value, content(broken)), editor.freeEditorErrorKeys(value, fromNotice), JSON.stringify(broken));
  }
});

test("num modelo, o Revisar confere o Botão principal pela regra do modelo: texto e destino vazios passam, preenchidos seguem a regra do aviso", () => {
  // Modo modelo de Pop-up e pagina do design guardado (docs/28 D8): o "Salvar modelo" aceita o botao sem destino, entao o
  // Revisar tambem; um link preenchido errado continua apontado, com a frase do aviso.
  const { cta, design: value } = starters.applyFreeStarter("glow_text", { audio: null, cta: null });
  const model = (next) => ({ allowSnooze: true, audio: null, cta: next, ctaOptional: true });

  assert.deepEqual(editor.freeEditorErrors(value, model(cta)), {});
  assert.deepEqual(editor.freeEditorErrors(value, model({ ...cta, label: "" })), {});
  assert.deepEqual(editor.freeEditorErrors(value, model({ ...cta, href: "http://exemplo.com" })), { "cta.href": "Use um link que comece com https://." });
  assert.deepEqual(Object.keys(editor.freeEditorErrors(value, model({ ...cta, label: "x".repeat(31) }))), ["cta.label"]);
  // Fora do modelo, o mesmo botao sem destino continua apontado no Revisar.
  assert.deepEqual(Object.keys(editor.freeEditorErrors(value, { allowSnooze: true, audio: null, cta, ctaOptional: false })), ["cta.href"]);
});

test("salvar de dentro do editor: no pop-up no ar, o botão e a frase do editor do aviso; no rascunho, como antes", async () => {
  const notices = await import("../src/components/admin/v2/communication/notices-view-model.ts");

  // Pop-up no ar ou pausado (o salvar vale para os alunos): o botao principal do editor do aviso.
  assert.equal(editor.freeSaveLabel(true), notices.SENT_NOTICE_COPY.save);
  assert.equal(editor.freeSaveLabel(true), "Salvar alterações");
  assert.equal(editor.freeSaveLabel(false), C.bar.saveDraft);
  assert.equal(editor.freeSaveLabel(false), "Salvar rascunho");

  // A frase depois: a do toast do editor do aviso (devolvida pelo salvar); sem ela, "Rascunho salvo.".
  assert.equal(
    editor.freeSavedMessage(notices.savedNoticeToast("popup", "active", { repeat: "once" })),
    "Pop-up atualizado. Quem já viu não vê de novo. Para quem já está com a área aberta, pode levar até 1 minuto."
  );
  assert.equal(editor.freeSavedMessage(notices.savedNoticeToast("popup", "paused", { repeat: "once" })), "Pop-up salvo. Ele continua pausado.");
  assert.equal(editor.freeSavedMessage(notices.NOTHING_TO_SAVE_MESSAGE), "Nenhuma mudança para salvar.");
  assert.equal(editor.freeSavedMessage(notices.savedNoticeToast("popup", "draft", { repeat: "once" })), "Rascunho salvo.");
  assert.equal(editor.freeSavedMessage(notices.savedNoticeToast("popup", null, { repeat: "once" })), "Rascunho salvo.", "aviso novo");
  assert.equal(editor.freeSavedMessage(undefined), C.save.saved);
  assert.equal(C.save.saved, "Rascunho salvo.");
});

test("vocabulário das frases do editor", () => {
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") {
      texts.push(value);
    } else if (typeof value === "function") {
      texts.push(String(value(1, 2)));
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collect);
    }
  };

  collect(C);
  collect(editor.FREE_HANDLE_LABELS);
  collect(editor.FREE_ELEMENT_GROUPS);

  for (const kind of editor.FREE_ELEMENT_GROUPS.flatMap((group) => group.items.map((item) => item.kind))) {
    texts.push(editor.freeAddedAnnouncement(kind));
  }

  texts.push(...editor.freeOutsideFieldNames({ title: "", body: "", image: "", icon: "", "audio.url": "", sender: "", schedule: "", validity: "", who: "", "popup.pages": "", "popup.frequency": "", "popup.close": "", "popup.snoozeMinutes": "", "popup.trigger": "", goal: "", reshow: "", followUps: "", allowSnooze: "", outro: "" }));

  const all = texts.join("\n").toLowerCase();

  for (const word of PROIBIDAS) {
    assert.equal(all.includes(word), false, `"${word}" apareceu nas frases do editor`);
  }

  // As frases da spec, palavra por palavra.
  assert.equal(C.stage.label, "Área de desenho. Escolha um elemento nas Camadas e use as setas para mover.");
  assert.equal(C.bar.doneLabel, "Concluir e voltar ao aviso");
  assert.equal(C.save.waitUpload, "Espere o arquivo terminar de enviar.");
  assert.equal(C.recovery.message("14:05"), "Há um design deste pop-up que não foi salvo (14:05).");
  assert.equal(C.shortcuts.length, 12);
  assert.equal(C.announce.removed, "Elemento excluído. Ctrl + Z desfaz.");
});

test("o editor Livre não monta HTML nem CSS em texto (dangerouslySetInnerHTML, innerHTML, cssText, <style>)", () => {
  // spec §6: o editor desenha o mesmo cartao do aluno (objetos de estilo do React) e nunca escreve HTML ou CSS.
  const dir = new URL("../src/components/admin/v2/communication/popup-free/", import.meta.url);
  const files = ["free-editor.tsx", "free-canvas.tsx", "free-layers-panel.tsx", "free-elements-panel.tsx", "free-review-panel.tsx", "free-editor-model.ts", "free-editor-geometry.ts", "free-editor-history.ts", "free-editor-recovery.ts"];

  for (const file of files) {
    const source = readFileSync(new URL(file, dir), "utf8");

    assert.equal(/dangerouslySetInnerHTML|\.innerHTML|cssText|<style[\s>]|style="/.test(source), false, file);
  }
});

test("as etiquetas das Camadas (Solta, Escondida, Travada) têm 12 px, nunca menos", () => {
  // docs/17: nada abaixo de 12 px no admin. As etiquetas ficam numa linha que quebra (flex-wrap) quando as tres nao cabem.
  const source = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-layers-panel.tsx", import.meta.url), "utf8");
  const tag = source.match(/function Tag2[\s\S]*?\n}/)?.[0] ?? "";

  assert.match(tag, /text-\[12px\]/);
  // text-xs e 12 px (0,75 rem); abaixo disso so por valor fixo.
  assert.equal(/text-\[(?:[1-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/.test(source), false, "nenhum texto do painel das Camadas abaixo de 12 px");
  assert.match(source, /flex-wrap gap-1" id=\{`free-layer-tags-/, "as etiquetas quebram de linha quando nao cabem lado a lado");
  assert.deepEqual(C.layers.tags, { free: "Solta", hidden: "Escondida", locked: "Travada" });
});
