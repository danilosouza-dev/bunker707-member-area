"use client";

import { Bell, Bookmark, ChevronDown, ChevronUp, LockKeyhole, Play, ShoppingCart, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import type { ContentItem } from "@/lib/mock-data";

type ContentDetailsModalProps = {
  item: ContentItem | null;
  onClose: () => void;
};

type ModalCard = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  image: string;
  meta: string;
  isLocked?: boolean;
};

type LessonPreview = {
  id: string;
  title: string;
  description: string;
  duration: string;
  image?: string;
};

type ModulePreview = ModalCard & {
  lessons: LessonPreview[];
};

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
      image: lessonImage
    };
  });
}

function makeModule({
  description,
  image,
  lessonCount,
  moduleNumber,
  title,
  topic
}: {
  description: string;
  image: string;
  lessonCount: number;
  moduleNumber: number;
  title: string;
  topic: string;
}): ModulePreview {
  const moduleId = `module-${moduleNumber}`;

  return {
    id: moduleId,
    title,
    eyebrow: `Modulo ${String(moduleNumber).padStart(2, "0")}`,
    description,
    image,
    meta: `${lessonCount} aulas`,
    lessons: makeLessons(moduleId, lessonCount, topic, image)
  };
}

const formationCourseCards: ModalCard[] = [
  {
    id: "formation-course-1",
    title: "Fundamentos de prompts",
    eyebrow: "Curso base",
    description: "Estruture prompts reutilizaveis para estudo, negocios e producao.",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    meta: "14 aulas"
  },
  {
    id: "formation-course-2",
    title: "Agentes de IA aplicados",
    eyebrow: "Curso pratico",
    description: "Crie agentes com ferramentas, memoria e criterios de execucao.",
    image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=900&q=80",
    meta: "18 aulas"
  },
  {
    id: "formation-course-3",
    title: "Automacoes e APIs",
    eyebrow: "Curso tecnico",
    description: "Conecte IA com sistemas, webhooks e operacoes reais.",
    image: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    meta: "22 aulas"
  },
  {
    id: "formation-course-4",
    title: "Dashboards com IA",
    eyebrow: "Curso analitico",
    description: "Transforme comportamento do aluno em metricas acionaveis.",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    meta: "16 aulas"
  },
  {
    id: "formation-course-5",
    title: "Conteudo com IA",
    eyebrow: "Curso criativo",
    description: "Crie processos de roteiro, revisao e distribuicao com consistencia.",
    image: "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    meta: "12 aulas"
  },
  {
    id: "formation-course-6",
    title: "Governanca e seguranca",
    eyebrow: "Curso essencial",
    description: "Defina limites, politicas e criterios para uso seguro de IA.",
    image: "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=900&q=80",
    meta: "10 aulas"
  },
  {
    id: "formation-course-7",
    title: "Pesquisa e estrategia com IA",
    eyebrow: "Curso de pesquisa",
    description: "Transforme perguntas soltas em processos de pesquisa, briefing e tomada de decisao.",
    image: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    meta: "15 aulas"
  },
  {
    id: "formation-course-8",
    title: "IA para vendas e atendimento",
    eyebrow: "Curso operacional",
    description: "Desenhe copilotos para qualificar leads, responder clientes e organizar follow-up.",
    image: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=900&q=80",
    meta: "20 aulas"
  },
  {
    id: "formation-course-9",
    title: "Produtos digitais com IA",
    eyebrow: "Curso builder",
    description: "Prototipe ofertas, aulas, materiais e experiencias digitais com apoio de modelos.",
    image: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    meta: "24 aulas"
  },
  {
    id: "formation-course-10",
    title: "Memoria, dados e contexto",
    eyebrow: "Curso tecnico",
    description: "Organize bases, historicos e memoria para respostas mais uteis e rastreaveis.",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
    meta: "13 aulas"
  },
  {
    id: "formation-course-11",
    title: "Implantacao em times",
    eyebrow: "Curso de operacao",
    description: "Crie rotinas de adocao, treinamento e medicao de uso para equipes pequenas.",
    image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=900&q=80",
    meta: "11 aulas"
  },
  {
    id: "formation-course-12",
    title: "Projeto final orientado",
    eyebrow: "Curso final",
    description: "Feche a formacao publicando um workflow completo com criterios de qualidade.",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    meta: "9 aulas"
  }
];

const courseModules: ModulePreview[] = [
  makeModule({
    moduleNumber: 1,
    title: "Base e direcao visual",
    description: "Fundamentos, referencias e criterio visual antes de gerar imagens.",
    image: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80",
    lessonCount: 6,
    topic: "base e direcao visual"
  }),
  makeModule({
    moduleNumber: 2,
    title: "Construcao do clone",
    description: "Processo completo para criar consistencia facial e identidade.",
    image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=900&q=80",
    lessonCount: 7,
    topic: "construcao do clone"
  }),
  makeModule({
    moduleNumber: 3,
    title: "Ensaios profissionais",
    description: "Crie series de imagens com narrativa, estilo e acabamento comercial.",
    image: "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80",
    lessonCount: 10,
    topic: "ensaios profissionais"
  }),
  makeModule({
    moduleNumber: 4,
    title: "Entrega e portfolio",
    description: "Prepare arquivos, apresentacao e fluxo de entrega para clientes.",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    lessonCount: 15,
    topic: "entrega e portfolio"
  }),
  makeModule({
    moduleNumber: 5,
    title: "Operacao de producao",
    description: "Monte uma esteira para produzir, revisar e aprovar imagens em maior volume.",
    image: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80",
    lessonCount: 20,
    topic: "operacao de producao"
  }),
  makeModule({
    moduleNumber: 6,
    title: "Automacao do workflow",
    description: "Conecte briefing, geracao, revisao e entrega com ferramentas no-code e IA.",
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80",
    lessonCount: 6,
    topic: "automacao do workflow"
  }),
  makeModule({
    moduleNumber: 7,
    title: "Revisao e qualidade",
    description: "Crie criterios de avaliacao para consistencia, realismo e acabamento.",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    lessonCount: 7,
    topic: "revisao e qualidade"
  }),
  makeModule({
    moduleNumber: 8,
    title: "Comercializacao e pos-venda",
    description: "Empacote o servico, defina entregaveis e organize relacionamento com clientes.",
    image: "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=80",
    lessonCount: 10,
    topic: "comercializacao e pos-venda"
  }),
  makeModule({
    moduleNumber: 9,
    title: "Looks, cenas e variacoes",
    description: "Crie diferentes cenas, roupas e enquadramentos mantendo a identidade do clone.",
    image: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=900&q=80",
    lessonCount: 15,
    topic: "looks, cenas e variacoes"
  }),
  makeModule({
    moduleNumber: 10,
    title: "Projeto completo do clone",
    description: "Feche o curso com um projeto completo, revisado e pronto para apresentar.",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    lessonCount: 20,
    topic: "projeto completo do clone"
  })
];

function DetailDots({ details }: { details: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-zinc-300">
      {details.map((detail, index) => (
        <span className="contents" key={detail}>
          {index > 0 ? <span className="h-1 w-1 rounded-full bg-zinc-500" /> : null}
          <span>{detail}</span>
        </span>
      ))}
    </div>
  );
}

function MiniContentCard({ card }: { card: ModalCard }) {
  const router = useRouter();
  const imageStateClass = card.isLocked
    ? "modal-vertical-card-image-locked"
    : "";
  const href = `/conteudo/${card.id}`;

  function openContentPage() {
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openContentPage();
    }
  }

  return (
    <article
      aria-label={`Abrir ${card.title}`}
      className="modal-vertical-card isolate overflow-hidden rounded-[8px] bg-[#242424] shadow-xl shadow-black/25"
      onClick={openContentPage}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
    >
      <div className="modal-vertical-card-media relative aspect-[720/1040] overflow-hidden bg-[#181818] [transform:translateZ(0)]">
        <div
          className={`modal-vertical-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
          style={{ backgroundImage: `url(${card.image})` }}
        />
        <div className="modal-vertical-card-overlay absolute inset-0" />
        {card.isLocked ? (
          <div className="absolute right-3 top-3 z-10 text-black drop-shadow-[0_1px_5px_rgba(255,255,255,0.78)]">
            <LockKeyhole className="h-6 w-6 stroke-[3]" />
            <span className="sr-only">Conteudo bloqueado</span>
          </div>
        ) : null}
      </div>
      <div className="relative z-10 -mt-px bg-[#242424] p-3">
        <h4 className="line-clamp-2 text-base font-black leading-tight text-white">{card.title}</h4>
        <p className="mt-2 text-xs font-semibold text-zinc-300">{card.meta}</p>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{card.description}</p>
      </div>
    </article>
  );
}

function ExpandSectionButton({
  expanded,
  label,
  onClick,
  className = ""
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;

  return (
    <div className={`mt-4 flex justify-center ${className}`}>
      <button
        aria-label={label}
        className="grid h-10 w-10 place-items-center rounded-full border-2 border-zinc-500 bg-[#181818] text-white shadow-xl shadow-black/35 transition duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.035] hover:border-white hover:bg-[#242424] active:scale-[0.97]"
        onClick={onClick}
        type="button"
      >
        <Icon className="h-5 w-5 transition duration-300" />
      </button>
    </div>
  );
}

function ExpandableSectionReveal({
  buttonLabel,
  children,
  expanded,
  onToggle
}: {
  buttonLabel: string;
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (expanded) {
    return (
      <>
        <div className="mt-4 space-y-4 overflow-hidden transition-[max-height,opacity,margin] duration-500 ease-out">
          {children}
        </div>
        <ExpandSectionButton
          expanded
          label={buttonLabel}
          onClick={onToggle}
        />
      </>
    );
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-[8px]">
      <div
        aria-hidden="true"
        className="pointer-events-none max-h-[148px] select-none overflow-hidden opacity-80 sm:max-h-[168px]"
        inert
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#151515]/0 via-[#151515]/78 to-[#151515]" />
      <ExpandSectionButton
        className="absolute inset-x-0 bottom-3 z-10 mt-0"
        expanded={false}
        label={buttonLabel}
        onClick={onToggle}
      />
    </div>
  );
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function ModuleCard({
  active,
  cardRef,
  module,
  onClick
}: {
  active: boolean;
  cardRef?: Ref<HTMLButtonElement>;
  module: ModulePreview;
  onClick: () => void;
}) {
  return (
    <button
      className={`modal-vertical-card module-card-motion isolate overflow-hidden rounded-[8px] bg-[#242424] text-left shadow-xl shadow-black/25 transition-[opacity,filter,background-color] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        active ? "module-active-card bg-[#2a2a2a]" : ""
      }`}
      onClick={onClick}
      ref={cardRef}
      type="button"
    >
      <div className="modal-vertical-card-media module-card-media relative aspect-[720/1040] overflow-hidden bg-[#181818] [transform:translateZ(0)]">
        <div
          className="modal-vertical-card-image absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${module.image})` }}
        />
        <div className="modal-vertical-card-overlay absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/66 to-transparent" />
        <div className="module-card-media-label absolute inset-x-0 bottom-0 p-3">
          <p className="text-[11px] font-bold uppercase tracking-normal text-zinc-300">
            {module.eyebrow}
          </p>
          <h4 className="mt-1 line-clamp-2 text-base font-black leading-tight text-white">
            {module.title}
          </h4>
        </div>
      </div>
      <div className="module-card-content relative z-10 -mt-px bg-[#242424] p-3">
        <p className="module-card-inline-eyebrow hidden text-[11px] font-bold uppercase tracking-normal text-zinc-400">
          {module.eyebrow}
        </p>
        <h4 className="module-card-inline-title hidden text-sm font-black leading-tight text-white">
          {module.title}
        </h4>
        <p className="text-xs font-semibold text-zinc-300">{module.meta}</p>
        <p className="module-card-description mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">
          {module.description}
        </p>
        <span className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-white">
          {active ? "Ocultar aulas" : "Ver aulas"}
          <ChevronDown className={`h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${active ? "rotate-180" : ""}`} />
        </span>
      </div>
    </button>
  );
}

function LessonPanel({
  maxHeight,
  module
}: {
  maxHeight?: number | null;
  module: ModulePreview;
}) {
  return (
    <div
      className="module-lessons-in flex flex-col self-start overflow-hidden rounded-[8px] border border-white/10 bg-[#1f1f1f] shadow-2xl shadow-black/35"
      style={maxHeight ? { height: maxHeight } : undefined}
    >
      <div className="border-b border-white/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
          Aulas de {module.eyebrow}
        </p>
        <h4 className="mt-1 text-lg font-black text-white">{module.title}</h4>
      </div>
      <ol className={`modal-lessons-scroll ${maxHeight ? "modal-lessons-scroll-fit" : ""}`}>
        {module.lessons.map((lesson, index) => (
          <li
            className="grid gap-4 border-b border-white/8 p-4 transition-colors duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.035] last:border-b-0 sm:grid-cols-[2rem_9rem_1fr_auto]"
            key={lesson.id}
          >
            <span className="pt-1 text-sm font-semibold text-zinc-500">{index + 1}</span>
            <div className="relative aspect-video overflow-hidden rounded-[6px] bg-[#141414]">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${lesson.image ?? module.image})` }}
              />
              <div className="absolute inset-0 bg-black/18" />
              <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-100">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/92 text-black shadow-xl shadow-black/30">
                  <Play className="h-4 w-4 fill-current" />
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-white">{lesson.title}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{lesson.description}</p>
            </div>
            <span className="pt-1 text-xs font-semibold text-zinc-500">{lesson.duration}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ContentDetailsModal({ item, onClose }: ContentDetailsModalProps) {
  const [expandedMainSection, setExpandedMainSection] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [lessonPanelHeight, setLessonPanelHeight] = useState<number | null>(null);
  const [closingItemId, setClosingItemId] = useState<string | null>(null);
  const activeModuleCardRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalScrollerRef = useRef<HTMLDivElement>(null);
  const moduleSectionHeaderRef = useRef<HTMLDivElement>(null);
  const isClosing = item ? closingItemId === item.id : false;

  function handleClose() {
    if (!item || closingItemId === item.id) {
      return;
    }

    setClosingItemId(item.id);
    closeTimeoutRef.current = setTimeout(() => {
      setExpandedMainSection(false);
      setActiveModuleId(null);
      setClosingItemId(null);
      closeTimeoutRef.current = null;
      onClose();
    }, 190);
  }

  useEffect(() => {
    if (!item) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [item]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeModuleId || !item) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const scroller = modalScrollerRef.current;
      const target = moduleSectionHeaderRef.current;

      if (!scroller || !target) {
        return;
      }

      const scrollerTop = scroller.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;

      scroller.scrollTo({
        behavior: "smooth",
        top: scroller.scrollTop + targetTop - scrollerTop - 28
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeModuleId, item]);

  useEffect(() => {
    if (!activeModuleId || !item) {
      return;
    }

    function measurePanelHeight() {
      const activeCard = activeModuleCardRef.current;
      const shouldMatchCardHeight = window.matchMedia("(min-width: 1024px)").matches;

      if (!activeCard || !shouldMatchCardHeight) {
        setLessonPanelHeight(null);
        return;
      }

      const nextHeight = Math.round(activeCard.getBoundingClientRect().height);

      setLessonPanelHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
    }

    const animationFrame = window.requestAnimationFrame(measurePanelHeight);
    const resizeObserver = "ResizeObserver" in window
      ? new ResizeObserver(measurePanelHeight)
      : null;

    if (activeModuleCardRef.current) {
      resizeObserver?.observe(activeModuleCardRef.current);
    }

    window.addEventListener("resize", measurePanelHeight);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measurePanelHeight);
    };
  }, [activeModuleId, item]);

  if (!item) {
    return null;
  }

  const actionLabel = item.isLocked ? item.purchaseLabel ?? "Comprar" : "Acessar";
  const ActionIcon = item.status === "Em breve" ? Bell : item.isLocked ? ShoppingCart : Play;
  const actionClass = item.isLocked
    ? "bg-emerald-600 text-white shadow-[0_18px_42px_rgba(5,150,105,0.32)] hover:bg-emerald-500"
    : "bg-white text-black hover:bg-zinc-200";
  const isCourseLike = item.kind === "Curso" || item.kind === "Bootcamp";
  const isFormation = item.kind === "Formacao";
  const moduleSectionTitle = item.kind === "Bootcamp" ? "Modulos do bootcamp" : "Modulos do curso";
  const totalCourseLessons = courseModules.reduce((total, module) => total + module.lessons.length, 0);
  const courseSummaryLabel = `${courseModules.length} modulos • ${totalCourseLessons} aulas`;
  const detailItems = [
    item.level,
    isCourseLike ? courseSummaryLabel : item.durationLabel ?? item.lessons,
    item.kind
  ].filter((detail): detail is string => Boolean(detail));
  const activeModule = courseModules.find((module) => module.id === activeModuleId);
  const primaryModuleCount = 6;
  const primaryModules = courseModules.slice(0, primaryModuleCount);
  const extraModules = courseModules.slice(primaryModuleCount);
  const hiddenModules = activeModule ? [] : extraModules;
  const hiddenModuleRows = chunkItems(hiddenModules, 3);
  const orderedVisibleModules = primaryModules;
  const secondaryVisibleModules = activeModule
    ? courseModules.filter((module) => module.id !== activeModule.id)
    : orderedVisibleModules;
  const primaryFormationRows = chunkItems(formationCourseCards.slice(0, 3), 3);
  const extraFormationRows = chunkItems(formationCourseCards.slice(3), 3);

  function toggleMainSection() {
    if (expandedMainSection && activeModuleId && courseModules.slice(primaryModuleCount).some((module) => module.id === activeModuleId)) {
      setActiveModuleId(null);
    }

    setExpandedMainSection((current) => !current);
  }

  const modal = (
    <div
      className="modal-viewport-scroll fixed inset-0 z-[220] overflow-y-scroll overscroll-contain px-4 py-8"
      ref={modalScrollerRef}
    >
      <button
        aria-label="Fechar detalhes"
        className={`fixed inset-0 bg-black/78 backdrop-blur-sm ${
          isClosing ? "modal-backdrop-out" : "modal-backdrop-in"
        }`}
        onClick={handleClose}
        onWheel={(event) => {
          event.preventDefault();
          modalScrollerRef.current?.scrollBy({ top: event.deltaY });
        }}
        type="button"
      />
      <section className={`relative z-10 mx-auto w-full max-w-4xl overflow-hidden rounded-[8px] border border-white/10 bg-[#151515] shadow-[0_34px_120px_rgba(0,0,0,0.82)] ${
        isClosing ? "modal-panel-out" : "modal-panel-in"
      }`}>
        <div className="relative min-h-[420px] overflow-hidden sm:min-h-[520px] lg:min-h-[560px]">
          <div
            className="modal-hero-image-in absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${item.image})` }}
          />
          <div className="absolute inset-0 bg-black/16" />
          <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-[#151515] via-[#151515]/88 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/36 via-black/10 to-transparent" />

          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
            <div className="w-[126px] drop-shadow-[0_6px_16px_rgba(0,0,0,0.72)] sm:w-[150px]">
              <Image
                alt=""
                aria-hidden="true"
                className="h-auto w-full object-contain"
                height={35}
                src="/brand/logo-bunker.png"
                width={306}
              />
            </div>

            <div className="flex h-10 items-center gap-2">
              {item.isLocked ? (
                <div className="grid h-10 w-10 place-items-center text-black drop-shadow-[0_1px_5px_rgba(255,255,255,0.78)]">
                  <LockKeyhole className="h-8 w-8 stroke-[3]" />
                  <span className="sr-only">Conteudo bloqueado</span>
                </div>
              ) : null}

              <button
                aria-label="Fechar detalhes"
                className="grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black"
                onClick={handleClose}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-8 lg:p-10">
            <h2 className="max-w-2xl text-3xl font-black leading-none text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.72)] sm:text-5xl">
              {item.title}
            </h2>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className={`inline-flex min-h-12 items-center gap-2 rounded-[8px] px-6 py-3 text-sm font-extrabold transition ${actionClass}`}
                type="button"
              >
                <ActionIcon className="h-4 w-4 fill-current" />
                {actionLabel}
              </button>
              {!item.isLocked ? (
                <button
                  aria-label={`Salvar ${item.title} nos favoritos`}
                  className="grid h-12 w-12 place-items-center rounded-full border-2 border-zinc-400 bg-black/35 text-white transition hover:border-white hover:bg-white/10"
                  type="button"
                >
                  <Bookmark className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-8 p-6 sm:grid-cols-[1.35fr_0.85fr] sm:p-8">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-zinc-300">
              <span className={item.isLocked ? "text-orange-400" : "text-white"}>
                {item.accessLabel ?? item.status}
              </span>
              {detailItems.map((detail) => (
                <span className="contents" key={detail}>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                  <span>{detail}</span>
                </span>
              ))}
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-200">
              {item.description ?? item.eyebrow}
            </p>
          </div>

          <aside className="space-y-4 text-sm">
            {item.instructor ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Professor</p>
                <p className="mt-1 font-bold text-white">{item.instructor.name}</p>
                {item.instructor.handle ? (
                  <p className="text-zinc-400">{item.instructor.handle}</p>
                ) : null}
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Conteudo</p>
              <p className="mt-1 text-zinc-300">{item.eyebrow}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Progresso</p>
              <p className="mt-1 text-zinc-300">{Math.round(item.progress)}% concluido</p>
            </div>
          </aside>
        </div>

        <div className="space-y-10 px-6 pb-8 sm:px-8">
          {isCourseLike ? (
            <section>
              <div
                className="mb-4 flex items-end justify-between gap-4"
                ref={moduleSectionHeaderRef}
              >
                <div>
                  <h3 className="text-xl font-bold text-white">{moduleSectionTitle}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Abra um modulo para ver as aulas em detalhe.
                  </p>
                </div>
                <DetailDots details={[`${courseModules.length} modulos`, `${totalCourseLessons} aulas`]} />
              </div>

              <div className="space-y-4">
                {activeModule ? (
                  <div
                    className="module-focus-layout space-y-5"
                    key={`active-module-${activeModule.id}`}
                  >
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(190px,0.78fr)_minmax(0,1.42fr)]">
                      <ModuleCard
                        active
                        cardRef={activeModuleCardRef}
                        module={activeModule}
                        onClick={() => setActiveModuleId(null)}
                      />
                      <LessonPanel maxHeight={lessonPanelHeight} module={activeModule} />
                    </div>

                    {secondaryVisibleModules.length > 0 ? (
                      <div className="module-secondary-grid space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                          Outros modulos
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {secondaryVisibleModules.map((module) => (
                            <ModuleCard
                              active={false}
                              key={module.id}
                              module={module}
                              onClick={() => setActiveModuleId(module.id)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="module-grid-layout grid gap-4 sm:grid-cols-3" key="module-grid">
                    {orderedVisibleModules.map((module) => (
                      <ModuleCard
                        active={false}
                        key={module.id}
                        module={module}
                        onClick={() => setActiveModuleId(module.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {!activeModule && courseModules.length > 3 ? (
                hiddenModuleRows.length > 0 ? (
                  <ExpandableSectionReveal
                    buttonLabel={expandedMainSection ? "Ver menos modulos" : "Ver mais modulos"}
                    expanded={expandedMainSection}
                    onToggle={toggleMainSection}
                  >
                    {hiddenModuleRows.map((row, rowIndex) => (
                      <div className="grid gap-4 sm:grid-cols-3" key={`extra-module-row-${rowIndex}`}>
                        {row.map((module) => (
                          <ModuleCard
                            active={false}
                            key={module.id}
                            module={module}
                            onClick={() => setActiveModuleId(module.id)}
                          />
                        ))}
                      </div>
                    ))}
                  </ExpandableSectionReveal>
                ) : (
                  <ExpandSectionButton
                    expanded={expandedMainSection}
                    label={expandedMainSection ? "Ver menos modulos" : "Ver mais modulos"}
                    onClick={toggleMainSection}
                  />
                )
              ) : null}
            </section>
          ) : null}

          {isFormation ? (
            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-white">Cursos da formacao</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Conteudos organizados dentro desta jornada.
                  </p>
                </div>
                <DetailDots details={[`${formationCourseCards.length} cursos`, item.durationLabel ?? item.lessons ?? "Aulas"]} />
              </div>

              <div className="space-y-4">
                {primaryFormationRows.map((row, rowIndex) => (
                  <div className="grid gap-4 sm:grid-cols-3" key={`formation-row-${rowIndex}`}>
                    {row.map((card) => (
                      <MiniContentCard card={card} key={card.id} />
                    ))}
                  </div>
                ))}

                {extraFormationRows.length > 0 ? (
                  <ExpandableSectionReveal
                    buttonLabel={expandedMainSection ? "Ver menos cursos" : "Ver mais cursos"}
                    expanded={expandedMainSection}
                    onToggle={toggleMainSection}
                  >
                    {extraFormationRows.map((row, rowIndex) => (
                      <div className="grid gap-4 sm:grid-cols-3" key={`extra-formation-row-${rowIndex}`}>
                        {row.map((card) => (
                          <MiniContentCard card={card} key={card.id} />
                        ))}
                      </div>
                    ))}
                  </ExpandableSectionReveal>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="border-t border-white/10 pt-7">
            <h3 className="text-xl font-bold text-white">Sobre {item.title}</h3>
            <div className="mt-4 grid gap-6 text-sm leading-6 text-zinc-400 sm:grid-cols-[1.35fr_0.85fr]">
              <p>
                {item.description ?? item.eyebrow} Este bloco sera usado para explicar o objetivo,
                o publico ideal, o que o aluno consegue fazer depois do conteudo e como ele se conecta
                com outras jornadas da Bunker707.
              </p>
              <div className="space-y-2">
                <p>
                  <span className="font-semibold text-zinc-300">Tipo:</span> {item.kind}
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">Acesso:</span>{" "}
                  {item.accessLabel ?? item.status}
                </p>
                {item.instructor ? (
                  <p>
                    <span className="font-semibold text-zinc-300">Professor:</span>{" "}
                    {item.instructor.name}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modal, document.body);
}
