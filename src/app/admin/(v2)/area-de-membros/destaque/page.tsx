import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { HeroEditor } from "@/components/admin/v2/member-area/home-hero/hero-editor";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getHomeHeroEditorData } from "@/server/member-area/home-hero-queries";

export const metadata: Metadata = {
  title: "Destaque"
};

async function loadHomeHero() {
  try {
    return { data: await getHomeHeroEditorData(), ok: true as const };
  } catch (error) {
    console.error("[admin/area-de-membros/destaque]", error);
    return { ok: false as const };
  }
}

// Area de membros > Destaque: o banner do topo da home do aluno (imagem ou video, textos e botao).
export default async function AdminHomeHeroPage() {
  const { role } = await requirePageAdmin();
  const result = await loadHomeHero();

  if (!result.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar o destaque">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return <HeroEditor canEdit={canRole(role, "storefront.write")} data={result.data} />;
}
