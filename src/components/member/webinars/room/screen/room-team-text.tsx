import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { linkSegments } from "@/lib/webinar-links";
import { commentSegments } from "@/lib/webinar-room-client";
import type { StudentChatMessage } from "@/server/webinars/model";
import { ROOM_FOCUS } from "../room-ui";

// O texto de uma mensagem do chat da sala com os links da equipe (docs/30 §8.3; especificacao "Na tela", §2 R1.4 e
// §8.1): um endereco `https://` numa mensagem escrita pela equipe vira link, fixada ou nao. Quem decide e o servidor
// (`links`, room-model.messageHasLinks: papel Apresentador, Co-apresentador ou Equipe vindo do console ou do roteiro);
// aqui o papel e conferido de novo (defesa a mais: mensagem de aluno, personagem de aluno do roteiro e o Assistente
// nunca viram link, mesmo com um `links` errado). Os pedacos saem de linkSegments (src/lib/webinar-links.ts): ate 5
// links, a pontuacao do fim de fora, so o que passa em safeHttpsUrl, e o texto visivel e o proprio endereco (nao da
// para disfarcar um link). Todo link abre em outra aba (target _blank, rel "noopener noreferrer nofollow") com o anel
// de foco da sala e a cor --room-link (o vertical e sempre escuro, entao vale tambem por cima do video). Sem link, o
// HTML e o texto puro de antes: as linhas do chat, a fixada, o balao da gaveta do vertical e a linha da fixada do
// vertical usam esta peca sem mudar nada para a mensagem de aluno. `mentions` (o comentario do YouTube) poe o
// "@assistente" em peso 600, como o chat ja fazia. Sem frase escrita aqui; so tokens --room-*.

/** Os papeis da equipe: so eles podem ter link (o Assistente e o aluno, nunca). */
const TEAM_LINK_ROLES: ReadonlySet<StudentChatMessage["role"]> = new Set(["co_host", "host", "team"]);

/** A mensagem tem os links ligados: o servidor disse que sim e o papel e da equipe. */
export function teamLinksOn(message: Pick<StudentChatMessage, "links" | "role">): boolean {
  return message.links === true && TEAM_LINK_ROLES.has(message.role);
}

/** As classes do link da equipe no chat e nas fixadas (o anel de foco da sala; o endereco longo quebra em qualquer lugar). */
export const ROOM_TEAM_LINK = cn("rounded-[2px] text-room-link underline decoration-1 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-2", ROOM_FOCUS);

/** Um pedaco de texto, com o "@assistente" em peso 600 quando `mentions`. */
function TextPart({ mentions, text }: { mentions: boolean; text: string }) {
  if (!mentions) {
    return <>{text}</>;
  }
  return (
    <>
      {commentSegments(text).map((segment, index) =>
        segment.mention ? (
          <span className="font-semibold" key={index}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  );
}

export type RoomTeamTextProps = {
  /** O "@assistente" em peso 600 (o comentario do YouTube); o balao e as linhas por cima do video, nao. */
  mentions?: boolean;
  message: Pick<StudentChatMessage, "body" | "role"> & { links?: boolean };
};

/** O texto da mensagem: com os links da equipe quando ela pode ter (teamLinksOn), senao o texto como veio. */
export function RoomTeamText({ mentions = false, message }: RoomTeamTextProps) {
  const links = teamLinksOn({ links: message.links ?? false, role: message.role });
  const segments = linkSegments(message.body, { links });
  if (segments.length <= 1 && segments[0]?.kind !== "link") {
    return <TextPart mentions={mentions} text={message.body} />;
  }
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "link" ? (
          <a className={ROOM_TEAM_LINK} data-room-team-link="" href={segment.href} key={index} rel="noopener noreferrer nofollow" target="_blank">
            {segment.text}
          </a>
        ) : (
          <TextPart key={index} mentions={mentions} text={segment.text} />
        )
      )}
    </>
  );
}
