import "server-only";

// A situacao da licenca neste pedido (docs/32 §11.3). E o que as paginas, rotas e acoes passam para
// requireFeature e requireActionClass (require-feature.ts).
//
// - Modo "off" (a nossa escola hoje, a `dev`, a Vercel e os testes): devolve so o modo, sem criar o cliente do banco
//   nem ler nada. O app se comporta exatamente como antes.
// - Modo "enforce" (a imagem vendida): le a linha de license_state e monta a situacao (state.ts) com o relogio do
//   servidor e o endereco configurado da Instalacao, NEXT_PUBLIC_SITE_URL, o mesmo que monta os links dos e-mails e
//   dos convites (src/server/auth/site-origin.ts). Nunca grava: quem grava e a tarefa do tick.
// Uma leitura por pedido (cache do React). A memoria de alguns minutos para as rotas consultadas sem parar (docs/32
// §11.3) entra quando a primeira delas passar a perguntar.

import { cache } from "react";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { licensingMode, trustedRoots } from "./build-config";
import type { LicenseState } from "./state";
import { loadLicenseState } from "./store";
import { licenseStateDbOf } from "./store-db";

export const getCurrentLicenseState = cache(
  (): Promise<LicenseState> =>
    loadLicenseState({
      mode: licensingMode(),
      db: () => licenseStateDbOf(getSupabaseAdminClient()),
      roots: trustedRoots,
      configuredHost: getConfiguredSiteOrigin,
      systemNow: () => new Date()
    })
);
