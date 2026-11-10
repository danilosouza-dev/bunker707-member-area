import { CalendarDays, Clock3 } from "lucide-react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
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

/**
 * Os mesmos fatos numa linha, para o topo da pagina do Webinario (docs/31 V2-17): o icone vermelho, a data em Sao Paulo
 * em destaque com "(horário de Brasília)" e o horario do aparelho quando o fuso e outro, a duracao e quem apresenta (as
 * iniciais num circulo, o nome em destaque e "Apresentador"). Cada fato diz o proprio nome ao leitor de tela.
 */
export function WebinarFactsRow({
  className,
  durationLabel,
  presenterName,
  session
}: {
  className?: string;
  durationLabel: string;
  presenterName: string | null;
  /** A sessao em destaque; sem ela (so o "Comeca quando voce entra"), a linha fica sem a data. */
  session: Pick<StudentSessionView, "scheduledAt" | "whenLabel"> | null;
}) {
  const copy = WEBINAR_COPY.aluno;
  const item = "flex min-w-0 items-center gap-2";
  const icon = "size-[18px] shrink-0 text-[var(--accent)]";

  return (
    <ul className={cn("flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-zinc-200", className)} data-webinar-facts="">
      {session ? (
        <li className={item}>
          <CalendarDays aria-hidden="true" className={icon} strokeWidth={2.2} />
          <span className="min-w-0">
            <span className="sr-only">{copy.quando}: </span>
            <strong className="font-bold text-white">{session.whenLabel}</strong> <span className="text-zinc-400">({copy.horarioBrasilia})</span>{" "}
            <WebinarLocalTime className="text-zinc-400" iso={session.scheduledAt} />
          </span>
        </li>
      ) : null}
      <li className={item}>
        <Clock3 aria-hidden="true" className={icon} strokeWidth={2.2} />
        <span>
          <span className="sr-only">{copy.duracao}: </span>
          {durationLabel}
        </span>
      </li>
      {presenterName ? (
        <li className={item}>
          <MemberAvatar className="size-7" name={presenterName} size="xs" />
          <span className="min-w-0 truncate">
            <strong className="font-bold text-white">{presenterName}</strong> <span className="text-zinc-400">· {copy.apresentador}</span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}
