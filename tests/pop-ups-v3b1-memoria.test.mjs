import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A memoria dos pop-ups no navegador (docs/25 §4.9; notifications-client.ts): o pedido do topo com a pagina
// traz os pop-ups e o host entra nele (um pedido so), pagina nao coberta dentro do minuto nao pede nada,
// pagina coberta com plano novo tambem nao, plano velho pede uma vez (mesmo com o numero do sino novo), a
// home segura o topo e pede uma vez, a troca de conta esquece tudo, a falha conta como tentativa, e cada
// resposta do POST /show e o que o aluno fez acertam o plano guardado. O fetch e o relogio sao trocados
// aqui; nada de rede.

const pedidos = [];
let responder = () => ({ body: { data: { popup: null, unseen: 0 } }, status: 200 });

globalThis.fetch = async (url, init) => {
  const address = String(url);
  const pedido = { body: init?.body ? JSON.parse(String(init.body)) : null, method: init?.method ?? "GET", url: address };

  pedidos.push(pedido);

  if (init?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const resposta = await responder(address, pedido, init);

  return new Response(JSON.stringify(resposta.body), { headers: { "content-type": "application/json" }, status: resposta.status });
};

let agora = Date.parse("2026-10-23T15:00:00.000Z");
Date.now = () => agora;

const client = await import("../src/components/member/notifications/notifications-client.ts");
const host = await import("../src/components/member/notifications/popup-host-model.ts");

const MINUTO = 60_000;
const iso = (time) => new Date(time).toISOString();
const resumos = () => pedidos.filter((pedido) => pedido.url.startsWith("/api/notifications/summary"));

const item = (extra = {}) => ({ delaySeconds: 3, exclude: [], id: "pop-a", notBefore: null, pages: ["any"], stopOn: null, trigger: "page_load", ...extra });

/** Resposta do resumo: `plan` so quando a pagina pedida esta em `pages` (como o servidor faz). */
function resumoCom({ pages = ["content:*"], plan = [item({ pages: ["content:abc"] })], unseen = 2 } = {}) {
  return (url) => {
    const page = new URL(url, "http://local").searchParams.get("page");
    const coberta = page !== null && pages.some((pattern) => pattern === "any" || pattern === page || (pattern.endsWith(":*") && page.startsWith(pattern.slice(0, -1))));

    return {
      body: { data: { popup: null, popups: page === null ? undefined : { asOf: iso(agora), pages, plan: coberta ? plan : null }, unseen } },
      status: 200
    };
  };
}

let conta = 0;

/** Cada teste com uma conta nova: memoria vazia, nenhum pedido em andamento. */
function recomecar() {
  conta += 1;
  client.claimNotificationsMemory(`aluno-${conta}`);
  client.holdSummaryForPopup(false);
  pedidos.length = 0;
  agora += 10 * MINUTO;
}

test("primeira pagina: o topo pede com a pagina e o host entra no mesmo pedido; a pagina seguinte nao coberta nao pede", async () => {
  recomecar();
  responder = resumoCom();

  // AppShell: o efeito do topo roda antes do efeito do host.
  const doTopo = client.refreshNotificationsSummary({ page: "content:abc" });
  const plano = await client.ensurePopupPlan("content:abc");

  assert.deepEqual(resumos().map((pedido) => pedido.url), ["/api/notifications/summary?page=content%3Aabc"]);
  assert.deepEqual(plano, { items: [item({ pages: ["content:abc"] })], offsetMs: 0 });
  assert.equal((await doTopo).unseen, 2);
  assert.equal(client.currentSummaryFor(undefined).unseen, 2, "o numero do sino veio junto");

  // 20 s depois, Perfil: o topo nao pede (numero e pop-ups novos) e o host decide sozinho.
  agora += 20_000;
  assert.equal(await client.refreshNotificationsSummary({ page: "profile" }), null);
  assert.equal(await client.ensurePopupPlan("profile"), null, "Perfil nao esta no mapa");
  assert.equal(client.popupPlanFromMemory("profile").covered, false);

  // Outro produto coberto, plano novo: nenhum pedido.
  assert.deepEqual(await client.ensurePopupPlan("content:xyz"), { items: [item({ pages: ["content:abc"] })], offsetMs: 0 });
  assert.equal(resumos().length, 1, "um pedido no total");
});

test("plano velho pede uma vez (forcado, mesmo com o numero do sino novo); resposta de pagina nao coberta pede o plano", async () => {
  recomecar();
  responder = resumoCom({ pages: ["any"], plan: [item()] });
  await client.ensurePopupPlan("home");
  assert.equal(resumos().length, 1);

  agora += MINUTO + 1_000;
  client.setSummaryUnseen(5); // o painel acabou de acertar o numero: ele esta novo, os pop-ups nao
  assert.equal(client.popupPlanFromMemory("home"), null, "passou do minuto");
  assert.deepEqual(await client.ensurePopupPlan("home"), { items: [item()], offsetMs: 0 });
  assert.deepEqual(resumos().map((pedido) => pedido.url), ["/api/notifications/summary?page=home", "/api/notifications/summary?page=home"]);

  // A memoria veio de uma pagina nao coberta (plan null); agora a pagina e coberta: pede o plano uma vez.
  recomecar();
  responder = resumoCom({ pages: ["content:*"], plan: [item({ pages: ["content:*"] })] });
  await client.refreshNotificationsSummary({ page: "home" });
  assert.deepEqual(client.popupPlanFromMemory("content:abc"), { covered: true, offsetMs: 0, plan: null });
  assert.deepEqual(await client.ensurePopupPlan("content:abc"), { items: [item({ pages: ["content:*"] })], offsetMs: 0 });
  assert.equal(resumos().length, 2);
});

test("home: o topo fica segurado ate o host pedir; depois, um pedido ?page=home; com a memoria nova, nenhum", async () => {
  recomecar();
  responder = resumoCom({ pages: ["home"], plan: [item({ pages: ["home"] })] });

  assert.equal(host.POPUP_HOST_RULES.homeFetchDelayMs, 1_500);
  client.holdSummaryForPopup(true);
  assert.equal(await client.refreshNotificationsSummary({ page: "home" }), null, "a volta para a aba nos 1,5 s nao pede");
  assert.equal(resumos().length, 0);

  client.holdSummaryForPopup(false);
  const doHost = client.refreshNotificationsSummary({ page: "home" });
  const plano = await client.ensurePopupPlan("home");
  await doHost;
  assert.deepEqual(resumos().map((pedido) => pedido.url), ["/api/notifications/summary?page=home"]);
  assert.deepEqual(plano.items.map((entry) => entry.id), ["pop-a"]);

  // Volta para a home 30 s depois: a memoria responde na hora, sem pedido.
  agora += 30_000;
  const daMemoria = client.popupPlanFromMemory("home");
  assert.deepEqual(daMemoria, { covered: true, offsetMs: 0, plan: [item({ pages: ["home"] })] });
  assert.deepEqual(
    host.openingsForPageView({ items: daMemoria.plan, offsetMs: daMemoria.offsetMs, pageKey: "home", pageViewStart: agora }).map((armed) => armed.at),
    [agora + 3_000]
  );
  assert.equal(resumos().length, 1);
});

test("o relogio do navegador e acertado pelo asOf da resposta", async () => {
  recomecar();
  responder = (url) => {
    const resposta = resumoCom({ pages: ["any"], plan: [item()] })(url);
    resposta.body.data.popups.asOf = iso(agora + 4_000);
    return resposta;
  };

  assert.deepEqual(await client.ensurePopupPlan("saved"), { items: [item()], offsetMs: 4_000 });
});

test("pedido com pagina entra em outro com pagina; o comum entra em qualquer um; o da v1 nao entra no da pagina", async () => {
  recomecar();
  const pendentes = [];
  responder = (url) =>
    new Promise((resolve) => {
      pendentes.push(() => resolve(resumoCom({ pages: ["any"], plan: [] })(url)));
    });

  const primeiro = client.refreshNotificationsSummary({ page: "content:abc" });
  assert.equal(client.refreshNotificationsSummary({ force: true, page: "home" }), primeiro, "outra pagina: o host confere a cobertura depois");
  assert.equal(client.refreshNotificationsSummary({ force: true }), primeiro);
  const daV1 = client.refreshNotificationsSummary({ popup: true });
  assert.notEqual(daV1, primeiro);
  assert.equal(resumos().length, 2);
  assert.equal(resumos()[1].url, "/api/notifications/summary?popup=1");

  pendentes.forEach((soltar) => soltar());
  await Promise.all([primeiro, daV1]);
});

test("a troca de conta esquece os pop-ups guardados e nao guarda a resposta do pedido da conta anterior", async () => {
  recomecar();
  responder = resumoCom({ pages: ["any"], plan: [item()] });
  await client.ensurePopupPlan("home");
  assert.notEqual(client.popupPlanFromMemory("home"), null);

  client.claimNotificationsMemory("outra-conta");
  assert.equal(client.popupPlanFromMemory("home"), null);

  // Pedido que saiu antes da troca: a resposta volta, mas nao vira a memoria da conta nova.
  recomecar();
  let soltar;
  responder = (url) =>
    new Promise((resolve) => {
      soltar = () => resolve(resumoCom({ pages: ["any"], plan: [item()] })(url));
    });
  const antigo = client.refreshNotificationsSummary({ page: "home" });
  client.claimNotificationsMemory("mais-uma-conta");
  soltar();
  await antigo;
  assert.equal(client.popupPlanFromMemory("home"), null);
});

test("falha conta como tentativa para o numero e para os pop-ups: dentro do minuto, nada de pedido nem de plano velho", async () => {
  recomecar();
  responder = resumoCom({ pages: ["any"], plan: [item()] });
  await client.ensurePopupPlan("home");

  agora += MINUTO + 1_000;
  responder = () => ({ body: { error: "Servico indisponivel." }, status: 503 });
  assert.equal(await client.ensurePopupPlan("home"), null, "falhou: nenhum pop-up (nunca o plano velho)");
  assert.equal(resumos().length, 2);

  agora += 10_000;
  assert.equal(await client.ensurePopupPlan("content:abc"), null);
  assert.equal(await client.refreshNotificationsSummary({ page: "content:abc" }), null);
  assert.equal(resumos().length, 2, "a troca de pagina logo depois da falha nao pede de novo");

  agora += MINUTO;
  responder = resumoCom({ pages: ["any"], plan: [item()] });
  assert.deepEqual((await client.ensurePopupPlan("home")).items, [item()], "passado o minuto, tenta de novo");
  assert.equal(resumos().length, 3);

  // O servidor sem pop-ups (popups: null, erro dele): nada a mostrar neste minuto, o numero continua.
  agora += 2 * MINUTO;
  responder = () => ({ body: { data: { popup: null, popups: null, unseen: 7 } }, status: 200 });
  assert.equal(await client.ensurePopupPlan("home"), null);
  assert.equal(client.currentSummaryFor(undefined).unseen, 7);
  assert.equal(await client.ensurePopupPlan("home"), null);
  assert.equal(resumos().length, 4);
});

test("POST /show: 200 devolve o conteudo e o proximo; 409 traz nextAt; 404 e 429 sem nextAt; o fim da pagina aborta", async () => {
  recomecar();
  const popup = { audio: null, body: "Texto", canSnooze: false, cta: null, id: "pop-a", image: null, title: "Oi" };
  responder = (url, pedido) => {
    if (pedido.body.page === "home") {
      return { body: { data: { next: { notBefore: iso(agora + 5_000) }, popup } }, status: 200 };
    }

    if (pedido.body.page === "profile") {
      return { body: { error: "Pop-up fora da vez.", nextAt: iso(agora + MINUTO), reason: "frequency" }, status: 409 };
    }

    if (pedido.body.page === "saved") {
      return { body: { error: "Pop-up fora da vez.", nextAt: null, reason: "changed" }, status: 409 };
    }

    return pedido.body.page === "support"
      ? { body: { error: "Muitas tentativas. Espere um pouco." }, status: 429 }
      : { body: { error: "Pop-up nao encontrado." }, status: 404 };
  };

  assert.deepEqual(await client.postPopupShow("pop-a", { page: "home", trigger: "page_load" }), { next: { notBefore: iso(agora + 5_000) }, popup });
  assert.deepEqual(pedidos.at(-1), { body: { page: "home", trigger: "page_load" }, method: "POST", url: "/api/popups/pop-a/show" });

  const recusa = await client.postPopupShow("pop-a", { page: "profile", trigger: "page_load" }).catch((error) => error);
  assert.ok(recusa instanceof client.NotificationsRequestError);
  assert.equal(recusa.status, 409);
  assert.equal(recusa.nextAt, iso(agora + MINUTO));
  assert.equal(recusa.reason, "frequency", "v3b-2: o motivo do 409");

  const mudou = await client.postPopupShow("pop-a", { page: "saved", trigger: "page_load" }).catch((error) => error);
  assert.equal(mudou.status, 409);
  assert.equal(mudou.nextAt, null);
  assert.equal(mudou.reason, "changed");

  for (const [page, status] of [["materials", 404], ["support", 429]]) {
    const erro = await client.postPopupShow("pop-a", { page, trigger: "lesson_completed" }).catch((error) => error);
    assert.equal(erro.status, status);
    assert.equal(erro.nextAt, undefined);
    assert.equal(erro.reason, undefined, "so o 409 traz motivo");
  }

  const fim = new AbortController();
  fim.abort();
  await assert.rejects(client.postPopupShow("pop-a", { page: "home", trigger: "page_load" }, fim.signal), { name: "AbortError" });
});

test("eventos do pop-up vao pelo beacon com `via` so no fechamento", () => {
  pedidos.length = 0;

  client.postPopupEvent("pop-a", "closed", { via: "esc" });
  client.postPopupEvent("pop-a", "clicked", { via: "x" });
  client.postPopupEvent("pop-a", "snoozed");

  assert.deepEqual(
    pedidos.map((pedido) => [pedido.url, pedido.body]),
    [
      ["/api/popups/pop-a/events", { event: "closed", via: "esc" }],
      ["/api/popups/pop-a/events", { event: "clicked" }],
      ["/api/popups/pop-a/events", { event: "snoozed" }]
    ]
  );
});

test("plano guardado depois de cada resposta e de cada coisa que o aluno fez (a tabela da docs/25 §4.9)", async () => {
  recomecar();
  const plano = [
    item({ id: "uma-vez" }),
    item({ id: "ate-clicar", stopOn: "click" }),
    item({ id: "ate-terminar", stopOn: "never" }),
    item({ id: "lembrar" }),
    item({ id: "nunca-mais" }),
    item({ id: "fechou" }),
    item({ id: "recusado" }),
    item({ id: "sumiu" })
  ];
  responder = resumoCom({ pages: ["any"], plan: plano });
  await client.ensurePopupPlan("home");
  const ids = () => client.popupPlanFromMemory("home").plan.map((entry) => `${entry.id}${entry.notBefore ? `@${entry.notBefore}` : ""}`);

  client.updatePopupInPlan("uma-vez", null); // show 200 com next null: nao volta mais
  client.updatePopupInPlan("ate-clicar", { notBefore: iso(agora + 5_000) }); // show 200: volta em 5 s
  client.updatePopupInPlan("recusado", { notBefore: iso(agora + MINUTO) }); // 409 com nextAt
  client.updatePopupInPlan("sumiu", null); // 404, 429, rede ou 409 sem nextAt
  assert.deepEqual(ids(), [`ate-clicar@${iso(agora + 5_000)}`, "ate-terminar", "lembrar", "nunca-mais", "fechou", `recusado@${iso(agora + MINUTO)}`]);

  client.updatePopupAfterOutcome("ate-terminar", "clicked"); // "Só quando o pop-up terminar": o clique nao para
  client.updatePopupAfterOutcome("fechou", "closed"); // fechar nao muda nada
  assert.deepEqual(ids(), [`ate-clicar@${iso(agora + 5_000)}`, "ate-terminar", "lembrar", "nunca-mais", "fechou", `recusado@${iso(agora + MINUTO)}`]);

  client.updatePopupAfterOutcome("ate-clicar", "clicked");
  client.updatePopupAfterOutcome("lembrar", "snoozed");
  client.updatePopupAfterOutcome("nunca-mais", "dismissed");
  client.updatePopupAfterOutcome("nao-existe", "clicked");
  assert.deepEqual(ids(), ["ate-terminar", "fechou", `recusado@${iso(agora + MINUTO)}`]);

  // Uma vez: show 200 com next null ja tirou; o clique depois nao quebra nada.
  client.updatePopupAfterOutcome("uma-vez", "clicked");
  assert.equal(ids().length, 3);
});

test("um pop-up sem ritmo: o show diz 'de novo em 5 s', e a pagina seguinte do mesmo minuto o arma sem pedir nada", async () => {
  recomecar();
  responder = resumoCom({ pages: ["any"], plan: [item({ stopOn: "never" })] });
  const plano = await client.ensurePopupPlan("saved");
  const primeira = host.openingsForPageView({ items: plano.items, now: agora, offsetMs: plano.offsetMs, pageKey: "saved", pageViewStart: agora });
  assert.equal(primeira.length, 1);

  // Abriu 3 s depois; o show respondeu "pode de novo 5 s depois"; o aluno fechou.
  agora += 3_000;
  client.updatePopupInPlan("pop-a", { notBefore: iso(agora + 5_000) });
  client.updatePopupAfterOutcome("pop-a", "closed");

  agora += 6_000; // Materiais, 6 s depois de aparecer
  const kept = client.popupPlanFromMemory("materials");
  const segunda = host.openingsForPageView({ items: kept.plan, now: agora, offsetMs: kept.offsetMs, pageKey: "materials", pageViewStart: agora });
  assert.equal(segunda.length, 1);
  assert.equal(resumos().length, 1, "nenhum pedido novo");
});

test("summaryUrl: com pagina, com o pop-up da v1 ou so o numero", () => {
  assert.equal(client.summaryUrl({ page: "lesson:curso-x" }), "/api/notifications/summary?page=lesson%3Acurso-x");
  assert.equal(client.summaryUrl({ popup: true }), "/api/notifications/summary?popup=1");
  assert.equal(client.summaryUrl({ page: "home", popup: true }), "/api/notifications/summary?page=home");
  assert.equal(client.summaryUrl(), "/api/notifications/summary");
});

test("v3b-2: o show recusado antes da hora (409 not_started) traz o nextAt e o motivo; os quatro momentos vao no corpo", async () => {
  recomecar();
  const comeca = iso(agora + 30_000);
  responder = (url, pedido) =>
    pedido.body.trigger === "first_login" || pedido.body.trigger === "course_completed"
      ? { body: { error: "Pop-up fora da vez.", nextAt: null, reason: "trigger" }, status: 409 }
      : { body: { error: "Pop-up fora da vez.", nextAt: comeca, reason: "not_started" }, status: 409 };

  const cedo = await client.postPopupShow("live", { page: "saved", trigger: "page_load" }).catch((error) => error);
  assert.equal(cedo.status, 409);
  assert.equal(cedo.reason, "not_started");
  assert.equal(cedo.nextAt, comeca);

  for (const trigger of ["first_login", "course_completed"]) {
    const erro = await client.postPopupShow("live", { page: "lesson:curso", trigger }).catch((error) => error);
    assert.equal(erro.reason, "trigger");
    assert.deepEqual(pedidos.at(-1).body, { page: "lesson:curso", trigger });
  }

  // Motivo que nao e texto nao vira motivo.
  responder = () => ({ body: { error: "Pop-up fora da vez.", nextAt: comeca, reason: 7 }, status: 409 });
  const estranho = await client.postPopupShow("live", { page: "saved", trigger: "page_load" }).catch((error) => error);
  assert.equal(estranho.reason, undefined);
});

test("v3b-2: subscribePopupMemory avisa depois de cada resposta guardada (com o plano ja na memoria), nunca a da conta anterior, e para de avisar", async () => {
  recomecar();
  const vistos = [];
  const parar = client.subscribePopupMemory(() => {
    const kept = client.popupPlanFromMemory("saved");
    vistos.push(kept?.plan?.map((entry) => entry.id) ?? null);
  });
  const quebrado = client.subscribePopupMemory(() => {
    throw new Error("ouvinte com defeito");
  });

  responder = resumoCom({ pages: ["any"], plan: [item({ id: "live", startsAt: iso(agora + 60 * MINUTO) })] });
  await client.ensurePopupPlan("saved");
  assert.deepEqual(vistos, [["live"]], "avisou depois de guardar");
  assert.equal(client.popupPlanFromMemory("saved").plan[0].startsAt, iso(agora + 60 * MINUTO), "o ouvinte com defeito nao derrubou a resposta");

  // Mexer no plano depois do show nao avisa (so a resposta nova do resumo).
  client.updatePopupInPlan("live", { notBefore: iso(agora + 5_000) });
  assert.equal(vistos.length, 1);

  // A falha tambem e uma resposta guardada (nenhum pop-up neste minuto).
  agora += 2 * MINUTO;
  responder = () => ({ body: { error: "falhou" }, status: 500 });
  await client.ensurePopupPlan("saved");
  assert.deepEqual(vistos, [["live"], null]);

  // A resposta do pedido feito pela conta anterior nao e guardada nem avisada.
  agora += 2 * MINUTO;
  let soltar;
  responder = () => new Promise((resolve) => {
    soltar = () => resolve(resumoCom({ pages: ["any"], plan: [item()] })("/api/notifications/summary?page=saved"));
  });
  const pedido = client.refreshNotificationsSummary({ force: true, page: "saved" });
  await new Promise((resolve) => setImmediate(resolve));
  client.claimNotificationsMemory("outra-conta");
  soltar();
  await pedido;
  assert.equal(vistos.length, 2);

  parar();
  quebrado();
  client.claimNotificationsMemory(`aluno-${conta}`);
  agora += 2 * MINUTO;
  responder = resumoCom({ pages: ["any"], plan: [item()] });
  await client.ensurePopupPlan("saved");
  assert.equal(vistos.length, 2, "parou de ouvir");
});
