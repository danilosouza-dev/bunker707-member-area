import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberPosterCard } from "@/components/member/ui/member-poster-card";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { phaseLabel, type StudentWebinarView } from "@/server/webinars/student-model";
import { WebinarCountdown } from "./webinar-countdown";

// O card vertical do Webinario (docs/30 §1.1): o mesmo MemberPosterCard das grades do aluno, com o tipo
// (Live ao vivo / Live gravada) e a situacao na capa, a data em Sao Paulo abaixo do titulo e, na fileira
// Proxima live, a contagem regressiva andando no navegador.

export type WebinarCardVariant = "in_progress" | "replay" | "upcoming";

export function WebinarPosterCard({
  accessPreviewMode,
  className,
  priority = false,
  serverNow,
  variant,
  view
}: {
  accessPreviewMode?: AccessPreviewMode;
  className?: string;
  priority?: boolean;
  serverNow: number;
  variant: WebinarCardVariant;
  view: StudentWebinarView;
}) {
  const copy = WEBINAR_COPY.aluno;
  const session = view.primary;
  const kindChip = <MemberChip tone="neutral">{view.kindLabel}</MemberChip>;
  let badge: ReactNode = kindChip;
  let meta: ReactNode = view.durationLabel;
  let footer: ReactNode = null;

  if (variant === "upcoming") {
    badge = (
      <>
        {kindChip}
        {view.phase === "registered" ? <MemberChip tone="success">{copy.selo.vagaGarantida}</MemberChip> : null}
        {view.phase === "sold_out" ? <MemberChip tone="warning">{phaseLabel("sold_out")}</MemberChip> : null}
      </>
    );
    meta = session ? `${session.whenLabel} · ${view.durationLabel}` : view.durationLabel;
    footer = session ? <WebinarCountdown fallback={copy.aguardando} serverNow={serverNow} targetIso={session.scheduledAt} /> : null;
  } else if (variant === "in_progress") {
    badge = (
      <>
        {kindChip}
        {view.phase === "live" ? (
          <MemberChip icon={Radio} tone="accent">
            {copy.selo.aoVivo}
          </MemberChip>
        ) : (
          <MemberChip tone="warning">{copy.aguardando}</MemberChip>
        )}
      </>
    );
    meta = session ? session.whenLabel : view.kindLabel;
    footer = copy.entrar;
  } else {
    badge = (
      <>
        {kindChip}
        <MemberChip tone="solid">{copy.selo.replay}</MemberChip>
      </>
    );
    meta = view.presenterName ? `${copy.apresentador}: ${view.presenterName}` : view.durationLabel;
    footer = copy.replayDisponivel;
  }

  return (
    <MemberPosterCard
      badge={badge}
      className={className}
      footer={footer}
      href={withAccessPreviewParam(view.href, accessPreviewMode)}
      image={view.coverUrl}
      meta={meta}
      priority={priority}
      title={view.title}
    />
  );
}
