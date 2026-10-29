"use client";

import { Radio } from "lucide-react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { canJoinSimulated } from "@/server/webinars/room-model";
import type { SessionKind, SessionStatus } from "@/server/webinars/model";
import { roomHref } from "@/server/webinars/student-model";
import { useTickingNow } from "./use-ticking-now";

// Entrar na Sala (docs/30 §1.2 e §1.6): na Live gravada o botao vira um link para a sala de 15 minutos antes da
// hora marcada ate o fim do video (ou ate a Entrada atrasada marcada pela equipe); antes disso diz quando abre e,
// depois, que a sessao passou. A Live ao vivo continua "em breve" (a sala ao vivo chega na fase 3). A decisao e
// refeita a cada 15 s no navegador; a sala confere de novo no servidor ao abrir.

export function WebinarEnterButton({
  accessPreviewMode,
  durationMinutes,
  serverNow,
  session,
  slug
}: {
  accessPreviewMode?: AccessPreviewMode;
  durationMinutes: number;
  serverNow: number;
  session: { id: string; kind: SessionKind; lateJoinMinutes: number | null; scheduledAt: string; startedAt: string | null; status: SessionStatus };
  slug: string;
}) {
  const copy = WEBINAR_COPY;
  const now = useTickingNow(serverNow);

  if (session.kind === "live") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MemberButton aria-disabled="true" disabled title={copy.aluno.emBreve} variant="primary">
          {copy.aluno.entrar}
        </MemberButton>
        <MemberChip tone="muted">{copy.aluno.emBreve}</MemberChip>
      </div>
    );
  }

  const join = canJoinSimulated({ ...session, recordingAnchorAt: null }, Math.max(1, durationMinutes) * 60_000, now);

  if (!join.ok) {
    return <p className="mt-3 text-sm leading-6 text-zinc-300">{join.reason === "not_started" ? copy.sala.naoComecou : join.reason === "late" ? copy.sala.entradaAtrasada : copy.sala.encerrada}</p>;
  }

  return (
    <div className="mt-3">
      <MemberButtonLink href={withAccessPreviewParam(roomHref(slug, session.id), accessPreviewMode)} size="lg" variant="primary">
        <Radio />
        {copy.aluno.entrar}
      </MemberButtonLink>
    </div>
  );
}

/** Assistir o replay (docs/30 §1.2 e §1.6): abre a sala da sessao `replay` quando ela existe. */
export function WebinarReplayButton({ accessPreviewMode, replaySessionId, slug }: { accessPreviewMode?: AccessPreviewMode; replaySessionId: string | null; slug: string }) {
  const copy = WEBINAR_COPY.aluno;

  if (!replaySessionId) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MemberButton aria-disabled="true" disabled title={copy.emBreve} variant="secondary">
          {copy.assistirReplay}
        </MemberButton>
        <MemberChip tone="muted">{copy.emBreve}</MemberChip>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <MemberButtonLink href={withAccessPreviewParam(roomHref(slug, replaySessionId), accessPreviewMode)} variant="secondary">
        {copy.assistirReplay}
      </MemberButtonLink>
    </div>
  );
}
