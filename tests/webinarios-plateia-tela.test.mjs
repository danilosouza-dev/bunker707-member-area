import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// Os participantes simulados desenhados (docs/30 D79; docs/31 §13.2; docs/18 §2.2), no Node e sem navegador: o controle
// "Participantes simulados" (o numero somado agora, os atalhos, o Aplicar direto sem frase nem caixa desde 12/11/2026
// (D86), o Tirar, quem mudou por ultimo, as mudancas, sem permissao sem botoes, encerrada e sem a migracao), o
// selo dos presentes do topo do console que abre o controle (e o do palco, pela fiacao do console), a Presença com o
// controle no alto, e a aba Participantes do "ver como" com a frase de que a simulacao nao aparece na previa.

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
const { SimulationAudienceControl } = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-audience-control.tsx");
const { ConsoleTopBar } = await import("../src/components/admin/v2/communication/webinars/session-console/console-top-bar.tsx");
const { LiveParticipantsTab } = await import("../src/components/member/webinars/room/live-notices.tsx");
const model = await import("../src/server/webinars/simulation-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.simulacao.plateia;
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
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const NOW = Date.parse("2026-11-11T23:30:00.000Z"); // 20:30 de 11/11 em Sao Paulo
const FLAGS = { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false };

const audiencia = (extra = {}) => ({
  changes: [
    { atMs: 10 * 60_000, changedAt: "2026-11-11T23:20:00.000Z", changedByName: "Carla Produtora", extra: 300, id: "m2", source: "console" },
    { atMs: null, changedAt: "2026-11-11T22:50:00.000Z", changedByName: "Ana Souza", extra: 100, id: "m1", source: "editor" }
  ],
  current: { base: 300, jitter: 0, mode: "fixed", peak: 300 },
  flags: FLAGS,
  pendingMigration: false,
  rampEndsAtMs: null,
  ...extra
});

const controle = (extra = {}) =>
  html(
    createElement(SimulationAudienceControl, {
      audience: audiencia(),
      busy: false,
      canPublish: true,
      idBase: "t",
      link: { href: "/admin/comunicacao/webinarios/w#webinar-card-simulacao", label: COPY.verNoEditor },
      offsetMs: 20 * 60_000,
      onApply: async () => true,
      phase: "on_air",
      ...extra
    })
  );

test("o controle: o numero somado agora, quem mudou por ultimo, os atalhos, Aplicar desligado so sem numero, o Tirar e as mudancas; sem frase nem caixa (D86)", () => {
  const markup = controle();
  const text = textOf(markup);
  assert.match(markup, /<h3[^>]*id="t-titulo"[^>]*tabindex="-1"[^>]*>Participantes simulados<\/h3>/, "o titulo recebe o foco do selo dos presentes");
  assert.match(text, /Somados ao número de quem assiste que o aluno vê\./);
  assert.match(markup, /data-simulation-audience-now="">\+300<\/dd>/);
  assert.match(text, /Mudado por Carla Produtora em 11\/11\/2026 às 20:20, pelo console\./);
  assert.match(markup, /<label[^>]*for="t-somar">Somar à plateia<\/label>/);
  assert.deepEqual(
    Array.from(markup.matchAll(/data-simulation-audience-shortcut="(\d+)"/g), (match) => Number(match[1])),
    [50, 100, 300, 500]
  );
  assert.match(markup, /aria-label="Somar \+300"/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*data-simulation-audience-apply=""[^>]*>Aplicar<\/button>/, "sem numero, Aplicar desligado");
  assert.match(markup, /<button[^>]*aria-label="Tirar os participantes simulados \(volta a \+0\)"[^>]*data-simulation-audience-remove=""/);
  assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*data-simulation-audience-remove/, "o Tirar ligado com algo somado");
  assert.match(text, /No ar, o número sobe ou desce em linha reta em 1 min 30 s, igual para todos\./);
  assert.match(markup, /<a[^>]*data-simulation-audience-link=""[^>]*href="\/admin\/comunicacao\/webinarios\/w#webinar-card-simulacao"[^>]*>Ver no editor<\/a>/, "o atalho para o card do editor");
  assert.match(text, /Mudanças \(2\) 10:00 · \+300 · Carla Produtora antes do começo · \+100 · Ana Souza/);
  assert.doesNotMatch(markup, /data-simulation-audience-sentence|data-simulation-audience-confirm|type="checkbox"/, "sem frase e sem caixa (decisao do produtor em 12/11/2026, D86)");
  assert.doesNotMatch(text, /Decisão do produtor|Confirmo|Marque a confirmação/, "nenhuma frase de decisao na tela");
  assert.doesNotMatch(text, /personagem/i);
});

test("o controle com a rampa em curso diz que a sala esta chegando; antes do comeco, que o numero vale na hora; +0 sem o Tirar", () => {
  assert.match(textOf(controle({ audience: audiencia({ rampEndsAtMs: 21 * 60_000 }) })), /A sala está chegando a \+300\./);
  assert.doesNotMatch(controle({ audience: audiencia({ rampEndsAtMs: 19 * 60_000 }) }), /data-simulation-audience-ramp/, "a rampa ja acabou");
  const antes = controle({ audience: audiencia({ changes: [], current: { base: 0, jitter: 0, mode: "off", peak: 0 } }), phase: "before" });
  assert.match(textOf(antes), /Antes do começo, o número novo vale na hora\./);
  assert.match(textOf(antes), /Ainda sem mudança no console nem no editor\./);
  assert.match(antes, /data-simulation-audience-now="">\+0<\/dd>/);
  assert.doesNotMatch(antes, /data-simulation-audience-remove/, "nada para tirar");
  assert.doesNotMatch(antes, /data-simulation-audience-history/);
});

test("sem permissao, com a sessao encerrada ou sem a 202611140002: o numero sem os botoes e a frase do motivo", () => {
  for (const [extra, motivo] of [
    [{ canPublish: false }, COPY.semPermissao],
    [{ phase: "ended" }, COPY.encerrada],
    [{ audience: audiencia({ pendingMigration: true }) }, WEBINAR_COPY.simulacao.servidor.precisaMigracaoPlateia("202611140002")]
  ]) {
    const markup = controle(extra);
    assert.ok(textOf(markup).includes(motivo), motivo);
    assert.match(markup, /data-simulation-audience-now="">\+300/, "o numero continua");
    assert.equal(count(markup, /data-simulation-audience-(apply|remove|shortcut)=/g), 0, "nenhum botao");
    assert.doesNotMatch(markup, /id="t-somar"/);
  }
});

test("a frase da mudanca continua a mesma conta do servidor (gravada no registro, D80), mas a tela nao a mostra nem pede a caixa (D86)", () => {
  const sentence = model.simulationAudienceAckFor({ extra: 500, flags: FLAGS, live: true, nowMs: NOW, responsible: "Produtora de Teste" });
  assert.match(sentence, /^Decisão do produtor em 11\/11\/2026: nesta live ao vivo, .* A partir de agora, os participantes simulados somam \+500 ao número de quem assiste\. Responsável: Produtora de Teste\.$/);
  const component = source("src/components/admin/v2/communication/webinars/simulation/simulation-audience-control.tsx");
  assert.doesNotMatch(component, /acknowledged|checkbox|needsAck|sentence/, "nada de caixa nem frase no controle");
  assert.match(component, /onClick=\{\(\) => void apply\(0\)\}/, "o Tirar direto (o servidor grava a frase do +0)");
  // Com um numero no campo o Aplicar liga de primeira: o controle desenhado com o numero digitado nao existe no HTML do
  // servidor (o estado e do navegador), entao a regra fica no audienceFormState (webinarios-plateia-modelo).
});

test("o topo do console: os presentes sao o botao que abre os participantes simulados; sem o controle, so texto", () => {
  const topo = (extra = {}) =>
    html(
      createElement(ConsoleTopBar, {
        actions: [],
        busyKey: null,
        canWrite: true,
        className: "",
        clockLabel: "",
        editorHref: "/admin/comunicacao/webinarios/w",
        onAction() {},
        onChangeSession() {},
        onLock() {},
        onRefresh() {},
        onToggleTheme() {},
        poll: { notice: "", offline: false },
        presentLabel: "1 presente · pico 1 · +300 simulados",
        reading: false,
        reportHref: "/admin/comunicacao/webinarios/w/relatorio",
        roomLocked: false,
        sessionId: "s",
        sessions: [{ id: "s", kind: "live", scheduledAt: "2026-11-11T23:00:00.000Z", status: "live" }],
        theme: "dark",
        title: "Aula aberta",
        ...extra
      })
    );
  const comControle = topo({ onPresent() {} });
  assert.match(
    comControle,
    /<button aria-label="1 presente · pico 1 · \+300 simulados\. Abrir os participantes simulados"[^>]*data-console-audience-open="top"[^>]*data-console-present=""[^>]*type="button">1 presente · pico 1 · \+300 simulados<\/button>/,
    "o nome comeca pelo rotulo visivel (WCAG 2.5.3)"
  );
  const semControle = topo();
  assert.doesNotMatch(semControle, /data-console-audience-open/);
  assert.match(semControle, /<span class="tabular-nums" data-console-present="">1 presente · pico 1 · \+300 simulados<\/span>/);
});

test("a fiacao do console: o selo do palco e o do topo abrem a Presença com o controle no alto e o foco no titulo; o Aplicar vai por saveSimulatedAudience", () => {
  const consoleSource = source("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.equal(count(consoleSource, /onPresent=\{audience \? openAudience : undefined\}/g), 2, "o topo e o palco");
  assert.match(consoleSource, /setPanelView\(\{ more: "presenca" \}\);[\s\S]*?document\.getElementById\(AUDIENCE_TITLE_ID\)/);
  assert.match(consoleSource, /consoleMoreEntriesFor\(\{ audience: audience !== null,/);
  assert.match(consoleSource, /saveSimulatedAudience\(\{ extra: input\.extra, sessionId, source: "console" \}\)/, "sem frase nem caixa no pedido (D86)");
  assert.match(consoleSource, /<SimulationAudienceControl[\s\S]*?link=\{\{ href: `\$\{webinarAdminHref\(webinar\.id\)\}#webinar-card-simulacao`, label: plateiaCopy\.verNoEditor \}\}[\s\S]*?titleId=\{AUDIENCE_TITLE_ID\}/);
  const presenca = consoleSource.slice(consoleSource.indexOf("presenca:"), consoleSource.indexOf("tela:", consoleSource.indexOf("presenca:")));
  assert.ok(presenca.indexOf("<SimulationAudienceControl") < presenca.indexOf("<ConsolePresencePanel"), "os participantes simulados no alto da Presença");
  const stage = source("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(stage, /className=\{cn\("pointer-events-auto rounded-full", ROOM_FOCUS\)\}\s*data-console-audience-open="stage"/, "a pilula do palco recebe o toque");
  const page = source("src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/page.tsx");
  assert.match(page, /currentUserName=\{getUserDisplayName\(user\)\.fullName\}/, "o mesmo nome que o servidor poe na frase");
});

test("a aba Participantes do ver como: a frase de que a simulacao nao aparece na previa; fora dele, nada a mais", () => {
  const previa = html(createElement(LiveParticipantsTab, { note: COPY.previa, presenterKnown: true, stage: ["Carla Produtora"], students: 3 }));
  assert.match(previa, /data-testid="room-simulation-preview-note">A simulação não aparece na prévia\.<\/p>/);
  const aluno = html(createElement(LiveParticipantsTab, { presenterKnown: true, stage: ["Carla Produtora"], students: 303 }));
  assert.doesNotMatch(aluno, /room-simulation-preview-note/);
});
