import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { getInitials } from "../format";

// Foto do aluno (a que ele subiu no perfil) ou as iniciais sobre a superficie 3. Tamanhos: 28 na
// tabela, 40 no seletor e 56 no cabecalho do perfil.

const sizes = {
  lg: { box: "size-14 text-base", pixels: 56 },
  md: { box: "size-10 text-sm", pixels: 40 },
  sm: { box: "size-7 text-[11px] tracking-[0.02em]", pixels: 28 }
} as const;

type StudentAvatarProps = {
  avatarUrl: string | null;
  className?: string;
  name: string;
  size?: keyof typeof sizes;
};

export function StudentAvatar({ avatarUrl, className, name, size = "sm" }: StudentAvatarProps) {
  const spec = sizes[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--surface-3)] font-semibold text-[var(--text-secondary)] select-none",
        spec.box,
        className
      )}
    >
      {avatarUrl ? (
        <Image alt="" className="object-cover" fill sizes={`${spec.pixels}px`} src={avatarUrl} unoptimized={!canOptimizeImageSrc(avatarUrl)} />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}
