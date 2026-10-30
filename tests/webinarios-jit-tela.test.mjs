import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O "Comeca quando voce entra" desenhado (docs/30 §1.1, §1.2, §1.6, §2.2, §2.7, §8.6 e A14; docs/18 §1.1): o card do
// editor (dentro do card Sessoes, que saiu do "em breve": ligar, a cada 15 / 30 / 60 min, a janela de horas de
// Brasilia, a Entrada atrasada, a Simulacao das sessoes que nascem ali com o aviso do CDC, quem decidiu e as sessoes
// que nasceram hoje com o console; antes do primeiro salvar, so a frase; sem o video, nao liga), a parte pura do card
// (o formulario, a decisao nova so quando as regras simuladas mudam, o pedido do salvar), a pagina do aluno ("A próxima
// sessão começa em {n} min" e o Entrar, sem Garantir vaga; a sessao que ja comecou; fora do horario sem o Entrar; no
// "ver como", o Entrar desligado) e /webinarios (um card so com o selo, nunca uma sessao jit por card).

const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;
const STUBS = {
  "@/server/webinars/jit-actions": `${fail} export const saveJitSettings = fail; export const loadJitSettings = fail;`
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }
    return nextResolve(specifier, context);
  }
});

const { JitCard } = await import("../src/components/admin/v2/communication/webinars/jit/jit-card.tsx");
const cardModel = await import("../src/components/admin/v2/communication/webinars/jit/jit-card-model.ts");
const { SessionsCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
const pageView = await import("../src/components/member/webinars/webinar-page-view.tsx");
const listView = await import("../src/components/member/webinars/webinars-page-view.tsx");
const { HomeLivesRow } = await import("../src/components/member/webinars/home-lives-row.tsx");
const { isJitRoomHref } = await import("../src/components/member/webinars/jit/jit-client.ts");
const model = await import("../src/server/webinars/model.ts");
const student = await import("../src/server/webinars/student-model.ts");
const { normalizeSimulationRules, simulationAckFor } = await import("../src/server/webinars/simulation-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const html = (component, props) => renderToStaticMarkup(createElement(component, props));
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const sp = (texto) => Date.parse(`${texto}-03:00`);
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const PRODUTORA = "00000000-0000-4000-8000-0000000000f1";
const JIT_ON = { ...model.defaultJitSettings(), enabled: true };
const NOW = sp("2026-10-29T10:07:00");

const regras = normalizeSimulationRules({
  countRule: { base: 30, jitter: 0, mode: "fixed", peak: 30 },
  joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" },
  saleNotices: { enabled: false, items: [] },
  showLiveBadge: true
});
const decidido = { ...regras, ackText: simulationAckFor({ nowMs: sp("2026-10-28T12:00:00"), responsible: "Produtora de Teste", rules: regras }), decidedAt: "2026-10-28T15:00:00.000Z", decidedBy: PRODUTORA };

const cardProps = (extra = {}) => ({
  canPublish: true,
  currentUserName: "Produtora de Teste",
  deciderNames: { [PRODUTORA]: "Produtora de Teste" },
  disabled: false,
  hasVideo: true,
  initial: JIT_ON,
  now: NOW,
  sessionsToday: [],
  webinarId: WEBINAR,
  ...extra
});

test("o card do editor: ligar, a cada 15/30/60 min, a janela de Brasilia, a Entrada atrasada, a Simulacao com o CDC e as sessoes de hoje", () => {
  const sessoes = [
    { id: "bbbbbbbb-0000-4000-8000-000000000001", scheduledAt: new Date(sp("2026-10-29T10:00:00")).toISOString(), status: "live" },
    { id: "bbbbbbbb-0000-4000-8000-000000000002", scheduledAt: new Date(sp("2026-10-29T09:45:00")).toISOString(), status: "ended" }
  ];
  const markup = html(JitCard, cardProps({ initial: { ...JIT_ON, lateJoinMinutes: 5, simulation: decidido }, sessionsToday: sessoes }));
  const text = textOf(markup);

  assert.match(text, /Começa quando você entra/);
  assert.match(markup, /id="webinar-jit-enabled"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="webinar-jit-enabled"/);
  for (const label of ["15 min", "30 min", "60 min", "Uma sessão a cada", "Início da janela", "Fim da janela", "horário de Brasília", "Entrada atrasada", "Até o fim", "Até um minuto"]) {
    assert.match(text, new RegExp(label), label);
  }
  assert.match(text, /Entre 08:00 e 23:00 \(horário de Brasília\)/);
  assert.match(markup, /<option value="8" selected="">08:00<\/option>/);
  assert.match(markup, /<option value="23" selected="">23:00<\/option>/);
  assert.match(markup, /<option value="24">24:00<\/option>/, "o fim vai ate 24:00");
  assert.match(markup, /value="5"/, "os minutos da Entrada atrasada");
  assert.match(text, new RegExp(WEBINAR_COPY.jit.card.turma.slice(0, 40)));
  assert.match(text, /Simulação das sessões que nascem aqui/);
  assert.match(text, /CDC, art\. 37/);
  assert.match(text, /Contador de plateia/);
  assert.match(text, /Decisão de Produtora de Teste em 28\/10\/2026/);
  assert.match(text, /Sessões que nasceram hoje/);
  assert.match(text, /Começou às 10:00/);
  assert.match(text, /Começou às 09:45/);
  assert.match(markup, new RegExp(`href="/admin/comunicacao/webinarios/${WEBINAR}/sala\\?sessao=bbbbbbbb-0000-4000-8000-000000000001"`));
  assert.doesNotMatch(text, /em breve/);
  assert.doesNotMatch(markup, /data-jit-confirm/, "nada mudou: sem a caixa");
  assert.doesNotMatch(markup, /data-jit-save/, "nada mudou: sem o Salvar");

  const desligado = textOf(html(JitCard, cardProps({ initial: model.defaultJitSettings() })));
  assert.match(desligado, /Desligado: valem só as sessões marcadas acima\./);
  assert.doesNotMatch(desligado, /Uma sessão a cada|Sessões que nasceram hoje/, "desligado, so o interruptor");

  const semVideo = html(JitCard, cardProps({ hasVideo: false, initial: model.defaultJitSettings() }));
  assert.match(semVideo, /id="webinar-jit-enabled"[^>]*disabled=""|disabled=""[^>]*id="webinar-jit-enabled"/, "sem o video nao liga");
  assert.match(textOf(semVideo), /Cole o endereço do vídeo no card Dados/);

  const antesDeSalvar = textOf(html(JitCard, cardProps({ webinarId: null })));
  assert.match(antesDeSalvar, /Salve o rascunho primeiro/);
  assert.doesNotMatch(antesDeSalvar, /Ligar Começa quando você entra/);

  const semPublicar = textOf(html(JitCard, cardProps({ canPublish: false, initial: { ...JIT_ON, simulation: decidido } })));
  assert.match(semPublicar, /Só quem publica na Comunicação liga o selo ou os números simulados\./);

  const hoje = textOf(html(JitCard, cardProps()));
  assert.match(hoje, /Ninguém entrou hoje ainda\./);
});

test("o card Sessoes saiu do 'em breve' e termina com o Comeca quando voce entra", () => {
  const draft = { ...model.emptyWebinarDraft("simulated"), sessions: [{ lateJoinMinutes: null, scheduledAt: "2026-11-06T23:00:00.000Z" }] };
  const props = { disabled: false, draft, errorFor: () => undefined, now: NOW, onBlur: () => undefined, onChange: () => undefined, replay: null, savedSessions: [], webinarId: WEBINAR };
  const comJit = textOf(html(SessionsCard, { ...props, jit: cardProps() }));
  assert.match(comJit, /Ligar Começa quando você entra/);
  assert.doesNotMatch(comJit, /Começa quando você entra · em breve/);
  const semJit = textOf(html(SessionsCard, props));
  assert.doesNotMatch(semJit, /em breve/);
});

test("a parte pura do card: o formulario, os erros, a decisao nova so quando as regras simuladas mudam e o pedido do salvar", () => {
  const salvo = { ...JIT_ON, lateJoinMinutes: 5, simulation: decidido };
  const form = cardModel.jitFormOf(salvo);
  assert.deepEqual([form.enabled, form.everyMinutes, form.startHour, form.endHour, form.lateJoin, form.lateJoinMinutes], [true, 15, 8, 23, "until", "5"]);
  assert.equal(form.simulation.showLiveBadge, true);
  assert.equal(form.simulation.countMode, "fixed");
  assert.equal(cardModel.jitFormChanged(form, salvo), false);
  assert.equal(cardModel.jitNeedsDecision(form, salvo), false, "as mesmas regras decididas seguem");

  const janela = { ...form, everyMinutes: 30 };
  assert.equal(cardModel.jitFormChanged(janela, salvo), true);
  assert.equal(cardModel.jitNeedsDecision(janela, salvo), false, "mudar a janela nao pede decisao");
  const pedidoJanela = cardModel.jitSaveRequest(janela, { acknowledged: false, saved: salvo, sentence: null, webinarId: WEBINAR });
  assert.equal(pedidoJanela.settings.everyMinutes, 30);
  assert.equal(pedidoJanela.settings.simulation.ackText, decidido.ackText, "a frase gravada volta: a decisao fica como estava");
  assert.equal(pedidoJanela.settings.simulation.acknowledged, true);

  const outroNumero = { ...form, simulation: { ...form.simulation, base: "50", peak: "50" } };
  assert.equal(cardModel.jitNeedsDecision(outroNumero, salvo), true);
  const frase = cardModel.jitFormSentence(outroNumero, { nowMs: NOW, responsible: "Produtora de Teste" });
  assert.match(frase, /Decisão do produtor em 29\/10\/2026/);
  assert.match(frase, /Responsável: Produtora de Teste\./);
  assert.equal(cardModel.jitSaveRequest(outroNumero, { acknowledged: false, saved: salvo, sentence: frase, webinarId: WEBINAR }), null, "sem a caixa nao salva");
  const pedido = cardModel.jitSaveRequest(outroNumero, { acknowledged: true, saved: salvo, sentence: frase, webinarId: WEBINAR });
  assert.deepEqual(pedido.settings.simulation.countRule, { base: 50, jitter: 0, mode: "fixed", peak: 50 });
  assert.equal(pedido.settings.simulation.ackText, frase);

  const tudoDesligado = { ...form, simulation: { ...form.simulation, countMode: "off", showLiveBadge: false } };
  assert.equal(cardModel.jitNeedsDecision(tudoDesligado, salvo), false);
  assert.equal(cardModel.jitSaveRequest(tudoDesligado, { acknowledged: false, saved: salvo, sentence: null, webinarId: WEBINAR }).settings.simulation, null, "tudo desligado: sem Simulacao");

  const erros = cardModel.jitFormValue({ ...form, endHour: 8, lateJoinMinutes: "abc", startHour: 8 });
  assert.equal(erros.value, null);
  assert.ok(erros.errors.endHour);
  assert.ok(erros.errors.lateJoinMinutes);
  assert.equal(cardModel.jitFormValue({ ...form, lateJoin: "always" }).value.lateJoinMinutes, null, "ate o fim = nulo");
  assert.ok(cardModel.jitFormValue({ ...form, simulation: { ...form.simulation, base: "x" } }).errors["simulation.base"], "os erros da Simulacao com o prefixo");
  assert.deepEqual(cardModel.JIT_EVERY_OPTIONS.map((option) => option.label), ["15 min", "30 min", "60 min"]);
  assert.equal(cardModel.JIT_START_HOURS[0], 0);
  assert.equal(cardModel.JIT_END_HOURS.at(-1), 24);
});

/* ------------------------------------------------------------------------------------------------
 * O aluno
 * ---------------------------------------------------------------------------------------------- */

function webinar(extra = {}) {
  return {
    ...model.emptyWebinarDraft("simulated"),
    cancelReason: null,
    cancelledAt: null,
    createdAt: "2026-10-28T12:00:00.000Z",
    createdBy: null,
    durationMinutes: 60,
    id: WEBINAR,
    publishedAt: "2026-10-28T12:00:00.000Z",
    registrationRequired: true,
    slug: "agentes-quando-voce-entra",
    status: "published",
    title: "Agentes quando você entra",
    updatedAt: "2026-10-28T12:00:00.000Z",
    ...extra
  };
}

function jitSession(id, scheduledAt) {
  return {
    browserRecordingAt: null,
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: new Date(scheduledAt).toISOString(),
    endedAt: null,
    id,
    jit: true,
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
    scheduledAt: new Date(scheduledAt).toISOString(),
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: new Date(scheduledAt).toISOString(),
    status: "live",
    updatedAt: new Date(scheduledAt).toISOString(),
    webinarId: WEBINAR
  };
}

const vista = (now, jit = { ...JIT_ON, lateJoinMinutes: 5 }, sessions = [jitSession("cccccccc-0000-4000-8000-000000000001", sp("2026-10-29T10:00:00"))]) =>
  student.buildStudentWebinarView({ jit, now, presenterName: "Ana", registeredCounts: new Map(), registrations: [], sessions, videoDurationMs: 60 * 60_000, webinar: webinar() });
const pagina = (view, now, extra = {}) => ({ data: { now, page: { calendars: {}, view }, state: "ready" }, source: null, ...extra });

test("pagina do aluno: 'A próxima sessão começa em {n} min' com o Entrar, sem Garantir vaga e sem as sessoes jit uma a uma", () => {
  const view = vista(NOW);
  const markup = html(pageView.WebinarPageView, pagina(view, NOW));
  const text = textOf(markup);
  assert.match(text, /A próxima sessão começa em 8 min/);
  assert.match(text, /Não precisa de vaga: é só entrar\./);
  assert.match(markup, /data-jit-enter="next"/);
  assert.match(markup, /<button[^>]*>.*Entrar<\/button>/s);
  assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>.*Entrar/s, "a sala das 10:15 ja abriu: o Entrar liga");
  assert.doesNotMatch(text, /Garantir vaga|Escolha a sessão|Sessão das 10:00/, "nem vaga nem a lista de sessoes jit");
  assert.match(text, /Começa quando você entra/);
  assert.match(text, /Duração: 1h 00min/);
  assert.match(text, /Apresentador: Ana/);
  assert.doesNotMatch(markup, /sala\?sessao=cccccccc/, "nenhum link para a sessao jit de outro aluno");

  const comecou = textOf(html(pageView.WebinarPageView, pagina(vista(sp("2026-10-29T10:03:00")), sp("2026-10-29T10:03:00"))));
  assert.match(comecou, /A sessão das 10:00 já começou\. Entre agora\./);

  const aCada60 = html(pageView.WebinarPageView, pagina(vista(NOW, { ...JIT_ON, everyMinutes: 60, lateJoinMinutes: 5 }), NOW));
  assert.match(textOf(aCada60), /A próxima sessão começa em 53 min/);
  assert.match(textOf(aCada60), /A sala abre 15 min antes\./);
  assert.match(aCada60, /<button[^>]*disabled=""[^>]*>.*Entrar/s, "antes de a sala abrir, o Entrar fica desligado");

  const madrugada = sp("2026-10-29T03:00:00");
  const fora = html(pageView.WebinarPageView, pagina(vista(madrugada), madrugada));
  assert.match(textOf(fora), /As sessões abrem a partir das 08:00 \(horário de Brasília\)\./);
  assert.doesNotMatch(fora, />\s*Entrar\s*</, "fora do horario, sem o Entrar");

  const previa = html(pageView.WebinarPageView, pagina(view, NOW, { accessPreviewMode: "producer" }));
  assert.match(previa, /<button[^>]*disabled=""[^>]*>.*Entrar/s, "no ver como, nada e gravado");
  assert.match(textOf(previa), /No modo de visualização, nada é gravado\./);
});

test("o modelo do aluno: o card do jit, Em andamento enquanto as sessoes correm, Proxima live fora do horario, nunca Replays; nunca vaga", () => {
  const view = vista(NOW);
  assert.equal(view.sessions.length, 0, "a sessao jit nao entra na lista");
  assert.equal(view.primary, null);
  assert.equal(view.phase, "scheduled");
  assert.equal(view.endedAtMs, null);
  assert.deepEqual(view.jit.state, { kind: "next", minutes: 8, roomOpen: true, slotIso: new Date(sp("2026-10-29T10:15:00")).toISOString(), timeLabel: "10:15" });
  assert.deepEqual(student.groupStudentWebinars([view]).inProgress.map((item) => item.id), [WEBINAR]);

  const madrugada = vista(sp("2026-10-29T03:00:00"));
  const grupos = student.groupStudentWebinars([madrugada]);
  assert.deepEqual([grupos.upcoming.length, grupos.inProgress.length, grupos.replays.length], [1, 0, 0]);
  assert.equal(student.pickHomeWebinar([madrugada], sp("2026-10-29T03:00:00")).view.id, WEBINAR, "o card da pagina inicial tambem");

  assert.equal(student.seatRequired({ capacity: 10, registrationRequired: true }, { jit: true, kind: "simulated" }), false);
  assert.equal(student.seatRequired({ capacity: 10, registrationRequired: true }, { jit: false, kind: "simulated" }), true);
  assert.equal(vista(NOW, { ...JIT_ON, enabled: false }).jit, null, "desligado: o webinario como antes");
  const cancelado = student.buildStudentWebinarView({ jit: JIT_ON, now: NOW, presenterName: null, registeredCounts: new Map(), registrations: [], sessions: [], webinar: webinar({ cancelledAt: "2026-10-29T12:00:00.000Z" }) });
  assert.deepEqual([cancelado.jit, cancelado.phase], [null, "cancelled"]);
});

test("/webinarios: o webinario com o jit e um card so com o selo e a contagem; nunca uma sessao jit por card", () => {
  const view = vista(NOW);
  const outra = vista(sp("2026-10-29T03:00:00"));
  const emAndamento = html(listView.WebinarsPageView, { data: { lists: { inProgress: [view], replays: [], upcoming: [] }, now: NOW, state: "ready" } });
  assert.match(textOf(emAndamento), /Em andamento/);
  assert.match(textOf(emAndamento), /Começa quando você entra/);
  assert.match(textOf(emAndamento), /A próxima sessão começa em 8 min/);
  assert.match(emAndamento, /href="\/webinarios\/agentes-quando-voce-entra"/);
  assert.doesNotMatch(emAndamento, /sala\?sessao=/);

  const destaque = html(listView.WebinarsPageView, { data: { lists: { inProgress: [], replays: [], upcoming: [outra] }, now: sp("2026-10-29T03:00:00"), state: "ready" } });
  assert.match(destaque, /data-jit-featured/);
  assert.match(textOf(destaque), /As sessões abrem a partir das 08:00/);
  assert.match(textOf(destaque), /Entrar/);
  assert.doesNotMatch(textOf(destaque), /Garantir vaga/);
});

test("pagina inicial: a fileira Lives desenha o webinario com o jit pelo card do jit (o selo e a contagem do proximo horario)", () => {
  const view = vista(NOW);
  const markup = html(HomeLivesRow, { card: { kind: "next", view }, serverNow: NOW });
  assert.match(textOf(markup), /Começa quando você entra/);
  assert.match(textOf(markup), /A próxima sessão começa em 8 min/);
  assert.match(markup, /href="\/webinarios\/agentes-quando-voce-entra"/);
  assert.doesNotMatch(textOf(markup), /Garantir vaga/);
});

test("a resposta da rota conferida no navegador: so o endereco da sala deste app", () => {
  assert.equal(isJitRoomHref("/webinarios/agentes-quando-voce-entra/sala?sessao=cccccccc-0000-4000-8000-000000000001"), true);
  assert.equal(isJitRoomHref("https://fora.exemplo.test/webinarios/x/sala?sessao=cccccccc-0000-4000-8000-000000000001"), false);
  assert.equal(isJitRoomHref("/webinarios/agentes/sala?sessao=1;alert(1)"), false);
});

test("jit ligado com uma hora marcada que ja passou: nada de 'Agendado', data antiga ou contagem; so o Entrar do jit", () => {
  const antiga = { ...jitSession("cccccccc-0000-4000-8000-0000000000aa", sp("2026-10-27T20:00:00")), endedAt: new Date(sp("2026-10-27T21:00:00")).toISOString(), jit: false, status: "ended" };
  const view = vista(NOW, { ...JIT_ON, lateJoinMinutes: 5 }, [antiga, jitSession("cccccccc-0000-4000-8000-000000000001", sp("2026-10-29T10:00:00"))]);
  assert.equal(view.primary, null, "a marcada que passou nunca vira o destaque");
  assert.equal(view.phase, "scheduled");
  assert.equal(view.sessions.length, 1, "ela continua na lista de baixo");

  const markup = html(pageView.WebinarPageView, pagina(view, NOW));
  const text = textOf(markup);
  assert.match(text, /A próxima sessão começa em 8 min/);
  assert.doesNotMatch(text, /Agendado/, "sem o selo de agendado da sessao antiga");
  assert.doesNotMatch(text, /Aguardando o apresentador/, "sem a contagem para um horario passado");
  assert.doesNotMatch(text, /27\/10|27 de out/i, "sem a data antiga no destaque");
});
