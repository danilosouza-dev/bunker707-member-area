// Classes compartilhadas do Admin Bunker707 (docs/17 §2.7).
//
// Onde os tokens valem: o bloco de src/app/globals.css usa o seletor
// `:root:has([data-scope="admin"]), [data-scope="admin"]`. Enquanto a moldura do admin
// (AdminShellV2 ou AdminShellSkeleton, que levam data-scope="admin") esta montada, os tokens
// valem no documento inteiro, inclusive nos popovers renderizados em portal (Tooltip, Sheet,
// DropdownMenu, Select). Nao repita data-scope="admin" nesses componentes.
//
// Botoes e foco tambem sao temados uma unica vez em globals.css, com o mesmo seletor:
// - todo `Button` de src/components/ui/button.tsx (data-slot="button") tem 40 px de altura,
//   40 px de largura minima e raio de 8 px. Nao repita h-10/rounded-lg; uma excecao de altura
//   precisa de utilitario importante (ex.: `h-8!`), porque a regra fica fora das camadas;
// - links, botoes, campos e gatilhos ganham contorno de 2 px em --focus-ring no foco por teclado.
//   Nao ha classe de foco por componente.

/** Card padrao: superficie 1, borda sutil, raio de 8 px. Nunca aninhar um card dentro de outro. */
export const adminCard = "rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)]";

/** Transicao padrao: 150 ms com a curva do admin, desligada em movimento reduzido. */
export const adminTransition = "transition-colors duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none";

/** Conteudo de skeleton aparece so depois de 300 ms, para nao piscar em respostas rapidas. */
export const adminDelayedReveal =
  "animate-in fade-in fill-mode-both delay-300 duration-150 motion-reduce:animate-none";

/*
 * Menus e listas suspensas do admin (prototipo aprovado, `.menu`): superficie 3, borda forte, raio 8,
 * 4 px por dentro; itens de 34 px com raio 6 e realce --press-overlay; rotulo 12/500; separador de 1 px.
 * Usados pelo Periodo e pelo Produto da barra superior, pelo menu Criar do Hoje e pela busca.
 */
export const adminMenuPopup =
  "min-w-[208px] max-w-[calc(100vw-32px)] origin-[var(--transform-origin)] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] outline-none transition-[opacity,transform] duration-100 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none";

export const adminMenuItem =
  "flex min-h-[34px] w-full cursor-default items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-sm leading-5 text-[var(--text-primary)] outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-[var(--text-tertiary)] data-highlighted:bg-[var(--press-overlay)]";

export const adminMenuLabel = "px-2.5 pt-1.5 pb-0.5 text-xs leading-4 font-medium text-[var(--text-tertiary)]";

export const adminMenuMeta = "ml-auto shrink-0 pl-3 text-xs leading-4 font-medium text-[var(--text-tertiary)] tabular-nums";

export const adminMenuSeparator = "my-1 h-px bg-[var(--border-subtle)]";

/**
 * Controle de 36 px da barra superior (Periodo, Produto): superficie 1, borda sutil, 13/500. Abaixo de
 * 768 px vira so o icone, num botao transparente de 36 px.
 */
export const adminTopbarControl =
  "relative inline-flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] leading-5 font-medium whitespace-nowrap text-[var(--text-primary)] outline-none transition-colors duration-100 ease-[var(--ease-admin)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] data-popup-open:border-[var(--border-strong)] data-popup-open:bg-[var(--surface-2)] motion-reduce:transition-none max-md:w-9 max-md:justify-center max-md:gap-0 max-md:border-transparent max-md:bg-transparent max-md:p-0 max-md:hover:border-transparent max-md:hover:bg-[var(--press-overlay)] max-md:data-popup-open:border-transparent max-md:data-popup-open:bg-[var(--press-overlay)]";
