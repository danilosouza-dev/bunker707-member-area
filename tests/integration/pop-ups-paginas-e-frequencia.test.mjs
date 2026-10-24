import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Pop-ups da v3b-1 "frequencia, paginas e como fechar" (docs/25 §1 e §4) contra o banco LOCAL de verdade: o
// produtor publica pelas Server Actions com a configuracao no rascunho; o aluno pede o resumo do sino com
// ?page= e abre pelo POST /api/popups/[id]/show (como o navegador faria); "mostrar de novo" pela funcao do
// store (a acao e de outro pacote). Aqui: paginas e excecoes (a excecao vence), "ao concluir uma aula", a
// formacao que vale para os cursos dela, ate N por dia (meia-noite de Sao Paulo), intervalo, para no clique
// ou so quando termina, limite total com "Lembrar depois", o "Volta em", os 5 s entre duas aberturas, a
// gravacao atomica (updated_at), o "Só no X" e as vezes no dia depois de um "mostrar de novo". O plano nunca
// le linha de aluno em pagina descoberta (provado no teste de unidade, tests/pop-ups-v3b1-rotas.test.mjs).
// Tres alunos dividem as chamadas: o limite de 30 chamadas de pop-up por minuto e por aluno.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { reshowPopupDeliveries } = await import("../../src/server/communications/store.ts");
const { fetchPopupDelivery, recordPopupImpression } = await import("../../src/server/communications/popup-store.ts");
const { popupDayBounds } = await import("../../src/server/communications/popup-display-model.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");
const eventsRoute = await import("../../src/app/api/popups/[id]/events/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunaExpirada = usuarioDeTeste(contas.alunaAcessoExpirado);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const SEGUNDO = 1_000;
const MIN = 60 * SEGUNDO;
const HORA = 60 * MIN;

// Formacao temporaria (a escola de teste nao tem): um curso incluido nela e um avulso com o parentFormationId velho.
const FORMACAO = "teste-formacao-popups";
const CURSO_DA_FORMACAO = "teste-curso-da-formacao-popups";
const CURSO_AVULSO = "teste-curso-avulso-popups";

const BASE = emptyNoticeDraft("popup");
const SEM_RITMO_NEVER = { everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "never" };

/** Rascunho de pop-up para todos os alunos, com a configuracao dada (o `repeat` da v1 sempre coerente). */
function popup({ popup: settings = {}, ...extra } = {}) {
  const frequency = settings.frequency ?? { mode: "once" };

  return {
    ...BASE,
    audience: { kind: "everyone" },
    body: "A turma nova começa segunda.",
    cta: { href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" },
    title: "Pop-up sob medida",
    ...extra,
    popup: { ...BASE.popup, ...settings, frequency },
    repeat: frequency.mode === "once" ? "once" : "until_action"
  };
}

function itemDoCatalogo(id, extra) {
  return {
    access_label: null,
    access_model: "closed",
    bucket: "courses",
    commerce_scope: "sellable_product",
    description: "Item ficticio dos testes de pop-up.",
    eyebrow: "Curso",
    id,
    image: "/hero/bunker-ai-hero.png",
    is_locked: false,
    kind: "Curso",
    lessons_label: "1 aula",
    listing: "hidden",
    progress: 0,
    publication_status: "published",
    purchase_label: "Comprar",
    purchase_url: "https://exemplo.test/comprar/pop-ups",
    sort_order: 90,
    status: "Bloqueado",
    title: `Teste de pop-up: ${id}`,
    ...extra
  };
}

async function apagarFormacao() {
  unwrap(await db.from("content_items").delete().in("id", [FORMACAO, CURSO_DA_FORMACAO, CURSO_AVULSO]), "Apagando a formacao temporaria");
}

before(async () => {
  await limparComunicacao(db);
  await apagarFormacao();
});
beforeEach(() => limparComunicacao(db));
after(async () => {
  await limparComunicacao(db);
  await apagarFormacao();
});

async function publicar(draft) {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return publicado.data;
}

async function resumoDe(user, page) {
  actAs(user);
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary?page=${encodeURIComponent(page)}`));
  assert.equal(response.status, 200);

  return (await response.json()).data.popups;
}

async function mostrar(user, id, page, trigger = "page_load") {
  actAs(user);
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify({ page, trigger }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  const corpo = await response.json();

  // v3b-2: todo 409 traz a hora do servidor (asOf, ISO, nunca no futuro); conferida aqui e tirada do corpo para os
  // testes compararem o resto palavra por palavra.
  if (response.status === 409) {
    const { asOf, ...resto } = corpo;
    assert.match(asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "o 409 traz asOf");
    assert.ok(Date.parse(asOf) <= Date.now());
    return { asOf, body: resto, status: response.status };
  }

  return { body: corpo, status: response.status };
}

/** Evento como o navegador manda no sendBeacon: corpo JSON em text/plain. */
async function evento(user, id, body) {
  actAs(user);
  const response = await eventsRoute.POST(
    new Request(`http://localhost/api/popups/${id}/events`, { body: JSON.stringify(body), headers: { "content-type": "text/plain;charset=UTF-8" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

async function entrega(campaignId, userId) {
  const [linha] = unwrap(
    await db
      .from("campaign_deliveries")
      .select("eligible,impressions,day_impressions,last_seen_at,clicked_at,snoozed_until,snooze_count,reshown_at,updated_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Lendo o pop-up do aluno"
  );

  return linha ?? null;
}

/** Passaram `ms` desde a ultima abertura (e do "Lembrar depois"): o teste volta o relogio das linhas do aluno. */
async function passaram(userId, ms) {
  const linhas = unwrap(
    await db.from("campaign_deliveries").select("campaign_id,first_seen_at,last_seen_at,snoozed_until").eq("user_id", userId),
    "Lendo os pop-ups do aluno"
  );
  const antes = (valor) => (valor ? new Date(Date.parse(valor) - ms).toISOString() : null);

  for (const linha of linhas) {
    unwrap(
      await db
        .from("campaign_deliveries")
        .update({ first_seen_at: antes(linha.first_seen_at), last_seen_at: antes(linha.last_seen_at), snoozed_until: antes(linha.snoozed_until) })
        .eq("campaign_id", linha.campaign_id)
        .eq("user_id", userId),
      "Voltando o relogio"
    );
  }
}

/** Longe da meia-noite de Sao Paulo (o teste do dia volta o relogio alguns segundos). */
async function foraDaVirada() {
  const { nextStart, start } = popupDayBounds(Date.now());
  const desdeAVirada = Date.now() - start;
  const ateAVirada = nextStart - Date.now();
  const espera = desdeAVirada < 20 * SEGUNDO ? 20 * SEGUNDO - desdeAVirada : ateAVirada < 20 * SEGUNDO ? ateAVirada + 20 * SEGUNDO : 0;

  if (espera > 0) {
    await new Promise((resolve) => setTimeout(resolve, espera));
  }
}

test("'Em qualquer página, menos Perfil': o plano vale em outra pagina e o show no Perfil e 409 (a excecao vence)", async () => {
  const publicado = await publicar(popup({ popup: { exclude: ["profile"], pages: ["any"] }, title: "Menos Perfil" }));

  const plano = await resumoDe(aluna, `content:${curso.id}`);
  assert.deepEqual(plano.pages, ["any"]);
  assert.deepEqual(plano.plan, [
    { delaySeconds: 3, exclude: ["profile"], id: publicado.id, notBefore: null, pages: ["any"], stopOn: null, trigger: "page_load" }
  ]);

  const noPerfil = await mostrar(aluna, publicado.id, "profile");
  assert.equal(noPerfil.status, 409);
  assert.deepEqual(noPerfil.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "page" });
  assert.equal((await entrega(publicado.id, aluna.id)).impressions, 0, "recusado: nada gravado");

  const noProduto = await mostrar(aluna, publicado.id, `content:${curso.id}`);
  assert.equal(noProduto.status, 200, JSON.stringify(noProduto.body));
  assert.equal(noProduto.body.data.popup.title, "Menos Perfil");
  assert.equal(noProduto.body.data.next, null, "'Uma vez' visto: nao volta");

  const eventos = unwrap(
    await db.from("student_events").select("event_type,metadata").eq("user_id", aluna.id).eq("entity_id", publicado.id),
    "Lendo o historico"
  );
  assert.deepEqual(eventos, [{ event_type: "message_impressed", metadata: { campaign_id: publicado.id, page: `content:${curso.id}`, trigger: "page_load" } }]);
});

test("'Ao concluir uma aula' so nas aulas de um curso: o Inicio nem recebe plano; o show ao abrir a pagina e 409 'trigger' e ao concluir abre", async () => {
  const publicado = await publicar(popup({ popup: { pages: [`lesson:${curso.id}`], trigger: "lesson_completed" }, title: "Ao concluir" }));

  const noInicio = await resumoDe(aluna, "home");
  assert.deepEqual(noInicio.pages, ["lesson:*"], "o mapa nunca leva o id do produto");
  assert.equal(noInicio.plan, null);

  const naAula = await resumoDe(aluna, `lesson:${curso.id}`);
  assert.deepEqual(naAula.plan.map((item) => [item.id, item.trigger, item.pages]), [[publicado.id, "lesson_completed", [`lesson:${curso.id}`]]]);

  const aoAbrir = await mostrar(aluna, publicado.id, `lesson:${curso.id}`, "page_load");
  assert.deepEqual(aoAbrir.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "trigger" });

  const aoConcluir = await mostrar(aluna, publicado.id, `lesson:${curso.id}`, "lesson_completed");
  assert.equal(aoConcluir.status, 200, JSON.stringify(aoConcluir.body));
});

test("formacao: as aulas da formacao valem para as aulas dos cursos incluidos dela; o curso avulso (parentFormationId velho) nao", async () => {
  unwrap(
    await db.from("content_items").upsert(
      [
        itemDoCatalogo(FORMACAO, { bucket: "formations", kind: "Formação" }),
        itemDoCatalogo(CURSO_DA_FORMACAO, { commerce_scope: "included_content" }),
        itemDoCatalogo(CURSO_AVULSO)
      ],
      { onConflict: "id" }
    ),
    "Criando a formacao temporaria"
  );
  unwrap(
    await db.from("content_page_settings").upsert(
      [CURSO_DA_FORMACAO, CURSO_AVULSO].map((id) => ({ content_id: id, settings: { parentFormationId: FORMACAO } })),
      { onConflict: "content_id" }
    ),
    "Ligando os cursos a formacao"
  );

  const publicado = await publicar(popup({ popup: { pages: [`lesson:${FORMACAO}`] }, title: "Aulas da formação" }));

  const plano = await resumoDe(aluna, `lesson:${CURSO_DA_FORMACAO}`);
  assert.deepEqual(plano.pages, ["lesson:*"]);
  assert.deepEqual(plano.plan[0].pages, [`lesson:${CURSO_DA_FORMACAO}`, `lesson:${FORMACAO}`]);

  assert.equal((await mostrar(aluna, publicado.id, `lesson:${CURSO_AVULSO}`)).body.reason, "page");
  const noCurso = await mostrar(aluna, publicado.id, `lesson:${CURSO_DA_FORMACAO}`);
  assert.equal(noCurso.status, 200, JSON.stringify(noCurso.body));
});

test("ate 2 por dia, so quando terminar: duas aberturas, a terceira e 409 ate a meia-noite de Sao Paulo; no dia seguinte volta", async () => {
  await foraDaVirada();
  const frequency = { ...SEM_RITMO_NEVER, maxPerDay: 2 };
  const publicado = await publicar(popup({ popup: { frequency }, title: "Duas por dia" }));

  const primeira = await mostrar(alunaExpirada, publicado.id, "home");
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body));
  assert.equal((await entrega(publicado.id, alunaExpirada.id)).day_impressions, 1);
  await passaram(alunaExpirada.id, 6 * SEGUNDO);

  const segunda = await mostrar(alunaExpirada, publicado.id, "home");
  assert.equal(segunda.status, 200);
  const meiaNoite = new Date(popupDayBounds(Date.now()).nextStart).toISOString();
  assert.deepEqual(segunda.body.data.next, { notBefore: meiaNoite }, "o show ja diz quando pode voltar");
  assert.equal((await entrega(publicado.id, alunaExpirada.id)).day_impressions, 2);
  await passaram(alunaExpirada.id, 6 * SEGUNDO);

  const terceira = await mostrar(alunaExpirada, publicado.id, "home");
  assert.equal(terceira.status, 409);
  assert.deepEqual(terceira.body, { error: "Pop-up fora da vez.", nextAt: meiaNoite, reason: "frequency" });
  assert.equal((await resumoDe(alunaExpirada, "home")).plan[0].notBefore, meiaNoite);

  await passaram(alunaExpirada.id, 25 * HORA);
  assert.equal((await mostrar(alunaExpirada, publicado.id, "home")).status, 200, "no dia seguinte volta");
  const depois = await entrega(publicado.id, alunaExpirada.id);
  assert.equal(depois.day_impressions, 1, "a conta do dia recomeca");
  assert.equal(depois.impressions, 3);
});

test("intervalo de 30 minutos: o show diz a proxima hora; antes dela e 409 com nextAt; depois volta", async () => {
  const frequency = { everyMinutes: 30, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click" };
  const publicado = await publicar(popup({ popup: { frequency, pages: ["any"] }, title: "A cada 30 minutos" }));

  const primeira = await mostrar(alunoSemAcesso, publicado.id, "materials");
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body));
  const vista = Date.parse((await entrega(publicado.id, alunoSemAcesso.id)).last_seen_at);
  assert.equal(Date.parse(primeira.body.data.next.notBefore), vista + 30 * MIN);

  await passaram(alunoSemAcesso.id, 6 * SEGUNDO);
  const cedo = await mostrar(alunoSemAcesso, publicado.id, "materials");
  assert.equal(cedo.status, 409);
  assert.equal(cedo.body.reason, "frequency");
  assert.equal(Date.parse(cedo.body.nextAt), vista - 6 * SEGUNDO + 30 * MIN);

  await passaram(alunoSemAcesso.id, 31 * MIN);
  assert.equal((await mostrar(alunoSemAcesso, publicado.id, "materials")).status, 200);
});

test("para no clique x so quando terminar: depois de clicar, 'Quando o aluno clica no botão' nao volta; 'Só quando o pop-up terminar' volta", async () => {
  const noClique = await publicar(popup({ popup: { frequency: { ...SEM_RITMO_NEVER, stopOn: "click" } }, title: "Para no clique" }));
  const ateTerminar = await publicar(popup({ popup: { frequency: SEM_RITMO_NEVER }, title: "Só quando terminar" }));

  for (const publicado of [noClique, ateTerminar]) {
    assert.equal((await mostrar(aluna, publicado.id, "home")).status, 200);
    assert.equal((await evento(aluna, publicado.id, { event: "clicked" })).status, 200);
  }

  await passaram(aluna.id, 6 * SEGUNDO);
  assert.deepEqual((await mostrar(aluna, noClique.id, "home")).body, { error: "Pop-up fora da vez.", nextAt: null, reason: "frequency" });
  assert.equal((await mostrar(aluna, ateTerminar.id, "home")).status, 200, "o clique nunca parou este");

  const plano = await resumoDe(aluna, "home");
  assert.deepEqual(plano.plan.map((item) => item.id), [ateTerminar.id], "o parado sai do plano");
});

test("limite total 3 com um 'Lembrar depois' = 4 aberturas; o 'Volta em' de 30 minutos vale", async () => {
  const frequency = { ...SEM_RITMO_NEVER, maxTotal: 3 };
  const publicado = await publicar(popup({ popup: { frequency, snoozeMinutes: 30 }, title: "No máximo 3" }));
  const abrir = async () => (await mostrar(alunaExpirada, publicado.id, "home")).status;

  assert.equal(await abrir(), 200);
  await passaram(alunaExpirada.id, 6 * SEGUNDO);
  assert.equal(await abrir(), 200);

  const antes = Date.now();
  assert.equal((await evento(alunaExpirada, publicado.id, { event: "snoozed" })).status, 200);
  const adiada = await entrega(publicado.id, alunaExpirada.id);
  const volta = Date.parse(adiada.snoozed_until) - antes;
  assert.ok(volta >= 30 * MIN - SEGUNDO && volta < 30 * MIN + 10 * SEGUNDO, `volta em 30 minutos (${volta} ms)`);
  assert.equal(await abrir(), 409, "adiado");

  await passaram(alunaExpirada.id, 31 * MIN);
  assert.equal(await abrir(), 200, "a terceira");
  await passaram(alunaExpirada.id, 6 * SEGUNDO);
  assert.equal(await abrir(), 200, "a quarta: o 'Lembrar depois' nao gasta vez");
  await passaram(alunaExpirada.id, 6 * SEGUNDO);

  const quinta = await mostrar(alunaExpirada, publicado.id, "home");
  assert.deepEqual(quinta.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "frequency" });
  assert.equal((await entrega(publicado.id, alunaExpirada.id)).impressions, 4);
});

test("o mesmo pop-up nunca abre duas vezes em menos de 5 s, nem sem ritmo", async () => {
  const publicado = await publicar(popup({ popup: { frequency: SEM_RITMO_NEVER, pages: ["any"] }, title: "Sem ritmo" }));

  assert.equal((await mostrar(alunoSemAcesso, publicado.id, "saved")).status, 200);
  const vista = Date.parse((await entrega(publicado.id, alunoSemAcesso.id)).last_seen_at);
  const deNovo = await mostrar(alunoSemAcesso, publicado.id, "journey");
  assert.equal(deNovo.status, 409);
  assert.deepEqual(deNovo.body, { error: "Pop-up fora da vez.", nextAt: new Date(vista + 5 * SEGUNDO).toISOString(), reason: "frequency" });
});

test("gravacao atomica: um clique entre a leitura e a gravacao recusa a abertura (nada gravado); com a linha relida, grava", async () => {
  const publicado = await publicar(popup({ popup: { frequency: SEM_RITMO_NEVER }, title: "Compare-and-set" }));
  const agora = Date.now();
  const gravar = (lida) =>
    recordPopupImpression(db, {
      campaignId: publicado.id,
      dayStart: new Date(popupDayBounds(agora).start).toISOString(),
      expectedUpdatedAt: lida.updated_at,
      now: new Date(agora).toISOString(),
      userId: aluna.id
    });

  const lida = await fetchPopupDelivery(db, aluna.id, publicado.id);
  assert.match(lida.updated_at, /\.\d{6}|\+00:00$/, "o texto do PostgREST, como veio");
  assert.equal((await evento(aluna, publicado.id, { event: "clicked" })).status, 200, "o clique de outra aba");

  assert.equal(await gravar(lida), null);
  assert.equal((await entrega(publicado.id, aluna.id)).impressions, 0);

  assert.deepEqual(await gravar(await fetchPopupDelivery(db, aluna.id, publicado.id)), { day_impressions: 1, impressions: 1 });
  assert.equal((await entrega(publicado.id, aluna.id)).impressions, 1);
});

test("'Só no X': o conteudo leva close; o pop-up padrao continua o objeto da v1, sem a chave", async () => {
  const soNoX = await publicar(popup({ popup: { close: "x_only", pages: ["support"] }, title: "Só no X" }));
  const padrao = await publicar(popup({ title: "Padrão" }));

  const fechado = await mostrar(alunoSemAcesso, soNoX.id, "support");
  assert.equal(fechado.status, 200, JSON.stringify(fechado.body));
  assert.equal(fechado.body.data.popup.close, "x_only");

  const comum = await mostrar(alunoSemAcesso, padrao.id, "home");
  assert.deepEqual(comum.body.data, {
    next: null,
    popup: {
      audio: null,
      body: "A turma nova começa segunda.",
      canSnooze: true,
      cta: { href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" },
      id: padrao.id,
      image: null,
      title: "Padrão"
    }
  });
});

test("depois do 'mostrar de novo': o dia conta so o que veio depois (volta a abrir e as vezes no dia recomecam em 1)", async () => {
  await foraDaVirada();
  const frequency = { ...SEM_RITMO_NEVER, maxPerDay: 2 };
  const publicado = await publicar(popup({ popup: { frequency }, title: "Duas por dia, de novo" }));

  assert.equal((await mostrar(alunaExpirada, publicado.id, "home")).status, 200);
  await passaram(alunaExpirada.id, 6 * SEGUNDO);
  assert.equal((await mostrar(alunaExpirada, publicado.id, "home")).status, 200);
  await passaram(alunaExpirada.id, 6 * SEGUNDO);
  assert.equal((await mostrar(alunaExpirada, publicado.id, "home")).status, 409, "o dia acabou para este pop-up");

  const zerado = await reshowPopupDeliveries(db, { apply: true, campaignId: publicado.id, max: null, now: new Date() });
  assert.ok(zerado.reshown >= 1, JSON.stringify(zerado));
  assert.equal((await mostrar(alunaExpirada, publicado.id, "home")).status, 200, "volta a contar como novo");

  const linha = await entrega(publicado.id, alunaExpirada.id);
  assert.equal(linha.day_impressions, 1, "as de antes do 'mostrar de novo' nao contam no dia");
  assert.equal(linha.impressions, 3);
  assert.ok(linha.reshown_at);
});
