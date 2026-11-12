"use client";

import { ChevronDown, ChevronUp, Megaphone, QrCode } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { QR_MIN_MODULE_PX, qrModules, type ScreenEventForm, type ScreenEventTarget, type StudentScreenItem } from "@/server/webinars/screen-model";
import { ROOM_TOUCH_44, RoomPill, roomPillClassName } from "../room-pill";
import { RoomPinnedRows, type RoomPinnedShortcutsProps } from "./room-pinned";
import { RoomScreenClose, RoomScreenImage, RoomScreenLink, RoomScreenQr, RoomScreenStays, type ScreenItemHandlers } from "./room-screen-card";
import { SCREEN_NARROW_FLEX, screenBannerAction, screenImageSrc, screenLinkOf, screenRowDetail, screenRowExpandable, screenRowTitle, screenSectionName } from "./room-screen-model";
import { useScreenShownRef } from "./use-room-screen";
import type { StudentScreenComment } from "@/server/webinars/screen-comment-model";
import { RoomScreenCommentRow } from "./room-screen-comment";

// A faixa da Na tela (especificacao de 10/11/2026, §3.1, §3.3, §3.4 e §3.7): fora do video, no fluxo da pagina, logo
// abaixo do palco e acima da barra, quando o palco tem menos de 640 px (o celular de 375 px), quando a tela tem 500 px
// de altura ou menos (o celular deitado: o palco largo e baixo demais para os cartoes) ou quando ha uma capa no palco
// (antes de "Entrar na sala", "Abrindo a sala…", "Reconectando…", a espera, "Ativar som"): a capa forca a faixa pelo
// data-tela="faixa". A regra e so CSS (SCREEN_NARROW_FLEX): o proprio invólucro e o recipiente @container/tela (a
// largura da coluna, a mesma do palco), sem medir em JavaScript e sem piscar; a partir de lg ele sobe os 12 px do gap da
// coluna e o conteudo desce 12 px, entao escondido ele nao ocupa espaco. Primeiro as linhas das fixadas (com o painel
// fechado; RoomPinnedRows), depois o banner e o QR Code, cada um uma linha de 56 px: [miniatura de 40 px ou o icone do
// QR Code] [titulo; texto, uma linha cada] [o botao, ou "Abrir o link", com a area de toque de 44 px] [Mostrar /
// Recolher quando ha imagem, mais texto ou o QR
// Code] [o X so se pode fechar]. Mostrar abre o conteudo inteiro no fluxo (a imagem ate 40 % da altura da tela; o QR
// Code a 160 px, para ler com outro aparelho), empurrando o painel para baixo; Recolher e sempre permitido e nao e
// fechar. No maximo 120 px de faixa (com uma linha aberta, ate 45 % da tela), o resto rola por dentro. O banner que nao
// pode fechar e a mesma linha, sem o X: nunca cobre o video, os controles, o chat, a barra nem o Sair.
// A linha compacta de 48 px (RoomScreenCompactRow): dentro do palco, na borda de cima, na tela cheia de verdade com o
// palco estreito ou baixo (a faixa de fora nao aparece em tela cheia), e na doca da sala vertical 9:16 (RoomScreenDock, no maximo
// duas, antes da pilula da Oferta; somem com a gaveta aberta, como o resto da doca). No celular a acao principal do QR
// Code e "Abrir o link" (ninguem aponta a camera para a propria tela). So tokens --room-* (o vertical, sempre escuro,
// fica sobre o video); nenhuma frase escrita aqui.

/** O lado do QR Code aberto na faixa: 160 px, subindo ate 3 px por modulo num link comprido. */
export const SCREEN_STRIP_QR_PX = 160;

function stripQrSide(link: string): number {
  return Math.max(SCREEN_STRIP_QR_PX, (qrModules(link) ?? 0) * QR_MIN_MODULE_PX);
}

/** A acao da linha: o botao do banner, "Abrir o link" do banner sem texto do botao e do QR Code, ou nada (sem link). */
function rowAction(item: StudentScreenItem): { href: string; label: string; target: ScreenEventTarget } | null {
  const href = screenLinkOf(item);
  if (!href) {
    return null;
  }
  const abrir = WEBINAR_COPY.naTela.aluno.abrirOLink;
  if (item.kind === "qr") {
    return { href, label: abrir, target: "qr_link" };
  }
  const action = screenBannerAction(item);
  // A linha tem uma acao so: com o botao clicavel ("Só o botão" ou "Imagem e botão"), o texto dele; senao, "Abrir o link".
  return (action === "button" || action === "both") && item.buttonLabel ? { href, label: item.buttonLabel, target: "button" } : { href, label: abrir, target: "card" };
}

/** A miniatura da linha: a imagem do banner (decorativa: o nome da secao ja diz o que e) ou o icone do tipo. */
function RowThumb({ className, item }: { className: string; item: StudentScreenItem }) {
  const src = item.image ? screenImageSrc(item.image.url) : null;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- miniatura do nosso bucket; a imagem inteira tem o alt quando a linha abre.
    return <img alt="" aria-hidden="true" className={cn("shrink-0 object-cover", className)} decoding="async" height={40} src={src} width={40} />;
  }
  const Icon = item.kind === "qr" ? QrCode : Megaphone;
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-room-control text-room-fg [&_svg]:size-4", className)}>
      <Icon strokeWidth={2} />
    </span>
  );
}

/** Uma linha de 56 px da faixa, com o conteudo inteiro no fluxo quando aberta. */
export function RoomScreenRow({ expanded, handlers, item, onToggle }: { expanded: boolean; handlers?: ScreenItemHandlers; item: StudentScreenItem; onToggle: () => void }) {
  const aluno = WEBINAR_COPY.naTela.aluno;
  const id = useId();
  const ref = useScreenShownRef<HTMLElement>(handlers?.watch, item.displayId, "strip");
  const action = rowAction(item);
  const detail = screenRowDetail(item);
  const expandable = screenRowExpandable(item);
  const href = screenLinkOf(item);

  return (
    <section aria-label={screenSectionName(item)} className="shrink-0 border-t border-room-border first:border-t-0" data-room-screen-display={item.displayId} data-room-screen-row={item.kind} ref={ref}>
      <div className="flex min-h-14 items-center gap-3 px-3 py-2">
        <RowThumb className="size-10 rounded-[10px]" item={item} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold leading-5 text-room-fg">{screenRowTitle(item)}</span>
          {detail ? <span className="truncate text-xs leading-[18px] text-room-fg-subtle">{detail}</span> : null}
        </span>
        {action ? (
          <RoomScreenLink className={roomPillClassName({ className: cn(ROOM_TOUCH_44, "min-w-24 max-w-[45%]"), size: "s", tone: "white" })} href={action.href} onClick={() => handlers?.onClick?.(item.displayId, "strip", action.target)}>
            <span className="truncate">{action.label}</span>
          </RoomScreenLink>
        ) : null}
        {expandable ? (
          <RoomPill
            aria-controls={`${id}-c`}
            aria-expanded={expanded}
            data-room-screen-toggle=""
            icon={expanded ? ChevronUp : ChevronDown}
            label={expanded ? aluno.recolher : aluno.mostrar}
            onClick={onToggle}
            shape="circle"
            size="s"
            tone="text"
            touch44
          />
        ) : null}
        {item.closable ? <RoomScreenClose item={item} onClose={() => handlers?.onClose?.(item.displayId, "strip")} /> : null}
      </div>
      <RoomScreenStays item={item} />
      {expandable ? (
        <div className="flex flex-col items-start gap-2 px-3 pb-3" data-room-screen-more="" hidden={!expanded} id={`${id}-c`}>
          {item.kind === "qr" && href ? (
            <>
              <RoomScreenQr link={href} side={stripQrSide(href)} />
              {item.title ? <p className="text-sm leading-5 text-room-fg">{item.title}</p> : null}
            </>
          ) : (
            <>
              {item.image ? <RoomScreenImage className="max-h-[40dvh] w-auto max-w-full rounded-[12px]" image={item.image} /> : null}
              {item.title ? <p className="text-sm font-semibold leading-5 text-room-fg">{item.title}</p> : null}
              {item.body ? <p className="whitespace-pre-line text-sm leading-5 text-room-fg">{item.body}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export type RoomScreenStripProps = {
  /** O comentario ou a pergunta na tela (rodada v9, docs/30 D89): a primeira linha da faixa; nulo sem nada. */
  comment?: StudentScreenComment | null;
  /** A capa no palco: a faixa vale tambem no palco largo (data-tela="faixa"). */
  forced: boolean;
  handlers?: ScreenItemHandlers;
  /** O banner e o QR Code que o aluno ainda ve (o que ele fechou ja saiu). */
  items: readonly StudentScreenItem[];
  /** As linhas das fixadas (so com o painel fechado; nulo sem elas). */
  pinned: RoomPinnedShortcutsProps | null;
};

/** A faixa abaixo do palco: as fixadas e a Na tela em linhas, so com o palco estreito ou com a capa. */
export function RoomScreenStrip({ comment = null, forced, handlers, items, pinned }: RoomScreenStripProps) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const withPinned = pinned !== null && (pinned.message !== null || pinned.poll !== null);
  if (!withPinned && items.length === 0 && !comment) {
    return null;
  }
  const open = expanded.filter((displayId) => items.some((item) => item.displayId === displayId));
  return (
    // A partir de lg a coluna do palco tem o gap-3: o invólucro sobe 12 px e o conteudo desce 12 px, entao a faixa
    // escondida no palco largo (altura zero) nao ocupa o espaco do gap e o palco nao pula quando algo entra ou sai.
    <div className="@container/tela shrink-0 lg:-mt-3" data-room-screen-strip="" data-tela={forced ? "faixa" : undefined}>
      <div
        className={cn(
          "flex flex-col overflow-y-auto overscroll-contain border-b border-room-border bg-room-surface lg:mt-3",
          // Com o comentario na tela a faixa guarda lugar para ele inteiro (ate 3 linhas) alem das outras linhas.
          open.length > 0 ? "max-h-[45dvh]" : comment ? "max-h-[200px]" : "max-h-[120px]",
          forced ? null : SCREEN_NARROW_FLEX
        )}
      >
        {comment ? <RoomScreenCommentRow comment={comment} form="strip" /> : null}
        {withPinned ? <RoomPinnedRows {...pinned} /> : null}
        {items.map((item) => (
          <RoomScreenRow
            expanded={open.includes(item.displayId)}
            handlers={handlers}
            item={item}
            key={item.displayId}
            onToggle={() => setExpanded((previous) => (previous.includes(item.displayId) ? previous.filter((value) => value !== item.displayId) : [...previous, item.displayId]))}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A linha compacta de 48 px: dentro do palco na tela cheia de verdade com o palco estreito (`form` strip, sobre o video
 * com as cores da sala) e na doca do vertical (`form` vertical, sempre escura). Alvos de 44 px; sem o X quando nao pode
 * fechar.
 */
export function RoomScreenCompactRow({ form, handlers, item }: { form: Extract<ScreenEventForm, "strip" | "vertical">; handlers?: ScreenItemHandlers; item: StudentScreenItem }) {
  const ref = useScreenShownRef<HTMLElement>(handlers?.watch, item.displayId, form);
  const action = rowAction(item);
  const vertical = form === "vertical";
  return (
    <section
      aria-label={screenSectionName(item)}
      className={cn(
        "pointer-events-auto flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-[12px] pl-1.5 pr-0.5",
        vertical ? "bg-black/60 text-white" : "bg-room-on-video-bg text-room-on-video-fg shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
      )}
      data-room-screen-compact-row={item.kind}
      data-room-screen-display={item.displayId}
      ref={ref}
    >
      <RowThumb className="size-9 rounded-[8px]" item={item} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-5">{screenRowTitle(item)}</span>
      {action ? (
        <RoomScreenLink className={roomPillClassName({ className: "h-11 min-w-24 max-w-[50%]", size: "s", tone: "white" })} href={action.href} onClick={() => handlers?.onClick?.(item.displayId, form, action.target)}>
          <span className="truncate">{action.label}</span>
        </RoomScreenLink>
      ) : null}
      {item.closable ? <RoomScreenClose item={item} onClose={() => handlers?.onClose?.(item.displayId, form)} size={44} /> : null}
      <RoomScreenStays item={item} />
    </section>
  );
}

/**
 * A doca da sala vertical: o comentario ou a pergunta na tela (rodada v9, docs/30 D89) e no maximo duas linhas compactas
 * (o banner e o QR Code), antes da pilula da Oferta.
 */
export function RoomScreenDock({ comment = null, handlers, items }: { comment?: StudentScreenComment | null; handlers?: ScreenItemHandlers; items: readonly StudentScreenItem[] }) {
  if (items.length === 0 && !comment) {
    return null;
  }
  return (
    <div className="pointer-events-none flex min-w-0 flex-col gap-1.5" data-room-screen-dock="">
      {comment ? <RoomScreenCommentRow comment={comment} form="vertical" /> : null}
      {items.slice(0, 2).map((item) => (
        <RoomScreenCompactRow form="vertical" handlers={handlers} item={item} key={item.displayId} />
      ))}
    </div>
  );
}
