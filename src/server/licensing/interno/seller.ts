import "server-only";

// As paginas e tarefas de vendedor neste servidor (docs/32 §2.4, §11.3 e §11.10; a regra em seller-model.ts): ligadas so
// com a API interna do Emissor configurada (EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL, ou o simulador fora da
// producao) e, no modo "enforce", com a chave interna `seller-pages` na licenca assinada. Devolve o cliente pronto.
//
// Quem pergunta: o menu do aluno (getAppShellData), a pagina e as acoes de Minhas licencas, a marca Bunker Members no
// produto, a lista da fila em Configuracoes > Vendas, o passo da venda em process-sale.ts e a tarefa `licencas-vendas`.
// Sem a configuracao, a resposta sai sem ler o banco nem a licenca.

import { licensingMode } from "@/server/licensing/build-config";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import { isGrantEnabled } from "@/server/licensing/require-feature";
import { notConfiguredInternalEmissor, type InternalEmissorClient } from "./contract";
import { readInternalEmissorConfig } from "./config";
import { createHttpInternalEmissor } from "./http-client";
import { SELLER_PAGES_GRANT, sellerAccessOf, type SellerAccess } from "./seller-model";
import { createInternalEmissorSimulator, type InternalEmissorSimulator } from "./simulator";

export type SellerFeatures = SellerAccess & { client: InternalEmissorClient };

type SimulatorHolder = { __bunkerInternalEmissorSimulator?: InternalEmissorSimulator };

/**
 * O simulador do processo: um so, guardado no globalThis para o `next dev` nao perder o estado a cada recarga. Na `dev`
 * todo codigo de produto vale como Licenca anual (o simulador nao tem o mapa do Emissor).
 */
function processSimulator(): InternalEmissorSimulator {
  const holder = globalThis as SimulatorHolder;
  holder.__bunkerInternalEmissorSimulator ??= createInternalEmissorSimulator({ defaultKind: "anual" });
  return holder.__bunkerInternalEmissorSimulator;
}

/** As paginas e tarefas de vendedor estao ligadas aqui? Com o cliente da API interna (ou o que responde nao_configurado). */
export async function getSellerFeatures(): Promise<SellerFeatures> {
  const mode = licensingMode();
  const config = readInternalEmissorConfig(process.env, { mode });

  if (config.mode === "desligado") {
    return { client: notConfiguredInternalEmissor, enabled: false, reason: config.reason };
  }

  // So no modo "enforce" a licenca e lida (uma vez por pedido, com a memoria de um minuto do current-state).
  const grantEnabled = mode === "enforce" ? isGrantEnabled(await readCurrentLicenseState(), SELLER_PAGES_GRANT) : false;
  const access = sellerAccessOf({ config, grantEnabled, licensingMode: mode });

  if (!access.enabled) {
    return { ...access, client: notConfiguredInternalEmissor };
  }

  const client = config.mode === "http" ? createHttpInternalEmissor({ baseUrl: config.baseUrl, credential: config.credential }) : processSimulator();

  return { ...access, client };
}

/** So a pergunta, sem montar o cliente (o menu de toda pagina do aluno). */
export async function sellerFeaturesEnabled(): Promise<boolean> {
  return (await getSellerFeatures()).enabled;
}
