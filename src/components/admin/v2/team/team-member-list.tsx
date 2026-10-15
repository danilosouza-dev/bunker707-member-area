import { ADMIN_ROLE_LABELS } from "@/server/auth/roles";
import { describeMemberAccess, type TeamMember } from "@/server/team/model";
import { DataTable, type DataTableColumn } from "../data-table";
import { StatusChip } from "../status-chip";
import { formatRelativeDate } from "../students/format";
import { StudentAvatar } from "../students/student-avatar";
import { teamMemberHref } from "./hrefs";

// Lista da equipe (Configuracoes > Equipe): quem e, funcao, o que alcanca e ultimo acesso. A linha
// inteira abre a pessoa. Apresentacao pura: a pagina le o banco.

type TeamMemberListProps = {
  /** Nome dos cursos (Professor mostra "Curso X +1"). */
  courseTitles: Readonly<Record<string, string>>;
  currentUserId: string;
  members: readonly TeamMember[];
  now: number;
};

function accessLabel(member: TeamMember, courseTitles: Readonly<Record<string, string>>) {
  if (member.role !== "instructor" || member.productIds.length === 0) {
    return describeMemberAccess(member);
  }

  const titles = member.productIds.map((id) => courseTitles[id]).filter(Boolean);

  if (titles.length === 0) {
    return describeMemberAccess(member);
  }

  return (
    <span className="truncate" title={titles.join(", ")}>
      {titles[0]}
      {member.productIds.length > 1 ? <span className="text-[var(--text-tertiary)]"> +{member.productIds.length - 1}</span> : null}
    </span>
  );
}

export function TeamMemberList({ courseTitles, currentUserId, members, now }: TeamMemberListProps) {
  const columns: DataTableColumn<TeamMember>[] = [
    {
      cell: (member) => (
        <span className="flex min-w-0 items-center gap-3">
          <StudentAvatar avatarUrl={member.avatarUrl} name={member.fullName} />
          <span className="block min-w-0 max-w-[260px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[var(--text-primary)]">{member.fullName}</span>
              {member.userId === currentUserId ? <StatusChip tone="muted">Você</StatusChip> : null}
            </span>
            <span className="block truncate text-xs text-[var(--text-tertiary)]">{member.email || "Sem e-mail"}</span>
          </span>
        </span>
      ),
      className: "min-w-[220px]",
      emphasis: true,
      header: "Pessoa",
      id: "pessoa"
    },
    {
      cell: (member) => <StatusChip tone={member.role === "owner" ? "success" : "neutral"}>{ADMIN_ROLE_LABELS[member.role]}</StatusChip>,
      // Cartao do celular: Funcao em duas colunas ao lado do Ultimo acesso; Acesso numa linha inteira embaixo.
      className: "max-md:col-span-2",
      header: "Função",
      id: "funcao",
      mobileLabel: "Função"
    },
    {
      cell: (member) => <span className="block max-w-[260px] truncate max-md:max-w-full">{accessLabel(member, courseTitles)}</span>,
      className: "max-md:order-last max-md:col-span-full",
      header: "Acesso",
      id: "acesso",
      mobileLabel: "Acesso"
    },
    {
      cell: (member) => (
        <span className={member.lastSignInAt ? undefined : "text-[var(--warning)]"}>{formatRelativeDate(member.lastSignInAt, now, "Nunca entrou")}</span>
      ),
      header: "Último acesso",
      id: "ultimo-acesso",
      mobileLabel: "Último acesso"
    }
  ];

  return (
    <DataTable
      caption="Pessoas da equipe"
      columns={columns}
      emptyDescription="Adicione quem vai ajudar: professores, suporte ou outro sócio."
      emptyTitle="Só você por enquanto"
      getRowHref={(member) => teamMemberHref(member.userId)}
      getRowKey={(member) => member.userId}
      mobile="cards"
      rows={members}
    />
  );
}
