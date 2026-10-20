"use client";

import { ArrowRight, AtSign, Check, ExternalLink, Megaphone, MessageCircle, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { formatMemberRelativeTime } from "@/lib/member-format";
import { cn } from "@/lib/utils";
import type {
  NotificationItem,
  NotificationKind,
  NotificationResponseValue
} from "@/server/communications/notification-model";
import { NoticeAudioPlayer } from "./notice-audio-player";
import {
  resolveNotificationLink,
  shouldClampNotificationBody,
  splitActorTitle,
  type NotificationLink
} from "./notifications-model";

// Uma notificacao do sino (docs/22 §5): aviso da escola (titulo, texto, imagem 16:9, audio, botao e
// resposta Aceitar/Recusar) ou resposta/mencao em comentario (o cartao inteiro e um link para a aula,
// sem nada clicavel dentro). So desenha: quem busca, marca como lida e navega e o painel. A previa do
// admin desenha o mesmo cartao com `preview` (sem links, sem audio, sem efeitos) dentro de moldura
// inert reduzida; por isso nada aqui depende da largura da janela.

const KIND_BADGES: Record<NotificationKind, { className: string; icon: LucideIcon }> = {
  comment_mention: { className: "bg-amber-500 text-black", icon: AtSign },
  comment_reply: { className: "bg-emerald-600 text-white", icon: MessageCircle },
  notice: { className: "bg-[var(--accent)] text-white", icon: Megaphone }
};

function KindBadge({ kind }: { kind: NotificationKind }) {
  const badge = KIND_BADGES[kind] ?? KIND_BADGES.notice;
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

// Logo larga (a marca escrita) some num circulo de 40 px: so entra a logo quase quadrada; as outras
// ficam com o megafone (e sem o selo, que repetiria o mesmo icone). A medida de cada endereco vale
// para todos os cartoes da pagina.
const logoFitsCircle = new Map<string, boolean>();

function SchoolAvatar({ kind, logoUrl }: { kind: NotificationKind; logoUrl?: string | null }) {
  const src = logoUrl?.trim() || null;
  const [measured, setMeasured] = useState<{ fits: boolean; src: string } | null>(null);
  const fits = src ? (measured?.src === src ? measured.fits : logoFitsCircle.get(src)) : false;

  return (
    <span aria-hidden="true" className="relative block size-10 shrink-0">
      <span className="relative grid size-10 place-items-center overflow-hidden rounded-full bg-[#262626] text-white ring-1 ring-white/10">
        {fits ? null : <Megaphone className="size-[18px]" strokeWidth={2.2} />}
        {src && fits !== false ? (
          <Image
            alt=""
            className={cn("object-contain p-1.5", fits ? "opacity-100" : "opacity-0")}
            fill
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
        ) : null}
      </span>
      {fits ? <KindBadge kind={kind} /> : null}
    </span>
  );
}

function CardAvatar({ item, schoolLogoUrl }: { item: NotificationItem; schoolLogoUrl?: string | null }) {
  if (!item.actor) {
    return <SchoolAvatar kind={item.kind} logoUrl={schoolLogoUrl} />;
  }

  return (
    <span className="relative block size-10 shrink-0">
      <MemberAvatar imageSrc={item.actor.avatarUrl} name={item.actor.name} size="md" />
      <KindBadge kind={item.kind} />
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

function RelativeTime({ createdAt, now, prefix }: { createdAt: string; now: number; prefix?: string }) {
  const relative = formatMemberRelativeTime(createdAt, now);

  return (
    <p className="mt-1 text-xs text-zinc-500" suppressHydrationWarning>
      {prefix ? `${prefix} · ` : null}
      <time dateTime={createdAt} suppressHydrationWarning>
        {relative}
      </time>
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
  /** Clique num link ou no botao: o painel registra, marca como lida, fecha e navega. */
  onOpenLink?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  /** Interacao que conta como leitura sem sair (tocar o audio, "Ver mais", clicar no cartao). */
  onRead?: () => void;
  onRespond?: (response: NotificationResponseValue) => void;
  /** Resposta sendo enviada agora (mostra "Enviando..." no botao escolhido). */
  responding?: NotificationResponseValue | null;
  responseError?: string | null;
  /** Previa do admin: mesmo visual, sem links, audio parado e botoes sem acao. */
  preview?: boolean;
  schoolLogoUrl?: string | null;
  schoolName: string;
};

export function NotificationCard(props: NotificationCardProps) {
  return props.item.kind === "notice" ? <NoticeCard {...props} /> : <CommentCard {...props} />;
}

const cardClassName = "relative grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-3.5";

function CommentCard({ accessPreviewMode, item, now, onOpenLink, preview = false, schoolLogoUrl }: NotificationCardProps) {
  const unread = !item.readAt;
  const { actor, rest } = splitActorTitle(item.title, item.actor?.name);
  const link = preview ? null : resolveNotificationLink(item.href, "same_tab", accessPreviewMode);
  const content = (
    <>
      <CardAvatar item={item} schoolLogoUrl={schoolLogoUrl} />
      <span className="block min-w-0 pr-4">
        <span className="block text-sm leading-5 text-white">
          {actor ? <span className="font-semibold">{actor}</span> : null}
          <span className={actor ? "text-zinc-200" : "font-semibold"}>{rest}</span>
        </span>
        {item.context ? <span className="mt-0.5 block truncate text-xs text-zinc-400">em {item.context}</span> : null}
        {item.body ? (
          <span className="mt-1 line-clamp-3 text-sm leading-5 text-zinc-300 [overflow-wrap:anywhere]">“{item.body}”</span>
        ) : null}
        <span className="mt-1 block text-xs text-zinc-500" suppressHydrationWarning>
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

function NoticeResponse({
  item,
  onRespond,
  preview,
  responding,
  responseError
}: Pick<NotificationCardProps, "item" | "onRespond" | "preview" | "responding" | "responseError">) {
  const response = item.response;

  if (!response) {
    return null;
  }

  if (response.value) {
    return (
      <div className="mt-3">
        {response.value === "accepted" ? (
          <MemberChip icon={Check} size="md" tone="success">
            Você aceitou
          </MemberChip>
        ) : (
          <MemberChip size="md" tone="muted">
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
        <button className={declineClassName} disabled={busy} onClick={() => onRespond?.("declined")} type="button">
          {responding === "declined" ? "Enviando..." : response.declineLabel}
        </button>
        <button className={acceptClassName} disabled={busy} onClick={() => onRespond?.("accepted")} type="button">
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
            className={cn("mt-1 rounded-[4px] text-xs font-semibold text-white hover:underline", focusRing)}
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
  onOpenLink,
  onRead,
  onRespond,
  preview = false,
  responding,
  responseError,
  schoolLogoUrl,
  schoolName
}: NotificationCardProps) {
  const unread = !item.readAt;
  const titleId = useId();
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
      // Clique solto no cartao (fora de botao e link) conta como leitura.
      onClick={(event) => {
        if (!preview && unread && !(event.target instanceof Element && event.target.closest("a, button, [role='slider']"))) {
          onRead?.();
        }
      }}
    >
      <CardAvatar item={item} schoolLogoUrl={schoolLogoUrl} />
      <div className="min-w-0">
        <p className="pr-4 text-sm font-semibold leading-5 text-white [overflow-wrap:anywhere]" id={titleId}>
          {item.title}
        </p>
        <NoticeBody body={item.body} onRead={onRead} preview={preview} />
        <RelativeTime createdAt={item.createdAt} now={now} prefix={schoolName} />
        {media}
        {item.audio ? (
          <NoticeAudioPlayer audio={item.audio} className="mt-3" label="Áudio do aviso" onPlay={onRead} preview={preview} />
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
