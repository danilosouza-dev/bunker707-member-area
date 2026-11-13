"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { chatRoleLabel } from "@/lib/webinar-room-client";
import type { ScreenCommentPlace, StudentScreenComment } from "@/server/webinars/screen-comment-model";
import { RoomCommentAvatar, RoomRoleBadge } from "../room-comment";
import { SCREEN_WIDE_ONLY } from "./room-screen-model";

// O comentario ou a pergunta que a equipe trouxe para a tela (rodada v9, P11; docs/30 D89; docs/31 §5.1 e §14), nas
// duas salas do desenho normal e na doca do vertical. A equipe escolhe uma mensagem do chat ou uma pergunta no console
// ("Mostrar na tela") e ela aparece para todos ate a equipe tirar ou mostrar outra; um por vez.
//
// No palco largo (640 px ou mais, a mesma regra do banner: SCREEN_WIDE_ONLY), o cartao sobre o video: a linha pequena
// "Comentário na tela" / "Pergunta na tela", o avatar de 24 px (a foto pela regra do chat, D62; sem ela, as iniciais; o
// Assistente e a Anonima antiga com o icone), o nome, o selo do papel da equipe e o texto em ate 4 linhas. Fica na mesma
// area segura da Na tela (abaixo dos selos de cima, acima dos de baixo e da barra do motor, a esquerda da coluna de
// miniaturas), embaixo no meio; com um banner, um QR Code ou a Oferta num canto de baixo ele vai para o outro lado, e com
// a fileira de baixo tomada sobe para cima (screenCommentPlace). Entra deslizando 12 px e aparecendo em 300 ms
// (ease-out); com "reduzir movimento", aparece sem movimento. Nada nele recebe o toque (so a equipe tira): o video por
// baixo continua clicavel. As cores sao as de cima do video (--room-on-video-*), iguais nos dois temas.
// No palco estreito, no baixo e com uma capa (a faixa abaixo do palco) e na doca do vertical, a mesma coisa numa linha
// (RoomScreenCommentRow), com o texto em ate 3 linhas.
// Um anuncio educado por chegada (RoomScreenCommentAnnouncer); a saida e silenciosa. Nenhuma frase escrita aqui.

const COPY = WEBINAR_COPY.naTela.aluno;

/** O nome da secao: "Comentário de Ana S. na tela" / "Pergunta de Ana S. na tela". */
export function screenCommentSectionName(comment: Pick<StudentScreenComment, "name" | "source">): string {
  return comment.source === "question" ? COPY.secaoPergunta(comment.name) : COPY.secaoComentario(comment.name);
}

/** O que o leitor de tela ouve na chegada. */
export function screenCommentAnnouncement(comment: Pick<StudentScreenComment, "body" | "name" | "source">): string {
  return comment.source === "question" ? COPY.anuncioPergunta(comment.name, comment.body) : COPY.anuncioComentario(comment.name, comment.body);
}

function CommentAvatar({ comment }: { comment: StudentScreenComment }) {
  return <RoomCommentAvatar imageSrc={comment.avatarUrl} kind={comment.avatar === "person" ? "person" : comment.avatar} name={comment.avatar === "person" ? comment.name : undefined} />;
}

/** A linha do autor: o nome e, na equipe e no Assistente, o selo do papel. */
function CommentAuthor({ className, comment }: { className?: string; comment: StudentScreenComment }) {
  const role = comment.role ? chatRoleLabel(comment.role) : null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate text-[13px] font-semibold leading-5">{comment.name}</span>
      {role && role !== comment.name ? <RoomRoleBadge>{role}</RoomRoleBadge> : null}
    </span>
  );
}

/** As classes de cada lugar do cartao dentro da area segura (a fileira de baixo sobe com o aviso da sala no palco). */
export const SCREEN_COMMENT_PLACE_CLASSES: Readonly<Record<ScreenCommentPlace, string>> = {
  bottom_center: "bottom-[var(--room-snackbar-offset,0px)] justify-center",
  bottom_left: "bottom-[var(--room-snackbar-offset,0px)] justify-start",
  bottom_right: "bottom-[var(--room-snackbar-offset,0px)] justify-end",
  top_center: "top-0 justify-center"
};

/** A largura do cartao: no meio, ate 44 % do palco; ao lado de um item de baixo, ate 52 % (o item fica com o resto). */
export const SCREEN_COMMENT_WIDTH: Readonly<Record<ScreenCommentPlace, string>> = {
  bottom_center: "w-[clamp(280px,44cqw,560px)]",
  bottom_left: "w-[clamp(260px,52cqw,560px)]",
  bottom_right: "w-[clamp(260px,52cqw,560px)]",
  top_center: "w-[clamp(280px,44cqw,560px)]"
};

/** O cartao do palco largo. */
export function RoomScreenCommentCard({ className, comment }: { className?: string; comment: StudentScreenComment }) {
  return (
    <section
      aria-label={screenCommentSectionName(comment)}
      className={cn(
        "max-w-full flex-col gap-1.5 rounded-[16px] bg-room-on-video-bg px-4 py-3 text-room-on-video-fg shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 motion-safe:ease-out",
        className
      )}
      data-room-screen-comment={comment.source}
      data-room-screen-display={comment.displayId}
    >
      <p aria-hidden="true" className="text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] opacity-70">
        {comment.source === "question" ? COPY.perguntaNaTela : COPY.comentarioNaTela}
      </p>
      <div className="flex min-w-0 items-start gap-3">
        <CommentAvatar comment={comment} />
        <div className="min-w-0 flex-1">
          <CommentAuthor comment={comment} />
          <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[15px] leading-[22px] [overflow-wrap:anywhere]" data-room-screen-comment-body="">
            {comment.body}
          </p>
        </div>
      </div>
    </section>
  );
}

export type RoomScreenCommentLayerProps = {
  comment: StudentScreenComment | null;
  /** Quem apresenta usa a barra do motor na pagina da sala: a margem de baixo e 96 px. */
  engineBar?: boolean;
  /** A capa no palco: nada sobre o video (a faixa mostra o comentario). */
  forced: boolean;
  /** Onde o cartao fica (screenCommentPlace). */
  place: ScreenCommentPlace;
};

/**
 * A camada do comentario no palco: o proprio recipiente `@container/tela` (o cartao so no palco de 640 px ou mais), no
 * plano da Na tela (z-20), sem receber o toque. Com a capa (`forced`) ou sem comentario, nada.
 */
export function RoomScreenCommentLayer({ comment, engineBar = false, forced, place }: RoomScreenCommentLayerProps) {
  if (!comment || forced) {
    return null;
  }
  return (
    <div className="@container/tela pointer-events-none absolute inset-0 z-20" data-room-screen-comment-layer="">
      <div className={cn("absolute left-3 right-[calc(var(--room-video-right,0px)+12px)] top-14 lg:left-4", engineBar ? "bottom-[calc(6rem+var(--room-video-bottom,0px))]" : "bottom-[calc(3.5rem+var(--room-video-bottom,0px))]")}>
        <div className={cn("absolute inset-x-0 flex", SCREEN_COMMENT_PLACE_CLASSES[place])} data-room-screen-comment-place={place}>
          {/* A chave e a exibicao: outro comentario no lugar toca a entrada de novo. */}
          <RoomScreenCommentCard className={cn(SCREEN_COMMENT_WIDTH[place], SCREEN_WIDE_ONLY)} comment={comment} key={comment.displayId} />
        </div>
      </div>
    </div>
  );
}

/**
 * O comentario numa linha: na faixa abaixo do palco (`form` strip: o palco estreito, o baixo e a capa; as cores da
 * sala) e na doca da sala vertical (`form` vertical: sempre escura, sobre o video). O texto em ate 3 linhas.
 */
export function RoomScreenCommentRow({ comment, form }: { comment: StudentScreenComment; form: "strip" | "vertical" }) {
  const vertical = form === "vertical";
  return (
    <section
      aria-label={screenCommentSectionName(comment)}
      className={cn("flex min-w-0 shrink-0 items-start gap-3 px-3 py-2", vertical ? "pointer-events-auto rounded-[12px] bg-black/60 text-white" : "border-b border-room-border text-room-fg last:border-b-0")}
      data-room-screen-comment-row={comment.source}
      data-room-screen-display={comment.displayId}
    >
      <CommentAvatar comment={comment} />
      <div className="min-w-0 flex-1">
        <p aria-hidden="true" className={cn("text-[11px] font-semibold uppercase leading-4 tracking-[0.04em]", vertical ? "opacity-70" : "text-room-fg-subtle")}>
          {comment.source === "question" ? COPY.perguntaNaTela : COPY.comentarioNaTela}
        </p>
        <CommentAuthor comment={comment} />
        <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]" data-room-screen-comment-body="">
          {comment.body}
        </p>
      </div>
    </section>
  );
}

/**
 * Um anuncio educado por chegada ("A equipe mostrou na tela o comentário de Ana S.: ..."): o que ja estava quando a
 * sala abriu nao e anunciado, e a saida e silenciosa. Cada anuncio e um paragrafo novo dentro da regiao polida.
 */
export function RoomScreenCommentAnnouncer({ comment }: { comment: StudentScreenComment | null }) {
  const id = comment?.displayId ?? "";
  const [state, setState] = useState(() => ({ id, n: 0, text: "" }));
  if (state.id !== id) {
    setState({ id, n: comment ? state.n + 1 : state.n, text: comment ? screenCommentAnnouncement(comment) : state.text });
  }
  return (
    <div aria-live="polite" className="sr-only" data-room-screen-comment-announce="">
      {state.text ? <p key={state.n}>{state.text}</p> : null}
    </div>
  );
}
