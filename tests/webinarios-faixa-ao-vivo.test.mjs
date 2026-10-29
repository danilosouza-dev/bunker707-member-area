import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// A faixa "Ao vivo agora" e "Comeca em 1 h: Entrar" do topo de todas as paginas e o Entrar da Live ao vivo na pagina
// do Webinario (docs/30 §1.1, §1.2, §1.5, §1.7 e §2.7; A12, A16 e A24; docs/18 §2.2). A escolha pura (no ar > comeca
// em N min > nada; duas no ar = "+1 ao vivo"; a gravada so com o selo e na fase "live" do relogio; a "Comeca em" so
// para quem garantiu vaga, de 60 min antes ate a hora), a dispensa de 1 dia, a resposta conferida no navegador (so
// links de /webinarios), os caminhos onde a faixa nunca aparece (a sala, o login, o Modo TV), a faixa desenhada a
// 375 px (uma linha, X de 44 px, aria-live discreto), o Entrar da live em cada situacao e a rota GET
// /api/webinars/live-now com um banco falso em memoria: 401 sem sessao, so o que o aluno pode ver, nunca o nome da
// sala nem dado de outro aluno, a vaga so do proprio aluno e o banco sem a migracao respondendo vazio.

const sessao = (globalThis.__faixaSessao ??= { user: null });

/** O modulo de src/ que um import pede ("server/auth/guards"), pelo alias ou por caminho relativo. */
function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__faixaSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const banner = await import("../src/server/webinars/live-banner.ts");
const model = await import("../src/server/webinars/model.ts");
const student = await import("../src/server/webinars/student-model.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const strip = await import("../src/components/member/webinars/live-now-banner.tsx");
const enter = await import("../src/components/member/webinars/webinar-enter-button.tsx");
const pageView = await import("../src/components/member/webinars/webinar-page-view.tsx");
const liveNowRoute = await import("../src/app/api/webinars/live-now/route.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const FAIXA = WEBINAR_COPY.faixa;

/* ------------------------------------------------------------------------------------------------
 * Modelo
 * ---------------------------------------------------------------------------------------------- */

function webinar(extra = {}) {
  return {
    ...model.emptyWebinarDraft("live"),
    cancelReason: null,
    cancelledAt: null,
    createdAt: iso(T0 - DAY),
    createdBy: null,
    durationMinutes: 60,
    id: "w1",
    publishedAt: iso(T0 - DAY),
    slug: "aula-de-ia",
    status: "published",
    title: "Aula de IA",
    updatedAt: iso(T0 - DAY),
    ...extra
  };
}

const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const S2 = "aaaaaaaa-0000-4000-8000-000000000002";
const S3 = "aaaaaaaa-0000-4000-8000-000000000003";

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: iso(T0 - DAY),
    endedAt: null,
    id: S1,
    kind: "live",
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
    roomName: "w-segredo-0123456789abcdef",
    scheduledAt: iso(T0),
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: iso(T0 - DAY),
    webinarId: "w1",
    ...extra
  };
}

function vaga(extra = {}) {
  return {
    calendarToken: "0123456789abcdef0123456789abcdef",
    cancelledAt: null,
    id: "r1",
    registeredAt: iso(T0 - HOUR),
    reminder1hSentAt: null,
    reminder24hSentAt: null,
    sessionId: S1,
    source: null,
    sourceCampaignId: null,
    startedNoticeSentAt: null,
    status: "registered",
    userId: "u1",
    webinarId: "w1",
    ...extra
  };
}

const escolha = (entries, nowMs, meetConfigured = true) => banner.chooseLiveNow({ entries, meetConfigured, nowMs });
const entrada = (webinarExtra, sessions, registrations = [], durationMsBySession) => ({ durationMsBySession, registrations, sessions, webinar: webinar(webinarExtra) });

test("escolha: a Live ao vivo no ar entra com o Entrar para a sala; sem a sala neste ambiente, nada; espera, encerrada e cancelada ficam fora", () => {
  const noAr = entrada({}, [session({ startedAt: iso(T0 + 2 * MIN), status: "live" })]);
  assert.deepEqual(escolha([noAr], T0 + 10 * MIN), {
    live: [{ href: `/webinarios/aula-de-ia/sala?sessao=${S1}`, startedAt: iso(T0 + 2 * MIN), title: "Aula de IA" }],
    soon: null
  });
  assert.deepEqual(escolha([noAr], T0 + 10 * MIN, false), { live: [], soon: null }, "sem WEBINAR_MEET_DOMAIN e o segredo, a faixa nao chama ninguem");

  assert.deepEqual(escolha([entrada({}, [session({ status: "waiting" })])], T0 + MIN).live, [], "sala aberta, apresentador ainda nao comecou: nao e Ao vivo agora");
  assert.deepEqual(escolha([entrada({}, [session({ endedAt: iso(T0 + HOUR), status: "ended" })])], T0 + 2 * HOUR).live, []);
  assert.deepEqual(escolha([entrada({}, [session({ status: "cancelled" })])], T0 + MIN).live, []);
  assert.deepEqual(escolha([entrada({ cancelledAt: iso(T0 - HOUR) }, [session({ status: "live" })])], T0 + MIN).live, [], "webinario cancelado");
  assert.deepEqual(escolha([entrada({ showBanner: false }, [session({ status: "live" })])], T0 + MIN).live, [], "Faixa no topo desligada");
  assert.ok(!JSON.stringify(escolha([noAr], T0 + 10 * MIN)).includes("w-segredo"), "o nome da sala nunca sai");
});

test("escolha: duas no ar = a mais recente primeiro (uma por webinario); +1 ao vivo leva a /webinarios", () => {
  const antiga = entrada({ id: "w1", slug: "aula-antiga", title: "Aula antiga" }, [session({ startedAt: iso(T0 - 30 * MIN), status: "live" })]);
  const nova = entrada({ id: "w2", slug: "aula-nova", title: "Aula nova" }, [session({ id: S2, startedAt: iso(T0 - 5 * MIN), status: "live", webinarId: "w2" })]);
  const choice = escolha([antiga, nova], T0);

  assert.deepEqual(choice.live.map((item) => item.title), ["Aula nova", "Aula antiga"]);
  const view = banner.liveBannerView(choice, T0);
  assert.deepEqual(view, { href: `/webinarios/aula-nova/sala?sessao=${S2}`, key: `live:/webinarios/aula-nova/sala?sessao=${S2}`, kind: "live", more: 1, title: "Aula nova" });
  assert.equal(FAIXA.maisAoVivo(view.more), "+1 ao vivo");

  const html = render(strip.LiveNowStrip, { onDismiss: () => undefined, view });
  assert.match(html, /href="\/webinarios"[^>]*>\+1 ao vivo</, "o +1 leva a lista");
  assert.equal(render(strip.LiveNowStrip, { onDismiss: () => undefined, view: { ...view, more: 0 } }).includes("ao vivo<"), false, "sem a segunda, sem o +N");
});

test("escolha: a Live gravada so com o selo ligado (A16), na fase live do relogio e com a entrada aberta", () => {
  const gravada = (extra = {}, webinarExtra = {}, durations) =>
    entrada({ durationMinutes: 60, kind: "simulated", ...webinarExtra }, [session({ kind: "simulated", roomName: null, showLiveBadge: true, status: "live", ...extra })], [], durations);

  assert.equal(escolha([gravada()], T0 + 10 * MIN).live.length, 1, "com o selo, no ar");
  assert.equal(escolha([gravada({}, {}, undefined)], T0 + 10 * MIN, false).live.length, 1, "a gravada nao depende da sala ao vivo");
  assert.equal(escolha([gravada()], T0 + 10 * MIN).live[0].startedAt, iso(T0), "o inicio da gravada e a hora marcada");
  assert.equal(escolha([gravada({ showLiveBadge: false })], T0 + 10 * MIN).live.length, 0, "sem o selo, nunca Ao vivo agora");
  assert.equal(escolha([gravada({ status: "scheduled" })], T0 - 5 * MIN).live.length, 0, "na espera (antes da hora) nao esta no ar");
  assert.equal(escolha([gravada()], T0 + 61 * MIN).live.length, 0, "depois do fim do video");
  assert.equal(escolha([gravada({}, {}, new Map([[S1, 90 * MIN]]))], T0 + 61 * MIN).live.length, 1, "a duracao da gravacao vale mais que a prevista");
  assert.equal(escolha([gravada({ lateJoinMinutes: 10 })], T0 + 20 * MIN).live.length, 0, "Entrada atrasada fechada: nao chama quem nao entra mais");
  assert.equal(escolha([gravada({ kind: "replay" })], T0 + 10 * MIN).live.length, 0, "o replay nunca e Ao vivo agora");
});

test("escolha: Comeca em so para quem garantiu vaga, de 60 min antes ate a hora; a mais proxima; o Entrar vai a sala so quando ela abre", () => {
  const comVaga = entrada({}, [session()], [vaga()]);
  assert.deepEqual(escolha([comVaga], T0 - 30 * MIN), { live: [], soon: { href: "/webinarios/aula-de-ia", scheduledAt: iso(T0), title: "Aula de IA" } });
  assert.equal(escolha([entrada({}, [session()])], T0 - 30 * MIN).soon, null, "sem vaga, sem Comeca em");
  assert.equal(escolha([entrada({}, [session()], [vaga({ status: "cancelled" })])], T0 - 30 * MIN).soon, null, "vaga cancelada");
  assert.equal(escolha([comVaga], T0 - 61 * MIN).soon, null, "antes dos 60 min");
  assert.equal(escolha([comVaga], T0).soon, null, "na hora marcada some");
  assert.equal(escolha([entrada({ showBanner: false }, [session()], [vaga()])], T0 - 30 * MIN).soon, null, "Faixa no topo desligada");

  // A equipe abriu a sala antes da hora: o Entrar da faixa vai direto para a sala (sem a sala no ambiente, para a pagina).
  const aberta = entrada({}, [session({ status: "waiting" })], [vaga()]);
  assert.equal(escolha([aberta], T0 - 10 * MIN).soon.href, `/webinarios/aula-de-ia/sala?sessao=${S1}`);
  assert.equal(escolha([aberta], T0 - 10 * MIN, false).soon.href, "/webinarios/aula-de-ia");
  // A gravada abre 15 min antes.
  const gravada = entrada({ kind: "simulated" }, [session({ kind: "simulated" })], [vaga()]);
  assert.equal(escolha([gravada], T0 - 30 * MIN).soon.href, "/webinarios/aula-de-ia");
  assert.equal(escolha([gravada], T0 - 10 * MIN).soon.href, `/webinarios/aula-de-ia/sala?sessao=${S1}`);

  // Duas vagas: a mais proxima.
  const logo = entrada({ id: "w2", slug: "aula-logo", title: "Aula logo" }, [session({ id: S2, scheduledAt: iso(T0 - 20 * MIN), webinarId: "w2" })], [vaga({ sessionId: S2, webinarId: "w2" })]);
  assert.equal(escolha([comVaga, logo], T0 - 30 * MIN).soon.title, "Aula logo");
});

test("no ar > comeca em N min > nada: a conta desce ('Comeca em 1 h: Entrar' e depois 'Comeca em 12 min: Entrar')", () => {
  const soon = { href: "/webinarios/aula-de-ia", scheduledAt: iso(T0), title: "Aula de IA" };
  const live = [{ href: `/webinarios/outra-aula/sala?sessao=${S2}`, startedAt: iso(T0 - HOUR), title: "Outra aula" }];

  assert.equal(banner.liveBannerView({ live, soon }, T0 - 30 * MIN).kind, "live", "no ar vence a Comeca em");
  assert.deepEqual(banner.liveBannerView({ live: [], soon }, T0 - 60 * MIN), { href: soon.href, key: `soon:aula-de-ia:${iso(T0)}`, kind: "soon", label: "Começa em 1 h: Entrar", title: "Aula de IA" });
  assert.equal(banner.liveBannerView({ live: [], soon }, T0 - 12 * MIN).label, "Começa em 12 min: Entrar");
  assert.equal(banner.liveBannerView({ live: [], soon }, T0 - 12 * MIN - 30_000).label, "Começa em 13 min: Entrar", "minuto comecado conta inteiro");
  assert.equal(banner.liveBannerView({ live: [], soon }, T0 - 30_000).label, "Começa em 1 min: Entrar");
  assert.equal(banner.liveBannerView({ live: [], soon }, T0), null, "na hora some");
  assert.equal(banner.liveBannerView({ live: [], soon }, T0 - 61 * MIN), null, "antes da janela, nada");
  assert.equal(banner.liveBannerView({ live: [], soon: null }, T0), null, "nada");
  assert.equal(banner.liveBannerView(null, T0), null);
  assert.equal(banner.soonLabel(iso(T0), T0 - 60 * MIN), FAIXA.comecaEm1h);
});

test("o X dispensa por 1 dia naquele navegador: o mapa guardado, a dispensa vencida, o texto estragado e as outras lives", () => {
  const live = [
    { href: `/webinarios/aula-nova/sala?sessao=${S2}`, startedAt: iso(T0 - 5 * MIN), title: "Aula nova" },
    { href: `/webinarios/aula-antiga/sala?sessao=${S1}`, startedAt: iso(T0 - 30 * MIN), title: "Aula antiga" }
  ];
  const soon = { href: "/webinarios/aula-logo", scheduledAt: iso(T0 + 20 * MIN), title: "Aula logo" };
  const first = banner.liveBannerView({ live, soon }, T0);

  let stored = banner.withDismissal({}, first.key, T0);
  assert.deepEqual(stored, { [first.key]: T0 + DAY });
  assert.equal(banner.LIVE_BANNER_DISMISS_MS, DAY);
  // Guardado como texto e lido de volta (como o localStorage faz).
  stored = banner.parseDismissals(JSON.stringify(stored), T0 + HOUR);
  assert.equal(banner.isDismissed(stored, first.key, T0 + HOUR), true);

  const next = banner.liveBannerView({ live, soon }, T0 + MIN, stored);
  assert.equal(next.title, "Aula antiga", "a dispensada some; a outra no ar aparece");
  assert.equal(next.more, 0);

  stored = banner.withDismissal(stored, next.key, T0 + MIN);
  assert.equal(banner.liveBannerView({ live, soon }, T0 + 2 * MIN, stored).kind, "soon", "sem live no ar, a Comeca em");
  const soonKey = banner.liveBannerView({ live, soon }, T0 + 2 * MIN, stored).key;
  stored = banner.withDismissal(stored, soonKey, T0 + 2 * MIN);
  assert.equal(banner.liveBannerView({ live, soon }, T0 + 3 * MIN, stored), null, "tudo dispensado: nada");
  // A Comeca em continua dispensada quando o link muda para a sala (a chave e o webinario e a hora).
  assert.equal(banner.liveBannerView({ live: [], soon: { ...soon, href: `/webinarios/aula-logo/sala?sessao=${S3}` } }, T0 + 3 * MIN, stored), null);

  // 1 dia depois, volta.
  assert.equal(banner.liveBannerView({ live, soon: null }, T0 + DAY + MIN, stored).title, "Aula nova");
  assert.deepEqual(banner.parseDismissals(JSON.stringify(stored), T0 + DAY + 3 * MIN), {}, "as vencidas saem do mapa");

  for (const raw of [null, "", "{", "[]", "null", "42", JSON.stringify({ x: "amanha" }), JSON.stringify({ x: T0 + 10 * DAY })]) {
    assert.deepEqual(banner.parseDismissals(raw, T0), {}, `texto guardado estragado: ${raw}`);
  }
  let many = {};
  for (let index = 0; index < 60; index += 1) many = banner.withDismissal(many, `k${index}`, T0 + index);
  assert.equal(Object.keys(many).length, 50, "no maximo as 50 mais novas");
  assert.ok(many.k59 && !many.k0);
});

test("caminhos: em todas as paginas da area, menos a propria sala, o login e o Modo TV", () => {
  for (const path of ["/", "/webinarios", "/webinarios/aula-de-ia", "/conteudo/abc/aulas/xyz", "/perfil", "/minhas-compras"]) {
    assert.equal(banner.liveBannerAllowedOn(path), true, path);
  }
  for (const path of ["/webinarios/aula-de-ia/sala", `/webinarios/aula-de-ia/sala?sessao=${S1}`, "/Webinarios/aula/SALA", "/login", "/login/recuperar", "/tv", "/tv/receptor", "/admin", "/auth/callback", "/alterar-senha", "", null, undefined, "x"]) {
    assert.equal(banner.liveBannerAllowedOn(path), false, String(path));
  }
  assert.equal(render(strip.LiveNowBanner, { pathname: `/webinarios/aula-de-ia/sala` }), "", "na sala, nem a regiao");
  assert.equal(render(strip.LiveNowBanner, { pathname: "/" }), '<div aria-live="polite" data-live-now-banner=""></div>', "sem resposta ainda, a regiao vazia (o anuncio vem quando a faixa entra)");
});

test("a resposta conferida no navegador: so links de /webinarios, a forma certa e no maximo 20", () => {
  const ok = { live: [{ href: `/webinarios/aula-de-ia/sala?sessao=${S1}`, startedAt: iso(T0), title: "Aula de IA" }], serverTime: iso(T0), soon: { href: "/webinarios/aula-de-ia", scheduledAt: iso(T0 + HOUR), title: "Aula de IA" } };
  assert.deepEqual(banner.parseLiveNowData(ok), ok);
  assert.deepEqual(banner.parseLiveNowData({ live: [], serverTime: iso(T0), soon: null }), { live: [], serverTime: iso(T0), soon: null });

  for (const href of ["https://golpe.example/webinarios/x", "javascript:alert(1)", "//golpe.example", "/webinarios/../admin", "/admin", "/webinarios/aula-de-ia/sala?sessao=1&x=2"]) {
    assert.equal(banner.parseLiveNowData({ ...ok, live: [{ ...ok.live[0], href }] }), null, href);
    assert.equal(banner.parseLiveNowData({ ...ok, soon: { ...ok.soon, href } }), null, href);
  }
  assert.equal(banner.parseLiveNowData(null), null);
  assert.equal(banner.parseLiveNowData({ live: [] }), null, "sem serverTime");
  assert.equal(banner.parseLiveNowData({ ...ok, live: [{ ...ok.live[0], title: "" }] }), null);
  assert.equal(banner.parseLiveNowData({ ...ok, soon: { ...ok.soon, scheduledAt: "amanha" } }), null);
  const many = Array.from({ length: 30 }, () => ok.live[0]);
  assert.equal(banner.parseLiveNowData({ ...ok, live: many }).live.length, 20);
});

test("a faixa desenhada: uma linha abaixo do cabecalho, Entrar, o X de 44 px com nome, a regiao com rotulo; nenhuma palavra proibida", () => {
  const live = render(strip.LiveNowStrip, { onDismiss: () => undefined, view: { href: `/webinarios/aula-de-ia/sala?sessao=${S1}`, key: "k", kind: "live", more: 0, title: "Aula de IA" } });
  assert.match(live, /<aside aria-label="Live ao vivo agora"/);
  assert.match(live, /fixed inset-x-0 top-16 z-30/, "logo abaixo do cabecalho fixo (h-16, z-40)");
  assert.match(live, /flex h-11 w-full min-w-0/, "uma linha so (44 px), sem rolagem lateral");
  assert.match(live, /min-w-0 flex-1 truncate/, "o titulo encurta a 375 px");
  assert.match(live, /Ao vivo agora<\/span>.*· <\/span><span class="text-zinc-200">Aula de IA<\/span>/s);
  assert.match(live, new RegExp(`href="/webinarios/aula-de-ia/sala\\?sessao=${S1}"[^>]*>Entrar</a>`));
  assert.match(live, /<button aria-label="Dispensar por hoje" class="grid size-11 shrink-0/, "X de 44 px com nome acessivel");
  assert.match(live, /motion-reduce:animate-none/, "o ponto pulsando respeita o movimento reduzido");

  const soon = render(strip.LiveNowStrip, { onDismiss: () => undefined, view: { href: "/webinarios/aula-de-ia", key: "k", kind: "soon", label: "Começa em 12 min: Entrar", title: "Aula de IA" } });
  assert.match(soon, /href="\/webinarios\/aula-de-ia"[^>]*>Começa em 12 min: Entrar<\/a>/);
  assert.doesNotMatch(soon, /Ao vivo agora</);

  for (const html of [live, soon]) {
    const text = html.replace(/<[^>]+>/g, " ").toLocaleLowerCase("pt-BR");
    for (const word of PROIBIDAS_WEBINARIO) {
      assert.ok(!text.includes(word), `a faixa usa "${word}"`);
    }
  }
  const frases = [FAIXA.aoVivoAgora, FAIXA.comecaEm1h, FAIXA.comecaEmMin(12), FAIXA.dispensar, FAIXA.entrar, FAIXA.maisAoVivo(1), FAIXA.rotulo];
  for (const frase of frases) {
    for (const word of PROIBIDAS_WEBINARIO) {
      assert.ok(!frase.toLocaleLowerCase("pt-BR").includes(word), `"${frase}" usa "${word}"`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * O Entrar da Live ao vivo na pagina do Webinario
 * ---------------------------------------------------------------------------------------------- */

test("Entrar da Live ao vivo: sala aberta ou no ar = link; antes da hora a contagem; depois, sem link; encerrada; sem a sala no ambiente, em breve", () => {
  const props = (extra, serverNow = T0 + 5 * MIN, liveRoomConfigured = true) => ({ durationMinutes: 60, liveRoomConfigured, serverNow, session: session(extra), slug: "aula-de-ia" });
  const roomLink = new RegExp(`href="/webinarios/aula-de-ia/sala\\?sessao=${S1}"`);

  for (const status of ["waiting", "live"]) {
    const html = render(enter.WebinarEnterButton, props({ status }));
    assert.match(html, roomLink, status);
    assert.match(html, />Entrar</);
    assert.doesNotMatch(html, /em breve|aria-disabled="true"|<button/);
  }
  const preview = render(enter.WebinarEnterButton, { ...props({ status: "live" }), accessPreviewMode: "student_with_access" });
  assert.match(preview, /accessPreview=student_with_access/, "no ver como, a sala abre sem gravar nada");

  const before = render(enter.WebinarEnterButton, props({}, T0 - 12 * MIN));
  assert.match(before, /Começa em 12 min/);
  assert.doesNotMatch(before, /href=/);
  assert.equal(render(enter.WebinarEnterButton, props({}, T0 + 5 * MIN)), "", "da hora ate a equipe abrir: sem link (a frase fica no bloco da pagina)");
  assert.match(render(enter.WebinarEnterButton, props({ endedAt: iso(T0 + HOUR), status: "ended" }, T0 + 2 * HOUR)), /Essa live acabou\./);

  const off = render(enter.WebinarEnterButton, props({ status: "live" }, T0 + 5 * MIN, false));
  assert.match(off, /em breve/);
  assert.match(off, /<button[^>]+aria-disabled="true" disabled=""/);
  assert.doesNotMatch(off, /href=/);
  assert.match(render(enter.WebinarEnterButton, { ...props({ status: "live" }), liveRoomConfigured: undefined }), /em breve/, "sem dizer, a sala nao existe");
  assert.equal(render(enter.LiveRoomWatcher, { liveRoomConfigured: true, serverNow: T0, session: session() }), "", "o vigia nao desenha nada");
});

test("liveEnterState e o vigia da pagina: reconsulta a cada 15 s so na Live ao vivo ainda nao aberta, de 15 min antes ate 2 h depois da hora", () => {
  const state = (extra, nowMs, liveRoomConfigured = true) => banner.liveEnterState(session(extra), { liveRoomConfigured, nowMs });
  assert.equal(state({ status: "waiting" }, T0 - 10 * MIN), "enter");
  assert.equal(state({ status: "live" }, T0 + 10 * MIN), "enter");
  assert.equal(state({}, T0 - MIN), "countdown");
  assert.equal(state({}, T0), "waiting");
  assert.equal(state({ status: "ended" }, T0), "ended");
  assert.equal(state({ status: "cancelled" }, T0, false), "ended");
  assert.equal(state({ status: "live" }, T0, false), "unavailable");

  const watch = (extra, nowMs, liveRoomConfigured = true) => banner.shouldWatchLiveRoom(session(extra), { liveRoomConfigured, nowMs });
  assert.equal(banner.LIVE_ROOM_REFRESH_MS, 15_000);
  assert.equal(watch({}, T0 - 16 * MIN), false, "longe da hora, sem pedidos");
  assert.equal(watch({}, T0 - 15 * MIN), true);
  assert.equal(watch({}, T0 + 30 * MIN), true, "Aguardando o apresentador");
  assert.equal(watch({}, T0 + 2 * HOUR), false, "2 h depois sem comeco, encerra sozinha (A24)");
  assert.equal(watch({ status: "waiting" }, T0), false, "a sala abriu: o Entrar ja apareceu");
  assert.equal(watch({}, T0, false), false, "sem a sala no ambiente");
  assert.equal(watch({ kind: "simulated" }, T0), false, "a gravada segue o relogio, sem reconsultar");
});

function paginaDoWebinario(webinarExtra, sessionExtra, registrations = [], counts = new Map(), nowMs = T0 + 5 * MIN) {
  const view = student.buildStudentWebinarView({ now: nowMs, presenterName: "Ana", registeredCounts: counts, registrations, sessions: [session(sessionExtra)], webinar: webinar(webinarExtra) });
  return { data: { now: nowMs, page: { calendars: {}, view }, state: "ready" }, source: null };
}

test("pagina do Webinario: Aguardando o apresentador com o Entrar quando a equipe abre; sem link antes disso; com limite de vagas, Garantir vaga primeiro (A12)", () => {
  const roomLink = new RegExp(`href="/webinarios/aula-de-ia/sala\\?sessao=${S1}"`);

  const aberta = render(pageView.WebinarPageView, { ...paginaDoWebinario({}, { status: "waiting" }), liveRoomConfigured: true });
  assert.match(aberta, /Aguardando o apresentador/);
  assert.match(aberta, /O apresentador já vai começar\./);
  assert.match(aberta, roomLink);
  assert.doesNotMatch(aberta, /em breve/);

  const noAr = render(pageView.WebinarPageView, { ...paginaDoWebinario({}, { startedAt: iso(T0 + MIN), status: "live" }), liveRoomConfigured: true });
  assert.match(noAr, /Ao vivo/);
  assert.match(noAr, roomLink);
  assert.doesNotMatch(noAr, /O apresentador já vai começar/, "no ar, sem a frase da espera");

  const esperando = render(pageView.WebinarPageView, { ...paginaDoWebinario({}, {}), liveRoomConfigured: true });
  assert.match(esperando, /Aguardando o apresentador/);
  assert.match(esperando, /O apresentador já vai começar\./);
  assert.doesNotMatch(esperando, /\/sala\?sessao=/, "da hora ate a equipe abrir: sem link");
  assert.doesNotMatch(esperando, /em breve/);

  const semSala = render(pageView.WebinarPageView, paginaDoWebinario({}, { status: "live" }));
  assert.match(semSala, /em breve/, "sem a sala neste ambiente, como antes");
  assert.doesNotMatch(semSala, /\/sala\?sessao=/);

  // Limite de vagas (A12): sem a vaga, Garantir vaga no lugar do Entrar; com a vaga, Entrar.
  const limite = { capacity: 10, registrationRequired: true };
  const semVaga = render(pageView.WebinarPageView, { ...paginaDoWebinario(limite, { status: "live" }, [], new Map([[S1, 3]])), liveRoomConfigured: true });
  assert.match(semVaga, /Garantir vaga/);
  assert.doesNotMatch(semVaga, /\/sala\?sessao=/);
  const comVaga = render(pageView.WebinarPageView, { ...paginaDoWebinario(limite, { status: "live" }, [vaga()], new Map([[S1, 3]])), liveRoomConfigured: true });
  assert.match(comVaga, roomLink);
  assert.doesNotMatch(comVaga, /Garantir vaga/);

  // Ver como da equipe: nada gravado; o Entrar abre a sala com a previa (como na Live gravada).
  const previa = render(pageView.WebinarPageView, { ...paginaDoWebinario(limite, { status: "live" }, [], new Map([[S1, 3]])), accessPreviewMode: "producer", liveRoomConfigured: true });
  assert.match(previa, /accessPreview=producer/);

  const encerrada = render(pageView.WebinarPageView, { ...paginaDoWebinario({}, { endedAt: iso(T0 + HOUR), startedAt: iso(T0), status: "ended" }, [], new Map(), T0 + 2 * HOUR), liveRoomConfigured: true });
  assert.match(encerrada, /Essa live acabou\./);
  assert.doesNotMatch(encerrada, /\/sala\?sessao=/);
});

/* ------------------------------------------------------------------------------------------------
 * A rota GET /api/webinars/live-now com o banco falso
 * ---------------------------------------------------------------------------------------------- */

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row, [op, column, value]) {
  const current = row[column];
  switch (op) {
    case "eq":
      return current === value;
    case "in":
      return value.includes(current);
    case "is":
      return value === null ? current === null || current === undefined : current === value;
    case "gte":
      return compare(current, value) >= 0;
    case "lte":
      return compare(current, value) <= 0;
    default:
      return true;
  }
}

/**
 * O banco falso: tabelas como listas, os filtros que as leituras usam; `errors` faz uma tabela responder com erro; as
 * RPCs ficam anotadas em `calls.rpc` e respondem por `rpcs[nome](args)` (sem resposta: vazio).
 */
function bancoFalso({ errors = {}, rpcs = {}, tables = {} } = {}) {
  const calls = { from: [], rpc: [] };

  function query(name) {
    const state = { filters: [], head: false, range: null, single: null };
    function run() {
      if (errors[name]) return { data: null, error: errors[name] };
      let rows = (tables[name] ?? []).filter((row) => state.filters.every((filter) => matches(row, filter)));
      if (state.head) return { count: rows.length, data: null, error: null };
      if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
      if (state.single === "maybe") return { data: rows[0] ?? null, error: null };
      return { count: rows.length, data: rows, error: null };
    }
    const filter = (op) => (column, value) => {
      state.filters.push([op, column, value]);
      return chain;
    };
    const chain = {
      eq: filter("eq"),
      gte: filter("gte"),
      in: filter("in"),
      is: filter("is"),
      lte: filter("lte"),
      maybeSingle: () => ((state.single = "maybe"), chain),
      or: () => chain,
      order: () => chain,
      range: (from, to) => ((state.range = [from, to]), chain),
      select: (_columns, options) => {
        if (options?.head) state.head = true;
        return chain;
      },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject)
    };
    return chain;
  }

  return {
    calls,
    from(name) {
      calls.from.push(name);
      return query(name);
    },
    rpc(name, args) {
      calls.rpc.push({ args, name });
      const run = () => (rpcs[name] ? rpcs[name](args) : { data: null, error: null });
      const chain = { order: () => chain, range: () => chain, then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject) };
      return chain;
    },
    tables
  };
}

const ALUNO_ID = "55555555-5555-4555-8555-000000000001";
const OUTRO_ALUNO = "55555555-5555-4555-8555-000000000002";
const W_LIVE = "bbbbbbbb-0000-4000-8000-000000000001";
const W_PRODUTO = "bbbbbbbb-0000-4000-8000-000000000002";
const W_RASCUNHO = "bbbbbbbb-0000-4000-8000-000000000003";
const W_SEM_FAIXA = "bbbbbbbb-0000-4000-8000-000000000004";
const W_GRAVADA = "bbbbbbbb-0000-4000-8000-000000000005";
const W_LOGO = "bbbbbbbb-0000-4000-8000-000000000006";

function webinarRow(id, extra = {}) {
  const now = Date.now();
  return {
    access_mode: "everyone",
    allow_student_camera: true,
    audience: { kind: "everyone" },
    auto_record: true,
    cancel_reason: null,
    cancelled_at: null,
    capacity: null,
    chat_retention_days: 730,
    cover_url: null,
    created_at: iso(now - DAY),
    created_by: null,
    deleted_at: null,
    description: "",
    duration_minutes: 60,
    host_user_id: null,
    id,
    kind: "live",
    product_id: null,
    published_at: iso(now - DAY),
    quality: {},
    recording_retention_days: 730,
    registration_required: true,
    reminder_texts: {},
    reminders: {},
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: {},
    scheduled_at: null,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: `live-${id.slice(-4)}`,
    status: "published",
    title: `Live ${id.slice(-1)}`,
    updated_at: iso(now - DAY),
    ...extra
  };
}

function sessionRow(id, webinarId, extra = {}) {
  const now = Date.now();
  return {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(now - DAY),
    ended_at: null,
    id,
    kind: "live",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: null,
    recording_requested_at: null,
    room_locked: false,
    room_name: `w-${webinarId}-0123456789abcdef`,
    scheduled_at: iso(now - 10 * MIN),
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: iso(now - 8 * MIN),
    status: "live",
    updated_at: iso(now - MIN),
    webinar_id: webinarId,
    ...extra
  };
}

function registrationRow(userId, webinarId, sessionId, extra = {}) {
  const now = Date.now();
  return {
    calendar_token: randomUUID().replaceAll("-", ""),
    cancelled_at: null,
    cancelled_notice_sent_at: null,
    created_at: iso(now - HOUR),
    id: randomUUID(),
    registered_at: iso(now - HOUR),
    reminder_1h_sent_at: null,
    reminder_24h_sent_at: null,
    session_id: sessionId,
    source: null,
    source_campaign_id: null,
    started_notice_sent_at: null,
    status: "registered",
    updated_at: iso(now - HOUR),
    user_id: userId,
    webinar_id: webinarId,
    ...extra
  };
}

const SESS = (n) => `cccccccc-0000-4000-8000-00000000000${n}`;

function escola() {
  const now = Date.now();
  return bancoFalso({
    tables: {
      admin_roles: [],
      entitlements: [],
      webinar_recordings: [
        { anchor_offset_ms: 0, bunny_library_id: "1", bunny_video_id: "v", created_at: iso(now - DAY), duration_seconds: 3 * 3600, embed_url: null, error_message: null, file_name: null, id: "rec-1", provider: "bunny", purge_due_at: null, session_id: null, sha256: null, size_bytes: null, source: "bunny", status: "ready", updated_at: iso(now - DAY), webinar_id: W_GRAVADA }
      ],
      webinar_registrations: [
        registrationRow(ALUNO_ID, W_LOGO, SESS(6)),
        // A vaga de outro aluno nunca vira a Comeca em de ninguem.
        registrationRow(OUTRO_ALUNO, W_LIVE, SESS(1))
      ],
      webinar_sessions: [
        sessionRow(SESS(1), W_LIVE, { started_at: iso(now - 5 * MIN) }),
        sessionRow(SESS(2), W_PRODUTO, { started_at: iso(now - 2 * MIN) }),
        sessionRow(SESS(3), W_RASCUNHO),
        sessionRow(SESS(4), W_SEM_FAIXA),
        // A gravada com o selo, marcada ha 90 min, num video de 3 h: no ar.
        sessionRow(SESS(5), W_GRAVADA, { kind: "simulated", room_name: null, scheduled_at: iso(now - 90 * MIN), show_live_badge: true, started_at: iso(now - 90 * MIN) }),
        // Daqui a 30 min, o aluno garantiu vaga.
        sessionRow(SESS(6), W_LOGO, { scheduled_at: iso(now + 30 * MIN), started_at: null, status: "scheduled" }),
        // Uma encerrada e uma de amanha nunca entram.
        sessionRow(SESS(7), W_LIVE, { ended_at: iso(now - HOUR), scheduled_at: iso(now - 3 * HOUR), status: "ended" }),
        sessionRow(SESS(8), W_LOGO, { scheduled_at: iso(now + DAY), started_at: null, status: "scheduled" })
      ],
      webinars: [
        webinarRow(W_LIVE, { slug: "live-agora", title: "Live agora" }),
        webinarRow(W_PRODUTO, { access_mode: "product", product_id: "curso-x", slug: "live-do-curso", title: "Live do curso" }),
        webinarRow(W_RASCUNHO, { slug: "rascunho", status: "draft", title: "Rascunho" }),
        webinarRow(W_SEM_FAIXA, { show_banner: false, slug: "sem-faixa", title: "Sem faixa" }),
        webinarRow(W_GRAVADA, { kind: "simulated", slug: "gravada-com-selo", title: "Gravada com selo" }),
        webinarRow(W_LOGO, { slug: "live-logo", title: "Live logo" })
      ]
    }
  });
}

const MEET_ENV = { WEBINAR_JWT_SECRET: "s".repeat(48), WEBINAR_MEET_DOMAIN: "meet.bunker707.com.br" };

async function pedir(env = MEET_ENV) {
  const saved = { WEBINAR_JWT_SECRET: process.env.WEBINAR_JWT_SECRET, WEBINAR_MEET_DOMAIN: process.env.WEBINAR_MEET_DOMAIN };
  Object.assign(process.env, env);
  for (const key of Object.keys(saved)) if (!(key in env)) delete process.env[key];
  try {
    const response = await liveNowRoute.GET();
    return { body: await response.json(), response };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("rota: 401 sem sessao, sem cache e sem ler o banco", async () => {
  actionStubs.db = escola();
  sessao.user = null;
  const { body, response } = await pedir();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(body.data, undefined);
  assert.deepEqual(actionStubs.db.calls.from, []);
  assert.equal(liveNowRoute.dynamic, "force-dynamic");
});

test("rota: so o que o aluno pode ver, a mais recente primeiro, a gravada com o selo, a Comeca em so com a vaga dele; nada do nome da sala", async () => {
  actionStubs.db = escola();
  sessao.user = { id: ALUNO_ID };
  const { body, response } = await pedir();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.ok(Math.abs(Date.parse(body.data.serverTime) - Date.now()) < 5_000, "a hora do servidor para a conta do navegador");
  assert.deepEqual(
    body.data.live.map((item) => [item.title, item.href]),
    [
      ["Live agora", `/webinarios/live-agora/sala?sessao=${SESS(1)}`],
      ["Gravada com selo", `/webinarios/gravada-com-selo/sala?sessao=${SESS(5)}`]
    ],
    "sem a do produto que o aluno nao tem, sem rascunho e sem a de Faixa no topo desligada; a mais recente primeiro"
  );
  assert.deepEqual(body.data.soon, { href: "/webinarios/live-logo", scheduledAt: actionStubs.db.tables.webinar_sessions[5].scheduled_at, title: "Live logo" });

  const text = JSON.stringify(body);
  assert.ok(!text.includes("w-bbbbbbbb"), "o nome da sala nunca sai");
  assert.ok(!/room|jwt|token|calendar/i.test(text), "nada de sala, token ou calendario");
  assert.ok(!text.includes(OUTRO_ALUNO) && !text.includes(ALUNO_ID), "nenhum id de aluno");
  for (const item of body.data.live) assert.deepEqual(Object.keys(item).sort(), ["href", "startedAt", "title"]);
  assert.deepEqual(Object.keys(body.data.soon).sort(), ["href", "scheduledAt", "title"]);
});

test("rota: com o produto, a live do curso entra (e e a mais recente); outro aluno sem vaga nao ve a Comeca em", async () => {
  const db = escola();
  db.tables.entitlements.push({ created_at: iso(Date.now() - DAY), ends_at: null, id: "e1", starts_at: iso(Date.now() - DAY), status: "active", target_id: "curso-x", target_type: "standalone_course", user_id: ALUNO_ID });
  actionStubs.db = db;
  sessao.user = { id: ALUNO_ID };
  const comProduto = (await pedir()).body.data;
  assert.deepEqual(comProduto.live.map((item) => item.title), ["Live do curso", "Live agora", "Gravada com selo"]);

  actionStubs.db = escola();
  sessao.user = { id: OUTRO_ALUNO };
  const outro = (await pedir()).body.data;
  assert.equal(outro.soon, null, "a vaga de um aluno nao vale para o outro");
  assert.deepEqual(outro.live.map((item) => item.title), ["Live agora", "Gravada com selo"]);
});

test("rota: sem a sala neste ambiente a Live ao vivo nao entra (a gravada sim); com limite de vagas e sem a vaga, o Entrar leva a pagina", async () => {
  actionStubs.db = escola();
  sessao.user = { id: ALUNO_ID };
  const semSala = (await pedir({})).body.data;
  assert.deepEqual(semSala.live.map((item) => item.title), ["Gravada com selo"]);

  const db = escola();
  db.tables.webinars[0].capacity = 50;
  actionStubs.db = db;
  const limite = (await pedir()).body.data;
  assert.equal(limite.live[0].href, "/webinarios/live-agora", "A12: sem a vaga, a pagina (Garantir vaga e depois Entrar)");
});

test("rota: nada candidato = uma consulta so; banco sem a migracao = faixa vazia, nunca erro", async () => {
  const vazio = bancoFalso({ tables: { webinar_sessions: [], webinars: [] } });
  actionStubs.db = vazio;
  sessao.user = { id: ALUNO_ID };
  const nada = await pedir();
  assert.equal(nada.response.status, 200);
  assert.deepEqual({ live: nada.body.data.live, soon: nada.body.data.soon }, { live: [], soon: null });
  assert.deepEqual(vazio.calls.from, ["webinar_sessions"], "sem candidata, nem acesso nem vagas sao lidos");

  actionStubs.db = bancoFalso({ errors: { webinar_sessions: { code: "42P01", message: 'relation "public.webinar_sessions" does not exist' } } });
  const semMigracao = await pedir();
  assert.equal(semMigracao.response.status, 200);
  assert.deepEqual(semMigracao.body.data.live, []);
  assert.equal(semMigracao.body.data.soon, null);
});

/* ------------------------------------------------------------------------------------------------
 * Quem pode por regras: o segmento "ganhou acesso hoje" e a ancora da vaga (docs/30 §1.1, D41)
 * ---------------------------------------------------------------------------------------------- */

const W_HOJE = "bbbbbbbb-0000-4000-8000-000000000007";
/** Ganhou acesso a qualquer produto hoje, no dia de Sao Paulo (UTC-3 fixo: 03:00 UTC = 00:00 em Sao Paulo). */
const GANHOU_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }], match: "all" } };
const inicioDoDia = (now) => Math.floor((now - 3 * HOUR) / DAY) * DAY + 3 * HOUR;

/** A escola so com a live do segmento "ganhou acesso hoje" no ar; as vagas viram as linhas da RPC das lives. */
function escolaDoSegmento() {
  const now = Date.now();
  const tables = {
    admin_roles: [],
    entitlements: [],
    profiles: [ALUNO_ID, OUTRO_ALUNO].map((id) => ({ avatar_url: null, created_at: iso(now - 90 * DAY), email: null, full_name: "Aluno", id, last_sign_in_at: null, phone: null })),
    webinar_recordings: [],
    webinar_registrations: [],
    webinar_sessions: [sessionRow(SESS(9), W_HOJE, { started_at: iso(now - 3 * MIN) })],
    webinars: [webinarRow(W_HOJE, { access_mode: "audience", audience: GANHOU_HOJE, slug: "live-de-hoje", title: "Live de hoje" })]
  };
  const rpcs = {
    // Uma linha por aluno: as lives com vaga 'registered' (sem presenca nesta escola).
    communication_webinar_facts: ({ p_user_ids: users }) => ({
      data: users
        .map((userId) => ({ attended: null, registered: tables.webinar_registrations.filter((row) => row.status === "registered" && row.user_id === userId).map((row) => row.webinar_id), user_id: userId }))
        .filter((row) => row.registered.length > 0),
      error: null
    })
  };
  return bancoFalso({ rpcs, tables });
}

function ganhouAcesso(db, userId, startsAt) {
  db.tables.entitlements.push({ created_at: iso(startsAt), ends_at: null, id: `e-${userId}`, starts_at: iso(startsAt), status: "active", target_id: "curso-x", target_type: "standalone_course", user_id: userId });
}

const rpcsDe = (db, name) => db.calls.rpc.filter((call) => call.name === name);

test("rota: segmento 'ganhou acesso hoje': quem ganhou hoje ve a faixa, quem ganhou ontem nao; com a vaga garantida ontem, ve; a contagem de comentarios nunca e lida", async () => {
  const hoje = inicioDoDia(Date.now());

  const db = escolaDoSegmento();
  ganhouAcesso(db, ALUNO_ID, hoje);
  actionStubs.db = db;
  sessao.user = { id: ALUNO_ID };
  assert.deepEqual((await pedir()).body.data.live.map((item) => item.title), ["Live de hoje"], "ganhou hoje (00:00 de Sao Paulo conta)");
  assert.equal(rpcsDe(db, "communication_webinar_facts").length, 0, "no segmento, a ancora nem e lida");

  const ontem = escolaDoSegmento();
  ganhouAcesso(ontem, OUTRO_ALUNO, hoje - HOUR);
  actionStubs.db = ontem;
  sessao.user = { id: OUTRO_ALUNO };
  assert.deepEqual((await pedir()).body.data.live, [], "ganhou ontem (23:00 de Sao Paulo): fora");
  assert.deepEqual(
    rpcsDe(ontem, "communication_webinar_facts").map((call) => call.args),
    [{ p_user_ids: [OUTRO_ALUNO] }],
    "fora do segmento, as lives so da propria pessoa"
  );

  const comVaga = escolaDoSegmento();
  ganhouAcesso(comVaga, OUTRO_ALUNO, hoje - HOUR);
  comVaga.tables.webinar_registrations.push(registrationRow(OUTRO_ALUNO, W_HOJE, null, { registered_at: iso(hoje - 30 * MIN) }));
  actionStubs.db = comVaga;
  assert.deepEqual((await pedir()).body.data.live.map((item) => item.title), ["Live de hoje"], "a vaga garantida ontem segura o segmento");

  for (const banco of [db, ontem, comVaga]) {
    assert.equal(rpcsDe(banco, "communication_comment_counts").length, 0, "sem regra de comentarios, nada da contagem de todos os alunos");
    assert.ok(!banco.calls.from.includes("lessons"), "sem regra de progresso, nada do indice de aulas");
  }
});

test("rota: so le o segmento onde ele decide; sem regra de progresso, ritmo ou turma, nunca o indice de aulas", async () => {
  const now = Date.now();
  const ENTROU_NA_SEMANA = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }], match: "all" } };
  const escolaCom = (webinar) => {
    const tables = {
      admin_roles: [],
      entitlements: [{ created_at: iso(now - 40 * DAY), ends_at: null, id: "e-outro", starts_at: iso(now - 40 * DAY), status: "active", target_id: "outro-curso", target_type: "standalone_course", user_id: ALUNO_ID }],
      profiles: [{ avatar_url: null, created_at: iso(now - 90 * DAY), email: null, full_name: "Aluno", id: ALUNO_ID, last_sign_in_at: iso(now - HOUR), phone: null }],
      webinar_recordings: [],
      webinar_registrations: [],
      webinar_sessions: [sessionRow(SESS(9), W_HOJE, { started_at: iso(now - 3 * MIN) })],
      webinars: [webinarRow(W_HOJE, { slug: "live-de-hoje", title: "Live de hoje", ...webinar })]
    };
    return bancoFalso({ tables });
  };
  const leuOSegmento = (db) => ["profiles", "lesson_progress", "cohort_memberships", "lessons", "course_modules"].filter((table) => db.calls.from.includes(table));
  sessao.user = { id: ALUNO_ID };

  // "Quem tem o produto e está no segmento" ('product' + audience_restricts) sem o produto: a resposta ja e nao, e a
  // cada 60 s nada do perfil, do progresso, das turmas nem das aulas e lido.
  const semProduto = escolaCom({ access_mode: "product", audience: ENTROU_NA_SEMANA, audience_restricts: true, product_id: "curso-x" });
  actionStubs.db = semProduto;
  assert.deepEqual((await pedir()).body.data.live, []);
  assert.deepEqual(leuOSegmento(semProduto), [], "both sem o produto: o segmento nem e lido");

  // Segmento "entrou na semana": le o perfil, mas nao o indice de aulas (a regra de entrada nao usa).
  const entrada = escolaCom({ access_mode: "audience", audience: ENTROU_NA_SEMANA });
  actionStubs.db = entrada;
  assert.deepEqual((await pedir()).body.data.live.map((item) => item.title), ["Live de hoje"]);
  assert.ok(entrada.calls.from.includes("profiles"));
  assert.ok(!entrada.calls.from.includes("lessons") && !entrada.calls.from.includes("course_modules"), "sem o indice de aulas");
});
