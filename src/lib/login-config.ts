// Pagina de entrar (/login): os 4 modelos prontos e o formato que o componente LoginExperience
// desenha. Modulo puro (sem React, sem aliases): o /login, a previa do admin novo
// (src/components/admin/v2/member-area/login), o admin antigo e os testes carregam daqui.
//
// O que o produtor publica fica em platform_settings.loginPage (src/server/member-area/login-model.ts);
// getLoginPageConfig(template?) continua existindo para o admin antigo, que so faz previa.

export const LOGIN_TEMPLATE_IDS = [
  "split-visual-right",
  "split-visual-left",
  "center-glass",
  "side-glass-right"
] as const;

export type LoginTemplateId = (typeof LOGIN_TEMPLATE_IDS)[number];

export const LOGIN_PANEL_TONES = ["dark", "glass", "light"] as const;

export type LoginPanelTone = (typeof LOGIN_PANEL_TONES)[number];
export type LoginProvider = "google" | "apple";

export type LoginTemplateOption = {
  id: LoginTemplateId;
  name: string;
  description: string;
  supportedCustomizations: Array<
    | "background_image"
    | "side_image"
    | "logo"
    | "panel_tone"
    | "form_position"
    | "copy"
    | "providers"
  >;
};

export type LoginPageConfig = {
  template: LoginTemplateId;
  panelTone: LoginPanelTone;
  brandName: string;
  logo: {
    /** null = a Marca esta sem logo: o nome da escola aparece em texto. */
    src: string | null;
    alt: string;
  };
  visual: {
    imageSrc: string;
    alt: string;
    eyebrow: string;
    title: string;
    description: string;
    /** object-position da imagem lateral; a imagem padrao usa "72% center" (o rosto do astronauta). */
    objectPosition?: string;
  };
  form: {
    title: string;
    subtitle: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    forgotPasswordLabel: string;
    primaryCta: string;
    supportLabel: string;
    supportCta: string;
    /** Link da linha de ajuda (https:// ou mailto:). Sem link, a linha nao aparece. */
    supportHref?: string | null;
  };
  providers: LoginProvider[];
  footerLinks: Array<{
    label: string;
    href: string;
  }>;
};

/** Imagem que vem com o app e aparece enquanto o produtor nao envia outra. */
export const DEFAULT_LOGIN_VISUAL_IMAGE = "/login/bunker-astronaut-login.png";
export const DEFAULT_LOGIN_VISUAL_ALT = "Astronauta em ambiente escuro com circuitos de IA em vermelho";
/** Enquadramento da imagem padrao na lateral; imagem enviada ja vem recortada e fica centralizada. */
export const DEFAULT_LOGIN_VISUAL_POSITION = "72% center";

export const loginTemplateOptions: LoginTemplateOption[] = [
  {
    id: "split-visual-right",
    name: "Formulário à esquerda",
    description: "Formulário à esquerda e uma imagem grande à direita, com uma frase sua.",
    supportedCustomizations: [
      "side_image",
      "logo",
      "panel_tone",
      "form_position",
      "copy",
      "providers"
    ]
  },
  {
    id: "split-visual-left",
    name: "Imagem à esquerda",
    description: "Imagem grande à esquerda, com uma frase sua, e o formulário à direita.",
    supportedCustomizations: [
      "side_image",
      "logo",
      "panel_tone",
      "form_position",
      "copy",
      "providers"
    ]
  },
  {
    id: "center-glass",
    name: "Central sobre a imagem",
    description: "Uma imagem ocupa a tela toda e o formulário fica no centro, translúcido.",
    supportedCustomizations: [
      "background_image",
      "logo",
      "panel_tone",
      "copy",
      "providers"
    ]
  },
  {
    id: "side-glass-right",
    name: "Lateral sobre a imagem",
    description: "Uma imagem ocupa a tela toda e o formulário fica à direita, translúcido.",
    supportedCustomizations: [
      "background_image",
      "logo",
      "panel_tone",
      "form_position",
      "copy",
      "providers"
    ]
  }
];

const baseLoginPageConfig: LoginPageConfig = {
  template: "split-visual-right",
  panelTone: "dark",
  brandName: "Bunker707",
  logo: {
    src: "/brand/logo-bunker.svg",
    alt: "Bunker707"
  },
  visual: {
    imageSrc: DEFAULT_LOGIN_VISUAL_IMAGE,
    alt: DEFAULT_LOGIN_VISUAL_ALT,
    eyebrow: "",
    title: "Na superfície, todos seguem no automático. No Bunker, a IA vira método.",
    description: "",
    objectPosition: DEFAULT_LOGIN_VISUAL_POSITION
  },
  form: {
    title: "",
    subtitle: "",
    emailLabel: "E-mail",
    emailPlaceholder: "seuemail@exemplo.com",
    passwordLabel: "Senha",
    passwordPlaceholder: "Digite sua senha",
    forgotPasswordLabel: "Esqueci minha senha",
    primaryCta: "Entrar",
    supportLabel: "Ainda não tem acesso?",
    supportCta: "Fale com o suporte",
    supportHref: null
  },
  providers: ["google"],
  footerLinks: []
};

/** Modelos com imagem ao lado do formulario (os outros usam a imagem de fundo em tela cheia). */
export function isSplitLoginTemplate(template: LoginTemplateId) {
  return template === "split-visual-right" || template === "split-visual-left";
}

/** Tom de painel de cada modelo quando o produtor nao escolhe outro. */
export function defaultLoginPanelTone(template: LoginTemplateId): LoginPanelTone {
  return isSplitLoginTemplate(template) ? "dark" : "glass";
}

export function isLoginTemplateId(template: unknown): template is LoginTemplateId {
  return typeof template === "string" && (LOGIN_TEMPLATE_IDS as readonly string[]).includes(template);
}

const SUPPORT_EMAIL_PATTERN = /^mailto:[^\s@<>()[\]\\,;:"?#&]+@[^\s@<>()[\]\\,;:"?#&]+\.[A-Za-z]{2,}$/i;

/** Links que a linha de ajuda aceita: https:// (sem usuario/senha no endereco) ou mailto:email. */
export function isAllowedLoginSupportHref(href: string | null | undefined): href is string {
  const value = href?.trim();

  if (!value) {
    return false;
  }

  if (SUPPORT_EMAIL_PATTERN.test(value)) {
    return true;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getLoginPageConfig(template?: string): LoginPageConfig {
  const templateId = isLoginTemplateId(template) ? template : baseLoginPageConfig.template;

  return {
    ...baseLoginPageConfig,
    logo: { ...baseLoginPageConfig.logo },
    visual: { ...baseLoginPageConfig.visual },
    form: { ...baseLoginPageConfig.form },
    providers: [...baseLoginPageConfig.providers],
    footerLinks: [],
    template: templateId,
    panelTone: defaultLoginPanelTone(templateId)
  };
}
