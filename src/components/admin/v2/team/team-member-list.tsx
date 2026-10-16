import type { AdminAction, ActionScope } from "@/server/auth/roles";
import { describeMemberAccess, describeMemberFunctions, type TeamCustomFunction, type TeamMember } from "@/server/team/model";
import { DataTable, type DataTableColumn } from "../data-table";
import { StatusChip } from "../status-chip";
import { formatRelativeDate } from "../students/format";
import { StudentAvatar } from "../students/student-avatar";
import { teamMemberHref } from "./hrefs";

// Lista da equipe (Configuracoes > Equipe > Pessoas): quem e, funcoes, o que alcanca e ultimo acesso.
// A linha inteira abre a pessoa. Apresentacao pura: a pagina le o banco e calcula as permissoes.

export type TeamMemberRow = TeamMember & {
  /** Permissoes efetivas (funcoes + extras), calculadas no servidor. */
  grants: ReadonlyMap<AdminAction, ActionScope>;
};

type TeamMemberListProps = {
  currentUserId: string;
  customFunctions: readonly TeamCustomFunction[];
  members: readonly TeamMemberRow[];
  now: number;
};

export function TeamMemberList({ currentUserId, customFunctions, members, now }: TeamMemberListProps) {
  const names = new Map(customFunctions.map((fn) => [fn.id, fn]));
  const columns: DataTableColumn<TeamMemberRow>[] = [
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
      cell: (member) =>
        member.owner ? (
          <StatusChip tone="success">Dono</StatusChip>
        ) : (
          <span className="block max-w-[260px] truncate max-md:max-w-full" title={describeMemberFunctions(member, names)}>
            {describeMemberFunctions(member, names)}
          </span>
        ),
      // Cartao do celular: Funcao em duas colunas ao lado do Ultimo acesso; Acesso numa linha inteira embaixo.
      className: "max-md:col-span-2",
      header: "Função",
      id: "funcao",
      mobileLabel: "Função"
    },
    {
      cell: (member) => <span className="block max-w-[240px] truncate max-md:max-w-full">{describeMemberAccess(member, member.grants)}</span>,
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
