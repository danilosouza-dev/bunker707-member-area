import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// A Simulacao desenhada (docs/30 §1.6, §1.7, §2.2, §4.3 e §8.6; D10; docs/18 §2.2), no Node e sem navegador: o card do
// editor com os tres blocos por sessao gravada (Contador de plateia, Entradas e saidas, Notificacoes de venda), o aviso
// do CDC, o Salvar direto so quando algo mudou (sem frase nem caixa desde 12/11/2026, D85), a sessao encerrada so para ler com o que mostrou, o banco
// sem a 202610300003 (o aviso da migracao e o selo da fase 2) e o card lendo as regras; o formulario puro (erros em
// portugues, minutos dos avisos, mudanca, limite de 50); e a sala: o contador somado ao real no cabecalho, a entrada
// "Ana M. entrou" no chat por 8 s, o aviso de venda num toast de 4 s (no topo na sala vertical), o leitor de tela no
// maximo um aviso por minuto, prefers-reduced-motion sem deslizar e, sem regra ligada, tudo como hoje. Revisao v8
// (achado 6): o salvar leva a hora da decisao que o card carregou, e a recusa "mudou em outro lugar" mostra o Recarregar.

const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;
const STUBS = {
  "@/server/webinars/room-actions": `${fail}
export const saveSimulation = fail; export const openSessionNow = fail; export const endSessionNow = fail;`,
  "@/server/webinars/simulation-actions": `${fail}
export const loadSessionSimulations = fail; export const saveSessionSimulation = fail; export const saveSimulatedAudience = fail;`
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
const { SimulationCard, SimulationFailureBanner } = await import("../src/components/admin/v2/communication/webinars/simulation-card.tsx");
const { SimulationSessionRow } = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-session-row.tsx");
const form = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-card-model.ts");
const roomSimulation = await import("../src/components/member/webinars/room/room-simulation.tsx");
const { roomSimulationStateOf } = await import("../src/components/member/webinars/room/use-room-simulation.ts");
const header = await import("../src/components/member/webinars/room/room-header.tsx");
const stageBadges = await import("../src/components/member/webinars/room/room-stage-badges.tsx");
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
  // D79 (11/11/2026): o card fala de participantes, e a trava das entradas e dos avisos fica no alto, visivel.
  assert.match(text, /Números de plateia: reais, a não ser na sessão em que você somar participantes simulados ou ligar as entradas\./);
  assert.match(markup, /data-simulation-card=""><p[^>]*data-simulation-locked-note="">Os participantes simulados mudam a qualquer momento, também no ar, aqui ou no console\. As entradas e os avisos de venda simulados travam quando a sessão começa\.<\/p>/, "o aviso da trava e o primeiro do card");
  assert.match(text, /Números simulados aparecem no relatório só no bloco Simulação\./);
  assert.equal(count(markup, /data-simulation-session=/g), 2, "so as duas gravadas");
  assert.equal(count(markup, /data-simulation-block="contador"/g), 2);
  assert.equal(count(markup, /data-simulation-block="entradas"/g), 2);
  assert.equal(count(markup, /data-simulation-block="avisos"/g), 2);
  for (const label of ["Participantes simulados", "Só o real", "Real + número fixo", "Real + faixa que varia", "Entradas e saídas", "Notificações de venda", "Somar ao real", "Mínimo", "Máximo", "Variação"]) {
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
  assert.doesNotMatch(text, /Salvar simulação|Confirmo a decisão/, "o Salvar so aparece quando algo muda; a caixa nao existe mais (D85)");
  assert.doesNotMatch(text, /Decisão do produtor em/, "a frase gravada nao aparece mais no card (D85); fica quem decidiu e quando");
  assert.match(text, /Sessão encerrada: a decisão fica registrada como estava\./);
  assert.match(text, /Nesta sessão: contador com até \+183, 0 entradas e 0 avisos de venda\./);
  assert.match(text, /Decisão de Produtora de Teste em 03\/11\/2026 às 09:00\./);
  const encerrada = markup.slice(markup.indexOf(`data-simulation-session="${S_PAST}"`));
  assert.match(encerrada, /<input[^>]*disabled=""[^>]*id="[^"]*-base"/, "a encerrada so para ler");

  const soEscreve = textOf(card({ canPublish: false }));
  assert.match(soEscreve, /Só quem publica na Comunicação decide o selo\./);
});

test("card (D85, decisao do produtor em 12/11/2026): uma mudanca pendente mostra so Salvar simulacao, ligado de primeira, e Descartar; sem frase nem caixa", () => {
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
  assert.ok(!text.includes(frase), "a frase que o servidor grava nao aparece na tela");
  assert.doesNotMatch(markup, /data-simulation-sentence|type="checkbox"/, "sem frase e sem caixa");
  assert.doesNotMatch(text, /Confirmo a decisão|Marque a confirmação/);
  assert.match(markup, /data-simulation-confirm=""/, "o bloco do Salvar");
  assert.match(markup, /<button[^>]*>Salvar simulação<\/button>/);
  assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>Salvar simulação<\/button>/, "o Salvar ligado de primeira");
  assert.match(text, /Descartar/);
  assert.match(text, /Sem decisão registrada: o selo fica desligado\./);

  const comErro = html(createElement(SimulationSessionRow, { busy: false, deciderName: null, idBase: "e", initialForm: { ...initialForm, base: "300" }, locked: false, mode: "v4", now: NOW, onFailure: () => undefined, onSaved: () => undefined, onSaving: () => undefined, responsible: "X", saved, session: session() }));
  assert.match(textOf(comErro), /O máximo precisa ser maior ou igual ao mínimo\./);
  assert.match(textOf(comErro), /Corrija os campos marcados para gravar\./);
  assert.match(comErro, /<button[^>]*disabled=""[^>]*>Salvar simulação<\/button>/, "com erro no formulario, o Salvar fica desligado");
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

test("sala: o selo de quem assiste no palco mostra o real mais a parte simulada daquele instante; sem regra ligada, so o real", () => {
  const state = roomSimulationStateOf(roomData);
  assert.equal(state.displayCount(3, 5_000), 43);
  assert.equal(state.displayCount(3, 16_000), 58);
  // O numero somado vai para o selo do palco, ao lado do selo do momento (docs/31 §11.5); o cabecalho nao o leva mais.
  const present = roomLayout.roomPresentBadge(state.displayCount(3, 16_000));
  assert.deepEqual(present, { count: "58", label: "58 assistindo agora" });
  const palco = html(createElement(stageBadges.RoomStageBadges, { assistantOn: false, present, presenterName: null, recording: false, topLeft: { kind: "session", timeLabel: "20:00" } }));
  assert.match(palco, /Sessão das 20:00<\/span><span class="[^"]*" data-testid="room-present" title="58 assistindo agora">[\s\S]*?<span aria-hidden="true">58<\/span><span class="sr-only">58 assistindo agora<\/span>/);
  const markup = html(
    createElement(header.RoomHeader, {
      metaLine: roomLayout.roomDateLine({ durationMinutes: 60, kind: "simulated", presenterName: null, scheduledAt: "2026-11-05T23:00:00.000Z" }).join(" · "),
      mobileLine: roomLayout.roomMobileLine(null),
      onLeave: () => undefined,
      onToggleTheme: () => undefined,
      theme: "dark",
      title: "Aula de IA"
    })
  );
  assert.match(markup, /data-room-line="meta">Quinta, 5 de novembro · 20:00 · 60 min</);
  assert.doesNotMatch(markup, /assistindo|room-present|room-mobile-line/, "o cabecalho sem o numero; sem apresentador, sem a linha do celular");

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

/* ------------------------------------------------------------------------------------------------
 * A Live ao vivo (adendo de 10/11/2026, R7)
 * ---------------------------------------------------------------------------------------------- */

const liveSession = (extra = {}) => session({ id: "dddddddd-4444-4444-8444-444444444444", kind: "live", scheduledAt: "2026-11-05T23:00:00.000Z", status: "waiting", ...extra });

test("R7 card na Live ao vivo: o aviso do CDC da live, 'Live de ...' sem o selo \"Ao vivo\", o minuto do aviso contado da live; so a sessao da live (nunca o Replay)", () => {
  const markup = card({
    initialSimulations: { pendingMigration: false, simulations: [{ ...simulations.simulations[0], sessionId: liveSession().id }] },
    sessions: [liveSession(), session({ id: "replay", kind: "replay" })],
    webinarKind: "live"
  });
  const text = textOf(markup);
  assert.match(text, /Pela lei \(CDC, art\. 37\), nunca divulgue fora da área de membros os números simulados como se fossem reais\./);
  assert.doesNotMatch(text, /nunca anuncie uma sessão gravada como ao vivo/);
  assert.match(text, /Números de plateia: reais, a não ser que você some participantes simulados ou ligue as entradas da live\./);
  assert.equal(count(markup, /data-simulation-session=/g), 1, "so a sessao da live");
  assert.match(text, /Live de 05\/11\/2026 às 20:00/);
  assert.equal(count(markup, /role="switch"/g), 0, "a live nunca tem o selo Ao vivo da gravada");
  assert.match(text, /Minuto da live/);
  assert.match(text, /Contado do Começar para todos/);
  assert.doesNotMatch(text, /Minuto do vídeo/);

  const semPublicar = textOf(card({ canPublish: false, sessions: [liveSession()], webinarKind: "live" }));
  assert.match(semPublicar, /Só quem publica na Comunicação decide a Simulação\./);
  const semSessao = textOf(card({ sessions: [], webinarKind: "live" }));
  assert.match(semSessao, /A sessão da live aparece aqui depois de publicar o webinário\./);
  const semMigracao = card({ initialSimulations: { migration: "202610300003", pendingMigration: true }, sessions: [liveSession()], webinarKind: "live" });
  assert.match(textOf(semMigracao), /migração 202610300003/);
  assert.equal(count(semMigracao, /data-simulation-session=/g), 0, "sem a Simulacao completa, a live nao tem o que decidir");
});

test("R7 card na Live ao vivo: a mudanca mostra o Salvar direto (a frase da live e so do servidor, D85); a live ja comecada fica so para ler", () => {
  const saved = simulations.simulations[0];
  const initialForm = { ...form.simulationFormOf(saved, false), base: "300", countMode: "fixed" };
  const row = (extra) =>
    html(
      createElement(SimulationSessionRow, {
        busy: false,
        deciderName: null,
        idBase: "l",
        initialForm,
        locked: false,
        mode: "v4",
        now: NOW,
        onFailure: () => undefined,
        onSaved: () => undefined,
        onSaving: () => undefined,
        responsible: "Produtora de Teste",
        saved,
        session: liveSession(),
        ...extra
      })
    );
  const text = textOf(row({}));
  const frase = model.simulationAckFor({ live: true, nowMs: NOW, responsible: "Produtora de Teste", rules: form.simulationRulesOfForm(initialForm).rules });
  assert.equal(frase, "Decisão do produtor em 05/11/2026: nesta live ao vivo, dentro da área de membros, os números de plateia são simulados e os avisos de venda são simulados. Responsável: Produtora de Teste.");
  assert.ok(!text.includes(frase), "a frase nao aparece na tela (D85)");
  assert.equal(form.simulationFormSentence(initialForm, { live: true, nowMs: NOW, responsible: "Produtora de Teste" }), frase);
  assert.doesNotMatch(text, /Confirmo a decisão/);
  assert.match(text, /Salvar simulação/);

  // D79 (11/11/2026, reabre o D74 so para o numero): ja no ar, as entradas e os avisos ficam travados, e os participantes
  // simulados mudam pelo controle proprio no lugar do bloco do contador, com o atalho para o console.
  const audience = {
    changes: [{ atMs: 60_000, changedAt: "2026-11-05T23:02:00.000Z", changedByName: "Produtora de Teste", extra: 300, id: "m1", source: "console" }],
    current: { base: 300, jitter: 0, mode: "fixed", peak: 300 },
    flags: { badgeOn: false, joinsSimulated: true, saleNoticesSimulated: true },
    pendingMigration: false,
    rampEndsAtMs: null
  };
  const noAr = row({ audience, consoleHref: "/admin/comunicacao/webinarios/w/sala?sessao=s", session: liveSession({ startedAt: "2026-11-05T23:01:00.000Z", status: "live" }) });
  const noArText = textOf(noAr);
  assert.match(noArText, /A live já começou: os participantes simulados mudam aqui ou no console; as entradas e os avisos de venda ficam como estão até o fim\./);
  assert.doesNotMatch(noAr, /data-simulation-confirm/, "o Salvar simulacao nao volta no ar");
  assert.doesNotMatch(noAr, /id="l-base"/, "o bloco do contador da lugar ao controle");
  assert.match(noAr, /data-simulation-audience=""/);
  assert.match(noAr, /data-simulation-audience-now="">\+300</);
  assert.match(noArText, /Mudado por Produtora de Teste em 05\/11\/2026 às 20:02, pelo console\./);
  assert.match(noAr, /<a[^>]*data-simulation-console-link=""[^>]*href="\/admin\/comunicacao\/webinarios\/w\/sala\?sessao=s"[^>]*>Mudar no console<\/a>/);
  assert.match(noAr, /<input[^>]*disabled=""[^>]*id="l-every"/, "as entradas travadas no ar");
  // Sem a vista (o card ainda lendo ou o banco sem a Simulacao completa), o contador fica so para ler, como antes.
  const semVista = row({ session: liveSession({ startedAt: "2026-11-05T23:01:00.000Z", status: "live" }) });
  assert.match(semVista, /<input[^>]*disabled=""[^>]*id="l-base"/);
  assert.match(textOf(semVista), /Sem decisão registrada: nada simulado aparece na live\./, "a live nunca fala do selo");
});

test("R7 sala ao vivo: o selo de quem assiste soma a parte simulada no relogio desde o started_at (nunca pela ancora); na espera, o numero do zero", async () => {
  const { readFileSync } = await import("node:fs");
  const state = roomSimulationStateOf(roomData);
  const startedAt = "2026-11-05T23:10:00.000Z";
  const agora = Date.parse(startedAt) + 16_000;
  const offset = model.simulationClockMs({ kind: "live", scheduledAt: "2026-11-05T23:00:00.000Z", startedAt }, agora);
  assert.equal(offset, 16_000);
  assert.deepEqual(roomLayout.roomPresentBadge(state.displayCount(3, offset)), { count: "58", label: "58 assistindo agora" });
  const espera = model.simulationClockMs({ kind: "live", scheduledAt: "2026-11-05T23:00:00.000Z", startedAt: null }, agora);
  assert.equal(state.displayCount(3, espera), 3 + model.counterExtraFromPoints(roomData.counter, -1000));
  // A sala ao vivo liga a Simulacao pelo relogio da live e leva as entradas ao chat e o aviso de venda ao palco.
  const source = readFileSync(new URL("../src/components/member/webinars/room/live-room.tsx", import.meta.url), "utf8");
  assert.match(source, /useRoomSimulation\(\{ enabled: !readOnly && !blocked && phase !== "ended", getOffsetMs: getSimulationOffsetMs/);
  assert.match(source, /getSimulationOffsetMs = \(\) => simulationClockMs\(\{ kind: "live", scheduledAt, startedAt \}/);
  assert.match(source, /aboveComposer=\{<RoomSimulationJoins layout="stage" look="comment" offsetMs=\{simulationOffsetMs\}/);
  // O aviso de venda fica na celula de cima a esquerda da camada da Na tela, o ultimo dela, como na gravada (docs/31 §12):
  // abaixo das pilulas das fixadas, sem nunca cobri-las; a camada aparece com a Simulacao ligada mesmo sem banner.
  assert.match(source, /topLeftExtra=\{blocked \? null : <RoomSimulationSales layout="cell" offsetMs=\{simulationOffsetMs\}/);
  assert.match(source, /\|\| \(!blocked && simulation\.enabled\) \? \(\s*<RoomScreenLayer/);
  assert.doesNotMatch(source, /<RoomSimulationSales layout="stage"/, "nunca solta por cima das fixadas");
});

test("revisao v8, achado 6: o salvar leva a hora da decisao que o card carregou; a recusa \"mudou em outro lugar\" mostra a frase com o Recarregar (as outras falhas, o Fechar)", async () => {
  // A hora que vai no salvar: a lida junto com as regras; sem ela (os dubles antigos), a da sessao; nula sem decisao.
  assert.equal(form.simulationExpectedDecidedAt({ decidedAt: "2026-11-05T20:00:00.000Z" }, { simulationDecidedAt: "2026-11-01T10:00:00.000Z" }), "2026-11-05T20:00:00.000Z");
  assert.equal(form.simulationExpectedDecidedAt({ decidedAt: null }, { simulationDecidedAt: "2026-11-01T10:00:00.000Z" }), null, "as regras lidas sem decisao valem mais que a pagina");
  assert.equal(form.simulationExpectedDecidedAt({}, { simulationDecidedAt: "2026-11-01T10:00:00.000Z" }), "2026-11-01T10:00:00.000Z");
  assert.equal(form.simulationExpectedDecidedAt(null, { simulationDecidedAt: null }), null);

  const frase = WEBINAR_COPY.simulacao.servidor.mudouEmOutroLugar;
  assert.equal(frase, "A simulação desta sessão mudou em outro lugar. Recarregue para ver o número de agora.");
  assert.equal(form.simulationChangedElsewhere({ message: frase, status: 409 }), true);
  assert.equal(form.simulationChangedElsewhere({ message: WEBINAR_COPY.simulacao.servidor.comecou, status: 409 }), false, "o 409 da sessao que comecou nao recarrega");
  assert.equal(form.simulationChangedElsewhere(null), false);

  const mudou = html(createElement(SimulationFailureBanner, { failure: { message: frase, status: 409 }, onClose: () => undefined, onReload: () => undefined }));
  assert.match(textOf(mudou), /A simulação desta sessão mudou em outro lugar\. Recarregue para ver o número de agora\./);
  assert.match(mudou, /<button[^>]*data-simulation-reload=""[^>]*>Recarregar<\/button>/);
  assert.doesNotMatch(textOf(mudou), /Fechar/);
  const outra = html(createElement(SimulationFailureBanner, { failure: { message: "Falhou.", status: 500 }, onClose: () => undefined, onReload: () => undefined }));
  assert.match(textOf(outra), /Falhou\. Fechar/);
  assert.doesNotMatch(outra, /data-simulation-reload/);

  // A linha manda a hora no salvar (o fonte: o pedido leva expectedDecidedAt pelo ajudante do modelo).
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/components/admin/v2/communication/webinars/simulation/simulation-session-row.tsx", import.meta.url), "utf8");
  assert.match(source, /expectedDecidedAt: simulationExpectedDecidedAt\(saved, session\)/);
});
