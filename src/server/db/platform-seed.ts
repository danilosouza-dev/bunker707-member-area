import {
  BookOpen,
  Brain,
  Compass,
  FileText,
  Flame,
  Home,
  LibraryBig,
  LifeBuoy,
  PlayCircle,
  ShieldCheck,
  UserCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ContentKind =
  | "Formacao"
  | "Curso"
  | "Mentoria"
  | "Webinario"
  | "Produto"
  | "Bootcamp"
  | "Aula"
  | "Material";
export type CommerceScope = "sellable_product" | "included_content" | "learning_content";
export type ContentStatus = "Novo" | "Em andamento" | "Concluido" | "Liberado" | "Bloqueado" | "Em breve";
export type RowVisibility = "students" | "non_students" | "all";
export type FormationCourseOpenMode = "course_page_modules" | "course_lesson_format";
export type CoursePresentationMode = "module_cards" | "lesson_playlist";
export type ModuleOpenMode = "expand_lessons" | "lesson_page";
export type InternalCardActionMode = "button" | "implicit";

export type ContentItem = {
  id: string;
  title: string;
  eyebrow: string;
  description?: string;
  accessLabel?: string;
  instructor?: {
    name: string;
    handle?: string;
    avatar?: string;
  };
  level?: string;
  durationLabel?: string;
  commerceScope?: CommerceScope;
  isLocked?: boolean;
  kind: ContentKind;
  image: string;
  progress: number;
  lessons?: string;
  purchaseLabel?: string;
  status: ContentStatus;
};

export type HomeRow = {
  id: string;
  title: string;
  subtitle?: string;
  variant: "continue" | "vertical";
  visibility: RowVisibility;
  items: ContentItem[];
};

export type NavigationItem = {
  href?: string;
  icon: LucideIcon;
  label: string;
};

export type HomeHeroConfig = {
  badge?: string;
  title?: string;
  description?: string;
  image: string;
  mediaType: "image" | "video";
  purpose: "school-brand" | "editorial-highlight" | "content-highlight";
  visibility?: {
    badge?: boolean;
    title?: boolean;
    description?: boolean;
  };
};

export type ContentPageHeroConfig = {
  badge?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  mediaType: "image" | "video";
  mediaSrc: string;
  poster?: string;
  visibility?: {
    badge?: boolean;
    title?: boolean;
    description?: boolean;
    cta?: boolean;
  };
};

export type LessonPreview = {
  id: string;
  title: string;
  description: string;
  duration: string;
  image?: string;
  completed?: boolean;
};

export type CourseModule = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  image: string;
  meta: string;
  progress: number;
  lessons: LessonPreview[];
};

export type ContentPageSettings = {
  hero?: ContentPageHeroConfig;
  formationCourseOpenMode?: FormationCourseOpenMode;
  coursePresentationMode?: CoursePresentationMode;
  moduleOpenMode?: ModuleOpenMode;
  internalCardActionMode?: InternalCardActionMode;
};

export const student = {
  name: "Danilo",
  fullName: "Danilo Souza"
};

export const navigationItems = [
  { label: "Home", href: "/", icon: Home },
  { label: "Minha jornada", icon: Compass },
  { label: "Minhas compras", href: "/minhas-compras", icon: LibraryBig },
  { label: "CMS", href: "/admin", icon: ShieldCheck },
  { label: "Continue assistindo", icon: PlayCircle },
  { label: "Materiais", icon: FileText },
  { label: "Suporte", icon: LifeBuoy },
  { label: "Perfil", icon: UserCircle }
] satisfies NavigationItem[];

export const hero: HomeHeroConfig = {
  image: "/hero/bunker-707-red-front-hero.png",
  mediaType: "image",
  purpose: "school-brand",
  visibility: {
    badge: false,
    title: false,
    description: false
  }
};

export const continueWatching: ContentItem[] = [
  {
    id: "cw-1",
    title: "Agentes de IA para operacoes reais",
    eyebrow: "Fundamentos de IA Aplicada",
    description: "Continue a aula sobre desenho de agentes para rotinas de negocio.",
    accessLabel: "Liberado",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    progress: 72,
    lessons: "Aula 08",
    status: "Em andamento"
  },
  {
    id: "cw-2",
    title: "Prompt engineering sem improviso",
    eyebrow: "Base Bunker707",
    description: "Padroes praticos para prompts consistentes e reutilizaveis.",
    accessLabel: "Liberado",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=900&q=80",
    progress: 46,
    lessons: "6/14 aulas",
    status: "Em andamento"
  },
  {
    id: "cw-3",
    title: "Criando copilotos para atendimento",
    eyebrow: "Automacoes",
    description: "Crie fluxos de atendimento com contexto, memoria e orientacao clara.",
    accessLabel: "Liberado",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
    progress: 18,
    lessons: "Aula 03",
    status: "Em andamento"
  },
  {
    id: "cw-4",
    title: "Arquitetura de workflows inteligentes",
    eyebrow: "Formacao Avancada",
    description: "Organize ferramentas, modelos e dados em workflows escalaveis.",
    accessLabel: "Liberado",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    progress: 58,
    lessons: "Aula 11",
    status: "Em andamento"
  }
];

export const formations: ContentItem[] = [
  {
    id: "formation-1",
    title: "Fundamentos de IA Aplicada",
    eyebrow: "Formacao inicial",
    description: "A base para entender modelos, prompts, agentes e aplicacoes reais de IA.",
    accessLabel: "Formacao",
    commerceScope: "sellable_product",
    kind: "Formacao",
    image:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
    progress: 34,
    lessons: "48 aulas",
    status: "Em andamento"
  },
  {
    id: "formation-2",
    title: "Automacoes com Agentes",
    eyebrow: "Formacao pratica",
    description: "Construa agentes capazes de executar tarefas, consultar dados e acionar sistemas.",
    accessLabel: "Formacao",
    commerceScope: "sellable_product",
    kind: "Formacao",
    image:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "32 aulas",
    status: "Novo"
  },
  {
    id: "formation-3",
    title: "IA para Vendas e Operacoes",
    eyebrow: "Formacao de negocios",
    description: "Use IA para aumentar eficiencia comercial, atendimento e operacoes internas.",
    accessLabel: "Formacao",
    commerceScope: "sellable_product",
    kind: "Formacao",
    image:
      "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=80",
    progress: 12,
    lessons: "26 aulas",
    status: "Liberado"
  },
  {
    id: "formation-4",
    title: "Produtos Digitais com IA",
    eyebrow: "Formacao builder",
    description: "Planeje, prototipe e entregue produtos digitais usando IA como alavanca.",
    accessLabel: "Nao adquirido",
    commerceScope: "sellable_product",
    isLocked: true,
    kind: "Formacao",
    image:
      "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "21 aulas",
    purchaseLabel: "Comprar",
    status: "Bloqueado"
  }
];

export const bootcamps: ContentItem[] = [
  {
    id: "bootcamp-1",
    title: "Bootcamp Agentes na Pratica",
    eyebrow: "Imersao intensiva",
    description: "Uma imersao guiada para construir e publicar agentes aplicados a processos reais.",
    accessLabel: "Nao adquirido",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    durationLabel: "4 semanas",
    isLocked: true,
    kind: "Bootcamp",
    image:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "24 aulas",
    purchaseLabel: "Comprar",
    status: "Bloqueado"
  },
  {
    id: "bootcamp-2",
    title: "Bootcamp IA para Conteudo",
    eyebrow: "Imersao criativa",
    description: "Crie um sistema completo de pesquisa, roteiro, producao e revisao com IA.",
    accessLabel: "Bootcamp",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    durationLabel: "3 semanas",
    kind: "Bootcamp",
    image:
      "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    progress: 9,
    lessons: "18 aulas",
    status: "Em andamento"
  }
];

export const courses: ContentItem[] = [
  {
    id: "course-1",
    title: "Clone Perfeito 2.0",
    eyebrow: "Curso de criacao visual",
    description: "Construa ensaios, clones e imagens profissionais com IA, direcao visual e acabamento comercial.",
    accessLabel: "Curso avulso",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    level: "Intermediario",
    durationLabel: "10 modulos • 116 aulas",
    kind: "Curso",
    image: "/covers/ensaios-com-ia-card-vertical.png",
    progress: 16,
    lessons: "13/116 aulas",
    status: "Em andamento"
  },
  {
    id: "course-2",
    title: "No-code, APIs e automacoes",
    eyebrow: "Curso tecnico",
    description: "Conecte ferramentas, automacoes e APIs sem complicar a operacao.",
    accessLabel: "Nao adquirido",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    level: "Avancado",
    durationLabel: "18 aulas",
    isLocked: true,
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "18 aulas",
    purchaseLabel: "Comprar",
    status: "Bloqueado"
  },
  {
    id: "course-3",
    title: "Dashboards inteligentes",
    eyebrow: "Curso analitico",
    description: "Transforme dados em visoes acionaveis com apoio de IA e metricas claras.",
    accessLabel: "Curso avulso",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    level: "Intermediario",
    durationLabel: "18 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    progress: 22,
    lessons: "4/18 aulas",
    status: "Em andamento"
  },
  {
    id: "course-4",
    title: "IA para criacao de conteudo",
    eyebrow: "Curso criativo",
    description: "Crie processos de conteudo com pesquisa, roteiro, revisao e distribuicao.",
    accessLabel: "Curso avulso",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    level: "Inicial",
    durationLabel: "12 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    progress: 100,
    lessons: "Concluido",
    status: "Concluido"
  },
  {
    id: "course-5",
    title: "Governanca e seguranca em IA",
    eyebrow: "Curso essencial",
    description: "Defina limites, boas praticas e criterios de seguranca para uso de IA.",
    accessLabel: "Nao adquirido",
    commerceScope: "sellable_product",
    instructor: {
      name: "Danilo Souza",
      handle: "@danilosouza_ia"
    },
    level: "Essencial",
    durationLabel: "10 aulas",
    isLocked: true,
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "10 aulas",
    purchaseLabel: "Comprar",
    status: "Bloqueado"
  }
];

export const formationInternalCourses: ContentItem[] = [
  {
    id: "formation-course-1",
    title: "Fundamentos de prompts",
    eyebrow: "Curso base",
    description: "Estruture prompts reutilizaveis para estudo, negocios e producao.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "14 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    progress: 28,
    lessons: "14 aulas",
    status: "Em andamento"
  },
  {
    id: "formation-course-2",
    title: "Agentes de IA aplicados",
    eyebrow: "Curso pratico",
    description: "Crie agentes com ferramentas, memoria e criterios de execucao.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "18 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=900&q=80",
    progress: 9,
    lessons: "18 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-3",
    title: "Automacoes e APIs",
    eyebrow: "Curso tecnico",
    description: "Conecte IA com sistemas, webhooks e operacoes reais.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "22 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "22 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-4",
    title: "Dashboards com IA",
    eyebrow: "Curso analitico",
    description: "Transforme comportamento do aluno em metricas acionaveis.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "16 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "16 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-5",
    title: "Conteudo com IA",
    eyebrow: "Curso criativo",
    description: "Crie processos de roteiro, revisao e distribuicao com consistencia.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "12 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "12 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-6",
    title: "Governanca e seguranca",
    eyebrow: "Curso essencial",
    description: "Defina limites, politicas e criterios para uso seguro de IA.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "10 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "10 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-7",
    title: "Pesquisa e estrategia com IA",
    eyebrow: "Curso de pesquisa",
    description: "Transforme perguntas soltas em processos de pesquisa, briefing e tomada de decisao.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "15 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "15 aulas",
    status: "Liberado"
  },
  {
    id: "formation-course-8",
    title: "IA para vendas e atendimento",
    eyebrow: "Curso operacional",
    description: "Desenhe copilotos para qualificar leads, responder clientes e organizar follow-up.",
    accessLabel: "Curso da formacao",
    commerceScope: "included_content",
    durationLabel: "20 aulas",
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "20 aulas",
    status: "Liberado"
  }
];

export const recentLessons: ContentItem[] = [
  {
    id: "lesson-1",
    title: "Como mapear tarefas para agentes",
    eyebrow: "Automacoes com Agentes",
    description: "Aprenda a separar tarefas, ferramentas e criterios antes de criar agentes.",
    accessLabel: "Aula",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "18 min",
    status: "Novo"
  },
  {
    id: "lesson-2",
    title: "Padroes de prompt para times",
    eyebrow: "Base Bunker707",
    description: "Crie uma biblioteca de prompts consistente para equipes e processos.",
    accessLabel: "Aula",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "24 min",
    status: "Novo"
  },
  {
    id: "lesson-3",
    title: "Validacao de respostas com fontes",
    eyebrow: "IA Confiavel",
    description: "Entenda como reduzir alucinacao e aumentar confianca nas respostas.",
    accessLabel: "Aula",
    kind: "Aula",
    image:
      "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "31 min",
    status: "Novo"
  }
];

const hasAccess = (item: ContentItem) => !item.isLocked;
export const purchasedProducts = [...formations, ...bootcamps, ...courses].filter(hasAccess);
const showcaseItems = [...formations, ...bootcamps, ...courses].filter(
  (item) => item.commerceScope === "sellable_product"
);

export const upcomingProducts: ContentItem[] = [
  {
    id: "upcoming-1",
    title: "IA para Produtos Visuais",
    eyebrow: "Proxima formacao",
    description: "Uma jornada para criar produtos visuais, ensaios, campanhas e assets com IA.",
    accessLabel: "Em breve",
    commerceScope: "sellable_product",
    durationLabel: "Lista de espera",
    isLocked: true,
    kind: "Formacao",
    image:
      "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "Em producao",
    purchaseLabel: "Avisar-me",
    status: "Em breve"
  },
  {
    id: "upcoming-2",
    title: "Agentes para Educadores",
    eyebrow: "Novo curso",
    description: "Crie assistentes, trilhas e apoio pedagogico usando agentes de IA.",
    accessLabel: "Em breve",
    commerceScope: "sellable_product",
    durationLabel: "Lista de espera",
    isLocked: true,
    kind: "Curso",
    image:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "Em producao",
    purchaseLabel: "Avisar-me",
    status: "Em breve"
  },
  {
    id: "upcoming-3",
    title: "Bootcamp Operacao com IA",
    eyebrow: "Proxima turma",
    description: "Uma imersao para implantar IA em processos, atendimento e rotina operacional.",
    accessLabel: "Em breve",
    commerceScope: "sellable_product",
    durationLabel: "Proxima turma",
    isLocked: true,
    kind: "Bootcamp",
    image:
      "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=900&q=80",
    progress: 0,
    lessons: "Inscricoes futuras",
    purchaseLabel: "Avisar-me",
    status: "Em breve"
  }
];

const lessonImages = [
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80"
];

const lessonTitleSeeds = [
  "Mapa da pratica",
  "Configuracao inicial",
  "Prompt e criterio",
  "Execucao guiada",
  "Controle de variacoes",
  "Analise de resultado",
  "Refino com contexto",
  "Padrao reutilizavel",
  "Checklist de qualidade",
  "Proxima entrega"
];

const lessonDescriptionSeeds = [
  "Entenda o objetivo do passo e como ele se encaixa no fluxo completo.",
  "Prepare ferramentas, referencias e contexto antes de colocar a aula em pratica.",
  "Crie um criterio claro para repetir o resultado com mais consistencia.",
  "Acompanhe a aplicacao em um cenario realista da rotina do aluno.",
  "Compare versoes, registre decisoes e escolha o melhor caminho para evoluir."
];

function makeLessons(moduleId: string, count: number, topic: string, image: string): LessonPreview[] {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const titleSeed = lessonTitleSeeds[index % lessonTitleSeeds.length];
    const descriptionSeed = lessonDescriptionSeeds[index % lessonDescriptionSeeds.length];
    const lessonImage = position % 4 === 0 ? image : lessonImages[index % lessonImages.length];

    return {
      id: `${moduleId}-lesson-${position}`,
      title: `${String(position).padStart(2, "0")} - ${titleSeed}: ${topic}`,
      description: `${descriptionSeed} Foco pratico: ${topic.toLowerCase()}.`,
      duration: `${14 + ((index * 5) % 22)} min`,
      image: lessonImage,
      completed: index < 2
    };
  });
}

function makeModule({
  description,
  image,
  lessonCount,
  moduleNumber,
  progress,
  title,
  topic
}: {
  description: string;
  image: string;
  lessonCount: number;
  moduleNumber: number;
  progress: number;
  title: string;
  topic: string;
}): CourseModule {
  const moduleId = `module-${moduleNumber}`;

  return {
    id: moduleId,
    title,
    eyebrow: `Modulo ${String(moduleNumber).padStart(2, "0")}`,
    description,
    image,
    meta: `${lessonCount} aulas`,
    progress,
    lessons: makeLessons(moduleId, lessonCount, topic, image)
  };
}

export const courseModules: CourseModule[] = [
  makeModule({
    moduleNumber: 1,
    title: "Base e direcao visual",
    description: "Fundamentos, referencias e criterio visual antes de gerar imagens.",
    image: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80",
    lessonCount: 6,
    progress: 72,
    topic: "base e direcao visual"
  }),
  makeModule({
    moduleNumber: 2,
    title: "Construcao do clone",
    description: "Processo completo para criar consistencia facial e identidade.",
    image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=900&q=80",
    lessonCount: 7,
    progress: 28,
    topic: "construcao do clone"
  }),
  makeModule({
    moduleNumber: 3,
    title: "Ensaios profissionais",
    description: "Crie series de imagens com narrativa, estilo e acabamento comercial.",
    image: "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    lessonCount: 10,
    progress: 0,
    topic: "ensaios profissionais"
  }),
  makeModule({
    moduleNumber: 4,
    title: "Entrega e portfolio",
    description: "Prepare arquivos, apresentacao e fluxo de entrega para clientes.",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    lessonCount: 15,
    progress: 0,
    topic: "entrega e portfolio"
  }),
  makeModule({
    moduleNumber: 5,
    title: "Operacao de producao",
    description: "Monte uma esteira para produzir, revisar e aprovar imagens em maior volume.",
    image: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    lessonCount: 20,
    progress: 0,
    topic: "operacao de producao"
  }),
  makeModule({
    moduleNumber: 6,
    title: "Automacao do workflow",
    description: "Conecte briefing, geracao, revisao e entrega com ferramentas no-code e IA.",
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80",
    lessonCount: 6,
    progress: 0,
    topic: "automacao do workflow"
  }),
  makeModule({
    moduleNumber: 7,
    title: "Revisao e qualidade",
    description: "Crie criterios de avaliacao para consistencia, realismo e acabamento.",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    lessonCount: 7,
    progress: 0,
    topic: "revisao e qualidade"
  }),
  makeModule({
    moduleNumber: 8,
    title: "Comercializacao e pos-venda",
    description: "Empacote o servico, defina entregaveis e organize relacionamento com clientes.",
    image: "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=80",
    lessonCount: 10,
    progress: 0,
    topic: "comercializacao e pos-venda"
  })
];

export const contentPageSettings: Record<string, ContentPageSettings> = {
  "formation-1": {
    hero: {
      mediaType: "image",
      mediaSrc: "/hero/bunker-ai-hero.png",
      badge: "Formacao",
      title: "Fundamentos de IA Aplicada",
      description: "Uma jornada para dominar os principios, prompts, agentes e aplicacoes reais de IA.",
      ctaLabel: "Continuar formacao",
      ctaHref: "#conteudos",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    formationCourseOpenMode: "course_lesson_format",
    internalCardActionMode: "implicit"
  },
  "formation-2": {
    hero: {
      mediaType: "image",
      mediaSrc: "/hero/bunker-707-red-neon-hero.png",
      badge: "Formacao pratica",
      title: "Automacoes com Agentes",
      description: "Construa agentes capazes de executar tarefas e conectar sistemas da operacao.",
      ctaLabel: "Ver cursos",
      ctaHref: "#conteudos",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    formationCourseOpenMode: "course_lesson_format",
    internalCardActionMode: "implicit"
  },
  "formation-3": {
    hero: {
      mediaType: "image",
      mediaSrc: "/hero/bunker-707-red-front-hero.png",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    formationCourseOpenMode: "course_lesson_format",
    internalCardActionMode: "implicit"
  },
  "course-1": {
    hero: {
      mediaType: "image",
      mediaSrc: "/hero/bunker-707-red-front-hero.png",
      badge: "Curso avulso",
      title: "Clone Perfeito 2.0",
      description: "Ensaios, clones e imagens profissionais com IA, direcao visual e acabamento comercial.",
      ctaLabel: "Ver modulos",
      ctaHref: "#conteudos",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    coursePresentationMode: "module_cards",
    moduleOpenMode: "lesson_page",
    internalCardActionMode: "implicit"
  },
  "formation-course-1": {
    hero: {
      mediaType: "image",
      mediaSrc: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1600&q=80",
      badge: "Curso",
      title: "Fundamentos de prompts",
      description: "Crie prompts reutilizaveis e criterios claros para trabalhar com IA sem improviso.",
      ctaLabel: "Ver aulas",
      ctaHref: "#conteudos",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    coursePresentationMode: "lesson_playlist",
    moduleOpenMode: "lesson_page"
  },
  "formation-course-2": {
    hero: {
      mediaType: "image",
      mediaSrc: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1600&q=80",
      badge: "Curso",
      title: "Agentes de IA aplicados",
      description: "Aprenda a montar agentes com ferramentas, memoria e criterios de execucao.",
      ctaLabel: "Ver aulas",
      ctaHref: "#conteudos",
      visibility: {
        badge: false,
        title: false,
        description: false,
        cta: false
      }
    },
    coursePresentationMode: "lesson_playlist",
    moduleOpenMode: "lesson_page"
  }
};

export const allContentItems: ContentItem[] = [
  ...continueWatching,
  ...formations,
  ...formationInternalCourses,
  ...bootcamps,
  ...courses,
  ...recentLessons,
  ...upcomingProducts
];

export const homeRows: HomeRow[] = [
  {
    id: "continue-watching",
    title: "Continue assistindo",
    subtitle: "Retome exatamente de onde parou.",
    variant: "continue",
    visibility: "students",
    items: continueWatching
  },
  {
    id: "my-purchases",
    title: "Minhas compras",
    subtitle: "Todos os produtos que voce ja tem acesso: formacoes, bootcamps e cursos.",
    variant: "vertical",
    visibility: "students",
    items: purchasedProducts
  },
  {
    id: "showcase",
    title: "Produtos a venda",
    subtitle: "Produtos disponiveis e destaques configurados pela Bunker707.",
    variant: "vertical",
    visibility: "all",
    items: showcaseItems
  },
  {
    id: "upcoming",
    title: "Em breve na Bunker707",
    subtitle: "Proximos cursos, formacoes e turmas para entrar no radar.",
    variant: "vertical",
    visibility: "all",
    items: upcomingProducts
  }
];

export const quickStats = [
  { label: "Aulas concluidas", value: "27", icon: BookOpen },
  { label: "Produtos ativos", value: "6", icon: Compass },
  { label: "Sequencia", value: "6 dias", icon: Flame },
  { label: "Nivel atual", value: "Builder", icon: Brain }
];
