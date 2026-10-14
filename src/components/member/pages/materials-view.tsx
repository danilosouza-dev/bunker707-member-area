import { FolderOpen, LibraryBig, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { MemberButtonLink, memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberPage, MemberPageHeader } from "@/components/member/ui/member-page";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { formatMemberCount } from "@/lib/member-format";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import type { MaterialsPageData } from "@/server/member-area/student-pages";
import { MaterialsBrowser } from "./materials-browser";

// Materiais: arquivos de apoio de todas as aulas liberadas do aluno, por curso e aula.
// Estados honestos: sem aula liberada, sem material publicado (ou banco sem a tabela) e erro.

function TeamHint({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-4 max-w-xl rounded-[10px] border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs leading-5 text-zinc-400">
      <span className="font-semibold text-zinc-200">Para a equipe:</span> {children}
    </p>
  );
}

export function MaterialsView({
  accessPreviewMode,
  canUseAccessPreview,
  data
}: {
  accessPreviewMode?: AccessPreviewMode;
  canUseAccessPreview: boolean;
  data: MaterialsPageData;
}) {
  const purchasesHref = withAccessPreviewParam(MEMBER_ROUTES.purchases, accessPreviewMode);
  const materialsHref = withAccessPreviewParam(MEMBER_ROUTES.materials, accessPreviewMode);
  const view = data.state === "ready" && data.view.total > 0 ? data.view : null;

  return (
    <MemberPage width="default">
      <MemberPageHeader
        description="Os arquivos de apoio das suas aulas liberadas, organizados por curso e aula."
        eyebrow={{ icon: FolderOpen, label: "Arquivos de apoio" }}
        title="Materiais"
      >
        {view ? (
          <div className="flex flex-wrap items-center gap-2">
            <MemberChip size="md" tone="neutral">
              {formatMemberCount(view.total, "material", "materiais")}
            </MemberChip>
            <MemberChip size="md" tone="outline">
              {formatMemberCount(view.groups.length, "curso")}
            </MemberChip>
            {view.lockedCount > 0 ? (
              <MemberChip size="md" tone="warning">
                {view.lockedCount} para liberar
              </MemberChip>
            ) : null}
          </div>
        ) : null}
      </MemberPageHeader>

      {view ? <MaterialsBrowser view={view} /> : null}

      {data.state === "no_lessons" ? (
        <MemberEmptyState
          action={
            <MemberButtonLink href={purchasesHref} variant="primary">
              <LibraryBig />
              Ver minhas compras
            </MemberButtonLink>
          }
          description="Os materiais aparecem aqui quando você tiver aulas liberadas."
          icon={FolderOpen}
          title="Nenhuma aula liberada ainda"
        />
      ) : null}

      {data.state === "unavailable" || (data.state === "ready" && data.view.total === 0) ? (
        <div>
          <MemberEmptyState
            description="Quando o professor publicar arquivos de apoio nas suas aulas, eles aparecem aqui."
            icon={FolderOpen}
            title="Nenhum material publicado ainda"
          />
          {canUseAccessPreview ? (
            <TeamHint>
              {data.state === "unavailable"
                ? "este banco ainda não tem a tabela de materiais (migração 202610130001). O cadastro de materiais chega no admin na próxima etapa."
                : "o cadastro de materiais chega no admin na próxima etapa."}
            </TeamHint>
          ) : null}
        </div>
      ) : null}

      {data.state === "error" ? (
        <MemberEmptyState
          action={
            <a className={memberButtonClassName({ variant: "primary" })} href={materialsHref}>
              Tentar de novo
            </a>
          }
          description="Algo falhou ao buscar os materiais. Tente de novo em alguns instantes."
          icon={TriangleAlert}
          title="Não foi possível carregar os materiais"
        />
      ) : null}
    </MemberPage>
  );
}
