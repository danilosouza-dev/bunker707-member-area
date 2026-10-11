import { CalendarClock, LockKeyhole, LockOpen, RotateCw } from "lucide-react";
import type { ReleaseRuleNotice } from "@/lib/release-rules";

// Aviso sobre o video quando a aula ainda nao abriu para o aluno.
// - Agendada: "Esta aula será liberada" + "Liberação em 08/01/2026" + "Conta a partir da data da sua compra."
// - A data passou com a pagina aberta ("due"): "Esta aula já foi liberada" + botao "Atualizar agora"
//   (a pagina tambem se atualiza sozinha; o botao e o plano B).
// - Sem data (aula anterior, atividade, acesso pendente): cadeado + motivo.
// O texto com "hoje" depende do relogio: suppressHydrationWarning so nesse trecho.

export type LessonLockNotice = Pick<ReleaseRuleNotice, "detail" | "title"> &
  Partial<Pick<ReleaseRuleNotice, "hint" | "isClockDependent" | "kind">>;

export function LessonReleaseOverlay({
  notice,
  onRefresh
}: {
  notice: LessonLockNotice;
  onRefresh: () => void;
}) {
  const isScheduled = notice.kind === "scheduled";
  const isDue = notice.kind === "due";
  const Icon = isScheduled ? CalendarClock : isDue ? LockOpen : LockKeyhole;

  return (
    <div
      className="absolute left-1/2 top-1/2 z-40 w-[min(25rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-white/12 bg-black/80 px-4 py-3.5 text-center shadow-2xl shadow-black/60 backdrop-blur-md sm:px-6 sm:py-6"
      role="status"
    >
      <span
        aria-hidden="true"
        className={`mx-auto grid size-9 place-items-center rounded-full ring-1 sm:size-12 ${
          isDue ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30" : "bg-white/10 text-white ring-white/15"
        }`}
      >
        <Icon className="size-[18px] sm:size-6" strokeWidth={2.3} />
      </span>
      <p className="mt-2 text-[15px] font-black leading-tight text-white sm:mt-3 sm:text-lg" suppressHydrationWarning>
        {notice.title}
      </p>
      {isScheduled ? (
        <p
          className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/12 px-3 py-1.5 text-[13px] font-bold leading-none text-amber-100 sm:mt-3 sm:text-sm"
          suppressHydrationWarning
        >
          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" strokeWidth={2.4} />
          <span className="truncate">{notice.detail}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] font-semibold leading-5 text-zinc-300 sm:mt-2 sm:text-sm sm:leading-6" suppressHydrationWarning>
          {notice.detail}
        </p>
      )}
      {isScheduled && notice.hint ? (
        <p className="mt-2 text-[11px] font-medium leading-4 text-zinc-400 sm:text-xs">{notice.hint}</p>
      ) : null}
      {isDue ? (
        <button
          className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-extrabold text-black transition hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={onRefresh}
          type="button"
        >
          <RotateCw aria-hidden="true" className="size-4" strokeWidth={2.4} />
          Atualizar agora
        </button>
      ) : null}
    </div>
  );
}
