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
