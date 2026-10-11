import { Suspense } from "react";
import { SectionTabs, type SectionTabItem } from "../section-tabs";

const tabs: readonly SectionTabItem[] = [
  { href: "/admin/configuracoes/ia", label: "Modelos e limites" },
  { href: "/admin/configuracoes/ia/conexoes", label: "Conexões" },
  { href: "/admin/configuracoes/ia/consumo", label: "Consumo" }
];

function StaticTabs() {
  return (
    <div aria-hidden="true" className="h-10 border-b border-[var(--border-subtle)]" />
  );
}

/** Abas de Configurações › Tutor IA, cada uma com endereco proprio; o provedor e o periodo seguem junto. */
export function AiSettingsTabs() {
  return (
    <Suspense fallback={<StaticTabs />}>
      <SectionTabs ariaLabel="Seções do Tutor IA" items={tabs} preserveParams={["provedor", "periodo"]} />
    </Suspense>
  );
}
