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
// Quem pode da live por regras (docs/30 §1.6): load(ids, { webinars: true }) junta as lives de cada aluno (RPC
// communication_webinar_facts), lidas no maximo uma vez por tick e so se algum segmento tem a regra
// "Participação em lives" (audienceFactNeeds(...).webinars).
//
// Toda promessa ja nasce com um catch: uma falha de leitura nunca vira rejeicao solta quando ninguem a
// espera (o par loaded/guarded que ficava dentro de processCommunications). Quem espera recebe o erro.

import {
  attachMessageFacts,
  attachWebinarFacts,
  loadAudienceFacts,
  loadMessageFacts,
  loadWebinarFacts,
  type LoadedAudience,
  type MessageFactsByUser,
  type WebinarFactsByUser
} from "./audience-facts";
import { messageRefKey } from "./audience-model";
import type { CommunicationsDb } from "./db";

export type FactsLoader = {
  /**
   * Fatos de todos os alunos com as linhas destes avisos (ids de collectMessageCampaignIds) e, com `webinars`, as
   * lives de cada aluno (audienceFactNeeds(...).webinars).
   */
  load(messageCampaignIds: readonly string[], options?: { webinars?: boolean }): Promise<LoadedAudience>;
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
  // Lives de cada aluno: uma leitura por tick, na primeira vez que um segmento pede.
  let webinars: Promise<WebinarFactsByUser | null> | null = null;

  return {
    load(messageCampaignIds, options = {}) {
      const ids = Array.from(new Set(messageCampaignIds.filter((id) => typeof id === "string" && id.length > 0))).sort();
      const facts = (base ??= guarded(loadAudienceFacts(db, now)));
      const missing = ids.filter((id) => !rows.has(id));
      const webinarRows = options.webinars ? (webinars ??= guarded(loadWebinarFacts(db))) : null;

      if (missing.length > 0) {
        const read = guarded(loadMessageFacts(db, missing));

        for (const id of missing) {
          rows.set(id, read);
        }
      }

      if (ids.length === 0 && !webinarRows) {
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

          const withMessages = ids.length === 0 ? loaded : attachMessageFacts(loaded, ids, merged);

          return webinarRows ? attachWebinarFacts(withMessages, await webinarRows) : withMessages;
        })()
      );
    }
  };
}
