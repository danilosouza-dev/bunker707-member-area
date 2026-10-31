import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// A Simulacao desenhada (docs/30 §1.6, §1.7, §2.2, §4.3 e §8.6; D10; docs/18 §2.2), no Node e sem navegador: o card do
// editor com os tres blocos por sessao gravada (Contador de plateia, Entradas e saidas, Notificacoes de venda), o aviso
// do CDC, a frase de §8.6 com a caixa so quando algo mudou, a sessao encerrada so para ler com o que mostrou, o banco
// sem a 202610300003 (o aviso da migracao e o selo da fase 2) e o card lendo as regras; o formulario puro (erros em
// portugues, minutos dos avisos, mudanca, limite de 50); e a sala: o contador somado ao real no cabecalho, a entrada
// "Ana M. entrou" no chat por 8 s, o aviso de venda num toast de 4 s (no topo na sala vertical), o leitor de tela no
// maximo um aviso por minuto, prefers-reduced-motion sem deslizar e, sem regra ligada, tudo como hoje.

const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;
const STUBS = {
  "@/server/webinars/room-actions": `${fail}
export const saveSimulation = fail; export const openSessionNow = fail; export const endSessionNow = fail;`,
  "@/server/webinars/simulation-actions": `${fail}
export const loadSessionSimulations = fail; export const saveSessionSimulation = fail;`
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }
    return nextResolve(specifier, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { SimulationCard } = await import("../src/components/admin/v2/communication/webinars/simulation-card.tsx");
const { SimulationSessionRow } = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-session-row.tsx");
const form = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-card-model.ts");
const roomSimulation = await import("../src/components/member/webinars/room/room-simulation.tsx");
const { roomSimulationStateOf } = await import("../src/components/member/webinars/room/use-room-simulation.ts");
const header = await import("../src/components/member/webinars/room/room-header.tsx");
const roomLayout = await import("../src/components/member/webinars/room/room-layout-model.ts");
const model = await import("../src/server/webinars/simulation-model.ts");
const { SIMULATION_LIMITS } = await import("../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { SIMULATION_MESSAGES } = await import("../src/server/webinars/simulation-schemas.ts");

const COPY = WEBINAR_COPY.simulacao.card;
const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;

const MIN = 60_000;
const NOW = Date.parse("2026-11-05T23:05:00.000Z"); // 20:05 de 5/11 em Sao Paulo
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_NEXT = "bbbbbbbb-2222-4222-8222-222222222222";
const S_PAST = "bbbbbbbb-2222-4222-8222-333333333333";

function session(extra = {}) {
  return {
    browserRecordingAt: null,
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    endedAt: null,
    id: S_NEXT,
    jit: false,
    kind: "simulated",
    lateJoinMinutes: null,
    pinnedMessageId: null,
    presenceCurve: null,
    recorderAlertedAt: null,
    recorderReleaseRequestedAt: null,
    recorderRequestedAt: null,
    recorderStatus: "none",
    recordingAnchorAt: null,
    recordingId: null,
    recordingRequestedAt: null,
    roomLocked: false,
    roomName: null,
    scheduledAt: "2026-11-06T23:00:00.000Z",
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: "2026-11-01T12:00:00.000Z",
    webinarId: WEBINAR,
    ...extra
  };
}

const ended = session({ endedAt: "2026-11-04T00:00:00.000Z", id: S_PAST, scheduledAt: "2026-11-03T23:00:00.000Z", showLiveBadge: true, simulationAckText: "Decisão do produtor em 03/11/2026: …", simulationDecidedAt: "2026-11-03T12:00:00.000Z", simulationDecidedBy: "u-produtor", status: "ended" });
const simulations = {
  pendingMigration: false,
  simulations: [
    {
      countRule: { base: 40, jitter: 0, mode: "fixed", peak: 40 },
      joins: { enabled: true, everySeconds: 30, max: 50, names: "generic" },
      saleNotices: { enabled: true, items: [{ offsetMs: 11 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] },
      sessionId: S_NEXT,
      summary: null
    },
    {
      countRule: { base: 20, jitter: 5, mode: "curve", peak: 180 },
      joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" },
      saleNotices: { enabled: false, items: [] },
      sessionId: S_PAST,
      summary: { counterMax: 183, joinsShown: 0, saleNoticesShown: 0 }
    }
  ]
};
const card = (extra = {}) =>
  html(
    createElement(SimulationCard, {
      canPublish: true,
      currentUserName: "Produtora de Teste",
      deciderNames: { "u-produtor": "Produtora de Teste" },
      disabled: false,
      initialSimulations: simulations,
      now: NOW,
      sessions: [session(), ended, session({ id: "live", kind: "live" }), session({ id: "replay", kind: "replay" }), session({ id: "cancelada", status: "cancelled" }), session({ id: "jit-1", jit: true })],
      ...extra
    })
  );

/* ------------------------------------------------------------------------------------------------
 * O card do editor
 * ---------------------------------------------------------------------------------------------- */

test("card: o aviso do CDC, os tres blocos por sessao gravada com o que esta gravado; a live, o replay, a cancelada e a do Comeca quando voce entra ficam de fora; nada de frase sem mudanca", () => {
  const markup = card();
  const text = textOf(markup);
  assert.match(text, /Pela lei \(CDC, art\. 37\), nunca anuncie uma sessão gravada como ao vivo fora da área de membros\./);
  assert.match(text, /Números de plateia: reais, a não ser na sessão em que você ligar o contador ou as entradas\./);
  assert.match(text, /Números simulados aparecem no relatório só no bloco Simulação\./);
  assert.equal(count(markup, /data-simulation-session=/g), 2, "so as duas gravadas");
  assert.equal(count(markup, /data-simulation-block="contador"/g), 2);
  assert.equal(count(markup, /data-simulation-block="entradas"/g), 2);
  assert.equal(count(markup, /data-simulation-block="avisos"/g), 2);
  for (const label of ["Contador de plateia", "Só o real", "Real + número fixo", "Real + faixa que varia", "Entradas e saídas", "Notificações de venda", "Somar ao real", "Mínimo", "Máximo", "Variação"]) {
    assert.ok(text.includes(label), label);
  }
  assert.match(text, /O aluno vê quem está na sala \+ 40\./);
  assert.match(text, /A cada 30 s, com nomes genéricos/);
  assert.match(text, /“Ana M\. entrou” no chat, com nomes genéricos, nunca de alunos\./);
  assert.match(markup, /value="Carlos acabou de garantir a vaga na Formação"/);
  assert.match(markup, /value="11"/, "o minuto do aviso");
  assert.match(text, /Desligadas por padrão\./);
  assert.match(text, /Soma de \+20 a \+180/);
  assert.equal(count(markup, /role="switch"/g), 2, "o selo de cada sessao");
  assert.doesNotMatch(text, /Salvar simulação|Confirmo a decisão/, "a frase so aparece quando algo muda");
  assert.match(text, /Sessão encerrada: a decisão fica registrada como estava\./);
  assert.match(text, /Nesta sessão: contador com até \+183, 0 entradas e 0 avisos de venda\./);
  assert.match(text, /Decisão de Produtora de Teste em 03\/11\/2026 às 09:00\./);
  const encerrada = markup.slice(markup.indexOf(`data-simulation-session="${S_PAST}"`));
  assert.match(encerrada, /<input[^>]*disabled=""[^>]*id="[^"]*-base"/, "a encerrada so para ler");

  const soEscreve = textOf(card({ canPublish: false }));
  assert.match(soEscreve, /Só quem publica na Comunicação decide o selo\./);
});

test("card: uma mudanca pendente mostra a frase de §8.6 de hoje com o nome, a caixa e Salvar simulacao (desligado ate marcar) e Descartar", () => {
  const saved = simulations.simulations[0];
  const initialForm = { ...form.simulationFormOf(saved, false), countMode: "curve", base: "30", jitter: "4", peak: "250", showLiveBadge: true };
  const markup = html(
    createElement(SimulationSessionRow, {
      busy: false,
      deciderName: null,
      idBase: "t",
      initialForm,
      locked: false,
      mode: "v4",
      now: NOW,
      onFailure: () => undefined,
      onSaved: () => undefined,
      onSaving: () => undefined,
      responsible: "Produtora de Teste",
      saved,
      session: session()
    })
  );
  const text = textOf(markup);
  const frase = model.simulationAckFor({ nowMs: NOW, responsible: "Produtora de Teste", rules: form.simulationRulesOfForm(initialForm).rules });
  assert.match(frase, /^Decisão do produtor em 05\/11\/2026: .*o selo "Ao vivo" fica ligado, os números de plateia são simulados e os avisos de venda são simulados\. .*Responsável: Produtora de Teste\.$/);
  assert.ok(text.includes(frase), "a frase exata que o servidor confere");
  assert.match(markup, /data-simulation-sentence=""/);
  assert.match(text, /Confirmo a decisão acima para esta sessão\./);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Salvar simulação<\/button>/, "sem a caixa, nao salva");
  assert.match(text, /Descartar/);
  assert.match(text, /Marque a confirmação para gravar a decisão\./);
  assert.match(text, /Sem decisão registrada: o selo fica desligado\./);

  const comErro = html(createElement(SimulationSessionRow, { busy: false, deciderName: null, idBase: "e", initialForm: { ...initialForm, base: "300" }, locked: false, mode: "v4", now: NOW, onFailure: () => undefined, onSaved: () => undefined, onSaving: () => undefined, responsible: "X", saved, session: session() }));
  assert.match(textOf(comErro), /O máximo precisa ser maior ou igual ao mínimo\./);
  assert.match(textOf(comErro), /Corrija os campos marcados para gravar\./);
  assert.doesNotMatch(comErro, /data-simulation-sentence/);
});

test("card: banco sem a 202610300003 mostra o aviso da migracao e so o selo (fase 2); lendo, nada mexe", () => {
  const pendente = card({ initialSimulations: { migration: "202610300003", pendingMigration: true } });
  assert.match(textOf(pendente), /Esta parte precisa da atualização do banco \(migração 202610300003\)\./);
  assert.equal(count(pendente, /data-simulation-block=/g), 0, "sem os numeros");
  assert.equal(count(pendente, /role="switch"/g), 2, "o selo continua");

  const lendo = card({ initialSimulations: undefined });
  assert.match(textOf(lendo), /Carregando a simulação…/);
  assert.equal(count(lendo, /data-simulation-block=/g), 0);
  assert.equal(count(lendo, /role="switch"[^>]*/g), 2);
  assert.equal(count(lendo, /<button[^>]*disabled=""[^>]*role="switch"/g), 2, "lendo, o selo nao muda");
});

/* ------------------------------------------------------------------------------------------------
 * O formulario puro
 * ---------------------------------------------------------------------------------------------- */

test("formulario: os campos voltam como as regras do servidor; erros em portugues por campo; minutos dos avisos; mudanca; ate 50 avisos", () => {
  const base = form.simulationFormOf(null, false);
  assert.deepEqual(form.simulationRulesOfForm(base), { errors: {}, rules: model.normalizeSimulationRules({ countRule: { base: 0, jitter: 0, mode: "off", peak: 0 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, showLiveBadge: false }) });
  assert.equal(form.simulationFormChanged(base, form.savedSimulationRules(null, false)), false);
  assert.equal(form.simulationFormChanged({ ...base, joinsEnabled: true }, form.savedSimulationRules(null, false)), true);
  assert.equal(form.simulationFormChanged({ ...base, salesEnabled: true }, form.savedSimulationRules(null, false)), false, "avisos ligados sem nenhum: o mesmo que desligados");

  const erros = form.simulationRulesOfForm({ ...base, countMode: "curve", base: "abc", everySeconds: "5", joinsEnabled: true, joinsMax: "5000", jitter: "9999", peak: "10", salesEnabled: true, sales: [{ key: "a", minute: "12:75", text: " " }] }).errors;
  assert.deepEqual(erros, {
    base: COPY.numeroInvalido,
    everySeconds: COPY.segundosInvalidos(10, 3600),
    jitter: COPY.variacaoInvalida(5000),
    joinsMax: COPY.maximoInvalido(1000),
    "sales.a.minute": COPY.avisoMinutoInvalido,
    "sales.a.text": SIMULATION_MESSAGES.saleText
  });

  assert.equal(form.minuteMarkToMs("12"), 12 * MIN);
  assert.equal(form.minuteMarkToMs(" 12:30 "), 12 * MIN + 30_000);
  assert.equal(form.minuteMarkToMs("12.5"), null);
  assert.equal(form.minuteMarkOf(12 * MIN + 30_000), "12:30");
  assert.equal(form.minuteMarkOf(12 * MIN), "12");

  let cheio = { ...base, salesEnabled: true };
  for (let index = 0; index < SIMULATION_LIMITS.saleNoticesMax + 3; index += 1) {
    cheio = form.addSaleNotice(cheio);
  }
  assert.equal(cheio.sales.length, SIMULATION_LIMITS.saleNoticesMax);
  assert.equal(new Set(cheio.sales.map((item) => item.key)).size, SIMULATION_LIMITS.saleNoticesMax, "chaves unicas");
  const semUm = form.removeSaleNotice(cheio, cheio.sales[3].key);
  assert.equal(semUm.sales.length, SIMULATION_LIMITS.saleNoticesMax - 1);
  const editado = form.updateSaleNotice(semUm, semUm.sales[0].key, { minute: "3", text: "Bia garantiu" });
  assert.deepEqual([editado.sales[0].minute, editado.sales[0].text], ["3", "Bia garantiu"]);
});

/* ------------------------------------------------------------------------------------------------
 * A sala do aluno
 * ---------------------------------------------------------------------------------------------- */

const roomData = {
  counter: [
    { atMs: 0, extra: 40 },
    { atMs: 15_000, extra: 55 }
  ],
  enabled: true,
  joins: [
    { atMs: 20_000, name: "Ana M." },
    { atMs: 50_000, left: true, name: "Bruno S." }
  ],
  saleNotices: [{ atMs: 30_000, text: "Carlos acabou de garantir a vaga na Formação" }]
};

test("sala: o cabecalho mostra o real mais a parte simulada daquele instante; sem regra ligada, so o real", () => {
  const state = roomSimulationStateOf(roomData);
  assert.equal(state.displayCount(3, 5_000), 43);
  assert.equal(state.displayCount(3, 16_000), 58);
  const markup = html(
    createElement(header.RoomHeader, {
      dateLine: "Quinta, 5 de novembro · 20:00 · 60 min",
      mobileLine: roomLayout.roomMobileLine({ presenterName: null, presentNow: state.displayCount(3, 16_000) }).join(" · "),
      onLeave: () => undefined,
      onToggleTheme: () => undefined,
      presentNow: state.displayCount(3, 16_000),
      theme: "dark",
      title: "Aula de IA"
    })
  );
  assert.match(markup, /data-testid="room-present">[\s\S]*?58 assistindo</, "no computador");
  assert.match(markup, /data-testid="room-mobile-line">58 assistindo</, "e na linha do celular");

  const nada = roomSimulationStateOf(model.EMPTY_SIMULATION_ROOM);
  assert.equal(nada.displayCount(3, 16_000), 3);
  assert.equal(html(createElement(roomSimulation.RoomSimulationSales, { layout: "stage", offsetMs: 31_000, reducedMotion: false, state: nada })), "", "sem regra, nada na sala");
  assert.equal(html(createElement(roomSimulation.RoomSimulationJoins, { layout: "stage", offsetMs: 21_000, reducedMotion: false, state: nada })), "");
});

test("sala: 'Ana M. entrou' no chat por 8 s (so visual, sem anunciar), 'saiu' tambem; o aviso de venda por 4 s por cima do palco, no topo na vertical; o leitor de tela ouve o aviso; sem deslizar com reduced motion", () => {
  const state = roomSimulationStateOf(roomData);
  const props = (offsetMs, extra = {}) => ({ layout: "stage", offsetMs, reducedMotion: false, state, ...extra });

  const entrou = html(createElement(roomSimulation.RoomSimulationJoins, props(24_000)));
  assert.match(textOf(entrou), /^Ana M\. entrou$/);
  assert.match(entrou, /aria-hidden="true"/);
  assert.match(entrou, /data-room-simulation-join="entrou"/);
  assert.match(entrou, /animate-in/);
  assert.equal(html(createElement(roomSimulation.RoomSimulationJoins, props(29_000))), "", "depois de 8 s some");
  assert.equal(html(createElement(roomSimulation.RoomSimulationJoins, props(19_000))), "", "antes do segundo dela, nada");
  assert.match(textOf(html(createElement(roomSimulation.RoomSimulationJoins, props(52_000)))), /^Bruno S\. saiu$/);
  assert.doesNotMatch(html(createElement(roomSimulation.RoomSimulationJoins, props(24_000, { reducedMotion: true }))), /animate-in/, "prefers-reduced-motion");

  const aviso = html(createElement(roomSimulation.RoomSimulationSales, props(31_000)));
  assert.match(aviso, /data-room-simulation-sale=""[^>]*>|data-room-simulation-sale=""/);
  assert.match(aviso, /<div aria-hidden="true"[^>]*left-4 top-14/, "por cima do palco, discreto, abaixo dos selos de cima (docs/31 V2-4)");
  assert.match(aviso, /aria-live="polite"[^>]*>Aviso: Carlos acabou de garantir a vaga na Formação</);
  assert.match(textOf(aviso), /Carlos acabou de garantir a vaga na Formação/);
  const depois = html(createElement(roomSimulation.RoomSimulationSales, props(34_000)));
  assert.doesNotMatch(depois, /data-room-simulation-sale/, "4 s na tela");
  assert.match(depois, /aria-live="polite"/, "a regiao do leitor de tela fica");
  assert.match(html(createElement(roomSimulation.RoomSimulationSales, props(31_000, { layout: "vertical" }))), /top-14/, "no topo da sala vertical");
  assert.doesNotMatch(html(createElement(roomSimulation.RoomSimulationSales, props(31_000, { reducedMotion: true }))), /animate-in/);
  const antes = html(createElement(roomSimulation.RoomSimulationSales, props(10_000)));
  assert.match(antes, /aria-live="polite"[^>]*><\/p>/, "nada anunciado antes do primeiro aviso");
});
