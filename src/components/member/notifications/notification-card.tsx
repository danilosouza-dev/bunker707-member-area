"use client";

import { ArrowRight, AtSign, Check, ChevronRight, ExternalLink, MessageCircle, Trash2, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { formatMemberRelativeTime } from "@/lib/member-format";
import { cn } from "@/lib/utils";
import type { ReactionId } from "@/server/communications/interactions-model";
import { isDefaultSchoolIcon, normalizeSchoolIcon } from "@/server/communications/message-meta";
import type { NotificationItem, NotificationResponseValue } from "@/server/communications/notification-model";
import { NoticeAudioPlayer } from "./notice-audio-player";
import { NoticeTitleIcon } from "./notice-icons";
import { NoticePoll } from "./notice-poll";
import { NoticeReactions } from "./notice-reactions";
import {
  audioListenOf,
  cardActionLabels,
  cardLinkOf,
  noticeMeta,
  responseAnswerLabel,
  responsePress,
  responseStage,
  shouldClampNotificationBody,
  splitActorTitle,
  type AudioProgressEvent,
  type NotificationLink
} from "./notifications-model";

// Uma notificacao do sino (docs/22 §1.1; v2 em docs/23; v3a em docs/24; desenho em docs/12): aviso da
// equipe (icone e titulo, texto, quem envia com o "Termina em", imagem 16:9, audio com o ouvido, enquete,
// botao ou o texto ao lado da seta, resposta Aceitar/Recusar com "Mudar resposta", e a linha de acoes com
// Reagir e a lixeira) ou resposta/mencao em comentario (o cartao inteiro leva para a aula; o link de
// verdade e a frase, e a lixeira fica na linha do tempo). O circulo e quem envia: a pessoa da equipe
// (foto ou iniciais) ou a escola (o Icone da escola de Marca); o aviso nao tem selo, so os comentarios.
//
// Cartao clicavel (docs/24 §1.2): um link decorativo (aria-hidden, fora do Tab) cobre o cartao por baixo
// do conteudo; os dois filhos da grade deixam o toque passar e cada controle dentro (Ver mais, audio,
// enquete, reacoes, resposta, lixeira) volta a receber o toque. O link acessivel e um so: o botao, ou o
// titulo (no "Só tocando na notificação", descrito pelo texto ao lado da seta). Nada interativo dentro
// de um link. So desenha: quem busca, grava, marca como lida e navega e o painel. A previa do admin
// desenha o mesmo cartao com `preview` (sem links, sem audio, sem efeitos) dentro de moldura inert
// reduzida; por isso nada aqui depende da largura da janela.

type CommentKind = "comment_mention" | "comment_reply";

const KIND_BADGES: Record<CommentKind, { className: string; icon: LucideIcon }> = {
  comment_mention: { className: "bg-amber-500 text-black", icon: AtSign },
  comment_reply: { className: "bg-emerald-600 text-white", icon: MessageCircle }
};

function KindBadge({ kind }: { kind: CommentKind }) {
  const badge = KIND_BADGES[kind] ?? KIND_BADGES.comment_reply;
  const Icon = badge.icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full border-2 border-[#1b1b1b]",
        badge.className
      )}
    >
      <Icon className="size-2.5" strokeWidth={2.8} />
    </span>
  );
}

const circleClassName = "relative grid size-10 place-items-center overflow-hidden rounded-full bg-[#262626] text-white ring-1 ring-white/10";

// Logo larga (a marca escrita) some num circulo de 40 px: so entra a logo quase quadrada; as outras
// ficam com a inicial da escola. A medida de cada endereco vale para todos os cartoes da pagina.
const logoFitsCircle = new Map<string, boolean>();
// Icone da escola que nao carregou (link colado quebrado): os outros cartoes ja vao direto para a logo.
const brokenSchoolIcons = new Set<string>();

/** Reserva do icone da escola: a logo quando cabe no circulo; senao a inicial (nunca o megafone). */
function SchoolLogoAvatar({ logoUrl }: { logoUrl?: string | null }) {
  const src = logoUrl?.trim() || null;
  const [measured, setMeasured] = useState<{ fits: boolean; src: string } | null>(null);
  const fits = src ? (measured?.src === src ? measured.fits : logoFitsCircle.get(src)) : false;

  return (
    <span aria-hidden="true" className="relative block size-10 shrink-0">
      {fits ? null : <MemberAvatar className="absolute inset-0" name="Bunker707" size="md" />}
      {src && fits !== false ? (
        <span className={cn(circleClassName, "absolute inset-0", fits ? "opacity-100" : "opacity-0")}>
          <Image
            alt=""
            className="object-contain p-1.5"
            fill
            onError={() => {
              logoFitsCircle.set(src, false);
              setMeasured({ fits: false, src });
            }}
            onLoad={(event) => {
              const image = event.currentTarget;
              const ratio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0;
              const nextFits = ratio > 0 && ratio <= 1.6;
              logoFitsCircle.set(src, nextFits);
              setMeasured({ fits: nextFits, src });
            }}
            sizes="40px"
            src={src}
            unoptimized={!canOptimizeImageSrc(src)}
          />
        </span>
      ) : null}
    </span>
  );
}

/**
 * A escola: o Icone da escola de Marca. O simbolo padrao fica centralizado no circulo; uma imagem
 * enviada preenche o circulo como uma foto. Se nao carrega, a logo (quando cabe) ou a inicial.
 */
function SchoolAvatar({ iconUrl, logoUrl }: { iconUrl?: string | null; logoUrl?: string | null }) {
  const icon = normalizeSchoolIcon(iconUrl);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);

  if (failedIcon === icon || brokenSchoolIcons.has(icon)) {
    return <SchoolLogoAvatar logoUrl={logoUrl} />;
  }

  return (
    <span aria-hidden="true" className="relative block size-10 shrink-0">
      <span className={circleClassName}>
        <Image
          alt=""
          className={isDefaultSchoolIcon(icon) ? "object-contain p-2" : "object-cover"}
          fill
          onError={() => {
            brokenSchoolIcons.add(icon);
            setFailedIcon(icon);
          }}
          sizes="40px"
          src={icon}
          unoptimized={!canOptimizeImageSrc(icon)}
        />
      </span>
    </span>
  );
}

function CardAvatar({ item, schoolIconUrl, schoolLogoUrl }: { item: NotificationItem; schoolIconUrl?: string | null; schoolLogoUrl?: string | null }) {
  const badge = item.kind === "notice" ? null : <KindBadge kind={item.kind} />;

  if (!item.actor) {
    return (
      <span className="relative block size-10 shrink-0">
        <SchoolAvatar iconUrl={schoolIconUrl} logoUrl={schoolLogoUrl} />
        {badge}
      </span>
    );
  }

  // Aviso: a pessoa da equipe que envia (foto ou iniciais), sem selo. Comentario: quem respondeu, com o selo.
  return (
    <span className="relative block size-10 shrink-0">
      <MemberAvatar imageSrc={item.actor.avatarUrl} name={item.actor.name} size="md" />
      {badge}
    </span>
  );
}

function UnreadDot() {
  return (
    <span className="pointer-events-none absolute right-4 top-5 z-[1] size-2 rounded-full bg-[var(--accent)]">
      <span className="sr-only">Não lida</span>
    </span>
  );
}

/**
 * Quem envia · há 2 horas · Termina em 3 h, numa linha so: o nome encurta com reticencias (o leitor de
 * tela le inteiro) e o tempo e o aviso de fim nunca quebram nem encurtam, nem a 375 px.
 */
function NoticeMeta({ createdAt, hint, now, sender }: { createdAt: string; hint: string | null; now: number; sender: string }) {
  const relative = formatMemberRelativeTime(createdAt, now);

  return (
    <p className="mt-1 flex min-w-0 items-baseline gap-1 text-xs text-zinc-400" suppressHydrationWarning>
      <span className="min-w-0 truncate">{sender}</span>
      <span aria-hidden="true">·</span>
      <time className="shrink-0 whitespace-nowrap" dateTime={createdAt} suppressHydrationWarning>
        {relative}
      </time>
      {hint ? <span className="shrink-0 whitespace-nowrap text-amber-400">· {hint}</span> : null}
    </p>
  );
}

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Escrita do cartao em andamento e o erro da ultima (reacao, voto, excluir). */
export type CardInteractionState = { busy: boolean; error: string | null };

export type NotificationCardProps = {
  /** Modo "ver como" do produtor: vai nos links internos. */
  accessPreviewMode?: AccessPreviewMode;
  /** Estado das escritas deste cartao, por tipo (o painel guarda). */
  interaction?: Partial<Record<"hide" | "reaction" | "vote", CardInteractionState>>;
  item: NotificationItem;
  /** Instante de referencia do "há 2 horas" (o painel guarda ao carregar; a previa usa o da tela). */
  now: number;
  /** Audio do aviso no sino: "started" no primeiro play e o ouvido (o painel guarda no servidor). */
  onAudioProgress?: (event: AudioProgressEvent) => void;
  /** Lixeira: tira a notificacao do sino deste aluno (o painel troca o cartao pela linha do Desfazer). */
  onHide?: () => void;
  /** Clique num link, no botao ou no cartao clicavel: o painel registra, marca como lida, fecha e navega. */
  onOpenLink?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  /** Reacao escolhida (null = tirar). */
  onReact?: (reaction: ReactionId | null) => void;
  /** Interacao que abre sem sair ("Ver mais", clicar no cartao; o audio sem `onAudioProgress`). */
  onRead?: () => void;
  /** Aceitar/Recusar, e a outra resposta ao mudar. */
  onRespond?: (response: NotificationResponseValue) => void;
  /** Voto na enquete: o conjunto inteiro de opcoes ([] = tirar o voto). */
  onVote?: (optionIds: string[]) => void;
  /** Resposta sendo enviada agora (mostra "Enviando..." no botao escolhido). */
  responding?: NotificationResponseValue | null;
  responseError?: string | null;
  /** Previa do admin: mesmo visual, sem links, audio parado e botoes sem acao. */
  preview?: boolean;
  /** Icone da escola (Marca); sem ele, o simbolo padrao. */
  schoolIconUrl?: string | null;
  /** Reserva quando o icone nao carrega (so se a logo couber no circulo). */
  schoolLogoUrl?: string | null;
  schoolName: string;
  /** Hora do servidor da lista (asOf), base do "Termina em"; sem ela, `now`. */
  serverNow?: number;
};

export function NotificationCard(props: NotificationCardProps) {
  return props.item.kind === "notice" ? <NoticeCard {...props} /> : <CommentCard {...props} />;
}

const cardClassName = "relative grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-3.5";

/**
 * Cartao clicavel (docs/24 §1.2): fundo no hover e no toque, cursor do link e o anel de foco no cartao
 * inteiro quando o link de verdade (o botao ou o titulo, com `data-card-link`) tem foco pelo teclado.
 */
const clickableCardClassName =
  "group transition-colors hover:bg-white/[0.06] active:bg-white/[0.08] has-[[data-card-link]:focus-visible]:outline has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:-outline-offset-2 has-[[data-card-link]:focus-visible]:outline-white motion-reduce:transition-none";

/** Os dois filhos da grade ficam acima do link decorativo e deixam o toque passar para ele. */
const layerClassName = "pointer-events-none relative z-[1]";

function newTabProps(link: NotificationLink) {
  return link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {};
}

/** Lixeira do cartao: 32 px, area de toque de 40 px, nome com o titulo (cardActionLabels). */
function HideButton({ className, label, onHide, preview }: { className?: string; label: string; onHide?: () => void; preview: boolean }) {
  const buttonClassName = cn(
    "pointer-events-auto relative grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors after:absolute after:-inset-1 hover:text-zinc-200 motion-reduce:transition-none",
    focusRing,
    className
  );

  if (preview) {
    return (
      <span aria-hidden="true" className={buttonClassName}>
        <Trash2 className="size-4" />
      </span>
    );
  }

  return (
    <button aria-label={label} className={buttonClassName} data-card-hide="" onClick={onHide} type="button">
      <Trash2 aria-hidden="true" className="size-4" />
    </button>
  );
}

function CardError({ message }: { message: string | null | undefined }) {
  return message ? (
    <p className="mt-1 text-xs text-red-300" role="alert">
      {message}
    </p>
  ) : null;
}

function CommentCard({ accessPreviewMode, interaction, item, now, onHide, onOpenLink, preview = false, schoolIconUrl, schoolLogoUrl }: NotificationCardProps) {
  const unread = !item.readAt;
  const titleId = useId();
  const { actor, rest } = splitActorTitle(item.title, item.actor?.name);
  const plan = cardLinkOf(item, { accessPreviewMode });
  const link = preview ? null : plan.link;
  const labels = cardActionLabels(item);
  const sentence = (
    <>
      {actor ? <span className="font-semibold">{actor}</span> : null}
      <span className={actor ? "text-zinc-200" : "font-semibold"}>{rest}</span>
    </>
  );

  function handleLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    if (link) {
      onOpenLink?.(event, link);
    }
  }

  return (
    <article aria-labelledby={titleId} className={cn(cardClassName, unread && "bg-white/[0.035]", plan.wholeCard && clickableCardClassName)}>
      {/* Decorativo: o cartao inteiro leva para a aula. Fora do leitor de tela e do Tab: o link de verdade e a frase. */}
      {link ? (
        <a aria-hidden="true" className="absolute inset-0 z-0" data-navigation-message="Abrindo a aula..." href={link.href} onClick={handleLinkClick} tabIndex={-1} />
      ) : null}
      <span className={cn(layerClassName, "block size-10")}>
        <CardAvatar item={item} schoolIconUrl={schoolIconUrl} schoolLogoUrl={schoolLogoUrl} />
      </span>
      <div className={cn(layerClassName, "min-w-0 pr-4")}>
        <p className="text-sm leading-5 text-white" id={titleId}>
          {link ? (
            <a
              className="pointer-events-auto rounded-[4px] outline-none"
              data-card-link=""
              data-navigation-message="Abrindo a aula..."
              href={link.href}
              onClick={handleLinkClick}
            >
              {sentence}
            </a>
          ) : (
            sentence
          )}
        </p>
        {item.context ? <span className="mt-0.5 block truncate text-xs text-zinc-400">em {item.context}</span> : null}
        {item.body ? <span className="mt-1 line-clamp-3 text-sm leading-5 text-zinc-300 [overflow-wrap:anywhere]">“{item.body}”</span> : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400" suppressHydrationWarning>
            <time dateTime={item.createdAt} suppressHydrationWarning>
              {formatMemberRelativeTime(item.createdAt, now)}
            </time>
          </span>
          <HideButton label={labels.hide} onHide={onHide} preview={preview} />
        </div>
        <CardError message={interaction?.hide?.error} />
      </div>
      {unread ? <UnreadDot /> : null}
    </article>
  );
}

function NoticeCta({
  className,
  link,
  label,
  onOpenLink,
  preview
}: {
  /** No cartao clicavel: o anel de foco e do cartao inteiro. */
  className?: string;
  label: string;
  link: NotificationLink;
  onOpenLink?: NotificationCardProps["onOpenLink"];
  preview: boolean;
}) {
  const Icon = link.newTab ? ExternalLink : ArrowRight;
  const buttonClassName = memberButtonClassName({ className: cn("pointer-events-auto mt-3 max-w-full", className), size: "sm", variant: "secondary" });
  const content = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <Icon aria-hidden="true" />
    </>
  );

  if (preview) {
    return <span className={buttonClassName}>{content}</span>;
  }

  return (
    <a className={buttonClassName} data-card-link="" href={link.href} onClick={(event) => onOpenLink?.(event, link)} {...newTabProps(link)}>
      {content}
      {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </a>
  );
}

/**
 * Resposta Aceitar/Recusar e "Mudar resposta" (docs/24 §1.5). Enquanto envia, os botoes ficam
 * aria-disabled (nao `disabled`: o foco ficaria sem lugar). Respondida agora (a primeira ou a troca), o
 * foco que estava nos botoes (ou perdido) vai para a frase "Você aceitou"/"Você recusou". "Mudar
 * resposta" mostra os dois de novo (a atual marcada) e "Manter resposta"; tocar na atual ou em Manter
 * fecha sem pedido e o foco volta para "Mudar resposta". Item que ja chega respondido nao puxa foco.
 */
function NoticeResponse({
  item,
  onRespond,
  preview,
  responding,
  responseError
}: Pick<NotificationCardProps, "item" | "onRespond" | "preview" | "responding" | "responseError">) {
  const response = item.response;
  const value = response?.value ?? null;
  // A troca vale enquanto a resposta for a de quando "Mudar resposta" foi tocado: respondeu, fecha sozinha.
  const [changeFrom, setChangeFrom] = useState<NotificationResponseValue | null>(null);
  const stage = responseStage(value, changeFrom !== null && changeFrom === value);
  const answerRef = useRef<HTMLDivElement>(null);
  const previousValueRef = useRef(value);
  const focusNextRef = useRef<"change" | "first" | null>(null);

  useEffect(() => {
    const previous = previousValueRef.current;
    previousValueRef.current = value;

    if (preview || previous === value || value === null) {
      return;
    }

    const answer = answerRef.current;
    const card = answer?.closest("article") ?? null;
    const active = document.activeElement;
    // Foco nos botoes que sumiram: o navegador manda para o corpo da pagina ou para o painel inteiro.
    const focusLost = !active || active === document.body || (card !== null && (card.contains(active) || active.contains(card)));

    if (answer && focusLost) {
      answer.focus();
    }
  }, [preview, value]);

  if (!response) {
    return null;
  }

  // Foco depois de abrir ou fechar a troca, quando o elemento chega na tela.
  function focusWhenMounted(target: "change" | "first") {
    return (node: HTMLButtonElement | null) => {
      if (node && focusNextRef.current === target) {
        focusNextRef.current = null;
        node.focus();
      }
    };
  }

  if (stage === "answered" && value) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className={cn("w-fit rounded-full", focusRing)} ref={answerRef} tabIndex={-1}>
          {value === "accepted" ? (
            <MemberChip icon={Check} size="md" tone="success">
              {responseAnswerLabel(value)}
            </MemberChip>
          ) : (
            <MemberChip size="md" tone="neutral">
              {responseAnswerLabel(value)}
            </MemberChip>
          )}
        </div>
        {preview ? null : (
          <button
            // Area de toque de 24 px de altura sem mudar o desenho.
            className={cn(
              "pointer-events-auto relative rounded-[4px] text-xs font-semibold text-zinc-300 after:absolute after:-inset-x-1 after:-inset-y-1 hover:text-white hover:underline",
              focusRing
            )}
            onClick={() => {
              focusNextRef.current = "first";
              setChangeFrom(value);
            }}
            ref={focusWhenMounted("change")}
            type="button"
          >
            Mudar resposta
          </button>
        )}
      </div>
    );
  }

  const busy = Boolean(responding);
  const declineClassName = memberButtonClassName({ className: "pointer-events-auto", size: "sm", variant: "secondary" });
  const acceptClassName = memberButtonClassName({ className: "pointer-events-auto", size: "sm", variant: "primary" });

  if (preview) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={declineClassName}>{response.declineLabel}</span>
        <span className={acceptClassName}>{response.acceptLabel}</span>
      </div>
    );
  }

  const changing = stage === "changing";

  function press(pressed: NotificationResponseValue) {
    if (busy) {
      return;
    }

    if (changing && responsePress(value, pressed) === "keep") {
      focusNextRef.current = "change";
      setChangeFrom(null);
      return;
    }

    onRespond?.(pressed);
  }

  function choiceLabel(choice: NotificationResponseValue, label: string) {
    if (responding === choice) {
      return "Enviando...";
    }

    return changing && value === choice ? (
      <>
        <Check aria-hidden="true" />
        {label}
      </>
    ) : (
      label
    );
  }

  return (
    <div className="mt-3">
      <div aria-busy={busy} className="flex flex-wrap items-center gap-2">
        <button
          aria-disabled={busy || undefined}
          aria-pressed={changing ? value === "declined" : undefined}
          className={declineClassName}
          onClick={() => press("declined")}
          ref={focusWhenMounted("first")}
          type="button"
        >
          {choiceLabel("declined", response.declineLabel)}
        </button>
        <button
          aria-disabled={busy || undefined}
          aria-pressed={changing ? value === "accepted" : undefined}
          className={acceptClassName}
          onClick={() => press("accepted")}
          type="button"
        >
          {choiceLabel("accepted", response.acceptLabel)}
        </button>
        {changing ? (
          <button
            aria-disabled={busy || undefined}
            className={memberButtonClassName({ className: "pointer-events-auto", size: "sm", variant: "ghost" })}
            onClick={() => {
              if (!busy) {
                focusNextRef.current = "change";
                setChangeFrom(null);
              }
            }}
            type="button"
          >
            Manter resposta
          </button>
        ) : null}
      </div>
      {responseError ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {responseError}
        </p>
      ) : null}
    </div>
  );
}

function NoticeBody({ body, onRead, preview }: { body: string; onRead?: () => void; preview: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const clamp = shouldClampNotificationBody(body);

  if (!body.trim()) {
    return null;
  }

  return (
    <>
      <p
        className={cn(
          "mt-1 whitespace-pre-line text-sm leading-5 text-zinc-300 [overflow-wrap:anywhere]",
          clamp && !expanded && "line-clamp-4"
        )}
        id={bodyId}
      >
        {body}
      </p>
      {clamp ? (
        preview ? (
          <span className="mt-1 inline-block text-xs font-semibold text-white">Ver mais</span>
        ) : (
          <button
            aria-controls={bodyId}
            aria-expanded={expanded}
            // Area de toque de 24 px de altura sem mudar o desenho (o texto tem 16 px).
            className={cn(
              "pointer-events-auto relative mt-1 rounded-[4px] text-xs font-semibold text-white after:absolute after:-inset-x-2 after:-inset-y-1 hover:underline",
              focusRing
            )}
            onClick={() => {
              setExpanded((current) => !current);
              onRead?.();
            }}
            type="button"
          >
            {expanded ? "Ver menos" : "Ver mais"}
          </button>
        )
      ) : null}
    </>
  );
}

/** Reagir (quando a equipe deixou) a esquerda e a lixeira a direita; o seletor de reacoes toma a linha. */
function NoticeActionRow({
  interaction,
  item,
  onHide,
  onReact,
  preview
}: Pick<NotificationCardProps, "interaction" | "item" | "onHide" | "onReact"> & { preview: boolean }) {
  const labels = cardActionLabels(item);
  const trash = <HideButton className={item.reactions ? undefined : "ml-auto"} label={labels.hide} onHide={onHide} preview={preview} />;

  return (
    <>
      {item.reactions ? (
        <NoticeReactions
          error={interaction?.reaction?.error}
          labels={labels}
          onReact={onReact}
          preview={preview}
          trailing={trash}
          value={item.reactions.value}
        />
      ) : (
        <div className="mt-2 flex min-h-8 items-center justify-between">{trash}</div>
      )}
      <CardError message={interaction?.hide?.error} />
    </>
  );
}

function NoticeCard({
  accessPreviewMode,
  interaction,
  item,
  now,
  onAudioProgress,
  onHide,
  onOpenLink,
  onReact,
  onRead,
  onRespond,
  onVote,
  preview = false,
  responding,
  responseError,
  schoolIconUrl,
  schoolLogoUrl,
  schoolName,
  serverNow
}: NotificationCardProps) {
  const unread = !item.readAt;
  const titleId = useId();
  const cueId = useId();
  const plan = cardLinkOf(item, { accessPreviewMode, cueId });
  const link = preview ? null : plan.link;
  const clickable = plan.wholeCard;
  const meta = noticeMeta(item, { schoolName, serverNow: serverNow ?? now });
  const image = item.image?.url ? item.image : null;
  let media: ReactNode = null;

  if (image) {
    media = (
      <span className="relative mt-3 block aspect-video overflow-hidden rounded-[10px] bg-white/[0.04]">
        <Image
          alt={image.alt}
          className="object-cover"
          fill
          sizes="(max-width: 480px) 90vw, 360px"
          src={image.url}
          unoptimized={!canOptimizeImageSrc(image.url)}
        />
      </span>
    );
  }

  function handleLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    if (link) {
      onOpenLink?.(event, link);
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(cardClassName, unread && "bg-white/[0.035]", clickable && clickableCardClassName)}
      // Cartao "Pelo botão": clique solto (fora de botao e link) conta como abrir, tambem num cartao ja
      // lido pelo "Marcar todas" (a bolinha segue a leitura; o "abriu" e outro). No cartao clicavel o
      // toque solto cai no link decorativo e vai para o destino.
      onClick={(event) => {
        if (!clickable && !preview && !item.openedAt && !(event.target instanceof Element && event.target.closest("a, button, [role='slider']"))) {
          onRead?.();
        }
      }}
    >
      {/* Decorativo: o cartao inteiro leva ao destino. Fora do leitor de tela e do Tab: o link de verdade e o botao ou o titulo. */}
      {clickable && link ? (
        <a aria-hidden="true" className="absolute inset-0 z-0" href={link.href} onClick={handleLinkClick} tabIndex={-1} {...newTabProps(link)} />
      ) : null}
      <span className={cn(clickable && layerClassName, "block size-10")}>
        <CardAvatar item={item} schoolIconUrl={schoolIconUrl} schoolLogoUrl={schoolLogoUrl} />
      </span>
      <div className={cn(clickable && layerClassName, "min-w-0")}>
        {/* O icone e aria-hidden: o nome do cartao continua sendo exatamente o titulo. */}
        <p className="pr-4 text-[15px] font-bold leading-5 text-white [overflow-wrap:anywhere]" id={titleId}>
          <NoticeTitleIcon icon={item.icon} size="bell" />
          {plan.accessibleLink === "title" && link ? (
            <a
              aria-describedby={plan.describedBy ?? undefined}
              className="pointer-events-auto rounded-[4px] outline-none"
              data-card-link=""
              href={link.href}
              onClick={handleLinkClick}
              {...newTabProps(link)}
            >
              {item.title}
              {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
            </a>
          ) : (
            item.title
          )}
        </p>
        <NoticeBody body={item.body} onRead={onRead} preview={preview} />
        <NoticeMeta createdAt={item.createdAt} hint={meta.hint} now={now} sender={meta.sender} />
        {media}
        {item.audio ? (
          <NoticeAudioPlayer
            audio={item.audio}
            className={cn("mt-3", clickable && "pointer-events-auto relative z-[1]")}
            label="Áudio do aviso"
            listen={audioListenOf(item)}
            onPlay={onAudioProgress ? undefined : onRead}
            onProgress={onAudioProgress}
            preview={preview}
          />
        ) : null}
        {item.poll ? (
          <NoticePoll busy={interaction?.vote?.busy} error={interaction?.vote?.error} onVote={onVote} poll={item.poll} preview={preview} />
        ) : null}
        {plan.button && plan.link && item.cta ? (
          <NoticeCta
            className={clickable ? "focus-visible:outline-none" : undefined}
            label={item.cta.label}
            link={plan.link}
            onOpenLink={onOpenLink}
            preview={preview}
          />
        ) : null}
        {plan.cue ? (
          // So para quem ve: o leitor de tela ouve o texto como descricao do titulo (aria-describedby).
          <span aria-hidden="true" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-white">
            <span id={cueId}>{plan.cue}</span>
            {plan.link?.newTab ? <ExternalLink className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
        ) : null}
        <NoticeResponse item={item} onRespond={onRespond} preview={preview} responding={responding} responseError={responseError} />
        <NoticeActionRow interaction={interaction} item={item} onHide={onHide} onReact={onReact} preview={preview} />
      </div>
      {unread ? <UnreadDot /> : null}
    </article>
  );
}
