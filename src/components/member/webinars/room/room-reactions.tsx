"use client";

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ReactionBubble } from "@/lib/webinar-room-client";
import { REACTIONS, type Reaction } from "@/server/webinars/model";

// A barra de reacoes do aluno (docs/30 §1.3 e §9): as seis reacoes de webinar_reactions, botoes de 44 px, uma por
// segundo; as reacoes sobem flutuando pelo canto do palco por 3 s, sem som; com prefers-reduced-motion ficam
// paradas 1,5 s e somem (motion-reduce). Nenhuma reacao e anunciada ao leitor de tela. Redesign V2, F2 (docs/31
// V2-11): a barra usa os tokens do tema da sala; as bolhas ficam sobre o video e sao iguais nos dois temas. F3 (V2-4):
// no palco, as bolhas sobem acima dos selos de baixo. F4 (V2-6): no desenho normal as seis reacoes abrem pelo Reagir da
// barra (por cima do palco no computador, acima da barra no celular), nas duas salas; o vertical continua com a dele.

export const REACTION_GLYPHS: Record<Reaction, string> = { clap: "👏", fire: "🔥", laugh: "😂", like: "👍", love: "❤️", wow: "😮" };

export function RoomReactionBar({ disabled, onReact }: { disabled: boolean; onReact: (reaction: Reaction) => void }) {
  const copy = WEBINAR_COPY.sala;

  return (
    <div aria-label={copy.reagir} className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group">
      {REACTIONS.map((reaction) => (
        <button
          aria-label={copy.reacoes[reaction]}
          className="grid size-11 shrink-0 place-items-center rounded-full text-xl transition-transform hover:bg-room-control-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus active:scale-110 disabled:opacity-40 motion-reduce:transition-none"
          disabled={disabled}
          key={reaction}
          onClick={() => onReact(reaction)}
          title={copy.reacoes[reaction]}
          type="button"
        >
          <span aria-hidden="true">{REACTION_GLYPHS[reaction]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * As bolhas no canto do palco: sobem 3 s (motion-safe) ou ficam paradas (motion-reduce); o excesso vira um contador
 * discreto. No palco (`stage`, o padrao) elas nascem acima da linha dos selos de baixo (docs/31 V2-4), com a coluna
 * nunca mais alta que o palco acima dessa linha (a 375 px o palco 16:9 tem cerca de 211 px: os 160 px da coluna a 56
 * px da base passariam do topo dele e pintariam por cima do cabecalho); no vertical, o lugar delas ja fica acima do
 * chat e continua como era.
 */
export function RoomReactionBubbles({ bubbles, layout = "stage", overflow }: { bubbles: readonly ReactionBubble[]; layout?: "stage" | "vertical"; overflow: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute right-3 flex h-40 w-16 flex-col-reverse items-center overflow-hidden", layout === "vertical" ? "bottom-3" : "bottom-14 max-h-[calc(100%-3.5rem)]")}
      data-testid="room-reactions"
    >
      {bubbles.map((bubble, index) => (
        <span
          className={cn("absolute bottom-0 text-2xl motion-safe:animate-[room-reaction_3s_ease-out_forwards] motion-reduce:opacity-80")}
          key={bubble.id}
          style={{ left: `${(index % 3) * 14 + 8}px` }}
        >
          {REACTION_GLYPHS[bubble.reaction]}
        </span>
      ))}
      {overflow > 0 ? <span className="absolute right-0 top-0 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">+{overflow}</span> : null}
      <style>{`@keyframes room-reaction { 0% { transform: translateY(0) scale(0.9); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-140px) scale(1.15); opacity: 0; } }`}</style>
    </div>
  );
}
