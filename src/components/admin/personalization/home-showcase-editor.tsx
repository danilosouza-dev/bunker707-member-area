"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  Loader2,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentRow } from "@/components/content-row";
import { FeaturedStructureHomeSection } from "@/components/featured-structure-home-section";
import { HeroSection } from "@/components/hero-section";
import { MemberFooter } from "@/components/member-footer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import type {
  AdminContentRecord,
  AdminDashboardData,
  ContentItem,
  CourseModule,
  HomeHeroConfig,
  HomeRow,
  HomeSectionConfig,
  HomeSectionContentSource,
  PlatformBrandingConfig,
  RowVisibility
} from "@/lib/platform-types";

type HomeShowcaseEditorProps = {
  branding: PlatformBrandingConfig;
  courseModules: CourseModule[];
  formationCourses: ContentItem[];
  hero: HomeHeroConfig;
  homeRows: HomeRow[];
  homeSectionConfigs: HomeSectionConfig[];
  /** Versao das fileiras lidas (platform_settings.homeSections.updated_at); null = nunca publicada. */
  homeSectionsUpdatedAt?: string | null;
  onBack: () => void;
  onPublished: (data: AdminDashboardData) => void;
  records: AdminContentRecord[];
};

type CreateMode = "automatic" | "manual" | "structure";

const automaticOptions: Array<{
  description: string;
  layout: HomeSectionConfig["layout"];
  sectionType: HomeSectionConfig["sectionType"];
  source: HomeSectionContentSource;
  subtitle: string;
  title: string;
  visibility: RowVisibility;
}> = [
  {
    description: "Aulas iniciadas pelo aluno, ordenadas pela atividade mais recente.",
    layout: "continue",
    sectionType: "continue_watching",
    source: "recent_lessons",
    subtitle: "Retome exatamente de onde parou.",
    title: "Continue assistindo",
    visibility: "students"
  },
  {
    description: "Produtos liberados pelos acessos ativos do aluno.",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "entitlement_products",
    subtitle: "Todos os produtos que voce ja tem acesso.",
    title: "Minhas compras",
    visibility: "students"
  },
  {
    description: "Todos os produtos vendaveis configurados no catalogo.",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "sellable_products",
    subtitle: "Produtos disponiveis e destaques configurados pela Bunker707.",
    title: "Produtos a venda",
    visibility: "all"
  },
  {
    description: "Produtos, novidades e turmas marcados como futuros.",
    layout: "vertical",
    sectionType: "content_carousel",
    source: "upcoming_products",
    subtitle: "Proximos cursos, formacoes e turmas para entrar no radar.",
    title: "Em breve na Bunker707",
    visibility: "all"
  }
];

const panelClassName = "rounded-[10px] border border-white/10 bg-[#111113] shadow-[0_22px_70px_rgba(0,0,0,0.24)]";
const inputClassName = "min-h-10 w-full rounded-[8px] border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition focus:border-white/25";

function normalizeOrder(sections: HomeSectionConfig[]) {
  return sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((section, order) => ({ ...section, order }));
}

function getSectionSourceLabel(section: HomeSectionConfig) {
  if (section.contentSource === "manual") return "Selecao manual";
  if (section.contentSource === "selected_content_structure") return "Conteudo em destaque";
  if (section.contentSource === "recent_lessons") return "Progresso do aluno";
  if (section.contentSource === "entitlement_products") return "Acessos ativos";
  if (section.contentSource === "sellable_products") return "Produtos vendaveis";
  return "Conteudos futuros";
}

function getSectionCount(section: HomeSectionConfig, row?: HomeRow) {
  if (section.contentSource === "manual") return section.itemIds.length;
  if (row?.variant === "course_modules") {
    return (row.modules?.length ?? 0) + (row.structureItems?.length ?? 0);
  }
  return row?.items.length ?? 0;
}

function canDuplicateSection(section: HomeSectionConfig) {
  return section.contentSource === "manual" || section.contentSource === "selected_content_structure";
}

function getScopedModules(modules: CourseModule[], contentId: string) {
  const scoped = modules.filter((module) => module.ownerId === contentId);
  if (scoped.length > 0) return scoped;
  return modules.some((module) => module.ownerId) ? [] : modules;
}

function resolvePreviewRows(
  sections: HomeSectionConfig[],
  publishedRows: HomeRow[],
  records: AdminContentRecord[],
  modules: CourseModule[],
  formationCourses: ContentItem[]
) {
  const publishedById = new Map(publishedRows.map((row) => [row.id, row]));
  const recordsById = new Map(records.map((record) => [record.content.id, record]));
  const sellableRecords = records.filter((record) => record.commerceScope === "sellable_product");

  return normalizeOrder(sections).flatMap<HomeRow>((section) => {
    if (!section.isActive) return [];

    const published = publishedById.get(section.id);
    if (published) {
      return [{
        ...published,
        layout: section.layout,
        sectionId: section.id,
        subtitle: section.subtitle,
        title: section.title,
        visibility: section.visibility
      }];
    }

    if (section.sectionType === "content_structure") {
      const record = section.sourceContentId ? recordsById.get(section.sourceContentId) : undefined;
      if (!record) return [];
      const item = record.content;
      const structureItems = item.kind === "Formacao"
        ? formationCourses.filter((course) => course.parentContentId === item.id)
        : [];
      return [{
        backgroundImage: (record.pageSettings?.hero?.mediaType === "video" ? record.pageSettings.hero.poster : record.pageSettings?.hero?.mediaSrc) ?? item.image,
        course: item,
        id: section.id,
        items: [item],
        layout: section.layout,
        lockedActionMode: record.pageSettings?.lockedActionMode ?? "details_modal",
        modules: getScopedModules(modules, item.id),
        sectionId: section.id,
        structureItems,
        subtitle: section.subtitle,
        title: section.title,
        variant: "course_modules",
        visibility: section.visibility
      }];
    }

    let items: ContentItem[] = [];
    if (section.contentSource === "manual") {
      items = section.itemIds.flatMap((id) => {
        const record = recordsById.get(id);
        return record ? [record.content] : [];
      });
    } else if (section.contentSource === "sellable_products") {
      items = sellableRecords.map((record) => record.content);
    } else if (section.contentSource === "upcoming_products") {
      items = sellableRecords.filter((record) => record.status === "Em breve").map((record) => record.content);
    } else if (section.contentSource === "entitlement_products") {
      items = sellableRecords.filter((record) => record.access === "Liberado").map((record) => record.content);
    }

    return [{
      id: section.id,
      items,
      layout: section.layout,
      sectionId: section.id,
      subtitle: section.subtitle,
      title: section.title,
      variant: section.sectionType === "continue_watching" ? "continue" : "vertical",
      visibility: section.visibility
    }];
  });
}

export function HomeShowcaseEditor({
  branding,
  courseModules,
  formationCourses,
  hero,
  homeRows,
  homeSectionConfigs,
  homeSectionsUpdatedAt,
  onBack,
  onPublished,
  records
}: HomeShowcaseEditorProps) {
  const initialSections = useMemo(() => normalizeOrder(homeSectionConfigs), [homeSectionConfigs]);
  const [publishedSections, setPublishedSections] = useState(initialSections);
  // Versao lida junto com as fileiras acima. Vai no PUT: se a Vitrine nova ou a tela Modulos do admin
  // novo mudaram as fileiras depois disso, a rota responde 409 em vez de apagar a mudanca.
  const [publishedVersion, setPublishedVersion] = useState(homeSectionsUpdatedAt);
  const [drafts, setDrafts] = useState(initialSections);
  const [selectedId, setSelectedId] = useState(initialSections[0]?.id ?? "");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("automatic");
  const [automaticSource, setAutomaticSource] = useState<HomeSectionContentSource>("sellable_products");
  const [createTitle, setCreateTitle] = useState("");
  const [createSubtitle, setCreateSubtitle] = useState("");
  const [createSourceContentId, setCreateSourceContentId] = useState("");
  const [createItemIds, setCreateItemIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const selected = drafts.find((section) => section.id === selectedId) ?? drafts[0];
  const dirty = JSON.stringify(drafts) !== JSON.stringify(publishedSections);
  const previewRows = useMemo(
    () => resolvePreviewRows(drafts, homeRows, records, courseModules, formationCourses),
    [courseModules, drafts, formationCourses, homeRows, records]
  );
  const previewById = useMemo(() => new Map(previewRows.map((row) => [row.id, row])), [previewRows]);
  const heroVisible = hero.enabled !== false && Boolean(hero.image);
  const sellableRecords = useMemo(
    () => records.filter((record) => record.commerceScope === "sellable_product"),
    [records]
  );

  useEffect(() => {
    function warnUnsavedChanges(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnUnsavedChanges);
  }, [dirty]);

  const updateSection = useCallback((sectionId: string, patch: Partial<HomeSectionConfig>) => {
    setDrafts((current) => current.map((section) => section.id === sectionId ? { ...section, ...patch } : section));
  }, []);

  const updateSelected = useCallback((patch: Partial<HomeSectionConfig>) => {
    if (!selected) return;
    updateSection(selected.id, patch);
  }, [selected, updateSection]);

  function moveSection(sectionId: string, direction: -1 | 1) {
    setOpenMenuId(null);
    setDrafts((current) => {
      const ordered = normalizeOrder(current);
      const index = ordered.findIndex((section) => section.id === sectionId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      const next = ordered.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((section, order) => ({ ...section, order }));
    });
  }

  function moveSectionToTarget(sectionId: string, targetId: string) {
    if (sectionId === targetId) return;
    setOpenMenuId(null);
    setDrafts((current) => {
      const ordered = normalizeOrder(current);
      const sourceIndex = ordered.findIndex((section) => section.id === sectionId);
      const targetIndex = ordered.findIndex((section) => section.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = ordered.slice();
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((section, order) => ({ ...section, order }));
    });
  }

  function duplicateSection(sectionId: string) {
    const source = drafts.find((section) => section.id === sectionId);
    if (!source || !canDuplicateSection(source)) return;
    const duplicate = {
      ...source,
      contentSource: source.contentSource === "manual" ? "manual" as const : source.contentSource,
      id: `section-${Date.now()}`,
      order: source.order + 1,
      title: `${source.title} - copia`
    };
    setDrafts((current) => normalizeOrder([...current, duplicate]));
    setSelectedId(duplicate.id);
    setOpenMenuId(null);
  }

  function removeSection(sectionId: string) {
    const section = drafts.find((item) => item.id === sectionId);
    if (!section || !window.confirm(`Excluir a secao “${section.title}”?`)) return;
    const remaining = normalizeOrder(drafts.filter((item) => item.id !== sectionId));
    setDrafts(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setOpenMenuId(null);
  }

  function resetCreateForm() {
    setCreateMode("automatic");
    setAutomaticSource("sellable_products");
    setCreateTitle("");
    setCreateSubtitle("");
    setCreateSourceContentId("");
    setCreateItemIds([]);
  }

  function createSection() {
    const automatic = automaticOptions.find((option) => option.source === automaticSource) ?? automaticOptions[2];
    const structureRecord = records.find((record) => record.content.id === createSourceContentId);
    const title = createMode === "automatic"
      ? automatic.title
      : createTitle.trim() || structureRecord?.content.title || "Nova secao";
    const section: HomeSectionConfig = {
      contentSource: createMode === "manual"
        ? "manual"
        : createMode === "structure"
          ? "selected_content_structure"
          : automatic.source,
      id: `section-${Date.now()}`,
      isActive: true,
      itemIds: createMode === "manual" ? createItemIds : [],
      layout: createMode === "structure" ? "compact" : automatic.layout,
      order: drafts.length,
      sectionType: createMode === "structure"
        ? "content_structure"
        : createMode === "automatic"
          ? automatic.sectionType
          : "content_carousel",
      sourceContentId: createMode === "structure" ? createSourceContentId : undefined,
      subtitle: createMode === "automatic" ? automatic.subtitle : createSubtitle.trim() || undefined,
      title,
      visibility: createMode === "automatic" ? automatic.visibility : "all"
    };
    setDrafts((current) => normalizeOrder([...current, section]));
    setSelectedId(section.id);
    setCreateOpen(false);
    resetCreateForm();
  }

  function discardChanges() {
    setDrafts(publishedSections);
    setSelectedId(publishedSections[0]?.id ?? "");
    setOpenMenuId(null);
    setNotice(null);
  }

  async function publishChanges() {
    setPublishing(true);
    setOpenMenuId(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/home-sections", {
        body: JSON.stringify({
          sections: normalizeOrder(drafts),
          ...(publishedVersion !== undefined ? { expectedUpdatedAt: publishedVersion } : {})
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = await response.json() as { data?: AdminDashboardData; error?: string; sectionsUpdatedAt?: string | null };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel publicar a Home.");
      }
      const canonical = normalizeOrder(payload.data.homeSectionConfigs);
      setPublishedSections(canonical);
      setDrafts(canonical);
      setPublishedVersion(payload.sectionsUpdatedAt ?? payload.data.homeSectionsUpdatedAt ?? publishedVersion);
      setNotice({ message: "Home publicada com sucesso.", tone: "success" });
      onPublished(payload.data);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Nao foi possivel publicar a Home.", tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  const canCreate = createMode === "automatic"
    ? !drafts.some((section) => section.contentSource === automaticSource)
    : createMode === "structure"
      ? Boolean(createSourceContentId)
      : Boolean(createTitle.trim() && createItemIds.length > 0);

  return (
    <div className="space-y-4">
      <div className="sticky top-[4.25rem] z-30 -mx-4 border-y border-white/10 bg-[#0b0b0b]/94 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-200 transition hover:bg-white/10 hover:text-white" onClick={onBack} type="button">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <div>
              <p className="text-xs font-black uppercase text-zinc-500">Personalizacao</p>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-white">Vitrine</h2>
                {dirty ? <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">Alteracoes nao publicadas</span> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex h-10 items-center rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!dirty || publishing} onClick={discardChanges} type="button">Descartar</button>
            <button className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-white px-3 text-xs font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40" disabled={!dirty || publishing} onClick={() => void publishChanges()} type="button">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {publishing ? "Publicando" : "Publicar"}
            </button>
          </div>
        </div>
      </div>

      {notice ? <div className={`rounded-[8px] border px-4 py-3 text-sm font-bold ${notice.tone === "success" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-red-400/25 bg-red-400/10 text-red-200"}`}>{notice.message}</div> : null}

      <section className="grid min-w-0 gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <aside className={`${panelClassName} h-fit overflow-visible xl:sticky xl:top-[9rem]`}>
          <div className="flex items-center justify-between border-b border-white/10 p-4">
            <div><p className="text-sm font-black text-white">Estrutura da Home</p><p className="mt-1 text-[11px] text-zinc-500">Arraste para ordenar</p></div>
            <button className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-white/10 bg-white/[0.055] px-2.5 text-xs font-black text-zinc-200 transition hover:bg-white/10" onClick={() => setCreateOpen(true)} type="button"><Plus className="h-3.5 w-3.5" /> Criar</button>
          </div>
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-black text-zinc-300"><Layers3 className="h-4 w-4" /> Banner <span className="ml-auto text-[10px] text-zinc-600">{heroVisible ? "fixo" : "removido"}</span></div>
          </div>
          <div className="space-y-2 p-3">
            {drafts.length === 0 ? <div className="rounded-[8px] border border-dashed border-white/15 p-5 text-center"><p className="text-xs font-bold text-zinc-400">Nenhuma secao</p><button className="mt-3 text-xs font-black text-white underline" onClick={() => setCreateOpen(true)} type="button">Criar primeira secao</button></div> : null}
            {normalizeOrder(drafts).map((section, index) => {
              const active = section.id === selected?.id;
              const row = previewById.get(section.id);
              return (
                <div
                  className={`relative flex items-center gap-2 rounded-[8px] border px-2 py-2 transition ${active ? "border-white/25 bg-white text-black" : "border-white/10 bg-white/[0.035] text-zinc-300 hover:bg-white/10 hover:text-white"} ${draggedId === section.id ? "opacity-45" : ""}`}
                  draggable
                  key={section.id}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedId(section.id)}
                  onDrop={() => { if (draggedId) moveSectionToTarget(draggedId, section.id); setDraggedId(null); }}
                >
                  <button aria-label={`Arrastar ${section.title}`} className="cursor-grab touch-none" type="button"><GripVertical className="h-4 w-4" /></button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(section.id); setOpenMenuId(null); }} type="button">
                    <span className="block truncate text-xs font-black">{section.title}</span>
                    <span className={`mt-1 block truncate text-[10px] font-semibold ${active ? "text-black/55" : "text-zinc-500"}`}>{getSectionCount(section, row)} itens · {section.isActive ? "Ativa" : "Oculta"}</span>
                  </button>
                  <button aria-label={`Opcoes de ${section.title}`} onClick={() => setOpenMenuId((current) => current === section.id ? null : section.id)} type="button"><MoreHorizontal className="h-4 w-4" /></button>
                  {openMenuId === section.id ? (
                    <div className="absolute right-1 top-10 z-50 w-44 overflow-hidden rounded-[8px] border border-white/10 bg-[#1b1b1e] p-1 text-zinc-200 shadow-2xl">
                      <button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs hover:bg-white/10" disabled={index === 0} onClick={() => moveSection(section.id, -1)} type="button"><ArrowUp className="h-3.5 w-3.5" /> Mover para cima</button>
                      <button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs hover:bg-white/10" disabled={index === drafts.length - 1} onClick={() => moveSection(section.id, 1)} type="button"><ArrowDown className="h-3.5 w-3.5" /> Mover para baixo</button>
                      <button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canDuplicateSection(section)} onClick={() => duplicateSection(section.id)} title={canDuplicateSection(section) ? undefined : "Fontes automaticas so podem aparecer uma vez."} type="button"><Copy className="h-3.5 w-3.5" /> Duplicar</button>
                      <button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs hover:bg-white/10" onClick={() => { updateSection(section.id, { isActive: !section.isActive }); setOpenMenuId(null); }} type="button">{section.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {section.isActive ? "Ocultar" : "Ativar"}</button>
                      <button className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs text-red-300 hover:bg-red-400/10" onClick={() => removeSection(section.id)} type="button"><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <div className={`${panelClassName} min-w-0 overflow-hidden bg-[#141414]`}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><p className="text-sm font-black text-white">Preview da Home</p><p className="text-[11px] text-zinc-500">Clique em uma secao para editar</p></div><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-zinc-400">Desktop</span></div>
          <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto">
            <div className="pointer-events-none relative min-h-[700px] min-w-[680px] origin-top-left overflow-hidden bg-[#141414]">
              <HeroSection hero={hero} />
              <div className={`relative z-20 space-y-20 pb-20 ${heroVisible ? "-mt-24" : "pt-16"}`}>
                {previewRows.map((row) => (
                  <div className={`pointer-events-auto relative rounded-[8px] outline outline-2 transition ${row.id === selected?.id ? "outline-red-500/75" : "outline-transparent hover:outline-white/25"}`} key={row.id} onClick={() => setSelectedId(row.id)}>
                    {row.variant === "course_modules" && row.course ? (
                      <FeaturedStructureHomeSection row={row} />
                    ) : row.items.length > 0 ? (
                      <ContentRow items={row.items} subtitle={row.subtitle} title={row.title} variant={row.variant === "continue" ? "continue" : "vertical"} />
                    ) : (
                      <div className="mx-8 rounded-[8px] border border-dashed border-white/15 p-8 text-center"><p className="text-sm font-black text-white">{row.title}</p><p className="mt-2 text-xs text-zinc-500">Esta secao ainda nao possui itens no preview.</p></div>
                    )}
                  </div>
                ))}
              </div>
              <MemberFooter branding={branding} />
            </div>
          </div>
        </div>

        <aside className={`${panelClassName} h-fit overflow-hidden xl:sticky xl:top-[9rem]`}>
          <div className="border-b border-white/10 p-4"><p className="text-sm font-black text-white">Propriedades</p><p className="mt-1 text-[11px] text-zinc-500">Inspetor da secao selecionada</p></div>
          {selected ? (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="truncate text-sm font-black text-white">{selected.title}</p><p className="mt-1 text-[11px] text-zinc-500">{getSectionSourceLabel(selected)}</p></div><button aria-pressed={selected.isActive} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-black ${selected.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-zinc-400"}`} onClick={() => updateSelected({ isActive: !selected.isActive })} type="button">{selected.isActive ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{selected.isActive ? "Ativa" : "Oculta"}</button></div>
              <label className="grid gap-1.5 text-[10px] font-black uppercase text-zinc-500">Titulo<input className={inputClassName} onChange={(event) => updateSelected({ title: event.target.value })} value={selected.title} /></label>
              <label className="grid gap-1.5 text-[10px] font-black uppercase text-zinc-500">Subtitulo<textarea className={`${inputClassName} min-h-20 resize-none py-2`} onChange={(event) => updateSelected({ subtitle: event.target.value })} value={selected.subtitle ?? ""} /></label>
              <label className="grid gap-1.5 text-[10px] font-black uppercase text-zinc-500">Visibilidade<select className={inputClassName} onChange={(event) => updateSelected({ visibility: event.target.value as RowVisibility })} value={selected.visibility}><option value="all">Todos</option><option value="students">Alunos com acesso</option><option value="non_students">Sem compra ativa</option></select></label>
              {selected.sectionType === "content_structure" ? (
                <div className="space-y-2"><p className="text-[10px] font-black uppercase text-zinc-500">Apresentacao</p><div className="grid grid-cols-2 gap-2"><button className={`rounded-[8px] border p-3 text-left ${selected.layout === "compact" ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.035] text-zinc-300"}`} onClick={() => updateSelected({ layout: "compact" })} type="button"><span className="block text-xs font-black">Compacta</span><span className="mt-1 block text-[10px] opacity-65">Capa e cards abaixo</span></button><button className={`rounded-[8px] border p-3 text-left ${selected.layout === "immersive" ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.035] text-zinc-300"}`} onClick={() => updateSelected({ layout: "immersive" })} type="button"><span className="block text-xs font-black">Layout imersivo</span><span className="mt-1 block text-[10px] opacity-65">Banner com cards</span></button></div></div>
              ) : null}
              {selected.contentSource === "manual" ? (
                <div className="space-y-2"><p className="text-[10px] font-black uppercase text-zinc-500">Selecao manual</p><div className="max-h-52 space-y-1 overflow-y-auto rounded-[8px] border border-white/10 p-2">{sellableRecords.map((record) => { const checked = selected.itemIds.includes(record.content.id); return <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-xs text-zinc-300 hover:bg-white/[0.055]" key={record.content.id}><input checked={checked} onChange={() => updateSelected({ itemIds: checked ? selected.itemIds.filter((id) => id !== record.content.id) : [...selected.itemIds, record.content.id] })} type="checkbox" /> <span className="truncate">{record.content.title}</span></label>; })}</div></div>
              ) : null}
              <div className="border-t border-white/10 pt-4"><button className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] py-2.5 text-xs font-black text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canDuplicateSection(selected)} onClick={() => duplicateSection(selected.id)} title={canDuplicateSection(selected) ? undefined : "Fontes automaticas so podem aparecer uma vez."} type="button"><Copy className="h-4 w-4" /> Duplicar secao</button><button className="mt-2 flex w-full items-center justify-center gap-2 rounded-[8px] border border-red-400/20 bg-red-400/5 py-2.5 text-xs font-black text-red-300 hover:bg-red-400/10" onClick={() => removeSection(selected.id)} type="button"><Trash2 className="h-4 w-4" /> Excluir secao</button></div>
              <button className="sr-only" type="button">Salvar alteracoes</button>
            </div>
          ) : <div className="p-8 text-center text-sm text-zinc-500">Selecione ou crie uma secao.</div>}
        </aside>
      </section>

      <Dialog onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }} open={createOpen}>
        <DialogContent className="max-w-3xl bg-[#151517] text-white">
          <DialogHeader><DialogTitle>Criar secao</DialogTitle><DialogDescription>Escolha como os cards serao alimentados e apresentados na Home.</DialogDescription></DialogHeader>
          <div className="overflow-y-auto px-4 pb-4">
            <div className="grid grid-cols-3 gap-2">{(["automatic", "manual", "structure"] as CreateMode[]).map((mode) => <button className={`rounded-[8px] border p-3 text-left ${createMode === mode ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.035] text-zinc-300"}`} key={mode} onClick={() => setCreateMode(mode)} type="button"><span className="block text-xs font-black">{mode === "automatic" ? "Automatica" : mode === "manual" ? "Selecao manual" : "Conteudo em destaque"}</span></button>)}</div>
            {createMode === "automatic" ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{automaticOptions.map((option) => { const used = drafts.some((section) => section.contentSource === option.source); return <button className={`rounded-[8px] border p-3 text-left ${automaticSource === option.source ? "border-white bg-white text-black" : "border-white/10 bg-black/20 text-zinc-300"} disabled:cursor-not-allowed disabled:opacity-35`} disabled={used} key={option.source} onClick={() => setAutomaticSource(option.source)} type="button"><span className="block text-sm font-black">{option.title}</span><span className="mt-1 block text-xs opacity-65">{used ? "Ja adicionada" : option.description}</span></button>; })}</div> : null}
            {createMode !== "automatic" ? <div className="mt-4 grid gap-3"><label className="grid gap-1.5 text-xs font-black text-zinc-400">Titulo<input className={inputClassName} onChange={(event) => setCreateTitle(event.target.value)} value={createTitle} /></label><label className="grid gap-1.5 text-xs font-black text-zinc-400">Subtitulo<textarea className={`${inputClassName} min-h-20 py-2`} onChange={(event) => setCreateSubtitle(event.target.value)} value={createSubtitle} /></label></div> : null}
            {createMode === "structure" ? <label className="mt-4 grid gap-1.5 text-xs font-black text-zinc-400">Curso ou formacao<select className={inputClassName} onChange={(event) => setCreateSourceContentId(event.target.value)} value={createSourceContentId}><option value="">Selecione</option>{sellableRecords.map((record) => <option key={record.content.id} value={record.content.id}>{record.content.title}</option>)}</select></label> : null}
            {createMode === "manual" ? <div className="mt-4"><p className="text-xs font-black text-zinc-400">Cards</p><div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-[8px] border border-white/10 p-2">{sellableRecords.map((record) => { const checked = createItemIds.includes(record.content.id); return <label className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.055]" key={record.content.id}><input checked={checked} onChange={() => setCreateItemIds((current) => checked ? current.filter((id) => id !== record.content.id) : [...current, record.content.id])} type="checkbox" /> {record.content.title}</label>; })}</div></div> : null}
          </div>
          <DialogFooter><button className="inline-flex h-10 items-center justify-center rounded-[8px] border border-white/10 px-4 text-xs font-black text-zinc-300" onClick={() => setCreateOpen(false)} type="button">Cancelar</button><button className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-xs font-black text-black disabled:opacity-40" disabled={!canCreate} onClick={createSection} type="button"><Plus className="h-4 w-4" /> Criar secao</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
