// Estado de liberacao de um conteudo, modulo ou aula PARA UM ALUNO, calculado no servidor.
//
// Fonte unica: `resolveReleaseState` (src/server/access/release-policy.ts) usa a mesma conta que as
// APIs da aula (lesson-access) e o catalogo da IA Diretor (learning-catalog). A pagina recebe o
// estado pronto e so formata o texto (src/lib/release-rules.ts). Assim a lista de aulas, o aviso
// sobre o video, os cards da home e a biblioteca mostram a MESMA data que o servidor usa para abrir
// a aula.
//
// Modulo puro, sem imports: roda no servidor, no navegador e nos testes.

export type MemberReleaseState =
  /** Liberado para este aluno agora. */
  | { status: "released" }
  /**
   * Libera sozinho em `availableAt` (ISO). `precision: "hour"` quando a regra e em horas ou a data
   * fixa tem horario; "day" quando o que importa e o dia (ex.: "7 dias apos a compra").
   */
  | { availableAt: string; precision: "day" | "hour"; status: "scheduled" }
  /** Depende de concluir a aula anterior (na ordem do curso). */
  | { previousLessonId?: string; status: "waiting_previous_lesson" }
  /** Depende de uma atividade obrigatoria que ainda nao tem como ser comprovada. */
  | { requirement?: string; status: "waiting_activity" }
  /**
   * Sem acesso real para calcular (previa do produtor, conteudo gratuito sem compra, visitante, acesso
   * so pelo cadastro antigo). A interface cai na frase generica da regra e continua bloqueada.
   */
  | { status: "unknown" };

export type MemberReleaseStatus = MemberReleaseState["status"];

export function isMemberReleaseState(value: unknown): value is MemberReleaseState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  return (
    status === "released" ||
    status === "scheduled" ||
    status === "waiting_previous_lesson" ||
    status === "waiting_activity" ||
    status === "unknown"
  );
}
