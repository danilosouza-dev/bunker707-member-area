import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A largura maxima e a transicao do painel lateral (rodada v9, pedidos do produtor de 12/11/2026; docs/18 §2.2), no Node
// e sem navegador. P10: em tela cheia o painel do chat e das perguntas ficava com 514 px e uma faixa vazia ao lado das
// mensagens; agora o teto e 400 px na sala do aluno, e o palco fica com o resto. No console o teto voltou a 514 px
// (teste do produtor de 12/11/2026, a tarde, docs/30 D92: quem conduz a live quer o painel com mais espaco). P12: abrir, fechar e trocar de
// aba eram secos; agora o painel desliza e esmaece em 220 ms, so com transform e opacity (a largura do palco, que e o
// iframe do motor de video, muda uma vez so: no comeco ao abrir e no fim ao fechar), e nada anima com "reduzir
// movimento" nem antes da primeira pintura. O que depende do relogio do navegador (o painel sumir depois da saida, o
// iframe que nao remonta) fica no ponta a ponta (aluno-assiste-live-ao-vivo, produtor-controla-a-live).

const motion = await import("../src/components/member/webinars/room/use-panel-motion.ts");
const panelModule = await import("../src/components/member/webinars/room/room-panel.tsx");
const consolePanel = await import("../src/components/admin/v2/communication/webinars/session-console/console-panel.tsx");
const consoleLayout = await import("../src/components/admin/v2/communication/webinars/session-console/console-layout-model.ts");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const noop = () => undefined;
const classesDe = (html, pattern) => (html.match(pattern)?.[1] ?? "").split(" ");

/** A largura do painel numa janela, lida da propria classe (clamp(min, N vw, max)). */
function larguraEm(classes, janela) {
  const clamp = classes.find((classe) => classe.startsWith("lg:w-[clamp("));
  const [, min, vw, max] = clamp.match(/^lg:w-\[clamp\((\d+)px,([\d.]+)vw,(\d+)px\)\]$/);
  return Math.min(Number(max), Math.max(Number(min), (Number(vw) * janela) / 100));
}

const painelDaSala = (props = {}) =>
  render(panelModule.RoomPanel, {
    children: createElement("p", null, "conteudo"),
    className: "flex min-h-0 flex-col flex-1",
    closable: true,
    firstFocus: false,
    id: "room-panel",
    kind: "live",
    onClose: noop,
    onTab: noop,
    open: true,
    pollOpen: false,
    tab: "chat",
    tabs: layout.panelTabsFor({ kind: "live", openPolls: 0, tab: "chat" }),
    ...props
  });

const painelDoConsole = (props = {}) =>
  render(consolePanel.ConsolePanel, {
    className: consoleLayout.consoleSkeleton({ hasStage: true, panelOpen: true }).panel,
    closable: true,
    counts: { maos: 0, perguntas: 0 },
    entries: ["presenca"],
    more: { presenca: createElement("p", null, "presenca") },
    onClose: noop,
    onView: noop,
    open: true,
    panes: { chat: createElement("p", null, "chat"), perguntas: createElement("p", null, "perguntas") },
    rail: true,
    tabs: ["chat", "perguntas"],
    view: { tab: "chat" },
    ...props
  });

test("P10 e D92: o painel da sala tem no maximo 400 px e o do console volta a 514 px; em 1280, 1440, 1920 e 2560 px de janela o palco fica com o resto", () => {
  const sala = classesDe(painelDaSala(), /^<aside aria-labelledby="room-panel-title" class="([^"]*)"/);
  const console_ = consoleLayout.consoleSkeleton({ hasStage: true, panelOpen: true }).panel.split(" ");
  for (const [nome, classes, teto, larguras] of [
    ["a sala", sala, "lg:w-[clamp(320px,27.5vw,400px)]", [320, 352, 396, 400, 400]],
    ["o console", console_, consoleLayout.CONSOLE_PANEL_WIDTH, [320, 352, 396, 514, 514]]
  ]) {
    assert.ok(classes.includes(teto), `${nome}: ${classes.join(" ")}`);
    assert.ok(classes.includes("lg:flex-none"), `${nome}: a largura e so a do painel, o palco cresce`);
    assert.deepEqual(
      [1024, 1280, 1440, 1920, 2560].map((janela) => Math.round(larguraEm(classes, janela))),
      larguras,
      `${nome}: a largura em cada janela`
    );
  }
  // O console e a sala so diferem no teto: ate 1440 px de janela os dois paineis tem a mesma largura.
  assert.equal(consoleLayout.CONSOLE_PANEL_WIDTH, "lg:w-[clamp(320px,27.5vw,514px)]");
});

test("P12: a fase da transicao e pura: antes da primeira pintura e com reduzir movimento nada anima; abrindo, a entrada; fechando, a saida", () => {
  assert.equal(motion.PANEL_MOTION_MS, 220, "curta: entre 200 e 250 ms");
  assert.equal(motion.panelMotionPhase({ armed: false, open: false, reducedMotion: false }), "idle", "a escolha guardada (painel fechado) vale na carga sem passar pela saida");
  assert.equal(motion.panelMotionPhase({ armed: true, open: true, reducedMotion: true }), "idle", "reduzir movimento: abre na hora");
  assert.equal(motion.panelMotionPhase({ armed: true, open: false, reducedMotion: true }), "idle", "reduzir movimento: fecha na hora");
  assert.equal(motion.panelMotionPhase({ armed: true, open: true, reducedMotion: false }), "opening");
  assert.equal(motion.panelMotionPhase({ armed: true, open: false, reducedMotion: false }), "closing");

  // O que cada fase desenha. Fechando, o painel continua ocupando lugar (o palco so cresce quando a saida termina).
  assert.deepEqual(motion.panelMotionOf(false, "closing"), { className: motion.PANEL_EXIT_CLASS, laid: true, phase: "closing" });
  assert.deepEqual(motion.panelMotionOf(true, "opening"), { className: motion.PANEL_ENTER_CLASS, laid: true, phase: "opening" });
  assert.deepEqual(motion.panelMotionOf(true, "idle"), { className: "", laid: true, phase: "idle" });
  assert.deepEqual(motion.panelMotionOf(false, "idle"), { className: "", laid: false, phase: "idle" });
  // A pessoa reabriu no meio da saida (ou fechou no meio da entrada): vale o estado de agora, sem a animacao velha.
  assert.deepEqual(motion.panelMotionOf(true, "closing"), { className: "", laid: true, phase: "idle" });
  assert.deepEqual(motion.panelMotionOf(false, "opening"), { className: "", laid: false, phase: "idle" });
  assert.deepEqual(motion.PANEL_MOTION_IDLE, { className: "", laid: true, phase: "idle" });
});

test("P12: so transform e opacity, sempre atras de motion-safe; nunca a largura, a margem nem o flex (o video nao redimensiona a cada quadro)", () => {
  for (const [nome, classes] of [["a entrada", motion.PANEL_ENTER_CLASS], ["a saida", motion.PANEL_EXIT_CLASS], ["a troca", motion.PANEL_SWAP_CLASS]]) {
    const lista = classes.split(" ");
    const animadas = lista.filter((classe) => classe !== "pointer-events-none");
    assert.ok(animadas.every((classe) => classe.startsWith("motion-safe:")), `${nome}: tudo so sem "reduzir movimento": ${animadas.filter((classe) => !classe.startsWith("motion-safe:")).join(" ")}`);
    assert.doesNotMatch(classes, /transition|(?:^|[ :])(?:w-|max-w-|min-w-|basis-|flex-|grow|shrink|m[lrxytb]?-|p[lrxytb]?-|gap-)/, `${nome}: nada que mexa no layout`);
  }
  const entrada = motion.PANEL_ENTER_CLASS.split(" ");
  assert.ok(["motion-safe:animate-in", "motion-safe:fade-in-0", "motion-safe:lg:slide-in-from-right-4", "motion-safe:duration-[220ms]", "motion-safe:ease-out"].every((classe) => entrada.includes(classe)), "desliza 16 px da direita e aparece, ease-out");
  assert.ok(entrada.includes("motion-safe:slide-in-from-bottom-3") && entrada.includes("motion-safe:lg:slide-in-from-bottom-0"), "no celular em pe o painel fica abaixo do palco: entra de baixo");
  const saida = motion.PANEL_EXIT_CLASS.split(" ");
  assert.ok(["pointer-events-none", "motion-safe:animate-out", "motion-safe:fade-out-0", "motion-safe:lg:slide-out-to-right-4", "motion-safe:duration-[220ms]", "motion-safe:fill-mode-forwards"].every((classe) => saida.includes(classe)), "a saida para no fim ate o painel sumir e nao recebe o toque");
  assert.deepEqual(motion.PANEL_SWAP_CLASS.split(" "), ["motion-safe:animate-in", "motion-safe:fade-in-0", "motion-safe:duration-200", "motion-safe:ease-out"], "trocar de aba so esmaece");
});

test("P12 na sala: fechando, o painel continua na tela com a saida e so some depois; abrindo, entra com a entrada; parado e sem a transicao, o HTML de antes", () => {
  const abertura = (html) => html.match(/^<aside [^>]*>/)[0];
  const parado = abertura(painelDaSala());
  assert.doesNotMatch(parado, /hidden=""|data-room-panel-motion|animate-/, "parado: nada");
  assert.match(abertura(painelDaSala({ open: false })), / hidden=""/, "sem a transicao, fechado some na hora (os testes de tela e a pagina de antes)");

  const fechando = abertura(painelDaSala({ motion: motion.panelMotionOf(false, "closing"), open: false }));
  assert.doesNotMatch(fechando, / hidden=""/, "ainda na tela durante a saida");
  assert.match(fechando, /data-room-panel-motion="closing"/);
  assert.ok(classesDe(fechando, /class="([^"]*)"/).includes("motion-safe:animate-out"));
  assert.ok(classesDe(fechando, /class="([^"]*)"/).includes("pointer-events-none"), "saindo, nao recebe o toque");

  const fechado = abertura(painelDaSala({ motion: motion.panelMotionOf(false, "idle"), open: false }));
  assert.match(fechado, / hidden=""/, "terminada a saida, o aside fica hidden (e montado)");
  assert.doesNotMatch(fechado, /animate-|data-room-panel-motion/);

  const abrindo = abertura(painelDaSala({ motion: motion.panelMotionOf(true, "opening") }));
  assert.doesNotMatch(abrindo, / hidden=""/, "abrindo, o painel entra no layout na hora (o palco encolhe de uma vez)");
  assert.match(abrindo, /data-room-panel-motion="opening"/);
  assert.ok(classesDe(abrindo, /class="([^"]*)"/).includes("motion-safe:animate-in"));
  // A aba: um no por aba (o conteudo novo toca a entrada); na carga, sem a classe (so depois da primeira troca).
  assert.match(painelDaSala(), /<div aria-labelledby="room-tabbtn-chat" class="[^"]*" id="room-tab-chat" role="tabpanel">/);
  assert.doesNotMatch(painelDaSala().match(/<div aria-labelledby="room-tabbtn-chat" class="([^"]*)"/)[1], /animate-in/, "a carga da pagina nao esmaece");
});

test("P12 no console: o mesmo no painel do console; o esqueleto segue o painel que ainda ocupa lugar", () => {
  const abertura = (html) => html.match(/^<aside [^>]*>/)[0];
  assert.doesNotMatch(abertura(painelDoConsole()), /hidden=""|data-console-panel-motion|animate-/);
  assert.match(abertura(painelDoConsole({ open: false })), / hidden=""/);
  const fechando = abertura(painelDoConsole({ motion: motion.panelMotionOf(false, "closing"), open: false }));
  assert.doesNotMatch(fechando, / hidden=""/);
  assert.match(fechando, /data-console-panel-motion="closing"/);
  assert.ok(classesDe(fechando, /class="([^"]*)"/).includes("motion-safe:animate-out"));
  assert.match(abertura(painelDoConsole({ motion: motion.panelMotionOf(false, "idle"), open: false })), / hidden=""/);
  assert.match(abertura(painelDoConsole({ motion: motion.panelMotionOf(true, "opening") })), /data-console-panel-motion="opening"/);
  // O esqueleto: durante a saida o console passa `laid` (verdadeiro) e o painel guarda a largura; depois, `hidden`.
  assert.ok(consoleLayout.consoleSkeleton({ hasStage: true, panelOpen: motion.panelMotionOf(false, "closing").laid }).panel.includes(consoleLayout.CONSOLE_PANEL_WIDTH));
  assert.equal(consoleLayout.consoleSkeleton({ hasStage: true, panelOpen: motion.panelMotionOf(false, "idle").laid }).panel, "hidden");
});
