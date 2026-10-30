"use client";

import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { countdownLabel } from "@/lib/webinar-time";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { LIVE_ROOM_REFRESH_MS, liveEnterState, shouldWatchLiveRoom } from "@/server/webinars/live-banner";
import { canJoinSimulated } from "@/server/webinars/room-model";
import type { SessionKind, SessionStatus } from "@/server/webinars/model";
import { roomHref } from "@/server/webinars/student-model";
import { useTickingNow } from "./use-ticking-now";

// Entrar na Sala (docs/30 §1.2, §1.3 e §1.6). Na Live gravada o botao vira um link para a sala de 15 minutos antes da
// hora marcada ate o fim do video (ou ate a Entrada atrasada marcada pela equipe); antes disso diz quando abre e,
// depois, que a sessao passou. Na Live ao vivo (fase 3, liveEnterState): com a sala aberta pela equipe (Aguardando o
// apresentador) ou no ar, o link para a sala; antes da hora, a contagem; da hora ate a equipe abrir, nada de link (a
// pagina diz Aguardando o apresentador e reconsulta a cada 15 s, LiveRoomWatcher); encerrada, "Essa live acabou.". Sem
// a sala neste ambiente (WEBINAR_MEET_DOMAIN e o segredo do token; a pagina le no servidor e passa
// `liveRoomConfigured`), o Entrar fica desligado com "em breve". A decisao e refeita a cada 15 s no navegador; a sala
// confere de novo no servidor ao abrir (e o join-token, na live).

type EnterSession = { id: string; kind: SessionKind; lateJoinMinutes: number | null; scheduledAt: string; startedAt: string | null; status: SessionStatus };

function ComingSoon({ label, variant }: { label: string; variant: "primary" | "secondary" }) {
  const copy = WEBINAR_COPY.aluno;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <MemberButton aria-disabled="true" disabled title={copy.emBreve} variant={variant}>
        {label}
      </MemberButton>
      <MemberChip tone="muted">{copy.emBreve}</MemberChip>
    </div>
  );
}

function EnterLink({ href }: { href: string }) {
  return (
    <div className="mt-3">
      <MemberButtonLink href={href} size="lg" variant="primary">
        <Radio />
        {WEBINAR_COPY.aluno.entrar}
      </MemberButtonLink>
    </div>
  );
}

export function WebinarEnterButton({
  accessPreviewMode,
  durationMinutes,
  liveRoomConfigured = false,
  serverNow,
  session,
  slug
}: {
  accessPreviewMode?: AccessPreviewMode;
  durationMinutes: number;
  /** A sala ao vivo existe neste ambiente (liveRoomConfigured(process.env), lido no servidor); sem ela, "em breve". */
  liveRoomConfigured?: boolean;
  serverNow: number;
  session: EnterSession;
  slug: string;
}) {
  const copy = WEBINAR_COPY;
  const now = useTickingNow(serverNow);
  const href = withAccessPreviewParam(roomHref(slug, session.id), accessPreviewMode);

  if (session.kind === "live") {
    switch (liveEnterState(session, { liveRoomConfigured, nowMs: now })) {
      case "unavailable":
        return <ComingSoon label={copy.aluno.entrar} variant="primary" />;
      case "enter":
        return <EnterLink href={href} />;
      case "countdown":
        return <p className="mt-3 text-sm leading-6 text-zinc-300">{countdownLabel(session.scheduledAt, now) || copy.aluno.aguardando}</p>;
      case "ended":
        return <p className="mt-3 text-sm leading-6 text-zinc-300">{copy.aluno.encerrada}</p>;
      default:
        // Aguardando o apresentador: a frase fica no bloco da pagina, sem link ate a equipe abrir a sala.
        return null;
    }
  }

  const join = canJoinSimulated({ ...session, recordingAnchorAt: null }, Math.max(1, durationMinutes) * 60_000, now);

  if (!join.ok) {
    return <p className="mt-3 text-sm leading-6 text-zinc-300">{join.reason === "not_started" ? copy.sala.naoComecou : join.reason === "late" ? copy.sala.entradaAtrasada : copy.sala.encerrada}</p>;
  }

  return <EnterLink href={href} />;
}

/**
 * A Live ao vivo ainda nao aberta (de 15 min antes da hora marcada ate a equipe abrir a sala): a pagina reconsulta o
 * servidor a cada 15 s (router.refresh, so com a aba visivel) e o Entrar aparece quando a sessao vira `waiting` ou
 * `live`. Nao desenha nada.
 */
export function LiveRoomWatcher({
  liveRoomConfigured,
  serverNow,
  session
}: {
  liveRoomConfigured: boolean;
  serverNow: number;
  session: Pick<EnterSession, "kind" | "scheduledAt" | "status">;
}) {
  const router = useRouter();
  const now = useTickingNow(serverNow);
  const watching = shouldWatchLiveRoom(session, { liveRoomConfigured, nowMs: now });

  useEffect(() => {
    if (!watching) {
      return;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, LIVE_ROOM_REFRESH_MS);

    return () => window.clearInterval(id);
  }, [router, watching]);

  return null;
}

/** Assistir o replay (docs/30 §1.2 e §1.6): abre a sala da sessao `replay` quando ela existe. */
export function WebinarReplayButton({ accessPreviewMode, replaySessionId, slug }: { accessPreviewMode?: AccessPreviewMode; replaySessionId: string | null; slug: string }) {
  const copy = WEBINAR_COPY.aluno;

  if (!replaySessionId) {
    return <ComingSoon label={copy.assistirReplay} variant="secondary" />;
  }

  return (
    <div className="mt-3">
      <MemberButtonLink href={withAccessPreviewParam(roomHref(slug, replaySessionId), accessPreviewMode)} variant="secondary">
        {copy.assistirReplay}
      </MemberButtonLink>
    </div>
  );
}
