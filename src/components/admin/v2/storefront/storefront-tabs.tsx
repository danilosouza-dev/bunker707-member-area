import { Suspense } from "react";
import { SectionTabs, type SectionTabItem } from "../section-tabs";

// Mesma lista e ordem dos filhos de "Área de membros" no menu (src/components/admin/v2/nav.ts).
const tabs: readonly SectionTabItem[] = [
  { href: "/admin/area-de-membros", label: "Vitrine" },
  { href: "/admin/area-de-membros/destaque", label: "Destaque" },
  { href: "/admin/area-de-membros/modulos", label: "Módulos" },
  { href: "/admin/area-de-membros/login", label: "Login" },
  { href: "/admin/area-de-membros/marca", label: "Marca" }
];

function StaticTabs() {
  return <div aria-hidden="true" className="h-10 border-b border-[var(--border-subtle)]" />;
}

/** Abas da Área de membros, cada uma com endereco proprio. */
export function StorefrontTabs() {
  return (
    <Suspense fallback={<StaticTabs />}>
      <SectionTabs ariaLabel="Seções da área de membros" items={tabs} />
    </Suspense>
  );
}
