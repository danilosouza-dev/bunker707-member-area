import "server-only";

// Quem esta no segmento agora: avalia as regras sobre os fatos ja lidos (audience-facts.ts). A equipe
// nunca aparece aqui porque os fatos nao a incluem.

import { evaluateAudience, type AudienceDefinition } from "./audience-model";
import type { LoadedAudience } from "./audience-facts";

export const AUDIENCE_SAMPLE_SIZE = 5;

export type AudienceSamplePerson = { avatarUrl: string | null; id: string; name: string };

/** Ids dos alunos no segmento, em ordem estavel. */
export function resolveAudienceUserIds(definition: AudienceDefinition, loaded: LoadedAudience): string[] {
  return loaded.facts
    .filter((facts) => evaluateAudience(definition, facts, loaded.context))
    .map((facts) => facts.userId)
    .sort();
}

/** Contagem ao vivo do editor: quantos alunos e 5 nomes de amostra (ordem alfabetica). */
export function previewAudience(definition: AudienceDefinition, loaded: LoadedAudience): { count: number; sample: AudienceSamplePerson[] } {
  const ids = resolveAudienceUserIds(definition, loaded);
  const sample = ids
    .map((id) => ({ avatarUrl: loaded.people.get(id)?.avatarUrl ?? null, id, name: loaded.people.get(id)?.name ?? "Sem nome" }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || (left.id < right.id ? -1 : 1))
    .slice(0, AUDIENCE_SAMPLE_SIZE);

  return { count: ids.length, sample };
}
