"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// O seletor em pilula da sala e do console (docs/31 §10, ajustes do produtor de 10/11/2026): a pilula tonal (32 px no
// S, 40 px no M) com o rotulo (na tela, antes do valor, ou so para o leitor de tela), o valor em peso 500 e a seta. E
// um <select> nativo por baixo (o teclado, o leitor de tela e a lista do celular sao os do navegador), sem a aparencia
// dele. O foco: o anel contorna a pilula inteira e so aparece pelo teclado; no clique nao ha contorno nenhum. Antes o
// <select> mostrava o contorno branco retangular so no pedaco dele, dentro da pilula, que parecia o foco padrao do
// navegador. Por isso o <select> nao tem contorno proprio (no console, a raiz com data-field-focus="own" tira o anel
// do admin, globals.css) e a pilula sabe se o foco veio do clique (o navegador pode dizer :focus-visible num <select>
// clicado): a marca liga no mousedown, que so vem num clique ou toque de verdade, logo antes do foco; o pointerdown
// tambem vem sem foco nenhum (arrastar a faixa no toque, o clique na pilula desligada) e apagaria o anel do proximo Tab.
// Com o rotulo so para o leitor de tela, o <select> e a pilula inteira (o clique em qualquer ponto abre a lista), e o
// `leading` fica por cima dele sem pegar o clique. Usado pelo "Idioma do chat" da sala, pelo "Quem escreve" e "Modo
// lento" do console e pelo seletor de sessoes do topo do console. So tokens --room-*; nenhuma frase escrita aqui.

export type RoomSelectPillOption<T extends string> = {
  label: string;
  /** O idioma do rotulo, quando nao e o da pagina (o leitor de tela le "English" em ingles). */
  lang?: string;
  value: T;
};

export type RoomSelectPillProps<T extends string> = {
  className?: string;
  disabled?: boolean;
  id: string;
  label: string;
  /** O rotulo so para o leitor de tela (o texto ao lado ja diz o que e). */
  labelHidden?: boolean;
  /**
   * O que vem antes do valor, dentro da pilula (o ponto verde da sessao no ar); decorativo, uma marca de ate 8 px. Com o
   * rotulo escondido ela fica por cima do <select>, sem pegar o clique, e o <select> abre o lugar dela no recuo.
   */
  leading?: ReactNode;
  onChange: (value: T) => void;
  /** As classes de cada <option> (o fundo da lista no tema da sala). */
  optionClassName?: string;
  options: readonly RoomSelectPillOption<T>[];
  /** Atributos data-* do <select> (os testes e os e2e o acham por eles). */
  selectData?: Readonly<Record<`data-${string}`, string>>;
  /** "s": 32 px, 12/18 (os filtros do painel); "m": 40 px, 14/20 (o topo do console). */
  size?: "m" | "s";
  value: T;
};

const PILL = "relative inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-room-control transition-colors hover:bg-room-control-hover has-[select:disabled]:hover:bg-room-control motion-reduce:transition-none";
/** O anel de foco na pilula inteira, so quando o foco veio do teclado. */
const RING = "has-[select:focus-visible]:outline has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-room-focus";
const SELECT = "h-full min-w-0 cursor-pointer appearance-none truncate bg-transparent font-medium text-room-fg outline-none disabled:cursor-default disabled:text-room-fg-disabled";
const SIZES = {
  m: { chevron: "right-3 size-5", lead: "left-4", leadInset: "pl-7", pill: "h-10 text-sm leading-5", select: "pr-10" },
  s: { chevron: "right-2.5 size-4", lead: "left-3", leadInset: "pl-6", pill: "h-8 text-xs leading-[18px]", select: "pr-8" }
} as const;

export function RoomSelectPill<T extends string>({
  className,
  disabled = false,
  id,
  label,
  labelHidden = false,
  leading = null,
  onChange,
  optionClassName,
  options,
  selectData,
  size = "s",
  value
}: RoomSelectPillProps<T>) {
  // O foco que veio do clique nao mostra anel (o clique ja diz onde a pessoa esta); o do teclado mostra. A marca liga no
  // mousedown (nunca no pointerdown, que tambem vem sem foco: arrastar no toque, a pilula desligada).
  const [pointer, setPointer] = useState(false);
  const sizing = SIZES[size];
  const inset = size === "m" ? "pl-4" : "pl-3";

  return (
    <div className={cn(PILL, sizing.pill, pointer ? null : RING, labelHidden ? null : inset, className)}>
      {leading && labelHidden ? <span className={cn("pointer-events-none absolute top-1/2 flex -translate-y-1/2", sizing.lead)}>{leading}</span> : leading}
      <label className={labelHidden ? "sr-only" : "shrink-0 text-room-fg-subtle"} htmlFor={id}>
        {label}
      </label>
      <select
        className={cn(SELECT, sizing.select, labelHidden ? cn("rounded-full", leading ? sizing.leadInset : inset) : "rounded-r-full")}
        data-own-focus=""
        disabled={disabled}
        id={id}
        onBlur={() => setPointer(false)}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) {
            onChange(next.value);
          }
        }}
        onKeyDown={() => setPointer(false)}
        onMouseDown={() => setPointer(true)}
        value={value}
        {...selectData}
      >
        {options.map((option) => (
          <option className={optionClassName} key={option.value} lang={option.lang} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-room-icon", sizing.chevron)} strokeWidth={size === "m" ? 1.75 : 2} />
    </div>
  );
}
