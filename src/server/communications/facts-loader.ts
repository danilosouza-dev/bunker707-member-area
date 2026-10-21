import "server-only";

// Carregador de fatos do tick da Comunicacao (docs/23 §4.3 e §7): as duas fases do job "comunicacao" (a v1,
// envios e pop-ups, e os fluxos) dividem uma leitura so dos alunos por minuto, e so se alguma delas pedir.
//
// Por chave: load(ids) devolve os fatos de todos os alunos (fora a equipe) com as linhas do sino dos avisos
// citados por regras "o que fez com a notificacao X" (collectMessageCampaignIds de cada segmento). Os fatos
// base sao lidos no maximo uma vez por tick; as linhas de cada aviso, no maximo uma vez por tick, na
// primeira vez que alguem pede aquele id, e juntadas aos mesmos fatos (context.messageKeys diz quais foram
// lidos: chave fora dele nunca combina). Sem regra de mensagem, load([]) nao le nada a mais.
//
// Toda promessa ja nasce com um catch: uma falha de leitura nunca vira rejeicao solta quando ninguem a
// espera (o par loaded/guarded que ficava dentro de processCommunications). Quem espera recebe o erro.

import { attachMessageFacts, loadAudienceFacts, loadMessageFacts, type LoadedAudience, type MessageFactsByUser } from "./audience-facts";
import { messageRefKey } from "./audience-model";
import type { CommunicationsDb } from "./db";

export type FactsLoader = {
  /** Fatos de todos os alunos com as linhas destes avisos (ids de collectMessageCampaignIds). */
  load(messageCampaignIds: readonly string[]): Promise<LoadedAudience>;
};

function guarded<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Um carregador por tick (ou por chamada de processCommunications sem o do job). */
export function createFactsLoader(db: CommunicationsDb, now: Date | number): FactsLoader {
  let base: Promise<LoadedAudience> | null = null;
  // Aviso -> leitura que trouxe as linhas dele (avisos pedidos juntos dividem a mesma leitura).
  const rows = new Map<string, Promise<MessageFactsByUser>>();

  return {
    load(messageCampaignIds) {
      const ids = Array.from(new Set(messageCampaignIds.filter((id) => typeof id === "string" && id.length > 0))).sort();
      const facts = (base ??= guarded(loadAudienceFacts(db, now)));
      const missing = ids.filter((id) => !rows.has(id));

      if (missing.length > 0) {
        const read = guarded(loadMessageFacts(db, missing));

        for (const id of missing) {
          rows.set(id, read);
        }
      }

      if (ids.length === 0) {
        return facts;
      }

      return guarded(
        (async () => {
          const loaded = await facts;
          const merged: MessageFactsByUser = new Map();

          for (const id of ids) {
            const key = messageRefKey({ campaignId: id, kind: "campaign" });

            for (const [userId, byKey] of await (rows.get(id) as Promise<MessageFactsByUser>)) {
              const fact = byKey[key];

              if (fact) {
                merged.set(userId, { ...merged.get(userId), [key]: fact });
              }
            }
          }

          return attachMessageFacts(loaded, ids, merged);
        })()
      );
    }
  };
}
