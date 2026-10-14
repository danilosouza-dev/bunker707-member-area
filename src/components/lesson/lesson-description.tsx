"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Descricao da aula como no YouTube: fechada mostra tres linhas e um "Ver mais"; aberta mostra o texto
// inteiro e um "Ver menos". O botao so aparece quando o texto nao cabe nas tres linhas. Quebras de linha
// escritas pelo produtor sao respeitadas. Volta a fechar ao trocar de aula (o pai passa key={lesson.id}).

type LessonDescriptionProps = {
  className?: string;
  text: string;
};

export function LessonDescription({ className, text }: LessonDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const paragraphRef = useRef<HTMLParagraphElement>(null);

  // Mede so fechado (aberto, nada transborda): o texto cabe nas tres linhas?
  useLayoutEffect(() => {
    const paragraph = paragraphRef.current;

    if (expanded || !paragraph) {
      return;
    }

    function measure() {
      if (paragraph) {
        setOverflows(paragraph.scrollHeight > paragraph.clientHeight + 1);
      }
    }

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);

    return () => observer.disconnect();
  }, [expanded, text]);

  if (!text.trim()) {
    return null;
  }

  return (
    <div className={className}>
      <p
        className={cn("max-w-4xl whitespace-pre-line text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7", !expanded && "line-clamp-3")}
        ref={paragraphRef}
      >
        {text}
      </p>
      {overflows || expanded ? (
        <button
          aria-expanded={expanded}
          className="mt-2 rounded-[4px] text-sm font-bold text-white transition-colors hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-[15px]"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Ver menos" : "Ver mais"}
        </button>
      ) : null}
    </div>
  );
}
