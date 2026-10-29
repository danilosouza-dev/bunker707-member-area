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
// Webinarios v4b (docs/30 §1.6): a mesma lista traz "webinar:<id>" das regras "webinar_follow_up" (o "Webinário" da
// fase 4). Cada webinario e lido (loadWebinarFollowUpFacts, a RPC webinar_follow_up_facts) no maximo uma vez por tick,
// como as linhas de um aviso, e juntado em facts.webinarFollowUps; "webinar:<id>" so entra em context.messageKeys
// quando o webinario foi lido. Assim o recalculo do segmento dos pop-ups nas faixas de 15 min (docs/29) ve as compras
// ligadas pelo job da conversao. As duas leituras de lives convivem ate a unificacao das regras.
//
// Toda promessa ja nasce com um catch: uma falha de leitura nunca vira rejeicao solta quando ninguem a
// espera (o par loaded/guarded que ficava dentro de processCommunications). Quem espera recebe o erro.

import { loadWebinarFollowUpFacts, type WebinarFollowUpRead } from "@/server/webinars/follow-up-queries";
import {
  attachMessageFacts,
  attachWebinarFacts,
  attachWebinarFollowUpFacts,
  loadAudienceFacts,
  loadMessageFacts,
  loadWebinarFacts,
  webinarIdsOfKeys,
  type LoadedAudience,
  type MessageFactsByUser,
  type WebinarFactsByUser
} from "./audience-facts";
import { messageRefKey, type WebinarFollowUpFact } from "./audience-model";
import type { CommunicationsDb } from "./db";

export type FactsLoader = {
  /**
   * Fatos de todos os alunos com as linhas destes avisos e os fatos destes webinarios (chaves de
   * collectMessageCampaignIds) e, com `webinars`, as lives de cada aluno (audienceFactNeeds(...).webinars).
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
  // v4b: webinario -> leitura que trouxe os fatos dele (webinarios pedidos juntos dividem a mesma leitura).
  const webinarReads = new Map<string, Promise<WebinarFollowUpRead>>();

  return {
    load(messageCampaignIds, options = {}) {
      const keys = messageCampaignIds.filter((id) => typeof id === "string" && id.length > 0);
      const webinarIds = webinarIdsOfKeys(keys);
      const ids = Array.from(new Set(keys.filter((id) => !id.startsWith("webinar:")))).sort();
      const facts = (base ??= guarded(loadAudienceFacts(db, now)));
      const missing = ids.filter((id) => !rows.has(id));
      const webinarRows = options.webinars ? (webinars ??= guarded(loadWebinarFacts(db))) : null;
      const missingWebinars = webinarIds.filter((id) => !webinarReads.has(id));

      if (missing.length > 0) {
        const read = guarded(loadMessageFacts(db, missing));

        for (const id of missing) {
          rows.set(id, read);
        }
      }

      if (missingWebinars.length > 0) {
        const read = guarded(loadWebinarFollowUpFacts(db, missingWebinars));

        for (const id of missingWebinars) {
          webinarReads.set(id, read);
        }
      }

      if (ids.length === 0 && webinarIds.length === 0 && !webinarRows) {
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
          const withWebinars = webinarRows ? attachWebinarFacts(withMessages, await webinarRows) : withMessages;

          if (webinarIds.length === 0) {
            return withWebinars;
          }

          const followUps: WebinarFollowUpRead = { byUser: new Map(), loadedIds: [] };

          for (const id of webinarIds) {
            const read = await (webinarReads.get(id) as Promise<WebinarFollowUpRead>);

            if (!read.loadedIds.includes(id)) {
              continue;
            }

            followUps.loadedIds.push(id);

            for (const [userId, byWebinar] of read.byUser) {
              const fact: WebinarFollowUpFact | undefined = byWebinar[id];

              if (fact) {
                followUps.byUser.set(userId, { ...followUps.byUser.get(userId), [id]: fact });
              }
            }
          }

          return attachWebinarFollowUpFacts(withWebinars, followUps);
        })()
      );
    }
  };
}
