import { ChevronRight, Copy } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ADMIN_ROLE_LABELS } from "@/server/auth/roles";
import { TEAM_PRESET_OPTIONS, TEAM_ROLE_DESCRIPTIONS, type TeamCustomFunction } from "@/server/team/model";
import { EmptyState } from "../empty-state";
import { adminCard, adminTransition } from "../styles";
import { NEW_TEAM_FUNCTION_PATH, newTeamFunctionFromPresetHref, teamFunctionHref } from "./hrefs";

// Funcoes da equipe (Configuracoes > Equipe > Funcoes): as suas, que voce edita e que valem para todo
// mundo que as tem, e as prontas, que nao mudam mas podem ser duplicadas e ajustadas.

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function TeamFunctionsList({ customFunctions }: { customFunctions: readonly TeamCustomFunction[] }) {
  const rowClass = "flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left";
  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="funcoes-suas" className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className={sectionTitle} id="funcoes-suas">
            Suas funções
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">Mudar uma função muda para todo mundo que a tem.</p>
        </div>
        {customFunctions.length === 0 ? (
          <EmptyState
            action={{ href: NEW_TEAM_FUNCTION_PATH, label: "Criar função" }}
            description="Junte funções prontas e marque o que mais quiser, como “Professor com criação” ou “Suporte sênior”."
            headingLevel="h3"
            size="compact"
            title="Nenhuma função sua ainda"
          />
        ) : (
          <ul className={cn(adminCard, "divide-y divide-[var(--border-subtle)] overflow-hidden")}>
            {customFunctions.map((fn) => (
              <li key={fn.id}>
                <Link className={cn(rowClass, adminTransition, "hover:bg-[var(--hover-overlay)]")} data-navigation-feedback="false" href={teamFunctionHref(fn.id)}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm leading-5 font-semibold text-[var(--text-primary)]">{fn.name}</span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                      {fn.description || plural(fn.actions.length, "permissão", "permissões")}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums sm:block">
                    {plural(fn.memberCount ?? 0, "pessoa", "pessoas")}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="funcoes-prontas" className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className={sectionTitle} id="funcoes-prontas">
            Funções prontas
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Não mudam. Para ajustar uma delas, duplique e mude a cópia. O Dono é à parte: pode tudo, inclusive mudar a equipe e as chaves de venda.
          </p>
        </div>
        <ul className={cn(adminCard, "divide-y divide-[var(--border-subtle)] overflow-hidden")}>
          {TEAM_PRESET_OPTIONS.map((preset) => (
            <li className={cn(rowClass, "max-sm:flex-col max-sm:items-start max-sm:gap-2")} key={preset}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{ADMIN_ROLE_LABELS[preset]}</span>
                <span className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{TEAM_ROLE_DESCRIPTIONS[preset]}</span>
              </span>
              <Link
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]",
                  adminTransition
                )}
                data-navigation-feedback="false"
                href={newTeamFunctionFromPresetHref(preset)}
              >
                <Copy aria-hidden="true" className="size-4" />
                Duplicar e ajustar
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
