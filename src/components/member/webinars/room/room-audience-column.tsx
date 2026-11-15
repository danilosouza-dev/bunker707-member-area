"use client";

// A coluna de miniaturas da Live gravada (docs/30 D124; docs/31 §20; pedido do produtor de 13/11/2026). Na Live ao
// vivo quem desenha as miniaturas e o proprio motor de video (D120); na gravada nao ha motor, e o video foi gravado
// sem miniaturas, entao a propria pagina desenha a coluna, ao lado do video, no mesmo desenho da coluna do motor: a
// miniatura do proprio aluno primeiro (a foto do Perfil ou as iniciais, e o nome), depois os participantes simulados
// daquele segundo, os com foto antes dos sem foto (a lista vem pronta de audience-tiles-model.ts). Quem apresenta nao
// entra: a camera dele esta dentro do video. Todo mundo aparece como quem esta com a camera e o microfone desligados.
//
// So no computador (1024 px ou mais) e no desenho normal, como as miniaturas da live (no celular a sala nao mostra
// miniaturas). A coluna tem a largura da do motor (FILMSTRIP_COLUMN_WIDTH) e rola sozinha; as fotos de quem esta
// fora da vista so carregam quando entram nela (o carregamento preguicoso do next/image). Nada aqui grava nada.

import { MicOff } from "lucide-react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { FILMSTRIP_COLUMN_WIDTH, type AudienceTilePerson } from "@/lib/jitsi-room-config";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

const COPY = WEBINAR_COPY.simulacao.coluna;

/**
 * A coluna esta pronta e desligada (docs/30 D124 e A63): ela liga junto com a Live gravada de um video so, quando a
 * gravacao ja sai sem as miniaturas dentro do video (o Gravar para Live gravada, ou o video pronto enviado pela equipe).
 * Ligada antes, uma gravacao com as miniaturas no video mostraria duas plateias.
 */
export const RECORDED_AUDIENCE_COLUMN = false;

export type RoomAudienceSelf = {
  /** O nome do aluno na sala (o primeiro nome e a inicial do sobrenome, D64); nulo, "Você". */
  name: string | null;
  /** A foto do Perfil (D115); nula, as iniciais. */
  photoUrl: string | null;
};

function AudienceTile({ mine = false, person }: { mine?: boolean; person: { name: string; photoUrl: string | null } }) {
  // Sem nome na conta, a miniatura do aluno diz "Você" e o leitor de tela nao repete.
  const named = !(mine && person.name === COPY.semNome);
  return (
    <li
      className="relative grid h-[120px] shrink-0 place-items-center overflow-hidden rounded-lg bg-[#262626] ring-1 ring-white/5"
      data-room-audience-tile={mine ? "self" : "simulated"}
    >
      <MemberAvatar className="size-16 ring-0" imageSrc={person.photoUrl} name={person.name} size="xl" />
      <span className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
        <MicOff aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{person.name}</span>
        {mine && named ? <span className="sr-only">{` ${COPY.voce}`}</span> : null}
      </span>
    </li>
  );
}

/**
 * A coluna, presa a direita da caixa do palco (o video desconta a largura dela pela variavel --room-video-right).
 * `people` ja vem cortado pelo numero de participantes simulados daquele segundo (audienceTilesNow).
 */
export function RoomAudienceColumn({ people, self }: { people: readonly AudienceTilePerson[]; self: RoomAudienceSelf }) {
  return (
    <ul
      aria-label={COPY.rotulo}
      className="absolute bottom-0 right-0 top-0 z-10 flex flex-col gap-1.5 overflow-y-auto overscroll-contain bg-black p-1.5 [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]"
      data-room-slot="audience-column"
      style={{ width: FILMSTRIP_COLUMN_WIDTH }}
    >
      <AudienceTile mine person={{ name: self.name?.trim() || COPY.semNome, photoUrl: self.photoUrl }} />
      {people.map((person) => (
        <AudienceTile key={person.id} person={person} />
      ))}
    </ul>
  );
}
