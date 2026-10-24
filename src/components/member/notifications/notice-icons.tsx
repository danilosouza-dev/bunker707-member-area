import {
  BadgePercent,
  BookOpen,
  CalendarDays,
  CirclePlay,
  Clock,
  Flame,
  Gift,
  GraduationCap,
  Megaphone,
  Mic,
  Radio,
  Rocket,
  Sparkles,
  Star,
  TriangleAlert,
  Trophy,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoticeIconColor, NoticeIconId } from "@/server/communications/message-meta";
import type { NotificationIcon } from "@/server/communications/notification-model";

// Icone ao lado do titulo da notificacao (docs/23; desenho em docs/12). O banco guarda so o id estavel
// (campaigns.icon) e a cor (icon_color): o desenho de cada id mora aqui e pode mudar com as referencias
// do produtor sem migracao. Id ou cor desconhecidos nao desenham nada. Decorativo (aria-hidden): o nome
// do cartao continua sendo exatamente o titulo.

export const NOTICE_ICON_GLYPHS: Record<NoticeIconId, LucideIcon> = {
  alert: TriangleAlert,
  book: BookOpen,
  calendar: CalendarDays,
  clock: Clock,
  flame: Flame,
  gift: Gift,
  graduation: GraduationCap,
  lesson: CirclePlay,
  live: Radio,
  megaphone: Megaphone,
  mic: Mic,
  promo: BadgePercent,
  rocket: Rocket,
  sparkles: Sparkles,
  star: Star,
  trophy: Trophy
};

/**
 * Paleta (docs/12): pelo menos 3:1 sobre o fundo do cartao (#1b1b1b), lido ou nao. O vermelho e o valor do
 * --accent do aluno escrito direto: o admin troca o --accent por cinza, e o icone some nos cartoes dos fluxos,
 * das notificacoes seguintes e da lista de Avisos.
 */
export const NOTICE_ICON_COLOR_CLASSES: Record<NoticeIconColor, string> = {
  amber: "text-amber-400",
  green: "text-emerald-500",
  orange: "text-[var(--accent-warm)]",
  red: "text-[#e50914]",
  white: "text-zinc-100"
};

const SIZE_CLASSES = { bell: "size-4", popup: "size-5" } as const;

/** Glifo e classe da cor de um icone gravado; fora do catalogo -> null. */
export function noticeIconParts(icon: { color: string; id: string } | null | undefined): { className: string; Icon: LucideIcon } | null {
  if (!icon) {
    return null;
  }

  const Icon = (NOTICE_ICON_GLYPHS as Record<string, LucideIcon | undefined>)[icon.id];
  const className = (NOTICE_ICON_COLOR_CLASSES as Record<string, string | undefined>)[icon.color];

  return Icon && className ? { className, Icon } : null;
}

/**
 * O icone dentro do elemento do titulo, antes do texto: 16 px no sino, 20 px no pop-up. Quebra junto com
 * o titulo (inline), nunca numa coluna propria.
 */
export function NoticeTitleIcon({ icon, size }: { icon: NotificationIcon | null | undefined; size: "bell" | "popup" }) {
  const parts = noticeIconParts(icon);

  if (!parts) {
    return null;
  }

  const { className, Icon } = parts;

  return (
    <span aria-hidden="true" className={cn("mr-1.5 inline-flex align-[-3px]", className)}>
      <Icon className={SIZE_CLASSES[size]} strokeWidth={2.4} />
    </span>
  );
}
