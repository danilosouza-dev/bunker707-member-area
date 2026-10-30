// Quando a sala abre, num modulo folha, sem imports: o relogio do "Comeca quando voce entra" (jit-clock.ts) roda no
// navegador, inclusive no card da Inicio, e ler a constante de room-model.ts levava junto model.ts para o JS inicial.
// room-model.ts reexporta, entao quem ja importa de la nao muda.

/** A sala abre para o aluno este tanto antes da hora marcada (a espera, com o chat da sala de espera). */
export const ROOM_OPENS_MINUTES_BEFORE = 15;
