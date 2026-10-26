import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Design Livre do pop-up (docs/27), o caminho dos dados contra o banco LOCAL (pacote M): salvar grava a forma
// canonica sem endereco nos arquivos; o maior Livre que o zod aceita cabe no check de 32 KB; Livre invalido no
// banco nao aparece para a aluna e abre como Padrão no editor; a lista no ar e o plano levam o Livre (sem locked
// e name, titulo e texto do design, sem imagem e icone) e o Padrão e o Personalizado continuam iguais; a regra
// das duas chaves (uma aba antiga troca o Livre gravado); duplicar, publicar, aprovar, fontes em uso e auditoria.
// L4b: ate 3 "Abrir um link" (salvar, ler, o aluno recebe os 3, o maior cabe no check, o 4o botao e 400), o D9 por
// aparelho (um link so no computador e outro so no celular salvam; o Livre gravado antes com o Botao principal
// escondido no computador abre, publica e e aprovado com "Só quando o pop-up terminar") e a Forma com largura e
// altura na sequencia, no computador e no celular. L6b: o contorno das letras e o marca-texto salvos e lidos na forma
// canonica (o jsonb igual ao salvar de novo, a aluna recebe os dois), as recusas no campo (o marca-texto no estilo do
// elemento, os limites e o contorno no celular) e o maior Livre com os dois em todas as partes no check de 32 KB.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const designActions = await import("../../src/server/communications/popup-design-actions.ts");
const { emptyNoticeDraft, POPUP_NO_BUTTON_STOP_MESSAGE } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail } = await import("../../src/server/communications/queries.ts");
const { invalidateLivePopups } = await import("../../src/server/communications/cache.ts");
const custom = await import("../../src/server/communications/popup-design-model.ts");
const model = await import("../../src/server/communications/popup-free-model.ts");
const starters = await import("../../src/server/communications/popup-free-starters.ts");
const { POPUP_FREE_MESSAGES, freeErrorKey } = await import("../../src/server/communications/popup-free-schema.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");

const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ACESSO = "teste-pop-ups-livre-dados:";
const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const TODAS = { canPublish: true, canPublishLarge: true, canWrite: true };
const FONTE = { family_key: "bf_1a2b3c4d5e6f", file_path: "fonts/1a2b3c4d5e6f1a2b3c4d5e6f.woff2", format: "woff2", name: "Fonte de teste do Livre", size_bytes: 1234, style: "normal", weight: 800 };
const IMAGEM_LIVRE = readFileSync(new URL("../fixtures/popup-livre/imagem-transparente.webp", import.meta.url));
const IMAGEM_PATH = `communications/free/${randomBytes(12).toString("hex")}.webp`;

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
const IMAGEM_DO_AVISO = { alt: "", url: "http://127.0.0.1:55321/storage/v1/object/public/content-assets/communications/images/capa-de-teste.webp" };

let fonte;

async function apagarFonte() {
  unwrap(await db.from("communication_fonts").delete().eq("family_key", FONTE.family_key), "Apagando a fonte de teste");
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
}

before(async () => {
  await limpar();
  await apagarFonte();
  [fonte] = unwrap(await db.from("communication_fonts").insert({ ...FONTE, created_by: null }).select("*"), "Criando a fonte");
  // Uma imagem de verdade no caminho do Livre: salvar confere o objeto e le as medidas do cabecalho.
  unwrap(await db.storage.from("content-assets").upload(IMAGEM_PATH, IMAGEM_LIVRE, { contentType: "image/webp", upsert: true }), "Enviando a imagem de teste");
});

after(async () => {
  await limpar();
  await apagarFonte();
  unwrap(await db.storage.from("content-assets").remove([IMAGEM_PATH]), "Apagando a imagem de teste");
});

beforeEach(async () => {
  await limpar();
  unwrap(await db.from("communication_fonts").update({ deleted_at: null }).eq("id", fonte.id), "Devolvendo a fonte a biblioteca");
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${aluna.id}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: aluna.id
    }),
    "Liberando acesso de teste"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

/** O Livre de teste: titulo (com a fonte enviada, travado e com nome), texto, uma imagem solta, botao principal e links. */
function livre({ fontId = null, image = true } = {}) {
  return {
    assets: image ? [{ height: 999, id: "foto", kind: "image", path: IMAGEM_PATH, width: 999 }] : [],
    children: [
      {
        id: "titulo",
        lines: [[{ text: "Aula nova " }, { style: { paint: { color: "#E5FF1F", kind: "solid" } }, text: "no ar" }]],
        locked: true,
        name: "Título grande",
        textStyle: { size: 28, weight: 800, ...(fontId ? { font: { id: fontId, kind: "uploaded" } } : {}) },
        type: "heading"
      },
      { id: "texto", lines: [[{ text: "Assista hoje e coloque em prática." }]], type: "text" },
      ...(image ? [{ alt: "Ilustração", asset: "foto", id: "img", name: "Foto", place: { h: 48, mode: "free", w: 64, x: 300, y: 20 }, type: "image" }] : []),
      { action: { kind: "cta" }, box: { fill: [{ color: "#E50914", kind: "solid" }], padding: [12, 24, 12, 24], radius: 999 }, id: "botao", type: "button" },
      { dismiss: true, id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
}

function popup(extra = {}) {
  return { ...emptyNoticeDraft("popup"), audience: quemTemOProduto, body: "Texto do Padrão.", cta: BOTAO, image: IMAGEM_DO_AVISO, title: "Nome interno do pop-up", ...extra };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function salvar(draft, id) {
  actAs(produtor);
  return actions.saveNoticeDraft(id ? { draft, id } : { draft });
}

async function publicar(draft) {
  const salvo = ok(await salvar(draft));
  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  return salvo;
}

async function linha(id) {
  return unwrap(await db.from("campaigns").select("popup_design,kind,updated_at").eq("id", id).single(), "Lendo o aviso");
}

async function resumoDe(user, page = "home") {
  actAs(user);
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary?page=${encodeURIComponent(page)}`));
  assert.equal(response.status, 200);

  return (await response.json()).data.popups;
}

async function mostrar(user, id) {
  actAs(user);
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify({ page: "home", trigger: "page_load" }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

/* ------------------------------------------------------------------------------------------------
 * Gravar e ler
 * ---------------------------------------------------------------------------------------------- */

test("salvar e ler o Livre na forma canônica, sem endereço nos arquivos", async () => {
  const enviado = livre({ fontId: fonte.id.toUpperCase() });
  const salvo = ok(await salvar(popup({ design: null, freeDesign: enviado })));
  const gravado = (await linha(salvo.id)).popup_design;
  const esperado = model.canonicalPopupFreeDesign({
    ...enviado,
    assets: [{ height: 48, id: "foto", kind: "image", path: IMAGEM_PATH, width: 64 }]
  });

  assert.deepEqual(gravado, esperado, "forma canonica, com as medidas lidas pelo servidor");
  assert.equal(gravado.mode, "free");
  assert.deepEqual(gravado.fonts, [fonte.id]);
  assert.equal(gravado.children[3].box.fill[0].color, "#e50914");
  assert.deepEqual(gravado.children[3].box.padding, [12, 24]);
  assert.equal(JSON.stringify(gravado).includes("http"), false, "nenhum endereco no design");
  assert.equal(JSON.stringify(gravado).includes('"url"'), false);

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });

  assert.deepEqual(detalhe.draft.freeDesign, gravado);
  assert.equal(detalhe.draft.design, null);
  assert.deepEqual(detalhe.designFonts.map((face) => face.id), [fonte.id], "o relatorio e o editor recebem as fontes do Livre");

  // Design e conteudo juntos no servidor: o aviso sem botao com o botao principal no design e 400 no campo.
  const semBotao = await salvar(popup({ cta: null, design: null, freeDesign: enviado }), salvo.id);

  assert.equal(semBotao.ok, false);
  assert.deepEqual(semBotao.fieldErrors, { "draft.cta.label": [POPUP_FREE_MESSAGES.cta] });
});

/** O maior Livre que o zod aceita: formas cheias de numeros ate logo abaixo de 30.000 na estimativa. */
function maiorLivre() {
  const stops = [0, 25, 50, 75, 100].map((at) => ({ at, color: "#7c3aed99" }));
  const shape = (index) => ({
    box: {
      fill: [1, 2, 3].map((offset) => ({ extent: "closest-side", kind: "radial", shape: "circle", stops, x: index + offset, y: 50 })),
      shadows: [
        { blur: 10, color: "#000000aa", inset: true, spread: 2, x: 1, y: 2 },
        { blur: 20, color: "#000000bb", spread: 3, x: 3, y: 4 }
      ]
    },
    id: `forma${index}`,
    name: `Forma número ${index}`,
    place: { h: 100, mode: "free", rotate: 5, w: 100, x: index, y: index, z: 1 },
    type: "shape"
  });
  const build = (count, letters) => ({
    children: [
      ...Array.from({ length: count }, (_, index) => shape(index)),
      { id: "texto", lines: [[{ text: "a".repeat(Math.max(1, letters)) }]], type: "text" },
      { id: "botao", action: { kind: "cta" }, type: "button" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  });
  const size = (value) => model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(value));
  let count = 0;

  while (count < 24 && size(build(count + 1, 1)) <= 30_000) {
    count += 1;
  }

  const letters = Math.min(600, 30_000 - size(build(count, 1)) + 1);

  return build(count, letters);
}

test("o maior Livre aceito pelo zod passa no check de 32 KB do banco", async () => {
  const maior = maiorLivre();
  const estimativa = model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(maior));

  assert.ok(estimativa > 29_000 && estimativa <= 30_000, `estimativa ${estimativa}`);

  const salvo = ok(await salvar(popup({ design: null, freeDesign: maior })));

  assert.deepEqual((await linha(salvo.id)).popup_design, model.canonicalPopupFreeDesign(maior), "o banco aceitou o maior Livre");

  // Um Livre bem acima do teto, gravado direto (sem o zod): o check do banco recusa.
  const enorme = model.canonicalPopupFreeDesign({ ...maior, children: [...maior.children, ...maior.children.slice(0, 12).map((node, index) => ({ ...node, id: `extra${index}` }))] });
  const { error } = await db.from("campaigns").update({ popup_design: enorme }).eq("id", salvo.id);

  assert.match(error?.message ?? "", /campaigns_popup_design_v1/);
});

test("Livre inválido gravado direto no banco não aparece na lista no ar e abre como Padrão no editor", async () => {
  const salvo = await publicar(popup({ design: null, freeDesign: livre({ image: false }) }));

  // Antes: o Livre valido esta no ar (no mapa das paginas e no plano da aluna).
  const antes = await resumoDe(aluna);

  assert.deepEqual(antes.pages, ["home"]);
  assert.deepEqual(antes.plan.map((item) => item.id), [salvo.id]);

  const invalido = { ...(await linha(salvo.id)).popup_design, children: [{ id: "links", type: "links" }, { id: "links", type: "links" }] };
  unwrap(await db.from("campaigns").update({ popup_design: invalido }).eq("id", salvo.id), "Gravando um Livre invalido");
  invalidateLivePopups({ from: "route" });

  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));

  try {
    const depois = await resumoDe(aluna);

    assert.deepEqual(depois.pages, [], "sai da lista no ar (nenhuma pagina coberta)");
    assert.equal(depois.plan, null);
    assert.equal((await mostrar(aluna, salvo.id)).status, 404, "nao abre");
  } finally {
    console.error = original;
  }

  assert.ok(logs.some((line) => line.includes("[comunicacao] design livre invalido") && line.includes(salvo.id)), JSON.stringify(logs));
  assert.equal(logs.some((line) => line.includes("Aula nova")), false, "o log nunca leva o conteudo");

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });

  assert.equal(detalhe.draft.freeDesign, null);
  assert.equal(detalhe.draft.design, null, "abre como Padrão");
});

test("a lista no ar leva freeDesign sem locked e name, title e body do design, sem imagem e ícone, e as fontes numa consulta; Padrão e Personalizado iguais", async () => {
  const comLivre = await publicar(popup({ design: null, freeDesign: livre({ fontId: fonte.id }), icon: { color: "amber", id: "calendar" } }));
  const comPersonalizado = await publicar(popup({ design: custom.popupStarterDesign("text_only"), title: "Pop-up Personalizado" }));
  const padrao = await publicar(popup({ design: null, icon: { color: "amber", id: "calendar" }, title: "Pop-up Padrão" }));

  const doLivre = (await mostrar(aluna, comLivre.id)).body.data.popup;
  const gravado = (await linha(comLivre.id)).popup_design;

  assert.deepEqual(doLivre.freeDesign, model.freeDesignForStudent(gravado));
  assert.equal(JSON.stringify(doLivre.freeDesign).includes('"locked"'), false);
  assert.equal(JSON.stringify(doLivre.freeDesign).includes('"name"'), false);
  assert.equal(doLivre.title, "Aula nova no ar", "o titulo do design, nunca o nome interno");
  assert.equal(doLivre.body, "Assista hoje e coloque em prática.");
  assert.equal(doLivre.image, null);
  assert.equal("icon" in doLivre, false);
  assert.equal("design" in doLivre, false);
  assert.deepEqual(doLivre.cta, BOTAO);
  assert.deepEqual(doLivre.fonts.map((face) => [face.id, face.family, face.weight]), [[fonte.id, FONTE.family_key, 800]]);

  const doPersonalizado = (await mostrar(aluna, comPersonalizado.id)).body.data.popup;

  assert.deepEqual(doPersonalizado.design, (await linha(comPersonalizado.id)).popup_design);
  assert.equal("freeDesign" in doPersonalizado, false);
  assert.equal(doPersonalizado.title, "Pop-up Personalizado");
  assert.equal(doPersonalizado.image.url, IMAGEM_DO_AVISO.url);

  const doPadrao = (await mostrar(aluna, padrao.id)).body.data.popup;

  assert.deepEqual(Object.keys(doPadrao).sort(), ["audio", "body", "canSnooze", "cta", "icon", "id", "image", "title"]);
  assert.equal(doPadrao.title, "Pop-up Padrão");
  assert.equal(doPadrao.body, "Texto do Padrão.");
  assert.deepEqual(doPadrao.icon, { color: "amber", id: "calendar" });
});

test("o plano marca design free só nos Livres", async () => {
  const comLivre = await publicar(popup({ design: null, freeDesign: livre({ image: false }) }));
  const comPersonalizado = await publicar(popup({ design: custom.popupStarterDesign("text_only"), title: "Personalizado" }));
  const padrao = await publicar(popup({ design: null, title: "Padrão" }));
  const plano = (await resumoDe(aluna)).plan;
  const porId = Object.fromEntries(plano.map((item) => [item.id, item]));

  assert.equal(porId[comLivre.id].design, "free");
  assert.equal("design" in porId[comPersonalizado.id], false);
  assert.equal("design" in porId[padrao.id], false);
});

/* ------------------------------------------------------------------------------------------------
 * Regra das duas chaves
 * ---------------------------------------------------------------------------------------------- */

test("notificação nunca leva design", async () => {
  const notificacao = ok(await salvar({ ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, freeDesign: livre({ image: false }), title: "Notificação" }));

  assert.equal((await linha(notificacao.id)).popup_design, null);
  actAs(produtor);
  assert.equal("freeDesign" in (await getNoticeDetail(notificacao.id, { permissions: TODAS })).draft, false);
});

test("trocar Livre por Padrão grava nulo", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));

  ok(await salvar(popup({ design: null, freeDesign: null }), salvo.id));
  assert.equal((await linha(salvo.id)).popup_design, null, "as duas chaves nulas");

  ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) }), salvo.id));
  const soLivreNulo = popup({ freeDesign: null });
  delete soLivreNulo.design;
  ok(await salvar(soLivreNulo, salvo.id));
  assert.equal((await linha(salvo.id)).popup_design, null, "so freeDesign null");
});

test("rascunho só com design (aba antiga) troca o Livre gravado", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));
  const personalizado = custom.popupStarterDesign("text_only");

  // A aba aberta antes do Livre so manda `design` (sem a chave freeDesign).
  ok(await salvar(popup({ design: personalizado }), salvo.id));
  assert.deepEqual((await linha(salvo.id)).popup_design, personalizado, "o Personalizado troca o Livre, nunca grava por baixo");

  ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) }), salvo.id));
  ok(await salvar(popup({ design: null }), salvo.id));
  assert.equal((await linha(salvo.id)).popup_design, null, "a aba antiga no Padrão tira o Livre");
});

test("rascunho sem nenhuma chave de design mantém o gravado", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));
  const gravado = (await linha(salvo.id)).popup_design;
  const semChave = popup({ title: "Outro nome" });
  delete semChave.design;

  ok(await salvar(semChave, salvo.id));
  assert.deepEqual((await linha(salvo.id)).popup_design, gravado);
});

test("as duas chaves de design não nulas são recusadas, também depois da junção", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));
  const gravado = (await linha(salvo.id)).popup_design;
  const duas = await salvar(popup({ design: custom.popupStarterDesign("text_only"), freeDesign: livre({ image: false }) }), salvo.id);

  assert.equal(duas.ok, false);
  assert.equal(duas.status, 400);
  assert.deepEqual(duas.fieldErrors["draft.freeDesign"], [POPUP_FREE_MESSAGES.bothDesigns]);
  assert.deepEqual((await linha(salvo.id)).popup_design, gravado, "nada muda");

  // Com uma chave so (a outra ausente), a juncao zera a outra: nunca ficam as duas.
  const soPersonalizado = popup({ design: custom.popupStarterDesign("text_only") });
  ok(await salvar(soPersonalizado, salvo.id));
  assert.equal((await linha(salvo.id)).popup_design.mode, undefined);
  ok(await salvar(popup({ freeDesign: livre({ image: false }) }), salvo.id));
  assert.equal((await linha(salvo.id)).popup_design.mode, "free");
});

/* ------------------------------------------------------------------------------------------------
 * Duplicar, publicar, aprovar, fontes e auditoria
 * ---------------------------------------------------------------------------------------------- */

test("duplicar copia o Livre", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre() })));
  actAs(produtor);
  const copia = ok(await actions.duplicateNotice({ id: salvo.id }));

  assert.deepEqual((await linha(copia.id)).popup_design, (await linha(salvo.id)).popup_design);
  assert.equal((await linha(copia.id)).popup_design.mode, "free");
});

test("publicar e aprovar conferem as fontes do Livre", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ fontId: fonte.id, image: false }) })));

  unwrap(await db.from("communication_fonts").update({ deleted_at: new Date().toISOString() }).eq("id", fonte.id), "Excluindo a fonte");
  actAs(produtor);
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id });

  assert.equal(publicado.ok, false);
  assert.equal(publicado.status, 400);
  assert.deepEqual(publicado.fieldErrors, { "freeDesign.fonts": ["Esta fonte não está mais na biblioteca. Escolha outra."] });

  // Aprovar confere de novo (o pedido pode ter esperado a fonte sair da biblioteca).
  unwrap(await db.from("campaigns").update({ requested_at: new Date().toISOString(), requested_by: produtor.id, status: "pending_approval" }).eq("id", salvo.id), "Pedindo aprovacao");
  actAs(produtor);
  const aprovado = await actions.approveNotice({ id: salvo.id });

  assert.equal(aprovado.ok, false);
  assert.deepEqual(aprovado.fieldErrors, { "freeDesign.fonts": ["Esta fonte não está mais na biblioteca. Escolha outra."] });

  unwrap(await db.from("communication_fonts").update({ deleted_at: null }).eq("id", fonte.id), "Devolvendo a fonte");
  actAs(produtor);
  ok(await actions.approveNotice({ id: salvo.id }));
});

test("fonte usada só por um Livre não deixa excluir (409)", async () => {
  ok(await salvar(popup({ design: null, freeDesign: livre({ fontId: fonte.id, image: false }) })));
  actAs(produtor);
  const excluir = await designActions.deletePopupFont({ id: fonte.id });

  assert.deepEqual([excluir.status, excluir.error], [409, "Esta fonte está em uso em 1 pop-up. Troque a fonte nele antes de excluir."]);
});

test("auditoria com popup_design free", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));
  const [auditoria] = unwrap(
    await db.from("admin_audit_log").select("metadata").eq("entity_id", salvo.id).eq("action", "communication.saved").order("occurred_at", { ascending: false }).limit(1),
    "Lendo a auditoria"
  );

  assert.equal(auditoria.metadata.popup_design, "free");
  assert.equal(JSON.stringify(auditoria.metadata).includes("Aula nova"), false, "a auditoria nunca leva o conteudo do design");

  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  const [publicacao] = unwrap(
    await db.from("admin_audit_log").select("metadata").eq("entity_id", salvo.id).eq("action", "communication.published").order("occurred_at", { ascending: false }).limit(1),
    "Lendo a auditoria da publicacao"
  );

  assert.equal(publicacao?.metadata.popup_design, "free");
});

test("a imagem do Livre: medidas do servidor no lugar das do navegador e Imagem sem arquivo recusada ao salvar", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre() })));
  const asset = (await linha(salvo.id)).popup_design.assets[0];

  assert.deepEqual([asset.width, asset.height], [64, 48]);

  const semArquivo = livre();
  semArquivo.children[2] = { ...semArquivo.children[2], asset: null };
  semArquivo.assets = [];
  const recusado = await salvar(popup({ design: null, freeDesign: semArquivo }), salvo.id);

  assert.equal(recusado.ok, false);
  assert.deepEqual(recusado.fieldErrors, { "draft.freeDesign.nodes.img.asset": [POPUP_FREE_MESSAGES.imageMissing] });

  // O modelo "Em branco" aplicado a um aviso sem botao salva com o cta "Saiba mais" (o destino e escolhido depois).
  const aplicado = starters.applyFreeStarter("blank", { audio: null, cta: null });
  const comDestino = { ...aplicado.cta, href: "/minhas-compras" };
  ok(await salvar(popup({ cta: comDestino, design: null, freeDesign: aplicado.design }), salvo.id));
  assert.deepEqual((await linha(salvo.id)).popup_design, aplicado.design);
});

/* ------------------------------------------------------------------------------------------------
 * Celular (PR L3, docs/27 §9.10): devices.mobile na mesma coluna, sem migracao
 * ---------------------------------------------------------------------------------------------- */

/** O Livre de teste com valores do celular (alguns iguais ao computador, um id que nao existe). */
function livreComCelular() {
  return {
    ...livre(),
    devices: {
      mobile: {
        artboard: { padding: [16, 16, 16, 16] },
        nodes: {
          img: { place: { mode: "free", w: 48, x: 300, y: 60 } },
          nada: { hidden: true },
          texto: { hidden: true },
          titulo: { textStyle: { align: "left", size: 22 } }
        }
      }
    }
  };
}

const CELULAR_GRAVADO = {
  mobile: {
    artboard: { padding: 16 },
    nodes: { img: { place: { mode: "free", w: 48, y: 60 } }, texto: { hidden: true }, titulo: { textStyle: { size: 22 } } }
  }
};

test("Celular: salvar e ler um Livre com devices na forma canônica; o aluno recebe os valores do celular", async () => {
  const enviado = livreComCelular();
  const salvo = ok(await salvar(popup({ design: null, freeDesign: enviado })));
  const gravado = (await linha(salvo.id)).popup_design;

  assert.deepEqual(gravado.devices, CELULAR_GRAVADO, "sem o id que nao existe e sem o que e igual ao computador");
  assert.deepEqual(gravado, model.canonicalPopupFreeDesign({ ...enviado, assets: [{ height: 48, id: "foto", kind: "image", path: IMAGEM_PATH, width: 64 }] }));
  assert.equal(gravado.version, 1, "a versao continua 1");

  actAs(produtor);
  assert.deepEqual((await getNoticeDetail(salvo.id, { permissions: TODAS })).draft.freeDesign, gravado, "o editor abre com os valores do celular");

  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));

  // O plano antes do show: o pop-up e "Uma vez" e, depois de visto, sai do plano.
  assert.equal((await resumoDe(aluna)).plan.find((item) => item.id === salvo.id)?.design, "free");

  const doLivre = (await mostrar(aluna, salvo.id)).body.data.popup;

  assert.deepEqual(doLivre.freeDesign.devices, CELULAR_GRAVADO, "o aluno decide o aparelho na tela dele");
  assert.deepEqual(doLivre.freeDesign, model.freeDesignForStudent(gravado));

  // Uma posicao do celular com outro modo e recusada, com a chave pelo id (sem indice).
  const outroModo = livreComCelular();
  outroModo.devices.mobile.nodes.img = { place: { mode: "flow", width: 100 } };
  const recusado = await salvar(popup({ design: null, freeDesign: outroModo }), salvo.id);

  assert.equal(recusado.ok, false);
  assert.equal(recusado.status, 400);
  assert.deepEqual(recusado.fieldErrors["draft.freeDesign.devices.mobile.nodes.img.place.mode"], [POPUP_FREE_MESSAGES.mobilePlace]);
  assert.deepEqual((await linha(salvo.id)).popup_design, gravado, "nada muda");
});

test("Celular: um Livre sem devices continua igual byte a byte ao ler e salvar de novo", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livre({ image: false }) })));
  const texto = async () => unwrap(await db.from("campaigns").select("popup_design::text").eq("id", salvo.id).single(), "Lendo o design como texto").popup_design;
  const antes = await texto();

  assert.equal(typeof antes, "string");
  assert.equal(antes.includes('"devices"'), false);

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });

  assert.equal("devices" in detalhe.draft.freeDesign, false, "o editor nao inventa devices");
  ok(await salvar(popup({ design: null, freeDesign: detalhe.draft.freeDesign }), salvo.id));
  assert.equal(await texto(), antes, "o jsonb gravado e o mesmo");

  // Valores do celular iguais ao computador nao gravam nada.
  const eco = livre({ image: false });
  ok(await salvar(popup({ design: null, freeDesign: { ...eco, devices: { mobile: { nodes: { titulo: { textStyle: { size: 28 } } } } } } }), salvo.id));
  assert.equal(await texto(), antes, "igual ao computador: devices sai");
});

test("Celular: o maior Livre com devices que o zod aceita passa no check de 32 KB do banco", async () => {
  const stops = [0, 25, 50, 75, 100].map((at) => ({ at, color: "#7c3aed99" }));
  const build = (count) => {
    const shapes = Array.from({ length: count }, (_, index) => ({
      box: { fill: [1, 2, 3].map((offset) => ({ extent: "closest-side", kind: "radial", shape: "circle", stops, x: index + offset, y: 50 })) },
      id: `forma${index}`,
      place: { h: 100, mode: "free", w: 100, x: index, y: index },
      type: "shape"
    }));

    return {
      children: [...shapes, { action: { kind: "cta" }, id: "botao", type: "button" }, { id: "links", type: "links" }],
      devices: {
        mobile: {
          artboard: { gap: 4, minHeight: 600, padding: [8, 12, 16, 20] },
          nodes: Object.fromEntries(
            shapes.map((shape, index) => [shape.id, { box: { padding: [1, 2, 3, 4], radius: [4, 3, 2, 1] }, hidden: index % 2 === 0, place: { h: 60 + index, mode: "free", w: 61 + index, x: 2 + index, y: 3 + index } }])
          )
        }
      },
      mode: "free",
      version: 1
    };
  };
  const size = (value) => model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(value));
  let count = 1;

  while (count < 24 && size(build(count + 1)) <= 30_000) {
    count += 1;
  }

  const maior = build(count);

  assert.ok(size(maior) > 27_000 && size(maior) <= 30_000, `estimativa ${size(maior)} com ${count} formas`);

  const salvo = ok(await salvar(popup({ design: null, freeDesign: maior })));
  const gravado = (await linha(salvo.id)).popup_design;

  assert.deepEqual(gravado, model.canonicalPopupFreeDesign(maior), "o banco aceitou, sem migracao");
  assert.equal(Object.keys(gravado.devices.mobile.nodes).length, count);
});

/* ------------------------------------------------------------------------------------------------
 * L4b: ate 3 "Abrir um link", o D9 por aparelho e a Forma na sequencia (docs/27 §9.5 e §2.1)
 * ---------------------------------------------------------------------------------------------- */

const ATE_CLICAR = { everyMinutes: null, maxPerDay: 1, maxTotal: null, mode: "repeat", stopOn: "click" };

/** "Mais de uma vez" ate o aluno clicar, como o editor manda (`popup` e `repeat` juntos). */
function ateClicar(draft) {
  return { ...draft, popup: { ...draft.popup, frequency: ATE_CLICAR }, repeat: "until_action" };
}

function abrirUmLink(id, href, target = "same_tab", extra = {}) {
  return { action: { href, kind: "link", target }, id, label: `Abrir ${id}`, type: "button", ...extra };
}

/** O Livre de teste (sem imagem) com mais elementos antes dos links (o ultimo). */
function livreCom(...nodes) {
  const base = livre({ image: false });

  return { ...base, children: [...base.children.slice(0, -1), ...nodes, base.children.at(-1)] };
}

/** Os "Abrir um link" do design, na ordem. */
function linksDe(design) {
  return design.children.filter((node) => node.type === "button" && node.action.kind === "link").map((node) => [node.id, node.action.href, node.action.target]);
}

test("L4b: o Livre com o Botão principal e 3 Abrir um link é salvo e lido na forma canônica, e a aluna recebe os 3", async () => {
  const enviado = livreCom(abrirUmLink("linka", "/minhas-compras"), abrirUmLink("linkb", "https://exemplo.com/b", "new_tab"), abrirUmLink("linkc", `/conteudo/${PRODUTO}`));
  const salvo = await publicar(popup({ design: null, freeDesign: enviado }));
  const gravado = (await linha(salvo.id)).popup_design;
  const tres = [
    ["linka", "/minhas-compras", "same_tab"],
    ["linkb", "https://exemplo.com/b", "new_tab"],
    ["linkc", `/conteudo/${PRODUTO}`, "same_tab"]
  ];

  assert.deepEqual(gravado, model.canonicalPopupFreeDesign(enviado));
  assert.equal(gravado.version, 1, "sem versao nova");
  assert.deepEqual(linksDe(gravado), tres);

  actAs(produtor);
  assert.deepEqual((await getNoticeDetail(salvo.id, { permissions: TODAS })).draft.freeDesign, gravado, "o editor abre com os 3");

  const doLivre = (await mostrar(aluna, salvo.id)).body.data.popup;

  assert.deepEqual(doLivre.freeDesign, model.freeDesignForStudent(gravado));
  assert.deepEqual(linksDe(doLivre.freeDesign), tres, "a aluna recebe os 3");
  assert.deepEqual(doLivre.cta, BOTAO, "e o Botão principal continua com o botao do aviso");
});

test("L4b: o maior Livre com 3 Abrir um link passa no check de 32 KB; o 4º botão além do principal é 400 no elemento", async () => {
  const links = ["linka", "linkb", "linkc"].map((id, index) =>
    abrirUmLink(id, `https://exemplo.com/${id}/${"a".repeat(120)}`, index === 1 ? "new_tab" : "same_tab", { label: `${id} ${"b".repeat(30)}` })
  );
  const formas = maiorLivre().children.filter((node) => node.type === "shape");
  const build = (count, letters) => ({
    children: [
      ...formas.slice(0, count),
      { id: "texto", lines: [[{ text: "a".repeat(Math.max(1, letters)) }]], type: "text" },
      { action: { kind: "cta" }, id: "botao", type: "button" },
      ...links,
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  });
  const size = (value) => model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(value));
  let count = 0;

  while (count < formas.length && size(build(count + 1, 1)) <= 30_000) {
    count += 1;
  }

  const maior = build(count, Math.min(600, 30_000 - size(build(count, 1)) + 1));

  assert.ok(size(maior) > 29_000 && size(maior) <= 30_000, `estimativa ${size(maior)} com ${count} formas`);
  assert.equal(linksDe(maior).length, 3);

  const salvo = ok(await salvar(popup({ design: null, freeDesign: maior })));

  assert.deepEqual((await linha(salvo.id)).popup_design, model.canonicalPopupFreeDesign(maior), "o banco aceitou, sem migracao");

  // O teto continua: 3 botoes alem do principal, em qualquer mistura. O 4o (um Fechar depois de 3 links) e 400.
  const quatro = livreCom(
    ...links.map((node) => ({ ...node, action: { ...node.action, href: "/minhas-compras" }, label: node.id })),
    { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" }
  );
  const recusado = await salvar(popup({ design: null, freeDesign: quatro }), salvo.id);

  assert.equal(recusado.ok, false);
  assert.equal(recusado.status, 400);
  // O schema aponta o elemento pela posicao; o editor troca pela chave do id (freeErrorKeys, o campo certo no painel).
  const fechar = quatro.children.findIndex((node) => node.id === "fechar");
  assert.deepEqual(recusado.fieldErrors[`draft.freeDesign.children.${fechar}.action`], [POPUP_FREE_MESSAGES.buttons]);
  assert.equal(freeErrorKey(quatro, `freeDesign.children.${fechar}.action`), "freeDesign.nodes.fechar.action");
  assert.equal(POPUP_FREE_MESSAGES.buttons, "Use até 3 botões além do principal.");
  assert.deepEqual((await linha(salvo.id)).popup_design, model.canonicalPopupFreeDesign(maior), "nada muda");
});

test("L4b: 'Quando o aluno clica no botão' com um link só no computador e outro só no celular salva; os dois escondidos no celular é 400", async () => {
  const semPrincipal = (...nodes) => {
    const value = livreCom(...nodes);

    return { ...value, children: value.children.filter((node) => !(node.type === "button" && node.action.kind === "cta")) };
  };
  const cadaUmNoSeu = {
    ...semPrincipal(abrirUmLink("linka", "/minhas-compras"), abrirUmLink("linkb", "https://exemplo.com/b", "new_tab", { hidden: true })),
    devices: { mobile: { nodes: { linka: { hidden: true }, linkb: { hidden: false } } } }
  };
  const salvo = ok(await salvar(ateClicar(popup({ cta: null, design: null, freeDesign: cadaUmNoSeu }))));
  const gravado = (await linha(salvo.id)).popup_design;

  assert.deepEqual(gravado, model.canonicalPopupFreeDesign(cadaUmNoSeu));
  assert.deepEqual(gravado.devices, { mobile: { nodes: { linka: { hidden: true }, linkb: { hidden: false } } } });
  actAs(produtor);
  assert.deepEqual((await getNoticeDetail(salvo.id, { permissions: TODAS })).draft.popup.frequency, ATE_CLICAR);

  const nenhumNoCelular = {
    ...cadaUmNoSeu,
    children: cadaUmNoSeu.children.map((node) => (node.id === "linkb" ? { ...node, hidden: false } : node)),
    devices: { mobile: { nodes: { linka: { hidden: true }, linkb: { hidden: true } } } }
  };
  const recusado = await salvar(ateClicar(popup({ cta: null, design: null, freeDesign: nenhumNoCelular })), salvo.id);

  assert.equal(recusado.status, 400);
  assert.deepEqual(recusado.fieldErrors["draft.popup.frequency.stopOn"], [POPUP_NO_BUTTON_STOP_MESSAGE]);
  assert.deepEqual((await linha(salvo.id)).popup_design, gravado, "nada muda");
});

test("L4b (D9): o Livre gravado antes com 'Quando o aluno clica no botão' e o Botão principal escondido no computador abre, publica e é aprovado como 'Só quando o pop-up terminar', e a linha também", async () => {
  // Como o app de antes gravava: salvo com o Botao principal visivel e depois escondido no computador (o schema de
  // antes so olhava o celular). Um fica em rascunho (escondido nos dois) e o outro num pedido de aprovacao (visivel
  // so no celular, onde o aluno clicaria).
  const rascunho = ok(await salvar(ateClicar(popup({ design: null, freeDesign: livre({ image: false }), title: "Rascunho de antes" }))));
  const pedido = ok(await salvar(ateClicar(popup({ design: null, freeDesign: livre({ image: false }), title: "Pedido de antes" }))));
  const comum = livre({ image: false });
  const escondido = model.canonicalPopupFreeDesign({ ...comum, children: comum.children.map((node) => (node.id === "botao" ? { ...node, hidden: true } : node)) });
  const soNoCelular = model.canonicalPopupFreeDesign({ ...escondido, devices: { mobile: { nodes: { botao: { hidden: false } } } } });

  for (const [id, design] of [
    [rascunho.id, escondido],
    [pedido.id, soNoCelular]
  ]) {
    unwrap(await db.from("campaigns").update({ popup_design: design }).eq("id", id), "Escondendo o Botao principal no computador");
  }

  unwrap(
    await db.from("campaigns").update({ requested_at: new Date().toISOString(), requested_by: produtor.id, status: "pending_approval" }).eq("id", pedido.id),
    "Pedindo aprovacao"
  );

  // O editor abre com a regra que vale; a linha continua como foi gravada.
  actAs(produtor);
  const detalhe = await getNoticeDetail(rascunho.id, { permissions: TODAS });

  assert.deepEqual(detalhe.draft.freeDesign, escondido);
  assert.deepEqual(detalhe.draft.popup.frequency, { ...ATE_CLICAR, stopOn: "never" });
  assert.equal(unwrap(await db.from("campaigns").select("popup_stop_on").eq("id", rascunho.id).single(), "Lendo a regra gravada").popup_stop_on, "click");

  // Salvar de novo pedindo o clique recebe a regra nova, no campo (e nada e gravado).
  const comClique = await salvar(ateClicar(detalhe.draft), rascunho.id);

  assert.equal(comClique.status, 400);
  assert.deepEqual(comClique.fieldErrors["draft.popup.frequency.stopOn"], [POPUP_NO_BUTTON_STOP_MESSAGE]);

  // Publicar e Aprovar conferem o rascunho como o editor abre: nada de 400 num campo que ninguem mudou.
  actAs(produtor);
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: detalhe.updatedAt, id: rascunho.id }));

  assert.equal(publicado.situation, "active");

  actAs(produtor);
  const aprovado = ok(await actions.approveNotice({ id: pedido.id }));

  assert.equal(aprovado.situation, "active");

  // A linha passa a dizer o mesmo que o editor e o relatorio: no celular, o aluno nao para de ver o pop-up ao clicar
  // no Botao principal.
  for (const id of [rascunho.id, pedido.id]) {
    assert.equal(unwrap(await db.from("campaigns").select("popup_stop_on").eq("id", id).single(), "Lendo a regra publicada").popup_stop_on, "never", id);
  }

  actAs(produtor);
  assert.deepEqual((await getNoticeDetail(pedido.id, { permissions: TODAS })).draft.popup.frequency, { ...ATE_CLICAR, stopOn: "never" });
});

test("L4b: a Forma com largura e altura na sequência, no computador e no celular, é salva e lida igual", async () => {
  const forma = { box: { fill: [{ color: "#7c3aed", kind: "solid" }] }, id: "forma", place: { height: 80, mode: "flow", width: 200 }, shape: "rect", type: "shape" };
  const enviado = { ...livreCom(forma), devices: { mobile: { nodes: { forma: { place: { height: 60, mode: "flow", width: 120 } } } } } };
  const salvo = ok(await salvar(popup({ design: null, freeDesign: enviado })));
  const gravado = (await linha(salvo.id)).popup_design;

  assert.deepEqual(gravado, model.canonicalPopupFreeDesign(enviado));
  assert.deepEqual(gravado.children.find((node) => node.id === "forma").place, { height: 80, mode: "flow", width: 200 });
  assert.deepEqual(gravado.devices.mobile.nodes.forma, { place: { height: 60, mode: "flow", width: 120 } });

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });

  assert.deepEqual(detalhe.draft.freeDesign, gravado, "o editor abre igual");
  ok(await salvar(popup({ design: null, freeDesign: detalhe.draft.freeDesign }), salvo.id));
  assert.deepEqual((await linha(salvo.id)).popup_design, gravado, "salvar de novo nao muda nada");
});

/* ------------------------------------------------------------------------------------------------
 * L6b: contorno das letras e marca-texto (docs/27 §9.3 e §13.11.2; version 1, sem migracao)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O Livre de teste (sem imagem) com o contorno no Título inteiro e o marca-texto em partes do Título e do Texto,
 * escrito fora da forma canonica: cores em maiusculas, uma parte com o contorno igual ao do elemento, o respiro
 * [2, 6] e os cantos 4 de partida escritos, duas vizinhas com o mesmo marca-texto e o respiro [4, 4].
 */
function livreComContornoEMarcaTexto() {
  const base = livre({ image: false });
  const escuro = { color: "#111111", kind: "solid" };

  return {
    ...base,
    children: base.children.map((node) => {
      if (node.id === "titulo") {
        return {
          ...node,
          lines: [
            [
              { text: "Aula " },
              { style: { stroke: { color: "#FFFFFF", width: 2 } }, text: "nova " },
              { style: { mark: { color: "#E5FF1F", padding: [2, 6], radius: 4 }, paint: escuro }, text: "no" },
              { style: { mark: { color: "#e5ff1f" }, paint: escuro }, text: " ar" }
            ]
          ],
          textStyle: { ...node.textStyle, stroke: { color: "#FFFFFF", width: 2 } }
        };
      }

      if (node.id === "texto") {
        return {
          ...node,
          lines: [[{ text: "Assista " }, { style: { mark: { color: "#FFFFFF26", padding: [4, 4], radius: 2 }, stroke: { color: "#000000", width: 1 } }, text: "hoje" }, { text: " e coloque em prática." }]]
        };
      }

      return node;
    })
  };
}

/** Os elementos do design pelo id. */
function porId(design) {
  return Object.fromEntries(design.children.map((node) => [node.id, node]));
}

test("L6b: o contorno e o marca-texto são salvos e lidos na forma canônica; salvar de novo não muda o jsonb e a aluna recebe os dois", async () => {
  const enviado = livreComContornoEMarcaTexto();
  const salvo = ok(await salvar(popup({ design: null, freeDesign: enviado })));
  const gravado = (await linha(salvo.id)).popup_design;
  const { texto, titulo } = porId(gravado);

  assert.deepEqual(gravado, model.canonicalPopupFreeDesign(enviado));
  assert.equal(gravado.version, 1, "sem versao nova");
  assert.equal("devices" in gravado, false, "nada no celular");
  // O tamanho e o peso do Titulo de teste sao os padroes e saem; o contorno do elemento fica, em minusculas.
  assert.deepEqual(titulo.textStyle, { stroke: { color: "#ffffff", width: 2 } });
  // A parte com o contorno igual ao do elemento perde o estilo e junta com a vizinha; o respiro [2, 6] e os cantos 4
  // de partida saem; as duas partes com o mesmo marca-texto viram uma.
  assert.deepEqual(titulo.lines, [[{ text: "Aula nova " }, { style: { mark: { color: "#e5ff1f" }, paint: { color: "#111111", kind: "solid" } }, text: "no ar" }]]);
  // O respiro [4, 4] vira 4; o contorno da parte fica (o Texto nao tem contorno).
  assert.deepEqual(texto.lines, [
    [{ text: "Assista " }, { style: { mark: { color: "#ffffff26", padding: 4, radius: 2 }, stroke: { color: "#000000", width: 1 } }, text: "hoje" }, { text: " e coloque em prática." }]
  ]);

  const comoTexto = async () => unwrap(await db.from("campaigns").select("popup_design::text").eq("id", salvo.id).single(), "Lendo o design como texto").popup_design;
  const antes = await comoTexto();

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });

  assert.deepEqual(detalhe.draft.freeDesign, gravado, "o editor abre com o contorno e o marca-texto");

  const deNovo = ok(await salvar(popup({ design: null, freeDesign: detalhe.draft.freeDesign }), salvo.id));

  assert.equal(await comoTexto(), antes, "salvar de novo o que o editor leu nao muda o jsonb");

  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: deNovo.updatedAt, id: salvo.id }));

  const doLivre = (await mostrar(aluna, salvo.id)).body.data.popup;
  const doAluno = porId(doLivre.freeDesign);

  assert.deepEqual(doLivre.freeDesign, model.freeDesignForStudent(gravado));
  assert.deepEqual(doAluno.titulo.textStyle, titulo.textStyle, "a aluna recebe o contorno do Titulo");
  assert.deepEqual(doAluno.titulo.lines, titulo.lines, "e o marca-texto das partes");
  assert.deepEqual(doAluno.texto.lines, texto.lines);
});

test("L6b: o marca-texto no estilo do elemento, um respiro ou uma espessura fora do limite e o contorno no celular são 400 no campo, e nada é gravado", async () => {
  const salvo = ok(await salvar(popup({ design: null, freeDesign: livreComContornoEMarcaTexto() })));
  const gravado = (await linha(salvo.id)).popup_design;
  const noTitulo = (troca) => {
    const value = livreComContornoEMarcaTexto();

    return { ...value, children: value.children.map((node) => (node.id === "titulo" ? troca(node) : node)) };
  };
  const casos = [
    // O marca-texto so existe na parte: no estilo do elemento, a chave nao existe.
    [noTitulo((node) => ({ ...node, textStyle: { ...node.textStyle, mark: { color: "#e5ff1f" } } })), "freeDesign.children.0.textStyle", POPUP_FREE_MESSAGES.design, "freeDesign.nodes.titulo.textStyle"],
    [
      noTitulo((node) => ({ ...node, lines: [node.lines[0].map((span, index) => (index === 2 ? { ...span, style: { ...span.style, mark: { color: "#e5ff1f", padding: [2, 25] } } } : span))] })),
      "freeDesign.children.0.lines.0.2.style.mark.padding.1",
      "Use de 0 a 24.",
      "freeDesign.nodes.titulo.lines.0.2.style.mark.padding.1"
    ],
    [noTitulo((node) => ({ ...node, textStyle: { ...node.textStyle, stroke: { color: "#ffffff", width: 9 } } })), "freeDesign.children.0.textStyle.stroke.width", "Use de 1 a 8.", "freeDesign.nodes.titulo.textStyle.stroke.width"],
    // Cor e pintura nunca por aparelho (L27): o contorno nao tem versao do celular.
    [
      { ...livreComContornoEMarcaTexto(), devices: { mobile: { nodes: { titulo: { textStyle: { stroke: { color: "#000000", width: 1 } } } } } } },
      "freeDesign.devices.mobile.nodes.titulo.textStyle",
      POPUP_FREE_MESSAGES.design,
      "freeDesign.devices.mobile.nodes.titulo.textStyle"
    ]
  ];

  for (const [freeDesign, campo, frase, doEditor] of casos) {
    const recusado = await salvar(popup({ design: null, freeDesign }), salvo.id);

    assert.equal(recusado.ok, false, campo);
    assert.equal(recusado.status, 400, campo);
    assert.deepEqual(recusado.fieldErrors[`draft.${campo}`], [frase], campo);
    // O editor troca a posicao pela chave do id e chega ate o campo (docs/27 §9.7).
    assert.equal(freeErrorKey(freeDesign, campo), doEditor);
  }

  assert.deepEqual((await linha(salvo.id)).popup_design, gravado, "nada muda");
});

test("L6b: o maior Livre com contorno e marca-texto em todas as partes passa no check de 32 KB do banco", async () => {
  // Estilos alternados, para as vizinhas nunca juntarem: cada parte guarda o marca-texto inteiro e o contorno.
  const estilos = [
    { mark: { color: "#e5ff1f80", padding: [3, 7], radius: 5 }, paint: { color: "#111111", kind: "solid" }, stroke: { color: "#ffffff", width: 2 } },
    { mark: { color: "#7c3aed80", padding: [4, 8], radius: 6 }, paint: { color: "#fafafa", kind: "solid" }, stroke: { color: "#000000", width: 3 } }
  ];
  /** As partes em Textos de ate 12 linhas de 6 partes (os limites do Texto), cada um com o contorno do elemento. */
  const textos = (count) => {
    const partes = Array.from({ length: count }, (_, index) => ({ style: estilos[index % 2], text: "ab" }));
    const nodes = [];

    for (let start = 0; start < partes.length; start += 72) {
      const daqui = partes.slice(start, start + 72);
      const lines = Array.from({ length: Math.ceil(daqui.length / 6) }, (_, line) => daqui.slice(line * 6, line * 6 + 6));

      nodes.push({ id: `texto${nodes.length}`, lines, textStyle: { stroke: { color: "#ffffff", width: 1 } }, type: "text" });
    }

    return nodes;
  };
  const build = (count, letters) => ({
    children: [
      ...textos(count),
      { id: "resto", lines: [[{ text: "a".repeat(Math.max(1, letters)) }]], type: "text" },
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  });
  const size = (value) => model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(value));
  let count = 1;

  while (count < 300 && size(build(count + 1, 1)) <= 30_000) {
    count += 1;
  }

  const maior = build(count, Math.min(600, 30_000 - size(build(count, 1)) + 1));
  const partes = model.canonicalPopupFreeDesign(maior).children.flatMap((node) => (node.type === "text" && node.id !== "resto" ? node.lines.flat() : []));

  assert.ok(size(maior) > 29_000 && size(maior) <= 30_000, `estimativa ${size(maior)} com ${count} partes`);
  assert.equal(partes.length, count, "nenhuma parte juntou");
  assert.ok(
    partes.every((parte) => parte.style?.mark && parte.style.stroke),
    "toda parte guarda o marca-texto e o contorno"
  );

  const salvo = ok(await salvar(popup({ design: null, freeDesign: maior })));

  assert.deepEqual((await linha(salvo.id)).popup_design, model.canonicalPopupFreeDesign(maior), "o banco aceitou, sem migracao");
});
