import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Contratos puros da Comunicacao v3a (docs/24 §4.1 e §5.3): catalogo de reacoes, a enquete (schema,
// leitura tolerante, voto valido, o que o aluno recebe), as regras novas do conteudo do aviso, o que trava
// depois do envio, o rascunho <-> colunas com os campos novos, os conteudos vazios dos editores (reacoes
// ligadas), a previa da enquete e os embrulhos das RPCs novas no store (banco falso).

const interactions = await import("../src/server/communications/interactions-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const flowSchemas = await import("../src/server/communications/flow-schemas.ts");
const store = await import("../src/server/communications/store.ts");
const flowStore = await import("../src/server/communications/flow-store.ts");
const noticesModel = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const followUps = await import("../src/components/admin/v2/communication/follow-ups-view-model.ts");
const flowsModel = await import("../src/components/admin/v2/communication/flows/flows-view-model.ts");
const templates = await import("../src/components/admin/v2/communication/flows/flow-templates-model.ts");

const HOUR = 3_600_000;
const now = Date.parse("2026-10-22T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sequence = () => {
  let n = 0;
  return () => id(++n);
};

const enquete = (extra = {}) => ({
  closesAt: null,
  multiple: false,
  options: [
    { id: "a1b2c3d4", label: "Sábado" },
    { id: "e5f6a7b8", label: "Domingo" }
  ],
  question: "Qual dia é melhor para a aula ao vivo?",
  showResults: true,
  ...extra
});

function problemas(schema, value) {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const notificacao = (extra = {}) => ({ ...schemas.emptyNoticeDraft("inbox"), body: "Texto", title: "Aula ao vivo", ...extra });
const popup = (extra = {}) => ({ ...schemas.emptyNoticeDraft("popup"), title: "Turma nova", ...extra });

/* ------------------------------------------------------------------------------------------------
 * Reacoes
 * ---------------------------------------------------------------------------------------------- */

test("reacoes: 6 ids fixos com emoji do sistema e nome; isReactionId so aceita o catalogo", () => {
  assert.deepEqual([...interactions.REACTION_IDS], ["like", "love", "fire", "clap", "laugh", "wow"]);
  assert.deepEqual(
    interactions.REACTION_IDS.map((reaction) => `${interactions.REACTION_EMOJI[reaction]} ${interactions.REACTION_LABELS[reaction]}`),
    ["👍 Gostei", "❤️ Amei", "🔥 Incrível", "👏 Aplausos", "😂 Haha", "😮 Uau"]
  );

  for (const reaction of interactions.REACTION_IDS) {
    assert.equal(interactions.isReactionId(reaction), true, reaction);
  }

  for (const invalid of ["LIKE", "heart", "", null, undefined, 1, {}, "like "]) {
    assert.equal(interactions.isReactionId(invalid), false, String(invalid));
  }
});

/* ------------------------------------------------------------------------------------------------
 * Enquete: schema, leitura, fim, voto, resultado
 * ---------------------------------------------------------------------------------------------- */

test("enquete: o schema aceita 2 a 6 opcoes, apara os textos e poe os padroes (uma resposta, resultado ligado, sem fim)", () => {
  const parsed = interactions.pollSchema.parse({
    options: [
      { id: "a1b2c3d4", label: "  Sábado " },
      { id: "e5f6a7b8", label: "Domingo" }
    ],
    question: "  Qual dia?  "
  });

  assert.deepEqual(parsed, {
    closesAt: null,
    multiple: false,
    options: [
      { id: "a1b2c3d4", label: "Sábado" },
      { id: "e5f6a7b8", label: "Domingo" }
    ],
    question: "Qual dia?",
    showResults: true
  });

  const seis = Array.from({ length: 6 }, (_, index) => ({ id: `op${index}`, label: `Opção ${index + 1}` }));
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: seis })), []);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [...seis, { id: "op9", label: "Sete" }] })), [["options", "Use no máximo 6 opções."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [seis[0]] })), [["options", "Use pelo menos 2 opções."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ question: "   " })), [["question", "Escreva a pergunta."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ question: "x".repeat(121) })), [["question", "Use até 120 caracteres."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ question: "x".repeat(120) })), []);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "a1", label: " " }, seis[1]] })), [["options.0.label", "Escreva a opção."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "a1", label: "y".repeat(61) }, seis[1]] })), [["options.0.label", "Use até 60 caracteres."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "a1", label: "y".repeat(60) }, seis[1]] })), []);
});

test("enquete: opcoes iguais (sem diferenca de maiuscula e de espaco) e ids invalidos ou repetidos sao recusados", () => {
  assert.deepEqual(
    problemas(interactions.pollSchema, enquete({ options: [{ id: "a1", label: "Sábado" }, { id: "b2", label: "  sábado " }] })),
    [["options.1.label", "As opções precisam ser diferentes."]]
  );
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "A1", label: "Sim" }, { id: "b2", label: "Não" }] })), [["options.0.id", "Opção inválida."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "a".repeat(13), label: "Sim" }, { id: "b2", label: "Não" }] })), [["options.0.id", "Opção inválida."]]);
  assert.deepEqual(problemas(interactions.pollSchema, enquete({ options: [{ id: "a1", label: "Sim" }, { id: "a1", label: "Não" }] })), [["options.1.id", "Opção inválida."]]);
  assert.equal(interactions.POLL_OPTION_ID.test("a1b2c3d4"), true);
  assert.deepEqual(interactions.POLL_LIMITS, { maxOptions: 6, minOptions: 2, option: 60, question: 120 });
});

test("enquete: o fim sai sempre em ISO canonico (toISOString), o formato que o banco exige; data que nao existe e recusada", () => {
  assert.equal(interactions.pollSchema.parse(enquete({ closesAt: "2026-10-25T18:00:00-03:00" })).closesAt, "2026-10-25T21:00:00.000Z");
  assert.equal(interactions.pollSchema.parse(enquete({ closesAt: "2026-10-25T21:00:00+00:00" })).closesAt, "2026-10-25T21:00:00.000Z");
  assert.equal(interactions.pollSchema.parse(enquete({ closesAt: "2026-10-25T21:00:00.000Z" })).closesAt, "2026-10-25T21:00:00.000Z");
  assert.match(interactions.pollSchema.parse(enquete({ closesAt: "2026-10-25T21:00:00.123456Z" })).closesAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(interactions.pollSchema.parse(enquete({ closesAt: null })).closesAt, null);

  // Ano com mais de 4 digitos ou negativo: o toISOString sai "+010000-..." / "-000001-...", que o check recusaria.
  for (const invalid of ["amanha", "", "2026-13-45T99:00:00Z", 12, "+010000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z"]) {
    assert.deepEqual(problemas(interactions.pollSchema, enquete({ closesAt: invalid })), [["closesAt", "Escolha data e hora."]], String(invalid));
  }
});

test("enquete: parsePoll le o jsonb sem confiar; qualquer formato fora do esperado vira null (sem enquete)", () => {
  assert.deepEqual(interactions.parsePoll(enquete()), enquete());
  assert.deepEqual(interactions.parsePoll({ ...enquete(), extra: 1, closesAt: undefined }), enquete(), "chave a mais sai; sem fim = null");

  const malformados = [
    null,
    undefined,
    "enquete",
    [],
    { ...enquete(), question: "" },
    { ...enquete(), question: 1 },
    { ...enquete(), multiple: "false" },
    { ...enquete(), showResults: null },
    { ...enquete(), options: "a,b" },
    { ...enquete(), options: [enquete().options[0]] },
    { ...enquete(), options: Array.from({ length: 7 }, (_, index) => ({ id: `o${index}`, label: "x" })) },
    { ...enquete(), options: [{ id: "A1", label: "Sim" }, enquete().options[1]] },
    { ...enquete(), options: [{ id: "a1", label: "" }, enquete().options[1]] },
    { ...enquete(), options: [{ id: "a1", label: 2 }, enquete().options[1]] },
    { ...enquete(), options: [null, enquete().options[1]] },
    { ...enquete(), options: [enquete().options[0], enquete().options[0]] },
    { ...enquete(), closesAt: "amanha" },
    { ...enquete(), closesAt: 123 }
  ];

  for (const value of malformados) {
    assert.equal(interactions.parsePoll(value), null, JSON.stringify(value));
  }
});

test("enquete: encerrada quando closesAt <= agora; sem fim, vale enquanto estiver no sino", () => {
  assert.equal(interactions.isPollClosed(enquete(), now), false);
  assert.equal(interactions.isPollClosed(enquete({ closesAt: iso(now) }), now), true, "no instante do fim ja encerrou");
  assert.equal(interactions.isPollClosed(enquete({ closesAt: iso(now - 1) }), now), true);
  assert.equal(interactions.isPollClosed(enquete({ closesAt: iso(now + 1) }), now), false);
});

test("voto: uma resposta, varias, repetido, desconhecido, vazio (tirar o voto) e mais de uma sem 'várias'", () => {
  const uma = enquete();
  const varias = enquete({ multiple: true, options: [...enquete().options, { id: "0c0c0c0c", label: "Segunda" }] });

  assert.deepEqual(interactions.normalizePollChoice(uma, ["e5f6a7b8"]), { choice: ["e5f6a7b8"], ok: true });
  assert.deepEqual(interactions.normalizePollChoice(uma, []), { choice: [], ok: true }, "vazio tira o voto");
  assert.deepEqual(interactions.normalizePollChoice(uma, ["a1b2c3d4", "a1b2c3d4"]), { choice: ["a1b2c3d4"], ok: true }, "repetido conta uma vez");
  assert.deepEqual(interactions.normalizePollChoice(uma, ["a1b2c3d4", "e5f6a7b8"]), { message: "Voto invalido.", ok: false }, "uma resposta so");
  assert.deepEqual(interactions.normalizePollChoice(uma, ["zzzz"]), { message: "Voto invalido.", ok: false }, "opcao que nao existe");
  assert.deepEqual(interactions.normalizePollChoice(uma, [1]), { message: "Voto invalido.", ok: false });
  assert.deepEqual(interactions.normalizePollChoice(uma, [null]), { message: "Voto invalido.", ok: false });
  assert.deepEqual(
    interactions.normalizePollChoice(varias, ["e5f6a7b8", "0c0c0c0c", "a1b2c3d4", "e5f6a7b8"]),
    { choice: ["0c0c0c0c", "a1b2c3d4", "e5f6a7b8"], ok: true },
    "varias: sem repeticao, na ordem do id (como o banco grava)"
  );
  assert.deepEqual(interactions.normalizePollChoice(varias, ["e5f6a7b8", "x9"]), { message: "Voto invalido.", ok: false });
});

test("o que o aluno recebe: resultado so com 'mostrar o resultado' e (votou ou encerrou) e com a contagem em maos", () => {
  const tally = { counts: { a1b2c3d4: 54, e5f6a7b8: 74, sumiu: 9 }, voters: 128 };
  const de = (poll, input) => interactions.notificationPollOf(poll, input).results;
  const resultado = { counts: { a1b2c3d4: 54, e5f6a7b8: 74 }, voters: 128 };

  // showResults x votou x encerrou
  assert.deepEqual(de(enquete(), { choice: ["a1b2c3d4"], closed: false, tally }), resultado, "votou: ve");
  assert.deepEqual(de(enquete(), { choice: [], closed: true, tally }), resultado, "encerrada: todos veem");
  assert.deepEqual(de(enquete(), { choice: ["a1b2c3d4"], closed: true, tally }), resultado);
  assert.equal(de(enquete(), { choice: [], closed: false, tally }), null, "nao votou e aberta: nao ve");
  assert.equal(de(enquete(), { choice: null, closed: false, tally }), null);
  assert.equal(de(enquete({ showResults: false }), { choice: ["a1b2c3d4"], closed: false, tally }), null, "a equipe nao deixou");
  assert.equal(de(enquete({ showResults: false }), { choice: [], closed: true, tally }), null);
  assert.equal(de(enquete(), { choice: ["a1b2c3d4"], closed: false, tally: null }), null, "sem contagem, sem resultado");

  const poll = interactions.notificationPollOf(enquete({ multiple: true }), { choice: ["e5f6a7b8", "x", "e5f6a7b8"], closed: false, tally: null });
  assert.deepEqual(poll, {
    choice: ["e5f6a7b8"],
    closed: false,
    closesAt: null,
    multiple: true,
    options: enquete().options,
    question: enquete().question,
    results: null,
    showResults: true
  });
  assert.deepEqual(interactions.notificationPollOf(enquete(), { choice: ["a1b2c3d4"], closed: false, tally: { counts: { a1b2c3d4: "3" }, voters: -1 } }).results, {
    counts: { a1b2c3d4: 3, e5f6a7b8: 0 },
    voters: 0
  });
  assert.deepEqual(interactions.pollTallyOf({ counts: { a1b2c3d4: 2 }, voters: 2 }), { counts: { a1b2c3d4: 2 }, voters: 2 });
  assert.equal(interactions.pollTallyOf(null), null);
  assert.equal(interactions.pollTallyOf({ voters: 2 }), null);
});

test("porcentagem: round(votos x 100 / quem votou); sem votos, 0", () => {
  assert.equal(interactions.pollPercent(54, 128), 42);
  assert.equal(interactions.pollPercent(1, 3), 33);
  assert.equal(interactions.pollPercent(2, 3), 67);
  assert.equal(interactions.pollPercent(1, 8), 13, "12,5 arredonda para cima");
  assert.equal(interactions.pollPercent(1, 1), 100);
  assert.equal(interactions.pollPercent(0, 10), 0);
  assert.equal(interactions.pollPercent(3, 0), 0);
  assert.equal(interactions.pollPercent(Number.NaN, 10), 0);
});

test("eventos por linha: gravam ate a 20a escrita que mudou algo", () => {
  assert.equal(interactions.INTERACTION_EVENTS_PER_ROW, 20);
  assert.equal(interactions.shouldRecordInteraction(0, true), true);
  assert.equal(interactions.shouldRecordInteraction(19, true), true);
  assert.equal(interactions.shouldRecordInteraction(20, true), false);
  assert.equal(interactions.shouldRecordInteraction(500, true), false);
  assert.equal(interactions.shouldRecordInteraction(0, false), false, "nada mudou: sem evento");
});

/* ------------------------------------------------------------------------------------------------
 * Conteudo do aviso: campos novos e o que nao convive
 * ---------------------------------------------------------------------------------------------- */

test("rascunho da v2 (sem display, reactions e poll) continua valendo: pelo botao, sem reacoes, sem enquete", () => {
  const v2 = {
    allowSnooze: true,
    audience: { kind: "everyone" },
    audio: null,
    body: "Texto",
    cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" },
    icon: null,
    image: null,
    kind: "inbox",
    repeat: "once",
    response: null,
    schedule: { mode: "now" },
    sender: null,
    title: "Aula nova",
    validity: { mode: "default" },
    window: { endsAt: null, startsAt: null }
  };
  const parsed = schemas.noticeDraftSchema.parse(v2);

  assert.equal(parsed.cta.display, "button");
  assert.equal(parsed.reactions, false);
  assert.equal(parsed.poll, null);

  const conteudo = schemas.noticeContentSchema.parse({ audio: null, body: "", cta: null, image: null, response: null, title: "Oi" });
  assert.equal(conteudo.reactions, false);
  assert.equal(conteudo.poll, null);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, { ...v2, cta: { ...v2.cta, display: "qualquer" } }), [["cta.display", "Escolha como o aluno chega lá."]]);
});

test("rascunho: enquete ou resposta (nunca as duas); no pop-up nada de enquete, reacoes nem cartao clicavel", () => {
  const resposta = { acceptLabel: "Vou", declineLabel: "Não vou" };
  const destino = (display) => ({ display, href: "/minhas-compras", label: "Ver", target: "same_tab" });

  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ poll: enquete() })), []);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ poll: enquete(), response: resposta })), [["poll", "Use a resposta ou a enquete, não as duas."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ cta: destino("card"), reactions: true })), []);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, notificacao({ cta: destino("button_and_card") })), []);

  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ poll: enquete() })), [["poll", "A enquete vale só para notificações por enquanto."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ reactions: true })), [["reactions", "Reações valem só para notificações."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ cta: destino("card") })), [["cta.display", "No pop-up, o destino abre pelo botão."]]);
  assert.deepEqual(problemas(schemas.noticeDraftSchema, popup({ cta: destino("button") })), []);
  assert.deepEqual(problemas(schemas.noticeContentSchema, { ...notificacao(), poll: enquete(), response: resposta }), [["poll", "Use a resposta ou a enquete, não as duas."]]);
});

test("seguinte e passo de fluxo: as mesmas recusas do conteudo, e a enquete so encerra quando sai do sino", () => {
  const base = { audio: null, body: "", cta: null, image: null, response: null, title: "Seguinte" };

  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, { ...base, poll: enquete() }), []);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, { ...base, poll: enquete(), response: { acceptLabel: "Sim", declineLabel: "Não" } }), [
    ["poll", "Use a resposta ou a enquete, não as duas."]
  ]);
  assert.deepEqual(problemas(flowSchemas.flowNoticeContentSchema, { ...base, poll: enquete({ closesAt: iso(now + 24 * HOUR) }) }), [
    ["poll.closesAt", "Numa notificação seguinte ou num passo de fluxo, a enquete encerra quando a notificação sair do sino."]
  ]);
  assert.equal(flowSchemas.FLOW_POLL_CLOSES_AT_MESSAGE, "Numa notificação seguinte ou num passo de fluxo, a enquete encerra quando a notificação sair do sino.");

  // A arvore que o motor confere sabe das reacoes e da enquete do passo.
  const { messages } = flowSchemas.flowTreeOfDraft({
    messages: { [id(2)]: { ...base, icon: null, poll: enquete(), reactions: true, sender: null, validity: { mode: "default" } } },
    nodes: [
      { branch: null, id: id(1), kind: "entry", parentId: null, position: 0 },
      { anchor: "previous", anchorNodeId: null, branch: null, filter: null, id: id(2), kind: "message", offsetMinutes: 0, parentId: id(1), position: 0 }
    ],
    origin: "builder"
  });
  assert.equal(messages[id(2)].allowsReactions, true);
  assert.equal(messages[id(2)].hasPoll, true);
  assert.deepEqual(messages[id(2)].pollOptionIds, ["a1b2c3d4", "e5f6a7b8"]);
});

test("na hora de publicar: a enquete com fim precisa terminar no futuro e depois do envio agendado", () => {
  const amanha = iso(now + 24 * HOUR);

  assert.deepEqual(schemas.publishProblems(notificacao({ poll: enquete({ closesAt: iso(now - HOUR) }) }), now), [{ message: "Escolha um fim no futuro.", path: "poll.closesAt" }]);
  assert.deepEqual(schemas.publishProblems(notificacao({ poll: enquete({ closesAt: iso(now) }) }), now), [{ message: "Escolha um fim no futuro.", path: "poll.closesAt" }]);
  assert.deepEqual(schemas.publishProblems(notificacao({ poll: enquete({ closesAt: amanha }) }), now), []);
  assert.deepEqual(schemas.publishProblems(notificacao({ poll: enquete() }), now), [], "sem fim: enquanto estiver no sino");
  assert.deepEqual(
    schemas.publishProblems(notificacao({ poll: enquete({ closesAt: iso(now + 2 * HOUR) }), schedule: { mode: "at", sendAt: iso(now + 3 * HOUR) } }), now),
    [{ message: "A enquete encerraria antes de a notificação sair.", path: "poll.closesAt" }]
  );
  assert.deepEqual(
    schemas.publishProblems(notificacao({ poll: enquete({ closesAt: iso(now + 3 * HOUR) }), schedule: { mode: "at", sendAt: iso(now + 3 * HOUR) } }), now),
    [{ message: "A enquete encerraria antes de a notificação sair.", path: "poll.closesAt" }],
    "no mesmo instante do envio tambem"
  );
  assert.deepEqual(schemas.publishProblems(notificacao({ poll: enquete({ closesAt: iso(now + 4 * HOUR) }), schedule: { mode: "at", sendAt: iso(now + 3 * HOUR) } }), now), []);
});

/* ------------------------------------------------------------------------------------------------
 * Notificacao enviada: o que trava
 * ---------------------------------------------------------------------------------------------- */

test("notificacao enviada: segmento, envio, tempo no sino, audio, ligar a resposta e enquete travam; o resto muda", () => {
  const audio = { durationSeconds: 30, mimeType: "audio/webm", peaks: [10, 20], url: "https://cdn.exemplo.test/a.webm" };
  const salva = notificacao({
    audience: { kind: "rules", root: { items: [{ op: "has", productIds: ["a", "b"], type: "product" }], match: "all" } },
    audio,
    cta: { display: "button", href: "/minhas-compras", label: "Ver", target: "same_tab" },
    poll: null,
    response: { acceptLabel: "Vou", declineLabel: "Não vou" },
    schedule: { mode: "at", sendAt: "2026-10-21T17:30:00.000Z" },
    validity: { minutes: 4_320, mode: "duration" }
  });
  const trava = (next) => schemas.sentNoticeLockedProblems(salva, { ...salva, ...next }).map((problem) => [problem.path, problem.message]);

  assert.deepEqual(trava({}), []);

  // O que pode mudar.
  for (const [field, value] of [
    ["title", "Título novo"],
    ["body", "Texto novo"],
    ["image", { alt: "Foto", url: "https://cdn.exemplo.test/b.webp" }],
    ["icon", { color: "amber", id: "clock" }],
    ["sender", { userId: id(9) }],
    ["cta", { display: "card", href: "https://exemplo.test/x", label: "Abrir", target: "new_tab" }],
    ["cta", null],
    ["response", { acceptLabel: "Sim", declineLabel: "Não" }],
    ["reactions", true],
    ["reactions", false]
  ]) {
    assert.deepEqual(trava({ [field]: value }), [], field);
  }

  // O mesmo instante escrito de outro jeito nao e mudanca.
  assert.deepEqual(trava({ schedule: { mode: "at", sendAt: "2026-10-21T17:30:00+00:00" } }), []);
  assert.deepEqual(trava({ schedule: { mode: "at", sendAt: "2026-10-21T14:30:00.000-03:00" } }), []);
  assert.deepEqual(
    trava({ audience: { kind: "rules", root: { items: [{ op: "has", productIds: ["b", "a", "a"], type: "product" }], match: "all" } } }),
    [],
    "segmento normalizado igual"
  );

  // O que trava, com a frase do campo.
  assert.deepEqual(trava({ audience: { kind: "everyone" } }), [["audience", "O segmento não muda depois do envio."]]);
  assert.deepEqual(trava({ schedule: { mode: "at", sendAt: "2026-10-21T17:31:00.000Z" } }), [["schedule.sendAt", "O envio e o tempo no sino não mudam depois do envio."]]);
  assert.deepEqual(trava({ schedule: { mode: "now" } }), [["schedule.sendAt", "O envio e o tempo no sino não mudam depois do envio."]]);
  assert.deepEqual(trava({ validity: { mode: "default" } }), [["validity", "O envio e o tempo no sino não mudam depois do envio."]]);
  assert.deepEqual(trava({ validity: { minutes: 60, mode: "duration" } }), [["validity", "O envio e o tempo no sino não mudam depois do envio."]]);
  assert.deepEqual(trava({ audio: null }), [["audio", schemas.SENT_LOCKED_MESSAGES.audio]]);
  assert.deepEqual(trava({ audio: { ...audio, url: "https://cdn.exemplo.test/b.webm" } }), [["audio", schemas.SENT_LOCKED_MESSAGES.audio]]);
  assert.deepEqual(trava({ audio: { ...audio, durationSeconds: 31 } }), [["audio", schemas.SENT_LOCKED_MESSAGES.audio]]);
  assert.deepEqual(trava({ response: null }), [["response", "Pedir uma resposta não muda depois do envio."]]);
  assert.deepEqual(trava({ poll: enquete(), response: null }).map(([path]) => path), ["response", "poll"]);
  assert.match(schemas.SENT_LOCKED_MESSAGES.audio, /^O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo\. Para trocar, duplique a notificação\.$/);
});

test("notificacao enviada com enquete: qualquer mudanca na enquete trava; o fim igual escrito de outro jeito nao", () => {
  const salva = notificacao({ poll: enquete({ closesAt: "2026-10-25T21:00:00.000Z" }) });
  const trava = (poll) => schemas.sentNoticeLockedProblems(salva, { ...salva, poll }).map((problem) => problem.path);

  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T18:00:00-03:00" })), []);
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T21:00:00.000Z", question: "  Qual dia é melhor para a aula ao vivo?  " })), [], "texto aparado igual");
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T22:00:00.000Z" })), ["poll"]);
  assert.deepEqual(trava(enquete({ closesAt: null })), ["poll"]);
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T21:00:00.000Z", multiple: true })), ["poll"]);
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T21:00:00.000Z", showResults: false })), ["poll"]);
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T21:00:00.000Z", question: "Outra?" })), ["poll"]);
  assert.deepEqual(trava(enquete({ closesAt: "2026-10-25T21:00:00.000Z", options: [enquete().options[0], { id: "e5f6a7b8", label: "Segunda" }] })), ["poll"]);
  assert.deepEqual(trava(null), ["poll"]);
});

/* ------------------------------------------------------------------------------------------------
 * Entradas novas (Server Actions e rotas do sino)
 * ---------------------------------------------------------------------------------------------- */

test("entradas: excluir com as seguintes por padrao, 'mostrar de novo' no salvar e os corpos das rotas do sino", () => {
  const aviso = id(5);

  assert.deepEqual(schemas.deleteNoticeSchema.parse({ id: aviso }), { alsoFollowUps: true, id: aviso });
  assert.equal(schemas.deleteNoticeSchema.parse({ alsoFollowUps: false, id: aviso }).alsoFollowUps, false);
  assert.equal(schemas.saveNoticeSchema.parse({ draft: notificacao(), reshow: true }).reshow, true);
  assert.equal(schemas.saveNoticeSchema.parse({ draft: notificacao() }).reshow, undefined);

  assert.deepEqual(schemas.reactionBodySchema.parse({ reaction: "love" }), { reaction: "love" });
  assert.deepEqual(schemas.reactionBodySchema.parse({ reaction: null }), { reaction: null });
  for (const body of [{ reaction: "heart" }, {}, null, "love", { reaction: 1 }]) {
    assert.deepEqual(problemas(schemas.reactionBodySchema, body).map(([, message]) => message), ["Reacao invalida."], JSON.stringify(body));
  }

  assert.deepEqual(schemas.pollVoteBodySchema.parse({ optionIds: ["a1b2c3d4"] }), { optionIds: ["a1b2c3d4"] });
  assert.deepEqual(schemas.pollVoteBodySchema.parse({ optionIds: [] }), { optionIds: [] });
  for (const body of [{ optionIds: ["A1"] }, { optionIds: Array.from({ length: 7 }, (_, index) => `o${index}`) }, { optionIds: "a1" }, {}, null]) {
    assert.deepEqual([...new Set(problemas(schemas.pollVoteBodySchema, body).map(([, message]) => message))], ["Voto invalido."], JSON.stringify(body));
  }

  assert.deepEqual(schemas.hideBodySchema.parse({ hidden: true }), { hidden: true });
  for (const body of [{ hidden: "true" }, {}, null]) {
    assert.deepEqual(problemas(schemas.hideBodySchema, body).map(([, message]) => message), ["Pedido invalido."], JSON.stringify(body));
  }
});

test("regra 'o que fez com a notificacao': choice opcional; com 'reagiu', so uma reacao do catalogo", () => {
  const regra = (extra) => ({
    kind: "rules",
    root: { items: [{ action: "reacted", negate: false, ref: { campaignId: id(7), kind: "campaign" }, type: "message", ...extra }], match: "all" }
  });

  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({})), []);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({ choice: "love" })), []);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({ choice: "heart" })), [["root.items.0.choice", "Escolha uma reação da lista."]]);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({ action: "voted", choice: "a1b2c3d4" })), []);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({ action: "voted", choice: "Sábado" })), [["root.items.0.choice", "Escolha uma opção."]]);
  assert.deepEqual(problemas(schemas.audienceDefinitionSchema, regra({ action: "hidden", negate: true })), []);
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho <-> colunas (store.ts)
 * ---------------------------------------------------------------------------------------------- */

function linhaDe(columns, extra = {}) {
  return {
    ...columns,
    approved_at: null,
    approved_by: null,
    audience_count: null,
    audience_counted_at: null,
    audience_refreshed_at: null,
    created_at: iso(now),
    created_by: id(1),
    deleted_at: null,
    deleted_by: null,
    dispatch_attempts: 0,
    dispatch_started_at: null,
    edited_at: null,
    edited_by: null,
    flow_id: null,
    flow_node_id: null,
    id: id(3),
    last_error: null,
    recipients_count: null,
    requested_at: null,
    requested_by: null,
    sent_at: null,
    status: "draft",
    updated_at: iso(now),
    updated_by: id(1),
    ...extra
  };
}

test("rascunho <-> colunas: como o aluno chega la, reacoes e enquete vao e voltam; o pop-up grava botao, sem reacoes e sem enquete", () => {
  const draft = notificacao({
    cta: { display: "card", href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" },
    poll: enquete({ closesAt: "2026-10-25T21:00:00.000Z" }),
    reactions: true
  });
  const columns = store.draftToColumns(draft);

  assert.equal(columns.cta_display, "card");
  assert.equal(columns.allow_reactions, true);
  assert.deepEqual(columns.poll, enquete({ closesAt: "2026-10-25T21:00:00.000Z" }));

  const back = store.rowToDraft(linhaDe(columns));
  assert.deepEqual(back.cta, draft.cta);
  assert.equal(back.reactions, true);
  assert.deepEqual(back.poll, draft.poll);

  const semDestino = store.draftToColumns(notificacao({ cta: null, reactions: false }));
  assert.equal(semDestino.cta_display, "button", "sem destino: o check exige button");
  assert.equal(semDestino.allow_reactions, false);
  assert.equal(semDestino.poll, null);

  const v2 = store.draftToColumns({ ...notificacao(), cta: { href: "/", label: "Ver", target: "same_tab" }, poll: undefined, reactions: undefined });
  assert.equal(v2.cta_display, "button");
  assert.equal(v2.allow_reactions, false);
  assert.equal(v2.poll, null);

  const doPopup = store.draftToColumns(popup({ cta: { display: "card", href: "/", label: "Ver", target: "same_tab" }, poll: enquete(), reactions: true }));
  assert.equal(doPopup.cta_display, "button");
  assert.equal(doPopup.allow_reactions, false);
  assert.equal(doPopup.poll, null);

  // Linha antiga (antes da 202610220001) ou com valores fora do formato.
  const antiga = store.rowToDraft(linhaDe(store.draftToColumns(notificacao({ cta: { href: "/", label: "Ver", target: "same_tab" } })), { allow_reactions: false, cta_display: "lixo", poll: { question: 1 } }));
  assert.equal(antiga.cta.display, "button");
  assert.equal(antiga.reactions, false);
  assert.equal(antiga.poll, null);
  assert.equal(store.rowToDraft(linhaDe(store.draftToColumns(popup()), { allow_reactions: true })).reactions, false, "pop-up nunca reage");
});

test("o que a notificacao enviada ainda muda e o passo de fluxo compara para criar versao nova", () => {
  assert.deepEqual(
    [...store.SENT_EDITABLE_COLUMNS],
    ["title", "body", "image_url", "image_alt", "icon", "icon_color", "sender_user_id", "cta_label", "cta_href", "cta_target", "cta_display", "accept_label", "decline_label", "allow_reactions", "allow_hide"]
  );

  const meta = flowStore.messageMetaOfRow(linhaDe(store.draftToColumns(notificacao({ poll: enquete(), reactions: true }))));
  assert.equal(meta.allowsReactions, true);
  assert.equal(meta.hasPoll, true);
  assert.deepEqual(meta.pollOptionIds, ["a1b2c3d4", "e5f6a7b8"]);

  const semNada = flowStore.messageMetaOfRow(linhaDe(store.draftToColumns(notificacao({ reactions: false })), { poll: { lixo: true } }));
  assert.equal(semNada.allowsReactions, false);
  assert.equal(semNada.hasPoll, false);
  assert.deepEqual(semNada.pollOptionIds, []);
});

/* ------------------------------------------------------------------------------------------------
 * Embrulhos das RPCs novas (banco falso)
 * ---------------------------------------------------------------------------------------------- */

test("store: numeros das interacoes por aviso e por passo; citacoes e 'mostrar de novo' leem o formato das RPCs", async () => {
  const db = createFakeDb({
    rpcResults: {
      communication_message_interactions: {
        data: [
          { item: "", metric: "reacted", scope: "campaign", scope_id: id(3), total: 5 },
          { item: "", metric: "poll_voters", scope: "campaign", scope_id: id(3), total: "4" },
          { item: "", metric: "hidden", scope: "campaign", scope_id: id(3), total: 1 },
          { item: "", metric: "response_changed", scope: "campaign", scope_id: id(3), total: 0 },
          { item: "", metric: "poll_changed", scope: "campaign", scope_id: id(3), total: 2 },
          { item: "love", metric: "reaction", scope: "campaign", scope_id: id(3), total: 3 },
          { item: "like", metric: "reaction", scope: "campaign", scope_id: id(3), total: 2 },
          { item: "heart", metric: "reaction", scope: "campaign", scope_id: id(3), total: 9 },
          { item: "a1b2c3d4", metric: "poll_option", scope: "campaign", scope_id: id(3), total: 3 },
          { item: "", metric: "reacted", scope: "node", scope_id: id(8), total: 1 }
        ],
        error: null
      },
      communication_notice_citations: { data: [{ campaign_id: id(3), flows: 1, notices: "2" }], error: null },
      communication_reshow_popup: { data: { count: 120, refused: false, reshown: 120 }, error: null }
    }
  });
  actionStubs.db = db;

  const interacoes = await store.fetchMessageInteractions(db, { campaignIds: [id(3), id(3)], flowId: id(6) });
  assert.deepEqual(interacoes.get(id(3)), {
    hidden: 1,
    pollChanged: 2,
    pollOptions: { a1b2c3d4: 3 },
    pollVoters: 4,
    reacted: 5,
    reactions: { like: 2, love: 3 },
    responseChanged: 0
  });
  assert.equal(interacoes.get(id(8)).reacted, 1, "passo do fluxo pela chave do passo");
  assert.deepEqual(db.calls.rpc.at(-1), { args: { p_campaign_ids: [id(3)], p_flow_id: id(6) }, name: "communication_message_interactions" });

  assert.deepEqual(await store.fetchNoticeCitations(db, [id(3)]), new Map([[id(3), { flows: 1, notices: 2 }]]));
  assert.deepEqual(await store.reshowPopupDeliveries(db, { apply: true, campaignId: id(3), max: 500, now: new Date(now) }), { count: 120, refused: false, reshown: 120 });
  assert.deepEqual(db.calls.rpc.at(-1), { args: { p_apply: true, p_campaign_id: id(3), p_max: 500, p_now: iso(now) }, name: "communication_reshow_popup" });

  const calls = db.calls.rpc.length;
  assert.equal((await store.fetchMessageInteractions(db, {})).size, 0);
  assert.equal((await store.fetchNoticeCitations(db, [])).size, 0);
  assert.equal(db.calls.rpc.length, calls, "lista vazia: nenhuma ida ao banco");

  const vazio = createFakeDb();
  assert.equal(await store.reshowPopupDeliveries(vazio, { apply: false, campaignId: id(3), max: null, now: new Date(now) }), null, "pop-up fora do ar: null");
});

/* ------------------------------------------------------------------------------------------------
 * Editores: conteudos vazios com reacoes, rascunho canonico, tipo e previa
 * ---------------------------------------------------------------------------------------------- */

test("conteudos vazios dos editores ja permitem reacoes e mantem isso pelo schema do fluxo", () => {
  const conteudos = [followUps.emptyFollowUpContent(), flowsModel.newMessageContent()];

  for (const template of templates.FLOW_TEMPLATES) {
    const draft = templates.buildFlowTemplate(template.id, sequence());
    conteudos.push(...Object.values(draft.messages));
  }

  assert.ok(conteudos.length >= 5, "as mensagens dos modelos foram lidas");

  for (const content of conteudos) {
    // O produto do botao do modelo ainda nao foi escolhido ("[escolha o produto]"): fora da conta aqui.
    const preenchido = { ...content, cta: content.cta?.href ? content.cta : null, title: content.title || "Título" };

    assert.equal(content.reactions, true, content.title);
    assert.equal(flowSchemas.flowNoticeContentSchema.parse(preenchido).reactions, true, content.title);
  }

  assert.equal(schemas.noticeDraftSchema.parse(notificacao()).reactions, true, "o aviso novo tambem");
});

test("rascunho canonico com display, reacoes e enquete; o pop-up deixa enquete e reacoes e abre pelo botao", () => {
  const base = notificacao({
    cta: { display: "button_and_card", href: "/minhas-compras", label: "Ver", target: "same_tab" },
    poll: enquete({ closesAt: "2026-10-25T18:00:00-03:00" }),
    reactions: true
  });
  const canonico = noticesModel.canonicalNoticeDraft(base);

  assert.equal(canonico.cta.display, "button_and_card");
  assert.equal(canonico.reactions, true);
  assert.equal(canonico.poll.closesAt, "2026-10-25T21:00:00.000Z");
  assert.equal(noticesModel.isSameNoticeDraft(base, { ...base, poll: enquete({ closesAt: "2026-10-25T21:00:00.000Z" }) }), true, "o mesmo fim");
  assert.equal(noticesModel.isSameNoticeDraft(base, { ...base, reactions: false }), false, "reacoes");
  assert.equal(noticesModel.isSameNoticeDraft(base, { ...base, cta: { ...base.cta, display: "card" } }), false, "como chega");
  assert.equal(noticesModel.isSameNoticeDraft(base, { ...base, poll: null }), false, "enquete");
  assert.equal(
    noticesModel.isSameNoticeDraft({ ...base, cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" } }, { ...base, cta: { display: "button", href: "/minhas-compras", label: "Ver", target: "same_tab" } }),
    true,
    "sem display = pelo botao"
  );
  assert.equal(noticesModel.isSameNoticeDraft({ ...base, poll: undefined, reactions: undefined }, { ...base, poll: null, reactions: false }), true, "rascunho antigo");

  const comoPopup = noticesModel.noticeDraftForKind({ ...base, kind: "popup" });
  assert.equal(comoPopup.reactions, false);
  assert.equal(comoPopup.poll, null);
  assert.equal(comoPopup.cta.display, "button");
  assert.deepEqual(problemas(schemas.noticeDraftSchema, comoPopup), []);
  assert.equal(noticesModel.canonicalNoticeDraft({ ...base, kind: "popup" }).poll, null);
  assert.equal(noticesModel.canonicalNoticeDraft({ ...base, kind: "popup" }).reactions, false);
  assert.equal(noticesModel.canonicalNoticeDraft({ ...base, kind: "popup" }).cta.display, "button");

  const deVolta = noticesModel.noticeDraftForKind(base);
  assert.equal(deVolta.reactions, true, "a notificacao guarda o que tem");
  assert.deepEqual(deVolta.poll, base.poll);
});

test("previa: como o aluno chega la, o botao de reagir e a enquete antes e depois do proprio voto", () => {
  const createdAt = iso(now);
  const draft = notificacao({
    cta: { display: "card", href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" },
    poll: enquete(),
    reactions: true
  });

  const antes = noticesModel.draftToNotificationItem(draft, { createdAt, pollPreview: "before" });
  assert.deepEqual(antes.cta, { display: "card", href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" });
  assert.deepEqual(antes.reactions, { value: null });
  assert.deepEqual(antes.poll.choice, []);
  assert.equal(antes.poll.results, null);
  assert.equal(antes.poll.closed, false);
  assert.deepEqual(noticesModel.draftToNotificationItem(draft, { createdAt }).poll, antes.poll, "sem as pilulas: antes do voto");

  const depois = noticesModel.draftToNotificationItem(draft, { createdAt, pollPreview: "after" });
  assert.deepEqual(depois.poll.choice, ["a1b2c3d4"]);
  assert.deepEqual(depois.poll.results, { counts: { a1b2c3d4: 1, e5f6a7b8: 0 }, voters: 1 }, "so o voto do proprio aluno: 1 voto, 100%");

  const semResultado = noticesModel.draftToNotificationItem({ ...draft, poll: enquete({ showResults: false }) }, { createdAt, pollPreview: "after" });
  assert.deepEqual(semResultado.poll.choice, ["a1b2c3d4"]);
  assert.equal(semResultado.poll.results, null, "a equipe nao deixou: so 'Seu voto foi registrado.'");

  const simples = noticesModel.draftToNotificationItem(notificacao({ cta: { href: "/", label: "Ver", target: "same_tab" }, reactions: false }), { createdAt });
  assert.equal(simples.cta.display, "button");
  assert.equal(simples.reactions, null);
  assert.equal(simples.poll, null);

  const doPopup = noticesModel.draftToNotificationItem({ ...draft, kind: "popup" }, { createdAt, pollPreview: "after" });
  assert.equal(doPopup.poll, null);
  assert.equal(doPopup.reactions, null);
  assert.equal(doPopup.cta.display, "button");
  assert.deepEqual(noticesModel.draftToPopupItem({ ...draft, kind: "popup" }).cta, { href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" }, "o pop-up mantem o formato da v1");
});

test("rotulos novos do menu e das regras", () => {
  assert.equal(noticesModel.NOTICE_ACTION_LABELS.view_report, "Ver relatório");
  assert.equal(noticesModel.NOTICE_ACTION_LABELS.reshow, "Mostrar de novo para quem já viu");
  assert.equal(noticesModel.MESSAGE_ACTION_LABELS.reacted, "reagiu");
  assert.equal(noticesModel.MESSAGE_ACTION_LABELS.voted, "votou na enquete");
  assert.equal(noticesModel.MESSAGE_ACTION_LABELS.hidden, "excluiu do sino");
  assert.equal(noticesModel.isNoticeKindLocked("sent"), true, "o tipo da enviada nao muda");
});
