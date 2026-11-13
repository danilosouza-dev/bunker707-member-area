// Os participantes simulados nas miniaturas da live, a parte pura (docs/30 D120; pedido do produtor de 13/11/2026):
// a lista ordenada de quem aparece (as pessoas que comentam, do card Roteiro, com a foto; depois as sem foto; depois
// nomes genericos ate o teto), quantas aparecem em cada instante (o numero de participantes simulados daquele
// segundo, que a sala ja calcula para o selo dos presentes) e a mensagem que a pagina manda ao iframe. Quem desenha e
// o proprio motor de video (infra/jitsi/web/bunker707-plateia.js): nenhuma conexao nasce por causa de um simulado.
//
// A ordem na tela (o arquivo da instancia aplica): quem modera, os alunos de verdade, os simulados com foto, os sem
// foto. Aqui a lista ja sai nessa ordem entre os simulados, e a contagem corta pelo fim: com menos simulados que
// pessoas criadas, ficam as primeiras (as com foto). Os nomes genericos saem de WEBINAR_COPY.simulacao (primeiro nome
// + inicial, como todo aluno na sala, D64), embaralhados pela semente da sessao (sem sorteio do navegador: todos veem as
// mesmas pessoas), com os nomes das entradas ("Ana M. entrou") na frente e sem repetir o nome de quem comenta.
//
// Sem React, sem "server-only" e com imports relativos: tests/webinarios-miniaturas-simuladas.test.mjs carrega direto.

import { AUDIENCE_TILES_MAX, isSimulatedParticipantId, type AudienceTilePerson } from "../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import type { SessionSimulation } from "./model";
import { personaAvatarUrl, personaNameKey, sortPersonas, type WebinarPersona } from "./persona-model";
import { seededUnit } from "./simulation-model";

const COPY = WEBINAR_COPY.simulacao;

/** A corrente da semente das miniaturas (as do contador e das entradas vao de 1 a 8, simulation-model.STREAM). */
const TILES_STREAM = 21;

/** De quanto em quanto a pagina manda a lista de novo ao iframe (o mesmo conteudo nao muda nada no motor). */
export const AUDIENCE_RESEND_MS = 30_000;

/** O que GET /api/webinars/[id]/audience devolve: a lista inteira na ordem, ou desligado com a lista vazia. */
export type AudienceTilesFeed = { enabled: boolean; people: AudienceTilePerson[] };

export const NO_AUDIENCE_TILES: AudienceTilesFeed = { enabled: false, people: [] };

/** Os nomes genericos possiveis, na ordem fixa (primeiro nome x inicial): o indice de cada um vira o id. */
export function genericTileNames(): string[] {
  const names: string[] = [];
  for (const first of COPY.primeirosNomes) {
    for (const initial of COPY.iniciais) {
      names.push(`${first} ${initial}.`);
    }
  }
  return names;
}

/** O id do simulado de uma pessoa que comenta: "simp" + o comeco do id dela (so 0-9a-f). */
function personaTileId(personaId: string, taken: ReadonlySet<string>): string | null {
  const hex = personaId.toLowerCase().replace(/[^0-9a-f]/g, "");
  for (let start = 0; start + 4 <= Math.max(hex.length, 4); start += 4) {
    const id = `simp${hex.slice(start, start + 16)}`;
    if (isSimulatedParticipantId(id) && !taken.has(id)) {
      return id;
    }
  }
  return null;
}

/**
 * A lista ordenada dos simulados de uma sessao: as pessoas que comentam com foto (por nome), as sem foto (por nome) e
 * os nomes genericos, ate `max`. A lista de pessoas e a da escola (docs/30 D117): em cada grupo, as que comentam no
 * roteiro deste webinario (`scriptPersonaIds`) vem antes das outras, para a miniatura acompanhar quem a turma ve
 * comentar quando ha mais pessoas na lista do que participantes simulados. A mesma entrada da sempre a mesma lista.
 */
export function audienceTilesRoster(input: {
  max?: number;
  /** A origem conferida do nosso Supabase (a foto so sai do nosso bucket); nula, todo mundo com as iniciais. */
  origin: string | null;
  personas: readonly Pick<WebinarPersona, "avatarPath" | "id" | "name">[];
  /** As pessoas ligadas a algum item do roteiro deste webinario; sem ele, a lista inteira so por nome. */
  scriptPersonaIds?: ReadonlySet<string>;
  seed: number;
}): AudienceTilePerson[] {
  const max = Math.max(0, Math.min(AUDIENCE_TILES_MAX, Math.trunc(input.max ?? AUDIENCE_TILES_MAX)));
  const people: AudienceTilePerson[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  const created = sortPersonas(input.personas).map((persona) => ({ persona, photoUrl: personaAvatarUrl(persona.avatarPath, input.origin) }));
  const inScript = (item: (typeof created)[number]) => input.scriptPersonaIds?.has(item.persona.id) === true;
  const withPhoto = created.filter((item) => item.photoUrl);
  const plain = created.filter((item) => !item.photoUrl);
  for (const group of [withPhoto.filter(inScript), withPhoto.filter((item) => !inScript(item)), plain.filter(inScript), plain.filter((item) => !inScript(item))]) {
    for (const { persona, photoUrl } of group) {
      const name = persona.name.replace(/\s+/g, " ").trim();
      const key = personaNameKey(name);
      const id = personaTileId(persona.id, ids);
      if (people.length >= max || !id || !key || names.has(key)) {
        continue;
      }
      ids.add(id);
      names.add(key);
      people.push({ id, name: name.slice(0, 60), photoUrl });
    }
  }

  const pool = genericTileNames();
  const joinNames = new Set<string>(COPY.nomesGenericos);
  const order = pool
    .map((name, index) => ({ index, name, weight: seededUnit(input.seed, TILES_STREAM, index) + (joinNames.has(name) ? 0 : 1) }))
    .sort((a, b) => a.weight - b.weight || a.index - b.index);
  for (const item of order) {
    if (people.length >= max) {
      break;
    }
    const key = personaNameKey(item.name);
    if (names.has(key)) {
      continue;
    }
    names.add(key);
    people.push({ id: `simg${item.index.toString(36)}`, name: item.name, photoUrl: null });
  }
  return people;
}

/**
 * A Simulacao da sessao pode mostrar participantes simulados em algum momento: o contador ligado (numero fixo ou
 * faixa) ou uma mudanca no ar. Sem isso a lista nem e montada.
 */
export function audienceTilesPossible(simulation: Pick<SessionSimulation, "countChanges" | "countRule">): boolean {
  return simulation.countRule.mode !== "off" || (simulation.countChanges ?? []).some((change) => change.rule.mode !== "off");
}

/** Quem aparece agora: os primeiros `simulatedNow` da lista (o numero de simulados deste segundo), nunca alem dela. */
export function audienceTilesNow(roster: readonly AudienceTilePerson[], simulatedNow: number): AudienceTilePerson[] {
  const count = Number.isFinite(simulatedNow) ? Math.max(0, Math.min(roster.length, Math.trunc(simulatedNow))) : 0;
  return count === roster.length ? (roster as AudienceTilePerson[]) : roster.slice(0, count);
}

/** A assinatura da lista que foi ao iframe: muda quando alguem entra, sai, troca de nome ou de foto. */
export function audienceTilesKey(people: readonly AudienceTilePerson[]): string {
  return people.map((person) => `${person.id}\u0001${person.name}\u0001${person.photoUrl ?? ""}`).join("\u0002");
}
