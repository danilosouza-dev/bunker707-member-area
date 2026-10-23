import {
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  Crown,
  Flame,
  Gem,
  Gift,
  GraduationCap,
  Heart,
  LockOpen,
  Megaphone,
  Percent,
  Play,
  Rocket,
  Sparkles,
  Star,
  Tag,
  Trophy,
  Zap,
  type LucideIcon
} from "lucide-react";
import type { CSSProperties } from "react";
import type { FreeIconName } from "@/server/communications/popup-free-model";

// Os 24 icones do design Livre (docs/27): mapa fixo nome -> componente do lucide-react. Fica no pedaco proprio do
// cartao Livre (popup-free-load.ts), nunca na janela do Padrão/Personalizado. Sempre aria-hidden (o texto do
// lado diz o que importa); nome fora da lista nao desenha nada.

const FREE_ICONS: Record<FreeIconName, LucideIcon> = {
  "arrow-right": ArrowRight,
  bell: Bell,
  "book-open": BookOpen,
  calendar: Calendar,
  check: Check,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  clock: Clock,
  crown: Crown,
  flame: Flame,
  gem: Gem,
  gift: Gift,
  "graduation-cap": GraduationCap,
  heart: Heart,
  "lock-open": LockOpen,
  megaphone: Megaphone,
  percent: Percent,
  play: Play,
  rocket: Rocket,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  trophy: Trophy,
  zap: Zap
};

export function FreeIcon({ name, strokeWidth = 2, style }: { name: FreeIconName; strokeWidth?: number; style?: CSSProperties }) {
  const Icon = Object.hasOwn(FREE_ICONS, name) ? FREE_ICONS[name] : null;

  return Icon ? <Icon aria-hidden="true" focusable="false" strokeWidth={strokeWidth} style={style} /> : null;
}
