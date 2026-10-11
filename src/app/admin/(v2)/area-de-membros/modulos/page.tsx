import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { ModulesScreen } from "@/components/admin/v2/member-area/modules/modules-screen";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { parseModuleSettingsSearchParams } from "@/server/member-area/modules-model";
import { listModuleSettings } from "@/server/member-area/modules-queries";

export const metadata: Metadata = {
  title: "Módulos"
};

type AdminModulesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadModules(query: ReturnType<typeof parseModuleSettingsSearchParams>) {
  try {
    return await loadUnlessPendingMigration(() => listModuleSettings(query));
  } catch (error) {
    console.error("[admin/area-de-membros/modulos]", error);
    return null;
  }
}

// Area de membros › Modulos: por curso, como abre, a fileira de modulos na home e as capas dos
// modulos. Busca (?busca=) e pagina (?pagina=) no endereco; tudo salva na hora.
export default async function AdminModulesPage({ searchParams }: AdminModulesPageProps) {
  const { role } = await requirePageAdmin();
  const query = parseModuleSettingsSearchParams(await searchParams);
  const loaded = await loadModules(query);

  if (!loaded) {
    return (
      <ErrorBanner title="Não foi possível carregar os módulos">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  return (
    <ModulesScreen
      canWriteCatalog={canRole(role, "catalog.write")}
      canWriteStorefront={canRole(role, "storefront.write")}
      data={loaded.data}
    />
  );
}
