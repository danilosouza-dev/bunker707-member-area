// "Comeca quando voce entra" (fase 4e; docs/30 §1.2, §1.6, §2.2, §2.7, A14 e D25), a parte pura. O relogio (o horario
// atual e o proximo, a escolha da rota, o que a pagina do aluno mostra e o dia de Sao Paulo) fica em jit-clock.ts, que
// roda no navegador sem trazer model.ts nem as frases do editor; este arquivo o reexporta inteiro e acrescenta o resto
// do app:
// - isJitSession e jitActive: a sessao nasceu pelo just-in-time; o just-in-time vale para o webinario;
// - withJitPublishProblems: a Live gravada com o just-in-time ligado publica sem hora marcada (so com o video);
// - jitSummary: a frase da Revisao.
// Sem "server-only", imports relativos: tests/webinarios-jit-modelo.test.mjs carrega direto pelo Node. O navegador
// importa jit-clock.ts, nunca este arquivo.

import { JIT_COPY } from "../../lib/webinar-copy-v4/jit";
import type { JitSettings, SessionStatus, WebinarKind } from "./model";

export * from "./jit-clock";

/* ------------------------------------------------------------------------------------------------
 * O resto do app
 * ---------------------------------------------------------------------------------------------- */

/** Uma sessao `jit` que nasceu hoje, como o card Sessoes do editor mostra (a hora e a situacao; o console pelo id). */
export type JitSessionSummary = { id: string; scheduledAt: string; status: SessionStatus };

/** A sessao nasceu pelo just-in-time (o editor, a lista, a faixa e os lembretes nunca mexem nela). */
export function isJitSession(session: { jit?: boolean | null }): boolean {
  return session.jit === true;
}

/** O just-in-time vale para este webinario (so a Live gravada, ligado). */
export function jitActive(kind: WebinarKind, settings: Pick<JitSettings, "enabled"> | null | undefined): boolean {
  return kind === "simulated" && settings?.enabled === true;
}

/**
 * O que falta para publicar com o just-in-time ligado (docs/30 §2.2): a Live gravada publica sem hora marcada (as
 * sessoes nascem quando os alunos chegam); o video continua obrigatorio. Sem o just-in-time, a lista fica como veio.
 */
export function withJitPublishProblems<T extends { path: string }>(problems: readonly T[], input: { jit: Pick<JitSettings, "enabled"> | null | undefined; kind: WebinarKind }): T[] {
  if (!jitActive(input.kind, input.jit)) {
    return [...problems];
  }
  return problems.filter((problem) => problem.path !== "sessions");
}

/** "Começa quando você entra: a cada 15 min, das 08:00 às 23:00 (horário de Brasília)" (a Revisao do editor). */
export function jitSummary(settings: Pick<JitSettings, "endHour" | "everyMinutes" | "startHour">): string {
  return JIT_COPY.card.resumo(settings.everyMinutes, JIT_COPY.card.horaDe(settings.startHour), JIT_COPY.card.horaDe(settings.endHour));
}
