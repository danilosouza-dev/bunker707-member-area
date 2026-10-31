// Frases da sala do aluno V2 (docs/31 §1, V2-1 a V2-19): o tema, o painel, a visao do video, a enquete no palco e os
// selos. Entram em WEBINAR_COPY.salaV2 e passam pela PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo
// puro, sem imports. Dono: a fase 1 do redesign V2. As frases que a sala ja tinha continuam em WEBINAR_COPY.sala.

export const SALA_V2_COPY = {
  /** O botao de tema do cabecalho diz para onde vai: no escuro, "Tema claro"; no claro, "Tema escuro" (V2-12). */
  tema: {
    claro: "Tema claro",
    escuro: "Tema escuro"
  }
} as const;
