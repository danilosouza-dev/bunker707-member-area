import "server-only";

// O endereco por onde o dono e os administradores abrem o admin (docs/32 §2.2 e §11.3, "O endereco"; revisao de
// 11/11/2026). A copia do servidor e do banco noutro dominio mantem a variavel NEXT_PUBLIC_SITE_URL no endereco da
// licenca, mas quem a usa abre o admin pelo endereco dela. O layout do admin chama observeAdminRequestHost em cada
// pagina do dono e dos administradores; a regra mora em store.ts (planRequestHostObservation).
//
// - So no modo "enforce": no "off" nada daqui le o pedido, a licenca ou o banco.
// - Nenhuma gravacao por pedido: decide pela situacao deste pedido (a linha que ja fica um minuto na memoria do
//   processo) e so grava quando algo muda (a primeira vez por outro endereco, outro endereco, ou a volta ao endereco da
//   licenca). Mais uma trava: no maximo uma tentativa por minuto por mudanca, neste processo. A gravacao vai para depois
//   da resposta (after do Next) e, como toda gravacao da licenca, confere a versao da linha (mutateLicenseState).
// - So conta o nome publico (o pedido pelo proxy): localhost, IP e nome interno do conteiner nao contam.
// - Nunca lanca: a pagina do admin nunca cai por causa disto. O log leva so o codigo.
//
// E um obstaculo, como o resto: quem esconde o endereco verdadeiro atras de outro servidor, que reescreve o nome do
// pedido para o da licenca, passa por ele (docs/32 §7, trabalho tecnico).

import { headers } from "next/headers";
import { after } from "next/server";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { licensingMode, trustedRoots, type LicensingMode } from "./build-config";
import { forgetLicenseStateMemory, readCurrentLicenseState } from "./current-state";
import type { LicenseState } from "./state";
import { mutateLicenseState, planRequestHostObservation, publicRequestHost, type LicenseStateDb, type RequestHostOutcome } from "./store";
import { licenseStateDbOf } from "./store-db";

/** No maximo uma tentativa de gravacao por minuto para a mesma mudanca, neste processo. */
export const REQUEST_HOST_WRITE_INTERVAL_MS = 60_000;

/** O nome do pedido: o X-Forwarded-Host (o proxy da instalacao poe o nome que o navegador pediu) ou o Host. */
export async function currentRequestHost(): Promise<string | null> {
  const list = await headers();
  return list.get("x-forwarded-host") ?? list.get("host");
}

export type AdminRequestHostDeps = {
  mode: () => LicensingMode;
  requestHost: () => Promise<string | null>;
  state: () => Promise<LicenseState | null>;
  db: () => LicenseStateDb;
  roots: typeof trustedRoots;
  configuredHost: () => string | null;
  now: () => Date;
  /** Roda a gravacao depois da resposta (padrao: after do Next). */
  schedule: (task: () => Promise<void>) => void;
  forget: () => void;
  log: (message: string) => void;
};

const defaultDeps: AdminRequestHostDeps = {
  mode: licensingMode,
  requestHost: currentRequestHost,
  state: readCurrentLicenseState,
  db: () => licenseStateDbOf(getSupabaseAdminClient()),
  roots: trustedRoots,
  configuredHost: getConfiguredSiteOrigin,
  now: () => new Date(),
  schedule: (task) => after(task),
  forget: forgetLicenseStateMemory,
  log: (message) => console.error(message)
};

let lastAttempt: { key: string; atMs: number } | null = null;

export type AdminRequestHostResult = RequestHostOutcome | "desligado" | "segurado" | "falhou";

/**
 * Um pedido do dono ou de um administrador chegou: confere o endereco dele com o da licenca e, se algo mudou, agenda a
 * gravacao. Devolve o que decidiu (os testes conferem); nunca lanca.
 */
export async function observeAdminRequestHost(overrides: Partial<AdminRequestHostDeps> = {}): Promise<AdminRequestHostResult> {
  const deps = { ...defaultDeps, ...overrides };

  if (deps.mode() !== "enforce") {
    return "desligado";
  }

  try {
    const state = await deps.state();

    if (!state || state.mode !== "enforce" || !state.license) {
      return "sem_licenca";
    }

    const requestHost = await deps.requestHost();
    const host = publicRequestHost(requestHost);

    if (host === null) {
      return "fora_do_proxy";
    }

    // A situacao do pedido ja diz o endereco gravado (quando diferente do da licenca): so grava quando muda.
    const licenseHost = state.license.installation.host;
    const atLicenseHost = host === licenseHost;

    if (atLicenseHost ? state.requestHost === null : state.requestHost === host) {
      return atLicenseHost ? "no_endereco" : "ja_registrado";
    }

    const key = atLicenseHost ? "voltou" : `diferente:${host}`;
    const nowMs = deps.now().getTime();

    if (lastAttempt && lastAttempt.key === key && nowMs >= lastAttempt.atMs && nowMs - lastAttempt.atMs < REQUEST_HOST_WRITE_INTERVAL_MS) {
      return "segurado";
    }

    lastAttempt = { key, atMs: nowMs };
    const outcome: RequestHostOutcome = atLicenseHost ? "voltou" : state.requestHost === null ? "registrado" : "outro_endereco";

    deps.schedule(async () => {
      try {
        const written = await mutateLicenseState(deps.db(), (record) =>
          planRequestHostObservation(record, { requestHost, roots: deps.roots(), configuredHost: deps.configuredHost(), systemNow: deps.now() })
        );

        if (written?.wrote) {
          deps.forget();
        }
      } catch (error) {
        deps.log(`[licenca] endereco do pedido do admin: a gravacao falhou (${error instanceof Error ? error.name : "erro"}).`);
      }
    });

    return outcome;
  } catch (error) {
    deps.log(`[licenca] endereco do pedido do admin: nao foi possivel conferir (${error instanceof Error ? error.name : "erro"}).`);
    return "falhou";
  }
}
