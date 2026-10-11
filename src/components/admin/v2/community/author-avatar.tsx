import { cn } from "@/lib/utils";
import { PRODUCT_ACCENTS, type ProductAccent } from "@/server/catalog/model";

// Avatar de quem comentou: iniciais sobre a cor do produto da aula (como no prototipo aprovado).
// O professor usa o fundo claro, igual ao selo "Professor".

type AuthorAvatarProps = {
  accent?: ProductAccent | null;
  className?: string;
  initials: string;
  professor?: boolean;
  size?: "sm" | "md";
};

export function AuthorAvatar({ accent, className, initials, professor = false, size = "md" }: AuthorAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-[var(--surface-0)]",
        size === "md" ? "size-8 text-xs" : "size-6 text-[11px]",
        professor ? "bg-[var(--text-primary)]" : !accent && "bg-[var(--text-secondary)]",
        className
      )}
      style={!professor && accent ? { backgroundColor: PRODUCT_ACCENTS[accent] } : undefined}
    >
      {initials}
    </span>
  );
}

/** Selo "Professor" das respostas da equipe (fundo claro, texto escuro). */
export function ProfessorBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md bg-[var(--text-primary)] px-1.5 text-xs leading-none font-semibold text-[var(--surface-0)]",
        className
      )}
    >
      Professor
    </span>
  );
}
