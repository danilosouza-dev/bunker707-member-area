"use client";

import { ArrowRight, AtSign, Check, ExternalLink, MessageCircle, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { formatMemberRelativeTime } from "@/lib/member-format";
import { cn } from "@/lib/utils";
import { isDefaultSchoolIcon, normalizeSchoolIcon } from "@/server/communications/message-meta";
import type { NotificationItem, NotificationResponseValue } from "@/server/communications/notification-model";
import { NoticeAudioPlayer } from "./notice-audio-player";
import { NoticeTitleIcon } from "./notice-icons";
import {
  audioListenOf,
  noticeMeta,
  resolveNotificationLink,
  shouldClampNotificationBody,
  splitActorTitle,
  type AudioProgressEvent,
  type NotificationLink
} from "./notifications-model";

// Uma notificacao do sino (docs/22 §1.1; v2 em docs/23; desenho em docs/12): aviso da equipe (icone e titulo,
// texto, quem envia com o "Termina em", imagem 16:9, audio com o ouvido, botao e resposta
// Aceitar/Recusar) ou resposta/mencao em comentario (o cartao inteiro e um link para a aula, sem nada
// clicavel dentro). O circulo e quem envia: a pessoa da equipe (foto ou iniciais) ou a escola (o Icone
// da escola de Marca); o aviso nao tem selo, so os comentarios. So desenha: quem busca, marca como lida
// e navega e o painel. A previa do admin desenha o mesmo cartao com `preview` (sem links, sem audio, sem
// efeitos) dentro de moldura inert reduzida; por isso nada aqui depende da largura da janela.

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
    <span className="absolute right-4 top-5 size-2 rounded-full bg-[var(--accent)]">
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

export type NotificationCardProps = {
  /** Modo "ver como" do produtor: vai nos links internos. */
  accessPreviewMode?: AccessPreviewMode;
  item: NotificationItem;
  /** Instante de referencia do "há 2 horas" (o painel guarda ao carregar; a previa usa o da tela). */
  now: number;
  /** Audio do aviso no sino: "started" no primeiro play e o ouvido (o painel guarda no servidor). */
  onAudioProgress?: (event: AudioProgressEvent) => void;
  /** Clique num link ou no botao: o painel registra, marca como lida, fecha e navega. */
  onOpenLink?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  /** Interacao que abre sem sair ("Ver mais", clicar no cartao; o audio sem `onAudioProgress`). */
  onRead?: () => void;
  onRespond?: (response: NotificationResponseValue) => void;
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

function CommentCard({ accessPreviewMode, item, now, onOpenLink, preview = false, schoolIconUrl, schoolLogoUrl }: NotificationCardProps) {
  const unread = !item.readAt;
  const { actor, rest } = splitActorTitle(item.title, item.actor?.name);
  const link = preview ? null : resolveNotificationLink(item.href, "same_tab", accessPreviewMode);
  const content = (
    <>
      <CardAvatar item={item} schoolIconUrl={schoolIconUrl} schoolLogoUrl={schoolLogoUrl} />
      <span className="block min-w-0 pr-4">
        <span className="block text-sm leading-5 text-white">
          {actor ? <span className="font-semibold">{actor}</span> : null}
          <span className={actor ? "text-zinc-200" : "font-semibold"}>{rest}</span>
        </span>
        {item.context ? <span className="mt-0.5 block truncate text-xs text-zinc-400">em {item.context}</span> : null}
        {item.body ? (
          <span className="mt-1 line-clamp-3 text-sm leading-5 text-zinc-300 [overflow-wrap:anywhere]">“{item.body}”</span>
        ) : null}
        <span className="mt-1 block text-xs text-zinc-400" suppressHydrationWarning>
          <time dateTime={item.createdAt} suppressHydrationWarning>
            {formatMemberRelativeTime(item.createdAt, now)}
          </time>
        </span>
      </span>
      {unread ? <UnreadDot /> : null}
    </>
  );

  const className = cn(cardClassName, unread && "bg-white/[0.035]");

  if (!link) {
    return <div className={className}>{content}</div>;
  }

  return (
    <a
      className={cn(
        className,
        "outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
      )}
      data-navigation-message="Abrindo a aula..."
      href={link.href}
      onClick={(event) => onOpenLink?.(event, link)}
    >
      {content}
    </a>
  );
}

function NoticeCta({
  accessPreviewMode,
  item,
  onOpenLink,
  preview
}: Pick<NotificationCardProps, "accessPreviewMode" | "item" | "onOpenLink" | "preview">) {
  const cta = item.cta;

  if (!cta || !cta.label.trim()) {
    return null;
  }

  const link = resolveNotificationLink(cta.href, cta.target, accessPreviewMode);

  if (!link) {
    return null;
  }

  const Icon = link.newTab ? ExternalLink : ArrowRight;
  const className = memberButtonClassName({ className: "mt-3 max-w-full", size: "sm", variant: "secondary" });
  const content = (
    <>
      <span className="min-w-0 truncate">{cta.label}</span>
      <Icon aria-hidden="true" />
    </>
  );

  if (preview) {
    return <span className={className}>{content}</span>;
  }

  return (
    <a
      className={className}
      href={link.href}
      onClick={(event) => onOpenLink?.(event, link)}
      {...(link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      {content}
      {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </a>
  );
}

/**
 * Resposta Aceitar/Recusar. Enquanto envia, os botoes ficam aria-disabled (nao `disabled`: o foco
 * ficaria sem lugar); respondido agora, o foco que estava nos botoes (ou perdido) vai para a frase
 * "Você aceitou"/"Você recusou", que o leitor de tela le. Item que ja chega respondido nao puxa foco.
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
  const answerRef = useRef<HTMLDivElement>(null);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const previous = previousValueRef.current;
    previousValueRef.current = value;

    if (preview || previous !== null || value === null) {
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

  if (response.value) {
    return (
      <div className={cn("mt-3 w-fit rounded-full", focusRing)} ref={answerRef} tabIndex={-1}>
        {response.value === "accepted" ? (
          <MemberChip icon={Check} size="md" tone="success">
            Você aceitou
          </MemberChip>
        ) : (
          <MemberChip size="md" tone="neutral">
            Você recusou
          </MemberChip>
        )}
      </div>
    );
  }

  const busy = Boolean(responding);
  const declineClassName = memberButtonClassName({ size: "sm", variant: "secondary" });
  const acceptClassName = memberButtonClassName({ size: "sm", variant: "primary" });

  if (preview) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={declineClassName}>{response.declineLabel}</span>
        <span className={acceptClassName}>{response.acceptLabel}</span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div aria-busy={busy} className="flex flex-wrap gap-2">
        <button
          aria-disabled={busy || undefined}
          className={declineClassName}
          onClick={() => {
            if (!busy) {
              onRespond?.("declined");
            }
          }}
          type="button"
        >
          {responding === "declined" ? "Enviando..." : response.declineLabel}
        </button>
        <button
          aria-disabled={busy || undefined}
          className={acceptClassName}
          onClick={() => {
            if (!busy) {
              onRespond?.("accepted");
            }
          }}
          type="button"
        >
          {responding === "accepted" ? "Enviando..." : response.acceptLabel}
        </button>
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
            className={cn("relative mt-1 rounded-[4px] text-xs font-semibold text-white after:absolute after:-inset-x-2 after:-inset-y-1 hover:underline", focusRing)}
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

function NoticeCard({
  accessPreviewMode,
  item,
  now,
  onAudioProgress,
  onOpenLink,
  onRead,
  onRespond,
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

  return (
    <article
      aria-labelledby={titleId}
      className={cn(cardClassName, unread && "bg-white/[0.035]")}
      // Clique solto no cartao (fora de botao e link) conta como abrir, tambem num cartao ja lido pelo
      // "Marcar todas" (a bolinha segue a leitura; o "abriu" e outro).
      onClick={(event) => {
        if (!preview && !item.openedAt && !(event.target instanceof Element && event.target.closest("a, button, [role='slider']"))) {
          onRead?.();
        }
      }}
    >
      <CardAvatar item={item} schoolIconUrl={schoolIconUrl} schoolLogoUrl={schoolLogoUrl} />
      <div className="min-w-0">
        {/* O icone e aria-hidden: o nome do cartao continua sendo exatamente o titulo. */}
        <p className="pr-4 text-sm font-semibold leading-5 text-white [overflow-wrap:anywhere]" id={titleId}>
          <NoticeTitleIcon icon={item.icon} size="bell" />
          {item.title}
        </p>
        <NoticeBody body={item.body} onRead={onRead} preview={preview} />
        <NoticeMeta createdAt={item.createdAt} hint={meta.hint} now={now} sender={meta.sender} />
        {media}
        {item.audio ? (
          <NoticeAudioPlayer
            audio={item.audio}
            className="mt-3"
            label="Áudio do aviso"
            listen={audioListenOf(item)}
            onPlay={onAudioProgress ? undefined : onRead}
            onProgress={onAudioProgress}
            preview={preview}
          />
        ) : null}
        <NoticeCta accessPreviewMode={accessPreviewMode} item={item} onOpenLink={onOpenLink} preview={preview} />
        <NoticeResponse
          item={item}
          onRespond={onRespond}
          preview={preview}
          responding={responding}
          responseError={responseError}
        />
      </div>
      {unread ? <UnreadDot /> : null}
    </article>
  );
}
