import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// As regras puras do Assistente de IA e do modo hibrido (docs/30 §1.6, §2.4, §6.6 e D24; docs/18 §1.1): quando ele e
// chamado ("@assistente" sem diferenciar maiusculas, a aba Perguntas, o "Responder tudo" so para pergunta da turma) e
// quando cala (desligado, autor da equipe, assumida, "Falar com a equipe", ja respondida, limite do minuto por aluno e
// por sessao, sem conexao de IA), o MATERIAL (dados do webinario e do produto, perguntas cadastradas e as cues de 3 min
// antes a 30 s depois do segundo da pergunta, nunca acima do teto de caracteres), o prompt (nunca finge ser aluno nem
// equipe; sem a informacao, a frase de nao sei), o texto e o segundo da resposta, quem esta atendendo agora, a
// distribuicao (o de menos perguntas abertas, sem tirar de quem assumiu), a fila do Atendimento e o aviso do sino.

const modelo = await import("../src/server/webinars/assistant-model.ts");
const { ASSISTANT_LIMITS, CHAT_LIMITS } = await import("../src/server/webinars/model.ts");
const { ASSISTENTE_COPY } = await import("../src/lib/webinar-copy-v4/assistente.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const NOW = Date.parse("2026-11-05T23:10:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------------------------------------
 * Chamado
 * ---------------------------------------------------------------------------------------------- */

test("@assistente chama sem diferenciar maiusculas, como palavra (nem @assistentes nem e-mail)", () => {
  for (const body of ["@assistente quanto custa?", "Oi @Assistente, tudo bem?", "@ASSISTENTE", "pergunta pro @assistente.", "(@assistente) e o bonus?"]) {
    assert.equal(modelo.mentionsAssistant(body), true, body);
  }
  for (const body of ["assistente sem arroba", "@assistentes todos", "fale@assistente.com", "@assist", "", null]) {
    assert.equal(modelo.mentionsAssistant(body), false, String(body));
  }
  assert.equal(modelo.withoutMention("@Assistente, quanto custa?"), "quanto custa?");
  assert.equal(modelo.withoutMention("quanto custa @assistente?"), "quanto custa ?");
  assert.equal(modelo.assistantQuestionText("@assistente   e a garantia?"), "e a garantia?");
  assert.equal(modelo.assistantQuestionText("@assistente"), "@assistente", "so a mencao: vai o texto como veio");
});

test("quem chama: @assistente, a aba Perguntas, e o Responder tudo so para pergunta da turma (tipo pergunta ou com ?)", () => {
  const chat = (body, messageKind = "message") => ({ body, messageKind, origin: "chat" });
  assert.equal(modelo.assistantCallOf(chat("@assistente oi"), false), "mention");
  assert.equal(modelo.assistantCallOf({ body: "qual o prazo", messageKind: null, origin: "questions_tab" }, false), "question_tab");
  assert.equal(modelo.assistantCallOf(chat("que horas acaba?"), false), null, "sem Responder tudo, nao");
  assert.equal(modelo.assistantCallOf(chat("que horas acaba?"), true), "reply_all");
  assert.equal(modelo.assistantCallOf(chat("e o modulo dois", "question"), true), "reply_all");
  assert.equal(modelo.assistantCallOf(chat("boa noite turma"), true), null, "conversa nao e pergunta");
  assert.equal(modelo.assistantCallOf(chat("??"), true), null, "so sinal nao e pergunta");
  assert.equal(modelo.looksLikeQuestion("Tem certificado?"), true);
});

test("o pedido do chat: nada com o ambiente desligado, na mensagem que espera a equipe ou que nunca chamaria; a do tipo pergunta vira a pergunta da aba", () => {
  const base = { approved: true, body: "@assistente oi?", envEnabled: true, kind: "message", messageId: "m1", offsetMs: 600_000, questionId: null, recordingId: "g1", sessionId: "s1", userId: "u1", webinarId: "w1" };
  assert.deepEqual(modelo.chatAssistantTrigger(base), {
    body: "@assistente oi?",
    messageId: "m1",
    messageKind: "message",
    offsetMs: 600_000,
    origin: "chat",
    recordingId: "g1",
    sessionId: "s1",
    target: "chat",
    targetId: "m1",
    userId: "u1",
    webinarId: "w1"
  });
  assert.equal(modelo.chatAssistantTrigger({ ...base, envEnabled: false }), null);
  assert.equal(modelo.chatAssistantTrigger({ ...base, approved: false }), null, "chat moderado: espera a equipe");
  assert.equal(modelo.chatAssistantTrigger({ ...base, body: "boa noite" }), null);
  const pergunta = modelo.chatAssistantTrigger({ ...base, body: "e o bonus", kind: "question", questionId: "q1" });
  assert.equal(pergunta.target, "question");
  assert.equal(pergunta.targetId, "q1");
  assert.equal(pergunta.messageId, "m1");
  assert.equal(modelo.questionAssistantTrigger({ body: "x", envEnabled: false, offsetMs: 0, questionId: "q", recordingId: null, sessionId: "s", userId: "u", webinarId: "w" }), null);
  assert.equal(modelo.questionAssistantTrigger({ body: "x", envEnabled: true, offsetMs: 0, questionId: "q", recordingId: null, sessionId: "s", userId: "u", webinarId: "w" }).origin, "questions_tab");
});

/* ------------------------------------------------------------------------------------------------
 * Cala
 * ---------------------------------------------------------------------------------------------- */

test("quando cala, na ordem: desligado, nao chamado (ou equipe), Falar com a equipe, assumida ou ja respondida, limite do minuto, sem IA", () => {
  const ok = { aiAvailable: true, authorIsStaff: false, call: "mention", envEnabled: true, marks: null, recentBySession: 1, recentByStudent: 1, settingsEnabled: true, targetOpen: true };
  const reason = (patch) => {
    const decision = modelo.assistantDecision({ ...ok, ...patch });
    return decision.answer ? "answer" : decision.reason;
  };
  assert.equal(reason({}), "answer");
  assert.equal(reason({ envEnabled: false }), "disabled");
  assert.equal(reason({ settingsEnabled: false }), "disabled");
  assert.equal(reason({ authorIsStaff: true }), "not_called");
  assert.equal(reason({ call: null }), "not_called");
  assert.equal(reason({ marks: { assignedTo: "equipe", handoffRequestedAt: null } }), "claimed");
  assert.equal(reason({ marks: { assignedTo: "equipe", handoffRequestedAt: iso(NOW) } }), "handoff", "Falar com a equipe vence");
  assert.equal(reason({ targetOpen: false }), "claimed", "respondida, dispensada ou apagada");
  assert.equal(reason({ recentByStudent: ASSISTANT_LIMITS.perStudentPerMinute }), "answer", "o limite conta este pedido");
  assert.equal(reason({ recentByStudent: ASSISTANT_LIMITS.perStudentPerMinute + 1 }), "rate_limited");
  assert.equal(reason({ recentBySession: ASSISTANT_LIMITS.perSessionPerMinute + 1 }), "rate_limited");
  assert.equal(reason({ aiAvailable: false }), "unconfigured");
  assert.equal(reason({ aiAvailable: false, marks: { assignedTo: "x", handoffRequestedAt: null } }), "claimed", "assumida antes de olhar a IA");
  assert.equal(modelo.attendanceBlock(null, true), null);
});

/* ------------------------------------------------------------------------------------------------
 * O MATERIAL e o prompt
 * ---------------------------------------------------------------------------------------------- */

const cues = [
  { endSeconds: 5, startSeconds: 0, text: "Bem-vindos." },
  { endSeconds: 418, startSeconds: 410, text: "Logo antes da janela." },
  { endSeconds: 430, startSeconds: 421, text: "Entra pelo fim (termina depois de 420 s)." },
  { endSeconds: 610, startSeconds: 598, text: "A memoria guarda o que o agente ja fez." },
  { endSeconds: 632, startSeconds: 629, text: "Entra: ate 30 s depois." },
  { endSeconds: 640, startSeconds: 631, text: "Fica fora: mais de 30 s depois." }
];

test("o MATERIAL: webinario, produto, perguntas cadastradas e as cues de 3 min antes a 30 s depois do segundo da pergunta, em ordem", () => {
  const around = modelo.cuesAround(cues, 600_000).map((cue) => cue.text);
  assert.deepEqual(around, ["Entra pelo fim (termina depois de 420 s).", "A memoria guarda o que o agente ja fez.", "Entra: ate 30 s depois."]);
  assert.deepEqual(modelo.cuesAround(cues, null), []);

  const context = modelo.buildAssistantContext({
    cues,
    description: "Uma live sobre agentes.",
    knowledge: [{ answer: "R$ 997.", question: "Quanto custa?" }],
    offsetMs: 600_000,
    productName: "Formacao em Agentes",
    title: "Live de agentes"
  });
  assert.match(context, /Webinario: Live de agentes/);
  assert.match(context, /Produto: Formacao em Agentes/);
  assert.match(context, /Sobre: Uma live sobre agentes\./);
  assert.match(context, /P: Quanto custa\?\nR: R\$ 997\./);
  assert.match(context, /\[09:58\] A memoria guarda/);
  assert.doesNotMatch(context, /Bem-vindos|Logo antes|Fica fora/);
  assert.ok(context.indexOf("[07:01]") < context.indexOf("[09:58]"), "as cues em ordem de tempo");
});

test("o MATERIAL nunca passa do teto de caracteres e, apertado, fica com as cues mais perto do segundo da pergunta", () => {
  const muitas = Array.from({ length: 400 }, (_, index) => ({ answer: `Resposta ${index} `.repeat(30), question: `Pergunta numero ${index}?` }));
  const cuesDensas = Array.from({ length: 210 }, (_, index) => ({ endSeconds: 420 + index + 1, startSeconds: 420 + index, text: `fala do segundo ${420 + index} `.repeat(4) }));
  const grande = modelo.buildAssistantContext({ cues: cuesDensas, description: "x".repeat(5000), knowledge: muitas, offsetMs: 600_000, productName: "P", title: "T" });
  assert.ok(grande.length <= ASSISTANT_LIMITS.contextMaxCharacters, `${grande.length}`);
  assert.match(grande, /O QUE O VIDEO DIZ/, "o video sempre ganha espaco quando ha trecho");
  assert.match(grande, /PERGUNTAS E RESPOSTAS/);

  const apertado = modelo.buildAssistantContext({ cues: cuesDensas, description: null, knowledge: [], maxCharacters: 700, offsetMs: 600_000, productName: null, title: "T" });
  assert.ok(apertado.length <= 700);
  assert.match(apertado, /fala do segundo 600 /, "a cue do segundo da pergunta fica");
  assert.doesNotMatch(apertado, /fala do segundo 421 /, "a mais longe sai primeiro");
});

test("o prompt: responde curto como Assistente, nunca finge ser aluno nem equipe, nao inventa e usa a frase de nao sei", () => {
  const prompt = modelo.assistantSystemPrompt("MATERIAL DE TESTE");
  assert.match(prompt, /Voce e o Assistente/);
  assert.match(prompt, /nunca diga nem finja ser aluno, apresentador ou alguem da equipe/);
  assert.match(prompt, /Nao use conhecimento externo/);
  assert.match(prompt, /Nunca invente/);
  assert.ok(prompt.includes(WEBINAR_COPY.assistente.naoSei));
  assert.ok(prompt.endsWith("MATERIAL:\nMATERIAL DE TESTE"));
});

test("o texto da resposta (sem enfeite, ate o limite do chat; vazio vira nulo) e o segundo dela no video", () => {
  assert.equal(modelo.assistantReplyBody("  **Custa** R$ 997.\n\n\n\nAte mais. "), "Custa R$ 997.\n\nAte mais.");
  assert.equal(modelo.assistantReplyBody("   "), null);
  assert.equal(modelo.assistantReplyBody(null), null);
  const longa = modelo.assistantReplyBody("a".repeat(5000));
  assert.equal(longa.length, Math.min(CHAT_LIMITS.body, CHAT_LIMITS.answer));
  assert.ok(longa.endsWith("…"));

  assert.equal(modelo.assistantReplyOffsetMs({ kind: "replay", serverOffsetMs: 999_999, targetOffsetMs: 12_000 }), 12_000, "no replay, o da pergunta");
  assert.equal(modelo.assistantReplyOffsetMs({ kind: "simulated", serverOffsetMs: 605_400.6, targetOffsetMs: 600_000 }), 605_401);
  assert.equal(modelo.assistantReplyOffsetMs({ kind: "live", serverOffsetMs: 590_000, targetOffsetMs: 600_000 }), 600_000, "nunca antes da pergunta");
  assert.equal(modelo.assistantReplyOffsetMs({ kind: "simulated", serverOffsetMs: Number.NaN, targetOffsetMs: 7 }), 7);
  assert.equal(modelo.assistantReplyOffsetMs({ kind: "simulated", serverOffsetMs: 1e12, targetOffsetMs: 0 }), CHAT_LIMITS.offsetMaxMs);
});

/* ------------------------------------------------------------------------------------------------
 * Atendentes, distribuicao e fila
 * ---------------------------------------------------------------------------------------------- */

const atendente = (userId, segundosAtras, status = "online") => ({ lastSeenAt: iso(NOW - segundosAtras * 1000), sessionId: "s1", status, userId });

test("atendendo agora: online e com batida nos ultimos 90 s (compara instantes, '+00:00' ou 'Z')", () => {
  assert.equal(modelo.attendantIsOnline(atendente("a", 10), NOW), true);
  assert.equal(modelo.attendantIsOnline(atendente("a", ASSISTANT_LIMITS.attendantOnlineSeconds), NOW), true);
  assert.equal(modelo.attendantIsOnline(atendente("a", ASSISTANT_LIMITS.attendantOnlineSeconds + 1), NOW), false);
  assert.equal(modelo.attendantIsOnline(atendente("a", 10, "away"), NOW), false);
  assert.equal(modelo.attendantIsOnline({ lastSeenAt: "2026-11-05T23:09:30+00:00", status: "online" }, NOW), true, "o PostgREST devolve +00:00");
});

test("distribuicao: rodizio pelo de menos perguntas abertas, sem tirar de quem assumiu, so entre quem esta online, e nunca a que o Assistente esta respondendo", () => {
  const attendants = [atendente("ana", 5), atendente("bia", 5), atendente("caio", 300)];
  const items = [
    { assignedTo: "ana", createdAt: iso(NOW - 50_000), id: "q0", target: "question" },
    { assignedTo: null, createdAt: iso(NOW - 40_000), id: "q1", target: "question" },
    { assignedTo: null, createdAt: iso(NOW - 30_000), id: "m1", target: "chat" },
    { assignedTo: null, createdAt: iso(NOW - 20_000), id: "q2", target: "question" },
    { assignedTo: null, createdAt: iso(NOW - 10_000), distributable: false, id: "q3", target: "question" }
  ];
  assert.deepEqual(modelo.distributeQueue({ attendants, items, nowMs: NOW }), [
    { id: "q1", target: "question", userId: "bia" },
    { id: "m1", target: "chat", userId: "ana" },
    { id: "q2", target: "question", userId: "bia" }
  ]);
  assert.deepEqual(modelo.distributeQueue({ attendants: [atendente("caio", 300)], items, nowMs: NOW }), [], "ninguem online: ninguem recebe");
});

test("a fila do Atendimento: abertas da aba, respondidas pelo Assistente com Falar com a equipe, e do chat as que chamaram sem resposta, pediram a equipe ou sao pergunta sem a linha da aba", () => {
  const marca = (patch = {}) => ({ answerSource: null, assignedAt: null, assignedTo: null, handoffRequestedAt: null, ...patch });
  const question = (id, status, extra = {}) => ({ anonymous: false, body: `pergunta ${id}`, createdAt: iso(NOW - 60_000), displayName: "Ana S.", id, messageId: null, status, ...extra });
  const message = (id, body, extra = {}) => ({ approved: true, body, createdAt: iso(NOW - 30_000), displayName: "Bia C.", id, kind: "message", replyToId: null, role: "student", source: "audience", ...extra });
  const queue = modelo.attendanceQueueOf({
    aiRequests: [
      { status: "answered", targetId: "q-ia", targetKind: "question" },
      { status: "answered", targetId: "m-ia", targetKind: "chat" },
      { status: "failed", targetId: "m-falhou", targetKind: "chat" },
      { status: "answered", targetId: "m-ia-equipe", targetKind: "chat" }
    ],
    marks: {
      messages: new Map([["m-ia-equipe", marca({ handoffRequestedAt: iso(NOW) })]]),
      questions: new Map([
        ["q-ia", marca({ answerSource: "ai", handoffRequestedAt: iso(NOW - 1000) })],
        ["q-equipe", marca({ answerSource: "team" })],
        ["q-assumida", marca({ assignedTo: "bia" })]
      ])
    },
    messages: [
      message("m-ia", "@assistente oi?"),
      message("m-falhou", "@assistente cade?"),
      message("m-ia-equipe", "@assistente nao entendi"),
      message("m-respondida", "@assistente e ai?"),
      message("r1", "respondi", { replyToId: "m-respondida", role: "team", source: "team" }),
      message("m-comum", "boa noite"),
      message("m-pergunta", "tem bonus", { kind: "question" }),
      message("m-ligada", "e o prazo", { kind: "question" }),
      message("m-pendente", "@assistente moderada", { approved: false })
    ],
    questions: [
      question("q-aberta", "open"),
      question("q-assumida", "open"),
      question("q-ia", "answered"),
      question("q-equipe", "answered"),
      question("q-dispensada", "dismissed"),
      question("q-do-chat", "open", { messageId: "m-ligada" })
    ]
  });
  assert.deepEqual(
    queue.map((item) => [item.target, item.id]),
    [
      ["question", "q-ia"],
      ["chat", "m-ia-equipe"],
      ["question", "q-aberta"],
      ["question", "q-assumida"],
      ["question", "q-do-chat"],
      ["chat", "m-falhou"],
      ["chat", "m-pergunta"]
    ],
    "Pediu a equipe primeiro, depois a mais antiga"
  );
  const assumida = queue.find((item) => item.id === "q-assumida");
  assert.equal(assumida.assignedTo, "bia");
  assert.equal(queue.find((item) => item.id === "q-ia").answerSource, "ai");
  assert.equal(queue.find((item) => item.id === "m-falhou").aiStatus, "failed");
  assert.deepEqual([...modelo.openCountByAttendant(queue)], [["bia", 1]]);
});

test("o sino da resposta da equipe: quando o aluno pediu a equipe, a sessao ja nao esta no ar ou ele saiu da sala", () => {
  assert.equal(modelo.teamAnswerNeedsNotice({ handoffRequested: false, sessionRunning: true, studentPresent: true }), false);
  assert.equal(modelo.teamAnswerNeedsNotice({ handoffRequested: true, sessionRunning: true, studentPresent: true }), true);
  assert.equal(modelo.teamAnswerNeedsNotice({ handoffRequested: false, sessionRunning: false, studentPresent: true }), true);
  assert.equal(modelo.teamAnswerNeedsNotice({ handoffRequested: false, sessionRunning: true, studentPresent: false }), true);
});

test("a sala: as respostas do Assistente as mensagens do proprio aluno e o aviso do limite do minuto", () => {
  const replies = modelo.assistantRepliesToMe([
    { id: "m1", mine: true, replyToId: null, role: "student" },
    { id: "m2", mine: false, replyToId: null, role: "student" },
    { id: "a1", mine: false, replyToId: "m1", role: "ai" },
    { id: "a2", mine: false, replyToId: "m2", role: "ai" },
    { id: "t1", mine: false, replyToId: "m1", role: "team" }
  ]);
  assert.deepEqual([...replies], [["a1", "m1"]]);
  assert.equal(modelo.studentAtAssistantLimit([NOW - 61_000, NOW - 10_000], NOW), false);
  assert.equal(modelo.studentAtAssistantLimit([NOW - 30_000, NOW - 10_000], NOW), true);
  assert.equal(modelo.ASSISTANT_DISPLAY_NAME, "Assistente");
});

test("as frases do Assistente passam pela lista PROIBIDAS_WEBINARIO e moram em WEBINAR_COPY.assistente", () => {
  assert.equal(WEBINAR_COPY.assistente, ASSISTENTE_COPY);
  const textos = [];
  const coletar = (valor) => {
    if (typeof valor === "string") textos.push(valor);
    else if (typeof valor === "function") textos.push(String(valor("Live", 2)));
    else if (valor && typeof valor === "object") Object.values(valor).forEach(coletar);
  };
  coletar(ASSISTENTE_COPY);
  assert.ok(textos.length > 60);
  for (const texto of textos) {
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
});

test("o filtro da resposta: link, dominio, e-mail e valor fora do MATERIAL nunca entram; o valor do MATERIAL entra; a troca e pela frase de nao sei", () => {
  const material = "PERGUNTAS E RESPOSTAS DA EQUIPE\nP: Quanto custa?\nR: O preco e R$ 997 a vista ou 12 x de R$ 99,70. Desconto de 10% no pix.";
  const risco = (texto) => modelo.assistantReplyRisk(texto, material);
  assert.equal(risco("Cupom 90% só hoje em https://golpe.example até 23h"), "link");
  assert.equal(risco("Acesse www.golpe.net agora."), "link");
  assert.equal(risco("Pague em pagar.golpe.com.br e pronto."), "link");
  assert.equal(risco("Veja golpe.example/promo"), "link");
  assert.equal(risco("Mande para financeiro@golpe.example"), "email");
  assert.equal(risco("Hoje sai por R$ 47."), "amount");
  assert.equal(risco("Tem 90% de desconto."), "amount");
  assert.equal(risco("Custa US$ 200."), "amount");
  assert.equal(risco("Custa R$ 997 a vista ou 12 x de R$ 99,70."), null, "o preco cadastrado pela equipe passa");
  assert.equal(risco("No pix tem 10% de desconto."), null);
  assert.equal(risco("A memoria guarda o que o agente ja fez em 3 passos."), null, "numero sem moeda nao e valor");
  assert.equal(risco("Use Node.js e Next.js no projeto."), null, "nome de tecnologia nao e link");
  assert.deepEqual(modelo.safeAssistantReply("Hoje sai por R$ 47.", material), { body: WEBINAR_COPY.assistente.naoSei, risk: "amount" });
  assert.deepEqual(modelo.safeAssistantReply("Custa R$ 997 a vista.", material), { body: "Custa R$ 997 a vista.", risk: null });
});

test("o modo do chat decide onde a resposta entra: aberto publica, moderado vai para a equipe, fechado e so da equipe calam", () => {
  assert.equal(modelo.assistantPublishMode("open"), "publish");
  assert.equal(modelo.assistantPublishMode("moderated"), "moderate");
  assert.equal(modelo.assistantPublishMode("team_only"), "silent");
  assert.equal(modelo.assistantPublishMode("off"), "silent");
});

test("o teto de custo: o diario da primeira conexao por aluno; o mensal tira o provedor que gastou o mes; sem limite, nada barra", () => {
  const openai = { dailyQuestionLimit: 2, monthlyQuestionLimit: 100, provider: "openai" };
  const anthropic = { dailyQuestionLimit: 50, monthlyQuestionLimit: 10, provider: "anthropic" };
  assert.deepEqual(modelo.assistantQuotaDecision({ candidates: [openai], dailyUsed: 2, monthlyUsed: new Map() }), { allowed: [], reason: "daily" }, "a terceira do dia");
  assert.deepEqual(modelo.assistantQuotaDecision({ candidates: [openai], dailyUsed: 1, monthlyUsed: new Map() }).reason, null);
  assert.deepEqual(modelo.assistantQuotaDecision({ candidates: [openai, anthropic], dailyUsed: 0, monthlyUsed: new Map([["openai", 100]]) }).allowed, [anthropic], "troca de provedor");
  assert.deepEqual(modelo.assistantQuotaDecision({ candidates: [openai, anthropic], dailyUsed: 0, monthlyUsed: new Map([["openai", 100], ["anthropic", 10]]) }), { allowed: [], reason: "monthly" });
  assert.deepEqual(modelo.assistantQuotaDecision({ candidates: [{ provider: "openai" }], dailyUsed: 10_000, monthlyUsed: new Map([["openai", 10_000]]) }).reason, null, "sem limite configurado");
});
