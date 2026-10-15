import { SectionTabs } from "../section-tabs";
import { TEAM_FUNCTIONS_PATH, TEAM_PATH } from "./hrefs";

/** Abas da Equipe: pessoas e funcoes (as personalizadas e as prontas). */
export function TeamTabs({ functionCount, memberCount }: { functionCount?: number | null; memberCount?: number | null }) {
  return (
    <SectionTabs
      ariaLabel="Seções da equipe"
      items={[
        { count: memberCount ?? null, href: TEAM_PATH, label: "Pessoas" },
        { count: functionCount ?? null, href: TEAM_FUNCTIONS_PATH, label: "Funções" }
      ]}
    />
  );
}
