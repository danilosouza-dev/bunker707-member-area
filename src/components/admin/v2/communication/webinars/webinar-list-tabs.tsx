import Link from "next/link";
import { cn } from "@/lib/utils";
import { WEBINAR_ADMIN_COPY, WEBINAR_LIST_TABS, webinarsHref, type ParamsRecord, type WebinarListTab } from "@/server/webinars/editor-model";
import { adminTransition } from "../../styles";

// Abas da pagina de Webinários (docs/30 §2.1): Webinários · Lives ao vivo · Lives gravadas, por ?aba=, com o
// mesmo desenho das abas de secao (section-tabs.tsx: 40 px, sublinhado de 2 px). Aqui sem hooks: a aba ativa vem
// da pagina (o endereco), entao o componente desenha no servidor. O periodo da barra superior segue junto; os
// filtros da tabela (situacao, tipo, busca) nao, porque so valem na primeira aba.

type WebinarListTabsProps = {
  active: WebinarListTab;
  searchParams: ParamsRecord;
};

export function WebinarListTabs({ active, searchParams }: WebinarListTabsProps) {
  const periodo = typeof searchParams.periodo === "string" && searchParams.periodo ? searchParams.periodo : null;

  return (
    <nav aria-label={WEBINAR_ADMIN_COPY.list.tabsLabel} className="min-w-0 border-b border-[var(--border-subtle)]">
      <ul className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {WEBINAR_LIST_TABS.map((tab) => {
          const isActive = tab.value === active;

          return (
            <li className="shrink-0" key={tab.value}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-2 rounded-t-[6px] px-3 text-sm font-medium whitespace-nowrap outline-offset-[-2px]",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                  adminTransition,
                  isActive
                    ? "text-[var(--text-primary)] after:bg-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] after:bg-transparent hover:text-[var(--text-primary)]"
                )}
                data-navigation-feedback="false"
                href={webinarsHref({ periodo, tab: tab.value })}
                scroll={false}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
