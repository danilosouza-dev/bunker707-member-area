import {
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link2,
  LockKeyhole,
  Paperclip,
  Presentation,
  Sparkles,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { formatLessonMaterialSize, type LessonMaterialFileType, type StudentLessonMaterial } from "@/lib/lesson-materials";
import { cn } from "@/lib/utils";
import { MemberChip } from "./member-chip";

// Linha de material de apoio: aba Materiais da aula e pagina /materiais usam a mesma peca.
// Liberado: link https em nova aba (rel="noopener noreferrer"). Bloqueado pela regra do material:
// sem link (o servidor nem envia o endereco) e com o motivo visivel, sem depender de hover.

const fileTypeIcons: Record<LessonMaterialFileType, LucideIcon> = {
  archive: FileArchive,
  audio: FileAudio,
  document: FileText,
  image: FileImage,
  link: Link2,
  other: Paperclip,
  pdf: FileText,
  presentation: Presentation,
  spreadsheet: FileSpreadsheet,
  video: FileVideo
};

export type MemberMaterialRowData = Pick<
  StudentLessonMaterial,
  "description" | "fileType" | "generatedByAi" | "id" | "lockMessage" | "locked" | "sizeBytes" | "title" | "typeLabel" | "url"
>;

export function getMemberMaterialIcon(fileType: LessonMaterialFileType) {
  return fileTypeIcons[fileType] ?? Paperclip;
}

export function MemberMaterialRow({
  className,
  context,
  material,
  onOpen
}: {
  className?: string;
  /** Onde o material esta (pagina /materiais): "Curso de IA · Aula 3". */
  context?: ReactNode;
  material: MemberMaterialRowData;
  /** Registro de uso (ex.: evento material_downloaded). Nao bloqueia a abertura. */
  onOpen?: (materialId: string) => void;
}) {
  const Icon = fileTypeIcons[material.fileType] ?? Paperclip;
  const isLink = material.fileType === "link";
  const size = formatLessonMaterialSize(material.sizeBytes);
  const canOpen = !material.locked && Boolean(material.url);
  const ActionIcon = isLink ? ExternalLink : Download;

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-[10px] border",
          material.locked ? "border-white/[0.06] bg-white/[0.03] text-zinc-500" : "border-white/10 bg-white/[0.06] text-white"
        )}
      >
        <Icon className="size-5" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-semibold", material.locked ? "text-zinc-300" : "text-white")}>
          {material.title}
        </span>
        {material.description ? (
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{material.description}</span>
        ) : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-zinc-500">
          <span>{material.typeLabel}</span>
          {size ? <span aria-hidden="true">·</span> : null}
          {size ? <span>{size}</span> : null}
          {material.generatedByAi ? (
            <MemberChip icon={Sparkles} tone="neutral">
              Gerado com IA
            </MemberChip>
          ) : null}
          {context ? <span aria-hidden="true">·</span> : null}
          {context ? <span className="min-w-0 truncate">{context}</span> : null}
        </span>
        {material.locked ? (
          <span className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-200 sm:hidden">
            <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
            {material.lockMessage ?? "Bloqueado"}
          </span>
        ) : null}
      </span>
      {material.locked ? (
        <span className="inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 max-sm:hidden">
          <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{material.lockMessage ?? "Bloqueado"}</span>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-white/12 bg-white/[0.06] px-3 text-[13px] font-semibold text-white transition group-hover:border-white/25 group-hover:bg-white/[0.12]"
        >
          <ActionIcon className="size-4" />
          <span className="max-sm:hidden">{isLink ? "Abrir" : "Baixar"}</span>
        </span>
      )}
    </>
  );

  const rowClassName = cn(
    "group flex min-w-0 items-center gap-3 rounded-[12px] border px-3 py-3 sm:gap-4 sm:px-4",
    material.locked
      ? "border-white/[0.06] bg-white/[0.02]"
      : "border-white/[0.08] bg-[#181818] transition-[background-color,border-color] hover:border-white/20 hover:bg-[#1e1e1e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
    className
  );

  if (canOpen) {
    return (
      <a
        aria-label={`${isLink ? "Abrir" : "Baixar"} ${material.title} (${material.typeLabel}, abre em nova aba)`}
        className={rowClassName}
        href={material.url}
        onClick={onOpen ? () => onOpen(material.id) : undefined}
        rel="noopener noreferrer"
        target="_blank"
      >
        {body}
      </a>
    );
  }

  return (
    <div aria-label={`${material.title}. ${material.lockMessage ?? "Indisponível"}`} className={rowClassName} role="group">
      {body}
    </div>
  );
}
