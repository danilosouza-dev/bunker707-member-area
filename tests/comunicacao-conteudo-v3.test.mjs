import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Conteudo novo da Comunicacao v3a no admin (docs/24 §2.5 e §2.6): a previa com o modo de chegar ao
// destino, as reacoes e a enquete antes e depois do voto (so o voto do proprio aluno), os textos de "Para
// onde leva" por modo, os ajudantes dos campos da enquete (adicionar, remover, ids fixos, limites), os
// numeros do relatorio (reacoes, enquete, "Mudaram de resposta", "Excluíram do sino") e a conferencia
// do vocabulario das telas novas.

const model = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const interactions = await import("../src/server/communications/interactions-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");

const now = Date.parse("2026-10-22T15:00:00.000Z");
const createdAt = new Date(now - 30_000).toISOString();

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

const conteudo = (extra = {}) => ({
  audio: null,
  body: "A aula de sábado já está no ar.",
  cta: { display: "button", href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" },
  icon: null,
  image: null,
  kind: "inbox",
  poll: null,
  reactions: true,
  response: null,
  title: "Aula nova",
  ...extra
});

/** Gerador previsivel (de uuid ou de id de opcao): cada chamada devolve o proximo da lista. */
function sequence(...values) {
  let index = 0;

  return () => values[index++ % values.length];
}

/* ------------------------------------------------------------------------------------------------
 * Previa
 * ---------------------------------------------------------------------------------------------- */

test("previa: o modo de chegar ao destino vai para o cartao; pop-up e rascunho antigo ficam no botao", () => {
  for (const display of ["button", "button_and_card", "card"]) {
    const item = model.draftToNotificationItem(conteudo({ cta: { display, href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" } }), { createdAt });
    assert.equal(item.cta?.display, display);
  }

  // Rascunho da v2 sem `display`.
  const antigo = model.draftToNotificationItem(conteudo({ cta: { href: "/minhas-compras", label: "Assistir", target: "same_tab" } }), { createdAt });
  assert.equal(antigo.cta?.display, "button");

  // O pop-up guarda o formato da v1 (sem `display`).
  const popup = model.draftToPopupItem({ ...conteudo({ kind: "popup" }), allowSnooze: true });
  assert.deepEqual(popup.cta, { href: "/minhas-compras", label: "Ver a aula nova", target: "same_tab" });
});

test("previa: reacoes so com a chave ligada e sem reacao escolhida; nunca no pop-up", () => {
  assert.deepEqual(model.draftToNotificationItem(conteudo({ reactions: true }), { createdAt }).reactions, { value: null });
  assert.equal(model.draftToNotificationItem(conteudo({ reactions: false }), { createdAt }).reactions, null);
  assert.equal(model.draftToNotificationItem(conteudo({ reactions: undefined }), { createdAt }).reactions, null);
  assert.equal(model.draftToNotificationItem(conteudo({ kind: "popup", reactions: true }), { createdAt }).reactions, null);
});

test("previa: enquete antes do voto, sem resultado e sem voto", () => {
  const item = model.draftToNotificationItem(conteudo({ poll: enquete() }), { createdAt, pollPreview: "before" });

  assert.deepEqual(item.poll?.choice, []);
  assert.equal(item.poll?.results, null);
  assert.equal(item.poll?.closed, false);
  assert.equal(item.poll?.question, "Qual dia é melhor para a aula ao vivo?");
  assert.deepEqual(
    item.poll?.options.map((option) => option.id),
    ["a1b2c3d4", "e5f6a7b8"]
  );

  // Sem escolher as pilulas: como antes do voto.
  assert.deepEqual(model.draftToNotificationItem(conteudo({ poll: enquete() }), { createdAt }).poll, item.poll);
});

test("previa: depois de votar, so o voto do proprio aluno na primeira opcao (1 voto, 100%)", () => {
  const item = model.draftToNotificationItem(conteudo({ poll: enquete() }), { createdAt, pollPreview: "after" });

  assert.deepEqual(item.poll?.choice, ["a1b2c3d4"]);
  assert.deepEqual(item.poll?.results, { counts: { a1b2c3d4: 1, e5f6a7b8: 0 }, voters: 1 });
  assert.equal(interactions.pollPercent(item.poll.results.counts.a1b2c3d4, item.poll.results.voters), 100);

  // Sem "Mostrar o resultado": marcou o voto, mas nenhum numero.
  const semResultado = model.draftToNotificationItem(conteudo({ poll: enquete({ showResults: false }) }), { createdAt, pollPreview: "after" });
  assert.deepEqual(semResultado.poll?.choice, ["a1b2c3d4"]);
  assert.equal(semResultado.poll?.results, null);

  // Pop-up nao tem enquete na v3a.
  assert.equal(model.draftToNotificationItem(conteudo({ kind: "popup", poll: enquete() }), { createdAt, pollPreview: "after" }).poll, null);
});

test("previa: pilulas 'Enquete na prévia' so na notificacao com enquete", () => {
  assert.deepEqual(model.PREVIEW_POLL_OPTIONS, [
    { label: "Antes de votar", value: "before" },
    { label: "Depois de votar", value: "after" }
  ]);
  assert.equal(model.hasPreviewPoll({ kind: "inbox", poll: enquete() }), true);
  assert.equal(model.hasPreviewPoll({ kind: "inbox", poll: null }), false);
  assert.equal(model.hasPreviewPoll({ kind: "inbox" }), false);
  assert.equal(model.hasPreviewPoll({ kind: "popup", poll: enquete() }), false);
});

/* ------------------------------------------------------------------------------------------------
 * "Para onde leva"
 * ---------------------------------------------------------------------------------------------- */

test("Para onde leva: bloco, chave e as tres pilulas de 'Como o aluno chega lá'", () => {
  assert.equal(model.CTA_FIELD_COPY.blockTitle, "Para onde leva");
  assert.equal(model.CTA_FIELD_COPY.blockDescription, "Um produto, uma página da área ou um site.");
  assert.equal(model.CTA_FIELD_COPY.switchLabel, "Levar o aluno a algum lugar");
  assert.equal(model.CTA_FIELD_COPY.displayLabel, "Como o aluno chega lá");
  assert.deepEqual(model.CTA_DISPLAY_OPTIONS, [
    { label: "Pelo botão", value: "button" },
    { label: "Pelo botão ou tocando na notificação", value: "button_and_card" },
    { label: "Só tocando na notificação", value: "card" }
  ]);
});

test("Para onde leva: efeito da chave por modo, desligada, e no pop-up", () => {
  const cta = (display) => ({ display, href: "/minhas-compras", label: "Ver", target: "same_tab" });

  assert.equal(model.ctaSwitchDescription("inbox", cta("button")), "O aluno chega lá pelo botão.");
  assert.equal(model.ctaSwitchDescription("inbox", cta("button_and_card")), "O aluno chega lá pelo botão ou tocando em qualquer parte da notificação.");
  assert.equal(
    model.ctaSwitchDescription("inbox", cta("card")),
    "O aluno chega lá tocando na notificação. No pé dela aparece o texto que você escrever, com uma seta."
  );
  assert.equal(model.ctaSwitchDescription("inbox", { href: "/minhas-compras", label: "Ver", target: "same_tab" }), "O aluno chega lá pelo botão.");
  assert.equal(model.ctaSwitchDescription("inbox", null), "Sem destino, a notificação só informa.");
  assert.equal(model.ctaSwitchDescription("popup", cta("card")), "O botão aparece embaixo do texto do pop-up.");
  assert.equal(model.ctaSwitchDescription("popup", null), "Sem botão, o pop-up só informa.");
});

test("Para onde leva: o texto e do botao nos dois modos com botao e 'ao lado da seta' no Só tocando", () => {
  const botao = { label: "Texto do botão", placeholder: "Ex.: Assistir agora" };

  assert.deepEqual(model.ctaTextFieldCopy("button"), botao);
  assert.deepEqual(model.ctaTextFieldCopy("button_and_card"), botao);
  assert.deepEqual(model.ctaTextFieldCopy("card"), {
    hint: "Aparece no pé da notificação, com uma seta: o aluno vê que pode tocar.",
    label: "Texto ao lado da seta",
    placeholder: "Ex.: Ver a aula nova"
  });

  // Mesmo erro do zod, sem falar de botao quando nao ha botao.
  assert.equal(model.ctaLabelError("card", "Escreva o texto do botão."), "Escreva o texto.");
  assert.equal(model.ctaLabelError("button", "Escreva o texto do botão."), "Escreva o texto do botão.");
  assert.equal(model.ctaLabelError("card", "Use até 30 caracteres."), "Use até 30 caracteres.");
  assert.equal(model.ctaLabelError("card", undefined), undefined);

  // O zod do rascunho manda a mensagem que o campo troca no modo "Só tocando".
  const parsed = schemas.noticeContentSchema.safeParse({
    ...conteudo({ cta: { display: "card", href: "/minhas-compras", label: "", target: "same_tab" } }),
    sender: null,
    validity: { mode: "default" }
  });
  assert.equal(parsed.success, false);
  assert.equal(parsed.error.issues.find((issue) => issue.path.join(".") === "cta.label")?.message, "Escreva o texto do botão.");
});

test("Para onde leva: modo do cartao (pop-up e rascunho antigo = botao) e o nome das pilulas do destino", () => {
  assert.equal(model.ctaDisplayOf("inbox", { display: "card" }), "card");
  assert.equal(model.ctaDisplayOf("inbox", {}), "button");
  assert.equal(model.ctaDisplayOf("inbox", null), "button");
  assert.equal(model.ctaDisplayOf("popup", { display: "card" }), "button");
  assert.equal(model.ctaDestinationAriaLabel("button"), "Para onde o botão leva");
  assert.equal(model.ctaDestinationAriaLabel("button_and_card"), "Para onde o botão leva");
  assert.equal(model.ctaDestinationAriaLabel("card"), "Para onde a notificação leva");
});

/* ------------------------------------------------------------------------------------------------
 * "Interação" e os campos da enquete
 * ---------------------------------------------------------------------------------------------- */

test("Interação: os textos das tres chaves", () => {
  const copy = model.NOTICE_INTERACTION_COPY;

  assert.equal(copy.blockTitle, "Interação");
  assert.equal(copy.blockDescription, "O que o aluno pode fazer direto no sino.");
  assert.equal(copy.reactionsLabel, "Permitir reações");
  assert.equal(copy.reactionsOn, "O aluno pode reagir com 👍 ❤️ 🔥 👏 😂 😮. Ele vê só a própria reação; os números ficam no relatório.");
  assert.equal(copy.reactionsOff, "Sem reações, a notificação não mostra o botão de reagir.");
  assert.equal(copy.responseLabel, "Pedir uma resposta (Aceitar ou Recusar)");
  assert.equal(copy.responseDisabledByPoll, "Desligue a enquete para pedir uma resposta.");
  assert.equal(copy.pollLabel, "Fazer uma enquete");
  assert.equal(copy.pollOn, "O aluno escolhe uma opção direto no sino.");
  assert.equal(copy.pollOff, "Uma pergunta com opções, que o aluno responde no sino.");
  assert.equal(copy.pollDisabledByResponse, "Desligue “Pedir uma resposta” para fazer uma enquete.");
});

test("enquete: id novo tem 8 hexadecimais minusculos tirados do uuid", () => {
  assert.equal(model.newPollOptionId(() => "3F2A9C1E-7B44-4D2A-9E1F-0A1B2C3D4E5F"), "3f2a9c1e");
  assert.equal(model.newPollOptionId(() => "ab-cd-ef-01-2345"), "abcdef01");

  for (let index = 0; index < 50; index += 1) {
    const id = model.newPollOptionId();
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.match(id, interactions.POLL_OPTION_ID);
  }
});

test("enquete: ao ligar, duas opcoes vazias com ids diferentes, uma resposta, resultado ligado, ate sair do sino", () => {
  const poll = model.emptyPoll(sequence("11111111", "22222222"));

  assert.deepEqual(poll, {
    closesAt: null,
    multiple: false,
    options: [
      { id: "11111111", label: "" },
      { id: "22222222", label: "" }
    ],
    question: "",
    showResults: true
  });

  // O gerador padrao tira o id de um uuid.
  const uuid = sequence("3F2A9C1E-7B44-4D2A", "0a1b2c3d-4e5f");
  const doUuid = model.emptyPoll(() => model.newPollOptionId(uuid));
  assert.deepEqual(
    doUuid.options.map((option) => option.id),
    ["3f2a9c1e", "0a1b2c3d"]
  );

  // Gerador que repete: o segundo id muda ate ficar unico.
  const repetido = model.emptyPoll(() => "abcdef12");
  assert.equal(repetido.options.length, 2);
  assert.notEqual(repetido.options[0].id, repetido.options[1].id);
  repetido.options.forEach((option) => assert.match(option.id, interactions.POLL_OPTION_ID));

  // Vazia nao passa no zod (o editor mostra os erros nos campos); preenchida, passa como esta.
  assert.equal(interactions.pollSchema.safeParse(poll).success, false);
  const preenchida = { ...poll, options: poll.options.map((option, index) => ({ ...option, label: `Opção ${index + 1}` })), question: "Qual dia?" };
  assert.deepEqual(interactions.pollSchema.parse(preenchida), preenchida);
});

test("enquete: adicionar ate 6 opcoes; depois disso a enquete fica como esta", () => {
  let poll = enquete();
  const ids = sequence("33333333", "44444444", "55555555", "66666666", "77777777");

  for (let count = 3; count <= 6; count += 1) {
    assert.equal(model.canAddPollOption(poll), true);
    poll = model.addPollOption(poll, ids);
    assert.equal(poll.options.length, count);
    assert.deepEqual(poll.options.at(-1), { id: poll.options.at(-1).id, label: "" });
  }

  assert.deepEqual(
    poll.options.map((option) => option.id),
    ["a1b2c3d4", "e5f6a7b8", "33333333", "44444444", "55555555", "66666666"]
  );
  assert.equal(model.canAddPollOption(poll), false);
  assert.equal(model.addPollOption(poll, ids), poll);
  assert.equal(model.POLL_FIELD_COPY.maxOptions, "Até 6 opções.");

  // Id repetido do gerador nunca vira duas opcoes com o mesmo id.
  const comRepeticao = model.addPollOption(enquete(), () => "a1b2c3d4");
  assert.equal(new Set(comRepeticao.options.map((option) => option.id)).size, 3);
});

test("enquete: remover so depois da segunda; as outras opcoes mantem id e texto", () => {
  const poll = enquete({
    options: [
      { id: "a1b2c3d4", label: "Sábado" },
      { id: "e5f6a7b8", label: "Domingo" },
      { id: "c0ffee00", label: "Segunda" },
      { id: "deadbeef", label: "Terça" }
    ]
  });

  assert.equal(model.canRemovePollOption(0), false);
  assert.equal(model.canRemovePollOption(1), false);
  assert.equal(model.canRemovePollOption(2), true);
  assert.equal(model.removePollOption(poll, 0), poll);
  assert.equal(model.removePollOption(poll, 1), poll);
  assert.equal(model.removePollOption(poll, 9), poll);

  const semSegunda = model.removePollOption(poll, 2);
  assert.deepEqual(semSegunda.options, [
    { id: "a1b2c3d4", label: "Sábado" },
    { id: "e5f6a7b8", label: "Domingo" },
    { id: "deadbeef", label: "Terça" }
  ]);
  assert.equal(semSegunda.question, poll.question);

  const renomeada = model.setPollOptionLabel(semSegunda, 2, "Quarta");
  assert.deepEqual(
    renomeada.options.map((option) => option.id),
    ["a1b2c3d4", "e5f6a7b8", "deadbeef"]
  );
  assert.equal(renomeada.options[2].label, "Quarta");
  assert.equal(semSegunda.options[2].label, "Terça");

  assert.equal(model.pollOptionFieldLabel(0), "Opção 1");
  assert.equal(model.pollOptionFieldLabel(5), "Opção 6");
  assert.equal(model.removePollOptionLabel(2), "Remover opção 3");
});

test("enquete: limites do campo sao os do zod (pergunta 120, opcao 60, 2 a 6 opcoes)", () => {
  assert.deepEqual(interactions.POLL_LIMITS, { maxOptions: 6, minOptions: 2, option: 60, question: 120 });

  const muitas = model.addPollOption(enquete({ options: Array.from({ length: 6 }, (_, index) => ({ id: `0000000${index}`, label: `Opção ${index}` })) }));
  assert.equal(muitas.options.length, 6);
});

test("enquete: Encerra quando sair do sino ou numa data; a primeira data sugerida e 7 dias depois do envio, 23:59", () => {
  assert.deepEqual(model.POLL_END_OPTIONS, [
    { label: "Quando sair do sino", value: "leave" },
    { label: "Numa data e hora", value: "at" }
  ]);
  assert.equal(model.pollEndMode({ closesAt: null }), "leave");
  assert.equal(model.pollEndMode({ closesAt: "" }), "at");
  assert.equal(model.pollEndMode({ closesAt: "2026-10-25T21:00:00.000Z" }), "at");

  // Envio agora (22/10 12:00 em Sao Paulo): 29/10 23:59 de Sao Paulo.
  assert.equal(model.defaultPollClosesAt(now, now), "2026-10-30T02:59:00.000Z");
  // Envio agendado para 01/11: 08/11 23:59.
  assert.equal(model.defaultPollClosesAt(Date.parse("2026-11-01T12:00:00.000Z"), now), "2026-11-09T02:59:00.000Z");

  assert.equal(model.POLL_FIELD_COPY.endHint, "Depois disso ninguém mais vota.");
  assert.equal(model.POLL_FIELD_COPY.openWhileInBell, "A enquete fica aberta enquanto a notificação estiver no sino.");
});

/* ------------------------------------------------------------------------------------------------
 * Relatorio
 * ---------------------------------------------------------------------------------------------- */

test("relatorio: Reagiram sobre quem viu e um cartao por emoji (ordem do catalogo) sobre o total de reacoes", () => {
  const report = model.reactionReport({ reacted: 8, reactions: { clap: 1, fire: 0, like: 4, love: 3 }, seen: 40 });

  assert.deepEqual(report.reacted, { definition: "20% de quem viu", definitionShort: "20% de quem viu", label: "Reagiram", value: 8 });
  assert.deepEqual(
    report.tiles.map((tile) => [tile.id, tile.label, tile.value, tile.definition]),
    [
      ["like", "👍 Gostei", 4, "50% das reações"],
      ["love", "❤️ Amei", 3, "37,5% das reações"],
      ["clap", "👏 Aplausos", 1, "12,5% das reações"]
    ]
  );
  assert.equal(report.emptyMessage, null);

  const vazio = model.reactionReport({ reacted: 0, reactions: {}, seen: 0 });
  assert.deepEqual(vazio.tiles, []);
  assert.equal(vazio.emptyMessage, "Ninguém reagiu ainda.");
  assert.equal(vazio.reacted.definition, "de quem viu");

  // Numero estranho do banco vira 0.
  assert.deepEqual(model.reactionReport({ reacted: 1, reactions: { like: -2, wow: 1 }, seen: 1 }).tiles.map((tile) => tile.id), ["wow"]);
});

test("relatorio: a secao Reações aparece com a chave ligada ou com alguma reacao; nunca no pop-up", () => {
  assert.equal(model.showsReactionReport({ allowsReactions: true, kind: "inbox", reacted: 0 }), true);
  assert.equal(model.showsReactionReport({ allowsReactions: false, kind: "inbox", reacted: 2 }), true);
  assert.equal(model.showsReactionReport({ allowsReactions: false, kind: "inbox", reacted: 0 }), false);
  assert.equal(model.showsReactionReport({ allowsReactions: undefined, kind: "inbox", reacted: 0 }), false);
  assert.equal(model.showsReactionReport({ allowsReactions: true, kind: "popup", reacted: 3 }), false);
});

test("relatorio: uma linha por opcao com a parte de quem votou e o numero de votos", () => {
  const rows = model.pollReportRows(enquete(), { options: { a1b2c3d4: 54, e5f6a7b8: 74 }, voters: 128 });

  assert.deepEqual(rows, [
    { id: "a1b2c3d4", label: "Sábado", percent: 42, removed: false, summary: "42% · 54 votos", votes: 54 },
    { id: "e5f6a7b8", label: "Domingo", percent: 58, removed: false, summary: "58% · 74 votos", votes: 74 }
  ]);

  const um = model.pollReportRows(enquete(), { options: { a1b2c3d4: 1 }, voters: 1 });
  assert.deepEqual(
    um.map((row) => row.summary),
    ["100% · 1 voto", "0% · 0 votos"]
  );

  // Varias respostas: as partes somam mais de 100.
  const varias = model.pollReportRows(enquete({ multiple: true }), { options: { a1b2c3d4: 3, e5f6a7b8: 3 }, voters: 4 });
  assert.deepEqual(
    varias.map((row) => row.percent),
    [75, 75]
  );

  // Ninguem votou.
  assert.deepEqual(
    model.pollReportRows(enquete(), { options: {}, voters: 0 }).map((row) => row.summary),
    ["0% · 0 votos", "0% · 0 votos"]
  );
});

test("relatorio: opcao com voto que nao esta mais na enquete aparece como 'Opção removida' (fluxo entre versoes)", () => {
  const rows = model.pollReportRows(enquete(), { options: { a1b2c3d4: 2, e5f6a7b8: 1, ffff0000: 1, ffff1111: 0 }, voters: 4 });

  assert.deepEqual(
    rows.map((row) => [row.id, row.label, row.removed, row.summary]),
    [
      ["a1b2c3d4", "Sábado", false, "50% · 2 votos"],
      ["e5f6a7b8", "Domingo", false, "25% · 1 voto"],
      ["ffff0000", "Opção removida", true, "25% · 1 voto"]
    ]
  );
});

test("relatorio: Votaram sobre quem viu, Mudaram o voto e a nota das varias respostas", () => {
  assert.deepEqual(model.pollReportLines({ changed: 6, multiple: false, seen: 320, voters: 128 }), {
    changed: "Mudaram o voto 6",
    multiple: null,
    voted: "Votaram 128 · 40% de quem viu"
  });
  assert.deepEqual(model.pollReportLines({ changed: 0, multiple: true, seen: 0, voters: 0 }), {
    changed: "Mudaram o voto 0",
    multiple: "Cada pessoa pode marcar mais de uma: as porcentagens somam mais de 100%.",
    voted: "Votaram 0"
  });
  assert.equal(model.pollReportLines({ changed: 0, multiple: false, seen: 3_200, voters: 1_280 }).voted, "Votaram 1.280 · 40% de quem viu");
  assert.equal(model.formatVotes(1), "1 voto");
  assert.equal(model.formatVotes(0), "0 votos");
  assert.equal(model.formatVotes(1_234), "1.234 votos");
});

test("relatorio: quando a enquete encerra (data, ao sair do sino, ja encerrada, notificacao retirada)", () => {
  const futura = enquete({ closesAt: "2026-10-25T21:00:00.000Z" });
  const passada = enquete({ closesAt: "2026-10-21T17:30:00.000Z" });

  assert.equal(model.pollStatusLine(futura, { now, status: "sent" }), "Encerra em 25/10/2026 às 18:00");
  assert.equal(model.pollStatusLine(enquete(), { now, status: "sent" }), "Encerra quando a notificação sair do sino.");
  assert.equal(model.pollStatusLine(passada, { now, status: "sent" }), "Encerrada em 21/10/2026 às 14:30.");
  assert.equal(model.pollStatusLine(passada, { now, status: "canceled" }), "Encerrada em 21/10/2026 às 14:30.");
  assert.equal(model.pollStatusLine(enquete(), { now, status: "canceled" }), "Encerrada: a notificação saiu do sino.");
  assert.equal(model.pollStatusLine(futura, { now, status: "canceled" }), "Encerrada: a notificação saiu do sino.");
});

test("relatorio: Encerrar enquete so para quem publica, notificacao enviada, aviso (nao passo de fluxo) e enquete aberta", () => {
  const base = { canPublish: true, flowNodeId: null, kind: "inbox", now, poll: enquete(), status: "sent" };

  assert.equal(model.canCloseNoticePoll(base), true);
  assert.equal(model.canCloseNoticePoll({ ...base, poll: enquete({ closesAt: "2026-10-25T21:00:00.000Z" }) }), true);
  assert.equal(model.canCloseNoticePoll({ ...base, canPublish: false }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, status: "canceled" }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, status: "sending" }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, kind: "popup" }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, flowNodeId: "00000000-0000-4000-8000-000000000001" }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, poll: null }), false);
  assert.equal(model.canCloseNoticePoll({ ...base, poll: enquete({ closesAt: "2026-10-21T17:30:00.000Z" }) }), false);

  assert.deepEqual(model.CLOSE_POLL_CONFIRM, {
    confirmLabel: "Encerrar enquete",
    description: "Ninguém mais vota. O resultado fica como está agora.",
    destructive: true,
    title: "Encerrar a enquete?"
  });
  assert.equal(model.CLOSE_POLL_TOAST, "Enquete encerrada.");
});

test("relatorio: Mudaram de resposta sobre quem respondeu; Excluíram do sino so com alguem, sobre quem recebeu", () => {
  assert.deepEqual(model.responseChangedTile({ accepted: 30, declined: 10 }, 4), {
    definition: "10% de quem respondeu",
    definitionShort: "10% de quem respondeu",
    label: "Mudaram de resposta",
    value: 4
  });
  assert.equal(model.responseChangedTile({ accepted: 0, declined: 0 }, 0).definition, "de quem respondeu");

  assert.equal(model.hiddenFromBellTile(0, 318), null);
  assert.deepEqual(model.hiddenFromBellTile(12, 318), {
    definition: "3,8% de quem recebeu",
    definitionShort: "3,8% de quem recebeu",
    label: "Excluíram do sino",
    value: 12
  });
  assert.equal(model.hiddenFromBellTile(1, 0)?.definition, "de quem recebeu");
  assert.equal(model.INTERACTIONS_OPEN_NOTE, "Reagir e votar também contam como abrir.");
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario (docs/24 §2.9; docs/17 §1.3)
 * ---------------------------------------------------------------------------------------------- */

const D_FILES = [
  "src/components/admin/v2/communication/notice-content-fields.tsx",
  "src/components/admin/v2/communication/notice-cta-field.tsx",
  "src/components/admin/v2/communication/notice-poll-field.tsx",
  "src/components/admin/v2/communication/notice-interactions-report.tsx",
  "src/components/admin/v2/communication/notice-preview.tsx"
];

const FORBIDDEN = /campanha|público|audiência|evento|oferta|automação|gatilho|lembrete/i;

function collectStrings(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }

  return into;
}

test("vocabulario: o texto novo das telas nao usa palavra fora do vocabulario", async () => {
  const copy = collectStrings([
    model.CTA_FIELD_COPY,
    model.CTA_DISPLAY_OPTIONS,
    model.NOTICE_INTERACTION_COPY,
    model.POLL_FIELD_COPY,
    model.POLL_END_OPTIONS,
    model.PREVIEW_POLL_OPTIONS,
    model.CLOSE_POLL_CONFIRM,
    model.CLOSE_POLL_TOAST,
    model.NO_REACTIONS_MESSAGE,
    model.REMOVED_POLL_OPTION_LABEL,
    model.INTERACTIONS_OPEN_NOTE,
    ["button", "button_and_card", "card"].map((display) => [model.ctaSwitchDescription("inbox", { display }), model.ctaTextFieldCopy(display)]),
    model.ctaSwitchDescription("popup", null)
  ]);

  for (const text of copy) {
    assert.doesNotMatch(text, FORBIDDEN, text);
  }

  for (const file of D_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, FORBIDDEN, file);
  }
});

test("vocabulario: as telas usam o texto novo e o antigo saiu", async () => {
  const read = (file) => readFile(new URL(`../src/components/admin/v2/communication/${file}`, import.meta.url), "utf8");
  const cta = await read("notice-cta-field.tsx");
  const content = await read("notice-content-fields.tsx");
  const poll = await read("notice-poll-field.tsx");
  const report = await read("notice-interactions-report.tsx");
  const preview = await read("notice-preview.tsx");

  assert.doesNotMatch(cta, /Mostrar um botão|O botão aparece embaixo do texto do aviso|Sem botão, o aviso só informa/);
  assert.match(cta, /CTA_FIELD_COPY\.switchLabel/);
  assert.match(cta, /CTA_FIELD_COPY\.displayLabel/);
  assert.match(cta, /ctaTextFieldCopy\(/);

  assert.doesNotMatch(content, /title="Botão"|title="Resposta"/);
  assert.match(content, /CTA_FIELD_COPY\.blockTitle/);
  assert.match(content, /NOTICE_INTERACTION_COPY\.blockTitle/);
  assert.match(content, /NOTICE_INTERACTION_COPY\.reactionsLabel/);
  assert.match(content, /NOTICE_INTERACTION_COPY\.pollLabel/);
  assert.match(content, /lockedFields/);
  assert.match(content, /pollCanEndAtDate/);

  assert.match(poll, /POLL_FIELD_COPY\.questionLabel/);
  assert.match(poll, /POLL_FIELD_COPY\.addOption/);
  assert.match(poll, /POLL_FIELD_COPY\.maxOptions/);
  assert.match(poll, /canEndAtDate \?/);

  assert.match(report, /aria-label="Reações"/);
  assert.match(report, /title="Enquete"/);
  assert.match(report, /closeNoticePoll\(/);

  assert.match(preview, /Enquete na prévia/);
  assert.match(preview, /pollPreview/);
});
