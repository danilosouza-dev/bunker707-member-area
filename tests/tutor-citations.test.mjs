import assert from "node:assert/strict";
import test from "node:test";

// Citacoes do Tutor IA (puro, sem React nem banco): o modelo cita linhas da transcricao como [F1] e o
// servidor troca por um tempo real do video (com 3 s de folga para o aluno ouvir o contexto), so
// quando a frase antes da marca e sustentada pela linha citada. O fluxo completo, com banco e
// provedor falso, esta em tests/integration/tutor-ia.test.mjs.

const {
  buildTutorEvidence,
  formatTutorEvidenceContext,
  resolveTutorEvidenceCitations,
  TUTOR_CITATION_SEEK_MARGIN_SECONDS
} = await import("../src/lib/tutor-citations.ts");

test("a folga da citacao e de 3 segundos", () => {
  assert.equal(TUTOR_CITATION_SEEK_MARGIN_SECONDS, 3);
});

test("a linha citada vira o tempo do video, com 3 s de folga, e a citacao sai verificada", () => {
  const cues = [
    { endSeconds: 362.84, startSeconds: 358.96, text: "E aí depois você vai fazer a sincronização facial." },
    { endSeconds: 367.76, startSeconds: 362.84, text: "Você tem que saber fazer a sincronização facial e corrigir a identidade." },
    { endSeconds: 394.4, startSeconds: 389.64, text: "Esse vídeo é para te mostrar o que você vai conseguir nesse treinamento." }
  ];
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 435.32, id: "chunk-wide", startSeconds: 347.36 }],
    cues,
    maximumCharacters: 10_000,
    transcriptId: "transcript-1"
  });

  // O modelo recebe as linhas com identificador, nunca com horario (ele nao deve calcular tempos).
  assert.match(formatTutorEvidenceContext(evidence), /\[F1\] E aí depois você vai fazer a sincronização facial\./);
  assert.equal(formatTutorEvidenceContext(evidence).includes("05:59"), false);

  const resolved = resolveTutorEvidenceCitations(
    "**Sincronização Facial:** correção da identidade e sincronização facial. [F1]",
    evidence,
    3
  );

  assert.equal(resolved.body, "**Sincronização Facial:** correção da identidade e sincronização facial. [05:56]");
  assert.deepEqual(resolved.citations, [{
    chunkId: "chunk-wide:F1",
    endSeconds: 362.84,
    label: "05:56",
    quote: "E aí depois você vai fazer a sincronização facial.",
    startSeconds: 356,
    verified: true
  }]);
});

test("a folga nunca produz tempo negativo: linha no comeco do video vira 00:00", () => {
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 12, id: "chunk-intro", startSeconds: 0 }],
    cues: [{ endSeconds: 4.5, startSeconds: 1.6, text: "A introdução apresenta o primeiro agente inteligente." }],
    maximumCharacters: 10_000,
    transcriptId: "transcript-intro"
  });
  const resolved = resolveTutorEvidenceCitations("A introdução apresenta o primeiro agente inteligente. [F1]", evidence);

  assert.equal(resolved.body, "A introdução apresenta o primeiro agente inteligente. [00:00]");
  assert.equal(resolved.citations[0]?.startSeconds, 0);
});

test("marca cuja linha nao sustenta a frase e descartada: sem tempo e sem citacao", () => {
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 435.32, id: "chunk-wide", startSeconds: 347.36 }],
    cues: [{ endSeconds: 394.4, startSeconds: 389.64, text: "Esse vídeo é para te mostrar o que você vai conseguir nesse treinamento." }],
    maximumCharacters: 10_000,
    transcriptId: "transcript-1"
  });
  const resolved = resolveTutorEvidenceCitations(
    "**Sincronização Facial:** correção da identidade e das características físicas. [F1]",
    evidence,
    3
  );

  assert.equal(resolved.body.includes("F1"), false);
  assert.deepEqual(resolved.citations, []);
});
