import { GraduationCap, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { LessonCommentAuthorRole } from "@/lib/platform-types";
import { cn } from "@/lib/utils";

// Etiquetas pequenas da area do aluno: tipo de conteudo, situacao (Em andamento, Concluido,
// Liberacao em...), funcao de quem comenta. Texto curto, sem caixa alta longa (docs/12).

export type MemberChipTone = "accent" | "muted" | "neutral" | "outline" | "solid" | "success" | "warning";
export type MemberChipSize = "md" | "sm";

const toneClassNames: Record<MemberChipTone, string> = {
  accent: "border-[var(--accent)]/35 bg-[var(--accent)]/12 text-red-100",
  muted: "border-transparent bg-transparent px-0 text-zinc-500",
  neutral: "border-white/10 bg-white/[0.07] text-zinc-200",
  outline: "border-white/15 bg-transparent text-zinc-300",
  solid: "border-transparent bg-white text-black",
  success: "border-emerald-400/25 bg-emerald-500/12 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-500/10 text-amber-200"
};

const sizeClassNames: Record<MemberChipSize, string> = {
  md: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
  sm: "h-[22px] gap-1 px-2 text-[11px] [&_svg]:size-3"
};

export function MemberChip({
  children,
  className,
  icon: Icon,
  size = "sm",
  title,
  tone = "neutral"
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  size?: MemberChipSize;
  /** Texto completo quando o rotulo for abreviado (leitor de tela le o rotulo). */
  title?: string;
  tone?: MemberChipTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-none [&_svg]:shrink-0",
        sizeClassNames[size],
        toneClassNames[tone],
        className
      )}
      title={title}
    >
      {Icon ? <Icon aria-hidden="true" strokeWidth={2.2} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

const roleBadges: Record<LessonCommentAuthorRole, { icon?: LucideIcon; label: string; tone: MemberChipTone }> = {
  moderator: { icon: ShieldCheck, label: "Moderador", tone: "neutral" },
  producer: { icon: GraduationCap, label: "Professor", tone: "accent" },
  student: { label: "Aluno", tone: "outline" }
};

export function getMemberRoleLabel(role: LessonCommentAuthorRole) {
  return roleBadges[role]?.label ?? roleBadges.student.label;
}

/**
 * Funcao de quem escreveu (comentarios e respostas): Professor (produtor/equipe), Moderador ou Aluno.
 * Professor e Moderador ganham icone; Aluno fica discreto para nao competir com o nome.
 */
export function MemberRoleBadge({
  className,
  role,
  size = "sm"
}: {
  className?: string;
  role: LessonCommentAuthorRole;
  size?: MemberChipSize;
}) {
  const badge = roleBadges[role] ?? roleBadges.student;

  return (
    <MemberChip className={className} icon={badge.icon} size={size} tone={badge.tone}>
      {badge.label}
    </MemberChip>
  );
}
