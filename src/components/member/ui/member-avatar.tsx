import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";

// Avatar do aluno (barra lateral, menu da conta, Perfil). Foto quando houver; senao iniciais sobre cor
// solida derivada do nome (docs/12: sem degrade decorativo).

export type MemberAvatarSize = "lg" | "md" | "sm" | "xl" | "xs";

const sizeClassNames: Record<MemberAvatarSize, { box: string; pixels: number; text: string }> = {
  lg: { box: "size-12", pixels: 48, text: "text-base" },
  md: { box: "size-10", pixels: 40, text: "text-sm" },
  sm: { box: "size-8", pixels: 32, text: "text-xs" },
  xl: { box: "size-20", pixels: 80, text: "text-2xl" },
  xs: { box: "size-7", pixels: 28, text: "text-[11px]" }
};

const avatarColors = ["bg-red-700", "bg-emerald-700", "bg-amber-700", "bg-teal-700", "bg-rose-800", "bg-zinc-600"];

export function getMemberInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("");

  return initials || "A";
}

function getAvatarColor(name: string) {
  const total = Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarColors[total % avatarColors.length];
}

export function MemberAvatar({
  className,
  imageSrc,
  name,
  size = "md"
}: {
  className?: string;
  imageSrc?: string | null;
  name: string;
  size?: MemberAvatarSize;
}) {
  const sizing = sizeClassNames[size];
  const src = imageSrc?.trim();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white ring-1 ring-white/10",
        sizing.box,
        src ? "bg-zinc-800" : getAvatarColor(name),
        className
      )}
    >
      {src ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes={`${sizing.pixels}px`}
          src={src}
          unoptimized={!canOptimizeImageSrc(src)}
        />
      ) : (
        <span className={cn("leading-none", sizing.text)}>{getMemberInitials(name)}</span>
      )}
    </span>
  );
}
