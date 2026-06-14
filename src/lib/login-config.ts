export type LoginTemplateId =
  | "split-visual-right"
  | "split-visual-left"
  | "center-glass"
  | "side-glass-right";

export type LoginPanelTone = "dark" | "glass" | "light";
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
    src: string;
    alt: string;
  };
  visual: {
    imageSrc: string;
    alt: string;
    eyebrow: string;
    title: string;
    description: string;
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
  };
  providers: LoginProvider[];
  footerLinks: Array<{
    label: string;
    href: string;
  }>;
};

export const loginTemplateOptions: LoginTemplateOption[] = [
  {
    id: "split-visual-right",
    name: "Astronauta dividido",
    description: "Formulario a esquerda com painel visual editorial a direita.",
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
    name: "Imagem editorial",
    description: "Imagem forte a esquerda e formulario direto a direita.",
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
    name: "Central translucido",
    description: "Imagem de fundo em tela cheia com formulario translúcido central.",
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
    name: "Lateral translucido",
    description: "Imagem de fundo em tela cheia com formulario translúcido lateral.",
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
    src: "/brand/logo-bunker.png",
    alt: "Bunker707"
  },
  visual: {
    imageSrc: "/login/bunker-astronaut-login.png",
    alt: "Astronauta em ambiente escuro com circuitos de IA em vermelho",
    eyebrow: "",
    title: "Na superfície, todos seguem no automático. No Bunker, a IA vira método.",
    description: ""
  },
  form: {
    title: "",
    subtitle: "",
    emailLabel: "Email",
    emailPlaceholder: "seuemail@exemplo.com",
    passwordLabel: "Senha",
    passwordPlaceholder: "Digite sua senha",
    forgotPasswordLabel: "Esqueci minha senha",
    primaryCta: "Entrar",
    supportLabel: "Ainda nao tem acesso?",
    supportCta: "Fale com o suporte"
  },
  providers: ["google"],
  footerLinks: []
};

const loginTemplatePreviewOverrides: Record<
  LoginTemplateId,
  Pick<LoginPageConfig, "template" | "panelTone">
> = {
  "split-visual-right": {
    template: "split-visual-right",
    panelTone: "dark"
  },
  "split-visual-left": {
    template: "split-visual-left",
    panelTone: "dark"
  },
  "center-glass": {
    template: "center-glass",
    panelTone: "glass"
  },
  "side-glass-right": {
    template: "side-glass-right",
    panelTone: "glass"
  }
};

function isLoginTemplateId(template: string | undefined): template is LoginTemplateId {
  return Boolean(
    template &&
      loginTemplateOptions.some((templateOption) => templateOption.id === template)
  );
}

export function getLoginPageConfig(template?: string): LoginPageConfig {
  const templateId = isLoginTemplateId(template) ? template : baseLoginPageConfig.template;
  const override = loginTemplatePreviewOverrides[templateId];

  return {
    ...baseLoginPageConfig,
    ...override
  };
}
