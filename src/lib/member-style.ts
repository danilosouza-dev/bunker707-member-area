// Estilo da area do aluno escolhido pelo produtor em Area de membros > Marca (13/10/2026): cantos das
// capas, formato dos botoes e posicao do menu. Modulo puro (sem React e sem servidor): vale no
// navegador (editor da Marca, AppShell) e no servidor (leitura e gravacao em platform_settings).
//
// Cantos e botoes viram atributos no raiz da area do aluno (data-member-corners, data-member-buttons);
// globals.css define as variaveis CSS por atributo e os componentes usam `rounded-[var(--member-cover-radius)]`
// etc. Os padroes ficam em `:root`, entao a previa do admin e telas fora do AppShell desenham o discreto.

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
  { description: "Hambúrguer e logo no cabeçalho; o menu completo abre por cima da página, como no YouTube.", label: "Barra lateral", value: "sidebar" },
  { description: "Links escritos no cabeçalho, como na Netflix, sem barra lateral no computador; no celular o hambúrguer abre o menu.", label: "No cabeçalho", value: "header" }
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
