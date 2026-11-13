"use client";

import { MessageSquarePlus, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { scriptQueueSummary, type ScriptQueueItem } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { NO_PERSONA_LIST, commentFormFor, liveScriptDueLabel, personaAvatarUrl, personaUsage, type PersonaDraft, type PersonaList as PersonaListData, type WebinarPersona } from "@/server/webinars/persona-model";
import { offsetLabel } from "@/server/webinars/room-model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { PersonaList, type DeletePersonaResult, type SavePersonaResult } from "../persona-list";
import { returnConsoleFocus } from "./console-focus";
import { ConsoleScriptComment, type ScriptCommentFormInput, type ScriptCommentFormState } from "./console-script-comment";
import { useConsolePortal } from "./console-shell";

// O painel Roteiro do console (docs/30 §2.4 e §6.6 D6-c): a fila na ordem do minuto, o que ja entrou marcado, os
// itens "Pelo botão da equipe" e "Soltar agora" em qualquer mensagem que ainda nao entrou. Adendo de 10/11/2026 (R8 e
// R9): tambem na sessao da Live ao vivo (`live`: o minuto de cada item contado do Começar para todos, "Aos 12 minutos da
// live"), a foto de quem comenta em cada item e o "Novo comentário" (console-script-comment.tsx) no lugar da lista,
// com "Enviar agora" e "Guardar na lista", na live e na gravada; quem pode e quem tem messaging.write, como o Soltar.
// Ao fechar o formulario (Voltar, Cancelar, depois de enviar ou guardar), o foco volta ao "Novo comentário" (ou ao
// titulo do Roteiro; console-focus.ts). Na live, "Minuto já passou" so depois da tolerancia do tick (scriptQueue).
// As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D75 a D78): embaixo da fila, a lista "Pessoas que
// comentam" da escola (desde 13/11/2026, D115 e D117: uma lista so para todo webinario, fechada numa linha com as fotos
// e o total, que abre para gerenciar; persona-list.tsx: criar, editar e remover sem sair do console, a mesma do editor), com
// "Comentar como {nome}" em cada pessoa, que abre o Novo comentário com ela escolhida (o repetir). O "Novo comentário"
// abre com a ultima pessoa usada enquanto a pagina estiver aberta (`lastPersonaId`, guardado no SessionConsole), e o
// item Pergunta da fila leva o selo "Pergunta". Depois do "Enviar agora" o formulario fica aberto para o proximo; o
// Voltar e o "Guardar na lista" voltam para a lista.

const copy = WEBINAR_ADMIN_COPY.console.script;
const scriptCopy = WEBINAR_ADMIN_COPY.script;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
const PESSOAS = WEBINAR_COPY.pessoas;

type ConsoleScriptProps = {
  busyKey: string | null;
  canAct: boolean;
  /** O "Novo comentário" aberto ao desenhar, com o que ja foi escrito (o teste de tela). */
  initialComment?: ScriptCommentFormState | null;
  /** O formulario da lista aberto ao desenhar ("nova" ou o id da pessoa; o teste de tela). */
  initialPersonaForm?: string | null;
  /** A lista de pessoas aberta ao desenhar (o teste de tela; fechada, uma linha com as fotos e o total, D117). */
  initialPersonasOpen?: boolean;
  /** A ultima pessoa usada no Novo comentário (o SessionConsole guarda enquanto a pagina estiver aberta). */
  lastPersonaId?: string | null;
  /** A sessao da Live ao vivo: o minuto dos itens contado do Começar para todos. */
  live?: boolean;
  /** "Enviar agora" e "Guardar na lista" do "Novo comentário"; sem ele, o botao nao aparece. */
  onComment?: (input: ScriptCommentFormInput, mode: "save" | "send") => Promise<ActionResult<{ persona: WebinarPersona | null }> | null>;
  /** Remover uma pessoa da lista; sem ele (e sem o salvar), a lista nao aparece. */
  onDeletePersona?: (persona: WebinarPersona) => Promise<DeletePersonaResult | null>;
  onFire: (itemId: string) => void;
  /** Criar ou editar uma pessoa da lista. */
  onSavePersona?: (draft: PersonaDraft) => Promise<SavePersonaResult | null>;
  /** O envio da foto de quem comenta (uploadPersonaPhoto). */
  onUpload?: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  /** A origem do nosso Supabase (a foto de quem comenta); sem ela, a do ambiente. */
  origin?: string | null;
  /** A lista "Pessoas que comentam" do webinario (o retrato do console); ausente, o banco sem a lista. */
  personas?: PersonaListData;
  queue: readonly ScriptQueueItem[];
};

export function ConsoleScript({
  busyKey,
  canAct,
  initialComment = null,
  initialPersonaForm = null,
  initialPersonasOpen = false,
  lastPersonaId = null,
  live = false,
  onComment,
  onDeletePersona,
  onFire,
  onSavePersona,
  onUpload,
  origin,
  personas = NO_PERSONA_LIST,
  queue
}: ConsoleScriptProps) {
  const [comment, setComment] = useState<ScriptCommentFormState | null>(initialComment);
  const returnFocus = useRef(false);
  const portal = useConsolePortal();
  const summary = scriptQueueSummary(queue);
  const photoOrigin = origin === undefined ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null) : origin;
  const usage = Object.fromEntries(personas.personas.map((persona) => [persona.id, personaUsage(queue, persona.id)]));

  useEffect(() => {
    if (comment || !returnFocus.current) {
      return;
    }
    returnFocus.current = false;
    returnConsoleFocus({ heading: "console-script-title", opener: "[data-console-script-new]" });
  }, [comment]);

  if (comment && onComment && onUpload) {
    return (
      <ConsoleScriptComment
        busy={busyKey !== null}
        canSend={canAct}
        initialState={comment}
        listAvailable={personas.available}
        onBack={() => {
          returnFocus.current = true;
          setComment(null);
        }}
        onSubmit={onComment}
        onUpload={onUpload}
        origin={photoOrigin}
        personas={personas.personas}
      />
    );
  }

  const due = (item: ScriptQueueItem) => (item.dueOffsetMs == null ? copy.manual : live ? liveScriptDueLabel(item.dueOffsetMs) : offsetLabel(item.dueOffsetMs));
  // O Novo comentário abre com a ultima pessoa usada (quando ela continua na lista).
  const last = lastPersonaId ? (personas.personas.find((persona) => persona.id === lastPersonaId) ?? null) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SectionCard
        actions={
          onComment && onUpload ? (
            <Button className="h-8! px-2 text-[13px]" data-console-script-new="" onClick={() => setComment(commentFormFor(last))} type="button" variant="secondary">
              <MessageSquarePlus aria-hidden="true" className="size-4" />
              {COMENTARIOS.novoComentario}
            </Button>
          ) : undefined
        }
        description={copy.summary(summary.fired, summary.pending, summary.manual)}
        title={copy.title}
        titleFocusable
        titleId="console-script-title"
      >
        {/* Sem item, so a frase: nenhuma lista vazia para o leitor de tela. */}
        {queue.length === 0 ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{live ? copy.emptyLive : copy.empty}</p>
        ) : (
          <ol className="flex max-h-[50vh] min-w-0 flex-col gap-2 overflow-y-auto" data-console-script="">
            {queue.map((item) => (
              <li className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2", item.fired && "opacity-70", item.status === "disabled" && "opacity-50")} data-script-item={item.id} data-script-fired={item.fired ? "true" : "false"} key={item.id}>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
                  <RoomCommentAvatar imageSrc={personaAvatarUrl(item.personaAvatarPath, photoOrigin)} kind={item.personaRole === "team" ? "team" : "person"} name={item.personaName} />
                  <span className="tabular-nums">{due(item)}</span>
                  <span className="font-medium text-[var(--text-primary)]">{item.personaName}</span>
                  <span>· {scriptCopy.roles[item.personaRole]}</span>
                  {item.kind === "question" ? <StatusChip tone="neutral">{PESSOAS.seloPergunta}</StatusChip> : null}
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
        )}
      </SectionCard>
      {onSavePersona && onDeletePersona && onUpload ? (
        <SectionCard title={PESSOAS.titulo} titleId="console-personas-title">
          <PersonaList
            available={personas.available}
            busy={busyKey !== null}
            container={portal}
            initialForm={initialPersonaForm}
            initialOpen={initialPersonasOpen}
            onCommentAs={onComment ? (persona) => setComment(commentFormFor(persona)) : undefined}
            onDelete={onDeletePersona}
            onSave={onSavePersona}
            onUpload={onUpload}
            origin={photoOrigin}
            personas={personas.personas}
            showTitle={false}
            usage={usage}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
