import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShellV2 } from "@/components/admin/v2/admin-shell";
import type { AdminFilterProduct } from "@/components/admin/v2/filters";
import { formatAdminRole } from "@/components/admin/v2/format";
import type { AdminNavCounts } from "@/components/admin/v2/nav";
import { readTodayAlertSummary } from "@/server/admin/today";
import { requirePageAdmin } from "@/server/auth/guards";
import { getUserDisplayName } from "@/server/auth/session";
import { PRODUCT_ACCENTS } from "@/server/catalog/model";
import { listProductOptions } from "@/server/catalog/queries";
import { countOverdueQuestions } from "@/server/community/counts";
import { isPendingMigrationError } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: {
    default: "Admin Bunker707",
    template: "%s · Admin Bunker707"
  }
};

// Moldura do admin novo (docs/17 §2.3, prototipo aprovado). Aqui so o que a moldura mostra: os
// contadores do menu (Hoje e Comunidade) e as opcoes do filtro Produto da barra superior. O layout
// persiste entre navegacoes, entao e uma leitura por carregamento completo; qualquer falha deixa a
// moldura sem contador ou sem opcoes, nunca quebrada. O layout nao protege as paginas: layout e pagina
// renderizam em paralelo, entao cada page.tsx chama requirePageAdmin() de novo. Usuario e papel sao
// memoizados por requisicao (React.cache em src/server/auth/session.ts).
export default async function AdminV2Layout({ children }: { children: ReactNode }) {
  const { role, user } = await requirePageAdmin();
  const { fullName } = getUserDisplayName(user);
  const [counts, products] = await Promise.all([readNavCounts(), readProductFilterOptions()]);

  return (
    <AdminShellV2
      account={{ email: user.email ?? "", name: fullName, roleLabel: formatAdminRole(role) }}
      counts={counts}
      products={products}
    >
      {children}
    </AdminShellV2>
  );
}

/**
 * Contadores do menu: Hoje = numero de cartoes de "Precisa de atencao hoje"; Comunidade = perguntas de
 * alunos sem resposta ha mais de 24 h. Uma leitura (readTodayAlertSummary, migracao 202610120001); sem
 * ela, a Comunidade cai na contagem da fase 1 (community_overdue_count, 202610110020).
 */
async function readNavCounts(): Promise<AdminNavCounts> {
  const summary = await readTodayAlertSummary();

  if (summary) {
    return { comunidade: summary.overdueQuestions, hoje: summary.attentionCount };
  }

  try {
    return { comunidade: await countOverdueQuestions() };
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error("[admin] Contador da Comunidade:", error instanceof Error ? error.message : error);
    }

    return {};
  }
}

/** Opcoes do filtro Produto (nome e cor). Sem catalogo legivel, o filtro mostra so "Todos os produtos". */
async function readProductFilterOptions(): Promise<AdminFilterProduct[]> {
  try {
    const options = await listProductOptions();

    return options.map((option) => ({ accent: PRODUCT_ACCENTS[option.accent], id: option.id, label: option.title }));
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error("[admin] Produtos do filtro:", error instanceof Error ? error.message : error);
    }

    return [];
  }
}
