import "server-only";

// A situacao da licenca neste pedido (docs/32 §11.3). E o que as paginas, rotas e acoes passam para
// requireFeature e requireActionClass (require-feature.ts), pelas guardas de guards.ts e por runAdminAction.
//
// - Modo "off" (a nossa escola hoje, a `dev`, a Vercel e os testes): devolve so o modo, sem criar o cliente do banco
//   nem ler nada. O app se comporta exatamente como antes.
// - Modo "enforce" (a imagem vendida): le a linha de license_state e monta a situacao (state.ts) com o relogio do
//   servidor e o endereco configurado da Instalacao, NEXT_PUBLIC_SITE_URL, o mesmo que monta os links dos e-mails e
//   dos convites (src/server/auth/site-origin.ts). Nunca grava: quem grava e a tarefa do tick.
// Uma leitura por pedido (cache do React). As rotas consultadas sem parar (a presenca da sala a cada 15 s, o sino, o
// progresso) perguntam a cada pedido, e o cache do React nao vale nas rotas: por isso a linha lida fica na memoria do
// processo por LICENSE_ROW_MEMORY_MS. A situacao e montada de novo a cada pedido, com o relogio de agora; so a linha
// fica guardada. A tarefa do tick esquece a memoria depois de gravar (forgetLicenseStateMemory), e as acoes da tela
// Licenca (ativar, Verificar agora, desativar, licenca por arquivo) fazem o mesmo.

import { cache } from "react";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { licensingMode, trustedRoots } from "./build-config";
import { refuseUnsafeNodeStart } from "./node-start";
import type { LicenseState } from "./state";
import { hasInstallationCredentials, loadLicenseState, type LicenseStateDb, type LicenseStateRecord } from "./store";
import { licenseStateDbOf } from "./store-db";

/** Quanto a linha lida vale na memoria do processo. A situacao fica no maximo isso atras da tabela. */
export const LICENSE_ROW_MEMORY_MS = 60_000;

let remembered: { readAtMs: number; record: LicenseStateRecord | null } | null = null;

/** Esquece a linha guardada: o proximo pedido le a tabela de novo. */
export function forgetLicenseStateMemory(): void {
  remembered = null;
}

/** O adaptador da leitura de cada pedido: a linha da memoria enquanto vale, senao a da tabela. Nunca grava. */
const rememberingDb: LicenseStateDb = {
  async read() {
    const nowMs = Date.now();

    if (remembered && nowMs >= remembered.readAtMs && nowMs - remembered.readAtMs < LICENSE_ROW_MEMORY_MS) {
      return remembered.record;
    }

    const record = await licenseStateDbOf(getSupabaseAdminClient()).read();
    remembered = { readAtMs: nowMs, record };
    return record;
  },
  async write() {
    throw new Error("A situacao do pedido nunca grava: quem grava e a tarefa do tick.");
  }
};

export const getCurrentLicenseState = cache((): Promise<LicenseState> => {
  const mode = licensingMode();

  // A conferencia da subida (instrumentation.ts) tambem aqui, no servidor de verdade: o NEXT_PHASE de build no compose
  // pula o register() do Next. Uma leitura do /proc por processo; depois, so a memoria (node-start.ts).
  if (mode === "enforce" && process.env.NEXT_RUNTIME === "nodejs") {
    refuseUnsafeNodeStart({ mode });
  }

  return loadLicenseState({
    mode,
    db: () => rememberingDb,
    roots: trustedRoots,
    configuredHost: getConfiguredSiteOrigin,
    systemNow: () => new Date()
  });
});

/**
 * O que a tela Licenca mostra alem da situacao: o identificador da Instalacao, a ultima conferencia boa e a ultima
 * tentativa de conversa com o Emissor. Nunca o segredo nem a sequencia. A mesma linha da memoria do processo (as acoes
 * da tela a esquecem depois de gravar).
 */
export type LicenseOverview = {
  state: LicenseState;
  installationId: string | null;
  /** A Instalacao tem identificador e segredo (so o fato, nunca o segredo): da para conferir e desativar. */
  hasInstallationCredentials: boolean;
  lastCheckIn: { emissorTime: Date; localTime: Date } | null;
  lastAttempt: { at: Date | null; result: string | null };
};

export const getLicenseOverview = cache(async (): Promise<LicenseOverview> => {
  const state = await getCurrentLicenseState();

  if (state.mode === "off") {
    return { state, installationId: null, hasInstallationCredentials: false, lastCheckIn: null, lastAttempt: { at: null, result: null } };
  }

  const record = await rememberingDb.read();

  return {
    state,
    installationId: record?.installationId ?? null,
    hasInstallationCredentials: hasInstallationCredentials(record),
    lastCheckIn: record?.lastCheckIn ?? null,
    lastAttempt: { at: record?.checkInAttemptedAt ?? null, result: record?.checkInResult ?? null }
  };
});
