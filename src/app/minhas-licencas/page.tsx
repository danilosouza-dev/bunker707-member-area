import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { LicensesView } from "@/components/member/licenses/licenses-view";
import { requirePageUser } from "@/server/auth/guards";
import { getAppShellData } from "@/server/db/platform-store";
import { getMyLicensesPage } from "@/server/licensing/interno/student";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Minhas licenças | Bunker707"
};

// Minhas licencas (docs/32 §2.4 e §11.10): so na nossa escola, com a API interna do Emissor configurada (seller.ts), e so
// para quem tem acesso aberto a um produto marcado como Bunker Members; para qualquer outra pessoa, e no produto vendido,
// a pagina nao existe (404). Sempre a conta da sessao: a previa da equipe ("ver como aluno") nunca se aplica aqui, e a
// Chave de ativacao nunca e escrita no HTML (ela chega pela Server Action, a pedido).
export default async function MyLicensesPage() {
  const user = await requirePageUser("/minhas-licencas");
  const page = await getMyLicensesPage(user.id);

  if (!page) {
    notFound();
  }

  const shellData = await getAppShellData(user);

  return (
    <AppShell branding={shellData.branding} canUseAccessPreview={false} disabledFeatures={shellData.disabledFeatures} student={shellData.student}>
      <LicensesView accountEmail={user.email ?? ""} page={page} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}
