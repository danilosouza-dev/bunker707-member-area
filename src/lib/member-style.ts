import type { CSSProperties } from "react";

// Estilo da area do aluno escolhido pelo produtor em Area de membros > Marca (13/10/2026): cantos das
// capas, formato dos botoes e posicao do menu. Modulo puro (sem React e sem servidor): vale no
// navegador (editor da Marca, AppShell) e no servidor (leitura e gravacao em platform_settings).
//
// Os cantos entram como variaveis CSS no raiz da area do aluno (memberStyleCssVars); os componentes
// usam `rounded-[var(--member-cover-radius)]` etc. e os padroes ficam em globals.css (`:root`), para a
// previa do admin e qualquer tela fora do AppShell desenharem o visual discreto.

export type MemberCornerStyle = "soft" | "rounded";
export type MemberButtonStyle = "soft" | "pill";
export type MemberMenuPlacement = "sidebar" | "header";

export type MemberStyleConfig = {
  buttons: MemberButtonStyle;
  corners: MemberCornerStyle;
  menu: MemberMenuPlacement;
};

export const MEMBER_STYLE_DEFAULTS: MemberStyleConfig = { buttons: "soft", corners: "soft", menu: "sidebar" };

export const MEMBER_CORNER_OPTIONS: ReadonlyArray<{ description: string; label: string; value: MemberCornerStyle }> = [
  { description: "Capas e destaque com cantos discretos, de ponta a ponta.", label: "Discretos", value: "soft" },
  { description: "Capas bem arredondadas e destaque com margem e cantos redondos, como Netflix e YouTube.", label: "Arredondados", value: "rounded" }
];

export const MEMBER_BUTTON_OPTIONS: ReadonlyArray<{ description: string; label: string; value: MemberButtonStyle }> = [
  { description: "Botões com cantos discretos.", label: "Discretos", value: "soft" },
  { description: "Botões em formato de pílula.", label: "Pílula", value: "pill" }
];

export const MEMBER_MENU_OPTIONS: ReadonlyArray<{ description: string; label: string; value: MemberMenuPlacement }> = [
  { description: "Trilho de ícones fixo à esquerda; o menu completo abre por cima da página.", label: "Barra lateral", value: "sidebar" },
  { description: "Hambúrguer e logo no cabeçalho, sem trilho; o menu completo abre por cima da página.", label: "No cabeçalho", value: "header" }
];

function pick<Value extends string>(value: unknown, allowed: readonly Value[], fallback: Value): Value {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as Value) : fallback;
}

/** Le o `style` gravado na marca (platform_settings.branding). Ausente ou invalido = padrao discreto. */
export function normalizeMemberStyle(value: unknown): MemberStyleConfig {
  const style = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).style : undefined;
  const record = style && typeof style === "object" && !Array.isArray(style) ? (style as Record<string, unknown>) : {};

  return {
    buttons: pick(record.buttons, ["soft", "pill"], MEMBER_STYLE_DEFAULTS.buttons),
    corners: pick(record.corners, ["soft", "rounded"], MEMBER_STYLE_DEFAULTS.corners),
    menu: pick(record.menu, ["sidebar", "header"], MEMBER_STYLE_DEFAULTS.menu)
  };
}

export function isSameMemberStyle(a: MemberStyleConfig, b: MemberStyleConfig) {
  return a.buttons === b.buttons && a.corners === b.corners && a.menu === b.menu;
}

/** Variaveis CSS do raiz da area do aluno. Os valores "soft" repetem os padroes de globals.css. */
export function memberStyleCssVars(style: MemberStyleConfig): CSSProperties {
  const rounded = style.corners === "rounded";

  return {
    "--member-button-radius": style.buttons === "pill" ? "9999px" : "8px",
    "--member-cover-radius": rounded ? "16px" : "10px",
    // Arredondado: capa limpa ate a borda (sem o esfumacado inferior), menos espaco embaixo e a primeira
    // fileira comeca abaixo do destaque em vez de sobrepor.
    "--member-hero-content-pb": rounded ? "5rem" : "12rem",
    "--member-hero-fade": rounded ? "0" : "1",
    "--member-hero-inset": rounded ? "clamp(12px, 3vw, 40px)" : "0px",
    "--member-hero-overlap": rounded ? "2rem" : "-6rem",
    "--member-hero-radius": rounded ? "20px" : "0px",
    "--member-hero-top": rounded ? "76px" : "0px"
  } as CSSProperties;
}
