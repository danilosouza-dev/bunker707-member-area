import { ADMIN_ROLE_LABELS } from "@/server/auth/roles";
import { TEAM_ROLE_DESCRIPTIONS, TEAM_ROLE_OPTIONS } from "@/server/team/model";
import { adminCard } from "../styles";

// Resumo das funcoes (para o dono escolher sem decorar a tabela de permissoes). Mesma ordem do
// seletor da tela de adicionar, com o Dono no topo.

const ORDER = ["owner", ...TEAM_ROLE_OPTIONS.filter((role) => role !== "owner")] as const;

export function RolesOverview() {
  return (
    <section aria-labelledby="funcoes-titulo" className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-[15px] leading-5 font-semibold text-[var(--text-primary)]" id="funcoes-titulo">
          O que cada função faz
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
          Mudar a equipe e as chaves de venda ficam sempre com o dono. Tudo o que a equipe faz com alunos e acessos fica registrado.
        </p>
      </div>
      <dl className={`${adminCard} divide-y divide-[var(--border-subtle)]`}>
        {ORDER.map((role) => (
          <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-6" key={role}>
            <dt className="shrink-0 text-sm leading-5 font-medium text-[var(--text-primary)] sm:w-44">{ADMIN_ROLE_LABELS[role]}</dt>
            <dd className="min-w-0 text-[13px] leading-5 text-[var(--text-secondary)]">{TEAM_ROLE_DESCRIPTIONS[role]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
