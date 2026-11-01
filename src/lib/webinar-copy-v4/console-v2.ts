// Frases do console V2 de quem apresenta (docs/31 §1, V2-12 a V2-15, fase 2 do redesign): o topo, o palco, a barra
// de quem apresenta, o painel com abas e o chat do console. Entram em WEBINAR_COPY.consoleV2 e passam pela
// PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo puro, sem imports. Dono: a fase 2 do redesign V2; cada
// fatia acrescenta aqui as frases que a tela dela usa. As frases que o console ja tinha continuam em
// WEBINAR_COPY.consoleAoVivo e em WEBINAR_ADMIN_COPY.console (editor-model.ts).

export const CONSOLE_V2_COPY = {} as const;
