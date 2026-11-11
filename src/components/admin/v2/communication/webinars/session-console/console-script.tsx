"use client";

import { MessageSquarePlus, Zap } from "lucide-react";
import { useState } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { scriptQueueSummary, type ScriptQueueItem } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { liveScriptDueLabel, personaAvatarUrl } from "@/server/webinars/persona-model";
import { offsetLabel } from "@/server/webinars/room-model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { ConsoleScriptComment, type ScriptCommentFormInput, type ScriptCommentFormState } from "./console-script-comment";

// O painel Roteiro do console (docs/30 §2.4 e §6.6 D6-c): a fila na ordem do minuto, o que ja entrou marcado, os
// itens "Pelo botão da equipe" e "Soltar agora" em qualquer mensagem que ainda nao entrou. Adendo de 10/11/2026 (R8 e
// R9): tambem na sessao da Live ao vivo (`live`: o minuto de cada item contado do Começar para todos, "Aos 12 minutos da
// live"), a foto de quem comenta em cada item e o "Novo comentário" (console-script-comment.tsx) no lugar da lista,
// com "Enviar agora" e "Guardar na lista", na live e na gravada; quem pode e quem tem messaging.write, como o Soltar.

const copy = WEBINAR_ADMIN_COPY.console.script;
const scriptCopy = WEBINAR_ADMIN_COPY.script;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;

type ConsoleScriptProps = {
  busyKey: string | null;
  canAct: boolean;
  /** O "Novo comentário" aberto ao desenhar, com o que ja foi escrito (o teste de tela). */
  initialComment?: ScriptCommentFormState | null;
  /** A sessao da Live ao vivo: o minuto dos itens contado do Começar para todos. */
  live?: boolean;
  /** "Enviar agora" e "Guardar na lista" do "Novo comentário"; sem ele, o botao nao aparece. */
  onComment?: (input: ScriptCommentFormInput, mode: "save" | "send") => Promise<ActionResult<unknown> | null>;
  onFire: (itemId: string) => void;
  /** O envio da foto de quem comenta (uploadPersonaPhoto). */
  onUpload?: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  /** A origem do nosso Supabase (a foto de quem comenta); sem ela, a do ambiente. */
  origin?: string | null;
  queue: readonly ScriptQueueItem[];
};

export function ConsoleScript({ busyKey, canAct, initialComment = null, live = false, onComment, onFire, onUpload, origin, queue }: ConsoleScriptProps) {
  const [comment, setComment] = useState<ScriptCommentFormState | null>(initialComment);
  const summary = scriptQueueSummary(queue);
  const photoOrigin = origin === undefined ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null) : origin;

  if (comment && onComment && onUpload) {
    return (
      <ConsoleScriptComment
        busy={busyKey !== null}
        canSend={canAct}
        initialState={comment}
        onBack={() => setComment(null)}
        onSubmit={onComment}
        onUpload={onUpload}
      />
    );
  }

  const due = (item: ScriptQueueItem) => (item.dueOffsetMs == null ? copy.manual : live ? liveScriptDueLabel(item.dueOffsetMs) : offsetLabel(item.dueOffsetMs));

  return (
    <SectionCard
      actions={
        onComment && onUpload ? (
          <Button className="h-8! px-2 text-[13px]" data-console-script-new="" onClick={() => setComment({ applyToName: true, body: "", personaAvatarPath: null, personaName: "", personaRole: "student" })} type="button" variant="secondary">
            <MessageSquarePlus aria-hidden="true" className="size-4" />
            {COMENTARIOS.novoComentario}
          </Button>
        ) : undefined
      }
      description={copy.summary(summary.fired, summary.pending, summary.manual)}
      title={copy.title}
      titleId="console-script-title"
    >
      {queue.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{live ? copy.emptyLive : copy.empty}</p> : null}
      <ol className="flex max-h-[50vh] min-w-0 flex-col gap-2 overflow-y-auto" data-console-script="">
        {queue.map((item) => (
          <li className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2", item.fired && "opacity-70", item.status === "disabled" && "opacity-50")} data-script-item={item.id} data-script-fired={item.fired ? "true" : "false"} key={item.id}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
              <RoomCommentAvatar imageSrc={personaAvatarUrl(item.personaAvatarPath, photoOrigin)} kind={item.personaRole === "team" ? "team" : "person"} name={item.personaName} />
              <span className="tabular-nums">{due(item)}</span>
              <span className="font-medium text-[var(--text-primary)]">{item.personaName}</span>
              <span>· {scriptCopy.roles[item.personaRole]}</span>
              {item.fired ? <StatusChip tone="success">{copy.fired}</StatusChip> : item.passed ? <StatusChip tone="warning">{copy.passed}</StatusChip> : null}
              {item.status === "unresolved" ? <StatusChip tone="warning">{scriptCopy.statuses.unresolved}</StatusChip> : null}
              {item.status === "disabled" ? <StatusChip tone="muted">{scriptCopy.statuses.disabled}</StatusChip> : null}
            </div>
            <p className="line-clamp-2 text-sm leading-5 text-[var(--text-primary)]">{item.body}</p>
            {canAct && !item.fired && item.status !== "disabled" ? (
              <div>
                <Button className="h-8! px-2 text-[13px]" disabled={busyKey === `fire:${item.id}`} onClick={() => onFire(item.id)} type="button" variant="secondary">
                  <Zap aria-hidden="true" className="size-4" />
                  {copy.fire}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
