// Limite das escritas do aluno no sino (Comunicacao v3a, docs/24 §4.14): reagir, votar, excluir/desfazer e
// responder sao alternancias (nao idempotentes: pedidos alternados sempre mudam algo) e, com a sessao lida
// pelas claims do JWT, nada mais segura um script. Ate 30 escritas por minuto por aluno, somando as
// quatro rotas; a 31a e 429 "Muitas tentativas. Espere um pouco." com Retry-After. Janela fixa de um
// minuto, guardada so na memoria do processo: no servidor da Hetzner e a producao inteira; na Vercel
// (teste) vale por instancia, o melhor possivel. O uso normal (uma escrita por cartao em andamento, uma
// pessoa tocando) nunca chega perto. Modulo puro (sem "server-only"): tests/sino-servidor-v3.test.mjs.

export const STUDENT_WRITE_LIMIT = { max: 30, windowMs: 60_000 } as const;

/** Resposta da rota quando passa do limite (com o cabecalho Retry-After em segundos). */
export const STUDENT_WRITE_LIMIT_MESSAGE = "Muitas tentativas. Espere um pouco.";
export const STUDENT_WRITE_RETRY_AFTER_SECONDS = 60;

/** Alunos guardados ao mesmo tempo; acima disto os mais antigos saem (memoria do processo limitada). */
const MAX_TRACKED_STUDENTS = 20_000;

type WriteWindow = { count: number; startedAt: number };

// Em ordem de abertura da janela (cada janela nova entra no fim): as vencidas ficam no comeco.
const windows = new Map<string, WriteWindow>();

function dropExpired(now: number) {
  for (const [userId, window] of windows) {
    if (now - window.startedAt < STUDENT_WRITE_LIMIT.windowMs) {
      return;
    }

    windows.delete(userId);
  }
}

/** Conta uma escrita do aluno; false = passou de 30 no minuto (a rota responde 429 e nao escreve). */
export function takeStudentWrite(userId: string, now = Date.now()): boolean {
  dropExpired(now);

  const current = windows.get(userId);

  if (current && now - current.startedAt < STUDENT_WRITE_LIMIT.windowMs) {
    if (current.count >= STUDENT_WRITE_LIMIT.max) {
      return false;
    }

    current.count += 1;

    return true;
  }

  windows.delete(userId);

  while (windows.size >= MAX_TRACKED_STUDENTS) {
    const oldest = windows.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    windows.delete(oldest);
  }

  windows.set(userId, { count: 1, startedAt: now });

  return true;
}
