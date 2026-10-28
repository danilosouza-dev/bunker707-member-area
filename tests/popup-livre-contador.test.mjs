import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import "./support/transpile-tsx.mjs";

// Contador do Livre (L6f, docs/27 §13.13; docs/18 §1.1): a contagem de urgencia no pop-up, ate o fim do pop-up ou
// ate uma data.
// - o JSON: o schema aceita e recusa (data sem fuso, 3 contadores, imagem na casa, casas, tamanhos, texto do fim
//   vazio), a forma canonica tira os padroes e escreve a data em UTC, a reescala leva casas, espaco e nomes;
// - a conta: as casas a partir dos segundos (a maior leva o resto, sem segundos os minutos arredondam para cima), o
//   nome falado, o alvo (a data ou o fim do pop-up) e o design com Contador em qualquer nivel;
// - o aluno: o Contador ate o fim num pop-up sem fim some (no computador e no celular); publicar e retomar pedem o fim
//   do pop-up e a data no futuro (a chave do campo certo); o rascunho e o modelo nunca;
// - o cartao de verdade (react-dom/server): role="timer" com "Tempo restante: ...", as casas escondidas do leitor de
//   tela, os nomes e os dois-pontos, o relogio acertado pela hora do servidor (asOf), o texto do fim em zero, nada no
//   aluno sem alvo e o tempo de exemplo na previa;
// - o Revisar: contraste dos numeros sobre a casa e dos nomes, nomes pequenos e as casas que nao cabem no celular;
// - o editor: o painel Elementos, o limite de 2, os campos do Conteudo e do Estilo pelas chaves de erro, o campo de
//   data e hora, a nota do fim e o quinto modelo.

const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const checks = await import("../src/server/communications/popup-free-checks.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const inspector = await import("../src/components/admin/v2/communication/popup-free/free-inspector-model.ts");
const { PopupFreeCard } = await import("../src/components/member/notifications/popup-free/popup-free-card.tsx");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const M = schema.POPUP_FREE_MESSAGES;
const ORIGIN = "https://projeto.supabase.co";
const SECOND = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-28T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const LINKS = { id: "links", type: "links" };
const DARK = { fill: [{ color: "#111216", kind: "solid" }] };

function input(children, extra = {}) {
  return { artboard: DARK, children: [...children, LINKS], mode: "free", version: 1, ...extra };
}

/** Valida pelo schema do Livre (forma canonica), como o aluno recebe. */
function parsed(children, extra = {}) {
  const design = schema.parsePopupFreeDesign(input(children, extra));

  assert.ok(design, `design valido: ${JSON.stringify(children).slice(0, 200)}`);

  return design;
}

/** As mensagens do schema para um design (vazio = aceito). */
function issues(children, extra = {}) {
  const result = schema.popupFreeDesignSchema.safeParse(input(children, extra));

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const contador = (extra = {}) => ({ id: "contador", type: "countdown", ...extra });

/* ------------------------------------------------------------------------------------------------
 * O JSON: schema, forma canonica e reescala
 * ---------------------------------------------------------------------------------------------- */

test("schema: o Contador mínimo passa; a data precisa do fuso e ser uma data; casas, tamanhos e o texto do fim têm limite", () => {
  assert.deepEqual(issues([contador()]), []);
  assert.deepEqual(issues([contador({ until: { kind: "end" } })]), []);
  assert.deepEqual(issues([contador({ until: { at: "2026-11-30T23:59:00-03:00", kind: "date" } })]), []);
  assert.deepEqual(issues([contador({ until: { at: "2026-11-30T23:59Z", kind: "date" } })]), [], "sem segundos, com Z");

  // Data sem fuso (a hora mudaria com o computador de quem abre), texto solto e mes que nao existe.
  for (const at of ["2026-11-30T23:59", "2026-11-30", "amanhã às 20h", "2026-13-01T10:00:00Z"]) {
    assert.deepEqual(issues([contador({ until: { at, kind: "date" } })]), [M.countdownDate], at);
  }

  assert.deepEqual(issues([contador({ until: { kind: "date" } })]), [M.countdownDate], "data que falta");
  assert.deepEqual(issues([contador({ until: { kind: "ontem" } })]), [M.countdownUntil]);
  assert.deepEqual(issues([contador({ until: { at: "2026-11-30T23:59:00Z", kind: "end" } })]).length, 1, "o fim do pop-up não leva data");
  assert.deepEqual(issues([contador({ units: "dh" })]), [M.countdownUnits]);
  assert.deepEqual(issues([contador({ ended: "   " })]), [M.countdownEnded]);
  assert.equal(issues([contador({ labelSize: 9 })]).length, 1);
  assert.equal(issues([contador({ labelSize: 49 })]).length, 1);
  assert.equal(issues([contador({ gap: 49 })]).length, 1);
  assert.deepEqual(issues([contador({ gap: 48, labelSize: 48 })]), []);
  assert.equal(issues([contador({ extra: true })]).length, 1, "chave a mais é recusada (strict)");
});

test("schema: até 2 Contadores (também dentro de caixa); a casa aceita cor e degradê, nunca imagem", () => {
  assert.deepEqual(issues([contador({ id: "a" }), contador({ id: "b" })]), []);
  assert.deepEqual(issues([contador({ id: "a" }), contador({ id: "b" }), contador({ id: "c" })]), [M.countdowns]);
  assert.deepEqual(issues([contador({ id: "a" }), { children: [contador({ id: "b" }), contador({ id: "c" })], id: "caixa", type: "box" }]), [M.countdowns]);

  const linear = { kind: "linear", stops: [{ at: 0, color: "#e50914" }, { at: 100, color: "#7a0510" }] };

  assert.deepEqual(issues([contador({ cell: { border: { color: "#ffffff33", width: 1 }, fill: linear, padding: [8, 10], radius: 999 } })]), []);
  assert.ok(issues([contador({ cell: { fill: { asset: "capa", kind: "image" } } })]).length > 0, "imagem na casa é recusada");
});

test("forma canônica: o que é igual ao padrão sai; a data vira UTC com milissegundos; o resto fica", () => {
  const padrao = parsed([
    contador({
      cell: { fill: { color: "#FFFFFF14", kind: "solid" }, padding: [10, 12], radius: 12 },
      ended: " Encerrado ",
      gap: 8,
      labelColor: "#A1A1AA",
      labelSize: 12,
      labels: true,
      separator: false,
      until: { kind: "end" },
      units: "dhms"
    })
  ]);

  assert.deepEqual(padrao.children[0], { id: "contador", type: "countdown" });

  const proprio = parsed([
    contador({
      cell: { fill: { color: "#E50914", kind: "solid" }, radius: 4 },
      ended: "  Inscrições encerradas ",
      gap: 12,
      labelColor: "#FFFFFF",
      labels: false,
      separator: true,
      until: { at: "2026-11-30T23:59:00-03:00", kind: "date" },
      units: "hms"
    })
  ]);

  assert.deepEqual(proprio.children[0], {
    cell: { fill: { color: "#e50914", kind: "solid" }, radius: 4 },
    ended: "Inscrições encerradas",
    gap: 12,
    id: "contador",
    labelColor: "#ffffff",
    labels: false,
    separator: true,
    type: "countdown",
    units: "hms",
    until: { at: "2026-12-01T02:59:00.000Z", kind: "date" }
  });
  assert.deepEqual(model.canonicalPopupFreeDesign(proprio), proprio, "a forma canônica não muda o que já é canônico");
});

test("reescala: a largura nova leva as casas (respiro e cantos), o espaço, os nomes (piso 10) e o número", () => {
  const design = parsed([contador({ gap: 8, labelSize: 12, textStyle: { size: 32 } })]);
  const menor = model.rescaleFreeDesign(design, 220);

  assert.equal(menor.artboard.width, 280, "a prancheta para no mínimo");
  assert.deepEqual(menor.children[0], { cell: { padding: [6, 8], radius: 8 }, gap: 5, id: "contador", labelSize: 10, textStyle: { size: 20 }, type: "countdown" });
});

/* ------------------------------------------------------------------------------------------------
 * A conta
 * ---------------------------------------------------------------------------------------------- */

const values = (seconds, units) => render.freeCountdownParts(seconds, units).map((part) => part.value);

test("as casas: a maior leva o resto; sem segundos os minutos arredondam para cima; nunca negativo", () => {
  const tempo = 2 * 86400 + 3 * 3600 + 4 * 60 + 5;

  assert.deepEqual(values(tempo, "dhms"), [2, 3, 4, 5]);
  assert.deepEqual(values(tempo, "hms"), [51, 4, 5], "sem dias, as horas passam de 24");
  assert.deepEqual(values(tempo, "dhm"), [2, 3, 5], "4 min e 5 s viram 5 min");
  assert.deepEqual(values(3725, "ms"), [62, 5]);
  assert.deepEqual(values(59, "dhm"), [0, 0, 1], "59 s nunca mostram 00 00 00");
  assert.deepEqual(values(0, "dhm"), [0, 0, 0]);
  assert.deepEqual(values(-30, "dhms"), [0, 0, 0, 0]);
  assert.deepEqual(values(9.7, "ms"), [0, 9], "o segundo quebrado não sobe");
  assert.deepEqual(
    render.freeCountdownParts(tempo, "dhms").map((part) => part.label),
    ["dias", "horas", "min", "seg"]
  );
});

test("o nome falado: as casas por extenso, com singular e o \"e\" no fim", () => {
  const falado = (seconds, units) => render.freeCountdownSpoken(render.freeCountdownParts(seconds, units));

  assert.equal(falado(2 * 86400 + 3 * 3600 + 4 * 60 + 5, "dhms"), "Tempo restante: 2 dias, 3 horas, 4 minutos e 5 segundos");
  assert.equal(falado(86400 + 3600 + 60 + 1, "dhms"), "Tempo restante: 1 dia, 1 hora, 1 minuto e 1 segundo");
  assert.equal(falado(0, "ms"), "Tempo restante: 0 minutos e 0 segundos");
});

test("o alvo: a data do Contador ou o fim do pop-up; sem nenhum dos dois (ou data ruim), nenhum", () => {
  const fim = "2026-11-02T03:00:00.000Z";

  assert.equal(render.freeCountdownTarget({ until: { at: "2026-11-30T23:59:00-03:00", kind: "date" } }, fim), Date.parse("2026-12-01T02:59:00Z"));
  assert.equal(render.freeCountdownTarget({}, fim), Date.parse(fim));
  assert.equal(render.freeCountdownTarget({ until: { kind: "end" } }, fim), Date.parse(fim));
  assert.equal(render.freeCountdownTarget({}, null), null);
  assert.equal(render.freeCountdownTarget({}, undefined), null);
  assert.equal(render.freeCountdownTarget({}, "depois"), null);
});

test("freeHasCountdown acha o Contador em qualquer nível", () => {
  assert.equal(render.freeHasCountdown(parsed([contador()])), true);
  assert.equal(render.freeHasCountdown(parsed([{ children: [{ children: [contador()], id: "dentro", type: "box" }], id: "fora", type: "box" }])), true);
  assert.equal(render.freeHasCountdown(parsed([{ id: "titulo", lines: [[{ text: "Oi" }]], type: "heading" }])), false);
});

/* ------------------------------------------------------------------------------------------------
 * O aluno: o Contador sem fim some; publicar e retomar conferem
 * ---------------------------------------------------------------------------------------------- */

test("no pop-up sem fim, o Contador até o fim some no computador e no celular; o com data e o resto ficam", () => {
  const design = parsed(
    [contador({ hidden: true, id: "fim" }), { children: [contador({ id: "dentro" })], id: "caixa", type: "box" }, { id: "titulo", lines: [[{ text: "Oi" }]], type: "heading" }],
    {
      devices: {
        mobile: {
          nodes: {
            fim: { hidden: false, place: { margin: [8, 0, 0, 0], mode: "flow" } },
            titulo: { place: { margin: [4, 0, 0, 0], mode: "flow" } }
          }
        }
      }
    }
  );
  // "fim" só aparece no celular (escondido no computador, `hidden: false` no celular).
  assert.equal(design.devices.mobile.nodes.fim.hidden, false);

  const comFim = model.freeHideEndlessCountdowns(design, true);

  assert.equal(comFim, design, "com fim, o mesmo objeto");

  const semFim = model.freeHideEndlessCountdowns(design, false);

  assert.equal(semFim.children[0].hidden, true);
  assert.equal(semFim.children[1].children[0].hidden, true, "dentro de caixa também");
  assert.equal(semFim.children[2].hidden, undefined);
  assert.deepEqual(semFim.devices.mobile.nodes.fim, { place: { margin: [8, 0, 0, 0], mode: "flow" } }, "o celular não desfaz o escondido");
  assert.deepEqual(semFim.devices.mobile.nodes.titulo, { place: { margin: [4, 0, 0, 0], mode: "flow" } }, "os outros do celular ficam");
  assert.equal(design.devices.mobile.nodes.fim.hidden, false, "o original não muda");

  const comData = parsed([contador({ until: { at: "2026-11-30T23:59:00Z", kind: "date" } })]);

  assert.equal(model.freeHideEndlessCountdowns(comData, false), comData, "o Contador com data fica (o mesmo objeto)");
});

test("publicar: até o fim pede o fim do pop-up (uma vez, na chave do Termina); a data precisa estar no futuro (na chave do Contador)", () => {
  const futuro = { at: iso(NOW + DAY), kind: "date" };
  const passado = { at: iso(NOW - SECOND), kind: "date" };
  const dois = parsed([contador({ id: "a" }), contador({ id: "b" })]);

  assert.deepEqual(schema.freeCountdownProblems(dois, null, NOW), [{ message: M.countdownEnd, path: "window.endsAt" }]);
  assert.deepEqual(schema.freeCountdownProblems(dois, iso(NOW + DAY), NOW), []);
  assert.deepEqual(schema.freeCountdownProblems(parsed([contador({ until: futuro })]), null, NOW), [], "a data não precisa do fim do pop-up");
  assert.deepEqual(schema.freeCountdownProblems(parsed([contador({ until: passado })]), iso(NOW + DAY), NOW), [
    { message: M.countdownPast, path: "freeDesign.nodes.contador.until.at" }
  ]);
  assert.deepEqual(schema.freeCountdownProblems(parsed([contador({ until: { at: iso(NOW), kind: "date" } })]), null, NOW).length, 1, "agora já passou");
  assert.deepEqual(schema.freeCountdownProblems(parsed([{ id: "titulo", lines: [[{ text: "Oi" }]], type: "heading" }]), null, NOW), []);

  // No publicar do aviso: só o pop-up com o Livre; o fim que já passou dá as duas frases, cada uma no seu campo.
  const draft = (freeDesign, endsAt) => ({ ...schemas.emptyNoticeDraft("popup"), freeDesign, window: { endsAt, startsAt: null } });

  assert.deepEqual(schemas.publishProblems(draft(dois, null), NOW), [{ message: M.countdownEnd, path: "window.endsAt" }]);
  assert.deepEqual(schemas.publishProblems(draft(dois, iso(NOW + DAY)), NOW), []);
  assert.deepEqual(schemas.publishProblems(draft(parsed([contador({ until: passado })]), null), NOW), [{ message: M.countdownPast, path: "freeDesign.nodes.contador.until.at" }]);
});

/* ------------------------------------------------------------------------------------------------
 * O cartao de verdade
 * ---------------------------------------------------------------------------------------------- */

const ASOF = "2026-10-28T15:00:00.000Z";
const TEMPO = (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * SECOND;

function popupOf(design, overrides = {}) {
  return { audio: null, body: "", canSnooze: true, cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" }, fonts: [], freeDesign: design, id: "p1", image: null, title: "Oferta", ...overrides };
}

const card = (design, { popup, ...props } = {}) =>
  renderToStaticMarkup(createElement(PopupFreeCard, { bodyId: "b", design, popup: popupOf(design, popup), storageOrigin: ORIGIN, titleId: "t", ...props }));
const numbers = (html) => [...html.matchAll(/font-variant-numeric:tabular-nums[^>]*>(\d+)</g)].map((match) => match[1]);

test("cartão do aluno: role=\"timer\" com o tempo falado, as casas escondidas do leitor de tela e o relógio pela hora do servidor", () => {
  // O relógio do computador do aluno está errado; a hora do servidor (asOf) acerta: faltam 2d 3h 4min 5s.
  const html = card(parsed([contador()]), { popup: { asOf: ASOF, endsAt: iso(Date.parse(ASOF) + TEMPO) } });

  assert.match(html, /role="timer"/);
  assert.match(html, /aria-label="Tempo restante: 2 dias, 3 horas, 4 minutos e 5 segundos"/);
  assert.deepEqual(numbers(html), ["02", "03", "04", "05"]);

  for (const label of ["dias", "horas", "min", "seg"]) {
    assert.match(html, new RegExp(`>${label}</span>`));
  }

  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length >= 4, true, "as casas ficam escondidas do leitor de tela");
  assert.doesNotMatch(html, />:</, "sem os dois-pontos por padrão");
});

test("cartão: dois-pontos entre as casas, sem os nomes, as casas escolhidas e a data do próprio Contador", () => {
  const html = card(parsed([contador({ labels: false, separator: true, units: "hms" })]), { popup: { asOf: ASOF, endsAt: iso(Date.parse(ASOF) + TEMPO) } });

  assert.deepEqual(numbers(html), ["51", "04", "05"]);
  assert.equal((html.match(/>:</g) ?? []).length, 2, "um entre cada par de casas");
  assert.doesNotMatch(html, />horas</);

  const comData = card(parsed([contador({ until: { at: iso(Date.parse(ASOF) + 90 * SECOND), kind: "date" }, units: "ms" })]), { popup: { asOf: ASOF, endsAt: null } });

  assert.deepEqual(numbers(comData), ["01", "30"], "a data dele vale mesmo sem o fim do pop-up");
});

test("cartão: em zero mostra o texto do fim (o padrão ou o escolhido), sem timer, e o pop-up continua aberto", () => {
  const acabou = { asOf: ASOF, endsAt: iso(Date.parse(ASOF) - SECOND) };
  const padrao = card(parsed([contador()]), { popup: acabou });

  assert.match(padrao, /<p[^>]*data-free-id="contador"[^>]*>.*Encerrado.*<\/p>/);
  assert.doesNotMatch(padrao, /role="timer"/);
  assert.match(padrao, /data-free-id="links"/, "o resto do pop-up continua");
  assert.match(card(parsed([contador({ ended: "Inscrições encerradas" })]), { popup: acabou }), /Inscrições encerradas/);
});

test("cartão: no aluno, sem alvo, o Contador não aparece; na prévia, o tempo de exemplo parado", () => {
  const design = parsed([contador()]);
  const aluno = card(design, { popup: { endsAt: null } });

  assert.doesNotMatch(aluno, /data-free-id="contador"/);
  assert.match(aluno, /data-free-id="links"/);

  const previa = card(design, { popup: { endsAt: null }, preview: true });

  assert.deepEqual(numbers(previa), ["02", "14", "33", "09"]);
  assert.match(previa, /role="timer"/);
});

/* ------------------------------------------------------------------------------------------------
 * O Revisar
 * ---------------------------------------------------------------------------------------------- */

const hintKeys = (design) => checks.popupFreeHints(design).map((hint) => `${hint.kind}:${hint.key}`);

test("Revisar: o contraste dos números é sobre a casa e o dos nomes também; nomes pequenos dão dica; sem nomes, nada deles", () => {
  assert.deepEqual(hintKeys(parsed([contador()])), [], "o padrão passa no fundo escuro");
  assert.deepEqual(hintKeys(parsed([contador({ cell: { fill: { color: "#ffffff", kind: "solid" } } })])), [
    "contrast:nodes.contador.textStyle.paint",
    "contrast:nodes.contador.labelColor"
  ]);
  assert.deepEqual(hintKeys(parsed([contador({ labelColor: "#3f3f46", labelSize: 10 })])), ["contrast:nodes.contador.labelColor", "small-text:nodes.contador.labelSize"]);
  assert.deepEqual(hintKeys(parsed([contador({ labelColor: "#3f3f46", labelSize: 10, labels: false })])), []);
});

test("Revisar no celular: as casas que cabem no desenho e não cabem com os nomes no piso de 12 px levam ao tamanho dos nomes", () => {
  const phone = (extra) => checks.freePhoneTextHints(parsed([contador({ labelSize: 12, textStyle: { size: 20 }, ...extra })]));

  assert.deepEqual(phone({ cell: { padding: [10, 32] } }), [
    { key: "nodes.contador.labelSize", kind: "phone-text", message: checks.POPUP_FREE_HINT_MESSAGES.phoneCountdown, nodeId: "contador" }
  ]);
  assert.deepEqual(phone({ cell: { padding: [10, 12] } }), [], "folga de sobra");
  assert.deepEqual(phone({ cell: { padding: [10, 64] } }), [], "já não cabe no desenho: o celular não muda nada");
  assert.deepEqual(phone({ cell: { padding: [10, 32] }, labels: false }), [], "sem os nomes, nada a dizer");
});

/* ------------------------------------------------------------------------------------------------
 * O editor
 * ---------------------------------------------------------------------------------------------- */

test("editor: o Contador fica no grupo Texto do painel Elementos, entra com o id contador e para no segundo", () => {
  const texto = editor.FREE_ELEMENT_GROUPS.find((group) => group.label === "Texto");

  assert.ok(texto.items.some((item) => item.kind === "countdown" && item.label === "Contador"));

  const primeiro = editor.addFreeElement(parsed([]), "countdown");

  assert.deepEqual(primeiro.node, { id: "contador", type: "countdown" });
  assert.equal(schema.popupFreeDesignSchema.safeParse(primeiro.design).success, true);

  const segundo = editor.addFreeElement(primeiro.design, "countdown");

  assert.equal(segundo.node.id, "contador2");
  assert.deepEqual(editor.addFreeElement(segundo.design, "countdown"), { reason: M.countdowns });
});

test("editor: cada chave de erro e de dica do Contador abre o campo certo do Conteúdo ou do Estilo", () => {
  const design = parsed([contador()]);
  const alvo = (key) => {
    const target = inspector.freeInspectorTargetOf(design, key);

    return target && `${target.tab}:${target.fieldId}`;
  };
  const campo = (field) => inspector.freeFieldId("contador", field);

  assert.equal(alvo("freeDesign.nodes.contador.until.at"), `content:${campo("data")}`);
  assert.equal(alvo("freeDesign.nodes.contador.until"), `content:${campo("conta-ate")}`);
  assert.equal(alvo("nodes.contador.units"), `content:${campo("casas")}`);
  assert.equal(alvo("nodes.contador.labels"), `content:${campo("nomes")}`);
  assert.equal(alvo("nodes.contador.separator"), `content:${campo("dois-pontos")}`);
  assert.equal(alvo("nodes.contador.ended"), `content:${campo("fim-texto")}`);
  assert.equal(alvo("nodes.contador.cell.fill"), `style:${campo("casas-fundo")}`);
  assert.equal(alvo("nodes.contador.cell.border.color"), `style:${campo("casas-borda")}`);
  assert.equal(alvo("nodes.contador.cell.padding"), `style:${campo("casas-respiro")}`);
  assert.equal(alvo("nodes.contador.cell.radius"), `style:${campo("casas-cantos")}`);
  assert.equal(alvo("nodes.contador.gap"), `style:${campo("casas-espaco")}`);
  assert.equal(alvo("nodes.contador.labelColor"), `style:${campo("nomes-cor")}`);
  assert.equal(alvo("nodes.contador.labelSize"), `style:${campo("nomes-tamanho")}`);
  assert.equal(alvo("nodes.contador"), `content:${campo("conta-ate")}`);
});

test("editor: o campo de data e hora vai e volta pelo fuso do computador; a data inicial é amanhã na hora cheia", () => {
  const local = "2026-11-30T23:59";
  const instante = inspector.freeCountdownInstant(local);

  assert.match(instante, /^2026-12-0[12]T\d{2}:59:00\.000Z$|^2026-11-30T\d{2}:59:00\.000Z$/);
  assert.equal(inspector.freeCountdownLocalValue(instante), local);
  assert.equal(inspector.freeCountdownInstant(""), null);
  assert.equal(inspector.freeCountdownInstant("2026-11-30"), null);
  assert.equal(inspector.freeCountdownLocalValue(undefined), "");
  assert.equal(inspector.freeCountdownLocalValue("depois"), "");

  const inicial = Date.parse(inspector.freeCountdownDefaultDate(NOW));

  assert.ok(inicial > NOW + DAY && inicial <= NOW + DAY + HOUR, "amanhã, na hora cheia seguinte");
  assert.equal(new Date(inicial).getMinutes(), 0);
  assert.equal(schema.freeCountdownProblems(parsed([contador({ until: { at: iso(inicial), kind: "date" } })]), null, NOW).length, 0, "publica sem mexer");
});

test("editor: a nota do fim diz quando o pop-up termina, pede o fim ou some no modelo (que não tem quando)", () => {
  const copy = inspector.FREE_INSPECTOR_COPY.countdown;

  assert.equal(inspector.freeCountdownEndNote(undefined), null, "modo modelo e página do modelo de Design");
  assert.equal(inspector.freeCountdownEndNote(null), copy.noEnd);
  assert.equal(inspector.freeCountdownEndNote(""), copy.noEnd);

  const nota = inspector.freeCountdownEndNote("2026-11-30T23:59:00-03:00");

  assert.equal(typeof nota, "string");
  assert.notEqual(nota, copy.noEnd);
  assert.match(nota, /2026/);
});

test("editor: a caixa das casas muda por partes e volta ao padrão quando tudo sai", () => {
  const design = parsed([contador()]);
  const vermelho = inspector.withFreeCountdownCell(design, "contador", { fill: { color: "#e50914", kind: "solid" }, radius: 4 });

  assert.deepEqual(vermelho.children[0].cell, { fill: { color: "#e50914", kind: "solid" }, radius: 4 });

  const semFundo = inspector.withFreeCountdownCell(vermelho, "contador", { fill: undefined });

  assert.deepEqual(semFundo.children[0].cell, { radius: 4 });
  assert.equal("cell" in inspector.withFreeCountdownCell(semFundo, "contador", { radius: undefined }).children[0], false);
  assert.equal(inspector.withFreeCountdownCell(design, "links", { radius: 4 }).children[1].cell, undefined, "só no Contador");
});

test("o quinto modelo (Contador com botão) é válido, conta até o fim do pop-up e tem o botão principal", () => {
  const design = starters.freeStarterDesign("countdown_cta");

  assert.equal(schema.popupFreeDesignSchema.safeParse(design).success, true);

  const nodes = [];

  model.walkFreeNodes(design.children, (node) => nodes.push(node));

  const contadores = nodes.filter((node) => node.type === "countdown");

  assert.equal(contadores.length, 1);
  assert.equal(contadores[0].until, undefined, "até o fim do pop-up");
  assert.ok(nodes.some((node) => node.type === "button" && node.action.kind === "cta"));
  assert.deepEqual(hintKeys(design), [], "o modelo passa no Revisar");
});

test("celular: o Contador herda o molde de texto dos Links (tamanho, linha, letras e alinhamento), sem chave nova", () => {
  const design = parsed([contador({ textStyle: { size: 40 } })], { devices: { mobile: { nodes: { contador: { textStyle: { align: "left", size: 28 } } } } } });

  assert.deepEqual(design.devices.mobile.nodes.contador, { textStyle: { align: "left", size: 28 } });
  assert.equal(render.resolveFreeForDevice(design, "mobile").children[0].textStyle.size, 28);
  assert.deepEqual(
    inspector.freeMobileFieldsOf(design.children[0]).filter((field) => field.group === "text").map((field) => field.key),
    ["textStyle.size", "textStyle.lineHeight", "textStyle.letterSpacing", "textStyle.align"]
  );
  assert.equal(issues([contador()], { devices: { mobile: { nodes: { contador: { gap: 4 } } } } }).length, 1, "o espaço do celular é só dos Links: no Contador é recusado");
});
