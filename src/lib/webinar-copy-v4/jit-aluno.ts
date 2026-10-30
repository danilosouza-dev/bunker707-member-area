// Frases do "Comeca quando voce entra" que o aluno ve no navegador (docs/30 §1.6 e §2.7): o contador do card na Inicio
// e da pagina do webinario (jit-clock.ts) e o Entrar. Modulo puro, sem imports, separado de jit.ts para o JS inicial do
// Inicio nao levar as frases do editor, do servidor e do admin. Entram em JIT_COPY.aluno e JIT_COPY.card.horaDe. Dono:
// a frente 4e do just-in-time.

/** "08:00": a hora cheia de Sao Paulo (o inicio e o fim da janela). */
export const jitHoraDe = (hora: number) => `${String(hora).padStart(2, "0")}:00`;

export const JIT_ALUNO_COPY = {
  proximaSessaoEm: (minutos: number) => (minutos <= 1 ? "A próxima sessão começa em 1 min" : `A próxima sessão começa em ${minutos} min`),
  sessaoJaComecou: (hora: string) => `A sessão das ${hora} já começou. Entre agora.`,
  salaAbreAntes: (minutos: number) => `A sala abre ${minutos} min antes.`,
  selo: "Começa quando você entra",
  entrar: "Entrar",
  semVaga: "Não precisa de vaga: é só entrar.",
  foraDoHorario: (hora: string) => `As sessões abrem a partir das ${hora} (horário de Brasília).`,
  preparando: "Preparando a sua sessão…",
  erro: "Não foi possível abrir a sessão. Tente de novo."
} as const;
