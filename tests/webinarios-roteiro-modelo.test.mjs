import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O roteiro de chat, a parte pura (docs/30 §1.6, §2.2 e §6.6 D6): o tempo escrito de varios jeitos, o CSV de
// quatro colunas (ida e volta), a ordem dos itens, a frase do apresentador achada nas cues e o resumo.

const script = await import("../src/server/webinars/script-model.ts");

test("o tempo: h:mm:ss, mm:ss, segundos, 1h2m3s, negativo na espera; fora dos limites ou torto vira nulo", () => {
  assert.equal(script.parseOffsetText("1:02:03"), 3_723_000);
  assert.equal(script.parseOffsetText("02:03"), 123_000);
  assert.equal(script.parseOffsetText("63"), 63_000);
  assert.equal(script.parseOffsetText("63.5"), 63_500);
  assert.equal(script.parseOffsetText("1h2m3s"), 3_723_000);
  assert.equal(script.parseOffsetText("90s"), 90_000);
  assert.equal(script.parseOffsetText("5 min"), 300_000);
  assert.equal(script.parseOffsetText("-0:30"), -30_000);
  assert.equal(script.parseOffsetText(12), 12_000, "numero = segundos");
  assert.equal(script.parseOffsetText("1:75"), null, "75 segundos nao existe");
  assert.equal(script.parseOffsetText("abc"), null);
  assert.equal(script.parseOffsetText(""), null);
  assert.equal(script.parseOffsetText("99:00:00"), null, "passa de 48 h");
  assert.equal(script.formatOffsetText(3_723_000), "1:02:03");
  assert.equal(script.formatOffsetText(123_000), "02:03");
  assert.equal(script.formatOffsetText(-30_000), "-00:30");
});

test("o CSV: cabecalho em qualquer ordem, ; ou ,, Papel por extenso, linha ruim vira erro com o numero e nao entra", () => {
  const csv = ["Nome;Tempo;Papel;Mensagem", "Duda;00:30;Aluno;Boa noite!", "Equipe;1:00;Equipe;\"Bem-vindos; vamos começar\"", "Sem tempo;;Aluno;oi", "Rafa;02:00;Chefe;eita", "Lia;03:00;;sem papel vira aluno"].join("\n");
  const result = script.parseScriptCsv(csv);
  assert.deepEqual(
    result.items.map((item) => [item.offsetMs, item.personaName, item.personaRole, item.body, item.triggerKind, item.status]),
    [
      [30_000, "Duda", "student", "Boa noite!", "at_offset", "ready"],
      [60_000, "Equipe", "team", "Bem-vindos; vamos começar", "at_offset", "ready"],
      [180_000, "Lia", "student", "sem papel vira aluno", "at_offset", "ready"]
    ]
  );
  assert.deepEqual(
    result.errors.map((error) => [error.line, error.message]),
    [
      [4, 'Tempo inválido: "".'],
      [5, 'Papel inválido: "Chefe" (use Aluno ou Equipe).']
    ]
  );
  assert.equal(result.truncated, false);

  const missing = script.parseScriptCsv("Tempo,Mensagem\n0:10,oi");
  assert.equal(missing.items.length, 0);
  assert.match(missing.errors[0].message, /Faltam as colunas: Nome, Papel/);

  const big = script.parseScriptCsv("x".repeat(1_048_577));
  assert.match(big.errors[0].message, /passa de 1024 KB/);

  const roundTrip = script.formatScriptCsv(result.items);
  assert.ok(roundTrip.startsWith("﻿Tempo;Nome;Papel;Mensagem\r\n"));
  assert.match(roundTrip, /00:30;Duda;Aluno;Boa noite!/);
  assert.match(roundTrip, /01:00;Equipe;Equipe;"Bem-vindos; vamos começar"/);
  const again = script.parseScriptCsv(roundTrip);
  assert.equal(again.errors.length, 0);
  assert.deepEqual(again.items.map((item) => item.body), result.items.map((item) => item.body));
});

test("o CSV do roteiro da Live ao vivo (revisao de 11/11/2026, achado 1): o numero sozinho e minuto, como o campo Minuto da live e o card Simulação; a ida e a volta nao mudam o minuto", () => {
  assert.equal(script.parseLiveOffsetText("12"), 12 * 60_000, "12 = 12 minutos (na gravada seriam 12 segundos)");
  assert.equal(script.parseOffsetText("12"), 12_000, "a gravada continua em segundos");
  assert.equal(script.parseLiveOffsetText("12:30"), 12 * 60_000 + 30_000);
  assert.equal(script.parseLiveOffsetText(" 0:12 "), 12_000, "minuto:segundo, com espacos nas pontas");
  assert.equal(script.parseLiveOffsetText("1:02:03"), 3_723_000, "a hora (o CSV do chat de uma sessao)");
  assert.equal(script.parseLiveOffsetText("12m"), 12 * 60_000);
  assert.equal(script.parseLiveOffsetText("90s"), 90_000);
  for (const torto of ["12.5", "12,5", "-0:30", "-5", "12:75", "abc", "", "3000"]) {
    assert.equal(script.parseLiveOffsetText(torto), null, torto);
  }
  assert.equal(script.parseLiveOffsetText("2880"), 48 * 60 * 60_000, "ate 48 h, o limite do banco");
  assert.equal(script.formatLiveOffsetText(12 * 60_000), "12:00");
  assert.equal(script.formatLiveOffsetText(12 * 60_000 + 30_000), "12:30");
  assert.equal(script.formatLiveOffsetText(3_723_000), "62:03", "minuto:segundo, nunca hora");
  assert.equal(script.formatLiveOffsetText(12_000), "0:12");

  const csv = ["Tempo;Nome;Papel;Mensagem", "12;Bia C.;Aluno;Cheguei", "12:30;Caio D.;Equipe;Bem-vindos", "1:02:03;Duda;Aluno;Depois de uma hora", "12.5;Lia;Aluno;torto"].join("\n");
  const live = script.parseScriptCsv(csv, { live: true });
  assert.deepEqual(
    live.items.map((item) => [item.offsetMs, item.personaName]),
    [
      [12 * 60_000, "Bia C."],
      [12 * 60_000 + 30_000, "Caio D."],
      [3_723_000, "Duda"]
    ]
  );
  assert.deepEqual(live.errors, [{ line: 5, message: 'Tempo inválido: "12.5".' }]);
  assert.deepEqual(script.parseScriptCsv(csv).items.map((item) => item.offsetMs).slice(0, 2), [12_000, 750_000], "o mesmo arquivo na gravada: o numero em segundos");

  // A ida e a volta: o CSV exportado da live volta com os mesmos minutos, na live e na gravada.
  const itens = [12 * 60_000, 12 * 60_000 + 30_000, 3_723_000, 12_000].map((offsetMs, index) => ({ body: `m${index}`, offsetMs, personaName: "Bia C.", personaRole: "student" }));
  const exportado = script.formatScriptCsv(itens, { live: true });
  assert.match(exportado, /^\uFEFF?Tempo;Nome;Papel;Mensagem\r?\n12:00;Bia C\.;Aluno;m0/);
  assert.match(exportado, /62:03;Bia C\.;Aluno;m2/);
  assert.deepEqual(script.parseScriptCsv(exportado, { live: true }).items.map((item) => item.offsetMs), itens.map((item) => item.offsetMs));
  assert.deepEqual(script.parseScriptCsv(exportado).items.map((item) => item.offsetMs), itens.map((item) => item.offsetMs), "a gravada le o mesmo arquivo igual");
  assert.match(script.formatScriptCsv(itens), /12:00;Bia C\.;Aluno;m0/, "a gravada continua com mm:ss");
  assert.match(script.formatScriptCsv(itens), /1:02:03;Bia C\.;Aluno;m2/);
});

test("ordem e minuto de cada item: at_offset pelo minuto, on_phrase pelo resolvido, manual no fim", () => {
  const items = [
    { id: "a", offsetMs: 90_000, position: 0, resolvedOffsetMs: null, triggerKind: "at_offset" },
    { id: "b", offsetMs: null, position: 1, resolvedOffsetMs: 30_000, triggerKind: "on_phrase" },
    { id: "c", offsetMs: null, position: 2, resolvedOffsetMs: null, triggerKind: "manual" },
    { id: "d", offsetMs: null, position: 3, resolvedOffsetMs: null, triggerKind: "on_phrase" },
    { id: "e", offsetMs: 30_000, position: 4, resolvedOffsetMs: null, triggerKind: "at_offset" }
  ];
  assert.deepEqual(script.sortScriptItems(items).map((item) => item.id), ["b", "e", "a", "c", "d"]);
  assert.equal(script.scriptOffsetOf(items[1]), 30_000);
  assert.equal(script.scriptOffsetOf(items[2]), null);
  assert.equal(script.scriptOffsetOf(items[3]), null);
});

test("a frase do apresentador: inteira numa cue, em duas vizinhas, ou por palavras em comum; sem acento e pontuacao", () => {
  const cues = [
    { startSeconds: 10, text: "Boa noite, pessoal! Sejam muito bem-vindos." },
    { startSeconds: 15, text: "Hoje a gente vai falar de agentes de IA" },
    { startSeconds: 20, text: "e como montar o primeiro fluxo." },
    { startSeconds: 60, text: "Agora vamos para a oferta especial de hoje." }
  ];
  assert.equal(script.normalizePhrase("Vamos COMEÇAR, já!"), "vamos comecar ja");
  assert.deepEqual(script.resolvePhrase(cues, "sejam muito bem vindos"), { cueIndex: 0, score: 1, startSeconds: 10 });
  assert.deepEqual(script.resolvePhrase(cues, "agentes de IA e como montar"), { cueIndex: 1, score: 0.95, startSeconds: 15 });
  const fuzzy = script.resolvePhrase(cues, "a oferta especial de hoje vamos");
  assert.equal(fuzzy?.startSeconds, 60);
  assert.equal(script.resolvePhrase(cues, "x"), null, "curta demais");
  assert.equal(script.resolvePhrase(cues, "nada disso foi dito aqui"), null);
  assert.equal(script.resolvePhrase([], "boa noite"), null);

  const item = { phrase: "sejam muito bem vindos", phraseDelayMs: 2_000, status: "draft", triggerKind: "on_phrase" };
  assert.deepEqual(script.resolvedScriptItem(item, cues), { resolvedOffsetMs: 12_000, status: "ready" });
  assert.deepEqual(script.resolvedScriptItem({ ...item, phrase: "nunca dito" }, cues), { resolvedOffsetMs: null, status: "unresolved" });
  assert.deepEqual(script.resolvedScriptItem({ ...item, status: "disabled" }, cues), { resolvedOffsetMs: null, status: "disabled" });
  assert.deepEqual(script.resolvedScriptItem({ ...item, triggerKind: "at_offset" }, cues), { resolvedOffsetMs: null, status: "draft" }, "so a frase resolve");
});

test("o resumo do roteiro: prontos com minuto, manuais, sem resolver e desligados", () => {
  const summary = script.scriptSummary([
    { offsetMs: 1000, resolvedOffsetMs: null, status: "ready", triggerKind: "at_offset" },
    { offsetMs: null, resolvedOffsetMs: 5000, status: "ready", triggerKind: "on_phrase" },
    { offsetMs: null, resolvedOffsetMs: null, status: "unresolved", triggerKind: "on_phrase" },
    { offsetMs: null, resolvedOffsetMs: null, status: "ready", triggerKind: "manual" },
    { offsetMs: 1000, resolvedOffsetMs: null, status: "disabled", triggerKind: "at_offset" },
    { offsetMs: 1000, resolvedOffsetMs: null, status: "draft", triggerKind: "at_offset" }
  ]);
  assert.deepEqual(summary, { disabled: 1, manual: 1, ready: 2, unresolved: 2 });
  assert.equal(script.SCRIPT_TRIGGER_LABELS.on_phrase, "Quando o apresentador diz");
});
