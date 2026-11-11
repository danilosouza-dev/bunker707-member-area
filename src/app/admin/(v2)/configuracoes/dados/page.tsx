import { Download } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { licensePrimaryButton } from "@/components/admin/v2/license/styles";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { adminCard } from "@/components/admin/v2/styles";
import { cn } from "@/lib/utils";
import { requirePageArea } from "@/server/auth/permissions";
import { EXPORT_DATA_HREF, EXPORT_FILES, README_NAME, exportFileKeys } from "@/server/export/school-data-model";
import { isLicenseManager } from "@/server/licensing/admin-access";
import { licensingMode } from "@/server/licensing/build-config";

export const metadata: Metadata = {
  title: "Exportar dados"
};

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Exportar dados" }] as const;

// Configuracoes > Exportar dados (docs/32 §2.2 e §4): o dono e os administradores baixam um ZIP com os dados da escola em
// planilhas. Funciona nos dois modos e em todo degrau da Licenca (dever legal): a pagina nao pergunta a licenca, e a rota
// tambem nao barra. Montada no servidor, sem JavaScript novo: o botao e um link de download.
export default async function ExportDataPage() {
  const { access } = await requirePageArea("configuracoes");

  if (!isLicenseManager(access)) {
    redirect("/admin/configuracoes");
  }

  const keys = exportFileKeys({ heldSales: licensingMode() === "enforce" });

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={BREADCRUMB}
        description="Um ZIP com os dados da escola em planilhas, para guardar, migrar ou atender um pedido. Funciona sempre, em qualquer situação da Licença."
        title="Exportar dados"
      />
      <section aria-label="O que vem no ZIP" className={cn(adminCard, "flex w-full max-w-[880px] min-w-0 flex-col gap-4 px-5 py-4")}>
        <div className="flex flex-col gap-1">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">O que vem no ZIP</h2>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {`Um ${README_NAME} que explica cada arquivo e como abrir, e um arquivo .csv para cada parte da escola. Abre no Excel, no Google Planilhas ou no LibreOffice.`}
          </p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {keys.map((key) => (
            <li className="flex min-w-0 flex-col text-sm leading-5" key={key}>
              <span className="font-medium text-[var(--text-primary)]">{EXPORT_FILES[key].name}</span>
              <span className="text-[13px] text-[var(--text-secondary)]">{EXPORT_FILES[key].description}</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          Não vêm senhas, tokens, chaves nem a Licença, e os vídeos e arquivos enviados ficam no provedor de vídeo e no armazenamento. Numa escola grande o download leva alguns minutos.
        </p>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          O arquivo tem dados pessoais de alunos: guarde com cuidado e apague as cópias que não precisar mais. Cada exportação fica registrada na auditoria.
        </p>
        <div>
          <a className={licensePrimaryButton} data-slot="button" download href={EXPORT_DATA_HREF}>
            <Download aria-hidden="true" className="size-4" />
            Baixar os dados (ZIP)
          </a>
        </div>
      </section>
    </AdminPage>
  );
}
