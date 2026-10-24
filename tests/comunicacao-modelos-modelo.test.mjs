import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Modelos da Comunicacao (docs/28 §3 e §7.1 S): o modulo puro src/server/communications/template-model.ts. Os
// construtores (rascunho -> payload, design -> payload) com as chaves, as datas que nunca vao (§3.6) e as notas; o
// rascunho afrouxado (D8) e o payload estrito com o teto de 768 KB medido pelo pior aviso valido (D14); a leitura
// parte por parte (parse-on-read, D15); o que o editor abre (ids novos no "Usar", os gravados no modo modelo, D28);
// a aplicacao de um modelo de Design (D3, D4); resumo, nomes, notas do dialogo, mapa de erros e o ?tipo=; o que um
// modelo segura para a limpeza (media-refs.templateMediaUse); e o remapNodeRefs que mudou para audience-model.ts.

const model = await import("../src/server/communications/template-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const freeStarters = await import("../src/server/communications/popup-free-starters.ts");
const freeModel = await import("../src/server/communications/popup-free-model.ts");
const refs = await import("../src/server/communications/media-refs.ts");
const audienceModel = await import("../src/server/communications/audience-model.ts");
const followUpsView = await import("../src/components/admin/v2/communication/follow-ups-view-model.ts");
const { POPUP_FREE_MESSAGES } = await import("../src/server/communications/popup-free-schema.ts");

const M = model.TEMPLATE_MESSAGES;
const ORIGEM = "https://abcdefgh.supabase.co";
const ENTRADA = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";
const S11 = "44444444-4444-4444-8444-444444444444";
const PESSOA = "55555555-5555-4555-8555-555555555555";
const AVISO = "66666666-6666-4666-8666-666666666666";
const FLUXO = "77777777-7777-4777-8777-777777777777";
const PRODUTO = "formacao-ia";
const VIDEO = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const HEX = "0123456789abcdef01234567";
const FORBIDDEN = /template|público|audiência|layout|lembrete/i;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const publico = (bucket, path) => `${ORIGEM}/storage/v1/object/public/${bucket}/${path}`;
const IMAGEM = { alt: "Capa", url: publico("content-assets", `communications/images/${HEX}.webp`) };
const AUDIO = { durationSeconds: 30, mimeType: "audio/mpeg", peaks: [10, 20], url: publico("communication-audio", `campaigns/${HEX}.mp3`) };
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const temProduto = (productId = PRODUTO) => ({ op: "has", productIds: [productId], type: "product" });
const TODOS = { kind: "everyone" };

function problemas(schema, value) {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const conteudoSeguinte = (extra = {}) => ({
  allowHide: true,
  audio: null,
  body: "",
  cta: null,
  icon: null,
  image: null,
  poll: null,
  reactions: true,
  response: null,
  sender: null,
  title: "Seguinte",
  validity: { mode: "default" },
  ...extra
});

const seguinte = (id, extra = {}, children = []) => ({
  children,
  content: conteudoSeguinte(extra.content),
  id,
  when: { anchor: "sent", minutes: 60 },
  who: extra.who ?? TODOS
});

/** Notificacao com tudo preenchido, inclusive as datas que nunca vao para o modelo. */
function notificacaoCompleta(extra = {}) {
  return {
    ...schemas.emptyNoticeDraft("inbox"),
    allowHide: false,
    audience: regras(temProduto()),
    audio: AUDIO,
    body: "Texto da oferta",
    cta: { display: "button", href: `/conteudo/${PRODUTO}`, label: "Ver agora", target: "same_tab" },
    icon: { color: "amber", id: "gift" },
    image: IMAGEM,
    poll: { closesAt: "2026-11-30T12:00:00.000Z", multiple: false, options: [{ id: "a", label: "Sim" }, { id: "b", label: "Não" }], question: "Vem?", showResults: true },
    reactions: true,
    schedule: { mode: "at", sendAt: "2026-11-20T12:00:00.000Z" },
    sender: { userId: PESSOA },
    title: "Oferta especial",
    validity: { endsAt: "2026-12-01T12:00:00.000Z", mode: "until" },
    ...extra
  };
}

const TUDO = { audience: true, content: true, followUps: true };
const NADA = { audience: false, content: false, followUps: false };

function popupComDesign(design, extra = {}) {
  return { ...schemas.emptyNoticeDraft("popup"), audience: regras(temProduto()), design, title: "Turma nova", ...extra };
}

/* ------------------------------------------------------------------------------------------------
 * 1 a 4: construtor do rascunho
 * ---------------------------------------------------------------------------------------------- */

test("1. notificação com tudo ligado: configuração, conteúdo, segmento e seguintes; as datas viram padrão com nota", () => {
  const followUps = {
    entryId: ENTRADA,
    goal: { productId: PRODUTO },
    items: [seguinte(S1, { content: { validity: { endsAt: "2026-12-10T12:00:00.000Z", mode: "until" } } }, [seguinte(S11)])]
  };
  const { notes, payload } = model.templatePayloadOfDraft({ draft: notificacaoCompleta(), followUps, include: TUDO });

  assert.deepEqual(payload.settings, { allowHide: false, icon: { color: "amber", id: "gift" }, sender: { userId: PESSOA }, validity: { mode: "default" } });
  assert.equal(payload.kind, "inbox");
  assert.equal(payload.version, 1);
  assert.equal(payload.content.title, "Oferta especial");
  assert.equal(payload.content.poll.closesAt, null);
  assert.deepEqual(payload.content.cta, { display: "button", href: `/conteudo/${PRODUTO}`, label: "Ver agora", target: "same_tab" });
  assert.deepEqual(payload.audience, audienceModel.normalizeAudience(regras(temProduto())));
  assert.equal(payload.followUps.entryId, ENTRADA);
  assert.deepEqual(payload.followUps.goal, { productId: PRODUTO });
  assert.deepEqual(payload.followUps.items[0].content.validity, { mode: "default" });
  assert.equal(payload.followUps.items[0].children[0].id, S11);
  assert.deepEqual(notes, [M.notePollEnd, M.noteUntil, M.noteFollowUpUntil]);
  assert.equal(model.templatePayloadSchema.safeParse(payload).success, true, "o payload passa no schema estrito");

  // Duracao fica como esta.
  const duracao = model.templatePayloadOfDraft({ draft: notificacaoCompleta({ validity: { minutes: 1_440, mode: "duration" } }), followUps: null, include: TUDO });
  assert.deepEqual(duracao.payload.settings.validity, { minutes: 1_440, mode: "duration" });
  assert.deepEqual(duracao.notes, [M.notePollEnd]);
});

test("2. as três chaves desligadas dão conteúdo, segmento e seguintes nulos; quem envia, ícone, tempo e lixeira continuam", () => {
  const { payload } = model.templatePayloadOfDraft({
    draft: notificacaoCompleta({ validity: { minutes: 60, mode: "duration" } }),
    followUps: { entryId: ENTRADA, goal: null, items: [seguinte(S1)] },
    include: NADA
  });

  assert.equal(payload.content, null);
  assert.equal(payload.audience, null);
  assert.equal(payload.followUps, null);
  assert.deepEqual(payload.settings, { allowHide: false, icon: { color: "amber", id: "gift" }, sender: { userId: PESSOA }, validity: { minutes: 60, mode: "duration" } });

  // Seguintes ligadas mas vazias = null.
  assert.equal(model.templatePayloadOfDraft({ draft: notificacaoCompleta(), followUps: { entryId: ENTRADA, goal: null, items: [] }, include: TUDO }).payload.followUps, null);
});

test("3. pop-up: configuração canônica (repetir até o clique sem botão vira never), Padrão = null, Personalizado e Livre na forma gravada e o apoio do design", () => {
  // Sem `popup` no rascunho e com a regra da v1 ("Até o aluno clicar") sem botao: so quando o pop-up terminar.
  const v1 = { ...schemas.emptyNoticeDraft("popup"), repeat: "until_action", title: "Aviso" };
  delete v1.popup;
  const semBotao = model.templatePayloadOfDraft({ draft: v1, followUps: null, include: TUDO }).payload;
  assert.equal(semBotao.settings.popup.frequency.mode, "repeat");
  assert.equal(semBotao.settings.popup.frequency.stopOn, "never");
  assert.deepEqual(semBotao.settings.popup, model.templatePayloadOfDraft({ draft: v1, followUps: null, include: TUDO }).payload.settings.popup);

  // Com botao, a regra da v1 fica no clique.
  const comBotao = model.templatePayloadOfDraft({ draft: { ...v1, cta: { href: "/", label: "Ir", target: "same_tab" } }, followUps: null, include: TUDO }).payload;
  assert.equal(comBotao.settings.popup.frequency.stopOn, "click");

  // Padrao.
  const padrao = model.templatePayloadOfDraft({ draft: { ...schemas.emptyNoticeDraft("popup"), title: "Oi" }, followUps: null, include: TUDO }).payload;
  assert.equal(padrao.design, null);
  assert.equal(padrao.designSupport, null);
  assert.deepEqual(padrao.settings, { allowSnooze: true, icon: null, popup: schemas.emptyNoticeDraft("popup").popup });

  // Personalizado com midia imagem e botao, conteudo desligado: o apoio leva o texto do botao e a imagem.
  const design = custom.popupStarterDesign("media_top_fade");
  const draft = popupComDesign(design, { cta: { href: "/", label: "Quero", target: "same_tab" }, image: IMAGEM });
  const semConteudo = model.templatePayloadOfDraft({ draft, followUps: null, include: { audience: true, content: false, followUps: false } }).payload;
  assert.deepEqual(semConteudo.design, design);
  assert.deepEqual(semConteudo.designSupport, { ctaLabel: "Quero", image: IMAGEM });
  assert.equal(semConteudo.content, null);

  // Com conteudo, o apoio e null.
  assert.equal(model.templatePayloadOfDraft({ draft, followUps: null, include: TUDO }).payload.designSupport, null);

  // Livre: na forma canonica e o apoio sem imagem.
  const livre = freeStarters.freeStarterDesign("glow_text");
  const livreDraft = { ...schemas.emptyNoticeDraft("popup"), cta: { href: "/", label: "Ver", target: "same_tab" }, design: null, freeDesign: livre, image: IMAGEM, title: "Livre" };
  const livrePayload = model.templatePayloadOfDraft({ draft: livreDraft, followUps: null, include: NADA }).payload;
  assert.deepEqual(livrePayload.design, freeModel.canonicalPopupFreeDesign(livre));
  assert.deepEqual(livrePayload.designSupport, { ctaLabel: "Ver", image: null });
});

test("4. guarda da §3.6: agendamento, janela, repeat, reshow e todos os ids nunca entram no payload, nem texto ISO de data", () => {
  const draft = {
    ...notificacaoCompleta(),
    campaignId: AVISO,
    edited_at: "2026-10-01T10:00:00.000Z",
    flow_id: FLUXO,
    flowId: FLUXO,
    id: AVISO,
    repeat: "until_action",
    reshow: true,
    status: "sent",
    updated_at: "2026-10-01T10:00:00.000Z",
    window: { endsAt: "2026-12-30T12:00:00.000Z", startsAt: "2026-12-01T12:00:00.000Z" }
  };
  const followUps = {
    entryId: ENTRADA,
    flowId: FLUXO,
    goal: null,
    items: [{ ...seguinte(S1, { content: { poll: { closesAt: null, multiple: false, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], question: "?", showResults: true } } }), campaignId: AVISO }],
    updatedAt: "2026-10-01T10:00:00.000Z"
  };

  for (const kind of ["inbox", "popup"]) {
    const { payload } = model.templatePayloadOfDraft({ draft: { ...draft, kind, ...(kind === "popup" ? { popup: schemas.emptyNoticeDraft("popup").popup } : {}) }, followUps, include: TUDO });
    const json = JSON.stringify(payload);

    for (const key of ["schedule", "sendAt", "window", "startsAt", "endsAt", "repeat", "reshow", "status", "campaignId", "flowId", "flow_id", "updated_at", "updatedAt", "edited_at", "approved_at", "requested_at", "recipients_count", "audience_count"]) {
      assert.equal((json.match(new RegExp(`"${key}":`, "g")) ?? []).length, 0, `${kind}: ${key}`);
    }

    assert.ok(!json.includes('"closesAt":"'), `${kind}: o fim da enquete nunca vai`);

    assert.doesNotMatch(json, ISO, `${kind}: nenhuma data no payload`);
    assert.ok(!json.includes(AVISO) && !json.includes(FLUXO), `${kind}: nenhum id de aviso ou de fluxo`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * 5 e 6: schemas
 * ---------------------------------------------------------------------------------------------- */

test("5. rascunho afrouxado: textos obrigatórios vazios passam; limites, combinações proibidas, destino inválido, 21 regras e páginas vazias são recusados com a mensagem de hoje", () => {
  const vazio = {
    ...schemas.emptyNoticeDraft("inbox"),
    cta: { href: "", label: "", target: "same_tab" },
    poll: null,
    response: { acceptLabel: "", declineLabel: "" },
    title: ""
  };
  assert.deepEqual(problemas(model.templateDraftInputSchema, vazio), []);
  assert.deepEqual(problemas(model.templateDraftInputSchema, { ...vazio, poll: { multiple: false, options: [{ id: "a", label: "" }, { id: "b", label: "" }], question: "" }, response: null }), []);

  const casos = [
    [{ ...vazio, title: "x".repeat(81) }, ["title", "Use até 80 caracteres."]],
    [{ ...schemas.emptyNoticeDraft("popup"), cta: null, response: null, title: "x".repeat(61) }, ["title", "Use até 60 caracteres."]],
    [{ ...vazio, poll: { options: [{ id: "a", label: "" }, { id: "b", label: "" }], question: "" } }, ["poll", "Use a resposta ou a enquete, não as duas."]],
    [{ ...schemas.emptyNoticeDraft("popup"), poll: { options: [{ id: "a", label: "" }, { id: "b", label: "" }], question: "" }, title: "" }, ["poll", "A enquete vale só para notificações por enquanto."]],
    [{ ...schemas.emptyNoticeDraft("popup"), reactions: true, title: "" }, ["reactions", "Reações valem só para notificações."]],
    [{ ...schemas.emptyNoticeDraft("popup"), response: { acceptLabel: "", declineLabel: "" }, title: "" }, ["response", "Pedir resposta vale só para notificações."]],
    [{ ...schemas.emptyNoticeDraft("popup"), sender: { userId: PESSOA }, title: "" }, ["sender", schemas.POPUP_SENDER_VALIDITY_MESSAGE]],
    [{ ...schemas.emptyNoticeDraft("popup"), title: "", validity: { minutes: 60, mode: "duration" } }, ["validity", schemas.POPUP_SENDER_VALIDITY_MESSAGE]],
    [{ ...vazio, cta: { href: "javascript:alert(1)", label: "", target: "same_tab" } }, ["cta.href", "Use um link que comece com https://."]],
    [{ ...schemas.emptyNoticeDraft("popup"), popup: { ...schemas.emptyNoticeDraft("popup").popup, pages: [] }, title: "" }, ["popup.pages", "Escolha pelo menos uma página."]]
  ];

  for (const [draft, esperado] of casos) {
    assert.ok(
      problemas(model.templateDraftInputSchema, draft).some(([path, message]) => path === esperado[0] && message === esperado[1]),
      `${esperado.join(": ")} em ${JSON.stringify(problemas(model.templateDraftInputSchema, draft))}`
    );
  }

  const vinteEUma = regras(...Array.from({ length: 21 }, (_, index) => temProduto(`p${index}`)));
  assert.ok(problemas(model.templateDraftInputSchema, { ...vazio, audience: vinteEUma }).some(([, message]) => message === "Use no máximo 20 regras."));

  // Os dois designs juntos.
  const livre = freeStarters.freeStarterDesign("blank");
  assert.ok(
    problemas(model.templateDraftInputSchema, { ...schemas.emptyNoticeDraft("popup"), design: custom.popupStarterDesign("text_only"), freeDesign: livre, title: "" }).some(
      ([path, message]) => path === "freeDesign" && message === POPUP_FREE_MESSAGES.bothDesigns
    )
  );

  // Notificacao: popup/design/freeDesign saem antes (como no rascunho), e o envio e aceito e descartado.
  const parsed = model.templateDraftInputSchema.parse({ ...vazio, design: { lixo: true }, popup: { lixo: true }, schedule: { mode: "at", sendAt: "x" }, window: {} });
  assert.equal(parsed.design, undefined);
  assert.equal(parsed.schedule, undefined);

  // O payload estrito recusa resposta no pop-up; a leitura tira essa parte com readContent.
  const popup = model.templatePayloadOfDraft({ draft: { ...schemas.emptyNoticeDraft("popup"), title: "Oi" }, followUps: null, include: TUDO }).payload;
  const comResposta = { ...popup, content: { ...popup.content, response: { acceptLabel: "Sim", declineLabel: "Não" } } };
  assert.ok(problemas(model.templatePayloadSchema, comResposta).some(([path, message]) => path === "content.response" && message === "Pedir resposta vale só para notificações."));
  const lido = model.parseTemplatePayload("popup", comResposta);
  assert.equal(lido.payload.content, null);
  assert.deepEqual(lido.notes, [M.readContent]);
});

/** "Para quem" com a estimativa por cima perto de `alvo` bytes (regras de produto com ids longos e distintos). */
function segmentoDe(alvo, prefixo) {
  const ids = [];
  const definicao = () => {
    const items = [];

    for (let index = 0; index < ids.length; index += 50) {
      items.push({ op: "has", productIds: ids.slice(index, index + 50), type: "product" });
    }

    return regras(...items);
  };

  while (freeModel.jsonbBytesUpperBound(definicao()) < alvo) {
    ids.push(`${prefixo}${ids.length}_`.padEnd(240, "x"));
  }

  const sobra = freeModel.jsonbBytesUpperBound(definicao()) - alvo;
  const ultimo = ids.pop();
  ids.push(ultimo.slice(0, Math.max(ultimo.length - sobra, `${prefixo}${ids.length}_`.length)));

  return definicao();
}

const EURO = (length) => "€".repeat(length);

function conteudoNoLimite() {
  const link = (bucket) => {
    const base = publico(bucket, "");
    return `${base}${"a".repeat(2_048 - base.length)}`;
  };

  return {
    audio: { durationSeconds: 300, mimeType: "audio/mpeg", peaks: Array.from({ length: 96 }, () => 100), url: link("communication-audio") },
    body: EURO(600),
    cta: { display: "button", href: `https://exemplo.com/${"a".repeat(2_048 - 20)}`, label: EURO(30), target: "new_tab" },
    image: { alt: EURO(160), url: link("content-assets") },
    poll: {
      closesAt: null,
      multiple: true,
      options: Array.from({ length: 6 }, (_, index) => ({ id: `o${index}`, label: `${EURO(59)}${index}` })),
      question: EURO(120),
      showResults: true
    },
    reactions: true,
    response: null,
    title: EURO(80)
  };
}

test("6. payload estrito: chave a mais e versão diferente de 1 são recusadas, acima de 786.432 dá tooBig; o pior aviso válido cabe com 10% de folga (D14)", () => {
  const { payload } = model.templatePayloadOfDraft({ draft: notificacaoCompleta(), followUps: null, include: TUDO });
  assert.equal(model.templatePayloadSchema.safeParse(payload).success, true);
  assert.ok(problemas(model.templatePayloadSchema, { ...payload, extra: 1 }).length > 0, "chave a mais");
  assert.ok(problemas(model.templatePayloadSchema, { ...payload, settings: { ...payload.settings, extra: 1 } }).length > 0, "chave a mais na configuração");
  assert.ok(problemas(model.templatePayloadSchema, { ...payload, version: 2 }).length > 0, "versão 2");

  // Grande demais: segmentos enormes (o zod limita regras e ids, nao bytes).
  const enorme = segmentoDe(240_000, "z");
  const grande = {
    ...payload,
    audience: enorme,
    followUps: { entryId: ENTRADA, goal: null, items: [S1, S2, S11].map((id) => seguinte(id, { who: enorme })) }
  };
  assert.ok(freeModel.jsonbBytesUpperBound(grande) > model.TEMPLATE_LIMITS.payloadBytes);
  assert.deepEqual(problemas(model.templatePayloadSchema, grande), [["", M.tooBig]]);

  // Pior aviso valido: a principal e 20 seguintes (5 no 1o nivel, 15 no 2o), cada "Para quem" ~16.896 bytes,
  // textos no limite com "€", enderecos no maximo, 96 picos e a enquete com o maximo de opcoes.
  const conteudo = conteudoNoLimite();
  const conteudoDaSeguinte = { ...conteudo, allowHide: true, icon: { color: "amber", id: "gift" }, sender: { userId: PESSOA }, validity: { mode: "default" } };
  let n = 0;
  const id = () => `0b1c2d3e-4f5a-4b6c-8d7e-${String((n += 1)).padStart(12, "0")}`;
  const filho = () => ({ children: [], content: conteudoDaSeguinte, id: id(), when: { anchor: "sent", minutes: 60 }, who: segmentoDe(16_896, `s${n}`) });
  const items = Array.from({ length: 5 }, () => ({ children: [filho(), filho(), filho()], content: conteudoDaSeguinte, id: id(), when: { anchor: "sent", minutes: 60 }, who: segmentoDe(16_896, `p${n}`) }));
  const pior = {
    audience: segmentoDe(16_896, "m"),
    content: conteudo,
    followUps: { entryId: ENTRADA, goal: { productId: PRODUTO }, items },
    kind: "inbox",
    settings: { allowHide: true, icon: { color: "amber", id: "gift" }, sender: { userId: PESSOA }, validity: { minutes: 1_440, mode: "duration" } },
    version: 1
  };
  const total = items.reduce((sum, item) => sum + 1 + item.children.length, 0);
  assert.equal(total, 20);

  const bytes = freeModel.jsonbBytesUpperBound(pior);
  const teto = 0.9 * model.TEMPLATE_LIMITS.payloadBytes;
  assert.deepEqual(problemas(model.templatePayloadSchema, pior), [], "o pior aviso válido passa no schema");
  console.info(`[modelos] pior aviso válido: ${bytes} bytes pela estimativa por cima (teto do app ${model.TEMPLATE_LIMITS.payloadBytes})`);
  assert.ok(bytes <= teto, `pior aviso válido: ${bytes} bytes pela estimativa por cima; o teto com 10% de folga é ${Math.floor(teto)}`);
});

/* ------------------------------------------------------------------------------------------------
 * 7: leitura do banco
 * ---------------------------------------------------------------------------------------------- */

test("7. leitura parte por parte: cada parte inválida vira o padrão com a nota exata; versão ou tipo errado não abre; nunca lança; hasReadNotes", () => {
  const inbox = model.templatePayloadOfDraft({
    draft: notificacaoCompleta(),
    followUps: { entryId: ENTRADA, goal: null, items: [seguinte(S1)] },
    include: TUDO
  }).payload;
  const popup = model.templatePayloadOfDraft({
    draft: popupComDesign(custom.popupStarterDesign("text_only"), { cta: { href: "/", label: "Ir", target: "same_tab" } }),
    followUps: null,
    include: { audience: true, content: false, followUps: false }
  }).payload;
  const design = model.templatePayloadOfDesign({ design: custom.popupStarterDesign("text_only"), freeDesign: null, support: { ctaLabel: "Ir", image: null } });

  assert.deepEqual(model.parseTemplatePayload("inbox", inbox), { notes: [], payload: model.templatePayloadSchema.parse(inbox) });
  assert.deepEqual(model.parseTemplatePayload("popup", popup).notes, []);
  assert.deepEqual(model.parseTemplatePayload("design", design).notes, []);

  const parte = (kind, base, key, value) => model.parseTemplatePayload(kind, { ...base, [key]: value });

  const settings = parte("inbox", inbox, "settings", { allowHide: "sim" });
  assert.deepEqual(settings.payload.settings, { allowHide: true, icon: null, sender: null, validity: { mode: "default" } });
  assert.deepEqual(settings.notes, [M.readSettings]);

  const conteudo = parte("inbox", inbox, "content", { title: 3 });
  assert.equal(conteudo.payload.content, null);
  assert.deepEqual(conteudo.notes, [M.readContent]);

  const segmento = parte("inbox", inbox, "audience", { kind: "rules" });
  assert.equal(segmento.payload.audience, null);
  assert.deepEqual(segmento.notes, [M.readAudience]);

  const seguintes = parte("inbox", inbox, "followUps", { entryId: "x", goal: null, items: [] });
  assert.equal(seguintes.payload.followUps, null);
  assert.deepEqual(seguintes.notes, [M.readFollowUps]);

  const popupSettings = parte("popup", popup, "settings", null);
  assert.deepEqual(popupSettings.payload.settings, { allowSnooze: true, icon: null, popup: schemas.emptyNoticeDraft("popup").popup });
  assert.deepEqual(popupSettings.notes, [M.readSettings]);

  const designQuebrado = parte("popup", popup, "design", { blocks: "x" });
  assert.equal(designQuebrado.payload.design, null);
  assert.equal(designQuebrado.payload.designSupport, null);
  assert.deepEqual(designQuebrado.notes, [M.readDesign]);

  const apoio = parte("popup", popup, "designSupport", { ctaLabel: 3 });
  assert.deepEqual(apoio.payload.designSupport, { ctaLabel: null, image: null });
  assert.deepEqual(apoio.notes, [M.readDesign]);

  // No tipo design, o design que nao passa deixa o payload todo nulo.
  assert.deepEqual(parte("design", design, "design", { mode: "free", lixo: true }), { notes: [], payload: null });
  assert.deepEqual(parte("design", design, "designSupport", null).notes, [M.readDesign]);

  for (const version of [2, 0, 1.5, "1", null]) {
    assert.deepEqual(model.parseTemplatePayload("inbox", { ...inbox, version }), { notes: [], payload: null }, `version ${version}`);
  }

  assert.deepEqual(model.parseTemplatePayload("popup", inbox), { notes: [], payload: null }, "tipo trocado");

  for (const lixo of [null, 3, [inbox], "texto", undefined]) {
    assert.deepEqual(model.parseTemplatePayload("inbox", lixo), { notes: [], payload: null });
  }

  // Atualizacao por versao (tabela falsa e versao atual simulada): v1 -> v2 e lido; sem a funcao, nao abre.
  const upgrades = { 1: (raw) => ({ ...raw, content: { ...raw.content, title: `${raw.content.title} (v2)` }, version: 2 }) };
  const atualizado = model.parseTemplatePayload("inbox", inbox, { upgrades, version: 2 });
  assert.equal(atualizado.payload.content.title, "Oferta especial (v2)");
  assert.deepEqual(model.parseTemplatePayload("inbox", inbox, { upgrades: {}, version: 2 }), { notes: [], payload: null });
  assert.deepEqual(model.TEMPLATE_UPGRADES, {}, "vazia na v1");

  assert.equal(model.hasReadNotes([M.readSettings]), true);
  assert.equal(model.hasReadNotes([M.noteUntil, M.readFollowUps]), true);
  assert.equal(model.hasReadNotes([M.noteUntil, M.notePollEnd, M.applyCta("Ir"), M.senderGone("Ana")]), false);
  assert.equal(model.hasReadNotes([]), false);
});

/* ------------------------------------------------------------------------------------------------
 * 8 a 10: o que o editor abre e a aplicacao do Design
 * ---------------------------------------------------------------------------------------------- */

function modeloComSeguintes() {
  const s1 = seguinte(S1, { who: regras({ action: "opened", negate: false, ref: { kind: "node", nodeId: ENTRADA }, type: "message" }) }, [
    seguinte(S11, {
      who: regras(
        { negate: false, page: { kind: "message_cta", nodeId: S1 }, since: { kind: "message", nodeId: ENTRADA }, type: "page_visit" },
        { negate: true, productIds: [PRODUTO], since: { kind: "message", nodeId: S1 }, type: "access_gained" }
      )
    })
  ]);

  return model.templatePayloadOfDraft({
    draft: notificacaoCompleta({ validity: { mode: "default" } }),
    followUps: { entryId: ENTRADA, goal: { productId: PRODUTO }, items: [s1, seguinte(S2)] },
    include: TUDO
  }).payload;
}

function idsDe(start) {
  const ids = [start.followUps.entryId];
  const walk = (items) => items.forEach((item) => (ids.push(item.id), walk(item.children)));
  walk(start.followUps.items);
  return ids;
}

test("8. noticeStartOfTemplate: com newId, ids novos e únicos e regras remapeadas; sem newId, os gravados (D28); envio agora e sem janela", () => {
  const payload = modeloComSeguintes();
  const template = { id: AVISO, name: "Lançamento", payload };
  const primeiro = model.noticeStartOfTemplate(template, { newId: randomUUID });
  const segundo = model.noticeStartOfTemplate(template, { newId: randomUUID });
  const antigos = [ENTRADA, S1, S2, S11];

  for (const start of [primeiro, segundo]) {
    const ids = idsDe(start);
    assert.equal(new Set(ids).size, 4, "ids únicos");
    assert.ok(ids.every((id) => !antigos.includes(id)), "nenhum id do modelo");
    assert.deepEqual(start.draft.schedule, { mode: "now" });
    assert.deepEqual(start.draft.window, { endsAt: null, startsAt: null });
    assert.equal(start.draft.poll.closesAt, null);
    assert.equal(start.templateId, AVISO);
    assert.equal(start.templateName, "Lançamento");

    const [s1, s2] = start.followUps.items;
    const s11 = s1.children[0];
    assert.equal(s1.who.root.items[0].ref.nodeId, start.followUps.entryId, "message (node) aponta para a entrada nova");
    assert.equal(s11.who.root.items[0].page.nodeId, s1.id, "page_visit message_cta aponta para a seguinte nova");
    assert.equal(s11.who.root.items[0].since.nodeId, start.followUps.entryId, "page_visit since");
    assert.equal(s11.who.root.items[1].since.nodeId, s1.id, "access_gained since");
    assert.notEqual(s2.id, S2);
  }

  assert.equal(idsDe(primeiro).filter((id) => idsDe(segundo).includes(id)).length, 0, "dois usos não repetem id");

  const modo = model.noticeStartOfTemplate(template, {});
  assert.deepEqual(idsDe(modo), [ENTRADA, S1, S11, S2]);
  assert.deepEqual(modo, model.noticeStartOfTemplate(template, {}), "duas leituras iguais");
  assert.equal(modo.followUps.items[0].who.root.items[0].ref.nodeId, ENTRADA);

  // Notificacao: configuracao e conteudo no rascunho.
  assert.equal(modo.draft.kind, "inbox");
  assert.equal(modo.draft.allowHide, false);
  assert.deepEqual(modo.draft.sender, { userId: PESSOA });
  assert.deepEqual(modo.draft.icon, { color: "amber", id: "gift" });
  assert.equal(modo.draft.title, "Oferta especial");
  assert.equal(schemas.noticeDraftSchema.safeParse(modo.draft).success, true, "o rascunho aberto passa no rascunho do aviso");

  // Segmento desligado = todos os alunos.
  assert.deepEqual(model.noticeStartOfTemplate({ ...template, payload: { ...payload, audience: null } }, {}).draft.audience, TODOS);

  // Pop-up montado a mao com resposta, quem envia e tempo no sino: nada disso entra.
  const popup = model.templatePayloadOfDraft({ draft: { ...schemas.emptyNoticeDraft("popup"), title: "Oi" }, followUps: null, include: TUDO }).payload;
  const aMao = {
    ...popup,
    content: { ...popup.content, response: { acceptLabel: "Sim", declineLabel: "Não" } },
    settings: { ...popup.settings, sender: { userId: PESSOA }, validity: { minutes: 60, mode: "duration" } }
  };
  const aberto = model.noticeStartOfTemplate({ id: AVISO, name: "Pop", payload: aMao }, { newId: randomUUID }).draft;
  assert.equal(aberto.response, null);
  assert.equal(aberto.sender, null);
  assert.deepEqual(aberto.validity, { mode: "default" });
  assert.equal(aberto.repeat, "once");
  assert.equal(aberto.followUps, undefined);
});

test("9. pop-up sem conteúdo e com design: o botão com o texto do modelo (ou Saiba mais) e destino vazio, a imagem do apoio e os blocos sincronizados", () => {
  const design = custom.popupStarterDesign("media_top_fade", { hasAudio: true });
  assert.ok(design.blocks.some((block) => block.type === "audio"));

  const payload = {
    ...model.templatePayloadOfDraft({ draft: popupComDesign(design, { cta: { href: "/", label: "Quero", target: "same_tab" }, image: IMAGEM }), followUps: null, include: NADA }).payload
  };
  const start = model.noticeStartOfTemplate({ id: AVISO, name: "Pop", payload }, {});
  assert.deepEqual(start.draft.cta, { display: "button", href: "", label: "Quero", target: "same_tab" });
  assert.deepEqual(start.draft.image, IMAGEM);
  assert.ok(!start.draft.design.blocks.some((block) => block.type === "audio"), "o bloco Áudio sai sem áudio");
  assert.ok(start.draft.design.blocks.some((block) => block.type === "button"));
  assert.equal(start.draft.freeDesign, null);
  assert.deepEqual(start.notes, [M.applyCta("Quero")]);

  const semTexto = model.noticeStartOfTemplate({ id: AVISO, name: "Pop", payload: { ...payload, designSupport: { ctaLabel: null, image: null } } }, {});
  assert.equal(semTexto.draft.cta.label, "Saiba mais");
  assert.deepEqual(semTexto.notes, [M.applyCta("Saiba mais"), M.applyNeedsImage]);

  // Modelo de Design: um pop-up novo com o design aplicado.
  const deDesign = model.templatePayloadOfDesign({ design: null, freeDesign: freeStarters.freeStarterDesign("blank"), support: { ctaLabel: "Entrar", image: null } });
  const novo = model.noticeStartOfTemplate({ id: AVISO, name: "Design", payload: deDesign }, {});
  assert.equal(novo.draft.kind, "popup");
  assert.equal(novo.draft.design, null);
  assert.ok(novo.draft.freeDesign);
  assert.equal(novo.draft.cta.label, "Entrar");
  assert.equal(novo.draft.title, "");
});

test("10. applyDesignTemplatePatch: Personalizado e Livre, com e sem botão no aviso; Lembrar depois; a imagem do aviso fica e a do modelo só preenche o vazio", () => {
  const conteudo = (extra = {}) => ({ allowSnooze: true, audio: null, cta: null, image: null, ...extra });
  const personalizado = custom.popupStarterDesign("media_top_fade");
  const suporte = { ctaLabel: "Quero", image: IMAGEM };

  const semBotao = model.applyDesignTemplatePatch(conteudo(), { design: personalizado, support: suporte });
  assert.deepEqual(semBotao.patch.cta, { display: "button", href: "", label: "Quero", target: "same_tab" });
  assert.deepEqual(semBotao.patch.image, IMAGEM, "aviso sem imagem recebe a do modelo");
  assert.equal(semBotao.patch.freeDesign, null);
  assert.deepEqual(semBotao.notes, [M.applyCta("Quero")]);

  const minha = { alt: "Minha", url: publico("content-assets", `communications/images/${"f".repeat(24)}.webp`) };
  const comBotao = model.applyDesignTemplatePatch(conteudo({ cta: { href: "/x", label: "Meu", target: "same_tab" }, image: minha }), { design: personalizado, support: suporte });
  assert.equal(comBotao.patch.cta, undefined, "o botão do aviso fica");
  assert.deepEqual(comBotao.patch.image, minha, "a imagem do aviso fica");
  assert.deepEqual(comBotao.notes, []);

  const semImagem = model.applyDesignTemplatePatch(conteudo({ cta: { href: "/x", label: "Meu", target: "same_tab" } }), { design: personalizado, support: { ctaLabel: null, image: null } });
  assert.deepEqual(semImagem.notes, [M.applyNeedsImage]);

  // Lembrar depois no segundo botao.
  const comSnooze = structuredClone(custom.popupStarterDesign("text_only"));
  const botao = comSnooze.blocks.find((block) => block.type === "button");
  comSnooze.blocks.push({ action: { kind: "snooze" }, id: "b8", label: "Depois", style: botao.style, type: "button2" });
  const snooze = model.applyDesignTemplatePatch(conteudo({ allowSnooze: false, cta: { href: "/", label: "Ir", target: "same_tab" } }), { design: comSnooze, support: { ctaLabel: null, image: null } });
  assert.equal(snooze.patch.allowSnooze, true);
  assert.deepEqual(snooze.notes, [M.applySnooze]);

  // Livre: o design sincronizado (com o botao, sem audio) e na forma canonica.
  const livre = freeStarters.freeStarterDesign("glow_text");
  const livreSem = model.applyDesignTemplatePatch(conteudo(), { design: livre, support: { ctaLabel: null, image: null } });
  assert.equal(livreSem.patch.design, null);
  assert.equal(livreSem.patch.cta.label, "Saiba mais");
  assert.equal(livreSem.patch.image, undefined, "o Livre nao mexe na imagem do aviso");
  assert.deepEqual(livreSem.patch.freeDesign, freeModel.canonicalPopupFreeDesign(livre));

  const livreComAudio = model.applyDesignTemplatePatch(conteudo({ audio: AUDIO, cta: { href: "/", label: "Ir", target: "same_tab" } }), { design: livre, support: { ctaLabel: "X", image: null } });
  let temAudio = false;
  freeModel.walkFreeNodes(livreComAudio.patch.freeDesign.children, (node) => (temAudio ||= node.type === "audio"));
  assert.equal(temAudio, true, "o player do áudio entra com o áudio do aviso");
  assert.equal(livreComAudio.patch.cta, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * 11 a 13: nomes, erros e vocabulario
 * ---------------------------------------------------------------------------------------------- */

test("11. duplicateTemplateName e defaultTemplateName", () => {
  const longo = "N".repeat(80);
  const copia = model.duplicateTemplateName(longo);
  assert.equal(copia.length, 80);
  assert.ok(copia.endsWith(" (cópia)"));
  assert.equal(model.duplicateTemplateName("Lançamento"), "Lançamento (cópia)");

  assert.equal(model.defaultTemplateName({ kind: "inbox", title: "  Oferta especial  " }), "Oferta especial");
  assert.equal(model.defaultTemplateName({ kind: "inbox", title: "T".repeat(90) }).length, 80);
  assert.equal(model.defaultTemplateName({ kind: "inbox", title: "   " }), "Modelo de notificação");
  assert.equal(model.defaultTemplateName({ kind: "popup", title: "" }), "Modelo de pop-up");
  assert.equal(model.defaultTemplateName({ forDesign: true, kind: "popup", mode: "custom", title: "Turma nova" }), "Design de Turma nova");
  assert.equal(model.defaultTemplateName({ forDesign: true, kind: "popup", mode: "free", title: "T".repeat(90) }).length, 80);
  assert.equal(model.defaultTemplateName({ forDesign: true, kind: "popup", mode: "custom", title: "" }), "Design Personalizado");
  assert.equal(model.defaultTemplateName({ forDesign: true, kind: "popup", mode: "free", title: "" }), "Design Livre");
});

test("11. o corte do nome nunca deixa meio emoji e cabe no campo (.length), no zod e no char_length do banco", () => {
  const EMOJI = "😀"; // 2 unidades UTF-16, 1 caractere
  const caracteres = (value) => Array.from(value).length;
  /** O que o servidor e o banco aceitam e o que o campo e os contadores mostram (docs/28 D13). */
  function cabe(nome, contexto) {
    assert.equal(nome.isWellFormed(), true, `${contexto}: sem metade de emoji`);
    assert.ok(nome.length <= model.TEMPLATE_LIMITS.name, `${contexto}: ${nome.length} unidades no campo`);
    assert.ok(caracteres(nome.trim()) >= 1 && caracteres(nome.trim()) <= model.TEMPLATE_LIMITS.name, `${contexto}: char_length`);
    assert.equal(model.templateNameSchema.safeParse(nome).success, true, `${contexto}: zod`);
  }

  // 71 letras + emoji: o corte em 72 unidades caia no meio do emoji (o Postgres recusava a copia).
  const naFronteira = `${"a".repeat(71)}${EMOJI}`;
  const copia = model.duplicateTemplateName(naFronteira);
  cabe(copia, "duplicar 71 + emoji");
  assert.equal(copia, `${"a".repeat(71)} (cópia)`, "o emoji inteiro sai");

  // 70 letras + emoji cabem inteiros: 72 unidades + " (cópia)" = 80.
  const cabeInteiro = model.duplicateTemplateName(`${"a".repeat(70)}${EMOJI}`);
  cabe(cabeInteiro, "duplicar 70 + emoji");
  assert.equal(cabeInteiro, `${"a".repeat(70)}${EMOJI} (cópia)`);

  // So emojis (40 = 80 unidades, o maximo do campo): a copia corta em emojis inteiros.
  const soEmojis = model.duplicateTemplateName(EMOJI.repeat(40));
  cabe(soEmojis, "duplicar 40 emojis");
  assert.equal(soEmojis, `${EMOJI.repeat(36)} (cópia)`);

  // defaultTemplateName: 79 letras + emoji (81 unidades) e "Design de " + 69 letras + emoji.
  const titulo = model.defaultTemplateName({ kind: "inbox", title: `${"T".repeat(79)}${EMOJI}` });
  cabe(titulo, "título 79 + emoji");
  assert.equal(titulo, "T".repeat(79));
  const doDesign = model.defaultTemplateName({ forDesign: true, kind: "popup", mode: "custom", title: `${"T".repeat(69)}${EMOJI}` });
  cabe(doDesign, "design 69 + emoji");
  assert.equal(doDesign, `Design de ${"T".repeat(69)}`);
  const inteiro = model.defaultTemplateName({ kind: "popup", title: `${"T".repeat(78)}${EMOJI}` });
  assert.equal(inteiro, `${"T".repeat(78)}${EMOJI}`, "80 unidades cabem inteiras");

  for (const [nome, valor] of [
    ["duplicar com espaço antes do emoji", model.duplicateTemplateName(`${"a".repeat(70)} ${EMOJI}`)],
    ["título só de emojis", model.defaultTemplateName({ kind: "inbox", title: EMOJI.repeat(45) })],
    ["design só de emojis", model.defaultTemplateName({ forDesign: true, kind: "design", mode: "free", title: EMOJI.repeat(45) })]
  ]) {
    cabe(valor, nome);
  }
});

test("12. templateErrorsFromAction: os caminhos da Server Action viram os campos do editor", () => {
  assert.deepEqual(
    model.templateErrorsFromAction({
      "body.design.media.video": ["Envie o vídeo de novo."],
      "body.draft.cta.href": ["Use um link que comece com https://."],
      "body.draft.title": ["Use até 80 caracteres.", "segunda"],
      "body.followUps.followUps.1.id": ["Passo inválido."],
      "body.followUps.items.0.children.1.content.title": ["Escreva um título."],
      "body.freeDesign.assets.v": ["Envie o vídeo de novo."],
      "followUps.0.content.sender": ["Escolha alguém da equipe."],
      name: ["Dê um nome ao modelo."],
      sender: ["Escolha alguém da equipe."]
    }),
    {
      "cta.href": "Use um link que comece com https://.",
      "design.media.video": "Envie o vídeo de novo.",
      "followUps.0.children.1.content.title": "Escreva um título.",
      "followUps.0.content.sender": "Escolha alguém da equipe.",
      "followUps.1.id": "Passo inválido.",
      "freeDesign.assets.v": "Envie o vídeo de novo.",
      name: "Dê um nome ao modelo.",
      sender: "Escolha alguém da equipe.",
      title: "Use até 80 caracteres."
    }
  );
  assert.deepEqual(model.templateErrorsFromAction(undefined), {});
});

test("13. vocabulário: nenhum texto dos Modelos usa template, público, audiência, layout ou lembrete", () => {
  for (const [chave, valor] of Object.entries(M)) {
    const texto = typeof valor === "function" ? valor(chave === "fontInTemplates" ? 2 : "Ana") : valor;
    assert.doesNotMatch(texto, FORBIDDEN, chave);
  }

  assert.equal(M.fontInTemplates(1), "Esta fonte está em 1 modelo. Troque a fonte nesse modelo ou exclua o modelo antes.");
  assert.equal(M.fontInTemplates(3), "Esta fonte está em 3 modelos. Troque a fonte nesses modelos ou exclua os modelos antes.");

  for (const valor of [...Object.values(model.TEMPLATE_KIND_LABELS), ...[modeloComSeguintes(), null].map(model.templateSummary)]) {
    assert.doesNotMatch(valor, FORBIDDEN);
  }
});

/* ------------------------------------------------------------------------------------------------
 * 14 e 15: o que o modelo segura e os construtores de Design
 * ---------------------------------------------------------------------------------------------- */

test("14. templateMediaUse: cada tipo segura os seus arquivos, inclusive as seguintes de 2 níveis; fontes em minúsculas; mais de 5.000 textos não escondem as seguintes", () => {
  const imagem = (hex) => ({ alt: "", url: publico("content-assets", `communications/images/${hex}.webp`) });
  const audio = (hex) => ({ ...AUDIO, url: publico("communication-audio", `campaigns/${hex}.mp3`) });
  const payload = modeloComSeguintes();
  payload.followUps.items[0].content.image = imagem("a".repeat(24));
  payload.followUps.items[0].children[0].content.audio = audio("b".repeat(24));
  payload.followUps.items[0].children[0].content.image = imagem("c".repeat(24));

  const chaves = (lista) => lista.map(refs.mediaKey).sort();
  const esperado = [
    `communication-audio/campaigns/${"b".repeat(24)}.mp3`,
    `communication-audio/campaigns/${HEX}.mp3`,
    `content-assets/communications/images/${"a".repeat(24)}.webp`,
    `content-assets/communications/images/${"c".repeat(24)}.webp`,
    `content-assets/communications/images/${HEX}.webp`
  ].sort();
  assert.deepEqual(chaves(refs.templateMediaUse({ payload }).refs), esperado);

  // Design: as fontes do design em minusculas.
  const comFonte = structuredClone(custom.popupStarterDesign("media_top_fade", { video: { mimeType: "video/mp4", path: VIDEO, url: publico("communication-popup-video", VIDEO) } }));
  comFonte.fonts = ["6F1C2C9E-8D55-4F3A-9A1B-0C2D3E4F5A6B"];
  const uso = refs.templateMediaUse({ payload: { design: comFonte, designSupport: { ctaLabel: null, image: imagem("d".repeat(24)) }, kind: "design", version: 1 } });
  assert.deepEqual(uso.fontIds, ["6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b"]);
  assert.deepEqual(chaves(uso.refs), [`communication-popup-video/${VIDEO}`, `content-assets/communications/images/${"d".repeat(24)}.webp`]);

  // Mais de 5.000 textos antes das seguintes: a varredura larga para, os campos conhecidos nao.
  const cheio = { aaa: Array.from({ length: 6_000 }, (_, index) => `texto ${index}`), ...payload };
  assert.deepEqual(chaves(refs.templateMediaUse({ payload: cheio }).refs), esperado);
  assert.ok(refs.mediaRefsInJson(cheio).length < esperado.length, "a varredura larga sozinha perderia arquivos");
});

test("15. construtores de Design e apoios, modo, chaves, modelo em branco, resumo e notas do diálogo", () => {
  const comImagem = custom.popupStarterDesign("media_top_fade");
  const comVideo = structuredClone(custom.popupStarterDesign("media_top_fade", { video: { mimeType: "video/mp4", path: VIDEO, url: publico("communication-popup-video", VIDEO) } }));
  comVideo.media.kind = "video";
  const semMidia = custom.popupStarterDesign("text_only");
  const livre = freeStarters.freeStarterDesign("blank");
  const apoio = { ctaLabel: " Quero ", image: IMAGEM };

  assert.deepEqual(model.templatePayloadOfDesign({ design: comImagem, freeDesign: null, support: apoio }).designSupport, { ctaLabel: "Quero", image: IMAGEM });
  assert.deepEqual(model.templatePayloadOfDesign({ design: comVideo, freeDesign: null, support: apoio }).designSupport, { ctaLabel: "Quero", image: IMAGEM });
  assert.deepEqual(model.templatePayloadOfDesign({ design: semMidia, freeDesign: null, support: apoio }).designSupport, { ctaLabel: "Quero", image: null });
  assert.deepEqual(model.templatePayloadOfDesign({ design: null, freeDesign: livre, support: apoio }).designSupport, { ctaLabel: "Quero", image: null });
  const semBotao = { ...semMidia, blocks: semMidia.blocks.filter((block) => block.type !== "button") };
  assert.deepEqual(model.templatePayloadOfDesign({ design: semBotao, freeDesign: null, support: apoio }).designSupport.ctaLabel, null, "ctaLabel só com o botão principal");
  assert.throws(() => model.templatePayloadOfDesign({ design: null, freeDesign: null, support: apoio }));

  assert.deepEqual(model.templateDesignSupportOf({ cta: { href: "/", label: "Ir", target: "same_tab" }, design: comImagem, freeDesign: null, image: IMAGEM }), { ctaLabel: "Ir", image: IMAGEM });
  assert.deepEqual(model.templateDesignSupportOf({ cta: null, design: comImagem, image: IMAGEM }), { ctaLabel: null, image: IMAGEM });
  assert.deepEqual(model.templateDesignSupportOf({ cta: { href: "/", label: "Ir", target: "same_tab" }, design: null, freeDesign: livre, image: IMAGEM }), { ctaLabel: "Ir", image: null });
  assert.deepEqual(model.templateDesignSupportOf({ cta: null, design: null, image: IMAGEM }), { ctaLabel: null, image: null });

  // designTemplateDraft: com e sem payload, nos dois modos.
  const paginaCustom = model.designTemplateDraft(model.templatePayloadOfDesign({ design: comImagem, freeDesign: null, support: apoio }), "custom", "Meu design");
  assert.equal(paginaCustom.title, "Meu design");
  assert.equal(paginaCustom.allowSnooze, true);
  assert.equal(paginaCustom.audio, null);
  assert.equal(paginaCustom.cta.label, "Quero");
  assert.deepEqual(paginaCustom.image, IMAGEM);
  assert.equal(paginaCustom.freeDesign, null);
  const paginaLivre = model.designTemplateDraft(model.templatePayloadOfDesign({ design: null, freeDesign: livre, support: apoio }), "free", "Livre");
  assert.ok(paginaLivre.freeDesign);
  assert.equal(paginaLivre.design, null);
  for (const mode of ["custom", "free"]) {
    const vazio = model.designTemplateDraft(null, mode, "");
    assert.equal(vazio.design, null);
    assert.equal(vazio.freeDesign, null);
    assert.equal(vazio.kind, "popup");
  }

  // templateDesignModeOf e templateIncludeOf.
  const inbox = modeloComSeguintes();
  const popup = model.templatePayloadOfDraft({ draft: popupComDesign(comImagem, { cta: { href: "/", label: "Ir", target: "same_tab" }, image: IMAGEM }), followUps: null, include: TUDO }).payload;
  const popupLivre = model.templatePayloadOfDraft({ draft: { ...schemas.emptyNoticeDraft("popup"), design: null, freeDesign: livre, title: "L" }, followUps: null, include: NADA }).payload;
  const padrao = model.templatePayloadOfDraft({ draft: { ...schemas.emptyNoticeDraft("popup"), title: "P" }, followUps: null, include: { audience: true, content: false, followUps: false } }).payload;
  assert.equal(model.templateDesignModeOf(inbox), null);
  assert.equal(model.templateDesignModeOf(popup), "custom");
  assert.equal(model.templateDesignModeOf(popupLivre), "free");
  assert.equal(model.templateDesignModeOf(padrao), null);
  assert.equal(model.templateDesignModeOf(model.templatePayloadOfDesign({ design: null, freeDesign: livre, support: apoio })), "free");
  assert.deepEqual(model.templateIncludeOf(inbox), TUDO);
  assert.deepEqual(model.templateIncludeOf({ ...inbox, audience: null, followUps: null }), { audience: false, content: true, followUps: false });
  assert.deepEqual(model.templateIncludeOf(padrao), { audience: true, content: false, followUps: false });
  assert.deepEqual(model.templateIncludeOf(model.templatePayloadOfDesign({ design: comImagem, freeDesign: null, support: apoio })), NADA);
  assert.deepEqual(model.templateIncludeOf(null), NADA);

  // emptyTemplateStart.
  for (const kind of ["inbox", "popup"]) {
    const start = model.emptyTemplateStart(kind);
    assert.deepEqual(start, { draft: schemas.emptyNoticeDraft(kind), followUps: null, notes: [], templateId: null, templateName: null });
  }

  // templateSummary.
  assert.equal(model.templateSummary(inbox), "Leva conteúdo, segmento e 3 notificações seguintes");
  assert.equal(model.templateSummary({ ...inbox, followUps: { ...inbox.followUps, items: [inbox.followUps.items[1]] } }), "Leva conteúdo, segmento e 1 notificação seguinte");
  assert.equal(model.templateSummary({ ...inbox, audience: null, content: null, followUps: null }), "Só a configuração");
  assert.equal(model.templateSummary({ ...inbox, audience: null, followUps: null }), "Leva conteúdo");
  assert.equal(model.templateSummary(popup), "Design Personalizado · leva conteúdo e segmento");
  assert.equal(model.templateSummary(popupLivre), "Design Livre · só a configuração");
  assert.equal(model.templateSummary(padrao), "Design Padrão · leva segmento");
  assert.equal(model.templateSummary(model.templatePayloadOfDesign({ design: comImagem, freeDesign: null, support: apoio })), "Só o visual do pop-up, montado por seções");
  assert.equal(model.templateSummary(model.templatePayloadOfDesign({ design: null, freeDesign: livre, support: apoio })), "Só o visual do pop-up, montado no editor Livre");
  assert.equal(model.templateSummary(null), "Este modelo não pode ser aberto.");

  // templateSaveNotes.
  const rascunho = notificacaoCompleta();
  const seguintesAteData = { entryId: ENTRADA, goal: null, items: [seguinte(S1, { content: { validity: { endsAt: "2026-12-10T12:00:00.000Z", mode: "until" } } })] };
  assert.deepEqual(model.templateSaveNotes(rascunho, TUDO, seguintesAteData, { otherGoal: false }), [M.noteUntil, M.notePollEnd, M.noteFollowUpUntil]);
  assert.deepEqual(model.templateSaveNotes(rascunho, TUDO, null, { otherGoal: true }), [M.noteUntil, M.notePollEnd, M.noteOtherGoal]);
  assert.deepEqual(model.templateSaveNotes(rascunho, { audience: true, content: false, followUps: false }, seguintesAteData, { otherGoal: true }), [M.noteUntil]);
  assert.deepEqual(model.templateSaveNotes({ ...rascunho, kind: "popup" }, TUDO, null, { otherGoal: true }), []);
});

/* ------------------------------------------------------------------------------------------------
 * 16 a 18: ?tipo=, remapNodeRefs e o limite de modelos de onde o aviso veio
 * ---------------------------------------------------------------------------------------------- */

test("16. ?tipo=: os quatro valores, ida e volta; desconhecido dá null", () => {
  const casos = [
    ["notificacao", "inbox", { kind: "inbox", mode: null }, "Notificação"],
    ["popup", "popup", { kind: "popup", mode: null }, "Pop-up"],
    ["design-personalizado", "design_custom", { kind: "design", mode: "custom" }, "Design Personalizado"],
    ["design-livre", "design_free", { kind: "design", mode: "free" }, "Design Livre"]
  ];

  for (const [param, type, kind, label] of casos) {
    assert.equal(model.parseTemplateTypeParam(param), type);
    assert.equal(model.TEMPLATE_TYPE_PARAMS[type], param);
    assert.deepEqual(model.kindOfTemplateType(type), kind);
    assert.equal(model.templateTypeOf(kind.kind, kind.mode), type);
    assert.equal(model.templateTypeLabel(kind.kind, kind.mode), label);
  }

  assert.equal(model.templateTypeOf("popup", "free"), "popup", "o pop-up com design continua do tipo pop-up");

  for (const lixo of ["x", "", null, undefined, ["popup"], 3, "design_custom"]) {
    assert.equal(model.parseTemplateTypeParam(lixo), null, JSON.stringify(lixo));
  }

  assert.equal(model.TEMPLATES_HREF, "/admin/comunicacao/modelos");
});

test("17. remapNodeRefs mora em audience-model.ts e é a mesma função reexportada pelo cartão; troca os três tipos de regra", () => {
  assert.equal(followUpsView.remapNodeRefs, audienceModel.remapNodeRefs);

  const definicao = regras(
    { action: "opened", negate: false, ref: { kind: "node", nodeId: ENTRADA }, type: "message" },
    { action: "opened", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" },
    { items: [{ negate: false, page: { kind: "message_cta", nodeId: S1 }, since: { kind: "message", nodeId: ENTRADA }, type: "page_visit" }], match: "any" },
    { negate: false, productIds: [PRODUTO], since: { kind: "message", nodeId: S1 }, type: "access_gained" }
  );
  const ids = new Map([
    [ENTRADA, S2],
    [S1, S11]
  ]);
  const remapeado = audienceModel.remapNodeRefs(definicao, ids);

  assert.equal(remapeado.root.items[0].ref.nodeId, S2);
  assert.deepEqual(remapeado.root.items[1].ref, { campaignId: AVISO, kind: "campaign" }, "notificação de aviso não muda");
  assert.equal(remapeado.root.items[2].items[0].page.nodeId, S11);
  assert.equal(remapeado.root.items[2].items[0].since.nodeId, S2);
  assert.equal(remapeado.root.items[3].since.nodeId, S11);
  assert.deepEqual(audienceModel.remapNodeRefs(TODOS, ids), TODOS);
});

test("18. TEMPLATE_LIMITS.sourcesAccepted é o .max de saveNoticeSchema.fromTemplates: 20 passam (sem repetidos), 21 são recusados", () => {
  const draft = { ...schemas.emptyNoticeDraft("inbox"), title: "Oi" };
  const uuids = Array.from({ length: model.TEMPLATE_LIMITS.sourcesAccepted }, () => randomUUID());
  const comRepetidos = [...uuids.slice(0, 19), uuids[0].toUpperCase()];

  assert.equal(model.TEMPLATE_LIMITS.sourcesAccepted, 20);
  assert.deepEqual(schemas.saveNoticeSchema.parse({ draft, fromTemplates: uuids }).fromTemplates, uuids);
  assert.deepEqual(schemas.saveNoticeSchema.parse({ draft, fromTemplates: comRepetidos }).fromTemplates, uuids.slice(0, 19), "os repetidos saem");
  assert.deepEqual(problemas(schemas.saveNoticeSchema, { draft, fromTemplates: [...uuids, randomUUID()] }), [["fromTemplates", "Modelo inválido."]]);
  assert.deepEqual(problemas(schemas.saveNoticeSchema, { draft, fromTemplates: ["x"] }), [["fromTemplates.0", "Modelo inválido."]]);
  assert.equal(schemas.saveNoticeSchema.parse({ draft }).fromTemplates, undefined, "sem modelos, nada muda");

  // O mesmo numero no salvar do modelo.
  const base = { body: { design: custom.popupStarterDesign("text_only"), freeDesign: null, source: "design", support: { ctaLabel: null, image: null } }, name: "D", origin: "design_card" };
  assert.deepEqual(model.saveTemplateSchema.parse({ ...base, sourceTemplateIds: comRepetidos }).sourceTemplateIds, uuids.slice(0, 19));
  assert.ok(problemas(model.saveTemplateSchema, { ...base, sourceTemplateIds: [...uuids, randomUUID()] }).some(([path]) => path === "sourceTemplateIds"));
});

test("salvar: o design exige exatamente um dos dois; o update exige a versão lida", () => {
  const base = { name: "D", origin: "design_card" };
  const support = { ctaLabel: null, image: null };

  assert.deepEqual(problemas(model.saveTemplateSchema, { ...base, body: { design: null, freeDesign: null, source: "design", support } }), [["body.design", M.pickDesign]]);
  assert.deepEqual(
    problemas(model.saveTemplateSchema, { ...base, body: { design: custom.popupStarterDesign("text_only"), freeDesign: freeStarters.freeStarterDesign("blank"), source: "design", support } }),
    [["body.freeDesign", POPUP_FREE_MESSAGES.bothDesigns]]
  );
  assert.deepEqual(
    problemas(model.saveTemplateSchema, { ...base, body: { design: custom.popupStarterDesign("text_only"), freeDesign: null, source: "design", support }, id: randomUUID() }),
    [["expectedUpdatedAt", "Recarregue a página e tente de novo."]]
  );
  assert.deepEqual(problemas(model.templateNameSchema, "   "), [["", "Dê um nome ao modelo."]]);
  assert.deepEqual(problemas(model.templateNameSchema, "x".repeat(81)), [["", "Use até 80 caracteres."]]);
  assert.equal(model.templateNameSchema.parse("  Lançamento  "), "Lançamento");
});

test("v3b-2 (docs/29 §2.7): modelo de pop-up com 'No primeiro acesso' (e produtos) e com 'Ao concluir um curso' vai e volta igual; o de antes le igual; produtos fora do primeiro acesso somem", () => {
  const comPopup = (popup) => ({ ...schemas.emptyNoticeDraft("popup"), popup: { ...schemas.emptyNoticeDraft("popup").popup, ...popup }, title: "Boas-vindas" });
  const ida = (popup) => model.templatePayloadOfDraft({ draft: comPopup(popup), followUps: null, include: TUDO }).payload;

  const primeiro = ida({ accessProducts: ["formacao-ia", "curso-b", "curso-b"], trigger: "first_login" });
  assert.equal(primeiro.version, 1, "versao continua 1 (aditivo)");
  assert.equal(primeiro.settings.popup.trigger, "first_login");
  assert.deepEqual(primeiro.settings.popup.accessProducts, ["curso-b", "formacao-ia"], "canonico");
  const lidoPrimeiro = model.parseTemplatePayload("popup", JSON.parse(JSON.stringify(primeiro)));
  assert.deepEqual(lidoPrimeiro.notes, []);
  assert.deepEqual(lidoPrimeiro.payload.settings.popup, primeiro.settings.popup);

  const area = ida({ trigger: "first_login" });
  assert.deepEqual(area.settings.popup.accessProducts, [], "a primeira vez na area");

  const curso = ida({ pages: ["lesson:*"], trigger: "course_completed" });
  const lidoCurso = model.parseTemplatePayload("popup", JSON.parse(JSON.stringify(curso)));
  assert.deepEqual(lidoCurso.notes, []);
  assert.deepEqual(lidoCurso.payload.settings.popup, curso.settings.popup);
  assert.equal("accessProducts" in lidoCurso.payload.settings.popup, false);

  // Modelo de antes (sem a chave): le igual, byte a byte.
  const antes = ida({});
  assert.equal("accessProducts" in antes.settings.popup, false);
  const lidoAntes = model.parseTemplatePayload("popup", JSON.parse(JSON.stringify(antes)));
  assert.deepEqual(lidoAntes.notes, []);
  assert.equal(JSON.stringify(lidoAntes.payload.settings.popup), JSON.stringify(antes.settings.popup));

  // accessProducts gravado num modelo com page_load (ex.: editado a mao): some na leitura, sem nota.
  const sujo = JSON.parse(JSON.stringify(antes));
  sujo.settings.popup.accessProducts = ["formacao-ia"];
  const lidoSujo = model.parseTemplatePayload("popup", sujo);
  assert.deepEqual(lidoSujo.notes, []);
  assert.equal("accessProducts" in lidoSujo.payload.settings.popup, false);

  // A janela continua fora do modelo; o aviso criado a partir dele comeca sem Comeca nem Termina.
  const inicio = model.noticeStartOfTemplate({ id: AVISO, name: "Boas-vindas", payload: lidoPrimeiro.payload }, { newId: randomUUID });
  assert.deepEqual(inicio.draft.window, { endsAt: null, startsAt: null });
  assert.equal(inicio.draft.popup.trigger, "first_login");
  assert.deepEqual(inicio.draft.popup.accessProducts, ["curso-b", "formacao-ia"]);
});
