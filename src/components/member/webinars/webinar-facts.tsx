import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { StudentSessionView } from "@/server/webinars/student-model";
import { WebinarLocalTime } from "./webinar-local-time";

// Quando (em Sao Paulo, com "(no seu horario: 21:00)" quando o aparelho esta em outro fuso), Duracao e
// Apresentador (docs/30 §1.2), a mesma lista na pagina do Webinario e no destaque de /webinarios.

export function WebinarFacts({
  className,
  durationLabel,
  presenterName,
  session
}: {
  className?: string;
  durationLabel: string;
  presenterName: string | null;
  session: Pick<StudentSessionView, "scheduledAt" | "whenLabel">;
}) {
  const copy = WEBINAR_COPY.aluno;

  return (
    <dl className={cn("grid gap-2 text-sm", className)}>
      <div className="flex gap-3">
        <dt className="w-24 shrink-0 text-zinc-500">{copy.quando}</dt>
        <dd className="min-w-0 text-zinc-200">
          {session.whenLabel} <span className="text-zinc-500">({copy.horarioBrasilia})</span>{" "}
          <WebinarLocalTime className="block text-zinc-500 sm:inline" iso={session.scheduledAt} />
        </dd>
      </div>
      <div className="flex gap-3">
        <dt className="w-24 shrink-0 text-zinc-500">{copy.duracao}</dt>
        <dd className="min-w-0 text-zinc-200">{durationLabel}</dd>
      </div>
      {presenterName ? (
        <div className="flex gap-3">
          <dt className="w-24 shrink-0 text-zinc-500">{copy.apresentador}</dt>
          <dd className="min-w-0 truncate text-zinc-200">{presenterName}</dd>
        </div>
      ) : null}
    </dl>
  );
}
