import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Comunicacao v3b-1 "Pop-ups: frequencia, paginas e como fechar", o lado da equipe (docs/25 §2 e §5.4), contra o
// banco LOCAL: salvar e ler de volta toda a configuracao (onde, quando, quantas vezes, "Volta em", como fecha),
// o rascunho da v1 que so traz o `repeat`, a notificacao que nunca guarda configuracao de pop-up, a recusa de
// "Quando o aluno clica no botão" sem botao, o limite de 50 pop-ups publicados (publicar, aprovar e retomar),
// "Mostrar de novo para quem já viu" em "Mais de uma vez" (menu e editor; quem clicou conta so quando o pop-up
// so para ao terminar), Duplicar com tudo, os nomes de "Detalhes", os produtos que abrem direto na aula e a
// segunda linha da lista. A regra dos 500 em "Mais de uma vez" esta em avisos-crud.test.mjs (os 501 alunos de
// la). Quem recebe: os tres alunos de teste, com um acesso a um curso de teste que este arquivo libera.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, listNotices, loadNoticeEditorOptions } = await import("../../src/server/communications/queries.ts");
const { countPublishedPopups } = await import("../../src/server/communications/store.ts");
const { popupDayBounds } = await import("../../src/server/communications/popup-display-model.ts");
const { popupSettingsLines } = await import("../../src/server/communications/popup-sentences.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const { curso, cursoBloqueado } = ESCOLA_DE_TESTE;
const PRODUTO = cursoBloqueado.id;
const ACESSO = "teste-pop-ups-editor-v3b1:";
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
const alunaExpirada = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const TODAS = { canPublish: true, canPublishLarge: true, canWrite: true };
const REDATORA = { email: "redatora.pop-ups-v3b1@bunker707.test", nome: "Redatora de Pop-ups", permissions: { actions: ["messaging.write"] }, role: "custom" };
// Produtos temporarios: um abre direto na primeira aula (coursePresentationMode lesson_playlist), o outro nos modulos.
const ABRE_NA_AULA = "teste-curso-abre-na-aula-v3b1";
const ABRE_NOS_MODULOS = "teste-curso-abre-nos-modulos-v3b1";

const SEM_BOTAO = "Este pop-up não tem botão: escolha quando ele para de aparecer.";
const CHEIO_PUBLICAR = "Já há 50 pop-ups no ar ou agendados. Encerre um antes de publicar outro.";
const CHEIO_RETOMAR = "Já há 50 pop-ups no ar ou agendados. Encerre um antes de retomar este.";

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BASE = emptyNoticeDraft("popup");
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
const ATE_CLICAR = { everyMinutes: null, maxPerDay: 1, maxTotal: null, mode: "repeat", stopOn: "click" };
const ATE_TERMINAR = { everyMinutes: null, maxPerDay: 1, maxTotal: null, mode: "repeat", stopOn: "never" };
/** Toda a configuracao fora do padrao (as listas fora de ordem e repetidas: o servidor grava a forma canonica). */
const TUDO = {
  close: "x_only",
  delaySeconds: 10,
  exclude: ["support", "profile", "support"],
  frequency: { everyMinutes: 120, maxPerDay: 3, maxTotal: 10, mode: "repeat", stopOn: "click" },
  pages: ["any"],
  snoozeMinutes: 30,
  trigger: "page_load"
};
const TUDO_CANONICO = { ...TUDO, exclude: ["profile", "support"] };

let redatora;

async function criarEquipe(pessoa) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === pessoa.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: pessoa.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: pessoa.nome } }),
      `Criando ${pessoa.nome}`
    ).user;
  }

  unwrap(await db.from("admin_roles").upsert({ permissions: pessoa.permissions, role: pessoa.role, user_id: user.id }, { onConflict: "user_id" }), "Dando a funcao");

  return usuarioDeTeste({ email: pessoa.email, id: user.id, nome: pessoa.nome });
}

async function liberar(userId) {
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${userId}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: userId
    }),
    "Liberando acesso de teste"
  );
}

function itemDoCatalogo(id) {
  return {
    access_label: null,
    access_model: "closed",
    bucket: "courses",
    commerce_scope: "sellable_product",
    description: "Item ficticio dos testes do editor de pop-up.",
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
    purchase_url: "https://exemplo.test/comprar/pop-ups-editor",
    sort_order: 91,
    status: "Bloqueado",
    title: `Teste do editor de pop-up: ${id}`
  };
}

async function apagarProdutosTemporarios() {
  unwrap(await db.from("content_items").delete().in("id", [ABRE_NA_AULA, ABRE_NOS_MODULOS]), "Apagando os produtos temporarios");
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
}

before(async () => {
  await limpar();
  await apagarProdutosTemporarios();
  redatora = await criarEquipe(REDATORA);
});

after(async () => {
  await limpar();
  await apagarProdutosTemporarios();
  await apagarContaDeTeste(db, REDATORA.email);
});

beforeEach(async () => {
  await limpar();
  await liberar(aluna.id);
  await liberar(aluno.id);
  await liberar(alunaExpirada.id);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

/** Rascunho de pop-up como o editor manda: `popup` e `repeat` sempre juntos (popupFrequencyPatch). */
function popup({ popup: settings = {}, ...extra } = {}) {
  const frequency = settings.frequency ?? { mode: "once" };

  return {
    ...BASE,
    audience: quemTemOProduto,
    body: "A turma nova começa segunda.",
    cta: BOTAO,
    title: "Turma nova",
    ...extra,
    popup: { ...BASE.popup, ...settings, frequency },
    repeat: frequency.mode === "once" ? "once" : "until_action"
  };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function salvar(draft, user = produtor) {
  actAs(user);
  return ok(await actions.saveNoticeDraft({ draft }));
}

async function publicar(draft, user = produtor) {
  const salvo = await salvar(draft, user);
  return ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
}

async function detalheDe(id) {
  actAs(produtor);
  return getNoticeDetail(id, { permissions: TODAS });
}

async function popupDe(user) {
  actAs(user);
  const response = await summaryRoute.GET(new Request("http://localhost/api/notifications/summary?popup=1"));
  assert.equal(response.status, 200);

  return (await response.json()).data.popup;
}

async function aviso(id) {
  return unwrap(await db.from("campaigns").select("*").eq("id", id).single(), "Lendo o aviso");
}

/** As doze colunas de "onde, quando, quantas vezes, Volta em e como fecha" da linha. */
function colunasDoPopup(linha) {
  return {
    popup_close: linha.popup_close,
    popup_delay_seconds: linha.popup_delay_seconds,
    popup_every_minutes: linha.popup_every_minutes,
    popup_exclude_pages: linha.popup_exclude_pages,
    popup_frequency: linha.popup_frequency,
    popup_max_per_day: linha.popup_max_per_day,
    popup_max_total: linha.popup_max_total,
    popup_pages: linha.popup_pages,
    popup_repeat: linha.popup_repeat,
    popup_snooze_minutes: linha.popup_snooze_minutes,
    popup_stop_on: linha.popup_stop_on,
    popup_trigger: linha.popup_trigger
  };
}

const COLUNAS_PADRAO = {
  popup_close: "any",
  popup_delay_seconds: 3,
  popup_every_minutes: null,
  popup_exclude_pages: [],
  popup_frequency: null,
  popup_max_per_day: null,
  popup_max_total: null,
  popup_pages: ["home"],
  popup_repeat: "once",
  popup_snooze_minutes: 1440,
  popup_stop_on: null,
  popup_trigger: "page_load"
};

async function entrega(campaignId, userId) {
  const [linha] = unwrap(
    await db
      .from("campaign_deliveries")
      .select("impressions,impressions_before_reshow,reshown_at,clicked_at,dismissed_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Lendo o pop-up do aluno"
  );

  return linha ?? null;
}

async function mudarEntrega(campaignId, userId, patch) {
  unwrap(await db.from("campaign_deliveries").update(patch).eq("campaign_id", campaignId).eq("user_id", userId), "Mudando o pop-up do aluno");
}

/**
 * A aluna viu hoje (ha 2 minutos, nunca antes da meia-noite de Sao Paulo) e clicou; o aluno viu e so fechou; a
 * outra nunca viu.
 */
async function viramHoje(campaignId) {
  const antes = new Date(Math.max(Date.now() - 2 * MIN, popupDayBounds(Date.now()).start)).toISOString();

  await mudarEntrega(campaignId, aluna.id, { clicked_at: antes, first_seen_at: antes, impressions: 1, last_seen_at: antes });
  await mudarEntrega(campaignId, aluno.id, { first_seen_at: antes, impressions: 1, last_seen_at: antes });
}

async function auditoria(entityId, action) {
  return unwrap(await db.from("admin_audit_log").select("metadata,count").eq("entity_id", entityId).eq("action", action).order("occurred_at"), "Lendo a auditoria");
}

/** Pop-ups publicados direto no banco (no ar, sem ninguem para ver), para chegar ao limite de 50. */
async function popupsNoAr(quantos, extra = {}) {
  const linhas = Array.from({ length: quantos }, (_, index) => ({
    created_by: produtor.id,
    kind: "popup",
    status: "active",
    title: `Pop-up no ar ${index + 1}`,
    updated_by: produtor.id,
    ...extra
  }));

  return unwrap(await db.from("campaigns").insert(linhas).select("id"), "Publicando pop-ups no banco").map((linha) => linha.id);
}

/* ------------------------------------------------------------------------------------------------
 * Salvar e ler de volta (docs/25 §2.3–§2.5 e §5.4)
 * ---------------------------------------------------------------------------------------------- */

test("salvar um pop-up com toda a configuracao grava as colunas na forma canonica, le de volta igual e a auditoria leva o momento, as paginas e o modo", async () => {
  const salvo = await salvar(popup({ popup: TUDO, title: "Tudo configurado" }));

  assert.deepEqual(colunasDoPopup(await aviso(salvo.id)), {
    popup_close: "x_only",
    popup_delay_seconds: 10,
    popup_every_minutes: 120,
    popup_exclude_pages: ["profile", "support"],
    popup_frequency: "repeat",
    popup_max_per_day: 3,
    popup_max_total: 10,
    popup_pages: ["any"],
    popup_repeat: "until_action",
    popup_snooze_minutes: 30,
    popup_stop_on: "click",
    popup_trigger: "page_load"
  });

  const detalhe = await detalheDe(salvo.id);
  assert.deepEqual(detalhe.draft.popup, TUDO_CANONICO);
  assert.equal(detalhe.draft.repeat, "until_action");

  const [registro] = await auditoria(salvo.id, "communication.saved");
  assert.equal(registro.metadata.popup_frequency, "repeat");
  assert.equal(registro.metadata.popup_pages, 1);
  assert.equal(registro.metadata.popup_trigger, "page_load");

  // Ao concluir uma aula, so paginas de aula (a excecao tambem e de aula).
  const aoConcluir = await salvar(
    popup({ popup: { delaySeconds: 0, exclude: [`lesson:${curso.id}`], pages: ["lesson:*"], trigger: "lesson_completed" }, title: "Ao concluir" })
  );
  const linha = await aviso(aoConcluir.id);
  assert.deepEqual([linha.popup_trigger, linha.popup_pages, linha.popup_exclude_pages, linha.popup_delay_seconds], ["lesson_completed", ["lesson:*"], [`lesson:${curso.id}`], 0]);
  assert.deepEqual([linha.popup_frequency, linha.popup_repeat], ["once", "once"]);

  // Publicar: a auditoria tambem leva a configuracao.
  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  const [publicado] = await auditoria(salvo.id, "communication.published");
  assert.deepEqual([publicado.metadata.popup_frequency, publicado.metadata.popup_pages, publicado.metadata.popup_trigger], ["repeat", 1, "page_load"]);
});

test("rascunho da v1 so com o `repeat`: '{ ...detalhe.draft, repeat: \"until_action\" }' numa linha de antes vira Mais de uma vez, 1 dia, ate clicar", async () => {
  const salvo = await salvar(popup({ title: "Pop-up de antes" }));
  // Como uma linha gravada antes da migracao 202610220003 (ou pelo app da v3a): sem "Quantas vezes" proprio.
  unwrap(await db.from("campaigns").update({ popup_frequency: null }).eq("id", salvo.id), "Voltando a linha para antes da v3b-1");

  const detalhe = await detalheDe(salvo.id);
  assert.deepEqual(detalhe.draft.popup.frequency, { mode: "once" });
  actAs(produtor);
  ok(await actions.saveNoticeDraft({ draft: { ...detalhe.draft, repeat: "until_action" }, expectedUpdatedAt: detalhe.updatedAt, id: salvo.id }));

  const linha = await aviso(salvo.id);
  assert.deepEqual(
    [linha.popup_frequency, linha.popup_repeat, linha.popup_every_minutes, linha.popup_max_per_day, linha.popup_max_total, linha.popup_stop_on],
    ["repeat", "until_action", 1440, null, null, "click"]
  );

  // E de volta para "Uma vez" so pelo `repeat`.
  const lido = await detalheDe(salvo.id);
  actAs(produtor);
  ok(await actions.saveNoticeDraft({ draft: { ...lido.draft, repeat: "once" }, expectedUpdatedAt: lido.updatedAt, id: salvo.id }));
  assert.deepEqual(colunasDoPopup(await aviso(salvo.id)), { ...COLUNAS_PADRAO, popup_frequency: "once" });
});

test("'Até o aluno clicar' de antes num pop-up sem botao: abre, publica e salva como 'Só quando o pop-up terminar' (o mesmo para o aluno)", async () => {
  const salvo = await salvar(popup({ cta: null, title: "Sem botão, de antes" }));
  unwrap(
    await db.from("campaigns").update({ popup_frequency: null, popup_repeat: "until_action" }).eq("id", salvo.id),
    "Voltando a linha para o 'Até o aluno clicar' de antes"
  );

  const detalhe = await detalheDe(salvo.id);
  assert.deepEqual(detalhe.draft.popup.frequency, { everyMinutes: 1440, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "never" });

  actAs(produtor);
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: detalhe.updatedAt, id: salvo.id }));
  assert.equal(publicado.situation, "active", "publicar nao recusa um campo que ninguem escolheu");

  const noAr = await detalheDe(salvo.id);
  actAs(produtor);
  ok(await actions.saveNoticeDraft({ draft: { ...noAr.draft, title: "Sem botão (editado)" }, expectedUpdatedAt: noAr.updatedAt, id: salvo.id }));
  const linha = await aviso(salvo.id);
  assert.deepEqual([linha.popup_frequency, linha.popup_every_minutes, linha.popup_stop_on], ["repeat", 1440, "never"], "a linha migra ao ser editada");

  // O rascunho da v1 sem botao e sem `popup` tambem nao para "no clique".
  const v1 = await salvar({ ...emptyNoticeDraft("popup"), audience: quemTemOProduto, cta: null, popup: undefined, repeat: "until_action", title: "Rascunho da v1" });
  const linhaV1 = await aviso(v1.id);
  assert.deepEqual([linhaV1.popup_frequency, linhaV1.popup_repeat, linhaV1.popup_every_minutes, linhaV1.popup_stop_on], ["repeat", "until_action", 1440, "never"]);
});

test("notificacao nunca guarda configuracao de pop-up: enviada com `popup`, grava os padroes e o rascunho lido nao tem a chave", async () => {
  actAs(produtor);
  const salvo = ok(
    await actions.saveNoticeDraft({ draft: { ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, body: "Traga suas dúvidas.", popup: TUDO, title: "Live de quinta" } })
  );
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  assert.equal(publicado.situation, "sent");

  assert.deepEqual(colunasDoPopup(await aviso(salvo.id)), COLUNAS_PADRAO);
  const detalhe = await detalheDe(salvo.id);
  assert.equal("popup" in detalhe.draft, false);
  assert.equal(detalhe.popupMode, null);
  assert.equal(detalhe.placementLabel, null);
  assert.deepEqual(detalhe.popupNames, {});
});

test("'Quando o aluno clica no botão' sem botao: 400 no campo ao salvar e tambem ao tirar o botao de um pop-up no ar; 'Só quando o pop-up terminar' passa", async () => {
  actAs(produtor);
  const novo = await actions.saveNoticeDraft({ draft: popup({ cta: null, popup: { frequency: ATE_CLICAR }, title: "Sem botão" }) });
  assert.equal(novo.status, 400);
  assert.deepEqual(novo.fieldErrors?.["draft.popup.frequency.stopOn"], [SEM_BOTAO]);

  ok(await actions.saveNoticeDraft({ draft: popup({ cta: null, popup: { frequency: ATE_TERMINAR }, title: "Sem botão, até terminar" }) }));

  const noAr = await publicar(popup({ popup: { frequency: ATE_CLICAR }, title: "Com botão" }));
  const detalhe = await detalheDe(noAr.id);
  actAs(produtor);
  const semBotao = await actions.saveNoticeDraft({ draft: { ...detalhe.draft, cta: null }, expectedUpdatedAt: detalhe.updatedAt, id: noAr.id });
  assert.equal(semBotao.status, 400);
  assert.deepEqual(semBotao.fieldErrors?.["draft.popup.frequency.stopOn"], [SEM_BOTAO]);
  assert.equal((await aviso(noAr.id)).cta_href, BOTAO.href, "nada gravado");
});

/* ------------------------------------------------------------------------------------------------
 * No maximo 50 pop-ups publicados (docs/25 D13)
 * ---------------------------------------------------------------------------------------------- */

test("50 pop-ups publicados (no ar ou agendados): publicar, aprovar e retomar o 51o e 422; pausado e terminado nao contam; com um a menos, passa", async () => {
  // Antes de encher: um pedido de aprovacao (quem so cria) e um pop-up pausado.
  const pedido = await publicar(popup({ title: "Pedido de aprovação" }), redatora);
  assert.equal(pedido.situation, "pending_approval");
  const pausado = await publicar(popup({ title: "Pausado" }));
  actAs(produtor);
  ok(await actions.pauseNotice({ id: pausado.id }));
  const rascunho = await salvar(popup({ title: "O 51º" }));

  const nowIso = new Date().toISOString();
  const antes = await countPublishedPopups(db, { nowIso });
  assert.ok(antes < 49, `pop-ups publicados de fora dos testes: ${antes}`);
  const noAr = await popupsNoAr(49 - antes);
  // Um agendado (janela futura) conta; um com a janela ja terminada nao.
  await popupsNoAr(1, { starts_at: new Date(Date.now() + DIA).toISOString() });
  await popupsNoAr(1, { ends_at: new Date(Date.now() - DIA).toISOString(), starts_at: new Date(Date.now() - 2 * DIA).toISOString() });
  assert.equal(await countPublishedPopups(db, { nowIso: new Date().toISOString() }), 50);

  actAs(produtor);
  const publicar51 = await actions.publishNotice({ expectedUpdatedAt: rascunho.updatedAt, id: rascunho.id });
  assert.equal(publicar51.status, 422);
  assert.equal(publicar51.error, CHEIO_PUBLICAR);
  assert.equal((await aviso(rascunho.id)).status, "draft");

  const aprovar51 = await actions.approveNotice({ id: pedido.id });
  assert.equal(aprovar51.status, 422);
  assert.equal(aprovar51.error, CHEIO_PUBLICAR);
  assert.equal((await aviso(pedido.id)).status, "pending_approval");

  const retomar51 = await actions.resumeNotice({ id: pausado.id });
  assert.equal(retomar51.status, 422);
  assert.equal(retomar51.error, CHEIO_RETOMAR);
  assert.equal((await aviso(pausado.id)).status, "paused");

  // Pedir aprovacao tambem confere (o pedido nao ficaria esperando sem caber).
  const outroPedido = await salvar(popup({ title: "Outro pedido" }), redatora);
  actAs(redatora);
  const pedir51 = await actions.publishNotice({ expectedUpdatedAt: outroPedido.updatedAt, id: outroPedido.id });
  assert.equal(pedir51.status, 422);
  assert.equal(pedir51.error, CHEIO_PUBLICAR);

  // Com um a menos, aprovar passa (e o limite volta a valer para o proximo).
  unwrap(await db.from("campaigns").delete().eq("id", noAr[0]), "Tirando um pop-up do ar");
  actAs(produtor);
  assert.equal(ok(await actions.approveNotice({ id: pedido.id })).situation, "active");
  assert.equal((await actions.resumeNotice({ id: pausado.id })).status, 422);
});

/* ------------------------------------------------------------------------------------------------
 * "Mostrar de novo para quem já viu" em qualquer "Quantas vezes" (docs/25 §4.7)
 * ---------------------------------------------------------------------------------------------- */

test("mostrar de novo pelo menu em 'Mais de uma vez · Só quando o pop-up terminar': quem clicou conta e volta a ver; a auditoria conta", async () => {
  const publicado = await publicar(popup({ popup: { frequency: ATE_TERMINAR }, title: "Até terminar" }));
  await viramHoje(publicado.id);
  assert.equal(await popupDe(aluna), null, "1 por dia: a aluna ja viu hoje");

  const detalhe = await detalheDe(publicado.id);
  assert.ok(detalhe.actions.includes("reshow"), "a opcao no menu em 'Mais de uma vez'");
  assert.equal(detalhe.reshowable, 2, "a aluna (clicou) e o aluno (fechou)");
  assert.equal(detalhe.popupMode, "repeat");

  actAs(produtor);
  const mostrado = ok(await actions.reshowPopup({ expectedUpdatedAt: detalhe.updatedAt, id: publicado.id }));
  assert.deepEqual(mostrado, { reshown: 2, updatedAt: detalhe.updatedAt });

  const linha = await entrega(publicado.id, aluna.id);
  assert.equal(linha.impressions_before_reshow, 1);
  assert.ok(linha.reshown_at && linha.clicked_at, "o clique fica; a contagem recomeca");
  assert.equal((await entrega(publicado.id, alunaExpirada.id)).reshown_at, null, "quem nunca viu nao muda");
  assert.equal((await popupDe(aluna))?.id, publicado.id, "a aluna ve de novo no mesmo dia");

  const [registro] = await auditoria(publicado.id, "communication.popup_reshown");
  assert.deepEqual(registro.metadata, { count: 2, via: "menu" });
  assert.equal(registro.count, 2);
});

test("mostrar de novo pelo menu em 'Mais de uma vez · Quando o aluno clica no botão': quem clicou fica de fora", async () => {
  const publicado = await publicar(popup({ popup: { frequency: ATE_CLICAR }, title: "Até clicar" }));
  await viramHoje(publicado.id);

  const detalhe = await detalheDe(publicado.id);
  assert.equal(detalhe.reshowable, 1, "so o aluno (fechou sem clicar)");
  actAs(produtor);
  assert.equal(ok(await actions.reshowPopup({ id: publicado.id })).reshown, 1);
  assert.equal((await entrega(publicado.id, aluna.id)).reshown_at, null, "quem clicou nao muda");
  assert.equal((await entrega(publicado.id, aluno.id)).impressions_before_reshow, 1);
  assert.equal(await popupDe(aluna), null, "quem clicou continua sem ver");
  assert.equal((await popupDe(aluno))?.id, publicado.id, "quem so fechou ve de novo no mesmo dia");
});

test("mostrar de novo pelo editor em 'Mais de uma vez', mudando o que faz parar no mesmo salvar: vale a contagem depois de gravar", async () => {
  const publicado = await publicar(popup({ popup: { frequency: ATE_CLICAR }, title: "Pelo editor" }));
  await viramHoje(publicado.id);

  const detalhe = await detalheDe(publicado.id);
  assert.equal(detalhe.reshowable, 1, "contado pela regra gravada (ate clicar)");

  actAs(produtor);
  const draft = { ...detalhe.draft, popup: { ...detalhe.draft.popup, frequency: ATE_TERMINAR }, repeat: "until_action" };
  const salvo = ok(await actions.saveNoticeDraft({ draft, expectedUpdatedAt: detalhe.updatedAt, id: publicado.id, reshow: true }));
  assert.equal(salvo.reshown, 2, "depois de gravar 'Só quando o pop-up terminar', quem clicou conta");
  assert.equal(salvo.status, "active");

  const linha = await aviso(publicado.id);
  assert.equal(linha.popup_stop_on, "never");
  assert.ok(linha.edited_at);
  assert.equal((await entrega(publicado.id, aluna.id)).impressions_before_reshow, 1);

  const [registro] = await auditoria(publicado.id, "communication.popup_reshown");
  assert.deepEqual(registro.metadata, { count: 2, via: "editor" });
});

/* ------------------------------------------------------------------------------------------------
 * Duplicar, nomes, opcoes do editor e a lista
 * ---------------------------------------------------------------------------------------------- */

test("duplicar copia toda a configuracao do pop-up", async () => {
  const salvo = await salvar(popup({ popup: TUDO, title: "Para duplicar" }));
  actAs(produtor);
  const copia = ok(await actions.duplicateNotice({ id: salvo.id }));

  const original = await aviso(salvo.id);
  const duplicado = await aviso(copia.id);
  assert.notEqual(copia.id, salvo.id);
  assert.equal(duplicado.status, "draft");
  assert.deepEqual(colunasDoPopup(duplicado), colunasDoPopup(original));
  assert.deepEqual((await detalheDe(copia.id)).draft.popup, TUDO_CANONICO);
});

test("relatorio: os nomes dos produtos citados nas paginas e excecoes vao para as frases de 'Detalhes'; sem produto, {}", async () => {
  // Um produto nas paginas e outro nas excecoes ("Qualquer aula", menos as de um curso).
  const salvo = await salvar(
    popup({ popup: { exclude: [`lesson:${cursoBloqueado.id}`], pages: [`content:${curso.id}`, "lesson:*"] }, title: "Nas páginas dos cursos" })
  );
  const detalhe = await detalheDe(salvo.id);
  assert.deepEqual(detalhe.popupNames, { [cursoBloqueado.id]: cursoBloqueado.titulo, [curso.id]: curso.titulo });

  const [onde] = popupSettingsLines(detalhe.draft.popup, detalhe.popupNames);
  assert.equal(onde.label, "Onde");
  assert.ok(onde.value.includes(curso.titulo) && onde.value.includes(cursoBloqueado.titulo), onde.value);

  const padrao = await salvar(popup({ title: "Só no Início" }));
  assert.deepEqual((await detalheDe(padrao.id)).popupNames, {});
});

test("opcoes do editor: os produtos que abrem direto na primeira aula", async () => {
  unwrap(await db.from("content_items").upsert([itemDoCatalogo(ABRE_NA_AULA), itemDoCatalogo(ABRE_NOS_MODULOS)], { onConflict: "id" }), "Criando os produtos temporarios");
  unwrap(
    await db.from("content_page_settings").upsert(
      [
        { content_id: ABRE_NA_AULA, settings: { coursePresentationMode: "lesson_playlist" } },
        { content_id: ABRE_NOS_MODULOS, settings: { coursePresentationMode: "module_cards" } }
      ],
      { onConflict: "content_id" }
    ),
    "Escolhendo como cada produto abre"
  );

  try {
    actAs(produtor);
    const opcoes = await loadNoticeEditorOptions();
    assert.ok(opcoes.opensOnLesson.includes(ABRE_NA_AULA));
    assert.ok(!opcoes.opensOnLesson.includes(ABRE_NOS_MODULOS));
    assert.deepEqual(opcoes.opensOnLesson, [...opcoes.opensOnLesson].sort(), "em ordem");
  } finally {
    await apagarProdutosTemporarios();
  }
});

test("lista: a segunda linha da coluna 'Quando' e o modo de 'Quantas vezes' de cada pop-up; nada na notificacao", async () => {
  const padrao = await salvar(popup({ title: "Pop-up padrão" }));
  const tudo = await salvar(popup({ popup: TUDO, title: "Pop-up com tudo" }));
  const aoConcluir = await salvar(popup({ popup: { pages: ["lesson:*"], trigger: "lesson_completed" }, title: "Pop-up ao concluir" }));
  const notificacao = await salvar({ ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, title: "Notificação" });

  actAs(produtor);
  const { items } = await listNotices({ page: 1, permissions: TODAS });
  const item = (id) => items.find((linha) => linha.id === id);

  assert.deepEqual([item(padrao.id).placementLabel, item(padrao.id).popupMode], [null, "once"]);
  assert.deepEqual([item(tudo.id).placementLabel, item(tudo.id).popupMode], ["Em qualquer página (com exceções)", "repeat"]);
  assert.deepEqual([item(aoConcluir.id).placementLabel, item(aoConcluir.id).popupMode], ["Ao concluir uma aula", "once"]);
  assert.deepEqual([item(notificacao.id).placementLabel, item(notificacao.id).popupMode], [null, null]);
});
