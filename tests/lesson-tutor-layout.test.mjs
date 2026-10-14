import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Tutor IA da aula no visual novo: cabecalho com identidade e disponibilidade, historico recolhivel,
// sugestoes 2x2, mensagens em conversa e campo em pilula. Comportamento (SWR, citacoes) fica coberto
// por lesson-ai-tutor.test.mjs.

const tutor = readFileSync(new URL("../src/components/lesson-ai-tutor.tsx", import.meta.url), "utf8");

test("cabecalho mostra identidade, disponibilidade e as acoes Historico e Novo chat", () => {
  assert.match(tutor, /<p className="text-sm font-bold leading-5 text-white">Tutor IA<\/p>/);
  assert.match(tutor, /"Responde com base nesta aula"/);
  assert.match(tutor, /isTutorReady \? "bg-emerald-400" : "bg-zinc-500"/);
  assert.match(tutor, /aria-controls="tutor-history"/);
  assert.match(tutor, /aria-label="Criar novo chat"/);
});

test("historico: trilho recolhivel no computador e folha sobre o painel no celular", () => {
  assert.match(tutor, /const DESKTOP_MEDIA_QUERY = "\(min-width: 1024px\)";/);
  assert.match(tutor, /const historyVisible = isDesktop \? !railCollapsed && conversations\.length > 0 : historyOpen;/);
  assert.match(tutor, /"flex w-64 shrink-0 flex-col border-r border-white\/\[0\.08\] bg-\[#161616\]"/);
  assert.match(tutor, /"absolute inset-0 z-20 flex flex-col bg-\[#161616\]"/);
  assert.match(tutor, /formatMemberRelativeTime\(conversation\.lastMessageAt\)/);
});

test("vazio com sugestoes 2x2, Tutor sem balao e indicador que respeita menos movimento", () => {
  assert.equal(tutor.match(/\{ icon: \w+, label: "/g)?.length, 4);
  assert.match(tutor, /mt-6 grid w-full gap-2\.5 sm:grid-cols-2/);
  assert.match(tutor, /rounded-\[18px\] rounded-br-\[6px\] bg-white\/\[0\.1\]/);
  assert.match(tutor, /motion-safe:animate-bounce/);
  assert.doesNotMatch(tutor, /className="[^"]*(?<!motion-safe:)animate-spin/);
});

test("campo em pilula: cresce ate 6 linhas, Enter envia, Shift + Enter quebra e contador perto do limite", () => {
  assert.match(tutor, /const TUTOR_QUESTION_MAX_LENGTH = 4000;/);
  assert.match(tutor, /const TUTOR_TEXTAREA_MAX_HEIGHT = 160;/);
  assert.match(tutor, /maxLength=\{TUTOR_QUESTION_MAX_LENGTH\}/);
  assert.match(tutor, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(tutor, /Enter envia · Shift \+ Enter quebra a linha/);
  assert.match(tutor, /questionLength >= TUTOR_QUESTION_COUNTER_THRESHOLD/);
  assert.match(tutor, /rounded-\[22px\] border bg-\[#1f1f1f\]/);
  assert.match(tutor, /"O Tutor IA abre junto com a aula\."/);
  // Rola so a conversa, nao a pagina inteira.
  assert.match(tutor, /container\.scrollTo\(\{ behavior: prefersReducedMotion \? "auto" : "smooth", top: container\.scrollHeight \}\)/);
  assert.doesNotMatch(tutor, /scrollIntoView/);
});

test("textos de acessibilidade do Tutor em portugues com acento", () => {
  assert.match(tutor, /aria-label=\{`Opções do chat \$\{conversation\.title\}`\}/);
  assert.match(tutor, /aria-label=\{`Ir para \$\{citation\.label\} no vídeo`\}/);
  assert.doesNotMatch(tutor, /aria-label=\{?[`"][^`"]*\b(Opcoes|no video)\b/);
});
