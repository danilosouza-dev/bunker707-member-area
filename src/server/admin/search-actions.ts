"use server";

// Busca global do admin (Cmd/Ctrl+K). Qualquer papel do admin pode buscar ("admin.read"); o texto e
// validado aqui (2 a 80 caracteres) e a leitura devolve so nome, contexto e endereco de cada item.
// Professor: a busca fica nos cursos dele (target "any" + filtro pelos cursos na leitura).

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { ADMIN_SEARCH_MAX_LENGTH, ADMIN_SEARCH_MIN_LENGTH, cleanAdminSearchQuery, type AdminSearchResults } from "@/components/admin/v2/search-model";
import { runAdminAction } from "@/server/actions/run-action";
import { searchAdminCatalog } from "./search";

const searchAdminSchema = z.object({
  q: z
    .string()
    .transform((value) => cleanAdminSearchQuery(value))
    .pipe(z.string().min(ADMIN_SEARCH_MIN_LENGTH, "Digite pelo menos 2 letras.").max(ADMIN_SEARCH_MAX_LENGTH))
});

export async function searchAdmin(raw: unknown): Promise<ActionResult<AdminSearchResults>> {
  return runAdminAction("admin.read", searchAdminSchema, raw, async ({ access, input }) => searchAdminCatalog(input.q, access.productIds), {
    target: () => "any"
  });
}
